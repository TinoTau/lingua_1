"""
Opus Packet Framer 模块
实现 Opus packet 协议解析（粘包/拆包处理）
"""

import struct
import logging
from typing import Optional

# 安全上限：单个 Opus packet 最大字节数（防止异常包撑爆内存）
MAX_PACKET_BYTES = 4096

logger = logging.getLogger(__name__)


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
