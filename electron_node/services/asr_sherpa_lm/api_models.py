"""
ASR Sherpa-LM 服务 - API 模型
HTTP 离线与文档一致：final text + metrics（meta.decode_ms）。
"""
from pydantic import BaseModel
from typing import Optional, List, Dict, Tuple, Any


class SegmentInfo(BaseModel):
    text: str
    start: Optional[float] = None
    end: Optional[float] = None
    no_speech_prob: Optional[float] = None


class UtteranceRequest(BaseModel):
    job_id: str
    src_lang: str
    tgt_lang: Optional[str] = None
    audio: str
    audio_format: Optional[str] = "pcm16"
    sample_rate: Optional[int] = 16000
    language: Optional[str] = None
    task: str = "transcribe"
    beam_size: Optional[int] = None
    condition_on_previous_text: bool = False
    best_of: Optional[int] = None
    temperature: Optional[float] = None
    patience: Optional[float] = None
    compression_ratio_threshold: Optional[float] = None
    log_prob_threshold: Optional[float] = None
    no_speech_threshold: Optional[float] = None
    use_context_buffer: bool = False
    use_text_context: bool = False
    features: Optional[dict] = None
    mode: Optional[str] = None
    lang_a: Optional[str] = None
    lang_b: Optional[str] = None
    auto_langs: Optional[List[str]] = None
    enable_streaming_asr: Optional[bool] = False
    partial_update_interval_ms: Optional[int] = None
    trace_id: Optional[str] = None
    context_text: Optional[str] = None
    padding_ms: Optional[int] = None


class UtteranceResponse(BaseModel):
    text: str
    segments: List[SegmentInfo]
    language: Optional[str] = None
    language_probability: Optional[float] = None
    language_probabilities: Optional[Dict[str, float]] = None
    duration: float
    vad_segments: List[Tuple[int, int]] = []
    meta: Optional[Dict[str, Any]] = None
    nbest: List[Dict[str, Any]] = []
