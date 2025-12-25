"""
node_opus_decode_reference.py

参考实现：方案A（Opus packet 定界 + 节点端直接解码）
- WebSocket binary frame 输入格式：
    [uint16_le packet_len] [packet_bytes] ([uint32_le seq] 可选)
- 输出：PCM16 little-endian bytes（16kHz/mono）

说明：
- 该脚本用于给开发团队作为“结构参考”，不是生产级完整程序。
- 生产环境需接入你们现有的会话管理、鉴权、任务调度、ASR pipeline。

依赖建议：
- Python 3.10+
- websockets (pip install websockets)
- pyogg (pip install pyogg)  (或其它 opus 解码绑定)
"""

from __future__ import annotations

import asyncio
import struct
import time
from dataclasses import dataclass
from typing import Optional, Deque
from collections import deque

try:
    import websockets  # type: ignore
except Exception as e:
    websockets = None  # noqa

# pyogg 示例（你们可替换为其它 Opus decoder）
try:
    from pyogg import OpusDecoder  # type: ignore
except Exception:
    OpusDecoder = None  # type: ignore


# ---------------------------
# 配置
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
# Ring/Jitter Buffer
# ---------------------------

@dataclass
class AudioStats:
    seq: Optional[int] = None
    last_decode_samples: int = 0
    consecutive_decode_fails: int = 0
    buffer_samples: int = 0
    total_decoded_samples: int = 0
    decode_fail_total: int = 0


class PCM16RingBuffer:
    """
    一个简单的 PCM16 ring buffer：
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
                self._samples -= samples  # 这里按“本次读取 samples”扣减（更严谨可按 bytes->samples）
                need_bytes = 0

        return bytes(out)


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
        self._buf += data

    def try_pop(self) -> Optional[tuple[Optional[int], bytes]]:
        header_len = 2 + (4 if self.with_seq else 0)
        if len(self._buf) < header_len:
            return None

        packet_len = struct.unpack_from("<H", self._buf, 0)[0]
        if packet_len == 0 or packet_len > MAX_PACKET_BYTES:
            # 协议错误：直接丢弃缓冲避免卡死（生产建议记录错误并断开/降级）
            self._buf.clear()
            return None

        seq = None
        offset = 2
        if self.with_seq:
            seq = struct.unpack_from("<I", self._buf, 2)[0]
            offset += 4

        total_len = offset + packet_len
        if len(self._buf) < total_len:
            return None

        payload = bytes(self._buf[offset:total_len])
        del self._buf[:total_len]
        return (seq, payload)


# ---------------------------
# Opus 解码
# ---------------------------

class OpusPacketDecoder:
    def __init__(self):
        if OpusDecoder is None:
            raise RuntimeError("pyogg is not available. Install with: pip install pyogg")
        self.decoder = OpusDecoder()
        # pyogg OpusDecoder 的初始化方式在不同版本可能不同，你们需要按实际 API 调整：
        # 常见写法：
        #   self.decoder.set_sampling_frequency(SAMPLE_RATE)
        #   self.decoder.set_channels(CHANNELS)
        #
        # 若 pyogg 版本不同，请以你们环境实际为准。
        if hasattr(self.decoder, "set_sampling_frequency"):
            self.decoder.set_sampling_frequency(SAMPLE_RATE)
        if hasattr(self.decoder, "set_channels"):
            self.decoder.set_channels(CHANNELS)

    def decode(self, opus_packet: bytes) -> bytes:
        """
        返回 PCM16 little-endian bytes.
        注意：frame_size 的含义取决于绑定库：通常是“samples per channel”的上限。
        这里给一个保守上限：允许 20ms/40ms/60ms 的情况。
        """
        # 上限：60ms
        max_frame_samples = FRAME_SAMPLES * 3

        # pyogg 的 decode 通常返回 bytes（PCM16），或返回 array；需按你们版本适配。
        pcm = self.decoder.decode(opus_packet, max_frame_samples)
        if pcm is None:
            return b""
        if isinstance(pcm, (bytes, bytearray)):
            return bytes(pcm)

        # 兜底：若返回 list/array of int16
        try:
            import array
            arr = array.array("h", pcm)  # int16
            return arr.tobytes()
        except Exception:
            return b""


# ---------------------------
# 主逻辑：WS 接收 → 解码 → buffer
# ---------------------------

async def audio_receive_loop(ws_url: str, with_seq: bool = False) -> None:
    if websockets is None:
        raise RuntimeError("websockets is not available. Install with: pip install websockets")

    framer = PacketFramer(with_seq=with_seq)
    decoder = OpusPacketDecoder()
    ring = PCM16RingBuffer(capacity_samples=TARGET_BUFFER_SAMPLES * 4)  # 给一点余量，防止短时堆积

    stats = AudioStats()

    async with websockets.connect(ws_url, max_size=None) as ws:
        print(f"[INFO] connected: {ws_url}")

        while True:
            msg = await ws.recv()
            if isinstance(msg, str):
                # 生产：可用于控制信令（非音频）
                continue

            framer.feed(msg)

            while True:
                popped = framer.try_pop()
                if popped is None:
                    break

                seq, packet = popped
                stats.seq = seq

                pcm16 = b""
                try:
                    pcm16 = decoder.decode(packet)
                except Exception as e:
                    stats.consecutive_decode_fails += 1
                    stats.decode_fail_total += 1
                    print(f"[WARN] decode exception seq={seq}: {e}")
                    pcm16 = b""

                if not pcm16:
                    stats.consecutive_decode_fails += 1
                    stats.decode_fail_total += 1
                else:
                    stats.consecutive_decode_fails = 0
                    samples = len(pcm16) // 2
                    stats.last_decode_samples = samples
                    stats.total_decoded_samples += samples
                    ring.write(pcm16)

                stats.buffer_samples = ring.available_samples()

                if stats.consecutive_decode_fails >= MAX_CONSECUTIVE_DECODE_FAILS:
                    # 生产建议：触发降级（通知 Web 切 PCM16）或重建 decoder
                    print(f"[ERROR] consecutive decode fails >= {MAX_CONSECUTIVE_DECODE_FAILS}, seq={seq}")
                    # demo：重置计数
                    stats.consecutive_decode_fails = 0

            # demo：每秒输出一次缓冲情况
            # 生产：改为结构化日志/metrics
            #（避免太频繁打印影响性能）
            # ...


async def main():
    # 示例：python node_opus_decode_reference.py ws://127.0.0.1:9001/audio?session=xxx
    import sys
    if len(sys.argv) < 2:
        print("Usage: python node_opus_decode_reference.py <ws_url> [--with-seq]")
        return
    ws_url = sys.argv[1]
    with_seq = "--with-seq" in sys.argv[2:]
    await audio_receive_loop(ws_url, with_seq=with_seq)


if __name__ == "__main__":
    asyncio.run(main())
