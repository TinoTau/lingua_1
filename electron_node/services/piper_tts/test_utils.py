#!/usr/bin/env python3
"""
测试 utils.py 模块
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import (
    find_piper_command,
    find_model_path,
    create_wav_header,
    get_or_load_voice,
    PIPER_PYTHON_API_AVAILABLE
)


class TestFindPiperCommand(unittest.TestCase):
    """测试 find_piper_command 函数"""
    
    def test_find_piper_from_env(self):
        """测试从环境变量查找 piper 命令"""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".exe" if sys.platform == "win32" else "") as tmp:
            tmp_path = tmp.name
            tmp.write(b"fake piper")
            tmp.close()
            
            with patch.dict(os.environ, {"PIPER_CMD": tmp_path}):
                result = find_piper_command()
                self.assertEqual(result, tmp_path)
            
            os.unlink(tmp_path)
    
    def test_find_piper_from_venv(self):
        """测试从虚拟环境查找 piper 命令"""
        with tempfile.TemporaryDirectory() as tmpdir:
            if sys.platform == "win32":
                venv_scripts = Path(tmpdir) / "Scripts"
                venv_scripts.mkdir(parents=True)
                piper_exe = venv_scripts / "piper.exe"
            else:
                venv_bin = Path(tmpdir) / "bin"
                venv_bin.mkdir(parents=True)
                piper_exe = venv_bin / "piper"
            
            piper_exe.write_text("#!/bin/bash\necho piper")
            if sys.platform != "win32":
                os.chmod(piper_exe, 0o755)
            
            with patch.dict(os.environ, {"VIRTUAL_ENV": tmpdir}, clear=False):
                result = find_piper_command()
                self.assertEqual(result, str(piper_exe))
    
    def test_find_piper_default(self):
        """测试默认返回 'piper'"""
        with patch.dict(os.environ, {}, clear=True):
            with patch('subprocess.run', side_effect=FileNotFoundError()):
                result = find_piper_command()
                self.assertEqual(result, "piper")


class TestFindModelPath(unittest.TestCase):
    """测试 find_model_path 函数"""
    
    def setUp(self):
        """设置测试环境"""
        self.temp_dir = tempfile.mkdtemp()
        self.model_dir = Path(self.temp_dir)
    
    def tearDown(self):
        """清理测试环境"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_find_standard_model(self):
        """测试查找标准模型路径"""
        # 创建标准结构：zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx
        model_path = self.model_dir / "zh" / "zh_CN-huayan-medium" / "zh_CN-huayan-medium.onnx"
        config_path = self.model_dir / "zh" / "zh_CN-huayan-medium" / "zh_CN-huayan-medium.onnx.json"
        model_path.parent.mkdir(parents=True)
        model_path.write_bytes(b"fake model")
        config_path.write_bytes(b'{"config": "fake"}')
        
        found_model, found_config = find_model_path("zh_CN-huayan-medium", str(self.model_dir))
        self.assertEqual(found_model, str(model_path))
        self.assertEqual(found_config, str(config_path))
    
    def test_find_flat_model(self):
        """测试查找扁平结构模型"""
        # 创建扁平结构：zh/zh_CN-huayan-medium.onnx
        model_path = self.model_dir / "zh" / "zh_CN-huayan-medium.onnx"
        model_path.parent.mkdir(parents=True)
        model_path.write_bytes(b"fake model")
        
        found_model, found_config = find_model_path("zh_CN-huayan-medium", str(self.model_dir))
        self.assertEqual(found_model, str(model_path))
        self.assertIsNone(found_config)  # 没有配置文件
    
    def test_find_vits_model(self):
        """测试查找 VITS 模型"""
        # 创建 VITS 模型结构
        vits_path = self.model_dir / "vits-zh-aishell3" / "vits-aishell3.onnx"
        vits_path.parent.mkdir(parents=True)
        vits_path.write_bytes(b"fake vits model")
        
        found_model, found_config = find_model_path("zh_CN-huayan-medium", str(self.model_dir))
        # 应该找到 VITS 模型作为后备
        self.assertIsNotNone(found_model)
        self.assertIn("vits-zh-aishell3", found_model)
    
    def test_model_not_found(self):
        """测试模型未找到的情况"""
        found_model, found_config = find_model_path("nonexistent-voice", str(self.model_dir))
        self.assertIsNone(found_model)
        self.assertIsNone(found_config)


class TestCreateWavHeader(unittest.TestCase):
    """测试 create_wav_header 函数"""
    
    def test_create_wav_header_basic(self):
        """测试创建基本的 WAV 文件头"""
        audio_data = b"\x00\x00" * 100  # 200 字节的音频数据
        wav_data = create_wav_header(audio_data, sample_rate=22050, channels=1, bits_per_sample=16)
        
        # 检查 WAV 文件头
        self.assertEqual(wav_data[:4], b'RIFF')
        self.assertEqual(wav_data[8:12], b'WAVE')
        self.assertEqual(wav_data[12:16], b'fmt ')
        self.assertEqual(wav_data[36:40], b'data')
        
        # 检查文件大小
        file_size = int.from_bytes(wav_data[4:8], byteorder='little')
        self.assertEqual(file_size, 36 + len(audio_data))
    
    def test_create_wav_header_different_params(self):
        """测试使用不同参数创建 WAV 文件头"""
        audio_data = b"\x00\x00" * 50
        wav_data = create_wav_header(
            audio_data,
            sample_rate=44100,
            channels=2,
            bits_per_sample=16
        )
        
        self.assertEqual(wav_data[:4], b'RIFF')
        self.assertEqual(wav_data[8:12], b'WAVE')
    
    def test_wav_header_contains_audio_data(self):
        """测试 WAV 文件头包含原始音频数据"""
        audio_data = b"test audio data"
        wav_data = create_wav_header(audio_data)
        
        # 音频数据应该在文件头之后
        self.assertIn(audio_data, wav_data)
        self.assertEqual(wav_data[-len(audio_data):], audio_data)


class TestGetOrLoadVoice(unittest.TestCase):
    """测试 get_or_load_voice 函数"""
    
    @unittest.skipIf(not PIPER_PYTHON_API_AVAILABLE, "Piper Python API not available")
    def test_get_or_load_voice_raises_when_api_unavailable(self):
        """测试当 API 不可用时抛出异常"""
        # 这个测试需要 mock，因为实际加载模型需要文件
        pass
    
    def test_get_or_load_voice_without_api(self):
        """测试当 API 不可用时的行为"""
        if not PIPER_PYTHON_API_AVAILABLE:
            with self.assertRaises(RuntimeError):
                get_or_load_voice("fake_path", None, False)


if __name__ == "__main__":
    unittest.main()
