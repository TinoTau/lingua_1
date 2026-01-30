#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量移除Phase3相关引用
"""

import re
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SCHEDULER_SRC = ROOT / "central_server" / "scheduler" / "src"

# 需要检查的文件模式
RUST_FILES = list(SCHEDULER_SRC.rglob("*.rs"))

print(f"Found {len(RUST_FILES)} Rust files")

# 查找所有包含phase3的文件
phase3_files = []
for file in RUST_FILES:
    try:
        content = file.read_text(encoding='utf-8')
        if re.search(r'\.phase3\.|phase3:|Phase3Config|phase3_config', content, re.IGNORECASE):
            phase3_files.append(file)
            print(f"[FOUND] {file.relative_to(ROOT)}")
    except:
        pass

print(f"\nTotal files with phase3 references: {len(phase3_files)}")

for f in phase3_files:
    print(f"  - {f.relative_to(SCHEDULER_SRC)}")
