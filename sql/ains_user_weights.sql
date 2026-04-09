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

 Date: 10/04/2026 01:03:52
*/


-- ----------------------------
-- Table structure for ains_user_weights
-- ----------------------------
DROP TABLE IF EXISTS "public"."ains_user_weights";
CREATE TABLE "public"."ains_user_weights" (
  "actor_id" varchar(255) COLLATE "pg_catalog"."default" NOT NULL,
  "serial_id" int4 NOT NULL,
  "survival_weight" numeric(18,17) NOT NULL DEFAULT 1.0,
  "last_accessed" timestamp(6) DEFAULT CURRENT_TIMESTAMP
)
;

-- ----------------------------
-- Indexes structure for table ains_user_weights
-- ----------------------------
CREATE INDEX "idx_user_weights_actor" ON "public"."ains_user_weights" USING btree (
  "actor_id" COLLATE "pg_catalog"."default" "pg_catalog"."text_ops" ASC NULLS LAST
);
CREATE INDEX "idx_user_weights_last_accessed" ON "public"."ains_user_weights" USING btree (
  "last_accessed" "pg_catalog"."timestamp_ops" ASC NULLS LAST
);
CREATE INDEX "idx_user_weights_serial" ON "public"."ains_user_weights" USING btree (
  "serial_id" "pg_catalog"."int4_ops" ASC NULLS LAST
);

-- ----------------------------
-- Foreign Keys structure for table ains_user_weights
-- ----------------------------
ALTER TABLE "public"."ains_user_weights" ADD CONSTRAINT "ains_user_weights_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "public"."ains_active_nodes" ("serial_id") ON DELETE CASCADE ON UPDATE NO ACTION;
