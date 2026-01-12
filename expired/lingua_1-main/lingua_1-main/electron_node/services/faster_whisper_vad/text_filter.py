"""
Faster Whisper + Silero VAD Service - Text Filter
文本过滤功能（严格按照 Rust 实现）
"""
import logging

logger = logging.getLogger(__name__)

def is_meaningless_transcript(text: str) -> bool:
    """
    检查文本是否为无意义的识别结果
    严格按照 Rust 实现（electron_node/services/node-inference/src/text_filter.rs）
    """
    text_trimmed = text.strip()
    
    # 1. 检查空文本
    if not text_trimmed:
        return True
    
    # 2. 检查单个字的无意义语气词
    single_char_fillers = ["嗯", "啊", "呃", "哦", "额", "嗯", "um", "uh", "ah", "er"]
    if text_trimmed in single_char_fillers:
        return True
    
    # 3. 检查标点符号（放宽规则：只过滤特殊标点，保留常见标点）
    # 注意：ASR 模型（Faster Whisper）可能会在识别结果中包含标点符号，这是正常的
    # 只过滤明显无意义的标点符号（如括号、特殊符号），保留常见的标点（逗号、句号、问号等）
    special_punctuation = [
        # 括号类（通常表示注释、字幕等无意义内容）
        '（', '）', '【', '】', '《', '》',  # 中文括号
        '(', ')', '[', ']', '{', '}',  # 英文括号
        # 引号类（可能表示引用或特殊标记）
        '"', '"', '\u2018', '\u2019',  # 引号
        # 特殊符号（通常不会出现在正常语音识别中）
        '@', '#', '$', '%', '^', '&', '*', '+', '=', '<', '>', '~', '`',
        # 其他特殊符号
        '…', '—', '·', '/', '\\', '|', '_',
    ]
    if any(c in text_trimmed for c in special_punctuation):
        logger.warning(f"[Text Filter] Filtering text with special punctuation: \"{text_trimmed}\"")
        return True
    
    # 允许常见的标点符号（逗号、句号、问号、感叹号等）
    # 这些是 ASR 模型正常输出的标点符号，不应该被过滤
    
    # 4. 检查包含括号的文本（如 "(笑)"、"(字幕:J Chong)" 等）
    if '(' in text_trimmed or '（' in text_trimmed or '[' in text_trimmed or '【' in text_trimmed:
        logger.warning(f"[Text Filter] Filtering text with brackets: \"{text_trimmed}\"")
        return True
    
    # 5. 检查精确匹配的无意义文本
    exact_matches = [
        "谢谢大家", "谢谢大家收看", "感谢观看", "感谢收看", 
        "The", "the", "A", "a", "An", "an",
        "谢谢", "感谢", "拜拜", "再见",
    ]
    if text_trimmed in exact_matches:
        logger.warning(f"[Text Filter] Filtering exact match: \"{text_trimmed}\"")
        return True
    
    # 6. 检查叠词（重复字符或重复词）
    # 除了"谢谢"外，其他叠词都应该被过滤（如"射射"、"证证"等）
    # 这些通常是ASR模型在音频质量差时的噪音输出
    if len(text_trimmed) >= 2:
        # 检查是否全部是重复的单个字符（如"射射"、"证证"）
        if len(set(text_trimmed)) == 1:
            # 单个字符重复，但"谢谢"是例外
            if text_trimmed != "谢谢":
                logger.warning(f"[Text Filter] Filtering repetitive single character: \"{text_trimmed}\"")
                return True
        
        # 检查是否全部是重复的两个字符（如"射射射"、"证证证"）
        if len(text_trimmed) >= 4 and len(text_trimmed) % 2 == 0:
            # 尝试将文本分成两个字符的片段
            chunks = [text_trimmed[i:i+2] for i in range(0, len(text_trimmed), 2)]
            if len(set(chunks)) == 1:
                # 两个字符重复，但"谢谢"是例外
                if chunks[0] != "谢谢":
                    logger.warning(f"[Text Filter] Filtering repetitive two-character pattern: \"{text_trimmed}\"")
                    return True
        
        # 7. 检查短句中的叠词模式（ABAB、ABB、BB等），这些通常是NMT模型产生的噪音
        # 只对独立的短句进行检查，如果跟在长句后面就不过滤
        # 通过检测句子边界（标点符号、空格等）来判断是否是独立短句
        if _is_standalone_short_sentence(text_trimmed):
            if _has_repetitive_pattern(text_trimmed):
                logger.warning(f"[Text Filter] Filtering standalone short sentence with repetitive pattern: \"{text_trimmed}\"")
                return True
    
    return False


def _is_standalone_short_sentence(text: str) -> bool:
    """
    检查文本是否是独立的短句（不是跟在长句后面的短句）
    
    判断标准：
    1. 文本长度在2-8个字符之间（短句）
    2. 文本长度 <= 8个字符，说明是独立短句
    3. 文本长度 > 8个字符，说明是长句，短句跟在后面就不应该被过滤
    
    注意：NMT生成的文本不应该带标点符号，所以不能通过标点符号来判断
    
    Args:
        text: 要检查的文本
    
    Returns:
        如果是独立的短句返回True，否则返回False
    """
    if not text or len(text) < 2:
        return False
    
    # 只检查短句（2-8个字符）
    # 如果文本长度 > 8个字符，说明是长句，短句跟在后面就不应该被过滤
    if len(text) > 8:
        return False
    
    # 文本长度在2-8个字符之间，认为是独立短句
    return True


def _has_repetitive_pattern(text: str) -> bool:
    """
    检查文本是否符合叠词模式（ABAB、ABB、BB等）
    
    支持的模式：
    - BB: 两个相同字符（如"判判"）
    - ABB: 一个字符后跟两个相同字符（如"证判判"）
    - ABAB: 两个字符交替重复（如"证判证判"）
    - AABB: 两个字符各重复两次（如"证证判判"）
    
    Args:
        text: 要检查的文本（去除标点符号后）
    
    Returns:
        如果符合叠词模式返回True，否则返回False
    """
    # 去除标点符号，只检查字符
    text_clean = ''.join(c for c in text if c.isalnum() or '\u4e00' <= c <= '\u9fff')
    
    if not text_clean or len(text_clean) < 2:
        return False
    
    # "谢谢"是例外，不应该被过滤
    if text_clean == "谢谢" or text_clean.startswith("谢谢"):
        return False
    
    text_len = len(text_clean)
    
    # 模式1: BB - 两个相同字符（如"判判"）
    if text_len == 2 and text_clean[0] == text_clean[1]:
        return True
    
    # 模式2: ABB - 一个字符后跟两个相同字符（如"证判判"）
    if text_len == 3 and text_clean[1] == text_clean[2] and text_clean[0] != text_clean[1]:
        return True
    
    # 模式3: ABAB - 两个字符交替重复（如"证判证判"）
    if text_len == 4:
        if text_clean[0] == text_clean[2] and text_clean[1] == text_clean[3] and text_clean[0] != text_clean[1]:
            return True
    
    # 模式4: AABB - 两个字符各重复两次（如"证证判判"）
    if text_len == 4:
        if text_clean[0] == text_clean[1] and text_clean[2] == text_clean[3] and text_clean[0] != text_clean[2]:
            return True
    
    # 模式5: ABBB - 一个字符后跟三个相同字符（如"证判判判"）
    if text_len == 4 and text_clean[1] == text_clean[2] and text_clean[2] == text_clean[3] and text_clean[0] != text_clean[1]:
        return True
    
    # 模式6: 更长的重复模式（如"证判证判证判"）
    if text_len >= 4:
        # 检查是否是ABAB的重复（如"证判证判"）
        if text_len % 2 == 0:
            chunk_len = 2
            chunks = [text_clean[i:i+chunk_len] for i in range(0, text_len, chunk_len)]
            if len(chunks) >= 2 and len(set(chunks)) == 1:
                return True
        
        # 检查是否有连续重复的字符（如"证判判判"）
        for i in range(text_len - 2):
            if text_clean[i+1] == text_clean[i+2]:
                # 检查是否至少有2个连续重复字符
                repeat_count = 1
                for j in range(i+2, text_len):
                    if text_clean[j] == text_clean[i+1]:
                        repeat_count += 1
                    else:
                        break
                if repeat_count >= 2:
                    return True
    
    return False

