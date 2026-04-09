# 测试新的get_non_startup_nodes方法
import sys
sys.path.append('.')
from core.database import db

print('=== 测试get_non_startup_nodes方法 ===')

# 1. 获取所有节点
all_nodes = db.get_all_active()
print(f'所有节点数量: {len(all_nodes)}')

# 2. 获取非初创节点
non_startup_nodes = db.get_non_startup_nodes()
print(f'非初创节点数量: {len(non_startup_nodes)}')

# 3. 分析节点连接状态
print('\n节点连接状态分析:')
for node in all_nodes[:10]:  # 只显示前10个节点
    node_id = node['node_id']
    parent_id = node.get('parent_id')
    has_parent = parent_id is not None and parent_id != ''
    
    # 检查是否有子节点
    has_children = False
    import psycopg2
    from psycopg2.extras import RealDictCursor
    with db.conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT 1 FROM ains_active_nodes WHERE parent_id LIKE %s LIMIT 1', (f'%{node_id}%',))
        has_children = cur.fetchone() is not None
    
    is_startup = not has_parent and not has_children
    status = '初创节点' if is_startup else '非初创节点'
    
    print(f'  节点 {node_id}: parent_id={parent_id}, 有父节点={has_parent}, 有子节点={has_children}, 状态={status}')

# 4. 验证逻辑
print('\n验证逻辑:')
print(f'  所有节点 = 非初创节点 + 初创节点')
print(f'  {len(all_nodes)} = {len(non_startup_nodes)} + {len(all_nodes) - len(non_startup_nodes)}')

# 5. 检查初创节点是否符合定义
startup_count = 0
for node in all_nodes:
    node_id = node['node_id']
    parent_id = node.get('parent_id')
    has_parent = parent_id is not None and parent_id != ''
    
    # 检查是否有子节点
    has_children = False
    with db.conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute('SELECT 1 FROM ains_active_nodes WHERE parent_id LIKE %s LIMIT 1', (f'%{node_id}%',))
        has_children = cur.fetchone() is not None
    
    if not has_parent and not has_children:
        startup_count += 1
        print(f'  发现初创节点: {node_id} (parent_id={parent_id}, 有子节点={has_children})')

print(f'\n总计初创节点数量: {startup_count}')
print(f'总计非初创节点数量: {len(all_nodes) - startup_count}')
print(f'get_non_startup_nodes返回数量: {len(non_startup_nodes)}')

# 验证一致性
if len(non_startup_nodes) == len(all_nodes) - startup_count:
    print('\n✅ 验证通过: get_non_startup_nodes方法正确排除了初创节点')
else:
    print('\n❌ 验证失败: get_non_startup_nodes方法可能有问题')

# 6. 测试owner_id过滤
print('\n=== 测试owner_id过滤 ===')
owner_id = 'worker'
owner_nodes = db.get_all_active(owner_id=owner_id)
print(f'owner_id={owner_id}的节点数量: {len(owner_nodes)}')

owner_non_startup_nodes = db.get_non_startup_nodes(owner_id=owner_id)
print(f'owner_id={owner_id}的非初创节点数量: {len(owner_non_startup_nodes)}')

# 7. 测试代谢引擎是否使用新方法
print('\n=== 测试代谢引擎兼容性 ===')
print('代谢引擎现在使用 db.get_non_startup_nodes() 替代 db.get_all_active(exclude_weight_one=True)')
print('这确保了代谢引擎只处理有连接关系的节点，排除初创节点')

print('\n=== 测试完成 ===')
