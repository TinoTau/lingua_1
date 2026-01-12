"""
Faster Whisper + Silero VAD Service Models
模型加载和管理
"""
import os
import logging
import onnxruntime as ort
from faster_whisper import WhisperModel
from config import (
    ASR_MODEL_PATH,
    ASR_DEVICE,
    ASR_COMPUTE_TYPE,
    WHISPER_CACHE_DIR,
    VAD_MODEL_PATH,
)

logger = logging.getLogger(__name__)

# ---------------------
# Load ASR Model
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

# ---------------------
# Load VAD Model
# ---------------------
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
        except RuntimeError as e:
            # 检查是否是内存不足导致的错误
            error_msg = str(e)
            if '1455' in error_msg or '页面文件' in error_msg or 'page file' in error_msg.lower():
                logger.error("❌ Failed to load CUDA provider due to insufficient virtual memory (Error 1455)")
                logger.error("This is a system-level issue. Please:")
                logger.error("1. Increase Windows page file size")
                logger.error("2. Close other applications to free up memory")
                logger.error("3. Restart your computer")
                logger.error("4. Consider stopping other services (like NMT) if they are using too much memory")
                raise RuntimeError(
                    f"Failed to load CUDA provider due to insufficient virtual memory (Error 1455). "
                    f"Please increase Windows page file size or free up system memory. "
                    f"Original error: {e}"
                ) from e
            # 重新抛出其他 RuntimeError
            raise
        except Exception as e:
            error_str = str(e).lower()
            # 检查是否是内存不足导致的错误
            if '1455' in error_str or '页面文件' in error_str or 'page file' in error_str:
                logger.error("❌ Failed to load CUDA provider due to insufficient virtual memory (Error 1455)")
                logger.error("This is a system-level issue. Please:")
                logger.error("1. Increase Windows page file size")
                logger.error("2. Close other applications to free up memory")
                logger.error("3. Restart your computer")
                logger.error("4. Consider stopping other services (like NMT) if they are using too much memory")
                raise RuntimeError(
                    f"Failed to load CUDA provider due to insufficient virtual memory (Error 1455). "
                    f"Please increase Windows page file size or free up system memory. "
                    f"Original error: {e}"
                ) from e
            logger.error(f"❌ Failed to load VAD model on GPU: {e}")
            logger.error("GPU mode is required but VAD model loading failed. Service will exit.")
            logger.error("Please ensure CUDA and cuDNN are properly installed and accessible.")
            raise RuntimeError(f"GPU mode required but VAD model loading failed: {e}") from e
    else:
        # CPU模式不允许：如果ASR_DEVICE不是cuda，说明配置错误
        error_msg = (
            "❌ ASR_DEVICE is not set to 'cuda'. GPU is required for ASR service.\n"
            "  CPU mode is not allowed. Please ensure ASR_DEVICE=cuda is set."
        )
        logger.error(error_msg)
        raise RuntimeError("GPU is required for ASR service. CPU mode is not allowed.")
    
except RuntimeError:
    # 重新抛出 RuntimeError（GPU 模式失败）
    raise
except Exception as e:
    logger.error(f"❌ Failed to load Silero VAD model: {e}")
    import traceback
    logger.error(traceback.format_exc())
    raise

