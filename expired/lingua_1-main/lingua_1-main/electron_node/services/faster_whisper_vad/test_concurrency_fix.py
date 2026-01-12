#!/usr/bin/env python3
"""
并发保护修复验证测试
测试asr_model_lock是否能防止并发访问导致的崩溃
使用Opus格式数据（Plan A格式）
"""

import requests
import time
import sys
import base64
import concurrent.futures
import numpy as np
import struct

BASE_URL = "http://127.0.0.1:6007"

def create_test_opus_audio():
    """创建测试用的Opus音频数据（Plan A格式）"""
    try:
        # 尝试使用pyogg编码Opus
        import pyogg.opus as opus
        
        # 生成简单的测试音频（正弦波）
        sample_rate = 16000
        duration = 0.5  # 0.5秒
        frequency = 440  # A4音符
        frame_size_ms = 20  # 20ms帧
        channels = 1
        
        samples = int(sample_rate * duration)
        t = np.linspace(0, duration, samples, False)
        audio_float = np.sin(2 * np.pi * frequency * t).astype(np.float32)
        
        # 创建Opus编码器（使用正确的API）
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
        
        # 编码为Opus packets（每20ms一帧）
        frame_size = int(sample_rate * frame_size_ms / 1000)  # 320 samples for 20ms at 16kHz
        packets = []
        max_packet_size = 4000  # Opus最大packet大小
        
        for i in range(0, len(audio_float), frame_size):
            frame = audio_float[i:i+frame_size]
            # 如果最后一帧不够长，填充到frame_size
            if len(frame) < frame_size:
                padded_frame = np.zeros(frame_size, dtype=np.float32)
                padded_frame[:len(frame)] = frame
                frame = padded_frame
            
            # 编码帧
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
        
        # 构建Plan A格式数据：uint16_le packet_len + packet_bytes
        plan_a_data = bytearray()
        for packet in packets:
            packet_len = len(packet)
            plan_a_data += struct.pack("<H", packet_len)  # uint16_le length prefix
            plan_a_data += packet
        
        # Base64编码
        return base64.b64encode(bytes(plan_a_data)).decode('utf-8')
        
    except ImportError:
        # 如果pyogg不可用，使用模拟的Plan A格式数据
        # 注意：这不是真正的Opus数据，但格式正确
        print("⚠️  pyogg不可用，使用模拟Opus数据（格式正确但可能无法解码）")
        
        # 创建模拟的Opus packet（实际测试应使用真实Opus编码）
        sample_rate = 16000
        duration = 0.5
        frame_size_ms = 20
        num_frames = int(duration * 1000 / frame_size_ms)  # 25 frames for 0.5s
        
        plan_a_data = bytearray()
        for i in range(num_frames):
            # 模拟Opus packet（约60-80字节）
            packet_size = 70
            packet = bytes([0x80 + (i % 10)] * packet_size)  # 模拟数据
            
            # Plan A格式：uint16_le packet_len + packet_bytes
            plan_a_data += struct.pack("<H", packet_size)
            plan_a_data += packet
        
        return base64.b64encode(bytes(plan_a_data)).decode('utf-8')
    except Exception as e:
        # 如果编码失败，使用模拟数据
        print(f"⚠️  Opus编码失败: {e}，使用模拟Opus数据")
        
        # 创建模拟的Plan A格式数据
        sample_rate = 16000
        duration = 0.5
        frame_size_ms = 20
        num_frames = int(duration * 1000 / frame_size_ms)
        
        plan_a_data = bytearray()
        for i in range(num_frames):
            packet_size = 70
            packet = bytes([0x80 + (i % 10)] * packet_size)
            plan_a_data += struct.pack("<H", packet_size)
            plan_a_data += packet
        
        return base64.b64encode(bytes(plan_a_data)).decode('utf-8')

def test_utterance_request(job_id: str):
    """发送utterance请求"""
    try:
        audio_b64 = create_test_opus_audio()
        payload = {
            "job_id": job_id,
            "src_lang": "zh",
            "audio": audio_b64,
            "audio_format": "opus",  # 使用Opus格式（Plan A格式）
            "sample_rate": 16000,
            "task": "transcribe",
            "beam_size": 5,
            "condition_on_previous_text": False,
            "use_context_buffer": False,
            "use_text_context": False,
            "trace_id": job_id
        }
        
        response = requests.post(f"{BASE_URL}/utterance", json=payload, timeout=30)
        if response.status_code == 200:
            return True, response.json()
        else:
            return False, f"Status {response.status_code}: {response.text}"
    except Exception as e:
        return False, str(e)

def test_concurrent_transcribe(num_requests=10, num_workers=3):
    """测试并发transcribe调用"""
    print(f"\n测试并发transcribe调用: {num_requests}个请求, {num_workers}个并发...")
    
    results = []
    start_time = time.time()
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = []
        for i in range(num_requests):
            job_id = f"concurrent_test_{int(time.time())}_{i}"
            future = executor.submit(test_utterance_request, job_id)
            futures.append((i, future))
        
        for i, future in futures:
            try:
                success, result = future.result(timeout=60)
                if success:
                    results.append(True)
                    print(f"  请求 {i+1}: ✅")
                else:
                    results.append(False)
                    print(f"  请求 {i+1}: ❌ {result}")
            except Exception as e:
                results.append(False)
                print(f"  请求 {i+1}: ❌ 异常: {e}")
    
    elapsed = time.time() - start_time
    passed = sum(results)
    total = len(results)
    
    print(f"\n并发测试结果: {passed}/{total} 通过 (耗时 {elapsed:.2f}s)")
    return passed == total

def test_health():
    """健康检查"""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        return response.status_code == 200
    except:
        return False

def main():
    print("=" * 60)
    print("并发保护修复验证测试")
    print("=" * 60)
    print()
    
    # 测试1: 基础健康检查
    print("测试1: 基础健康检查...")
    if not test_health():
        print("❌ 基础健康检查失败，服务不可用")
        return False
    print("✅ 基础健康检查通过")
    
    # 测试2: 并发transcribe调用
    print("\n测试2: 并发transcribe调用测试...")
    if not test_concurrent_transcribe(num_requests=10, num_workers=3):
        print("❌ 并发transcribe测试失败")
        return False
    print("✅ 并发transcribe测试通过")
    
    # 测试3: 验证服务仍然可用
    print("\n测试3: 验证服务仍然可用...")
    time.sleep(1)
    if not test_health():
        print("❌ 服务在并发测试后不可用（可能崩溃）")
        return False
    print("✅ 服务仍然可用")
    
    # 测试4: 更大规模的并发测试
    print("\n测试4: 更大规模的并发测试 (20个请求, 5个并发)...")
    if not test_concurrent_transcribe(num_requests=20, num_workers=5):
        print("❌ 大规模并发测试失败")
        return False
    print("✅ 大规模并发测试通过")
    
    # 测试5: 最终验证
    print("\n测试5: 最终验证...")
    time.sleep(1)
    if not test_health():
        print("❌ 最终验证失败，服务可能崩溃")
        return False
    print("✅ 最终验证通过")
    
    print()
    print("=" * 60)
    print("✅ 所有测试通过，并发保护机制工作正常！")
    print("=" * 60)
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)

