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
        set token(v) { v ? localStorage.setItem('causal_token', v) : localStorage.removeItem('causal_token'); }
    };

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
            const res = await fetch(url, options);
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

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ---------- 兼容性复制函数 ----------
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                toast('已复制', 'success');
            }).catch(() => {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
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
        if (LS.actor) {
            bar.classList.add('online');
            text.textContent = '已登录: ' + LS.actor;
        } else {
            bar.classList.remove('online');
            text.textContent = '未登录';
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
            if (!LS.actor) { toast('请先登录', 'error'); return; }
            const owner_id = document.getElementById('owner-id').value.trim();
            const name = document.getElementById('owner-name').value.trim();
            const r = await post('/api/v1/owner/create', { owner_id, name, actor_id: LS.actor });
            if (r.status === 'success') {
                document.getElementById('owner-form').reset();
                toast('场已创建', 'success');
                refreshOwners();
            } else {
                toast(r.message || '创建失败', 'error');
            }
        });
    }

    function enter(ownerId, isEdit = false) {
        const token = LS.token || '';
        const url = '/3d?owner_id=' + encodeURIComponent(ownerId)
            + '&actor_id=' + encodeURIComponent(LS.actor)
            + (token ? '&token=' + encodeURIComponent(token) : '')
            + (isEdit ? '&edit=true' : '');
        window.open(url, '_blank');
    }

    async function refreshOwners() {
        const box = document.getElementById('owner-list');
        if (!LS.actor) { box.innerHTML = '<p class="empty">请先登录后查看名下场</p>'; return; }
        const r = await get('/api/v1/owner/list?actor_id=' + encodeURIComponent(LS.actor));
        const owners = (r.status === 'success' && r.data) ? r.data : [];
        if (!owners.length) {
            box.innerHTML = '<p class="empty">暂无场，先在上方创建一座</p>';
            return;
        }
        box.innerHTML = owners.map(o => `
            <div class="item">
                <div class="meta">
                    <div class="name">${escapeHtml(o.name)}</div>
                    <div class="id">${escapeHtml(o.owner_id)}</div>
                </div>
                <div class="actions">
                    <button class="btn small ghost" data-enter="${escapeHtml(o.owner_id)}">进入星空(只读)</button>
                    <button class="btn small primary" data-enter="${escapeHtml(o.owner_id)}" data-edit="true">进入星空(可写)</button>
                    <button class="btn small ghost" data-rename="${escapeHtml(o.owner_id)}">改名</button>
                    <button class="btn small danger" data-del="${escapeHtml(o.owner_id)}">删除</button>
                </div>
            </div>`).join('');

        box.querySelectorAll('[data-enter]').forEach(b => b.addEventListener('click', () => enter(b.dataset.enter, b.dataset.edit === 'true')));
        box.querySelectorAll('[data-rename]').forEach(b => b.addEventListener('click', async () => {
            const name = prompt('新场名称：');
            if (!name) return;
            const r = await post('/api/v1/owner/update', { owner_id: b.dataset.rename, name, actor_id: LS.actor });
            toast(r.message || (r.status === 'success' ? '已改名' : '改名失败'), r.status === 'success' ? 'success' : 'error');
            refreshOwners();
        }));
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('确定删除该场？(不删除节点数据)')) return;
            const r = await post('/api/v1/owner/delete', { owner_id: b.dataset.del, actor_id: LS.actor });
            toast(r.message || (r.status === 'success' ? '已删除' : '删除失败'), r.status === 'success' ? 'success' : 'error');
            refreshOwners();
        }));
    }


    // ---------- 钥匙管理 ----------
    function bindKeys() {
        document.getElementById('key-generate').addEventListener('click', async () => {
            if (!LS.actor) { toast('请先登录', 'error'); return; }
            const r = await post('/api/v1/key/generate', { actor_id: LS.actor });
            if (r.status === 'success') {
                LS.token = r.data.token;
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
        if (!LS.actor) { box.innerHTML = '<p class="empty">请先登录后查看钥匙</p>'; return; }
        const r = await get('/api/v1/key/list?actor_id=' + encodeURIComponent(LS.actor));
        const tokens = (r.status === 'success' && r.data) ? r.data : [];
        if (!tokens.length) {
            box.innerHTML = '<p class="empty">暂无钥匙</p>';
            return;
        }
        box.innerHTML = tokens.map(t => {
            const mask = t.slice(0, 6) + '••••' + t.slice(-4);
            const active = t === LS.token;
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
            LS.token = b.dataset.use;
            toast('已设为主钥匙', 'success');
            refreshKeys();
        }));
        box.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
            copyText(b.dataset.copy);
        }));
        box.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('确定吊销该钥匙？')) return;
            const r = await post('/api/v1/key/revoke', { actor_id: LS.actor, token: b.dataset.revoke });
            toast(r.message || (r.status === 'success' ? '已吊销' : '吊销失败'), r.status === 'success' ? 'success' : 'error');
            refreshKeys();
        }));
    }

    function refreshAll() {
        refreshOwners();
        refreshKeys();
    }

    // ---------- 初始化 ----------
    function init() {
        buildStars();
        bindTabs();
        bindAuth();
        bindOwner();
        bindKeys();
        updateStatus();
        refreshAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();