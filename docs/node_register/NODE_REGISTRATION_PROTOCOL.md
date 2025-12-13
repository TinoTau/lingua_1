# 节点注册协议规范

**最后更新**: 2025-01-XX  
**版本**: 1.0

---

## 📋 概述

本文档详细说明节点注册的 WebSocket 消息协议，包括消息格式、字段说明、错误处理等。

## 🔌 WebSocket 连接

### 连接端点

```
wss://dispatcher.example.com/ws/node
```

### 连接建立

1. 节点建立 WebSocket 连接
2. 连接成功后，节点应立即发送 `node_register` 消息
3. 服务器验证后返回 `node_register_ack` 或 `node_error`

---

## 📨 消息类型

### 1. 节点注册消息 (`node_register`)

**方向**：节点 → 服务器

**说明**：节点向服务器注册，上报硬件信息、模型列表和功能支持。

**消息格式**：
```json
{
  "type": "node_register",
  "node_id": "node-abc-001" | null,
  "version": "1.0.0",
  "platform": "windows" | "linux" | "macos",
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
      "kind": "asr" | "nmt" | "tts" | "vad" | "emotion" | "other",
      "src_lang": "zh" | null,
      "tgt_lang": "en" | null,
      "dialect": "cn" | null,
      "version": "1.0.0",
      "enabled": true
    }
  ],
  "features_supported": {
    "emotion_detection": true | null,
    "voice_style_detection": false | null,
    "speech_rate_detection": true | null,
    "speech_rate_control": false | null,
    "speaker_identification": false | null,
    "persona_adaptation": false | null
  },
  "accept_public_jobs": true
}
```

**字段说明**：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `string` | ✅ | 消息类型，固定为 `"node_register"` |
| `node_id` | `string \| null` | ⚠️ | 节点 ID，首次注册时为 `null`，服务器会分配；重新连接时使用之前保存的 `node_id` |
| `version` | `string` | ✅ | 节点客户端版本号 |
| `platform` | `string` | ✅ | 平台类型：`"windows"` \| `"linux"` \| `"macos"` |
| `hardware` | `HardwareInfo` | ✅ | 硬件信息对象 |
| `hardware.cpu_cores` | `number` | ✅ | CPU 核心数 |
| `hardware.memory_gb` | `number` | ✅ | 内存大小（GB） |
| `hardware.gpus` | `Array<GpuInfo>` | ✅ | **GPU 信息列表（必需，至少包含一个 GPU）** |
| `hardware.gpus[].name` | `string` | ✅ | GPU 名称 |
| `hardware.gpus[].memory_gb` | `number` | ✅ | GPU 显存大小（GB） |
| `installed_models` | `Array<InstalledModel>` | ✅ | 已安装的模型列表 |
| `installed_models[].model_id` | `string` | ✅ | 模型唯一标识符 |
| `installed_models[].kind` | `string` | ✅ | 模型类型 |
| `installed_models[].src_lang` | `string \| null` | ⚠️ | 源语言代码（NMT 模型必需） |
| `installed_models[].tgt_lang` | `string \| null` | ⚠️ | 目标语言代码（NMT/TTS 模型必需） |
| `installed_models[].dialect` | `string \| null` | ❌ | 方言代码（可选） |
| `installed_models[].version` | `string` | ✅ | 模型版本号 |
| `installed_models[].enabled` | `boolean` | ❌ | 模型是否启用（可选，默认 `true`） |
| `features_supported` | `FeatureFlags` | ✅ | 支持的功能标志对象 |
| `features_supported.emotion_detection` | `boolean \| null` | ❌ | 情感检测支持 |
| `features_supported.voice_style_detection` | `boolean \| null` | ❌ | 音色风格检测支持 |
| `features_supported.speech_rate_detection` | `boolean \| null` | ❌ | 语速检测支持 |
| `features_supported.speech_rate_control` | `boolean \| null` | ❌ | 语速控制支持 |
| `features_supported.speaker_identification` | `boolean \| null` | ❌ | 说话人识别支持 |
| `features_supported.persona_adaptation` | `boolean \| null` | ❌ | 角色适应支持 |
| `accept_public_jobs` | `boolean` | ✅ | 是否接受公共任务 |

**验证规则**：

1. **GPU 要求**（强制）：
   - `hardware.gpus` 不能为 `null` 或空数组
   - 如果 `hardware.gpus` 为空，服务器返回 `node_error`，错误码为 `NO_GPU_AVAILABLE`

2. **模型要求**：
   - `installed_models` 不能为空数组
   - 至少需要包含一个核心模型（ASR、NMT 或 TTS）

3. **平台验证**：
   - `platform` 必须是 `"windows"`、`"linux"` 或 `"macos"` 之一

---

### 2. 注册确认消息 (`node_register_ack`)

**方向**：服务器 → 节点

**说明**：服务器确认节点注册成功，返回分配的节点 ID。

**消息格式**：
```json
{
  "type": "node_register_ack",
  "node_id": "node-ABC12345",
  "message": "registered"
}
```

**字段说明**：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `string` | ✅ | 消息类型，固定为 `"node_register_ack"` |
| `node_id` | `string` | ✅ | 节点 ID（如果节点首次注册，服务器分配；如果节点提供了 `node_id`，服务器返回相同的 ID） |
| `message` | `string` | ✅ | 确认消息，固定为 `"registered"` |

**节点处理**：

1. 保存 `node_id` 到本地配置
2. 开始发送心跳消息（`node_heartbeat`）
3. 更新 UI 显示注册成功状态

---

### 3. 节点错误消息 (`node_error`)

**方向**：服务器 → 节点

**说明**：服务器返回节点注册失败的错误信息。

**消息格式**：
```json
{
  "type": "node_error",
  "node_id": "node-abc-001" | null,
  "code": "NO_GPU_AVAILABLE" | "INVALID_MESSAGE" | "INTERNAL_ERROR",
  "message": "节点注册失败: 必须提供 GPU 信息",
  "details": {
    "field": "hardware.gpus",
    "reason": "GPU 列表为空"
  } | null
}
```

**字段说明**：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `string` | ✅ | 消息类型，固定为 `"node_error"` |
| `node_id` | `string \| null` | ⚠️ | 节点 ID（如果注册失败，可能为 `null`） |
| `code` | `string` | ✅ | 错误码 |
| `message` | `string` | ✅ | 错误消息（人类可读） |
| `details` | `object \| null` | ❌ | 错误详情（可选，用于调试） |

**错误码列表**：

| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `NO_GPU_AVAILABLE` | 节点没有 GPU | 检查 GPU 是否已安装并正确识别，确保 `hardware.gpus` 不为空 |
| `INVALID_MESSAGE` | 消息格式错误 | 检查消息格式是否符合协议规范 |
| `INTERNAL_ERROR` | 服务器内部错误 | 稍后重试，或联系管理员 |

**节点处理**：

1. 记录错误日志
2. 显示错误信息给用户
3. 根据错误码提供解决建议
4. **不开始心跳**（因为注册失败）

---

## 🔄 注册流程示例

### 成功注册流程

```
节点                         服务器
  |                            |
  |--- WebSocket 连接 --------->|
  |                            |
  |<-- 连接成功 ----------------|
  |                            |
  |--- node_register --------->|
  |  (node_id: null)           |
  |                            | 验证 GPU 要求
  |                            | 验证模型信息
  |                            | 创建节点记录
  |<-- node_register_ack ------|
  |  (node_id: "node-ABC12345")|
  |                            |
  | 保存 node_id               |
  | 开始心跳                   |
  |--- node_heartbeat -------->|
  |                            |
```

### 注册失败流程（GPU 错误）

```
节点                         服务器
  |                            |
  |--- WebSocket 连接 --------->|
  |                            |
  |<-- 连接成功 ----------------|
  |                            |
  |--- node_register --------->|
  |  (gpus: [])                |
  |                            | 验证 GPU 要求
  |                            | ❌ GPU 列表为空
  |<-- node_error -------------|
  |  (code: "NO_GPU_AVAILABLE")|
  |                            |
  | 显示错误信息               |
  | 提示用户检查 GPU           |
  | 不开始心跳                 |
  |                            |
```

---

## 📝 TypeScript 类型定义

```typescript
// 节点注册消息
export interface NodeRegisterMessage {
  type: 'node_register';
  node_id: string | null;
  version: string;
  platform: 'windows' | 'linux' | 'macos';
  hardware: {
    cpu_cores: number;
    memory_gb: number;
    gpus: Array<{
      name: string;
      memory_gb: number;
    }>;
  };
  installed_models: Array<{
    model_id: string;
    kind: 'asr' | 'nmt' | 'tts' | 'vad' | 'emotion' | 'other';
    src_lang: string | null;
    tgt_lang: string | null;
    dialect: string | null;
    version: string;
    enabled?: boolean;
  }>;
  features_supported: {
    emotion_detection?: boolean | null;
    voice_style_detection?: boolean | null;
    speech_rate_detection?: boolean | null;
    speech_rate_control?: boolean | null;
    speaker_identification?: boolean | null;
    persona_adaptation?: boolean | null;
  };
  accept_public_jobs: boolean;
}

// 注册确认消息
export interface NodeRegisterAckMessage {
  type: 'node_register_ack';
  node_id: string;
  message: 'registered';
}

// 节点错误消息
export interface NodeErrorMessage {
  type: 'node_error';
  node_id: string | null;
  code: 'NO_GPU_AVAILABLE' | 'INVALID_MESSAGE' | 'INTERNAL_ERROR';
  message: string;
  details?: Record<string, unknown> | null;
}
```

---

## 🔗 相关文档

- [节点注册功能说明](./NODE_REGISTRATION_GUIDE.md) - 功能说明和实现指南
- [节点注册 UI 设计](./NODE_REGISTRATION_UI.md) - UI 设计说明
- [WebSocket 协议规范](../PROTOCOLS.md) - 完整的 WebSocket 消息协议

---

## 📝 更新日志

- **2025-01-XX**: 初始版本，包含完整的协议规范和错误处理说明

