# 音频聚合和NMT分隔符修复方案

**日期**: 2025-12-30  
**状态**: ✅ **已实现**

---

## 一、问题描述

### 1. NMT翻译截断问题

当有 `context_text` 时，NMT服务会翻译"context_text + text"，然后需要从完整翻译中提取只当前句的翻译部分。但提取逻辑不准确，导致翻译结果开头被截断。

**示例**：
- 完整翻译：`"Then then, the reverse speed of the sound is still rather slow now, because it's already passed a dozen seconds, until there's the first step back."`
- Context翻译：`"Then, the reverse speed of the sound is still slower now, because it's already passed a dozen second..."`
- 提取结果：`"ssed a dozen seconds, until there's the first step back."` ❌ 开头被截断

### 2. ASR原文截断问题

ASR识别结果有截断，可能是：
- 音频被分割成多个短句
- ASR识别不完整的短句
- 需要将短句聚合成完整句子后再进行ASR识别

---

## 二、解决方案

### 方案1：NMT翻译截断 - 使用特殊分隔符 ✅

**实现位置**: `electron_node/services/nmt_m2m100/nmt_service.py`

**方法**：
1. 在拼接 `context_text` 和 `text` 时，添加特殊分隔符 `<SEP>`
2. 在提取翻译时，查找分隔符的位置，准确分割

**代码修改**：
```python
# 拼接时添加分隔符
SEPARATOR = " <SEP> "
if req.context_text:
    input_text = f"{req.context_text}{SEPARATOR}{req.text}"

# 提取时查找分隔符
SEPARATOR_TRANSLATIONS = [" <SEP> ", " <sep> ", " <Sep> ", " <SEP>", "<SEP>", " <sep>", "<sep>"]
separator_pos = -1
for sep_variant in SEPARATOR_TRANSLATIONS:
    pos = out.find(sep_variant)
    if pos != -1:
        separator_pos = pos + len(sep_variant)
        break

if separator_pos != -1:
    final_output = out[separator_pos:].strip()  # 提取分隔符之后的部分
else:
    # 回退到原来的方法（单独翻译context_text）
    ...
```

**优势**：
- ✅ 准确识别分界点，避免截断
- ✅ 如果分隔符找不到，自动回退到原来的方法
- ✅ 不影响没有 `context_text` 的情况

---

### 方案2：ASR之前音频聚合 ✅

**实现位置**: 
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` (新建)
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` (集成)

**方法**：
1. 在ASR之前，根据 `is_manual_cut` 和 `is_pause_triggered` 标识聚合音频
2. 将多个短音频块聚合成完整句子后再进行ASR识别

**工作流程**：
```
Web端发送音频块 → AudioAggregator缓冲 → 检测到is_manual_cut或is_pause_triggered → 聚合音频 → ASR识别完整句子
```

**触发条件**：
- `is_manual_cut = true`：用户手动发送，立即处理
- `is_pause_triggered = true`：3秒静音触发，立即处理
- 超过最大缓冲时长（20秒）：立即处理

**代码结构**：
```typescript
class AudioAggregator {
  // 处理音频块，根据标识决定是否聚合
  async processAudioChunk(job: JobAssignMessage): Promise<Buffer | null> {
    // 1. 解码当前音频块（Opus → PCM16）
    // 2. 添加到缓冲区
    // 3. 检查是否应该立即处理
    // 4. 如果应该处理，聚合所有音频块并返回
    // 5. 否则返回null（继续缓冲）
  }
}
```

**优势**：
- ✅ 避免ASR识别不完整的短句
- ✅ 提高ASR识别准确率（长句上下文更完整）
- ✅ 减少NMT翻译次数（合并后的句子更少）
- ✅ 根据用户行为（手动发送/3秒静音）智能聚合

---

## 三、实现细节

### 1. NMT分隔符实现

**文件**: `electron_node/services/nmt_m2m100/nmt_service.py`

**修改点**：
1. **拼接时添加分隔符**（第466行）：
   ```python
   SEPARATOR = " <SEP> "
   input_text = f"{req.context_text}{SEPARATOR}{req.text}"
   ```

2. **提取时查找分隔符**（第624-640行）：
   ```python
   SEPARATOR_TRANSLATIONS = [" <SEP> ", " <sep> ", " <Sep> ", " <SEP>", "<SEP>", " <sep>", "<sep>"]
   separator_pos = -1
   for sep_variant in SEPARATOR_TRANSLATIONS:
       pos = out.find(sep_variant)
       if pos != -1:
           separator_pos = pos + len(sep_variant)
           break
   
   if separator_pos != -1:
       final_output = out[separator_pos:].strip()
   else:
       # 回退到原来的方法
   ```

### 2. 音频聚合实现

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`

**核心功能**：
- `processAudioChunk()`: 处理音频块，决定是否聚合
- `aggregateAudioChunks()`: 聚合多个音频块
- `clearBuffer()`: 清空缓冲区
- `getBufferStatus()`: 获取缓冲区状态

**集成点**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**修改点**：
1. **初始化AudioAggregator**（第56行）：
   ```typescript
   private audioAggregator: AudioAggregator;
   this.audioAggregator = new AudioAggregator();
   ```

2. **在ASR之前调用音频聚合**（第174-204行）：
   ```typescript
   const aggregatedAudio = await this.audioAggregator.processAudioChunk(job);
   if (aggregatedAudio === null) {
     // 音频被缓冲，返回空结果
     return { text_asr: '', ... };
   }
   // 使用聚合后的音频进行ASR
   ```

---

## 四、测试验证

### 测试场景

1. **NMT分隔符测试**：
   - 有 `context_text` 的翻译请求
   - 验证分隔符是否能准确识别
   - 验证提取的翻译是否完整

2. **音频聚合测试**：
   - 多个短音频块 + `is_manual_cut = true`
   - 多个短音频块 + `is_pause_triggered = true`
   - 多个短音频块 + 超过20秒
   - 验证聚合后的音频是否完整
   - 验证ASR识别是否更准确

### 预期效果

1. **NMT翻译截断问题**：
   - ✅ 翻译结果不再有开头截断
   - ✅ 提取逻辑更准确

2. **ASR原文截断问题**：
   - ✅ ASR识别更完整
   - ✅ 减少短句识别错误
   - ✅ 提高整体识别准确率

---

## 五、相关文件

- `electron_node/services/nmt_m2m100/nmt_service.py` - NMT服务分隔符实现
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` - 音频聚合器（新建）
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - 集成音频聚合器
- `electron_node/docs/short_utterance/TEXT_TRUNCATION_ANALYSIS.md` - 原始问题分析

---

## 六、注意事项

1. **NMT分隔符**：
   - 分隔符 `<SEP>` 可能被翻译成不同的形式，需要支持多种变体
   - 如果找不到分隔符，会自动回退到原来的方法

2. **音频聚合**：
   - 最大缓冲时长：20秒（可配置）
   - 如果音频被缓冲，会返回空结果，等待更多音频块或触发标识
   - 需要确保调度服务器正确处理空结果

3. **性能影响**：
   - 音频聚合会增加内存使用（缓冲多个音频块）
   - 但可以减少ASR和NMT调用次数，整体性能可能提升

---

## 七、后续优化

1. **动态调整缓冲时长**：根据音频质量动态调整最大缓冲时长
2. **智能分隔符**：使用更不容易被翻译的分隔符，或使用特殊token
3. **错误处理**：增强错误处理，确保在异常情况下也能正常工作

