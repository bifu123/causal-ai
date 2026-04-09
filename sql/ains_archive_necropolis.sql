/*
 Navicat Premium Data Transfer

 Source Server         : 192.168.66.39
 Source Server Type    : PostgreSQL
 Source Server Version : 160013 (160013)
 Source Host           : 192.168.66.39:5432
 Source Catalog        : causal_ai_db
 Source Schema         : public

 Target Server Type    : PostgreSQL
 Target Server Version : 160013 (160013)
 File Encoding         : 65001

 Date: 10/04/2026 01:03:40
*/


-- ----------------------------
-- Table structure for ains_archive_necropolis
-- ----------------------------
DROP TABLE IF EXISTS "public"."ains_archive_necropolis";
CREATE TABLE "public"."ains_archive_necropolis" (
  "necropolis_id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "node_id" varchar(200) COLLATE "pg_catalog"."default" NOT NULL,
  "raw_content" text COLLATE "pg_catalog"."default" NOT NULL,
  "raw_full_image_url" text COLLATE "pg_catalog"."default",
  "holographic_bundle" jsonb,
  "sealed_at" timestamptz(6) DEFAULT now(),
  "serial_id" int4
)
;
COMMENT ON COLUMN "public"."ains_archive_necropolis"."necropolis_id" IS '地宫ID';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."node_id" IS '节点ID';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."raw_content" IS '全量原始记录';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."raw_full_image_url" IS '原始高清外显子路径';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."holographic_bundle" IS '全息关联数据包';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."sealed_at" IS '封存时间';
COMMENT ON COLUMN "public"."ains_archive_necropolis"."serial_id" IS '根节点ID（首贞ID）';

-- ----------------------------
-- Primary Key structure for table ains_archive_necropolis
-- ----------------------------
ALTER TABLE "public"."ains_archive_necropolis" ADD CONSTRAINT "ains_archive_necropolis_pkey" PRIMARY KEY ("necropolis_id");
