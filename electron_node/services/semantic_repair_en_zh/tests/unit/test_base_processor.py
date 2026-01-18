# -*- coding: utf-8 -*-
"""
BaseProcessor 单元测试
"""

import pytest
import asyncio
from processors.base_processor import BaseProcessor
from base.models import ProcessorResult, HealthResponse


class MockProcessor(BaseProcessor):
    """测试用模拟处理器"""
    
    def __init__(self):
        super().__init__({}, "mock")
        self.init_called = False
        self.init_delay = 0
    
    async def initialize(self):
        """模拟初始化"""
        self.init_called = True
        if self.init_delay > 0:
            await asyncio.sleep(self.init_delay)
    
    async def process(self, text_in: str, **kwargs) -> ProcessorResult:
        """模拟处理"""
        return ProcessorResult(
            text_out=text_in,
            decision="PASS",
            confidence=1.0
        )
    
    async def get_health(self) -> HealthResponse:
        """模拟健康检查"""
        return HealthResponse(
            status='healthy',
            processor_type='test',
            initialized=self._initialized
        )
    
    async def shutdown(self):
        """模拟关闭"""
        pass


@pytest.mark.asyncio
async def test_ensure_initialized_success():
    """测试初始化成功"""
    processor = MockProcessor()
    
    # 第一次调用应该初始化
    result = await processor.ensure_initialized()
    assert result is True
    assert processor.init_called is True
    assert processor.is_initialized() is True
    
    # 第二次调用应该直接返回
    processor.init_called = False
    result = await processor.ensure_initialized()
    assert result is True
    assert processor.init_called is False  # 没有重复初始化


@pytest.mark.asyncio
async def test_ensure_initialized_failure():
    """测试初始化失败"""
    
    class FailingProcessor(MockProcessor):
        async def initialize(self):
            raise ValueError("Init failed")
    
    processor = FailingProcessor()
    
    # 第一次调用应该失败
    with pytest.raises(ValueError, match="Init failed"):
        await processor.ensure_initialized()
    
    # 第二次调用应该直接抛出缓存的异常
    with pytest.raises(ValueError, match="Init failed"):
        await processor.ensure_initialized()


@pytest.mark.asyncio
async def test_concurrent_initialization():
    """测试并发初始化（锁保护）"""
    processor = MockProcessor()
    processor.init_delay = 0.1  # 模拟慢速初始化
    
    # 并发10个初始化请求
    results = await asyncio.gather(
        *[processor.ensure_initialized() for _ in range(10)]
    )
    
    # 所有请求都应该成功
    assert all(r is True for r in results)
    
    # 只应该初始化一次
    assert processor.is_initialized() is True


@pytest.mark.asyncio
async def test_process_before_init():
    """测试未初始化就调用 process"""
    processor = MockProcessor()
    
    # 没有调用 ensure_initialized，_initialized 为 False
    # 处理器可以决定是否检查初始化状态
    # 这里我们只测试基本流程
    result = await processor.process("test")
    assert result.text_out == "test"
