# -*- coding: utf-8 -*-
"""
下载 M2M100 PyTorch 模型到本地 models 目录
"""

import os
import sys
import traceback
from pathlib import Path

from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer

def download_model(model_name, target_dir):
    """下载模型到指定目录"""
    target_path = Path(target_dir)
    target_path.mkdir(parents=True, exist_ok=True)
    
    print(f"[下载] 开始下载模型: {model_name}")
    print(f"[下载] 目标目录: {target_path}")
    
    # 设置环境变量，允许从 HuggingFace 下载
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    
    try:
        # 下载 tokenizer
        print(f"[下载] 下载 tokenizer...")
        tokenizer = M2M100Tokenizer.from_pretrained(
            model_name,
            local_files_only=False,
            cache_dir=None
        )
        tokenizer.save_pretrained(str(target_path))
        print(f"[下载] Tokenizer 已保存到: {target_path}")
        
        # 下载模型
        print(f"[下载] 下载模型...")
        model = M2M100ForConditionalGeneration.from_pretrained(
            model_name,
            local_files_only=False,
            cache_dir=None
        )
        model.save_pretrained(str(target_path))
        print(f"[下载] 模型已保存到: {target_path}")
        
        # 列出下载的文件
        print(f"\n[完成] 模型文件列表:")
        for file in sorted(target_path.glob("*")):
            if file.is_file():
                size_mb = file.stat().st_size / (1024 * 1024)
                print(f"  - {file.name} ({size_mb:.2f} MB)")
        
        return True
    except Exception as e:
        print(f"[错误] 下载失败: {e}")
        traceback.print_exc()
        return False

if __name__ == "__main__":
    script_dir = Path(__file__).parent
    
    # 下载 m2m100-en-zh 模型
    en_zh_dir = script_dir / "models" / "m2m100-en-zh"
    print(f"\n{'='*60}")
    print(f"下载模型 1/2: m2m100-en-zh")
    print(f"{'='*60}")
    if not download_model("facebook/m2m100_418M", en_zh_dir):
        print("[错误] 下载 m2m100-en-zh 失败")
        sys.exit(1)
    
    # 下载 m2m100-zh-en 模型
    zh_en_dir = script_dir / "models" / "m2m100-zh-en"
    print(f"\n{'='*60}")
    print(f"下载模型 2/2: m2m100-zh-en")
    print(f"{'='*60}")
    if not download_model("facebook/m2m100_418M", zh_en_dir):
        print("[错误] 下载 m2m100-zh-en 失败")
        sys.exit(1)
    
    print(f"\n{'='*60}")
    print(f"[完成] 所有模型下载完成！")
    print(f"{'='*60}")

