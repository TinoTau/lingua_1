# 平台化模型管理功能

## 概述

平台化模型管理功能支持多平台服务包的下载、安装、管理和运行。服务包包含特定平台的可执行文件、模型文件和配置文件。

## 核心组件

### 1. PlatformAdapter（平台适配层）

**位置**: `main/src/platform-adapter/index.ts`

**功能**:
- 平台识别（Windows/Linux/macOS）
- 进程启动（使用 argv 方式，避免 shell 差异）
- 文件权限设置（Linux/macOS chmod）
- 路径拼接（跨平台）

### 2. ServiceRegistry（服务注册表管理）

**位置**: `main/src/service-registry/`

**功能**:
- 管理 `installed.json`（已安装服务版本）
- 管理 `current.json`（当前激活版本）
- 版本注册/取消注册
- 回滚版本获取

### 3. ServicePackageManager（服务包管理）

**位置**: `main/src/service-package-manager/`

**功能**:
- 从 Model Hub 获取可用服务列表
- 下载服务包（支持断点续传）
- SHA256 完整性校验
- Ed25519 签名验证（框架已实现）
- 解压到 staging 目录
- 原子切换安装
- 服务注册表更新
- 回滚支持

### 4. ServiceRuntimeManager（运行时管理）

**位置**: `main/src/service-runtime-manager/`

**功能**:
- 统一启动/停止服务进程
- 从 service.json 读取配置
- 环境变量注入（SERVICE_PORT, MODEL_PATH, SERVICE_ID, SERVICE_VERSION）
- 健康检查等待
- 端口自动分配

## 服务包安装流程

1. 获取本机 platform（如 `windows-x64`）
2. 从 Model Hub 选择匹配的 variant（version + platform）
3. 下载 zip（支持断点续传）
4. 校验 SHA256（完整性）
5. 校验签名（可信性，Ed25519）
6. 解压到 `_staging/<version>-<platform>-<rand>/`
7. 解析 `service.json`，校验平台配置存在
8. 进行基础启动前检查：文件存在性、端口可用、必要 env 可注入
9. 原子切换：rename staging → `versions/<version>/<platform>/`
10. 更新 `installed.json`
11. 更新 `current.json`（自动激活）
12. 清理 staging 与超旧版本

## service.json 格式

```json
{
  "service_id": "nmt-zh-en",
  "version": "1.2.0",
  "platforms": {
    "windows-x64": {
      "entrypoint": "app/main.py",
      "exec": {
        "type": "argv",
        "program": "runtime/python/python.exe",
        "args": ["app/main.py"],
        "cwd": "."
      },
      "default_port": 5101,
      "files": {
        "requires": ["service.json", "app/", "models/"],
        "optional": ["runtime/"]
      }
    }
  },
  "health_check": {
    "type": "http",
    "endpoint": "/health",
    "timeout_ms": 3000,
    "startup_grace_ms": 20000
  },
  "env_schema": {
    "SERVICE_PORT": "int",
    "MODEL_PATH": "string",
    "LOG_LEVEL": "string"
  }
}
```

## Model Hub API

### 获取服务列表

```
GET /api/services?platform=windows-x64
```

返回所有可用服务，包含所有平台变体。

### 下载服务包

```
GET /storage/services/{id}/{version}/{platform}/service.zip
```

支持 HTTP Range 请求（断点续传）和 ETag / If-None-Match（避免重复下载）。

### 获取服务包元数据

```
GET /api/services/{id}/{version}/{platform}
```

返回单个服务包变体的元数据。

## ServiceManager 改造

### PythonServiceManager

- 支持从 `service.json` 读取配置
- 如果没有 service.json，回退到硬编码配置
- **位置**: `main/src/python-service-manager/index.ts`

### RustServiceManager

- 支持从 `service.json` 读取配置
- 如果没有 service.json，使用默认配置
- **位置**: `main/src/rust-service-manager/index.ts`

### 配置加载器

- **位置**: `main/src/utils/service-config-loader.ts`
- **功能**: 统一的 service.json 配置加载和转换

## 签名验证

### Ed25519 签名验证框架

**位置**: `main/src/service-package-manager/signature-verifier.ts`

**功能**:
- 公钥管理（支持 key rotation）
- Ed25519 签名验证
- 安全事件日志记录

**注意**:
- 支持使用 tweetnacl 库或 Node.js 15+ 原生 API
- 建议安装 `tweetnacl` 库：`npm install tweetnacl @types/tweetnacl`
- 开发环境下，如果公钥未配置，允许跳过验证

## 依赖项

### 必需依赖
- `adm-zip`: ^0.5.10（用于解压服务包）

### 可选依赖（推荐）
- `tweetnacl`: 用于 Ed25519 签名验证（如果 Node.js 版本 < 15）

## 测试

### 运行测试

```bash
npm run test:stage3.2
```

### 测试覆盖

- **PlatformAdapter**: 4 个测试用例
- **ServiceRegistry**: 9 个测试用例
- **ServicePackageManager**: 5 个测试用例

**测试结果**: 18/18 通过（100%）

## 使用示例

### 安装服务包

```typescript
import { ServicePackageManager } from './service-package-manager';

const manager = new ServicePackageManager(servicesDir);

// 安装服务包
await manager.installService('nmt-zh-en', '1.2.0', {
  onProgress: (progress) => {
    console.log(`安装进度: ${progress.percent}%`);
  }
});
```

### 获取可用服务列表

```typescript
const services = await manager.getAvailableServices('windows-x64');
console.log('可用服务:', services);
```

### 回滚服务版本

```typescript
await manager.rollbackService('nmt-zh-en');
```

## 实现状态

### ✅ 已完成

- Model Hub API 支持多平台变体
- 服务包下载、校验、安装流程
- SHA256 完整性校验
- Ed25519 签名验证框架
- 原子切换安装
- 版本管理和回滚
- ServiceManager 支持 service.json 配置
- 单元测试覆盖

### ⏳ 待完善

- 签名验证完善（配置真实公钥）
- 集成测试
- UI 集成
- 文档完善

## 相关文件

- `main/src/platform-adapter/`: 平台适配层
- `main/src/service-registry/`: 服务注册表管理
- `main/src/service-package-manager/`: 服务包管理
- `main/src/service-runtime-manager/`: 运行时管理
- `main/src/utils/service-config-loader.ts`: 配置加载器

