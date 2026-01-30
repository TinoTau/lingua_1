#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
清理Phase3相关代码引用
"""

import re
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SCHEDULER_SRC = ROOT / "central_server" / "scheduler" / "src"

def comment_phase3_references(file_path):
    """注释掉Phase3相关的字段引用"""
    try:
        content = file_path.read_text(encoding='utf-8')
        original = content
        
        # 注释掉 .phase3 字段访问
        content = re.sub(
            r'(\s+)state\.cfg\.phase3\.',
            r'\1// state.cfg.phase3.',  # 已删除
            content
        )
        
        content = re.sub(
            r'(\s+)cfg\.phase3\.',
            r'\1// cfg.phase3.',  # 已删除
            content
        )
        
        # 注释掉 phase3_config 相关行
        content = re.sub(
            r'(\s+)(let .* = .*phase3_config.*)',
            r'\1// \2  // Phase3Config 已删除',
            content
        )
        
        # 注释掉 if phase3.*enabled 相关行
        content = re.sub(
            r'(\s+)(if .*phase3.*\.enabled)',
            r'\1// \2  // Phase3 已删除',
            content
        )
        
        if content != original:
            file_path.write_text(content, encoding='utf-8')
            return True
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
    return False

# 需要处理的文件
FILES_TO_CLEAN = [
    "node_registry/lockless/cache.rs",
    "node_registry/selection/node_selection.rs",
    "redis_runtime/runtime_init.rs",
    "redis_runtime/tests/ws_helpers.rs",
]

print("=" * 60)
print("清理Phase3代码引用")
print("=" * 60)

for rel_path in FILES_TO_CLEAN:
    file_path = SCHEDULER_SRC / rel_path
    if file_path.exists():
        if comment_phase3_references(file_path):
            print(f"[CLEANED] {rel_path}")
        else:
            print(f"[SKIPPED] {rel_path}")
    else:
        print(f"[NOT_FOUND] {rel_path}")

print("\nDone!")
