import re

with open('static/js/3d_main.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_code = """            // 聚焦到该节点（但不打开抽屉）
            const { camPos, lookAt } = calculateOffsetView(targetNode, 350);
            
            // 降下一束神圣光柱
            showDivineBeam(targetNode);

            Graph.cameraPosition(camPos, lookAt, 1200);"""

new_code = """            // 聚焦到该节点
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
            }"""

content = content.replace(old_code, new_code)

with open('static/js/3d_main.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched static/js/3d_main.js for search result click handler")
