"""
ASR Worker - 单工人队列架构
实现串行ASR推理，避免并发访问导致崩溃
"""
import asyncio
import logging
import time
import numpy as np
from typing import Optional, Dict, Any
from dataclasses import dataclass

from models import asr_model
from config import CONTEXT_SAMPLE_RATE

logger = logging.getLogger(__name__)

# 队列配置
QUEUE_MAX = 3  # 队列最大长度
MAX_WAIT_SECONDS = 30.0  # 最大等待时间（秒）- 增加超时时间，因为transcribe()可能需要较长时间


@dataclass
class ASRTask:
    """ASR任务"""
    audio: np.ndarray
    sample_rate: int
    language: Optional[str]
    task: str
    beam_size: int
    initial_prompt: Optional[str]
    condition_on_previous_text: bool
    trace_id: str
    future: asyncio.Future  # 用于返回结果


@dataclass
class ASRResult:
    """ASR结果"""
    segments: Any  # Faster Whisper segments对象
    info: Any  # Faster Whisper info对象
    error: Optional[str] = None


class ASRWorker:
    """
    ASR Worker - 单工人串行执行transcribe()
    使用asyncio.Queue实现有界队列和背压控制
    """
    
    def __init__(self, queue_max: int = QUEUE_MAX):
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=queue_max)
        self.worker_task: Optional[asyncio.Task] = None
        self.is_running = False
        self.stats = {
            "total_tasks": 0,
            "completed_tasks": 0,
            "failed_tasks": 0,
            "queue_depth": 0,
            "avg_wait_ms": 0.0,
        }
    
    async def start(self):
        """启动Worker"""
        if self.is_running:
            logger.warning("ASR Worker is already running")
            return
        
        self.is_running = True
        self.worker_task = asyncio.create_task(self._worker_loop())
        logger.info("ASR Worker started")
    
    async def stop(self):
        """停止Worker"""
        self.is_running = False
        if self.worker_task:
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass
        logger.info("ASR Worker stopped")
    
    async def _worker_loop(self):
        """Worker主循环 - 串行执行transcribe()"""
        logger.info("ASR Worker loop started")
        
        while self.is_running:
            try:
                # 从队列获取任务（非阻塞，超时0.5秒）
                try:
                    task: ASRTask = await asyncio.wait_for(
                        self.queue.get(),
                        timeout=0.5
                    )
                except asyncio.TimeoutError:
                    continue
                
                # 更新统计
                self.stats["total_tasks"] += 1
                self.stats["queue_depth"] = self.queue.qsize()
                
                # 执行ASR推理（串行）
                # 添加异常处理，防止崩溃导致worker loop退出
                try:
                    result = await self._transcribe_task(task)
                except Exception as e:
                    # 捕获transcribe_task中的任何异常
                    logger.error(
                        f"[{task.trace_id}] ASR Worker: _transcribe_task raised exception: {e}",
                        exc_info=True
                    )
                    result = ASRResult(segments=None, info=None, error=f"Transcribe task error: {str(e)}")
                
                # 设置结果（检查Future状态，避免在已取消的Future上设置结果）
                if task.future.cancelled():
                    logger.warning(
                        f"[{task.trace_id}] ASR task future was cancelled, "
                        f"skipping result setting"
                    )
                    # 仍然需要标记任务完成
                    self.queue.task_done()
                    continue
                
                try:
                    if result.error:
                        self.stats["failed_tasks"] += 1
                        task.future.set_exception(Exception(result.error))
                    else:
                        self.stats["completed_tasks"] += 1
                        task.future.set_result(result)
                except asyncio.InvalidStateError:
                    # Future已经被设置或取消，忽略
                    logger.warning(
                        f"[{task.trace_id}] ASR task future is in invalid state, "
                        f"may have been cancelled or already set"
                    )
                except Exception as e:
                    # 捕获设置结果时的任何异常
                    logger.error(
                        f"[{task.trace_id}] ASR Worker: Error setting result: {e}",
                        exc_info=True
                    )
                
                # 标记任务完成（无论成功或失败）
                try:
                    self.queue.task_done()
                except Exception as e:
                    logger.error(
                        f"[{task.trace_id}] ASR Worker: Error calling task_done: {e}",
                        exc_info=True
                    )
                
            except asyncio.CancelledError:
                logger.info("ASR Worker loop cancelled")
                break
            except Exception as e:
                logger.error(f"ASR Worker loop error: {e}", exc_info=True)
                # 如果任务存在，设置异常（检查Future状态）
                if 'task' in locals() and task:
                    if not task.future.cancelled():
                        try:
                            task.future.set_exception(e)
                        except asyncio.InvalidStateError:
                            logger.warning(
                                f"[{task.trace_id}] ASR task future is in invalid state, "
                                f"may have been cancelled or already set"
                            )
    
    async def _transcribe_task(self, task: ASRTask) -> ASRResult:
        """
        执行ASR推理任务
        注意：根据推荐设计，worker loop本身就在后台任务中运行，
        可以直接调用同步的transcribe()，不需要asyncio.to_thread()
        因为worker loop是串行的，不会阻塞其他请求
        """
        try:
            logger.info(
                f"[{task.trace_id}] ASR Worker: Starting transcribe, "
                f"audio_len={len(task.audio)}, language={task.language}"
            )
            
            # 直接调用同步的transcribe()（worker loop已经在后台任务中，不会阻塞事件循环）
            # 使用asyncio.to_thread()反而可能增加开销和延迟
            segments, info = await asyncio.to_thread(
                self._transcribe_sync,
                task.audio,
                task.sample_rate,
                task.language,
                task.task,
                task.beam_size,
                task.initial_prompt,
                task.condition_on_previous_text,
                task.trace_id
            )
            
            # 获取segments数量（segments已经是SegmentsWrapper，直接使用）
            # 避免再次转换，防止崩溃
            if hasattr(segments, 'segments_list'):
                segments_count = len(segments.segments_list)
            elif hasattr(segments, '__len__'):
                segments_count = len(segments)
            else:
                # 如果无法获取长度，设为0，避免再次转换导致崩溃
                segments_count = 0
            
            logger.info(
                f"[{task.trace_id}] ASR Worker: Transcribe completed, "
                f"segments={segments_count}"
            )
            
            return ASRResult(segments=segments, info=info)
            
        except Exception as e:
            logger.error(
                f"[{task.trace_id}] ASR Worker: Transcribe failed: {e}",
                exc_info=True
            )
            return ASRResult(segments=None, info=None, error=str(e))
    
    def _transcribe_sync(
        self,
        audio: np.ndarray,
        sample_rate: int,
        language: Optional[str],
        task: str,
        beam_size: int,
        initial_prompt: Optional[str],
        condition_on_previous_text: bool,
        trace_id: str
    ):
        """
        同步执行transcribe()
        注意：这个方法在后台线程中执行，但仍然是串行的（只有一个worker）
        """
        # 在锁内将segments转换为list（避免迭代器线程安全问题）
        transcribe_start = time.time()
        
        segments, info = asr_model.transcribe(
            audio,
            language=language,
            task=task,
            beam_size=beam_size,
            vad_filter=False,  # 我们已经用 Silero VAD 处理过了
            initial_prompt=initial_prompt,
            condition_on_previous_text=condition_on_previous_text,
        )
        
        transcribe_elapsed = time.time() - transcribe_start
        logger.info(
            f"[{trace_id}] ASR Worker: asr_model.transcribe() completed "
            f"(took {transcribe_elapsed:.3f}s), segments_type={type(segments).__name__}"
        )
        
        # 关键修复：在锁内将segments转换为list，避免在锁外访问迭代器导致崩溃
        # 检查segments类型，尝试优化转换方式
        # 添加异常处理，防止转换时崩溃
        list_start = time.time()
        segments_list = []
        
        try:
            # 如果segments已经是list，直接使用
            if isinstance(segments, list):
                segments_list = segments
                logger.info(
                    f"[{trace_id}] ASR Worker: segments is already a list (count={len(segments_list)})"
                )
            elif hasattr(segments, '__len__') and not hasattr(segments, '__iter__'):
                # 如果支持len()但不支持迭代，可能是特殊情况
                segments_list = list(segments)
                logger.info(
                    f"[{trace_id}] ASR Worker: Converted segments to list using __len__ (count={len(segments_list)})"
                )
            else:
                # 标准的迭代器转换（可能很慢，也可能崩溃）
                # 使用try-except保护，防止崩溃
                try:
                    segments_list = list(segments)
                    logger.info(
                        f"[{trace_id}] ASR Worker: Converted segments iterator to list (count={len(segments_list)})"
                    )
                except (MemoryError, OSError, RuntimeError) as e:
                    # 捕获可能的内存错误、系统错误或运行时错误
                    logger.error(
                        f"[{trace_id}] ASR Worker: Failed to convert segments to list: {e}",
                        exc_info=True
                    )
                    # 返回空列表，避免后续处理崩溃
                    segments_list = []
                    raise
        except Exception as e:
            # 捕获所有其他异常
            logger.error(
                f"[{trace_id}] ASR Worker: Unexpected error during segments conversion: {e}",
                exc_info=True
            )
            # 返回空列表，避免后续处理崩溃
            segments_list = []
            raise
        
        list_elapsed = time.time() - list_start
        logger.info(
            f"[{trace_id}] ASR Worker: List conversion completed "
            f"(took {list_elapsed:.3f}s, count={len(segments_list)})"
        )
        
        # 返回segments_list和info
        # 注意：我们需要返回一个可以迭代的对象，但已经是list了
        # 为了兼容性，我们返回一个包装对象
        class SegmentsWrapper:
            def __init__(self, segments_list):
                self.segments_list = segments_list
            
            def __iter__(self):
                return iter(self.segments_list)
            
            def __len__(self):
                return len(self.segments_list)
            
            def __getitem__(self, index):
                return self.segments_list[index]
        
        return SegmentsWrapper(segments_list), info
    
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
        max_wait: float = MAX_WAIT_SECONDS
    ) -> ASRResult:
        """
        提交ASR任务到队列
        
        返回:
            ASRResult: ASR结果
        
        异常:
            asyncio.TimeoutError: 等待超时
            asyncio.QueueFull: 队列已满（应该先检查queue.full()）
        """
        # 检查队列是否已满
        if self.queue.full():
            raise asyncio.QueueFull("ASR queue is full")
        
        # 创建Future
        future = asyncio.get_event_loop().create_future()
        
        # 创建任务
        asr_task = ASRTask(
            audio=audio,
            sample_rate=sample_rate,
            language=language,
            task=task,
            beam_size=beam_size,
            initial_prompt=initial_prompt,
            condition_on_previous_text=condition_on_previous_text,
            trace_id=trace_id,
            future=future
        )
        
        # 记录等待开始时间
        wait_start = time.time()
        
        # 提交到队列
        await self.queue.put(asr_task)
        
        # 等待结果（带超时）
        try:
            result = await asyncio.wait_for(future, timeout=max_wait)
            
            # 计算等待时间
            wait_time_ms = (time.time() - wait_start) * 1000
            self.stats["avg_wait_ms"] = (
                (self.stats["avg_wait_ms"] * (self.stats["completed_tasks"] - 1) + wait_time_ms) /
                self.stats["completed_tasks"]
            )
            
            return result
        except asyncio.TimeoutError:
            # 超时：从队列中移除任务（如果还在队列中）
            # 注意：如果任务已经在处理中，我们无法取消它
            logger.warning(
                f"[{trace_id}] ASR task timeout after {max_wait}s, "
                f"queue_depth={self.queue.qsize()}"
            )
            raise
    
    def get_stats(self) -> Dict[str, Any]:
        """获取Worker统计信息"""
        return {
            **self.stats,
            "queue_depth": self.queue.qsize(),
            "is_running": self.is_running,
        }


# 全局ASR Worker实例
_asr_worker: Optional[ASRWorker] = None


def get_asr_worker() -> ASRWorker:
    """获取全局ASR Worker实例"""
    global _asr_worker
    if _asr_worker is None:
        _asr_worker = ASRWorker()
    return _asr_worker


async def start_asr_worker():
    """启动ASR Worker"""
    worker = get_asr_worker()
    await worker.start()


async def stop_asr_worker():
    """停止ASR Worker"""
    global _asr_worker
    if _asr_worker:
        await _asr_worker.stop()
        _asr_worker = None

