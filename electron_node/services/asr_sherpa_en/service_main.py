"""
ASR Sherpa English CTC 服务入口。契约与 asr-sherpa-lm 一致：POST /utterance，PCM16 16kHz base64。
模型：sherpa-onnx-nemo-ctc-en-conformer-small。
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

app = FastAPI(title="ASR Sherpa English CTC Service", version="1.0.0")


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

    text, nbest_list, decode_ms, beam0_raw = recognize(audio_float32, sample_rate)

    trace_id = (req.trace_id or req.job_id or "").strip()
    job_id = req.job_id or ""
    logger.info(
        "Sherpa-EN job_id=%s decode_ms=%.0f text_len=%d",
        job_id,
        decode_ms,
        len(text),
    )
    # 最小定位实验：出现「4」时记录 beam0_raw / final_text，便于分流结论（解码库 vs 后续处理）
    if "4" in text:
        logger.info(
            "EN_CTC_DIAG trace_id=%s beam0_raw=%s final_text=%s",
            trace_id,
            repr(beam0_raw[:500] if beam0_raw else ""),
            repr(text[:500] if text else ""),
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
    port = int(os.getenv("ASR_SHERPA_EN_PORT", str(PORT)))
    logger.info("ASR Sherpa English CTC service starting on port %s", port)
    uvicorn.run(
        "service_main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
