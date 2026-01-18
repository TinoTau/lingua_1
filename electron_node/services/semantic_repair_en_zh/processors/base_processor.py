# -*- coding: utf-8 -*-
"""
处理器抽象基类（含并发保护）
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

from base.models import ProcessorResult, HealthResponse

logger = logging.getLogger(__name__)


class BaseProcessor(ABC):
    """处理器抽象基类"""
    
    def __init__(self, config: Dict[str, Any], processor_name: str):
        """
        初始化处理器
        
        Args:
            config: 配置字典
            processor_name: 处理器名称（用于日志）
        """
        self.config = config
        self.processor_name = processor_name
        self._initialized = False
        self._init_lock = asyncio.Lock()
        self._init_error: Optional[Exception] = None
    
    async def ensure_initialized(self) -> bool:
        """
        确保处理器已初始化（含并发保护）
        
        Returns:
            bool: 是否初始化成功
        """
        if self._initialized:
            return True
        
        if self._init_error:
            # 已经初始化失败过
            raise self._init_error
        
        async with self._init_lock:
            # 双重检查锁定模式
            if self._initialized:
                return True
            
            if self._init_error:
                raise self._init_error
            
            try:
                logger.info(f"[{self.processor_name}] Initializing processor...")
                await self.initialize()
                self._initialized = True
                logger.info(f"[{self.processor_name}] Processor initialized successfully")
                return True
            except Exception as e:
                self._init_error = e
                logger.error(f"[{self.processor_name}] Failed to initialize: {e}")
                raise
    
    @abstractmethod
    async def initialize(self):
        """初始化处理器（加载模型等）- 子类必须实现"""
        pass
    
    @abstractmethod
    async def process(
        self,
        text_in: str,
        micro_context: Optional[str] = None,
        quality_score: Optional[float] = None,
        **kwargs
    ) -> ProcessorResult:
        """
        处理文本 - 子类必须实现
        
        Args:
            text_in: 输入文本
            micro_context: 微上下文
            quality_score: 质量分数
            **kwargs: 其他参数
        
        Returns:
            ProcessorResult: 处理结果
        """
        pass
    
    @abstractmethod
    async def get_health(self) -> HealthResponse:
        """获取健康状态 - 子类必须实现"""
        pass
    
    @abstractmethod
    async def shutdown(self):
        """优雅关闭 - 子类必须实现"""
        pass
    
    def is_initialized(self) -> bool:
        """检查是否已初始化"""
        return self._initialized
