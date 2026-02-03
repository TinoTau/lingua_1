"""
faster_whisper_vad 服务单元测试 - Utterance 端点
"""
import base64
import time

import requests

from test_service_unit_helpers import (
    BASE_URL,
    TIMEOUT,
    SAMPLE_RATE,
    logger,
    generate_test_wav_b64,
)


class TestUtteranceEndpoint:
    """测试Utterance端点"""

    def test_basic_utterance(self):
        """测试基本utterance处理"""
        audio_b64 = generate_test_wav_b64(duration_sec=1.0)

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
        audio_b64 = generate_test_wav_b64(duration_sec=1.0)

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
        audio_b64 = generate_test_wav_b64(duration_sec=0.5)

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

        assert response.status_code in [400, 500]
        logger.info("✅ 无效音频格式测试通过（正确返回错误）")

    def test_missing_required_fields(self):
        """测试缺少必需字段"""
        response = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": f"test_missing_{int(time.time())}",
            },
            timeout=TIMEOUT
        )

        assert response.status_code == 422
        logger.info("✅ 缺少必需字段测试通过（正确返回验证错误）")
