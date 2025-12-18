# 中央服务器文档索引

本目录聚焦 `central_server/` 相关文档（Scheduler / API Gateway / Model Hub / 模型管理方案）。

> 说明：此前版本的索引中引用了 `ARCHITECTURE.md` / `PROTOCOLS.md` / `project_management/` / `testing/` 等路径，
> 但这些文件/目录并不位于 `central_server/docs/` 内，容易造成断链和误解；本索引已按当前代码与目录结构校正。

## 快速开始

- `QUICK_START.md`：启动顺序与最小可用验证
- `MIGRATION.md`：迁移与路径调整说明
- `OVERVIEW.md`：central_server 组件概览（原 `central_server/README.md`）

## 测试与项目

- `testing/TEST_GUIDE.md`：测试运行指南
- `testing/TEST_STATUS.md`：测试状态概览
- `project/PROJECT_COMPLETENESS.md`：项目完整性检查报告

## 组件文档

### Scheduler（调度服务器）

- `scheduler/README.md`
- `scheduler/DISPATCHER_OPTIMIZATION_PLAN.md`
- **Phase 2（多实例 + Redis）**
  - 进度记录：`project/Scheduler_Phase2_开发进度记录_2025-12-19.md`
  - 容量规划与 Redis 设计：`project/Scheduler_扩展与容量规划说明_含Redis设计.md`
  - 实现总览（代码内文档）：`../scheduler/docs/phase2_implementation.md`
  - Streams/DLQ 运维：`../scheduler/docs/phase2_streams_ops.md`
  - Cluster 一键验收脚本：`../scheduler/scripts/phase2_cluster_acceptance.ps1`

### API Gateway（对外网关）

- `api_gateway/README.md`
- `api_gateway/PUBLIC_API.md`
- `api_gateway/PUBLIC_API_DESIGN.md`
- `api_gateway/PUBLIC_API_SPEC.md`
- `api_gateway/PUBLIC_API_STATUS.md`

### 模型管理方案（v3）

- `modelManager/README.md`
- `modelManager/公司模型库与Electron客户端模型管理统一技术方案.md`

### Model Hub（模型库服务）

- `model_hub/README.md`

## 相关入口（代码仓库内）

- `../README.md`：central_server 组件概览（含各服务启动命令）
- `../model-hub/README.md`：Model Hub 详细说明（FastAPI 服务与端点）
