# 项目文档

本文档目录包含 Lingua 项目的所有文档。

## 文档结构

### 项目级文档

- **项目迁移**: `PROJECT_MIGRATION.md` - 项目迁移和路径调整文档

### 日志和可观测性

- `logging/` - 日志和可观测性相关文档
  - 日志规范
  - 可观测性配置
  - 日志使用指南

### 项目管理

- `project_management/` - 项目管理相关文档
  - 开发计划
  - 项目状态
  - 已完成/待完成项目

### 参考文档

- `reference/` - 参考文档
  - 架构设计参考
  - 技术方案参考
  - 状态对比

### 测试文档

- `testing/` - 测试相关文档
  - 端到端测试指南
  - 测试策略

## 各组件文档

### Web 客户端

- **位置**: `../webapp/docs/`
- **迁移文档**: `../webapp/docs/MIGRATION.md`
- **文档索引**: `../webapp/docs/README.md`

### 中央服务器

- **位置**: `../central_server/docs/`
- **迁移文档**: `../central_server/docs/MIGRATION.md`
- **文档索引**: `../central_server/docs/README.md`

### Electron 节点客户端

- **位置**: `../electron_node/docs/`
- **迁移文档**: `../electron_node/docs/MIGRATION.md`
- **文档索引**: `../electron_node/docs/README.md`
- **项目完整性**: `../electron_node/PROJECT_COMPLETENESS.md`
- **测试状态**: `../electron_node/TEST_STATUS.md`

## 项目结构

```
lingua_1/
├── webapp/                    # Web 客户端
│   └── docs/                 # Web 客户端文档
├── central_server/            # 中央服务器
│   └── docs/                 # 中央服务器文档
├── electron_node/             # Electron 节点客户端
│   └── docs/                 # 节点客户端文档
├── scripts/                   # 启动脚本
├── shared/                    # 共享代码
├── docs/                      # 项目级文档（本目录）
└── expired/                   # 备份代码（旧版本）
```

## 快速参考

- **项目迁移**: `PROJECT_MIGRATION.md`
- **Web 客户端文档**: `../webapp/docs/README.md`
- **中央服务器文档**: `../central_server/docs/README.md`
- **项目重组指南**: `../PROJECT_REORGANIZATION_GUIDE.md`
