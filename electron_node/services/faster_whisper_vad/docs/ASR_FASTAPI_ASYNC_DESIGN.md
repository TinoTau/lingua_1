
# ASR FastAPI / Async 实现方案

## 1. 设计说明

- FastAPI 负责接入与返回
- ASR 推理仍为 **串行**
- 使用 asyncio.Queue 实现有界背压
- async 接口不等于并发推理

---

## 2. 架构

```
FastAPI Endpoint (async)
   ↓
asyncio.Queue (maxsize=N)
   ↓
ASR Worker Task (single)
   ↓
ASR Model.transcribe()
```

---

## 3. FastAPI Async 示例代码

```python
import asyncio
import time
from fastapi import FastAPI, HTTPException

app = FastAPI()

QUEUE_MAX = 3
MAX_WAIT = 8.0

queue = asyncio.Queue(maxsize=QUEUE_MAX)

async def asr_worker():
    # 初始化 ASR 模型（只一次）
    # model = load_model()
    while True:
        audio, fut = await queue.get()
        try:
            # text = model.transcribe(audio)
            await asyncio.sleep(1.2)  # mock
            fut.set_result("transcription result")
        except Exception as e:
            fut.set_exception(e)
        finally:
            queue.task_done()

@app.on_event("startup")
async def startup():
    asyncio.create_task(asr_worker())

@app.post("/asr")
async def asr_endpoint(audio: bytes):
    if queue.full():
        raise HTTPException(
            status_code=503,
            detail="ASR busy, retry later",
            headers={"Retry-After": "1"}
        )

    fut = asyncio.get_event_loop().create_future()
    await queue.put((audio, fut))

    try:
        return await asyncio.wait_for(fut, timeout=MAX_WAIT)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="ASR timeout")
```

---

## 4. 关键点说明

- **async 不等于并发推理**
- Queue 是系统稳定性的核心
- Busy 比崩溃好
