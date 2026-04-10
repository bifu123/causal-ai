/*
 Navicat Premium Data Transfer
 Target Server Type    : PostgreSQL
 Target Server Version : 160013
 File Encoding         : 65001
 Description: 用户权重层 - 关联活跃节点，实现动态存活职责
*/

-- ============================================================
-- 【第 3 步】用户权重表 (ains_user_weights)
-- ============================================================
DROP TABLE IF EXISTS "public"."ains_user_weights" CASCADE;
CREATE TABLE "public"."ains_user_weights" (
  "actor_id" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "serial_id" int4 NOT NULL,
  "survival_weight" numeric(18,17) NOT NULL DEFAULT 1.0,
  "last_accessed" timestamp(6) DEFAULT CURRENT_TIMESTAMP
);

-- 字段注释已通过结构隐含，可按需补充 COMMENT ON COLUMN
COMMENT ON TABLE "public"."ains_user_weights" IS '用户权重表：管理不同意志主体对因果节点的关注权重';

-- 权重层索引职责
CREATE INDEX "idx_user_weights_actor" ON "public"."ains_user_weights" USING btree (
  "actor_id" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_user_weights_last_accessed" ON "public"."ains_user_weights" USING btree (
  "last_accessed" "pg_catalog"."timestamp_ops" ASC NULLS LAST
);
CREATE INDEX "idx_user_weights_serial" ON "public"."ains_user_weights" USING btree (
  "serial_id" "pg_catalog"."int4_ops" ASC NULLS LAST
);

-- 权重层外键职责关联
ALTER TABLE "public"."ains_user_weights" ADD CONSTRAINT "ains_user_weights_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "public"."ains_active_nodes" ("serial_id") ON DELETE CASCADE ON UPDATE NO ACTION;