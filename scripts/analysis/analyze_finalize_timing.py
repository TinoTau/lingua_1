#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析finalize时长和音频累积过程
"""

import json
from datetime import datetime

def analyze_utterance_0():
    """分析utterance_index=0的音频累积过程"""
    audio_chunks = []
    finalize_info = None
    first_chunk_ts = None
    last_chunk_ts = None
    
    with open('central_server/scheduler/logs/scheduler.log', 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
                fields = data.get('fields', {})
                message = fields.get('message', '')
                timestamp = data.get('timestamp', '')
                
                # 查找finalize信息
                if 'Finalizing audio utterance' in message and fields.get('utterance_index') == 0:
                    finalize_info = {
                        'timestamp': timestamp,
                        'audio_size_bytes': fields.get('audio_size_bytes', 0),
                        'reason': fields.get('reason', ''),
                        'format': fields.get('audio_format', ''),
                        'padding_ms': fields.get('padding_ms', 0)
                    }
                
                # 查找音频块（需要根据实际日志格式调整）
                # 注意：调度服务器可能不记录每个chunk，只记录finalize时的总大小
                
            except json.JSONDecodeError:
                continue
    
    return finalize_info, audio_chunks

def calculate_audio_duration(size_bytes, format_type='opus', sample_rate=16000):
    """计算音频时长"""
    if format_type == 'opus':
        # Opus格式：粗略估算，实际需要解码
        # 假设压缩率约为10:1（PCM16 -> Opus）
        # PCM16: 2字节/样本，16kHz，所以 1秒 = 32000字节
        # Opus压缩后约为 3200字节/秒（粗略估算）
        estimated_pcm_bytes = size_bytes * 10  # 粗略估算
        duration_seconds = estimated_pcm_bytes / (sample_rate * 2)
    else:
        # PCM16格式
        duration_seconds = size_bytes / (sample_rate * 2)
    return duration_seconds

def main():
    print("=" * 80)
    print("Finalize时长和音频累积分析")
    print("=" * 80)
    print()
    
    # 分析utterance_index=0
    finalize_info, audio_chunks = analyze_utterance_0()
    
    if finalize_info:
        print("第一段音频 (utterance_index=0) 处理信息:")
        print(f"  Finalize 原因: {finalize_info['reason']}")
        print(f"  Finalize 时音频大小: {finalize_info['audio_size_bytes']:,} 字节")
        print(f"  音频格式: {finalize_info['format']}")
        print(f"  Padding: {finalize_info['padding_ms']} ms")
        
        # 计算finalize时的音频时长
        finalize_duration = calculate_audio_duration(
            finalize_info['audio_size_bytes'],
            finalize_info['format']
        )
        print(f"  Finalize 时音频时长（估算）: {finalize_duration:.2f} 秒")
        print()
    
    # 从之前的分析中，我们知道最终TTS音频是1,103,932字节，约25.87秒
    print("最终返回的TTS音频信息:")
    print(f"  TTS音频大小: 1,103,932 字节")
    print(f"  TTS音频时长: 25.87 秒")
    print()
    
    print("=" * 80)
    print("Finalize配置信息")
    print("=" * 80)
    print()
    print("Web端配置:")
    print("  silenceTimeoutMs: 3000ms (3秒)")
    print("  说明: Web端VAD检测到静音超过3秒时，会发送is_final=true")
    print()
    print("调度服务器配置:")
    print("  pause_ms: 3000ms (3秒)")
    print("  说明: 如果连续音频块之间的间隔超过3秒，会自动finalize")
    print()
    print("=" * 80)
    print("为什么会累积到25.87秒？")
    print("=" * 80)
    print()
    print("可能的原因:")
    print("1. 用户连续说话，没有超过3秒的静音间隔")
    print("2. Web端VAD可能没有正确检测到静音")
    print("3. 音频块之间的间隔都小于3秒，所以没有触发finalize")
    print("4. 最终通过Timeout机制触发finalize（pause_ms超时）")
    print()
    print("建议:")
    print("- 检查Web端VAD的静音检测阈值")
    print("- 考虑降低pause_ms或添加最大时长限制")
    print("- 在添加音频前检查是否会超过缓存限制，提前触发finalize")

if __name__ == '__main__':
    main()

