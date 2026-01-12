#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从浏览器控制台日志或调度服务器日志中提取web端收到的音频和译文列表
"""

import json
import re
import sys

def extract_from_scheduler_log():
    """从调度服务器日志中提取发送的音频信息"""
    audio_list = []
    job_to_idx = {}
    tts_received = []
    sent_audio = []
    
    try:
        with open('central_server/scheduler/logs/scheduler.log', 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                try:
                    data = json.loads(line)
                    fields = data.get('fields', {})
                    message = fields.get('message', '')
                    
                    # 收集 job_id -> utterance_index 映射
                    if 'Received JobResult, adding to result queue' in message:
                        job_id = fields.get('job_id')
                        utterance_idx = fields.get('utterance_index')
                        if job_id and utterance_idx is not None:
                            job_to_idx[job_id] = utterance_idx
                    
                    # 收集TTS音频接收记录
                    elif 'TTS 音频已接收（节点端返回）' in message:
                        job_id = fields.get('job_id')
                        tts_len = fields.get('tts_audio_len', 0)
                        trace_id = fields.get('trace_id', '')
                        utterance_idx = job_to_idx.get(job_id)
                        tts_received.append({
                            'job_id': job_id,
                            'tts_audio_len': tts_len,
                            'trace_id': trace_id,
                            'utterance_index': utterance_idx,
                            'timestamp': data.get('timestamp', '')
                        })
                    
                    # 收集发送记录（包含text_asr和text_translated）
                    elif 'Sending translation result to session (single mode)' in message:
                        # 尝试从result queue的日志中获取utterance_index
                        # 或者通过trace_id和tts_audio_len匹配
                        sent_audio.append({
                            'tts_audio_len': fields.get('tts_audio_len', 0),
                            'text_asr': fields.get('text_asr', ''),
                            'text_translated': fields.get('text_translated', ''),
                            'trace_id': fields.get('trace_id', ''),
                            'timestamp': data.get('timestamp', ''),
                            'utterance_index': None,  # 稍后匹配
                            'job_id': None
                        })
                            
                except json.JSONDecodeError:
                    continue
        
        # 匹配发送记录和TTS接收记录（通过trace_id和tts_audio_len）
        for sent in sent_audio:
            for tts in tts_received:
                if sent['trace_id'] == tts['trace_id'] and abs(sent['tts_audio_len'] - tts['tts_audio_len']) < 100:
                    sent['utterance_index'] = tts['utterance_index']
                    sent['job_id'] = tts['job_id']
                    break
        
        # 如果还有未匹配的，尝试通过时间戳和tts_audio_len匹配
        for sent in sent_audio:
            if sent['utterance_index'] is None:
                # 查找最接近的TTS接收记录
                best_match = None
                min_time_diff = float('inf')
                for tts in tts_received:
                    if abs(sent['tts_audio_len'] - tts['tts_audio_len']) < 100:
                        # 计算时间差（简单字符串比较）
                        time_diff = abs(len(sent['timestamp']) - len(tts['timestamp']))
                        if time_diff < min_time_diff:
                            min_time_diff = time_diff
                            best_match = tts
                if best_match:
                    sent['utterance_index'] = best_match['utterance_index']
                    sent['job_id'] = best_match['job_id']
        
        # 按utterance_index排序（None值放在最后）
        sent_audio.sort(key=lambda x: (x['utterance_index'] is None, x['utterance_index'] if x['utterance_index'] is not None else 9999))
        
        return sent_audio
    except FileNotFoundError:
        print("⚠️  调度服务器日志文件不存在")
        return []

def extract_from_console_log(log_text):
    """从浏览器控制台日志中提取音频信息"""
    audio_list = []
    lines = log_text.split('\n')
    
    current_audio = {}
    
    for i, line in enumerate(lines):
        # 匹配收到 translation_result 消息
        if '收到 translation_result 消息' in line and 'utterance_index' in line:
            # 尝试提取utterance_index
            idx_match = re.search(r'utterance_index[:\s]+(\d+)', line)
            if idx_match:
                utterance_idx = int(idx_match.group(1))
                current_audio = {
                    'utterance_index': utterance_idx,
                    'text_asr': None,
                    'text_translated': None,
                    'tts_audio_len': None,
                    'added_to_buffer': False,
                    'played': False
                }
        
        # 匹配原文和译文（从日志中提取）
        if '原文 (ASR):' in line:
            # 下一行应该是原文内容
            if i + 1 < len(lines):
                asr_text = lines[i + 1].strip()
                if asr_text and not asr_text.startswith('译文'):
                    current_audio['text_asr'] = asr_text
        
        if '译文 (NMT):' in line:
            # 下一行应该是译文内容
            if i + 1 < len(lines):
                translated_text = lines[i + 1].strip()
                if translated_text and not translated_text.startswith('当前状态'):
                    current_audio['text_translated'] = translated_text
        
        # 匹配TTS音频长度
        if '是否有 TTS 音频:' in line and '长度:' in line:
            len_match = re.search(r'长度:\s*(\d+)', line)
            if len_match:
                current_audio['tts_audio_len'] = int(len_match.group(1))
        
        # 匹配音频已添加到缓冲区
        if '音频块已添加到缓冲区' in line and 'utterance_index' in line:
            idx_match = re.search(r'utterance_index[:\s]+(\d+)', line)
            if idx_match:
                idx = int(idx_match.group(1))
                for audio in audio_list:
                    if audio.get('utterance_index') == idx:
                        audio['added_to_buffer'] = True
                        break
                if current_audio.get('utterance_index') == idx:
                    current_audio['added_to_buffer'] = True
        
        # 匹配开始播放
        if '开始播放' in line and 'utteranceIndex' in line:
            idx_match = re.search(r'utteranceIndex[:\s]+(\d+)', line)
            if idx_match:
                idx = int(idx_match.group(1))
                for audio in audio_list:
                    if audio.get('utterance_index') == idx:
                        audio['played'] = True
                        break
        
        # 如果current_audio有完整信息，添加到列表
        if current_audio.get('utterance_index') is not None and current_audio not in audio_list:
            # 检查是否已存在
            exists = False
            for audio in audio_list:
                if audio.get('utterance_index') == current_audio.get('utterance_index'):
                    exists = True
                    break
            if not exists:
                audio_list.append(current_audio.copy())
    
    return audio_list

def main():
    print("=" * 80)
    print("Web端收到的音频和译文列表")
    print("=" * 80)
    print()
    
    # 从调度服务器日志提取
    scheduler_audio = extract_from_scheduler_log()
    
    if scheduler_audio:
        print(f"从调度服务器日志提取到 {len(scheduler_audio)} 段音频")
        print()
        print("=" * 80)
        print("详细列表（按 utterance_index 排序）")
        print("=" * 80)
        print()
        
        print(f"{'序号':<6} {'utterance_index':<18} {'音频时长':<12} {'原文 (ASR)':<50} {'译文 (NMT)':<50}")
        print("=" * 150)
        
        for i, audio in enumerate(scheduler_audio, 1):
            idx = audio.get('utterance_index', 'N/A')
            tts_len = audio.get('tts_audio_len', 0)
            text_asr = audio.get('text_asr', '')[:48] + '...' if len(audio.get('text_asr', '')) > 48 else audio.get('text_asr', '')
            text_translated = audio.get('text_translated', '')[:48] + '...' if len(audio.get('text_translated', '')) > 48 else audio.get('text_translated', '')
            
            # 估算时长
            estimated_duration = (tts_len * 3 / 4) / (16000 * 2) if tts_len > 0 else 0
            
            print(f"{i:<6} {idx:<18} {estimated_duration:>6.2f}秒{'':<4} {text_asr:<50} {text_translated:<50}")
        
        print()
        print("=" * 150)
        print()
        print("详细内容：")
        print()
        
        for i, audio in enumerate(scheduler_audio, 1):
            idx = audio.get('utterance_index', 'N/A')
            tts_len = audio.get('tts_audio_len', 0)
            text_asr = audio.get('text_asr', '')
            text_translated = audio.get('text_translated', '')
            
            # 估算时长
            estimated_duration = (tts_len * 3 / 4) / (16000 * 2) if tts_len > 0 else 0
            
            print(f"{i}. utterance_index = {idx}")
            print(f"   原文 (ASR): {text_asr}")
            print(f"   译文 (NMT): {text_translated}")
            print(f"   音频长度: {tts_len:,} 字节 (约 {estimated_duration:.2f} 秒)")
            print()
    else:
        print("⚠️  无法从调度服务器日志提取音频信息")
        print()
        print("如果您有浏览器控制台日志，请保存为文件（例如 web_console.log），")
        print("然后运行: python extract_web_audio_list.py web_console.log")
        print()
        
        # 如果提供了控制台日志文件，尝试分析
        if len(sys.argv) > 1:
            log_file = sys.argv[1]
            try:
                with open(log_file, 'r', encoding='utf-8') as f:
                    log_text = f.read()
                
                print(f"正在分析浏览器控制台日志: {log_file}")
                console_audio = extract_from_console_log(log_text)
                
                if console_audio:
                    print(f"从控制台日志提取到 {len(console_audio)} 段音频")
                    print()
                    for i, audio in enumerate(console_audio, 1):
                        idx = audio.get('utterance_index', 'N/A')
                        text_asr = audio.get('text_asr', 'N/A')
                        text_translated = audio.get('text_translated', 'N/A')
                        tts_len = audio.get('tts_audio_len', 'N/A')
                        added = '✅' if audio.get('added_to_buffer') else '❌'
                        played = '✅' if audio.get('played') else '❌'
                        
                        print(f"{i}. utterance_index = {idx}")
                        print(f"   原文: {text_asr}")
                        print(f"   译文: {text_translated}")
                        print(f"   音频长度: {tts_len}")
                        print(f"   已添加到缓冲区: {added} | 已播放: {played}")
                        print()
            except FileNotFoundError:
                print(f"❌ 日志文件不存在: {log_file}")

if __name__ == '__main__':
    main()

