/*
 Navicat Premium Data Transfer
 Target Server Type    : PostgreSQL
 Target Server Version : 160013
 File Encoding         : 65001
 Description: 地宫档案层 - 封存原始全息证据
*/

-- ============================================================
-- 【第 2 步】地宫档案表 (ains_archive_necropolis)
-- ============================================================
DROP TABLE IF EXISTS "public"."ains_archive_necropolis" CASCADE;
CREATE TABLE "public"."ains_archive_necropolis" (
  "necropolis_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "node_id" varchar(200) COLLATE "pg_catalog"."default" NOT NULL,
  "raw_content" text COLLATE "pg_catalog"."default" NOT NULL,
  "raw_full_image_url" text COLLATE "pg_catalog"."default",
  "holographic_bundle" jsonb,
  "sealed_at" timestamptz(6) DEFAULT now(),
  "serial_id" int4
);

-- 字段注释
COMMENT ON COLUMN "public"."ains_archive_necropolis"."necropolis_id" IS '地宫ID';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."node_id" IS '节点ID';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."raw_content" IS '全量原始记录';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."raw_full_image_url" IS '原始高清外显子路径';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."holographic_bundle" IS '全息关联数据包';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."sealed_at" IS '封存时间';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."serial_id" IS '根节点ID（首贞ID）';

-- 主键
ALTER TABLE "public"."ains_archive_necropolis" ADD CONSTRAINT "ains_archive_necropolis_pkey" PRIMARY KEY ("necropolis_id");

-- 🔥 地宫层核心：全量原始记录的中文全文索引（职责：底层证据追溯）
CREATE INDEX "idx_ains_necropolis_raw_fts_zh" ON "public"."ains_archive_necropolis" USING gin (to_tsvector('chinese', "raw_content"));