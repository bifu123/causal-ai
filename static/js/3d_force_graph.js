/**
 * 元龙检索 - 因果星空 (Causal Starry Sky) 核心驱动
 * * 变更记录：
 * 1. 强制全局化辅助函数，消除 updateHighlight 未定义错误。
 * 2. 引入 getThreeInstance 机制，兼容多种 CDN 加载情况。
 * 3. 严格遵循业务规范：以“动作”替代“功能”，保留 ID 原始字段。
 * 4. 优化 13 个真实节点的初始坐标分配，防止 3D 塌缩。
 * 5. 极致清晰度修复：引入超采样 (Super Sampling) 渲染文字。
 * 6. 视觉强化：线性化节点缩放（防止主次差距过大），增强标签显示比例与定位逻辑。
 * 7. 【重磅强化】连线视觉极限化：超宽线径、高饱和度能量流、动态粒子簇。
 */

// --- [全局状态管理] ---
let Graph = null;
const highlightNodes = new Set();
const highlightLinks = new Set();
let hoverNode = null;

// --- [核心辅助函数：必须在 init 之前定义以确保作用域] ---

/**
 * 动态捕获 THREE 实例：优先全局，次选引擎内部引用
 */
function getThreeInstance() {
    if (window.THREE) return window.THREE;
    if (Graph && Graph.scene()) return Graph.scene().__threeObj || null;
    return null;
}

/**
 * 动作颜色映射 (符合 ylbot 标准)
 */
function getNodeColor(node) {
    const tag = node.action_tag || '动作';
    const colorMap = {
        '贞': '#f59e0b',   // 初始动作：琥珀色
        '又贞': '#10b981', // 演化业务：翡翠色
        '对贞': '#3b82f6'  // 耦合业务：宝石蓝
    };
    return colorMap[tag] || '#64748b'; // 默认：石灰色
}

/**
 * 更新高亮状态 (解决 ReferenceError)
 */
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

/**
 * 渲染文字纹理 (用于 ID 标签)
 */
function createTextTexture(text, THREE) {
    if (!THREE || !THREE.CanvasTexture) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const scaleFactor = 4; 
    const baseFontSize = 32; 
    const fontSize = baseFontSize * scaleFactor;
    
    ctx.font = `Bold ${fontSize}px "Fira Code", "Courier New", monospace`;
    
    const paddingX = 20 * scaleFactor;
    const paddingY = 10 * scaleFactor;
    const textWidth = ctx.measureText(text).width;
    
    canvas.width = textWidth + paddingX * 2;
    canvas.height = fontSize + paddingY * 2;
    
    ctx.font = `Bold ${fontSize}px "Fira Code", "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.fillStyle = 'rgba(0, 10, 25, 0.9)'; 
    if (ctx.roundRect) {
        ctx.roundRect(0, 0, canvas.width, canvas.height, 6 * scaleFactor);
    } else {
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 3 * scaleFactor;
    ctx.stroke();
    
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false; 
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace; 
    
    texture.baseWidth = canvas.width / scaleFactor;
    texture.baseHeight = canvas.height / scaleFactor;

    return texture;
}


// --- [数据业务引擎] ---

async function loadInitialData() {
    console.log("从 API 加载真实数据...");
    try {
        // 获取当前用户ID
        const actorId = window.currentActorId || '';
        let url = '/api/v1/causal/history';
        if (actorId) {
            url += `?actor_id=${encodeURIComponent(actorId)}`;
        }
        
        const response = await fetch(url);
        const res = await response.json();
        
        if (res.status === 'success' && Array.isArray(res.data)) {
            const nodes = res.data.map(node => ({
                id: node.node_id,
                ...node,
                x: (Math.random() - 0.5) * 350,
                y: (Math.random() - 0.5) * 350,
                z: (Math.random() - 0.5) * 350
            }));

            const links = [];
            nodes.forEach(node => {
                const parents = node.parent_ids || (node.parent_id ? [node.parent_id] : []);
                parents.forEach(pId => {
                    if (nodes.find(n => n.id === pId)) {
                        links.push({ source: pId, target: node.id });
                    }
                });
            });

            Graph.graphData({ nodes, links });
            
            setTimeout(() => {
                Graph.zoomToFit(1200, 150);
                console.log("因果星空强化版渲染完成");
            }, 600);
        }
    } catch (error) {
        console.error("API 数据抓取失败:", error);
    }
}

/**
 * 加载3D图数据（供3d_form.js调用）
 * 这个函数被3d_form.js中的loadGraphData()调用
 */
function loadGraphData() {
    console.log("loadGraphData被调用，重新加载3D图数据");
    if (Graph) {
        loadInitialData();
    } else {
        console.warn("loadGraphData: Graph未初始化，无法加载数据");
    }
}

/**
 * 从地宫恢复内容（与index.html中的实现一致）
 * @param {Object} node - 要恢复的节点
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
        
        console.log(`[前端地宫恢复] API响应状态: ${response.status}`);
        const data = await response.json();
        console.log(`[前端地宫恢复] API响应数据:`, data);
        
        if (data.status === 'success') {
            console.log(`[前端地宫恢复] 节点 ${node.id} 已从地宫恢复成功`);
            console.log(`[前端地宫恢复] 恢复的数据详情:`, {
                event_tuple_length: data.data?.event_tuple?.length || 0,
                full_image_url: data.data?.full_image_url || '无',
                from_necropolis: data.data?.from_necropolis || false,
                necropolis_info: data.necropolis_info
            });
            
            // 显示成功提示
            showSelectionHint(`节点 "${node.id}" 已从地宫恢复完整全息信息`);
            return { restored: true, data: data.data };
        } else {
            console.log(`[前端地宫恢复] 节点 ${node.id} 没有地宫记录: ${data.message}`);
            // 显示信息提示（不是错误）
            showSelectionHint(`节点 "${node.id}" 没有地宫记录，显示当前内容`);
            return { restored: false, message: data.message };
        }
    } catch (error) {
        console.error(`[前端地宫恢复] 地宫恢复失败:`, error);
        // 显示错误提示
        showSelectionHint(`地宫恢复失败: ${error.message}`);
        return { restored: false, error: error.message };
    }
}

/**
 * 提升节点权重（与index.html中的实现一致）
 * 点击节点后，提升该节点到所有节点总权重的60%
 * @param {Object} node - 要提升权重的节点
 */
async function promoteNodeWeight(node) {
    if (!node || !node.id) {
        console.error('提升权重失败：节点或节点ID为空');
        return;
    }
    
    try {
        console.log(`尝试提升节点 ${node.id} 到所有节点总权重的60%`);
        
        // 获取当前用户ID
        const actorId = window.currentActorId || '';
        const requestData = { node_id: node.id };
        if (actorId) {
            requestData.actor_id = actorId;
        }
        
        const response = await fetch('/api/v1/causal/promote_chain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            selectNode = true;
            selectedNode = node;
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

/**
 * 显示选择提示（与index.html中的实现一致）
 * @param {string} message - 提示消息
 */
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

/**
 * 增强版适应视图：确保所有节点刚好在画布内，充分利用空间而不至于过小
 * 简化版本：先尝试使用库自带的zoomToFit，然后微调
 */
function enhancedFitView() {
    // 添加视觉反馈，让用户知道函数被调用了
    const feedback = document.createElement('div');
    feedback.id = 'fit-view-feedback';
    feedback.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: #60a5fa;
        padding: 10px 20px;
        border-radius: 8px;
        border: 2px solid #60a5fa;
        z-index: 9999;
        font-family: monospace;
        font-size: 14px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s;
    `;
    feedback.textContent = '适应视图中...';
    document.body.appendChild(feedback);
    
    // 显示反馈
    setTimeout(() => {
        feedback.style.opacity = '1';
    }, 10);
    
    // 3秒后移除反馈
    setTimeout(() => {
        feedback.style.opacity = '0';
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 300);
    }, 3000);
    
    if (!Graph) {
        console.warn('enhancedFitView: Graph未初始化');
        feedback.textContent = 'Graph未初始化';
        // 尝试使用备用方案
        if (window.Graph && typeof window.Graph.zoomToFit === 'function') {
            console.log('使用备用方案：window.Graph.zoomToFit');
            window.Graph.zoomToFit(1000, 100);
            feedback.textContent = '使用备用适应视图';
        }
        return;
    }
    
    console.log('开始增强版适应视图：缩放显示所有节点，充分利用画布空间...');
    feedback.textContent = '计算节点位置...';
    
    // 方法1：先使用库自带的zoomToFit（快速适应）
    try {
        console.log('方法1：使用Graph.zoomToFit');
        feedback.textContent = '缩放适应视图中...';
        Graph.zoomToFit(800, 100); // 800ms动画，100边距
    } catch (error) {
        console.error('Graph.zoomToFit失败:', error);
        feedback.textContent = '适应视图失败';
    }
    
    // 方法2：延迟后执行自定义微调（确保所有节点可见）
    setTimeout(() => {
        try {
            const { nodes } = Graph.graphData();
            if (!nodes || nodes.length === 0) {
                console.log('enhancedFitView: 无节点数据');
                feedback.textContent = '无节点数据';
                return;
            }
            
            console.log(`enhancedFitView: 处理 ${nodes.length} 个节点`);
            feedback.textContent = `处理 ${nodes.length} 个节点...`;
            
            // 简单计算：找到所有节点的中心点
            let sumX = 0, sumY = 0, sumZ = 0;
            let count = 0;
            
            nodes.forEach(node => {
                if (node.x !== undefined && node.y !== undefined && node.z !== undefined) {
                    sumX += node.x;
                    sumY += node.y;
                    sumZ += node.z;
                    count++;
                }
            });
            
            if (count === 0) {
                console.log('enhancedFitView: 没有有效的节点坐标');
                feedback.textContent = '没有有效的节点坐标';
                return;
            }
            
            const centerX = sumX / count;
            const centerY = sumY / count;
            const centerZ = sumZ / count;
            
            // 计算最大距离（从中心到最远节点）
            let maxDistance = 0;
            nodes.forEach(node => {
                if (node.x !== undefined && node.y !== undefined && node.z !== undefined) {
                    const dx = node.x - centerX;
                    const dy = node.y - centerY;
                    const dz = node.z - centerZ;
                    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    maxDistance = Math.max(maxDistance, distance);
                }
            });
            
            // 添加安全边距
            const safeDistance = Math.max(maxDistance * 1.5, 200);
            
            // 计算相机位置（在中心点上方）
            const targetCameraPos = {
                x: centerX,
                y: centerY,
                z: centerZ + safeDistance
            };
            
            // 计算观察点（中心点）
            const targetLookAt = {
                x: centerX,
                y: centerY,
                z: centerZ
            };
            
            console.log('enhancedFitView: 简单计算完成', {
                中心点: { x: centerX.toFixed(1), y: centerY.toFixed(1), z: centerZ.toFixed(1) },
                最大距离: maxDistance.toFixed(1),
                安全距离: safeDistance.toFixed(1),
                相机位置: { x: targetCameraPos.x.toFixed(1), y: targetCameraPos.y.toFixed(1), z: targetCameraPos.z.toFixed(1) }
            });
            
            feedback.textContent = '微调相机位置...';
            
            // 微调相机位置
            Graph.cameraPosition(targetCameraPos, targetLookAt, 600);
            
            console.log('增强版适应视图完成');
            feedback.textContent = '适应视图完成！';
        } catch (error) {
            console.error('enhancedFitView微调失败:', error);
            feedback.textContent = '微调失败';
        }
    }, 850); // 等待zoomToFit完成
}

/**
 * 适应视图按钮点击处理（公开接口）
 */
function fitView() {
    console.log('执行适应视图...');
    enhancedFitView();
}

// 导出函数到全局作用域，供controls.js使用
window.enhancedFitView = enhancedFitView;
window.fitView = fitView;

// 导出数据加载函数，供3d_form.js使用
window.loadGraphData = loadGraphData;

// 导出Graph对象到全局作用域
window.getGraphInstance = function() {
    return Graph;
};

// 在init3DGraph中设置全局Graph引用
function init3DGraph() {
    const container = document.getElementById('3d-graph');
    if (!container) return;

    Graph = ForceGraph3D()(container)
        .backgroundColor('#000000')
        .showNavInfo(false)
        .nodeThreeObjectExtend(true) 
        .nodeRelSize(7) 

        .nodeLabel(node => {
            const weight = typeof node.survival_weight === 'number' ? node.survival_weight.toFixed(12) : '0.000000000000';
            const action = node.action_tag || '未定义动作';
            const block = node.block_tag || '未定义因缘';
            const eventTuple = node.event_tuple || '无事件叙述';
            
            // 截断过长的event_tuple，避免tooltip过大
            const truncatedEventTuple = eventTuple.length > 200 ? 
                eventTuple.substring(0, 200) + '...' : eventTuple;
            
            return `
                <div class="force-graph-tooltip">
                    <div class="tooltip-title">${node.id}</div>
                    
                    <div class="tooltip-meta">
                        <div class="tooltip-meta-item">
                            <span class="tooltip-label">动作：</span>
                            <span class="tooltip-value">${action}</span>
                        </div>
                        <div class="tooltip-meta-item">
                            <span class="tooltip-label">因缘：</span>
                            <span class="tooltip-value">${block}</span>
                        </div>
                        <div class="tooltip-meta-item">
                            <span class="tooltip-label">权重：</span>
                            <span class="tooltip-value weight-value">${weight}</span>
                        </div>
                    </div>
                    
                    <div class="tooltip-event">
                        <div class="tooltip-label">事件叙述：</div>
                        <div class="tooltip-event-content">${truncatedEventTuple}</div>
                    </div>
                </div>`;
        })

        .nodeVal(node => 8 + ((node.survival_weight || 0) * 65))
        .nodeColor(node => highlightNodes.has(node) ? '#ffffff' : getNodeColor(node))
        
        // --- [极限连线效果] ---
        // 1. 颜色：提升饱和度，使用明亮的青色（Cyan）
        .linkColor(link => highlightLinks.has(link) ? '#ffffff' : 'rgba(0, 255, 255, 0.45)')
        // 2. 宽度：大幅增强，基础线宽设为 4.0，高亮提升到 10.0 以产生强烈的焦点感
        .linkWidth(link => highlightLinks.has(link) ? 10.0 : 4.0)
        // 3. 粒子系统：增加粒子密度和大小，模拟"因果流"
        .linkDirectionalParticles(link => highlightLinks.has(link) ? 8 : 3)
        .linkDirectionalParticleWidth(link => highlightLinks.has(link) ? 6 : 3.5)
        .linkDirectionalParticleSpeed(0.008)
        // 4. 箭头：配合宽线增加尺寸
        .linkDirectionalArrowLength(8)
        .linkDirectionalArrowRelPos(1)

        .onNodeHover(node => {
            if (node === hoverNode) return;
            container.style.cursor = node ? 'pointer' : null;
            hoverNode = node;
            updateHighlight();
        })
        .onNodeClick(async (node) => {
            // 1. 设置selectNode为true，表示已选择节点
            window.selectNode = true;
            window.selectedNode = node;
            console.log(`[3D图] 节点已选择: ${node.id}, selectNode = true`);
            
            // 2. 调用抽屉功能处理节点点击
            console.log(`[3D图] 检查 window.handle3DNodeClick:`, typeof window.handle3DNodeClick);
            console.log(`[3D图] 节点对象:`, node);
            console.log(`[3D图] 节点ID:`, node.id);
            
            // 检查是否处于父ID选择模式
            const isParentIdSelectionMode = window.parentIdSelectionMode || false;
            console.log(`[3D图] 父ID选择模式状态:`, isParentIdSelectionMode);
            
            if (window.handle3DNodeClick && typeof window.handle3DNodeClick === 'function') {
                console.log(`[3D图] 调用 window.handle3DNodeClick(${node.id})`);
                const handled = window.handle3DNodeClick(node.id);
                console.log(`[3D图] window.handle3DNodeClick返回值:`, handled);
                
                // 如果处于父ID选择模式，不执行地宫恢复和权重提升
                if (isParentIdSelectionMode) {
                    console.log(`[3D图] 处于父ID选择模式，跳过地宫恢复和权重提升`);
                    return;
                }
            } else {
                console.error('[3D图] window.handle3DNodeClick 未定义或不是函数');
                // 尝试直接打开抽屉
                const drawer = document.getElementById('drawer');
                if (drawer) {
                    drawer.classList.remove('drawer-hidden');
                    console.log('[3D图] 直接打开抽屉');
                    // 尝试设置d-node-id字段
                    const nodeIdField = document.getElementById('d-node-id');
                    if (nodeIdField) {
                        nodeIdField.value = node.id;
                        console.log('[3D图] 直接设置d-node-id为:', node.id);
                    }
                }
            }
            
            // 3. 从地宫恢复内容（与index.html中的实现一致）
            // 只有在不是父ID选择模式时才执行
            if (!isParentIdSelectionMode) {
                await restoreFromNecropolis(node);
            } else {
                console.log(`[3D图] 父ID选择模式，跳过地宫恢复`);
            }
            
            // 4. 提升节点权重（与index.html中的实现一致）
            // 只有在不是父ID选择模式时才执行
            if (!isParentIdSelectionMode) {
                await promoteNodeWeight(node);
            } else {
                console.log(`[3D图] 父ID选择模式，跳过权重提升`);
            }
            
            // 5. 相机移动到节点位置（3D特有功能）
            // 考虑抽屉打开时的偏移：当抽屉打开时，画布向左移动384px
            // 我们需要将节点置于屏幕剩余区域的中心
            const distance = 440;
            const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
            
            // 检查抽屉是否打开
            const drawer = document.getElementById('drawer');
            const isDrawerOpen = drawer && !drawer.classList.contains('drawer-hidden');
            
            // 计算相机位置
            let cameraPos = {
                x: node.x * distRatio,
                y: node.y * distRatio,
                z: node.z * distRatio
            };
            
            // 如果抽屉打开，调整相机位置，让节点出现在屏幕剩余区域的中心
            if (isDrawerOpen) {
                // 抽屉宽度为384px，我们需要在3D空间中模拟这个偏移
                // 由于3D相机移动是在3D坐标系中，而画布偏移是2D的CSS变换
                // 这里我们简单地将相机位置向右调整，以补偿画布的向左移动
                // 实际上，当画布向左移动384px时，节点在屏幕上的视觉位置会向右偏移
                // 为了将节点置于剩余区域的中心，我们需要将相机向左调整
                const drawerWidth = 384;
                const screenWidth = window.innerWidth;
                const visibleWidth = screenWidth - drawerWidth;
                
                // 计算偏移比例：抽屉宽度占屏幕宽度的比例
                const offsetRatio = drawerWidth / screenWidth;
                
                // 在3D空间中，我们无法直接进行2D偏移
                // 但我们可以调整相机的x坐标，让节点在视觉上出现在正确位置
                // 这是一个近似计算：将相机位置向左调整一定比例
                cameraPos.x = cameraPos.x * (1 - offsetRatio * 0.5);
                
                console.log(`[3D图] 抽屉打开，调整相机位置：屏幕宽度=${screenWidth}px，抽屉宽度=${drawerWidth}px，可见宽度=${visibleWidth}px，偏移比例=${offsetRatio.toFixed(3)}`);
            }
            
            Graph.cameraPosition(cameraPos, node, 1500);
        });

    Graph.nodeThreeObject(node => {
        const THREE = getThreeInstance();
        if (!THREE) return null;

        try {
            const texture = createTextTexture(node.id, THREE);
            if (!texture) return null;

            const sprite = new THREE.Sprite(
                new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
            );
            
            const baseScale = 0.4; 
            sprite.scale.set(texture.baseWidth * baseScale, texture.baseHeight * baseScale, 1);
            
            const visualSize = 8 + ((node.survival_weight || 0) * 65);
            const radius = Math.sqrt(visualSize) * 3.5; 
            sprite.position.y = radius + 17; // 稍微再调高一点
            
            return sprite;
        } catch (e) {
            return null;
        }
    });

    // 物理引擎：加大排斥力和间距，让宽线有展示空间
    Graph.d3Force('charge').strength(-600);
    Graph.d3Force('link').distance(180); 

    // 设置全局Graph引用
    window.Graph = Graph;
    
    // 触发graphReady事件，通知controls.js
    const event = new CustomEvent('graphReady', { detail: { graph: Graph } });
    window.dispatchEvent(event);
    
    console.log('3D Graph已初始化并设置为全局对象');

    loadInitialData();

    window.addEventListener('resize', () => {
        Graph.width(container.clientWidth).height(container.clientHeight);
    });
}

document.addEventListener('DOMContentLoaded', init3DGraph);
