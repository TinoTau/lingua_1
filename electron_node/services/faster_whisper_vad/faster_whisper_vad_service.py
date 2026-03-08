"""
Faster Whisper + Silero VAD Service
整合 ASR 和 VAD 功能，支持上下文缓冲和 Utterance 任务处理
严格按照现有 Rust 实现
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging
import signal
import sys
import traceback
import os
import uvicorn

# Configure logging (必须在导入模块之前，因为导入时可能使用logger)
# 确保 logs 目录存在
log_dir = 'logs'
if not os.path.exists(log_dir):
    os.makedirs(log_dir, exist_ok=True)

log_file = os.path.join(log_dir, 'faster-whisper-vad-service.log')
# 输出日志文件路径（用于调试）
print(f'[ASR Service] Log file path: {os.path.abspath(log_file)}')
print(f'[ASR Service] Log directory: {os.path.abspath(log_dir)}')
print(f'[ASR Service] Current working directory: {os.getcwd()}')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_file, encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# 全局异常处理
def handle_exception(exc_type, exc_value, exc_traceback):
    """全局异常处理器"""
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
        return
    
    logger.critical("=" * 80)
    logger.critical("🚨 Uncaught exception in main process, service may crash")
    logger.critical(f"   Exception type: {exc_type.__name__}")
    logger.critical(f"   Exception value: {exc_value}")
    logger.critical("   Traceback:")
    for line in traceback.format_exception(exc_type, exc_value, exc_traceback):
        logger.critical(f"   {line.rstrip()}")
    logger.critical("=" * 80)
    
    # 调用默认异常处理器
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = handle_exception

# ==================== 进程清理逻辑 ====================
import atexit
import asyncio

_shutdown_initiated = False

def cleanup_worker_manager():
    """清理ASR Worker Manager - 确保子进程正确停止"""
    global _shutdown_initiated
    
    if _shutdown_initiated:
        return
    
    _shutdown_initiated = True
    
    logger.info("=" * 80)
    logger.info("🛑 Cleaning up ASR Worker Manager (signal/atexit handler)")
    logger.info(f"   Main process PID: {os.getpid()}")
    logger.info("=" * 80)
    
    try:
        manager = get_asr_worker_manager()
        
        # 检查是否已有运行中的event loop
        try:
            running_loop = asyncio.get_running_loop()
            # 如果有运行中的loop，说明FastAPI正在处理shutdown
            # 跳过cleanup，让FastAPI的shutdown事件处理
            logger.info("⏭️  Detected running event loop, skipping cleanup (handled by FastAPI shutdown)")
            return
        except RuntimeError:
            # 没有运行中的loop，安全创建新loop
            pass
        
        # 在信号处理器中运行async代码
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(manager.stop())
        loop.close()
        
        logger.info("✅ ASR Worker Manager cleaned up successfully")
    except Exception as e:
        logger.error(f"❌ Failed to cleanup ASR Worker Manager: {e}", exc_info=True)

def signal_handler(signum, frame):
    """信号处理器 - 优雅关闭并清理子进程"""
    logger.warning(f"Received signal {signum}, initiating graceful shutdown...")
    cleanup_worker_manager()
    logger.info("Exiting main process after cleanup...")
    sys.exit(0)

def atexit_handler():
    """退出时清理 - 确保异常退出时也能清理子进程"""
    logger.info("Python process exiting, cleaning up resources via atexit...")
    cleanup_worker_manager()

# 注册信号处理器（Windows 上可能不支持所有信号）
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    logger.info("✅ Signal handlers registered (SIGTERM, SIGINT)")
except (AttributeError, ValueError) as e:
    # Windows 可能不支持某些信号
    logger.warning(f"Failed to register some signal handlers: {e}")

# Windows特殊信号：SIGBREAK (Ctrl+Break)
try:
    if hasattr(signal, 'SIGBREAK'):
        signal.signal(signal.SIGBREAK, signal_handler)
        logger.info("✅ SIGBREAK handler registered (Windows)")
except Exception as e:
    logger.debug(f"Failed to register SIGBREAK: {e}")

# 注册退出清理函数（多层保护）
atexit.register(atexit_handler)
logger.info("✅ atexit cleanup handler registered")
# ==================== 进程清理逻辑结束 ====================

# 导入配置和模块
from config import PORT
from api_models import UtteranceRequest, UtteranceResponse, ResetRequest
from api_routes import (
    get_asr_worker_manager,
    health_check,
    reset_state,
    startup,
    shutdown,
    process_utterance,
)

# ---------------------
# FastAPI App
# ---------------------
app = FastAPI(title="Faster Whisper + Silero VAD Service")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 模型和路由已迁移到 api_models 和 api_routes 模块

# ---------------------
# API Routes
# ---------------------
@app.get("/health")
async def health_check_route():
    """健康检查端点"""
    return await health_check()

@app.post("/reset")
def reset_state_route(req: ResetRequest):
    """重置端点"""
    return reset_state(req)

@app.on_event("startup")
async def startup_event():
    """启动事件"""
    await startup()

@app.on_event("shutdown")
async def shutdown_event():
    """关闭事件"""
    await shutdown()

@app.post("/utterance", response_model=UtteranceResponse)
async def process_utterance_route(req: UtteranceRequest):
    """处理 Utterance 任务"""
    return await process_utterance(req)

# ---------------------
# Main
# ---------------------
if __name__ == "__main__":
    logger.info(f"Starting Faster Whisper + Silero VAD service on port {PORT}...")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
