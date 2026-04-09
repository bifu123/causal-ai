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

 Date: 10/04/2026 01:03:02
*/


-- ----------------------------
-- Table structure for ains_active_nodes
-- ----------------------------
DROP TABLE IF EXISTS "public"."ains_active_nodes";
CREATE TABLE "public"."ains_active_nodes" (
  "serial_id" int4 NOT NULL DEFAULT nextval('ains_active_nodes_serial_id_seq'::regclass),
  "node_id" varchar(100) COLLATE "pg_catalog"."default" NOT NULL,
  "parent_id" varchar(100) COLLATE "pg_catalog"."default",
  "block_tag" varchar(10) COLLATE "pg_catalog"."default",
  "action_tag" varchar(10) COLLATE "pg_catalog"."default",
  "actor_id" varchar(50) COLLATE "pg_catalog"."default",
  "necropolis_id" uuid,
  "semantic_vector" "public"."vector",
  "visual_vector" "public"."vector",
  "semantic_fingerprint" int8,
  "event_tuple" text COLLATE "pg_catalog"."default",
  "full_image_url" text COLLATE "pg_catalog"."default",
  "thumb_image_blob" bytea,
  "current_pixel_res" int4 DEFAULT 1024,
  "survival_weight" numeric DEFAULT 1.0000,
  "vision_level" int4 DEFAULT 0,
  "compression_level" int4 DEFAULT 0,
  "last_accessed" timestamptz(6) DEFAULT now(),
  "created_at" timestamptz(6) DEFAULT now(),
  "owner_id" varchar(100) COLLATE "pg_catalog"."default"
)
;
COMMENT ON COLUMN "public"."ains_active_nodes"."serial_id" IS '物理序号：祭祀的先后次序';
COMMENT ON COLUMN "public"."ains_active_nodes"."node_id" IS '意志标识 - 用户手动输入，如 辛亥-征伐-方国';
COMMENT ON COLUMN "public"."ains_active_nodes"."parent_id" IS '原始亲爹 - 上一场卜问的遗泽';
COMMENT ON COLUMN "public"."ains_active_nodes"."block_tag" IS '因缘标签：因、果、相';
COMMENT ON COLUMN "public"."ains_active_nodes"."action_tag" IS '动作标签：贞、又贞、对贞';
COMMENT ON COLUMN "public"."ains_active_nodes"."actor_id" IS '意志主体：商王、贞人、将领';
COMMENT ON COLUMN "public"."ains_active_nodes"."necropolis_id" IS '指向地宫表的唯一外键';
COMMENT ON COLUMN "public"."ains_active_nodes"."semantic_vector" IS '语义向量：用于文本 RAG 感应';
COMMENT ON COLUMN "public"."ains_active_nodes"."visual_vector" IS '视觉向量：用于全息视觉特征对比';
COMMENT ON COLUMN "public"."ains_active_nodes"."semantic_fingerprint" IS '逻辑哈希：基于 SPO 提取';
COMMENT ON COLUMN "public"."ains_active_nodes"."event_tuple" IS '动态笔记 (Event Tuple) - 随权重降级：原文 -> 摘要 -> 二元组 -> 因果桩';
COMMENT ON COLUMN "public"."ains_active_nodes"."full_image_url" IS '【外显子】高清路径。权重 < 0.9 入土时物理置空并移交地宫。';
COMMENT ON COLUMN "public"."ains_active_nodes"."thumb_image_blob" IS '【内显子】缩略图。随权重同步重采样压缩 (1024->256->64->8->0)。';
COMMENT ON COLUMN "public"."ains_active_nodes"."current_pixel_res" IS '当前活跃层视觉分辨率';
COMMENT ON COLUMN "public"."ains_active_nodes"."survival_weight" IS '渐忘状态机权重';
COMMENT ON COLUMN "public"."ains_active_nodes"."vision_level" IS '视觉等级：0-高清, 1-缩略, 2-像素化, 3-盲化';
COMMENT ON COLUMN "public"."ains_active_nodes"."compression_level" IS '压缩等级：0-初生, 1-摘要, 2-骨架, 3-化桩';
COMMENT ON COLUMN "public"."ains_active_nodes"."last_accessed" IS '最后访问时间';
COMMENT ON COLUMN "public"."ains_active_nodes"."created_at" IS '创建时间';
COMMENT ON COLUMN "public"."ains_active_nodes"."owner_id" IS '本事件的主权人';
COMMENT ON TABLE "public"."ains_active_nodes" IS '活跃节点表：感知与笔记层 - 承载当下的卜问现场，保持极致轻量，仅存向量指纹、动态笔记与缩放后的视觉残骸';

-- ----------------------------
-- Indexes structure for table ains_active_nodes
-- ----------------------------
CREATE INDEX "idx_ains_s_awareness" ON "public"."ains_active_nodes" (
  "semantic_vector" "public"."vector_cosine_ops" ASC NULLS LAST
);
CREATE INDEX "idx_ains_v_awareness" ON "public"."ains_active_nodes" (
  "visual_vector" "public"."vector_cosine_ops" ASC NULLS LAST
);
CREATE INDEX "idx_metabolism_worker" ON "public"."ains_active_nodes" USING btree (
  "survival_weight" "pg_catalog"."numeric_ops" ASC NULLS LAST
) WHERE compression_level < 3;

-- ----------------------------
-- Uniques structure for table ains_active_nodes
-- ----------------------------
ALTER TABLE "public"."ains_active_nodes" ADD CONSTRAINT "ains_active_nodes_node_id_key" UNIQUE ("node_id");

-- ----------------------------
-- Primary Key structure for table ains_active_nodes
-- ----------------------------
ALTER TABLE "public"."ains_active_nodes" ADD CONSTRAINT "ains_active_nodes_pkey" PRIMARY KEY ("serial_id");
