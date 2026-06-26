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
SELECT a.node_id as source, b.node_id as target,
       1 - (a.semantic_vector <=> b.semantic_vector) as similarity
FROM ains_active_nodes a
JOIN ains_active_nodes b ON a.node_id < b.node_id
WHERE a.node_id IN (%s, %s, %s)
  AND b.node_id IN (%s, %s, %s)
"""

nodes = ('A节点：时光的旧物', 'B节点：科技浪潮下的创造重塑', 'C节点：岁月的留痕')
params = nodes + nodes

with conn.cursor(cursor_factory=RealDictCursor) as cur:
    cur.execute(sql, params)
    links = cur.fetchall()
    for link in links:
        print(f"{link['source']} <-> {link['target']}: {link['similarity']}")