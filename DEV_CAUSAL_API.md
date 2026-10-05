# 元龙因果星空开发专用API


## 术语前置
- `事件`：是可以坍缩最简二元组骨架（谁|做了什么）、也可以扩张为`时间、地点、人物、开始、冲突、结局`等复杂多元组的叙事表达，是因果链的基本单元节点。它不是单纯的动作谓词如click、sroll等，是中文`事件`的本意。它的结构甚至“有/无”都是相对观测者而言的，它并非在最小粒子态时必须是“主|谓”结构，也就是说在被观测描述时会自动补全结构和实体，即使A什么也没有写，而B在描述时也会是“A|什么也没写”，即使A只写了“十牛”，C在表达时也可能是“那片甲骨上只刻了‘十牛’”，这是事件的相对性，注定它包容了这个世界目前的表达方式。
- `因果链数据`：是以记录`事件`的数据为节点，通过前后ID列表（previous_ids/next_ids）串联起来的，具有时间一维矢量的系列记录，成为一个多因多果的网络，它的一条记录称为一个`事件`。吸取自中国商代甲骨文记事方式（事件的动作标签）：
**贞**：首发记录（因缘标签为`因`）。
**又贞**：持续观测，继续记录（因缘标签为`因`）。
**对贞**：结果确认（因缘标签为`果`）。
**贞-又贞-对贞，并不是一个独立闭合单元，而是可以多因多果，合并/分支/回环延伸的链网结构，哪怕任意只有一个单一的节点都是成立的，就算是`果`节点也可以无中生有，但并不能断言其是`孤立`，因为它被描述为`孤立`时，意志主体已经投入了观测，因果已经形成**
- `意志主体`: 推动了事件发生的行为主体，可以是人、物、代表人意志的Agent。
- `事件视界`：以焦点事件为中心，是事件节点语义向量距离半径内内的节点集合，它让Agent"聚焦"于当前节点，同时用"余光"扫一眼语义相关节点。
- `因果虫洞`：在事件视界中，链外事件节点与当前事件链虽然没有显式因果箭头连线，但是它被语义向量引力拉进了事件视界，成为解释既有因果链之间出现客体视角上的逻辑断裂、常理性错误的合适侯选。
- `因果指针`：延着previous_ids/next_ids移动事件视界的观测中心，从而实现`向前/向后/分支/合并/回环`的移动历经拓扑，使Agent可以`前后`看，同兼顾`周围`看，以获得更自洽、更体系的答案。
- `望远镜`： 通过改变`max_eyes`参数的值（事件语义向量距离，以`光年`为喻义单位）来改变事件视界观测范围，（建议30到60光年）。注意：**增加"功率"可能会增加Token的上下文消耗**
- `相事件`：为了自洽、配平已有连线的因果，或者推导可能出现的后续，假定或者写入的虚拟事件枚举，以观察它在事件视界中的时空曲率，发现或等待近似侯选事件的产生，它的因缘标签是“相”。
- `势`: 多个相事件在四维时空（语义距离三空间+时间代谢衰减+观测激活恢复）中的叠影对齐程度。
- `当下`: 观测者所处的因果链位置，是一种特殊的事件视界，它一般是由客体系统呈现的，无须参数。

---

## 🚀 元龙因果链开发专用API

本系统允许 Agent 通过 HTTP 接口操作因果星空系统。

**参数**: owner_id="454652835_3787687088", actor_id="3787687088"
**基础地址**: `http://192.168.66.39:8094`
**Content-Type**: `application/json` (POST/PUT 请求)

---

### 1. 发起首贞 (Genesis)

**功能**: 创建因果链的根事件（首贞）。首贞无父节点，系统自动设置 `action_tag="贞"`、`block_tag="因"`。

**请求**:
- **URL**: `/api/v1/causal/genesis`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 事件的唯一标识（建议使用因果描述） |
| `event_tuple` | String | 是 | 事件二元组内容描述（叙事文本） |
| `block_tag` | String | 是 | 因缘标签，首贞强制为 `"因"` |
| `action_tag` | String | 是 | 动作标签，首贞强制为 `"贞"` |
| `full_image_url` | String | 否 | 全息图片 URL，如 `uploads/raw/zhen.png` |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |
| `is_share` | Boolean | 否 | 是否对外场开放分享，默认 `false` |
| `return_serial_id` | Boolean | 否 | 是否返回 `serial_id`，默认 `true` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data.node_id`: 创建成功的事件ID
- `data.serial_id`: 物理序列ID（当 `return_serial_id=true` 时返回）
- `message`: 错误信息（失败时）

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/genesis" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "王占曰：吉，其来",
           "block_tag": "因",
           "action_tag": "贞",
           "event_tuple": "那一天阴云密布，雷电时不时划过天际，祭坛上摆着砍下的人牲的肢体，巨大的鼎里正在炖着被辟为两半的牛，热汤正在沸腾，奴隶们不断的地被敲碎脑袋，惨叫声传出很远。\n\n贞人蓬头散发，走上台来作法，别着腰刀（明阳花山石画），女奴献酒，族人围火载舞，但是用于祭祀的羌人仍然不够，因为十二天后就是从先祖太甲到母戊的大型祭祀。需要人牲四百多人，目前的库存实在紧缺，商王紧皱眉头，决定以最诚的心去打动上天。于是他亲自问卜....\n\n卜文曰：\n贞：\"王占曰：吉，其来\"\n\n翻译：商王占卜结果很好（事件主体投入意志），方国会来（预判）。",
           "full_image_url": "uploads/raw/zhen.png",
           "owner_id": "worker",
           "is_share": false,
           "return_serial_id": true
         }'
```

---

### 2. 发起又贞

**功能**: 基于已有事件继续补充（又贞）。必须指定 `previous_node`（前事件ID），建立因果链条。

**请求**:
- **URL**: `/api/v1/causal/genesis`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 新事件的唯一标识 |
| `previous_node` | String/List | 是 | 前事件ID，支持单个字符串或列表（多前事件） |
| `event_tuple` | String | 是 | 事件叙述文本 |
| `block_tag` | String | 是 | 因缘标签，如 `"因"`、`"相"` |
| `action_tag` | String | 是 | 动作标签，此处为 `"又贞"` |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |
| `is_share` | Boolean | 否 | 是否对外场开放分享，默认 `false` |
| `return_serial_id` | Boolean | 否 | 是否返回 `serial_id`，默认 `true` |

**返回说明**: 同首贞接口。

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/genesis" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "丙申，王占曰：吉",
           "previous_node": "王占曰：吉，其来",
           "block_tag": "因",
           "action_tag": "又贞",
           "event_tuple": "不觉到了丙申那天，边缰的将领没有俘虏羌人的消息，方国也没有来进贡大乌龟和人牲，而祭祀大典日近，贞人们的龟甲骨头都是惜着用，商王不放心，再次贞问。\n\n卜文曰：\n贞：\"丙申，王占曰：吉\"\n\n翻译：商王占卜结果很好（事件主体继续投入意志），争取结果向期望方向坍塌（方国还是会来）",
           "owner_id": "worker",
           "is_share": false
         }'
```
**如果previous_node原本非空请要不置空它，注意检查**

---

### 3. 发起对贞

**功能**: 基于结果的事后补录（对贞）。用于记录事件的结果确认，通常 `block_tag="果"`。

**请求**:
- **URL**: `/api/v1/causal/genesis`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 新事件的唯一标识 |
| `previous_node` | String/List | 是 | 前事件ID |
| `event_tuple` | String | 是 | 事件叙述文本 |
| `block_tag` | String | 是 | 因缘标签，对贞通常为 `"果"` |
| `action_tag` | String | 是 | 动作标签，此处为 `"对贞"` |
| `owner_id` | String | 否 | 事件拥有者ID |
| `is_share` | Boolean | 否 | 是否对外场开放分享，默认 `false` |
| `return_serial_id` | Boolean | 否 | 是否返回 `serial_id`，默认 `true` |

**返回说明**: 同首贞接口。

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/genesis" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "旬有二日，方来",
           "previous_node": "丙申，王占曰：吉",
           "block_tag": "果",
           "action_tag": "对贞",
           "event_tuple": "终于在距离首贞十二天后，方国来进贡了，商王朝的心终于落下了。\n\n卜文曰：\n对贞：\"旬有二日，方来\"\n\n翻译：终于在距离首贞十二天后，方国来进贡了（事件主体对结果确认）",
           "owner_id": "worker",
           "is_share": false
         }'
```
**如果previous_node原本非空请要不置空它，注意检查**

---

### 4. 删除事件

**功能**: 删除指定事件节点。删除时会：
1. 删除活跃事件表记录
2. 删除地宫表对应记录
3. 子事件自动继承被删事件的父ID（因果链不断裂）
4. 若被删事件为根事件（无父），子事件变为新的根

**请求**:
- **URL**: `/api/v1/causal/delete`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 要删除的事件ID |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述，如 `"事件 'xxx' 已删除，子事件已重新连接"`

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/delete" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "王占曰：吉，其来",
           "owner_id": "worker"
         }'
```

---

### 5. 编辑事件

**功能**: 更新事件信息，支持修改 `node_id`、叙述、父节点、标签等。修改 `node_id` 时，所有子事件的 `previous_node` 会自动联动更新。

**请求**:
- **URL**: `/api/v1/causal/update`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `old_node_id` | String | 是 | 原始事件ID |
| `new_node_id` | String | 是 | 新事件ID（不修改则与 `old_node_id` 相同） |
| `event_tuple` | String | 否 | 新的事件叙述 |
| `full_image_url` | String | 否 | 新的全息图片URL |
| `previous_ids` | String/List | 否 | 新的父事件ID列表（`\|`分隔字符串或列表）。设为空则变为首贞 |
| `action_tag` | String | 否 | 新的动作标签 |
| `block_tag` | String | 否 | 新的因缘标签 |
| `owner_id` | String | 否 | 事件拥有者ID |
| `is_share` | Boolean | 否 | 更新节点是否对外场开放的状态，默认 `false` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述
- `owner_id`: 事件拥有者ID

**注意**: 若 `previous_ids` 设为空字符串/空列表/None，事件将变为首贞，系统自动强制 `action_tag="贞"`、`block_tag="因"`。

**调用示例**:

```bash
# 修改事件叙述
curl -X POST "http://192.168.66.39:8094/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "王占曰：吉，其来",
           "new_node_id": "王占曰：吉，其来",
           "event_tuple": "更新后的事件叙述内容...",
           "is_share": false
         }'

# 修改事件ID（标题node_id）和父事件（因果连线）
curl -X POST "http://192.168.66.39:8094/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "王占曰：吉，其来",
           "new_node_id": "更新后的事件ID",
           "previous_ids": "父事件1|父事件2"
         }'

# 将事件变为首贞（清空父事件）
curl -X POST "http://192.168.66.39:8094/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "某个事件",
           "new_node_id": "某个事件",
           "previous_ids": ""
         }'
```

---

### 6. 获取历史数据

**功能**: 获取指定因果场中的所有活跃事件列表，用于前端初始化或全量同步。支持 `actor_id` 参数返回用户个性化权重。

**请求**:
- **URL**: `/api/v1/causal/history`
- **Method**: `GET`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 否 | 用户ID，提供则返回用户个性化权重 |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 活跃事件列表，每条包含 `serial_id`, `node_id`, `event_tuple`, `survival_weight`, `previous_ids`, `next_ids`, `block_tag`, `action_tag` 等
- `semantic_links`: 全图语义连线列表（相似度 ≥ 0.6）
- `boss_node_id`: 当前大股东节点ID（如有）
- `event_horizon`: 事件视界内节点ID列表（如有大股东）
- `current_max_eyes`: 用户缓存的视界半径

**调用示例**:
```bash
# 获取全局历史数据
curl -X GET "http://192.168.66.39:8094/api/v1/causal/history?owner_id=worker"

# 获取用户个性化权重历史数据
curl -X GET "http://192.168.66.39:8094/api/v1/causal/history?actor_id=user2&owner_id=worker"
```

---

### 7. 关键字搜索事件

**功能**: 根据关键字搜索事件节点。支持逻辑与（`&`）操作符。采用三级召回策略：PostgreSQL 全文搜索 → 自适应分词搜索 → LIKE 模糊匹配。

**请求**:
- **URL**: `/api/v1/causal/search/keyword`
- **Method**: `GET` 或 `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `keyword` | String | 是 | 搜索关键词，支持 `&` 逻辑与 |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |
| `limit` | Integer | 否 | 返回结果数量限制，默认 `100` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 搜索结果列表，每条包含 `serial_id`, `node_id`, `event_tuple`, `relevance_score`（V5 字面匹配相关度，0-100）, `search_mode="keyword"` 等
- `count`: 结果总数
- `keyword`: 搜索关键词

**调用示例**:
```bash
# GET 方式
curl -X GET "http://192.168.66.39:8094/api/v1/causal/search/keyword?keyword=商王&owner_id=worker&limit=50"

# POST 方式
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/keyword" \
     -H "Content-Type: application/json" \
     -d '{
           "keyword": "祭祀",
           "owner_id": "worker",
           "limit": 50
         }'
```

---

### 8. 向量搜索事件

**功能**: 根据关键字的语义向量搜索事件节点。基于余弦相似度匹配语义空间距离，与关键字搜索的 V5 字面匹配算法互补。

**请求**:
- **URL**: `/api/v1/causal/search/vector`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `keyword` | String | 是 | 搜索关键词（自然语言描述） |
| `owner_id` | String | 否 | 事件拥有者ID |
| `limit` | Integer | 否 | 返回结果数量限制，默认 `100` |
| `threshold` | Float | 否 | 余弦相似度阈值（0-1），默认 `0.0`（不过滤）。建议设 `≥0.7` 过滤噪声 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 搜索结果列表，每条包含 `serial_id`, `node_id`, `event_tuple`, `vector_similarity`（原始余弦相似度 0-1）, `relevance_score`（余弦相似度×100）, `search_mode="vector"` 等
- `count`: 结果总数
- `threshold`: 过滤阈值

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/vector" \
     -H "Content-Type: application/json" \
     -d '{
           "keyword": "商王祭祀",
           "owner_id": "worker",
           "limit": 20,
           "threshold": 0.7
         }'
```

---

### 9. 序列ID搜索事件

**功能**: 根据物理序列ID（`serial_id`）精确查找单个事件。用于点击事件前的节点信息获取。

**请求**:
- **URL**: `/api/v1/causal/search/serial`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `serial_id` | Integer | 是 | 事件的物理序列ID |
| `actor_id` | String | 否 | 用户ID，提供则返回用户个性化权重 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 事件详细信息，包含 `serial_id`, `node_id`, `event_tuple`, `survival_weight`, `previous_ids`, `next_ids`, `block_tag`, `action_tag`, `full_image_url`, `owner_id` 等
- `actor_id`: 观测者ID（如提供）

**调用示例**:
```bash
# 全局权重查询
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/serial" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 1
         }'

# 用户个性化权重查询
curl -X POST "http://192.168.66.39:8094/api/v1/causal/search/serial" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 256,
           "actor_id": "user2"
         }'
```

---

### 10. 点击事件（查看事件视界）

**功能**: 聚焦某事件节点（大股东），执行完整操作链：
1. 从地宫恢复内容（如果已被提炼）
2. 提升节点权重到 60%（大股东模式）
3. 重新计算其他节点权重
4. 扫描事件视界（语义距离 ≤ MAX_EYES 的相关节点）
5. 通过 Socket.IO 实时广播更新

**请求**:
- **URL**: `/api/v1/causal/click`
- **Method**: `GET` 或 `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `serial_id` | Integer | 是 | 事件节点的物理ID |
| `actor_id` | String | 否 | 用户ID，用于个性化权重更新 |
| `owner_id` | String | 否 | 事件拥有者ID，默认节点自身的 `owner_id` |
| `max_eyes` | Float | 否 | 望远镜功率/事件视界半径。若提供则覆盖 `.env` 默认值并缓存 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 当前节点全息内容，包含 `serial_id`, `node_id`, `event_tuple`, `survival_weight`（提升后约 0.6）, `previous_ids`, `next_ids`, `block_tag`, `action_tag` 等
- `updated_count`: 权重更新的节点数量
- `event_horizon`: 视界内节点ID列表
- `event_horizon_details`: 视界内节点详情列表（含 `distance` 语义距离）
- `max_eyes`: 实际使用的视界半径

**调用示例**:
```bash
# GET 方式（便于浏览器/curl直接访问）
curl -X GET "http://192.168.66.39:8094/api/v1/causal/click?serial_id=313&owner_id=cbf&actor_id=user2&max_eyes=40"

# POST 方式（Agent/前端JS调用）
curl -X POST "http://192.168.66.39:8094/api/v1/causal/click" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 313,
           "actor_id": "user2",
           "owner_id": "cbf",
           "max_eyes": 40
         }'
```

---

### 11. 获取当前事件视界

**功能**: 自动定位当前大股东节点（权重最高事件），并以该节点为中心返回事件视界。是 `click` 接口的自动化版本，无需手动指定 `serial_id`。

**请求**:
- **URL**: `/api/v1/causal/horizon`
- **Method**: `GET` 或 `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 否 | 用户ID，用于个性化权重。不同观测者的大股东可能不同 |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |
| `max_eyes` | Float | 否 | 望远镜功率。若提供则覆盖默认值并缓存 |

**返回说明**: 与 `/api/v1/causal/click` 完全一致，包含：
- `data`: 大股东节点全息内容
- `event_horizon`: 视界内节点ID列表
- `event_horizon_details`: 视界内节点详情
- `updated_count`: 权重更新节点数
- `max_eyes`: 实际使用的视界半径

**调用示例**:
```bash
# GET 方式
curl -X GET "http://192.168.66.39:8094/api/v1/causal/horizon?actor_id=415135222&owner_id=222302526&max_eyes=40"

# POST 方式
curl -X POST "http://192.168.66.39:8094/api/v1/causal/horizon" \
     -H "Content-Type: application/json" \
     -d '{
           "actor_id": "415135222",
           "owner_id": "222302526",
           "max_eyes": 40
         }'
```

---

### 12. 因果链骨架查询

**功能**: 获取指定事件的因果链全息图骨架，包含该节点及其所有祖先和后代节点的层级结构。

**请求**:
- **URL**: `/api/v1/causal/skeleton`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `serial_id` | Integer | 是 | 事件的物理序列ID |
| `actor_id` | String | 否 | 用户ID，提供则返回用户个性化权重 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 因果链骨架列表，每条包含层级信息和节点详情
- `count`: 骨架节点总数
- `serial_id`: 查询的序列ID

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/skeleton" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 312,
           "actor_id": "user2"
         }'
```

---

### 13. 权重提升（大股东模式）

**功能**: 将指定节点权重提升到所有节点总权重的 60%（大股东模式），其他节点按比例分配剩余 40%。支持用户个性化权重隔离。

**请求**:
- **URL**: `/api/v1/causal/promote_chain`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 要提升权重的事件ID |
| `actor_id` | String | 否 | 用户ID，提供则只更新用户权重表 |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述
- `data.max_weight`: 提升后的最大权重值
- `data.updated_count`: 更新的节点数量
- `data.node_ids`: 被更新的节点ID列表

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/promote_chain" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "王占曰：吉，其来",
           "actor_id": "user2",
           "owner_id": "worker"
         }'
```

---

### 14. 文件上传

**功能**: 上传图片到 `uploads/raw` 目录，返回可引用的 URL。

**请求**:
- **URL**: `/api/v1/causal/upload`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `file` | File | 是 | 要上传的图片文件 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data.url`: 文件访问 URL，如 `/uploads/raw/filename.png`
- `data.filename`: 保存的文件名

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/upload" \
     -F "file=@/path/to/image.png"
```

---

### 15. 从地宫恢复事件

**功能**: 从地宫表（`ains_archive_necropolis`）恢复被提炼事件的完整内容到活跃事件表。

**请求**:
- **URL**: `/api/v1/causal/restore`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `node_id` | String | 是 | 要恢复的事件ID |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 恢复后的节点完整数据
- `necropolis_info`: 恢复详情（是否恢复了 `event_tuple` 和 `full_image_url`）

**调用示例**:
```bash
curl -X POST "http://192.168.66.39:8094/api/v1/causal/restore" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "王占曰：吉，其来"
         }'
```

---

### 通用参数说明

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `node_id` | String | 事件的唯一标识（建议使用因果描述） |
| `serial_id` | Integer | 事件的物理序列ID（数据库自增，唯一） |
| `previous_node` / `previous_ids` | String/List | 父事件ID，支持单父或多父（`\|`分隔或列表） |
| `block_tag` | String | 因缘标签：`"因"`（原因）、`"相"`（过程）、`"果"`（结果） |
| `action_tag` | String | 动作标签：`"贞"`（首贞）、`"又贞"`（继续）、`"对贞"`（确认） |
| `event_tuple` | String | 事件二元组内容描述（叙事文本） |
| `full_image_url` | String | 全息图片 URL，通常以 `uploads/raw/` 开头 |
| `owner_id` | String | 事件拥有者ID，用于多用户因果场隔离 |
| `actor_id` | String | 观测者/用户ID，用于个性化权重管理 |
| `survival_weight` | Float | 事件权重（0-1），大股东约 0.6，其他节点按比例分配 |
| `max_eyes` | Float | 望远镜功率/事件视界半径，建议范围 30-60 |

---

### 核心概念速查

1. **首贞自动设置**: 无父节点时，系统自动强制 `action_tag="贞"`、`block_tag="因"`
2. **多父事件**: `previous_node` 可以是 `\|` 分隔的字符串（如 `"父1|父2"`）或列表
3. **删除连锁**: 删除事件时，子事件自动继承被删事件的父ID，因果链不断裂
4. **ID修改联动**: 修改 `node_id` 时，所有子事件的 `previous_node` 自动更新
5. **权重隔离**: 不同 `actor_id` 的权重数据完全隔离，互不影响
6. **事件视界**: 语义距离 `D = (1 - 余弦相似度) × 100`，`D ≤ MAX_EYES` 的节点构成视界
7. **地宫机制**: 长期未访问的事件会被提炼（内容压缩存入地宫），点击时自动恢复
8. **前后事件**: 我们为了与业界语言同轨，说成“父事件列表 previous_ids”，其实它是“前后事件privouis_ids/next_ids”的多因多果链状，而不是父子层级树。

---

> **注意**: 一旦 API 调用成功，连接到观测站 UI 的所有屏幕将实时同步渲染该事件。

### 本体论和认知推理
请见 `REACT_API.md`