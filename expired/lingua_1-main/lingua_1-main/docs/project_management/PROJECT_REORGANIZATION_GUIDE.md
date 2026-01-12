# 项目重组指南

## 概述

本文档说明如何将 `expired/` 文件夹中的备份代码按照产品设计重新组织到新的目录结构中。

## 新的目录结构

```
lingua_1/
├── webapp/                    # Web 客户端
│   ├── src/                  # 源代码
│   ├── tests/                # 测试
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
│   ├── services/             # Python 和 Rust 服务
│   │   ├── node-inference/  # 节点推理服务（Rust）
│   │   ├── nmt_m2m100/      # NMT 服务（Python）
│   │   ├── piper_tts/       # TTS 服务（Python）
│   │   └── your_tts/        # YourTTS 服务（Python）
│   └── docs/                 # 节点客户端文档
│
├── scripts/                   # 启动脚本
├── shared/                    # 共享代码（协议定义等）
└── expired/                   # 备份代码（旧版本）
```

## 重组步骤

### 1. 创建主目录

```powershell
New-Item -ItemType Directory -Path webapp -Force
New-Item -ItemType Directory -Path central_server -Force
New-Item -ItemType Directory -Path electron_node -Force
```

### 2. 复制 Web 客户端

```powershell
Copy-Item -Path "expired\web-client" -Destination "webapp" -Recurse -Force
New-Item -ItemType Directory -Path "webapp\docs" -Force
Copy-Item -Path "expired\docs\webClient\*" -Destination "webapp\docs\" -Recurse -Force
```

### 3. 复制中央服务器组件

```powershell
Copy-Item -Path "expired\scheduler" -Destination "central_server\scheduler" -Recurse -Force
Copy-Item -Path "expired\api-gateway" -Destination "central_server\api-gateway" -Recurse -Force
Copy-Item -Path "expired\model-hub" -Destination "central_server\model-hub" -Recurse -Force

New-Item -ItemType Directory -Path "central_server\docs" -Force
Copy-Item -Path "expired\docs\scheduler" -Destination "central_server\docs\scheduler" -Recurse -Force
Copy-Item -Path "expired\docs\api_gateway" -Destination "central_server\docs\api_gateway" -Recurse -Force
Copy-Item -Path "expired\docs\ARCHITECTURE.md" -Destination "central_server\docs\" -Force
Copy-Item -Path "expired\docs\ARCHITECTURE_ANALYSIS.md" -Destination "central_server\docs\" -Force
Copy-Item -Path "expired\docs\PROTOCOLS*.md" -Destination "central_server\docs\" -Force
Copy-Item -Path "expired\docs\project_management" -Destination "central_server\docs\project_management" -Recurse -Force
Copy-Item -Path "expired\docs\testing" -Destination "central_server\docs\testing" -Recurse -Force
```

### 4. 复制 Electron 节点客户端组件

```powershell
Copy-Item -Path "expired\electron-node" -Destination "electron_node\electron-node" -Recurse -Force
Copy-Item -Path "expired\node-inference" -Destination "electron_node\node-inference" -Recurse -Force
Copy-Item -Path "expired\services" -Destination "electron_node\services" -Recurse -Force

New-Item -ItemType Directory -Path "electron_node\docs" -Force
Copy-Item -Path "expired\docs\electron_node" -Destination "electron_node\docs\electron_node" -Recurse -Force
Copy-Item -Path "expired\docs\node_inference" -Destination "electron_node\docs\node_inference" -Recurse -Force
Copy-Item -Path "expired\docs\node_register" -Destination "electron_node\docs\node_register" -Recurse -Force
Copy-Item -Path "expired\docs\modular" -Destination "electron_node\docs\modular" -Recurse -Force
```

### 5. 复制 scripts 和 shared

```powershell
Copy-Item -Path "expired\scripts" -Destination "scripts" -Recurse -Force
Copy-Item -Path "expired\shared" -Destination "shared" -Recurse -Force
```

### 6. 复制配置文件

```powershell
Copy-Item -Path "expired\observability.json" -Destination "." -Force -ErrorAction SilentlyContinue
Copy-Item -Path "expired\observability.json.example" -Destination "." -Force -ErrorAction SilentlyContinue
```

## 文档分类

### Web 客户端文档 (webapp/docs/)
- `webClient/` - Web 客户端相关文档
  - 产品设计文档
  - 技术方案文档
  - 架构设计文档

### 中央服务器文档 (central_server/docs/)
- `scheduler/` - 调度服务器文档
- `api_gateway/` - API 网关文档
- `ARCHITECTURE.md` - 系统架构文档
- `ARCHITECTURE_ANALYSIS.md` - 架构分析文档
- `PROTOCOLS*.md` - 协议文档
- `project_management/` - 项目管理文档
- `testing/` - 测试文档

### Electron 节点客户端文档 (electron_node/docs/)
- `electron_node/` - Electron 应用文档
- `modular/` - 模块化功能文档
- `MIGRATION.md` - 迁移文档

## 验证

重组完成后，请验证以下文件是否存在：

### Web 客户端
- `webapp/package.json`
- `webapp/src/`
- `webapp/docs/`

### 中央服务器
- `central_server/scheduler/Cargo.toml`
- `central_server/api-gateway/Cargo.toml`
- `central_server/model-hub/`
- `central_server/docs/`

### Electron 节点客户端
- `electron_node/electron-node/package.json`
- `electron_node/services/node-inference/Cargo.toml`
- `electron_node/services/nmt_m2m100/`
- `electron_node/services/piper_tts/`
- `electron_node/services/your_tts/`
- `electron_node/docs/`

## 注意事项

1. 确保所有文件都已正确复制
2. 检查路径引用是否需要更新
3. 更新启动脚本中的路径
4. 更新配置文件中的路径

## 执行脚本

可以使用提供的 `reorganize_project.ps1` 脚本自动执行重组：

```powershell
powershell -ExecutionPolicy Bypass -File reorganize_project.ps1
```

## 迁移结果

### Web 客户端迁移

- ✅ 源代码已迁移到 `webapp/web-client/`
- ✅ 文档已迁移到 `webapp/docs/`
- ✅ 启动脚本已更新
- ✅ 日志路径已调整为相对路径
- ✅ 114 个单元测试全部通过

详细迁移内容请参考 `webapp/docs/MIGRATION.md`。

### 中央服务器迁移

- ✅ 调度服务器已迁移到 `central_server/scheduler/`
- ✅ API 网关已迁移到 `central_server/api-gateway/`
- ✅ 模型库服务已迁移到 `central_server/model-hub/`
- ✅ 文档已迁移到 `central_server/docs/`
- ✅ 启动脚本已更新
- ✅ 日志路径已调整为相对路径
- ✅ 106+ 个单元测试通过

详细迁移内容请参考 `central_server/docs/MIGRATION.md`。

## 相关文档

- **项目迁移文档**: `docs/PROJECT_MIGRATION.md`
- **Web 客户端迁移**: `webapp/docs/MIGRATION.md`
- **中央服务器迁移**: `central_server/docs/MIGRATION.md`
