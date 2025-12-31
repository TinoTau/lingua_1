# -*- coding: utf-8 -*-
"""
M2M100 NMT 服务 - API 数据模型
"""
from pydantic import BaseModel
from typing import Optional, Dict, Any


class TranslateRequest(BaseModel):
    src_lang: str
    tgt_lang: str
    text: str
    context_text: Optional[str] = None  # 上下文文本（可选，用于提升翻译质量）
    num_candidates: Optional[int] = None  # 生成候选数量（可选，用于 NMT Repair）


class TranslateResponse(BaseModel):
    ok: bool
    text: Optional[str] = None
    model: Optional[str] = None
    provider: str = "local-m2m100"
    extraction_mode: Optional[str] = None  # 提取模式：SENTINEL, ALIGN_FALLBACK, SINGLE_ONLY, FULL_ONLY
    extraction_confidence: Optional[str] = None  # 提取置信度：HIGH, MEDIUM, LOW
    extra: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    candidates: Optional[list[str]] = None  # 候选翻译列表（可选，用于 NMT Repair）
