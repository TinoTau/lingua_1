# 决策部门审议 — Job2 前半句丢失与 turnId 合并方向（2026-01）

**文档用途**：供决策部门一次性审议「集成测试暴露的 Job2 前半句丢失、多 Job 空结果」问题，以及是否修订「取消跨 Job 前向合并」裁决、是否允许「调度附带 turnId、节点端合并」。  
**阅读时间**：约 5 分钟。详细技术依据见文末参考文档。

---

## 一、背景与现象

集成测试（长段语音稳定性）中出现：

| 现象 | 说明 |
|------|------|
| **界面仅显示 [0]、[2]** | 长段阅读后，仅两条有内容；中间及后续 segment 在界面上不可见。 |
| **Job 2 前半句丢失** | 预期整句「…在没有必要的时候**提前**结束本次识别」，实际只识别出「結束本次識別」6 字，前半句缺失。 |
| **多 Job 空结果** | Job 1、3–10 等向调度回报的 job_result 为 **isEmptyJob**（无文本、无 TTS），若前端只展示「有内容的」结果，则与现象一致。 |

**根因（已确认）**：  
- 节点端 **bufferKey = jobId**，每个 Job 使用独立 buffer。  
- Job 1 为 MaxDuration 触发：前约 4.3s 送 ASR，**剩余约 4.8s 缓存在 Job 1 的 buffer**（pendingMaxDurationAudio），并因「等下一 job 合并」向调度**发空结果**。  
- Job 2 到来时使用**新 job_id** 作 bufferKey，**无法访问 Job 1 的 buffer**，仅处理本 job 下发的约 1.5s 音频，故只识别出「結束本次識別」。  
- 即：**同一句话被拆成多 Job 后，前半段留在 Job 1 的 buffer 中既未发出也未并入 Job 2，导致丢失。**

---

## 二、当前架构裁决（已冻结）

《取消跨 Job 前向合并_推荐方案说明》已冻结，核心裁决为：

- **彻底取消节点端跨 Job 前向合并**；不允许「等下一 job 再合并」。
- **否决项**：节点端按 sessionId / turnId **回溯并合并上一 Job buffer**。
- **要求**：任何 finalize 都必须输出当前 Job 内「可得到的最好结果」；跨 Job 的语义拼接**上移至调度服务器 / Web 端**，由 **turnId + segmentIndex** 负责。

该裁决与当前「bufferKey = jobId、Job 最小单位」设计一致；但若**不**做任何调整，则「Job 2 前半句丢失」与「因等合并而产生的空结果」会持续存在，除非采用下述两条路线之一。

---

## 三、两条可选路线

### 路线 A：维持当前裁决（不在节点端做跨 Job 合并）

- **做法**：按《取消跨 Job 前向合并》落地——MaxDuration 时**不再**把剩余音频写入 pendingMaxDurationAudio 等下一 job，而是在**本 Job 内**把整段音频（含「剩余」）全部送 ASR 并输出一条结果；取消 `shouldWaitForMerge` 导致的空结果。
- **效果**：Job 2 前半句不再丢失（因为「前半句」已在 Job 1 内完整输出）；空结果仅剩合理情况（如 RMS 拒绝、无识别）。
- **合并发生位置**：仅在**调度/Web 端**，按 turnId + utterance_index 分组、排序、拼接展示。
- **若要在调度/Web 用 turnId 合并**：需让每个 job_result 能关联到 turn（例如 Job 存 turn_id，或 result 带 turn_id），再按 turn_id 分组、utterance_index 排序。与当前裁决无冲突。

**参考**：《取消跨job前向合并_技术确认与后果_2026_01.md》

---

### 路线 B：修订裁决，允许「调度附带 turnId、节点端合并」

- **做法**：  
  - **调度**：在 job_assign 中附带 **turn_id**（调度端已有 current_turn_id，写入协议并下发给节点）。  
  - **节点**：用 **turn_id** 作为同一 turn 内多 Job 的共用依据——例如 **bufferKey = turn_id**（无 turn_id 时退化为 job_id），使下一 Job 自然复用同一 buffer，自动续写上一 Job 的 pendingMaxDurationAudio；或显式按 turn_id 查找上一 Job 的 pending 并合并后送 ASR。
- **效果**：同一 turn 内多 Job 在节点端可连续续写/合并，Job 2 能拿到 Job 1 的 4.8s pending，前半句不再丢失；因「等合并」产生的空结果也可消除。
- **与当前裁决的关系**：上述行为属于「节点端按 turnId 合并/复用上一 Job 的 buffer 或 pending」，与当前裁决的**否决项**直接冲突，故需**先修订裁决**再实施。
- **修订建议**：将「节点端按 sessionId / turnId 回溯并合并上一 Job buffer」从否决项改为**允许项**，且**仅限**：turn_id 由调度在 job_assign 中提供；节点仅按 turn_id 在同一 turn 内合并/复用，不引入 session 级扫描、不跨 turn 合并。

**参考**：《用turnId进行合并_可行性说明_2026_01.md》

---

## 四、对比小结

| 维度 | 路线 A：维持裁决 | 路线 B：修订裁决，节点端按 turnId 合并 |
|------|------------------|----------------------------------------|
| **裁决** | 不修订，维持「彻底取消节点端跨 Job 前向合并」 | 修订：允许「调度附带 turn_id，节点仅按 turn_id 合并/复用」 |
| **节点端** | 每个 Job 在本 Job 内处理完所有音频并输出结果；不跨 Job 合并 | 同一 turn 内多 Job 共用 buffer 或按 turn_id 合并上一 Job pending |
| **合并发生处** | 仅调度/Web，按 turnId + utterance_index | 节点端同一 turn 内续写/合并 + 调度/Web 展示层 |
| **协议** | 可选：Job/result 带 turn_id 以便调度/Web 按 turn 分组 | JobAssign 增加 turn_id；节点按 turn_id 复用/合并 |
| **改动量** | 节点：取消 pending 等下一 job、本 Job 内处理完；调度/Web：按 turn 关联与拼接 | 调度：Job 与 JobAssign 带 turn_id；节点：bufferKey 或合并逻辑使用 turn_id |

---

## 五、待决事项（请决策部门勾选或批复）

1. **是否维持《取消跨 Job 前向合并》裁决不变？**  
   - 若 **是** → 采用**路线 A**：节点端取消跨 Job 前向合并，本 Job 内处理完并输出结果；合并仅在调度/Web 端按 turnId + utterance_index 做。  
   - 若 **否** → 采用**路线 B**：修订裁决，允许调度在 job_assign 中附带 turn_id、节点端按 turn_id 合并/复用；再实施协议与节点改动。

2. **若采用路线 A**：是否同意在 Job 或 job_result 上增加 turn_id（或等效手段），以便调度/Web 端「用 turnId 进行合并」展示？  
   - 若不增加，则调度/Web 端无法按 turn 分组，只能按 session/utterance_index 等现有字段拼接。

3. **若采用路线 B**：是否同意将修订范围限定为「仅允许按 turn_id 合并，且 turn_id 由调度在 job_assign 中提供」？  
   - 建议限定，避免引入 session 级扫描或节点端自主推断 turn。

---

## 六、参考文档（深入阅读）

| 文档 | 内容 |
|------|------|
| `集成测试_Job2前半句丢失与空结果_决策审议_2026_01.md` | 问题现象、因果链、各 Job 状态一览、可选方案简述。 |
| `取消跨job前向合并_推荐方案说明.md` | 当前已冻结的架构裁决与推荐方案。 |
| `取消跨job前向合并_技术确认与后果_2026_01.md` | 裁决事实确认、技术可行性、落地后后果与注意点。 |
| `用turnId进行合并_可行性说明_2026_01.md` | 三种「用 turnId 合并」含义、技术可行性、与裁决冲突、实施说明（含 bufferKey=turnId）。 |

---

**文档版本**：2026-01  
**状态**：待决策部门审议并批复第五节待决事项。
