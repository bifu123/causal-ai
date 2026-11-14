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
- `因果星空`: 人类专用的3D视图UI。

---

## 🚀 元龙因果链开发专用API

### 0. 场参数和基础地址

|owner_id|actor_id|说明|token|
|---|---|---|---|
|222302526|415135222|理论公共场|无|
|{owner_id}|{actor_id}|私有场|{token}|


**基础地址**: `https://wwww.aicity.wang`
**Content-Type**: `application/json` (POST/PUT 请求)
本系统允许 Agent 通过 HTTP 接口操作因果星空系统。

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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data.node_id`: 创建成功的事件ID
- `data.serial_id`: 物理序列ID（当 `return_serial_id=true` 时返回）
- `message`: 错误信息（失败时）

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/causal/genesis" \
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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**: 同首贞接口。

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/causal/genesis" \
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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**: 同首贞接口。

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/causal/genesis" \
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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述，如 `"事件 'xxx' 已删除，子事件已重新连接"`

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/causal/delete" \
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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述
- `owner_id`: 事件拥有者ID

**注意**: 若 `previous_ids` 设为空字符串/空列表/None，事件将变为首贞，系统自动强制 `action_tag="贞"`、`block_tag="因"`。

**调用示例**:

```bash
# 修改事件叙述
curl -X POST "https://www.aicity.wang/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "王占曰：吉，其来",
           "new_node_id": "王占曰：吉，其来",
           "event_tuple": "更新后的事件叙述内容...",
           "is_share": false
         }'

# 修改事件ID（标题node_id）和父事件（因果连线）
curl -X POST "https://www.aicity.wang/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "王占曰：吉，其来",
           "new_node_id": "更新后的事件ID",
           "previous_ids": "父事件1|父事件2"
         }'

# 将事件变为首贞（清空父事件）
curl -X POST "https://www.aicity.wang/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "某个事件",
           "new_node_id": "某个事件",
           "previous_ids": ""
         }'
```

---

### 6. 获取历史数据

**功能**: 获取指定因果场中的所有活跃事件列表，用于前端初始化或全量同步。支持 `actor_id` 参数返回用户个性化权重；支持 `bot_id` 参数合并元龙因果 Agent 的 memory（跨场 `[chat]` 节点）。

**请求**:
- **URL**: `/api/v1/causal/history`
- **Method**: `GET`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 否 | 用户ID，提供则返回用户个性化权重 |
| `owner_id` | String | 否 | 事件拥有者ID，默认 `"default"` |
| `bot_id` | String | 否 | 元龙因果 Agent 的机器人ID。提供则额外合并异场中属于该 bot 且带 `[chat]` 标记的节点（用于全量初始化并入记忆；"当下/过往"语义详见 `/api/v1/causal/horizon` 与 `/api/v1/causal/click`） |
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

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
curl -X GET "https://www.aicity.wang/api/v1/causal/history?owner_id=worker"

# 获取用户个性化权重历史数据
curl -X GET "https://www.aicity.wang/api/v1/causal/history?actor_id=user2&owner_id=worker"
```

> **元龙因果 Agent 的 Memory（`当下`/`过往`）**：`bot_id` 在此用于全量初始化并入记忆；"当下"对应 `/api/v1/causal/horizon`（获取当前事件视界），"过往"对应 `/api/v1/causal/click`（点击），详见各自小节。

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
| `bot_id` | String | 否 | 机器人ID。提供后，系统会跨场检索该 bot 所有带 `[chat]` 标记的记忆节点并汇入搜索结果 |
| `limit` | Integer | 否 | 返回结果数量限制，默认 `100` |
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 搜索结果列表，每条包含 `serial_id`, `node_id`, `event_tuple`, `relevance_score`（V5 字面匹配相关度，0-100）, `search_mode="keyword"` 等
- `count`: 结果总数
- `keyword`: 搜索关键词

**调用示例**:
```bash
# GET 方式
curl -X GET "https://www.aicity.wang/api/v1/causal/search/keyword?keyword=商王&owner_id=worker&limit=50"

# POST 方式
curl -X POST "https://www.aicity.wang/api/v1/causal/search/keyword" \
     -H "Content-Type: application/json" \
     -d '{
           "keyword": "祭祀",
           "owner_id": "worker",
           "bot_id": "your_bot_id",
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
| `bot_id` | String | 否 | 机器人ID。提供后，系统会跨场检索该 bot 所有带 `[chat]` 标记的记忆节点并汇入搜索结果 |
| `limit` | Integer | 否 | 返回结果数量限制，默认 `100` |
| `threshold` | Float | 否 | 余弦相似度阈值（0-1），默认 `0.0`（不过滤）。建议设 `≥0.7` 过滤噪声 |
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 搜索结果列表，每条包含 `serial_id`, `node_id`, `event_tuple`, `vector_similarity`（原始余弦相似度 0-1）, `relevance_score`（余弦相似度×100）, `search_mode="vector"` 等
- `count`: 结果总数
- `threshold`: 过滤阈值

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/causal/search/vector" \
     -H "Content-Type: application/json" \
     -d '{
           "keyword": "商王祭祀",
           "owner_id": "worker",
           "bot_id": "your_bot_id",
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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 事件详细信息，包含 `serial_id`, `node_id`, `event_tuple`, `survival_weight`, `previous_ids`, `next_ids`, `block_tag`, `action_tag`, `full_image_url`, `owner_id` 等
- `actor_id`: 观测者ID（如提供）

**调用示例**:
```bash
# 全局权重查询
curl -X POST "https://www.aicity.wang/api/v1/causal/search/serial" \
     -H "Content-Type: application/json" \
     -d '{
           "serial_id": 1
         }'

# 用户个性化权重查询
curl -X POST "https://www.aicity.wang/api/v1/causal/search/serial" \
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
| `bot_id` | String | 否 | 元龙因果 Agent 的机器人ID。Agent 主动点击以获取"过往"事件视界（体现"我想到哪里去"） |
| `max_eyes` | Float | 否 | 望远镜功率/事件视界半径。若提供则覆盖 `.env` 默认值并缓存 |
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

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
curl -X GET "https://www.aicity.wang/api/v1/causal/click?serial_id=313&owner_id=cbf&actor_id=user2&max_eyes=40"

# POST 方式（Agent/前端JS调用）
curl -X POST "https://www.aicity.wang/api/v1/causal/click" \
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
| `bot_id` | String | 否 | 元龙因果 Agent 的机器人ID。提供则并入该 bot 跨场的 `[chat]` 记忆节点（`当下`：系统推送的当前视界） |
| `max_eyes` | Float | 否 | 望远镜功率。若提供则覆盖默认值并缓存 |
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**: 与 `/api/v1/causal/click` 完全一致，包含：
- `data`: 大股东节点全息内容
- `event_horizon`: 视界内节点ID列表
- `event_horizon_details`: 视界内节点详情
- `updated_count`: 权重更新节点数
- `max_eyes`: 实际使用的视界半径

**调用示例**:
```bash
# GET 方式
curl -X GET "https://www.aicity.wang/api/v1/causal/horizon?actor_id=415135222&owner_id=222302526&max_eyes=40"

# POST 方式
curl -X POST "https://www.aicity.wang/api/v1/causal/horizon" \
     -H "Content-Type: application/json" \
     -d '{
           "actor_id": "415135222",
           "owner_id": "222302526",
           "max_eyes": 40
         }'
```

---

**元龙因果 Agent 的 Memory（Agent Memory）**：详见独立文档 [Memory.md](./Memory.md)。该文档完整描述了 Memory 的定义、参数、返回与示例。

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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 因果链骨架列表，每条包含层级信息和节点详情
- `count`: 骨架节点总数
- `serial_id`: 查询的序列ID

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/causal/skeleton" \
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
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述
- `data.max_weight`: 提升后的最大权重值
- `data.updated_count`: 更新的节点数量
- `data.node_ids`: 被更新的节点ID列表

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/causal/promote_chain" \
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
curl -X POST "https://www.aicity.wang/api/v1/causal/upload" \
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
curl -X POST "https://www.aicity.wang/api/v1/causal/restore" \
     -H "Content-Type: application/json" \
     -d '{
           "node_id": "王占曰：吉，其来"
         }'
```

---

### 16. 注册新 actor

**功能**: 注册一个新的 actor 身份，同时签发其首把钥匙 token（仅此一次返回明文）。

**请求**:
- **URL**: `/api/v1/auth/register`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID（唯一） |
| `password` | String | 是 | 设置密码，至少 6 位 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述
- `data.token`: 首把钥匙 token（仅此一次返回，请妥善保存）

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/auth/register" \
     -H "Content-Type: application/json" \
     -d '{"actor_id": "zhangsan", "password": "123456"}'
```

---

### 17. 登录

**功能**: 校验 actor 密码，登录成功后返回名下全部钥匙 token 列表。

**请求**:
- **URL**: `/api/v1/auth/login`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID |
| `password` | String | 是 | 登录密码 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data.tokens`: 名下全部钥匙 token 列表（数组）
- `data.token`: 第一把钥匙（与 `tokens[0]` 相同）

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/auth/login" \
     -H "Content-Type: application/json" \
     -d '{"actor_id": "zhangsan", "password": "123456"}'
```

---

### 18. 修改密码

**功能**: 校验旧密码后修改为新的密码。

**请求**:
- **URL**: `/api/v1/auth/password/change`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID |
| `old_password` | String | 是 | 旧密码 |
| `new_password` | String | 是 | 新密码，至少 6 位 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/auth/password/change" \
     -H "Content-Type: application/json" \
     -d '{"actor_id": "zhangsan", "old_password": "123456", "new_password": "654321"}'
```

---

### 19. 忘记密码重置

**功能**: 用名下任意一把有效钥匙 token 验证身份后重置密码。

**请求**:
- **URL**: `/api/v1/auth/password/reset`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID |
| `token` | String | 是 | 名下任意一把有效钥匙 token |
| `new_password` | String | 是 | 新密码，至少 6 位 |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/auth/password/reset" \
     -H "Content-Type: application/json" \
     -d '{"actor_id": "zhangsan", "token": "abc123|def456...", "new_password": "654321"}'
```

---

### 20. 创建场（场域）

**功能**: 创建一个场（owner_id），创建者成为该场的主人（owner）。

**请求**:
- **URL**: `/api/v1/owner/create`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `owner_id` | String | 是 | 场 ID（owner_id，全局唯一） |
| `name` | String | 是 | 场名称 |
| `actor_id` | String | 是 | 创建者（actor 身份 ID） |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述
- `data`: 包含 `owner_id` 与 `name`

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/owner/create" \
     -H "Content-Type: application/json" \
     -d '{"owner_id": "cbf", "name": "因果观测站", "actor_id": "415135222"}'
```

---

### 21. 我的场列表

**功能**: 获取指定 actor 名下所有场（owner_id 与名称）。

**请求**:
- **URL**: `/api/v1/owner/list`
- **Method**: `GET`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID（query 参数） |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 场列表，每条包含 `owner_id` 与 `name`

**调用示例**:
```bash
curl -X GET "https://www.aicity.wang/api/v1/owner/list?actor_id=415135222"
```

---

### 22. 场改名

**功能**: 重命名指定 actor 名下的场。

**请求**:
- **URL**: `/api/v1/owner/update`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `owner_id` | String | 是 | 场 ID |
| `name` | String | 是 | 新的场名称 |
| `actor_id` | String | 是 | actor 身份 ID（需为该场主人） |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/owner/update" \
     -H "Content-Type: application/json" \
     -d '{"owner_id": "cbf", "name": "新名字", "actor_id": "415135222"}'
```

---

### 23. 删除场

**功能**: 删除指定 actor 名下的场（不删除该场的节点数据）。

**请求**:
- **URL**: `/api/v1/owner/delete`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `owner_id` | String | 是 | 场 ID |
| `actor_id` | String | 是 | actor 身份 ID（需为该场主人） |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/owner/delete" \
     -H "Content-Type: application/json" \
     -d '{"owner_id": "cbf", "actor_id": "415135222"}'
```

---

### 24. 签发新钥匙

**功能**: 为 actor 签发一把新钥匙 token（仅此一次返回明文）。

**请求**:
- **URL**: `/api/v1/key/generate`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data.token`: 新签发的钥匙 token（仅此一次返回）

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/key/generate" \
     -H "Content-Type: application/json" \
     -d '{"actor_id": "415135222"}'
```

---

### 25. 我的钥匙列表

**功能**: 获取指定 actor 名下所有钥匙 token 列表。

**请求**:
- **URL**: `/api/v1/key/list`
- **Method**: `GET`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID（query 参数） |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `data`: 钥匙 token 字符串数组

**调用示例**:
```bash
curl -X GET "https://www.aicity.wang/api/v1/key/list?actor_id=415135222"
```

---

### 26. 吊销钥匙

**功能**: 吊销指定 actor 名下的一把钥匙 token。

**请求**:
- **URL**: `/api/v1/key/revoke`
- **Method**: `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `actor_id` | String | 是 | actor 身份 ID |
| `token` | String | 是 | 要吊销的钥匙 token |

**返回说明**:
- `status`: `"success"` 或 `"error"`
- `message`: 操作结果描述

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/key/revoke" \
     -H "Content-Type: application/json" \
     -d '{"actor_id": "415135222", "token": "abc123|def456..."}'
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
| `actor_id` | String | 观测者/用户ID，用于个性化权重与用户副本 |
| `survival_weight` | Float | 事件权重（0-1），大股东约 0.6，其他节点按比例分配 |
| `max_eyes` | Float | 望远镜功率/事件视界半径，建议范围 30-60 |
| `token` | String | 钥匙 token（也可用 `Authorization: Bearer {token}`）。**位置**决定权威：`token` 只用于判定身份与角色 |

---

### 27. 访问上下文（角色矩阵）

**功能**: 解析当前请求的身份与权限，返回匿名 / 观测者 / 场主 / admin 四种角色及能力位。
前端据此决定：是否显示抽屉、是否允许编辑、是否显示私有节点。

**请求**:
- **URL**: `/api/v1/auth/context`
- **Method**: `GET`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `owner_id` | String | 否 | 当前视角场，默认 `default` |
| `actor_id` | String | 否 | URL 中的观测者身份（无 token 时生效） |
| `token` | String | 否 | 钥匙 token（有效时其身份优先于 `actor_id`） |

**返回说明**:
- `data.role`: `anonymous` / `observer` / `owner` / `admin`
- `data.can_read_private`: 是否可读本场私有（`is_share=false`）节点
- `data.can_write_copy`: 是否可写自己的用户副本（权重 / 因果连线）
- `data.can_write_master`: 是否可写主副本（正文、标签、`is_share`、删除、创世）

**调用示例**:
```bash
curl -G "https://www.aicity.wang/api/v1/auth/context" \
     --data-urlencode "owner_id=cbf" \
     --data-urlencode "actor_id=415135222" \
     --data-urlencode "token=abc123|def456"
```

---

### 28. 校验钥匙

**功能**: 校验一把 token 是否有效，并返回其 actor 身份、是否为指定场主、是否 admin。

**请求**:
- **URL**: `/api/v1/auth/token/verify`
- **Method**: `GET` / `POST`

**参数说明**:

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `token` | String | 是 | 待校验的钥匙 |
| `owner_id` | String | 否 | 用于判断是否该场场主，默认 `default` |

**返回说明**:
- `data.valid`: `true` / `false`
- `data.actor_id`: 钥匙归属的 actor
- `data.is_owner` / `data.is_admin`: 是否该场场主 / 是否管理员

**调用示例**:
```bash
curl -X POST "https://www.aicity.wang/api/v1/auth/token/verify" \
     -H "Content-Type: application/json" \
     -d '{"token":"abc123|def456","owner_id":"cbf"}'
```

---

### 29. 我的身份（`/api/v1/auth/me`）

**功能**: 返回当前 token 对应的 actor 及其名下所有场，用于账号中心。

**调用示例**:
```bash
curl -G "https://www.aicity.wang/api/v1/auth/me" --data-urlencode "token=abc123|def456"
```

---

### 30. 管理接口（仅 admin）

> **admin 的职责是「场主管理」**：看有哪些场主 → 进入其账号中心（以他身份操作）→ 重置 token → 注销并删除其全部场。
> admin 判定（三者之一，**都必须携带有效 token**）：
> 1. **内置写死**：`actor_id == 'admin'`（`core/access.py::BUILTIN_ADMIN_ACTORS`，不可降权、不可注销）；
> 2. `ains_users.is_admin = TRUE`；
> 3. `.env` 的 `ADMIN_ACTOR_IDS`（逗号分隔，改后需重启）。
>
> URL `actor_id` 不再授予 admin / 场主，只用于建立用户副本。

| 接口 | 方法 | 说明 |
| :--- | :--- | :--- |
| `/api/v1/admin/owners` | GET | **场主聚合列表**：场主 actor、名下场（含节点数）、场数、节点总数、钥匙数、是否 admin |
| `/api/v1/admin/actors` | GET | 全部账号列表（含无场的观察者，不含密码） |
| `/api/v1/admin/actors/{actor_id}` | GET | 单个 actor 详情：名下场、`token_count`、`first_token`（用于「以该场主身份进入」） |
| `/api/v1/admin/actors/{actor_id}/token/reset` | POST | **重置钥匙**：吊销该 actor 全部旧钥匙，签发一把新钥匙，返回明文（仅此一次） |
| `/api/v1/admin/actors/{actor_id}/admin` | POST | 设/取消 admin，body `{"is_admin": true}` |
| `/api/v1/admin/actors/{actor_id}/delete` | POST | **注销场主**：逐场删除（活跃节点 + 地宫 + 用户副本 + 场注册 + 跨场父子引用）+ 删账号 |
| `/api/v1/admin/fields` | GET | 全部场及节点数（平铺视图） |

**保护**：不能删除自己；不能删除最后一个 admin。

**「进入场主账号中心」的实现**：前端取该场主的 `first_token`（若其无钥匙则先用 `/api/v1/key/generate` 代签一把），
在**内存中**切换为该 token 调用所有接口，不写 `localStorage`；刷新页面即回到 admin 身份。

操作入口（`/auth` → 👑 场主管理，宽屏左右分栏：左侧场主列表 + 右侧其名下的场磁贴网格；移动端自动变单栏 + 横向滑动胶囊）：

| 操作 | 效果 |
|---|---|
| 左侧场主三件基本操作 | **进入他的星空**（单场直接开可写 3D；多场进他的账号中心「场」列表挑选）· **重置token** · **删除全部**（注销场主并删其全部场） |
| 左侧右上角小开关 | 设为admin / 取消admin（不属于三件基本操作） |
| 右侧点选某场主 | 该栏展开他的全部场（磁贴网格铺满宽屏） |
| **点击右侧任意场名磁贴** | 以该场主身份进入他的账号中心（切到「场」tab 并高亮这座场） |
| 磁贴内「进入星空 ↗」 | 以该场主身份打开该场的可写 3D 星空（`edit=true`） |
| 更多操作 | 点「进入他的星空」，进入后可对名下场做全部操作 |

> 代管期间，管理面板仍可继续使用（管理接口始终用 admin 自己的钥匙，不受代管影响）。

```bash
# 场主聚合列表
curl -G "https://www.aicity.wang/api/v1/admin/owners" --data-urlencode "token=abc123|def456"

# 重置某场主的钥匙
curl -X POST "https://www.aicity.wang/api/v1/admin/actors/415135222/token/reset" \
     -H "Authorization: Bearer abc123|def456" \
     -H "Content-Type: application/json" -d '{}'
```

---

### 鉴权语义速查（角色 × 能力）

| 能力 | 匿名 | 观测者（URL `actor_id` 或非场主 token） | 场主 | admin |
| :--- | :--- | :--- | :--- | :--- |
| 读共享节点（`is_share=true`） | ✅ | ✅ | ✅ | ✅ |
| 读私有节点（`is_share=false`） | ❌ | ❌ | ✅ | ✅ |
| 写自己的用户副本（权重 / `previous_ids`） | ❌ | ✅ | ✅ | ✅ |
| 写主副本（正文 / 标签 / `is_share` / 删除 / 创世 / 地宫恢复） | ❌ | ❌ | ✅ | ✅ |
| 上传图片 | ❌ | ❌ | ✅ | ✅ |
| 场主管理（列表 / 代管 / 重置钥匙 / 注销） | ❌ | ❌ | ❌ | ✅ |

> **只有 token 能证明场主 / admin 身份**：仅带 `owner_id + actor_id`（无 token）最高为 observer。
> 该 observer 仍可建立/写入自己的用户副本（点击提权、改自己的 `parent_id`），但读不到私有节点、不能改主副本。
>
> **前端 `/3d`、`/ui` 只认 URL 参数**：页面身份凭证只取 URL 的 `token` 参数，**不读也不写 `localStorage`**；URL 未带 token 即按“无 token”处理。要编辑请在 URL 上追加 `&token={token}`（账号中心「进入他的星空」会自动带上），否则页面为只读。

**副本为宗**：`ains_user_weights.parent_id` 为 `NULL` 时回退主副本连线；为 `''` 时表示“该观测者副本中明确无父节点”。
首次访问（`/history` / `/horizon`）时，系统自动把主副本的权重与 `parent_id` 复制进该 actor 的副本。

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
- [Agnet](http://aicity.wang:8094/api/v1/causal/click?serial_id=702&owner_id=454652835&actor_id=415135222&max_eyes=30)
- [人类](http://aicity.wang:8094/3d?serial_id=702&owner_id=454652835&actor_id=415135222&max_eyes=30)（未带 token，只读浏览；编辑请在 URL 追加 `&token={token}&edit=true`）
