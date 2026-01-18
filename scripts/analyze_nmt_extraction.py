#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析NMT提取逻辑
从节点端日志提取NMT的完整输出和提取过程
"""

import json
from pathlib import Path
from collections import defaultdict

def analyze_nmt_extraction(log_path, job_ids):
    """分析NMT提取逻辑"""
    
    print(f"分析NMT提取逻辑...")
    
    if not Path(log_path).exists():
        print(f"[ERROR] 日志文件不存在: {log_path}")
        return
    
    # 读取日志
    with open(log_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # 只读取最后50万行
    lines = lines[-500000:] if len(lines) > 500000 else lines
    
    # 分析每个Job的NMT提取过程
    for job_id in job_ids:
        print(f"\n分析 Job: {job_id}")
        
        # 收集该Job的所有NMT相关日志
        nmt_logs = []
        
        for line in lines:
            try:
                data = json.loads(line)
            except:
                continue
            
            log_job_id = data.get('jobId') or data.get('job_id')
            if log_job_id == job_id:
                msg = data.get('msg', '')
                if 'NMT' in msg or 'translation' in msg.lower() or 'extract' in msg.lower():
                    nmt_logs.append(data)
        
        print(f"找到 {len(nmt_logs)} 条NMT相关日志")
        
        # 查找翻译输入
        translation_input = None
        for log in nmt_logs:
            msg = log.get('msg', '')
            if 'TranslationStage: Sending text to NMT service' in msg:
                translation_input = {
                    'text': log.get('textToTranslate', ''),
                    'length': log.get('textToTranslateLength', 0),
                    'context': log.get('contextText', ''),
                    'contextLength': log.get('contextTextLength', 0)
                }
                print(f"  翻译输入: {translation_input['text'][:50]} ({translation_input['length']} 字符)")
                print(f"  Context: {translation_input['context'][:50]} ({translation_input['contextLength']} 字符)")
                break
        
        # 查找NMT输出
        nmt_output = None
        for log in nmt_logs:
            msg = log.get('msg', '')
            if 'NMT OUTPUT: NMT request succeeded' in msg:
                nmt_output = {
                    'text': log.get('translatedText', ''),
                    'length': log.get('translatedTextLength', 0)
                }
                print(f"  NMT输出: {nmt_output['text'][:100]} ({nmt_output['length']} 字符)")
                break
        
        # 分析问题
        if translation_input and nmt_output:
            input_len = translation_input['length']
            context_len = translation_input['contextLength']
            output_len = nmt_output['length']
            
            print(f"  分析:")
            print(f"    输入长度: {input_len} 字符")
            print(f"    Context长度: {context_len} 字符")
            print(f"    输出长度: {output_len} 字符")
            
            # 估算期望输出长度（基于输入长度，英文通常比中文长1.5-3倍）
            expected_min = input_len * 1.5
            expected_max = input_len * 3
            
            if output_len > expected_max:
                print(f"    [WARN] 输出长度({output_len})远大于期望范围({expected_min:.0f}-{expected_max:.0f})")
                print(f"    可能问题: NMT返回了Context的翻译，而不是当前文本的翻译")
            elif output_len < expected_min:
                print(f"    [WARN] 输出长度({output_len})小于期望最小值({expected_min:.0f})")
                print(f"    可能问题: 提取逻辑错误，截断了翻译")

if __name__ == '__main__':
    log_path = "electron_node/electron-node/logs/electron-main.log"
    
    # 分析有问题的Job
    job_ids = [
        's-648A01EE:700',  # Job 11
        's-648A01EE:696',  # Job 7
        's-648A01EE:693',  # Job 4
    ]
    
    analyze_nmt_extraction(log_path, job_ids)
