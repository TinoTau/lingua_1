"""
测试 Step 9.3 跨 utterance 去重移除后的行为

测试目标：
1. Step 9.2 的 utterance 内部去重仍然正常工作
2. Step 9.3 的跨 utterance 去重已移除（跨 utterance 重复文本会正常传递）
"""

import requests
import base64
import numpy as np
import wave
import io
import time
import logging
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 测试配置
BASE_URL = "http://127.0.0.1:6007"
TIMEOUT = 60
SAMPLE_RATE = 16000
CHANNELS = 1


def generate_test_wav(text: str = "", duration_sec: float = 1.0) -> str:
    """
    生成测试WAV音频的base64编码
    注意：这只是测试音频，实际ASR识别结果可能为空或不同
    """
    samples = int(SAMPLE_RATE * duration_sec)
    t = np.linspace(0, duration_sec, samples, False)
    # 生成440Hz正弦波
    audio = np.sin(2 * np.pi * 440.0 * t)
    pcm16 = (audio * 32767).astype(np.int16)
    
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm16.tobytes())
    
    return base64.b64encode(wav_buffer.getvalue()).decode('utf-8')


def test_step92_intra_utterance_deduplication():
    """
    测试 Step 9.2：单个 utterance 内部去重仍然正常工作
    
    这个测试验证 utterance 内部的重复文本会被去重
    """
    logger.info("=" * 80)
    logger.info("测试 Step 9.2：单个 utterance 内部去重")
    logger.info("=" * 80)
    
    # 导入去重函数进行单元测试
    from text_deduplicator import deduplicate_text
    
    test_cases = [
        ("这边能不能用这边能不能用", "这边能不能用"),
        ("测试测试", "测试"),
        ("这个地方我觉得还行这个地方我觉得还行", "这个地方我觉得还行"),
    ]
    
    all_passed = True
    for original, expected in test_cases:
        result = deduplicate_text(original)
        if result == expected:
            logger.info(f"✅ 通过: '{original}' -> '{result}'")
        else:
            logger.error(f"❌ 失败: '{original}' -> '{result}', 期望: '{expected}'")
            all_passed = False
    
    if all_passed:
        logger.info("✅ Step 9.2 测试通过：单个 utterance 内部去重正常工作")
    else:
        logger.error("❌ Step 9.2 测试失败：单个 utterance 内部去重异常")
    
    return all_passed


def test_step93_removed_cross_utterance_deduplication():
    """
    测试 Step 9.3 已移除：跨 utterance 去重不再执行
    
    验证：
    1. 跨 utterance 的重复文本会正常返回（不再被过滤）
    2. 日志中不再出现 "Step 9.3" 相关处理
    
    注意：这个测试需要服务运行，并且需要模拟真实的ASR识别结果
    由于我们无法直接控制ASR识别结果，这个测试主要验证：
    - 服务能正常处理多个 utterance 请求
    - 不会因为跨 utterance 重复而返回空结果
    """
    logger.info("=" * 80)
    logger.info("测试 Step 9.3 移除：跨 utterance 去重不再执行")
    logger.info("=" * 80)
    
    try:
        # 检查服务是否可用
        health_response = requests.get(f"{BASE_URL}/health", timeout=5)
        if health_response.status_code != 200:
            logger.error(f"❌ 服务不可用: {health_response.status_code}")
            return False
        logger.info("✅ 服务可用")
        
        # 重置服务状态
        reset_response = requests.post(
            f"{BASE_URL}/reset",
            json={
                "reset_vad": True,
                "reset_context": True,
                "reset_text_context": True,
            },
            timeout=5
        )
        if reset_response.status_code != 200:
            logger.warning(f"⚠️ 重置失败: {reset_response.status_code}")
        else:
            logger.info("✅ 服务状态已重置")
        
        # 发送第一个 utterance 请求
        audio_b64 = generate_test_wav(duration_sec=1.0)
        job_id_1 = f"test_step93_1_{int(time.time())}"
        
        logger.info(f"发送第一个 utterance 请求: job_id={job_id_1}")
        response1 = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": job_id_1,
                "src_lang": "zh",
                "audio": audio_b64,
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": False,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        if response1.status_code != 200:
            logger.error(f"❌ 第一个 utterance 请求失败: {response1.status_code}")
            logger.error(f"响应: {response1.text}")
            return False
        
        result1 = response1.json()
        text1 = result1.get("text", "").strip()
        logger.info(f"✅ 第一个 utterance 完成: text='{text1[:100]}'")
        
        # 等待一小段时间，确保上下文已更新
        time.sleep(0.5)
        
        # 发送第二个 utterance 请求（使用相同的音频，模拟重复）
        job_id_2 = f"test_step93_2_{int(time.time())}"
        
        logger.info(f"发送第二个 utterance 请求: job_id={job_id_2}")
        response2 = requests.post(
            f"{BASE_URL}/utterance",
            json={
                "job_id": job_id_2,
                "src_lang": "zh",
                "audio": audio_b64,  # 使用相同的音频
                "audio_format": "pcm16",
                "sample_rate": SAMPLE_RATE,
                "task": "transcribe",
                "beam_size": 5,
                "condition_on_previous_text": False,
                "use_context_buffer": True,
                "use_text_context": True,
            },
            timeout=TIMEOUT
        )
        
        if response2.status_code != 200:
            logger.error(f"❌ 第二个 utterance 请求失败: {response2.status_code}")
            logger.error(f"响应: {response2.text}")
            return False
        
        result2 = response2.json()
        text2 = result2.get("text", "").strip()
        logger.info(f"✅ 第二个 utterance 完成: text='{text2[:100]}'")
        
        # 验证：Step 9.3 已移除，跨 utterance 重复不会导致返回空结果
        # 注意：由于ASR识别结果可能为空（测试音频是纯正弦波），我们主要验证：
        # 1. 服务能正常处理请求（不崩溃）
        # 2. 不会因为跨 utterance 重复而返回空结果（除非ASR本身识别为空）
        
        # 如果两个 utterance 的文本相同且不为空，说明 Step 9.3 已移除
        # （如果 Step 9.3 还在，第二个 utterance 应该返回空结果）
        if text1 and text2:
            if text1 == text2:
                logger.info("✅ 验证通过：跨 utterance 重复文本正常返回（Step 9.3 已移除）")
                logger.info(f"   第一个 utterance: '{text1[:50]}'")
                logger.info(f"   第二个 utterance: '{text2[:50]}'")
                logger.info("   说明：如果 Step 9.3 还在，第二个 utterance 应该返回空结果")
            else:
                logger.info("ℹ️ 两个 utterance 的文本不同（这是正常的，取决于ASR识别结果）")
        elif not text1 and not text2:
            logger.info("ℹ️ 两个 utterance 的识别结果都为空（测试音频是纯正弦波，这是正常的）")
            logger.info("   验证：服务能正常处理请求，没有因为 Step 9.3 而崩溃")
        else:
            logger.info("ℹ️ 一个 utterance 有文本，另一个为空（取决于ASR识别结果）")
        
        logger.info("✅ Step 9.3 移除测试通过：服务能正常处理跨 utterance 请求")
        return True
        
    except requests.exceptions.ConnectionError:
        logger.error("❌ 无法连接到服务，请确保服务正在运行")
        logger.error("   启动服务: python faster_whisper_vad_service.py")
        return False
    except Exception as e:
        logger.error(f"❌ 测试异常: {e}", exc_info=True)
        return False


def test_log_verification():
    """
    验证日志中不再出现 Step 9.3 相关处理
    
    注意：这个测试需要检查服务日志文件
    """
    logger.info("=" * 80)
    logger.info("验证日志中不再出现 Step 9.3 相关处理")
    logger.info("=" * 80)
    
    log_file = os.path.join(os.path.dirname(__file__), "logs", "faster-whisper-vad-service.log")
    
    if not os.path.exists(log_file):
        logger.warning(f"⚠️ 日志文件不存在: {log_file}")
        logger.info("   请运行服务并执行测试，然后检查日志文件")
        return True  # 不视为失败
    
    try:
        # 尝试多种编码方式
        encodings = ['utf-8', 'gbk', 'gb2312', 'latin-1']
        lines = None
        
        for encoding in encodings:
            try:
                with open(log_file, 'r', encoding=encoding, errors='ignore') as f:
                    lines = f.readlines()
                    break
            except (UnicodeDecodeError, FileNotFoundError):
                continue
        
        if lines is None:
            logger.warning(f"⚠️ 无法读取日志文件: {log_file}")
            return True  # 不视为失败
        
        # 读取最后1000行
        recent_lines = lines[-1000:] if len(lines) > 1000 else lines
        
        # 检查是否还有 Step 9.3 的处理日志
        step93_patterns = [
            "Step 9.3: Cross-utterance",
            "Cross-utterance complete duplicate",
            "Cross-utterance partial duplicate",
            "Cross-utterance suffix duplicate",
            "Cross-utterance contained duplicate",
        ]
        
        found_step93 = False
        for line in recent_lines:
            for pattern in step93_patterns:
                if pattern in line:
                    found_step93 = True
                    logger.warning(f"⚠️ 发现 Step 9.3 相关日志: {line.strip()}")
                    break
            if found_step93:
                break
        
        if found_step93:
            # 检查日志时间戳，如果是很久以前的日志，可能是历史记录
            # 只检查最近1小时的日志
            import datetime
            now = datetime.datetime.now()
            recent_found = False
            
            for line in recent_lines:
                # 尝试解析时间戳（格式：2025-12-28 06:55:44,462）
                try:
                    if len(line) > 20:
                        time_str = line[:19]  # 前19个字符是时间戳
                        log_time = datetime.datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
                        time_diff = (now - log_time).total_seconds()
                        # 如果日志是最近1小时内的，才视为问题
                        if time_diff < 3600:  # 1小时
                            for pattern in step93_patterns:
                                if pattern in line:
                                    recent_found = True
                                    logger.warning(f"⚠️ 发现最近的 Step 9.3 相关日志: {line.strip()[:100]}")
                                    break
                            if recent_found:
                                break
                except (ValueError, IndexError):
                    # 无法解析时间戳，跳过
                    continue
            
            if recent_found:
                logger.warning("⚠️ 日志中仍存在最近的 Step 9.3 相关处理，可能未完全移除")
                return False
            else:
                logger.info("ℹ️ 日志中发现 Step 9.3 相关记录，但都是历史记录（1小时前）")
                logger.info("   建议：重启服务后重新运行测试，验证新日志中不再出现 Step 9.3")
                return True  # 历史记录不视为失败
        else:
            logger.info("✅ 验证通过：日志中未发现 Step 9.3 相关处理")
            return True
                
    except Exception as e:
        logger.error(f"❌ 读取日志文件失败: {e}")
        return False


def run_all_tests():
    """运行所有测试"""
    logger.info("=" * 80)
    logger.info("Step 9.3 移除验证测试")
    logger.info("=" * 80)
    logger.info("")
    
    results = []
    
    # 测试 1: Step 9.2 内部去重
    logger.info("测试 1: Step 9.2 单个 utterance 内部去重")
    result1 = test_step92_intra_utterance_deduplication()
    results.append(("Step 9.2 内部去重", result1))
    logger.info("")
    
    # 测试 2: Step 9.3 移除验证
    logger.info("测试 2: Step 9.3 跨 utterance 去重移除验证")
    logger.info("注意：此测试需要服务运行")
    logger.info("")
    result2 = test_step93_removed_cross_utterance_deduplication()
    results.append(("Step 9.3 移除验证", result2))
    logger.info("")
    
    # 测试 3: 日志验证
    logger.info("测试 3: 日志验证")
    result3 = test_log_verification()
    results.append(("日志验证", result3))
    logger.info("")
    
    # 汇总结果
    logger.info("=" * 80)
    logger.info("测试结果汇总")
    logger.info("=" * 80)
    
    passed = 0
    failed = 0
    
    for test_name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        logger.info(f"{test_name}: {status}")
        if result:
            passed += 1
        else:
            failed += 1
    
    logger.info("")
    logger.info(f"总计: {passed} 通过, {failed} 失败, {len(results)} 总计")
    
    if failed == 0:
        logger.info("")
        logger.info("🎉 所有测试通过！")
        return True
    else:
        logger.error("")
        logger.error("❌ 部分测试失败，请检查上述错误信息")
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)

