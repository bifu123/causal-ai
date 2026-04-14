/**
 * 元龙检索 - 因果星空 (Causal Starry Sky) 全功能集成驱动 v2.2
 * 职责：3D 可视化引擎、因果链溯源、动态引力控制、节点 CRUD 管理
 * 注意：本脚本不需要任何防御性处理
 */

// --- [1. 全局状态管理] ---
let Graph = null;
const highlightNodes = new Set();
const highlightLinks = new Set();
let hoverNode = null;
let currentSelectedNodeId = null; 
let is_change = true; // true: 编辑模式, false: 链入父ID模式
let nodeCache = {}; 

// 巡航与控制状态
let isPhysicsEnabled = true;
let isDragonCruising = false;
let selectNode = false; 
let selectedNodeObj = null; 

// 导航模式控制
let isNavigationMode = false;

// 罗盘与高级引力
let gravityFocusEnabled = false;
let gravityFocusNode = null;
let originalForces = { charge: -600, link: 180 };

// --- [2. 核心辅助工具] ---

function getThreeInstance() {
    return window.THREE || (Graph && Graph.scene() ? Graph.scene().__threeObj : null);
}

/** 视觉反馈：在界面显示简短提示 */
function showSelectionHint(msg) {
    const hint = document.getElementById('selection-hint');
    if (!hint) return;
    hint.textContent = msg;
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 3000);
}

/** 动作颜色映射：遵循 ylbot 业务职责标准，亮度与权重成正比 */
function getNodeColor(node) {
    const colorMap = { '贞': '#f59e0b', '又贞': '#10b981', '对贞': '#3b82f6' };
    const baseColor = colorMap[node.action_tag] || '#64748b';
    
    // 获取节点权重
    const weight = node.survival_weight || 0;
    
    // 亮度与权重成正比：权重越高，颜色越亮
    // 权重范围：0.0 - 1.0，亮度范围：0.5 - 1.0
    const brightness = 0.5 + (weight * 0.5); // 0.5 - 1.0
    
    // 将十六进制颜色转换为RGB
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // 根据亮度调整颜色
    const newR = Math.min(255, Math.max(0, Math.round(r * brightness)));
    const newG = Math.min(255, Math.max(0, Math.round(g * brightness)));
    const newB = Math.min(255, Math.max(0, Math.round(b * brightness)));
    
    // 转换回十六进制
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

/** 更新高亮状态 (与原始JS实现一致) */
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

    // 触发图谱重绘
    Graph.nodeColor(Graph.nodeColor())
        .linkColor(Graph.linkColor())
        .linkWidth(Graph.linkWidth())
        .linkDirectionalParticles(Graph.linkDirectionalParticles());
}

/** 超采样文字纹理渲染：确保 ID 极致清晰，使用2的幂次方尺寸避免警告 */
function createTextTexture(text, weight, THREE) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = 4;
    ctx.font = `Bold ${32 * scale}px "Fira Code"`;
    const textWidth = ctx.measureText(text).width;
    const padding = 0.5 * scale; // 进一步缩小padding：左右只有2px（0.5 * 4）
    
    // 计算2的幂次方尺寸，避免THREE调整警告
    const calculatePowerOfTwo = (size) => {
        return Math.pow(2, Math.ceil(Math.log2(size)));
    };
    
    const rawWidth = textWidth + padding * 2;
    const rawHeight = 40 * scale; // 进一步缩小高度：从60*scale减少到40*scale
    
    // 使用2的幂次方尺寸
    canvas.width = calculatePowerOfTwo(rawWidth);
    canvas.height = calculatePowerOfTwo(rawHeight);
    
    // 计算居中位置
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    ctx.fillStyle = 'rgba(0, 10, 25, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#3b82f6'; 
    ctx.lineWidth = 0.5 * scale; // 进一步减小边框宽度：从1*scale减少到0.5*scale
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    
    ctx.font = `Bold ${32 * scale}px "Fira Code"`;
    
    // 标签亮度与权重成正比：权重越高，标签越亮
    // 权重范围：0.0 - 1.0，亮度范围：0.3 - 1.0
    const weightValue = weight || 0;
    const brightness = 0.3 + (weightValue * 0.7); // 0.3 - 1.0
    
    // 根据亮度计算颜色值
    const colorValue = Math.floor(255 * brightness);
    const textColor = `rgb(${colorValue}, ${colorValue}, ${colorValue})`;
    
    ctx.fillStyle = textColor; 
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'middle';
    ctx.fillText(text, centerX, centerY);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.baseWidth = rawWidth / scale; 
    texture.baseHeight = rawHeight / scale;
    
    // 设置纹理过滤和包装模式
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    
    return texture;
}

/**
 * 从地宫恢复内容（与原始实现一致）
 */
async function restoreFromNecropolis(node) {
    if (!node || !node.id) return;
    
    try {
        console.log(`[前端地宫恢复] 开始尝试从地宫恢复节点 ${node.id} 的内容`);
        
        const response = await fetch('/api/v1/causal/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: node.id })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log(`[前端地宫恢复] 节点 ${node.id} 已从地宫恢复成功`);
            showSelectionHint(`节点 "${node.id}" 已从地宫恢复完整全息信息`);
            return { restored: true, data: data.data };
        } else {
            console.log(`[前端地宫恢复] 节点 ${node.id} 没有地宫记录: ${data.message}`);
            showSelectionHint(`节点 "${node.id}" 没有地宫记录，显示当前内容`);
            return { restored: false, message: data.message };
        }
    } catch (error) {
        console.error(`[前端地宫恢复] 地宫恢复失败:`, error);
        showSelectionHint(`地宫恢复失败: ${error.message}`);
        return { restored: false, error: error.message };
    }
}

/**
 * 提升节点权重（与原始实现一致）
 */
async function promoteNodeWeight(node) {
    if (!node || !node.id) {
        console.error('提升权重失败：节点或节点ID为空');
        return;
    }
    
    try {
        console.log(`尝试提升节点 ${node.id} 到所有节点总权重的60%`);
        
        // 获取当前用户ID和拥有者ID
        const actorId = window.currentActorId || '';
        const ownerId = window.currentOwnerId || 'default';
        const requestData = { node_id: node.id };
        if (actorId) {
            requestData.actor_id = actorId;
        }
        if (ownerId && ownerId !== 'default') {
            requestData.owner_id = ownerId;
        }
        
        console.log(`[权重提升] 请求数据:`, requestData);
        
        const response = await fetch('/api/v1/causal/promote_chain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        console.log(`[权重提升] API响应:`, data);
        
        if (data.status === 'success') {
            selectNode = true;
            selectedNodeObj = node;
            console.log(`全局权重提升成功: ${data.message}`);
            showSelectionHint(`节点权重已提升到所有节点总权重的60%，更新了 ${data.data.updated_count} 个节点。等待Socket.IO广播具体权重...`);
            return true;
        } else {
            console.log(`全局权重提升失败: ${data.message}`);
            showSelectionHint(`全局权重提升失败: ${data.message}`);
            return false;
        }
    } catch (error) {
        console.error(`全局权重提升失败:`, error);
        showSelectionHint(`全局权重提升失败: ${error.message}`);
        return false;
    }
}

// --- [3. 数据交互与 Socket 逻辑] ---
async function loadInitialData() {
    try {
        const actorId = window.currentActorId || '';
        const ownerId = window.currentOwnerId || 'default';
        
        // 构建查询参数
        const params = new URLSearchParams();
        if (actorId) {
            params.append('actor_id', actorId);
        }
        if (ownerId && ownerId !== 'default') {
            params.append('owner_id', ownerId);
        }
        
        const url = `/api/v1/causal/history${params.toString() ? '?' + params.toString() : ''}`;
        console.log(`[数据加载] 请求URL: ${url}`);
        
        const response = await fetch(url);
        const res = await response.json();
        
        if (res.status === 'success' && Array.isArray(res.data)) {
            console.log(`[数据加载] 成功加载 ${res.data.length} 个节点，owner_id: ${ownerId}`);
            
            // 构建节点列表：如果节点正处于选中/观察状态，保留其物理锁定坐标
            const nodes = res.data.map(node => {
                const isSelected = selectedNodeObj && selectedNodeObj.id === node.node_id;
                return {
                    id: node.node_id,
                    ...node,
                    fx: isSelected ? selectedNodeObj.fx : null,
                    fy: isSelected ? selectedNodeObj.fy : null,
                    fz: isSelected ? selectedNodeObj.fz : null
                };
            });

            // 建立快速索引，用于严格校验连线关系
            const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

            // 严格构建连线：只有当父子节点都实际存在于 nodes 数组中时，才建立连线
            const links = [];
            res.data.forEach(nodeData => {
                const parents = nodeData.parent_ids || (nodeData.parent_id ? [nodeData.parent_id] : []);
                parents.forEach(pId => {
                    if (nodeById[pId] && nodeById[nodeData.node_id]) {
                        links.push({ source: pId, target: nodeData.node_id });
                    }
                });
            });

            Graph.graphData({ nodes, links });
            
            // 防跳跃逻辑：如果没有选中任何节点，才执行全局缩放适应
            if (!selectedNodeObj) {
                setTimeout(() => {
                    Graph.zoomToFit(1200, 150);
                }, 600);
            }
        }
    } catch (error) {
        console.error("数据加载失败:", error);
    }
}

function initSocketHandlers() {
    if (!window.socket) return;
    
    window.socket.on('node_updated', (data) => {
        nodeCache[data.node_id] = data;
        loadInitialData(); // 拓扑可能变化，执行全量刷新
    });
    
    window.socket.on('node_created', (data) => {
        nodeCache[data.node_id] = data;
        loadInitialData();
    });

    window.socket.on('node_deleted', (data) => {
        delete nodeCache[data.node_id];
        if (currentSelectedNodeId === data.node_id) closeDrawer();
        loadInitialData();
    });
}

// --- [4. 抽屉管理与节点 CRUD] ---

function openDrawer(nodeId) {
    // 检查是否处于导航模式，如果是则不打开抽屉
    if (isNavigationMode) {
        console.log(`[抽屉] 导航模式中，跳过打开抽屉: ${nodeId}`);
        return;
    }
    
    // 从Graph的当前数据中获取节点，确保总是最新数据
    let node = null;
    
    if (Graph) {
        const { nodes } = Graph.graphData();
        node = nodes.find(n => n.id === nodeId);
    }
    
    // 如果Graph中没有找到，尝试从缓存中获取
    if (!node) {
        node = nodeCache[nodeId] || { node_id: nodeId };
    }
    
    // 更新缓存
    if (node) {
        nodeCache[nodeId] = node;
    }
    
    currentSelectedNodeId = nodeId;
    
    // 填充所有表单字段
    document.getElementById('d-node-id').value = node.node_id || '';
    
    // 事件叙述：优先使用event_tuple，其次使用content
    const eventTupleField = document.getElementById('d-event-tuple');
    if (eventTupleField) {
        eventTupleField.value = node.event_tuple || node.content || '';
    }
    
    // 动作标签
    const actionTagField = document.getElementById('d-action-tag');
    if (actionTagField) {
        actionTagField.value = node.action_tag || '贞';
    }
    
    // 因缘标签
    const blockTagField = document.getElementById('d-block-tag');
    if (blockTagField) {
        blockTagField.value = node.block_tag || '因';
    }
    
    // 权重值
    const weightValueField = document.getElementById('d-weight-value');
    if (weightValueField) {
        const weight = node.survival_weight || 0;
        weightValueField.textContent = weight.toFixed(4);
        
        // 更新权重条
        const weightBar = document.getElementById('d-weight-bar');
        if (weightBar) {
            const percentage = Math.min(weight * 100, 100);
            weightBar.style.width = `${percentage}%`;
        }
    }
    
    // 父节点ID
    const pIds = node.parent_ids || (node.parent_id ? [node.parent_id] : []);
    document.getElementById('d-parent-ids').value = pIds.join(' | ');
    
    // 图片URL和预览
    const imageUrlField = document.getElementById('d-full-image-url');
    const previewImg = document.getElementById('d-preview-img');
    const imagePreview = document.getElementById('d-image-preview');
    
    if (imageUrlField) {
        imageUrlField.value = node.full_image_url || '';
    }
    
    if (previewImg && imagePreview) {
        const imageUrl = node.full_image_url || node.image_url || '';
        if (imageUrl) {
            previewImg.src = imageUrl;
            imagePreview.classList.remove('hidden');
        } else {
            imagePreview.classList.add('hidden');
        }
    }
    
    // 打开抽屉
    document.getElementById('drawer').classList.remove('drawer-hidden');
    
    console.log(`[抽屉] 已加载节点 ${nodeId} 的数据:`, {
        event_tuple_length: (node.event_tuple || '').length,
        action_tag: node.action_tag,
        block_tag: node.block_tag,
        survival_weight: node.survival_weight,
        parent_ids_count: pIds.length,
        has_image: !!(node.full_image_url || node.image_url)
    });
}

function closeDrawer() {
    document.getElementById('drawer').classList.add('drawer-hidden');
    
    if (selectedNodeObj) {
        // 彻底释放物理锚定
        const node = selectedNodeObj;
        node.fx = null;
        node.fy = null;
        node.fz = null;
        selectedNodeObj = null; // 清空选中状态，允许下次加载时 zoomToFit
    }

    const sim = Graph.d3Force('charge') ? Graph.d3Force('charge').simulation : null;
    if (sim) {
        sim.velocityDecay(0.4); 
        sim.alphaTarget(0.1).restart(); // 恢复微弱动力，让星空自然流动
    }
    
    currentSelectedNodeId = null;
    // 自动回正视角（可选）
    Graph.zoomToFit(1000);
}

async function handleSaveNode() {
    // 获取表单字段的值（使用HTML中实际存在的ID）
    const nodeId = document.getElementById('d-node-id').value.trim();
    const eventTupleField = document.getElementById('d-event-tuple');
    const content = eventTupleField ? eventTupleField.value.trim() : '';
    const actionTagField = document.getElementById('d-action-tag');
    const actionTag = actionTagField ? actionTagField.value : '贞';
    const blockTagField = document.getElementById('d-block-tag');
    const blockTag = blockTagField ? blockTagField.value : '因';
    const parentIdsField = document.getElementById('d-parent-ids');
    const parentIdsInput = parentIdsField ? parentIdsField.value.trim() : '';
    const imageUrlField = document.getElementById('d-full-image-url');
    const fullImageUrl = imageUrlField ? imageUrlField.value.trim() : '';
    
    // 表单验证
    if (!nodeId) {
        showSelectionHint('卜辞不能为空！');
        return;
    }
    
    if (!actionTag) {
        showSelectionHint('动作标签不能为空！');
        return;
    }
    
    if (!blockTag) {
        showSelectionHint('因缘标签不能为空！');
        return;
    }
    
    if (!content) {
        showSelectionHint('事件叙述不能为空！');
        return;
    }
    
    // 解析父ID（使用|分隔，与index.html一致）
    let parentIds = [];
    if (parentIdsInput) {
        parentIds = parentIdsInput.split('|').map(id => id.trim()).filter(id => id);
    }
    
    console.log('[抽屉编辑] 父ID解析结果:', {
        input: parentIdsInput,
        parsed: parentIds,
        length: parentIds.length
    });
    
    // 构建更新数据，与main.py中的update接口匹配
    // 注意：不发送survival_weight字段，因为后端不接受这个字段
    const data = {
        old_node_id: currentSelectedNodeId, // 原始节点ID
        new_node_id: nodeId, // 新节点ID（可能相同）
        event_tuple: content,
        action_tag: actionTag,
        block_tag: blockTag,
        full_image_url: fullImageUrl,
        actor_id: window.currentActorId,
        owner_id: window.currentOwnerId || 'default'
    };
    
    // 总是发送parent_ids字段，即使为空数组
    // 这样后端可以正确处理父ID为空的情况
    data.parent_ids = parentIds;

    console.log('[抽屉编辑] 发送更新数据:', data);

    try {
        const res = await fetch('/api/v1/causal/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        console.log('API响应:', result);
        if (result.status === 'success') {
            showSelectionHint('更新存证成功');
            // 保存修改后，重置 is_change = true（与index.html一致）
            is_change = true;
            console.log('保存修改完成，重置 is_change = true');
            closeDrawer();
        } else {
            showSelectionHint(`更新失败: ${result.message}`);
        }
    } catch (e) { 
        console.error('保存异常:', e);
        showSelectionHint('保存异常'); 
    }
}

async function handleDeleteNode() {
    if (!confirm('确定要彻底抹除该节点及其因果关联吗？')) return;
    try {
        const res = await fetch('/api/v1/causal/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: currentSelectedNodeId, actor_id: window.currentActorId })
        });
        const result = await res.json();
        if (result.status === 'success') {
            showSelectionHint('因果节点已抹除');
            closeDrawer();
        } else {
            showSelectionHint(`删除失败: ${result.message}`);
        }
    } catch (e) { 
        console.error('删除异常:', e);
        showSelectionHint('删除失败'); 
    }
}

// --- [5. 寻龙巡航与引力控制算法] ---

/** 广度优先构建因果链路径：先找到根节点，然后沿着因果链向下游飞行 */
function buildCausalChain(startNode) {
    const { nodes, links } = Graph.graphData();
    const visitedParents = new Set(); // 用于回溯根节点时的防环
    
    // 步骤1：安全回溯根节点
    let rootNode = startNode;
    let searchingRoot = true;
    
    while (searchingRoot) {
        visitedParents.add(rootNode.id);
        const parentLink = links.find(l => {
            const tId = typeof l.target === 'object' ? l.target.id : l.target;
            const sId = typeof l.source === 'object' ? l.source.id : l.source;
            // 找到指向当前节点的父节点，且该父节点还没被访问过（防环）
            return tId === rootNode.id && !visitedParents.has(sId);
        });

        if (parentLink) {
            const sId = typeof parentLink.source === 'object' ? parentLink.source.id : parentLink.source;
            const nextParent = nodes.find(n => n.id === sId);
            if (nextParent) {
                rootNode = nextParent;
            } else {
                searchingRoot = false;
            }
        } else {
            searchingRoot = false;
        }
    }
    
    // 步骤2：从根节点开始，广度优先遍历（已具备 visited 防环）
    const visited = new Set([rootNode.id]);
    const chain = [];
    const queue = [rootNode];

    while (queue.length > 0) {
        const current = queue.shift();
        chain.push(current);
        
        const children = links
            .filter(l => (typeof l.source === 'object' ? l.source.id : l.source) === current.id)
            .map(l => nodes.find(n => n.id === (typeof l.target === 'object' ? l.target.id : l.target)))
            .filter(n => n && !visited.has(n.id));
        
        children.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        children.forEach(c => { 
            visited.add(c.id); 
            queue.push(c); 
        });
    }
    return chain;
}

/**
 * 修复版：寻龙函数（增加安全检查与详细调试输出）
 */
async function startDragonCruise() {
    console.log('[因果巡航] === 开始启动巡航 ===');
    
    // 增加：必须先选中一个节点作为起点，否则不知道巡航哪条链
    if (!selectedNodeObj) {
        console.warn('[因果巡航] 启动失败：未选中任何节点');
        showSelectionHint("请先点击一个节点作为巡航起点");
        return;
    }
    
    console.log(`[因果巡航] 起点节点: ${selectedNodeObj.id}`, selectedNodeObj);
    
    if (isDragonCruising) {
        console.warn('[因果巡航] 启动失败：巡航已在运行中');
        return;
    }

    console.log('[因果巡航] 开始构建因果链...');
    const chain = buildCausalChain(selectedNodeObj);
    console.log(`[因果巡航] 因果链构建完成，共 ${chain.length} 个节点`);
    
    if (chain.length < 1) { 
        console.warn('[因果巡航] 启动失败：未发现有效演化链条');
        showSelectionHint("未发现有效演化链条"); 
        return; 
    }
    
    // 输出链中所有节点信息
    console.log('[因果巡航] 链中节点列表:');
    chain.forEach((node, index) => {
        console.log(`  [${index}] ${node.id} - 动作标签: ${node.action_tag || '无'}, 权重: ${node.survival_weight || 0}, 坐标: (${node.x?.toFixed(2)}, ${node.y?.toFixed(2)}, ${node.z?.toFixed(2)})`);
    });
    
    isDragonCruising = true;
    isNavigationMode = true;
    closeDrawer(); 
    
    console.log(`[因果巡航] 状态设置完成: isDragonCruising=${isDragonCruising}, isNavigationMode=${isNavigationMode}`);
    showSelectionHint(`开启巡航：共 ${chain.length} 节点`);
    
    for (let i = 0; i < chain.length; i++) {
        // 增加：允许用户通过某种方式中断巡航（如果需要）
        if (!isDragonCruising) {
            console.log(`[因果巡航] 巡航被中断，停止在第 ${i} 个节点`);
            break; 
        }

        const node = chain[i];
        selectedNodeObj = node; 
        
        console.log(`[因果巡航] 正在访问第 ${i+1}/${chain.length} 个节点: ${node.id}`);
        console.log(`[因果巡航] 节点详情:`, {
            id: node.id,
            action_tag: node.action_tag,
            block_tag: node.block_tag,
            survival_weight: node.survival_weight,
            coordinates: { x: node.x, y: node.y, z: node.z }
        });
        
        const dist = 160;
        const distance = Math.hypot(node.x, node.y, node.z);
        const ratio = 1 + dist / distance;
        
        console.log(`[因果巡航] 相机计算: 距离=${distance.toFixed(2)}, 比例=${ratio.toFixed(2)}`);
        
        const targetPosition = { 
            x: node.x * ratio, 
            y: node.y * ratio, 
            z: node.z * ratio 
        };
        
        console.log(`[因果巡航] 相机目标位置:`, targetPosition);
        console.log(`[因果巡航] 开始移动相机到节点 ${node.id}...`);
        
        await new Promise(resolve => {
            Graph.cameraPosition(
                targetPosition, 
                node, 
                2000
            );
            
            // 动画完成后停留一小会儿
            setTimeout(() => {
                console.log(`[因果巡航] 节点 ${node.id} 访问完成，停留结束`);
                resolve();
            }, 2200); 
        });
        
        console.log(`[因果巡航] 第 ${i+1}/${chain.length} 个节点访问完成`);
    }
    
    isDragonCruising = false;
    isNavigationMode = false;
    
    console.log('[因果巡航] === 巡航圆满结束 ===');
    console.log(`[因果巡航] 状态重置: isDragonCruising=${isDragonCruising}, isNavigationMode=${isNavigationMode}`);
    
    showSelectionHint("巡航圆满结束");
}

// 注意：HTML中没有btn-gravity-focus按钮，已删除toggleGravityFocus函数

// --- [6. 发起首贞功能] ---

/**
 * 打开创建节点模态框
 */
function openCreateModal() {
    console.log('[发起首贞] 打开创建节点模态框');
    
    // 显示模态框
    const modal = document.getElementById('create-modal');
    if (modal) {
        modal.classList.remove('modal-hidden');
        
        // 清空表单
        document.getElementById('modal-node-id').value = '';
        document.getElementById('modal-event-tuple').value = '';
        document.getElementById('modal-image-file').value = '';
        document.getElementById('modal-image-preview').classList.add('hidden');
        document.getElementById('modal-preview-img').src = '';
        
        // 添加图片预览功能
        const imageFileInput = document.getElementById('modal-image-file');
        if (imageFileInput) {
            // 移除旧的事件监听器（避免重复绑定）
            const newInput = imageFileInput.cloneNode(true);
            imageFileInput.parentNode.replaceChild(newInput, imageFileInput);
            
            newInput.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        document.getElementById('modal-image-preview').classList.remove('hidden');
                        document.getElementById('modal-preview-img').src = e.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
    }
}

/**
 * 关闭创建节点模态框
 */
function closeCreateModal() {
    console.log('[发起首贞] 关闭创建节点模态框');
    const modal = document.getElementById('create-modal');
    if (modal) {
        modal.classList.add('modal-hidden');
    }
}

/**
 * 提交创建节点请求
 */
async function submitCreateNode() {
    console.log('[发起首贞] 提交创建节点请求');
    
    const nodeId = document.getElementById('modal-node-id').value.trim();
    const eventTuple = document.getElementById('modal-event-tuple').value.trim();
    const imageFile = document.getElementById('modal-image-file').files[0];
    
    // 表单验证
    if (!nodeId) {
        showSelectionHint('卜辞不能为空！');
        return;
    }
    
    if (!eventTuple) {
        showSelectionHint('事件叙述不能为空！');
        return;
    }
    
    let fullImageUrl = '';
    
    // 如果有图片文件，先上传
    if (imageFile) {
        try {
            const formData = new FormData();
            formData.append('file', imageFile);
            
            console.log('[发起首贞] 上传图片...');
            const uploadResponse = await fetch('/api/v1/causal/upload', {
                method: 'POST',
                body: formData
            });
            
            const uploadData = await uploadResponse.json();
            if (uploadData.status === 'success') {
                fullImageUrl = uploadData.data.url;
                console.log('[发起首贞] 图片上传成功:', fullImageUrl);
            } else {
                console.error('[发起首贞] 图片上传失败:', uploadData.message);
                showSelectionHint('图片上传失败：' + uploadData.message);
                return;
            }
        } catch (error) {
            console.error('[发起首贞] 图片上传异常:', error);
            showSelectionHint('图片上传失败：' + error.message);
            return;
        }
    }
    
    // 构建请求数据 - 首贞没有父节点，动作标签和因缘标签由后台自动添加
    const requestData = { 
        node_id: nodeId, 
        event_tuple: eventTuple, 
        full_image_url: fullImageUrl,
        actor_id: window.currentActorId,
        owner_id: window.currentOwnerId || 'default'
        // 不发送block_tag、action_tag和parent_id，让后端处理
    };
    
    console.log('[发起首贞] 提交创建请求:', requestData);
    
    try {
        const response = await fetch('/api/v1/causal/genesis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        console.log('[发起首贞] API响应:', data);
        
        if (data.status === 'success') {
            showSelectionHint('事件创建成功！前端将通过Socket.IO实时更新。');
            closeCreateModal();
        } else {
            showSelectionHint('创建失败：' + data.message);
        }
    } catch (error) {
        console.error('[发起首贞] 创建请求异常:', error);
        showSelectionHint('创建失败：' + error.message);
    }
}

// --- [7. 引擎初始化与 UI 绑定] ---
function handleNodeClick(node) {
    if (!node) return;

    // --- 1. 物理锁定与冷却 ---
    const sim = Graph.d3Force('charge') ? Graph.d3Force('charge').simulation : null;
    if (sim) {
        sim.alpha(0);
        sim.alphaTarget(0);
        sim.velocityDecay(0.8);
    }

    node.fx = node.x;
    node.fy = node.y;
    node.fz = node.z;

    // --- 2. 交互分发 ---
    if (!is_change) {
        const field = document.getElementById('d-parent-ids');
        let ids = field.value.split('|').map(s => s.trim()).filter(s => s);
        if (!ids.includes(node.id)) {
            ids.push(node.id);
            field.value = ids.join(' | ');
            showSelectionHint(`已链入父节点: ${node.id}`);
        }
        setTimeout(() => { node.fx = node.fy = node.fz = null; }, 1000);
        return;
    }
    
    selectedNodeObj = node; // 记录当前选中的对象
    openDrawer(node.id);
    
    // --- 3. 动态偏移中心聚焦 ---
    // 计算逻辑：为了让节点出现在“屏幕宽度 - 抽屉宽度”的中心
    const drawerWidth = 450; // 根据你的CSS抽屉宽度调整
    const screenWidth = window.innerWidth;
    // 计算偏移比例：如果抽屉占了一半，偏移就是 0.25
    const offsetRatio = (drawerWidth / screenWidth) * 0.5; 

    const distance = 600; // 放大距离
    const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);

    // 获取相机当前向量，计算侧移量
    const camPos = { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio };
    
    // 强制聚焦，并使用第二个参数（lookAt坐标）进行偏移补偿
    // 我们让相机看向节点略微“向右”一点的位置，使节点视觉左移
    Graph.cameraPosition(
        camPos, 
        { x: node.x + (node.x * offsetRatio), y: node.y, z: node.z }, 
        1200
    );

    // 触发更新
    const requestData = { node_id: node.id };
    if (window.currentActorId) {
        requestData.actor_id = window.currentActorId;
    }
    if (window.currentOwnerId && window.currentOwnerId !== 'default') {
        requestData.owner_id = window.currentOwnerId;
    }
    
    console.log(`[权重提升] 请求数据:`, requestData);
    
    fetch('/api/v1/causal/promote_chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
    });
}

window.addEventListener('load', () => {
    const container = document.getElementById('3d-graph');

    // --- [1. 核心常量配置] ---
    const MIN_RADIUS = 1.5;  // 最小半径
    const MAX_RADIUS = 5.5;  // 最大半径
    const REL_SIZE = 7;      // 引擎缩放系数
    const FOCUS_DIST = 350;  // 聚焦时的相机距离
    const DRAWER_WIDTH = 450; // 右侧抽屉宽度（像素）

    // --- [2. 引擎初始化] ---
    Graph = ForceGraph3D()(container)
        .backgroundColor('#00050a') // 深邃星空底色
        .showNavInfo(false)
        .nodeThreeObjectExtend(false) // 彻底接管节点渲染
        .nodeRelSize(REL_SIZE)
        
        // 【精准正比算法】：确保力场碰撞半径与视觉半径同步
        .nodeVal(node => {
            const weight = Math.max(0, Math.min(1, node.survival_weight || 0));
            const targetRadius = MIN_RADIUS + (weight * (MAX_RADIUS - MIN_RADIUS));
            return Math.pow(targetRadius, 3); // 抵消引擎内部的开立方根
        })

        // --- [3. 天体建模：贞/又贞/对贞] ---
        .nodeThreeObject(node => {
            const THREE = getThreeInstance();
            if (!THREE) return null;

            const weight = Math.max(0, Math.min(1, node.survival_weight || 0));
            const targetRadius = MIN_RADIUS + (weight * (MAX_RADIUS - MIN_RADIUS));
            const actualPhysicalRadius = targetRadius * REL_SIZE;

            const group = new THREE.Group();
            const geometry = new THREE.SphereGeometry(actualPhysicalRadius, 32, 32);
            
            let material;
            const duty = node.action_tag; // 根据你的业务字段判断职责

            // 分类建模逻辑
            if (duty === '贞') {
                // --- 恒星 (Star)：核心、发光、不受色调映射影响以保持耀眼 ---
                material = new THREE.MeshStandardMaterial({
                    color: '#ffcc00',
                    emissive: '#ff9900',
                    emissiveIntensity: 2.5,
                    toneMapped: false, // 视觉增强：允许亮度突破常规限制
                    roughness: 0.1
                });
            } else if (duty === '又贞') {
                // --- 气态行星 (Gas Giant)：轻盈、半透明、高反光 ---
                material = new THREE.MeshStandardMaterial({
                    color: '#00ffcc',
                    transparent: true,
                    opacity: 0.85,
                    metalness: 0.6,
                    roughness: 0.2
                });
            } else if (duty === '对贞') {
                // --- 岩质行星 (Terrestrial)：坚硬、暗淡、高粗糙度 ---
                material = new THREE.MeshStandardMaterial({
                    color: '#4488ff',
                    roughness: 1.0, 
                    metalness: 0.0,
                    emissive: '#000033'
                });
            } else {
                // 默认节点：普通物质
                material = new THREE.MeshStandardMaterial({ color: '#666666' });
            }

            const sphere = new THREE.Mesh(geometry, material);
            group.add(sphere);

            // 【标签对齐】：精准计算文字悬浮位置
            const texture = createTextTexture(node.id, weight, THREE);
            if (texture) {
                const sprite = new THREE.Sprite(
                    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
                );
                const baseScale = 0.45;
                sprite.scale.set(texture.baseWidth * baseScale, texture.baseHeight * baseScale, 1);
                
                // 位置 = 物理半径 + 固定间隙
                sprite.position.y = actualPhysicalRadius + 14; 
                group.add(sprite);
            }

            return group;
        })

        // --- [4. 交互：抽屉避让聚焦算法] ---
        .onNodeClick(node => {
            if (!node) return;

            // 物理锁定
            const sim = Graph.d3Force('charge') ? Graph.d3Force('charge').simulation : null;
            if (sim) { sim.alpha(0); sim.alphaTarget(0); }
            node.fx = node.x; node.fy = node.y; node.fz = node.z;

            // 业务分发
            if (!is_change) {
                const field = document.getElementById('d-parent-ids');
                let ids = field.value.split('|').map(s => s.trim()).filter(s => s);
                if (!ids.includes(node.id)) {
                    ids.push(node.id);
                    field.value = ids.join(' | ');
                }
                setTimeout(() => { node.fx = node.fy = node.fz = null; }, 1000);
                return;
            }
            
            selectedNodeObj = node; 
            openDrawer(node.id); // 唤起右侧抽屉
            
            // 【数学模型】：计算视口偏移
            // 目标：让节点显示在 (屏幕总宽 - 抽屉宽度) 的几何中心
            const screenWidth = window.innerWidth;
            const offsetRatio = (DRAWER_WIDTH / screenWidth) * 0.7; // 偏移系数

            const distRatio = 1 + FOCUS_DIST / Math.hypot(node.x, node.y, node.z);
            const camPos = { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio };

            // 计算注视点：为了让节点在左侧居中，注视点需向右偏移
            const targetLookAt = {
                x: node.x + (Math.abs(node.x) + 200) * offsetRatio, 
                y: node.y,
                z: node.z
            };
            
            Graph.cameraPosition(camPos, targetLookAt, 1200);

            // 后端交互
            const requestData = { node_id: node.id };
            if (window.currentActorId) {
                requestData.actor_id = window.currentActorId;
            }
            if (window.currentOwnerId && window.currentOwnerId !== 'default') {
                requestData.owner_id = window.currentOwnerId;
            }
            
            console.log(`[权重提升] 请求数据:`, requestData);
            
            fetch('/api/v1/causal/promote_chain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
        })

        // --- [5. 连线与细节配置] ---
        .nodeLabel(node => {
            const weight = typeof node.survival_weight === 'number' ? node.survival_weight.toFixed(10) : '0.00';
            return `<div class="force-graph-tooltip">
                <b>${node.id}</b> [${node.action_tag}]<br/>
                权重: ${weight}
            </div>`;
        })
        .nodeColor(node => highlightNodes.has(node) ? '#ffffff' : '#444')
        .onNodeHover(node => {
            container.style.cursor = node ? 'pointer' : null;
            hoverNode = node;
            updateHighlight();
        })
        .linkWidth(l => highlightLinks.has(l) ? 8.0 : 2.0)
        .linkColor(l => highlightLinks.has(l) ? '#fff' : 'rgba(0, 255, 255, 0.2)')
        .linkDirectionalParticles(l => highlightLinks.has(l) ? 10 : 2)
        .linkDirectionalParticleWidth(4)
        .linkDirectionalArrowLength(6)
        .linkDirectionalArrowRelPos(1);

    // --- [6. 初始化力场与事件] ---
    Graph.d3Force('charge').strength(originalForces.charge);
    Graph.d3Force('link').distance(originalForces.link);

    // 绑定界面按钮
    document.getElementById('btn-save-node').onclick = handleSaveNode;
    document.getElementById('btn-delete-node').onclick = handleDeleteNode;
    document.getElementById('btn-close-drawer').onclick = closeDrawer;
    document.getElementById('btn-fit-view').onclick = () => Graph.zoomToFit(800);
    
    // 绑定因果巡航按钮
    const dragonCruiseBtn = document.getElementById('btn-dragon-cruise');
    if (dragonCruiseBtn) {
        dragonCruiseBtn.onclick = startDragonCruise;
        console.log('[因果巡航] 按钮事件绑定成功');
    } else {
        console.warn('[因果巡航] 警告：未找到btn-dragon-cruise按钮元素');
    }
    
    // 绑定发起首贞按钮
    const createNodeBtn = document.getElementById('btn-create-node');
    if (createNodeBtn) {
        createNodeBtn.onclick = openCreateModal;
        console.log('[发起首贞] 按钮事件绑定成功');
    } else {
        console.warn('[发起首贞] 警告：未找到btn-create-node按钮元素');
    }
    
    // 绑定模态框取消和提交按钮
    const cancelCreateBtn = document.getElementById('btn-cancel-create');
    if (cancelCreateBtn) {
        cancelCreateBtn.onclick = closeCreateModal;
    }
    
    const submitCreateBtn = document.getElementById('btn-submit-create');
    if (submitCreateBtn) {
        submitCreateBtn.onclick = submitCreateNode;
    }
    
    // 初始化 Socket 与 数据
    initSocketHandlers();
    loadInitialData();
});
