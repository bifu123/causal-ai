import re

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

vector_api = """
# --- 搜索接口：向量搜索 ---
@app.post("/api/v1/causal/search/vector")
async def search_by_vector(search_data: dict):
    \"\"\"
    职责：根据关键字的语义向量搜索事件节点
    支持参数：
        keyword: 搜索关键词（自然语言描述）
        owner_id: 事件拥有者ID，如果为None则搜索所有事件
        limit: 返回结果数量限制，如果为None则返回所有行
    \"\"\"
    try:
        keyword = search_data.get('keyword')
        owner_id = search_data.get('owner_id', 'default')
        limit = search_data.get('limit', 100)
        
        if not keyword:
            return {"status": "error", "message": "缺少搜索关键词"}
        
        # 导入搜索模块
        from core.search import get_event_with_vector
        
        # 执行搜索
        results = get_event_with_vector(keyword, owner_id, limit)
        
        # 将中文键名转换为英文键名，以便与前端保持一致
        converted_results = []
        for result in results:
            converted = {
                "serial_id": result.get("本事件ID"),
                "node_id": result.get("本事件标题"),
                "event_tuple": result.get("事件二元组描述"),
                "survival_weight": result.get("本事件权重"),
                "block_tag": result.get("因缘标签"),
                "action_tag": result.get("动作标签"),
                "full_image_url": result.get("截图"),
                "owner_id": result.get("事件拥有者"),
                "parent_ids": result.get("前事件标题列表", []),
                "preview_id": result.get("前事件ID列表"),
                "next_ids": result.get("后续事件ID列表", []),
                "relevance_score": result.get("本事件相关度", 0)
            }
            converted_results.append(converted)
            
        return {
            "status": "success",
            "data": converted_results,
            "count": len(converted_results),
            "keyword": keyword,
            "owner_id": owner_id
        }
    except Exception as e:
        print(f"[API 错误] 向量搜索失败: {e}")
        return {"status": "error", "message": str(e)}

# --- 搜索接口：序列ID搜索 ---
"""

content = content.replace("# --- 搜索接口：序列ID搜索 ---", vector_api)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched main.py")
