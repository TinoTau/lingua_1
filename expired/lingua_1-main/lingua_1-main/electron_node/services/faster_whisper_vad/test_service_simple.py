"""
faster_whisper_vad 服务简化单元测试
只测试核心功能，避免服务崩溃
"""

import requests
import base64
import numpy as np
import wave
import io
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

BASE_URL = "http://127.0.0.1:6007"
TIMEOUT = 30

def generate_test_wav(duration_sec=0.5, sample_rate=16000):
    """生成测试WAV音频"""
    samples = int(sample_rate * duration_sec)
    t = np.linspace(0, duration_sec, samples, False)
    audio = np.sin(2 * np.pi * 440.0 * t)
    pcm16 = (audio * 32767).astype(np.int16)
    
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16.tobytes())
    
    return base64.b64encode(wav_buffer.getvalue()).decode('utf-8')

def test_health():
    """测试健康检查"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        logger.info("✅ 健康检查测试通过")
        return True
    except Exception as e:
        logger.error(f"❌ 健康检查测试失败: {e}")
        return False

def test_reset():
    """测试重置端点"""
    try:
        response = requests.post(
            f"{BASE_URL}/reset",
            json={"reset_vad": True, "reset_context": True, "reset_text_context": True},
            timeout=5
        )
        assert response.status_code == 200
        logger.info("✅ 重置端点测试通过")
        return True
    except Exception as e:
        logger.error(f"❌ 重置端点测试失败: {e}")
        return False

def test_pcm16_audio():
    """测试PCM16音频处理"""
    try:
        audio_b64 = generate_test_wav(duration_sec=0.5)
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_pcm16_{int(time.time())}",
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": 16000,
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
        return True
    except Exception as e:
        logger.error(f"❌ PCM16音频测试失败: {e}")
        return False

def main():
    """运行所有测试"""
    logger.info("=" * 60)
    logger.info("faster_whisper_vad 服务简化单元测试")
    logger.info("=" * 60)
    logger.info("")
    
    # 检查服务是否可用
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=2)
        if response.status_code != 200:
            logger.error(f"❌ 服务不可用: {BASE_URL}")
            return False
    except Exception as e:
        logger.error(f"❌ 服务不可用: {BASE_URL}, 错误: {e}")
        return False
    
    logger.info(f"✅ 服务可用: {BASE_URL}")
    logger.info("")
    
    # 运行测试
    results = []
    
    results.append(("健康检查", test_health()))
    time.sleep(0.5)  # 短暂延迟
    
    results.append(("重置端点", test_reset()))
    time.sleep(0.5)
    
    results.append(("PCM16音频", test_pcm16_audio()))
    time.sleep(0.5)
    
    # 汇总结果
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试结果汇总")
    logger.info("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    failed = len(results) - passed
    
    for test_name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        logger.info(f"{test_name}: {status}")
    
    logger.info("")
    logger.info(f"总计: {passed} 通过, {failed} 失败, {len(results)} 总计")
    
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

