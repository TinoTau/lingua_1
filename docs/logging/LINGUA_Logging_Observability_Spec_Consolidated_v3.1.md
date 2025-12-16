# LINGUA 全链路日志与可观测性规范（合并增强版）
## Logging & Observability Specification – Consolidated v3.1

版本：v3.1  
状态：**协议冻结 · 可直接开发**  
适用范围：Web 客户端 / Electron 客户端 / Scheduler / Node / ModelManager  
说明：在 v3 基础上，**补齐所有开发就绪度检查中缺失的协议字段与类型定义**，作为日志与可观测性的**最终权威版本（SSOT）**。

---

## 更新摘要（v3 → v3.1）
本版本新增并冻结以下内容：
- 所有跨端消息 **强制 trace_id 字段**
- JobResult / AsrPartial / Utterance 协议补齐
- ui_event 协议的 Rust / TypeScript 完整类型定义
- SessionMessage 中 ui_event / asr_partial 的枚举声明
- ErrorCode 的序列化规范与用户提示映射

---

## 1. 核心原则（不变）
- Scheduler 是 trace_id 的**唯一权威生成方**
- ui_event 是**唯一用户可见事件流**
- 工程日志与用户事件严格分层
- 日志规范禁止分叉实现

---

## 2. trace_id 传播与协议强制要求

### 2.1 规则
- 所有跨进程 / WS 消息 **必须携带 trace_id**
- 缺失 trace_id 的消息 → protocol_error
- Scheduler 在入口保证 trace_id 有效（UUID v4）

---

## 3. 协议补齐（开发必需）

### 3.1 Utterance（Web → Scheduler）
```rust
pub struct Utterance {
    pub session_id: String,
    pub tenant_id: String,
    pub trace_id: Option<String>,
    pub utterance_index: u64,
    pub audio_format: String,
    pub audio_bytes: Vec<u8>,
    pub features: Vec<String>,
}
```

### 3.2 JobAssign（Scheduler → Node）
```rust
pub struct JobAssign {
    pub job_id: String,
    pub session_id: String,
    pub trace_id: String,
    pub utterance_index: u64,
}
```

### 3.3 AsrPartial（Node → Scheduler）
```rust
pub struct AsrPartial {
    pub session_id: String,
    pub trace_id: String,
    pub job_id: String,
    pub utterance_index: u64,
    pub seq: u32,
    pub text_delta: String,
    pub is_final: bool,
}
```

### 3.4 JobResult（Node → Scheduler）
```rust
pub struct JobResult {
    pub job_id: String,
    pub session_id: String,
    pub trace_id: String,
    pub utterance_index: u64,
    pub result: JobResultPayload,
}
```

---

## 4. ui_event 协议（冻结）

### 4.1 UiEvent 结构
```rust
pub struct UiEvent {
    pub trace_id: String,
    pub session_id: String,
    pub job_id: String,
    pub utterance_index: u64,
    pub event: UiEventType,
    pub elapsed_ms: Option<u64>,
    pub status: UiEventStatus,
    pub error_code: Option<ErrorCode>,
    pub hint: Option<String>,
}
```

### 4.2 UiEventType（Rust）
```rust
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UiEventType {
    InputStarted,
    InputEnded,
    AsrPartial,
    AsrFinal,
    Dispatched,
    NodeAccepted,
    NmtDone,
    TtsPlayStarted,
    TtsPlayEnded,
    Error,
}
```

### 4.3 UiEventType（TypeScript）
```ts
export type UiEventType =
  | "INPUT_STARTED"
  | "INPUT_ENDED"
  | "ASR_PARTIAL"
  | "ASR_FINAL"
  | "DISPATCHED"
  | "NODE_ACCEPTED"
  | "NMT_DONE"
  | "TTS_PLAY_STARTED"
  | "TTS_PLAY_ENDED"
  | "ERROR";
```

### 4.4 UiEventStatus
```rust
#[serde(rename_all = "lowercase")]
pub enum UiEventStatus {
    Ok,
    Error,
}
```

---

## 5. SessionMessage 枚举（补齐）

```rust
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionMessage {
    session_init(SessionInit),
    session_init_ack(SessionInitAck),
    utterance(Utterance),
    job_assign(JobAssign),
    asr_partial(AsrPartial),
    job_result(JobResult),
    ui_event(UiEvent),
}
```

---

## 6. ErrorCode 规范（冻结）

### 6.1 Rust
```rust
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    NO_AVAILABLE_NODE,
    MODEL_NOT_AVAILABLE,
    WS_DISCONNECTED,
    NMT_TIMEOUT,
    TTS_TIMEOUT,
    MODEL_VERIFY_FAILED,
    MODEL_CORRUPTED,
}
```

### 6.2 TypeScript
```ts
export type ErrorCode =
  | "NO_AVAILABLE_NODE"
  | "MODEL_NOT_AVAILABLE"
  | "WS_DISCONNECTED"
  | "NMT_TIMEOUT"
  | "TTS_TIMEOUT"
  | "MODEL_VERIFY_FAILED"
  | "MODEL_CORRUPTED";
```

### 6.3 用户提示映射（Scheduler）
```rust
pub fn get_error_hint(code: &ErrorCode) -> &'static str {
    match code {
        ErrorCode::NO_AVAILABLE_NODE =>
            "当前没有可用节点，请稍后再试。",
        ErrorCode::MODEL_NOT_AVAILABLE =>
            "节点缺少必要模型，正在重新调度或等待模型准备完成。",
        ErrorCode::WS_DISCONNECTED =>
            "连接已断开，请刷新页面或重新连接。",
        ErrorCode::NMT_TIMEOUT =>
            "翻译超时，请尝试缩短句子后重试。",
        ErrorCode::TTS_TIMEOUT =>
            "语音合成超时，请稍后重试。",
        ErrorCode::MODEL_VERIFY_FAILED =>
            "模型校验失败，请重新下载模型。",
        ErrorCode::MODEL_CORRUPTED =>
            "模型文件损坏，请重新下载模型。",
    }
}
```

---

## 7. 规范性声明

- 本文档为 **日志与可观测性协议最终版本**
- 后续任何字段变更必须升级版本号（v3.x → v4.0）
- 禁止各端自行扩展字段语义

---

**END OF SPEC**
