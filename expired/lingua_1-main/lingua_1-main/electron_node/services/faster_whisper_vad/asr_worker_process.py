"""
ASR Worker Process - 独立的子进程模块
在子进程中加载模型并执行 ASR 推理，避免 segfault 影响主进程
"""
import multiprocessing as mp
import logging
import time
import numpy as np
import pickle
from typing import Optional, Dict, Any
import sys
import os

# 导入配置和模型（在文件顶部统一导入）
from config import (
    ASR_MODEL_PATH,
    ASR_DEVICE,
    ASR_COMPUTE_TYPE,
    WHISPER_CACHE_DIR,
)
from faster_whisper import WhisperModel

# 配置日志（子进程需要独立配置）
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def asr_worker_process(task_queue: mp.Queue, result_queue: mp.Queue):
    """
    ASR Worker 子进程主函数
    在子进程中加载模型并串行执行推理
    
    Args:
        task_queue: 任务队列（从主进程接收任务）
        result_queue: 结果队列（向主进程发送结果）
    """
    logger.info("ASR Worker process starting...")
    
    # 在子进程中加载模型（避免 fork 污染）
    try:
        logger.info(f"Loading Faster Whisper model in worker process...")
        logger.info(f"Model path: {ASR_MODEL_PATH}, Device: {ASR_DEVICE}, Compute Type: {ASR_COMPUTE_TYPE}")
        
        model_kwargs = {
            "device": ASR_DEVICE,
            "compute_type": ASR_COMPUTE_TYPE,
        }
        if WHISPER_CACHE_DIR:
            model_kwargs["download_root"] = WHISPER_CACHE_DIR
            logger.info(f"Using model cache directory: {WHISPER_CACHE_DIR}")
        
        try:
            model = WhisperModel(ASR_MODEL_PATH, **model_kwargs)
            logger.info(f"✅ Faster Whisper model loaded successfully in worker process")
        except Exception as e:
            error_str = str(e).lower()
            if ASR_DEVICE == "cuda" and ("float16" in error_str or "compute type" in error_str):
                logger.warning(f"CUDA does not support {ASR_COMPUTE_TYPE}, trying float32 on GPU: {e}")
                fallback_kwargs = {
                    "device": "cuda",
                    "compute_type": "float32",
                }
                if WHISPER_CACHE_DIR:
                    fallback_kwargs["download_root"] = WHISPER_CACHE_DIR
                model = WhisperModel(ASR_MODEL_PATH, **fallback_kwargs)
                logger.info("✅ Faster Whisper model loaded successfully on CUDA with float32 (fallback)")
            else:
                logger.error(f"❌ Failed to load Faster Whisper model: {e}")
                raise
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize ASR model in worker process: {e}", exc_info=True)
        # 通知主进程初始化失败
        result_queue.put({
            "job_id": "__init_error__",
            "error": f"Model initialization failed: {str(e)}",
            "text": None,
            "language": None,
            "duration_ms": 0
        })
        return
    
    logger.info("ASR Worker process ready, waiting for tasks...")
    
    # 主循环：从队列获取任务并处理
    task_count = 0
    error_count = 0
    
    while True:
        try:
            # 从队列获取任务（阻塞等待）
            try:
                task = task_queue.get()
            except Exception as e:
                logger.error(f"Failed to get task from queue: {e}", exc_info=True)
                error_count += 1
                if error_count > 10:
                    logger.error("Too many queue errors, exiting worker process...")
                    break
                time.sleep(0.1)
                continue
            
            # 检查退出信号
            if task is None:
                logger.info("Received shutdown signal, exiting worker process...")
                break
            
            job_id = task.get("job_id")
            trace_id = task.get("trace_id", job_id)
            task_count += 1
            
            logger.info(
                f"[{trace_id}] ASR Worker: Received task, "
                f"audio_len={task.get('audio_len', 0)}, "
                f"language={task.get('language')}"
            )
            
            # 反序列化音频数据
            try:
                audio_bytes = task["audio"]
                audio = pickle.loads(audio_bytes)
                if not isinstance(audio, np.ndarray):
                    raise ValueError(f"Audio data is not numpy array: {type(audio)}")
            except Exception as e:
                logger.error(
                    f"[{trace_id}] ASR Worker: Failed to deserialize audio: {e}",
                    exc_info=True
                )
                result_queue.put({
                    "job_id": job_id,
                    "error": f"Audio deserialization failed: {str(e)}",
                    "text": None,
                    "language": None,
                    "duration_ms": 0
                })
                continue
            
            # 执行 ASR 推理
            transcribe_start = time.time()
            initial_prompt = task.get("initial_prompt")
            condition_on_previous_text = task.get("condition_on_previous_text", False)  # 默认值改为 False，避免重复识别
            
            # 记录 transcribe 调用参数
            logger.info(
                f"[{trace_id}] ========== ASR Worker transcribe() 调用 =========="
            )
            logger.info(
                f"[{trace_id}] transcribe() 参数: "
                f"language={task.get('language')}, "
                f"task={task.get('task', 'transcribe')}, "
                f"beam_size={task.get('beam_size', 10)}, "  # 默认值从 5 改为 10，与 faster_whisper_vad_service.py 保持一致
                f"vad_filter=False, "
                f"has_initial_prompt={initial_prompt is not None and len(initial_prompt) > 0}, "
                f"initial_prompt_length={len(initial_prompt) if initial_prompt else 0}, "
                f"initial_prompt_preview='{initial_prompt[:100] if initial_prompt else '(None)'}', "
                f"condition_on_previous_text={condition_on_previous_text}"
            )
            logger.info(
                f"[{trace_id}] transcribe() 音频参数: "
                f"audio_len={len(audio)}, "
                f"sample_rate={task.get('sample_rate', 16000)}, "
                f"duration_sec={len(audio) / task.get('sample_rate', 16000):.2f}"
            )
            
            try:
                # 获取优化参数（用于提高准确度）
                best_of = task.get("best_of")
                temperature = task.get("temperature")
                patience = task.get("patience")
                compression_ratio_threshold = task.get("compression_ratio_threshold")
                log_prob_threshold = task.get("log_prob_threshold")
                no_speech_threshold = task.get("no_speech_threshold")
                
                # 构建 transcribe 参数
                transcribe_kwargs = {
                    "language": task.get("language"),
                    "task": task.get("task", "transcribe"),
                    "beam_size": task.get("beam_size", 10),  # 默认值从 5 改为 10，与 faster_whisper_vad_service.py 保持一致
                    "vad_filter": False,  # 已经用 Silero VAD 处理过了
                    "initial_prompt": initial_prompt,
                    "condition_on_previous_text": condition_on_previous_text,
                }
                
                # 添加可选参数（如果提供）
                if best_of is not None:
                    transcribe_kwargs["best_of"] = best_of
                if temperature is not None:
                    transcribe_kwargs["temperature"] = temperature
                if patience is not None:
                    transcribe_kwargs["patience"] = patience
                if compression_ratio_threshold is not None:
                    transcribe_kwargs["compression_ratio_threshold"] = compression_ratio_threshold
                if log_prob_threshold is not None:
                    transcribe_kwargs["log_prob_threshold"] = log_prob_threshold
                if no_speech_threshold is not None:
                    transcribe_kwargs["no_speech_threshold"] = no_speech_threshold
                
                segments, info = model.transcribe(audio, **transcribe_kwargs)
                
                transcribe_elapsed = time.time() - transcribe_start
                logger.info(
                    f"[{trace_id}] ASR Worker: transcribe() completed "
                    f"(took {transcribe_elapsed:.3f}s), segments_type={type(segments).__name__}"
                )
                
                # 关键步骤：在子进程内完成 list(segments) 转换
                # 这是可能触发 segfault 的地方，但即使崩溃也只影响子进程
                list_start = time.time()
                segments_list = []
                
                try:
                    # 转换为 list（可能很慢，也可能崩溃）
                    segments_list = list(segments)
                    logger.info(
                        f"[{trace_id}] ASR Worker: Converted segments to list "
                        f"(took {time.time() - list_start:.3f}s, count={len(segments_list)})"
                    )
                except Exception as e:
                    logger.error(
                        f"[{trace_id}] ASR Worker: Failed to convert segments to list: {e}",
                        exc_info=True
                    )
                    # 如果转换失败，返回错误
                    result_queue.put({
                        "job_id": job_id,
                        "error": f"Segments conversion failed: {str(e)}",
                        "text": None,
                        "language": None,
                        "language_probabilities": None,
                        "segments": None,  # 新增
                        "duration_ms": 0
                    })
                    continue
                
                # 提取文本和 Segment 时间戳信息
                text_parts = []
                segments_data = []  # 新增：存储 Segment 元数据
                
                for seg in segments_list:
                    if hasattr(seg, 'text'):
                        text_parts.append(seg.text.strip())
                        # 提取 Segment 时间戳和元数据
                        segment_info = {
                            "text": seg.text.strip(),
                            "start": getattr(seg, 'start', None),  # 开始时间（秒）
                            "end": getattr(seg, 'end', None),      # 结束时间（秒）
                            "no_speech_prob": getattr(seg, 'no_speech_prob', None),  # 无语音概率（可选）
                        }
                        segments_data.append(segment_info)
                    elif isinstance(seg, str):
                        text_parts.append(seg.strip())
                        # 字符串格式的 segment，只保存文本
                        segments_data.append({
                            "text": seg.strip(),
                            "start": None,
                            "end": None,
                            "no_speech_prob": None,
                        })
                
                full_text = " ".join(text_parts)
                
                # 获取语言信息
                detected_language = None
                language_probabilities = None
                
                if info:
                    # 提取 detected_language
                    if hasattr(info, 'language'):
                        detected_language = info.language
                    elif isinstance(info, dict):
                        detected_language = info.get("language")
                    
                    # 提取 language_probabilities（Faster Whisper 可能提供）
                    if hasattr(info, 'language_probabilities'):
                        # language_probabilities 是一个字典，键为语言代码，值为概率
                        lang_probs = info.language_probabilities
                        if lang_probs and isinstance(lang_probs, dict):
                            # 转换为可序列化的字典格式
                            language_probabilities = dict(lang_probs)
                            logger.info(
                                f"[{trace_id}] ASR Worker: Extracted language_probabilities: {language_probabilities}"
                            )
                    elif isinstance(info, dict) and "language_probabilities" in info:
                        language_probabilities = info.get("language_probabilities")
                        if language_probabilities:
                            logger.info(
                                f"[{trace_id}] ASR Worker: Extracted language_probabilities from dict: {language_probabilities}"
                            )
                
                # 计算音频时长
                duration_ms = int((len(audio) / task.get("sample_rate", 16000)) * 1000)
                
                logger.info(
                    f"[{trace_id}] ========== ASR Worker transcribe() 输出结果 =========="
                )
                logger.info(
                    f"[{trace_id}] ASR Worker: Task completed successfully, "
                    f"text_len={len(full_text)}, language={detected_language}, "
                    f"duration_ms={duration_ms}"
                )
                logger.info(
                    f"[{trace_id}] ASR Worker 输出原始文本 (repr): {repr(full_text)}"
                )
                logger.info(
                    f"[{trace_id}] ASR Worker 输出原始文本 (preview): '{full_text[:200]}'"
                )
                logger.info(
                    f"[{trace_id}] ASR Worker 输出原始文本 (bytes): {full_text.encode('utf-8') if full_text else b''}"
                )
                logger.info(
                    f"[{trace_id}] ASR Worker segments 详情: count={len(segments_list)}, "
                    f"segments_texts={[seg.text[:50] if hasattr(seg, 'text') else str(seg)[:50] for seg in segments_list[:5]]}"
                )
                
                # 发送结果到主进程（只返回纯 Python 数据结构）
                result_queue.put({
                    "job_id": job_id,
                    "text": full_text,
                    "language": detected_language,
                    "language_probabilities": language_probabilities,  # 新增：语言概率信息
                    "segments": segments_data,  # 新增：Segment 元数据（包含时间戳）
                    "duration_ms": duration_ms,
                    "error": None
                })
                
            except Exception as e:
                logger.error(
                    f"[{trace_id}] ASR Worker: Transcribe failed: {e}",
                    exc_info=True
                )
                result_queue.put({
                    "job_id": job_id,
                    "error": f"Transcribe failed: {str(e)}",
                    "text": None,
                    "language": None,
                    "language_probabilities": None,
                    "segments": None,  # 新增
                    "duration_ms": 0
                })
                
        except KeyboardInterrupt:
            logger.info("ASR Worker process interrupted by keyboard")
            break
        except SystemExit as e:
            logger.error(f"ASR Worker process received SystemExit: {e}", exc_info=True)
            # 通知主进程
            try:
                result_queue.put({
                    "job_id": "__worker_exit__",
                    "error": f"Worker process exiting: {str(e)}",
                    "text": None,
                    "language": None,
                    "duration_ms": 0
                })
            except Exception:
                pass
            raise  # 重新抛出，让进程正常退出
        except Exception as e:
            error_count += 1
            logger.error(
                f"ASR Worker process error (task_count={task_count}, error_count={error_count}): {e}",
                exc_info=True
            )
            
            # 如果错误太多，退出进程（让 Watchdog 重启）
            if error_count > 50:
                logger.error(
                    f"Too many errors ({error_count}), exiting worker process to trigger restart..."
                )
                break
            
            # 继续运行，不退出进程
            time.sleep(0.1)  # 短暂延迟，避免快速循环
    
    logger.info(
        f"ASR Worker process exiting... "
        f"(processed_tasks={task_count}, errors={error_count})"
    )
    
    # 尝试发送退出通知（如果队列仍然可用）
    try:
        result_queue.put({
            "job_id": "__worker_exit__",
            "error": f"Worker process exiting normally (tasks={task_count}, errors={error_count})",
            "text": None,
            "language": None,
            "duration_ms": 0
        })
    except Exception:
        pass


if __name__ == "__main__":
    # 这个文件可以作为独立脚本运行（用于测试）
    # 但在实际使用中，应该通过 multiprocessing.Process 启动
    logger.info("This module should be run as a subprocess, not directly")
    sys.exit(1)

