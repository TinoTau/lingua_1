# 任务处理流程

**日期**: 2026-01-24  
**目的**: 详细说明调度服务器端和节点端的任务处理流程

---

## 一、调度服务器端任务处理

### 1.1 任务创建流程

**完整流程图**:
```
客户端 → WebSocket消息（包含音频数据）
  ↓
SessionActor.finalize()
  ↓
create_translation_jobs()
  ├─ 检查是否在房间中
  ├─ 检查是否已存在相同的 job（幂等性）
  ├─ create_job_with_minimal_scheduler()
  │   └─ MinimalScheduler.create_job()
  │       └─ JobDispatcher.save_job()
  │           └─ JobRedisRepository.save_job()
  │               └─ 写入 Redis: lingua:v1:job:{job_id}
  ├─ 节点选择
  │   └─ PoolService.select_node()
  │       └─ select_node.lua
  │           ├─ 检查 Session Affinity
  │           ├─ 查找 Pool
  │           └─ 随机选择节点
  └─ 发送任务到节点（WebSocket）
```

### 1.2 关键代码位置

**任务创建**:
- `websocket/session_actor/actor/actor_finalize.rs:do_finalize()` - Finalize 处理
- `websocket/job_creator.rs:create_translation_jobs()` - 任务创建入口
- `core/dispatcher/job_management.rs:save_job()` - 保存 Job 到 Redis

**节点选择**:
- `pool/pool_service.rs:select_node()` - 节点选择
- `scripts/lua/select_node.lua` - 节点选择逻辑（支持 Session Affinity）

### 1.3 任务状态管理

**Job 状态枚举**:
```rust
pub enum JobStatus {
    Pending,        // 待分配
    Assigned,       // 已分配
    Processing,     // 处理中
    Completed,      // 已完成
    CompletedNoText,// 空容器核销
    Failed,         // 失败
}
```

**状态转换**:
```
Pending → Assigned → Processing → Completed
   ↓         ↓           ↓            ↓
 Failed   Failed      Failed      Failed
```

---

## 二、节点端任务处理

### 2.1 完整调用链

```
调度服务器发送 JobAssignMessage
  ↓
节点端接收任务 (node-agent-simple.ts)
  ↓
JobProcessor.processJob()
  ↓
runJobPipeline() (job-pipeline.ts)
  ↓
executeStep('ASR', ...) (pipeline-step-registry.ts)
  ↓
runAsrStep() (asr-step.ts)
  ├─→ PipelineOrchestratorAudioProcessor.processAudio()
  │     └─→ AudioAggregator.processAudioChunk() 【阶段1】
  │           ├─→ MaxDuration Handler (如果是 MaxDuration finalize)
  │           ├─→ Finalize Handler (如果是手动/timeout finalize)
  │           └─→ 容器分配算法 (assignOriginalJobIdsForBatches)
  │
  ├─→ ASR 服务调用 (taskRouter.routeASRTask) 【阶段2】
  │     └─→ OriginalJobResultDispatcher.addASRSegment()
  │           └─→ 触发回调: runJobPipeline() (跳过 ASR 步骤)
  │                 └─→ executeStep('AGGREGATION', ...)
  │                       └─→ runAggregationStep() 【阶段3】
  │                             └─→ AggregationStage.process()
  │
  └─→ 返回结果给调度服务器
```

### 2.2 三种 Finalize 类型的处理路径

| Finalize 类型 | AudioAggregator 处理 | ASR 处理 | UtteranceAggregator 处理 |
|--------------|---------------------|---------|------------------------|
| **MaxDuration** | 按能量切片，处理前5秒（及以上），剩余部分缓存 | 立即处理前5秒（及以上）音频 | 每个原始 job 独立处理 |
| **手动** | 立即处理，合并 pending 音频 | 立即处理所有音频 | 每个原始 job 独立处理 |
| **Timeout** | 立即处理，合并 pending 音频，短音频缓存 | 立即处理所有音频 | 每个原始 job 独立处理 |

### 2.3 阶段1：AudioAggregator 处理

**文件**: `pipeline-orchestrator/audio-aggregator.ts`

**主要方法**: `processAudioChunk(job: JobAssignMessage)`

**处理步骤**:
1. 提取 finalize 标识（`isManualCut`, `isTimeoutTriggered`, `isMaxDurationTriggered`）
2. 解码音频（Opus → PCM16）
3. 获取或创建缓冲区（使用 `bufferKey`）
4. TTL 检查（Timeout 专用，检查 `pendingTimeoutAudio`）
5. 更新缓冲区
6. 根据 finalize 类型选择处理路径：
   - **MaxDuration**: 按能量切片，处理前5秒（及以上），缓存剩余部分
   - **手动/Timeout**: 立即处理，合并 pending 音频
7. 按能量切分音频
8. 流式切分（组合成~5秒批次）
9. 分配 `originalJobIds`（容器分配算法）
10. 返回处理后的音频段

**关键逻辑**:
- **MaxDuration**: 使用 `maxDurationHandler.handleMaxDurationFinalize()`
- **手动/Timeout**: 使用 `finalizeHandler.handleFinalize()`
- **容器分配**: 使用 `assignOriginalJobIdsForBatches()`（头部对齐策略）

### 2.4 阶段2：ASR 处理

**文件**: `pipeline/steps/asr-step.ts`

**主要方法**: `runAsrStep(job, ctx, services, options)`

**处理步骤**:
1. 获取 AudioAggregator 结果
2. 检查是否应该返回空（`shouldReturnEmpty`）
3. 提取音频段和 `originalJobIds`
4. 注册原始 job（`OriginalJobResultDispatcher.registerOriginalJob()`）
5. 为每个音频段调用 ASR 服务
6. 分发 ASR 结果（`OriginalJobResultDispatcher.addASRSegment()`）
7. 触发回调（为原始 job 执行后续处理）

**关键逻辑**:
- **原始 job 注册**: 按 `originalJobId` 分组注册
- **期望片段数量**: 对于 finalize，等待所有 batch 添加完成
- **ASR 失败处理**: 创建 `missing: true` 的 ASR 段，确保 job 完成

### 2.5 阶段3：UtteranceAggregator 处理

**文件**: `agent/postprocess/aggregation-stage.ts`

**主要方法**: `process(asrData, job, ctx, services)`

**处理步骤**:
1. 提取 ASR 文本和 `utteranceIndex`
2. 调用 `AggregatorManager.processUtterance()`
3. 文本聚合和边界重建
4. 返回聚合后的文本

**关键逻辑**:
- **文本聚合**: 将多个短小的 utterance 合并成完整的句子
- **边界去重**: 去除相邻 utterance 之间的重复文本
- **语言抖动处理**: 防止因语言检测不稳定导致的错误切分

---

## 三、容器分配算法

### 3.1 头部对齐策略

**算法逻辑**:
1. 从左到右扫描 batch（B0..Bn）
2. 按顺序依次填满 job0、job1、job2...
3. 容器装满后切换到下一个容器
4. 最后一个容器允许超长或为空

**目的**:
- 确保切片数量不会超过 job 容器数量
- 实现"头部对齐"：第一个 batch 属于哪个 job，整个批次就属于该 job

**代码位置**: `audio-aggregator-job-container.ts`

---

## 四、OriginalJobResultDispatcher

### 4.1 功能

**职责**:
- 管理原始 job 的 ASR 结果聚合
- 等待所有 batch 添加完成
- 触发回调（为原始 job 执行后续处理）

### 4.2 关键机制

**期望片段数量**:
- 对于 finalize，`expectedSegmentCount = batchCountForThisJob`
- 等待所有 batch 添加完成后再处理

**TTL 机制**:
- 注册时设置 10 秒 TTL
- 如果 10 秒内没有完成，强制处理部分结果

**ASR 失败处理**:
- 如果 ASR 调用失败，创建 `missing: true` 的 ASR 段
- 确保 job 能够完成，不会一直等待

---

## 五、常见问题

### 5.1 前半句丢失

**原因**:
- 调度服务器提前 finalize（收到 `is_final=true` 后立即 finalize）
- 客户端在句子中间发送 `is_final=true`（静音检测误触发或手动发送）

**解决方案**:
- ✅ 启用 `AggregatorMiddleware`（文本聚合）
- ✅ 修复 Buffer 清除逻辑
- ✅ 实现 Session Affinity（确保相关 job 路由到同一节点）

### 5.2 utteranceIndex 不连续

**原因**:
- 某些 job 的 ASR 结果为空或被过滤
- 音频质量检查失败

**解决方案**:
- ✅ 实现 ASR 失败写-off 机制
- ✅ 实现 TTL 机制，确保部分结果能够及时处理

---

## 六、相关文档

- [节点端任务处理流程](./node_job_processing.md)
- [Finalize 处理机制](../finalize/README.md)
- [音频处理](../audio/README.md)
- [节点注册和管理](../node_registry/README.md)

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24
