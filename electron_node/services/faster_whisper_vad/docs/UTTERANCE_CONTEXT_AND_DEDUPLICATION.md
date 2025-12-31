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

**状态更新**：⚠️ **已迁移到 Aggregator 层**

**说明**：
- 跨 utterance 去重功能已从 ASR 服务端移除（Step 9.3）
- 现在由 Aggregator 机制在节点端统一处理跨 utterance 的文本去重（dedup 功能）
- 这样可以避免重复处理，职责更清晰，在翻译前去重，性能更好

**当前实现**：
```python
# 在 process_utterance 中
# Step 9.2: 单个 utterance 内去重（保留）
full_text_trimmed = deduplicate_text(full_text_trimmed, trace_id=trace_id)

# Step 9.3: 跨 utterance 去重（已移除）
# 注意：跨 utterance 去重已迁移到 Aggregator 层（节点端）
```

**保留内容**：
- ✅ Step 9.2：单个 utterance 内部去重（`deduplicate_text`）- **保留**
- ✅ `get_text_context()` 函数 - **保留**（可能用于其他用途）
- ✅ `use_text_context` 参数 - **保留**（可能用于其他用途）

**历史方案**（已废弃）：

#### 方案 1: ASR 服务端去重（已移除）

**位置**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**状态**: ❌ **已移除**（Step 9.3）

**移除原因**：
- Aggregator 会在节点端统一处理跨 utterance 的文本去重（dedup 功能）
- 避免重复处理，职责更清晰
- 在翻译前去重，性能更好

---

#### 方案 2: 调度服务器端去重（未实现）

**位置**: `central_server/scheduler/src/websocket/node_handler/message/job_result.rs`

**状态**: ❌ **未实现**

**实现**（仅供参考）：
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

---

## 验证

### 测试场景

1. **场景 1：完全重复**
   ```
   Utterance 1: "然后总是出现一些结果互完占的提示位置"
   Utterance 2: "然后总是出现一些结果互完占的提示位置"
   ```
   **期望**：Utterance 2 返回空结果

2. **场景 2：部分重复**
   ```
   Utterance 1: "然后总是出现一些结果互完占的提示位置"
   Utterance 2: "然后总是出现一些结果互完占的提示位置，我也发现web端播放的语音会有被截断的内容"
   ```
   **期望**：Utterance 2 返回 "我也发现web端播放的语音会有被截断的内容"

3. **场景 3：开头重复**
   ```
   Utterance 1: "然后总是出现一些结果互完占的提示位置"
   Utterance 2: "然后评并调整"
   ```
   **期望**：Utterance 2 返回 "评并调整"（移除开头的"然后"）

---

## 总结

### 确认的工作流程

1. ✅ **调度服务器将 audio_chunk 通过 finalize 拼接成 utterance**
2. ✅ **utterance 作为完整的短句发送给节点端**
3. ✅ **节点端以 utterance 为单位进行 ASR 处理**
4. ✅ **ASR 服务使用上一个 utterance 的文本和音频作为上下文**

### 跨 Utterance 去重

- ✅ **可以进行跨 utterance 去重**
- ✅ **推荐在 ASR 服务端实现**（利用已有的文本上下文机制）
- ✅ **可以访问上一个 utterance 的文本，便于检测重复**

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/ISSUE_STATUS_REPORT.md` - 问题状态报告
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md` - 音频截断和ASR识别质量问题

