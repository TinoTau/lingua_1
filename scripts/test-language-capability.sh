#!/bin/bash
# 语言能力功能测试脚本

set -e

SCHEDULER_URL="${SCHEDULER_URL:-http://localhost:5010}"
NODE_ID=""

echo "=========================================="
echo "语言能力功能测试"
echo "=========================================="
echo ""

# 1. 检查调度服务器是否运行
echo "1. 检查调度服务器状态..."
if curl -s -f "${SCHEDULER_URL}/health" > /dev/null 2>&1; then
    echo "✓ 调度服务器运行中"
else
    echo "✗ 调度服务器未运行，请先启动调度服务器"
    exit 1
fi
echo ""

# 2. 检查节点注册状态（如果 API 可用）
echo "2. 检查节点注册状态..."
# 这里可以添加检查节点的 API 调用
echo "（需要实现节点查询 API）"
echo ""

# 3. 检查 Pool 配置（如果 API 可用）
echo "3. 检查 Pool 配置..."
# 这里可以添加检查 Pool 的 API 调用
echo "（需要实现 Pool 查询 API）"
echo ""

# 4. 发送测试任务（zh -> en）
echo "4. 发送测试任务（zh -> en）..."
cat > /tmp/test-job-zh-en.json <<EOF
{
  "src_lang": "zh",
  "tgt_lang": "en",
  "session_id": "test-session-zh-en",
  "utterance_index": 1,
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "audio": ""
}
EOF

# 如果 API 可用，发送请求
# curl -X POST "${SCHEDULER_URL}/api/jobs" \
#   -H "Content-Type: application/json" \
#   -d @/tmp/test-job-zh-en.json

echo "（需要实现任务分配 API）"
echo ""

# 5. 发送测试任务（en -> zh）
echo "5. 发送测试任务（en -> zh）..."
cat > /tmp/test-job-en-zh.json <<EOF
{
  "src_lang": "en",
  "tgt_lang": "zh",
  "session_id": "test-session-en-zh",
  "utterance_index": 1,
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "audio": ""
}
EOF

echo "（需要实现任务分配 API）"
echo ""

# 6. 发送测试任务（auto -> en）
echo "6. 发送测试任务（auto -> en）..."
cat > /tmp/test-job-auto-en.json <<EOF
{
  "src_lang": "auto",
  "tgt_lang": "en",
  "session_id": "test-session-auto-en",
  "utterance_index": 1,
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "audio": ""
}
EOF

echo "（需要实现任务分配 API）"
echo ""

echo "=========================================="
echo "测试完成"
echo "=========================================="
echo ""
echo "请检查："
echo "1. 调度服务器日志中的 Pool 生成信息"
echo "2. 调度服务器日志中的节点分配信息"
echo "3. 调度服务器日志中的任务分配信息"
echo "4. 节点端日志中的语言能力检测信息"
