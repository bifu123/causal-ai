// 配置Socket.IO连接，确保与服务器兼容
const socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

// Socket.IO连接状态监听
socket.on('connect', () => {
    console.log('[Socket.IO] 连接成功，socket.id:', socket.id);
});

socket.on('connect_error', (error) => {
    console.error('[Socket.IO] 连接错误:', error);
});

socket.on('disconnect', (reason) => {
    console.log('[Socket.IO] 断开连接:', reason);
});

let currentSelectedNode = null;
const nodeCache = {}; // 存储完整数据

// 父ID填充功能状态
let is_change = true; // 控制是否打开抽屉：true=打开抽屉，false=只填充父ID
let activeParentIdField = null; // 当前处于焦点状态的父ID输入框
let parentIdSelectionMode = false; // 是否处于父ID选择模式

// --- Vis-Network 配置：寻龙排版 ---
const nodes = new vis.DataSet([]);
const edges = new vis.DataSet([]);
const container = document.getElementById('network');

const options = {
    nodes: {
        shape: 'dot',
        size: 20,
        borderWidth: 2,
        color: { border: '#1d4ed8', background: '#0f172a', highlight: { border: '#60a5fa', background: '#1e3a8a' } },
        font: { color: '#94a3b8', size: 12, face: 'monospace' },
        scaling: {
            min: 10,
            max: 40,
            label: {
                enabled: true,
                min: 8,
                max: 30,
                drawThreshold: 5,
                maxVisible: 20
            }
        }
    },
    edges: {
        arrows: 'to',
        color: { color: '#334155', highlight: '#3b82f6' },
        smooth: { type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.6 },
        length: 200, // 边的默认长度
        width: 2
    },
    layout: {
        hierarchical: {
            enabled: false, // 禁用分层布局，使用物理模拟
            direction: 'LR',
            sortMethod: 'directed',
            levelSeparation: 250
        }
    },
    physics: {
        enabled: true,
        barnesHut: {
            gravitationalConstant: -8000, // 引力常数（负值表示排斥，正值表示吸引）
            centralGravity: 0.5, // 中心引力
            springLength: 150, // 弹簧长度
            springConstant: 0.08, // 弹簧常数
            damping: 0.3, // 阻尼
            avoidOverlap: 0.5 // 避免重叠
        },
        repulsion: {
            centralGravity: 0.4, // 中心引力
            springLength: 150, // 弹簧长度
            springConstant: 0.1, // 弹簧常数
            nodeDistance: 150, // 节点距离
            damping: 0.3 // 阻尼
        },
        forceAtlas2Based: {
            gravitationalConstant: -100, // 引力常数
            centralGravity: 0.05, // 中心引力
            springLength: 120, // 弹簧长度
            springConstant: 0.12, // 弹簧常数
            avoidOverlap: 0.3 // 避免重叠
        },
        solver: 'barnesHut', // 使用Barnes-Hut算法
        stabilization: {
            enabled: true,
            iterations: 500, // 稳定化迭代次数
            updateInterval: 50,
            onlyDynamicEdges: false,
            fit: true
        },
        timestep: 0.3, // 时间步长
        adaptiveTimestep: true, // 自适应时间步长
        minVelocity: 0.75, // 最小速度
        maxVelocity: 50 // 最大速度
    },
    interaction: {
        dragNodes: true,
        dragView: true,
        hideEdgesOnDrag: false,
        hideNodesOnDrag: false,
        hover: true,
        hoverConnectedEdges: true,
        keyboard: {
            enabled: true,
            speed: { x: 10, y: 10, zoom: 0.02 },
            bindToWindow: true
        },
        multiselect: true,
        navigationButtons: true,
        selectable: true,
        selectConnectedEdges: true,
        tooltipDelay: 300,
        zoomSpeed: 1,
        zoomView: true
    }
};
const network = new vis.Network(container, {nodes, edges}, options);

// --- 初始化：寻龙点穴 (加载历史) ---
async function initCausalGraph() {
    console.log("[司南] 启动感应...");
    try {
        const response = await fetch('/api/v1/causal/history');
        const res = await response.json();
        console.log('API响应:', res);
        if (res.status === 'success') {
            // 检查第一个节点的字段
            if (res.data.length > 0) {
                const firstNode = res.data[0];
                console.log('第一个节点数据:', firstNode);
                console.log('第一个节点动作标签:', firstNode.action_tag, '类型:', typeof firstNode.action_tag);
                console.log('第一个节点因缘标签:', firstNode.block_tag, '类型:', typeof firstNode.block_tag);
            }
            res.data.forEach(node => renderNode(node));
            network.fit(); // 渲染完成后自动缩放全景
            console.log("[司南] 龙脉还原完毕。");
        }
    } catch (err) {
        console.error("[司南故障] 无法感知历史记录。");
    }
}

// 辅助函数：HTML转义，防止XSS攻击
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const map = {
        '&': '&',
        '<': '<',
        '>': '>',
        '"': '"',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

// --- 渲染逻辑 ---
function renderNode(node) {
    nodeCache[node.node_id] = node;
    
    // 根据动作标签设置不同的颜色
    let nodeColor = {
        border: '#1d4ed8',
        background: '#0f172a',
        highlight: { border: '#60a5fa', background: '#1e3a8a' }
    };
    
    // 根据动作标签设置颜色
    const actionTag = node.action_tag || '贞';
    switch(actionTag) {
        case '贞':
            // 贞：橙色（投入意志）
            nodeColor = {
                border: '#d97706', // 橙色边框
                background: '#78350f', // 深橙色背景
                highlight: { border: '#f59e0b', background: '#92400e' }
            };
            break;
        case '又贞':
            // 又贞：绿色（表示继续）
            nodeColor = {
                border: '#059669', // 绿色边框
                background: '#064e3b', // 深绿色背景
                highlight: { border: '#10b981', background: '#065f46' }
            };
            break;
        case '对贞':
            // 对贞：蓝色（结果，安静）
            nodeColor = {
                border: '#1d4ed8', // 蓝色边框
                background: '#0f172a', // 深色背景
                highlight: { border: '#60a5fa', background: '#1e3a8a' }
            };
            break;
        default:
            // 默认：橙色
            nodeColor = {
                border: '#d97706',
                background: '#78350f',
                highlight: { border: '#f59e0b', background: '#92400e' }
            };
    }
    
// 计算节点大小：基于权重，权重越高节点越大
// 权重范围：0.0 - 1.0，节点大小范围：20 - 60（变化更明显）
// 修复权重处理：当权重为0时，应该显示为0，而不是1.0
const rawWeight = node.survival_weight;
const weight = (rawWeight === null || rawWeight === undefined) ? 0.0 : parseFloat(rawWeight);
// 使用指数增长：权重越高，节点大小增长越快
const nodeSize = 20 + (weight * weight * 40); // 20 + (0.0 * 0.0 * 40) = 20, 20 + (1.0 * 1.0 * 40) = 60
    
    // 根据权重调整颜色亮度
    // 权重越高，颜色越亮；权重越低，颜色越暗
    const brightnessFactor = 0.7 + (weight * 0.6); // 0.7 - 1.3 范围
    
    // 调整颜色亮度
    const adjustedColor = {
        border: adjustColorBrightness(nodeColor.border, brightnessFactor),
        background: adjustColorBrightness(nodeColor.background, brightnessFactor * 1.2), // 背景更亮
        highlight: {
            border: adjustColorBrightness(nodeColor.highlight.border, brightnessFactor * 1.1),
            background: adjustColorBrightness(nodeColor.highlight.background, brightnessFactor * 1.3)
        }
    };
    
    // 根据权重确定动画效果
    let animationClass = '';
    if (weight >= 0.8) {
        animationClass = 'high-weight-node'; // 高权重：呼吸+发光
    } else if (weight >= 0.5) {
        animationClass = 'medium-weight-node'; // 中权重：呼吸
    } else {
        animationClass = 'low-weight-node'; // 低权重：缓慢呼吸
    }
    
    // 对事件叙述进行字符截取，最多显示250个字符（与3D界面一致）
    let eventTuple = node.event_tuple || '无事件叙述';
    const maxLength = 250;
    if (eventTuple.length > maxLength) {
        eventTuple = eventTuple.substring(0, maxLength) + '...';
    }
    
    // 构建符合要求的新 tooltip HTML，并将其转换为DOM元素
    const tooltipHtml = `
    <div class="vis-tooltip-custom">
        <div class="tooltip-node-id">${escapeHtml(node.node_id)}</div>
        
        <div class="tooltip-content-body">
            <div class="tooltip-weight-row">
                <span class="label">生存权重:</span>
                <span class="value-weight">${escapeHtml(weight.toFixed(10))}</span>
                <span class="status-text">(${escapeHtml(getWeightStatus(weight))})</span>
            </div>
            
            <div class="tooltip-abstract-row">
                <div class="label">内容摘要:</div>
                <div class="value-abstract">${escapeHtml(eventTuple)}</div>
            </div>
        </div>
    </div>`;
    
    // 创建DOM容器元素并注入HTML，以避免Vis.js显示HTML源码
    const tooltipContainer = document.createElement('div');
    tooltipContainer.innerHTML = tooltipHtml;
    
    nodes.update({ 
        id: node.node_id, 
        label: node.node_id, 
        title: tooltipContainer,
        color: adjustedColor,
        size: nodeSize,
        value: weight, // 用于物理模拟的引力计算
        font: { 
            color: adjustColorBrightness('#94a3b8', brightnessFactor * 1.5),
            size: Math.max(10, Math.min(16, 10 + (weight * 6))), // 标签大小：10-16px（恢复原字号）
            face: 'monospace',
            bold: weight > 0.7
        },
        borderWidth: 2 + (weight * 3), // 边框宽度随权重增加
        shadow: weight > 0.6, // 高权重节点有阴影
        shadowColor: 'rgba(255, 255, 255, 0.3)',
        shadowSize: 10,
        shadowX: 0,
        shadowY: 0
    });
    
    // 处理多父节点连接
    if (node.parent_ids && node.parent_ids.length > 0) {
        node.parent_ids.forEach(parentId => {
            const edgeId = `${parentId}-${node.node_id}`;
            // 边的宽度也随权重变化
            const edgeWidth = 1 + (weight * 2);
            edges.update({ 
                id: edgeId, 
                from: parentId, 
                to: node.node_id, 
                label: node.action_tag,
                width: edgeWidth,
                color: {
                    color: adjustColorBrightness('#334155', brightnessFactor),
                    highlight: adjustColorBrightness('#3b82f6', brightnessFactor * 1.2)
                }
            });
        });
    } else if (node.parent_id) {
        // 向后兼容：处理单个父节点
        const edgeId = `${node.parent_id}-${node.node_id}`;
        const edgeWidth = 1 + (weight * 2);
        edges.update({ 
            id: edgeId, 
            from: node.parent_id, 
            to: node.node_id, 
            label: node.action_tag,
            width: edgeWidth,
            color: {
                color: adjustColorBrightness('#334155', brightnessFactor),
                highlight: adjustColorBrightness('#3b82f6', brightnessFactor * 1.2)
            }
        });
    }
}

// 辅助函数：调整颜色亮度
function adjustColorBrightness(color, factor) {
    // 简单的亮度调整（对于十六进制颜色）
    if (color.startsWith('#')) {
        // 将十六进制转换为RGB
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        
        // 调整亮度
        const newR = Math.min(255, Math.max(0, Math.round(r * factor)));
        const newG = Math.min(255, Math.max(0, Math.round(g * factor)));
        const newB = Math.min(255, Math.max(0, Math.round(b * factor)));
        
        // 转换回十六进制
        return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    }
    return color;
}

// 辅助函数：获取权重状态描述
function getWeightStatus(weight) {
    if (weight >= 0.9) return '强盛';
    if (weight >= 0.7) return '活跃';
    if (weight >= 0.5) return '稳定';
    if (weight >= 0.3) return '衰减';
    return '微弱';
}

// --- 交互逻辑 ---
async function postNode(payload) {
    const res = await fetch('/api/v1/causal/genesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.status === 'error') {
        alert(data.message);
    } else {
        // 成功提交后显示提示，Socket.IO会自动更新前端
        alert('事件创建成功！前端将通过Socket.IO实时更新。');
    }
}

function openCreateModal() {
    // 创建自定义模态框
    const modalHtml = `
        <div id="create-modal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 w-96">
                <h3 class="text-lg font-bold text-blue-400 mb-4">发起首贞</h3>
                
                <div class="space-y-4">
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">卜辞</label>
                        <input id="modal-node-id" type="text" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    </div>
                    
                <input id="modal-block-tag" type="hidden" value="因">
                <input id="modal-action-tag" type="hidden" value="贞">
                
                <div>
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">事件叙述</label>
                        <textarea id="modal-event-tuple" class="w-full h-24 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"></textarea>
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">图片上传</label>
                        <input id="modal-image-file" type="file" accept="image/*" class="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700">
                        <div id="image-preview" class="mt-2 hidden">
                            <img id="preview-img" class="max-h-32 rounded border border-gray-700">
                        </div>
                    </div>
                </div>
                
                <div class="flex justify-end space-x-3 mt-6">
                    <button onclick="closeCreateModal()" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm rounded">取消</button>
                    <button onclick="submitCreateNode()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-sm rounded">创建</button>
                </div>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // 添加图片预览功能
    document.getElementById('modal-image-file').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('image-preview').classList.remove('hidden');
                document.getElementById('preview-img').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

// 加载父节点选项
async function loadParentOptions() {
    try {
        const response = await fetch('/api/v1/causal/history');
        const res = await response.json();
        if (res.status === 'success') {
            const container = document.getElementById('parent-select-container');
            container.innerHTML = '';
            
            if (res.data.length === 0) {
                container.innerHTML = '<div class="text-xs text-gray-500 text-center py-2">暂无节点，请先创建根节点</div>';
                return;
            }
            
            // 创建复选框列表
            res.data.forEach(node => {
                const checkboxId = `parent-checkbox-${node.node_id}`;
                const checkbox = document.createElement('div');
                checkbox.className = 'flex items-center space-x-2 py-1';
                checkbox.innerHTML = `
                    <input type="checkbox" id="${checkboxId}" value="${node.node_id}" 
                            class="rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900">
                    <label for="${checkboxId}" class="text-xs text-gray-300 cursor-pointer">${node.node_id}</label>
                `;
                container.appendChild(checkbox);
                
                // 添加点击事件
                document.getElementById(checkboxId).addEventListener('change', updateSelectedParents);
            });
            
            // 初始化选择状态
            updateSelectedParents();
        }
    } catch (err) {
        console.error('加载父节点选项失败:', err);
        const container = document.getElementById('parent-select-container');
        container.innerHTML = '<div class="text-xs text-red-500 text-center py-2">加载失败</div>';
    }
}

// 更新已选择的父节点
function updateSelectedParents() {
    const checkboxes = document.querySelectorAll('#parent-select-container input[type="checkbox"]');
    const selectedParents = [];
    
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            selectedParents.push(checkbox.value);
        }
    });
    
    // 更新显示
    document.getElementById('selected-parents-count').textContent = selectedParents.length;
    document.getElementById('selected-parents-list').textContent = selectedParents.length > 0 
        ? `(${selectedParents.join(', ')})` 
        : '';
}

function closeCreateModal() {
    const modal = document.getElementById('create-modal');
    if (modal) modal.remove();
}

async function submitCreateNode() {
    const nodeId = document.getElementById('modal-node-id').value.trim();
    const eventTuple = document.getElementById('modal-event-tuple').value.trim();
    const imageFile = document.getElementById('modal-image-file').files[0];
    
    if (!nodeId) {
        alert('卜辞 不能为空！');
        return;
    }
    
    if (!eventTuple) {
        alert('事件叙述不能为空！');
        return;
    }
    
    let fullImageUrl = '';
    
    // 如果有图片文件，先上传
    if (imageFile) {
        try {
            const formData = new FormData();
            formData.append('file', imageFile);
            
            const uploadResponse = await fetch('/api/v1/causal/upload', {
                method: 'POST',
                body: formData
            });
            
            const uploadData = await uploadResponse.json();
            if (uploadData.status === 'success') {
                fullImageUrl = uploadData.data.url;
            } else {
                alert('图片上传失败：' + uploadData.message);
                return;
            }
        } catch (error) {
            alert('图片上传失败：' + error.message);
            return;
        }
    }
    
    // 构建请求数据 - 首贞没有父节点，动作标签和因缘标签由后台自动添加
    const requestData = { 
        node_id: nodeId, 
        event_tuple: eventTuple, 
        full_image_url: fullImageUrl,
        owner_id: currentOwnerId
        // 不发送block_tag、action_tag和parent_id，让后端处理
    };
    
    // 提交事件创建
    postNode(requestData);
    
    closeCreateModal();
}

function deriveNode(tag) {
    if (!currentSelectedNode) return;
    
    // 创建子节点模态框（基于单个父节点）
    const modalHtml = `
        <div id="derive-modal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 w-96">
                <h3 class="text-lg font-bold text-blue-400 mb-4">寻龙：${tag}（基于: ${currentSelectedNode}）</h3>
                
                <div class="space-y-4">
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">卜辞</label>
                        <input id="derive-node-id" type="text" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">动作标签</label>
                        <input type="text" value="${tag}" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-400" readonly>
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">因缘标签 <span class="text-red-500">*</span></label>
                        <select id="derive-block-tag" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                            ${tag === '又贞' ? `
                                <option value="">请选择因缘标签</option>
                                <option value="因">因 (原因/起因)</option>
                                <option value="相">相 (现象/状态)</option>
                            ` : `
                                <option value="果" selected>果 (结果/成果)</option>
                            `}
                        </select>
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">事件叙述</label>
                        <textarea id="derive-event-tuple" class="w-full h-24 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"></textarea>
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">图片上传</label>
                        <input id="derive-image-file" type="file" accept="image/*" class="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700">
                        <div id="derive-image-preview" class="mt-2 hidden">
                            <img id="derive-preview-img" class="max-h-32 rounded border border-gray-700">
                        </div>
                    </div>
                </div>
                
                <div class="flex justify-end space-x-3 mt-6">
                    <button onclick="closeDeriveModal()" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm rounded">取消</button>
                    <button onclick="submitDeriveNode('${tag}', '${currentSelectedNode}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-sm rounded">创建</button>
                </div>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // 添加图片预览功能
    document.getElementById('derive-image-file').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('derive-image-preview').classList.remove('hidden');
                document.getElementById('derive-preview-img').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    
    // 如果是"对贞"，禁用因缘标签选择
    if (tag === '对贞') {
        document.getElementById('derive-block-tag').disabled = true;
    }
}

// 关闭寻龙模态框
function closeDeriveModal() {
    const modal = document.getElementById('derive-modal');
    if (modal) modal.remove();
}

// 提交寻龙节点创建
async function submitDeriveNode(tag, parentId) {
    const nodeId = document.getElementById('derive-node-id').value.trim();
    const blockTag = document.getElementById('derive-block-tag').value;
    const eventTuple = document.getElementById('derive-event-tuple').value.trim();
    const imageFile = document.getElementById('derive-image-file').files[0];
    
    if (!nodeId) {
        alert('卜辞 不能为空！');
        return;
    }
    
    if (!blockTag) {
        alert('因缘标签不能为空！');
        return;
    }
    
    if (!eventTuple) {
        alert('事件叙述不能为空！');
        return;
    }
    
    let fullImageUrl = '';
    
    // 如果有图片文件，先上传
    if (imageFile) {
        try {
            const formData = new FormData();
            formData.append('file', imageFile);
            
            const uploadResponse = await fetch('/api/v1/causal/upload', {
                method: 'POST',
                body: formData
            });
            
            const uploadData = await uploadResponse.json();
            if (uploadData.status === 'success') {
                fullImageUrl = uploadData.data.url;
            } else {
                alert('图片上传失败：' + uploadData.message);
                return;
            }
        } catch (error) {
            alert('图片上传失败：' + error.message);
            return;
        }
    }
    
// 提交创建请求
postNode({ 
    node_id: nodeId, 
    block_tag: blockTag,
    parent_id: [parentId],
    event_tuple: eventTuple, 
    action_tag: tag,
    full_image_url: fullImageUrl,
    owner_id: currentOwnerId
});
    
    closeDeriveModal();
}

// 更新因缘标签选项（根据动作标签）
function updateDrawerBlockTagOptions() {
    const actionTag = document.getElementById('d-action-tag').value;
    const blockTagSelect = document.getElementById('d-block-tag');
    
    // 保存当前选中的值
    const currentValue = blockTagSelect.value;
    
    // 清空现有选项
    blockTagSelect.innerHTML = '';
    
    if (actionTag === '贞' || actionTag === '又贞') {
        // 贞和又贞：有"因"、"相"两个值
        blockTagSelect.innerHTML = `
            <option value="因">因 (原因/起因)</option>
            <option value="相">相 (现象/状态)</option>
        `;
        blockTagSelect.disabled = false;
    } else if (actionTag === '对贞') {
        // 对贞：只有"果"这个值
        blockTagSelect.innerHTML = `
            <option value="果" selected>果 (结果/成果)</option>
        `;
        blockTagSelect.disabled = true;
    }
    
    // 恢复之前选中的值（如果在新选项中存在）
    if (blockTagSelect.querySelector(`option[value="${currentValue}"]`)) {
        blockTagSelect.value = currentValue;
    }
}

function openDrawer(nodeId) {
    currentSelectedNode = nodeId;
    const data = nodeCache[nodeId];
    
    console.log('打开抽屉，节点数据:', data);
    
    // 填充表单字段
    document.getElementById('d-node-id').value = nodeId;
    document.getElementById('d-event-tuple').value = data ? data.event_tuple : '';
    document.getElementById('d-full-image-url').value = data ? (data.full_image_url || '') : '';
    
    // 填充动作标签和因缘标签
    if (data) {
        // 动作标签 - 调试输出
        console.log('节点动作标签:', data.action_tag, '类型:', typeof data.action_tag);
        // 如果动作标签不存在或为空字符串，使用默认值'贞'
        const actionTag = (data.action_tag && data.action_tag.trim()) ? data.action_tag : '贞';
        document.getElementById('d-action-tag').value = actionTag;
        
        // 因缘标签 - 调试输出
        console.log('节点因缘标签:', data.block_tag, '类型:', typeof data.block_tag);
        // 如果因缘标签不存在或为空字符串，使用默认值'因'
        const blockTag = (data.block_tag && data.block_tag.trim()) ? data.block_tag : '因';
        
        // 先更新因缘标签选项（根据动作标签）
        updateDrawerBlockTagOptions();
        
        // 然后设置因缘标签的值（在更新选项之后）
        document.getElementById('d-block-tag').value = blockTag;
    } else {
        // 默认值
        console.log('节点数据为空，使用默认值');
        document.getElementById('d-action-tag').value = '贞';
        updateDrawerBlockTagOptions();
        document.getElementById('d-block-tag').value = '因';
    }
    
    // 填充父ID字段
    if (data) {
        let parentIds = [];
        if (data.parent_ids && data.parent_ids.length > 0) {
            parentIds = data.parent_ids;
        } else if (data.parent_id) {
            parentIds = [data.parent_id];
        }
        document.getElementById('d-parent-ids').value = parentIds.join(' | ');
    } else {
        document.getElementById('d-parent-ids').value = '';
    }
    
    // 修复权重处理：确保权重为0时正确显示为0%
    const rawWeight = data ? data.survival_weight : 0;
    const weight = (rawWeight === null || rawWeight === undefined) ? 0.0 : parseFloat(rawWeight);
    document.getElementById('d-weight-bar').style.width = `${weight * 100}%`;
    document.getElementById('d-weight-value').textContent = weight.toFixed(10);
    
    // 显示事件图片（如果存在）
    const imagePreview = document.getElementById('d-image-preview');
    const previewImg = document.getElementById('d-preview-img');
    if (data && data.full_image_url) {
        // 显示现有图片
        previewImg.src = data.full_image_url;
        imagePreview.classList.remove('hidden');
    } else {
        // 隐藏图片预览
        imagePreview.classList.add('hidden');
        previewImg.src = '';
    }
    
    document.getElementById('drawer').classList.remove('drawer-hidden');
    
    // 抽屉打开时，调整网格图位置，避免被抽屉遮挡
    const networkContainer = document.getElementById('network');
    if (networkContainer) {
        networkContainer.style.right = '384px'; // 抽屉宽度 w-96 = 384px
        networkContainer.style.transition = 'right 0.3s ease';
        console.log('抽屉打开，网格图 right = 384px（抽屉宽度）');
    }
    
    // 抽屉打开时，重新调整网络图使其适应新的可用空间
    setTimeout(() => {
        network.fit();
        console.log('抽屉打开，重新调整网络图');
        
        // 默认让d-event-tuple获得焦点
        const eventTupleField = document.getElementById('d-event-tuple');
        if (eventTupleField) {
            eventTupleField.focus();
            console.log('抽屉打开，d-event-tuple获得焦点');
        }
    }, 100);
}

function closeDrawer() {
    document.getElementById('drawer').classList.add('drawer-hidden');
    currentSelectedNode = null;
    
    // 抽屉关闭时，移除网格图的 right 属性
    const networkContainer = document.getElementById('network');
    if (networkContainer) {
        networkContainer.style.right = '';
        console.log('抽屉关闭，移除网格图 right 属性');
    }
    
    // 抽屉关闭时，设置 is_change = true
    is_change = true;
    console.log('抽屉关闭，设置 is_change = true');
}


// 为事件上传图片
async function uploadImageForNode() {
    if (!currentSelectedNode) {
        alert('请先选择一个事件！');
        return;
    }
    
    const imageFile = document.getElementById('d-image-file').files[0];
    if (!imageFile) {
        alert('请选择要上传的图片文件！');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append('file', imageFile);
        
        const uploadResponse = await fetch('/api/v1/causal/upload', {
            method: 'POST',
            body: formData
        });
        
        const uploadData = await uploadResponse.json();
        if (uploadData.status === 'success') {
            const imageUrl = uploadData.data.url;
            
            // 更新图片URL输入框
            document.getElementById('d-full-image-url').value = imageUrl;
            
            // 显示图片预览
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('d-image-preview').classList.remove('hidden');
                document.getElementById('d-preview-img').src = e.target.result;
            };
            reader.readAsDataURL(imageFile);
            
            alert('图片上传成功！请点击"保存修改"按钮保存到事件。');
        } else {
            alert('图片上传失败：' + uploadData.message);
        }
    } catch (error) {
        alert('图片上传失败：' + error.message);
    }
}

// 删除当前事件
async function deleteCurrentNode() {
    if (!currentSelectedNode) return;
    
    if (!confirm(`确定要删除事件 "${currentSelectedNode}" 吗？\n\n删除操作将：\n1. 删除数据库中本条记录\n2. 删除地宫表中对应记录\n3. 将其子事件的父ID更新为本事件的父ID`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/v1/causal/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: currentSelectedNode })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            alert('事件删除成功！前端将通过Socket.IO实时更新。');
            // 关闭抽屉
            closeDrawer();
        } else {
            alert('删除失败：' + data.message);
        }
    } catch (error) {
        alert('删除失败：' + error.message);
    }
}

// 保存事件修改
async function saveNodeChanges() {
    console.log('保存按钮被点击，currentSelectedNode:', currentSelectedNode);
    
    if (!currentSelectedNode) {
        alert('请先选择一个事件节点！');
        return;
    }
    
    const oldNodeId = currentSelectedNode;
    const newNodeId = document.getElementById('d-node-id').value.trim();
    const actionTag = document.getElementById('d-action-tag').value;
    const blockTag = document.getElementById('d-block-tag').value;
    const eventTuple = document.getElementById('d-event-tuple').value.trim();
    const fullImageUrl = document.getElementById('d-full-image-url').value.trim();
    const parentIdsInput = document.getElementById('d-parent-ids').value.trim();
    
    console.log('表单数据:', { oldNodeId, newNodeId, actionTag, blockTag, eventTuple, fullImageUrl, parentIdsInput });
    
    // 表单验证：除了图片字段，所有字段必填
    if (!newNodeId) {
        alert('卜辞不能为空！');
        return;
    }
    
    if (!actionTag) {
        alert('动作标签不能为空！');
        return;
    }
    
    if (!blockTag) {
        alert('因缘标签不能为空！');
        return;
    }
    
    if (!eventTuple) {
        alert('事件叙述不能为空！');
        return;
    }
    
    // 父ID字段可以为空（允许根节点）
    
    // 解析父ID
    let parentIds = [];
    if (parentIdsInput) {
        parentIds = parentIdsInput.split('|').map(id => id.trim()).filter(id => id);
    }
    
    // 构建更新数据
    const updateData = {
        old_node_id: oldNodeId,
        new_node_id: newNodeId,
        action_tag: actionTag,
        block_tag: blockTag,
        event_tuple: eventTuple,
        full_image_url: fullImageUrl,
        owner_id: currentOwnerId
    };
    
    // 如果有父ID，添加到更新数据中
    if (parentIds.length > 0) {
        updateData.parent_ids = parentIds;
    }
    
    console.log('发送更新数据:', updateData);
    
    try {
        const response = await fetch('/api/v1/causal/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });
        
        console.log('API响应状态:', response.status);
        const data = await response.json();
        console.log('API响应数据:', data);
        
        if (data.status === 'success') {
            alert('修改保存成功！前端将通过Socket.IO实时更新。');
            // 保存修改后，重置 is_change = true
            is_change = true;
            console.log('保存修改完成，重置 is_change = true');
            // 关闭抽屉
            closeDrawer();
        } else {
            alert('保存失败：' + data.message);
        }
    } catch (error) {
        console.error('保存请求失败:', error);
        alert('保存失败：' + error.message);
    }
}

// --- 事件监听 ---
network.on("click", (p) => {
    if (p.nodes.length) {
        const nodeId = p.nodes[0];
        console.log('点击节点:', nodeId, 'is_change:', is_change, 'parentIdSelectionMode:', parentIdSelectionMode);
        
        // 首先检查是否处于父ID选择模式
        if (handleNodeClickForParentId(nodeId)) {
            // 如果已处理父ID填充，直接返回
            console.log('已处理父ID填充，不打开抽屉');
            return;
        }
        
        // 如果是Ctrl+点击或Shift+点击，进行多选
        if (p.event.ctrlKey || p.event.shiftKey) {
            toggleNodeSelection(nodeId);
        } else {
            // 普通点击，首先尝试从地宫恢复内容，然后提升因果链权重
            restoreFromNecropolis(nodeId).then(restoreResult => {
                // 如果地宫恢复成功，直接使用恢复的数据更新抽屉
                if (restoreResult.restored && restoreResult.data) {
                    console.log('地宫恢复成功，直接使用恢复的数据更新抽屉');
                    
                    // 立即更新抽屉显示恢复的全息信息
                    if (is_change) {
                        // 直接使用恢复的数据填充抽屉
                        updateDrawerWithNecropolisData(nodeId, restoreResult.data);
                    }
                }
                
                // 无论地宫恢复是否成功，都尝试提升因果链权重
                return promoteChainWeights(nodeId).then(promoted => {
                    console.log('权重提升完成');
                    // 根据 is_change 决定是否打开抽屉（如果地宫恢复失败或没有恢复数据）
                    if (is_change && (!restoreResult.restored || !restoreResult.data)) {
                        // 延迟打开抽屉，确保Socket.IO已经接收到更新
                        setTimeout(() => {
                            console.log('打开抽屉，显示当前内容');
                            openDrawerWithLatestData(nodeId);
                        }, 300);
                    } else if (!is_change) {
                        console.log('is_change = false，只填充父ID字段');
                        // is_change = false 时，只将节点ID添加到父ID字段
                        addNodeIdToParentField(nodeId);
                    }
                });
            }).catch(error => {
                console.error('节点点击处理失败:', error);
                // 恢复失败时，正常打开抽屉
                if (is_change) {
                    openDrawerWithLatestData(nodeId);
                } else {
                    addNodeIdToParentField(nodeId);
                }
            });
        }
    } else {
        closeDrawer();
    }
});

// 右键菜单：选择多个父节点（添加到选中集合）
network.on("oncontext", (p) => {
    p.event.preventDefault();
    if (p.nodes.length) {
        addNodeToSelection(p.nodes[0]);
    }
});

// 双击：基于选中的父节点创建子节点
network.on("doubleClick", (p) => {
    if (p.nodes.length) {
        // 双击节点时，如果已经选择了多个节点，基于这些节点创建子节点
        if (selectedParentNodes.size > 0) {
            createChildFromSelectedParents();
        } else {
            // 否则，只选择当前节点
            toggleNodeSelection(p.nodes[0]);
        }
    }
});

// 选中的父节点集合
let selectedParentNodes = new Set();

// 切换节点选择状态
function toggleNodeSelection(nodeId) {
    if (selectedParentNodes.has(nodeId)) {
        selectedParentNodes.delete(nodeId);
        nodes.update({ id: nodeId, color: { border: '#1d4ed8', background: '#0f172a' } });
    } else {
        selectedParentNodes.add(nodeId);
        nodes.update({ id: nodeId, color: { border: '#f59e0b', background: '#78350f' } });
    }
    updateSelectionStatus();
}

// 添加节点到选中集合（不切换，只添加）
function addNodeToSelection(nodeId) {
    if (!selectedParentNodes.has(nodeId)) {
        selectedParentNodes.add(nodeId);
        nodes.update({ id: nodeId, color: { border: '#f59e0b', background: '#78350f' } });
        updateSelectionStatus();
    }
}

// 更新选择状态显示
function updateSelectionStatus() {
    const count = selectedParentNodes.size;
    if (count > 0) {
        // 在页面上显示选择状态
        let statusDiv = document.getElementById('selection-status');
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'selection-status';
            statusDiv.className = 'fixed bottom-4 left-4 bg-gray-900/90 border border-gray-700 rounded-lg p-3 z-50';
            document.body.appendChild(statusDiv);
        }
        const nodeList = Array.from(selectedParentNodes).join(', ');
        statusDiv.innerHTML = `
            <div class="text-xs text-gray-300 mb-1">已选择 ${count} 个父节点:</div>
            <div class="text-xs text-blue-300 font-mono mb-2 max-w-xs truncate">${nodeList}</div>
            <div class="flex space-x-2">
                <button onclick="createChildFromSelectedParents()" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-xs rounded">创建子节点</button>
                <button onclick="clearSelection()" class="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-xs rounded">清除选择</button>
            </div>
        `;
    } else {
        const statusDiv = document.getElementById('selection-status');
        if (statusDiv) statusDiv.remove();
    }
}

// 清除选择
function clearSelection() {
    // 恢复所有选中节点的颜色
    selectedParentNodes.forEach(nodeId => {
        nodes.update({ id: nodeId, color: { border: '#1d4ed8', background: '#0f172a' } });
    });
    selectedParentNodes.clear();
    updateSelectionStatus();
}

// 基于选中的父节点创建子节点（打开模态框表单）
function createChildFromSelectedParents() {
    if (selectedParentNodes.size === 0) return;
    
    const parentIds = Array.from(selectedParentNodes);
    const parentIdStr = parentIds.join(', ');
    
    // 创建子节点模态框
    const modalHtml = `
        <div id="child-modal" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 w-96">
                <h3 class="text-lg font-bold text-blue-400 mb-4">创建子节点（基于: ${parentIdStr}）</h3>
                
                <div class="space-y-4">
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">卜辞</label>
                        <input id="child-node-id" type="text" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">动作标签 <span class="text-red-500">*</span></label>
                        <select id="child-action-tag" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500" onchange="updateBlockTagOptions()">
                            <option value="">请选择动作标签</option>
                            <option value="又贞">又贞 (继续)</option>
                            <option value="对贞">对贞 (对比)</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">因缘标签 <span class="text-red-500">*</span></label>
                        <select id="child-block-tag" class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                            <option value="">请先选择动作标签</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">事件叙述</label>
                        <textarea id="child-event-tuple" class="w-full h-24 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 resize-none"></textarea>
                    </div>
                    
                    <div>
                        <label class="text-xs text-gray-400 block mb-1">图片上传</label>
                        <input id="child-image-file" type="file" accept="image/*" class="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700">
                        <div id="child-image-preview" class="mt-2 hidden">
                            <img id="child-preview-img" class="max-h-32 rounded border border-gray-700">
                        </div>
                    </div>
                </div>
                
                <div class="flex justify-end space-x-3 mt-6">
                    <button onclick="closeChildModal()" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-sm rounded">取消</button>
                    <button onclick="submitChildNode(['${parentIds.join("','")}'])" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-sm rounded">创建</button>
                </div>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // 添加图片预览功能
    document.getElementById('child-image-file').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('child-image-preview').classList.remove('hidden');
                document.getElementById('child-preview-img').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

// 更新因缘标签选项（根据动作标签）
function updateBlockTagOptions() {
    const actionTag = document.getElementById('child-action-tag').value;
    const blockTagSelect = document.getElementById('child-block-tag');
    
    // 清空现有选项
    blockTagSelect.innerHTML = '';
    
    if (actionTag === '又贞') {
        // 又贞：只有"因"和"相"
        blockTagSelect.innerHTML = `
            <option value="">请选择因缘标签</option>
            <option value="因">因 (原因/起因)</option>
            <option value="相">相 (现象/状态)</option>
        `;
    } else if (actionTag === '对贞') {
        // 对贞：自动设置为"果"
        blockTagSelect.innerHTML = `
            <option value="果" selected>果 (结果/成果)</option>
        `;
        blockTagSelect.disabled = true;
    } else {
        blockTagSelect.innerHTML = '<option value="">请先选择动作标签</option>';
        blockTagSelect.disabled = false;
    }
}

// 关闭子节点模态框
function closeChildModal() {
    const modal = document.getElementById('child-modal');
    if (modal) modal.remove();
    clearSelection();
}

// 提交子节点创建
async function submitChildNode(parentIds) {
    const nodeId = document.getElementById('child-node-id').value.trim();
    const actionTag = document.getElementById('child-action-tag').value;
    const blockTag = document.getElementById('child-block-tag').value;
    const eventTuple = document.getElementById('child-event-tuple').value.trim();
    const imageFile = document.getElementById('child-image-file').files[0];
    
    if (!nodeId) {
        alert('卜辞 不能为空！');
        return;
    }
    
    if (!actionTag) {
        alert('动作标签不能为空！');
        return;
    }
    
    if (!blockTag) {
        alert('因缘标签不能为空！');
        return;
    }
    
    if (!eventTuple) {
        alert('事件叙述不能为空！');
        return;
    }
    
    let fullImageUrl = '';
    
    // 如果有图片文件，先上传
    if (imageFile) {
        try {
            const formData = new FormData();
            formData.append('file', imageFile);
            
            const uploadResponse = await fetch('/api/v1/causal/upload', {
                method: 'POST',
                body: formData
            });
            
            const uploadData = await uploadResponse.json();
            if (uploadData.status === 'success') {
                fullImageUrl = uploadData.data.url;
            } else {
                alert('图片上传失败：' + uploadData.message);
                return;
            }
        } catch (error) {
            alert('图片上传失败：' + error.message);
            return;
        }
    }
    
    // 提交创建请求
    postNode({ 
        node_id: nodeId, 
        block_tag: blockTag,
        parent_id: parentIds,
        event_tuple: eventTuple, 
        action_tag: actionTag,
        full_image_url: fullImageUrl,
        owner_id: currentOwnerId
    });
    
    closeChildModal();
}

socket.on('node_created', (node) => {
    // 检查owner_id是否匹配
    const nodeOwnerId = node.owner_id || 'default';
    if (nodeOwnerId === currentOwnerId) {
        renderNode(node);
    } else {
        console.log(`忽略owner_id不匹配的节点创建: ${node.node_id} (owner_id: ${nodeOwnerId}, 当前: ${currentOwnerId})`);
    }
});

socket.on('node_updated', (data) => {
    // 检查节点ID是否发生了变化（从old_node_id到new_node_id）
    // 服务器应该发送包含old_node_id和new_node_id的数据
    const oldNodeId = data.old_node_id;
    const newNodeId = data.node_id;
    
    if (oldNodeId && newNodeId && oldNodeId !== newNodeId) {
        // 节点ID发生了变化
        console.log(`节点ID从 ${oldNodeId} 更新为 ${newNodeId}`);
        
        // 从缓存中移除旧节点
        if (nodeCache[oldNodeId]) {
            // 将数据复制到新节点ID
            nodeCache[newNodeId] = { ...nodeCache[oldNodeId], ...data };
            delete nodeCache[oldNodeId];
            
            // 更新网络图中的节点ID
            const node = nodes.get(oldNodeId);
            if (node) {
                // 移除旧节点
                nodes.remove(oldNodeId);
                
                // 添加新节点（重新渲染以应用新的视觉效果）
                renderNode(nodeCache[newNodeId]);
                
                // 更新所有相关的边
                // 1. 更新从父节点到该节点的边
                const edgesToUpdate = edges.get().filter(edge => edge.to === oldNodeId);
                edgesToUpdate.forEach(edge => {
                    edges.remove(edge.id);
                    edges.update({ id: `${edge.from}-${newNodeId}`, from: edge.from, to: newNodeId, label: edge.label });
                });
                
                // 2. 更新从该节点到子节点的边
                const edgesFromUpdate = edges.get().filter(edge => edge.from === oldNodeId);
                edgesFromUpdate.forEach(edge => {
                    edges.remove(edge.id);
                    edges.update({ id: `${newNodeId}-${edge.to}`, from: newNodeId, to: edge.to, label: edge.label });
                });
            }
            
            // 如果当前选中的是这个节点，更新currentSelectedNode
            if (currentSelectedNode === oldNodeId) {
                currentSelectedNode = newNodeId;
                // 更新抽屉中的节点ID显示
                document.getElementById('d-node-id').value = newNodeId;
            }
        }
    } else {
        // 节点ID没有变化，正常更新
        if (nodeCache[data.node_id]) {
            // 更新事件缓存中的数据
            Object.assign(nodeCache[data.node_id], data);
            
            // 如果当前选中了这个事件，更新UI
            if (currentSelectedNode === data.node_id) {
                if (data.survival_weight !== undefined) {
                    document.getElementById('d-weight-bar').style.width = `${data.survival_weight * 100}%`;
                    document.getElementById('d-weight-value').textContent = data.survival_weight.toFixed(10);
                }
                if (data.event_tuple !== undefined) {
                    document.getElementById('d-event-tuple').value = data.event_tuple || '未知因果';
                }
                if (data.action_tag !== undefined) {
                    document.getElementById('d-action-tag').value = data.action_tag;
                    updateDrawerBlockTagOptions();
                }
                if (data.block_tag !== undefined) {
                    document.getElementById('d-block-tag').value = data.block_tag;
                }
                if (data.full_image_url !== undefined) {
                    document.getElementById('d-full-image-url').value = data.full_image_url || '';
                }
            }
            
            // 权重变化时，重新渲染节点以更新视觉效果（大小、颜色、光芒）
            if (data.survival_weight !== undefined) {
                // 重新渲染节点，应用新的权重视觉效果
                renderNode(nodeCache[data.node_id]);
                
                console.log(`节点 ${data.node_id} 权重更新为 ${data.survival_weight}，重新渲染视觉效果`);
            }
            
            // 动作标签变化时也重新渲染
            if (data.action_tag !== undefined) {
                renderNode(nodeCache[data.node_id]);
            }
            
            // 其他字段变化但权重不变时，也重新渲染以确保一致性
            if (!data.survival_weight && (data.event_tuple !== undefined || data.full_image_url !== undefined)) {
                renderNode(nodeCache[data.node_id]);
            }
        }
    }
});

socket.on('node_deleted', (data) => {
    const nodeId = data.node_id;
    
    // 从缓存中移除
    delete nodeCache[nodeId];
    
    // 从网络图中移除事件
    nodes.remove(nodeId);
    
    // 移除与该事件相关的边
    const edgesToRemove = edges.get().filter(edge => 
        edge.from === nodeId || edge.to === nodeId
    );
    edgesToRemove.forEach(edge => edges.remove(edge.id));
    
    // 如果当前选中的事件被删除，关闭抽屉
    if (currentSelectedNode === nodeId) {
        closeDrawer();
    }
    
    console.log(`[司南] 事件 "${nodeId}" 已从图中移除。`);
});

// 打开图片全息大图模态框
function openImageModal(imageSrc) {
    // 创建全息大图模态框
    const modalHtml = `
        <div id="image-modal" class="fixed inset-0 bg-black/90 flex items-center justify-center z-[100]">
            <div class="relative max-w-4xl max-h-[90vh]">
                <button onclick="closeImageModal()" class="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl z-10">✕</button>
                <img src="${imageSrc}" class="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl">
                <div class="absolute bottom-4 left-0 right-0 text-center text-gray-300 text-sm">
                    点击图片外区域关闭
                </div>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // 点击模态框背景关闭
    document.getElementById('image-modal').addEventListener('click', function(e) {
        if (e.target.id === 'image-modal') {
            closeImageModal();
        }
    });
    
    // ESC键关闭
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeImageModal();
        }
    });
}

// 关闭图片模态框
function closeImageModal() {
    const modal = document.getElementById('image-modal');
    if (modal) modal.remove();
}

// 父ID字段焦点事件处理
function setupParentIdFieldEvents() {
    const parentIdField = document.getElementById('d-parent-ids');
    const eventTupleField = document.getElementById('d-event-tuple');
    
    if (parentIdField) {
        parentIdField.addEventListener('click', function(e) {
            // 点击父ID文本框时，自动清空它的值
            const originalValue = this.value;
            console.log('父ID文本框点击，原始值:', originalValue);
            
            // 清空文本框
            this.value = '';
            console.log('父ID文本框已清空');
            
            // 设置 is_change = false
            is_change = false;
            console.log('父ID文本框被点击并清空，设置 is_change = false');
            
            // 进入父ID选择模式
            activeParentIdField = this;
            parentIdSelectionMode = true;
            document.getElementById('parent-id-hint').classList.remove('hidden');
            
            // 显示提示信息
            showSelectionHint('请点击事件节点获取父ID');
        });
        
        parentIdField.addEventListener('focus', function() {
            // 焦点事件不自动清空，由点击事件处理
            console.log('父ID文本框获得焦点');
        });
        
        // 父ID文本框失去焦点时，不清除 is_change = false，保持直到保存提交
        parentIdField.addEventListener('blur', function() {
            // 延迟检查，避免立即清除
            setTimeout(() => {
                // 不清除 is_change，保持 false 直到保存提交
                
                // 清除选择模式
                if (activeParentIdField === this) {
                    activeParentIdField = null;
                    parentIdSelectionMode = false;
                    document.getElementById('parent-id-hint').classList.add('hidden');
                }
            }, 100);
        });
    }
    
    // 事件叙述字段获得焦点时，不再自动设置 is_change = false
    // 只有父ID文本框被清空时才设置 is_change = false
    
    // ESC键取消选择模式
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && parentIdSelectionMode) {
            activeParentIdField = null;
            parentIdSelectionMode = false;
            document.getElementById('parent-id-hint').classList.add('hidden');
            hideSelectionHint();
        }
    });
    
    // 点击其他输入框时清除选择模式
    document.addEventListener('click', function(e) {
        if (parentIdSelectionMode && e.target.tagName === 'INPUT' && e.target.id !== 'd-parent-ids') {
            activeParentIdField = null;
            parentIdSelectionMode = false;
            document.getElementById('parent-id-hint').classList.add('hidden');
        }
    });
}

// 显示选择提示
function showSelectionHint(message) {
    let hintDiv = document.getElementById('selection-hint');
    if (!hintDiv) {
        hintDiv = document.createElement('div');
        hintDiv.id = 'selection-hint';
        hintDiv.className = 'fixed top-16 left-1/2 transform -translate-x-1/2 bg-blue-900/90 border border-blue-700 rounded-lg p-3 z-50 max-w-md';
        document.body.appendChild(hintDiv);
    }
    hintDiv.innerHTML = `
        <div class="text-xs text-blue-200 flex items-center">
            <span class="mr-2">💡</span>
            <span>${message}</span>
        </div>
    `;
    setTimeout(() => {
        hintDiv.classList.add('opacity-0', 'transition-opacity', 'duration-500');
        setTimeout(() => {
            if (hintDiv.parentNode) {
                hintDiv.parentNode.removeChild(hintDiv);
            }
        }, 500);
    }, 5000);
}

// 隐藏选择提示
function hideSelectionHint() {
    const hintDiv = document.getElementById('selection-hint');
    if (hintDiv) {
        hintDiv.parentNode.removeChild(hintDiv);
    }
}

// 向父ID字段添加节点ID
function addNodeIdToParentField(nodeId) {
    // 获取父ID输入框
    const parentIdField = document.getElementById('d-parent-ids');
    if (!parentIdField) return;
    
    const currentValue = parentIdField.value.trim();
    let parentIds = [];
    
    // 解析现有的父ID
    if (currentValue) {
        parentIds = currentValue.split('|').map(id => id.trim()).filter(id => id);
    }
    
    // 检查是否已存在
    if (parentIds.includes(nodeId)) {
        showSelectionHint(`节点ID "${nodeId}" 已存在于父ID列表中。`);
        return;
    }
    
    // 添加新ID
    parentIds.push(nodeId);
    parentIdField.value = parentIds.join(' | ');
    
    // 显示成功提示
    showSelectionHint(`节点ID "${nodeId}" 已添加到父ID字段。当前共 ${parentIds.length} 个父节点。`);
}

// 修改节点点击逻辑以支持父ID填充
function handleNodeClickForParentId(nodeId) {
    if (parentIdSelectionMode && activeParentIdField) {
        addNodeIdToParentField(nodeId);
        return true; // 表示已处理父ID填充
    }
    return false; // 未处理，继续原有逻辑
}

// 从地宫恢复内容并直接更新抽屉
async function restoreFromNecropolis(nodeId) {
    try {
        console.log(`[前端地宫恢复] 开始尝试从地宫恢复节点 ${nodeId} 的内容`);
        console.log(`[前端地宫恢复] 当前nodeCache中节点数据:`, nodeCache[nodeId]);
        
        const response = await fetch('/api/v1/causal/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId })
        });
        
        console.log(`[前端地宫恢复] API响应状态: ${response.status}`);
        const data = await response.json();
        console.log(`[前端地宫恢复] API响应数据:`, data);
        
        if (data.status === 'success') {
            console.log(`[前端地宫恢复] 节点 ${nodeId} 已从地宫恢复成功`);
            console.log(`[前端地宫恢复] 恢复的数据详情:`, {
                event_tuple_length: data.data?.event_tuple?.length || 0,
                full_image_url: data.data?.full_image_url || '无',
                from_necropolis: data.data?.from_necropolis || false,
                necropolis_info: data.necropolis_info
            });
            
            // 直接使用API返回的数据更新nodeCache
            if (data.data) {
                // 保存当前nodeCache中的数据（用于比较）
                const oldCacheData = nodeCache[nodeId] ? { ...nodeCache[nodeId] } : null;
                
                // 更新nodeCache中的节点数据
                nodeCache[nodeId] = { ...nodeCache[nodeId], ...data.data };
                
                // 添加地宫恢复标记
                nodeCache[nodeId].from_necropolis = true;
                nodeCache[nodeId].necropolis_restored_at = data.necropolis_info?.restored_at;
                
                console.log(`[前端地宫恢复] 节点 ${nodeId} 的nodeCache已更新`);
                console.log(`[前端地宫恢复] 更新前event_tuple长度: ${oldCacheData?.event_tuple?.length || 0}`);
                console.log(`[前端地宫恢复] 更新后event_tuple长度: ${nodeCache[nodeId].event_tuple?.length || 0}`);
                console.log(`[前端地宫恢复] 更新前full_image_url: ${oldCacheData?.full_image_url || '无'}`);
                console.log(`[前端地宫恢复] 更新后full_image_url: ${nodeCache[nodeId].full_image_url || '无'}`);
            }
            
            // 显示成功提示
            showSelectionHint(`节点 "${nodeId}" 已从地宫恢复完整全息信息`);
            return { restored: true, data: data.data };
        } else {
            console.log(`[前端地宫恢复] 节点 ${nodeId} 没有地宫记录: ${data.message}`);
            // 显示信息提示（不是错误）
            showSelectionHint(`节点 "${nodeId}" 没有地宫记录，显示当前内容`);
            return { restored: false, message: data.message };
        }
    } catch (error) {
        console.error(`[前端地宫恢复] 地宫恢复失败:`, error);
        // 显示错误提示
        showSelectionHint(`地宫恢复失败: ${error.message}`);
        return { restored: false, error: error.message };
    }
}

// 提升全局权重
async function promoteChainWeights(nodeId) {
    try {
        console.log(`尝试提升节点 ${nodeId} 到所有节点总权重的60%`);
        
        const response = await fetch('/api/v1/causal/promote_chain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: nodeId })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log(`全局权重提升成功: ${data.message}`);
            // 显示成功提示
            showSelectionHint(`节点权重已提升到所有节点总权重的60%，更新了 ${data.data.updated_count} 个节点。等待Socket.IO广播具体权重...`);
            
            // 重要：前端不应该自己计算权重，应该等待Socket.IO广播正确的权重数据
            // 后端会通过Socket.IO广播每个节点的正确权重（大股东60%，所有其他节点按比例分配40%）
            console.log(`等待Socket.IO广播 ${data.data.updated_count} 个节点的更新事件`);
            
            return true;
        } else {
            console.log(`全局权重提升失败: ${data.message}`);
            // 显示信息提示（不是错误）
            showSelectionHint(`全局权重提升失败: ${data.message}`);
            return false;
        }
    } catch (error) {
        console.error(`全局权重提升失败:`, error);
        // 显示错误提示
        showSelectionHint(`全局权重提升失败: ${error.message}`);
        return false;
    }
}

// 使用地宫恢复的数据直接更新抽屉
function updateDrawerWithNecropolisData(nodeId, necropolisData) {
    currentSelectedNode = nodeId;
    
    console.log('使用地宫恢复的数据更新抽屉，节点数据:', necropolisData);
    
    // 填充表单字段
    document.getElementById('d-node-id').value = nodeId;
    document.getElementById('d-event-tuple').value = necropolisData.event_tuple || '';
    document.getElementById('d-full-image-url').value = necropolisData.full_image_url || '';
    
    // 填充动作标签和因缘标签
    // 动作标签 - 如果不存在或为空字符串，使用默认值'贞'
    const actionTag = (necropolisData.action_tag && necropolisData.action_tag.trim()) ? necropolisData.action_tag : '贞';
    document.getElementById('d-action-tag').value = actionTag;
    
    // 因缘标签 - 如果不存在或为空字符串，使用默认值'因'
    const blockTag = (necropolisData.block_tag && necropolisData.block_tag.trim()) ? necropolisData.block_tag : '因';
    
    // 先更新因缘标签选项（根据动作标签）
    updateDrawerBlockTagOptions();
    
    // 然后设置因缘标签的值（在更新选项之后）
    document.getElementById('d-block-tag').value = blockTag;
    
    // 填充父ID字段
    let parentIds = [];
    if (necropolisData.parent_ids && necropolisData.parent_ids.length > 0) {
        parentIds = necropolisData.parent_ids;
    } else if (necropolisData.parent_id) {
        parentIds = [necropolisData.parent_id];
    }
    document.getElementById('d-parent-ids').value = parentIds.join(' | ');
    
    // 填充权重
    // 修复权重处理：确保权重为0时正确显示为0%
    const rawWeight = necropolisData.survival_weight;
    const weight = (rawWeight === null || rawWeight === undefined) ? 0.0 : parseFloat(rawWeight);
    document.getElementById('d-weight-bar').style.width = `${weight * 100}%`;
    document.getElementById('d-weight-value').textContent = weight.toFixed(10);
    
    // 显示事件图片（如果存在）
    const imagePreview = document.getElementById('d-image-preview');
    const previewImg = document.getElementById('d-preview-img');
    if (necropolisData.full_image_url) {
        // 显示现有图片
        previewImg.src = necropolisData.full_image_url;
        imagePreview.classList.remove('hidden');
    } else {
        // 隐藏图片预览
        imagePreview.classList.add('hidden');
        previewImg.src = '';
    }
    
    document.getElementById('drawer').classList.remove('drawer-hidden');
    
    // 抽屉打开时，调整网格图位置，避免被抽屉遮挡
    const networkContainer = document.getElementById('network');
    if (networkContainer) {
        networkContainer.style.right = '384px'; // 抽屉宽度 w-96 = 384px
        networkContainer.style.transition = 'right 0.3s ease';
        console.log('抽屉打开，网格图 right = 384px（抽屉宽度）');
    }
    
    // 抽屉打开时，重新调整网络图使其适应新的可用空间
    setTimeout(() => {
        network.fit();
        console.log('抽屉打开，重新调整网络图');
        
        // 默认让d-event-tuple获得焦点
        const eventTupleField = document.getElementById('d-event-tuple');
        if (eventTupleField) {
            eventTupleField.focus();
            console.log('抽屉打开，d-event-tuple获得焦点');
        }
    }, 100);
}

// 使用最新数据打开抽屉（确保显示从地宫恢复的全息信息）
function openDrawerWithLatestData(nodeId) {
    currentSelectedNode = nodeId;
    const data = nodeCache[nodeId];
    
    if (!data) {
        console.warn(`节点 ${nodeId} 的数据不在缓存中，使用普通方式打开抽屉`);
        openDrawer(nodeId);
        return;
    }
    
    console.log('使用最新数据打开抽屉，节点数据:', data);
    
    // 填充表单字段
    document.getElementById('d-node-id').value = nodeId;
    document.getElementById('d-event-tuple').value = data.event_tuple || '';
    document.getElementById('d-full-image-url').value = data.full_image_url || '';
    
    // 填充动作标签和因缘标签
    // 动作标签 - 如果不存在或为空字符串，使用默认值'贞'
    const actionTag = (data.action_tag && data.action_tag.trim()) ? data.action_tag : '贞';
    document.getElementById('d-action-tag').value = actionTag;
    
    // 因缘标签 - 如果不存在或为空字符串，使用默认值'因'
    const blockTag = (data.block_tag && data.block_tag.trim()) ? data.block_tag : '因';
    
    // 先更新因缘标签选项（根据动作标签）
    updateDrawerBlockTagOptions();
    
    // 然后设置因缘标签的值（在更新选项之后）
    document.getElementById('d-block-tag').value = blockTag;
    
    // 填充父ID字段
    let parentIds = [];
    if (data.parent_ids && data.parent_ids.length > 0) {
        parentIds = data.parent_ids;
    } else if (data.parent_id) {
        parentIds = [data.parent_id];
    }
    document.getElementById('d-parent-ids').value = parentIds.join(' | ');
    
    // 填充权重
    // 修复权重处理：确保权重为0时正确显示为0%
    const rawWeight = data.survival_weight;
    const weight = (rawWeight === null || rawWeight === undefined) ? 0.0 : parseFloat(rawWeight);
    document.getElementById('d-weight-bar').style.width = `${weight * 100}%`;
    document.getElementById('d-weight-value').textContent = weight.toFixed(10);
    
    // 显示事件图片（如果存在）
    const imagePreview = document.getElementById('d-image-preview');
    const previewImg = document.getElementById('d-preview-img');
    if (data.full_image_url) {
        // 显示现有图片
        previewImg.src = data.full_image_url;
        imagePreview.classList.remove('hidden');
    } else {
        // 隐藏图片预览
        imagePreview.classList.add('hidden');
        previewImg.src = '';
    }
    
    document.getElementById('drawer').classList.remove('drawer-hidden');
    
    // 抽屉打开时，调整网格图位置，避免被抽屉遮挡
    const networkContainer = document.getElementById('network');
    if (networkContainer) {
        networkContainer.style.right = '384px'; // 抽屉宽度 w-96 = 384px
        networkContainer.style.transition = 'right 0.3s ease';
        console.log('抽屉打开，网格图 right = 384px（抽屉宽度）');
    }
    
    // 抽屉打开时，重新调整网络图使其适应新的可用空间
    setTimeout(() => {
        network.fit();
        console.log('抽屉打开，重新调整网络图');
        
        // 默认让d-event-tuple获得焦点
        const eventTupleField = document.getElementById('d-event-tuple');
        if (eventTupleField) {
            eventTupleField.focus();
            console.log('抽屉打开，d-event-tuple获得焦点');
        }
    }, 100);
}

// --- 从URL参数获取用户ID和拥有者ID ---
let currentActorId = ''; // 当前用户ID，空字符串表示全局视图
let currentOwnerId = 'default'; // 当前拥有者ID，默认值为'default'

// 从URL参数获取actor_id
function getActorIdFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const actorId = urlParams.get('actor_id');
    return actorId || '';
}

// 从URL参数获取owner_id
function getOwnerIdFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const ownerId = urlParams.get('owner_id');
    return ownerId || 'default';
}

// 初始化用户ID和拥有者ID
currentActorId = getActorIdFromURL();
currentOwnerId = getOwnerIdFromURL();

if (currentActorId || currentOwnerId !== 'default') {
    console.log(`[用户初始化] 从URL参数获取到: actor_id=${currentActorId}, owner_id=${currentOwnerId}`);
} else {
    console.log(`[用户初始化] 未指定用户ID和拥有者ID，使用默认视图`);
}

// 修改初始化函数以支持用户参数和拥有者参数
async function initCausalGraph() {
    console.log("[司南] 启动感应...");
    try {
        // 构建查询参数
        const params = new URLSearchParams();
        if (currentActorId) {
            params.append('actor_id', currentActorId);
        }
        if (currentOwnerId && currentOwnerId !== 'default') {
            params.append('owner_id', currentOwnerId);
        }
        
        const url = `/api/v1/causal/history${params.toString() ? '?' + params.toString() : ''}`;
        console.log(`[数据加载] 请求URL: ${url}`);
        
        const response = await fetch(url);
        const res = await response.json();
        console.log('API响应:', res);
        if (res.status === 'success') {
            console.log(`[数据加载] 成功加载 ${res.data.length} 个节点，owner_id: ${currentOwnerId}`);
            
            // 检查第一个节点的字段
            if (res.data.length > 0) {
                const firstNode = res.data[0];
                console.log('第一个节点数据:', firstNode);
                console.log('第一个节点动作标签:', firstNode.action_tag, '类型:', typeof firstNode.action_tag);
                console.log('第一个节点因缘标签:', firstNode.block_tag, '类型:', typeof firstNode.block_tag);
            }
            res.data.forEach(node => renderNode(node));
            network.fit(); // 渲染完成后自动缩放全景
            console.log("[司南] 龙脉还原完毕。");
        }
    } catch (err) {
        console.error("[司南故障] 无法感知历史记录。");
    }
}

// 修改权重提升函数以支持用户参数和owner_id参数
async function promoteChainWeights(nodeId) {
    try {
        console.log(`尝试提升节点 ${nodeId} 到所有节点总权重的60%`);
        
        const requestData = { node_id: nodeId };
        if (currentActorId) {
            requestData.actor_id = currentActorId;
        }
        if (currentOwnerId && currentOwnerId !== 'default') {
            requestData.owner_id = currentOwnerId;
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
            console.log(`全局权重提升成功: ${data.message}`);
            // 显示成功提示
            showSelectionHint(`节点权重已提升到所有节点总权重的60%，更新了 ${data.data.updated_count} 个节点。等待Socket.IO广播具体权重...`);
            
            // 重要：前端不应该自己计算权重，应该等待Socket.IO广播正确的权重数据
            // 后端会通过Socket.IO广播每个节点的正确权重（大股东60%，所有其他节点按比例分配40%）
            console.log(`等待Socket.IO广播 ${data.data.updated_count} 个节点的更新事件`);
            
            return true;
        } else {
            console.log(`全局权重提升失败: ${data.message}`);
            // 显示信息提示（不是错误）
            showSelectionHint(`全局权重提升失败: ${data.message}`);
            return false;
        }
    } catch (error) {
        console.error(`全局权重提升失败:`, error);
        // 显示错误提示
        showSelectionHint(`全局权重提升失败: ${error.message}`);
        return false;
    }
}

// 修改Socket.IO事件处理以支持用户权重
socket.on('node_updated', (data) => {
    // 检查节点ID是否发生了变化（从old_node_id到new_node_id）
    // 服务器应该发送包含old_node_id和new_node_id的数据
    const oldNodeId = data.old_node_id;
    const newNodeId = data.node_id;
    
    // 检查是否包含actor_id，如果包含且与当前用户不匹配，则忽略
    if (data.actor_id && data.actor_id !== currentActorId) {
        console.log(`忽略用户 ${data.actor_id} 的节点更新，当前用户: ${currentActorId}`);
        return;
    }
    
    if (oldNodeId && newNodeId && oldNodeId !== newNodeId) {
        // 节点ID发生了变化
        console.log(`节点ID从 ${oldNodeId} 更新为 ${newNodeId}`);
        
        // 从缓存中移除旧节点
        if (nodeCache[oldNodeId]) {
            // 将数据复制到新节点ID
            nodeCache[newNodeId] = { ...nodeCache[oldNodeId], ...data };
            delete nodeCache[oldNodeId];
            
            // 更新网络图中的节点ID
            const node = nodes.get(oldNodeId);
            if (node) {
                // 移除旧节点
                nodes.remove(oldNodeId);
                
                // 添加新节点（重新渲染以应用新的视觉效果）
                renderNode(nodeCache[newNodeId]);
                
                // 更新所有相关的边
                // 1. 更新从父节点到该节点的边
                const edgesToUpdate = edges.get().filter(edge => edge.to === oldNodeId);
                edgesToUpdate.forEach(edge => {
                    edges.remove(edge.id);
                    edges.update({ id: `${edge.from}-${newNodeId}`, from: edge.from, to: newNodeId, label: edge.label });
                });
                
                // 2. 更新从该节点到子节点的边
                const edgesFromUpdate = edges.get().filter(edge => edge.from === oldNodeId);
                edgesFromUpdate.forEach(edge => {
                    edges.remove(edge.id);
                    edges.update({ id: `${newNodeId}-${edge.to}`, from: newNodeId, to: edge.to, label: edge.label });
                });
            }
            
            // 如果当前选中的是这个节点，更新currentSelectedNode
            if (currentSelectedNode === oldNodeId) {
                currentSelectedNode = newNodeId;
                // 更新抽屉中的节点ID显示
                document.getElementById('d-node-id').value = newNodeId;
            }
        }
    } else {
        // 节点ID没有变化，正常更新
        if (nodeCache[data.node_id]) {
            // 更新事件缓存中的数据
            Object.assign(nodeCache[data.node_id], data);
            
            // 如果当前选中了这个事件，更新UI
            if (currentSelectedNode === data.node_id) {
                if (data.survival_weight !== undefined) {
                    document.getElementById('d-weight-bar').style.width = `${data.survival_weight * 100}%`;
                    document.getElementById('d-weight-value').textContent = data.survival_weight.toFixed(10);
                }
                if (data.event_tuple !== undefined) {
                    document.getElementById('d-event-tuple').value = data.event_tuple || '未知因果';
                }
                if (data.action_tag !== undefined) {
                    document.getElementById('d-action-tag').value = data.action_tag;
                    updateDrawerBlockTagOptions();
                }
                if (data.block_tag !== undefined) {
                    document.getElementById('d-block-tag').value = data.block_tag;
                }
                if (data.full_image_url !== undefined) {
                    document.getElementById('d-full-image-url').value = data.full_image_url || '';
                }
            }
            
            // 权重变化时，重新渲染节点以更新视觉效果（大小、颜色、光芒）
            if (data.survival_weight !== undefined) {
                // 重新渲染节点，应用新的权重视觉效果
                renderNode(nodeCache[data.node_id]);
                
                console.log(`节点 ${data.node_id} 权重更新为 ${data.survival_weight}，重新渲染视觉效果`);
            }
            
            // 动作标签变化时也重新渲染
            if (data.action_tag !== undefined) {
                renderNode(nodeCache[data.node_id]);
            }
            
            // 其他字段变化但权重不变时，也重新渲染以确保一致性
            if (!data.survival_weight && (data.event_tuple !== undefined || data.full_image_url !== undefined)) {
                renderNode(nodeCache[data.node_id]);
            }
        }
    }
});

// 页面启动点亮
window.onload = function() {
    initCausalGraph();
    setupParentIdFieldEvents();
    
    // 初始化搜索面板交互功能
    initSearchPanel();
    
    // 初始化Markdown编辑器逻辑
    initEventTupleEditor();
};

// 搜索功能实现
function initSearchPanel() {
    const searchToggleBtn = document.getElementById('btn-toggle-search');
    const searchCloseBtn = document.getElementById('btn-close-search');
    const searchFormContainer = document.getElementById('search-form-container');
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('btn-search');
    
    if (searchToggleBtn && searchFormContainer) {
        // 点击放大镜图标展开搜索面板
        searchToggleBtn.onclick = function() {
            searchFormContainer.classList.add('expanded');
            // 展开后聚焦到搜索输入框
            setTimeout(() => {
                if (searchInput) searchInput.focus();
            }, 100);
        };
        
        // 点击关闭按钮折叠搜索面板
        if (searchCloseBtn) {
            searchCloseBtn.onclick = function() {
                searchFormContainer.classList.remove('expanded');
            };
        }
        
        // 点击搜索按钮执行搜索
        if (searchBtn) {
            searchBtn.onclick = function() {
                performSearch();
            };
        }
        
        // 按Enter键执行搜索
        if (searchInput) {
            searchInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    performSearch();
                }
            });
        }
        
        // 点击页面其他地方关闭搜索面板
        document.addEventListener('click', function(e) {
            if (searchFormContainer.classList.contains('expanded')) {
                // 检查点击是否在搜索面板内部
                const isClickInsideSearchPanel = searchToggleBtn.contains(e.target) || 
                                                searchFormContainer.contains(e.target);
                
                // 如果点击在搜索面板外部，关闭搜索面板
                if (!isClickInsideSearchPanel) {
                    searchFormContainer.classList.remove('expanded');
                }
            }
        });
    }
}

// 执行搜索
async function performSearch() {
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.trim() : '';
    const searchType = document.getElementById('search-type') ? document.getElementById('search-type').value : 'keyword';
    
    if (!searchTerm) {
        showSelectionHint('请输入搜索关键词');
        return;
    }
    
    console.log(`[搜索] 执行搜索: 类型=${searchType}, 关键词=${searchTerm}`);
    showSelectionHint(`正在搜索: ${searchTerm}`);
    
    try {
        // 根据搜索类型调用不同的API
        let apiUrl, requestData;
        
        if (searchType === 'serial') {
            // 序列ID搜索
            apiUrl = '/api/v1/causal/search/serial';
            requestData = { serial_id: parseInt(searchTerm) || 0 };
        } else {
            // 关键字搜索
            apiUrl = '/api/v1/causal/search/keyword';
            requestData = { 
                keyword: searchTerm,
                owner_id: currentOwnerId || 'default',
                limit: 20
            };
        }
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            displaySearchResults(data.data, searchType);
        } else {
            showSelectionHint(`搜索失败: ${data.message}`);
            displaySearchResults([]);
        }
    } catch (error) {
        console.error('[搜索] 搜索请求失败:', error);
        showSelectionHint(`搜索失败: ${error.message}`);
        displaySearchResults([]);
    }
}

// 显示搜索结果
function displaySearchResults(results, searchType = 'keyword') {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;
    
    // 显示结果区域
    resultsContainer.style.display = 'block';
    
    if (!results || (Array.isArray(results) && results.length === 0)) {
        resultsContainer.innerHTML = `
            <div class="search-empty">
                <div class="empty-icon">🔍</div>
                <div class="empty-text">未找到相关事件</div>
            </div>
        `;
        return;
    }
    
    // 如果是单个结果（序列ID搜索），转换为数组
    const resultList = Array.isArray(results) ? results : [results];
    
    // 构建结果HTML
    let resultsHtml = '<div class="search-results-list">';
    
    resultList.forEach((result, index) => {
        const serialId = result.serial_id || result.本事件ID;
        const nodeId = result.node_id || result.本事件标题;
        const eventTuple = result.event_tuple || result.事件二元组描述 || '';
        const relevanceScore = result.relevance_score || result.本事件相关度 || 0;
        const survivalWeight = result.survival_weight || result.本事件权重 || 0;
        const actionTag = result.action_tag || result.动作标签 || '贞';
        const blockTag = result.block_tag || result.因缘标签 || '因';
        
        // 截取事件叙述的前100个字符
        const previewText = eventTuple.length > 100 ? 
            eventTuple.substring(0, 100) + '...' : eventTuple;
        
        // 计算相关度百分比
        const relevancePercent = Math.min(Math.round(relevanceScore * 100), 100);
        
        // 计算权重百分比
        const weightPercent = Math.min(Math.round(survivalWeight * 100), 100);
        
        resultsHtml += `
            <div class="search-result-item" data-serial-id="${serialId}" data-node-id="${nodeId}">
                <div class="result-header">
                    <div class="result-title">
                        <span class="result-tag ${actionTag}">${actionTag}</span>
                        <span class="result-node-id">${nodeId}</span>
                        <span class="result-serial-id">#${serialId}</span>
                    </div>
                    <div class="result-meta">
                        <span class="result-relevance">
                            <span class="relevance-label">相关度:</span>
                            <span class="relevance-value">${relevancePercent}%</span>
                        </span>
                        <span class="result-weight">
                            <span class="weight-label">权重:</span>
                            <span class="weight-value">${weightPercent}%</span>
                        </span>
                    </div>
                </div>
                <div class="result-content">
                    <div class="result-event-tuple">${previewText}</div>
                    <div class="result-tags">
                        <span class="tag-block">${blockTag}</span>
                    </div>
                </div>
                <div class="result-actions">
                    <button class="result-action-btn" onclick="handleSearchResultClick(${serialId}, '${nodeId}')">
                        瞄定此事件
                    </button>
                </div>
            </div>
        `;
    });
    
    resultsHtml += '</div>';
    resultsContainer.innerHTML = resultsHtml;
    
    // 显示结果数量
    const resultCount = resultList.length;
    showSelectionHint(`找到 ${resultCount} 个相关事件`);
}

// 处理搜索结果点击事件 - 定义为全局函数
window.handleSearchResultClick = async function(serialId, nodeId) {
    console.log(`[搜索点击] 点击搜索结果: serial_id=${serialId}, node_id=${nodeId}`);
    
    try {
        // 调用点击事件API
        const requestData = { 
            serial_id: serialId,
            actor_id: currentActorId || '',
            owner_id: currentOwnerId || 'default'
        };
        
        console.log(`[搜索点击] 调用点击API:`, requestData);
        
        const response = await fetch('/api/v1/causal/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            showSelectionHint(`已瞄定事件 "${nodeId}"，权重提升到60%`);
            
            // 在网络图中高亮显示该节点
            highlightSearchResultNode(nodeId);
            
            // 关闭搜索结果面板
            const searchFormContainer = document.getElementById('search-form-container');
            if (searchFormContainer) {
                searchFormContainer.classList.remove('expanded');
            }
            
            // 清空搜索输入框
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = '';
            }
            
            // 隐藏搜索结果
            const resultsContainer = document.getElementById('search-results');
            if (resultsContainer) {
                resultsContainer.style.display = 'none';
            }
        } else {
            showSelectionHint(`瞄定失败: ${data.message}`);
        }
    } catch (error) {
        console.error('[搜索点击] 点击事件处理失败:', error);
        showSelectionHint(`瞄定失败: ${error.message}`);
    }
}

// 在网络图中高亮显示搜索结果节点
function highlightSearchResultNode(nodeId) {
    if (!network) return;
    
    // 获取节点数据
    const node = nodes.get(nodeId);
    if (node) {
        // 选中该节点
        network.selectNodes([nodeId]);
        
        // 聚焦到该节点
        network.focus(nodeId, {
            scale: 1.5,
            animation: {
                duration: 1200,
                easingFunction: 'easeInOutQuad'
            }
        });
        
        // 添加高亮效果
        nodes.update({
            id: nodeId,
            color: {
                border: '#f59e0b',
                background: '#78350f',
                highlight: {
                    border: '#f59e0b',
                    background: '#92400e'
                }
            },
            borderWidth: 4,
            shadow: true,
            shadowColor: 'rgba(245, 158, 11, 0.5)',
            shadowSize: 15
        });
        
        console.log(`[搜索高亮] 已高亮显示节点: ${nodeId}`);
    } else {
        console.warn(`[搜索高亮] 未在图中找到节点: ${nodeId}`);
    }
}

// ===== 事件叙述编辑器功能 =====
// 全局存储编辑器实例
let easyMDE = null;

function initEventTupleEditor() {
    const expandBtn = document.getElementById('expand-event-tuple-btn');
    const closeBtn = document.getElementById('close-event-tuple-modal-btn');
    const copyBtn = document.getElementById('copy-event-tuple-btn');
    const modal = document.getElementById('event-tuple-modal');
    const sourceTextarea = document.getElementById('d-event-tuple');

    // 1. 打开模态框并同步内容
    expandBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        
        // 延迟初始化 EasyMDE，确保模态框可见后再渲染，否则会导致尺寸计算错误
        if (!easyMDE) {
            easyMDE = new EasyMDE({
                element: document.getElementById('modal-event-tuple-editor'),
                spellChecker: false, // 禁用拼写检查（针对中文更友好）
                autosave: { enabled: false },
                status: ["lines", "words", "cursor"],
                maxHeight: "50vh",
                // 自定义工具栏
                toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "|", "preview", "side-by-side", "fullscreen", "|", "guide"]
            });
        }
        
        // 将外层 textarea 的内容填入 Markdown 编辑器
        easyMDE.value(sourceTextarea.value);
    });

    // 2. 关闭模态框并回写内容
    closeBtn.addEventListener('click', () => {
        // 将 Markdown 编辑器的内容覆盖回外层的 textarea
        sourceTextarea.value = easyMDE.value();
        
        // 触发 input 事件以确保任何绑定的监听器都能察觉到变化（可选）
        sourceTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        
        modal.classList.add('hidden');
    });

    // 3. 复制内容功能
    copyBtn.addEventListener('click', async () => {
        const textToCopy = easyMDE.value();
        
        // 尝试使用现代剪贴板API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(textToCopy);
                
                // 视觉反馈：图标变成打勾，2秒后恢复
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = '✅';
                setTimeout(() => { 
                    copyBtn.innerHTML = originalHTML; 
                }, 2000);
                return;
            } catch (err) {
                console.warn('现代剪贴板API失败，尝试备用方法:', err);
            }
        }
        
        // 备用方法：使用document.execCommand
        try {
            // 创建临时textarea元素
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            // 执行复制命令
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                // 视觉反馈：图标变成打勾，2秒后恢复
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = '✅';
                setTimeout(() => { 
                    copyBtn.innerHTML = originalHTML; 
                }, 2000);
            } else {
                throw new Error('execCommand复制失败');
            }
        } catch (err) {
            console.error('复制失败:', err);
            // 如果所有方法都失败，提示用户手动复制
            alert('自动复制失败，请手动全选复制编辑器中的内容。');
        }
    });
}
