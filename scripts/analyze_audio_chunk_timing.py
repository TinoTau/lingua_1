#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析Web端和调度服务器的音频chunk时间戳，找出超过3秒的间隔
"""

import json
import re
from datetime import datetime
from typing import List, Dict, Optional
from pathlib import Path

def parse_web_log(log_path: str) -> List[Dict]:
    """解析Web端日志，提取chunk发送时间戳"""
    chunks = []
    
    with open(log_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            
            # 提取时间戳
            timestamp_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)', line)
            if not timestamp_match:
                continue
            
            timestamp_str = timestamp_match.group(1)
            try:
                timestamp_dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                timestamp_ms = int(timestamp_dt.timestamp() * 1000)
            except:
                continue
            
            # 查找chunk发送相关的日志
            if '首次发送音频chunk' in line or '第一批音频chunk' in line or 'sendAudioChunk' in line.lower():
                # 尝试提取更多信息
                utterance_index = None
                if 'utteranceIndex' in line or 'utterance_index' in line:
                    idx_match = re.search(r'utterance[Ii]ndex["\']?\s*[:=]\s*(\d+)', line)
                    if idx_match:
                        utterance_index = int(idx_match.group(1))
                
                chunks.append({
                    'timestamp_ms': timestamp_ms,
                    'timestamp_str': timestamp_str,
                    'type': 'web_send',
                    'utterance_index': utterance_index,
                    'line': line
                })
            
            # 查找TTS_PLAY_ENDED相关日志
            if 'TTS_PLAY_ENDED' in line or '播放完成' in line:
                utterance_index = None
                if 'utteranceIndex' in line or 'utterance_index' in line:
                    idx_match = re.search(r'utterance[Ii]ndex["\']?\s*[:=]\s*(\d+)', line)
                    if idx_match:
                        utterance_index = int(idx_match.group(1))
                
                chunks.append({
                    'timestamp_ms': timestamp_ms,
                    'timestamp_str': timestamp_str,
                    'type': 'tts_play_ended',
                    'utterance_index': utterance_index,
                    'line': line
                })
    
    return sorted(chunks, key=lambda x: x['timestamp_ms'])

def parse_scheduler_log(log_path: str) -> List[Dict]:
    """解析调度服务器日志，提取chunk接收时间戳"""
    chunks = []
    
    if not Path(log_path).exists():
        print(f"调度服务器日志不存在: {log_path}")
        return chunks
    
    with open(log_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            
            try:
                data = json.loads(line)
                fields = data.get('fields', {})
                message = fields.get('message', '')
                
                # 查找audio_chunk接收相关的日志
                if 'audio_chunk' in message.lower() or 'Received audio_chunk' in message:
                    timestamp_str = data.get('timestamp', '')
                    timestamp_ms = None
                    if timestamp_str:
                        try:
                            timestamp_dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                            timestamp_ms = int(timestamp_dt.timestamp() * 1000)
                        except:
                            pass
                    
                    # 从fields中提取时间戳
                    if timestamp_ms is None:
                        timestamp_ms = fields.get('timestamp_ms')
                    
                    utterance_index = fields.get('utterance_index')
                    session_id = fields.get('session_id', '')
                    
                    if timestamp_ms:
                        chunks.append({
                            'timestamp_ms': timestamp_ms,
                            'timestamp_str': timestamp_str,
                            'type': 'scheduler_receive',
                            'utterance_index': utterance_index,
                            'session_id': session_id,
                            'message': message
                        })
                
                # 查找pause finalize相关的日志
                if 'Pause阈值已超过' in message or 'pause finalize' in message.lower() or 'trigger.*pause' in message.lower():
                    timestamp_str = data.get('timestamp', '')
                    timestamp_ms = None
                    if timestamp_str:
                        try:
                            timestamp_dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                            timestamp_ms = int(timestamp_dt.timestamp() * 1000)
                        except:
                            pass
                    
                    utterance_index = fields.get('utterance_index')
                    session_id = fields.get('session_id', '')
                    pause_duration_ms = fields.get('pause_duration_ms')
                    
                    if timestamp_ms:
                        chunks.append({
                            'timestamp_ms': timestamp_ms,
                            'timestamp_str': timestamp_str,
                            'type': 'pause_finalize',
                            'utterance_index': utterance_index,
                            'session_id': session_id,
                            'pause_duration_ms': pause_duration_ms,
                            'message': message
                        })
                
                # 查找TTS_PLAY_ENDED处理相关日志
                if 'TTS_PLAY_ENDED' in message or '收到 TTS_PLAY_ENDED' in message:
                    timestamp_str = data.get('timestamp', '')
                    timestamp_ms = None
                    if timestamp_str:
                        try:
                            timestamp_dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                            timestamp_ms = int(timestamp_dt.timestamp() * 1000)
                        except:
                            pass
                    
                    session_id = fields.get('session_id', '')
                    
                    if timestamp_ms:
                        chunks.append({
                            'timestamp_ms': timestamp_ms,
                            'timestamp_str': timestamp_str,
                            'type': 'scheduler_tts_play_ended',
                            'session_id': session_id,
                            'message': message
                        })
                
                # 查找RestartTimer相关日志
                if 'RestartTimer' in message:
                    timestamp_str = data.get('timestamp', '')
                    timestamp_ms = None
                    if timestamp_str:
                        try:
                            timestamp_dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                            timestamp_ms = int(timestamp_dt.timestamp() * 1000)
                        except:
                            pass
                    
                    session_id = fields.get('session_id', '')
                    
                    if timestamp_ms:
                        chunks.append({
                            'timestamp_ms': timestamp_ms,
                            'timestamp_str': timestamp_str,
                            'type': 'restart_timer',
                            'session_id': session_id,
                            'message': message
                        })
            
            except json.JSONDecodeError:
                continue
    
    return sorted(chunks, key=lambda x: x['timestamp_ms'])

def analyze_timing_gaps(web_chunks: List[Dict], scheduler_chunks: List[Dict]):
    """分析时间间隔，找出超过3秒的间隔"""
    print("=" * 80)
    print("Web端chunk发送时间戳分析")
    print("=" * 80)
    
    # 分析Web端chunk发送间隔
    web_send_chunks = [c for c in web_chunks if c['type'] == 'web_send']
    web_tts_ended = [c for c in web_chunks if c['type'] == 'tts_play_ended']
    
    print(f"\n找到 {len(web_send_chunks)} 个Web端chunk发送事件")
    print(f"找到 {len(web_tts_ended)} 个TTS_PLAY_ENDED事件\n")
    
    # 分析chunk发送间隔
    gaps = []
    for i in range(1, len(web_send_chunks)):
        prev = web_send_chunks[i-1]
        curr = web_send_chunks[i]
        gap_ms = curr['timestamp_ms'] - prev['timestamp_ms']
        
        if gap_ms > 3000:  # 超过3秒
            gaps.append({
                'prev': prev,
                'curr': curr,
                'gap_ms': gap_ms
            })
    
    if gaps:
        print(f"\n[WARN] 找到 {len(gaps)} 个超过3秒的Web端chunk发送间隔:\n")
        for gap in gaps:
            print(f"  间隔 {gap['gap_ms']}ms ({gap['gap_ms']/1000:.2f}秒):")
            print(f"    {gap['prev']['timestamp_str']} - {gap['prev'].get('type', 'unknown')}")
            print(f"    {gap['curr']['timestamp_str']} - {gap['curr'].get('type', 'unknown')}")
            if gap['prev'].get('utterance_index') is not None:
                print(f"    utterance_index: {gap['prev'].get('utterance_index')} -> {gap['curr'].get('utterance_index')}")
            print()
    else:
        print("[OK] Web端chunk发送间隔均小于3秒\n")
    
    print("=" * 80)
    print("调度服务器chunk接收时间戳分析")
    print("=" * 80)
    
    # 分析调度服务器chunk接收间隔
    scheduler_receive_chunks = [c for c in scheduler_chunks if c['type'] == 'scheduler_receive']
    scheduler_pause_finalize = [c for c in scheduler_chunks if c['type'] == 'pause_finalize']
    scheduler_tts_ended = [c for c in scheduler_chunks if c['type'] == 'scheduler_tts_play_ended']
    scheduler_restart_timer = [c for c in scheduler_chunks if c['type'] == 'restart_timer']
    
    print(f"\n找到 {len(scheduler_receive_chunks)} 个调度服务器chunk接收事件")
    print(f"找到 {len(scheduler_pause_finalize)} 个pause finalize事件")
    print(f"找到 {len(scheduler_tts_ended)} 个TTS_PLAY_ENDED处理事件")
    print(f"找到 {len(scheduler_restart_timer)} 个RestartTimer事件\n")
    
    # 分析chunk接收间隔
    gaps = []
    for i in range(1, len(scheduler_receive_chunks)):
        prev = scheduler_receive_chunks[i-1]
        curr = scheduler_receive_chunks[i]
        gap_ms = curr['timestamp_ms'] - prev['timestamp_ms']
        
        if gap_ms > 3000:  # 超过3秒
            gaps.append({
                'prev': prev,
                'curr': curr,
                'gap_ms': gap_ms
            })
    
    if gaps:
        print(f"\n[WARN] 找到 {len(gaps)} 个超过3秒的调度服务器chunk接收间隔:\n")
        for gap in gaps:
            print(f"  间隔 {gap['gap_ms']}ms ({gap['gap_ms']/1000:.2f}秒):")
            print(f"    {gap['prev']['timestamp_str']} - utterance_index: {gap['prev'].get('utterance_index')}, session: {gap['prev'].get('session_id', 'unknown')}")
            print(f"    {gap['curr']['timestamp_str']} - utterance_index: {gap['curr'].get('utterance_index')}, session: {gap['curr'].get('session_id', 'unknown')}")
            print()
    else:
        print("[OK] 调度服务器chunk接收间隔均小于3秒\n")
    
    # 分析pause finalize事件
    if scheduler_pause_finalize:
        print("=" * 80)
        print("Pause Finalize事件分析")
        print("=" * 80)
        print()
        for pause in scheduler_pause_finalize:
            print(f"  {pause['timestamp_str']}:")
            print(f"    utterance_index: {pause.get('utterance_index')}")
            print(f"    pause_duration_ms: {pause.get('pause_duration_ms')}")
            print(f"    session_id: {pause.get('session_id', 'unknown')}")
            print(f"    message: {pause.get('message', '')[:100]}")
            print()
    
    # 分析TTS_PLAY_ENDED和chunk发送的时间关系
    print("=" * 80)
    print("TTS_PLAY_ENDED与Chunk发送时间关系分析")
    print("=" * 80)
    print()
    
    for tts_ended in web_tts_ended:
        tts_time = tts_ended['timestamp_ms']
        print(f"TTS_PLAY_ENDED: {tts_ended['timestamp_str']}")
        print(f"  utterance_index: {tts_ended.get('utterance_index')}")
        
        # 查找之后的第一个chunk
        next_chunks = [c for c in web_send_chunks if c['timestamp_ms'] > tts_time]
        if next_chunks:
            first_chunk = next_chunks[0]
            delay_ms = first_chunk['timestamp_ms'] - tts_time
            print(f"  第一个chunk发送延迟: {delay_ms}ms ({delay_ms/1000:.2f}秒)")
            print(f"  第一个chunk: {first_chunk['timestamp_str']}")
            print(f"    utterance_index: {first_chunk.get('utterance_index')}")
        print()

def main():
    web_log_path = "expired/web-client-2026-01-17T12-39-36-986Z.log"
    scheduler_log_path = "central_server/scheduler/logs/scheduler.log"
    
    print("开始分析音频chunk时间戳...")
    print()
    
    # 解析Web端日志
    print("解析Web端日志...")
    web_chunks = parse_web_log(web_log_path)
    print(f"提取到 {len(web_chunks)} 个Web端事件")
    
    # 解析调度服务器日志
    print("解析调度服务器日志...")
    scheduler_chunks = parse_scheduler_log(scheduler_log_path)
    print(f"提取到 {len(scheduler_chunks)} 个调度服务器事件")
    print()
    
    # 分析时间间隔
    analyze_timing_gaps(web_chunks, scheduler_chunks)

if __name__ == '__main__':
    main()
