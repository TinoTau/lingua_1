# EN Normalize Service (英文文本标准化服务)

## 概述

英文文本标准化服务用于对ASR输出的英文文本进行轻量级标准化处理，包括：
- 数字标准化
- 单位标准化
- 日期标准化
- 缩写保护
- URL保护

## 服务信息

- **服务ID**: `en-normalize`
- **端口**: `5012` (默认)
- **模型**: 无（纯规则处理）
- **语言**: 英文 (en)

## 项目结构

```
en_normalize/
├── service.json              # 服务配置文件
├── en_normalize_service.py   # 主服务文件
├── normalizer.py             # 标准化器
├── rules/                    # 规则文件
│   ├── number_rules.py
│   ├── unit_rules.py
│   ├── date_rules.py
│   └── acronym_rules.py
├── requirements.txt          # Python依赖
├── README.md                 # 本文档
├── docs/                     # 文档目录
│   └── README.md             # 文档索引
└── logs/                     # 日志目录
```

## 文档

更多技术文档请参考 [docs/README.md](docs/README.md)

## API接口

### POST /normalize

标准化英文文本

**请求**:
```json
{
  "job_id": "job_123",
  "session_id": "session_456",
  "utterance_index": 0,
  "lang": "en",
  "text_in": "The price is $100 USD",
  "quality_score": 0.8
}
```

**响应**:
```json
{
  "decision": "PASS",
  "text_out": "The price is $100 USD",
  "confidence": 1.0,
  "reason_codes": [],
  "normalize_time_ms": 5
}
```

### GET /health

健康检查

**响应**:
```json
{
  "status": "healthy",
  "rules_loaded": true
}
```

## 安装和运行

1. 安装依赖:
```bash
pip install -r requirements.txt
```

2. 启动服务:
```bash
python en_normalize_service.py
```

## 配置

编辑 `service.json` 配置服务参数。
