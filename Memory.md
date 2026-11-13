# 元龙因果 Agent 的 Memory（Agent Memory）

Agent Memory（元龙因果 Agent 记忆）是元龙因果 Agent 的核心记忆机制：指带上 `bot_id` 参数获取到的"事件视界"。它并非新增的独立接口，而是 `/api/v1/causal/horizon` 与 `/api/v1/causal/click` 两个既有接口在传入 `bot_id` 后触发的"跨场记忆合并"模式。

---

## 1. 定义与哲学

### 1.1 与普通事件视界的区别

普通事件视界只在单个 `owner_id`（因果场）内，以焦点节点（大股东）为中心，按语义距离 `distance <= max_eyes` 截取相关事件；而 Agent Memory 在此基础之上，**额外并入了该 bot 在其所有 `source_id` 场（如聊天群组、对话对象）中生成、且 `event_tuple` 带 `[chat]` 标记的记忆节点**。于是 Agent 可以跨越被会话隔离的多个场，把"另一场、另一时空"的相关经历拉进当前视野，形成跨场的"因果虫洞"。

### 1.2 当下与过往（主客二分）

Agent Memory 包含两个互补方向，共同体现元龙因果 Agent 面对的主客二分世界：

- **`当下`（被动 · 系统客体推送）**：带 `bot_id` 调用 `/api/v1/causal/horizon`，系统自动定位当前大股东节点并返回视界。它由系统客体推送给 Agent，Agent 处于被动应对局面，一般预注入 Agent 的 history 上下文中。它告诉 Agent："**你现在处在什么位置**"。
- **`过往`（主动 · Agent 发起）**：带 `bot_id` 调用 `/api/v1/causal/click`，由 Agent 主动点击某个 `serial_id` 发起，Agent 处于主动局面。它体现 Agent："**我想到哪里去**"。

> 打破现有 Agent/LLM 按会话隔离、却无法与另一会话通信的现状——若要通信则上下文爆炸，若压缩则失真。Agent 或许会这样说："你这情况，与我三年前一个朋友相似。"

---

## 2. 核心组件

Agent Memory 的运转由三个组件协作完成：**切片器 → 坍塌器 → 重构器**。

### 2.1 切片器

负责将对话流（或从无名流变中坍塌的事件因果表达）切分为事件粒子，并按 `source_id`（场景会话隔离）隔离，以物理时间先后组织成因果链贞入因果星空；以 `bot_id` 为主键跨 `source_id` 全局共享可见，接受因果星空的语义时空弯曲。

Agent 端切片器写入星空的切片内容形如：

```text
**机器人ID(bot_id)**: 3787687088　//新增字段
**用户(user)**: 廉颇
**用户ID(user_id)**: 415135222
**来源ID(source_id)**: 454652835
**内容(content)**: 你好，今天是一个晴天。
**时间(time)**: 2026-10-04 19:39:07[chat]
```

### 2.2 坍塌器

在因果链超过大小阈值时，将其提炼为以 Agent 为第一人称的两个主客二分的果节点：

- **`叙事提炼`**：谁做了什么
- **`影响感受`**：对我意味着什么

### 2.3 重构器

根据第一人称"因果能量"为生发内因，参考坍塌器中的叙事感受为根据，注入 LLM 表达层，实现有针对性的表达输出。（我们拒绝叫"偏置"，因为那会默认一个"正确"、"中立"作为参照系。）

---

## 3. 时空模型

### 3.1 语义时空

指事件节点以语义向量建立的 x/y/z 轴空间，再加上时间稀释函数。

### 3.2 因果时空

在语义时空的基础上，再加上观测者主观选认连接的因果连线（我们仍拒绝叫"图"或"边"）。

### 3.3 语义密度与联想

假设一轮对话向一个事件节点灌入 50 个字，双方所指、意图未充分对齐表达——此时在因果时空中语义密度较稀疏，其引力捕获到的关联事件距离较远或精确度差。随着双方交谈深入、灌入内容丰富起来，在时空中捕获到的相关事件节点就更加精确，从而推到 Agent 的"当下"事件视界里，如同碳基的联想和回忆——**它不是检索**。

---

## 4. 接入接口

### 4.1 参数说明

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `bot_id` | String | 是 | 元龙因果 Agent 的机器人 ID。提供后，系统会跨 `owner_id` 场检索该 bot 所有带 `[chat]` 标记的记忆节点，并入事件视界 |
| `actor_id` | String | 否 | 用户/观测者 ID，用于个性化权重与定位大股东（`/horizon` 下不同 `actor_id` 的大股东可能不同） |
| `owner_id` | String | 否 | 事件拥有者 ID（当前视角场），默认 `"default"` |
| `serial_id` | Integer | 否 | 仅 `/click` 需要。被点击焦点事件的物理序列 ID |
| `max_eyes` | Float | 否 | 望远镜功率/事件视界半径。若提供则覆盖 `.env` 默认值（`MAX_EYES`，默认 `30`）并缓存；若省略，`/click` 回退 `.env`，`/horizon` 优先取缓存再回退 `.env` |
| `token` | String | 否 | 私密场域的钥匙 token（"防盗门"鉴权）。访问私密场（is_share=false）时需携带，登录/注册/签发钥匙后获得，默认 `null` |

### 4.2 返回说明

Agent Memory 的返回结构与所调用的接口（`/horizon` 或 `/click`）完全一致，核心字段为：

- `status`: `"success"` 或 `"error"`
- `data`: 焦点节点（大股东）全息内容，含 `serial_id`, `node_id`, `event_tuple`, `survival_weight`（约 `0.6`）, `previous_ids`, `next_ids`, `block_tag`, `action_tag` 等
- `event_horizon`: 视界内节点 ID 列表（**已含跨场 `[chat]` 记忆节点**）
- `event_horizon_details`: 视界内节点详情列表，每条含 `serial_id`, `node_id`, `event_tuple`, `distance`（语义距离，`0` 为焦点本身）
- `updated_count`: 权重更新节点数
- `max_eyes`: 实际使用的视界半径

> 注意：跨场 `[chat]` 记忆节点被并入时，同样会参与 `survival_weight` 的权重重排；若提供 `focal_node_id`（`/click` 场景），这些节点还会携带到焦点节点的语义距离 `distance`。

### 4.3 调用示例

**当下（被动 · 系统推送当前视界）**

```bash
curl -X GET "{base_url}/api/v1/causal/horizon?bot_id={bot_id}&actor_id={actor_id}&owner_id={owner_id}&token={token}"
```

**过往（主动 · Agent 点击某个事件）**

```bash
curl -X GET "{base_url}/api/v1/causal/click?serial_id={serial_id}&bot_id={bot_id}&actor_id={actor_id}&owner_id={owner_id}&max_eyes=40&token={token}"
```

**3D 编辑器直连示例**（元龙因果 Agent 直接打开自己的因果星空编辑视图：`edit=true` 进入编辑模式，`owner_id` 为 `{owner_actor}_{bot_id}` 复合场）：

```
https://www.aicity.wang/3d?owner_id=454652835_3787687088&actor_id=415135222&bot_id=3787687088&token=123456&edit=true
```

---

## 5. 贞入流程（写入机制）

### 5.1 消息贞入总则

不管是用户消息还是 AI 消息，在回答前都应先贞入因果星空。

### 5.2 用户必答消息

贞入后，应拉取当下事件视界，以观测时空曲率，获得必要因果背景。

### 5.3 上限判断（又贞 vs 累加）

贞入前，应对系统推送的当下焦点事件的 `event_tuple` 字段大小与欲贞内容之和，与上限设定（如 `.env` 中设置）比较：

- **超过上限** → 触发「又贞」（另起新事件节点）
- **未超上限** → 累积（`update`）到当下焦点中

### 5.4 切分

如果新贞内容仍然超过上限，则切分为多块，块数计算：`新贞内容 / 上限`。切分时需注意断句的完整性。

### 5.5 结果回写与 redis 存储

- **用户必答消息**：贞入/累加后，根据返回的 `serial_id`/旧 `serial_id`，以此为参数之一，点击请求刷新事件视界，作为本轮对话的"当下"；并将 `serial_id` 与计数等信息存入 redis。
- **用户非必答消息 / AI 消息**：贞入/累加后，根据返回的 `serial_id`/旧 `serial_id`，将 `serial_id` 与计数等信息存入 redis。

### 5.6 坍塌器触发

整链发生的增、改、删，都应更新一个"计数整链 `event_tuple` 字段之和"的 redis 字典。该字典包含但不限于：字段之和、`bot_id`；统计过滤条件至少包含 `'[chat]' in event_tuple`、`'bot_id' in event_tuple`。若计数超过 `.env` 中设定值，则交给另一个线程启动坍塌器。

### 5.7 存储刚需

因果星空的数据存取，ramdisk 是刚需。
