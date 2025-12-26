"""
测试语言概率信息提取功能
验证 Faster Whisper 返回的 language_probabilities 是否正确提取和传递
"""
import sys
import os
import asyncio
import logging
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def test_language_probabilities():
    """测试语言概率信息提取"""
    try:
        from asr_worker_manager import ASRWorkerManager, ASRResult
        import numpy as np
        
        logger.info("=" * 80)
        logger.info("🧪 测试语言概率信息提取功能")
        logger.info("=" * 80)
        
        # 创建 ASR Worker Manager
        manager = ASRWorkerManager()
        await manager.start()
        logger.info("✅ ASR Worker Manager 启动成功")
        
        # 生成测试音频（1秒的静音，用于测试）
        sample_rate = 16000
        duration_sec = 1.0
        audio = np.zeros(int(sample_rate * duration_sec), dtype=np.float32)
        
        # 提交任务（使用自动语言检测）
        logger.info("📤 提交 ASR 任务（自动语言检测）...")
        asr_result = await manager.submit_task(
            audio=audio,
            sample_rate=sample_rate,
            language=None,  # 自动检测
            task="transcribe",
            beam_size=5,
            initial_prompt=None,
            condition_on_previous_text=False,
            trace_id="test-language-probabilities",
            max_wait=30.0
        )
        
        # 检查结果
        logger.info("=" * 80)
        logger.info("📊 ASR 结果分析")
        logger.info("=" * 80)
        logger.info(f"文本: {asr_result.text}")
        logger.info(f"检测到的语言: {asr_result.language}")
        logger.info(f"语言概率: {asr_result.language_probability}")
        logger.info(f"所有语言概率: {asr_result.language_probabilities}")
        
        # 验证字段存在
        assert hasattr(asr_result, 'language'), "❌ ASRResult 缺少 language 字段"
        assert hasattr(asr_result, 'language_probability'), "❌ ASRResult 缺少 language_probability 字段"
        assert hasattr(asr_result, 'language_probabilities'), "❌ ASRResult 缺少 language_probabilities 字段"
        logger.info("✅ ASRResult 字段验证通过")
        
        # 验证 language_probabilities 格式
        if asr_result.language_probabilities:
            assert isinstance(asr_result.language_probabilities, dict), "❌ language_probabilities 应该是字典类型"
            logger.info(f"✅ language_probabilities 格式正确（字典，包含 {len(asr_result.language_probabilities)} 个语言）")
            
            # 打印所有语言的概率
            logger.info("📋 所有语言的概率:")
            for lang, prob in sorted(asr_result.language_probabilities.items(), key=lambda x: x[1], reverse=True):
                logger.info(f"  {lang}: {prob:.4f}")
        
        # 验证 language_probability 与 language_probabilities 的一致性
        if asr_result.language and asr_result.language_probabilities:
            expected_prob = asr_result.language_probabilities.get(asr_result.language)
            if expected_prob is not None and asr_result.language_probability is not None:
                assert abs(asr_result.language_probability - expected_prob) < 0.0001, \
                    f"❌ language_probability ({asr_result.language_probability}) 与 language_probabilities[{asr_result.language}] ({expected_prob}) 不一致"
                logger.info(f"✅ language_probability 与 language_probabilities 一致")
        
        logger.info("=" * 80)
        logger.info("✅ 测试通过！")
        logger.info("=" * 80)
        
        # 停止 Manager
        await manager.stop()
        logger.info("✅ ASR Worker Manager 已停止")
        
    except Exception as e:
        logger.error(f"❌ 测试失败: {e}", exc_info=True)
        raise

if __name__ == "__main__":
    asyncio.run(test_language_probabilities())

