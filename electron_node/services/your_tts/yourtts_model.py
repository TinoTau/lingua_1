#!/usr/bin/env python3
"""
YourTTS 模型加载与设备选择
"""
import os
import sys
from pathlib import Path

import torch


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
    if not check_and_install_tts():
        raise ImportError("TTS module is required but not available")

    try:
        from TTS.api import TTS

        print(f"[INFO] Loading YourTTS model from: {model_path}")
        print(f"[INFO] Device: {device}")

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

        model_path_str = str(model_path_obj.absolute())
        os.environ["TTS_OFFLINE"] = "1"

        print(f"  Config file: {config_file}")
        print(f"  Model checkpoint: {model_file}")
        print(f"  Model directory: {model_path_str}")

        try:
            tts_model = TTS(model_path=model_path_str, progress_bar=False, gpu=(device == "cuda"))
            print("[INFO] YourTTS model loaded via TTS API (using model path from model-hub)")
        except Exception as e1:
            print(f"[WARN] TTS API loading from path failed: {e1}")
            print("[WARN] Trying to load using Synthesizer API with explicit file paths...")
            print("[WARN] This method directly loads local files and will NOT trigger downloads")

            try:
                from TTS.utils.synthesizer import Synthesizer

                print(f"  Attempting to load with directory path: {model_path_str}")
                tts_model = Synthesizer(
                    tts_checkpoint=str(model_path_str),
                    tts_config_path=str(config_file),
                    use_cuda=(device == "cuda")
                )
                print("[INFO] YourTTS model loaded using Synthesizer API (direct file loading, no download)")
            except Exception as e2:
                error_msg = str(e2)
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
