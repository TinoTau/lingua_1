#!/usr/bin/env python3
"""
Job处理流程分析工具

用于分析节点端日志，追踪每个job在ASR和NMT服务中的处理过程，
包括输入输出、处理时间、错误信息等。

使用方法:
    python analyze_job_processing.py <log_file_path> [--job-id <job_id>] [--session-id <session_id>]
    
示例:
    # 分析所有job
    python analyze_job_processing.py electron-node/logs/electron-main.log
    
    # 分析特定job
    python analyze_job_processing.py electron-node/logs/electron-main.log --job-id job_123
    
    # 分析特定session的所有job
    python analyze_job_processing.py electron-node/logs/electron-main.log --session-id session_456
"""

import json
import re
import sys
import argparse
from typing import Dict, List, Optional, Any
from collections import defaultdict
from datetime import datetime

class JobProcessor:
    """Job处理流程分析器"""
    
    def __init__(self):
        self.jobs: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            'job_id': '',
            'session_id': '',
            'utterance_index': None,
            'trace_id': '',
            'audio_aggregator': {},
            'asr_input': {},
            'asr_output': {},
            'nmt_input': {},
            'nmt_output': {},
            'translation_stage': {},
            'errors': [],
            'timeline': []
        })
        
    def parse_log_line(self, line: str) -> Optional[Dict[str, Any]]:
        """解析单行日志"""
        try:
            # 尝试解析JSON格式日志（pino格式）
            if line.strip().startswith('{'):
                log_entry = json.loads(line)
                return log_entry
            # 尝试解析Python格式日志
            elif '[' in line and ']' in line:
                # Python日志格式: [timestamp] [LEVEL] [module] message
                match = re.match(r'\[([^\]]+)\] \[([^\]]+)\] (?:\[([^\]]+)\])? (.+)', line)
                if match:
                    timestamp, level, module, message = match.groups()
                    return {
                        'time': timestamp,
                        'level': level,
                        'module': module or '',
                        'msg': message
                    }
        except json.JSONDecodeError:
            pass
        except Exception as e:
            pass
        
        return None
    
    def extract_job_info(self, log_entry: Dict[str, Any]) -> Optional[Dict[str, str]]:
        """从日志中提取job信息"""
        job_id = log_entry.get('jobId') or log_entry.get('job_id')
        session_id = log_entry.get('sessionId') or log_entry.get('session_id')
        utterance_index = log_entry.get('utteranceIndex') or log_entry.get('utterance_index')
        trace_id = log_entry.get('trace_id') or log_entry.get('traceId') or job_id
        
        if job_id:
            return {
                'job_id': str(job_id),
                'session_id': str(session_id) if session_id else '',
                'utterance_index': utterance_index,
                'trace_id': str(trace_id)
            }
        return None
    
    def process_log_entry(self, log_entry: Dict[str, Any], line_num: int):
        """处理单条日志记录"""
        job_info = self.extract_job_info(log_entry)
        if not job_info:
            return
        
        job_id = job_info['job_id']
        job = self.jobs[job_id]
        
        # 更新job基本信息
        if not job['job_id']:
            job.update(job_info)
        
        msg = log_entry.get('msg', '')
        level = log_entry.get('level', 'info').lower()
        time = log_entry.get('time', log_entry.get('timestamp', ''))
        
        # 记录时间线
        job['timeline'].append({
            'time': time,
            'level': level,
            'msg': msg[:200],  # 截断过长的消息
            'line': line_num
        })
        
        # 解析ASR输入日志
        if 'ASR INPUT' in msg or 'ASR 接口入参' in msg:
            job['asr_input'] = {
                'time': time,
                'audio_length': log_entry.get('audioLength') or log_entry.get('audio_length'),
                'audio_format': log_entry.get('audioFormat') or log_entry.get('audio_format'),
                'src_lang': log_entry.get('srcLang') or log_entry.get('src_lang'),
                'sample_rate': log_entry.get('sampleRate') or log_entry.get('sample_rate'),
                'context_text': log_entry.get('contextText') or log_entry.get('context_text'),
                'context_text_length': log_entry.get('contextTextLength') or log_entry.get('context_text_length'),
                'enable_streaming': log_entry.get('enableStreaming') or log_entry.get('enable_streaming'),
                'raw': log_entry
            }
        
        # 解析ASR输出日志
        if 'ASR OUTPUT' in msg or 'ASR 识别完成' in msg or 'Final text to be sent to NMT' in msg:
            asr_text = log_entry.get('asrText') or log_entry.get('text') or log_entry.get('transcript')
            if not asr_text and 'Final text' in msg:
                # 尝试从消息中提取文本
                match = re.search(r"Final text.*?'([^']+)'", msg)
                if match:
                    asr_text = match.group(1)
            
            if asr_text or 'ASR OUTPUT' in msg:
                job['asr_output'] = {
                    'time': time,
                    'text': asr_text,
                    'text_length': log_entry.get('asrTextLength') or log_entry.get('textLength') or (len(asr_text) if asr_text else 0),
                    'segments_count': log_entry.get('segmentsCount') or log_entry.get('segments_count'),
                    'quality_score': log_entry.get('qualityScore') or log_entry.get('quality_score'),
                    'language': log_entry.get('language'),
                    'language_probability': log_entry.get('languageProbability') or log_entry.get('language_probability'),
                    'request_duration_ms': log_entry.get('requestDurationMs') or log_entry.get('request_duration_ms'),
                    'raw': log_entry
                }
        
        # 解析NMT输入日志
        if 'NMT INPUT' in msg or 'Sending text to NMT service' in msg:
            text_to_translate = log_entry.get('text') or log_entry.get('textToTranslate')
            if text_to_translate:
                job['nmt_input'] = {
                    'time': time,
                    'text': text_to_translate,
                    'text_length': log_entry.get('textLength') or log_entry.get('textToTranslateLength') or len(text_to_translate),
                    'src_lang': log_entry.get('srcLang') or log_entry.get('src_lang'),
                    'tgt_lang': log_entry.get('tgtLang') or log_entry.get('tgt_lang'),
                    'context_text': log_entry.get('contextText') or log_entry.get('context_text'),
                    'context_text_length': log_entry.get('contextTextLength') or log_entry.get('context_text_length'),
                    'raw': log_entry
                }
        
        # 解析NMT输出日志
        if 'NMT OUTPUT' in msg or 'NMT service returned result' in msg:
            translated_text = log_entry.get('translatedText') or log_entry.get('nmtResultText') or log_entry.get('text')
            if translated_text:
                job['nmt_output'] = {
                    'time': time,
                    'text': translated_text,
                    'text_length': log_entry.get('translatedTextLength') or log_entry.get('nmtResultTextLength') or log_entry.get('textLength') or len(translated_text),
                    'confidence': log_entry.get('confidence'),
                    'request_duration_ms': log_entry.get('requestDurationMs') or log_entry.get('request_duration_ms'),
                    'raw': log_entry
                }
        
        # 解析AudioAggregator日志
        if 'AudioAggregator' in msg:
            if 'shouldProcessNow' in msg or 'Processing audio' in msg:
                job['audio_aggregator']['processing'] = {
                    'time': time,
                    'total_duration_ms': log_entry.get('totalDurationMs'),
                    'chunk_count': log_entry.get('chunkCount'),
                    'is_manual_cut': log_entry.get('isManualCut'),
                    'is_pause_triggered': log_entry.get('isPauseTriggered'),
                    'is_timeout_triggered': log_entry.get('isTimeoutTriggered'),
                    'raw': log_entry
                }
        
        # 解析错误日志
        if level in ['error', 'warn'] and ('failed' in msg.lower() or 'error' in msg.lower() or 'timeout' in msg.lower()):
            job['errors'].append({
                'time': time,
                'level': level,
                'msg': msg,
                'raw': log_entry
            })
    
    def analyze_log_file(self, file_path: str, filter_job_id: Optional[str] = None, filter_session_id: Optional[str] = None):
        """分析日志文件"""
        print(f"正在分析日志文件: {file_path}")
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line_num, line in enumerate(f, 1):
                    log_entry = self.parse_log_line(line)
                    if log_entry:
                        job_info = self.extract_job_info(log_entry)
                        if job_info:
                            # 应用过滤器
                            if filter_job_id and job_info['job_id'] != filter_job_id:
                                continue
                            if filter_session_id and job_info['session_id'] != filter_session_id:
                                continue
                        
                        self.process_log_entry(log_entry, line_num)
        except FileNotFoundError:
            print(f"错误: 找不到日志文件 {file_path}")
            return False
        except Exception as e:
            print(f"错误: 读取日志文件时出错: {e}")
            return False
        
        return True
    
    def print_job_summary(self, job_id: str):
        """打印job处理摘要"""
        job = self.jobs[job_id]
        if not job['job_id']:
            print(f"未找到job: {job_id}")
            return
        
        print("\n" + "="*80)
        print(f"Job处理流程分析: {job_id}")
        print("="*80)
        print(f"Session ID: {job['session_id']}")
        print(f"Utterance Index: {job['utterance_index']}")
        print(f"Trace ID: {job['trace_id']}")
        
        # AudioAggregator信息
        if job['audio_aggregator']:
            print("\n[AudioAggregator]")
            agg = job['audio_aggregator'].get('processing', {})
            if agg:
                print(f"  总时长: {agg.get('total_duration_ms')}ms")
                print(f"  音频块数: {agg.get('chunk_count')}")
                print(f"  手动截断: {agg.get('is_manual_cut')}")
                print(f"  静音触发: {agg.get('is_pause_triggered')}")
                print(f"  超时触发: {agg.get('is_timeout_triggered')}")
        
        # ASR输入
        if job['asr_input']:
            print("\n[ASR输入]")
            asr_in = job['asr_input']
            print(f"  音频长度: {asr_in.get('audio_length')} bytes")
            print(f"  音频格式: {asr_in.get('audio_format')}")
            print(f"  采样率: {asr_in.get('sample_rate')} Hz")
            print(f"  源语言: {asr_in.get('src_lang')}")
            if asr_in.get('context_text'):
                ctx = asr_in.get('context_text')
                ctx_preview = ctx[:100] + '...' if len(ctx) > 100 else ctx
                print(f"  上下文文本: {ctx_preview} (长度: {asr_in.get('context_text_length')})")
        
        # ASR输出
        if job['asr_output']:
            print("\n[ASR输出]")
            asr_out = job['asr_output']
            print(f"  识别文本: \"{asr_out.get('text', '')}\"")
            print(f"  文本长度: {asr_out.get('text_length')} 字符")
            print(f"  片段数: {asr_out.get('segments_count')}")
            print(f"  质量分数: {asr_out.get('quality_score')}")
            print(f"  检测语言: {asr_out.get('language')}")
            print(f"  语言概率: {asr_out.get('language_probability')}")
            print(f"  处理时间: {asr_out.get('request_duration_ms')}ms")
        else:
            print("\n[ASR输出] 未找到")
        
        # NMT输入
        if job['nmt_input']:
            print("\n[NMT输入]")
            nmt_in = job['nmt_input']
            print(f"  待翻译文本: \"{nmt_in.get('text', '')}\"")
            print(f"  文本长度: {nmt_in.get('text_length')} 字符")
            print(f"  源语言: {nmt_in.get('src_lang')} -> 目标语言: {nmt_in.get('tgt_lang')}")
            if nmt_in.get('context_text'):
                ctx = nmt_in.get('context_text')
                ctx_preview = ctx[:50] + '...' if len(ctx) > 50 else ctx
                print(f"  上下文文本: {ctx_preview} (长度: {nmt_in.get('context_text_length')})")
        else:
            print("\n[NMT输入] 未找到")
        
        # NMT输出
        if job['nmt_output']:
            print("\n[NMT输出]")
            nmt_out = job['nmt_output']
            print(f"  翻译文本: \"{nmt_out.get('text', '')}\"")
            print(f"  文本长度: {nmt_out.get('text_length')} 字符")
            print(f"  置信度: {nmt_out.get('confidence')}")
            print(f"  处理时间: {nmt_out.get('request_duration_ms')}ms")
        else:
            print("\n[NMT输出] 未找到")
        
        # 错误信息
        if job['errors']:
            print("\n[错误/警告]")
            for error in job['errors']:
                print(f"  [{error['level'].upper()}] {error['msg'][:200]}")
        
        # 时间线（最近10条）
        if job['timeline']:
            print("\n[处理时间线] (最近10条)")
            for entry in job['timeline'][-10:]:
                print(f"  [{entry['time']}] [{entry['level']}] {entry['msg'][:100]}")
    
    def print_all_jobs_summary(self):
        """打印所有job的摘要"""
        if not self.jobs:
            print("未找到任何job记录")
            return
        
        print(f"\n找到 {len(self.jobs)} 个job")
        print("="*80)
        
        # 按utterance_index排序
        sorted_jobs = sorted(
            self.jobs.items(),
            key=lambda x: (x[1].get('utterance_index') or 0, x[1].get('job_id', ''))
        )
        
        for job_id, job in sorted_jobs:
            print(f"\nJob: {job_id} | Session: {job['session_id']} | Utterance: {job['utterance_index']}")
            if job['asr_output']:
                asr_text = job['asr_output'].get('text', '')
                print(f"  ASR: \"{asr_text[:80]}{'...' if len(asr_text) > 80 else ''}\"")
            if job['nmt_output']:
                nmt_text = job['nmt_output'].get('text', '')
                print(f"  NMT: \"{nmt_text[:80]}{'...' if len(nmt_text) > 80 else ''}\"")


def main():
    parser = argparse.ArgumentParser(description='分析节点端job处理流程日志')
    parser.add_argument('log_file', help='日志文件路径')
    parser.add_argument('--job-id', help='只分析指定的job_id')
    parser.add_argument('--session-id', help='只分析指定的session_id')
    parser.add_argument('--summary', action='store_true', help='只显示摘要，不显示详细信息')
    
    args = parser.parse_args()
    
    processor = JobProcessor()
    
    if not processor.analyze_log_file(args.log_file, args.job_id, args.session_id):
        sys.exit(1)
    
    if args.job_id:
        processor.print_job_summary(args.job_id)
    elif args.summary:
        processor.print_all_jobs_summary()
    else:
        # 显示所有job的详细信息
        for job_id in sorted(processor.jobs.keys()):
            processor.print_job_summary(job_id)
            print()


if __name__ == '__main__':
    main()
