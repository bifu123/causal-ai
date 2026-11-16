# 点击双圣光分析（Kimi）

> 代码位置：代码 VPS `192.168.66.39:/root/causal_ai`（PC/移动端同用 `static/js/3d_main.js`）
> 现象：移动端点击节点或拉动花杆，大股东节点出现两次圣光

---

## 一、结论（TL;DR）

单击/双击/右击在 PC/移动端的事件层冲突**已被现有五道闸覆盖，不是元凶**。

真正的漏口在**秒级时间尺度**：自己的 `/click` 请求经后端重排后，Socket 广播 `node_updated` **扇回发起者自己**，回声在点击 **3 秒以后**到达时，越过 `lastLocalActionTime` 冷却，走进 `updateNodeIncremental` 的"远端跃迁"分支，对大股东节点**第二次** `showDivineBeam()`，并伴随 2 秒相机跃迁。

移动端弱网 + 后端全量权重重排 + 事件视界计算，使 `/click` 端到端耗时跨过 3 秒成为可能；PC 端回声在 3 秒内到达被冷却挡住，因此**只有移动端复现**。

---

## 二、单击 / 双击 / 右击链路排查：都有闸

### 库层（3d-force-graph.min.js）

- kapsule 只在 container 上绑定 `'click'`（`.clickAfterDrag(!1).onClick(...)`），右键走 `'onRightClick'`。
- 移动端 tap = touchstart/touchend → 浏览器合成**一次** click；PC 单击也是一次 click。**库层本身不双发**。

### 应用层已有的五道闸（`3d_main.js`）

| 闸 | 位置 | 覆盖的冲突 |
|---|---|---|
| 双击抑制（500ms 内第二次 onNodeClick 直接 return） | `onNodeClick` 内 `node.__lastClickTime` 逻辑（约行 3998） | 移动端 pointerup+合成 click 双发、PC 双击 |
| 400ms 建光时间窗 `__BEAM_DEDUP_MS` | `showDivineBeam`（行 396-468） | 同节点 400ms 内任何重复调用 |
| `activeBeam` 存活续期 `restart()` | 行 473-481 | 光柱未死时的所有重复派发 |
| 滑杆 change 300ms 锁 `__sliderChangeLock` | 约行 3752 | 移动端 input→change→touchend→change 双发 |
| 长按抑制 `suppressNodeClickUntil` | 行 3979-3982 | 长按后松手派生的单击 |

因此"同一次触摸/拖动被事件系统派生两次"这一类冲突，在**亚秒级时间尺度上已被封死**；右击/长按只开查看器，不发光，无关。

---

## 三、真正的漏口：`/click` 的 Socket 回声越过 3 秒冷却

### 共同后半程

"点击节点"与"拉动花杆"两个操作有同一条后半程：

```
POST /api/v1/causal/click
  → 后端将该节点提为大股东（survival_weight = 0.6）
  → Socket.IO 广播 node_updated（会扇回发起者自己）
```

### 回声的处理路径

`flushNodeUpdatedBuffer` → `updateNodeIncremental`，对大股东节点（权重 0.6 ≥ 0.4，`isSignificantWeight` 成立）走进"远端跃迁"分支（行 2328-2365）：

```js
const isLocalActionCooling = (now - lastLocalActionTime) < 3000;
if (!isCurrentlySelected && !isDrawerOpen && !isDragonCruising
    && !isLocalActionCooling && isSignificantWeight && Graph) {
    ...
    Graph.cameraPosition(camPos, lookAt, 2000);   // 抢镜头
    ...
    showDivineBeam(gNode);                        // ← 第二束圣光
```

### 为什么只有移动端

唯一屏蔽是 `lastLocalActionTime` 的 **3 秒冷却**：

- **PC**：`/click` 快，回声 3 秒内到达 → 冷却挡住 → 无第二束。
- **移动端**：弱网 + 后端重排全部权重 + 事件视界计算，端到端耗时跨过 3 秒 → 冷却失效 → 远端跃迁触发 → 第二束圣光 + 镜头被抢。

该分支的 `cameraPosition` 2 秒跃迁，正对应代码里两处历史注释的症状："叠一束圣光并**把镜头抢走**"（约行 1619、3763）。

### 第二束的两种形态（都表现为"两次圣光"）

| 回声到达时间 | 行为 | 观感 |
|---|---|---|
| (3s, 3.5s] | 第一束还活着 → 命中 `restart()` 续期 → **重置 `startTime`，透明度从 0 重新爬升** | 光柱熄灭后**重闪一次** |
| > 3.5s | 第一束已自然死亡 → 走新建分支 | **第二束全新光柱** |

### 佐证：广播过滤的不对称

- `node_created`、`horizon_updated` 接收端**都按 `actor_id` 过滤自己的回声**（如行 2529-2533）。
- 唯独 `node_updated` 的 `flushNodeUpdatedBuffer` **只按 `owner_id` 过滤、不识别发起者**（行 2504-2514）——权重更新放行是对的（图要刷新），但没有任何标记告诉"远端跃迁"分支"这是你自己刚点过的节点，别发光别抢镜头"，全靠 3 秒计时器。

---

## 四、修复建议（按侵入性排序）

1. **最小改动**：把远端跃迁分支的冷却从 3 秒延长到覆盖 `/click` 全链路耗时上界（建议 8~10 秒）；或改为节点级判重，复用已有登记信息：`__lastBeamStart.id === targetId && now - __lastBeamStart.t < 8000` 时跳过跃迁。
2. **更干净**：后端 `node_updated` 广播携带发起者 `actor_id`（`node_created`/`horizon_updated` 已有先例），前端在远端跃迁分支跳过自己的回声——权重照常更新，只关镜头和光。
3. **顺手修观感**：`restart()` 续期时不重置透明度爬升（或重启不走 `p < 0.15` 的爆发段），消除 (3s, 3.5s] 区间内的重闪残留。

---

## 五、验证方法

1. 在远端跃迁分支与 `showDivineBeam` 入口临时加 `console.log`，移动端复现，打印两条日志的间隔——预期 > 3000ms。
2. 在移动端 DevTools (Chrome inspect) Network 面板看 `/api/v1/causal/click` 耗时——预期移动端明显比 PC 慢，弱网可 > 3s。
3. 实施修复 1 后，同一弱网环境下复现，确认第二束不再出现。

---

## 六、修复实施记录（2026-11-16 15:42~17:53）

### 改动文件与备份

- 改动：`static/js/3d_main.js`
- 备份：`static/js/3d_main_kimi_before.js`（改动前完整副本，md5 `36da96df…`）
- 模板版本号：`templates/3d_main.html` 第 487 行 `?v=20261116g` → `?v=20261116kimi1`（强制浏览器拉新 JS）

### 落地改动（4 处）

| # | 位置 | 改动 |
|---|---|---|
| 1 | 远端跃迁分支冷却（行 2324） | `lastLocalActionTime` 冷却 3000ms → **8000ms**，覆盖移动端 `/click` 全链路耗时上界 |
| 2 | 远端跃迁分支判重（行 2330-2337） | 新增 `isRecentOwnBeam`：复用 `__lastBeamStart` 登记，该节点 8 秒内刚被本地点过/发过光 → 跳过发光与抢镜头（权重更新不受影响）——**根因修复** |
| 3 | `restart()`（行 650-654） | 续期时置 `skipRampOnRestart = true` 标记 |
| 4 | `animate()` 透明度曲线（行 672-673） | 续期时跳过 0.5s 爆发段，直接进入衰减段（`Math.min(1, …)` 防越界），消除"光柱重闪"观感 |

### 部署验证

- `node --check` 语法通过
- 服务重启（`run.sh restart`，PID 467690，端口 8094）
- 线上 `curl` 实测：返回 JS 含全部 4 处新标记，`/3d` 页面引用新版本号

### 实测结果

**移动端实测问题已解决**（2026-11-16 17:53 用户确认）：弱网点节点、拉花杆，大股东节点只出现一束圣光，镜头不再被二次抢夺。

### 回滚方法

```
cp /root/causal_ai/static/js/3d_main_kimi_before.js /root/causal_ai/static/js/3d_main.js
sed -i 's|3d_main.js?v=20261116kimi1|3d_main.js?v=20261116g|' /root/causal_ai/templates/3d_main.html
cd /root/causal_ai && ./run.sh restart
```

### 遗留观察项

- 改动 1/2 的 8 秒窗口是经验值。若未来后端 `/click` 重排更重、移动端回声超过 8s 仍可能复现，届时应实施方案 2（后端 `node_updated` 广播携带 `actor_id`，前端按发起者过滤回声）。
- 他人（非同 owner/actor）的合法远端跃迁在 8 秒冷却内也会被延迟，属可接受的权衡。
