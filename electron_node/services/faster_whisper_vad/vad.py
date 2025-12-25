"""
Faster Whisper + Silero VAD Service - VAD Functions
VAD状态管理和语音活动检测
"""
import numpy as np
import logging
from typing import Optional, List, Tuple
from collections import deque
import threading

from config import (
    VAD_SAMPLE_RATE,
    VAD_FRAME_SIZE,
    VAD_SILENCE_THRESHOLD,
    VAD_BASE_THRESHOLD_MIN_MS,
    VAD_BASE_THRESHOLD_MAX_MS,
)
from models import vad_session

logger = logging.getLogger(__name__)

# ---------------------
# VAD State (严格按照 Rust 实现)
# ---------------------
class VADState:
    """VAD 状态管理，严格按照 Rust 实现"""
    def __init__(self):
        self.hidden_state: Optional[np.ndarray] = None  # [2, 128]
        self.silence_frame_count = 0
        self.last_speech_timestamp: Optional[int] = None
        self.last_boundary_timestamp: Optional[int] = None
        self.frame_buffer: List[float] = []
        
        # 自适应状态
        self.speech_rate_history = deque(maxlen=20)
        base_threshold = (VAD_BASE_THRESHOLD_MIN_MS + VAD_BASE_THRESHOLD_MAX_MS) // 2
        self.base_threshold_ms = base_threshold
        self.sample_count = 0
        
        self.lock = threading.Lock()
    
    def reset(self):
        """重置状态"""
        with self.lock:
            self.hidden_state = None
            self.silence_frame_count = 0
            self.last_speech_timestamp = None
            self.last_boundary_timestamp = None
            self.frame_buffer.clear()
            self.speech_rate_history.clear()
            base_threshold = (VAD_BASE_THRESHOLD_MIN_MS + VAD_BASE_THRESHOLD_MAX_MS) // 2
            self.base_threshold_ms = base_threshold
            self.sample_count = 0

# 全局 VAD 状态（每个会话应该有独立状态，这里简化处理）
vad_state = VADState()

# ---------------------
# VAD Functions (严格按照 Rust 实现)
# ---------------------
def detect_voice_activity_frame(audio_frame: np.ndarray) -> float:
    """
    检测单帧的语音活动概率
    严格按照 Rust 实现
    """
    if len(audio_frame) != VAD_FRAME_SIZE:
        raise ValueError(f"Audio frame length {len(audio_frame)} does not match frame size {VAD_FRAME_SIZE}")
    
    # 归一化到 [-1, 1]
    normalized = np.clip(audio_frame, -1.0, 1.0).astype(np.float32)
    
    # 创建输入数组 [1, frame_size]
    input_array = normalized.reshape(1, -1).astype(np.float32)
    
    # 获取或初始化隐藏状态 [2, 1, 128]
    # 注意：必须在锁外进行ONNX推理，避免死锁
    with vad_state.lock:
        if vad_state.hidden_state is None:
            state_array = np.zeros((2, 1, 128), dtype=np.float32)
        else:
            state_array = vad_state.hidden_state.reshape(2, 1, 128).astype(np.float32)
    
    # 采样率输入 [1]
    sr_array = np.array([VAD_SAMPLE_RATE], dtype=np.int64)
    
    # ONNX 推理（在锁外执行，避免阻塞）
    # 注意：模型输入名称是 'input', 'state', 'sr'（不是 'h'）
    inputs = {
        'input': input_array,
        'state': state_array,  # 修复：使用 'state' 而不是 'h'
        'sr': sr_array
    }
    
    outputs = vad_session.run(None, inputs)
    
    # 提取输出
    output = outputs[0]  # [1, 2] 或 [1, 1]
    if output.shape[1] >= 2:
        raw_output = output[0, 1]  # 第二列是语音概率
    else:
        raw_output = output[0, 0]
    
    # 更新隐藏状态（在锁内更新）
    with vad_state.lock:
        if len(outputs) > 1:
            new_state = outputs[1]  # [2, 1, 128]
            vad_state.hidden_state = new_state.reshape(2, 128)
        
        # 处理输出值（严格按照 Rust 实现）
        if raw_output < -10.0 or raw_output > 10.0:
            # logit，使用 sigmoid 转换
            speech_prob = 1.0 / (1.0 + np.exp(-raw_output))
        elif raw_output < 0.2 and raw_output > -0.01:
            # 小值，需要乘以系数后再应用 sigmoid
            scaled_logit = raw_output * 10.0
            speech_prob = 1.0 / (1.0 + np.exp(-scaled_logit))
        elif raw_output < 0.5:
            # 可能是静音概率，取反
            speech_prob = 1.0 - raw_output
        else:
            # 已经是语音概率
            speech_prob = raw_output
        
        return float(speech_prob)

def detect_speech(audio_data: np.ndarray) -> List[Tuple[int, int]]:
    """
    检测语音活动（用于拼接后的音频块）
    严格按照 Rust 实现
    返回语音段的起止位置列表（样本索引）
    """
    logger.debug(f"detect_speech: Starting VAD detection, audio_len={len(audio_data)}")
    segments = []
    current_segment_start: Optional[int] = None
    
    try:
        frame_count = 0
        for frame_idx in range(0, len(audio_data), VAD_FRAME_SIZE):
            frame = audio_data[frame_idx:frame_idx + VAD_FRAME_SIZE]
            if len(frame) < VAD_FRAME_SIZE:
                break
            
            try:
                speech_prob = detect_voice_activity_frame(frame)
                frame_count += 1
            except Exception as e:
                logger.error(f"detect_speech: Failed to detect voice activity for frame {frame_idx}: {e}", exc_info=True)
                raise
            
            if speech_prob > VAD_SILENCE_THRESHOLD:
                sample_start = frame_idx
                if current_segment_start is None:
                    current_segment_start = sample_start
            else:
                if current_segment_start is not None:
                    sample_end = frame_idx
                    segments.append((current_segment_start, sample_end))
                    current_segment_start = None
        
        # 如果最后一段没有结束，添加它
        if current_segment_start is not None:
            segments.append((current_segment_start, len(audio_data)))
        
        logger.debug(f"detect_speech: VAD detection completed, frames={frame_count}, segments={len(segments)}")
        return segments
    except Exception as e:
        logger.error(f"detect_speech: VAD detection failed: {e}", exc_info=True)
        raise

