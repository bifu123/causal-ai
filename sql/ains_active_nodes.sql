/*
 Navicat Premium Data Transfer
 Target Server Type    : PostgreSQL
 Target Server Version : 160013
 File Encoding         : 65001
 Description: 活跃节点层 - 包含基础扩展配置与中文分词职责优化
*/

-- ============================================================
-- 【第 0 步】核心扩展与中文分词职责配置
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;    
CREATE EXTENSION IF NOT EXISTS zhparser;  

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'chinese') THEN
        CREATE TEXT SEARCH CONFIGURATION chinese (PARSER = zhparser);
        -- 核心优化：补全词性映射。包含：名词(n), 动词(v), 形容词(a), 成语(i), 叹词(e), 习用语(l)
        -- 以及关键的人名(nr), 地名(ns), 机构名(nt), 其他专名(nz), 未知词(x)
        -- 确保“商王”、“罗化铃”、“平定村”等专有名词不被切碎丢失
        ALTER TEXT SEARCH CONFIGURATION chinese ADD MAPPING FOR n,v,a,i,e,l,nr,ns,nt,nz,x WITH simple;
    END IF;
END
$$;

-- ============================================================
-- 【第 1 步】活跃节点表 (ains_active_nodes)
-- ============================================================
DROP TABLE IF EXISTS "public"."ains_active_nodes" CASCADE;
CREATE TABLE "public"."ains_active_nodes" (
  "serial_id" int4 NOT NULL DEFAULT nextval('ains_active_nodes_serial_id_seq'::regclass),
  "node_id" varchar(500) COLLATE "pg_catalog"."default" NOT NULL,
  "parent_id" varchar(500) COLLATE "pg_catalog"."default",
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
  "owner_id" varchar(500) COLLATE "pg_catalog"."default"
);

-- 字段注释
COMMENT ON TABLE "public"."ains_active_nodes" IS '活跃节点表：感知与笔记层 - 承载当下的卜问现场，保持极致轻量，仅存向量指纹、动态笔记与缩放后的视觉残骸';
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

-- 索引职责构建
CREATE INDEX "idx_ains_s_awareness" ON "public"."ains_active_nodes" ("semantic_vector" "public"."vector_cosine_ops" ASC NULLS LAST);
CREATE INDEX "idx_ains_v_awareness" ON "public"."ains_active_nodes" ("visual_vector" "public"."vector_cosine_ops" ASC NULLS LAST);
CREATE INDEX "idx_metabolism_worker" ON "public"."ains_active_nodes" USING btree ("survival_weight" ASC NULLS LAST) WHERE compression_level < 3;

-- 🔥 活跃层核心：优化后的 zhparser 中文全文对贞索引
CREATE INDEX "idx_ains_nodes_tuple_fts_zh" ON "public"."ains_active_nodes" USING gin (to_tsvector('chinese', "event_tuple"));

-- 约束
ALTER TABLE "public"."ains_active_nodes" ADD CONSTRAINT "ains_active_nodes_node_id_key" UNIQUE ("node_id");
ALTER TABLE "public"."ains_active_nodes" ADD CONSTRAINT "ains_active_nodes_pkey" PRIMARY KEY ("serial_id");
