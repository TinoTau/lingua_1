# 取消跨 Job 前向合并（Forward Merge）
## 推荐方案说明（架构级裁决稿）

> 本文档用于解释并冻结：
> **在 turn affinity 改造完成后，节点端出现「Job2 前半句丢失 / 多 Job 空结果」问题的根因与推荐解决方案。**
>
> 本方案为**架构级裁决**，不涉及最小 patch 或 tasklist，
> 目标是 **一次性消除冲突路径，而不是继续修补旧逻辑**。

---

## 1. 问题背景（已确认事实）

在完成以下改造后：

- 节点端 bufferKey 已统一为 `jobId`
- Job 被明确为最小调度单位
- 同一次发言超过 10 秒会被拆分为多个连续 Job
- 调度服务器通过 `turnId + segmentIndex` 负责跨 Job 的语义拼接

在集成测试中出现以下现象：

1. **Job2 前半句丢失**（Job1 中约 4–5 秒音频未转写）
2. **多个 Job 返回空结果（isEmptyJob）**，UI 只显示部分 segment

---

## 2. 根因分析（确定性结论）

### 2.1 原有节点端隐含假设

节点端原有 Audio Aggregator 设计隐含以下前提：

> 同一次发言的多个 Job 在节点端是可感知、可连续合并的。

因此引入了以下逻辑路径：

- `pendingMaxDurationAudio`
- `shouldWaitForMerge = true`
- MaxDuration finalize 时 **不输出结果，等待下一 Job 合并**

---

### 2.2 新架构下该假设已失效

在当前已冻结的设计中：

- `bufferKey = jobId`
- 每个 Job 在节点端拥有 **独立 buffer**
- Job2 永远不会看到 Job1 的 pending buffer

因此：

- Job1 的剩余音频被“悬挂”在一个永远不会再被读取的 buffer 中
- Job2 是一个全新的 buffer，只能处理自身的音频

**结论**：
> 跨 Job 的“前向合并（Forward Merge）”路径，与新架构发生了根本性冲突。

---

## 3. 设计原则回顾（不容违背）

在此前的架构决策中，已经明确：

1. **Job 是最小调度单位**
2. 节点端只负责 **Job 内闭环处理**
3. 跨 Job 的语义拼接应上移至调度服务器 / Web 端
4. 不允许在节点端引入 session / turn 级扫描或跨 key 合并
5. 避免新增控制流路径或补丁链

任何修复方案都必须满足以上原则。

---

## 4. 推荐方案（唯一推荐）

### 4.1 核心裁决

> **彻底取消节点端的跨 Job 前向合并逻辑。**

具体含义：

- MaxDuration finalize **不再允许输出空结果**
- 不再使用 `shouldWaitForMerge = true`
- 不再依赖 `pendingMaxDurationAudio` 传递到下一 Job

---

### 4.2 新的节点端职责边界

在新方案下，节点端的职责被明确为：

> **任何 finalize（manual / timeout / maxDuration）都必须输出当前 Job 内“可得到的最好结果”。**

这意味着：

- Job 内 buffer 中的所有音频，必须在该 Job 内完成 ASR 处理
- 即使被 MaxDuration 强制切分，也属于“当前 Job 的结果”
- 节点端不再“等待下一 Job”来补全语义

---

## 5. 为什么这是架构解，而不是补丁

### 5.1 减少而不是增加控制流

- 原方案：
  - finalize → 等待合并 → 下一 Job → 再 finalize
- 新方案：
  - finalize → 输出结果（单一路径）

控制流显著收敛。

---

### 5.2 与 turn / segment 设计完全对齐

- 跨 Job 的拼接已经有明确去向：`turnId + segmentIndex`
- 不再需要节点端“偷偷做一部分拼接”
- 职责清晰，层次分明

---

### 5.3 避免未来会议室场景的指数复杂度

在多人插话、语言切换、节点随机分配的场景下：

- 节点端跨 Job 合并将面临严重歧义
- 取消该路径可提前避免一整类未来 bug

---

## 6. 明确不采用的方案（否决项）

以下方案均被明确否决：

1. **节点端按 sessionId 回溯并合并上一 Job buffer**
   - 引入跨 key 扫描与复杂状态

2. **调度端回收并重发节点端 pending 音频**
   - 增加带宽、协议复杂度与一致性风险

3. **增加 TTL / 等待窗口猜测是否有下一 Job**
   - 与“无超时机制”的既定决策冲突

---

## 6.1 裁决修订（2026-01）：允许按 turnId + targetLang 合并

经决策部门审议，**允许**以下方案，作为对第 6 条否决项的**限定例外**：

- **调度在 job_assign 中附带 turn_id**（调度端已有 current_turn_id，下发给节点）。
- **节点端以 (turnId + targetLang) 作为合并 key**：同一 turn、同一目标语言的多个 Job 共用同一 buffer；**仅**在 manual / timeout finalize 时触发 turn 级 flush，输出一条 job_result。
- **MaxDuration finalize**：只做追加，不触发最终输出，不向调度发送 job_result。
- **不允许**：节点端按 sessionId 自主推断、跨 key 扫描、或跨 turn 合并。
- **不允许**：TTL、隐式结束、或“等下一 Job 再合并”的前向补丁逻辑（如 shouldWaitForMerge）。

实施依据见《节点端 turnId 合并技术方案（补充冻结版）》。

---

## 7. 方案落地后的直接收益

- Job2 前半句不再丢失
- 空结果 Job 数量显著下降
- turn + segment 的播放与展示更稳定
- 节点端代码更易推理与调试

---

## 8. 裁决结论（冻结）

> **节点端不再承担跨 Job 的语义拼接或前向合并责任。**
>
> 每个 Job 必须在自身生命周期内输出完整、可用的结果；
> 跨 Job 的语义连续性由调度服务器与 Web 端负责。

本裁决作为后续最小 patch 与实现调整的唯一依据。