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

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(log_dir, 'faster-whisper-vad-service.log'), encoding='utf-8')
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

# 信号处理（用于记录主进程退出）
def signal_handler(signum, frame):
    """信号处理器"""
    logger.warning(f"Received signal {signum}, preparing to shutdown...")
    if signum == signal.SIGTERM:
        logger.info("SIGTERM received, graceful shutdown")
    elif signum == signal.SIGINT:
        logger.info("SIGINT received (Ctrl+C), graceful shutdown")
    else:
        logger.warning(f"Unexpected signal {signum} received")

# 注册信号处理器（Windows 上可能不支持所有信号）
try:
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
except (AttributeError, ValueError):
    # Windows 可能不支持某些信号
    logger.debug("Some signals not available on this platform")

# 导入配置和模块
from config import PORT
from api_models import UtteranceRequest, UtteranceResponse, ResetRequest
from api_routes import (
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
