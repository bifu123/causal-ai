# 在 web 端中实现因果星空的注册与分发（客户端视角）

> 文档对象：**本项目的 web 前端开发者**
> 你手里只有三样东西：页面的 DOM、浏览器 API、因果星空的 HTTP 接口
> 本文档不涉及服务端内部实现，所有结论都落成「你该发什么请求、拿什么字段、拼什么 URL、显示什么文案」

---

## 0. 先看这里：你所在的系统

你是**客户端**，因果星空是**远端服务**。二者通过 HTTP 交互。

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  你的 Web 页面（客户端）      │        │  因果星空（远端）              │
│                              │        │                              │
│  statusBar                   │        │  /api/v1/auth/*              │
│   ├ 表单（场名/类型/...）     │ ─────▶ │  /api/v1/owner/*             │
│   └ #globalEditBtn（发布）    │  HTTP  │  /api/v1/causal/*            │
│                              │        │                              │
│  通知栏（表单下方）           │ ◀───── │  /3d  （星空页，你只拼 URL）   │
│  fabCausal（进星空）          │        │  /auth（账号中心，你只给链接） │
│  分享按钮                     │        │                              │
└─────────────────────────────┘        └──────────────────────────────┘
```

**重要前提**：

1. 你页面上的 `statusBar`、`#globalEditBtn`、`fabCausal`、分享按钮，**都是你自己要实现的 DOM**，远端没有、也不需要。
2. 星空页 `/3d` 与账号中心 `/auth` **不是你写的页面**，你只负责生成指向它们的 URL。
3. 远端接口的字段约定以 `API_admin.md` 为准，但**有 3 处与文档不符**，见 §6，按本文档写。
4. **`author_id` 字段远端目前不认识**，第一阶段客户端不要发，留到第二阶段。

---

## 1. 你要交付的四件事

| # | 交付物 | 触发点 | 用户看到什么 |
| :--- | :--- | :--- | :--- |
| 1 | 发布时注册 actor + 建场 | 点击 `#globalEditBtn` | 表单下方通知栏出现成功/失败提示，**不写入聊天区** |
| 2 | token 与单据持久化 | 上面成功后 | 刷新页面、URL 无参数时，表单自动回填 |
| 3 | 分享链接 | 点击分享按钮 | 一条可复制、含 `token` 与 `edit=true` 的 URL |
| 4 | 进入星空 | 点击 `fabCausal` | 新窗口打开该群的因果星空，成员可读可写 |

---

## 2. 服务端地址与通用约定

```js
const CAUSAL_BASE = 'https://www.aicity.wang';   // 上线环境
// 所有 POST 请求头：Content-Type: application/json
// 所有响应形如：{ status: 'success' | 'error', message?: string, data?: {...} }
```

**响应统一判断方式**（先判 `status`，再取 `data`，失败读 `message`）：

```js
async function callApi(path, payload, method = 'POST') {
  const res = await fetch(CAUSAL_BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(json.message || '因果星空接口调用失败');
  }
  return json.data;
}
```

**token 的传递方式**：放在请求 body 或 query 的 `token` 字段里，远端以此为准。

---

## 3. 发布流程（点击 `#globalEditBtn`）

### 3.1 你的表单需要哪几个字段

| 表单控件 | 变量 | 说明 |
| :--- | :--- | :--- |
| 场名输入框 | `name` | 例：`产品群星空` |
| 类型选择 | `method` | `group`（群聊）或 `private`（私聊） |
| 群 ID | `groupId` | 仅群聊需要；私聊留空 |
| bot 身份 | `botId` | 你当前这个 bot 的 ID |
| 用户身份 | `userId` | 仅私聊需要 |
| 密码 | `password` | ≥ 6 位；可用固定值或用户自设 |

**`actor_id` 不用用户填**，按类型算：

```js
// 群聊：观测位就是 bot 本身（全群共用一个观测副本）
// 私聊：观测位是该用户
const actorId = (method === 'group') ? botId : userId;
```

> **为什么群聊要用 `actor_id = bot_id`**：远端按 `actor_id` 给每个观测者存一份「权重与连线副本」，并据此决定「谁是当下焦点（大股东）」。
> 用 `bot_id` 做键，全群成员读写的是**同一份副本** → 大股东、权重、连线一致 → **群偏置成立**。
> 若改用 `user_id`，每人一份副本、互不干扰（平行宇宙），但**无法形成群偏置**。这是本方案的主动取舍。

### 3.2 发布 = 三步串行（顺序不能变）

```
① 注册（或登录）拿到 token
        ↓
② 用 token 建场，拿回 owner_id
        ↓
③ 用 owner_id + token 自检权限，确认是 owner
```

**① 注册 actor**

```js
// 成功返回：{ token: 'xxxx|yyyy' }   ← 明文只出现这一次，务必立刻保存
await callApi('/api/v1/auth/register', {
  actor_id: actorId,
  password: password,
});
```

若返回 `该 actor 已注册`，说明这个群 / 这个人以前建过，改走登录：

```js
// 成功返回：{ tokens: ['...'], token: '...' }
await callApi('/api/v1/auth/login', {
  actor_id: actorId,
  password: password,
});
```

**② 建场**

```js
// 成功返回：{ owner_id, name, method, bot_id, source_id }
const field = await callApi('/api/v1/owner/create', {
  name: name,
  method: method,                                 // 'group' | 'private'
  bot_id: botId,
  source_id: method === 'group' ? groupId : '',   // 私聊传空串
  actor_id: actorId,
  token: token,
});
const ownerId = field.owner_id;   // ★ 只能用它，不要自己拼
```

**③ 自检权限**

```js
// 成功返回：{ role, can_read_private, can_write_master, can_write_copy, ... }
const ctx = await callApi(
  `/api/v1/auth/context?owner_id=${encodeURIComponent(ownerId)}&token=${encodeURIComponent(token)}`,
  null, 'GET'
);
if (ctx.role !== 'owner') {
  throw new Error('场已创建，但权限校验未通过');
}
```

### 3.3 完整函数（可直接用）

```js
async function publishCausalField({ name, method, botId, groupId, userId, password }) {
  const actorId = (method === 'group') ? botId : userId;

  // ① 注册，已注册则登录
  let token;
  try {
    token = (await callApi('/api/v1/auth/register', { actor_id: actorId, password })).token;
  } catch (e) {
    if (!/已注册/.test(e.message)) throw e;
    token = (await callApi('/api/v1/auth/login', { actor_id: actorId, password })).token;
  }

  // ② 建场（可能已存在）
  let ownerId;
  try {
    const field = await callApi('/api/v1/owner/create', {
      name,
      method,
      bot_id: botId,
      source_id: method === 'group' ? groupId : '',
      actor_id: actorId,
      token,
    });
    ownerId = field.owner_id;
  } catch (e) {
    if (!/已经有了主人/.test(e.message)) throw e;
    ownerId = await resolveOwnerIdFromRemote(actorId, token, method, botId, groupId);
  }

  // ③ 自检
  const ctx = await callApi(
    `/api/v1/auth/context?owner_id=${encodeURIComponent(ownerId)}&token=${encodeURIComponent(token)}`,
    null, 'GET'
  );
  if (ctx.role !== 'owner') throw new Error('权限校验未通过');

  return { ownerId, actorId, token, botId, method, groupId, name };
}

// 场已存在时，从远端列表里按 method + bot_id 找回 owner_id
async function resolveOwnerIdFromRemote(actorId, token, method, botId, groupId) {
  const list = await callApi(
    `/api/v1/owner/list?actor_id=${encodeURIComponent(actorId)}&token=${encodeURIComponent(token)}`,
    null, 'GET'
  );
  const hit = (list || []).find(o =>
    o.bot_id === botId && (method === 'group' ? o.source_id === groupId : o.method === 'private')
  );
  if (!hit) throw new Error('该场已存在，但未能在你的场列表中找到，请联系管理员');
  return hit.owner_id;
}
```

> **为什么走 `/owner/list` 而不自己拼 `owner_id`**：见 §6 坑 ①。

### 3.4 通知栏（表单下方，**绝不写入聊天区**）

成功后渲染到通知栏：

```
注册场和 actor 成功：场 <owner_id>，Actor <actor_id>，bot_id <bot_id>
可凭 token <token> 到 http://www.aicity.wang/auth 中登录管理此场
⚠ 此钥匙即场主钥匙，可增删改本场全部节点（含删除整场），请仅在本群内分发
（钥匙仅显示一次，已存入本机）
```

失败时按 `message` 映射成人话：

| 远端 message / 场景 | 通知栏文案 |
| :--- | :--- |
| `密码至少 6 位` | 密码至少 6 位 |
| 登录返回 `密码错误` | 这个场之前已注册过，请确认密码 |
| `该场已经有了主人…` | 该场已存在，已自动复用 |
| `场名称、actor_id 均必填` | 请补全场名后重试 |
| `机器人 ID（bot_id）必填` | 未获取到 Bot 身份，请刷新页面后重试 |
| `群聊场景必须填写群 ID（source_id）` | 未获取到群 ID，请刷新页面后重试 |
| 其他 / 网络异常 | 创建失败：`<message>`，请稍后重试 |

---

## 4. 分享（点击分享按钮）

### 4.1 生成的 URL

```js
function buildShareUrl({ ownerId, botId, token, maxEyes = 40 }) {
  return CAUSAL_BASE + '/3d'
    + '?owner_id='  + encodeURIComponent(ownerId)
    + '&actor_id='  + encodeURIComponent(botId)     // 观测位：用 bot
    + '&bot_id='    + encodeURIComponent(botId)     // 必须带，否则看不到 bot 的记忆
    + '&max_eyes='  + encodeURIComponent(maxEyes)   // 望远镜功率，建议 30~60
    + '&token='     + encodeURIComponent(token)     // 写权限的唯一来源
    + '&edit=true';                                 // 点节点自动开编辑抽屉
}
```

**六个部分缺一不可**：

| 参数 | 缺了会怎样 |
| :--- | :--- |
| `owner_id` | 打开的是默认场，什么都没有 |
| `actor_id` | 变成匿名浏览，看不到私有节点 |
| `bot_id` | 看不到 bot 的 Memory 与主观感受（记忆不合并） |
| `max_eyes` | 用远端默认值，事件视界可能过大/过小 |
| `token` | **只能看，不能写**（抽屉里没有「贞」按钮） |
| `edit=true` | 能写但要手动点按钮才开抽屉，体验差 |

### 4.2 分享前自检（强烈建议）

```js
const ctx = await callApi(
  `/api/v1/auth/context?owner_id=${encodeURIComponent(ownerId)}&token=${encodeURIComponent(token)}`,
  null, 'GET'
);
if (!ctx.can_write_master) {
  showToast('当前 token 对该场没有写权限，分享出去将是只读');
}
```

### 4.3 给用户的话术（建议加在复制按钮旁）

> 此链接包含群主钥匙：任何拿到链接的人都能修改、甚至删除本群星空。
> 只发到本群，不要外传。

**这是本方案的既定取舍**：允许成员共掌方向盘，风险回押到群内的现实信任关系。

---

## 5. 进入星空（`fabCausal`）与本地持久化

### 5.1 `fabCausal` 点击

直接复用分享 URL（token 通常就是同一把）：

```js
window.open(buildShareUrl({ ownerId, botId, token }), '_blank');
```

### 5.2 本地存储结构

```js
// localStorage key: 'causal_fields'
{
  "<owner_id>": {
    owner_id: "21122263971@chatroom_wxid_xxx",
    name: "某某群星空",
    method: "group",
    actor_id: "wxid_xxx",
    bot_id: "wxid_xxx",
    source_id: "21122263971@chatroom",
    token: "1a2b3c4d5e6f|9f8e7d6c5b4a39281706f5e4d3c2b1a0",
    created_at: "2026-11-20T10:00:00+08:00"
  }
}
```

```js
const LS_KEY = 'causal_fields';
const loadFields = () => JSON.parse(localStorage.getItem(LS_KEY) || '{}');
const saveField = (f) => {
  const all = loadFields();
  all[f.owner_id] = f;
  localStorage.setItem(LS_KEY, JSON.stringify(all));
};

// 按「当前场景 + 当前 bot」找单据
function findField({ method, botId, groupId, userId }) {
  const actorId = method === 'group' ? botId : userId;
  return Object.values(loadFields()).find(f =>
    f.actor_id === actorId && f.bot_id === botId &&
    (method === 'group' ? f.source_id === groupId : f.method === 'private')
  ) || null;
}
```

### 5.3 回填时机

页面加载时：

```js
const saved = findField({ method: currentMethod, botId, groupId, userId });
if (saved) {
  fillForm(saved);   // 回填场名、类型、群 ID，供用户确认后直接进星空或重发
}
```

**注意**：`token` 只在你自己的本地存储里，**不会**因为星空页 URL 没带参数就自动生效（见 §7 铁律）。

---

## 6. 三个必须绕开的坑（接口实际行为与文档不一致）

### 坑 ①：`owner_id` 不是客户端拼的

`API_admin.md` 第 20 节写着「请求体传 `owner_id`」，但**实际接口不接收该字段**——它由远端根据 `method`、`actor_id`、`bot_id`、`source_id` 自动生成：

| 类型 | 远端生成的 `owner_id` 形态 |
| :--- | :--- |
| 私聊 `private` | `{actor_id}_{bot_id}` = `{userId}_{botId}` |
| 群聊 `group` | `{source_id}_{bot_id}` = `{groupId}_{botId}` |

> 后果：若你按文档自己拼 `owner_id` 并用于后续请求，很可能与远端生成的不一致，导致「**场建了但打不开**」。

**正确做法**：只用 `owner/create` 返回的 `data.owner_id`；场已存在时用 `/owner/list` 查回来。

### 坑 ②：私聊场会互相撞车

远端生成规则里没有 `method` 参与，只有 `actor_id`（或 `source_id`）与 `bot_id`。
所以**若私聊也把 `actor_id` 设成 `bot_id`**，则：

- 所有用户与同一个 bot 的私聊，都会落到同一个场 `{botId}_{botId}` → **互相看到彼此的私密对话**；
- 且与「群聊用 bot_id 做 actor」的语义完全混淆。

**正确做法**：

```js
const actorId = (method === 'group') ? botId : userId;   // 群聊 bot，私聊用户
```

如此得到：

| 场景 | 结果 `owner_id` | 是否互相隔离 |
| :--- | :--- | :--- |
| A 群 + botX | `{群A_ID}_{botX}` | 与 B 群隔离 |
| B 群 + botX | `{群B_ID}_{botX}` | 与 A 群隔离 |
| 用户甲私聊 botX | `{用户甲}_{botX}` | 与其他用户隔离 |
| 用户乙私聊 botX | `{用户乙}_{botX}` | 与其他用户隔离 |

**一把钥匙开多套房**：`botX` 的 token 可进入它参与的全部场（两个群 + 每个私聊用户各一场），这正是「场主钥匙」的含义。

### 坑 ③：`edit=true` 不等于有写权限

`edit=true` 只做一件事：**点节点时是否自动弹出编辑抽屉**。
真正的写权限来自 `token`：

| 打开时带的 token | 效果 |
| :--- | :--- |
| 场主本人的 token（分享的那把） | 可读全部节点（含未分享的私有节点）、可改内容、可删节点、可创世 |
| 其他 actor 的 token | 只能看被分享出来的节点，改不了内容 |
| 没有 token | 完全只读，私有节点不可见 |

**所以分享必须带 `token`，否则 `edit=true` 形同虚设。**

---

## 7. 客户端与服务端的职责边界

| 事项 | 谁负责 | 说明 |
| :--- | :--- | :--- |
| 保存 token、单据 | **客户端** | 存 `localStorage` |
| 生成含 token 的星空 URL | **客户端** | 星空页不会读你的 localStorage |
| 判断该群是否已建场 | **客户端** | 查本地单据 + `/owner/list` |
| 决定 `actor_id` 口径 | **客户端** | 群聊用 `bot_id`，私聊用 `userId` |
| 权限最终裁决 | **服务端** | `/auth/context` 返回的 `role` 为准 |
| 私有节点可见性 | **服务端** | 客户端无法绕过 |

**一条铁律**：星空页 `/3d` **只认 URL 里的 `token`**，URL 没带 token 就是「无 token 只读」。
所以**永远不要指望把 token 存到 localStorage 后、让星空页自己去取**——必须由你在打开链接时拼进 URL。

---

## 8. 用户旅程全流程

```
用户在某个群里首次使用
        │
        ├─ statusBar 表单：填场名、选「群聊」、自动带出群 ID 与 bot ID
        │
        ├─ 点 #globalEditBtn（发布）
        │    ├─ 注册 actor（actor_id = bot_id）
        │    ├─ 建场（method=group, source_id=群ID）
        │    ├─ 自检 role === 'owner'
        │    └─ 通知栏：成功 + owner_id + token + 「可凭 token 去 /auth 管理」+ 风险提示
        │
        ├─ 单据写入 localStorage
        │
        ├─ 点分享按钮
        │    └─ 生成含 owner_id/actor_id/bot_id/max_eyes/token/edit=true 的 URL
        │        群成员打开 → 星空页 → 场主视角 → 可读可写
        │
        └─ 再次打开网页（URL 无参数）
             └─ 从 localStorage 回填表单 → fabCausal 直接进星空
```

---

## 9. 联调自测清单

- [ ] 点发布后，通知栏出现且**聊天区没有任何系统消息**
- [ ] 通知栏里能看到 `owner_id`、`token`、`http://www.aicity.wang/auth`
- [ ] 用通知栏里的 token 打开 `/auth`，能登录并看到刚建的场
- [ ] 分享链接在**无痕窗口**打开（带 token）→ 能看到节点、能拖动、能点「贞」
- [ ] 同一链接删掉 `&token=...` 再打开 → 只能看到分享出来的节点，私有节点消失
- [ ] 同一链接删掉 `&bot_id=...` 再打开 → bot 的记忆/主观感受节点不再出现
- [ ] 刷新页面（URL 无参数）→ 表单被本地单据回填
- [ ] 同一 bot 在 A 群与 B 群各发布一次 → 两个场互不干扰，都能打开
- [ ] 同一用户私聊 与 该用户所在群 → 两个场互不干扰
- [ ] 发布同一群第二次 → 提示「该场已存在，已自动复用」，不报错

---

## 10. 第二阶段（本次不做，先不要发这些字段）

| 项 | 说明 |
| :--- | :--- |
| `author_id` | 远端目前**不认识**该字段。第一阶段如果发了，会被静默忽略（不报错），但也不产生任何效果。等第二阶段再把「谁写的」随请求带上，用于审计。 |
| 成员只读权限 | 目前只有「全权」与「只读」两档，没有「成员可读私有但不可改主副本」的中间档 |
| 场级钥匙 | 目前一把钥匙开该 actor 名下所有场，无法只授予某一个场 |
| 审计面板 | 目前无法查询「谁进过本场、谁改过哪些节点」 |

**第一阶段不要做的三件事**：
1. 不要发 `author_id`；
2. 不要为实现「成员只读」而额外拆一把钥匙（第二阶段才有意义）；
3. 不要在客户端缓存星空页的内部状态（星空页无状态，全靠 URL）。

---

## 11. 附：接口速查（你只需要这 6 个）

| 用途 | 方法 | 路径 | 关键入参 | 关键出参 |
| :--- | :--- | :--- | :--- | :--- |
| 注册 | POST | `/api/v1/auth/register` | `actor_id`, `password` | `data.token` |
| 登录 | POST | `/api/v1/auth/login` | `actor_id`, `password` | `data.token`, `data.tokens` |
| 建场 | POST | `/api/v1/owner/create` | `name`, `method`, `bot_id`, `source_id`, `actor_id`, `token` | `data.owner_id` |
| 我的场列表 | GET | `/api/v1/owner/list` | `actor_id`, `token` | `data[]`（含 `owner_id`） |
| 权限自检 | GET | `/api/v1/auth/context` | `owner_id`, `token` | `data.role`、`data.can_write_master` |
| 校验钥匙 | GET | `/api/v1/auth/token/verify` | `token`, `owner_id` | `data.valid`、`data.is_owner` |

> 其余接口（genesis / update / delete / horizon / click / search 等）由**星空页和 bot 自己**调用，你的客户端无需关心。

---

> **结论**：客户端侧不需要任何服务端改动即可完成第一阶段。
> 三条硬纪律：**`owner_id` 用远端返回值**、**`token` 才是写权限**、**星空页不读 localStorage**。




