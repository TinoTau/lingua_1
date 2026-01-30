# Job 7 译文合并长句 & Job 8 原文含下一句开头（2026-01-29）

## 1. 现象

- **Job 7**：译文明显是多个 job 的合并长句（与 [8][9][10] 之前的问题同类）。
- **Job 8**：原文里包含了「下一句话的开头」；用户在这两句话之间做了**手动发送**截断，期望不应被拼到同一个 job。

## 2. Job 7 长译文：根因与修复

### 2.1 根因

TextForwardMergeManager 有一条分支：**有 pending、但当前 job 没有 currentText**（仅 flush 待合并的上一段）时，直接返回 `processedText: pending.text`，**没有带 `segmentForCurrentJob`**。

下游 aggregation-stage 里：  
`segmentForJobResult = forwardMergeResult.segmentForCurrentJob ?? textAfterDeduplication`  
这里 `segmentForCurrentJob` 为 undefined，就退化成 `textAfterDeduplication`（整段合并文），导致本 job 的「译本段」仍用整段 → Job 7 出现长译文。

### 2.2 修复（仅补字段，无新逻辑）

在 **text-forward-merge-manager.ts** 中，上述「仅 flush pending、无 currentText」的 return 里补上：

- **segmentForCurrentJob: ''**

表示本 job 没有当前文本，只负责把 pending 发走；译本段应用空，不再误用整段。  
这样 `segmentForJobResult` 不会被 undefined 顶掉，不会再用整段做 NMT 输入。

---

## 3. Job 8 原文含下一句开头：边界问题（非本次「译本段」逻辑）

### 3.1 现象含义

- 用户在两句话之间点了**手动发送**，期望：上一句一个 job，下一句另一个 job。
- 实际：Job 8 的**原文**里既有上一句尾（如「否则我们」），又有下一句头（如「还需要继续分析……」），说明**这一条 job 对应的音频/文本边界**把两句话拼在一起了。

也就是说，问题出在「**哪段音频/文本属于哪个 job**」，而不是「用哪段去翻译」。

### 3.2 可能原因（节点视角）

- **Aggregator 层**：`aggregator-decision` 里对 `isManualCut` 已强制 **NEW_STREAM**，不会把「上一句」和「当前句」在**聚合层**再合并成一条流。  
  因此，若 Job 8 的**输入**（ASR 结果 / 音频）里已经带上了下一句开头，更可能是：
  - 该 job 对应的**音频**在进入节点前就包含了「上一句尾 + 下一句头」，或
  - **调度/Web** 在「手动发送」时没有在正确时刻切分 buffer，导致下一个 job 仍带上了上一句末尾的音频/文本。

即：**手动发送的截断点**没有在「音频/会话边界」上生效，导致 Job 8 的「原始输入」就包含了两句内容。

### 3.3 建议排查方向（不改节点译本段逻辑）

1. **Web / 调度侧**  
   - 手动发送时：当前 buffer 是否在**点击瞬间**就 finalize 并对应一个 job？  
   - 下一个 job 的音频是否**严格从「下一句」开始**，没有带上上一句尾？

2. **节点侧（仅作确认）**  
   - 看该 session 下 Job 7 / Job 8 的 **is_manual_cut** 是否按预期传到节点（日志里是否有 `manual cut` / `NEW_STREAM (manual cut)`）。  
   - 看 Job 8 的 **ASR 输入**（音频或已有 ASR 结果）是否已经包含下一句开头；若已包含，则边界在更上游（音频聚合 / 发送策略）。

结论：**Job 8 原文含下一句开头，是「job 边界 / 音频切分」问题，不是本次「用 segmentForJobResult 做译本段」的调整导致的**；本次只补了 segmentForCurrentJob 缺字段，避免 Job 7 这类长译文。

---

## 4. 小结

| 问题 | 类型 | 处理 |
|------|------|------|
| Job 7 译文为合并长句 | 缺字段导致误用整段做 NMT 输入 | 在「仅 flush pending、无 currentText」的 return 中补 **segmentForCurrentJob: ''**（仅补字段，无新逻辑） |
| Job 8 原文含下一句开头 | 手动发送后 job 边界/音频切分 | 属上游边界与手动发送策略，需查 Web/调度与音频聚合；节点侧 isManualCut 已强制 NEW_STREAM，未见额外合并逻辑 |
