"""
Faster Whisper + Silero VAD Service - Audio Decoder
音频解码功能（支持 Opus、PCM16 等格式）

注意：Pipeline 现在负责 Opus 解码，Faster-Whisper-vad 服务通常只接收 PCM16 格式。
Opus 解码代码保留但已废弃，仅用于向后兼容（如果 Pipeline 解码失败）。
三端之间只使用 Opus 格式传输，Pipeline 负责解码为 PCM16 后发送给 ASR 服务。
"""
import base64
import numpy as np
import soundfile as sf
import io
import logging
import subprocess
import tempfile
import os
from typing import Tuple, Optional

logger = logging.getLogger(__name__)

# 方案A：导入 Opus packet 解码模块
try:
    from opus_packet_decoder import (
        OpusPacketDecodingPipeline,
        MAX_PACKET_BYTES,
    )
    PLAN_A_AVAILABLE = True
except ImportError:
    PLAN_A_AVAILABLE = False
    logger.warning(
        "方案A (Opus packet decoding) not available. "
        "Note: There is no working legacy method for Opus decoding. "
        "Please ensure opus_packet_decoder module is available."
    )

def decode_audio(
    audio_b64: str,
    audio_format: str,
    sample_rate: int,
    trace_id: str
) -> Tuple[np.ndarray, int]:
    """
    解码音频数据
    
    注意：Pipeline 现在负责 Opus 解码，Faster-Whisper-vad 服务通常只接收 PCM16 格式。
    Opus 解码代码保留但已废弃，仅用于向后兼容（如果 Pipeline 解码失败）。
    三端之间只使用 Opus 格式传输，Pipeline 负责解码为 PCM16 后发送给 ASR 服务。
    
    Args:
        audio_b64: Base64编码的音频数据
        audio_format: 音频格式（"pcm16" | "opus" - Opus 已废弃）
        sample_rate: 采样率
        trace_id: 追踪ID（用于日志）
    
    Returns:
        (audio, sample_rate) - 解码后的音频数组和采样率
    """
    # 1. 解码 base64 音频
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception as e:
        logger.error(f"[{trace_id}] Failed to decode base64 audio: {e}")
        raise ValueError(f"Invalid base64 audio: {e}")
    
    # 2. 根据 audio_format 解码音频
    audio = None
    sr = None
    
    if audio_format == "opus":
        # 警告：Opus 解码应该由 Pipeline 完成，这里保留仅用于向后兼容
        logger.warning(
            f"[{trace_id}] ⚠️  DEPRECATED: Received Opus format audio. "
            f"Opus decoding should be handled by Pipeline. "
            f"This is a fallback and may be removed in the future. "
            f"Three-end communication only uses Opus format, Pipeline should decode to PCM16 before sending to ASR."
        )
        audio, sr = decode_opus_audio(audio_bytes, sample_rate, trace_id)
    elif audio_format == "pcm16":
        # PCM16 格式：直接处理原始 PCM16 数据（Pipeline 解码后的格式）
        try:
            import array
            # 将 PCM16 bytes 转换为 int16 array，然后转换为 float32 numpy array
            pcm16_array = array.array('h', audio_bytes)  # int16 little-endian
            audio = np.array(pcm16_array, dtype=np.float32) / 32768.0  # 归一化到 [-1.0, 1.0]
            sr = sample_rate
        except Exception as e:
            logger.error(f"[{trace_id}] Failed to decode PCM16 audio: {e}")
            raise ValueError(f"Invalid PCM16 audio: {e}")
    else:
        # WAV 格式：使用 soundfile 读取（包含文件头）
        try:
            audio, sr = sf.read(io.BytesIO(audio_bytes))
        except Exception as e:
            logger.error(f"[{trace_id}] Failed to read audio file: {e}")
            raise ValueError(f"Invalid audio format: {e}")
    
    # 3. 转换为 float32 和单声道
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    
    if len(audio.shape) > 1:
        audio = np.mean(audio, axis=1).astype(np.float32)
    
    return audio, sr

def decode_opus_audio(
    audio_bytes: bytes,
    sample_rate: int,
    trace_id: str
) -> Tuple[np.ndarray, int]:
    """
    解码 Opus 音频数据
    
    Plan A要求：必须使用packet格式（length-prefixed），没有可用的回退方法
    """
    # Plan A：检测数据是否是 packet 格式（length-prefixed）
    # 检测数据是否是 packet 格式：检查是否有 length-prefix (uint16_le)
    use_packet_format = False
    if PLAN_A_AVAILABLE and len(audio_bytes) >= 2:
        try:
            import struct
            # 检查前两个字节是否是合理的 packet_len
            packet_len = struct.unpack_from("<H", audio_bytes, 0)[0]
            # 如果 packet_len 合理（> 0 且 < MAX_PACKET_BYTES），且数据长度足够包含至少一个 packet
            if 0 < packet_len <= MAX_PACKET_BYTES and len(audio_bytes) >= 2 + packet_len:
                use_packet_format = True
                logger.info(
                    f"[{trace_id}] Detected Opus packet format (Plan A): packet_len={packet_len}, "
                    f"total_bytes={len(audio_bytes)}"
                )
        except Exception as e:
            logger.error(
                f"[{trace_id}] Failed to detect packet format: {e}. "
                f"Plan A requires packet format (length-prefixed)."
            )
    
    if use_packet_format:
        # Plan A：使用 packet 格式解码（唯一可行的方法）
        return decode_opus_packet_format(audio_bytes, sample_rate, trace_id)
    else:
        # Plan A要求：没有可用的回退方法，直接失败
        error_msg = (
            f"Opus data is not in packet format (Plan A required). "
            f"Received {len(audio_bytes)} bytes. "
            f"Plan A requires length-prefixed Opus packets (uint16_le packet_len + packet_bytes). "
            f"There is no working fallback method. "
            f"Please ensure the Web client sends data in Plan A packet format using encodePackets()."
        )
        logger.error(f"[{trace_id}] {error_msg}")
        if len(audio_bytes) >= 10:
            # 记录前10个字节用于调试
            first_10_hex = ' '.join([f'{b:02x}' for b in audio_bytes[:10]])
            logger.error(f"[{trace_id}] First 10 bytes (hex): {first_10_hex}")
        raise ValueError(error_msg)

def decode_opus_packet_format(
    audio_bytes: bytes,
    sample_rate: int,
    trace_id: str
) -> Tuple[np.ndarray, int]:
    """
    使用方案A解码Opus packet格式
    """
    pipeline = None
    try:
        logger.info(f"[{trace_id}] Using Plan A: Opus packet decoding pipeline, input_size={len(audio_bytes)} bytes")
        
        # 验证输入数据
        if not audio_bytes or len(audio_bytes) == 0:
            raise ValueError("Empty audio data")
        
        if len(audio_bytes) < 2:
            raise ValueError(f"Audio data too short: {len(audio_bytes)} bytes (minimum 2 bytes for packet length)")
        
        pipeline = OpusPacketDecodingPipeline(
            sample_rate=sample_rate,
            channels=1,
            with_seq=False,  # 当前 HTTP API 不支持 seq
            buffer_capacity_ms=30000  # 30秒容量，足够容纳长音频（与 opus_packet_decoder.py 中的默认值保持一致）
        )
        
        logger.debug(f"[{trace_id}] Pipeline created, feeding {len(audio_bytes)} bytes")
        
        # 喂入所有数据（添加异常保护）
        # 注意：如果Opus解码在C层面发生segfault，Python的异常处理可能无法捕获
        # 但至少可以捕获Python层面的异常
        try:
            logger.info(f"[{trace_id}] Calling pipeline.feed_data() with {len(audio_bytes)} bytes")
            pipeline.feed_data(audio_bytes)
            logger.info(f"[{trace_id}] pipeline.feed_data() completed successfully")
        except Exception as e:
            logger.error(f"[{trace_id}] Error in pipeline.feed_data(): {e}", exc_info=True)
            # 记录关键信息，以便诊断崩溃
            logger.error(
                f"[{trace_id}] Pipeline feed_data failed: "
                f"input_size={len(audio_bytes)}, "
                f"error_type={type(e).__name__}, "
                f"error={str(e)}"
            )
            raise ValueError(f"Failed to feed data to pipeline: {e}")
        except BaseException as e:
            # 捕获所有异常，包括KeyboardInterrupt、SystemExit等
            logger.critical(
                f"[{trace_id}] 🚨 CRITICAL: Pipeline feed_data raised BaseException: {e}, "
                f"input_size={len(audio_bytes)}, "
                f"error_type={type(e).__name__}",
                exc_info=True
            )
            raise
        
        logger.debug(f"[{trace_id}] Data fed, checking available samples")
        
        # 读取所有解码后的 PCM16 数据
        available_samples = pipeline.available_samples()
        logger.debug(f"[{trace_id}] Available samples: {available_samples}")
        
        if available_samples == 0:
            stats = pipeline.get_stats()
            logger.error(
                f"[{trace_id}] No audio data decoded from Opus packets. "
                f"Stats: total_decoded={stats.total_decoded_samples}, "
                f"decode_fails={stats.decode_fail_total}, "
                f"consecutive_fails={stats.consecutive_decode_fails}"
            )
            raise ValueError("No audio data decoded from Opus packets")
        
        try:
            pcm16_bytes = pipeline.read_pcm16(available_samples)
        except Exception as e:
            logger.error(f"[{trace_id}] Error in pipeline.read_pcm16(): {e}", exc_info=True)
            raise ValueError(f"Failed to read PCM16 data: {e}")
        
        if not pcm16_bytes or len(pcm16_bytes) == 0:
            raise ValueError("Pipeline returned empty PCM16 data")
        
        logger.debug(f"[{trace_id}] Read {len(pcm16_bytes)} bytes of PCM16 data")
        
        # 将 PCM16 bytes 转换为 float32 numpy array
        try:
            import array
            pcm16_array = array.array('h', pcm16_bytes)  # int16
            audio = np.array(pcm16_array, dtype=np.float32) / 32768.0  # 归一化到 [-1.0, 1.0]
            sr = sample_rate
        except Exception as e:
            logger.error(f"[{trace_id}] Error converting PCM16 to numpy array: {e}", exc_info=True)
            raise ValueError(f"Failed to convert PCM16 to numpy array: {e}")
        
        stats = pipeline.get_stats()
        audio_duration_ms = (len(audio) / sr) * 1000
        audio_rms = np.sqrt(np.mean(audio ** 2))
        audio_std = np.std(audio)
        audio_dynamic_range = np.max(audio) - np.min(audio)
        estimated_packets = stats.total_decoded_samples // (sample_rate * 0.02) if stats.total_decoded_samples > 0 else 0
        decode_success_rate = (stats.total_decoded_samples / (stats.total_decoded_samples + stats.decode_fail_total * (sample_rate * 0.02))) * 100 if (stats.total_decoded_samples + stats.decode_fail_total * (sample_rate * 0.02)) > 0 else 0
        
        logger.info(
            f"[{trace_id}] ✅ Successfully decoded Opus packets: "
            f"{len(audio)} samples ({audio_duration_ms:.2f}ms) at {sr}Hz, "
            f"estimated_packets={estimated_packets}, "
            f"decode_fails={stats.decode_fail_total}, "
            f"decode_success_rate={decode_success_rate:.1f}%, "
            f"audio_quality: rms={audio_rms:.4f}, std={audio_std:.4f}, "
            f"dynamic_range={audio_dynamic_range:.4f}, "
            f"min={np.min(audio):.4f}, max={np.max(audio):.4f}"
        )
        
        return audio, sr
        
    except Exception as e:
        # 方案A失败，直接报错（没有可用的回退方法）
        logger.error(
            f"[{trace_id}] Plan A packet decoding failed: {e}. "
            f"Note: There is no working fallback method for Opus decoding. "
            f"Please ensure Web client sends data in packet format (length-prefixed).",
            exc_info=True
        )
        raise ValueError(f"Opus packet decoding failed: {e}. Please ensure audio data is in packet format (length-prefixed).")
    finally:
        # 清理pipeline（如果创建了）
        if pipeline is not None:
            try:
                # 清理decoder资源
                if hasattr(pipeline, 'decoder') and hasattr(pipeline.decoder, '__del__'):
                    # 触发清理（Python会自动调用__del__）
                    del pipeline.decoder
            except Exception as e:
                logger.warning(f"[{trace_id}] Error cleaning up pipeline: {e}")

# decode_opus_continuous_stream 已迁移到 opus_legacy_decoder 模块
# 保留导入以保持向后兼容（如果代码中仍有引用）
try:
    from opus_legacy_decoder import decode_opus_continuous_stream
except ImportError:
    # 如果模块不存在，定义一个占位函数
    def decode_opus_continuous_stream(*args, **kwargs):
        raise NotImplementedError("decode_opus_continuous_stream has been moved to opus_legacy_decoder module")

