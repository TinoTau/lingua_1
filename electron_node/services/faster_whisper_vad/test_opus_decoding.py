#!/usr/bin/env python3
"""
测试 Opus 解码的三种方法：
1. ffmpeg 直接解码（-f opus）
2. opusenc + ffmpeg（包装成 Ogg 容器）
3. pyogg 直接解码（回退方案）
"""

import os
import sys
import tempfile
import subprocess
import numpy as np
import soundfile as sf
import logging

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 测试用的 Opus 数据（模拟 web 端发送的原始 Opus 帧）
# 这里我们创建一个简单的测试：使用 pyogg 编码一些测试音频，然后测试解码
def create_test_opus_data():
    """创建测试用的 Opus 数据"""
    try:
        import pyogg.opus as opus
        
        sample_rate = 16000
        channels = 1
        frame_size = int(sample_rate * 20 / 1000)  # 20ms frame
        
        # 创建编码器
        encoder_size = opus.opus_encoder_get_size(channels)
        encoder_state = (opus.c_uchar * encoder_size)()
        error = opus.opus_encoder_init(
            opus.cast(opus.pointer(encoder_state), opus.oe_p),
            sample_rate,
            channels,
            opus.OPUS_APPLICATION_VOIP
        )
        if error != opus.OPUS_OK:
            raise ValueError(f"Failed to initialize opus encoder: {opus.opus_strerror(error)}")
        
        # 生成测试音频（1秒的正弦波）
        duration = 1.0  # 1秒
        num_samples = int(sample_rate * duration)
        t = np.linspace(0, duration, num_samples, False)
        frequency = 440.0  # A4 音符
        test_audio = np.sin(2 * np.pi * frequency * t).astype(np.float32)
        
        # 编码音频
        encoded_frames = []
        offset = 0
        while offset < len(test_audio):
            remaining = len(test_audio) - offset
            current_frame_size = min(frame_size, remaining)
            
            if current_frame_size < frame_size:
                # 填充到完整帧
                frame = np.zeros(frame_size, dtype=np.float32)
                frame[:current_frame_size] = test_audio[offset:offset+current_frame_size]
            else:
                frame = test_audio[offset:offset+frame_size]
            
            # 编码帧
            max_data_bytes = 4000
            encoded_data = (opus.c_uchar * max_data_bytes)()
            num_bytes = opus.opus_encode_float(
                opus.cast(opus.pointer(encoder_state), opus.oe_p),
                frame.ctypes.data_as(opus.c_float_p),
                frame_size,
                opus.cast(opus.pointer(encoded_data), opus.c_uchar_p),
                max_data_bytes
            )
            
            if num_bytes > 0:
                encoded_frames.append(bytes(encoded_data[:num_bytes]))
            
            offset += frame_size
        
        opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))
        
        # 合并所有编码帧
        opus_data = b''.join(encoded_frames)
        logger.info(f"Created test Opus data: {len(opus_data)} bytes from {len(test_audio)} samples")
        return opus_data, sample_rate
        
    except ImportError:
        logger.error("pyogg not available, cannot create test Opus data")
        return None, None


def test_method1_ffmpeg_direct(audio_bytes, sample_rate):
    """测试方法1：ffmpeg 直接解码"""
    logger.info("=" * 60)
    logger.info("测试方法1：ffmpeg 直接解码（-f opus）")
    logger.info("=" * 60)
    
    try:
        # 检查打包的 ffmpeg
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        bundled_ffmpeg = os.path.join(project_root, 'electron-node', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe')
        
        ffmpeg_binary = os.environ.get('FFMPEG_BINARY', None)
        if ffmpeg_binary and os.path.exists(ffmpeg_binary):
            ffmpeg_cmd = [ffmpeg_binary]
        elif os.path.exists(bundled_ffmpeg):
            ffmpeg_cmd = [bundled_ffmpeg]
            logger.info(f"Using bundled ffmpeg: {bundled_ffmpeg}")
        else:
            ffmpeg_cmd = ['ffmpeg']
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix='.opus') as tmp_input:
            tmp_input.write(audio_bytes)
            tmp_input_path = tmp_input.name
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_output:
            tmp_output_path = tmp_output.name
        
        try:
            ffmpeg_cmd.extend([
                '-f', 'opus',
                '-ar', str(sample_rate),
                '-ac', '1',
                '-i', tmp_input_path,
                '-ar', str(sample_rate),
                '-ac', '1',
                '-f', 'wav',
                '-y',
                tmp_output_path
            ])
            
            logger.info(f"Running: {' '.join(ffmpeg_cmd)}")
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                audio, sr = sf.read(tmp_output_path)
                logger.info(f"✓ 方法1成功：解码了 {len(audio)} 个样本，采样率 {sr}Hz")
                return True, audio, sr
            else:
                logger.warning(f"✗ 方法1失败（返回码 {result.returncode}）")
                logger.warning(f"  stderr: {result.stderr[:500]}")
                logger.warning(f"  stdout: {result.stdout[:500]}")
                return False, None, None
        
        finally:
            try:
                os.unlink(tmp_input_path)
                os.unlink(tmp_output_path)
            except:
                pass
    
    except Exception as e:
        logger.error(f"✗ 方法1异常：{e}")
        return False, None, None


def test_method2_opusenc_ffmpeg(audio_bytes, sample_rate):
    """测试方法2：opusenc + ffmpeg"""
    logger.info("=" * 60)
    logger.info("测试方法2：opusenc 包装成 Ogg 容器 + ffmpeg 解码")
    logger.info("=" * 60)
    
    try:
        # 检查 opusenc 是否可用
        opusenc_result = subprocess.run(
            ['opusenc', '--help'],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if opusenc_result.returncode != 0:
            logger.warning("✗ 方法2跳过：opusenc 不可用")
            return False, None, None
        
        # 检查打包的 ffmpeg
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        bundled_ffmpeg = os.path.join(project_root, 'electron-node', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe')
        
        ffmpeg_binary = os.environ.get('FFMPEG_BINARY', None)
        if ffmpeg_binary and os.path.exists(ffmpeg_binary):
            ffmpeg_cmd = [ffmpeg_binary]
        elif os.path.exists(bundled_ffmpeg):
            ffmpeg_cmd = [bundled_ffmpeg]
            logger.info(f"Using bundled ffmpeg: {bundled_ffmpeg}")
        else:
            ffmpeg_cmd = ['ffmpeg']
        
        # 创建临时文件
        with tempfile.NamedTemporaryFile(delete=False, suffix='.opus') as tmp_input:
            tmp_input.write(audio_bytes)
            tmp_input_path = tmp_input.name
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.ogg') as tmp_ogg:
            tmp_ogg_path = tmp_ogg.name
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_output:
            tmp_output_path = tmp_output.name
        
        try:
            # 使用 opusenc 包装成 Ogg 容器
            opusenc_cmd = [
                'opusenc',
                '--raw',
                '--raw-rate', str(sample_rate),
                '--raw-chan', '1',
                tmp_input_path,
                tmp_ogg_path
            ]
            
            logger.info(f"Running opusenc: {' '.join(opusenc_cmd)}")
            opusenc_result = subprocess.run(
                opusenc_cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if opusenc_result.returncode != 0:
                logger.warning(f"✗ 方法2失败：opusenc 包装失败 - {opusenc_result.stderr[:300]}")
                return False, None, None
            
            # 使用 ffmpeg 解码 Ogg 文件
            ffmpeg_cmd.extend([
                '-i', tmp_ogg_path,
                '-ar', str(sample_rate),
                '-ac', '1',
                '-f', 'wav',
                '-y',
                tmp_output_path
            ])
            
            logger.info(f"Running ffmpeg: {' '.join(ffmpeg_cmd)}")
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                audio, sr = sf.read(tmp_output_path)
                logger.info(f"✓ 方法2成功：解码了 {len(audio)} 个样本，采样率 {sr}Hz")
                return True, audio, sr
            else:
                logger.warning(f"✗ 方法2失败：ffmpeg 解码失败 - {result.stderr[:300]}")
                return False, None, None
        
        finally:
            try:
                os.unlink(tmp_input_path)
                os.unlink(tmp_ogg_path)
                os.unlink(tmp_output_path)
            except:
                pass
    
    except FileNotFoundError:
        logger.warning("✗ 方法2跳过：opusenc 未找到")
        return False, None, None
    except Exception as e:
        logger.error(f"✗ 方法2异常：{e}")
        return False, None, None


def test_method3_pyogg_direct(audio_bytes, sample_rate):
    """测试方法3：pyogg 直接解码"""
    logger.info("=" * 60)
    logger.info("测试方法3：pyogg 直接解码（回退方案）")
    logger.info("=" * 60)
    
    try:
        import pyogg.opus as opus
        
        channels = 1
        decoder_size = opus.opus_decoder_get_size(channels)
        decoder_state = (opus.c_uchar * decoder_size)()
        error = opus.opus_decoder_init(
            opus.cast(opus.pointer(decoder_state), opus.od_p),
            sample_rate,
            channels
        )
        if error != opus.OPUS_OK:
            raise ValueError(f"Failed to initialize opus decoder: {opus.opus_strerror(error)}")
        
        frame_size = int(sample_rate * 20 / 1000)  # 20ms frame
        decoded_audio = []
        offset = 0
        max_frame_size = 400  # 参考 Rust 实现
        
        # 首先尝试解码整个数据块（如果数据是单个帧）
        try:
            pcm_buffer = (opus.c_float * frame_size)()
            pcm_ptr = opus.cast(pcm_buffer, opus.c_float_p)
            # 将 bytes 转换为 c_uchar 数组
            audio_array = (opus.c_uchar * len(audio_bytes)).from_buffer_copy(audio_bytes)
            num_samples = opus.opus_decode_float(
                opus.cast(opus.pointer(decoder_state), opus.od_p),
                opus.cast(opus.pointer(audio_array), opus.c_uchar_p),
                len(audio_bytes),
                pcm_ptr,
                frame_size,
                0
            )
            if num_samples > 0:
                float_data = [pcm_buffer[i] for i in range(num_samples)]
                decoded_audio.extend(float_data)
                logger.info(f"Decoded entire Opus data as single frame: {len(decoded_audio)} samples")
        except Exception as e:
            # 如果整体解码失败，尝试分帧解码
            logger.info(f"Single frame decode failed ({e}), trying frame-by-frame decoding")
            
            while offset < len(audio_bytes):
                remaining = len(audio_bytes) - offset
                if remaining < 1:
                    break
                
                chunk_size = min(max_frame_size, remaining)
                chunk = audio_bytes[offset:offset+chunk_size]
                
                try:
                    pcm_buffer = (opus.c_float * frame_size)()
                    pcm_ptr = opus.cast(pcm_buffer, opus.c_float_p)
                    # 将 bytes 转换为 c_uchar 数组
                    chunk_array = (opus.c_uchar * len(chunk)).from_buffer_copy(chunk)
                    num_samples = opus.opus_decode_float(
                        opus.cast(opus.pointer(decoder_state), opus.od_p),
                        opus.cast(opus.pointer(chunk_array), opus.c_uchar_p),
                        len(chunk),
                        pcm_ptr,
                        frame_size,
                        0
                    )
                    if num_samples > 0:
                        float_data = [pcm_buffer[i] for i in range(num_samples)]
                        decoded_audio.extend(float_data)
                        offset += chunk_size
                    else:
                        logger.warning(f"Failed to decode opus frame at offset {offset}, skipping {chunk_size} bytes")
                        offset += chunk_size
                except Exception as e:
                    logger.warning(f"Exception decoding opus frame at offset {offset}: {e}, skipping {chunk_size} bytes")
                    offset += chunk_size
        
        opus.opus_decoder_destroy(opus.cast(opus.pointer(decoder_state), opus.od_p))
        
        if len(decoded_audio) == 0:
            logger.error("✗ 方法3失败：没有解码出任何音频数据")
            logger.error(f"  处理了 {offset} 字节，共 {len(audio_bytes)} 字节")
            return False, None, None
        
        audio = np.array(decoded_audio, dtype=np.float32)
        logger.info(f"✓ 方法3成功：解码了 {len(audio)} 个样本，采样率 {sample_rate}Hz")
        return True, audio, sample_rate
    
    except ImportError:
        logger.error("✗ 方法3失败：pyogg 不可用")
        return False, None, None
    except Exception as e:
        logger.error(f"✗ 方法3异常：{e}")
        return False, None, None


def main():
    """主测试函数"""
    logger.info("开始测试 Opus 解码的三种方法...")
    logger.info("")
    
    # 创建测试数据
    logger.info("创建测试用的 Opus 数据...")
    audio_bytes, sample_rate = create_test_opus_data()
    
    if audio_bytes is None:
        logger.error("无法创建测试数据，退出测试")
        return
    
    logger.info("")
    
    # 测试方法1
    success1, audio1, sr1 = test_method1_ffmpeg_direct(audio_bytes, sample_rate)
    logger.info("")
    
    # 测试方法2
    success2, audio2, sr2 = test_method2_opusenc_ffmpeg(audio_bytes, sample_rate)
    logger.info("")
    
    # 测试方法3
    success3, audio3, sr3 = test_method3_pyogg_direct(audio_bytes, sample_rate)
    logger.info("")
    
    # 总结
    logger.info("=" * 60)
    logger.info("测试总结")
    logger.info("=" * 60)
    logger.info(f"方法1（ffmpeg 直接解码）: {'✓ 成功' if success1 else '✗ 失败'}")
    logger.info(f"方法2（opusenc + ffmpeg）: {'✓ 成功' if success2 else '✗ 失败'}")
    logger.info(f"方法3（pyogg 直接解码）: {'✓ 成功' if success3 else '✗ 失败'}")
    logger.info("")
    
    # 比较结果（如果多个方法成功）
    if success1 and success3:
        logger.info("比较方法1和方法3的解码结果...")
        if len(audio1) == len(audio3):
            diff = np.abs(audio1 - audio3)
            max_diff = np.max(diff)
            mean_diff = np.mean(diff)
            logger.info(f"  最大差异: {max_diff:.6f}")
            logger.info(f"  平均差异: {mean_diff:.6f}")
            if max_diff < 0.01:
                logger.info("  ✓ 两种方法的结果非常接近")
            else:
                logger.warning("  ⚠ 两种方法的结果有较大差异")


if __name__ == '__main__':
    main()

