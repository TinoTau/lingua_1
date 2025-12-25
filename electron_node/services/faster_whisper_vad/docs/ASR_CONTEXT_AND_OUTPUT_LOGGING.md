# ASR 上下文和接口输出结果日志增强

**日期**: 2025-12-25  
**状态**: ✅ **已添加**

---

## 问题描述

用户要求：
1. **确认节点端语音识别的上下文端口有没有日志**
2. **能否将每一次识别的上下文，以及接口输出结果打印出来**
3. **看一下到底是上下文参数不对，还是接口输出结果不对**

---

## 修复方案

### 1. 添加 ASR 识别请求开始日志

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**添加内容**：
```python
logger.info(f"[{trace_id}] ========== ASR 识别请求开始 ==========")
logger.info(
    f"[{trace_id}] ASR 参数: "
    f"language={asr_language}, "
    f"task={req.task}, "
    f"beam_size={req.beam_size}, "
    f"condition_on_previous_text={req.condition_on_previous_text}, "
    f"queue_depth={stats['queue_depth']}, "
    f"worker_state={stats['worker_state']}"
)
logger.info(
    f"[{trace_id}] ASR 上下文参数: "
    f"has_initial_prompt={text_context is not None and len(text_context) > 0}, "
    f"initial_prompt_length={len(text_context) if text_context else 0}, "
    f"initial_prompt_preview='{text_context[:100] if text_context else '(None)'}'"
)
logger.info(
    f"[{trace_id}] ASR 音频参数: "
    f"audio_len={len(processed_audio)}, "
    f"sample_rate={sr}, "
    f"duration_sec={len(processed_audio) / sr:.2f}"
)
```

**作用**：
- 记录 ASR 识别请求的所有参数
- 记录上下文参数（`initial_prompt`）的详细信息
- 记录音频参数（长度、采样率、时长）

---

### 2. 添加 ASR Worker transcribe() 调用日志

**文件**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`

**添加内容**：
```python
logger.info(f"[{trace_id}] ========== ASR Worker transcribe() 调用 ==========")
logger.info(
    f"[{trace_id}] transcribe() 参数: "
    f"language={task.get('language')}, "
    f"task={task.get('task', 'transcribe')}, "
    f"beam_size={task.get('beam_size', 5)}, "
    f"vad_filter=False, "
    f"has_initial_prompt={initial_prompt is not None and len(initial_prompt) > 0}, "
    f"initial_prompt_length={len(initial_prompt) if initial_prompt else 0}, "
    f"initial_prompt_preview='{initial_prompt[:100] if initial_prompt else '(None)'}', "
    f"condition_on_previous_text={condition_on_previous_text}"
)
logger.info(
    f"[{trace_id}] transcribe() 音频参数: "
    f"audio_len={len(audio)}, "
    f"sample_rate={task.get('sample_rate', 16000)}, "
    f"duration_sec={len(audio) / task.get('sample_rate', 16000):.2f}"
)
```

**作用**：
- 记录 ASR Worker 进程中的 `transcribe()` 调用参数
- 记录传递给 Faster Whisper 的上下文参数
- 记录音频参数

---

### 3. 添加 ASR Worker transcribe() 输出结果日志

**文件**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`

**添加内容**：
```python
logger.info(f"[{trace_id}] ========== ASR Worker transcribe() 输出结果 ==========")
logger.info(
    f"[{trace_id}] ASR Worker: Task completed successfully, "
    f"text_len={len(full_text)}, language={detected_language}, "
    f"duration_ms={duration_ms}"
)
logger.info(
    f"[{trace_id}] ASR Worker 输出原始文本 (repr): {repr(full_text)}"
)
logger.info(
    f"[{trace_id}] ASR Worker 输出原始文本 (preview): '{full_text[:200]}'"
)
logger.info(
    f"[{trace_id}] ASR Worker 输出原始文本 (bytes): {full_text.encode('utf-8') if full_text else b''}"
)
logger.info(
    f"[{trace_id}] ASR Worker segments 详情: count={len(segments_list)}, "
    f"segments_texts={[seg.text[:50] if hasattr(seg, 'text') else str(seg)[:50] for seg in segments_list[:5]]}"
)
```

**作用**：
- 记录 ASR Worker 进程中的 `transcribe()` 输出结果
- 记录原始文本的多种表示形式（repr、preview、bytes）
- 记录 segments 详情

---

### 4. 添加 ASR 接口输出结果日志

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**添加内容**：
```python
logger.info(f"[{trace_id}] ========== ASR 接口输出结果 ==========")
logger.info(
    f"[{trace_id}] ASR Worker completed successfully, "
    f"text_len={len(full_text)}, language={detected_language}, "
    f"duration_ms={asr_result.duration_ms}"
)
logger.info(
    f"[{trace_id}] ASR 接口输出原始文本 (repr): {repr(full_text)}"
)
logger.info(
    f"[{trace_id}] ASR 接口输出原始文本 (preview): '{full_text[:200]}'"
)
logger.info(
    f"[{trace_id}] ASR 接口输出原始文本 (bytes): {full_text.encode('utf-8') if full_text else b''}"
)
```

**作用**：
- 记录 ASR 接口返回的最终结果
- 记录原始文本的多种表示形式（repr、preview、bytes）
- 便于诊断编码问题

---

## 日志输出示例

### ASR 识别请求开始
```
[trace_id] ========== ASR 识别请求开始 ==========
[trace_id] ASR 参数: language=zh, task=transcribe, beam_size=5, condition_on_previous_text=False, queue_depth=0, worker_state=running
[trace_id] ASR 上下文参数: has_initial_prompt=True, initial_prompt_length=15, initial_prompt_preview='我继续说的话'
[trace_id] ASR 音频参数: audio_len=38400, sample_rate=16000, duration_sec=2.40
```

### ASR Worker transcribe() 调用
```
[trace_id] ========== ASR Worker transcribe() 调用 ==========
[trace_id] transcribe() 参数: language=zh, task=transcribe, beam_size=5, vad_filter=False, has_initial_prompt=True, initial_prompt_length=15, initial_prompt_preview='我继续说的话', condition_on_previous_text=False
[trace_id] transcribe() 音频参数: audio_len=38400, sample_rate=16000, duration_sec=2.40
```

### ASR Worker transcribe() 输出结果
```
[trace_id] ========== ASR Worker transcribe() 输出结果 ==========
[trace_id] ASR Worker: Task completed successfully, text_len=15, language=zh, duration_ms=2400
[trace_id] ASR Worker 输出原始文本 (repr): '我继续说的话'
[trace_id] ASR Worker 输出原始文本 (preview): '我继续说的话'
[trace_id] ASR Worker 输出原始文本 (bytes): b'\xe6\x88\x91\xe7\xbb\xa7\xe7\xbb\xad\xe8\xaf\xb4\xe7\x9a\x84\xe8\xaf\x9d'
[trace_id] ASR Worker segments 详情: count=1, segments_texts=['我继续说的话']
```

### ASR 接口输出结果
```
[trace_id] ========== ASR 接口输出结果 ==========
[trace_id] ASR Worker completed successfully, text_len=15, language=zh, duration_ms=2400
[trace_id] ASR 接口输出原始文本 (repr): '我继续说的话'
[trace_id] ASR 接口输出原始文本 (preview): '我继续说的话'
[trace_id] ASR 接口输出原始文本 (bytes): b'\xe6\x88\x91\xe7\xbb\xa7\xe7\xbb\xad\xe8\xaf\xb4\xe7\x9a\x84\xe8\xaf\x9d'
```

---

## 编码检查

### 1. 日志文件编码 ✅

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**设置**：
```python
logging.FileHandler(os.path.join(log_dir, 'faster-whisper-vad-service.log'), encoding='utf-8')
```

**状态**: ✅ 已确认使用 UTF-8 编码

---

### 2. Web 端编码 ✅

**检查结果**：
- Web 端使用 JavaScript/TypeScript，默认使用 UTF-8 编码
- JSON 传输使用 UTF-8 编码
- 没有发现编码问题

**状态**: ✅ 无编码问题

---

### 3. HTTP 响应编码 ✅

**FastAPI 默认行为**：
- FastAPI 默认使用 UTF-8 编码
- JSON 响应自动使用 UTF-8 编码
- 响应头中的 `Content-Type` 包含 `application/json; charset=utf-8`

**状态**: ✅ 使用 UTF-8 编码

---

## 诊断建议

### 1. 检查上下文参数

**查看日志**：
```bash
# 查看 ASR 上下文参数
grep "ASR 上下文参数" faster-whisper-vad-service.log
```

**检查点**：
- `has_initial_prompt` 是否为 `True`
- `initial_prompt_preview` 的内容是否正确
- `initial_prompt_length` 是否合理

---

### 2. 检查接口输出结果

**查看日志**：
```bash
# 查看 ASR 接口输出结果
grep "ASR 接口输出结果" faster-whisper-vad-service.log
```

**检查点**：
- `ASR 接口输出原始文本 (repr)` 是否正确
- `ASR 接口输出原始文本 (bytes)` 是否为有效的 UTF-8 编码
- 如果 `repr` 显示乱码，可能是日志显示问题（Windows PowerShell 使用 GBK 编码读取 UTF-8 日志）

---

### 3. 检查 ASR Worker 输出

**查看日志**：
```bash
# 查看 ASR Worker 输出结果
grep "ASR Worker transcribe() 输出结果" faster-whisper-vad-service.log
```

**检查点**：
- `ASR Worker 输出原始文本 (repr)` 是否正确
- 如果 Worker 输出正确，但接口输出错误，可能是文本传递过程中的问题
- 如果 Worker 输出错误，可能是 Faster Whisper 识别问题

---

## 相关文档

- `TEXT_DISPLAY_AND_ASR_QUALITY_ISSUES.md` - 文本显示和ASR识别质量问题
- `RESULT_QUEUE_AND_ASR_ENCODING_ISSUES.md` - 结果队列和ASR编码问题

