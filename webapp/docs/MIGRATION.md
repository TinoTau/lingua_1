# Web 客户端迁移文档

## 迁移概述

Web 客户端已从 `expired/web-client` 迁移到 `webapp/web-client`，并按照新的项目结构进行了重组。

## 迁移内容

### 源代码迁移

- **源路径**: `expired/web-client/`
- **目标路径**: `webapp/web-client/`
- **迁移内容**:
  - ✅ 源代码 (`src/`)
  - ✅ 测试文件 (`tests/`)
  - ✅ 配置文件 (`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`)
  - ✅ HTML 入口文件 (`index.html`)

### 文档迁移

- **源路径**: `expired/docs/webClient/`
- **目标路径**: `webapp/docs/webClient/`
- **迁移内容**:
  - ✅ 产品设计文档
  - ✅ 技术方案文档
  - ✅ 架构设计文档

### 其他文档迁移

- **WebRTC 文档**: `expired/docs/webRTC/` → `webapp/docs/webRTC/`
- **iOS 文档（参考）**: `expired/docs/IOS/` → `webapp/docs/IOS/`
- **API Gateway 文档（参考）**: `expired/docs/api_gateway/` → `webapp/docs/api_gateway/`

## 路径调整

### 启动脚本更新

- **脚本路径**: `scripts/start_web_client.ps1`
- **调整内容**:
  - ✅ 更新了 `$webClientPath` 为 `Join-Path $projectRoot "webapp" "web-client"`
  - ✅ 更新了日志路径为相对路径
  - ✅ 添加了项目路径和服务 URL 输出

### 日志路径调整

- **旧路径**: `D:\Programs\github\lingua_1\web-client\logs\`
- **新路径**: `webapp/web-client/logs/`（相对路径）
- **日志文件**: `web-client.log`（带时间戳，5MB 轮转）

## 迁移验证

### 项目完整性检查

- ✅ 核心文件存在
- ✅ 源代码完整
- ✅ 测试文件完整
- ✅ 配置文件完整

### 测试验证

- ✅ 114 个单元测试全部通过
- ✅ 测试覆盖所有主要功能模块
- ✅ 测试文件结构正确

### 服务启动验证

- ✅ 开发服务器可以正常启动
- ✅ 服务运行在 `http://localhost:9001`
- ✅ 日志文件正常生成

## 迁移后的项目结构

```
webapp/
├── web-client/          # 实际项目目录
│   ├── src/            # 源代码
│   ├── tests/          # 测试文件
│   ├── logs/           # 日志文件
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── vitest.config.ts
├── mobile-app/         # 移动应用（参考）
└── docs/               # 文档
    ├── webClient/      # Web 客户端文档
    ├── webRTC/         # WebRTC 文档
    ├── IOS/            # iOS 文档（参考）
    ├── api_gateway/    # API 网关文档（参考）
    └── QUICK_START.md  # 快速开始指南
```

## 相关文档

- **项目状态归档**: `../../docs/web_client/PROJECT_STATUS_ARCHIVE.md`
- **统一项目状态**: `../../docs/project_management/PROJECT_STATUS.md`
- **快速开始**: `QUICK_START.md`
- **文档索引**: `README.md`

## 迁移日期

2025-01-XX
