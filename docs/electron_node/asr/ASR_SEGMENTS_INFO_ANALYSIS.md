# ASR Segments 信息分析

## 问题

当前 ASR 输出结构里是否能拿到 token/word 置信度（或至少 segments 的信息）？

---

## 当前实现分析

### 1. Faster Whisper 返回的 segments 对象

Faster Whisper 的 `model.transcribe()` 返回的 `segments` 是一个迭代器，每个 segment 对象通常包含：

```python
# Faster Whisper Segment 对象结构（典型）
class Segment:
    text: str              # 文本内容
    start: float           # 开始时间（秒）
    end: float             # 结束时间（秒）
    no_speech_prob: float  # 无语音概率（可选）
    words: List[Word]      # 词级别信息（可选，需要 word_timestamps=True）
    
class Word:
    word: str              # 词文本
    start: float           # 开始时间（秒）
    end: float             # 结束时间（秒）
    probability: float      # 词级别置信度（可选）
```

### 2. 当前代码实现

#### `asr_worker_process.py` (第 212-218 行)

```python
# 提取文本
text_parts = []
for seg in segments_list:
    if hasattr(seg, 'text'):
        text_parts.append(seg.text.strip())  # ❌ 只提取了 text，丢失了其他信息
    elif isinstance(seg, str):
        text_parts.append(seg.strip())
```

**问题**：
- ✅ 提取了 `seg.text`
- ❌ **丢失了** `seg.start`、`seg.end`（时间戳）
- ❌ **丢失了** `seg.words`（词级别信息，包含置信度）
- ❌ **丢失了** `seg.no_speech_prob`（无语音概率）

#### `faster_whisper_vad_service.py` (第 146 行)

```python
class UtteranceResponse(BaseModel):
    text: str  # Full transcribed text
    segments: List[str]  # ❌ 只是文本列表，不包含任何元数据
    ...
```

**问题**：
- `segments` 字段只是 `List[str]`，不包含时间戳、置信度等信息
- 当前实现中，`segments` 甚至不是从 Faster Whisper 的 segments 提取的，而是从 `full_text.split()` 生成的（第 666 行）

---

## 当前能获取的信息

### ✅ 已获取的信息

1. **文本级别**：
   - `text`: 完整转录文本
   - `segments`: 文本列表（按空格分割，不是真正的 segments）

2. **语言级别**：
   - `language`: 检测到的语言
   - `language_probability`: 语言检测置信度
   - `language_probabilities`: 所有语言的概率

3. **音频级别**：
   - `duration`: 音频时长
   - `vad_segments`: VAD 检测到的语音段（样本索引）

### ❌ 丢失的信息

1. **Segment 级别**：
   - `start` / `end`: 每个 segment 的时间戳
   - `no_speech_prob`: 无语音概率

2. **Word/Token 级别**：
   - `words`: 词列表（需要 `word_timestamps=True`）
   - `word.probability`: 词级别置信度
   - `word.start` / `word.end`: 词级别时间戳

---

## 如何获取更多信息

### 方案 1: 提取 Segment 时间戳（推荐，P0）

**修改 `asr_worker_process.py`**：

```python
# 提取文本和时间戳
segments_data = []
for seg in segments_list:
    if hasattr(seg, 'text'):
        segment_info = {
            "text": seg.text.strip(),
            "start": getattr(seg, 'start', None),      # 开始时间（秒）
            "end": getattr(seg, 'end', None),            # 结束时间（秒）
            "no_speech_prob": getattr(seg, 'no_speech_prob', None),  # 无语音概率
        }
        segments_data.append(segment_info)
        text_parts.append(seg.text.strip())
    elif isinstance(seg, str):
        text_parts.append(seg.strip())

# 返回结果
result_queue.put({
    "job_id": job_id,
    "text": full_text,
    "language": detected_language,
    "language_probabilities": language_probabilities,
    "segments": segments_data,  # ✅ 包含时间戳和元数据
    "duration_ms": duration_ms,
    "error": None
})
```

**修改 `UtteranceResponse`**：

```python
class SegmentInfo(BaseModel):
    text: str
    start: Optional[float] = None      # 开始时间（秒）
    end: Optional[float] = None        # 结束时间（秒）
    no_speech_prob: Optional[float] = None  # 无语音概率

class UtteranceResponse(BaseModel):
    text: str
    segments: List[SegmentInfo]  # ✅ 包含元数据的 segments
    ...
```

### 方案 2: 提取 Word 级别信息（P1，需要启用 word_timestamps）

**修改 `asr_worker_process.py`**：

```python
# 在 transcribe 调用时启用 word_timestamps
segments, info = model.transcribe(
    audio,
    language=task.get("language"),
    task=task.get("task", "transcribe"),
    beam_size=task.get("beam_size", 5),
    vad_filter=False,
    initial_prompt=initial_prompt,
    condition_on_previous_text=condition_on_previous_text,
    word_timestamps=True,  # ✅ 启用词级别时间戳
)

# 提取词级别信息
segments_data = []
for seg in segments_list:
    if hasattr(seg, 'text'):
        words_data = []
        if hasattr(seg, 'words') and seg.words:
            for word in seg.words:
                words_data.append({
                    "word": getattr(word, 'word', ''),
                    "start": getattr(word, 'start', None),
                    "end": getattr(word, 'end', None),
                    "probability": getattr(word, 'probability', None),  # ✅ 词级别置信度
                })
        
        segment_info = {
            "text": seg.text.strip(),
            "start": getattr(seg, 'start', None),
            "end": getattr(seg, 'end', None),
            "words": words_data,  # ✅ 词级别信息
        }
        segments_data.append(segment_info)
```

**修改 `UtteranceResponse`**：

```python
class WordInfo(BaseModel):
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    probability: Optional[float] = None  # 词级别置信度

class SegmentInfo(BaseModel):
    text: str
    start: Optional[float] = None
    end: Optional[float] = None
    words: Optional[List[WordInfo]] = None  # ✅ 词级别信息

class UtteranceResponse(BaseModel):
    text: str
    segments: List[SegmentInfo]  # ✅ 包含词级别信息的 segments
    ...
```

---

## 实施建议

### P0（必须）
1. ✅ **提取 Segment 时间戳**（`start` / `end`）
   - 用于时间对齐和可视化
   - 用于坏段判定（长音频短文本）

2. ✅ **修改 `UtteranceResponse.segments` 结构**
   - 从 `List[str]` 改为 `List[SegmentInfo]`
   - 包含时间戳和元数据

### P1（重要）
1. ⚠️ **提取 Word 级别信息**（需要 `word_timestamps=True`）
   - 用于词级别置信度分析
   - 用于坏段判定（低置信词比例）

2. ⚠️ **提取 `no_speech_prob`**
   - 用于静音检测和坏段判定

---

## 性能影响

### Segment 时间戳提取
- ✅ **开销很小**：只是读取属性，不增加计算
- ✅ **内存增加**：每个 segment 增加 ~50 bytes（可忽略）

### Word 级别信息提取
- ⚠️ **需要启用 `word_timestamps=True`**：可能增加 ASR 处理时间（10-20%）
- ⚠️ **内存增加**：每个词增加 ~100 bytes（对于长文本可能显著）

**建议**：
- Segment 时间戳：**默认启用**（开销小，收益大）
- Word 级别信息：**可选启用**（通过配置开关控制）

---

## 代码修改位置

### 1. `asr_worker_process.py`
- 第 212-218 行：修改 segments 提取逻辑
- 第 254-260 行：修改返回结果结构

### 2. `asr_worker_manager.py`
- `ASRResult` 类：添加 `segments` 字段（包含元数据）

### 3. `faster_whisper_vad_service.py`
- `UtteranceResponse` 类：修改 `segments` 字段类型
- 第 666 行：使用真正的 segments（而不是 `full_text.split()`）

### 4. `task-router/types.ts`
- `ASRResult` 接口：添加 `segments` 字段（包含元数据）

---

## 总结

### 当前状态
- ❌ **无法获取** token/word 置信度
- ❌ **无法获取** segment 时间戳
- ✅ **可以获取** 语言级别置信度（`language_probability`）

### 建议
1. **立即实施**（P0）：提取 Segment 时间戳
2. **可选实施**（P1）：提取 Word 级别信息（需要性能评估）

### 收益
- Segment 时间戳：用于坏段判定、时间对齐、可视化
- Word 置信度：用于更精确的坏段判定、质量评分

