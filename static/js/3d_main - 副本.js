/**
 * 元龙检索 - 因果星空 (Causal Starry Sky) 全功能集成驱动 v2.2
 * 职责：3D 可视化引擎、因果链溯源、动态引力控制、节点 CRUD 管理
 * 注意：本脚本不需要任何防御性处理
 */

// --- [1. 全局状态管理] ---
let Graph = null;
const highlightNodes = new Set();
const highlightLinks = new Set();
const horizonNodes = new Set(); // 存储事件视界内的节点ID
let hoverNode = null;
let hoverScaleNode = null; // 追踪当前悬浮绽放的节点（非大股东节点的悬浮放大效果）
let currentSelectedNodeId = null; 
let is_change = true; // true: 编辑模式, false: 链入父ID模式
const is_edit_mode = new URLSearchParams(window.location.search).get('edit') === 'true'; // URL参数 edit=true 才允许编辑
let nodeCache = {};

// 根据 edit 参数控制编辑相关按钮的可见性
(function initEditModeUI() {
    const editElements = document.querySelectorAll('.edit-only, #btn-create-node');
    if (is_edit_mode) {
        editElements.forEach(el => el.classList.remove('hidden'));
        console.log('[编辑模式] edit=true，编辑按钮已显示');
    } else {
        editElements.forEach(el => el.classList.add('hidden'));
        console.log('[只读模式] edit 参数缺失或不为 true，编辑按钮已隐藏');
    }
})();

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

// 创世金光动画标记
window.pendingGenesisNodeId = null;

// --- [2. 核心辅助工具] ---

/**
 * 将真实权重转换为视觉权重
 * 哲学思考：新生节点（权重1.0）在视觉上不应喧宾夺主，将其视觉权重收敛为0.3
 */
function getVisualWeight(weight) {
    const w = Math.max(0, Math.min(1, parseFloat(weight || 0)));
    return w === 1.0 ? 0.3 : w;
}

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
 * 当节点居中时，从正上方降下一束强力神圣光柱聚焦于该节点，并引起全屏幕的背景变亮
 * @param {Object} node 目标节点
 */
function showDivineBeam(node, colorType = 'divine') {
    const THREE = getThreeInstance();
    if (!THREE || !Graph) return;
    
    // 如果已有光柱，移除它
    if (activeBeam) {
        Graph.scene().remove(activeBeam);
    }
    
    // --- 根据颜色类型决定主题色 ---
    let flareGradient = 'radial-gradient(circle at center, rgba(80, 160, 255, 0.25) 0%, rgba(60, 100, 255, 0.08) 40%, transparent 80%)';
    let outerColor = new THREE.Color(0xaaccff);
    let innerColor = new THREE.Color(0xffffff);
    let spotLightColor = 0xffffff;
    
    if (colorType === 'golden') {
        flareGradient = 'radial-gradient(circle at center, rgba(255, 215, 0, 0.35) 0%, rgba(255, 140, 0, 0.15) 40%, transparent 80%)';
        outerColor = new THREE.Color(0xffaa00); // 雄浑的纯金色
        innerColor = new THREE.Color(0xffffee); // 耀眼白金内核
        spotLightColor = 0xffcc00;              // 星体表面打金光
    }

    // --- 爆发中心光晕特效 ---
    const bgFlare = document.createElement('div');
    bgFlare.style.position = 'absolute';
    bgFlare.style.top = '0';
    bgFlare.style.left = '0';
    bgFlare.style.width = '100vw';
    bgFlare.style.height = '100vh';
    bgFlare.style.pointerEvents = 'none';
    bgFlare.style.zIndex = '999'; 
    bgFlare.style.background = flareGradient;
    bgFlare.style.mixBlendMode = 'screen'; 
    bgFlare.style.opacity = '0';
    bgFlare.style.transition = 'opacity 0.4s ease-out';
    document.body.appendChild(bgFlare);
    
    requestAnimationFrame(() => {
        bgFlare.style.opacity = '1';
        setTimeout(() => {
            bgFlare.style.transition = 'opacity 2.0s ease-in';
            bgFlare.style.opacity = '0';
            setTimeout(() => bgFlare.remove(), 2100);
        }, 800);
    });
    
    // --- 动态自适应光柱与物理引擎完美贴合 ---
    
    // 1. 获取目标节点在引擎中的确切物理半径
    const MIN_RADIUS = 1.2;
    const MAX_RADIUS = 9.0;
    const REL_SIZE = 7;
    const weight = getVisualWeight(node.survival_weight);
    const targetRadius = MIN_RADIUS + (weight * (MAX_RADIUS - MIN_RADIUS));
    const actualPhysicalRadius = targetRadius * REL_SIZE; // 这个值在 8.4 到 63 之间变化
    
    // 消除局限：将光柱高度提升至万级，确保其顶部永远在屏幕之外
    const beamHeight = 10000; 
    
    // 2. 动态计算光柱尺寸：根据节点类型与设备屏幕动态自适应算法
    let bottomRadius, topRadius;
    const isMobile = window.innerWidth < 768; // 判断是否为移动端窄屏

    // 底部半径精确贴合节点视觉半径（Sprite 缩放比例是 2.5，即半径是 1.25 倍）
    const visualRadius = actualPhysicalRadius * 1.25;
    bottomRadius = visualRadius * 0.7;

    // 顶部半径根据万级高度按比例放大，适当缩小上下宽度之差
    if (colorType === 'golden') {
        topRadius = bottomRadius + beamHeight * (isMobile ? 0.05 : 0.08);
    } else if (weight >= 0.6) {
        topRadius = bottomRadius + beamHeight * (isMobile ? 0.06 : 0.10);
    } else {
        topRadius = bottomRadius + beamHeight * (isMobile ? 0.03 : 0.05);
    }

    // 将圆柱体向下延伸，为更深的弧线和更宽的羽化区留出充足的渲染空间
    const extendedHeight = beamHeight + visualRadius * 2.0;
    const geo = new THREE.CylinderGeometry(topRadius, bottomRadius, extendedHeight, 32, 1, true);
    // 偏移几何体，使其底部位于 y = -visualRadius * 2.0
    geo.translate(0, extendedHeight / 2 - visualRadius * 2.0, 0);

    // 关键核心：利用自定义 Shader 产生基于法线视角的“边缘渐变羽化”效果，并计算向下鼓出的弧线
    const customMaterial = new THREE.ShaderMaterial({
        uniforms: {
            color: { value: outerColor },
            coreColor: { value: innerColor },
            globalOpacity: { value: 0.0 },
            bottomRadius: { value: bottomRadius },
            sphereRadius: { value: visualRadius }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vLocalPosition;
            void main() {
                vLocalPosition = position;
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            uniform vec3 coreColor;
            uniform float globalOpacity;
            uniform float bottomRadius;
            uniform float sphereRadius;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vLocalPosition;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                float dotVal = max(0.0, dot(normal, viewDir));
                float intensity = pow(dotVal, 1.0);
                vec3 finalColor = mix(color, coreColor, pow(dotVal, 1.8));
                
                // 计算向下鼓出的弧线遮罩
                float xRatio = clamp(vLocalPosition.x / bottomRadius, -1.0, 1.0);
                // 加深抛物线：最低点在 x=0 处，y = -sphereRadius * 1.2
                float curveY = -sphereRadius * 0.2 * (1.0 - xRatio * xRatio);
                
                // 极致柔和过渡区：扩大羽化范围，彻底消除生硬边缘
                float softZone = sphereRadius * 0.8;
                float alphaMask = smoothstep(curveY, curveY + softZone, vLocalPosition.y);
                
                gl_FragColor = vec4(finalColor, intensity * globalOpacity * alphaMask);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false, // 确保圣光在最上层，不被其他节点遮挡
        side: THREE.DoubleSide
    });

    const beamMesh = new THREE.Mesh(geo, customMaterial);
    beamMesh.renderOrder = 999; // 确保最后渲染，位于最上层
    
    // 记录节点ID和颜色类型，以便后续动态更新尺寸
    beamMesh.userData.nodeId = node.id || node.node_id;
    beamMesh.userData.colorType = colorType;
    beamMesh.userData.beamHeight = beamHeight;
    
    // 3. 动态精准计算聚光灯照射角
    // 使用三角函数精确计算：为了完美覆盖目标半径区域（不溢出），灯光张开弧度的一半为 atan(bottomRadius / beamHeight)
    const exactLightAngle = Math.atan(bottomRadius / beamHeight);
    
    // 聚光灯：仅用于照亮下方的星球。边缘极限柔和
    const spotLight = new THREE.SpotLight(spotLightColor, 0); 
    spotLight.position.set(0, beamHeight, 0); 
    spotLight.target = beamMesh;                  
    spotLight.angle = exactLightAngle; 
    spotLight.penumbra = 1.0;       // 照射边缘极限柔和衰减，杜绝生硬切割感
    spotLight.distance = beamHeight * 1.5;
    beamMesh.add(spotLight); 

    const startTime = Date.now();
    const duration = 3500; 

    beamMesh.userData.animate = function() {
        const elapsed = Date.now() - startTime;
        if (elapsed > duration) {
            Graph.scene().remove(beamMesh);
            return false; 
        }
        
        let p = elapsed / duration;
        // 呼吸感：0.5秒爆发至 1.0 的最大不透明度，后缓慢变暗
        let intensityFactor = p < 0.15 ? (p / 0.15) : (1 - (p - 0.15) / 0.85);
        
        // 传递透明度到 Shader
        customMaterial.uniforms.globalOpacity.value = intensityFactor * 0.9;
        
        // 同步照亮球体：恢复光照强度，平衡明暗视觉冲击力
        spotLight.intensity = intensityFactor * 65; 
        
        // 1. 位置跟随节点
        beamMesh.position.set(node.x, node.y, node.z);
        
        // 2. 方向绝对锁定：将光柱的旋转与相机的旋转实时绑定
        // 这样光柱的 Y 轴（向上延伸的方向）将永远对齐屏幕的正上方
        const camera = Graph.camera();
        if (camera) {
            beamMesh.quaternion.copy(camera.quaternion);
        }
        
        return true;
    };
    
    Graph.scene().add(beamMesh);
    activeBeam = beamMesh;
    
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
    // 移动端自适应：仅在窄屏下自动拉远相机，防止巨星节点撑爆屏幕
    const isMobile = window.innerWidth < 768;
    let actualDistance = distance;
    
    if (isMobile) {
        // 根据节点权重(大小)动态决定拉远距离：节点越大，拉得越远
        const weight = getVisualWeight(node.survival_weight);
        // 移动端基础距离 450，满权重巨星最大拉远至 650
        const mobileDistance = 450 + (weight * 200);
        actualDistance = Math.max(distance, mobileDistance);
    }

    const { x, y, z } = node;

    // 1. 计算从原点到节点的单位向量（方向）
    const dist = Math.hypot(x, y, z) || 1;
    const dir = { x: x / dist, y: y / dist, z: z / dist };

    // 2. 目标相机位置（在节点方向上向外延伸固定距离）
    const newCamPos = {
        x: x + dir.x * actualDistance,
        y: y + dir.y * actualDistance,
        z: z + dir.z * actualDistance
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
            const viewHeight = 2 * Math.tan(fovRad / 2) * actualDistance;
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
    const colorMap = { '贞': '#836e28', '又贞': '#10b981', '对贞': '#3b82f6' };
    const baseColor = colorMap[node.action_tag] || '#64748b';
    
    // 获取节点权重
    const weight = getVisualWeight(node.survival_weight);
    
    // 亮度与权重成正比：权重越高，颜色越亮
    // 权重范围：0.0 - 1.0，亮度范围：0.6 - 1.1
    const brightness = 0.6 + (weight * 0.5); // 0.6 - 1.1
    
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
        
    // 更新事件视界虚化效果
    updateEventHorizonVisibility();
}

/** 更新事件视界可见性（虚化湮灭效果） */
function updateEventHorizonVisibility() {
    if (!Graph) return;
    
    const { nodes } = Graph.graphData();
    const hasHorizon = horizonNodes.size > 0;
    
    nodes.forEach(node => {
        if (node.__threeObj) {
            const sphere = node.__threeObj.children[0];
            const sprite = node.__threeObj.children[1];
            
            const weight = getVisualWeight(node.survival_weight);
            const baseOpacity = 0.4 + weight * 0.6;
            
            if (hasHorizon && !horizonNodes.has(node.id)) {
                // 视界外：虚化湮灭（在基础透明度上再降低）
                const dimmedOpacity = baseOpacity * 0.3;
                if (sphere && sphere.material) {
                    sphere.material.transparent = true;
                    sphere.material.opacity = dimmedOpacity;
                }
                if (sprite && sprite.material) {
                    sprite.material.opacity = dimmedOpacity;
                }
            } else {
                // 视界内或无视界（上帝视角）：恢复基础透明度
                if (sphere && sphere.material) {
                    sphere.material.transparent = true;
                    const duty = node.action_tag;
                    if (duty === '又贞') {
                        sphere.material.opacity = baseOpacity * 0.85;
                    } else {
                        sphere.material.opacity = baseOpacity;
                    }
                }
                if (sprite && sprite.material) {
                    sprite.material.opacity = baseOpacity;
                }
            }
        }
    });
}

/**
 * 悬浮绽放：非大股东节点悬浮时平滑放大 + 低透明度提升
 * 利用 Tween.js 实现动画，不修改连线逻辑
 * @param {Object} node 被悬浮的节点
 */
function hoverScaleNodeBloom(node) {
    if (!node || !node.__threeObj) return;
    const THREE = getThreeInstance();
    if (!THREE) return;

    const sphere = node.__threeObj.children[0];
    const sprite = node.__threeObj.children[1];
    const BLOOM_SCALE = 1.35; // 放大倍数
    const DURATION = 250;     // 动画时长 ms
    
    // 保存当前 scale，作为动画起点
    if (!node._origScale) {
        node._origScale = {
            sphere: sphere ? sphere.scale.clone() : new THREE.Vector3(1, 1, 1),
            sprite: sprite ? sprite.scale.clone() : new THREE.Vector3(1, 1, 1)
        };
    }
    
    // 若 sphere 当前 opacity 很低（如被视界湮灭），将其提升至 0.65
    if (sphere && sphere.material) {
        const currentOpacity = sphere.material.opacity;
        if (currentOpacity < 0.5) {
            sphere.material.transparent = true;
            node._origOpacity = currentOpacity;
            new TWEEN.Tween({ opacity: currentOpacity })
                .to({ opacity: 0.65 }, DURATION)
                .easing(TWEEN.Easing.Quadratic.Out)
                .onUpdate(obj => { sphere.material.opacity = obj.opacity; })
                .start();
        }
    }
    
    // Sphere 绽放
    if (sphere) {
        const orig = node._origScale.sphere;
        new TWEEN.Tween({ x: orig.x, y: orig.y, z: orig.z })
            .to({ x: orig.x * BLOOM_SCALE, y: orig.y * BLOOM_SCALE, z: orig.z * BLOOM_SCALE }, DURATION)
            .easing(TWEEN.Easing.Back.Out)
            .onUpdate(obj => { sphere.scale.set(obj.x, obj.y, obj.z); })
            .start();
    }
    
    // Sprite 同步绽放
    if (sprite) {
        const orig = node._origScale.sprite;
        new TWEEN.Tween({ x: orig.x, y: orig.y, z: orig.z })
            .to({ x: orig.x * BLOOM_SCALE, y: orig.y * BLOOM_SCALE, z: orig.z * BLOOM_SCALE }, DURATION)
            .easing(TWEEN.Easing.Back.Out)
            .onUpdate(obj => { sprite.scale.set(obj.x, obj.y, obj.z); })
            .start();
    }
}

/**
 * 悬浮还原：平滑恢复到原始大小和不透明度
 * @param {Object} node 被还原的节点
 */
function hoverScaleNodeRebound(node) {
    if (!node || !node.__threeObj) return;
    const THREE = getThreeInstance();
    if (!THREE) return;

    const sphere = node.__threeObj.children[0];
    const sprite = node.__threeObj.children[1];
    const DURATION = 300;

    // 恢复 opacity
    if (sphere && sphere.material && node._origOpacity !== undefined) {
        const currentOpacity = sphere.material.opacity;
        const targetOpacity = node._origOpacity;
        new TWEEN.Tween({ opacity: currentOpacity })
            .to({ opacity: targetOpacity }, DURATION)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(obj => { sphere.material.opacity = obj.opacity; })
            .onComplete(() => {
                // 保持 transparent 为 true，因为现在透明度与权重成正比
            })
            .start();
        delete node._origOpacity;
    }

    // 恢复 sphere scale（使用该节点被增量更新时的最新值，而非缓存的 _origScale）
    // 因为权重增量更新可能已改变了 scale，所以需要动态还原
    if (sphere && node._origScale && node._origScale.sphere) {
        const target = node._origScale.sphere;
        new TWEEN.Tween({ x: sphere.scale.x, y: sphere.scale.y, z: sphere.scale.z })
            .to({ x: target.x, y: target.y, z: target.z }, DURATION)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(obj => { sphere.scale.set(obj.x, obj.y, obj.z); })
            .start();
    }

    if (sprite && node._origScale && node._origScale.sprite) {
        const target = node._origScale.sprite;
        new TWEEN.Tween({ x: sprite.scale.x, y: sprite.scale.y, z: sprite.scale.z })
            .to({ x: target.x, y: target.y, z: target.z }, DURATION)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(obj => { sprite.scale.set(obj.x, obj.y, obj.z); })
            .onComplete(() => {
                // 清理缓存的 scale，为下次 hover 准备
                delete node._origScale;
            })
            .start();
    } else if (node._origScale) {
        delete node._origScale;
    }
}

// Tooltip延迟隐藏相关变量
let hoverTimeout = null;
const HOVER_DELAY = 500; // 500毫秒延迟

/** 超采样文字纹理渲染：确保 ID 极致清晰，使用2的幂次方尺寸避免警告 */
function createTextTexture(text, weight, THREE) {
    // 截断过长的节点标签
    const MAX_LENGTH = 10;
    let displayText = text;
    if (text && text.length > MAX_LENGTH) {
        displayText = text.substring(0, MAX_LENGTH) + '...';
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = 4;
    ctx.font = `${32 * scale}px "Fira Code"`;
    const textWidth = ctx.measureText(displayText).width;
    const padding = 6 * scale; // 增加padding让底座更好看
    
    // 计算2的幂次方尺寸，避免THREE调整警告
    const calculatePowerOfTwo = (size) => {
        return Math.pow(2, Math.ceil(Math.log2(size)));
    };
    
    const rawWidth = textWidth + padding * 2;
    const rawHeight = 44 * scale; 
    
    // 使用2的幂次方尺寸
    canvas.width = calculatePowerOfTwo(rawWidth);
    canvas.height = calculatePowerOfTwo(rawHeight);
    
    // 计算居中位置
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // 绘制半透明微光底座
    const bgWidth = textWidth + padding * 1.5;
    const bgHeight = 38 * scale;
    const bgX = centerX - bgWidth / 2;
    const bgY = centerY - bgHeight / 2;
    const radius = 8 * scale;
    
    ctx.fillStyle = 'rgba(0, 5, 15, 0.45)'; // 极柔和的半透明底座
    ctx.beginPath();
    ctx.moveTo(bgX + radius, bgY);
    ctx.lineTo(bgX + bgWidth - radius, bgY);
    ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + radius);
    ctx.lineTo(bgX + bgWidth, bgY + bgHeight - radius);
    ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - radius, bgY + bgHeight);
    ctx.lineTo(bgX + radius, bgY + bgHeight);
    ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius);
    ctx.lineTo(bgX, bgY + radius);
    ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
    ctx.closePath();
    ctx.fill();
    
    ctx.font = `${32 * scale}px "Fira Code"`;
    
    // 标签亮度与权重成正比：权重越高，标签越亮
    // 权重范围：0.0 - 1.0，亮度范围：0.5 - 0.9 (压低亮度)
    const weightValue = getVisualWeight(weight);
    const brightness = 0.5 + (weightValue * 0.4); 
    
    // 根据亮度计算颜色值
    const colorValue = Math.floor(255 * brightness);
    const textColor = `rgb(${colorValue}, ${colorValue}, ${colorValue})`;
    
    // 添加黑色发光阴影，确保在明亮星云背景下依然清晰可读
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1.5 * scale;
    
    ctx.fillStyle = textColor; 
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'middle';
    
    // 绘制两次文字以增强阴影的厚重感
    ctx.fillText(displayText, centerX, centerY);
    ctx.fillText(displayText, centerX, centerY);
    
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
                        links.push({ source: pId, target: nodeData.node_id, type: 'causal' });
                    }
                });
            });
            
            // 构建语义连线 (semantic)
            if (res.semantic_links && res.semantic_links.length > 0) {
                let validSemanticLinks = 0;
                res.semantic_links.forEach(link => {
                    if (nodeById[link.source] && nodeById[link.target]) {
                        links.push({
                            source: link.source,
                            target: link.target,
                            type: 'semantic',
                            similarity: link.similarity
                        });
                        validSemanticLinks++;
                    } else {
                        console.warn(`[3D星空] 语义连线节点不存在: source=${link.source}, target=${link.target}`);
                    }
                });
                console.log(`[3D星空] 接收到 ${res.semantic_links.length} 条语义连线，有效连线 ${validSemanticLinks} 条`);
                if (validSemanticLinks > 0) {
                    console.log(`[3D星空] 示例语义连线:`, links.filter(l => l.type === 'semantic').slice(0, 3));
                }
            }

            console.log(`[3D星空] 最终图谱数据: nodes=${nodes.length}, links=${links.length}`);
            Graph.graphData({ nodes, links });
            
            // 检查是否有 NaN 坐标
            setTimeout(() => {
                const currentNodes = Graph.graphData().nodes;
                const nanNodes = currentNodes.filter(n => isNaN(n.x) || isNaN(n.y) || isNaN(n.z));
                if (nanNodes.length > 0) {
                    console.error(`[3D星空] 发现 ${nanNodes.length} 个节点坐标为 NaN!`, nanNodes.slice(0, 5));
                    // 修复 NaN 坐标
                    nanNodes.forEach(n => {
                        n.x = Math.random() * 100 - 50;
                        n.y = Math.random() * 100 - 50;
                        n.z = Math.random() * 100 - 50;
                        n.vx = 0;
                        n.vy = 0;
                        n.vz = 0;
                    });
                    // 重新应用数据以触发引擎更新
                    Graph.graphData(Graph.graphData());
                } else {
                    console.log(`[3D星空] 坐标检查正常，无 NaN 节点。`);
                }
            }, 2000);
            
            // 触发创世金光降临判断
            if (window.pendingGenesisNodeId) {
                const targetNodeId = window.pendingGenesisNodeId;
                window.pendingGenesisNodeId = null;
                // 引擎需要几百毫秒将数据转换为三维对象并赋予坐标
                setTimeout(() => {
                    const latestNodes = Graph.graphData().nodes;
                    const gNode = latestNodes.find(n => n.id === targetNodeId || n.node_id === targetNodeId);
                    if (gNode) {
                        selectedNodeObj = gNode; // 锁定为选中状态，防止防跳跃逻辑触发
                        
                        // 物理锁定它，不让它乱飞，防止它撞到镜头上
                        const sim = Graph.d3Force('charge') ? Graph.d3Force('charge').simulation : null;
                        if (sim) { sim.alpha(0); sim.alphaTarget(0); }
                        gNode.fx = gNode.x; gNode.fy = gNode.y; gNode.fz = gNode.z;
                        
                        const { camPos, lookAt } = calculateOffsetView(gNode, 350);
                        Graph.cameraPosition(camPos, lookAt, 2000);
                        
                        // 赐予创世金色圣光！
                        showDivineBeam(gNode, 'golden');
                        
                        // 高亮反馈
                        highlightNodes.clear();
                        highlightNodes.add(gNode);
                        updateHighlight();
                        setTimeout(() => { 
                            highlightNodes.clear(); 
                            updateHighlight(); 
                            
                            // 创世光束消失后，释放物理锁定并执行一次适应视图
                            gNode.fx = null;
                            gNode.fy = null;
                            gNode.fz = null;
                            selectedNodeObj = null;
                            
                            // 平滑过渡到全景视图
                            setTimeout(() => {
                                Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200);
                            }, 500);
                        }, 4000);
                    }
                }, 800);
            } else if (res.boss_node_id && res.event_horizon && res.event_horizon.length > 0) {
                // 存在大股东节点：自动进入事件视界模式
                console.log(`[事件视界] 检测到大股东节点: ${res.boss_node_id}，视界内节点数: ${res.event_horizon.length}`);
                
                setTimeout(() => {
                    const latestNodes = Graph.graphData().nodes;
                    const bossNode = latestNodes.find(n => n.id === res.boss_node_id || n.node_id === res.boss_node_id);
                    
                    if (bossNode) {
                        // 将视界内节点加入 horizonNodes
                        horizonNodes.clear();
                        res.event_horizon.forEach(id => horizonNodes.add(id));
                        updateHighlight();
                        
                        // 聚焦到大股东节点
                        // 确保坐标有效
                        if (!isNaN(bossNode.x) && !isNaN(bossNode.y) && !isNaN(bossNode.z)) {
                            const { camPos, lookAt } = calculateOffsetView(bossNode, 500);
                            Graph.cameraPosition(camPos, lookAt, 1500);
                            console.log(`[事件视界] 已进入事件视界模式，以 ${res.boss_node_id} 为中心`);
                        } else {
                            console.warn(`[事件视界] 大股东节点坐标无效，降级为全局适应`);
                            Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200);
                        }
                    } else {
                        console.warn(`[事件视界] 未找到大股东节点 ${res.boss_node_id} 在渲染数据中`);
                        // 降级：仅做适应视图
                        Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200);
                    }
                }, 800);
            } else if (!selectedNodeObj) {
                // 防跳跃逻辑：如果没有选中任何节点，才执行全局缩放适应
                setTimeout(() => {
                    Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200);
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
                    const MAX_RADIUS = 9.0; // 统一为全局一致的 9.0
                    const REL_SIZE = 7;
                    const w = getVisualWeight(gNode.survival_weight);
                    const targetRadius = MIN_RADIUS + (w * (MAX_RADIUS - MIN_RADIUS));
                    const targetPhysicalRadius = targetRadius * REL_SIZE;
                    
                    const mainSprite = gNode.__threeObj.children[0];
                    if (mainSprite && mainSprite.isSprite) {
                        const spriteScale = targetPhysicalRadius * 2.5;
                        const targetOpacity = gNode.action_tag === '又贞' ? (0.4 + w * 0.6) * 0.85 : (0.4 + w * 0.6);
                        
                        // 使用 Tween 平滑过渡
                        if (typeof TWEEN !== 'undefined') {
                            new TWEEN.Tween({ 
                                scale: mainSprite.scale.x,
                                opacity: mainSprite.material.opacity
                            })
                            .to({ 
                                scale: spriteScale,
                                opacity: targetOpacity
                            }, 500)
                            .easing(TWEEN.Easing.Quadratic.Out)
                            .onUpdate(obj => {
                                mainSprite.scale.set(obj.scale, obj.scale, 1);
                                if (mainSprite.material) {
                                    mainSprite.material.opacity = obj.opacity;
                                }
                            // 同步缩放光柱
                                if (typeof activeBeam !== 'undefined' && activeBeam && activeBeam.userData.nodeId === (gNode.id || gNode.node_id)) {
                                    const currentPhysicalRadius = obj.scale / 2.5;
                                    const scaleFactor = currentPhysicalRadius / targetPhysicalRadius;
                                    activeBeam.scale.set(scaleFactor, 1, scaleFactor);
                                }
                            })
                            .start();
                        } else {
                            mainSprite.scale.set(spriteScale, spriteScale, 1);
                            if (mainSprite.material) {
                                mainSprite.material.opacity = targetOpacity;
                            }
                            if (typeof activeBeam !== 'undefined' && activeBeam && activeBeam.userData.nodeId === (gNode.id || gNode.node_id)) {
                                activeBeam.scale.set(1, 1, 1);
                            }
                        }
                    }
                    
                    const labelSprite = gNode.__threeObj.children[1];
                    if (labelSprite && labelSprite.material && labelSprite.material.map) {
                        // 标签大小控制：与节点大小成正比
                        const baseScale = 0.3 + (w * 0.4);
                        const spriteHeight = labelSprite.material.map.baseHeight * baseScale;
                        const spriteWidth = labelSprite.material.map.baseWidth * baseScale;
                        const targetY = targetPhysicalRadius + spriteHeight + 4;
                        
                        if (typeof TWEEN !== 'undefined') {
                            new TWEEN.Tween({
                                scaleX: labelSprite.scale.x,
                                scaleY: labelSprite.scale.y,
                                posY: labelSprite.position.y
                            })
                            .to({
                                scaleX: spriteWidth,
                                scaleY: spriteHeight,
                                posY: targetY
                            }, 500)
                            .easing(TWEEN.Easing.Quadratic.Out)
                            .onUpdate(obj => {
                                labelSprite.scale.set(obj.scaleX, obj.scaleY, 1);
                                labelSprite.position.y = obj.posY;
                            })
                            .start();
                        } else {
                            labelSprite.scale.set(spriteWidth, spriteHeight, 1);
                            labelSprite.position.y = targetY;
                        }
                    }
                    
                    // 【核心修复4：同步更新光柱尺寸】如果当前节点正在被光柱照射，动态更新光柱的几何体
                    if (activeBeam && activeBeam.userData.nodeId === (gNode.id || gNode.node_id)) {
                        const THREE = getThreeInstance();
                        if (THREE) {
                            const isMobile = window.innerWidth < 768;
                            const beamHeight = activeBeam.userData.beamHeight || 10000;
                            const colorType = activeBeam.userData.colorType;
                            
                            const visualRadius = targetPhysicalRadius * 1.25;
                            const bottomRadius = visualRadius * 0.7;
                            let topRadius;
                            if (colorType === 'golden') {
                                topRadius = bottomRadius + beamHeight * (isMobile ? 0.05 : 0.08);
                            } else if (w >= 0.6) {
                                topRadius = bottomRadius + beamHeight * (isMobile ? 0.06 : 0.10);
                            } else {
                                topRadius = bottomRadius + beamHeight * (isMobile ? 0.03 : 0.05);
                            }
                            
                            const extendedHeight = beamHeight + visualRadius * 2.0;
                            const newGeo = new THREE.CylinderGeometry(topRadius, bottomRadius, extendedHeight, 32, 1, true);
                            newGeo.translate(0, extendedHeight / 2 - visualRadius * 2.0, 0);
                            
                            // 替换旧的几何体
                            if (activeBeam.geometry) {
                                activeBeam.geometry.dispose();
                            }
                            activeBeam.geometry = newGeo;
                            
                            // 同步更新材质的 uniforms
                            if (activeBeam.material && activeBeam.material.uniforms) {
                                activeBeam.material.uniforms.bottomRadius.value = bottomRadius;
                                activeBeam.material.uniforms.sphereRadius.value = visualRadius;
                            }
                            
                            // 同步更新聚光灯角度
                            const spotLight = activeBeam.children.find(child => child.isSpotLight);
                            if (spotLight) {
                                spotLight.angle = Math.atan(bottomRadius / beamHeight);
                            }
                        }
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
        const currentOwnerId = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        const currentActorId = new URLSearchParams(window.location.search).get('actor_id');
        
        // 1. 隔离不同的 owner_id
        if (data.owner_id && data.owner_id !== currentOwnerId) return;
        
        // 2. 隔离不同的 actor_id
        if (data.actor_id && currentActorId && data.actor_id !== currentActorId) return;

        nodeCache[data.node_id] = data;
        // 使用增量更新而不是全量刷新，保留节点坐标，防止重绘抖动
        updateNodeIncremental(data);
    });
    
    window.socket.on('node_created', (data) => {
        const currentOwnerId = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        const currentActorId = new URLSearchParams(window.location.search).get('actor_id');
        
        // 1. 隔离不同的 owner_id
        if (data.owner_id && data.owner_id !== currentOwnerId) return;
        
        // 2. 隔离不同的 actor_id
        if (data.actor_id && currentActorId && data.actor_id !== currentActorId) return;

        nodeCache[data.node_id] = data;
        window.pendingGenesisNodeId = data.node_id; // 标记待播发创世金光的节点
        loadInitialData(); // 新节点增加需要拓扑刷新
    });

    window.socket.on('node_deleted', (data) => {
        const currentOwnerId = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        const currentActorId = new URLSearchParams(window.location.search).get('actor_id');
        
        // 1. 隔离不同的 owner_id
        if (data.owner_id && data.owner_id !== currentOwnerId) return;
        
        // 2. 隔离不同的 actor_id
        if (data.actor_id && currentActorId && data.actor_id !== currentActorId) return;

        delete nodeCache[data.node_id];
        if (currentSelectedNodeId === data.node_id) closeDrawer();
        loadInitialData();
    });

    // 巡航视觉同步：接收其他客户端的巡航跳跃广播
    window.socket.on('cruise_view', (data) => {
        // 只响应同 actor/owner 的巡航广播
        if (window.currentActorId && data.actor_id !== window.currentActorId) return;
        if (window.currentOwnerId !== 'default' && data.owner_id !== window.currentOwnerId) return;

        if (!Graph) return;
        const { nodes } = Graph.graphData();
        const target = nodes.find(n => n.id === data.node_id);
        if (target) {
            const { camPos, lookAt } = calculateOffsetView(target, 350);
            Graph.cameraPosition(camPos, lookAt, 2000);
            showDivineBeam(target);
            selectedNodeObj = target;
            highlightNodes.clear();
            highlightNodes.add(target);
            updateHighlight();
        }
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
    
    // 自动折叠导航盘
    if (typeof window.collapseNavPad === 'function') {
        window.collapseNavPad();
    }
    
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
    
    // 自动展开导航盘
    if (typeof window.expandNavPad === 'function') {
        window.expandNavPad();
    }
    
    // 触发居中动画（相机回到正中央）
    if (selectedNodeObj && Graph) {
        lastLocalActionTime = Date.now(); // 更新保护时间，避免动画被打断
        const { camPos, lookAt } = calculateOffsetView(selectedNodeObj, 350);
        Graph.cameraPosition(camPos, lookAt, 800); // 800ms 平滑居中
        
        // 延迟释放物理锚定，确保动画期间节点不乱跑
        const node = selectedNodeObj;
        setTimeout(() => {
            node.fx = null;
            node.fy = null;
            node.fz = null;
            selectedNodeObj = null; // 清空选中状态，允许下次加载时 zoomToFit
            
            const sim = Graph.d3Force('charge') ? Graph.d3Force('charge').simulation : null;
            if (sim) {
                sim.velocityDecay(0.4); 
                sim.alphaTarget(0.1).restart(); // 恢复微弱动力，让星空自然流动
            }
        }, 800);
    } else {
        const sim = Graph.d3Force('charge') ? Graph.d3Force('charge').simulation : null;
        if (sim) {
            sim.velocityDecay(0.4); 
            sim.alphaTarget(0.1).restart(); // 恢复微弱动力，让星空自然流动
        }
    }
    
    currentSelectedNodeId = null;
    
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
    
    // 自动展开导航盘
    if (typeof window.expandNavPad === 'function') {
        window.expandNavPad();
    }
    
    // 触发居中动画（相机回到正中央）
    if (selectedNodeObj && Graph) {
        lastLocalActionTime = Date.now(); // 更新保护时间，避免动画被打断
        const { camPos, lookAt } = calculateOffsetView(selectedNodeObj, 350);
        Graph.cameraPosition(camPos, lookAt, 800); // 800ms 平滑居中
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
    
    // 自动折叠导航盘
    if (typeof window.collapseNavPad === 'function') {
        window.collapseNavPad();
    }
    
    // 触发避让动画（相机向左偏）
    if (selectedNodeObj && Graph) {
        lastLocalActionTime = Date.now(); // 更新保护时间，避免动画被打断
        const { camPos, lookAt } = calculateOffsetView(selectedNodeObj, 350);
        Graph.cameraPosition(camPos, lookAt, 800); // 800ms 平滑避让
    }
}

// --- [4.5 抽屉图片上传与预览] ---
function handleImagePreview(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('d-preview-img').src = e.target.result;
            document.getElementById('d-image-preview').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    } else {
        document.getElementById('d-image-preview').classList.add('hidden');
    }
}

async function handleUploadImage() {
    const fileInput = document.getElementById('d-image-file');
    const file = fileInput.files[0];
    
    if (!file) {
        showSelectionHint('请先选择要上传的图片');
        return;
    }
    
    const btn = document.getElementById('btn-upload-image');
    const originalText = btn.innerText;
    btn.innerText = '上传中...';
    btn.disabled = true;
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        console.log('[抽屉上传] 开始上传图片...');
        const response = await fetch('/api/v1/causal/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            document.getElementById('d-full-image-url').value = data.data.url;
            console.log('[抽屉上传] 图片上传成功:', data.data.url);
            showSelectionHint('图片上传成功');
        } else {
            console.error('[抽屉上传] 图片上传失败:', data.message);
            showSelectionHint('图片上传失败: ' + data.message);
        }
    } catch (error) {
        console.error('[抽屉上传] 上传图片异常:', error);
        showSelectionHint('图片上传出错: ' + error.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
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
            
            // 【关键修复】表单保存后，由于可能修改了节点ID、连线关系(父ID)、动作标签(颜色)，必须强制重绘全图
            loadInitialData();
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

        // 通知其他客户端：巡航跳到了哪个节点（纯视觉广播，不写数据库）
        socket.emit('cruise_step', {
            node_id: node.id,
            x: node.x, y: node.y, z: node.z,
            survival_weight: node.survival_weight,
            actor_id: window.currentActorId || '',
            owner_id: window.currentOwnerId || 'default'
        });

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
    
    // 检查URL参数中是否有edit=true
    const urlParams = new URLSearchParams(window.location.search);
    const isEditUrl = urlParams.get('edit') === 'true';
    
    // 如果是编辑模式或URL有edit=true参数，则打开抽屉
    if (is_edit_mode || isEditUrl) {
        openDrawer(node.id);
    }
    
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

    // 触发事件视界扫描
    const requestData = { serial_id: node.serial_id || node.本事件ID };
    if (window.currentActorId) {
        requestData.actor_id = window.currentActorId;
    }
    if (window.currentOwnerId && window.currentOwnerId !== 'default') {
        requestData.owner_id = window.currentOwnerId;
    }
    
    console.log(`[点击事件] 请求数据:`, requestData);
    
    fetch('/api/v1/causal/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success' && data.event_horizon) {
            console.log(`[事件视界] 收到视界内节点数: ${data.event_horizon.length}`);
            horizonNodes.clear();
            data.event_horizon.forEach(id => horizonNodes.add(id));
            updateHighlight();
        }
    })
    .catch(error => console.error('[点击事件] 请求失败:', error));
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
            const weight = getVisualWeight(node.survival_weight);
            const targetRadius = MIN_RADIUS + (weight * (MAX_RADIUS - MIN_RADIUS));
            return Math.pow(targetRadius, 3); // 抵消引擎内部的开立方根
        })

        // --- [3. 天体建模：贞/又贞/对贞] ---
        .nodeThreeObject(node => {
            const THREE = getThreeInstance();
            if (!THREE) return null;

            const weight = getVisualWeight(node.survival_weight);
            const targetRadius = MIN_RADIUS + (weight * (MAX_RADIUS - MIN_RADIUS));
            const actualPhysicalRadius = targetRadius * REL_SIZE;

            const group = new THREE.Group();
            
            const duty = node.action_tag; // 根据你的业务字段判断职责
            const baseOpacity = 0.4 + weight * 0.6;

            // 全局纹理缓存
            if (!window.nodeTextureCache) {
                window.nodeTextureCache = {};
            }

            // 映射图片路径
            let imagePath = './static/images/zhen.png'; // 默认
            if (duty === '贞') {
                imagePath = './static/images/zhen.png';
            } else if (duty === '又贞') {
                imagePath = './static/images/youzhen.png';
            } else if (duty === '对贞') {
                imagePath = './static/images/duizhen.png';
            }

            // 加载纹理
            let nodeTexture = window.nodeTextureCache[imagePath];
            if (!nodeTexture) {
                nodeTexture = new THREE.TextureLoader().load(imagePath);
                window.nodeTextureCache[imagePath] = nodeTexture;
            }

            // 创建 Sprite
            const material = new THREE.SpriteMaterial({
                map: nodeTexture,
                transparent: true,
                opacity: duty === '又贞' ? baseOpacity * 0.85 : baseOpacity,
                depthWrite: false
            });

            const spriteNode = new THREE.Sprite(material);
            
            // 调整 Sprite 缩放比例，使其与原球体大小保持一致
            // 球体直径是 actualPhysicalRadius * 2
            const spriteScale = actualPhysicalRadius * 2.5; 
            spriteNode.scale.set(spriteScale, spriteScale, 1);
            
            group.add(spriteNode);

            // 【标签对齐】：精准计算文字悬浮位置
            const texture = createTextTexture(node.id, weight, THREE);
            if (texture) {
                const sprite = new THREE.Sprite(
                    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: baseOpacity })
                );
                // 标签大小控制：与节点大小成正比
                // 基础缩放0.3，权重为1时缩放为0.7
                const baseScale = 0.3 + (weight * 0.4);
                const spriteHeight = texture.baseHeight * baseScale;
                sprite.scale.set(texture.baseWidth * baseScale, spriteHeight, 1);
                
                // 位置：提高悬浮高度，避免在斜视时遮挡星球
                sprite.position.y = actualPhysicalRadius + spriteHeight + 4; 
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

            if (!is_edit_mode) {
                // 降下一束神圣探照光柱
                showDivineBeam(node);
                
                // 使用精确坐标偏移计算
                const { camPos, lookAt } = calculateOffsetView(node, 350);
                
                Graph.cameraPosition(camPos, lookAt, 1200);

                const requestData = { serial_id: node.serial_id || node.本事件ID };
                if (window.currentActorId) {
                    requestData.actor_id = window.currentActorId;
                }
                if (window.currentOwnerId && window.currentOwnerId !== 'default') {
                    requestData.owner_id = window.currentOwnerId;
                }
                fetch('/api/v1/causal/click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'success' && data.event_horizon) {
                        console.log('[事件视界] 收到视界内节点数: ' + data.event_horizon.length);
                        horizonNodes.clear();
                        data.event_horizon.forEach(id => horizonNodes.add(id));
                        updateHighlight();
                    }
                })
                .catch(error => console.error('[API-only点击] 请求失败:', error));
                setTimeout(() => { node.fx = node.fy = node.fz = null; }, 1000);
                return;
            }

            // 检查URL参数中是否有edit=true
            const urlParams = new URLSearchParams(window.location.search);
            const isEditUrl = urlParams.get('edit') === 'true';
            
            // 如果是编辑模式或URL有edit=true参数，则打开抽屉
            if (is_edit_mode || isEditUrl) {
                openDrawer(node.id); // 唤起右侧抽屉
            }
            
            // 降下一束神圣探照光柱
            showDivineBeam(node);
            
            // 使用精确坐标偏移计算
            const { camPos, lookAt } = calculateOffsetView(node, 350);
            
            Graph.cameraPosition(camPos, lookAt, 1200);

            // 后端交互
            const requestData = { serial_id: node.serial_id || node.本事件ID };
            if (window.currentActorId) {
                requestData.actor_id = window.currentActorId;
            }
            if (window.currentOwnerId && window.currentOwnerId !== 'default') {
                requestData.owner_id = window.currentOwnerId;
            }
            
            console.log(`[点击事件] 请求数据:`, requestData);
            
            fetch('/api/v1/causal/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success' && data.event_horizon) {
                    console.log(`[事件视界] 收到视界内节点数: ${data.event_horizon.length}`);
                    horizonNodes.clear();
                    data.event_horizon.forEach(id => horizonNodes.add(id));
                    updateHighlight();
                }
            })
            .catch(error => console.error('[点击事件] 请求失败:', error));
        })

        // --- [5. 连线与细节配置] ---
        .nodeLabel(node => {
            const weight = typeof node.survival_weight === 'number' ? node.survival_weight.toFixed(10) : '0.00';
            const serialId = node.serial_id || node.本事件ID || '未知';
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
                        <span class="tooltip-label">序列:</span>
                        <span class="tooltip-value" style="color: #7fb4f5ff;">${serialId}</span>
                    </div>
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
            
            // --- 悬浮绽放动画：先还原上一个 ---
            if (hoverScaleNode && hoverScaleNode !== node) {
                hoverScaleNodeRebound(hoverScaleNode);
                hoverScaleNode = null;
            }
            
            if (node) {
                // 鼠标进入节点：立即显示tooltip
                hoverNode = node;
                updateHighlight();
                
                // 非大股东节点：悬浮绽放放大 + 低透明度提升
                if (!selectedNodeObj || (selectedNodeObj && selectedNodeObj.id !== node.id)) {
                    hoverScaleNodeBloom(node);
                    hoverScaleNode = node;
                }
            } else {
                // 鼠标离开节点：延迟500毫秒隐藏tooltip
                const leavingNode = hoverScaleNode;
                hoverTimeout = setTimeout(() => {
                    hoverNode = null;
                    updateHighlight();
                    hoverTimeout = null;
                    if (leavingNode) {
                        hoverScaleNodeRebound(leavingNode);
                        hoverScaleNode = null;
                    }
                }, HOVER_DELAY);
            }
        })
        .linkWidth(l => {
            if (l.type === 'semantic') return 0; // 语义连线不可见
            if (l.type === 'horizon') return 1.5; // 视界连线宽度
            return highlightLinks.has(l) ? 8.0 : 2.0;
        })
        .linkColor(l => {
            if (l.type === 'semantic') return 'rgba(0,0,0,0)'; // 语义连线完全透明
            if (l.type === 'horizon') return 'rgba(139, 92, 246, 0.6)'; // 视界连线颜色 (紫色)
            return highlightLinks.has(l) ? '#fff' : 'rgba(0, 255, 255, 0.2)';
        })
        .linkDirectionalParticles(l => {
            if (l.type === 'semantic') return 0; // 语义连线没有光点
            if (l.type === 'horizon') return 4; // 视界连线光点
            return highlightLinks.has(l) ? 10 : 2;
        })
        .linkDirectionalParticleWidth(l => l.type === 'horizon' ? 3 : 4)
        .linkDirectionalParticleColor(l => l.type === 'horizon' ? '#a78bfa' : null)
        .linkDirectionalArrowLength(l => {
            if (l.type === 'semantic') return 0; // 语义连线没有箭头
            if (l.type === 'horizon') return 0; // 视界连线没有箭头
            return 6;
        })
        .linkDirectionalArrowRelPos(1);

    // --- [6. 初始化力场与事件] ---
    // 调整全局排斥力，防止节点挤在一起
    Graph.d3Force('charge').strength(-200); 
    
    // --- [宏观聚光灯] ---
    setTimeout(() => {
        const THREE = getThreeInstance();
        if (THREE && Graph.scene()) {
            const macroSpotLight = new THREE.SpotLight(0xffffff, 2.0); // 宽泛淡薄的光，提高亮度
            macroSpotLight.position.set(0, 2000, 2000); // 从宏观场面中与节点高光同向
            macroSpotLight.angle = Math.PI / 3; // 放大照射夹角，达到聚光的效果
            macroSpotLight.penumbra = 1.0; // 渐变要柔和不要锐化
            macroSpotLight.decay = 2;
            macroSpotLight.distance = 10000;
            
            // 追随节点场的引力中心
            const targetObject = new THREE.Object3D();
            targetObject.position.set(0, 0, 0);
            Graph.scene().add(targetObject);
            macroSpotLight.target = targetObject;
            
            Graph.scene().add(macroSpotLight);
        }
    }, 500);
    
    // Tween.js 动画循环：持续驱动所有 Tween 动画（悬浮绽放、光柱等）
    (function tweenLoop() {
        requestAnimationFrame(tweenLoop);
        if (typeof TWEEN !== 'undefined') {
            TWEEN.update();
        }
    })();

    // 劫持并重定义 Link 力场
    const linkForce = Graph.d3Force('link');
    if (linkForce) {
        linkForce
            .distance(link => {
                if (link.type === 'semantic') {
                    let sim = Number(link.similarity);
                    if (isNaN(sim)) sim = 0.6;
                    // 极端放大距离差异
                    // sim = 1.0 -> dist = 10
                    // sim = 0.6 -> dist = 600
                    const dist = Math.max(10, 600 - (sim - 0.6) * (590 / 0.4));
                    return dist;
                } else {
                    return 250;
                }
            })
            .strength(link => {
                if (link.type === 'semantic') {
                    let sim = Number(link.similarity);
                    if (isNaN(sim)) sim = 0.6;
                    // 极端放大拉力差异
                    // sim = 1.0 -> str = 1.5 (极强拉力)
                    // sim = 0.6 -> str = 0.001 (极弱拉力)
                    const str = Math.max(0.001, Math.min(1.5, 0.001 + (sim - 0.6) * (1.499 / 0.4)));
                    return str;
                } else {
                    return 0.02;
                }
            });
    } else {
        console.error("[3D星空] 无法获取 link 力场!");
    }

    // 绑定界面按钮
    document.getElementById('btn-save-node').onclick = handleSaveNode;
    document.getElementById('btn-delete-node').onclick = handleDeleteNode;
    document.getElementById('btn-close-drawer').onclick = closeDrawer;
    
    // 绑定事件视界按钮
    const eventHorizonBtn = document.getElementById('btn-event-horizon');
    if (eventHorizonBtn) {
        eventHorizonBtn.onclick = function() {
            if (!currentSelectedNodeId) {
                showSelectionHint('请先选择一个节点作为大股东');
                return;
            }
            
            // 触发点击事件，后端会计算并返回视界内的节点
            const requestData = { 
                serial_id: selectedNodeObj.serial_id || selectedNodeObj.本事件ID,
                actor_id: window.currentActorId || '',
                owner_id: window.currentOwnerId || 'default'
            };
            
            showSelectionHint('正在扫描事件视界...');
            
            fetch('/api/v1/causal/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success' && data.event_horizon) {
                    const horizonIds = data.event_horizon;
                    showSelectionHint(`视界扫描完成：发现 ${horizonIds.length} 个节点`);
                    
                    // 高亮视界内的节点
                    highlightNodes.clear();
                    const { nodes } = Graph.graphData();
                    
                    horizonIds.forEach(id => {
                        const node = nodes.find(n => n.id === id);
                        if (node) {
                            highlightNodes.add(node);
                        }
                    });
                    
                    updateHighlight();
                    
                    // 调整视角以包含所有视界节点
                    if (horizonIds.length > 0) {
                        // 简单实现：缩放以适应全图
                        Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1000);
                        
                        // 绘制视界连线
                        const { nodes, links } = Graph.graphData();
                        const newLinks = [...links];
                        
                        // 移除旧的视界连线
                        const filteredLinks = newLinks.filter(l => l.type !== 'horizon');
                        
                        // 添加新的视界连线
                        horizonIds.forEach(id => {
                            if (id !== selectedNodeObj.id) {
                                filteredLinks.push({
                                    source: selectedNodeObj.id,
                                    target: id,
                                    type: 'horizon'
                                });
                            }
                        });
                        
                        Graph.graphData({ nodes, links: filteredLinks });
                    }
                } else {
                    showSelectionHint('视界扫描失败');
                }
            })
            .catch(err => {
                console.error('视界扫描异常:', err);
                showSelectionHint('视界扫描异常');
            });
        };
        console.log('[事件视界] 按钮事件绑定成功');
    }
    
    // 绑定抽屉图片上传按钮
    const uploadImageBtn = document.getElementById('btn-upload-image');
    if (uploadImageBtn) {
        uploadImageBtn.onclick = handleUploadImage;
    }
    
    // 绑定抽屉图片预览
    const imageFileInput = document.getElementById('d-image-file');
    if (imageFileInput) {
        imageFileInput.onchange = handleImagePreview;
    }
    
    // 绑定折叠/展开按钮
    const collapseBtn = document.getElementById('btn-collapse-drawer');
    if (collapseBtn) collapseBtn.onclick = collapseDrawer;
    
    const expandBtn = document.getElementById('btn-expand-drawer');
    if (expandBtn) expandBtn.onclick = expandDrawer;
    
    document.getElementById('btn-fit-view').onclick = () => {
        // 清除事件视界，恢复上帝视角
        horizonNodes.clear();
        updateHighlight();
        Graph.zoomToFit(800, 40);
        // Graph.cameraPosition({ x: 0, y: 0, z: 1200 }, { x: 0, y: 0, z: 0 }, 1200);
    };
    
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
        if (!is_edit_mode) {
            createNodeBtn.style.display = 'none';
        } else {
            createNodeBtn.onclick = openCreateModal;
            console.log('[发起首贞] 按钮事件绑定成功');
        }
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
            } else if (searchType === 'vector') {
                // 向量语义搜索
                apiUrl = '/api/v1/causal/search/vector';
                requestData = { 
                    keyword: searchTerm,
                    owner_id: window.currentOwnerId || 'default',
                    limit: 20
                };
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
            
            // 格式化相关度，保留4位小数
            const relevanceFormatted = Number(relevanceScore).toFixed(4);
            
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
                                <span class="relevance-value">${relevanceFormatted}</span>
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
            
            // 聚焦到该节点
            const { camPos, lookAt } = calculateOffsetView(targetNode, 350);
            
            // 降下一束神圣光柱
            showDivineBeam(targetNode);

            Graph.cameraPosition(camPos, lookAt, 1200);
            
            // 检查URL参数中是否有edit=true
            const urlParams = new URLSearchParams(window.location.search);
            const isEditUrl = urlParams.get('edit') === 'true';
            
            // 如果是编辑模式或URL有edit=true参数，则打开抽屉
            if (is_edit_mode || isEditUrl) {
                openDrawer(targetNode.id);
            }
            
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

    // --- [10. 星际导航盘逻辑 (支持拖拽与折叠)] ---
    const navContainer = document.getElementById('nav-container');
    const navToggle = document.getElementById('nav-toggle');
    const navPad = document.getElementById('nav-pad');
    const navBtns = document.querySelectorAll('.nav-btn:not(.empty)');
    
    let navAnimationId = null;
    let currentNavDir = null;
    
    // 1. 折叠/展开逻辑
    let isNavCollapsed = window.innerWidth < 768; // 移动端默认折叠
    
    // 初始化折叠状态
    if (isNavCollapsed) {
        navPad.classList.add('collapsed');
        navContainer.classList.add('is-collapsed');
    } else {
        navContainer.classList.remove('is-collapsed');
    }
    
    // 暴露全局函数供抽屉调用
    window.collapseNavPad = function() {
        if (!isNavCollapsed) {
            isNavCollapsed = true;
            navPad.classList.add('collapsed');
            navContainer.classList.add('is-collapsed');
        }
    };
    
    window.expandNavPad = function() {
        if (isNavCollapsed) {
            isNavCollapsed = false;
            navPad.classList.remove('collapsed');
            navContainer.classList.remove('is-collapsed');
        }
    };
    
    // 区分点击和拖拽
    let isDraggingNav = false;
    let dragStartTime = 0;
    
    function toggleNavPad() {
        if (isNavCollapsed) {
            window.expandNavPad();
        } else {
            window.collapseNavPad();
        }
    }
    
    navToggle.addEventListener('click', (e) => {
        // 如果是拖拽结束触发的点击，则忽略
        if (Date.now() - dragStartTime > 200 || isDraggingNav) return;
        toggleNavPad();
    });
    
    // 2. 拖拽逻辑
    let startX, startY, initialLeft, initialTop;
    
    function onDragStart(e) {
        if (e.target !== navToggle) return;
        e.preventDefault();
        
        isDraggingNav = false;
        dragStartTime = Date.now();
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        startX = clientX;
        startY = clientY;
        
        // 获取当前位置
        const rect = navContainer.getBoundingClientRect();
        // 使用 right 和 bottom 进行定位，避免展开时向下溢出
        initialRight = window.innerWidth - rect.right;
        initialBottom = window.innerHeight - rect.bottom;
        
        // 切换为绝对定位以便拖拽
        navContainer.style.position = 'fixed';
        navContainer.style.left = 'auto';
        navContainer.style.top = 'auto';
        navContainer.style.right = initialRight + 'px';
        navContainer.style.bottom = initialBottom + 'px';
        navContainer.style.transition = 'none'; // 拖拽时取消过渡动画
        
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
    }
    
    function onDragMove(e) {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        const dx = clientX - startX;
        const dy = clientY - startY;
        
        // 如果移动距离超过 5px，认为是拖拽而不是点击
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            isDraggingNav = true;
        }
        
        if (isDraggingNav) {
            e.preventDefault();
            
            // 计算新位置（注意 right 和 bottom 的方向与 dx/dy 相反）
            let newRight = initialRight - dx;
            let newBottom = initialBottom - dy;
            
            const rect = navContainer.getBoundingClientRect();
            const maxRight = window.innerWidth - rect.width;
            const maxBottom = window.innerHeight - rect.height;
            
            // 限制在屏幕范围内
            newRight = Math.max(0, Math.min(newRight, maxRight));
            newBottom = Math.max(0, Math.min(newBottom, maxBottom));
            
            navContainer.style.right = newRight + 'px';
            navContainer.style.bottom = newBottom + 'px';
        }
    }
    
    function onDragEnd(e) {
        navContainer.style.transition = 'opacity 0.3s ease'; // 恢复过渡动画
        
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('touchend', onDragEnd);
        
        // 如果是触摸结束，且没有发生拖拽，则触发点击逻辑
        if (e && e.type === 'touchend' && !isDraggingNav && (Date.now() - dragStartTime < 200)) {
            toggleNavPad();
        }
        
        // 延迟重置拖拽状态，防止触发点击事件
        setTimeout(() => {
            isDraggingNav = false;
        }, 50);
    }
    
    navToggle.addEventListener('mousedown', onDragStart);
    navToggle.addEventListener('touchstart', onDragStart, { passive: false });
    
    // 3. 巡航控制逻辑
    
    function startNav(dir) {
        if (dir === 'reset') {
            // 检查抽屉是否打开
            const drawerElement = document.getElementById('drawer');
            const isDrawerOpen = drawerElement && !drawerElement.classList.contains('drawer-hidden');
            const screenWidth = window.innerWidth;
            
            let camPos = { x: 0, y: 0, z: 900 };
            let lookAt = { x: 0, y: 0, z: 0 };
            
            // 如果抽屉打开且屏幕足够宽，应用避让算法
            if (isDrawerOpen && screenWidth > DRAWER_WIDTH) {
                const offsetRatio = (DRAWER_WIDTH / 2) / screenWidth;
                const camera = Graph.camera();
                if (camera) {
                    const fovRad = (camera.fov * Math.PI) / 180;
                    const viewHeight = 2 * Math.tan(fovRad / 2) * 900; // 距离是900
                    const viewWidth = viewHeight * camera.aspect;
                    const worldOffset = viewWidth * offsetRatio;
                    
                    // 向右偏移相机和观察点，使画面整体向左移动
                    camPos.x += worldOffset;
                    lookAt.x += worldOffset;
                }
            }
            
            Graph.cameraPosition(camPos, lookAt, 1200);
            return;
        }
        
        currentNavDir = dir;
        if (!navAnimationId) {
            navLoop();
        }
    }
    
    function stopNav() {
        currentNavDir = null;
        if (navAnimationId) {
            cancelAnimationFrame(navAnimationId);
            navAnimationId = null;
        }
    }
    
    function navLoop() {
        if (!currentNavDir || !Graph) {
            navAnimationId = null;
            return;
        }
        
        const camera = Graph.camera();
        const controls = Graph.controls();
        if (!camera || !controls) {
            navAnimationId = requestAnimationFrame(navLoop);
            return;
        }
        
        // 获取相机的局部坐标系方向
        const THREE = getThreeInstance();
        if (!THREE) return;
        
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();
        const trueUp = new THREE.Vector3().crossVectors(right, forward).normalize();
        
        const speed = 15; // 移动速度
        const moveVec = new THREE.Vector3();
        
        switch (currentNavDir) {
            case 'in': moveVec.copy(forward).multiplyScalar(speed); break;
            case 'out': moveVec.copy(forward).multiplyScalar(-speed); break;
            case 'left': moveVec.copy(right).multiplyScalar(-speed); break;
            case 'right': moveVec.copy(right).multiplyScalar(speed); break;
            case 'up': moveVec.copy(trueUp).multiplyScalar(speed); break;
            case 'down': moveVec.copy(trueUp).multiplyScalar(-speed); break;
        }
        
        // 同时移动相机和目标点
        camera.position.add(moveVec);
        controls.target.add(moveVec);
        
        navAnimationId = requestAnimationFrame(navLoop);
    }
    
    navBtns.forEach(btn => {
        const dir = btn.getAttribute('data-dir');
        
        // 鼠标事件
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startNav(dir);
        });
        btn.addEventListener('mouseup', stopNav);
        btn.addEventListener('mouseleave', stopNav);
        
        // 触摸事件
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startNav(dir);
        });
        btn.addEventListener('touchend', stopNav);
        btn.addEventListener('touchcancel', stopNav);
    });
});
