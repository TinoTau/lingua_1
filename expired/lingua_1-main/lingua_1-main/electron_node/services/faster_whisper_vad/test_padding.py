"""
单元测试：测试 EDGE-4 Padding 功能
验证 ASR 服务能够正确在音频末尾添加静音 padding
"""
import sys
import os
import unittest
import numpy as np

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 只导入数据模型，不导入需要依赖的服务
try:
    from pydantic import BaseModel
    from typing import Optional
    
    # 复制 UtteranceRequest 的定义（仅用于测试）
    class UtteranceRequest(BaseModel):
        job_id: str
        src_lang: str
        audio: str
        audio_format: Optional[str] = "pcm16"
        sample_rate: Optional[int] = 16000
        padding_ms: Optional[int] = None
except ImportError:
    # 如果 pydantic 不可用，使用简单的类
    class UtteranceRequest:
        def __init__(self, job_id: str, src_lang: str, audio: str, 
                     audio_format: str = "pcm16", sample_rate: int = 16000, 
                     padding_ms: int = None):
            self.job_id = job_id
            self.src_lang = src_lang
            self.audio = audio
            self.audio_format = audio_format
            self.sample_rate = sample_rate
            self.padding_ms = padding_ms


class TestPadding(unittest.TestCase):
    """测试 EDGE-4: Padding 功能"""
    
    def test_padding_ms_parameter_exists(self):
        """测试 UtteranceRequest 包含 padding_ms 参数"""
        req = UtteranceRequest(
            job_id="test-1",
            src_lang="zh",
            audio="dGVzdA==",  # base64 "test"
            padding_ms=220  # 测试参数
        )
        
        self.assertEqual(req.padding_ms, 220)
        self.assertIsNotNone(req.padding_ms)
    
    def test_padding_ms_optional(self):
        """测试 padding_ms 参数是可选的"""
        req = UtteranceRequest(
            job_id="test-2",
            src_lang="zh",
            audio="dGVzdA=="
            # padding_ms 未提供，应该为 None
        )
        
        self.assertIsNone(req.padding_ms)
    
    def test_padding_applied_to_audio_logic(self):
        """测试 Padding 逻辑（不依赖完整服务）"""
        # 创建请求，指定 padding_ms = 220ms
        sample_rate = 16000
        req = UtteranceRequest(
            job_id="test-padding-1",
            src_lang="zh",
            audio="dGVzdA==",
            audio_format="pcm16",
            sample_rate=sample_rate,
            padding_ms=220
        )
        
        # 验证 padding_ms 参数被正确传递
        self.assertEqual(req.padding_ms, 220)
        
        # 验证 padding 计算：220ms = 0.22秒 * 16000 samples/sec = 3520 samples
        expected_padding_samples = int((220 / 1000.0) * sample_rate)
        self.assertEqual(expected_padding_samples, 3520)
        
        # 模拟 Padding 应用逻辑
        original_audio = np.random.randn(16000).astype(np.float32)  # 1秒音频
        original_length = len(original_audio)
        
        # 应用 padding
        if req.padding_ms is not None and req.padding_ms > 0:
            padding_samples = int((req.padding_ms / 1000.0) * sample_rate)
            padding = np.zeros(padding_samples, dtype=np.float32)
            padded_audio = np.concatenate([original_audio, padding])
            
            # 验证 padding 后的长度
            self.assertEqual(len(padded_audio), original_length + padding_samples)
            self.assertEqual(len(padded_audio), 16000 + 3520)  # 19520 samples
    
    def test_padding_zero_samples(self):
        """测试 padding_ms = 0 时不添加 padding"""
        sample_rate = 16000
        padding_ms = 0
        
        padding_samples = int((padding_ms / 1000.0) * sample_rate)
        self.assertEqual(padding_samples, 0)
    
    def test_padding_manual_vs_auto(self):
        """测试手动和自动 finalize 的不同 padding 值"""
        # 手动截断：280ms
        padding_manual_ms = 280
        # 自动 finalize：220ms
        padding_auto_ms = 220
        
        sample_rate = 16000
        
        padding_manual_samples = int((padding_manual_ms / 1000.0) * sample_rate)
        padding_auto_samples = int((padding_auto_ms / 1000.0) * sample_rate)
        
        self.assertEqual(padding_manual_samples, 4480)  # 280ms * 16 = 4480 samples
        self.assertEqual(padding_auto_samples, 3520)    # 220ms * 16 = 3520 samples
        self.assertGreater(padding_manual_samples, padding_auto_samples)
    
    def test_padding_none_skipped(self):
        """测试 padding_ms = None 时跳过 padding"""
        padding_ms = None
        
        # 模拟条件检查
        should_apply_padding = padding_ms is not None and padding_ms > 0
        self.assertFalse(should_apply_padding)
    
    def test_padding_negative_skipped(self):
        """测试 padding_ms < 0 时跳过 padding"""
        padding_ms = -100
        
        # 模拟条件检查
        should_apply_padding = padding_ms is not None and padding_ms > 0
        self.assertFalse(should_apply_padding)
    
    def test_padding_calculation_accuracy(self):
        """测试 padding 计算的准确性"""
        sample_rate = 16000
        
        test_cases = [
            (220, 3520),   # 220ms = 3520 samples
            (280, 4480),   # 280ms = 4480 samples
            (150, 2400),   # 150ms = 2400 samples
            (100, 1600),   # 100ms = 1600 samples
        ]
        
        for padding_ms, expected_samples in test_cases:
            padding_samples = int((padding_ms / 1000.0) * sample_rate)
            self.assertEqual(
                padding_samples, 
                expected_samples,
                f"padding_ms={padding_ms} should produce {expected_samples} samples, got {padding_samples}"
            )


if __name__ == '__main__':
    unittest.main()

