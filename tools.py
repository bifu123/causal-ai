#*************************
#                        #
#  因果推理和数据操作工具  #
#                        #
#*************************

## 从关键字搜索事件列表
def search_causal_by_keyword(keyword, owner_id='222302526', limit=100):
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

    url = "http://127.0.0.1:8094/api/v1/causal/search/keyword"
    
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
def search_causal_by_serial(serial_id, actor_id="user2", owner_id="222302526"):
    """
    【存在主义检索】聚焦某事件节点（大股东），一次性获取：
    1. 该节点的全息内容（自动从地宫恢复，如果已被提炼）
    2. 该节点的父、子ID列表
    3. 事件视界（Event Horizon）内的所有相关节点内容
    
    参数:
    - serial_id (int): 事件节点的物理ID
    - actor_id (str, optional): 用户ID，用于个性化权重更新,默认为"user2"
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"

    返回:
    - dict: API响应结果，包含：
        - data: 当前节点全息内容（serial_id, node_id, event_tuple, survival_weight,
                block_tag, action_tag, parent_ids, preview_id/next_ids）
        - event_horizon: 视界内节点ID列表
        - event_horizon_details: 视界内节点详情列表（含serial_id, node_id,
                parent_id, event_tuple, distance）

    核心概念（存在主义检索）:
    - **大股东节点**：当前聚焦的节点，权重提升到60%
    - **事件视界（Event Horizon）**：语义距离 D <= MAX_EYES 的所有节点
      距离公式：D = (1 - 余弦相似度) * 100
    - LLM Agent 只需"看一眼"大股东节点，就能用"余光"扫到视界内的所有相关节点
    - 通过 MAX_EYES 完美锁死上下文 Token 的消耗上限

    底层流程:
      1. 从地宫恢复内容（如果节点已被提炼）
      2. 计算事件视界（动态扫描语义空间内所有相关节点）
      3. 提升节点权重到60%（大股东模式）
      4. 重新计算其他节点权重
      5. 通过Socket.IO实时更新到前端

    示例:
    # 聚焦 serial_id=312 的节点，获取全息内容 + 视界内所有相关节点
    result = search_causal_by_serial(312)
    if result.get('status') == 'success':
        anchor = result.get('data')
        print(f"=== 大股东节点 ===")
        print(f"  事件: {anchor['node_id']}")
        print(f"  叙述: {anchor['event_tuple'][:100]}...")
        print(f"  父链: {anchor.get('parent_ids', [])}")
        print(f"  子链: {anchor.get('next_ids', [])}")
        print(f"=== 事件视界（语义相关节点）===")
        for n in result.get('event_horizon_details', []):
            print(f"  [{n.get('distance', 0):.1f}] {n['node_id']}: {n['event_tuple'][:60]}...")
    """
    import requests

    url = "http://127.0.0.1:8094/api/v1/causal/click"

    payload = {
        "serial_id": serial_id,
        "owner_id": owner_id
    }

    if actor_id is not None:
        payload["actor_id"] = actor_id

    response = requests.post(url, json=payload)
    result = response.json()

    if result.get('status') == 'success':
        anchor = result.get('data', {})
        horizon_ids = result.get('event_horizon', [])
        horizon_details = result.get('event_horizon_details', [])

        # 1. 大股东节点全息内容
        print(f"=== 大股东节点（权重60%）===")
        print(f"  事件: {anchor.get('node_id', '未知')}")
        print(f"  序列: {anchor.get('serial_id', '未知')}")
        print(f"  权重: {anchor.get('survival_weight', 0):.2%}")
        print(f"  动作: {anchor.get('action_tag', '贞')} | 因缘: {anchor.get('block_tag', '未知')}")
        
        event_tuple = anchor.get('event_tuple', '无叙述')
        print(f"  叙述: {event_tuple[:200]}{'...' if len(event_tuple) > 200 else ''}")
        
        parent_ids = anchor.get('parent_ids', [])
        next_ids = anchor.get('next_ids', [])
        preview_id = anchor.get('preview_id', [])
        print(f"  父链 ({len(parent_ids)}): {parent_ids}")
        print(f"  前事件ID: {preview_id}")
        print(f"  子链 ({len(next_ids)}): {next_ids}")
        
        # 2. 事件视界扫描结果
        print(f"\n=== 事件视界（MAX_EYES={result.get('max_eyes', '?')}，共{len(horizon_ids)}个节点）===")
        if horizon_details:
            for i, n in enumerate(horizon_details):
                dist_str = f"{n.get('distance', 0):.1f}" if n.get('distance') is not None else "?"
                n_event_tuple = n.get('event_tuple', '')
                # 截取前80个字符展示
                print(f"  [{dist_str}] {n.get('node_id', '?')}: {n_event_tuple[:80]}{'...' if len(n_event_tuple) > 80 else ''}")
        elif horizon_ids:
            print(f"  视界内节点ID: {horizon_ids}")
        else:
            print(f"  (视界内无其他节点，语义空间内仅此一星)")
        
        print(f"\n[存在主义检索] 更新节点数: {result.get('updated_count', 0)}")
        if actor_id:
            print(f"[存在主义检索] 用户({actor_id})个性化权重已更新")
    else:
        print(f"聚焦失败: {result.get('message')}")

    return result

## 记录因果数据
def trigger_causal_node(node_id, action_tag, block_tag, event_tuple, parent_id=None, full_image_url=None, owner_id="222302526"):
    """
    进行因果事件记录
    
    参数:
    - node_id (str): 事件的唯一标识（建议使用因果描述）
    - action_tag (str): 动作标签，可选值：贞、又贞、对贞
    - block_tag (str): 因缘标签，可选值：因、相、果
    - event_tuple (str): 事件二元组内容描述
    - parent_id (str/list, optional): 父事件ID，可以是单个字符串或列表（多父事件），默认为None（首贞）
    - full_image_url (str, optional): 全息图片URL，默认为None
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    
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
    url = "http://127.0.0.1:8094/api/v1/causal/genesis"
    
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
                       parent_ids=None, action_tag=None, block_tag=None, owner_id="222302526"):
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
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    
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
    url = "http://127.0.0.1:8094/api/v1/causal/update"
    
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
def delete_causal_node(node_id, owner_id="222302526"):
    """
    删除因果事件
    
    参数:
    - node_id (str): 要删除的事件ID
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    
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
    url = "http://127.0.0.1:8094/api/v1/causal/delete"
    
    payload = {
        "node_id": node_id,
        "owner_id": owner_id
    }
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"删除状态: {result}")
    return result

## 因果链骨架查询
def get_causal_skeleton(serial_id, actor_id=None, owner_id="222302526"):
    """
    获取事件的因果链全息图骨架
    
    参数:
    - serial_id (int): 事件的物理序列ID（必需）
    - actor_id (str, optional): 用户ID，如果提供则返回用户个性化权重
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    
    返回:
    - dict: API响应结果
    
    示例:
    result = get_causal_skeleton(312)
    """
    import requests
    url = "http://127.0.0.1:8094/api/v1/causal/skeleton"
    
    payload = {
        "serial_id": serial_id,
        "owner_id": owner_id
    }
    
    if actor_id is not None:
        payload["actor_id"] = actor_id
    
    response = requests.post(url, json=payload)
    return response.json()

if __name__ == "__main__":
    response = search_causal_by_serial(serial_id=485)
    import json
    print("\n\n")
    print("*" * 60)
    print(json.dumps(response, ensure_ascii=False, indent=4))