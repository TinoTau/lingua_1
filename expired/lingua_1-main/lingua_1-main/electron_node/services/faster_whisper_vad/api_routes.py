"""
Faster Whisper + Silero VAD Service - API Routes
FastAPI 路由定义
"""
import logging
import os
from fastapi import HTTPException
from typing import Optional

from config import PORT
from vad import vad_state
from context import reset_context_buffer, reset_text_context
from asr_worker_manager import ASRWorkerManager
from api_models import UtteranceRequest, UtteranceResponse, ResetRequest
from utterance_processor import (
    decode_and_preprocess_audio,
    prepare_audio_with_context,
    perform_asr,
    update_context_buffer_if_needed,
)
from audio_validation import (
    validate_audio_format,
    log_audio_validation_info,
    check_audio_quality,
)
from shared_types import SegmentInfo as SharedSegmentInfo
from text_processing import (
    SegmentInfo,
    process_text_deduplication,
    filter_context_substring,
    update_segments_after_deduplication,
    update_text_context_if_needed,
)
from text_filter import is_meaningless_transcript
from context import get_text_context

logger = logging.getLogger(__name__)


# 全局 ASR Worker Manager
_asr_worker_manager: Optional[ASRWorkerManager] = None


def get_asr_worker_manager() -> ASRWorkerManager:
    """获取全局 ASR Worker Manager 实例"""
    global _asr_worker_manager
    if _asr_worker_manager is None:
        _asr_worker_manager = ASRWorkerManager()
    return _asr_worker_manager


async def health_check():
    """健康检查端点，包含ASR Worker状态"""
    manager = get_asr_worker_manager()
    stats = manager.get_stats()
    return {
        "status": "ok",
        "asr_model_loaded": stats.get("worker_pid") is not None,
        "vad_model_loaded": True,
        "asr_worker": {
            "is_running": stats["is_running"],
            "worker_state": stats["worker_state"],
            "worker_pid": stats["worker_pid"],
            "queue_depth": stats["queue_depth"],
            "total_tasks": stats["total_tasks"],
            "completed_tasks": stats["completed_tasks"],
            "failed_tasks": stats["failed_tasks"],
            "worker_restarts": stats["worker_restarts"],
            "avg_wait_ms": round(stats["avg_wait_ms"], 2),
            "pending_results": stats["pending_results"],
        }
    }


def reset_state(req: ResetRequest):
    """重置 VAD 状态和上下文缓冲区"""
    if req.reset_vad:
        vad_state.reset()
        logger.info("✅ VAD state reset")
    
    if req.reset_context:
        reset_context_buffer()
        logger.info("✅ Context buffer reset")
    
    if req.reset_text_context:
        reset_text_context()
        logger.info("✅ Text context cache reset")
    
    return {"status": "ok"}


async def startup():
    """启动ASR Worker Manager"""
    try:
        logger.info("=" * 80)
        logger.info("🚀 Starting Faster Whisper + Silero VAD Service")
        logger.info(f"   Main process PID: {os.getpid()}")
        logger.info(f"   Port: {PORT}")
        logger.info("=" * 80)
        
        manager = get_asr_worker_manager()
        await manager.start()
        logger.info("✅ ASR Worker Manager started on startup")
    except Exception as e:
        logger.critical(f"❌ Failed to start ASR Worker Manager: {e}", exc_info=True)
        raise


async def shutdown():
    """停止ASR Worker Manager"""
    try:
        logger.info("=" * 80)
        logger.info("🛑 Shutting down Faster Whisper + Silero VAD Service")
        logger.info(f"   Main process PID: {os.getpid()}")
        logger.info("=" * 80)
        
        global _asr_worker_manager
        if _asr_worker_manager:
            await _asr_worker_manager.stop()
            _asr_worker_manager = None
        logger.info("✅ ASR Worker Manager stopped on shutdown")
    except Exception as e:
        logger.error(f"❌ Error during shutdown: {e}", exc_info=True)


async def process_utterance(req: UtteranceRequest) -> UtteranceResponse:
    """
    处理 Utterance 任务
    严格按照现有实现，与 node-inference 接口保持一致：
    1. 解码音频（支持多种格式）
    2. 前置上下文音频（如果启用）
    3. 使用 VAD 检测有效语音段
    4. 使用 Faster Whisper 进行 ASR
    5. 更新上下文缓冲区
    """
    trace_id = req.trace_id or req.job_id
    logger.info(f"[{trace_id}] Received utterance request: job_id={req.job_id}, audio_format={req.audio_format}, sample_rate={req.sample_rate}")
    
    logger.info(f"[{trace_id}] ========== ASR 接口入参 ==========")
    logger.info(
        f"[{trace_id}] ASR 请求参数: "
        f"job_id={req.job_id}, "
        f"src_lang={req.src_lang}, "
        f"audio_format={req.audio_format}, "
        f"sample_rate={req.sample_rate}, "
        f"use_context_buffer={req.use_context_buffer}, "
        f"use_text_context={req.use_text_context}, "
        f"condition_on_previous_text={req.condition_on_previous_text}"
    )
    logger.debug(
        f"[{trace_id}] "
        f"trace_id={trace_id} "
        f"job_id={req.job_id} "
        f"'开始处理推理请求'"
    )
    
    try:
        # 1. 解码和预处理音频
        audio_format = req.audio_format or "pcm16"
        sample_rate = req.sample_rate or 16000
        audio, sr = decode_and_preprocess_audio(
            req.audio, audio_format, sample_rate, req.padding_ms, trace_id
        )
        
        # 2. 确定语言（如果 src_lang == "auto"，则使用 language 或自动检测）
        asr_language = None
        if req.src_lang != "auto":
            asr_language = req.src_lang
        elif req.language:
            asr_language = req.language
        
        logger.debug(f"[{trace_id}] trace_id={trace_id} src_lang={req.src_lang} '开始 ASR 语音识别'")
        
        # 3. 准备带上下文的音频并进行VAD检测
        processed_audio, vad_segments = prepare_audio_with_context(
            audio, sr, req.use_context_buffer, trace_id
        )
        
        # 4. 获取文本上下文（用于 Faster Whisper 的 initial_prompt）
        text_context = ""
        if req.use_text_context:
            text_context = get_text_context()
            if text_context:
                logger.info(
                    f"[{trace_id}] "
                    f"Using text context ({len(text_context)} chars): \"{text_context[:100]}...\""
                )
                logger.info(f"[{trace_id}] ASR 文本上下文 (完整): \"{text_context}\"")
            else:
                logger.info(
                    f"[{trace_id}] No text context available (first utterance or context was reset)"
                )
        
        # 5. 验证音频数据格式
        processed_audio = validate_audio_format(processed_audio, trace_id)
        
        # 6. 记录音频数据信息
        audio_std, audio_rms, audio_dynamic_range, audio_duration = log_audio_validation_info(
            processed_audio, sr, trace_id
        )
        
        # 7. 音频质量检查
        is_quality_ok, audio_quality_issues = check_audio_quality(
            processed_audio, sr, trace_id
        )
        
        if not is_quality_ok:
            return UtteranceResponse(
                text="",
                segments=[],
                language=asr_language or "unknown",
                duration=audio_duration,
                vad_segments=vad_segments,
            )
        
        # 8. 使用 ASR Worker Manager 进行 ASR（进程隔离架构）
        manager = get_asr_worker_manager()
        
        full_text, detected_language, language_probabilities, segments_info, duration_sec = await perform_asr(
            processed_audio=processed_audio,
            sample_rate=sr,
            asr_language=asr_language,
            task=req.task,
            beam_size=req.beam_size,
            text_context=text_context if text_context else None,
            condition_on_previous_text=req.condition_on_previous_text,
            trace_id=trace_id,
            manager=manager,
            best_of=req.best_of,
            temperature=req.temperature,
            patience=req.patience,
            compression_ratio_threshold=req.compression_ratio_threshold,
            log_prob_threshold=req.log_prob_threshold,
            no_speech_threshold=req.no_speech_threshold,
        )
        
        # 计算检测到的语言的概率
        language_probability = None
        if language_probabilities and detected_language:
            language_probability = language_probabilities.get(detected_language)
            if language_probability is not None:
                logger.info(
                    f"[{trace_id}] ASR 语言检测概率: language={detected_language}, "
                    f"probability={language_probability:.4f}"
                )
        
        info_language = detected_language
        info_duration = duration_sec
        
        logger.info(f"[{trace_id}] Step 9: Starting ASR result processing")
        
        # 9. ASR 识别完成，记录结果
        try:
            full_text_trimmed = full_text.strip()
            logger.info(f"[{trace_id}] Step 9.1: Text trimmed, len={len(full_text_trimmed)}")
            
            # 9.2. 去重处理
            if full_text_trimmed:
                full_text_trimmed = process_text_deduplication(full_text_trimmed, trace_id)
                
                # 9.3. 过滤上下文子串
                if text_context and full_text_trimmed:
                    full_text_trimmed = filter_context_substring(
                        full_text_trimmed, text_context, audio_rms, audio_duration, trace_id
                    )
        except Exception as e:
            logger.error(f"[{trace_id}] Step 9.1: Failed to trim text: {e}", exc_info=True)
            raise
        
        # 检查是否包含括号（用于调试，与 node-inference 一致）
        try:
            if '(' in full_text_trimmed or '（' in full_text_trimmed or '[' in full_text_trimmed or '【' in full_text_trimmed:
                logger.warning(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"transcript='{full_text_trimmed}' "
                    f"transcript_len={len(full_text_trimmed)} "
                    f"'⚠️ [ASR Filter Check] Transcript contains brackets before setting to context!'"
                )
        except Exception as e:
            logger.error(f"[{trace_id}] Step 9.2: Failed to check brackets: {e}", exc_info=True)
        
        logger.info(
            f"[{trace_id}] trace_id={trace_id} "
            f"transcript_len={len(full_text)} "
            f"transcript_preview='{full_text[:50]}' "
            f"transcript_trimmed_len={len(full_text_trimmed)} "
            f"transcript_deduplicated_preview='{full_text_trimmed[:50]}' "
            f"'✅ ASR 识别完成'"
        )
        # 记录最终返回给 NMT 的文本（用于诊断 "R" 开头问题）
        logger.info(
            f"[{trace_id}] Step 9.4: Final text to be sent to NMT (full): '{full_text_trimmed}' "
            f"(len={len(full_text_trimmed)}, first_char='{full_text_trimmed[0] if full_text_trimmed else 'N/A'}')"
        )
        
        # 在去重后，重新生成 segments_info（使用去重后的文本）
        # 将 dataclass 转换为 Pydantic 模型
        segments_info_pydantic = [
            SegmentInfo(
                text=seg.text,
                start=seg.start,
                end=seg.end,
                no_speech_prob=seg.no_speech_prob,
            )
            for seg in segments_info
        ]
        segments_info_pydantic = update_segments_after_deduplication(
            segments_info_pydantic, full_text, full_text_trimmed
        )
        segments_info = segments_info_pydantic
        
        logger.info(f"[{trace_id}] Step 10: Starting text validation")
        
        # 10. 检查文本是否为无意义的识别结果
        try:
            if not full_text_trimmed:
                logger.warning(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"transcript='{full_text}' "
                    f"'ASR transcript is empty, skipping NMT and TTS, and NOT updating context buffer'"
                )
                logger.info(f"[{trace_id}] Step 10.1: Returning empty response (empty transcript)")
                return UtteranceResponse(
                    text="",
                    segments=[],
                    language=info_language,
                    duration=info_duration,
                    vad_segments=[],
                )
        except Exception as e:
            logger.error(f"[{trace_id}] Step 10.1: Failed to check empty text: {e}", exc_info=True)
            raise
        
        try:
            logger.info(f"[{trace_id}] Step 10.2: Checking if transcript is meaningless")
            is_meaningless = is_meaningless_transcript(full_text_trimmed)
            logger.info(f"[{trace_id}] Step 10.2: Meaningless check result: {is_meaningless}")
        except Exception as e:
            logger.error(f"[{trace_id}] Step 10.2: Failed to check meaningless transcript: {e}", exc_info=True)
            raise
        
        if is_meaningless:
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"transcript='{full_text_trimmed}' "
                f"transcript_len={len(full_text_trimmed)} "
                f"'ASR transcript is meaningless (likely silence misrecognition), skipping NMT and TTS, and NOT updating context buffer'"
            )
            logger.info(f"[{trace_id}] Step 10.3: Returning empty response (meaningless transcript)")
            return UtteranceResponse(
                text="",
                segments=[],
                language=info_language,
                duration=info_duration,
                vad_segments=[],
            )
        
        logger.info(f"[{trace_id}] Step 11: Starting text context update (use_text_context={req.use_text_context})")
        
        # 11. 更新文本上下文缓存
        update_text_context_if_needed(full_text_trimmed, req.use_text_context, trace_id)
        
        # 12. 更新上下文缓冲区
        update_context_buffer_if_needed(audio, req.use_context_buffer, trace_id)
        
        logger.info(f"[{trace_id}] Step 13: Starting response construction")
        
        # 13. 返回结果
        try:
            response = UtteranceResponse(
                text=full_text_trimmed,
                segments=segments_info,
                language=info_language,
                language_probability=language_probability,
                language_probabilities=language_probabilities,
                duration=info_duration,
                vad_segments=vad_segments,
            )
            logger.info(f"[{trace_id}] Step 13: Response constructed successfully, returning deduplicated text (len={len(full_text_trimmed)})")
            return response
        except Exception as e:
            logger.error(f"[{trace_id}] Step 13: Failed to construct response: {e}", exc_info=True)
            raise
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Utterance processing error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Utterance processing failed: {str(e)}")
