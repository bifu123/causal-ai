# 因果AI基础数据建模：前端可视化与工程实现方案 (v2.6.1-Metabolic)

## 一、 项目脚本与文件结构 (Project Blueprint)
基于 `/root/causal_ai` 路径，构建职责明确的物理布局：

```text
/root/causal_ai
├── main.py                # 【核心枢纽】FastAPI + Socket.IO 异步服务
├── .env                   # 【配置】DB 凭据与存储路径 (PostgreSQL, uploads/)
├── requirements.txt       # 【依赖】fastapi, python-socketio, uvicorn, pillow, psycopg2-binary
├── core/                  # 【业务职责层】
│   ├── database.py        # 数据库模型 (ains_active_nodes, ains_archive_necropolis)
│   ├── metabolism.py      # 代谢引擎：执行权重衰减、像素降采样与“灵魂出窍”
│   └── agent_handler.py   # Agent 接口：支持 AINS/MCP 协议的因果推演对接
├── static/                # 【感知呈现层】
│   ├── index.html         # 承载 Vis-Network 画布的主页面
│   ├── css/
│   │   └── style.css      # 地宫/活跃节点的视觉样式（滤镜、动态缩放）
│   └── js/
│       ├── vis-logic.js   # 【核心】Vis-Network 配置、物理引擎与节点渲染逻辑
│       ├── socket-sync.js # Socket.IO 监听器：实时感知后端代谢与 Agent 动作
│       └── ui-actions.js  # 人类交互：录入首贞、查看地宫详情、唤醒重构
└── uploads/               # 【证据存储】
    ├── raw/               # 外显子：地宫封存的高清原始证据
    └── thumbs/            # 内显子：活跃层流转的低清/像素化缩略图
```

---

## 二、 前端可视化核心：Vis-Network (vis.js) 实现方案

### 1. 节点与因果链映射逻辑
Vis-Network 将数据库中的“因果块”转化为具有物理属性的图形。
* **节点形状 (`shape: 'image'`)**: 直接展示 `thumb_image_blob`。随着 `vision_level` 提高，图像会因后端重采样而产生真实的像素颗粒感。
* **节点大小 (`value`)**: 绑定 `survival_weight`。权重越高，节点在图中占据的物理空间越大。
* **分组渲染 (`groups`)**:
    * `active`: 鲜活因果，高饱和度，有呼吸灯特效。
    * `necropolis`: 已入地宫，低透明度，显示“封存”图标。
* **连线语义 (`edges`)**: 箭头指向“果”，标签标注“贞”、“又贞”或“对贞”。

### 2. 核心前端脚本示例 (js/vis-logic.js)
```javascript
// 初始化 Vis 数据集
const nodes = new vis.DataSet([]);
const edges = new vis.DataSet([]);

const container = document.getElementById('causal-network');
const data = { nodes: nodes, edges: edges };

const options = {
    nodes: {
        borderWidth: 2,
        shadow: true,
        font: { color: '#343434', size: 14 }
    },
    edges: {
        arrows: { to: { enabled: true, scaleFactor: 1 } },
        color: { inherit: 'from' },
        smooth: { type: 'cubicBezier' } // 让因果链条线条圆润
    },
    physics: {
        enabled: true,
        barnesHut: { gravitationalConstant: -2000, springLength: 150 }
    },
    groups: {
        necropolis: { opacity: 0.3, font: { color: '#aaa' } }
    }
};

const network = new vis.Network(container, data, options);

// 点击节点触发“职责详情抽屉”
network.on("click", function (params) {
    if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        openResponsibilityDrawer(nodeId); // 调用 ui-actions.js
    }
});
```

---

## 三、 Socket.IO 实时同步：人机协作感应

通过 Socket.IO，前端 UI 能够实时“旁听”后端 Agent 或代谢引擎的动作：

```javascript
const socket = io();

// 1. 监听代谢事件：节点缩小、模糊或消失
socket.on('metabolic_decay', (res) => {
    // res: { node_id, weight, thumb_url, compression_level }
    nodes.update({
        id: res.node_id,
        value: res.weight * 100, // 权重直接改变节点大小
        image: res.thumb_url,     // 更新降采样后的图片
        group: res.compression_level > 1 ? 'necropolis' : 'active'
    });
});

// 2. 监听 Agent 因果推演：自动长出新节点
socket.on('agent_inference', (data) => {
    // data: { parent_id, newNode, action_tag }
    nodes.add(data.newNode);
    edges.add({
        from: data.parent_id,
        to: data.newNode.node_id,
        label: data.action_tag 
    });
});
```

---

## 四、 职责与业务逻辑备注 (Remarks)

1.  **职责替代功能 (Responsibility Pattern)**:
    * 前端不再是“管理数据”，而是**“观察业务”**。
    * “代谢（Metabolism）”是一个独立的后端职责。当 `survival_weight` 降低时，后端自动触发像素重采样。前端通过 Vis-Network 的 `update` 接口实时反映这种“风化”过程。
2.  **地宫隔离 (Isolation)**:
    * 一旦节点进入 `necropolis` 组，前端 UI 应当禁用直接编辑功能。
    * 只有通过点击“开启地宫（Holographic Recovery）”按钮，触发一个后端授权业务，才能临时恢复高清 `raw_content` 的显示。
3.  **Agent 同步设计**:
    * Agent 与人类用户处于对等地位。Agent 产生的推演（对贞）通过 Socket 广播，人类在 Vis 界面上能看到因果树在自动“生长”。

---

## 五、 部署操作建议 (Deployment)
* **环境**: 在你的 192.168.66.39 环境下，运行 `uvicorn main:app --host 0.0.0.0 --port 8000`。
* **存储**: `uploads/` 目录需保持与 FastAPI 进程同权限，确保代谢引擎能物理删除已入地宫节点的高清原图。
* **前端访问**: 浏览器访问 `http://192.168.66.39:8000/static/index.html` 即可进入因果观测站。
```
