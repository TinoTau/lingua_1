# 剩余实现任务清单

根据 `LONG_UTTERANCE_CURRENT_VS_DESIGN_GAP.md` 分析，以下是还需要实现的内容：

---

## 1. 节点端：空容器Job的空结果核销 ⚠️ **未实现**

### 问题描述

在长语音容器分配时，可能出现：
- jobN 容器 **没有被分配到任何 batch**（例如：最后一个 job 很短 < 1s）
- 当前逻辑下：
  - Dispatcher 不会注册该 job（因为 container 为空）
  - ASR Step 永远不会触发回调
  - ResultSender 不会发送结果
  - 调度会一直等待（直到 timeout）

### 需要实现

**位置**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

**实现步骤**：

1. **在容器分配后检测空容器**
   - 在 `runAsrStep` 中，当 `originalJobIds.length > 0` 时
   - 检查 `jobInfoToProcess` 中的所有 job
   - 找出没有被分配到任何 batch 的 job（即 `originalJobIds` 中不包含该 jobId）

2. **为每个空容器发送空结果**
   ```typescript
   // 找出所有jobInfo中的jobId
   const allJobIds = jobInfoToProcess.map(info => info.jobId);
   const assignedJobIds = Array.from(new Set(originalJobIds));
   const emptyJobIds = allJobIds.filter(jobId => !assignedJobIds.includes(jobId));
   
   // 为每个空容器发送空结果
   for (const emptyJobId of emptyJobIds) {
     const emptyJobInfo = jobInfoToProcess.find(info => info.jobId === emptyJobId);
     if (emptyJobInfo) {
       await sendEmptyResult(emptyJobInfo, services);
     }
   }
   ```

3. **实现 sendEmptyResult 方法**
   - 在 `ResultSender` 中新增 `sendEmptyResult` 方法
   - 发送格式：
     ```json
     {
       "job_id": "job3",
       "utterance_index": 3,
       "is_final": true,
       "text_asr": "",
       "text_translated": "",
       "tts_audio": "",
       "reason": "NO_TEXT_ASSIGNED"
     }
     ```

### 代码位置

- **检测空容器**：`asr-step.ts` 第95-247行（在注册OriginalJob之后）
- **发送空结果**：`node-agent-result-sender.ts` 新增 `sendEmptyResult` 方法

---

## 2. 调度端：expectedDurationMs计算和传递 ⚠️ **未实现**

### 问题描述

当前节点端已经有读取 `expected_duration_ms` 的逻辑：
```typescript
const expectedDurationMs = (job as any).expected_duration_ms || 
  Math.ceil(currentDurationMs * 1.2);
```

但调度端还没有计算和传递这个字段。

### 需要实现

**位置**：`central_server/scheduler/src/`

**实现步骤**：

1. **在Job创建时计算expectedDurationMs**
   - 位置：`core/dispatcher/job_creation/` 或 `websocket/job_creator.rs`
   - 计算逻辑：
     ```rust
     let expected_duration_ms = calculate_expected_duration(&job.audio_data, sample_rate);
     // 或者基于音频时长估算
     ```

2. **在JobAssignMessage中添加字段**
   - 位置：`messages/node.rs` 或 `websocket/mod.rs`
   - 添加字段：
     ```rust
     #[serde(skip_serializing_if = "Option::is_none")]
     expected_duration_ms: Option<u64>,
     ```

3. **在创建JobAssign消息时传递**
   - 位置：`websocket/mod.rs:create_job_assign_message`
   - 添加：
     ```rust
     expected_duration_ms: job.expected_duration_ms,
     ```

### 代码位置

- **Job结构**：`core/dispatcher/job.rs`
- **JobAssign消息**：`messages/node.rs`
- **消息创建**：`websocket/mod.rs:create_job_assign_message`

---

## 3. 调度端：空核销结果的支持 ⚠️ **未实现**

### 问题描述

当前调度逻辑没有：
- per-job 动态 timeout
- 对 `NO_TEXT_ASSIGNED` 的处理分支
- 空核销视为"正常完成"的逻辑

### 需要实现

**位置**：`central_server/scheduler/src/websocket/node_handler/message/job_result/`

**实现步骤**：

1. **在JobResultMessage中添加reason字段**
   - 位置：`messages/node.rs` 或相关消息定义
   - 添加：
     ```rust
     #[serde(skip_serializing_if = "Option::is_none")]
     reason: Option<String>,
     ```

2. **处理空核销结果**
   - 位置：`job_result/job_result_creation.rs` 或 `job_result_sending.rs`
   - 添加逻辑：
     ```rust
     if let Some(reason) = &result.reason {
         if reason == "NO_TEXT_ASSIGNED" {
             // 空核销视为正常完成
             job.status = JobStatus::CompletedNoText;
             return Ok(());
         }
     }
     ```

3. **动态timeout（可选）**
   - 基于 `expectedDurationMs` 计算timeout
   - 位置：`core/dispatcher/` 或相关timeout处理逻辑
   - 计算：
     ```rust
     let timeout = base_timeout + (expected_duration_ms as f64 * timeout_factor);
     ```

### 代码位置

- **JobResult处理**：`websocket/node_handler/message/job_result/`
- **Job状态管理**：`core/dispatcher/job.rs`

---

## 4. 已实现的部分 ✅

### 4.1 容器分配算法 ✅
- 已实现 `assignBatchesToContainers`
- 已实现 `buildContainers`
- 已实现基于 `expectedDurationMs` 的容器装满判定

### 4.2 Dispatcher机制 ✅
- 已实现 `OriginalJobResultDispatcher`
- 已实现 `expectedSegmentCount` 计算
- 已实现batch累积和触发处理

### 4.3 utteranceIndex修复 ✅
- 已实现使用原始job的 `utteranceIndex`
- 已实现 `originalJobInfo` 传递

### 4.4 独立utterance处理 ✅
- 已实现手动发送和pause finalize的独立处理
- 已实现不合并pendingSmallSegments
- 已实现不缓存剩余片段

---

## 5. 实现优先级

### 优先级1：空容器Job的空结果核销（节点端）
- **影响**：调度会一直等待空容器job，导致超时
- **难度**：中等
- **工作量**：2-3小时

### 优先级2：调度端expectedDurationMs计算和传递
- **影响**：容器分配算法无法准确判断容器是否装满
- **难度**：中等
- **工作量**：2-3小时

### 优先级3：调度端空核销结果的支持
- **影响**：空核销结果可能被误判为错误
- **难度**：低
- **工作量**：1-2小时

---

## 6. 实现检查清单

### 节点端

- [ ] 在 `asr-step.ts` 中检测空容器
- [ ] 在 `ResultSender` 中实现 `sendEmptyResult` 方法
- [ ] 确保 `utterance_index` 使用原始job的index
- [ ] 确保 `reason = "NO_TEXT_ASSIGNED"`

### 调度端

- [ ] 在Job创建时计算 `expectedDurationMs`
- [ ] 在 `JobAssignMessage` 中添加 `expected_duration_ms` 字段
- [ ] 在创建JobAssign消息时传递 `expected_duration_ms`
- [ ] 在 `JobResultMessage` 中添加 `reason` 字段
- [ ] 处理 `NO_TEXT_ASSIGNED` 结果
- [ ] 将空核销视为正常完成（可选：动态timeout）

---

## 7. 相关文档

- `LONG_UTTERANCE_CURRENT_VS_DESIGN_GAP.md` - 当前实现vs设计差异
- `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` - 容器策略文档
- `LONG_UTTERANCE_35S_EXAMPLE_IMPLEMENTATION_GUIDE_FULL.md` - 完整实现指南
- `CURRENT_BUSINESS_LOGIC_ANALYSIS.md` - 当前业务逻辑分析
