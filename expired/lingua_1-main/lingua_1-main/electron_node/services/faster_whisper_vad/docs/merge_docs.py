#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文档合并脚本
将相关文档合并到分类文件中，每个文件不超过500行
"""

import os
from pathlib import Path
from typing import List, Dict

# 定义文档分类
CATEGORIES = {
    "crash_analysis": [
        "CRASH_ANALYSIS_FINAL.md",
        "CRASH_ANALYSIS_OPUS_DECODER.md",
        "CRASH_ANALYSIS_PROCESS_ISOLATION.md",
        "CRASH_ANALYSIS_SEGMENTS_CONVERSION.md",
        "CRASH_DIAGNOSIS.md",
        "CRASH_ROOT_CAUSE_ANALYSIS.md",
        "CRASH_FIX_ENHANCED.md",
        "CRASH_FIX_OPUS_DECODING.md",
        "SERVICE_CRASH_ANALYSIS.md",
        "SERVICE_CRASH_ANALYSIS_OPUS.md",
        "ASR_CRASH_FIX.md",
        "ASR_CRASH_FIX_SUMMARY.md"
    ],
    
    "opus_decoding": [
        "OPUS_CRASH_ROOT_CAUSE_ANALYSIS.md",
        "OPUS_CRASH_DEEP_ANALYSIS.md",
        "OPUS_CRASH_FIX_SUMMARY.md",
        "OPUS_DECODER_CRASH_FIX.md",
        "OPUS_DECODER_CONCURRENCY_FIX.md",
        "OPUS_DECODING_EXECUTIVE_SUMMARY.md",
        "OPUS_DECODING_ISSUE_REPORT.md",
        "OPUS_DECODE_QUALITY_ANALYSIS.md",
        "OPUS_DECODE_QUALITY_ROOT_CAUSE.md",
        "OPUS_CONFIG_COMPARISON.md",
        "OPUS_CONCURRENCY_TEST_RESULTS.md",
        "OPUS_TEST_SCRIPT_UPDATE.md"
    ],
    
    "audio_processing": [
        "AUDIO_TRUNCATION_ROOT_CAUSE_ANALYSIS.md",
        "AUDIO_TRUNCATION_FIX.md",
        "AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md",
        "AUDIO_CHUNK_ACCUMULATION_MECHANISM.md",
        "AUDIO_CHUNK_CONCATENATION_ANALYSIS.md",
        "AUDIO_CONTEXT_ANALYSIS.md",
        "AUDIO_FORMAT_INVESTIGATION.md",
        "AUDIO_MESSAGE_ARCHITECTURE_ANALYSIS.md",
        "AUDIO_QUALITY_ANALYSIS.md",
        "BUFFER_CAPACITY_ANALYSIS.md",
        "BITRATE_CONFIGURATION.md",
        "BITRATE_FIX_SUMMARY.md",
        "FIX_AUDIO_CHUNK_FORMAT.md"
    ],
    
    "context_and_deduplication": [
        "CONTEXT_REPEAT_ISSUE_ROOT_CAUSE.md",
        "CONTEXT_DUPLICATE_ISSUE_EXPLANATION.md",
        "DEDUPLICATION_ENHANCEMENT.md",
        "DEDUPLICATION_RESPONSE_FIX.md",
        "UTTERANCE_CONTEXT_AND_DEDUPLICATION.md",
        "UTTERANCE_CONTEXT_MECHANISM.md",
        "ASR_DUPLICATE_TEXT_ANALYSIS.md",
        "ASR_DUPLICATE_TEXT_FIX.md"
    ],
    
    "queue_and_results": [
        "ASR_QUEUE_FIX_SUMMARY.md",
        "ASR_QUEUE_IMPLEMENTATION_SUMMARY.md",
        "ASR_QUEUE_TEST_RESULTS.md",
        "RESULT_QUEUE_AND_ASR_ENCODING_ISSUES.md",
        "RESULT_QUEUE_FIX_IMPLEMENTATION_SUMMARY.md",
        "RESULT_QUEUE_GAP_TOLERANCE_AND_ASR_UX_FIX_IMPLEMENTATION_GUIDE.md",
        "JOB_RESULT_QUEUE_FIX.md"
    ],
    
    "error_analysis": [
        "ERROR_404_ANALYSIS.md",
        "ERROR_ANALYSIS_404_400.md",
        "ERROR_ANALYSIS_INTEGRATION_TEST.md",
        "ERROR_ROOT_CAUSE_ANALYSIS.md",
        "COMPREHENSIVE_404_INVESTIGATION.md",
        "NMT_404_ERROR_ANALYSIS.md",
        "NMT_404_FIX_SUMMARY.md",
        "SCHEDULER_404_ERROR_ANALYSIS.md",
        "NODE_CLIENT_404_INVESTIGATION.md"
    ],
    
    "web_client_integration": [
        "WEB_CLIENT_AUDIO_BUFFER_AND_ASR_CONTEXT_ISSUES.md",
        "WEB_CLIENT_AUDIO_FORMAT_ANALYSIS.md",
        "WEB_CLIENT_NO_AUDIO_DIAGNOSIS.md",
        "WEB_CLIENT_SILENCE_FILTER_ISSUE.md"
    ],
    
    "scheduler_integration": [
        "SCHEDULER_AUDIO_CHUNK_FINALIZE_MECHANISM.md",
        "SCHEDULER_TIMEOUT_ANALYSIS.md",
        "SCHEDULER_404_ERROR_ANALYSIS.md"
    ]
}

MAX_LINES = 500

def merge_documents(category: str, files: List[str], docs_path: Path, output_path: Path, title: str):
    """合并文档"""
    content = f"# {title}\n\n本文档合并了所有相关文档。\n\n---\n\n"
    file_count = 0
    
    for file in files:
        file_path = docs_path / file
        if file_path.exists():
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    file_content = f.read()
                if file_content.strip():
                    content += f"## {file}\n\n{file_content}\n\n---\n\n"
                    file_count += 1
            except Exception as e:
                print(f"  Warning: Failed to read {file}: {e}")
    
    # 计算行数
    lines = content.split('\n')
    line_count = len(lines)
    
    if line_count > MAX_LINES:
        # 需要分割
        parts = (line_count + MAX_LINES - 1) // MAX_LINES
        
        for i in range(parts):
            start_idx = i * MAX_LINES
            end_idx = min((i + 1) * MAX_LINES, line_count)
            part_lines = lines[start_idx:end_idx]
            part_content = '\n'.join(part_lines)
            
            if parts > 1:
                part_file = output_path.parent / f"{output_path.stem}_part{i+1}.md"
                part_content = f"# {title} (Part {i+1}/{parts})\n\n{part_content}"
            else:
                part_file = output_path
                part_content = f"# {title}\n\n{part_content}"
            
            with open(part_file, 'w', encoding='utf-8') as f:
                f.write(part_content)
            print(f"  Created: {part_file.name} ({len(part_lines)} lines)")
    else:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  Created: {output_path.name} ({line_count} lines, {file_count} files)")

def main():
    script_dir = Path(__file__).parent
    docs_path = script_dir
    organized_path = script_dir / "organized"
    
    # 处理每个分类
    for category, files in CATEGORIES.items():
        category_path = organized_path / category
        category_path.mkdir(parents=True, exist_ok=True)
        
        output_file = category_path / f"{category}.merged.md"
        title = category.replace("_", " ").title()
        
        print(f"Processing category: {category}")
        merge_documents(category, files, docs_path, output_file, title)
    
    print("\nDocument merging completed!")

if __name__ == "__main__":
    main()

