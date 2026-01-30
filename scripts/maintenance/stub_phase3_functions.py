#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将Phase3相关函数替换为空实现
"""

from pathlib import Path
import re

ROOT = Path(__file__).parent.parent.parent
TARGET_FILE = ROOT / "central_server" / "scheduler" / "src" / "redis_runtime" / "runtime_routing_pool_members.rs"

content = TARGET_FILE.read_text(encoding='utf-8')

# 替换 sync_all_pool_members_to_redis 函数体
content = re.sub(
    r'(pub async fn sync_all_pool_members_to_redis\([^)]+\) \{)[^}]+(\})',
    r'\1\n        // Phase3 已删除，此函数已废弃\n        debug!("sync_all_pool_members_to_redis 已废弃");\n    \2',
    content,
    flags=re.DOTALL
)

# 替换 get_all_pool_members_from_redis 函数体
content = re.sub(
    r'(pub async fn get_all_pool_members_from_redis\([^)]+\) -> HashMap<u16, HashSet<String>> \{)[^}]+(\})',
    r'\1\n        // Phase3 已删除，此函数已废弃\n        debug!("get_all_pool_members_from_redis 已废弃");\n        HashMap::new()\n    \2',
    content,
    flags=re.DOTALL
)

# 替换 get_pool_sizes_from_redis 函数体  
content = re.sub(
    r'(pub async fn get_pool_sizes_from_redis\([^)]+\) -> HashMap<u16, usize> \{)[^}]+(\})',
    r'\1\n        // Phase3 已删除，此函数已废弃\n        debug!("get_pool_sizes_from_redis 已废弃");\n        HashMap::new()\n    \2',
    content,
    flags=re.DOTALL
)

TARGET_FILE.write_text(content, encoding='utf-8')
print(f"[UPDATED] {TARGET_FILE.relative_to(ROOT)}")
