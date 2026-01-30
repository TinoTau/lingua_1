"""
Faster Whisper + Silero VAD Service - API Models
FastAPI 请求和响应模型定义
"""
from pydantic import BaseModel
from typing import Optional, List, Tuple, Dict

from config import (
    BEAM_SIZE,
    TEMPERATURE,
    PATIENCE,
    COMPRESSION_RATIO_THRESHOLD,
    LOG_PROB_THRESHOLD,
    NO_SPEECH_THRESHOLD,
)
from text_processing import SegmentInfo


class UtteranceRequest(BaseModel):
    """
    Utterance 任务请求
    与 node-inference 的 HttpInferenceRequest 保持一致
    """
    job_id: str  # 任务 ID（用于追踪）
    src_lang: str  # 源语言（支持 "auto" | "zh" | "en" | "ja" | "ko"）
    tgt_lang: Optional[str] = None  # 目标语言（可选，ASR 服务不使用）
    audio: str  # Base64 encoded audio（与 node-inference 一致）
    audio_format: Optional[str] = "pcm16"  # 音频格式（"pcm16" | "opus" - Opus 已废弃，Pipeline 负责解码）
    sample_rate: Optional[int] = 16000  # 采样率
    # ASR 特定参数
    language: Optional[str] = None  # 语言代码（如果 src_lang == "auto"，则自动检测）
    task: str = "transcribe"  # "transcribe" or "translate"
    beam_size: int = BEAM_SIZE  # 从配置文件读取，默认 5（与备份代码一致）
    condition_on_previous_text: bool = False  # 禁用条件生成，避免重复识别（当上下文文本和当前音频内容相同时，会导致重复输出）
    # 新增：提高准确度的参数
    best_of: Optional[int] = 5  # 候选数量（用于非beam search模式，当前使用beam search，此参数不影响）
    temperature: Optional[float] = TEMPERATURE  # 从配置文件读取，默认 0.0（更确定，减少随机性，提高准确度）
    patience: Optional[float] = PATIENCE  # 从配置文件读取，默认 1.0（Beam search耐心值）
    compression_ratio_threshold: Optional[float] = COMPRESSION_RATIO_THRESHOLD  # 从配置文件读取，默认 2.4（压缩比阈值）
    log_prob_threshold: Optional[float] = LOG_PROB_THRESHOLD  # 从配置文件读取，默认 -1.0（对数概率阈值）
    no_speech_threshold: Optional[float] = NO_SPEECH_THRESHOLD  # 从配置文件读取，默认 0.6（无语音阈值）
    use_context_buffer: bool = True  # 是否使用上下文缓冲区
    use_text_context: bool = True  # 是否使用文本上下文
    # 其他参数（与 node-inference 保持一致，但 ASR 服务不使用）
    features: Optional[dict] = None  # 可选功能请求（ASR 服务不使用）
    mode: Optional[str] = None  # 翻译模式（ASR 服务不使用）
    lang_a: Optional[str] = None  # 双向模式语言 A（ASR 服务不使用）
    lang_b: Optional[str] = None  # 双向模式语言 B（ASR 服务不使用）
    auto_langs: Optional[List[str]] = None  # 自动识别语言范围（ASR 服务不使用）
    enable_streaming_asr: Optional[bool] = False  # 是否启用流式 ASR（当前不支持）
    partial_update_interval_ms: Optional[int] = None  # 部分结果更新间隔（当前不支持）
    trace_id: Optional[str] = None  # 追踪 ID（用于全链路日志追踪）
    context_text: Optional[str] = None  # 上下文文本（用于 NMT，ASR 服务不使用）
    # EDGE-4: Padding 配置
    padding_ms: Optional[int] = None  # 尾部静音 padding（毫秒），None 表示不添加 padding


class UtteranceResponse(BaseModel):
    """Utterance 任务响应"""
    text: str  # Full transcribed text
    segments: List[SegmentInfo]  # List of segment info (包含时间戳和元数据)
    language: Optional[str] = None  # Detected language
    language_probability: Optional[float] = None  # 检测到的语言的概率（0.0-1.0）
    language_probabilities: Optional[Dict[str, float]] = None  # 所有语言的概率信息（字典：语言代码 -> 概率）
    duration: float  # Audio duration in seconds
    vad_segments: List[Tuple[int, int]]  # VAD 检测到的语音段（样本索引）


class ResetRequest(BaseModel):
    """重置请求"""
    reset_vad: bool = True  # 重置 VAD 状态
    reset_context: bool = True  # 重置上下文缓冲区
    reset_text_context: bool = True  # 重置文本上下文
