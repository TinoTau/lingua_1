# -*- coding: utf-8 -*-
"""
中文语义修复处理器：繁→简（若有 opencc）+ LLM 语义修复。
同音纠错已拆至独立服务 phonetic_correction_zh，本服务不再调用。
仅确有改善时标 REPAIR。
"""

import os
import gc
import logging
from typing import Optional

from processors.base_processor import BaseProcessor
from base.models import ProcessorResult, HealthResponse
from engines.llamacpp_engine import LlamaCppEngine

logger = logging.getLogger(__name__)

# 繁→简转换器（懒加载，无 opencc 时回退为原文）
_opencc_t2s = None


def _to_simplified(text: str) -> str:
    """若已安装 opencc，将繁体转为简体；否则返回原文。保证 LLM 收到简体。"""
    if not text or not text.strip():
        return text
    global _opencc_t2s
    if _opencc_t2s is None:
        try:
            from opencc import OpenCC
            _opencc_t2s = OpenCC("t2s")
        except Exception as e:
            logger.debug("OpenCC not available, skipping t2s: %s", e)
            _opencc_t2s = False
    if _opencc_t2s is False:
        return text
    try:
        return _opencc_t2s.convert(text)
    except Exception as e:
        logger.warning("OpenCC t2s failed, using original: %s", e)
        return text


def _output_actually_improved(text_in: str, text_out: str) -> bool:
    """仅当输出相对输入确有改善时返回 True（与 semantic_repair_zh 一致）"""
    if text_out == text_in:
        return False
    trad = set("我們會來說這個們時動識讀語過長斷節練習頂經營解環給誌與於為")
    n_in = sum(1 for c in text_in if c in trad)
    n_out = sum(1 for c in text_out if c in trad)
    if n_in > 0 and n_out >= n_in:
        return False
    return True


class ZhRepairProcessor(BaseProcessor):
    """中文语义修复处理器"""

    def __init__(self, config: dict):
        super().__init__(config, "zh_repair")
        self.engine: Optional[LlamaCppEngine] = None
        self.model_path: Optional[str] = None
        self.warmed = False

    async def initialize(self):
        """加载中文模型"""
        logger.info(f"[{self.processor_name}] Loading Chinese model...")
        self.model_path = self.config.get("model_path")
        if not self.model_path or not os.path.exists(self.model_path):
            raise FileNotFoundError(f"Chinese model not found at: {self.model_path}")
        self.engine = LlamaCppEngine(
            model_path=self.model_path,
            n_ctx=self.config.get("n_ctx", 2048),
            n_gpu_layers=self.config.get("n_gpu_layers", -1),
            verbose=False,
        )
        gc.collect()
        try:
            _ = self.engine.repair("你好，这是一个测试句子。", lang="zh")
            self.warmed = True
        except Exception as e:
            logger.warning(f"[{self.processor_name}] Warmup failed: {e}")
            self.warmed = False

    async def process(
        self,
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None,
        **kwargs
    ) -> ProcessorResult:
        """繁→简（若有 opencc）+ LLM 语义修复；仅当确有改善时 decision=REPAIR"""
        if not self.engine:
            raise RuntimeError("Engine not initialized")
        text_for_llm = _to_simplified(text_in)
        result = self.engine.repair(
            text_in=text_for_llm,
            micro_context=micro_context,
            quality_score=quality_score,
            lang="zh",
        )
        text_out = result["text_out"]
        # 若 LLM 仍返回繁体，再强制繁→简一次，保证输出统一为简体
        text_out = _to_simplified(text_out)
        decision = "PASS"
        if text_out != text_in:
            if _output_actually_improved(text_in, text_out):
                decision = "REPAIR"
            else:
                text_out = text_in
        reason_codes = []
        if quality_score is not None and quality_score < self.config.get("quality_threshold", 0.85):
            reason_codes.append("LOW_QUALITY_SCORE")
        if decision == "REPAIR":
            reason_codes.append("REPAIR_APPLIED")
        return ProcessorResult(
            text_out=text_out,
            decision=decision,
            confidence=result["confidence"],
            diff=result.get("diff", []),
            reason_codes=reason_codes,
        )
    
    async def get_health(self) -> HealthResponse:
        """获取健康状态"""
        return HealthResponse(
            status='healthy' if self._initialized and self.warmed else 'loading',
            processor_type='model',
            initialized=self._initialized,
            warmed=self.warmed,
            model_loaded=self._initialized,
            model_version=os.path.basename(self.model_path) if self.model_path else None
        )
    
    async def shutdown(self):
        """清理资源"""
        if self.engine:
            logger.info(f"[{self.processor_name}] Shutting down engine...")
            self.engine.shutdown()
            self.engine = None
        gc.collect()
