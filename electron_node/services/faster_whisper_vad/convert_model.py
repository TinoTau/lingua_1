#!/usr/bin/env python3
"""
将 Whisper 模型转换为 CTranslate2 格式
支持从 HuggingFace 下载并转换，或转换本地模型
"""

import os
import sys
import argparse
import shutil
from pathlib import Path
from faster_whisper import WhisperModel

def convert_from_huggingface(model_name: str, output_dir: str, device: str = "cpu", compute_type: str = "int8"):
    """
    从 HuggingFace 下载模型并转换为 CTranslate2 格式
    
    Args:
        model_name: HuggingFace 模型名称，如 "base", "small", "medium", "large-v3"
        output_dir: 输出目录
        device: 设备类型 ("cpu" 或 "cuda")
        compute_type: 计算类型 ("int8", "float16", "float32")
    """
    print(f"正在从 HuggingFace 下载模型: {model_name}")
    print(f"设备: {device}, 计算类型: {compute_type}")
    print(f"输出目录: {output_dir}")
    
    # 确保输出目录存在
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    try:
        # 设置缓存目录到输出目录
        # Faster Whisper 会将转换后的模型保存到缓存目录
        cache_dir = str(output_path)
        os.environ["WHISPER_CACHE_DIR"] = cache_dir
        
        # 使用 Faster Whisper 加载模型（会自动下载并转换）
        # 第一次加载时会自动下载并转换为 CTranslate2 格式
        print("\n开始下载和转换模型（这可能需要几分钟）...")
        print("提示: 首次下载可能需要较长时间，请耐心等待...")
        
        model = WhisperModel(model_name, device=device, compute_type=compute_type, download_root=cache_dir)
        
        print(f"\n✅ 模型已下载并转换完成！")
        print(f"模型位置: {output_dir}")
        
        # 验证模型文件是否存在
        model_files = list(output_path.rglob("*"))
        if model_files:
            print(f"\n找到 {len(model_files)} 个模型文件")
            print("主要文件:")
            for f in sorted(model_files)[:10]:  # 只显示前10个
                if f.is_file():
                    size_mb = f.stat().st_size / (1024 * 1024)
                    print(f"  - {f.name} ({size_mb:.2f} MB)")
            if len(model_files) > 10:
                print(f"  ... 还有 {len(model_files) - 10} 个文件")
        
        return True
        
    except Exception as e:
        print(f"\n❌ 转换失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def convert_local_model(input_dir: str, output_dir: str, device: str = "cpu", compute_type: str = "int8"):
    """
    转换本地模型（如果可能）
    
    注意: Faster Whisper 主要支持从 HuggingFace 模型转换
    如果本地模型不是 HuggingFace 格式，可能需要先转换为 HuggingFace 格式
    """
    print(f"尝试转换本地模型: {input_dir}")
    print(f"输出目录: {output_dir}")
    
    input_path = Path(input_dir)
    if not input_path.exists():
        print(f"❌ 输入目录不存在: {input_dir}")
        return False
    
    # 检查是否是 HuggingFace 格式的模型
    config_file = input_path / "config.json"
    if not config_file.exists():
        print(f"❌ 未找到 config.json，可能不是 HuggingFace 格式的模型")
        print("建议: 使用 convert_from_huggingface 从 HuggingFace 下载模型")
        return False
    
    # 尝试使用本地路径加载
    try:
        print("\n尝试加载本地模型...")
        model = WhisperModel(str(input_path), device=device, compute_type=compute_type)
        print("✅ 模型加载成功！")
        print("注意: Faster Whisper 会自动管理模型，无需手动复制")
        return True
    except Exception as e:
        print(f"❌ 加载失败: {e}")
        print("可能原因: 模型格式不兼容（需要 CTranslate2 格式）")
        return False

def main():
    parser = argparse.ArgumentParser(description="转换 Whisper 模型为 CTranslate2 格式")
    parser.add_argument(
        "--model",
        type=str,
        default="base",
        help="模型名称 (tiny, tiny.en, base, base.en, small, small.en, medium, medium.en, large-v1, large-v2, large-v3, large) 或本地路径"
    )
    parser.add_argument(
        "--output",
        type=str,
        required=True,
        help="输出目录"
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        choices=["cpu", "cuda"],
        help="设备类型"
    )
    parser.add_argument(
        "--compute-type",
        type=str,
        default="int8",
        choices=["int8", "float16", "float32"],
        help="计算类型"
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help="转换本地模型（而不是从 HuggingFace 下载）"
    )
    
    args = parser.parse_args()
    
    # 检查是否是本地路径
    if args.local or os.path.exists(args.model):
        success = convert_local_model(args.model, args.output, args.device, args.compute_type)
    else:
        success = convert_from_huggingface(args.model, args.output, args.device, args.compute_type)
    
    if success:
        print("\n✅ 转换完成！")
        print(f"\n使用方法:")
        print(f"  设置环境变量 ASR_MODEL_PATH={args.output}")
        print(f"  或修改配置指向: {args.output}")
        sys.exit(0)
    else:
        print("\n❌ 转换失败")
        sys.exit(1)

if __name__ == "__main__":
    main()

