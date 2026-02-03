#!/usr/bin/env bash
# 在 addons/char-lm 下克隆并编译 KenLM（在 WSL/Linux/macOS 下执行）
# 用法: 在 addons/char-lm 目录下执行: bash scripts/clone_build_kenlm.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
KENLM_SRC="$BASE_DIR/kenlm"
BUILD_DIR="$KENLM_SRC/build"

cd "$BASE_DIR"
if [ ! -d "kenlm" ]; then
  git clone https://github.com/kpu/kenlm.git
fi
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
cmake ..
cmake --build . -j

echo ""
echo "KenLM 已编译完成。后续训练请设置："
echo "  export KENLM_BIN=\"$BUILD_DIR/bin\""
echo "  bash scripts/train_and_build.sh"
echo ""
