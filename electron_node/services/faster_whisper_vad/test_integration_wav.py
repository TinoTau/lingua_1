"""
集成测试脚本 - 使用真实 WAV 文件测试 ASR 服务
测试进程隔离架构的完整功能

要求：numpy, soundfile, pyogg, scipy
"""
import os
import sys

# 检查必需的库（在导入 numpy/soundfile 等之前）
REQUIRED_LIBS = {
    'numpy': 'numpy',
    'soundfile': 'soundfile',
    'pyogg': 'pyogg',
    'scipy': 'scipy'
}
MISSING_LIBS = []
for lib_name, package_name in REQUIRED_LIBS.items():
    try:
        __import__(lib_name)
    except ImportError:
        MISSING_LIBS.append(package_name)

if MISSING_LIBS:
    print("=" * 60)
    print("❌ 缺少必需的库，请先安装：")
    print(f"   pip install {' '.join(MISSING_LIBS)}")
    print("=" * 60)
    sys.exit(1)

import time

from test_integration_wav_helpers import (
    CHINESE_WAV,
    ENGLISH_WAV,
    logger,
)
from test_integration_wav_requests import (
    test_health_check,
    test_utterance_request,
    test_multiple_requests,
    test_worker_stability,
)


def main():
    """运行所有测试"""
    logger.info("=" * 60)
    logger.info("ASR 服务集成测试（使用真实 WAV 文件）")
    logger.info("=" * 60)
    logger.info("")

    if not os.path.exists(CHINESE_WAV):
        logger.error(f"❌ 中文测试文件不存在: {CHINESE_WAV}")
        return 1
    if not os.path.exists(ENGLISH_WAV):
        logger.error(f"❌ 英文测试文件不存在: {ENGLISH_WAV}")
        return 1

    logger.info("✅ 测试文件检查通过")
    logger.info(f"   中文文件: {CHINESE_WAV}")
    logger.info(f"   英文文件: {ENGLISH_WAV}")
    logger.info("")

    results = []

    results.append(("健康检查", test_health_check()))
    time.sleep(1)

    if os.path.exists(CHINESE_WAV):
        results.append(("中文识别", test_utterance_request(CHINESE_WAV, "zh", "opus", True)))
        time.sleep(2)

    if os.path.exists(ENGLISH_WAV):
        results.append(("英文识别", test_utterance_request(ENGLISH_WAV, "en", "opus", True)))
        time.sleep(2)

    results.append(("多个顺序请求", test_multiple_requests()))
    time.sleep(2)

    results.append(("Worker 稳定性", test_worker_stability()))

    logger.info("")
    logger.info("=" * 60)
    logger.info("测试结果总结")
    logger.info("=" * 60)

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
    logger.info(f"总计: {passed} 通过, {failed} 失败")

    if failed == 0:
        logger.info("")
        logger.info("🎉 所有测试通过！")
        return 0
    else:
        logger.info("")
        logger.info("⚠️  部分测试失败，请检查日志")
        return 1


if __name__ == "__main__":
    exit(main())
