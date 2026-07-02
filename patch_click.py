import re

with open('static/js/3d_main.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_code = """            if (!is_edit_mode) {
                // 降下一束神圣探照光柱
                showDivineBeam(node);
                
                // 使用精确坐标偏移计算
                const { camPos, lookAt } = calculateOffsetView(node, 350);
                
                // 记录动画开始时间
                lastAnimationStartTime = Date.now();
                
                Graph.cameraPosition(camPos, lookAt, 1500);
                
                // 触发点击事件，后端会计算并返回视界内的节点
                const requestData = { 
                    serial_id: node.serial_id || node.本事件ID
                };
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

            openDrawer(node.id); // 唤起右侧抽屉"""

new_code = """            // 检查URL参数中是否有edit=true
            const urlParams = new URLSearchParams(window.location.search);
            const isEditUrl = urlParams.get('edit') === 'true';

            if (!is_edit_mode && !isEditUrl) {
                // 降下一束神圣探照光柱
                showDivineBeam(node);
                
                // 使用精确坐标偏移计算
                const { camPos, lookAt } = calculateOffsetView(node, 350);
                
                // 记录动画开始时间
                lastAnimationStartTime = Date.now();
                
                Graph.cameraPosition(camPos, lookAt, 1500);
                
                // 触发点击事件，后端会计算并返回视界内的节点
                const requestData = { 
                    serial_id: node.serial_id || node.本事件ID
                };
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

            openDrawer(node.id); // 唤起右侧抽屉"""

content = content.replace(old_code, new_code)

with open('static/js/3d_main.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched static/js/3d_main.js for click handler")
