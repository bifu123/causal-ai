#*************************
#                        #
#  因果推理和数据操作工具  #
#                        #
#*************************

## 从关键字搜索事件列表
def search_causal_by_keyword(keyword, owner_id='cbf', limit=100):
    """
    根据关键字搜索事件列表
    
    参数:
    - keyword (str): 搜索关键词，支持逻辑与（&）操作符
    - owner_id (str, optional): 事件拥有者ID，如果为None则搜索所有事件
    - limit (int, optional): 返回结果数量限制，默认为100
    
    返回:
    - dict: API响应结果，包含搜索结果列表
    
    注意:
    - 搜索算法采用三级召回策略：
      1. 精确匹配：使用PostgreSQL全文搜索
      2. 自适应匹配：对关键词进行分词后搜索
      3. 回退匹配：使用LIKE模糊匹配
    - 搜索结果按相关度排序，相关度由V5算法计算
    
    示例:
    # 搜索所有包含"商王"的事件
    results = search_causal_by_keyword("商王")
    for item in results.get('data', []):
        print(f"事件标题: {item['node_id']}, 相关度: {item['relevance_score']}")
    
    # 搜索特定用户的事件
    results = search_causal_by_keyword("祭祀", owner_id="worker", limit=50)
    """
    import requests

    url = "http://192.168.66.39:8094/api/v1/causal/search/keyword"
    
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

## 点击事件
def search_causal_by_serial(serial_id, actor_id=None, owner_id="cbf"):
    """
    处理节点点击事件（执行完整的点击操作）
    
    参数:
    - serial_id (int): 事件节点的物理ID
    - actor_id (str, optional): 用户ID，用于个性化权重更新
    - owner_id (str, optional): 事件拥有者ID，默认为"cbf"
    
    返回:
    - dict: API响应结果，包含更新后的事件数据
    
    注意:
    - 此函数执行完整的点击事件处理流程：
      1. 获取节点基本信息
      2. 从地宫恢复内容（如果存在）
      3. 提升节点权重到60%（大股东模式）
      4. 重新计算其他节点权重
      5. 通过Socket.IO实时更新到前端
    - 如果提供actor_id参数，权重更新只影响用户权重表（ains_user_weights），
      不影响全局权重表（ains_active_nodes）
    - 此函数会触发实时更新，所有连接到观测站的客户端都会收到更新通知
    
    示例:
    # 处理serial_id为123的节点点击（全局权重更新）
    result = search_causal_by_serial(123)
    if result.get('status') == 'success':
        event = result.get('data')
        print(f"节点 {event['node_id']} 权重已提升到60%")
        print(f"共更新了 {result.get('updated_count', 0)} 个节点")
    
    # 处理serial_id为123的节点点击（用户个性化权重更新）
    result = search_causal_by_serial(123, actor_id="user2", owner_id="cbf")
    if result.get('status') == 'success':
        event = result.get('data')
        print(f"用户 user2 的节点 {event['node_id']} 权重已提升到60%")
        print(f"观察者用户: {event.get('actor_id')}")
        print(f"事件拥有者: {event.get('owner_id')}")
    else:
        print(f"点击处理失败: {result.get('message')}")
    """
    import requests

    url = "http://192.168.66.39:8094/api/v1/causal/click"
    
    payload = {
        "serial_id": serial_id,
        "owner_id": owner_id
    }
    
    if actor_id is not None:
        payload["actor_id"] = actor_id
    
    response = requests.post(url, json=payload)
    result = response.json()
    
    if result.get('status') == 'success':
        event = result.get('data', {})
        print(f"点击处理成功: {event.get('node_id', '未知节点')}")
        print(f"权重提升到: {event.get('survival_weight', 0):.2%}")
        print(f"更新节点数: {result.get('updated_count', 0)}")
        if actor_id:
            print(f"用户个性化权重已更新")
    else:
        print(f"点击处理失败: {result.get('message')}")
    
    return result

## 记录因果数据
def trigger_causal_node(node_id, action_tag, block_tag, event_tuple, parent_id=None, full_image_url=None, owner_id="cbf"):
    """
    进行因果事件记录
    
    参数:
    - node_id (str): 事件的唯一标识（建议使用因果描述）
    - action_tag (str): 动作标签，可选值：贞、又贞、对贞
    - block_tag (str): 因缘标签，可选值：因、相、果
    - event_tuple (str): 事件二元组内容描述
    - parent_id (str/list, optional): 父事件ID，可以是单个字符串或列表（多父事件），默认为None（首贞）
    - full_image_url (str, optional): 全息图片URL，默认为None
    - owner_id (str, optional): 事件拥有者ID，默认为"cbf"
    
    返回:
    - dict: API响应结果
    
    参数示例:
    # 发起首贞（事件链的初始事件）
    trigger_causal_node(
        node_id="王占曰：吉，其来",
        action_tag="贞",
        block_tag="因",
        event_tuple="那一天阴云密布...",
        full_image_url="uploads/raw/zhen.png",
        owner_id="worker"
    )
    
    # 发起又贞（事件链的中间事件）
    trigger_causal_node(
        node_id="丙申，王占曰：吉",
        action_tag="又贞",
        block_tag="因",
        event_tuple="不觉到了丙申那天...",
        parent_id="王占曰：吉，其来",
        owner_id="worker"
    )
    
    # 发起对贞（事件链的结果事件）
    trigger_causal_node(
        node_id="旬有二日，方来",
        action_tag="对贞",
        block_tag="果",
        event_tuple="终于在距离首贞十二天后...",
        parent_id="丙申，王占曰：吉",
        owner_id="worker"
    )
    """
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/genesis"
    
    payload = {
        "node_id": node_id,
        "parent_id": parent_id,
        "block_tag": block_tag,
        "action_tag": action_tag,
        "event_tuple": event_tuple,
        "owner_id": owner_id
    }
    
    if full_image_url:
        payload["full_image_url"] = full_image_url
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"Status: {result}")
    return result

## 修改因果数据事件节点
def update_causal_node(old_node_id, new_node_id, event_tuple=None, full_image_url=None, 
                       parent_ids=None, action_tag=None, block_tag=None, owner_id="cbf"):
    """
    编辑因果事件
    
    参数:
    - old_node_id (str): 原始事件ID
    - new_node_id (str): 新事件ID（如果要修改事件ID）
    - event_tuple (str, optional): 新的事件叙述
    - full_image_url (str, optional): 新的图片URL
    - parent_ids (str/list, optional): 新的父事件ID列表，可以是字符串（|分隔）或列表
    - action_tag (str, optional): 新的动作标签
    - block_tag (str, optional): 新的因缘标签
    - owner_id (str, optional): 事件拥有者ID，默认为"cbf"
    
    返回:
    - dict: API响应结果
    
    注意:
    - 如果parent_ids为空字符串或空列表，事件将变为首贞（动作标签自动设为"贞"，因缘标签自动设为"因"）
    - 如果修改了node_id，所有子事件的parent_id将自动更新
    
    示例:
    # 修改事件叙述
    update_causal_node(
        old_node_id="王占曰：吉，其来",
        new_node_id="王占曰：吉，其来",  # 不修改ID
        event_tuple="更新后的事件叙述..."
    )
    
    # 修改事件ID和父事件
    update_causal_node(
        old_node_id="王占曰：吉，其来",
        new_node_id="更新后的事件ID",
        parent_ids=["父事件1", "父事件2"]
    )
    
    # 将事件变为首贞（清空父事件）
    update_causal_node(
        old_node_id="某个事件",
        new_node_id="某个事件",
        parent_ids=""  # 或 [] 或 None
    )
    """
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/update"
    
    payload = {
        "old_node_id": old_node_id,
        "new_node_id": new_node_id,
        "owner_id": owner_id
    }
    
    if event_tuple is not None:
        payload["event_tuple"] = event_tuple
    
    if full_image_url is not None:
        payload["full_image_url"] = full_image_url
    
    if parent_ids is not None:
        payload["parent_ids"] = parent_ids
    
    if action_tag is not None:
        payload["action_tag"] = action_tag
    
    if block_tag is not None:
        payload["block_tag"] = block_tag
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"更新状态: {result}")
    return result

## 删除因果数据事件节点
def delete_causal_node(node_id, owner_id="cbf"):
    """
    删除因果事件
    
    参数:
    - node_id (str): 要删除的事件ID
    - owner_id (str, optional): 事件拥有者ID，默认为"cbf"
    
    返回:
    - dict: API响应结果
    
    注意:
    - 删除操作将：
      1. 删除数据库中本条记录
      2. 删除地宫表中对应记录
      3. 将其子事件的父ID更新为本事件的父ID
      4. 如果父ID为NULL（本事件为根事件），直接删除
    
    示例:
    delete_causal_node("王占曰：吉，其来")
    """
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/delete"
    
    payload = {
        "node_id": node_id,
        "owner_id": owner_id
    }
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"删除状态: {result}")
    return result
