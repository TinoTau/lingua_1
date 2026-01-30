#!/usr/bin/env python3
"""清理Phase3相关的dead_code"""

import re
from pathlib import Path

# 定义要清理的文件和内容
cleanups = [
    {
        "file": "src/node_registry/lockless/cache.rs",
        "patterns": [
            # 删除CachedPhase3Config结构体
            (r'/// 缓存的 Phase3 配置\n#\[derive\(Debug, Clone\)\]\n#\[allow\(dead_code\)\].*?\nstruct CachedPhase3Config \{[^}]+\}', ''),
            # 删除phase3_config字段
            (r'    /// 配置缓存.*?\n    phase3_config: Arc<RwLock<Option<CachedPhase3Config>>>,', ''),
            # 删除初始化
            (r'            phase3_config: Arc::new\(RwLock::new\(None\)\),', ''),
            # 删除get_phase3_config方法
            (r'    /// 获取 Phase3 配置.*?\n    #\[allow\(dead_code\)\].*?\n    pub async fn get_phase3_config\(&self\).*?\n    \}', ''),
            # 删除refresh_phase3_config_from_redis方法
            (r'    /// 从 Redis 刷新 Phase3 配置.*?\n    #\[allow\(dead_code\)\].*?\n    async fn refresh_phase3_config_from_redis\(&self\).*?\n    \}', ''),
        ]
    },
    {
        "file": "src/node_registry/lockless/serialization.rs",
        "patterns": [
            # 删除RedisPhase3Config结构体
            (r'/// Redis 中存储的 Phase3 配置格式\n#\[derive\(Debug, Clone, Serialize, Deserialize\)\]\n#\[allow\(dead_code\)\].*?\npub struct RedisPhase3Config \{[^}]+\}\n\nimpl RedisPhase3Config \{[^}]+\}', ''),
        ]
    },
    {
        "file": "src/node_registry/lockless/redis_client.rs",
        "patterns": [
            # 删除get_phase3_config方法
            (r'    /// 获取 Phase3 配置.*?\n    ///.*?\n    /// Key:.*?\n    #\[allow\(dead_code\)\].*?\n    pub async fn get_phase3_config\(&self\).*?\n    \}', ''),
        ]
    },
]

def clean_file(base_path: Path, file_rel: str, patterns: list):
    """清理单个文件"""
    file_path = base_path / file_rel
    
    if not file_path.exists():
        print(f"[WARN] File not found: {file_path}")
        return False
    
    print(f"[INFO] Cleaning: {file_rel}")
    
    content = file_path.read_text(encoding='utf-8')
    original_size = len(content)
    
    for pattern, replacement in patterns:
        content = re.sub(pattern, replacement, content, flags=re.MULTILINE | re.DOTALL)
    
    new_size = len(content)
    if new_size < original_size:
        file_path.write_text(content, encoding='utf-8')
        print(f"  [OK] Removed {original_size - new_size} characters")
        return True
    else:
        print(f"  [SKIP] No changes needed")
        return False

def main():
    """主函数"""
    script_path = Path(__file__).resolve()
    project_root = script_path.parent.parent.parent
    scheduler_root = project_root / "central_server" / "scheduler"
    
    print(f"Working directory: {scheduler_root}")
    print()
    
    modified_count = 0
    for cleanup in cleanups:
        if clean_file(scheduler_root, cleanup["file"], cleanup["patterns"]):
            modified_count += 1
    
    print()
    print(f"Done! Modified {modified_count} files")

if __name__ == "__main__":
    main()
