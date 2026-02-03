# -*- coding: utf-8 -*-
"""
统一的请求/响应模型
"""

from typing import Optional, Dict, List
from pydantic import BaseModel, Field


class RepairRequest(BaseModel):
    """统一修复请求（与节点端 /repair 调用一致）"""
    job_id: str = Field(..., description="任务ID")
    session_id: str = Field(..., description="会话ID")
    utterance_index: int = Field(default=0, description="话语索引")
    lang: str = Field(default="zh", description="语言代码 zh/en，用于路由到对应处理器")
    text_in: str = Field(..., description="输入文本")
    quality_score: Optional[float] = Field(default=None, description="质量分数（0.0-1.0）")
    micro_context: Optional[str] = Field(default=None, description="微上下文（上一句尾部）")
    meta: Optional[Dict] = Field(default=None, description="元数据")


class RepairResponse(BaseModel):
    """统一修复响应（节点端读取 decision / text_out / confidence / process_time_ms）"""
    request_id: str = Field(..., description="请求ID（自动生成）")
    decision: str = Field(..., description="决策：PASS、REPAIR 或 REJECT")
    text_out: str = Field(..., description="输出文本")
    confidence: float = Field(..., description="置信度（0.0-1.0）")
    diff: List[Dict] = Field(default_factory=list, description="差异列表")
    reason_codes: List[str] = Field(default_factory=list, description="原因代码列表")
    process_time_ms: int = Field(..., description="处理耗时（毫秒）")
    processor_name: str = Field(..., description="处理器名称")


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str = Field(..., description="状态：healthy、loading 或 error")
    processor_type: str = Field(..., description="处理器类型：model 或 rule_engine")
    initialized: bool = Field(..., description="是否已初始化")
    warmed: bool = Field(default=False, description="是否已预热")
    model_loaded: Optional[bool] = Field(default=None, description="模型是否已加载（仅model类型）")
    rules_loaded: Optional[bool] = Field(default=None, description="规则是否已加载（仅rule_engine类型）")
    model_version: Optional[str] = Field(default=None, description="模型版本")


class ProcessorResult(BaseModel):
    """处理器返回结果（内部使用）"""
    text_out: str
    decision: str  # PASS, REPAIR, REJECT
    confidence: float
    diff: List[Dict] = Field(default_factory=list)
    reason_codes: List[str] = Field(default_factory=list)
