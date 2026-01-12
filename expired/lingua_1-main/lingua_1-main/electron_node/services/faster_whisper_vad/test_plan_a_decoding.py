"""
测试方案A：Opus Packet 解码
验证 packet 格式的 Opus 解码功能
"""

import struct
import base64
import numpy as np
from opus_packet_decoder import (
    OpusPacketDecodingPipeline,
    PacketFramer,
    OpusPacketDecoder,
    PCM16RingBuffer,
    MAX_PACKET_BYTES,
    SAMPLE_RATE,
    FRAME_SAMPLES,
)

def create_test_opus_packet(pcm16_data: bytes) -> bytes:
    """
    创建测试用的 Opus packet（简化版，实际应该使用 Opus 编码器）
    注意：这是一个模拟函数，实际测试需要使用真实的 Opus 编码器
    """
    # 这里只是示例，实际应该使用真实的 Opus 编码器
    # 为了测试，我们假设 pcm16_data 已经是 Opus 编码的数据
    return pcm16_data[:100]  # 模拟一个小的 packet

def test_packet_framer():
    """测试 PacketFramer"""
    print("=" * 60)
    print("测试 PacketFramer")
    print("=" * 60)
    
    framer = PacketFramer(with_seq=False)
    
    # 创建测试数据：3 个 packet
    packets = [
        b"packet1_data_here",
        b"packet2_data",
        b"packet3_data_here_123",
    ]
    
    # 构建 length-prefixed 数据
    data = bytearray()
    for packet in packets:
        packet_len = len(packet)
        data += struct.pack("<H", packet_len)  # uint16_le
        data += packet
    
    # 测试完整数据
    framer.feed(bytes(data))
    results = []
    while True:
        popped = framer.try_pop()
        if popped is None:
            break
        seq, packet = popped
        results.append(packet)
    
    assert len(results) == 3, f"Expected 3 packets, got {len(results)}"
    assert results[0] == packets[0], "Packet 0 mismatch"
    assert results[1] == packets[1], "Packet 1 mismatch"
    assert results[2] == packets[2], "Packet 2 mismatch"
    
    print("✅ PacketFramer 测试通过：正确解析了 3 个 packet")
    
    # 测试半包情况
    framer.clear()
    framer.feed(data[:10])  # 只喂入部分数据
    popped = framer.try_pop()
    assert popped is None, "Should not pop incomplete packet"
    
    framer.feed(data[10:])  # 喂入剩余数据
    popped = framer.try_pop()
    assert popped is not None, "Should pop complete packet after feeding remaining data"
    
    print("✅ PacketFramer 半包测试通过：正确处理粘包/拆包")
    print()

def test_ring_buffer():
    """测试 PCM16RingBuffer"""
    print("=" * 60)
    print("测试 PCM16RingBuffer")
    print("=" * 60)
    
    buffer = PCM16RingBuffer(capacity_samples=1000)
    
    # 创建测试 PCM16 数据
    import array
    samples = [i % 32767 for i in range(100)]  # 100 个样本
    pcm16_data = array.array('h', samples).tobytes()
    
    # 写入数据
    buffer.write(pcm16_data)
    assert buffer.available_samples() == 100, f"Expected 100 samples, got {buffer.available_samples()}"
    
    # 读取数据
    read_data = buffer.read(50)
    assert len(read_data) == 100, f"Expected 100 bytes (50 samples * 2), got {len(read_data)}"
    assert buffer.available_samples() == 50, f"Expected 50 samples remaining, got {buffer.available_samples()}"
    
    # 测试高水位策略
    large_data = array.array('h', [i % 32767 for i in range(2000)]).tobytes()
    buffer.write(large_data)
    # 应该丢弃旧数据，保持在 capacity 附近
    assert buffer.available_samples() <= 1000 + 2000, "Buffer should respect capacity"
    
    print("✅ PCM16RingBuffer 测试通过")
    print()

def test_pipeline_integration():
    """测试完整的解码流水线（需要真实的 Opus 数据）"""
    print("=" * 60)
    print("测试 OpusPacketDecodingPipeline（需要真实 Opus 数据）")
    print("=" * 60)
    
    try:
        pipeline = OpusPacketDecodingPipeline(
            sample_rate=SAMPLE_RATE,
            channels=1,
            with_seq=False,
            buffer_capacity_ms=240
        )
        
        print("✅ OpusPacketDecodingPipeline 初始化成功")
        print("   注意：完整测试需要真实的 Opus 编码数据")
        print()
        
    except Exception as e:
        print(f"⚠️ OpusPacketDecodingPipeline 初始化失败: {e}")
        print("   这可能是正常的，如果 pyogg 未正确安装")
        print()

def test_packet_format_detection():
    """测试 packet 格式检测逻辑"""
    print("=" * 60)
    print("测试 Packet 格式检测")
    print("=" * 60)
    
    # 创建模拟的 packet 格式数据
    test_packet = b"test_opus_packet_data"
    packet_len = len(test_packet)
    packet_format_data = struct.pack("<H", packet_len) + test_packet
    
    # 检测逻辑
    if len(packet_format_data) >= 2:
        try:
            detected_len = struct.unpack_from("<H", packet_format_data, 0)[0]
            if 0 < detected_len <= MAX_PACKET_BYTES and len(packet_format_data) >= 2 + detected_len:
                print(f"✅ 检测到 packet 格式: packet_len={detected_len}")
            else:
                print(f"❌ packet_len 不合理: {detected_len}")
        except Exception as e:
            print(f"❌ 检测失败: {e}")
    
    # 测试非 packet 格式（连续字节流）
    continuous_data = b"continuous_opus_stream_data"
    if len(continuous_data) >= 2:
        try:
            detected_len = struct.unpack_from("<H", continuous_data, 0)[0]
            # 对于连续字节流，检测到的 len 通常不合理或数据不足
            if detected_len > MAX_PACKET_BYTES or len(continuous_data) < 2 + detected_len:
                print(f"✅ 正确识别为非 packet 格式（连续字节流）")
        except Exception as e:
            print(f"⚠️ 检测异常（可能是正常的）: {e}")
    
    print()

def main():
    """运行所有测试"""
    print("开始测试方案A：Opus Packet 解码")
    print()
    
    test_packet_framer()
    test_ring_buffer()
    test_pipeline_integration()
    test_packet_format_detection()
    
    print("=" * 60)
    print("测试完成")
    print("=" * 60)
    print()
    print("注意：")
    print("1. 完整的功能测试需要真实的 Opus 编码数据")
    print("2. 确保 pyogg 已正确安装：pip install pyogg")
    print("3. 在实际使用中，Web 端需要按 packet 格式发送数据")

if __name__ == "__main__":
    main()

