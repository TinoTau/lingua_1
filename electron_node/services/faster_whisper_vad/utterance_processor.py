"""
Faster Whisper + Silero VAD Service - Utterance Processor
处理 Utterance 请求的核心逻辑
"""
import numpy as np
import logging
import time
import asyncio
from typing import Optional, List, Tuple, Dict, Any
from fastapi import HTTPException
from scipy import signal

from config import (
    MAX_AUDIO_DURATION_SEC,
    CONTEXT_SAMPLE_RATE,
    CONTEXT_DURATION_SEC,
    MAX_WAIT_SECONDS,
)
from audio_decoder import decode_audio
from vad import detect_speech
from context import get_context_audio, update_context_buffer
from audio_validation import (
    validate_audio_format,
    log_audio_validation_info,
    check_audio_quality,
    truncate_audio_if_needed,
)
from shared_types import SegmentInfo as SharedSegmentInfo
from text_processing import (
    SegmentInfo as SegmentInfoModel,
    process_text_deduplication,
    filter_context_substring,
    update_segments_after_deduplication,
    update_text_context_if_needed,
)
from text_filter import is_meaningless_transcript
from asr_worker_manager import ASRWorkerManager

logger = logging.getLogger(__name__)


def decode_and_preprocess_audio(
    audio_b64: str,
    audio_format: str,
    sample_rate: int,
    padding_ms: Optional[int],
    trace_id: str
) -> Tuple[np.ndarray, int]:
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
    
    # 检查音频长度限制
    audio = truncate_audio_if_needed(audio, sr, trace_id)
    
    # 重采样到指定采样率（默认 16kHz）
    if sr != sample_rate:
        logger.warning(f"[{trace_id}] Audio sample rate is {sr}Hz, expected {sample_rate}Hz. Resampling...")
        num_samples = int(len(audio) * sample_rate / sr)
        audio = signal.resample(audio, num_samples).astype(np.float32)
        sr = sample_rate
    
    # 重采样后再次检查音频长度限制
    audio = truncate_audio_if_needed(audio, sr, trace_id)
    
    # 确保音频是连续的
    if not audio.flags['C_CONTIGUOUS']:
        audio = np.ascontiguousarray(audio)
    
    # EDGE-4: Padding（在音频末尾添加静音）
    if padding_ms is not None and padding_ms > 0:
        padding_samples = int((padding_ms / 1000.0) * sr)
        if padding_samples > 0:
            padding = np.zeros(padding_samples, dtype=np.float32)
            audio = np.concatenate([audio, padding])
            logger.info(
                f"[{trace_id}] EDGE-4: Applied padding: {padding_ms}ms "
                f"({padding_samples} samples), total_duration={len(audio)/sr:.3f}s"
            )
    
    return audio, sr


def prepare_audio_with_context(
    audio: np.ndarray,
    sample_rate: int,
    use_context_buffer: bool,
    trace_id: str
) -> Tuple[np.ndarray, List[Tuple[int, int]]]:
    """
    准备带上下文的音频并进行VAD检测
    
    Args:
        audio: 原始音频
        sample_rate: 采样率
        use_context_buffer: 是否使用上下文缓冲区
        trace_id: 追踪ID
    
    Returns:
        (processed_audio, vad_segments) - 处理后的音频和VAD检测到的语音段
    """
    # 前置上下文音频（如果启用）
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
    
    # 使用 VAD 检测有效语音段（Level 2断句）
    try:
        vad_segments = detect_speech(audio_with_context)
    except Exception as e:
        logger.warning(
            f"[{trace_id}] trace_id={trace_id} "
            f"error='{str(e)}' "
            f"'VAD检测失败，使用完整音频进行ASR'"
        )
        vad_segments = []
    
    if len(vad_segments) == 0:
        logger.warning(
            f"[{trace_id}] trace_id={trace_id} "
            f"'VAD未检测到语音段，使用完整音频进行ASR'"
        )
        processed_audio = audio_with_context
    else:
        # 提取有效语音段（去除静音部分）
        processed_audio_parts = []
        for start, end in vad_segments:
            processed_audio_parts.append(audio_with_context[start:end])
        processed_audio = np.concatenate(processed_audio_parts)
        
        logger.info(
            f"[{trace_id}] trace_id={trace_id} "
            f"segments_count={len(vad_segments)} "
            f"original_samples={len(audio_with_context)} "
            f"processed_samples={len(processed_audio)} "
            f"removed_samples={len(audio_with_context) - len(processed_audio)} "
            f"'VAD检测到{len(vad_segments)}个语音段，已提取有效语音'"
        )
        
        # 如果处理后的音频太短（< 0.5秒），使用原始音频
        MIN_AUDIO_SAMPLES = int(sample_rate * 0.5)  # 0.5秒
        if len(processed_audio) < MIN_AUDIO_SAMPLES:
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"processed_samples={len(processed_audio)} "
                f"'VAD处理后的音频过短，使用原始音频'"
            )
            processed_audio = audio_with_context
    
    # 最终检查：确保传递给 Faster Whisper 的音频不超过最大长度
    processed_audio = truncate_audio_if_needed(processed_audio, sample_rate, trace_id)
    
    return processed_audio, vad_segments


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
    
    Args:
        processed_audio: 处理后的音频
        sample_rate: 采样率
        asr_language: 语言代码
        task: 任务类型
        beam_size: Beam search宽度
        text_context: 文本上下文
        condition_on_previous_text: 是否基于前文生成
        trace_id: 追踪ID
        manager: ASR Worker Manager
        其他参数: ASR优化参数
    
    Returns:
        (full_text, detected_language, language_probabilities, segments_info, duration_sec)
    """
    asr_start_time = time.time()
    
    # 检查队列是否已满（背压控制）
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
    
    # 在调用transcribe之前记录关键信息（包括上下文）
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
        # 提交任务到ASR Worker进程
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
        
        # 检查结果
        if asr_result.error:
            logger.error(
                f"[{trace_id}] ASR Worker returned error: {asr_result.error}",
                exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"ASR processing failed: {asr_result.error}"
            )
        
        # 从结果中获取文本和语言信息
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
        
        # 使用真正的 segments 数据（包含时间戳）
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
        
        # 如果 segments 为空，从文本生成（向后兼容）
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
        
        # 记录 ASR 处理时间（用于性能监控）
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


def update_context_buffer_if_needed(
    audio: np.ndarray,
    use_context_buffer: bool,
    trace_id: str
) -> None:
    """
    更新上下文缓冲区（使用原始音频，不带上下文）
    
    Args:
        audio: 原始音频
        use_context_buffer: 是否使用上下文缓冲区
        trace_id: 追踪ID
    """
    if not use_context_buffer:
        return
    
    logger.info(f"[{trace_id}] Step 12: Starting context buffer update (use_context_buffer={use_context_buffer})")
    
    try:
        # 使用 VAD 检测原始音频的语音段
        logger.info(f"[{trace_id}] Step 12.1: Starting VAD detection for context buffer (audio_len={len(audio)})")
        try:
            original_vad_segments = detect_speech(audio)
            logger.info(f"[{trace_id}] Step 12.1: VAD detection completed, segments={len(original_vad_segments)}")
        except Exception as e:
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"error='{str(e)}' "
                f"'VAD检测失败，使用简单尾部保存上下文'"
            )
            original_vad_segments = []
        
        if len(original_vad_segments) > 0:
            # 选择最后一个语音段
            last_start, last_end = original_vad_segments[-1]
            last_segment = audio[last_start:last_end]
            context_samples = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)
            
            if len(last_segment) > context_samples:
                logger.info(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"context_samples={context_samples} "
                    f"context_duration_sec={context_samples/CONTEXT_SAMPLE_RATE:.3f} "
                    f"segment_start={last_start} "
                    f"segment_end={last_end} "
                    f"segment_samples={len(last_segment)} "
                    f"'✅ 更新上下文缓冲区（使用VAD选择的最后一个语音段尾部）'"
                )
            else:
                logger.info(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"context_samples={len(last_segment)} "
                    f"context_duration_sec={len(last_segment)/CONTEXT_SAMPLE_RATE:.3f} "
                    f"segment_samples={len(last_segment)} "
                    f"'✅ 更新上下文缓冲区（最后一个语音段较短，保存全部）'"
                )
            
            logger.info(f"[{trace_id}] Step 12.2: Updating context buffer")
            update_context_buffer(audio, original_vad_segments)
            logger.info(f"[{trace_id}] Step 12.2: Context buffer updated successfully")
        else:
            # 如果没有检测到语音段，回退到简单尾部保存
            context_samples = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)
            if len(audio) > context_samples:
                logger.info(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"context_samples={context_samples} "
                    f"context_duration_sec={context_samples/CONTEXT_SAMPLE_RATE:.3f} "
                    f"original_samples={len(audio)} "
                    f"'⚠️ 更新上下文缓冲区（VAD未检测到语音段，保存最后{CONTEXT_DURATION_SEC}秒）'"
                )
            else:
                logger.info(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"context_samples={len(audio)} "
                    f"context_duration_sec={len(audio)/CONTEXT_SAMPLE_RATE:.3f} "
                    f"original_samples={len(audio)} "
                    f"'⚠️ 更新上下文缓冲区（utterance较短，保存全部）'"
                )
            
            logger.info(f"[{trace_id}] Step 12.2: Updating context buffer")
            update_context_buffer(audio, [])
            logger.info(f"[{trace_id}] Step 12.2: Context buffer updated successfully")
        
        logger.info(f"[{trace_id}] Step 12: Context buffer update completed")
    except Exception as e:
        logger.error(f"[{trace_id}] Step 12: Failed to update context buffer: {e}", exc_info=True)
        raise
