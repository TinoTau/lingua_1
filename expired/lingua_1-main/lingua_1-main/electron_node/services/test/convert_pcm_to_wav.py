#!/usr/bin/env python3
"""将 PCM 文件转换为 WAV 文件"""

import struct
import sys
from pathlib import Path

def pcm_to_wav(pcm_path: str, wav_path: str, sample_rate: int = 22050, channels: int = 1, bits_per_sample: int = 16):
    """将 PCM 文件转换为 WAV 文件"""
    pcm_file = Path(pcm_path)
    if not pcm_file.exists():
        print(f"错误: PCM 文件不存在: {pcm_path}")
        return False
    
    # 读取 PCM 数据
    with open(pcm_file, 'rb') as f:
        pcm_data = f.read()
    
    if not pcm_data:
        print(f"错误: PCM 文件为空: {pcm_path}")
        return False
    
    # 计算 WAV 文件参数
    data_size = len(pcm_data)
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    file_size = 36 + data_size
    
    # 创建 WAV 文件头
    wav_header = struct.pack('<4sI4s', b'RIFF', file_size, b'WAVE')
    wav_header += struct.pack('<4sIHHIIHH', 
                             b'fmt ', 16, 1, channels, sample_rate, 
                             byte_rate, block_align, bits_per_sample)
    wav_header += struct.pack('<4sI', b'data', data_size)
    
    # 写入 WAV 文件
    with open(wav_path, 'wb') as f:
        f.write(wav_header)
        f.write(pcm_data)
    
    print(f"✓ 已转换: {pcm_path} -> {wav_path}")
    print(f"  文件大小: {len(wav_header) + len(pcm_data)} bytes")
    print(f"  采样率: {sample_rate} Hz")
    print(f"  声道数: {channels}")
    print(f"  位深度: {bits_per_sample} bits")
    
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python convert_pcm_to_wav.py <pcm_file> [wav_file] [sample_rate]")
        print("示例: python convert_pcm_to_wav.py output_translated_audio.pcm output.wav 22050")
        sys.exit(1)
    
    pcm_path = sys.argv[1]
    wav_path = sys.argv[2] if len(sys.argv) > 2 else pcm_path.replace('.pcm', '.wav')
    sample_rate = int(sys.argv[3]) if len(sys.argv) > 3 else 22050
    
    pcm_to_wav(pcm_path, wav_path, sample_rate)

