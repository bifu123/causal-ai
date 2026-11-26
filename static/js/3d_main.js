/**
 * 元龙检索 - 因果星空 (Causal Starry Sky) 全功能集成驱动 v2.2
 * 职责：3D 可视化引擎、因果链溯源、动态引力控制、节点 CRUD 管理
 * 注意：本脚本不需要任何防御性处理
 */

// --- [全局配置] ---
const CONFIG_ENHANCE_HORIZON_NODES = false; // 是否提亮事件视界内的普通节点（权重 <= 0.59）



// --- [全局变量：鉴权] ---
let currentActorId = null;
let currentOwnerId = null;

// --- [鉴权上下文] 服务端裁决的角色矩阵（/api/v1/auth/context 或模板注入）---
// role: anonymous | observer | owner | admin
const ACCESS = {
    role: 'anonymous',
    actor_id: null,
    owner_id: 'default',
    has_token: false,
    can_read_private: false,
    can_write_copy: false,
    can_write_master: false,
    is_admin: false
};

function applyAccess(data) {
    if (!data || typeof data !== 'object') return ACCESS;
    Object.assign(ACCESS, data);
    ACCESS.can_write_master = !!ACCESS.can_write_master;
    ACCESS.can_write_copy = !!ACCESS.can_write_copy;
    ACCESS.can_read_private = !!ACCESS.can_read_private;
    return ACCESS;
}

/**
 * 星空只认 URL 参数（宪法）：
 *   身份凭证 = URL 的 token 参数；URL 没带就视为「无 token」。
 *   不回退 localStorage，避免 URL 没带钥匙却继承浏览器里某次旧登录，
 *   导致 edit=true 下抽屉被误判为场主（越权）。
 */
function resolvePageToken() {
    return (new URLSearchParams(window.location.search).get('token') || '').trim();
}

// 服务端已按 URL token 裁决角色：先套用 seed，等 /auth/context 返回后再校准
if (window.ACCESS_SEED) applyAccess(window.ACCESS_SEED);

/** URL 显式开关：edit=true 才允许“点击即打开抽屉” */
function urlEditFlag() {
    return new URLSearchParams(window.location.search).get("edit") === "true";
}

/** 渲染权限 UI：编辑按钮（写主副本）与抽屉（点击即开）分别由不同权限控制 */
function renderAccessUI() {
    // 1. 写主副本相关按钮：需要 edit=true 且身份为场主 / admin
    const canEditMaster = urlEditFlag() && ACCESS.can_write_master;
    document.querySelectorAll('.owner-edit-only').forEach(el => {
        el.classList.toggle('hidden', !canEditMaster);
    });
    // 2. 写自己副本相关控件（连线等）：需要 edit=true 且有身份
    const canEditCopy = urlEditFlag() && ACCESS.can_write_copy;
    document.querySelectorAll('.copy-edit-only').forEach(el => {
        el.classList.toggle('hidden', !canEditCopy);
    });
    // 3. 只读提示
    const badge = document.getElementById('access-badge');
    if (badge) {
        const label = {
            anonymous: '匿名浏览',
            observer: `观察者 ${ACCESS.actor_id || ''}`,
            owner: `场主 ${ACCESS.actor_id || ''}`,
            admin: `管理员 ${ACCESS.actor_id || ''}`
        }[ACCESS.role] || ACCESS.role;
        badge.textContent = label;
        badge.dataset.role = ACCESS.role;
    }
    console.log('[鉴权] 当前角色:', ACCESS);
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    // 星空只认 URL 参数（宪法）：不做 localStorage 兜底
    currentActorId = params.get('actor_id') || '';
    currentOwnerId = params.get('owner_id') || 'default';
    renderAccessUI();
});

// URL附带Token（只认 URL 参数）
function appendAuthParams(url) {
    const token = resolvePageToken();
    if (!token) return url;
    
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}&auth_token=${encodeURIComponent(token)}`;
}

// Body附带Token、actor、owner（只认 URL 参数）
function appendAuthBody(payload) {
    const token = resolvePageToken();
    if (token) {
        payload.token = token;
        payload.auth_token = token;
    }
    // 身份优先级：URL 显式参数（window.*）> localStorage 记住的登录身份
    const effectiveActorId = window.currentActorId || currentActorId;
    if (effectiveActorId) {
        payload.actor_id = effectiveActorId;
    }
    const effectiveOwnerId = window.currentOwnerId || currentOwnerId;
    if (effectiveOwnerId && effectiveOwnerId !== 'default') {
        payload.owner_id = effectiveOwnerId;
    }
    // 附带 bot_id（跨场记忆融合态），确保后端能并入 bot 的异场 [chat] 记忆节点
    if (window.currentBotId) {
        payload.bot_id = window.currentBotId;
    }
    return payload;
}

// --- [1. 全局状态管理] ---
let Graph = null;
const highlightNodes = new Set();
const highlightLinks = new Set();
const horizonNodes = new Set(); // 存储事件视界内的节点ID
let currentBossNodeId = null; // 记录当前的大股东节点ID
let isGodView = true; // 当前是否处于上帝视角

// 首屏/编辑恢复后的大股东相机跟随。只在观测者视角运行，用户主动操作后立即释放。
const observerCameraFollow = {
    active: false,
    nodeId: null,
    rafId: null,
    startedAt: 0,
    lastFrameAt: 0,
    offset: null,
    lookAtOffset: null
};
let observerFollowReleaseBound = false;
const savedHorizonNodes = new Set(); // 缓存的事件视界节点
let savedBossNodeId = null; // 缓存的大股东节点ID

let hoverNode = null;
let hoverScaleNode = null; // 追踪当前悬浮绽放的节点（非大股东节点的悬浮放大效果）
let currentSelectedNodeId = null; 
let is_change = true; // true: 编辑模式, false: 链入父ID模式
const urlEdit = urlEditFlag();
const hasToken = !!resolvePageToken();
// edit 只控制“点击是否打开抽屉”；是否可写主副本由 ACCESS.can_write_master 决定
const is_edit_mode = urlEdit;
const hasEditPerm = () => urlEdit && ACCESS.can_write_master;

// 页面加载时向服务端确认角色（token 身份优先于 URL actor_id）
(async function initAccessContext() {
    try {
        const params = new URLSearchParams(window.location.search);
        const ownerId = params.get('owner_id') || 'default';
        const actorId = window.currentActorId || params.get('actor_id') || '';
        const token = resolvePageToken();
        const url = `/api/v1/auth/context?owner_id=${encodeURIComponent(ownerId)}` +
            (actorId ? `&actor_id=${encodeURIComponent(actorId)}` : '') +
            (token ? `&token=${encodeURIComponent(token)}` : '');
        const res = await fetch(url, { referrerPolicy: 'no-referrer' });
        const json = await res.json();
        if (json.status === 'success' && json.data) {
            applyAccess(json.data);
            if (ACCESS.actor_id) {
                window.currentActorId = ACCESS.actor_id;
                currentActorId = ACCESS.actor_id;
            }
            renderAccessUI();
            // 告知服务端角色，加入私密房间（仅 owner/admin 会进）
            if (window.socket) {
                window.socket.emit('auth_join', {
                    owner_id: ownerId,
                    actor_id: ACCESS.actor_id,
                    role: ACCESS.role
                });
            }
        }
    } catch (e) {
        console.warn('[鉴权] 获取访问上下文失败，按匿名浏览处理:', e);
        renderAccessUI();
    }
})();

let nodeCache = {};

/**
 * 【节点身份归一索引】node_id 与 serial_id 双键指向同一个节点对象。
 *
 * 背景：nodeCache 的写入侧统一用 node_id 作键（见 cacheSetNode 的所有调用点），
 * 但读取侧曾用 serial_id（数字序号）作键，两侧键不一致会必然 miss，
 * 导致本场已有节点被误判成"新节点"而重复并入 Graph，
 * 每个重复实例都会新建 Group + 2 Sprite + 2 CanvasTexture，显存成倍增长。
 *
 * 本索引让 serial_id / node_id 都能 O(1) 命中同一对象；
 * nodeCache 仍保留（其它逻辑按 node_id 直接索引它），索引只做身份归一，不改任何业务字段。
 */
const __nodeIndex = new Map();

/** 把 serial_id / node_id 两种键都登记到归一索引 */
function __indexNode(node) {
    if (!node || typeof node !== 'object') return;
    const nid = node.node_id || node['本事件标题'] || node.id;
    const sid = node.serial_id || node['本事件ID'];
    if (nid !== undefined && nid !== null && nid !== '') __nodeIndex.set(String(nid), node);
    if (sid !== undefined && sid !== null && sid !== '') __nodeIndex.set(String(sid), node);
    return node;
}

/** 按 serial_id 或 node_id 查归一索引（任一侧命中即可） */
function __lookupNode(serialId, nodeId) {
    if (serialId !== undefined && serialId !== null && serialId !== '') {
        const hit = __nodeIndex.get(String(serialId));
        if (hit) return hit;
    }
    if (nodeId !== undefined && nodeId !== null && nodeId !== '') {
        const hit = __nodeIndex.get(String(nodeId));
        if (hit) return hit;
    }
    return null;
}

/** 统一写入入口：同时维护 nodeCache 与归一索引 */
function cacheSetNode(node) {
    if (!node || typeof node !== 'object') return node;
    const nid = node.node_id || node['本事件标题'] || node.id;
    if (nid !== undefined && nid !== null && nid !== '') nodeCache[nid] = node;
    return __indexNode(node);
}

/** 统一删除入口：同时清理 nodeCache 与归一索引的两个键 */
function cacheDeleteNode(nodeId) {
    if (nodeId === undefined || nodeId === null || nodeId === '') return;
    const target = __nodeIndex.get(String(nodeId));
    if (target) {
        const nid = target.node_id || target['本事件标题'] || target.id;
        const sid = target.serial_id || target['本事件ID'];
        if (nid !== undefined && nid !== null && nid !== '') {
            __nodeIndex.delete(String(nid));
            delete nodeCache[nid];
        }
        if (sid !== undefined && sid !== null && sid !== '') __nodeIndex.delete(String(sid));
    }
    __nodeIndex.delete(String(nodeId));
    delete nodeCache[nodeId];
}

// --- 移动端长按补丁状态 ---
let longPressTimer = null;          // 长按定时器
let longPressStartPos = null;       // 长按起始触摸坐标
let longPressTriggered = false;     // 是否已触发长按（用于松手时抑制后续 click）
let suppressNodeClickUntil = 0;     // 长按松手后，抑制一段时间内库派发的那次单击
let lastViewerOpenNode = null;      // 去重：上一次打开内容查看器的节点
let lastViewerOpenAt = 0;           // 去重：上一次打开内容查看器的时间戳

/**
 * 打开节点内容查看器（右键 / 移动端长按共用入口）
 * 内部做短时间去重，避免 contextmenu 与长按补丁重复触发
 */
function openNodeViewer(node) {
    if (!node) return;
    const now = Date.now();
    if (lastViewerOpenNode === node && now - lastViewerOpenAt < 800) {
        return; // 同一节点短时间内重复触发，忽略
    }
    lastViewerOpenNode = node;
    lastViewerOpenAt = now;
    if (window.openNodeViewerModal) {
        window.openNodeViewerModal(node);
    } else {
        console.warn('[移动端长按] openNodeViewerModal 未定义');
    }
}

/**
 * 移动端长按补丁：
 * 在 3D 渲染器 canvas 上挂载 touchstart/touchend，超过 600ms 视为长按，
 * 触发 openNodeViewerModal(node)；移动或松手则取消。
 * 不调用 preventDefault，避免干扰库自带的单击/双击/右键逻辑。
 */
function installMobileLongPress() {
    if (!Graph || typeof Graph.renderer !== 'function') {
        console.warn('[移动端长按] Graph.renderer 不可用，跳过补丁');
        return;
    }
    const canvas = Graph.renderer().domElement;
    if (!canvas) {
        console.warn('[移动端长按] 未找到渲染器 DOM 元素');
        return;
    }

    const LONG_PRESS_MS = 600;
    const MOVE_TOLERANCE = 15; // 像素

    const cancelLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        longPressStartPos = null;
    };

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { // 仅单指长按
            cancelLongPress();
            longPressTriggered = false;
            return;
        }
        const touch = e.touches[0];
        longPressStartPos = { x: touch.clientX, y: touch.clientY };
        longPressTriggered = false;

        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            longPressTriggered = true;
            // 长按命中：使用当前 hoverNode（渲染循环已在触摸时完成射线命中）
            const node = hoverNode;
            if (node) {
                console.log(`[移动端长按] 命中节点 ${node.id || node.node_id}，打开内容查看器`);
                openNodeViewer(node);
            } else {
                console.log('[移动端长按] 未命中节点，忽略');
            }
        }, LONG_PRESS_MS);
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (!longPressStartPos || e.touches.length !== 1) {
            cancelLongPress();
            return;
        }
        const touch = e.touches[0];
        const dx = touch.clientX - longPressStartPos.x;
        const dy = touch.clientY - longPressStartPos.y;
        if (dx * dx + dy * dy > MOVE_TOLERANCE * MOVE_TOLERANCE) {
            // 手指位移过大，视为拖动/旋转，取消长按
            cancelLongPress();
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        // 长按已触发：松手时抑制库随后派发的那次“单击”，避免长按后又触发聚焦/点击
        if (longPressTriggered) {
            suppressNodeClickUntil = Date.now() + 500;
        }
        longPressTriggered = false;
        cancelLongPress();
    }, { passive: true });

    canvas.addEventListener('touchcancel', () => {
        longPressTriggered = false;
        cancelLongPress();
    }, { passive: true });

    console.log('[移动端长按] 补丁已挂载到渲染器 DOM 元素');
}

// 根据 edit 参数控制编辑相关按钮的可见性
// 抽屉内的写操作（保存 / 删除 / 又贞 / 对贞）还需要服务端角色为场主或 admin
(function initEditModeUI() {
    renderAccessUI();
    if (urlEdit && !ACCESS.can_write_master) {
        // 服务端权限回来之前先按只读处理，避免闪现可写按钮
        console.log('[只读模式] edit=true 但当前身份无法写主副本，编辑按钮保持隐藏');
    } else if (urlEdit) {
        console.log('[编辑模式] edit=true，编辑按钮已按权限显示');
    } else {
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

// 【建光去重】移动端 touchstart/touchend + pointerup 会让同一次操作（点节点 / 拖滑杆）
// 走到 showDivineBeam 两次；而低帧率设备上 animate() 可能提前判定"死亡"并把 activeBeam
// 置为 null，使下面基于 activeBeam 的幂等判重直接失效 → 同一节点叠出第二束光。
// 这里用与 activeBeam 状态完全解耦的时间窗兜底：
// __lastBeamStart 记录"最近一次真正建光/续期的节点与时刻"，窗口内的重复调用一律丢弃。
const __BEAM_DEDUP_MS = 400; // 同节点建光抑制窗口（毫秒）
let __lastBeamStart = { id: null, t: 0 };

/**
 * 彻底销毁一束光柱：从场景移除 + 释放几何体/材质 + 标记失效。
 * force-graph 的 remove 不会 dispose，只置空引用会造成显存持续增长。
 * @param {Object} beam 光柱 Mesh
 */
function disposeBeam(beam) {
    if (!beam) return;
    beam.userData.isDead = true;
    if (Graph && Graph.scene()) {
        Graph.scene().remove(beam);
    }
    if (beam.geometry) {
        beam.geometry.dispose();
        beam.geometry = null;
    }
    if (beam.material) {
        beam.material.dispose();
        beam.material = null;
    }
}

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
    const meter = document.getElementById('shi-meter');
    hint.classList.toggle('with-shi-meter', Boolean(meter && !meter.classList.contains('hidden')));
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
    
    // 【幂等保护】同一节点已有存活光柱时，只重置计时，绝不叠第二束光。
    // 背景：拖滑杆（change 直调）+ 自己收到的 nodes_updated 广播（远端跃迁分支）
    //       会命中同一个节点，导致同一节点叠出 2~3 束光柱（"三次圣光"）。
    //       这里用 userData.nodeId 做节点级判重：同节点 → restart 计时后直接返回。
    const targetId = node.id || node.node_id;
    const nowMs = Date.now();

    // 【移动端时间窗去重】触屏下一次操作会走到本函数两次（pointerup + touchend 派生的 click，
    // 或滑杆 change 双发）；且低帧率设备上 animate() 提前判死会把 activeBeam 置 null，
    // 使下面基于 activeBeam 的判重失效。这里先按时间窗拦截，与 activeBeam 状态无关。
    if (__lastBeamStart.id === targetId && (nowMs - __lastBeamStart.t) < __BEAM_DEDUP_MS) {
        return; // 同节点、窗口内 → 完全丢弃：不续期、不新建，避免任何视觉叠加
    }

    if (activeBeam && !activeBeam.userData.isDead &&
        activeBeam.userData.nodeId === targetId) {
        if (typeof activeBeam.userData.restart === 'function') {
            activeBeam.userData.restart();
        }
        __lastBeamStart = { id: targetId, t: nowMs }; // 续期也要登记，挡住紧随其后的重复派发
        return;
    }

    // 如果已有光柱，移除它并释放 GPU 资源（只 remove 不 dispose 会持续泄漏几何体与材质）
    if (activeBeam) {
        disposeBeam(activeBeam);
        activeBeam = null;
    }

    // 【防御性清扫】清掉历史上可能残留的孤儿光柱（activeBeam 被覆盖后失去引用、但仍挂在 scene 上）
    // 只用 isDivineBeam 这一光束专属标记识别，避免误伤带 userData.nodeId 的节点网格本身
    Graph.scene().children
        .filter(obj => obj && obj.userData && obj.userData.isDivineBeam && obj !== activeBeam)
        .forEach(orphan => disposeBeam(orphan));
    
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
    const MAX_RADIUS = 4.2;
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
    beamMesh.userData.isDivineBeam = true; // 光束专属标记，供孤儿清扫与幂等判重识别
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

    let startTime = Date.now();
    const duration = 3500; 

    // 【幂等配套】同节点重复触发时只重置计时，让光柱保持常亮而不新建 mesh
    let skipRampOnRestart = false; // 【Kimi fix】续期标记：跳过 0.5s 爆发段，防止"光柱重闪"被观感为第二次圣光
    beamMesh.userData.restart = function() {
        startTime = Date.now();
        skipRampOnRestart = true;
    };

    beamMesh.userData.animate = function() {
        // 【存活守卫】disposeBeam 已把 geometry/material 置 null；若本帧之前已被销毁，
        // 继续往下执行会访问 null.geometry / 对已释放对象设 position，必须立即退出。
        // 用闭包里的 beamMesh 判断（与下方 disposeBeam(beamMesh) 一致），
        // 不依赖 this 绑定，避免调用方以不同方式取出 animate 时守卫失效。
        // 注意：失效标记由 disposeBeam 写在 userData.isDead 上，必须取 userData 下的字段。
        if (beamMesh.userData.isDead) return false;

        const elapsed = Date.now() - startTime;
        if (elapsed > duration) {
            disposeBeam(beamMesh);
            return false; 
        }
        
        let p = elapsed / duration;
        // 呼吸感：0.5秒爆发至 1.0 的最大不透明度，后缓慢变暗
        // 【Kimi fix】restart() 续期（skipRampOnRestart）时直接进入衰减段，不重放爆发段
        let intensityFactor = (p < 0.15 && !skipRampOnRestart) ? (p / 0.15) : Math.min(1, 1 - (p - 0.15) / 0.85);
        
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
    __lastBeamStart = { id: targetId, t: nowMs }; // 登记建光时刻，拦截紧随其后的重复派发

    // 【循环管理】原实现只在 beamAnimationId 为空时启动循环，但 animate() 判死后
    // 只把 activeBeam 置 null、从不重置 beamAnimationId，于是循环永远挂在 rAF 上跑空转；
    // 更重要的是没有任何机制让"无光柱"状态下的新循环被正确启动/停止。
    // 现在：无光柱 → 主动停循环并清 id；有光柱 → 继续下一帧。
    if (!beamAnimationId) {
        function renderLoop() {
            if (activeBeam) {
                const isAlive = activeBeam.userData.animate();
                if (!isAlive) activeBeam = null;
            }
            if (activeBeam) {
                beamAnimationId = requestAnimationFrame(renderLoop);
            } else {
                beamAnimationId = null; // 无光柱：停止循环，省掉空转的每帧开销
            }
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
 * 停止大股东相机跟随。用户主动操作或其他相机动画接管镜头时调用。
 */
function stopObserverCameraFollow(reason = '') {
    if (!observerCameraFollow.active) return;
    observerCameraFollow.active = false;
    observerCameraFollow.nodeId = null;
    if (observerCameraFollow.rafId !== null) {
        cancelAnimationFrame(observerCameraFollow.rafId);
        observerCameraFollow.rafId = null;
    }
    if (reason) console.log(`[观测者跟随] 已释放相机：${reason}`);
}

/**
 * 跟随只读监听，不阻止原有交互。全局 pointerdown 可覆盖节点、按钮、滑杆和导航盘。
 */
function bindObserverFollowRelease() {
    if (observerFollowReleaseBound) return;
    observerFollowReleaseBound = true;

    const releaseForPointer = () => stopObserverCameraFollow('用户主动操作');
    document.addEventListener('pointerdown', releaseForPointer, { capture: true, passive: true });
    document.addEventListener('touchstart', releaseForPointer, { capture: true, passive: true });
    document.addEventListener('wheel', (event) => {
        if (!observerCameraFollow.active || !Graph) return;
        const renderer = Graph.renderer ? Graph.renderer() : null;
        const canvas = renderer && renderer.domElement;
        if (canvas && (event.target === canvas || canvas.contains(event.target))) {
            stopObserverCameraFollow('用户缩放星图');
        }
    }, { capture: true, passive: true });
}

/**
 * 首屏和编辑恢复共用的大股东居中跟随。
 * 前 1.8 秒从当前相机平滑过渡；之后相机与观察目标使用固定相对偏移，
 * 大股东被力导向移动时，两者获得相同位移，因此大股东始终保持在屏幕中心。
 * 不固定节点坐标，不修改力导向仿真，也不发起任何数据写请求。
 */
function startObserverCameraFollow(node, distance = 500) {
    if (!Graph || !node || isGodView || typeof THREE === 'undefined') return false;
    const camera = Graph.camera ? Graph.camera() : null;
    const controls = Graph.controls ? Graph.controls() : null;
    const nodeId = node.id || node.node_id;
    if (!camera || !controls || !nodeId || nodeId !== currentBossNodeId) return false;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) return false;

    stopObserverCameraFollow();
    bindObserverFollowRelease();

    const { camPos, lookAt } = calculateOffsetView(node, distance);
    const bossWorld = new THREE.Vector3(node.x, node.y, node.z);
    if (node.__threeObj) node.__threeObj.getWorldPosition(bossWorld);

    observerCameraFollow.offset = new THREE.Vector3(
        camPos.x - lookAt.x,
        camPos.y - lookAt.y,
        camPos.z - lookAt.z
    );
    observerCameraFollow.lookAtOffset = new THREE.Vector3(
        lookAt.x - bossWorld.x,
        lookAt.y - bossWorld.y,
        lookAt.z - bossWorld.z
    );
    observerCameraFollow.nodeId = nodeId;
    observerCameraFollow.startedAt = performance.now();
    observerCameraFollow.lastFrameAt = observerCameraFollow.startedAt;
    observerCameraFollow.active = true;

    const followFrame = (now) => {
        if (!observerCameraFollow.active) return;
        observerCameraFollow.rafId = null;

        if (!Graph || isGodView || currentBossNodeId !== observerCameraFollow.nodeId) {
            stopObserverCameraFollow('大股东或视角状态已变化');
            return;
        }
        if (document.hidden) {
            observerCameraFollow.lastFrameAt = now;
            observerCameraFollow.rafId = requestAnimationFrame(followFrame);
            return;
        }

        const liveNode = Graph.graphData().nodes.find(n =>
            (n.id || n.node_id) === observerCameraFollow.nodeId
        );
        if (!liveNode || !Number.isFinite(liveNode.x) || !Number.isFinite(liveNode.y) || !Number.isFinite(liveNode.z)) {
            stopObserverCameraFollow('大股东坐标已失效');
            return;
        }

        const currentWorld = new THREE.Vector3(liveNode.x, liveNode.y, liveNode.z);
        if (liveNode.__threeObj) liveNode.__threeObj.getWorldPosition(currentWorld);
        const desiredTarget = currentWorld.clone().add(observerCameraFollow.lookAtOffset);
        const desiredCamera = desiredTarget.clone().add(observerCameraFollow.offset);

        const dt = Math.min(0.05, Math.max(0.001, (now - observerCameraFollow.lastFrameAt) / 1000));
        observerCameraFollow.lastFrameAt = now;
        const settling = now - observerCameraFollow.startedAt < 1800;
        const blend = settling ? 1 - Math.exp(-6 * dt) : 1;

        camera.position.lerp(desiredCamera, blend);
        controls.target.lerp(desiredTarget, blend);
        controls.update();

        observerCameraFollow.rafId = requestAnimationFrame(followFrame);
    };

    observerCameraFollow.rafId = requestAnimationFrame(followFrame);
    console.log(`[观测者跟随] 已启动，大股东 ${nodeId} 将保持居中，用户操作后释放`);
    return true;
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

/**
 * 更新事件视界可见性（虚化湮灭效果）
 * @param {Object} [options] 可选配置
 * @param {boolean} [options.skipLabels=false] 跳过标签「GPU 资源分配」（新建纹理 / 换 map / 重排缩放），
 *        供定时监控的轻量重绘使用。注意：标签亮度（material.color）不受此开关影响，
 *        因为它是 socketio 广播后权重变化的唯一兜底纠正通道，且只改 uniform 无显存开销。
 */
function updateEventHorizonVisibility(options) {
    if (!Graph) return;

    const opts = options || {};
    const skipLabels = !!opts.skipLabels;
    
    const { nodes } = Graph.graphData();
    const hasHorizon = horizonNodes.size > 0;
    
    let bossNode = null;
    if (hasHorizon && currentBossNodeId) {
        bossNode = nodes.find(n => n.id === currentBossNodeId || n.node_id === currentBossNodeId);
    }
    
    // 检查是否需要显示望远镜面板
    const telescopePanel = document.getElementById('telescope-panel');
    if (telescopePanel) {
        if (hasHorizon && currentBossNodeId) {
            telescopePanel.style.display = 'flex';
        } else {
            telescopePanel.style.display = 'none';
        }
    }
    
    nodes.forEach(node => {
        if (node.__threeObj) {
            const sphere = node.__threeObj.children[0];
            const sprite = node.__threeObj.children[1];

            // 悬浮 / 增量动画中的节点：其 opacity 由悬浮绽放或权重 Tween 负责，
            // 周期重绘不得覆盖，否则会出现“悬浮明度被压回视界虚化值”的闪烁。
            const isHovered = (hoverNode === node);
            const isTweening = !!(node.__threeObj.__currentMainTween || node.__threeObj.__isAnimatingOpacity);
            const skipOpacity = isHovered || isTweening;
            
            const weight = getVisualWeight(node.survival_weight);
            const baseOpacity = 0.4 + weight * 0.6;
            
            // 如果节点正在进行透明度动画，跳过视界更新，防止覆盖动画效果
            // if (node.__threeObj.__isAnimatingOpacity) return;

            const isForeignNodeForVis = (node.owner_id && node.owner_id !== currentOwnerId);
            const isSharedForeignNode = isForeignNodeForVis && !node.is_locked;

            // 如果是视界外，则执行可见性惩罚。不再为异场节点豁免虚化惩罚。
            if (hasHorizon && !horizonNodes.has(node.id)) {
                const isMemoryMode = !!new URLSearchParams(window.location.search).get('bot_id');
                let dimmedOpacity = 0;

                if (isMemoryMode) {
                    // Memory 模式专属规矩：视界外节点不透明度强制置0，彻底隐身
                    dimmedOpacity = 0;
                } else {
                    // 非 Memory 模式保留原始逻辑（或极微弱的不透明度）
                    dimmedOpacity = 0.05;
                }

                if (!skipOpacity && sphere && sphere.material) {
                    sphere.material.transparent = true;
                    sphere.material.opacity = dimmedOpacity;
                    sphere.material.needsUpdate = true;
                    // 如果透明度为0，直接隐藏
                    if (dimmedOpacity === 0) sphere.visible = false;
                }
                if (!skipOpacity && sprite && sprite.material) {
                    sprite.material.opacity = dimmedOpacity * 0.8;
                    sprite.material.needsUpdate = true;
                    if (dimmedOpacity === 0) sprite.visible = false;
                }

                // 连线隐藏
                if (Graph && typeof Graph.graphData === 'function') {
                    const { links } = Graph.graphData();
                    links.forEach(link => {
                        if ((link.source && link.source.id === node.id) || (link.target && link.target.id === node.id)) {
                            if (link.__lineObj) {
                                if (dimmedOpacity === 0) {
                                    link.__lineObj.visible = false;
                                } else {
                                    if (link.__lineObj.material) {
                                        link.__lineObj.material.transparent = true;
                                        link.__lineObj.material.opacity = dimmedOpacity;
                                    }
                                }
                            }
                            if (link.__arrowObj) {
                                if (dimmedOpacity === 0) {
                                    link.__arrowObj.visible = false;
                                } else {
                                    if (link.__arrowObj.material) {
                                        link.__arrowObj.material.transparent = true;
                                        link.__arrowObj.material.opacity = dimmedOpacity;
                                    }
                                }
                            }
                        }
                    });
                }
            } else {
                // 视界内或无视界（上帝视角）：恢复基础透明度
                
                // 【核心修复：前端距离二次校验】
                // 即便后端将其算作视界内节点，如果它在物理空间上距离大股东的相对距离超出了当前视界半径 (max_eyes) 太多，
                // 也应当强制将其虚化隐藏，保证“观测者视角”下视界边缘干净。
                let forcedHideByDistance = false;
                if (hasHorizon && bossNode && node.x !== undefined && bossNode.x !== undefined) {
                    const slider = document.getElementById('telescope-slider');
                    const maxEyes = slider ? parseFloat(slider.value) : 40; // 默认给40，与后端通常的默认值一致
                    
                    const dx = node.x - bossNode.x;
                    const dy = node.y - bossNode.y;
                    const dz = node.z - bossNode.z;
                    // 三维欧氏距离
                    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
                    
                    // 将后端的逻辑距离(maxEyes)换算成前端的物理距离阈值
                    // 注意：前端物理坐标 = 后端逻辑距离 * 3D-Force-Graph 力导向缩放系数
                    // 这个系数通常在100~300之间，这里放宽一点限制，以物理距离作为硬性屏蔽阈值
                    // 如果节点物理距离超出 800 (约等于极远边界)，并且它是异场节点，强制隐藏
                    const isForeign = (node.owner_id && node.owner_id !== currentOwnerId);
                    
                    // 假设前端物理距离与逻辑距离(maxEyes)成比例，设定一个合适的物理距离阈值
                    // 由于力导向图的坐标是动态的，距离判断不能太死，可以设为： 物理距离 > (maxEyes * 20)
                    const physicalThreshold = Math.max(800, maxEyes * 15);
                    
                    // 悬浮中的节点不参与物理距离强制剔除，避免“指哪亮哪”被瞬间压回
                    if (!isHovered && isForeign && distance > physicalThreshold) {
                        forcedHideByDistance = true;
                        console.log(`[Debug] 节点 ${node.id} 物理距离过远(${distance.toFixed(1)} > ${physicalThreshold})，强制剔除可视`);
                    }
                }
                
                if (forcedHideByDistance) {
                    if (sphere && sphere.material) {
                        sphere.material.opacity = 0;
                        sphere.visible = false;
                    }
                    if (sprite && sprite.material) {
                        sprite.material.opacity = 0;
                        sprite.visible = false;
                    }
                    if (Graph && typeof Graph.graphData === 'function') {
                        const { links } = Graph.graphData();
                        links.forEach(link => {
                            if ((link.source && link.source.id === node.id) || (link.target && link.target.id === node.id)) {
                                if (link.__lineObj) link.__lineObj.visible = false;
                                if (link.__arrowObj) link.__arrowObj.visible = false;
                            }
                        });
                    }
                    return; // 跳过后续的上帝视角恢复逻辑
                }

                if (sphere) sphere.visible = true;
                if (sprite) sprite.visible = true;
                
                // 恢复关联连线的显示
                if (Graph && typeof Graph.graphData === 'function') {
                    const { links } = Graph.graphData();
                    links.forEach(link => {
                        // 只有当连线的两端都在视界内（或者没有视界）时，才恢复连线的显示
                        const sourceInHorizon = !hasHorizon || (link.source && horizonNodes.has(link.source.id));
                        const targetInHorizon = !hasHorizon || (link.target && horizonNodes.has(link.target.id));
                        
                        if (sourceInHorizon && targetInHorizon) {
                            if (link.__lineObj) link.__lineObj.visible = true;
                            if (link.__arrowObj) link.__arrowObj.visible = true;
                        }
                    });
                }
                
                let finalOpacity = baseOpacity;

                // 如果存在视界且节点在视界内，但它是一个异场节点，不要用上帝视角的完全亮度，
                // 我们也可以给它一个特殊的亮度惩罚，确保观测者视角下异场节点的从属感
                const isForeignNodeInHorizon = isForeignNodeForVis && !node.is_locked;
                if (hasHorizon && isForeignNodeInHorizon && (node.id !== currentBossNodeId && node.node_id !== currentBossNodeId)) {
                    // 对于处于视界内的异场节点，亮度打个折，不能像本场视界节点那么亮
                    finalOpacity = Math.max(0.2, finalOpacity * 0.5); 
                }

                
                // 【新增逻辑】如果开启了配置，且处于事件视界中，且该节点在视界内，且不是大股东
                if (CONFIG_ENHANCE_HORIZON_NODES && hasHorizon && horizonNodes.has(node.id) && node.survival_weight <= 0.59) {
                    finalOpacity = baseOpacity * 1.5; // 1.5倍增益
                    
                    if (finalOpacity < 0.65) {
                        finalOpacity = 0.65; // 低亮度保底
                    }
                    if (finalOpacity > 0.95) {
                        finalOpacity = 0.95; // 高亮度上限
                    }
                }

                if (!skipOpacity && sphere && sphere.material) {
                    sphere.material.transparent = true;
                    const duty = node.action_tag;
                    if (duty === '又贞') {
                        sphere.material.opacity = finalOpacity * 0.85;
                    } else {
                        sphere.material.opacity = finalOpacity;
                    }
                    sphere.material.needsUpdate = true;
                }
                if (!skipOpacity && sprite && sprite.material) {
                    sprite.material.opacity = finalOpacity * 0.8; // 降低文字标签的亮度使其稍弱于节点本体
                    sprite.material.needsUpdate = true;
                }
            }
            
            // 每次更新事件视界时，检查并重置标签截断状态
            // 如果是大股东节点在事件视界中，必须保持非截断显示；其他则恢复截断
            //
            // 【边界约定】skipLabels 只允许跳过 GPU 资源分配（新建纹理 / 换 map / 重排缩放），
            // 绝不允许跳过 uniform 或材质状态的更新。亮度纠正必须无条件执行：
            // 它是 socketio 广播（node_updated）后权重变化 -> 标签亮度的唯一兜底通道，
            // 定时监控（:5441 传 skipLabels:true）也依赖它来完成"纠偏"。
            if (sprite && sprite.material) {
                // (A) 亮度：只写 material.color（uniform），零纹理分配，无条件执行
                const brightness = getLabelBrightness(weight);
                if (sprite.material.color) sprite.material.color.setScalar(brightness);
            }

            // (B) 纹理 / 尺寸 / 位置：这才是 skipLabels 的本意——跳过 GPU 资源分配
            if (!skipLabels && sprite && sprite.material) {
                const isBossNode = (currentBossNodeId === node.id || currentBossNodeId === node.node_id);
                const isBossInHorizon = hasHorizon && isBossNode;
                // 注意：如果该节点此时恰好被 hover（即 hoverNode === node），即使不是非大股东，也应保持非截断。
                const isHovered = (hoverNode === node);
                const shouldExpand = isBossInHorizon || isHovered;

                // 【关键修复】亮度改由材质承载，纹理只在"截断模式"真正变化时才切换。
                // 点击后全图权重都会变，原实现会对 250 个节点各重绘一张 1024x256 级纹理（显存台阶式上涨 + 卡顿）。
                // 现在：权重变化只改 material.color（零纹理分配），只有该节点进出视界/悬浮导致
                // 截断模式切换时才换 map（且换到的也是缓存里已有的纹理，不新建）。
                const prevMode = sprite.__labelExpandMode;
                if (prevMode === undefined || prevMode !== shouldExpand) {
                    const newTexture = createTextTexture(node.id, weight, getThreeInstance(), shouldExpand);
                    if (newTexture) {
                        sprite.material.map = newTexture;
                        sprite.material.needsUpdate = true;
                        sprite.__labelExpandMode = shouldExpand;

                        const baseScale = 0.3 + (weight * 0.25);
                        const spriteHeight = newTexture.baseHeight * baseScale;

                        // 位置对齐调整
                        const targetRadius = 1.2 + (weight * (4.2 - 1.2)); // 依据 MIN_RADIUS 和 MAX_RADIUS
                        const actualPhysicalRadius = targetRadius * 7; // REL_SIZE
                        sprite.position.y = actualPhysicalRadius + spriteHeight + 4;

                        // 动画中或悬浮中的标签尺寸由悬浮 Tween 负责，重绘不得写回基准值
                        if (!node.__threeObj.__isAnimatingScale && !isHovered) {
                            sprite.scale.set(newTexture.baseWidth * baseScale, spriteHeight, 1);
                        }
                    }
                }
            }
        }
    });

    // 在更新事件视界时，一并重绘连线和箭头颜色以反映最新的亮度变化
    Graph.linkColor(Graph.linkColor())
         .linkWidth(Graph.linkWidth())
         .linkDirectionalParticles(Graph.linkDirectionalParticles())
         .linkDirectionalParticleColor(Graph.linkDirectionalParticleColor())
         .linkDirectionalArrowColor(Graph.linkDirectionalArrowColor());
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
                .onUpdate(obj => { 
                    sphere.material.opacity = obj.opacity; 
                    if (sprite && sprite.material) {
                        sprite.material.opacity = obj.opacity * 0.8;
                    }
                })
                .start();
        }
    }
    
    // 动态更新未悬浮状态的纹理（截断）和悬浮时的纹理（全显示）
    if (sprite && sprite.material) {
        const weight = getVisualWeight(node.survival_weight);
        const newTexture = createTextTexture(node.id, weight, THREE, true); // true = 悬浮时不截断，所有节点悬浮时均完整显示
        const baseScale = 0.3 + (weight * 0.25);
        
        sprite.material.map = newTexture;
        sprite.material.needsUpdate = true;
        // 纹理已固定满亮，亮度统一交给材质；同时记录当前为展开态，供后续重绘判断是否需要切换
        if (sprite.material.color) sprite.material.color.setScalar(getLabelBrightness(node.survival_weight));
        sprite.__labelExpandMode = true;
        
        // 由于行数可能增加，需调整其位置以防止遮挡
        const targetRadius = 1.2 + (weight * (4.2 - 1.2)); // 依据 MIN_RADIUS 和 MAX_RADIUS
        const actualPhysicalRadius = targetRadius * 7; // REL_SIZE
        const spriteHeight = newTexture.baseHeight * baseScale;
        sprite.position.y = actualPhysicalRadius + spriteHeight + 4;
        
        // 缩放会受到 _origScale.sprite 的基准以及 BLOOM_SCALE 的影响，我们这里只需更新纹理本身的比例比例
        // 后续的 TWEEN 会基于 _origScale 来插值，所以我们要更新 _origScale 中的尺寸以匹配多行的高度
        node._origScale.sprite = new THREE.Vector3(newTexture.baseWidth * baseScale, spriteHeight, 1);
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
        // 标记缩放动画中，避免周期重绘把标签尺寸写回基准值
        node.__threeObj.__isAnimatingScale = true;
        new TWEEN.Tween({ x: orig.x, y: orig.y, z: orig.z })
            .to({ x: orig.x * BLOOM_SCALE, y: orig.y * BLOOM_SCALE, z: orig.z * BLOOM_SCALE }, DURATION)
            .easing(TWEEN.Easing.Back.Out)
            .onUpdate(obj => { sprite.scale.set(obj.x, obj.y, obj.z); })
            .onComplete(() => { node.__threeObj.__isAnimatingScale = false; })
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
            .onUpdate(obj => { 
                sphere.material.opacity = obj.opacity; 
                if (sprite && sprite.material) {
                    sprite.material.opacity = obj.opacity * 0.8;
                }
            })
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
        // 还原截断纹理（但如果是视界中的大股东节点则依然保持展开）
        const weight = getVisualWeight(node.survival_weight);
        
        const hasHorizon = horizonNodes && horizonNodes.size > 0;
        const isBossNode = (currentBossNodeId === node.id || currentBossNodeId === node.node_id);
        const shouldExpand = (hasHorizon && isBossNode);
        
        const reboundTexture = createTextTexture(node.id, weight, THREE, shouldExpand);
        const baseScale = 0.3 + (weight * 0.25);
        
        sprite.material.map = reboundTexture;
        sprite.material.needsUpdate = true;
        // 与创建/悬浮逻辑保持一致：亮度由材质承载，并记录当前截断模式
        if (sprite.material.color) sprite.material.color.setScalar(getLabelBrightness(node.survival_weight));
        sprite.__labelExpandMode = shouldExpand;
        
        const targetRadius = 1.2 + (weight * (4.2 - 1.2));
        const actualPhysicalRadius = targetRadius * 7;
        const spriteHeight = reboundTexture.baseHeight * baseScale;
        sprite.position.y = actualPhysicalRadius + spriteHeight + 4;
        
        const target = new THREE.Vector3(reboundTexture.baseWidth * baseScale, spriteHeight, 1);
        
        // 标记缩放动画中，避免周期重绘把标签尺寸写回基准值
        node.__threeObj.__isAnimatingScale = true;
        new TWEEN.Tween({ x: sprite.scale.x, y: sprite.scale.y, z: sprite.scale.z })
            .to({ x: target.x, y: target.y, z: target.z }, DURATION)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onUpdate(obj => { sprite.scale.set(obj.x, obj.y, obj.z); })
            .onComplete(() => {
                node.__threeObj.__isAnimatingScale = false;
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

// --- [星际 HUD 信息栏] ---
let starHudCollapsed = false;
const STAR_HUD_STORAGE_KEY = () => `star_hud_collapsed_${window.currentOwnerId || 'default'}_${window.currentActorId || 'guest'}`;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateStarHud(node) {
    const headerHud = document.getElementById('header-hud');
    const headerH1 = document.querySelector('#header h1');
    if (!headerHud) return;
    if (!node) {
        headerHud.classList.remove('active');
        if (headerH1) headerH1.style.display = '';
        return;
    }
    if (headerH1) headerH1.style.display = 'none';
    const serialEl = document.getElementById('hud-serial');
    const weightEl = document.getElementById('hud-weight');
    const eventEl = document.getElementById('hud-event');

    const serialId = node.serial_id || node.本事件ID || '未知';
    const weight = parseFloat(node.survival_weight || 0).toFixed(10);
    const weightValue = parseFloat(weight);

    let weightStatus = '🩸'; //微弱
    if (weightValue >= 0.9) weightStatus = '🩸🩸🩸🩸🩸'; //强盛🩸🩸🩸🩸💧♡⛽
    else if (weightValue >= 0.6) weightStatus = '🩸🩸🩸🩸'; //活跃
    else if (weightValue >= 0.3) weightStatus = '🩸🩸🩸'; //稳健
    else if (weightValue >= 0.1) weightStatus = '🩸🩸'; //衰减


    // let weightStatus = '💧';
    // if (weightValue >= 0.9) weightStatus = '🩸████'; // 强盛
    // else if (weightValue >= 0.6) weightStatus = '🩸███'; // 活跃
    // else if (weightValue >= 0.3) weightStatus = '🩸██'; // 稳健
    // else if (weightValue >= 0.1) weightStatus = '🩸█'; // 衰减


    let eventTuple = node.event_tuple || node.content || '无事件叙述';
    // 使用 Array.from 安全拆分，防止截断 Unicode 代理对（Emoji/罕见汉字）
    const maxLen = window.innerWidth <= 768 ? 25 : 40;
    const tupleChars = Array.from(eventTuple);
    if (tupleChars.length > maxLen) {
        eventTuple = tupleChars.slice(0, maxLen).join('') + '...';
    }

    if (serialEl) serialEl.innerHTML = `序列 <span class="hud-s-val">${escapeHtml(serialId)}</span>`;
    if (weightEl) weightEl.innerHTML = `权重 <span class="hud-w-val">${weight}</span> <span class="hud-w-stat">${weightStatus}</span>`;
    if (eventEl) {
        eventEl.textContent = eventTuple;
        // 强制触发 DOM 重排，解决部分浏览器 UI 不更新的 Bug
        void eventEl.offsetHeight;
    }

    headerHud.classList.add('active');
}

function initStarHud() {
    console.log('[Star HUD] 初始化完成');
}


/**
 * 【标签亮度】权重 -> 材质灰度的映射。
 *
 * 原实现把亮度烘进 canvas 文本颜色（rgb(0.5w~0.9w)），导致同一节点只要权重变化
 * 就必须重绘整张纹理。改为：纹理固定画满亮白字，亮度改由 SpriteMaterial.color 承载。
 *
 * 数学等价（非近似）：
 *   原：纹理色 255 * 0.62 = 158，材质色 白(255) -> 最终 158
 *   新：纹理色 255，        材质色 158      -> 最终 158
 * 因此视觉完全不变，但纹理可与权重彻底解耦并缓存复用。
 */
function getLabelBrightness(weight) {
    const weightValue = getVisualWeight(weight);
    return 0.5 + (weightValue * 0.4); // 0.5 ~ 0.9，与原实现同一条曲线
}

/**
 * 【标签纹理缓存】键只含 文本内容 + 截断模式，不含权重。
 *
 * 点击节点后全图权重都会变化，若缓存键含权重则全部失效、等于没缓存；
 * 而文本内容与截断模式在一次会话中极少变化，因此缓存命中率接近 100%，
 * 点击时的 GPU 纹理分配峰值（250 张 1024x256 级纹理）随之消失。
 */
const __labelTextureCache = new Map();
const __LABEL_TEXTURE_CACHE_MAX = 1024;

/** 清空标签纹理缓存（节点大规模变更时调用，避免旧纹理长期占用显存） */
function clearLabelTextureCache() {
    __labelTextureCache.forEach(tex => { try { tex.dispose && tex.dispose(); } catch (e) {} });
    __labelTextureCache.clear();
}

/** 超采样文字纹理渲染：确保 ID 极致清晰，使用2的幂次方尺寸避免警告 */
function createTextTexture(text, weight, THREE, isHovered = false) {
    // 设置每行最大字符数
    const MAX_LENGTH_PER_LINE = 10;
    
    // 如果未被悬浮，截断显示并加省略号，此时只有单行
    let displayText = text || '';
    if (!isHovered && displayText.length > MAX_LENGTH_PER_LINE) {
        displayText = displayText.substring(0, MAX_LENGTH_PER_LINE) + '...';
    }

    // 缓存键：只含文本与截断模式，不含权重（亮度已移交材质）
    const cacheKey = `${isHovered ? 'F' : 'S'}|${displayText}`;
    const cached = __labelTextureCache.get(cacheKey);
    if (cached) return cached;
    
    // 将长文本分割成多行
    const lines = [];
    
    if (!isHovered) {
        // 未悬浮时，直接作为单行，不要被 substring 截断
        lines.push(displayText);
    } else {
        // 悬浮时，根据最大字符数分行
        for (let i = 0; i < displayText.length; i += MAX_LENGTH_PER_LINE) {
            lines.push(displayText.substring(i, i + MAX_LENGTH_PER_LINE));
        }
    }
    if (lines.length === 0) lines.push('');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = 4;
    ctx.font = `${32 * scale}px "Fira Code"`;
    
    // 找出最长的一行计算宽度
    let maxTextWidth = 0;
    for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > maxTextWidth) {
            maxTextWidth = w;
        }
    }
    
    const padding = 6 * scale; // 增加padding让底座更好看
    const lineHeight = 38 * scale;
    
    // 计算2的幂次方尺寸，避免THREE调整警告
    const calculatePowerOfTwo = (size) => {
        return Math.pow(2, Math.ceil(Math.log2(size)));
    };
    
    const rawWidth = maxTextWidth + padding * 2;
    // 总高度根据行数计算
    const rawHeight = (lines.length * lineHeight) + padding * 2; 
    
    // 使用2的幂次方尺寸
    canvas.width = calculatePowerOfTwo(rawWidth);
    canvas.height = calculatePowerOfTwo(rawHeight);
    
    // 计算居中位置
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // 绘制半透明微光底座
    const bgWidth = maxTextWidth + padding * 1.5;
    const bgHeight = (lines.length * lineHeight) + padding;
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
    
    // 标签亮度不再烘进纹理：固定画满亮白字，权重亮度由 SpriteMaterial.color 承载。
    // 这样同一文本的纹理可被所有节点、所有权重状态复用，点击重排时无需重建。
    const textColor = 'rgb(255, 255, 255)';
    
    // 添加黑色发光阴影，确保在明亮星云背景下依然清晰可读
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 6 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1.5 * scale;
    
    ctx.fillStyle = textColor; 
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'middle';
    
    // 绘制多行文字
    // 计算第一行的 centerY (基于整体居中)
    const startY = centerY - (lines.length * lineHeight) / 2 + lineHeight / 2;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineY = startY + i * lineHeight;
        // 绘制两次文字以增强阴影的厚重感
        ctx.fillText(line, centerX, lineY);
        ctx.fillText(line, centerX, lineY);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.baseWidth = rawWidth / scale; 
    texture.baseHeight = rawHeight / scale;
    
    // 设置纹理过滤和包装模式
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    // 写入缓存（超限时淘汰最早的条目并释放其 GPU 资源）
    if (__labelTextureCache.size >= __LABEL_TEXTURE_CACHE_MAX) {
        const oldestKey = __labelTextureCache.keys().next().value;
        const oldestTex = __labelTextureCache.get(oldestKey);
        __labelTextureCache.delete(oldestKey);
        try { oldestTex && oldestTex.dispose && oldestTex.dispose(); } catch (e) {}
    }
    __labelTextureCache.set(cacheKey, texture);

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
            body: JSON.stringify(appendAuthBody({ node_id: node.id }))
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

// --- 相事件“势”：只由 /click 响应驱动，不进入逐帧渲染 ---
let shiObservationVersion = 0;
let shiObservationFocal = null;

function hideShiMeter() {
    const meter = document.getElementById('shi-meter');
    if (meter) meter.classList.add('hidden');
}

function cancelShiObservation() {
    // 跨场或退出观测者视角时作废旧响应，避免上一场仪轨残留或被回写。
    shiObservationVersion += 1;
    shiObservationFocal = null;
    hideShiMeter();
}

function setShiArcProgress(pct) {
    const offset = String(100 - Math.max(0, Math.min(100, pct)));
    const arc = document.getElementById('shi-meter-arc');
    const crest = document.getElementById('shi-meter-arc-crest');
    if (arc) arc.style.strokeDashoffset = offset;
    if (crest) crest.style.strokeDashoffset = offset;
}

function beginShiObservation(node) {
    const version = ++shiObservationVersion;
    // 保存本次真实焦点；搜索结果可能尚未加载到图中，此时先隐藏，等待响应确认。
    shiObservationFocal = node ? { blockTag: node.block_tag || null } : null;
    const meter = document.getElementById('shi-meter');
    if (!meter) return version;
    if (!node || node.block_tag !== '相') {
        hideShiMeter();
        return version;
    }
    meter.classList.remove('hidden');
    meter.dataset.state = 'loading';
    document.getElementById('shi-meter-state').textContent = '正在观测';
    document.getElementById('shi-meter-value').textContent = '—';
    document.getElementById('shi-meter-detail').textContent = '正在生成当前相事件视界';
    setShiArcProgress(0);
    meter.title = '每次点击均根据当前距离与关系重新观测，不使用旧势值';
    return version;
}

function applyShiObservation(data, version) {
    if (version !== shiObservationVersion) return;
    const meter = document.getElementById('shi-meter');
    if (!meter) return;
    const responseFocal = data && data.data && typeof data.data === 'object' ? data.data : null;
    // 响应焦点优先于本地标签；非相焦点即使异常携带 shi_meta 也绝不显示仪轨。
    const focalBlockTag = responseFocal && typeof responseFocal.block_tag === 'string'
        ? responseFocal.block_tag
        : (shiObservationFocal && shiObservationFocal.blockTag);
    if (!data || data.status !== 'success' || focalBlockTag !== '相' || !data.shi_meta) {
        hideShiMeter();
        return;
    }
    const meta = data.shi_meta;
    const value = (typeof data.shi === 'number' && Number.isFinite(data.shi)) ? data.shi : null;
    const isEmpty = meta.sample_count === 0 || meta.reason === 'no_samples' || meta.reason === 'private_focal';
    const state = isEmpty ? 'empty' : (meta.status === 'partial' ? 'partial' : (value === null ? 'error' : 'complete'));
    meter.classList.remove('hidden');
    meter.dataset.state = state;
    document.getElementById('shi-meter-state').textContent = {
        empty: '暂无可比较样本',
        partial: '部分观测',
        error: '本次势暂不可得',
        complete: ''
    }[state];
    document.getElementById('shi-meter-value').textContent = value === null ? '—' : value.toFixed(2);
    setShiArcProgress(value === null ? 0 : value);
    const details = [];
    if (isEmpty) {
        details.push(meta.reason === 'private_focal' ? '私密焦点不参与势计算' : '视界内只有焦点相事件');
    } else {
        details.push(`样本 ${meta.sample_count || 0}`);
        details.push(`同向 ${meta.same_count || 0}`);
        details.push(`反向 ${meta.opposite_count || 0}`);
        if (meta.uncertain_count) details.push(`不确定 ${meta.uncertain_count}`);
    }
    if (meta.truncated) details.push('候选已截断');
    document.getElementById('shi-meter-detail').textContent = details.join(' · ');
    meter.title = `观测时刻：${meta.observed_at || '本次'}；公式版本：${meta.formula_version || '1.0'}`;
}

function failShiObservation(version) {
    if (version === shiObservationVersion) hideShiMeter();
}

/**
 * 提升节点权重（与原始实现一致）
 * @param {Object} node 目标节点
 * @param {Number} maxEyes 可选，望远镜倍率
 */
async function promoteNodeWeight(node, maxEyes = null) {
    if (!node || !node.id) {
        console.error('提升权重失败：节点或节点ID为空');
        return;
    }

    // 【本地操作登记】这是本地主动发起的权重提升，其广播回声不应被当作远端跃迁，
    // 否则本机会额外叠一束圣光并把镜头抢走（远端客户端不受影响，只需屏蔽本机）。
    lastLocalActionTime = Date.now();
    const shiVersion = beginShiObservation(node);
    
    try {
        console.log(`尝试提升节点 ${node.id} 到所有节点总权重的60%`);
        
        // 获取当前用户ID和拥有者ID
        const actorId = window.currentActorId || '';
        const ownerId = window.currentOwnerId || 'default';
        
        // 优先使用 /api/v1/causal/click 接口，因为它支持 max_eyes 参数并能返回视界数据
        const requestData = { 
            serial_id: node.serial_id || node.id, // 兼容处理，click接口需要serial_id
            owner_id: ownerId !== 'default' ? ownerId : undefined
        };
        if (window.currentBotId) {
            requestData.bot_id = window.currentBotId;
        }
        
        if (actorId) {
            requestData.actor_id = actorId;
        }
        
        if (maxEyes !== null) {
            requestData.max_eyes = maxEyes;
        }
        
        console.log(`[权重提升] 请求数据:`, requestData);
        
        // 使用 click 接口替代 promote_chain，以支持视界计算
        const response = await fetch('/api/v1/causal/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appendAuthBody(requestData))
        });
        
        const data = await response.json();
        console.log(`[权重提升] API响应:`, data);
        applyShiObservation(data, shiVersion);
        
        if (data.status === 'success') {
            selectNode = true;
            selectedNodeObj = node;
            currentBossNodeId = data.boss_node_id || node.id; // 记录当前大股东
            // /click 已返回完整视界，不依赖 socket 广播的到达时序。
            // 编辑保存后的恢复观测者视角与滑杆调整都复用这条同步路径。
            horizonNodes.clear();
            if (Array.isArray(data.event_horizon)) {
                data.event_horizon.forEach(id => horizonNodes.add(id));
            }
            isGodView = false;
            const viewBtn = document.getElementById('btn-fit-view');
            if (viewBtn) viewBtn.setAttribute('data-tooltip', '上帝视角');
            updateHighlight();
            if (!actorId && !data.actor_id) {
                console.log(`匿名观测完成: ${data.message}`);
                showSelectionHint('匿名观测完成，未写入权重');
            } else {
                console.log(`全局权重提升成功: ${data.message}`);
                showSelectionHint(`节点权重已提升到所有节点总权重的60%，更新了 ${data.updated_count} 个节点。等待Socket.IO广播具体权重...`);
            }
            return true;
        } else {
            console.log(`全局权重提升失败: ${data.message}`);
            showSelectionHint(`全局权重提升失败: ${data.message}`);
            return false;
        }
    } catch (error) {
        failShiObservation(shiVersion);
        console.error(`全局权重提升失败:`, error);
        showSelectionHint(`全局权重提升失败: ${error.message}`);
        return false;
    }
}

// --- [3. 数据交互与 Socket 逻辑] ---

/**
 * 全量重载的并发合并器。
 * 高频广播（批量 node_updated / Socket 重连 / 连续表单保存）时只保留最后一次请求，
 * 防止 N 个 reload 同时改写 Graph.graphData，导致坐标 NaN、相机抖动与"重绘不断"。
 */
const __loadState = {
    inFlight: false,     // 是否正在请求 / 渲染
    queued: false,       // 期间是否又有新的重载请求
    timer: null,         // 防抖定时器
    waiters: [],         // 本批次所有调用方的 resolve，批次结束时统一唤醒
    hasLoadedOnce: false,// 是否已完成过首帧
    hasAutoFitted: false,// 是否已做过一次自动取景（后台重载不再抢镜头）
    urlFocusDone: false  // 是否已执行过 URL serial_id 自动聚焦（防止 /click -> 重载 -> /click 回环）
};

function loadInitialData(options) {
    const opts = options || {};
    const delay = (opts.immediate || !__loadState.hasLoadedOnce) ? 0 : 250;

    return new Promise((resolve) => {
        // 合流：本轮所有调用共享同一次请求，批次结束时统一 resolve
        __loadState.waiters.push(resolve);

        if (__loadState.inFlight) {
            __loadState.queued = true;
            return;
        }
        if (__loadState.timer) {
            return; // 已有待执行批次，等它跑完即可
        }

        __loadState.timer = setTimeout(async () => {
            __loadState.timer = null;

            if (__loadState.inFlight) {
                __loadState.queued = true;
                return;
            }

            __loadState.inFlight = true;
            try {
                await fetchAndRenderGraph(opts);
            } finally {
                __loadState.inFlight = false;
                // 唤醒本轮全部等待者，避免调用方 await 悬挂
                const waiters = __loadState.waiters.splice(0);
                waiters.forEach(fn => fn());
                if (__loadState.queued) {
                    __loadState.queued = false;
                    // 合并期间又有新数据：再跑一次（后台模式，不再动相机）
                    loadInitialData({ background: true });
                }
            }
        }, delay);
    });
}

/**
 * 为缺少有效坐标的节点播种（黄金角球面分布）。
 * 3d-force-graph 在数据整体替换后，新 node 对象要等首帧 tick 才有坐标，
 * 期间读取 x/y/z 会得到 NaN，进而触发"大股东节点坐标无效"与 NaN 自检风暴。
 */
function seedNodePositions(nodes) {
    if (!nodes || !nodes.length) return;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const R = 320;
    const total = nodes.length;
    let idx = 0;
    nodes.forEach(node => {
        const ok = Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z);
        if (ok) return;
        const i = idx++;
        const y = total > 1 ? 1 - (i / (total - 1)) * 2 : 0;
        const ring = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = golden * i;
        node.x = Math.cos(theta) * ring * R;
        node.y = y * R;
        node.z = Math.sin(theta) * ring * R;
        if (!Number.isFinite(node.vx)) node.vx = 0;
        if (!Number.isFinite(node.vy)) node.vy = 0;
        if (!Number.isFinite(node.vz)) node.vz = 0;
    });
}

async function fetchAndRenderGraph(options) {
    const opts = options || {};
    try {
        const actorId = window.currentActorId || '';
        const ownerId = window.currentOwnerId || 'default';
        const botId = window.currentBotId || null;
        
        // 构建查询参数
        const params = new URLSearchParams();
        if (actorId) {
            params.append('actor_id', actorId);
        }
        if (ownerId && ownerId !== 'default') {
            params.append('owner_id', ownerId);
        }
        if (botId) {
            params.append('bot_id', botId);
        }
        
        const url = `/api/v1/causal/history${params.toString() ? '?' + params.toString() : ''}`;
        console.log(`[数据加载] 请求URL: ${url}`);
        
        const response = await fetch(appendAuthParams(url));
        const res = await response.json();
        
        if (res.status === 'success' && Array.isArray(res.data)) {
            console.log(`[数据加载] 成功加载 ${res.data.length} 个节点，owner_id: ${ownerId}`);
            
            // 【平滑重载】沿用上一帧的坐标 / 速度 / 锁定，避免每次重载都从 NaN 重新布局
            const prevById = new Map();
            if (Graph) {
                Graph.graphData().nodes.forEach(prev => {
                    if (prev && prev.id !== undefined) prevById.set(prev.id, prev);
                });
            }

            // 构建节点列表：优先继承旧坐标；被选中的节点保留物理锁定坐标
            const nodes = res.data.map(node => {
                const prev = prevById.get(node.node_id);
                const isSelected = selectedNodeObj && selectedNodeObj.id === node.node_id;
                const merged = {
                    id: node.node_id,
                    ...node
                };
                if (prev) {
                    ['x', 'y', 'z', 'vx', 'vy', 'vz', 'fx', 'fy', 'fz'].forEach(k => {
                        const v = prev[k];
                        if (v !== undefined && v !== null && !Number.isNaN(v)) merged[k] = v;
                    });
                }
                if (isSelected) {
                    merged.fx = selectedNodeObj.fx;
                    merged.fy = selectedNodeObj.fy;
                    merged.fz = selectedNodeObj.fz;
                } else {
                    // 非选中节点一律释放物理锁定，避免上一轮的 pin 残留
                    merged.fx = null;
                    merged.fy = null;
                    merged.fz = null;
                }
                // 同步写入增量缓存，让后续 node_updated 命中缓存走增量路径而非全量重载
                cacheSetNode(merged);
                return merged;
            });

            // 建立快速索引，用于严格校验连线关系
            const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

            // 严格构建连线：只有当父子节点都实际存在于 nodes 数组中时，才建立连线
            const links = [];
            res.data.forEach(nodeData => {
                const parents = nodeData.parent_ids || nodeData.previous_ids || (nodeData.parent_id ? [nodeData.parent_id] : (nodeData.previous_id ? [nodeData.previous_id] : []));
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
            // 【初值播种】为新节点赋予确定性球面初值，杜绝整图 NaN
            seedNodePositions(Graph.graphData().nodes);
            __loadState.hasLoadedOnce = true;

            // history 是大股东与视界状态的权威来源。必须在等待 Three.js 对象前同步，
            // 并覆盖旧值：编辑改名或副本清理后，旧 boss 可能已不存在，
            // 否则后续滑杆仍会瞄定旧 ID，且因为没有有效 boss 而静默失效。
            currentBossNodeId = res.boss_node_id || null;
            horizonNodes.clear();
            if (Array.isArray(res.event_horizon)) {
                res.event_horizon.forEach(id => horizonNodes.add(id));
            }
            if (!currentBossNodeId || horizonNodes.size === 0) {
                isGodView = true;
                stopObserverCameraFollow('history 中没有有效大股东或事件视界');
            }
            
            // 坐标自检（只做补救，不再重灌数据，避免重新引爆仿真）
            setTimeout(() => {
                const currentNodes = Graph.graphData().nodes;
                const nanNodes = currentNodes.filter(n => !Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z));
                if (nanNodes.length > 0) {
                    console.warn(`[3D星空] 补齐 ${nanNodes.length} 个畸形坐标节点（不再触发全图重绘）`);
                    seedNodePositions(currentNodes);
                    if (Graph.refresh) Graph.refresh();
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
                currentBossNodeId = res.boss_node_id;
                
                setTimeout(() => {
                    const latestNodes = Graph.graphData().nodes;
                    const bossNode = latestNodes.find(n => n.id === res.boss_node_id || n.node_id === res.boss_node_id);
                    
                    if (bossNode) {
                        // 视界集合已在收到 history 响应时同步，这里只处理视角与相机。
                        updateHighlight();
                        // 任何时候后端返回新的事件视界，都要退出上帝视角强制进入观测者视角
                        if (isGodView) {
                            isGodView = false;
                            const btn = document.getElementById('btn-fit-view');
                            if (btn) btn.setAttribute('data-tooltip', '上帝视角');
                        }

                        
                        // 聚焦到大股东节点（仅首帧 / 主动刷新时执行，后台重载不再抢镜头）
                        const shouldAutoFrame = !opts.background && !__loadState.hasAutoFitted;
                        if (shouldAutoFrame) {
                            if (!isNaN(bossNode.x) && !isNaN(bossNode.y) && !isNaN(bossNode.z)) {
                                startObserverCameraFollow(bossNode, 500);
                                __loadState.hasAutoFitted = true;
                                console.log(`[事件视界] 已进入事件视界模式，以 ${res.boss_node_id} 为中心`);
                            } else {
                                console.warn(`[事件视界] 大股东节点坐标无效，降级为全局适应`);
                                Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200);
                                __loadState.hasAutoFitted = true;
                            }
                        }
                    } else {
                        console.warn(`[事件视界] 未找到大股东节点 ${res.boss_node_id} 在渲染数据中`);
                        // 降级：仅做适应视图（同样只在首帧）
                        if (!opts.background && !__loadState.hasAutoFitted) {
                            Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200);
                            __loadState.hasAutoFitted = true;
                        }
                    }
                }, 800);
            } else if (!selectedNodeObj && !opts.background && !__loadState.hasAutoFitted) {
                // 防跳跃逻辑：如果没有选中任何节点，才执行一次全局缩放适应
                setTimeout(() => {
                    Graph.cameraPosition({ x: 0, y: 0, z: 900 }, { x: 0, y: 0, z: 0 }, 1200);
                    __loadState.hasAutoFitted = true;
                }, 600);
            }

            // URL 参数自动聚焦逻辑
            // 【关键修复】只在首次加载时执行一次。
            // 这段代码位于 fetchAndRenderGraph 内，而 loadInitialData 会在 node_deleted / field_deleted /
            // 巡航等场景反复调用；若不加一次性保护，就会形成
            //   /click -> 后端重排 -> node_updated -> 前端重载 -> 1 秒后又打 /click 的死循环，
            // 每次循环都触发一轮全量重排与标签纹理重建，是显存台阶式上涨与卡顿的放大器。
            const urlParams = new URLSearchParams(window.location.search);
            const urlSerialId = urlParams.get('serial_id');
            if (urlSerialId && !__loadState.urlFocusDone && !opts.background) {
                __loadState.urlFocusDone = true;
                console.log(`[URL聚焦] 检测到 serial_id=${urlSerialId}，准备自动聚焦（仅首次）`);
                const urlMaxEyes = urlParams.get('max_eyes');
                
                // 直接调用后端接口，利用其从地宫恢复节点的强大逻辑
                setTimeout(() => {
                    if (window.handleSearchResultClick) {
                        window.handleSearchResultClick(urlSerialId, null, urlMaxEyes);
                    }
                }, 1000);
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

    // 【关键修复】Graph 节点快速索引（id / node_id / serial_id 三侧），
    // 避免对每个广播节点都做一次 graphNodes.find 线性扫描（N 个广播 -> O(N^2) 卡顿）。
    // 同时它是"是否真的需要新建节点"的权威判据：命中即更新，绝不重复建 THREE 对象。
    const graphNodeIndex = new Map();
    if (Array.isArray(graphNodes)) {
        graphNodes.forEach(n => {
            if (!n) return;
            if (n.id !== undefined && n.id !== null && n.id !== '') graphNodeIndex.set(String(n.id), n);
            if (n.node_id !== undefined && n.node_id !== null && n.node_id !== '') graphNodeIndex.set(String(n.node_id), n);
            if (n.serial_id !== undefined && n.serial_id !== null && n.serial_id !== '') graphNodeIndex.set(String(n.serial_id), n);
        });
    }
    // 本轮回调内新建的节点也要能立刻被后续条目命中（同一批广播可能重复出现同一 id）
    const __graphLookup = (serialId, nodeId) => {
        if (serialId !== undefined && serialId !== null && serialId !== '') {
            const hit = graphNodeIndex.get(String(serialId));
            if (hit) return hit;
        }
        if (nodeId !== undefined && nodeId !== null && nodeId !== '') {
            const hit = graphNodeIndex.get(String(nodeId));
            if (hit) return hit;
        }
        return null;
    };
    const __graphRegister = (gNode) => {
        if (!gNode) return;
        if (gNode.id !== undefined && gNode.id !== null && gNode.id !== '') graphNodeIndex.set(String(gNode.id), gNode);
        if (gNode.node_id !== undefined && gNode.node_id !== null && gNode.node_id !== '') graphNodeIndex.set(String(gNode.node_id), gNode);
        if (gNode.serial_id !== undefined && gNode.serial_id !== null && gNode.serial_id !== '') graphNodeIndex.set(String(gNode.serial_id), gNode);
    };
    
    // 收集本轮广播中"图里还没有"的节点与连线，循环结束后统一并入一次，
    // 避免逐条 node_updated 都重灌 Graph.graphData 造成仿真重启与重绘抖动。
    const pendingNewNodes = [];
    const pendingNewLinks = [];

    list.forEach(uNode => {
        // 1. 首先尝试使用serial_id
        const sid = uNode.serial_id || uNode["本事件ID"];
        // 2. 如果找不到，尝试使用node_id
        const nid = uNode.node_id || uNode["本事件标题"];
        const newWeight = (uNode.survival_weight !== undefined && uNode.survival_weight !== null)
            ? uNode.survival_weight
            : uNode["本事件权重"];
        
        // 尝试多种查找方式更新缓存
        // 走归一索引：serial_id / node_id 任一侧命中即可 O(1) 命中，
        // 避免本场已有节点因键不一致被误判成"新节点"而重复并入 Graph（显存成倍增长的根因）。
        let cacheNode = __lookupNode(sid, nid);
        if (!cacheNode && nid !== undefined && nid !== null && nid !== '') {
            // 兜底：极少数历史数据节点既无 node_id 也无 serial_id，只登记过 id，补一次
            cacheNode = __lookupNode(nid, nid);
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
            // 补齐新出现的 serial_id / node_id 键，后续同一节点的广播可直接命中
            __indexNode(cacheNode);
        } else {
            console.warn(`[SocketIO] 警告：未找到缓存节点，作为新节点增量并入缓存，serial_id: ${sid}, node_id: ${nid}`);
            cacheNode = Object.assign({}, uNode);
            cacheNode.id = nid;
            cacheSetNode(cacheNode);
        }

        // 【关键修复1】同步更新 Graph 内部的节点数据引用，否则引擎读取的永远是旧数据
        if (Graph && graphNodes) {
            let gNode = __graphLookup(sid, nid);
            if (!gNode) {
                // 二次守卫：Graph 里没有、但归一索引里已有这个节点（说明它曾在图中、因某次全量重载
                // 被移出），此时以缓存的对象为基准合并，不引入新的身份。
                const existedInCache = !!cacheNode.__isIndexedOnce;
                gNode = Object.assign({ id: nid }, cacheNode);
                if (existedInCache) gNode.__isIndexedOnce = true;
                // 贴着父节点出生，避免新节点从原点飞入
                let rawParents = cacheNode.parent_ids || cacheNode.previous_ids
                    || cacheNode.previous_node || cacheNode.parent_id || [];
                if (typeof rawParents === 'string') rawParents = rawParents.split('|');
                if (!Array.isArray(rawParents)) rawParents = [rawParents];
                const parentRefs = rawParents
                    .filter(Boolean)
                    .map(p => __graphLookup(p, p))
                    .filter(Boolean);
                const anchor = parentRefs.length ? parentRefs[0] : graphNodes[0];
                if (anchor && Number.isFinite(anchor.x)) {
                    const jitter = 24;
                    gNode.x = anchor.x + (Math.random() - 0.5) * jitter;
                    gNode.y = anchor.y + (Math.random() - 0.5) * jitter;
                    gNode.z = anchor.z + (Math.random() - 0.5) * jitter;
                    gNode.vx = 0; gNode.vy = 0; gNode.vz = 0;
                }
                parentRefs.forEach(p => {
                    pendingNewLinks.push({ source: p.id, target: gNode.id, type: 'causal' });
                });
                pendingNewNodes.push(gNode);
                __graphRegister(gNode);
            }
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
                    const MAX_RADIUS = 4.2; // 统一为全局一致的 9.0
                    const REL_SIZE = 7;
                    const w = getVisualWeight(gNode.survival_weight);
                    const targetRadius = MIN_RADIUS + (w * (MAX_RADIUS - MIN_RADIUS));
                    const targetPhysicalRadius = targetRadius * REL_SIZE;
                    
                    const mainSprite = gNode.__threeObj.children[0];
                    if (mainSprite && mainSprite.isSprite) {
                        const spriteScale = targetPhysicalRadius * 2.5;
                        let baseOpacity = 0.4 + w * 0.6;
                        if (gNode.action_tag === '又贞') baseOpacity *= 0.85;
                        
                        // 考虑事件视界状态
                        const hasHorizon = typeof horizonNodes !== 'undefined' && horizonNodes.size > 0;
                        const currentOwnerIdForOpacity = new URLSearchParams(window.location.search).get('owner_id') || 'default';
                        const isForeignNodeOpacity = (gNode.owner_id && gNode.owner_id !== currentOwnerIdForOpacity);
                        const isSharedForeignNodeOpacity = isForeignNodeOpacity && !gNode.is_locked;
                        
                        const isOutsideHorizon = hasHorizon && !horizonNodes.has(gNode.id);
                        let targetOpacity = baseOpacity;
                        if (isOutsideHorizon) {
                            let dimmedOpacity = 0;
                            if (currentBossNodeId) {
                                const { nodes } = Graph.graphData();
                                const bossNode = nodes.find(n => n.id === currentBossNodeId || n.node_id === currentBossNodeId);
                                if (bossNode && gNode.x !== undefined && bossNode.x !== undefined) {
                                    const dx = gNode.x - bossNode.x;
                                    const dy = gNode.y - bossNode.y;
                                    const dz = gNode.z - bossNode.z;
                                    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
                                    const w = getVisualWeight(gNode.survival_weight);
                                    const distancePenalty = (w * 100) / distance;
                                    dimmedOpacity = Math.min(baseOpacity, baseOpacity * 0.3 * distancePenalty);
                                }
                            }
                            // 强制统一由 updateEventHorizonVisibility 控制，不在此处重新计算
                            targetOpacity = 0.05;
                        }
                        
                        // 使用 Tween 平滑过渡
                        if (typeof TWEEN !== 'undefined') {
                            // 停止之前可能正在运行的动画，防止多端高频同步时动画冲突导致更新不完全
                            if (gNode.__threeObj.__currentMainTween) {
                                gNode.__threeObj.__currentMainTween.stop();
                            }
                            
                            gNode.__threeObj.__currentMainTween = new TWEEN.Tween({ 
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
                                // 【修复】不再在此处更新 opacity：node_updated 的透明度 Tween 会覆盖
                                // updateEventHorizonVisibility 依据最新视界(horizonNodes)计算的虚化结果，
                                // 导致 Memory 模式点击后“除大股东外其它节点一律显示”。
                                // opacity 统一由 horizon_updated 广播触发 updateEventHorizonVisibility 控制。
                                // 同步缩放光柱
                                if (typeof activeBeam !== 'undefined' && activeBeam && activeBeam.userData.nodeId === (gNode.id || gNode.node_id)) {
                                    const currentPhysicalRadius = obj.scale / 2.5;
                                    const scaleFactor = currentPhysicalRadius / targetPhysicalRadius;
                                    activeBeam.scale.set(scaleFactor, 1, scaleFactor);
                                }
                            })
                            .onComplete(() => {
                                gNode.__threeObj.__currentMainTween = null;
                                gNode.__threeObj.__isAnimatingOpacity = false;
                                // 缩放动画结束后，重新应用事件视界虚化，确保 opacity 与最新视界一致
                                updateEventHorizonVisibility();
                            })
                            .start();
                        } else {
                            mainSprite.scale.set(spriteScale, spriteScale, 1);
                            if (mainSprite.material) {
                                // 同样，在无动画的 fallback 分支里，也不要直接覆盖 opacity，交由视界统一控制
                                // mainSprite.material.opacity = targetOpacity;
                                // mainSprite.material.needsUpdate = true;
                            }
                            if (typeof activeBeam !== 'undefined' && activeBeam && activeBeam.userData.nodeId === (gNode.id || gNode.node_id)) {
                                activeBeam.scale.set(1, 1, 1);
                            }
                            updateEventHorizonVisibility();
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
                            // 停止之前可能正在运行的动画
                            if (gNode.__threeObj.__currentLabelTween) {
                                gNode.__threeObj.__currentLabelTween.stop();
                            }
                            
                            gNode.__threeObj.__currentLabelTween = new TWEEN.Tween({
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
                            .onComplete(() => {
                                gNode.__threeObj.__currentLabelTween = null;
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
                const isLocalActionCooling = (now - lastLocalActionTime) < 8000; // 【Kimi fix】/click 的 node_updated 回声在移动端弱网下可超过 3s，冷却窗延长到 8s 以覆盖全链路耗时上界
                const drawerElement = document.getElementById('drawer');
                const isDrawerOpen = drawerElement && !drawerElement.classList.contains('drawer-hidden');
                
                // 为了避免被轻微的权重提升误导，仅对权重显著增加的节点触发远端跃迁
                const isSignificantWeight = (parseFloat(newWeight || 0) >= 0.4);

                // 【Kimi fix】节点级判重：该节点 8 秒内刚被本地点过/发过光（__lastBeamStart 有登记），
                // 这条 node_updated 几乎可断定是自己 /click 的回声——权重照常更新（不应跳过），
                // 但不再发光、不再抢镜头。此判重与全局冷却互补：冷却管"任何远端跃迁"，它管"同一节点"。
                const gTargetId = gNode.id || gNode.node_id;
                const isRecentOwnBeam = (__lastBeamStart.id === gTargetId) && (now - __lastBeamStart.t) < 8000;

                if (!isCurrentlySelected && !isDrawerOpen && !isDragonCruising && !isLocalActionCooling && !isRecentOwnBeam && isSignificantWeight && Graph) {
                    
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

    // 循环结束后：一次性把本轮新增的节点与连线并入图谱（只重灌一次，避免多轮仿真重启）
    if (Graph && (pendingNewNodes.length > 0 || pendingNewLinks.length > 0)) {
        const { nodes, links } = Graph.graphData();
        const existIds = new Set(nodes.map(n => n.id));
        const additions = pendingNewNodes.filter(n => n.id && !existIds.has(n.id));
        if (additions.length > 0 || pendingNewLinks.length > 0) {
            seedNodePositions(additions);
            Graph.graphData({ nodes: [...nodes, ...additions], links: [...links, ...pendingNewLinks] });
            console.log(`[SocketIO] 增量并入 ${additions.length} 个新节点、${pendingNewLinks.length} 条新连线（单次图谱更新）`);
        }
    }
}

function initSocketHandlers() {
    if (!window.socket) return;
    
    // 监听望远镜变焦广播
    window.socket.on('horizon_updated', (data) => {
        const currentOwnerId = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        const currentActorId = new URLSearchParams(window.location.search).get('actor_id');
        
        // 检查是否属于当前拥有者
        // 【核心修复】望远镜更新也可能包含当前视野中的异场节点信息。如果只按 owner_id 强行拦截，会导致
        // 我们点异场节点生成的视界事件被本场忽略（因为后端发出的 horizon_updated 是针对点下的节点的 owner_id 发的）。
        // 改为放宽拦截条件：只要视界的触发者 actor_id 和自己一致，或者有特定的 owner_id 标记且在当前视图中，就不拦截。
        const botId = new URLSearchParams(window.location.search).get('bot_id');
        const isMemoryMode = !!botId;

        if (data.owner_id && data.owner_id !== currentOwnerId) {
            // Memory 模式下：允许同用户跨域视界；非 Memory 模式下：严格拦截跨域
            if (isMemoryMode) {
                // 如果我们是同一个人（actor_id一致）点的跨域节点产生的视界变化，必须放行！
                if (!(currentActorId && data.actor_id === currentActorId)) {
                    console.log(`[Socket.IO horizon_updated] Memory模式 - 拦截他人跨域视界: ${data.owner_id}`);
                    return;
                } else {
                    console.log(`[Socket.IO horizon_updated] Memory模式 - 放行同用户跨域视界`);
                }
            } else {
                console.log(`[Socket.IO horizon_updated] 非Memory模式 - 严格拦截跨域视界: ${data.owner_id}`);
                return;
            }
        }
        
        // 检查是否属于当前用户
        if (currentActorId && data.actor_id && data.actor_id !== currentActorId) {
            return;
        }

        console.log(`[Socket.IO] 收到 horizon_updated 广播: max_eyes=${data.max_eyes}, 视界节点数=${data.event_horizon.length}`);
        
        // 1. 更新 UI 滑块
        const slider = document.getElementById('telescope-slider');
        if (slider) {
            slider.value = data.max_eyes;
            // 直接计算百分比更新 reticle 和背景
            const min = parseFloat(slider.min || '0');
            const max = parseFloat(slider.max || '100');
            const percent = ((data.max_eyes - min) / (max - min)) * 100;
            const reticleThumb = document.getElementById('reticle-thumb');
            if (reticleThumb) reticleThumb.style.left = percent + '%';
            const reticleValue = document.getElementById('reticle-value-display');
            if (reticleValue) reticleValue.textContent = Math.round(data.max_eyes).toString();
            updateSliderBackground(slider);
        }

        // 2. 更新本地视界集合
        currentBossNodeId = data.boss_node_id;
        horizonNodes.clear();
        if (data.event_horizon && Array.isArray(data.event_horizon)) {
        // 任何时候后端返回新的事件视界，都要退出上帝视角强制进入观测者视角
        if (isGodView) {
            isGodView = false;
            const btn = document.getElementById('btn-fit-view');
            if (btn) btn.setAttribute('data-tooltip', '上帝视角');
        }
            data.event_horizon.forEach(id => horizonNodes.add(id));
        }

        // 3. 触发深空闪烁特效 (Cosmic Flash)
        triggerCosmicFlash();

        // 4. 重绘节点（星体浮现/湮灭）
        updateHighlight();
    });

    // 【广播微批去重】广播会扇出到 public/private/视角场 等多个房间，
    // 同一 node_id 可能被本端重复收到。这里在短窗口内合并为一次批量处理，
    // 避免同一节点被反复走一遍增量路径（重复计算 + 重复 tag 纹理查找）。
    // 注意：房间策略不做任何改动（Memory.md §7 要求按 owner+actor 过滤）。
    let __nodeUpdatedBuf = new Map();
    let __nodeUpdatedTimer = null;
    const __NODE_UPDATED_FLUSH_MS = 100;

    function flushNodeUpdatedBuffer() {
        __nodeUpdatedTimer = null;
        if (__nodeUpdatedBuf.size === 0) return;
        const batch = Array.from(__nodeUpdatedBuf.values());
        __nodeUpdatedBuf = new Map();
        const currentOwner = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        // 异场节点只有在已存在于视图中时才放行（与原逐条拦截语义一致）
        const accepted = batch.filter(d => {
            if (!d) return false;
            if (d.owner_id && d.owner_id !== currentOwner && !__lookupNode(d.serial_id, d.node_id)) {
                console.log(`[Socket.IO node_updated] 拦截(owner_id不匹配且不在缓存): ${d.node_id}`);
                return false;
            }
            return true;
        });
        if (accepted.length === 0) return;
        accepted.forEach(d => cacheSetNode(d));
        updateNodeIncremental(accepted); // 函数本身支持数组入参，只重灌一次图谱
    }

    window.socket.on('node_updated', (data) => {
        if (!data) return;
        const key = String(data.node_id || data.serial_id || '');
        if (!key) return;

        console.log(`[Socket.IO node_updated] 收到: node_id=${data.node_id}, owner_id=${data.owner_id}, actor_id=${data.actor_id}, weight=${data.survival_weight}`);

        // 注意：权重与 parent_id 是每个观测者各自的副本，允许任意 actor 对任意场域改权重 / 自定义 parent_id，
        // 因此 node_updated 不再按 actor_id 拦截（只有 node_created / node_deleted 等增删改才需按 actor 隔离）。
        // owner_id 隔离在 flushNodeUpdatedBuffer 中统一处理。

        // 同一节点在窗口内多次到达时，保留最后一条（最新权重）
        __nodeUpdatedBuf.set(key, data);
        if (__nodeUpdatedTimer === null) {
            __nodeUpdatedTimer = setTimeout(flushNodeUpdatedBuffer, __NODE_UPDATED_FLUSH_MS);
        }
    });

    // 批量事件（后端可选推送，进一步把 N 条广播压成 1 条）
    window.socket.on('nodes_updated', (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return;
        arr.forEach(d => {
            if (d && (d.node_id || d.serial_id)) {
                __nodeUpdatedBuf.set(String(d.node_id || d.serial_id), d);
            }
        });
        if (__nodeUpdatedTimer === null) {
            __nodeUpdatedTimer = setTimeout(flushNodeUpdatedBuffer, __NODE_UPDATED_FLUSH_MS);
        }
    });

    
    window.socket.on('node_created', (data) => {
        const currentOwnerId = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        const currentActorId = new URLSearchParams(window.location.search).get('actor_id');
        
        // 1. 隔离不同的 owner_id
        if (data.owner_id && data.owner_id !== currentOwnerId) return;
        
        // 2. 隔离不同的 actor_id
        if (data.actor_id && currentActorId && data.actor_id !== currentActorId) return;

        // 【关键】一律走增量路径，绝不调用 loadInitialData()。
        // 全量重载会重建整份节点对象（坐标归零）并重启仿真，多节点广播时会形成重绘风暴。
        const isKnown = !!__lookupNode(data.serial_id, data.node_id);
        cacheSetNode(data);
        updateNodeIncremental(data);

        if (isKnown) return; // 已知节点只做权重/标签同步

        // 新贞降临：播放创世金光（内联实现，替代原先 loadInitialData 里的全局重载）
        const newId = data.node_id;
        setTimeout(() => {
            if (!Graph) return;
            const gNode = Graph.graphData().nodes.find(n => n.id === newId || n.node_id === newId);
            if (!gNode) return;

            selectedNodeObj = gNode;
            gNode.fx = Number.isFinite(gNode.x) ? gNode.x : null;
            gNode.fy = Number.isFinite(gNode.y) ? gNode.y : null;
            gNode.fz = Number.isFinite(gNode.z) ? gNode.z : null;

            if (Number.isFinite(gNode.x)) {
                const { camPos, lookAt } = calculateOffsetView(gNode, 350);
                Graph.cameraPosition(camPos, lookAt, 1500);
            }

            showDivineBeam(gNode, 'golden');
            highlightNodes.clear();
            highlightNodes.add(gNode);
            updateHighlight();

            setTimeout(() => {
                highlightNodes.clear();
                updateHighlight();
                gNode.fx = null;
                gNode.fy = null;
                gNode.fz = null;
                selectedNodeObj = null;
                __loadState.hasAutoFitted = true;
            }, 2600);
        }, 600);
    });

    window.socket.on('node_deleted', (data) => {
        const currentOwnerId = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        const currentActorId = new URLSearchParams(window.location.search).get('actor_id');
        
        // 1. 隔离不同的 owner_id
        if (data.owner_id && data.owner_id !== currentOwnerId) return;
        
        // 2. 隔离不同的 actor_id
        if (data.actor_id && currentActorId && data.actor_id !== currentActorId) return;

        cacheDeleteNode(data.node_id);
        if (currentSelectedNodeId === data.node_id) closeDrawer();
        loadInitialData();
    });

    // 场删除广播：本场被删则跳回 auth，他场受影响则重绘
    window.socket.on('field_deleted', (data) => {
        const currentOwnerId = new URLSearchParams(window.location.search).get('owner_id') || 'default';
        if (data.deleted_owner_id && data.deleted_owner_id === currentOwnerId) {
            alert('本场已被删除');
            window.location.href = '/auth';
            return;
        }
        // 他场：接触面爹已被清除，重绘反映最新连线
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
    
    // 如果Graph中没有找到，尝试从归一索引/缓存中获取
    if (!node) {
        node = __lookupNode(nodeId, nodeId) || { node_id: nodeId };
    }
    
    // 更新缓存
    if (node) {
        cacheSetNode(node);
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
    const pIds = node.parent_ids || node.previous_ids || (node.parent_id ? [node.parent_id] : (node.previous_id ? [node.previous_id] : []));
    document.getElementById('d-parent-ids').value = pIds.join(' | ');
    
    // 图片URL和预览
    const imageUrlField = document.getElementById('d-full-image-url');
    const previewImg = document.getElementById('d-preview-img');
    const imagePreview = document.getElementById('d-image-preview');
    
    const isShareField = document.getElementById('d-is-share');

    if (imageUrlField) {
        imageUrlField.value = node.full_image_url || '';
    }

    if (isShareField) {
        // 如果数据源不存在is_share，那么默认为false（不分享）
        isShareField.checked = node.is_share !== undefined ? node.is_share : false;
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

    // 按角色控制抽屉内表单可用性：
    //   场主/admin：全部可编辑；
    //   观测者：只允许改父节点（副本连线），其余字段只读；
    //   匿名：全部只读。
    applyDrawerPermissions();
    
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
        previous_ids_count: pIds.length,
        has_image: !!(node.full_image_url || node.image_url)
    });
}

/**
 * 按访问角色控制抽屉内表单元素的可用性。
 * 场主/admin：全部可编辑；
 * 观测者：仅父节点（副本连线）可编辑，其余字段只读；
 * 匿名：全部只读。
 */
function applyDrawerPermissions() {
    const masterOnlyFields = [
        'd-node-id',            // 卜辞（node_id）
        'd-action-tag',         // 动作标签
        'd-block-tag',          // 因缘标签
        'd-event-tuple',        // 事件叙述
        'd-is-share',           // is_share 开关
        'd-full-image-url',     // 图片 URL
        'd-image-file',         // 图片文件
        'btn-upload-image',     // 上传按钮
        'expand-event-tuple-btn' // 事件叙述放大编辑
    ];
    const copyFields = ['d-parent-ids'];   // 观测者副本连线

    const canMaster = ACCESS.can_write_master;
    const canCopy = ACCESS.can_write_copy;

    masterOnlyFields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !canMaster;
        el.style.opacity = canMaster ? '' : '0.55';
        el.title = canMaster ? '' : '仅场主或 admin 可修改';
    });

    copyFields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !canCopy;
        el.style.opacity = canCopy ? '' : '0.55';
        el.title = canCopy ? '' : '匿名访客只读';
    });

    // 保存按钮文字随角色变化（保存的内容范围不同）
    const saveBtn = document.getElementById('btn-save-node');
    if (saveBtn) {
        saveBtn.textContent = canMaster ? '保存修改' : '保存我的连线';
    }
}

function closeDrawer() {
    stopObserverCameraFollow('抽屉相机动画接管');
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

/**
 * 编辑保存后恢复观测者视角。
 * 场主编辑大股东时，后端会清理该节点的个人副本；若主副本权重已代谢到 0.59 以下，
 * history 会暂时没有 boss。此时重新瞄定编辑前的大股东（改名后使用新 ID），
 * 而不是带着失效引用进入事实上的上帝视角。
 */
async function restoreObserverAfterEdit(expectedBossNodeId) {
    await loadInitialData();
    if (!Graph) return;

    const { nodes } = Graph.graphData();
    let bossNode = currentBossNodeId
        ? nodes.find(n => n.id === currentBossNodeId || n.node_id === currentBossNodeId)
        : null;
    if (!bossNode && expectedBossNodeId) {
        bossNode = nodes.find(n => n.id === expectedBossNodeId || n.node_id === expectedBossNodeId);
    }

    if (!bossNode) {
        stopObserverCameraFollow('编辑后没有可瞄定的大股东');
        currentBossNodeId = null;
        horizonNodes.clear();
        isGodView = true;
        updateHighlight();
        showSelectionHint('当前没有可瞄定的大股东，请点击一个节点进入观测者视角');
        return;
    }

    // history 已给出有效大股东时直接复用；缺失时才通过 /click 恢复，避免多余写权重。
    let observerReady = currentBossNodeId === bossNode.id && horizonNodes.size > 0;
    if (!observerReady) {
        const slider = document.getElementById('telescope-slider');
        const maxEyes = slider ? parseFloat(slider.value) : 40;
        observerReady = await promoteNodeWeight(bossNode, maxEyes);
    }
    if (!observerReady) {
        stopObserverCameraFollow('编辑后观测者视角恢复失败');
        isGodView = true;
        updateHighlight();
        return;
    }

    isGodView = false;
    currentBossNodeId = bossNode.id || bossNode.node_id;
    selectedNodeObj = null; // promoteNodeWeight 会暂时选中节点，保存结束后不应重新进入编辑选中态
    const viewBtn = document.getElementById('btn-fit-view');
    if (viewBtn) viewBtn.setAttribute('data-tooltip', '上帝视角');
    lastLocalActionTime = Date.now();

    if (Number.isFinite(bossNode.x) && Number.isFinite(bossNode.y) && Number.isFinite(bossNode.z)) {
        startObserverCameraFollow(bossNode, 350);
    }
    updateHighlight();
}

async function handleSaveNode() {
    // 鉴权：写主副本需要场主 / admin；有身份的观测者只能保存自己副本的连线
    const scope = ACCESS.can_write_master ? 'master' : (ACCESS.can_write_copy ? 'copy' : null);
    if (!scope) {
        showSelectionHint('匿名访客无权保存，请先登录');
        return;
    }

    // 获取表单字段的值（使用HTML中实际存在的ID）
    const nodeId = document.getElementById('d-node-id').value.trim();
    const editedNodeId = currentSelectedNodeId;
    // 如果正在编辑大股东且修改了标题，保存后应以新 ID 恢复瞄定。
    const expectedBossNodeId = currentBossNodeId
        ? (currentBossNodeId === editedNodeId ? nodeId : currentBossNodeId)
        : null;
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
    
    const isShareField = document.getElementById('d-is-share');
    const isShare = isShareField ? isShareField.checked : false;

    // 构建更新数据，与main.py中的update接口匹配
    // 注意：不发送survival_weight字段，因为后端不接受这个字段
    const data = {
        old_node_id: currentSelectedNodeId, // 原始节点ID
        new_node_id: nodeId, // 新节点ID（可能相同）
        event_tuple: content,
        action_tag: actionTag,
        block_tag: blockTag,
        full_image_url: fullImageUrl,
        is_share: isShare,
        actor_id: window.currentActorId,
        owner_id: window.currentOwnerId || 'default'
    };
    
    // 总是发送previous_ids字段，即使为空数组
    // 这样后端可以正确处理父ID为空的情况
    data.previous_ids = parentIds; // Map for backend API

    console.log('[抽屉编辑] 发送更新数据:', data, 'scope=', scope);

    try {
        const res = await fetch('/api/v1/causal/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appendAuthBody(data))
        });
        const result = await res.json();
        console.log('API响应:', result);
        if (result.status === 'success') {
            showSelectionHint(result.scope === 'user_copy'
                ? '已保存你的私有因果连线'
                : '更新存证成功');
            // 保存修改后，重置 is_change = true（与index.html一致）
            is_change = true;
            console.log('保存修改完成，重置 is_change = true');
            closeDrawer();
            
            // 表单保存后可能修改节点ID、连线和标签；重载后必须恢复有效大股东与观测者视角。
            await restoreObserverAfterEdit(expectedBossNodeId);
        } else {
            showSelectionHint(`更新失败: ${result.message}`);
        }
    } catch (e) { 
        console.error('保存异常:', e);
        showSelectionHint('保存异常'); 
    }
}

async function handleDeleteNode() {
    if (!ACCESS.can_write_master) {
        showSelectionHint('只有场主或 admin 可以删除事件');
        return;
    }
    if (!confirm('确定要彻底抹除该节点及其因果关联吗？')) return;
    try {
        const res = await fetch('/api/v1/causal/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appendAuthBody({ node_id: currentSelectedNodeId, actor_id: window.currentActorId }))
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
    stopObserverCameraFollow('因果巡航接管相机');
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
    const isShareField = document.getElementById('modal-is-share');
    const isShare = isShareField ? isShareField.checked : false;
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
        is_share: isShare,
        actor_id: window.currentActorId,
        owner_id: window.currentOwnerId || 'default'
        // 不发送block_tag、action_tag和previous_id，让后端处理
    };
    
    console.log('[发起首贞] 提交创建请求:', requestData);
    
    try {
        const response = await fetch('/api/v1/causal/genesis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appendAuthBody(requestData))
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
    // 抽屉是否打开只取决于 URL 的 edit 参数（内容可写与否由抽屉内按钮权限控制）
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
    if (window.currentBotId) {
        requestData.bot_id = window.currentBotId;
    }
    
    console.log(`[点击事件] 请求数据:`, requestData);
    const shiVersion = beginShiObservation(node);
    
    fetch('/api/v1/causal/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appendAuthBody(requestData))
    })
    .then(response => response.json())
    .then(data => {
        applyShiObservation(data, shiVersion);
        if (data.status === 'success' && data.event_horizon) {
            console.log(`[事件视界] 收到视界内节点数: ${data.event_horizon.length}`);
            horizonNodes.clear();
            // 任何时候后端返回新的事件视界，都要退出上帝视角强制进入观测者视角
            if (isGodView) {
                isGodView = false;
                const btn = document.getElementById('btn-fit-view');
                if (btn) btn.setAttribute('data-tooltip', '上帝视角');
            }
            data.event_horizon.forEach(id => horizonNodes.add(id));
            
            // 同步更新语义连线，让物理引擎重新计算距离
            if (data.semantic_links && data.semantic_links.length > 0) {
                const { nodes, links } = Graph.graphData();
                // 移除旧的语义连线
                const newLinks = links.filter(l => l.type !== 'semantic');
                
                // 添加新的语义连线
                data.semantic_links.forEach(link => {
                    // 确保源和目标节点都存在
                    const sourceExists = nodes.some(n => n.id === link.source);
                    const targetExists = nodes.some(n => n.id === link.target);
                    
                    if (sourceExists && targetExists) {
                        newLinks.push({
                            source: link.source,
                            target: link.target,
                            type: 'semantic',
                            similarity: link.similarity
                        });
                    }
                });
                
                console.log(`[事件视界] 更新语义连线: ${data.semantic_links.length} 条`);
                Graph.graphData({ nodes, links: newLinks });
                
                // 重新激活力导向引擎
                Graph.d3ReheatSimulation();
            }
            
            updateHighlight();
        }
    })
    .catch(error => {
        failShiObservation(shiVersion);
        console.error('[点击事件] 请求失败:', error);
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
    const isShareField = document.getElementById('derive-is-share');
    const isShare = isShareField ? isShareField.checked : false;
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
        previous_node: [parentId],
        event_tuple: eventTuple,
        action_tag: tag,
        full_image_url: fullImageUrl,
        is_share: isShare,
        actor_id: window.currentActorId,
        owner_id: window.currentOwnerId || 'default'
    };
    
    console.log('[寻龙] 提交创建请求:', requestData);
    
    try {
        const response = await fetch('/api/v1/causal/genesis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appendAuthBody(requestData))
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

/**
 * 初始化望远镜滑块事件
 */

/**
 * 更新滑杆背景渐变（科技蓝填充 + 微亮底色）
 */
function updateSliderBackground(slider) {
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '100');
    const val = parseFloat(slider.value);
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to top, rgba(60, 140, 255, 0.85) 0%, rgba(60, 140, 255, 0.85) ${percent}%, rgba(255, 255, 255, 0.25) ${percent}%, rgba(255, 255, 255, 0.25) 100%)`;
}
function initTelescopeSlider() {
    const slider = document.getElementById('telescope-slider');
    const reticle = document.getElementById('telescope-reticle');
    const reticleValue = document.getElementById('reticle-value-display');
    const reticleThumb = document.getElementById('reticle-thumb');

    if (!slider) return;

    const updateReticle = (value) => {
        const min = parseFloat(slider.min || '0');
        const max = parseFloat(slider.max || '100');
        const current = Math.max(min, Math.min(max, parseFloat(value || min)));
        const percent = ((current - min) / (max - min)) * 100;

        if (reticleValue) {
            reticleValue.textContent = Math.round(current).toString();
        }
        if (reticleThumb) {
            reticleThumb.style.left = `${percent}%`;
        }
    };

    // 初始化中央水平刻度滑块位置
    updateReticle(slider.value);

    // 按下时显示瞄准刻度
    const showReticle = () => {
        updateReticle(slider.value);
        if (reticle) reticle.classList.remove('hidden');
    };

    // 松开时隐藏瞄准刻度
    const hideReticle = () => {
        if (reticle) reticle.classList.add('hidden');
    };

    slider.addEventListener('mousedown', showReticle);
    slider.addEventListener('touchstart', showReticle, {passive: true});

    // 实时更新数值与中央水平滑块位置
    slider.addEventListener('input', (e) => {
        updateReticle(e.target.value);
        
        // 动态更新滑块背景渐变，实现科技感填充效果
        updateSliderBackground(slider);
    });

    // 拖动结束时发送请求
    // 【触屏去抖】部分移动浏览器在 touchend 时会补发一次 change（input→change→touchend→change），
    // 导致同一次拖动执行两次 promoteNodeWeight + showDivineBeam（两次 /click 请求 + 两束光）。
    // 这里用 300ms 窗口丢弃紧随其后的重复 change。
    let __sliderChangeLock = 0;
    slider.addEventListener('change', (e) => {
        stopObserverCameraFollow('用户调整望远镜');
        hideReticle();
        const nowMs = Date.now();
        if (nowMs - __sliderChangeLock < 300) {
            console.log('[望远镜] 忽略重复的 change 事件（触屏双发）');
            return;
        }
        __sliderChangeLock = nowMs;
        const maxEyes = parseFloat(e.target.value);
        console.log(`[望远镜] 调整倍率至: ${maxEyes}`);

        // 【本地操作登记】本次是用户主动操作，3 秒内禁止把自己广播回来的权重变化
        // 当成"远端跃迁"处理（否则会叠加一束圣光并抢镜头做 2 秒相机跃迁）。
        lastLocalActionTime = Date.now();

        if (currentBossNodeId) {
            const { nodes } = Graph.graphData();
            const bossNode = nodes.find(n => n.id === currentBossNodeId || n.node_id === currentBossNodeId);
            if (bossNode) {
                // 调用 promoteNodeWeight 并传入 maxEyes
                promoteNodeWeight(bossNode, maxEyes);
                showDivineBeam(bossNode);

                // 【显式居中】滑杆调整视界时必须让大股东回到视觉中心。
                // 历史实现依赖「远端跃迁」分支（updateNodeIncremental 内）的副作用来居中，
                // 该分支已因屏蔽广播回声（lastLocalActionTime）而关闭，这里改为滑杆自己负责居中：
                // 语义清晰、不受广播时序影响，且与点击路径（cameraPosition 350 / 1200ms）手感一致。
                if (Number.isFinite(bossNode.x) && Number.isFinite(bossNode.y) && Number.isFinite(bossNode.z)) {
                    const { camPos, lookAt } = calculateOffsetView(bossNode, 350);
                    Graph.cameraPosition(camPos, lookAt, 1200);
                } else {
                    console.warn(`[望远镜] 大股东节点坐标无效，跳过居中: ${currentBossNodeId}`);
                }
            } else {
                console.warn(`[望远镜] 未找到当前大股东节点: ${currentBossNodeId}`);
                // 编辑改名等场景可能留下失效引用；明确提示并清理，不能静默停留在伪观测者状态。
                currentBossNodeId = null;
                horizonNodes.clear();
                isGodView = true;
                updateHighlight();
                showSelectionHint('当前大股东已失效，请重新点击一个节点进入观测者视角');
            }
        } else {
            console.warn(`[望远镜] 当前没有大股东节点，无法调整视界`);
            showSelectionHint("请先点击一个节点使其成为大股东");
        }
    });

    // 处理鼠标在外部松开的情况
    document.addEventListener('mouseup', hideReticle);
    document.addEventListener('touchend', hideReticle);

    // 页面加载时同步当前滑杆值并绘制背景
    updateSliderBackground(slider);
}

/**
 * 触发深空闪烁特效 (Cosmic Flash)
 */
function triggerCosmicFlash() {
    let overlay = document.getElementById('cosmic-flash-overlay');
    
    // 如果不存在则创建
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cosmic-flash-overlay';
        document.body.appendChild(overlay);
    }
    
    // 移除可能存在的 active 类，强制重置动画状态
    overlay.classList.remove('cosmic-flash-active');
    
    // 强制浏览器重绘
    void overlay.offsetWidth;
    
    // 添加 active 类触发闪烁
    overlay.classList.add('cosmic-flash-active');
    
    // 动画结束后移除类
    setTimeout(() => {
        overlay.classList.remove('cosmic-flash-active');
    }, 100); // 100ms 后开始消散（CSS 中定义了 0.8s 的消散过渡）
}

window.addEventListener('load', () => {
    initTelescopeSlider();
    const container = document.getElementById('3d-graph');

    // --- [1. 核心常量配置] ---
    const MIN_RADIUS = 1.2;  // 最小半径（改小）
    const MAX_RADIUS = 4.2;  // 最大半径（改大，增加视觉区分度）
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

            // 判断是否为孤立节点（无父节点且无子节点）
            const pIds = node.parent_ids || node.previous_ids || (node.parent_id ? [node.parent_id] : (node.previous_id ? [node.previous_id] : []));
            let isIsolated = pIds.length === 0;
            if (isIsolated && Graph && Graph.graphData) {
                const { links } = Graph.graphData();
                if (links) {
                    const hasChildren = links.some(l => {
                        const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
                        return sourceId === (node.id || node.node_id) && l.type === 'causal';
                    });
                    if (hasChildren) {
                        isIsolated = false;
                    }
                }
            }

            // 判断是否为异场私密锁桩节点
            if (node.is_locked) {
                // 如果是私密节点，使用一把锁的图标或者特定的透明材质
                let lockTexture = window.nodeTextureCache['lock'];
                if (!lockTexture) {
                    lockTexture = new THREE.TextureLoader().load('./static/images/glaxy.png'); // 临时用星系图标代替锁桩，您可以放真实的锁图片
                    window.nodeTextureCache['lock'] = lockTexture;
                }
                const material = new THREE.SpriteMaterial({
                    map: lockTexture,
                    transparent: true,
                    opacity: 0.3,
                    color: 0x888888, // 灰色调
                    depthWrite: false
                });
                const spriteNode = new THREE.Sprite(material);
                const spriteScale = actualPhysicalRadius * 2.0; 
                spriteNode.scale.set(spriteScale, spriteScale, 1);
                group.add(spriteNode);
            } else {
                // 原有的映射图片路径逻辑
                let imagePath = './static/images/zhen.png'; // 默认
                if (isIsolated) {
                    imagePath = './static/images/glaxy.png';
                } else if (duty === '贞') {
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
            }

            // 【标签对齐】：精准计算文字悬浮位置
            // 初始化时如果是在事件视界中且为大股东节点，则不截断显示
            const hasHorizon = horizonNodes && horizonNodes.size > 0;
            const isBossNode = (currentBossNodeId === node.id || currentBossNodeId === node.node_id);
            const isBossInHorizon = hasHorizon && isBossNode;
            
            const texture = createTextTexture(node.id, weight, THREE, isBossInHorizon);
            if (texture) {
                const sprite = new THREE.Sprite(
                    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: baseOpacity })
                );
                // 标签亮度由材质灰度承载（纹理本身固定满亮白字，可跨节点/跨权重复用）
                sprite.material.color.setScalar(getLabelBrightness(weight));
                // 标签大小控制：与节点大小成正比
                // 基础缩放0.3，权重为1时缩放为0.7
                const baseScale = 0.3 + (weight * 0.25);
                const spriteHeight = texture.baseHeight * baseScale;
                sprite.scale.set(texture.baseWidth * baseScale, spriteHeight, 1);
                
                // 位置：提高悬浮高度，避免在斜视时遮挡星球
                sprite.position.y = actualPhysicalRadius + spriteHeight + 4; 
                group.add(sprite);
            }

            return group;
        })

        // --- [4. 交互：抽屉避让聚焦算法] ---
        .onNodeRightClick(node => {
            if (!node) return;
            openNodeViewer(node);
        })
        .onNodeClick(node => {
            if (!node) return;
            stopObserverCameraFollow('用户点击节点');

            // --- 长按松手抑制：长按已打开内容查看器，忽略随后派发的那次“单击” ---
            if (Date.now() < suppressNodeClickUntil) {
                return;
            }

            // --- 公共变量 ---
            const hasHorizon = typeof horizonNodes !== 'undefined' && horizonNodes.size > 0;
            const urlParamsForJump = new URLSearchParams(window.location.search);
            const currentOwnerId = urlParamsForJump.get('owner_id') || 'default';
            const isForeignNode = (node.owner_id && node.owner_id !== currentOwnerId);

            const isSharedForeignNode = isForeignNode && !node.is_locked;

            // --- 双击检测（移到防误触之前）：双击 = 点击，覆盖视界内外 ---
            const now = Date.now();
            const isDoubleClick = node.__lastClickTime && (now - node.__lastClickTime < 500);

            if (isDoubleClick) {
                node.__lastClickTime = 0; // 重置
                if (!node.__lastClickBlocked) {
                    // 视界内双击：第一次点击已执行点击功能，跳过避免重复
                    return;
                }
                node.__lastClickBlocked = false;
                // 视界外双击：第一次点击被防误触拦截，这次补上点击功能（继续向下）
            } else {
                node.__lastClickTime = now;
                node.__lastClickBlocked = false;
            }

            // --- 防误触：仅拦截「单击」（非双击）的视界外节点 ---
            if (!isDoubleClick && hasHorizon && !horizonNodes.has(node.id)) {
                node.__lastClickBlocked = true;
                console.log(`[防误触] 节点 ${node.id} 处于视界外深空状态，忽略单击（双击可强制点击）`);
                return;
            }

            // 异场节点跳转漫游（带着当前观测者身份进入异场，焦点不变）
            // 不管是否携带 bot_id，只要点击异场节点就立即跨场跳转
            if (isForeignNode) {
                console.log(`[星空跳跃] 即将前往异场 ${node.owner_id}，目标焦点 ${node.id}`);
                cancelShiObservation();
                const url = new URL(window.location.href);
                url.searchParams.set('owner_id', node.owner_id);
                // 使用 serial_id 定位节点
                url.searchParams.set('serial_id', node.serial_id || node.id);
                if (window.currentActorId) {
                    url.searchParams.set('actor_id', window.currentActorId);
                }
                window.location.href = url.toString();
                return;
            }

            lastLocalActionTime = now; // 记录操作时间，屏蔽远端跃迁干扰

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
                if (window.currentBotId) {
                    requestData.bot_id = window.currentBotId;
                }
                const slider = document.getElementById('telescope-slider');
                if (slider && slider.value) {
                    requestData.max_eyes = parseFloat(slider.value);
                }
                console.log(`[点击事件(只读)] 请求数据:`, requestData);
                const shiVersion = beginShiObservation(node);
                fetch('/api/v1/causal/click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(appendAuthBody(requestData))
                })
                .then(response => response.json())
                .then(data => {
                    applyShiObservation(data, shiVersion);
                    if (data.status === 'success') {
                        currentBossNodeId = node.id; // 记录当前大股东
                    }
                    if (data.status === 'success' && data.event_horizon) {
                        console.log('[事件视界] 收到视界内节点数: ' + data.event_horizon.length);
                        horizonNodes.clear();
                        // 任何时候后端返回新的事件视界，都要退出上帝视角强制进入观测者视角
                        if (isGodView) {
                            isGodView = false;
                            const btn = document.getElementById('btn-fit-view');
                            if (btn) btn.setAttribute('data-tooltip', '上帝视角');
                        }
                        data.event_horizon.forEach(id => horizonNodes.add(id));
                        
                        // 同步更新语义连线，让物理引擎重新计算距离
                        if (data.semantic_links && data.semantic_links.length > 0) {
                            const { nodes, links } = Graph.graphData();
                            const newLinks = links.filter(l => l.type !== 'semantic');
                            
                            data.semantic_links.forEach(link => {
                                const sourceExists = nodes.some(n => n.id === link.source);
                                const targetExists = nodes.some(n => n.id === link.target);
                                
                                if (sourceExists && targetExists) {
                                    newLinks.push({
                                        source: link.source,
                                        target: link.target,
                                        type: 'semantic',
                                        similarity: link.similarity
                                    });
                                }
                            });
                            
                            console.log(`[事件视界] 更新语义连线: ${data.semantic_links.length} 条`);
                            Graph.graphData({ nodes, links: newLinks });
                            Graph.d3ReheatSimulation();
                        }
                        
                        updateHighlight();
                    }
                })
                .catch(error => {
                    failShiObservation(shiVersion);
                    console.error('[API-only点击] 请求失败:', error);
                });
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
            if (window.currentBotId) {
                requestData.bot_id = window.currentBotId;
            }
            const slider = document.getElementById('telescope-slider');
            if (slider && slider.value) {
                requestData.max_eyes = parseFloat(slider.value);
            }
            
            console.log(`[点击事件(编辑)] 请求数据:`, requestData);
            const shiVersion = beginShiObservation(node);
            
            fetch('/api/v1/causal/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appendAuthBody(requestData))
            })
            .then(response => response.json())
            .then(data => {
                applyShiObservation(data, shiVersion);
                if (data.status === 'success') {
                    currentBossNodeId = node.id; // 记录当前大股东
                }
                if (data.status === 'success' && data.event_horizon) {
                    console.log(`[事件视界] 收到视界内节点数: ${data.event_horizon.length}`);
                    horizonNodes.clear();
                    // 任何时候后端返回新的事件视界，都要退出上帝视角强制进入观测者视角
                    if (isGodView) {
                        isGodView = false;
                        const btn = document.getElementById('btn-fit-view');
                        if (btn) btn.setAttribute('data-tooltip', '上帝视角');
                    }
                    data.event_horizon.forEach(id => horizonNodes.add(id));
                    
                    // 同步更新语义连线，让物理引擎重新计算距离
                    if (data.semantic_links && data.semantic_links.length > 0) {
                        const { nodes, links } = Graph.graphData();
                        const newLinks = links.filter(l => l.type !== 'semantic');
                        
                        data.semantic_links.forEach(link => {
                            const sourceExists = nodes.some(n => n.id === link.source);
                            const targetExists = nodes.some(n => n.id === link.target);
                            
                            if (sourceExists && targetExists) {
                                newLinks.push({
                                    source: link.source,
                                    target: link.target,
                                    type: 'semantic',
                                    similarity: link.similarity
                                });
                            }
                        });
                        
                        console.log(`[事件视界] 更新语义连线: ${data.semantic_links.length} 条`);
                        Graph.graphData({ nodes, links: newLinks });
                        Graph.d3ReheatSimulation();
                    }
                    
                    updateHighlight();
                }
            })
            .catch(error => {
                failShiObservation(shiVersion);
                console.error('[点击事件] 请求失败:', error);
            });
        })

        // --- [5. 连线与细节配置] ---
        .nodeLabel(node => '')
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
                updateStarHud(node);
                
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
                    updateStarHud(null);
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
            
            // 计算连线基础宽度：基于两端节点平均权重的对数映射
            let baseWidth = 0.5;
            if (typeof l.source === 'object' && typeof l.target === 'object') {
                const sWeight = getVisualWeight(l.source.survival_weight);
                const tWeight = getVisualWeight(l.target.survival_weight);
                const avgWeight = (sWeight + tWeight) / 2;
                baseWidth = 0.5 + Math.pow(avgWeight, 0.5) * 2.5; // 使权重对连线宽度的影响非线性，低权重也有一定可见度
            }
            
            return highlightLinks.has(l) ? 8.0 : baseWidth;
        })
        .linkColor(l => {
            if (l.type === 'semantic') return 'rgba(0,0,0,0)'; // 语义连线完全透明
            if (l.type === 'horizon') return 'rgba(139, 92, 246, 0.6)'; // 视界连线颜色 (紫色)
            
            // 基于节点权重的连线基础颜色
            let linkOpacity = 0.2;
            if (typeof l.source === 'object' && typeof l.target === 'object') {
                const sWeight = getVisualWeight(l.source.survival_weight);
                const tWeight = getVisualWeight(l.target.survival_weight);
                const avgWeight = (sWeight + tWeight) / 2;
                linkOpacity = 0.15 + avgWeight * 0.45; // 权重高的连线稍微不透明一些
            }
            
            return highlightLinks.has(l) ? '#fff' : `rgba(0, 255, 255, ${linkOpacity})`;
        })
        .linkDirectionalParticles(l => {
            if (l.type === 'semantic') return 0; // 语义连线没有光点
            if (l.type === 'horizon') return 4; // 视界连线光点
            return highlightLinks.has(l) ? 10 : 2;
        })
        .linkDirectionalParticleWidth(l => {
            if (l.type === 'horizon') return 3;
            
            // 基于节点权重的粒子基础大小
            let pWidth = 2.5;
            if (typeof l.source === 'object' && typeof l.target === 'object') {
                const sWeight = getVisualWeight(l.source.survival_weight);
                const tWeight = getVisualWeight(l.target.survival_weight);
                const avgWeight = (sWeight + tWeight) / 2;
                pWidth = 2.0 + avgWeight * 3.5; // 权重高的连线粒子更大，在 2.0 到 5.5 之间
            }
            return pWidth;
        })
        .linkDirectionalParticleColor(l => {
            if (l.type === 'horizon') return '#a78bfa';
            
            let intensity = 1.0;
            
            // 计算亮度与两端节点的权重平均值正相关
            if (typeof l.source === 'object' && typeof l.target === 'object') {
                const sWeight = getVisualWeight(l.source.survival_weight);
                const tWeight = getVisualWeight(l.target.survival_weight);
                const avgWeight = (sWeight + tWeight) / 2;
                // 基础亮度 0.4，根据两端平均权重进行叠加，使粒子亮度更强一些
                intensity = 0.4 + avgWeight * 0.6;
            }
            
            // 若当前处于事件视界模式，且该连线并非直接连接视界内的节点，则大幅降低光点亮度
            const hasHorizon = horizonNodes && horizonNodes.size > 0;
            if (hasHorizon) {
                const sId = typeof l.source === 'object' ? l.source.id : l.source;
                const tId = typeof l.target === 'object' ? l.target.id : l.target;
                if (!horizonNodes.has(sId) && !horizonNodes.has(tId)) {
                    intensity = intensity * 0.35; // 视界外蓝色粒子压低亮度，但保留可见性
                }
            }
            
            // THREE.Color 会忽略 rgba 中的 alpha 通道！
            // 因此我们无法直接改变材质的透明度，但可以通过压暗 RGB 的明度（将其变暗）来在黑色背景下完美模拟透明虚化的效果
            // 非视界连线原本是青蓝色 rgba(0, 255, 255, 0.2)，在黑色背景下模拟半透明时，保持 0, 255, 255 的比例，用明度乘数
            const colorVal = Math.floor(255 * intensity);
            return `rgb(0, ${colorVal}, ${colorVal})`;
        })
        .linkDirectionalArrowLength(l => {
            if (l.type === 'semantic') return 0; // 语义连线没有箭头
            if (l.type === 'horizon') return 0; // 视界连线没有箭头
            return 6;
        })
        .linkDirectionalArrowColor(l => {
            if (l.type === 'horizon') return '#a78bfa';

            let intensity = 1.0;
            if (typeof l.source === 'object' && typeof l.target === 'object') {
                const sWeight = getVisualWeight(l.source.survival_weight);
                const tWeight = getVisualWeight(l.target.survival_weight);
                const avgWeight = (sWeight + tWeight) / 2;
                intensity = 0.4 + avgWeight * 0.6;
            }
            
            const hasHorizon = horizonNodes && horizonNodes.size > 0;
            if (hasHorizon) {
                const sId = typeof l.source === 'object' ? l.source.id : l.source;
                const tId = typeof l.target === 'object' ? l.target.id : l.target;
                if (!horizonNodes.has(sId) && !horizonNodes.has(tId)) {
                    intensity = intensity * 0.35;
                }
            }

            const colorVal = Math.floor(255 * intensity);
            return `rgb(0, ${colorVal}, ${colorVal})`;
        })
        .linkDirectionalArrowRelPos(1);

    // --- [5.5 移动端长按补丁] ---
    // 在渲染器 canvas 上挂载 touchstart/touchend，弥补移动端 contextmenu 长按不灵敏的问题
    installMobileLongPress();

    // --- [6. 初始化力场与事件] ---
    // 调整全局排斥力，防止节点挤在一起
    Graph.d3Force('charge').strength(-5)
    
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
                    return 150;
                }
            })
            .strength(link => {
                if (link.type === 'semantic') {
                    let sim = Number(link.similarity);
                    if (isNaN(sim)) sim = 0.6;
                    // 极端放大拉力差异
                    // sim = 1.0 -> str = 1.5 (极强拉力)
                    // sim = 0.6 -> str = 0.1 (较弱拉力)
                    const str = Math.max(0.5, Math.min(1.5, 0.5 + (sim - 0.6) * (1.0 / 0.4)));
                    return str;
                } else {
                    return 1.0;
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
            const shiVersion = beginShiObservation(selectedNodeObj);
            
            fetch('/api/v1/causal/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appendAuthBody(requestData))
            })
            .then(res => res.json())
            .then(data => {
                applyShiObservation(data, shiVersion);
                if (data.status === 'success' && data.event_horizon) {
                    const horizonIds = data.event_horizon;
                    showSelectionHint(`视界扫描完成：发现 ${horizonIds.length} 个节点`);
                    
                    // 同步更新语义连线，让物理引擎重新计算距离
                    if (data.semantic_links && data.semantic_links.length > 0) {
                        const { nodes, links } = Graph.graphData();
                        const newLinks = links.filter(l => l.type !== 'semantic');
                        
                        data.semantic_links.forEach(link => {
                            const sourceExists = nodes.some(n => n.id === link.source);
                            const targetExists = nodes.some(n => n.id === link.target);
                            
                            if (sourceExists && targetExists) {
                                newLinks.push({
                                    source: link.source,
                                    target: link.target,
                                    type: 'semantic',
                                    similarity: link.similarity
                                });
                            }
                        });
                        
                        console.log(`[事件视界] 更新语义连线: ${data.semantic_links.length} 条`);
                        Graph.graphData({ nodes, links: newLinks });
                        Graph.d3ReheatSimulation();
                    }
                    
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
                failShiObservation(shiVersion);
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
        const btn = document.getElementById('btn-fit-view');
        stopObserverCameraFollow('用户切换视角');
        
        if (!isGodView) {
            // 从 观测者视角 -> 上帝视角
            savedHorizonNodes.clear();
            horizonNodes.forEach(id => savedHorizonNodes.add(id));
            savedBossNodeId = currentBossNodeId;
            
            horizonNodes.clear();
            currentBossNodeId = null; // 清除大股东状态以隐藏望远镜面板和光圈
            isGodView = true;
            cancelShiObservation();
            
            btn.setAttribute('data-tooltip', '观测者视角');
            
            updateHighlight();
            
            // 隐藏面板逻辑已在 updateHighlight（通过 hasHorizon 重新判断）或 telescopePanel style 设置中更新，但需要确保望远镜面板被隐藏
            const telescopePanel = document.getElementById('telescope-panel');
            if (telescopePanel) telescopePanel.style.display = 'none';

            Graph.zoomToFit(800, 40);
        } else {
            // 从 上帝视角 -> 观测者视角
            horizonNodes.clear();
            savedHorizonNodes.forEach(id => horizonNodes.add(id));
            currentBossNodeId = savedBossNodeId;
            isGodView = false;
            
            btn.setAttribute('data-tooltip', '上帝视角');
            
            updateHighlight();
            
            // 如果有大股东节点，恢复望远镜面板显示
            if (horizonNodes.size > 0 && currentBossNodeId) {
                const telescopePanel = document.getElementById('telescope-panel');
                if (telescopePanel) telescopePanel.style.display = 'flex';
            }

            // 如果有中心节点或当前选中节点，将镜头拉回视界中心；否则退化为全局自适应
            const targetNodeId = currentBossNodeId || (focusNode ? (focusNode.id || focusNode.node_id) : null);
            let targetNode = null;
            if (targetNodeId) {
                const { nodes } = Graph.graphData();
                targetNode = nodes.find(n => n.id === targetNodeId || n.node_id === targetNodeId);
            }
            
            if (targetNode) {
                // 手动回到观测者视角也使用同一套可释放的居中跟随。
                if (!currentBossNodeId || !startObserverCameraFollow(targetNode, 800)) {
                    const { camPos, lookAt } = calculateOffsetView(targetNode, 800);
                    Graph.cameraPosition(camPos, lookAt, 3000);
                }
            } else if (horizonNodes.size > 0) {
                Graph.zoomToFit(800, 40); 
            }
        }
    };
    
    // 绑定因果巡航按钮
    const dragonCruiseBtn = document.getElementById('btn-dragon-cruise');
    if (dragonCruiseBtn) {
        dragonCruiseBtn.onclick = startDragonCruise;
        console.log('[因果巡航] 按钮事件绑定成功');
    } else {
        console.warn('[因果巡航] 警告：未找到btn-dragon-cruise按钮元素');
    }
    
    // 绑定发起首贞按钮（写主副本：仅场主 / admin；且需要 edit=true）
    const createNodeBtn = document.getElementById('btn-create-node');
    if (createNodeBtn) {
        if (!hasEditPerm()) {
            createNodeBtn.classList.add('hidden');
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
                body: JSON.stringify(appendAuthBody(requestData))
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
                        <button class="result-action-btn" onclick="handleSearchResultClick(${serialId}, '${nodeId}', null, '${result.owner_id || ''}')">
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
    window.handleSearchResultClick = async function(serialId, nodeId, maxEyes = null, resultOwnerId = null) {
        console.log(`[搜索点击] 点击搜索结果: serial_id=${serialId}, node_id=${nodeId}, maxEyes=${maxEyes}, owner_id=${resultOwnerId}`);
        
        // 异场节点统一跳转逻辑（不管是否开启 Memory 模式）
        const currentOwnerId = window.currentOwnerId || 'default';
        if (resultOwnerId && resultOwnerId !== currentOwnerId) {
            console.log(`[星空跳跃] 搜索结果点击，即将前往异场 ${resultOwnerId}，目标焦点 ${nodeId}`);
            cancelShiObservation();
            const url = new URL(window.location.href);
            url.searchParams.set('owner_id', resultOwnerId);
            url.searchParams.set('serial_id', serialId || nodeId);
            if (window.currentActorId) {
                url.searchParams.set('actor_id', window.currentActorId);
            }
            window.location.href = url.toString();
            return;
        }

        console.log(`[搜索点击] is_change=${is_change}, activeParentIdField=`, activeParentIdField);
        // 兜底：如果失焦导致 activeParentIdField 为 null，重新获取它
        if (!is_change && !activeParentIdField) {
            activeParentIdField = document.getElementById("d-parent-ids");
        }

        // **拦截逻辑：如果在父ID选择模式（is_change为false），只需填入输入框而不打开抽屉**
        if (!is_change && activeParentIdField) {
            let ids = activeParentIdField.value.split('|').map(s => s.trim()).filter(s => s);
            const strNodeId = String(nodeId);
            
            // 如果节点未在输入框中，则链入
            if (!ids.includes(strNodeId)) {
                ids.push(strNodeId);

                activeParentIdField.value = ids.join(' | ');
                showSelectionHint(`已链入父节点: ${strNodeId}`);
            }
            
            // 无论如何，自动展开抽屉以显示填入的结果
            if (typeof window.expandDrawer === "function") {
                window.expandDrawer();
            }

            // 隐藏搜索结果面板
            const searchFormContainer = document.getElementById('search-form-container');
            if (searchFormContainer) searchFormContainer.classList.remove('expanded');
            
            const resultsContainer = document.getElementById('search-results');
            if (resultsContainer) resultsContainer.style.display = 'none';
            
            // 跳出，不提升权重也不改变当前正在编辑的抽屉和摄像机视角
            return;
        }

        lastLocalActionTime = Date.now(); // 记录操作时间，屏蔽远端跃迁干扰
        // 必须使用本次搜索结果，不得沿用上一次 selectedNodeObj 的相／非相标签。
        const graphNodes = (typeof Graph !== 'undefined' && Graph) ? Graph.graphData().nodes : [];
        const searchFocalNode = graphNodes.find(n =>
            String(n.serial_id || n.本事件ID || '') === String(serialId) ||
            String(n.id || '') === String(nodeId) ||
            String(n.node_id || '') === String(nodeId)
        ) || null;
        const shiVersion = beginShiObservation(searchFocalNode);

        try {
            // 调用点击事件API
            const requestData = {
                serial_id: serialId,
                actor_id: window.currentActorId || '',
                owner_id: window.currentOwnerId || 'default'
            };
            if (window.currentBotId) {
                requestData.bot_id = window.currentBotId;
            }
            if (maxEyes !== null) {
                requestData.max_eyes = maxEyes;
            }

            console.log(`[搜索点击] 调用点击API:`, requestData);

            const response = await fetch('/api/v1/causal/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appendAuthBody(requestData))
            });

            const data = await response.json();
            applyShiObservation(data, shiVersion);

            if (data.status === 'success') {
                // 如果 nodeId 为空（例如通过 URL 触发），尝试从返回数据中获取
                // If serialId comes from URL, it's a string, which can cause type mismatch when finding node. Stringifying both for robust matching.
                const displayNodeId = nodeId || (data.node && data.node.node_id) || String(serialId);
                if (!window.currentActorId && !data.actor_id) {
                    showSelectionHint(`已瞄定事件 "${displayNodeId}"，匿名观测未写入权重`);
                } else {
                    showSelectionHint(`已瞄定事件 "${displayNodeId}"，权重提升到60%`);
                }
                // 【Kimi fix】result-action-btn 点击与直接点击/拉滑杆路径的关键差异：
                // 必须同步更新 currentBossNodeId 和 horizonNodes，否则大股东节点
                // 在 updateEventHorizonVisibility 里仍被视为视界外，opacity 保持为 0。
                currentBossNodeId = displayNodeId;
                if (data.event_horizon && data.event_horizon.length > 0) {
                    horizonNodes.clear();
                    if (isGodView) {
                        isGodView = false;
                        const btn = document.getElementById('btn-fit-view');
                        if (btn) btn.setAttribute('data-tooltip', '上帝视角');
                    }
                    data.event_horizon.forEach(id => horizonNodes.add(id));
                }
                
                // 同步更新语义连线，让物理引擎重新计算距离
                if (data.semantic_links && data.semantic_links.length > 0) {
                    const { nodes, links } = Graph.graphData();
                    const newLinks = links.filter(l => l.type !== 'semantic');
                    
                    data.semantic_links.forEach(link => {
                        const sourceExists = nodes.some(n => n.id === link.source);
                        const targetExists = nodes.some(n => n.id === link.target);
                        
                        if (sourceExists && targetExists) {
                            newLinks.push({
                                source: link.source,
                                target: link.target,
                                type: 'semantic',
                                similarity: link.similarity
                            });
                        }
                    });
                    
                    console.log(`[事件视界] 更新语义连线: ${data.semantic_links.length} 条`);
                    Graph.graphData({ nodes, links: newLinks });
                    Graph.d3ReheatSimulation();
                }
                
                // 在3D图中高亮显示该节点
                highlightSearchResultNode(displayNodeId);
                
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
            failShiObservation(shiVersion);
            console.error('[搜索点击] 点击事件处理失败:', error);
            showSelectionHint(`瞄定失败: ${error.message}`);
        }
    }
    
    // 在3D图中高亮显示搜索结果节点
    function highlightSearchResultNode(nodeId) {
        if (!Graph) return;
        
        const { nodes } = Graph.graphData();
        const strNodeId = String(nodeId);
        const targetNode = nodes.find(n => String(n.id) === strNodeId || String(n.serial_id) === strNodeId || String(n.node_id) === strNodeId);
        
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
                // this.value = '';
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


// --- [全局节点透明度及视界定时监控] ---
setInterval(() => {
    if (!Graph) return;
    const { nodes } = Graph.graphData();
    if (!nodes) return;

    let horizonNeedsRefresh = false;
    const hasHorizon = typeof horizonNodes !== 'undefined' && horizonNodes.size > 0 && typeof currentBossNodeId !== 'undefined' && currentBossNodeId;
    // Memory 模式（?bot_id=）下视界外节点不透明度强制为 0，非 Memory 模式为 0.05
    const isMemoryMode = !!new URLSearchParams(window.location.search).get('bot_id');
    let bossNode = null;
    
    if (hasHorizon) {
        bossNode = nodes.find(n => n.id === currentBossNodeId || n.node_id === currentBossNodeId);
    }

    let debugLogs = [];

    nodes.forEach(node => {
        if (!node.__threeObj) return;
        // 悬浮或增量动画中的节点不参与异常判定：其透明度由悬浮绽放 / 权重 Tween 管理，
        // 否则悬停视界外节点（0.65 > 阈值）会每秒都被判为异常并触发全图重绘。
        if (hoverNode === node || node.__threeObj.__currentMainTween || node.__threeObj.__isAnimatingOpacity) return;
        const sphere = node.__threeObj.children[0];
        const sprite = node.__threeObj.children[1];
        if (!sphere || !sphere.material) return;

        // 1. 视界内节点必须可见。首屏 Three.js 对象创建可能晚于 800ms 后的全量更新，
        // 也可能被广播动画中断；旧监控只检查“视界外误亮”，会漏掉这里的“视界内误隐藏”。
        // updateEventHorizonVisibility 中视界内节点的最低本体透明度为 0.2，
        // 因此低于 0.15 或 visible=false 均可明确判定为异常，而无需重复整套透明度计算。
        const isInHorizon = hasHorizon && horizonNodes.has(node.id);
        if (isInHorizon) {
            const sphereHidden = !sphere.visible || sphere.material.opacity < 0.15;
            const spriteHidden = sprite && sprite.material && (!sprite.visible || sprite.material.opacity < 0.1);
            if (sphereHidden || spriteHidden) {
                horizonNeedsRefresh = true;
                if (debugLogs.length < 5) {
                    debugLogs.push(`Horizon node ${String(node.id).substring(0,6)}: visible=${sphere.visible}, opacity=${sphere.material.opacity.toFixed(2)}`);
                }
            }
        }

        // 2. 判断是否为大股东 (survival_weight > 0.59)
        // 后端 promote_all_weights 严格按 60/40 分配：大股东唯一 0.60，其余按比例瓜分 0.40
        // （必然远低于 0.59），因此该阈值只会命中唯一节点。
        // 叠加视界限定，避免历史残留的 0.60 节点在视界外被错误拉亮。
        if (node.survival_weight > 0.59 && (!hasHorizon || horizonNodes.has(node.id))) {
            if (sphere.material.opacity < 0.98) {
                sphere.material.opacity = 0.98;
                sphere.material.needsUpdate = true;
            }
            if (sprite && sprite.material && sprite.material.opacity < 0.98) {
                sprite.material.opacity = 0.98 * 0.8;
                sprite.material.needsUpdate = true;
            }
        }
        // 3. 对于普通节点，如果存在视界，检查视界外节点是否异常显示
        else if (hasHorizon && bossNode && !horizonNodes.has(node.id)) {
            const expectedDimmedOpacity = isMemoryMode ? 0 : 0.05;
            
            if (sphere.material.opacity > expectedDimmedOpacity + 0.1) {
                horizonNeedsRefresh = true;
                if (debugLogs.length < 5) {
                    debugLogs.push(`Node ${node.id.substring(0,6)}: actual opacity ${sphere.material.opacity.toFixed(2)} > expected ${expectedDimmedOpacity.toFixed(2)}`);
                }
            }
        }
    });

    if (debugLogs.length > 0) {
        console.log(`[Monitor] 异常详情: ${debugLogs.join(' | ')}`);
        console.log(`[Monitor] 视界内节点数量: ${horizonNodes.size}, 大股东: ${currentBossNodeId}`);
    }
    
    // 调试：输出特定前缀的节点信息
    const testNodeIdPrefix = '759';
    nodes.forEach(node => {
        if (node.id && String(node.id).startsWith(testNodeIdPrefix)) {
            const inHorizon = typeof horizonNodes !== 'undefined' && horizonNodes.has(node.id);
            let dist = -1;
            if (bossNode && node.x !== undefined && bossNode.x !== undefined) {
                const dx = node.x - bossNode.x;
                const dy = node.y - bossNode.y;
                const dz = node.z - bossNode.z;
                dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
            }
            
            const sphere = node.__threeObj ? node.__threeObj.children[0] : null;
            const op = (sphere && sphere.material) ? sphere.material.opacity : -1;
            const vis = sphere ? sphere.visible : false;
            
            console.log(`[Debug 759 Node] ID: ${node.id}, IsInHorizon: ${inHorizon}, DistanceToBoss: ${dist.toFixed(2)}, Opacity: ${op.toFixed(2)}, Visible: ${vis}`);
        }
    });

    if (horizonNeedsRefresh && !document.hidden) {
        console.log("[Monitor] 检测到视界节点可见性异常，触发全局视界重绘");
        // 轻量重绘：只修复 opacity / visible / 连线可见性，不重建全图标签纹理
        if (typeof updateEventHorizonVisibility === 'function') {
            updateEventHorizonVisibility({ skipLabels: true });
        }
    }
}, 1000);
initStarHud();

