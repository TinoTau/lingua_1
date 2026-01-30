#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量替换 phase2 和 phase3 模块引用为新名称
"""

import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent
SCHEDULER_SRC = ROOT_DIR / "central_server" / "scheduler" / "src"

def replace_in_file(file_path, replacements):
    """在文件中执行替换"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        for old, new in replacements:
            content = content.replace(old, new)
        
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False

def find_rust_files(directory):
    """递归查找所有 .rs 文件"""
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.rs'):
                yield Path(root) / file

def main():
    # 定义替换规则
    replacements = [
        # 模块路径替换
        ('use crate::phase2::', 'use crate::redis_runtime::'),
        ('use crate::phase3::', 'use crate::pool_hashing::'),
        ('crate::phase2::', 'crate::redis_runtime::'),
        ('crate::phase3::', 'crate::pool_hashing::'),
        
        # 文档注释中的替换
        ('phase2/', 'redis_runtime/'),
        ('phase3/', 'pool_hashing/'),
    ]
    
    print("=" * 60)
    print("批量替换模块引用")
    print("=" * 60)
    print()
    
    updated_count = 0
    skipped_count = 0
    
    for file_path in find_rust_files(SCHEDULER_SRC):
        if replace_in_file(file_path, replacements):
            rel_path = file_path.relative_to(ROOT_DIR)
            print(f"[UPDATED] {rel_path}")
            updated_count += 1
        else:
            skipped_count += 1
    
    print()
    print("=" * 60)
    print(f"Updated: {updated_count} files")
    print(f"Skipped: {skipped_count} files")
    print("=" * 60)

if __name__ == '__main__':
    main()
