一、又贞和对贞操作没有把当前owner_id参数加入，导致写入数据库的owner_id都是default。
二、index.html 2d界面中的tooltip:
- 最大宽度（500px）
- 最大高度 (550px)
- 字符截取 (250字符)
- 显示内容：node_id、权重、内容摘要
- 样式：node_id、权重、内容摘要不同的样式
三、3d_main.html中编辑父ID处理有BUG，应该参照index.html方式处理：
1，点击父ID文本框即进入了父ID编辑模式 is_change=false,在此模式下，点击任何节点都不会将该节点信息字段读取到抽屉里
2, 点击父ID文体框清空原有值
3，点击其它节点，将其它节点的node_id填入父ID文本框，多个节点的node_id用 | 间隔
4，点编辑提交，节点信息更新到数据库，is_change=true
5，关闭抽屉
6，后端soketio发送数据前端重绘

四、判断事件是否重复写入，过滤条件应该是node_id和owner_id共同决定
以上问题于2026-4-14已经解决


## core/search.py 中 get_event_by_sid 的问题
问题：前端搜索到相关事件后，点击，则用事件ID作为参数调用 get_event_by_sid，执行了与在前端手动点击节点的相同操作：

具体操作内容：
1. **执行 SQL 查询**：根据 serial_id 从 ains_active_nodes 表中查询节点完整数据，包括：
   - serial_id（事件物理ID）
   - preview_id（父节点的serial_id）
   - block_tag（因缘标签）
   - action_tag（动作标签）
   - event_tuple（事件二元组描述）
   - next_id_list（所有子节点的serial_id列表）
   - node_id（节点标题）
   - parent_id（父节点ID）
   - survival_weight（生存权重）
   - full_image_url（截图URL）
   - owner_id（事件拥有者）

2. **数据格式转换**：将数据库字段映射为 Agent 友好型格式（中文键名）：
   - serial_id → "本事件ID"
   - preview_id → "前事件ID列表"
   - block_tag → "因缘标签"
   - action_tag → "动作标签"
   - event_tuple → "事件二元组描述"
   - next_id_list → "后续事件ID列表"
   - survival_weight → "本事件权重"
   - node_id → "本事件标题"
   - full_image_url → "截图"
   - owner_id → "事件拥有者"

3. **处理父节点关系**：如果节点有父节点，通过 db._string_to_parents() 方法将父节点ID字符串转换为父节点标题列表，存储为 "前事件标题列表"。

4. **权重类型转换**：将数据库中的 Decimal 类型权重转换为 float 类型，确保 JSON 序列化兼容性。

5. **错误处理**：如果查询失败或节点不存在，返回空字典 {}，前端会收到相应错误提示。

6. **后续处理**：在 /api/v1/causal/click 接口中，调用 get_event_by_sid 获取节点信息后，还会执行：
   - 从地宫恢复内容（如果存在）
   - 提升节点权重到60%（大股东模式）
   - 重新计算其他节点权重
   - 通过 Socket.IO 广播更新到前端

这与在前端手动点击节点时执行的操作完全相同，包括：获取节点完整信息、从地宫恢复历史内容、提升节点权重、更新全局权重分布、实时同步到所有客户端。

## get_event_by_sid 与前端手动点击节点比缺少了什么
当前端手动点点节点时，包含有actor_id（观察者用户）的URL参数，如：
`http://192.168.66.39:8094/3d?owner_id=cbf&actor_id=user2`
actor_id参数与数据库中用户权重表`ains_user_weights`有关系
（请叙述前端手动点击节点后，是如何用actor_id来更新`ains_user_weights`的）

**前端手动点击节点后，actor_id更新`ains_user_weights`表的具体流程：**

1. **URL参数传递**：前端通过URL参数传递actor_id（观察者用户ID），如：`http://192.168.66.39:8094/3d?owner_id=cbf&actor_id=user2`

2. **Socket.IO连接初始化**：前端建立Socket.IO连接时，会将URL中的actor_id参数传递给后端：
   - 在Socket.IO连接建立时，前端通过查询参数传递actor_id
   - 后端在`handle_connect`事件中解析QUERY_STRING，获取actor_id参数
   - 后端根据actor_id获取用户特定的权重数据，并通过Socket.IO发送给前端

3. **前端点击节点事件处理**：当用户在前端手动点击节点时：
   - 前端调用`/api/v1/causal/click`接口，传递serial_id和actor_id参数
   - 请求数据格式：`{ serial_id: 123, actor_id: "user2", owner_id: "cbf" }`

4. **后端处理点击事件**：在`/api/v1/causal/click`接口中：
   - 调用`get_event_by_sid(serial_id)`获取节点基本信息
   - 调用`db.promote_all_weights(node_id, actor_id=actor_id, owner_id=owner_id, set_as_boss=True)`提升权重

5. **用户权重表更新逻辑**：在`db.promote_all_weights`函数中，如果指定了actor_id：
   - **获取用户权重**：通过`get_user_weight(actor_id, serial_id)`查询`ains_user_weights`表中该用户对该节点的权重
   - **权重计算**：
     - 大股东节点（被点击的节点）：权重设置为60%
     - 其他所有节点：按现有权重比例分配剩余的40%
   - **更新用户权重表**：通过`set_user_weight(actor_id, serial_id, new_weight)`更新`ains_user_weights`表：
     - 如果记录不存在：执行INSERT操作，创建新的用户权重记录
     - 如果记录已存在：执行UPDATE操作，更新现有权重值
     - 同时更新`last_accessed`时间戳

6. **用户权重表结构**：`ains_user_weights`表包含以下字段：
   - `actor_id` (VARCHAR): 用户ID，与`serial_id`组成联合主键
   - `serial_id` (INTEGER): 事件物理ID，与`ains_active_nodes`表的serial_id关联
   - `survival_weight` (NUMERIC): 用户对该事件的权重值
   - `last_accessed` (TIMESTAMP): 最后访问时间

7. **权重同步机制**：
   - 当指定actor_id时，权重更新只影响`ains_user_weights`表，不影响全局的`ains_active_nodes`表
   - 不同用户对同一节点可以有不同的权重值，实现个性化权重分配
   - 前端显示时，优先使用用户权重，如果用户权重不存在则使用全局权重

8. **Socket.IO广播更新**：权重更新后，后端通过Socket.IO广播`node_updated`事件：
   - 事件数据中包含`actor_id`字段，标识是哪个用户的权重更新
   - 前端根据actor_id判断是否需要更新显示
   - 只有相同actor_id的用户会收到对应的权重更新

9. **初始化用户权重**：当用户首次访问系统时：
   - 在`/api/v1/causal/history`接口中，如果用户没有某个节点的权重记录，会自动创建默认记录
   - 默认使用节点的全局权重作为初始用户权重
   - 确保每个用户都有完整的权重记录

**总结**：actor_id机制实现了多用户环境下的个性化权重管理，每个用户对因果节点有独立的权重视图，点击节点时只更新该用户在`ains_user_weights`表中的权重记录，不影响其他用户的权重数据，实现了用户间的权重隔离和个性化体验。

---

## 解决方案：修改 get_event_by_sid 函数以支持 actor_id 参数

**问题**：`get_event_by_sid` 函数与前端手动点击节点相比缺少了 actor_id 参数，导致无法返回用户个性化的权重数据。

**修改内容**：

1. **修改 `get_event_by_sid` 函数签名**：
   ```python
   # 修改前
   def get_event_by_sid(serial_id: int) -> Dict[str, Any]:
   
   # 修改后
   def get_event_by_sid(serial_id: int, actor_id: str = None) -> Dict[str, Any]:
   ```

2. **增加用户个性化权重查询逻辑**：
   - 当提供 `actor_id` 参数时，优先从 `ains_user_weights` 表查询用户对该节点的权重
   - 如果用户权重存在，使用用户权重覆盖全局权重
   - 如果用户权重不存在，使用全局权重
   - 在返回结果中添加 `"观察者用户": actor_id` 字段

3. **更新调用 `get_event_by_sid` 的接口**：
   - `/api/v1/causal/click` 接口：传递 `actor_id` 参数
   - `/api/v1/causal/search/serial` 接口：支持 `actor_id` 参数，返回用户个性化权重

**修改后的函数逻辑**：
```python
def get_event_by_sid(serial_id: int, actor_id: str = None) -> Dict[str, Any]:
    # ... 原有SQL查询逻辑 ...
    
    # 获取权重：如果提供actor_id，优先使用用户权重
    weight = float(d['survival_weight']) if isinstance(d['survival_weight'], Decimal) else d['survival_weight']
    
    if actor_id:
        # 查询用户权重表
        user_weight = db.get_user_weight(actor_id, serial_id)
        if user_weight is not None:
            weight = user_weight
            print(f"[搜索调试] 使用用户 {actor_id} 的个性化权重: {weight} (serial_id: {serial_id})")
        else:
            print(f"[搜索调试] 用户 {actor_id} 没有个性化权重，使用全局权重: {weight} (serial_id: {serial_id})")
    
    return {
        # ... 其他字段 ...
        "本事件权重": weight,
        "观察者用户": actor_id if actor_id else None  # 添加观察者用户信息
    }
```

**影响范围**：
1. 前端搜索到相关事件后点击时，现在会返回用户个性化的权重数据
2. 序列ID搜索接口现在支持 `actor_id` 参数，可以返回用户特定的权重
3. 点击事件接口现在传递 `actor_id` 参数，确保权重提升操作更新用户权重表

**测试建议**：
1. 使用不同 `actor_id` 参数调用 `/api/v1/causal/search/serial` 接口，验证返回的权重是否正确
2. 前端搜索并点击事件，验证是否使用用户个性化权重
3. 检查 `ains_user_weights` 表是否正确记录用户权重

**完成状态**：✅ 已实现 `get_event_by_sid` 函数对 `actor_id` 参数的支持，实现了与前端手动点击节点一致的观察者用户个性化节点权重功能。
