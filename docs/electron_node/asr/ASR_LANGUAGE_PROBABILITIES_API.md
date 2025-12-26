# ASR 语言检测概率信息 API 文档

## 概述

ASR 服务现在支持返回语言检测的概率信息，包括：
- `detected_language`: 检测到的语言代码（例如：`"zh"`, `"en"`）
- `language_probability`: 检测到的语言的概率（0.0-1.0）
- `language_probabilities`: 所有语言的概率信息（字典：语言代码 -> 概率）

这些信息可以帮助客户端：
- 评估语言检测的置信度
- 处理多语言场景
- 优化用户体验（例如：低置信度时提示用户确认）

---

## 数据流

```
Faster Whisper (info.language_probabilities)
    ↓
ASR Worker Process (提取并序列化)
    ↓
ASR Worker Manager (ASRResult)
    ↓
ASR Service (UtteranceResponse)
    ↓
Node Server (ASRResult)
    ↓
Pipeline Orchestrator (JobResult.extra)
    ↓
Scheduler Server (TranslationResult.extra)
    ↓
Web Client (TranslationResultMessage.extra)
```

---

## 返回对象格式

### 1. ASR 服务返回 (`UtteranceResponse`)

**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**Python 类型定义**:
```python
class UtteranceResponse(BaseModel):
    text: str  # Full transcribed text
    segments: List[str]  # List of segment texts
    language: Optional[str] = None  # Detected language (e.g., "zh", "en")
    language_probability: Optional[float] = None  # 检测到的语言的概率（0.0-1.0）
    language_probabilities: Optional[Dict[str, float]] = None  # 所有语言的概率信息
    duration: float  # Audio duration in seconds
    vad_segments: List[Tuple[int, int]]  # VAD 检测到的语音段
```

**JSON 示例**:
```json
{
  "text": "你好世界",
  "segments": ["你好", "世界"],
  "language": "zh",
  "language_probability": 0.9876,
  "language_probabilities": {
    "zh": 0.9876,
    "en": 0.0089,
    "ja": 0.0023,
    "ko": 0.0012
  },
  "duration": 1.5,
  "vad_segments": [[0, 24000]]
}
```

---

### 2. 节点端返回 (`ASRResult`)

**位置**: `electron_node/electron-node/main/src/task-router/types.ts`

**TypeScript 类型定义**:
```typescript
export interface ASRResult {
  text: string;
  confidence?: number;
  language?: string;
  language_probability?: number;  // 检测到的语言的概率（0.0-1.0）
  language_probabilities?: Record<string, number>;  // 所有语言的概率信息
  is_final?: boolean;
}
```

**JavaScript 示例**:
```javascript
{
  text: "你好世界",
  confidence: 1.0,
  language: "zh",
  language_probability: 0.9876,
  language_probabilities: {
    "zh": 0.9876,
    "en": 0.0089,
    "ja": 0.0023,
    "ko": 0.0012
  },
  is_final: true
}
```

---

### 3. Pipeline Orchestrator 返回 (`JobResult`)

**位置**: `electron_node/electron-node/main/src/inference/inference-service.ts`

**TypeScript 类型定义**:
```typescript
export interface JobResult {
  text_asr: string;
  text_translated: string;
  tts_audio: string;
  tts_format?: string;
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    language_probability?: number | null;  // 检测到的语言的概率
    language_probabilities?: Record<string, number> | null;  // 所有语言的概率信息
    [key: string]: unknown;
  };
}
```

**JavaScript 示例**:
```javascript
{
  text_asr: "你好世界",
  text_translated: "Hello World",
  tts_audio: "base64_audio_data...",
  tts_format: "pcm16",
  extra: {
    language_probability: 0.9876,
    language_probabilities: {
      "zh": 0.9876,
      "en": 0.0089,
      "ja": 0.0023,
      "ko": 0.0012
    }
  }
}
```

---

### 4. 调度服务器返回 (`TranslationResult`)

**位置**: `central_server/scheduler/src/messages/session.rs`

**Rust 类型定义**:
```rust
pub struct TranslationResult {
    pub session_id: String,
    pub utterance_index: u64,
    pub job_id: String,
    pub text_asr: String,
    pub text_translated: String,
    pub tts_audio: String,
    pub tts_format: String,
    pub extra: Option<ExtraResult>,
    // ... 其他字段
}

pub struct ExtraResult {
    pub emotion: Option<String>,
    pub speech_rate: Option<f32>,
    pub voice_style: Option<String>,
    pub service_timings: Option<ServiceTimings>,
    pub language_probability: Option<f32>,  // 新增：检测到的语言的概率
    pub language_probabilities: Option<HashMap<String, f32>>,  // 新增：所有语言的概率信息
}
```

**JSON 示例**:
```json
{
  "type": "translation_result",
  "session_id": "s-123456",
  "utterance_index": 1,
  "job_id": "job-789",
  "text_asr": "你好世界",
  "text_translated": "Hello World",
  "tts_audio": "base64_audio_data...",
  "tts_format": "pcm16",
  "extra": {
    "language_probability": 0.9876,
    "language_probabilities": {
      "zh": 0.9876,
      "en": 0.0089,
      "ja": 0.0023,
      "ko": 0.0012
    }
  },
  "trace_id": "trace-abc123"
}
```

---

### 5. Web 客户端接收 (`TranslationResultMessage`)

**位置**: `webapp/web-client/src/types.ts`

**TypeScript 类型定义**:
```typescript
export interface TranslationResultMessage {
  type: 'translation_result';
  session_id: string;
  utterance_index: number;
  job_id: string;
  text_asr: string;
  text_translated: string;
  tts_audio: string;
  tts_format: string;
  extra?: {
    language_probability?: number;  // 检测到的语言的概率
    language_probabilities?: Record<string, number>;  // 所有语言的概率信息
    [key: string]: unknown;
  };
  trace_id: string;
  // ... 其他字段
}
```

**JavaScript 使用示例**:
```typescript
// 在 app.ts 中处理 translation_result 消息
private async onServerMessage(message: ServerMessage): Promise<void> {
  switch (message.type) {
    case 'translation_result':
      const result = message as TranslationResultMessage;
      
      // 获取语言检测信息
      const detectedLanguage = result.extra?.language_probability 
        ? result.extra.language_probability 
        : null;
      const allLanguageProbs = result.extra?.language_probabilities 
        ? result.extra.language_probabilities 
        : null;
      
      // 使用语言概率信息
      if (detectedLanguage && detectedLanguage < 0.8) {
        console.warn('语言检测置信度较低，可能需要用户确认');
      }
      
      if (allLanguageProbs) {
        console.log('所有语言的概率:', allLanguageProbs);
        // 可以用于多语言场景的处理
      }
      
      break;
  }
}
```

---

## 代码示例

### Python (ASR 服务端)

**提取语言概率信息**:
```python
# 在 asr_worker_process.py 中
segments, info = model.transcribe(
    audio,
    language=None,  # 自动检测
    task="transcribe",
    beam_size=5,
)

# 提取语言信息
detected_language = info.language if hasattr(info, 'language') else None
language_probabilities = None

if hasattr(info, 'language_probabilities'):
    lang_probs = info.language_probabilities
    if lang_probs and isinstance(lang_probs, dict):
        language_probabilities = dict(lang_probs)

# 计算检测到的语言的概率
language_probability = None
if language_probabilities and detected_language:
    language_probability = language_probabilities.get(detected_language)

# 返回结果
return {
    "text": full_text,
    "language": detected_language,
    "language_probability": language_probability,
    "language_probabilities": language_probabilities,
}
```

---

### TypeScript (节点端)

**传递语言概率信息**:
```typescript
// 在 task-router.ts 中
const response = await httpClient.post('/utterance', requestBody);

return {
  text: response.data.text || '',
  language: response.data.language || task.src_lang,
  language_probability: response.data.language_probability,  // 传递概率
  language_probabilities: response.data.language_probabilities,  // 传递所有概率
  is_final: true,
};
```

**在 Pipeline Orchestrator 中添加到 extra**:
```typescript
// 在 pipeline-orchestrator.ts 中
const result: JobResult = {
  text_asr: asrResult.text,
  text_translated: nmtResult.text,
  tts_audio: ttsResult.audio,
  tts_format: ttsResult.audio_format,
  extra: {
    language_probability: asrResult.language_probability,
    language_probabilities: asrResult.language_probabilities,
  },
};
```

---

### Rust (调度服务器端)

**接收和传递语言概率信息**:
```rust
// 在 job_result.rs 中
// extra 字段已经包含 language_probability 和 language_probabilities
// 直接传递给 Web 客户端即可

let result = SessionMessage::TranslationResult {
    // ... 其他字段
    extra: extra.clone(),  // 包含 language_probability 和 language_probabilities
    // ... 其他字段
};
```

---

### TypeScript (Web 客户端)

**使用语言概率信息**:
```typescript
// 在 app.ts 中
private async onServerMessage(message: ServerMessage): Promise<void> {
  if (message.type === 'translation_result') {
    const result = message as TranslationResultMessage;
    
    // 获取语言检测信息
    const langProb = result.extra?.language_probability;
    const langProbs = result.extra?.language_probabilities;
    
    // 显示语言检测信息（可选）
    if (langProb !== undefined) {
      console.log(`检测到的语言: ${result.text_asr ? '有文本' : '无文本'}`);
      console.log(`语言检测置信度: ${(langProb * 100).toFixed(2)}%`);
    }
    
    // 显示所有语言的概率（用于调试）
    if (langProbs) {
      console.log('所有语言的概率:');
      Object.entries(langProbs)
        .sort((a, b) => b[1] - a[1])  // 按概率降序排序
        .forEach(([lang, prob]) => {
          console.log(`  ${lang}: ${(prob * 100).toFixed(2)}%`);
        });
    }
    
    // 根据置信度决定是否提示用户
    if (langProb !== undefined && langProb < 0.7) {
      console.warn('语言检测置信度较低，建议用户确认');
      // 可以显示 UI 提示，让用户确认语言
    }
  }
}
```

---

## 字段说明

### `language` (string, optional)
- **描述**: 检测到的语言代码
- **格式**: ISO 639-1 语言代码（例如：`"zh"`, `"en"`, `"ja"`, `"ko"`）
- **来源**: Faster Whisper 的 `info.language`
- **示例**: `"zh"`

### `language_probability` (number, optional)
- **描述**: 检测到的语言的概率（0.0-1.0）
- **计算**: `language_probabilities[language]`（如果存在）
- **范围**: 0.0（不确定）到 1.0（非常确定）
- **示例**: `0.9876` 表示 98.76% 的置信度

### `language_probabilities` (dict, optional)
- **描述**: 所有语言的概率信息
- **格式**: 字典，键为语言代码，值为概率（0.0-1.0）
- **来源**: Faster Whisper 的 `info.language_probabilities`
- **示例**: 
  ```json
  {
    "zh": 0.9876,
    "en": 0.0089,
    "ja": 0.0023,
    "ko": 0.0012
  }
  ```
- **说明**: 
  - 所有概率值的和可能不等于 1.0（Faster Whisper 可能不返回所有语言）
  - 概率值按降序排列，第一个通常是检测到的语言

---

## 注意事项

### 1. 字段可能为 `null` 或 `undefined`
- 如果 Faster Whisper 未提供 `language_probabilities`，这些字段将为 `null` 或 `undefined`
- 客户端应该检查字段是否存在再使用

### 2. 概率值的含义
- **> 0.9**: 非常确定
- **0.7 - 0.9**: 比较确定
- **0.5 - 0.7**: 不太确定，可能需要用户确认
- **< 0.5**: 非常不确定，建议用户手动选择语言

### 3. 多语言场景
- `language_probabilities` 可以用于多语言场景
- 如果多个语言的概率相近（例如：`zh: 0.45, en: 0.43`），可能需要用户确认

### 4. 性能影响
- 提取和传递 `language_probabilities` 的开销很小
- 字典大小通常 < 10 个语言，序列化开销可忽略

---

## 测试

### 单元测试
```bash
cd electron_node/services/faster_whisper_vad
python test_language_probabilities.py
```

### 集成测试
1. 启动所有服务（调度服务器、节点端、ASR 服务）
2. 通过 Web 客户端发送音频
3. 检查返回的 `translation_result` 消息中的 `extra.language_probability` 和 `extra.language_probabilities`

### 验证步骤
1. **检查 ASR 服务日志**: 查看是否提取了 `language_probabilities`
2. **检查节点端日志**: 查看是否传递了语言概率信息
3. **检查调度服务器日志**: 查看 `extra` 字段是否包含语言概率信息
4. **检查 Web 客户端**: 在浏览器控制台查看 `translation_result` 消息

---

## 相关文件

### Python 文件
- `electron_node/services/faster_whisper_vad/asr_worker_process.py` - 提取语言概率信息
- `electron_node/services/faster_whisper_vad/asr_worker_manager.py` - ASRResult 类型定义
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - UtteranceResponse 类型定义

### TypeScript 文件
- `electron_node/electron-node/main/src/task-router/types.ts` - ASRResult 类型定义
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 传递语言概率信息
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - 添加到 extra
- `electron_node/electron-node/main/src/inference/inference-service.ts` - JobResult 类型定义

### Rust 文件
- `central_server/scheduler/src/messages/common.rs` - ExtraResult 类型定义
- `central_server/scheduler/src/messages/session.rs` - TranslationResult 类型定义

### Web 客户端文件
- `webapp/web-client/src/types.ts` - TranslationResultMessage 类型定义
- `webapp/web-client/src/app.ts` - 处理 translation_result 消息

---

## 更新日志

### 2025-12-26
- ✅ 实现语言概率信息提取功能
- ✅ 添加 `language_probability` 和 `language_probabilities` 字段到所有相关类型
- ✅ 确保数据从 ASR 服务传递到 Web 客户端
- ✅ 创建测试脚本和文档

---

## 未来改进

1. **语言检测置信度阈值**: 可以配置置信度阈值，低于阈值时提示用户确认
2. **多语言混合检测**: 如果多个语言概率相近，可以检测多语言混合场景
3. **语言切换检测**: 根据语言概率变化检测语言切换
4. **UI 提示**: 在 Web 客户端显示语言检测置信度（可选）

