# Pool 架构节点端需求分析

## 当前节点端情况

### 1. ✅ 能够提供的信息

节点端当前**已经可以获取**以下信息：

#### GPU 信息（完整）
- GPU 名称（如 "NVIDIA RTX 4070"）
- GPU 显存大小（如 12 GB）
- 来源：`node-agent-hardware.ts` 通过 `nvidia-smi` 命令获取

#### 平台信息
- 操作系统：`windows` | `linux` | `macos`
- 来源：`node-agent-hardware.ts` 的 `getPlatform()` 方法

### 2. ❓ 需要添加的信息

#### `region` (区域)
**当前状态**：未提供  
**建议实现方式**：

##### 方案 1：配置文件（推荐，简单可靠）
```json
// electron-node-config.json
{
  "servicePreferences": {...},
  "poolConfig": {
    "region": "global",
    "gpuTier": "auto"  // 或 "lite", "standard", "pro", "mixed"
  }
}
```

##### 方案 2：自动检测（可选，复杂）
```typescript
// 通过 IP 地理位置 API 检测
async function detectRegion(): Promise<string> {
  try {
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json();
    const country = data.country_code;
    
    // 映射到区域
    const REGION_MAP: Record<string, string> = {
      'AU': 'ap-southeast-2',
      'CN': 'ap-east-1',
      'JP': 'ap-northeast-1',
      'US': 'us-west-1',
      'GB': 'eu-west-1',
      'DE': 'eu-central-1',
    };
    
    return REGION_MAP[country] || 'global';
  } catch (error) {
    return 'global';  // 默认全局
  }
}
```

##### 方案 3：环境变量
```typescript
const region = process.env.NODE_REGION || 'global';
```

#### `gpu_tier` (GPU 档位)
**当前状态**：未提供  
**建议实现方式**：

##### 方案 1：从 GPU 信息自动判断（推荐）
```typescript
// 在 node-agent-hardware.ts 中添加
function detectGpuTier(gpuInfo: { name: string; memory_gb: number }): string {
  // GPU 型号映射表
  const GPU_TIER_MAP: Record<string, string> = {
    // Pro 档位（高端）
    'RTX 4090': 'pro',
    'RTX 4080': 'pro',
    'RTX 3090': 'pro',
    'RTX 3090 Ti': 'pro',
    'A100': 'pro',
    'A6000': 'pro',
    
    // Standard 档位（中端）
    'RTX 4070': 'standard',
    'RTX 4070 Ti': 'standard',
    'RTX 4060 Ti': 'standard',
    'RTX 3080': 'standard',
    'RTX 3070': 'standard',
    'RTX 3070 Ti': 'standard',
    
    // Lite 档位（入门）
    'RTX 4060': 'lite',
    'RTX 3060': 'lite',
    'RTX 3050': 'lite',
    'RTX 2060': 'lite',
    'GTX 1660': 'lite',
  };
  
  // 方法 1: 根据型号查找
  for (const [modelPattern, tier] of Object.entries(GPU_TIER_MAP)) {
    if (gpuInfo.name.includes(modelPattern)) {
      return tier;
    }
  }
  
  // 方法 2: 根据显存大小判断
  if (gpuInfo.memory_gb >= 24) return 'pro';
  if (gpuInfo.memory_gb >= 12) return 'standard';
  if (gpuInfo.memory_gb >= 6) return 'lite';
  
  // 默认
  return 'mixed';
}
```

##### 方案 2：配置文件（手动指定）
```json
{
  "poolConfig": {
    "region": "global",
    "gpuTier": "standard"  // 用户手动配置
  }
}
```

## 实现计划

### Phase 1: 配置文件支持（最简单）

#### 1. 更新配置结构
文件：`electron_node/electron-node/main/node-config.js`

```typescript
const DEFAULT_CONFIG = {
  servicePreferences: {
    rustEnabled: true,
    nmtEnabled: true,
    ttsEnabled: true,
    yourttsEnabled: false,
  },
  // 新增：Pool 配置
  poolConfig: {
    region: 'global',      // 区域，默认全局
    gpuTier: 'auto',       // GPU 档位，'auto' 表示自动检测
  },
};
```

#### 2. 添加 GPU Tier 检测逻辑
文件：`electron_node/electron-node/main/src/agent/node-agent-hardware.ts`

```typescript
/**
 * 根据 GPU 信息检测算力档位
 */
detectGpuTier(gpuInfo?: { name: string; memory_gb: number }): string {
  if (!gpuInfo) return 'mixed';
  
  // GPU 型号映射表（部分示例）
  const GPU_TIER_MAP: Record<string, string> = {
    'RTX 4090': 'pro',
    'RTX 4080': 'pro',
    'RTX 4070': 'standard',
    'RTX 3070': 'standard',
    'RTX 3060': 'lite',
    'RTX 3050': 'lite',
  };
  
  // 先尝试型号匹配
  for (const [model, tier] of Object.entries(GPU_TIER_MAP)) {
    if (gpuInfo.name.includes(model)) {
      return tier;
    }
  }
  
  // 再根据显存判断
  if (gpuInfo.memory_gb >= 24) return 'pro';
  if (gpuInfo.memory_gb >= 12) return 'standard';
  if (gpuInfo.memory_gb >= 6) return 'lite';
  
  return 'mixed';
}
```

#### 3. 更新注册逻辑
文件：`electron_node/electron-node/main/src/agent/node-agent-registration.ts`

```typescript
async registerNode(): Promise<void> {
  // ... 现有代码 ...
  
  // 获取硬件信息
  const hardware = await this.hardwareHandler.getHardwareInfo();
  
  // 读取配置
  const config = loadNodeConfig();
  
  // 获取 region（从配置）
  const region = config.poolConfig?.region || 'global';
  
  // 获取 gpu_tier（自动检测或从配置）
  let gpuTier = config.poolConfig?.gpuTier || 'auto';
  if (gpuTier === 'auto') {
    // 自动检测：使用第一个 GPU 的信息
    const primaryGpu = hardware.gpus?.[0];
    gpuTier = this.hardwareHandler.detectGpuTier(primaryGpu);
  }
  
  // 构建注册消息
  const message: NodeRegisterMessage = {
    type: 'node_register',
    node_id: this.nodeId || null,
    version: '2.0.0',
    capability_schema_version: '2.0',
    platform: this.hardwareHandler.getPlatform(),
    
    // 新增字段
    region: region,
    gpu_tier: gpuTier,
    
    hardware: hardware,
    installed_models: installedModels,
    // ... 其他字段 ...
  };
  
  // 发送
  this.ws.send(JSON.stringify(message));
}
```

#### 4. 更新协议定义
文件：`electron_node/shared/protocols/messages.ts`

```typescript
export interface NodeRegisterMessage {
  type: 'node_register';
  node_id: string | null;
  version: string;
  capability_schema_version?: string;
  platform: 'windows' | 'linux' | 'macos';
  
  // 新增：Pool 分层维度
  region?: string;      // 节点区域
  gpu_tier?: string;    // GPU 档位
  
  hardware: HardwareInfo;
  installed_models: InstalledModel[];
  // ... 其他字段 ...
}
```

### Phase 2: 自动检测增强（可选）

如果需要更智能的区域检测，可以添加：

```typescript
// 文件：electron_node/electron-node/main/src/utils/region-detector.ts
export class RegionDetector {
  private static cache: string | null = null;
  
  static async detect(): Promise<string> {
    // 使用缓存
    if (this.cache) return this.cache;
    
    try {
      // 方法 1: 通过 IP API
      const response = await fetch('https://ipapi.co/json/', { timeout: 3000 });
      const data = await response.json();
      
      const REGION_MAP: Record<string, string> = {
        'AU': 'ap-southeast-2',
        'CN': 'ap-east-1',
        'JP': 'ap-northeast-1',
        'US': 'us-west-1',
        'GB': 'eu-west-1',
        'DE': 'eu-central-1',
      };
      
      this.cache = REGION_MAP[data.country_code] || 'global';
      return this.cache;
    } catch (error) {
      logger.warn({ error }, 'Failed to detect region, using global');
      return 'global';
    }
  }
}
```

## 配置示例

### 用户配置文件（推荐方式）
```json
// electron-node-config.json
{
  "servicePreferences": {
    "rustEnabled": true,
    "nmtEnabled": true,
    "ttsEnabled": true,
    "yourttsEnabled": false
  },
  "poolConfig": {
    "region": "ap-southeast-2",  // 手动指定区域
    "gpuTier": "auto"             // 自动检测 GPU 档位
  }
}
```

### 默认配置（自动检测）
```json
{
  "servicePreferences": {...},
  "poolConfig": {
    "region": "global",  // 默认全局
    "gpuTier": "auto"    // 自动检测
  }
}
```

## 总结

### ✅ 节点端完全可以提供这些信息

1. **region**：
   - 简单方案：从配置文件读取
   - 高级方案：自动检测（IP 地理位置）
   - 默认值：`"global"`

2. **gpu_tier**：
   - 简单方案：从 GPU 型号/显存自动判断（推荐）
   - 备选方案：从配置文件读取
   - 默认值：`"mixed"`

### 工作量估计

- **最小修改**（仅配置文件）：1-2小时
- **推荐方案**（配置 + GPU自动检测）：2-3小时
- **完整方案**（+ 区域自动检测）：3-4小时

### 建议实现顺序

1. **第一步**：添加配置文件支持（`poolConfig`）
2. **第二步**：添加 GPU Tier 自动检测逻辑
3. **第三步**：更新注册消息
4. **第四步**（可选）：添加区域自动检测

所有这些都可以在节点端完成，不需要服务端推断！
