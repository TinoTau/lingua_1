#!/usr/bin/env python3
"""
YourTTS HTTP 服务（Zero-shot TTS）

用于从 Rust 代码调用 YourTTS 模型进行语音合成，支持音色克隆。

使用方法：
    python yourtts_service.py [--gpu] [--port PORT] [--host HOST]

参数：
    --gpu: 使用 GPU（如果可用）
    --port: 服务端口（默认：5004）
    --host: 服务地址（默认：127.0.0.1）

API 端点：
    POST /synthesize
    Body: {
        "text": "要合成的文本",
        "reference_audio": [0.1, 0.2, ...],  # 参考音频（可选，用于音色克隆）
        "language": "zh"  # 语言代码（可选）
    }
    Response: {
        "audio": [0.1, 0.2, ...],  # 合成的音频数据（f32）
        "sample_rate": 22050
    }
"""

import sys
import os
import argparse
from pathlib import Path

# 设置标准输出编码为 UTF-8，避免乱码
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 添加项目路径
script_dir = Path(__file__).parent
project_root = script_dir.parent.parent
sys.path.insert(0, str(project_root))

from flask import Flask, request, jsonify
import numpy as np
import torch
import base64
import tempfile
import soundfile as sf
from scipy import signal
import requests

app = Flask(__name__)
tts_model = None
device = None

# Global exception handler for Flask
@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all unhandled exceptions"""
    print(f"[ERROR] Unhandled exception in Flask app: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({"error": str(e)}), 500

# Speaker 缓存：存储 speaker_id -> reference_audio 的映射
# 格式：{speaker_id: {"reference_audio": np.ndarray, "sample_rate": int, "voice_embedding": np.ndarray}}
speaker_cache = {}

# 线程锁，用于保护 speaker_cache 的并发访问
import threading
speaker_cache_lock = threading.Lock()

def get_device(use_gpu=False):
    """Get compute device"""
    if use_gpu:
        if torch.cuda.is_available():
            selected_device = "cuda"
            print(f"[INFO] Using GPU: {torch.cuda.get_device_name(0)}")
            print(f"   CUDA version: {torch.version.cuda}")
            print(f"   PyTorch version: {torch.__version__}")
        else:
            selected_device = "cpu"
            print("[WARN] GPU requested but not available, using CPU")
            print("   Check:")
            print("   1. NVIDIA drivers installed")
            print("   2. CUDA toolkit installed")
            print("   3. PyTorch with CUDA support installed")
    else:
        selected_device = "cpu"
        print("[INFO] Using CPU (GPU not requested)")
    return selected_device

def check_and_install_tts():
    """Check and install TTS module"""
    try:
        import TTS
        return True
    except ImportError:
        print("[WARN] TTS module not found. Attempting to install...")
        try:
            import subprocess
            import sys
            subprocess.check_call([sys.executable, "-m", "pip", "install", "TTS"])
            print("[INFO] TTS module installed successfully")
            return True
        except Exception as e:
            print(f"[ERROR] Failed to install TTS module: {e}")
            print("\nPlease install manually:")
            print("  pip install TTS")
            return False

def load_model(model_path, device="cpu"):
    """加载 YourTTS 模型"""
    global tts_model
    
    # 检查并安装 TTS 模块
    if not check_and_install_tts():
        raise ImportError("TTS module is required but not available")
    
    try:
        from TTS.api import TTS
        
        print(f"[INFO] Loading YourTTS model from: {model_path}")
        print(f"[INFO] Device: {device}")
        
        # 模型必须从模型库下载，不允许自动下载
        # 检查模型路径是否存在
        if model_path is None:
            raise FileNotFoundError(
                "Model path not provided. "
                "Please download models from the model hub first. "
                "Models should be in: model-hub/models/tts/your_tts"
            )
        
        model_path_obj = Path(model_path) if not isinstance(model_path, Path) else model_path
        
        if not model_path_obj.exists():
            raise FileNotFoundError(
                f"Model path not found: {model_path_obj}\n"
                "Please download models from the model hub first. "
                "Models should be in: model-hub/models/tts/your_tts"
            )
        
        # 检查必需的文件
        if not model_path_obj.is_dir():
            raise ValueError(f"Model path must be a directory: {model_path_obj}")
        
        config_file = model_path_obj / "config.json"
        model_file = model_path_obj / "model.pth"
        
        if not config_file.exists():
            raise FileNotFoundError(
                f"Config file not found: {config_file}\n"
                "Please ensure the model is correctly downloaded from the model hub."
            )
        
        if not model_file.exists():
            raise FileNotFoundError(
                f"Model checkpoint not found: {model_file}\n"
                "Please ensure the model is correctly downloaded from the model hub."
            )
        
        # 设置环境变量禁用自动下载
        model_path_str = str(model_path_obj.absolute())
        os.environ["TTS_OFFLINE"] = "1"  # 禁用在线功能
        
        print(f"  Config file: {config_file}")
        print(f"  Model checkpoint: {model_file}")
        print(f"  Model directory: {model_path_str}")
        
        # 按照原项目的方式加载模型，但确保不触发自动下载
        # 方式1：尝试使用模型路径直接加载（推荐，直接使用 model-hub 中的模型）
        try:
            tts_model = TTS(model_path=model_path_str, progress_bar=False, gpu=(device == "cuda"))
            print("[INFO] YourTTS model loaded via TTS API (using model path from model-hub)")
        except Exception as e1:
            # Method 2: If method 1 fails, use Synthesizer API to load local files directly
            # This ensures no automatic downloads, directly using model files from model-hub
            print(f"[WARN] TTS API loading from path failed: {e1}")
            print("[WARN] Trying to load using Synthesizer API with explicit file paths...")
            print("[WARN] This method directly loads local files and will NOT trigger downloads")
            
            try:
                from TTS.utils.synthesizer import Synthesizer
                
                # Synthesizer API's tts_checkpoint parameter may need directory path
                # According to error messages, it may append model.pth after checkpoint path
                # So pass directory path, let it find model.pth in the directory
                print(f"  Attempting to load with directory path: {model_path_str}")
                tts_model = Synthesizer(
                    tts_checkpoint=str(model_path_str),  # Use directory path, Synthesizer will find model.pth inside
                    tts_config_path=str(config_file),
                    use_cuda=(device == "cuda")
                )
                print("[INFO] YourTTS model loaded using Synthesizer API (direct file loading, no download)")
            except Exception as e2:
                error_msg = str(e2)
                # If transformers version issue is encountered
                if "BeamSearchScorer" in error_msg or "cannot import name" in error_msg:
                    print("  [WARN] transformers version compatibility issue detected")
                    print("  TTS library requires transformers<=4.42.4 (current version may be too new)")
                    print("  Please downgrade transformers: pip install 'transformers>=4.21.0,<=4.42.4'")
                    raise RuntimeError(
                        f"transformers library version incompatibility: {e2}\n"
                        f"TTS library is not compatible with transformers>4.42.4\n"
                        f"Please run: pip install 'transformers>=4.21.0,<=4.42.4'\n"
                        f"Then restart the service."
                    )
                else:
                    raise RuntimeError(
                        f"Failed to load YourTTS model using both methods.\n"
                        f"Method 1 (TTS API with model_path) error: {e1}\n"
                        f"Method 2 (Synthesizer API with explicit paths) error: {e2}\n"
                        f"Model directory: {model_path_str}\n"
                        f"Config file: {config_file}\n"
                        f"Model checkpoint: {model_file}\n"
                        f"Please ensure all model files are correctly downloaded from the model hub."
                    )
        
        # Move to specified device (if TTS API didn't handle it automatically)
        if hasattr(tts_model, 'to') and device == "cuda":
            try:
                tts_model = tts_model.to(device)
                print(f"[INFO] Model moved to {device}")
            except Exception as e:
                print(f"[WARN] Warning: Failed to move model to {device}: {e}")
                print("   Model may still work on CPU")
        
        print(f"[INFO] YourTTS model loaded successfully")
        print(f"   Device: {device}")
        print(f"   Supports zero-shot: Yes")
        
        return tts_model
    except Exception as e:
        print(f"[ERROR] Failed to load model: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    with speaker_cache_lock:
        cache_size = len(speaker_cache)
    return jsonify({
        "status": "ok",
        "model_loaded": tts_model is not None,
        "device": device,
        "cached_speakers": cache_size
    }), 200

@app.route('/register_speaker', methods=['POST'])
def register_speaker():
    """注册说话者（异步接收 reference_audio）"""
    try:
        data = request.json
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        speaker_id = data.get('speaker_id')
        if not speaker_id:
            return jsonify({"error": "Missing 'speaker_id' field"}), 400
        
        reference_audio = data.get('reference_audio')
        if not reference_audio:
            return jsonify({"error": "Missing 'reference_audio' field"}), 400
        
        reference_sample_rate = data.get('reference_sample_rate', 16000)
        voice_embedding = data.get('voice_embedding')  # 可选
        
        # 将参考音频转换为 numpy 数组
        ref_audio_array = np.array(reference_audio, dtype=np.float32)
        
        # YourTTS 需要 22050 Hz 的参考音频，预先重采样
        target_sample_rate = 22050
        if reference_sample_rate != target_sample_rate:
            num_samples = int(len(ref_audio_array) * target_sample_rate / reference_sample_rate)
            ref_audio_array = signal.resample(ref_audio_array, num_samples)
            print(f"[YourTTS Service] Resampled reference audio from {reference_sample_rate} Hz to {target_sample_rate} Hz for speaker {speaker_id}")
        
        # 保存 voice_embedding（如果提供）
        embedding_array = None
        if voice_embedding:
            embedding_array = np.array(voice_embedding, dtype=np.float32)
        
        # 保存到缓存
        with speaker_cache_lock:
            speaker_cache[speaker_id] = {
                "reference_audio": ref_audio_array,
                "sample_rate": target_sample_rate,
                "voice_embedding": embedding_array
            }
            cache_size = len(speaker_cache)
        
        print(f"[YourTTS Service] [INFO] Registered speaker '{speaker_id}' (reference_audio: {len(ref_audio_array)} samples @ {target_sample_rate} Hz, cache size: {cache_size})")
        
        return jsonify({
            "status": "ok",
            "speaker_id": speaker_id,
            "message": "Speaker registered successfully",
            "cache_size": cache_size
        })
    
    except Exception as e:
        print(f"[YourTTS Service] [ERROR] Failed to register speaker: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/synthesize', methods=['POST'])
def synthesize():
    """语音合成（支持 zero-shot）"""
    try:
        data = request.json
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        if 'text' not in data:
            return jsonify({"error": "Missing 'text' field"}), 400
        
        text = data['text']
        speaker_id = data.get('speaker_id')
        reference_audio = data.get('reference_audio')
        reference_sample_rate = data.get('reference_sample_rate', 16000)
        voice_embedding = data.get('voice_embedding')
        speaker = data.get('speaker')
        language = data.get('language', 'en')
        speech_rate = data.get('speech_rate')
        
        if not text or len(text.strip()) == 0:
            return jsonify({"error": "Empty text"}), 400
        
        if tts_model is None:
            return jsonify({"error": "Model not loaded"}), 500
        
        # 准备参考音频
        speaker_wav = None
        cached_ref_audio = None
        cached_sample_rate = None
        
        if speaker_id:
            with speaker_cache_lock:
                cached_entry = speaker_cache.get(speaker_id)
                if cached_entry:
                    cached_ref_audio = cached_entry["reference_audio"]
                    cached_sample_rate = cached_entry["sample_rate"]
                    print(f"[YourTTS Service] [INFO] Using cached reference_audio for speaker_id '{speaker_id}'")
        
        use_cached = cached_ref_audio is not None
        ref_audio_to_use = cached_ref_audio if use_cached else reference_audio
        ref_sample_rate_to_use = cached_sample_rate if use_cached else reference_sample_rate
        
        try:
            if ref_audio_to_use is not None:
                if use_cached:
                    ref_audio_array = ref_audio_to_use
                else:
                    ref_audio_array = np.array(ref_audio_to_use, dtype=np.float32)
                
                target_sample_rate = 22050
                if not use_cached and ref_sample_rate_to_use != target_sample_rate:
                    num_samples = int(len(ref_audio_array) * target_sample_rate / ref_sample_rate_to_use)
                    ref_audio_array = signal.resample(ref_audio_array, num_samples)
                
                tmp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
                tmp_file.close()
                try:
                    sf.write(tmp_file.name, ref_audio_array, target_sample_rate)
                    speaker_wav = tmp_file.name
                except Exception as e:
                    if os.path.exists(tmp_file.name):
                        os.unlink(tmp_file.name)
                    raise
            
            # 合成语音
            if speaker_wav:
                wav = tts_model.tts(
                    text=text,
                    speaker_wav=speaker_wav,
                    language=language
                )
            elif speaker:
                wav = tts_model.tts(
                    text=text,
                    speaker=speaker,
                    language=language
                )
            else:
                # 使用默认说话者
                wav = tts_model.tts(
                    text=text,
                    language=language
                )
        finally:
            if speaker_wav and os.path.exists(speaker_wav):
                try:
                    os.unlink(speaker_wav)
                except Exception as e:
                    print(f"Warning: Failed to delete temp file {speaker_wav}: {e}")
        
        # 转换为列表
        if isinstance(wav, np.ndarray):
            audio_list = [float(x) for x in wav.flatten()]
        elif isinstance(wav, torch.Tensor):
            audio_array = wav.cpu().numpy()
            audio_list = [float(x) for x in audio_array.flatten()]
        else:
            audio_list = [float(x) for x in wav]
        
        used_reference = speaker_wav is not None
        
        return jsonify({
            "audio": audio_list,
            "sample_rate": 22050,
            "text": text,
            "used_reference": used_reference,
            "speaker_applied": used_reference
        })
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        return jsonify({
            "error": error_msg,
            "type": type(e).__name__
        }), 500

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="YourTTS HTTP Service")
    parser.add_argument('--gpu', action='store_true', help='Use GPU if available')
    parser.add_argument('--port', type=int, default=5004, help='Server port (default: 5004)')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Server host (default: 127.0.0.1)')
    parser.add_argument('--model-dir', type=str, help='Model directory path')
    args = parser.parse_args()
    
    print("=" * 60)
    print("  YourTTS HTTP Service (Zero-shot TTS)")
    print("=" * 60)
    
    # 确定模型路径（参考原项目）
    # 模型必须从模型库下载，不允许自动下载
    if args.model_dir:
        model_path = Path(args.model_dir)
    else:
        # 默认使用项目中的模型路径（优先使用 node-inference，这是节点本地模型库）
        model_path = project_root / "node-inference" / "models" / "tts" / "your_tts"
        if not model_path.exists():
            model_path = project_root / "model-hub" / "models" / "tts" / "your_tts"
    
    # Verify model path exists
    if not model_path.exists():
        print(f"[ERROR] Model path not found: {model_path}")
        print("")
        print("Please download models from the model hub first:")
        print("  1. Start the model hub service: .\\scripts\\start_model_hub.ps1")
        print("  2. Download YourTTS models through the model hub")
        print("  3. Ensure models are in: model-hub/models/tts/your_tts")
        print("")
        sys.exit(1)
    
    # 获取设备（在模块级别，不需要 global 声明）
    device = get_device(args.gpu)
    
    # Load model (load_model function handles path not found cases internally)
    try:
        load_model(model_path, device)
    except Exception as e:
        print(f"\n[ERROR] Failed to start service: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    print(f"\n[INFO] Starting server on http://{args.host}:{args.port}")
    print("   Endpoints:")
    print("     GET  /health          - Health check")
    print("     POST /synthesize      - Synthesize speech (zero-shot supported)")
    print("     POST /register_speaker - Register speaker")
    print(f"   Device: {device}")
    print("\n   Press Ctrl+C to stop")
    print("=" * 60)
    
    # Check if port is available before starting
    import socket
    try:
        test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_socket.settimeout(1)
        result = test_socket.connect_ex((args.host, args.port))
        test_socket.close()
        if result == 0:
            print(f"[ERROR] Port {args.port} is already in use. Please stop the process using this port.")
            sys.exit(1)
    except Exception as e:
        print(f"[WARN] Could not check port availability: {e}")
    
    try:
        print(f"[INFO] Flask server starting...")
        app.run(host=args.host, port=args.port, debug=False, use_reloader=False, threaded=True)
    except OSError as e:
        error_msg = str(e)
        if "Address already in use" in error_msg or "address already in use" in error_msg.lower() or "EADDRINUSE" in error_msg:
            print(f"[ERROR] Port {args.port} is already in use. Please stop the process using this port or use a different port.")
            print(f"[ERROR] Error details: {e}")
            sys.exit(1)
        else:
            print(f"[ERROR] Failed to start Flask server: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n[INFO] Server stopped by user")
        sys.exit(0)
    except Exception as e:
        print(f"[ERROR] Unexpected error starting server: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
