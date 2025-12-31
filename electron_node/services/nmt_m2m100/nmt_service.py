# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务（FastAPI）

提供 HTTP API 接口，使用 HuggingFace Transformers 运行 M2M100 模型进行翻译。
"""

# 强制设置标准输出和错误输出为 UTF-8 编码（Windows 兼容性）
# 注意：使用 line_buffering=False 以减少内存开销
import sys
import io
import os
import time
import datetime
import traceback
from typing import Optional

import torch
from fastapi import FastAPI
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer

from api_models import TranslateRequest, TranslateResponse
from config import SEPARATOR
from model_loader import (
    setup_device,
    log_gpu_info,
    find_local_model_path,
    load_tokenizer,
    load_model_with_retry,
    move_model_to_device,
)
from translation_extractor import extract_translation
from translation_utils import calculate_max_new_tokens, is_translation_complete

if sys.platform == 'win32':
    # Windows 系统：强制使用 UTF-8 编码，但不使用行缓冲以减少内存开销
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=False)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=False)

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
        
        # 设置设备
        DEVICE = setup_device()
        print(f"[NMT Service] Device: {DEVICE}", flush=True)
        
        # 记录 GPU 信息
        log_gpu_info()
        
        # 强制只使用本地文件 - 不允许从 HuggingFace 下载模型
        os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
        os.environ["HF_LOCAL_FILES_ONLY"] = "1"
        
        # 从服务目录查找本地模型
        service_dir = os.path.dirname(__file__)
        local_model_path = find_local_model_path(service_dir)
        
        # 保存实际使用的模型路径
        loaded_model_path = local_model_path
        
        # 加载 tokenizer
        tokenizer = load_tokenizer(local_model_path)
        
        # 加载模型
        model = load_model_with_retry(local_model_path, DEVICE)
        
        # 移动到目标设备
        model = move_model_to_device(model, DEVICE)
        
        print(f"[NMT Service] Model loaded successfully on {DEVICE}", flush=True)
    except Exception as e:
        print(f"[NMT Service] [CRITICAL ERROR] Failed to load model: {e}", flush=True)
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
        input_text = req.text
        context_text = req.context_text  # 保存 context_text 用于后续提取
        # 使用哨兵序列（Sentinel Sequence）来准确识别和提取当前句翻译（从配置文件读取）
        # 如果context_text为空或空字符串，直接使用当前文本，不需要拼接
        if req.context_text and req.context_text.strip():
            # 使用哨兵序列拼接：上下文 + 哨兵序列 + 当前文本
            input_text = f"{req.context_text}{SEPARATOR}{req.text}"
            print(f"[NMT Service] Concatenated input with sentinel sequence: '{input_text[:100]}{'...' if len(input_text) > 100 else ''}' (total length={len(input_text)})")
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
        
        # 计算动态 max_new_tokens
        max_new_tokens = calculate_max_new_tokens(
            input_text=req.text,
            tokenizer=tokenizer,
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
        final_output, extraction_mode, extraction_confidence = extract_translation(
            out=out,
            context_text=context_text,
            current_text=req.text,
            tokenizer=tokenizer,
            model=model,
            tgt_lang=req.tgt_lang,
            device=DEVICE,
            max_new_tokens=max_new_tokens
        )
        
        # 检查翻译结果是否可能被截断（包括开头截断）
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
            if not req.context_text and not translation_starts_properly:
                print(f"[NMT Service] WARNING: Translation appears truncated at beginning, but cannot retry without context_text")
        
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
