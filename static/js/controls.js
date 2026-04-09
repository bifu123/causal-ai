/**
 * 因果星空 - Controls 控制模块
 * 根据《因果星空（三）3D 视觉实现蓝图.md》实现
 * 版本：v1.0 - 逻辑建模期
 */

// --- [全局状态管理] ---
// 使用局部变量存储Graph引用，避免与3d_force_graph.js中的Graph变量冲突
let controlsGraph = null;
let isPhysicsEnabled = true;
let currentNavigationChain = [];
let navigationIndex = 0;
let isNavigating = false;
let rippleAnimation = null;
let originalLinkDistance = 180;

// 寻龙巡航相关状态
let selectNode = false; // 用户是否已选择节点
let selectedNode = null; // 用户选择的节点
let isDragonCruising = false; // 是否正在寻龙巡航
let cruiseInterval = null; // 巡航定时器

// 罗盘相关状态
let compassTarget = null;
let compassInterval = null;
let isDraggingCompass = false;
let dragOffset = { x: 0, y: 0 };
let compassPosition = { x: 0, y: 0 };

// 引力聚焦相关状态
let gravityFocusEnabled = false;
let gravityFocusNode = null;
let originalForces = {
    charge: null,
    link: null
};

// --- [核心Controls功能] ---

/**
 * 初始化Controls模块
 * @param {Object} graphInstance - 3d-force-graph实例
 */
function initControls(graphInstance) {
    if (!graphInstance) {
        console.error('Controls初始化失败：Graph实例为空');
        return;
    }
    
    controlsGraph = graphInstance;
    console.log('Controls模块初始化成功');
    
    // 绑定所有UI控件事件
    bindUIControls();
    
    // 初始化罗盘位置
    initCompassPosition();
}

/**
 * 绑定所有UI控件事件
 */
function bindUIControls() {
    console.log('开始绑定UI控件事件...');
    
    // 物理模拟滑块
    const forceSlider = document.getElementById('force-strength');
    const forceValue = document.getElementById('force-value');
    if (forceSlider && forceValue) {
        forceSlider.addEventListener('input', () => {
            const value = forceSlider.value;
            forceValue.textContent = `${value}%`;
            // 调整物理引擎强度：-600到0范围
            const strength = -600 * (value / 100);
            controlsGraph.d3Force('charge').strength(strength);
            console.log(`物理模拟强度调整为: ${strength.toFixed(1)}`);
        });
    }
    
    // 节点大小滑块
    const sizeSlider = document.getElementById('node-size');
    const sizeValue = document.getElementById('size-value');
    if (sizeSlider && sizeValue) {
        sizeSlider.addEventListener('input', () => {
            const value = parseFloat(sizeSlider.value);
            sizeValue.textContent = value.toFixed(1);
            controlsGraph.nodeRelSize(value);
            console.log(`节点大小调整为: ${value.toFixed(1)}`);
        });
    }
    
    // 连接强度滑块
    const linkSlider = document.getElementById('link-distance');
    const linkValue = document.getElementById('link-value');
    if (linkSlider && linkValue) {
        linkSlider.addEventListener('input', () => {
            const value = parseFloat(linkSlider.value);
            linkValue.textContent = value.toFixed(1);
            // 调整连接距离：60到600范围
            const distance = 60 + (value - 1) * 60; // 1->60, 10->600
            controlsGraph.d3Force('link').distance(distance);
            console.log(`连接距离调整为: ${distance.toFixed(1)}`);
        });
    }
    
    // 重置视图按钮
    const resetBtn = document.getElementById('btn-reset-view');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            controlsGraph.cameraPosition({ x: 0, y: 0, z: 250 }, { x: 0, y: 0, z: 0 }, 1000);
            console.log('视图已重置到默认位置');
        });
    }
    
    // 适应视图按钮 - 使用增强版适应视图功能
    const fitBtn = document.getElementById('btn-fit-view');
    if (fitBtn) {
        console.log('找到适应视图按钮，绑定点击事件');
        
        fitBtn.addEventListener('click', () => {
            console.log('适应视图按钮被点击 - 开始执行');
            
            // 简单直接的方法：尝试所有可能的Graph实例
            let graphInstance = null;
            
            // 优先级1：使用controlsGraph（如果已初始化）
            if (controlsGraph && typeof controlsGraph.zoomToFit === 'function') {
                graphInstance = controlsGraph;
                console.log('使用controlsGraph实例');
            }
            // 优先级2：使用全局Graph对象
            else if (window.Graph && typeof window.Graph.zoomToFit === 'function') {
                graphInstance = window.Graph;
                console.log('使用window.Graph实例');
            }
            // 优先级3：尝试从容器获取
            else {
                const container = document.getElementById('3d-graph');
                if (container && container.__graph) {
                    graphInstance = container.__graph;
                    console.log('从容器获取Graph实例');
                }
            }
            
            if (graphInstance) {
                console.log('找到Graph实例，执行zoomToFit');
                try {
                    // 显示简单提示
                    const feedback = document.createElement('div');
                    feedback.id = 'fit-view-simple-feedback';
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
                    `;
                    feedback.textContent = '适应视图中...';
                    document.body.appendChild(feedback);
                    
                    // 执行适应视图 - 增加边距，减少缩放比例
                    graphInstance.zoomToFit(800, 10); // 800ms动画，10边距
                    
                    // 2秒后移除提示
                    setTimeout(() => {
                        if (feedback.parentNode) {
                            feedback.parentNode.removeChild(feedback);
                        }
                    }, 2000);
                    
                    console.log('zoomToFit执行成功，使用更大边距(10)');
                } catch (error) {
                    console.error('zoomToFit执行失败:', error);
                    // 不再显示alert，只记录错误
                }
            } else {
                console.error('没有找到可用的Graph实例');
                // 不再显示alert，只记录错误
            }
        });
    } else {
        console.error('未找到适应视图按钮！按钮ID：btn-fit-view');
        // 不再显示alert，只记录错误
    }
    
    // 暂停物理按钮
    const physicsBtn = document.getElementById('btn-toggle-physics');
    if (physicsBtn) {
        physicsBtn.addEventListener('click', () => {
            isPhysicsEnabled = !isPhysicsEnabled;
            if (isPhysicsEnabled) {
                controlsGraph.resumeAnimation();
                physicsBtn.textContent = '暂停物理';
                console.log('物理模拟已恢复');
            } else {
                controlsGraph.pauseAnimation();
                physicsBtn.textContent = '恢复物理';
                console.log('物理模拟已暂停');
            }
        });
    }
    
    // 寻龙巡航按钮（旧的因果导航）
    const navigateBtn = document.getElementById('btn-navigate-chain');
    if (navigateBtn) {
        navigateBtn.addEventListener('click', () => {
            // 获取当前悬停节点
            const hoverNode = window.hoverNode; // 从全局获取
            if (hoverNode) {
                startCausalNavigation(hoverNode);
            } else {
                alert('请先悬停在一个节点上以选择起始节点');
            }
        });
    }
    
    // 新的寻龙巡航按钮（子节点自动点击）
    const dragonCruiseBtn = document.getElementById('btn-dragon-cruise');
    if (dragonCruiseBtn) {
        dragonCruiseBtn.addEventListener('click', () => {
            // 检查是否已选择节点
            if (!selectNode) {
                alert('请先点击某一节点，然后再点击"寻龙巡航"');
                return;
            }
            
            // 开始寻龙巡航
            startDragonCruise();
        });
    }
    
    // 罗盘定穴按钮
    const compassBtn = document.getElementById('btn-compass');
    if (compassBtn) {
        compassBtn.addEventListener('click', showCompass);
    }
    
    // 引力聚焦按钮
    const gravityFocusBtn = document.getElementById('btn-gravity-focus');
    if (gravityFocusBtn) {
        gravityFocusBtn.addEventListener('click', toggleGravityFocus);
    }
    
    // 罗盘控制按钮
    const setTargetBtn = document.getElementById('btn-set-target');
    if (setTargetBtn) {
        setTargetBtn.addEventListener('click', setCompassTarget);
    }
    
    const clearTargetBtn = document.getElementById('btn-clear-target');
    if (clearTargetBtn) {
        clearTargetBtn.addEventListener('click', clearCompassTarget);
    }
    
    const closeCompassBtn = document.getElementById('btn-close-compass');
    if (closeCompassBtn) {
        closeCompassBtn.addEventListener('click', hideCompass);
    }
    
    // ESC键关闭罗盘
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const compassOverlay = document.getElementById('compass-overlay');
            if (compassOverlay && !compassOverlay.classList.contains('compass-hidden')) {
                hideCompass();
            }
        }
    });
    
    // 罗盘拖动功能
    setupCompassDrag();
    
    console.log('UI控件事件绑定完成');
}

// --- [蓝图核心功能：寻龙巡航] ---

/**
 * 开始因果导航（寻龙巡航）
 * 根据蓝图：当LLM溯源parent_id时，相机平滑地顺着逻辑链条进行"过山车式"飞行
 * @param {Object} startNode - 起始节点
 */
async function startCausalNavigation(startNode) {
    if (!controlsGraph || !startNode) {
        console.error('寻龙巡航失败：Graph或起始节点为空');
        return;
    }
    
    if (isNavigating) {
        console.log('寻龙巡航正在进行中，请等待完成');
        return;
    }
    
    console.log(`开始寻龙巡航，起始节点: ${startNode.id}`);
    
    // 获取因果链
    const causalChain = buildCausalChain(startNode);
    if (causalChain.length <= 1) {
        alert('该节点没有因果链，无法进行寻龙巡航');
        return;
    }
    
    isNavigating = true;
    currentNavigationChain = causalChain;
    navigationIndex = 0;
    
    // 暂停物理模拟
    controlsGraph.pauseAnimation();
    
    // 开始巡航
    await navigateThroughChain();
    
    // 恢复物理模拟
    controlsGraph.resumeAnimation();
    isNavigating = false;
    
    console.log('寻龙巡航完成');
}

/**
 * 构建因果链 - 优化版：广度优先遍历所有节点
 * 根据用户要求：遍历所有子节点，不设置深度限制，避免循环，同级子节点按创建时间排序
 */
function buildCausalChain(startNode) {
    console.log(`[寻龙巡航优化] 开始构建因果链，起始节点: ${startNode.id}`);
    
    const { nodes, links } = controlsGraph.graphData();
    const visited = new Set(); // 已访问节点集合，避免循环
    const result = []; // 最终遍历结果
    const queue = []; // 广度优先遍历队列
    
    // 初始化：将起始节点加入队列和已访问集合
    visited.add(startNode.id);
    queue.push({ node: startNode, level: 0 });
    
    // 广度优先遍历
    while (queue.length > 0) {
        const { node, level } = queue.shift();
        
        // 将当前节点加入结果（除了起始节点已经在最开始加入）
        if (node.id !== startNode.id || result.length === 0) {
            result.push(node);
        }
        
        console.log(`[寻龙巡航优化] 处理节点: ${node.id}, 层级: ${level}`);
        
        // 查找所有子节点
        const childLinks = links.filter(link => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            return sourceId === node.id;
        });
        
        if (childLinks.length === 0) {
            console.log(`[寻龙巡航优化] 节点 ${node.id} 没有子节点`);
            continue;
        }
        
        console.log(`[寻龙巡航优化] 节点 ${node.id} 有 ${childLinks.length} 个子节点`);
        
        // 获取所有子节点对象
        const childNodes = [];
        childLinks.forEach(link => {
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            const childNode = nodes.find(n => n.id === targetId);
            if (childNode && !visited.has(childNode.id)) {
                childNodes.push(childNode);
            }
        });
        
        // 按创建时间排序（假设节点有created_at字段，如果没有则按ID排序）
        childNodes.sort((a, b) => {
            // 优先使用created_at字段，如果没有则使用ID（假设ID包含时间信息）
            const timeA = a.created_at || a.id;
            const timeB = b.created_at || b.id;
            return timeA.localeCompare(timeB);
        });
        
        console.log(`[寻龙巡航优化] 排序后的子节点:`, childNodes.map(n => n.id));
        
        // 将子节点加入队列
        childNodes.forEach(childNode => {
            if (!visited.has(childNode.id)) {
                visited.add(childNode.id);
                queue.push({ node: childNode, level: level + 1 });
                console.log(`[寻龙巡航优化] 将子节点 ${childNode.id} 加入队列，层级: ${level + 1}`);
            }
        });
    }
    
    console.log(`[寻龙巡航优化] 构建因果链完成，共 ${result.length} 个节点`);
    console.log(`[寻龙巡航优化] 遍历顺序:`, result.map(n => n.id));
    
    return result;
}

/**
 * 沿因果链巡航
 */
async function navigateThroughChain() {
    for (let i = 0; i < currentNavigationChain.length; i++) {
        const node = currentNavigationChain[i];
        navigationIndex = i;
        
        // 更新节点信息显示
        updateNodeInfo(node);
        
        // 执行罗盘定穴效果（波纹扩散）
        performAnchorHighlight(node);
        
        // 相机移动到节点位置（使用Tween.js实现非线性插值）
        await moveCameraToNode(node, i);
        
        // 停留观察时间
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
}

/**
 * 移动相机到节点位置
 * 使用Tween.js实现蓝图要求的"非线性插值，模拟人类视线移动"
 */
function moveCameraToNode(node, index) {
    return new Promise((resolve) => {
        const camera = controlsGraph.camera();
        if (!camera || !camera.position) {
            resolve();
            return;
        }
        
        const currentPos = camera.position;
        const currentLookAt = camera.lookAt || { x: 0, y: 0, z: 0 };
        
        // 计算目标位置：在节点上方一定距离
        const targetDistance = 120;
        const distRatio = 1 + targetDistance / Math.hypot(node.x, node.y, node.z);
        const targetPos = {
            x: node.x * distRatio,
            y: node.y * distRatio,
            z: node.z * distRatio
        };
        
        // 使用Tween.js创建动画
        const duration = 1800; // 1.8秒
        const startTime = Date.now();
        
        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // 使用缓动函数实现非线性插值
            const easeProgress = easeInOutCubic(progress);
            
            // 插值计算当前位置
            const currentCameraPos = {
                x: currentPos.x + (targetPos.x - currentPos.x) * easeProgress,
                y: currentPos.y + (targetPos.y - currentPos.y) * easeProgress,
                z: currentPos.z + (targetPos.z - currentPos.z) * easeProgress
            };
            
            const currentLookAtPos = {
                x: currentLookAt.x + (node.x - currentLookAt.x) * easeProgress,
                y: currentLookAt.y + (node.y - currentLookAt.y) * easeProgress,
                z: currentLookAt.z + (node.z - currentLookAt.z) * easeProgress
            };
            
            // 更新相机位置
            controlsGraph.cameraPosition(currentCameraPos, currentLookAtPos, 0);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                resolve();
            }
        }
        
        animate();
    });
}

/**
 * 缓动函数：三次缓入缓出
 */
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- [蓝图核心功能：罗盘定穴] ---

/**
 * 执行锚点高亮效果（波纹扩散）
 * 根据蓝图：命中的节点产生简单的波纹扩散效果
 */
function performAnchorHighlight(node) {
    if (!node) return;
    
    console.log(`执行罗盘定穴效果，节点: ${node.id}`);
    
    // 这里可以添加波纹扩散的视觉效果
    // 由于时间关系，这里先实现基本的节点高亮
    
    // 高亮当前节点
    if (window.updateHighlight) {
        window.hoverNode = node;
        window.updateHighlight();
    }
    
    // 可以在这里添加THREE.js的波纹效果
    // 例如：创建圆形几何体并逐渐放大、淡出
}

/**
 * 显示罗盘定穴UI
 */
function showCompass() {
    const compassOverlay = document.getElementById('compass-overlay');
    if (compassOverlay) {
        compassOverlay.classList.remove('compass-hidden');
        startCompassUpdate();
        console.log('罗盘定穴UI已显示');
    }
}

/**
 * 隐藏罗盘定穴UI
 */
function hideCompass() {
    const compassOverlay = document.getElementById('compass-overlay');
    if (compassOverlay) {
        compassOverlay.classList.add('compass-hidden');
        stopCompassUpdate();
        console.log('罗盘定穴UI已隐藏');
    }
}

/**
 * 开始更新罗盘
 */
function startCompassUpdate() {
    if (compassInterval) {
        clearInterval(compassInterval);
    }
    
    compassInterval = setInterval(updateCompass, 100);
}

/**
 * 停止更新罗盘
 */
function stopCompassUpdate() {
    if (compassInterval) {
        clearInterval(compassInterval);
        compassInterval = null;
    }
}

/**
 * 更新罗盘显示
 */
function updateCompass() {
    if (!controlsGraph) return;
    
    // 获取相机位置
    const camera = controlsGraph.camera();
    if (!camera || !camera.position) return;
    
    const camPos = camera.position;
    const camTarget = camera.lookAt || { x: 0, y: 0, z: 0 };
    
    // 更新当前位置
    const positionEl = document.getElementById('compass-position');
    if (positionEl) {
        positionEl.textContent = `(${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)})`;
    }
    
    // 更新目标位置
    const targetEl = document.getElementById('compass-target');
    if (targetEl) {
        if (compassTarget) {
            targetEl.textContent = `(${compassTarget.x.toFixed(1)}, ${compassTarget.y.toFixed(1)}, ${compassTarget.z.toFixed(1)})`;
        } else {
            targetEl.textContent = `(${camTarget.x.toFixed(1)}, ${camTarget.y.toFixed(1)}, ${camTarget.z.toFixed(1)})`;
        }
    }
    
    // 计算距离
    const distanceEl = document.getElementById('compass-distance');
    if (distanceEl) {
        let targetPos = compassTarget || camTarget;
        const dx = targetPos.x - camPos.x;
        const dy = targetPos.y - camPos.y;
        const dz = targetPos.z - camPos.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        distanceEl.textContent = distance.toFixed(1);
        
        // 更新罗盘指针方向
        updateCompassNeedle(dx, dz);
    }
}

/**
 * 更新罗盘指针方向
 */
function updateCompassNeedle(dx, dz) {
    const needle = document.querySelector('.compass-needle');
    if (!needle) return;
    
    // 计算角度（以Z轴为北，X轴为东）
    const angle = Math.atan2(dx, dz) * (180 / Math.PI);
    
    // 更新指针角度
    needle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
}

/**
 * 设置目标位置
 */
function setCompassTarget() {
    const hoverNode = window.hoverNode; // 从全局获取
    if (hoverNode) {
        compassTarget = {
            x: hoverNode.x,
            y: hoverNode.y,
            z: hoverNode.z
        };
        console.log(`罗盘目标已设置为节点: ${hoverNode.id}`);
        alert(`罗盘目标已设置为节点: ${hoverNode.id}`);
    } else {
        // 如果没有悬停节点，使用当前相机焦点
        const camera = controlsGraph.camera();
        if (camera && camera.lookAt) {
            compassTarget = { ...camera.lookAt };
            console.log('罗盘目标已设置为当前相机焦点');
            alert('罗盘目标已设置为当前相机焦点');
        } else {
            alert('请先悬停在一个节点上或移动相机以设置目标');
        }
    }
}

/**
 * 清除目标位置
 */
function clearCompassTarget() {
    compassTarget = null;
    console.log('罗盘目标已清除');
    alert('罗盘目标已清除');
}

/**
 * 初始化罗盘位置
 */
function initCompassPosition() {
    const compassOverlay = document.getElementById('compass-overlay');
    if (!compassOverlay) return;
    
    // 设置初始位置（右上角）
    compassPosition.x = window.innerWidth - compassOverlay.offsetWidth - 20;
    compassPosition.y = 20;
    
    compassOverlay.style.left = `${compassPosition.x}px`;
    compassOverlay.style.top = `${compassPosition.y}px`;
}

/**
 * 设置罗盘拖动功能
 */
function setupCompassDrag() {
    const compassOverlay = document.getElementById('compass-overlay');
    const compassHeader = document.querySelector('.compass-header');
    
    if (!compassOverlay || !compassHeader) return;
    
    // 鼠标按下事件 - 开始拖动
    compassHeader.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('compass-close')) return;
        
        isDraggingCompass = true;
        
        // 计算鼠标相对于罗盘左上角的偏移
        const rect = compassOverlay.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        
        // 保存当前位置
        compassPosition.x = rect.left;
        compassPosition.y = rect.top;
        
        // 添加拖动样式
        compassOverlay.style.cursor = 'grabbing';
        compassHeader.style.cursor = 'grabbing';
        
        e.preventDefault();
    });
    
    // 鼠标移动事件 - 拖动中
    document.addEventListener('mousemove', (e) => {
        if (!isDraggingCompass) return;
        
        // 计算新位置
        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;
        
        // 限制在窗口范围内
        const maxX = window.innerWidth - compassOverlay.offsetWidth;
        const maxY = window.innerHeight - compassOverlay.offsetHeight;
        
        compassPosition.x = Math.max(0, Math.min(newX, maxX));
        compassPosition.y = Math.max(0, Math.min(newY, maxY));
        
        // 更新位置
        compassOverlay.style.left = `${compassPosition.x}px`;
        compassOverlay.style.top = `${compassPosition.y}px`;
        compassOverlay.style.transform = 'none'; // 移除居中transform
    });
    
    // 鼠标松开事件 - 结束拖动
    document.addEventListener('mouseup', () => {
        if (!isDraggingCompass) return;
        
        isDraggingCompass = false;
        
        // 恢复光标样式
        compassOverlay.style.cursor = '';
        compassHeader.style.cursor = 'move';
    });
}

/**
 * 更新节点信息显示
 */
function updateNodeInfo(node) {
    if (!node) return;
    
    // 更新节点信息面板
    const nodeIdEl = document.getElementById('info-node-id');
    const actionTagEl = document.getElementById('info-action-tag');
    const blockTagEl = document.getElementById('info-block-tag');
    const weightEl = document.getElementById('info-weight');
    const parentsEl = document.getElementById('info-parents');
    const eventTupleEl = document.getElementById('info-event-tuple');
    
    if (nodeIdEl) nodeIdEl.textContent = node.id || '-';
    if (actionTagEl) actionTagEl.textContent = node.action_tag || '-';
    if (blockTagEl) blockTagEl.textContent = node.block_tag || '-';
    
    if (weightEl) {
        const weight = typeof node.survival_weight === 'number' ? node.survival_weight.toFixed(8) : '0.00000000';
        weightEl.textContent = weight;
    }
    
    if (parentsEl) {
        const parents = node.parent_ids || (node.parent_id ? [node.parent_id] : []);
        parentsEl.textContent = parents.length > 0 ? parents.join(', ') : '-';
    }
    
    if (eventTupleEl) {
        eventTupleEl.textContent = node.event_tuple || '-';
    }
}

/**
 * 切换引力聚焦模式
 */
function toggleGravityFocus() {
    if (!controlsGraph) return;
    
    if (gravityFocusEnabled) {
        // 关闭引力聚焦
        resetGravityFocus();
        gravityFocusEnabled = false;
        gravityFocusNode = null;
        
        const focusBtn = document.getElementById('btn-gravity-focus');
        if (focusBtn) {
            focusBtn.textContent = '引力聚焦';
            focusBtn.style.backgroundColor = 'rgba(96, 165, 250, 0.2)';
        }
        
        console.log('引力聚焦已关闭');
        alert('引力聚焦已关闭，恢复正常物理模拟');
    } else {
        // 开启引力聚焦
        const hoverNode = window.hoverNode; // 从全局获取
        if (!hoverNode) {
            alert('请先悬停在一个节点上以选择瞄定目标');
            return;
        }
        
        gravityFocusNode = hoverNode;
        applyGravityFocus(gravityFocusNode);
        gravityFocusEnabled = true;
        
        const focusBtn = document.getElementById('btn-gravity-focus');
        if (focusBtn) {
            focusBtn.textContent = '关闭聚焦';
            focusBtn.style.backgroundColor = 'rgba(239, 68, 68, 0.3)';
        }
        
        console.log(`引力聚焦已开启，瞄定节点: ${gravityFocusNode.id}`);
        alert(`引力聚焦已开启，瞄定节点: ${gravityFocusNode.id}\n\n相关节点将聚拢，不相关节点将远离`);
    }
}

/**
 * 应用引力聚焦效果
 */
function applyGravityFocus(focusNode) {
    if (!controlsGraph || !focusNode) return;
    
    // 保存原始物理参数
    originalForces.charge = controlsGraph.d3Force('charge').strength();
    originalForces.link = controlsGraph.d3Force('link').distance();
    
    const { nodes, links } = controlsGraph.graphData();
    
    // 计算相关节点集合（直接连接的节点）
    const relatedNodes = new Set();
    relatedNodes.add(focusNode.id);
    
    // 查找所有相关节点（父节点和子节点）
    links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        
        if (sourceId === focusNode.id) {
            relatedNodes.add(targetId);
        }
        if (targetId === focusNode.id) {
            relatedNodes.add(sourceId);
        }
    });
    
    console.log(`引力聚焦：瞄定节点 ${focusNode.id}，相关节点 ${relatedNodes.size} 个`);
    
    // 自定义引力函数：相关节点被吸引，不相关节点被排斥
    controlsGraph.d3Force('charge').strength(node => {
        if (node.id === focusNode.id) {
            return 0; // 瞄定节点不受力
        }
        
        if (relatedNodes.has(node.id)) {
            // 相关节点：弱吸引力，让它们靠近瞄定节点
            return -200;
        } else {
            // 不相关节点：强排斥力，让它们远离
            return -800;
        }
    });
    
    // 调整连接距离：相关连接更近，不相关连接更远
    controlsGraph.d3Force('link').distance(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        
        const isRelatedToFocus = relatedNodes.has(sourceId) && relatedNodes.has(targetId);
        const isConnectedToFocus = sourceId === focusNode.id || targetId === focusNode.id;
        
        if (isConnectedToFocus) {
            // 直接连接到瞄定节点的连接：非常近
            return 50;
        } else if (isRelatedToFocus) {
            // 相关节点之间的连接：较近
            return 100;
        } else {
            // 不相关连接：较远
            return 300;
        }
    });
    
    // 锁定瞄定节点的位置
    focusNode.fx = focusNode.x;
    focusNode.fy = focusNode.y;
    focusNode.fz = focusNode.z;
    
    // 将相机聚焦到瞄定节点
    controlsGraph.cameraPosition(
        { x: focusNode.x, y: focusNode.y, z: focusNode.z + 150 },
        focusNode,
        1000
    );
}

/**
 * 重置引力聚焦效果
 */
function resetGravityFocus() {
    if (!controlsGraph) return;
    
    // 恢复原始物理参数
    if (originalForces.charge !== null) {
        controlsGraph.d3Force('charge').strength(originalForces.charge);
    }
    
    if (originalForces.link !== null) {
        controlsGraph.d3Force('link').distance(originalForces.link);
    }
    
    // 解锁所有节点的位置
    const { nodes } = controlsGraph.graphData();
    nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
        node.fz = null;
    });
}

// --- [寻龙巡航功能] ---

/**
 * 开始寻龙巡航
 * 从根节点开始，沿着因果链向终节点执行点击逻辑，每隔5秒自动点击一个节点
 */
function startDragonCruise() {
    console.log('[寻龙巡航] ========== 开始寻龙巡航流程 ==========');
    
    if (!controlsGraph) {
        console.error('[寻龙巡航] 失败：Graph实例为空');
        return;
    }
    
    if (!selectedNode) {
        console.error('[寻龙巡航] 失败：未选择起始节点');
        alert('请先点击某一节点，然后再点击"寻龙巡航"');
        return;
    }
    
    console.log(`[寻龙巡航] 步骤1：已选择起始节点: ${selectedNode.id}`);
    console.log(`[寻龙巡航] 起始节点信息:`, {
        id: selectedNode.id,
        action_tag: selectedNode.action_tag,
        block_tag: selectedNode.block_tag,
        survival_weight: selectedNode.survival_weight,
        parent_ids: selectedNode.parent_ids
    });
    
    if (isDragonCruising) {
        console.log('[寻龙巡航] 失败：寻龙巡航正在进行中，请等待完成');
        alert('寻龙巡航正在进行中，请等待完成');
        return;
    }
    
    console.log('[寻龙巡航] 步骤2：开始构建因果链...');
    
    // 构建完整的因果链（从根节点到终节点）
    const causalChain = buildCausalChain(selectedNode);
    console.log(`[寻龙巡航] 因果链构建完成，共 ${causalChain.length} 个节点`);
    
    if (causalChain.length <= 1) {
        console.log('[寻龙巡航] 失败：该节点没有因果链，无法进行寻龙巡航');
        alert('该节点没有因果链，无法进行寻龙巡航');
        return;
    }
    
    // 输出因果链详细信息
    console.log('[寻龙巡航] 因果链节点顺序:');
    causalChain.forEach((node, index) => {
        console.log(`  ${index + 1}. ${node.id} (${node.action_tag || '无标签'})`);
    });
    
    isDragonCruising = true;
    
    // 显示开始提示
    showCruiseHint(`寻龙巡航开始，将从根节点开始遍历 ${causalChain.length} 个节点`);
    console.log(`[寻龙巡航] 步骤3：显示开始提示，将遍历 ${causalChain.length} 个节点`);
    
    // 开始巡航
    let currentIndex = 0;
    
    function cruiseNextNode() {
        console.log(`[寻龙巡航] ========== 开始处理第 ${currentIndex + 1}/${causalChain.length} 个节点 ==========`);
        
        if (currentIndex >= causalChain.length) {
            // 巡航完成
            console.log('[寻龙巡航] 步骤6：所有节点遍历完成，结束寻龙巡航');
            isDragonCruising = false;
            selectNode = false; // 重置选择状态
            selectedNode = null;
            
            // 显示完成提示
            showCruiseHint('寻龙巡航完成！');
            console.log('[寻龙巡航] 显示完成提示');
            
            // 清除定时器
            if (cruiseInterval) {
                clearInterval(cruiseInterval);
                cruiseInterval = null;
                console.log('[寻龙巡航] 清除巡航定时器');
            }
            
            console.log('[寻龙巡航] ========== 寻龙巡航完成 ==========');
            return;
        }
        
        const node = causalChain[currentIndex];
        console.log(`[寻龙巡航] 步骤4：准备点击第 ${currentIndex + 1}/${causalChain.length} 个节点: ${node.id}`);
        
        // 输出调试信息
        console.log(`[寻龙巡航] 节点 ${node.id} 详细信息:`, {
            action_tag: node.action_tag,
            block_tag: node.block_tag,
            survival_weight: node.survival_weight,
            parent_ids: node.parent_ids,
            event_tuple_length: node.event_tuple ? node.event_tuple.length : 0,
            position: { x: node.x, y: node.y, z: node.z }
        });
        
        // 模拟点击节点
        console.log(`[寻龙巡航] 调用 simulateNodeClick 函数...`);
        simulateNodeClick(node);
        
        // 显示当前节点信息
        showCruiseHint(`寻龙巡航中：${currentIndex + 1}/${causalChain.length} - 节点 ${node.id}`);
        console.log(`[寻龙巡航] 显示当前节点提示: ${currentIndex + 1}/${causalChain.length} - 节点 ${node.id}`);
        
        console.log(`[寻龙巡航] 第 ${currentIndex + 1} 个节点处理完成，等待5秒后处理下一个节点`);
        currentIndex++;
    }
    
    console.log('[寻龙巡航] 步骤5：立即执行第一次节点点击');
    // 立即执行第一次点击
    cruiseNextNode();
    
    // 设置定时器，每隔5秒点击下一个节点
    console.log('[寻龙巡航] 设置巡航定时器，间隔5秒');
    cruiseInterval = setInterval(cruiseNextNode, 5000);
    
    console.log('[寻龙巡航] ========== 寻龙巡航已启动 ==========');
}

/**
 * 获取节点的所有子节点
 */
function getChildNodes(node) {
    if (!controlsGraph || !node) return [];
    
    const { nodes, links } = controlsGraph.graphData();
    const childNodes = [];
    
    // 查找所有子节点
    links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        
        if (sourceId === node.id) {
            const childNode = nodes.find(n => n.id === targetId);
            if (childNode) {
                childNodes.push(childNode);
            }
        }
    });
    
    console.log(`节点 ${node.id} 有 ${childNodes.length} 个子节点`);
    return childNodes;
}

/**
 * 模拟节点点击
 */
async function simulateNodeClick(node) {
    if (!controlsGraph || !node) return;
    
    console.log(`[寻龙巡航] 模拟点击节点: ${node.id}`);
    
    try {
        // 1. 设置selectNode为true，表示已选择节点
        window.selectNode = true;
        window.selectedNode = node;
        console.log(`[寻龙巡航] 节点已选择: ${node.id}, selectNode = true`);
        
        // 2. 调用抽屉功能处理节点点击
        if (window.handle3DNodeClick) {
            window.handle3DNodeClick(node.id);
        }
        
        // 3. 从地宫恢复内容（与index.html中的实现一致）
        if (window.restoreFromNecropolis) {
            await window.restoreFromNecropolis(node);
        }
        
        // 4. 提升节点权重（与index.html中的实现一致）
        if (window.promoteNodeWeight) {
            await window.promoteNodeWeight(node);
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
            
            console.log(`[寻龙巡航] 抽屉打开，调整相机位置：屏幕宽度=${screenWidth}px，抽屉宽度=${drawerWidth}px，可见宽度=${visibleWidth}px，偏移比例=${offsetRatio.toFixed(3)}`);
        }
        
        controlsGraph.cameraPosition(cameraPos, node, 1500);
        
        // 6. 更新节点信息显示
        updateNodeInfo(node);
        
        console.log(`[寻龙巡航] 节点 ${node.id} 点击逻辑执行完成`);
    } catch (error) {
        console.error(`[寻龙巡航] 模拟点击节点 ${node.id} 时出错:`, error);
    }
}

/**
 * 显示寻龙巡航提示
 */
function showCruiseHint(message) {
    let hintDiv = document.getElementById('cruise-hint');
    if (!hintDiv) {
        hintDiv = document.createElement('div');
        hintDiv.id = 'cruise-hint';
        hintDiv.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-green-900/90 border border-green-700 rounded-lg p-3 z-50 max-w-md';
        document.body.appendChild(hintDiv);
    }
    hintDiv.innerHTML = `
        <div class="text-xs text-green-200 flex items-center">
            <span class="mr-2">🐉</span>
            <span>${message}</span>
        </div>
    `;
    
    // 5秒后自动消失
    setTimeout(() => {
        if (hintDiv.parentNode && hintDiv.id === 'cruise-hint') {
            hintDiv.classList.add('opacity-0', 'transition-opacity', 'duration-500');
            setTimeout(() => {
                if (hintDiv.parentNode && hintDiv.id === 'cruise-hint') {
                    hintDiv.parentNode.removeChild(hintDiv);
                }
            }, 500);
        }
    }, 5000);
}

// 导出函数供外部使用
window.initControls = initControls;
window.startCausalNavigation = startCausalNavigation;
window.showCompass = showCompass;
window.hideCompass = hideCompass;
window.toggleGravityFocus = toggleGravityFocus;
window.startDragonCruise = startDragonCruise;

// 添加直接调用的适应视图函数
window.handleFitViewClick = function() {
    console.log('handleFitViewClick被调用');
    
    // 尝试所有可能的Graph实例
    let graphInstance = null;
    
    // 优先级1：使用controlsGraph（如果已初始化）
    if (window.controlsGraph && typeof window.controlsGraph.zoomToFit === 'function') {
        graphInstance = window.controlsGraph;
        console.log('使用controlsGraph实例');
    }
    // 优先级2：使用全局Graph对象
    else if (window.Graph && typeof window.Graph.zoomToFit === 'function') {
        graphInstance = window.Graph;
        console.log('使用window.Graph实例');
    }
    // 优先级3：尝试从容器获取
    else {
        const container = document.getElementById('3d-graph');
        if (container && container.__graph) {
            graphInstance = container.__graph;
            console.log('从容器获取Graph实例');
        }
    }
    
    if (graphInstance) {
        console.log('找到Graph实例，执行zoomToFit');
        try {
            // 显示简单提示
            const feedback = document.createElement('div');
            feedback.id = 'fit-view-direct-feedback';
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
            `;
            feedback.textContent = '适应视图中...';
            document.body.appendChild(feedback);
            
            // 执行适应视图 - 增加边距，减少缩放比例
            // 参数说明：duration(动画时间), padding(边距), 更大的边距 = 更小的缩放
            graphInstance.zoomToFit(800, 250); // 800ms动画，250边距
            
            // 2秒后移除提示
            setTimeout(() => {
                if (feedback.parentNode) {
                    feedback.parentNode.removeChild(feedback);
                }
            }, 2000);
            
            console.log('zoomToFit执行成功，使用更大边距(250)');
        } catch (error) {
            console.error('zoomToFit执行失败:', error);
            // 不再显示alert，只记录错误
        }
    } else {
        console.error('没有找到可用的Graph实例');
        // 不再显示alert，只记录错误
    }
};

// 自动初始化：监听Graph创建
(function autoInitControls() {
    console.log('Controls模块已加载，等待Graph实例...');
    
    // 监听graphReady事件
    window.addEventListener('graphReady', (event) => {
        console.log('收到graphReady事件，初始化Controls');
        if (event.detail && event.detail.graph) {
            initControls(event.detail.graph);
        } else if (window.Graph) {
            initControls(window.Graph);
        }
    });
    
    // 尝试立即初始化（如果Graph已经存在）
    if (window.Graph && typeof window.Graph === 'object') {
        console.log('检测到已存在的Graph实例，立即初始化Controls');
        initControls(window.Graph);
        return;
    }
    
    // 设置一个监听器，等待Graph被创建（备用方案）
    let checkCount = 0;
    const maxChecks = 30; // 最多检查30次，约6秒
    
    function checkForGraph() {
        checkCount++;
        
        if (window.Graph && typeof window.Graph === 'object') {
            console.log(`检测到Graph实例（第${checkCount}次检查），初始化Controls`);
            initControls(window.Graph);
            return;
        }
        
        if (checkCount < maxChecks) {
            setTimeout(checkForGraph, 200); // 每200ms检查一次
        } else {
            console.warn('在6秒内未检测到Graph实例，Controls模块可能需要手动初始化');
            console.warn('请确保3d_force_graph.js已正确加载并创建了Graph实例');
            console.warn('或者检查window.Graph是否已正确设置');
        }
    }
    
    // 开始检查（延迟一点，确保3d_force_graph.js有机会先执行）
    setTimeout(checkForGraph, 1000);
})();
