#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析Job 8和Job 11是否应该合并
"""

import json
from pathlib import Path

def analyze_job_8_11(log_path):
    """分析Job 8和Job 11是否应该合并"""
    
    print("分析Job 8和Job 11...")
    
    if not Path(log_path).exists():
        print(f"[ERROR] 日志文件不存在: {log_path}")
        return
    
    # 读取日志
    with open(log_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # 只读取最后50万行
    lines = lines[-500000:] if len(lines) > 500000 else lines
    
    # 收集Job 8和Job 11的日志
    job_8_logs = []
    job_11_logs = []
    
    for line in lines:
        try:
            data = json.loads(line)
        except:
            continue
        
        job_id = data.get('jobId') or data.get('job_id')
        utterance_index = data.get('utteranceIndex') or data.get('utterance_index')
        
        if job_id == 's-648A01EE:697' or utterance_index == 8:
            job_8_logs.append(data)
        elif job_id == 's-648A01EE:700' or utterance_index == 11:
            job_11_logs.append(data)
    
    print(f"找到Job 8日志: {len(job_8_logs)} 条")
    print(f"找到Job 11日志: {len(job_11_logs)} 条")
    
    # 分析Job 8
    print("\n=== Job 8 ===")
    job_8_asr = None
    job_8_audio = None
    job_8_final = None
    
    for log in job_8_logs:
        msg = log.get('msg', '')
        
        if 'ASR OUTPUT' in msg:
            job_8_asr = {
                'text': log.get('asrText', ''),
                'length': log.get('asrTextLength', 0),
                'duration': log.get('audioDurationMs', 0)
            }
        
        if 'Audio processed with streaming split' in msg:
            job_8_audio = {
                'totalDurationMs': log.get('totalDurationMs', 0),
                'isPauseTriggered': log.get('isPauseTriggered', False),
                'isManualCut': log.get('isManualCut', False)
            }
        
        if 'Job processing completed' in msg:
            job_8_final = {
                'textAsr': log.get('textAsr', ''),
                'textTranslated': log.get('textTranslated', ''),
                'textAsrLength': log.get('textAsrLength', 0),
                'textTranslatedLength': log.get('textTranslatedLength', 0)
            }
    
    if job_8_asr:
        print(f"ASR输出: {job_8_asr['text']} ({job_8_asr['length']} 字符, {job_8_asr['duration']/1000:.2f} 秒)")
    if job_8_audio:
        print(f"音频处理: {job_8_audio['totalDurationMs']} 毫秒, isPauseTriggered={job_8_audio['isPauseTriggered']}, isManualCut={job_8_audio['isManualCut']}")
    if job_8_final:
        print(f"最终结果: textAsr={job_8_final['textAsr'][:50]}... ({job_8_final['textAsrLength']} 字符)")
        print(f"          textTranslated={job_8_final['textTranslated'][:100]}... ({job_8_final['textTranslatedLength']} 字符)")
    
    # 分析Job 11
    print("\n=== Job 11 ===")
    job_11_asr = None
    job_11_audio = None
    job_11_final = None
    
    for log in job_11_logs:
        msg = log.get('msg', '')
        
        if 'ASR OUTPUT' in msg:
            job_11_asr = {
                'text': log.get('asrText', ''),
                'length': log.get('asrTextLength', 0),
                'duration': log.get('audioDurationMs', 0)
            }
        
        if 'Audio processed with streaming split' in msg:
            job_11_audio = {
                'totalDurationMs': log.get('totalDurationMs', 0),
                'isPauseTriggered': log.get('isPauseTriggered', False),
                'isManualCut': log.get('isManualCut', False)
            }
        
        if 'Job processing completed' in msg:
            job_11_final = {
                'textAsr': log.get('textAsr', ''),
                'textTranslated': log.get('textTranslated', ''),
                'textAsrLength': log.get('textAsrLength', 0),
                'textTranslatedLength': log.get('textTranslatedLength', 0)
            }
    
    if job_11_asr:
        print(f"ASR输出: {job_11_asr['text']} ({job_11_asr['length']} 字符, {job_11_asr['duration']/1000:.2f} 秒)")
    if job_11_audio:
        print(f"音频处理: {job_11_audio['totalDurationMs']} 毫秒, isPauseTriggered={job_11_audio['isPauseTriggered']}, isManualCut={job_11_audio['isManualCut']}")
    if job_11_final:
        print(f"最终结果: textAsr={job_11_final['textAsr'][:50]}... ({job_11_final['textAsrLength']} 字符)")
        print(f"          textTranslated={job_11_final['textTranslated'][:100]}... ({job_11_final['textTranslatedLength']} 字符)")
    
    # 分析是否应该合并
    print("\n=== 分析 ===")
    if job_8_final and job_11_final:
        # 检查翻译结果是否相似
        text_8 = job_8_final['textTranslated'].lower()
        text_11 = job_11_final['textTranslated'].lower()
        
        # 计算相似度（简单方法：检查共同词汇）
        words_8 = set(text_8.split())
        words_11 = set(text_11.split())
        common_words = words_8 & words_11
        similarity = len(common_words) / max(len(words_8), len(words_11)) if max(len(words_8), len(words_11)) > 0 else 0
        
        print(f"翻译相似度: {similarity:.2%}")
        print(f"共同词汇: {len(common_words)} 个")
        
        if similarity > 0.5:
            print("\n[WARN] Job 8和Job 11的翻译结果高度相似，说明它们是对同一原文的两次翻译")
        
        # 检查原文
        if job_8_final['textAsr'] and job_11_final['textAsr']:
            asr_8 = job_8_final['textAsr']
            asr_11 = job_11_final['textAsr']
            print(f"\nJob 8原文: {asr_8}")
            print(f"Job 11原文: {asr_11}")
            
            # 检查Job 11的原文是否是Job 8原文的一部分
            if asr_11 in asr_8:
                print(f"\n[WARN] Job 11的原文是Job 8原文的一部分，说明应该合并")
            elif asr_8 in asr_11:
                print(f"\n[WARN] Job 8的原文是Job 11原文的一部分，说明应该合并")
            else:
                # 检查是否有重叠
                if len(asr_8) > 0 and len(asr_11) > 0:
                    # 检查Job 11是否是Job 8的后续部分
                    if asr_8.endswith(asr_11[:min(5, len(asr_11))]):
                        print(f"\n[WARN] Job 11的原文可能是Job 8原文的后续部分，说明应该合并")
        
        # 检查音频时长
        if job_8_audio and job_11_audio:
            total_8 = job_8_audio['totalDurationMs']
            total_11 = job_11_audio['totalDurationMs']
            print(f"\nJob 8音频时长: {total_8} 毫秒 ({total_8/1000:.2f} 秒)")
            print(f"Job 11音频时长: {total_11} 毫秒 ({total_11/1000:.2f} 秒)")
            
            if total_11 < 1000:  # Job 11音频很短
                print(f"\n[WARN] Job 11的音频只有 {total_11} 毫秒，说明应该合并到Job 8中")
            
            # 检查isPauseTriggered
            if job_11_audio['isPauseTriggered']:
                print(f"\n[WARN] Job 11的isPauseTriggered=True，说明调度服务器认为这是新utterance")
                print(f"       但实际上Job 11的音频很短，应该合并到Job 8中")

if __name__ == '__main__':
    log_path = "electron_node/electron-node/logs/electron-main.log"
    analyze_job_8_11(log_path)
