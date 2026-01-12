# ASR 置信度信息说明

## 问题

在 `ASR_STRATEGY_FEASIBILITY_REVIEW.md` 文档中提到的置信度信息是指什么？

---

## 答案

文档中提到的置信度信息主要是指 **语言检测置信度**（`language_probability`），这是**已经实现**的功能。

---

## 1. 语言检测置信度 (`language_probability`)

### 定义

- **含义**：ASR 模型对检测到的语言的置信程度
- **范围**：0.0（不确定）到 1.0（非常确定）
- **来源**：Faster Whisper 的 `info.language_probabilities[detected_language]`
- **状态**：✅ **已实现并传递到所有层级**

### 在方案中的用途

#### 1.1 语言置信度分级（P0）

**方案要求**（第 232-237 行）：
- **高置信**（p ≥ 0.90）：直接采用
- **中置信**（0.70 ≤ p < 0.90）：采用，但记录 top-2 候选
- **低置信**（p < 0.70）：禁用上下文，允许触发补救

**实现位置**（建议在节点端）：
```typescript
const langProb = asrResult.language_probability || 0;

if (langProb < 0.70) {
  // 低置信：禁用上下文
  requestBody.condition_on_previous_text = false;
  requestBody.use_text_context = false;
} else if (langProb >= 0.90) {
  // 高置信：可以启用上下文（可选）
  // 根据方案，默认关闭上下文
}
```

#### 1.2 坏段判定（P1）

**方案要求**（第 372 行）：
- `language_probability < 0.70` 且文本过短

**实现示例**（第 393-397 行）：
```typescript
// 1. 低置信 + 短文本
if (asrResult.language_probability < 0.70 && 
    audioDurationMs >= 1500 && 
    asrResult.text.trim().length < 5) {
  return true;  // 判定为坏段
}
```

#### 1.3 动态调整上下文策略（P0）

**方案要求**（第 342-354 行）：
- 默认关闭上下文
- 仅在 `language_probability >= 0.90` 且其他条件满足时启用

**实现示例**：
```typescript
// 默认关闭
use_text_context: false

// 仅在以下条件全部满足时启用：
// 1. language_probability >= 0.90
// 2. 最近多段语言一致
// 3. prompt 文本长度 <= 100 字符
if (langProb >= 0.90 && recentLangsConsistent && promptLen <= 100) {
  use_text_context = true;
}
```

#### 1.4 质量评分（P1）

**方案要求**（第 490-496 行）：
- 用于重跑后选择最佳结果

**实现示例**：
```typescript
function calculateQualityScore(result: ASRResult): number {
  // 文本长度 + 语言置信度 - 乱码惩罚
  const textLen = result.text.trim().length;
  const langProb = result.language_probability || 0;  // ✅ 使用语言置信度
  const garbagePenalty = countGarbageChars(result.text) * 10;
  return textLen + langProb * 100 - garbagePenalty;
}
```

---

## 2. 关于 "segments 数异常或文本断裂"

### 方案要求（第 375 行）

坏段判定条件之一：
- `segments 数异常或文本断裂`

### 当前状态

**❌ 无法直接检测**，因为：
1. 当前 `segments` 只是文本列表（`List[str]`）
2. 不包含时间戳信息（`start` / `end`）
3. 不包含词级别置信度

### 如何实现

#### 方案 A：使用 Segment 时间戳（推荐）

**需要提取**：
- `seg.start` / `seg.end`：每个 segment 的时间戳

**检测逻辑**：
```typescript
// 检测文本断裂：相邻 segments 之间时间间隔过大
function detectTextBreak(segments: SegmentInfo[]): boolean {
  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i].start - segments[i-1].end;
    if (gap > 1.0) {  // 间隔超过 1 秒
      return true;  // 文本断裂
    }
  }
  return false;
}

// 检测 segments 数异常：音频长但 segments 少
function detectAbnormalSegmentCount(
  segments: SegmentInfo[],
  audioDurationMs: number
): boolean {
  const audioDurationSec = audioDurationMs / 1000;
  const avgSegmentDuration = audioDurationSec / segments.length;
  
  // 如果平均每个 segment 超过 5 秒，可能异常
  if (segments.length > 0 && avgSegmentDuration > 5.0) {
    return true;
  }
  return false;
}
```

#### 方案 B：使用词级别置信度（可选）

**需要提取**：
- `word.probability`：每个词的置信度

**检测逻辑**：
```typescript
// 检测低置信词比例
function detectLowConfidenceWords(segments: SegmentInfo[]): boolean {
  let totalWords = 0;
  let lowConfidenceWords = 0;
  
  for (const seg of segments) {
    if (seg.words) {
      for (const word of seg.words) {
        totalWords++;
        if (word.probability && word.probability < 0.5) {
          lowConfidenceWords++;
        }
      }
    }
  }
  
  // 如果超过 30% 的词置信度低，可能异常
  if (totalWords > 0 && (lowConfidenceWords / totalWords) > 0.3) {
    return true;
  }
  return false;
}
```

---

## 3. 总结

### ✅ 已实现的置信度信息

1. **语言检测置信度** (`language_probability`)
   - ✅ 已实现并传递到所有层级
   - ✅ 用于语言置信度分级
   - ✅ 用于坏段判定
   - ✅ 用于动态调整上下文策略
   - ✅ 用于质量评分

### ❌ 未实现的置信度信息

1. **Segment 级别置信度**
   - ❌ 当前未提取（Faster Whisper 可能不提供）
   - ⚠️ 可以通过 `no_speech_prob` 间接判断

2. **Word/Token 级别置信度**
   - ❌ 当前未提取（需要 `word_timestamps=True`）
   - ⚠️ 可以用于更精确的坏段判定

3. **Segment 时间戳**
   - ❌ 当前未提取
   - ✅ **建议立即实施**（P0），用于检测文本断裂

---

## 4. 实施建议

### P0（必须）
1. ✅ **提取 Segment 时间戳**（`start` / `end`）
   - 用于检测文本断裂
   - 用于检测 segments 数异常
   - 开销很小，收益大

### P1（可选）
1. ⚠️ **提取 Word 级别置信度**（需要 `word_timestamps=True`）
   - 用于更精确的坏段判定
   - 可能增加 10-20% 处理时间

---

## 5. 相关文档

- `ASR_LANGUAGE_PROBABILITIES_API.md` - 语言置信度 API 文档
- `ASR_LANGUAGE_PROBABILITIES_IMPLEMENTATION.md` - 语言置信度实现总结
- `ASR_SEGMENTS_INFO_ANALYSIS.md` - Segments 信息分析（包含时间戳和词级别信息）

