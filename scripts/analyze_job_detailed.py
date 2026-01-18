#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
详细分析单个Job的处理流程
提取每个阶段完整的输入输出信息
"""

import re
import json
from pathlib import Path
from datetime import datetime

def analyze_job_detailed(log_path, job_id, output_path):
    """详细分析单个Job的处理流程"""
    
    print(f"详细分析 Job: {job_id}")
    
    if not Path(log_path).exists():
        print(f"[ERROR] 日志文件不存在: {log_path}")
        return
    
    # 读取日志
    with open(log_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # 只读取最后50万行
    lines = lines[-500000:] if len(lines) > 500000 else lines
    
    # 收集该Job的所有相关日志
    job_logs = []
    
    for line in lines:
        try:
            data = json.loads(line)
        except:
            continue
        
        log_job_id = data.get('jobId') or data.get('job_id')
        if log_job_id == job_id:
            job_logs.append(data)
    
    print(f"找到 {len(job_logs)} 条相关日志")
    
    # 分析各个阶段
    report = f"""# Job {job_id} 详细处理流程分析

## 分析日期
{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 1. ASR阶段

"""
    
    # ASR阶段
    asr_input = None
    asr_output = None
    asr_segments = None
    
    for log in job_logs:
        msg = log.get('msg', '')
        
        if 'ASR INPUT' in msg or 'Sending ASR request' in msg:
            audio_length = log.get('audioLength', 0)
            audio_duration = log.get('estimatedDurationMs', 0)
            asr_input = {
                'audioLength': audio_length,
                'estimatedDurationMs': audio_duration
            }
        
        if 'ASR OUTPUT' in msg or 'ASR service returned result' in msg:
            asr_text = log.get('asrText', '')
            asr_length = log.get('asrTextLength', 0)
            segments = log.get('segmentsPreview', [])
            asr_output = {
                'text': asr_text,
                'length': asr_length,
                'segments': segments
            }
    
    if asr_input:
        report += f"""### ASR输入
- **音频长度**: {asr_input['audioLength']} 字节
- **估计时长**: {asr_input['estimatedDurationMs']} 毫秒

"""
    else:
        report += "- [X] 未找到ASR输入\n\n"
    
    if asr_output:
        report += f"""### ASR输出
- **识别文本**: "{asr_output['text']}"
- **文本长度**: {asr_output['length']} 字符
- **片段数**: {len(asr_output['segments'])}
- **片段详情**: {asr_output['segments']}

"""
    else:
        report += "- [X] 未找到ASR输出\n\n"
    
    # 聚合阶段
    report += "## 2. 聚合阶段\n\n"
    
    aggregation_logs = [log for log in job_logs if 'AggregationStage' in log.get('msg', '') or 'runAggregationStep' in log.get('msg', '')]
    
    for log in aggregation_logs:
        msg = log.get('msg', '')
        if 'Processing completed' in msg or 'Aggregation completed' in msg:
            asr_text = log.get('originalTextPreview', '') or log.get('originalText', '')
            aggregated_text = log.get('aggregatedTextPreview', '') or log.get('aggregatedText', '')
            asr_length = log.get('originalTextLength', 0)
            agg_length = log.get('aggregatedTextLength', 0)
            
            report += f"""### 聚合结果
- **ASR原始文本**: "{asr_text}"
- **ASR原始长度**: {asr_length} 字符
- **聚合后文本**: "{aggregated_text}"
- **聚合后长度**: {agg_length} 字符
- **是否变化**: {'是' if asr_length != agg_length else '否'}

"""
            break
    
    # 语义修复阶段
    report += "## 3. 语义修复阶段\n\n"
    
    semantic_logs = [log for log in job_logs if 'runSemanticRepairStep' in log.get('msg', '') or 'Semantic repair' in log.get('msg', '')]
    
    for log in semantic_logs:
        msg = log.get('msg', '')
        if 'Semantic repair completed' in msg:
            original_text = log.get('originalText', '')
            repaired_text = log.get('repairedText', '')
            original_length = log.get('originalTextLength', 0)
            repaired_length = log.get('repairedTextLength', 0)
            changed = log.get('textChanged', False)
            
            report += f"""### 语义修复结果
- **修复前文本**: "{original_text}"
- **修复前长度**: {original_length} 字符
- **修复后文本**: "{repaired_text}"
- **修复后长度**: {repaired_length} 字符
- **是否修改**: {'是' if changed else '否'}

"""
            break
    
    # 翻译阶段
    report += "## 4. 翻译阶段\n\n"
    
    translation_input = None
    translation_output = None
    
    for log in job_logs:
        msg = log.get('msg', '')
        
        if 'TranslationStage: Sending text to NMT service' in msg:
            text_to_translate = log.get('textToTranslate', '')
            text_length = log.get('textToTranslateLength', 0)
            context_text = log.get('contextText', '')
            context_length = log.get('contextTextLength', 0)
            
            translation_input = {
                'text': text_to_translate,
                'length': text_length,
                'context': context_text,
                'contextLength': context_length
            }
        
        if 'NMT OUTPUT: NMT request succeeded' in msg or 'TranslationStage: NMT service returned result' in msg:
            translated_text = log.get('translatedText', '')
            translated_length = log.get('translatedTextLength', 0)
            
            translation_output = {
                'text': translated_text,
                'length': translated_length
            }
    
    if translation_input:
        report += f"""### 翻译输入
- **待翻译文本**: "{translation_input['text']}"
- **待翻译长度**: {translation_input['length']} 字符
- **上下文文本**: "{translation_input['context'][:100]}{'...' if len(translation_input['context']) > 100 else ''}"
- **上下文长度**: {translation_input['contextLength']} 字符

"""
    else:
        report += "- [X] 未找到翻译输入\n\n"
    
    if translation_output:
        report += f"""### 翻译输出
- **翻译文本**: "{translation_output['text'][:200]}{'...' if len(translation_output['text']) > 200 else ''}"
- **翻译长度**: {translation_output['length']} 字符

"""
    else:
        report += "- [X] 未找到翻译输出\n\n"
    
    # 最终结果
    report += "## 5. 最终结果\n\n"
    
    final_logs = [log for log in job_logs if 'Job processing completed' in log.get('msg', '')]
    
    for log in final_logs:
        text_asr = log.get('textAsr', '')
        text_asr_length = log.get('textAsrLength', 0)
        text_translated = log.get('textTranslated', '')
        text_translated_length = log.get('textTranslatedLength', 0)
        
        report += f"""### 发送给调度器的结果
- **textAsr**: "{text_asr}"
- **textAsr长度**: {text_asr_length} 字符
- **textTranslated**: "{text_translated[:200]}{'...' if len(text_translated) > 200 else ''}"
- **textTranslated长度**: {text_translated_length} 字符

"""
        
        # 检查问题
        issues = []
        if text_asr_length < 10 and text_translated_length > 100:
            issues.append(f"[WARN] 原文太短({text_asr_length}字符)但译文很长({text_translated_length}字符)")
        
        if issues:
            report += f"\n### 问题\n" + "\n".join([f"- {issue}" for issue in issues]) + "\n"
        
        break
    
    # 写入文件
    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"[OK] 详细分析报告已生成: {output_path}")

if __name__ == '__main__':
    import sys
    
    job_id = sys.argv[1] if len(sys.argv) > 1 else 's-648A01EE:700'
    log_path = "electron_node/electron-node/logs/electron-main.log"
    output_path = f"docs/electron_node/JOB_{job_id.split(':')[-1]}_DETAILED_ANALYSIS.md"
    
    analyze_job_detailed(log_path, job_id, output_path)
