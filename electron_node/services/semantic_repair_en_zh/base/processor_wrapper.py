# -*- coding: utf-8 -*-
"""
ProcessorWrapper - 统一处理器调用包装器
消除所有路由中的重复代码
"""

import time
import uuid
import logging
import asyncio
from typing import Dict
from fastapi import HTTPException

from base.models import RepairRequest, RepairResponse
from processors.base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class ProcessorWrapper:
    """统一处理器调用包装器"""
    
    def __init__(self, processors: Dict[str, BaseProcessor], timeout: int = 30):
        """
        初始化包装器
        
        Args:
            processors: 处理器字典 {name: processor}
            timeout: 处理超时时间（秒）
        """
        self.processors = processors
        self.timeout = timeout
    
    async def handle_request(
        self,
        processor_name: str,
        request: RepairRequest
    ) -> RepairResponse:
        """
        统一处理请求
        
        Args:
            processor_name: 处理器名称
            request: 请求对象
        
        Returns:
            RepairResponse: 响应对象
        
        Raises:
            HTTPException: 处理器不可用或处理失败
        """
        # 1. 获取处理器
        processor = self.processors.get(processor_name)
        if not processor:
            raise HTTPException(
                status_code=503,
                detail=f"Processor '{processor_name}' not available"
            )
        
        # 2. 确保处理器已初始化
        try:
            await processor.ensure_initialized()
        except Exception as e:
            logger.error(f"[{processor_name}] Processor initialization failed: {e}")
            raise HTTPException(
                status_code=503,
                detail=f"Processor '{processor_name}' initialization failed"
            )
        
        # 3. 生成 Request ID（如果没有 job_id 则生成 UUID）
        request_id = request.job_id or str(uuid.uuid4())
        
        # 4. 记录输入日志（任务链日志）
        input_log = (
            f"{processor_name.upper()} INPUT: Received repair request | "
            f"job_id={request_id} | "
            f"session_id={request.session_id} | "
            f"utterance_index={request.utterance_index} | "
            f"text_in={request.text_in!r} | "
            f"text_in_length={len(request.text_in)} | "
            f"quality_score={request.quality_score} | "
            f"micro_context={repr(request.micro_context) if request.micro_context else None}"
        )
        logger.info(input_log)
        print(f"[Unified SR] {input_log}", flush=True)
        
        # 5. 计时开始
        start_time = time.time()
        
        # 6. 调用处理器（带超时控制）
        try:
            result = await asyncio.wait_for(
                processor.process(
                    text_in=request.text_in,
                    micro_context=request.micro_context,
                    quality_score=request.quality_score
                ),
                timeout=self.timeout
            )
            
            elapsed_ms = int((time.time() - start_time) * 1000)
            
            # 7. 记录输出日志（任务链日志）
            output_log = (
                f"{processor_name.upper()} OUTPUT: Repair completed | "
                f"job_id={request_id} | "
                f"session_id={request.session_id} | "
                f"utterance_index={request.utterance_index} | "
                f"decision={result.decision} | "
                f"text_out={result.text_out!r} | "
                f"text_out_length={len(result.text_out)} | "
                f"confidence={result.confidence:.2f} | "
                f"reason_codes={result.reason_codes} | "
                f"repair_time_ms={elapsed_ms} | "
                f"changed={result.text_out != request.text_in}"
            )
            logger.info(output_log)
            print(f"[Unified SR] {output_log}", flush=True)
            
            # 8. 构造响应
            return RepairResponse(
                request_id=request_id,
                decision=result.decision,
                text_out=result.text_out,
                confidence=result.confidence,
                diff=result.diff,
                reason_codes=result.reason_codes,
                process_time_ms=elapsed_ms,
                processor_name=processor_name
            )
        
        except asyncio.TimeoutError:
            # 超时：返回原文（PASS）
            elapsed_ms = int((time.time() - start_time) * 1000)
            timeout_log = (
                f"{processor_name.upper()} TIMEOUT: Request timeout | "
                f"job_id={request_id} | "
                f"elapsed_ms={elapsed_ms} | "
                f"timeout_limit={self.timeout}s | "
                f"fallback=PASS"
            )
            logger.warning(timeout_log)
            print(f"[Unified SR] {timeout_log}", flush=True)
            return RepairResponse(
                request_id=request_id,
                decision="PASS",
                text_out=request.text_in,
                confidence=0.5,
                diff=[],
                reason_codes=["TIMEOUT"],
                process_time_ms=elapsed_ms,
                processor_name=processor_name
            )
        
        except Exception as e:
            # 错误：返回原文（PASS）
            elapsed_ms = int((time.time() - start_time) * 1000)
            error_log = (
                f"{processor_name.upper()} ERROR: Processing error | "
                f"job_id={request_id} | "
                f"error={str(e)} | "
                f"fallback=PASS"
            )
            logger.error(error_log, exc_info=True)
            print(f"[Unified SR] {error_log}", flush=True)
            import traceback
            traceback.print_exc()
            return RepairResponse(
                request_id=request_id,
                decision="PASS",
                text_out=request.text_in,
                confidence=0.5,
                diff=[],
                reason_codes=["ERROR"],
                process_time_ms=elapsed_ms,
                processor_name=processor_name
            )
