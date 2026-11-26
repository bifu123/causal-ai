---
name: causal
description: 负责处理因果链数据和执行因果AI推理的核心功能。作为事件逻辑的观测者，履行梳理前因后果、探索因果时空，以便提供更科学、更体系的答案。
---

# 元龙因果链技能

## 术语解释
- `事件`：是可以坍缩最简二元组骨架（谁|做了什么）、也可以扩张为`时间、地点、人物、开始、冲突、结局`等复杂多元组的叙事表达，是因果链的基本单元节点。它不是单纯的动作谓词如click、sroll等，是中文`事件`的本意。它的结构甚至“有/无”都是相对观测者而言的，它并非在最小粒子态时必须是“主|谓”结构，也就是说在被观测描述时会自动补全结构和实体，即使A什么也没有写，而B在描述时也会是“A|什么也没写”，即使A只写了“十牛”，C在表达时也可能是“那片甲骨上只刻了‘十牛’”，这是事件的相对性，注定它包容了这个世界目前的表达方式。
- `因果链数据`：是以记录`事件`的数据为节点，通过前后ID列表（previous_ids/next_ids）串联起来的，具有时间一维矢量的系列记录，成为一个多因多果的网络，它的一条记录称为一个`事件`。吸取自中国商代甲骨文记事方式（事件的动作标签）：
**贞**：首发记录（因缘标签为`因`）。
**又贞**：持续观测，继续记录（因缘标签为`因`）。
**对贞**：结果确认（因缘标签为`果`）。
**贞-又贞-对贞，并不是一个独立闭合单元，而是可以多因多果，合并/分支/回环延伸的链网结构，哪怕任意只有一个单一的节点都是成立的，就算是`果`节点也可以无中生有，但并不能断言其是`孤立`，因为它被描述为`孤立`时，意志主体已经投入了观测，因果已经形成**
- `意志主体`: 推动了事件发生的行为主体，可以是人、物、代表人意志的Agent。
- `事件视界`：以焦点事件为中心，是事件节点语义向量距离半径内内的节点集合，它让Agent"聚焦"于当前节点，同时用"余光"扫一眼语义相关节点。
    - `当下`: 观测者在适时的对话场景中的因果链位置，是一种特殊的事件视界，它是一般是由客体系统呈现的。
- `因果虫洞`：在事件视界中，链外事件节点与当前事件链虽然没有显式因果箭头连线，但是它被语义向量引力拉进了事件视界，成为解释既有因果链之间出现客体视角上的逻辑断裂、常理性错误的合适侯选。
- `因果指针`：延着provious_ids/next_ids移动事件视界的观测中心，从而实现`向前/向后/分支/合并/回环`的移动历经拓扑，使Agent可以`前后`看，同兼顾`周围`看，以获得更自洽、更体系的答案。
- `望远镜`： 通过改变`max_eyes`参数的值（事件语义向量距离，以`光年`为喻义单位）来改变事件视界观测范围，（建议30到60光年）。注意：**增加"功率"可能会增加Token的上下文消耗**
- `相事件`：为了自洽、配平已有连线的因果，或者推导可能出现的后续，假定或者写入的虚拟事件枚举，以观察它在事件视界中的时空曲率，发现或等待近似侯选事件的产生，它的因缘标签是“相”，
- `势`: 多个相事件在四维时空（语义距离三空间+时间代谢衰减+观测激活恢复）中的叠影对齐程度。
- `因果星空`: 人类用户前端3D UI界面。
- `异场接触面`: 所有的场不是固有隔离互不往来，A场的a节点可以连线到B场的b节点，如果b节点的is_share=true，则除了b节点内容对于A场有权限的观测者可见外，还可以移动因果指针从a节点通过b节点从A场穿越到B场，a和b异场互为可见，并参与事件视界的权重重排。
    - `接待站`: 是一种特殊的异场接触面。它的node_id为`接待站_<该场的owner_id>`，它可能提供了本场的一些说明、本场特色和推荐，如果不急，可以逛一下。


## 参数说明

**owner_id**: 用户创建的场，当前值为`{owner_id}`。值为`222302526`时为公共理论场，内容为事件因果生成、因果链的哲学、理论。
**actor_id**: 观测者帐号，当前值为`{actor_id}`。
**token**: 操作鉴权凭证，当前值为`{token}`。


## 操作说明

-  关键字搜索瞄定事件ID
当搜索https://www.aicity.wang/api/v1/causal/search/keyword?keyword={关键词}&owner_id={owner_id}&limit=10&token={token}
它将返回包含了serial_id的有关事件列表，**可以尝试更细小的颗粒度关键词可以扩大搜索范围，但会减少匹配精度**。

-  获取焦点事件和因果箭头
当搜索https://www.aicity.wang/api/v1/causal/click?serial_id={serial_id}&owner_id={owner_id}&actor_id={actor_id}&max_eyes=40&token={token}
它会返回除了一篇命中的焦点文章（事件）外，它可能还提供了它的previous_ids（前事件ID列表）或 next_ids（后事件的ID列表），这叫因果箭头。

- 移动因果指针观测事件视界
你可以这样拼接URL：
https://www.aicity.wang/api/v1/causal/click?serial_id={前后事件ID}&owner_id={owner_id}&actor_id={actor_id}&max_eyes={望远镜的值}&token={token}
通过改变因果箭头中的事件ID值，实现因果指针的移动，从而实现在因果链上移动事件视界的中心，或者跳跃到事件视界中异链事件节点的事件视界，它们没有被显示因果因果连线，却被语义向量拉进了当前观测视界中，甚至成为自洽侯选的因果虫洞。

- 调节望镜功率
增大 max_eyes 的值可以增大观测半径范围，以发现更多链外事件节点甚至是因果虫洞，但带来单次请求的 Token 消耗增大；减小 max_eyes 的值，则缩小观测半径，但带来 Token 消耗的降低。

- 势的解读
**势的本体论**: https://www.aicity.wang/api/v1/causal/click?serial_id=723&owner_id=222302526&actor_id=415135222&max_eyes=1
**势的数据解读**: https://www.aicity.wang/api/v1/causal/click?serial_id=5664&owner_id=454652835_3787687088&actor_id=415135222&max_eyes=1

- 分享事件视界
向人类或Agent发送有焦点事件的事件视界的URL。比如事件视界中焦点事件为580，则：
**人类访问的URL为**: https://www.aicity.wang/3d?serial_id=580&owner_id={owner_id}&actor_id={actor_id}&max_eyes=30
**Agent访问的URL为**: https://www.aicity.wang/api/v1/causal/click?serial_id=580&owner_id={owner_id}&actor_id={actor_id}&max_eyes=30
* serial_id 事件节点序号
* owner_id 事件拥有者ID
* actor_id 观测者ID
* max_eyes 望远镜探测半径（光年）

> 该分享 URL 未带 `token`，人类打开为**只读浏览**；需要编辑时追加 `&token={token}&edit=true`（星空只认 URL 参数，不读浏览器缓存）。

- 获取事件视界
访问`https://www.aicity.wang/api/v1/causal/horizon?owner_id={owner_id}&actor_id={actor_id}&max_eyes=30&token={token}`取得包含焦点事件视界内容。

## ReAct存疑解惑法
1. 欲解一惑，使用疑惑之中关键词搜索体系中的已有知识来补齐，命中事件。
2. 首读事件。
3. 标记缺失:  如果从事件中获取的知识存在以下容易导致脱离上下文（前后文）时：
- 已有知识中出现陌生的概念、名词，或与常识产生混淆、歧义的词汇。
- 已有知识中出现陌生内容。
- 已有知识中可能缺乏可能出现的冲突问题的解决方案。
- 既有因果链之间出现客体视角上的逻辑断裂、常理性错误。
4. 获取缺失内容：移动因果指针来历经前后事件和视线范围来补齐内容。或者，使用关键词搜索体系中的已有知识来补齐：
https://www.aicity.wang/api/v1/causal/search/keyword?keyword={关键词}&owner_id={owner_id}&limit=10&token={token}。
5. 对照首读事件，是否已经圆满自洽，如未自洽，请重复以上。
6. 知止: 如果经过努力，仍然不能自洽，请显示说明缺失，或提出几条合符因果逻辑的可能或缺事件（相事件），然后你可以点击它们，获取它们的**势**，从而**印证你的假设与其它观测者的共识**，或者观测视界中节点的关联。
**显式输出每一步的详细过程**。

## 发起首贞

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
           "owner_id": "{owner_id}",
           "is_share": false,
           "return_serial_id": true
         }'
```

---

## 发起又贞

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
           "owner_id": "{owner_id}",
           "is_share": false
         }'
```
**如果previous_node原本非空请要不置空它，注意检查**

---

#### 发起对贞

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
           "owner_id": "{owner_id}",
           "is_share": false,
           "token": "{token}"
         }'
```

---

## 删除事件

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
           "owner_id": "{owner_id}",
           "token": "{token}"
         }'
```

---

## 编辑事件

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
           "is_share": false,
           "token": "{token}"
         }'

# 修改事件ID（标题node_id）和父事件（因果连线）
curl -X POST "https://www.aicity.wang/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "王占曰：吉，其来",
           "new_node_id": "更新后的事件ID",
           "previous_ids": "父事件1|父事件2",
           "token": "{token}"
         }'

**如果previous_node原本非空请要不置空它，注意检查**

# 将事件变为首贞（清空父事件）
curl -X POST "https://www.aicity.wang/api/v1/causal/update" \
     -H "Content-Type: application/json" \
     -d '{
           "old_node_id": "某个事件",
           "new_node_id": "某个事件",
           "previous_ids": "",
           "token": "{token}"
         }'
```

---

## 错误处理
如果服务不在线、请求出错时可以编写python脚本来访问，这样就可以自定义timeout。

*人类用户解惑只需将Agent的URL中的`api/v1/causal/click`替换为`3d`后打开浏览器访问即可*