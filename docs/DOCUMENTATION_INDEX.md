# 项目文档索引

> 所有模块文档已统一移动到 `docs/` 目录下，避免多层嵌套路径

## 文档结构

```
docs/
├── web_client/              # Web 客户端文档
├── central_server/          # 中央服务器文档
├── electron_node/           # Electron Node 客户端文档
├── project_management/     # 项目管理文档
├── testing/                # 测试文档
├── logging/                # 日志文档
├── architecture/           # 架构文档
└── reference/              # 参考文档
```

---

## 快速导航

### 项目状态
- [项目状态](./project_management/PROJECT_STATUS.md) - 项目状态概览
- [已完成功能](./project_management/PROJECT_STATUS_COMPLETED.md) - 已完成功能列表
- [待完成功能](./project_management/PROJECT_STATUS_PENDING.md) - 待完成功能列表

### 系统架构
- [系统架构](./SYSTEM_ARCHITECTURE.md) - 系统整体架构
- [项目结构](./PROJECT_STRUCTURE.md) - 项目目录结构

### Web 客户端
- [文档索引](./web_client/README.md)
- [架构设计](./web_client/ARCHITECTURE.md)
- [Phase 2 实现](./web_client/PHASE2_IMPLEMENTATION.md)
- [Phase 3 实现](./web_client/PHASE3_IMPLEMENTATION.md)
- [规模化规范](./web_client/SCALABILITY_SPEC.md)

### 中央服务器
- [文档索引](./central_server/README.md)
- [快速开始](./central_server/QUICK_START.md)
- [Scheduler Phase 2](./central_server/scheduler/phase2_implementation.md)
- [API Gateway](./central_server/api_gateway/README.md)
- [Model Hub](./central_server/model_hub/README.md)

### Electron Node 客户端
- [文档索引](./electron_node/README.md)
- [模块化功能](./electron_node/modular/README.md)
- [Electron Node 文档](./electron_node/electron_node/README.md)

---

## 按主题分类

### 开发文档
- [开发计划](./project_management/DEVELOPMENT_PLAN.md)
- [Web 客户端 Phase 3](./web_client/PHASE3_IMPLEMENTATION.md)
- [Scheduler Phase 2](./central_server/scheduler/phase2_implementation.md)

### 测试文档
- [测试报告链接](./project_management/PROJECT_STATUS_TESTING.md)
- [端到端测试指南](./testing/END_TO_END_TESTING_GUIDE.md)
- [Web 客户端测试指南](./web_client/TEST_RUN_GUIDE.md)

### 架构文档
- [系统架构](./SYSTEM_ARCHITECTURE.md)
- [Web 客户端架构](./web_client/ARCHITECTURE.md)
- [模块化架构](./electron_node/modular/LINGUA_完整技术说明书_v2.md)

---

## 文档更新说明

所有模块文档已从各自的 `docs/` 目录移动到项目根目录的 `docs/` 下：
- ✅ `webapp/web-client/docs/` → `docs/web_client/`
- ✅ `central_server/docs/` → `docs/central_server/`
- ✅ `electron_node/docs/` → `docs/electron_node/`

**优势**:
- 统一文档位置，避免多层嵌套
- 便于查找和维护
- 每个文档不超过500行，便于阅读

---

## 相关链接

- [项目根目录 README](../README.md)
- [产品文档索引](./PRODUCT_DOCUMENTATION_INDEX.md)

