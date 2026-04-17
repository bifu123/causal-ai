# def get_causal_skeleton(serial_id, actor_id=None):
#     import requests
#     url = "http://192.168.66.39:8094/api/v1/causal/skeleton"
    
#     payload = {
#         "serial_id": serial_id
#     }
    
#     if actor_id is not None:
#         payload["actor_id"] = actor_id
    
#     response = requests.post(url, json=payload)
#     return response.json()

# # 示例：获取serial_id为312的因果链骨架
# result = get_causal_skeleton(312)
# print("因果链骨架结果:")
# print(result)

# 测试core/search.py中的get_event_with_params函数
def test_search_function():
    print("\n=== 测试搜索功能 ===")
    
    # 导入搜索模块
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    

    from core.search import get_event_with_params

    results = get_event_with_params(keyword="工作", owner_id="worker", limit=5)
    for item in results:
        if "事件二元组描述" in item:
            item["事件二元组描述"] = item["事件二元组描述"][:20]
        if "event_tuple" in item:
            item["event_tuple"] = item["event_tuple"][:20]


        

    return results


# 运行搜索测试
if __name__ == "__main__":
    import json
    print(json.dumps(test_search_function(),ensure_ascii=False,indent=4))
