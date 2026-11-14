import os
import hashlib
import secrets
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from core.embedding import get_embedding

# 加载环境变量
load_dotenv()

# 数据库配置
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "192.168.66.39"),
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
    def _previous_to_string(previous_ids):
        """
        职责：将前事件ID列表转换为|分隔的字符串
        """
        if not previous_ids:
            return None
        if isinstance(previous_ids, list):
            # 过滤空值并去重
            filtered_ids = [str(pid).strip() for pid in previous_ids if pid and str(pid).strip()]
            if not filtered_ids:
                return None
            return '|'.join(filtered_ids)
        return str(previous_ids).strip() if str(previous_ids).strip() else None
    
    @staticmethod
    def _string_to_previous(parent_str):
        """
        职责：将|分隔的字符串解析为前事件ID列表
        """
        if not parent_str:
            return []
        # 分割字符串，过滤空值并去重
        previous = [pid.strip() for pid in str(parent_str).split('|') if pid.strip()]
        return list(dict.fromkeys(previous))  # 保持顺序并去重

    def _init_db(self):
        """
        职责：初始化活跃事件表、地宫归档表和用户权重表
        """
        with self.conn.cursor() as cur:
            # 创建活跃事件表
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ains_active_nodes (
                    node_id VARCHAR(500),
                    parent_id VARCHAR(500),
                    block_tag VARCHAR(50),
                    action_tag VARCHAR(50),
                    event_tuple TEXT,
                    survival_weight NUMERIC DEFAULT 1.0,
                    vision_level INTEGER DEFAULT 0,
                    full_image_url TEXT,
                    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    owner_id VARCHAR(500) DEFAULT 'default',
                    PRIMARY KEY (node_id, owner_id)
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
                # 为活跃事件表添加语义向量字段
                cur.execute("""
                    ALTER TABLE ains_active_nodes 
                    ADD COLUMN IF NOT EXISTS semantic_vector vector(1024);
                """)
                # 节点分享标记（默认不分享，仅场主可见）
                cur.execute("""
                    ALTER TABLE ains_active_nodes 
                    ADD COLUMN IF NOT EXISTS is_share BOOLEAN DEFAULT FALSE;
                """)
                # 用户副本因果连线（副本为宗：NULL 才回退主副本）
                cur.execute("""
                    ALTER TABLE ains_user_weights 
                    ADD COLUMN IF NOT EXISTS parent_id VARCHAR(500);
                """)
            except Exception as e:
                print(f"[数据库警告] 添加表列时出错: {e}")

            # 账号中心：用户表 / 场主表（鉴权升级所需，兼容旧库自动补建）
            try:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS ains_users (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        actor_id VARCHAR(64) NOT NULL UNIQUE,
                        token TEXT,
                        password VARCHAR(255),
                        is_admin BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMPTZ DEFAULT now(),
                        updated_at TIMESTAMPTZ DEFAULT now()
                    );
                """)
                cur.execute("""
                    ALTER TABLE ains_users 
                    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS ains_owner_masters (
                        owner_id VARCHAR(64) NOT NULL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        actor_id VARCHAR(64) NOT NULL,
                        created_at TIMESTAMPTZ DEFAULT now(),
                        updated_at TIMESTAMPTZ DEFAULT now()
                    );
                """)
            except Exception as e:
                print(f"[数据库警告] 初始化账号表时出错: {e}")

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
                    node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                    # 重命名 parent_id → previous_node（API 字段名统一，存的是 node_id 标题）
                    node['previous_node'] = node.pop('parent_id')
            return node

    def get_node_links(self, node_id: str, actor_id: str = None):
        """
        职责：获取节点的因果链 serial_id 列表（多因多果）
        参数：
            node_id: 当前节点的 node_id（标题）
            actor_id: 观察者ID（可选）。提供时以该 actor 的用户副本连线和权重为宗，
                      副本 parent_id 为 '' 表示明确无父节点，NULL 才回退主副本。
        返回：
            dict: {
                "previous_ids": [前事件 serial_id 整数列表]，无则为 []
                "next_ids": [后事件 serial_id 整数列表]，无则为 []
            }
        说明：
            - parent_id 字段在数据库中以 | 分隔的字符串存储，支持多前事件
            - 查询子节点时使用 | 分隔符匹配，兼容多因多果
        """
        # 有效 parent_id：用户副本优先（空串表示明确无父节点），NULL 才回退主副本
        result = {"previous_ids": [], "next_ids": []}

        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                # 1) 取当前节点的 serial_id 与主副本 parent_id
                cur.execute(
                    "SELECT serial_id, parent_id FROM ains_active_nodes WHERE node_id = %s",
                    (node_id,),
                )
                row = cur.fetchone()
                serial_id = row.get("serial_id") if row else None
                master_parent = row.get("parent_id") if row else None

                # 2) 确定有效连线：副本为宗
                #    - 副本存在且 parent_id IS NOT NULL → 用副本值（'' 表示明确无父节点）
                #    - 否则回退主副本
                effective_parent = master_parent
                if actor_id and serial_id is not None:
                    cur.execute(
                        "SELECT parent_id FROM ains_user_weights WHERE actor_id = %s AND serial_id = %s",
                        (actor_id, serial_id),
                    )
                    user_row = cur.fetchone()
                    if user_row is not None and user_row.get("parent_id") is not None:
                        effective_parent = user_row.get("parent_id")

                # 3) 前事件 serial_id 列表
                if effective_parent:
                    cur.execute(
                        "SELECT parent.serial_id FROM ains_active_nodes parent "
                        "WHERE parent.node_id = ANY(string_to_array(%s, '|'))",
                        (effective_parent,),
                    )
                    result["previous_ids"] = [
                        int(r["serial_id"]) for r in cur.fetchall() if r["serial_id"] is not None
                    ]

                # 4) 后事件 serial_id 列表（观测者用副本连线）
                if actor_id:
                    cur.execute(
                        "SELECT sub.serial_id FROM ains_active_nodes sub "
                        "LEFT JOIN ains_user_weights cw ON cw.serial_id = sub.serial_id "
                        "AND cw.actor_id = %s "
                        "WHERE POSITION(chr(124) || %s || chr(124) IN chr(124) || "
                        "COALESCE(cw.parent_id, sub.parent_id) || chr(124)) > 0",
                        (actor_id, node_id),
                    )
                else:
                    cur.execute(
                        "SELECT sub.serial_id FROM ains_active_nodes sub "
                        "WHERE POSITION(chr(124) || %s || chr(124) IN chr(124) || sub.parent_id || chr(124)) > 0",
                        (node_id,),
                    )
                result["next_ids"] = [
                    int(r["serial_id"]) for r in cur.fetchall() if r["serial_id"] is not None
                ]

        except Exception as e:
            print(f"[数据库错误] 获取节点链路失败: {e}")

        return result

    def insert_node(self, node_data: dict):
        """
        职责：严格执行 INSERT。如果 node_id 已存在，将触发唯一约束异常，防止覆盖。
        """
        # 处理前事件：将列表转换为|分隔的字符串
        # main.py genesis 端点传递的键名为 previous_node（可能是列表或 None）
        previous_ids = node_data.get('previous_node')
        parent_id_str = self._previous_to_string(previous_ids)
        
        # 获取owner_id，默认为'default'
        owner_id = node_data.get('owner_id', 'default')
        
        # 生成语义向量：将 node_id 拼在 event_tuple 前面，防止短文本退化
        semantic_vector = None
        if node_data.get('event_tuple'):
            embed_text = f"{node_data['node_id']}。{node_data['event_tuple']}"
            semantic_vector = get_embedding(embed_text)

        sql = """
            INSERT INTO ains_active_nodes 
            (node_id, parent_id, block_tag, action_tag, event_tuple, survival_weight, full_image_url, owner_id, semantic_vector, is_share)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
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
                owner_id,
                semantic_vector,
                node_data.get('is_share', False)
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
            # 为每个节点解析前事件列表
            for node in nodes:
                if 'parent_id' in node:
                    node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                    node['previous_node'] = node.pop('parent_id')
            return nodes

    def get_bot_chat_nodes_cross_field(self, bot_id: str, exclude_owner_id: str = None, focal_node_id: str = None, max_eyes: float = None):
        """获取异场（owner_id != exclude_owner_id）中属于某 bot 的 [chat] 节点。
        若提供 focal_node_id，则同时计算到焦点节点的语义距离 distance（并剥离大向量）。
        若提供 max_eyes 且有 focal_node_id，则在数据库层级过滤 distance <= max_eyes 的节点。"""
        if focal_node_id:
            sql = """
                SELECT n.*,
                       (n.semantic_vector <=> (
                           SELECT semantic_vector FROM ains_active_nodes WHERE node_id = %s
                       )) * 100 AS distance
                FROM ains_active_nodes n
                WHERE n.event_tuple LIKE %s
                  AND n.event_tuple LIKE %s
                  AND n.semantic_vector IS NOT NULL
            """
            params = [focal_node_id, f"%{bot_id}%", "%[chat]%"]
            
            if max_eyes is not None:
                sql += """
                  AND (n.semantic_vector <=> (
                      SELECT semantic_vector FROM ains_active_nodes WHERE node_id = %s
                  )) * 100 <= %s
                """
                params.extend([focal_node_id, max_eyes])
        else:
            sql = """
                SELECT * FROM ains_active_nodes
                WHERE event_tuple LIKE %s
                  AND event_tuple LIKE %s
            """
            params = [f"%{bot_id}%", "%[chat]%"]
        if exclude_owner_id:
            sql += " AND owner_id != %s"
            params.append(exclude_owner_id)
        sql += " ORDER BY created_at ASC"

        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            nodes = cur.fetchall()
        # 与 get_all_active 一致：解析前事件列表
        for node in nodes:
            if 'parent_id' in node:
                node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                node['previous_node'] = node.pop('parent_id')
            if 'distance' in node and node['distance'] is not None:
                node['distance'] = float(node['distance'])
            if focal_node_id:
                node.pop('semantic_vector', None)
                node.pop('visual_vector', None)
        return nodes

    def delete_node(self, node_id: str):
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM ains_active_nodes WHERE node_id = %s", (node_id,))

    def upsert_node(self, node_data: dict):
        """
        职责：更新事件的多个字段，用于代谢引擎。
        注意：这里使用 UPDATE 而不是 INSERT，因为事件应该已经存在。
        """
        node_id = node_data['node_id']
        
        # 获取当前数据库中的节点，以比对 event_tuple 是否真正发生变化
        current_node = self.get_node_by_id(node_id)
        current_event_tuple = current_node.get('event_tuple') if current_node else None
        new_event_tuple = node_data.get('event_tuple')
        
        # 检查是否需要更新 event_tuple
        if 'event_tuple' in node_data:
            # 如果 event_tuple 发生了实质性变化（被提炼或清空），则同步更新 semantic_vector
            if new_event_tuple != current_event_tuple:
                print(f"[数据库] 节点 {node_id} 的 event_tuple 发生变化，同步更新 semantic_vector")
                embed_text = f"{node_id}。{new_event_tuple}" if new_event_tuple else node_id
                semantic_vector = get_embedding(embed_text)
                
                sql = """
                    UPDATE ains_active_nodes 
                    SET survival_weight = %s,
                        vision_level = %s,
                        event_tuple = %s,
                        semantic_vector = %s,
                        last_accessed = CURRENT_TIMESTAMP
                    WHERE node_id = %s
                """
                with self.conn.cursor() as cur:
                    cur.execute(sql, (
                        node_data.get('survival_weight', 1.0),
                        node_data.get('vision_level', 0),
                        new_event_tuple,
                        semantic_vector,
                        node_id
                    ))
            else:
                # event_tuple 没有变化，不需要重新计算向量
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
                        new_event_tuple,
                        node_id
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
                    node_id
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
            
            # 同时更新语义向量：将 node_id 拼在 event_tuple 前面，防止短文本退化
            effective_node_id = node_data.get('node_id', old_node_id)
            embed_text = f"{effective_node_id}。{node_data['event_tuple']}"
            semantic_vector = get_embedding(embed_text)
            if semantic_vector:
                update_fields.append("semantic_vector = %s")
                update_values.append(semantic_vector)
                print(f"[数据库更新] 更新semantic_vector (embed_text长度={len(embed_text)})")
        
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
        
        # 处理前事件ID
        if 'previous_ids' in node_data:
            # 将前事件ID列表转换为|分隔的字符串
            parent_id_str = self._previous_to_string(node_data['previous_ids'])
            update_fields.append("parent_id = %s")
            update_values.append(parent_id_str)
            print(f"[数据库更新] 更新parent_id: {parent_id_str} (原始列表: {node_data['previous_ids']})")
            
        # 处理隐私权限标
        if 'is_share' in node_data:
            update_fields.append("is_share = %s")
            update_values.append(node_data['is_share'])
            print(f"[数据库更新] 更新is_share: {node_data['is_share']}")
        
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
            
            # 同步更新地宫表
            necropolis_fields = []
            necropolis_values = []
            
            if 'node_id' in node_data and node_data['node_id'] != old_node_id:
                necropolis_fields.append("node_id = %s")
                necropolis_values.append(node_data['node_id'])
                
            if 'event_tuple' in node_data:
                # 只有当 raw_content 非空时才更新
                necropolis_fields.append("raw_content = CASE WHEN raw_content IS NOT NULL AND raw_content != '' THEN %s ELSE raw_content END")
                necropolis_values.append(node_data['event_tuple'])
                
            if 'full_image_url' in node_data:
                # 只有当 raw_full_image_url 非空时才更新
                necropolis_fields.append("raw_full_image_url = CASE WHEN raw_full_image_url IS NOT NULL AND raw_full_image_url != '' THEN %s ELSE raw_full_image_url END")
                necropolis_values.append(node_data['full_image_url'])
                
            if necropolis_fields:
                # 尝试获取 serial_id
                cur.execute("SELECT serial_id FROM ains_active_nodes WHERE node_id = %s", (node_data.get('node_id', old_node_id),))
                result = cur.fetchone()
                
                necropolis_fields.append("sealed_at = CURRENT_TIMESTAMP")
                
                if result and result[0]:
                    serial_id = result[0]
                    necropolis_values.append(serial_id)
                    necropolis_sql = f"""
                        UPDATE ains_archive_necropolis
                        SET {', '.join(necropolis_fields)}
                        WHERE serial_id = %s
                    """
                else:
                    necropolis_values.append(old_node_id)
                    necropolis_sql = f"""
                        UPDATE ains_archive_necropolis
                        SET {', '.join(necropolis_fields)}
                        WHERE node_id = %s
                    """
                
                cur.execute(necropolis_sql, tuple(necropolis_values))
                print(f"[数据库更新] 地宫表同步更新成功，影响行数: {cur.rowcount}")

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

    def update_children_to_new_previous(self, old_previous_id: str, new_previous_ids):
        """
        职责：将子事件的前事件ID更新为新的前事件ID（支持多前事件）
        """
        # 获取所有以old_previous_id为前事件的子节点
        sql = "SELECT node_id, parent_id FROM ains_active_nodes WHERE parent_id LIKE %s"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (f'%{old_previous_id}%',))
            children = cur.fetchall()
            
            for child in children:
                # 解析子节点的当前前事件列表
                current_previous = self._string_to_previous(child['parent_id'])
                
                # 替换old_previous_id为new_previous_ids
                new_previous = []
                for prev in current_previous:
                    if prev == old_previous_id:
                        # 如果是被删除的前事件，替换为新的前事件列表
                        if isinstance(new_previous_ids, list):
                            new_previous.extend(new_previous_ids)
                        else:
                            new_previous.append(new_previous_ids)
                    else:
                        # 保留其他前事件
                        new_previous.append(prev)
                
                # 去重
                new_previous = list(dict.fromkeys(new_previous))
                
                # 更新子节点的前事件
                new_previous_str = self._previous_to_string(new_previous)
                update_sql = "UPDATE ains_active_nodes SET parent_id = %s WHERE node_id = %s"
                cur.execute(update_sql, (new_previous_str, child['node_id']))

    def update_children_to_null_previous(self, previous_id: str):
        """
        职责：将子事件的前事件ID更新为NULL（支持多前事件）
        """
        # 获取所有以previous_id为前事件的子节点
        sql = "SELECT node_id, parent_id FROM ains_active_nodes WHERE parent_id LIKE %s"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (f'%{previous_id}%',))
            children = cur.fetchall()
            
            for child in children:
                # 解析子节点的当前前事件列表
                current_previous = self._string_to_previous(child['parent_id'])
                
                # 移除被删除的前事件
                new_previous = [p for p in current_previous if p != previous_id]
                
                # 如果移除后没有前事件，设置为NULL，否则转换为字符串
                if not new_previous:
                    new_previous_str = None
                else:
                    new_previous_str = self._previous_to_string(new_previous)
                
                # 更新子节点的前事件
                update_sql = "UPDATE ains_active_nodes SET parent_id = %s WHERE node_id = %s"
                cur.execute(update_sql, (new_previous_str, child['node_id']))

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
                "previous_node": node.get('previous_node', node.get('parent_id')),
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
                
                # 如果内容发生变化，同步更新语义向量
                semantic_vector_sql = ""
                params = [record['raw_content'], record['raw_full_image_url']]
                
                if content_changed:
                    embed_text = f"{node_id}。{record['raw_content']}" if record['raw_content'] else node_id
                    semantic_vector = get_embedding(embed_text)
                    if semantic_vector:
                        semantic_vector_sql = ", semantic_vector = %s"
                        params.append(semantic_vector)
                        print(f"[地宫恢复] 已重新计算全息语义向量")
                
                params.append(node_id)
                
                # 更新活跃事件表
                update_sql = f"""
                    UPDATE ains_active_nodes 
                    SET event_tuple = %s, 
                        full_image_url = %s{semantic_vector_sql},
                        last_accessed = CURRENT_TIMESTAMP
                    WHERE node_id = %s
                    RETURNING *
                """
                cur.execute(update_sql, tuple(params))
                
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
            
            # 获取前事件
            previous_ids = node.get('previous_ids', [])
            
            # 如果没有前事件，这就是根节点
            if not previous_ids:
                return current_id
            
            # 递归查找前事件的根节点
            # 如果有多个前事件，选择第一个前事件的根节点
            if previous_ids:
                return find_root(previous_ids[0], visited)
            
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
    
    def get_user_parent_link(self, actor_id: str, serial_id: int):
        """
        职责：读取用户副本中的连线。
        返回：(exists, parent_id)
            exists=False 表示副本不存在；
            parent_id 为 None 表示副本尚未初始化（需回退主副本）；
            parent_id 为 '' 表示副本明确无父节点。
        """
        sql = "SELECT parent_id FROM ains_user_weights WHERE actor_id = %s AND serial_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (actor_id, serial_id))
            result = cur.fetchone()
            if result is None:
                return False, None
            return True, result[0]

    def set_user_parent_link(self, actor_id: str, serial_id: int, parent_id_str):
        """
        职责：明确写入用户副本的因果连线（不覆盖权重）。
        约定（副本为宗）：
            None → 副本未初始化（读时回退主副本）
            ''   → 副本明确无父节点（读时不再回退）
            其它 → 副本的父节点标题列表（| 分隔）
        """
        stored = "" if parent_id_str is not None else None
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT survival_weight FROM ains_user_weights WHERE actor_id = %s AND serial_id = %s",
                (actor_id, serial_id),
            )
            row = cur.fetchone()
            if row is None:
                cur.execute(
                    "INSERT INTO ains_user_weights (actor_id, serial_id, survival_weight, parent_id) "
                    "VALUES (%s, %s, 1.0, %s)",
                    (actor_id, serial_id, stored),
                )
            else:
                cur.execute(
                    "UPDATE ains_user_weights SET parent_id = %s, last_accessed = CURRENT_TIMESTAMP "
                    "WHERE actor_id = %s AND serial_id = %s",
                    (stored, actor_id, serial_id),
                )

    def ensure_user_copy(self, actor_id: str, node: dict):
        """
        职责：访问时为该 actor 建立/补齐用户副本（副本为宗）。
        规则：
            1. 无副本记录 → 复制主副本权重与 parent_id；
            2. 有记录但 parent_id IS NULL（旧版本遗留）→ 用主副本 parent_id 回填；
            3. 已有副本的权重和 parent_id 一律不覆盖。
        参数：
            node: 需包含 serial_id / survival_weight / previous_ids（node_id 标题列表）
        """
        serial_id = node.get("serial_id")
        if not serial_id:
            return
        try:
            exists, user_parent = self.get_user_parent_link(actor_id, serial_id)
            master_parent = self._previous_to_string(node.get("previous_ids"))
            master_weight = float(node.get("survival_weight", 1.0) or 1.0)

            if not exists:
                with self.conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO ains_user_weights (actor_id, serial_id, survival_weight, parent_id) "
                        "VALUES (%s, %s, %s, %s) ON CONFLICT (actor_id, serial_id) DO NOTHING",
                        (actor_id, serial_id, master_weight, master_parent),
                    )
            elif user_parent is None:
                # 旧数据：副本连线未初始化，回填主副本连线
                with self.conn.cursor() as cur:
                    cur.execute(
                        "UPDATE ains_user_weights SET parent_id = %s, last_accessed = CURRENT_TIMESTAMP "
                        "WHERE actor_id = %s AND serial_id = %s AND parent_id IS NULL",
                        (master_parent, actor_id, serial_id),
                    )
        except Exception as e:
            print(f"[用户副本] 初始化失败 actor={actor_id}, serial_id={serial_id}: {e}")

    def get_user_overrides(self, actor_id: str, serial_ids=None):
        """
        职责：批量读取某 actor 的副本覆盖项（权重 + 连线）。
        返回：{serial_id: {"weight": float|None, "parent_id": str|None, "has_parent": bool}}
        """
        result = {}
        if not actor_id:
            return result
        sql = "SELECT serial_id, survival_weight, parent_id FROM ains_user_weights WHERE actor_id = %s"
        params = [actor_id]
        if serial_ids:
            sql += " AND serial_id = ANY(%s)"
            params.append(list(serial_ids))
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, tuple(params))
            for row in cur.fetchall():
                result[row["serial_id"]] = {
                    "weight": float(row["survival_weight"]) if row["survival_weight"] is not None else None,
                    "parent_id": row["parent_id"],
                    "has_parent": row["parent_id"] is not None,
                }
        return result

    def set_user_weight(self, actor_id: str, serial_id: int, weight: float, parent_id: str = None):
        """
        职责：设置用户对特定事件的权重和主管连线(parent_id)
        如果记录不存在则插入，存在则更新
        """
        # 首先检查记录是否存在
        # 约定：parent_id 为 None 表示“不改连线”；为 "" 表示“明确无父节点”（写入空串）
        check_sql = "SELECT 1 FROM ains_user_weights WHERE actor_id = %s AND serial_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(check_sql, (actor_id, serial_id))
            exists = cur.fetchone() is not None
            
            if exists:
                # 更新现有记录
                if parent_id is not None:
                    update_sql = """
                        UPDATE ains_user_weights 
                        SET survival_weight = %s, parent_id = %s, last_accessed = CURRENT_TIMESTAMP
                        WHERE actor_id = %s AND serial_id = %s
                    """
                    cur.execute(update_sql, (weight, parent_id, actor_id, serial_id))
                else:
                    update_sql = """
                        UPDATE ains_user_weights 
                        SET survival_weight = %s, last_accessed = CURRENT_TIMESTAMP
                        WHERE actor_id = %s AND serial_id = %s
                    """
                    cur.execute(update_sql, (weight, actor_id, serial_id))
            else:
                # 插入新记录
                if parent_id is not None:
                    insert_sql = """
                        INSERT INTO ains_user_weights (actor_id, serial_id, survival_weight, parent_id)
                        VALUES (%s, %s, %s, %s)
                    """
                    cur.execute(insert_sql, (actor_id, serial_id, weight, parent_id))
                else:
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
            SELECT n.*, COALESCE(w.survival_weight, n.survival_weight) as user_weight, w.parent_id as user_parent_id
            FROM ains_active_nodes n
            LEFT JOIN ains_user_weights w ON n.serial_id = w.serial_id AND w.actor_id = %s
            ORDER BY n.created_at ASC
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (actor_id,))
            nodes = cur.fetchall()
            # 为每个节点解析前事件列表
            for node in nodes:
                # 优先使用用户副本中的连线
                if node.get('user_parent_id') is not None:
                    node['parent_id'] = node['user_parent_id']
                    
                if 'parent_id' in node:
                    node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                    node['previous_node'] = node.pop('parent_id')
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
                        node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                        node['previous_node'] = node.pop('parent_id')
                    # 使用用户权重覆盖全局权重
                    if node.get('user_weight') is not None:
                        node['survival_weight'] = node['user_weight']
                    nodes.append(node)
        
        return nodes
    
    def get_all_semantic_links(self, owner_id=None, threshold: float = 0.5):
        """
        职责：获取全图中所有相似度超过阈值的节点对（语义连线）
        """
        where_clause = "a.semantic_vector IS NOT NULL AND b.semantic_vector IS NOT NULL"
        params = []

        if owner_id:
            where_clause += " AND a.owner_id = %s AND b.owner_id = %s"
            params.extend([owner_id, owner_id])
            
        # 最后添加 threshold 参数，对应 SQL 语句最后的 >= %s
        params.append(threshold)

        sql = f"""
            SELECT a.node_id as source, b.node_id as target,
                   1 - (a.semantic_vector <=> b.semantic_vector) as similarity
            FROM ains_active_nodes a
            JOIN ains_active_nodes b ON a.node_id < b.node_id
            WHERE {where_clause}
              AND 1 - (a.semantic_vector <=> b.semantic_vector) >= %s
        """

        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, tuple(params))
            links = cur.fetchall()
            # 转换为普通字典并确保浮点数精度
            return [{'source': link['source'], 'target': link['target'], 'similarity': float(link['similarity'])} for link in links]

    def get_similar_nodes(self, node_id: str, limit: int = 5, threshold: float = 0.5):
        """
        职责：获取与指定节点语义最相似的节点
        参数：
            node_id: 目标节点ID
            limit: 返回的最大节点数
            threshold: 相似度阈值 (0-1，越大越相似)
        返回：相似节点列表，包含相似度分数
        """
        # 1. 获取目标节点的向量
        target_node = self.get_node_by_id(node_id)
        if not target_node:
            return []
            
        # 2. 使用 pgvector 的余弦距离 (<=>) 进行查询
        # 余弦距离 = 1 - 余弦相似度
        # 所以 相似度 = 1 - 距离
        sql = """
            SELECT n.*, 1 - (n.semantic_vector <=> (
                SELECT semantic_vector FROM ains_active_nodes WHERE node_id = %s
            )) as similarity
            FROM ains_active_nodes n
            WHERE n.node_id != %s 
              AND n.semantic_vector IS NOT NULL
              AND (
                  SELECT semantic_vector FROM ains_active_nodes WHERE node_id = %s
              ) IS NOT NULL
              AND 1 - (n.semantic_vector <=> (
                  SELECT semantic_vector FROM ains_active_nodes WHERE node_id = %s
              )) >= %s
            ORDER BY similarity DESC
            LIMIT %s
        """
        
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (node_id, node_id, node_id, node_id, threshold, limit))
            nodes = cur.fetchall()
            
            # 为每个节点解析前事件列表
            for node in nodes:
                if 'parent_id' in node:
                    node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                    node['previous_node'] = node.pop('parent_id')
                # 移除向量数据以减少传输量
                if 'semantic_vector' in node:
                    del node['semantic_vector']
                    
            return nodes

    def get_event_horizon(self, node_id: str, max_eyes: float, owner_id: str = None, show_links: bool = False, actor_id: str = None):
        """
        职责：获取事件视界内的节点（距离 <= MAX_EYES）
        参数：
            node_id: 目标节点ID（大股东）
            max_eyes: 视界半径（距离阈值）
            owner_id: 事件拥有者ID，如果为None则不按owner过滤
            show_links: 是否返回非焦点节点的 parent_ids/next_ids（默认 False，节省 Token）
            actor_id: 观察者ID（可选）。提供时因果连线以用户副本为宗（副本为宗）。
        返回：视界内的节点列表

        参数顺序（与 SQL 中 %s 出现顺序严格一致）：
            1) node_id  （SELECT 距离子查询）
            2) actor_id （子链 JOIN，仅观测者）
            3) node_id  （WHERE 距离子查询）
            4) node_id  （WHERE 距离阈值）
            5) max_eyes
            6) owner_id （可选）
            7) actor_id （主表 JOIN，仅观测者）
        """
        # 距离 D = (1 - 相似度) * 100，余弦距离 = D / 100
        if actor_id:
            user_join = "LEFT JOIN ains_user_weights w ON w.serial_id = n.serial_id AND w.actor_id = %s"
            child_user_join = "LEFT JOIN ains_user_weights cw ON cw.serial_id = sub.serial_id AND cw.actor_id = %s"
            parent_expr = "COALESCE(w.parent_id, n.parent_id)"
            child_parent_expr = "COALESCE(cw.parent_id, sub.parent_id)"
        else:
            user_join = ""
            child_user_join = ""
            parent_expr = "n.parent_id"
            child_parent_expr = "sub.parent_id"

        # 注意：这里必须用字面量拼接，不能先赋值给变量再在 f-string 里引用，
        #       否则 `%s` 会被 f-string 之外的二次替换吞掉，导致占位符与参数错位。
        if owner_id:
            owner_sub = "AND sub.owner_id = n.owner_id"
            owner_main = "AND n.owner_id = %s"
            next_ids_expr = (
                "COALESCE(("
                "SELECT STRING_AGG(sub.serial_id::text, '|') "
                "FROM ains_active_nodes sub "
                + child_user_join +
                " WHERE POSITION(chr(124) || n.node_id || chr(124) "
                "IN chr(124) || " + child_parent_expr + " || chr(124)) > 0 "
                + owner_sub +
                "), '')"
            )
        else:
            owner_sub = ""
            owner_main = ""
            next_ids_expr = (
                "COALESCE(("
                "SELECT STRING_AGG(sub.serial_id::text, '|') "
                "FROM ains_active_nodes sub "
                + child_user_join +
                " WHERE POSITION(chr(124) || n.node_id || chr(124) "
                "IN chr(124) || " + child_parent_expr + " || chr(124)) > 0 "
                "), '')"
            )

        # 子链匹配用 POSITION(chr(124)...) 而不是 LIKE '%|'，避免 % 被 psycopg2 当作占位符
        # 注意：{user_join} 必须在 WHERE 之前、与 SELECT 中的 {next_ids_expr} 的占位符顺序一致，
        #       因此这里把 next_ids_expr 中的 JOIN 用占位符 %s 显式绑定。
        sql = (
            "\n            SELECT n.serial_id, n.node_id, " + parent_expr + " AS parent_id, n.event_tuple,\n"
            "                   n.owner_id, n.is_share, n.full_image_url,\n"
            "                   (n.semantic_vector <=> (\n"
            "                       SELECT a.semantic_vector FROM ains_active_nodes a WHERE a.node_id = %s\n"
            "                   )) * 100 as distance,\n"
            "                   " + next_ids_expr + " as next_ids_raw\n"
            "            FROM ains_active_nodes n\n"
            "            " + user_join + "\n"
            "            WHERE n.semantic_vector IS NOT NULL\n"
            "              AND (\n"
            "                  SELECT a.semantic_vector FROM ains_active_nodes a WHERE a.node_id = %s\n"
            "              ) IS NOT NULL\n"
            "              AND (n.semantic_vector <=> (\n"
            "                  SELECT a.semantic_vector FROM ains_active_nodes a WHERE a.node_id = %s\n"
            "              )) * 100 <= %s\n"
            "              " + owner_main + "\n"
            "            ORDER BY distance ASC\n        "
        )

        # 参数顺序必须与 SQL 文本中 %s 出现的先后顺序严格一致：
        #   1) SELECT 距离子查询的 node_id
        #   2) 子链 JOIN（next_ids_expr 内）的 actor_id      —— 仅观测者
        #   3) 主表 JOIN（FROM 子句内）的 actor_id            —— 仅观测者
        #   4) WHERE 距离子查询的 node_id
        #   5) WHERE 距离阈值的 node_id
        #   6) max_eyes
        #   7) 场过滤 owner_id                                —— 可选
        params = [node_id]
        if actor_id:
            params.append(actor_id)   # 子链 JOIN
            params.append(actor_id)   # 主表 JOIN（FROM 子句，位于 SELECT 之后）
        params.extend([node_id, node_id, max_eyes])
        if owner_id:
            params.append(owner_id)

        if os.getenv("CAUSAL_DEBUG_SQL") == "1":
            print("[SQL调试] placeholders=" + str(sql.count("%s")) + " params=" + str(len(params)))
            print("[SQL调试] params=" + repr(list(params)))
            print(sql)

        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, tuple(params))
            nodes = cur.fetchall()

            # 后处理：多因多果 → 始终解析为列表，根据开关决定保留与否
            for node in nodes:
                node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                node.pop('parent_id', None)

                raw_next = node.pop('next_ids_raw', None)
                node['next_ids'] = (
                    [int(x) for x in str(raw_next).split('|') if x.strip().isdigit()]
                    if raw_next else []
                )

                if 'distance' in node and node['distance'] is not None:
                    node['distance'] = float(node['distance'])

                # 非焦点节点默认不返回因果链，节省 LLM Token
                if not show_links:
                    node.pop('previous_ids', None)
                    node.pop('next_ids', None)

            return nodes

    def get_cross_field_contact_surface(self, owner_id: str, actor_id: str = None, focal_node_id: str = None):
        """
        职责：获取本场与异场之间的交集接触面连线。
        如果异场节点被设置为不可分享（is_share=False），则将其内容打码。
        若提供 focal_node_id，则同时计算到焦点节点的语义距离 distance（并剥离大向量）。
        """
        distance_col = ""
        if focal_node_id:
            distance_col = ", (n.semantic_vector <=> (SELECT semantic_vector FROM ains_active_nodes WHERE node_id = %s)) * 100 AS distance"

        # 第一步：查找由于 parent_id 关联产生的接触面
        # 提取当前 owner_id 下的所有 node_id，或者指向当前 owner_id 的异场节点
        sql = f"""
            SELECT DISTINCT n.*, w.parent_id as user_parent_id, w.survival_weight as user_weight{distance_col}
            FROM ains_active_nodes n
            LEFT JOIN ains_user_weights w ON n.serial_id = w.serial_id AND w.actor_id = %s
            WHERE n.owner_id != %s
              AND (
                  -- 异场节点的前因包含本场节点
                  EXISTS (
                      SELECT 1 FROM ains_active_nodes b 
                      WHERE b.owner_id = %s 
                        AND ('|' || COALESCE(w.parent_id, n.parent_id) || '|') LIKE '%%|' || b.node_id || '|%%'
                  )
                  OR
                  -- 本场节点的前因包含该异场节点
                  EXISTS (
                      SELECT 1 FROM ains_active_nodes b 
                      LEFT JOIN ains_user_weights bw ON b.serial_id = bw.serial_id AND bw.actor_id = %s
                      WHERE b.owner_id = %s 
                        AND ('|' || COALESCE(bw.parent_id, b.parent_id) || '|') LIKE '%%|' || n.node_id || '|%%'
                  )
              )
        """
        
        params = [actor_id, owner_id, owner_id, actor_id, owner_id]
        if focal_node_id:
            params.insert(0, focal_node_id)

        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            nodes = cur.fetchall()
            
            for node in nodes:
                # 覆盖用户私有连线和权重
                if node.get('user_parent_id') is not None:
                    node['parent_id'] = node['user_parent_id']
                if node.get('user_weight') is not None:
                    node['survival_weight'] = node['user_weight']
                    
                # 处理打码锁桩
                if node.get('owner_id') != owner_id and not node.get('is_share', True):
                    node['event_tuple'] = "【私密桩点】内容不可见"
                    node['full_image_url'] = None
                    node['is_locked'] = True
                    
                if 'parent_id' in node:
                    node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                    node['previous_node'] = node.pop('parent_id')

                if 'distance' in node and node['distance'] is not None:
                    node['distance'] = float(node['distance'])

                if focal_node_id:
                    node.pop('semantic_vector', None)
                    node.pop('visual_vector', None)
                    
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
                    node['previous_ids'] = self._string_to_previous(node.get('parent_id'))
                    node['previous_node'] = node.pop('parent_id')
            return nodes
    
    def get_zero_weight_xiang_nodes(self, threshold=0.0):
        """
        职责：查询"全员遗忘"的"相"事件（候选删除名单）
        判据：block_tag='相' 且所有用户权重都 <= threshold（即没有任何用户还记得它）
        """
        sql = """
            SELECT b.serial_id, b.node_id
            FROM ains_user_weights a
            INNER JOIN ains_active_nodes b ON a.serial_id = b.serial_id
            WHERE b.block_tag = '相'
            GROUP BY b.serial_id, b.node_id
            HAVING MAX(a.survival_weight) <= %s
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (threshold,))
            return cur.fetchall()

    def promote_all_weights(self, node_id: str, actor_id=None, owner_id=None, set_as_boss=True, extra_nodes=None):
        """
        职责：提升节点权重到所有节点总权重的60%。
        如果指定actor_id，更新用户权重表；否则更新全局权重。
        如果指定owner_id，只处理属于该owner_id的节点。
        如果set_as_boss为True，将点击的节点设置为大股东（权重60%），
        所有其他节点按现有权重比例分配剩余的40%。
        extra_nodes: 额外并入参与重排的节点（如异场 bot 节点、接触面节点）。
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

        # 2.1 并入额外的异场节点（参与距离/权重重排），按 node_id 去重
        if extra_nodes:
            seen = {n['node_id'] for n in all_nodes}
            for n in extra_nodes:
                if n.get('node_id') and n['node_id'] not in seen:
                    seen.add(n['node_id'])
                    # 确保跨场节点一定带有 serial_id，否则无法存入用户权重
                    if not n.get('serial_id'):
                        node_full = self.get_node_by_id(n['node_id'])
                        if node_full and node_full.get('serial_id'):
                            n['serial_id'] = node_full['serial_id']
                    all_nodes.append(n)

        # 2.2 确保大股东（被点击节点）一定参与重排，即使它属于异场（不在本场基础集里）
        if node_id and not any(n.get('node_id') == node_id for n in all_nodes):
            boss_node = self.get_node_by_id(node_id)
            if boss_node:
                all_nodes.append(boss_node)
        
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

    # ============================================================
    #  账号中心：用户（ains_users）/ 场（ains_owner_masters）/ 钥匙
    # ============================================================
    @staticmethod
    def _hash_password(password: str) -> str:
        """生成密码散列：salt$sha256(salt + password)，salt 为 32 位 hex 随机串。"""
        salt = secrets.token_hex(16)
        digest = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
        return salt + "$" + digest

    @staticmethod
    def _verify_password(password: str, stored: str) -> bool:
        """校验密码是否匹配存储的散列。"""
        if not stored or "$" not in stored:
            return False
        salt, digest = stored.split("$", 1)
        return hashlib.sha256((salt + password).encode('utf-8')).hexdigest() == digest

    @staticmethod
    def _new_token(actor_id: str) -> str:
        """生成一把新钥匙 token，格式：随机前缀|md5(actor_id + 随机串)。"""
        prefix = secrets.token_hex(6)
        tail = hashlib.md5((actor_id + secrets.token_hex(16)).encode('utf-8')).hexdigest()
        return prefix + "|" + tail

    def get_user(self, actor_id: str):
        sql = "SELECT * FROM ains_users WHERE actor_id = %s"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (actor_id,))
            return cur.fetchone()

    def create_user(self, actor_id: str, password: str, token: str):
        sql = "INSERT INTO ains_users (actor_id, password, token) VALUES (%s, %s, %s)"
        with self.conn.cursor() as cur:
            cur.execute(sql, (actor_id, self._hash_password(password), token))

    def update_user_password(self, actor_id: str, new_password: str):
        sql = "UPDATE ains_users SET password = %s, updated_at = now() WHERE actor_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (self._hash_password(new_password), actor_id))

    def set_user_tokens(self, actor_id: str, tokens):
        sql = "UPDATE ains_users SET token = %s, updated_at = now() WHERE actor_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (",".join(tokens), actor_id))

    def get_user_tokens(self, actor_id: str):
        user = self.get_user(actor_id)
        if not user or not user.get("token"):
            return []
        return [t for t in str(user["token"]).split(",") if t]

    def add_user_token(self, actor_id: str, token: str):
        tokens = self.get_user_tokens(actor_id)
        tokens.append(token)
        self.set_user_tokens(actor_id, tokens)

    def remove_user_token(self, actor_id: str, token: str):
        tokens = [t for t in self.get_user_tokens(actor_id) if t != token]
        self.set_user_tokens(actor_id, tokens)

    # --- 鉴权升级：token 反查 / 场主查询 / admin ---
    def get_actor_by_token(self, token: str):
        """由 token 反查 actor_id（token 以逗号分隔存于 ains_users.token）。"""
        token = (token or "").strip()
        if not token:
            return None
        candidates = [token]
        # 兼容前端把多把钥匙逗号拼接后整体传入的情况
        if "," in token:
            candidates.extend([t.strip() for t in token.split(",") if t.strip()])
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT actor_id, token FROM ains_users WHERE token IS NOT NULL AND token <> ''")
                rows = cur.fetchall()
            for actor_id, tokens in rows:
                owned = [t for t in str(tokens).split(",") if t]
                if any(c in owned for c in candidates):
                    return actor_id
        except Exception as e:
            print(f"[鉴权] token 反查失败: {e}")
        return None

    def get_owner_master(self, owner_id: str):
        """获取场的登记信息（owner_id / name / actor_id）。"""
        sql = "SELECT owner_id, name, actor_id FROM ains_owner_masters WHERE owner_id = %s"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (owner_id,))
            return cur.fetchone()

    def is_admin_actor(self, actor_id: str) -> bool:
        """判断 actor 是否为 admin（ains_users.is_admin）。"""
        if not actor_id:
            return False
        sql = "SELECT is_admin FROM ains_users WHERE actor_id = %s"
        try:
            with self.conn.cursor() as cur:
                cur.execute(sql, (actor_id,))
                row = cur.fetchone()
                return bool(row and row[0])
        except Exception:
            return False

    def set_actor_admin(self, actor_id: str, is_admin: bool):
        """设置 actor 的 admin 标记。"""
        sql = "UPDATE ains_users SET is_admin = %s, updated_at = now() WHERE actor_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (bool(is_admin), actor_id))

    def count_admins(self) -> int:
        """统计当前 admin 数量（用于“不能删除最后一个 admin”保护）。"""
        sql = "SELECT COUNT(*) FROM ains_users WHERE COALESCE(is_admin, FALSE) = TRUE"
        try:
            with self.conn.cursor() as cur:
                cur.execute(sql)
                row = cur.fetchone()
                return int(row[0]) if row else 0
        except Exception:
            return 0

    def list_users(self, limit: int = 200, offset: int = 0):
        """列出所有 actor（账号中心管理视图，不含密码）。"""
        sql = """
            SELECT actor_id, is_admin, created_at
            FROM ains_users
            ORDER BY created_at ASC
            LIMIT %s OFFSET %s
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (limit, offset))
            return cur.fetchall()

    def list_owner_actors(self, limit: int = 500):
        """
        职责：按「房主」聚合，供 admin 房主管理面板使用。
        只返回名下有场（ains_owner_masters）的 actor，附带：
            fields: [{owner_id, name, node_count}]
            token_count: 名下钥匙数量
            is_admin / created_at / field_count / node_count
        """
        sql = """
            SELECT m.actor_id, m.owner_id, m.name, m.created_at,
                   (SELECT COUNT(*) FROM ains_active_nodes n WHERE n.owner_id = m.owner_id) AS node_count
            FROM ains_owner_masters m
            ORDER BY m.created_at ASC
        """
        result = []
        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql)
                rows = cur.fetchall()

                cur.execute("SELECT actor_id, token, is_admin FROM ains_users")
                users = {r["actor_id"]: r for r in cur.fetchall()}

            grouped = {}
            for row in rows:
                actor_id = row["actor_id"]
                bucket = grouped.setdefault(actor_id, {
                    "actor_id": actor_id,
                    "fields": [],
                    "field_count": 0,
                    "node_count": 0,
                    "created_at": str(row.get("created_at") or ""),
                })
                nodes = int(row.get("node_count") or 0)
                bucket["fields"].append({
                    "owner_id": row["owner_id"],
                    "name": row["name"],
                    "node_count": nodes,
                })
                bucket["field_count"] += 1
                bucket["node_count"] += nodes

            for actor_id, bucket in grouped.items():
                u = users.get(actor_id) or {}
                tokens = [t for t in str(u.get("token") or "").split(",") if t]
                bucket["is_admin"] = bool(u.get("is_admin"))
                bucket["token_count"] = len(tokens)
                result.append(bucket)

            result.sort(key=lambda x: (-x["field_count"], -x["node_count"]))
            return result[:limit]
        except Exception as e:
            print(f"[数据库错误] 房主聚合失败: {e}")
            return []

    def reset_actor_tokens(self, actor_id: str):
        """
        职责：为 actor 重置钥匙——吊销其全部旧钥匙，签发一把新钥匙。
        返回：{"token": 新钥匙明文, "revoked_count": 被吊销的旧钥匙把数}
        """
        old_tokens = self.get_user_tokens(actor_id)
        new_token = self._new_token(actor_id)
        self.set_user_tokens(actor_id, [new_token])
        print(f"[admin] 重置钥匙 actor={actor_id}, 吊销 {len(old_tokens)} 把")
        return {"token": new_token, "revoked_count": len(old_tokens)}

    def list_user_fields(self, actor_id: str):
        """列出某 actor 名下的场。"""
        sql = "SELECT owner_id, name, actor_id FROM ains_owner_masters WHERE actor_id = %s ORDER BY created_at"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (actor_id,))
            return cur.fetchall()

    def list_all_fields(self, limit: int = 500):
        """列出全部场（admin 视图）。"""
        sql = """
            SELECT owner_id, name, actor_id,
                   (SELECT COUNT(*) FROM ains_active_nodes n WHERE n.owner_id = m.owner_id) AS node_count
            FROM ains_owner_masters m
            ORDER BY created_at ASC
            LIMIT %s
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (limit,))
            return cur.fetchall()

    def get_field_actor_ids(self, owner_id: str):
        """返回曾在该场留下副本的 actor 列表（用于级联删除副本）。"""
        sql = """
            SELECT DISTINCT w.actor_id
            FROM ains_user_weights w
            JOIN ains_active_nodes n ON n.serial_id = w.serial_id
            WHERE n.owner_id = %s
        """
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (owner_id,))
            return [r["actor_id"] for r in cur.fetchall()]

    def delete_actor_cascade(self, actor_id: str):
        """
        职责：注销 actor 并级联清理其名下场与所有用户副本。
        """
        owners = [o["owner_id"] for o in self.list_user_fields(actor_id)]
        for owner_id in owners:
            self.delete_owner_all(owner_id)
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM ains_user_weights WHERE actor_id = %s", (actor_id,))
            cur.execute("DELETE FROM ains_users WHERE actor_id = %s", (actor_id,))
        return owners

    def get_necropolis_content_readonly(self, node_id: str, serial_id=None):
        """
        职责：只读读取地宫中最新的全文（不写回活跃表）。
        用于观测者无权恢复主副本内容、但需要展示可见内容时。
        """
        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                if serial_id:
                    cur.execute(
                        "SELECT raw_content, raw_full_image_url, sealed_at FROM ains_archive_necropolis "
                        "WHERE serial_id = %s ORDER BY sealed_at DESC LIMIT 1",
                        (serial_id,),
                    )
                else:
                    cur.execute(
                        "SELECT raw_content, raw_full_image_url, sealed_at FROM ains_archive_necropolis "
                        "WHERE node_id = %s ORDER BY sealed_at DESC LIMIT 1",
                        (node_id,),
                    )
                return cur.fetchone()
        except Exception as e:
            print(f"[地宫只读] 读取失败 node={node_id}: {e}")
            return None

    def list_owners(self, actor_id: str):
        sql = "SELECT owner_id, name FROM ains_owner_masters WHERE actor_id = %s ORDER BY created_at"
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, (actor_id,))
            return cur.fetchall()

    def owner_exists(self, owner_id: str) -> bool:
        """判断场（owner_id）是否已有人创建（是否已有主人）。"""
        sql = "SELECT 1 FROM ains_owner_masters WHERE owner_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (owner_id,))
            return cur.fetchone() is not None

    def create_owner(self, owner_id: str, name: str, actor_id: str):
        sql = "INSERT INTO ains_owner_masters (owner_id, name, actor_id) VALUES (%s, %s, %s)"
        with self.conn.cursor() as cur:
            cur.execute(sql, (owner_id, name, actor_id))

    def rename_owner(self, owner_id: str, name: str, actor_id: str):
        sql = "UPDATE ains_owner_masters SET name = %s, updated_at = now() WHERE owner_id = %s AND actor_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (name, owner_id, actor_id))

    def delete_owner(self, owner_id: str, actor_id: str):
        sql = "DELETE FROM ains_owner_masters WHERE owner_id = %s AND actor_id = %s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (owner_id, actor_id))

    def delete_owner_all(self, owner_id: str):
        """
        职责：彻底删除一个场。
        删除：活跃表(owner_id)、地宫表、用户权重表(靠外键级联)、场注册(ains_owner_masters)。
        并清除他场节点指向本场节点的 parent_id 引用（全局 + 用户私有两处）。
        返回：{"deleted_node_ids": [...], "affected_nodes": [{"node_id":.., "owner_id":..}, ...]}
        """
        # 1. 收集本场所有节点
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT node_id, serial_id FROM ains_active_nodes WHERE owner_id = %s", (owner_id,))
            nodes = cur.fetchall()
        node_ids = [n['node_id'] for n in nodes]
        serial_ids = [n['serial_id'] for n in nodes if n.get('serial_id') is not None]

        affected = {}  # node_id -> owner_id

        # 2. 清除跨场接触面：他场节点的 parent_id 引用了本场 node_id
        if node_ids:
            for nid in node_ids:
                like_pat = '%|' + nid + '|%'
                # 2a. 全局 ains_active_nodes.parent_id
                with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        "SELECT node_id, owner_id, parent_id FROM ains_active_nodes "
                        "WHERE owner_id != %s AND ('|' || COALESCE(parent_id,'') || '|') LIKE %s",
                        (owner_id, like_pat)
                    )
                    for row in cur.fetchall():
                        new_prev = [p for p in self._string_to_previous(row['parent_id']) if p != nid]
                        new_parent = self._previous_to_string(new_prev)
                        with self.conn.cursor() as cur2:
                            cur2.execute("UPDATE ains_active_nodes SET parent_id = %s WHERE node_id = %s", (new_parent, row['node_id']))
                        affected[row['node_id']] = row['owner_id']

                # 2b. 用户私有 ains_user_weights.parent_id
                with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        "SELECT w.actor_id, w.serial_id, w.parent_id, n.node_id, n.owner_id "
                        "FROM ains_user_weights w JOIN ains_active_nodes n ON n.serial_id = w.serial_id "
                        "WHERE n.owner_id != %s AND ('|' || COALESCE(w.parent_id,'') || '|') LIKE %s",
                        (owner_id, like_pat)
                    )
                    for row in cur.fetchall():
                        new_prev = [p for p in self._string_to_previous(row['parent_id']) if p != nid]
                        new_parent = self._previous_to_string(new_prev)
                        # 删除后若已无父节点，显式写空串，表示“副本明确无父节点”，避免回退主副本旧连线
                        stored_parent = new_parent if new_parent else ""
                        with self.conn.cursor() as cur2:
                            cur2.execute(
                                "UPDATE ains_user_weights SET parent_id = %s WHERE actor_id = %s AND serial_id = %s",
                                (stored_parent, row['actor_id'], row['serial_id'])
                            )
                        affected[row['node_id']] = row['owner_id']

        # 3. 删地宫表（按 serial_id 与 node_id 双保险）
        if serial_ids:
            with self.conn.cursor() as cur:
                cur.execute("DELETE FROM ains_archive_necropolis WHERE serial_id = ANY(%s)", (serial_ids,))
        if node_ids:
            with self.conn.cursor() as cur:
                cur.execute("DELETE FROM ains_archive_necropolis WHERE node_id = ANY(%s)", (node_ids,))

        # 4. 删活跃表（用户权重表靠外键 ON DELETE CASCADE 自动删）
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM ains_active_nodes WHERE owner_id = %s", (owner_id,))

        # 5. 删场注册
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM ains_owner_masters WHERE owner_id = %s", (owner_id,))

        return {
            "deleted_node_ids": node_ids,
            "affected_nodes": [{"node_id": k, "owner_id": v} for k, v in affected.items()],
        }

# 实例化单例
db = CausalDatabase()
