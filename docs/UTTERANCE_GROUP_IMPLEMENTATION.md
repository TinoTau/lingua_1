# Utterance Group 实现原理与节点端生效机制

**版本**: v1.0  
**最后更新**: 2025-01-XX

---

## 1. Utterance Group 核心原理

### 1.1 设计目标

Utterance Group 旨在**提升连续对话翻译的上下文一致性**，通过将时间上连续的多个 utterances 组织成一个 Group，为 NMT 翻译提供上下文信息。

### 1.2 核心概念

- **Utterance**: 一次完整的用户发言，对应一次 ASR Final
- **Utterance Group**: 一组在时间与语义上连续的 utterances
- **Group Part**: Group 内的一个最小单元，来源于一个 ASR Final
- **Context Text**: 从 Group 中拼接的上下文文本，用于提升 NMT 翻译质量

### 1.3 工作原理

```
用户连续发言：
  "我们刚才说到" (utterance 1)
  "那个项目" (utterance 2)  ← 2秒内
  "进展如何" (utterance 3)  ← 2秒内

GroupManager 判断：
  - utterance 1: 创建 Group A
  - utterance 2: 时间窗口内 → 加入 Group A
  - utterance 3: 时间窗口内 → 加入 Group A

上下文拼接：
  context_text = "User: 我们刚才说到\nUser: 那个项目\nUser: 进展如何\n"

NMT 翻译时：
  - 使用 context_text 提供上下文
  - 提升翻译质量（特别是代词、省略句等）
```

---

## 2. 完整流程

### 2.1 时序图

```
[Web Client]                    [Scheduler]                    [Node]
     |                              |                            |
     |-- audio_chunk (is_final) -->|                            |
     |                              |-- JobAssign (无context) -->|
     |                              |                            |-- ASR
     |                              |<-- ASR_FINAL -------------|
     |                              |                            |
     |                              |-- GroupManager.on_asr_final()
     |                              |   → (group_id, context_text, part_index)
     |                              |                            |
     |                              |                            |-- NMT (当前无context)
     |                              |<-- JobResult (有group_id) -|
     |                              |                            |
     |<-- translation_result -------|                            |
     |                              |                            |
     |-- TTS_PLAY_ENDED ----------->|                            |
     |                              |-- GroupManager.on_tts_play_ended()
     |                              |   → 更新 last_tts_end_at
```

### 2.2 关键步骤

#### 步骤 1: ASR Final 处理（Scheduler 侧）

**位置**: `scheduler/src/websocket/node_handler.rs`

```rust
// 收到 JobResult 时，如果有 ASR 结果
if let Some(ref text_asr) = text_asr {
    let now_ms = chrono::Utc::now().timestamp_millis() as u64;
    let (gid, _context, pidx) = state.group_manager.on_asr_final(
        &session_id,
        &trace_id,
        utterance_index,
        text_asr.clone(),
        now_ms,
    ).await;
    
    // 返回 group_id 和 part_index
    (Some(gid), Some(pidx))
}
```

**GroupManager 处理**:
1. 判断是否属于当前 Group（基于时间窗口）
2. 创建或获取 Group
3. 添加新的 GroupPart
4. 裁剪 Parts（按 max_parts_per_group 和 max_context_length）
5. 构建 context_text
6. 返回 `(group_id, context_text, part_index)`

#### 步骤 2: 上下文拼接（Scheduler 侧）

**位置**: `scheduler/src/group_manager.rs`

```rust
fn build_context(parts: &VecDeque<GroupPart>, max_len: usize) -> String {
    let mut buf = String::new();
    for p in parts.iter() {
        let line = format!("User: {}\n", p.asr_text.trim());
        buf.push_str(&line);
        if let Some(t) = &p.translated_text {
            buf.push_str(&format!("Target: {}\n", t.trim()));
        }
    }
    if buf.len() > max_len {
        buf.truncate(max_len);
    }
    buf
}
```

**拼接格式**:
```
User: 我们刚才说到
Target: We were just talking about
User: 那个项目
Target: that project
User: 进展如何
```

#### 步骤 3: 传递到节点端（当前限制）

**当前流程限制**:
- ⚠️ **ASR 和 NMT 在节点端顺序执行**
- ⚠️ **首次 JobAssign 时还没有 ASR 结果**
- ⚠️ **所以 `context_text` 在首次 JobAssign 时为 `None`**

**代码位置**: `scheduler/src/websocket/session_message_handler.rs`

```rust
// 注意：当前实现中，JobAssign 时还没有 ASR 结果，
// 所以 group_id、part_index、context_text 为 None
// 后续优化：可以在 ASR Final 后重新发送 NMT 请求（包含上下文）
```

#### 步骤 4: 节点端接收（已实现）

**位置**: `node-inference/src/inference.rs`

```rust
pub struct InferenceRequest {
    // ...
    pub context_text: Option<String>,  // ✅ 已支持
}

// 在 process 方法中
let context_text = request.context_text.as_deref();
let translation = self.nmt_engine.translate(
    &transcript, 
    &src_lang, 
    &tgt_lang, 
    context_text  // ✅ 传递到 NMT 引擎
).await?;
```

#### 步骤 5: NMT 引擎使用上下文（已实现）

**位置**: `node-inference/src/nmt.rs`

```rust
pub async fn translate(
    &self,
    text: &str,
    src_lang: &str,
    tgt_lang: &str,
    context_text: Option<&str>,  // ✅ 已支持
) -> Result<String> {
    // 构建请求
    let request = NmtTranslateRequest {
        text: text.to_string(),
        src_lang: src_lang.to_string(),
        tgt_lang: tgt_lang.to_string(),
        context_text: context_text.map(|s| s.to_string()),  // ✅ 传递到 HTTP 请求
    };
    
    // 发送到 Python M2M100 服务
    client.post(&url).json(&request).send().await?;
}
```

#### 步骤 6: Python M2M100 服务（需要支持）

**位置**: `services/nmt_m2m100/nmt_service.py`

**当前状态**: ⚠️ **代码已支持接收 `context_text`，但未实际使用**

```python
class TranslateRequest(BaseModel):
    src_lang: str
    tgt_lang: str
    text: str
    context_text: Optional[str] = None  # ✅ 已定义

@app.post("/v1/translate")
async def translate(req: TranslateRequest):
    # ⚠️ 当前实现：简单拼接上下文和当前文本
    input_text = req.text
    if req.context_text:
        input_text = f"{req.context_text} {req.text}"  # 简单拼接
    
    # ⚠️ 需要优化：M2M100 模型本身不支持上下文参数
    # 需要更复杂的处理方式（例如：使用上下文进行 prompt engineering）
```

---

## 3. 当前实现状态

### 3.1 已实现 ✅

| 组件 | 功能 | 状态 |
|------|------|------|
| **Scheduler** | GroupManager 实现 | ✅ 100% 完成 |
| **Scheduler** | 上下文拼接和裁剪 | ✅ 100% 完成 |
| **Scheduler** | Group 生命周期管理 | ✅ 100% 完成 |
| **Node Inference** | 接收 `context_text` | ✅ 100% 完成 |
| **Node Inference** | 传递 `context_text` 到 NMT | ✅ 100% 完成 |
| **Python M2M100** | 接收 `context_text` 参数 | ✅ 100% 完成 |
| **Web Client** | 发送 TTS_PLAY_ENDED | ✅ 100% 完成 |

### 3.2 未完全生效 ⚠️

| 组件 | 问题 | 影响 |
|------|------|------|
| **流程限制** | ASR 和 NMT 在节点端顺序执行 | ⚠️ 首次 JobAssign 时 `context_text` 为 `None` |
| **Python M2M100** | 未实际使用 `context_text` | ⚠️ 上下文未真正提升翻译质量 |

### 3.3 当前实际流程

```
1. Web Client 发送 audio_chunk (is_final=true)
   ↓
2. Scheduler 创建 JobAssign (context_text=None)  ← ⚠️ 此时还没有 ASR 结果
   ↓
3. Node 执行 ASR → NMT → TTS (NMT 时 context_text=None)
   ↓
4. Node 返回 JobResult (包含 ASR 和翻译结果)
   ↓
5. Scheduler 收到 ASR Final，调用 GroupManager.on_asr_final()
   → 生成 context_text（但此时 NMT 已经完成）← ⚠️ 上下文未使用
   ↓
6. Scheduler 返回 translation_result 给 Web Client
```

**问题**: `context_text` 在 NMT 完成后才生成，无法用于当前翻译。

---

## 4. 如何让 Utterance Group 在节点端生效

### 4.1 方案一：两阶段 NMT 请求（推荐）

**原理**: 在 ASR Final 后，Scheduler 重新发送 NMT 请求（包含上下文）

**流程**:
```
1. JobAssign (无context) → Node → ASR
2. Node → Scheduler: ASR_FINAL
3. Scheduler: GroupManager.on_asr_final() → 生成 context_text
4. Scheduler → Node: NMT_REQUEST (包含 context_text)  ← 新增
5. Node → NMT (使用 context_text)
6. Node → Scheduler: NMT_DONE
7. Scheduler → Web Client: translation_result
```

**优点**:
- ✅ 上下文真正生效
- ✅ 不影响现有流程
- ✅ 向后兼容

**缺点**:
- ⚠️ 需要新增 NMT_REQUEST 消息类型
- ⚠️ 需要修改节点端支持两阶段请求

### 4.2 方案二：优化 Python M2M100 服务

**原理**: 在 Python 服务端实际使用 `context_text` 提升翻译质量

**实现方式**:
1. **Prompt Engineering**: 将上下文作为 prompt 前缀
2. **多轮对话格式**: 使用对话格式（User/Target）作为输入
3. **上下文窗口**: 限制上下文长度，避免超出模型限制

**示例**:
```python
@app.post("/v1/translate")
async def translate(req: TranslateRequest):
    # 构建带上下文的输入
    if req.context_text:
        # 方式1: 简单拼接（当前实现）
        input_text = f"{req.context_text}\nUser: {req.text}"
        
        # 方式2: 使用对话格式（推荐）
        # M2M100 可以理解多轮对话格式
        input_text = f"{req.context_text}\nUser: {req.text}"
    else:
        input_text = req.text
    
    # 执行翻译
    tokenizer.src_lang = req.src_lang
    encoded = tokenizer(input_text, return_tensors="pt")
    # ... 翻译逻辑
```

**优点**:
- ✅ 不需要修改流程
- ✅ 代码已支持接收参数

**缺点**:
- ⚠️ M2M100 模型本身不支持上下文参数，需要 prompt engineering
- ⚠️ 效果可能不如专门的上下文模型

### 4.3 方案三：节点端缓存和重试（复杂）

**原理**: 节点端缓存 ASR 结果，在收到 context_text 后重新翻译

**流程**:
```
1. JobAssign → Node → ASR (缓存结果)
2. Node → Scheduler: ASR_FINAL
3. Scheduler: 生成 context_text
4. Scheduler → Node: CONTEXT_UPDATE (context_text)
5. Node: 使用 context_text 重新翻译
6. Node → Scheduler: NMT_DONE (更新结果)
```

**优点**:
- ✅ 上下文真正生效

**缺点**:
- ⚠️ 实现复杂
- ⚠️ 需要缓存和重试机制
- ⚠️ 可能影响延迟

---

## 5. 当前代码状态

### 5.1 Scheduler 侧 ✅

**GroupManager** (`scheduler/src/group_manager.rs`):
- ✅ 完整的 Group 生命周期管理
- ✅ 上下文拼接和裁剪
- ✅ 时间窗口判断
- ✅ 结构化日志支持

**集成** (`scheduler/src/websocket/node_handler.rs`):
- ✅ 在收到 JobResult 时调用 `on_asr_final`
- ✅ 在收到翻译结果时调用 `on_nmt_done`
- ✅ 返回 `group_id` 和 `part_index` 给客户端

### 5.2 节点端 ✅

**InferenceRequest** (`node-inference/src/inference.rs`):
- ✅ 支持 `context_text: Option<String>`
- ✅ 传递到 NMT 引擎

**NMT 引擎** (`node-inference/src/nmt.rs`):
- ✅ 支持 `context_text` 参数
- ✅ 传递到 HTTP 请求
- ✅ 结构化日志记录

**HTTP 服务器** (`node-inference/src/http_server.rs`):
- ✅ 接收 `context_text` 参数
- ✅ 传递到 InferenceRequest

### 5.3 Python M2M100 服务 ⚠️

**当前实现** (`services/nmt_m2m100/nmt_service.py`):
- ✅ 接收 `context_text` 参数
- ⚠️ **简单拼接**，未真正利用上下文
- ⚠️ **需要优化**以提升翻译质量

---

## 6. 总结

### 6.1 Utterance Group 原理

1. **时间窗口判断**: 基于 `last_tts_end_at` 和 `GROUP_WINDOW_MS`（默认 2 秒）
2. **上下文拼接**: 将 Group 内的 ASR 文本拼接成上下文
3. **裁剪策略**: 按 `max_parts_per_group`（8）和 `max_context_length`（800 字符）裁剪
4. **格式**: `User: ...\nTarget: ...\n` 格式

### 6.2 节点端生效状态

**当前状态**: ⚠️ **代码已就绪，但流程限制导致未完全生效**

**原因**:
- ASR 和 NMT 在节点端顺序执行
- 首次 JobAssign 时还没有 ASR 结果
- `context_text` 在 NMT 完成后才生成

**解决方案**:
1. **短期**: 优化 Python M2M100 服务，实际使用 `context_text`（即使简单拼接也有一定效果）
2. **长期**: 实现两阶段 NMT 请求，让上下文真正生效

### 6.3 代码就绪度

- ✅ **Scheduler**: 100% 完成
- ✅ **Node Inference**: 100% 完成（代码支持）
- ⚠️ **Python M2M100**: 需要优化以实际使用上下文
- ⚠️ **流程**: 需要优化以让上下文在 NMT 前生成

---

## 7. 相关文档

- [Utterance Group 完整文档](./webClient/UTTERANCE_GROUP.md)
- [VAD 架构分析](./VAD_ARCHITECTURE_ANALYSIS.md)
- [项目状态](../project_management/PROJECT_STATUS.md)

