# -*- coding: utf-8 -*-
"""
英文标准化处理器（规则引擎）
"""

import logging
from typing import Optional

from processors.base_processor import BaseProcessor
from base.models import ProcessorResult, HealthResponse
from engines.normalizer_engine import EnNormalizer

logger = logging.getLogger(__name__)


class EnNormalizeProcessor(BaseProcessor):
    """英文标准化处理器"""
    
    def __init__(self, config: dict):
        super().__init__(config, "en_normalize")
        self.engine: Optional[EnNormalizer] = None
    
    async def initialize(self):
        """初始化标准化器"""
        logger.info(f"[{self.processor_name}] Initializing normalizer...")
        
        # 创建标准化引擎（规则引擎，无需加载模型）
        self.engine = EnNormalizer()
        
        logger.info(f"[{self.processor_name}] Normalizer initialized")
    
    async def process(
        self,
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None,
        **kwargs
    ) -> ProcessorResult:
        """执行英文标准化"""
        if not self.engine:
            raise RuntimeError("Engine not initialized")
        
        # 调用标准化引擎
        result = self.engine.normalize(
            text=text_in,
            quality_score=quality_score or 1.0
        )
        
        # 决策逻辑
        decision = "REPAIR" if result['normalized'] else "PASS"
        confidence = 0.9 if result['normalized'] else 1.0
        
        return ProcessorResult(
            text_out=result['normalized_text'],
            decision=decision,
            confidence=confidence,
            diff=[],  # Normalizer 不提供 diff
            reason_codes=result.get('reason_codes', [])
        )
    
    async def get_health(self) -> HealthResponse:
        """获取健康状态"""
        return HealthResponse(
            status='healthy' if self._initialized else 'loading',
            processor_type='rule_engine',
            initialized=self._initialized,
            warmed=self._initialized,
            rules_loaded=self._initialized
        )
    
    async def shutdown(self):
        """清理资源"""
        if self.engine:
            logger.info(f"[{self.processor_name}] Shutting down normalizer...")
            self.engine = None
