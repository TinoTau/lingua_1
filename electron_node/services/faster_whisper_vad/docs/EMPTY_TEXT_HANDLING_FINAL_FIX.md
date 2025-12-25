# 空文本处理最终修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 用户需求

**如果调度服务器需要验证job_id或者trace_id，那就让节点端发回空消息，但是不应该继续发给web端，或者即使发给web端也不能进入待播放缓存区**

---

## 修复方案

### 1. 节点端：发送空文本job_result ✅

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

**修复逻辑**:
- 当ASR结果为空时，**仍然发送job_result**给调度服务器
- 包含空文本（`text_asr=""`, `text_translated=""`, `tts_audio=""`）
- 包含完整的`job_id`和`trace_id`，满足调度服务器的验证需求
- 记录警告日志，标记为"静音检测"

**代码变更**:
```typescript
// 检查ASR结果是否为空
const asrTextTrimmed = (result.text_asr || '').trim();
const isEmpty = !asrTextTrimmed || asrTextTrimmed.length === 0;

if (isEmpty) {
  logger.warn(
    { jobId: job.job_id, traceId: job.trace_id },
    'ASR result is empty (silence detected), sending empty job_result for job_id/trace_id verification'
  );
} else {
  logger.info({ jobId: job.job_id, textAsr: result.text_asr?.substring(0, 50), textTranslated: result.text_translated?.substring(0, 50) }, 'Job processing completed successfully');
}

// 无论是否为空，都发送job_result（包含job_id和trace_id）
const response: JobResultMessage = {
  type: 'job_result',
  job_id: job.job_id,
  attempt_id: job.attempt_id,
  node_id: this.nodeId,
  session_id: job.session_id,
  utterance_index: job.utterance_index,
  success: true,
  text_asr: result.text_asr,  // 可能为空
  text_translated: result.text_translated,  // 可能为空
  tts_audio: result.tts_audio,  // 可能为空
  // ...
};
```

---

### 2. 调度服务器：不转发空文本结果 ✅

**文件**: `central_server/scheduler/src/websocket/node_handler/message/job_result.rs`

**修复逻辑**:
- 检查`text_asr`、`text_translated`和`tts_audio`是否都为空
- 如果都为空，**不转发给Web端**
- 但结果已记录到`result_queue`，满足`job_id`/`trace_id`验证需求
- 记录警告日志，标记为"静音检测"

**代码变更**:
```rust
// 检查结果是否为空（空文本不应该转发给Web端）
let should_skip = if let SessionMessage::TranslationResult { text_asr, text_translated, tts_audio, .. } = &result {
    let asr_empty = text_asr.trim().is_empty();
    let translated_empty = text_translated.trim().is_empty();
    let tts_empty = tts_audio.is_empty();
    
    // 如果ASR、翻译和TTS都为空，跳过转发（但已记录到result_queue，满足job_id/trace_id验证）
    if asr_empty && translated_empty && tts_empty {
        warn!(
            trace_id = %trace_id,
            session_id = %session_id,
            job_id = %job_id,
            "Skipping empty translation result (silence detected), not forwarding to web client"
        );
        true
    } else {
        false
    }
} else {
    false
};

if should_skip {
    continue;  // 跳过转发，但结果已记录到result_queue
}
```

---

### 3. Web端：不缓存空文本结果 ✅

**文件**: `webapp/web-client/src/app.ts`

**修复逻辑**:
- 检查`text_asr`、`text_translated`和`tts_audio`是否都为空
- 如果都为空，**不缓存到`pendingTranslationResults`**
- **不添加到TTS播放缓存区**
- 记录日志，标记为"静音检测"

**代码变更**:
```typescript
// 检查结果是否为空（空文本不应该进入待播放缓存区）
const asrEmpty = !message.text_asr || message.text_asr.trim() === '';
const translatedEmpty = !message.text_translated || message.text_translated.trim() === '';
const ttsEmpty = !message.tts_audio || message.tts_audio.length === 0;

if (asrEmpty && translatedEmpty && ttsEmpty) {
  console.log('[App] 收到空文本结果（静音检测），跳过缓存和播放:', {
    trace_id: message.trace_id,
    job_id: message.job_id
  });
  // 不缓存，不播放，直接返回
  return;
}
```

---

## 修复流程

### 正常流程（有文本）

```
节点端 → ASR返回文本 → 发送job_result（包含文本）
       ↓
调度服务器 → 检查文本不为空 → 转发给Web端
       ↓
Web端 → 检查文本不为空 → 缓存到pendingTranslationResults → 添加到TTS播放缓存区
```

### 空文本流程（静音检测）

```
节点端 → ASR返回空文本 → 发送job_result（包含空文本，但包含job_id/trace_id）✅
       ↓
调度服务器 → 检查文本为空 → 记录到result_queue（满足验证）✅
       ↓
调度服务器 → 跳过转发给Web端 ✅
       ↓
Web端 → 不收到消息（或即使收到也跳过缓存和播放）✅
```

---

## 影响分析

### 正面影响

1. ✅ **调度服务器可以验证job_id/trace_id**：节点端发送了job_result，包含完整的job_id和trace_id
2. ✅ **空文本不会转发给Web端**：调度服务器检查并跳过转发
3. ✅ **Web端不会缓存空文本**：即使收到（防御性检查），也不会缓存或播放
4. ✅ **减少不必要的网络传输**：空文本结果不转发给Web端
5. ✅ **减少Web端处理负担**：空文本不进入播放缓存区

### 防御性检查

- **Web端**：即使调度服务器意外转发了空文本，Web端也会检查并跳过
- **多层防护**：节点端、调度服务器、Web端都有检查，确保空文本不会进入播放流程

---

## 测试建议

1. ✅ **测试空文本场景**：
   - ASR返回空文本
   - 节点端发送job_result（包含空文本和job_id/trace_id）
   - 调度服务器记录到result_queue但不转发
   - Web端不收到消息（或收到后跳过）

2. ✅ **测试正常文本场景**：
   - ASR返回正常文本
   - 节点端发送job_result（包含文本）
   - 调度服务器转发给Web端
   - Web端缓存并添加到播放缓存区

3. ✅ **验证job_id/trace_id验证**：
   - 检查调度服务器的result_queue是否包含空文本结果的记录
   - 验证job_id和trace_id是否正确

---

## 相关文件

- `electron_node/electron-node/main/src/agent/node-agent.ts` - 节点端job处理逻辑
- `central_server/scheduler/src/websocket/node_handler/message/job_result.rs` - 调度服务器job_result处理逻辑
- `webapp/web-client/src/app.ts` - Web端translation_result处理逻辑

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **已修复：节点端发送空文本job_result，调度服务器不转发，Web端不缓存**

