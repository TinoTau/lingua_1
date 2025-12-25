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
    
    return False

