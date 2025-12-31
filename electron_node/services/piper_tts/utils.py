"""
工具函数模块
"""

import logging
import os
import struct
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple, Dict
from threading import Lock

try:
    from piper.voice import PiperVoice
    PIPER_PYTHON_API_AVAILABLE = True
except ImportError:
    PIPER_PYTHON_API_AVAILABLE = False

# 模型缓存（使用 Python API 时）
_voice_cache: Dict[str, PiperVoice] = {}
_cache_lock = Lock()


def find_piper_command() -> str:
    """查找 piper 命令路径"""
    # 首先尝试在 PATH 中查找
    piper_path = os.environ.get("PIPER_CMD")
    if piper_path and os.path.exists(piper_path):
        return piper_path
    
    # 尝试在虚拟环境中查找
    venv_bin = os.environ.get("VIRTUAL_ENV")
    if venv_bin:
        # Windows 使用 Scripts/piper.exe，Linux/Mac 使用 bin/piper
        if sys.platform == "win32":
            venv_piper = os.path.join(venv_bin, "Scripts", "piper.exe")
        else:
            venv_piper = os.path.join(venv_bin, "bin", "piper")
        if os.path.exists(venv_piper):
            return venv_piper
    
    # 使用 which 查找（Windows 使用 where）
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["where", "piper"],
                capture_output=True,
                text=True,
                check=True
            )
        else:
            result = subprocess.run(
                ["which", "piper"],
                capture_output=True,
                text=True,
                check=True
            )
        return result.stdout.strip().split('\n')[0]
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    
    # 默认假设 piper 在 PATH 中
    return "piper"


def find_model_path(voice: str, model_dir: str) -> Tuple[Optional[str], Optional[str]]:
    """
    查找模型文件路径
    返回: (model_path, config_path)
    """
    model_dir_path = Path(model_dir).expanduser()
    
    # 从 voice 名称推断语言代码（例如：en_US-lessac-medium -> en）
    language_code = None
    if voice.startswith("zh_"):
        language_code = "zh"
    elif voice.startswith("en_"):
        language_code = "en"
    
    possible_paths = [
        # 优先：标准 Piper 中文模型（zh_CN-huayan-medium）
        model_dir_path / "zh" / voice / f"{voice}.onnx" if language_code == "zh" else None,
        # 扁平结构：{model_dir}/{lang}/{voice}.onnx（最常见）
        model_dir_path / language_code / f"{voice}.onnx" if language_code else None,
        # 标准结构：{model_dir}/{lang}/{voice}/{voice}.onnx
        model_dir_path / language_code / voice / f"{voice}.onnx" if language_code else None,
        # 旧结构：{model_dir}/{voice}/{voice}.onnx
        model_dir_path / voice / f"{voice}.onnx",
        # 旧结构：{model_dir}/zh/{voice}.onnx（向后兼容）
        model_dir_path / "zh" / f"{voice}.onnx",
        # 根目录：{model_dir}/{voice}.onnx
        model_dir_path / f"{voice}.onnx",
    ]
    
    # 添加 VITS 模型支持（作为后备选项）
    # 如果请求英文模型但找不到，尝试查找 vits_en 模型
    if language_code == "en":
        # 尝试多个可能的文件名
        vits_en_paths = [
            model_dir_path / "vits_en" / "model.onnx",
            model_dir_path / "vits_en" / "vits_en.onnx",
        ]
        for vits_model_path in vits_en_paths:
            if vits_model_path.exists():
                possible_paths.append(vits_model_path)
                break
    
    # 如果请求中文模型但找不到，尝试查找 vits-zh 模型
    if language_code == "zh":
        # 尝试多个可能的文件名
        vits_zh_paths = [
            model_dir_path / "vits-zh-aishell3" / "model.onnx",
            model_dir_path / "vits-zh-aishell3" / "vits-aishell3.onnx",
            model_dir_path / "vits-zh-aishell3" / "vits-aishell3.int8.onnx",
        ]
        for vits_zh_model_path in vits_zh_paths:
            if vits_zh_model_path.exists():
                possible_paths.append(vits_zh_model_path)
                break
    
    for model_path in possible_paths:
        if model_path and model_path.exists():
            config_path = model_path.with_suffix(".onnx.json")
            return str(model_path), str(config_path) if config_path.exists() else None
    
    return None, None


def create_wav_header(audio_data: bytes, sample_rate: int = 22050, channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """创建 WAV 文件头"""
    # 计算数据大小
    data_size = len(audio_data)
    
    # WAV 文件头结构
    # RIFF header
    riff_header = b'RIFF'
    file_size = 36 + data_size  # 36 = 4 (WAVE) + 8 (fmt chunk header) + 16 (fmt chunk) + 8 (data chunk header)
    riff_chunk_size = struct.pack('<I', file_size)
    wave_format = b'WAVE'
    
    # fmt chunk
    fmt_chunk_id = b'fmt '
    fmt_chunk_size = struct.pack('<I', 16)  # PCM format chunk size
    audio_format = struct.pack('<H', 1)  # PCM = 1
    num_channels = struct.pack('<H', channels)
    sample_rate_bytes = struct.pack('<I', sample_rate)
    byte_rate = struct.pack('<I', sample_rate * channels * (bits_per_sample // 8))
    block_align = struct.pack('<H', channels * (bits_per_sample // 8))
    bits_per_sample_bytes = struct.pack('<H', bits_per_sample)
    
    # data chunk
    data_chunk_id = b'data'
    data_chunk_size = struct.pack('<I', data_size)
    
    # 组合 WAV 文件头
    wav_header = (
        riff_header +
        riff_chunk_size +
        wave_format +
        fmt_chunk_id +
        fmt_chunk_size +
        audio_format +
        num_channels +
        sample_rate_bytes +
        byte_rate +
        block_align +
        bits_per_sample_bytes +
        data_chunk_id +
        data_chunk_size
    )
    
    return wav_header + audio_data


def get_or_load_voice(model_path: str, config_path: Optional[str], use_gpu: bool) -> PiperVoice:
    """获取或加载语音模型（带缓存）"""
    if not PIPER_PYTHON_API_AVAILABLE:
        raise RuntimeError("Piper Python API not available")
    
    cache_key = f"{model_path}:{use_gpu}"
    
    with _cache_lock:
        if cache_key in _voice_cache:
            return _voice_cache[cache_key]
        
        # 加载模型
        logger = logging.getLogger("uvicorn.error")
        logger.info(f"Loading model: {model_path} (GPU: {use_gpu})")
        load_start = time.time()
        
        voice = PiperVoice.load(
            model_path,
            config_path=config_path,
            use_cuda=use_gpu
        )
        
        load_time = (time.time() - load_start) * 1000
        logger.info(f"Model loaded in {load_time:.2f}ms")
        
        # 检查 GPU 使用情况
        try:
            session = voice.session
            providers = session.get_providers()
            if 'CUDAExecutionProvider' in providers:
                logger.info(f"✓ Model using GPU (CUDAExecutionProvider)")
            else:
                logger.warning(f"⚠ Model using CPU (providers: {providers})")
        except Exception as e:
            logger.warning(f"Could not check execution providers: {e}")
        
        _voice_cache[cache_key] = voice
        return voice
