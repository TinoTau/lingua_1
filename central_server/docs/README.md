# 中央服务器文档

本文档目录包含中央服务器（调度服务器、API 网关、模型库服务）的所有产品设计、说明和技术方案文档。

## 文档列表

### 架构设计
- `ARCHITECTURE.md` - 系统架构文档
- `ARCHITECTURE_ANALYSIS.md` - 架构分析与性能瓶颈评估

### 协议文档
- `PROTOCOLS.md` - 协议总览
- `PROTOCOLS_SESSION.md` - 会话协议
- `PROTOCOLS_NODE.md` - 节点协议
- `PROTOCOLS_IMPLEMENTATION.md` - 协议实现

### 调度服务器 (Scheduler)
- `scheduler/README.md` - 调度服务器文档
- `scheduler/DISPATCHER_OPTIMIZATION_PLAN.md` - 调度器优化计划

### API 网关 (API Gateway)
- `api_gateway/README.md` - API 网关文档
- `api_gateway/PUBLIC_API.md` - 对外开放 API 文档
- `api_gateway/PUBLIC_API_DESIGN.md` - API 设计文档
- `api_gateway/PUBLIC_API_SPEC.md` - API 规范
- `api_gateway/PUBLIC_API_STATUS.md` - API 实现状态

### 项目管理
- `project_management/` - 项目管理文档
  - `DEVELOPMENT_PLAN.md` - 开发计划
  - `PROJECT_STATUS.md` - 项目状态
  - `PROJECT_STATUS_COMPLETED.md` - 已完成项目
  - `PROJECT_STATUS_PENDING.md` - 待完成项目
  - `PROJECT_STATUS_TESTING.md` - 测试中项目

### 测试文档
- `testing/` - 测试文档
  - `END_TO_END_TESTING_GUIDE.md` - 端到端测试指南

## 快速参考

- **调度服务器**: Rust + Tokio + Axum
- **API 网关**: Rust + Tokio + Axum
- **模型库服务**: Python + FastAPI
- **项目位置**: `central_server/`

## 快速开始

- **快速开始指南**: `QUICK_START.md`
- **测试指南**: `../TEST_GUIDE.md`
- **项目完整性**: `../PROJECT_COMPLETENESS.md`
- **迁移文档**: 查看 `MIGRATION.md`
