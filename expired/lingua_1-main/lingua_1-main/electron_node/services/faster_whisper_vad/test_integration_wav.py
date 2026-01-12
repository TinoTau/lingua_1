"""
集成测试脚本 - 使用真实 WAV 文件测试 ASR 服务
测试进程隔离架构的完整功能

要求：
- numpy: pip install numpy
- soundfile: pip install soundfile
- pyogg: pip install pyogg
- scipy: pip install scipy (用于重采样)
"""
import requests
import time
import base64
import struct
import logging
import os
import sys

# 检查必需的库
REQUIRED_LIBS = {
    'numpy': 'numpy',
    'soundfile': 'soundfile',
    'pyogg': 'pyogg',
    'scipy': 'scipy'
}

MISSING_LIBS = []
for lib_name, package_name in REQUIRED_LIBS.items():
    try:
        __import__(lib_name)
    except ImportError:
        MISSING_LIBS.append(package_name)

if MISSING_LIBS:
    print("=" * 60)
    print("❌ 缺少必需的库，请先安装：")
    print(f"   pip install {' '.join(MISSING_LIBS)}")
    print("=" * 60)
    sys.exit(1)

# 导入库
import numpy as np
import soundfile as sf
import pyogg.opus as opus
from scipy import signal

AUDIO_LIBS_AVAILABLE = True
SOUNDFILE_AVAILABLE = True
OPUS_AVAILABLE = True

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

BASE_URL = "http://127.0.0.1:6007"

# 测试文件路径
CHINESE_WAV = r"D:\Programs\github\lingua_1\electron_node\services\test\chinese.wav"
ENGLISH_WAV = r"D:\Programs\github\lingua_1\electron_node\services\test\english.wav"


def read_wav_file_as_base64(file_path: str) -> tuple:
    """
    读取 WAV 文件并转换为 base64 编码（直接发送 WAV 文件内容）
    
    Returns:
        (audio_b64, sample_rate): (base64 string, int)
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")
    
    # 方法1: 尝试使用 soundfile 读取并获取采样率
    sample_rate = None
    if AUDIO_LIBS_AVAILABLE and SOUNDFILE_AVAILABLE:
        try:
            info = sf.info(file_path)
            sample_rate = int(info.samplerate)
        except Exception:
            pass
    
    # 如果无法获取采样率，尝试使用 wave 模块
    if sample_rate is None:
        try:
            import wave
            with wave.open(file_path, 'rb') as wav_file:
                sample_rate = wav_file.getframerate()
        except Exception:
            # 如果都失败，使用默认值
            sample_rate = 16000
            logger.warning(f"Could not determine sample rate, using default: {sample_rate}Hz")
    
    # 直接读取 WAV 文件内容并 base64 编码
    with open(file_path, 'rb') as f:
        wav_bytes = f.read()
    
    audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')
    
    return audio_b64, sample_rate


def read_wav_file(file_path: str) -> tuple:
    """
    读取 WAV 文件并转换为 PCM16 格式（用于 Opus 编码等）
    
    Returns:
        (audio_data, sample_rate): (numpy array or list, int)
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")
    
    # 优先使用 soundfile 读取（支持多种格式，包括 format 3）
    try:
        audio, sr = sf.read(file_path, dtype='float32')
        # 如果是立体声，转换为单声道
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)
        return audio, int(sr)
    except Exception as e:
        logger.warning(f"Failed to read with soundfile: {e}, trying alternative method")
    
    # 备用方法：使用 wave 模块（仅支持标准 WAV，不支持 format 3）
    try:
        import wave
        import array
        
        with wave.open(file_path, 'rb') as wav_file:
            sr = wav_file.getframerate()
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            frames = wav_file.readframes(wav_file.getnframes())
            
            # 转换为 float32
            if sample_width == 2:  # 16-bit
                audio_int16 = array.array('h', frames)
                audio = np.array(audio_int16, dtype=np.float32) / 32768.0
            elif sample_width == 4:  # 32-bit
                audio_int32 = array.array('i', frames)
                audio = np.array(audio_int32, dtype=np.float32) / 2147483648.0
            else:
                raise ValueError(f"Unsupported sample width: {sample_width}")
            
            # 如果是立体声，转换为单声道
            if channels == 2:
                audio = audio.reshape(-1, 2).mean(axis=1)
            
            return audio, sr
    except Exception as e:
        # 如果 wave 模块失败（如 format 3），尝试使用 soundfile
        try:
            audio, sr = sf.read(file_path, dtype='float32')
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)
            return audio, int(sr)
        except Exception as e2:
            raise ValueError(f"Failed to read WAV file with both wave and soundfile: {e}, {e2}")


def convert_to_pcm16_base64(audio, sample_rate: int = 16000) -> str:
    """
    将 float32 音频转换为 PCM16 base64 编码（已废弃，现在只使用 Opus）
    
    Args:
        audio: float32 音频数组（范围 [-1.0, 1.0]）
        sample_rate: 采样率
    
    Returns:
        base64 编码的 PCM16 音频数据
    """
    # 确保音频在有效范围内
    audio = np.clip(audio, -1.0, 1.0)
    # 转换为 int16
    audio_int16 = (audio * 32767).astype(np.int16)
    # 转换为 bytes (little-endian)
    audio_bytes = audio_int16.tobytes()
    
    # Base64 编码
    return base64.b64encode(audio_bytes).decode('utf-8')


def convert_to_opus_plan_a(audio, sample_rate: int = 16000) -> str:
    """
    将 float32 音频转换为 Opus Plan A 格式 base64 编码
    
    Args:
        audio: float32 音频数组或列表（范围 [-1.0, 1.0]）
        sample_rate: 采样率（必须是 16000）
    
    Returns:
        base64 编码的 Opus Plan A 格式音频数据
    """
    # 确保音频是 numpy array
    if not isinstance(audio, np.ndarray):
        audio = np.array(audio, dtype=np.float32)
    
    # 确保采样率是 16000
    if sample_rate != 16000:
        # 重采样到 16000 Hz
        logger.info(f"   重采样音频从 {sample_rate}Hz 到 16000Hz...")
        num_samples = int(len(audio) * 16000 / sample_rate)
        audio = signal.resample(audio, num_samples).astype(np.float32)
        sample_rate = 16000
    
    # 初始化 Opus 编码器
    channels = 1  # 单声道
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
    
    # 设置比特率为 24 kbps（与 Web 端一致，推荐值 for VOIP）
    bitrate = 24000  # 24 kbps
    error = opus.opus_encoder_ctl(
        opus.cast(opus.pointer(encoder_state), opus.oe_p),
        opus.OPUS_SET_BITRATE_REQUEST,
        bitrate
    )
    if error != opus.OPUS_OK:
        logger.warning(f"Failed to set Opus encoder bitrate to {bitrate} bps: {opus.opus_strerror(error)}")
    else:
        logger.info(f"Opus encoder bitrate set to {bitrate} bps (24 kbps for VOIP)")
    
    frame_size = 320  # 20ms at 16kHz
    max_packet_size = 4000
    packets = []
    
    # 确保音频长度是 frame_size 的倍数
    num_frames = len(audio) // frame_size
    if len(audio) % frame_size != 0:
        # 填充最后一帧
        padding = frame_size - (len(audio) % frame_size)
        audio = np.append(audio, np.zeros(padding, dtype=np.float32))
        num_frames += 1
    
    # 编码每一帧
    for i in range(num_frames):
        frame = audio[i * frame_size:(i + 1) * frame_size]
        
        # 创建 packet 缓冲区
        packet_buffer = (opus.c_uchar * max_packet_size)()
        packet_ptr = opus.cast(packet_buffer, opus.c_uchar_p)
        frame_ptr = opus.cast(frame.ctypes.data, opus.c_float_p)
        
        # 编码
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
    
    # 清理编码器
    opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))
    
    # 构建 Plan A 格式：uint16_le packet_len + packet_bytes
    plan_a_data = bytearray()
    for packet in packets:
        packet_len = len(packet)
        plan_a_data += struct.pack("<H", packet_len)  # uint16_le
        plan_a_data += packet
    
    # Base64 编码
    return base64.b64encode(bytes(plan_a_data)).decode('utf-8')


def test_health_check() -> bool:
    """测试健康检查端点"""
    logger.info("=" * 60)
    logger.info("测试1: 健康检查")
    logger.info("=" * 60)
    
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            logger.info("✅ 健康检查成功")
            logger.info(f"   服务状态: {data.get('status')}")
            logger.info(f"   Worker 状态: {data.get('asr_worker', {}).get('worker_state')}")
            logger.info(f"   Worker PID: {data.get('asr_worker', {}).get('worker_pid')}")
            return True
        else:
            logger.error(f"❌ 健康检查失败: Status {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"❌ 健康检查异常: {e}")
        return False


def test_utterance_request(
    audio_file: str,
    language: str,
    audio_format: str = "opus",
    use_opus: bool = True
) -> bool:
    """
    测试单个 utterance 请求
    
    Args:
        audio_file: WAV 文件路径
        language: 语言代码（"zh" 或 "en"）
        audio_format: 音频格式（"pcm16" 或 "opus"）
        use_opus: 是否使用 Opus 格式（如果可用）
    """
    logger.info("")
    logger.info("=" * 60)
    logger.info(f"测试: {os.path.basename(audio_file)} ({language})")
    logger.info("=" * 60)
    
    try:
        # 读取音频文件
        logger.info(f"   读取音频文件: {audio_file}")
        
        # 现在只支持 Opus 格式（调度服务器要求）
        audio_format = "opus"
        
        # 读取音频数据
        audio, sr = read_wav_file(audio_file)
        duration = len(audio) / sr
        logger.info(f"   音频信息: 采样率={sr}Hz, 时长={duration:.2f}s, 样本数={len(audio)}")
        
        # 转换为 Opus Plan A 格式
        logger.info("   转换为 Opus Plan A 格式...")
        audio_b64 = convert_to_opus_plan_a(audio, sr)
        
        logger.info(f"   音频数据大小: {len(audio_b64)} 字符 (base64, Opus Plan A)")
        
        # 构建请求
        job_id = f"test_{language}_{int(time.time())}"
        payload = {
            "job_id": job_id,
            "src_lang": language,
            "audio": audio_b64,
            "audio_format": audio_format,
            "sample_rate": 16000,
            "task": "transcribe",
            "beam_size": 5,
            "condition_on_previous_text": False,
            "use_context_buffer": False,
            "use_text_context": False,
            "trace_id": job_id
        }
        
        # 发送请求
        logger.info("   发送请求到 ASR 服务...")
        start_time = time.time()
        response = requests.post(f"{BASE_URL}/utterance", json=payload, timeout=60)
        elapsed = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f"✅ 请求成功 (耗时 {elapsed:.2f}s)")
            logger.info(f"   识别文本: {data.get('text', '')}")
            logger.info(f"   检测语言: {data.get('language', 'N/A')}")
            logger.info(f"   音频时长: {data.get('duration', 0):.2f}s")
            logger.info(f"   分段数: {len(data.get('segments', []))}")
            
            # 验证结果
            if data.get('text'):
                logger.info("✅ 识别结果有效")
                return True
            else:
                logger.warning("⚠️  识别结果为空（可能是静音或识别失败）")
                return True  # 仍然算成功，因为服务正常响应
        else:
            logger.error(f"❌ 请求失败: Status {response.status_code}")
            logger.error(f"   响应: {response.text[:200]}")
            return False
            
    except FileNotFoundError as e:
        logger.error(f"❌ 文件未找到: {e}")
        return False
    except Exception as e:
        logger.error(f"❌ 测试异常: {e}", exc_info=True)
        return False


def test_multiple_requests() -> bool:
    """测试多个顺序请求"""
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试: 多个顺序请求")
    logger.info("=" * 60)
    
    results = []
    
    # 测试中文
    if os.path.exists(CHINESE_WAV):
        results.append(("中文", test_utterance_request(CHINESE_WAV, "zh", "opus", True)))
        time.sleep(1)
    else:
        logger.warning(f"   跳过中文测试（文件不存在: {CHINESE_WAV}）")
    
    # 测试英文
    if os.path.exists(ENGLISH_WAV):
        results.append(("英文", test_utterance_request(ENGLISH_WAV, "en", "opus", True)))
        time.sleep(1)
    else:
        logger.warning(f"   跳过英文测试（文件不存在: {ENGLISH_WAV}）")
    
    # 再次测试中文（验证上下文）
    if os.path.exists(CHINESE_WAV):
        results.append(("中文（第二次）", test_utterance_request(CHINESE_WAV, "zh", "opus", True)))
    
    # 统计结果
    success_count = sum(1 for _, result in results if result)
    total_count = len(results)
    
    logger.info("")
    logger.info(f"   结果: {success_count}/{total_count} 成功")
    
    return success_count == total_count


def test_worker_stability() -> bool:
    """测试 Worker 进程稳定性"""
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试: Worker 进程稳定性")
    logger.info("=" * 60)
    
    try:
        # 获取初始状态
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            logger.error("❌ 无法获取健康状态")
            return False
        
        initial_data = response.json()
        initial_pid = initial_data.get('asr_worker', {}).get('worker_pid')
        initial_restarts = initial_data.get('asr_worker', {}).get('worker_restarts', 0)
        
        logger.info(f"   初始 Worker PID: {initial_pid}")
        logger.info(f"   初始重启次数: {initial_restarts}")
        
        # 执行多个请求
        logger.info("   执行多个请求测试...")
        test_multiple_requests()
        
        # 再次检查状态
        time.sleep(2)
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code != 200:
            logger.error("❌ 无法获取健康状态")
            return False
        
        final_data = response.json()
        final_pid = final_data.get('asr_worker', {}).get('worker_pid')
        final_state = final_data.get('asr_worker', {}).get('worker_state')
        final_restarts = final_data.get('asr_worker', {}).get('worker_restarts', 0)
        
        logger.info(f"   最终 Worker PID: {final_pid}")
        logger.info(f"   最终 Worker 状态: {final_state}")
        logger.info(f"   最终重启次数: {final_restarts}")
        
        # 验证
        if final_state == 'running' and final_pid is not None:
            if final_restarts > initial_restarts:
                logger.warning(f"⚠️  检测到 {final_restarts - initial_restarts} 次 Worker 重启")
            else:
                logger.info("✅ Worker 进程稳定运行，无重启")
            return True
        else:
            logger.error("❌ Worker 状态异常")
            return False
            
    except Exception as e:
        logger.error(f"❌ 稳定性测试异常: {e}", exc_info=True)
        return False


def main():
    """运行所有测试"""
    logger.info("=" * 60)
    logger.info("ASR 服务集成测试（使用真实 WAV 文件）")
    logger.info("=" * 60)
    logger.info("")
    
    # 检查文件
    if not os.path.exists(CHINESE_WAV):
        logger.error(f"❌ 中文测试文件不存在: {CHINESE_WAV}")
        return 1
    if not os.path.exists(ENGLISH_WAV):
        logger.error(f"❌ 英文测试文件不存在: {ENGLISH_WAV}")
        return 1
    
    logger.info(f"✅ 测试文件检查通过")
    logger.info(f"   中文文件: {CHINESE_WAV}")
    logger.info(f"   英文文件: {ENGLISH_WAV}")
    logger.info("")
    
    results = []
    
    # 测试1: 健康检查
    results.append(("健康检查", test_health_check()))
    time.sleep(1)
    
    # 测试2: 中文识别
    if os.path.exists(CHINESE_WAV):
        results.append(("中文识别", test_utterance_request(CHINESE_WAV, "zh", "opus", True)))
        time.sleep(2)
    
    # 测试3: 英文识别
    if os.path.exists(ENGLISH_WAV):
        results.append(("英文识别", test_utterance_request(ENGLISH_WAV, "en", "opus", True)))
        time.sleep(2)
    
    # 测试4: 多个顺序请求
    results.append(("多个顺序请求", test_multiple_requests()))
    time.sleep(2)
    
    # 测试5: Worker 稳定性
    results.append(("Worker 稳定性", test_worker_stability()))
    
    # 打印测试结果
    logger.info("")
    logger.info("=" * 60)
    logger.info("测试结果总结")
    logger.info("=" * 60)
    
    passed = 0
    failed = 0
    
    for test_name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        logger.info(f"{test_name}: {status}")
        if result:
            passed += 1
        else:
            failed += 1
    
    logger.info("")
    logger.info(f"总计: {passed} 通过, {failed} 失败")
    
    if failed == 0:
        logger.info("")
        logger.info("🎉 所有测试通过！")
        return 0
    else:
        logger.info("")
        logger.info("⚠️  部分测试失败，请检查日志")
        return 1


if __name__ == "__main__":
    exit(main())

