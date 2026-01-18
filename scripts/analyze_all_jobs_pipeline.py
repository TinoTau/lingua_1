#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析所有Job的处理流程
提取每个Job在ASR、聚合、语义修复、去重、翻译、TTS阶段的输入输出
"""

import re
import json
from collections import defaultdict
from pathlib import Path
from datetime import datetime

def parse_json_log_line(line):
    """解析JSON日志行"""
    try:
        return json.loads(line)
    except:
        return None

def extract_job_pipeline_info(log_path, session_id="s-648A01EE"):
    """提取所有Job的处理流程信息"""
    
    print(f"开始分析所有Job的处理流程...")
    print(f"日志文件: {log_path}")
    
    if not Path(log_path).exists():
        print(f"[ERROR] 日志文件不存在: {log_path}")
        return None
    
    # 读取日志
    with open(log_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # 只读取最后50万行
    lines = lines[-500000:] if len(lines) > 500000 else lines
    
    print(f"读取了 {len(lines)} 行日志")
    
    # 收集所有Job信息
    jobs = {}  # jobId -> job info
    
    # 解析日志
    for line in lines:
        try:
            data = json.loads(line)
        except:
            continue
        
        job_id = data.get('jobId') or data.get('job_id')
        if not job_id or not job_id.startswith(session_id):
            continue
        
        utterance_index = data.get('utteranceIndex') or data.get('utterance_index')
        if utterance_index is None:
            # 尝试从originalJobId或currentJobUtteranceIndex提取
            utterance_index = data.get('currentJobUtteranceIndex') or data.get('originalUtteranceIndex')
        
        msg = data.get('msg', '')
        
        # 初始化Job信息
        if job_id not in jobs:
            jobs[job_id] = {
                'jobId': job_id,
                'utteranceIndex': utterance_index if utterance_index is not None else -1,
                'stages': {}
            }
        
        # 如果找到更准确的utteranceIndex，更新它
        if utterance_index is not None and jobs[job_id]['utteranceIndex'] == -1:
            jobs[job_id]['utteranceIndex'] = utterance_index
        
        job_info = jobs[job_id]
        
        # ASR阶段
        if 'ASR OUTPUT' in msg or 'ASR service returned result' in msg or 'runAsrStep: ASR batch' in msg:
            asr_text = data.get('asrText', '')
            asr_length = data.get('asrTextLength', 0)
            segment_count = data.get('segmentsCount') or data.get('segmentCount', 0)
            
            # 如果之前没有ASR信息，或者找到了新的ASR信息，更新
            if 'ASR' not in job_info['stages'] or asr_text or asr_length > 0:
                if 'ASR' not in job_info['stages']:
                    job_info['stages']['ASR'] = {
                        'output': '',
                        'length': 0,
                        'segmentCount': 0
                    }
                
                if asr_text:
                    job_info['stages']['ASR']['output'] = asr_text
                if asr_length > 0:
                    job_info['stages']['ASR']['length'] = asr_length
                if segment_count > 0:
                    job_info['stages']['ASR']['segmentCount'] = segment_count
        
        # 聚合阶段
        if 'AggregationStage: Processing completed' in msg or 'runAggregationStep: Aggregation completed' in msg:
            aggregated_text = data.get('aggregatedText', '')
            aggregated_length = data.get('aggregatedTextLength', 0)
            
            # 总是更新聚合信息（可能为空）
            job_info['stages']['AGGREGATION'] = {
                'output': aggregated_text if aggregated_text else job_info['stages'].get('AGGREGATION', {}).get('output', ''),
                'length': aggregated_length if aggregated_length > 0 else job_info['stages'].get('AGGREGATION', {}).get('length', 0)
            }
            
            # 如果没有文本但有长度，说明日志中文本被截断了
            if not aggregated_text and aggregated_length > 0:
                job_info['stages']['AGGREGATION']['output'] = f"[日志中未找到完整文本，长度为{aggregated_length}字符]"
        
        # 语义修复阶段
        if 'runSemanticRepairStep: Semantic repair completed' in msg:
            repaired_text = data.get('repairedText', '')
            repaired_length = data.get('repairedTextLength', 0)
            
            if repaired_text or repaired_length > 0:
                job_info['stages']['SEMANTIC_REPAIR'] = {
                    'output': repaired_text,
                    'length': repaired_length
                }
        
        # 翻译阶段
        if 'TranslationStage: Sending text to NMT service' in msg:
            text_to_translate = data.get('textToTranslate', '')
            text_to_translate_length = data.get('textToTranslateLength', 0)
            context_text = data.get('contextText', '')
            context_text_length = data.get('contextTextLength', 0)
            
            job_info['stages']['TRANSLATION'] = {
                'input': text_to_translate,
                'inputLength': text_to_translate_length,
                'contextText': context_text,
                'contextTextLength': context_text_length
            }
        
        if 'NMT OUTPUT: NMT request succeeded' in msg or 'TranslationStage: NMT service returned result' in msg:
            translated_text = data.get('translatedText', '')
            translated_length = data.get('translatedTextLength', 0)
            
            if 'TRANSLATION' not in job_info['stages']:
                job_info['stages']['TRANSLATION'] = {}
            
            job_info['stages']['TRANSLATION']['output'] = translated_text
            job_info['stages']['TRANSLATION']['outputLength'] = translated_length
        
        # 最终结果
        if 'Job processing completed successfully' in msg:
            text_asr = data.get('textAsr', '')
            text_asr_length = data.get('textAsrLength', 0)
            text_translated = data.get('textTranslated', '')
            text_translated_length = data.get('textTranslatedLength', 0)
            
            job_info['stages']['FINAL'] = {
                'textAsr': text_asr,
                'textAsrLength': text_asr_length,
                'textTranslated': text_translated,
                'textTranslatedLength': text_translated_length
            }
    
    # 按utteranceIndex排序
    sorted_jobs = sorted(jobs.values(), key=lambda x: x['utteranceIndex'])
    
    print(f"找到 {len(sorted_jobs)} 个Job")
    
    return sorted_jobs

def generate_report(jobs, output_path):
    """生成分析报告"""
    
    report = f"""# 所有Job处理流程分析

## 分析日期
{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 会话ID
s-648A01EE

---

"""
    
    for job_info in jobs:
        job_id = job_info['jobId']
        utterance_index = job_info['utteranceIndex']
        
        report += f"""## Job {job_id} (utterance_index={utterance_index})

### ASR阶段
"""
        if 'ASR' in job_info['stages']:
            asr = job_info['stages']['ASR']
            report += f"""- **输出**: "{asr['output']}"
- **长度**: {asr['length']} 字符
- **片段数**: {asr['segmentCount']}
"""
        else:
            report += "- [X] 未找到ASR输出\n"
        
        report += "\n### 聚合阶段\n"
        if 'AGGREGATION' in job_info['stages']:
            agg = job_info['stages']['AGGREGATION']
            report += f"""- **输出**: "{agg['output']}"
- **长度**: {agg['length']} 字符
"""
            
            # 检查是否有变化
            if 'ASR' in job_info['stages']:
                asr_len = job_info['stages']['ASR']['length']
                if agg['length'] != asr_len:
                    report += f"- [WARN] **长度变化**: ASR({asr_len}) -> 聚合({agg['length']})\n"
        else:
            report += "- [X] 未找到聚合输出\n"
        
        report += "\n### 语义修复阶段\n"
        if 'SEMANTIC_REPAIR' in job_info['stages']:
            sem = job_info['stages']['SEMANTIC_REPAIR']
            report += f"""- **输出**: "{sem['output']}"
- **长度**: {sem['length']} 字符
"""
        else:
            report += "- [X] 未找到语义修复输出\n"
        
        report += "\n### 翻译阶段\n"
        if 'TRANSLATION' in job_info['stages']:
            trans = job_info['stages']['TRANSLATION']
            input_text = trans.get('input', '')
            input_len = trans.get('inputLength', 0)
            context_text = trans.get('contextText', '')
            context_len = trans.get('contextTextLength', 0)
            output_text = trans.get('output', '')
            output_len = trans.get('outputLength', 0)
            
            report += f"""- **输入**: "{input_text[:100]}{'...' if len(input_text) > 100 else ''}" ({input_len} 字符)
- **Context**: "{context_text[:50]}{'...' if len(context_text) > 50 else ''}" ({context_len} 字符)
- **输出**: "{output_text[:100]}{'...' if len(output_text) > 100 else ''}" ({output_len} 字符)
"""
            
            # 检查输入输出长度比例
            if input_len > 0:
                ratio = round(output_len / input_len, 2) if input_len > 0 else 0
                report += f"- **长度比例**: {ratio} (输出/输入)\n"
                
                # 检查是否使用了context
                if context_len > input_len:
                    report += f"- [WARN] **可能使用了Context**: Context长度({context_len}) > 输入长度({input_len})\n"
        else:
            report += "- [X] 未找到翻译输出\n"
        
        report += "\n### 最终结果\n"
        if 'FINAL' in job_info['stages']:
            final = job_info['stages']['FINAL']
            text_asr = final.get('textAsr', '')
            text_asr_len = final.get('textAsrLength', 0)
            text_translated = final.get('textTranslated', '')
            text_translated_len = final.get('textTranslatedLength', 0)
            
            report += f"""- **textAsr**: "{text_asr}" ({text_asr_len} 字符)
- **textTranslated**: "{text_translated[:100]}{'...' if len(text_translated) > 100 else ''}" ({text_translated_len} 字符)
"""
            
            # 检查问题
            issues = []
            if text_asr_len < 10 and text_translated_len > 100:
                issues.append("[WARN] 原文太短但译文很长")
            if text_asr_len == 0 and text_translated_len > 0:
                issues.append("[WARN] 原文为空但译文不为空")
            if text_asr_len > 0 and text_translated_len == 0:
                issues.append("[WARN] 原文不为空但译文为空")
            
            # 检查各阶段长度变化
            stages = ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR']
            prev_len = None
            for stage in stages:
                if stage in job_info['stages']:
                    curr_len = job_info['stages'][stage].get('length', 0)
                    if prev_len is not None and curr_len != prev_len:
                        issues.append(f"[WARN] {stage}阶段长度变化: {prev_len} -> {curr_len}")
                    prev_len = curr_len
            
            if issues:
                report += f"- **问题**: {', '.join(issues)}\n"
        else:
            report += "- [X] 未找到最终结果\n"
        
        report += "\n---\n\n"
    
    # 写入文件
    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"[OK] 报告已生成: {output_path}")

if __name__ == '__main__':
    log_path = "electron_node/electron-node/logs/electron-main.log"
    output_path = "docs/electron_node/ALL_JOBS_PIPELINE_ANALYSIS.md"
    
    jobs = extract_job_pipeline_info(log_path)
    if jobs:
        generate_report(jobs, output_path)
        print(f"\n[OK] 分析完成，共分析 {len(jobs)} 个Job")
