# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务（FastAPI）

提供 HTTP API 接口，使用 HuggingFace Transformers 运行 M2M100 模型进行翻译。
"""

from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional, Dict, Any
import time
import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import os

app = FastAPI(title="M2M100 NMT Service", version="1.0.0")

# 模型名称（仅用于文档说明，实际从本地目录加载）
MODEL_NAME = "facebook/m2m100_418M"
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 全局模型和 tokenizer
tokenizer: Optional[M2M100Tokenizer] = None
model: Optional[M2M100ForConditionalGeneration] = None
loaded_model_path: Optional[str] = None  # 实际加载的模型路径


class TranslateRequest(BaseModel):
    src_lang: str
    tgt_lang: str
    text: str
    context_text: Optional[str] = None  # 上下文文本（可选，用于提升翻译质量）


class TranslateResponse(BaseModel):
    ok: bool
    text: Optional[str] = None
    model: Optional[str] = None
    provider: str = "local-m2m100"
    extra: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@app.on_event("startup")
async def load_model():
    """启动时加载模型"""
    global tokenizer, model, loaded_model_path
    try:
        print(f"[NMT Service] Device: {DEVICE}")
        
        # GPU 检查
        if torch.cuda.is_available():
            print(f"[NMT Service] [OK] CUDA available: {torch.cuda.is_available()}")
            print(f"[NMT Service] [OK] CUDA version: {torch.version.cuda}")
            print(f"[NMT Service] [OK] GPU count: {torch.cuda.device_count()}")
            print(f"[NMT Service] [OK] GPU name: {torch.cuda.get_device_name(0)}")
            print(f"[NMT Service] [OK] GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB")
        else:
            print(f"[NMT Service] [WARN] CUDA not available, using CPU")
        
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
        except Exception as e:
            raise RuntimeError(
                f"Failed to load tokenizer from {local_model_path}: {e}\n"
                "Please ensure the model files are complete and valid."
            )
        
        # 加载 PyTorch 模型
        print(f"[NMT Service] Loading PyTorch model from local path: {local_model_path}")
        # 禁用所有可能导致 meta tensor 的优化选项
        # 关键：low_cpu_mem_usage=False 必须设置，否则会使用 meta device
        os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
        
        try:
            model = M2M100ForConditionalGeneration.from_pretrained(
                local_model_path, 
                **extra,
                low_cpu_mem_usage=False,  # 禁用低内存模式（这是关键！必须为 False）
                torch_dtype=torch.float32,  # 明确指定数据类型
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to load PyTorch model from {local_model_path}: {e}\n"
                "Please ensure the model files are complete and valid."
            )
        
        # 检查模型是否在 meta 设备上
        try:
            first_param = next(model.parameters(), None)
            if first_param is not None:
                param_device = str(first_param.device)
                if param_device == "meta":
                    raise RuntimeError(f"Model loaded to meta device: {param_device}. This should not happen with low_cpu_mem_usage=False")
        except StopIteration:
            pass  # 模型没有参数（不应该发生）
        
        # 移动到目标设备
        model = model.to(DEVICE).eval()
        
        print(f"[NMT Service] Model loaded successfully on {DEVICE}")
    except Exception as e:
        print(f"[NMT Service] Failed to load model: {e}")
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
    print(f"[NMT Service] Input: '{req.text[:50]}{'...' if len(req.text) > 50 else ''}' (src={req.src_lang}, tgt={req.tgt_lang})")
    
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
        if req.context_text:
            # 简单拼接：上下文 + 当前文本
            # 实际应用中可能需要更复杂的处理
            input_text = f"{req.context_text} {req.text}"
        
        # 编码输入文本（M2M100 会在文本前自动添加源语言 token）
        encoded = tokenizer(input_text, return_tensors="pt").to(DEVICE)
        tokenizer_elapsed = (time.time() - tokenizer_start) * 1000
        print(f"[NMT Service] [Tokenization] Completed in {tokenizer_elapsed:.2f}ms")
        
        # 获取目标语言 token ID
        forced_bos = tokenizer.get_lang_id(req.tgt_lang)
        
        # 生成翻译
        generation_start = time.time()
        with torch.no_grad():
            gen = model.generate(
                **encoded,
                forced_bos_token_id=forced_bos,
                num_beams=4,
                no_repeat_ngram_size=3,
                repetition_penalty=1.2,
                max_new_tokens=256,  # 增加最大 token 数，避免截断
                early_stopping=False,  # 禁用早停，确保完整翻译
            )
        generation_elapsed = (time.time() - generation_start) * 1000
        print(f"[NMT Service] [Generation] Completed in {generation_elapsed:.2f}ms")
        
        # 解码输出
        decode_start = time.time()
        generated_ids = gen[0].cpu().numpy().tolist()
        tgt_lang_id = tokenizer.get_lang_id(req.tgt_lang)
        eos_token_id = tokenizer.eos_token_id
        
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
            out = tokenizer.decode(gen[0], skip_special_tokens=True)
        
        decode_elapsed = (time.time() - decode_start) * 1000
        
        total_elapsed = (time.time() - request_start) * 1000
        print(f"[NMT Service] [Decoding] Completed in {decode_elapsed:.2f}ms")
        print(f"[NMT Service] Output: '{out[:50]}{'...' if len(out) > 50 else ''}'")
        print(f"[NMT Service] ===== Translation Request Completed in {total_elapsed:.2f}ms =====")
        
        return TranslateResponse(
            ok=True,
            text=out,
            model=loaded_model_path or "local-m2m100",
            provider="local-m2m100",
            extra={
                "elapsed_ms": int(total_elapsed),
                "num_tokens": int(gen.shape[1]),
                "tokenization_ms": int(tokenizer_elapsed),
                "generation_ms": int(generation_elapsed),
                "decoding_ms": int(decode_elapsed)
            }
        )
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

