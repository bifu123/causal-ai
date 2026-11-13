import sys

p = '/home/test/causal_ai/static/js/3d_main.js'
with open(p, 'r', encoding='utf-8') as f:
    s = f.read()

# 1) 在 loadInitialData 中，定位唯一的 "// 构建查询参数" 注释，向前找到 ownerId 行并在其后插入 botId
pos = s.index('// 构建查询参数')
owner_line = "        const ownerId = window.currentOwnerId || 'default';\n"
idx = s.rfind(owner_line, 0, pos)
assert idx != -1, 'ownerId line not found before 构建查询参数'
insert_at = idx + len(owner_line)
bot_line = "        const botId = window.currentBotId || null;\n"
s = s[:insert_at] + bot_line + s[insert_at:]

# 2) 在 owner_id append 之后追加 bot_id append
old_b = "        if (ownerId && ownerId !== 'default') {\n            params.append('owner_id', ownerId);\n        }\n"
new_b = "        if (ownerId && ownerId !== 'default') {\n            params.append('owner_id', ownerId);\n        }\n        if (botId) {\n            params.append('bot_id', botId);\n        }\n"
assert s.count(old_b) == 1, 'old_b count = %d' % s.count(old_b)
s = s.replace(old_b, new_b, 1)

with open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('patched ok')
