# ASR 重构计划完整性评估

## 评估概述

对 `ASR_REFACTOR_PLAN_WITH_CONFIDENCE_VALIDATION_AND_TASKS.md` 进行完整性检查，评估是否可以开始实施。

---

## ✅ 文档完整性评估

### 1. 设计目标（DoD）
- ✅ **完整**：P0 和 P1 目标清晰
- ✅ **可量化**：有明确的验收标准

### 2. 置信度信息说明
- ✅ **完整**：已实现和需要补齐的信息都已说明
- ✅ **优先级明确**：P0/P1 划分清晰

### 3. 总体方案
- ✅ **完整**：边界稳态化、语言策略、验证/补救模块都有详细说明
- ✅ **可实施**：有具体的参数建议

### 4. 关键实现细节
- ✅ **完整**：有伪代码示例
- ⚠️ **部分缺失**：某些实现细节需要补充（见下文）

### 5. Task List
- ✅ **完整**：所有 EPIC 都有任务分解
- ✅ **工期估算**：每个任务都有时间估算

### 6. 实施顺序
- ✅ **完整**：有清晰的实施路径

---

## ⚠️ 缺失或需要补充的部分

### 1. 手动截断识别机制（关键缺失）

**问题**：
- 文档提到"手动截断 finalize"和"自动 finalize"，但**未说明如何区分**
- 当前代码中 `is_final` 标记可能表示手动截断，但需要确认

**需要补充**：
```typescript
// 在 Scheduler 或节点端需要明确：
interface AudioChunk {
  is_final: boolean;  // 是否表示手动截断？
  // 或者需要新增字段：
  is_manual_finalize?: boolean;  // 明确标识手动截断
}
```

**建议**：
- 在文档中明确：`is_final=true` 表示手动截断
- 或者在 Scheduler 的 `SessionEvent::IsFinalReceived` 中明确处理逻辑

---

### 2. Opus 格式处理细节（部分缺失）

**问题**：
- 文档提到 Padding 需要在节点端处理，但**未说明 Opus 解码的具体实现**
- 当前 Web 端使用 Opus 编码发送音频

**需要补充**：
```typescript
// 在 task-router.ts 中需要：
async function applyPadding(
  audioBuffer: Buffer,
  audioFormat: string,
  sampleRate: number,
  isManualFinalize: boolean
): Promise<Buffer> {
  if (audioFormat === 'opus') {
    // 1. 解码 Opus 到 PCM16
    const pcm16 = await decodeOpusToPcm16(audioBuffer);
    // 2. 应用 Padding
    const paddingMs = isManualFinalize ? 280 : 220;
    const padding = createSilencePadding(paddingMs, sampleRate);
    // 3. 重新编码为 Opus（如果需要）
    // 或者直接返回 PCM16（如果 ASR 服务支持）
    return Buffer.concat([pcm16, padding]);
  } else if (audioFormat === 'pcm16') {
    // 直接应用 Padding
    const paddingMs = isManualFinalize ? 280 : 220;
    const padding = createSilencePadding(paddingMs, sampleRate);
    return Buffer.concat([audioBuffer, padding]);
  }
  return audioBuffer;
}
```

**建议**：
- 在文档中补充 Opus 解码/编码的处理流程
- 或者明确：Padding 在 ASR 服务端处理（需要传入 `is_manual_finalize` 标志）

---

### 3. Short-merge 实现细节（部分缺失）

**问题**：
- 文档提到"<400ms 片段缓冲合并下一段"，但**未说明如何计算音频时长**
- 需要解析音频格式（Opus/PCM16）来计算时长

**需要补充**：
```rust
// 在 Scheduler 的 SessionActor 中需要：
async fn calculate_audio_duration(
  audio_data: &[u8],
  audio_format: &str,
  sample_rate: u32
) -> u64 {
  match audio_format {
    "pcm16" => {
      // PCM16: 2 bytes per sample
      let samples = audio_data.len() / 2;
      (samples as u64 * 1000) / sample_rate as u64
    }
    "opus" => {
      // Opus: 需要解码或使用帧头信息估算
      // 或者从 Web 端传递 duration_ms
      // 临时方案：使用估算值（不准确）
      estimate_opus_duration(audio_data)
    }
    _ => 0
  }
}
```

**建议**：
- 在文档中补充音频时长计算的方法
- 或者要求 Web 端在 `audio_chunk` 消息中传递 `duration_ms`

---

### 4. 语言窗口实现细节（部分缺失）

**问题**：
- 文档提到"记录 top-2 候选"和"最近 6-10 段"，但**未说明如何传递这些信息**
- 需要明确数据流：Scheduler → Node → ASR Service

**需要补充**：
```rust
// 在 Scheduler 的 SessionActorInternalState 中：
struct LangWindowEntry {
    utterance_index: u64,
    detected_lang: String,
    lang_prob: f32,
    top2_langs: Vec<String>,  // 从 language_probabilities 提取
}

// 在 finalize 时更新窗口
fn update_lang_window(&mut self, asr_result: &AsrResult) {
    let top2 = extract_top2_languages(&asr_result.language_probabilities);
    self.lang_window.push_back(LangWindowEntry {
        utterance_index: self.current_utterance_index,
        detected_lang: asr_result.language.clone(),
        lang_prob: asr_result.language_probability.unwrap_or(0.0),
        top2_langs: top2,
    });
    // 保持窗口大小 <= 10
    if self.lang_window.len() > 10 {
        self.lang_window.pop_front();
    }
}
```

**建议**：
- 在文档中补充语言窗口的数据结构和更新逻辑

---

### 5. 质量评分公式细节（部分缺失）

**问题**：
- 文档提到质量评分的各个组成部分，但**未给出具体的权重和计算公式**

**需要补充**：
```typescript
function calculateQualityScore(
  result: ASRResult,
  audioDurationMs: number,
  previousText?: string
): number {
  // 基础分：文本长度（归一化到 0-100）
  const textLen = result.text.trim().length;
  const baseScore = Math.min(textLen * 2, 100);  // 每字符 2 分，最高 100
  
  // 语言分：language_probability（归一化到 0-100）
  const langProb = result.language_probability || 0;
  const langScore = langProb * 100;
  
  // 垃圾惩罚：乱码/异常字符（每字符 -10 分）
  const garbageCount = countGarbageChars(result.text);
  const garbagePenalty = garbageCount * 10;
  
  // 断裂惩罚：segments gap（需要时间戳）
  let breakPenalty = 0;
  if (result.segments && result.segments.length > 1) {
    const maxGap = calculateMaxGap(result.segments);
    if (maxGap > 1.0) {
      breakPenalty = (maxGap - 1.0) * 20;  // 每超过 1 秒 -20 分
    }
  }
  
  // 词级惩罚（可选）：低置信词比例
  let wordPenalty = 0;
  if (result.words) {
    const lowConfWords = result.words.filter(w => w.probability < 0.5).length;
    wordPenalty = (lowConfWords / result.words.length) * 50;  // 最高 -50 分
  }
  
  // 术语奖励（需要 glossary）
  let termBonus = 0;
  if (result.glossary_matches) {
    termBonus = result.glossary_matches.length * 5;  // 每个匹配 +5 分
  }
  
  // 去重惩罚：与上一条高度重复
  let dupPenalty = 0;
  if (previousText) {
    const overlap = calculateOverlap(result.text, previousText);
    if (overlap > 0.8) {
      dupPenalty = (overlap - 0.8) * 100;  // 最高 -20 分
    }
  }
  
  // 综合评分
  const totalScore = baseScore + langScore - garbagePenalty - breakPenalty 
                     - wordPenalty + termBonus - dupPenalty;
  
  return Math.max(0, Math.min(100, totalScore));  // 限制在 0-100
}
```

**建议**：
- 在文档中补充完整的质量评分公式和权重
- 或者说明：权重需要根据 A/B 测试调整

---

### 6. 同音候选生成细节（部分缺失）

**问题**：
- 文档提到"同音候选生成器"，但**未说明具体的实现方法**
- 需要明确：使用拼音库、音韵库，还是其他方法

**需要补充**：
```python
# 同音候选生成器（中文）
def generate_homophone_candidates(
    word: str,
    glossary: List[str],
    max_candidates: int = 10
) -> List[str]:
    """
    生成同音候选词
    
    策略：
    1. 从 glossary 中查找同音词
    2. 使用拼音库查找同音字
    3. 使用音韵库查找近音字
    """
    candidates = []
    
    # 1. 从 glossary 中查找
    word_pinyin = get_pinyin(word)
    for term in glossary:
        term_pinyin = get_pinyin(term)
        if term_pinyin == word_pinyin and term != word:
            candidates.append(term)
    
    # 2. 从拼音库查找（如果 glossary 不够）
    if len(candidates) < max_candidates:
        pinyin_candidates = pinyin_library.find_homophones(word_pinyin)
        candidates.extend(pinyin_candidates[:max_candidates - len(candidates)])
    
    return candidates[:max_candidates]
```

**建议**：
- 在文档中补充同音候选生成的具体实现方法
- 或者说明：需要调研和选择合适的中文同音词库

---

### 7. Glossary 接口设计（部分缺失）

**问题**：
- 文档提到"glossary 接口"，但**未说明接口的具体设计**
- 需要明确：如何配置、如何传递、如何匹配

**需要补充**：
```typescript
// Glossary 接口设计
interface GlossaryConfig {
  // 会议室模式：从配置或数据库加载
  terms: string[];  // 术语列表
  // 或者
  glossary_id?: string;  // 术语表 ID
}

// 在 ASR 请求中传递
interface ASRTask {
  // ... 其他字段
  glossary?: GlossaryConfig;  // 可选
}

// 在质量评分中使用
function checkGlossaryMatches(
  text: string,
  glossary: GlossaryConfig
): string[] {
  const matches: string[] = [];
  for (const term of glossary.terms) {
    if (text.includes(term)) {
      matches.push(term);
    }
  }
  return matches;
}
```

**建议**：
- 在文档中补充 Glossary 接口的设计
- 或者说明：Glossary 功能作为 P1 的后续优化

---

### 8. 可观测性字段透传（部分缺失）

**问题**：
- 文档提到需要透传多个字段，但**未说明具体的数据结构**

**需要补充**：
```typescript
// 在 ASRResult 中添加
interface ASRResult {
  // ... 现有字段
  asr_quality_level?: 'good' | 'suspect' | 'bad';
  reason_codes?: string[];  // 如：['low_confidence', 'short_text', 'garbage']
  quality_score?: number;
  rerun_count?: number;
  top2_langs?: string[];
  segments_meta?: {
    count: number;
    max_gap: number;  // 秒
    avg_duration: number;  // 秒
  };
  low_conf_words_count?: number;  // 可选
}
```

**建议**：
- 在文档中补充完整的数据结构定义

---

## ✅ 可以开始实施的部分

### P0 任务（可以立即开始）

1. **EDGE-1 统一 finalize 接口** ✅
   - 依赖：无
   - 可以开始

2. **EDGE-2/3 Hangover 实现** ⚠️
   - 依赖：需要明确 `is_final` 是否表示手动截断
   - 建议：先确认手动截断识别机制

3. **EDGE-4 Padding 实现** ⚠️
   - 依赖：需要 Opus 解码能力
   - 建议：先实现 Opus 解码，或改为在 ASR 服务端处理

4. **EDGE-5 Short-merge** ⚠️
   - 依赖：需要音频时长计算
   - 建议：先实现音频时长计算，或要求 Web 端传递 `duration_ms`

5. **CONF-1 语言置信度分级** ✅
   - 依赖：`language_probability` 已实现
   - 可以开始

6. **CONF-2 Segment 时间戳提取** ✅
   - 依赖：Faster Whisper 提供 `seg.start` / `seg.end`
   - 可以开始

7. **CONF-3 断裂/异常检测** ⚠️
   - 依赖：CONF-2 完成
   - 建议：在 CONF-2 之后实施

---

## 📋 实施前检查清单

### 必须确认的事项

- [ ] **手动截断识别**：确认 `is_final=true` 是否表示手动截断
- [ ] **Opus 解码**：确认节点端是否有 Opus 解码能力，或改为 ASR 服务端处理
- [ ] **音频时长计算**：确认如何计算 Opus 音频时长，或要求 Web 端传递
- [ ] **Glossary 接口**：确认是否需要立即实现，或作为后续优化

### 建议补充的文档

1. **数据结构定义文档**：所有新增字段的完整定义
2. **Opus 处理流程文档**：Padding 和 Short-merge 在 Opus 格式下的处理流程
3. **质量评分公式文档**：完整的公式和权重说明
4. **同音候选生成文档**：具体的实现方法和依赖库

---

## 🎯 结论

### 整体评估：**基本完整，但需要补充部分细节**

### 可以开始实施：
1. ✅ **P0 边界稳态化**（部分任务）
   - EDGE-1：统一 finalize 接口
   - CONF-1：语言置信度分级
   - CONF-2：Segment 时间戳提取

2. ⚠️ **需要先解决依赖**：
   - EDGE-2/3/4/5：需要明确手动截断识别、Opus 处理、音频时长计算
   - CONF-3：需要 CONF-2 完成

3. ⚠️ **P1 任务**：
   - 需要 P0 完成后，根据实际效果调整

### 建议实施顺序（修正版）

1. **第一阶段**（1-2 天）：
   - ✅ CONF-1：语言置信度分级（无依赖）
   - ✅ CONF-2：Segment 时间戳提取（无依赖）
   - ⚠️ 确认手动截断识别机制

2. **第二阶段**（2-3 天）：
   - ⚠️ EDGE-1：统一 finalize 接口
   - ⚠️ EDGE-2/3：Hangover（需要确认手动截断）
   - ⚠️ EDGE-4：Padding（需要 Opus 解码或改为服务端处理）
   - ⚠️ EDGE-5：Short-merge（需要音频时长计算）

3. **第三阶段**（1-2 天）：
   - ✅ CONF-3：断裂/异常检测（依赖 CONF-2）
   - ✅ OBS-1/2/3：指标与日志

4. **第四阶段**（P1，根据效果决定）：
   - RERUN：Top-2 语言重跑
   - WORD：Word-level 置信度
   - HOMOPHONE：同音候选生成

---

## 📝 建议

1. **立即补充**：
   - 手动截断识别机制说明
   - Opus 处理流程（或改为服务端处理）
   - 音频时长计算方法（或要求 Web 端传递）

2. **可以开始**：
   - CONF-1 和 CONF-2（无依赖）
   - 数据结构定义和接口设计

3. **后续完善**：
   - 质量评分公式的权重调整（通过 A/B 测试）
   - 同音候选生成的具体实现（需要调研）

