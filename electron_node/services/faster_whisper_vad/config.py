"""
Faster Whisper + Silero VAD Service Configuration
配置和常量定义
"""
import os
import logging

logger = logging.getLogger(__name__)

# ---------------------
# Faster Whisper Configuration
# ---------------------
# 模型路径：支持 HuggingFace 模型标识符或本地路径
# 优先使用本地模型路径（如果存在），否则使用 HuggingFace 模型标识符
# 使用 large-v3 大模型以获得最高识别准确度（与原项目一致）
_default_model_path = "Systran/faster-whisper-large-v3"
_local_model_path = os.path.join(os.path.dirname(__file__), "models", "asr", "faster-whisper-large-v3")
# 如果本地模型目录存在，使用本地路径；否则使用 HuggingFace 标识符
if os.path.exists(_local_model_path) and os.path.isdir(_local_model_path):
    ASR_MODEL_PATH = os.getenv("ASR_MODEL_PATH", _local_model_path)
    logger.info(f"Using local model path: {ASR_MODEL_PATH}")
else:
    ASR_MODEL_PATH = os.getenv("ASR_MODEL_PATH", _default_model_path)
    logger.info(f"Using HuggingFace model identifier: {ASR_MODEL_PATH}")
    logger.info(f"To use local model, download it first: python download_model.py")
# 缓存目录：如果设置了 WHISPER_CACHE_DIR，Faster Whisper 会使用该目录作为模型缓存
# 默认使用服务目录下的 models/asr 作为缓存目录，这样模型会下载到本地
_default_cache_dir = os.path.join(os.path.dirname(__file__), "models", "asr")
WHISPER_CACHE_DIR = os.getenv("WHISPER_CACHE_DIR", _default_cache_dir)
logger.info(f"Using model cache directory: {WHISPER_CACHE_DIR}")
# 注意：如果将来需要从 HuggingFace 下载模型，可以通过环境变量 HF_TOKEN 设置 token
# 当前模型已下载到本地，无需 token

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

# ---------------------
# Silero VAD Configuration
# ---------------------
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

# ---------------------
# Service Configuration
# ---------------------
PORT = int(os.getenv("FASTER_WHISPER_VAD_PORT", "6007"))

# Audio length limits (to prevent GPU memory overflow and stack buffer overrun)
# Maximum audio duration in seconds (30 seconds should be enough for most use cases)
MAX_AUDIO_DURATION_SEC = float(os.getenv("MAX_AUDIO_DURATION_SEC", "30.0"))
MAX_AUDIO_SAMPLES = int(MAX_AUDIO_DURATION_SEC * 16000)  # 16kHz sample rate

# ASR Worker timeout configuration
# Maximum wait time for ASR task completion (seconds)
MAX_WAIT_SECONDS = float(os.getenv("MAX_WAIT_SECONDS", "30.0"))

# ---------------------
# Context Buffer Configuration
# ---------------------
# 上下文缓冲区：保存前一个 utterance 的尾部音频（最后 2 秒）
# 采样率：16kHz，格式：f32，范围：[-1.0, 1.0]
CONTEXT_DURATION_SEC = 2.0
CONTEXT_SAMPLE_RATE = 16000
CONTEXT_MAX_SAMPLES = int(CONTEXT_DURATION_SEC * CONTEXT_SAMPLE_RATE)

# ---------------------
# ASR Parameters Configuration
# ---------------------
# ASR 参数配置：支持从环境变量读取，用于提高识别准确度
BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "10"))  # Beam search 宽度，默认 10（提高准确度，减少同音字错误）
TEMPERATURE = float(os.getenv("ASR_TEMPERATURE", "0.0"))  # 采样温度，默认 0.0（更确定，减少随机性）
PATIENCE = float(os.getenv("ASR_PATIENCE", "1.0"))  # Beam search 耐心值，默认 1.0
COMPRESSION_RATIO_THRESHOLD = float(os.getenv("ASR_COMPRESSION_RATIO_THRESHOLD", "2.4"))  # 压缩比阈值，默认 2.4
LOG_PROB_THRESHOLD = float(os.getenv("ASR_LOG_PROB_THRESHOLD", "-1.0"))  # 对数概率阈值，默认 -1.0
NO_SPEECH_THRESHOLD = float(os.getenv("ASR_NO_SPEECH_THRESHOLD", "0.6"))  # 无语音阈值，默认 0.6

logger.info(f"ASR Parameters: beam_size={BEAM_SIZE}, temperature={TEMPERATURE}, patience={PATIENCE}, "
            f"compression_ratio_threshold={COMPRESSION_RATIO_THRESHOLD}, log_prob_threshold={LOG_PROB_THRESHOLD}, "
            f"no_speech_threshold={NO_SPEECH_THRESHOLD}")

