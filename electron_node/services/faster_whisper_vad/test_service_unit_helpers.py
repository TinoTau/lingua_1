"""
faster_whisper_vad 服务单元测试 - 公共配置与辅助函数
"""
import base64
import io
import logging
import struct
import wave

import numpy as np
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 测试配置
BASE_URL = "http://127.0.0.1:6007"
TIMEOUT = 30

# 测试数据
SAMPLE_RATE = 16000
CHANNELS = 1
FRAME_MS = 20
FRAME_SAMPLES = int(SAMPLE_RATE * (FRAME_MS / 1000.0))


def generate_pcm16_audio(duration_sec: float = 1.0, frequency: float = 440.0) -> bytes:
    """生成PCM16测试音频"""
    samples = int(SAMPLE_RATE * duration_sec)
    t = np.linspace(0, duration_sec, samples, False)
    audio = np.sin(2 * np.pi * frequency * t)
    pcm16 = (audio * 32767).astype(np.int16)
    return pcm16.tobytes()


def generate_wav_bytes(pcm16_data: bytes) -> bytes:
    """将PCM16数据包装成WAV格式"""
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm16_data)
    return wav_buffer.getvalue()


def generate_opus_packet_format(opus_packets: list) -> bytes:
    """生成方案A的packet格式数据"""
    data = bytearray()
    for packet in opus_packets:
        packet_len = len(packet)
        data += struct.pack("<H", packet_len)  # uint16_le
        data += packet
    return bytes(data)


def generate_test_wav_b64(duration_sec: float = 1.0) -> str:
    """生成测试WAV音频的base64编码"""
    samples = int(SAMPLE_RATE * duration_sec)
    t = np.linspace(0, duration_sec, samples, False)
    audio = np.sin(2 * np.pi * 440.0 * t)
    pcm16 = (audio * 32767).astype(np.int16)
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm16.tobytes())
    return base64.b64encode(wav_buffer.getvalue()).decode('utf-8')


def check_service_available() -> bool:
    """检查服务是否可用"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=2)
        return response.status_code == 200
    except Exception:
        return False
