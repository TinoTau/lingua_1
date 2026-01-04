# Semantic Repair Service - Chinese (中文语义修复服务)

## 概述

中文语义修复服务用于修复ASR输出的中文文本，主要解决同音字错误、专有名词误识别等问题。

## 服务信息

- **服务ID**: `semantic-repair-zh`
- **端口**: `5013` (默认)
- **模型**: `qwen2.5-3b-instruct-zh` (INT4量化)
- **语言**: 中文 (zh)

## 项目结构

```
semantic_repair_zh/
├── service.json              # 服务配置文件
├── semantic_repair_zh_service.py  # 主服务文件
├── model_loader.py           # 模型加载器
├── repair_engine.py          # 修复引擎
├── prompt_templates.py       # Prompt模板
├── requirements.txt          # Python依赖
├── README.md                 # 本文档
├── docs/                     # 文档目录
│   ├── README.md             # 文档索引
│   ├── MODEL_DOWNLOAD_COMPLETE.md
│   ├── GPTQ_QUANTIZATION_ISSUE_REPORT.md
│   ├── 问题报告_中文.md
│   ├── OPTIMIZATION_SUMMARY.md
│   ├── SCRIPTS_USAGE_GUIDE.md
│   └── README_SCRIPTS.md
├── models/                   # 模型目录
│   └── qwen2.5-3b-instruct-zh/  # 中文优化模型
└── logs/                     # 日志目录
```

## 文档

更多技术文档请参考 [docs/README.md](docs/README.md)

## API接口

### POST /repair

修复ASR文本

**请求**:
```json
{
  "job_id": "job_123",
  "session_id": "session_456",
  "utterance_index": 0,
  "lang": "zh",
  "text_in": "今天天气很好",
  "quality_score": 0.65,
  "micro_context": "上一句文本...",
  "meta": {
    "segments": [],
    "language_probability": 0.95,
    "reason_codes": ["LOW_QUALITY_SCORE"]
  }
}
```

**响应**:
```json
{
  "decision": "REPAIR",
  "text_out": "今天天气很好",
  "confidence": 0.85,
  "diff": [
    {
      "from": "天气",
      "to": "天气",
      "position": 2
    }
  ],
  "reason_codes": ["LOW_QUALITY_SCORE"],
  "repair_time_ms": 120
}
```

### GET /health

健康检查

**响应**:
```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_version": "qwen2.5-3b-instruct-zh"
}
```

## 安装和运行

1. 安装依赖:
```bash
pip install -r requirements.txt
```

2. 下载模型到 `models/qwen2.5-3b-instruct-zh/` 目录

3. 启动服务:
```bash
python semantic_repair_zh_service.py
```

## 配置

编辑 `service.json` 配置服务参数。
