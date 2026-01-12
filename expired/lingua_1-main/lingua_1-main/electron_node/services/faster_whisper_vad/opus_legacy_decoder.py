"""
Faster Whisper + Silero VAD Service - Opus Legacy Decoder
遗留的连续字节流解码方法（已废弃）

注意：根据问题报告，这种方法从未成功过，这里仅作为最后的尝试。
推荐使用 packet 格式（Plan A）进行可靠的 Opus 解码。
"""
import numpy as np
import logging
import soundfile as sf
import subprocess
import tempfile
import os
from typing import Tuple

logger = logging.getLogger(__name__)


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
