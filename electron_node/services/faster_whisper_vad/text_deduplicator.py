"""
文本去重模块
用于移除ASR识别结果中的重复文本片段
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def deduplicate_text(text: str, trace_id: Optional[str] = None) -> str:
    """
    移除文本中的重复片段
    
    处理多种重复模式：
    1. 完全重复：例如 "这边能不能用这边能不能用" -> "这边能不能用"
    2. 部分重复：例如 "这个地方我觉得还行这个地方我觉得还行" -> "这个地方我觉得还行"
    3. 多重重复：例如 "测试测试测试" -> "测试"
    4. 带空格的重复：例如 "这边能不能用 这边能不能用" -> "这边能不能用"
    
    Args:
        text: 需要去重的文本
        trace_id: 追踪ID（用于日志）
    
    Returns:
        去重后的文本
    """
    if not text:
        return text
    
    original_text = text.strip()
    if not original_text:
        return original_text
    
    text_trimmed = original_text
    text_len = len(text_trimmed)
    
    # 至少2个字符才可能有重复
    if text_len < 2:
        return text_trimmed
    
    # 方法1：检测完全重复的短语（例如："这边能不能用这边能不能用"）
    # 从中间位置开始检查，看前半部分是否在后半部分重复
    # 支持多重重复（例如："测试测试测试"）
    max_repeats = text_len // 2  # 最多可能的重复次数
    for repeat_count in range(2, max_repeats + 1):
        # 检查是否是完全重复 repeat_count 次
        segment_len = text_len // repeat_count
        if segment_len * repeat_count != text_len:
            continue  # 不能整除，跳过
        
        # 检查所有段是否相同
        first_segment = text_trimmed[:segment_len]
        is_complete_duplication = True
        for i in range(1, repeat_count):
            segment_start = i * segment_len
            segment = text_trimmed[segment_start:segment_start + segment_len]
            if segment != first_segment:
                is_complete_duplication = False
                break
        
        if is_complete_duplication:
            text_trimmed = first_segment
            if trace_id:
                logger.warning(
                    f"[{trace_id}] Detected complete text duplication ({repeat_count}x), "
                    f"original=\"{original_text}\", deduplicated=\"{text_trimmed}\""
                )
            # 递归处理，因为去重后可能还有嵌套重复（例如："测试测试测试测试" -> "测试测试" -> "测试"）
            return deduplicate_text(text_trimmed, trace_id)
    
    # 方法2：检测部分重复（例如："这个地方我觉得还行这个地方我觉得还行"）
    # 尝试找到重复的短语（长度>=2）
    # 从长到短检查，优先处理较长的重复短语
    max_phrase_len = min(20, text_len // 2)
    for phrase_len in range(max_phrase_len, 1, -1):  # 从长到短检查，最小长度为2
        for start in range(text_len - phrase_len * 2 + 1):
            phrase = text_trimmed[start:start + phrase_len]
            # 跳过只包含空格的短语
            if phrase.strip() == "":
                continue
            
            # 检查这个短语是否在后面重复出现（允许中间有空格）
            next_start = start + phrase_len
            # 跳过空格
            while next_start < text_len and text_trimmed[next_start].isspace():
                next_start += 1
            
            if next_start + phrase_len <= text_len:
                next_phrase = text_trimmed[next_start:next_start + phrase_len]
                if phrase == next_phrase:
                    # 找到重复，移除第二个重复的短语（包括前面的空格）
                    # 找到重复短语的结束位置
                    phrase_end = next_start + phrase_len
                    # 移除从 next_start 到 phrase_end 的内容
                    text_trimmed = (
                        text_trimmed[:start + phrase_len].rstrip() + 
                        text_trimmed[phrase_end:]
                    )
                    if trace_id:
                        logger.warning(
                            f"[{trace_id}] Detected phrase duplication, "
                            f"phrase=\"{phrase}\", original=\"{original_text}\", "
                            f"deduplicated=\"{text_trimmed}\""
                        )
                    # 递归处理，因为移除后可能还有重复
                    return deduplicate_text(text_trimmed, trace_id)
    
    # 方法3：检测开头和结尾的重复（例如："导致没有办法播 那些问题 导致没有办法播"）
    # 检查文本开头和结尾是否有相同的短语（允许中间有其他文本）
    # 从长到短检查，优先处理较长的重复短语
    for phrase_len in range(min(15, text_len // 2), 2, -1):  # 最小长度为2，最大长度为15
        # 检查开头和结尾（去除首尾空格后比较）
        start_phrase = text_trimmed[:phrase_len].strip()
        end_phrase = text_trimmed[-phrase_len:].strip()
        
        # 如果开头和结尾的短语相同（去除空格后），且不是完全重复（已经由方法1处理）
        if start_phrase and end_phrase and start_phrase == end_phrase:
            # 检查是否真的是重复（而不是巧合）
            # 确保开头短语后面有内容，结尾短语前面也有内容
            if text_len > phrase_len * 2:
                # 找到结尾重复短语的实际位置（考虑空格）
                # 从结尾向前查找，找到与开头短语匹配的位置
                end_phrase_with_space = text_trimmed[-phrase_len:]
                # 如果结尾短语前面有空格，也要移除空格
                end_start_pos = text_len - phrase_len
                # 向前跳过空格
                while end_start_pos > 0 and text_trimmed[end_start_pos - 1].isspace():
                    end_start_pos -= 1
                
                # 移除结尾的重复短语（包括前面的空格）
                text_trimmed = text_trimmed[:end_start_pos].rstrip()
                if trace_id:
                    logger.warning(
                        f"[{trace_id}] Detected start-end phrase duplication, "
                        f"phrase=\"{start_phrase}\", original=\"{original_text}\", "
                        f"deduplicated=\"{text_trimmed}\""
                    )
                # 递归处理，因为移除后可能还有重复
                return deduplicate_text(text_trimmed, trace_id)
    
    # 没有发现重复
    return text_trimmed

