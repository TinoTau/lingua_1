# -*- coding: utf-8 -*-
"""中文同音纠错服务：KenLM + 同音混淆集，HTTP API。混淆集仅简体，入口先繁→简再纠错。"""

import os
import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from config import SERVICE_DIR, get_host, get_port, get_model_path
from core import phonetic_correct

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [Phonetic] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# 默认参数（与 rescore 一致）
DEFAULT_MAX_POSITIONS = 2
DEFAULT_MAX_CANDIDATES = 24
DEFAULT_DELTA = 1.0

_opencc_t2s = None


def _to_simplified(text: str) -> str:
    """若已安装 opencc，将繁体转为简体；否则返回原文。同音混淆集仅简体，入口统一转简体。"""
    if not text or not text.strip():
        return text
    global _opencc_t2s
    if _opencc_t2s is None:
        try:
            from opencc import OpenCC
            _opencc_t2s = OpenCC("t2s")
        except Exception as e:
            logger.debug("OpenCC not available, skipping t2s: %s", e)
            _opencc_t2s = False
    if _opencc_t2s is False:
        return text
    try:
        return _opencc_t2s.convert(text)
    except Exception as e:
        logger.warning("OpenCC t2s failed, using original: %s", e)
        return text


class CorrectRequest(BaseModel):
    text_in: str
    lang: str | None = None  # 'zh' | 'en'，英文时直通不纠错


class CorrectResponse(BaseModel):
    text_out: str
    process_time_ms: float


@asynccontextmanager
async def lifespan(app: FastAPI):
    model_path = get_model_path()
    if model_path:
        logger.info("KenLM model: %s", model_path)
    else:
        logger.warning("KenLM model not found; correction will return original text.")
    yield
    logger.info("Shutdown complete.")


app = FastAPI(title="Phonetic Correction ZH", lifespan=lifespan)


@app.get("/health")
def health():
    """健康检查：有模型则为 healthy，否则 degraded。"""
    model_path = get_model_path()
    status = "healthy" if model_path and os.path.isfile(model_path) else "degraded"
    return {"status": status, "model_loaded": model_path is not None}


@app.post("/correct", response_model=CorrectResponse)
def correct(req: CorrectRequest):
    """同音纠错：中文先繁→简再走 KenLM+混淆集；英文直通。"""
    t0 = time.perf_counter()
    text_in = req.text_in or ""
    lang = (req.lang or "zh").strip().lower()
    if lang == "en":
        text_out = text_in
    else:
        text_for_correct = _to_simplified(text_in)
        text_out = phonetic_correct(
            text_for_correct,
            SERVICE_DIR,
            max_positions=DEFAULT_MAX_POSITIONS,
            max_candidates=DEFAULT_MAX_CANDIDATES,
            delta=DEFAULT_DELTA,
        )
    process_time_ms = (time.perf_counter() - t0) * 1000
    return CorrectResponse(text_out=text_out, process_time_ms=round(process_time_ms, 2))


if __name__ == "__main__":
    import uvicorn
    host = get_host()
    port = get_port()
    logger.info("Starting on %s:%s", host, port)
    uvicorn.run(app, host=host, port=port)
