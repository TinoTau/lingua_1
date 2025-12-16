# 项目迁移文档

## 迁移概述

项目已按照产品设计重新组织，将 `expired/` 文件夹中的备份代码迁移到新的目录结构中。

## 新的目录结构

```
lingua_1/
├── webapp/                    # Web 客户端
│   ├── web-client/           # 实际项目目录
│   ├── mobile-app/           # 移动应用（参考）
│   └── docs/                 # Web 客户端文档
│
├── central_server/            # 中央服务器
│   ├── scheduler/            # 调度服务器
│   ├── api-gateway/          # API 网关
│   ├── model-hub/            # 模型库服务
│   └── docs/                 # 中央服务器文档
│
├── electron_node/             # Electron 节点客户端
│   ├── electron-node/        # Electron 应用
│   ├── node-inference/       # 节点推理服务（Rust）
│   ├── services/             # Python 服务（NMT、TTS、YourTTS）
│   └── docs/                 # 节点客户端文档
│
├── scripts/                   # 启动脚本
├── shared/                    # 共享代码（协议定义等）
├── docs/                      # 项目级文档
└── expired/                   # 备份代码（旧版本）
```

## 迁移内容

### Web 客户端 (webapp)

- **源代码**: `expired/web-client/` → `webapp/web-client/`
- **文档**: `expired/docs/webClient/` → `webapp/docs/webClient/`
- **其他文档**: `expired/docs/webRTC/` → `webapp/docs/webRTC/`
- **状态**: ✅ 迁移完成，测试通过（114 个测试全部通过）

详细迁移内容请参考 `webapp/docs/MIGRATION.md`。

### 中央服务器 (central_server)

- **调度服务器**: `expired/scheduler/` → `central_server/scheduler/`
- **API 网关**: `expired/api-gateway/` → `central_server/api-gateway/`
- **模型库服务**: `expired/model-hub/` → `central_server/model-hub/`
- **文档**: `expired/docs/scheduler/` → `central_server/docs/scheduler/`
- **状态**: ✅ 迁移完成，测试通过（106+ 个测试通过）

详细迁移内容请参考 `central_server/docs/MIGRATION.md`。

### Electron 节点客户端 (electron_node)

- **Electron 应用**: `expired/electron-node/` → `electron_node/electron-node/`
- **节点推理服务**: `expired/node-inference/` → `electron_node/services/node-inference/`
- **Python 服务**: `expired/services/` → `electron_node/services/`
- **文档**: `expired/docs/electron_node/` → `electron_node/docs/electron_node/`
- **状态**: ✅ 迁移完成，测试通过（核心功能 100% 通过）

详细迁移内容请参考 `electron_node/docs/MIGRATION.md`。

## 路径调整

### 启动脚本更新

所有启动脚本已更新为新的路径结构：

- **Web 客户端**: `scripts/start_web_client.ps1`
  - 路径: `webapp/web-client`
  - 日志: `webapp/web-client/logs/`

- **调度服务器**: `scripts/start_scheduler.ps1`
  - 路径: `central_server/scheduler`
  - 日志: `central_server/scheduler/logs/`

- **API 网关**: `scripts/start_api_gateway.ps1`
  - 路径: `central_server/api-gateway`
  - 日志: `central_server/api-gateway/logs/`

- **模型库服务**: `scripts/start_model_hub.ps1`
  - 路径: `central_server/model-hub`
  - 日志: `central_server/model-hub/logs/`

### 日志路径调整

所有服务的日志路径都调整为相对路径（相对于项目根目录）：

- ✅ Web 客户端: `webapp/web-client/logs/`
- ✅ 调度服务器: `central_server/scheduler/logs/`
- ✅ API 网关: `central_server/api-gateway/logs/`
- ✅ 模型库服务: `central_server/model-hub/logs/`
- ✅ 节点推理服务: `electron_node/services/node-inference/logs/`
- ✅ Python 服务: `electron_node/services/*/logs/`

### 配置文件路径调整

- ✅ 所有服务使用相对路径
- ✅ 日志文件使用相对路径
- ✅ 模型文件路径使用相对路径

## 迁移验证

### Web 客户端验证

- ✅ 项目完整性检查通过
- ✅ 114 个单元测试全部通过
- ✅ 服务可以正常启动
- ✅ 日志文件正常生成

### 中央服务器验证

- ✅ 项目完整性检查通过
- ✅ 106+ 个单元测试通过
- ✅ 服务可以正常启动
- ✅ 日志文件正常生成

### Electron 节点客户端验证

- ✅ 项目完整性检查通过
- ✅ 核心功能测试 100% 通过（28/28）
- ✅ 模块化功能测试 100% 通过（22/22）
- ✅ 服务可以正常启动
- ✅ 日志文件正常生成

## 迁移后的文档结构

### Web 客户端文档 (webapp/docs/)

- `webClient/` - Web 客户端相关文档
- `webRTC/` - WebRTC 相关文档
- `IOS/` - iOS 客户端设计文档（参考）
- `api_gateway/` - API 网关文档（参考）
- `QUICK_START.md` - 快速开始指南
- `README.md` - 文档索引
- `MIGRATION.md` - 迁移文档

### 中央服务器文档 (central_server/docs/)

- `scheduler/` - 调度服务器文档
- `api_gateway/` - API 网关文档
- `modelManager/` - 模型管理文档
- `QUICK_START.md` - 快速开始指南
- `README.md` - 文档索引
- `MIGRATION.md` - 迁移文档

### 项目级文档 (docs/)

- `logging/` - 日志和可观测性文档
- `project_management/` - 项目管理文档
- `reference/` - 参考文档
- `testing/` - 测试文档
- `PROJECT_MIGRATION.md` - 项目迁移文档（本文档）

## 相关文档

- **项目重组指南**: `../PROJECT_REORGANIZATION_GUIDE.md`
- **Web 客户端迁移**: `../webapp/docs/MIGRATION.md`
- **中央服务器迁移**: `../central_server/docs/MIGRATION.md`
- **Electron 节点客户端迁移**: `../electron_node/docs/MIGRATION.md`
- **Web 客户端文档**: `../webapp/docs/README.md`
- **中央服务器文档**: `../central_server/docs/README.md`
- **Electron 节点客户端文档**: `../electron_node/docs/README.md`

## 迁移日期

2025-01-XX

## 注意事项

1. ✅ 所有文件都已正确迁移
2. ✅ 路径引用已更新
3. ✅ 启动脚本已更新
4. ✅ 配置文件已更新
5. ✅ 日志路径已调整为相对路径
6. ✅ 测试已通过验证
