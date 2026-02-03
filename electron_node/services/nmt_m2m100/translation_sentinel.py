# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 哨兵查找与提取
从完整翻译中查找哨兵位置并提取/清理哨兵序列。
"""
from typing import Optional, Tuple

from config import (
    SEPARATOR_TRANSLATIONS,
    SEP_MARKER_VARIANTS,
)


def find_sentinel_position(out: str, truncated_patterns: list, use_last_sentinel: bool = False) -> Tuple[int, Optional[str]]:
    """
    查找哨兵序列在完整翻译中的位置。
    use_last_sentinel: 当有 context 时置 True，用最后一个哨兵位置提取当前句，避免前半句被丢弃（如 Job7「10秒鐘之後」）。
    """
    sentinel_pos = -1
    found_sentinel = None

    if use_last_sentinel:
        best_pos = -1
        best_sentinel = None
        for sep_variant in SEPARATOR_TRANSLATIONS:
            pos = out.rfind(sep_variant)
            if pos != -1:
                candidate = pos + len(sep_variant)
                if candidate > best_pos:
                    best_pos = candidate
                    best_sentinel = sep_variant
        for marker_variant in SEP_MARKER_VARIANTS:
            pos = out.rfind(marker_variant)
            if pos != -1:
                candidate = pos + len(marker_variant)
                if candidate > best_pos:
                    best_pos = candidate
                    best_sentinel = marker_variant
        for pattern in truncated_patterns:
            pos = out.rfind(pattern)
            if pos != -1:
                candidate = pos + len(pattern)
                if candidate > best_pos:
                    best_pos = candidate
                    best_sentinel = pattern
        if best_pos != -1 and best_sentinel:
            sentinel_pos = best_pos
            found_sentinel = best_sentinel
            before_start = max(0, best_pos - len(best_sentinel))
            print(f"[NMT Service] (use_last_sentinel) Found last sentinel -> extracted start at {sentinel_pos}")
            print(f"[NMT Service] Text before last sentinel: '{out[:before_start][-50:]}'")
            print(f"[NMT Service] Text after last sentinel (first 100 chars): '{out[sentinel_pos:sentinel_pos+100]}'")
            return sentinel_pos, found_sentinel
        return -1, None

    for sep_variant in SEPARATOR_TRANSLATIONS:
        pos = out.find(sep_variant)
        if pos != -1:
            sentinel_pos = pos + len(sep_variant)
            found_sentinel = sep_variant
            print(f"[NMT Service] Found sentinel sequence '{sep_variant}' at position {pos}, extracted text will start at position {sentinel_pos}")
            print(f"[NMT Service] Text before sentinel: '{out[:pos][-50:]}'")
            print(f"[NMT Service] Text after sentinel (first 100 chars): '{out[sentinel_pos:sentinel_pos+100]}'")
            return sentinel_pos, found_sentinel

    for marker_variant in SEP_MARKER_VARIANTS:
        pos = out.find(marker_variant)
        if pos != -1:
            sentinel_pos = pos + len(marker_variant)
            found_sentinel = marker_variant
            print(f"[NMT Service] Found plain text SEP_MARKER '{marker_variant}' at position {pos} (Unicode brackets were translated away), extracted text will start at position {sentinel_pos}")
            print(f"[NMT Service] Text before SEP_MARKER: '{out[:pos][-50:]}'")
            print(f"[NMT Service] Text after SEP_MARKER (first 100 chars): '{out[sentinel_pos:sentinel_pos+100]}'")
            return sentinel_pos, found_sentinel

    for pattern in truncated_patterns:
        pos = out.find(pattern)
        if pos != -1:
            sentinel_pos = pos + len(pattern)
            found_sentinel = pattern
            print(f"[NMT Service] WARNING: Found truncated SEP_MARKER pattern '{pattern}' at position {pos}, extracted text will start at position {sentinel_pos}")
            print(f"[NMT Service] Text before truncated pattern: '{out[:pos][-50:]}'")
            print(f"[NMT Service] Text after truncated pattern (first 100 chars): '{out[sentinel_pos:sentinel_pos+100]}'")
            extracted_preview = out[sentinel_pos:sentinel_pos+20].strip()
            if len(extracted_preview) > 0:
                print(f"[NMT Service] Extracted text preview: '{extracted_preview}'")
            if len(pattern) <= 2:
                if sentinel_pos < len(out) and out[sentinel_pos:sentinel_pos+1] == ' ':
                    next_text_start = sentinel_pos + 1
                    if next_text_start < len(out):
                        next_text = out[next_text_start:next_text_start+10].strip()
                        if len(next_text) > 0:
                            sentinel_pos = next_text_start
                            print(f"[NMT Service] Adjusted sentinel_pos to skip space after short pattern, new pos={sentinel_pos}")
            return sentinel_pos, found_sentinel

    return -1, None


def extract_with_sentinel(out: str, sentinel_pos: int) -> str:
    """使用哨兵序列位置提取文本"""
    if sentinel_pos < 0 or sentinel_pos >= len(out):
        print(f"[NMT Service] ERROR: Invalid sentinel_pos={sentinel_pos}, output length={len(out)}, using fallback")
        return None

    raw_extracted = out[sentinel_pos:].strip()

    if raw_extracted:
        first_char = raw_extracted[0]
        for sep_variant in SEPARATOR_TRANSLATIONS:
            if first_char in sep_variant and len(raw_extracted) > 1:
                if raw_extracted[1:2] == ' ':
                    print(f"[NMT Service] WARNING: Extracted text starts with separator character '{first_char}', "
                          f"this may indicate index calculation error. sentinel_pos={sentinel_pos}, "
                          f"separator='{sep_variant}', extracted='{raw_extracted[:50]}'")
                    corrected_pos = sentinel_pos + 1
                    if corrected_pos < len(out):
                        raw_extracted = out[corrected_pos:].strip()
                        print(f"[NMT Service] Corrected extraction: '{raw_extracted[:50]}'")
                        sentinel_pos = corrected_pos

    final_output = raw_extracted

    for sep_variant in SEPARATOR_TRANSLATIONS:
        if final_output.startswith(sep_variant):
            final_output = final_output[len(sep_variant):].strip()
            print(f"[NMT Service] Removed sentinel sequence variant '{sep_variant}' from extracted text start")
        if sep_variant in final_output:
            final_output = final_output.replace(sep_variant, " ").strip()
            print(f"[NMT Service] Removed sentinel sequence variant '{sep_variant}' from extracted text middle")

    for marker_variant in SEP_MARKER_VARIANTS:
        if final_output.startswith(marker_variant):
            final_output = final_output[len(marker_variant):].strip()
            print(f"[NMT Service] Removed plain text SEP_MARKER '{marker_variant}' from extracted text start")
        if marker_variant in final_output:
            final_output = final_output.replace(marker_variant, " ").strip()
            print(f"[NMT Service] Removed plain text SEP_MARKER '{marker_variant}' from extracted text middle")

    return final_output


def cleanup_sentinel_sequences(text: str) -> str:
    """清理文本中残留的哨兵序列"""
    final_output = text

    for sep_variant in SEPARATOR_TRANSLATIONS:
        if sep_variant in final_output:
            final_output = final_output.replace(sep_variant, " ").strip()
            print(f"[NMT Service] Removed sentinel sequence '{sep_variant}' from final output (fallback cleanup)")

    for marker_variant in SEP_MARKER_VARIANTS:
        if marker_variant in final_output:
            final_output = final_output.replace(marker_variant, " ").strip()
            print(f"[NMT Service] Removed plain text SEP_MARKER '{marker_variant}' from final output (fallback cleanup)")

    return final_output
