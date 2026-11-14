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
SELECT serial_id, node_id
FROM ains_active_nodes
WHERE semantic_vector IS NOT NULL
LIMIT 5
"""

with conn.cursor(cursor_factory=RealDictCursor) as cur:
    cur.execute(sql)
    nodes = cur.fetchall()
    for node in nodes:
        print(f"Serial ID: {node['serial_id']}, Node ID: {node['node_id']}")