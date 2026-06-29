"""
更新向量脚本 (update_vectors.py)

示例用法:
1. 仅更新缺失向量的节点 (默认):
   python update_vectors.py

2. 强制重新计算并更新所有节点的向量:
   python update_vectors.py --all

3. 仅更新指定 owner_id 且缺失向量的节点:
   python update_vectors.py --owner <owner_id>
   例如: python update_vectors.py --owner user123

4. 强制重新计算并更新指定 owner_id 的所有节点向量:
   python update_vectors.py --all --owner <owner_id>
   例如: python update_vectors.py --all --owner user123
"""

import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from core.embedding import get_embedding

# 加载环境变量
load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "192.168.66.39"),
    "database": os.getenv("DB_DATABASE", "causal_ai_db"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "Shift962512"),
    "port": os.getenv("DB_PORT", 5432)
}


def update_vectors(force_all=False, owner_id=None):
    """
    更新语义向量，使用新的嵌入格式：node_id + "。" + event_tuple

    Args:
        force_all: 如果为 True，强制重新计算所有节点的向量（包括已有向量的）
        owner_id: 仅处理指定的 owner_id
    """
    mode_desc = "强制重算所有" if force_all else "仅缺失"
    print(f"开始更新向量数据（{mode_desc}）...")

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.set_client_encoding('UTF8')

        # 1. 查找需要更新的节点
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if force_all:
                sql = "SELECT serial_id, node_id, event_tuple FROM ains_active_nodes WHERE semantic_vector IS NOT NULL"
                if owner_id:
                    sql += " AND owner_id = %s"
                    cur.execute(sql, (owner_id,))
                else:
                    cur.execute(sql)
            else:
                sql = "SELECT serial_id, node_id, event_tuple FROM ains_active_nodes WHERE semantic_vector IS NULL"
                if owner_id:
                    sql += " AND owner_id = %s"
                    cur.execute(sql, (owner_id,))
                else:
                    cur.execute(sql)
            nodes = cur.fetchall()

        if not nodes:
            print("没有节点需要更新。")
            return

        print(f"找到 {len(nodes)} 个节点需要更新向量，开始生成并更新...")

        success_count = 0
        fail_count = 0

        # 2. 遍历节点，生成向量并更新
        for node in nodes:
            serial_id = node['serial_id']
            node_id = node['node_id']
            event_tuple = node['event_tuple']

            # 将 node_id 拼在 event_tuple 前面，防止短文本退化
            # 例如：之前 "书法是一种艺术" → 现在 "F节点：书法和写字的区别。书法是一种艺术"
            text_to_embed = f"{node_id}。{event_tuple}" if event_tuple and event_tuple.strip() else node_id

            # 限制最大长度，防止极端情况导致 Ollama 崩溃
            if len(text_to_embed) > 8000:
                print(f"警告: 节点 [{serial_id}] 文本过长 ({len(text_to_embed)} 字符)，将截断至 8000 字符。")
                text_to_embed = text_to_embed[:8000]

            print(f"正在处理节点 [{serial_id}] {node_id} (嵌入文本长度={len(text_to_embed)})...")

            # 生成向量
            vector = get_embedding(text_to_embed)

            # 降级策略：如果拼接版本失败，尝试仅使用 node_id
            if not vector and text_to_embed != node_id:
                print(f"  -> 使用完整嵌入文本失败，尝试降级使用 node_id...")
                vector = get_embedding(node_id)

            if vector:
                with conn.cursor() as cur:
                    cur.execute("""
                        UPDATE ains_active_nodes
                        SET semantic_vector = %s
                        WHERE serial_id = %s
                    """, (vector, serial_id))
                conn.commit()
                success_count += 1
                print(f"  -> 成功更新向量")
            else:
                fail_count += 1
                print(f"  -> 生成向量失败")

        print(f"\n更新完成！成功: {success_count}, 失败: {fail_count}")

    except Exception as e:
        print(f"发生错误: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()


if __name__ == "__main__":
    force_all = '--all' in sys.argv
    owner_id = None
    for i, arg in enumerate(sys.argv):
        if arg == '--owner' and i + 1 < len(sys.argv):
            owner_id = sys.argv[i + 1]
            break
    update_vectors(force_all=force_all, owner_id=owner_id)