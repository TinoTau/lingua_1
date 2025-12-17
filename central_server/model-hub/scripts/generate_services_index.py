#!/usr/bin/env python3
"""
生成服务包索引文件
扫描 models/services/ 目录，生成 services_index.json
"""

import json
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

# 配置
MODELS_DIR = Path(__file__).parent.parent / "models"
SERVICES_STORAGE_DIR = MODELS_DIR / "services"
SERVICES_INDEX_FILE = SERVICES_STORAGE_DIR / "services_index.json"


def calculate_sha256(file_path: Path) -> str:
    """计算文件的 SHA256 哈希值"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def scan_service_packages() -> Dict:
    """扫描服务包目录，生成索引数据"""
    index_data = {}
    
    if not SERVICES_STORAGE_DIR.exists():
        print(f"⚠️  服务包目录不存在: {SERVICES_STORAGE_DIR}")
        return index_data
    
    print(f"📦 扫描服务包目录: {SERVICES_STORAGE_DIR}")
    
    # 扫描 services/{service_id}/{version}/{platform}/service.zip
    for service_dir in SERVICES_STORAGE_DIR.iterdir():
        if not service_dir.is_dir():
            continue
        
        service_id = service_dir.name
        print(f"\n  服务: {service_id}")
        
        variants = []
        versions = []
        
        # 扫描版本目录
        for version_dir in service_dir.iterdir():
            if not version_dir.is_dir():
                continue
            
            version = version_dir.name
            versions.append(version)
            
            # 扫描平台目录
            for platform_dir in version_dir.iterdir():
                if not platform_dir.is_dir():
                    continue
                
                platform = platform_dir.name
                
                # 查找 service.zip
                zip_file = platform_dir / "service.zip"
                if not zip_file.exists() or not zip_file.is_file():
                    continue
                
                print(f"    - {version}/{platform}: ", end="", flush=True)
                
                # 获取文件大小
                file_size = zip_file.stat().st_size
                
                # 计算 SHA256
                print("计算 SHA256...", end="", flush=True)
                file_hash = calculate_sha256(zip_file)
                print(f" 完成 ({file_size / 1024 / 1024:.2f} MB)")
                
                # 构建 artifact URL（相对路径）
                artifact_url = f"/storage/services/{service_id}/{version}/{platform}/service.zip"
                
                variants.append({
                    "version": version,
                    "platform": platform,
                    "artifact": {
                        "type": "zip",
                        "url": artifact_url,
                        "sha256": file_hash,
                        "size_bytes": file_size,
                        "etag": file_hash[:16]  # 使用前16位作为简单 ETag
                    }
                })
        
        if variants:
            # 确定最新版本
            latest_version = max(versions, key=lambda v: v) if versions else ""
            
            index_data[service_id] = {
                "service_id": service_id,
                "name": service_id.replace('-', ' ').replace('_', ' ').title(),
                "latest_version": latest_version,
                "variants": variants,
                "updated_at": datetime.now().isoformat()
            }
    
    return index_data


def save_index_file(index_data: Dict):
    """保存索引文件"""
    try:
        SERVICES_INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SERVICES_INDEX_FILE, 'w', encoding='utf-8') as f:
            json.dump(index_data, f, indent=2, ensure_ascii=False)
        print(f"\n✅ 索引文件已保存: {SERVICES_INDEX_FILE}")
        print(f"   包含 {len(index_data)} 个服务包")
    except Exception as e:
        print(f"\n❌ 保存索引文件失败: {e}")
        raise


def main():
    """主函数"""
    print("=" * 60)
    print("服务包索引生成工具")
    print("=" * 60)
    
    index_data = scan_service_packages()
    
    if not index_data:
        print("\n⚠️  未找到任何服务包")
        return
    
    save_index_file(index_data)
    
    print("\n" + "=" * 60)
    print("完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()

