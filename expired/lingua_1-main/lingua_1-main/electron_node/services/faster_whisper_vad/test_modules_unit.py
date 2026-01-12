"""
faster_whisper_vad 模块单元测试
测试各个模块的功能，不依赖服务运行
"""

import unittest
import numpy as np
import logging
from unittest.mock import Mock, patch, MagicMock

# 配置日志
logging.basicConfig(level=logging.WARNING)  # 减少测试时的日志输出

class TestConfig(unittest.TestCase):
    """测试配置模块"""
    
    def test_config_import(self):
        """测试配置模块可以正常导入"""
        try:
            import config
            self.assertTrue(hasattr(config, 'ASR_MODEL_PATH'))
            self.assertTrue(hasattr(config, 'ASR_DEVICE'))
            self.assertTrue(hasattr(config, 'VAD_MODEL_PATH'))
            self.assertTrue(hasattr(config, 'PORT'))
            self.assertTrue(hasattr(config, 'MAX_AUDIO_DURATION_SEC'))
            print("✅ 配置模块导入成功")
        except Exception as e:
            self.fail(f"配置模块导入失败: {e}")

class TestTextFilter(unittest.TestCase):
    """测试文本过滤模块"""
    
    def setUp(self):
        from text_filter import is_meaningless_transcript
        self.is_meaningless = is_meaningless_transcript
    
    def test_empty_text(self):
        """测试空文本"""
        self.assertTrue(self.is_meaningless(""))
        self.assertTrue(self.is_meaningless("   "))
        print("✅ 空文本过滤测试通过")
    
    def test_single_char_fillers(self):
        """测试单个字符语气词"""
        fillers = ["嗯", "啊", "呃", "哦", "um", "uh"]
        for filler in fillers:
            self.assertTrue(self.is_meaningless(filler), f"应该过滤: {filler}")
        print("✅ 单个字符语气词过滤测试通过")
    
    def test_punctuation(self):
        """测试标点符号"""
        texts_with_punctuation = [
            "你好，世界",
            "Hello, world!",
            "测试。",
            "测试？",
        ]
        for text in texts_with_punctuation:
            self.assertTrue(self.is_meaningless(text), f"应该过滤: {text}")
        print("✅ 标点符号过滤测试通过")
    
    def test_brackets(self):
        """测试括号"""
        texts_with_brackets = [
            "(笑)",
            "（字幕）",
            "[注释]",
            "【说明】",
        ]
        for text in texts_with_brackets:
            self.assertTrue(self.is_meaningless(text), f"应该过滤: {text}")
        print("✅ 括号过滤测试通过")
    
    def test_exact_matches(self):
        """测试精确匹配"""
        exact_matches = [
            "谢谢大家",
            "感谢观看",
            "The",
            "谢谢",
        ]
        for text in exact_matches:
            self.assertTrue(self.is_meaningless(text), f"应该过滤: {text}")
        print("✅ 精确匹配过滤测试通过")
    
    def test_valid_text(self):
        """测试有效文本"""
        valid_texts = [
            "你好世界",
            "Hello world",
            "这是一段正常的文本",
            "This is a normal text",
        ]
        for text in valid_texts:
            self.assertFalse(self.is_meaningless(text), f"不应该过滤: {text}")
        print("✅ 有效文本测试通过")

class TestContext(unittest.TestCase):
    """测试上下文管理模块"""
    
    def setUp(self):
        from context import (
            reset_context_buffer,
            reset_text_context,
            get_context_audio,
            get_text_context,
            update_context_buffer,
            update_text_context,
        )
        self.reset_context_buffer = reset_context_buffer
        self.reset_text_context = reset_text_context
        self.get_context_audio = get_context_audio
        self.get_text_context = get_text_context
        self.update_context_buffer = update_context_buffer
        self.update_text_context = update_text_context
    
    def test_context_buffer_reset(self):
        """测试上下文缓冲区重置"""
        self.reset_context_buffer()
        audio = self.get_context_audio()
        self.assertEqual(len(audio), 0)
        print("✅ 上下文缓冲区重置测试通过")
    
    def test_context_buffer_update(self):
        """测试上下文缓冲区更新"""
        self.reset_context_buffer()
        
        # 创建测试音频
        test_audio = np.random.randn(32000).astype(np.float32)  # 2秒 @ 16kHz
        vad_segments = [(0, 16000)]  # 第一个1秒是语音
        
        self.update_context_buffer(test_audio, vad_segments)
        context_audio = self.get_context_audio()
        
        self.assertGreater(len(context_audio), 0)
        print("✅ 上下文缓冲区更新测试通过")
    
    def test_text_context(self):
        """测试文本上下文"""
        self.reset_text_context()
        
        # 初始应该为空
        text = self.get_text_context()
        self.assertEqual(text, "")
        
        # 更新文本上下文
        self.update_text_context("这是一段测试文本")
        text = self.get_text_context()
        self.assertEqual(text, "这是一段测试文本")
        
        # 再次更新应该替换
        self.update_text_context("新的文本")
        text = self.get_text_context()
        self.assertEqual(text, "新的文本")
        
        print("✅ 文本上下文测试通过")

class TestVAD(unittest.TestCase):
    """测试VAD模块"""
    
    def setUp(self):
        from vad import VADState, vad_state
        self.VADState = VADState
        self.vad_state = vad_state
    
    def test_vad_state_reset(self):
        """测试VAD状态重置"""
        self.vad_state.reset()
        self.assertIsNone(self.vad_state.hidden_state)
        self.assertEqual(self.vad_state.silence_frame_count, 0)
        self.assertIsNone(self.vad_state.last_speech_timestamp)
        print("✅ VAD状态重置测试通过")
    
    def test_vad_state_initialization(self):
        """测试VAD状态初始化"""
        state = self.VADState()
        self.assertIsNone(state.hidden_state)
        self.assertEqual(state.silence_frame_count, 0)
        self.assertIsNotNone(state.lock)
        print("✅ VAD状态初始化测试通过")

class TestAudioDecoder(unittest.TestCase):
    """测试音频解码模块"""
    
    def test_module_import(self):
        """测试音频解码模块可以正常导入"""
        try:
            import audio_decoder
            self.assertTrue(hasattr(audio_decoder, 'decode_audio'))
            self.assertTrue(hasattr(audio_decoder, 'PLAN_A_AVAILABLE'))
            print("✅ 音频解码模块导入成功")
        except Exception as e:
            self.fail(f"音频解码模块导入失败: {e}")
    
    def test_decode_audio_interface(self):
        """测试音频解码接口"""
        try:
            from audio_decoder import decode_audio
            # 测试接口存在（不实际调用，因为需要base64音频数据）
            self.assertTrue(callable(decode_audio))
            print("✅ 音频解码接口测试通过")
        except Exception as e:
            self.fail(f"音频解码接口测试失败: {e}")

class TestServiceStructure(unittest.TestCase):
    """测试服务结构"""
    
    def test_service_import(self):
        """测试服务模块可以正常导入（不启动服务）"""
        try:
            # 只导入模块，不运行
            import faster_whisper_vad_service
            self.assertTrue(hasattr(faster_whisper_vad_service, 'app'))
            self.assertTrue(hasattr(faster_whisper_vad_service, 'UtteranceRequest'))
            self.assertTrue(hasattr(faster_whisper_vad_service, 'UtteranceResponse'))
            print("✅ 服务模块导入成功")
        except Exception as e:
            self.fail(f"服务模块导入失败: {e}")

def run_tests():
    """运行所有测试"""
    print("=" * 60)
    print("faster_whisper_vad 模块单元测试")
    print("=" * 60)
    print()
    
    # 创建测试套件
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # 添加测试类
    test_classes = [
        TestConfig,
        TestTextFilter,
        TestContext,
        TestVAD,
        TestAudioDecoder,
        TestServiceStructure,
    ]
    
    for test_class in test_classes:
        tests = loader.loadTestsFromTestCase(test_class)
        suite.addTests(tests)
    
    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # 输出结果
    print()
    print("=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    print(f"运行测试: {result.testsRun}")
    print(f"成功: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"失败: {len(result.failures)}")
    print(f"错误: {len(result.errors)}")
    
    if result.failures:
        print("\n失败的测试:")
        for test, traceback in result.failures:
            print(f"  - {test}: {traceback[:200]}")
    
    if result.errors:
        print("\n错误的测试:")
        for test, traceback in result.errors:
            print(f"  - {test}: {traceback[:200]}")
    
    print()
    if result.wasSuccessful():
        print("🎉 所有模块测试通过！")
        return True
    else:
        print("⚠️ 部分测试失败，请检查日志")
        return False

if __name__ == "__main__":
    success = run_tests()
    exit(0 if success else 1)

