"""
Faster Whisper + Silero VAD Service - Text Processing
文本处理功能（去重、过滤、上下文更新）
"""
import logging
from typing import Optional, List

from shared_types import SegmentInfoModel
from text_filter import is_meaningless_transcript
from text_deduplicator import deduplicate_text
from context import (
    get_text_context,
    update_text_context,
)

logger = logging.getLogger(__name__)

# 为了向后兼容，使用别名
SegmentInfo = SegmentInfoModel


def process_text_deduplication(full_text: str, trace_id: str) -> str:
    """
    处理文本去重
    
    Args:
        full_text: 原始文本
        trace_id: 追踪ID（用于日志）
    
    Returns:
        去重后的文本
    """
    if not full_text:
        return full_text
    
    full_text_trimmed = full_text.strip()
    if not full_text_trimmed:
        return full_text_trimmed
    
    original_text = full_text_trimmed
    full_text_trimmed = deduplicate_text(full_text_trimmed, trace_id=trace_id)
    
    # 如果文本被修改，记录日志
    if full_text_trimmed != original_text:
        logger.info(
            f"[{trace_id}] Step 9.2: Deduplication applied, "
            f"original_len={len(original_text)}, "
            f"deduplicated_len={len(full_text_trimmed)}, "
            f"original_text=\"{original_text[:100]}\", "
            f"deduplicated_text=\"{full_text_trimmed[:100]}\""
        )
    
    return full_text_trimmed


def filter_context_substring(
    current_text: str,
    text_context: str,
    audio_rms: float,
    audio_duration: float,
    trace_id: str
) -> str:
    """
    过滤上下文子串（避免重复输出）
    
    当音频质量较差（静音或白噪音）时，ASR模型可能会基于initial_prompt生成文本
    导致识别出的文本是前一个utterance的部分内容
    需要在ASR服务内部进行过滤，避免返回重复文本
    
    Args:
        current_text: 当前识别的文本
        text_context: 上下文文本
        audio_rms: 音频RMS值
        audio_duration: 音频时长（秒）
        trace_id: 追踪ID（用于日志）
    
    Returns:
        过滤后的文本（如果被过滤则返回空字符串）
    """
    if not text_context or not current_text:
        return current_text
    
    # 标准化文本（去除空格差异）
    def normalize_text(text: str) -> str:
        return text.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ').replace(' ', '').strip()
    
    normalized_current = normalize_text(current_text)
    normalized_context = normalize_text(text_context)
    
    # 检查音频质量：只有当音频质量很差时才进行子串过滤
    POOR_AUDIO_RMS_THRESHOLD = 0.001  # RMS 阈值（低于此值认为音频质量差）
    POOR_AUDIO_DURATION_THRESHOLD = 1.0  # 时长阈值（低于此值认为音频质量差）
    
    is_poor_audio_quality = (
        audio_rms < POOR_AUDIO_RMS_THRESHOLD or 
        audio_duration < POOR_AUDIO_DURATION_THRESHOLD
    )
    
    # 检查当前文本是否是上下文文本的子串
    # 提高最小长度要求，避免误判短文本（至少5个字符）
    # 同时要求当前文本长度不能超过上下文文本的80%，避免误判长文本
    # 另外，如果当前文本太短（小于上下文的30%），可能是误判，不应该过滤
    min_substring_len = 5  # 提高最小长度，避免误判
    if (len(normalized_current) >= min_substring_len and 
        normalized_context and 
        len(normalized_current) <= len(normalized_context) * 0.8 and  # 当前文本不能太长
        len(normalized_current) >= len(normalized_context) * 0.3 and  # 当前文本不能太短（至少是上下文的30%），避免误判短文本
        normalized_context.find(normalized_current) != -1):
        if is_poor_audio_quality:
            logger.warning(
                f"[{trace_id}] Step 9.3: Current text is a substring of context text, "
                f"and audio quality is poor (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                f"likely generated from initial_prompt due to poor audio quality. "
                f"Filtering to avoid duplicate output. "
                f"current_text='{current_text[:100]}', "
                f"context_text='{text_context[:100]}'"
            )
            # 返回空结果，避免重复输出
            return ""
        else:
            logger.info(
                f"[{trace_id}] Step 9.3: Current text is a substring of context text, "
                f"but audio quality is normal (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                f"likely user actually said similar content. Not filtering. "
                f"current_text='{current_text[:100]}', "
                f"context_text='{text_context[:100]}'"
            )
    
    # 检查上下文文本是否是当前文本的子串
    # 提高最小长度要求，避免误判短文本（至少5个字符）
    # 同时要求上下文文本长度不能超过当前文本的80%，避免误判长文本
    min_substring_len = 5  # 提高最小长度，避免误判
    if (len(normalized_context) >= min_substring_len and 
        normalized_current and 
        len(normalized_context) <= len(normalized_current) * 0.8 and  # 上下文文本不能太长
        normalized_current.find(normalized_context) != -1):
        if is_poor_audio_quality:
            logger.warning(
                f"[{trace_id}] Step 9.3: Context text is a substring of current text, "
                f"and audio quality is poor (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                f"likely generated from initial_prompt due to poor audio quality. "
                f"Filtering to avoid duplicate output. "
                f"current_text='{current_text[:50]}', "
                f"context_text='{text_context[:50]}'"
            )
            # 返回空结果，避免重复输出
            return ""
        else:
            logger.info(
                f"[{trace_id}] Step 9.3: Context text is a substring of current text, "
                f"but audio quality is normal (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                f"likely user actually said similar content. Not filtering. "
                f"current_text='{current_text[:50]}', "
                f"context_text='{text_context[:50]}'"
            )
    
    return current_text


def update_segments_after_deduplication(
    segments_info: List[SegmentInfo],
    full_text: str,
    deduplicated_text: str
) -> List[SegmentInfo]:
    """
    在去重后，重新生成 segments_info（使用去重后的文本）
    
    Args:
        segments_info: 原始segments信息
        full_text: 原始文本
        deduplicated_text: 去重后的文本
    
    Returns:
        更新后的segments信息
    """
    if segments_info and deduplicated_text != full_text:
        # 文本被去重修改了，需要重新生成 segments
        # 简单处理：按空格分割，但保留第一个 segment 的时间戳（如果存在）
        segment_texts_split = [s.strip() for s in deduplicated_text.split() if s.strip()]
        if segment_texts_split:
            # 尝试保留第一个 segment 的时间戳
            first_seg_start = segments_info[0].start if segments_info else None
            first_seg_end = segments_info[-1].end if segments_info else None
            segments_info = [
                SegmentInfo(
                    text=text,
                    start=first_seg_start if i == 0 else None,
                    end=first_seg_end if i == len(segment_texts_split) - 1 else None,
                    no_speech_prob=None,
                )
                for i, text in enumerate(segment_texts_split)
            ]
        else:
            segments_info = [SegmentInfo(text=deduplicated_text, start=None, end=None, no_speech_prob=None)]
    elif not segments_info and deduplicated_text:
        # 如果原始 segments 为空，从去重后的文本生成
        segment_texts_split = [s.strip() for s in deduplicated_text.split() if s.strip()]
        if segment_texts_split:
            segments_info = [
                SegmentInfo(text=text, start=None, end=None, no_speech_prob=None)
                for text in segment_texts_split
            ]
        else:
            segments_info = [SegmentInfo(text=deduplicated_text, start=None, end=None, no_speech_prob=None)]
    
    return segments_info


def update_text_context_if_needed(
    full_text: str,
    use_text_context: bool,
    trace_id: str
) -> None:
    """
    更新文本上下文缓存（只更新有意义的文本）
    
    Args:
        full_text: 识别后的文本
        use_text_context: 是否使用文本上下文
        trace_id: 追踪ID（用于日志）
    """
    if not use_text_context:
        return
    
    try:
        logger.info(f"[{trace_id}] Step 11.1: Splitting text into sentences")
        sentences = full_text.split('.')  # 使用去重后的文本
        if len(sentences) > 1:
            last_sentence = sentences[-1].strip()
            if last_sentence and not is_meaningless_transcript(last_sentence):
                logger.info(f"[{trace_id}] Step 11.2: Updating text context with last sentence (deduplicated)")
                update_text_context(last_sentence)
                logger.info(f"[{trace_id}] Step 11.2: Text context updated successfully")
        else:
            if not is_meaningless_transcript(full_text):
                logger.info(f"[{trace_id}] Step 11.3: Updating text context with full text (deduplicated)")
                update_text_context(full_text)
                logger.info(f"[{trace_id}] Step 11.3: Text context updated successfully")
        logger.info(f"[{trace_id}] Step 11: Text context update completed")
    except Exception as e:
        logger.error(f"[{trace_id}] Step 11: Failed to update text context: {e}", exc_info=True)
        raise
