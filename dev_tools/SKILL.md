---
name: causal-ai
description: 处理因果链数据和有关因果AI的专用技能。了解事情的前因后果、前后依赖，以便获得更科学、更体系的答案。
---

# 因果链数据处理

## 名词解释

- **因果链数据** 是以记录**事件**的数据为节点，通过前后ID列表（父子ID列表）串联起来的，具有时间一维矢量的系列记录，形成一个多因多果的网络。一条记录称为一个**事件**。
- **事件视界（Event Horizon）** 是事件节点语义向量距离半径内的节点集合，它让 Agent 聚焦当前事件，同时用"余光"扫视语义相关节点。

---

# CLI 工具

所有因果链数据均通过本地 CLI 获取。

命令格式：

```bash
python tools/causal_cli.py <command> [options]
```

CLI 返回标准 JSON。

Agent 必须解析 JSON，并根据结果回答用户。

---

# CLI 子命令

## 因果事件查询

### search

使用自然语言进行语义向量搜索（优先推荐）。

```bash
python tools/causal_cli.py search "<关键词>" --json
```

例如：

```bash
python tools/causal_cli.py search "商王祭祀" --json
```

可选参数：

```text
--owner
--limit
--threshold
```

---

### click

根据事件ID聚焦事件节点，获取：

- 当前事件
- 前事件
- 后事件
- 事件视界
- 权重信息

```bash
python tools/causal_cli.py click <serial_id> --json
```

例如：

```bash
python tools/causal_cli.py click 312 --json
```

可选参数：

```text
--actor
--owner
--eyes
```

---

# 常用操作组合

## 因果事件推理（局部）

1. 将用户问题中的关键词作为参数，执行：

```bash
python tools/causal_cli.py search "<关键词>" --json
```

获得相关事件列表。

2. 选择最相关事件的 `serial_id`，执行：

```bash
python tools/causal_cli.py click <serial_id> --json
```

获得：

- 当前事件
- 事件视界
- 前事件
- 后事件

3. 如果仍不足以回答问题，可继续点击：

- 父事件（前事件）
- 子事件（后事件）

继续遍历因果链。

4. 当已有数据足够回答问题时，停止遍历，并直接回答用户。

---

## 因果事件推理（全局）

1. 使用：

```bash
python tools/causal_cli.py search "<关键词>" --json
```

找到目标事件。

2. 如果需要理解完整事件链，应逐步点击父事件（前事件）和子事件（后事件），直到能够建立完整因果关系。

3. 根据整个因果链回复用户，而不是孤立解释某一个事件。

---

## 因果虫洞推理（特技）

如果当前事件视界内存在多个语义相关事件，但它们尚未形成明确连线，可以依据事件视界进行**可能性推断**。

这种推断属于合理猜测，应明确说明属于推测，而非数据库中的既有事实。

---

## 改变搜索范围

通过修改：

```text
--eyes
```

参数改变事件视界半径。

例如：

```bash
python tools/causal_cli.py click 312 --eyes 45 --json
```

建议范围：

```text
30 ~ 60
```

注意：

增大视界可能增加上下文规模。

---

# 因果事件推理注意事项

- 优先使用 **search** 进行语义搜索。
- 如果同级存在多个事件，应按照事件创建时间升序依次遍历。
- 注意记录已访问节点，避免重复遍历。
- 如果事件视界已足够回答问题，不要继续扩大搜索范围。
- 不要凭空推断数据库不存在的信息。

---

# 输出要求

- 使用自然语言总结结果。
- 不要直接输出数据库结构。
- 不要直接输出 JSON。
- 除非用户明确要求，否则不要分析事件拓扑结构，而应输出用户真正需要的知识。