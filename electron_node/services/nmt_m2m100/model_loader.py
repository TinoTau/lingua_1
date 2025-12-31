# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 模型加载器
"""
import os
import sys
import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from typing import Optional, Tuple


def check_model_complete(model_path: str) -> Tuple[bool, Optional[str]]:
    """检查模型目录是否完整（包含 tokenizer 和 PyTorch 模型文件）"""
    if not os.path.exists(model_path):
        return False, "Directory does not exist"
    if not os.path.exists(os.path.join(model_path, "tokenizer.json")):
        return False, "Missing tokenizer.json"
    
    # 检查是否有 PyTorch 模型文件
    pytorch_files = [
        "pytorch_model.bin",
        "model.safetensors",
        "pytorch_model.bin.index.json",  # 分片模型
    ]
    has_pytorch_model = any(
        os.path.exists(os.path.join(model_path, f)) for f in pytorch_files
    )
    if not has_pytorch_model:
        # 检查是否有分片模型文件（pytorch_model-*.bin）
        bin_files = [f for f in os.listdir(model_path) if f.startswith("pytorch_model-") and f.endswith(".bin")]
        if not bin_files:
            return False, "Missing PyTorch model file (pytorch_model.bin or model.safetensors)"
    return True, None


def find_local_model_path(service_dir: str) -> str:
    """查找本地模型路径"""
    models_dir = os.path.join(service_dir, "models")
    
    if not os.path.exists(models_dir):
        raise FileNotFoundError(
            f"Models directory not found: {models_dir}\n"
            "Please ensure models are properly installed in the service directory."
        )
    
    # 检查是否有本地模型目录（m2m100-en-zh 或 m2m100-zh-en）
    local_model_path = None
    en_zh_path = os.path.join(models_dir, "m2m100-en-zh")
    zh_en_path = os.path.join(models_dir, "m2m100-zh-en")
    
    # 优先使用 m2m100-en-zh（如果存在且完整）
    if os.path.exists(en_zh_path):
        is_complete, error_msg = check_model_complete(en_zh_path)
        if is_complete:
            local_model_path = en_zh_path
            print(f"[NMT Service] Found local model directory: {local_model_path}")
        else:
            print(f"[NMT Service] Model directory {en_zh_path} is incomplete: {error_msg}")
    elif os.path.exists(zh_en_path):
        is_complete, error_msg = check_model_complete(zh_en_path)
        if is_complete:
            local_model_path = zh_en_path
            print(f"[NMT Service] Found local model directory: {local_model_path}")
        else:
            print(f"[NMT Service] Model directory {zh_en_path} is incomplete: {error_msg}")
    
    # 如果找不到完整的本地模型，直接报错
    if not local_model_path:
        error_details = []
        if os.path.exists(en_zh_path):
            _, error_msg = check_model_complete(en_zh_path)
            error_details.append(f"m2m100-en-zh: {error_msg}")
        if os.path.exists(zh_en_path):
            _, error_msg = check_model_complete(zh_en_path)
            error_details.append(f"m2m100-zh-en: {error_msg}")
        
        if error_details:
            raise FileNotFoundError(
                f"Local model files are incomplete in {models_dir}\n"
                + "\n".join(f"  - {detail}" for detail in error_details) + "\n"
                "Required files: tokenizer.json, pytorch_model.bin (or model.safetensors)\n"
                "Please ensure models are properly installed. The service will not download models from HuggingFace."
            )
        else:
            raise FileNotFoundError(
                f"Local model not found in {models_dir}\n"
                "Expected model directories: m2m100-en-zh or m2m100-zh-en\n"
                "Please ensure models are properly installed. The service will not download models from HuggingFace."
            )
    
    return local_model_path


def setup_device() -> torch.device:
    """设置计算设备（CPU/CUDA）"""
    FORCE_CPU_MODE = False  # 默认不强制 CPU，但可以通过环境变量 NMT_FORCE_CPU=true 启用
    
    if FORCE_CPU_MODE:
        print(f"[NMT Service] [WARN] FORCE_CPU_MODE is enabled, using CPU instead of CUDA", flush=True)
        return torch.device("cpu")
    # 在加载模型之前，先测试 CUDA 是否真的可用
    elif torch.cuda.is_available():
        try:
            # 尝试创建一个小的 tensor 来测试 CUDA
            test_tensor = torch.zeros(1).cuda()
            print(f"[NMT Service] [OK] CUDA test passed, device will be: cuda", flush=True)
            del test_tensor
            torch.cuda.empty_cache()
            return torch.device("cuda")
        except Exception as cuda_test_err:
            print(f"[NMT Service] [ERROR] CUDA test failed: {cuda_test_err}", flush=True)
            print(f"[NMT Service] [WARN] Forcing CPU mode due to CUDA test failure", flush=True)
            return torch.device("cpu")
    else:
        print(f"[NMT Service] CUDA not available, using CPU", flush=True)
        return torch.device("cpu")


def log_gpu_info():
    """记录 GPU 信息"""
    if torch.cuda.is_available():
        print(f"[NMT Service] [OK] CUDA available: {torch.cuda.is_available()}", flush=True)
        print(f"[NMT Service] [OK] CUDA version: {torch.version.cuda}", flush=True)
        print(f"[NMT Service] [OK] GPU count: {torch.cuda.device_count()}", flush=True)
        print(f"[NMT Service] [OK] GPU name: {torch.cuda.get_device_name(0)}", flush=True)
        print(f"[NMT Service] [OK] GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB", flush=True)
    else:
        print(f"[NMT Service] [WARN] CUDA not available, using CPU", flush=True)


def load_tokenizer(local_model_path: str) -> M2M100Tokenizer:
    """加载 tokenizer"""
    extra = {
        "local_files_only": True,
        "use_safetensors": True,  # 优先使用 safetensors 格式（更安全且已下载）
    }
    
    print(f"[NMT Service] Loading tokenizer from local path: {local_model_path}")
    print("[NMT Service] Using local files only (no network requests)")
    
    try:
        tokenizer = M2M100Tokenizer.from_pretrained(local_model_path, **extra)
        return tokenizer
    except MemoryError as mem_err:
        raise RuntimeError(
            f"Failed to load tokenizer due to insufficient memory: {mem_err}\n"
            "This is a system-level issue. Please:\n"
            "1. Close other applications to free up memory\n"
            "2. Increase Windows page file size\n"
            "3. Restart your computer to free up memory\n"
            "4. Consider using a smaller model or running on a machine with more RAM"
        )
    except ImportError as import_err:
        if 'protobuf' in str(import_err).lower():
            raise RuntimeError(
                f"Missing protobuf library: {import_err}\n"
                "Please install protobuf: pip install protobuf>=3.20.0\n"
                "Note: If installation fails due to MemoryError, you need to free up memory first."
            )
        raise
    except Exception as e:
        raise RuntimeError(
            f"Failed to load tokenizer from {local_model_path}: {e}\n"
            "Please ensure the model files are complete and valid."
        )


def load_model_with_retry(local_model_path: str, device: torch.device) -> M2M100ForConditionalGeneration:
    """加载模型，带重试机制"""
    extra = {
        "local_files_only": True,
        "use_safetensors": True,
    }
    
    print(f"[NMT Service] Loading PyTorch model from local path: {local_model_path}", flush=True)
    os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
    
    print(f"[NMT Service] [STEP] About to call M2M100ForConditionalGeneration.from_pretrained()", flush=True)
    print(f"[NMT Service] [STEP] Model path: {local_model_path}", flush=True)
    print(f"[NMT Service] [STEP] Model path exists: {os.path.exists(local_model_path)}", flush=True)
    
    model_loaded = False
    model = None
    
    # 方法1：使用 low_cpu_mem_usage=True（减少内存占用，避免系统卡住）
    if not model_loaded:
        try:
            print(f"[NMT Service] [STEP] Attempt 1: Calling from_pretrained with low_cpu_mem_usage=True, torch_dtype=float32", flush=True)
            print(f"[NMT Service] [STEP] This may take a while...", flush=True)
            print(f"[NMT Service] [STEP] Flushing stdout before model load...", flush=True)
            sys.stdout.flush()
            sys.stderr.flush()
            
            # 在加载模型前，先清理 CUDA 缓存（如果有）
            if torch.cuda.is_available():
                print(f"[NMT Service] [STEP] Clearing CUDA cache before model load...", flush=True)
                torch.cuda.empty_cache()
                print(f"[NMT Service] [STEP] CUDA cache cleared", flush=True)
            
            print(f"[NMT Service] [STEP] About to call from_pretrained() with low_cpu_mem_usage=True...", flush=True)
            sys.stdout.flush()
            model = M2M100ForConditionalGeneration.from_pretrained(
                local_model_path, 
                **extra,
                low_cpu_mem_usage=True,
                torch_dtype=torch.float32,
            )
            print(f"[NMT Service] [STEP] Model loaded successfully with low_cpu_mem_usage=True", flush=True)
            model_loaded = True
        except OSError as mem_error:
            if '1455' in str(mem_error) or '页面文件' in str(mem_error):
                print(f"[NMT Service] [ERROR] Memory error (OSError 1455) in attempt 1: {mem_error}", flush=True)
                print(f"[NMT Service] [ERROR] This indicates insufficient virtual memory (page file)", flush=True)
                print(f"[NMT Service] [WARN] Will try method 2 (low_cpu_mem_usage=False) as fallback", flush=True)
            else:
                print(f"[NMT Service] [ERROR] OSError during model loading (attempt 1): {mem_error}", flush=True)
        except Exception as e:
            print(f"[NMT Service] [ERROR] Exception during model loading (attempt 1): {e}", flush=True)
            import traceback
            traceback.print_exc()
    
    # 方法2：如果方法1失败，尝试使用改造前的配置（low_cpu_mem_usage=False）
    if not model_loaded:
        try:
            print(f"[NMT Service] [STEP] Attempt 2: Calling from_pretrained with low_cpu_mem_usage=False (original config, uses more memory)", flush=True)
            print(f"[NMT Service] [WARN] This will use more memory but may be more stable", flush=True)
            print(f"[NMT Service] [STEP] Flushing stdout before model load...", flush=True)
            sys.stdout.flush()
            sys.stderr.flush()
            
            # 清理 CUDA 缓存
            if torch.cuda.is_available():
                print(f"[NMT Service] [STEP] Clearing CUDA cache before model load...", flush=True)
                torch.cuda.empty_cache()
            
            print(f"[NMT Service] [STEP] About to call from_pretrained() with low_cpu_mem_usage=False...", flush=True)
            sys.stdout.flush()
            model = M2M100ForConditionalGeneration.from_pretrained(
                local_model_path, 
                **extra,
                low_cpu_mem_usage=False,
                torch_dtype=torch.float32,
            )
            print(f"[NMT Service] [STEP] Model loaded successfully with low_cpu_mem_usage=False (original config)", flush=True)
            model_loaded = True
        except OSError as mem_error:
            if '1455' in str(mem_error) or '页面文件' in str(mem_error):
                print(f"[NMT Service] [ERROR] Memory error (OSError 1455) in attempt 2: {mem_error}", flush=True)
                print(f"[NMT Service] [ERROR] Both loading methods failed due to insufficient virtual memory", flush=True)
                raise RuntimeError(
                    f"Failed to load model after multiple attempts due to insufficient virtual memory. "
                    f"Please increase Windows page file size or free up system memory. "
                    f"Error: {mem_error}\n"
                    f"Both low_cpu_mem_usage=True and low_cpu_mem_usage=False failed."
                )
            else:
                print(f"[NMT Service] [ERROR] OSError during model loading (attempt 2): {mem_error}", flush=True)
                raise RuntimeError(
                    f"Failed to load model after multiple attempts. "
                    f"Last error: {mem_error}\n"
                    f"Please check:\n"
                    f"1. Model files are complete and valid\n"
                    f"2. PyTorch version is compatible\n"
                    f"3. System has sufficient memory\n"
                    f"4. CUDA drivers are up to date (if using GPU)"
                )
        except Exception as e:
            print(f"[NMT Service] [ERROR] Exception during model loading (attempt 2): {e}", flush=True)
            import traceback
            traceback.print_exc()
            raise RuntimeError(
                f"Failed to load model after multiple attempts. "
                f"Last error: {e}\n"
                f"Please check:\n"
                f"1. Model files are complete and valid\n"
                f"2. PyTorch version is compatible\n"
                f"3. System has sufficient memory\n"
                f"4. CUDA drivers are up to date (if using GPU)"
            )
    
    if not model_loaded:
        raise RuntimeError("Failed to load model: all loading attempts failed")
    
    return model


def move_model_to_device(model: M2M100ForConditionalGeneration, device: torch.device) -> M2M100ForConditionalGeneration:
    """将模型移动到目标设备"""
    print(f"[NMT Service] [STEP] Model loaded successfully, checking parameters...", flush=True)
    
    # 检查模型是否在 meta 设备上
    print(f"[NMT Service] [STEP] Checking if model is on meta device...", flush=True)
    try:
        first_param = next(model.parameters(), None)
        if first_param is not None:
            param_device = str(first_param.device)
            print(f"[NMT Service] [STEP] First parameter device: {param_device}", flush=True)
            if param_device == "meta":
                print(f"[NMT Service] [WARN] Model loaded to meta device, will move to {device} during .to() call", flush=True)
    except StopIteration:
        print(f"[NMT Service] [WARN] Model has no parameters (unexpected)", flush=True)
    print(f"[NMT Service] [STEP] Meta device check completed", flush=True)
    
    # 移动到目标设备
    print(f"[NMT Service] [STEP] Moving model to device: {device}", flush=True)
    print(f"[NMT Service] [STEP] CUDA available: {torch.cuda.is_available()}", flush=True)
    if torch.cuda.is_available():
        print(f"[NMT Service] [STEP] CUDA device count: {torch.cuda.device_count()}", flush=True)
        try:
            print(f"[NMT Service] [STEP] Current CUDA device: {torch.cuda.current_device()}", flush=True)
            print(f"[NMT Service] [STEP] CUDA device name: {torch.cuda.get_device_name(0)}", flush=True)
        except Exception as cuda_err:
            print(f"[NMT Service] [WARN] Warning: Failed to get CUDA device info: {cuda_err}", flush=True)
    
    # 尝试移动到设备，如果失败则回退到 CPU
    try:
        # 如果使用 low_cpu_mem_usage=True，模型可能在 meta 设备上，需要先移动到 CPU
        first_param = next(model.parameters(), None)
        if first_param is not None and str(first_param.device) == "meta":
            print(f"[NMT Service] [STEP] Model is on meta device, moving to CPU first...", flush=True)
            model = model.to("cpu")
            print(f"[NMT Service] [STEP] Model moved to CPU from meta device", flush=True)
        
        print(f"[NMT Service] [STEP] Calling model.to({device})...", flush=True)
        model = model.to(device)
        print(f"[NMT Service] [STEP] Model moved to {device}, calling eval()...", flush=True)
        model = model.eval()
        print(f"[NMT Service] [OK] Model moved to {device} successfully", flush=True)
        
        # 记录内存使用情况
        if torch.cuda.is_available() and str(device).startswith('cuda'):
            try:
                allocated = torch.cuda.memory_allocated(0) / 1024**3  # GB
                reserved = torch.cuda.memory_reserved(0) / 1024**3  # GB
                total = torch.cuda.get_device_properties(0).total_memory / 1024**3  # GB
                print(f"[NMT Service] [MEMORY] GPU memory allocated: {allocated:.2f} GB", flush=True)
                print(f"[NMT Service] [MEMORY] GPU memory reserved: {reserved:.2f} GB", flush=True)
                print(f"[NMT Service] [MEMORY] GPU memory total: {total:.2f} GB", flush=True)
                print(f"[NMT Service] [MEMORY] GPU memory usage: {reserved/total*100:.1f}%", flush=True)
            except Exception as mem_err:
                print(f"[NMT Service] [WARN] Failed to get GPU memory info: {mem_err}", flush=True)
    except Exception as device_err:
        print(f"[NMT Service] [ERROR] Failed to move model to {device}: {device_err}", flush=True)
        print(f"[NMT Service] [WARN] Falling back to CPU", flush=True)
        device = torch.device("cpu")
        model = model.to(device).eval()
        print(f"[NMT Service] [OK] Model moved to CPU successfully", flush=True)
    
    return model
