#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证文档整理结果
"""

from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent.parent.parent
SCHED_DOCS = ROOT_DIR / "central_server" / "scheduler" / "docs"
CS_DOCS = ROOT_DIR / "central_server" / "docs"

def count_files(directory, pattern="*.md"):
    """统计文件数量"""
    if not directory.exists():
        return 0
    return len(list(directory.rglob(pattern)))

def list_files(directory, pattern="*.md"):
    """列出所有文件"""
    if not directory.exists():
        return []
    return sorted([f.relative_to(directory) for f in directory.rglob(pattern)])

def check_file_lines(file_path):
    """检查文件行数"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return len(f.readlines())
    except:
        return 0

def main():
    print("=" * 60)
    print("文档整理验证报告")
    print("=" * 60)
    print()
    
    # 1. Scheduler文档统计
    print("1. Scheduler文档")
    print("-" * 60)
    sched_files = list_files(SCHED_DOCS)
    print(f"总数: {len(sched_files)} 个文档")
    print()
    
    for file in sched_files:
        full_path = SCHED_DOCS / file
        lines = check_file_lines(full_path)
        status = "OK" if lines < 500 else "WARN"
        print(f"  [{status}] {file} ({lines} 行)")
    
    # 2. Central Server文档统计
    print()
    print("2. Central Server文档")
    print("-" * 60)
    cs_count = count_files(CS_DOCS)
    print(f"总数: {cs_count} 个文档")
    
    # 3. 验证核心文档存在
    print()
    print("3. 核心文档验证")
    print("-" * 60)
    
    core_docs = [
        "ARCHITECTURE.md",
        "POOL_ARCHITECTURE.md",
        "NODE_REGISTRATION.md",
        "MULTI_INSTANCE_DEPLOYMENT.md",
        "REDIS_DATA_MODEL.md",
        "README.md",
    ]
    
    for doc in core_docs:
        exists = (SCHED_DOCS / doc).exists()
        status = "EXISTS" if exists else "MISSING"
        print(f"  [{status}] {doc}")
    
    # 4. 检查是否还有临时文档
    print()
    print("4. 临时文档检查")
    print("-" * 60)
    
    temp_patterns = ["*测试*", "*诊断*", "*Bug*", "*失败*"]
    found_temp = []
    
    for pattern in temp_patterns:
        found = list(SCHED_DOCS.rglob(pattern))
        found_temp.extend(found)
    
    if found_temp:
        print(f"  [WARN] 发现 {len(found_temp)} 个可能的临时文档:")
        for f in found_temp:
            print(f"    - {f.relative_to(SCHED_DOCS)}")
    else:
        print("  [OK] 未发现临时文档")
    
    print()
    print("=" * 60)
    print("验证完成")
    print("=" * 60)

if __name__ == '__main__':
    main()
