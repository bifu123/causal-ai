## 🚀 Agent 接入指南 (API 调用示例)

本系统采用 AINS (AI Native Software) 协议，允许 Agent 通过 HTTP POST 接口发起“首贞”或“对贞”推演。

### 接口定义
- **URL**: `http://192.168.66.39:8094/api/v1/causal/genesis`
- **Method**: `POST`
- **Content-Type**: `application/json`

### 1. 发起因果推演 (通用函数)
**Python 示例**:
```python
import requests

def trigger_causal_node(node_id, action_tag, block_tag, event_tuple, parent_id=None, full_image_url=None):
    """
    发起因果推演请求
    
    参数:
    - node_id (str): 事件的唯一标识（建议使用因果描述）
    - action_tag (str): 动作标签，可选值：贞、又贞、对贞
    - block_tag (str): 因缘标签，可选值：因、相、果
    - event_tuple (str): 事件二元组内容描述
    - parent_id (str/list, optional): 父事件ID，可以是单个字符串或列表（多父事件），默认为None（首贞）
    - full_image_url (str, optional): 全息图片URL，默认为None
    
    返回:
    - dict: API响应结果
    
    示例:
    # 发起首贞
    trigger_causal_node(
        node_id="王占曰：吉，其来",
        action_tag="贞",
        block_tag="因",
        event_tuple="那一天阴云密布...",
        full_image_url="uploads/raw/zhen.png"
    )
    
    # 发起又贞
    trigger_causal_node(
        node_id="丙申，王占曰：吉",
        action_tag="又贞",
        block_tag="因",
        event_tuple="不觉到了丙申那天...",
        parent_id="王占曰：吉，其来"
    )
    
    # 发起对贞
    trigger_causal_node(
        node_id="旬有二日，方来",
        action_tag="对贞",
        block_tag="果",
        event_tuple="终于在距离首贞十二天后...",
        parent_id="丙申，王占曰：吉"
    )
    """
    url = "http://192.168.66.39:8094/api/v1/causal/genesis"
    
    payload = {
        "node_id": node_id,
        "parent_id": parent_id,
        "block_tag": block_tag,
        "action_tag": action_tag,
        "event_tuple": event_tuple
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
贞：“王占曰：吉，其来”

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

### 2. 发起“又贞” (基于已有事件继续补充)
**Curl 示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/genesis" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "丙申，王占曰：吉",
           "parent_id": "王占曰：吉，其来",
           "block_tag": "因",
           "action_tag": "又贞",
           "event_tuple": "不觉到了丙申那天，边缰的将领没有俘虏羌人的消息，方国也没有来进贡大乌龟和人牲，而祭祀大典日近，贞人们的龟甲骨头都是惜着用，商王不放心，再次贞问。\n\n卜文曰：\n贞：“丙申，王占曰：吉”\n\n翻译：商王占卜结果很好（事件主体继续投入意志），争取结果向期望方向坍塌（方国还是会来）"
         }'
```


### 3. 发起“对贞” (基于结果的事后补录)
**Curl 示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/genesis" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "旬有二日，方来",
           "parent_id": "丙申，王占曰：吉",
           "block_tag": "果",
           "action_tag": "对贞",
           "event_tuple": "终于在距离首贞十二天后，方国来进贡了，商王朝的心终于落下了。\n\n卜文曰：\n对贞：“旬有二日，方来”\n\n翻译：终于在距离首贞十二天后，方国来进贡了（事件主体对结果确认）"
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

### 参数说明
| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 事件的唯一标识（建议使用因果描述） |
| `parent_id` | String | 是 | 父事件 ID，用于建立因果链条 |
| `block_tag` | String | 是 | 因缘标签，如：因、相、果 |
| `action_tag` | String | 是 | 动作标签，如：贞、又贞、对贞 |
| `event_tuple` | String | 是 | 事件二元组内容描述 |
| `full_image_url` | String | 否 | 全息图片 |

### 高级功能说明
1. **多父事件支持**: 父事件ID可以是`|`分隔的字符串（如`"父事件1|父事件2"`）或列表
2. **首贞自动设置**: 当事件没有父事件时，自动设置为动作标签"贞"、因缘标签"因"
3. **事件删除连锁反应**: 删除事件时，其子事件会自动重新连接到被删除事件的父事件
4. **事件ID修改连锁更新**: 修改事件ID时，所有子事件的parent_id会自动更新

---
> **注意**: 一旦 API 调用成功，连接到观测站 UI 的所有屏幕将实时同步渲染该事件。
