
# ASR 根治性解决方案技术文档
## 进程隔离 ASR Worker + 自动拉起（无兼容性约束版本）

---

## 0. 文档定位与约束声明

- **定位**：本文件是 ASR 服务的「根治性重构方案（Final Design）」
- **目标问题**：Faster Whisper / CUDA 路径在并发或高压下触发 **segfault（0xC0000005）**
- **结论前提**：
  - Python 层无法捕获 segfault
  - 线程/async 级别隔离不足以保证系统可用性
- **约束声明**：
  - ❌ 不考虑向后兼容
  - ❌ 不考虑线上平滑迁移
  - ✅ 可直接重构代码与架构
  - ✅ 以「系统不崩溃」优先于「单实例吞吐最大化」

---

## 1. 问题根因总结（Why current design must be abandoned）

### 1.1 已确认事实

1. Faster Whisper 的 `segments` 为 **惰性生成器**
2. 真正的计算发生在 `list(segments)` 过程中
3. 该过程进入 C/CUDA 扩展层，可能触发：
   - 内存越界
   - 非线程安全访问
   - GPU context 生命周期问题
4. 一旦发生 segfault：
   - Python try/except **完全无效**
   - 整个进程被操作系统强制终止

### 1.2 结论

> **任何「共享进程」的 ASR 架构都是不安全的。**

---

## 2. 唯一可根治的工程方案

### 2.1 核心原则

> **将所有可能 segfault 的代码，关进一个“可被牺牲的子进程”。**

- 子进程：
  - 独占 ASR 模型
  - 串行执行推理
  - 允许崩溃
- 主进程：
  - 永不直接调用 ASR C 扩展
  - 负责接入、队列、监控、拉起

---

## 3. 最终推荐架构（无兼容性约束）

```
Client
  ↓
FastAPI Ingress (Main Process)
  ├─ 参数校验
  ├─ 有界队列（Backpressure）
  ├─ 超时控制
  └─ Worker Watchdog
        ↓ IPC
ASR Worker Process (Isolated)
  ├─ 模型初始化（一次）
  ├─ 串行 transcribe()
  ├─ 完整迭代 list(segments)
  └─ 返回最终文本
```

---

## 4. 主进程设计（Ingress + Watchdog）

### 4.1 主进程职责

- FastAPI / HTTP / WS 接入
- 请求入队（有界队列）
- Busy / Timeout 响应
- 监控 worker 存活状态
- worker 崩溃后 **自动拉起**
- 永不 import / 调用 Faster Whisper

### 4.2 队列与背压参数（推荐）

| 参数 | 值 |
|----|----|
| ASR worker 数 | 1 |
| 队列长度 | 1–2 |
| 最大等待时间 | 8s |
| Busy 返回 | 503 + Retry-After |
| 超时返回 | 504 |

---

## 5. ASR Worker 子进程设计（核心）

### 5.1 子进程职责

- 在 `__main__` 内初始化模型（避免 fork 污染）
- 串行执行所有 ASR 操作
- 在子进程内完成：
  - `transcribe()`
  - `list(segments)`
  - 文本拼接
- 通过 IPC **只返回纯 Python 数据结构**
- 允许进程被 OS 杀死

### 5.2 严禁事项（非常重要）

- ❌ 不得将 `segments`、model、tokenizer 等对象跨进程返回
- ❌ 不得在主进程 import Faster Whisper
- ❌ 不得多线程调用 ASR

---

## 6. 进程间通信（IPC）设计

### 6.1 推荐方案

- `multiprocessing.Queue`
- 数据结构：
  ```python
  {
    "job_id": "...",
    "audio": <bytes>,
  }
  ```

- 返回：
  ```python
  {
    "job_id": "...",
    "text": "...",
    "language": "en",
    "duration_ms": 5123
  }
  ```

### 6.2 超时与异常处理

- 主进程对每个 job 设定 deadline
- 超时直接返回 504
- worker 即使稍后返回结果也直接丢弃

---

## 7. Watchdog 与自动拉起机制

### 7.1 Watchdog 逻辑

```python
if not worker_process.is_alive():
    log("ASR worker crashed")
    restart_worker()
```

### 7.2 拉起策略

- 崩溃 → 立即拉起新进程
- 拉起期间：
  - 对外返回 Busy
- 可记录：
  - `worker_restart_count`

---

## 8. 示例代码（核心结构）

### 8.1 Worker 进程

```python
def asr_worker(task_q, result_q):
    model = load_faster_whisper_model()

    while True:
        job = task_q.get()
        if job is None:
            break

        audio = job["audio"]
        segments, info = model.transcribe(audio)
        text = " ".join(seg.text for seg in segments)

        result_q.put({
            "job_id": job["job_id"],
            "text": text
        })
```

### 8.2 主进程 Watchdog

```python
def ensure_worker():
    global worker
    if not worker.is_alive():
        worker = start_worker()
```

---

## 9. 为什么这是“根治方案”

| 层级 | 是否可挡 segfault |
|----|----|
| try/except | ❌ |
| async / lock | ❌ |
| 单线程 | ❌ |
| **进程隔离** | ✅ |
| 进程自动拉起 | ✅ |

> **我们不是“避免崩溃”，而是“允许崩溃但不影响系统”。**

---

## 10. 项目重构建议顺序

1. 删除所有旧 ASR 代码路径
2. 新建 `asr_worker_process.py`
3. 主进程完全移除 Faster Whisper 依赖
4. 引入 watchdog + 队列
5. 压测并验证：
   - worker 可反复崩溃
   - 主服务始终存活

---

## 11. 结论（最终决策）

> 在 ASR + CUDA + C 扩展 场景下，  
> **进程隔离不是“优化选项”，而是“架构底线”。**

本方案是当前工程条件下 **唯一可长期稳定运行的设计**。
