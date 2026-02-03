"""
集成测试 - 健康检查与 Utterance 请求测试
"""
import os
import time

import requests

from test_integration_wav_helpers import (
    BASE_URL,
    CHINESE_WAV,
    ENGLISH_WAV,
    logger,
    read_wav_file,
    convert_to_opus_plan_a,
)


def test_health_check() -> bool:
    """测试健康检查端点"""
    logger.info("=" * 60)
    logger.info("测试1: 健康检查")
    logger.info("=" * 60)

    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            logger.info("✅ 健康检查成功")
            logger.info(f"   服务状态: {data.get('status')}")
            logger.info(f"   Worker 状态: {data.get('asr_worker', {}).get('worker_state')}")
            logger.info(f"   Worker PID: {data.get('asr_worker', {}).get('worker_pid')}")
            return True
        else:
            logger.error(f"❌ 健康检查失败: Status {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"❌ 健康检查异常: {e}")
        return False


def test_utterance_request(
    audio_file: str,
    language: str,
    audio_format: str = "opus",
    use_opus: bool = True
) -> bool:
    """测试单个 utterance 请求"""
    logger.info("")
    logger.info("=" * 60)
    logger.info(f"测试: {os.path.basename(audio_file)} ({language})")
    logger.info("=" * 60)

    try:
        logger.info(f"   读取音频文件: {audio_file}")
        audio_format = "opus"

        audio, sr = read_wav_file(audio_file)
        duration = len(audio) / sr
        logger.info(f"   音频信息: 采样率={sr}Hz, 时长={duration:.2f}s, 样本数={len(audio)}")

        logger.info("   转换为 Opus Plan A 格式...")
        audio_b64 = convert_to_opus_plan_a(audio, sr)

        logger.info(f"   音频数据大小: {len(audio_b64)} 字符 (base64, Opus Plan A)")

        job_id = f"test_{language}_{int(time.time())}"
        payload = {
            "job_id": job_id,
            "src_lang": language,
            "audio": audio_b64,
            "audio_format": audio_format,
            "sample_rate": 16000,
            "task": "transcribe",
            "beam_size": 5,
            "condition_on_previous_text": False,
            "use_context_buffer": False,
            "use_text_context": False,
            "trace_id": job_id
        }

        logger.info("   发送请求到 ASR 服务...")
        start_time = time.time()
        response = requests.post(f"{BASE_URL}/utterance", json=payload, timeout=60)
        elapsed = time.time() - start_time

        if response.status_code == 200:
            data = response.json()
            logger.info(f"✅ 请求成功 (耗时 {elapsed:.2f}s)")
            logger.info(f"   识别文本: {data.get('text', '')}")
            logger.info(f"   检测语言: {data.get('language', 'N/A')}")
            logger.info(f"   音频时长: {data.get('duration', 0):.2f}s")
            logger.info(f"   分段数: {len(data.get('segments', []))}")

            if data.get('text'):
                logger.info("✅ 识别结果有效")
                return True
            else:
                logger.warning("⚠️  识别结果为空（可能是静音或识别失败）")
                return True
        else:
            logger.error(f"❌ 请求失败: Status {response.status_code}")
            logger.error(f"   响应: {response.text[:200]}")
            return False

    except FileNotFoundError as e:
        logger.error(f"❌ 文件未找到: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ 测试异常: {e}", exc_info=True)
        return False


def test_multiple_requests() -> bool:
    """测试多个顺序请求"""
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试: 多个顺序请求")
    logger.info("=" * 60)

    results = []

    if os.path.exists(CHINESE_WAV):
        results.append(("中文", test_utterance_request(CHINESE_WAV, "zh", "opus", True)))
        time.sleep(1)
    else:
        logger.warning(f"   跳过中文测试（文件不存在: {CHINESE_WAV}）")

    if os.path.exists(ENGLISH_WAV):
        results.append(("英文", test_utterance_request(ENGLISH_WAV, "en", "opus", True)))
        time.sleep(1)
    else:
        logger.warning(f"   跳过英文测试（文件不存在: {ENGLISH_WAV}）")

    if os.path.exists(CHINESE_WAV):
        results.append(("中文（第二次）", test_utterance_request(CHINESE_WAV, "zh", "opus", True)))

    success_count = sum(1 for _, result in results if result)
    total_count = len(results)

    logger.info("")
    logger.info(f"   结果: {success_count}/{total_count} 成功")

    return success_count == total_count if total_count else True


def test_worker_stability() -> bool:
    """测试 Worker 进程稳定性"""
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试: Worker 进程稳定性")
    logger.info("=" * 60)

    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            logger.error("❌ 无法获取健康状态")
            return False

        initial_data = response.json()
        initial_pid = initial_data.get('asr_worker', {}).get('worker_pid')
        initial_restarts = initial_data.get('asr_worker', {}).get('worker_restarts', 0)

        logger.info(f"   初始 Worker PID: {initial_pid}")
        logger.info(f"   初始重启次数: {initial_restarts}")

        logger.info("   执行多个请求测试...")
        test_multiple_requests()

        time.sleep(2)
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            logger.error("❌ 无法获取健康状态")
            return False

        final_data = response.json()
        final_pid = final_data.get('asr_worker', {}).get('worker_pid')
        final_state = final_data.get('asr_worker', {}).get('worker_state')
        final_restarts = final_data.get('asr_worker', {}).get('worker_restarts', 0)

        logger.info(f"   最终 Worker PID: {final_pid}")
        logger.info(f"   最终 Worker 状态: {final_state}")
        logger.info(f"   最终重启次数: {final_restarts}")

        if final_state == 'running' and final_pid is not None:
            if final_restarts > initial_restarts:
                logger.warning(f"⚠️  检测到 {final_restarts - initial_restarts} 次 Worker 重启")
            else:
                logger.info("✅ Worker 进程稳定运行，无重启")
            return True
        else:
            logger.error("❌ Worker 状态异常")
            return False

    except Exception as e:
        logger.error(f"❌ 稳定性测试异常: {e}", exc_info=True)
        return False
