"""
ASR Worker Manager - Result Listener
从结果队列读取结果并设置 Future
"""
import asyncio
import logging
import queue
from typing import Optional, Dict

from shared_types import ASRResult, SegmentInfo

logger = logging.getLogger(__name__)


async def result_listener_loop(
    result_queue,
    pending_results: Dict[str, asyncio.Future],
    stats: Dict,
    get_is_running
):
    """
    结果监听器：从结果队列读取结果并设置 Future
    
    Args:
        result_queue: 结果队列
        pending_results: 待处理的结果字典（job_id -> Future）
        stats: 统计信息字典（可变对象）
        get_is_running: 获取运行标志的函数
    """
    logger.info("ASR Worker result listener started")
    
    while get_is_running():
        try:
            # 非阻塞检查结果队列
            try:
                # 先检查队列是否为空（避免阻塞）
                if result_queue.empty():
                    await asyncio.sleep(0.1)  # 短暂等待
                    continue
                
                # 队列不为空，获取结果（使用 get_nowait 或带超时的 get）
                try:
                    result_data = await asyncio.to_thread(
                        lambda: result_queue.get_nowait()
                    )
                except queue.Empty:
                    # 队列为空（可能在检查后又被其他进程取走），继续循环
                    await asyncio.sleep(0.1)
                    continue
                except Exception as e:
                    # 其他异常，记录并继续
                    logger.warning(f"Result queue get_nowait error: {e}")
                    await asyncio.sleep(0.1)
                    continue
            except Exception as e:
                # 超时或队列为空，继续循环
                error_str = str(e).lower()
                if "empty" not in error_str and "timeout" not in error_str:
                    logger.warning(f"Result queue get error: {e}")
                await asyncio.sleep(0.1)  # 短暂等待后继续
                continue
            
            # 处理结果
            job_id = result_data.get("job_id")
            
            # 检查是否是初始化错误
            if job_id == "__init_error__":
                logger.error("=" * 80)
                logger.error("🚨 Worker process initialization failed!")
                logger.error(f"   Error: {result_data.get('error')}")
                logger.error("=" * 80)
                # 通知所有待处理的任务
                for future in list(pending_results.values()):
                    if not future.done():
                        future.set_exception(
                            RuntimeError(f"Worker initialization failed: {result_data.get('error')}")
                        )
                pending_results.clear()
                continue
            
            # 检查是否是 Worker 退出通知
            if job_id == "__worker_exit__":
                logger.warning("=" * 80)
                logger.warning("⚠️  Worker process exit notification received")
                logger.warning(f"   Message: {result_data.get('error')}")
                logger.warning("=" * 80)
                # 通知所有待处理的任务
                for future in list(pending_results.values()):
                    if not future.done():
                        future.set_exception(
                            RuntimeError(f"Worker process exited: {result_data.get('error')}")
                        )
                pending_results.clear()
                # Watchdog 会检测到进程死亡并重启
                continue
            
            # 查找对应的 Future
            future = pending_results.pop(job_id, None)
            if future:
                if result_data.get("error"):
                    # 设置异常
                    future.set_exception(Exception(result_data["error"]))
                    stats["failed_tasks"] = stats.get("failed_tasks", 0) + 1
                else:
                    # 设置结果
                    # 转换 segments 数据
                    segments_raw = result_data.get("segments")
                    segments_list = None
                    if segments_raw:
                        segments_list = [
                            SegmentInfo(
                                text=seg.get("text", ""),
                                start=seg.get("start"),
                                end=seg.get("end"),
                                no_speech_prob=seg.get("no_speech_prob"),
                            )
                            for seg in segments_raw
                        ]
                    
                    result = ASRResult(
                        job_id=job_id,
                        text=result_data.get("text"),
                        language=result_data.get("language"),
                        language_probabilities=result_data.get("language_probabilities"),
                        segments=segments_list,
                        duration_ms=result_data.get("duration_ms", 0),
                        error=None
                    )
                    future.set_result(result)
                    stats["completed_tasks"] = stats.get("completed_tasks", 0) + 1
            else:
                logger.warning(f"Received result for unknown job_id: {job_id}")
            
        except asyncio.CancelledError:
            logger.info("ASR Worker result listener cancelled")
            break
        except Exception as e:
            logger.error(f"Result listener error: {e}", exc_info=True)
            await asyncio.sleep(0.1)
    
    logger.info("ASR Worker result listener stopped")
