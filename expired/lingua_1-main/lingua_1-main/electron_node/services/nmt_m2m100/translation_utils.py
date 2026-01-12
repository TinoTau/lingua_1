# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - 翻译工具函数
"""
from typing import Optional
from transformers import M2M100Tokenizer


def calculate_max_new_tokens(
    input_text: str,
    tokenizer: Optional[M2M100Tokenizer],
    context_text: Optional[str] = None,
    min_tokens: int = 64,
    max_tokens: int = 512,
    safety_margin: float = 1.5
) -> int:
    """
    根据输入文本长度动态计算 max_new_tokens，并动态调整 max_tokens 上限
    
    Args:
        input_text: 当前要翻译的文本
        tokenizer: Tokenizer 实例（可选）
        context_text: 上下文文本（可选）
        min_tokens: 最小 token 数（默认 64）
        max_tokens: 最大 token 数上限（默认 512，会根据输入长度动态调整）
        safety_margin: 安全缓冲系数（默认 1.5，即 +50%）
    
    Returns:
        合理的 max_new_tokens 值
    """
    # 使用 tokenizer 精确计算（如果可用）
    if tokenizer:
        input_tokens = len(tokenizer.encode(input_text))
        if context_text:
            context_tokens = len(tokenizer.encode(context_text))
            total_input_tokens = input_tokens + context_tokens
        else:
            total_input_tokens = input_tokens
        
        # 中英文 token 比例（保守估计）
        # 中文更紧凑，1 个中文 token 通常对应 1.5-2.5 个英文 token
        ratio = 2.5
        estimated_output_tokens = int(total_input_tokens * ratio)
        
        # 根据输入 token 数动态调整 max_tokens 上限
        # 修复：增加上限以支持长文本翻译，避免截断
        if total_input_tokens < 20:
            dynamic_max_tokens = 256  # 短文本：256 足够
        elif total_input_tokens < 50:
            dynamic_max_tokens = 512  # 中等文本：512（从384增加到512）
        elif total_input_tokens < 100:
            dynamic_max_tokens = 768  # 长文本：768（新增）
        else:
            dynamic_max_tokens = 1024  # 超长文本：1024（从512增加到1024）
    else:
        # 粗略估算：使用字符数
        input_length = len(input_text)
        if context_text:
            total_input_length = len(context_text) + len(input_text)
        else:
            total_input_length = input_length
        
        # 根据输入长度调整比例
        # 修复：增加上限以支持长文本翻译，避免截断
        if total_input_length < 20:
            ratio = 2.0  # 短句：1:2
            dynamic_max_tokens = 256  # 短文本：256 足够
        elif total_input_length < 50:
            ratio = 2.5  # 中等句子：1:2.5
            dynamic_max_tokens = 512  # 中等文本：512（从384增加到512）
        elif total_input_length < 100:
            ratio = 3.0  # 长句：1:3
            dynamic_max_tokens = 768  # 长文本：768（新增）
        else:
            ratio = 3.0  # 长句：1:3
            dynamic_max_tokens = 1024  # 超长文本：1024（从512增加到1024）
        
        estimated_output_tokens = int(total_input_length * ratio)
    
    # 添加安全缓冲
    estimated_output_tokens = int(estimated_output_tokens * safety_margin)
    
    # 限制在合理范围内（使用动态调整后的 max_tokens）
    max_new_tokens = max(min_tokens, min(estimated_output_tokens, dynamic_max_tokens))
    
    return max_new_tokens


def is_translation_complete(text: str) -> bool:
    """检查翻译结果是否完整（简单启发式方法）"""
    text = text.strip()
    if not text:
        return False
    
    # 检查是否以标点符号结尾
    ending_punctuation = ['.', '!', '?', '。', '！', '？', ',', '，', ';', '；']
    if text[-1] in ending_punctuation:
        return True
    
    # 检查最后几个词是否完整（简单检查）
    last_words = text.split()[-3:]  # 最后 3 个词
    for word in last_words:
        if len(word) < 2:  # 单字符词可能是截断
            return False
    
    return True
