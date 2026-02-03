"""
集成测试 - 公共配置与 WAV/Opus 辅助函数
"""
import base64
import logging
import os
import struct
import sys

import numpy as np
import soundfile as sf
import pyogg.opus as opus
from scipy import signal

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BASE_URL = "http://127.0.0.1:6007"

# 测试文件路径（可被调用方覆盖）
CHINESE_WAV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "test", "chinese.wav"
)
ENGLISH_WAV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "test", "english.wav"
)


def read_wav_file_as_base64(file_path: str) -> tuple:
    """
    读取 WAV 文件并转换为 base64 编码（直接发送 WAV 文件内容）
    Returns:
        (audio_b64, sample_rate): (base64 string, int)
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    sample_rate = None
    try:
        info = sf.info(file_path)
        sample_rate = int(info.samplerate)
    except Exception:
        pass

    if sample_rate is None:
        try:
            import wave
            with wave.open(file_path, 'rb') as wav_file:
                sample_rate = wav_file.getframerate()
        except Exception:
            sample_rate = 16000
            logger.warning(f"Could not determine sample rate, using default: {sample_rate}Hz")

    with open(file_path, 'rb') as f:
        wav_bytes = f.read()

    audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')
    return audio_b64, sample_rate


def read_wav_file(file_path: str) -> tuple:
    """
    读取 WAV 文件并转换为 PCM float32。
    Returns:
        (audio_data, sample_rate): (numpy array, int)
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    try:
        audio, sr = sf.read(file_path, dtype='float32')
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)
        return audio, int(sr)
    except Exception as e:
        logger.warning(f"Failed to read with soundfile: {e}, trying alternative method")

    try:
        import wave
        import array

        with wave.open(file_path, 'rb') as wav_file:
            sr = wav_file.getframerate()
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            frames = wav_file.readframes(wav_file.getnframes())

            if sample_width == 2:
                audio_int16 = array.array('h', frames)
                audio = np.array(audio_int16, dtype=np.float32) / 32768.0
            elif sample_width == 4:
                audio_int32 = array.array('i', frames)
                audio = np.array(audio_int32, dtype=np.float32) / 2147483648.0
            else:
                raise ValueError(f"Unsupported sample width: {sample_width}")

            if channels == 2:
                audio = audio.reshape(-1, 2).mean(axis=1)

            return audio, sr
    except Exception as e:
        try:
            audio, sr = sf.read(file_path, dtype='float32')
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)
            return audio, int(sr)
        except Exception as e2:
            raise ValueError(f"Failed to read WAV file with both wave and soundfile: {e}, {e2}")


def convert_to_pcm16_base64(audio, sample_rate: int = 16000) -> str:
    """将 float32 音频转换为 PCM16 base64 编码"""
    audio = np.clip(audio, -1.0, 1.0)
    audio_int16 = (audio * 32767).astype(np.int16)
    audio_bytes = audio_int16.tobytes()
    return base64.b64encode(audio_bytes).decode('utf-8')


def convert_to_opus_plan_a(audio, sample_rate: int = 16000) -> str:
    """将 float32 音频转换为 Opus Plan A 格式 base64 编码"""
    if not isinstance(audio, np.ndarray):
        audio = np.array(audio, dtype=np.float32)

    if sample_rate != 16000:
        logger.info(f"   重采样音频从 {sample_rate}Hz 到 16000Hz...")
        num_samples = int(len(audio) * 16000 / sample_rate)
        audio = signal.resample(audio, num_samples).astype(np.float32)
        sample_rate = 16000

    channels = 1
    encoder_size = opus.opus_encoder_get_size(channels)
    encoder_state = (opus.c_uchar * encoder_size)()

    error = opus.opus_encoder_init(
        opus.cast(opus.pointer(encoder_state), opus.oe_p),
        sample_rate,
        channels,
        opus.OPUS_APPLICATION_VOIP
    )
    if error != opus.OPUS_OK:
        raise RuntimeError(f"Failed to initialize Opus encoder: {opus.opus_strerror(error)}")

    bitrate = 24000
    error = opus.opus_encoder_ctl(
        opus.cast(opus.pointer(encoder_state), opus.oe_p),
        opus.OPUS_SET_BITRATE_REQUEST,
        bitrate
    )
    if error != opus.OPUS_OK:
        logger.warning(f"Failed to set Opus encoder bitrate to {bitrate} bps: {opus.opus_strerror(error)}")
    else:
        logger.info(f"Opus encoder bitrate set to {bitrate} bps (24 kbps for VOIP)")

    frame_size = 320
    max_packet_size = 4000
    packets = []

    num_frames = len(audio) // frame_size
    if len(audio) % frame_size != 0:
        padding = frame_size - (len(audio) % frame_size)
        audio = np.append(audio, np.zeros(padding, dtype=np.float32))
        num_frames += 1

    for i in range(num_frames):
        frame = audio[i * frame_size:(i + 1) * frame_size]

        packet_buffer = (opus.c_uchar * max_packet_size)()
        packet_ptr = opus.cast(packet_buffer, opus.c_uchar_p)
        frame_ptr = opus.cast(frame.ctypes.data, opus.c_float_p)

        packet_len = opus.opus_encode_float(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            frame_ptr,
            frame_size,
            packet_ptr,
            max_packet_size
        )

        if packet_len > 0:
            packet_bytes = bytes(packet_buffer[:packet_len])
            packets.append(packet_bytes)

    opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))

    plan_a_data = bytearray()
    for packet in packets:
        packet_len = len(packet)
        plan_a_data += struct.pack("<H", packet_len)
        plan_a_data += packet

    return base64.b64encode(bytes(plan_a_data)).decode('utf-8')


def check_required_libs():
    """检查必需库，缺失时退出"""
    required = {'numpy': 'numpy', 'soundfile': 'soundfile', 'pyogg': 'pyogg', 'scipy': 'scipy'}
    missing = []
    for lib_name, package_name in required.items():
        try:
            __import__(lib_name)
        except ImportError:
            missing.append(package_name)
    if missing:
        print("=" * 60)
        print("❌ 缺少必需的库，请先安装：")
        print(f"   pip install {' '.join(missing)}")
        print("=" * 60)
        sys.exit(1)
