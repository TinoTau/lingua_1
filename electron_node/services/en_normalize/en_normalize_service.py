# -*- coding: utf-8 -*-
"""
EN Normalize Service
英文文本标准化服务主文件
"""

import sys
import io
import os
import time
import logging
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from normalizer import EnNormalizer

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [EN Normalize] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# 强制设置标准输出和错误输出为 UTF-8 编码（Windows 兼容性）
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=False
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=False
    )

# 全局标准化器
normalizer: Optional[EnNormalizer] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理（启动和优雅关闭）"""
    global normalizer
    
    # ==================== 启动时执行 ====================
    try:
        print("[EN Normalize Service] ===== Starting EN Normalize Service =====", flush=True)
        print(f"[EN Normalize Service] Python version: {sys.version}", flush=True)
        
        # 初始化标准化器
        normalizer = EnNormalizer()
        
        print("[EN Normalize Service] Normalizer initialized successfully", flush=True)
        print("[EN Normalize Service] Service is ready", flush=True)
    except Exception as e:
        print(f"[EN Normalize Service] [CRITICAL ERROR] Failed to initialize: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise
    
    yield  # 应用运行期间
    
    # ==================== 关闭时执行（优雅关闭） ====================
    try:
        print("[EN Normalize Service] ===== Shutting down EN Normalize Service =====", flush=True)
        print(f"[EN Normalize Service] Main process PID: {os.getpid()}", flush=True)
        
        # 清理标准化器
        if normalizer is not None:
            print("[EN Normalize Service] Cleaning up normalizer...", flush=True)
            normalizer = None
        
        # 强制垃圾回收
        import gc
        gc.collect()
        
        print("[EN Normalize Service] ✅ Graceful shutdown completed", flush=True)
    except Exception as e:
        print(f"[EN Normalize Service] ❌ Error during shutdown: {e}", flush=True)
        import traceback
        traceback.print_exc()


# 创建 FastAPI 应用（使用新的lifespan参数替代@app.on_event）
app = FastAPI(
    title="EN Normalize Service",
    version="1.0.0",
    lifespan=lifespan
)


# ==================== 请求/响应模型 ====================

class NormalizeRequest(BaseModel):
    """标准化请求"""
    job_id: str
    session_id: str
    utterance_index: int = 0
    lang: str = Field(default="en", description="语言代码")
    text_in: str = Field(..., description="输入文本")
    quality_score: Optional[float] = Field(default=None, description="质量分数（0.0-1.0）")


class NormalizeResponse(BaseModel):
    """标准化响应"""
    decision: str = Field(..., description="决策：PASS 或 REPAIR")
    text_out: str = Field(..., description="输出文本")
    confidence: float = Field(..., description="置信度（0.0-1.0）")
    reason_codes: list = Field(default_factory=list, description="原因代码列表")
    normalize_time_ms: Optional[int] = Field(default=None, description="标准化耗时（毫秒）")


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str = Field(..., description="状态：healthy 或 error")
    rules_loaded: bool = Field(..., description="规则是否已加载")


# ==================== API 端点 ====================

@app.post("/normalize", response_model=NormalizeResponse)
async def normalize_text(request: NormalizeRequest):
    """
    标准化英文文本
    
    对ASR输出的英文文本进行轻量级标准化处理，包括：
    - 文本规范化（大小写、空格、标点）
    - 缩写保护
    - URL/邮箱保护
    """
    global normalizer
    
    if normalizer is None:
        raise HTTPException(status_code=503, detail="Normalizer not initialized")
    
    # 只处理英文
    if request.lang != "en":
        return NormalizeResponse(
            decision="PASS",
            text_out=request.text_in,
            confidence=1.0,
            reason_codes=["NOT_ENGLISH"],
        )
    
    start_time = time.time()
    
    # 记录输入（任务链日志）
    logger.info(
        f"EN_NORMALIZE INPUT: Received normalize request | "
        f"job_id={request.job_id} | "
        f"session_id={request.session_id} | "
        f"utterance_index={request.utterance_index} | "
        f"lang={request.lang} | "
        f"text_in={request.text_in!r} | "
        f"text_in_length={len(request.text_in)} | "
        f"quality_score={request.quality_score}"
    )
    
    try:
        # 执行标准化
        result = normalizer.normalize(
            text=request.text_in,
            quality_score=request.quality_score or 1.0
        )
        
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        # 构建响应
        decision = "REPAIR" if result['normalized'] else "PASS"
        confidence = 0.9 if result['normalized'] else 1.0
        
        # 记录输出（任务链日志）
        logger.info(
            f"EN_NORMALIZE OUTPUT: Normalize completed | "
            f"job_id={request.job_id} | "
            f"session_id={request.session_id} | "
            f"utterance_index={request.utterance_index} | "
            f"decision={decision} | "
            f"text_out={result['normalized_text']!r} | "
            f"text_out_length={len(result['normalized_text'])} | "
            f"confidence={confidence:.2f} | "
            f"reason_codes={result['reason_codes']} | "
            f"normalize_time_ms={elapsed_ms} | "
            f"changed={result['normalized']}"
        )
        
        return NormalizeResponse(
            decision=decision,
            text_out=result['normalized_text'],
            confidence=confidence,
            reason_codes=result['reason_codes'],
            normalize_time_ms=elapsed_ms,
        )
    except Exception as e:
        print(f"[EN Normalize Service] Error during normalization: {e}", flush=True)
        import traceback
        traceback.print_exc()
        
        # 发生错误时返回原文
        return NormalizeResponse(
            decision="PASS",
            text_out=request.text_in,
            confidence=0.5,
            reason_codes=["ERROR"],
            normalize_time_ms=int((time.time() - start_time) * 1000),
        )


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    健康检查端点
    
    返回服务健康状态
    """
    global normalizer
    
    if normalizer is None:
        return HealthResponse(
            status="error",
            rules_loaded=False,
        )
    
    return HealthResponse(
        status="healthy",
        rules_loaded=True,
    )


# ==================== 主程序入口 ====================

if __name__ == "__main__":
    import uvicorn
    
    # 从环境变量或默认值获取端口
    port = int(os.environ.get("PORT", 5012))
    host = os.environ.get("HOST", "127.0.0.1")
    
    print(f"[EN Normalize Service] Starting server on {host}:{port}", flush=True)
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        workers=1,  # 单进程
        loop="asyncio",  # 使用asyncio事件循环
    )
