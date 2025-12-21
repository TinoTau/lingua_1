# 项目文档

本文档目录包含 Lingua 项目的所有文档。

## 文档结构

### 项目级文档

- **系统架构**: `SYSTEM_ARCHITECTURE.md` - 系统架构文档（三层架构、三个客户端详解）⭐ **重要**
- **项目结构**: `PROJECT_STRUCTURE.md` - 项目目录结构和路径说明
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

所有模块文档已统一移动到 `docs/` 目录下，避免多层嵌套路径。

### Web 客户端

- **位置**: `web_client/`
- **文档索引**: [web_client/README.md](./web_client/README.md)

### 中央服务器

- **位置**: `central_server/`
- **文档索引**: [central_server/README.md](./central_server/README.md)

### Electron 节点客户端

- **位置**: `electron_node/`
- **文档索引**: [electron_node/README.md](./electron_node/README.md)

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
- **文档索引**: [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)
- **产品文档索引**: [PRODUCT_DOCUMENTATION_INDEX.md](./PRODUCT_DOCUMENTATION_INDEX.md)
- **Web 客户端文档**: [web_client/README.md](./web_client/README.md)
- **中央服务器文档**: [central_server/README.md](./central_server/README.md)
- **Electron Node 文档**: [electron_node/README.md](./electron_node/README.md)
