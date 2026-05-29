"""
Faster Whisper + Silero VAD Service - 音频解码与带上下文的准备
"""
import numpy as np
import logging
from typing import List, Tuple, Optional
from fastapi import HTTPException
from scipy import signal

from config import CONTEXT_SAMPLE_RATE
from audio_decoder import decode_audio
from audio_preprocess import preprocess_pcm_f32
from vad import detect_speech
from vad_segment_filter import refine_vad_segments
from context import get_context_audio
from audio_validation import truncate_audio_if_needed

logger = logging.getLogger(__name__)


def decode_and_preprocess_audio(
    audio_b64: str,
    audio_format: str,
    sample_rate: int,
    padding_ms: Optional[int],
    trace_id: str
) -> Tuple[np.ndarray, int, dict]:
    """
    解码和预处理音频

    Args:
        audio_b64: Base64编码的音频数据
        audio_format: 音频格式
        sample_rate: 采样率
        padding_ms: 尾部静音padding（毫秒）
        trace_id: 追踪ID

    Returns:
        (audio, sample_rate) - 处理后的音频和采样率
    """
    logger.info(f"[{trace_id}] Audio format: {audio_format}, sample_rate: {sample_rate}")

    try:
        audio, sr = decode_audio(audio_b64, audio_format, sample_rate, trace_id)
    except ValueError as e:
        logger.error(f"[{trace_id}] Audio decoding failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.critical(
            f"[{trace_id}] 🚨 CRITICAL: Audio decoding raised unexpected exception: {e}, "
            f"error_type={type(e).__name__}",
            exc_info=True
        )
        raise HTTPException(status_code=500, detail=f"Audio decoding error: {str(e)}")

    audio = truncate_audio_if_needed(audio, sr, trace_id)

    if sr != sample_rate:
        logger.warning(f"[{trace_id}] Audio sample rate is {sr}Hz, expected {sample_rate}Hz. Resampling...")
        num_samples = int(len(audio) * sample_rate / sr)
        audio = signal.resample(audio, num_samples).astype(np.float32)
        sr = sample_rate

    audio = truncate_audio_if_needed(audio, sr, trace_id)

    if not audio.flags['C_CONTIGUOUS']:
        audio = np.ascontiguousarray(audio)

    if padding_ms is not None and padding_ms > 0:
        padding_samples = int((padding_ms / 1000.0) * sr)
        if padding_samples > 0:
            padding = np.zeros(padding_samples, dtype=np.float32)
            audio = np.concatenate([audio, padding])
            logger.info(
                f"[{trace_id}] EDGE-4: Applied padding: {padding_ms}ms "
                f"({padding_samples} samples), total_duration={len(audio)/sr:.3f}s"
            )

    audio, sr, pre_diag = preprocess_pcm_f32(audio, sr, sample_rate)

    return audio, sr, pre_diag


def prepare_audio_with_context(
    audio: np.ndarray,
    sample_rate: int,
    use_context_buffer: bool,
    trace_id: str
) -> Tuple[np.ndarray, List[Tuple[int, int]]]:
    """
    准备带上下文的音频并进行VAD检测

    Returns:
        (processed_audio, vad_segments) - 处理后的音频和VAD检测到的语音段
    """
    if use_context_buffer:
        context_audio = get_context_audio()
        if len(context_audio) > 0:
            audio_with_context = np.concatenate([context_audio, audio])
            context_duration_sec = len(context_audio) / sample_rate
            original_duration_sec = len(audio) / sample_rate
            total_duration_sec = len(audio_with_context) / sample_rate
            logger.info(
                f"[{trace_id}] trace_id={trace_id} "
                f"context_samples={len(context_audio)} "
                f"context_duration_sec={context_duration_sec:.3f} "
                f"original_samples={len(audio)} "
                f"original_duration_sec={original_duration_sec:.3f} "
                f"total_samples={len(audio_with_context)} "
                f"total_duration_sec={total_duration_sec:.3f} "
                f"'✅ 前置上下文音频到当前utterance（上下文缓冲区不为空）'"
            )
        else:
            audio_with_context = audio
            logger.info(
                f"[{trace_id}] trace_id={trace_id} "
                f"original_samples={len(audio)} "
                f"original_duration_sec={len(audio)/sample_rate:.3f} "
                f"'ℹ️ 上下文缓冲区为空，使用原始音频（第一个utterance或上下文已清空）'"
            )
    else:
        audio_with_context = audio

    original_audio_samples = len(audio_with_context)
    original_audio_duration_ms = int((original_audio_samples / sample_rate) * 1000)
    logger.info(
        f"[{trace_id}] VAD处理前: "
        f"original_samples={original_audio_samples} "
        f"original_duration_ms={original_audio_duration_ms} "
        f"sample_rate={sample_rate} "
        f"use_context_buffer={use_context_buffer} "
        f"'🔍 开始VAD检测（Level 2断句）'"
    )

    try:
        vad_segments = detect_speech(audio_with_context)
        vad_segments = refine_vad_segments(
            vad_segments,
            sample_rate,
            audio_len=len(audio_with_context),
        )
    except Exception as e:
        logger.warning(
            f"[{trace_id}] trace_id={trace_id} "
            f"error='{str(e)}' "
            f"'VAD检测失败，使用完整音频进行ASR'"
        )
        vad_segments = []

    if len(vad_segments) == 0:
        logger.warning(
            f"[{trace_id}] VAD检测结果: "
            f"segments_count=0 "
            f"original_samples={original_audio_samples} "
            f"original_duration_ms={original_audio_duration_ms} "
            f"'⚠️ VAD未检测到语音段，使用完整音频进行ASR'"
        )
        processed_audio = audio_with_context
    else:
        processed_audio_parts = []
        segments_info = []
        for seg_idx, (start, end) in enumerate(vad_segments):
            segment_audio = audio_with_context[start:end]
            processed_audio_parts.append(segment_audio)
            segment_samples = end - start
            segment_duration_ms = int((segment_samples / sample_rate) * 1000)
            segment_start_ms = int((start / sample_rate) * 1000)
            segment_end_ms = int((end / sample_rate) * 1000)
            segments_info.append({
                "index": seg_idx,
                "start_sample": start,
                "end_sample": end,
                "start_ms": segment_start_ms,
                "end_ms": segment_end_ms,
                "samples": segment_samples,
                "duration_ms": segment_duration_ms,
            })

        processed_audio = np.concatenate(processed_audio_parts)
        processed_audio_samples = len(processed_audio)
        processed_audio_duration_ms = int((processed_audio_samples / sample_rate) * 1000)
        removed_samples = original_audio_samples - processed_audio_samples
        removed_duration_ms = original_audio_duration_ms - processed_audio_duration_ms
        removed_percentage = (removed_samples / original_audio_samples * 100) if original_audio_samples > 0 else 0

        logger.info(
            f"[{trace_id}] VAD检测结果: "
            f"segments_count={len(vad_segments)} "
            f"original_samples={original_audio_samples} "
            f"original_duration_ms={original_audio_duration_ms} "
            f"processed_samples={processed_audio_samples} "
            f"processed_duration_ms={processed_audio_duration_ms} "
            f"removed_samples={removed_samples} "
            f"removed_duration_ms={removed_duration_ms} "
            f"removed_percentage={removed_percentage:.2f}% "
            f"'✅ VAD检测到{len(vad_segments)}个语音段，已提取有效语音'"
        )

        segments_details = ", ".join([
            f"seg{i}: [{info['start_ms']}ms-{info['end_ms']}ms, {info['duration_ms']}ms]"
            for i, info in enumerate(segments_info)
        ])
        logger.info(f"[{trace_id}] VAD segments详情: {segments_details}")

        if removed_percentage > 30:
            logger.warning(
                f"[{trace_id}] VAD过滤警告: "
                f"removed_percentage={removed_percentage:.2f}% "
                f"removed_samples={removed_samples} "
                f"removed_duration_ms={removed_duration_ms} "
                f"⚠️ VAD过滤掉了超过30%的音频，可能导致有效语音丢失"
            )

        MIN_AUDIO_SAMPLES = int(sample_rate * 0.5)
        if len(processed_audio) < MIN_AUDIO_SAMPLES:
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"processed_samples={len(processed_audio)} "
                f"'VAD处理后的音频过短，使用原始音频'"
            )
            processed_audio = audio_with_context

    processed_audio = truncate_audio_if_needed(processed_audio, sample_rate, trace_id)

    return processed_audio, vad_segments
