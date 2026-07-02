import re

with open('templates/3d_main.html', 'r', encoding='utf-8') as f:
    content = f.read()

old_select = """<select id="search-type" class="search-type-select">
                <option value="keyword">关键字</option>
                <option value="serial">序列ID</option>
            </select>"""

new_select = """<select id="search-type" class="search-type-select">
                <option value="keyword">关键字</option>
                <option value="vector">语义搜索</option>
                <option value="serial">序列ID</option>
            </select>"""

content = content.replace(old_select, new_select)

with open('templates/3d_main.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched templates/3d_main.html")
