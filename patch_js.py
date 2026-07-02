import re

with open('static/js/3d_main.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_js = """            if (searchType === 'serial') {
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
            }"""

new_js = """            if (searchType === 'serial') {
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
            }"""

content = content.replace(old_js, new_js)

with open('static/js/3d_main.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched static/js/3d_main.js")
