"""
方案A端到端测试
测试：Web端发送packet格式的Opus数据 → 节点端解码 → 返回结果

注意：这是一个模拟测试，使用Python生成Opus数据来模拟Web端
"""

import struct
import base64
import numpy as np
import requests
import json
import time
import logging
from typing import List, Tuple

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 测试配置
FASTER_WHISPER_VAD_URL = "http://127.0.0.1:6007"
SAMPLE_RATE = 16000
CHANNELS = 1
FRAME_MS = 20
FRAME_SAMPLES = int(SAMPLE_RATE * (FRAME_MS / 1000.0))

try:
    import pyogg.opus as opus
    OPUS_AVAILABLE = True
except ImportError:
    OPUS_AVAILABLE = False
    logger.error("pyogg not available. Install with: pip install pyogg")
    exit(1)


def generate_test_audio(duration_sec: float = 1.0, frequency: float = 440.0) -> np.ndarray:
    """
    生成测试音频（正弦波）
    """
    samples = int(SAMPLE_RATE * duration_sec)
    t = np.linspace(0, duration_sec, samples, False)
    audio = np.sin(2 * np.pi * frequency * t).astype(np.float32)
    return audio


def encode_audio_to_opus(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> List[bytes]:
    """
    将音频编码为Opus packets（模拟Web端的Opus编码器）
    返回：List[bytes]，每个元素是一个Opus packet（20ms）
    """
    if not OPUS_AVAILABLE:
        raise RuntimeError("pyogg not available")
    
    # 初始化Opus编码器
    channels = 1
    encoder_size = opus.opus_encoder_get_size(channels)
    encoder_state = (opus.c_uchar * encoder_size)()
    
    error = opus.opus_encoder_init(
        opus.cast(opus.pointer(encoder_state), opus.oe_p),
        sample_rate,
        channels,
        opus.OPUS_APPLICATION_VOIP
    )
    if error != opus.OPUS_OK:
        raise ValueError(f"Failed to initialize opus encoder: {opus.opus_strerror(error)}")
    
    # 设置编码参数（与 Web 端一致：24 kbps for VOIP）
    opus.opus_encoder_ctl(
        opus.cast(opus.pointer(encoder_state), opus.oe_p),
        opus.OPUS_SET_BITRATE_REQUEST,
        24000  # 24 kbps（推荐值，与 Web 端一致）
    )
    
    packets = []
    frame_size = FRAME_SAMPLES  # 20ms
    
    # 按帧编码
    offset = 0
    while offset < len(audio):
        remaining = len(audio) - offset
        current_frame_size = min(frame_size, remaining)
        
        if current_frame_size < frame_size:
            # 填充到完整帧
            frame = np.zeros(frame_size, dtype=np.float32)
            frame[:current_frame_size] = audio[offset:offset + current_frame_size]
        else:
            frame = audio[offset:offset + frame_size]
        
        # 编码帧
        max_packet_size = 4000  # Opus packet最大大小
        packet_buffer = (opus.c_uchar * max_packet_size)()
        packet_ptr = opus.cast(packet_buffer, opus.c_uchar_p)
        
        # 将float32转换为opus需要的格式
        frame_ptr = opus.cast(frame.ctypes.data, opus.c_float_p)
        
        packet_len = opus.opus_encode_float(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            frame_ptr,
            frame_size,
            packet_ptr,
            max_packet_size
        )
        
        if packet_len > 0:
            packet_bytes = bytes(packet_buffer[:packet_len])
            packets.append(packet_bytes)
        
        offset += current_frame_size
    
    # 清理编码器
    opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))
    
    return packets


def create_packet_format_data(packets: List[bytes], with_seq: bool = False) -> bytes:
    """
    创建方案A的packet格式数据
    格式：[uint16_le packet_len] [packet_bytes] ([uint32_le seq] 可选)
    """
    data = bytearray()
    for i, packet in enumerate(packets):
        packet_len = len(packet)
        # packet_len (uint16_le)
        data += struct.pack("<H", packet_len)
        # packet_bytes
        data += packet
        # seq (可选)
        if with_seq:
            data += struct.pack("<I", i)
    
    return bytes(data)


def test_web_to_node_decoding():
    """
    测试：Web端 → 节点端解码
    """
    logger.info("=" * 60)
    logger.info("测试1: Web端发送packet格式的Opus数据 → 节点端解码")
    logger.info("=" * 60)
    
    # 1. 生成测试音频
    logger.info("生成测试音频（1秒，440Hz正弦波）...")
    audio = generate_test_audio(duration_sec=1.0, frequency=440.0)
    logger.info(f"音频生成完成: {len(audio)} samples ({len(audio)/SAMPLE_RATE:.2f}s)")
    
    # 2. 编码为Opus packets
    logger.info("编码为Opus packets（模拟Web端）...")
    opus_packets = encode_audio_to_opus(audio)
    logger.info(f"编码完成: {len(opus_packets)} packets")
    
    # 3. 创建packet格式数据（方案A）
    logger.info("创建packet格式数据（方案A）...")
    packet_format_data = create_packet_format_data(opus_packets, with_seq=False)
    logger.info(f"Packet格式数据: {len(packet_format_data)} bytes")
    
    # 4. Base64编码（模拟HTTP传输）
    logger.info("Base64编码...")
    audio_b64 = base64.b64encode(packet_format_data).decode('utf-8')
    logger.info(f"Base64长度: {len(audio_b64)} chars")
    
    # 5. 发送到节点端
    logger.info("发送到faster_whisper_vad服务...")
    request_data = {
        "job_id": f"test_plan_a_{int(time.time())}",
        "src_lang": "zh",
        "tgt_lang": "zh",
        "audio": audio_b64,
        "audio_format": "opus",
        "sample_rate": SAMPLE_RATE,
        "task": "transcribe",
        "beam_size": 5,
        "condition_on_previous_text": True,
        "use_context_buffer": True,
        "use_text_context": True,
    }
    
    try:
        response = requests.post(
            f"{FASTER_WHISPER_VAD_URL}/utterance",
            json=request_data,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        
        logger.info("✅ 节点端解码成功！")
        logger.info(f"   识别文本: {result.get('text', '')}")
        logger.info(f"   语言: {result.get('language', 'unknown')}")
        logger.info(f"   时长: {result.get('duration', 0):.2f}s")
        logger.info(f"   VAD段数: {len(result.get('vad_segments', []))}")
        
        return True
        
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ 请求失败: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"   响应内容: {e.response.text}")
        return False
    except Exception as e:
        logger.error(f"❌ 测试失败: {e}", exc_info=True)
        return False


def test_legacy_format_compatibility():
    """
    测试：向后兼容性（连续字节流格式）
    """
    logger.info("=" * 60)
    logger.info("测试2: 向后兼容性（连续字节流格式）")
    logger.info("=" * 60)
    
    # 1. 生成测试音频
    logger.info("生成测试音频...")
    audio = generate_test_audio(duration_sec=0.5, frequency=440.0)
    
    # 2. 编码为Opus（连续字节流，不按packet格式）
    logger.info("编码为Opus（连续字节流）...")
    opus_packets = encode_audio_to_opus(audio)
    # 直接连接所有packets，不添加length-prefix
    continuous_data = b''.join(opus_packets)
    
    # 3. Base64编码
    audio_b64 = base64.b64encode(continuous_data).decode('utf-8')
    
    # 4. 发送到节点端
    logger.info("发送到faster_whisper_vad服务（旧格式）...")
    request_data = {
        "job_id": f"test_legacy_{int(time.time())}",
        "src_lang": "zh",
        "audio": audio_b64,
        "audio_format": "opus",
        "sample_rate": SAMPLE_RATE,
        "task": "transcribe",
        "beam_size": 5,
        "condition_on_previous_text": True,
        "use_context_buffer": True,
        "use_text_context": True,
    }
    
    try:
        response = requests.post(
            f"{FASTER_WHISPER_VAD_URL}/utterance",
            json=request_data,
            timeout=30
        )
        response.raise_for_status()
        result = response.json()
        
        logger.info("✅ 向后兼容性测试通过（使用旧格式解码）")
        logger.info(f"   识别文本: {result.get('text', '')}")
        return True
        
    except Exception as e:
        logger.error(f"❌ 向后兼容性测试失败: {e}", exc_info=True)
        return False


def test_packet_format_detection():
    """
    测试：packet格式检测逻辑
    """
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
        if 0 < detected_len <= 4000 and len(packet_format_data) >= 2 + detected_len:
            logger.info("✅ 正确检测到packet格式")
        else:
            logger.error(f"❌ 检测失败: detected_len={detected_len}")
    
    # 测试2: 连续字节流（不应该被检测为packet格式）
    continuous_data = b"continuous_opus_stream_data"
    logger.info(f"测试数据2: 连续字节流 (len={len(continuous_data)})")
    if len(continuous_data) >= 2:
        detected_len = struct.unpack_from("<H", continuous_data, 0)[0]
        # 对于连续字节流，检测到的len通常不合理或数据不足
        if detected_len > 4000 or len(continuous_data) < 2 + detected_len:
            logger.info("✅ 正确识别为非packet格式（连续字节流）")
        else:
            logger.warning(f"⚠️ 可能误识别为packet格式: detected_len={detected_len}")
    
    return True


def check_service_health():
    """
    检查服务健康状态
    """
    try:
        response = requests.get(f"{FASTER_WHISPER_VAD_URL}/health", timeout=5)
        response.raise_for_status()
        health = response.json()
        logger.info(f"✅ 服务健康检查通过: {health}")
        return health.get('status') == 'ok'
    except Exception as e:
        logger.error(f"❌ 服务健康检查失败: {e}")
        logger.error(f"   请确保faster_whisper_vad服务正在运行在 {FASTER_WHISPER_VAD_URL}")
        return False


def main():
    """
    运行所有测试
    """
    logger.info("=" * 60)
    logger.info("方案A端到端测试")
    logger.info("=" * 60)
    logger.info()
    
    # 检查服务健康
    if not check_service_health():
        logger.error("服务不可用，退出测试")
        return
    
    logger.info()
    
    # 运行测试
    results = []
    
    # 测试1: Web端 → 节点端解码
    results.append(("Web端→节点端解码", test_web_to_node_decoding()))
    logger.info()
    
    # 测试2: 向后兼容性
    results.append(("向后兼容性", test_legacy_format_compatibility()))
    logger.info()
    
    # 测试3: Packet格式检测
    results.append(("Packet格式检测", test_packet_format_detection()))
    logger.info()
    
    # 汇总结果
    logger.info("=" * 60)
    logger.info("测试结果汇总")
    logger.info("=" * 60)
    for test_name, passed in results:
        status = "✅ 通过" if passed else "❌ 失败"
        logger.info(f"{test_name}: {status}")
    
    all_passed = all(result[1] for result in results)
    if all_passed:
        logger.info()
        logger.info("🎉 所有测试通过！")
    else:
        logger.info()
        logger.warning("⚠️ 部分测试失败，请检查日志")
    
    return all_passed


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)

