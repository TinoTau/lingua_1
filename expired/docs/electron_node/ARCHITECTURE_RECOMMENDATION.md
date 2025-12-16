# Electron 节点端架构推荐方案

## 概述

本文档基于节点端功能模块热插拔需求，提出 Electron 节点端的推荐架构方案，包括文件夹结构、服务组织方式和热插拔机制。

## 当前架构分析

### 当前文件夹结构

```
lingua_1/
├── electron-node/          # Electron 客户端
│   ├── main/              # 主进程
│   ├── renderer/          # 渲染进程
│   └── ...
├── node-inference/        # Rust 推理服务（包含模块热插拔）
│   ├── src/
│   │   ├── modules.rs     # 模块管理器（SSOT）
│   │   └── ...
│   └── models/            # 模型存储
├── services/              # Python 服务
│   ├── nmt_m2m100/        # NMT 服务
│   ├── piper_tts/         # Piper TTS 服务
│   └── your_tts/          # YourTTS 服务
└── scripts/               # 启动脚本
```

### 当前问题

1. **路径计算复杂**：Electron 需要从 `electron-node/main` 向上查找项目根目录
2. **服务分散**：服务分布在不同的顶级目录
3. **打包配置复杂**：需要在 `electron-builder.yml` 中手动指定每个服务的路径
4. **热插拔层次不清晰**：模块级和服务级热插拔混在一起

## 推荐架构方案

### 方案 A：保持当前结构（推荐用于快速迭代）

**优点**：
- ✅ 无需大规模重构
- ✅ 与现有脚本兼容
- ✅ 开发环境友好

**缺点**：
- ⚠️ 路径计算需要特殊处理
- ⚠️ 打包配置较复杂

**适用场景**：当前阶段，快速迭代

### 方案 B：统一服务目录（推荐用于生产环境）

**新的文件夹结构**：

```
lingua_1/
├── electron-node/          # Electron 客户端
│   ├── main/              # 主进程
│   ├── renderer/          # 渲染进程
│   └── ...
├── node-services/          # 所有节点端服务（统一目录）
│   ├── inference/         # Rust 推理服务
│   │   ├── src/
│   │   ├── Cargo.toml
│   │   └── models/        # 模型存储
│   ├── nmt/               # NMT 服务
│   │   ├── nmt_service.py
│   │   ├── venv/
│   │   └── logs/
│   ├── tts/               # Piper TTS 服务
│   │   ├── piper_http_server.py
│   │   ├── venv/
│   │   └── logs/
│   └── yourtts/           # YourTTS 服务
│       ├── yourtts_service.py
│       ├── venv/
│       └── logs/
└── scripts/               # 启动脚本
```

**优点**：
- ✅ 路径计算简单：`node-services/` 是统一入口
- ✅ 打包配置简单：只需打包 `node-services/` 目录
- ✅ 服务组织清晰
- ✅ 便于扩展新服务

**缺点**：
- ⚠️ 需要重构现有代码
- ⚠️ 需要更新所有脚本路径

**适用场景**：生产环境，长期维护

### 方案 C：插件化架构（推荐用于未来扩展）

**新的文件夹结构**：

```
lingua_1/
├── electron-node/          # Electron 客户端
│   ├── main/
│   │   ├── src/
│   │   │   ├── core/      # 核心功能
│   │   │   ├── plugins/   # 插件管理器
│   │   │   └── services/  # 服务管理器
│   │   └── ...
│   └── ...
├── plugins/                # 插件目录
│   ├── inference/         # 推理服务插件
│   │   ├── plugin.json   # 插件元数据
│   │   ├── executable/   # 可执行文件
│   │   └── config/       # 配置文件
│   ├── nmt/               # NMT 插件
│   ├── tts/               # TTS 插件
│   └── yourtts/           # YourTTS 插件
└── shared/                 # 共享代码
```

**优点**：
- ✅ 完全插件化，易于扩展
- ✅ 支持动态加载/卸载插件
- ✅ 插件元数据驱动
- ✅ 支持插件市场

**缺点**：
- ⚠️ 架构复杂，开发成本高
- ⚠️ 需要大量重构

**适用场景**：未来扩展，插件生态

## 热插拔层次分析

### 层次 1：模块级热插拔（Rust 推理服务内部）

**实现位置**：`node-inference/src/modules.rs`

**特点**：
- ✅ 根据任务请求动态启用模块
- ✅ 模块依赖、冲突检查
- ✅ 模型按需加载
- ✅ 生命周期管理（cold-load + warm-keep）

**示例**：
```rust
// 根据请求中的 features 自动启用模块
if features.speaker_identification {
    module_manager.enable_module("speaker_identification").await?;
}
```

### 层次 2：服务级热插拔（Electron 管理）

**实现位置**：`electron-node/main/src/rust-service-manager.ts`、`python-service-manager.ts`

**特点**：
- ✅ 用户可以选择启动哪些服务
- ✅ 服务启动/停止管理
- ✅ 服务状态上报
- ✅ 根据用户偏好自动启动

**示例**：
```typescript
// 根据用户偏好自动启动服务
if (prefs.rustEnabled) {
  await rustServiceManager.start();
}
if (prefs.nmtEnabled) {
  await pythonServiceManager.startService('nmt');
}
```

### 层次 3：功能级热插拔（未来扩展）

**特点**：
- ⏸️ 支持第三方插件
- ⏸️ 插件市场
- ⏸️ 动态加载/卸载插件

## 推荐方案：方案 A + 优化（当前阶段）

### 优化措施

#### 1. 统一路径计算逻辑

**创建路径工具模块**：`electron-node/main/src/utils/path-resolver.ts`

```typescript
export class PathResolver {
  private static projectRoot: string | null = null;

  static getProjectRoot(): string {
    if (this.projectRoot) {
      return this.projectRoot;
    }

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    
    if (isDev) {
      // 开发环境：从 electron-node 向上 1 级
      const cwd = process.cwd();
      const possibleRoot = path.resolve(cwd, '..');
      
      // 验证路径（检查是否存在 node-inference 或 services 目录）
      if (fs.existsSync(path.join(possibleRoot, 'node-inference')) ||
          fs.existsSync(path.join(possibleRoot, 'services'))) {
        this.projectRoot = possibleRoot;
        return this.projectRoot;
      }
    } else {
      // 生产环境：使用安装路径
      this.projectRoot = path.dirname(process.execPath);
      return this.projectRoot;
    }

    throw new Error('无法确定项目根目录');
  }

  static getNodeInferencePath(): string {
    return path.join(this.getProjectRoot(), 'node-inference');
  }

  static getServicesPath(): string {
    return path.join(this.getProjectRoot(), 'services');
  }

  static getServicePath(serviceName: string): string {
    return path.join(this.getServicesPath(), serviceName);
  }
}
```

#### 2. 服务配置统一管理

**创建服务配置模块**：`electron-node/main/src/config/service-config.ts`

```typescript
export interface ServiceConfig {
  name: string;
  type: 'rust' | 'python';
  executable?: string;
  script?: string;
  port: number;
  dependencies?: string[];
  requiredModels?: string[];
}

export const SERVICE_CONFIGS: Record<string, ServiceConfig> = {
  inference: {
    name: 'inference',
    type: 'rust',
    executable: 'inference-service.exe',
    port: 5009,
  },
  nmt: {
    name: 'nmt',
    type: 'python',
    script: 'nmt_service.py',
    port: 5008,
    dependencies: ['inference'],
  },
  tts: {
    name: 'tts',
    type: 'python',
    script: 'piper_http_server.py',
    port: 5006,
    dependencies: ['inference'],
  },
  yourtts: {
    name: 'yourtts',
    type: 'python',
    script: 'yourtts_service.py',
    port: 5004,
    dependencies: ['inference'],
  },
};
```

#### 3. 服务依赖管理

**在服务管理器中添加依赖检查**：

```typescript
class ServiceManager {
  async startService(serviceName: string): Promise<void> {
    const config = SERVICE_CONFIGS[serviceName];
    
    // 检查依赖服务
    if (config.dependencies) {
      for (const dep of config.dependencies) {
        if (!this.isServiceRunning(dep)) {
          logger.warn({ serviceName, dependency: dep }, '依赖服务未运行，尝试启动');
          await this.startService(dep);
        }
      }
    }
    
    // 启动服务
    // ...
  }
}
```

## 文件夹路径调整建议

### 当前结构（保持）

**开发环境**：
```
lingua_1/
├── electron-node/          # Electron 客户端
├── node-inference/         # Rust 推理服务
├── services/               # Python 服务
└── scripts/                # 启动脚本
```

**生产环境（打包后）**：
```
<安装路径>/
├── Lingua Node Client.exe
├── inference-service.exe
├── services/
│   ├── nmt_m2m100/
│   ├── piper_tts/
│   └── your_tts/
└── logs/
```

### 优化建议

1. **统一日志目录**：
   - 所有服务日志统一到 `<安装路径>/logs/`
   - 子目录：`logs/inference/`, `logs/nmt/`, `logs/tts/`, `logs/yourtts/`

2. **统一模型目录**：
   - 所有模型统一到 `<安装路径>/models/`
   - 子目录：`models/asr/`, `models/nmt/`, `models/tts/`

3. **配置文件统一**：
   - 所有配置统一到 `<安装路径>/config/`
   - 文件：`config/services.json`, `config/models.json`

## 热插拔实现建议

### 1. 模块级热插拔（已实现）

- ✅ Rust 推理服务中的模块管理器
- ✅ 根据任务请求动态启用
- ✅ 依赖和冲突检查

### 2. 服务级热插拔（已实现）

- ✅ Electron 服务管理器
- ✅ 用户偏好保存
- ✅ 自动启动/停止

### 3. 功能级热插拔（未来扩展）

**建议实现**：
- 插件系统
- 插件元数据（`plugin.json`）
- 动态加载/卸载
- 插件市场

## 总结

### 当前阶段（推荐）

1. **保持当前文件夹结构**
2. **优化路径计算**：使用统一的 `PathResolver`
3. **统一服务配置**：使用 `SERVICE_CONFIGS`
4. **添加依赖管理**：服务启动时检查依赖

### 未来扩展（可选）

1. **统一服务目录**：将服务移到 `node-services/`
2. **插件化架构**：支持第三方插件
3. **插件市场**：在线安装/卸载插件

### 关键原则

1. **模块级热插拔**：在 Rust 服务中实现（已实现）
2. **服务级热插拔**：在 Electron 中实现（已实现）
3. **路径统一管理**：使用工具类统一计算
4. **配置驱动**：服务配置集中管理
5. **依赖自动处理**：启动时自动检查并启动依赖服务
