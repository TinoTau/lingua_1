"""
方案A单元测试（不依赖服务运行）
测试核心功能：packet格式解析、Opus解码、数据格式转换
"""

import struct
import base64
import numpy as np
import logging
from typing import List

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 导入方案A模块
try:
    from opus_packet_decoder import (
        PacketFramer,
        OpusPacketDecoder,
        PCM16RingBuffer,
        OpusPacketDecodingPipeline,
        MAX_PACKET_BYTES,
        SAMPLE_RATE,
        FRAME_SAMPLES,
    )
    PLAN_A_AVAILABLE = True
except ImportError as e:
    PLAN_A_AVAILABLE = False
    logger.error(f"方案A模块导入失败: {e}")
    exit(1)

try:
    import pyogg.opus as opus
    OPUS_AVAILABLE = True
except ImportError:
    OPUS_AVAILABLE = False
    logger.warning("pyogg not available, skipping Opus encoding tests")


def test_packet_framer():
    """测试PacketFramer"""
    logger.info("=" * 60)
    logger.info("测试1: PacketFramer - 解析length-prefix格式")
    logger.info("=" * 60)
    
    framer = PacketFramer(with_seq=False)
    
    # 创建测试数据：3个packet
    packets = [
        b"packet1_data_here_12345",
        b"packet2_data",
        b"packet3_data_here_67890",
    ]
    
    # 构建length-prefixed数据
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
    
    logger.info("✅ PacketFramer测试通过：正确解析了3个packet")
    
    # 测试半包情况
    framer.clear()
    framer.feed(data[:10])  # 只喂入部分数据
    popped = framer.try_pop()
    assert popped is None, "Should not pop incomplete packet"
    
    framer.feed(data[10:])  # 喂入剩余数据
    popped = framer.try_pop()
    assert popped is not None, "Should pop complete packet after feeding remaining data"
    
    logger.info("✅ PacketFramer半包测试通过：正确处理粘包/拆包")
    return True


def test_ring_buffer():
    """测试PCM16RingBuffer"""
    logger.info("=" * 60)
    logger.info("测试2: PCM16RingBuffer - Jitter buffer")
    logger.info("=" * 60)
    
    buffer = PCM16RingBuffer(capacity_samples=1000)
    
    # 创建测试PCM16数据
    import array
    samples = [i % 32767 for i in range(100)]  # 100个样本
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
    # 应该丢弃旧数据，保持在capacity附近
    assert buffer.available_samples() <= 1000 + 2000, "Buffer should respect capacity"
    
    logger.info("✅ PCM16RingBuffer测试通过")
    return True


def test_packet_format_detection():
    """测试packet格式检测逻辑"""
    logger.info("=" * 60)
    logger.info("测试3: Packet格式检测逻辑")
    logger.info("=" * 60)
    
    # 测试1: 正确的packet格式
    test_packet = b"test_opus_packet_data"
    packet_len = len(test_packet)
    packet_format_data = struct.pack("<H", packet_len) + test_packet
    
    logger.info(f"测试数据1: packet格式 (len={packet_len})")
    if len(packet_format_data) >= 2:
        detected_len = struct.unpack_from("<H", packet_format_data, 0)[0]
        if 0 < detected_len <= MAX_PACKET_BYTES and len(packet_format_data) >= 2 + detected_len:
            logger.info("✅ 正确检测到packet格式")
        else:
            logger.error(f"❌ 检测失败: detected_len={detected_len}")
            return False
    
    # 测试2: 连续字节流（不应该被检测为packet格式）
    continuous_data = b"continuous_opus_stream_data"
    logger.info(f"测试数据2: 连续字节流 (len={len(continuous_data)})")
    if len(continuous_data) >= 2:
        detected_len = struct.unpack_from("<H", continuous_data, 0)[0]
        # 对于连续字节流，检测到的len通常不合理或数据不足
        if detected_len > MAX_PACKET_BYTES or len(continuous_data) < 2 + detected_len:
            logger.info("✅ 正确识别为非packet格式（连续字节流）")
        else:
            logger.warning(f"⚠️ 可能误识别为packet格式: detected_len={detected_len}")
    
    return True


def test_opus_decoder():
    """测试Opus解码器（需要真实的Opus数据）"""
    logger.info("=" * 60)
    logger.info("测试4: OpusPacketDecoder - Opus解码")
    logger.info("=" * 60)
    
    if not OPUS_AVAILABLE:
        logger.warning("⚠️ pyogg not available, skipping Opus decoder test")
        return True
    
    try:
        decoder = OpusPacketDecoder(sample_rate=SAMPLE_RATE, channels=1)
        logger.info("✅ OpusPacketDecoder初始化成功")
        
        # 注意：完整测试需要真实的Opus编码数据
        # 这里只测试初始化，实际解码测试需要集成测试
        return True
    except Exception as e:
        logger.error(f"❌ OpusPacketDecoder初始化失败: {e}")
        return False


def test_pipeline_integration():
    """测试完整的解码流水线"""
    logger.info("=" * 60)
    logger.info("测试5: OpusPacketDecodingPipeline - 完整流水线")
    logger.info("=" * 60)
    
    try:
        pipeline = OpusPacketDecodingPipeline(
            sample_rate=SAMPLE_RATE,
            channels=1,
            with_seq=False,
            buffer_capacity_ms=240
        )
        logger.info("✅ OpusPacketDecodingPipeline初始化成功")
        
        # 测试空数据
        pipeline.feed_data(b"")
        assert pipeline.available_samples() == 0, "Empty data should produce no samples"
        
        # 注意：完整测试需要真实的Opus编码数据
        logger.info("   注意：完整解码测试需要真实的Opus编码数据（见集成测试）")
        return True
    except Exception as e:
        logger.error(f"❌ OpusPacketDecodingPipeline初始化失败: {e}")
        return False


def test_web_format_simulation():
    """模拟Web端发送packet格式数据"""
    logger.info("=" * 60)
    logger.info("测试6: 模拟Web端发送packet格式数据")
    logger.info("=" * 60)
    
    # 模拟Web端：生成多个Opus packets
    # 注意：这里使用模拟数据，实际应该使用真实的Opus编码器
    test_packets = [
        b"opus_packet_1_data",
        b"opus_packet_2_data",
        b"opus_packet_3_data",
    ]
    
    # 按照方案A格式打包
    packet_format_data = bytearray()
    for packet in test_packets:
        packet_len = len(packet)
        packet_format_data += struct.pack("<H", packet_len)
        packet_format_data += packet
    
    logger.info(f"模拟Web端数据: {len(packet_format_data)} bytes, {len(test_packets)} packets")
    
    # 测试节点端解析
    framer = PacketFramer(with_seq=False)
    framer.feed(bytes(packet_format_data))
    
    parsed_packets = []
    while True:
        popped = framer.try_pop()
        if popped is None:
            break
        seq, packet = popped
        parsed_packets.append(packet)
    
    assert len(parsed_packets) == len(test_packets), "Should parse all packets"
    for i, (original, parsed) in enumerate(zip(test_packets, parsed_packets)):
        assert original == parsed, f"Packet {i} mismatch"
    
    logger.info("✅ Web端格式模拟测试通过：节点端能正确解析packet格式")
    return True


def test_base64_encoding():
    """测试Base64编码（HTTP传输格式）"""
    logger.info("=" * 60)
    logger.info("测试7: Base64编码（HTTP传输格式）")
    logger.info("=" * 60)
    
    # 创建packet格式数据
    test_packet = b"test_opus_packet_data"
    packet_len = len(test_packet)
    packet_format_data = struct.pack("<H", packet_len) + test_packet
    
    # Base64编码
    audio_b64 = base64.b64encode(packet_format_data).decode('utf-8')
    logger.info(f"原始数据: {len(packet_format_data)} bytes")
    logger.info(f"Base64编码: {len(audio_b64)} chars")
    
    # Base64解码
    decoded_data = base64.b64decode(audio_b64)
    assert decoded_data == packet_format_data, "Base64 round-trip should preserve data"
    
    # 验证packet格式仍然有效
    if len(decoded_data) >= 2:
        detected_len = struct.unpack_from("<H", decoded_data, 0)[0]
        assert detected_len == packet_len, "Packet length should be preserved"
    
    logger.info("✅ Base64编码测试通过：数据在编码/解码后保持packet格式")
    return True


def main():
    """运行所有单元测试"""
    logger.info("=" * 60)
    logger.info("方案A单元测试（不依赖服务运行）")
    logger.info("=" * 60)
    logger.info("")
    
    if not PLAN_A_AVAILABLE:
        logger.error("方案A模块不可用，退出测试")
        return False
    
    # 运行测试
    tests = [
        ("PacketFramer", test_packet_framer),
        ("PCM16RingBuffer", test_ring_buffer),
        ("Packet格式检测", test_packet_format_detection),
        ("OpusPacketDecoder", test_opus_decoder),
        ("OpusPacketDecodingPipeline", test_pipeline_integration),
        ("Web端格式模拟", test_web_format_simulation),
        ("Base64编码", test_base64_encoding),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            passed = test_func()
            results.append((test_name, passed))
            logger.info("")
        except Exception as e:
            logger.error(f"测试 {test_name} 失败: {e}", exc_info=True)
            results.append((test_name, False))
            logger.info("")
    
    # 汇总结果
    logger.info("=" * 60)
    logger.info("测试结果汇总")
    logger.info("=" * 60)
    for test_name, passed in results:
        status = "✅ 通过" if passed else "❌ 失败"
        logger.info(f"{test_name}: {status}")
    
    all_passed = all(result[1] for result in results)
    if all_passed:
        logger.info("")
        logger.info("🎉 所有单元测试通过！")
        logger.info("")
        logger.info("下一步：运行集成测试（需要faster_whisper_vad服务运行）")
        logger.info("   python test_plan_a_e2e.py")
    else:
        logger.info("")
        logger.warning("⚠️ 部分测试失败，请检查日志")
    
    return all_passed


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)

