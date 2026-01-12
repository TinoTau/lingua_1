#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分析浏览器控制台日志，检查每段音频是否进入播放区
"""

import re
import sys

def analyze_console_log(log_text):
    """分析控制台日志"""
    # 预期的utterance_index列表（从调度服务器发送的）
    expected_indices = [0, 2, 4, 8, 11, 13, 17, 19, 28]
    
    # 收集每个utterance_index的处理情况
    results = {}
    for idx in expected_indices:
        results[idx] = {
            'received': False,
            'prepared': False,
            'added': False,
            'discarded': False,
            'buffer_count': None,
            'was_trimmed': False
        }
    
    lines = log_text.split('\n')
    
    for line in lines:
        # 检查收到translation_result消息
        if '收到 translation_result 消息' in line and 'utterance_index' in line:
            match = re.search(r'utterance_index[:\s]+(\d+)', line)
            if match:
                idx = int(match.group(1))
                if idx in results:
                    results[idx]['received'] = True
        
        # 检查准备添加TTS音频
        if '准备添加 TTS 音频到缓冲区' in line and 'utterance_index' in line:
            match = re.search(r'utterance_index[:\s]+(\d+)', line)
            if match:
                idx = int(match.group(1))
                if idx in results:
                    results[idx]['prepared'] = True
        
        # 检查音频已添加到缓冲区
        if '音频块已添加到缓冲区' in line and 'utterance_index' in line:
            match = re.search(r'utterance_index[:\s]+(\d+)', line)
            if match:
                idx = int(match.group(1))
                if idx in results:
                    results[idx]['added'] = True
                    # 提取buffer_count
                    buffer_match = re.search(r'buffer_count[:\s]+(\d+)', line)
                    if buffer_match:
                        results[idx]['buffer_count'] = int(buffer_match.group(1))
                    # 检查是否被trimmed
                    if 'was_trimmed[:\s]+true' in line or 'was_trimmed: true' in line:
                        results[idx]['was_trimmed'] = True
        
        # 检查音频被丢弃
        if '丢弃' in line and ('TTS' in line or '音频' in line):
            # 尝试从上下文中找到utterance_index
            for idx in results:
                if f'utterance_index: {idx}' in line or f'utterance_index={idx}' in line:
                    results[idx]['discarded'] = True
        
        # 检查缓存已满的情况
        if '缓存已满，丢弃最旧音频块' in line or '缓存已满，已丢弃最旧的音频块' in line:
            # 查找最近的utterance_index
            for i, line_idx in enumerate(lines):
                if line_idx == line:
                    # 向前查找最近的utterance_index
                    for j in range(max(0, i-10), i):
                        match = re.search(r'utterance_index[:\s]+(\d+)', lines[j])
                        if match:
                            idx = int(match.group(1))
                            if idx in results:
                                results[idx]['was_trimmed'] = True
                                break
    
    return results

def main():
    if len(sys.argv) < 2:
        print("用法: python analyze_web_console_logs.py <console_log_file>")
        print("或者直接粘贴日志内容到标准输入")
        return
    
    log_file = sys.argv[1]
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            log_text = f.read()
    except FileNotFoundError:
        print(f"文件不存在: {log_file}")
        return
    
    results = analyze_console_log(log_text)
    
    print("=" * 80)
    print("Web端音频接收和播放区添加情况分析")
    print("=" * 80)
    print()
    
    expected_count = len(results)
    received_count = sum(1 for r in results.values() if r['received'])
    prepared_count = sum(1 for r in results.values() if r['prepared'])
    added_count = sum(1 for r in results.values() if r['added'])
    trimmed_count = sum(1 for r in results.values() if r['was_trimmed'])
    
    print(f"调度服务器发送的音频数量: {expected_count}")
    print(f"Web端收到消息数量: {received_count}")
    print(f"Web端准备添加数量: {prepared_count}")
    print(f"Web端成功添加到缓冲区数量: {added_count}")
    print(f"被缓存清理丢弃的数量: {trimmed_count}")
    print()
    
    print("=" * 80)
    print("逐段详细分析")
    print("=" * 80)
    print()
    
    for idx in sorted(results.keys()):
        r = results[idx]
        status = "✅" if r['received'] and r['prepared'] and r['added'] else "❌"
        
        print(f"{status} utterance_index={idx}:")
        print(f"  收到消息: {'✅' if r['received'] else '❌'}")
        print(f"  准备添加: {'✅' if r['prepared'] else '❌'}")
        print(f"  已添加到缓冲区: {'✅' if r['added'] else '❌'}")
        if r['buffer_count'] is not None:
            print(f"  缓冲区数量: {r['buffer_count']}")
        if r['was_trimmed']:
            print(f"  ⚠️  被缓存清理丢弃")
        if r['discarded']:
            print(f"  ⚠️  被明确丢弃")
        print()
    
    print("=" * 80)
    print("总结")
    print("=" * 80)
    
    if received_count == expected_count and added_count == expected_count and trimmed_count == 0:
        print("✅ 所有音频都成功进入播放区")
    else:
        print("⚠️  存在问题:")
        if received_count < expected_count:
            print(f"  - {expected_count - received_count} 段音频未收到消息")
        if added_count < expected_count:
            print(f"  - {expected_count - added_count} 段音频未添加到缓冲区")
        if trimmed_count > 0:
            print(f"  - {trimmed_count} 段音频被缓存清理丢弃")

if __name__ == '__main__':
    main()

