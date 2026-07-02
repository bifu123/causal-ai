import re

with open('core/search.py', 'r', encoding='utf-8') as f:
    content = f.read()

vector_func = """
def get_event_with_vector(keyword: str, owner_id: str = None, limit: int = None) -> List[Dict[str, Any]]:
    \"\"\"
    用语义向量搜索瞄定事件节点。
    \"\"\"
    keyword = keyword.strip()
    if not keyword:
        return []
        
    from .embedding import get_embedding
    query_vector = get_embedding(keyword)
    if not query_vector:
        print(f"[搜索警告] 无法获取关键字 '{keyword}' 的向量")
        return []
    
    # 构建owner_id过滤条件
    owner_filter = ""
    params = []
    if owner_id:
        owner_filter = " AND root.owner_id = %s"
        params.append(owner_id)
        
    params.append(json.dumps(query_vector))
    
    sql = f'''
WITH search_base AS (
    SELECT 
        root.*,
        archive.raw_content,
        (root.event_tuple LIKE '%%[已提炼]') AS is_refined
    FROM ains_active_nodes root
    LEFT JOIN ains_archive_necropolis archive ON root.necropolis_id = archive.necropolis_id
    WHERE root.semantic_vector IS NOT NULL {owner_filter}
)
SELECT 
    root.serial_id,
    COALESCE(
        (SELECT parent.serial_id::text FROM ains_active_nodes parent WHERE parent.node_id = root.parent_id), 
        '根节点'
    ) AS preview_id, 
    root.block_tag, 
    root.action_tag, 
    CASE 
        WHEN root.is_refined AND root.raw_content IS NOT NULL THEN root.raw_content 
        ELSE root.event_tuple 
    END AS display_content,
    root.node_id,
    root.parent_id,
    root.survival_weight,
    root.full_image_url,
    root.owner_id,
    COALESCE((
        SELECT STRING_AGG(sub.serial_id::text, ', ') FROM ains_active_nodes AS sub WHERE sub.parent_id = root.node_id
    ) , '末端') AS next_id_list,
    1 - (root.semantic_vector <=> %s::vector) AS similarity
FROM search_base AS root
ORDER BY similarity DESC
    '''

    if limit:
        sql += f"\\nLIMIT {limit};"
    else:
        sql += ";"
      
    try:
        with db.conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            columns = [desc[0] for desc in cur.description]
            raw_results = cur.fetchall()
            
            agent_results = []
            for row in raw_results:
                raw_dict = dict(zip(columns, row))
                
                weight_val = float(raw_dict['survival_weight']) if isinstance(raw_dict['survival_weight'], Decimal) else raw_dict['survival_weight']
                display_content = raw_dict.get('display_content', raw_dict.get('event_tuple', ''))
                similarity = float(raw_dict['similarity']) if isinstance(raw_dict['similarity'], Decimal) else raw_dict['similarity']
                
                item = {
                    "serial_id": raw_dict['serial_id'],
                    "survival_weight": weight_val,
                    "node_id": raw_dict['node_id'],
                    "event_tuple": display_content,
                    "block_tag": raw_dict['block_tag'],
                    "action_tag": raw_dict['action_tag'],
                    "full_image_url": raw_dict['full_image_url'],
                    "owner_id": raw_dict['owner_id'],
                    "parent_id": raw_dict.get('parent_id'),
                    
                    "本事件ID": raw_dict['serial_id'],
                    "前事件ID列表": raw_dict['preview_id'] if raw_dict['preview_id'] != '根节点' else '',
                    "因缘标签": raw_dict['block_tag'],
                    "动作标签": raw_dict['action_tag'],
                    "事件二元组描述": display_content,
                    "后续事件ID列表": [int(x.strip()) for x in raw_dict['next_id_list'].split(',') if x.strip().isdigit()] if raw_dict['next_id_list'] and raw_dict['next_id_list'] != '末端' else [],
                    "本事件权重": weight_val,
                    "本事件标题": raw_dict['node_id'],
                    "截图": raw_dict['full_image_url'],
                    "事件拥有者": raw_dict['owner_id']
                }

                if raw_dict.get('parent_id'):
                    parent_titles = db._string_to_parents(raw_dict['parent_id'])
                    item["前事件标题列表"] = parent_titles
                    item["parent_ids"] = parent_titles
                else:
                    item["前事件标题列表"] = []
                    item["parent_ids"] = []
                    
                item["本事件相关度"] = similarity
                item["relevance_score"] = similarity
                
                agent_results.append(item)
            
            return agent_results
        
    except Exception as e:
        print(f"[搜索错误] 执行向量搜索失败: {e}")
        return []

# 以事件ID为参数获取事件详情和前后事件ID
"""

content = content.replace("# 以事件ID为参数获取事件详情和前后事件ID", vector_func)

with open('core/search.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched core/search.py")
