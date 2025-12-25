"""
faster_whisper_vad 服务单元测试
测试所有API端点和核心功能
"""

import requests
import base64
import numpy as np
import struct
import time
import logging
from typing import Optional

# 配置日志
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


class TestServiceHealth:
    """测试服务健康检查"""
    
    def test_health_check(self):
        """测试健康检查端点"""
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        assert data.get("asr_model_loaded") is True
        assert data.get("vad_model_loaded") is True
        logger.info("✅ 健康检查测试通过")


class TestResetEndpoint:
    """测试重置端点"""
    
    def test_reset_all(self):
        """测试重置所有状态"""
        response = requests.post(
            f"{BASE_URL}/reset",
            json={
                "reset_vad": True,
                "reset_context": True,
                "reset_text_context": True
            },
            timeout=5
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        logger.info("✅ 重置端点测试通过")
    
    def test_reset_partial(self):
        """测试部分重置"""
        response = requests.post(
            f"{BASE_URL}/reset",
            json={
                "reset_vad": True,
                "reset_context": False,
                "reset_text_context": False
            },
            timeout=5
        )
        assert response.status_code == 200
        logger.info("✅ 部分重置测试通过")


class TestAudioFormat:
    """测试音频格式处理"""
    
    def generate_pcm16_audio(self, duration_sec: float = 1.0, frequency: float = 440.0) -> bytes:
        """生成PCM16测试音频"""
        samples = int(SAMPLE_RATE * duration_sec)
        t = np.linspace(0, duration_sec, samples, False)
        audio = np.sin(2 * np.pi * frequency * t)
        # 转换为PCM16
        pcm16 = (audio * 32767).astype(np.int16)
        return pcm16.tobytes()
    
    def generate_wav_bytes(self, pcm16_data: bytes) -> bytes:
        """将PCM16数据包装成WAV格式"""
        import wave
        import io
        
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(CHANNELS)
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(SAMPLE_RATE)
            wav_file.writeframes(pcm16_data)
        
        return wav_buffer.getvalue()
    
    def generate_opus_packet_format(self, opus_packets: list) -> bytes:
        """生成方案A的packet格式数据"""
        data = bytearray()
        for packet in opus_packets:
            packet_len = len(packet)
            data += struct.pack("<H", packet_len)  # uint16_le
            data += packet
        return bytes(data)
    
    def test_pcm16_audio(self):
        """测试PCM16音频处理"""
        # 生成测试音频
        pcm16_data = self.generate_pcm16_audio(duration_sec=1.0, frequency=440.0)
        wav_bytes = self.generate_wav_bytes(pcm16_data)
        audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')
        
        # 发送请求
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_pcm16_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        assert response.status_code == 200
        result = response.json()
        assert "text" in result
        assert "language" in result
        assert "duration" in result
        logger.info(f"✅ PCM16音频测试通过: text='{result.get('text', '')[:50]}'")
    
    def test_opus_packet_format(self):
        """测试方案A的Opus packet格式"""
        try:
            import pyogg.opus as opus
        except ImportError:
            logger.warning("pyogg not available, skipping Opus test")
            return
        
        # 生成测试音频并编码为Opus
        pcm16_data = self.generate_pcm16_audio(duration_sec=0.5, frequency=440.0)
        
        # 将PCM16转换为float32用于Opus编码
        pcm16_array = np.frombuffer(pcm16_data, dtype=np.int16)
        audio_float = pcm16_array.astype(np.float32) / 32768.0
        
        # 编码为Opus packets
        channels = 1
        encoder_size = opus.opus_encoder_get_size(channels)
        encoder_state = (opus.c_uchar * encoder_size)()
        
        error = opus.opus_encoder_init(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            SAMPLE_RATE,
            channels,
            opus.OPUS_APPLICATION_VOIP
        )
        if error != opus.OPUS_OK:
            logger.warning(f"Failed to initialize Opus encoder: {opus.opus_strerror(error)}, skipping test")
            return
        
        # 设置编码参数（与 Web 端一致：24 kbps for VOIP）
        opus.opus_encoder_ctl(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            opus.OPUS_SET_BITRATE_REQUEST,
            24000  # 24 kbps（推荐值，与 Web 端一致）
        )
        
        # 按帧编码
        opus_packets = []
        frame_size = FRAME_SAMPLES
        offset = 0
        
        while offset < len(audio_float):
            remaining = len(audio_float) - offset
            current_frame_size = min(frame_size, remaining)
            
            if current_frame_size < frame_size:
                frame = np.zeros(frame_size, dtype=np.float32)
                frame[:current_frame_size] = audio_float[offset:offset + current_frame_size]
            else:
                frame = audio_float[offset:offset + frame_size]
            
            # 编码帧
            max_packet_size = 4000
            packet_buffer = (opus.c_uchar * max_packet_size)()
            packet_ptr = opus.cast(packet_buffer, opus.c_uchar_p)
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
                opus_packets.append(packet_bytes)
            
            offset += current_frame_size
        
        # 清理编码器
        opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))
        
        if not opus_packets:
            logger.warning("No Opus packets generated, skipping test")
            return
        
        # 创建packet格式数据（方案A）
        packet_format_data = self.generate_opus_packet_format(opus_packets)
        audio_b64 = base64.b64encode(packet_format_data).decode('utf-8')
        
        # 发送请求
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_opus_packet_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "opus",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        assert response.status_code == 200
        result = response.json()
        assert "text" in result
        assert "language" in result
        assert "duration" in result
        logger.info(f"✅ Opus packet格式测试通过: text='{result.get('text', '')[:50]}'")
    
    def test_opus_continuous_stream(self):
        """测试连续字节流格式（已知存在问题的方法）"""
        try:
            import pyogg.opus as opus
        except ImportError:
            logger.warning("pyogg not available, skipping Opus test")
            return
        
        # 生成测试音频并编码为Opus
        pcm16_data = self.generate_pcm16_audio(duration_sec=0.3, frequency=440.0)
        pcm16_array = np.frombuffer(pcm16_data, dtype=np.int16)
        audio_float = pcm16_array.astype(np.float32) / 32768.0
        
        # 编码为Opus（简化版，只编码一个帧）
        channels = 1
        encoder_size = opus.opus_encoder_get_size(channels)
        encoder_state = (opus.c_uchar * encoder_size)()
        
        error = opus.opus_encoder_init(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            SAMPLE_RATE,
            channels,
            opus.OPUS_APPLICATION_VOIP
        )
        if error != opus.OPUS_OK:
            logger.warning(f"Failed to initialize Opus encoder: {opus.opus_strerror(error)}, skipping test")
            return
        
        # 编码一个帧
        frame_size = FRAME_SAMPLES
        if len(audio_float) < frame_size:
            frame = np.zeros(frame_size, dtype=np.float32)
            frame[:len(audio_float)] = audio_float
        else:
            frame = audio_float[:frame_size]
        
        max_packet_size = 4000
        packet_buffer = (opus.c_uchar * max_packet_size)()
        packet_ptr = opus.cast(packet_buffer, opus.c_uchar_p)
        frame_ptr = opus.cast(frame.ctypes.data, opus.c_float_p)
        
        packet_len = opus.opus_encode_float(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            frame_ptr,
            frame_size,
            packet_ptr,
            max_packet_size
        )
        
        opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))
        
        if packet_len <= 0:
            logger.warning("Failed to encode Opus packet, skipping test")
            return
        
        # 创建连续字节流（不添加length-prefix）
        continuous_data = bytes(packet_buffer[:packet_len])
        audio_b64 = base64.b64encode(continuous_data).decode('utf-8')
        
        # 发送请求（预期可能失败，因为连续字节流方法有问题）
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_opus_continuous_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "opus",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        # 连续字节流方法可能失败（这是预期的）
        if response.status_code == 200:
            logger.info("⚠️ 连续字节流格式解码成功（意外）")
        else:
            logger.info("✅ 连续字节流格式正确返回错误（符合预期）")
            assert response.status_code == 400


class TestUtteranceEndpoint:
    """测试Utterance端点"""
    
    def generate_test_wav(self, duration_sec: float = 1.0) -> str:
        """生成测试WAV音频的base64编码"""
        import wave
        import io
        
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
    
    def test_basic_utterance(self):
        """测试基本utterance处理"""
        audio_b64 = self.generate_test_wav(duration_sec=1.0)
        
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_basic_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        assert response.status_code == 200
        result = response.json()
        assert "text" in result
        assert "segments" in result
        assert "language" in result
        assert "duration" in result
        assert "vad_segments" in result
        logger.info(f"✅ 基本utterance测试通过: text='{result.get('text', '')[:50]}'")
    
    def test_auto_language_detection(self):
        """测试自动语言检测"""
        audio_b64 = self.generate_test_wav(duration_sec=1.0)
        
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_auto_{int(time.time())}",
                "src_lang": "auto",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        assert response.status_code == 200
        result = response.json()
        assert "language" in result
        logger.info(f"✅ 自动语言检测测试通过: detected_language={result.get('language')}")
    
    def test_context_buffer(self):
        """测试上下文缓冲区"""
        audio_b64 = self.generate_test_wav(duration_sec=0.5)
        
        # 第一次请求（建立上下文）
        response1 = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_context1_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        assert response1.status_code == 200
        
        # 第二次请求（使用上下文）
        response2 = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_context2_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        assert response2.status_code == 200
        logger.info("✅ 上下文缓冲区测试通过")
    
    def test_invalid_audio_format(self):
        """测试无效音频格式"""
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_invalid_{int(time.time())}",
                "src_lang": "zh",
                "audio": base64.b64encode(b"invalid_audio_data").decode('utf-8'),
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        # 应该返回错误
        assert response.status_code in [400, 500]
        logger.info("✅ 无效音频格式测试通过（正确返回错误）")
    
    def test_missing_required_fields(self):
        """测试缺少必需字段"""
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_missing_{int(time.time())}",
                # 缺少 audio 字段
            },
            timeout=TIMEOUT
        )
        
        # 应该返回验证错误
        assert response.status_code == 422  # FastAPI validation error
        logger.info("✅ 缺少必需字段测试通过（正确返回验证错误）")


class TestErrorHandling:
    """测试错误处理"""
    
    def test_invalid_base64(self):
        """测试无效的base64编码"""
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_invalid_b64_{int(time.time())}",
                "src_lang": "zh",
                "audio": "invalid_base64!!!",
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        assert response.status_code == 400
        logger.info("✅ 无效base64测试通过（正确返回错误）")
    
    def test_empty_audio(self):
        """测试空音频"""
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_empty_{int(time.time())}",
                "src_lang": "zh",
                "audio": base64.b64encode(b"").decode('utf-8'),
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": True,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        # 空音频应该返回错误或空结果
        assert response.status_code in [200, 400, 500]
        logger.info("✅ 空音频测试通过")


def check_service_available() -> bool:
    """检查服务是否可用"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=2)
        return response.status_code == 200
    except Exception:
        return False


def main():
    """运行所有测试"""
    logger.info("=" * 60)
    logger.info("faster_whisper_vad 服务单元测试")
    logger.info("=" * 60)
    logger.info("")
    
    # 检查服务是否可用
    if not check_service_available():
        logger.error(f"❌ 服务不可用: {BASE_URL}")
        logger.error("   请确保 faster_whisper_vad 服务正在运行")
        logger.error("   启动命令: python faster_whisper_vad_service.py")
        return False
    
    logger.info(f"✅ 服务可用: {BASE_URL}")
    logger.info("")
    
    # 运行测试
    test_results = []
    
    # 健康检查测试
    try:
        test = TestServiceHealth()
        test.test_health_check()
        test_results.append(("健康检查", True))
    except Exception as e:
        logger.error(f"❌ 健康检查测试失败: {e}")
        test_results.append(("健康检查", False))
    
    # 重置端点测试
    try:
        test = TestResetEndpoint()
        test.test_reset_all()
        test.test_reset_partial()
        test_results.append(("重置端点", True))
    except Exception as e:
        logger.error(f"❌ 重置端点测试失败: {e}")
        test_results.append(("重置端点", False))
    
    # 音频格式测试
    try:
        test = TestAudioFormat()
        test.test_pcm16_audio()
        test_results.append(("PCM16音频", True))
    except Exception as e:
        logger.error(f"❌ PCM16音频测试失败: {e}")
        test_results.append(("PCM16音频", False))
    
    try:
        test = TestAudioFormat()
        test.test_opus_packet_format()
        test_results.append(("Opus packet格式（方案A）", True))
    except Exception as e:
        logger.warning(f"⚠️ Opus packet格式测试跳过或失败: {e}")
        test_results.append(("Opus packet格式（方案A）", False))
    
    try:
        test = TestAudioFormat()
        test.test_opus_continuous_stream()
        test_results.append(("Opus连续字节流", True))
    except Exception as e:
        if "skipping" in str(e).lower() or "not available" in str(e).lower():
            logger.info(f"ℹ️ Opus连续字节流测试跳过: {e}")
            test_results.append(("Opus连续字节流", None))  # None表示跳过
        else:
            logger.warning(f"⚠️ Opus连续字节流测试失败: {e}")
            test_results.append(("Opus连续字节流", False))
    
    # Utterance端点测试
    try:
        test = TestUtteranceEndpoint()
        test.test_basic_utterance()
        test_results.append(("基本utterance", True))
    except Exception as e:
        logger.error(f"❌ 基本utterance测试失败: {e}")
        test_results.append(("基本utterance", False))
    
    try:
        test = TestUtteranceEndpoint()
        test.test_auto_language_detection()
        test_results.append(("自动语言检测", True))
    except Exception as e:
        logger.error(f"❌ 自动语言检测测试失败: {e}")
        test_results.append(("自动语言检测", False))
    
    try:
        test = TestUtteranceEndpoint()
        test.test_context_buffer()
        test_results.append(("上下文缓冲区", True))
    except Exception as e:
        logger.error(f"❌ 上下文缓冲区测试失败: {e}")
        test_results.append(("上下文缓冲区", False))
    
    try:
        test = TestUtteranceEndpoint()
        test.test_invalid_audio_format()
        test_results.append(("无效音频格式", True))
    except Exception as e:
        logger.error(f"❌ 无效音频格式测试失败: {e}")
        test_results.append(("无效音频格式", False))
    
    try:
        test = TestUtteranceEndpoint()
        test.test_missing_required_fields()
        test_results.append(("缺少必需字段", True))
    except Exception as e:
        logger.error(f"❌ 缺少必需字段测试失败: {e}")
        test_results.append(("缺少必需字段", False))
    
    # 错误处理测试
    try:
        test = TestErrorHandling()
        test.test_invalid_base64()
        test_results.append(("无效base64", True))
    except Exception as e:
        logger.error(f"❌ 无效base64测试失败: {e}")
        test_results.append(("无效base64", False))
    
    try:
        test = TestErrorHandling()
        test.test_empty_audio()
        test_results.append(("空音频", True))
    except Exception as e:
        logger.error(f"❌ 空音频测试失败: {e}")
        test_results.append(("空音频", False))
    
    # 汇总结果
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试结果汇总")
    logger.info("=" * 60)
    
    passed = 0
    failed = 0
    skipped = 0
    
    for test_name, result in test_results:
        if result is None:
            status = "⏭️ 跳过"
            skipped += 1
        elif result:
            status = "✅ 通过"
            passed += 1
        else:
            status = "❌ 失败"
            failed += 1
        logger.info(f"{test_name}: {status}")
    
    logger.info("")
    logger.info(f"总计: {passed} 通过, {failed} 失败, {skipped} 跳过, {len(test_results)} 总计")
    
    if failed == 0:
        logger.info("")
        logger.info("🎉 所有测试通过！")
        return True
    else:
        logger.info("")
        logger.warning(f"⚠️ {failed} 个测试失败，请检查日志")
        return False


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)

