#!/usr/bin/env python3
"""
Piper HTTP 服务包装器
通过 HTTP API 调用 piper 命令行工具进行 TTS 合成
"""

import argparse
import codecs
import logging
import os
import sys
import traceback
from pathlib import Path

try:
    import onnxruntime as ort
    ONNXRUNTIME_AVAILABLE = True
except ImportError:
    ONNXRUNTIME_AVAILABLE = False

try:
    from fastapi import FastAPI, HTTPException
    import uvicorn
except ImportError:
    print("ERROR: FastAPI and uvicorn are required. Please install:")
    print("  pip install fastapi uvicorn")
    sys.exit(1)

# 尝试导入 Piper Python API
try:
    from piper.voice import PiperVoice
    PIPER_PYTHON_API_AVAILABLE = True
except ImportError:
    PIPER_PYTHON_API_AVAILABLE = False
    print("WARNING: Piper Python API not available, will use command line tool (slower)")

# 导入中文音素化器
try:
    from chinese_phonemizer import ChinesePhonemizer
    CHINESE_PHONEMIZER_AVAILABLE = True
except ImportError:
    CHINESE_PHONEMIZER_AVAILABLE = False
    print("WARNING: ChinesePhonemizer not available, Chinese TTS may not work correctly.")

from models import TtsRequest
from synthesis import synthesize_with_python_api, synthesize_with_command_line
from utils import find_model_path, find_piper_command, get_or_load_voice

# 确保正确处理 UTF-8 编码
if sys.stdout.encoding != 'utf-8':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

app = FastAPI(title="Piper TTS HTTP Service")

logger = logging.getLogger("uvicorn.error")


def get_model_dir() -> Path:
    """获取模型目录路径：优先使用环境变量，否则使用服务目录下的 models"""
    model_dir_env = os.environ.get("PIPER_MODEL_DIR")
    if model_dir_env:
        return Path(model_dir_env).expanduser().resolve()
    service_dir = Path(__file__).parent.resolve()
    return service_dir / "models"


@app.on_event("startup")
async def startup_preload():
    """启动时预加载 TTS 模型到 GPU 并预热，避免首次请求延迟。"""
    if not PIPER_PYTHON_API_AVAILABLE:
        logger.info("Piper Python API not available, skipping TTS model preload")
        return
    
    model_dir_path = get_model_dir()
    model_dir = str(model_dir_path)
    use_gpu = os.environ.get("PIPER_USE_GPU", "false").lower() == "true"
    
    if not model_dir_path.exists():
        logger.info("Piper model dir does not exist, skipping preload: %s", model_dir)
        return
    
    preloaded = 0
    seen_paths = set()
    for onnx_file in sorted(model_dir_path.rglob("*.onnx")):
        voice_name = onnx_file.stem
        model_path, config_path = find_model_path(voice_name, model_dir)
        if not model_path or model_path in seen_paths:
            continue
        seen_paths.add(model_path)
        try:
            voice_obj = get_or_load_voice(model_path, config_path, use_gpu)
            list(voice_obj.synthesize("Hello"))
            preloaded += 1
            logger.info("TTS preloaded and warmed up: %s", voice_name)
        except Exception as e:
            logger.warning("TTS preload failed for voice %s: %s", voice_name, e)
    
    logger.info("TTS startup preload complete: %d voice(s) loaded", preloaded)
    
    # 只有在成功预加载了至少一个模型后才输出就绪信号
    # 如果 preloaded == 0，说明没有模型可加载，不输出就绪信号，让健康检查继续等待
    if preloaded > 0:
        # 输出服务就绪信号，通知节点端立即标记为 running（避免轮询等待）
        print("[SERVICE_READY]", flush=True)
    else:
        logger.warning("No TTS models were preloaded, service will wait for health check timeout")


@app.post("/tts")
async def synthesize_tts(request: TtsRequest):
    """TTS 合成接口"""
    model_dir = str(get_model_dir())
    
    # 查找模型文件
    model_path, config_path = find_model_path(request.voice, model_dir)
    if not model_path:
        raise HTTPException(
            status_code=404,
            detail=f"Model not found for voice: {request.voice} (searched in {model_dir})"
        )
    
    # 检查是否启用 GPU
    use_gpu = os.environ.get("PIPER_USE_GPU", "false").lower() == "true"
    
    # 优先使用 Python API（如果可用）
    if PIPER_PYTHON_API_AVAILABLE:
        try:
            return synthesize_with_python_api(
                request.text,
                model_path,
                config_path,
                use_gpu,
                request.voice
            )
        except Exception as e:
            logger.error(f"Python API synthesis failed: {e}", exc_info=True)
            # 记录详细的错误信息
            error_details = traceback.format_exc()
            logger.error(f"Python API error details: {error_details}")
            # 回退到命令行工具
            logger.warning("Falling back to command line tool")
    
    # 回退到命令行工具（如果 Python API 不可用或失败）
    return synthesize_with_command_line(
        request.text,
        model_path,
        config_path,
        use_gpu,
        request.voice
    )


@app.get("/health")
async def health_check():
    """健康检查接口
    
    只有在模型真正预加载完成后才返回 status: "ok"，
    确保节点端不会在模型加载完成前标记服务为 ready。
    """
    import utils
    
    # 检查是否有预加载的模型（使用 Python API 时）
    if PIPER_PYTHON_API_AVAILABLE:
        # 如果有缓存的模型，说明预加载已完成
        # 使用 getattr 安全访问，避免导入时的循环依赖问题
        voice_cache = getattr(utils, '_voice_cache', {})
        models_loaded = len(voice_cache) > 0
        return {
            "status": "ok" if models_loaded else "not_ready",
            "service": "piper-tts",
            "models_preloaded": models_loaded,
            "preloaded_count": len(voice_cache)
        }
    else:
        # 使用命令行工具时，无法检查预加载状态，假设已就绪
        # 但这种情况不应该发生，因为预加载只在 Python API 可用时执行
        return {
            "status": "ok",
            "service": "piper-tts",
            "models_preloaded": False,
            "note": "Python API not available, preload skipped"
        }


@app.get("/voices")
async def list_voices():
    """列出可用的语音模型"""
    model_dir_path = get_model_dir()
    
    voices = []
    if model_dir_path.exists():
        # 查找所有 .onnx 文件
        for onnx_file in model_dir_path.rglob("*.onnx"):
            voice_name = onnx_file.stem
            voices.append({
                "name": voice_name,
                "path": str(onnx_file),
            })
    
    return {"voices": voices}


def main():
    parser = argparse.ArgumentParser(description="Piper TTS HTTP Service")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5009,
        help="Port to bind to (default: 5009)"
    )
    default_model_dir = get_model_dir()
    
    parser.add_argument(
        "--model-dir",
        default=None,
        help=f"Directory containing Piper models (default: {default_model_dir})"
    )
    parser.add_argument(
        "--piper-cmd",
        help="Path to piper command (default: auto-detect)"
    )
    
    args = parser.parse_args()
    
    if args.model_dir:
        os.environ["PIPER_MODEL_DIR"] = args.model_dir
    
    if args.piper_cmd:
        os.environ["PIPER_CMD"] = args.piper_cmd
    
    model_dir = get_model_dir()
    print(f"Starting Piper TTS HTTP Service...")
    print(f"  Host: {args.host}")
    print(f"  Port: {args.port}")
    print(f"  Model Directory: {model_dir}")
    print(f"  Piper Command: {find_piper_command()}")
    
    # 强制使用GPU：检查PIPER_USE_GPU环境变量
    use_gpu = os.environ.get("PIPER_USE_GPU", "false").lower() == "true"
    
    if not use_gpu:
        error_msg = (
            "❌ PIPER_USE_GPU is not set to 'true'. GPU is required for TTS service.\n"
            "  Please set PIPER_USE_GPU=true environment variable.\n"
            "  CPU mode is not allowed."
        )
        print(error_msg, flush=True)
        raise RuntimeError("GPU is required for TTS service. PIPER_USE_GPU must be set to 'true'.")
    
    print(f"  GPU Acceleration: Enabled (required)")
    
    # 验证GPU是否真正可用
    if ONNXRUNTIME_AVAILABLE:
        try:
            providers = ort.get_available_providers()
            if 'CUDAExecutionProvider' in providers:
                print(f"  ✓ CUDA Execution Provider: Available")
                print(f"  ✓ GPU acceleration will be used")
            else:
                error_msg = (
                    "❌ CUDA Execution Provider is not available!\n"
                    "  GPU is required for TTS service.\n"
                    "  Please ensure:\n"
                    "  1. onnxruntime-gpu is installed: pip install onnxruntime-gpu\n"
                    "  2. CUDA drivers are installed and up to date\n"
                    "  3. CUDA toolkit is properly installed"
                )
                print(error_msg, flush=True)
                raise RuntimeError("CUDA Execution Provider is not available. GPU is required for TTS service.")
        except Exception as e:
            if "CUDA Execution Provider" in str(e):
                raise  # 重新抛出上面的错误
            error_msg = (
                f"❌ GPU check failed: {e}\n"
                "  GPU is required for TTS service."
            )
            print(error_msg, flush=True)
            raise RuntimeError(f"GPU check failed: {e}. GPU is required for TTS service.") from e
    else:
        error_msg = (
            "❌ ONNX Runtime is not available!\n"
            "  GPU is required for TTS service.\n"
            "  Please install onnxruntime-gpu: pip install onnxruntime-gpu"
        )
        print(error_msg, flush=True)
        raise RuntimeError("ONNX Runtime is not available. GPU is required for TTS service.")
    
    print(f"\nEndpoints:")
    print(f"  POST /tts - Synthesize speech")
    print(f"  GET /health - Health check")
    print(f"  GET /voices - List available voices")
    print()
    
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
