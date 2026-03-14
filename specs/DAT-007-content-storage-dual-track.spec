spec: task
name: "DAT-007-content-storage-dual-track"
tags: [data, storage, p0]
---

## 意图

建立“数据库主索引 + 对象存储原文快照”的双轨存储，兼顾检索效率、QMD/RAG复用与溯源能力。

## 已定决策

- 结构化字段写数据库（检索、筛选、排序）。
- 原始正文和抓取快照写对象存储（MinIO）。
- 数据库仅保存对象存储引用与摘要，不直接保存大体量原文。

## 边界

### 允许修改
- `apps/gather/**`
- `apps/web/**`（仅数据读取适配）
- `apps/worker/**`（仅消费字段兼容）
- Prisma schema 与迁移文件

### 禁止做
- 不切换基础设施（继续使用本地 MinIO）。
- 不改用户报告编辑器交互。

## 完成条件

场景: 新内容按双轨方式落库
  测试:
    包: apps/gather
    过滤: test_content_persist_dual_track
  假设 抓取内容通过关键词过滤
  当 执行内容持久化
  那么 数据库存在结构化记录且对象存储存在原文快照

场景: 前端可通过引用读取正文
  测试:
    包: apps/web
    过滤: test_content_detail_loads_body_from_object_storage
  假设 内容详情页请求正文
  当 读取数据库记录中的对象引用
  那么 可返回完整正文并保持原有展示能力

场景: 失败时不产生悬挂脏数据
  测试:
    包: apps/gather
    过滤: test_content_persist_transactional_integrity
  假设 对象存储上传失败
  当 执行持久化流程
  那么 返回错误且数据库不保留不可用引用

## 排除范围

- 不做历史数据全量回填。
- 不做跨云对象存储兼容层。
