#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
清理central_server文档 - 删除测试报告和临时诊断文档
"""

import os
import shutil
from pathlib import Path

ROOT_DIR = Path(__file__).parent.parent.parent
CS_DOCS = ROOT_DIR / "central_server" / "docs"
SCHED_DOCS = ROOT_DIR / "central_server" / "scheduler" / "docs"

# 要删除的文档模式
DELETE_PATTERNS = [
    # 测试报告
    "*测试报告*.md",
    "*TEST_*.md",
    "TEST_*.md",
    
    # 临时诊断文档（Pool生成问题）
    "Pool生成*.md",
    "Pool修复*.md",
    "Pool配置生成失败*.md",
    "*诊断*.md",
    "*Bug*.md",
    
    # 旧的阶段报告（已整理到docs/）
    "Redis直查架构_阶段*.md",
    "*完成报告*.md",
    "*进度报告*.md",
    "*清理记录*.md",
    
    # 审计和优化报告（已整理）
    "SCHEDULER_AUDIT*.md",
    "SCHEDULER_OPTIMIZATION*.md",
    "SCHEDULER_FLOW*.md",
    "*技术审议*.md",
    "*优化实施*.md",
    "*代码优化*.md",
    "*代码简洁化*.md",
    
    # Pool迁移报告（已完成）
    "POOL_MIGRATION*.md",
    "POOL_COMPILATION*.md",
    "POOL_REFACTOR_SUCCESS*.md",
    "POOL_OLD_SYSTEM*.md",
    "POOL_SYSTEM_COMPARISON*.md",
    "POOL_AUDIT*.md",
    
    # 其他临时文档
    "HEARTBEAT_TAG_ANALYSIS*.md",
    "FLOW_COMPARISON*.md",
    "*_2026_01_*.md",  # 所有带日期的临时文档
]

# 要删除的整个目录
DELETE_DIRS = [
    CS_DOCS / "scheduler" / "redis_architecture",
    CS_DOCS / "scheduler" / "pool_system",
    CS_DOCS / "scheduler" / "optimization",
    CS_DOCS / "testing",
    SCHED_DOCS / "pool_architecture",  # 将合并到新文档
]

def should_delete(file_path):
    """判断文件是否应该删除"""
    file_name = file_path.name
    for pattern in DELETE_PATTERNS:
        if file_path.match(pattern):
            return True
    return False

def delete_matching_files(directory):
    """删除匹配模式的文件"""
    deleted = []
    if not directory.exists():
        return deleted
    
    for file_path in directory.rglob("*.md"):
        if should_delete(file_path):
            try:
                file_path.unlink()
                deleted.append(file_path.relative_to(ROOT_DIR))
            except Exception as e:
                print(f"Error deleting {file_path}: {e}")
    
    return deleted

def delete_directories():
    """删除指定的目录"""
    deleted = []
    for dir_path in DELETE_DIRS:
        if dir_path.exists():
            try:
                shutil.rmtree(dir_path)
                deleted.append(dir_path.relative_to(ROOT_DIR))
            except Exception as e:
                print(f"Error deleting {dir_path}: {e}")
    return deleted

def main():
    print("=" * 60)
    print("清理 central_server 文档")
    print("=" * 60)
    print()
    
    # 删除匹配的文件
    print("删除测试报告和临时文档...")
    deleted_files = delete_matching_files(CS_DOCS) + delete_matching_files(SCHED_DOCS)
    
    for file in deleted_files:
        print(f"[DELETED FILE] {file}")
    
    # 删除整个目录
    print("\n删除过期目录...")
    deleted_dirs = delete_directories()
    
    for dir in deleted_dirs:
        print(f"[DELETED DIR] {dir}")
    
    print()
    print("=" * 60)
    print(f"删除文件: {len(deleted_files)} 个")
    print(f"删除目录: {len(deleted_dirs)} 个")
    print("=" * 60)

if __name__ == '__main__':
    main()
