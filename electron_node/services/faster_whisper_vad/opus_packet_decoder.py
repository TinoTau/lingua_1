"""
方案A：Opus Packet 解码模块
实现 Opus packet 定界传输与节点端直接解码

参考文档：
- PLAN_A_Node_RealTime_Opus_Decoding_Technical_Design.md
- node_opus_decode_reference.py
"""

from __future__ import annotations

import struct
import logging
import threading
from dataclasses import dataclass
from typing import Optional, Deque
from collections import deque

try:
    import pyogg.opus as opus
    OPUS_AVAILABLE = True
except ImportError:
    OPUS_AVAILABLE = False
    opus = None  # type: ignore

logger = logging.getLogger(__name__)

# ---------------------------
# 全局锁：保护Opus解码器调用（pyogg可能不是线程安全的）
# ---------------------------
# pyogg的底层C库（libopus）可能不是线程安全的
# 使用全局锁串行化所有Opus解码调用，防止并发访问导致内存访问违规
_opus_decode_lock = threading.Lock()

# ---------------------------
# 配置（必须在函数定义之前）
# ---------------------------

SAMPLE_RATE = 16000
CHANNELS = 1

# ---------------------------
# 全局解码器实例池（性能优化：复用解码器，避免每次请求都重建）
# ---------------------------
# 使用线程局部存储，每个线程有独立的解码器实例
# 这样可以避免锁竞争，同时保证线程安全
_thread_local = threading.local()

def _get_or_create_decoder(sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS) -> 'OpusPacketDecoder':
    """
    获取或创建线程局部的解码器实例（性能优化）
    每个线程复用同一个解码器实例，避免每次请求都重建
    """
    if not hasattr(_thread_local, 'decoder') or _thread_local.decoder is None:
        _thread_local.decoder = OpusPacketDecoder(sample_rate=sample_rate, channels=channels)
        logger.debug(f"Created new thread-local Opus decoder (thread_id={threading.get_ident()})")
    return _thread_local.decoder

def _reset_thread_local_decoder():
    """重置线程局部的解码器（用于测试或清理）"""
    if hasattr(_thread_local, 'decoder'):
        _thread_local.decoder = None

# 推荐 20ms：frame_samples = 16000 * 0.02 = 320
FRAME_MS = 20
FRAME_SAMPLES = int(SAMPLE_RATE * (FRAME_MS / 1000.0))

# jitter/ring buffer 目标：40–60ms
TARGET_BUFFER_MS = 60
TARGET_BUFFER_SAMPLES = int(SAMPLE_RATE * (TARGET_BUFFER_MS / 1000.0))

# 解码失败阈值：连续 N 次失败触发降级/重建
MAX_CONSECUTIVE_DECODE_FAILS = 3

# 安全上限：单个 Opus packet 最大字节数（防止异常包撑爆内存）
MAX_PACKET_BYTES = 4096


# ---------------------------
# Ring/Jitter Buffer
# ---------------------------

@dataclass
class AudioStats:
    """音频解码统计信息"""
    seq: Optional[int] = None
    last_decode_samples: int = 0
    consecutive_decode_fails: int = 0
    buffer_samples: int = 0
    total_decoded_samples: int = 0
    decode_fail_total: int = 0


class PCM16RingBuffer:
    """
    PCM16 ring buffer：
    - 存储单位：int16 samples（不是 bytes）
    - 写入：bytes -> int16 samples 计数
    - 读出：按指定 samples 数输出 bytes
    """

    def __init__(self, capacity_samples: int):
        self.capacity_samples = capacity_samples
        self._chunks: Deque[bytes] = deque()
        self._samples = 0  # 当前缓存的 samples 数

    @staticmethod
    def _bytes_to_samples(pcm16_bytes: bytes) -> int:
        return len(pcm16_bytes) // 2  # int16

    def write(self, pcm16_bytes: bytes) -> None:
        """写入 PCM16 数据"""
        if not pcm16_bytes:
            return
        n = self._bytes_to_samples(pcm16_bytes)
        self._chunks.append(pcm16_bytes)
        self._samples += n

        # 高水位策略：丢弃最旧数据，避免延迟堆积
        while self._samples > self.capacity_samples:
            oldest = self._chunks.popleft()
            self._samples -= self._bytes_to_samples(oldest)

    def available_samples(self) -> int:
        """返回可用的 samples 数"""
        return self._samples

    def read(self, samples: int) -> bytes:
        """
        读取指定 samples 的 PCM16 bytes。
        若不足，返回已有数据（生产可选择补静音，这里留给上层策略）。
        """
        if samples <= 0 or self._samples <= 0:
            return b""

        need_bytes = samples * 2
        out = bytearray()

        while need_bytes > 0 and self._chunks:
            chunk = self._chunks[0]
            if len(chunk) <= need_bytes:
                out += chunk
                need_bytes -= len(chunk)
                self._chunks.popleft()
                self._samples -= self._bytes_to_samples(chunk)
            else:
                out += chunk[:need_bytes]
                self._chunks[0] = chunk[need_bytes:]
                self._samples -= samples  # 这里按"本次读取 samples"扣减
                need_bytes = 0

        return bytes(out)

    def clear(self) -> None:
        """清空缓冲区"""
        self._chunks.clear()
        self._samples = 0


# ---------------------------
# 协议解析
# ---------------------------

class PacketFramer:
    """
    从 bytes 流里解析：uint16_le len + payload (+ optional uint32_le seq)
    - 实时环境中，WebSocket frame 可能一次携带多个 packet，也可能半包，需要做粘包/拆包。
    """

    def __init__(self, with_seq: bool = False):
        self.with_seq = with_seq
        self._buf = bytearray()

    def feed(self, data: bytes) -> None:
        """喂入数据"""
        self._buf += data

    def try_pop(self) -> Optional[tuple[Optional[int], bytes]]:
        """
        尝试从缓冲区中弹出一个完整的 packet
        返回：(seq, packet_bytes) 或 None（如果数据不足）
        """
        header_len = 2 + (4 if self.with_seq else 0)
        if len(self._buf) < header_len:
            return None

        packet_len = struct.unpack_from("<H", self._buf, 0)[0]
        if packet_len == 0 or packet_len > MAX_PACKET_BYTES:
            # 协议错误：直接丢弃缓冲避免卡死（生产建议记录错误并断开/降级）
            logger.error(f"Invalid packet_len: {packet_len}, clearing buffer")
            self._buf.clear()
            return None

        seq = None
        offset = 2
        if self.with_seq:
            seq = struct.unpack_from("<I", self._buf, 2)[0]
            offset += 4

        total_len = offset + packet_len
        if len(self._buf) < total_len:
            return None  # 数据不足，等待更多数据

        payload = bytes(self._buf[offset:total_len])
        del self._buf[:total_len]
        return (seq, payload)

    def clear(self) -> None:
        """清空缓冲区"""
        self._buf.clear()


# ---------------------------
# Opus 解码
# ---------------------------

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


# ---------------------------
# 解码流水线（组合组件）
# ---------------------------

class OpusPacketDecodingPipeline:
    """
    Opus packet 解码流水线
    组合 PacketFramer、OpusPacketDecoder 和 PCM16RingBuffer
    
    性能优化：复用线程局部的解码器实例，避免每次请求都重建
    - 每个线程有独立的解码器实例（线程安全）
    - 只在解码器损坏时才重建
    - Pipeline每次创建新的（因为需要独立的状态：framer、ring_buffer等）
    """

    def __init__(
        self,
        sample_rate: int = SAMPLE_RATE,
        channels: int = CHANNELS,
        with_seq: bool = False,
        buffer_capacity_ms: int = 30000  # 30秒容量，足够容纳长音频（原来只有240ms太小，导致长音频被丢弃）
    ):
        self.sample_rate = sample_rate
        self.channels = channels
        self.framer = PacketFramer(with_seq=with_seq)
        # 性能优化：复用线程局部的解码器实例，避免每次请求都重建
        self.decoder = _get_or_create_decoder(sample_rate=sample_rate, channels=channels)
        buffer_capacity_samples = int(sample_rate * (buffer_capacity_ms / 1000.0))
        self.ring_buffer = PCM16RingBuffer(capacity_samples=buffer_capacity_samples)
        self.stats = AudioStats()
        logger.info(
            f"OpusPacketDecodingPipeline initialized: "
            f"sample_rate={sample_rate} Hz, "
            f"channels={channels}, "
            f"with_seq={with_seq}, "
            f"buffer_capacity={buffer_capacity_ms}ms ({buffer_capacity_samples} samples)"
        )

    def feed_data(self, data: bytes) -> None:
        """喂入原始数据（可能包含多个 packet 或半包）"""
        try:
            logger.info(f"feed_data: input_size={len(data)} bytes")
            self.framer.feed(data)
            
            # 尝试解析所有完整的 packet
            packet_count = 0
            total_decoded_samples_before = self.stats.total_decoded_samples
            total_decode_fails_before = self.stats.decode_fail_total
            while True:
                try:
                    popped = self.framer.try_pop()
                    if popped is None:
                        break
                    
                    seq, packet = popped
                    packet_count += 1
                    self.stats.seq = seq
                    
                    logger.debug(f"feed_data: popped packet #{packet_count}, seq={seq}, packet_len={len(packet)}")
                    
                    # 验证packet
                    if not packet or len(packet) == 0:
                        logger.warning(f"Empty packet from framer: seq={seq}")
                        continue
                    
                    if len(packet) > MAX_PACKET_BYTES:
                        logger.error(f"Packet too large from framer: seq={seq}, len={len(packet)}")
                        self.stats.consecutive_decode_fails += 1
                        self.stats.decode_fail_total += 1
                        continue
                    
                    # 解码 packet（添加异常保护）
                    logger.debug(f"feed_data: decoding packet #{packet_count}, len={len(packet)}")
                    try:
                        pcm16 = self.decoder.decode(packet)
                        logger.debug(f"feed_data: decoded packet #{packet_count}, pcm16_len={len(pcm16)}")
                    except RuntimeError as e:
                        # 关键修复：如果解码器损坏且无法重建，尝试重建解码器实例
                        if "corrupted" in str(e).lower() or "cannot be rebuilt" in str(e).lower():
                            logger.error(
                                f"Decoder is corrupted and cannot be rebuilt, creating new decoder instance. "
                                f"seq={seq}, packet_len={len(packet)}, error={e}"
                            )
                            try:
                                # 性能优化：重置线程局部解码器，下次获取时会自动创建新的
                                _reset_thread_local_decoder()
                                # 获取新的解码器实例
                                self.decoder = _get_or_create_decoder(sample_rate=self.sample_rate, channels=self.channels)
                                logger.info("New decoder instance created successfully after corruption")
                                # 重试解码（只重试一次）
                                try:
                                    pcm16 = self.decoder.decode(packet)
                                    logger.info(f"Retry decode succeeded after decoder rebuild, pcm16_len={len(pcm16)}")
                                except Exception as retry_e:
                                    logger.error(f"Retry decode failed after decoder rebuild: {retry_e}")
                                    pcm16 = b""
                            except Exception as rebuild_e:
                                logger.error(f"Failed to create new decoder instance: {rebuild_e}", exc_info=True)
                                pcm16 = b""
                        else:
                            logger.error(f"Decoder.decode() raised RuntimeError: {e}, seq={seq}, packet_len={len(packet)}", exc_info=True)
                            pcm16 = b""
                    except Exception as e:
                        logger.error(f"Decoder.decode() raised exception: {e}, seq={seq}, packet_len={len(packet)}", exc_info=True)
                        pcm16 = b""
                    
                    if not pcm16:
                        self.stats.consecutive_decode_fails += 1
                        self.stats.decode_fail_total += 1
                        logger.warning(f"Decode failed: seq={seq}, consecutive_fails={self.stats.consecutive_decode_fails}")
                        
                        # 关键修复：如果连续失败次数过多，主动重建解码器（可能是状态损坏但未触发异常）
                        if self.stats.consecutive_decode_fails >= MAX_CONSECUTIVE_DECODE_FAILS:
                            logger.warning(
                                f"Consecutive decode fails ({self.stats.consecutive_decode_fails}) >= threshold ({MAX_CONSECUTIVE_DECODE_FAILS}), "
                                f"rebuilding decoder to recover from possible corruption"
                            )
                            try:
                                # 尝试重建解码器状态
                                if hasattr(self.decoder, '_init_decoder'):
                                    self.decoder._init_decoder()
                                    logger.info("Decoder state rebuilt successfully")
                                else:
                                    # 如果无法重建，创建新的解码器实例
                                    self.decoder = OpusPacketDecoder(sample_rate=self.sample_rate, channels=self.channels)
                                    logger.info("New decoder instance created after consecutive failures")
                                # 重置连续失败计数
                                self.stats.consecutive_decode_fails = 0
                            except Exception as rebuild_e:
                                logger.error(f"Failed to rebuild decoder after consecutive failures: {rebuild_e}", exc_info=True)
                    else:
                        self.stats.consecutive_decode_fails = 0
                        samples = len(pcm16) // 2
                        self.stats.last_decode_samples = samples
                        self.stats.total_decoded_samples += samples
                        self.ring_buffer.write(pcm16)
                    
                    self.stats.buffer_samples = self.ring_buffer.available_samples()
                    
                    # 每10个packet记录一次统计信息
                    if packet_count % 10 == 0:
                        logger.debug(
                            f"feed_data progress: packets={packet_count}, "
                            f"decoded_samples={self.stats.total_decoded_samples}, "
                            f"decode_fails={self.stats.decode_fail_total}, "
                            f"buffer_samples={self.stats.buffer_samples}"
                        )
                    
                    # 检查是否需要降级
                    if self.stats.consecutive_decode_fails >= MAX_CONSECUTIVE_DECODE_FAILS:
                        logger.error(
                            f"Consecutive decode fails >= {MAX_CONSECUTIVE_DECODE_FAILS}, "
                            f"seq={seq}, total_fails={self.stats.decode_fail_total}, "
                            f"buffer_samples={self.stats.buffer_samples}"
                        )
                        # 生产建议：触发降级（通知 Web 切 PCM16）或重建 decoder
                        # 这里只记录错误，不自动重置（由上层决定）
                        
                        # 记录详细的错误信息用于诊断
                        logger.error(
                            f"OpusPacketDecodingPipeline error details: "
                            f"consecutive_fails={self.stats.consecutive_decode_fails}, "
                            f"total_decoded_samples={self.stats.total_decoded_samples}, "
                            f"decode_fail_rate={self.stats.decode_fail_total / (self.stats.decode_fail_total + self.stats.total_decoded_samples) * 100:.2f}%"
                        )
                except Exception as e:
                    logger.error(f"Error processing packet in feed_data: {e}", exc_info=True)
                    # 继续处理下一个packet，不中断整个流程
                    continue
            
            # 记录本次feed_data的统计信息
            decoded_samples_this_batch = self.stats.total_decoded_samples - total_decoded_samples_before
            decode_fails_this_batch = self.stats.decode_fail_total - total_decode_fails_before
            logger.info(
                f"feed_data completed: processed {packet_count} packets, "
                f"decoded {decoded_samples_this_batch} samples, "
                f"decode_fails={decode_fails_this_batch}, "
                f"total_buffer_samples={self.stats.buffer_samples}"
            )
        except Exception as e:
            logger.error(f"Critical error in feed_data: {e}", exc_info=True)
            # 不抛出异常，避免服务崩溃

    def read_pcm16(self, samples: int) -> bytes:
        """从 ring buffer 读取指定 samples 的 PCM16 数据"""
        return self.ring_buffer.read(samples)

    def available_samples(self) -> int:
        """返回可用的 samples 数"""
        return self.ring_buffer.available_samples()

    def get_stats(self) -> AudioStats:
        """获取统计信息"""
        return self.stats

    def reset(self) -> None:
        """重置流水线状态"""
        self.framer.clear()
        self.ring_buffer.clear()
        self.stats = AudioStats()
        logger.info("OpusPacketDecodingPipeline reset")

