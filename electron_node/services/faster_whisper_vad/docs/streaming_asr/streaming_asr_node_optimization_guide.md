# 节点端流式 ASR 设计评审与优化建议（交付版）

> 适用对象：节点端 / ASR / Pipeline / 调度协作开发团队  
> 目的：统一设计共识，减少“job 无法合并 / 丢字 / 偶现卡死”等问题，降低后期排障成本

---

## 一、总体结论（TL;DR）

当前节点端流式 ASR 的**整体方向是正确的**，尤其是：

- MaxDuration 触发时的**头部对齐策略**
- pendingMaxDurationAudio / pendingTimeoutAudio 的保留设计
- 统一通过 `createStreamingBatchesWithPending` + `decodeAudioChunk` 进行批次生成

但在 **Buffer Key、生命周期管理、ASR 结果聚合兜底、Finalize 行为一致性** 等关键点上，仍存在结构性缺口。这些缺口会直接导致：

- 同一句话被拆成多个 job，节点端无法合并
- buffer 被过早删除，pending 音频丢失
- ASR 结果注册永远等不齐，pipeline 卡死

本文件给出**必须补充 / 强烈建议优化 / 可选优化**三级清单，供开发部门直接落地。

---

## 二、必须补充（缺失将导致严重问题）

### 1. 冻结并规范 AudioBuffer 的 Key 定义（最高优先级）

#### 问题
当前实现中，buffer 仅以 `sessionId` 作为 key。在以下场景会失效：

- 房间模式 / 多 listener
- 多输入流 / speaker
- Web 端重连 / 会话重建

结果包括：
- 不同流被误合并
- 同一流被反复当成新 buffer（"Buffer not found"）

#### 必须落地的规范

定义一个**唯一、稳定、显式**的 bufferKey 生成规则，例如：

```text
bufferKey = session_id
          [+ room_code]
          [+ input_stream_id / speaker_id]
```

> 说明：
> - 若同一输入音频需要服务多个目标语言，则 **target_lang 不应进入 key**
> - 若不同 target_lang 需要完全隔离，则 target_lang 必须进入 key
> - 二选一，必须在文档与代码中保持一致

#### 强制要求

- 提供 `buildBufferKey()` 工具函数
- 每次 chunk / finalize / delete buffer **必须打印 bufferKey**

---

### 2. ~~OriginalJobResultDispatcher 增加兜底机制~~（组件已移除，当前结果经 ResultSender + buildResultsToSend 单路径）

#### 问题
当前回调触发条件：

```ts
accumulatedSegments.length >= expectedSegmentCount
```

若发生以下任一情况，将导致 registration 永久悬挂：

- 单个 ASR segment 超时 / 失败
- 返回空结果但未被计入
- expectedSegmentCount 与实际不一致

#### 必须补充

1. **registration TTL（必做）**
   - 每个 registration 记录 `startedAt`
   - 超过 N 秒（建议 5–10s）仍未满足条件 → 强制 finalize
   - 输出已有 segments，并标注 `partial=true`、`reason=asr_segment_timeout`

2. **失败 segment 的核销策略**
   - ASR 失败必须：
     - 重试有限次数，或
     - 标记为“已结算但无文本”，允许 registration 继续完成

---

### 3. expectedSegmentCount 的来源必须唯一且一致

#### 问题
expectedSegmentCount 若来源不稳定，会导致：

- 过大 → 永远等不到
- 过小 → 提前 finalize，后续 segment 变孤儿

#### 强制规范

- 在 `runAsrStep` 中：

```ts
expectedSegmentCount = audioSegments.length
```

- 除非有明确设计，否则不得动态变化
- expectedSegmentCount 必须打印日志

---

## 三、强烈建议优化（显著降低 bug 与排障成本）

### 4. 统一 Finalize 与 MaxDuration 的 batch → job 归属策略

#### 当前问题

- MaxDuration：使用**头部对齐策略**
- Timeout / Manual Finalize：使用**容器装填策略**

导致行为不一致、难以预期。

#### 建议方案

- **全局统一使用头部对齐策略**：
  - batch 中第一个 audio segment 决定 originalJobId
- 容器装填仅用于统计或调试，不作为归属依据

---

### 5. utteranceIndex 连续性阈值需要定义“超界处理”与观测

#### 当前行为

- 允许差值 ≤ 2
- 超过后的行为未明确

#### 建议补充

1. 明确定义：
   - 差值 > 2 时：
     - 强制 finalize pending？
     - 丢弃 pending？
     - 创建新 epoch？

2. 增加埋点：
   - 统计 `utterance_gap = current - last`
   - 用真实分布反推阈值，而非拍脑袋

---

### 6. AudioBuffer 生命周期显式状态机化

#### 问题
即便 JS 单线程，异步 await 交错仍会造成：

- 先 delete buffer
- 后写入 pending

#### 建议状态机

```text
OPEN
 ├─(timeout)─> PENDING_TIMEOUT
 ├─(maxDur)──> PENDING_MAXDUR
 ├─(finalize)─> FINALIZING
FINALIZING
 └─> CLOSED
```

#### 强制规则

- 进入 FINALIZING 后，不允许再写入旧 buffer
- 新 chunk 必须进入新 epoch / 新 buffer

---

## 四、可选优化（提升性能与质量，但非阻断）

### 7. 参数 Profile 化（避免反复改代码调参）

将以下参数抽象为 profile：

- maxSegmentDuration
- minSegmentDuration
- batchMinAccumulatedDuration
- VAD hangover

示例：

- `interactive_low_latency`
- `accuracy_first`

---

### 8. ASR 并发与背压控制

建议增加：

- per-session 并发上限（如 2）
- per-node 全局并发上限（如 4–8）

防止长语音 + 多 session 打爆节点。

---

### 9. ASR 结果拼接的语言感知处理

避免统一 `join(' ')`：

- CJK：不加或按标点
- 拉丁语系：空格
- 若 ASR 自带标点，优先使用模型输出

---

### 10. 强烈建议补齐的 3 类测试用例

1. MaxDuration × N + Timeout 收尾
2. <1s 短句 timeout + 下一 job 合并
3. 单个 ASR segment 丢失 / 超时

目标：验证**不丢字、不卡死、可清理**。

---

## 五、立即可执行的 4 项最小改动清单

1. 冻结并打印 `bufferKey()`（所有关键路径）
2. expectedSegmentCount = audioSegments.length
3. Dispatcher 增加 TTL 强制 finalize + 清理
4. 统一 batch → originalJobId 归属策略（头部对齐）

> 完成以上 4 项后，“job 无法合并 / 前半句丢失”的排障难度将下降一个数量级。

---

## 六、附注

本文件为**设计与实现边界明确版**，不涉及兼容历史行为。若后续需要：

- JIRA Task 拆分
- 代码级 patch 清单（按文件/函数）
- 状态机示意图 / 时序图

可在本文件基础上继续派生。

