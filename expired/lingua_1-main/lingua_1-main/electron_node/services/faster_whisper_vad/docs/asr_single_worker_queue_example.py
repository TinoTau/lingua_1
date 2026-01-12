
"""
asr_single_worker_queue_example.py

示例：ASR 单工人 + 有界队列 + 背压控制
（FastAPI 风格示意，便于直接套用）
"""

import time
import threading
from queue import Queue, Full, Empty
from typing import Any

QUEUE_MAX = 3
MAX_WAIT_SECONDS = 8.0

class ASRWorker(threading.Thread):
    def __init__(self, queue: Queue):
        super().__init__(daemon=True)
        self.queue = queue

    def transcribe(self, audio: bytes) -> str:
        time.sleep(1.2)
        return "transcription result"

    def run(self):
        while True:
            try:
                audio, result = self.queue.get(timeout=0.5)
            except Empty:
                continue
            try:
                result["text"] = self.transcribe(audio)
            except Exception as e:
                result["error"] = str(e)
            finally:
                result["done"] = True
                self.queue.task_done()

job_queue = Queue(maxsize=QUEUE_MAX)
worker = ASRWorker(job_queue)
worker.start()

def handle_request(audio: bytes) -> dict[str, Any]:
    result = {"done": False}
    try:
        job_queue.put_nowait((audio, result))
    except Full:
        return {"status": 503, "message": "ASR busy", "retry_after": 1.0}

    start = time.time()
    while not result["done"]:
        if time.time() - start > MAX_WAIT_SECONDS:
            return {"status": 504, "message": "ASR timeout"}
        time.sleep(0.01)

    if "error" in result:
        return {"status": 500, "message": result["error"]}

    return {"status": 200, "text": result["text"]}

if __name__ == "__main__":
    print(handle_request(b"fake audio"))
