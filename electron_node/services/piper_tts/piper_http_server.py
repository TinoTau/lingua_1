#!/usr/bin/env python3
"""
Piper HTTP 服务包装器
通过 HTTP API 调用 piper 命令行工具进行 TTS 合成
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional, Tuple, Dict
from threading import Lock

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import Response
    from pydantic import BaseModel
    try:
        from pydantic import ConfigDict
        PYDANTIC_V2 = True
    except ImportError:
        PYDANTIC_V2 = False
    import uvicorn
except ImportError:
    print("ERROR: FastAPI and uvicorn are required. Please install:")
    print("  pip install fastapi uvicorn")
    sys.exit(1)

# 尝试导入 Piper Python API
try:
    from piper.voice import PiperVoice
    PIPER_PYTHON_API_AVAILABLE = True
except ImportError:
    PIPER_PYTHON_API_AVAILABLE = False
    print("WARNING: Piper Python API not available, will use command line tool (slower)")

# 导入中文音素化器
try:
    from chinese_phonemizer import ChinesePhonemizer
    CHINESE_PHONEMIZER_AVAILABLE = True
except ImportError:
    CHINESE_PHONEMIZER_AVAILABLE = False
    print("WARNING: ChinesePhonemizer not available, Chinese TTS may not work correctly.")


class TtsRequest(BaseModel):
    text: str
    voice: str
    language: Optional[str] = None
    
    # Pydantic V2 configuration (backward compatible)
    if PYDANTIC_V2:
        model_config = ConfigDict()
        # Note: json_encoders is removed in Pydantic V2
        # String encoding is handled automatically
    else:
        class Config:
            # Pydantic V1 configuration
            json_encoders = {
                str: lambda v: v.encode('utf-8').decode('utf-8') if isinstance(v, str) else v
            }


app = FastAPI(title="Piper TTS HTTP Service")

# 确保正确处理 UTF-8 编码
import sys
if sys.stdout.encoding != 'utf-8':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

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
    import struct
    
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
    cache_key = f"{model_path}:{use_gpu}"
    
    with _cache_lock:
        if cache_key in _voice_cache:
            return _voice_cache[cache_key]
        
        # 加载模型
        import logging
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


@app.post("/tts")
async def synthesize_tts(request: TtsRequest):
    """TTS 合成接口"""
    import logging
    logger = logging.getLogger("uvicorn.error")
    
    # 获取配置
    model_dir = os.environ.get("PIPER_MODEL_DIR", os.path.expanduser("~/piper_models"))
    
    # 查找模型文件
    model_path, config_path = find_model_path(request.voice, model_dir)
    if not model_path:
        raise HTTPException(
            status_code=404,
            detail=f"Model not found for voice: {request.voice} (searched in {model_dir})"
        )
    
    # 检查是否启用 GPU
    use_gpu = os.environ.get("PIPER_USE_GPU", "false").lower() == "true"
    
    # 优先使用 Python API（如果可用）
    if PIPER_PYTHON_API_AVAILABLE:
        try:
            synth_start = time.time()
            
            # 获取或加载模型（带缓存）
            voice = get_or_load_voice(model_path, config_path, use_gpu)
            
            # 检查是否是中文 VITS 模型（使用拼音音素）
            is_chinese_vits = False
            lexicon_path = None
            if config_path:
                config_dir = Path(config_path).parent
                # 检查是否是 vits-zh-aishell3 模型
                if "vits-zh-aishell3" in str(model_path) or "vits-zh-aishell3" in str(config_dir):
                    lexicon_path = config_dir / "lexicon.txt"
                    if lexicon_path.exists():
                        is_chinese_vits = True
                        logger.info(f"Detected Chinese VITS model, using lexicon-based phonemization")
            
            # 执行合成
            logger.info(f"Synthesizing text: {request.text} (length: {len(request.text)})")
            
            # 如果是中文 VITS 模型，使用自定义音素化器直接处理音素
            if is_chinese_vits and CHINESE_PHONEMIZER_AVAILABLE:
                try:
                    from chinese_phonemizer import ChinesePhonemizer
                    from piper.config import SynthesisConfig
                    from piper.voice import AudioChunk
                    import numpy as np
                    
                    # 检查文本编码（避免日志编码问题）
                    text_bytes = request.text.encode('utf-8')
                    logger.info(f"Input text: length={len(request.text)}, utf-8 bytes={len(text_bytes)}, first_char_hex={text_bytes[:3].hex() if len(text_bytes) >= 3 else 'N/A'}")
                    phonemizer = ChinesePhonemizer(str(lexicon_path))
                    sentence_phonemes = phonemizer.phonemize(request.text)
                    logger.info(f"Phonemized using lexicon: {len(sentence_phonemes)} sentences")
                    for idx, sent in enumerate(sentence_phonemes):
                        logger.info(f"  Sentence {idx}: {len(sent)} phonemes, first 10: {sent[:10] if sent else '[]'}")
                    
                    # 直接处理音素，不通过 synthesize() 方法
                    audio_chunks = []
                    syn_config = SynthesisConfig()  # 使用默认配置
                    
                    for idx, phonemes in enumerate(sentence_phonemes):
                        logger.info(f"Processing sentence {idx}: {len(phonemes)} phonemes")
                        if not phonemes:
                            logger.warning(f"Empty phonemes list for sentence {idx}, skipping")
                            continue
                        
                        logger.info(f"Processing phonemes: {phonemes[:10]}... (total: {len(phonemes)})")
                        
                        # 转换为音素ID（根据原项目文档，直接使用 phoneme_id_map，不添加 PAD）
                        # 格式：sil + 声母 + 韵母 + sp + ... + eos
                        # 示例：[0, 19, 81, 2, 14, 51, 2, ...]
                        # 注意：不使用 voice.phonemes_to_ids()，因为它会在每个音素后添加 PAD
                        phoneme_ids = []
                        for phoneme in phonemes:
                            if phoneme in voice.config.phoneme_id_map:
                                # phoneme_id_map 的值是列表，可能包含多个 ID
                                ids = voice.config.phoneme_id_map[phoneme]
                                phoneme_ids.extend(ids)
                            else:
                                logger.warning(f"Phoneme '{phoneme}' not found in phoneme_id_map, skipping")
                        logger.info(f"Converted to {len(phoneme_ids)} phoneme IDs: {phoneme_ids[:20]}...")
                        
                        if not phoneme_ids:
                            logger.error(f"No phoneme IDs generated, skipping")
                            continue
                        
                        # 生成音频（VITS 模型需要特殊处理）
                        # 检查模型输入名称以确定是否为 VITS 模型
                        session = voice.session
                        input_names = [inp.name for inp in session.get_inputs()]
                        is_vits_model = 'x' in input_names and 'x_length' in input_names
                        
                        if is_vits_model:
                            # VITS 模型使用不同的输入格式
                            logger.info("Using VITS model input format")
                            phoneme_ids_array = np.expand_dims(np.array(phoneme_ids, dtype=np.int64), 0)
                            phoneme_ids_lengths = np.array([phoneme_ids_array.shape[1]], dtype=np.int64)
                            
                            length_scale = syn_config.length_scale if syn_config.length_scale is not None else voice.config.length_scale
                            noise_scale = syn_config.noise_scale if syn_config.noise_scale is not None else voice.config.noise_scale
                            noise_w_scale = syn_config.noise_w_scale if syn_config.noise_w_scale is not None else voice.config.noise_w_scale
                            
                            # 确定 speaker_id（VITS 模型总是需要 sid）
                            if voice.config.num_speakers > 1:
                                speaker_id = syn_config.speaker_id if syn_config.speaker_id is not None else 0
                            else:
                                speaker_id = 0  # 单说话人模型也使用 0
                            
                            args = {
                                "x": phoneme_ids_array,
                                "x_length": phoneme_ids_lengths,
                                "noise_scale": np.array([noise_scale], dtype=np.float32),
                                "length_scale": np.array([length_scale], dtype=np.float32),
                                "noise_scale_w": np.array([noise_w_scale], dtype=np.float32),
                                "sid": np.array([speaker_id], dtype=np.int64),
                            }
                            
                            # 直接调用 ONNX 模型
                            audio = session.run(None, args)[0].squeeze()
                            logger.info(f"Generated audio using VITS format: shape={audio.shape if hasattr(audio, 'shape') else 'N/A'}, length={len(audio) if hasattr(audio, '__len__') else 'N/A'}")
                        else:
                            # 标准 Piper 模型
                            audio = voice.phoneme_ids_to_audio(phoneme_ids, syn_config)
                            logger.info(f"Generated audio using standard format: shape={audio.shape if hasattr(audio, 'shape') else 'N/A'}, length={len(audio) if hasattr(audio, '__len__') else 'N/A'}")
                        
                        # 归一化音频
                        if syn_config.normalize_audio:
                            max_val = np.max(np.abs(audio))
                            if max_val < 1e-8:
                                audio = np.zeros_like(audio)
                            else:
                                audio = audio / max_val
                        
                        if syn_config.volume != 1.0:
                            audio = audio * syn_config.volume
                        
                        audio = np.clip(audio, -1.0, 1.0).astype(np.float32)
                        
                        # 创建 AudioChunk
                        chunk = AudioChunk(
                            sample_rate=voice.config.sample_rate,
                            sample_width=2,
                            sample_channels=1,
                            audio_float_array=audio,
                        )
                        audio_chunks.append(chunk)
                    
                    logger.info(f"Generated {len(audio_chunks)} audio chunks using custom phonemizer")
                except Exception as e:
                    logger.error(f"Custom Chinese phonemization failed: {e}", exc_info=True)
                    import traceback
                    error_details = traceback.format_exc()
                    logger.error(f"Error details: {error_details}")
                    # 回退到标准方法
                    logger.warning("Falling back to standard synthesis method")
                    audio_generator = voice.synthesize(request.text)
                    audio_chunks = list(audio_generator)
            else:
                # 标准合成方法
                audio_generator = voice.synthesize(request.text)
                audio_chunks = list(audio_generator)
            
            # 合并音频数据
            audio_bytes = b''.join(
                chunk.audio_int16_bytes 
                for chunk in audio_chunks 
                if chunk.audio_int16_bytes
            )
            
            synth_time = (time.time() - synth_start) * 1000
            logger.info(f"Synthesis completed in {synth_time:.2f}ms (raw audio size: {len(audio_bytes)} bytes)")
            
            if not audio_bytes:
                raise HTTPException(
                    status_code=500,
                    detail="Generated audio is empty"
                )
            
            # 获取音频参数（从 voice 配置中）
            sample_rate = voice.config.sample_rate if hasattr(voice.config, 'sample_rate') else 22050
            channels = 1  # Piper 通常生成单声道音频
            
            # 创建 WAV 文件（添加文件头）
            wav_data = create_wav_header(audio_bytes, sample_rate=sample_rate, channels=channels)
            
            # 验证 WAV 文件头
            if len(wav_data) < 44:
                logger.error(f"WAV file too short: {len(wav_data)} bytes")
                raise HTTPException(
                    status_code=500,
                    detail=f"Generated WAV file is too short: {len(wav_data)} bytes"
                )
            
            if wav_data[:4] != b'RIFF':
                logger.error(f"Invalid WAV header: first 4 bytes = {wav_data[:4]}")
                raise HTTPException(
                    status_code=500,
                    detail="Failed to create valid WAV file header"
                )
            
            if wav_data[8:12] != b'WAVE':
                logger.error(f"Invalid WAV format: bytes 8-12 = {wav_data[8:12]}")
                raise HTTPException(
                    status_code=500,
                    detail="Failed to create valid WAV file format"
                )
            
            logger.info(f"WAV file created: {len(wav_data)} bytes (header: {len(wav_data) - len(audio_bytes)} bytes, audio: {len(audio_bytes)} bytes)")
            
            # 返回 WAV 数据
            return Response(
                content=wav_data,
                media_type="audio/wav",
                headers={
                    "Content-Disposition": f'attachment; filename="{request.voice}.wav"'
                }
            )
        except Exception as e:
            logger.error(f"Python API synthesis failed: {e}", exc_info=True)
            # 记录详细的错误信息
            import traceback
            error_details = traceback.format_exc()
            logger.error(f"Python API error details: {error_details}")
            # 回退到命令行工具
            logger.warning("Falling back to command line tool")
    
    # 回退到命令行工具（如果 Python API 不可用或失败）
    piper_cmd = find_piper_command()
    
    with tempfile.NamedTemporaryFile(mode='w', suffix=".txt", delete=False, encoding='utf-8') as tmp_input:
        tmp_input.write(request.text)
        input_path = tmp_input.name
    
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_output:
        output_path = tmp_output.name
    
    try:
        # 构建 piper 命令
        cmd = [
            piper_cmd,
            "--model", model_path,
            "--input_file", input_path,
            "--output_file", output_path,
        ]
        
        if config_path:
            cmd.extend(["--config", config_path])
        
        if use_gpu:
            cmd.append("--cuda")
            logger.info("Using GPU acceleration (--cuda)")
        
        # 执行 piper 命令
        logger.info(f"Executing piper command: {' '.join(cmd)}")
        process_start = time.time()
        
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        
        stdout, stderr = process.communicate()
        process_time = (time.time() - process_start) * 1000
        
        if process.returncode != 0:
            logger.error(f"Piper command failed with return code {process.returncode}")
            logger.error(f"stderr: {stderr}")
            if stdout:
                logger.error(f"stdout: {stdout}")
            error_msg = stderr if stderr else f"No error message (return code {process.returncode})"
            if stdout:
                error_msg += f" | stdout: {stdout[:500]}"  # 限制长度
            logger.error(f"Full error message: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail=f"Piper command failed (return code {process.returncode}): {error_msg}"
            )
        
        if stderr:
            logger.warning(f"Piper stderr output: {stderr}")
        
        logger.info(f"Piper command completed in {process_time:.2f}ms")
        
        # 读取生成的 WAV 文件
        if not os.path.exists(output_path):
            logger.error(f"Output file does not exist: {output_path}")
            raise HTTPException(
                status_code=500,
                detail="Piper did not generate output file"
            )
        
        file_size = os.path.getsize(output_path)
        logger.info(f"Output file size: {file_size} bytes")
        
        with open(output_path, "rb") as f:
            audio_data = f.read()
        
        logger.info(f"Audio data read: {len(audio_data)} bytes")
        
        if not audio_data:
            logger.error("Generated audio file is empty")
            raise HTTPException(
                status_code=500,
                detail="Generated audio file is empty"
            )
        
        # 返回 WAV 数据
        return Response(
            content=audio_data,
            media_type="audio/wav",
            headers={
                "Content-Disposition": f'attachment; filename="{request.voice}.wav"'
            }
        )
    
    finally:
        # 清理临时文件
        if os.path.exists(output_path):
            try:
                os.unlink(output_path)
            except OSError:
                pass
        if os.path.exists(input_path):
            try:
                os.unlink(input_path)
            except OSError:
                pass


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "ok", "service": "piper-tts"}


@app.get("/voices")
async def list_voices():
    """列出可用的语音模型"""
    model_dir = os.environ.get("PIPER_MODEL_DIR", os.path.expanduser("~/piper_models"))
    model_dir_path = Path(model_dir).expanduser()
    
    voices = []
    if model_dir_path.exists():
        # 查找所有 .onnx 文件
        for onnx_file in model_dir_path.rglob("*.onnx"):
            voice_name = onnx_file.stem
            voices.append({
                "name": voice_name,
                "path": str(onnx_file),
            })
    
    return {"voices": voices}


def main():
    parser = argparse.ArgumentParser(description="Piper TTS HTTP Service")
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5005,
        help="Port to bind to (default: 5005)"
    )
    parser.add_argument(
        "--model-dir",
        default=os.path.expanduser("~/piper_models"),
        help="Directory containing Piper models (default: ~/piper_models)"
    )
    parser.add_argument(
        "--piper-cmd",
        help="Path to piper command (default: auto-detect)"
    )
    
    args = parser.parse_args()
    
    # 设置环境变量
    os.environ["PIPER_MODEL_DIR"] = args.model_dir
    if args.piper_cmd:
        os.environ["PIPER_CMD"] = args.piper_cmd
    
    print(f"Starting Piper TTS HTTP Service...")
    print(f"  Host: {args.host}")
    print(f"  Port: {args.port}")
    print(f"  Model Directory: {args.model_dir}")
    print(f"  Piper Command: {find_piper_command()}")
    
    # 检查 GPU 支持
    use_gpu = os.environ.get("PIPER_USE_GPU", "false").lower() == "true"
    print(f"  GPU Acceleration: {'Enabled' if use_gpu else 'Disabled'}")
    
    if use_gpu:
        try:
            import onnxruntime as ort
            providers = ort.get_available_providers()
            if 'CUDAExecutionProvider' in providers:
                print(f"  ✓ CUDA Execution Provider: Available")
                print(f"  ✓ GPU acceleration will be used")
            else:
                print(f"  ⚠ CUDA Execution Provider: Not available (will use CPU)")
        except ImportError:
            print(f"  ⚠ ONNX Runtime not available for GPU check")
        except Exception as e:
            print(f"  ⚠ GPU check failed: {e}")
    
    print(f"\nEndpoints:")
    print(f"  POST /tts - Synthesize speech")
    print(f"  GET /health - Health check")
    print(f"  GET /voices - List available voices")
    print()
    
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()

