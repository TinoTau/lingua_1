#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
语法检查脚本 - 验证所有 Python 文件语法正确性
"""

import py_compile
import os
import sys

def check_syntax(file_path):
    """检查单个文件的语法"""
    try:
        py_compile.compile(file_path, doraise=True)
        return True, None
    except py_compile.PyCompileError as e:
        return False, str(e)

def main():
    """主函数"""
    service_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("=" * 80)
    print("Checking Python syntax for Unified Semantic Repair Service")
    print("=" * 80)
    
    errors = []
    checked_files = []
    
    # 遍历所有 Python 文件
    for root, dirs, files in os.walk(service_dir):
        # 跳过测试目录（测试可能需要额外依赖）
        if 'tests' in root or '__pycache__' in root:
            continue
        
        for file in files:
            if file.endswith('.py'):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, service_dir)
                
                success, error = check_syntax(file_path)
                checked_files.append(rel_path)
                
                if success:
                    print(f"[OK] {rel_path}")
                else:
                    print(f"[ERROR] {rel_path}")
                    print(f"   Error: {error}")
                    errors.append((rel_path, error))
    
    print("=" * 80)
    print(f"Checked {len(checked_files)} files")
    
    if errors:
        print(f"[FAILED] Found {len(errors)} errors:")
        for path, error in errors:
            print(f"  - {path}: {error}")
        return 1
    else:
        print("[SUCCESS] All files passed syntax check!")
        return 0

if __name__ == "__main__":
    sys.exit(main())
