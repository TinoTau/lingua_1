
# ASR 多进程 Worker + 自动拉起示例

## 1. 为什么需要多进程

- 原生 ASR 库崩溃无法捕获
- 进程隔离可防止服务整体不可用

---

## 2. 架构

```
Main Process
 ├─ Request Queue
 ├─ Monitor Loop
 └─ ASR Worker Process
        └─ ASR Model
```

---

## 3. 示例代码（Python）

```python
import multiprocessing as mp
import time
import os

def asr_worker(task_q, result_q):
    # model = load_asr_model()
    while True:
        audio = task_q.get()
        if audio is None:
            break
        time.sleep(1.2)
        result_q.put("transcription result")

if __name__ == "__main__":
    task_q = mp.Queue(maxsize=3)
    result_q = mp.Queue()

    def start_worker():
        p = mp.Process(target=asr_worker, args=(task_q, result_q))
        p.start()
        return p

    worker = start_worker()

    while True:
        if not worker.is_alive():
            print("Worker crashed, restarting...")
            worker = start_worker()
        time.sleep(1)
```

---

## 4. 实践建议

- 单 GPU → 单 worker
- 崩溃自动恢复 < 1s
