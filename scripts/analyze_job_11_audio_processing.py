#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析Job 11的音频处理流程
找出为什么ASR只识别了9字符（音频只有0.48秒）
"""

import json
from pathlib import Path
from datetime import datetime

def analyze_job_11_audio(log_path, job_id='s-648A01EE:700'):
    """分析Job 11的音频处理流程"""
    
    print(f"分析 Job {job_id} 的音频处理流程...")
    
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
        utterance_index = data.get('utteranceIndex') or data.get('utterance_index')
        
        # 收集Job 11及其相关日志
        if log_job_id == job_id or utterance_index == 11:
            job_logs.append(data)
    
    print(f"找到 {len(job_logs)} 条相关日志")
    
    # 分析音频处理流程
    report = f"""# Job {job_id} 音频处理流程分析

## 分析日期
{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 问题
为什么ASR只识别了9字符（"我們當前的切分策略"），音频只有0.48秒？

---

## 1. 音频接收和处理

"""
    
    # 查找音频接收和处理日志
    audio_received = None
    audio_processed = None
    audio_finalized = None
    
    for log in job_logs:
        msg = log.get('msg', '')
        job_id_log = log.get('jobId', '')
        
        # 音频接收
        if 'received audio data' in msg and job_id_log == job_id:
            audio_length = log.get('audioLength', 0)
            audio_format = log.get('audioFormat', '')
            audio_received = {
                'length': audio_length,
                'format': audio_format,
                'timestamp': log.get('time', 0)
            }
            report += f"""### 音频接收
- **接收时间**: {log.get('time', 'N/A')}
- **音频长度**: {audio_length} 字节
- **音频格式**: {audio_format}

"""
        
        # AudioAggregator处理
        if 'AudioAggregator' in msg and job_id_log == job_id:
            total_duration = log.get('totalDurationMs', 0)
            is_pause = log.get('isPauseTriggered', False)
            is_manual = log.get('isManualCut', False)
            is_timeout = log.get('isTimeoutTriggered', False)
            
            if 'Audio processed with streaming split' in msg:
                audio_processed = {
                    'totalDurationMs': total_duration,
                    'isPauseTriggered': is_pause,
                    'isManualCut': is_manual,
                    'isTimeoutTriggered': is_timeout,
                    'segmentCount': log.get('segmentCount', 0),
                    'batchCount': log.get('batchCount', 0)
                }
                report += f"""### AudioAggregator处理
- **总时长**: {total_duration} 毫秒 ({total_duration/1000:.2f} 秒)
- **isPauseTriggered**: {is_pause}
- **isManualCut**: {is_manual}
- **isTimeoutTriggered**: {is_timeout}
- **片段数**: {log.get('segmentCount', 0)}
- **批次數**: {log.get('batchCount', 0)}

"""
            
            # 检查是否有pendingTimeoutAudio
            if 'pendingTimeoutAudio' in msg:
                pending_duration = log.get('pendingTimeoutAudioDurationMs', 0)
                report += f"""### PendingTimeoutAudio
- **pendingTimeoutAudioDurationMs**: {pending_duration} 毫秒 ({pending_duration/1000:.2f} 秒)
- **说明**: 这是上一个Job缓存的音频，等待合并

"""
        
        # ASR结果
        if 'ASR OUTPUT' in msg and job_id_log == job_id:
            asr_text = log.get('asrText', '')
            asr_length = log.get('asrTextLength', 0)
            audio_duration = log.get('audioDurationMs', 0)
            segment_count = log.get('segmentsCount', 0)
            
            audio_finalized = {
                'asrText': asr_text,
                'asrLength': asr_length,
                'audioDurationMs': audio_duration,
                'segmentCount': segment_count
            }
            
            report += f"""### ASR输出
- **识别文本**: "{asr_text}"
- **文本长度**: {asr_length} 字符
- **音频时长**: {audio_duration} 毫秒 ({audio_duration/1000:.2f} 秒)
- **片段数**: {segment_count}

"""
    
    # 分析问题
    report += "\n## 2. 问题分析\n\n"
    
    if audio_processed and audio_finalized:
        total_duration = audio_processed['totalDurationMs']
        asr_audio_duration = audio_finalized['audioDurationMs']
        
        report += f"""### 时长对比
- **AudioAggregator处理时长**: {total_duration} 毫秒 ({total_duration/1000:.2f} 秒)
- **ASR音频时长**: {asr_audio_duration} 毫秒 ({asr_audio_duration/1000:.2f} 秒)
- **差异**: {abs(total_duration - asr_audio_duration)} 毫秒

"""
        
        # 检查是否被提前切分
        if total_duration < 1000:  # 小于1秒
            report += f"""### 问题：音频被提前切分
- **原因**: AudioAggregator处理时长只有 {total_duration} 毫秒，说明音频被提前切分了
- **可能原因**:
  1. `isPauseTriggered: {audio_processed['isPauseTriggered']}` - 静音检测导致提前切分
  2. `isManualCut: {audio_processed['isManualCut']}` - 手动切分
  3. `isTimeoutTriggered: {audio_processed['isTimeoutTriggered']}` - 超时触发

"""
        
        # 检查相邻Job
        report += "\n## 3. 相邻Job分析\n\n"
        
        # 查找Job 10（上一个Job）
        job_10_logs = [log for log in job_logs if log.get('utteranceIndex') == 10]
        if job_10_logs:
            job_10_asr = None
            for log in job_10_logs:
                if 'ASR OUTPUT' in log.get('msg', ''):
                    job_10_asr = {
                        'text': log.get('asrText', ''),
                        'length': log.get('asrTextLength', 0),
                        'duration': log.get('audioDurationMs', 0)
                    }
                    break
            
            if job_10_asr:
                report += f"""### Job 10 (上一个Job)
- **识别文本**: "{job_10_asr['text'][:50]}{'...' if len(job_10_asr['text']) > 50 else ''}"
- **文本长度**: {job_10_asr['length']} 字符
- **音频时长**: {job_10_asr['duration']} 毫秒 ({job_10_asr['duration']/1000:.2f} 秒)

"""
        
        # 查找Job 12（下一个Job）
        job_12_logs = [log for log in job_logs if log.get('utteranceIndex') == 12]
        if job_12_logs:
            job_12_asr = None
            for log in job_12_logs:
                if 'ASR OUTPUT' in log.get('msg', ''):
                    job_12_asr = {
                        'text': log.get('asrText', ''),
                        'length': log.get('asrTextLength', 0),
                        'duration': log.get('audioDurationMs', 0)
                    }
                    break
            
            if job_12_asr:
                report += f"""### Job 12 (下一个Job)
- **识别文本**: "{job_12_asr['text'][:50]}{'...' if len(job_12_asr['text']) > 50 else ''}"
- **文本长度**: {job_12_asr['length']} 字符
- **音频时长**: {job_12_asr['duration']} 毫秒 ({job_12_asr['duration']/1000:.2f} 秒)

"""
    
    # 查找相关的AudioAggregator日志（更详细的上下文）
    report += "\n## 4. AudioAggregator详细日志\n\n"
    
    for log in job_logs:
        msg = log.get('msg', '')
        if 'AudioAggregator' in msg:
            report += f"""### {msg[:80]}
- **时间**: {log.get('time', 'N/A')}
- **totalDurationMs**: {log.get('totalDurationMs', 'N/A')}
- **isPauseTriggered**: {log.get('isPauseTriggered', 'N/A')}
- **isManualCut**: {log.get('isManualCut', 'N/A')}
- **isTimeoutTriggered**: {log.get('isTimeoutTriggered', 'N/A')}

"""
    
    # 写入文件
    output_path = f"docs/electron_node/JOB_11_AUDIO_PROCESSING_ANALYSIS.md"
    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"[OK] 分析报告已生成: {output_path}")

if __name__ == '__main__':
    log_path = "electron_node/electron-node/logs/electron-main.log"
    analyze_job_11_audio(log_path)
