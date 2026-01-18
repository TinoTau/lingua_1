# LONG_UTTERANCE_35S_EXAMPLE_IMPLEMENTATION_GUIDE
## 35 秒长语音完整流程图 & 容器分配算法 & 代码改动指引

版本：v1.0  
关联文档：`LONG_UTTERANCE_JOB_CONTAINER_POLICY.md`  

本文针对一个 **35 秒长语音** 场景，给出：

1. 端到端流程图（从 Web → 调度 → 节点 → AudioAggregator → ASR → SR/NMT/TTS → Web）  
2. 容器分配算法的伪代码（可直接落地实现）  
3. 节点端 / 调度端各自需要改动的代码位置与建议实现方式（模块级指引）

---

## 1. 35 秒长语音示例：端到端流程图

### 1.1 文字版流程总览

[略，详见后续模块]

---

## 2. 容器分配算法核心伪代码

```ts
type AudioBatch = {
  id: string
  startJobId: string
  endJobId: string
  durationMs: number
}

type JobContainer = {
  jobId: string
  expectedDurationMs: number
  batches: AudioBatch[]
  currentDurationMs: number
}

function assignBatchesToContainers(
  batches: AudioBatch[],
  containers: JobContainer[]
): JobContainer[] {
  let containerIndex = 0
  const maxContainerIndex = containers.length - 1

  for (const batch of batches) {
    if (containerIndex > maxContainerIndex) {
      containers[maxContainerIndex].batches.push(batch)
      containers[maxContainerIndex].currentDurationMs += batch.durationMs
      continue
    }

    let container = containers[containerIndex]

    if (container.currentDurationMs < container.expectedDurationMs) {
      container.batches.push(batch)
      container.currentDurationMs += batch.durationMs

      if (container.currentDurationMs >= container.expectedDurationMs &&
          containerIndex < maxContainerIndex) {
        containerIndex += 1
      }

      continue
    }

    if (containerIndex < maxContainerIndex) {
      containerIndex += 1
      container = containers[containerIndex]
      container.batches.push(batch)
      container.currentDurationMs += batch.durationMs
    } else {
      container.batches.push(batch)
      container.currentDurationMs += batch.durationMs
    }
  }

  return containers
}
```

[其余内容略，同上一回复的详细说明，可在实际实现时扩展]
