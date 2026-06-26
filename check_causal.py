import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "192.168.66.39"),
    "database": os.getenv("DB_DATABASE", "causal_ai_db"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "Shift962512"),
    "port": os.getenv("DB_PORT", 5432)
}

conn = psycopg2.connect(**DB_CONFIG)
conn.set_client_encoding('UTF8')

sql = """
SELECT node_id, parent_id
FROM ains_active_nodes
WHERE node_id IN ('A节点：时光的旧物', 'B节点：科技浪潮下的创造重塑', 'C节点：岁月的留痕')
"""

with conn.cursor(cursor_factory=RealDictCursor) as cur:
    cur.execute(sql)
    nodes = cur.fetchall()
    for node in nodes:
        print(f"Node: {node['node_id']}, Parent: {node['parent_id']}")