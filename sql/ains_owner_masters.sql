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

 Date: 20/10/2026 09:54:57
*/


-- ----------------------------
-- Table structure for ains_owner_masters
-- ----------------------------
DROP TABLE IF EXISTS "public"."ains_owner_masters";
CREATE TABLE "public"."ains_owner_masters" (
  "owner_id" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "name" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "actor_id" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Indexes structure for table ains_owner_masters
-- ----------------------------
CREATE INDEX "idx_owner_masters_actor" ON "public"."ains_owner_masters" USING btree (
  "actor_id" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);

-- ----------------------------
-- Primary Key structure for table ains_owner_masters
-- ----------------------------
ALTER TABLE "public"."ains_owner_masters" ADD CONSTRAINT "ains_owner_masters_pkey" PRIMARY KEY ("owner_id");
