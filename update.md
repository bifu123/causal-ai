## 为3D可视化页面实现完整功能

### 原始任务
参照 index.html，为 3d_visualization.html 完成在抽屉中点击节点，将被点击节点的 node_id 向 d-parent-ids 中填充的功能。

### 完成的所有更改

#### 1. **实现节点点击和父ID填充功能**
- 修改了 `3d_form.js` 中的 `handleNodeClick` 函数，使其与 index.html 中的实现保持一致
- 添加了缺失的函数：`restoreFromNecropolis`、`promoteChainWeights`、`updateDrawerWithNecropolisData` 和 `openDrawerWithLatestData`
- 实现了父ID填充功能：当用户点击 d-parent-ids 输入框后，再点击图中的节点，节点ID会自动填充到输入框中

#### 2. **修复Socket.IO连接问题**
- 修复了 Socket.IO 连接重复创建的问题，现在会复用已存在的连接
- 修改了 `3d_form.js` 中的 `initSocketIO` 函数，检查是否已经存在连接
- 确保节点创建、更新、删除后，Socket.IO 能够正确通知前端更新显示

#### 3. **为 icon-plus 编写CSS样式**
- 在 `3d_visualization.css` 中添加了 `.icon-plus` 样式：
  ```css
  .icon-plus {
      color: #ef4444; /* 红色，与HTML中的<font color="red">贞</font>保持一致 */
      font-size: 20px;
      font-weight: bold;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  }
  ```

#### 4. **修复首贞发起后的视图更新问题**
- 修改了 `3d_form.js` 中的 `loadGraphData` 函数，使其能够正确调用 `3d_force_graph.js` 中的 `loadInitialData` 函数
- 增强了 `submitCreateNode` 函数，添加了更多的调试信息和成功提示
- 确保节点创建成功后，前端能够正确更新3D图视图

#### 5. **修正首贞节点权重设置**
- 修改了 `submitCreateNode` 函数，在创建首贞节点时设置权重为0.6：
  ```javascript
  const createData = {
      // ... 其他字段
      survival_weight: 0.6  // 首贞节点权重设置为0.6
  };
  ```

#### 6. **修复视图放大又缩小的BUG**
- 移除了所有抽屉打开函数中的 `zoomToFit` 调用：
  - `updateDrawerWithNecropolisData` 函数
  - `openDrawerWithLatestData` 函数  
  - `openDrawer` 函数
- 解决了点击节点后视图先放大聚焦节点，然后又缩小显示所有节点的视觉冲突
- 现在点击节点后，视图会平滑聚焦到节点，抽屉打开显示详情，整个过程流畅自然

#### 7. **完整的"首贞发起-通知前端-点击首贞"流程**
- 实现了完整的节点创建、通知、点击流程
- 首贞发起：用户点击"发起首贞"按钮创建首贞节点（权重0.6）
- 通知前端：服务器通过 Socket.IO 发送 `node_created` 事件，前端更新视图
- 点击首贞：用户点击刚刚创建的首贞节点，打开抽屉查看详情

### 技术实现要点

1. **多用户支持**：通过 URL 参数 `actor_id` 区分不同用户
2. **实时通信**：使用 Socket.IO 实现节点创建、更新、删除的实时通知
3. **地宫恢复**：点击节点时尝试从地宫恢复完整全息信息
4. **权重提升**：点击节点后提升该节点到所有节点总权重的60%
5. **父ID选择**：支持多父节点选择，用 | 分隔多个父节点ID
6. **图片功能**：支持图片上传、预览和全屏查看
7. **抽屉表单**：完整的节点增删改查功能

### 文件修改清单

1. **`static/js/3d_form.js`** - 主要修改文件，实现了所有核心功能
2. **`static/css/3d_visualization.css`** - 添加了 icon-plus 样式
3. **`static/js/3d_force_graph.js`** - 移除了重复的函数调用，避免冲突

现在，3d_visualization.html 已经具备了与 index.html 相同的完整功能，包括节点点击、父ID填充、首贞创建、实时更新等所有特性。