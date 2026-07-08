import os
import json
import requests
import logging
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 配置日志
logger = logging.getLogger(__name__)

# ============================================================
# 负载均衡 Embed 配置（优先使用）
# ============================================================
EMBED_BASE_URL = os.getenv("EMBED_BASE_URL", "").strip()
EMBED_MODEL = os.getenv("EMBED_MODEL", "").strip()
EMBED_KEY = os.getenv("EMBED_KEY", "").strip()
EMBED_DIMENSIONS = int(os.getenv("EMBED_DIMENSIONS", "768").strip())
EMBED_MAX_CHARS = int(os.getenv("EMBED_MAX_CHARS", "8000").strip())

# 如果配置了负载均衡地址，则创建 OpenAI 兼容客户端
_embed_client = None
if EMBED_BASE_URL:
    try:
        from openai import OpenAI
        _embed_client = OpenAI(base_url=EMBED_BASE_URL, api_key=EMBED_KEY)
        logger.info(f"Embed 负载均衡已启用: {EMBED_BASE_URL} (模型: {EMBED_MODEL})")
    except ImportError:
        logger.warning("openai 包未安装，无法使用负载均衡 Embed，将降级到 Ollama 原生 API")
    except Exception as e:
        logger.warning(f"创建 Embed 负载均衡客户端失败: {e}，将降级到 Ollama 原生 API")

# ============================================================
# Ollama 原生 Embed 配置（降级备用）
# ============================================================
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "192.168.68.28")
OLLAMA_PORT = os.getenv("OLLAMA_PORT", "11434")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

OLLAMA_API_URL = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/embeddings"


def _chunk_text(text: str, max_chars: int) -> list:
    """
    按字符数将文本切分为多个片段。
    
    Args:
        text: 待切分的文本
        max_chars: 每片段最大字符数
        
    Returns:
        list: 文本片段列表
    """
    if len(text) <= max_chars:
        return [text]
    
    chunks = []
    for i in range(0, len(text), max_chars):
        chunks.append(text[i:i + max_chars])
    return chunks


def _mean_pool_vectors(vectors: list) -> list:
    """
    对多个等长向量逐维取算术均值。
    
    Args:
        vectors: 向量列表，每个向量为浮点数列表
        
    Returns:
        list: 均值向量
    """
    if not vectors:
        return None
    if len(vectors) == 1:
        return vectors[0]
    
    dim = len(vectors[0])
    result = [0.0] * dim
    for vec in vectors:
        for j in range(dim):
            result[j] += vec[j]
    return [v / len(vectors) for v in result]


def _get_embedding_via_openai(text: str) -> list:
    """
    通过 OpenAI 兼容接口（负载均衡）获取向量。
    长文本自动分片嵌入后取均值池化。
    
    Args:
        text: 需要向量化的文本
        
    Returns:
        list: 浮点数向量，失败则返回 None
    """
    if not _embed_client:
        return None
    
    chunks = _chunk_text(text, EMBED_MAX_CHARS)
    
    if len(chunks) > 1:
        logger.info(f"文本过长 ({len(text)} 字符)，分 {len(chunks)} 片嵌入后均值池化")
    
    try:
        r = _embed_client.embeddings.create(
            model=EMBED_MODEL,
            input=chunks,
            extra_body={
                "options": {
                    "embedding_dim": EMBED_DIMENSIONS
                }
            }
        )
        if not r.data or len(r.data) == 0:
            logger.error(f"负载均衡 Embed 返回空数据")
            return None
        
        embeddings = [d.embedding for d in r.data]
        result = _mean_pool_vectors(embeddings)
        logger.debug(f"负载均衡 Embed 成功，维度: {len(result)}")
        return result
    except Exception as e:
        logger.error(f"负载均衡 Embed 失败: {e}")
        return None


def _get_embedding_via_ollama(text: str) -> list:
    """
    通过 Ollama 原生 API 获取向量（降级备用）。
    长文本自动分片嵌入后取均值池化。
    
    Args:
        text: 需要向量化的文本
        
    Returns:
        list: 浮点数向量，失败则返回 None
    """
    chunks = _chunk_text(text, EMBED_MAX_CHARS)
    
    if len(chunks) > 1:
        logger.info(f"文本过长 ({len(text)} 字符)，分 {len(chunks)} 片嵌入后均值池化（Ollama 降级模式）")
    
    embeddings = []
    for i, chunk in enumerate(chunks):
        try:
            payload = {
                "model": OLLAMA_EMBED_MODEL,
                "prompt": chunk,
                "options": {
                    "num_ctx": 8192
                }
            }
            
            response = requests.post(OLLAMA_API_URL, json=payload, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            if "embedding" in data:
                embeddings.append(data["embedding"])
            else:
                logger.error(f"Ollama 分片 {i+1}/{len(chunks)} 响应中没有 embedding 字段: {data}")
                return None
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Ollama 分片 {i+1}/{len(chunks)} 失败: {e}")
            return None
        except Exception as e:
            logger.error(f"Ollama 分片 {i+1}/{len(chunks)} 未知错误: {e}")
            return None
    
    return _mean_pool_vectors(embeddings)


def get_embedding(text: str) -> list:
    """
    获取文本的向量表示，优先使用负载均衡 Embed 服务，
    失败时自动降级到 Ollama 原生 API。
    
    Args:
        text (str): 需要向量化的文本
        
    Returns:
        list: 浮点数列表（向量），如果失败则返回 None
    """
    if not text or not text.strip():
        return None
        
    # 优先尝试负载均衡（OpenAI 兼容接口）
    if _embed_client:
        result = _get_embedding_via_openai(text)
        if result is not None:
            return result
        logger.warning("负载均衡 Embed 失败，降级到 Ollama 原生 API")
    
    # 降级到 Ollama 原生 API
    return _get_embedding_via_ollama(text)