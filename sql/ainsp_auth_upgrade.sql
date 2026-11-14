/*
    鉴权升级迁移脚本（可重复执行，幂等）
    对应 鉴权升级方案.txt 第 3 节：用户表 / 场主表 / 用户副本连线

    说明：
      1. 程序启动时 core/database.py::_init_db 也会自动执行这些语句，
         本文件用于手工迁移或 DBA 复核。
      2. 不做任何数据清理（GC 交由后续 DB 触发器处理）。
*/

-- ① 用户表：新增 is_admin
ALTER TABLE IF EXISTS public.ains_users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- ② 用户副本表：新增因果连线（副本为宗：NULL 回退主副本，'' 表示明确无父节点）
ALTER TABLE IF EXISTS public.ains_user_weights
    ADD COLUMN IF NOT EXISTS parent_id VARCHAR(500);

-- ③ 活跃事件表：分享标记（默认私有，仅场主 / admin 可见）
ALTER TABLE IF EXISTS public.ains_active_nodes
    ADD COLUMN IF NOT EXISTS is_share BOOLEAN DEFAULT FALSE;

-- ④ 账号表补建（旧库可能缺失）
CREATE TABLE IF NOT EXISTS public.ains_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id VARCHAR(64) NOT NULL UNIQUE,
    token TEXT,
    password VARCHAR(255),
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ains_owner_masters (
    owner_id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ⑤ 首个管理员（可选）：把已存在的 actor 提升为 admin
-- UPDATE public.ains_users SET is_admin = TRUE WHERE actor_id = '415135222';