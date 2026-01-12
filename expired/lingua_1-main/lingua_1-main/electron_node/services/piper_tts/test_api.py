#!/usr/bin/env python3
"""
测试 piper_http_server.py API 端点
"""

import os
import sys
import unittest
from unittest.mock import patch, MagicMock

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from fastapi.testclient import TestClient
    FASTAPI_TEST_AVAILABLE = True
except ImportError:
    FASTAPI_TEST_AVAILABLE = False

from piper_http_server import app


class TestApiEndpoints(unittest.TestCase):
    """测试 API 端点"""
    
    @unittest.skipIf(not FASTAPI_TEST_AVAILABLE, "FastAPI TestClient not available")
    def setUp(self):
        """设置测试客户端"""
        self.client = TestClient(app)
    
    def test_health_check(self):
        """测试健康检查端点"""
        if not FASTAPI_TEST_AVAILABLE:
            self.skipTest("FastAPI TestClient not available")
        
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "piper-tts")
    
    def test_list_voices_empty(self):
        """测试列出语音（空列表）"""
        if not FASTAPI_TEST_AVAILABLE:
            self.skipTest("FastAPI TestClient not available")
        
        with patch('piper_http_server.Path') as mock_path:
            mock_model_dir = MagicMock()
            mock_model_dir.exists.return_value = False
            mock_path.return_value.expanduser.return_value = mock_model_dir
            
            response = self.client.get("/voices")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertIn("voices", data)
            self.assertEqual(len(data["voices"]), 0)
    
    @patch('piper_http_server.find_model_path')
    @patch('piper_http_server.synthesize_with_python_api')
    def test_tts_endpoint_success(self, mock_synthesize, mock_find_model):
        """测试 TTS 端点成功"""
        if not FASTAPI_TEST_AVAILABLE:
            self.skipTest("FastAPI TestClient not available")
        
        # Mock 模型路径查找
        mock_find_model.return_value = ("fake_model.onnx", "fake_config.json")
        
        # Mock 合成函数
        from fastapi.responses import Response
        mock_response = Response(
            content=b'RIFF' + b'\x00' * 40 + b'fake audio',
            media_type="audio/wav"
        )
        mock_synthesize.return_value = mock_response
        
        # Mock 环境变量
        with patch.dict(os.environ, {"PIPER_MODEL_DIR": "/fake/models", "PIPER_USE_GPU": "false"}):
            with patch('piper_http_server.PIPER_PYTHON_API_AVAILABLE', True):
                response = self.client.post(
                    "/tts",
                    json={
                        "text": "Hello, world!",
                        "voice": "en_US-lessac-medium"
                    }
                )
                # 应该返回音频数据
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "audio/wav")
    
    @patch('piper_http_server.find_model_path')
    def test_tts_endpoint_model_not_found(self, mock_find_model):
        """测试 TTS 端点模型未找到"""
        if not FASTAPI_TEST_AVAILABLE:
            self.skipTest("FastAPI TestClient not available")
        
        # Mock 模型路径查找返回 None
        mock_find_model.return_value = (None, None)
        
        with patch.dict(os.environ, {"PIPER_MODEL_DIR": "/fake/models"}):
            response = self.client.post(
                "/tts",
                json={
                    "text": "Hello, world!",
                    "voice": "nonexistent-voice"
                }
            )
            # 应该返回 404
            self.assertEqual(response.status_code, 404)
            data = response.json()
            self.assertIn("detail", data)
            self.assertIn("not found", data["detail"].lower())
    
    def test_tts_endpoint_invalid_request(self):
        """测试 TTS 端点无效请求"""
        if not FASTAPI_TEST_AVAILABLE:
            self.skipTest("FastAPI TestClient not available")
        
        # 缺少必需字段
        response = self.client.post(
            "/tts",
            json={
                "text": "Hello, world!"
                # 缺少 voice 字段
            }
        )
        # 应该返回 422 (Validation Error)
        self.assertEqual(response.status_code, 422)
    
    @patch('piper_http_server.find_model_path')
    @patch('piper_http_server.synthesize_with_python_api')
    @patch('piper_http_server.synthesize_with_command_line')
    def test_tts_endpoint_fallback_to_cli(self, mock_cli, mock_api, mock_find_model):
        """测试 TTS 端点回退到命令行工具"""
        if not FASTAPI_TEST_AVAILABLE:
            self.skipTest("FastAPI TestClient not available")
        
        # Mock 模型路径查找
        mock_find_model.return_value = ("fake_model.onnx", "fake_config.json")
        
        # Mock API 合成失败
        mock_api.side_effect = Exception("API failed")
        
        # Mock CLI 合成成功
        from fastapi.responses import Response
        mock_response = Response(
            content=b'RIFF' + b'\x00' * 40 + b'fake audio',
            media_type="audio/wav"
        )
        mock_cli.return_value = mock_response
        
        with patch.dict(os.environ, {"PIPER_MODEL_DIR": "/fake/models", "PIPER_USE_GPU": "false"}):
            with patch('piper_http_server.PIPER_PYTHON_API_AVAILABLE', True):
                response = self.client.post(
                    "/tts",
                    json={
                        "text": "Hello, world!",
                        "voice": "en_US-lessac-medium"
                    }
                )
                # 应该成功（回退到 CLI）
                self.assertEqual(response.status_code, 200)
                # 应该调用了 CLI 方法
                mock_cli.assert_called_once()


if __name__ == "__main__":
    unittest.main()
