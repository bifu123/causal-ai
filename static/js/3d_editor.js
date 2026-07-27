/**
 * 3D界面事件叙述编辑器独立模块
 */
(function() {
    let mdeInstance = null;

    // 配置参数
    const CONFIG = {
        sourceId: 'd-event-tuple',           // 主界面 textarea ID
        editorId: 'modal-event-tuple-editor', // 模态框内 textarea ID
        modalId: 'event-tuple-modal',
        expandBtnId: 'expand-event-tuple-btn',
        closeBtnId: 'close-event-tuple-modal-btn',
        copyBtnId: 'copy-event-tuple-btn',
        shareBtnId: 'share-event-tuple-btn'
    };

    function init() {
        console.log('[3d_editor] 初始化开始');
        const expandBtn = document.getElementById(CONFIG.expandBtnId);
        console.log('[3d_editor] 查找按钮:', CONFIG.expandBtnId, '找到:', expandBtn);
        
        if (!expandBtn) {
            console.error('[3d_editor] 未找到放大按钮:', CONFIG.expandBtnId);
            return;
        }

        // 绑定打开事件，阻止事件冒泡
        expandBtn.addEventListener('click', (e) => {
            e.preventDefault(); // 阻止默认行为
            e.stopPropagation(); // 阻止事件向上冒泡，防止被 3d_main.js 的全局点击拦截
            openEditor();
        });
        console.log('[3d_editor] 按钮点击事件已绑定（带stopPropagation）');

        // 绑定关闭事件
        const closeBtn = document.getElementById(CONFIG.closeBtnId);
        if (closeBtn) {
            closeBtn.addEventListener('click', closeAndSave);
            console.log('[3d_editor] 关闭按钮事件已绑定');
        } else {
            console.error('[3d_editor] 未找到关闭按钮:', CONFIG.closeBtnId);
        }

        // 绑定复制事件
        const copyBtn = document.getElementById(CONFIG.copyBtnId);
        if (copyBtn) {
            copyBtn.addEventListener('click', copyContent);
            console.log('[3d_editor] 复制按钮事件已绑定');
        } else {
            console.error('[3d_editor] 未找到复制按钮:', CONFIG.copyBtnId);
        }

        // 绑定分享事件
        const shareBtn = document.getElementById(CONFIG.shareBtnId);
        if (shareBtn) {
            shareBtn.addEventListener('click', shareNodeLink);
            console.log('[3d_editor] 分享按钮事件已绑定');
        } else {
            console.error('[3d_editor] 未找到分享按钮:', CONFIG.shareBtnId);
        }
        
        console.log('[3d_editor] 初始化完成');
    }

    function openEditor() {
        console.log('[3d_editor] 打开编辑器（编辑模式）');
        isReadOnlyMode = false;       // 编辑模式：可读写
        currentViewingNode = null;    // 清除只读查看节点记录

        const modal = document.getElementById(CONFIG.modalId);
        const sourceArea = document.getElementById(CONFIG.sourceId);
        
        console.log('[3d_editor] 模态框:', modal, '源文本区域:', sourceArea);
        
        if (!modal) {
            console.error('[3d_editor] 未找到模态框:', CONFIG.modalId);
            return;
        }
        
        if (!sourceArea) {
            console.error('[3d_editor] 未找到源文本区域:', CONFIG.sourceId);
            return;
        }
        
        // 1. 先让模态框可见
        modal.classList.remove('hidden');
        // 确保z-index和display
        modal.style.display = 'flex';
        modal.style.zIndex = '9999';
        console.log('[3d_editor] 模态框显示');

        // 2. 初始化或获取实例
        if (!mdeInstance) {
            console.log('[3d_editor] 初始化EasyMDE实例');
            const editorElement = document.getElementById(CONFIG.editorId);
            console.log('[3d_editor] 编辑器元素:', editorElement);
            
            if (!editorElement) {
                console.error('[3d_editor] 未找到编辑器元素:', CONFIG.editorId);
                return;
            }
            
            // 检测是否为移动端
            const isMobile = window.innerWidth < 768;
            console.log('[3d_editor] 移动端检测:', isMobile, '屏幕宽度:', window.innerWidth);
            
            try {
                mdeInstance = new EasyMDE({
                    element: editorElement,
                    spellChecker: false,
                    autoDownloadFontAwesome: true, // 确保图标正常显示
                    status: isMobile ? false : ["lines", "words"], // 手机端隐藏状态栏节省空间
                    renderingConfig: {
                        codeSyntaxHighlighting: true
                    },
                    theme: "sober", // 使用更清晰的主题
                    minHeight: isMobile ? "200px" : "400px", // 移动端减少最小高度
                    placeholder: "在此输入 Markdown 内容...",
                    // 移动端精简工具栏，只保留最核心的职责
                    toolbar: isMobile 
                        ? ["bold", "italic", "heading", "|", "link", "preview", "|", "guide"]
                        : ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "|", "preview", "side-by-side", "fullscreen", "|", "guide"]
                });
                console.log('[3d_editor] EasyMDE实例创建成功，移动端:', isMobile);
            } catch (error) {
                console.error('[3d_editor] EasyMDE初始化失败:', error);
                console.error('[3d_editor] 错误详情:', error.message, error.stack);
            }
        }
        
        // 3. 同步数据
        if (mdeInstance) {
            const sourceValue = sourceArea.value || '';
            console.log('[3d_editor] 同步数据，长度:', sourceValue.length);
            mdeInstance.value(sourceValue);
            
            // 编辑模式：取消只读
            if (mdeInstance.codemirror) {
                mdeInstance.codemirror.setOption("readOnly", false);
            }
            
            // 4. 【关键补丁】延迟刷新渲染
            // 必须等浏览器完成本次DOM渲染（由hidden变为可见）后，CodeMirror才能计算高度
            setTimeout(() => {
                if (mdeInstance && mdeInstance.codemirror) {
                    console.log('[3d_editor] 刷新CodeMirror实例');
                    mdeInstance.codemirror.refresh();
                    // 顺便把焦点聚过去，方便直接输入
                    mdeInstance.codemirror.focus();
                    console.log('[3d_editor] 编辑器刷新完成并聚焦');
                }
            }, 150);
        }
    }

    /**
     * 只读查看模式：供3D视图右键点击节点时调用
     * 复用现有模态框和EasyMDE实例，以只读方式展示节点全文
     * @param {Object} node - 节点对象，需含 event_tuple 和 serial_id 字段
     */
    window.openNodeViewerModal = function(node) {
        console.log('[3d_editor] 打开查看器（只读模式）', node);
        if (!node) {
            console.error('[3d_editor] openNodeViewerModal: 节点对象为空');
            return;
        }

        isReadOnlyMode = true;
        currentViewingNode = node;

        const modal = document.getElementById(CONFIG.modalId);
        if (!modal) {
            console.error('[3d_editor] 未找到模态框:', CONFIG.modalId);
            return;
        }

        // 1. 显示模态框
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        modal.style.zIndex = '9999';

        // 2. 初始化或获取EasyMDE实例
        if (!mdeInstance) {
            console.log('[3d_editor] 初始化EasyMDE实例（只读模式）');
            const editorElement = document.getElementById(CONFIG.editorId);
            if (!editorElement) {
                console.error('[3d_editor] 未找到编辑器元素:', CONFIG.editorId);
                return;
            }
            const isMobile = window.innerWidth < 768;
            try {
                mdeInstance = new EasyMDE({
                    element: editorElement,
                    spellChecker: false,
                    autoDownloadFontAwesome: true,
                    status: isMobile ? false : ["lines", "words"],
                    renderingConfig: { codeSyntaxHighlighting: true },
                    theme: "sober",
                    minHeight: isMobile ? "200px" : "400px",
                    placeholder: "（只读模式）节点事件叙述...",
                    toolbar: isMobile 
                        ? ["preview", "|", "guide"]
                        : ["preview", "side-by-side", "fullscreen", "|", "guide"]
                });
                console.log('[3d_editor] EasyMDE实例创建成功（只读模式）');
            } catch (error) {
                console.error('[3d_editor] EasyMDE初始化失败:', error);
                return;
            }
        }

        // 3. 填充节点全文并设为只读
        if (mdeInstance) {
            const content = node.event_tuple || node.事件二元组描述 || '（该节点无事件叙述）';
            console.log('[3d_editor] 只读模式填充内容，长度:', content.length);
            mdeInstance.value(content);

            // 设置只读
            if (mdeInstance.codemirror) {
                mdeInstance.codemirror.setOption("readOnly", true);
            }

            // 4. 延迟刷新渲染
            setTimeout(() => {
                if (mdeInstance && mdeInstance.codemirror) {
                    mdeInstance.codemirror.refresh();
                    console.log('[3d_editor] 只读查看器刷新完成');
                }
            }, 150);
        }
    };

    function closeAndSave() {
        console.log('[3d_editor] 关闭并保存');
        const modal = document.getElementById(CONFIG.modalId);
        const sourceArea = document.getElementById(CONFIG.sourceId);

        // 只读模式：不回写数据，避免污染抽屉编辑区
        if (!isReadOnlyMode && mdeInstance && sourceArea) {
            const editorValue = mdeInstance.value() || '';
            console.log('[3d_editor] 回写数据，长度:', editorValue.length);
            sourceArea.value = editorValue;
            // 手动触发 input 事件，确保 3d_main.js 中可能存在的监听器（如自动保存逻辑）能感应到
            sourceArea.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            console.log('[3d_editor] 只读模式，跳过数据回写');
        }

        // 重置只读状态
        isReadOnlyMode = false;
        currentViewingNode = null;

        if (modal) {
            modal.classList.add('hidden');
            console.log('[3d_editor] 模态框隐藏');
        }
    }

    /**
     * 分享节点链接：拼接URL并复制到剪贴板
     * 只读模式使用 currentViewingNode，编辑模式使用 window.selectedNodeObj
     */
    async function shareNodeLink() {
        console.log('[3d_editor] 分享节点链接');
        const btn = document.getElementById(CONFIG.shareBtnId);
        if (!btn) return;

        // 优先使用只读模式记录的节点，其次使用全局选中节点
        const node = currentViewingNode || (window.selectedNodeObj || null);
        if (!node) {
            console.error('[3d_editor] 分享失败：未找到节点对象');
            const oldInner = btn.innerHTML;
            btn.innerHTML = '❌';
            setTimeout(() => btn.innerHTML = oldInner, 2000);
            return;
        }

        const serialId = node.serial_id || node.本事件ID;
        if (!serialId) {
            console.error('[3d_editor] 分享失败：节点缺少 serial_id');
            const oldInner = btn.innerHTML;
            btn.innerHTML = '❌';
            setTimeout(() => btn.innerHTML = oldInner, 2000);
            return;
        }

        // 拼接完整URL
        const baseUrl = window.location.origin + window.location.pathname;
        const params = new URLSearchParams();
        params.append('serial_id', serialId);
        if (window.currentOwnerId && window.currentOwnerId !== 'default') {
            params.append('owner_id', window.currentOwnerId);
        }
        if (window.currentActorId) {
            params.append('actor_id', window.currentActorId);
        }
        // 附加 max_eyes（从滑块或URL获取）
        const slider = document.getElementById('telescope-slider');
        if (slider && slider.value) {
            params.append('max_eyes', slider.value);
        }
        const shareUrl = `${baseUrl}?${params.toString()}`;
        console.log('[3d_editor] 分享链接:', shareUrl);

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(shareUrl);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = shareUrl;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (!successful) {
                    throw new Error('复制失败：浏览器不支持复制功能');
                }
            }
            const oldInner = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => btn.innerHTML = oldInner, 2000);
        } catch (err) {
            console.error('[3d_editor] 分享链接复制失败', err);
            const oldInner = btn.innerHTML;
            btn.innerHTML = '❌';
            setTimeout(() => btn.innerHTML = oldInner, 2000);
        }
    }

    async function copyContent() {
        console.log('[3d_editor] 复制内容');
        if (!mdeInstance) return;
        const btn = document.getElementById(CONFIG.copyBtnId);
        
        try {
            const text = mdeInstance.value() || '';
            console.log('[3d_editor] 复制文本，长度:', text.length);
            
            // 检查clipboard API是否可用
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                // 回退方案：使用document.execCommand
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (!successful) {
                    throw new Error('复制失败：浏览器不支持复制功能');
                }
            }
            
            const oldInner = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => btn.innerHTML = oldInner, 2000);
        } catch (err) {
            console.error('[3d_editor] 复制失败', err);
            // 显示错误提示
            const oldInner = btn.innerHTML;
            btn.innerHTML = '❌';
            setTimeout(() => btn.innerHTML = oldInner, 2000);
        }
    }

    // 确保在页面加载后执行
    console.log('[3d_editor] 脚本加载，document.readyState:', document.readyState);
    if (document.readyState === 'loading') {
        console.log('[3d_editor] 等待DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', init);
    } else {
        console.log('[3d_editor] 立即执行初始化');
        init();
    }
})();
