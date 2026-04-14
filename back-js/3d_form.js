/**
 * 元龙检索 - 因果星空 (Causal Starry Sky) 核心驱动集成版
 * 版本：v2.0 (Merged)
 * 职责：3D可视化、因果链溯源、节点CRUD管理、高级控制(寻龙巡航)
 */

// --- [1. 全局状态管理] ---
let Graph = null;
const highlightNodes = new Set();
const highlightLinks = new Set();
let hoverNode = null;
let currentSelectedNode = null;
let is_change = true; // 控制抽屉逻辑：true=编辑，false=填充父ID
let nodeCache = {}; 

// 巡航与控制状态
let isPhysicsEnabled = true;
let currentNavigationChain = [];
let navigationIndex = 0;
let isNavigating = false;
let isDragonCruising = false;
let cruiseInterval = null;
let selectNode = false; 
let selectedNode = null; 

// 罗盘与引力状态
let compassTarget = null;
let compassInterval = null;
let gravityFocusEnabled = false;
let gravityFocusNode = null;
let originalForces = { charge: null, link: null };

// --- [2. 核心辅助函数] ---

function getThreeInstance() {
    if (window.THREE) return window.THREE;
    if (Graph && Graph.scene()) return Graph.scene().__threeObj || null;
    return null;
}

/** 动作颜色映射 (符合 ylbot 职责标准) */
function getNodeColor(node) {
    if (highlightNodes.size > 0 && !highlightNodes.has(node)) return 'rgba(100, 116, 139, 0.2)';
    const tag = node.action_tag || '动作';
    const colorMap = {
        '贞': '#f59e0b',   // 初始动作
        '又贞': '#10b981', // 演化业务
        '对贞': '#3b82f6'  // 耦合业务
    };
    return colorMap[tag] || '#64748b';
}

function updateHighlight() {
    highlightNodes.clear();
    highlightLinks.clear();
    if (hoverNode) {
        highlightNodes.add(hoverNode);
        const { links } = Graph.graphData();
        links.forEach(link => {
            const sId = typeof link.source === 'object' ? link.source.id : link.source;
            const tId = typeof link.target === 'object' ? link.target.id : link.target;
            if (sId === hoverNode.id || tId === hoverNode.id) {
                highlightLinks.add(link);
                highlightNodes.add(link.source);
                highlightNodes.add(link.target);
            }
        });
    }
    Graph.nodeColor(Graph.nodeColor()).linkColor(Graph.linkColor()).linkWidth(Graph.linkWidth()).linkDirectionalParticles(Graph.linkDirectionalParticles());
}

/** 渲染超采样文字纹理 (保留 ID 原始字段) */
function createTextTexture(text, THREE) {
    if (!THREE || !THREE.CanvasTexture) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scaleFactor = 4; 
    const fontSize = 32 * scaleFactor;
    ctx.font = `Bold ${fontSize}px "Fira Code", monospace`;
    const textWidth = ctx.measureText(text).width;
    const padding = 20 * scaleFactor;
    canvas.width = textWidth + padding * 2;
    canvas.height = fontSize + padding * 2;
    
    ctx.font = `Bold ${fontSize}px "Fira Code", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 10, 25, 0.9)'; 
    if (ctx.roundRect) ctx.roundRect(0, 0, canvas.width, canvas.height, 6 * scaleFactor);
    else ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fill();
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 3 * scaleFactor;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.baseWidth = canvas.width / scaleFactor;
    texture.baseHeight = canvas.height / scaleFactor;
    return texture;
}

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// --- [3. 数据业务引擎] ---

async function loadInitialData() {
    try {
        const actorId = window.currentActorId || '';
        let url = `/api/v1/causal/history${actorId ? '?actor_id=' + encodeURIComponent(actorId) : ''}`;
        const response = await fetch(url);
        const res = await response.json();
        
        if (res.status === 'success' && Array.isArray(res.data)) {
            const nodes = res.data.map(node => ({
                id: node.node_id, ...node,
                x: (Math.random() - 0.5) * 350, y: (Math.random() - 0.5) * 350, z: (Math.random() - 0.5) * 350
            }));
            const links = [];
            nodes.forEach(node => {
                const parents = node.parent_ids || (node.parent_id ? [node.parent_id] : []);
                parents.forEach(pId => { if (nodes.find(n => n.id === pId)) links.push({ source: pId, target: node.id }); });
            });
            Graph.graphData({ nodes, links });
            setTimeout(() => Graph.zoomToFit(1200, 150), 600);
        }
    } catch (e) { console.error("API 加载失败:", e); }
}

/** 供表单模块调用的统一刷新接口 */
function loadGraphData() { if (Graph) loadInitialData(); }

// --- [4. 3D表单交互 (原本的 3d_form.js)] ---

function initSocketIO() {
    if (!window.socket) window.socket = io({ path: '/socket.io' });
    window.socket.on('node_created', (node) => { nodeCache[node.node_id] = node; loadGraphData(); });
    window.socket.on('node_updated', (data) => handleNodeUpdate(data));
    window.socket.on('node_deleted', (data) => handleNodeDelete(data));
}

/** 核心交互：节点点击逻辑 */
function handleNodeClick(node) {
    const nodeId = typeof node === 'object' ? node.id : node;
    if (!is_change) {
        addNodeIdToParentField(nodeId);
        return;
    }
    // 提升权重并打开抽屉
    promoteNodeWeight(nodeId).then(success => {
        selectNode = true;
        selectedNode = node;
        openDrawer(nodeId);
        // 相机聚焦
        const distance = 120;
        const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
        Graph.cameraPosition({ x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, node, 1500);
    });
}

function addNodeIdToParentField(nodeId) {
    const field = document.getElementById('d-parent-ids');
    if (!field) return;
    let ids = field.value.split('|').map(s => s.trim()).filter(s => s);
    if (!ids.includes(nodeId)) {
        ids.push(nodeId);
        field.value = ids.join(' | ');
        showSelectionHint(`已添加父节点: ${nodeId}`);
    }
}

async function promoteNodeWeight(nodeId) {
    try {
        const response = await fetch('/api/v1/causal/promote_chain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId, actor_id: window.currentActorId || '' })
        });
        return (await response.json()).status === 'success';
    } catch (e) { return false; }
}

// --- [5. 控制与导航 (原本的 controls.js)] ---

function bindUIControls() {
    // 物理强度控制
    const fSlider = document.getElementById('force-strength');
    if (fSlider) fSlider.addEventListener('input', () => {
        const strength = -600 * (fSlider.value / 100);
        Graph.d3Force('charge').strength(strength);
        document.getElementById('force-value').textContent = `${fSlider.value}%`;
    });

    // 适应视图
    const fitBtn = document.getElementById('btn-fit-view');
    if (fitBtn) fitBtn.addEventListener('click', () => Graph.zoomToFit(800, 10));

    // 寻龙巡航 (因果链飞行)
    const dragCruiseBtn = document.getElementById('btn-dragon-cruise');
    if (dragCruiseBtn) dragCruiseBtn.addEventListener('click', () => {
        if (!selectNode) { alert('请先选择一个节点'); return; }
        startDragonCruise();
    });

    // 暂停物理
    const physicsBtn = document.getElementById('btn-toggle-physics');
    if (physicsBtn) physicsBtn.addEventListener('click', () => {
        isPhysicsEnabled = !isPhysicsEnabled;
        isPhysicsEnabled ? Graph.resumeAnimation() : Graph.pauseAnimation();
        physicsBtn.textContent = isPhysicsEnabled ? '暂停物理' : '恢复物理';
    });
}

/** 构建因果链 (广度优先遍历) */
function buildCausalChain(startNode) {
    const { nodes, links } = Graph.graphData();
    const visited = new Set([startNode.id]);
    const result = [];
    const queue = [{ node: startNode, level: 0 }];

    while (queue.length > 0) {
        const { node, level } = queue.shift();
        result.push(node);
        const childLinks = links.filter(l => (typeof l.source === 'object' ? l.source.id : l.source) === node.id);
        const childNodes = childLinks.map(l => nodes.find(n => n.id === (typeof l.target === 'object' ? l.target.id : l.target))).filter(n => n && !visited.has(n.id));
        
        childNodes.sort((a, b) => (a.created_at || a.id).localeCompare(b.created_at || b.id));
        childNodes.forEach(cn => { visited.add(cn.id); queue.push({ node: cn, level: level + 1 }); });
    }
    return result;
}

async function startDragonCruise() {
    if (isDragonCruising || !selectedNode) return;
    const chain = buildCausalChain(selectedNode);
    if (chain.length <= 1) return;
    
    isDragonCruising = true;
    Graph.pauseAnimation();
    
    for (let node of chain) {
        await moveCameraToNode(node);
        await new Promise(r => setTimeout(r, 1200));
    }
    
    Graph.resumeAnimation();
    isDragonCruising = false;
}

function moveCameraToNode(node) {
    return new Promise(resolve => {
        const camera = Graph.camera();
        const startPos = { ...camera.position };
        const dist = 120;
        const ratio = 1 + dist / Math.hypot(node.x, node.y, node.z);
        const endPos = { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio };
        
        let start = Date.now();
        const duration = 1500;
        function step() {
            let p = Math.min((Date.now() - start) / duration, 1);
            let ep = easeInOutCubic(p);
            Graph.cameraPosition(
                { x: startPos.x + (endPos.x - startPos.x) * ep, y: startPos.y + (endPos.y - startPos.y) * ep, z: startPos.z + (endPos.z - startPos.z) * ep },
                node, 0
            );
            if (p < 1) requestAnimationFrame(step);
            else resolve();
        }
        step();
    });
}

// --- [6. 启动初始化序列] ---

window.addEventListener('load', () => {
    // A. 初始化 3D 引擎
    const container = document.getElementById('3d-graph');
    Graph = ForceGraph3D()(container)
        .backgroundColor('rgba(0, 10, 25, 1)')
        .nodeLabel(node => `<div class="node-label">ID: ${node.id}</div>`)
        .nodeColor(getNodeColor)
        .nodeOpacity(0.9)
        .onNodeHover(node => {
            if (node === hoverNode) return;
            hoverNode = node;
            updateHighlight();
            container.style.cursor = node ? 'pointer' : 'default';
        })
        .onNodeClick(handleNodeClick)
        .linkWidth(link => highlightLinks.has(link) ? 6 : 1.5)
        .linkColor(link => highlightLinks.has(link) ? '#60a5fa' : 'rgba(255,255,255,0.15)')
        .linkDirectionalParticles(link => highlightLinks.has(link) ? 8 : 0)
        .linkDirectionalParticleWidth(3)
        .linkDirectionalParticleSpeed(0.006);

    // B. 自定义节点样式 (Sprites)
    Graph.nodeThreeObject(node => {
        const THREE = getThreeInstance();
        if (!THREE) return null;
        const texture = createTextTexture(node.id, THREE);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
        const baseScale = 0.4;
        sprite.scale.set(texture.baseWidth * baseScale, texture.baseHeight * baseScale, 1);
        const visualSize = 8 + ((node.survival_weight || 0) * 65);
        sprite.position.y = Math.sqrt(visualSize) * 3.5 + 17;
        return sprite;
    });

    // C. 加载数据与绑定 UI
    loadInitialData();
    initSocketIO();
    bindUIControls();
    
    // 全局化 handleNodeClick 供 HTML 属性直接调用
    window.handleNodeClick = handleNodeClick;
    window.Graph = Graph;
});