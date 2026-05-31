"""
Faster Whisper + Silero VAD Service - Shared Types
共享的数据类型定义
"""
from typing import Optional, Dict, List
from dataclasses import dataclass
from enum import Enum
from pydantic import BaseModel


class WorkerState(Enum):
    """Worker 状态"""
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    CRASHED = "crashed"
    RESTARTING = "restarting"


@dataclass
class WordInfo:
    """Word-level ASR metadata (requires word_timestamps=True)."""
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    probability: Optional[float] = None


class WordInfoModel(BaseModel):
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    probability: Optional[float] = None


@dataclass
class SegmentInfo:
    """Segment 信息（用于进程间通信）"""
    text: str
    start: Optional[float] = None  # 开始时间（秒）
    end: Optional[float] = None    # 结束时间（秒）
    no_speech_prob: Optional[float] = None  # 无语音概率（可选）
    avg_logprob: Optional[float] = None
    compression_ratio: Optional[float] = None
    words: Optional[List[WordInfo]] = None


class SegmentInfoModel(BaseModel):
    """Segment 信息（用于API响应）"""
    text: str
    start: Optional[float] = None  # 开始时间（秒）
    end: Optional[float] = None    # 结束时间（秒）
    no_speech_prob: Optional[float] = None  # 无语音概率（可选）
    avg_logprob: Optional[float] = None
    compression_ratio: Optional[float] = None
    words: Optional[List[WordInfoModel]] = None


@dataclass
class ASRResult:
    """ASR 结果（用于进程间通信）"""
    job_id: str
    text: Optional[str] = None
    language: Optional[str] = None
    language_probabilities: Optional[Dict[str, float]] = None
    segments: Optional[List[SegmentInfo]] = None
    duration_ms: int = 0
    error: Optional[str] = None
