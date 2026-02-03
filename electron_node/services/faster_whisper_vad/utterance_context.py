"""
Faster Whisper + Silero VAD Service - 上下文缓冲区更新
"""
import logging
import numpy as np

from config import CONTEXT_DURATION_SEC, CONTEXT_SAMPLE_RATE
from vad import detect_speech
from context import update_context_buffer

logger = logging.getLogger(__name__)


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
