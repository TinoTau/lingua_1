# 音频能量切分阈值优化说明

## 修改日期
2026-01-24

## 问题描述

在测试中发现，超过5秒的MaxDuration任务中，虽然有自然停顿（如呼吸），但音频没有被识别出来并切断，导致每个job被切分的段数太少，没有最大化利用audio-aggregator的功能。

### 具体表现

从测试日志可以看到：
- **Job 1**: 9.1秒音频，只切分为1段
- **Job 3**: 9.1秒音频，只切分为1段
- **Job 4**: 约9秒音频，只切分为1段
- **Job 5**: 约9秒音频，只切分为1段

这些长音频中应该有自然停顿，但没有被识别并切分。

## 根本原因

在 `splitAudioByEnergy` 方法中，如果音频总时长 `<= maxSegmentDurationMs`，会直接返回整段音频，不会进行切分。

**原设置**:
- `maxSegmentDurationMs`: 10000ms (10秒)
- `minSegmentDurationMs`: 2000ms (2秒)

**问题**: 9秒的音频因为 `<= 10秒`，所以直接返回，不会查找自然停顿并切分。

## 解决方案

将 `maxSegmentDurationMs` 从 **10秒降低到5秒**，这样：
1. 9秒的音频会被识别为需要切分（`9秒 > 5秒`）
2. 系统会查找音频中的自然停顿（如呼吸、短暂停顿）
3. 在停顿处切分，将9秒音频切分成多个段（例如：5秒 + 4秒）

## 修改内容

### 1. audio-aggregator.ts (手动/Timeout finalize)

**位置**: 行486-491

**修改前**:
```typescript
const audioSegments = this.audioUtils.splitAudioByEnergy(
  audioToProcess,
  10000, // maxSegmentDurationMs: 10秒
  2000,  // minSegmentDurationMs: 2秒
  this.SPLIT_HANGOVER_MS
);
```

**修改后**:
```typescript
// 优化：降低maxSegmentDurationMs从10秒到5秒，以便在长音频中识别自然停顿并切分
// 这样9秒的音频如果有自然停顿（如呼吸），就能被切分成多个段，最大化利用audio-aggregator的功能
const audioSegments = this.audioUtils.splitAudioByEnergy(
  audioToProcess,
  5000, // maxSegmentDurationMs: 5秒（从10秒降低，以便识别自然停顿）
  2000,  // minSegmentDurationMs: 2秒
  this.SPLIT_HANGOVER_MS
);
```

### 2. audio-aggregator-maxduration-handler.ts (MaxDuration finalize)

**位置**: 行135-140

**修改前**:
```typescript
const audioSegments = this.audioUtils.splitAudioByEnergy(
  audioToProcess,
  10000, // maxSegmentDurationMs: 10秒
  2000,  // minSegmentDurationMs: 2秒
  600    // SPLIT_HANGOVER_MS
);
```

**修改后**:
```typescript
// 优化：降低maxSegmentDurationMs从10秒到5秒，以便在MaxDuration finalize的长音频中识别自然停顿
// 这样9秒的音频如果有自然停顿（如呼吸），就能被切分成多个段，最大化利用audio-aggregator的功能
const audioSegments = this.audioUtils.splitAudioByEnergy(
  audioToProcess,
  5000, // maxSegmentDurationMs: 5秒（从10秒降低，以便识别自然停顿）
  2000,  // minSegmentDurationMs: 2秒
  600    // SPLIT_HANGOVER_MS
);
```

### 3. audio-aggregator-timeout-handler.ts (Timeout finalize)

**位置**: 行148-153

**修改前**:
```typescript
const audioSegments = this.audioUtils.splitAudioByEnergy(
  mergedAudio,
  10000, // maxSegmentDurationMs: 10秒
  2000,  // minSegmentDurationMs: 2秒
  this.SPLIT_HANGOVER_MS
);
```

**修改后**:
```typescript
// 优化：降低maxSegmentDurationMs从10秒到5秒，以便在Timeout finalize的长音频中识别自然停顿
const audioSegments = this.audioUtils.splitAudioByEnergy(
  mergedAudio,
  5000, // maxSegmentDurationMs: 5秒（从10秒降低，以便识别自然停顿）
  2000,  // minSegmentDurationMs: 2秒
  this.SPLIT_HANGOVER_MS
);
```

### 4. audio-aggregator-utils.ts (文档注释)

**位置**: 行271

**修改前**:
```typescript
* @param maxSegmentDurationMs 单段最大时长（默认10秒）
```

**修改后**:
```typescript
* @param maxSegmentDurationMs 单段最大时长（默认5秒，已优化以便识别自然停顿）
```

## 预期效果

### 修改前
- 9秒音频 → 1段（不切分）
- 无法识别自然停顿

### 修改后
- 9秒音频 → 2-3段（在自然停顿处切分）
- 例如：5秒 + 4秒，或 4秒 + 3秒 + 2秒
- 最大化利用audio-aggregator的功能

## 切分逻辑说明

`splitAudioByEnergy` 方法的工作流程：

1. **检查音频长度**:
   - 如果 `totalDurationMs <= maxSegmentDurationMs`，直接返回整段
   - 如果 `totalDurationMs < minSegmentDurationMs`，直接返回整段（避免切得太碎）

2. **查找自然停顿**:
   - 使用 `findLongestPauseAndSplit` 查找音频中最长的停顿
   - 最小停顿时长：200ms
   - 使用自适应阈值识别静音段

3. **在停顿处切分**:
   - 在最长停顿处切分
   - 应用hangover（600ms），避免在单词中间切断

4. **递归切分**:
   - 如果切分后的段仍然 `> maxSegmentDurationMs`，递归切分
   - 最大递归深度：10层

## 注意事项

1. **minSegmentDurationMs保持2秒**: 避免切得太碎，确保每段至少2秒，有利于ASR识别

2. **hangover保持600ms**: 确保不在单词中间切断，提高ASR识别准确度

3. **递归深度限制**: 最大10层，防止栈溢出

4. **向后兼容**: 修改不影响短音频（< 5秒）的处理，它们仍然直接返回

## 测试建议

1. **测试长音频切分**:
   - 录制9-10秒的音频，包含自然停顿
   - 验证是否能正确切分成多个段

2. **测试短音频**:
   - 录制2-4秒的音频
   - 验证仍然直接返回，不切分

3. **测试边界情况**:
   - 5秒音频（刚好等于阈值）
   - 5.1秒音频（刚好超过阈值）

4. **检查日志**:
   - 查看 `AudioAggregatorUtils: [SplitByEnergy] Split audio at pause` 日志
   - 确认切分段数和切分位置

---

**文档结束**
