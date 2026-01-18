# LONG_UTTERANCE_STREAMING_AND_SR_TRIGGER_SPEC
## 节点端长语音流式 ASR + 终点单次 SR 触发机制技术规范

版本：v1.0  
适用范围：节点端 AudioAggregator / ASRHandler / OriginalJobResultDispatcher / UtteranceState  
目标：在保证“流式 ASR + 完整语义修复”的同时，确保 utterance 生命周期安全、job 对齐一致性、并可靠触发最终 SR。

---

# 1. 背景与目标

本规范用于实现以下整体策略：

1. **ASR 流式执行（batch >5 秒立即识别）**  
2. **SR 在最终正常 finalize 时触发一次（不在批次或 job 层触发）**  
3. **job 对齐行为一致（头对齐，job3 可合并入 job2）**  
4. **utterance buffer 生命周期安全（调度保证 + 节点二次超时保护）**

这一机制既保留流式 ASR 以降低用户等待时间，也确保 SR/MNT/TTS 处理的文本完整、语义一致。

---

# 2. 系统整体流程

```
调度服务器（分 job）
 → 节点端 AudioAggregator（按能量切分批次）
   → ASR（>5s 批次立即识别）
     → OriginalJobResultDispatcher（按 job 对齐）
       → UtteranceState（累积所有 ASR 文本）
         → [等待正常 finalize]
           → SR（整句一次性语义修复）
             → NMT → TTS → Web
```

特性：

- ASR 是“批次级”流式；
- SR 是“utterance 级”一次性触发。

---

# 3. UtteranceState 数据结构规范

每个 utteranceId 对应一个状态对象：

```ts
interface UtteranceState {
  utteranceId: string;

  // job 对齐
  jobContainers: JobContainerState[];

  // 累积的 ASR 批次文本
  asrSegments: {
    batchIndex: number;
    jobIndex: number;  // 批次归属的 job
    text: string;
  }[];

  startedAt: number;
  lastActivityAt: number;

  isFinalized: boolean;
}
```

更新规则：

- 新批次到达 → 写入 `asrSegments`，更新 `lastActivityAt`
- 正常 finalize → `isFinalized = true`，触发 SR

---

# 4. 流式 ASR 执行机制

## 4.1 切分规则（AudioAggregator）

AudioAggregator 按如下策略切片：

- 能量切分优先；
- 每片最长 5–7 秒；
- 每当产生一片 ≥5 秒音频，立即送入 ASR。

## 4.2 ASRHandler 行为

ASRHandler 不做任何语义修复，只负责：

```ts
utteranceState.asrSegments.push({
  batchIndex,
  jobIndex,
  text: asrText,
});
```

可选：  
将 ASR 文本（未修复）作为“预览”推送给 Web。

---

# 5. Job 对齐规则（头对齐 + job3 合并入 job2）

## 5.1 批次归属 jobIndex

按照“头对齐”原则：

- 批次起点落在 job0 → 归 job0  
- 批次起点落在 job1 → 归 job1  
- 落在 job2 → 归 job2  
- job3 若无批次起点落入 → 合并入 job2

## 5.2 job 容器数 ≤ job 数

utterance 对外总是：

- job0: 合并文本 A  
- job1: 合并文本 B  
- job2: 合并文本 C（含 job3 内容）  
- job3: 若无独立文本 → 不输出  

---

# 6. SR 触发机制（一次性）

## 6.1 触发条件

仅当收到：

- 手动 finalize  
- pause finalize  
- 调度正常 finalize  

才触发 SR。

## 6.2 SR 输入文本构造

```ts
const fullText = concatenateAll(utteranceState.asrSegments);
callSemanticRepair(fullText);
```

特性：

- SR 仅执行一次；
- SR 输入永远为“整句长语音”；
- job 容器用于 UI 与对齐，不影响 SR 的输入。

---

# 7. Utterance buffer 生命周期管理

## 7.1 调度服务器保证 finalize 必达

调度端机制：

- timeout finalize 会锁定 job → 节点映射  
- 后续 job（包括正常 finalize）必定发送至同一节点  
- 因此：节点端必然收到最终 finalize

## 7.2 节点端二次安全超时（20 秒）

为了防止异常掉线导致的内存泄漏：

```
utteranceBufferTimeout = 调度 timeout 的 2 倍（建议 20 秒）
```

若超过 `lastActivityAt + 20 秒` 无 finalize：

- 清理 utteranceState  
- 打日志，但不触发 SR

此超时仅作为容灾，正常流程不应触发。

---

# 8. pendingTimeoutAudio / pendingPauseAudio 合并场景

若当前批次来源于 pending 缓冲：

- `pendingTimeoutAudio`  
- `pendingPauseAudio`  

则 AudioAggregator：

- 启动 Hotfix：**禁用流式切分**  
- 整段音频一次性发 ASR  
- 结果仍进入 utterance 缓冲  
- 等正常 finalize 后仍执行一次 SR

此逻辑不影响正常 streaming 长语音。

---

# 9. Definition of Done

实现完成需同时满足：

1. ASR 流式执行（>5s 批次立即识别）  
2. 所有 ASR 文本进入 utterance buffer  
3. SR 在“正常 finalize”时仅触发一次  
4. job 对齐正确（头对齐 + job3 合并 job2）  
5. utterance buffer 有 20 秒安全超时  
6. pending 合并场景按 Hotfix 走整段 ASR  
7. 正常长语音 streaming 行为保持不变  

---

如需，我可以继续提供：

- TypeScript 伪代码（可直接丢给开发）  
- 流程图（Mermaid / PNG）  
- Jest 单测模板  
