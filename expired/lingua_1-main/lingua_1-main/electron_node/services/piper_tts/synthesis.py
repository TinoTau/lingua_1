"""
TTS 合成逻辑模块
"""

import logging
import os
import subprocess
import tempfile
import time
import traceback
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from fastapi import HTTPException
from fastapi.responses import Response

try:
    from piper.config import SynthesisConfig
    from piper.voice import AudioChunk, PiperVoice
    PIPER_PYTHON_API_AVAILABLE = True
except ImportError:
    PIPER_PYTHON_API_AVAILABLE = False

try:
    from chinese_phonemizer import ChinesePhonemizer
    CHINESE_PHONEMIZER_AVAILABLE = True
except ImportError:
    CHINESE_PHONEMIZER_AVAILABLE = False

from utils import (
    PIPER_PYTHON_API_AVAILABLE as UTILS_PIPER_AVAILABLE,
    create_wav_header,
    find_piper_command,
    get_or_load_voice,
)

logger = logging.getLogger("uvicorn.error")


def synthesize_with_python_api(
    text: str,
    model_path: str,
    config_path: Optional[str],
    use_gpu: bool,
    voice: str
) -> Response:
    """
    使用 Python API 进行 TTS 合成
    
    Args:
        text: 要合成的文本
        model_path: 模型文件路径
        config_path: 配置文件路径
        use_gpu: 是否使用 GPU
        voice: 语音名称
        
    Returns:
        Response: WAV 音频响应
    """
    if not UTILS_PIPER_AVAILABLE:
        raise RuntimeError("Piper Python API not available")
    
    synth_start = time.time()
    
    # 获取或加载模型（带缓存）
    voice_obj = get_or_load_voice(model_path, config_path, use_gpu)
    
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
    logger.info(f"Synthesizing text: {text} (length: {len(text)})")
    
    # 如果是中文 VITS 模型，使用自定义音素化器直接处理音素
    if is_chinese_vits and CHINESE_PHONEMIZER_AVAILABLE:
        try:
            audio_chunks = _synthesize_chinese_vits(text, voice_obj, lexicon_path)
        except Exception as e:
            logger.error(f"Custom Chinese phonemization failed: {e}", exc_info=True)
            error_details = traceback.format_exc()
            logger.error(f"Error details: {error_details}")
            # 回退到标准方法
            logger.warning("Falling back to standard synthesis method")
            audio_generator = voice_obj.synthesize(text)
            audio_chunks = list(audio_generator)
    else:
        # 标准合成方法
        audio_generator = voice_obj.synthesize(text)
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
    sample_rate = voice_obj.config.sample_rate if hasattr(voice_obj.config, 'sample_rate') else 22050
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
            "Content-Disposition": f'attachment; filename="{voice}.wav"'
        }
    )


def _synthesize_chinese_vits(
    text: str,
    voice: PiperVoice,
    lexicon_path: Path
) -> List[AudioChunk]:
    """
    使用中文 VITS 模型进行合成
    
    Args:
        text: 要合成的文本
        voice: PiperVoice 对象
        lexicon_path: 词典文件路径
        
    Returns:
        List[AudioChunk]: 音频块列表
    """
    # 检查文本编码（避免日志编码问题）
    text_bytes = text.encode('utf-8')
    logger.info(f"Input text: length={len(text)}, utf-8 bytes={len(text_bytes)}, first_char_hex={text_bytes[:3].hex() if len(text_bytes) >= 3 else 'N/A'}")
    phonemizer = ChinesePhonemizer(str(lexicon_path))
    sentence_phonemes = phonemizer.phonemize(text)
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
            audio = _generate_vits_audio(voice, phoneme_ids, syn_config)
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
    return audio_chunks


def _generate_vits_audio(
    voice: PiperVoice,
    phoneme_ids: List[int],
    syn_config: SynthesisConfig
) -> np.ndarray:
    """
    使用 VITS 模型生成音频
    
    Args:
        voice: PiperVoice 对象
        phoneme_ids: 音素 ID 列表
        syn_config: 合成配置
        
    Returns:
        np.ndarray: 音频数据
    """
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
    session = voice.session
    audio = session.run(None, args)[0].squeeze()
    logger.info(f"Generated audio using VITS format: shape={audio.shape if hasattr(audio, 'shape') else 'N/A'}, length={len(audio) if hasattr(audio, '__len__') else 'N/A'}")
    return audio


def synthesize_with_command_line(
    text: str,
    model_path: str,
    config_path: Optional[str],
    use_gpu: bool,
    voice: str
) -> Response:
    """
    使用命令行工具进行 TTS 合成
    
    Args:
        text: 要合成的文本
        model_path: 模型文件路径
        config_path: 配置文件路径
        use_gpu: 是否使用 GPU
        voice: 语音名称
        
    Returns:
        Response: WAV 音频响应
    """
    piper_cmd = find_piper_command()
    
    with tempfile.NamedTemporaryFile(mode='w', suffix=".txt", delete=False, encoding='utf-8') as tmp_input:
        tmp_input.write(text)
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
                "Content-Disposition": f'attachment; filename="{voice}.wav"'
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
