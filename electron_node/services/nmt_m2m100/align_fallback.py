# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 对齐回退提取器
使用上下文翻译对齐方法提取当前句翻译（Fallback方法）
"""
import torch
from typing import Tuple
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer


def extract_with_align_fallback(
    out: str,
    context_text: str,
    tokenizer: M2M100Tokenizer,
    model: M2M100ForConditionalGeneration,
    tgt_lang: str,
    device: torch.device,
    max_new_tokens: int
) -> Tuple[str, str, str]:
    """使用上下文对齐方法提取（Fallback）"""
    print(f"[NMT Service] Sentinel sequence not found in output, falling back to context translation alignment method")
    print(f"[NMT Service] Full output: '{out[:200]}{'...' if len(out) > 200 else ''}'")
    
    # 单独翻译 context_text，用于在完整翻译中定位
    context_encoded = tokenizer(context_text, return_tensors="pt").to(device)
    context_forced_bos = tokenizer.get_lang_id(tgt_lang)
    
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
        potential_output = out[context_translation_length:].strip()
        # 验证：确保提取的文本不是空的，且不是 context 翻译的一部分
        if potential_output and len(potential_output) >= max(5, context_translation_length * 0.1):
            # 额外验证：检查提取的文本是否与 context 翻译有重叠（避免提取错误）
            if potential_output[:min(20, len(potential_output))] not in context_translation:
                final_output = potential_output
                extraction_mode = "ALIGN_FALLBACK"
                extraction_confidence = "HIGH"
                print(f"[NMT Service] Extracted current sentence translation (method: ALIGN_FALLBACK prefix match): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}' (length={len(final_output)})")
                return final_output, extraction_mode, extraction_confidence
            else:
                # 提取的文本与 context 翻译重叠，可能是匹配错误，使用方法2
                return _try_substring_match(out, context_translation, context_translation_length, search_text)
        else:
            # 提取的文本太短，可能是匹配错误，使用方法2
            return _try_substring_match(out, context_translation, context_translation_length, search_text)
    else:
        # 方法2：在完整翻译的前80%中查找 context 翻译的位置
        return _try_substring_match(out, context_translation, context_translation_length, search_text)


def _try_substring_match(
    out: str,
    context_translation: str,
    context_translation_length: int,
    search_text: str
) -> Tuple[str, str, str]:
    """尝试使用子字符串匹配方法"""
    context_end_pos = search_text.find(context_translation)
    if context_end_pos != -1:
        potential_output = out[context_end_pos + context_translation_length:].strip()
        # 验证：确保提取的文本不是空的，且不是 context 翻译的一部分
        if potential_output and len(potential_output) >= max(5, context_translation_length * 0.1):
            # 额外验证：检查提取的文本是否与 context 翻译有重叠
            if potential_output[:min(20, len(potential_output))] not in context_translation:
                final_output = potential_output
                extraction_mode = "ALIGN_FALLBACK"
                extraction_confidence = "MEDIUM"
                print(f"[NMT Service] Extracted current sentence translation (method: ALIGN_FALLBACK substring match in first 80%, context end pos={context_end_pos + context_translation_length}): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}' (length={len(final_output)})")
                return final_output, extraction_mode, extraction_confidence
            else:
                # 提取的文本与 context 翻译重叠，使用方法3
                return _try_estimated_length(out, context_translation_length)
        else:
            # 提取的文本太短，使用方法3
            return _try_estimated_length(out, context_translation_length)
    else:
        # 方法3：使用实际context翻译长度估算（保守方法）
        return _try_estimated_length(out, context_translation_length)


def _try_estimated_length(out: str, context_translation_length: int) -> Tuple[str, str, str]:
    """尝试使用估算长度方法"""
    if len(out) <= context_translation_length:
        # 完整翻译长度小于context翻译长度，说明有问题
        print(f"[NMT Service] WARNING: Full translation ({len(out)}) is shorter than context translation ({context_translation_length}), using full output as fallback")
        final_output = out
        extraction_mode = "FULL_ONLY"
        extraction_confidence = "LOW"
        return final_output, extraction_mode, extraction_confidence
    else:
        # 使用实际context翻译长度，加5%缓冲（处理可能的空格/标点差异）
        estimated_context_translation_length = int(context_translation_length * 1.05)
        estimated_context_translation_length = min(estimated_context_translation_length, len(out) - 1)
        final_output = out[estimated_context_translation_length:].strip()
        extraction_mode = "ALIGN_FALLBACK"
        extraction_confidence = "LOW"
        print(f"[NMT Service] Extracted current sentence translation (method: ALIGN_FALLBACK estimated length with 5% buffer, context length={context_translation_length}, estimated pos={estimated_context_translation_length}): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}' (length={len(final_output)})")
        return final_output, extraction_mode, extraction_confidence
