"""
faster_whisper_vad 服务单元测试
测试所有API端点和核心功能（入口：聚合各子模块并运行）
"""

import logging
import requests

from test_service_unit_helpers import (
    BASE_URL,
    TIMEOUT,
    SAMPLE_RATE,
    logger,
    check_service_available,
)


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


def main():
    """运行所有测试（聚合各子模块测试类）"""
    from test_service_unit_audio import TestAudioFormat
    from test_service_unit_utterance import TestUtteranceEndpoint
    from test_service_unit_errors import TestErrorHandling

    logger.info("=" * 60)
    logger.info("faster_whisper_vad 服务单元测试")
    logger.info("=" * 60)
    logger.info("")

    if not check_service_available():
        logger.error(f"❌ 服务不可用: {BASE_URL}")
        logger.error("   请确保 faster_whisper_vad 服务正在运行")
        logger.error("   启动命令: python faster_whisper_vad_service.py")
        return False

    logger.info(f"✅ 服务可用: {BASE_URL}")
    logger.info("")

    test_results = []

    try:
        test = TestServiceHealth()
        test.test_health_check()
        test_results.append(("健康检查", True))
    except Exception as e:
        logger.error(f"❌ 健康检查测试失败: {e}")
        test_results.append(("健康检查", False))

    try:
        test = TestResetEndpoint()
        test.test_reset_all()
        test.test_reset_partial()
        test_results.append(("重置端点", True))
    except Exception as e:
        logger.error(f"❌ 重置端点测试失败: {e}")
        test_results.append(("重置端点", False))

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
            test_results.append(("Opus连续字节流", None))
        else:
            logger.warning(f"⚠️ Opus连续字节流测试失败: {e}")
            test_results.append(("Opus连续字节流", False))

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
        logger.error("")
        logger.error(f"❌ 有 {failed} 个测试失败")
        return False


if __name__ == "__main__":
    import sys
    ok = main()
    sys.exit(0 if ok else 1)
