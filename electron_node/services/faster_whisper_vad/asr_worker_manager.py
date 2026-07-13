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
from typing import Optional, Dict, Any
from dataclasses import dataclass

from shared_types import WorkerState, ASRResult, SegmentInfo
from worker_watchdog import watchdog_loop
from result_listener import result_listener_loop
from config import MAX_WAIT_SECONDS
from asr_worker_process import asr_worker_process
from asr_readiness import build_readiness_snapshot

logger = logging.getLogger(__name__)

# 队列配置
QUEUE_MAX = 1  # 进程间队列建议使用较小的值（1-2）


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
        self._state = WorkerState.STOPPED
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
            "pending_results": 0,
        }
        
        # 待处理的结果（job_id -> Future）
        self.pending_results: Dict[str, asyncio.Future] = {}

        self.last_error: Optional[Dict[str, Any]] = None
        self._recovery_lock = asyncio.Lock()
        
        # 结果监听任务
        self.result_listener_task: Optional[asyncio.Task] = None
    
    @property
    def state(self):
        """获取状态（用于兼容性）"""
        return self._state
    
    @state.setter
    def state(self, value):
        """设置状态"""
        self._state = value
    
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
        self.is_running = True
        self.result_listener_task = asyncio.create_task(
            result_listener_loop(
                self.result_queue,
                self.pending_results,
                self.stats,
                lambda: self.is_running
            )
        )
        
        # 启动 Watchdog
        # 创建一个状态包装器，用于在watchdog中修改状态
        class StateWrapper:
            def __init__(self, manager):
                self.manager = manager
            @property
            def value(self):
                return self.manager._state.value
            @value.setter
            def value(self, v):
                self.manager._state = WorkerState(v) if isinstance(v, str) else v
        
        state_wrapper = StateWrapper(self)
        self.watchdog_task = asyncio.create_task(
            watchdog_loop(
                lambda: self.worker_process,
                state_wrapper,
                self.stats,
                lambda: self.is_running,
                self._start_worker
            )
        )
        
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
            return self.worker_process
        
        logger.info("Starting ASR Worker process...")
        self._state = WorkerState.STARTING
        
        try:
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
                self._state = WorkerState.CRASHED
                raise RuntimeError("Worker process failed to start")
            
            self._state = WorkerState.RUNNING
            logger.info(f"ASR Worker process started (PID: {self.worker_process.pid})")
            return self.worker_process
            
        except Exception as e:
            logger.error(f"Failed to start ASR Worker process: {e}", exc_info=True)
            self._state = WorkerState.CRASHED
            raise
    
    async def _stop_worker(self, *, discard_task_queue: bool = False):
        """停止 Worker 子进程"""
        if not self.worker_process:
            return
        
        logger.info("Stopping ASR Worker process...")
        if not discard_task_queue:
            self._state = WorkerState.STOPPED
        
        # 发送退出信号（recovery 丢弃队列时不写入，避免阻塞）
        if not discard_task_queue:
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

    def _record_last_error(self, reason: str, trace_id: str = "", **extra: Any) -> None:
        self.last_error = {
            "reason": reason,
            "trace_id": trace_id,
            "timestamp": time.time(),
            **extra,
        }

    def _fail_pending_results(self, message: str) -> None:
        for job_id, future in list(self.pending_results.items()):
            if not future.done():
                future.set_exception(RuntimeError(message))
        self.pending_results.clear()

    async def _recover_worker(self, reason: str, trace_id: str = "") -> None:
        """Timeout / stuck recovery: kill worker, recreate task queue, restart worker."""
        async with self._recovery_lock:
            if self._state == WorkerState.RESTARTING:
                return

            self._record_last_error(reason, trace_id)
            self._state = WorkerState.RESTARTING
            logger.error(
                "[%s] ASR worker recovery triggered: reason=%s queue_depth=%s pending=%s",
                trace_id or "-",
                reason,
                self._read_queue_depth(),
                len(self.pending_results),
            )

            self._fail_pending_results(f"Worker recovery: {reason}")

            await self._stop_worker(discard_task_queue=True)

            self.task_queue = mp.Queue(maxsize=self.queue_max)
            self.stats["worker_restarts"] = self.stats.get("worker_restarts", 0) + 1

            try:
                await self._start_worker()
                logger.info(
                    "[%s] ASR worker recovery complete (restarts=%s queue_depth=%s)",
                    trace_id or "-",
                    self.stats["worker_restarts"],
                    self._read_queue_depth(),
                )
            except Exception as e:
                self._record_last_error("worker_restart_failed", trace_id, error=str(e))
                self._state = WorkerState.CRASHED
                logger.error("ASR worker recovery failed: %s", e, exc_info=True)
                raise

    async def wait_until_accepting(self, max_wait: float = 10.0) -> bool:
        """Wait briefly while worker is restarting (serial batch friendly)."""
        deadline = time.time() + max_wait
        while time.time() < deadline:
            if self._state == WorkerState.RUNNING and not self.is_queue_full():
                return True
            if self._state in (WorkerState.RESTARTING, WorkerState.STARTING):
                await asyncio.sleep(0.2)
                continue
            break
        return self._state == WorkerState.RUNNING and not self.is_queue_full()

    def _read_queue_depth(self) -> int:
        if not self.task_queue:
            return 0
        try:
            return self.task_queue.qsize()
        except Exception:
            return 0

    def _read_queue_full(self) -> bool:
        if not self.task_queue:
            return True
        try:
            return self.task_queue.full()
        except Exception:
            return True

    def get_readiness(self) -> Dict[str, Any]:
        queue_depth = self._read_queue_depth()
        worker_alive = bool(self.worker_process and self.worker_process.is_alive())
        return build_readiness_snapshot(
            manager_running=self.is_running,
            worker_state=self._state,
            worker_process_alive=worker_alive,
            queue_depth=queue_depth,
            queue_max=self.queue_max,
            queue_full_flag=self._read_queue_full(),
            last_error=self.last_error,
        )
    
    
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
        if self._state in (WorkerState.RESTARTING, WorkerState.STARTING):
            if not await self.wait_until_accepting(max_wait=10.0):
                raise RuntimeError("ASR Worker is restarting")

        # 检查 Worker 状态
        if self._state != WorkerState.RUNNING or not self.worker_process or not self.worker_process.is_alive():
            raise RuntimeError("ASR Worker process is not available")
        
        # 检查队列是否已满
        if self.is_queue_full():
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
            self.pending_results.pop(job_id, None)
            self.stats["failed_tasks"] = self.stats.get("failed_tasks", 0) + 1
            logger.warning(
                f"[{trace_id}] ASR task timeout after {max_wait}s, "
                f"queue_depth={self._read_queue_depth()}"
            )
            try:
                await self._recover_worker("task_timeout", trace_id)
            except Exception as recovery_err:
                logger.error(
                    f"[{trace_id}] ASR worker recovery after timeout failed: {recovery_err}",
                    exc_info=True,
                )
            raise
        except Exception as e:
            # 其他异常：清理 Future
            self.pending_results.pop(job_id, None)
            raise
    
    def get_stats(self) -> Dict[str, Any]:
        """获取 Worker Manager 统计信息"""
        queue_depth = self._read_queue_depth()
        readiness = self.get_readiness()
        
        return {
            **self.stats,
            "queue_depth": queue_depth,
            "queue_max": self.queue_max,
            "is_running": self.is_running,
            "worker_state": self._state.value,
            "worker_pid": self.worker_process.pid if (self.worker_process and self.worker_process.is_alive()) else None,
            "pending_results": len(self.pending_results),
            "queue_full": readiness["queue_full"],
            "utterance_ready": readiness["utterance_ready"],
            "worker_accepting_tasks": readiness["worker_accepting_tasks"],
            "last_error": self.last_error,
        }
    
    def is_queue_full(self) -> bool:
        """检查队列是否已满"""
        return self._read_queue_full()

