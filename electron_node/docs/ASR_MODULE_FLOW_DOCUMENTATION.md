# ASR模块流程与代码逻辑文档

## 文档目的
本文档详细描述ASR模块的完整流程和代码逻辑，包括每个方法的调用关系，用于决策部门审议。

## 文档版本
- **版本**: v2.1
- **更新日期**: 2026年2月
- **适用范围**: 节点端 ASR 处理流程
- **变更说明**: v2.1 移除对已删除组件 OriginalJobResultDispatcher 的描述，统一为当前单 pipeline + ResultSender/buildResultsToSend 结果发送路径。

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

4. **`PipelineOrchestratorASRHandler`** (`pipeline-orchestrator/pipeline-orchestrator-asr.ts`)
   - ASR任务路由和处理，调用TaskRouter执行ASR识别

5. **结果发送**：主流程不经过独立 Dispatcher；ASR 及后续步骤在 `runJobPipeline` 内顺序执行，结果经 `buildJobResult` → `buildResultsToSend`（含 `pendingEmptyJobs` 空容器）→ `ResultSender.sendJobResult` 发送。**说明**：`OriginalJobResultDispatcher` 已移除（死代码清理），当前仅保留上述单一路径。

6. **Session 亲和**：由调度端 Redis + select_node 实现，节点端不再维护 SessionAffinityManager。

---

## 2. 完整流程调用链

### 2.1 入口：runAsrStep

**文件**: `pipeline/steps/asr-step.ts`

**调用路径**:
```
runAsrStep(job, ctx, services, options?)
  ↓
  1. 创建 PipelineOrchestratorAudioProcessor
  2. 调用 audioProcessor.processAudio(job)
  3. 若有 originalJobInfo，将空容器记入 ctx.pendingEmptyJobs（由 node-agent 统一发送）
  4. 遍历 audioSegments，调用 ASR 服务，结果写入 ctx（asrText、asrSegments 等）
  5. 后续步骤（聚合→同音纠错→语义修复→去重→翻译→TTS）在同一 pipeline 内顺序执行，最终经 buildJobResult → buildResultsToSend → ResultSender 发送
```

**关键逻辑**:
- 处理音频聚合结果（`audioProcessResult`）
- 空容器（无 ASR 批次的 originalJob）记入 `ctx.pendingEmptyJobs`，由 `buildResultsToSend` 展开为 NO_TEXT_ASSIGNED 条目不单独走 Dispatcher
- 遍历音频段调用 ASR 服务，结果直接写回 `ctx`，单 job 单 pipeline 路径

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

### 2.4 ASR 批次处理：runAsrStep 中的 ASR 调用

**逻辑**:
- 遍历 `audioSegments`
- 对每个音频段：
  1. 构建 ASRTask（包含 context_text、流式标志等）
  2. 调用 ASR 服务（流式或非流式，使用 GPU 租约）
  3. 将结果写回 `ctx`（asrText、asrSegments 等；多段时拼接）
- 空容器（originalJobInfo 中无对应批次的 job）已记入 `ctx.pendingEmptyJobs`，由 node-agent 在发送主结果时一并发送（NO_TEXT_ASSIGNED）

**说明**：原 “OriginalJobResultDispatcher” 注册/分发/forceComplete/超时清理 已移除，当前为单 job 单 pipeline 路径，无独立 dispatcher。

---

## 3. 关键逻辑分支总结

### 3.1 音频处理分支

| 条件 | 行为 | 返回结果 |
|------|------|---------|
| `isTimeoutTriggered` | 缓存到`pendingTimeoutAudio`，清空缓冲区 | `shouldReturnEmpty=true` |
| `pendingTimeoutAudio TTL过期` | 强制合并pendingTimeoutAudio和当前音频，按能量切分 | `audioSegments`数组 |
| `shouldProcessNow`（手动/pause finalize） | 合并pending音频，按能量切分或整段发送（Hotfix），创建流式批次 | `audioSegments`数组 |
| 不满足`shouldProcessNow` | 累积到缓冲区 | `shouldReturnEmpty=true` |

### 3.2 结果与空容器发送分支

| 条件 | 行为 | 触发时机 |
|------|------|---------|
| 本 job 有 ASR 结果并走完 pipeline | 主结果经 `buildJobResult` 写入 result，`should_send` 由去重步骤决定 | `runJobPipeline` 结束后，`buildResultsToSend` 构建列表 |
| `ctx.pendingEmptyJobs` 非空 | 主结果发送时追加 NO_TEXT_ASSIGNED 条目，每条对应一空容器 job_id | `sendJobResultPlan` 循环中，与主结果同一次计划 |
| 去重未通过 | 不发送该 job 结果 | `ResultSender.sendJobResult` 内根据 `shouldSend` 跳过 |

---

## 4. 代码逻辑检查

### 4.1 重复逻辑检查

**检查结果**: ✅ **未发现重复逻辑**

**分析**:
- 音频处理分支：每个分支都有明确的触发条件，互不重叠
- 结果发送：单路径，主结果 + pendingEmptyJobs 由 buildResultsToSend 构建，ResultSender 按 SEND_PLAN 顺序发送，无重复分发逻辑

### 4.2 矛盾逻辑检查

**检查结果**: ✅ **未发现矛盾逻辑**

**分析**:
- **Hotfix逻辑**: `hasMergedPendingAudio` 标志在合并 pending 音频时设置，在切分后清除，逻辑一致
- **结果发送**: 仅 buildResultsToSend → sendJobResultPlan → ResultSender 一条路径，无多路触发

### 4.3 边界情况检查

**检查结果**: ✅ **边界情况已处理**

**分析**:
- 空音频处理：`isTimeoutTriggered && currentAudio.length === 0` → 返回空结果
- 空容器处理：在 runAsrStep 中记入 `ctx.pendingEmptyJobs`，由 buildResultsToSend 展开为 NO_TEXT_ASSIGNED 并随主结果一并发送
- 音频格式验证：验证必须是 opus 格式，PCM16 长度必须是 2 的倍数
- Session 清理：removeSession 时由 InferenceService 统一清理各组件；AudioAggregator 另有 cleanupExpiredBuffers 兜底

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

### 5.5 超时与清理（当前实现）

**目的**: 防止缓冲区与 session 状态长期占用内存

**实现**: 
- **AudioAggregator**：`cleanupExpiredBuffers()` 按空闲时长清理孤儿 buffer（约 1 分钟间隔）
- **Session**：断线或显式 `removeSession` 时由 InferenceService 统一清理各组件
- 原 OriginalJobResultDispatcher 的 20 秒注册清理已随该组件移除而不再存在

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

### 结果发送关键日志点（ResultSender / node-agent-result-builder）

- **SEND_PLAN**: 记录本次发送计划（job_id、reason、isEmptyJob、planFingerprint）
- **SEND_ATTEMPT**: 每条发送项尝试发送时的 job_id、reason、attemptSeq
- **SEND_DONE**: 单条发送完成

**说明**：原 OriginalJobResultDispatcher 相关日志已随该组件移除而不再存在。

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
