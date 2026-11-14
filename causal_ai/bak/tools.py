#*************************
#                        #
#  因果推理和数据操作工具  #
#                        #
#*************************

## 从关键字搜索事件列表
def search_causal_by_keyword(keyword, owner_id='222302526', limit=100, method="POST"):
    """
    根据关键字搜索事件列表
    
    参数:
    - keyword (str): 搜索关键词，支持逻辑与（&）操作符
    - owner_id (str, optional): 事件拥有者ID，如果为None则搜索所有事件
    - limit (int, optional): 返回结果数量限制，默认为100
    - method (str, optional): HTTP请求方法，"GET" 或 "POST"，默认为"POST"
    
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
    results = search_causal_by_keyword("祭祀", owner_id="worker", limit=50)

    # 也可以使用 GET 请求 (相当于请求 URL: http://127.0.0.1:8094/api/v1/causal/search/keyword?keyword=祭祀&owner_id=222302526&limit=10 )
    results = search_causal_by_keyword("祭祀", owner_id="worker", limit=50, method="GET")
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
    
    if method.upper() == "GET":
        response = requests.get(url, params=payload)
    else:
        response = requests.post(url, json=payload)
    result = response.json()
    
    if result.get('status') == 'success':
        print(f"搜索到 {result.get('count', 0)} 个相关事件")
    else:
        print(f"搜索失败: {result.get('message')}")
    
    return result

## 从向量搜索事件列表
def search_causal_by_embed(keyword, owner_id='222302526', limit=100, threshold=0.0):
    """
    根据关键字的语义向量搜索事件列表
    
    参数:
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

    url = "http://127.0.0.1:8094/api/v1/causal/search/vector"
    
    payload = {
        "keyword": keyword
    }
    
    if owner_id is not None:
        payload["owner_id"] = owner_id
    
    if limit is not None:
        payload["limit"] = limit
    
    if threshold > 0:
        payload["threshold"] = threshold
    
    response = requests.post(url, json=payload)
    result = response.json()
    
    if result.get('status') == 'success':
        print(f"搜索到 {result.get('count', 0)} 个相关事件 (阈值={result.get('threshold', threshold)})")
    else:
        print(f"搜索失败: {result.get('message')}")
    
    return result

## 点击事件
def search_causal_by_serial(serial_id, actor_id="user2", owner_id="222302526", max_eyes=None):
    """
    【存在主义检索】聚焦某事件节点（大股东），一次性获取：
    1. 该节点的全息内容（自动从地宫恢复，如果已被提炼）
    2. 该节点的父、子ID列表
    3. 事件视界（Event Horizon）内的所有相关节点内容
    
    参数:
    - serial_id (int): 事件节点的物理ID
    - actor_id (str, optional): 用户ID，用于个性化权重更新,默认为"415135222"
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    - max_eyes (float, optional): 望远镜功率（事件视界半径），建议范围30-60。如果为None，则使用.env中的默认值

    返回:
    - dict: API响应结果，包含：
        - data: 当前节点全息内容，其中因果链字段为 serial_id 整数列表：
            - serial_id: 当前事件物理ID
            - node_id: 事件标题
            - event_tuple: 事件叙述
            - survival_weight: 权重（大股东为0.6）
            - block_tag / action_tag: 因缘/动作标签
            - previous_ids: 前事件（父事件）serial_id 整数列表，无则为 []
            - next_ids: 后事件（子事件）serial_id 整数列表，无则为 []
            - preview_id: 兼容字段，取 previous_ids[0]，无则为 0
        - event_horizon: 视界内节点ID列表
        - event_horizon_details: 视界内节点详情列表，每条包含：serial_id, node_id, event_tuple, distance
                （当 .env 中 HORIZON_DETAIL=1 时，额外包含 previous_ids, next_ids 因果链字段）

    核心概念（因果星空本体论）:

    【第一层：三维语义空间 — 因果链不是图】
    - 事件节点由语义向量的余弦距离确定在三维空间中的坐标，不存在固定的"边"
    - 同一因果链在不同观测者视角下，节点的空间分布（距离、引力）是不同的
    - previous_ids/next_ids 是观测者的逻辑选认，而在客体视觉下，决定事件关系的是语义空间中的实时距离

    【第二层：四维时空 — 时间矢量和叙事清晰度】
    - 每个事件携带隐式的时间矢量，叙事清晰度在以下两极之间膨胀/坍缩：
      膨胀方向（趋清晰）："谁|做了什么" → 时|地|人|起|冲|结
      坍缩方向（趋模糊）：时|地|人|起|冲|结 → "谁|做了什么" → [已提炼]→地宫
    - 代谢引擎（Metabolism Engine）以无情的上帝之手持续对所有事件施加时间衰减：
      不投入观测能量（点击、搜索）的事件，清晰度单调递减，最终坍缩入地宫

    【第三层：因果场 — 多观察者造成时空弯曲】
    - 不同 owner_id（事件拥有者）和 actor_id（观测者）对事件施加不同的 survival_weight
    - 观测者将某个节点提升为大股东（60% 权重），会造成语义空间的局部引力异常
    - event_horizon 的本质：给定观测者在给定因果场中的光锥截面
      同一事件在不同观测者眼中处于不同的"位置"——这是相对论性的参考系依赖

    【第四层：碳硅跨界转述 — 因果配平方程】
    - 四大因果配平方程不仅是底层算法，更是碳基生命智慧转述给硅基智慧的思想表达
    - Agent（硅基）藉此与人类（碳基）在同一套存在主义本体论中实现因果共振与协同推演

    【存在主义检索机制】:
    - **大股东节点**：当前聚焦节点，权重提升到60%，弯曲局部时空
    - **事件视界（Event Horizon）**：语义距离 D <= MAX_EYES 的所有节点
      距离公式：D = (1 - 余弦相似度) * 100
    - Agent 只需"看一眼"大股东节点，就能用"余光"扫到视界内所有节点
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
        print(f"  父链: {anchor.get("previous_ids", [])}")
        print(f"  子链: {anchor.get('next_ids', [])}")
        print(f"=== 事件视界（语义相关节点）===")
        for n in result.get('event_horizon_details', []):
            print(f"  [{n.get('distance', 0):.1f}] {n['node_id']}: {n['event_tuple'][:60]}...")

    # 该接口同时支持 GET 和 POST 两种访问方式，返回相同的 JSON 数据结构。
    # 以下为直接使用 HTTP GET 访问的等价方式（无需通过本 Python 函数）：

    # 1. curl 示例（命令行直接调用）
    curl "http://127.0.0.1:8094/api/v1/causal/click?serial_id=601&owner_id=222302526&actor_id=415135222&max_eyes=40"

    # 2. 完整 HTTP URL 示例（可直接粘贴到浏览器地址栏访问）
    http://192.168.66.39:8094/api/v1/causal/click?serial_id=601&owner_id=222302526&actor_id=415135222&max_eyes=40

    # 参数说明（GET 方式通过 URL query string 传递）：
    #   serial_id : 事件节点的物理ID（必需）
    #   actor_id  : 用户ID（可选，用于个性化权重更新）
    #   owner_id  : 事件拥有者ID（可选，默认回退到节点自身的 owner_id）
    #   max_eyes  : 望远镜功率/事件视界半径（可选，默认回退到 .env 中的 MAX_EYES）
    """
    import requests

    url = "http://127.0.0.1:8094/api/v1/causal/click"

    payload = {
        "serial_id": serial_id,
        "owner_id": owner_id
    }

    if actor_id is not None:
        payload["actor_id"] = actor_id

    if max_eyes is not None:
        payload["max_eyes"] = max_eyes

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
        
        prev_ids = anchor.get("previous_ids", [])
        next_ids = anchor.get('next_ids', [])
        preview_id = anchor.get('preview_id', [])
        print(f"  前链 ({len(prev_ids)}): {prev_ids}")
        print(f"  前事件ID: {preview_id}")
        print(f"  后链 ({len(next_ids)}): {next_ids}")
        
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
def trigger_causal_node(node_id, action_tag, block_tag, event_tuple, previous_node=None, full_image_url=None, owner_id="222302526", return_serial_id=None):
    """
    进行因果事件记录。
    
    【叙事清晰度】事件以 event_tuple（二元组 "谁|做了什么"）为初始形态，
    随时间推移和观测积累可向六元组（时|地|人|起|冲|结）膨胀；
    反之，缺乏持续观测的事件会坍缩为标签 [已提炼] 并进入地宫。
    
    参数:
    - node_id (str): 事件的唯一标识（建议使用因果描述）
    - action_tag (str): 动作标签，可选值：贞、又贞、对贞
    - block_tag (str): 因缘标签，可选值：因、相、果
    - event_tuple (str): 事件二元组内容描述
    - previous_node (str/list, optional): 前事件ID（因果链中的前置事件），可以是单个字符串或列表（多前事件），默认为None（首贞）
    - full_image_url (str, optional): 全息图片URL，默认为None
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    - return_serial_id (bool, optional): 是否返回物理序列ID，默认为None（使用系统默认配置）
    
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
        previous_node="王占曰：吉，其来",
        owner_id="worker"
    )
    
    # 发起对贞（事件链的结果事件）
    trigger_causal_node(
        node_id="旬有二日，方来",
        action_tag="对贞",
        block_tag="果",
        event_tuple="终于在距离首贞十二天后...",
        previous_node="丙申，王占曰：吉",
        owner_id="worker"
    )
    """
    import requests
    url = "http://127.0.0.1:8094/api/v1/causal/genesis"
    
    payload = {
        "node_id": node_id,
        "previous_node": previous_node,
        "block_tag": block_tag,
        "action_tag": action_tag,
        "event_tuple": event_tuple,
        "owner_id": owner_id
    }
    
    if full_image_url:
        payload["full_image_url"] = full_image_url
        
    if return_serial_id is not None:
        payload["return_serial_id"] = return_serial_id
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"Status: {result}")
    return result

## 修改因果数据事件节点
def update_causal_node(old_node_id, new_node_id, event_tuple=None, full_image_url=None, 
                       previous_ids=None, action_tag=None, block_tag=None, owner_id="222302526"):
    """
    编辑因果事件
    
    参数:
    - old_node_id (str): 原始事件ID
    - new_node_id (str): 新事件ID（如果要修改事件ID）
    - event_tuple (str, optional): 新的事件叙述
    - full_image_url (str, optional): 新的图片URL
    - previous_ids (str/list, optional): 新的前事件ID列表，可以是字符串（|分隔）或列表
    - action_tag (str, optional): 新的动作标签
    - block_tag (str, optional): 新的因缘标签
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    
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

## 获取当前事件视界
def get_current_event_horizon(actor_id="415135222", owner_id="222302526", max_eyes=None):
    """
    获取当前观测者在指定因果场中的事件视界。
    系统自动找到当前大股东节点（最高 survival_weight 事件），并以该节点为中心，
    返回语义距离 <= MAX_EYES 的光锥截面内的所有相关事件。
    注意：不同 actor_id 在同一 owner_id 的因果场中的大股东节点可能不同——
    这是因果场的参考系依赖效应。

    参数:
    - actor_id (str, optional): 用户ID，默认为"415135222"
    - owner_id (str, optional): 事件拥有者ID，默认为"222302526"
    - max_eyes (float, optional): 望远镜功率（事件视界半径）。如果为None，则使用系统默认值

    返回:
    - dict: API响应结果，包含：
        - data: 大股东节点全息内容，其中因果链字段为 serial_id 整数列表：
            - serial_id: 当前事件物理ID
            - node_id: 事件标题
            - event_tuple: 事件叙述
            - survival_weight: 权重（大股东为0.6）
            - block_tag / action_tag: 因缘/动作标签
            - previous_ids: 前事件（父事件）serial_id 整数列表，无则为 []
            - next_ids: 后事件（子事件）serial_id 整数列表，无则为 []
        - event_horizon: 视界内节点ID列表
        - event_horizon_details: 视界内节点详情列表，每条包含：serial_id, node_id, event_tuple, distance
        - updated_count: 权重更新的节点数量
        - max_eyes: 实际使用的视界半径

    示例:
    # 直接获取当前观测者的事件视界
    result = get_current_event_horizon(actor_id="415135222", owner_id="222302526", max_eyes=40)
    if result.get('status') == 'success':
        anchor = result.get('data')
        print(f"=== 大股东节点 ===")
        print(f"  事件: {anchor['node_id']}")
        print(f"  叙述: {anchor['event_tuple'][:100]}...")
        print(f"  父链: {anchor.get('previous_ids', [])}")
        print(f"  子链: {anchor.get('next_ids', [])}")
        print(f"=== 事件视界（语义相关节点）===")
        for n in result.get('event_horizon_details', []):
            print(f"  [{n.get('distance', 0):.1f}] {n['node_id']}: {n['event_tuple'][:60]}...")

    # 该接口同时支持 GET 和 POST 两种访问方式，以下为直接使用 HTTP 访问的等价方式：

    # 1. curl GET 示例
    curl "http://127.0.0.1:8094/api/v1/causal/horizon?actor_id=415135222&owner_id=222302526&max_eyes=40"

    # 2. curl POST 示例
    curl -X POST http://127.0.0.1:8094/api/v1/causal/horizon \
      -H "Content-Type: application/json" \
      -d '{"actor_id":"415135222","owner_id":"222302526","max_eyes":40}'
    """
    import requests

    url = "http://127.0.0.1:8094/api/v1/causal/horizon"
    params = {
        "actor_id": actor_id,
        "owner_id": owner_id
    }

    if max_eyes is not None:
        params["max_eyes"] = max_eyes

    try:
        response = requests.get(url, params=params)
        result = response.json()

        if result.get('status') == 'success':
            return result 
        else:
            return f"获取事件视界失败: {result.get('message')}"

    except requests.exceptions.RequestException as e:
        print(f"请求失败，请检查后端服务是否运行: {e}")
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    # response = search_causal_by_serial(serial_id=501, owner_id="test")
    response = get_current_event_horizon()
    # response = trigger_causal_node(node_id="test", action_tag="贞", block_tag="因", event_tuple="这是一个测试节点", previous_node=None, full_image_url=None, owner_id="222302526", return_serial_id=True)
    import json
    print("\n\n")
    print("*" * 60)
    print(json.dumps(response, ensure_ascii=False, indent=4))