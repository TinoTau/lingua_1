"""
下载 Faster Whisper 模型到本地
使用 HuggingFace token 下载模型并转换为 CTranslate2 格式
"""
import os
import sys
import logging
from pathlib import Path

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def download_model(
    model_name: str = "Systran/faster-whisper-large-v3",
    output_dir: str = "models/asr/faster-whisper-large-v3",
    device: str = "cpu",
    compute_type: str = "float32",
    hf_token: str = None
):
    """
    下载 Faster Whisper 模型到本地
    
    Args:
        model_name: HuggingFace 模型名称，如 "Systran/faster-whisper-large-v3"
        output_dir: 本地输出目录
        device: 设备类型 ("cpu" 或 "cuda")
        compute_type: 计算类型 ("float32", "float16", "int8")
        hf_token: HuggingFace token（如果模型需要认证）
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        logger.error("❌ faster-whisper 未安装，请先安装: pip install faster-whisper")
        sys.exit(1)
    
    # 设置 HuggingFace token（如果提供）
    if hf_token:
        os.environ["HF_TOKEN"] = hf_token
        logger.info("✅ HuggingFace token 已设置")
    
    # 创建输出目录
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    logger.info(f"📁 输出目录: {output_path.absolute()}")
    
    logger.info("=" * 80)
    logger.info(f"🚀 开始下载模型: {model_name}")
    logger.info(f"   设备: {device}")
    logger.info(f"   计算类型: {compute_type}")
    logger.info(f"   输出目录: {output_path.absolute()}")
    logger.info("=" * 80)
    
    try:
        # 使用 faster-whisper 下载模型
        # faster-whisper 会自动从 HuggingFace 下载并转换为 CTranslate2 格式
        logger.info("📥 正在从 HuggingFace 下载模型（这可能需要一些时间）...")
        
        model = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            download_root=str(output_path.parent),  # 设置下载根目录
        )
        
        logger.info("✅ 模型下载并转换成功！")
        logger.info(f"📁 模型位置: {output_path.absolute()}")
        
        # 验证模型文件
        model_files = list(output_path.glob("*"))
        if model_files:
            logger.info(f"📦 模型文件:")
            for f in model_files:
                size_mb = f.stat().st_size / (1024 * 1024)
                logger.info(f"   - {f.name} ({size_mb:.2f} MB)")
        else:
            # 检查父目录（faster-whisper 可能将模型放在不同的位置）
            parent_files = list(output_path.parent.glob("*"))
            logger.info(f"📦 在父目录找到模型文件:")
            for f in parent_files:
                if f.is_dir():
                    size_mb = sum(p.stat().st_size for p in f.rglob("*") if p.is_file()) / (1024 * 1024)
                    logger.info(f"   - {f.name}/ ({size_mb:.2f} MB)")
        
        logger.info("=" * 80)
        logger.info("✅ 模型下载完成！")
        logger.info(f"   现在可以在配置中使用本地路径: {output_path.absolute()}")
        logger.info("=" * 80)
        
        return str(output_path.absolute())
        
    except Exception as e:
        logger.error(f"❌ 下载模型失败: {e}", exc_info=True)
        sys.exit(1)


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description="下载 Faster Whisper 模型到本地")
    parser.add_argument(
        "--model",
        type=str,
        default="Systran/faster-whisper-large-v3",
        help="HuggingFace 模型名称（默认: Systran/faster-whisper-large-v3）"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="models/asr/faster-whisper-large-v3",
        help="本地输出目录（默认: models/asr/faster-whisper-large-v3）"
    )
    parser.add_argument(
        "--device",
        type=str,
        choices=["cpu", "cuda"],
        default="cpu",
        help="设备类型（默认: cpu）"
    )
    parser.add_argument(
        "--compute-type",
        type=str,
        choices=["float32", "float16", "int8"],
        default="float32",
        help="计算类型（默认: float32）"
    )
    parser.add_argument(
        "--token",
        type=str,
        default=None,
        help="HuggingFace token（如果模型需要认证）"
    )
    
    args = parser.parse_args()
    
    # 如果没有提供 token，尝试从环境变量或配置文件读取
    if not args.token:
        # 尝试从环境变量读取
        args.token = os.getenv("HF_TOKEN")
        # 如果环境变量也没有，尝试从配置文件读取
        if not args.token:
            try:
                from config import HF_TOKEN
                args.token = HF_TOKEN
            except:
                pass
    
    download_model(
        model_name=args.model,
        output_dir=args.output,
        device=args.device,
        compute_type=args.compute_type,
        hf_token=args.token
    )


if __name__ == "__main__":
    main()

