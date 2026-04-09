import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 数据库配置
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "database": os.getenv("DB_DATABASE", "causal_ai_db"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "Shift962512"),
    "port": os.getenv("DB_PORT", 5432)
}

class CausalDatabase:
    def __init__(self):
        """
        职责：初始化物理连接，构建 AINS 存储结构
        """
        try:
            self.conn = psycopg2.connect(**DB_CONFIG)
            self.conn.set_client_encoding('UTF8')
            self.conn.autocommit = True
            self._init_db()
            print(f"[数据库] 成功连接至 {DB_CONFIG['database']}")
        except Exception as e:
            print(f"[数据库错误] {e}")
            raise e
    
    @staticmethod
    def _parents_to_string(parent_ids):
        """
        职责：将父节点ID列表转换为|分隔的字符串
        """
        if not parent_ids:
            return None
        if isinstance(parent_ids, list):
            # 过滤空值并去重
            filtered_ids = [str(pid).strip() for pid in parent_ids if pid and str(pid).strip()]
            if not filtered_ids:
                return None
            return '|'.join(filtered_ids)
        return str(parent_ids).strip() if str(parent_ids).strip() else None
    
    @staticmethod
    def _string_to_parents(parent_str):
        """
        职责：将|分隔的字符串解析为父节点ID列表
        """
        if not parent_str:
            return []
        # 分割字符串，过滤空值并去重
        parents = [pid.strip() for pid in str(parent_str).split('|') if pid.strip()]
        return list(dict.fromkeys(parents))  # 保持顺序并去重

    def _init_db(self):
        """
        职责：初始化活跃事件表、地宫归档表和用户权重表
        """
        with self.conn.cursor() as cur:
            # 创建活跃事件表
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ains_active_nodes (
                    node_id VARCHAR(255) PRIMARY KEY,
                    parent_id VARCHAR(255),
                    block_tag VARCHAR(50),
                    action_tag VARCHAR(50),
                    event_tuple TEXT,
                    survival_weight NUMERIC DEFAULT 1.0,
                    vision_level INTEGER DEFAULT 0,
                    full_image_url TEXT,
                    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    owner_id VARCHAR(255) DEFAULT 'default'
                );
            """)
            
            # 创建地宫归档表
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ains_archive_necropolis (
                    necropolis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    node_id VARCHAR(255) NOT NULL,
                    raw_content TEXT NOT NULL,
                    raw_full_image_url TEXT,
                    holographic_bundle JSONB,
                    sealed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            
            # 创建用户权重表 (actor_id, serial_id 为联合主键)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ains_user_weights (
                    actor_id VARCHAR(255) NOT NULL,
                    serial_id INTEGER NOT NULL,
                    survival_weight NUMERIC DEFAULT 1.0,
                    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (actor_id, serial_id)
                );
            """)
            
            # 确保所有列都存在（兼容旧版本）
            try:
                cur.execute("""
                    ALTER TABLE ains_archive_necropolis 
                    ADD COLUMN IF NOT EXISTS raw_full_image_url TEXT;
                """)
                cur.execute("""
                    ALTER TABLE ains_archive_necropolis 
                    ADD COLUMN IF NOT EXISTS holographic_bundle JSONB;
                """)
                # 为地宫表添加serial_id字段（如果需要）
                cur.execute("""
                    ALTER TABLE ains_archive_necropolis 
                    ADD COLUMN IF NOT EXISTS serial_id INTEGER;
                """)
                # 为活跃事件表添加serial_id字段（如果需要）
                cur.execute("""
                    ALTER TABLE ains_active_nodes 
                    ADD COLUMN IF NOT EXISTS serial_id INTEGER;
                """)
            except Exception as e:
                print(f"[数据库警告] 添加表列时出错: {e}")

    def get_node_by_id(self, node_id: str):
        """
        职责：查询事件是否存在
        """
        sql = "SELECT * FROM ains_active_nodes WHERE node_id = %s"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (node_id,))
            node = cur.fetchone()
            if node:
                # 确保serial_id存在（如果表结构已修改）
                if 'serial_id' not in node:
                    # 如果表还没有serial_id字段，设置一个默认值
                    node['serial_id'] = None
                if 'parent_id' in node:
                    # 将|分隔的字符串解析为列表
                    node['parent_ids'] = self._string_to_parents(node.get('parent_id'))
            return node

    def insert_node(self, node_data: dict):
        """
        职责：严格执行 INSERT。如果 node_id 已存在，将触发唯一约束异常，防止覆盖。
        """
        # 处理父节点：将列表转换为|分隔的字符串
        parent_ids = node_data.get('parent_id')
        parent_id_str = self._parents_to_string(parent_ids)
        
        # 获取owner_id，默认为'default'
        owner_id = node_data.get('owner_id', 'default')
        
        sql = """
            INSERT INTO ains_active_nodes 
            (node_id, parent_id, block_tag, action_tag, event_tuple, survival_weight, full_image_url, owner_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
        """
        with self.conn.cursor() as cur:
            cur.execute(sql, (
                node_data['node_id'],
                parent_id_str,
                node_data.get('block_tag'),
                node_data.get('action_tag'),
                node_data.get('event_tuple'),
                node_data.get('survival_weight', 1.0),
                node_data.get('full_image_url'),
                owner_id
            ))

    def update_node_weight(self, node_id: str, new_weight: float):
        """
        职责：代谢专用。仅更新权重。
        """
        sql = "UPDATE ains_active_nodes SET survival_weight = %s WHERE node_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (new_weight, node_id))

    def get_all_active(self, owner_id=None, exclude_weight_one=False):
        """
        职责：获取所有活跃事件
        参数：
            owner_id: 事件拥有者ID，如果为None则返回所有事件
            exclude_weight_one: 是否排除survival_weight=1.0的初创节点
        """
        # 构建WHERE子句
        where_clauses = []
        params = []
        
        if owner_id:
            where_clauses.append("owner_id = %s")
            params.append(owner_id)
        
        if exclude_weight_one:
            where_clauses.append("survival_weight != 1.0")
        
        # 构建SQL语句
        if where_clauses:
            sql = f"SELECT * FROM ains_active_nodes WHERE {' AND '.join(where_clauses)} ORDER BY created_at ASC"
        else:
            sql = "SELECT * FROM ains_active_nodes ORDER BY created_at ASC"
        
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, tuple(params))
            nodes = cur.fetchall()
            # 为每个节点解析父节点列表
            for node in nodes:
                if 'parent_id' in node:
                    node['parent_ids'] = self._string_to_parents(node.get('parent_id'))
            return nodes

    def delete_node(self, node_id: str):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM ains_active_nodes WHERE node_id = %s", (node_id,))

    def upsert_node(self, node_data: dict):
        """
        职责：更新事件的多个字段，用于代谢引擎。
        注意：这里使用 UPDATE 而不是 INSERT，因为事件应该已经存在。
        """
        # 检查是否需要更新 event_tuple
        if 'event_tuple' in node_data:
            sql = """
                UPDATE ains_active_nodes 
                SET survival_weight = %s,
                    vision_level = %s,
                    event_tuple = %s,
                    last_accessed = CURRENT_TIMESTAMP
                WHERE node_id = %s
            """
            with self.conn.cursor() as cur:
                cur.execute(sql, (
                    node_data.get('survival_weight', 1.0),
                    node_data.get('vision_level', 0),
                    node_data.get('event_tuple'),
                    node_data['node_id']
                ))
        else:
            sql = """
                UPDATE ains_active_nodes 
                SET survival_weight = %s,
                    vision_level = %s,
                    last_accessed = CURRENT_TIMESTAMP
                WHERE node_id = %s
            """
            with self.conn.cursor() as cur:
                cur.execute(sql, (
                    node_data.get('survival_weight', 1.0),
                    node_data.get('vision_level', 0),
                    node_data['node_id']
                ))

    def update_node(self, old_node_id: str, node_data: dict):
        """
        职责：更新事件信息，包括修改node_id
        """
        print(f"[数据库更新] 开始更新节点: old_node_id={old_node_id}, node_data={node_data}")
        
        # 构建更新字段
        update_fields = []
        update_values = []
        
        if 'node_id' in node_data and node_data['node_id'] != old_node_id:
            update_fields.append("node_id = %s")
            update_values.append(node_data['node_id'])
            print(f"[数据库更新] 更新node_id: {node_data['node_id']}")
        
        if 'event_tuple' in node_data:
            update_fields.append("event_tuple = %s")
            update_values.append(node_data['event_tuple'])
            print(f"[数据库更新] 更新event_tuple: 长度={len(node_data['event_tuple'])}")
        
        if 'full_image_url' in node_data:
            update_fields.append("full_image_url = %s")
            update_values.append(node_data['full_image_url'])
            print(f"[数据库更新] 更新full_image_url: {node_data['full_image_url']}")
        
        # 处理动作标签
        if 'action_tag' in node_data:
            update_fields.append("action_tag = %s")
            update_values.append(node_data['action_tag'])
            print(f"[数据库更新] 更新action_tag: {node_data['action_tag']}")
        
        # 处理因缘标签
        if 'block_tag' in node_data:
            update_fields.append("block_tag = %s")
            update_values.append(node_data['block_tag'])
            print(f"[数据库更新] 更新block_tag: {node_data['block_tag']}")
        
        # 处理父节点ID
        if 'parent_ids' in node_data:
            # 将父节点ID列表转换为|分隔的字符串
            parent_id_str = self._parents_to_string(node_data['parent_ids'])
            update_fields.append("parent_id = %s")
            update_values.append(parent_id_str)
            print(f"[数据库更新] 更新parent_id: {parent_id_str} (原始列表: {node_data['parent_ids']})")
        
        # 总是更新 last_accessed
        update_fields.append("last_accessed = CURRENT_TIMESTAMP")
        
        if not update_fields:
            print(f"[数据库更新] 没有需要更新的字段")
            return  # 没有需要更新的字段
        
        # 构建SQL语句
        update_values.append(old_node_id)
        sql = f"""
            UPDATE ains_active_nodes 
            SET {', '.join(update_fields)}
            WHERE node_id = %s
        """
        
        print(f"[数据库更新] SQL语句: {sql}")
        print(f"[数据库更新] 参数值: {update_values}")
        
        with self.conn.cursor() as cur:
            cur.execute(sql, tuple(update_values))
            print(f"[数据库更新] SQL执行成功，影响行数: {cur.rowcount}")

    def update_children_parent_id(self, old_parent_id: str, new_parent_id: str):
        """
        职责：更新所有子事件的parent_id
        """
        sql = """
            UPDATE ains_active_nodes 
            SET parent_id = %s
            WHERE parent_id = %s
        """
        with self.conn.cursor() as cur:
            cur.execute(sql, (new_parent_id, old_parent_id))

    def delete_node_with_necropolis(self, node_id: str):
        """
        职责：删除事件和地宫表记录，同时删除对应的图片文件
        根据新的设计，使用serial_id来删除地宫记录
        """
        # 首先获取节点信息
        node = self.get_node_by_id(node_id)
        if not node:
            print(f"[删除] 节点 {node_id} 不存在")
            return
        
        # 获取serial_id
        serial_id = node.get('serial_id')
        image_url = node.get('full_image_url')
        
        # 先删除地宫表记录（使用serial_id）
        if serial_id:
            with self.conn.cursor() as cur:
                cur.execute("DELETE FROM ains_archive_necropolis WHERE serial_id = %s", (serial_id,))
                print(f"[删除] 已删除节点 {node_id} (serial_id: {serial_id}) 的地宫记录")
        else:
            # 如果没有serial_id，使用node_id作为后备
            with self.conn.cursor() as cur:
                cur.execute("DELETE FROM ains_archive_necropolis WHERE node_id = %s", (node_id,))
                print(f"[删除] 已删除节点 {node_id} 的地宫记录（使用node_id）")
        
        # 再删除活跃事件表记录
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM ains_active_nodes WHERE node_id = %s", (node_id,))
            print(f"[删除] 已删除节点 {node_id} 的活跃记录")
        
        # 删除对应的图片文件
        if image_url:
            try:
                # 从URL中提取文件名
                # URL格式: /uploads/raw/filename.ext
                import os
                if image_url.startswith('/uploads/raw/'):
                    filename = image_url.split('/')[-1]
                    filepath = os.path.join('uploads', 'raw', filename)
                    if os.path.exists(filepath):
                        os.remove(filepath)
                        print(f"[文件系统] 已删除图片文件: {filepath}")
            except Exception as e:
                print(f"[文件系统警告] 删除图片文件失败: {e}")

    def update_children_to_new_parent(self, old_parent_id: str, new_parent_ids):
        """
        职责：将子事件的父ID更新为新的父ID（支持多父节点）
        """
        # 获取所有以old_parent_id为父节点的子节点
        sql = "SELECT node_id, parent_id FROM ains_active_nodes WHERE parent_id LIKE %s"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (f'%{old_parent_id}%',))
            children = cur.fetchall()
            
            for child in children:
                # 解析子节点的当前父节点列表
                current_parents = self._string_to_parents(child['parent_id'])
                
                # 替换old_parent_id为new_parent_ids
                new_parents = []
                for parent in current_parents:
                    if parent == old_parent_id:
                        # 如果是被删除的父节点，替换为新的父节点列表
                        if isinstance(new_parent_ids, list):
                            new_parents.extend(new_parent_ids)
                        else:
                            new_parents.append(new_parent_ids)
                    else:
                        # 保留其他父节点
                        new_parents.append(parent)
                
                # 去重
                new_parents = list(dict.fromkeys(new_parents))
                
                # 更新子节点的父节点
                new_parent_str = self._parents_to_string(new_parents)
                update_sql = "UPDATE ains_active_nodes SET parent_id = %s WHERE node_id = %s"
                cur.execute(update_sql, (new_parent_str, child['node_id']))

    def update_children_to_null_parent(self, parent_id: str):
        """
        职责：将子事件的父ID更新为NULL（支持多父节点）
        """
        # 获取所有以parent_id为父节点的子节点
        sql = "SELECT node_id, parent_id FROM ains_active_nodes WHERE parent_id LIKE %s"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (f'%{parent_id}%',))
            children = cur.fetchall()
            
            for child in children:
                # 解析子节点的当前父节点列表
                current_parents = self._string_to_parents(child['parent_id'])
                
                # 移除被删除的父节点
                new_parents = [p for p in current_parents if p != parent_id]
                
                # 如果移除后没有父节点，设置为NULL，否则转换为字符串
                if not new_parents:
                    new_parent_str = None
                else:
                    new_parent_str = self._parents_to_string(new_parents)
                
                # 更新子节点的父节点
                update_sql = "UPDATE ains_active_nodes SET parent_id = %s WHERE node_id = %s"
                cur.execute(update_sql, (new_parent_str, child['node_id']))

    def seal_to_necropolis(self, node_id: str):
        """
        职责：将事件封存到地宫归档表。
        根据数据建模文档，地宫表应包含：
        - necropolis_id (UUID)
        - serial_id (从活跃节点复制)
        - node_id
        - raw_content (全量原始记录)
        - raw_full_image_url (原始高清外显子路径)
        - holographic_bundle (全息关联数据包)
        - sealed_at
        
        逻辑：
        1. 获取活跃节点的serial_id
        2. 检查地宫表中是否有相同serial_id的记录
        3. 如果没有，插入新记录
        4. 如果有，比较内容；如果不同，更新内容
        """
        try:
            # 首先获取事件信息
            node = self.get_node_by_id(node_id)
            if not node:
                print(f"[警告] 尝试封存不存在的事件: {node_id}")
                return
            
            # 获取serial_id
            serial_id = node.get('serial_id')
            if not serial_id:
                print(f"[地宫封存] 错误：节点 {node_id} 没有serial_id")
                return
            
            print(f"[地宫封存] 开始封存节点 {node_id} (serial_id: {serial_id})")
            
            import uuid
            from datetime import datetime
            
            # 获取原始内容
            raw_content_text = node.get('event_tuple', '')
            raw_full_image_url = node.get('full_image_url', '')
            
            # 构建 holographic_bundle
            import json
            holographic_bundle = {
                "node_id": node['node_id'],
                "parent_id": node.get('parent_id'),
                "block_tag": node.get('block_tag'),
                "action_tag": node.get('action_tag'),
                "survival_weight": float(node['survival_weight']) if node.get('survival_weight') else 1.0,
                "vision_level": node.get('vision_level', 0),
                "last_accessed": str(node.get('last_accessed')) if node.get('last_accessed') else None,
                "created_at": str(node.get('created_at')) if node.get('created_at') else None
            }
            
            # 首先检查地宫表中是否有相同serial_id的记录
            check_sql = """
                SELECT raw_content, raw_full_image_url 
                FROM ains_archive_necropolis 
                WHERE serial_id = %s
                LIMIT 1
            """
            
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(check_sql, (serial_id,))
                existing_record = cur.fetchone()
                
                if existing_record:
                    # 检查内容是否相同
                    content_same = existing_record['raw_content'] == raw_content_text
                    image_same = existing_record['raw_full_image_url'] == raw_full_image_url
                    
                    if content_same and image_same:
                        print(f"[地宫封存] 节点 {node_id} (serial_id: {serial_id}) 内容相同，无需更新")
                        return
                    
                    # 内容不同，更新现有记录
                    print(f"[地宫封存] 节点 {node_id} (serial_id: {serial_id}) 内容不同，更新地宫记录")
                    print(f"[地宫封存] 内容变化: event_tuple={not content_same}, full_image_url={not image_same}")
                    
                    update_sql = """
                        UPDATE ains_archive_necropolis 
                        SET raw_content = %s,
                            raw_full_image_url = %s,
                            holographic_bundle = %s,
                            sealed_at = %s
                        WHERE serial_id = %s
                    """
                    cur.execute(update_sql, (
                        raw_content_text,
                        raw_full_image_url,
                        json.dumps(holographic_bundle, ensure_ascii=False),
                        datetime.now(),
                        serial_id
                    ))
                    print(f"[地宫封存] 节点 {node_id} 的地宫记录已更新")
                else:
                    # 没有现有记录，插入新记录
                    necropolis_id = str(uuid.uuid4())
                    insert_sql = """
                        INSERT INTO ains_archive_necropolis 
                        (necropolis_id, serial_id, node_id, raw_content, raw_full_image_url, holographic_bundle, sealed_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """
                    cur.execute(insert_sql, (
                        necropolis_id,
                        serial_id,
                        node_id,
                        raw_content_text,
                        raw_full_image_url,
                        json.dumps(holographic_bundle, ensure_ascii=False),
                        datetime.now()
                    ))
                    print(f"[地宫封存] 节点 {node_id} 已封存到地宫 (serial_id: {serial_id}, necropolis_id: {necropolis_id})")
                    
        except psycopg2.Error as e:
            error_msg = str(e)
            if "column \"serial_id\" does not exist" in error_msg:
                print(f"[地宫封存] 错误：地宫表缺少serial_id字段，请先修改表结构")
                print(f"[地宫封存] 需要执行: ALTER TABLE ains_archive_necropolis ADD COLUMN serial_id INTEGER;")
            else:
                print(f"[地宫封存] 数据库错误: {error_msg}")
        except Exception as e:
            print(f"[地宫封存] 未知错误: {e}")
    
    def restore_from_necropolis(self, node_id: str):
        """
        职责：从地宫表恢复内容到活跃事件表。
        根据新的设计，使用serial_id而不是node_id来查询地宫记录。
        逻辑：
        1. 获取活跃节点的serial_id
        2. 查询地宫表中相同serial_id的记录
        3. 恢复匹配的记录到活跃节点表
        """
        print(f"[地宫恢复] 开始恢复节点 {node_id} 的地宫档案")
        
        try:
            # 首先检查节点是否存在
            node = self.get_node_by_id(node_id)
            if not node:
                print(f"[地宫恢复] 错误：节点 {node_id} 不存在于活跃事件表中")
                return None
            
            # 获取serial_id
            serial_id = node.get('serial_id')
            if not serial_id:
                print(f"[地宫恢复] 错误：节点 {node_id} 没有serial_id")
                return None
            
            print(f"[地宫恢复] 节点 {node_id} (serial_id: {serial_id}) 当前活跃数据:")
            print(f"[地宫恢复]   - event_tuple 长度: {len(node.get('event_tuple', ''))}")
            print(f"[地宫恢复]   - full_image_url: {node.get('full_image_url', '无')}")
            
            # 查询地宫表中相同serial_id的记录
            sql = """
                SELECT raw_content, raw_full_image_url, sealed_at
                FROM ains_archive_necropolis 
                WHERE serial_id = %s 
                LIMIT 1
            """
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, (serial_id,))
                record = cur.fetchone()
                
                if not record:
                    print(f"[地宫恢复] 警告：节点 {node_id} (serial_id: {serial_id}) 没有地宫记录")
                    return None  # 没有找到地宫记录
                
                print(f"[地宫恢复] 找到地宫记录:")
                print(f"[地宫恢复]   - raw_content 长度: {len(record['raw_content']) if record['raw_content'] else 0}")
                print(f"[地宫恢复]   - raw_full_image_url: {record['raw_full_image_url']}")
                print(f"[地宫恢复]   - sealed_at: {record['sealed_at']}")
                
                # 检查地宫内容是否与当前内容不同
                current_event_tuple = node.get('event_tuple', '')
                current_full_image_url = node.get('full_image_url', '')
                
                content_changed = current_event_tuple != record['raw_content']
                image_changed = current_full_image_url != record['raw_full_image_url']
                
                if not content_changed and not image_changed:
                    print(f"[地宫恢复] 信息：地宫内容与当前内容相同，无需恢复")
                    return node
                
                print(f"[地宫恢复] 内容变化: event_tuple={content_changed}, full_image_url={image_changed}")
                
                # 更新活跃事件表
                update_sql = """
                    UPDATE ains_active_nodes 
                    SET event_tuple = %s, 
                        full_image_url = %s,
                        last_accessed = CURRENT_TIMESTAMP
                    WHERE node_id = %s
                    RETURNING *
                """
                cur.execute(update_sql, (
                    record['raw_content'],
                    record['raw_full_image_url'],
                    node_id
                ))
                
                updated_node = cur.fetchone()
                
                # 获取更新后的完整节点信息
                if updated_node:
                    restored_node = self.get_node_by_id(node_id)
                    print(f"[地宫恢复] 成功恢复节点 {node_id} (serial_id: {serial_id}) 的地宫档案")
                    print(f"[地宫恢复] 恢复后数据:")
                    print(f"[地宫恢复]   - event_tuple 长度: {len(restored_node.get('event_tuple', ''))}")
                    print(f"[地宫恢复]   - full_image_url: {restored_node.get('full_image_url', '无')}")
                    return restored_node
                
                print(f"[地宫恢复] 错误：更新活跃事件表失败")
                return None
                
        except psycopg2.Error as e:
            error_msg = str(e)
            if "column \"serial_id\" does not exist" in error_msg:
                print(f"[地宫恢复] 错误：地宫表缺少serial_id字段，请先修改表结构")
                print(f"[地宫恢复] 需要执行: ALTER TABLE ains_archive_necropolis ADD COLUMN serial_id INTEGER;")
            else:
                print(f"[地宫恢复] 数据库错误: {error_msg}")
            return None
        except Exception as e:
            print(f"[地宫恢复] 未知错误: {e}")
            return None
    
    def get_causal_chain(self, node_id: str):
        """
        职责：获取节点所属的因果链（同一个根节点上的所有节点）。
        算法：
        1. 找到节点的根节点（没有父节点的祖先）
        2. 获取根节点的所有后代节点
        3. 返回根节点和所有后代节点
        """
        # 1. 找到根节点
        def find_root(current_id, visited=None):
            if visited is None:
                visited = set()
            
            if current_id in visited:
                return None  # 检测到循环
            
            visited.add(current_id)
            
            # 获取当前节点
            node = self.get_node_by_id(current_id)
            if not node:
                return None
            
            # 获取父节点
            parent_ids = node.get('parent_ids', [])
            
            # 如果没有父节点，这就是根节点
            if not parent_ids:
                return current_id
            
            # 递归查找父节点的根节点
            # 如果有多个父节点，选择第一个父节点的根节点
            if parent_ids:
                return find_root(parent_ids[0], visited)
            
            return None
        
        # 查找根节点
        root_id = find_root(node_id)
        if not root_id:
            return []
        
        # 2. 获取根节点的所有后代节点（包括根节点自身）
        def get_descendants(parent_id, descendants=None):
            if descendants is None:
                descendants = []
            
            # 添加当前节点
            if parent_id not in descendants:
                descendants.append(parent_id)
            
            # 查找所有直接子节点
            sql = "SELECT node_id FROM ains_active_nodes WHERE parent_id LIKE %s"
            with self.conn.cursor() as cur:
                cur.execute(sql, (f'%{parent_id}%',))
                children = [row[0] for row in cur.fetchall()]
            
            # 递归获取子节点的后代
            for child_id in children:
                get_descendants(child_id, descendants)
            
            return descendants
        
        # 获取因果链中的所有节点
        causal_chain = get_descendants(root_id)
        return causal_chain
    
    def get_user_weight(self, actor_id: str, serial_id: int):
        """
        职责：获取用户对特定事件的权重
        返回：用户权重，如果不存在则返回None
        """
        sql = "SELECT survival_weight FROM ains_user_weights WHERE actor_id = %s AND serial_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (actor_id, serial_id))
            result = cur.fetchone()
            return float(result[0]) if result else None
    
    def set_user_weight(self, actor_id: str, serial_id: int, weight: float):
        """
        职责：设置用户对特定事件的权重
        如果记录不存在则插入，存在则更新
        """
        # 首先检查记录是否存在
        check_sql = "SELECT 1 FROM ains_user_weights WHERE actor_id = %s AND serial_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(check_sql, (actor_id, serial_id))
            exists = cur.fetchone() is not None
            
            if exists:
                # 更新现有记录
                update_sql = """
                    UPDATE ains_user_weights 
                    SET survival_weight = %s, last_accessed = CURRENT_TIMESTAMP
                    WHERE actor_id = %s AND serial_id = %s
                """
                cur.execute(update_sql, (weight, actor_id, serial_id))
            else:
                # 插入新记录
                insert_sql = """
                    INSERT INTO ains_user_weights (actor_id, serial_id, survival_weight)
                    VALUES (%s, %s, %s)
                """
                cur.execute(insert_sql, (actor_id, serial_id, weight))
    
    def get_user_nodes(self, actor_id: str):
        """
        职责：获取用户的所有节点及其权重
        返回：包含用户权重的节点列表
        """
        sql = """
            SELECT n.*, COALESCE(w.survival_weight, n.survival_weight) as user_weight
            FROM ains_active_nodes n
            LEFT JOIN ains_user_weights w ON n.serial_id = w.serial_id AND w.actor_id = %s
            ORDER BY n.created_at ASC
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (actor_id,))
            nodes = cur.fetchall()
            # 为每个节点解析父节点列表
            for node in nodes:
                if 'parent_id' in node:
                    node['parent_ids'] = self._string_to_parents(node.get('parent_id'))
                # 使用用户权重覆盖全局权重
                if node.get('user_weight') is not None:
                    node['survival_weight'] = node['user_weight']
            return nodes
    
    def get_user_causal_chain(self, node_id: str, actor_id: str):
        """
        职责：获取用户视角下的因果链（包含用户权重）
        返回：包含用户权重的因果链节点列表
        """
        # 获取因果链中的所有节点ID
        causal_chain = self.get_causal_chain(node_id)
        if not causal_chain:
            return []
        
        # 获取每个节点的详细信息（包含用户权重）
        nodes = []
        for chain_node_id in causal_chain:
            sql = """
                SELECT n.*, COALESCE(w.survival_weight, n.survival_weight) as user_weight
                FROM ains_active_nodes n
                LEFT JOIN ains_user_weights w ON n.serial_id = w.serial_id AND w.actor_id = %s
                WHERE n.node_id = %s
            """
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, (actor_id, chain_node_id))
                node = cur.fetchone()
                if node:
                    if 'parent_id' in node:
                        node['parent_ids'] = self._string_to_parents(node.get('parent_id'))
                    # 使用用户权重覆盖全局权重
                    if node.get('user_weight') is not None:
                        node['survival_weight'] = node['user_weight']
                    nodes.append(node)
        
        return nodes
    
    def get_non_startup_nodes(self, owner_id=None):
        """
        职责：获取非初创节点（有连接关系的节点）
        条件：parent_id不为NULL或有子节点
        初创节点定义：parent_id为NULL且没有子节点
        使用用户提供的更简单的SQL语句
        """
        # 构建SQL查询
        if owner_id:
            sql = """
                SELECT n.*
                FROM ains_active_nodes n
                WHERE NOT (
                    n.parent_id IS NULL
                    AND n.node_id NOT IN (
                        SELECT parent_id 
                        FROM ains_active_nodes
                        WHERE parent_id IS NOT NULL
                    )
                )
                AND n.owner_id = %s
                ORDER BY n.created_at ASC
            """
            params = (owner_id,)
        else:
            sql = """
                SELECT n.*
                FROM ains_active_nodes n
                WHERE NOT (
                    n.parent_id IS NULL
                    AND n.node_id NOT IN (
                        SELECT parent_id 
                        FROM ains_active_nodes
                        WHERE parent_id IS NOT NULL
                    )
                )
                ORDER BY n.created_at ASC
            """
            params = ()
        
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            nodes = cur.fetchall()
            # 为每个节点解析父节点列表
            for node in nodes:
                if 'parent_id' in node:
                    node['parent_ids'] = self._string_to_parents(node.get('parent_id'))
            return nodes
    
    def promote_all_weights(self, node_id: str, actor_id=None, owner_id=None, set_as_boss=True):
        """
        职责：提升节点权重到所有节点总权重的60%。
        如果指定actor_id，更新用户权重表；否则更新全局权重。
        如果指定owner_id，只处理属于该owner_id的节点。
        如果set_as_boss为True，将点击的节点设置为大股东（权重60%），
        所有其他节点按现有权重比例分配剩余的40%。
        返回：更新后的节点列表
        """
        if actor_id:
            print(f"[全局权重提升] 用户 {actor_id} 将节点 {node_id} 设置为大股东（权重60%），所有其他节点分配剩余40%")
            if owner_id:
                print(f"[全局权重提升] 只处理owner_id为 {owner_id} 的节点")
        else:
            print(f"[全局权重提升] 将节点 {node_id} 设置为大股东（权重60%），所有其他节点分配剩余40%")
        
        # 1. 加载地宫全文（如果存在）
        restored_node = self.restore_from_necropolis(node_id)
        
        # 2. 获取节点的当前权重（根据owner_id过滤）
        all_nodes = self.get_all_active(owner_id)
        
        # 如果指定了actor_id，需要获取用户权重
        if actor_id:
            # 获取用户特定的节点数据（但需要根据owner_id过滤）
            user_nodes = self.get_user_nodes(actor_id)
            # 创建一个映射：node_id -> 用户权重
            user_weight_map = {}
            for node in user_nodes:
                serial_id = node.get('serial_id')
                if serial_id:
                    user_weight = self.get_user_weight(actor_id, serial_id)
                    if user_weight is not None:
                        user_weight_map[node['node_id']] = user_weight
        
        # 3. 计算所有节点的当前权重
        node_infos = []
        total_weight_excluding_boss = 0.0
        
        for node in all_nodes:
            # 获取节点权重
            if actor_id:
                # 从用户权重映射获取权重，如果不存在则使用全局权重
                weight = user_weight_map.get(node['node_id'], float(node.get('survival_weight', 0.0)))
            else:
                weight = float(node.get('survival_weight', 0.0))
            
            is_boss = (node['node_id'] == node_id)
            
            node_infos.append({
                'node_id': node['node_id'],
                'serial_id': node.get('serial_id'),
                'current_weight': weight,
                'is_boss': is_boss
            })
            
            # 累加大股东之外节点的权重
            if not is_boss:
                total_weight_excluding_boss += weight
        
        # 4. 计算新的权重分配
        updated_nodes = []
        boss_weight = 0.60  # 大股东固定60%
        
        for node_info in node_infos:
            if node_info['is_boss'] and set_as_boss:
                # 大股东：权重60%
                new_weight = boss_weight
                
                if actor_id and node_info['serial_id']:
                    # 更新用户权重表
                    self.set_user_weight(actor_id, node_info['serial_id'], new_weight)
                else:
                    # 更新全局权重
                    update_data = {
                        "node_id": node_info['node_id'],
                        "survival_weight": new_weight,
                        "vision_level": 0
                    }
                    
                    # 如果从地宫恢复了内容，更新event_tuple
                    if restored_node and restored_node.get('event_tuple'):
                        update_data["event_tuple"] = restored_node['event_tuple']
                        print(f"[全局权重提升] 已从地宫加载完整内容，字符数: {len(restored_node['event_tuple'])}")
                    
                    self.upsert_node(update_data)
            else:
                # 所有其他节点：按现有权重比例分配剩余的40%
                if total_weight_excluding_boss > 0:
                    # 计算权重比例
                    weight_ratio = node_info['current_weight'] / total_weight_excluding_boss
                    # 按比例分配40%
                    new_weight = weight_ratio * 0.40
                else:
                    # 如果所有其他节点权重都为0，平均分配40%
                    num_other_nodes = len(node_infos) - 1
                    new_weight = 0.40 / num_other_nodes if num_other_nodes > 0 else 0.0
                
                if actor_id and node_info['serial_id']:
                    # 更新用户权重表
                    self.set_user_weight(actor_id, node_info['serial_id'], new_weight)
                else:
                    # 更新全局权重
                    self.update_node_weight(node_info['node_id'], new_weight)
            
            # 获取更新后的节点信息
            updated_node = self.get_node_by_id(node_info['node_id'])
            if updated_node:
                # 添加用户权重信息
                if actor_id and node_info['serial_id']:
                    user_weight = self.get_user_weight(actor_id, node_info['serial_id'])
                    if user_weight is not None:
                        updated_node['user_weight'] = user_weight
                        updated_node['survival_weight'] = user_weight  # 覆盖全局权重用于显示
                
                updated_nodes.append(updated_node)
        
        # 5. 验证权重总和
        total_weight = sum(float(node.get('survival_weight', 0)) for node in updated_nodes)
        print(f"[全局权重提升] 权重分配完成：大股东60%，所有其他节点分配40%，总权重: {total_weight:.4f}")
        print(f"[全局权重提升] 更新了 {len(updated_nodes)} 个节点的权重")
        
        return updated_nodes
# 实例化单例
db = CausalDatabase()
