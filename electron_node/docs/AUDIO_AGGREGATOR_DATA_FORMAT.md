# AudioAggregator 数据格式说明

## 文档目的
本文档详细说明 AudioAggregator 处理后的数据格式，包括内部缓冲区和返回结果的数据结构。

---

## 1. 内部缓冲区数据结构（AudioBuffer）

### 1.1 音频数据字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `audioChunks` | `Buffer[]` | **音频块数组**：累积的音频块，每个元素是一个 Buffer（PCM16格式） |
| `pendingTimeoutAudio` | `Buffer?` | **单条拼接音频**：超时finalize时缓存的音频，是一个**拼接后的单个Buffer**（不是数组） |
| `pendingPauseAudio` | `Buffer?` | **单条拼接音频**：pause finalize时缓存的短音频（<1秒），是一个**拼接后的单个Buffer** |
| `pendingSmallSegments` | `Buffer[]` | **小片段数组**：<5秒的小片段数组，等待合并成≥5秒批次 |

### 1.2 关键说明

#### `pendingTimeoutAudio` 是单个 Buffer（不是数组）

```typescript
interface AudioBuffer {
  // ❌ 不是这样：pendingTimeoutAudio?: Buffer[];
  // ✅ 实际是这样：pendingTimeoutAudio?: Buffer;
}
```

**原因**：
- 超时触发时，所有累积的音频块通过 `aggregateAudioChunks()` 合并成一个连续的 Buffer
- 这个 Buffer 代表完整的音频片段（可能包含多个job的音频）
- 等待下一个job到来时，会与下一个job的音频合并

**示例**：
```typescript
// 超时触发时
const aggregatedAudio = this.aggregateAudioChunks(buffer.audioChunks); // 合并所有chunks
buffer.pendingTimeoutAudio = aggregatedAudio; // 单个Buffer，不是数组

// 下一个job到来时
if (buffer.pendingTimeoutAudio) {
  const mergedAudio = Buffer.alloc(
    buffer.pendingTimeoutAudio.length + currentAggregated.length
  );
  buffer.pendingTimeoutAudio.copy(mergedAudio, 0);
  currentAggregated.copy(mergedAudio, buffer.pendingTimeoutAudio.length);
  // 合并后的音频用于ASR处理
}
```

#### `audioChunks` 是数组（多个音频块）

```typescript
interface AudioBuffer {
  audioChunks: Buffer[]; // 数组，每个元素是一个音频块
}
```

**原因**：
- 每个job的音频块单独存储
- 需要累积多个音频块后再聚合处理
- 聚合时通过 `aggregateAudioChunks()` 合并成单个Buffer

---

## 2. 返回结果数据结构（AudioProcessorResult）

### 2.1 返回字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `audioSegments` | `string[]?` | **base64字符串数组**：切分后的音频段，每个元素是base64编码的字符串 |
| `originalJobIds` | `string[]?` | **原始job_id数组**：每个ASR批次对应的原始job_id（头部对齐策略） |
| `originalJobInfo` | `OriginalJobInfo[]?` | **原始job信息数组**：包含utteranceIndex等信息 |
| `shouldReturnEmpty` | `boolean` | **是否返回空**：true表示音频被缓冲，等待更多音频或触发标识 |

### 2.2 数据流转过程

```
1. 输入：job.audio (Opus编码的base64字符串)
   ↓
2. 解码：decodeAudioChunk() → Buffer (PCM16)
   ↓
3. 累积：buffer.audioChunks.push(currentAudio) → Buffer[]
   ↓
4. 聚合：aggregateAudioChunks() → Buffer (单个拼接音频)
   ↓
5. 切分：splitAudioByEnergy() → Buffer[] (按能量切分的音频段数组)
   ↓
6. 批次：createStreamingBatchesWithPending() → Buffer[] (≥5秒的批次数组)
   ↓
7. 编码：batch.toString('base64') → string[]
   ↓
8. 返回：audioSegments: string[] (base64字符串数组)
```

---

## 3. 关键数据转换点

### 3.1 音频聚合（数组 → 单个Buffer）

```typescript
// 输入：Buffer[] (多个音频块)
const audioChunks: Buffer[] = buffer.audioChunks;

// 聚合：合并成单个Buffer
const aggregatedAudio = this.aggregateAudioChunks(audioChunks);
// 输出：Buffer (单个拼接音频)
```

### 3.2 音频切分（单个Buffer → 数组）

```typescript
// 输入：Buffer (单个拼接音频)
const audioToProcess: Buffer = mergedAudio;

// 切分：按能量切分成多个段
const audioSegments = this.audioUtils.splitAudioByEnergy(
  audioToProcess,
  10000, // maxSegmentDurationMs
  2000,  // minSegmentDurationMs
  600    // hangover
);
// 输出：Buffer[] (切分后的音频段数组)
```

### 3.3 批次创建（数组 → 数组，但重新组合）

```typescript
// 输入：Buffer[] (切分后的音频段)
const audioSegments: Buffer[] = [...];

// 批次：组合成≥5秒的批次
const { batches, remainingSmallSegments } = 
  this.createStreamingBatchesWithPending(audioSegments, jobInfo);
// 输出：Buffer[] (批次数组，每个批次≥5秒)
```

### 3.4 Base64编码（Buffer → string）

```typescript
// 输入：Buffer[] (批次数组)
const batches: Buffer[] = [...];

// 编码：转换为base64字符串数组
const audioSegmentsBase64 = batches.map(batch => batch.toString('base64'));
// 输出：string[] (base64字符串数组)
```

---

## 4. 数据格式总结表

| 阶段 | 数据类型 | 格式 | 说明 |
|------|--------|------|------|
| **输入** | `job.audio` | `string` | Opus编码的base64字符串 |
| **解码后** | `currentAudio` | `Buffer` | PCM16格式的单个音频块 |
| **累积中** | `buffer.audioChunks` | `Buffer[]` | 多个音频块数组 |
| **超时缓存** | `buffer.pendingTimeoutAudio` | `Buffer` | **单个拼接音频**（不是数组） |
| **聚合后** | `aggregatedAudio` | `Buffer` | 单个拼接音频 |
| **切分后** | `audioSegments` | `Buffer[]` | 切分后的音频段数组 |
| **批次后** | `batches` | `Buffer[]` | ≥5秒的批次数组 |
| **返回结果** | `audioSegments` | `string[]` | base64字符串数组 |

---

## 5. 关键要点

### ✅ `pendingTimeoutAudio` 是单个 Buffer
- **不是数组**，是拼接后的单个连续音频
- 包含完整的音频片段（可能跨多个job）
- 等待下一个job合并时，会与下一个job的音频拼接

### ✅ `audioChunks` 是数组
- 每个元素是一个音频块（Buffer）
- 需要累积多个块后再聚合

### ✅ 返回的 `audioSegments` 是字符串数组
- 每个元素是base64编码的字符串
- 对应一个ASR批次（≥5秒）

---

**文档版本**: v1.0  
**更新日期**: 2026年1月18日
