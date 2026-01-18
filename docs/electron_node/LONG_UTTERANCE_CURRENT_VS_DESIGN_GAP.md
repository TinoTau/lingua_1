# LONG_UTTERANCE_CURRENT_VS_DESIGN_GAP
## 当前实现 vs 最终设计规范差异分析（可交付开发部门）

版本：v1.0  
关联文档：  
- `CURRENT_BUSINESS_LOGIC_ANALYSIS.md`  
- `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md`  
- `LONG_UTTERANCE_35S_EXAMPLE_IMPLEMENTATION_GUIDE_FULL.md`  

本文用于明确：  
1. 当前 ASR/调度长语音处理链路中，哪些逻辑 **已经符合设计**  
2. 哪些部分 **仍未实现或存在偏差**  
3. 开发需要补齐哪些模块  
4. 不允许再实现哪些错误路径（避免回到 618/619 问题）

旨在让开发能够对照改动，快速补齐最终规范。

---

# 1. 已经符合最终设计的部分

## 1.1 Job = 文本容器（已实现）
当前业务逻辑已经做到：  
- **每个原始 job 只会生成一次最终文本结果**（或被动等待）  
- 不会因为 batch 数量而产生多个文本结果  
- ASR Step 使用 Dispatcher 以 job 为单位聚合 batch → 触发 pipeline

这完全符合最终设计目标：  
> “Batch 是技术切片；Job 是用户可见的唯一文本容器。”

---

## 1.2 Batch = 技术切片（已实现）
当前 AudioAggregator：  
- 只负责切 batch，不产生文本结果  
- batch 只在 ASR 内部使用  
- 不向前端暴露 batch 级别输出  

符合最终设计：  
> “Batch 不产生对外结果，只作为容器算法输入。”

---

## 1.3 长语音的“多 Job 汇总为容器组”机制（已实现）
当前节点逻辑中：  
- 超时 Job 的音频会合并到下一次 job（或用户 finalize）  
- 将多个 job 的音频合并后交由 AudioAggregator 切 batch  
- 在 ASR Step 根据 job 顺序做 Dispatcher 累积  
- 每个 job 只触发一次 pipeline

与最终设计完全一致：  
> “多个 job 的 batch 会按时间段分配给 job 容器，容器完成后才触发 SR/NMT/TTS。”

---

## 1.4 Dispatcher 机制正确（已实现）
Dispatcher 在当前实现中正好实现了设计要求：  
- `expectedSegmentCount = 属于该 job 的 batch 数量`  
- 收到全部 batch 的 ASR 文本后才触发回调  
- 确保“一 job → 一次 pipeline”

符合规范：  
> “Batch 数量不决定文本数；Job 决定文本数。”

---

# 2. 未实现 / 需要补齐的部分（核心差异）

以下两点必须补齐，流程才算「完全符合设计」。

---

## 2.1 缺失：纯技术 Job 的“空结果核销”
### 问题
在长语音容器分配时，可能出现：

- jobN 容器 **没有被分配到任何 batch**（例如：最后一个 job 很短 < 1s）  
- 当前逻辑下：  
  - Dispatcher 不会注册该 job（因为 container 为空）  
  - ASR Step 永远不会触发回调  
  - ResultSender 不会发送结果  
  - 调度会一直等待（直到 timeout）

### 最终设计要求
对于空容器：

```json
{
  "job_id": "job3",
  "utterance_index": 3,
  "is_final": true,
  "text_asr": "",
  "reason": "NO_TEXT_ASSIGNED"
}
```

### 需要开发补齐：
在节点端新增：

- 在容器分配结束后：  
  - 若某个 job 容器 `batches.length == 0`  
  - **立即调用 ResultSender.sendEmptyResult(jobId)**  
  - 不再等待 Dispatcher  

这一点是当前缺失的最大差距。

---

## 2.2 缺失：调度端对“空核销结果”的支持
当前调度逻辑没有看到：

- per-job 动态 timeout  
- 对 `NO_TEXT_ASSIGNED` 的处理分支  
- 空核销视为“正常完成”的逻辑

### 设计要求：
调度端需要：

1. **支持按 expectedDurationMs 动态 timeout**  
2. **空核销视为正常完成，不计入错误，不等待 ASR**  
3. job 完成时必须调用：

```ts
job.status = COMPLETED_NO_TEXT
```

否则调度会出现：  
- 长语音拆出额外 job → 超时 → 误判错误

这是第二大缺口。

---

# 3. 需要禁止的错误路径（避免回到 618/619 问题）

必须禁止以下行为：

## 3.1 禁止“占坑空结果”
占坑空结果是导致之前“意外 finalize”问题的重要原因：

```json
{ is_final: false, text_asr: "" }
```

此类结果必须禁止发送。

---

## 3.2 禁止“多次对同一 job 发送结果”
无论是空结果还是文本结果：

- 对同一个 job  
- 永远只能发一次结果（final）

---

## 3.3 禁止跨 Job 传播 batch 结果
调度层 Job 容器是顺序容器：

- 只允许容器前向合并  
- 禁止出现：  
  - “job1 的文本放入 job0”  
  - “job0 的 batch 放入 job2”

当前实现无此问题，需要保持。

---

# 4. 节点端需要补齐的代码点

## 4.1 AudioAggregator
需确认：

- batch 元数据包含 `startJobId`、`durationMs`  
- 能标记超时聚合后的大音频  

无需复杂改动。

---

## 4.2 UtteranceContainerManager（建议新增）
需要新增：

- `handleContainers(containers)`  
- 遍历容器：  
  - 有 batch → 走 pipeline  
  - 无 batch → sendEmptyResult  

这是当前缺失的关键模块。

---

## 4.3 ResultSender
新增：

```ts
sendEmptyResult(jobId)
```

必须保证：  
- utterance_index 为原 job index  
- reason = "NO_TEXT_ASSIGNED"

---

# 5. 调度端需要补齐的代码点

## 5.1 Job 创建：expectedDurationMs
确保调度把「每个 job 的预计时长」传到节点。

---

## 5.2 动态 timeout
基于 expectedDurationMs：

```ts
timeout = base + duration * factor
```

---

## 5.3 空核销处理
新增：

```ts
if (result.reason == "NO_TEXT_ASSIGNED") {
    job.status = COMPLETED_NO_TEXT
    return
}
```

---

# 6. 完整总结（可读给开发的版本）

> 当前 ASR/节点的大部分行为（尤其是多 batch → Job 容器、Dispatcher、Pipeline）已经完全符合我们设计文档的方向，没有跑偏。
>
> 但要达到“最终规范”，目前仍必须补齐两项能力：
>
> 1）节点端：对空容器 Job 发送空结果核销；  
> 2）调度端：支持空核销语义与动态 timeout。
>
> 完成这两项后，整个长语音处理链路才算完全闭环、可控、可扩展，并且不会再次出现 618/619 类 bug。

