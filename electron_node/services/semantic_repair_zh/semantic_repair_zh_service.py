# -*- coding: utf-8 -*-
"""
Semantic Repair Service - Chinese
中文语义修复服务主文件
"""

import sys
import io
import os
import time
import traceback  # For global exception handling
import signal  # For signal handling
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
    format='[%(asctime)s] [%(levelname)s] [Semantic Repair ZH] %(message)s',
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
    print(f"[Semantic Repair ZH] 🚨 Uncaught exception in main process, service may crash", flush=True)
    print(f"[Semantic Repair ZH] Exception type: {exc_type.__name__}", flush=True)
    print(f"[Semantic Repair ZH] Exception value: {exc_value}", flush=True)
    print("[Semantic Repair ZH] Traceback:", flush=True)
    for line in traceback.format_exception(exc_type, exc_value, exc_traceback):
        print(f"[Semantic Repair ZH] {line.rstrip()}", flush=True)
    print("=" * 80, flush=True)
    
    # 调用默认异常处理器
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = handle_exception

# 信号处理（用于记录主进程退出）
def signal_handler(signum, frame):
    """信号处理器"""
    print(f"[Semantic Repair ZH] Received signal {signum}, preparing to shutdown...", flush=True)
    if signum == signal.SIGTERM:
        print("[Semantic Repair ZH] SIGTERM received, graceful shutdown", flush=True)
    elif signum == signal.SIGINT:
        print("[Semantic Repair ZH] SIGINT received (Ctrl+C), graceful shutdown", flush=True)
    else:
        print(f"[Semantic Repair ZH] Unexpected signal {signum} received", flush=True)

# 注册信号处理器（Windows 上可能不支持所有信号）
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
except (ValueError, OSError) as e:
    # Windows 上可能不支持某些信号
    print(f"[Semantic Repair ZH] Warning: Could not register signal handler: {e}", flush=True)

# 全局变量（将在startup时通过setup_device()设置）
DEVICE = None  # 将在startup时初始化
llamacpp_engine: Optional[LlamaCppEngine] = None  # llama.cpp 引擎
loaded_model_path: Optional[str] = None
model_warmed = False


def log_resource_usage(stage: str, device=None):
    """记录资源使用情况"""
    try:
        import psutil
        process = psutil.Process()
        memory_mb = process.memory_info().rss / 1024 / 1024
        cpu_percent = process.cpu_percent(interval=0.1)
        
        device_to_check = device if device is not None else DEVICE
        if device_to_check is not None and device_to_check.type == "cuda" and torch.cuda.is_available():
            gpu_memory_allocated = torch.cuda.memory_allocated() / 1024**3
            gpu_memory_reserved = torch.cuda.memory_reserved() / 1024**3
            print(f"[Semantic Repair ZH] [{stage}] Memory: {memory_mb:.2f} MB | CPU: {cpu_percent:.1f}% | GPU Allocated: {gpu_memory_allocated:.2f} GB | GPU Reserved: {gpu_memory_reserved:.2f} GB", flush=True)
        else:
            print(f"[Semantic Repair ZH] [{stage}] Memory: {memory_mb:.2f} MB | CPU: {cpu_percent:.1f}%", flush=True)
    except Exception as e:
        print(f"[Semantic Repair ZH] [{stage}] Failed to log resource usage: {e}", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理（启动和优雅关闭）"""
    global llamacpp_engine, loaded_model_path, DEVICE, model_warmed
    
    startup_start_time = time.time()
    
    # ==================== 启动时执行 ====================
    try:
        print("[Semantic Repair ZH] ===== Starting Semantic Repair Service (Chinese) =====", flush=True)
        print(f"[Semantic Repair ZH] Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
        print(f"[Semantic Repair ZH] Python version: {sys.version}", flush=True)
        print(f"[Semantic Repair ZH] PyTorch version: {torch.__version__}", flush=True)
        print(f"[Semantic Repair ZH] CUDA available: {torch.cuda.is_available()}", flush=True)
        print("[Semantic Repair ZH] ⚠️  Model loading may cause high CPU usage, please wait...", flush=True)
        log_resource_usage("INIT")
        
        # 设置设备（强制GPU，如果失败会抛出异常）
        step_start = time.time()
        print("[Semantic Repair ZH] [1/5] Setting up device...", flush=True)
        DEVICE = setup_device()
        print(f"[Semantic Repair ZH] Device: {DEVICE} (took {time.time() - step_start:.2f}s)", flush=True)
        log_resource_usage("DEVICE_SETUP")
        
        # 记录GPU信息
        log_gpu_info()
        
        # 强制只使用本地文件
        os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
        os.environ["HF_LOCAL_FILES_ONLY"] = "1"
        
        # 从服务目录查找 GGUF 模型
        step_start = time.time()
        print("[Semantic Repair ZH] [2/5] Finding GGUF model path...", flush=True)
        service_dir = os.path.dirname(__file__)
        
        gguf_model_path = find_gguf_model_path(service_dir)
        if not gguf_model_path:
            error_msg = (
                f"[Semantic Repair ZH] ❌ ERROR: GGUF model not found!\n"
                f"  Service directory: {service_dir}\n"
                f"  Expected location: {os.path.join(service_dir, 'models', 'qwen2.5-3b-instruct-zh-gguf')}\n"
                f"  \n"
                f"  Please download GGUF model files:\n"
                f"    hf download Qwen/Qwen2.5-3B-Instruct-GGUF --include \"*.gguf\" --local-dir ./models/qwen2.5-3b-instruct-zh-gguf\n"
                f"  \n"
                f"  Service startup is ABORTED."
            )
            print(error_msg, flush=True)
            raise FileNotFoundError(
                f"GGUF model not found. Please download the model to: "
                f"{os.path.join(service_dir, 'models', 'qwen2.5-3b-instruct-zh-gguf')}"
            )
        
        print(f"[Semantic Repair ZH] Found GGUF model: {gguf_model_path}", flush=True)
        
        # 加载 llama.cpp 引擎
        step_start = time.time()
        print("[Semantic Repair ZH] [3/5] Loading llama.cpp engine...", flush=True)
        llamacpp_engine = LlamaCppEngine(
            model_path=gguf_model_path,
            n_ctx=2048,
            n_gpu_layers=-1,  # 使用所有 GPU 层
            verbose=False
        )
        loaded_model_path = gguf_model_path
        model_load_time = time.time() - step_start
        print(f"[Semantic Repair ZH] llama.cpp engine loaded (took {model_load_time:.2f}s)", flush=True)
        log_resource_usage("LLAMACPP_ENGINE_LOADED")
        
        # 清理内存
        gc.collect()
        print("[Semantic Repair ZH] Memory cleanup completed", flush=True)
        log_resource_usage("MEMORY_CLEANUP")
        
        print("[Semantic Repair ZH] ✅ Llama.cpp engine initialized successfully", flush=True)
        
        # 模型预热（在启动时进行，而不是等到第一次API调用）
        step_start = time.time()
        print("[Semantic Repair ZH] [4/5] Warming up llama.cpp engine (this may take 10-30 seconds)...", flush=True)
        print(f"[Semantic Repair ZH] Warm-up started at {time.strftime('%H:%M:%S')}", flush=True)
        log_resource_usage("WARMUP_START")
        
        try:
            warmup_text = "你好，这是一个测试句子。"
            if llamacpp_engine is None:
                raise RuntimeError("Llama.cpp engine not initialized")
            warmup_result = llamacpp_engine.repair(warmup_text)
            model_warmed = True
            warmup_time = time.time() - step_start
            print(f"[Semantic Repair ZH] ✅ Model warm-up completed (took {warmup_time:.2f}s)", flush=True)
            log_resource_usage("WARMUP_COMPLETE")
        except Exception as e:
            warmup_time = time.time() - step_start
            print(f"[Semantic Repair ZH] ⚠️  Warm-up failed after {warmup_time:.2f}s (will warm-up on first request): {e}", flush=True)
            import traceback
            traceback.print_exc()
            model_warmed = False
            log_resource_usage("WARMUP_FAILED")
        
        total_startup_time = time.time() - startup_start_time
        print(f"[Semantic Repair ZH] ✅ Service is ready (total startup time: {total_startup_time:.2f}s)", flush=True)
        print(f"[Semantic Repair ZH] 💡  Breakdown: Device setup: {time.time() - startup_start_time:.2f}s, Model load: {model_load_time:.2f}s, Warm-up: {warmup_time:.2f}s", flush=True)
        log_resource_usage("READY")
    except Exception as e:
        total_startup_time = time.time() - startup_start_time
        print(f"[Semantic Repair ZH] [CRITICAL ERROR] Failed to initialize after {total_startup_time:.2f}s: {e}", flush=True)
        import traceback
        traceback.print_exc()
        log_resource_usage("ERROR")
        raise
    
    yield  # 应用运行期间
    
    # ==================== 关闭时执行（优雅关闭） ====================
    try:
        print("[Semantic Repair ZH] ===== Shutting down Semantic Repair Service (Chinese) =====", flush=True)
        print(f"[Semantic Repair ZH] Main process PID: {os.getpid()}", flush=True)
        
        # 清理 llama.cpp 引擎
        if llamacpp_engine is not None:
            print("[Semantic Repair ZH] Cleaning up llama.cpp engine...", flush=True)
            llamacpp_engine.shutdown()
            llamacpp_engine = None
        
        # 强制垃圾回收
        gc.collect()
        
        print("[Semantic Repair ZH] ✅ Graceful shutdown completed", flush=True)
    except Exception as e:
        print(f"[Semantic Repair ZH] ❌ Error during shutdown: {e}", flush=True)
        import traceback
        traceback.print_exc()


# 创建 FastAPI 应用（使用lifespan替代@app.on_event）
app = FastAPI(
    title="Semantic Repair Service - Chinese",
    version="1.0.0",
    lifespan=lifespan
)


# ==================== 辅助：是否确有改善 ====================

def _output_actually_improved(text_in: str, text_out: str) -> bool:
    """仅当输出相对输入确有改善时返回 True（如繁→简、同音字修正），避免未修复也标 REPAIR。"""
    if text_out == text_in:
        return False
    # 常见繁体字（与简体对应），用于判断是否做了繁→简
    trad = set("我們會來說這個們時動識讀語過長斷節練習頂經營解環給誌與於為")
    n_in = sum(1 for c in text_in if c in trad)
    n_out = sum(1 for c in text_out if c in trad)
    if n_in > 0 and n_out >= n_in:
        return False
    return True


# ==================== 请求/响应模型 ====================

class RepairRequest(BaseModel):
    """修复请求"""
    job_id: str
    session_id: str
    utterance_index: int = 0
    lang: str = Field(default="zh", description="语言代码")
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

@app.post("/repair", response_model=RepairResponse)
async def repair_text(request: RepairRequest):
    """
    修复ASR文本
    
    对ASR输出的中文文本进行语义修复，主要解决同音字错误、专有名词误识别等问题。
    """
    global llamacpp_engine, model_warmed
    
    # 检查引擎是否可用
    if llamacpp_engine is None:
        raise HTTPException(status_code=503, detail="Llama.cpp engine not initialized")
    
    # 只处理中文
    if request.lang != "zh":
        return RepairResponse(
            decision="PASS",
            text_out=request.text_in,
            confidence=1.0,
            reason_codes=["NOT_CHINESE"],
        )
    
    # 模型预热（首次调用时）
    if not model_warmed:
        try:
            # llama.cpp 不需要单独的 warm_up，直接使用即可
            model_warmed = True
        except Exception as e:
            print(f"[Semantic Repair ZH] Warm-up failed: {e}", flush=True)
    
    start_time = time.time()
    
    # 记录输入（任务链日志）- 同时使用print确保输出可见
    input_log = (
        f"SEMANTIC_REPAIR_ZH INPUT: Received repair request | "
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
    print(f"[Semantic Repair ZH] {input_log}", flush=True)
    
    try:
        # 执行修复
        result = llamacpp_engine.repair(
            text_in=request.text_in,
            micro_context=request.micro_context,
            quality_score=request.quality_score
        )
        
        elapsed_ms = int((time.time() - start_time) * 1000)

        # 仅当输出与输入不同且确有改善时才标 REPAIR，避免未修复内容被标为已修复
        text_out = result['text_out']
        decision = "PASS"
        if text_out != request.text_in:
            if _output_actually_improved(request.text_in, text_out):
                decision = "REPAIR"
            else:
                text_out = request.text_in
                logger.info(
                    "[Semantic Repair ZH] Output unchanged or not improved (e.g. still traditional), using PASS and original text"
                )
        reason_codes = []

        if request.quality_score is not None and request.quality_score < 0.85:
            reason_codes.append("LOW_QUALITY_SCORE")
        if decision == "REPAIR":
            reason_codes.append("REPAIR_APPLIED")
        
        # 记录输出（任务链日志）- 同时使用print确保输出可见
        output_log = (
            f"SEMANTIC_REPAIR_ZH OUTPUT: Repair completed | "
            f"job_id={request.job_id} | "
            f"session_id={request.session_id} | "
            f"utterance_index={request.utterance_index} | "
            f"decision={decision} | "
            f"text_out={text_out!r} | "
            f"text_out_length={len(text_out)} | "
            f"confidence={result['confidence']:.2f} | "
            f"reason_codes={reason_codes} | "
            f"repair_time_ms={elapsed_ms} | "
            f"changed={text_out != request.text_in}"
        )
        logger.info(output_log)
        print(f"[Semantic Repair ZH] {output_log}", flush=True)

        return RepairResponse(
            decision=decision,
            text_out=text_out,
            confidence=result['confidence'],
            diff=result['diff'],
            reason_codes=reason_codes,
            repair_time_ms=elapsed_ms,
        )
    except Exception as e:
        print(f"[Semantic Repair ZH] Error during repair: {e}", flush=True)
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
    
    model_version = "qwen2.5-3b-instruct-zh-gguf"
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


class DiagnosticsResponse(BaseModel):
    """诊断信息响应"""
    device: str = Field(..., description="设备类型")
    device_name: Optional[str] = Field(default=None, description="设备名称")
    gpu_memory_allocated_gb: Optional[float] = Field(default=None, description="GPU已分配内存(GB)")
    gpu_memory_reserved_gb: Optional[float] = Field(default=None, description="GPU已保留内存(GB)")
    gpu_memory_total_gb: Optional[float] = Field(default=None, description="GPU总内存(GB)")
    engine: Optional[str] = Field(default=None, description="使用的引擎")
    model_path: Optional[str] = Field(default=None, description="模型路径")
    quantization_enabled: bool = Field(default=False, description="是否启用量化")
    process_memory_mb: Optional[float] = Field(default=None, description="进程内存使用(MB)")
    cuda_available: bool = Field(default=False, description="CUDA是否可用")


@app.get("/diagnostics", response_model=DiagnosticsResponse)
async def diagnostics():
    """
    诊断端点
    
    返回详细的诊断信息，包括设备、内存使用等
    """
    global llamacpp_engine, DEVICE, loaded_model_path
    
    diagnostics_data = {
        "device": str(DEVICE) if DEVICE else "unknown",
        "cuda_available": torch.cuda.is_available() if DEVICE and DEVICE.type == "cuda" else False,
    }
    
    # 获取GPU信息
    if DEVICE and DEVICE.type == "cuda" and torch.cuda.is_available():
        try:
            diagnostics_data["device_name"] = torch.cuda.get_device_name(0)
            diagnostics_data["gpu_memory_allocated_gb"] = torch.cuda.memory_allocated() / 1024**3
            diagnostics_data["gpu_memory_reserved_gb"] = torch.cuda.memory_reserved() / 1024**3
            diagnostics_data["gpu_memory_total_gb"] = torch.cuda.get_device_properties(0).total_memory / 1024**3
        except Exception as e:
            print(f"[Semantic Repair ZH] Error getting GPU info: {e}", flush=True)
    
    # 获取 llama.cpp 引擎信息
    if llamacpp_engine is not None:
        try:
            health = llamacpp_engine.health()
            diagnostics_data["engine"] = health.get("engine", "llamacpp")
            diagnostics_data["model_path"] = health.get("model_path", loaded_model_path)
            diagnostics_data["quantization_enabled"] = True  # GGUF 模型总是量化的
        except Exception as e:
            print(f"[Semantic Repair ZH] Error getting engine info: {e}", flush=True)
    
    # 获取进程内存使用
    try:
        import psutil
        process = psutil.Process()
        diagnostics_data["process_memory_mb"] = process.memory_info().rss / 1024 / 1024
    except Exception as e:
        print(f"[Semantic Repair ZH] Error getting process memory: {e}", flush=True)
    
    return DiagnosticsResponse(**diagnostics_data)


# ==================== 主程序入口 ====================

if __name__ == "__main__":
    import uvicorn
    
    # 从环境变量或默认值获取端口
    port = int(os.environ.get("PORT", 5013))
    host = os.environ.get("HOST", "127.0.0.1")
    
    print(f"[Semantic Repair ZH] Starting server on {host}:{port}", flush=True)
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        workers=1,  # 单进程，避免多进程导致的高CPU占用
        loop="asyncio",  # 使用asyncio事件循环
    )
