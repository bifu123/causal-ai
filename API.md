## 🚀 元龙因果 AI Agent 接入指南 (API 调用示例)

本系统采用 AINS (AI Native Software) 协议，允许 Agent 通过 HTTP POST 接口操作本系统。

### 接口定义
- **URL**: `http://192.168.66.39:8094/api/v1/causal/genesis`
- **Method**: `POST`
- **Content-Type**: `application/json`

### 1. 记录因果链事件
**Python 示例**:
```python
import requests

def trigger_causal_node(node_id, action_tag, block_tag, event_tuple, parent_id=None, full_image_url=None, owner_id="default"):
    """
    记录因果链事件
    
    参数:
    - node_id (str): 事件的唯一标识（建议使用因果描述）
    - action_tag (str): 动作标签，可选值：贞、又贞、对贞
    - block_tag (str): 因缘标签，可选值：因、相、果
    - event_tuple (str): 事件二元组内容描述
    - parent_id (str/list, optional): 父事件ID，可以是单个字符串或列表（多父事件），默认为None（首贞）
    - full_image_url (str, optional): 全息图片URL，默认为None
    - owner_id (str, optional): 事件拥有者ID，默认为"default"
    
    返回:
    - dict: API响应结果
    
    示例:
    # 发起首贞
    trigger_causal_node(
        node_id="王占曰：吉，其来",
        action_tag="贞",
        block_tag="因",
        event_tuple="那一天阴云密布...",
        full_image_url="uploads/raw/zhen.png",
        owner_id="worker"
    )
    
    # 发起又贞
    trigger_causal_node(
        node_id="丙申，王占曰：吉",
        action_tag="又贞",
        block_tag="因",
        event_tuple="不觉到了丙申那天...",
        parent_id="王占曰：吉，其来",
        owner_id="worker"
    )
    
    # 发起对贞
    trigger_causal_node(
        node_id="旬有二日，方来",
        action_tag="对贞",
        block_tag="果",
        event_tuple="终于在距离首贞十二天后...",
        parent_id="丙申，王占曰：吉",
        owner_id="worker"
    )
    """
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

# 示例：发起首贞
def trigger_genesis():
    """发起首贞示例"""
    content = """那一天阴云密布，雷电时不时划过天际，祭坛上摆着砍下的人牲的肢体，巨大的鼎里正在炖着被辟为两半的牛，热汤正在沸腾，奴隶们不断的地被敲碎脑袋，惨叫声传出很远。

贞人蓬头散发，走上台来作法，别着腰刀（明阳花山石画），女奴献酒，族人围火载舞，但是用于祭祀的羌人仍然不够，因为十二天后就是从先祖太甲到母戊的大型祭祀。需要人牲四百多人，目前的库存实在紧缺，商王紧皱眉头，决定以最诚的心去打动上天。于是他亲自问卜....

卜文曰：
贞："王占曰：吉，其来"

翻译：商王占卜结果很好（事件主体投入意志），方国会来（预判）。"""
    
    return trigger_causal_node(
        node_id="王占曰：吉，其来",
        action_tag="贞",
        block_tag="因",
        event_tuple=content,
        full_image_url="uploads/raw/zhen.png"
    )

# 执行示例
if __name__ == "__main__":
    trigger_genesis()
```

### 2. 发起"又贞" (基于已有事件继续补充)
**Curl 示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/genesis" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "丙申，王占曰：吉",
           "parent_id": "王占曰：吉，其来",
           "block_tag": "因",
           "action_tag": "又贞",
           "event_tuple": "不觉到了丙申那天，边缰的将领没有俘虏羌人的消息，方国也没有来进贡大乌龟和人牲，而祭祀大典日近，贞人们的龟甲骨头都是惜着用，商王不放心，再次贞问。\n\n卜文曰：\n贞："丙申，王占曰：吉"\n\n翻译：商王占卜结果很好（事件主体继续投入意志），争取结果向期望方向坍塌（方国还是会来）",
           "owner_id": "worker"
         }'
```


### 3. 发起"对贞" (基于结果的事后补录)
**Curl 示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/genesis" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "旬有二日，方来",
           "parent_id": "丙申，王占曰：吉",
           "block_tag": "果",
           "action_tag": "对贞",
           "event_tuple": "终于在距离首贞十二天后，方国来进贡了，商王朝的心终于落下了。\n\n卜文曰：\n对贞："旬有二日，方来"\n\n翻译：终于在距离首贞十二天后，方国来进贡了（事件主体对结果确认）",
           "owner_id": "worker"
         }'
```

### 4. 删除事件
**Python 示例**:
```python
import requests

def delete_causal_node(node_id):
    """
    删除因果事件
    
    参数:
    - node_id (str): 要删除的事件ID
    
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
    url = "http://192.168.66.39:8094/api/v1/causal/delete"
    
    payload = {
        "node_id": node_id
    }
    
    response = requests.post(url, json=payload)
    result = response.json()
    print(f"删除状态: {result}")
    return result

# 示例：删除事件
if __name__ == "__main__":
    delete_causal_node("王占曰：吉，其来")
```

**Curl 示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/delete" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "王占曰：吉，其来"
         }'
```

### 5. 编辑事件
**Python 示例**:
```python
import requests

def update_causal_node(old_node_id, new_node_id, event_tuple=None, full_image_url=None, 
                       parent_ids=None, action_tag=None, block_tag=None):
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
    url = "http://192.168.66.39:8094/api/v1/causal/update"
    
    payload = {
        "old_node_id": old_node_id,
        "new_node_id": new_node_id
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

# 示例：编辑事件
if __name__ == "__main__":
    # 修改事件叙述
    update_causal_node(
        old_node_id="王占曰：吉，其来",
        new_node_id="王占曰：吉，其来",
        event_tuple="更新后的事件叙述内容..."
    )
```

**Curl 示例**:
```bash
# 修改事件叙述
curl -X POST "http://192.168.66.39:8094/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "王占曰：吉，其来",
           "new_node_id": "王占曰：吉，其来",
           "event_tuple": "更新后的事件叙述内容..."
         }'

# 修改事件ID和父事件
curl -X POST "http://192.168.66.39:8094/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "王占曰：吉，其来",
           "new_node_id": "更新后的事件ID",
           "parent_ids": "父事件1|父事件2"
         }'
```

### 6. 获取历史数据
**Python 示例**:
```python
import requests

def get_causal_history():
    """
    获取所有活跃事件数据
    
    返回:
    - dict: 包含所有活跃事件数据的响应结果
    
    示例:
    history = get_causal_history()
    for node in history.get('data', []):
        print(f"事件ID: {node['node_id']}, 事件: {node['event_tuple'][:50]}...")
    """
    url = "http://192.168.66.39:8094/api/v1/causal/history"
    
    response = requests.get(url)
    result = response.json()
    print(f"获取到 {len(result.get('data', []))} 个事件")
    return result

# 示例：获取历史数据
if __name__ == "__main__":
    history = get_causal_history()
```

**Curl 示例**:
```bash
curl -X GET "http://192.168.66.39:8094/api/v1/causal/history"
```

### 7. 关键字搜索事件
**Python 示例**:
```python
import requests

def search_causal_by_keyword(keyword, owner_id=None, limit=100):
    """
    根据关键字搜索事件节点
    
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

# 示例：关键字搜索
if __name__ == "__main__":
    # 搜索所有包含"商王"的事件
    results = search_causal_by_keyword("商王")
    
    # 搜索特定用户的事件
    results = search_causal_by_keyword("祭祀", owner_id="worker", limit=50)
```

**Curl 示例**:
```bash
# 搜索所有包含"商王"的事件
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/keyword" \
     -H "Content-Type: application/json" \
     -d '{
           "keyword": "商王"
         }'

# 搜索特定用户的事件
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/keyword" \
     -H "Content-Type: application/json" \
     -d '{
           "keyword": "祭祀",
           "owner_id": "worker",
           "limit": 50
         }'
```

### 8. 序列ID搜索事件
**Python 示例**:
```python
import requests

def search_causal_by_serial(serial_id, actor_id=None):
    """
    根据序列ID搜索事件节点
    
    参数:
    - serial_id (int): 事件的物理序列ID
    - actor_id (str, optional): 用户ID，如果提供则返回用户个性化权重
    
    返回:
    - dict: API响应结果，包含事件详细信息
    
    注意:
    - serial_id是事件的物理ID，在数据库中是唯一标识
    - 此接口用于精确查找特定事件，常用于点击事件处理
    - 如果提供actor_id参数，返回用户个性化权重；否则返回全局权重
    
    示例:
    # 查找serial_id为123的事件（全局权重）
    result = search_causal_by_serial(123)
    if result.get('status') == 'success':
        event = result.get('data')
        print(f"事件标题: {event['node_id']}")
        print(f"事件权重: {event['survival_weight']}")
        print(f"事件描述: {event['event_tuple'][:100]}...")
    
    # 查找serial_id为123的事件（用户个性化权重）
    result = search_causal_by_serial(123, actor_id="user2")
    if result.get('status') == 'success':
        event = result.get('data')
        print(f"事件标题: {event['node_id']}")
        print(f"用户个性化权重: {event['survival_weight']}")
        print(f"观察者用户: {event.get('actor_id')}")
    else:
        print(f"查找失败: {result.get('message')}")
    """
    url = "http://192.168.66.39:8094/api/v1/causal/search/serial"
    
    payload = {
        "serial_id": serial_id
    }
    
    if actor_id is not None:
        payload["actor_id"] = actor_id
    
    response = requests.post(url, json=payload)
    result = response.json()
    
    if result.get('status') == 'success':
        event = result.get('data', {})
        print(f"找到事件: {event.get('node_id', '未知')}")
        if actor_id:
            print(f"用户个性化权重: {event.get('survival_weight')}")
        else:
            print(f"全局权重: {event.get('survival_weight')}")
    else:
        print(f"查找失败: {result.get('message')}")
    
    return result

# 示例：序列ID搜索
if __name__ == "__main__":
    # 查找serial_id为1的事件（全局权重）
    result = search_causal_by_serial(1)
    
    # 查找serial_id为1的事件（用户个性化权重）
    result = search_causal_by_serial(1, actor_id="user2")
```

**Curl 示例**:
```bash
# 查找serial_id为1的事件（全局权重）
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/serial" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 1
         }'

# 查找serial_id为1的事件（用户个性化权重）
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/serial" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 313,
           "actor_id": "user2"
         }'
```

### 9. 点击事件
**Python 示例**:
```python
import requests

def handle_node_click(serial_id, actor_id=None, owner_id="default"):
    """
    处理节点点击事件
    
    参数:
    - serial_id (int): 事件节点的物理ID
    - actor_id (str, optional): 用户ID，用于个性化权重更新
    - owner_id (str, optional): 事件拥有者ID，默认为"default"
    
    返回:
    - dict: API响应结果，包含更新后的事件数据
    
    注意:
    - 此接口执行完整的点击事件处理流程：
      1. 获取节点基本信息（调用 get_event_by_sid）
      2. 从地宫恢复内容（如果存在）
      3. 提升节点权重到60%（大股东模式）
      4. 重新计算其他节点权重
      5. 通过Socket.IO实时更新到前端
    - 如果提供actor_id参数，权重更新只影响用户权重表（ains_user_weights），
      不影响全局权重表（ains_active_nodes）
    - 此接口会触发实时更新，所有连接到观测站的客户端都会收到更新通知
    
    示例:
    # 处理serial_id为123的节点点击（全局权重更新）
    result = handle_node_click(123)
    if result.get('status') == 'success':
        event = result.get('data')
        print(f"节点 {event['node_id']} 权重已提升到60%")
        print(f"共更新了 {result.get('updated_count', 0)} 个节点")
    
    # 处理serial_id为123的节点点击（用户个性化权重更新）
    result = handle_node_click(123, actor_id="user2", owner_id="cbf")
    if result.get('status') == 'success':
        event = result.get('data')
        print(f"用户 user2 的节点 {event['node_id']} 权重已提升到60%")
        print(f"观察者用户: {event.get('actor_id')}")
        print(f"事件拥有者: {event.get('owner_id')}")
    else:
        print(f"点击处理失败: {result.get('message')}")
    """
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

# 示例：处理节点点击
if __name__ == "__main__":
    # 处理serial_id为1的节点点击（全局权重更新）
    result = handle_node_click(1)
    
    # 处理serial_id为1的节点点击（用户个性化权重更新）
    result = handle_node_click(1, actor_id="user2", owner_id="cbf")
```

**Curl 示例**:
```bash
# 处理serial_id为123的节点点击（全局权重更新）
curl -X POST "http://192.168.66.39:8094/api/v1/causal/click" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 313,
           "owner_id": "cbf"
         }'

# 处理serial_id为123的节点点击（用户个性化权重更新）
curl -X POST "http://192.168.66.39:8094/api/v1/causal/click" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 313,
           "actor_id": "user2",
           "owner_id": "cbf"
         }'
```

**功能说明**:
1. **权重提升机制**：被点击的节点权重提升到所有节点总权重的60%（大股东模式），
   其他节点按现有权重比例分配剩余的40%。

2. **用户个性化权重**：如果提供`actor_id`参数，权重更新只影响`ains_user_weights`表，
   实现多用户环境下的个性化权重管理。

3. **地宫恢复**：如果节点在地宫表（`ains_archive_necropolis`）中有历史记录，
   会自动恢复最新的`event_tuple`和`full_image_url`。

4. **实时同步**：通过Socket.IO广播`node_updated`事件，所有连接到观测站的客户端
   都会实时收到更新，确保多用户环境下的数据一致性。

5. **权重隔离**：不同用户的权重数据完全隔离，每个用户有独立的权重视图，
   点击操作只影响当前用户的权重，不影响其他用户。

**与搜索接口的区别**：
- `/api/v1/causal/search/serial`：只查询节点信息，不修改任何数据
- `/api/v1/causal/click`：查询+恢复+更新+广播完整操作链

**推荐使用场景**：
- 前端用户手动点击节点时调用此接口
- 需要实时更新权重并同步到所有客户端的场景
- 需要恢复节点历史内容的场景
- 多用户环境下需要个性化权重管理的场景

### 10. 因果链骨架查询
**Python 示例**:
```python
import requests

def get_causal_skeleton(serial_id, actor_id=None):
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
```

**Curl 示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/skeleton" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 312
         }'
```

### 参数说明
| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 事件的唯一标识（建议使用因果描述） |
| `parent_id` | String | 是 | 父事件 ID，用于建立因果链条 |
| `block_tag` | String | 是 | 因缘标签，如：因、相、果 |
| `action_tag` | String | 是 | 动作标签，如：贞、又贞、对贞 |
| `event_tuple` | String | 是 | 事件二元组内容描述 |
| `full_image_url` | String | 否 | 全息图片 |
| `owner_id` | String | 否 | 事件拥有者ID，默认为"default" |

### 高级功能说明
1. **多父事件支持**: 父事件ID可以是`|`分隔的字符串（如`"父事件1|父事件2"`）或列表
2. **首贞自动设置**: 当事件没有父事件时，自动设置为动作标签"贞"、因缘标签"因"
3. **事件删除连锁反应**: 删除事件时，其子事件会自动重新连接到被删除事件的父事件
4. **事件ID修改连锁更新**: 修改事件ID时，所有子事件的parent_id会自动更新

---
> **注意**: 一旦 API 调用成功，连接到观测站 UI 的所有屏幕将实时同步渲染该事件。
