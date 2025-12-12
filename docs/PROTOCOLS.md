# WebSocket 消息协议规范（草稿）

版本：v0.1  
适用对象：调度服务器、移动端会话设备、Electron Node 客户端开发人员。

本文档定义了：

- **移动端（手机 App） ↔ 调度服务器** 的 WebSocket 消息格式；
- **第三方节点（Electron Node 客户端） ↔ 调度服务器** 的 WebSocket 消息格式。

> 说明：以下示例及接口命名与当前 `ARCHITECTURE.md`、`modular/MODULAR_FEATURES.md` 中的设计保持一致，实际开发中可根据代码实现做微调与补充。

---

## 1. 通用约定

### 1.1 传输格式

- 所有消息以 **JSON 文本** 通过 WebSocket 发送。
- 每条消息必须包含一个顶层字段：

```jsonc
{
  "type": "string",  // 消息类型，用于区分不同语义
  "...": "其他字段"
}
```

### 1.2 ID 与语言码

- `session_id`：字符串，由服务器生成并在会话建立时返回。
- `node_id`：字符串，由节点在首次注册时生成（或服务器分配）。
- `job_id`：字符串，由调度服务器生成，用于标识句级任务。
- 语言码：
  - `src_lang` / `tgt_lang` 使用简化语言标识（如 `"zh"`, `"en"`），后续可扩展为 BCP-47。

### 1.3 错误处理

- 协议层错误使用 `type = "error"` 消息返回。
- 对于无法解析的消息，推荐做法：
  - 日志记录；
  - 返回 `error` 消息（如果能识别基础结构）；
  - 必要时关闭连接。

---

## 2. 移动端 ↔ 调度服务器 协议

移动端通过 WebSocket 连接调度服务器，例如：

```text
wss://dispatcher.example.com/ws/session
```

### 2.1 会话建立与认证（可选）

#### 2.1.1 客户端 → 服务器：会话初始化

```jsonc
{
  "type": "session_init",
  "client_version": "1.0.0",
  "platform": "android",       // "ios" | "android" | "web"
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,             // 可选，例如 "zh-sichuan"
  "features": {                // 可选模块开关（参考 modular/MODULAR_FEATURES.md）
    "emotion_detection": false,
    "voice_style_detection": false,
    "speech_rate_detection": false
  },
  "pairing_code": null         // 非空时表示希望绑定到指定节点（6位安全码）
}
```

#### 2.1.2 服务器 → 客户端：会话初始化响应

```jsonc
{
  "type": "session_init_ack",
  "session_id": "sess-123456",
  "assigned_node_id": null,    // 若指定节点绑定成功，可返回实际 node_id
  "message": "session created"
}
```

如果 `pairing_code` 无效，可以返回：

```jsonc
{
  "type": "error",
  "code": "INVALID_PAIRING_CODE",
  "message": "Pairing code not found or expired"
}
```

---

### 2.2 句级音频上传（utterance）

移动端使用 **轻量 VAD + 手动截断** 的方式决定何时发送一句话的音频。

#### 2.2.1 客户端 → 服务器：上传 utterance

```jsonc
{
  "type": "utterance",
  "session_id": "sess-123456",
  "utterance_index": 4,         // 当前会话内的句序号（递增）
  "manual_cut": true,           // 是否由用户手动截断
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,
  "features": {                 // 可选模块开关，覆盖会话默认值（可选）
    "emotion_detection": false,
    "voice_style_detection": false,
    "speech_rate_detection": true
  },
  "audio": "base64-encoded-audio-data",
  "audio_format": "pcm16",      // 或 "wav", "opus" 等
  "sample_rate": 16000
}
```

> 说明：  
> - `utterance_index` 由客户端自增，服务器按此顺序聚合结果。  
> - `features` 不填时使用会话初始化时的默认配置。

---

### 2.3 翻译结果返回

调度服务器收到节点返回结果后，将结果推送给移动端。

#### 2.3.1 服务器 → 客户端：翻译结果

```jsonc
{
  "type": "translation_result",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "job_id": "job-xyz-789",
  "text_asr": "今天天气不错。",
  "text_translated": "The weather is nice today.",
  "tts_audio": "base64-encoded-tts-audio",
  "tts_format": "pcm16",
  "extra": {
    "emotion": null,             // 例如 "happy"（如启用情感分析）
    "speech_rate": 1.2,          // 可选模块输出
    "voice_style": null
  }
}
```

> 注：  
> - 即使部分可选模块未启用，对应字段可以为 `null` 或直接省略。  
> - 客户端应按 `utterance_index` 排序展示或播放。

---

### 2.4 会话控制与心跳

#### 2.4.1 客户端 → 服务器：心跳（可选）

如果需要应用层心跳（WebSocket 本身的 Ping/Pong 之外）：

```jsonc
{
  "type": "client_heartbeat",
  "session_id": "sess-123456",
  "timestamp": 1733800000000
}
```

服务器可以按需返回：

```jsonc
{
  "type": "server_heartbeat",
  "session_id": "sess-123456",
  "timestamp": 1733800000500
}
```

#### 2.4.2 客户端 → 服务器：结束会话

```jsonc
{
  "type": "session_close",
  "session_id": "sess-123456",
  "reason": "user_finished"     // 或 "network_error", "app_exit" 等
}
```

服务器可回复：

```jsonc
{
  "type": "session_close_ack",
  "session_id": "sess-123456"
}
```

---

### 2.5 错误消息（移动端侧）

服务器在解析或处理移动端消息时出现错误，可以返回：

```jsonc
{
  "type": "error",
  "code": "INVALID_MESSAGE",
  "message": "Missing field: audio",
  "details": {
    "field": "audio"
  }
}
```

常见 error code 建议：

- `INVALID_MESSAGE`
- `INVALID_SESSION`
- `INTERNAL_ERROR`
- `NODE_UNAVAILABLE`
- `UNSUPPORTED_FEATURE`

---

## 3. 第三方节点（Electron Node） ↔ 调度服务器 协议

Electron Node 通过 WebSocket 连接调度服务器，例如：

```text
wss://dispatcher.example.com/ws/node
```

### 3.1 节点注册与能力上报

#### 3.1.1 节点 → 服务器：初次注册 / 重新连接

```jsonc
{
  "type": "node_register",
  "node_id": "node-abc-001",       // 首次可为 null/空字符串，由服务端分配
  "version": "1.0.0",
  "platform": "windows",           // "windows" | "linux" | "macos"
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
      "version": "1.0.0"
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

#### 3.1.2 服务器 → 节点：注册确认

```jsonc
{
  "type": "node_register_ack",
  "node_id": "node-abc-001",
  "message": "registered"
}
```

> 说明：首次连接时如节点未提供 `node_id`，可由服务器生成后在 ack 中返回。

---

### 3.2 节点心跳与资源上报

#### 3.2.1 节点 → 服务器：心跳

```jsonc
{
  "type": "node_heartbeat",
  "node_id": "node-abc-001",
  "timestamp": 1733800000000,
  "resource_usage": {
    "cpu_percent": 37.5,
    "gpu_percent": 51.2,
    "gpu_mem_percent": 62.3,
    "mem_percent": 40.8,
    "running_jobs": 3
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
  ]
}
```

> 注：`installed_models` 可在心跳中减少字段，只保留更新点；具体实现可以在文档中说明。

---

### 3.3 任务下发与结果回传

#### 3.3.1 服务器 → 节点：下发 job

```jsonc
{
  "type": "job_assign",
  "job_id": "job-xyz-789",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,
  "features": {
    "emotion_detection": false,
    "voice_style_detection": false,
    "speech_rate_detection": true
  },
  "pipeline": {
    "use_asr": true,
    "use_nmt": true,
    "use_tts": true
  },
  "audio": "base64-encoded-audio-data",
  "audio_format": "pcm16",
  "sample_rate": 16000
}
```

#### 3.3.2 节点 → 服务器：job 结果

```jsonc
{
  "type": "job_result",
  "job_id": "job-xyz-789",
  "node_id": "node-abc-001",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "success": true,
  "text_asr": "今天天气不错。",
  "text_translated": "The weather is nice today.",
  "tts_audio": "base64-encoded-tts-audio",
  "tts_format": "pcm16",
  "extra": {
    "emotion": null,
    "speech_rate": 1.2,
    "voice_style": null
  },
  "processing_time_ms": 220
}
```

#### 3.3.3 节点 → 服务器：job 失败

```jsonc
{
  "type": "job_result",
  "job_id": "job-xyz-789",
  "node_id": "node-abc-001",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "success": false,
  "error": {
    "code": "MODEL_NOT_AVAILABLE",
    "message": "Required NMT model mdl-nmt-zh-en-base-v1 is not installed or disabled"
  }
}
```

调度服务器可根据错误策略决定是否重试 / 切换节点。

---

### 3.4 节点侧错误与控制消息

#### 3.4.1 节点 → 服务器：节点内部错误（非 job 级）

```jsonc
{
  "type": "node_error",
  "node_id": "node-abc-001",
  "code": "INFERENCE_BACKEND_ERROR",
  "message": "ONNX Runtime initialization failed",
  "details": {
    "backend": "onnxruntime",
    "errno": 123
  }
}
```

#### 3.4.2 服务器 → 节点：控制消息（预留）

将来可扩展如下消息类型，例如：

```jsonc
{
  "type": "node_control",
  "command": "shutdown",           // 或 "reload_config"
  "reason": "maintenance"
}
```

---

## 4. 错误码建议（草案）

统一错误码枚举（可在实现中放入 shared 库）：

- 通用：
  - `INVALID_MESSAGE`
  - `INTERNAL_ERROR`
- 会话相关：
  - `INVALID_SESSION`
  - `SESSION_CLOSED`
- 节点相关：
  - `NODE_UNAVAILABLE`
  - `NODE_OVERLOADED`
- 模型相关：
  - `MODEL_NOT_AVAILABLE`
  - `MODEL_LOAD_FAILED`
- 功能/模块相关：
  - `UNSUPPORTED_FEATURE`

---

## 5. 后续工作

- 本协议为 **草稿版本 v0.1**，建议在以下阶段同步更新：
  1. Scheduler / Node / Mobile 实现过程中，若字段名或结构调整，请更新本文件；
  2. 若新增消息类型（例如：实时部分结果 `partial_result`、会话中断通知等），也应在此处补充；
  3. 实现完首个端到端 Demo 后，可将本协议标记为 v1.0，并冻结核心字段。

开发团队在实现时，可将上述 JSON 示例对应为 TypeScript / Rust struct / Go struct 等，以保证前后端统一。

---

## 6. 实现状态

本文档记录了协议规范的实现状态，包括已完成的修改和待实现的功能。

### 6.1 ✅ 已完成的修改

#### 消息类型定义（Rust 端）

**文件**: `scheduler/src/messages.rs`

- ✅ 定义了所有消息类型（SessionMessage, NodeMessage）
- ✅ 定义了 FeatureFlags、PipelineConfig、InstalledModel 等辅助类型
- ✅ 定义了错误码枚举（ErrorCode）
- ✅ 定义了 ResourceUsage、HardwareInfo 等资源信息类型

#### Session 结构补充

**文件**: `scheduler/src/session.rs`

- ✅ 添加 `client_version: String`
- ✅ 添加 `platform: String`
- ✅ 添加 `dialect: Option<String>`
- ✅ 添加 `default_features: Option<FeatureFlags>`
- ✅ 更新 `create_session` 方法签名

#### Job 结构补充

**文件**: `scheduler/src/dispatcher.rs`

- ✅ 添加 `dialect: Option<String>`
- ✅ 添加 `features: Option<FeatureFlags>`
- ✅ 添加 `pipeline: PipelineConfig`
- ✅ 添加 `audio_format: String`
- ✅ 添加 `sample_rate: u32`
- ✅ 更新 `create_job` 方法签名

#### Node 结构补充

**文件**: `scheduler/src/node_registry.rs`

- ✅ 添加 `version: String`
- ✅ 添加 `platform: String`
- ✅ 添加 `hardware: HardwareInfo`
- ✅ 将 `installed_models` 从 `Vec<String>` 改为 `Vec<InstalledModel>`
- ✅ 添加 `features_supported: FeatureFlags`
- ✅ 添加 `accept_public_jobs: bool`
- ✅ 更新 `register_node` 方法签名
- ✅ 更新 `update_node_heartbeat` 方法签名
- ✅ 添加 `select_node_with_features` 方法（功能感知节点选择）
- ✅ 增强 `node_has_required_models` 方法（精确模型匹配）

#### 错误码定义

**文件**: `scheduler/src/messages.rs`

- ✅ 定义了完整的错误码枚举
- ✅ 实现了 ToString trait

### 6.2 ⚠️ 待实现的功能

#### WebSocket 消息处理实现

**文件**: `scheduler/src/websocket/`

当前状态：✅ 已实现完整的消息解析和路由逻辑。

**模块结构**:
- `mod.rs`: 模块声明和公共辅助函数（发送消息、错误处理等）
- `session_handler.rs`: 会话端 WebSocket 处理
- `node_handler.rs`: 节点端 WebSocket 处理

**已实现功能**：

**会话端 (handle_session)**
- [x] 解析 `session_init` 消息
- [x] 处理配对码验证
- [x] 创建会话并返回 `session_init_ack`
- [x] 解析 `utterance` 消息
- [x] 创建 job 并分发给节点
- [x] 接收节点结果并转发给客户端
- [x] 处理 `client_heartbeat`
- [x] 处理 `session_close`
- [x] 错误处理和错误消息发送

**节点端 (handle_node)**
- [x] 解析 `node_register` 消息
- [x] 注册节点并返回 `node_register_ack`
- [x] 处理 `node_heartbeat` 消息
- [x] 发送 `job_assign` 给节点
- [x] 接收 `job_result` 并处理
- [x] 处理 `node_error` 消息
- [ ] 支持 `node_control` 消息（预留，待实现）

#### 结果聚合和排序

**文件**: `scheduler/src/result_queue.rs`

当前状态：✅ 已实现。

**已实现功能**：
- [x] 维护每个会话的结果队列
- [x] 按 `utterance_index` 排序
- [x] 按顺序发送给客户端

#### 移动端消息格式对齐

**文件**: `mobile-app/src/hooks/useWebSocket.ts`

- [ ] `init_session` 消息补充字段：`client_version`, `platform`, `dialect`, `features`
- [ ] `utterance` 消息补充字段：`audio_format`, `sample_rate`, `dialect`, `features`

#### Electron Node 消息格式对齐

**文件**: `electron-node/main/src/agent/node-agent.ts`

- [ ] `register` 消息格式对齐协议规范
- [ ] `heartbeat` 消息格式对齐协议规范
- [ ] `job_result` 消息格式对齐协议规范

### 6.3 📋 修改清单

#### 已修改的文件

1. ✅ `scheduler/src/messages.rs` - 新建，消息类型定义
2. ✅ `scheduler/src/session.rs` - 补充 Session 结构字段
3. ✅ `scheduler/src/dispatcher.rs` - 补充 Job 结构字段
4. ✅ `scheduler/src/node_registry.rs` - 补充 Node 结构字段和方法
5. ✅ `scheduler/src/main.rs` - 添加 messages 模块

#### 待修改的文件

1. ✅ `scheduler/src/websocket/` - 已实现完整的消息处理逻辑（拆分为模块化结构）
2. ⏳ `mobile-app/src/hooks/useWebSocket.ts` - 对齐消息格式
3. ⏳ `electron-node/main/src/agent/node-agent.ts` - 对齐消息格式

### 6.4 🔍 关键差异对比

#### Session 结构

| 字段 | 协议规范 | 当前实现 | 状态 |
|------|---------|---------|------|
| session_id | ✅ | ✅ | ✅ |
| client_version | ✅ | ✅ | ✅ 已补充 |
| platform | ✅ | ✅ | ✅ 已补充 |
| src_lang | ✅ | ✅ | ✅ |
| tgt_lang | ✅ | ✅ | ✅ |
| dialect | ✅ | ✅ | ✅ 已补充 |
| features | ✅ | ✅ | ✅ 已补充 |
| paired_node_id | ✅ | ✅ | ✅ |

#### Job 结构

| 字段 | 协议规范 | 当前实现 | 状态 |
|------|---------|---------|------|
| job_id | ✅ | ✅ | ✅ |
| session_id | ✅ | ✅ | ✅ |
| utterance_index | ✅ | ✅ | ✅ |
| src_lang | ✅ | ✅ | ✅ |
| tgt_lang | ✅ | ✅ | ✅ |
| dialect | ✅ | ✅ | ✅ 已补充 |
| features | ✅ | ✅ | ✅ 已补充 |
| pipeline | ✅ | ✅ | ✅ 已补充 |
| audio | ✅ | ✅ | ✅ |
| audio_format | ✅ | ✅ | ✅ 已补充 |
| sample_rate | ✅ | ✅ | ✅ 已补充 |

#### Node 结构

| 字段 | 协议规范 | 当前实现 | 状态 |
|------|---------|---------|------|
| node_id | ✅ | ✅ | ✅ |
| version | ✅ | ✅ | ✅ 已补充 |
| platform | ✅ | ✅ | ✅ 已补充 |
| hardware | ✅ | ✅ | ✅ 已补充 |
| installed_models | ✅ | ✅ | ✅ 已补充（结构） |
| features_supported | ✅ | ✅ | ✅ 已补充 |
| accept_public_jobs | ✅ | ✅ | ✅ 已补充 |
| resource_usage | ✅ | ✅ | ✅ |

### 6.5 下一步行动

1. ✅ **实现 WebSocket 消息处理** - 已完成（拆分为模块化结构：`websocket/session_handler.rs` 和 `websocket/node_handler.rs`）
2. **对齐客户端消息格式** - 确保移动端和 Electron 节点发送的消息符合协议
3. ✅ **实现结果聚合** - 已完成（`result_queue.rs` 模块）
4. **测试端到端流程** - 验证整个消息流程
