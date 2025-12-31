# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 翻译提取器
从完整翻译中提取当前句的翻译部分
"""
import re
import torch
from typing import Optional, Tuple
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer

from align_fallback import extract_with_align_fallback

from config import (
    SEPARATOR,
    SEPARATOR_TRANSLATIONS,
    PUNCTUATION_FILTER_ENABLED,
    PUNCTUATION_FILTER_PATTERN,
    PUNCTUATION_FILTER_MIN_LENGTH,
    SEP_MARKER_VARIANTS,
)
from pattern_generator import generate_truncated_patterns

# 预生成截断模式（在服务启动时生成一次，避免每次请求都重新生成）
TRUNCATED_PATTERNS = generate_truncated_patterns(SEPARATOR_TRANSLATIONS)


def find_sentinel_position(out: str, truncated_patterns: list) -> Tuple[int, Optional[str]]:
    """查找哨兵序列在完整翻译中的位置"""
    sentinel_pos = -1
    found_sentinel = None
    
    # 第一步：查找完整的哨兵序列（带Unicode括号）
    for sep_variant in SEPARATOR_TRANSLATIONS:
        pos = out.find(sep_variant)
        if pos != -1:
            sentinel_pos = pos + len(sep_variant)
            found_sentinel = sep_variant
            print(f"[NMT Service] Found sentinel sequence '{sep_variant}' at position {pos}, extracted text will start at position {sentinel_pos}")
            print(f"[NMT Service] Text before sentinel: '{out[:pos][-50:]}'")
            print(f"[NMT Service] Text after sentinel (first 100 chars): '{out[sentinel_pos:sentinel_pos+100]}'")
            return sentinel_pos, found_sentinel
    
    # 第二步：如果完整哨兵序列未找到，查找纯文本SEP_MARKER（NMT可能将Unicode括号翻译掉了）
    for marker_variant in SEP_MARKER_VARIANTS:
        pos = out.find(marker_variant)
        if pos != -1:
            sentinel_pos = pos + len(marker_variant)
            found_sentinel = marker_variant
            print(f"[NMT Service] Found plain text SEP_MARKER '{marker_variant}' at position {pos} (Unicode brackets were translated away), extracted text will start at position {sentinel_pos}")
            print(f"[NMT Service] Text before SEP_MARKER: '{out[:pos][-50:]}'")
            print(f"[NMT Service] Text after SEP_MARKER (first 100 chars): '{out[sentinel_pos:sentinel_pos+100]}'")
            return sentinel_pos, found_sentinel
    
    # 第三步：如果仍然未找到，检查是否SEP_MARKER被截断了
    for pattern in truncated_patterns:
        pos = out.find(pattern)
        if pos != -1:
            sentinel_pos = pos + len(pattern)
            found_sentinel = pattern
            print(f"[NMT Service] WARNING: Found truncated SEP_MARKER pattern '{pattern}' at position {pos}, extracted text will start at position {sentinel_pos}")
            print(f"[NMT Service] Text before truncated pattern: '{out[:pos][-50:]}'")
            print(f"[NMT Service] Text after truncated pattern (first 100 chars): '{out[sentinel_pos:sentinel_pos+100]}'")
            
            # 验证提取位置是否正确：检查提取的文本是否合理
            extracted_preview = out[sentinel_pos:sentinel_pos+20].strip()
            if len(extracted_preview) > 0:
                print(f"[NMT Service] Extracted text preview: '{extracted_preview}'")
            
            # 如果模式很短（如单个字符），需要额外验证
            if len(pattern) <= 2:
                # 检查提取的文本是否以空格开头，且后面跟着合理的文本
                if sentinel_pos < len(out) and out[sentinel_pos:sentinel_pos+1] == ' ':
                    # 跳过空格，检查后面的文本是否合理
                    next_text_start = sentinel_pos + 1
                    if next_text_start < len(out):
                        next_text = out[next_text_start:next_text_start+10].strip()
                        if len(next_text) > 0:
                            # 如果后面有合理的文本，使用跳过空格后的位置
                            sentinel_pos = next_text_start
                            print(f"[NMT Service] Adjusted sentinel_pos to skip space after short pattern, new pos={sentinel_pos}")
            return sentinel_pos, found_sentinel
    
    return -1, None


def extract_with_sentinel(out: str, sentinel_pos: int) -> str:
    """使用哨兵序列位置提取文本"""
    # 验证 sentinel_pos 是否在有效范围内
    if sentinel_pos < 0 or sentinel_pos >= len(out):
        print(f"[NMT Service] ERROR: Invalid sentinel_pos={sentinel_pos}, output length={len(out)}, using fallback")
        return None
    
    raw_extracted = out[sentinel_pos:].strip()
    
    # 验证提取的文本是否合理：不应该以分隔符的字符开头
    if raw_extracted:
        first_char = raw_extracted[0]
        # 检查第一个字符是否是分隔符的一部分（可能是index计算错误）
        for sep_variant in SEPARATOR_TRANSLATIONS:
            if first_char in sep_variant and len(raw_extracted) > 1:
                # 如果第一个字符是分隔符的一部分，且后面是空格，可能是index计算错误
                if raw_extracted[1:2] == ' ':
                    print(f"[NMT Service] WARNING: Extracted text starts with separator character '{first_char}', "
                          f"this may indicate index calculation error. sentinel_pos={sentinel_pos}, "
                          f"separator='{sep_variant}', extracted='{raw_extracted[:50]}'")
                    # 尝试修正：跳过这个字符
                    corrected_pos = sentinel_pos + 1
                    if corrected_pos < len(out):
                        raw_extracted = out[corrected_pos:].strip()
                        print(f"[NMT Service] Corrected extraction: '{raw_extracted[:50]}'")
                        sentinel_pos = corrected_pos
    
    # 清理：移除提取内容中可能残留的哨兵序列
    final_output = raw_extracted
    
    # 清理完整哨兵序列（带Unicode括号）
    for sep_variant in SEPARATOR_TRANSLATIONS:
        if final_output.startswith(sep_variant):
            final_output = final_output[len(sep_variant):].strip()
            print(f"[NMT Service] Removed sentinel sequence variant '{sep_variant}' from extracted text start")
        # 移除中间可能残留的哨兵序列
        if sep_variant in final_output:
            final_output = final_output.replace(sep_variant, " ").strip()
            print(f"[NMT Service] Removed sentinel sequence variant '{sep_variant}' from extracted text middle")
    
    # 清理纯文本SEP_MARKER（NMT可能将Unicode括号翻译掉了）
    for marker_variant in SEP_MARKER_VARIANTS:
        if final_output.startswith(marker_variant):
            final_output = final_output[len(marker_variant):].strip()
            print(f"[NMT Service] Removed plain text SEP_MARKER '{marker_variant}' from extracted text start")
        # 移除中间可能残留的SEP_MARKER
        if marker_variant in final_output:
            final_output = final_output.replace(marker_variant, " ").strip()
            print(f"[NMT Service] Removed plain text SEP_MARKER '{marker_variant}' from extracted text middle")
    
    return final_output


from align_fallback import extract_with_align_fallback


def cleanup_sentinel_sequences(text: str) -> str:
    """清理文本中残留的哨兵序列"""
    final_output = text
    
    # 清理完整哨兵序列（带Unicode括号）
    for sep_variant in SEPARATOR_TRANSLATIONS:
        if sep_variant in final_output:
            final_output = final_output.replace(sep_variant, " ").strip()
            print(f"[NMT Service] Removed sentinel sequence '{sep_variant}' from final output (fallback cleanup)")
    
    # 清理纯文本SEP_MARKER（fallback cleanup）
    for marker_variant in SEP_MARKER_VARIANTS:
        if marker_variant in final_output:
            final_output = final_output.replace(marker_variant, " ").strip()
            print(f"[NMT Service] Removed plain text SEP_MARKER '{marker_variant}' from final output (fallback cleanup)")
    
    return final_output


def extract_single_translation(
    text: str,
    tokenizer: M2M100Tokenizer,
    model: M2M100ForConditionalGeneration,
    tgt_lang: str,
    device: torch.device,
    max_new_tokens: int
) -> str:
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


def fix_lowercase_start(final_output: str, out: str) -> str:
    """修复以小写字母开头的提取结果（可能是截断）"""
    if not final_output or len(final_output) == 0:
        return final_output
    
    if final_output[0].islower():
        # 尝试在完整翻译中查找当前句翻译的起始位置
        if final_output in out:
            # 查找提取结果在完整翻译中的位置
            match_pos = out.find(final_output)
            if match_pos > 0:
                # 检查前面是否有更合理的起始点（以大写字母或数字开头）
                # 向前查找，找到最近的大写字母或数字作为可能的起始点
                # 跳过哨兵序列相关的字符
                for i in range(match_pos - 1, max(0, match_pos - 50), -1):
                    # 检查是否是哨兵序列的一部分
                    if i > 0 and i < len(out) - 1:
                        context = out[max(0, i-10):min(len(out), i+20)]
                        # 如果当前位置在哨兵序列范围内，跳过
                        for sep_variant in SEPARATOR_TRANSLATIONS:
                            if sep_variant in context:
                                sep_start = context.find(sep_variant)
                                sep_end = sep_start + len(sep_variant)
                                if max(0, i-10) + sep_start <= i < max(0, i-10) + sep_end:
                                    continue
                        
                        if out[i].isupper() or out[i].isdigit():
                            # 找到可能的起始点，但需要检查是否合理（不要太远）
                            if match_pos - i < 30:  # 最多向前30个字符
                                potential_start = i
                                # 检查从该位置到提取结果之间的文本是否合理
                                potential_text = out[potential_start:match_pos + len(final_output)]
                                
                                # 检查potential_text是否包含哨兵序列，如果包含则跳过
                                has_sentinel = False
                                for sep_variant in SEPARATOR_TRANSLATIONS:
                                    if sep_variant in potential_text:
                                        has_sentinel = True
                                        break
                                # 也检查纯文本SEP_MARKER
                                if not has_sentinel:
                                    for marker_variant in SEP_MARKER_VARIANTS:
                                        if marker_variant in potential_text:
                                            has_sentinel = True
                                            break
                                
                                if not has_sentinel and final_output in potential_text and len(potential_text) <= len(out) * 0.8:
                                    print(f"[NMT Service] Found better extraction point (starts with uppercase): '{potential_text[:100]}{'...' if len(potential_text) > 100 else ''}'")
                                    fixed_output = potential_text.strip()
                                    # 清理潜在的哨兵序列残留（完整序列）
                                    for sep_variant in SEPARATOR_TRANSLATIONS:
                                        fixed_output = fixed_output.replace(sep_variant, " ").strip()
                                    # 清理纯文本SEP_MARKER
                                    for marker_variant in SEP_MARKER_VARIANTS:
                                        fixed_output = fixed_output.replace(marker_variant, " ").strip()
                                    return fixed_output
    return final_output


def filter_punctuation_only(text: str) -> str:
    """过滤只包含标点符号的翻译结果"""
    if not text or not PUNCTUATION_FILTER_ENABLED:
        return text
    
    try:
        # 使用配置文件中的正则表达式模式移除标点符号
        text_without_punctuation = re.sub(PUNCTUATION_FILTER_PATTERN, '', text)
        # 如果去除标点后的长度小于最小长度，说明文本只包含标点符号
        if not text_without_punctuation or len(text_without_punctuation.strip()) < PUNCTUATION_FILTER_MIN_LENGTH:
            print(f"[NMT Service] WARNING: Translation contains only punctuation marks, filtering to avoid invalid output. "
                  f"original_text='{text}', pattern='{PUNCTUATION_FILTER_PATTERN}', min_length={PUNCTUATION_FILTER_MIN_LENGTH}")
            return ""
    except Exception as e:
        print(f"[NMT Service] ERROR: Failed to filter punctuation-only text: {e}")
    
    return text


def filter_quotes_noise(text: str) -> str:
    """过滤包含引号的短句翻译（正常说话不可能出现引号，这是模型噪音）"""
    if not text or len(text) >= 50:  # 只处理短句（少于50个字符）
        return text
    
    # 检查是否包含引号（单引号或双引号）
    has_quotes = "'" in text or '"' in text
    if has_quotes:
        # 移除引号后检查是否还有有效内容
        text_without_quotes = text.replace("'", "").replace('"', '').strip()
        # 如果移除引号后只剩下很少的内容，或者引号是主要内容，则过滤掉
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
    
    # 如果第一个字符是单个字符，且后面是空格，可能是index计算错误
    if len(first_char) == 1 and next_char == ' ':
        # 检查是否可能是分隔符的一部分
        is_separator_char = False
        for sep_variant in SEPARATOR_TRANSLATIONS:
            if first_char in sep_variant:
                is_separator_char = True
                print(f"[NMT Service] WARNING: Extracted text starts with separator character '{first_char}' (part of '{sep_variant}') followed by space, "
                      f"this indicates an index calculation error. Auto-correcting by skipping this character.")
                print(f"[NMT Service] Full output: '{out[:200]}{'...' if len(out) > 200 else ''}', ")
                print(f"[NMT Service] Original extracted: '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
                break
        
        # 如果确认是分隔符的一部分，自动修正：跳过这个字符和后面的空格
        if is_separator_char:
            corrected_output = final_output[2:].strip()  # 跳过第一个字符和空格
            if corrected_output:  # 确保修正后还有内容
                print(f"[NMT Service] Corrected extraction: '{corrected_output[:100]}{'...' if len(corrected_output) > 100 else ''}'")
                return corrected_output
            else:
                print(f"[NMT Service] WARNING: After correction, extracted text is empty, keeping original")
        else:
            # 如果不是分隔符的一部分，只记录警告
            print(f"[NMT Service] WARNING: Extracted text starts with single character '{first_char}' followed by space, "
                  f"but it's not part of any known separator. This may indicate an index calculation error. "
                  f"Full output: '{out[:200]}{'...' if len(out) > 200 else ''}', "
                  f"Extracted: '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
    
    return final_output


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
    # 如果context_text为空或空字符串，直接使用完整翻译，不需要提取
    if not context_text or not context_text.strip():
        return out, "FULL_ONLY", "HIGH"
    
    print(f"[NMT Service] WARNING: Output contains translation of BOTH context_text and text. Extracting only current sentence translation.")
    
    try:
        # 方法1：使用哨兵序列（Sentinel Sequence）来准确识别和提取当前句翻译
        sentinel_pos, found_sentinel = find_sentinel_position(out, TRUNCATED_PATTERNS)
        
        if sentinel_pos != -1:
            final_output = extract_with_sentinel(out, sentinel_pos)
            if final_output:
                extraction_mode = "SENTINEL"
                extraction_confidence = "HIGH"
                print(f"[NMT Service] Extracted current sentence translation (method: SENTINEL, sentinel pos={sentinel_pos}, cleaned length={len(final_output)}): '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
            else:
                # 如果提取失败，使用fallback
                final_output, extraction_mode, extraction_confidence = extract_with_align_fallback(
                    out, context_text, tokenizer, model, tgt_lang, device, max_new_tokens
                )
                final_output = cleanup_sentinel_sequences(final_output)
        else:
            # 方法2：上下文翻译对齐切割（Fallback）
            final_output, extraction_mode, extraction_confidence = extract_with_align_fallback(
                out, context_text, tokenizer, model, tgt_lang, device, max_new_tokens
            )
            final_output = cleanup_sentinel_sequences(final_output)
        
        # 阶段3：最终不为空兜底
        if not final_output or final_output.strip() == "":
            print(f"[NMT Service] WARNING: Extracted translation is empty after all methods, using fallback strategies")
            
            # 兜底策略1：尝试单独翻译当前文本（不使用context）
            single_translation = extract_single_translation(
                current_text, tokenizer, model, tgt_lang, device, max_new_tokens
            )
            if single_translation:
                final_output = single_translation
                extraction_mode = "SINGLE_ONLY"
                extraction_confidence = "MEDIUM"
                print(f"[NMT Service] Fallback successful: Translated current text without context: '{final_output[:100]}{'...' if len(final_output) > 100 else ''}'")
            else:
                # 兜底策略2：使用完整翻译（虽然包含context，但至少保证有结果）
                print(f"[NMT Service] Fallback: Single translation also empty, using full output as last resort")
                final_output = out
                extraction_mode = "FULL_ONLY"
                extraction_confidence = "LOW"
        
        # 修复：不应该因为提取结果为空或太短就使用完整输出
        if not final_output:
            print(f"[NMT Service] WARNING: Extracted translation is empty, returning empty string (not using full output which contains context translation)")
            final_output = ""
        elif len(final_output) < len(current_text) * 0.5 and len(current_text) > 5:
            print(f"[NMT Service] WARNING: Extracted translation too short (extracted={len(final_output)}, original={len(current_text)}), but original text is long")
            print(f"[NMT Service] Returning extracted translation as-is (even if short), not using full output which contains context translation")
        else:
            print(f"[NMT Service] Extracted translation length is acceptable (extracted={len(final_output)}, original={len(current_text)})")
        
        # 额外检查：如果提取结果以小写字母开头（可能是截断），尝试查找更准确的分割点
        final_output = fix_lowercase_start(final_output, out)
        
        # 后处理：验证提取的文本是否正确
        final_output = fix_separator_char_start(final_output, out)
        
    except Exception as e:
        print(f"[NMT Service] WARNING: Failed to extract current sentence translation: {e}, using full output")
        final_output = out
        extraction_mode = "FULL_ONLY"
        extraction_confidence = "LOW"
    
    # 过滤只包含标点符号的翻译结果
    final_output = filter_punctuation_only(final_output)
    
    # 过滤包含引号的短句翻译
    final_output = filter_quotes_noise(final_output)
    
    return final_output, extraction_mode, extraction_confidence
