"""
Faster Whisper + Silero VAD Service
整合 ASR 和 VAD 功能，支持上下文缓冲和 Utterance 任务处理
严格按照现有 Rust 实现
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import logging
import time
import asyncio
import signal
import sys
import traceback
from typing import Optional, List, Tuple, Dict, Any

# Configure logging (必须在导入模块之前，因为导入时可能使用logger)
# 确保 logs 目录存在
import os
log_dir = 'logs'
if not os.path.exists(log_dir):
    os.makedirs(log_dir, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(log_dir, 'faster-whisper-vad-service.log'), encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# 全局异常处理
def handle_exception(exc_type, exc_value, exc_traceback):
    """全局异常处理器"""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    
    logger.critical("=" * 80)
    logger.critical("🚨 Uncaught exception in main process, service may crash")
    logger.critical(f"   Exception type: {exc_type.__name__}")
    logger.critical(f"   Exception value: {exc_value}")
    logger.critical("   Traceback:")
    for line in traceback.format_exception(exc_type, exc_value, exc_traceback):
        logger.critical(f"   {line.rstrip()}")
    logger.critical("=" * 80)
    
    # 调用默认异常处理器
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = handle_exception

# 信号处理（用于记录主进程退出）
def signal_handler(signum, frame):
    """信号处理器"""
    logger.warning(f"Received signal {signum}, preparing to shutdown...")
    if signum == signal.SIGTERM:
        logger.info("SIGTERM received, graceful shutdown")
    elif signum == signal.SIGINT:
        logger.info("SIGINT received (Ctrl+C), graceful shutdown")
    else:
        logger.warning(f"Unexpected signal {signum} received")

# 注册信号处理器（Windows 上可能不支持所有信号）
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
except (AttributeError, ValueError):
    # Windows 可能不支持某些信号
    logger.debug("Some signals not available on this platform")

# 导入配置和模块
from config import (
    PORT,
    MAX_AUDIO_DURATION_SEC,
    CONTEXT_SAMPLE_RATE,
    CONTEXT_DURATION_SEC,
    BEAM_SIZE,
    TEMPERATURE,
    PATIENCE,
    COMPRESSION_RATIO_THRESHOLD,
    LOG_PROB_THRESHOLD,
    NO_SPEECH_THRESHOLD,
)
# 注意：不再导入 asr_model，ASR 推理在独立子进程中执行
from models import vad_session  # 只导入 VAD 模型
from vad import vad_state, detect_speech
from context import (
    get_context_audio,
    update_context_buffer,
    reset_context_buffer,
    get_text_context,
    update_text_context,
    reset_text_context,
)
from text_filter import is_meaningless_transcript
from audio_decoder import decode_audio
from asr_worker_manager import ASRWorkerManager, MAX_WAIT_SECONDS

# ---------------------
# FastAPI App
# ---------------------
app = FastAPI(title="Faster Whisper + Silero VAD Service")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------
# Request/Response Schemas
# ---------------------
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
    beam_size: int = BEAM_SIZE  # 从配置文件读取，默认 10（提高准确度，减少同音字错误）
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

class SegmentInfo(BaseModel):
    """Segment 信息（包含时间戳）"""
    text: str
    start: Optional[float] = None  # 开始时间（秒）
    end: Optional[float] = None    # 结束时间（秒）
    no_speech_prob: Optional[float] = None  # 无语音概率（可选）

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

# ---------------------
# Global ASR Worker Manager
# ---------------------
_asr_worker_manager: Optional[ASRWorkerManager] = None

def get_asr_worker_manager() -> ASRWorkerManager:
    """获取全局 ASR Worker Manager 实例"""
    global _asr_worker_manager
    if _asr_worker_manager is None:
        _asr_worker_manager = ASRWorkerManager()
    return _asr_worker_manager

# ---------------------
# Health Check
# ---------------------
@app.get("/health")
async def health_check():
    """健康检查端点，包含ASR Worker状态"""
    manager = get_asr_worker_manager()
    stats = manager.get_stats()
    return {
        "status": "ok",
        "asr_model_loaded": stats.get("worker_pid") is not None,  # 如果 worker 进程存在，说明模型已加载
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

# ---------------------
# Reset Endpoint
# ---------------------
@app.post("/reset")
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

# ---------------------
# Startup/Shutdown Events
# ---------------------
@app.on_event("startup")
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

@app.on_event("shutdown")
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

# ---------------------
# Utterance Endpoint
# ---------------------
@app.post("/utterance", response_model=UtteranceResponse)
async def process_utterance(req: UtteranceRequest):
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
    # 严格按照 node-inference 的日志格式
    logger.info(f"[{trace_id}] Received utterance request: job_id={req.job_id}, audio_format={req.audio_format}, sample_rate={req.sample_rate}")
    
    # 详细记录入参信息（用于调试重复问题）
    logger.info(
        f"[{trace_id}] ========== ASR 接口入参 =========="
    )
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
        # 1. 解码音频
        audio_format = req.audio_format or "pcm16"
        sample_rate = req.sample_rate or 16000
        
        logger.info(f"[{trace_id}] Audio format: {audio_format}, sample_rate: {sample_rate}")
        
        try:
            audio, sr = decode_audio(req.audio, audio_format, sample_rate, trace_id)
        except ValueError as e:
            logger.error(f"[{trace_id}] Audio decoding failed: {e}")
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            # 捕获所有其他异常（包括可能的segfault前的异常）
            logger.critical(
                f"[{trace_id}] 🚨 CRITICAL: Audio decoding raised unexpected exception: {e}, "
                f"error_type={type(e).__name__}",
                exc_info=True
            )
            raise HTTPException(status_code=500, detail=f"Audio decoding error: {str(e)}")
        
        # 2. 检查音频长度限制（防止 GPU 内存溢出和栈缓冲区溢出）
        audio_duration = len(audio) / sr
        if audio_duration > MAX_AUDIO_DURATION_SEC:
            logger.warning(
                f"[{trace_id}] Audio duration ({audio_duration:.2f}s) exceeds maximum ({MAX_AUDIO_DURATION_SEC}s), "
                f"truncating to {MAX_AUDIO_DURATION_SEC}s"
            )
            max_samples = int(MAX_AUDIO_DURATION_SEC * sr)
            audio = audio[:max_samples]
        
        # 3. 重采样到指定采样率（默认 16kHz）
        if sr != sample_rate:
            logger.warning(f"[{trace_id}] Audio sample rate is {sr}Hz, expected {sample_rate}Hz. Resampling...")
            from scipy import signal
            num_samples = int(len(audio) * sample_rate / sr)
            audio = signal.resample(audio, num_samples).astype(np.float32)
            sr = sample_rate
        
        # 3.1 重采样后再次检查音频长度限制
        audio_duration = len(audio) / sr
        if audio_duration > MAX_AUDIO_DURATION_SEC:
            logger.warning(
                f"[{trace_id}] Audio duration after resampling ({audio_duration:.2f}s) exceeds maximum ({MAX_AUDIO_DURATION_SEC}s), "
                f"truncating to {MAX_AUDIO_DURATION_SEC}s"
            )
            max_samples = int(MAX_AUDIO_DURATION_SEC * sr)
            audio = audio[:max_samples]
        
        # 确保音频是连续的
        if not audio.flags['C_CONTIGUOUS']:
            audio = np.ascontiguousarray(audio)
        
        # EDGE-4: Padding（在音频末尾添加静音）
        if req.padding_ms is not None and req.padding_ms > 0:
            padding_samples = int((req.padding_ms / 1000.0) * sr)
            if padding_samples > 0:
                padding = np.zeros(padding_samples, dtype=np.float32)
                audio = np.concatenate([audio, padding])
                logger.info(
                    f"[{trace_id}] EDGE-4: Applied padding: {req.padding_ms}ms "
                    f"({padding_samples} samples), total_duration={len(audio)/sr:.3f}s"
                )
        
        # 4. 确定语言（如果 src_lang == "auto"，则使用 language 或自动检测）
        asr_language = None
        if req.src_lang != "auto":
            asr_language = req.src_lang
        elif req.language:
            asr_language = req.language
        # 如果都是 None，Faster Whisper 会自动检测
        
        # 严格按照 node-inference 的日志格式
        logger.debug(f"[{trace_id}] trace_id={trace_id} src_lang={req.src_lang} '开始 ASR 语音识别'")
        
        # 5. 前置上下文音频（如果启用）
        # 严格按照 node-inference 的日志格式
        if req.use_context_buffer:
            context_audio = get_context_audio()
            if len(context_audio) > 0:
                audio_with_context = np.concatenate([context_audio, audio])
                context_duration_sec = len(context_audio) / sr
                original_duration_sec = len(audio) / sr
                total_duration_sec = len(audio_with_context) / sr
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
                    f"original_duration_sec={len(audio)/sr:.3f} "
                    f"'ℹ️ 上下文缓冲区为空，使用原始音频（第一个utterance或上下文已清空）'"
                )
        else:
            audio_with_context = audio
        
        # 6. 使用 VAD 检测有效语音段（Level 2断句）
        # 严格按照 node-inference 的日志格式
        try:
            vad_segments = detect_speech(audio_with_context)
        except Exception as e:
            # VAD检测失败，回退到完整音频
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
            MIN_AUDIO_SAMPLES = int(sr * 0.5)  # 0.5秒
            if len(processed_audio) < MIN_AUDIO_SAMPLES:
                logger.warning(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"processed_samples={len(processed_audio)} "
                    f"'VAD处理后的音频过短，使用原始音频'"
                )
                processed_audio = audio_with_context
        
        # 6.1 最终检查：确保传递给 Faster Whisper 的音频不超过最大长度
        processed_audio_duration = len(processed_audio) / sr
        if processed_audio_duration > MAX_AUDIO_DURATION_SEC:
            logger.warning(
                f"[{trace_id}] Processed audio duration ({processed_audio_duration:.2f}s) exceeds maximum ({MAX_AUDIO_DURATION_SEC}s), "
                f"truncating to {MAX_AUDIO_DURATION_SEC}s before ASR"
            )
            max_samples = int(MAX_AUDIO_DURATION_SEC * sr)
            processed_audio = processed_audio[:max_samples]
        
        # 7. 获取文本上下文（用于 Faster Whisper 的 initial_prompt）
        text_context = ""
        if req.use_text_context:
            text_context = get_text_context()
            if text_context:
                logger.info(
                    f"[{trace_id}] "
                    f"Using text context ({len(text_context)} chars): \"{text_context[:100]}...\""
                )
                # 记录完整的文本上下文（用于调试重复问题）
                logger.info(
                    f"[{trace_id}] ASR 文本上下文 (完整): \"{text_context}\""
                )
            else:
                logger.info(
                    f"[{trace_id}] No text context available (first utterance or context was reset)"
                )
        
        # 8. 验证音频数据格式（防止Faster Whisper崩溃）
        # 检查音频数据是否有效
        if len(processed_audio) == 0:
            logger.error(f"[{trace_id}] Processed audio is empty, cannot perform ASR")
            raise HTTPException(status_code=400, detail="Processed audio is empty")
        
        # 检查NaN和Inf值
        if np.any(np.isnan(processed_audio)) or np.any(np.isinf(processed_audio)):
            logger.error(f"[{trace_id}] Processed audio contains NaN or Inf values")
            # 清理NaN和Inf值
            processed_audio = np.nan_to_num(processed_audio, nan=0.0, posinf=1.0, neginf=-1.0)
            logger.warning(f"[{trace_id}] Cleaned NaN/Inf values from audio")
        
        # 确保音频数据在有效范围内（[-1.0, 1.0]）
        if np.any(np.abs(processed_audio) > 1.0):
            logger.warning(f"[{trace_id}] Audio values out of range [-1.0, 1.0], clipping")
            processed_audio = np.clip(processed_audio, -1.0, 1.0)
        
        # 确保音频是连续的numpy数组
        if not isinstance(processed_audio, np.ndarray):
            processed_audio = np.array(processed_audio, dtype=np.float32)
        if processed_audio.dtype != np.float32:
            processed_audio = processed_audio.astype(np.float32)
        if not processed_audio.flags['C_CONTIGUOUS']:
            processed_audio = np.ascontiguousarray(processed_audio)
        
        # 记录音频数据信息（用于调试和崩溃诊断）
        audio_std = np.std(processed_audio)
        audio_rms = np.sqrt(np.mean(processed_audio ** 2))
        audio_dynamic_range = np.max(processed_audio) - np.min(processed_audio)
        audio_duration = len(processed_audio) / sr
        
        logger.info(
            f"[{trace_id}] Audio data validation: "
            f"shape={processed_audio.shape}, "
            f"dtype={processed_audio.dtype}, "
            f"min={np.min(processed_audio):.4f}, "
            f"max={np.max(processed_audio):.4f}, "
            f"mean={np.mean(processed_audio):.4f}, "
            f"std={audio_std:.4f}, "
            f"rms={audio_rms:.4f}, "
            f"dynamic_range={audio_dynamic_range:.4f}, "
            f"duration={audio_duration:.3f}s, "
            f"is_contiguous={processed_audio.flags['C_CONTIGUOUS']}"
        )
        
        # 7.5. 音频质量检查（防止低质量音频进入 ASR）
        # 如果音频质量太差，直接返回空响应，避免浪费 ASR 资源
        # 注意：Faster Whisper 通常需要至少 0.5-1 秒的音频才能有效识别
        # 调整阈值以适应实际使用场景和Opus编码后的音频质量
        # 关键修复：降低阈值，适应 Opus 编码后的音频特性
        # 从日志看，Opus 编码后的音频 RMS/STD 值通常较低（0.0003-0.0007），
        # 但这些音频仍然可能包含有效语音，应该让 ASR 模型来判断
        # 降低阈值，减少误判，让更多有效音频进入 ASR
        MIN_AUDIO_RMS = 0.0005  # 最小 RMS 能量（降低到 0.0005，适应 Opus 编码音频）
        MIN_AUDIO_STD = 0.0005  # 最小标准差（降低到 0.0005，适应 Opus 编码音频）
        MIN_AUDIO_DYNAMIC_RANGE = 0.005  # 最小动态范围（降低到 0.005，适应 Opus 编码音频）
        # 关键修复：增加最短音频时长检查
        # Faster Whisper 通常需要至少 0.5-1 秒的音频才能有效识别
        # 虽然质量检查允许 0.3 秒，但实际 ASR 识别需要更长的音频
        MIN_AUDIO_DURATION = 0.3  # 最小时长（秒），降低到 0.3 秒，让更多短音频进入 ASR
        
        audio_quality_issues = []
        
        if audio_rms < MIN_AUDIO_RMS:
            audio_quality_issues.append(f"RMS too low ({audio_rms:.4f} < {MIN_AUDIO_RMS})")
        
        if audio_std < MIN_AUDIO_STD:
            audio_quality_issues.append(f"std too low ({audio_std:.4f} < {MIN_AUDIO_STD})")
        
        if audio_dynamic_range < MIN_AUDIO_DYNAMIC_RANGE:
            audio_quality_issues.append(f"dynamic_range too small ({audio_dynamic_range:.4f} < {MIN_AUDIO_DYNAMIC_RANGE})")
        
        if audio_duration < MIN_AUDIO_DURATION:
            audio_quality_issues.append(f"duration too short ({audio_duration:.3f}s < {MIN_AUDIO_DURATION}s)")
        
        if audio_quality_issues:
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"audio_rms={audio_rms:.4f} "
                f"audio_std={audio_std:.4f} "
                f"audio_dynamic_range={audio_dynamic_range:.4f} "
                f"audio_duration={audio_duration:.3f}s "
                f"issues={', '.join(audio_quality_issues)} "
                f"'Audio quality too poor (likely silence, noise, or decoding issue), skipping ASR and returning empty response'"
            )
            # 返回空结果，不调用 ASR
            return UtteranceResponse(
                text="",
                segments=[],
                language=asr_language or "unknown",
                duration=audio_duration,
                vad_segments=vad_segments,
            )
        
        # 8. 使用 ASR Worker Manager 进行 ASR（进程隔离架构）
        asr_start_time = time.time()
        
        # 获取ASR Worker Manager
        manager = get_asr_worker_manager()
        
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
        logger.info(
            f"[{trace_id}] ========== ASR 识别请求开始 =========="
        )
        logger.info(
            f"[{trace_id}] ASR 参数: "
            f"language={asr_language}, "
            f"task={req.task}, "
            f"beam_size={req.beam_size}, "
            f"condition_on_previous_text={req.condition_on_previous_text}, "
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
            f"sample_rate={sr}, "
            f"duration_sec={len(processed_audio) / sr:.2f}"
        )
        
        try:
            # 提交任务到ASR Worker进程
            asr_result = await manager.submit_task(
                audio=processed_audio,
                sample_rate=sr,
                language=asr_language,
                task=req.task,
                beam_size=req.beam_size,
                initial_prompt=text_context if text_context else None,
                condition_on_previous_text=req.condition_on_previous_text,
                trace_id=trace_id,
                max_wait=MAX_WAIT_SECONDS,
                # 传递优化参数以提高准确度
                best_of=req.best_of,
                temperature=req.temperature,
                patience=req.patience,
                compression_ratio_threshold=req.compression_ratio_threshold,
                log_prob_threshold=req.log_prob_threshold,
                no_speech_threshold=req.no_speech_threshold,
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
            language_probabilities = asr_result.language_probabilities  # 新增：语言概率信息
            segments_info_raw = asr_result.segments  # 新增：Segment 元数据
            duration_sec = asr_result.duration_ms / 1000.0 if asr_result.duration_ms > 0 else 0.0
            
            # 计算检测到的语言的概率（如果 language_probabilities 存在）
            language_probability = None
            if language_probabilities and detected_language:
                language_probability = language_probabilities.get(detected_language)
                if language_probability is not None:
                    logger.info(
                        f"[{trace_id}] ASR 语言检测概率: language={detected_language}, "
                        f"probability={language_probability:.4f}"
                    )
            
            logger.info(
                f"[{trace_id}] ========== ASR 接口输出结果 =========="
            )
            logger.info(
                f"[{trace_id}] ASR Worker completed successfully, "
                f"text_len={len(full_text)}, language={detected_language}, "
                f"duration_ms={asr_result.duration_ms}"
            )
            logger.info(
                f"[{trace_id}] ASR 接口输出原始文本 (repr): {repr(full_text)}"
            )
            logger.info(
                f"[{trace_id}] ASR 接口输出原始文本 (preview): '{full_text[:200]}'"
            )
            logger.info(
                f"[{trace_id}] ASR 接口输出原始文本 (bytes): {full_text.encode('utf-8') if full_text else b''}"
            )
            
            # 使用真正的 segments 数据（包含时间戳）
            segments_info: List[SegmentInfo] = []
            if segments_info_raw:
                # 转换 SegmentInfo 对象为 Pydantic 模型
                segments_info = [
                    SegmentInfo(
                        text=seg.text,
                        start=seg.start,
                        end=seg.end,
                        no_speech_prob=seg.no_speech_prob,
                    )
                    for seg in segments_info_raw
                ]
            
            # 如果 segments 为空，从文本生成（向后兼容）
            if not segments_info and full_text:
                # 按空格分割作为后备方案
                segment_texts_split = [s.strip() for s in full_text.split() if s.strip()]
                if segment_texts_split:
                    segments_info = [
                        SegmentInfo(text=text, start=None, end=None, no_speech_prob=None)
                        for text in segment_texts_split
                    ]
                else:
                    segments_info = [SegmentInfo(text=full_text, start=None, end=None, no_speech_prob=None)]
            
            # 保存检测到的语言和时长，供后续使用
            info_language = detected_language
            # language_probability 和 language_probabilities 已经在上面计算/提取
            info_duration = duration_sec
            
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
            # Worker 进程不可用
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
        
        asr_elapsed = time.time() - asr_start_time
        
        logger.info(f"[{trace_id}] Step 8.1: Text extraction completed, segments={len(segments_info)}, full_text_len={len(full_text)}")
        
        # 记录 ASR 处理时间（用于性能监控）
        if asr_elapsed > 1.0:
            audio_duration = len(processed_audio) / sr
            ratio = asr_elapsed / audio_duration if audio_duration > 0 else 0
            logger.warning(
                f"[{trace_id}] "
                f"⚠️ ASR processing took {asr_elapsed:.2f}s "
                f"(audio duration: {audio_duration:.2f}s, ratio: {ratio:.2f}x)"
            )
        
        logger.info(f"[{trace_id}] Step 9: Starting ASR result processing")
        
        # 9. ASR 识别完成，记录结果
        # 严格按照 node-inference 的日志格式
        try:
            full_text_trimmed = full_text.strip()
            logger.info(f"[{trace_id}] Step 9.1: Text trimmed, len={len(full_text_trimmed)}")
            
            # 9.2. 去重处理：移除重复的文本片段
            # 问题：ASR模型使用initial_prompt和condition_on_previous_text可能导致重复识别
            # 例如："这边能不能用这边能不能用" -> "这边能不能用"
            if full_text_trimmed:
                from text_deduplicator import deduplicate_text
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
                
                # 注意：跨 utterance 去重已迁移到 Aggregator 层（节点端）
                # Step 9.2 保留：单个 utterance 内部去重（处理如 "这边能不能用这边能不能用" 的情况）
                # Step 9.3 已移除：跨 utterance 去重由 Aggregator 统一处理，避免重复处理，职责更清晰
                
                # 修复：在ASR之后进行跨utterance的文本过滤
                # 当音频质量较差（静音或白噪音）时，ASR模型可能会基于initial_prompt生成文本
                # 导致识别出的文本是前一个utterance的部分内容
                # 需要在ASR服务内部进行过滤，避免返回重复文本
                # 改进：只有在音频质量很差时才进行过滤，避免误判用户真的说了类似的话
                if text_context and full_text_trimmed:
                    # 标准化文本（去除空格差异）
                    def normalize_text(text: str) -> str:
                        return text.replace('\n', ' ').replace('\r', ' ').replace('\t', ' ').replace(' ', '').strip()
                    
                    normalized_current = normalize_text(full_text_trimmed)
                    normalized_context = normalize_text(text_context)
                    
                    # 检查音频质量：只有当音频质量很差时才进行子串过滤
                    # 从日志看，Job8-17 的音频质量都很差（RMS < 0.001, duration < 1.0）
                    # 正常的音频应该 RMS > 0.001 且 duration > 1.0
                    # 如果音频质量正常，即使文本有子串关系，也可能是用户真的说了类似的话，不应该过滤
                    POOR_AUDIO_RMS_THRESHOLD = 0.001  # RMS 阈值（低于此值认为音频质量差）
                    POOR_AUDIO_DURATION_THRESHOLD = 1.0  # 时长阈值（低于此值认为音频质量差）
                    
                    is_poor_audio_quality = (
                        audio_rms < POOR_AUDIO_RMS_THRESHOLD or 
                        audio_duration < POOR_AUDIO_DURATION_THRESHOLD
                    )
                    
                    # 检查当前文本是否是上下文文本的子串（至少3个字符，避免误判）
                    if len(normalized_current) >= 3 and normalized_context and normalized_context.find(normalized_current) != -1:
                        if is_poor_audio_quality:
                            logger.warning(
                                f"[{trace_id}] Step 9.3: Current text is a substring of context text, "
                                f"and audio quality is poor (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                                f"likely generated from initial_prompt due to poor audio quality. "
                                f"Filtering to avoid duplicate output. "
                                f"current_text='{full_text_trimmed[:50]}', "
                                f"context_text='{text_context[:50]}'"
                            )
                            # 返回空结果，避免重复输出
                            full_text_trimmed = ""
                        else:
                            logger.info(
                                f"[{trace_id}] Step 9.3: Current text is a substring of context text, "
                                f"but audio quality is normal (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                                f"likely user actually said similar content. Not filtering. "
                                f"current_text='{full_text_trimmed[:50]}', "
                                f"context_text='{text_context[:50]}'"
                            )
                    
                    # 检查上下文文本是否是当前文本的子串（至少3个字符，避免误判）
                    elif len(normalized_context) >= 3 and normalized_current and normalized_current.find(normalized_context) != -1:
                        if is_poor_audio_quality:
                            logger.warning(
                                f"[{trace_id}] Step 9.3: Context text is a substring of current text, "
                                f"and audio quality is poor (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                                f"likely generated from initial_prompt due to poor audio quality. "
                                f"Filtering to avoid duplicate output. "
                                f"current_text='{full_text_trimmed[:50]}', "
                                f"context_text='{text_context[:50]}'"
                            )
                            # 返回空结果，避免重复输出
                            full_text_trimmed = ""
                        else:
                            logger.info(
                                f"[{trace_id}] Step 9.3: Context text is a substring of current text, "
                                f"but audio quality is normal (rms={audio_rms:.4f}, duration={audio_duration:.3f}s), "
                                f"likely user actually said similar content. Not filtering. "
                                f"current_text='{full_text_trimmed[:50]}', "
                                f"context_text='{text_context[:50]}'"
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
        
        # 在去重后，重新生成 segments_info（使用去重后的文本）
        # 注意：去重可能会改变文本，所以需要重新生成 segments
        # 但尽量保留时间戳信息（如果原始 segments 存在）
        if segments_info and full_text_trimmed != full_text:
            # 文本被去重修改了，需要重新生成 segments
            # 简单处理：按空格分割，但保留第一个 segment 的时间戳（如果存在）
            segment_texts_split = [s.strip() for s in full_text_trimmed.split() if s.strip()]
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
                segments_info = [SegmentInfo(text=full_text_trimmed, start=None, end=None, no_speech_prob=None)]
        elif not segments_info and full_text_trimmed:
            # 如果原始 segments 为空，从去重后的文本生成
            segment_texts_split = [s.strip() for s in full_text_trimmed.split() if s.strip()]
            if segment_texts_split:
                segments_info = [
                    SegmentInfo(text=text, start=None, end=None, no_speech_prob=None)
                    for text in segment_texts_split
                ]
            else:
                segments_info = [SegmentInfo(text=full_text_trimmed, start=None, end=None, no_speech_prob=None)]
        
        logger.info(f"[{trace_id}] Step 10: Starting text validation")
        
        # 10. 检查文本是否为无意义的识别结果（严格按照 node_inference 实现）
        # 重要：只有在文本有意义时才更新上下文缓冲区，避免静音音频污染上下文
        try:
            if not full_text_trimmed:
                logger.warning(
                    f"[{trace_id}] trace_id={trace_id} "
                    f"transcript='{full_text}' "
                    f"'ASR transcript is empty, skipping NMT and TTS, and NOT updating context buffer'"
                )
                logger.info(f"[{trace_id}] Step 10.1: Returning empty response (empty transcript)")
                # 返回空结果，不更新上下文
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
                # 返回空结果，不更新上下文
                return UtteranceResponse(
                    text="",
                    segments=[],
                    language=info_language,
                    duration=info_duration,
                    vad_segments=[],
                )
        
        logger.info(f"[{trace_id}] Step 11: Starting text context update (use_text_context={req.use_text_context})")
        
        # 11. 更新文本上下文缓存（只更新有意义的文本）
        # 关键修复：使用去重后的文本更新上下文缓存，避免重复文本被反复使用
        try:
            if req.use_text_context:
                # 只保留最后一句
                logger.info(f"[{trace_id}] Step 11.1: Splitting text into sentences")
                sentences = full_text_trimmed.split('.')  # 使用去重后的文本
                if len(sentences) > 1:
                    last_sentence = sentences[-1].strip()
                    if last_sentence and not is_meaningless_transcript(last_sentence):
                        logger.info(f"[{trace_id}] Step 11.2: Updating text context with last sentence (deduplicated)")
                        update_text_context(last_sentence)
                        logger.info(f"[{trace_id}] Step 11.2: Text context updated successfully")
                else:
                    if not is_meaningless_transcript(full_text_trimmed):
                        logger.info(f"[{trace_id}] Step 11.3: Updating text context with full text (deduplicated)")
                        update_text_context(full_text_trimmed)
                        logger.info(f"[{trace_id}] Step 11.3: Text context updated successfully")
            logger.info(f"[{trace_id}] Step 11: Text context update completed")
        except Exception as e:
            logger.error(f"[{trace_id}] Step 11: Failed to update text context: {e}", exc_info=True)
            raise
        
        logger.info(f"[{trace_id}] Step 12: Starting context buffer update (use_context_buffer={req.use_context_buffer})")
        
        # 12. 更新上下文缓冲区（使用原始音频，不带上下文）
        # 重要：只有在文本有意义时才更新上下文缓冲区
        # 严格按照 node-inference 的日志格式
        try:
            if req.use_context_buffer:
                # 使用 VAD 检测原始音频的语音段
                logger.info(f"[{trace_id}] Step 12.1: Starting VAD detection for context buffer (audio_len={len(audio)})")
                try:
                    original_vad_segments = detect_speech(audio)
                    logger.info(f"[{trace_id}] Step 12.1: VAD detection completed, segments={len(original_vad_segments)}")
                except Exception as e:
                    # VAD检测失败，回退到简单尾部保存
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
        
        logger.info(f"[{trace_id}] Step 13: Starting response construction")
        
        # 13. 返回结果
        # 关键修复：返回去重后的文本，而不是原始文本
        try:
            response = UtteranceResponse(
                text=full_text_trimmed,  # 使用去重后的文本
                segments=segments_info,  # 使用包含时间戳的 segments
                language=info_language,
                language_probability=language_probability,  # 新增：检测到的语言的概率
                language_probabilities=language_probabilities,  # 新增：所有语言的概率信息
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

# ---------------------
# Main
# ---------------------
if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting Faster Whisper + Silero VAD service on port {PORT}...")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
