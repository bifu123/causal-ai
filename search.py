"""
v5_search.py - 因果AI搜索模块

职责：执行搜索查询，支持全文检索和LIKE保底搜索
支持逻辑与（&）操作符，确保搜索结果的准确性和完整性

简化版本：只包含执行原始SQL查询的功能
"""

from typing import List, Dict, Any
from core.database import db
from v5 import V5Relev

# 创建算法实例
v5 = V5Relev()

# 保留原始的SQL查询字符串，以便其他模块使用
ORIGINAL_SQL = """
WITH target_val AS (
    -- 搜索职责定义：支持 & 逻辑与
    SELECT '平定村 & 命案'::text as raw_keyword
),
primary_search AS (
    -- 第一职责：全文检索
    SELECT root.* FROM ains_active_nodes root, target_val
    WHERE to_tsvector('chinese', root.event_tuple) @@ to_tsquery('chinese', target_val.raw_keyword)
),
fallback_search AS (
    -- 第二职责：LIKE 物理保底（处理逻辑与的顺序匹配）
    SELECT root.* FROM ains_active_nodes root, target_val
    WHERE root.event_tuple LIKE '%' || REPLACE(target_val.raw_keyword, ' & ', '%') || '%'
    AND NOT EXISTS (SELECT 1 FROM primary_search)
),
final_nodes AS (
    SELECT * FROM primary_search
    UNION ALL
    SELECT * FROM fallback_search
)
SELECT 
    root.serial_id,         -- 当前事件物理 ID
    -- 物理溯源：父节点的 serial_id
    COALESCE(
        (SELECT parent.serial_id::text 
         FROM ains_active_nodes parent 
         WHERE parent.node_id = root.parent_id), 
        '根节点'
    ) AS preview_id, 
    root.block_tag,         -- 因缘标签（归类板块）
    root.action_tag,        -- 动作标签（职责属性）
    root.event_tuple,       -- 动态笔记原文
    -- 物理演化：所有子节点的 serial_id 列表
    COALESCE((
        SELECT STRING_AGG(sub.serial_id::text, ', ') 
        FROM ains_active_nodes AS sub
        WHERE sub.parent_id = root.node_id
    ) , '末端') AS next_id_list  
FROM final_nodes AS root;
"""

# 用关键字搜索瞄定事件节点（带参数）
def get_event_with_params(keyword: str, owner_id: str = None, limit: int = None) -> Dict[str, Any]:
    """
    用关键字搜索瞄定事件节点（带参数）
    
    Args:
        keyword: 搜索关键词，支持逻辑与（&）操作符
        owner_id: 事件拥有者ID，如果为None则搜索所有事件
        limit: 返回结果数量限制，如果为None则返回所有行
        
    Returns:
        搜索结果列表，每个结果包含节点信息
    """
    # 清理关键词
    keyword = keyword.strip()
    if not keyword:
        return []
    
    # 构建SQL查询
    sql = f"""
WITH target_val AS (
    -- 搜索职责定义：支持 & 逻辑与
    SELECT '{keyword}'::text as raw_keyword
),
primary_search AS (
    -- 第一职责：全文检索
    SELECT root.* FROM ains_active_nodes root, target_val
    WHERE to_tsvector('chinese', root.event_tuple) @@ to_tsquery('chinese', target_val.raw_keyword)
    {'AND root.owner_id = \'' + owner_id + '\'' if owner_id else ''}
),
fallback_search AS (
    -- 第二职责：LIKE 物理保底（处理逻辑与的顺序匹配）
    SELECT root.* FROM ains_active_nodes root, target_val
    WHERE root.event_tuple LIKE '%' || REPLACE(target_val.raw_keyword, ' & ', '%') || '%'
    {'AND root.owner_id = \'' + owner_id + '\'' if owner_id else ''}
    AND NOT EXISTS (SELECT 1 FROM primary_search)
),
final_nodes AS (
    SELECT * FROM primary_search
    UNION ALL
    SELECT * FROM fallback_search
)
SELECT 
    root.serial_id,         -- 当前事件物理 ID
    root.event_tuple,       -- 动态笔记原文
    -- 物理溯源：父节点的 serial_id
    COALESCE(
        (SELECT parent.serial_id::text 
         FROM ains_active_nodes parent 
         WHERE parent.node_id = root.parent_id), 
        '根节点'
    ) AS preview_id, 
    root.block_tag,         -- 因缘标签（归类板块）
    root.action_tag,        -- 动作标签（职责属性）
    -- 物理演化：所有子节点的 serial_id 列表
    COALESCE((
        SELECT STRING_AGG(sub.serial_id::text, ', ') 
        FROM ains_active_nodes AS sub
        WHERE sub.parent_id = root.node_id
    ) , '末端') AS next_id_list,
    root.node_id,           -- 节点ID
    root.parent_id,         -- 父节点ID
    root.survival_weight,   -- 生存权重
    root.full_image_url,    -- 图片URL
    root.owner_id           -- 所有者ID
FROM final_nodes AS root
ORDER BY root.survival_weight DESC, root.last_accessed DESC
"""
    
    # 添加LIMIT子句
    if limit:
        sql += f"\nLIMIT {limit};"
    else:
        sql += ";"
    
    
    # try:
    #     with db.conn.cursor() as cur:
    #         cur.execute(sql)
    #         # 直接返回 fetchall()，它默认就是 List[tuple]
    #         rows = cur.fetchall()
    #         # 使用V5算法来排序
    #         # 拆解为V5期待的三元组
    #         nodes_sort = []
    #         for i in rows:
    #             nodes_sort.append((i[0], i[1], i[3]))
    #         # 添加相关度评分
    #         top_notes_desc = v5.get_top_relevant_notes(nodes_sort, keyword, limit=50, sort_desc=True, max_chars=10)
            

                
    #         return top_notes_desc
    # except Exception as e:
    #     print(f"[搜索错误] 执行元组搜索失败: {e}")
    #     return []
    
    
    try:
        with db.conn.cursor() as cur:
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description]
            results = []
            for row in cur.fetchall():
                result = dict(zip(columns, row))
                # 处理父节点ID字符串为列表
                if 'parent_id' in result and result['parent_id']:
                    result['parent_ids'] = db._string_to_parents(result['parent_id'])
                else:
                    result['parent_ids'] = []
                # 添加event_tuple字段的相关度评分
                if 'event_tuple' in result and result['event_tuple']:
                    result['score'] = v5.calculate_relevance_score(result['event_tuple'], keyword)
                results.append(result)
                # 将字典列表倒序排列
                results.sort(key=lambda x: x['score'], reverse=True)
            # 取相关度最高的第1条
            event_node = results[0]
            return event_node
        
    except Exception as e:
        print(f"[搜索错误] 执行搜索失败: {e}")
        return {}

# 用serial_id搜索瞄定事件节点
def get_event_by_sid(serial_id: int) -> Dict[str, Any]:
    """
    根据serial_id搜索事件节点
    
    Args:
        serial_id: 事件的物理序列ID
        
    Returns:
        事件节点信息字典，如果未找到则返回空字典
    """
    
    sql = f'''
WITH target_id AS (
    -- 在这里输入你要查询的物理 serial_id
    SELECT {serial_id}::int as sid 
)
SELECT 
    root.serial_id,         -- 当前事件物理 ID
    -- 物理溯源：获取父节点的 serial_id
    COALESCE(
        (SELECT parent.serial_id::text 
         FROM ains_active_nodes parent 
         WHERE parent.node_id = root.parent_id), 
        '根节点'
    ) AS preview_id, 
    root.block_tag,         -- 因缘标签
    root.action_tag,        -- 动作标签
    root.event_tuple,       -- 动态笔记原文
    -- 物理演化：聚合所有子节点的 serial_id 列表
    COALESCE(( 
        SELECT STRING_AGG(sub.serial_id::text, ', ') 
        FROM ains_active_nodes AS sub
        WHERE sub.parent_id = root.node_id
    ) , '末端') AS next_id_list,
    root.node_id,           -- 节点ID
    root.parent_id,         -- 父节点ID
    root.survival_weight,   -- 生存权重
    root.full_image_url,    -- 图片URL
    root.owner_id           -- 所有者ID
FROM ains_active_nodes root, target_id
WHERE root.serial_id = target_id.sid;
    '''
    try:
        with db.conn.cursor() as cur:
            cur.execute(sql)
            columns = [desc[0] for desc in cur.description]
            row = cur.fetchone()
            
            if row:
                result = dict(zip(columns, row))
                # 处理父节点ID字符串为列表
                if 'parent_id' in result and result['parent_id']:
                    result['parent_ids'] = db._string_to_parents(result['parent_id'])
                else:
                    result['parent_ids'] = []
                return result
            else:
                return {}
    except Exception as e:
        print(f"[搜索错误] 根据serial_id搜索失败: {e}")
        return {}



if __name__ == "__main__":

    
    q= get_event_with_params(keyword= "其来", owner_id= "worker", limit=100)
    print(q)

    # s = get_event_by_sid(263)
    # print(s)
    
