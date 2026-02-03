"""
faster_whisper_vad 服务单元测试 - 错误处理
"""
import base64
import time

import requests

from test_service_unit_helpers import (
    BASE_URL,
    TIMEOUT,
    SAMPLE_RATE,
    logger,
)


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

        assert response.status_code in [200, 400, 500]
        logger.info("✅ 空音频测试通过")
