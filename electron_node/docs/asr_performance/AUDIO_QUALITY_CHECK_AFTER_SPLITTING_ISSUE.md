# 音频质量检查在切分后的问题分析

**日期**: 2026-01-28  
**问题**: 同样的音调和语速，前半句质量合格，后半句质量不合格，导致后半句丢失

---

## 一、问题现象

1. **用户观察**：
   - 使用同样的音调和语速
   - 前半句质量合格，后半句质量不合格
   - 每个出问题的job都是丢失了后半句

2. **怀疑**：
   - 怀疑还是有直接丢弃文本的逻辑

---

## 二、根本原因分析

### 2.1 音频处理流程

1. **音频切分**：
   - 音频被按能量切分成多个片段（`splitAudioByEnergy`）
   - 这些片段被组合成~5秒的batch

2. **质量检查时机**：
   - **每个batch在发送到ASR服务之前，都会单独进行音频质量检查**
   - 检查位置：`task-router-asr.ts` → `routeASRTask` → `checkAudioQuality`

3. **问题所在**：
   - 音频按能量切分后，不同的片段可能有不同的RMS值
   - 如果后半部分的音频片段能量较低（比如在句子末尾，音量自然下降，或者在切分点附近有静音），它们的RMS可能低于阈值0.015
   - 这些batch被拒绝后，返回空结果，导致后半句丢失

### 2.2 代码流程

```
音频输入
  ↓
按能量切分 (splitAudioByEnergy)
  ↓
组合成~5秒batch (createStreamingBatchesWithPending)
  ↓
对每个batch循环处理
  ↓
  ├─→ batch 1: checkAudioQuality → RMS >= 0.015 ✅ → 发送到ASR → 返回文本
  ├─→ batch 2: checkAudioQuality → RMS < 0.015 ❌ → 拒绝 → 返回空结果
  └─→ batch 3: checkAudioQuality → RMS < 0.015 ❌ → 拒绝 → 返回空结果
  ↓
合并结果 → 后半句丢失（因为batch 2和3返回空结果）
```

### 2.3 为什么后半句更容易被拒绝？

1. **音量自然下降**：
   - 句子末尾，说话者音量可能自然下降
   - 导致后半部分的RMS值较低

2. **切分点位置**：
   - 音频按能量切分，切分点通常在能量最低的地方（停顿处）
   - 切分后的后半部分可能从低能量区域开始，导致RMS值较低

3. **hangover机制**：
   - 切分时会应用hangover（600ms），将一部分低能量区域包含到前半部分
   - 这可能导致后半部分从更低能量的区域开始

---

## 三、解决方案

### 方案1: 对后续batch使用更宽松的阈值（推荐）

**思路**：
- 第一个batch使用严格阈值（0.015），确保过滤真正的静音/噪音
- 后续batch使用更宽松的阈值（0.008-0.010），因为它们是切分后的片段，可能包含句子末尾的低能量部分

**实现**：
- 在`checkAudioQuality`函数中增加参数，标识是否是第一个batch
- 或者，在`asr-step.ts`中，对第一个batch和后续batch使用不同的阈值

### 方案2: 在切分前进行质量检查

**思路**：
- 在音频切分前进行质量检查
- 如果原始音频质量合格，切分后的batch都认为合格（不进行单独检查）

**问题**：
- 如果原始音频质量合格，但切分后的某个batch确实是静音，也会被处理
- 可能增加ASR服务的负担

### 方案3: 改进音频质量检查逻辑

**思路**：
- 不仅检查RMS，还检查音频时长、动态范围等
- 对于短音频（<1秒），使用更宽松的阈值
- 对于后续batch，使用更宽松的阈值

---

## 四、推荐修复方案

### 修复1: 对后续batch使用更宽松的阈值

**文件**: `task-router-asr-audio-quality.ts`

**修改**：
```typescript
export function checkAudioQuality(
  task: ASRTask,
  serviceId: string,
  isFirstBatch: boolean = true  // 新增参数
): AudioQualityInfo | null {
  // ...
  
  // 第一个batch使用严格阈值，后续batch使用更宽松的阈值
  const threshold = isFirstBatch ? MIN_RMS_THRESHOLD : MIN_RMS_THRESHOLD_RELAXED;
  const MIN_RMS_THRESHOLD_RELAXED = 0.008;  // 更宽松的阈值，用于后续batch
  
  // ...
}
```

**文件**: `asr-step.ts`

**修改**：
```typescript
// 在循环中调用checkAudioQuality时，传递isFirstBatch参数
const isFirstBatch = i === 0;
const audioQuality = checkAudioQuality(asrTask, endpoint.serviceId, isFirstBatch);
```

### 修复2: 增加日志，记录每个batch的RMS值

**目的**：
- 验证修复效果
- 帮助理解为什么后半句被拒绝

**修改**：
- 在`checkAudioQuality`中，记录每个batch的RMS值和阈值
- 在`asr-step.ts`中，记录batch索引和是否被拒绝

---

## 五、验证步骤

1. **修复后测试**：
   - 使用相同的测试文本重新测试
   - 查看日志，确认后续batch是否通过质量检查
   - 确认后半句是否不再丢失

2. **日志检查**：
   - 查看每个batch的RMS值
   - 确认第一个batch和后续batch使用的阈值
   - 确认是否有batch被拒绝

---

## 六、总结

**问题根源**：
- 音频质量检查在每个切分后的batch上单独进行
- 后半部分的batch可能因为能量较低（句子末尾音量下降、切分点位置等）而被拒绝
- 导致后半句丢失

**解决方案**：
- 对后续batch使用更宽松的阈值（0.008-0.010），而不是统一的0.015
- 第一个batch仍然使用严格阈值，确保过滤真正的静音/噪音

**这不是"直接丢弃文本"，而是"音频质量检查拒绝导致空结果"，但效果是一样的：后半句丢失了。**

---

*本分析基于代码逻辑和用户观察，需要进一步验证修复效果。*
