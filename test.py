def get_causal_skeleton(serial_id, actor_id=None):
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/skeleton"
    
    payload = {
        "serial_id": serial_id
    }
    
    if actor_id is not None:
        payload["actor_id"] = actor_id
    
    response = requests.post(url, json=payload)
    return response.json()

# 示例：获取serial_id为312的因果链骨架
result = get_causal_skeleton(312)
print(result)