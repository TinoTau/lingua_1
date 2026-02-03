"""
Faster Whisper + Silero VAD Service - ASR 执行
"""
import logging
import time
import asyncio
from typing import Optional, List, Tuple, Dict

from fastapi import HTTPException
import numpy as np

from config import MAX_WAIT_SECONDS
from asr_worker_manager import ASRWorkerManager
from shared_types import SegmentInfo as SharedSegmentInfo

logger = logging.getLogger(__name__)


async def perform_asr(
    processed_audio: np.ndarray,
    sample_rate: int,
    asr_language: Optional[str],
    task: str,
    beam_size: int,
    text_context: Optional[str],
    condition_on_previous_text: bool,
    trace_id: str,
    manager: ASRWorkerManager,
    best_of: Optional[int] = None,
    temperature: Optional[float] = None,
    patience: Optional[float] = None,
    compression_ratio_threshold: Optional[float] = None,
    log_prob_threshold: Optional[float] = None,
    no_speech_threshold: Optional[float] = None,
) -> Tuple[str, Optional[str], Optional[Dict[str, float]], List[SharedSegmentInfo], float]:
    """
    执行ASR识别

    Returns:
        (full_text, detected_language, language_probabilities, segments_info, duration_sec)
    """
    asr_start_time = time.time()

    if manager.is_queue_full():
        stats = manager.get_stats()
        logger.warning(
            f"[{trace_id}] ASR queue is full, returning 503 Service Busy. "
            f"queue_depth={stats['queue_depth']}"
        )
        raise HTTPException(
            status_code=503,
            detail="ASR service is busy, please retry later",
            headers={"Retry-After": "1"}
        )

    stats = manager.get_stats()
    logger.info(f"[{trace_id}] ========== ASR 识别请求开始 ==========")
    logger.info(
        f"[{trace_id}] ASR 参数: "
        f"language={asr_language}, "
        f"task={task}, "
        f"beam_size={beam_size}, "
        f"condition_on_previous_text={condition_on_previous_text}, "
        f"queue_depth={stats['queue_depth']}, "
        f"worker_state={stats['worker_state']}"
    )
    logger.info(
        f"[{trace_id}] ASR 上下文参数: "
        f"has_initial_prompt={text_context is not None and len(text_context) > 0}, "
        f"initial_prompt_length={len(text_context) if text_context else 0}, "
        f"initial_prompt_preview='{text_context[:100] if text_context else '(None)'}'"
    )
    logger.info(
        f"[{trace_id}] ASR 音频参数: "
        f"audio_len={len(processed_audio)}, "
        f"sample_rate={sample_rate}, "
        f"duration_sec={len(processed_audio) / sample_rate:.2f}"
    )

    try:
        asr_result = await manager.submit_task(
            audio=processed_audio,
            sample_rate=sample_rate,
            language=asr_language,
            task=task,
            beam_size=beam_size,
            initial_prompt=text_context if text_context else None,
            condition_on_previous_text=condition_on_previous_text,
            trace_id=trace_id,
            max_wait=MAX_WAIT_SECONDS,
            best_of=best_of,
            temperature=temperature,
            patience=patience,
            compression_ratio_threshold=compression_ratio_threshold,
            log_prob_threshold=log_prob_threshold,
            no_speech_threshold=no_speech_threshold,
        )

        if asr_result.error:
            logger.error(
                f"[{trace_id}] ASR Worker returned error: {asr_result.error}",
                exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"ASR processing failed: {asr_result.error}"
            )

        full_text = asr_result.text or ""
        detected_language = asr_result.language
        language_probabilities = asr_result.language_probabilities
        segments_info_raw = asr_result.segments
        duration_sec = asr_result.duration_ms / 1000.0 if asr_result.duration_ms > 0 else 0.0

        logger.info(f"[{trace_id}] ========== ASR 接口输出结果 ==========")
        logger.info(
            f"[{trace_id}] ASR Worker completed successfully, "
            f"text_len={len(full_text)}, language={detected_language}, "
            f"duration_ms={asr_result.duration_ms}"
        )
        logger.info(f"[{trace_id}] ASR 接口输出原始文本 (repr): {repr(full_text)}")
        logger.info(f"[{trace_id}] ASR 接口输出原始文本 (preview): '{full_text[:200]}'")
        logger.info(f"[{trace_id}] ASR 接口输出原始文本 (bytes): {full_text.encode('utf-8') if full_text else b''}")

        segments_info: List[SharedSegmentInfo] = []
        if segments_info_raw:
            segments_info = [
                SharedSegmentInfo(
                    text=seg.text,
                    start=seg.start,
                    end=seg.end,
                    no_speech_prob=seg.no_speech_prob,
                )
                for seg in segments_info_raw
            ]

        if not segments_info and full_text:
            segment_texts_split = [s.strip() for s in full_text.split() if s.strip()]
            if segment_texts_split:
                segments_info = [
                    SharedSegmentInfo(text=text, start=None, end=None, no_speech_prob=None)
                    for text in segment_texts_split
                ]
            else:
                segments_info = [SharedSegmentInfo(text=full_text, start=None, end=None, no_speech_prob=None)]

        asr_elapsed = time.time() - asr_start_time
        logger.info(f"[{trace_id}] Step 8.1: Text extraction completed, segments={len(segments_info)}, full_text_len={len(full_text)}")

        if asr_elapsed > 1.0:
            audio_duration = len(processed_audio) / sample_rate
            ratio = asr_elapsed / audio_duration if audio_duration > 0 else 0
            logger.warning(
                f"[{trace_id}] "
                f"⚠️ ASR processing took {asr_elapsed:.2f}s "
                f"(audio duration: {audio_duration:.2f}s, ratio: {ratio:.2f}x)"
            )

        return full_text, detected_language, language_probabilities, segments_info, duration_sec

    except asyncio.TimeoutError:
        stats = manager.get_stats()
        logger.error(
            f"[{trace_id}] ASR task timeout after {MAX_WAIT_SECONDS}s, "
            f"queue_depth={stats['queue_depth']}"
        )
        raise HTTPException(
            status_code=504,
            detail=f"ASR processing timeout after {MAX_WAIT_SECONDS}s"
        )
    except RuntimeError as e:
        logger.error(
            f"[{trace_id}] ASR Worker process not available: {e}",
            exc_info=True
        )
        raise HTTPException(
            status_code=503,
            detail="ASR service is temporarily unavailable, please retry later",
            headers={"Retry-After": "2"}
        )
    except Exception as e:
        logger.error(
            f"[{trace_id}] ASR Worker exception: {e}",
            exc_info=True
        )
        raise HTTPException(
            status_code=500,
            detail=f"ASR processing failed: {str(e)}"
        )
