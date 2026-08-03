---
status: HISTORICAL
historical_baseline: pre-FW_V4
reason: Dated troubleshooting incident report; paths may refer to repository state at that date.
classified_by: 2026-08-04_Documentation_Governance_Residual_Backlog_Closure
---

> Historical document; paths may refer to repository state at that date.

# 服务发现流程详解

**日期**: 2026-01-19  
**状态**: ✅ 热插拔架构已实现

---

## 🔍 完整服务发现流程

### 流程图

```
应用启动
    ↓
┌─────────────────────────────────────────┐
│  1. ServiceRegistryManager 初始化       │
│     读取 installed.json                 │
│     构建已安装服务列表                   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  2. SemanticRepairServiceManager 初始化 │
│     构造函数（不再硬编码服务列表）       │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  3. 前端/后端调用                        │
│     getAllServiceStatuses()             │
│     或 getInstalledServices()           │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  4. 动态服务发现                         │
│     discoverServices()                  │
│     ├─ 遍历 installed.json 中的服务     │
│     ├─ 读取每个服务的 service.json      │
│     ├─ 检查 type === 'semantic-repair'  │
│     └─ 初始化服务状态                   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  5. 类型映射（心跳上报用）               │
│     getServiceTypeFromJson()            │
│     ├─ 读取 service.json 的 type 字段   │
│     └─ 映射到 ServiceType 枚举          │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  6. 前端获取元数据                       │
│     getAllServiceMetadata()             │
│     ├─ 遍历所有已安装服务               │
│     └─ 返回每个服务的 service.json      │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  7. 界面动态渲染                         │
│     ├─ 从元数据获取 name_zh             │
│     ├─ 检查 deprecated 标记             │
│     ├─ 显示服务卡片                     │
│     └─ 绑定启动/停止事件                │
└─────────────────────────────────────────┘
    ↓
✅ 服务自动显示，可以使用
```

---

## 📋 详细步骤说明

### 步骤1: ServiceRegistryManager 读取 installed.json

**文件**: `service-registry/index.ts`

**作用**: 
- 读取 `electron_node/services/installed.json`
- 解析所有已安装服务的注册信息
- 提供服务查询接口

**installed.json 示例**:
```json
{
  "semantic-repair-en-zh": {
    "1.0.0::windows-x64": {
      "service_id": "semantic-repair-en-zh",
      "version": "1.0.0",
      "platform": "windows-x64",
      "installed_at": "2026-01-19T12:00:00.000Z",
      "install_path": "D:/Programs/github/lingua_1/electron_node/services/semantic_repair_en_zh",
      "service_json_path": "D:/Programs/github/lingua_1/electron_node/services/semantic_repair_en_zh/service.json",
      "size_bytes": 4200000000
    }
  },
  "semantic-repair-zh": {...},
  "semantic-repair-en": {...},
  "en-normalize": {...}
}
```

**API**:
```typescript
await serviceRegistryManager.loadRegistry();
const installed = serviceRegistryManager.listInstalled();
// 返回: [{service_id, version, platform, install_path, ...}, ...]
```

---

### 步骤2: SemanticRepairServiceManager 初始化

**文件**: `semantic-repair-service-manager/index.ts`

**修改前（旧架构）**:
```typescript
constructor(...) {
  // ❌ 硬编码服务列表
  const serviceIds = ['en-normalize', 'semantic-repair-zh', 'semantic-repair-en', 'semantic-repair-en-zh'];
  for (const serviceId of serviceIds) {
    this.statuses.set(serviceId, {...});
  }
}
```

**修改后（新架构）**:
```typescript
constructor(
  private serviceRegistryManager: ServiceRegistryManager | null,
  private servicesDir: string
) {
  // ✅ 延迟初始化，不再硬编码
  // 服务状态会在首次调用 discoverServices() 时初始化
}
```

**优点**:
- ✅ 构造函数轻量
- ✅ 支持动态发现
- ✅ 不依赖硬编码列表

---

### 步骤3: 触发服务发现

**触发点1: 前端获取服务列表**

```typescript
// 前端（ServiceManagement.tsx）
useEffect(() => {
  const updateStatuses = async () => {
    const statuses = await window.electronAPI.getAllSemanticRepairServiceStatuses();
    setSemanticRepairStatuses(statuses);
  };
  updateStatuses();
}, []);
```

**触发点2: 心跳上报**

```typescript
// 后端（node-agent-services.ts）
async getInstalledServices() {
  // 会调用 serviceRegistryManager.listInstalled()
  // 然后为每个服务读取 service.json 的 type 字段
}
```

**触发点3: 自动启动服务**

```typescript
// 应用初始化（app-init.ts）
async function autoStartServices() {
  const statuses = await semanticRepairServiceManager.getAllServiceStatuses();
  // 会触发 discoverServices()
}
```

---

### 步骤4: 动态服务发现（核心）⭐⭐⭐

**文件**: `semantic-repair-service-manager/index.ts`

**核心函数**: `discoverServices()`

```typescript
private async discoverServices(): Promise<string[]> {
  const discovered: string[] = [];
  
  if (!this.serviceRegistryManager) {
    return discovered;
  }
  
  try {
    // 1️⃣ 加载服务注册表
    await this.serviceRegistryManager.loadRegistry();
    const installed = this.serviceRegistryManager.listInstalled();
    
    // 2️⃣ 遍历每个已安装的服务
    for (const service of installed) {
      try {
        // 3️⃣ 读取服务的 service.json
        const serviceJsonPath = path.join(service.install_path, 'service.json');
        if (fs.existsSync(serviceJsonPath)) {
          const serviceJson = JSON.parse(fs.readFileSync(serviceJsonPath, 'utf-8'));
          
          // 4️⃣ 过滤：只收集 semantic-repair 类型的服务
          if (serviceJson.type === 'semantic-repair') {
            discovered.push(service.service_id);
            
            // 5️⃣ 初始化服务状态（如果不存在）
            if (!this.statuses.has(service.service_id)) {
              this.statuses.set(service.service_id, {
                serviceId: service.service_id,
                running: false,
                starting: false,
                pid: null,
                port: null,
                startedAt: null,
                lastError: null,
              });
            }
          }
        }
      } catch (error) {
        logger.warn({ service_id: service.service_id, error }, 'Failed to check service type');
      }
    }
    
    logger.info({ discovered }, 'Discovered semantic repair services');
  } catch (error) {
    logger.error({ error }, 'Failed to discover semantic repair services');
  }
  
  return discovered;
}
```

**调用时机**:
```typescript
async getAllServiceStatuses(): Promise<SemanticRepairServiceStatus[]> {
  // ✅ 每次调用时都重新发现（支持热插拔）
  await this.discoverServices();
  return Array.from(this.statuses.values());
}
```

**发现规则**:
1. ✅ 服务必须在 `installed.json` 中注册
2. ✅ 服务目录必须包含 `service.json` 文件
3. ✅ `service.json` 的 `type` 字段必须为 `"semantic-repair"`
4. ✅ 自动初始化服务状态

---

### 步骤5: 服务类型映射（心跳上报）

**文件**: `node-agent-services.ts`

**作用**: 将服务映射到 `ServiceType` 枚举，用于心跳上报

**核心函数**: `getServiceTypeFromJson()`

```typescript
// 1️⃣ 定义 service.json 的 type 到 ServiceType 的映射
const serviceTypeEnumMap: Record<string, ServiceType> = {
  'asr': ServiceType.ASR,
  'nmt': ServiceType.NMT,
  'tts': ServiceType.TTS,
  'tone': ServiceType.TONE,
  'semantic-repair': ServiceType.SEMANTIC,  // ✅ 语义修复服务
};

// 2️⃣ 从 service.json 读取类型
const getServiceTypeFromJson = (installPath: string): ServiceType | null => {
  try {
    const serviceJsonPath = path.join(installPath, 'service.json');
    if (!fs.existsSync(serviceJsonPath)) {
      return null;
    }
    
    const serviceJson = JSON.parse(fs.readFileSync(serviceJsonPath, 'utf-8'));
    const serviceType = serviceJson.type;  // 读取 type 字段
    
    return serviceTypeEnumMap[serviceType] || null;
  } catch (error) {
    return null;
  }
};

// 3️⃣ 使用
installed.forEach((service: any) => {
  // 优先从 service.json 读取类型
  let type = getServiceTypeFromJson(service.install_path);
  
  // 回退到硬编码（仅用于核心服务）
  if (!type) {
    const fallbackMap = {
      'faster-whisper-vad': ServiceType.ASR,
      'node-inference': ServiceType.ASR,
      ...
    };
    type = fallbackMap[service.service_id];
  }
  
  if (!type) {
    logger.warn({ service_id }, 'Unknown service type, skipped');
    return;  // ❌ 跳过未知类型的服务
  }
  
  // ✅ 添加到心跳上报列表
  pushService(service.service_id, type, ...);
});
```

**心跳上报示例**:
```json
{
  "installed_services": [
    {
      "service_id": "semantic-repair-en-zh",
      "type": "SEMANTIC",  // ← 从 service.json 的 type: "semantic-repair" 映射而来
      "device": "gpu",
      "status": "running",
      "version": "1.0.0"
    },
    {
      "service_id": "faster-whisper-vad",
      "type": "ASR",
      "device": "gpu",
      "status": "running",
      "version": "2.0.0"
    }
  ]
}
```

---

### 步骤6: 前端获取服务元数据

**文件**: `runtime-handlers.ts` + `preload.ts`

**后端 IPC Handler**:
```typescript
// runtime-handlers.ts
ipcMain.handle('get-all-service-metadata', async () => {
  const metadata: Record<string, any> = {};
  
  if (!serviceRegistryManager) {
    return metadata;
  }
  
  try {
    await serviceRegistryManager.loadRegistry();
    const installed = serviceRegistryManager.listInstalled();
    
    // 遍历所有已安装服务
    for (const service of installed) {
      try {
        const serviceJsonPath = path.join(service.install_path, 'service.json');
        if (fs.existsSync(serviceJsonPath)) {
          const serviceJson = JSON.parse(fs.readFileSync(serviceJsonPath, 'utf-8'));
          metadata[service.service_id] = serviceJson;  // ✅ 完整元数据
        }
      } catch (error) {
        logger.warn({ service_id: service.service_id, error }, 'Failed to load service metadata');
      }
    }
    
    logger.debug({ count: Object.keys(metadata).length }, 'Loaded service metadata for UI');
  } catch (error) {
    logger.error({ error }, 'Failed to get service metadata');
  }
  
  return metadata;
});
```

**前端 API**:
```typescript
// preload.ts
getAllServiceMetadata: () => ipcRenderer.invoke('get-all-service-metadata'),

// ServiceManagement.tsx
const metadata = await window.electronAPI.getAllServiceMetadata();
```

**返回的元数据**:
```json
{
  "semantic-repair-en-zh": {
    "service_id": "semantic-repair-en-zh",
    "name": "Unified Semantic Repair Service",
    "name_zh": "统一语义修复服务（中英文+标准化）",
    "type": "semantic-repair",
    "port": 5015,
    "enabled": true,
    "deprecated": false,
    "languages": ["zh", "en"]
  },
  "semantic-repair-zh": {
    "service_id": "semantic-repair-zh",
    "name": "Semantic Repair Service - Chinese",
    "name_zh": "中文语义修复服务",
    "type": "semantic-repair",
    "port": 5013,
    "deprecated": true,
    "deprecated_reason": "Use semantic-repair-en-zh instead"
  }
}
```

---

### 步骤7: 界面动态渲染

**文件**: `ServiceManagement.tsx`

**初始化**:
```typescript
const [serviceMetadata, setServiceMetadata] = useState<Record<string, any>>({});

useEffect(() => {
  const init = async () => {
    // 1️⃣ 加载服务元数据
    const metadata = await window.electronAPI.getAllServiceMetadata();
    setServiceMetadata(metadata);
    console.log('Loaded service metadata:', metadata);
    
    // 2️⃣ 加载服务状态
    await updateStatuses();
  };
  init();
}, []);
```

**动态获取显示名**:
```typescript
const getServiceDisplayName = (serviceId: string): string => {
  // 1️⃣ 优先从元数据获取
  const meta = serviceMetadata[serviceId];
  if (meta) {
    let name = meta.name_zh || meta.name;  // ✅ 优先中文名
    if (meta.deprecated) {
      name += ' (已弃用)';  // ✅ 自动标记弃用
    }
    return name;
  }
  
  // 2️⃣ 回退到硬编码（仅用于核心服务）
  const fallbackMap: Record<string, string> = {
    nmt: 'NMT 翻译服务',
    tts: 'TTS 语音合成 (Piper)',
    ...
  };
  
  return fallbackMap[serviceId] || serviceId;
};
```

**渲染服务卡片**:
```tsx
{semanticRepairStatuses.map(status => (
  <div key={status.serviceId} className="service-item">
    <h3>{getServiceDisplayName(status.serviceId)}</h3>
    {/* ✅ 显示动态获取的名称 */}
    
    <input
      type="checkbox"
      checked={status.running}
      onChange={(e) => handleToggleSemanticRepair(status.serviceId, e.target.checked)}
      {/* ✅ 支持任意服务ID */}
    />
    
    <span>状态: {status.running ? '运行中' : '已停止'}</span>
    <span>端口: {status.port}</span>
  </div>
))}
```

---

## 🔄 服务发现时机

### 1. 应用启动时

```
Electron 启动
    ↓
SemanticRepairServiceManager 初始化
    ↓
首次调用 getAllServiceStatuses()
    ↓
触发 discoverServices()
    ↓
发现并初始化所有服务
```

### 2. 前端定期轮询

```typescript
// ServiceManagement.tsx
useEffect(() => {
  const interval = setInterval(async () => {
    await updateStatuses();  // 触发 discoverServices()
  }, 2000);  // 每2秒刷新
  
  return () => clearInterval(interval);
}, []);
```

### 3. 用户操作触发

```
用户点击"刷新"按钮
    ↓
调用 getAllServiceStatuses()
    ↓
触发 discoverServices()
    ↓
重新发现服务
```

### 4. 心跳上报时

```
NodeAgent 发送心跳
    ↓
调用 getInstalledServices()
    ↓
读取所有服务的 service.json
    ↓
构建 installed_services 列表
    ↓
发送到调度服务器
```

---

## 📊 数据流图

```
installed.json (服务注册表)
    ↓
ServiceRegistryManager.listInstalled()
    ├─ service_id
    ├─ version
    ├─ platform
    ├─ install_path  ← 关键！
    └─ service_json_path

install_path + "service.json"
    ↓
读取 service.json
    ├─ service_id
    ├─ name_zh        ← 显示名称
    ├─ type           ← 服务类型（过滤条件）
    ├─ port
    ├─ deprecated     ← 弃用标记
    └─ languages

type === "semantic-repair"?
    ├─ Yes → 添加到 discovered 列表
    └─ No  → 跳过

discovered 列表
    ↓
初始化服务状态
    ├─ serviceId
    ├─ running: false
    ├─ starting: false
    ├─ pid: null
    ├─ port: null
    └─ startedAt: null

返回给前端
    ↓
前端渲染服务卡片
    ├─ 显示名称（从 name_zh）
    ├─ 弃用标记（从 deprecated）
    ├─ 运行状态
    └─ 启动/停止按钮
```

---

## 🎯 关键配置文件

### 1. installed.json（服务注册表）

**位置**: `electron_node/services/installed.json`

**作用**: 
- 记录所有已安装的服务
- 提供服务的 `install_path`（用于定位 service.json）

**格式**:
```json
{
  "service-id": {
    "version::platform": {
      "service_id": "service-id",
      "version": "1.0.0",
      "platform": "windows-x64",
      "install_path": "/absolute/path/to/service",
      "service_json_path": "/absolute/path/to/service/service.json"
    }
  }
}
```

---

### 2. service.json（服务元数据）

**位置**: `electron_node/services/{service_name}/service.json`

**作用**: 
- 定义服务的所有元数据
- 用于服务发现和分类
- 提供界面显示信息

**关键字段**:

| 字段 | 作用 | 示例 |
|------|------|------|
| `service_id` | 唯一标识 | `"semantic-repair-en-zh"` |
| `type` | 服务类型（**发现条件**） | `"semantic-repair"` |
| `name_zh` | 中文名称（**界面显示**） | `"统一语义修复服务"` |
| `port` | 服务端口 | `5015` |
| `deprecated` | 是否弃用（**界面标记**） | `false` |
| `languages` | 支持的语言（**心跳上报**） | `["zh", "en"]` |

**完整示例**:
```json
{
  "service_id": "semantic-repair-en-zh",
  "name": "Unified Semantic Repair Service (EN/ZH + Normalize)",
  "name_zh": "统一语义修复服务（中英文+标准化）",
  "type": "semantic-repair",
  "language": "multi",
  "languages": ["zh", "en"],
  "port": 5015,
  "enabled": true,
  "deprecated": false,
  "version": "1.0.0",
  "startup_command": "python",
  "startup_args": ["service.py"]
}
```

---

## ✅ 服务发现规则总结

### 必须满足的条件

1. ✅ **在 installed.json 中注册**
   ```json
   "your-service": {
     "1.0.0::windows-x64": {...}
   }
   ```

2. ✅ **存在 service.json 文件**
   ```
   services/your_service/service.json
   ```

3. ✅ **type 字段为 "semantic-repair"**
   ```json
   {
     "type": "semantic-repair"
   }
   ```

4. ✅ **service.json 格式正确**
   - 有效的 JSON 格式
   - 包含必填字段

### 可选但推荐的字段

- `name_zh` - 中文显示名
- `deprecated` - 弃用标记
- `languages` - 支持的语言
- `port` - 服务端口

---

## 🚀 添加新服务示例

### 完整流程演示

```bash
# 1️⃣ 创建服务目录
mkdir electron_node/services/my_new_service

# 2️⃣ 创建 service.json
cat > electron_node/services/my_new_service/service.json << 'EOF'
{
  "service_id": "my-new-service",
  "name": "My New Service",
  "name_zh": "我的新服务",
  "type": "semantic-repair",
  "port": 5020,
  "enabled": true,
  "deprecated": false,
  "version": "1.0.0"
}
EOF

# 3️⃣ 添加到 installed.json
# 在 electron_node/services/installed.json 中添加：
{
  "my-new-service": {
    "1.0.0::windows-x64": {
      "service_id": "my-new-service",
      "version": "1.0.0",
      "platform": "windows-x64",
      "installed_at": "2026-01-19T12:00:00.000Z",
      "install_path": "D:/Programs/github/lingua_1/electron_node/services/my_new_service",
      "size_bytes": 1000000
    }
  }
}

# 4️⃣ 重启节点端
# ✅ 服务自动被发现
# ✅ 界面显示 "我的新服务"
# ✅ 可以启动/停止
# ✅ 完全零代码修改！
```

### 验证日志

**启动时日志**:
```
[INFO] Discovered semantic repair services: [
  "semantic-repair-zh",
  "semantic-repair-en",
  "en-normalize",
  "semantic-repair-en-zh",
  "my-new-service"  ← ✅ 新服务被发现
]

[DEBUG] Loaded service metadata for UI: {
  "my-new-service": {
    name_zh: "我的新服务",
    type: "semantic-repair",
    port: 5020
  }
}
```

**浏览器控制台**:
```javascript
Loaded service metadata: {
  "my-new-service": {
    service_id: "my-new-service",
    name_zh: "我的新服务",
    type: "semantic-repair",
    port: 5020,
    deprecated: false
  }
}
```

---

## 🎉 核心优势

### 1. 配置驱动 ⭐⭐⭐

- 所有服务信息从 `service.json` 读取
- 显示名、端口、语言等全部动态
- 无需硬编码

### 2. 自动发现 ⭐⭐⭐

- 扫描 `installed.json`
- 读取每个服务的 `service.json`
- 过滤 `type === "semantic-repair"`
- 自动初始化状态

### 3. 热插拔支持 ⭐⭐⭐

```
下载服务 → 解压 → 添加到 installed.json → 重启 → 自动显示
```

### 4. 类型安全与灵活性平衡 ⭐⭐

- 使用 `string` 类型支持任意服务ID
- 运行时验证服务是否存在
- 编译永不失败

---

## 📚 相关文档

- [HOT_PLUGGABLE_SERVICE_ARCHITECTURE_ANALYSIS_2026_01_19.md](./HOT_PLUGGABLE_SERVICE_ARCHITECTURE_ANALYSIS_2026_01_19.md) - 架构分析
- [HOT_PLUGGABLE_REFACTOR_COMPLETE_2026_01_19.md](./HOT_PLUGGABLE_REFACTOR_COMPLETE_2026_01_19.md) - 重构完成报告
- [HOT_PLUGGABLE_QUICK_START_2026_01_19.md](./HOT_PLUGGABLE_QUICK_START_2026_01_19.md) - 快速开始指南

---

**完成时间**: 2026-01-19  
**状态**: ✅ **服务发现流程已完全实现，支持真正的热插拔！**
