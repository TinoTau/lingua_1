"""
ASR Sherpa-LM 服务入口
契约与 asr-sherpa-en / faster-whisper-vad 一致：POST /utterance，PCM16 16kHz base64。
用于 CTC（Omnilingual，可选 KenLM）优化 ASR，与现有 pipeline 通过同一接口通信。
"""
import logging
import os

import uvicorn
from fastapi import FastAPI, HTTPException

from config import PORT
from api_models import UtteranceRequest, UtteranceResponse, SegmentInfo
from audio import decode_pcm16_base64
from recognizer import recognize, is_ready

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="ASR Sherpa-LM Service", version="1.0.0")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": is_ready(),
    }


@app.post("/utterance", response_model=UtteranceResponse)
def utterance(req: UtteranceRequest):
    """接收 base64 PCM16 音频，返回识别结果。文档：final text + metrics（meta.decode_ms）。"""
    sample_rate = req.sample_rate or 16000
    if req.audio_format and req.audio_format != "pcm16":
        raise HTTPException(
            status_code=400,
            detail="Only audio_format=pcm16 is supported",
        )
    try:
        audio_float32, duration_sec = decode_pcm16_base64(req.audio, sample_rate)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    text, nbest_list, decode_ms = recognize(audio_float32, sample_rate)
    if text and not nbest_list:
        nbest_list = [{"text": text, "score": 0.0}]

    job_id = req.job_id or ""
    logger.info(
        "Sherpa-LM job_id=%s decode_ms=%.0f text_len=%d",
        job_id,
        decode_ms,
        len(text),
    )

    segments = []
    if text or duration_sec > 0:
        segments = [
            SegmentInfo(
                text=text,
                start=0.0,
                end=duration_sec,
            )
        ]

    meta = {"decode_ms": round(decode_ms)}
    return UtteranceResponse(
        text=text,
        segments=segments,
        language=None,
        language_probability=None,
        language_probabilities=None,
        duration=duration_sec,
        vad_segments=[],
        meta=meta,
        nbest=nbest_list,
    )


def main():
    port = int(os.getenv("ASR_SHERPA_LM_PORT", str(PORT)))
    logger.info("ASR Sherpa-LM service starting on port %s", port)
    uvicorn.run(
        "service_main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
