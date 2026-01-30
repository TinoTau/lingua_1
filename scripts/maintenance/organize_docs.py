#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
文档整理脚本 - 将根目录的文档移动到对应的模块docs目录
"""

import os
import shutil
from pathlib import Path

# 根目录
ROOT_DIR = Path(__file__).parent.parent.parent

# 文档分类规则
DOC_RULES = {
    # 调度服务器优化文档
    'central_server/docs/scheduler/optimization/': [
        '代码优化完成报告_第一批_2026_01_22.md',
        '代码简洁化完成_2026_01_22.md',
        '调度服务器优化实施方案_2026_01_22.md',
        '调度服务器技术审议_执行摘要_2026_01_22.md',
        '调度服务器技术审议_执行摘要_修正版_2026_01_22.md',
        '调度服务器技术审议文档_完整版_2026_01_22.md',
        '调度服务器核心流程技术审议文档_2026_01_22.md',
    ],
    
    # 调度服务器测试报告  
    'central_server/docs/scheduler/': [
        '调度服务器测试报告_2026_01_22.md',
        '单实例模式说明_2026_01_22.md',
        '多实例模式恢复完成_2026_01_22.md',
    ],
    
    # 调度服务器架构文档
    'central_server/docs/scheduler/architecture/': [
        '最终完成报告_SSOT架构_2026_01_22.md',
        '阶段2完成_SSOT架构实现.md',
        '节点管理架构统一规则.md',
    ],
    
    # 决策文档
    'docs/decision/': [
        '决策部门文档索引.md',
        '决策部门最终审议文档_新架构V2.md',
        '决策部门审议文档_新架构.md',
    ],
    
    # 项目管理文档
    'docs/project_management/': [
        '优化清理总结_最终版_2026_01_22.md',
        '剩余优化任务_实际可行.md',
        '备份代码启动脚本已创建_简化版.md',
        '硬编码清除_最终完成报告_2026_01_22.md',
        '硬编码清除_完成报告_2026_01_22.md',
        '硬编码清除_进度报告_2026_01_22.md',
        '硬编码清除_快速指南.md',
        '硬编码清除_部署指南.md',
        '硬编码清除计划_2026_01_22.md',
        '文档修正说明_2026_01_22.md',
        '文档统一修正完成_2026_01_22.md',
        '文档更新说明_V2.md',
    ],
    
    # 项目总结报告
    'docs/project_summaries/': [
        '优化完成_2026_01_22.md',
        '优化完成_请审阅.md',
        '最终清理完成报告_2026_01_22.md',
        '代码清理完成_2026_01_22.md',
        '警告清理完成_最终报告_2026_01_22.md',
    ],
    
    # 测试报告
    'docs/testing/': [
        '测试总结_完整报告_2026_01_22.md',
    ],
    
    # WebApp测试报告
    'webapp/docs/': [
        'WebSocket测试报告_2026_01_22.md',
    ],
    
    # 问题排查
    'docs/troubleshooting/': [
        '问题修复总结_2026_01_22.md',
        '快速修复_Redis版本问题.md',
    ],
    
    # 架构设计
    'docs/architecture/': [
        '设计修正说明_AudioBuffer_2026_01_22.md',
    ],
    
    # 根目录docs
    'docs/': [
        '请从这里开始.md',
    ],
}

def move_doc(doc_name, dest_dir):
    """移动文档到目标目录"""
    src = ROOT_DIR / doc_name
    dest = ROOT_DIR / dest_dir / doc_name
    
    if not src.exists():
        print(f"[SKIP] {doc_name}")
        return False
    
    # 创建目标目录
    dest.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        shutil.move(str(src), str(dest))
        print(f"[MOVED] {doc_name} -> {dest_dir}")
        return True
    except Exception as e:
        print(f"[ERROR] {doc_name} - {e}")
        return False

def main():
    """主函数"""
    print("=" * 60)
    print("Document Organization Tool")
    print("=" * 60)
    print()
    
    moved_count = 0
    skipped_count = 0
    
    for dest_dir, doc_list in DOC_RULES.items():
        print(f"\nTarget Directory: {dest_dir}")
        print("-" * 50)
        
        for doc_name in doc_list:
            if move_doc(doc_name, dest_dir):
                moved_count += 1
            else:
                skipped_count += 1
    
    print()
    print("=" * 60)
    print(f"Moved: {moved_count} documents")
    print(f"Skipped: {skipped_count} documents")
    print("=" * 60)

if __name__ == '__main__':
    main()
