#!/bin/bash
# 下载 Faster Whisper Large-v3 模型到本地
# 使用当前目录的虚拟环境

echo "========================================"
echo "下载 Faster Whisper Large-v3 模型"
echo "========================================"
echo ""

# 检查虚拟环境是否存在
if [ ! -f "venv/bin/activate" ]; then
    echo "错误: 虚拟环境不存在，请先创建虚拟环境"
    echo "运行: python3 -m venv venv"
    exit 1
fi

# 激活虚拟环境并运行下载脚本
source venv/bin/activate
python download_model.py --model Systran/faster-whisper-large-v3 --output models/asr/faster-whisper-large-v3

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "模型下载完成！"
    echo "========================================"
else
    echo ""
    echo "========================================"
    echo "模型下载失败！"
    echo "========================================"
    exit 1
fi

