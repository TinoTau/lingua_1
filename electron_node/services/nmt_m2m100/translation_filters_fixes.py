# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 翻译结果过滤与修复
标点过滤、引号噪音过滤、小写/分隔符/逗号开头修复。
"""
import re
from typing import List

from config import (
    SEPARATOR_TRANSLATIONS,
    SEP_MARKER_VARIANTS,
    PUNCTUATION_FILTER_ENABLED,
    PUNCTUATION_FILTER_PATTERN,
    PUNCTUATION_FILTER_MIN_LENGTH,
)

from translation_sentinel import find_sentinel_position


def fix_lowercase_start(final_output: str, out: str) -> str:
    """修复以小写字母开头的提取结果（可能是截断）"""
    if not final_output or len(final_output) == 0:
        return final_output

    if final_output[0].islower():
        if final_output in out:
            match_pos = out.find(final_output)
            if match_pos > 0:
                for i in range(match_pos - 1, max(0, match_pos - 50), -1):
                    if i > 0 and i < len(out) - 1:
                        context = out[max(0, i-10):min(len(out), i+20)]
                        for sep_variant in SEPARATOR_TRANSLATIONS:
                            if sep_variant in context:
                                sep_start = context.find(sep_variant)
                                sep_end = sep_start + len(sep_variant)
                                if max(0, i-10) + sep_start <= i < max(0, i-10) + sep_end:
                                    continue

                        if out[i].isupper() or out[i].isdigit():
                            if match_pos - i < 30:
                                potential_start = i
                                potential_text = out[potential_start:match_pos + len(final_output)]

                                has_sentinel = False
                                for sep_variant in SEPARATOR_TRANSLATIONS:
                                    if sep_variant in potential_text:
                                        has_sentinel = True
                                        break
                                if not has_sentinel:
                                    for marker_variant in SEP_MARKER_VARIANTS:
                                        if marker_variant in potential_text:
                                            has_sentinel = True
                                            break

                                if not has_sentinel and final_output in potential_text and len(potential_text) <= len(out) * 0.8:
                                    print(f"[NMT Service] Found better extraction point (starts with uppercase): '{potential_text[:100]}{'...' if len(potential_text) > 100 else ''}'")
                                    fixed_output = potential_text.strip()
                                    for sep_variant in SEPARATOR_TRANSLATIONS:
                                        fixed_output = fixed_output.replace(sep_variant, " ").strip()
                                    for marker_variant in SEP_MARKER_VARIANTS:
                                        fixed_output = fixed_output.replace(marker_variant, " ").strip()
                                    return fixed_output
    return final_output


def filter_punctuation_only(text: str) -> str:
    """过滤只包含标点符号的翻译结果"""
    if not text or not PUNCTUATION_FILTER_ENABLED:
        return text

    try:
        text_without_punctuation = re.sub(PUNCTUATION_FILTER_PATTERN, '', text)
        if not text_without_punctuation or len(text_without_punctuation.strip()) < PUNCTUATION_FILTER_MIN_LENGTH:
            print(f"[NMT Service] WARNING: Translation contains only punctuation marks, filtering to avoid invalid output. "
                  f"original_text='{text}', pattern='{PUNCTUATION_FILTER_PATTERN}', min_length={PUNCTUATION_FILTER_MIN_LENGTH}")
            return ""
    except Exception as e:
        print(f"[NMT Service] ERROR: Failed to filter punctuation-only text: {e}")

    return text


def filter_quotes_noise(text: str) -> str:
    """过滤包含引号的短句翻译（正常说话不可能出现引号，这是模型噪音）"""
    if not text or len(text) >= 50:
        return text

    has_quotes = "'" in text or '"' in text
    if has_quotes:
        text_without_quotes = text.replace("'", "").replace('"', '').strip()
        if len(text_without_quotes) < len(text) * 0.5 or len(text_without_quotes) < 3:
            print(f"[NMT Service] WARNING: Translation contains quotes and is likely noise, filtering. "
                  f"original_text='{text}', text_without_quotes='{text_without_quotes}', length={len(text)}")
            return ""

    return text


def fix_separator_char_start(final_output: str, out: str) -> str:
    """修复以分隔符字符开头的提取结果"""
    if not final_output or len(final_output) <= 1:
        return final_output

    first_char = final_output[0]
    next_char = final_output[1:2] if len(final_output) > 1 else ""

    if len(first_char) == 1 and next_char == ' ':
        is_separator_char = False
        for sep_variant in SEPARATOR_TRANSLATIONS:
            if first_char in sep_variant:
                is_separator_char = True
                print(f"[NMT Service] WARNING: Extracted text starts with separator character '{first_char}' (part of '{sep_variant}') followed by space, "
                      f"this indicates an index calculation error. Auto-correcting by skipping this character.")
                print(f"[NMT Service] Full output: '{out[:200]}{'...' if len(out) > 200 else ''}', ")
                print(f"[NMT Service] Original extracted: '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
                break

        if is_separator_char:
            corrected_output = final_output[2:].strip()
            if corrected_output:
                print(f"[NMT Service] Corrected extraction: '{corrected_output[:100]}{'...' if len(corrected_output) > 100 else ''}'")
                return corrected_output
            else:
                print(f"[NMT Service] WARNING: After correction, extracted text is empty, keeping original")
        else:
            print(f"[NMT Service] WARNING: Extracted text starts with single character '{first_char}' followed by space, "
                  f"but it's not part of any known separator. This may indicate an index calculation error. "
                  f"Full output: '{out[:200]}{'...' if len(out) > 200 else ''}', "
                  f"Extracted: '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")

    return final_output


def fix_comma_start_extraction(final_output: str, out: str, truncated_patterns: List[str]) -> str:
    """
    若提取结果以逗号开头（如 ", the system would not..."），说明当前句前半可能被合并到 context 译文里。
    在完整译文 out 中找第一个哨兵前的片段，若存在以逗号结尾的短句（如 "After 10 seconds,"），则拼到提取结果前。
    """
    if not final_output or len(final_output) < 2:
        return final_output
    s = final_output.strip()
    if not s.startswith(",") and not (s.startswith(" ") and s.lstrip().startswith(",")):
        return final_output
    first_pos, _ = find_sentinel_position(out, truncated_patterns, use_last_sentinel=False)
    if first_pos <= 0:
        return final_output
    before_sentinel = out[:first_pos].strip()
    if not before_sentinel:
        return final_output
    max_prefix = 80
    for n in range(min(max_prefix, len(before_sentinel)), 7, -1):
        suffix = before_sentinel[-n:].strip()
        if suffix.endswith(",") and len(suffix) >= 8:
            rest = s.lstrip().lstrip(",").strip()
            if rest:
                repaired = suffix + " " + rest
                print(f"[NMT Service] fix_comma_start: prepended prefix '{suffix[:50]}...' -> '{repaired[:80]}...'")
                return repaired
            break
    return final_output
