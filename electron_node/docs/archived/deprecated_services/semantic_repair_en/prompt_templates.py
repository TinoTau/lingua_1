# -*- coding: utf-8 -*-
"""
Semantic Repair Service - English - Prompt Templates
英文语义修复服务 - Prompt模板
P1-2: 增强的Prompt模板，防止误修复
"""

from typing import Optional


class PromptTemplate:
    """Prompt模板管理器"""
    
    @staticmethod
    def build_repair_prompt(
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None
    ) -> str:
        """
        构建修复Prompt（英文Minimal Edit）
        
        Args:
            text_in: 输入文本
            micro_context: 微上下文（上一句尾部，可选）
            quality_score: 质量分数（可选）
        
        Returns:
            Prompt字符串
        """
        # 基础Prompt（严格Minimal Edit）
        prompt = """You are a post-processor for ASR output. The input may contain misrecognized words, wrong abbreviations, or wrong numbers.

Rules:
1) Make minimal edits only to fix obvious errors.
2) Do not expand the sentence. Do not add new information.
3) Preserve acronyms (API, HTTP, GPU...), URLs, emails, and file paths.
4) If the input is already fine, output it unchanged.
5) Output ONLY the corrected text, no explanations.

Input: {text_in}"""
        
        # 添加微上下文（如果提供）
        if micro_context:
            prompt += f"\nPrevious snippet: {micro_context}"
        
        # 添加质量分数提示（如果提供且较低）
        if quality_score is not None and quality_score < 0.7:
            prompt += f"\nNote: This text has a low quality score ({quality_score:.2f}), it may contain recognition errors."
        
        prompt = prompt.format(text_in=text_in)
        
        return prompt
    
    @staticmethod
    def build_system_message() -> str:
        """构建系统消息"""
        return """You are a professional post-processor for ASR (Automatic Speech Recognition) output, specializing in fixing misrecognized words, wrong abbreviations, and number errors in English text.

Your task is to:
- Identify and fix obvious misrecognized words (e.g., "api" → "API", "url" → "URL")
- Fix spelling errors and wrong abbreviations
- Preserve the original meaning and tone
- Do not add new information, do not expand, do not change the original intent

Always follow the "minimal edit" principle: only fix obvious errors, keep everything else unchanged."""
