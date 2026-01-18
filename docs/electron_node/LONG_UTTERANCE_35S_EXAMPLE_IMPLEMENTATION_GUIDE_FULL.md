# LONG_UTTERANCE_35S_EXAMPLE_IMPLEMENTATION_GUIDE
## 35 秒长语音完整流程图 & 容器分配算法 & 代码改动指引（完整版）

版本：v1.1  
关联文档：`LONG_UTTERANCE_JOB_CONTAINER_POLICY.md`  

本文以一个 **35 秒长语音被拆成 4 个 Job、5 个 ASR 批次（batch）** 的场景为例，给出：

1. 端到端流程图（文字版时序图）  
2. 容器分配算法的详细伪代码  
3. 节点端 / 调度端需要改动的模块、函数职责与实现要点  
4. 建议的集成测试用例清单

设计目标：

- 保留流式 ASR 的优势（长语音不阻塞）  
- 让 Job 成为 **唯一对外可见的文本容器**，避免「batch 数量 = 文本数量」这种碎片化输出  
- 避免文本丢失 / 顺序错乱 / 重复发送  
- 保持实现逻辑尽量简单，利于排查与后续扩展

---

## 1. 35 秒长语音示例：端到端流程

### 1.1 场景假设

- 用户在 Web 端说了一句 **35 秒** 的长语音  
- VAD / 信令判断为一个 utterance（没有中途手动 send，但有结尾 pause）  
- 调度服务器配置 `MaxDuration ≈ 10s`，因此拆成 4 个 Job：  

  - job0：0–10s  
  - job1：10–20s  
  - job2：20–30s  
  - job3：30–35s（结尾短 job）  

- 所有 Job 分配到同一个 ASR 节点 nodeA  
- 节点端 AudioAggregator 依据能量和最长切片时长（例如 5–10s），切成 5 个 batch：

  - B0 = job0_1 + job0_2 = 6 秒  
  - B1 = job0_3 + job1_1 = 7 秒  
  - B2 = job1_2 + job1_3 = 7 秒  
  - B3 = job2_1 + job2_2 = 6 秒  
  - B4 = job2_3 + job2_4 + job3_1 = 9 秒  

- 期望最终对外输出 **3 段文本**（job0、job1、job2），job3 为纯技术 job，通过空结果核销。

---

### 1.2 文字版流程总览（模块视角）

```text
[Web 前端]
  - 采集 35s 语音流
  - 通过 WebSocket/HTTP 发送 PCM/Opus 数据 + 控制信令
  - 结束时发送 finalize（或由 VAD 自动判断结束）

        |
        v

[信令/VAD 层]
  - 将 35s 音频视为一个 utterance
  - 通知调度服务器: "utterance finalized"

        |
        v

[调度服务器 Scheduler]
  1) 根据 MaxDuration ~10s 拆分为 4 个 Job:
     - job0 (0–10s)
     - job1 (10–20s)
     - job2 (20–30s)
     - job3 (30–35s)

  2) 为每个 job 计算 expectedDurationMs:
     - job0: 10000ms
     - job1: 10000ms
     - job2: 10000ms
     - job3: 5000ms

  3) 按 routing 规则将 job0–job3 分配给 ASR 节点 nodeA

        |
        v

[节点 NodeA]

  [AudioAggregator]
    - 依次接收 job0–job3 的音频片段
    - 按能量/静音/最长切片时长切分为 5 个 batch:
        B0 = job0_1 + job0_2 = 6s
        B1 = job0_3 + job1_1 = 7s
        B2 = job1_2 + job1_3 = 7s
        B3 = job2_1 + job2_2 = 6s
        B4 = job2_3 + job2_4 + job3_1 = 9s
    - 每个 batch 记录:
        - batchId
        - startJobId / endJobId
        - durationMs
        - 原始时间戳

  [ASR Service]
    - 对 B0..B4 逐批进行识别，输出 batch 级文本

  [UtteranceContainerManager]
    - 根据 job0–job3 的 expectedDurationMs
    - 将 B0..B4 分配给 Job 容器:
        Container(job0) ← B0
        Container(job1) ← B1 + B2
        Container(job2) ← B3 + B4
        Container(job3) ← (empty)
    - 对每个非空容器:
        - 拼接其 batch 的 ASR 文本
        - 触发 SR/NMT/TTS 管线
    - 对空容器 job3:
        - 触发空结果核销

  [SR / NMT / TTS Pipeline]
    - job0 -> SR -> NMT -> TTS
    - job1 -> SR -> NMT -> TTS
    - job2 -> SR -> NMT -> TTS
    - job3 -> 不走文本管线，仅空核销

  [ResultSender]
    - 对 job0/job1/job2:
        - 发送一次最终结果 (is_final=true, text_asr != "")
    - 对 job3:
        - 发送一次空核销结果 (is_final=true, text_asr="")
```

---

### 1.3 时序简化图（Text Sequence Diagram）

```text
User                   Web                Scheduler                  NodeA
 |                      |                      |                        |
 | -- 35s speech -----> |                      |                        |
 |                      | -- finalize -------> |                        |
 |                      |                      |-- create job0 ------> |
 |                      |                      |-- create job1 ------> |
 |                      |                      |-- create job2 ------> |
 |                      |                      |-- create job3 ------> |
 |                      |                      |                        |
 |                      |                      |       [AudioAggregator 切片 B0..B4]
 |                      |                      |                        |
 |                      |                      |       B0 -----------> ASR
 |                      |                      |       B1 -----------> ASR
 |                      |                      |       B2 -----------> ASR
 |                      |                      |       B3 -----------> ASR
 |                      |                      |       B4 -----------> ASR
 |                      |                      |                        |
 |                      |                      |  [UtteranceContainerManager 分配容器]
 |                      |                      |    job0 ← B0
 |                      |                      |    job1 ← B1+B2
 |                      |                      |    job2 ← B3+B4
 |                      |                      |    job3 ← (empty)
 |                      |                      |                        |
 |                      |                      |  [对 job0/job1/job2 执行 SR/NMT/TTS]
 |                      |                      |                        |
 |                      |                      |  job0 result --------> |
 |                      | <----- job0 result --|                        |
 |                      |                      |  job1 result --------> |
 |                      | <----- job1 result --|                        |
 |                      |                      |  job2 result --------> |
 |                      | <----- job2 result --|                        |
 |                      |                      |  job3 empty ---------> |
 |                      | <----- job3 empty ---|                        |
 |                      |                      |                        |
```

---

## 2. 容器分配算法（详细伪代码）

### 2.1 数据结构

```ts
// ASR 批次（技术切片）
type AudioBatch = {
  id: string
  startJobId: string      // 首帧所属原始 job，例如 "job0"
  endJobId: string        // 尾帧所属原始 job，例如 "job1"
  durationMs: number      // 本批总时长
  // 其他字段（可选）：音频 buffer、起止时间戳等
}

// Job 容器（用户可见文本单位）
type JobContainer = {
  jobId: string           // 原始 jobId: "job0" | "job1" | ...
  expectedDurationMs: number  // 预估时长，用于判断容器是否“装满”
  batches: AudioBatch[]
  currentDurationMs: number   // 容器内已累积的时长
}
```

### 2.2 初始化容器

```ts
function buildContainers(jobIds: string[], expectedDurationsMs: number[]): JobContainer[] {
  const containers: JobContainer[] = []
  for (let i = 0; i < jobIds.length; i++) {
    containers.push({
      jobId: jobIds[i],
      expectedDurationMs: expectedDurationsMs[i],
      batches: [],
      currentDurationMs: 0
    })
  }
  return containers
}
```

### 2.3 Batch → 容器分配核心算法

目标：

- 从左到右扫描 batch（B0..Bn）  
- 按顺序依次填满 job0、job1、job2…  
- 最后一个容器允许超长或为空  

```ts
function assignBatchesToContainers(
  batches: AudioBatch[],
  containers: JobContainer[]
): JobContainer[] {
  let containerIndex = 0
  const maxContainerIndex = containers.length - 1

  for (const batch of batches) {
    // 安全防御：所有多出的 batch 都塞进最后一个容器
    if (containerIndex > maxContainerIndex) {
      const last = containers[maxContainerIndex]
      last.batches.push(batch)
      last.currentDurationMs += batch.durationMs
      continue
    }

    let container = containers[containerIndex]

    // 当前容器还没装满：继续累积
    if (container.currentDurationMs < container.expectedDurationMs) {
      container.batches.push(batch)
      container.currentDurationMs += batch.durationMs

      // 容器达到或超过预期：后续切到下一个容器
      if (container.currentDurationMs >= container.expectedDurationMs &&
          containerIndex < maxContainerIndex) {
        containerIndex += 1
      }

      continue
    }

    // 当前容器已经装满：切换到下一个容器
    if (containerIndex < maxContainerIndex) {
      containerIndex += 1
      container = containers[containerIndex]
      container.batches.push(batch)
      container.currentDurationMs += batch.durationMs
    } else {
      // 已是最后一个容器：全部放进来
      container.batches.push(batch)
      container.currentDurationMs += batch.durationMs
    }
  }

  return containers
}
```

### 2.4 容器完成后的处理逻辑

```ts
function onAllBatchesFinished(containers: JobContainer[]) {
  for (const container of containers) {
    if (container.batches.length === 0) {
      // 空容器：发送空结果核销
      sendEmptyResult(container.jobId)
      continue
    }

    // 非空容器：拼接 batch 文本
    const text = concatAsrTexts(container.batches)
    // 触发 SR/NMT/TTS 完整管线
    runSemanticRepairAndTranslateAndTts(container.jobId, text)
  }
}
```

`sendEmptyResult` 与 `runSemanticRepairAndTranslateAndTts` 的行为：

- 对每个 job 只能调用一次（唯一最终结果）  
- `sendEmptyResult` 用于“纯技术 job”核销  
- `runSemanticRepairAndTranslateAndTts` 内部最终通过 `ResultSender` 发出 job 最终结果

---

## 3. 节点端代码改动指引

以下模块和函数名称为建议，可根据实际项目结构调整。

### 3.1 AudioAggregator：新增 batch → 容器分配

**可能的文件：**

- `core/engine/audio/audio_aggregator.ts`
- 或 `core/engine/audio/audio_aggregator.rs`（如为 Rust）

**当前职责：**

- 接收来自调度的 job 音频片段（job0..job3）  
- 按能量、静音、最大切片时长等策略拆成批次（B0..Bn）  
- 将每个 batch 送入 ASR 服务

**需要新增/调整：**

1. 为每个 batch 补全元数据：  

   - `startJobId`：该 batch 首帧所属的 jobId  
   - `endJobId`：尾帧所属 jobId（可用于 debug）  
   - `durationMs`：累计时长  

2. 在 AudioAggregator 层维护当前 utterance 的 `pendingBatches: AudioBatch[]`，  
   - 按时间顺序保存 B0..Bn  
   - 当检测到 utterance 已结束（例如：  
     - 收到最后一个 job（job3）  
     - 或收到某种 `utterance_end` 信号）  
     → 触发容器构建和分配。

3. 新增调用：  

   ```ts
   const jobIds = ["job0", "job1", "job2", "job3"]
   const expectedDurationsMs = [10000, 10000, 10000, 5000] // 由调度传入

   const containers = buildContainers(jobIds, expectedDurationsMs)
   assignBatchesToContainers(pendingBatches, containers)

   utteranceContainerManager.handleContainers(containers)
   ```

---

### 3.2 UtteranceContainerManager：确保“一 job 一结果”

**建议新增文件：**

- `core/engine/utterance/utterance_container_manager.ts`

**职责：**

- 接收 `JobContainer[]`  
- 对每个容器决定：  
  - 是否拼接文本并走 SR/NMT/TTS  
  - 还是发送空结果核销  

**建议接口：**

```ts
class UtteranceContainerManager {
  handleContainers(containers: JobContainer[]) {
    for (const c of containers) {
      if (c.batches.length === 0) {
        ResultSender.sendEmptyResult(c.jobId)
      } else {
        const asrText = concatAsrTexts(c.batches)
        this.processWithPipeline(c.jobId, asrText)
      }
    }
  }

  private async processWithPipeline(jobId: string, asrText: string) {
    const repaired = await SemanticRepair.run(jobId, asrText)
    const translated = await Nmt.run(jobId, repaired)
    const ttsAudio = await Tts.run(jobId, translated)
    ResultSender.sendFinalResult(jobId, repaired, translated, ttsAudio)
  }
}
```

**关键约束：**

- 对每个 jobId，只调用一次 `sendFinalResult` 或一次 `sendEmptyResult`  
- 不允许中间阶段发送占坑空结果  
- 不在这个模块处理 job 去重，只保证不产生重复发送

---

### 3.3 ASR Pipeline：保持批次 → 文本的简单映射

**可能文件：**

- `core/engine/asr/asr_handler.ts`
- `core/engine/asr/asr_service.ts`

**当前职责：**

- 接收 `AudioBatch`  
- 将音频传给 ASR 模型  
- 返回 batch 级别文本和置信度

**需要保证：**

- ASR 输出中携带 `batchId`，以便上层正确拼接  
- 不在 ASR 层做 job 级别合并和重映射  
- 只做“batch in → batch out”，内部无跨 batch 逻辑  

---

### 3.4 ResultSender：实现“最终结果 + 空核销”

**可能文件：**

- `core/engine/result/node_agent_result_sender.ts`

**需要接口：**

```ts
class ResultSender {
  static sendFinalResult(jobId: string, repaired: string, translated: string, ttsAudio: Buffer) {
    // 从上下文中取出原始 utterance_index
    const index = JobContext.getUtteranceIndex(jobId)

    const payload = {
      job_id: jobId,
      utterance_index: index,
      is_final: true,
      text_asr: repaired,
      text_translated: translated,
      tts_audio: encodeAudio(ttsAudio),
      reason: "OK"
    }

    sendToScheduler(payload)
  }

  static sendEmptyResult(jobId: string) {
    const index = JobContext.getUtteranceIndex(jobId)

    const payload = {
      job_id: jobId,
      utterance_index: index,
      is_final: true,
      text_asr: "",
      reason: "NO_TEXT_ASSIGNED"
    }

    sendToScheduler(payload)
  }
}
```

**注意：**

- 不允许在此模块中发送“非 final 的占坑结果”  
- `utterance_index` 必须是 **原始 job index**，不能被合并 job 污染  
- 如有 DedupStage，只需要对同一 jobId + is_final 做一次性去重即可，无需识别空/非空差异

---

## 4. 调度端代码改动指引

### 4.1 Job 创建：记录 expectedDurationMs

**可能文件：**

- `scheduler/job_factory.ts`
- `scheduler/job_creator.ts`

**当前：**

- 按 MaxDuration 拆分 utterance 为 job0..jobN  
- 每个 job 有 jobId / sessionId / createdAt 等字段

**需要新增：**

- 字段：`expectedDurationMs`，例如：  
  - 来自调度拆分逻辑中计算的“该 job 覆盖的时间段长度”  
  - 或以 MaxDuration 为基础给每个 job 附上默认值

**示例：**

```ts
function createJobsForUtterance(utteranceId: string, totalDurationMs: number): Job[] {
  const jobs: Job[] = []
  const maxJobMs = 10000
  let offset = 0
  let index = 0

  while (offset < totalDurationMs) {
    const remaining = totalDurationMs - offset
    const duration = Math.min(remaining, maxJobMs)

    jobs.push({
      jobId: `${utteranceId}_${index}`,
      sessionId: /* ... */,
      utteranceIndex: index,
      expectedDurationMs: duration,
      // ...
    })

    offset += duration
    index += 1
  }

  return jobs
}
```

---

### 4.2 动态 timeout：按 expectedDurationMs 设置 job_timeout_seconds

**可能文件：**

- `scheduler/job_timeout_manager.ts`
- `scheduler/job_monitor.ts`

**改动方式：**

```ts
function computeJobTimeoutSeconds(expectedDurationMs: number): number {
  const base = 10 // 基础时间
  const factor = 1.5 // 每秒音频给 1.5s 处理时间
  const minTimeout = 15
  const maxTimeout = 60

  const computed = base + (expectedDurationMs / 1000.0) * factor
  return Math.max(minTimeout, Math.min(maxTimeout, computed))
}
```

在创建 job 时：

```ts
job.timeoutSeconds = computeJobTimeoutSeconds(job.expectedDurationMs)
```

---

### 4.3 处理空核销结果

**可能文件：**

- `scheduler/job_result_handler.ts`
- `scheduler/job_completion_service.ts`

**新增逻辑：**

```ts
function onJobResultReceived(result: JobResultPayload) {
  const job = getJobById(result.job_id)
  if (!job) return

  if (job.isCompleted) {
    // 已完成的 job，丢弃重复结果（防御）
    return
  }

  if (result.is_final) {
    // 最终结果（包含空核销）
    job.isCompleted = true
    job.completedAt = now()

    if (result.text_asr === "" && result.reason === "NO_TEXT_ASSIGNED") {
      // 空核销：标记为正常结束，但无文本
      job.status = "COMPLETED_NO_TEXT"
      // 不计入错误统计
    } else {
      job.status = "COMPLETED_OK"
      // 正常下发给 Web
      forwardResultToWeb(result)
    }

    return
  }

  // 如不再接受非 final 结果，可直接忽略或仅保留日志
}
```

---

## 5. 建议集成测试用例

### 5.1 用例 1：35 秒长语音 / 5 batch / 4 job

- 输入：  
  - 35 秒连续语音，无中途手动 send  
  - `MaxDuration ≈ 10s` → job0..job3  
  - 节点切出 B0..B4  

- 期望：  
  - 容器分配：  
    - job0 ← B0  
    - job1 ← B1+B2  
    - job2 ← B3+B4  
    - job3 ← 空核销  
  - Web 看到 3 段翻译（index=0/1/2），job3 不显示  

### 5.2 用例 2：中间 pause 截断

- 输入：  
  - 用户说话 20 秒，pause 3 秒，再说 10 秒  
- 期望：  
  - 调度将前半部分和后半部分拆成不同 utterance 或 job 组  
  - 每个 utterance 独立进入容器算法  
  - 段落划分与用户 pause 一致  

### 5.3 用例 3：极短结尾（jobN < 1 秒）

- 输入：  
  - 结尾仅有很短的尾巴（如 500ms）  
- 期望：  
  - 该 job 容器为空或仅含无效音频  
  - 节点返回空核销  
  - 调度不计入超时，Web 不显示该 job  

### 5.4 用例 4：高并发多个 Session

- 输入：  
  - 同时有 10–50 个 session 触发长语音  
- 期望：  
  - 每个 session 的 batch → job 容器隔离良好  
  - timeout 计算合理，无集体超时  
  - 日志中可追踪每个 job 的容器分配情况  

---

## 6. 总结（可直接读给开发/架构的版本）

> 在 35 秒长语音场景下，我们通过在节点端 AudioAggregator 之后增加“batch → job 容器分配”和 UtteranceContainerManager，
> 让最终对外只按 job0–jobN 输出有限数量的文本段，而不是按照 ASR 批次数量输出碎片化文本。
> 每个 job 容器只发送一次最终结果；最后一个仅用于技术拆分的 job（例如 job3），通过空结果核销，不会被计入超时。
> 调度端只需为每个 job 记录预计时长并按时长动态设置 timeout，同时接受空核销作为正常完成。
> 这样，在不引入复杂状态机的前提下，既保证了长语音流式处理的用户体验，又简化了错误路径和排查成本。
