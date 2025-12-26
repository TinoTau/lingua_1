"""
ASR Worker Manager - 进程管理和 Watchdog
管理 ASR Worker 子进程，实现自动重启和健康监控
"""
import multiprocessing as mp
import queue
import asyncio
import logging
import time
import numpy as np
import pickle
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)

# 队列配置
QUEUE_MAX = 1  # 进程间队列建议使用较小的值（1-2）
MAX_WAIT_SECONDS = 30.0  # 最大等待时间（秒）


class WorkerState(Enum):
    """Worker 状态"""
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    CRASHED = "crashed"
    RESTARTING = "restarting"


@dataclass
class ASRTask:
    """ASR 任务（用于进程间通信）"""
    job_id: str
    trace_id: str
    audio: bytes  # 序列化的 numpy array
    audio_len: int
    sample_rate: int
    language: Optional[str]
    task: str
    beam_size: int
    initial_prompt: Optional[str]
    condition_on_previous_text: bool
    # 新增：提高准确度的参数
    best_of: Optional[int] = None
    temperature: Optional[float] = None
    patience: Optional[float] = None
    compression_ratio_threshold: Optional[float] = None
    log_prob_threshold: Optional[float] = None
    no_speech_threshold: Optional[float] = None


@dataclass
class SegmentInfo:
    """Segment 信息"""
    text: str
    start: Optional[float] = None  # 开始时间（秒）
    end: Optional[float] = None    # 结束时间（秒）
    no_speech_prob: Optional[float] = None  # 无语音概率（可选）

@dataclass
class ASRResult:
    """ASR 结果"""
    job_id: str
    text: Optional[str] = None
    language: Optional[str] = None
    language_probabilities: Optional[Dict[str, float]] = None  # 新增：语言概率信息（字典：语言代码 -> 概率）
    segments: Optional[List[SegmentInfo]] = None  # 新增：Segment 元数据（包含时间戳）
    duration_ms: int = 0
    error: Optional[str] = None


class ASRWorkerManager:
    """
    ASR Worker 进程管理器
    负责启动、监控和重启 ASR Worker 子进程
    """
    
    def __init__(self, queue_max: int = QUEUE_MAX):
        self.queue_max = queue_max
        self.task_queue: Optional[mp.Queue] = None
        self.result_queue: Optional[mp.Queue] = None
        self.worker_process: Optional[mp.Process] = None
        self.state = WorkerState.STOPPED
        self.watchdog_task: Optional[asyncio.Task] = None
        self.is_running = False
        
        # 统计信息
        self.stats = {
            "total_tasks": 0,
            "completed_tasks": 0,
            "failed_tasks": 0,
            "worker_restarts": 0,
            "queue_depth": 0,
            "avg_wait_ms": 0.0,
        }
        
        # 待处理的结果（job_id -> Future）
        self.pending_results: Dict[str, asyncio.Future] = {}
        
        # 结果监听任务
        self.result_listener_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """启动 Worker Manager"""
        if self.is_running:
            logger.warning("ASR Worker Manager is already running")
            return
        
        logger.info("Starting ASR Worker Manager...")
        
        # 创建进程间队列
        self.task_queue = mp.Queue(maxsize=self.queue_max)
        self.result_queue = mp.Queue()
        
        # 启动 Worker 进程
        await self._start_worker()
        
        # 启动结果监听器
        self.result_listener_task = asyncio.create_task(self._result_listener())
        
        # 启动 Watchdog
        self.is_running = True
        self.watchdog_task = asyncio.create_task(self._watchdog_loop())
        
        logger.info("ASR Worker Manager started")
    
    async def stop(self):
        """停止 Worker Manager"""
        logger.info("Stopping ASR Worker Manager...")
        
        self.is_running = False
        
        # 停止 Watchdog
        if self.watchdog_task:
            self.watchdog_task.cancel()
            try:
                await self.watchdog_task
            except asyncio.CancelledError:
                pass
        
        # 停止结果监听器
        if self.result_listener_task:
            self.result_listener_task.cancel()
            try:
                await self.result_listener_task
            except asyncio.CancelledError:
                pass
        
        # 停止 Worker 进程
        await self._stop_worker()
        
        logger.info("ASR Worker Manager stopped")
    
    async def _start_worker(self):
        """启动 Worker 子进程"""
        if self.worker_process and self.worker_process.is_alive():
            logger.warning("Worker process is already running")
            return
        
        logger.info("Starting ASR Worker process...")
        self.state = WorkerState.STARTING
        
        try:
            # 导入 worker 函数（必须在主进程中导入）
            from asr_worker_process import asr_worker_process
            
            # 创建子进程
            self.worker_process = mp.Process(
                target=asr_worker_process,
                args=(self.task_queue, self.result_queue),
                name="ASRWorkerProcess"
            )
            self.worker_process.start()
            
            # 等待一小段时间，检查进程是否立即崩溃
            await asyncio.sleep(0.5)
            
            if not self.worker_process.is_alive():
                logger.error("Worker process crashed immediately after start")
                self.state = WorkerState.CRASHED
                raise RuntimeError("Worker process failed to start")
            
            self.state = WorkerState.RUNNING
            logger.info(f"ASR Worker process started (PID: {self.worker_process.pid})")
            
        except Exception as e:
            logger.error(f"Failed to start ASR Worker process: {e}", exc_info=True)
            self.state = WorkerState.CRASHED
            raise
    
    async def _stop_worker(self):
        """停止 Worker 子进程"""
        if not self.worker_process:
            return
        
        logger.info("Stopping ASR Worker process...")
        self.state = WorkerState.STOPPED
        
        # 发送退出信号
        try:
            if self.task_queue:
                self.task_queue.put(None)  # None 表示退出信号
        except Exception as e:
            logger.warning(f"Failed to send shutdown signal to worker: {e}")
        
        # 等待进程退出（最多 5 秒）
        try:
            self.worker_process.join(timeout=5.0)
            if self.worker_process.is_alive():
                logger.warning("Worker process did not exit gracefully, terminating...")
                self.worker_process.terminate()
                self.worker_process.join(timeout=2.0)
                if self.worker_process.is_alive():
                    logger.warning("Worker process still alive, killing...")
                    self.worker_process.kill()
                    self.worker_process.join()
        except Exception as e:
            logger.error(f"Error stopping worker process: {e}", exc_info=True)
        
        self.worker_process = None
        logger.info("ASR Worker process stopped")
    
    async def _watchdog_loop(self):
        """Watchdog 循环：监控 Worker 进程健康状态"""
        logger.info("ASR Worker Watchdog started")
        
        last_check_time = time.time()
        consecutive_checks = 0
        
        while self.is_running:
            try:
                await asyncio.sleep(1.0)  # 每秒检查一次
                consecutive_checks += 1
                current_time = time.time()
                
                if not self.worker_process:
                    if consecutive_checks % 60 == 0:  # 每分钟记录一次
                        logger.warning("ASR Worker process is None, waiting for initialization...")
                    continue
                
                # 检查进程是否存活
                is_alive = self.worker_process.is_alive()
                worker_pid = self.worker_process.pid if self.worker_process else None
                
                # 每 30 秒记录一次健康状态（用于监控）
                if consecutive_checks % 30 == 0:
                    logger.debug(
                        f"Watchdog health check: worker_pid={worker_pid}, "
                        f"is_alive={is_alive}, state={self.state.value}, "
                        f"queue_depth={self.task_queue.qsize() if self.task_queue else 0}, "
                        f"pending_results={len(self.pending_results)}"
                    )
                
                if not is_alive:
                    # Worker 进程崩溃
                    logger.error("=" * 80)
                    logger.error("🚨 ASR Worker process CRASHED detected by Watchdog")
                    logger.error(f"   Worker PID: {worker_pid}")
                    logger.error(f"   State before crash: {self.state.value}")
                    logger.error(f"   Time since last check: {current_time - last_check_time:.2f}s")
                    logger.error(f"   Pending results: {len(self.pending_results)}")
                    logger.error(f"   Queue depth: {self.task_queue.qsize() if self.task_queue else 0}")
                    
                    # 尝试获取退出码（如果可用）
                    try:
                        exitcode = self.worker_process.exitcode
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
                    
                    self.state = WorkerState.CRASHED
                    self.stats["worker_restarts"] += 1
                    
                    # 清理失败的进程
                    old_pid = worker_pid
                    self.worker_process = None
                    
                    # 重启 Worker
                    logger.info(f"Attempting to restart ASR Worker process (restart #{self.stats['worker_restarts']})...")
                    try:
                        self.state = WorkerState.RESTARTING
                        restart_start = time.time()
                        await self._start_worker()
                        restart_elapsed = time.time() - restart_start
                        new_pid = self.worker_process.pid if self.worker_process else None
                        logger.info(
                            f"✅ ASR Worker process restarted successfully "
                            f"(old_pid={old_pid}, new_pid={new_pid}, elapsed={restart_elapsed:.2f}s)"
                        )
                    except Exception as e:
                        logger.error(
                            f"❌ Failed to restart ASR Worker process: {e}",
                            exc_info=True
                        )
                        self.state = WorkerState.CRASHED
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
    
    async def _result_listener(self):
        """结果监听器：从结果队列读取结果并设置 Future"""
        logger.info("ASR Worker result listener started")
        
        while self.is_running:
            try:
                # 非阻塞检查结果队列
                # 注意：multiprocessing.Queue 没有异步接口，需要使用线程
                try:
                    # 先检查队列是否为空（避免阻塞）
                    if self.result_queue.empty():
                        await asyncio.sleep(0.1)  # 短暂等待
                        continue
                    
                    # 队列不为空，获取结果（使用 get_nowait 或带超时的 get）
                    try:
                        result_data = await asyncio.to_thread(
                            lambda: self.result_queue.get_nowait()
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
                    for future in list(self.pending_results.values()):
                        if not future.done():
                            future.set_exception(
                                RuntimeError(f"Worker initialization failed: {result_data.get('error')}")
                            )
                    self.pending_results.clear()
                    continue
                
                # 检查是否是 Worker 退出通知
                if job_id == "__worker_exit__":
                    logger.warning("=" * 80)
                    logger.warning("⚠️  Worker process exit notification received")
                    logger.warning(f"   Message: {result_data.get('error')}")
                    logger.warning("=" * 80)
                    # 通知所有待处理的任务
                    for future in list(self.pending_results.values()):
                        if not future.done():
                            future.set_exception(
                                RuntimeError(f"Worker process exited: {result_data.get('error')}")
                            )
                    self.pending_results.clear()
                    # Watchdog 会检测到进程死亡并重启
                    continue
                
                # 查找对应的 Future
                future = self.pending_results.pop(job_id, None)
                if future:
                    if result_data.get("error"):
                        # 设置异常
                        future.set_exception(Exception(result_data["error"]))
                        self.stats["failed_tasks"] += 1
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
                            language_probabilities=result_data.get("language_probabilities"),  # 新增：语言概率信息
                            segments=segments_list,  # 新增：Segment 元数据
                            duration_ms=result_data.get("duration_ms", 0),
                            error=None
                        )
                        future.set_result(result)
                        self.stats["completed_tasks"] += 1
                else:
                    logger.warning(f"Received result for unknown job_id: {job_id}")
                
            except asyncio.CancelledError:
                logger.info("ASR Worker result listener cancelled")
                break
            except Exception as e:
                logger.error(f"Result listener error: {e}", exc_info=True)
                await asyncio.sleep(0.1)
        
        logger.info("ASR Worker result listener stopped")
    
    async def submit_task(
        self,
        audio: np.ndarray,
        sample_rate: int,
        language: Optional[str],
        task: str,
        beam_size: int,
        initial_prompt: Optional[str],
        condition_on_previous_text: bool,
        trace_id: str,
        max_wait: float = MAX_WAIT_SECONDS,
        # 新增：提高准确度的参数
        best_of: Optional[int] = None,
        temperature: Optional[float] = None,
        patience: Optional[float] = None,
        compression_ratio_threshold: Optional[float] = None,
        log_prob_threshold: Optional[float] = None,
        no_speech_threshold: Optional[float] = None,
    ) -> ASRResult:
        """
        提交 ASR 任务到 Worker 进程
        
        Returns:
            ASRResult: ASR 结果
            
        Raises:
            asyncio.TimeoutError: 等待超时
            RuntimeError: Worker 进程不可用
        """
        # 检查 Worker 状态
        if self.state != WorkerState.RUNNING or not self.worker_process or not self.worker_process.is_alive():
            raise RuntimeError("ASR Worker process is not available")
        
        # 检查队列是否已满
        if self.task_queue.full():
            raise RuntimeError("ASR queue is full")
        
        # 生成 job_id
        job_id = f"{trace_id}_{int(time.time() * 1000)}"
        
        # 序列化音频数据
        try:
            audio_bytes = pickle.dumps(audio)
        except Exception as e:
            raise RuntimeError(f"Failed to serialize audio data: {e}")
        
        # 创建任务
        asr_task = ASRTask(
            job_id=job_id,
            trace_id=trace_id,
            audio=audio_bytes,
            audio_len=len(audio),
            sample_rate=sample_rate,
            language=language,
            task=task,
            beam_size=beam_size,
            initial_prompt=initial_prompt,
            condition_on_previous_text=condition_on_previous_text,
            best_of=best_of,
            temperature=temperature,
            patience=patience,
            compression_ratio_threshold=compression_ratio_threshold,
            log_prob_threshold=log_prob_threshold,
            no_speech_threshold=no_speech_threshold,
        )
        
        # 创建 Future
        future = asyncio.get_event_loop().create_future()
        self.pending_results[job_id] = future
        
        # 记录等待开始时间
        wait_start = time.time()
        
        # 提交到队列
        try:
            # 使用线程池执行阻塞的 put 操作
            # 注意：需要传递所有优化参数到 worker 进程
            task_dict = {
                "job_id": job_id,
                "trace_id": trace_id,
                "audio": audio_bytes,
                "audio_len": len(audio),
                "sample_rate": sample_rate,
                "language": language,
                "task": task,
                "beam_size": beam_size,
                "initial_prompt": initial_prompt,
                "condition_on_previous_text": condition_on_previous_text,
            }
            # 添加优化参数（如果提供）
            if best_of is not None:
                task_dict["best_of"] = best_of
            if temperature is not None:
                task_dict["temperature"] = temperature
            if patience is not None:
                task_dict["patience"] = patience
            if compression_ratio_threshold is not None:
                task_dict["compression_ratio_threshold"] = compression_ratio_threshold
            if log_prob_threshold is not None:
                task_dict["log_prob_threshold"] = log_prob_threshold
            if no_speech_threshold is not None:
                task_dict["no_speech_threshold"] = no_speech_threshold
            
            await asyncio.to_thread(self.task_queue.put, task_dict)
        except Exception as e:
            # 清理 Future
            self.pending_results.pop(job_id, None)
            raise RuntimeError(f"Failed to submit task to queue: {e}")
        
        self.stats["total_tasks"] += 1
        
        # 等待结果（带超时）
        try:
            result = await asyncio.wait_for(future, timeout=max_wait)
            
            # 计算等待时间
            wait_time_ms = (time.time() - wait_start) * 1000
            if self.stats["completed_tasks"] > 0:
                self.stats["avg_wait_ms"] = (
                    (self.stats["avg_wait_ms"] * (self.stats["completed_tasks"] - 1) + wait_time_ms) /
                    self.stats["completed_tasks"]
                )
            else:
                self.stats["avg_wait_ms"] = wait_time_ms
            
            return result
            
        except asyncio.TimeoutError:
            # 超时：清理 Future
            self.pending_results.pop(job_id, None)
            logger.warning(
                f"[{trace_id}] ASR task timeout after {max_wait}s, "
                f"queue_depth={self.task_queue.qsize()}"
            )
            raise
        except Exception as e:
            # 其他异常：清理 Future
            self.pending_results.pop(job_id, None)
            raise
    
    def get_stats(self) -> Dict[str, Any]:
        """获取 Worker Manager 统计信息"""
        queue_depth = 0
        if self.task_queue:
            try:
                queue_depth = self.task_queue.qsize()
            except Exception:
                pass
        
        return {
            **self.stats,
            "queue_depth": queue_depth,
            "is_running": self.is_running,
            "worker_state": self.state.value,
            "worker_pid": self.worker_process.pid if (self.worker_process and self.worker_process.is_alive()) else None,
            "pending_results": len(self.pending_results),
        }
    
    def is_queue_full(self) -> bool:
        """检查队列是否已满"""
        if not self.task_queue:
            return True
        try:
            return self.task_queue.full()
        except Exception:
            return True

