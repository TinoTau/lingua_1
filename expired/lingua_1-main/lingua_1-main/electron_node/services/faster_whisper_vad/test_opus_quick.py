"""快速测试 Opus 格式"""
import requests
import numpy as np
import soundfile as sf
import pyogg.opus as opus
import base64
import struct
import time

BASE_URL = "http://127.0.0.1:6007"

# 测试文件
CHINESE_WAV = r"D:\Programs\github\lingua_1\electron_node\services\test\chinese.wav"

print("=" * 60)
print("快速 Opus 格式测试")
print("=" * 60)

# 1. 健康检查
print("\n1. 健康检查...")
r = requests.get(f"{BASE_URL}/health", timeout=5)
if r.status_code == 200:
    data = r.json()
    print(f"   ✅ 服务正常, Worker PID: {data['asr_worker']['worker_pid']}")
else:
    print(f"   ❌ 服务异常: {r.status_code}")
    exit(1)

# 2. 读取音频并转换为 Opus
print("\n2. 读取音频文件并转换为 Opus...")
audio, sr = sf.read(CHINESE_WAV, dtype='float32')
if len(audio.shape) > 1:
    audio = audio.mean(axis=1)

print(f"   音频信息: 采样率={sr}Hz, 时长={len(audio)/sr:.2f}s")

# 重采样到 16000Hz
if sr != 16000:
    from scipy import signal
    num_samples = int(len(audio) * 16000 / sr)
    audio = signal.resample(audio, num_samples).astype(np.float32)
    sr = 16000
    print(f"   已重采样到 16000Hz")

# Opus 编码
channels = 1
encoder_size = opus.opus_encoder_get_size(channels)
encoder_state = (opus.c_uchar * encoder_size)()

error = opus.opus_encoder_init(
    opus.cast(opus.pointer(encoder_state), opus.oe_p),
    sr,
    channels,
    opus.OPUS_APPLICATION_VOIP
)
if error != opus.OPUS_OK:
    print(f"   ❌ Opus 编码器初始化失败: {opus.opus_strerror(error)}")
    exit(1)

# 设置比特率为 24 kbps（与 Web 端一致，推荐值 for VOIP）
bitrate = 24000  # 24 kbps
error = opus.opus_encoder_ctl(
    opus.cast(opus.pointer(encoder_state), opus.oe_p),
    opus.OPUS_SET_BITRATE_REQUEST,
    bitrate
)
if error != opus.OPUS_OK:
    print(f"   ⚠️  设置 Opus 编码器比特率失败: {opus.opus_strerror(error)}")
else:
    print(f"   ✅ Opus 编码器比特率设置为 {bitrate} bps (24 kbps)")

frame_size = 320  # 20ms
max_packet_size = 4000
packets = []

# 确保音频长度是 frame_size 的倍数
num_frames = len(audio) // frame_size
if len(audio) % frame_size != 0:
    padding = frame_size - (len(audio) % frame_size)
    audio = np.append(audio, np.zeros(padding, dtype=np.float32))
    num_frames += 1

# 编码每一帧
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
        packets.append(bytes(packet_buffer[:packet_len]))

opus.opus_encoder_destroy(opus.cast(opus.pointer(encoder_state), opus.oe_p))

# Plan A 格式
plan_a_data = bytearray()
for packet in packets:
    plan_a_data += struct.pack("<H", len(packet))
    plan_a_data += packet

audio_b64 = base64.b64encode(bytes(plan_a_data)).decode('utf-8')
print(f"   ✅ Opus 编码完成, {len(packets)} 个 packets, base64 大小: {len(audio_b64)} 字符")

# 3. 发送请求
print("\n3. 发送 ASR 请求...")
job_id = f"test_quick_{int(time.time())}"
payload = {
    "job_id": job_id,
    "src_lang": "zh",
    "audio": audio_b64,
    "audio_format": "opus",
    "sample_rate": 16000,
    "task": "transcribe",
    "beam_size": 5,
    "condition_on_previous_text": False,
    "use_context_buffer": False,
    "use_text_context": False,
    "trace_id": job_id
}

start_time = time.time()
try:
    response = requests.post(f"{BASE_URL}/utterance", json=payload, timeout=60)
    elapsed = time.time() - start_time
    
    if response.status_code == 200:
        data = response.json()
        print(f"   ✅ 请求成功 (耗时 {elapsed:.2f}s)")
        print(f"   识别文本: {data.get('text', '')}")
        print(f"   检测语言: {data.get('language', 'N/A')}")
        print(f"   音频时长: {data.get('duration', 0):.2f}s")
        print(f"   分段数: {len(data.get('segments', []))}")
        print("\n" + "=" * 60)
        print("✅ 测试通过！")
    else:
        print(f"   ❌ 请求失败: Status {response.status_code}")
        print(f"   响应: {response.text[:200]}")
        print("\n" + "=" * 60)
        print("❌ 测试失败")
except Exception as e:
    print(f"   ❌ 请求异常: {e}")
    print("\n" + "=" * 60)
    print("❌ 测试失败")

