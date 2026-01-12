#!/usr/bin/env python3
"""
测试 models.py 模块
"""

import unittest
from models import TtsRequest


class TestTtsRequest(unittest.TestCase):
    """测试 TtsRequest 模型"""
    
    def test_create_request_with_required_fields(self):
        """测试创建包含必需字段的请求"""
        request = TtsRequest(text="Hello", voice="en_US-lessac-medium")
        self.assertEqual(request.text, "Hello")
        self.assertEqual(request.voice, "en_US-lessac-medium")
        self.assertIsNone(request.language)
    
    def test_create_request_with_language(self):
        """测试创建包含语言字段的请求"""
        request = TtsRequest(
            text="你好",
            voice="zh_CN-huayan-medium",
            language="zh"
        )
        self.assertEqual(request.text, "你好")
        self.assertEqual(request.voice, "zh_CN-huayan-medium")
        self.assertEqual(request.language, "zh")
    
    def test_request_validation(self):
        """测试请求验证"""
        # 应该能够创建有效的请求
        request = TtsRequest(text="Test", voice="test-voice")
        self.assertIsNotNone(request)
        
        # 缺少必需字段应该抛出异常
        with self.assertRaises(Exception):
            TtsRequest(text="Test")  # 缺少 voice
    
    def test_request_with_unicode_text(self):
        """测试包含 Unicode 字符的文本"""
        request = TtsRequest(
            text="你好世界！Hello World!",
            voice="zh_CN-huayan-medium"
        )
        self.assertEqual(request.text, "你好世界！Hello World!")
        # 检查文本长度（中文字符和英文字符）
        self.assertGreater(len(request.text), 0)
    
    def test_request_json_serialization(self):
        """测试请求的 JSON 序列化"""
        request = TtsRequest(
            text="Test text",
            voice="test-voice",
            language="en"
        )
        # Pydantic 模型应该能够转换为字典
        request_dict = request.model_dump() if hasattr(request, 'model_dump') else request.dict()
        self.assertIn("text", request_dict)
        self.assertIn("voice", request_dict)
        self.assertIn("language", request_dict)
        self.assertEqual(request_dict["text"], "Test text")
        self.assertEqual(request_dict["voice"], "test-voice")
        self.assertEqual(request_dict["language"], "en")


if __name__ == "__main__":
    unittest.main()
