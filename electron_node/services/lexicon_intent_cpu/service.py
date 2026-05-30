# -*- coding: utf-8 -*-
"""Lexicon V2 CPU Intent Service — async domain inference (CPU-only)."""

import io
import sys
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from config import Config
from intent_engine import LexiconIntentEngine
from prompt_templates import IntentPromptTemplate

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=False)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=False)

config = Config()
engine: Optional[LexiconIntentEngine] = None
_warmup_done = False
_inference_count = 0
_last_inference_ms = 0


class TurnInput(BaseModel):
    turnId: str
    rawAsrText: str = ""
    finalText: str = ""
    activeProfileAtTurn: str = "general"
    recoverStats: dict[str, Any] = Field(default_factory=dict)


class RegistryDomain(BaseModel):
    id: str
    displayName: str = ""
    enabled: bool = True
    allowLLMSelect: bool = True


class IntentRequest(BaseModel):
    sessionId: str
    currentPrimary: str = "general"
    finalizedTurnCount: int = 0
    turns: list[TurnInput] = Field(default_factory=list)
    allowedDomains: list[RegistryDomain] = Field(default_factory=list)
    promptPackVersion: str = "v1"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global engine
    try:
        engine = LexiconIntentEngine(config)
        print("[LexiconIntent] Service ready (CPU-only)", flush=True)
    except Exception as exc:
        print(f"[LexiconIntent] Engine init failed: {exc}", flush=True)
        engine = None
    yield
    engine = None


app = FastAPI(title="Lexicon Intent CPU", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok" if engine and engine.model_loaded else "degraded",
        "model_loaded": bool(engine and engine.model_loaded),
        "gpu_layers": config.n_gpu_layers,
        "prompt_pack_version": IntentPromptTemplate.PROMPT_PACK_VERSION,
        "warmup_done": _warmup_done,
        "inference_count": _inference_count,
        "last_inference_ms": _last_inference_ms,
    }


@app.post("/intent")
def infer_intent(req: IntentRequest):
    if engine is None or not engine.model_loaded:
        raise HTTPException(status_code=503, detail="Lexicon intent engine not loaded")

    allowed = [d.model_dump() for d in req.allowedDomains if d.enabled and d.allowLLMSelect]
    if not allowed:
        raise HTTPException(status_code=400, detail="No allowed domains in registry")

    payload = {
        "sessionId": req.sessionId,
        "currentPrimary": req.currentPrimary,
        "finalizedTurnCount": req.finalizedTurnCount,
        "turns": [t.model_dump() for t in req.turns[-20:]],
    }

    global _warmup_done, _inference_count, _last_inference_ms
    started = time.time()
    try:
        decision = engine.infer(payload, allowed)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Inference failed: {exc}") from exc
    elapsed_ms = int((time.time() - started) * 1000)
    _inference_count += 1
    _last_inference_ms = elapsed_ms
    _warmup_done = True

    return {"decision": decision, "promptPackVersion": req.promptPackVersion}


if __name__ == "__main__":
    uvicorn.run(app, host=config.host, port=config.port, log_level="info")
