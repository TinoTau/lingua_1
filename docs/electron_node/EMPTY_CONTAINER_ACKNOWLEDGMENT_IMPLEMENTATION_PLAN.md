# 空容器核销实现计划

根据 `LONG_UTTERANCE_CURRENT_VS_DESIGN_GAP.md` 的要求，需要实现空容器Job的空结果核销功能。

---

## 问题描述

在长语音容器分配时，可能出现：
- jobN 容器 **没有被分配到任何 batch**（例如：最后一个 job 很短 < 1s）
- 当前逻辑下：
  - Dispatcher 不会注册该 job（因为 container 为空）
  - ASR Step 永远不会触发回调
  - ResultSender 不会发送结果
  - 调度会一直等待（直到 timeout）

---

## 实现方案

### 方案1：在ASR Step中检测空容器（推荐）

**位置**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

**实现逻辑**：

1. **在注册OriginalJob之后，检测空容器**
   ```typescript
   if (originalJobIds.length > 0) {
     // 注册所有有batch的originalJob
     const uniqueOriginalJobIds = Array.from(new Set(originalJobIds));
     for (const originalJobId of uniqueOriginalJobIds) {
       // ... 注册逻辑
     }
     
     // 检测空容器：找出jobInfoToProcess中没有被分配到batch的job
     const assignedJobIds = uniqueOriginalJobIds;
     const emptyJobIds = originalJobInfo
       .map(info => info.jobId)
       .filter(jobId => !assignedJobIds.includes(jobId));
     
     // 为每个空容器发送空结果
     for (const emptyJobId of emptyJobIds) {
       const emptyJobInfo = originalJobInfo.find(info => info.jobId === emptyJobId);
       if (emptyJobInfo && services.resultSender) {
         await sendEmptyResultForJob(emptyJobInfo, job, services);
       }
     }
   }
   ```

2. **实现 sendEmptyResultForJob 辅助函数**
   ```typescript
   async function sendEmptyResultForJob(
     emptyJobInfo: OriginalJobInfo,
     currentJob: JobAssignMessage,
     services: ServicesBundle
   ): Promise<void> {
     // 创建空job消息
     const emptyJob: JobAssignMessage = {
       ...currentJob,
       job_id: emptyJobInfo.jobId,
       utterance_index: emptyJobInfo.utteranceIndex,
     };
     
     // 创建空结果
     const emptyResult: JobResult = {
       text_asr: '',
       text_translated: '',
       tts_audio: '',
       should_send: true,
       extra: {
         reason: 'NO_TEXT_ASSIGNED',
       },
     };
     
     // 发送空结果
     if (services.resultSender) {
       const startTime = Date.now();
       services.resultSender.sendJobResult(
         emptyJob,
         emptyResult,
         startTime,
         true,
         'NO_TEXT_ASSIGNED'
       );
       
       logger.info(
         {
           emptyJobId: emptyJobInfo.jobId,
           utteranceIndex: emptyJobInfo.utteranceIndex,
           sessionId: currentJob.session_id,
           reason: 'Empty container detected, sending empty result for acknowledgment',
         },
         'runAsrStep: Sent empty result for empty container job'
       );
     }
   }
   ```

---

### 方案2：在ResultSender中新增sendEmptyResult方法

**位置**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`

**实现逻辑**：

```typescript
/**
 * 发送空结果核销（用于空容器Job）
 */
sendEmptyResult(
  job: JobAssignMessage,
  reason: string = 'NO_TEXT_ASSIGNED'
): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) {
    logger.warn(
      { jobId: job.job_id, reason },
      'ResultSender: Cannot send empty result, WebSocket not ready'
    );
    return;
  }

  const emptyResult: JobResultMessage = {
    type: 'job_result',
    job_id: job.job_id,
    attempt_id: job.attempt_id,
    node_id: this.nodeId,
    session_id: job.session_id,
    utterance_index: job.utterance_index,
    success: true,
    text_asr: '',
    text_translated: '',
    tts_audio: '',
    tts_format: 'opus',
    extra: {
      reason: reason,
    },
    processing_time_ms: 0,
    trace_id: job.trace_id,
  };

  try {
    const message = JSON.stringify(emptyResult);
    this.ws.send(message);
    
    logger.info(
      {
        jobId: job.job_id,
        utteranceIndex: job.utterance_index,
        sessionId: job.session_id,
        reason,
      },
      'ResultSender: Sent empty result for empty container job'
    );
  } catch (error: any) {
    logger.error(
      {
        jobId: job.job_id,
        error: error.message,
        reason,
      },
      'ResultSender: Failed to send empty result'
    );
  }
}
```

---

## 实现步骤

### 步骤1：在ASR Step中检测空容器

**文件**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

**修改位置**：第95-247行（在注册OriginalJob之后）

**代码**：
```typescript
if (originalJobIds.length > 0) {
  // 注册所有有batch的originalJob
  const uniqueOriginalJobIds = Array.from(new Set(originalJobIds));
  
  for (const originalJobId of uniqueOriginalJobIds) {
    // ... 现有注册逻辑
  }
  
  // 检测空容器：找出jobInfoToProcess中没有被分配到batch的job
  const assignedJobIds = uniqueOriginalJobIds;
  const emptyJobIds = originalJobInfo
    .map(info => info.jobId)
    .filter(jobId => !assignedJobIds.includes(jobId));
  
  // 为每个空容器发送空结果
  if (emptyJobIds.length > 0 && services.resultSender) {
    logger.info(
      {
        emptyJobIds,
        assignedJobIds,
        totalJobInfoCount: originalJobInfo.length,
        reason: 'Empty containers detected, will send empty results for acknowledgment',
      },
      'runAsrStep: Empty containers detected'
    );
    
    for (const emptyJobId of emptyJobIds) {
      const emptyJobInfo = originalJobInfo.find(info => info.jobId === emptyJobId);
      if (emptyJobInfo) {
        // 创建空job消息
        const emptyJob: JobAssignMessage = {
          ...job,
          job_id: emptyJobInfo.jobId,
          utterance_index: emptyJobInfo.utteranceIndex,
        };
        
        // 创建空结果
        const emptyResult: JobResult = {
          text_asr: '',
          text_translated: '',
          tts_audio: '',
          should_send: true,
          extra: {
            reason: 'NO_TEXT_ASSIGNED',
          },
        };
        
        // 发送空结果
        const startTime = Date.now();
        services.resultSender.sendJobResult(
          emptyJob,
          emptyResult,
          startTime,
          true,
          'NO_TEXT_ASSIGNED'
        );
        
        logger.info(
          {
            emptyJobId: emptyJobInfo.jobId,
            utteranceIndex: emptyJobInfo.utteranceIndex,
            sessionId: job.session_id,
            reason: 'Empty container detected, sent empty result for acknowledgment',
          },
          'runAsrStep: Sent empty result for empty container job'
        );
      }
    }
  }
}
```

---

### 步骤2：确保ResultSender支持空结果发送

**文件**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`

**检查**：当前代码第76-89行已经处理了空结果，但需要确保 `reason = "NO_TEXT_ASSIGNED"` 时也能发送。

**修改**：
```typescript
// 检查是否是"核销"情况：所有结果都归并到其他job
const isConsolidated = (finalResult.extra as any)?.is_consolidated === true;
const reason = (finalResult.extra as any)?.reason;
const isNoTextAssigned = reason === 'NO_TEXT_ASSIGNED';

// 决策：移除空结果保活机制 - 只在有实际结果时发送
// 例外1：如果是"核销"情况（所有结果都归并到其他job），发送空结果核销当前job
// 例外2：如果是"NO_TEXT_ASSIGNED"（空容器核销），发送空结果核销当前job
if (isEmpty && !isConsolidated && !isNoTextAssigned) {
  logger.info(
    { 
      jobId: job.job_id, 
      traceId: job.trace_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      reason: 'ASR result is empty, not sending job_result (audio may be cached for streaming merge)',
    },
    'NodeAgent: ASR result is empty, skipping job_result send (will send when actual result is ready)'
  );
  return;
}
```

---

## 测试验证

### 测试场景

1. **35秒长语音，4个job，最后一个job为空**
   - 输入：job0, job1, job2, job3（job3很短，没有分配到batch）
   - 期望：job0, job1, job2有结果，job3收到空结果核销

2. **多个空容器**
   - 输入：job0, job1, job2, job3, job4（job2和job4为空）
   - 期望：job2和job4都收到空结果核销

---

## 相关文档

- `LONG_UTTERANCE_CURRENT_VS_DESIGN_GAP.md` - 设计差异分析
- `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` - 容器策略
- `REMAINING_IMPLEMENTATION_TASKS.md` - 剩余任务清单
