"""
Opus Ring Buffer 模块
实现 PCM16 Ring Buffer 和音频统计信息
"""

import logging
from dataclasses import dataclass
from typing import Optional, Deque
from collections import deque

logger = logging.getLogger(__name__)


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
