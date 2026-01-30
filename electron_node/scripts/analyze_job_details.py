#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
详细分析每个job的处理过程
提取ASR和NMT的输入输出
"""

import json
import sys
import re
from collections import defaultdict
from datetime import datetime

def parse_log_line(line):
    """解析JSON日志行"""
    try:
        if line.strip().startswith('{'):
            return json.loads(line)
    except:
        pass
    return None

def format_time(timestamp):
    """格式化时间戳"""
    if isinstance(timestamp, (int, float)):
        return datetime.fromtimestamp(timestamp / 1000).strftime('%H:%M:%S.%f')[:-3]
    return str(timestamp)

def analyze_job_details(log_file):
    """分析job详细信息"""
    jobs = defaultdict(lambda: {
        'job_id': '',
        'session_id': '',
        'utterance_index': None,
        'asr_calls': [],
        'nmt_calls': [],
        'audio_aggregator': [],
        'timeline': []
    })
    
    with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
        for line_num, line in enumerate(f, 1):
            entry = parse_log_line(line)
            if not entry:
                continue
            
            job_id = entry.get('jobId') or entry.get('job_id')
            if not job_id:
                continue
            
            job = jobs[job_id]
            if not job['job_id']:
                job['job_id'] = job_id
            # 任意包含 sessionId/utteranceIndex 的日志行都更新，避免首条缺失导致为空
            sid = entry.get('sessionId') or entry.get('session_id')
            uix = entry.get('utteranceIndex') or entry.get('utterance_index')
            if sid is not None and sid != '':
                job['session_id'] = sid
            if uix is not None:
                job['utterance_index'] = uix

            msg = entry.get('msg', '')
            time = entry.get('time', 0)
            
            # ASR输入
            if 'ASR INPUT' in msg:
                asr_input = {
                    'time': format_time(time),
                    'audio_length': entry.get('audioLength'),
                    'audio_format': entry.get('audioFormat'),
                    'src_lang': entry.get('srcLang'),
                    'sample_rate': entry.get('sampleRate'),
                    'context_text_length': entry.get('contextTextLength', 0),
                    'enable_streaming': entry.get('enableStreaming', False),
                }
                job['asr_calls'].append({'type': 'input', 'data': asr_input})
            
            # ASR输出
            if 'ASR OUTPUT' in msg:
                asr_output = {
                    'time': format_time(time),
                    'text': entry.get('asrText', ''),
                    'text_length': entry.get('asrTextLength', 0),
                    'segments_count': entry.get('segmentsCount', 0),
                    'quality_score': entry.get('qualityScore'),
                    'request_duration_ms': entry.get('requestDurationMs'),
                }
                job['asr_calls'].append({'type': 'output', 'data': asr_output})
            
            # NMT输入
            if 'NMT INPUT' in msg:
                nmt_input = {
                    'time': format_time(time),
                    'text': entry.get('text', ''),
                    'text_length': entry.get('textLength', 0),
                    'src_lang': entry.get('srcLang'),
                    'tgt_lang': entry.get('tgtLang'),
                    'context_text_length': entry.get('contextTextLength', 0),
                }
                job['nmt_calls'].append({'type': 'input', 'data': nmt_input})
            
            # NMT输出
            if 'NMT OUTPUT' in msg:
                nmt_output = {
                    'time': format_time(time),
                    'text': entry.get('translatedText', ''),
                    'text_length': entry.get('translatedTextLength', 0),
                    'confidence': entry.get('confidence'),
                    'request_duration_ms': entry.get('requestDurationMs'),
                }
                job['nmt_calls'].append({'type': 'output', 'data': nmt_output})
            
            # AudioAggregator信息
            if 'AudioAggregator' in msg:
                agg_info = {
                    'time': format_time(time),
                    'msg': msg[:100],
                    'is_manual_cut': entry.get('isManualCut'),
                    'is_pause_triggered': entry.get('isPauseTriggered'),
                    'is_timeout_triggered': entry.get('isTimeoutTriggered'),
                    'is_max_duration_triggered': entry.get('isMaxDurationTriggered'),
                    'total_duration_ms': entry.get('totalDurationMs'),
                    'chunk_count': entry.get('chunkCount'),
                }
                job['audio_aggregator'].append(agg_info)
    
    return jobs

def print_job_details(job_id, job):
    """打印job详细信息"""
    print("\n" + "="*100)
    print(f"Job详细分析: {job_id}")
    print("="*100)
    print(f"Session ID: {job['session_id']}")
    print(f"Utterance Index: {job['utterance_index']}")
    
    # AudioAggregator信息
    if job['audio_aggregator']:
        print("\n[AudioAggregator处理]")
        for agg in job['audio_aggregator']:
            print(f"  [{agg['time']}] {agg['msg']}")
            if agg.get('is_manual_cut'):
                print(f"    手动截断: {agg['is_manual_cut']}")
            if agg.get('is_pause_triggered'):
                print(f"    静音触发: {agg['is_pause_triggered']}")
            if agg.get('is_timeout_triggered'):
                print(f"    超时触发: {agg['is_timeout_triggered']}")
            if agg.get('is_max_duration_triggered'):
                print(f"    MaxDuration触发: {agg['is_max_duration_triggered']}")
            if agg.get('total_duration_ms'):
                print(f"    总时长: {agg['total_duration_ms']}ms")
            if agg.get('chunk_count'):
                print(f"    音频块数: {agg['chunk_count']}")
    
    # ASR调用序列
    if job['asr_calls']:
        print("\n[ASR处理序列]")
        asr_pairs = []
        current_input = None
        
        for call in job['asr_calls']:
            if call['type'] == 'input':
                current_input = call['data']
            elif call['type'] == 'output' and current_input:
                asr_pairs.append({
                    'input': current_input,
                    'output': call['data']
                })
                current_input = None
        
        for i, pair in enumerate(asr_pairs, 1):
            print(f"\n  ASR调用 #{i}:")
            inp = pair['input']
            out = pair['output']
            
            print(f"    输入时间: {inp['time']}")
            print(f"    音频长度: {inp['audio_length']} bytes")
            if inp['audio_length']:
                duration_ms = (inp['audio_length'] / 2 / inp.get('sample_rate', 16000)) * 1000
                print(f"    估算时长: {duration_ms:.0f}ms ({duration_ms/1000:.1f}秒)")
            print(f"    音频格式: {inp['audio_format']}")
            print(f"    源语言: {inp['src_lang']}")
            print(f"    上下文长度: {inp['context_text_length']} 字符")
            
            print(f"    输出时间: {out['time']}")
            print(f"    识别文本: \"{out['text']}\"")
            print(f"    文本长度: {out['text_length']} 字符")
            print(f"    片段数: {out['segments_count']}")
            if out.get('quality_score') is not None:
                print(f"    质量分数: {out['quality_score']}")
            if out.get('request_duration_ms'):
                print(f"    处理时间: {out['request_duration_ms']}ms")
            
            # 检查问题：过短文本；或音频较长(>5s)但识别字很少(<15)，可能截断
            if out['text_length'] < 5:
                print(f"    [问题] ASR输出文本过短")
            if inp.get('audio_length') and inp.get('sample_rate'):
                sr = inp['sample_rate'] or 16000
                dur_sec = (inp['audio_length'] / 2 / sr)
                if dur_sec > 5 and out['text_length'] < 15:
                    print(f"    [问题] 音频约{dur_sec:.1f}s 较长但识别仅{out['text_length']}字，可能被截断")
    
    # NMT调用
    if job['nmt_calls']:
        print("\n[NMT处理]")
        nmt_pairs = []
        current_input = None
        
        for call in job['nmt_calls']:
            if call['type'] == 'input':
                current_input = call['data']
            elif call['type'] == 'output' and current_input:
                nmt_pairs.append({
                    'input': current_input,
                    'output': call['data']
                })
                current_input = None
        
        for i, pair in enumerate(nmt_pairs, 1):
            print(f"\n  NMT调用 #{i}:")
            inp = pair['input']
            out = pair['output']
            
            print(f"    输入时间: {inp['time']}")
            print(f"    待翻译文本: \"{inp['text']}\"")
            print(f"    文本长度: {inp['text_length']} 字符")
            print(f"    源语言: {inp['src_lang']} -> 目标语言: {inp['tgt_lang']}")
            print(f"    上下文长度: {inp['context_text_length']} 字符")
            
            print(f"    输出时间: {out['time']}")
            print(f"    翻译文本: \"{out['text']}\"")
            print(f"    文本长度: {out['text_length']} 字符")
            if out.get('confidence') is not None:
                print(f"    置信度: {out['confidence']}")
            if out.get('request_duration_ms'):
                print(f"    处理时间: {out['request_duration_ms']}ms")
    
    # 总结
    print("\n[处理总结]")
    print(f"  ASR调用次数: {len([c for c in job['asr_calls'] if c['type'] == 'input'])}")
    print(f"  NMT调用次数: {len([c for c in job['nmt_calls'] if c['type'] == 'input'])}")
    
    total_asr_text = sum(
        out['data']['text_length'] 
        for out in [c for c in job['asr_calls'] if c['type'] == 'output']
    )
    print(f"  总ASR文本长度: {total_asr_text} 字符")
    
    if len([c for c in job['asr_calls'] if c['type'] == 'input']) > 1:
        print(f"  [问题] 该job被分割成多个ASR调用，可能导致文本不完整")

def main():
    if len(sys.argv) < 2:
        print("用法: python analyze_job_details.py <log_file> [job_id]")
        print("示例: python analyze_job_details.py electron-node/logs/electron-main.log")
        print("      python analyze_job_details.py electron-node/logs/electron-main.log job-xxx")
        sys.exit(1)
    
    log_file = sys.argv[1]
    filter_job_id = sys.argv[2] if len(sys.argv) > 2 else None
    
    print("="*100)
    print(f"分析日志文件: {log_file}")
    print("="*100)
    
    jobs = analyze_job_details(log_file)
    
    if not jobs:
        print("\n未找到任何job记录")
        return
    
    print(f"\n找到 {len(jobs)} 个job")
    
    # 按utterance_index排序
    sorted_jobs = sorted(
        jobs.items(),
        key=lambda x: (x[1].get('utterance_index') or 999, x[1].get('job_id', ''))
    )
    
    if filter_job_id:
        # 只分析指定的job
        if filter_job_id in jobs:
            print_job_details(filter_job_id, jobs[filter_job_id])
        else:
            print(f"\n未找到job: {filter_job_id}")
    else:
        # 分析所有job
        for job_id, job in sorted_jobs:
            print_job_details(job_id, job)
            print()

if __name__ == '__main__':
    main()
