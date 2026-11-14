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

 Date: 20/10/2026 09:55:05
*/


-- ----------------------------
-- Table structure for ains_users
-- ----------------------------
DROP TABLE IF EXISTS "public"."ains_users";
CREATE TABLE "public"."ains_users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "actor_id" varchar(64) COLLATE "pg_catalog"."default" NOT NULL,
  "token" text COLLATE "pg_catalog"."default",
  "password" varchar(255) COLLATE "pg_catalog"."default",
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now()
)
;

-- ----------------------------
-- Uniques structure for table ains_users
-- ----------------------------
ALTER TABLE "public"."ains_users" ADD CONSTRAINT "ains_users_actor_id_key" UNIQUE ("actor_id");

-- ----------------------------
-- Primary Key structure for table ains_users
-- ----------------------------
ALTER TABLE "public"."ains_users" ADD CONSTRAINT "ains_users_pkey" PRIMARY KEY ("id");
