/* 因果星空 · 账号中心 */
(function () {
    'use strict';

    // ---------- 星空背景 ----------
    function buildStars() {
        const el = document.getElementById('stars');
        if (!el) return;
        const count = window.innerWidth < 640 ? 80 : 140;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const s = document.createElement('div');
            s.className = 'star';
            const size = (Math.random() * 2.2 + 0.6).toFixed(2);
            s.style.width = size + 'px';
            s.style.height = size + 'px';
            s.style.left = (Math.random() * 100).toFixed(2) + '%';
            s.style.top = (Math.random() * 100).toFixed(2) + '%';
            s.style.setProperty('--dur', (Math.random() * 4 + 2).toFixed(2) + 's');
            s.style.setProperty('--delay', (Math.random() * 5).toFixed(2) + 's');
            s.style.setProperty('--min', (Math.random() * 0.35 + 0.05).toFixed(2));
            frag.appendChild(s);
        }
        el.appendChild(frag);
    }

    // ---------- 状态 ----------
    const LS = {
        get actor() { return localStorage.getItem('causal_actor_id') || ''; },
        set actor(v) { v ? localStorage.setItem('causal_actor_id', v) : localStorage.removeItem('causal_actor_id'); },
        get token() { return localStorage.getItem('causal_token') || ''; },
        set token(v) { v ? localStorage.setItem('causal_token', v) : localStorage.removeItem('causal_token'); },
        // 场级钥匙会话：钥匙只绑定一座场，没有任何 actor 身份
        get fieldOwner() { return localStorage.getItem('causal_field_owner_id') || ''; },
        set fieldOwner(v) { v ? localStorage.setItem('causal_field_owner_id', v) : localStorage.removeItem('causal_field_owner_id'); },
        get fieldName() { return localStorage.getItem('causal_field_name') || ''; },
        set fieldName(v) { v ? localStorage.setItem('causal_field_name', v) : localStorage.removeItem('causal_field_name'); }
    };

    // ---------- 管理员「以场主身份操作」状态（仅内存，不写 localStorage） ----------
    // 进入后整个账号中心（场 / 钥匙 / API / SKILL）都以该场主的钥匙执行；
    // 刷新页面即恢复为 admin 自己的身份，避免污染本机登录态。
    let ACT_AS = null;   // { actor, token }

    function currentActor() { return (ACT_AS && ACT_AS.actor) || LS.actor; }
    function authToken() { return (ACT_AS && ACT_AS.token) || LS.token; }
    function isActingAs() { return !!ACT_AS; }

    // 场级钥匙会话：持有有效场钥、但不属于任何 actor 身份（LS.actor 为空）
    function isFieldSession() { return !currentActor() && !!LS.token && !!LS.fieldOwner; }

    // 进入/退出场级钥匙会话时同步 localStorage
    function setFieldSession(ownerId, name) {
        LS.fieldOwner = ownerId || '';
        LS.fieldName = name || '';
    }
    function clearFieldSession() { setFieldSession('', ''); }

    function renderActAsBanner() {
        const bar = document.getElementById('act-as-bar');
        const name = document.getElementById('act-as-name');
        if (!bar) return;
        if (isActingAs()) {
            bar.classList.add('show');
            if (name) name.textContent = ACT_AS.actor;
        } else {
            bar.classList.remove('show');
        }
    }

    async function exitActAs() {
        ACT_AS = null;
        renderActAsBanner();
        updateStatus();
        await refreshAll();
        switchTab('admin');
        toast('已退出管理员视角', 'success');
    }

    function switchTab(tabName) {
        const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
        if (!tab) return;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById('panel-' + tabName);
        if (panel) panel.classList.add('active');
    }

    // ---------- 工具 ----------
    function toast(msg, type) {
        let el = document.getElementById('toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            el.className = 'toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.className = 'toast show ' + (type || '');
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
    }

    async function api(url, options) {
        try {
            const opts = Object.assign({}, options || {});
            // 统一带上 Authorization: Bearer，避免把 token 写进 URL
            const tk = authToken();
            if (tk) {
                opts.headers = Object.assign({}, opts.headers || {}, {
                    'Authorization': 'Bearer ' + tk
                });
            }
            opts.referrerPolicy = 'no-referrer';
            const res = await fetch(url, opts);
            return await res.json();
        } catch (e) {
            return { status: 'error', message: '网络错误: ' + e.message };
        }
    }

    function post(url, data) {
        return api(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
        });
    }

    function get(url) { return api(url); }

    /**
     * 用「管理员自己的钥匙」调用管理接口。
     * 代管（act-as）期间 authToken() 已切成场主的钥匙，管理接口必须显式用 LS.token，
     * 否则会返回“仅 admin 可调用该接口”。
     */
    async function adminApi(url, options) {
        try {
            const opts = Object.assign({}, options || {});
            opts.headers = Object.assign({}, opts.headers || {}, {
                'Authorization': 'Bearer ' + (LS.token || '')
            });
            opts.referrerPolicy = 'no-referrer';
            const res = await fetch(url, opts);
            return await res.json();
        } catch (e) {
            return { status: 'error', message: '网络错误: ' + e.message };
        }
    }

    function adminPost(url, data) {
        return adminApi(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
        });
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ---------- 兼容性复制函数 ----------
    function copyText(text, onSuccess) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                toast('已复制! 你可交给Agent', 'success');
                if (onSuccess) onSuccess();
            }).catch(() => {
                fallbackCopy(text, onSuccess);
            });
        } else {
            fallbackCopy(text, onSuccess);
        }
    }

    function fallbackCopy(text, onSuccess) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed'; // 避免页面滚动
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                toast('已复制', 'success');
                if (onSuccess) onSuccess();
            } else {
                toast('复制失败，请手动复制', 'error');
            }
        } catch (err) {
            toast('浏览器不支持自动复制', 'error');
        }
        document.body.removeChild(textarea);
    }

    // ---------- 状态栏 ----------
    function updateStatus() {
        const bar = document.getElementById('status-bar');
        const text = document.getElementById('status-text');
        const who = currentActor();
        if (who) {
            bar.classList.add('online');
            text.textContent = isActingAs()
                ? ('管理员视角 · 以 ' + who + ' 身份操作')
                : ('已登录: ' + who);
        } else if (isFieldSession()) {
            bar.classList.add('online');
            text.textContent = '场级钥匙 · 场：' + (LS.fieldName || LS.fieldOwner) + '（仅此场可读写）';
        } else {
            bar.classList.remove('online');
            text.textContent = '未登录';
        }
        text.title = text.textContent;   // 顶栏宽度有限，长文本省略后悬浮可见全文
        updateAuthCardVisibility();
    }

    // 已登录时无需再展示登录类卡片（含其 card-body），仅未登录时显示：
    //   · 「用钥匙快速进入」quick-token-card
    //   · 「登录」login-card
    //   · 「注册新 actor」register-card
    // 顶栏「退出」后这些卡片会自动重新出现，可用于切换账号。
    function updateAuthCardVisibility() {
        const loggedIn = !!(currentActor() && authToken());
        ['quick-token-card', 'login-card', 'register-card'].forEach(id => {
            const card = document.getElementById(id);
            if (!card) return;
            card.style.display = loggedIn ? 'none' : '';
            if (!loggedIn) card.classList.remove('collapsed');
        });
    }

    // ---------- 退出登录 ----------
    function logout() {
        ACT_AS = null;
        renderActAsBanner();
        LS.actor = '';
        LS.token = '';
        clearFieldSession();
        updateStatus();
        toast('已退出登录', 'success');
        refreshAll();
    }

    function bindLogout() {
        const btn = document.getElementById('logout-btn');
        if (btn) {
            btn.addEventListener('click', logout);
        }
    }

    // ---------- 标签切换 ----------
    function bindTabs() {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
            });
        });
    }

    // ---------- 登录 / 注册 ----------
    function bindAuth() {
        document.getElementById('login-form').addEventListener('submit', async e => {
            e.preventDefault();
            const actor = document.getElementById('login-actor').value.trim();
            const password = document.getElementById('login-password').value;
            const r = await post('/api/v1/auth/login', { actor_id: actor, password });
            if (r.status === 'success') {
                LS.actor = actor;
                LS.token = (r.data.tokens && r.data.tokens[0]) || '';
                clearFieldSession();
                updateStatus();
                toast('登录成功', 'success');
                refreshAll();
            } else {
                toast(r.message || '登录失败', 'error');
            }
        });

        document.getElementById('register-form').addEventListener('submit', async e => {
            e.preventDefault();
            const actor = document.getElementById('register-actor').value.trim();
            const password = document.getElementById('register-password').value;
            if (password.length < 6) { toast('密码至少 6 位', 'error'); return; }
            const r = await post('/api/v1/auth/register', { actor_id: actor, password });
            if (r.status === 'success') {
                LS.actor = actor;
                LS.token = r.data.token || '';
                clearFieldSession();
                document.getElementById('register-form').reset();
                updateStatus();
                toast('注册成功，首把钥匙已签发', 'success');
                refreshAll();
            } else {
                toast(r.message || '注册失败', 'error');
            }
        });

        document.getElementById('change-password-form').addEventListener('submit', async e => {
            e.preventDefault();
            const actor = document.getElementById('change-actor').value.trim();
            const oldPwd = document.getElementById('change-old').value;
            const newPwd = document.getElementById('change-new').value;
            if (newPwd.length < 6) { toast('新密码至少 6 位', 'error'); return; }
            const r = await post('/api/v1/auth/password/change', {
                actor_id: actor, old_password: oldPwd, new_password: newPwd
            });
            if (r.status === 'success') {
                document.getElementById('change-password-form').reset();
                toast(r.message || '密码已修改', 'success');
            } else {
                toast(r.message || '修改失败', 'error');
            }
        });

        document.getElementById('reset-password-form').addEventListener('submit', async e => {
            e.preventDefault();
            const actor = document.getElementById('reset-actor').value.trim();
            const token = document.getElementById('reset-token').value.trim();
            const newPwd = document.getElementById('reset-new').value;
            if (newPwd.length < 6) { toast('新密码至少 6 位', 'error'); return; }
            const r = await post('/api/v1/auth/password/reset', {
                actor_id: actor, token, new_password: newPwd
            });
            if (r.status === 'success') {
                document.getElementById('reset-password-form').reset();
                toast(r.message || '密码已重置，请用新密码登录', 'success');
            } else {
                toast(r.message || '重置失败', 'error');
            }
        });
    }

    // ---------- 场管理 ----------
    function bindOwner() {
        document.getElementById('owner-form').addEventListener('submit', async e => {
            e.preventDefault();
            if (!currentActor()) { toast('请先登录', 'error'); return; }
            const method = document.getElementById('owner-method').value.trim().toLowerCase();
            const bot_id = document.getElementById('owner-bot-id').value.trim();
            const source_id = document.getElementById('owner-source-id').value.trim();
            const name = document.getElementById('owner-name').value.trim();
            if (!bot_id) { toast('请填写机器人 ID（bot_id）', 'error'); return; }
            if (method === 'group' && !source_id) { toast('群聊场景请填写群 ID（source_id）', 'error'); return; }
            // owner_id 由后端按统一规则生成，这里只提交场类型与要素
            const r = await post('/api/v1/owner/create', {
                method, bot_id, source_id: method === 'group' ? source_id : '', name,
                actor_id: currentActor(),
            });
            if (r.status === 'success') {
                document.getElementById('owner-form').reset();
                syncOwnerMethodFields();
                toast('场已创建：' + ((r.data && r.data.owner_id) || ''), 'success');
                refreshOwners();
                // 建场即签发场级钥匙：直接弹窗展示（可复制给群成员）
                if (r.data && r.data.field_token) {
                    openFieldKeyModal(r.data.owner_id, r.data.field_token);
                }
            } else {
                toast(r.message || '创建失败', 'error');
            }
        });
        const methodSel = document.getElementById('owner-method');
        if (methodSel) methodSel.addEventListener('change', syncOwnerMethodFields);
        syncOwnerMethodFields();
    }

    /** 私聊隐藏并清空群 ID；群聊时群 ID 必填 */
    function syncOwnerMethodFields() {
        const sel = document.getElementById('owner-method');
        const src = document.getElementById('owner-source-id');
        if (!sel || !src) return;
        const isGroup = sel.value === 'group';
        src.disabled = !isGroup;
        src.required = isGroup;
        if (!isGroup) src.value = '';
        src.placeholder = isGroup ? '群聊必填，例如 454652835' : '私聊无需填写';
    }

    // function enter(ownerId, isEdit = false) {
    //     // 场名形如 {owner_actor}_{bot_id} 时，用下划线后半段作为 actor_id（如 755750209_3787687088 -> 3787687088）
    //     let actorId = LS.actor;
    //     const idx = ownerId.indexOf('_');
    //     if (idx !== -1) {
    //         const suffix = ownerId.slice(idx + 1);
    //         if (suffix) actorId = suffix;
    //     }
    //     const token = LS.token || '';
    //     const url = '/3d?owner_id=' + encodeURIComponent(ownerId)
    //         + '&actor_id=' + encodeURIComponent(actorId)
    //         + (token ? '&token=' + encodeURIComponent(token) : '')
    //         + (isEdit ? '&edit=true' : '');
    //     window.open(url, '_blank');
    // }

    /** 在已缓存的场列表（当前用户 + admin 视图）中查找场的元数据 */
    function findOwnerMeta(ownerId) {
        const local = (OWNERS_CACHE || []).find(o => o && o.owner_id === ownerId);
        if (local) return local;
        for (const owner of (ADMIN_OWNERS_CACHE || [])) {
            const f = (owner.fields || []).find(x => x && x.owner_id === ownerId);
            if (f) return f;
        }
        return null;
    }

    /**
     * 把 owner_id 拆成 source_id + bot_id。
     *
     * 后端生成规则（main.py owner_create）：
     *   private → owner_id = "{创建者actor_id}_{bot_id}"
     *   group   → owner_id = "{source_id}_{bot_id}"
     * 即 owner_id 一律是「前半段 + _ + bot_id」两段式；不含 _ 的场无法拆分，
     * 属于公共/理论等老式单段场（如 222302526），与字符类型无关（不限定纯数字）。
     *
     * 拆分要点：bot_id 可能是 wxid_ 形态（含下划线），
     * 所以有 "_wxid" 时以第一个 "_wxid" 为界，不能用 lastIndexOf('_')，
     * 否则 21122263971@chatroom_wxid_lmu529xf597z22 会被截成 lmu529xf597z22（丢掉 wxid_ 前缀）。
     *
     * @returns {{sourceId: string, botId: string, hasBot: boolean, isWxidBot: boolean}}
     */
    function parseOwnerId(ownerId) {
        const id = String(ownerId || '');
        const wxIdx = id.indexOf('_wxid');
        if (wxIdx > 0) {
            return {
                sourceId: id.slice(0, wxIdx),
                botId: id.slice(wxIdx + 1),
                hasBot: true,
                isWxidBot: true,      // bot_id 是 wxid_ 形态 → 群聊接入
            };
        }
        const idx = id.lastIndexOf('_');
        if (idx > 0 && idx < id.length - 1) {
            return {
                sourceId: id.slice(0, idx),
                botId: id.slice(idx + 1),
                hasBot: true,
                isWxidBot: false,
            };
        }
        // 不含 _（或下划线在首尾）：单段场，无法拆出 bot_id
        return { sourceId: id, botId: '', hasBot: false, isWxidBot: false };
    }

    /**
     * 统一解析进入场时的 actor_id。
     *
     * 规则（按优先级）：
     * 1. 元数据 method=group   → bot_id（群聊：以机器人身份进入）
     * 2. 元数据 method=private → source_id（私聊：以对话方身份进入）
     * 3. owner_id 含 "_wxid"   → bot_id（群聊接入的真实形态，如
     *    21122263971@chatroom_wxid_lmu529xf597z22 → wxid_lmu529xf597z22）
     * 4. owner_id 含 _         → source_id（去掉末尾 _{bot_id} 的前半段）
     * 5. owner_id 不含 _       → 当前登录 actor（公共场：actor 是观测者而非场主，
     *    例如 ?owner_id=222302526&actor_id=415135222）；未登录时回退 owner_id。
     */
    function resolveOwnerActorId(ownerId, meta) {
        const parsed = parseOwnerId(ownerId);

        if (meta) {
            if (meta.method === 'group') return meta.bot_id || parsed.botId || currentActor();
            if (meta.method === 'private') return meta.source_id || parsed.sourceId || currentActor();
        }
        if (parsed.isWxidBot) return parsed.botId;
        if (parsed.hasBot) return parsed.sourceId;
        return currentActor() || parsed.sourceId;
    }

    /** 取该场的 bot_id：优先用元数据，其次按 parseOwnerId 拆分（保留 wxid_ 前缀） */
    function resolveOwnerBotId(ownerId, meta) {
        if (meta && meta.bot_id) return meta.bot_id;
        return parseOwnerId(ownerId).botId;
    }

    function enter(ownerId, isEdit = false) {
        const meta = findOwnerMeta(ownerId);
        const actorId = resolveOwnerActorId(ownerId, meta);

        const token = authToken();
        const url = '/3d?owner_id=' + encodeURIComponent(ownerId)
            + '&actor_id=' + encodeURIComponent(actorId)
            + (token ? '&token=' + encodeURIComponent(token) : '')
            + (isEdit ? '&edit=true' : '');
        window.open(url, '_blank');
    }


    // ---------- Agent 专用场 Memory 直连 ----------
    // owner_id 形如 {source_id}_{bot_id}：前半段即 source_id，后半段即 bot_id。
    // 例如 454652835_3787687088 => source_id = 454652835, bot_id = 3787687088；
    //      21122263971@chatroom_wxid_lmu529xf597z22 => bot_id = wxid_lmu529xf597z22。
    // actor_id 仍由 resolveOwnerActorId 统一决定（群聊取 bot_id，私聊取 source_id）。
    function enterMemory(ownerId) {
        const meta = findOwnerMeta(ownerId);
        if (!ownerId.includes('_')) { toast('该场非 Agent 专用场（owner_id 无 _），无 Memory', 'error'); return; }
        const ownerActor = resolveOwnerActorId(ownerId, meta) || currentActor(); // 观测者 actor_id
        const botId = resolveOwnerBotId(ownerId, meta);                            // bot_id
        if (!botId) { toast('bot_id 为空，无法拼接 Memory URL', 'error'); return; }
        const token = authToken();
        const url = '/3d?owner_id=' + encodeURIComponent(ownerId)
            + '&actor_id=' + encodeURIComponent(ownerActor)
            + '&bot_id=' + encodeURIComponent(botId)
            + (token ? '&token=' + encodeURIComponent(token) : '')
            + '&edit=true';
        window.open(url, '_blank');
    }

    // ---------- 场的列表渲染（宽屏网格平铺 + 搜索过滤，所有操作直接铺开） ----------
    let OWNERS_CACHE = [];            // 当前 actor 名下场（接口原始数据）
    let OWNER_QUERY = '';             // 搜索关键字（纯前端过滤）
    let ADMIN_OWNERS_CACHE = [];      // admin 视图的场主及其场元数据

    async function refreshOwners() {
        const box = document.getElementById('owner-list');
        if (!box) return;
        if (!currentActor()) {
            OWNERS_CACHE = [];
            if (isFieldSession()) {
                renderFieldSession(box);
            } else {
                box.innerHTML = '<p class="empty">请先登录后查看名下场</p>';
            }
            updateOwnerCount(0, 0);
            return;
        }
        const r = await get('/api/v1/owner/list?actor_id=' + encodeURIComponent(currentActor()));
        OWNERS_CACHE = (r.status === 'success' && r.data) ? r.data : [];
        renderOwners();
    }

    /** 按关键字过滤场：场名 / owner_id 任一命中即保留 */
    function filterOwners(owners, query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return owners;
        return owners.filter(o => String(o.name || '').toLowerCase().indexOf(q) !== -1
            || String(o.owner_id || '').toLowerCase().indexOf(q) !== -1);
    }

    function updateOwnerCount(total, shown) {
        const el = document.getElementById('owner-count');
        if (!el) return;
        if (!total) { el.textContent = ''; return; }
        el.textContent = (shown === total) ? ('共 ' + total + ' 座') : ('命中 ' + shown + ' / ' + total + ' 座');
    }

    /** 场级钥匙会话：只展示钥匙绑定的这座场，提供进入/复制；管理操作需 actor 级钥匙 */
    function renderFieldSession(box) {
        const ownerId = LS.fieldOwner;
        const name = LS.fieldName || ownerId;
        const id = escapeHtml(ownerId);
        box.innerHTML = `
            <div class="item field-session">
                <div class="meta">
                    <div class="name">${escapeHtml(name)}</div>
                    <div class="id">${id}</div>
                    <p class="hint" style="margin-top:6px">当前为「场级钥匙」会话：凭此钥匙可读写这一座场（仅这一座）。
                        改名 / 场锁 / 重置场钥 / 删除等管理操作，需场主持 actor 级钥匙登录后进行。</p>
                </div>
                <div class="actions">
                    <button class="btn small ghost" id="fs-enter-read" title="进入星空（只读）">◉ 只读</button>
                    <button class="btn small primary" id="fs-enter-edit" title="进入星空（可写/可编辑）">◐ 可写</button>
                    <button class="btn small ghost" id="fs-copy" title="复制场级钥匙">⧉ 复制场钥</button>
                </div>
            </div>`;
        const enterFs = (isEdit) => {
            const actorId = resolveOwnerActorId(ownerId, null) || 'guest';
            const url = '/3d?owner_id=' + encodeURIComponent(ownerId)
                + '&actor_id=' + encodeURIComponent(actorId)
                + '&token=' + encodeURIComponent(LS.token)
                + (isEdit ? '&edit=true' : '');
            window.open(url, '_blank');
        };
        box.querySelector('#fs-enter-read').addEventListener('click', () => enterFs(false));
        box.querySelector('#fs-enter-edit').addEventListener('click', () => enterFs(true));
        box.querySelector('#fs-copy').addEventListener('click', () => copyText(LS.token));
    }

    function renderOwners() {
        const box = document.getElementById('owner-list');
        if (!box) return;
        const owners = filterOwners(OWNERS_CACHE, OWNER_QUERY);
        updateOwnerCount(OWNERS_CACHE.length, owners.length);

        if (!OWNERS_CACHE.length) {
            box.innerHTML = '<p class="empty">暂无场，先在上方创建一座</p>';
            return;
        }
        if (!owners.length) {
            box.innerHTML = '<p class="empty">没有匹配「' + escapeHtml(OWNER_QUERY) + '」的场</p>';
            return;
        }

        box.innerHTML = owners.map(o => {
            const id = escapeHtml(o.owner_id);
            return `
            <div class="item" data-owner-row="${id}">
                <div class="meta">
                    <div class="name">${escapeHtml(o.name)}</div>
                    <div class="id">${id}</div>
                </div>
                <div class="actions">
                    <button class="btn small ghost" data-enter="${id}" title="进入星空（只读）">◉ 只读</button>
                    <button class="btn small primary" data-enter="${id}" data-edit="true" title="进入星空（可写/可编辑）">◐ 可写</button>
                    ${o.owner_id.includes('_') ? '<button class="btn small memory" data-memory="' + id + '">◈ Memory</button>' : ''}
                    <button class="btn small ghost" data-rename="${id}">✎ 改名</button>
                    <button class="btn small api" data-fkey="${id}" title="场级钥匙：只开这一座场，可查看/复制/重置">⚿ 场钥</button>
                    <button class="btn small ${o.is_locked ? 'danger' : 'ghost'}" data-lock="${id}" data-locked="${o.is_locked ? '1' : ''}" title="场级锁：上锁后该场的场级钥匙全部失效（actor 级钥匙不受影响）">${o.is_locked ? '🔒 已上锁' : '🔓 场锁'}</button>
                    <button class="btn small api" data-api="${id}">⌁ 获取API</button>
                    <button class="btn small api" data-skill="${id}">⌁ 获取SKILL</button>
                    <button class="btn small danger" data-del="${id}">⌫ 删除</button>
                    <button class="btn small danger" data-delall="${id}">⌫ 删除全部</button>
                </div>
            </div>`;
        }).join('');

        box.querySelectorAll('[data-enter]').forEach(b => b.addEventListener('click', () => enter(b.dataset.enter, b.dataset.edit === 'true')));
        box.querySelectorAll('[data-memory]').forEach(b => b.addEventListener('click', () => enterMemory(b.dataset.memory)));
        box.querySelectorAll('[data-rename]').forEach(b => b.addEventListener('click', async () => {
            const name = prompt('新场名称：');
            if (!name) return;
            const r = await post('/api/v1/owner/update', { owner_id: b.dataset.rename, name, actor_id: currentActor() });
            toast(r.message || (r.status === 'success' ? '已改名' : '改名失败'), r.status === 'success' ? 'success' : 'error');
            refreshOwners();
        }));
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('确定删除该场？(不删除节点数据)')) return;
            const r = await post('/api/v1/owner/delete', { owner_id: b.dataset.del, actor_id: currentActor() });
            toast(r.message || (r.status === 'success' ? '已删除' : '删除失败'), r.status === 'success' ? 'success' : 'error');
            refreshOwners();
        }));
        box.querySelectorAll('[data-delall]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('确定彻底删除该场？将删除所有事件节点、地宫、权重及场注册，且无法恢复！')) return;
            const r = await post('/api/v1/owner/delete_all', { owner_id: b.dataset.delall, actor_id: currentActor() });
            toast(r.message || (r.status === 'success' ? '已彻底删除' : '删除失败'), r.status === 'success' ? 'success' : 'error');
            refreshOwners();
        }));
        box.querySelectorAll('[data-api]').forEach(b => b.addEventListener('click', () => openApiSkillModal(b.dataset.api, 'api')));
        box.querySelectorAll('[data-skill]').forEach(b => b.addEventListener('click', () => openApiSkillModal(b.dataset.skill, 'skill')));
        box.querySelectorAll('[data-fkey]').forEach(b => b.addEventListener('click', () => openFieldKeyModal(b.dataset.fkey)));
        box.querySelectorAll('[data-lock]').forEach(b => b.addEventListener('click', async () => {
            const locked = b.dataset.locked !== '1';
            if (locked && !confirm('上锁后，该场所有场级钥匙立即失效（持钥者校验直接报错）；\n你的 actor 级钥匙不受影响。确定上锁？')) return;
            const r = await post('/api/v1/owner/lock', { owner_id: b.dataset.lock, actor_id: currentActor(), locked });
            toast(r.message || (r.status === 'success' ? '已切换' : '操作失败'), r.status === 'success' ? 'success' : 'error');
            refreshOwners();
        }));
    }

    /** 搜索框：按场名 / owner_id 实时过滤已缓存的场列表 */
    function bindOwnerSearch() {
        const input = document.getElementById('owner-search');
        if (!input) return;
        input.addEventListener('input', () => {
            OWNER_QUERY = input.value.trim();
            renderOwners();
        });
    }


    // ---------- 场级钥匙弹窗（查看 / 复制 / 重置） ----------
    let FKEY_CURRENT_OWNER = '';

    function openFieldKeyModal(ownerId, knownToken) {
        FKEY_CURRENT_OWNER = ownerId;
        document.getElementById('fkey-modal-owner').textContent = ownerId;
        const valEl = document.getElementById('fkey-modal-value');
        valEl.textContent = knownToken || '加载中…';
        document.getElementById('fkey-modal').classList.add('show');
        if (!knownToken) {
            post('/api/v1/owner/field_key/show', { owner_id: ownerId, actor_id: currentActor() })
                .then(r => {
                    if (r.status === 'success' && r.data && r.data.field_token) {
                        valEl.textContent = r.data.field_token;
                    } else {
                        valEl.textContent = r.message || '获取失败';
                    }
                })
                .catch(() => { valEl.textContent = '网络错误'; });
        }
    }

    function bindFieldKeyModal() {
        const modal = document.getElementById('fkey-modal');
        if (!modal) return;
        document.getElementById('fkey-modal-close').addEventListener('click', () => modal.classList.remove('show'));
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
        document.getElementById('fkey-modal-copy').addEventListener('click', async () => {
            const v = document.getElementById('fkey-modal-value').textContent.trim();
            if (!v || v === '加载中…') return;
            try {
                await navigator.clipboard.writeText(v);
                toast('场级钥匙已复制', 'success');
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = v; document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); ta.remove();
                toast('场级钥匙已复制', 'success');
            }
        });
        document.getElementById('fkey-modal-reset').addEventListener('click', async () => {
            if (!FKEY_CURRENT_OWNER) return;
            if (!confirm('确定重置该场的场级钥匙？\n旧钥匙立即失效，持有旧钥匙的人将无法再进入本场。')) return;
            const r = await post('/api/v1/owner/field_key/reset', { owner_id: FKEY_CURRENT_OWNER, actor_id: currentActor() });
            if (r.status === 'success' && r.data && r.data.field_token) {
                document.getElementById('fkey-modal-value').textContent = r.data.field_token;
                toast('场钥已重置，旧钥匙立即失效', 'success');
            } else {
                toast(r.message || '重置失败', 'error');
            }
        });
    }

    // ---------- 钥匙管理 ----------
    function bindKeys() {
        document.getElementById('key-generate').addEventListener('click', async () => {
            if (!currentActor()) { toast('请先登录', 'error'); return; }
            const r = await post('/api/v1/key/generate', { actor_id: currentActor() });
            if (r.status === 'success') {
                // 管理员视角下不覆盖自己的主钥匙，只展示新钥匙
                if (!isActingAs()) {
                    LS.token = r.data.token;
                }
                const box = document.getElementById('key-new');
                box.textContent = '新钥匙（仅显示一次，请妥善保存）：' + r.data.token;
                box.classList.add('show');
                toast('钥匙已签发', 'success');
                refreshKeys();
            } else {
                toast(r.message || '签发失败', 'error');
            }
        });
    }

    async function refreshKeys() {
        const box = document.getElementById('key-list');
        if (!currentActor()) { box.innerHTML = '<p class="empty">请先登录后查看钥匙</p>'; return; }
        const r = await get('/api/v1/key/list?actor_id=' + encodeURIComponent(currentActor()));
        const tokens = (r.status === 'success' && r.data) ? r.data : [];
        if (!tokens.length) {
            box.innerHTML = '<p class="empty">暂无钥匙</p>';
            return;
        }
        box.innerHTML = tokens.map(t => {
            const mask = t.slice(0, 6) + '••••' + t.slice(-4);
            const active = t === authToken();
            return `
            <div class="item">
                <div class="meta">
                    <div class="name mono">${escapeHtml(mask)} ${active ? '<span style="color:#34d399">●主钥匙</span>' : ''}</div>
                    <div class="id">${active ? '' : '点击「设为主钥匙」用于进入私密场域'}</div>
                </div>
                <div class="actions">
                    <button class="btn small primary" data-use="${escapeHtml(t)}">设为主钥匙</button>
                    <button class="btn small ghost" data-copy="${escapeHtml(t)}">复制</button>
                    <button class="btn small danger" data-revoke="${escapeHtml(t)}">吊销</button>
                </div>
            </div>`;
        }).join('');

        box.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
            if (isActingAs()) {
                ACT_AS.token = b.dataset.use;   // 管理员视角：换成该场主的另一把钥匙
            } else {
                LS.token = b.dataset.use;
            }
            toast('已设为主钥匙', 'success');
            updateStatus();
            refreshKeys();
        }));
        box.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
            copyText(b.dataset.copy);
        }));
        box.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('确定吊销该钥匙？')) return;
            const r = await post('/api/v1/key/revoke', { actor_id: currentActor(), token: b.dataset.revoke });
            toast(r.message || (r.status === 'success' ? '已吊销' : '吊销失败'), r.status === 'success' ? 'success' : 'error');
            refreshKeys();
        }));
    }

    // ---------- API / SKILL 模态框 ----------
    let API_MD_CACHE = null;
    let SKILL_MD_CACHE = null;

    async function loadApiMd() {
        if (API_MD_CACHE != null) return API_MD_CACHE;
        try {
            const res = await fetch('/api/v1/apimd/raw');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            API_MD_CACHE = await res.text();
        } catch (e) {
            API_MD_CACHE = '';
            toast('读取 API.md 失败: ' + e.message, 'error');
        }
        return API_MD_CACHE;
    }

    async function loadSkillMd() {
        if (SKILL_MD_CACHE != null) return SKILL_MD_CACHE;
        try {
            const res = await fetch('/SKILL.md');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            SKILL_MD_CACHE = await res.text();
        } catch (e) {
            SKILL_MD_CACHE = '';
            toast('读取 SKILL.md 失败: ' + e.message, 'error');
        }
        return SKILL_MD_CACHE;
    }

    function fillTemplate(tpl, ownerId) {
        const baseUrl = window.location.origin;
        return String(tpl == null ? '' : tpl)
            .replace(/\{base_url\}/g, baseUrl)
            .replace(/\{owner_id\}/g, ownerId || '')
            .replace(/\{actor_id\}/g, currentActor() || '')
            .replace(/\{token\}/g, authToken() || '');
    }

    // ---------- EasyMDE 只读编辑器（复用 event-tuple-modal 的 Markdown 渲染菜单栏方案） ----------
    let apiMde = null;

    function ensureApiEditor() {
        if (apiMde) return apiMde;
        const el = document.getElementById('api-editor');
        if (!el) return null;
        try {
        const isMobile = window.innerWidth < 768;
        apiMde = new EasyMDE({
            element: el,
            spellChecker: false,
            autoDownloadFontAwesome: false,
            status: isMobile ? false : ['lines', 'words'],
            renderingConfig: { 
                codeSyntaxHighlighting: true,
                markedOptions: {
                    extensions: (window.markedKatex ? window.markedKatex({ throwOnError: false }).extensions : [])
                    
                }
            },

            theme: 'sober',
            minHeight: isMobile ? '200px' : '420px',
            placeholder: '（只读）API / SKILL 文档...',
            toolbar: isMobile
                ? ["preview", "|", "guide"]
                : ["preview", "side-by-side", "fullscreen", "|", "guide"]
        });
        } catch(e) {
            console.error("EasyMDE init error", e);
            return null;
        }
        return apiMde;
    }

    async function openApiSkillModal(ownerId, kind) {
        if (!ownerId) { toast('缺少场 ID', 'error'); return; }
        const tpl = kind === 'skill' ? await loadSkillMd() : await loadApiMd();
        const rendered = fillTemplate(tpl, ownerId);
        const mde = ensureApiEditor();
        if (!mde) { toast('Markdown 编辑器初始化失败', 'error'); return; }
        mde.value(rendered);
        if (mde.codemirror) {
            mde.codemirror.setOption('readOnly', true);
            // 等模态框显示后再刷新，确保 CodeMirror 高度计算正确
            setTimeout(() => mde.codemirror.refresh(), 150);
        }
        const modal = document.getElementById('api-modal');
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeApiSkillModal() {
        const modal = document.getElementById('api-modal');
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }

    function bindApiModal() {
        const modal = document.getElementById('api-modal');
        document.getElementById('api-close').addEventListener('click', closeApiSkillModal);
        document.getElementById('api-copy').addEventListener('click', () => {
            const btn = document.getElementById('api-copy');
            const mde = ensureApiEditor();
            const text = mde ? (mde.value() || '') : '';
            if (!text) { toast('无可复制内容', 'error'); return; }
            copyText(text, () => {
                const original = btn.innerHTML;
                btn.innerHTML = '✓ 已复制';
                btn.style.color = '#10b981';
                clearTimeout(btn._copiedTimer);
                btn._copiedTimer = setTimeout(() => {
                    btn.innerHTML = original;
                    btn.style.color = '';
                }, 2000);
            });
        });
        modal.addEventListener('click', e => {
            if (e.target === modal || e.target.hasAttribute('data-close')) closeApiSkillModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal.classList.contains('show')) closeApiSkillModal();
        });
    }

    // ---------- 用钥匙快速进入 ----------
    function bindQuickToken() {
        const form = document.getElementById('quick-token-form');
        if (!form) return;
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const token = document.getElementById('quick-token').value.trim();
            const hintActor = document.getElementById('quick-token-actor').value.trim();
            if (!token) { toast('请粘贴钥匙 token', 'error'); return; }

            const r = await post('/api/v1/auth/token/verify', { token, owner_id: 'default' });
            if (r.status !== 'success' || !r.data || !r.data.valid) {
                if (r.data && r.data.is_locked) {
                    toast(r.message || '该场已上锁，场级钥匙暂不可用', 'error');
                } else {
                    toast(r.message || '钥匙无效', 'error');
                }
                return;
            }
            ACT_AS = null;               // 手动换钥匙即退出管理员视角
            renderActAsBanner();
            if (r.data.key_scope === 'field') {
                // 场级钥匙：不绑定任何 actor，进入「单场会话」
                LS.token = token;
                LS.actor = '';
                setFieldSession(r.data.field_owner_id || '', r.data.field_name || '');
                updateStatus();
                toast('场级钥匙有效，已入场：' + (r.data.field_name || r.data.field_owner_id), 'success');
                refreshAll();
                return;
            }
            clearFieldSession();
            const actorId = r.data.actor_id || hintActor;
            LS.token = token;
            LS.actor = actorId;
            updateStatus();
            toast('钥匙有效，已缓存身份：' + actorId, 'success');
            refreshAll();
        });

        // URL 里带 token：自动验证并缓存，然后清理地址栏
        const urlToken = new URLSearchParams(window.location.search).get('token');
        if (urlToken) {
            post('/api/v1/auth/token/verify', { token: urlToken, owner_id: 'default' }).then(r => {
                if (r.status === 'success' && r.data && r.data.valid) {
                    ACT_AS = null;
                    renderActAsBanner();
                    LS.token = urlToken;
                    if (r.data.key_scope === 'field') {
                        // 场级钥匙：进入「单场会话」，不缓存 actor 身份
                        LS.actor = '';
                        setFieldSession(r.data.field_owner_id || '', r.data.field_name || '');
                        updateStatus();
                        toast('已用地址栏场级钥匙入场：' + (r.data.field_name || r.data.field_owner_id), 'success');
                    } else {
                        clearFieldSession();
                        LS.actor = r.data.actor_id;
                        updateStatus();
                        toast('已用地址栏钥匙登录：' + r.data.actor_id, 'success');
                    }
                    refreshAll();
                } else {
                    toast((r && r.message) || '地址栏钥匙无效', 'error');
                }
                const url = new URL(window.location.href);
                url.searchParams.delete('token');
                window.history.replaceState({}, '', url);
            });
        }
    }

    // ---------- 场主管理（仅 admin 可见） ----------
    // admin 的本职：看有哪些场主 → 进入其账号中心（以他身份操作）→ 重置钥匙 → 注销并删除其全部场
    let ADMIN_IS_ADMIN = false;
    let ADMIN_SELECTED = null;   // 当前选中的场主 actor_id

    async function refreshAdmin() {
        // 始终用管理员自己的钥匙判断权限（act-as 期间也要看真实身份）
        if (!LS.actor || !LS.token) { ADMIN_IS_ADMIN = false; return; }
        const ctx = await adminApi('/api/v1/auth/context?owner_id=default');
        ADMIN_IS_ADMIN = !!(ctx.status === 'success' && ctx.data && ctx.data.is_admin);

        const tab = document.getElementById('tab-admin');
        if (tab) tab.style.display = ADMIN_IS_ADMIN ? '' : 'none';
        if (!ADMIN_IS_ADMIN) {
            const panel = document.getElementById('panel-admin');
            if (panel) panel.classList.remove('active');
            return;
        }

        const owners = await adminApi('/api/v1/admin/owners');
        const nav = document.getElementById('admin-owner-nav');
        const detail = document.getElementById('admin-owner-detail');
        const summary = document.getElementById('admin-owner-summary');
        if (!nav || !detail) return;

        const list = (owners.status === 'success' && owners.data) ? owners.data : [];
        ADMIN_OWNERS_CACHE = list;
        if (summary) {
            const totalFields = list.reduce((s, o) => s + (o.field_count || 0), 0);
            const totalNodes = list.reduce((s, o) => s + (o.node_count || 0), 0);
            summary.textContent = `场主 ${list.length} 位 · 场 ${totalFields} 套 · 节点 ${totalNodes} 个`;
        }
        if (!list.length) {
            nav.innerHTML = '<p class="empty">暂无场主（还没有任何场）</p>';
            detail.innerHTML = '';
            return;
        }

        // 保持选中态：原选中还在则继续，否则回退到第一位
        if (!list.some(o => o.actor_id === ADMIN_SELECTED)) {
            ADMIN_SELECTED = list[0].actor_id;
        }

        renderAdminNav(list, nav);
        renderAdminDetail(list, detail);
    }

    /** 左栏：场主列表（三件基本操作：进入他的星空 / 重置token / 删除全部；admin 升降级在右上角小开关） */
    function renderAdminNav(list, nav) {
        nav.innerHTML = list.map(o => {
            const isSelf = o.actor_id === LS.actor;
            const active = o.actor_id === ADMIN_SELECTED;
            const grantFlag = o.is_admin ? 'false' : 'true';
            return `
            <div class="admin-owner-item${active ? ' active' : ''}" data-nav-owner="${escapeHtml(o.actor_id)}">
                <div class="admin-owner-item-head">
                    <span class="admin-owner-actor" title="${escapeHtml(o.actor_id)}">${escapeHtml(o.actor_id)}</span>
                    ${o.is_admin ? '<span class="badge-admin">admin</span>' : ''}
                    ${isSelf ? '<span class="badge-self">我</span>' : ''}
                    <button class="admin-toggle" data-grant="${escapeHtml(o.actor_id)}" data-flag="${grantFlag}"
                            title="${o.is_admin ? '取消该场主的 admin 权限' : '赋予该场主 admin 权限'}">${o.is_admin ? '取消admin' : '设为admin'}</button>
                </div>
                <div class="admin-owner-item-stats">场 ${o.field_count} · 节点 ${o.node_count} · 钥匙 ${o.token_count}</div>
                <div class="admin-owner-item-actions">
                    <button class="btn tiny primary" data-enter-star="${escapeHtml(o.actor_id)}">进入他的星空</button>
                    <button class="btn tiny ghost" data-reset="${escapeHtml(o.actor_id)}">重置token</button>
                    <button class="btn tiny danger" data-kill="${escapeHtml(o.actor_id)}" ${isSelf ? 'disabled title="不能删除自己"' : ''}>删除全部</button>
                </div>
            </div>`;
        }).join('');

        nav.querySelectorAll('[data-nav-owner]').forEach(item => item.addEventListener('click', () => {
            ADMIN_SELECTED = item.dataset.navOwner;
            renderAdminNav(list, nav);
            renderAdminDetail(list, document.getElementById('admin-owner-detail'));
        }));
        nav.querySelectorAll('[data-enter-star]').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            const owner = list.find(x => x.actor_id === b.dataset.enterStar) || {};
            enterOwnerStar(b.dataset.enterStar, owner.fields || []);
        }));
        nav.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            resetOwnerToken(b.dataset.reset);
        }));
        nav.querySelectorAll('[data-grant]').forEach(b => b.addEventListener('click', async e => {
            e.stopPropagation();
            const r = await adminPost('/api/v1/admin/actors/' + encodeURIComponent(b.dataset.grant) + '/admin', {
                is_admin: b.dataset.flag === 'true'
            });
            toast(r.message || (r.status === 'success' ? '已更新' : '更新失败'), r.status === 'success' ? 'success' : 'error');
            refreshAdmin();
        }));
        nav.querySelectorAll('[data-kill]').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation();
            killOwner(b.dataset.kill, list);
        }));
    }

    /** 右栏：选中场主的名下场（磁贴网格，铺满宽屏） */
    function renderAdminDetail(list, detail) {
        const owner = list.find(o => o.actor_id === ADMIN_SELECTED);
        if (!owner) { detail.innerHTML = '<p class="detail-empty">请选择左侧场主</p>'; return; }

        const fields = owner.fields || [];
        const tiles = fields.map(f => {
            const name = f.name || f.owner_id;
            const showId = (f.name && f.name !== f.owner_id) ? f.owner_id : '';
            const full = (f.name && f.name !== f.owner_id) ? (f.name + '（' + f.owner_id + '）') : f.owner_id;
            return `
            <div class="field-tile" data-field-actor="${escapeHtml(owner.actor_id)}" data-field-id="${escapeHtml(f.owner_id)}" title="${escapeHtml(full)}">
                <div class="field-tile-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                <div class="field-tile-meta">${showId ? escapeHtml(showId) + ' · ' : ''}${f.node_count} 节点</div>
                <div class="field-tile-foot">
                    <button class="field-star" data-star="${escapeHtml(f.owner_id)}" data-star-actor="${escapeHtml(owner.actor_id)}">进入星空 ↗</button>
                </div>
            </div>`;
        }).join('');

        detail.innerHTML = `
            <div class="admin-detail-head">
                <div>名下场：<b>${escapeHtml(owner.actor_id)}</b> · 共 ${fields.length} 座</div>
                <span class="admin-detail-hint">点场名 = 以他身份进入账号中心 · ↗ = 打开可写星空</span>
            </div>
            <div class="field-tile-grid">${tiles || '<p class="detail-empty">（该场主暂无场）</p>'}</div>`;

        detail.querySelectorAll('[data-field-id]').forEach(tile => tile.addEventListener('click', async e => {
            if (e.target.closest('[data-star]')) return;
            await enterActAs(tile.dataset.fieldActor, tile.dataset.fieldId);
        }));
        detail.querySelectorAll('[data-star]').forEach(btn => btn.addEventListener('click', async e => {
            e.stopPropagation();
            const ok = await enterActAs(btn.dataset.starActor, null, { silent: true });
            if (ok) enter(btn.dataset.star, true);
        }));
    }

    /**
     * 「进入他的星空」：以该场主身份进入。
     * 统一进他的账号中心「场」列表（管理卡片集），由 admin 自行点任一场进入 3D。
     */
    async function enterOwnerStar(actorId, fields) {
        const ok = await enterActAs(actorId, null, { silent: true });
        if (!ok) return;
        const list = fields || [];
        switchTab('owner');
        toast('已进入 ' + actorId + ' 的星空 · ' + list.length + ' 座场，点任一场进入 3D', 'success');
    }
    /**
     * 以某个场主的身份进入账号中心（内存态 token，不写 localStorage）。
     * @param actorId      目标场主
     * @param focusFieldId 可选：进入后高亮/滚动到这座场
     * @param opts.silent  可选：不切换 tab、不弹提示（仅供“进入星空”复用）
     * @returns {Promise<boolean>} 是否成功
     */
    async function enterActAs(actorId, focusFieldId, opts) {
        opts = opts || {};
        const d = await adminApi('/api/v1/admin/actors/' + encodeURIComponent(actorId));
        if (d.status !== 'success' || !d.data) {
            toast(d.message || '读取场主详情失败', 'error');
            return false;
        }
        let ownerToken = d.data.first_token || '';
        // 该场主没有任何钥匙时，由 admin 代签一把（用于本次代管）
        if (!ownerToken) {
            const g = await adminPost('/api/v1/key/generate', { actor_id: actorId });
            if (g.status !== 'success' || !g.data) {
                toast(g.message || '该场主无钥匙且代签失败', 'error');
                return false;
            }
            ownerToken = g.data.token;
            toast('该场主原本没有钥匙，已代签一把', 'success');
        }
        ACT_AS = { actor: actorId, token: ownerToken };
        renderActAsBanner();
        updateStatus();
        await refreshAll();
        if (opts.silent) return true;

        switchTab('owner');
        if (focusFieldId) highlightOwnerRow(focusFieldId);
        toast('已进入 ' + actorId + ' 的账号中心', 'success');
        return true;
    }

    /** 在「场」tab 里高亮并滚动到指定场 */
    function highlightOwnerRow(ownerId) {
        // 从「场主管理」跳过来时先清空搜索过滤，避免目标场被关键字隐藏
        const search = document.getElementById('owner-search');
        if (OWNER_QUERY || (search && search.value)) {
            OWNER_QUERY = '';
            if (search) search.value = '';
            renderOwners();
        }
        const row = document.querySelector('[data-owner-row="' + String(ownerId).replace(/"/g, '') + '"]');
        if (!row) return;
        row.classList.add('owner-row-flash');
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => row.classList.remove('owner-row-flash'), 2400);
    }

    /** 重置场主钥匙（旧钥匙全部失效，新钥匙仅显示一次） */
    async function resetOwnerToken(actorId) {
        if (!confirm(`确定重置 ${actorId} 的钥匙？\n\n· 他名下所有旧钥匙将立即失效\n· 系统会签发一把新钥匙（仅显示一次）`)) return;
        const r = await adminPost('/api/v1/admin/actors/' + encodeURIComponent(actorId) + '/token/reset', {});
        if (r.status === 'success') {
            showTokenModal(actorId, r.data.token, r.data.revoked_count);
            refreshAdmin();
        } else {
            toast(r.message || '重置失败', 'error');
        }
    }

    /** 注销场主并删除其名下全部场 */
    async function killOwner(actorId, list) {
        const card = (list || []).find(o => o.actor_id === actorId) || {};
        const fields = (card.fields || []).map(f => `· ${f.name}（${f.owner_id}，${f.node_count} 节点）`).join('\n');
        const msg = `确定注销场主 ${actorId}？\n\n将永久删除：\n${fields || '（无场）'}\n\n以及其名下全部场、节点、地宫、用户副本与账号（钥匙同时失效）。\n此操作不可恢复！`;
        if (!confirm(msg)) return;
        if (!confirm(`请再次确认：真的要删除场主 ${actorId} 及其名下全部场吗？`)) return;
        const r = await adminPost('/api/v1/admin/actors/' + encodeURIComponent(actorId) + '/delete', {});
        toast(r.message || (r.status === 'success' ? '已注销' : '注销失败'), r.status === 'success' ? 'success' : 'error');
        refreshAdmin();
        refreshOwners();
    }

    /** 重置钥匙结果弹窗（新钥匙仅显示一次） */
    function showTokenModal(actorId, token, revokedCount) {
        const modal = document.getElementById('token-modal');
        if (!modal) { copyText(token); return; }
        document.getElementById('token-modal-actor').textContent = actorId;
        document.getElementById('token-modal-revoked').textContent = String(revokedCount || 0);
        document.getElementById('token-modal-value').textContent = token;
        modal.classList.add('show');
        const btn = document.getElementById('token-modal-copy');
        if (btn) btn.onclick = () => copyText(token);
        const close = document.getElementById('token-modal-close');
        if (close) close.onclick = () => modal.classList.remove('show');
        modal.onclick = e => { if (e.target === modal) modal.classList.remove('show'); };
    }

    function bindAdmin() {
        const btn = document.getElementById('admin-refresh');
        if (btn) btn.addEventListener('click', refreshAdmin);
        const exit = document.getElementById('act-as-exit');
        if (exit) exit.addEventListener('click', exitActAs);
    }

    async function refreshAll() {
        await Promise.all([refreshOwners(), refreshKeys(), refreshAdmin()]);
        renderActAsBanner();
        updateStatus();
    }

    // ---------- 初始化 ----------
    function init() {
        buildStars();
        bindTabs();
        bindAuth();
        bindOwner();
        bindOwnerSearch();
        bindKeys();
        bindFieldKeyModal();
        bindApiModal();
        bindLogout();
        bindAdmin();
        bindQuickToken();
        updateStatus();
        refreshAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();