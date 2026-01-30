#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从节点端日志提取每个 job 在各服务的输入、输出值，写入 UTF-8 报告。
"""

import json
import sys
import os
from collections import defaultdict
from datetime import datetime

def parse_log_line(line):
    try:
        if line.strip().startswith('{'):
            return json.loads(line)
    except Exception:
        pass
    return None

def format_time(ts):
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000).strftime('%H:%M:%S.%f')[:-3]
    return str(ts)

def analyze(log_path):
    jobs = defaultdict(lambda: {
        'job_id': '', 'session_id': '', 'utterance_index': None,
        'asr_calls': [], 'nmt_calls': [], 'audio_aggregator': [],
    })
    with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            e = parse_log_line(line)
            if not e:
                continue
            jid = e.get('jobId') or e.get('job_id')
            if not jid:
                continue
            job = jobs[jid]
            if not job['job_id']:
                job['job_id'] = jid
            sid = e.get('sessionId') or e.get('session_id')
            uix = e.get('utteranceIndex') or e.get('utterance_index')
            if sid is not None and sid != '':
                job['session_id'] = sid
            if uix is not None:
                job['utterance_index'] = uix
            msg = e.get('msg', '')
            t = e.get('time', 0)
            if 'ASR INPUT' in msg:
                job['asr_calls'].append({
                    'type': 'input',
                    'time': format_time(t),
                    'audio_length': e.get('audioLength'),
                    'audio_format': e.get('audioFormat'),
                    'src_lang': e.get('srcLang'),
                    'sample_rate': e.get('sampleRate'),
                    'context_text_length': e.get('contextTextLength', 0),
                })
            if 'ASR OUTPUT' in msg:
                job['asr_calls'].append({
                    'type': 'output',
                    'time': format_time(t),
                    'text': e.get('asrText', ''),
                    'text_length': e.get('asrTextLength', 0),
                    'segments_count': e.get('segmentsCount', 0),
                    'request_duration_ms': e.get('requestDurationMs'),
                })
            if 'NMT INPUT' in msg:
                job['nmt_calls'].append({
                    'type': 'input',
                    'time': format_time(t),
                    'text': e.get('text', ''),
                    'text_length': e.get('textLength', 0),
                    'src_lang': e.get('srcLang'),
                    'tgt_lang': e.get('tgtLang'),
                    'context_text_length': e.get('contextTextLength', 0),
                })
            if 'NMT OUTPUT' in msg:
                job['nmt_calls'].append({
                    'type': 'output',
                    'time': format_time(t),
                    'text': e.get('translatedText', ''),
                    'text_length': e.get('translatedTextLength', 0),
                    'request_duration_ms': e.get('requestDurationMs'),
                })
            if 'AudioAggregator' in msg:
                job['audio_aggregator'].append({
                    'time': format_time(t),
                    'msg': msg[:120],
                    'is_manual_cut': e.get('isManualCut'),
                    'is_timeout_triggered': e.get('isTimeoutTriggered'),
                    'is_max_duration_triggered': e.get('isMaxDurationTriggered'),
                })
    return jobs

def _duration_ms(b, sr=16000):
    if not b:
        return None
    return (b / 2 / sr) * 1000

def write_report(jobs, out_path):
    lines = []
    def w(s=''):
        lines.append(s)

    w('# 集成测试 · 各 Job 在各服务的输入/输出')
    w('')
    w('从节点端日志 `electron-main.log` 提取，按 utterance_index 排序。')
    w('')

    order = sorted(
        jobs.items(),
        key=lambda x: (x[1].get('utterance_index') if x[1].get('utterance_index') is not None else 999, x[1].get('job_id', ''))
    )

    for jid, job in order:
        w('---')
        w('## Job: `' + jid + '`')
        w('')
        w(f"- **Session ID**: {job.get('session_id') or '-'}")
        w(f"- **Utterance Index**: {job.get('utterance_index') if job.get('utterance_index') is not None else '-'}")
        w('')

        # AudioAggregator
        w('### 1. AudioAggregator')
        agg = job.get('audio_aggregator') or []
        if agg:
            triggers = []
            for a in agg:
                if a.get('is_manual_cut'):
                    triggers.append('手动截断')
                if a.get('is_timeout_triggered'):
                    triggers.append('超时触发')
                if a.get('is_max_duration_triggered'):
                    triggers.append('MaxDuration触发')
            inp = ' | '.join(set(triggers)) if triggers else '（见下方事件）'
            w('- **输入**: 当前 chunk + buffer 状态；触发: ' + inp)
            w('- **输出**: 按能量切分后的 segments，送 ASR 的 batch 列表')
            w('- **事件**:')
            for a in agg[:8]:
                w(f"  - [{a['time']}] {a['msg']}")
            if len(agg) > 8:
                w(f"  - ... 共 {len(agg)} 条")
        else:
            w('- （无 AudioAggregator 记录）')
        w('')

        # ASR
        w('### 2. ASR')
        asr_in = [c for c in job['asr_calls'] if c['type'] == 'input']
        asr_out = [c for c in job['asr_calls'] if c['type'] == 'output']
        pairs = []
        for i, o in zip(asr_in, asr_out):
            pairs.append((i, o))
        if pairs:
            for idx, (i, o) in enumerate(pairs, 1):
                w(f'#### ASR 调用 #{idx}')
                dur = _duration_ms(i.get('audio_length'), i.get('sample_rate') or 16000)
                dur_s = f'{dur/1000:.1f}s' if dur is not None else '-'
                w(f"- **输入**: 音频 {i.get('audio_length')} bytes（约 {dur_s}），格式 {i.get('audio_format')}，{i.get('sample_rate') or 16000} Hz，src_lang={i.get('src_lang')}，上下文长度 {i.get('context_text_length')} 字符")
                w(f"- **输出**: 「{o.get('text')}」（{o.get('text_length')} 字，{o.get('segments_count')} 片段，耗时 {o.get('request_duration_ms') or '-'} ms）")
                w('')
        else:
            w('- **输入**: -')
            w('- **输出**: -（未调用 ASR）')
            w('')

        # NMT
        w('### 3. NMT')
        nmt_in = [c for c in job['nmt_calls'] if c['type'] == 'input']
        nmt_out = [c for c in job['nmt_calls'] if c['type'] == 'output']
        npairs = list(zip(nmt_in, nmt_out))
        if npairs:
            for idx, (i, o) in enumerate(npairs, 1):
                w(f'#### NMT 调用 #{idx}')
                w(f"- **输入**: 「{i.get('text')}」（{i.get('text_length')} 字），{i.get('src_lang')} -> {i.get('tgt_lang')}，上下文长度 {i.get('context_text_length')} 字符")
                w(f"- **输出**: 「{o.get('text')}」（{o.get('text_length')} 字，耗时 {o.get('request_duration_ms') or '-'} ms）")
                w('')
        else:
            w('- **输入**: -')
            w('- **输出**: -（未调用 NMT）')
            w('')

        # 小结
        w('### 小结')
        w(f"- ASR 调用次数: {len(asr_in)} | NMT 调用次数: {len(nmt_in)} | 总 ASR 文本长度: {sum(x.get('text_length', 0) for x in asr_out)} 字符")
        w('')

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

def main():
    if len(sys.argv) < 2:
        print('用法: python extract_job_service_io.py <log_file> [output_report.md]')
        sys.exit(1)
    log_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'job_service_io_report.md'
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    log_abs = log_path if os.path.isabs(log_path) else os.path.normpath(os.path.join(base, log_path))
    if not os.path.isfile(log_abs):
        print('日志文件不存在:', log_abs)
        sys.exit(1)
    jobs = analyze(log_abs)
    if not jobs:
        print('未找到任何 job 记录')
        sys.exit(1)
    out_abs = out_path if os.path.isabs(out_path) else os.path.normpath(os.path.join(base, out_path))
    d = os.path.dirname(out_abs)
    if d:
        os.makedirs(d, exist_ok=True)
    write_report(jobs, out_abs)
    print('已写入报告:', out_abs)
    print('Job 数量:', len(jobs))

if __name__ == '__main__':
    main()
