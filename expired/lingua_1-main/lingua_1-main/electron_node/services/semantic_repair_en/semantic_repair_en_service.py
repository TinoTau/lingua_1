# -*- coding: utf-8 -*-
"""
Semantic Repair Service - English
英文语义修复服务主文件
"""

import sys
import io
import os
import time
import signal
import traceback
import logging
from typing import Optional, Dict, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import torch
import gc  # For garbage collection

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [Semantic Repair EN] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

from model_loader import (
    setup_device,
    log_gpu_info,
    find_gguf_model_path,
)
from llamacpp_engine import LlamaCppEngine

# 强制设置标准输出和错误输出为 UTF-8 编码（Windows 兼容性）
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=False
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=False
    )

# 全局异常处理（捕获未处理的异常，防止服务崩溃）
def handle_exception(exc_type, exc_value, exc_traceback):
    """全局异常处理器"""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    
    print("=" * 80, flush=True)
    print(f"[Semantic Repair EN] 🚨 Uncaught exception in main process, service may crash", flush=True)
    print(f"[Semantic Repair EN] Exception type: {exc_type.__name__}", flush=True)
    print(f"[Semantic Repair EN] Exception value: {exc_value}", flush=True)
    print("[Semantic Repair EN] Traceback:", flush=True)
    for line in traceback.format_exception(exc_type, exc_value, exc_traceback):
        print(f"[Semantic Repair EN] {line.rstrip()}", flush=True)
    print("=" * 80, flush=True)
    
    # 调用默认异常处理器
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = handle_exception

# 信号处理（用于记录主进程退出）
def signal_handler(signum, frame):
    """信号处理器"""
    print(f"[Semantic Repair EN] Received signal {signum}, preparing to shutdown...", flush=True)
    if signum == signal.SIGTERM:
        print("[Semantic Repair EN] SIGTERM received, graceful shutdown", flush=True)
    elif signum == signal.SIGINT:
        print("[Semantic Repair EN] SIGINT received (Ctrl+C), graceful shutdown", flush=True)
    else:
        print(f"[Semantic Repair EN] Unexpected signal {signum} received", flush=True)

# 注册信号处理器（Windows 上可能不支持所有信号）
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
except (ValueError, OSError) as e:
    # Windows 上可能不支持某些信号
    print(f"[Semantic Repair EN] Warning: Could not register signal handler: {e}", flush=True)

# 全局变量（将在startup时通过setup_device()设置）
DEVICE = None  # 将在startup时初始化
llamacpp_engine: Optional[LlamaCppEngine] = None  # llama.cpp 引擎
loaded_model_path: Optional[str] = None
model_warmed = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理（启动和优雅关闭）"""
    global llamacpp_engine, loaded_model_path, DEVICE, model_warmed
    
    startup_start_time = time.time()
    
    # ==================== 启动时执行 ====================
    try:
        print("[Semantic Repair EN] ===== Starting Semantic Repair Service (English) =====", flush=True)
        print(f"[Semantic Repair EN] Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
        print(f"[Semantic Repair EN] Python version: {sys.version}", flush=True)
        print(f"[Semantic Repair EN] PyTorch version: {torch.__version__}", flush=True)
        print(f"[Semantic Repair EN] CUDA available: {torch.cuda.is_available()}", flush=True)
        print("[Semantic Repair EN] ⚠️  Model loading may cause high CPU usage, please wait...", flush=True)
        
        # 设置设备（强制GPU，如果失败会抛出异常）
        step_start = time.time()
        print("[Semantic Repair EN] [1/5] Setting up device...", flush=True)
        DEVICE = setup_device()
        print(f"[Semantic Repair EN] Device: {DEVICE} (took {time.time() - step_start:.2f}s)", flush=True)
        
        # 记录GPU信息
        log_gpu_info()
        
        # 强制只使用本地文件
        os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
        os.environ["HF_LOCAL_FILES_ONLY"] = "1"
        
        # 从服务目录查找 GGUF 模型
        step_start = time.time()
        print("[Semantic Repair EN] [2/5] Finding GGUF model path...", flush=True)
        service_dir = os.path.dirname(__file__)
        
        gguf_model_path = find_gguf_model_path(service_dir)
        if not gguf_model_path:
            error_msg = (
                f"[Semantic Repair EN] ❌ ERROR: GGUF model not found!\n"
                f"  Service directory: {service_dir}\n"
                f"  Expected location: {os.path.join(service_dir, 'models', 'qwen2.5-3b-instruct-en-gguf')}\n"
                f"  \n"
                f"  Please download GGUF model files:\n"
                f"    hf download Qwen/Qwen2.5-3B-Instruct-GGUF --include \"*.gguf\" --local-dir ./models/qwen2.5-3b-instruct-en-gguf\n"
                f"  \n"
                f"  Or use the Chinese model (supports English):\n"
                f"    The Chinese model at models/qwen2.5-3b-instruct-zh-gguf can also be used for English.\n"
                f"  \n"
                f"  Service startup is ABORTED."
            )
            print(error_msg, flush=True)
            raise FileNotFoundError(
                f"GGUF model not found. Please download the model to: "
                f"{os.path.join(service_dir, 'models', 'qwen2.5-3b-instruct-en-gguf')}"
            )
        
        print(f"[Semantic Repair EN] Found GGUF model: {gguf_model_path}", flush=True)
        
        # 加载 llama.cpp 引擎
        step_start = time.time()
        print("[Semantic Repair EN] [3/5] Loading llama.cpp engine...", flush=True)
        llamacpp_engine = LlamaCppEngine(
            model_path=gguf_model_path,
            n_ctx=2048,
            n_gpu_layers=-1,  # 使用所有 GPU 层
            verbose=False
        )
        loaded_model_path = gguf_model_path
        model_load_time = time.time() - step_start
        print(f"[Semantic Repair EN] llama.cpp engine loaded (took {model_load_time:.2f}s)", flush=True)
        
        # 清理内存
        gc.collect()
        print("[Semantic Repair EN] Memory cleanup completed", flush=True)
        
        print("[Semantic Repair EN] ✅ Llama.cpp engine initialized successfully", flush=True)
        
        # 模型预热（在启动时进行，而不是等到第一次API调用）
        step_start = time.time()
        print("[Semantic Repair EN] [4/5] Warming up llama.cpp engine (this may take 10-30 seconds)...", flush=True)
        print(f"[Semantic Repair EN] Warm-up started at {time.strftime('%H:%M:%S')}", flush=True)
        try:
            warmup_text = "Hello, this is a test sentence."
            _ = llamacpp_engine.repair(warmup_text)
            model_warmed = True
            warmup_time = time.time() - step_start
            print(f"[Semantic Repair EN] ✅ Model warm-up completed (took {warmup_time:.2f}s)", flush=True)
        except Exception as e:
            print(f"[Semantic Repair EN] ⚠️  Warm-up failed (will warm-up on first request): {e}", flush=True)
            model_warmed = False
        
        total_startup_time = time.time() - startup_start_time
        print(f"[Semantic Repair EN] ✅ Service is ready (total startup time: {total_startup_time:.2f}s)", flush=True)
    except Exception as e:
        print(f"[Semantic Repair EN] [CRITICAL ERROR] Failed to initialize: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise
    
    yield  # 应用运行期间
    
    yield  # 应用运行期间
    
    # ==================== 关闭时执行（优雅关闭） ====================
    try:
        print("[Semantic Repair EN] ===== Shutting down Semantic Repair Service (English) =====", flush=True)
        print(f"[Semantic Repair EN] Main process PID: {os.getpid()}", flush=True)
        
        # 清理 llama.cpp 引擎
        if llamacpp_engine is not None:
            print("[Semantic Repair EN] Cleaning up llama.cpp engine...", flush=True)
            llamacpp_engine.shutdown()
            llamacpp_engine = None
        
        # 清理GPU缓存
        if DEVICE is not None and DEVICE.type == "cuda":
            print("[Semantic Repair EN] Clearing GPU cache...", flush=True)
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        
        # 强制垃圾回收
        gc.collect()
        
        print("[Semantic Repair EN] ✅ Graceful shutdown completed", flush=True)
    except Exception as e:
        print(f"[Semantic Repair EN] ❌ Error during shutdown: {e}", flush=True)
        import traceback
        traceback.print_exc()


# 创建 FastAPI 应用（使用lifespan替代@app.on_event）
app = FastAPI(
    title="Semantic Repair Service - English",
    version="1.0.0",
    lifespan=lifespan
)


# ==================== 请求/响应模型 ====================

class RepairRequest(BaseModel):
    """修复请求"""
    job_id: str
    session_id: str
    utterance_index: int = 0
    lang: str = Field(default="en", description="语言代码")
    text_in: str = Field(..., description="输入文本")
    quality_score: Optional[float] = Field(default=None, description="质量分数（0.0-1.0）")
    micro_context: Optional[str] = Field(default=None, description="微上下文（上一句尾部）")
    meta: Optional[Dict] = Field(default=None, description="元数据")


class RepairResponse(BaseModel):
    """修复响应"""
    decision: str = Field(..., description="决策：PASS、REPAIR 或 REJECT")
    text_out: str = Field(..., description="输出文本")
    confidence: float = Field(..., description="置信度（0.0-1.0）")
    diff: List[Dict] = Field(default_factory=list, description="差异列表")
    reason_codes: List[str] = Field(default_factory=list, description="原因代码列表")
    repair_time_ms: Optional[int] = Field(default=None, description="修复耗时（毫秒）")


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str = Field(..., description="状态：healthy、loading 或 error")
    model_loaded: bool = Field(..., description="模型是否已加载")
    model_version: Optional[str] = Field(default=None, description="模型版本")
    warmed: bool = Field(default=False, description="模型是否已warm")


# ==================== API 端点 ====================
# 注意：启动和关闭逻辑已移至 lifespan 上下文管理器


# ==================== API 端点 ====================

@app.post("/repair", response_model=RepairResponse)
async def repair_text(request: RepairRequest):
    """
    修复ASR文本
    
    对ASR输出的英文文本进行语义修复，主要解决拼写错误、缩写误识别等问题。
    """
    global llamacpp_engine, model_warmed
    
    # 检查引擎是否可用
    if llamacpp_engine is None:
        raise HTTPException(status_code=503, detail="Llama.cpp engine not initialized")
    
    # 只处理英文
    if request.lang != "en":
        return RepairResponse(
            decision="PASS",
            text_out=request.text_in,
            confidence=1.0,
            reason_codes=["NOT_ENGLISH"],
        )
    
    # 模型预热（首次调用时）
    if not model_warmed:
        try:
            # llama.cpp 不需要单独的 warm_up，直接使用即可
            model_warmed = True
        except Exception as e:
            print(f"[Semantic Repair EN] Warm-up failed: {e}", flush=True)
    
    start_time = time.time()
    
    # 记录输入（任务链日志）- 同时使用print确保输出可见
    input_log = (
        f"SEMANTIC_REPAIR_EN INPUT: Received repair request | "
        f"job_id={request.job_id} | "
        f"session_id={request.session_id} | "
        f"utterance_index={request.utterance_index} | "
        f"lang={request.lang} | "
        f"text_in={request.text_in!r} | "
        f"text_in_length={len(request.text_in)} | "
        f"quality_score={request.quality_score} | "
        f"micro_context={repr(request.micro_context) if request.micro_context else None}"
    )
    logger.info(input_log)
    print(f"[Semantic Repair EN] {input_log}", flush=True)
    
    try:
        # 执行修复
        result = llamacpp_engine.repair(
            text_in=request.text_in,
            micro_context=request.micro_context,
            quality_score=request.quality_score
        )
        
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        # 构建响应
        decision = "REPAIR" if result['text_out'] != request.text_in else "PASS"
        reason_codes = []
        
        # 降低质量分数阈值，提高敏感度：从0.7降到0.85（与中文服务保持一致）
        if request.quality_score is not None and request.quality_score < 0.85:
            reason_codes.append("LOW_QUALITY_SCORE")
        
        if decision == "REPAIR":
            reason_codes.append("REPAIR_APPLIED")
        
        # 记录输出（任务链日志）- 同时使用print确保输出可见
        output_log = (
            f"SEMANTIC_REPAIR_EN OUTPUT: Repair completed | "
            f"job_id={request.job_id} | "
            f"session_id={request.session_id} | "
            f"utterance_index={request.utterance_index} | "
            f"decision={decision} | "
            f"text_out={result['text_out']!r} | "
            f"text_out_length={len(result['text_out'])} | "
            f"confidence={result['confidence']:.2f} | "
            f"reason_codes={reason_codes} | "
            f"repair_time_ms={elapsed_ms} | "
            f"changed={result['text_out'] != request.text_in}"
        )
        logger.info(output_log)
        print(f"[Semantic Repair EN] {output_log}", flush=True)
        
        return RepairResponse(
            decision=decision,
            text_out=result['text_out'],
            confidence=result['confidence'],
            diff=result['diff'],
            reason_codes=reason_codes,
            repair_time_ms=elapsed_ms,
        )
    except Exception as e:
        print(f"[Semantic Repair EN] Error during repair: {e}", flush=True)
        import traceback
        traceback.print_exc()
        
        # 发生错误时返回原文
        return RepairResponse(
            decision="PASS",
            text_out=request.text_in,
            confidence=0.5,
            reason_codes=["ERROR"],
            repair_time_ms=int((time.time() - start_time) * 1000),
        )


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    健康检查端点
    
    返回服务健康状态和模型warm状态
    只有在warm-up完成后才返回"healthy"状态
    """
    global llamacpp_engine, loaded_model_path, model_warmed
    
    if llamacpp_engine is None:
        return HealthResponse(
            status="loading",  # 引擎正在加载中
            model_loaded=False,
            warmed=False,
        )
    
    # 如果引擎已加载但未完成warm-up，返回"loading"状态
    if not model_warmed:
        return HealthResponse(
            status="loading",  # 引擎已加载，但正在warm-up中
            model_loaded=True,
            warmed=False,
        )
    
    model_version = "qwen2.5-3b-instruct-en-gguf"
    if loaded_model_path:
        # 从路径提取模型版本
        model_name = os.path.basename(loaded_model_path)
        if model_name:
            model_version = model_name
    
    # 只有在warm-up完成后才返回"healthy"
    return HealthResponse(
        status="healthy",
        model_loaded=True,
        model_version=model_version,
        warmed=model_warmed,
    )


# ==================== 主程序入口 ====================

if __name__ == "__main__":
    import uvicorn
    
    # 从环境变量或默认值获取端口
    port = int(os.environ.get("PORT", 5011))
    host = os.environ.get("HOST", "127.0.0.1")
    
    print(f"[Semantic Repair EN] Starting server on {host}:{port}", flush=True)
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        workers=1,  # 单进程，避免多进程导致的高CPU占用
        loop="asyncio",  # 使用asyncio事件循环
    )
