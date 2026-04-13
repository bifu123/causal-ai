"""
v5_search.py - 因果AI搜索模块 (Agent 友好版)

职责：
1. 执行高召回率的因果节点搜索。
2. 将底层数据库字段映射为 Agent 易于理解的中文语义键。
3. 维护 AINS 节点的物理类型完整性。
"""

from typing import List, Dict, Any
from .database import db
from v5 import V5Relev
import os
import json
from decimal import Decimal
from dotenv import load_dotenv

load_dotenv()

# 创建算法实例
v5 = V5Relev()


def get_event_with_params(keyword: str, owner_id: str = None, limit: int = None) -> List[Dict[str, Any]]:
    """
    用关键字搜索瞄定事件节点，并输出 Agent 友好型格式
    """
    keyword = keyword.strip()
    if not keyword:
        return []
    
    # 保持底层 SQL 高效运行
    sql = f"""
WITH RECURSIVE target_val AS (
    SELECT '{keyword}'::text as raw_keyword
),
tokenized_val AS (
    SELECT string_agg(token, ' & ') as adaptive_keyword
    FROM ts_debug('chinese', (SELECT raw_keyword FROM target_val))
    WHERE alias != 'blank'
),
primary_search AS (
    SELECT root.*, 1 as search_rank FROM ains_active_nodes root, target_val
    WHERE to_tsvector('chinese', root.event_tuple) @@ plainto_tsquery('chinese', target_val.raw_keyword)
    {'AND root.owner_id = \'' + owner_id + '\'' if owner_id else ''}
),
adaptive_search AS (
    SELECT root.*, 2 as search_rank FROM ains_active_nodes root, tokenized_val
    WHERE NOT EXISTS (SELECT 1 FROM primary_search)
      AND to_tsvector('chinese', root.event_tuple) @@ to_tsquery('chinese', tokenized_val.adaptive_keyword)
      {'AND root.owner_id = \'' + owner_id + '\'' if owner_id else ''}
),
fallback_search AS (
    SELECT root.*, 3 as search_rank FROM ains_active_nodes root, target_val
    WHERE NOT EXISTS (SELECT 1 FROM primary_search)
      AND NOT EXISTS (SELECT 1 FROM adaptive_search)
      AND root.event_tuple LIKE ALL (
          SELECT '%' || trim(word) || '%' 
          FROM unnest(string_to_array((SELECT raw_keyword FROM target_val), ' ')) AS word
      )
      {'AND root.owner_id = \'' + owner_id + '\'' if owner_id else ''}
),
final_nodes AS (
    SELECT * FROM primary_search
    UNION ALL
    SELECT * FROM adaptive_search
    UNION ALL
    SELECT * FROM fallback_search
)
SELECT 
    root.serial_id,
    COALESCE(
        (SELECT parent.serial_id 
         FROM ains_active_nodes parent 
         WHERE parent.node_id = root.parent_id), 
        0
    ) AS preview_id, 
    root.block_tag,
    root.action_tag,
    root.event_tuple,
    COALESCE((
        SELECT STRING_AGG(sub.serial_id::text, ',') 
        FROM ains_active_nodes AS sub
        WHERE sub.parent_id = root.node_id
    ) , '') AS next_id_list,
    root.survival_weight as db_score,
    root.node_id,
    root.parent_id,
    root.full_image_url,
    root.owner_id
FROM final_nodes AS root
ORDER BY search_rank ASC, root.survival_weight DESC
"""
    
    if limit:
        sql += f"\nLIMIT {limit};"
    else:
        sql += ";"
      
    try:
        with db.conn.cursor() as cur:
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description]
            raw_results = cur.fetchall()
            
            agent_results = []
            for row in raw_results:
                raw_dict = dict(zip(columns, row))
                
                # 核心映射职责：将原始字段映射为 Agent 中文键名
                item = {
                    "本事件ID": raw_dict['serial_id'],
                    "前事件ID列表": raw_dict['preview_id'], # 物理回溯单点
                    "因缘标签": raw_dict['block_tag'],
                    "动作标签": raw_dict['action_tag'],
                    "事件二元组描述": raw_dict['event_tuple'],
                    "后续事件ID列表": [int(x) for x in raw_dict['next_id_list'].split(',')] if raw_dict['next_id_list'] else [],
                    "本事件权重": float(raw_dict['db_score']) if isinstance(raw_dict['db_score'], Decimal) else raw_dict['db_score'],
                    "本事件标题": raw_dict['node_id'],
                    "截图": raw_dict['full_image_url'],
                    "事件拥有者": raw_dict['owner_id']
                }

                # 处理父节点（前事件标题列表）
                if raw_dict.get('parent_id'):
                    item["前事件标题列表"] = db._string_to_parents(raw_dict['parent_id'])
                else:
                    item["前事件标题列表"] = []
                    
                # 计算算法相关度
                res_score = v5.calculate_relevance_score(raw_dict['event_tuple'], keyword)
                item["本事件相关度"] = float(res_score) if isinstance(res_score, Decimal) else res_score
                
                agent_results.append(item)
            
            # 排序职责：按 Agent 最关心的相关度排列
            agent_results.sort(key=lambda x: x['本事件相关度'], reverse=True)
            
            # 环境容量控制
            max_chats = int(os.getenv("MAX_CHATS", 30))
            while len(agent_results) > max_chats and len(agent_results) > 1:
                min_idx = min(range(len(agent_results)), key=lambda i: agent_results[i]['本事件相关度'])
                agent_results.pop(min_idx)
                    
            return agent_results
        
    except Exception as e:
        print(f"[搜索错误] 执行搜索失败: {e}")
        return []

def get_event_by_sid(serial_id: int) -> Dict[str, Any]:
    """
    根据 serial_id 获取 Agent 友好型节点数据
    """
    sql = f'''
SELECT 
    root.serial_id,
    COALESCE(
        (SELECT parent.serial_id FROM ains_active_nodes parent 
         WHERE parent.node_id = root.parent_id), 0
    ) AS preview_id, 
    root.block_tag, root.action_tag, root.event_tuple,
    COALESCE((SELECT STRING_AGG(sub.serial_id::text, ',') FROM ains_active_nodes AS sub WHERE sub.parent_id = root.node_id), '') AS next_id_list,
    root.node_id, root.parent_id, root.survival_weight, root.full_image_url, root.owner_id
FROM ains_active_nodes root
WHERE root.serial_id = {serial_id};
    '''
    try:
        with db.conn.cursor() as cur:
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description]
            row = cur.fetchone()
            if row:
                d = dict(zip(columns, row))
                return {
                    "本事件ID": d['serial_id'],
                    "前事件ID列表": d['preview_id'],
                    "因缘标签": d['block_tag'],
                    "动作标签": d['action_tag'],
                    "事件二元组描述": d['event_tuple'],
                    "后续事件ID列表": [int(x) for x in d['next_id_list'].split(',')] if d['next_id_list'] else [],
                    "本事件权重": float(d['survival_weight']) if isinstance(d['survival_weight'], Decimal) else d['survival_weight'],
                    "本事件标题": d['node_id'],
                    "截图": d['full_image_url'],
                    "事件拥有者": d['owner_id'],
                    "前事件标题列表": db._string_to_parents(d['parent_id']) if d['parent_id'] else []
                }
            return {}
    except Exception as e:
        print(f"[搜索错误] 根据serial_id获取失败: {e}")
        return {}

if __name__ == "__main__":
    while True:
        query = input("请输入事件关键字：")
        response = get_event_with_params(keyword=query, owner_id="worker", limit=100)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        



