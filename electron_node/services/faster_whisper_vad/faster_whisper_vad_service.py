"""
Faster Whisper + Silero VAD Service
整合 ASR 和 VAD 功能，支持上下文缓冲和 Utterance 任务处理
严格按照现有 Rust 实现
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from faster_whisper import WhisperModel
import onnxruntime as ort
import numpy as np
import soundfile as sf
import io
import os
import logging
import base64
from typing import Optional, List, Tuple
from collections import deque
import threading

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------
# Configuration
# ---------------------
# Faster Whisper
# 模型路径：支持 HuggingFace 模型标识符或本地路径
ASR_MODEL_PATH = os.getenv("ASR_MODEL_PATH", "Systran/faster-whisper-base")
# 缓存目录：如果设置了 WHISPER_CACHE_DIR，Faster Whisper 会使用该目录作为模型缓存
WHISPER_CACHE_DIR = os.getenv("WHISPER_CACHE_DIR")
# GPU 配置：优先使用 CUDA（如果可用），否则使用 CPU
# 检测 CUDA 可用性：优先通过 CTranslate2 检测，其次通过环境变量
def check_cuda_available():
    """检测 CUDA 是否真正可用"""
    # 方法1：检查环境变量（快速检查）
    cuda_path = os.getenv("CUDA_PATH")
    if cuda_path:
        logger.info(f"CUDA_PATH environment variable found: {cuda_path}")
        # 方法2：尝试导入 ctranslate2 并检查 CUDA 支持（更可靠）
        try:
            import ctranslate2
            # 检查 CUDA 设备是否支持
            # 如果 ctranslate2 安装了 CUDA 版本，get_supported_compute_types 会返回支持的 compute types
            try:
                compute_types = ctranslate2.get_supported_compute_types("cuda")
                if compute_types:
                    logger.info(f"CTranslate2 CUDA support confirmed. Available compute types: {compute_types}")
                    return True
                else:
                    logger.warning("CTranslate2 installed but CUDA compute types not available")
            except Exception as e:
                logger.warning(f"CTranslate2 CUDA check failed: {e}, will try CUDA anyway")
        except ImportError:
            logger.warning("ctranslate2 not available, cannot verify CUDA support")
        except Exception as e:
            logger.warning(f"Error checking CTranslate2 CUDA support: {e}")
        # 如果环境变量设置了 CUDA_PATH，假设 CUDA 可用（让实际加载时验证）
        return True
    else:
        logger.info("CUDA_PATH environment variable not set, CUDA not available")
    return False

_cuda_available = check_cuda_available()

# 如果环境变量强制指定了设备，使用环境变量的值；否则根据 CUDA 可用性自动选择
# 注意：如果环境变量强制指定了 cuda，即使检测不到 CUDA，也会尝试使用（让实际加载时验证）
env_device = os.getenv("ASR_DEVICE")
if env_device:
    ASR_DEVICE = env_device.lower()
    logger.info(f"Using device from environment variable: {ASR_DEVICE}")
    # 如果强制使用 cuda 但检测不到，给出警告
    if ASR_DEVICE == "cuda" and not _cuda_available:
        logger.warning("ASR_DEVICE=cuda is set but CUDA may not be available, will attempt anyway")
else:
    ASR_DEVICE = "cuda" if _cuda_available else "cpu"
    logger.info(f"Auto-detected device: {ASR_DEVICE} (CUDA available: {_cuda_available})")

# CPU 不支持 float16，必须使用 float32；CUDA 可以使用 float16
# 如果环境变量设置了 compute_type，使用环境变量的值；否则根据设备自动选择
# 重要：即使环境变量设置了 float16，如果设备是 CPU，也必须强制使用 float32
if os.getenv("ASR_COMPUTE_TYPE"):
    env_compute_type = os.getenv("ASR_COMPUTE_TYPE")
    # 如果设备是 CPU，强制使用 float32（CPU 不支持 float16）
    if ASR_DEVICE == "cpu" and env_compute_type == "float16":
        logger.warning(f"CPU device does not support float16, forcing float32")
        ASR_COMPUTE_TYPE = "float32"
    else:
        ASR_COMPUTE_TYPE = env_compute_type
else:
    # CPU 模式下强制使用 float32（不支持 float16）
    # CUDA 模式下优先使用 float16，但如果 GPU 不支持会自动回退到 float32
    ASR_COMPUTE_TYPE = "float16" if (ASR_DEVICE == "cuda" and _cuda_available) else "float32"

# Silero VAD
VAD_MODEL_PATH = os.getenv("VAD_MODEL_PATH", "models/vad/silero/silero_vad_official.onnx")
VAD_SAMPLE_RATE = 16000
VAD_FRAME_SIZE = 512  # 32ms @ 16kHz
VAD_SILENCE_THRESHOLD = 0.2
VAD_MIN_SILENCE_DURATION_MS = 300
VAD_BASE_THRESHOLD_MIN_MS = 200
VAD_BASE_THRESHOLD_MAX_MS = 600
VAD_FINAL_THRESHOLD_MIN_MS = 200
VAD_FINAL_THRESHOLD_MAX_MS = 800
VAD_MIN_UTTERANCE_MS = 1000
VAD_ADAPTIVE_ENABLED = True

# Service
PORT = int(os.getenv("FASTER_WHISPER_VAD_PORT", "6007"))

# ---------------------
# Load Models
# ---------------------
logger.info(f"Loading Faster Whisper model from {ASR_MODEL_PATH}...")
logger.info(f"Device: {ASR_DEVICE}, Compute Type: {ASR_COMPUTE_TYPE}")

try:
    # 尝试使用指定设备加载模型
    # 如果配置为 GPU 模式，必须成功加载 GPU，失败则立即停止服务
    model_kwargs = {
        "device": ASR_DEVICE,
        "compute_type": ASR_COMPUTE_TYPE,
    }
    if WHISPER_CACHE_DIR:
        model_kwargs["download_root"] = WHISPER_CACHE_DIR
        logger.info(f"Using model cache directory: {WHISPER_CACHE_DIR}")
    
    try:
        asr_model = WhisperModel(
            ASR_MODEL_PATH,
            **model_kwargs
        )
        logger.info(f"✅ Faster Whisper model loaded successfully on {ASR_DEVICE.upper()}")
    except Exception as e:
        error_str = str(e).lower()
        # 如果配置为 CUDA 但加载失败，尝试 float32（仍然使用 GPU）
        if ASR_DEVICE == "cuda" and ("float16" in error_str or "compute type" in error_str):
            logger.warning(f"CUDA does not support {ASR_COMPUTE_TYPE}, trying float32 on GPU: {e}")
            fallback_kwargs = {
                "device": "cuda",  # 仍然使用 GPU
                "compute_type": "float32",  # 但使用 float32
            }
            if WHISPER_CACHE_DIR:
                fallback_kwargs["download_root"] = WHISPER_CACHE_DIR
            try:
                asr_model = WhisperModel(
                    ASR_MODEL_PATH,
                    **fallback_kwargs
                )
                logger.info("✅ Faster Whisper model loaded successfully on CUDA with float32 (fallback from float16)")
            except Exception as e2:
                # GPU 模式失败，立即停止服务
                logger.error(f"❌ Failed to load Faster Whisper model on GPU (float32 fallback also failed): {e2}")
                logger.error("GPU mode is required but failed. Service will exit.")
                raise RuntimeError(f"GPU mode required but model loading failed: {e2}") from e2
        elif ASR_DEVICE == "cuda":
            # GPU 模式失败，立即停止服务
            logger.error(f"❌ Failed to load Faster Whisper model on GPU: {e}")
            logger.error("GPU mode is required but failed. Service will exit.")
            raise RuntimeError(f"GPU mode required but model loading failed: {e}") from e
        else:
            # CPU 模式失败，也停止服务
            logger.error(f"❌ Failed to load Faster Whisper model on CPU: {e}")
            raise
except Exception as e:
    logger.error(f"❌ Failed to load Faster Whisper model: {e}")
    import traceback
    logger.error(traceback.format_exc())
    raise

logger.info(f"Loading Silero VAD model from {VAD_MODEL_PATH}...")

def find_cudnn_path():
    """查找 cuDNN 路径（通过检查 DLL 文件）"""
    cuda_path = os.getenv("CUDA_PATH")
    if not cuda_path:
        return None
    
    # 优先检查 cuDNN 9.x（用于 CUDA 12.x），然后检查其他版本
    # 注意：cudnn_graph64_9.dll 是 ONNX Runtime CUDA 最需要的
    cudnn_dlls = ['cudnn_graph64_9.dll', 'cudnn64_9.dll', 'cudnn64_8.dll']
    search_paths = [
        'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin\\12.6',  # cuDNN 9.x for CUDA 12.x (优先)
        'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin\\11.8',  # cuDNN 9.x for CUDA 11.8
        os.path.join(cuda_path, 'bin'),  # cuDNN 可能在 CUDA bin 目录中
        'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin',  # cuDNN 9.x 通用路径
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\cuDNN\\bin',
        'C:\\cudnn\\bin',
    ]
    
    # 也检查 PATH 环境变量中的路径（这些路径应该已经由 TypeScript 配置添加）
    path_env = os.getenv("PATH", "")
    path_paths = [p for p in path_env.split(os.pathsep) if p and os.path.exists(p)]
    search_paths.extend(path_paths)
    
    # 去重，保持顺序
    seen = set()
    unique_paths = []
    for p in search_paths:
        if p and p not in seen:
            seen.add(p)
            unique_paths.append(p)
    
    for search_path in unique_paths:
        if not os.path.exists(search_path):
            continue
        for dll_name in cudnn_dlls:
            dll_path = os.path.join(search_path, dll_name)
            if os.path.exists(dll_path):
                logger.info(f"cuDNN DLL found: {dll_path}")
                return search_path
    return None

def check_cudnn_available():
    """检查 cuDNN 是否可用（通过检查 DLL 文件）"""
    return find_cudnn_path() is not None

try:
    # VAD 模型加载：如果配置为 GPU 模式，必须成功加载 GPU，失败则立即停止服务
    cuda_available = os.getenv("CUDA_PATH") is not None
    cudnn_path = find_cudnn_path()
    cudnn_available = cudnn_path is not None
    
    # 如果 ASR 使用 GPU，VAD 也必须使用 GPU
    if ASR_DEVICE == "cuda":
        if not cuda_available:
            logger.error("❌ ASR configured for GPU but CUDA_PATH not set. Service will exit.")
            raise RuntimeError("GPU mode required but CUDA_PATH not set")
        
        if not cudnn_available:
            logger.error("❌ ASR configured for GPU but cuDNN not found. Service will exit.")
            logger.error("cuDNN is required for ONNX Runtime CUDA support.")
            raise RuntimeError("GPU mode required but cuDNN not found. Please ensure cuDNN is installed and in PATH.")
        
        # 在加载 ONNX Runtime 之前，确保 cuDNN 路径在 PATH 的最前面
        # 这样可以确保 ONNX Runtime 在加载时能够找到 cuDNN DLL
        if cudnn_path:
            current_path = os.getenv("PATH", "")
            # 如果 cuDNN 路径不在 PATH 的最前面，将其添加到最前面
            path_parts = current_path.split(os.pathsep)
            if cudnn_path not in path_parts or path_parts[0] != cudnn_path:
                new_path = f"{cudnn_path}{os.pathsep}{current_path}"
                os.environ["PATH"] = new_path
                logger.info(f"Added cuDNN path to PATH: {cudnn_path}")
        
        # 尝试使用 CUDA 加载 VAD 模型
        # GPU 模式下只使用 CUDAExecutionProvider，不允许回退到 CPU
        try:
            logger.info("Attempting to load VAD model with CUDA support (GPU mode required, no CPU fallback)...")
            vad_session = ort.InferenceSession(
                VAD_MODEL_PATH,
                providers=['CUDAExecutionProvider']  # 只使用 CUDA，不允许回退到 CPU
            )
            # 验证实际使用的 provider（应该是 CUDA）
            actual_provider = vad_session.get_providers()[0]
            if actual_provider == 'CUDAExecutionProvider':
                logger.info("✅ Silero VAD model loaded with CUDA support")
            else:
                # GPU 模式要求使用 GPU，如果实际使用的是其他 provider，则失败
                logger.error(f"❌ GPU mode required but VAD model using {actual_provider}. Service will exit.")
                raise RuntimeError(f"GPU mode required but VAD model loaded with {actual_provider}")
        except RuntimeError:
            # 重新抛出 RuntimeError（这是我们自己的错误或 ONNX Runtime 的错误）
            raise
        except Exception as e:
            error_str = str(e).lower()
            logger.error(f"❌ Failed to load VAD model on GPU: {e}")
            logger.error("GPU mode is required but VAD model loading failed. Service will exit.")
            logger.error("Please ensure CUDA and cuDNN are properly installed and accessible.")
            raise RuntimeError(f"GPU mode required but VAD model loading failed: {e}") from e
    else:
        # CPU 模式，使用 CPU 加载 VAD 模型
        logger.info("Loading VAD model with CPU provider...")
        vad_session = ort.InferenceSession(
            VAD_MODEL_PATH,
            providers=['CPUExecutionProvider']
        )
        logger.info("✅ Silero VAD model loaded with CPU")
    
except RuntimeError:
    # 重新抛出 RuntimeError（GPU 模式失败）
    raise
except Exception as e:
    logger.error(f"❌ Failed to load Silero VAD model: {e}")
    import traceback
    logger.error(traceback.format_exc())
    raise

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
# Context Buffer (严格按照 Rust 实现)
# ---------------------
# 上下文缓冲区：保存前一个 utterance 的尾部音频（最后 2 秒）
# 采样率：16kHz，格式：f32，范围：[-1.0, 1.0]
CONTEXT_DURATION_SEC = 2.0
CONTEXT_SAMPLE_RATE = 16000
CONTEXT_MAX_SAMPLES = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)

# 全局上下文缓冲区（每个会话应该有独立缓冲区，这里简化处理）
context_buffer: List[float] = []
context_buffer_lock = threading.Lock()

# 文本上下文缓存（用于 Faster Whisper 的 initial_prompt）
text_context_cache: List[str] = []
text_context_cache_lock = threading.Lock()

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
    with vad_state.lock:
        if vad_state.hidden_state is None:
            state_array = np.zeros((2, 1, 128), dtype=np.float32)
        else:
            state_array = vad_state.hidden_state.reshape(2, 1, 128).astype(np.float32)
        
        # 采样率输入 [1]
        sr_array = np.array([VAD_SAMPLE_RATE], dtype=np.int64)
        
        # ONNX 推理
        inputs = {
            'input': input_array,
            'h': state_array,
            'sr': sr_array
        }
        
        outputs = vad_session.run(None, inputs)
        
        # 提取输出
        output = outputs[0]  # [1, 2] 或 [1, 1]
        if output.shape[1] >= 2:
            raw_output = output[0, 1]  # 第二列是语音概率
        else:
            raw_output = output[0, 0]
        
        # 更新隐藏状态
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
    segments = []
    current_segment_start: Optional[int] = None
    
    for frame_idx in range(0, len(audio_data), VAD_FRAME_SIZE):
        frame = audio_data[frame_idx:frame_idx + VAD_FRAME_SIZE]
        if len(frame) < VAD_FRAME_SIZE:
            break
        
        speech_prob = detect_voice_activity_frame(frame)
        
        if speech_prob > VAD_SILENCE_THRESHOLD:
            sample_start = frame_idx
            if current_segment_start is None:
                current_segment_start = sample_start
        else:
            if current_segment_start is not None:
                sample_end = frame_idx
                segments.append((current_segment_start, sample_end))
                current_segment_start = None
    
    if current_segment_start is not None:
        segments.append((current_segment_start, len(audio_data)))
    
    return segments

def update_context_buffer(audio_data: np.ndarray, vad_segments: List[Tuple[int, int]]):
    """
    更新上下文缓冲区
    严格按照 Rust 实现：使用 VAD 选择最佳上下文片段（最后一个语音段的尾部）
    """
    global context_buffer
    
    context_samples = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)
    
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

def get_context_audio() -> np.ndarray:
    """获取上下文音频"""
    with context_buffer_lock:
        if len(context_buffer) > 0:
            return np.array(context_buffer, dtype=np.float32)
        else:
            return np.array([], dtype=np.float32)

def update_text_context(text: str):
    """更新文本上下文缓存（只保留最后一句）"""
    global text_context_cache
    trimmed_text = text.strip()
    if not trimmed_text:
        return
    
    with text_context_cache_lock:
        # 只保留最后 1 句（替换而不是追加）
        text_context_cache.clear()
        text_context_cache.append(trimmed_text)

def get_text_context() -> str:
    """获取文本上下文（最后一句）"""
    with text_context_cache_lock:
        if len(text_context_cache) > 0:
            return text_context_cache[-1]
        else:
            return ""

# ---------------------
# Text Filter (严格按照 Rust 实现)
# ---------------------
def is_meaningless_transcript(text: str) -> bool:
    """
    检查文本是否为无意义的识别结果
    严格按照 Rust 实现（electron_node/services/node-inference/src/text_filter.rs）
    """
    text_trimmed = text.strip()
    
    # 1. 检查空文本
    if not text_trimmed:
        return True
    
    # 2. 检查单个字的无意义语气词
    single_char_fillers = ["嗯", "啊", "呃", "哦", "额", "嗯", "um", "uh", "ah", "er"]
    if text_trimmed in single_char_fillers:
        return True
    
    # 3. 检查标点符号（语音输入的文本不应该包含任何标点符号）
    punctuation_chars = [
        # 中文标点
        '，', '。', '！', '？', '；', '：', '、', 
        '"', '"', '\u2018', '\u2019', '（', '）', '【', '】', 
        '《', '》', '…', '—', '·',
        # 英文标点
        ',', '.', '!', '?', ';', ':', "'", '"', 
        '(', ')', '[', ']', '{', '}',
        # 其他常见标点
        '-', '_', '/', '\\', '|', '@', '#', '$', '%', 
        '^', '&', '*', '+', '=', '<', '>', '~', '`',
    ]
    if any(c in text_trimmed for c in punctuation_chars):
        logger.warning(f"[Text Filter] Filtering text with punctuation: \"{text_trimmed}\"")
        return True
    
    # 4. 检查包含括号的文本（如 "(笑)"、"(字幕:J Chong)" 等）
    if '(' in text_trimmed or '（' in text_trimmed or '[' in text_trimmed or '【' in text_trimmed:
        logger.warning(f"[Text Filter] Filtering text with brackets: \"{text_trimmed}\"")
        return True
    
    # 5. 检查精确匹配的无意义文本
    exact_matches = [
        "谢谢大家", "谢谢大家收看", "感谢观看", "感谢收看", 
        "The", "the", "A", "a", "An", "an",
        "谢谢", "感谢", "拜拜", "再见",
    ]
    if text_trimmed in exact_matches:
        logger.warning(f"[Text Filter] Filtering exact match: \"{text_trimmed}\"")
        return True
    
    return False

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
    audio_format: Optional[str] = "pcm16"  # 音频格式（"pcm16" | "opus" 等）
    sample_rate: Optional[int] = 16000  # 采样率
    # ASR 特定参数
    language: Optional[str] = None  # 语言代码（如果 src_lang == "auto"，则自动检测）
    task: str = "transcribe"  # "transcribe" or "translate"
    beam_size: int = 5
    condition_on_previous_text: bool = True  # Use context for better accuracy
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

class UtteranceResponse(BaseModel):
    """Utterance 任务响应"""
    text: str  # Full transcribed text
    segments: List[str]  # List of segment texts
    language: Optional[str] = None  # Detected language
    duration: float  # Audio duration in seconds
    vad_segments: List[Tuple[int, int]]  # VAD 检测到的语音段（样本索引）

class ResetRequest(BaseModel):
    """重置请求"""
    reset_vad: bool = True  # 重置 VAD 状态
    reset_context: bool = True  # 重置上下文缓冲区
    reset_text_context: bool = True  # 重置文本上下文

# ---------------------
# Health Check
# ---------------------
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "asr_model_loaded": True,
        "vad_model_loaded": True
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
        with context_buffer_lock:
            context_buffer.clear()
        logger.info("✅ Context buffer reset")
    
    if req.reset_text_context:
        with text_context_cache_lock:
            text_context_cache.clear()
        logger.info("✅ Text context cache reset")
    
    return {"status": "ok"}

# ---------------------
# Utterance Endpoint
# ---------------------
@app.post("/utterance", response_model=UtteranceResponse)
def process_utterance(req: UtteranceRequest):
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
    logger.debug(
        f"[{trace_id}] "
        f"trace_id={trace_id} "
        f"job_id={req.job_id} "
        f"'开始处理推理请求'"
    )
    
    try:
        # 1. 解码 base64 音频
        try:
            audio_bytes = base64.b64decode(req.audio)
        except Exception as e:
            logger.error(f"[{trace_id}] Failed to decode base64 audio: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid base64 audio: {e}")
        
        # 2. 根据 audio_format 解码音频（支持 Opus 等格式）
        audio_format = req.audio_format or "pcm16"
        sample_rate = req.sample_rate or 16000
        
        if audio_format == "opus":
            # 如果使用 Opus，需要先解码（这里简化处理，假设已经是 WAV）
            logger.warning(f"[{trace_id}] Opus format not fully supported, assuming WAV")
            audio_format = "pcm16"
        
        # 3. 读取音频文件（假设是 WAV 格式）
        try:
            audio, sr = sf.read(io.BytesIO(audio_bytes))
        except Exception as e:
            logger.error(f"[{trace_id}] Failed to read audio file: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid audio format: {e}")
        
        # 3. 转换为 float32 和单声道
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)
        
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1).astype(np.float32)
        
        # 4. 重采样到指定采样率（默认 16kHz）
        if sr != sample_rate:
            logger.warning(f"[{trace_id}] Audio sample rate is {sr}Hz, expected {sample_rate}Hz. Resampling...")
            from scipy import signal
            num_samples = int(len(audio) * sample_rate / sr)
            audio = signal.resample(audio, num_samples).astype(np.float32)
            sr = sample_rate
        
        # 确保音频是连续的
        if not audio.flags['C_CONTIGUOUS']:
            audio = np.ascontiguousarray(audio)
        
        # 5. 确定语言（如果 src_lang == "auto"，则使用 language 或自动检测）
        asr_language = None
        if req.src_lang != "auto":
            asr_language = req.src_lang
        elif req.language:
            asr_language = req.language
        # 如果都是 None，Faster Whisper 会自动检测
        
        # 严格按照 node-inference 的日志格式
        logger.debug(f"[{trace_id}] trace_id={trace_id} src_lang={req.src_lang} '开始 ASR 语音识别'")
        
        # 6. 前置上下文音频（如果启用）
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
        
        # 7. 使用 VAD 检测有效语音段（Level 2断句）
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
        
        # 8. 获取文本上下文（用于 Faster Whisper 的 initial_prompt）
        text_context = ""
        if req.use_text_context:
            text_context = get_text_context()
            if text_context:
                logger.info(
                    f"[{trace_id}] "
                    f"Using text context ({len(text_context)} chars): \"{text_context[:100]}...\""
                )
        
        # 10. 使用 Faster Whisper 进行 ASR
        import time
        asr_start_time = time.time()
        
        segments, info = asr_model.transcribe(
            processed_audio,
            language=asr_language,  # 使用确定的语言
            task=req.task,
            beam_size=req.beam_size,
            vad_filter=False,  # 我们已经用 Silero VAD 处理过了
            initial_prompt=text_context if text_context else None,
            condition_on_previous_text=req.condition_on_previous_text,
        )
        
        asr_elapsed = time.time() - asr_start_time
        
        # 10.1 提取文本和分段
        segment_texts = []
        full_text_parts = []
        
        for segment in segments:
            segment_text = segment.text.strip()
            if segment_text:
                segment_texts.append(segment_text)
                full_text_parts.append(segment_text)
        
        full_text = " ".join(full_text_parts)
        
        # 记录 ASR 处理时间（用于性能监控）
        if asr_elapsed > 1.0:
            audio_duration = len(processed_audio) / sr
            ratio = asr_elapsed / audio_duration if audio_duration > 0 else 0
            logger.warning(
                f"[{trace_id}] "
                f"⚠️ ASR processing took {asr_elapsed:.2f}s "
                f"(audio duration: {audio_duration:.2f}s, ratio: {ratio:.2f}x)"
            )
        
        # 10. ASR 识别完成，记录结果
        # 严格按照 node-inference 的日志格式
        full_text_trimmed = full_text.strip()
        
        # 检查是否包含括号（用于调试，与 node-inference 一致）
        if '(' in full_text_trimmed or '（' in full_text_trimmed or '[' in full_text_trimmed or '【' in full_text_trimmed:
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"transcript='{full_text_trimmed}' "
                f"transcript_len={len(full_text_trimmed)} "
                f"'⚠️ [ASR Filter Check] Transcript contains brackets before setting to context!'"
            )
        
        logger.info(
            f"[{trace_id}] trace_id={trace_id} "
            f"transcript_len={len(full_text)} "
            f"transcript_preview='{full_text[:50]}' "
            f"transcript_trimmed_len={len(full_text_trimmed)} "
            f"'✅ ASR 识别完成'"
        )
        
        # 11. 检查文本是否为无意义的识别结果（严格按照 node_inference 实现）
        # 重要：只有在文本有意义时才更新上下文缓冲区，避免静音音频污染上下文
        if not full_text_trimmed:
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"transcript='{full_text}' "
                f"'ASR transcript is empty, skipping NMT and TTS, and NOT updating context buffer'"
            )
            # 返回空结果，不更新上下文
            return UtteranceResponse(
                text="",
                segments=[],
                language=info.language,
                duration=info.duration,
                vad_segments=[],
            )
        
        if is_meaningless_transcript(full_text_trimmed):
            logger.warning(
                f"[{trace_id}] trace_id={trace_id} "
                f"transcript='{full_text_trimmed}' "
                f"transcript_len={len(full_text_trimmed)} "
                f"'ASR transcript is meaningless (likely silence misrecognition), skipping NMT and TTS, and NOT updating context buffer'"
            )
            # 返回空结果，不更新上下文
            return UtteranceResponse(
                text="",
                segments=[],
                language=info.language,
                duration=info.duration,
                vad_segments=[],
            )
        
        # 12. 更新文本上下文缓存（只更新有意义的文本）
        if req.use_text_context:
            # 只保留最后一句
            sentences = full_text.split('.')
            if len(sentences) > 1:
                last_sentence = sentences[-1].strip()
                if last_sentence and not is_meaningless_transcript(last_sentence):
                    update_text_context(last_sentence)
            else:
                if not is_meaningless_transcript(full_text_trimmed):
                    update_text_context(full_text_trimmed)
        
        # 13. 更新上下文缓冲区（使用原始音频，不带上下文）
        # 重要：只有在文本有意义时才更新上下文缓冲区
        # 严格按照 node-inference 的日志格式
        if req.use_context_buffer:
            # 使用 VAD 检测原始音频的语音段
            try:
                original_vad_segments = detect_speech(audio)
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
            
            update_context_buffer(audio, original_vad_segments)
        
        # 13. 返回结果
        return UtteranceResponse(
            text=full_text,
            segments=segment_texts,
            language=info.language,
            duration=info.duration,
            vad_segments=vad_segments,
        )
        
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

