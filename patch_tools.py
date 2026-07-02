import re

with open('tools.py', 'r', encoding='utf-8') as f:
    content = f.read()

new_func = """
## 从向量搜索事件列表
def search_causal_by_embed(keyword, owner_id='222302526', limit=100):
    \"\"\"
    根据关键字的语义向量搜索事件列表
    
    参数:
    - keyword (str): 搜索关键词（自然语言描述）
    - owner_id (str, optional): 事件拥有者ID，如果为None则搜索所有事件
    - limit (int, optional): 返回结果数量限制，默认为100
    
    返回:
    - dict: API响应结果，包含搜索结果列表，结构与search_causal_by_keyword相同
    
    注意:
    - 搜索算法采用向量相似度匹配：
      1. 将关键词转换为语义向量
      2. 在向量数据库中搜索最相似的事件节点
    - 搜索结果按相关度（余弦相似度）排序
    
    示例:
    # 搜索语义上与"商王祭祀"相关的事件
    results = search_causal_by_embed("商王祭祀")
    for item in results.get('data', []):
        print(f"事件标题: {item['node_id']}, 相关度: {item['relevance_score']}")
    \"\"\"
    import requests

    url = "http://127.0.0.1:8094/api/v1/causal/search/vector"
    
    payload = {
        "keyword": keyword
    }
    
    if owner_id is not None:
        payload["owner_id"] = owner_id
    
    if limit is not None:
        payload["limit"] = limit
    
    response = requests.post(url, json=payload)
    result = response.json()
    
    if result.get('status') == 'success':
        print(f"搜索到 {result.get('count', 0)} 个相关事件")
    else:
        print(f"搜索失败: {result.get('message')}")
    
    return result

## 点击事件"""

content = content.replace("## 点击事件", new_func)

with open('tools.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched tools.py")
