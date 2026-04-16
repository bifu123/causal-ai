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

# 以关键字搜索获取相关事件节点
def get_event_with_params(keyword: str, owner_id: str = None, limit: int = None) -> List[Dict[str, Any]]:
    """
    用关键字搜索瞄定事件节点，并输出 Agent 友好型格式
    """
    keyword = keyword.strip()
    if not keyword:
        return []
    
    # 构建owner_id过滤条件
    owner_filter = ""
    if owner_id:
        owner_filter = f" AND root.owner_id = '{owner_id}'"
    
    # 保持底层 SQL 高效运行
    sql = f"""
WITH target_val AS (
    -- 搜索职责定义：支持 & 逻辑与
    SELECT '{keyword}'::text as raw_keyword
),
primary_search AS (
    -- 第一职责：全文检索（合并 node_id 和 event_tuple）
    SELECT root.* FROM ains_active_nodes root, target_val
    WHERE to_tsvector('chinese', root.node_id || ' ' || root.event_tuple) 
       @@ to_tsquery('chinese', target_val.raw_keyword)
       {owner_filter}
),
fallback_search AS (
    -- 第二职责：LIKE 物理保底（处理逻辑与的顺序匹配，同时检索 ID 和原文）
    SELECT root.* FROM ains_active_nodes root, target_val
    WHERE (
        root.event_tuple LIKE '%' || REPLACE(target_val.raw_keyword, ' & ', '%') || '%'
        OR 
        root.node_id LIKE '%' || REPLACE(target_val.raw_keyword, ' & ', '%') || '%'
    )
    {owner_filter}
    AND NOT EXISTS (SELECT 1 FROM primary_search)
),
final_nodes AS (
    SELECT * FROM primary_search
    UNION ALL
    SELECT * FROM fallback_search
)
SELECT 
    root.serial_id,          -- 当前事件物理 ID
    -- 物理溯源：父节点的 serial_id
    COALESCE(
        (SELECT parent.serial_id::text 
         FROM ains_active_nodes parent 
         WHERE parent.node_id = root.parent_id), 
        '根节点'
    ) AS preview_id, 
    root.block_tag,          -- 板块标签
    root.action_tag,         -- 职责属性
    root.event_tuple,        -- 动态笔记原文
    -- 物理演化：所有子节点的 serial_id 列表
    COALESCE((
        SELECT STRING_AGG(sub.serial_id::text, ', ') 
        FROM ains_active_nodes AS sub
        WHERE sub.parent_id = root.node_id
    ) , '末端') AS next_id_list,
    root.node_id,
    root.parent_id,
    root.survival_weight,
    root.full_image_url,
    root.owner_id
FROM final_nodes AS root
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
                     
                item = {
                    "本事件ID": raw_dict['serial_id'],
                    "前事件ID列表": raw_dict['preview_id'] if raw_dict['preview_id'] != '根节点' else '',
                    "因缘标签": raw_dict['block_tag'],
                    "动作标签": raw_dict['action_tag'],
                    "事件二元组描述": raw_dict['event_tuple'],
                    "后续事件ID列表": [int(x.strip()) for x in raw_dict['next_id_list'].split(',') if x.strip().isdigit()] if raw_dict['next_id_list'] and raw_dict['next_id_list'] != '末端' else [],
                    "本事件权重": float(raw_dict['survival_weight']) if isinstance(raw_dict['survival_weight'], Decimal) else raw_dict['survival_weight'],
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

# 以事件ID为参数获取事件详情和前后事件ID
def get_event_by_sid(serial_id: int, actor_id: str = None) -> Dict[str, Any]:
    """
    根据 serial_id 获取 Agent 友好型节点数据
    如果提供 actor_id，返回用户个性化权重；否则返回全局权重
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
                
                # 获取权重：如果提供actor_id，优先使用用户权重
                weight = float(d['survival_weight']) if isinstance(d['survival_weight'], Decimal) else d['survival_weight']
                
                if actor_id:
                    # 查询用户权重表
                    user_weight = db.get_user_weight(actor_id, serial_id)
                    if user_weight is not None:
                        weight = user_weight
                        print(f"[搜索调试] 使用用户 {actor_id} 的个性化权重: {weight} (serial_id: {serial_id})")
                    else:
                        print(f"[搜索调试] 用户 {actor_id} 没有个性化权重，使用全局权重: {weight} (serial_id: {serial_id})")
                
                return {
                    "本事件ID": d['serial_id'],
                    "前事件ID列表": d['preview_id'],
                    "因缘标签": d['block_tag'],
                    "动作标签": d['action_tag'],
                    "事件二元组描述": d['event_tuple'],
                    "后续事件ID列表": [int(x) for x in d['next_id_list'].split(',')] if d['next_id_list'] else [],
                    "本事件权重": weight,
                    "本事件标题": d['node_id'],
                    "截图": d['full_image_url'],
                    "事件拥有者": d['owner_id'],
                    "前事件标题列表": db._string_to_parents(d['parent_id']) if d['parent_id'] else [],
                    "观察者用户": actor_id if actor_id else None  # 添加观察者用户信息
                }
            return {}
    except Exception as e:
        print(f"[搜索错误] 根据serial_id获取失败: {e}")
        return {}

# 以事件ID为参数获取事件链因果骨架
def get_event_skeleton(serial_id: int, actor_id: str = None) -> List[Dict[str, Any]]:
    """
    因果链事件节点全息图（因果链骨架）。有助于 Agent 了解某因事链总体结构，从而决定获取事件数据的策略
    程序实现逻辑：1. 溯源全连通图 -> 2. 映射字段并剔除冗余 -> 3. 识别根节点（首层）-> 4. 递归嵌套-> 5. 返回因果骨架

    Args:
        serial_id: int - 事件的物理序号ID
        actor_id: 观察者ID（意志主体），为 None 时没有观察者注入的主观权重
    Return:
        因果链全息图骨架
    """
    # 1. 递归 SQL：全向抓取该连通图内所有的 serial_id (分段递归避开 PostgreSQL 语法限制)
    sql = f'''
    WITH RECURSIVE 
    ancestors AS (
        SELECT node_id, parent_id, serial_id FROM ains_active_nodes WHERE serial_id = {serial_id}
        UNION
        SELECT n.node_id, n.parent_id, n.serial_id FROM ains_active_nodes n
        JOIN ancestors a ON n.node_id = a.parent_id
    ),
    all_related AS (
        SELECT * FROM ancestors
        UNION
        SELECT n.node_id, n.parent_id, n.serial_id FROM ains_active_nodes n
        JOIN all_related ar ON n.parent_id = ar.node_id
    )
    SELECT DISTINCT serial_id FROM all_related;
    '''

    try:
        with db.conn.cursor() as cur:
            cur.execute(sql)
            all_sids = [row[0] for row in cur.fetchall()]
            
            if not all_sids:
                return []

            # 2. 映射字段并精简数据量
            nodes_data = []
            for sid in all_sids:
                # 严格调用 get_event_by_sid
                node_detail = get_event_by_sid(sid, actor_id)
                if node_detail:
                    # 职责：剔除长文本描述，大幅节省返回 Token
                    node_detail.pop("事件二元组描述", None)
                    # 初始化骨架嵌套容器
                    node_detail["子事件列表"] = [] 
                    nodes_data.append(node_detail)

            # 3. 构建内存索引
            node_map = {n["本事件ID"]: n for n in nodes_data}
            roots = []

            # 4. 执行层级组装
            for node in sorted(nodes_data, key=lambda x: x["本事件ID"]):
                curr_id = node["本事件ID"]
                
                # --- 统一化处理：确保“前事件ID列表”始终为数字列表 ---
                raw_p_ids = node.get("前事件ID列表")
                
                if isinstance(raw_p_ids, (int, float)):
                    p_ids = [int(raw_p_ids)] if raw_p_ids != 0 else []
                elif isinstance(raw_p_ids, list):
                    # 过滤掉 0 或 None，确保元素为纯数字
                    p_ids = [int(p) for p in raw_p_ids if p and p != 0]
                else:
                    p_ids = []
                
                # 更新节点数据中的“前事件ID列表”，统一 NULL/0 为 []
                node["前事件ID列表"] = p_ids

                # 判定是否为“首层根节点”：
                # 条件：前事件列表为空，或者父 ID 均不在本次抓取的网络中
                if not p_ids or not any(p_id in node_map for p_id in p_ids):
                    if node not in roots:
                        roots.append(node)
                else:
                    # 递归嵌套：挂载到所有有效的父节点下
                    for p_id in p_ids:
                        if p_id in node_map:
                            parent_node = node_map[p_id]
                            # 避免多因交汇导致的子节点重复挂载
                            if not any(child["本事件ID"] == curr_id for child in parent_node["子事件列表"]):
                                parent_node["子事件列表"].append(node)

            return roots 

    except Exception as e:
        print(f"[寻龙递归错误] 无法构建 serial_id {serial_id} 的嵌套 JSON: {e}")
        return []


if __name__ == "__main__":
    while True:
        query = input("请输入事件关键字：")
        response = get_event_with_params(keyword=query, owner_id="worker", limit=100)
        print(json.dumps(response, ensure_ascii=False, indent=2))
