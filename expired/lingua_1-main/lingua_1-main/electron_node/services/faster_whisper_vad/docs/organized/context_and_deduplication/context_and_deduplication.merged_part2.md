# Context And Deduplication (Part 2/4)

- **支持**: 允许中间有空格

### 方法3：开头结尾重复检测（新增）
- **场景**: `"导致没有办法播 那些问题 导致没有办法播"` → `"导致没有办法播 那些问题"`
- **支持**: 允许中间有其他文本

---

## 限制

### 当前无法处理的场景

1. **跨utterance的重复**:
   - 问题: 多个utterance返回了相同的文本
   - 示例: 
     - Utterance 1: "我还会报错崩溃了"
     - Utterance 2: "我还会报错崩溃了"
   - 当前处理: 每个utterance单独去重，但不会跨utterance去重
   - 建议: 如果需要，可以在Web端添加去重逻辑

2. **部分重叠的重复**:
   - 问题: 文本部分重叠但不在开头或结尾
   - 示例: `"测试A测试B测试A"`（中间的"测试A"和结尾的"测试A"重复）
   - 当前处理: 可能无法完全去重

---

## 架构原则

### 去重逻辑完全在服务端完成 ✅

**决定**: **不在Web端添加去重逻辑**

**原因**:
- 去重逻辑应该在服务端完成，保持架构清晰
- Web端只负责显示服务端返回的结果
- 如果多个utterance返回了相同的文本，这是正常的（用户可能确实说了相同的话）

**服务端去重流程**:
1. Step 9.2: 对ASR识别结果进行去重处理
2. Step 11: 使用去重后的文本更新上下文缓存
3. 返回去重后的文本给Web端

### 继续优化去重算法（可选）

如果需要处理更复杂的重复模式，可以：
- 添加模糊匹配（允许少量字符差异）
- 优化开头结尾重复检测的准确性
- 添加部分重叠的重复检测

---

## 验证

运行单元测试验证增强后的去重功能：

```bash
python test_text_deduplicator.py
```

**预期结果**: 所有测试通过 ✅

---

## 相关文档

- [文本去重测试报告](./TEXT_DEDUPLICATOR_TEST_REPORT.md)
- [上下文重复问题说明](./CONTEXT_DUPLICATE_ISSUE_EXPLANATION.md)



---

## DEDUPLICATION_RESPONSE_FIX.md

# 去重结果返回修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

虽然去重功能在 Step 9.2 中正确执行，但返回给Web端的文本仍然使用了去重前的原始文本。

**问题代码**:
```python
# Step 13: 返回结果
response = UtteranceResponse(
    text=full_text,  # ❌ 使用去重前的原始文本
    segments=segment_texts,  # ❌ segments也是基于原始文本生成的
    ...
)
```

**影响**:
- Web端收到的文本仍然是重复的
- 去重功能虽然执行了，但结果没有返回给Web端

---

## 修复内容

### 1. 修复返回文本使用去重后的结果

**文件**: `faster_whisper_vad_service.py`

**修改**:
```python
# Step 13: 返回结果
# 关键修复：返回去重后的文本，而不是原始文本
response = UtteranceResponse(
    text=full_text_trimmed,  # ✅ 使用去重后的文本
    segments=segment_texts,  # ✅ segments也在去重后重新生成
    ...
)
```

### 2. 修复 segments 使用去重后的文本

**修改**:
```python
# 在去重后（Step 9.2之后），重新生成 segment_texts
# 这样返回的 segments 也是去重后的
segment_texts = [s.strip() for s in full_text_trimmed.split() if s.strip()]
if not segment_texts:
    segment_texts = [full_text_trimmed] if full_text_trimmed else []
```

---

## 去重流程总结

### 完整的去重流程

1. **Step 9.1**: 文本trim处理
   ```python
   full_text_trimmed = full_text.strip()
   ```

2. **Step 9.2**: 去重处理
   ```python
   full_text_trimmed = deduplicate_text(full_text_trimmed, trace_id=trace_id)
   ```

3. **Step 9.3**: 重新生成 segments（使用去重后的文本）
   ```python
   segment_texts = [s.strip() for s in full_text_trimmed.split() if s.strip()]
   ```

4. **Step 11**: 更新文本上下文缓存（使用去重后的文本）
   ```python
   update_text_context(full_text_trimmed)  # ✅ 使用去重后的文本
   ```

5. **Step 13**: 返回结果（使用去重后的文本）
   ```python
   response = UtteranceResponse(
       text=full_text_trimmed,  # ✅ 使用去重后的文本
       segments=segment_texts,  # ✅ 使用去重后的segments
       ...
   )
   ```

---

## 验证

### 测试用例

1. **单个utterance内的重复**
   - 输入: `"上下温功能有没有生效? 上下温功能有没有生效?"`
   - 输出: `"上下温功能有没有生效?"` ✅

2. **开头和结尾的重复**
   - 输入: `"导致没有办法播 那些问题 导致没有办法播"`
   - 输出: `"导致没有办法播 那些问题"` ✅

3. **相邻重复**
   - 输入: `"我还会报错崩溃了 我还会报错崩溃了"`
   - 输出: `"我还会报错崩溃了"` ✅

### 日志验证

去重后的文本会在日志中显示：
```
Step 9.2: Deduplication applied, original_len=23, deduplicated_len=11
original_text="上下温功能有没有生效? 上下温功能有没有生效?"
deduplicated_text="上下温功能有没有生效?"
```

返回结果时也会记录：
```
Step 13: Response constructed successfully, returning deduplicated text (len=11)
```

---

## 架构原则

### 去重逻辑完全在服务端完成 ✅

- **不在Web端添加去重逻辑**
- 服务端负责所有去重处理
- Web端只负责显示服务端返回的结果

---

## 相关文档

- [文本去重功能增强](./DEDUPLICATION_ENHANCEMENT.md)
- [ASR重复文本问题分析](./ASR_DUPLICATE_TEXT_ANALYSIS.md)



---

## UTTERANCE_CONTEXT_AND_DEDUPLICATION.md

# Utterance 上下文机制和跨 Utterance 去重分析

**日期**: 2025-12-25  
**状态**: ✅ **已确认**

---

## 工作流程确认

### 1. 调度服务器流程

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**流程**：
1. **接收 audio_chunk**：
   ```rust
   async fn handle_audio_chunk(
       &mut self,
       chunk: Vec<u8>,
       is_final: bool,
       timestamp_ms: u64,
       client_timestamp_ms: Option<i64>,
   )
   ```

2. **拼接 audio_chunk 到缓冲区**：
   ```rust
   let (should_finalize_due_to_length, current_size_bytes) = self.state
       .audio_buffer
       .add_chunk(&self.session_id, utterance_index, chunk)
   ```

3. **Finalize utterance**（当 `is_final=true` 或达到长度限制时）：
   ```rust
   async fn try_finalize(&mut self, utterance_index: u64, reason: &str) -> Result<bool>
   ```
   - 从缓冲区获取完整的音频数据
   - 创建 `JobAssignMessage`（包含完整的 utterance 音频）
   - 发送到节点端

**关键点**：
- ✅ **调度服务器将多个 audio_chunk 拼接成完整的 utterance**
- ✅ **每个 utterance 包含完整的音频数据**
- ✅ **utterance 作为独立的短句发送给节点端**

---

### 2. 节点端流程

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

**流程**：
1. **接收 JobAssignMessage**：
   ```typescript
   private async handleJob(job: JobAssignMessage): Promise<void>
   ```
   - `job.audio` 包含完整的 utterance 音频（base64编码）

2. **处理 ASR 任务**：
   ```typescript
   // pipeline-orchestrator.ts
   const asrTask: ASRTask = {
     audio: job.audio,  // 完整的 utterance 音频
     audio_format: job.audio_format || 'pcm16',
     sample_rate: job.sample_rate || 16000,
     src_lang: job.src_lang,
     context_text: (job as any).context_text,  // 上下文文本（可选）
     job_id: job.job_id,
   };
   ```

3. **发送到 ASR 服务**：
   ```typescript
   // task-router.ts
   const requestBody: any = {
     job_id: task.job_id,
     audio: task.audio,  // 完整的 utterance 音频
     audio_format: audioFormat,
     sample_rate: task.sample_rate || 16000,
     context_text: task.context_text,  // 上下文文本（可选）
     // ...
   };
   ```

**关键点**：
- ✅ **节点端接收完整的 utterance 音频**
- ✅ **每个 utterance 是独立的处理单元**

---

### 3. ASR 服务上下文机制

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**上下文机制**：

#### 3.1. 音频上下文（Audio Context）

```python
# context.py
def get_context_audio() -> np.ndarray:
    """获取上下文音频（上一个 utterance 的尾部，2秒）"""
    return context_buffer.get_tail(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)

def update_context_buffer(audio: np.ndarray):
    """更新上下文缓冲区（保存当前 utterance 的尾部）"""
    context_buffer.append(audio)
```

**流程**：
1. **获取上一个 utterance 的音频尾部**（2秒）：
   ```python
   context_audio = get_context_audio()  # 上一个 utterance 的尾部（2秒）
   ```

2. **前置到当前 utterance**：
   ```python
   audio_with_context = np.concatenate([context_audio, audio])
   ```

3. **更新上下文缓冲区**（保存当前 utterance 的尾部）：
   ```python
   update_context_buffer(processed_audio)  # 保存当前 utterance 的尾部
   ```

#### 3.2. 文本上下文（Text Context）

```python
# context.py
def get_text_context() -> str:
    """获取文本上下文（上一个 utterance 的识别结果）"""
    return text_context_cache.get_text_context()

def update_text_context(text: str):
    """更新文本上下文（保存当前 utterance 的识别结果）"""
    text_context_cache.update_text_context(text)
```

**流程**：
1. **获取上一个 utterance 的文本**：
   ```python
   text_context = get_text_context()  # 上一个 utterance 的识别结果
   ```

2. **作为 initial_prompt 传递给 ASR**：
   ```python
   asr_result = await manager.submit_task(
       audio=audio_with_context,
       initial_prompt=text_context if text_context else None,
       condition_on_previous_text=False,  # 已修复：避免重复识别
       # ...
   )
   ```

3. **更新文本上下文**（保存当前 utterance 的识别结果）：
   ```python
   update_text_context(full_text_trimmed)  # 保存当前 utterance 的识别结果
   ```

**关键点**：
- ✅ **ASR 服务使用上一个 utterance 的文本和音频作为上下文**
- ✅ **每个 utterance 是独立的，但会使用上一个 utterance 的上下文**
- ✅ **上下文是跨 utterance 的**

---

## 跨 Utterance 去重分析

### 当前去重机制

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**当前实现**：
```python
# Step 9.2: 去重处理（单个 utterance 内）
if full_text_trimmed:
    from text_deduplicator import deduplicate_text
    full_text_trimmed = deduplicate_text(full_text_trimmed, trace_id=trace_id)
```

**问题**：
- ❌ **只处理单个 utterance 内的重复**
- ❌ **无法处理跨 utterance 的重复**

**示例**：
```
Utterance 1: "然后总是出现一些结果互完占的提示位置"
Utterance 2: "然后总是出现一些结果互完占的提示位置"  # 完全重复
Utterance 3: "然后评并调整"  # 部分重复（"然后"）
```

---

### 跨 Utterance 去重方案

#### 方案 1: ASR 服务端去重（推荐）

**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**实现**：
```python
# 在 process_utterance 中
# Step 9.2: 单个 utterance 内去重
full_text_trimmed = deduplicate_text(full_text_trimmed, trace_id=trace_id)

# Step 9.3: 跨 utterance 去重（已移除，迁移到 Aggregator 层）
# 注意：跨 utterance 去重已迁移到 Aggregator 层（节点端）
# Step 9.2 保留：单个 utterance 内部去重（处理如 "这边能不能用这边能不能用" 的情况）
# Step 9.3 已移除：跨 utterance 去重由 Aggregator 统一处理，避免重复处理，职责更清晰
```

**状态**：❌ **已移除**（迁移到 Aggregator 层）

**移除原因**：
- Aggregator 会在节点端统一处理跨 utterance 的文本去重（dedup 功能）
- 避免重复处理，职责更清晰
- 在翻译前去重，性能更好

**历史实现**（仅供参考）：
```python
# Step 9.3: 跨 utterance 去重（已移除）
previous_text = get_text_context()  # 获取上一个 utterance 的文本
if previous_text and full_text_trimmed:
    # 检查当前文本是否与上一个文本重复
    if full_text_trimmed == previous_text:
        # 完全重复，返回空结果
        logger.warning(f"[{trace_id}] Cross-utterance duplicate detected, returning empty")
        return UtteranceResponse(...)
    elif full_text_trimmed.startswith(previous_text):
        # 部分重复（当前文本以上一个文本开头），移除重复部分
        full_text_trimmed = full_text_trimmed[len(previous_text):].strip()
        logger.info(f"[{trace_id}] Cross-utterance partial duplicate removed")
```

**历史优点**（已废弃）：
- ✅ 在 ASR 服务端统一处理
- ✅ 可以访问上一个 utterance 的文本上下文
- ✅ 不需要修改调度服务器

**历史缺点**（已废弃）：
- ⚠️ 需要维护跨 utterance 的状态

---

#### 方案 2: 调度服务器端去重

**位置**: `central_server/scheduler/src/websocket/node_handler/message/job_result.rs`

**实现**：
```rust
// 在收到 JobResult 时
// 检查当前 ASR 文本是否与上一个 utterance 的文本重复
if let Some(ref previous_asr) = state.last_asr_text {
    if text_asr == previous_asr {
        // 完全重复，跳过转发
        warn!("Cross-utterance duplicate detected, skipping");
        return;
    }
}
state.last_asr_text = text_asr.clone();
```

**优点**：
- ✅ 在调度服务器端统一处理
- ✅ 可以访问所有 utterance 的历史

**缺点**：
- ⚠️ 需要修改调度服务器
- ⚠️ 需要维护跨 utterance 的状态

---

## 推荐方案

### 当前方案：Aggregator 层去重（节点端）

**状态**：✅ **已迁移**（Step 9.3 已移除）

**理由**：
1. **职责清晰**：Aggregator 负责跨 utterance 的文本聚合和去重
2. **性能更好**：在翻译前去重，避免不必要的翻译和 TTS 处理
3. **统一处理**：在节点端统一处理所有 utterance 的去重逻辑

**实现位置**：
- Aggregator 机制（节点端）
- 参考：`electron_node/docs/AGGREGATOR/AGGREGATOR_TEXT_INCOMPLETENESS_LANGUAGE_GATE_DESIGN.md`

**ASR 服务端职责**：
- ✅ Step 9.2：单个 utterance 内部去重（保留）
- ❌ Step 9.3：跨 utterance 去重（已移除，由 Aggregator 处理）

**历史推荐**（已废弃）：
- 方案 1（ASR 服务端去重）- 已移除
- 方案 2（调度服务器端去重）- 未实现

---

## 验证

### 测试场景

1. **场景 1：完全重复**
   ```