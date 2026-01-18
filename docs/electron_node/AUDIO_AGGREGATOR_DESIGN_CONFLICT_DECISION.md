# AudioAggregator 设计冲突问题 - 决策文档

## 问题概述

在实现"流式ASR处理 + 头部对齐"功能时，发现与现有的"空结果保活机制"产生了设计冲突，导致实际ASR结果被错误过滤。

---

## 背景：两个设计目标

### 设计1：流式ASR处理 + 头部对齐（新功能）

**目标**：处理长语音时，将音频拆分成多个批次发送给ASR，然后将所有ASR结果分配给原始job_id。

**实现方式**：
- `AudioAggregator` 将长音频拆分成多个批次（每批≥5秒）
- 每个批次通过 `originalJobIds` 标记属于哪个原始job
- `OriginalJobResultDispatcher` 收集所有批次的结果，分配给原始job_id
- **一个job_id可能在不同时间点产生多个ASR结果，最终合并成一个完整结果**

**示例**：
```
Job 618 (utteranceIndex:5) 音频被缓存
  ↓
Job 619 (utteranceIndex:6) 合并缓存音频 + 新音频
  ↓
产生ASR结果，分配给 originalJobId: 618
  ↓
发送结果给调度服务器（job_id: 618）
```

### 设计2：空结果保活机制（现有功能）

**目标**：当节点端音频被缓存等待合并时，发送空结果给调度服务器，避免job超时。

**实现方式**：
- 调度服务器有 `job_timeout_seconds=30` 的超时机制
- 如果节点30秒内没有返回 `job_result`，调度服务器认为节点卡住
- 当音频被缓存到 `pendingTimeoutAudio` 时，节点发送空结果（`text_asr: ""`）作为"保活"信号
- **去重逻辑假设：一个job_id只能发送一次结果**

**示例**：
```
Job 618 音频被缓存
  ↓
发送空结果（text_asr: ""）给调度服务器
  ↓
去重逻辑记录：job_id 618 已发送
```

---

## 冲突场景

### 实际发生的问题

**Job `s-4BE03808:618` 的处理流程**：

1. **阶段1：调度服务器触发 MaxDuration finalize**
   - 累计音频时长达到10秒，触发 finalize
   - 创建 Job 618，发送到节点

2. **阶段2：节点端缓存音频**
   - 节点收到 Job 618，音频被缓存到 `pendingTimeoutAudio`
   - **为了避免调度服务器30秒超时，发送了空结果**（`text_asr: ""`）
   - 去重逻辑记录：`job_id 618 已发送`

3. **阶段3：后续job合并并处理**
   - 调度服务器创建 Job 619（继续处理同一session）
   - 节点端合并 `pendingTimeoutAudio`（来自Job 618）+ 新音频（来自Job 619）
   - 音频切分成批次，根据字节偏移分配 originalJobId（头部对齐策略）
   - 产生实际ASR结果（53字符文本）
   - **根据头部对齐策略，如果所有批次都落在 Job 618 的范围内，结果分配给 `originalJobId: s-4BE03808:618`** ✅
   - **只有当 Job 619 有新的音频批次（超出 Job 618 范围）时，才会分配给 `originalJobId: s-4BE03808:619`**

4. **阶段4：去重检测失败**
   - 去重逻辑检查：`job_id 618 已发送`（因为阶段2发送了空结果）
   - `shouldSend: false`
   - **实际结果被错误过滤，再次发送空结果** ❌

### 冲突的本质

**两个设计的基本假设冲突**：

| 设计 | 基本假设 | 实际情况 |
|------|---------|---------|
| **流式ASR + 头部对齐** | 一个job_id可能在不同时间点产生多个结果，最终合并 | ✅ 符合需求 |
| **空结果保活 + 去重** | 一个job_id只能发送一次结果 | ❌ 与流式处理冲突 |

**结果**：
- 流式处理需要：**一个job_id可以发送多次结果**（空结果 + 实际结果）
- 去重逻辑假设：**一个job_id只能发送一次结果**
- **冲突导致实际结果被过滤**

---

## 影响分析

### 功能影响

- ✅ **正常场景**：短语音、手动cut、pause finalize → 正常工作
- ❌ **问题场景**：长语音、MaxDuration finalize → **实际结果丢失**

### 数据影响

- **丢失的ASR结果**：用户的长语音内容无法返回
- **用户体验**：用户看到空结果，认为系统故障

### 代码复杂度

- 当前修复（不记录空结果的job_id）增加了代码复杂度
- 需要区分"空结果"和"实际结果"
- 逻辑不直观，难以维护

---

## 解决方案选项

### 方案1：移除空结果保活机制（推荐）

**逻辑**：
- 超时finalize时，音频被缓存到 `pendingTimeoutAudio`
- **不发送任何结果**，让调度服务器等待
- 只有当 `pendingTimeoutAudio` 被处理并产生实际结果时，才发送结果

**优点**：
- ✅ 逻辑最简单：**有结果才发送，没结果不发送**
- ✅ 不需要区分"空结果"和"实际结果"
- ✅ 一个job_id只发送一次（实际结果）
- ✅ 符合流式处理的设计

**缺点**：
- ⚠️ 需要调整调度服务器的超时机制（可能需要延长超时时间）
- ⚠️ 如果 `pendingTimeoutAudio` 长时间不被处理，调度服务器会超时

**实施难度**：**低**
- 移除节点端发送空结果的逻辑
- 调整调度服务器的超时时间（从30秒延长到60秒或更长）

---

### 方案2：调整去重逻辑，允许空结果后发送实际结果

**逻辑**：
- 保留空结果保活机制
- 修改去重逻辑：**如果之前发送的是空结果（`text_asr: ""`），允许再次发送实际结果**
- 只有当之前发送的是实际结果时，才进行去重过滤

**优点**：
- ✅ 保留现有的保活机制
- ✅ 解决冲突问题

**缺点**：
- ⚠️ 需要区分"空结果"和"实际结果"（增加复杂度）
- ⚠️ 需要修改去重逻辑，可能影响其他场景
- ⚠️ 逻辑不够直观

**实施难度**：**中**
- 修改 `DedupStage` 逻辑
- 修改 `ResultSender` 逻辑
- 需要测试各种场景

---

### 方案3：简化 AudioAggregator，移除跨job状态管理

**逻辑**：
- 移除 `pendingTimeoutAudio` 机制
- 超时finalize时，**立即处理音频**（即使不够长）
- 如果结果不够好，通过其他机制（如语义修复）来改善

**优点**：
- ✅ 逻辑最简单：**每个job立即处理，立即返回结果**
- ✅ 不需要跨job的状态管理
- ✅ 不需要空结果保活机制

**缺点**：
- ⚠️ 可能影响ASR识别质量（短音频识别效果较差）
- ⚠️ 需要重新评估流式处理的必要性

**实施难度**：**高**
- 需要重新设计 AudioAggregator
- 需要评估对识别质量的影响
- 可能需要回退之前的流式处理改动

---

## 推荐方案

### 推荐：方案1（移除空结果保活机制）

**理由**：
1. **逻辑最简单**：符合"有结果才发送"的直观理解
2. **解决根本问题**：不需要区分空结果和实际结果
3. **实施难度低**：只需要移除发送空结果的逻辑，调整超时时间
4. **符合流式处理设计**：一个job_id只发送一次实际结果

**实施步骤**：
1. 移除节点端发送空结果的逻辑（`node-agent-result-sender.ts`）
2. 调整调度服务器的超时时间（从30秒延长到60秒或更长）
3. 测试验证：确保长语音场景正常工作

**风险评估**：
- **低风险**：如果 `pendingTimeoutAudio` 在10秒内被处理（TTL），不会触发超时
- **中风险**：如果 `pendingTimeoutAudio` 长时间不被处理，可能触发超时（需要监控）

---

## 决策建议

### 需要决策的问题

1. **是否保留空结果保活机制？**
   - 如果保留：需要方案2（调整去重逻辑）
   - 如果不保留：推荐方案1（移除保活机制）

2. **调度服务器的超时时间是否可以调整？**
   - 如果可以从30秒延长到60秒：推荐方案1
   - 如果必须保持30秒：考虑方案2

3. **流式处理是否必须保留？**
   - 如果必须保留：方案1或方案2
   - 如果可以简化：考虑方案3

### 建议

**优先考虑方案1**，因为：
- 逻辑最简单，易于维护
- 解决根本问题，不需要特殊处理
- 实施难度低，风险可控

如果调度服务器的超时时间无法调整，再考虑方案2。

---

## 附录：技术细节

### 相关代码位置

**节点端**：
- `electron_node/electron-node/main/src/agent/node-agent-result-sender.ts` - 发送空结果的逻辑
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` - 音频缓存逻辑
- `electron_node/electron-node/main/src/agent/postprocess/dedup-stage.ts` - 去重逻辑

**调度服务器**：
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - MaxDuration finalize检测
- `central_server/scheduler/src/timeout/job_timeout.rs` - job超时机制
- `central_server/scheduler/config.toml` - 超时配置（`job_timeout_seconds=30`）

### 相关日志

**调度服务器日志**：
```
[调度服务器] Audio duration exceeded max limit, auto-finalizing
[调度服务器] accumulated_duration_ms: 8840, max_duration_ms: 10000
[调度服务器] Finalize: 开始处理（原因: MaxDuration）
```

**节点端日志**：
```
[utteranceIndex:5] pendingTimeoutAudio cached, waiting for next job
[utteranceIndex:5] ASR result is empty, but sending empty job_result to scheduler to prevent timeout
[utteranceIndex:6] ASR result: "所以我会尽量连续地说的长一些..."
[utteranceIndex:6] DedupStage: job_id already sent, skipping duplicate ❌
```

---

## 总结

**问题**：流式ASR处理（一个job_id可能发送多次结果）与空结果保活机制（假设一个job_id只能发送一次结果）产生冲突。

**影响**：长语音场景下，实际ASR结果被错误过滤，用户无法收到识别结果。

**推荐方案**：移除空结果保活机制，调整调度服务器超时时间，让系统遵循"有结果才发送"的简单逻辑。

**决策要点**：
1. 是否保留空结果保活机制？
2. 调度服务器超时时间是否可以调整？
3. 流式处理是否必须保留？
