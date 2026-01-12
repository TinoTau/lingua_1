"""
Opus 解码器模块
实现 Opus packet 解码核心逻辑
"""

import logging
import threading

try:
    import pyogg.opus as opus
    OPUS_AVAILABLE = True
except ImportError:
    OPUS_AVAILABLE = False
    opus = None  # type: ignore

# 配置常量
SAMPLE_RATE = 16000
CHANNELS = 1

# 推荐 20ms：frame_samples = 16000 * 0.02 = 320
FRAME_MS = 20
FRAME_SAMPLES = int(SAMPLE_RATE * (FRAME_MS / 1000.0))

# 安全上限：单个 Opus packet 最大字节数（防止异常包撑爆内存）
MAX_PACKET_BYTES = 4096

# 全局锁：保护Opus解码器调用（pyogg可能不是线程安全的）
_opus_decode_lock = threading.Lock()

logger = logging.getLogger(__name__)


class OpusPacketDecoder:
    """
    Opus packet 解码器（stateful reuse）
    每个会话应该有一个独立的 decoder 实例
    
    关键修复：添加解码器状态检测和自动重建机制
    - 当发生access violation时，标记解码器为损坏状态
    - 在下次解码前检查状态，如果损坏则自动重建
    """

    def __init__(self, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS):
        if not OPUS_AVAILABLE:
            raise RuntimeError("pyogg is not available. Install with: pip install pyogg")
        
        self.sample_rate = sample_rate
        self.channels = channels
        self._corrupted = False  # 标记解码器是否已损坏
        # 关键修复：预分配缓冲区，避免在C函数调用期间被垃圾回收
        # 最大帧大小：60ms = 960 samples
        self._max_frame_samples = FRAME_SAMPLES * 3
        self._pcm_buffer = None  # 延迟分配，在第一次使用时分配
        self._init_decoder()
        
        logger.info(
            f"OpusPacketDecoder initialized: "
            f"sample_rate={sample_rate} Hz, "
            f"channels={channels}"
        )
    
    def _init_decoder(self):
        """初始化或重建Opus解码器状态"""
        # 关键修复：在锁内创建 Opus 解码器状态，防止并发初始化冲突
        # 虽然每个实例有自己的 decoder_state，但底层 libopus 可能有全局状态
        with _opus_decode_lock:
            # 初始化 Opus decoder
            decoder_size = opus.opus_decoder_get_size(self.channels)
            self.decoder_state = (opus.c_uchar * decoder_size)()
            error = opus.opus_decoder_init(
                opus.cast(opus.pointer(self.decoder_state), opus.od_p),
                self.sample_rate,
                self.channels
            )
            if error != opus.OPUS_OK:
                raise ValueError(f"Failed to initialize opus decoder: {opus.opus_strerror(error)}")
        
        self._corrupted = False
        logger.debug(f"Opus decoder state initialized/rebuilt (decoder_size={decoder_size} bytes)")
    
    def _check_and_rebuild_if_corrupted(self):
        """检查解码器状态，如果损坏则重建"""
        if self._corrupted:
            logger.warning("Opus decoder is corrupted, rebuilding...")
            try:
                # 关键修复：在锁内重建解码器，确保线程安全
                with _opus_decode_lock:
                    self._init_decoder()
                logger.info("Opus decoder rebuilt successfully")
            except Exception as e:
                logger.error(f"Failed to rebuild Opus decoder: {e}", exc_info=True)
                raise RuntimeError(f"Opus decoder is corrupted and cannot be rebuilt: {e}")

    def decode(self, opus_packet: bytes) -> bytes:
        """
        解码单个 Opus packet，返回 PCM16 little-endian bytes.
        注意：frame_size 的含义取决于绑定库：通常是"samples per channel"的上限。
        这里给一个保守上限：允许 20ms/40ms/60ms 的情况。
        """
        if not opus_packet:
            return b""
        
        # 验证packet长度（防止无效数据导致崩溃）
        if len(opus_packet) == 0:
            logger.warning("Empty Opus packet")
            return b""
        
        if len(opus_packet) > MAX_PACKET_BYTES:
            logger.error(f"Opus packet too large: {len(opus_packet)} bytes (max: {MAX_PACKET_BYTES})")
            return b""
        
        # 上限：60ms
        max_frame_samples = FRAME_SAMPLES * 3
        
        try:
            # 关键修复：在解码前检查解码器状态，如果损坏则重建
            self._check_and_rebuild_if_corrupted()
            
            # 验证decoder_state是否有效
            if not hasattr(self, 'decoder_state') or self.decoder_state is None:
                logger.error("Opus decoder state is invalid")
                return b""
            
            # 关键修复：确保缓冲区在C函数调用期间不会被垃圾回收
            # 将缓冲区保存为实例变量，确保生命周期
            # 将 bytes 转换为 c_uchar 数组（使用更安全的方式）
            try:
                # 关键修复：使用实例变量保存audio_array，避免在调用期间被垃圾回收
                self._audio_array = (opus.c_uchar * len(opus_packet)).from_buffer_copy(opus_packet)
            except (ValueError, TypeError, MemoryError) as e:
                logger.error(f"Failed to create audio array from packet: {e}, packet_len={len(opus_packet)}")
                return b""
            
            # 创建或复用 PCM 缓冲区（float32）
            # 关键修复：复用预分配的缓冲区，避免每次创建新缓冲区
            try:
                if self._pcm_buffer is None or len(self._pcm_buffer) < max_frame_samples:
                    # 首次使用或缓冲区不够大，重新分配
                    self._pcm_buffer = (opus.c_float * max_frame_samples)()
                pcm_ptr = opus.cast(self._pcm_buffer, opus.c_float_p)
            except (ValueError, TypeError, MemoryError) as e:
                logger.error(f"Failed to create PCM buffer: {e}")
                return b""
            
            # 解码（添加更多保护）
            # 关键修复：使用全局锁保护opus_decode_float调用，防止并发访问导致内存访问违规
            # pyogg的底层C库（libopus）可能不是线程安全的
            try:
                decoder_ptr = opus.cast(opus.pointer(self.decoder_state), opus.od_p)
                # 关键修复：使用实例变量保存的audio_array，确保指针有效
                audio_ptr = opus.cast(opus.pointer(self._audio_array), opus.c_uchar_p)
                
                # 在锁内执行解码调用
                # 关键修复：确保所有缓冲区（audio_array, pcm_buffer）在调用期间保持有效
                with _opus_decode_lock:
                    num_samples = opus.opus_decode_float(
                        decoder_ptr,
                        audio_ptr,
                        len(opus_packet),
                        pcm_ptr,
                        max_frame_samples,
                        0  # no FEC
                    )
            except (ValueError, TypeError) as e:
                # 参数错误
                logger.error(
                    f"Opus decode_float call failed (parameter error): {e}, "
                    f"packet_len={len(opus_packet)}, "
                    f"max_frame_samples={max_frame_samples}",
                    exc_info=True
                )
                return b""
            except OSError as e:
                # OSError可能包括段错误等底层错误
                error_str = str(e).lower()
                if "access violation" in error_str or "segmentation fault" in error_str or "stack overflow" in error_str:
                    logger.critical(
                        f"🚨 CRITICAL: Opus decode_float access violation/stack overflow detected! "
                        f"packet_len={len(opus_packet)}, "
                        f"max_frame_samples={max_frame_samples}, "
                        f"error={e}"
                    )
                    logger.critical(
                        "This may indicate a memory corruption or thread safety issue. "
                        "The decoder state may be corrupted. Marking decoder as corrupted."
                    )
                    # 关键修复：标记解码器为损坏状态，下次解码时会自动重建
                    self._corrupted = True
                    # 关键修复：立即尝试重建解码器，而不是等到下次调用
                    try:
                        logger.warning("Attempting immediate decoder rebuild after access violation...")
                        # 在锁内重建解码器，确保线程安全
                        with _opus_decode_lock:
                            self._init_decoder()
                        logger.info("Decoder rebuilt successfully after access violation")
                    except Exception as rebuild_e:
                        logger.error(f"Failed to rebuild decoder after access violation: {rebuild_e}", exc_info=True)
                else:
                    logger.error(
                        f"Opus decode_float call failed (OS error): {e}, "
                        f"packet_len={len(opus_packet)}",
                        exc_info=True
                    )
                return b""
            except Exception as e:
                # 捕获所有其他异常
                logger.error(
                    f"Opus decode_float call failed (unexpected error): {e}, "
                    f"packet_len={len(opus_packet)}, "
                    f"error_type={type(e).__name__}",
                    exc_info=True
                )
                return b""
            
            # 验证返回值
            if num_samples <= 0:
                logger.warning(
                    f"Opus decode returned {num_samples} samples (error code: {num_samples}), "
                    f"packet_len={len(opus_packet)} bytes"
                )
                return b""
            
            if num_samples > max_frame_samples:
                logger.error(
                    f"Opus decode returned more samples ({num_samples}) than buffer size ({max_frame_samples}), "
                    f"packet_len={len(opus_packet)} bytes, limiting to buffer size"
                )
                num_samples = max_frame_samples  # 限制到缓冲区大小
            
            # 转换为 PCM16 int16 little-endian bytes
            try:
                import array
                pcm16_array = array.array('h')  # int16
                min_sample = float('inf')
                max_sample = float('-inf')
                # 关键修复：使用实例变量保存的pcm_buffer，确保数据有效
                for i in range(num_samples):
                    # 将 float32 [-1.0, 1.0] 转换为 int16 [-32768, 32767]
                    sample_float = max(-1.0, min(1.0, self._pcm_buffer[i]))
                    sample = int(sample_float * 32767)
                    pcm16_array.append(sample)
                    min_sample = min(min_sample, sample_float)
                    max_sample = max(max_sample, sample_float)
                
                duration_ms = (num_samples / self.sample_rate) * 1000
                dynamic_range = max_sample - min_sample
                logger.debug(
                    f"Opus decode success: packet_len={len(opus_packet)} bytes → "
                    f"{num_samples} samples ({duration_ms:.2f}ms), "
                    f"pcm16_len={len(pcm16_array.tobytes())} bytes, "
                    f"sample_range=[{min_sample:.4f}, {max_sample:.4f}], "
                    f"dynamic_range={dynamic_range:.4f}"
                )
                
                return pcm16_array.tobytes()
            except (ValueError, TypeError, IndexError) as e:
                logger.error(f"Failed to convert PCM buffer to bytes: {e}, num_samples={num_samples}", exc_info=True)
                return b""
            
        except Exception as e:
            logger.error(f"Opus decode exception: {e}, packet_len={len(opus_packet)}", exc_info=True)
            return b""

    def __del__(self):
        """清理资源"""
        if hasattr(self, 'decoder_state') and OPUS_AVAILABLE:
            try:
                # 关键修复：在锁内销毁 Opus 解码器，防止并发销毁冲突
                with _opus_decode_lock:
                    opus.opus_decoder_destroy(opus.cast(opus.pointer(self.decoder_state), opus.od_p))
            except Exception:
                pass  # 忽略清理错误
