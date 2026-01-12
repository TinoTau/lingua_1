# Semantic Repair Service - English (英文语义修复服务)

## 概述

英文语义修复服务用于修复ASR输出的英文文本，主要解决拼写错误、语法错误等问题。

## 服务信息

- **服务ID**: `semantic-repair-en`
- **端口**: `5011` (默认)
- **模型**: `qwen2.5-3b-instruct-en` (INT4量化)
- **语言**: 英文 (en)

## 项目结构

```
semantic_repair_en/
├── service.json              # 服务配置文件
├── semantic_repair_en_service.py  # 主服务文件
├── model_loader.py           # 模型加载器
├── repair_engine.py          # 修复引擎
├── prompt_templates.py       # Prompt模板
├── requirements.txt          # Python依赖
├── README.md                 # 本文档
├── docs/                     # 文档目录
│   └── README.md             # 文档索引
├── models/                   # 模型目录
│   └── qwen2.5-3b-instruct-en/  # 英文优化模型
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
  "lang": "en",
  "text_in": "Hello world",
  "quality_score": 0.65,
  "micro_context": "Previous text...",
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
  "text_out": "Hello world",
  "confidence": 0.85,
  "diff": [],
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
  "model_version": "qwen2.5-3b-instruct-en"
}
```

## 安装和运行

1. 安装依赖:
```bash
pip install -r requirements.txt
```

2. 下载模型到 `models/qwen2.5-3b-instruct-en/` 目录:
```bash
python download_model.py
```

3. 启动服务:
```bash
python semantic_repair_en_service.py
```

## 配置

编辑 `service.json` 配置服务参数。
