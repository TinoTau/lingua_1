# -*- coding: utf-8 -*-
"""
Unified Semantic Repair Service
统一语义修复服务主文件
"""

import sys
import io
import os
import time
import traceback
import signal
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Dict

import gc
import uvicorn
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

try:
    import psutil
except ImportError:
    psutil = None

# 强制设置标准输出和错误输出为 UTF-8 编码（Windows 兼容性）
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(
        sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=False
    )
    sys.stderr = io.TextIOWrapper(
        sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=False
    )

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [Unified SR] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# 全局异常处理（捕获未处理的异常，防止服务崩溃）
def handle_exception(exc_type, exc_value, exc_traceback):
    """全局异常处理器"""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    
    print("=" * 80, flush=True)
    print(f"[Unified SR] 🚨 Uncaught exception in main process, service may crash", flush=True)
    print(f"[Unified SR] Exception type: {exc_type.__name__}", flush=True)
    print(f"[Unified SR] Exception value: {exc_value}", flush=True)
    print("[Unified SR] Traceback:", flush=True)
    for line in traceback.format_exception(exc_type, exc_value, exc_traceback):
        print(f"[Unified SR] {line.rstrip()}", flush=True)
    print("=" * 80, flush=True)
    
    # 调用默认异常处理器
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = handle_exception

# 信号处理（用于记录主进程退出）
def signal_handler(signum, frame):
    """信号处理器"""
    print(f"[Unified SR] Received signal {signum}, preparing to shutdown...", flush=True)
    if signum == signal.SIGTERM:
        print("[Unified SR] SIGTERM received, graceful shutdown", flush=True)
    elif signum == signal.SIGINT:
        print("[Unified SR] SIGINT received (Ctrl+C), graceful shutdown", flush=True)
    else:
        print(f"[Unified SR] Unexpected signal {signum} received", flush=True)

# 注册信号处理器（Windows 上可能不支持所有信号）
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
except (ValueError, OSError) as e:
    # Windows 上可能不支持某些信号
    print(f"[Unified SR] Warning: Could not register signal handler: {e}", flush=True)


def log_resource_usage(stage: str, device=None):
    """记录资源使用情况"""
    if psutil is None:
        return
    try:
        process = psutil.Process()
        memory_mb = process.memory_info().rss / 1024 / 1024
        cpu_percent = process.cpu_percent(interval=0.1)
        
        msg = f"[Unified SR] Resource Usage [{stage}]: Memory={memory_mb:.1f}MB, CPU={cpu_percent:.1f}%"
        
        if device and torch.cuda.is_available():
            try:
                gpu_mem_allocated = torch.cuda.memory_allocated(device) / 1024 / 1024 / 1024
                gpu_mem_reserved = torch.cuda.memory_reserved(device) / 1024 / 1024 / 1024
                msg += f", GPU_Allocated={gpu_mem_allocated:.2f}GB, GPU_Reserved={gpu_mem_reserved:.2f}GB"
            except:
                pass
        
        print(msg, flush=True)
        logger.info(msg)
    except Exception as e:
        print(f"[Unified SR] Warning: Could not log resource usage: {e}", flush=True)

from config import Config
from base.models import RepairRequest, RepairResponse, HealthResponse
from base.processor_wrapper import ProcessorWrapper
from processors.base_processor import BaseProcessor
from processors.zh_repair_processor import ZhRepairProcessor
from processors.en_repair_processor import EnRepairProcessor
from processors.en_normalize_processor import EnNormalizeProcessor

# 全局变量
processors: Dict[str, BaseProcessor] = {}
processor_wrapper: ProcessorWrapper = None
config: Config = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global processors, processor_wrapper, config
    
    print("=" * 80, flush=True)
    print("[Unified SR] ===== Starting Unified Semantic Repair Service =====", flush=True)
    print("=" * 80, flush=True)
    
    # 记录启动前资源
    log_resource_usage("BEFORE_INIT")
    
    # 启动：初始化所有处理器
    try:
        config = Config()
        
        print(f"[Unified SR] Configuration loaded:", flush=True)
        print(f"[Unified SR]   Host: {config.host}", flush=True)
        print(f"[Unified SR]   Port: {config.port}", flush=True)
        print(f"[Unified SR]   Timeout: {config.timeout}s", flush=True)
        print(f"[Unified SR]   Enabled processors:", flush=True)
        
        enabled = config.get_enabled_processors()
        
        # 初始化中文语义修复处理器（与备份 semantic_repair_zh 一致：启动时加载模型并 warmup）
        if 'zh_repair' in enabled:
            print(f"[Unified SR]     - zh_repair (Chinese Semantic Repair)", flush=True)
            zh_processor = ZhRepairProcessor(enabled['zh_repair'])
            processors['zh_repair'] = zh_processor
            await zh_processor.ensure_initialized()
            log_resource_usage("AFTER_ZH_INIT")
        
        # 初始化英文语义修复处理器
        if 'en_repair' in enabled:
            print(f"[Unified SR]     - en_repair (English Semantic Repair)", flush=True)
            en_processor = EnRepairProcessor(enabled['en_repair'])
            processors['en_repair'] = en_processor
            await en_processor.ensure_initialized()
            log_resource_usage("AFTER_EN_INIT")
        
        # 初始化英文标准化处理器
        if 'en_normalize' in enabled:
            print(f"[Unified SR]     - en_normalize (English Normalize)", flush=True)
            norm_processor = EnNormalizeProcessor(enabled['en_normalize'])
            processors['en_normalize'] = norm_processor
            await norm_processor.ensure_initialized()
            log_resource_usage("AFTER_NORM_INIT")
        
        # 创建处理器包装器
        processor_wrapper = ProcessorWrapper(processors, timeout=config.timeout)
        
        print(f"[Unified SR] Service ready with {len(processors)} processor(s)", flush=True)
        log_resource_usage("SERVICE_READY")
        print("=" * 80, flush=True)
    
    except Exception as e:
        print(f"[Unified SR] [CRITICAL ERROR] Failed to initialize: {e}", flush=True)
        traceback.print_exc()
        raise
    
    yield  # 应用运行期间
    
    # 关闭：清理所有处理器
    print("[Unified SR] ===== Shutting down Unified Semantic Repair Service =====", flush=True)
    log_resource_usage("BEFORE_SHUTDOWN")
    
    for name, processor in processors.items():
        try:
            await processor.shutdown()
            print(f"[Unified SR] ✅ {name} shut down", flush=True)
        except Exception as e:
            print(f"[Unified SR] ❌ Error shutting down {name}: {e}", flush=True)
    
    processors.clear()
    
    # 清理 GPU 内存
    if torch.cuda.is_available():
        try:
            torch.cuda.empty_cache()
            gc.collect()
            print("[Unified SR] ✅ GPU memory cache cleared", flush=True)
        except Exception as e:
            print(f"[Unified SR] ⚠️  Could not clear GPU cache: {e}", flush=True)
    
    log_resource_usage("AFTER_SHUTDOWN")
    print("[Unified SR] ✅ Graceful shutdown completed", flush=True)


# 创建 FastAPI 应用
app = FastAPI(
    title="Unified Semantic Repair Service",
    version="1.0.0",
    lifespan=lifespan
)


# ==================== 路径隔离的端点（零 if-else） ====================

@app.post("/zh/repair", response_model=RepairResponse)
async def zh_repair(request: RepairRequest):
    """中文语义修复"""
    return await processor_wrapper.handle_request("zh_repair", request)


@app.post("/en/repair", response_model=RepairResponse)
async def en_repair(request: RepairRequest):
    """英文语义修复"""
    return await processor_wrapper.handle_request("en_repair", request)


@app.post("/en/normalize", response_model=RepairResponse)
async def en_normalize(request: RepairRequest):
    """英文标准化"""
    return await processor_wrapper.handle_request("en_normalize", request)


# ==================== 按 lang 路由的统一端点（节点端调用） ====================

@app.post("/repair", response_model=RepairResponse)
async def repair_unified(request: RepairRequest):
    """按请求中的 lang 路由：zh → zh_repair，en → en_repair。"""
    lang = getattr(request, 'lang', None) or 'zh'
    
    if lang == 'zh':
        return await processor_wrapper.handle_request("zh_repair", request)
    elif lang == 'en':
        return await processor_wrapper.handle_request("en_repair", request)
    else:
        raise HTTPException(
            status_code=400,
            detail={"code": "SEM_REPAIR_UNSUPPORTED_LANG", "reason": "UNSUPPORTED_LANGUAGE"},
        )


# ==================== 健康检查端点 ====================
# 节点端要求 /health 顶层含 warmed 或 model_warmed（与备份中文服务 semantic_repair_zh 一致），
# 否则 Task Router 认为服务未 warmed，抛错后 stage 降级为 PASS，语义修复不生效。

class GlobalHealthResponse(BaseModel):
    """全局健康检查响应"""
    status: str
    processors: Dict[str, HealthResponse]
    warmed: bool = False  # 顶层 warmed：至少一个修复处理器已预热，节点端据此判定是否可发 /repair


@app.get("/health", response_model=GlobalHealthResponse)
async def global_health():
    """全局健康检查"""
    health_status = {}
    overall_healthy = True

    for name, processor in processors.items():
        try:
            status = await processor.get_health()
            health_status[name] = status
            if status.status != 'healthy':
                overall_healthy = False
        except Exception as e:
            logger.error(f"Error checking health for {name}: {e}")
            health_status[name] = HealthResponse(
                status='error',
                processor_type='unknown',
                initialized=False
            )
            overall_healthy = False

    # 至少一个修复处理器 warmed 时，节点端才认为服务可处理请求（与备份 semantic_repair_zh 的 model_warmed 一致）
    repair_processors = ('zh_repair', 'en_repair')
    warmed = any(
        health_status.get(p) and getattr(health_status[p], 'warmed', False)
        for p in repair_processors
        if p in health_status
    )
    # 至少一个修复处理器 healthy 且 warmed 时，整体 status 为 healthy，否则节点端 checkHealthEndpoint 不通过
    ready_for_requests = any(
        health_status.get(p) and health_status[p].status == 'healthy' and getattr(health_status[p], 'warmed', False)
        for p in repair_processors
        if p in health_status
    )

    return GlobalHealthResponse(
        status='healthy' if ready_for_requests else 'degraded',
        processors=health_status,
        warmed=warmed,
    )


@app.get("/zh/health", response_model=HealthResponse)
async def zh_health():
    """中文处理器健康检查"""
    processor = processors.get('zh_repair')
    if not processor:
        return HealthResponse(
            status='unavailable',
            processor_type='model',
            initialized=False
        )
    return await processor.get_health()


@app.get("/en/health", response_model=HealthResponse)
async def en_health():
    """英文处理器健康检查（repair + normalize）"""
    # 检查任一英文处理器的状态
    repair_processor = processors.get('en_repair')
    norm_processor = processors.get('en_normalize')
    
    if repair_processor:
        return await repair_processor.get_health()
    elif norm_processor:
        return await norm_processor.get_health()
    else:
        return HealthResponse(
            status='unavailable',
            processor_type='unknown',
            initialized=False
        )


# ==================== 主程序入口 ====================

if __name__ == "__main__":
    # 加载配置
    cfg = Config()
    
    print(f"[Unified SR] Starting server on {cfg.host}:{cfg.port}", flush=True)
    print(f"[Unified SR] Python version: {sys.version}", flush=True)
    print(f"[Unified SR] PyTorch version: {torch.__version__}", flush=True)
    print(f"[Unified SR] CUDA available: {torch.cuda.is_available()}", flush=True)
    if torch.cuda.is_available():
        print(f"[Unified SR] CUDA device: {torch.cuda.get_device_name(0)}", flush=True)
    print("=" * 80, flush=True)
    
    uvicorn.run(
        app,
        host=cfg.host,
        port=cfg.port,
        log_level="info",
        workers=1,  # 单进程
        loop="asyncio"
    )
