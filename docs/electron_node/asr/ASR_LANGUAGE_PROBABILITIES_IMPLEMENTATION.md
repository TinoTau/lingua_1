# ASR 语言检测概率信息实现总结

## 实现概述

已成功实现从 Faster Whisper 提取并传递语言检测概率信息的功能。现在 ASR 服务可以返回：
- `detected_language`: 检测到的语言代码
- `language_probability`: 检测到的语言的概率（0.0-1.0）
- `language_probabilities`: 所有语言的概率信息（字典）

这些信息会从 ASR 服务传递到节点端、调度服务器，最终到达 Web 客户端。

---

## 修改的文件

### 1. Python 文件（ASR 服务）

#### `asr_worker_process.py`
- ✅ 提取 `info.language_probabilities`（如果 Faster Whisper 提供）
- ✅ 将语言概率信息添加到返回结果中

**关键代码**:
```python
# 提取 language_probabilities
if hasattr(info, 'language_probabilities'):
    lang_probs = info.language_probabilities
    if lang_probs and isinstance(lang_probs, dict):
        language_probabilities = dict(lang_probs)

# 返回结果
result_queue.put({
    "job_id": job_id,
    "text": full_text,
    "language": detected_language,
    "language_probabilities": language_probabilities,  # 新增
    "duration_ms": duration_ms,
    "error": None
})
```

#### `asr_worker_manager.py`
- ✅ 在 `ASRResult` 类中添加 `language_probabilities` 字段

**关键代码**:
```python
@dataclass
class ASRResult:
    job_id: str
    text: Optional[str] = None
    language: Optional[str] = None
    language_probabilities: Optional[Dict[str, float]] = None  # 新增
    duration_ms: int = 0
    error: Optional[str] = None
```

#### `faster_whisper_vad_service.py`
- ✅ 在 `UtteranceResponse` 类中添加 `language_probability` 和 `language_probabilities` 字段
- ✅ 从 `ASRResult` 提取语言概率信息
- ✅ 计算 `language_probability`（从 `language_probabilities` 中提取检测到的语言的概率）

**关键代码**:
```python
class UtteranceResponse(BaseModel):
    text: str
    segments: List[str]
    language: Optional[str] = None
    language_probability: Optional[float] = None  # 新增
    language_probabilities: Optional[Dict[str, float]] = None  # 新增
    duration: float
    vad_segments: List[Tuple[int, int]]

# 提取和计算
language_probabilities = asr_result.language_probabilities
language_probability = None
if language_probabilities and detected_language:
    language_probability = language_probabilities.get(detected_language)
```

---

### 2. TypeScript 文件（节点端）

#### `task-router/types.ts`
- ✅ 在 `ASRResult` 接口中添加 `language_probability` 和 `language_probabilities` 字段

**关键代码**:
```typescript
export interface ASRResult {
  text: string;
  confidence?: number;
  language?: string;
  language_probability?: number;  // 新增
  language_probabilities?: Record<string, number>;  // 新增
  is_final?: boolean;
}
```

#### `task-router/task-router.ts`
- ✅ 从 ASR 服务响应中提取并传递语言概率信息

**关键代码**:
```typescript
return {
  text: response.data.text || '',
  language: response.data.language || task.src_lang,
  language_probability: response.data.language_probability,  // 新增
  language_probabilities: response.data.language_probabilities,  // 新增
  is_final: true,
};
```

#### `pipeline-orchestrator/pipeline-orchestrator.ts`
- ✅ 将语言概率信息添加到 `JobResult.extra` 中

**关键代码**:
```typescript
const result: JobResult = {
  text_asr: asrResult.text,
  text_translated: nmtResult.text,
  tts_audio: ttsResult.audio,
  tts_format: ttsResult.audio_format,
  extra: {
    language_probability: asrResult.language_probability,  // 新增
    language_probabilities: asrResult.language_probabilities,  // 新增
  },
};
```

#### `inference/inference-service.ts`
- ✅ 在 `JobResult` 接口中添加语言概率字段到 `extra`

**关键代码**:
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
    language_probability?: number | null;  // 新增
    language_probabilities?: Record<string, number> | null;  // 新增
    [key: string]: unknown;
  };
}
```

---

### 3. Rust 文件（调度服务器）

#### `messages/common.rs`
- ✅ 在 `ExtraResult` 结构体中添加 `language_probability` 和 `language_probabilities` 字段

**关键代码**:
```rust
pub struct ExtraResult {
    pub emotion: Option<String>,
    pub speech_rate: Option<f32>,
    pub voice_style: Option<String>,
    pub service_timings: Option<ServiceTimings>,
    pub language_probability: Option<f32>,  // 新增
    pub language_probabilities: Option<HashMap<String, f32>>,  // 新增
}
```

---

### 4. TypeScript 文件（Web 客户端）

#### `types.ts`
- ✅ `TranslationResultMessage` 已经包含 `extra` 字段，语言概率信息会通过 `extra` 传递

**使用示例**:
```typescript
const result = message as TranslationResultMessage;
const langProb = result.extra?.language_probability;
const langProbs = result.extra?.language_probabilities;
```

---

## 测试

### 1. HTTP 测试脚本

**文件**: `electron_node/services/faster_whisper_vad/test_language_probabilities_http.py`

**使用方法**:
```bash
# 确保 ASR 服务正在运行（http://localhost:5008）
cd electron_node/services/faster_whisper_vad
python test_language_probabilities_http.py
```

**测试内容**:
- ✅ 验证 `language` 字段存在
- ✅ 验证 `language_probability` 字段存在
- ✅ 验证 `language_probabilities` 字段存在
- ✅ 验证 `language_probabilities` 格式（字典）
- ✅ 验证 `language_probability` 与 `language_probabilities` 的一致性

### 2. 集成测试

**步骤**:
1. 启动所有服务（调度服务器、节点端、ASR 服务）
2. 通过 Web 客户端发送音频
3. 在浏览器控制台检查 `translation_result` 消息

**检查点**:
```javascript
// 在浏览器控制台
// 监听 translation_result 消息
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'translation_result') {
    console.log('语言检测信息:', {
      language: message.extra?.language_probability ? '有' : '无',
      probability: message.extra?.language_probability,
      all_probs: message.extra?.language_probabilities
    });
  }
};
```

---

## 返回对象格式

### ASR 服务返回 (`UtteranceResponse`)

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

### Web 客户端接收 (`TranslationResultMessage`)

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

## 代码示例

### Web 客户端使用示例

```typescript
// 在 app.ts 中
private async onServerMessage(message: ServerMessage): Promise<void> {
  if (message.type === 'translation_result') {
    const result = message as TranslationResultMessage;
    
    // 获取语言检测信息
    const langProb = result.extra?.language_probability;
    const langProbs = result.extra?.language_probabilities;
    
    // 显示语言检测置信度
    if (langProb !== undefined) {
      console.log(`语言检测置信度: ${(langProb * 100).toFixed(2)}%`);
      
      // 低置信度时提示用户
      if (langProb < 0.7) {
        console.warn('语言检测置信度较低，建议用户确认');
        // 可以显示 UI 提示
      }
    }
    
    // 显示所有语言的概率（用于调试）
    if (langProbs) {
      console.log('所有语言的概率:');
      Object.entries(langProbs)
        .sort((a, b) => b[1] - a[1])
        .forEach(([lang, prob]) => {
          console.log(`  ${lang}: ${(prob * 100).toFixed(2)}%`);
        });
    }
  }
}
```

---

## 注意事项

### 1. Faster Whisper 可能不提供 `language_probabilities`
- 如果 Faster Whisper 的 `info` 对象不包含 `language_probabilities`，这些字段将为 `null` 或 `undefined`
- 客户端应该检查字段是否存在再使用

### 2. 概率值的含义
- **> 0.9**: 非常确定
- **0.7 - 0.9**: 比较确定
- **0.5 - 0.7**: 不太确定，可能需要用户确认
- **< 0.5**: 非常不确定，建议用户手动选择语言

### 3. 字段可能为 `null`
- 如果 ASR 结果为空（静音检测），`language_probability` 和 `language_probabilities` 可能为 `null`
- 客户端应该进行空值检查

---

## 验证清单

- [x] ASR Worker 提取 `language_probabilities`
- [x] ASR Worker Manager 传递 `language_probabilities`
- [x] ASR Service 返回 `language_probability` 和 `language_probabilities`
- [x] 节点端传递语言概率信息
- [x] Pipeline Orchestrator 添加到 `extra`
- [x] 调度服务器 `ExtraResult` 包含语言概率字段
- [x] Web 客户端可以通过 `extra` 访问语言概率信息
- [x] 创建测试脚本
- [x] 创建文档

---

## 相关文档

- `ASR_LANGUAGE_PROBABILITIES_API.md` - 完整的 API 文档，包含所有返回对象格式和代码样例

