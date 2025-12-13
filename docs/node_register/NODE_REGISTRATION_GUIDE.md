# 节点注册功能说明

**最后更新**: 2025-01-XX  
**版本**: 1.0

---

## 📋 概述

节点注册是 Electron Node 客户端连接到调度服务器并成为算力提供方的关键步骤。本文档详细说明节点注册的功能要求、流程、错误处理和最佳实践。

## 🎯 核心要求

### 1. GPU 要求（强制）

**重要**：节点必须有 GPU 才能注册为算力提供方。

- **原因**：GPU 是保证翻译效率的必要条件，没有 GPU 的节点无法提供足够的计算性能
- **检查时机**：节点注册时，调度服务器会强制检查 `hardware.gpus` 字段
- **失败处理**：如果节点没有 GPU，注册将失败，服务器返回 `node_error` 消息，错误码为 `NO_GPU_AVAILABLE`

### 2. 硬件信息要求

节点需要上报以下硬件信息：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `cpu_cores` | `number` | ✅ | CPU 核心数 |
| `memory_gb` | `number` | ✅ | 内存大小（GB） |
| `gpus` | `Array<GpuInfo>` | ✅ | GPU 信息列表（至少包含一个 GPU） |

**GPU 信息结构**：
```typescript
interface GpuInfo {
  name: string;        // GPU 名称，如 "RTX 3070"
  memory_gb: number;   // GPU 显存大小（GB）
}
```

### 3. 模型信息要求

节点需要上报已安装的模型列表：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `model_id` | `string` | ✅ | 模型唯一标识符 |
| `kind` | `string` | ✅ | 模型类型：`"asr"` \| `"nmt"` \| `"tts"` \| `"vad"` \| `"emotion"` \| `"other"` |
| `src_lang` | `string \| null` | ⚠️ | 源语言代码（NMT 模型必需） |
| `tgt_lang` | `string \| null` | ⚠️ | 目标语言代码（NMT/TTS 模型必需） |
| `dialect` | `string \| null` | ❌ | 方言代码（可选） |
| `version` | `string` | ✅ | 模型版本号 |
| `enabled` | `boolean` | ❌ | 模型是否启用（可选，默认 `true`） |

### 4. 功能支持要求

节点需要上报支持的功能标志：

| 功能 | 类型 | 说明 |
|------|------|------|
| `emotion_detection` | `boolean \| null` | 情感检测 |
| `voice_style_detection` | `boolean \| null` | 音色风格检测 |
| `speech_rate_detection` | `boolean \| null` | 语速检测 |
| `speech_rate_control` | `boolean \| null` | 语速控制 |
| `speaker_identification` | `boolean \| null` | 说话人识别 |
| `persona_adaptation` | `boolean \| null` | 角色适应 |

---

## 🔄 注册流程

### 流程图

```
节点启动
  ↓
连接到调度服务器 WebSocket
  ↓
获取硬件信息（包括 GPU）
  ↓
获取已安装模型列表
  ↓
获取支持的功能标志
  ↓
发送 node_register 消息
  ↓
等待服务器响应
  ↓
┌─────────────────┬─────────────────┐
│  注册成功        │   注册失败       │
│  node_register_ack│  node_error     │
│  保存 node_id    │  显示错误信息    │
│  开始心跳        │  提示用户        │
└─────────────────┴─────────────────┘
```

### 详细步骤

#### 步骤 1：建立 WebSocket 连接

节点连接到调度服务器的 WebSocket 端点：

```
wss://dispatcher.example.com/ws/node
```

#### 步骤 2：准备注册信息

节点需要准备以下信息：

1. **硬件信息**：
   - 获取 CPU 核心数
   - 获取内存大小
   - **获取 GPU 信息**（必需）

2. **模型信息**：
   - 扫描已安装的模型
   - 构建模型列表

3. **功能支持**：
   - 根据已安装的模型和模块确定支持的功能

#### 步骤 3：发送注册消息

节点发送 `node_register` 消息：

```json
{
  "type": "node_register",
  "node_id": null,  // 首次注册时为 null，服务器会分配
  "version": "1.0.0",
  "platform": "windows",
  "hardware": {
    "cpu_cores": 16,
    "memory_gb": 32,
    "gpus": [
      {
        "name": "RTX 3070",
        "memory_gb": 8
      }
    ]
  },
  "installed_models": [
    {
      "model_id": "mdl-nmt-zh-en-base-v1",
      "kind": "nmt",
      "src_lang": "zh",
      "tgt_lang": "en",
      "dialect": null,
      "version": "1.0.0",
      "enabled": true
    }
  ],
  "features_supported": {
    "emotion_detection": true,
    "voice_style_detection": false,
    "speech_rate_detection": true
  },
  "accept_public_jobs": true
}
```

#### 步骤 4：处理服务器响应

**成功响应** (`node_register_ack`)：
```json
{
  "type": "node_register_ack",
  "node_id": "node-ABC12345",
  "message": "registered",
  "status": "registering"
}
```

节点应该：
- 保存 `node_id` 供后续使用
- 注意初始状态为 `"registering"`，需要等待健康检查通过后转为 `"ready"`
- 开始发送心跳消息（建议每 15 秒一次）
- 监听 `node_status` 消息，根据状态变化更新 UI
- 更新 UI 显示注册成功状态（但状态为 `registering`，尚未就绪）

**失败响应** (`node_error`)：
```json
{
  "type": "node_error",
  "node_id": null,
  "code": "NO_GPU_AVAILABLE",
  "message": "节点注册失败: 必须提供 GPU 信息",
  "details": null
}
```

节点应该：
- 显示错误信息给用户
- 提示用户检查 GPU 配置
- 不开始心跳（因为注册失败）

---

## ⚠️ 错误处理

### 错误码列表

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `NO_GPU_AVAILABLE` | 节点没有 GPU | 检查 GPU 是否已安装并正确识别，确保 `hardware.gpus` 不为空 |
| `INVALID_MESSAGE` | 消息格式错误 | 检查消息格式是否符合协议规范 |
| `INTERNAL_ERROR` | 服务器内部错误 | 稍后重试，或联系管理员 |

### 常见错误场景

#### 1. GPU 未检测到

**原因**：
- GPU 驱动未安装
- GPU 信息获取代码未实现（TODO）
- GPU 信息获取失败

**解决方案**：
1. 检查 GPU 驱动是否已安装
2. 实现 GPU 信息获取功能（使用 `nvidia-ml-py` 或 `systeminformation`）
3. 确保 `getHardwareInfo()` 方法正确返回 GPU 信息

**代码示例**（需要实现）：
```typescript
private async getHardwareInfo(): Promise<HardwareInfo> {
  // TODO: 实现 GPU 信息获取
  // 使用 nvidia-ml-py 或 systeminformation 获取 GPU 信息
  const gpus = await this.getGpuInfo(); // 需要实现
  
  if (gpus.length === 0) {
    throw new Error('未检测到 GPU，无法注册节点');
  }
  
  return {
    cpu_cores: os.cpus().length,
    memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    gpus: gpus,
  };
}
```

#### 2. 模型信息不完整

**原因**：
- 模型列表为空
- 模型信息字段缺失

**解决方案**：
- 确保至少安装一个核心模型（ASR、NMT、TTS）
- 检查模型元数据是否完整

#### 3. 网络连接问题

**原因**：
- WebSocket 连接失败
- 网络超时

**解决方案**：
- 检查网络连接
- 检查调度服务器地址和端口
- 实现重连机制

---

## 🔧 实现指南

### Electron Node 客户端实现

#### 1. 获取硬件信息

**当前状态**：`getHardwareInfo()` 方法中 GPU 信息获取是 TODO

**需要实现**：
- 使用 `nvidia-ml-py`（Python 脚本）获取 NVIDIA GPU 信息
- 或使用 `systeminformation` 库获取 GPU 信息（如果支持）

**参考实现**：
```typescript
private async getHardwareInfo(): Promise<HardwareInfo> {
  const mem = await si.mem();
  const cpu = await si.cpu();
  
  // 获取 GPU 信息
  const gpus = await this.getGpuInfo();
  
  if (gpus.length === 0) {
    throw new Error('未检测到 GPU');
  }
  
  return {
    cpu_cores: cpu.cores || os.cpus().length,
    memory_gb: Math.round(mem.total / (1024 * 1024 * 1024)),
    gpus: gpus,
  };
}

private async getGpuInfo(): Promise<Array<{ name: string; memory_gb: number }>> {
  // TODO: 实现 GPU 信息获取
  // 方案 1: 使用 nvidia-ml-py Python 脚本
  // 方案 2: 使用 systeminformation 库（如果支持）
  return [];
}
```

#### 2. 处理注册响应

**当前状态**：只处理了 `node_register_ack`，未处理 `node_error`

**需要实现**：
```typescript
private async handleMessage(data: string): Promise<void> {
  const message = JSON.parse(data);
  
  switch (message.type) {
    case 'node_register_ack': {
      const ack = message as NodeRegisterAckMessage;
      this.nodeId = ack.node_id;
      logger.info({ nodeId: this.nodeId }, '节点注册成功');
      
      // 通知 UI 更新状态
      this.notifyRegistrationSuccess(ack.node_id);
      
      // 开始心跳
      this.startHeartbeat();
      break;
    }
    
    case 'node_error': {
      const error = message as NodeErrorMessage;
      logger.error({ error }, '节点注册失败');
      
      // 通知 UI 显示错误
      this.notifyRegistrationError(error.code, error.message);
      break;
    }
    
    // ... 其他消息处理
  }
}
```

#### 3. UI 状态更新

**需要实现**：
- 注册中状态显示
- 注册成功状态显示
- 注册失败错误提示

**参考实现**：
```typescript
// 在 NodeStatus 组件中
interface NodeStatusProps {
  status: {
    online: boolean;
    nodeId: string | null;
    connected: boolean;
    registrationStatus: 'idle' | 'registering' | 'success' | 'failed';
    registrationError?: string;
  } | null;
}
```

---

## 📊 最佳实践

### 1. GPU 信息获取

- **优先使用**：`nvidia-ml-py`（Python 脚本）获取 NVIDIA GPU 信息
- **备选方案**：`systeminformation` 库（如果支持）
- **错误处理**：如果无法获取 GPU 信息，应该明确提示用户，而不是返回空数组

### 2. 注册重试机制

- 如果注册失败（非 GPU 错误），可以实现自动重试
- 如果 GPU 错误，不应该自动重试，应该提示用户

### 3. 状态持久化

- 保存 `node_id` 到本地配置，下次连接时使用
- 如果服务器分配的 `node_id` 与本地保存的不一致，使用服务器分配的

### 4. 用户提示

- 注册失败时，应该显示清晰的错误信息
- GPU 错误时，应该提供解决建议（检查驱动、检查硬件等）

---

---

## ✅ 流程完整性检查

### 完整流程清单

节点注册流程包含以下步骤，所有步骤均已实现：

1. ✅ **WebSocket 连接建立** - 节点连接到 `/ws/node` 端点
2. ✅ **发送 node_register 消息** - 包含硬件信息、模型列表、功能标志等
3. ✅ **服务器验证** - GPU 要求检查、node_id 冲突检测、capability_schema_version 验证
4. ✅ **返回 node_register_ack** - 包含 `node_id` 和初始状态 `"registering"`
5. ✅ **注册连接** - 将 WebSocket 连接注册到 `NodeConnectionManager`
6. ✅ **节点开始心跳** - 服务器端已准备好处理心跳消息
7. ✅ **状态转换** - `registering → ready`（连续 3 次心跳正常）
8. ✅ **定期扫描兜底** - 30 秒间隔处理超时和 warmup 超时
9. ✅ **node_status 消息发送** - 状态变化时通知节点
10. ✅ **调度过滤** - 只选择 `status == ready` 的节点

### 详细流程时序图

```
节点端                          调度服务器
  |                                |
  |-- WebSocket 连接 ------------->|
  |                                |
  |-- node_register 消息 --------->|
  |                                |-- 验证 GPU 要求
  |                                |-- 验证 node_id 冲突
  |                                |-- 验证 capability_schema_version
  |                                |-- 注册节点（status = registering）
  |                                |-- 注册连接
  |<-- node_register_ack ----------|
  |   (status: "registering")      |
  |                                |
  |-- node_heartbeat #1 ---------->|
  |                                |-- 更新资源使用率
  |                                |-- on_heartbeat()
  |                                |-- 健康检查（通过）
  |                                |-- 记录健康检查历史（1/3）
  |                                |
  |-- node_heartbeat #2 ---------->|
  |                                |-- 健康检查（通过）
  |                                |-- 记录健康检查历史（2/3）
  |                                |
  |-- node_heartbeat #3 ---------->|
  |                                |-- 健康检查（通过）
  |                                |-- 记录健康检查历史（3/3）
  |                                |-- 状态转换：registering → ready
  |<-- node_status ----------------|
  |   (status: "ready")            |
  |                                |
  |-- node_heartbeat (持续) ------>|
  |                                |-- 健康检查
  |                                |-- 状态保持或转换
```

### 状态转换机制

**触发机制**：
- **立即触发**：事件驱动（心跳、任务完成等）
- **定期兜底**：定时任务（30 秒扫描）

**转换条件**：
- `registering → ready`：连续 3 次心跳正常 + 必需模型 ready + GPU 可用
- `ready → degraded`：5 次内失败≥3 次或连续失败 3 次
- `degraded → ready`：健康检查恢复通过
- `any → offline`：心跳超时（45 秒）

---

## 🔗 相关文档

- [节点注册协议规范](./NODE_REGISTRATION_PROTOCOL.md) - 详细的协议说明
- [节点注册 UI 设计](./NODE_REGISTRATION_UI.md) - UI 设计说明
- [节点注册规范 v1.1-aligned](./NODE_REGISTRATION_SPECIFICATION_v1.1-aligned.md) - ⭐ **权威规范（开发参考）**
- [节点状态和测试规范](./NODE_STATUS_AND_TESTS_v1.md) - 状态机定义和测试清单
- [实现状态](./IMPLEMENTATION_STATUS.md) - 详细的实现状态和完成情况
- [WebSocket 协议规范](../PROTOCOLS.md) - 完整的 WebSocket 消息协议
- [Electron Node 实现文档](../electron_node/STAGE2.2_IMPLEMENTATION.md) - Electron Node 客户端实现

---

## 📝 更新日志

- **2025-01-XX**: 初始版本，包含 GPU 要求、注册流程、错误处理说明
- **2025-01-XX**: 合并流程完整性检查内容

