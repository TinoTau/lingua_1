"""
方案A：Opus Packet 解码模块
实现 Opus packet 定界传输与节点端直接解码

参考文档：
- PLAN_A_Node_RealTime_Opus_Decoding_Technical_Design.md
- node_opus_decode_reference.py
"""

from __future__ import annotations

import logging
import threading

from opus_ring_buffer import AudioStats, PCM16RingBuffer
from opus_packet_framer import PacketFramer
from opus_decoder import OpusPacketDecoder

logger = logging.getLogger(__name__)

# ---------------------------
# 配置常量
# ---------------------------

SAMPLE_RATE = 16000
CHANNELS = 1

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
# 全局解码器实例池（性能优化：复用解码器，避免每次请求都重建）
# ---------------------------
# 使用线程局部存储，每个线程有独立的解码器实例
# 这样可以避免锁竞争，同时保证线程安全
_thread_local = threading.local()

def _get_or_create_decoder(sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS) -> OpusPacketDecoder:
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

