"""
Faster Whisper + Silero VAD Service - Audio Decoder
音频解码功能（支持 Opus、PCM16 等格式）
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
    
    Args:
        audio_b64: Base64编码的音频数据
        audio_format: 音频格式（"pcm16" | "opus"）
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
        audio, sr = decode_opus_audio(audio_bytes, sample_rate, trace_id)
    else:
        # 默认：PCM16/WAV 格式
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

def decode_opus_continuous_stream(
    audio_bytes: bytes,
    sample_rate: int,
    trace_id: str
) -> Tuple[np.ndarray, int]:
    """
    尝试解码连续字节流格式的Opus数据（已知存在问题的方法）
    
    注意：根据问题报告，这种方法从未成功过，这里仅作为最后的尝试
    """
    try:
        logger.info(f"[{trace_id}] Attempting to decode Opus audio with ffmpeg: {len(audio_bytes)} bytes, sample_rate={sample_rate}")
        
        # 创建临时文件保存 Opus 数据
        with tempfile.NamedTemporaryFile(delete=False, suffix='.opus') as tmp_input:
            tmp_input.write(audio_bytes)
            tmp_input_path = tmp_input.name
        
        # 创建临时文件保存解码后的 PCM 数据
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_output:
            tmp_output_path = tmp_output.name
        
        try:
            # 优先使用 ffmpeg 解码（用户要求）
            # ffmpeg 无法直接解码原始 Opus 帧（无容器），需要先包装成 Ogg 容器
            # 策略：
            # 1. 先尝试使用 ffmpeg 的 -f opus 参数（某些版本可能支持）
            # 2. 如果失败，尝试使用 opusenc 将原始 Opus 帧包装成 Ogg 容器，然后使用 ffmpeg 解码
            # 3. 如果 opusenc 不可用，回退到 pyogg 直接解码
            
            audio = None
            sr = None
            
            # 获取 ffmpeg 二进制路径
            ffmpeg_binary = os.environ.get('FFMPEG_BINARY', 'ffmpeg')
            if ffmpeg_binary != 'ffmpeg' and os.path.exists(ffmpeg_binary):
                ffmpeg_cmd_base = [ffmpeg_binary]
            else:
                ffmpeg_cmd_base = ['ffmpeg']
            
            # 方法1：尝试使用 ffmpeg 直接解码（某些版本的 ffmpeg 可能支持）
            logger.info(f"[{trace_id}] Attempting ffmpeg direct decode with -f opus")
            ffmpeg_cmd = ffmpeg_cmd_base + [
                '-f', 'opus',  # 输入格式：原始 Opus 帧
                '-ar', str(sample_rate),  # 输入采样率
                '-ac', '1',  # 单声道
                '-i', tmp_input_path,  # 输入文件
                '-ar', str(sample_rate),  # 输出采样率
                '-ac', '1',  # 单声道
                '-f', 'wav',  # 输出格式：WAV
                '-y',  # 覆盖输出文件
                tmp_output_path  # 输出文件
            ]
            
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                # 成功解码
                audio, sr = sf.read(tmp_output_path)
                logger.info(f"[{trace_id}] Successfully decoded Opus audio with ffmpeg (direct): {len(audio)} samples at {sr}Hz")
            else:
                # 直接解码失败，尝试使用 opusenc 包装成 Ogg 容器
                logger.info(f"[{trace_id}] Direct ffmpeg decode failed: {result.stderr[:200]}, trying opusenc to wrap into Ogg container")
                
                # 创建临时 Ogg 文件
                with tempfile.NamedTemporaryFile(delete=False, suffix='.ogg') as tmp_ogg:
                    tmp_ogg_path = tmp_ogg.name
                
                try:
                    # 尝试使用 opusenc 将原始 Opus 帧包装成 Ogg 容器
                    # opusenc --raw 可以将原始 Opus 数据包装成 Ogg 容器
                    opusenc_cmd = [
                        'opusenc',
                        '--raw',  # 输入是原始 Opus 数据
                        '--raw-rate', str(sample_rate),  # 采样率
                        '--raw-chan', '1',  # 单声道
                        tmp_input_path,  # 输入文件
                        tmp_ogg_path  # 输出 Ogg 文件
                    ]
                    
                    opusenc_result = subprocess.run(
                        opusenc_cmd,
                        capture_output=True,
                        text=True,
                        timeout=30
                    )
                    
                    if opusenc_result.returncode == 0:
                        # 成功包装成 Ogg 容器，使用 ffmpeg 解码
                        logger.info(f"[{trace_id}] Successfully wrapped Opus frames into Ogg container, decoding with ffmpeg")
                        
                        ffmpeg_cmd = ffmpeg_cmd_base + [
                            '-i', tmp_ogg_path,  # 输入 Ogg 文件
                            '-ar', str(sample_rate),  # 输出采样率
                            '-ac', '1',  # 单声道
                            '-f', 'wav',  # 输出格式：WAV
                            '-y',  # 覆盖输出文件
                            tmp_output_path  # 输出文件
                        ]
                        
                        result = subprocess.run(
                            ffmpeg_cmd,
                            capture_output=True,
                            text=True,
                            timeout=30
                        )
                        
                        if result.returncode == 0:
                            audio, sr = sf.read(tmp_output_path)
                            logger.info(f"[{trace_id}] Successfully decoded Opus audio with ffmpeg (via Ogg container): {len(audio)} samples at {sr}Hz")
                        else:
                            raise ValueError(f"ffmpeg failed to decode Ogg container: {result.stderr[:200]}")
                    else:
                        # opusenc 不可用或失败，回退到 pyogg 直接解码
                        logger.info(f"[{trace_id}] opusenc not available or failed: {opusenc_result.stderr[:200] if opusenc_result.stderr else 'not found'}, falling back to pyogg direct decode")
                        raise FileNotFoundError("opusenc not available")
                
                except FileNotFoundError:
                    # opusenc 不可用，回退到 pyogg 直接解码
                    logger.info(f"[{trace_id}] opusenc not available, falling back to pyogg direct decode")
                    
                    try:
                        import pyogg.opus as opus
                        
                        # 使用 pyogg 直接解码
                        channels = 1
                        decoder_size = opus.opus_decoder_get_size(channels)
                        decoder_state = (opus.c_uchar * decoder_size)()
                        error = opus.opus_decoder_init(
                            opus.cast(opus.pointer(decoder_state), opus.od_p),
                            sample_rate,
                            channels
                        )
                        if error != opus.OPUS_OK:
                            raise ValueError(f"Failed to initialize opus decoder: {opus.opus_strerror(error)}")
                        
                        frame_size = int(sample_rate * 20 / 1000)  # 20ms frame
                        decoded_audio = []
                        offset = 0
                        max_frame_size = 400  # 参考 Rust 实现
                        
                        # 首先尝试解码整个数据块（如果数据是单个帧）
                        try:
                            pcm_buffer = (opus.c_float * frame_size)()
                            pcm_ptr = opus.cast(pcm_buffer, opus.c_float_p)
                            # 将 bytes 转换为 c_uchar 数组
                            audio_array = (opus.c_uchar * len(audio_bytes)).from_buffer_copy(audio_bytes)
                            num_samples = opus.opus_decode_float(
                                opus.cast(opus.pointer(decoder_state), opus.od_p),
                                opus.cast(opus.pointer(audio_array), opus.c_uchar_p),
                                len(audio_bytes),
                                pcm_ptr,
                                frame_size,
                                0
                            )
                            if num_samples > 0:
                                float_data = [pcm_buffer[i] for i in range(num_samples)]
                                decoded_audio.extend(float_data)
                                logger.info(f"[{trace_id}] Decoded entire Opus data as single frame: {len(decoded_audio)} samples")
                        except:
                            # 如果整体解码失败，尝试分帧解码
                            logger.info(f"[{trace_id}] Single frame decode failed, trying frame-by-frame decoding")
                            
                            while offset < len(audio_bytes):
                                remaining = len(audio_bytes) - offset
                                if remaining < 1:
                                    break
                                
                                chunk_size = min(max_frame_size, remaining)
                                chunk = audio_bytes[offset:offset+chunk_size]
                                
                                try:
                                    pcm_buffer = (opus.c_float * frame_size)()
                                    pcm_ptr = opus.cast(pcm_buffer, opus.c_float_p)
                                    # 将 bytes 转换为 c_uchar 数组
                                    chunk_array = (opus.c_uchar * len(chunk)).from_buffer_copy(chunk)
                                    num_samples = opus.opus_decode_float(
                                        opus.cast(opus.pointer(decoder_state), opus.od_p),
                                        opus.cast(opus.pointer(chunk_array), opus.c_uchar_p),
                                        len(chunk),
                                        pcm_ptr,
                                        frame_size,
                                        0
                                    )
                                    if num_samples > 0:
                                        float_data = [pcm_buffer[i] for i in range(num_samples)]
                                        decoded_audio.extend(float_data)
                                        offset += chunk_size
                                    else:
                                        logger.warning(f"[{trace_id}] Failed to decode opus frame at offset {offset}, skipping {chunk_size} bytes")
                                        offset += chunk_size
                                except Exception as e:
                                    logger.warning(f"[{trace_id}] Exception decoding opus frame at offset {offset}: {e}, skipping {chunk_size} bytes")
                                    offset += chunk_size
                        
                        opus.opus_decoder_destroy(opus.cast(opus.pointer(decoder_state), opus.od_p))
                        
                        if len(decoded_audio) == 0:
                            raise ValueError("No audio data decoded from opus")
                        
                        audio = np.array(decoded_audio, dtype=np.float32)
                        sr = sample_rate
                        logger.warning(
                            f"[{trace_id}] Decoded Opus audio with pyogg (continuous byte stream method): {len(audio)} samples at {sr}Hz. "
                            f"Note: This method has known issues and may not work reliably. "
                            f"Recommendation: Use packet format (Plan A) for reliable decoding."
                        )
                    
                    except ImportError:
                        raise ValueError("Neither ffmpeg nor pyogg is available for Opus decoding")
                
                finally:
                    # 清理临时 Ogg 文件
                    try:
                        if 'tmp_ogg_path' in locals() and os.path.exists(tmp_ogg_path):
                            os.unlink(tmp_ogg_path)
                    except:
                        pass
            
            if audio is None or sr is None:
                raise ValueError("Opus decoding failed, no audio data produced")
        
        finally:
            # 清理临时文件
            try:
                os.unlink(tmp_input_path)
            except:
                pass
            try:
                os.unlink(tmp_output_path)
            except:
                pass
        
        return audio, sr
        
    except FileNotFoundError:
        logger.error(f"[{trace_id}] ffmpeg not found. Please ensure ffmpeg is installed and in PATH, or set FFMPEG_BINARY environment variable.")
        raise ValueError("ffmpeg not found. Please install ffmpeg or set FFMPEG_BINARY environment variable.")
    except subprocess.TimeoutExpired:
        logger.error(f"[{trace_id}] ffmpeg decoding timeout")
        raise ValueError("Opus decoding timeout")
    except Exception as e:
        logger.error(
            f"[{trace_id}] Failed to decode Opus audio (continuous byte stream method): {e}. "
            f"This method has known issues and is not reliable. "
            f"Please use packet format (Plan A) for reliable Opus decoding.",
            exc_info=True
        )
        raise ValueError(
            f"Opus decoding failed: {e}. "
            f"The continuous byte stream decoding method has known issues and may not work. "
            f"Please ensure Web client sends Opus data in packet format (length-prefixed) for reliable decoding."
        )

