# ASR 过滤配置文件说明

## 配置文件

- **文件路径**: `config/asr_filters.json`
- **格式**: JSON
- **用途**: 配置 ASR（自动语音识别）文本过滤规则

## 详细文档

完整的配置说明和使用指南请参考：

📖 [ASR 文本过滤配置文档](../docs/ASR_TEXT_FILTER_CONFIG.md)

## 快速开始

1. 编辑 `asr_filters.json` 文件
2. 修改相应的配置项
3. 重启服务使配置生效

## 主要配置项

- `filter_brackets`: 是否过滤包含括号的文本
- `bracket_chars`: 要过滤的括号字符列表（可自定义）
- `exact_matches`: 精确匹配的文本列表
- `contains_patterns`: 部分匹配的模式列表
- `single_char_fillers`: 单个字的无意义语气词列表

更多配置项请参考详细文档。

