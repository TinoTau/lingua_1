#!/usr/bin/env python3
"""
快速检查最近的job处理情况

用于快速查看最近的job处理情况，特别是检查是否有分割、不完整等问题。
"""

import json
import re
import sys
import os
from collections import defaultdict
from datetime import datetime

def parse_log_line(line):
    """解析日志行"""
    try:
        if line.strip().startswith('{'):
            return json.loads(line)
    except:
        pass
    return None

def extract_job_info(entry):
    """提取job信息"""
    job_id = entry.get('jobId') or entry.get('job_id')
    session_id = entry.get('sessionId') or entry.get('session_id')
    utterance_index = entry.get('utteranceIndex') or entry.get('utterance_index')
    return job_id, session_id, utterance_index

def find_log_files():
    """查找日志文件"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    log_files = []
    
    # Electron主进程日志
    main_log = os.path.join(base_dir, 'electron-node', 'logs', 'electron-main.log')
    if os.path.exists(main_log):
        log_files.append(('主进程', main_log))
    
    # ASR服务日志
    asr_log = os.path.join(base_dir, 'services', 'faster_whisper_vad', 'logs', 'faster-whisper-vad-service.log')
    if os.path.exists(asr_log):
        log_files.append(('ASR服务', asr_log))
    
    # NMT服务日志
    nmt_log = os.path.join(base_dir, 'services', 'nmt_m2m100', 'logs', 'nmt-service.log')
    if os.path.exists(nmt_log):
        log_files.append(('NMT服务', nmt_log))
    
    return log_files

def analyze_recent_jobs(log_file, max_lines=10000):
    """分析最近的job"""
    jobs = defaultdict(lambda: {
        'job_id': '',
        'session_id': '',
        'utterance_index': None,
        'asr_input': None,
        'asr_output': None,
        'nmt_input': None,
        'nmt_output': None,
        'errors': []
    })
    
    try:
        with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            # 只分析最后N行
            for line in lines[-max_lines:]:
                entry = parse_log_line(line)
                if not entry:
                    continue
                
                job_id, session_id, utterance_index = extract_job_info(entry)
                if not job_id:
                    continue
                
                job = jobs[job_id]
                if not job['job_id']:
                    job['job_id'] = job_id
                    job['session_id'] = session_id or ''
                    job['utterance_index'] = utterance_index
                
                msg = entry.get('msg', '')
                
                # ASR输入
                if 'ASR INPUT' in msg or 'ASR 接口入参' in msg:
                    job['asr_input'] = {
                        'audio_length': entry.get('audioLength'),
                        'text_preview': entry.get('contextText', '')[:50] if entry.get('contextText') else None
                    }
                
                # ASR输出
                if 'ASR OUTPUT' in msg or 'Final text to be sent to NMT' in msg:
                    asr_text = entry.get('asrText') or entry.get('text')
                    if not asr_text and 'Final text' in msg:
                        match = re.search(r"'([^']+)'", msg)
                        if match:
                            asr_text = match.group(1)
                    if asr_text:
                        job['asr_output'] = {
                            'text': asr_text,
                            'text_length': len(asr_text),
                            'preview': asr_text[:100]
                        }
                
                # NMT输入
                if 'NMT INPUT' in msg or 'Sending text to NMT' in msg:
                    nmt_text = entry.get('text') or entry.get('textToTranslate')
                    if nmt_text:
                        job['nmt_input'] = {
                            'text': nmt_text,
                            'text_length': len(nmt_text),
                            'preview': nmt_text[:100]
                        }
                
                # NMT输出
                if 'NMT OUTPUT' in msg or 'NMT service returned' in msg:
                    nmt_text = entry.get('translatedText') or entry.get('nmtResultText') or entry.get('text')
                    if nmt_text:
                        job['nmt_output'] = {
                            'text': nmt_text,
                            'text_length': len(nmt_text),
                            'preview': nmt_text[:100]
                        }
                
                # 错误
                level = entry.get('level', '')
                if isinstance(level, int):
                    level = str(level)
                level = str(level).lower() if level else ''
                if level in ['error', 'warn'] and ('failed' in msg.lower() or 'error' in msg.lower() or 'timeout' in msg.lower()):
                    job['errors'].append(msg[:200])
    
    except Exception as e:
        print(f"读取日志文件出错: {e}")
        return {}
    
    return jobs

def print_summary(jobs, log_name):
    """打印摘要"""
    if not jobs:
        print(f"\n[{log_name}] 未找到job记录")
        return
    
    print(f"\n[{log_name}] 找到 {len(jobs)} 个job")
    print("=" * 100)
    
    # 按utterance_index排序
    sorted_jobs = sorted(
        jobs.items(),
        key=lambda x: (x[1].get('utterance_index') or 0, x[1].get('job_id', ''))
    )
    
    for job_id, job in sorted_jobs:
        print(f"\nJob: {job_id}")
        print(f"  Session: {job['session_id']} | Utterance: {job['utterance_index']}")
        
        # ASR信息
        if job['asr_input']:
            audio_len = job['asr_input'].get('audio_length', 'N/A')
            print(f"  [ASR输入] 音频长度: {audio_len} bytes")
        
        if job['asr_output']:
            asr_text = job['asr_output'].get('text', '')
            text_len = job['asr_output'].get('text_length', 0)
            print(f"  [ASR输出] 文本长度: {text_len} 字符")
            print(f"           文本内容: \"{asr_text[:150]}{'...' if len(asr_text) > 150 else ''}\"")
        else:
            print(f"  [ASR输出] [X] 未找到")
        
        # NMT信息
        if job['nmt_input']:
            nmt_in_text = job['nmt_input'].get('text', '')
            nmt_in_len = job['nmt_input'].get('text_length', 0)
            print(f"  [NMT输入] 文本长度: {nmt_in_len} 字符")
            print(f"           文本内容: \"{nmt_in_text[:150]}{'...' if len(nmt_in_text) > 150 else ''}\"")
        
        if job['nmt_output']:
            nmt_out_text = job['nmt_output'].get('text', '')
            nmt_out_len = job['nmt_output'].get('text_length', 0)
            print(f"  [NMT输出] 文本长度: {nmt_out_len} 字符")
            print(f"           文本内容: \"{nmt_out_text[:150]}{'...' if len(nmt_out_text) > 150 else ''}\"")
        else:
            print(f"  [NMT输出] [X] 未找到")
        
        # 检查问题
        issues = []
        if job['asr_output'] and job['asr_output'].get('text_length', 0) < 5:
            issues.append("ASR输出文本过短")
        if job['asr_output'] and not job['nmt_output']:
            issues.append("ASR有输出但NMT无输出")
        if job['errors']:
            issues.append(f"有{len(job['errors'])}个错误/警告")
        
        if issues:
            print(f"  [问题] {'; '.join(issues)}")
        
        if job['errors']:
            print(f"  [错误详情]")
            for error in job['errors'][:3]:  # 只显示前3个错误
                print(f"    - {error}")

def main():
    print("=" * 100)
    print("快速检查最近的job处理情况")
    print("=" * 100)
    
    log_files = find_log_files()
    
    if not log_files:
        print("\n[X] 未找到任何日志文件")
        print("\n请检查以下位置:")
        print("  - electron_node/electron-node/logs/electron-main.log")
        print("  - electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log")
        print("  - electron_node/services/nmt_m2m100/logs/nmt-service.log")
        return
    
    for log_name, log_path in log_files:
        print(f"\n正在分析: {log_path}")
        jobs = analyze_recent_jobs(log_path)
        print_summary(jobs, log_name)
    
    print("\n" + "=" * 100)
    print("提示: 使用 analyze_job_processing.py 进行更详细的分析")
    print("=" * 100)

if __name__ == '__main__':
    main()
