#!/bin/bash
# 复制原项目的模型到新项目
# 用法: ./scripts/copy_models.sh

set -e

echo "开始复制模型文件..."

# 原项目路径（请根据实际情况修改）
SOURCE_PATH="../lingua/core/engine/models"
# 新项目路径
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 检查源路径是否存在
if [ ! -d "$SOURCE_PATH" ]; then
    echo "错误: 源路径不存在: $SOURCE_PATH"
    echo "请修改脚本中的源路径"
    exit 1
fi

# 1. 复制到 model-hub/models (公司模型库)
echo ""
echo "[1/2] 复制到 model-hub/models (公司模型库)..."
MODEL_HUB_PATH="$PROJECT_ROOT/model-hub/models"
mkdir -p "$MODEL_HUB_PATH"

# 复制所有模型
cp -r "$SOURCE_PATH"/* "$MODEL_HUB_PATH/"
echo "✓ 已复制到 model-hub/models"

# 2. 复制到 node-inference/models (节点本地模型库)
echo ""
echo "[2/2] 复制到 node-inference/models (节点本地模型库)..."
NODE_INFERENCE_PATH="$PROJECT_ROOT/node-inference/models"
mkdir -p "$NODE_INFERENCE_PATH"

# 复制所有模型
cp -r "$SOURCE_PATH"/* "$NODE_INFERENCE_PATH/"
echo "✓ 已复制到 node-inference/models"

# 统计信息
echo ""
echo "复制完成！"
echo "模型位置:"
echo "  - 公司模型库: $MODEL_HUB_PATH"
echo "  - 节点模型库: $NODE_INFERENCE_PATH"

# 计算总大小
TOTAL_SIZE=$(du -sh "$MODEL_HUB_PATH" | cut -f1)
echo ""
echo "总大小: $TOTAL_SIZE"

echo ""
echo "注意: 模型文件已在 .gitignore 中排除，不会被提交到 Git"

