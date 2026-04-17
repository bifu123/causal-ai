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

// 父ID选择模式相关变量
let parentIdSelectionMode = false; // 是否处于父ID选择模式
let activeParentIdField = null; // 当前活动的父ID输入框

// 远端协同与视角锁定机制
let lastLocalActionTime = 0; // 记录本地最近一次交互操作的时间戳
let lastRemoteJumpTime = 0;  // 记录最近一次远端跃迁的时间戳

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

// 神圣光柱动画相关
let activeBeam = null;
let beamAnimationId = null;

// 抽屉避让常量
const DRAWER_WIDTH = 384; // 抽屉宽度 (w-96 = 24rem = 384px)
const FOCUS_DIST = 200;   // 聚焦距离

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

/**
 * 视觉特效：神圣光柱（Divine Beam）与 全局光晕爆发
 * 当节点居中时，从正上方降下一束神圣光柱聚焦于该节点，并引起全屏幕的背景中心光晕闪亮
 * @param {Object} node 目标节点
 */
function showDivineBeam(node) {
    const THREE = getThreeInstance();
    if (!THREE || !Graph) return;
    
    // 如果已有光柱，移除它，确保全场只有一束追光
    if (activeBeam) {
        Graph.scene().remove(activeBeam);
    }
    
    // --- 爆发中心光晕特效（引起整个背景/中心变亮） ---
    // 利用 CSS 创建一层覆盖全局画面的高能耀斑，放在 3D 画布的上层
    const bgFlare = document.createElement('div');
    bgFlare.style.position = 'absolute';
    bgFlare.style.top = '0';
    bgFlare.style.left = '0';
    bgFlare.style.width = '100vw';
    bgFlare.style.height = '100vh';
    bgFlare.style.pointerEvents = 'none';
    bgFlare.style.zIndex = '999'; 
    // 辐射状光晕，中心亮白并逐渐向边缘扩散
    bgFlare.style.background = 'radial-gradient(circle at center, rgba(100, 180, 255, 0.25) 0%, rgba(255, 255, 255, 0.05) 40%, transparent 80%)';
    bgFlare.style.mixBlendMode = 'screen'; // 让光晕更柔和地叠加照亮背后的星空和节点
    bgFlare.style.opacity = '0';
    bgFlare.style.transition = 'opacity 0.4s ease-out';
    document.body.appendChild(bgFlare);
    
    // 下一帧触发淡入变亮
    requestAnimationFrame(() => {
        bgFlare.style.opacity = '1';
        // 维持短暂峰值后，缓慢淡出恢复原状
        setTimeout(() => {
            bgFlare.style.transition = 'opacity 1.5s ease-in';
            bgFlare.style.opacity = '0';
            // 动画彻底结束后销毁
            setTimeout(() => bgFlare.remove(), 1600);
        }, 600);
    });
    
    // 光柱高度和半径
    const beamHeight = 600;
    const topRadius = 35;
    const bottomRadius = 5; 
    
    // 创建一个逐渐变细的圆柱体，顶部大底部小，像探照灯
    const geometry = new THREE.CylinderGeometry(topRadius, bottomRadius, beamHeight, 32, 1, true);
    
    // 将几何体中心点向上偏移，使其原点对齐底部
    geometry.translate(0, beamHeight / 2, 0);

    const material = new THREE.MeshBasicMaterial({
        color: 0x44aaff,       // 科幻感的青蓝色光芒
        transparent: true,
        opacity: 0.0,          // 初始透明度0，准备淡入
        blending: THREE.AdditiveBlending, // 加法混合，让光柱叠加更加耀眼
        depthWrite: false,     // 不遮挡背后的星星
        side: THREE.DoubleSide
    });

    const beam = new THREE.Mesh(geometry, material);
    
    // 创建一盏聚光灯绑定在光柱顶部，真实照亮下方的球体
    const spotLight = new THREE.SpotLight(0xffffff, 0); // 初始亮度0
    spotLight.position.set(0, beamHeight, 0); // 相对光柱内部的顶部
    spotLight.target = beam;                  // 指向光柱底部原点
    spotLight.angle = Math.PI / 10;
    spotLight.penumbra = 0.5;
    spotLight.distance = beamHeight * 1.5;
    beam.add(spotLight); 

    const startTime = Date.now();
    const duration = 2500; // 持续 2.5 秒

    beam.userData.animate = function() {
        const elapsed = Date.now() - startTime;
        if (elapsed > duration) {
            Graph.scene().remove(beam);
            return false; // 动画结束，销毁光柱
        }
        
        let p = elapsed / duration;
        // 前 20% 时间(0.5秒)从 0 变到 0.35 极限透明度；后 80% 时间逐渐变暗
        let targetOpacity = p < 0.2 ? (p / 0.2) * 0.35 : (1 - (p - 0.2) / 0.8) * 0.35;
        beam.material.opacity = targetOpacity;
        spotLight.intensity = targetOpacity * 50; // 同步照亮底下的球体
        
        // 实时跟随节点的坐标，防止节点在物理引擎中晃动时光柱脱离
        beam.position.set(node.x, node.y, node.z);
        
        return true;
    };
    
    Graph.scene().add(beam);
    activeBeam = beam;
    
    // 挂载到统一的动画循环中
    if (!beamAnimationId) {
        function renderLoop() {
            if (activeBeam) {
                const isAlive = activeBeam.userData.animate();
                if (!isAlive) activeBeam = null;
            }
            beamAnimationId = requestAnimationFrame(renderLoop);
        }
        renderLoop();
    }
}

/**
 * 关键修复：精确坐标偏移计算
 * 计算带偏移的相机位置和观察点
 * 目的是让节点显示在 (屏幕宽度 - 抽屉宽度) 的中心
 */
function calculateOffsetView(node, distance = 350) {
    const { x, y, z } = node;

    // 1. 计算从原点到节点的单位向量（方向）
    const dist = Math.hypot(x, y, z) || 1;
    const dir = { x: x / dist, y: y / dist, z: z / dist };

    // 2. 目标相机位置（在节点方向上向外延伸固定距离）
    const newCamPos = {
        x: x + dir.x * distance,
        y: y + dir.y * distance,
        z: z + dir.z * distance
    };

    // 3. 计算水平偏移量
    const screenWidth = window.innerWidth;
    const drawerElement = document.getElementById('drawer');
    const drawerVisible = drawerElement && !drawerElement.classList.contains('drawer-hidden');
    
    let lookAtPos = { x, y, z };

    if (drawerVisible && screenWidth > DRAWER_WIDTH) {
        // 目标：节点向左移动 抽屉宽度的一半
        const offsetRatio = (DRAWER_WIDTH / 2) / screenWidth;
        
        // 计算相机当前视锥宽度
        const camera = Graph.camera();
        if (camera) {
            const fovRad = (camera.fov * Math.PI) / 180;
            const viewHeight = 2 * Math.tan(fovRad / 2) * distance;
            const viewWidth = viewHeight * camera.aspect;

            const worldOffset = viewWidth * offsetRatio;

            // 计算 right 向量
            const lookDir = new THREE.Vector3(-dir.x, -dir.y, -dir.z); // 假设相机从外看向原点方向
            const up = new THREE.Vector3(0, 1, 0);
            let right = new THREE.Vector3().crossVectors(lookDir, up).normalize();
            if (right.lengthSq() < 0.01) {
                right.crossVectors(lookDir, new THREE.Vector3(1, 0, 0)).normalize();
            }

            // lookAt 向右偏移，同时相机也向右偏移，保证视线垂直于屏幕
            lookAtPos = {
                x: x + right.x * worldOffset,
                y: y + right.y * worldOffset,
                z: z + right.z * worldOffset
            };
            
            newCamPos.x += right.x * worldOffset;
            newCamPos.y += right.y * worldOffset;
            newCamPos.z += right.z * worldOffset;
        }
    }

    return { camPos: newCamPos, lookAt: lookAtPos };
}

/**
 * 打开图片全屏模态框
 */
function openImageModal(imageUrl) {
    const modal = document.getElementById('image-modal');
    const fullImage = document.getElementById('full-image');
    
    if (modal && fullImage) {
        fullImage.src = imageUrl;
        modal.classList.remove('modal-hidden');
        
        // 添加点击模态框外部关闭的功能
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeImageModal();
            }
        });
        
        // 添加ESC键关闭功能
        const handleEscKey = function(e) {
            if (e.key === 'Escape') {
                closeImageModal();
                document.removeEventListener('keydown', handleEscKey);
            }
        };
        document.addEventListener('keydown', handleEscKey);
    }
}

/**
 * 关闭图片全屏模态框
 */
function closeImageModal() {
    const modal = document.getElementById('image-modal');
    if (modal) {
        modal.classList.add('modal-hidden');
    }
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

// Tooltip延迟隐藏相关变量
let hoverTimeout = null;
const HOVER_DELAY = 500; // 500毫秒延迟

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

/**
 * 增量更新函数：修复不长胖的核心
 */
function updateNodeIncremental(data) {
    if (!data) return;
    const list = Array.isArray(data) ? data : [data];
    
    // 获取当前图表中的节点
    let graphNodes = [];
    if (Graph) {
        graphNodes = Graph.graphData().nodes;
    }
    
    list.forEach(uNode => {
        // 1. 首先尝试使用serial_id
        const sid = uNode.serial_id || uNode["本事件ID"];
        // 2. 如果找不到，尝试使用node_id
        const nid = uNode.node_id || uNode["本事件标题"];
        const newWeight = uNode.survival_weight || uNode["本事件权重"];
        
        // 尝试多种查找方式更新缓存
        let cacheNode = nodeCache[sid] || nodeCache[nid];
        if (!cacheNode) {
            for (const key in nodeCache) {
                const cachedNode = nodeCache[key];
                if (cachedNode.serial_id === sid || cachedNode.node_id === nid) {
                    cacheNode = cachedNode;
                    break;
                }
            }
        }
        
        if (cacheNode) {
            if (newWeight !== undefined) {
                console.log(`[SocketIO] 增量更新缓存节点: ${cacheNode.node_id}，权重变为: ${newWeight}`);
                cacheNode.survival_weight = parseFloat(newWeight);
            }
            cacheNode.node_id = nid;
            cacheNode.serial_id = sid;
            if (uNode.event_tuple) cacheNode.event_tuple = uNode.event_tuple;
            if (uNode.action_tag) cacheNode.action_tag = uNode.action_tag;
            if (uNode.block_tag) cacheNode.block_tag = uNode.block_tag;
        } else {
            console.warn(`[SocketIO] 警告：未找到缓存节点，serial_id: ${sid}, node_id: ${nid}`);
        }
        
        // 【关键修复1】同步更新 Graph 内部的节点数据引用，否则引擎读取的永远是旧数据
        if (graphNodes.length > 0) {
            const gNode = graphNodes.find(n => n.serial_id === sid || n.id === nid || n.node_id === nid);
            if (gNode) {
                if (newWeight !== undefined) {
                    gNode.survival_weight = parseFloat(newWeight);
                }
                if (uNode.event_tuple) gNode.event_tuple = uNode.event_tuple;
                if (uNode.action_tag) gNode.action_tag = uNode.action_tag;
                if (uNode.block_tag) gNode.block_tag = uNode.block_tag;
                
                // 如果当前节点正显示在抽屉里，同时更新抽屉界面的进度条
                const isCurrentlySelected = (currentSelectedNodeId === gNode.id || currentSelectedNodeId === gNode.node_id);
                if (isCurrentlySelected) {
                    const weightValueField = document.getElementById('d-weight-value');
                    if (weightValueField) weightValueField.textContent = parseFloat(gNode.survival_weight || 0).toFixed(4);
                    const weightBar = document.getElementById('d-weight-bar');
                    if (weightBar) weightBar.style.width = `${Math.min((gNode.survival_weight || 0) * 100, 100)}%`;
                }

                // 【核心修复3：平滑的三维视觉缩放】直接操作 Three.js Mesh，杜绝全图重绘导致抖动
                if (gNode.__threeObj) {
                    const MIN_RADIUS = 1.2;
                    const MAX_RADIUS = 7;
                    const REL_SIZE = 7;
                    const w = Math.max(0, Math.min(1, parseFloat(gNode.survival_weight || 0)));
                    const newRadius = MIN_RADIUS + (w * (MAX_RADIUS - MIN_RADIUS));
                    const targetPhysicalRadius = newRadius * REL_SIZE;
                    
                    const sphere = gNode.__threeObj.children[0];
                    if (sphere && sphere.geometry) {
                        const originalRadius = sphere.geometry.parameters.radius;
                        const scale = targetPhysicalRadius / originalRadius;
                        sphere.scale.set(scale, scale, scale);
                    }
                    
                    const sprite = gNode.__threeObj.children[1];
                    if (sprite && sprite.material && sprite.material.map) {
                        const baseScale = Math.max(0.3, Math.min(0.6, 0.55 - (w * 0.2)));
                        sprite.scale.set(sprite.material.map.baseWidth * baseScale, sprite.material.map.baseHeight * baseScale, 1);
                    }
                }

                // 【核心修复4：全局寻踪视角跃迁与防抖机制】
                // 仅当：当前无抽屉处于打开状态，且不在寻龙中，且距离上次本地手动操作已超过 3 秒，才允许远端API驱动的相机跃迁
                const now = Date.now();
                const isLocalActionCooling = (now - lastLocalActionTime) < 3000;
                const drawerElement = document.getElementById('drawer');
                const isDrawerOpen = drawerElement && !drawerElement.classList.contains('drawer-hidden');
                
                // 为了避免被轻微的权重提升误导，仅对权重显著增加的节点触发远端跃迁
                const isSignificantWeight = (parseFloat(newWeight || 0) >= 0.4);
                
                if (!isCurrentlySelected && !isDrawerOpen && !isDragonCruising && !isLocalActionCooling && isSignificantWeight && Graph) {
                    
                    // 防抖：如果2秒内已经跃迁过，则忽略，避免链路上的批量更新引发视角震荡
                    if (now - lastRemoteJumpTime > 2000) {
                        lastRemoteJumpTime = now;
                        
                        selectedNodeObj = gNode; 
                        
                        const { camPos, lookAt } = calculateOffsetView(gNode, 350);
                        
                        // 2秒的平滑相机移动
                        Graph.cameraPosition(
                            camPos, 
                            lookAt, 
                            2000
                        );
                        
                        // 给这颗跃迁的星星降下一束神圣光柱
                        showDivineBeam(gNode);
                        
                        // 给这颗跃迁的星星来点高亮视觉反馈
                        highlightNodes.clear();
                        highlightNodes.add(gNode);
                        updateHighlight();
                        
                        // 3秒后自动取消高亮
                        setTimeout(() => {
                            highlightNodes.clear();
                            updateHighlight();
                        }, 3000);
                    }
                }
            }
        }
    });
}

function initSocketHandlers() {
    if (!window.socket) return;
    
    window.socket.on('node_updated', (data) => {
        nodeCache[data.node_id] = data;
        // 使用增量更新而不是全量刷新，保留节点坐标，防止重绘抖动
        updateNodeIncremental(data);
    });
    
    window.socket.on('node_created', (data) => {
        nodeCache[data.node_id] = data;
        loadInitialData(); // 新节点增加需要拓扑刷新
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
            
            // 添加点击事件：点击缩略图打开全屏模态框
            previewImg.onclick = function() {
                openImageModal(imageUrl);
            };
            
            // 添加CSS样式使缩略图可点击
            previewImg.style.cursor = 'pointer';
            previewImg.title = '点击查看大图';
        } else {
            imagePreview.classList.add('hidden');
        }
    }
    
    // 打开抽屉
    document.getElementById('drawer').classList.remove('drawer-hidden');
    
    // 隐藏展开按钮
    const expandBtn = document.getElementById('btn-expand-drawer');
    if (expandBtn) expandBtn.classList.add('hidden');
    
    // 调试输出：抽屉打开时的状态
    console.log(`[抽屉调试] 抽屉已打开，节点ID: ${nodeId}`);
    // 隐藏btn-toggle-search按钮，确保抽屉打开时搜索图标不可见
    
    
    
    // 检查搜索图标按钮的CSS样式
    const searchToggle = document.querySelector('#btn-toggle-search.search-toggle');
    searchToggle.style.display = 'none'; // 强制隐藏搜索图标按钮，确保抽屉打开时不可见
    
    console.log(`[抽屉调试] 搜索面板状态:`, {
        searchPanel: document.getElementById('search-panel'),
        searchToggle: document.querySelector('#search-panel .search-toggle'),
        searchToggleDisplay: document.querySelector('#search-panel .search-toggle')?.style.display || '未找到'
    });
    
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
    
    // 隐藏展开按钮
    const expandBtn = document.getElementById('btn-expand-drawer');
    if (expandBtn) expandBtn.classList.add('hidden');
    
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
    // 恢复搜索图标按钮显示
    const searchToggle = document.querySelector('#btn-toggle-search.search-toggle');
    if (searchToggle) {
        searchToggle.style.display = 'flex'; // 强制显示搜索图标按钮，确保抽屉关闭时可见
    }

}

function collapseDrawer() {
    document.getElementById('drawer').classList.add('drawer-hidden');
    const expandBtn = document.getElementById('btn-expand-drawer');
    if (expandBtn) expandBtn.classList.remove('hidden');
    
    // 恢复搜索图标按钮显示
    const searchToggle = document.querySelector('#btn-toggle-search.search-toggle');
    if (searchToggle) {
        searchToggle.style.display = 'flex';
    }
    
    // 触发逆向还原动画（相机回中）
    if (selectedNodeObj && Graph) {
        lastLocalActionTime = Date.now(); // 更新保护时间，避免动画被打断
        const { camPos, lookAt } = calculateOffsetView(selectedNodeObj, 350);
        Graph.cameraPosition(camPos, lookAt, 800); // 800ms 平滑回中
    }
}

function expandDrawer() {
    document.getElementById('drawer').classList.remove('drawer-hidden');
    const expandBtn = document.getElementById('btn-expand-drawer');
    if (expandBtn) expandBtn.classList.add('hidden');
    
    // 隐藏搜索图标按钮
    const searchToggle = document.querySelector('#btn-toggle-search.search-toggle');
    if (searchToggle) {
        searchToggle.style.display = 'none';
    }
    
    // 触发避让动画（相机向左偏）
    if (selectedNodeObj && Graph) {
        lastLocalActionTime = Date.now(); // 更新保护时间，避免动画被打断
        const { camPos, lookAt } = calculateOffsetView(selectedNodeObj, 350);
        Graph.cameraPosition(camPos, lookAt, 800); // 800ms 平滑避让
    }
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
        
        const { camPos, lookAt } = calculateOffsetView(node, 350);
        
        console.log(`[因果巡航] 相机目标位置:`, camPos);
        console.log(`[因果巡航] 开始移动相机到节点 ${node.id}...`);
        
        // 给当前巡航的星星降下一束神圣光柱
        showDivineBeam(node);

        await new Promise(resolve => {
            Graph.cameraPosition(
                camPos, 
                lookAt, 
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

    lastLocalActionTime = Date.now(); // 记录操作时间，屏蔽远端跃迁干扰

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
    // 使用全局精确坐标偏移计算
    const { camPos, lookAt } = calculateOffsetView(node, 350);
    
    // 降下一束神圣光柱
    showDivineBeam(node);

    Graph.cameraPosition(
        camPos, 
        lookAt, 
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

/**
 * 寻龙：又贞/对贞功能
 * 参考index.html中的deriveNode函数实现
 */
function deriveNode(tag) {
    if (!currentSelectedNodeId) {
        showSelectionHint('请先选择一个节点作为父节点');
        return;
    }
    
    // 使用现有的模态框，而不是动态创建新的
    const modal = document.getElementById('derive-modal');
    if (!modal) {
        console.error('[寻龙] 错误：未找到derive-modal模态框');
        showSelectionHint('系统错误：未找到模态框');
        return;
    }
    
    // 更新模态框标题
    const titleElement = document.getElementById('derive-title');
    if (titleElement) {
        titleElement.textContent = `寻龙：${tag}（基于: ${currentSelectedNodeId}）`;
    }
    
    // 清空表单字段
    document.getElementById('derive-node-id').value = '';
    document.getElementById('derive-action-tag').value = tag;
    document.getElementById('derive-event-tuple').value = '';
    document.getElementById('derive-image-file').value = '';
    // 注意：HTML中没有derive-full-image-url字段，已移除
    
    // 重置因缘标签选项
    const blockTagSelect = document.getElementById('derive-block-tag');
    if (blockTagSelect) {
        if (tag === '又贞') {
            blockTagSelect.innerHTML = `
                <option value="">请选择因缘标签</option>
                <option value="因">因 (原因/起因)</option>
                <option value="相">相 (现象/状态)</option>
            `;
            blockTagSelect.disabled = false;
        } else if (tag === '对贞') {
            blockTagSelect.innerHTML = `
                <option value="果" selected>果 (结果/成果)</option>
            `;
            blockTagSelect.disabled = true;
        }
    }
    
    // 隐藏图片预览
    const imagePreview = document.getElementById('derive-image-preview');
    if (imagePreview) {
        imagePreview.classList.add('hidden');
    }
    const previewImg = document.getElementById('derive-preview-img');
    if (previewImg) {
        previewImg.src = '';
    }
    
    // 显示模态框
    modal.classList.remove('modal-hidden');
    
    console.log(`[寻龙] 打开${tag}模态框，基于节点: ${currentSelectedNodeId}`);
}

/**
 * 关闭寻龙模态框
 */
function closeDeriveModal() {
    const modal = document.getElementById('derive-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * 提交寻龙节点创建
 * 参考index.html中的submitDeriveNode函数实现
 */
async function submitDeriveNode(tag, parentId) {
    const nodeId = document.getElementById('derive-node-id').value.trim();
    const blockTag = document.getElementById('derive-block-tag').value;
    const eventTuple = document.getElementById('derive-event-tuple').value.trim();
    const imageFile = document.getElementById('derive-image-file').files[0];
    
    if (!nodeId) {
        showSelectionHint('卜辞不能为空！');
        return;
    }
    
    if (!blockTag) {
        showSelectionHint('因缘标签不能为空！');
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
            
            console.log('[寻龙] 上传图片...');
            const uploadResponse = await fetch('/api/v1/causal/upload', {
                method: 'POST',
                body: formData
            });
            
            const uploadData = await uploadResponse.json();
            if (uploadData.status === 'success') {
                fullImageUrl = uploadData.data.url;
                console.log('[寻龙] 图片上传成功:', fullImageUrl);
            } else {
                console.error('[寻龙] 图片上传失败:', uploadData.message);
                showSelectionHint('图片上传失败：' + uploadData.message);
                return;
            }
        } catch (error) {
            console.error('[寻龙] 图片上传异常:', error);
            showSelectionHint('图片上传失败：' + error.message);
            return;
        }
    }
    
    // 提交创建请求
    const requestData = { 
        node_id: nodeId, 
        block_tag: blockTag,
        parent_id: [parentId],
        event_tuple: eventTuple, 
        action_tag: tag,
        full_image_url: fullImageUrl,
        actor_id: window.currentActorId,
        owner_id: window.currentOwnerId || 'default'
    };
    
    console.log('[寻龙] 提交创建请求:', requestData);
    
    try {
        const response = await fetch('/api/v1/causal/genesis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        console.log('[寻龙] API响应:', data);
        
        if (data.status === 'success') {
            showSelectionHint('事件创建成功！前端将通过Socket.IO实时更新。');
            closeDeriveModal();
        } else {
            showSelectionHint('创建失败：' + data.message);
        }
    } catch (error) {
        console.error('[寻龙] 创建请求异常:', error);
        showSelectionHint('创建失败：' + error.message);
    }
}

window.addEventListener('load', () => {
    const container = document.getElementById('3d-graph');

    // --- [1. 核心常量配置] ---
    const MIN_RADIUS = 1.2;  // 最小半径（改小）
    const MAX_RADIUS = 9.0;  // 最大半径（改大，增加视觉区分度）
    const REL_SIZE = 7;      // 引擎缩放系数
    const FOCUS_DIST = 350;  // 聚焦时的相机距离
    const DRAWER_WIDTH = 450; // 右侧抽屉宽度（像素）- 与正确版本一致

    // --- [2. 引擎初始化] ---
    Graph = ForceGraph3D()(container)
        .backgroundColor('rgba(0, 5, 10, 0.6)') // 半透明深色，让背景图透出
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
                // --- 恒星 (Star)：核心、发光、保留立体感与高光 ---
                material = new THREE.MeshStandardMaterial({
                    color: '#ffcc00',
                    emissive: '#ff6600',    // 自发光用偏橙色
                    emissiveIntensity: 0.4, // 降低自发光强度，避免掩盖明暗变化
                    metalness: 0.3,         // 增加金属感以反射光线
                    roughness: 0.2          // 降低粗糙度以获得明显高光
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
                // 标签大小控制：与节点权重成反比，权重越大标签相对越小
                // 基础缩放0.45，权重为1时缩放为0.35，权重为0时缩放为0.55
                // 同时设置最小缩放限制为0.3，最大缩放限制为0.6
                const baseScale = Math.max(0.3, Math.min(0.6, 0.55 - (weight * 0.2)));
                sprite.scale.set(texture.baseWidth * baseScale, texture.baseHeight * baseScale, 1);
                
                // 位置：紧贴在当前星球表面上方，让不同大小星球的标签高低错落，极具震撼的体积差异
                sprite.position.y = actualPhysicalRadius + 14; 
                group.add(sprite);
            }

            return group;
        })

        // --- [4. 交互：抽屉避让聚焦算法] ---
        .onNodeClick(node => {
            if (!node) return;

            lastLocalActionTime = Date.now(); // 记录操作时间，屏蔽远端跃迁干扰

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
            
            // 使用精确坐标偏移计算
            const { camPos, lookAt } = calculateOffsetView(node, 350);
            
            Graph.cameraPosition(camPos, lookAt, 1200);

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
            let eventTuple = node.event_tuple || node.content || '无事件叙述';
            // 获取权重状态描述（参照index.html中的getWeightStatus函数）
            const weightValue = parseFloat(weight);
            let weightStatus = '微弱';
            if (weightValue >= 0.9) weightStatus = '强盛';
            else if (weightValue >= 0.7) weightStatus = '活跃';
            else if (weightValue >= 0.5) weightStatus = '稳定';
            else if (weightValue >= 0.3) weightStatus = '衰减';
            
            // 对事件叙述进行字符截取，最多显示150个字符
            const maxLength = 250;
            if (eventTuple.length > maxLength) {
                eventTuple = eventTuple.substring(0, maxLength) + '...';
            }
            
            // 简化tooltip：移除因缘标签、动作标签，移除装饰性样式
            return `<div class="force-graph-tooltip">
                <div class="tooltip-title">${node.id}</div>
                <div class="tooltip-simple">
                    <div class="tooltip-row">
                        <span class="tooltip-label">权重:</span>
                        <span class="tooltip-value weight-value">${weight}</span>
                        <span class="tooltip-status">(${weightStatus})</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">事件:</span>
                        <span class="tooltip-event-content">${eventTuple}</span>
                    </div>
                </div>
            </div>`;
        })
        .nodeColor(node => highlightNodes.has(node) ? '#ffffff' : '#444')
        .onNodeHover(node => {
            container.style.cursor = node ? 'pointer' : null;
            
            // 清除之前的定时器
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                hoverTimeout = null;
            }
            
            if (node) {
                // 鼠标进入节点：立即显示tooltip
                hoverNode = node;
                updateHighlight();
            } else {
                // 鼠标离开节点：延迟500毫秒隐藏tooltip
                hoverTimeout = setTimeout(() => {
                    hoverNode = null;
                    updateHighlight();
                    hoverTimeout = null;
                }, HOVER_DELAY);
            }
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
    
    // 绑定折叠/展开按钮
    const collapseBtn = document.getElementById('btn-collapse-drawer');
    if (collapseBtn) collapseBtn.onclick = collapseDrawer;
    
    const expandBtn = document.getElementById('btn-expand-drawer');
    if (expandBtn) expandBtn.onclick = expandDrawer;
    
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
    
    // 绑定又贞和对贞按钮事件
    const deriveYouzhenBtn = document.getElementById('btn-derive-youzhen');
    if (deriveYouzhenBtn) {
        deriveYouzhenBtn.onclick = function() {
            deriveNode('又贞');
        };
        console.log('[寻龙] 又贞按钮事件绑定成功');
    } else {
        console.warn('[寻龙] 警告：未找到btn-derive-youzhen按钮元素');
    }
    
    const deriveDuizhenBtn = document.getElementById('btn-derive-duizhen');
    if (deriveDuizhenBtn) {
        deriveDuizhenBtn.onclick = function() {
            deriveNode('对贞');
        };
        console.log('[寻龙] 对贞按钮事件绑定成功');
    } else {
        console.warn('[寻龙] 警告：未找到btn-derive-duizhen按钮元素');
    }
    
    // 绑定寻龙模态框取消和提交按钮事件
    const cancelDeriveBtn = document.getElementById('btn-cancel-derive');
    if (cancelDeriveBtn) {
        cancelDeriveBtn.onclick = function() {
            const modal = document.getElementById('derive-modal');
            if (modal) {
                modal.classList.add('modal-hidden');
            }
        };
        console.log('[寻龙] 取消按钮事件绑定成功');
    } else {
        console.warn('[寻龙] 警告：未找到btn-cancel-derive按钮元素');
    }
    
    const submitDeriveBtn = document.getElementById('btn-submit-derive');
    if (submitDeriveBtn) {
        submitDeriveBtn.onclick = function() {
            const actionTag = document.getElementById('derive-action-tag').value;
            if (actionTag && currentSelectedNodeId) {
                submitDeriveNode(actionTag, currentSelectedNodeId);
            } else {
                showSelectionHint('无法提交：缺少必要信息');
            }
        };
        console.log('[寻龙] 提交按钮事件绑定成功');
    } else {
        console.warn('[寻龙] 警告：未找到btn-submit-derive按钮元素');
    }
    
    // 绑定搜索面板交互功能
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
    
    // 搜索功能实现
    async function performSearch() {
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
                    owner_id: window.currentOwnerId || 'default',
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
        lastLocalActionTime = Date.now(); // 记录操作时间，屏蔽远端跃迁干扰
        
        try {
            // 调用点击事件API
            const requestData = { 
                serial_id: serialId,
                actor_id: window.currentActorId || '',
                owner_id: window.currentOwnerId || 'default'
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
                
                // 在3D图中高亮显示该节点
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
    
    // 在3D图中高亮显示搜索结果节点
    function highlightSearchResultNode(nodeId) {
        if (!Graph) return;
        
        const { nodes } = Graph.graphData();
        const targetNode = nodes.find(n => n.id === nodeId);
        
        if (targetNode) {
            // 设置节点为选中状态
            selectedNodeObj = targetNode;
            
            // 物理锁定节点
            targetNode.fx = targetNode.x;
            targetNode.fy = targetNode.y;
            targetNode.fz = targetNode.z;
            
            // 聚焦到该节点（但不打开抽屉）
            const { camPos, lookAt } = calculateOffsetView(targetNode, 350);
            
            // 降下一束神圣光柱
            showDivineBeam(targetNode);

            Graph.cameraPosition(camPos, lookAt, 1200);
            
            // 添加高亮效果
            highlightNodes.clear();
            highlightNodes.add(targetNode);
            updateHighlight();
            
            console.log(`[搜索高亮] 已高亮显示节点: ${nodeId}`);
        } else {
            console.warn(`[搜索高亮] 未在图中找到节点: ${nodeId}`);
        }
    }
    
    // 初始化 Socket 与 数据
    initSocketHandlers();
    loadInitialData();

    // --- [8. 父ID字段事件处理初始化] ---
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
    
    // 初始化父ID字段事件处理
    setupParentIdFieldEvents();

    // --- [9. 绑定图片模态框关闭按钮事件] ---
    const closeImageBtn = document.getElementById('btn-close-image');
    if (closeImageBtn) {
        closeImageBtn.onclick = closeImageModal;
        console.log('[图片模态框] 关闭按钮事件绑定成功');
    } else {
        console.warn('[图片模态框] 警告：未找到btn-close-image按钮元素');
    }

    // --- [9. 视图自适应业务] ---
    let resizeTimeout = null;
    window.addEventListener('resize', () => {
        if (!Graph) return;

        // 清除尚未执行的延迟 resize 任务
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
            resizeTimeout = null;
        }

        // 【关键修复】：防抖与动画保护机制
        // 发现：Graph.width() 和 Graph.height() 的调用会瞬间中断正在进行的 Graph.cameraPosition 动画！
        // 当抽屉首次打开时，可能因出现滚动条导致细微的 resize，从而立刻中断了飞行，导致需要“双击”。
        const now = Date.now();
        const timeSinceAction = now - lastLocalActionTime;
        
        if (timeSinceAction < 1500) {
            // 如果距离上次点击不到 1.5 秒（意味着 1200ms 的相机动画正在进行中）
            // 我们将把 resize 动作延后到动画彻底结束之后再执行，绝不让它强行中断飞行！
            resizeTimeout = setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 1500 - timeSinceAction);
            return; 
        }

        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;

        // 1. 更新底层 WebGL 画布的宽高
        Graph.width(newWidth).height(newHeight);

        // 2. 如果此时抽屉是展开状态且有选中的节点，需要重新校准相机的偏移量
        const drawer = document.getElementById('drawer');
        
        if (drawer && !drawer.classList.contains('drawer-hidden') && selectedNodeObj) {
            // 重新获取当前的屏幕宽度，并套用最新的精确偏移模型
            const { camPos, lookAt } = calculateOffsetView(selectedNodeObj, 350);
            
            // 使用过渡时间 0（瞬间完成），以避免拖拽窗口时产生严重的视觉延迟
            Graph.cameraPosition(camPos, lookAt, 0); 
        }
    });
});
