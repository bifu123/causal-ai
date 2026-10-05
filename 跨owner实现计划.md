# 跨 owner（跨场）实现计划

基于事件焦点 2201、2202 以及 2208 的契约共识，本计划旨在落实跨场观测的第一与第二阶段目标：①本场视界，②跨场共享连线（接触面），以及保证“观测者主权”的私有连线与权重分离。邻场星系质心投影（③）将在后续阶段实现。

## 核心设计理念

1.  **最小改动，最大兼容**：沿用现有的 `parent_id` 字段名承载因果拓扑，妥协“前因”的字面语义，换取架构的平稳过渡，不引入冗余的“跳线表”。
2.  **玻璃二象性（权限边界）**：通过在节点增加 `is_share` 布尔字段控制内容可见性。当 `is_share=FALSE` 时，异场节点在跨场渲染中退化为“锁桩”（保留时空曲率与位置，剥离内容信息）。
3.  **观测者绝对主权（副本隔离）**：利用现存的 `ains_user_weights` 表，增加私人 `parent_id` 字段。观测者在异场的连线和权重操作，绝不污染原场的数据，真正实现千人千面的主观因果网。
4.  **接触面加载契约**：跨场漫游不再全量拉取他场数据，而是通过 `parent_id` 连线索骥，只加载“两场之间存在因果关联，且彼此允许公开”的边缘接触面。

---

## 实施步骤

### 1. 数据库基建升级 (Schema Alterations)
*   **数据库服务器**:
    VPS: 
    ip: 192.168.66.39
    user: root
    password: 962512
    
    PostgreSQL:
    user: postgres
    password: Shift962512

执行 SQL 脚本升级现有物理表，打牢跨场漫游的地基。

*   **活跃事件表** (`ains_active_nodes`):
    ```sql
    ALTER TABLE ains_active_nodes ADD COLUMN IF NOT EXISTS is_share BOOLEAN DEFAULT TRUE;
    ```
    *作用：确立跨场引力交集与内容可见性的权限契约。*

*   **用户权重副本表** (`ains_user_weights`):
    ```sql
    ALTER TABLE ains_user_weights ADD COLUMN IF NOT EXISTS parent_id VARCHAR(500);
    ```
    *作用：使 `ains_user_weights` 从单纯的“关注度表”升级为“观测者私人时空曲率表”。*

*   **数据库服务器

### 2. “接触面”引力交集算法落地 (`core/database.py`)
在 `CausalDatabase` 类中新增核心方法，用于提取双侧共享连线的接触面。

*   **新增方法**：`get_cross_field_contact_surface(self, owner_id: str, actor_id: str = None)`
*   **核心逻辑**：
    1.  通过 JOIN 查找跨越当前 `owner_id` 边界的 `parent_id` 连线（即当前场的节点其 `parent_id` 指向异场，或异场节点的 `parent_id` 指向当前场）。
    2.  提取这批跨界连线两端的节点。
    3.  融合副本表信息（如果提供了 `actor_id`，需要合并其在副本中的 `parent_id` 和权重）。

### 3. “玻璃二象性”数据过滤与覆盖
在拉取到“本场节点”与“接触面异场节点”之后，返回给前端或交由 `click` 响应前，进行数据坍缩打码。

*   **过滤规则**：
    如果 `node.owner_id != 当前聚焦的 owner_id` 且 `node.is_share == FALSE`，则进行“锁桩”处理。
*   **锁桩处理逻辑**：
    1.  `event_tuple` 强制替换为 `【私密桩点】内容不可见`。
    2.  清空 `full_image_url` 等富媒体字段。
    3.  可添加自定义标志 `is_locked = True` 供前端渲染成灰点使用。

### 4. 观测者主观连线的副本覆盖逻辑
修改现有的数据拉取方法（如 `get_all_active` 等）以兼容私有连线。

*   **合并逻辑**：
    当系统根据传入的 `actor_id` 读取 `ains_user_weights` 时，如果副本记录中 `parent_id` 不为空（说明用户有过主观修改），则必须强制用副本的 `parent_id` 覆盖基础表中的原始 `parent_id`，以重绘属于该观察者的主观因果拓扑图。

### 5. API 接口适配 (`main.py`)
调整核心的数据吐出接口，使其能承载上述双层逻辑。

*   **`GET /api/v1/causal/history`（全量与初始化）**：
    在原本仅获取指定 `owner_id` 节点的基础上，追加并入 `get_cross_field_contact_surface` 提取出的跨场接触面节点。
*   **`POST/GET /api/v1/causal/click`（事件视界焦点）**：
    在原本求出的 `event_horizon` 集合（基于 `max_eyes` 距离半径计算的节点）基础上，并入相关的跨场接触面节点，使得事件视界自然延展到能瞥见相邻宇宙的轮廓。

### 6. 前端跳场机制导航层 (`static/js/3d_main.js`)
在 3D 视图的交互层，落实“带着自己的观测者身份进对方场”的核心口径。

*   **跳转契约 (2201/2202 钉死)**：
    ```javascript
    // 点击节点 N
    if (N.owner_id === 本场 owner_id) {
        // 本场聚焦（原逻辑，不变）
        focusNode(N.serial_id);
    } else {
        // 异场节点 → 拼合新 URL 跳转
        url = `?serial_id=${N.serial_id}`      // 焦点落在对方那颗星
            + `&owner_id=${N.owner_id}`         // 切换到对方的场
            + `&actor_id=${本场当前 actor_id}`;  // 观测者身份不变
        location.href = url;
    }
    ```

*   **语义阐述**：
    | 要素 | 值 | 意义 |
    | --- | --- | --- |
    | `serial_id` | `N.serial_id` | 一进去就站在异场那个节点上，而不是站在场门口 |
    | `owner_id` | `N.owner_id` | 换场——星空重绘为 B 场真拓扑，时空曲率正确 |
    | `actor_id` | 本场 actor | 身份不变——"我"还是"我"，只是换了个星空看 |

*   **一跳带走四件事**：
    1. **视觉**：`owner_id` 换了，星空拓扑正确变为对方场。
    2. **权重副本**：由于 `actor_id` 保持不变，配合现有的 `ains_user_weights` 设计，异场点击只修改自己的副本，绝不污染 B 场的原始活跃表。
    3. **主观私线**：连线操作与权重同样，仅落在该观察者的副本里。
    4. **权限屏障**：基于前述第 3 点实现的 `is_share=FALSE` 逻辑，异场私密节点自然呈现为不能窥视内容的“锁桩”。

    **结论**：观测者的“绝对主权”由 `actor_id` 这一参数在 URL 漫游中自动携带。此机制前端改动面极小，却从物理上划清了“跨场看”与“干涉他场”的红线。

太棒了，这完美解决了我们在工程折中上的后顾之忧！既然数据库跑在 ramdisk 里，极高的 I/O 和内存读取速度完全可以支撑在字符串字段（`parent_id`）上直接使用 `LIKE '%%|ID|%%'` 做实时的跨场 JOIN 扫描。我们坚决保持当前极简的表结构，彻底抛弃单独建边的“跳线表”想法。

到这里，我们的方案已经彻底闭环，风险也已排除。

**【最终待执行操作清单】**：
1. **执行 SQL 升级**：连接 `192.168.66.39` 的 PostgreSQL，添加 `ains_active_nodes.is_share` 和 `ains_user_weights.parent_id`。
2. **修改 `core/database.py`**：
   * 写入/更新节点时支持 `is_share`。
   * 用户权重查询时优先合并副本中的主观 `parent_id`。
   * 新增 `get_cross_field_contact_surface` 方法拉取连线接触面。
3. **修改 `main.py`**：
   * 在 `history` 和 `click` 接口中，将跨场接触面合并到返回结果中。
   * 增加【锁桩】逻辑：将对方场 `is_share=False` 的节点内容打码。
4. **修改 `static/js/3d_main.js`**：
   * 替换跨场点击逻辑，实现“不改 `actor_id`，带着身份切换 `owner_id`”的 URL 跳转漫游。

由于我现在仍处于 **Plan (计划) 模式**，无法为您修改文件和执行数据库命令。

请您点击界面的 **Toggle to Act mode**（切换到 Act 模式），然后回复我，我将立刻开始大展身手为您编写和部署这些代码！
