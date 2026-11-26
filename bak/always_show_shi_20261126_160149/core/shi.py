"""相事件的瞬时“势”观测。

本模块不持久化势、距离或关系，也不提供跨请求缓存。每次调用均基于本次
/click 已取得的节点与距离重新计算。私密节点不会进入样本或外部模型。
"""

import asyncio
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
from dotenv import load_dotenv

load_dotenv()

FORMULA_VERSION = "1.0"
RELATIONS = {"same", "opposite", "neutral", "uncertain"}
DEFAULT_MAX_CANDIDATES = 24
DEFAULT_LAMBDA = 0.5
DEFAULT_TOTAL_TIMEOUT_MS = 15000
DEFAULT_LLM_BATCH = 12


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return int(default)


_OBSERVATION_SEMAPHORE = asyncio.Semaphore(max(1, _env_int("SHI_MAX_CONCURRENT_OBSERVATIONS", 2)))


def shi_enabled() -> bool:
    return os.getenv("SHI_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def shi_horizon_enabled() -> bool:
    """是否在 /click 响应中附加势视界明细；默认关闭以控制响应体积。"""
    return os.getenv("IS_SHOW_SHI_HORIZON", "0").strip().lower() in {"1", "true", "yes", "on"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _number(value: Any) -> Optional[float]:
    try:
        result = float(value)
        return result if result == result and abs(result) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _same_node(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    left_serial = left.get("serial_id")
    right_serial = right.get("serial_id")
    if left_serial is not None and right_serial is not None:
        return str(left_serial) == str(right_serial)
    return (
        left.get("node_id") == right.get("node_id")
        and left.get("owner_id") == right.get("owner_id")
    )


def _public_for_shi(node: Dict[str, Any]) -> bool:
    # is_share 缺失的旧数据沿用现有“共享”兼容规则；显式私密与打码桩点严格排除。
    return not node.get("is_locked") and node.get("is_share") is not False


def filter_shi_horizon(
    focal: Dict[str, Any], nodes: Iterable[Dict[str, Any]], max_eyes: float
) -> List[Dict[str, Any]]:
    """在 /click 原返回集合上过滤相事件，不发起任何额外跨场查询。"""
    filtered: List[Dict[str, Any]] = []
    seen = set()
    for node in nodes:
        if node.get("block_tag") != "相":
            continue
        is_focal = _same_node(node, focal)
        distance = _number(node.get("distance"))
        if not is_focal:
            if distance is None or distance < 0 or distance > max_eyes:
                continue
            if not _public_for_shi(node):
                continue
        # 同一物理节点只保留一次；同名节点仍由系统既有身份机制处理。
        key = (
            str(node.get("serial_id"))
            if node.get("serial_id") is not None
            else f"{node.get('owner_id')}::{node.get('node_id')}"
        )
        if key in seen:
            continue
        seen.add(key)
        if distance is not None:
            node["distance"] = distance
        filtered.append(node)
    filtered.sort(key=lambda item: _number(item.get("distance")) if _number(item.get("distance")) is not None else float("inf"))
    return filtered


def empty_shi_meta(max_eyes: float, reason: str = "no_samples") -> Dict[str, Any]:
    return {
        "observed_at": _utc_now(),
        "status": "complete",
        "formula_version": FORMULA_VERSION,
        "base_shi": None,
        "interference": 0.0,
        "lambda": _clamp(_env_float("SHI_LAMBDA", DEFAULT_LAMBDA), 0.0, 1.0),
        "avg_distance": None,
        "sample_count": 0,
        "same_count": 0,
        "opposite_count": 0,
        "neutral_count": 0,
        "uncertain_count": 0,
        "max_eyes": float(max_eyes),
        "truncated": False,
        "reason": reason,
        "script_count": 0,
        "nli_count": 0,
        "llm_count": 0,
    }


def error_shi_meta(max_eyes: float) -> Dict[str, Any]:
    meta = empty_shi_meta(max_eyes, "observation_error")
    meta["status"] = "partial"
    return meta


def calculate_shi(
    samples: List[Dict[str, Any]],
    lambda_value: Optional[float] = None,
    observed_at: Optional[str] = None,
    status: str = "complete",
    max_eyes: float = 30.0,
    truncated: bool = False,
    pipeline_counts: Optional[Dict[str, int]] = None,
) -> Tuple[Optional[float], Dict[str, Any]]:
    """纯公式层。samples 每项含 distance、relation、confidence。"""
    lam = _clamp(
        _env_float("SHI_LAMBDA", DEFAULT_LAMBDA) if lambda_value is None else lambda_value,
        0.0,
        1.0,
    )
    counts = {name: 0 for name in ("same", "opposite", "neutral", "uncertain")}
    counts.update(pipeline_counts or {})
    base_meta = {
        "observed_at": observed_at or _utc_now(),
        "status": status,
        "formula_version": FORMULA_VERSION,
        "lambda": lam,
        "max_eyes": float(max_eyes),
        "truncated": bool(truncated),
    }
    if not samples:
        meta = empty_shi_meta(max_eyes)
        meta.update(base_meta)
        return None, meta

    distances = [float(sample["distance"]) for sample in samples]
    avg_distance = sum(distances) / len(distances)
    base = _clamp(100.0 - avg_distance)
    same_weight = 0.0
    opposite_weight = 0.0
    relation_counts = {name: 0 for name in RELATIONS}
    for sample in samples:
        relation = sample.get("relation", "uncertain")
        if relation not in RELATIONS:
            relation = "uncertain"
        relation_counts[relation] += 1
        confidence = _clamp(float(sample.get("confidence", 0.0)), 0.0, 1.0)
        closeness = _clamp(1.0 - float(sample["distance"]) / 100.0, 0.0, 1.0)
        weight = closeness * confidence
        if relation == "same":
            same_weight += weight
        elif relation == "opposite":
            opposite_weight += weight

    directional_total = same_weight + opposite_weight
    interference = (same_weight - opposite_weight) / directional_total if directional_total > 0 else 0.0
    shi = round(_clamp(base * (1.0 + lam * interference)), 2)
    meta = {
        **base_meta,
        "base_shi": round(base, 2),
        "interference": round(interference, 6),
        "avg_distance": round(avg_distance, 4),
        "sample_count": len(samples),
        "same_count": relation_counts["same"],
        "opposite_count": relation_counts["opposite"],
        "neutral_count": relation_counts["neutral"],
        "uncertain_count": relation_counts["uncertain"],
        "reason": None,
        "script_count": counts.get("script_count", 0),
        "nli_count": counts.get("nli_count", 0),
        "llm_count": counts.get("llm_count", 0),
    }
    return shi, meta


def _normalize(text: Any) -> str:
    value = unicodedata.normalize("NFKC", str(text or "")).lower()
    return "".join(char for char in value if char.isalnum())


# 只用于高置信度的显式否定复原，不把一般反义词猜测成反向。
_NEGATIONS = (
    "并不可能", "不可能", "不会", "不能", "不可以", "无法", "不能够",
    "未能", "不再", "并不", "并非", "不是", "没有", "无", "不",
)


def _negation_skeleton(value: str) -> Tuple[str, int]:
    parity = 0
    skeleton = value
    changed = True
    while changed:
        changed = False
        for phrase in _NEGATIONS:
            if phrase in skeleton:
                parity += skeleton.count(phrase)
                skeleton = skeleton.replace(phrase, "")
                changed = True
    # “将／可能”只表示时态或模态，不表示否定极性；先移除否定词后再归一。
    # 不在此处删除单独的“会”，避免误伤“会议”等普通词。
    skeleton = skeleton.replace("将要", "").replace("将", "").replace("可能", "")
    return skeleton, parity


def deterministic_relation(focal_text: str, candidate_text: str) -> Optional[Dict[str, Any]]:
    left = _normalize(focal_text)
    right = _normalize(candidate_text)
    if not left or not right:
        return None
    if left == right:
        return {"relation": "same", "confidence": 1.0, "reason": "规范化文本一致", "source": "script"}
    left_skeleton, left_parity = _negation_skeleton(left)
    right_skeleton, right_parity = _negation_skeleton(right)
    if left_skeleton and left_skeleton == right_skeleton and left_parity % 2 != right_parity % 2:
        return {"relation": "opposite", "confidence": 0.96, "reason": "仅显式否定极性相反", "source": "script"}
    return None


def _relation_text(node: Dict[str, Any], include_body: bool = False) -> str:
    title = str(node.get("node_id") or "").strip()
    if not include_body:
        return title
    body = str(node.get("event_tuple") or "").strip()
    # 限制本次请求发送量；私密节点在进入此函数前已被排除。
    return f"标题：{title}\n内容：{body[:1600]}" if body and body != title else title


def _valid_model_result(item: Dict[str, Any]) -> Dict[str, Any]:
    relation = str(item.get("relation", "uncertain")).lower()
    if relation not in RELATIONS:
        relation = "uncertain"
    confidence = _number(item.get("confidence"))
    return {
        "relation": relation,
        "confidence": _clamp(confidence if confidence is not None else 0.0, 0.0, 1.0),
        "reason": str(item.get("reason") or "")[:240],
    }


def _extract_results(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        results = payload.get("results", payload.get("data", []))
        return results if isinstance(results, list) else []
    return []


def _call_nli_batch(focal: Dict[str, Any], pending: List[Tuple[int, Dict[str, Any]]], timeout: float) -> List[Dict[str, Any]]:
    url = os.getenv("SHI_NLI_URL", "").strip()
    if not url:
        return []
    headers = {"Content-Type": "application/json"}
    api_key = os.getenv("SHI_NLI_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    response = requests.post(
        url,
        headers=headers,
        json={
            "focal": _relation_text(focal, include_body=True),
            "candidates": [
                {"index": index, "text": _relation_text(node, include_body=True)}
                for index, node in pending
            ],
        },
        timeout=timeout,
    )
    response.raise_for_status()
    return _extract_results(response.json())


def _parse_llm_json(content: str) -> List[Dict[str, Any]]:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE | re.DOTALL).strip()
    try:
        return _extract_results(json.loads(text))
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            return []
        try:
            return _extract_results(json.loads(match.group(0)))
        except json.JSONDecodeError:
            return []


def _call_llm_batch(focal: Dict[str, Any], pending: List[Tuple[int, Dict[str, Any]]]) -> List[Dict[str, Any]]:
    from core.llm import client

    pairs = [
        {"index": index, "candidate": _relation_text(node, include_body=True)}
        for index, node in pending
    ]
    prompt = (
        "判断每个候选观点相对于焦点观点的立场关系。same=同向，opposite=反向，"
        "neutral=相关但无明确同反向，uncertain=证据不足。不要判断真假，不要计算分数。"
        "仅输出 JSON：{\"results\":[{\"index\":0,\"relation\":\"same|opposite|neutral|uncertain\","
        "\"confidence\":0.0,\"reason\":\"简短依据\"}]}。\n\n"
        f"焦点：{_relation_text(focal, include_body=True)}\n"
        f"候选：{json.dumps(pairs, ensure_ascii=False)}"
    )
    response = client.chat.completions.create(
        model=os.getenv("SHI_LLM_MODEL") or os.getenv("MODEL"),
        messages=[
            {"role": "system", "content": "你是严格的观点关系分类器，只输出指定 JSON。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0,
        stream=False,
    )
    return _parse_llm_json(response.choices[0].message.content or "")


def _apply_model_results(
    pending: List[Tuple[int, Dict[str, Any]]],
    raw_results: List[Dict[str, Any]],
    resolved: Dict[int, Dict[str, Any]],
    source: str,
) -> None:
    by_index = {}
    for item in raw_results:
        try:
            by_index[int(item.get("index"))] = item
        except (TypeError, ValueError, AttributeError):
            continue
    for index, _node in pending:
        if index in by_index:
            result = _valid_model_result(by_index[index])
            result["source"] = source
            resolved[index] = result


async def observe_shi(
    focal: Dict[str, Any], phase_horizon: List[Dict[str, Any]], max_eyes: float
) -> Tuple[Optional[float], Dict[str, Any]]:
    """对本次相事件视界进行瞬时观测；无跨请求缓存。"""
    if not _public_for_shi(focal):
        return None, empty_shi_meta(max_eyes, "private_focal")

    candidates = [node for node in phase_horizon if not _same_node(node, focal) and _public_for_shi(node)]
    max_candidates = max(1, _env_int("SHI_MAX_CANDIDATES", DEFAULT_MAX_CANDIDATES))
    truncated = len(candidates) > max_candidates
    candidates = candidates[:max_candidates]
    if not candidates:
        meta = empty_shi_meta(max_eyes)
        meta["truncated"] = truncated
        return None, meta

    samples: List[Dict[str, Any]] = []
    pending: List[Tuple[int, Dict[str, Any]]] = []
    resolved: Dict[int, Dict[str, Any]] = {}
    for index, node in enumerate(candidates):
        result = deterministic_relation(_relation_text(focal), _relation_text(node))
        if result:
            resolved[index] = result
        else:
            pending.append((index, node))

    pipeline_counts = {
        "script_count": len(resolved),
        "nli_count": 0,
        "llm_count": 0,
    }
    partial = False
    total_timeout = max(0.1, _env_int("SHI_RELATION_TIMEOUT_MS", DEFAULT_TOTAL_TIMEOUT_MS) / 1000.0)
    deadline = time.monotonic() + total_timeout
    async with _OBSERVATION_SEMAPHORE:
        if pending and os.getenv("SHI_NLI_URL", "").strip():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                partial = True
            else:
                try:
                    raw = await asyncio.wait_for(
                        asyncio.to_thread(_call_nli_batch, focal, pending, remaining), timeout=remaining
                    )
                    before = len(resolved)
                    _apply_model_results(pending, raw, resolved, "nli")
                    pipeline_counts["nli_count"] = len(resolved) - before
                    if not raw:
                        partial = True
                except (asyncio.TimeoutError, requests.RequestException, ValueError):
                    partial = True
            pending = [(index, node) for index, node in pending if index not in resolved]

        if pending and (os.getenv("SHI_LLM_MODEL") or os.getenv("MODEL")):
            batch_size = max(1, _env_int("SHI_LLM_MAX_BATCH", DEFAULT_LLM_BATCH))
            for start in range(0, len(pending), batch_size):
                batch = pending[start:start + batch_size]
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    partial = True
                    break
                try:
                    raw = await asyncio.wait_for(
                        asyncio.to_thread(_call_llm_batch, focal, batch), timeout=remaining
                    )
                    before = len(resolved)
                    _apply_model_results(batch, raw, resolved, "llm")
                    pipeline_counts["llm_count"] += len(resolved) - before
                    if not raw:
                        partial = True
                except (asyncio.TimeoutError, Exception):
                    # 模型失败不能破坏原点击；本次未解决项按 uncertain 处理。
                    partial = True
        if pending:
            # 未配置模型、模型未覆盖或失败都不是“确定性中性”。
            if any(index not in resolved for index, _node in pending):
                partial = True

    for index, node in enumerate(candidates):
        relation = resolved.get(index, {"relation": "uncertain", "confidence": 0.0})
        samples.append({
            "distance": float(node["distance"]),
            "relation": relation["relation"],
            "confidence": relation.get("confidence", 0.0),
        })
    return calculate_shi(
        samples,
        status="partial" if partial else "complete",
        max_eyes=max_eyes,
        truncated=truncated,
        pipeline_counts=pipeline_counts,
    )
