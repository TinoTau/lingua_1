# -*- coding: utf-8 -*-
"""
下载 Qwen2.5-3B-Instruct-EN GPTQ 模型到本地
"""

import os
import sys
from pathlib import Path
from huggingface_hub import snapshot_download

def download_model(
    repo_id: str = "Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4",
    target_dir: str = "models/qwen2.5-3b-instruct-en",
    revision: str = "main"
):
    """
    下载英文模型到本地
    
    Args:
        repo_id: HuggingFace 仓库ID
        target_dir: 本地目标目录
        revision: 模型版本（默认: main）
    """
    target_path = Path(target_dir)
    target_path.mkdir(parents=True, exist_ok=True)
    
    print("=" * 80)
    print(f"🚀 开始下载英文语义修复模型")
    print(f"   仓库: {repo_id}")
    print(f"   目标目录: {target_path.absolute()}")
    print(f"   版本: {revision}")
    print("=" * 80)
    
    try:
        # 设置环境变量，允许从 HuggingFace 下载
        os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
        
        print("\n📥 正在从 HuggingFace 下载模型（这可能需要一些时间，约 2GB）...")
        print("   如果下载中断，可以重新运行此脚本继续下载。\n")
        
        # 下载模型
        downloaded_path = snapshot_download(
            repo_id=repo_id,
            revision=revision,
            local_dir=str(target_path),
            local_dir_use_symlinks=False,
            resume_download=True,  # 支持断点续传
        )
        
        print("\n✅ 模型下载成功！")
        print(f"📁 模型位置: {target_path.absolute()}")
        
        # 验证模型文件
        print("\n📦 验证模型文件...")
        required_files = [
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.json",
            "merges.txt",
            "model.safetensors",
        ]
        
        missing_files = []
        for file_name in required_files:
            file_path = target_path / file_name
            if file_path.exists():
                size_mb = file_path.stat().st_size / (1024 * 1024)
                print(f"   ✅ {file_name} ({size_mb:.2f} MB)")
            else:
                missing_files.append(file_name)
                print(f"   ❌ {file_name} (缺失)")
        
        if missing_files:
            print(f"\n⚠️  警告: 以下文件缺失: {', '.join(missing_files)}")
            print("   模型可能不完整，请重新下载。")
            return False
        
        print("\n" + "=" * 80)
        print("✅ 模型下载完成！")
        print(f"   现在可以在服务中使用本地模型: {target_path.absolute()}")
        print("=" * 80)
        
        return True
        
    except Exception as e:
        print(f"\n❌ 下载模型失败: {e}")
        import traceback
        traceback.print_exc()
        print("\n💡 提示:")
        print("   1. 检查网络连接")
        print("   2. 如果模型需要认证，请设置 HF_TOKEN 环境变量")
        print("   3. 可以尝试使用镜像站点")
        return False


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="下载 Qwen2.5-3B-Instruct-EN GPTQ 模型")
    parser.add_argument(
        "--repo-id",
        type=str,
        default="Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4",
        help="HuggingFace 仓库ID（默认: Qwen/Qwen2.5-3B-Instruct-GPTQ-Int4）"
    )
    parser.add_argument(
        "--target-dir",
        type=str,
        default="models/qwen2.5-3b-instruct-en",
        help="本地目标目录（默认: models/qwen2.5-3b-instruct-en）"
    )
    parser.add_argument(
        "--revision",
        type=str,
        default="main",
        help="模型版本（默认: main）"
    )
    
    args = parser.parse_args()
    
    success = download_model(
        repo_id=args.repo_id,
        target_dir=args.target_dir,
        revision=args.revision
    )
    
    sys.exit(0 if success else 1)
