# 中央服务器文档

本文档目录包含中央服务器的所有文档，已从 `central_server/docs/` 移动至此。

## 文档索引

### 快速开始
- [概览](./OVERVIEW.md) - 中央服务器组件概览
- [快速开始指南](./QUICK_START.md) - 启动顺序与最小可用验证

### Scheduler（调度服务器）
- [Scheduler 文档](./scheduler/README.md)
- [任务分发算法优化方案](./scheduler/DISPATCHER_OPTIMIZATION_PLAN.md)
- [Phase 2 实现文档](./scheduler/phase2_implementation.md) - 多实例 + Redis
- [Phase 2 Streams/DLQ 运维](./scheduler/phase2_streams_ops.md)
- [仪表盘说明](./scheduler/DASHBOARD.md)
- [GPU 需求说明](./scheduler/GPU_REQUIREMENT_EXPLANATION.md)

### API Gateway（对外网关）
- [API Gateway 文档](./api_gateway/README.md)
- [公共 API 设计](./api_gateway/PUBLIC_API_DESIGN.md)
- [公共 API 规范](./api_gateway/PUBLIC_API_SPEC.md)
- [公共 API 状态](./api_gateway/PUBLIC_API_STATUS.md)

### Model Hub（模型库服务）
- [Model Hub 文档](./model_hub/README.md)

### 模型管理
- [模型管理文档](./model_manager/README.md)
- [统一技术方案](./model_manager/公司模型库与Electron客户端模型管理统一技术方案.md)

### 项目文档
- [项目完整性](./project/PROJECT_COMPLETENESS.md)
- [Scheduler Phase 1 技术规范](./project/Scheduler_Phase1_补充技术规范与实现清单_v1.1.md)
- [Scheduler Phase 2 开发进度](./project/Scheduler_Phase2_开发进度记录_2025-12-19.md)
- [Scheduler Phase 2 决策补充](./project/Scheduler_Phase2_决策补充_v1.1_Instance_Job_Redis.md)
- [Scheduler Phase 2 推进建议](./project/Scheduler_Phase2_推进建议_决策版.md)
- [Scheduler 架构说明](./project/Scheduler_当前架构与Phase1拆分优化说明_决策版.md)
- [Scheduler 扩展与容量规划](./project/Scheduler_扩展与容量规划说明_含Redis设计.md)

### 测试文档
- [测试指南](../testing/END_TO_END_TESTING_GUIDE.md)
- [测试状态](../testing/SCHEDULER_PHASE2_PHASE3_STATUS_AND_VERIFICATION.md)

---

## 相关链接

- [项目根目录 README](../../README.md)
- [项目状态文档](../project_management/PROJECT_STATUS.md)
- [系统架构文档](../SYSTEM_ARCHITECTURE.md)

