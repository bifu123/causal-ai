
"""
langchain 工具
"""
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

#*************************
#                        #
#  因果推理和数据操作工具  #
#                        #
#*************************

## 从关键字搜索事件列表
def search_causal_by_keyword(keyword, config: RunnableConfig=None, owner_id=None, limit=100):
    """
    根据关键字搜索事件列表
    
    参数:
    - config (RunnableConfig): langchain 内置内象，不用管它
    - keyword (str): 搜索关键词，支持逻辑与（&）操作符
    - owner_id (str, optional): 事件拥有者ID，如果为None则搜索所有事件
    - limit (int, optional): 返回结果数量限制，默认为100
    
    返回:
    - dict: API响应结果，包含：
        - data: 搜索结果列表，每条结果包含：
            - serial_id: 事件物理ID
            - node_id: 事件标题
            - relevance_score: 相关度评分 (0-100)，由 V5 算法基于关键词与文本字面匹配计算
            - search_mode: "keyword"，标识此相似度基于字面匹配算法
            - 以及其他事件字段（event_tuple, block_tag, action_tag, survival_weight 等）
        - count: 结果总数
        - keyword: 搜索关键词
    
    注意:
    - 搜索算法采用三级召回策略：
      1. 精确匹配：使用PostgreSQL全文搜索
      2. 自适应匹配：对关键词进行分词后搜索
      3. 回退匹配：使用LIKE模糊匹配
    - 搜索结果按 V5 字面匹配相关度排序
    - search_mode 字段值为 "keyword"，帮助 Agent 理解此相似度与向量搜索的差异
    
    示例:
    # 搜索所有包含"商王"的事件
    results = search_causal_by_keyword("商王")
    for item in results.get('data', []):
        print(f"事件标题: {item['node_id']}, 相关度: {item['relevance_score']}, 搜索模式: {item['search_mode']}")
    
    # 搜索特定用户的事件
    results = search_causal_by_keyword("祭祀", owner_id="222302526", limit=50)
    """
    
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/search/keyword"
    
    # 1. Initialize payload with required keyword
    payload = {"keyword": keyword}
    
    # 2. Determine owner_id: prioritize explicit argument, then config
    payload["owner_id"] = owner_id or config["configurable"].get("data", {}).get("source_id")
        
    # 3. Add limit
    if limit is not None:
        payload["limit"] = limit
    
    # 4. Execute request
    response = requests.post(url, json=payload)
    
    result = response.json()
    
    if result.get('status') == 'success':
        print(f"搜索到 {result.get('count', 0)} 个相关事件")
    else:
        print(f"搜索失败: {result.get('message')}")
    
    return result

## 从关键字搜索事件列表
def search_causal_by_embed(keyword, config: RunnableConfig=None, owner_id=None, limit=100):
    """
    根据自然语言搜索事件列表
    
    参数:
    - config (RunnableConfig): langchain 内置内象，不用管它
    - keyword (str): 搜索关键词（自然语言描述）
    - owner_id (str, optional): 事件拥有者ID，如果为None则搜索所有事件
    - limit (int, optional): 返回结果数量限制，默认为100
    - threshold (float, optional): 余弦相似度阈值 (0-1)，过滤低于此值的结果，默认为0.0（不过滤）
    
    返回:
    - dict: API响应结果，包含：
        - data: 搜索结果列表，每条结果包含：
            - serial_id: 事件物理ID
            - node_id: 事件标题
            - relevance_score: 相关度评分 (0-100)，由余弦相似度 × 100 计算
            - vector_similarity: 原始余弦相似度 (0-1)，供参考
            - search_mode: "vector"，标识此相似度基于语义空间距离
            - 以及其他事件字段（event_tuple, block_tag, action_tag, survival_weight 等）
        - count: 结果总数
        - keyword: 搜索关键词
        - threshold: 过滤阈值
    
    注意:
    - 搜索算法采用向量相似度匹配：
      1. 将关键词转换为语义向量
      2. 在向量数据库中搜索最相似的事件节点
    - 搜索结果按余弦相似度（语义距离）排序
    - relevance_score 基于余弦相似度（而非 V5 字面匹配），与 search_causal_by_keyword 的评分体系不同
    - search_mode 字段值为 "vector"，帮助 Agent 区分两种搜索模式的相似度含义
    - 建议设置 threshold >= 0.7 以过滤低相关度噪声
    
    示例:
    # 搜索语义上与"商王祭祀"相关的事件（设置阈值过滤噪声）
    results = search_causal_by_embed("商王祭祀", threshold=0.7)
    for item in results.get('data', []):
        print(f"事件标题: {item['node_id']}, 相关度: {item['relevance_score']}, 搜索模式: {item['search_mode']}, 向量相似度: {item.get('vector_similarity')}")
    """
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/search/vector"
    
    # 1. Initialize payload with required keyword
    payload = {"keyword": keyword}
    
    # 2. Determine owner_id: prioritize explicit argument, then config
    final_owner_id = owner_id
    if not final_owner_id and config and "configurable" in config:
        final_owner_id = config["configurable"].get("data", {}).get("source_id")
    
    if final_owner_id:
        payload["owner_id"] = final_owner_id
        
    # 3. Add limit
    if limit is not None:
        payload["limit"] = limit
    
    # 4. Execute request
    response = requests.post(url, json=payload)
    result = response.json()
    
    if result.get('status') == 'success':
        print(f"搜索到 {result.get('count', 0)} 个相关事件")
    else:
        print(f"搜索失败: {result.get('message')}")
    
    return result

## 点击事件
def search_causal_by_serial(serial_id, config: RunnableConfig=None, actor_id=None, owner_id=None, max_eyes=None):
    """
    处理事件节点点击、获取事件视界内容
    
    参数:
    - config (RunnableConfig): agent 主代理自动传参，不用理会
    - serial_id (int): 事件节点的物理ID
    - actor_id (str, optional): 事件观察者ID，用于个性化权重更新，**若非用户指定，请保持默认值为None**
    - owner_id (str, optional): 事件拥有者ID，因果链的创建者，**若非用户指定，请保持默认值为None**
    - max_eyes (float, optional): 望远镜功率（事件视界半径），默认值为None
    
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
    result = search_causal_by_serial(123, actor_id=<当前观测者ID>, owner_id=<事件拥有者ID>)
    if result.get('status') == 'success':
        event = result.get('data')
        print(f"用户 user2 的节点 {event['node_id']} 权重已提升到60%")
        print(f"观察者用户: {event.get('actor_id')}")
        print(f"事件拥有者: {event.get('owner_id')}")
    else:
        print(f"点击处理失败: {result.get('message')}")
        
    # curl 示例（命令行直接调用）
    curl "http://192.168.66.39:8094/api/v1/causal/click?serial_id=646&owner_id=222302526&actor_id=415135222&max_eyes=40" （局域网）
    curl "http://aicity.wang:8094/api/v1/causal/click?serial_id=646&owner_id=222302526&actor_id=415135222&max_eyes=40" （互联网）
    """
    import requests

    url = "http://192.168.66.39:8094/api/v1/causal/click"
    
    if config and "configurable" in config and "data" in config["configurable"]:
        owner_id = owner_id or config["configurable"]["data"]["source_id"]
        actor_id = actor_id or config["configurable"]["data"]["from_user"]["user_id"]
   
    payload = {
        "serial_id": serial_id,
        "owner_id": owner_id,
        "actor_id": actor_id
    }
    
    if max_eyes is not None:
        payload["max_eyes"] = max_eyes
    
    response = requests.post(url, json=payload)
    result = response.json()
    
    result["owner_id"] = owner_id
    result["actor_id"] = actor_id
    
    
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
def trigger_causal_node(node_id, action_tag, block_tag, event_tuple, config: RunnableConfig, previous_node=None, full_image_url=None, owner_id=None, return_serial_id=True):
    """
    进行因果事件记录。
 
    参数:
    - node_id (str): 事件的唯一标识（建议使用因果事件内容提炼为简要标题）
    - action_tag (str): 动作标签，可选值：贞、又贞、对贞
    - block_tag (str): 因缘标签，可选值：因、相、果
    - event_tuple (str): 事件二元组内容描述
    - previous_node (str/list, optional): 前事件node_id（因果链中的前置事件），可以是单个字符串或列表（多前事件），默认为None（首贞）
    - full_image_url (str, optional): 全息图片URL，默认为None
    - owner_id (str, optional): 事件拥有者ID，**若非用户指定，请保持默认值为None**
    - return_serial_id (bool, optional): 是否返回物理序列ID，默认为True
    
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
        owner_id="222302526"
    )
    
    # 发起又贞（事件链的中间事件）
    trigger_causal_node(
        node_id="丙申，王占曰：吉",
        action_tag="又贞",
        block_tag="因",
        event_tuple="不觉到了丙申那天...",
        previous_node="王占曰：吉，其来",
        owner_id="222302526"
    )
    
    # 发起对贞（事件链的结果事件）
    trigger_causal_node(
        node_id="旬有二日，方来",
        action_tag="对贞",
        block_tag="果",
        event_tuple="终于在距离首贞十二天后...",
        previous_node="丙申，王占曰：吉",
        owner_id="222302526"
    )

    注意:
    - 若非用户的明确示意，在执行此工具前必须征求用户同意
    - 如果`action_tag`为`对贞`时，`block_tag`必须为`果`
    """
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/genesis"
    
    if owner_id is None:
        owner_id = owner_id or config["configurable"]["data"]["source_id"]
    
    payload = {
        "node_id": node_id,
        "previous_node": previous_node,
        "block_tag": block_tag,
        "action_tag": action_tag,
        "event_tuple": event_tuple,
        "owner_id": owner_id,
        "return_serial_id": return_serial_id
    }
    
    if full_image_url:
        payload["full_image_url"] = full_image_url
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"Status: {result}")
    return result

## 修改因果数据事件节点
def update_causal_node(old_node_id, new_node_id, config: RunnableConfig, event_tuple=None, full_image_url=None, 
                       previous_ids=None, action_tag=None, block_tag=None, owner_id=None):
    """
    编辑因果事件
    
    参数:
    - old_node_id (str): 原始事件ID
    - new_node_id (str): 新事件ID（如果要修改事件ID）
    - event_tuple (str, optional): 新的事件叙述
    - full_image_url (str, optional): 新的图片URL
    - previous_ids (str/list, optional): 新的前事件ID列表，单个前事件直接写前事件node_id，多个前事件用`|`分隔node_id
    - action_tag (str, optional): 新的动作标签
    - block_tag (str, optional): 新的因缘标签
    - owner_id (str, optional): 事件拥有者ID，默认为None
    
    返回:
    - dict: API响应结果
    
    注意:
    - 如果previous_ids为空字符串或空列表，事件将变为首贞（动作标签自动设为"贞"，因缘标签自动设为"因"）
    - 如果修改了node_id，所有后事件的previous_node将自动更新
    
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
        previous_ids=["前事件1", "前事件2"]
    )
    
    # 将事件变为首贞（清空父事件）
    update_causal_node(
        old_node_id="某个事件",
        new_node_id="某个事件",
        previous_ids=""  # 或 [] 或 None
    )
    """
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/update"
    
    if not owner_id:
        owner_id = config["configurable"]["data"]["source_id"]
    
    payload = {
        "old_node_id": old_node_id,
        "new_node_id": new_node_id,
        "owner_id": owner_id
    }
    
    if event_tuple is not None:
        payload["event_tuple"] = event_tuple
    
    if full_image_url is not None:
        payload["full_image_url"] = full_image_url
    
    if previous_ids is not None:
        payload["previous_ids"] = previous_ids
    
    if action_tag is not None:
        payload["action_tag"] = action_tag
    
    if block_tag is not None:
        payload["block_tag"] = block_tag
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"更新状态: {result}")
    return result

## 删除因果数据事件节点
def delete_causal_node(node_id, config: RunnableConfig, owner_id=None):
    """
    删除因果事件
    
    参数:
    - node_id (str): 要删除的事件ID
    - owner_id (str, optional): 事件拥有者ID，**若非用户指定，请保持默认值为None**
    
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
    owner_id = owner_id or config["configurable"]["data"]["source_id"]
        
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

## 因果链骨架查询
def get_causal_skeleton(serial_id, config: RunnableConfig, actor_id=None, owner_id=None):
    """
    获取事件的因果链全息图骨架
    
    参数:
    - serial_id (int): 事件的物理序列ID（必需）
    - actor_id (str, optional): 用户ID，如果提供则返回用户个性化权重,默认值为None
    - owner_id (str, optional): 事件拥有者ID，默认值为None
    
    返回:
    - dict: API响应结果
    
    示例:
    result = get_causal_skeleton(312)
    """
    import requests
    url = "http://192.168.66.39:8094/api/v1/causal/skeleton"
 
    owner_id = owner_id or config["configurable"]["data"]["source_id"]
    actor_id = actor_id or config["configurable"]["data"]["from_user"]["user_id"]
    
    payload = {
        "serial_id": serial_id,
        "owner_id": owner_id
    }

    response = requests.post(url, json=payload)
    return response.json()

## 获取当前事件视界
def get_current_event_horizon(config: RunnableConfig, actor_id=None, owner_id=None, max_eyes=None):
    """
    获取当前观测者在指定因果场中的事件视界。
    系统自动找到当前大股东节点（最高 survival_weight 事件），并以该节点为中心，返回语义距离 <= MAX_EYES 的光锥截面内的所有相关事件。
    不同 actor_id 对同一 owner_id 的大股东节点可能不同——因果场的参考系依赖。
    
    参数:
    - actor_id (str, optional): 用户ID，默认为"415135222"
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    - max_eyes (float, optional): 望远镜功率（事件视界半径）。如果为None，则使用系统默认值
    
    返回:
    - dict: API响应结果或错误信息
    """
    import requests
    
    owner_id = owner_id or config["configurable"]["data"]["source_id"]
    actor_id = actor_id or config["configurable"]["data"]["from_user"]["user_id"]
    
    
    url = f"http://192.168.66.39:8094/api/v1/causal/history"
    params = {
        "actor_id": actor_id,
        "owner_id": owner_id,
        "max_eyes": max_eyes
    }
    
    try:
        response = requests.get(url, params=params)
        result = response.json()
        
        if result.get('status') == 'success':
            data = result.get('data', [])
            boss_node_id = result.get('boss_node_id')
            
            if not data:
                print(f"owner_id {owner_id}的因果星空中还没有事件")
                return {"status": "error", "message": f"owner_id {owner_id}的因果星空中还没有事件"}
                
            if not boss_node_id:
                print(f"该actor_id {actor_id}尚未对owner_id {owner_id}的因果星空尚未实施观测")
                return {"status": "error", "message": f"该actor_id {actor_id}尚未对owner_id {owner_id}的因果星空尚未实施观测"}
                
            # 查找大股东节点的 serial_id
            serial_id = None
            for node in data:
                if node.get('node_id') == boss_node_id:
                    serial_id = node.get('serial_id')
                    break
                    
            if serial_id is not None:
                # 如果调用者没有显式传入 max_eyes，则尝试使用后端缓存的最新 max_eyes
                current_max_eyes = result.get('current_max_eyes')
                if max_eyes is None and current_max_eyes is not None:
                    max_eyes = current_max_eyes
                    print(f"使用用户 {actor_id} 适时的 max_eyes: {max_eyes}")
                    
                print(f"找到当前大股东节点: {boss_node_id} (serial_id: {serial_id})，正在获取事件视界...")
                return f'请执行工具：\nsearch_causal_by_serial(serial_id="{serial_id}", actor_id="{actor_id}", owner_id="{owner_id}", max_eyes={max_eyes})'
            else:
                print(f"数据异常：未在节点列表中找到大股东节点 {boss_node_id} 的详细信息")
                return {"status": "error", "message": "未找到大股东节点详细信息"}
        else:
            print(f"获取历史数据失败: {result.get('message')}")
            return result
            
    except requests.exceptions.RequestException as e:
        print(f"请求失败，请检查后端服务是否运行: {e}")
        return {"status": "error", "message": str(e)}
