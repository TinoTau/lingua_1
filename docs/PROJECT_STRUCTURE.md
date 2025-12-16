# 项目结构文档

## 当前项目结构

```
lingua_1/
├── webapp/                    # Web 客户端
│   ├── web-client/           # 实际项目目录
│   │   ├── src/              # 源代码
│   │   ├── tests/            # 测试文件
│   │   ├── logs/             # 日志文件
│   │   └── package.json
│   ├── mobile-app/           # 移动应用（参考）
│   └── docs/                 # Web 客户端文档
│       ├── webClient/        # Web 客户端文档
│       ├── webRTC/           # WebRTC 文档
│       ├── QUICK_START.md    # 快速开始指南
│       ├── MIGRATION.md      # 迁移文档
│       └── README.md         # 文档索引
│
├── central_server/            # 中央服务器
│   ├── scheduler/            # 调度服务器
│   │   ├── src/              # 源代码
│   │   ├── tests/            # 测试文件
│   │   ├── logs/             # 日志文件
│   │   └── Cargo.toml
│   ├── api-gateway/          # API 网关
│   │   ├── src/              # 源代码
│   │   ├── logs/             # 日志文件
│   │   └── Cargo.toml
│   ├── model-hub/            # 模型库服务
│   │   ├── src/              # 源代码
│   │   ├── logs/             # 日志文件
│   │   └── requirements.txt
│   └── docs/                 # 中央服务器文档
│       ├── scheduler/        # 调度服务器文档
│       ├── api_gateway/      # API 网关文档
│       ├── QUICK_START.md    # 快速开始指南
│       ├── MIGRATION.md      # 迁移文档
│       └── README.md         # 文档索引
│
├── electron_node/             # Electron 节点客户端
│   ├── electron-node/        # Electron 应用
│   │   ├── main/src/        # 主进程源代码（TypeScript）
│   │   ├── renderer/        # 渲染进程代码（React）
│   │   ├── tests/           # 测试文件
│   │   └── logs/            # Electron 主进程日志
│   ├── services/             # 所有节点端服务（统一目录）
│   │   ├── node-inference/  # 节点推理服务（Rust）
│   │   │   ├── src/         # 源代码
│   │   │   ├── tests/       # 测试文件
│   │   │   ├── models/      # 模型文件
│   │   │   └── logs/        # 日志文件
│   │   ├── nmt_m2m100/      # NMT 服务（Python，端口 5008）
│   │   ├── piper_tts/       # TTS 服务（Python，端口 5006）
│   │   └── your_tts/        # YourTTS 服务（Python，端口 5004，可选）
│   ├── docs/                 # 节点客户端文档
│   │   ├── PATH_STRUCTURE.md    # 路径结构文档
│   │   ├── MIGRATION.md         # 迁移文档
│   │   ├── SERVICE_HOT_PLUG_VERIFICATION.md  # 服务热插拔验证报告
│   │   └── YOURTTS_INTEGRATION_IMPLEMENTATION.md  # YourTTS 集成实现文档
│   ├── PROJECT_COMPLETENESS.md  # 项目完整性报告
│   ├── TEST_STATUS.md           # 测试状态
│   └── TEST_EXECUTION_REPORT.md # 测试执行报告
│
├── scripts/                   # 启动脚本
│   ├── start_web_client.ps1
│   ├── start_scheduler.ps1
│   ├── start_api_gateway.ps1
│   └── ...
│
├── shared/                    # 共享代码（协议定义等）
├── docs/                      # 项目级文档
│   ├── logging/              # 日志和可观测性文档
│   ├── project_management/   # 项目管理文档
│   ├── reference/            # 参考文档
│   ├── testing/              # 测试文档
│   ├── PROJECT_MIGRATION.md  # 项目迁移文档
│   └── README.md             # 文档索引
│
└── expired/                   # 备份代码（旧版本）
```

## 路径说明

### 相对路径

所有服务和脚本都使用相对路径（相对于项目根目录）：

- **Web 客户端**: `webapp/web-client/`
- **调度服务器**: `central_server/scheduler/`
- **API 网关**: `central_server/api-gateway/`
- **模型库服务**: `central_server/model-hub/`
- **日志文件**: 各服务目录下的 `logs/` 子目录

### 启动脚本路径

所有启动脚本位于 `scripts/` 目录，使用相对路径引用项目目录：

- `scripts/start_web_client.ps1` → `webapp/web-client/`
- `scripts/start_scheduler.ps1` → `central_server/scheduler/`
- `scripts/start_api_gateway.ps1` → `central_server/api-gateway/`
- `scripts/start_model_hub.ps1` → `central_server/model-hub/`

## 迁移历史

项目已从 `expired/` 文件夹迁移到新的目录结构。详细迁移内容请参考：

- **项目迁移总览**: `PROJECT_MIGRATION.md`
- **Web 客户端迁移**: `../webapp/docs/MIGRATION.md`
- **中央服务器迁移**: `../central_server/docs/MIGRATION.md`
- **Electron 节点客户端迁移**: `../electron_node/docs/MIGRATION.md`

## 相关文档

- **项目迁移**: `PROJECT_MIGRATION.md`
- **项目重组指南**: `../PROJECT_REORGANIZATION_GUIDE.md`
- **Web 客户端文档**: `../webapp/docs/README.md`
- **中央服务器文档**: `../central_server/docs/README.md`
