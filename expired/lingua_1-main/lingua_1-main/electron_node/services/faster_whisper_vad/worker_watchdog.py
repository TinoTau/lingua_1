"""
ASR Worker Manager - Watchdog
监控 Worker 进程健康状态并自动重启
"""
import asyncio
import logging
import time
from typing import Optional

from shared_types import WorkerState

logger = logging.getLogger(__name__)


async def watchdog_loop(
    get_worker_process,
    state_wrapper,
    stats,
    get_is_running,
    start_worker_func
):
    """
    Watchdog 循环：监控 Worker 进程健康状态
    
    Args:
        get_worker_process: 获取 Worker 进程对象的函数
        state_wrapper: Worker 状态包装器（有value属性）
        stats: 统计信息字典（可变对象）
        get_is_running: 获取运行标志的函数
        start_worker_func: 启动 Worker 的函数（异步）
    """
    logger.info("ASR Worker Watchdog started")
    
    last_check_time = time.time()
    consecutive_checks = 0
    
    while get_is_running():
        try:
            await asyncio.sleep(1.0)  # 每秒检查一次
            consecutive_checks += 1
            current_time = time.time()
            
            worker_process = get_worker_process()
            if not worker_process:
                if consecutive_checks % 60 == 0:  # 每分钟记录一次
                    logger.warning("ASR Worker process is None, waiting for initialization...")
                continue
            
            # 检查进程是否存活
            is_alive = worker_process.is_alive()
            worker_pid = worker_process.pid if worker_process else None
            
            # 每 30 秒记录一次健康状态（用于监控）
            if consecutive_checks % 30 == 0:
                logger.debug(
                    f"Watchdog health check: worker_pid={worker_pid}, "
                    f"is_alive={is_alive}, state={state_wrapper.value}, "
                    f"pending_results={stats.get('pending_results', 0)}"
                )
            
            if not is_alive:
                # Worker 进程崩溃
                logger.error("=" * 80)
                logger.error("🚨 ASR Worker process CRASHED detected by Watchdog")
                logger.error(f"   Worker PID: {worker_pid}")
                logger.error(f"   State before crash: {state_wrapper.value}")
                logger.error(f"   Time since last check: {current_time - last_check_time:.2f}s")
                logger.error(f"   Pending results: {stats.get('pending_results', 0)}")
                
                # 尝试获取退出码（如果可用）
                try:
                    exitcode = worker_process.exitcode
                    if exitcode is not None:
                        logger.error(f"   Exit code: {exitcode}")
                        if exitcode < 0:
                            logger.error(f"   Process terminated by signal: {-exitcode}")
                        elif exitcode > 0:
                            logger.error(f"   Process exited with error code: {exitcode}")
                        else:
                            logger.info(f"   Process exited normally (code 0)")
                except Exception as e:
                    logger.warning(f"   Could not get exit code: {e}")
                
                logger.error("=" * 80)
                
                state_wrapper.value = WorkerState.CRASHED.value
                stats["worker_restarts"] = stats.get("worker_restarts", 0) + 1
                
                # 清理失败的进程
                old_pid = worker_pid
                
                # 重启 Worker
                logger.info(f"Attempting to restart ASR Worker process (restart #{stats['worker_restarts']})...")
                try:
                    state_wrapper.value = WorkerState.RESTARTING.value
                    restart_start = time.time()
                    await start_worker_func()
                    restart_elapsed = time.time() - restart_start
                    new_worker_process = get_worker_process()
                    new_pid = new_worker_process.pid if new_worker_process else None
                    logger.info(
                        f"✅ ASR Worker process restarted successfully "
                        f"(old_pid={old_pid}, new_pid={new_pid}, elapsed={restart_elapsed:.2f}s)"
                    )
                except Exception as e:
                    logger.error(
                        f"❌ Failed to restart ASR Worker process: {e}",
                        exc_info=True
                    )
                    state_wrapper.value = WorkerState.CRASHED.value
                    # 继续尝试重启（在下次循环中）
                    await asyncio.sleep(2.0)  # 等待 2 秒后重试
            
            last_check_time = current_time
            
        except asyncio.CancelledError:
            logger.info("ASR Worker Watchdog cancelled")
            break
        except Exception as e:
            logger.error(f"Watchdog loop error: {e}", exc_info=True)
            await asyncio.sleep(1.0)
    
    logger.info("ASR Worker Watchdog stopped")
