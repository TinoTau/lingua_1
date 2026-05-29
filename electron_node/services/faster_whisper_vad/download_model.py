"""
下载 Faster Whisper 模型到本地 models/ 目录（CTranslate2 格式）。

用法:
  .venv\\Scripts\\python.exe download_model.py
  .venv\\Scripts\\python.exe download_model.py --model medium
  .venv\\Scripts\\python.exe download_model.py --all
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

SERVICE_ROOT = Path(__file__).resolve().parent
MODELS_ROOT = SERVICE_ROOT / "models"

PRESETS: dict[str, dict[str, str]] = {
    "large-v3": {
        "repo": "Systran/faster-whisper-large-v3",
        "dir": "faster-whisper-large-v3",
    },
    "medium": {
        "repo": "Systran/faster-whisper-medium",
        "dir": "faster-whisper-medium",
    },
}


def download_one(repo_id: str, local_dir: Path, device: str = "cpu", compute_type: str = "int8") -> Path:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        logger.error("请先安装依赖: pip install -r requirements.txt")
        raise SystemExit(1) from exc

    local_dir.mkdir(parents=True, exist_ok=True)
    logger.info("下载 %s -> %s", repo_id, local_dir)

    # 触发 HuggingFace 拉取并写入 local_dir（faster-whisper 使用 hub 缓存后复制到目标目录）
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=repo_id,
            local_dir=str(local_dir),
            local_dir_use_symlinks=False,
        )
        logger.info("snapshot_download 完成: %s", local_dir)
    except ImportError:
        logger.warning("未安装 huggingface_hub，改用 WhisperModel 预加载")
        WhisperModel(
            repo_id,
            device=device,
            compute_type=compute_type,
            download_root=str(MODELS_ROOT),
        )
        # WhisperModel 默认缓存到 models/models--Org--name；若需扁平目录可再整理
        logger.info("已通过 WhisperModel 触发下载，请检查 %s", MODELS_ROOT)

    # 校验 CT2 模型文件
    has_bin = (local_dir / "model.bin").is_file() or any(local_dir.rglob("model.bin"))
    if not has_bin:
        logger.warning("目录中未找到 model.bin，可能仍在 HF 缓存结构中: %s", local_dir)
    else:
        logger.info("校验通过: 发现 model.bin")

    return local_dir.resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description="下载 Faster Whisper 模型")
    parser.add_argument(
        "--model",
        choices=list(PRESETS.keys()),
        help="预设: large-v3 | medium",
    )
    parser.add_argument("--all", action="store_true", help="下载全部预设模型")
    parser.add_argument("--repo", help="自定义 HuggingFace repo，如 Systran/faster-whisper-large-v3")
    parser.add_argument("--output", help="输出目录名（位于 models/ 下）或绝对路径")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    parser.add_argument("--compute-type", default="int8", dest="compute_type")
    args = parser.parse_args()

    if args.all:
        targets = list(PRESETS.values())
    elif args.model:
        targets = [PRESETS[args.model]]
    elif args.repo:
        out_name = args.output or args.repo.split("/")[-1]
        targets = [{"repo": args.repo, "dir": out_name}]
    else:
        targets = list(PRESETS.values())

    for spec in targets:
        out = Path(args.output) if args.output and Path(args.output).is_absolute() else MODELS_ROOT / spec["dir"]
        download_one(spec["repo"], out, device=args.device, compute_type=args.compute_type)

    logger.info("全部下载任务结束。使用示例:")
    logger.info('  set ASR_MODEL_PATH=Systran/faster-whisper-large-v3')
    logger.info('  set WHISPER_CACHE_DIR=%s', MODELS_ROOT)
    logger.info("  或直接: ASR_MODEL_PATH=%s", MODELS_ROOT / "faster-whisper-large-v3")


if __name__ == "__main__":
    main()
