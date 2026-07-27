#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
因果链 CLI 工具

用法：

# 向量搜索
python3 causal_cli.py search "商王祭祀"

python3 causal_cli.py search "商王祭祀" \
    --owner test \
    --limit 50 \
    --threshold 0.7

# 点击事件
python3 causal_cli.py click 312

python3 causal_cli.py click 312 \
    --owner test \
    --actor user2 \
    --eyes 40
"""

import argparse
import json
import os
import sys

import requests
from dotenv import load_dotenv

API = "http://aicity.wang:8094/api/v1/causal"


# -------------------------------------------------------
# 向量搜索
# -------------------------------------------------------

def cmd_search(args):

    payload = {
        "keyword": args.keyword,
        "owner_id": args.owner,
        "limit": args.limit,
    }

    if args.threshold > 0:
        payload["threshold"] = args.threshold

    r = requests.post(
        f"{API}/search/vector",
        json=payload,
        timeout=120,
    )

    result = r.json()

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if result.get("status") != "success":
        print("搜索失败：", result.get("message"))
        sys.exit(1)

    print(
        f"\n搜索到 {result.get('count',0)} 个事件"
        f" (threshold={result.get('threshold',args.threshold)})\n"
    )

    for i, item in enumerate(result.get("data", []), 1):

        print(f"[{i}] {item.get('node_id','')}")

        print(f"    serial_id : {item.get('serial_id')}")

        print(
            f"    score     : "
            f"{item.get('relevance_score',0):.2f}"
        )

        print(
            f"    similarity: "
            f"{item.get('vector_similarity',0):.4f}"
        )

        print(
            f"    action    : "
            f"{item.get('action_tag','')}   "
            f"{item.get('block_tag','')}"
        )

        text = item.get("event_tuple", "")
        if len(text) > 120:
            text = text[:120] + "..."

        print("    event     :", text)
        print()


# -------------------------------------------------------
# 点击事件
# -------------------------------------------------------

def cmd_click(args):

    load_dotenv()

    max_eyes = args.eyes

    if max_eyes is None:
        max_eyes = float(os.getenv("MAX_EYES", 30))

    payload = {
        "serial_id": args.serial,
        "owner_id": args.owner,
        "actor_id": args.actor,
        "max_eyes": max_eyes,
    }

    r = requests.post(
        f"{API}/click",
        json=payload,
        timeout=120,
    )

    result = r.json()

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if result.get("status") != "success":
        print("聚焦失败：", result.get("message"))
        sys.exit(1)

    anchor = result.get("data", {})

    print("\n==============================")
    print("        大股东节点")
    print("==============================")

    print("事件：", anchor.get("node_id"))

    print("序号：", anchor.get("serial_id"))

    print(
        "权重：",
        f"{anchor.get('survival_weight',0):.2%}"
    )

    print(
        "动作：",
        anchor.get("action_tag"),
        "|",
        anchor.get("block_tag"),
    )

    print()

    text = anchor.get("event_tuple", "")

    print(text)

    print()

    print("前事件：", anchor.get("parent_ids", []))

    print("前事件中首事件：", anchor.get("preview_id"))

    print("后事件：", anchor.get("next_ids", []))

    print()

    horizon = result.get("event_horizon_details", [])

    print(
        f"========== 事件视界 "
        f"(MAX_EYES={result.get('max_eyes')}) =========="
    )

    if not horizon:
        print("(无其它节点)")
    else:
        for node in horizon:

            dist = node.get("distance")

            title = node.get("node_id")

            event = node.get("event_tuple", "")

            if len(event) > 100:
                event = event[:100] + "..."

            print(
                f"[{dist:5.1f}] {title}"
            )

            print("      ", event)

    print()

    print(
        "更新节点：",
        result.get("updated_count", 0)
    )


# -------------------------------------------------------
# CLI
# -------------------------------------------------------

def main():

    parser = argparse.ArgumentParser(
        description="因果链 CLI"
    )

    sub = parser.add_subparsers(dest="cmd")
    sub.required = True

    # search
    p = sub.add_parser(
        "search",
        help="向量搜索事件"
    )

    p.add_argument("keyword")

    p.add_argument(
        "--owner",
        default="test",
    )

    p.add_argument(
        "--limit",
        type=int,
        default=100,
    )

    p.add_argument(
        "--threshold",
        type=float,
        default=0.0,
    )

    p.add_argument(
        "--json",
        action="store_true",
        help="输出JSON"
    )

    p.set_defaults(func=cmd_search)

    # click
    p = sub.add_parser(
        "click",
        help="聚焦事件"
    )

    p.add_argument(
        "serial",
        type=int,
    )

    p.add_argument(
        "--owner",
        default="test",
    )

    p.add_argument(
        "--actor",
        default="415135222",
    )

    p.add_argument(
        "--eyes",
        type=float,
    )

    p.add_argument(
        "--json",
        action="store_true",
    )

    p.set_defaults(func=cmd_click)

    args = parser.parse_args()

    args.func(args)


if __name__ == "__main__":
    main()