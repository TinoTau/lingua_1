# 流式ASR实现计划

**日期**: 2026-01-16  
**目的**: 重新实现AudioAggregator的流式切分和批次发送逻辑，支持session affinity

---

## 一、实现目标

1. **AudioAggregator流式切分**：
   - `pendingTimeoutAudio`机制：超时finalize的音频缓存，等待下一个job合并
   - `pendingSmallSegments`机制：<5秒的音频片段缓存，等待合并成≥5秒批次
   - `originalJobIds`分配：头部对齐策略，每个ASR批次对应一个originalJobId
   - 5秒流式切分：长音频按能量切分，组合成~5秒批次发送给ASR

2. **Session Affinity机制**：
   - 超时finalize时记录sessionId->nodeId映射
   - 手动/pause finalize可以随机分配
   - 提供API供调度服务器查询映射

3. **OriginalJobResultDispatcher**：
   - 按originalJobId分组ASR结果
   - 累积多个ASR批次到同一个JobResult
   - 触发后续处理（语义修复、NMT、TTS）

---

## 二、实现步骤

### 步骤1：添加音频能量切分方法
- 在`audio-aggregator-utils.ts`中添加`splitAudioByEnergy`方法
- 支持递归切分，直到每段都足够短（≤10秒）

### 步骤2：重新实现AudioAggregator
- 添加`pendingTimeoutAudio`和`pendingSmallSegments`字段
- 添加`originalJobInfo`字段（记录每个job在聚合音频中的字节偏移）
- 实现流式切分逻辑
- 实现头部对齐策略

### 步骤3：实现SessionAffinityManager
- ✅ 已创建`session-affinity-manager.ts`
- 在超时finalize时记录映射
- 在手动/pause finalize时清除映射

### 步骤4：重新实现OriginalJobResultDispatcher
- 创建`original-job-result-dispatcher.ts`
- 按originalJobId累积ASR结果
- 触发后续处理

### 步骤5：更新asr-step.ts
- 集成OriginalJobResultDispatcher
- 支持流式批次处理
- 支持跳过ASR步骤（当结果已通过dispatcher发送）

### 步骤6：更新job-pipeline.ts
- 支持`ctx?: JobContext`参数
- 支持跳过ASR步骤

### 步骤7：更新pipeline-orchestrator-audio-processor.ts
- 支持`audioSegments`和`originalJobIds`
- 返回多段音频和对应的originalJobIds

---

## 三、关键设计决策

### 3.1 流式切分策略

- **长音频（>10秒）**：按能量切分，组合成~5秒批次
- **短音频（<5秒）**：缓存到`pendingSmallSegments`，等待合并
- **超时finalize**：缓存到`pendingTimeoutAudio`，等待下一个job合并

### 3.2 头部对齐策略

- 每个ASR批次以第一个片段的originalJobId作为整个批次的originalJobId
- 简化结果分组，避免跨job的复杂分组逻辑

### 3.3 Session Affinity策略

- **超时finalize**：记录sessionId->nodeId映射，确保后续job发送到同一个节点
- **手动/pause finalize**：可以随机分配，清除映射

---

## 四、文件清单

### 需要创建的文件
1. ✅ `session-affinity-manager.ts` - 已创建
2. `original-job-result-dispatcher.ts` - 需要创建
3. `original-job-group-manager.ts` - 需要创建

### 需要修改的文件
1. `audio-aggregator.ts` - 重新实现流式切分逻辑
2. `audio-aggregator-utils.ts` - 添加`splitAudioByEnergy`方法
3. `asr-step.ts` - 集成OriginalJobResultDispatcher
4. `job-pipeline.ts` - 支持跳过ASR步骤
5. `pipeline-orchestrator-audio-processor.ts` - 支持多段音频和originalJobIds

---

**状态**: 📝 **计划完成，开始实现**
