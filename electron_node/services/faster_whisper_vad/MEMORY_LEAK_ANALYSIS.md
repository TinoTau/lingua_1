# ASR服务内存泄漏风险分析报告
生成时间: 2026-01-20

## 🚨 高风险项（需立即修复）

### 1. **pending_results 字典未清理 (asr_worker_manager.py)**
**位置**: `asr_worker_manager.py:76, 305-371`

**问题**:
- `pending_results: Dict[str, asyncio.Future]` 在超时场景下虽然会 `pop`，但在某些异常路径可能未清理
- 如果Future从未被set/cancel，Future对象会持续占用内存

**代码**:
```python
# Line 305: 创建Future
self.pending_results[job_id] = future

# Line 366: 超时清理
self.pending_results.pop(job_id, None)  # ✅ 有清理

# Line 375: 异常清理
self.pending_results.pop(job_id, None)  # ✅ 有清理
```

**风险等级**: 🟡 中等（代码已有清理逻辑，但需确认所有异常路径）

**建议**:
- 在Worker重启时，清理所有pending_results
- 在shutdown时，取消所有未完成的Future

**修复代码**:
```python
# 在 _start_worker 之前添加：
async def _start_worker(self):
    # 清理旧的pending_results
    for job_id, future in list(self.pending_results.items()):
        if not future.done():
            future.set_exception(RuntimeError("Worker restarted"))
    self.pending_results.clear()
    
    # ... 原有代码
```

---

### 2. **全局上下文缓冲区无限增长 (context.py)**
**位置**: `context.py:23, 38-72`

**问题**:
- `context_buffer: List[float]` 和 `text_context_cache: List[str]` 是全局变量
- 虽然有长度限制（`CONTEXT_MAX_SAMPLES`），但多会话场景下**没有隔离**
- 所有会话共享同一个缓冲区，会导致上下文混乱和内存累积

**代码**:
```python
# 全局变量（所有会话共享）
context_buffer: List[float] = []  # ⚠️ 无会话隔离
text_context_cache: List[str] = []  # ⚠️ 无会话隔离
```

**风险等级**: 🔴 高（多会话场景下会混乱）

**建议**:
- 改为会话级别的上下文管理（使用session_id作为key）
- 实现会话过期清理机制

**修复代码**:
```python
# 改为字典存储，按session_id隔离
from typing import Dict
import time

class SessionContext:
    def __init__(self):
        self.audio_buffer: List[float] = []
        self.text_cache: List[str] = []
        self.last_access_time = time.time()

# 全局会话字典
_session_contexts: Dict[str, SessionContext] = {}
_session_contexts_lock = threading.Lock()

def get_session_context(session_id: str) -> SessionContext:
    with _session_contexts_lock:
        if session_id not in _session_contexts:
            _session_contexts[session_id] = SessionContext()
        ctx = _session_contexts[session_id]
        ctx.last_access_time = time.time()
        return ctx

def cleanup_expired_sessions(max_age_seconds: float = 3600):
    """清理超过1小时未使用的会话"""
    with _session_contexts_lock:
        now = time.time()
        expired = [
            sid for sid, ctx in _session_contexts.items()
            if now - ctx.last_access_time > max_age_seconds
        ]
        for sid in expired:
            del _session_contexts[sid]
        if expired:
            logger.info(f"Cleaned up {len(expired)} expired sessions")
```

---

### 3. **VAD状态的frame_buffer无限制 (vad.py)**
**位置**: `vad.py:32, 49`

**问题**:
- `self.frame_buffer: List[float] = []` 在某些VAD状态下可能持续累积
- 虽然有 `.clear()`，但只在reset时调用

**代码**:
```python
class VADState:
    def __init__(self):
        self.frame_buffer: List[float] = []  # ⚠️ 无大小限制
        
    def reset(self):
        self.frame_buffer.clear()  # 只在手动reset时清理
```

**风险等级**: 🟡 中等

**建议**:
- 添加frame_buffer的最大长度限制
- 定期清理或使用deque替代list

**修复代码**:
```python
from collections import deque

class VADState:
    def __init__(self):
        # 使用deque限制最大长度（例如保留最近1000帧）
        self.frame_buffer = deque(maxlen=1000)
```

---

### 4. **Worker进程segments转换性能问题 (asr_worker_process.py)**
**位置**: `asr_worker_process.py:216`

**问题**:
- `list(segments)` 转换耗时随音频长度线性增长（观察到24秒音频需要40秒转换）
- 这不是内存泄漏，但会导致任务堆积和内存压力

**代码**:
```python
# Line 216: 可能非常慢
segments_list = list(segments)  # ⚠️ 性能瓶颈
```

**风险等级**: 🔴 高（导致超时和资源堆积）

**根本原因**:
- `faster-whisper` 的 segments 是生成器，转换为list时会同步解码所有segments
- 可能的原因：
  1. ONNX Runtime版本不匹配或配置不当
  2. CUDA内存碎片化
  3. Worker进程状态累积

**建议**:
1. **立即重启服务**（最快解决方案）
2. 添加segments转换超时保护
3. 考虑增量处理segments（不全部转list）

**修复代码**:
```python
import asyncio
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# 在主循环外创建线程池
_thread_pool = ThreadPoolExecutor(max_workers=1)

# 在list(segments)处修改：
list_start = time.time()
segments_list = []

# 方案1: 添加超时保护
try:
    # 使用线程池+超时（45秒超时）
    future = _thread_pool.submit(list, segments)
    segments_list = future.result(timeout=45.0)
    logger.info(
        f"[{trace_id}] ASR Worker: Converted segments to list "
        f"(took {time.time() - list_start:.3f}s, count={len(segments_list)})"
    )
except FuturesTimeoutError:
    logger.error(
        f"[{trace_id}] ASR Worker: Segments conversion timeout (>45s), "
        f"this indicates a serious performance issue. Skipping this task."
    )
    result_queue.put({
        "job_id": job_id,
        "error": "Segments conversion timeout (performance issue)",
        "text": None,
        "language": None,
        "segments": None,
        "duration_ms": 0
    })
    continue
except Exception as e:
    logger.error(
        f"[{trace_id}] ASR Worker: Failed to convert segments to list: {e}",
        exc_info=True
    )
    result_queue.put({
        "job_id": job_id,
        "error": f"Segments conversion failed: {str(e)}",
        "text": None,
        "language": None,
        "segments": None,
        "duration_ms": 0
    })
    continue

# 方案2: 增量处理（不等待全部完成）
# 注意：需要修改返回格式为流式
```

---

## 🟡 中风险项

### 5. **音频数据序列化开销 (asr_worker_manager.py)**
**位置**: `asr_worker_manager.py:279`

**问题**:
- 每次任务都会 `pickle.dumps(audio)` 序列化整个音频数组
- 大音频会导致序列化开销和内存峰值

**代码**:
```python
# Line 279: 每次都序列化
audio_bytes = pickle.dumps(audio)  # ⚠️ 大音频开销高
```

**风险等级**: 🟡 中等

**建议**:
- 对于超大音频（>10MB），考虑使用共享内存
- 或者分块处理

---

### 6. **任务队列大小限制 (asr_worker_manager.py)**
**位置**: `asr_worker_manager.py:24, 100`

**问题**:
- `QUEUE_MAX = 1` 队列只能容纳1个任务
- 如果worker处理慢，会导致新任务被拒绝
- 但这也限制了内存累积（双刃剑）

**代码**:
```python
QUEUE_MAX = 1  # ⚠️ 队列只有1个位置
```

**风险等级**: 🟢 低（反而限制了内存增长）

**建议**:
- 当前设置合理，无需修改
- 如果需要增加队列大小，需要同时增加超时保护

---

### 7. **result_queue 无大小限制 (asr_worker_manager.py)**
**位置**: `asr_worker_manager.py:101`

**问题**:
- `self.result_queue = mp.Queue()` 没有maxsize限制
- 如果result_listener处理慢，结果会堆积

**代码**:
```python
self.result_queue = mp.Queue()  # ⚠️ 无大小限制
```

**风险等级**: 🟡 中等

**建议**:
```python
self.result_queue = mp.Queue(maxsize=10)  # 限制最多10个结果堆积
```

---

## 🟢 低风险项（当前可接受）

### 8. **全局VAD状态 (vad.py:56)**
- 单例模式，内存固定，低风险

### 9. **全局模型加载 (models.py)**
- 模型只加载一次，低风险

### 10. **统计信息字典 (asr_worker_manager.py:65)**
- 固定字段，低风险

---

## 📋 推荐修复优先级

### P0 - 立即处理（本次导致问题的根源）
1. ✅ **清理残留进程**（已完成）
2. ⚠️ **重启ASR服务**（解决segments转换慢的问题）
3. 🔧 **添加segments转换超时保护**（防止再次超时）

### P1 - 短期修复（1-2天内）
1. 实现会话级上下文管理（解决多会话混乱）
2. 添加pending_results在worker重启时的清理
3. 限制result_queue大小

### P2 - 中期优化（1周内）
1. 实现会话过期清理机制
2. 优化segments处理（考虑增量处理）
3. 添加内存监控和自动重启机制

---

## 🛠️ 立即可执行的修复脚本

### 修复1: 清理pending_results（添加到asr_worker_manager.py）

```python
# 在 _start_worker 开头添加：
async def _start_worker(self):
    # ===== 新增：清理旧的pending_results =====
    if self.pending_results:
        logger.warning(
            f"Clearing {len(self.pending_results)} pending results before worker restart"
        )
        for job_id, future in list(self.pending_results.items()):
            if not future.done():
                try:
                    future.set_exception(RuntimeError("Worker process restarted"))
                except Exception as e:
                    logger.warning(f"Failed to cancel future for {job_id}: {e}")
        self.pending_results.clear()
    # ===== 新增结束 =====
    
    if self.worker_process and self.worker_process.is_alive():
        logger.warning("Worker process is already running")
        return self.worker_process
    # ... 原有代码
```

### 修复2: 添加segments转换超时（修改asr_worker_process.py）

见上文"修复4"的详细代码。

---

## 📊 内存监控建议

建议添加定期内存监控：

```python
import psutil
import os

def log_memory_usage():
    process = psutil.Process(os.getpid())
    mem_info = process.memory_info()
    logger.info(
        f"Memory: RSS={mem_info.rss / 1024 / 1024:.2f}MB, "
        f"VMS={mem_info.vms / 1024 / 1024:.2f}MB"
    )

# 在worker主循环中每处理10个任务后调用
if task_count % 10 == 0:
    log_memory_usage()
```

---

## ✅ 总结

**本次问题根源**:
- segments转换性能异常（非内存泄漏，但导致资源堆积）
- 可能是worker进程状态累积或CUDA上下文问题

**内存泄漏风险**:
- 主要风险：全局上下文缓冲区无会话隔离
- 次要风险：pending_results在异常路径的清理
- 性能问题：segments转换慢导致任务超时

**立即行动**:
1. 重启ASR服务
2. 应用"修复2"添加超时保护
3. 监控新测试的性能表现
