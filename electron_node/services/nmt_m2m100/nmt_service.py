# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务（FastAPI）

提供 HTTP API 接口，使用 HuggingFace Transformers 运行 M2M100 模型进行翻译。
"""

# 强制设置标准输出和错误输出为 UTF-8 编码（Windows 兼容性）
# 注意：使用 line_buffering=False 以减少内存开销
import sys
import io
if sys.platform == 'win32':
    # Windows 系统：强制使用 UTF-8 编码，但不使用行缓冲以减少内存开销
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=False)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=False)

from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional, Dict, Any
import time
import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import os
import re
import json

# 在创建 FastAPI 应用之前就输出诊断信息
print("[NMT Service] [MODULE] Module is being imported...", flush=True)
print(f"[NMT Service] [MODULE] Python version: {sys.version}", flush=True)
print(f"[NMT Service] [MODULE] PyTorch version: {torch.__version__}", flush=True)
print(f"[NMT Service] [MODULE] CUDA available: {torch.cuda.is_available()}", flush=True)

app = FastAPI(title="M2M100 NMT Service", version="1.0.0")
print("[NMT Service] [MODULE] FastAPI app created", flush=True)

# 模型名称（仅用于文档说明，实际从本地目录加载）
MODEL_NAME = "facebook/m2m100_418M"
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"[NMT Service] [MODULE] Device set to: {DEVICE}", flush=True)

# 全局模型和 tokenizer
tokenizer: Optional[M2M100Tokenizer] = None
model: Optional[M2M100ForConditionalGeneration] = None
loaded_model_path: Optional[str] = None  # 实际加载的模型路径

# 配置加载函数
def load_config():
    """从配置文件加载配置"""
    config_path = os.path.join(os.path.dirname(__file__), "nmt_config.json")
    default_config = {
        "separator": {
            "default": " ^^ ",
            "translations": [" ^^ ", "^^", " ^^", "^^ "],
            "word_variants": []
        }
    }
    
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                print(f"[NMT Service] Configuration loaded from {config_path}", flush=True)
                return config
        else:
            print(f"[NMT Service] Configuration file not found at {config_path}, using default config", flush=True)
            return default_config
    except Exception as e:
        print(f"[NMT Service] Failed to load configuration: {e}, using default config", flush=True)
        return default_config

# 加载配置
NMT_CONFIG = load_config()
SEPARATOR = NMT_CONFIG["separator"]["default"]
SEPARATOR_TRANSLATIONS = NMT_CONFIG["separator"]["translations"]
SEPARATOR_WORD_VARIANTS = NMT_CONFIG["separator"]["word_variants"]
print(f"[NMT Service] Separator configuration loaded: default='{SEPARATOR}', translations={len(SEPARATOR_TRANSLATIONS)}, word_variants={len(SEPARATOR_WORD_VARIANTS)}", flush=True)

# 加载文本过滤配置
PUNCTUATION_FILTER_ENABLED = NMT_CONFIG.get("text_filter", {}).get("punctuation_only_filter", {}).get("enabled", True)
PUNCTUATION_FILTER_PATTERN = NMT_CONFIG.get("text_filter", {}).get("punctuation_only_filter", {}).get("regex_pattern", r"[^\w\u4e00-\u9fff]")
PUNCTUATION_FILTER_MIN_LENGTH = NMT_CONFIG.get("text_filter", {}).get("punctuation_only_filter", {}).get("min_text_length_after_filter", 1)
print(f"[NMT Service] Punctuation filter configuration loaded: enabled={PUNCTUATION_FILTER_ENABLED}, pattern='{PUNCTUATION_FILTER_PATTERN}', min_length={PUNCTUATION_FILTER_MIN_LENGTH}", flush=True)


class TranslateRequest(BaseModel):
    src_lang: str
    tgt_lang: str
    text: str
    context_text: Optional[str] = None  # 上下文文本（可选，用于提升翻译质量）
    num_candidates: Optional[int] = None  # 生成候选数量（可选，用于 NMT Repair）


class TranslateResponse(BaseModel):
    ok: bool
    text: Optional[str] = None
    model: Optional[str] = None
    provider: str = "local-m2m100"
    extraction_mode: Optional[str] = None  # 提取模式：SENTINEL, ALIGN_FALLBACK, SINGLE_ONLY, FULL_ONLY
    extraction_confidence: Optional[str] = None  # 提取置信度：HIGH, MEDIUM, LOW
    extra: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    candidates: Optional[list[str]] = None  # 候选翻译列表（可选，用于 NMT Repair）


@app.on_event("startup")
async def load_model():
    """启动时加载模型"""
    global tokenizer, model, loaded_model_path, DEVICE
    print("[NMT Service] [STARTUP] load_model() function called", flush=True)
    try:
        print(f"[NMT Service] ===== Starting NMT Service =====", flush=True)
        print(f"[NMT Service] Python version: {sys.version}", flush=True)
        print(f"[NMT Service] PyTorch version: {torch.__version__}", flush=True)
        print(f"[NMT Service] Initial device setting: {DEVICE}", flush=True)
        
        # 临时修复：如果遇到访问违规，可以尝试强制使用 CPU 模式
        # 取消下面的注释来强制使用 CPU（用于诊断 CUDA 问题）
        # FORCE_CPU_MODE = os.environ.get('NMT_FORCE_CPU', 'false').lower() == 'true'
        FORCE_CPU_MODE = False  # 默认不强制 CPU，但可以通过环境变量 NMT_FORCE_CPU=true 启用
        
        if FORCE_CPU_MODE:
            print(f"[NMT Service] [WARN] FORCE_CPU_MODE is enabled, using CPU instead of CUDA", flush=True)
            DEVICE = torch.device("cpu")
        # 在加载模型之前，先测试 CUDA 是否真的可用
        elif torch.cuda.is_available():
            try:
                # 尝试创建一个小的 tensor 来测试 CUDA
                test_tensor = torch.zeros(1).cuda()
                print(f"[NMT Service] [OK] CUDA test passed, device will be: cuda", flush=True)
                del test_tensor
                torch.cuda.empty_cache()
            except Exception as cuda_test_err:
                print(f"[NMT Service] [ERROR] CUDA test failed: {cuda_test_err}", flush=True)
                print(f"[NMT Service] [WARN] Forcing CPU mode due to CUDA test failure", flush=True)
                DEVICE = torch.device("cpu")
        else:
            print(f"[NMT Service] CUDA not available, using CPU", flush=True)
        
        print(f"[NMT Service] Device: {DEVICE}", flush=True)
        
        # GPU 检查
        if torch.cuda.is_available():
            print(f"[NMT Service] [OK] CUDA available: {torch.cuda.is_available()}", flush=True)
            print(f"[NMT Service] [OK] CUDA version: {torch.version.cuda}", flush=True)
            print(f"[NMT Service] [OK] GPU count: {torch.cuda.device_count()}", flush=True)
            print(f"[NMT Service] [OK] GPU name: {torch.cuda.get_device_name(0)}", flush=True)
            print(f"[NMT Service] [OK] GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB", flush=True)
        else:
            print(f"[NMT Service] [WARN] CUDA not available, using CPU", flush=True)
        
        # 强制只使用本地文件 - 不允许从 HuggingFace 下载模型
        # 公司在上架模型时会保证模型可用性
        os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
        os.environ["HF_LOCAL_FILES_ONLY"] = "1"
        
        # 从服务目录查找本地模型
        service_dir = os.path.dirname(__file__)
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
        
        # 检查模型目录是否包含必要的文件
        def check_model_complete(model_path):
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
        
        # 配置加载选项 - 强制使用本地文件
        extra = {
            "local_files_only": True,
            "use_safetensors": True,  # 优先使用 safetensors 格式（更安全且已下载）
        }
        
        print(f"[NMT Service] Loading tokenizer from local path: {local_model_path}")
        print("[NMT Service] Using local files only (no network requests)")
        
        # 保存实际使用的模型路径
        loaded_model_path = local_model_path
        
        # 加载 tokenizer - 如果失败直接报错
        try:
            tokenizer = M2M100Tokenizer.from_pretrained(local_model_path, **extra)
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
        
        # 加载 PyTorch 模型
        print(f"[NMT Service] Loading PyTorch model from local path: {local_model_path}", flush=True)
        # 启用低内存模式以减少虚拟内存使用（解决 Windows 页面文件不足的问题）
        os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
        
        print(f"[NMT Service] [STEP] About to call M2M100ForConditionalGeneration.from_pretrained()", flush=True)
        print(f"[NMT Service] [STEP] Model path: {local_model_path}", flush=True)
        print(f"[NMT Service] [STEP] Model path exists: {os.path.exists(local_model_path)}", flush=True)
        
        # 尝试加载模型，使用更安全的参数
        # 注意：访问违规错误无法被 Python try-except 捕获，但我们可以尝试不同的加载方式
        model_loaded = False
        
        # 方法1：使用 low_cpu_mem_usage=True（减少内存占用，避免系统卡住）
        # 注意：虽然改造前使用 False，但为了减少内存占用，现在优先使用 True
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
                
                # 使用 low_cpu_mem_usage=True 以减少内存占用
                # 注意：如果这里发生访问违规，Python 无法捕获，进程会直接崩溃
                print(f"[NMT Service] [STEP] About to call from_pretrained() with low_cpu_mem_usage=True...", flush=True)
                sys.stdout.flush()
                model = M2M100ForConditionalGeneration.from_pretrained(
                    local_model_path, 
                    **extra,
                    low_cpu_mem_usage=True,  # 使用低内存模式（减少内存占用）
                    torch_dtype=torch.float32,
                )
                print(f"[NMT Service] [STEP] Model loaded successfully with low_cpu_mem_usage=True", flush=True)
                model_loaded = True
            except OSError as mem_error:
                if '1455' in str(mem_error) or '页面文件' in str(mem_error):
                    print(f"[NMT Service] [ERROR] Memory error (OSError 1455) in attempt 1: {mem_error}", flush=True)
                    print(f"[NMT Service] [ERROR] This indicates insufficient virtual memory (page file)", flush=True)
                    print(f"[NMT Service] [WARN] Will try method 2 (low_cpu_mem_usage=False) as fallback", flush=True)
                    # 不直接 raise，继续尝试方法2
                    pass
                else:
                    print(f"[NMT Service] [ERROR] OSError during model loading (attempt 1): {mem_error}", flush=True)
                    # 其他 OSError 也继续尝试方法2
                    pass
            except Exception as e:
                print(f"[NMT Service] [ERROR] Exception during model loading (attempt 1): {e}", flush=True)
                import traceback
                traceback.print_exc()
                # 继续尝试方法2
                pass
        
        # 方法2：如果方法1失败，尝试使用改造前的配置（low_cpu_mem_usage=False）
        # 这是之前集成测试时正常工作的配置，但会占用更多内存
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
                    low_cpu_mem_usage=False,  # 使用改造前的配置（占用更多内存但可能更稳定）
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
        
        print(f"[NMT Service] [STEP] Model loaded successfully, checking parameters...", flush=True)
        
        # 检查模型是否在 meta 设备上
        print(f"[NMT Service] [STEP] Checking if model is on meta device...", flush=True)
        try:
            first_param = next(model.parameters(), None)
            if first_param is not None:
                param_device = str(first_param.device)
                print(f"[NMT Service] [STEP] First parameter device: {param_device}", flush=True)
                if param_device == "meta":
                    print(f"[NMT Service] [WARN] Model loaded to meta device, will move to {DEVICE} during .to() call", flush=True)
                    # 如果模型在 meta 设备上，在移动到目标设备时会自动加载
        except StopIteration:
            print(f"[NMT Service] [WARN] Model has no parameters (unexpected)", flush=True)
            pass  # 模型没有参数（不应该发生）
        print(f"[NMT Service] [STEP] Meta device check completed", flush=True)
        
        # 移动到目标设备
        print(f"[NMT Service] [STEP] Moving model to device: {DEVICE}", flush=True)
        print(f"[NMT Service] [STEP] CUDA available: {torch.cuda.is_available()}", flush=True)
        if torch.cuda.is_available():
            print(f"[NMT Service] [STEP] CUDA device count: {torch.cuda.device_count()}", flush=True)
            try:
                print(f"[NMT Service] [STEP] Current CUDA device: {torch.cuda.current_device()}", flush=True)
                print(f"[NMT Service] [STEP] CUDA device name: {torch.cuda.get_device_name(0)}", flush=True)
            except Exception as cuda_err:
                print(f"[NMT Service] [WARN] Warning: Failed to get CUDA device info: {cuda_err}", flush=True)
        
        # 尝试移动到设备，如果失败则回退到 CPU
        # 注意：如果内存不足，强制使用 CPU 模式以减少内存占用
        try:
            # 如果使用 low_cpu_mem_usage=True，模型可能在 meta 设备上，需要先移动到 CPU
            first_param = next(model.parameters(), None)
            if first_param is not None and str(first_param.device) == "meta":
                print(f"[NMT Service] [STEP] Model is on meta device, moving to CPU first...", flush=True)
                model = model.to("cpu")
                print(f"[NMT Service] [STEP] Model moved to CPU from meta device", flush=True)
            
            print(f"[NMT Service] [STEP] Calling model.to({DEVICE})...", flush=True)
            model = model.to(DEVICE)
            print(f"[NMT Service] [STEP] Model moved to {DEVICE}, calling eval()...", flush=True)
            model = model.eval()
            print(f"[NMT Service] [OK] Model moved to {DEVICE} successfully", flush=True)
            
            # 记录内存使用情况
            if torch.cuda.is_available() and str(DEVICE).startswith('cuda'):
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
            print(f"[NMT Service] [ERROR] Failed to move model to {DEVICE}: {device_err}", flush=True)
            print(f"[NMT Service] [WARN] Falling back to CPU", flush=True)
            DEVICE = torch.device("cpu")
            model = model.to(DEVICE).eval()
            print(f"[NMT Service] [OK] Model moved to CPU successfully", flush=True)
        
        print(f"[NMT Service] Model loaded successfully on {DEVICE}", flush=True)
    except Exception as e:
        print(f"[NMT Service] [CRITICAL ERROR] Failed to load model: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise


@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok" if model is not None else "not_ready",
        "model": loaded_model_path if model is not None else None,
        "device": str(DEVICE)
    }


@app.post("/v1/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest) -> TranslateResponse:
    """翻译接口"""
    import datetime
    request_start = time.time()
    request_timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    
    print(f"[NMT Service] [{request_timestamp}] ===== Translation Request Started =====")
    print(f"[NMT Service] Input text: '{req.text[:50]}{'...' if len(req.text) > 50 else ''}' (src={req.src_lang}, tgt={req.tgt_lang})")
    if req.context_text:
        print(f"[NMT Service] Context text: '{req.context_text[:50]}{'...' if len(req.context_text) > 50 else ''}' (length={len(req.context_text)})")
    
    if model is None or tokenizer is None:
        return TranslateResponse(
            ok=False,
            error="Model not loaded",
            provider="local-m2m100"
        )
    
    try:
        # 设置源语言（重要：必须在编码前设置）
        tokenizer_start = time.time()
        tokenizer.src_lang = req.src_lang
        
        # 如果有上下文文本，拼接上下文和当前文本
        # 注意：M2M100 本身不支持上下文参数，这里只是简单拼接
        # 如果需要真正的上下文支持，需要修改模型输入格式
        input_text = req.text
        context_text = req.context_text  # 保存 context_text 用于后续提取
        # 使用特殊分隔符来准确识别和提取当前句翻译（从配置文件读取）
        # 如果context_text为空或空字符串，直接使用当前文本，不需要拼接
        if req.context_text and req.context_text.strip():
                # 使用特殊分隔符拼接：上下文 + 分隔符 + 当前文本
                # 这样在提取时可以准确找到分界点
                input_text = f"{req.context_text}{SEPARATOR}{req.text}"
                print(f"[NMT Service] Concatenated input with separator: '{input_text[:100]}{'...' if len(input_text) > 100 else ''}' (total length={len(input_text)})")
        else:
                # context_text为空或空字符串，直接使用当前文本（如job0的情况）
                print(f"[NMT Service] No context text provided, translating current text directly (length={len(req.text)})")
        
        # 编码输入文本（M2M100 会在文本前自动添加源语言 token）
        encoded = tokenizer(input_text, return_tensors="pt").to(DEVICE)
        tokenizer_elapsed = (time.time() - tokenizer_start) * 1000
        print(f"[NMT Service] [Tokenization] Completed in {tokenizer_elapsed:.2f}ms")
        
        # 获取目标语言 token ID
        forced_bos = tokenizer.get_lang_id(req.tgt_lang)
        
        # 生成翻译
        generation_start = time.time()
        
        # 如果请求候选生成，增加 num_beams 并返回多个候选
        num_candidates = req.num_candidates or 1
        num_beams = max(4, num_candidates)  # 至少使用 4 个 beam，如果请求更多候选则增加
        
        # 动态计算 max_new_tokens  based on input text length
        def calculate_max_new_tokens(
            input_text: str,
            context_text: Optional[str] = None,
            min_tokens: int = 128,
            max_tokens: int = 512,
            safety_margin: float = 1.5
        ) -> int:
            """
            根据输入文本长度动态计算 max_new_tokens
            
            Args:
                input_text: 当前要翻译的文本
                context_text: 上下文文本（可选）
                min_tokens: 最小 token 数
                max_tokens: 最大 token 数
                safety_margin: 安全缓冲系数（默认 1.5，即 +50%）
            
            Returns:
                合理的 max_new_tokens 值
            """
            # 使用 tokenizer 精确计算（如果可用）
            if tokenizer:
                input_tokens = len(tokenizer.encode(input_text))
                if context_text:
                    context_tokens = len(tokenizer.encode(context_text))
                    total_input_tokens = input_tokens + context_tokens
                else:
                    total_input_tokens = input_tokens
                
                # 中英文 token 比例（保守估计）
                # 中文更紧凑，1 个中文 token 通常对应 1.5-2.5 个英文 token
                ratio = 2.5
                estimated_output_tokens = int(total_input_tokens * ratio)
            else:
                # 粗略估算：使用字符数
                input_length = len(input_text)
                if context_text:
                    total_input_length = len(context_text) + len(input_text)
                else:
                    total_input_length = input_length
                
                # 根据输入长度调整比例
                if total_input_length < 20:
                    ratio = 2.0  # 短句：1:2
                elif total_input_length < 50:
                    ratio = 2.5  # 中等句子：1:2.5
                else:
                    ratio = 3.0  # 长句：1:3
                
                estimated_output_tokens = int(total_input_length * ratio)
            
            # 添加安全缓冲
            estimated_output_tokens = int(estimated_output_tokens * safety_margin)
            
            # 限制在合理范围内
            max_new_tokens = max(min_tokens, min(estimated_output_tokens, max_tokens))
            
            return max_new_tokens
        
        # 计算动态 max_new_tokens
        max_new_tokens = calculate_max_new_tokens(
            input_text=req.text,
            context_text=req.context_text,
            min_tokens=128,   # 最短至少 128 个 token
            max_tokens=512,   # 最长不超过 512 个 token（避免显存溢出）
            safety_margin=2.0  # 提高安全缓冲到 +100%，确保翻译完整，避免截断
        )
        print(f"[NMT Service] [Generation] Calculated max_new_tokens={max_new_tokens} (input_length={len(req.text)}, context_length={len(req.context_text) if req.context_text else 0})")
        
        with torch.no_grad():
            gen = model.generate(
                **encoded,
                forced_bos_token_id=forced_bos,
                num_beams=num_beams,
                num_return_sequences=min(num_candidates, num_beams),  # 返回的候选数量
                no_repeat_ngram_size=3,
                repetition_penalty=1.2,
                max_new_tokens=max_new_tokens,  # 动态计算的最大 token 数
                early_stopping=False,  # 禁用早停，确保完整翻译
            )
        generation_elapsed = (time.time() - generation_start) * 1000
        print(f"[NMT Service] [Generation] Completed in {generation_elapsed:.2f}ms (num_beams={num_beams}, num_return_sequences={min(num_candidates, num_beams)})")
        
        # 解码输出
        decode_start = time.time()
        tgt_lang_id = tokenizer.get_lang_id(req.tgt_lang)
        eos_token_id = tokenizer.eos_token_id
        
        # 处理多个候选（如果请求了候选生成）
        candidates = []
        outputs = []
        
        for seq_idx in range(min(num_candidates, len(gen))):
            generated_ids = gen[seq_idx].cpu().numpy().tolist()
            
            # 找到目标语言 token 的位置
            tgt_start_idx = None
            for i, token_id in enumerate(generated_ids):
                if token_id == tgt_lang_id:
                    tgt_start_idx = i + 1  # 跳过目标语言 token 本身
                    break
            
            if tgt_start_idx is not None and tgt_start_idx < len(generated_ids):
                # 提取目标语言 token 之后的部分
                target_ids = generated_ids[tgt_start_idx:]
                
                # 移除 EOS token（如果存在）
                eos_positions = [i for i, tid in enumerate(target_ids) if tid == eos_token_id]
                if len(eos_positions) > 0:
                    target_ids = target_ids[:eos_positions[0]]
                
                # 解码目标语言部分
                if len(target_ids) > 0:
                    out = tokenizer.decode(target_ids, skip_special_tokens=True)
                else:
                    out = ""
            else:
                # 如果找不到目标语言 token，尝试直接解码
                out = tokenizer.decode(gen[seq_idx], skip_special_tokens=True)
            
            outputs.append(out)
            if seq_idx > 0:  # 第一个是主候选，后续是额外候选
                candidates.append(out)
        
        # 主输出是第一个候选
        out = outputs[0] if outputs else ""
        
        decode_elapsed = (time.time() - decode_start) * 1000
        
        total_elapsed = (time.time() - request_start) * 1000
        print(f"[NMT Service] [Decoding] Completed in {decode_elapsed:.2f}ms")
        print(f"[NMT Service] Output (full translation): '{out[:200]}{'...' if len(out) > 200 else ''}' (length={len(out)})")
        
        # 如果提供了 context_text，需要从完整翻译中提取只当前句的翻译部分
        # 如果没有 context_text（如job0的情况），直接使用完整翻译
        final_output = out
        extraction_mode = "FULL_ONLY"  # 默认模式
        extraction_confidence = "HIGH"  # 默认置信度
        
        # 如果context_text为空或空字符串，直接使用完整翻译，不需要提取
        if req.context_text and req.context_text.strip():
            print(f"[NMT Service] WARNING: Output contains translation of BOTH context_text and text. Extracting only current sentence translation.")
            
            # 方法：使用特殊分隔符来准确识别和提取当前句翻译
            # 分隔符 <SEP> 会被翻译，但通常会被翻译成空格或标点，我们需要查找分隔符的翻译位置
            # 从配置文件读取分隔符配置（已在模块加载时读取）
            
            try:
                # 方法1：查找分隔符在完整翻译中的位置（最准确）
                separator_pos = -1
                found_separator = None
                for sep_variant in SEPARATOR_TRANSLATIONS:
                    pos = out.find(sep_variant)
                    if pos != -1:
                        separator_pos = pos + len(sep_variant)
                        found_separator = sep_variant
                        print(f"[NMT Service] Found separator '{sep_variant}' at position {pos}, extracted text will start at position {separator_pos}")
                        print(f"[NMT Service] Text before separator: '{out[:pos][-50:]}'")
                        print(f"[NMT Service] Text after separator (first 100 chars): '{out[separator_pos:separator_pos+100]}'")
                        break
                
                if separator_pos != -1:
                    # 找到分隔符，提取之后的部分（当前句翻译）
                    # 关键：确保提取位置跳过整个分隔符，不包含分隔符的任何部分
                    raw_extracted = out[separator_pos:].strip()
                    
                    # 立即清理：移除提取内容开头的任何分隔符残留
                    # 因为分隔符可能被部分翻译（如 `<SEP>` 变成 `P>`），需要彻底清理
                    final_output = raw_extracted
                    
                    # 清理：移除所有分隔符变体
                    # ^^ 分隔符不太可能被翻译，只需要移除分隔符变体即可
                    for sep_variant in SEPARATOR_TRANSLATIONS:
                        if final_output.startswith(sep_variant):
                            final_output = final_output[len(sep_variant):].strip()
                            print(f"[NMT Service] Removed separator variant '{sep_variant}' from extracted text start")
                    
                    # 移除中间的分隔符（不应该有，但以防万一）
                    for sep_variant in SEPARATOR_TRANSLATIONS:
                        if sep_variant in final_output:
                            final_output = final_output.replace(sep_variant, " ").strip()
                            print(f"[NMT Service] Removed separator variant '{sep_variant}' from extracted text middle")
                    
                    extraction_mode = "SENTINEL"
                    extraction_confidence = "HIGH"
                    print(f"[NMT Service] Extracted current sentence translation (method: SENTINEL, separator pos={separator_pos}, raw length={len(raw_extracted)}, cleaned length={len(final_output)}): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
                else:
                    # ========== 阶段2：上下文翻译对齐切割（Fallback） ==========
                    print(f"[NMT Service] Separator not found in output, falling back to context translation alignment method")
                    print(f"[NMT Service] Full output: '{out[:200]}{'...' if len(out) > 200 else ''}'")
                    print(f"[NMT Service] Separator variants searched: {SEPARATOR_TRANSLATIONS}")
                    
                    # 单独翻译 context_text，用于在完整翻译中定位
                    context_text = req.context_text
                    context_encoded = tokenizer(context_text, return_tensors="pt").to(DEVICE)
                    context_forced_bos = tokenizer.get_lang_id(req.tgt_lang)
                    
                    with torch.no_grad():
                        context_gen = model.generate(
                            **context_encoded,
                            forced_bos_token_id=context_forced_bos,
                            num_beams=4,
                            num_return_sequences=1,
                            no_repeat_ngram_size=3,
                            repetition_penalty=1.2,
                            max_new_tokens=min(256, max_new_tokens),  # 限制 context 翻译的 token 数
                            early_stopping=False,
                        )
                    
                    # 解码 context_text 的翻译
                    context_translation = tokenizer.decode(context_gen[0], skip_special_tokens=True)
                    context_translation_length = len(context_translation)
                    
                    print(f"[NMT Service] Context translation: '{context_translation[:100]}{'...' if len(context_translation) > 100 else ''}' (length={context_translation_length})")
                    
                    # 在完整翻译中查找 context 翻译的位置（限制在前80%，避免在中间找到错误位置）
                    search_range = int(len(out) * 0.8)
                    search_text = out[:search_range]
                    
                    # 方法1：如果完整翻译以 context 翻译开头，提取剩余部分（最准确）
                    if out.startswith(context_translation):
                        final_output = out[context_translation_length:].strip()
                        extraction_mode = "ALIGN_FALLBACK"
                        extraction_confidence = "HIGH"
                        print(f"[NMT Service] Extracted current sentence translation (method: ALIGN_FALLBACK prefix match): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}' (length={len(final_output)})")
                    else:
                        # 方法2：在完整翻译的前80%中查找 context 翻译的位置
                        context_end_pos = search_text.find(context_translation)
                        if context_end_pos != -1:
                            final_output = out[context_end_pos + context_translation_length:].strip()
                            extraction_mode = "ALIGN_FALLBACK"
                            extraction_confidence = "MEDIUM"
                            print(f"[NMT Service] Extracted current sentence translation (method: ALIGN_FALLBACK substring match in first 80%, context end pos={context_end_pos + context_translation_length}): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}' (length={len(final_output)})")
                        else:
                            # 方法3：使用实际context翻译长度估算（保守方法）
                            if len(out) <= context_translation_length:
                                # 完整翻译长度小于context翻译长度，说明有问题
                                print(f"[NMT Service] WARNING: Full translation ({len(out)}) is shorter than context translation ({context_translation_length}), using full output as fallback")
                                final_output = out
                                extraction_mode = "FULL_ONLY"
                                extraction_confidence = "LOW"
                            else:
                                # 使用实际context翻译长度，加5%缓冲（处理可能的空格/标点差异）
                                estimated_context_translation_length = int(context_translation_length * 1.05)
                                estimated_context_translation_length = min(estimated_context_translation_length, len(out) - 1)
                                final_output = out[estimated_context_translation_length:].strip()
                                extraction_mode = "ALIGN_FALLBACK"
                                extraction_confidence = "LOW"
                                print(f"[NMT Service] Extracted current sentence translation (method: ALIGN_FALLBACK estimated length with 5% buffer, context length={context_translation_length}, estimated pos={estimated_context_translation_length}): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}' (length={len(final_output)})")
                    
                    # 注意：不再进行重叠检测，因为分隔符的回退机制已经处理了重复问题
                    # 如果分隔符丢失，ALIGN_FALLBACK会通过上下文对齐来提取，这已经足够准确
                    
                    # 清理：移除所有可能的分隔符残留
                    for sep_variant in SEPARATOR_TRANSLATIONS:
                        if sep_variant in final_output:
                            final_output = final_output.replace(sep_variant, " ").strip()
                            print(f"[NMT Service] Removed separator '{sep_variant}' from final output (fallback cleanup)")
                
                # ========== 阶段3：最终不为空兜底 ==========
                if not final_output or final_output.strip() == "":
                    print(f"[NMT Service] WARNING: Extracted translation is empty after all methods, using fallback strategies")
                    
                    # 兜底策略1：尝试单独翻译当前文本（不使用context）
                    print(f"[NMT Service] Fallback: Attempting to translate current text without context")
                    try:
                        single_encoded = tokenizer(req.text, return_tensors="pt").to(DEVICE)
                        single_forced_bos = tokenizer.get_lang_id(req.tgt_lang)
                        
                        with torch.no_grad():
                            single_gen = model.generate(
                                **single_encoded,
                                forced_bos_token_id=single_forced_bos,
                                num_beams=4,
                                num_return_sequences=1,
                                no_repeat_ngram_size=3,
                                repetition_penalty=1.2,
                                max_new_tokens=max_new_tokens,
                                early_stopping=False,
                            )
                        
                        single_translation = tokenizer.decode(single_gen[0], skip_special_tokens=True)
                        if single_translation and single_translation.strip():
                            final_output = single_translation.strip()
                            extraction_mode = "SINGLE_ONLY"
                            extraction_confidence = "MEDIUM"
                            print(f"[NMT Service] Fallback successful: Translated current text without context: '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
                        else:
                            # 兜底策略2：使用完整翻译（虽然包含context，但至少保证有结果）
                            print(f"[NMT Service] Fallback: Single translation also empty, using full output as last resort")
                            final_output = out
                            extraction_mode = "FULL_ONLY"
                            extraction_confidence = "LOW"
                    except Exception as e:
                        print(f"[NMT Service] ERROR: Fallback translation failed: {e}, using full output as last resort")
                        final_output = out
                        extraction_mode = "FULL_ONLY"
                        extraction_confidence = "LOW"
                
                # 修复：不应该因为提取结果为空或太短就使用完整输出
                # 超长句+超短句是常见情况，应该直接返回提取结果，即使它很短
                # 如果提取失败，应该返回空字符串，而不是完整输出（完整输出包含 context 翻译）
                if not final_output:
                    # 提取结果为空，返回空字符串（而不是完整输出）
                    # 完整输出包含 context 翻译，不应该返回
                    print(f"[NMT Service] WARNING: Extracted translation is empty, returning empty string (not using full output which contains context translation)")
                    final_output = ""
                elif len(final_output) < len(req.text) * 0.5 and len(req.text) > 5:
                    # 只有当当前文本长度>5时，才认为提取结果太短可能是错误
                    # 如果当前文本本身就很短（<=5个字符），提取结果短是正常的
                    print(f"[NMT Service] WARNING: Extracted translation too short (extracted={len(final_output)}, original={len(req.text)}), but original text is long")
                    # 修复：如果提取结果太短，不应该使用完整输出（完整输出包含 context 翻译）
                    # 应该直接返回提取结果，即使它很短
                    # 超长句+超短句是常见情况，不应该按照特殊机制处理
                    print(f"[NMT Service] Returning extracted translation as-is (even if short), not using full output which contains context translation")
                    # final_output 保持不变，直接返回提取结果
                else:
                    # 当前文本很短，提取结果短是正常的，不需要使用完整输出
                    print(f"[NMT Service] Extracted translation length is acceptable (extracted={len(final_output)}, original={len(req.text)})")
                    
                    # 额外检查：如果提取结果以小写字母开头（可能是截断），尝试查找更准确的分割点
                    # 例如："ave not yet come back" 应该是 "Three sentences have not yet come back"
                    if final_output and len(final_output) > 0 and final_output[0].islower():
                        # 尝试在完整翻译中查找当前句翻译的起始位置
                        # 方法：查找完整翻译中与提取结果匹配的部分，但向前扩展
                        # 如果完整翻译包含提取结果，尝试找到更早的起始位置
                        if final_output in out:
                            # 查找提取结果在完整翻译中的位置
                            match_pos = out.find(final_output)
                            if match_pos > 0:
                                # 检查前面是否有更合理的起始点（以大写字母或数字开头）
                                # 向前查找，找到最近的大写字母或数字作为可能的起始点
                                # 但需要排除分隔符相关的字符（<, >, P等）
                                for i in range(match_pos - 1, max(0, match_pos - 50), -1):
                                    # 跳过分隔符相关的字符
                                    if out[i] in ['<', '>', 'P', 'S', 'E']:
                                        # 检查是否是分隔符的一部分
                                        if i > 0 and i < len(out) - 1:
                                            # 检查前后字符，判断是否是分隔符
                                            context = out[max(0, i-2):min(len(out), i+3)]
                                            if '<SEP>' in context or '<sep>' in context or 'SEP' in context:
                                                continue  # 跳过分隔符字符
                                    
                                    if out[i].isupper() or out[i].isdigit():
                                        # 找到可能的起始点，但需要检查是否合理（不要太远）
                                        if match_pos - i < 30:  # 最多向前30个字符
                                            potential_start = i
                                            # 检查从该位置到提取结果之间的文本是否合理
                                            potential_text = out[potential_start:match_pos + len(final_output)]
                                            
                                            # 检查potential_text是否包含分隔符，如果包含则跳过
                                            has_separator = False
                                            for sep_variant in SEPARATOR_TRANSLATIONS:
                                                if sep_variant in potential_text:
                                                    has_separator = True
                                                    break
                                            
                                            if not has_separator and final_output in potential_text and len(potential_text) <= len(out) * 0.8:
                                                print(f"[NMT Service] Found better extraction point (starts with uppercase): '{potential_text[:100]}{'...' if len(potential_text) > 100 else ''}'")
                                                final_output = potential_text.strip()
                                                # 清理潜在的分隔符
                                                for sep_variant in SEPARATOR_TRANSLATIONS:
                                                    final_output = final_output.replace(sep_variant, " ").strip()
                                                break
            except Exception as e:
                print(f"[NMT Service] WARNING: Failed to extract current sentence translation: {e}, using full output")
                final_output = out
                extraction_mode = "FULL_ONLY"
                extraction_confidence = "LOW"
        
        # 修复：检查翻译结果是否可能被截断（包括开头截断）
        def is_translation_complete(text: str) -> bool:
            """检查翻译结果是否完整（简单启发式方法）"""
            text = text.strip()
            if not text:
                return False
            
            # 检查是否以标点符号结尾
            ending_punctuation = ['.', '!', '?', '。', '！', '？', ',', '，', ';', '；']
            if text[-1] in ending_punctuation:
                return True
            
            # 检查最后几个词是否完整（简单检查）
            last_words = text.split()[-3:]  # 最后 3 个词
            for word in last_words:
                if len(word) < 2:  # 单字符词可能是截断
                    return False
            
            return True
        
        # 修复：检查翻译是否可能被截断（包括开头截断）
        # 如果翻译以小写字母开头且不是专有名词，可能是截断
        translation_complete = is_translation_complete(final_output)
        translation_starts_properly = True
        if final_output and len(final_output) > 0:
            # 检查是否以小写字母开头（可能是截断）
            if final_output[0].islower():
                # 检查第一个词是否是常见的专有名词或缩写
                first_word = final_output.split()[0] if final_output.split() else ""
                common_lowercase_starts = ["i", "we", "you", "they", "it", "this", "that", "the", "a", "an"]
                if first_word.lower() not in common_lowercase_starts:
                    translation_starts_properly = False
                    print(f"[NMT Service] WARNING: Translation may be truncated at the beginning (starts with lowercase '{first_word}')")
        
        if not translation_complete or not translation_starts_properly:
            actual_tokens = gen.shape[1] if gen is not None and len(gen.shape) > 1 else 0
            print(f"[NMT Service] WARNING: Translation may be truncated (max_new_tokens={max_new_tokens}, actual_tokens={actual_tokens})")
            print(f"[NMT Service] WARNING: First 50 chars: '{final_output[:50]}'")
            print(f"[NMT Service] WARNING: Last 50 chars: '{final_output[-50:]}'")
            # 如果检测到截断，尝试增加 max_new_tokens 并重新生成（仅当没有 context_text 时）
            # 注意：这会导致额外的延迟，但可以确保翻译完整
            if not req.context_text and not translation_starts_properly:
                print(f"[NMT Service] WARNING: Translation appears truncated at beginning, but cannot retry without context_text")
        
        # 过滤只包含标点符号的翻译结果（如 "试试试" 被翻译成 "try." 的情况）
        if final_output and PUNCTUATION_FILTER_ENABLED:
            try:
                # 使用配置文件中的正则表达式模式移除标点符号
                text_without_punctuation = re.sub(PUNCTUATION_FILTER_PATTERN, '', final_output)
                # 如果去除标点后的长度小于最小长度，说明文本只包含标点符号
                if not text_without_punctuation or len(text_without_punctuation.strip()) < PUNCTUATION_FILTER_MIN_LENGTH:
                    print(f"[NMT Service] WARNING: Translation contains only punctuation marks, filtering to avoid invalid output. "
                          f"original_text='{final_output}', pattern='{PUNCTUATION_FILTER_PATTERN}', min_length={PUNCTUATION_FILTER_MIN_LENGTH}")
                    final_output = ""
            except Exception as e:
                print(f"[NMT Service] ERROR: Failed to filter punctuation-only text: {e}")
        
        # 修复：过滤包含引号的短句翻译（正常说话不可能出现引号，这是模型噪音）
        # 检查翻译结果是否包含引号，且长度较短（可能是噪音）
        if final_output and len(final_output) < 50:  # 短句（少于50个字符）
            # 检查是否包含引号（单引号或双引号）
            has_quotes = "'" in final_output or '"' in final_output
            if has_quotes:
                # 移除引号后检查是否还有有效内容
                text_without_quotes = final_output.replace("'", "").replace('"', '').strip()
                # 如果移除引号后只剩下很少的内容，或者引号是主要内容，则过滤掉
                if len(text_without_quotes) < len(final_output) * 0.5 or len(text_without_quotes) < 3:
                    print(f"[NMT Service] WARNING: Translation contains quotes and is likely noise, filtering. "
                          f"original_text='{final_output}', text_without_quotes='{text_without_quotes}', length={len(final_output)}")
                    final_output = ""
        
        print(f"[NMT Service] Final output: '{final_output[:200]}{'...' if len(final_output) > 200 else ''}' (length={len(final_output)})")
        print(f"[NMT Service] ===== Translation Request Completed in {total_elapsed:.2f}ms =====")
        
        # 构建响应
        response = TranslateResponse(
            ok=True,
            text=final_output,
            model=loaded_model_path or "local-m2m100",
            provider="local-m2m100",
            candidates=candidates if candidates else None,  # 如果有候选，添加到响应中
            extraction_mode=extraction_mode,  # 提取模式
            extraction_confidence=extraction_confidence,  # 提取置信度
            extra={
                "elapsed_ms": int(total_elapsed),
                "num_tokens": int(gen.shape[1]),
                "tokenization_ms": int(tokenizer_elapsed),
                "generation_ms": int(generation_elapsed),
                "decoding_ms": int(decode_elapsed),
                "num_candidates": len(candidates) if candidates else 0
            }
        )
        
        return response
    except Exception as e:
        total_elapsed = (time.time() - request_start) * 1000
        print(f"[NMT Service] Error: {e}")
        print(f"[NMT Service] ===== Translation Request Failed in {total_elapsed:.2f}ms =====")
        import traceback
        traceback.print_exc()
        return TranslateResponse(
            ok=False,
            error=str(e),
            provider="local-m2m100",
            extra={"elapsed_ms": int(total_elapsed)}
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5008)

