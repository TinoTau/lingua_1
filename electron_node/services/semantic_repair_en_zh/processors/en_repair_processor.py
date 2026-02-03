# -*- coding: utf-8 -*-
"""
英文语义修复处理器
"""

import os
import gc
import logging
from typing import Optional

from processors.base_processor import BaseProcessor
from base.models import ProcessorResult, HealthResponse
from engines.llamacpp_engine import LlamaCppEngine

logger = logging.getLogger(__name__)


class EnRepairProcessor(BaseProcessor):
    """英文语义修复处理器"""
    
    def __init__(self, config: dict):
        super().__init__(config, "en_repair")
        self.engine: Optional[LlamaCppEngine] = None
        self.model_path: Optional[str] = None
        self.warmed = False
    
    async def initialize(self):
        """加载英文模型"""
        logger.info(f"[{self.processor_name}] Loading English model...")
        
        # 查找模型路径
        self.model_path = self.config.get('model_path')
        if not self.model_path or not os.path.exists(self.model_path):
            raise FileNotFoundError(
                f"English model not found at: {self.model_path}"
            )
        
        # 加载 llama.cpp 引擎
        self.engine = LlamaCppEngine(
            model_path=self.model_path,
            n_ctx=self.config.get('n_ctx', 2048),
            n_gpu_layers=self.config.get('n_gpu_layers', -1),
            verbose=False
        )
        
        # 清理内存
        gc.collect()
        
        # 预热
        try:
            warmup_text = "Hello, this is a test sentence."
            _ = self.engine.repair(warmup_text)
            self.warmed = True
            logger.info(f"[{self.processor_name}] Model warmed up successfully")
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
        """执行英文语义修复"""
        if not self.engine:
            raise RuntimeError("Engine not initialized")
        
        # 调用引擎（成功即视为 REPAIR；失败由 wrapper raise，无 PASS 降级）
        result = self.engine.repair(
            text_in=text_in,
            micro_context=micro_context,
            quality_score=quality_score,
            lang="en",
        )
        text_out = result["text_out"]
        decision = "REPAIR" if text_out != text_in else "PASS"
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
