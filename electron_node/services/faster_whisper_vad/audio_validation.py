"""
Faster Whisper + Silero VAD Service - Audio Validation
音频验证和质量检查功能
"""
import numpy as np
import logging
from typing import Tuple, List

from config import MAX_AUDIO_DURATION_SEC

logger = logging.getLogger(__name__)

# 音频质量检查阈值
MIN_AUDIO_RMS = 0.0005  # 最小 RMS 能量（降低到 0.0005，适应 Opus 编码音频）
MIN_AUDIO_STD = 0.0005  # 最小标准差（降低到 0.0005，适应 Opus 编码音频）
MIN_AUDIO_DYNAMIC_RANGE = 0.005  # 最小动态范围（降低到 0.005，适应 Opus 编码音频）
MIN_AUDIO_DURATION = 0.3  # 最小时长（秒），降低到 0.3 秒，让更多短音频进入 ASR


def validate_audio_format(audio: np.ndarray, trace_id: str) -> np.ndarray:
    """
    验证和清理音频数据格式（防止Faster Whisper崩溃）
    
    Args:
        audio: 音频数组
        trace_id: 追踪ID（用于日志）
    
    Returns:
        验证后的音频数组
    """
    # 检查音频数据是否有效
    if len(audio) == 0:
        logger.error(f"[{trace_id}] Processed audio is empty, cannot perform ASR")
        raise ValueError("Processed audio is empty")
    
    # 检查NaN和Inf值
    if np.any(np.isnan(audio)) or np.any(np.isinf(audio)):
        logger.error(f"[{trace_id}] Processed audio contains NaN or Inf values")
        # 清理NaN和Inf值
        audio = np.nan_to_num(audio, nan=0.0, posinf=1.0, neginf=-1.0)
        logger.warning(f"[{trace_id}] Cleaned NaN/Inf values from audio")
    
    # 确保音频数据在有效范围内（[-1.0, 1.0]）
    if np.any(np.abs(audio) > 1.0):
        logger.warning(f"[{trace_id}] Audio values out of range [-1.0, 1.0], clipping")
        audio = np.clip(audio, -1.0, 1.0)
    
    # 确保音频是连续的numpy数组
    if not isinstance(audio, np.ndarray):
        audio = np.array(audio, dtype=np.float32)
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    if not audio.flags['C_CONTIGUOUS']:
        audio = np.ascontiguousarray(audio)
    
    return audio


def log_audio_validation_info(audio: np.ndarray, sample_rate: int, trace_id: str) -> Tuple[float, float, float, float]:
    """
    记录音频数据信息（用于调试和崩溃诊断）
    
    Args:
        audio: 音频数组
        sample_rate: 采样率
        trace_id: 追踪ID（用于日志）
    
    Returns:
        (audio_std, audio_rms, audio_dynamic_range, audio_duration)
    """
    audio_std = np.std(audio)
    audio_rms = np.sqrt(np.mean(audio ** 2))
    audio_dynamic_range = np.max(audio) - np.min(audio)
    audio_duration = len(audio) / sample_rate
    
    logger.info(
        f"[{trace_id}] Audio data validation: "
        f"shape={audio.shape}, "
        f"dtype={audio.dtype}, "
        f"min={np.min(audio):.4f}, "
        f"max={np.max(audio):.4f}, "
        f"mean={np.mean(audio):.4f}, "
        f"std={audio_std:.4f}, "
        f"rms={audio_rms:.4f}, "
        f"dynamic_range={audio_dynamic_range:.4f}, "
        f"duration={audio_duration:.3f}s, "
        f"is_contiguous={audio.flags['C_CONTIGUOUS']}"
    )
    
    return audio_std, audio_rms, audio_dynamic_range, audio_duration


def check_audio_quality(
    audio: np.ndarray,
    sample_rate: int,
    trace_id: str
) -> Tuple[bool, List[str]]:
    """
    检查音频质量（防止低质量音频进入 ASR）
    
    Args:
        audio: 音频数组
        sample_rate: 采样率
        trace_id: 追踪ID（用于日志）
    
    Returns:
        (is_quality_ok, quality_issues) - 质量是否合格，质量问题列表
    """
    audio_std = np.std(audio)
    audio_rms = np.sqrt(np.mean(audio ** 2))
    audio_dynamic_range = np.max(audio) - np.min(audio)
    audio_duration = len(audio) / sample_rate
    
    audio_quality_issues = []
    
    if audio_rms < MIN_AUDIO_RMS:
        audio_quality_issues.append(f"RMS too low ({audio_rms:.4f} < {MIN_AUDIO_RMS})")
    
    if audio_std < MIN_AUDIO_STD:
        audio_quality_issues.append(f"std too low ({audio_std:.4f} < {MIN_AUDIO_STD})")
    
    if audio_dynamic_range < MIN_AUDIO_DYNAMIC_RANGE:
        audio_quality_issues.append(f"dynamic_range too small ({audio_dynamic_range:.4f} < {MIN_AUDIO_DYNAMIC_RANGE})")
    
    if audio_duration < MIN_AUDIO_DURATION:
        audio_quality_issues.append(f"duration too short ({audio_duration:.3f}s < {MIN_AUDIO_DURATION}s)")
    
    is_quality_ok = len(audio_quality_issues) == 0
    
    if not is_quality_ok:
        logger.warning(
            f"[{trace_id}] trace_id={trace_id} "
            f"audio_rms={audio_rms:.4f} "
            f"audio_std={audio_std:.4f} "
            f"audio_dynamic_range={audio_dynamic_range:.4f} "
            f"audio_duration={audio_duration:.3f}s "
            f"issues={', '.join(audio_quality_issues)} "
            f"'Audio quality too poor (likely silence, noise, or decoding issue), skipping ASR and returning empty response'"
        )
    
    return is_quality_ok, audio_quality_issues


def truncate_audio_if_needed(audio: np.ndarray, sample_rate: int, trace_id: str) -> np.ndarray:
    """
    如果音频超过最大长度，截断音频
    
    Args:
        audio: 音频数组
        sample_rate: 采样率
        trace_id: 追踪ID（用于日志）
    
    Returns:
        截断后的音频数组
    """
    audio_duration = len(audio) / sample_rate
    if audio_duration > MAX_AUDIO_DURATION_SEC:
        logger.warning(
            f"[{trace_id}] Audio duration ({audio_duration:.2f}s) exceeds maximum ({MAX_AUDIO_DURATION_SEC}s), "
            f"truncating to {MAX_AUDIO_DURATION_SEC}s"
        )
        max_samples = int(MAX_AUDIO_DURATION_SEC * sample_rate)
        audio = audio[:max_samples]
    return audio
