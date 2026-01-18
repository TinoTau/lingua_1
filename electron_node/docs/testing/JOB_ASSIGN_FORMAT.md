# 调度服务器发给节点端的任务格式（JobAssign）

## 消息类型

**消息类型**: `job_assign`

**WebSocket端点**: `ws://localhost:5010/ws/node`

**方向**: 调度服务器 → 节点端

## 完整消息格式

```json
{
  "type": "job_assign",
  "job_id": "job-123456",
  "session_id": "sess-abc123",
  "utterance_index": 0,
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,
  "features": {
    "emotion_detection": true,
    "voice_style_detection": false,
    "speech_rate_detection": false,
    "speech_rate_control": false,
    "speaker_identification": false,
    "persona_adaptation": false
  },
  "pipeline": {
    "use_asr": true,
    "use_nmt": true,
    "use_tts": true
  },
  "audio": "UklGRiQAAABXQVZFZm10...",  // base64编码的音频数据
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "mode": "one_way",
  "lang_a": null,
  "lang_b": null,
  "auto_langs": null,
  "enable_streaming_asr": true,
  "partial_update_interval_ms": 1000,
  "trace_id": "trace-123456",
  "group_id": null,
  "part_index": null,
  "context_text": null
}
```

## 字段说明

### 必需字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `type` | string | 消息类型，固定为 `"job_assign"` |
| `job_id` | string | 任务唯一标识符 |
| `session_id` | string | 会话标识符 |
| `utterance_index` | number | 话语索引（同一会话中的第几句话） |
| `src_lang` | string | 源语言代码，支持: `"auto"` \| `"zh"` \| `"en"` \| `"ja"` \| `"ko"` |
| `tgt_lang` | string | 目标语言代码，如: `"zh"` \| `"en"` \| `"ja"` \| `"ko"` |
| `pipeline` | object | 流水线配置（见下方说明） |
| `audio` | string | **Base64编码的音频数据** |
| `audio_format` | string | 音频格式，如: `"pcm16"` \| `"wav"` |
| `sample_rate` | number | 采样率，如: `16000` |
| `trace_id` | string | 追踪ID，用于全链路追踪 |

### 可选字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `dialect` | string \| null | 方言，如: `"zh-CN"` \| `"zh-TW"` |
| `features` | object \| null | 功能标志（见下方说明） |
| `mode` | string \| null | 翻译模式: `"one_way"` \| `"two_way_auto"` |
| `lang_a` | string \| null | 双向模式的语言A（当`mode == "two_way_auto"`时使用） |
| `lang_b` | string \| null | 双向模式的语言B（当`mode == "two_way_auto"`时使用） |
| `auto_langs` | string[] \| null | 自动识别时限制的语言范围 |
| `enable_streaming_asr` | boolean \| null | 是否启用流式ASR（部分结果输出） |
| `partial_update_interval_ms` | number \| null | 部分结果更新间隔（毫秒），仅在`enable_streaming_asr`为`true`时有效 |
| `group_id` | string \| null | Utterance Group ID（用于上下文拼接） |
| `part_index` | number \| null | Group Part Index（用于标识Group内的part） |
| `context_text` | string \| null | 上下文文本（用于NMT上下文拼接） |

## Pipeline 配置

`pipeline` 对象指定需要执行的处理步骤：

```typescript
{
  use_asr: boolean;   // 是否执行语音识别（ASR）
  use_nmt: boolean;   // 是否执行机器翻译（NMT）
  use_tts: boolean;   // 是否执行语音合成（TTS）
}
```

**示例**:
```json
{
  "use_asr": true,
  "use_nmt": true,
  "use_tts": true
}
```

## Features 功能标志

`features` 对象指定需要启用的高级功能：

```typescript
{
  emotion_detection?: boolean;          // 情感检测
  voice_style_detection?: boolean;      // 语音风格检测
  speech_rate_detection?: boolean;      // 语速检测
  speech_rate_control?: boolean;        // 语速控制
  speaker_identification?: boolean;     // 说话人识别
  persona_adaptation?: boolean;         // 角色适配
}
```

**示例**:
```json
{
  "emotion_detection": true,
  "speaker_identification": true
}
```

## 音频数据格式

- **编码**: Base64
- **原始格式**: 通常是 PCM16
- **采样率**: 通常是 16000 Hz
- **声道**: 通常是单声道

### Base64编码示例

```python
import base64

# 读取音频文件
with open("audio.wav", "rb") as f:
    audio_data = f.read()

# Base64编码
audio_base64 = base64.b64encode(audio_data).decode("utf-8")
```

## 实际消息示例

### 示例1: 基本任务（中文→英文）

```json
{
  "type": "job_assign",
  "job_id": "job-001",
  "session_id": "sess-abc123",
  "utterance_index": 0,
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,
  "features": null,
  "pipeline": {
    "use_asr": true,
    "use_nmt": true,
    "use_tts": true
  },
  "audio": "UklGRiQAAABXQVZFZm10...",
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "mode": null,
  "lang_a": null,
  "lang_b": null,
  "auto_langs": null,
  "enable_streaming_asr": null,
  "partial_update_interval_ms": null,
  "trace_id": "trace-001",
  "group_id": null,
  "part_index": null,
  "context_text": null
}
```

### 示例2: 启用流式ASR的任务

```json
{
  "type": "job_assign",
  "job_id": "job-002",
  "session_id": "sess-xyz789",
  "utterance_index": 1,
  "src_lang": "en",
  "tgt_lang": "zh",
  "dialect": null,
  "features": null,
  "pipeline": {
    "use_asr": true,
    "use_nmt": true,
    "use_tts": true
  },
  "audio": "UklGRiQAAABXQVZFZm10...",
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "mode": "one_way",
  "enable_streaming_asr": true,
  "partial_update_interval_ms": 1000,
  "trace_id": "trace-002"
}
```

### 示例3: 启用高级功能的任务

```json
{
  "type": "job_assign",
  "job_id": "job-003",
  "session_id": "sess-def456",
  "utterance_index": 2,
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": "zh-CN",
  "features": {
    "emotion_detection": true,
    "speaker_identification": true,
    "speech_rate_control": true
  },
  "pipeline": {
    "use_asr": true,
    "use_nmt": true,
    "use_tts": true
  },
  "audio": "UklGRiQAAABXQVZFZm10...",
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "trace_id": "trace-003"
}
```

## TypeScript 接口定义

参考 `electron_node/shared/protocols/messages.ts`:

```typescript
export interface JobAssignMessage {
  type: 'job_assign';
  job_id: string;
  session_id: string;
  utterance_index: number;
  src_lang: string;  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
  tgt_lang: string;
  dialect: string | null;
  features?: FeatureFlags;
  pipeline: {
    use_asr: boolean;
    use_nmt: boolean;
    use_tts: boolean;
  };
  audio: string; // base64
  audio_format: string;
  sample_rate: number;
  mode?: 'one_way' | 'two_way_auto';
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
  enable_streaming_asr?: boolean;
  partial_update_interval_ms?: number;
  trace_id: string;
  group_id?: string;
  part_index?: number;
  context_text?: string;
}
```

## Rust 结构体定义

参考 `central_server/scheduler/src/messages/node.rs`:

```rust
#[serde(rename = "job_assign")]
JobAssign {
    job_id: String,
    session_id: String,
    utterance_index: u64,
    src_lang: String,
    tgt_lang: String,
    dialect: Option<String>,
    features: Option<FeatureFlags>,
    pipeline: PipelineConfig,
    audio: String, // base64
    audio_format: String,
    sample_rate: u32,
    mode: Option<String>,
    lang_a: Option<String>,
    lang_b: Option<String>,
    auto_langs: Option<Vec<String>>,
    enable_streaming_asr: Option<bool>,
    partial_update_interval_ms: Option<u64>,
    trace_id: String,
    group_id: Option<String>,
    part_index: Option<u64>,
    context_text: Option<String>,
}
```

## 节点端处理流程

节点端接收到 `job_assign` 消息后，应：

1. **解析消息** - 验证必需字段
2. **解码音频** - 将 base64 音频数据解码为二进制
3. **执行任务链**:
   - 如果 `pipeline.use_asr == true`: 执行 ASR（语音识别）
   - 如果 `pipeline.use_nmt == true`: 执行 NMT（机器翻译）
   - 如果 `pipeline.use_tts == true`: 执行 TTS（语音合成）
4. **处理高级功能** - 根据 `features` 执行相应功能
5. **返回结果** - 发送 `job_result` 消息

## 相关文档

- [节点端消息协议](../../docs/PROTOCOLS.md)
- [测试脚本使用说明](README.md)
- [快速测试指南](QUICK_TEST.md)

