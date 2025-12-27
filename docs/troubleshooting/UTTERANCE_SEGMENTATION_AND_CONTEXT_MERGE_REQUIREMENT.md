# Utterance 分段与上下文拼接需求文档

**日期**: 2025-12-27  
**状态**: 📋 **需求文档（待决策）**  
**目标**: 优化音频分段策略，实现节点端上下文拼接

---

## 一、需求概述

### 1.1 问题背景

当前系统在用户连续输入过程中，可能会因为自然停顿导致 utterance 被错误地分段，影响识别准确性。需要优化分段策略，并在节点端实现上下文拼接功能。

### 1.2 需求目标

1. **优化分段策略**：
   - 缩短静音检测阈值，提高分段灵敏度
   - 增加最大时长限制，防止音频无限累积
   - 超过最大时长后，等待下一个静音检测再 finalize（而不是立即 finalize）

2. **实现上下文拼接**：
   - 在节点端 ASR 处理时，使用上一个 utterance 的文本作为上下文
   - 通过上下文辅助识别，提高识别准确性
   - 具体拼接方式待定（需要进一步设计）

---

## 二、当前实现机制

### 2.1 Web 端发送机制

#### 2.1.1 音频采集与发送流程

**代码位置**: `webapp/web-client/src/recorder.ts`, `webapp/web-client/src/app.ts`

**流程**：

1. **音频采集**：
   - 使用 `MediaRecorder` 或 `AudioContext` 采集音频
   - 采样率：16kHz，单声道，16位深度
   - 每 10ms 产生一帧音频数据

2. **VAD 静音过滤**：
   ```typescript
   // VAD 配置
   attackFrames: 3,        // 连续3帧语音才开始发送（30ms）
   releaseFrames: 30,     // 连续30帧静音才停止发送（300ms）
   attackThreshold: 0.015,  // 进入语音的阈值
   releaseThreshold: 0.005, // 退出语音的阈值
   ```
   - **作用**：实时过滤静音片段，只发送有效语音
   - **关键点**：只影响是否发送音频，不触发 finalize

3. **音频编码**：
   - 使用 Opus 编码（Plan A 格式，packet-based）
   - 每 20ms 一帧，每 100ms 发送一次（累积 5 帧）

4. **消息发送**：
   - **流式发送**（`audio_chunk`）：
     - 每 100ms 发送一次
     - `is_final: false`（流式发送时）
     - `payload`: base64 编码的 Opus 音频数据
   - **静音检测触发**：
     - 检测到连续静音超过 `silenceTimeoutMs`（默认 3000ms）
     - 发送剩余的音频数据（`audio_chunk`，`is_final: false`）
     - 发送 finalize 信号（`audio_chunk`，`is_final: true`）
   - **手动发送**（`utterance`）：
     - 用户点击"发送"按钮
     - 一次性发送完整音频数据

#### 2.1.2 关键配置参数

```typescript
// 静音检测配置
silenceTimeoutMs: 3000  // 3秒（静音超时阈值）
tailBufferMs: 250       // 尾部缓冲（静音检测后延迟触发）

// VAD 静音过滤配置
enabled: true
threshold: 0.015                    // RMS阈值
attackThreshold: 0.01              // 进入语音阈值
releaseThreshold: 0.003            // 退出语音阈值
windowMs: 100                      // 窗口大小
attackFrames: 3                    // 连续3帧语音才开始发送
releaseFrames: 20                  // 连续20帧静音才停止发送（200ms）

// Opus 编码配置
codec: 'opus'
sampleRate: 16000
channelCount: 1
frameSizeMs: 20                    // 20ms帧
application: 'voip'                 // VOIP模式
```

### 2.2 调度服务器处理机制

#### 2.2.1 音频缓冲区管理

**代码位置**: `central_server/scheduler/src/managers/audio_buffer.rs`

**机制**：

1. **音频块累积**：
   - 使用 `AudioBufferManager` 管理音频缓冲区
   - 按 `session_id` 和 `utterance_index` 组织
   - 每个 utterance 的音频块累积在同一个缓冲区中

2. **静音检测**：
   ```rust
   // 记录收到音频块，并判断是否超过停顿阈值
   pub async fn record_chunk_and_check_pause(
       &self, 
       session_id: &str, 
       now_ms: i64, 
       pause_ms: u64
   ) -> bool {
       // 比较当前 chunk 时间戳和上一个 chunk 时间戳
       // 如果间隔 > pause_ms，返回 true（表示应该 finalize）
   }
   ```

3. **异常保护**：
   - 最大音频大小限制：500KB（约 2-3 分钟音频）
   - 正常情况下不会触发（因为 pause_ms 会先触发）

#### 2.2.2 Finalize 触发机制

**代码位置**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**当前触发条件**：

1. **Pause（静音检测）** - 主要机制
   - 当两个 `audio_chunk` 之间的时间间隔超过 `pause_ms`（**当前默认 3000ms**）时触发
   - 检测逻辑：比较当前 chunk 时间戳和上一个 chunk 时间戳

2. **Timeout（超时机制）**
   - 如果 `pause_ms > 0`，每次收到新的 chunk 时会启动/重置超时计时器
   - 如果在 `pause_ms` 时间内没有收到新的 chunk，触发 finalize

3. **MaxDuration（最大时长限制）**
   - 当累积音频时长超过 `max_duration_ms`（**当前默认 20000ms**）时触发
   - **当前行为**：立即 finalize（`finalize_reason = "MaxDuration"`）

4. **IsFinal（手动截断）**
   - Web 端发送 `is_final=true` 时触发

5. **MaxLength（异常保护）**
   - 当音频缓冲区超过 500KB 时触发

**当前配置**：

```rust
// central_server/scheduler/src/core/config.rs
fn default_web_pause_ms() -> u64 {
    3000  // 3秒
}

fn default_max_audio_duration_ms() -> u64 {
    20000  // 20秒
}
```

#### 2.2.3 Finalize 处理流程

**代码位置**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**流程**：

1. **音频块处理**（`handle_audio_chunk`）：
   ```
   步骤1：先添加当前音频块到缓冲区（Fix-A）
   步骤2：检查暂停是否超过阈值（pause_exceeded）
   步骤3：检查是否需要 finalize
      - pause_exceeded → finalize
      - max_duration_ms 超过 → finalize（当前立即触发）
      - is_final → finalize
   步骤4：如果需要 finalize，执行 finalize
   ```

2. **Finalize 执行**（`do_finalize`）：
   ```
   步骤1：获取音频数据（从缓冲区取出）
   步骤2：检查缓冲区是否为空（Fix-B：不允许空缓冲区 finalize）
   步骤3：创建翻译任务（create_translation_jobs）
   步骤4：派发 jobs 到节点端
   ```

3. **上下文文本生成**（`group_manager.on_asr_final`）：
   ```rust
   // 在 ASR Final 之后生成 context_text
   // 包含之前 utterance 的 ASR 文本和翻译文本
   let context = Self::build_context(&group.parts, max_context_length);
   // 格式：User: ... / Target: ...
   ```

**关键问题**：

- **当前 `context_text` 传递时机**：
  - `context_text` 是在 ASR Final **之后**生成的
  - 在 `do_finalize` 中创建 job 时，`context_text` 传递的是 `None`
  - 这意味着当前 utterance 创建 job 时，没有上下文信息

- **代码位置**：
  ```rust
  // central_server/scheduler/src/websocket/session_actor/actor.rs:642
  if let Some(job_assign_msg) = create_job_assign_message(
      &self.state, 
      &job, 
      None,  // group_id
      None,  // part_index
      None   // context_text ← 当前是 None
  ).await {
  ```

### 2.3 节点端 ASR 处理流程

#### 2.3.1 任务路由

**代码位置**: `electron_node/electron-node/main/src/task-router/task-router.ts`

**流程**：

1. **接收任务**（`routeASRTask`）：
   - 从调度服务器接收 `job_assign` 消息
   - 提取音频数据、`context_text` 等参数

2. **发送到 ASR 服务**：
   ```typescript
   const requestBody = {
     job_id: task.job_id,
     src_lang: task.src_lang,
     audio: task.audio,
     audio_format: audioFormat,
     context_text: task.context_text,  // 当前通常是 undefined
     use_text_context: true,           // 保留文本上下文
     condition_on_previous_text: false, // 避免重复识别
   };
   ```

3. **上下文使用**（当前状态）：
   - `use_text_context = true`：保留文本上下文（Faster Whisper 的标准功能）
   - `condition_on_previous_text = false`：避免重复识别
   - **问题**：由于 `context_text` 通常是 `undefined`，上下文功能实际上没有生效

4. **坏段检测**：
   - 使用 `context_text` 进行坏段检测（`detectBadSegment`）
   - 检测与上一段文本的重叠度

#### 2.3.2 上下文拼接需求（待实现）

**当前状态**：
- 节点端支持接收 `context_text`
- 但调度服务器在创建 job 时，`context_text` 是 `None`
- 即使传递了 `context_text`，也没有用于"拼回"被分开的 utterance

**需求**：
- 在 finalize 时，从 `group_manager` 获取之前的 `context_text`
- 传递给节点端
- 节点端使用 `context_text` 辅助识别（具体拼接方式待定）

---

## 三、需求修改方案

### 3.1 配置参数修改

#### 3.1.1 修改 pause_ms

**当前值**: 3000ms（3秒）  
**修改为**: 1000ms（1秒）

**修改位置**:
```rust
// central_server/scheduler/src/core/config.rs
fn default_web_pause_ms() -> u64 {
    1000  // 1秒（从3秒减少到1秒）
}
```

**影响**：
- 更灵敏的静音检测
- 用户说话中的自然停顿（1-3秒）会被识别为 utterance 边界
- 可能导致更多的 utterance 分段

#### 3.1.2 修改 max_duration_ms

**当前值**: 20000ms（20秒）  
**修改为**: 15000ms（15秒）

**修改位置**:
```rust
// central_server/scheduler/src/core/config.rs
fn default_max_audio_duration_ms() -> u64 {
    15000  // 15秒（从20秒减少到15秒）
}
```

**影响**：
- 更严格的最大时长限制
- 防止音频无限累积

#### 3.1.3 修改 MaxDuration 触发行为

**当前行为**: 超过 `max_duration_ms` 时立即 finalize  
**修改为**: 超过 `max_duration_ms` 后，等待下一个静音检测再 finalize

**修改位置**:
```rust
// central_server/scheduler/src/websocket/session_actor/actor.rs
// 当前代码（需要修改）:
if self.max_duration_ms > 0 && self.internal_state.accumulated_audio_duration_ms >= self.max_duration_ms {
    should_finalize = true;
    finalize_reason = "MaxDuration";
}

// 修改后:
if self.max_duration_ms > 0 && self.internal_state.accumulated_audio_duration_ms >= self.max_duration_ms {
    // 不立即 finalize，而是标记为"等待静音检测"
    // 在 pause_exceeded 或 timeout 时再 finalize
    // 这样可以保证在自然停顿处截断，而不是在中间截断
}
```

**实现方案**：
- 添加状态标记：`waiting_for_pause_after_max_duration: bool`
- 当超过 `max_duration_ms` 时，设置标记为 `true`
- 在 `pause_exceeded` 或 `timeout` 检查时，如果标记为 `true`，则触发 finalize
- `finalize_reason` 可以是 `"MaxDuration+Pause"` 或 `"MaxDuration+Timeout"`

### 3.2 上下文拼接实现方案（待设计）

#### 3.2.1 调度服务器端修改

**需求**：在 finalize 时传递 `context_text` 到节点端

**修改位置**:
```rust
// central_server/scheduler/src/websocket/session_actor/actor.rs
// 在 do_finalize 中，获取 context_text
let (group_id, context_text, part_index) = self.state
    .group_manager
    .get_context_for_next_utterance(&self.session_id)
    .await;

// 传递给 create_job_assign_message
if let Some(job_assign_msg) = create_job_assign_message(
    &self.state, 
    &job, 
    Some(group_id),
    Some(part_index),
    context_text  // ← 传递 context_text
).await {
```

**需要实现的方法**：
```rust
// central_server/scheduler/src/managers/group_manager.rs
pub async fn get_context_for_next_utterance(
    &self,
    session_id: &str,
) -> (Option<String>, Option<String>, Option<u64>) {
    // 获取当前活跃的 Group
    // 构建 context_text（包含之前的 ASR 文本）
    // 返回 (group_id, context_text, next_part_index)
}
```

#### 3.2.2 节点端拼接方案（待设计）

**需求**：使用 `context_text` 辅助识别，实现"拼回"被分开的 utterance

**可能的方案**：

1. **方案 A：使用 context_text 作为 initial_prompt**
   - Faster Whisper 支持 `initial_prompt` 参数
   - 将 `context_text` 作为 `initial_prompt` 传递
   - **优点**：简单直接，利用 Faster Whisper 的内置功能
   - **缺点**：可能导致重复识别（如果上下文文本和当前音频内容相同）

2. **方案 B：智能拼接检测**
   - 检测当前音频是否与上下文文本重叠
   - 如果重叠，使用上下文辅助识别
   - 如果不重叠，正常识别
   - **优点**：避免重复识别问题
   - **缺点**：需要实现重叠检测逻辑

3. **方案 C：后处理拼接**
   - 先正常识别当前音频
   - 检测识别结果是否与上下文文本重叠
   - 如果重叠，进行拼接处理
   - **优点**：不影响正常识别流程
   - **缺点**：需要实现拼接算法

**待决策项**：
- 选择哪种拼接方案？
- 如何避免重复识别？
- 如何检测是否需要拼接？
- 拼接后的文本如何返回？

---

## 四、修改影响分析

### 4.1 配置参数修改影响

#### 4.1.1 pause_ms: 3秒 → 1秒

**正面影响**：
- 更灵敏的静音检测
- 用户说话中的自然停顿会被更快识别
- 减少用户等待时间

**负面影响**：
- 可能导致更多的 utterance 分段
- 如果用户在说话中有短暂停顿（1-2秒），可能会被错误地分段
- **需要上下文拼接来弥补这个问题**

#### 4.1.2 max_duration_ms: 20秒 → 15秒

**正面影响**：
- 更严格的最大时长限制
- 防止音频无限累积
- 减少内存占用

**负面影响**：
- 对于长时间连续输入，可能会更频繁地触发 finalize
- **需要"等待静音检测"机制来避免在中间截断**

#### 4.1.3 MaxDuration 触发行为修改

**正面影响**：
- 保证在自然停顿处截断，而不是在中间截断
- 提高用户体验

**负面影响**：
- 如果用户连续输入超过 15 秒且没有停顿，可能会等待较长时间
- 需要实现状态标记和检查逻辑

### 4.2 上下文拼接影响

#### 4.2.1 调度服务器端

**需要修改**：
- `group_manager.rs`：添加 `get_context_for_next_utterance` 方法
- `session_actor/actor.rs`：在 `do_finalize` 中获取并传递 `context_text`
- `websocket/mod.rs`：确保 `create_job_assign_message` 正确传递 `context_text`

**影响**：
- 增加 `context_text` 的传递逻辑
- 需要确保 `context_text` 的及时更新

#### 4.2.2 节点端

**需要修改**：
- `task-router/task-router.ts`：根据 `context_text` 的存在，启用上下文拼接
- 需要实现拼接算法（具体方案待定）

**影响**：
- 可能影响 ASR 识别性能（如果使用上下文）
- 需要处理重复识别问题

---

## 五、实施计划

### 5.1 第一阶段：配置参数修改

**任务**：
1. 修改 `pause_ms` 默认值：3000ms → 1000ms
2. 修改 `max_duration_ms` 默认值：20000ms → 15000ms
3. 修改 MaxDuration 触发行为：等待静音检测再 finalize

**预计工作量**：1-2 天

**风险**：
- 低风险：主要是配置修改和逻辑调整

### 5.2 第二阶段：上下文传递实现

**任务**：
1. 在 `group_manager.rs` 中实现 `get_context_for_next_utterance` 方法
2. 在 `do_finalize` 中获取并传递 `context_text`
3. 确保 `create_job_assign_message` 正确传递 `context_text`

**预计工作量**：2-3 天

**风险**：
- 中等风险：需要确保 `context_text` 的及时更新和正确传递

### 5.3 第三阶段：节点端拼接实现（待设计）

**任务**：
1. 设计拼接方案（方案 A/B/C 或组合）
2. 实现拼接算法
3. 测试和优化

**预计工作量**：5-10 天（取决于选择的方案）

**风险**：
- 高风险：需要仔细设计，避免重复识别问题

---

## 六、测试建议

### 6.1 配置参数修改测试

1. **pause_ms 测试**：
   - 测试用户说话中有 1-2 秒停顿的情况
   - 验证是否正确分段
   - 验证上下文拼接是否生效

2. **max_duration_ms 测试**：
   - 测试用户连续输入超过 15 秒的情况
   - 验证是否等待静音检测再 finalize
   - 验证不会在中间截断

### 6.2 上下文拼接测试

1. **基本功能测试**：
   - 测试 `context_text` 是否正确传递
   - 测试节点端是否正确使用 `context_text`

2. **拼接效果测试**：
   - 测试被分开的 utterance 是否能正确拼接
   - 测试是否避免重复识别
   - 测试识别准确性是否提高

---

## 七、待决策项

1. **拼接方案选择**：
   - 方案 A：使用 `initial_prompt`
   - 方案 B：智能拼接检测
   - 方案 C：后处理拼接
   - 或组合方案

2. **重复识别处理**：
   - 如何避免上下文文本和当前音频内容相同时的重复识别？
   - 是否需要检测重叠度？

3. **拼接触发条件**：
   - 什么情况下需要拼接？
   - 是否需要检测 utterance 之间的关联性？

4. **性能影响评估**：
   - 使用上下文是否会影响 ASR 识别性能？
   - 是否需要限制 `context_text` 的长度？

---

## 八、附录

### 8.1 相关代码文件

**调度服务器**：
- `central_server/scheduler/src/core/config.rs` - 配置定义
- `central_server/scheduler/src/websocket/session_actor/actor.rs` - Finalize 逻辑
- `central_server/scheduler/src/managers/audio_buffer.rs` - 音频缓冲区管理
- `central_server/scheduler/src/managers/group_manager.rs` - 上下文管理
- `central_server/scheduler/src/websocket/mod.rs` - JobAssign 消息创建

**节点端**：
- `electron_node/electron-node/main/src/task-router/task-router.ts` - ASR 任务路由
- `electron_node/electron-node/main/src/task-router/bad-segment-detector.ts` - 坏段检测

**Web 端**：
- `webapp/web-client/src/recorder.ts` - 音频采集和 VAD
- `webapp/web-client/src/app.ts` - 音频发送逻辑

### 8.2 相关文档

- `docs/troubleshooting/FINALIZE_MECHANISM_EXPLANATION.md` - Finalize 机制说明
- `docs/troubleshooting/AUDIO_CHUNK_LOSS_ISSUE_REPORT.md` - 音频块丢失问题报告
- `docs/troubleshooting/ASR_AUDIO_CHUNK_LOSS_ROOT_FIX_DESIGN_AND_TASKS.md` - 根修复设计

---

**文档版本**: v1.0  
**最后更新**: 2025-12-27  
**状态**: 📋 待决策部门审核

