import asyncpg
from pgvector.asyncpg import register_vector
import asyncio

async def run_db_update():
    conn = await asyncpg.connect(
        host="192.168.66.39",
        user="postgres",
        password="Shift962512",
        database="causal_ai_db"
    )
    print("Connected to DB.")
    
    # 增加跨场边界可见性字段，默认值从 TRUE 改为 FALSE
    await conn.execute("ALTER TABLE ains_active_nodes ALTER COLUMN is_share SET DEFAULT FALSE;")
    # 为了追溯历史数据，把已经被设置为 NULL/TRUE 的全部更新为 FALSE 吗？
    # 等等，如果之前是 DEFAULT TRUE，现在改回 DEFAULT FALSE，那么最好也改一下旧数据以保证数据安全。
    await conn.execute("UPDATE ains_active_nodes SET is_share = FALSE WHERE is_share IS NULL OR is_share = TRUE;")
    print("Added is_share to ains_active_nodes.")
    
    # 增加观察者私有前因字段
    await conn.execute("ALTER TABLE ains_user_weights ADD COLUMN IF NOT EXISTS parent_id VARCHAR(500);")
    print("Added parent_id to ains_user_weights.")
    
    await conn.close()

if __name__ == "__main__":
    asyncio.run(run_db_update())
