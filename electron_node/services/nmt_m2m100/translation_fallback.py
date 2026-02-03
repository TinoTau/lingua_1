# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 翻译提取兜底逻辑
单独翻译、取最后一段、统一兜底。
"""
from typing import Optional, Tuple

import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer

from translation_sentinel import cleanup_sentinel_sequences

# 兜底路径统一日志前缀，便于 grep 定位异常
_EXTRACTION_FALLBACK_PREFIX = "[NMT Service] EXTRACTION_FALLBACK"


def extract_single_translation(
    text: str,
    tokenizer: M2M100Tokenizer,
    model: M2M100ForConditionalGeneration,
    tgt_lang: str,
    device: torch.device,
    max_new_tokens: int
) -> Optional[str]:
    """单独翻译当前文本（不使用context）"""
    print(f"[NMT Service] Fallback: Attempting to translate current text without context")
    try:
        single_encoded = tokenizer(text, return_tensors="pt").to(device)
        single_forced_bos = tokenizer.get_lang_id(tgt_lang)

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
            return single_translation.strip()
        return None
    except Exception as e:
        print(f"[NMT Service] ERROR: Fallback translation failed: {e}")
        return None


def _fallback_full_or_last_segment(out: str) -> Tuple[str, str]:
    """兜底：从完整输出取最后一段，或直接返回完整输出。返回 (final_output, extraction_mode)。"""
    last_seg = try_extract_last_segment_from_full(out)
    if last_seg:
        return last_seg, "FULL_ONLY_LAST_SEGMENT"
    return out, "FULL_ONLY"


def try_extract_last_segment_from_full(out: str) -> Optional[str]:
    """
    当即将返回 FULL_ONLY（完整译文含上下文）时，尝试用分隔符/SEP_MARKER 变体分割，
    取最后一段作为当前句译文，避免合并译文返回给客户端。
    若找不到分隔符或最后一段为空，返回 None。
    """
    from config import SEPARATOR_TRANSLATIONS, SEP_MARKER_VARIANTS

    if not out or not out.strip():
        print(f"{_EXTRACTION_FALLBACK_PREFIX} last_segment_from_full=skip reason=empty_out", flush=True)
        return None
    last_pos = -1
    for sep_variant in SEPARATOR_TRANSLATIONS:
        pos = out.rfind(sep_variant)
        if pos != -1:
            candidate = pos + len(sep_variant)
            if candidate > last_pos:
                last_pos = candidate
    for marker_variant in SEP_MARKER_VARIANTS:
        pos = out.rfind(marker_variant)
        if pos != -1:
            candidate = pos + len(marker_variant)
            if candidate > last_pos:
                last_pos = candidate
    if last_pos <= 0:
        print(f"{_EXTRACTION_FALLBACK_PREFIX} last_segment_from_full=no_separator out_len={len(out)} out_preview={repr(out[:80])}", flush=True)
        return None
    segment = out[last_pos:].strip()
    if not segment or len(segment) < 2:
        print(f"{_EXTRACTION_FALLBACK_PREFIX} last_segment_from_full=empty_after_sep out_len={len(out)}", flush=True)
        return None
    segment = cleanup_sentinel_sequences(segment)
    if not segment or not segment.strip():
        print(f"{_EXTRACTION_FALLBACK_PREFIX} last_segment_from_full=cleaned_empty out_len={len(out)}", flush=True)
        return None
    print(f"{_EXTRACTION_FALLBACK_PREFIX} last_segment_from_full=ok segment_len={len(segment)} segment_preview={repr(segment[:80])}", flush=True)
    return segment
