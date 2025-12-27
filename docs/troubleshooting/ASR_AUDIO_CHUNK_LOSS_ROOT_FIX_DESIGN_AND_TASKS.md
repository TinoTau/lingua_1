
# ASR 音频 Chunk 丢失根因修复方案（Root Fix）
## 技术设计文档 + Task List（可直接交付开发）

> 适用范围：Scheduler / Session Actor / Translation Pipeline  
> 前提：项目未上线，无兼容性包袱，可直接重构关键路径

---

## 一、问题是否已被充分说明？结论：是的

结合以下文件：
- AUDIO_CHUNK_LOSS_ISSUE_REPORT.md
- TRANSLATION_PIPELINE_ISSUES.md
- actor.rs（Session Actor 实现）
- scheduler.log（运行期证据）

可以明确确认：

**问题不是 ASR 模型精度问题，而是调度侧的“音频生命周期与 finalize 时序错误”**，导致：
1. 半句话未被纳入任何 ASR job（chunk 丢失）
2. utterance_index 跳号（空 finalize）
3. 最后一句话需要“再说一句”才能 flush 出来

这些症状在日志中已被完整观测到。

---

## 二、根因总结（工程视角）

### 根因 1：Finalize 发生在 add_chunk 之前（顺序错误）

当前逻辑（简化）：
```
if pause_exceeded || max_duration {
    try_finalize();
}
add_chunk(chunk);
```

后果：
- chunk 到达时，utterance 已被 finalize
- 该 chunk 被错误分配到新的 utterance
- 或因短音频逻辑而被永久挂起

---

### 根因 2：空缓冲仍 finalize（index 前移但不建 job）

现有行为：
- audio_buffer 为空
- 仍返回 finalized=true
- utterance_index += 1
- 但没有创建 ASR job

直接导致：
- utterance_index 不连续
- job / result 不对齐

---

### 根因 3：Short-merge pending 在 finalize 时未被强制收敛

- < short_merge_threshold 的片段进入 pending
- pause / is_final 触发时，pending 可能未被合并
- 造成“短句永远不被识别”

---

### 根因 4：Session 结束缺乏强制 flush

- 最后一段语音没有 pause 触发
- 没有 is_final 或显式 flush
- 用户体验表现为：
  > “必须再说一句，上一句才出来”

---

## 三、推荐的根治方案（Root Fix）

### Fix-A（必须）：音频处理顺序重构（先入缓冲，后判断）

**新的处理原则**：

> 任何到达的音频 chunk，必须先进入当前 utterance 的缓冲，
> 然后才允许触发 finalize。

推荐流程：
```
add_chunk(current_utterance, chunk)
update_duration_and_pause_state()

if should_finalize {
    try_finalize(current_utterance)
}
```

---

### Fix-B（必须）：空缓冲不得 finalize（不递增 index）

规则：
- audio_buffer 为空 → try_finalize 返回 false
- utterance_index 仅在 job 创建成功后前移

---

### Fix-C（必须）：Short-merge pending 在 finalize 时强制合并

- pause / max_duration / is_final 触发 finalize 时
- 若存在 pending short chunks → 先合并，再 finalize

---

### Fix-D（强烈建议）：Session 结束时强制 flush_finalize

触发：
- session close / stop / leave

行为：
- buffer 非空 → 创建 job
- buffer 为空 → flush_noop（不前移 index）

---

### Fix-E（工程稳态）：Finalize + Buffer 原子语义

- in-memory buffer 或 take API
- 禁止“读完再删”的竞态窗口

---

## 四、Task List（JIRA）

### EPIC: ASR-AUDIO-ROOT-FIX

#### P0（阻断项）

| ID | Task | 说明 |
|---|---|---|
| RF-1 | 重构 chunk 处理顺序 | add_chunk → finalize |
| RF-2 | 禁止空缓冲 finalize | index 前移需 job |
| RF-3 | finalize 合并 short pending | 不丢短句 |
| RF-4 | session 结束强制 flush | 修复最后一句 |
| RF-5 | buffer/finalize 原子性 | take 或 in-mem |
| RF-6 | 指标与报警 | index_gap / empty_finalize |
| RF-7 | 边界回归测试 | pause / 最后一段 |

---

## 五、验收标准

1. utterance_index 连续
2. job_created == finalized_non_empty
3. 最后一句 ≤ 1 RTT 返回
4. 无 short pending 悬挂
5. 日志中无 empty finalize

---

## 六、结论

这是一次**根因级修复**，非补丁。
在未上线前强烈建议一次性完成。
