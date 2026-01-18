# ASR模块流程与代码逻辑文档

## 文档目的
本文档详细描述ASR模块的完整流程和代码逻辑，包括每个方法的调用关系，用于决策部门审议。

## 文档版本
- **版本**: v2.0（精简版）
- **更新日期**: 2026年1月18日
- **适用范围**: 节点端ASR处理流程

---

## 1. 模块架构概览

### 1.1 核心组件

ASR模块由以下核心组件组成：

1. **`runAsrStep`** (`pipeline/steps/asr-step.ts`)
   - ASR步骤的入口点，协调音频处理、ASR识别、结果分发

2. **`PipelineOrchestratorAudioProcessor`** (`pipeline-orchestrator/pipeline-orchestrator-audio-processor.ts`)
   - 音频聚合和格式转换的封装，调用AudioAggregator处理音频

3. **`AudioAggregator`** (`pipeline-orchestrator/audio-aggregator.ts`) - **已模块化重构**
   - 音频聚合核心逻辑，协调各个子模块处理音频
   - 子模块：
     - `AudioAggregatorUtils`: 音频工具方法（能量计算、切分点检测）
     - `AudioAggregatorMerger`: 音频合并和编码
     - `AudioAggregatorStreamBatcher`: 流式音频批处理
     - `AudioAggregatorJobContainer`: Job容器管理
     - `AudioAggregatorPauseHandler`: 暂停触发处理
     - `AudioAggregatorTimeoutHandler`: 超时处理
     - `AudioAggregatorFinalizeHandler`: Finalize处理

4. **`OriginalJobResultDispatcher`** (`pipeline-orchestrator/original-job-result-dispatcher.ts`)
   - 按原始job_id分发ASR结果，累积多个ASR批次，触发后续处理

5. **`PipelineOrchestratorASRHandler`** (`pipeline-orchestrator/pipeline-orchestrator-asr.ts`)
   - ASR任务路由和处理，调用TaskRouter执行ASR识别

6. **`SessionAffinityManager`** (`pipeline-orchestrator/session-affinity-manager.ts`)
   - Session亲和性管理，记录sessionId到nodeId的映射

---

## 2. 完整流程调用链

### 2.1 入口：runAsrStep

**文件**: `pipeline/steps/asr-step.ts`

**调用路径**:
```
runAsrStep(job, ctx, services, options?)
  ↓
  1. 创建PipelineOrchestratorAudioProcessor
  2. 调用audioProcessor.processAudio(job)
  3. 如果存在originalJobIds，注册到dispatcher
  4. 遍历audioSegments，调用ASR服务
  5. 通过dispatcher分发ASR结果
```

**关键逻辑**:
- 处理音频聚合结果（`audioProcessResult`）
- 如果存在`originalJobIds`，按`originalJobId`分组注册
- 设置`expectedSegmentCount`（finalize时为batchCount，否则为undefined）
- 遍历音频段，调用ASR服务，通过dispatcher累积结果

---

### 2.2 音频处理：PipelineOrchestratorAudioProcessor.processAudio

**文件**: `pipeline-orchestrator/pipeline-orchestrator-audio-processor.ts`

**调用路径**:
```
processAudio(job)
  ↓
  1. 调用audioAggregator.processAudioChunk(job)
  2. 检查shouldReturnEmpty，如果为true则返回空结果
  3. 验证音频格式（必须是opus）和长度（PCM16要求2的倍数）
  4. 返回AudioProcessorResult
```

---

### 2.3 音频聚合核心：AudioAggregator.processAudioChunk

**文件**: `pipeline-orchestrator/audio-aggregator.ts`

**这是最复杂的模块，包含以下主要逻辑分支**:

#### 2.3.1 初始化/获取缓冲区

**逻辑**:
- 获取或创建sessionId对应的AudioBuffer
- 解码音频块（Opus -> PCM16）
- 计算当前音频时长，记录originalJobInfo

#### 2.3.2 处理pendingTimeoutAudio TTL过期

**逻辑**:
- 检查pendingTimeoutAudio是否存在且TTL过期（>10秒）
- 如果过期，强制合并pendingTimeoutAudio和当前音频
- 按能量切分，返回音频段

#### 2.3.3 处理超时finalize（isTimeoutTriggered）

**逻辑**:
- 聚合所有音频块
- 记录sessionId->nodeId映射（Session Affinity）
- 缓存到`pendingTimeoutAudio`，等待下一个job合并
- 清空当前缓冲区，返回空结果（`shouldReturnEmpty=true`）

#### 2.3.4 处理手动/pause finalize（shouldProcessNow）

**逻辑**:
1. 合并pending音频：
   - 合并`pendingTimeoutAudio`（如果存在）
   - 合并`pendingPauseAudio`（如果存在且当前音频很短<1秒）
   - 合并`pendingSmallSegments`（如果不是独立utterance）

2. Hotfix：判断是否禁用流式切分
   - 如果`hasMergedPendingAudio=true`，整段音频作为一个批次
   - 否则，按能量切分（`splitAudioByEnergy`）

3. 创建流式批次（`createStreamingBatchesWithPending`）
   - 每个批次≥5秒
   - 独立utterance时，剩余片段也处理（不缓存）

4. 分配originalJobIds（头部对齐策略）

5. 返回音频段数组

#### 2.3.5 正常累积（不满足shouldProcessNow）

**逻辑**:
- 将当前音频块添加到缓冲区
- 更新`totalDurationMs`和`originalJobInfo`
- 返回空结果（`shouldReturnEmpty=true`）

---

### 2.4 注册原始Job：runAsrStep中的注册逻辑

**逻辑**:
- 遍历`uniqueOriginalJobIds`
- 计算每个`originalJobId`对应的batch数量
- 设置`expectedSegmentCount`：
  - `isFinalize`时：`batchCountForThisJob`
  - 非finalize时：`undefined`（累积等待）
- 调用`dispatcher.registerOriginalJob()`

---

### 2.5 ASR批次处理：runAsrStep中的ASR调用

**逻辑**:
- 遍历`audioSegments`
- 对每个音频段：
  1. 构建ASRTask（包含context_text、流式标志等）
  2. 调用ASR服务（流式或非流式，使用GPU租约）
  3. 如果存在`originalJobIds`，调用`dispatcher.addASRSegment()`（包含`batchIndex`）
  4. 否则，更新JobContext

---

### 2.6 ASR结果分发：OriginalJobResultDispatcher.addASRSegment

**逻辑**:
1. 获取registration，更新`lastActivityAt`
2. 累积ASR结果到`accumulatedSegments`和`accumulatedSegmentsList`
3. 检查是否应该立即处理：
   - `expectedSegmentCount != null && accumulatedSegments.length >= expectedSegmentCount`
4. 如果应该处理：
   - 标记`isFinalized=true`
   - 按`batchIndex`排序`accumulatedSegments`
   - 合并文本：`sortedSegments.map(s => s.asrText).join(' ')`
   - 调用callback（触发SR、NMT、TTS）
   - 清除注册信息

---

### 2.7 强制完成：OriginalJobResultDispatcher.forceComplete

**设计说明**:
- 仅作为异常兜底路径（例如少数batch丢失的极端情况）
- 正常业务不依赖此函数触发SR，主流程通过`addASRSegment`触发
- 调用方只在finalize后的"最后安全点"调用一次

**逻辑**:
- 早期返回：如果`registration.isFinalized`，直接返回（避免双回调）
- 如果有累积的ASR结果，立即处理（按`batchIndex`排序后合并文本）
- 触发callback（SR、NMT、TTS）
- 清除注册信息

---

### 2.8 超时清理：OriginalJobResultDispatcher.cleanupExpiredRegistrations

**逻辑**:
- 构造函数中启动定时器（每5秒检查一次）
- 清理`!isFinalized && idleMs > 20秒`的注册信息
- **不触发SR**，只清理内存，记录警告日志

---

## 3. 关键逻辑分支总结

### 3.1 音频处理分支

| 条件 | 行为 | 返回结果 |
|------|------|---------|
| `isTimeoutTriggered` | 缓存到`pendingTimeoutAudio`，清空缓冲区 | `shouldReturnEmpty=true` |
| `pendingTimeoutAudio TTL过期` | 强制合并pendingTimeoutAudio和当前音频，按能量切分 | `audioSegments`数组 |
| `shouldProcessNow`（手动/pause finalize） | 合并pending音频，按能量切分或整段发送（Hotfix），创建流式批次 | `audioSegments`数组 |
| 不满足`shouldProcessNow` | 累积到缓冲区 | `shouldReturnEmpty=true` |

### 3.2 ASR结果分发分支

| 条件 | 行为 | 触发时机 |
|------|------|---------|
| `originalJobIds.length > 0` | 注册到dispatcher，按originalJobId分组处理 | 在`runAsrStep`中，处理audioSegments之前 |
| `expectedSegmentCount`已设置且达到 | 立即触发callback（SR、NMT、TTS） | 在`addASRSegment`中 |
| `isFinalize` | 调用`forceComplete`强制完成所有累积的job | 在`runAsrStep`中，所有ASR批次处理完成后 |
| `!isFinalized && idleMs > 20秒` | 清理注册信息（不触发SR） | 在`cleanupExpiredRegistrations`中，每5秒检查一次 |

---

## 4. 代码逻辑检查

### 4.1 重复逻辑检查

**检查结果**: ✅ **未发现重复逻辑**

**分析**:
- 音频处理分支：每个分支都有明确的触发条件，互不重叠
- ASR结果分发：逻辑清晰，无重复
  - `addASRSegment` → 累积并检查是否达到expectedSegmentCount
  - `forceComplete` → 强制完成（仅在finalize时调用，有早期返回防御）
  - `cleanupExpiredRegistrations` → 超时清理（不触发SR）

### 4.2 矛盾逻辑检查

**检查结果**: ✅ **未发现矛盾逻辑**

**分析**:
- **Hotfix逻辑**: `hasMergedPendingAudio`标志在合并pending音频时设置，在切分后清除，逻辑一致
- **expectedSegmentCount设置**: `isFinalize`时设置为batchCount，非finalize时为undefined，逻辑一致
- **forceComplete调用**: 仅在`isFinalize`时调用，有早期返回防御，不会与`addASRSegment`冲突
- **超时清理**: 只清理`!isFinalized`的注册，不触发SR，逻辑一致

### 4.3 边界情况检查

**检查结果**: ✅ **边界情况已处理**

**分析**:
- 空音频处理：`isTimeoutTriggered && currentAudio.length === 0` → 返回空结果
- 空容器处理：在`runAsrStep`中检测空容器，发送空结果核销
- 音频格式验证：验证必须是opus格式，PCM16长度必须是2的倍数
- 注册信息清理：正常完成时清理，超时清理（20秒），session下无注册信息时清理session

---

## 5. 关键设计决策

### 5.1 Hotfix：合并音频场景禁用流式切分

**目的**: 避免合并后的音频被错误切分，导致句头丢失

**实现**: 
- 在合并`pendingTimeoutAudio`或`pendingPauseAudio`时设置`hasMergedPendingAudio`标志
- 如果标志为true，跳过`splitAudioByEnergy`，直接使用整段音频作为一个批次
- 处理完成后清除标志

### 5.2 流式切分：长音频按能量切分

**目的**: 将长音频切分成多个批次，提高ASR识别准确度和响应速度

**实现**: 
- 使用`splitAudioByEnergy`按能量和静音切分音频
- 参数：maxSegmentDurationMs=10秒，minSegmentDurationMs=2秒，hangover=600ms
- 创建流式批次（每个批次≥5秒）

### 5.3 头部对齐策略：originalJobIds分配

**目的**: 确保每个ASR批次对应正确的原始job_id

**实现**: 
- 在`createStreamingBatchesWithPending`中，根据音频段的字节偏移范围分配originalJobId
- 使用头部对齐策略：每个批次对应其起始位置所在的job

### 5.4 批次排序：按batchIndex排序

**目的**: 确保多个ASR批次的文本按正确顺序合并

**实现**: 
- 在`addASRSegment`中记录`batchIndex`
- 在触发callback前，按`batchIndex`排序`accumulatedSegments`
- 按排序后的顺序合并文本

### 5.5 20秒超时清理

**目的**: 防止极端异常场景下utteranceState永久占用内存

**实现**: 
- 在`OriginalJobResultDispatcher`构造函数中启动定时器（每5秒检查一次）
- 清理`!isFinalized && idleMs > 20秒`的注册信息
- 不触发SR，只清理内存

---

## 6. 关键参数配置

### AudioAggregator参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `MAX_BUFFER_DURATION_MS` | 20000 | 最大缓冲时长：20秒 |
| `MIN_AUTO_PROCESS_DURATION_MS` | 10000 | 最短自动处理时长：10秒 |
| `SPLIT_HANGOVER_MS` | 600 | 分割点Hangover：600ms |
| `MIN_ACCUMULATED_DURATION_FOR_ASR_MS` | 5000 | 最小累积时长：5秒（用于ASR流式批次） |
| `PENDING_TIMEOUT_AUDIO_TTL_MS` | 10000 | pendingTimeoutAudio TTL：10秒 |

### OriginalJobResultDispatcher参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `UTT_TIMEOUT_MS` | 20000 | Utterance超时：20秒 |
| `cleanupInterval` | 5000 | 清理检查间隔：5秒 |

### 流式切分参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `maxSegmentDurationMs` | 10000 | 最大段时长：10秒 |
| `minSegmentDurationMs` | 2000 | 最小段时长：2秒 |
| `hangover` | 600 | Hangover：600ms |

---

## 7. 日志记录摘要

### AudioAggregator关键日志点

- **音频聚合** (`aggregateAudioChunks`): 记录chunk数量、总大小、时长
- **超时finalize** (`timeoutFinalize`): 记录聚合音频大小、时长、chunk信息
- **合并pending音频** (`mergePendingTimeoutAudio`、`mergePendingPauseAudio`): 记录合并前后的大小、时长
- **流式切分** (`splitAudioByEnergy`): 记录输入输出段数量、每段时长
- **批次创建** (`createStreamingBatchesWithPending`): 记录批次数量、剩余段数量

### OriginalJobResultDispatcher关键日志点

- **ASR批次累积** (`accumulateASRSegment`): Debug级别，记录批次索引、累积数量
- **文本合并** (`mergeASRText`): 记录批次数量、每批次文本预览、合并后文本预览
- **强制完成** (`forceComplete`): 记录触发原因、批次数量
- **超时清理** (`cleanupExpiredRegistrations`): 警告级别，记录过期数量、空闲时长

**日志字段规范**: 所有日志包含`operation`字段，便于过滤和搜索

---

## 8. 总结

### 8.1 流程完整性

✅ **流程完整**: 从音频输入到ASR结果输出的完整流程已实现  
✅ **逻辑清晰**: 每个分支都有明确的触发条件和处理逻辑  
✅ **无重复逻辑**: 各分支互不重叠，职责明确  
✅ **无矛盾逻辑**: 各分支逻辑一致，无冲突

### 8.2 关键特性

1. **音频聚合**: 根据finalize标识聚合音频，提高识别准确度
2. **流式切分**: 长音频按能量切分，提高响应速度
3. **Hotfix**: 合并音频场景禁用流式切分，避免句头丢失
4. **批次排序**: 按batchIndex排序，确保文本顺序正确
5. **超时清理**: 20秒超时清理，防止内存泄漏

### 8.3 相关文档

- `LONG_UTTERANCE_STREAMING_AND_SR_TRIGGER_SPEC.md` - 长语音流式ASR技术规范
- `ASR_MODULE_DESIGN_COMPLIANCE_REVIEW.md` - 设计符合性评审
- `IMPLEMENTATION_SUMMARY.md` - 实现总结

---

**文档结束**
