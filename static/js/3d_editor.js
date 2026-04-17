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
        copyBtnId: 'copy-event-tuple-btn'
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
        
        console.log('[3d_editor] 初始化完成');
    }

    function openEditor() {
        console.log('[3d_editor] 打开编辑器');
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

    function closeAndSave() {
        console.log('[3d_editor] 关闭并保存');
        const modal = document.getElementById(CONFIG.modalId);
        const sourceArea = document.getElementById(CONFIG.sourceId);

        if (mdeInstance && sourceArea) {
            // 回写数据
            const editorValue = mdeInstance.value() || '';
            console.log('[3d_editor] 回写数据，长度:', editorValue.length);
            sourceArea.value = editorValue;
            // 手动触发 input 事件，确保 3d_main.js 中可能存在的监听器（如自动保存逻辑）能感应到
            sourceArea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (modal) {
            modal.classList.add('hidden');
            console.log('[3d_editor] 模态框隐藏');
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
