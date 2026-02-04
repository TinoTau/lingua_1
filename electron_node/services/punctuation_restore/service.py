# -*- coding: utf-8 -*-
"""断句服务：中文/英文标点恢复，GPU 模式。"""

import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from config import get_host, get_port
from core import load_model, punctuate

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [Punctuation] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


class PuncRequest(BaseModel):
    text: str
    lang: str = "zh"


class PuncResponse(BaseModel):
    text: str
    process_time_ms: float


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    logger.info("Model loaded.")
    yield
    logger.info("Shutdown complete.")


app = FastAPI(title="Punctuation Restore", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/punc", response_model=PuncResponse)
def punc(req: PuncRequest):
    t0 = time.perf_counter()
    lang = (req.lang or "zh").strip().lower()
    if lang not in ("zh", "en"):
        lang = "zh"
    text_out = punctuate(req.text or "")
    process_time_ms = (time.perf_counter() - t0) * 1000
    return PuncResponse(text=text_out, process_time_ms=round(process_time_ms, 2))


if __name__ == "__main__":
    import uvicorn

    host = get_host()
    port = get_port()
    logger.info("Starting on %s:%s", host, port)
    uvicorn.run(app, host=host, port=port)
