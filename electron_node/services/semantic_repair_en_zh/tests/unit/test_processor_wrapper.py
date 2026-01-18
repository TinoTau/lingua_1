# -*- coding: utf-8 -*-
"""
ProcessorWrapper 单元测试
"""

import pytest
import asyncio
from fastapi import HTTPException

from base.processor_wrapper import ProcessorWrapper
from base.models import RepairRequest, ProcessorResult
from processors.base_processor import BaseProcessor


class MockProcessor(BaseProcessor):
    """测试用模拟处理器"""
    
    def __init__(self, name: str, delay: float = 0, should_fail: bool = False):
        super().__init__({}, name)
        self.delay = delay
        self.should_fail = should_fail
        self._initialized = True  # 自动标记为已初始化
    
    async def initialize(self):
        pass
    
    async def process(self, text_in: str, **kwargs) -> ProcessorResult:
        if self.delay > 0:
            await asyncio.sleep(self.delay)
        
        if self.should_fail:
            raise ValueError("Process failed")
        
        return ProcessorResult(
            text_out=text_in.upper(),
            decision="REPAIR",
            confidence=0.9,
            diff=[],
            reason_codes=["TEST"]
        )
    
    async def get_health(self):
        pass
    
    async def shutdown(self):
        pass


@pytest.mark.asyncio
async def test_handle_request_success():
    """测试成功处理请求"""
    processor = MockProcessor("test")
    wrapper = ProcessorWrapper({"test": processor})
    
    request = RepairRequest(
        job_id="test-001",
        session_id="session-001",
        text_in="hello"
    )
    
    response = await wrapper.handle_request("test", request)
    
    assert response.request_id == "test-001"
    assert response.decision == "REPAIR"
    assert response.text_out == "HELLO"
    assert response.confidence == 0.9
    assert response.processor_name == "test"
    assert response.process_time_ms >= 0


@pytest.mark.asyncio
async def test_handle_request_timeout():
    """测试超时处理（返回原文）"""
    # 处理器需要2秒，但超时设置为1秒
    processor = MockProcessor("test", delay=2)
    wrapper = ProcessorWrapper({"test": processor}, timeout=1)
    
    request = RepairRequest(
        job_id="test-002",
        session_id="session-001",
        text_in="hello"
    )
    
    response = await wrapper.handle_request("test", request)
    
    # 应该返回 PASS（原文）
    assert response.decision == "PASS"
    assert response.text_out == "hello"
    assert "TIMEOUT" in response.reason_codes


@pytest.mark.asyncio
async def test_handle_request_error():
    """测试错误处理（返回原文）"""
    processor = MockProcessor("test", should_fail=True)
    wrapper = ProcessorWrapper({"test": processor})
    
    request = RepairRequest(
        job_id="test-003",
        session_id="session-001",
        text_in="hello"
    )
    
    response = await wrapper.handle_request("test", request)
    
    # 应该返回 PASS（原文）
    assert response.decision == "PASS"
    assert response.text_out == "hello"
    assert "ERROR" in response.reason_codes


@pytest.mark.asyncio
async def test_handle_request_processor_not_found():
    """测试处理器不存在"""
    wrapper = ProcessorWrapper({})
    
    request = RepairRequest(
        job_id="test-004",
        session_id="session-001",
        text_in="hello"
    )
    
    with pytest.raises(HTTPException) as exc_info:
        await wrapper.handle_request("nonexistent", request)
    
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_request_id_generation():
    """测试 Request ID 自动生成"""
    processor = MockProcessor("test")
    wrapper = ProcessorWrapper({"test": processor})
    
    # 不提供 job_id，应该自动生成 UUID
    request = RepairRequest(
        job_id="",
        session_id="session-001",
        text_in="hello"
    )
    
    response = await wrapper.handle_request("test", request)
    
    # 应该生成一个 UUID（不为空）
    assert response.request_id != ""
    assert len(response.request_id) > 0
