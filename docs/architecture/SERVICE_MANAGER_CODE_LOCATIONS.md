# 节点端服务管理代码位置说明

**文档版本**: v1.0  
**创建日期**: 2025-12-17  
**状态**: 📋 代码位置参考

---

## 📍 代码位置概览

### 当前架构（改造前）

#### 1. 服务管理器

##### Python 服务管理器
**位置**: `electron_node/electron-node/main/src/python-service-manager/`

```
python-service-manager/
├── index.ts                    # PythonServiceManager 主类
├── types.ts                    # 类型定义
├── project-root.ts             # 项目根目录查找
├── service-process.ts          # 服务进程管理（启动/停止）
├── service-health.ts           # 服务健康检查
└── service-logging.ts          # 服务日志管理
```

**核心类**: `PythonServiceManager`
- **文件**: `electron_node/electron-node/main/src/python-service-manager/index.ts`
- **主要方法**:
  - `startService(serviceName: PythonServiceName): Promise<void>` - 启动服务
  - `stopService(serviceName: PythonServiceName): Promise<void>` - 停止服务
  - `getServiceStatus(serviceName: PythonServiceName): PythonServiceStatus` - 获取服务状态

##### Rust 服务管理器
**位置**: `electron_node/electron-node/main/src/rust-service-manager/`

```
rust-service-manager/
├── index.ts                    # RustServiceManager 主类
├── types.ts                    # 类型定义
├── project-root.ts             # 项目路径查找
├── process-manager.ts          # 进程管理（启动/停止）
├── service-health.ts           # 服务健康检查
└── cuda-setup.ts               # CUDA 环境设置
```

**核心类**: `RustServiceManager`
- **文件**: `electron_node/electron-node/main/src/rust-service-manager/index.ts`
- **主要方法**:
  - `start(): Promise<void>` - 启动 Rust 推理服务
  - `stop(): Promise<void>` - 停止服务
  - `getStatus(): RustServiceStatus` - 获取服务状态

#### 2. 服务启动入口

**位置**: `electron_node/electron-node/main/src/index.ts`

**关键代码段**:
```typescript
// 第 69-151 行：应用启动和服务初始化
app.whenReady().then(async () => {
  // 初始化服务管理器
  rustServiceManager = new RustServiceManager();
  pythonServiceManager = new PythonServiceManager();
  
  // 根据配置自动启动服务
  if (prefs.rustEnabled) {
    rustServiceManager.start();
  }
  
  if (prefs.nmtEnabled) toStart.push('nmt');
  if (prefs.ttsEnabled) toStart.push('tts');
  if (prefs.yourttsEnabled) toStart.push('yourtts');
  
  for (const name of toStart) {
    pythonServiceManager.startService(name);
  }
});
```

**IPC 处理程序**（UI 调用）:
- **位置**: `electron_node/electron-node/main/src/index.ts` (第 543-680 行)
- **Python 服务 IPC**:
  - `get-python-service-status` - 获取服务状态
  - `start-python-service` - 启动服务
  - `stop-python-service` - 停止服务
- **Rust 服务 IPC**:
  - `get-rust-service-status` - 获取服务状态
  - `start-rust-service` - 启动服务
  - `stop-rust-service` - 停止服务

#### 3. 服务配置

**Python 服务配置**:
- **位置**: `electron_node/electron-node/main/src/utils/python-service-config.ts`
- **功能**: 定义各 Python 服务的配置（端口、脚本路径、工作目录等）

**服务配置示例**:
```typescript
{
  nmt: {
    port: 5008,
    script: 'nmt_service.py',
    workingDir: 'services/nmt_m2m100',
    // ...
  },
  tts: {
    port: 5006,
    script: 'piper_http_server.py',
    workingDir: 'services/piper_tts',
    // ...
  }
}
```

---

## 🆕 改造后架构（需要新增）

### ServicePackageManager（新增）

**建议位置**: `electron_node/electron-node/main/src/service-package-manager/`

```
service-package-manager/
├── index.ts                    # ServicePackageManager 主类
├── types.ts                    # 类型定义（ServiceInfo, InstalledService 等）
├── downloader.ts               # 服务包下载（支持断点续传）
├── installer.ts                # 服务包安装（解压、验证）
├── registry.ts                 # 已安装服务注册表管理
└── verifier.ts                 # 服务包校验（SHA256）
```

**核心类**: `ServicePackageManager`
- **文件**: `electron_node/electron-node/main/src/service-package-manager/index.ts`
- **主要方法**:
  ```typescript
  class ServicePackageManager {
    // 获取可用服务列表
    async getAvailableServices(): Promise<ServiceInfo[]>
    
    // 下载并安装服务包
    async installService(serviceId: string, version?: string): Promise<void>
    
    // 卸载服务
    async uninstallService(serviceId: string, version?: string): Promise<boolean>
    
    // 获取已安装服务列表
    getInstalledServices(): InstalledService[]
    
    // 获取服务路径
    getServicePath(serviceId: string, version?: string): string | null
  }
  ```

### 服务启动适配（需要修改）

#### PythonServiceManager 修改点

**文件**: `electron_node/electron-node/main/src/python-service-manager/index.ts`

**需要修改的方法**:
1. `getServiceConfig()` - 从版本目录读取配置
2. `startService()` - 从版本目录启动服务

**修改示例**:
```typescript
private getServiceConfig(serviceName: PythonServiceName): PythonServiceConfig | null {
  // 从 ServicePackageManager 获取服务路径
  const servicePath = servicePackageManager?.getServicePath(serviceName, version);
  if (!servicePath) {
    return null;
  }
  
  // 从版本目录读取 service.json
  const serviceJson = path.join(servicePath, 'service.json');
  const config = JSON.parse(fs.readFileSync(serviceJson, 'utf-8'));
  
  return {
    port: config.port,
    script: config.startup_command,
    workingDir: servicePath,
    // ...
  };
}
```

#### RustServiceManager 修改点

**文件**: `electron_node/electron-node/main/src/rust-service-manager/index.ts`

**需要修改的方法**:
1. `start()` - 从版本目录启动服务，设置 MODELS_DIR 环境变量

**修改示例**:
```typescript
async start(): Promise<void> {
  // 从 ServicePackageManager 获取服务路径
  const servicePath = servicePackageManager?.getServicePath('node-inference', version);
  if (!servicePath) {
    throw new Error('Node inference service not installed');
  }
  
  const modelsDir = path.join(servicePath, 'models');
  const executablePath = path.join(servicePath, 'inference-service.exe');
  
  // 设置环境变量
  process.env.MODELS_DIR = modelsDir;
  
  // 启动服务
  this.process = startRustProcess(executablePath, modelsDir);
  // ...
}
```

---

## 📂 目录结构对比

### 当前结构（改造前）

```
electron_node/electron-node/main/src/
├── index.ts                           # 主入口，服务初始化
├── python-service-manager/            # Python 服务管理
│   └── index.ts
├── rust-service-manager/              # Rust 服务管理
│   └── index.ts
├── model-manager/                     # 模型管理（当前）
│   └── model-manager.ts
└── utils/
    └── python-service-config.ts       # 服务配置
```

### 改造后结构

```
electron_node/electron-node/main/src/
├── index.ts                           # 主入口，服务初始化
├── service-package-manager/           # 🆕 服务包管理
│   ├── index.ts
│   ├── downloader.ts
│   ├── installer.ts
│   └── registry.ts
├── python-service-manager/            # ✏️ 修改：适配服务包
│   └── index.ts
├── rust-service-manager/              # ✏️ 修改：适配服务包
│   └── index.ts
└── model-manager/                     # ⚠️ 保留：向后兼容
    └── model-manager.ts
```

---

## 🔗 相关文件

### 配置文件

- **节点配置**: `electron_node/electron-node/main/src/node-config.ts`
  - 包含服务偏好设置（`servicePreferences`）
  - 可能需要添加服务版本配置

### IPC 接口

- **Preload**: `electron_node/electron-node/main/src/preload.ts`
  - 需要添加服务包管理的 IPC 接口

- **IPC Handlers**: `electron_node/electron-node/main/src/index.ts`
  - 需要添加服务包管理的 IPC 处理程序

### UI 组件

- **模型管理界面**: `electron_node/electron-node/renderer/src/components/ModelManagement.tsx`
  - 需要改造为"服务管理"界面
  - 显示服务列表而非模型列表

---

## 📝 实施建议

### 阶段 1: 创建 ServicePackageManager

1. **创建目录结构**
   ```
   mkdir electron_node/electron-node/main/src/service-package-manager
   ```

2. **实现核心功能**
   - 先实现 `index.ts` 和 `types.ts`
   - 再实现 `downloader.ts`、`installer.ts`、`registry.ts`

3. **集成到主入口**
   - 在 `index.ts` 中初始化 `ServicePackageManager`
   - 添加 IPC 处理程序

### 阶段 2: 修改服务管理器

1. **修改 PythonServiceManager**
   - 修改 `getServiceConfig()` 从版本目录读取
   - 修改 `startService()` 使用版本目录路径

2. **修改 RustServiceManager**
   - 修改 `start()` 从版本目录启动
   - 设置正确的 `MODELS_DIR` 环境变量

### 阶段 3: UI 改造

1. **改造 ModelManagement 组件**
   - 重命名为 `ServiceManagement.tsx`
   - 调用 `ServicePackageManager` API
   - 显示服务列表和版本信息

---

## 🔍 代码查找指南

### 查找服务启动逻辑

```bash
# 搜索服务启动相关代码
grep -r "startService\|start()" electron_node/electron-node/main/src/
```

### 查找服务配置

```bash
# 搜索服务配置相关代码
grep -r "getServiceConfig\|PythonServiceConfig" electron_node/electron-node/main/src/
```

### 查找 IPC 处理程序

```bash
# 搜索 IPC 处理程序
grep -r "ipcMain.handle.*service" electron_node/electron-node/main/src/index.ts
```

---

## 📚 相关文档

- [服务包架构改造方案](./SERVICE_PACKAGE_ARCHITECTURE_REFACTOR.md)
- [系统架构文档](../SYSTEM_ARCHITECTURE.md)
- [服务管理文档](../../electron_node/services/README.md)

---

**文档结束**

