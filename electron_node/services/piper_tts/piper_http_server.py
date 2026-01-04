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
    from fastapi import FastAPI, HTTPException
    import uvicorn
except ImportError:
    print("ERROR: FastAPI and uvicorn are required. Please install:")
    print("  pip install fastapi uvicorn")
    sys.exit(1)

try:
    import onnxruntime as ort
    ONNXRUNTIME_AVAILABLE = True
except ImportError:
    ONNXRUNTIME_AVAILABLE = False

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
from utils import find_model_path, find_piper_command

# 确保正确处理 UTF-8 编码
if sys.stdout.encoding != 'utf-8':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

app = FastAPI(title="Piper TTS HTTP Service")

logger = logging.getLogger("uvicorn.error")


@app.post("/tts")
async def synthesize_tts(request: TtsRequest):
    """TTS 合成接口"""
    # 获取配置
    model_dir = os.environ.get("PIPER_MODEL_DIR", os.path.expanduser("~/piper_models"))
    
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
    """健康检查接口"""
    return {"status": "ok", "service": "piper-tts"}


@app.get("/voices")
async def list_voices():
    """列出可用的语音模型"""
    model_dir = os.environ.get("PIPER_MODEL_DIR", os.path.expanduser("~/piper_models"))
    model_dir_path = Path(model_dir).expanduser()
    
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
        default=5005,
        help="Port to bind to (default: 5005)"
    )
    parser.add_argument(
        "--model-dir",
        default=os.path.expanduser("~/piper_models"),
        help="Directory containing Piper models (default: ~/piper_models)"
    )
    parser.add_argument(
        "--piper-cmd",
        help="Path to piper command (default: auto-detect)"
    )
    
    args = parser.parse_args()
    
    # 设置环境变量
    os.environ["PIPER_MODEL_DIR"] = args.model_dir
    if args.piper_cmd:
        os.environ["PIPER_CMD"] = args.piper_cmd
    
    print(f"Starting Piper TTS HTTP Service...")
    print(f"  Host: {args.host}")
    print(f"  Port: {args.port}")
    print(f"  Model Directory: {args.model_dir}")
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
