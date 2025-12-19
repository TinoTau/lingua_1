#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 Piper 官方中文模型"""

from huggingface_hub import hf_hub_download
from pathlib import Path
import os

repo_id = "rhasspy/piper-voices"
subfolder = "zh/zh_CN/huayan/medium"
target_dir = Path("models/zh/zh_CN-huayan-medium")

# 创建目标目录
target_dir.mkdir(parents=True, exist_ok=True)

print(f"Downloading Piper Chinese model from {repo_id}/{subfolder}...")
print(f"Target directory: {target_dir}")

# 需要下载的文件
files = [
    "zh_CN-huayan-medium.onnx",
    "zh_CN-huayan-medium.onnx.json"
]

for file in files:
    print(f"\nDownloading {file}...")
    try:
        downloaded_path = hf_hub_download(
            repo_id=repo_id,
            filename=f"{subfolder}/{file}",
            local_dir=str(target_dir),
            local_dir_use_symlinks=False
        )
        print(f"  [OK] Downloaded to: {downloaded_path}")
    except Exception as e:
        print(f"  [ERROR] Failed to download {file}: {e}")

print(f"\n=== Download completed ===")
print(f"Model directory: {target_dir}")
if target_dir.exists():
    print(f"Files in directory:")
    for f in target_dir.glob("*"):
        if f.is_file():
            size_mb = f.stat().st_size / (1024 * 1024)
            print(f"  {f.name}: {size_mb:.2f} MB")

