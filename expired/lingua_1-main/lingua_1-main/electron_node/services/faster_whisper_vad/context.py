"""
Faster Whisper + Silero VAD Service - Context Management
上下文缓冲区管理
"""
import numpy as np
import logging
import threading
from typing import List, Tuple

from config import (
    CONTEXT_DURATION_SEC,
    CONTEXT_SAMPLE_RATE,
    CONTEXT_MAX_SAMPLES,
)
from vad import detect_speech

logger = logging.getLogger(__name__)

# ---------------------
# Context Buffer (严格按照 Rust 实现)
# ---------------------
# 全局上下文缓冲区（每个会话应该有独立缓冲区，这里简化处理）
context_buffer: List[float] = []
context_buffer_lock = threading.Lock()

# 文本上下文缓存（用于 Faster Whisper 的 initial_prompt）
text_context_cache: List[str] = []
text_context_cache_lock = threading.Lock()

# ---------------------
# Context Buffer Functions
# ---------------------
def update_context_buffer(audio_data: np.ndarray, vad_segments: List[Tuple[int, int]]):
    """
    更新上下文缓冲区
    严格按照 Rust 实现：使用 VAD 选择最佳上下文片段（最后一个语音段的尾部）
    """
    global context_buffer
    
    logger.debug(f"update_context_buffer: Starting, audio_len={len(audio_data)}, vad_segments={len(vad_segments)}")
    context_samples = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)
    
    try:
        with context_buffer_lock:
            if len(vad_segments) > 0:
                # 选择最后一个语音段
                last_start, last_end = vad_segments[-1]
                last_segment = audio_data[last_start:last_end]
                
                # 从最后一个语音段的尾部提取上下文
                if len(last_segment) > context_samples:
                    start_idx = len(last_segment) - context_samples
                    context_buffer = last_segment[start_idx:].tolist()
                else:
                    # 如果最后一个段太短，保存整个段
                    context_buffer = last_segment.tolist()
            else:
                # 如果没有检测到语音段，回退到简单尾部保存
                if len(audio_data) > context_samples:
                    start_idx = len(audio_data) - context_samples
                    context_buffer = audio_data[start_idx:].tolist()
                else:
                    context_buffer = audio_data.tolist()
            
            # 限制最大长度
            if len(context_buffer) > CONTEXT_MAX_SAMPLES:
                context_buffer = context_buffer[-CONTEXT_MAX_SAMPLES:]
        
        logger.debug(f"update_context_buffer: Completed, context_buffer_len={len(context_buffer)}")
    except Exception as e:
        logger.error(f"update_context_buffer: Failed to update context buffer: {e}", exc_info=True)
        raise

def get_context_audio() -> np.ndarray:
    """获取上下文音频"""
    with context_buffer_lock:
        if len(context_buffer) > 0:
            return np.array(context_buffer, dtype=np.float32)
        else:
            return np.array([], dtype=np.float32)

def reset_context_buffer():
    """重置上下文缓冲区"""
    global context_buffer
    with context_buffer_lock:
        context_buffer.clear()

def update_text_context(text: str):
    """更新文本上下文缓存（只保留最后一句）"""
    global text_context_cache
    logger.debug(f"update_text_context: Starting, text_len={len(text)}")
    
    try:
        trimmed_text = text.strip()
        if not trimmed_text:
            logger.debug("update_text_context: Text is empty after trimming, skipping")
            return
        
        with text_context_cache_lock:
            # 只保留最后 1 句（替换而不是追加）
            text_context_cache.clear()
            text_context_cache.append(trimmed_text)
        
        logger.debug(f"update_text_context: Completed, cached_text_len={len(trimmed_text)}")
    except Exception as e:
        logger.error(f"update_text_context: Failed to update text context: {e}", exc_info=True)
        raise

def get_text_context() -> str:
    """获取文本上下文（最后一句）"""
    with text_context_cache_lock:
        if len(text_context_cache) > 0:
            return text_context_cache[-1]
        else:
            return ""

def reset_text_context():
    """重置文本上下文缓存"""
    global text_context_cache
    with text_context_cache_lock:
        text_context_cache.clear()

