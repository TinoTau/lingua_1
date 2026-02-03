# -*- coding: utf-8 -*-
"""
语义修复 Prompt 模板（中/英）
与 semantic_repair_zh 保守策略一致：最小改动、避免误改（如「余英」→「英文」）
"""

from typing import Optional


class PromptTemplate:
    """中英文语义修复 Prompt 管理器"""

    @staticmethod
    def build_repair_prompt(
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None,
        lang: str = "zh",
    ) -> str:
        if lang == "en":
            return PromptTemplate._build_repair_prompt_en(
                text_in, micro_context, quality_score
            )
        return PromptTemplate._build_repair_prompt_zh(
            text_in, micro_context, quality_score
        )

    @staticmethod
    def _build_repair_prompt_zh(
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None,
    ) -> str:
        """中文：保守修复，仅在有把握时改"""
        prompt = """你是语音识别后处理器。输入是一句ASR文本，可能有同音字、近音词、错别字。

核心任务：通过语义分析识别并修复同音字错误。

修复原则：
1) 最小改动优先：仅在确信为同音字/错别字且能确定正确用词时才修改；不确定时一律保留原文，避免误改（例如不要把「余英」改成「英文」等改变原意的替换）。
2) 语义合理才改：只有词语在上下文中明显语义不通、不符合逻辑或常见表达时，才视为待修复；若存在合理解释则不要改。
3) 保持原意：不扩写、不添加新信息、不改变语气与原意；禁止新增原文未出现的实体、数字、专有名词。
4) 繁体转简体：若输入为繁体，输出请统一为简体；除此以外尽量少改。

输出要求：
- 输出只包含修正后的文本，不要解释，不要添加任何其他内容
- 输出请使用简体中文
- 仅对有把握的同音字/错别字进行修复；若原文可接受或不确定，则原样输出（仍用简体）

原文：{text_in}"""
        if micro_context:
            prompt += f"\n\n上下文信息（上一句片段）：{micro_context}\n请结合上下文理解当前句子的语义，上下文可以帮助你更准确地识别同音字错误。如果当前句子中的词语与上下文语义不连贯，很可能是同音字错误。"
        if quality_score is not None and quality_score < 0.85:
            prompt += f"\n⚠️ 注意：此文本质量分数较低（{quality_score:.2f}），很可能存在识别错误，请仔细检查并修复同音字错误。"
        return prompt.format(text_in=text_in)

    @staticmethod
    def _build_repair_prompt_en(
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None,
    ) -> str:
        """英文：最小改动，仅修正明显 ASR 错误"""
        prompt = """You are an ASR post-processor. Input is one sentence of ASR output, possibly with homophone or recognition errors.

Task: Fix clear ASR errors (homophones, typos) while preserving meaning.

Rules:
1) Minimal edits: Only change when you are confident it is an ASR error; when in doubt, keep the original.
2) Preserve meaning: Do not paraphrase, add information, or change tone.
3) Output only the corrected text, no explanation.

Original: {text_in}"""
        if micro_context:
            prompt += f"\n\nContext (previous sentence): {micro_context}"
        if quality_score is not None and quality_score < 0.85:
            prompt += f"\nNote: Low quality score ({quality_score:.2f}), likely recognition errors."
        return prompt.format(text_in=text_in)

    @staticmethod
    def build_system_message(lang: str = "zh") -> str:
        if lang == "en":
            return """You are an ASR post-processor for English. Fix only clear homophone/typo errors. Preserve meaning. Output only the corrected sentence."""
        return """你是一个专业的语音识别后处理器，专门修复ASR输出的中文文本中的同音字错误、错别字等。

核心原则：
- 最小改动：仅在确信为同音字/错别字且能确定正确用词时才修改；不确定则保留原文，避免误改或改变原意。
- 语义判断：只有词语在上下文中明显语义不通、不符合逻辑或常见表达时，才视为需要修复。
- 保持原意：不扩写、不添加新信息、不改变原意；输出统一使用简体中文（若输入为繁体则转简体）。

重要：宁可少改、不可误改。错误修改（例如把正确的「余英」改成「英文」）比漏改更严重。"""
