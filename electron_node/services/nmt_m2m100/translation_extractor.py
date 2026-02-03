# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 翻译提取器
从完整翻译中提取当前句的翻译部分（主入口，聚合哨兵/兜底/过滤修复逻辑）。
"""
from typing import Optional, Tuple

import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer

from pattern_generator import generate_truncated_patterns
from config import SEPARATOR_TRANSLATIONS

from align_fallback import extract_with_align_fallback
from translation_sentinel import (
    find_sentinel_position,
    extract_with_sentinel,
    cleanup_sentinel_sequences,
)
from translation_fallback import (
    extract_single_translation,
    _fallback_full_or_last_segment,
    try_extract_last_segment_from_full,
)
from translation_filters_fixes import (
    fix_lowercase_start,
    filter_punctuation_only,
    filter_quotes_noise,
    fix_separator_char_start,
    fix_comma_start_extraction,
)

# 预生成截断模式（在服务启动时生成一次，避免每次请求都重新生成）
TRUNCATED_PATTERNS = generate_truncated_patterns(SEPARATOR_TRANSLATIONS)

# 兜底路径统一日志前缀（供本模块日志使用）
_EXTRACTION_FALLBACK_PREFIX = "[NMT Service] EXTRACTION_FALLBACK"


def extract_translation(
    out: str,
    context_text: Optional[str],
    current_text: str,
    tokenizer: M2M100Tokenizer,
    model: M2M100ForConditionalGeneration,
    tgt_lang: str,
    device: torch.device,
    max_new_tokens: int
) -> Tuple[str, str, str]:
    """
    从完整翻译中提取当前句的翻译

    Returns:
        (final_output, extraction_mode, extraction_confidence)
    """
    if not context_text or not context_text.strip():
        return out, "FULL_ONLY", "HIGH"

    print(f"[NMT Service] WARNING: Output contains translation of BOTH context_text and text. Extracting only current sentence translation.")

    try:
        sentinel_pos, found_sentinel = find_sentinel_position(out, TRUNCATED_PATTERNS, use_last_sentinel=True)

        if sentinel_pos != -1:
            final_output = extract_with_sentinel(out, sentinel_pos)
            if final_output:
                extraction_mode = "SENTINEL"
                extraction_confidence = "HIGH"
                print(f"[NMT Service] Extracted current sentence translation (method: SENTINEL, sentinel pos={sentinel_pos}, cleaned length={len(final_output)}): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
            else:
                final_output, extraction_mode, extraction_confidence = extract_with_align_fallback(
                    out, context_text, tokenizer, model, tgt_lang, device, max_new_tokens
                )
                final_output = cleanup_sentinel_sequences(final_output)
        else:
            final_output, extraction_mode, extraction_confidence = extract_with_align_fallback(
                out, context_text, tokenizer, model, tgt_lang, device, max_new_tokens
            )
            final_output = cleanup_sentinel_sequences(final_output)

        if not final_output or final_output.strip() == "":
            print(f"[NMT Service] WARNING: Extracted translation is empty after all methods, using fallback strategies")

            single_translation = extract_single_translation(
                current_text, tokenizer, model, tgt_lang, device, max_new_tokens
            )
            if single_translation:
                final_output = single_translation
                extraction_mode = "SINGLE_ONLY"
                extraction_confidence = "MEDIUM"
                print(f"[NMT Service] Fallback successful: Translated current text without context: '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
            else:
                final_output, extraction_mode = _fallback_full_or_last_segment(out)
                extraction_confidence = "LOW"
                print(f"{_EXTRACTION_FALLBACK_PREFIX} mode={extraction_mode} reason=single_translation_empty out_len={len(out)}"
                      f"{' segment_len=' + str(len(final_output)) if extraction_mode == 'FULL_ONLY_LAST_SEGMENT' else ' out_preview=' + repr(out[:80])}", flush=True)

        if not final_output:
            print(f"[NMT Service] WARNING: Extracted translation is empty, returning empty string (not using full output which contains context translation)")
            final_output = ""
        elif len(final_output) < len(current_text) * 0.3 and len(current_text) > 10:
            print(f"[NMT Service] WARNING: Extracted translation too short (extracted={len(final_output)}, original={len(current_text)}, ratio={len(final_output)/len(current_text):.2f}), but original text is long")
            print(f"[NMT Service] This may indicate extraction error, but still returning extracted translation (not using full output which contains context translation)")
        elif len(final_output) < len(current_text) * 0.5 and len(current_text) > 5:
            print(f"[NMT Service] WARNING: Extracted translation shorter than expected (extracted={len(final_output)}, original={len(current_text)}, ratio={len(final_output)/len(current_text):.2f})")
            print(f"[NMT Service] Returning extracted translation as-is (even if short), not using full output which contains context translation")
        else:
            print(f"[NMT Service] Extracted translation length is acceptable (extracted={len(final_output)}, original={len(current_text)}, ratio={len(final_output)/len(current_text):.2f})")

        final_output = fix_lowercase_start(final_output, out)
        final_output = fix_separator_char_start(final_output, out)
        final_output = fix_comma_start_extraction(final_output, out, TRUNCATED_PATTERNS)

    except Exception as e:
        print(f"[NMT Service] WARNING: Failed to extract current sentence translation: {e}", flush=True)
        final_output, extraction_mode = _fallback_full_or_last_segment(out)
        extraction_confidence = "LOW"
        print(f"{_EXTRACTION_FALLBACK_PREFIX} mode={extraction_mode} reason=exception exception={repr(str(e)[:60])} out_len={len(out)}"
              f"{' segment_len=' + str(len(final_output)) if extraction_mode == 'FULL_ONLY_LAST_SEGMENT' else ' out_preview=' + repr(out[:80])}", flush=True)

    final_output = filter_punctuation_only(final_output)
    final_output = filter_quotes_noise(final_output)

    return final_output, extraction_mode, extraction_confidence


# 对外导出（供 nmt_service 与测试使用）
__all__ = [
    "extract_translation",
    "cleanup_sentinel_sequences",
    "try_extract_last_segment_from_full",
    "_fallback_full_or_last_segment",
]
