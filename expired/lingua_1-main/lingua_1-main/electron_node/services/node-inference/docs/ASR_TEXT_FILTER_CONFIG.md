# ASR 文本过滤配置文档

## 概述

ASR（自动语音识别）文本过滤功能用于过滤 Whisper 模型产生的无意义识别结果，如：
- 包含括号的文本（如 "(笑)"、"(字幕:J Chong)"、"(打開手機)"、"(拍攝)"、"(咖啡)"、"(空)" 等）
- 视频结尾字幕（如 "謝謝大家收看" 等）
- 字幕制作者信息
- 无意义的语气词和填充词
- 其他常见的误识别模式

这些文本会在 ASR 阶段被过滤掉，不会传递到 NMT（机器翻译）和 TTS（语音合成），从而节省节点端资源和带宽。

## 过滤机制

### 多层过滤策略

ASR 文本过滤采用多层过滤策略，确保无意义文本在各个阶段都能被有效过滤：

1. **片段级过滤**：在 ASR 识别过程中，对每个音频片段（segment）进行过滤
2. **结果级过滤**：对最终拼接的完整文本进行过滤
3. **智能括号处理**：能够识别并过滤括号内的内容，同时保留括号外的有效文本

### 过滤时机

- **`transcribe_f32`**：一次性转录时，在片段级别和最终结果级别都进行过滤
- **`get_partial_result`**：获取部分结果时，在片段级别进行过滤
- **`get_final_result`**：获取最终结果时，在片段级别和最终结果级别都进行过滤

### 空结果处理

当 ASR 识别结果为空或全部被过滤后，系统会：
- 跳过 NMT（机器翻译）处理
- 跳过 TTS（语音合成）处理
- 直接返回空结果，避免产生无意义的翻译和音频

## 配置文件

配置文件位置：`config/asr_filters.json`

配置文件采用 JSON 格式，支持以下配置项：

### 基本配置

```json
{
  "version": "1.0",
  "description": "ASR 文本过滤规则配置",
  "rules": {
    // 过滤规则
  }
}
```

### 过滤规则 (rules)

#### 1. filter_empty

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否过滤空文本

```json
"filter_empty": true
```

#### 2. filter_brackets

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否过滤包含括号的文本

```json
"filter_brackets": true
```

#### 3. filter_punctuation

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否过滤包含标点符号的文本。语音输入的文本不应该包含任何标点符号，所以所有带标点符号的文本都应该被过滤

```json
"filter_punctuation": true
```

**注意**: 此功能会过滤所有中文和英文标点符号，包括但不限于：
- 中文标点：，。！？；：、""''（）【】《》…—·等
- 英文标点：,.!?;:'"()[]{}等
- 其他常见标点：-、_、/、\、|、@、#、$、% 等

#### 4. bracket_chars

- **类型**: `string[]`
- **默认值**: `["(", ")", "（", "）", "[", "]", "【", "】"]`
- **说明**: 要过滤的括号字符列表。可以自定义添加或移除括号字符类型

```json
"bracket_chars": [
  "(",
  ")",
  "（",
  "）",
  "[",
  "]",
  "【",
  "】"
]
```

**注意**: 此配置项已从代码中移除硬编码，完全由配置文件控制。可以根据需要添加其他类型的括号字符。

#### 5. single_char_fillers

- **类型**: `string[]`
- **默认值**: `[]`
- **说明**: 单个字的无意义语气词列表，这些词会被过滤

```json
"single_char_fillers": [
  "嗯",
  "啊",
  "呃",
  "额",
  "哦",
  "噢",
  "诶",
  "欸"
]
```

#### 5. exact_matches

- **类型**: `string[]`
- **默认值**: `[]`
- **说明**: 精确匹配列表（不区分大小写），完全匹配的文本会被过滤

```json
"exact_matches": [
  "謝謝大家收看",
  "谢谢大家收看",
  "thank you for watching",
  "(字幕:j chong)"
]
```

#### 6. contains_patterns

- **类型**: `string[]`
- **默认值**: `[]`
- **说明**: 部分匹配模式列表，包含这些模式的文本会被过滤

```json
"contains_patterns": [
  "謝謝大家收看",
  "打赏支持",
  "字幕志愿者"
]
```

#### 7. all_contains_patterns

- **类型**: `object[]`
- **默认值**: `[]`
- **说明**: 需要同时包含多个模式的组合，所有模式都匹配时才会被过滤

```json
"all_contains_patterns": [
  {
    "patterns": ["点赞", "转发", "打赏"],
    "description": "视频推广文本组合"
  }
]
```

#### 8. subtitle_keywords

- **类型**: `string[]`
- **默认值**: `[]`
- **说明**: 字幕关键词（用于触发字幕模式检查）

```json
"subtitle_keywords": [
  "字幕"
]
```

#### 9. subtitle_patterns

- **类型**: `string[]`
- **默认值**: `[]`
- **说明**: 字幕相关模式

```json
"subtitle_patterns": [
  "字幕——",
  "字幕:",
  "字幕志愿者"
]
```

#### 10. subtitle_volunteer_patterns

- **类型**: `string[]`
- **默认值**: `[]`
- **说明**: 字幕志愿者信息模式

```json
"subtitle_volunteer_patterns": [
  "中文字幕志愿者",
  "字幕志愿者"
]
```

#### 11. subtitle_volunteer_min_length

- **类型**: `number`
- **默认值**: `8`
- **说明**: 字幕志愿者信息的最小长度阈值（字符数）

```json
"subtitle_volunteer_min_length": 8
```

#### 12. meaningless_patterns

- **类型**: `string[]`
- **默认值**: `[]`
- **说明**: 其他无意义模式（需要进一步检查是否在括号内）

```json
"meaningless_patterns": [
  "titled by",
  "subtitle:",
  "translated by"
]
```

#### 13. context_aware_thanks

- **类型**: `object`
- **默认值**: 见下方
- **说明**: 上下文相关的感谢语规则

```json
"context_aware_thanks": {
  "enabled": true,
  "min_context_length": 10,
  "thanks_patterns": [
    "谢谢大家",
    "感谢观看"
  ],
  "context_indicators": [
    "结束",
    "完成",
    "再见"
  ]
}
```

- **enabled**: 是否启用上下文判断
- **min_context_length**: 最小上下文长度（字符数）
- **thanks_patterns**: 感谢语模式列表
- **context_indicators**: 上下文指示词列表（表明这是对话结尾）

## 过滤逻辑

### 过滤层级

ASR 文本过滤采用三层过滤机制：

1. **Segment 级别过滤**: 在拼接前过滤每个 segment，跳过带括号等无意义文本
2. **文本级别过滤**: 对拼接后的完整文本再次过滤
3. **最终结果过滤**: 对最终结果进行最后一次过滤

### 过滤顺序

1. 检查空文本
2. 检查单个字的无意义语气词
3. **检查标点符号**（如果 `filter_punctuation` 为 `true`）
4. 检查括号（使用配置的 `bracket_chars`）
5. 检查上下文相关的感谢语
6. 检查精确匹配
7. 检查部分匹配模式
8. 检查需要同时包含多个模式的组合
9. 检查字幕相关模式
10. 检查无意义模式（需要进一步检查是否在括号内）

## 配置示例

完整的配置文件示例：

```json
{
  "version": "1.0",
  "description": "ASR 文本过滤规则配置",
  "rules": {
    "filter_empty": true,
    "filter_brackets": true,
    "filter_punctuation": true,
    "bracket_chars": [
      "(",
      ")",
      "（",
      "）",
      "[",
      "]",
      "【",
      "】"
    ],
    "single_char_fillers": [
      "嗯",
      "啊",
      "呃",
      "额",
      "哦",
      "噢",
      "诶",
      "欸"
    ],
    "exact_matches": [
      "謝謝大家收看",
      "谢谢大家收看",
      "thank you for watching"
    ],
    "contains_patterns": [
      "謝謝大家收看",
      "打赏支持",
      "字幕志愿者"
    ],
    "all_contains_patterns": [
      {
        "patterns": ["点赞", "转发", "打赏"],
        "description": "视频推广文本组合"
      }
    ],
    "subtitle_keywords": [
      "字幕"
    ],
    "subtitle_patterns": [
      "字幕:",
      "字幕志愿者"
    ],
    "subtitle_volunteer_patterns": [
      "中文字幕志愿者"
    ],
    "meaningless_patterns": [
      "titled by",
      "subtitle:"
    ],
    "context_aware_thanks": {
      "enabled": true,
      "min_context_length": 10,
      "thanks_patterns": [
        "谢谢大家",
        "感谢观看"
      ],
      "context_indicators": [
        "结束",
        "完成",
        "再见"
      ]
    },
    "subtitle_volunteer_min_length": 8
  }
}
```

## 代码实现

### 主要文件

- `src/text_filter.rs`: 文本过滤逻辑实现
- `src/text_filter/config.rs`: 配置结构定义和加载
- `src/asr.rs`: ASR 引擎，在三个方法中应用过滤：
  - `transcribe_f32()`: 一次性转录
  - `get_partial_result()`: 获取部分结果
  - `get_final_result()`: 获取最终结果

### 关键改动

1. **移除硬编码**: 所有过滤规则（包括括号字符）都已从代码中移除，完全由配置文件控制
2. **Segment 级别过滤**: 在所有 ASR 方法中添加了 segment 级别的过滤，更早地过滤无意义文本
3. **可配置括号字符**: `bracket_chars` 配置项允许自定义要过滤的括号字符类型

## 使用说明

### 修改配置

1. 编辑 `config/asr_filters.json` 文件
2. 修改相应的配置项
3. 重启服务使配置生效

### 添加新的过滤规则

1. 在 `exact_matches` 中添加精确匹配的文本
2. 在 `contains_patterns` 中添加部分匹配的模式
3. 在 `all_contains_patterns` 中添加需要同时匹配多个模式的组合
4. 在 `bracket_chars` 中添加新的括号字符类型

### 禁用某些过滤规则

将相应的配置项设置为 `false` 或空数组：

```json
{
  "rules": {
    "filter_brackets": false,  // 禁用括号过滤
    "exact_matches": [],       // 清空精确匹配列表
    "contains_patterns": []    // 清空部分匹配列表
  }
}
```

## 测试

过滤功能已包含在单元测试中：

```bash
cd electron_node/services/node-inference
cargo test --test text_filter_test
```

测试覆盖：
- 括号过滤测试
- 视频结尾字幕过滤测试
- 字幕标记过滤测试
- 空文本过滤测试
- 语气词过滤测试

## 注意事项

1. **配置文件路径**: 配置文件使用固定路径 `config/asr_filters.json`（相对于服务运行目录）

2. **配置加载**: 如果找不到配置文件，会使用默认配置（所有过滤规则启用，但列表为空）。配置在服务启动时自动加载。

3. **性能影响**: Segment 级别过滤可能会略微增加处理时间，但可以更早地过滤无意义文本，节省后续处理资源

4. **过滤效果**: 被过滤的文本不会传递到 NMT 和 TTS，也不会占用节点端资源和带宽

## 更新日志

### 2025-01-XX
- **标点符号过滤**：新增 `filter_punctuation` 配置项，自动过滤所有包含标点符号的文本
  - 语音输入的文本不应该包含任何标点符号，所有带标点符号的文本都会被过滤
  - 支持中文和英文标点符号的全面过滤
  - 有效防止静音时被误识别为带标点的文本（通常来自视频字幕训练数据）

### 2024-12-20
- **多层过滤机制**：实现了片段级和结果级的多层过滤
- **智能括号处理**：能够识别并过滤括号内的内容，同时保留括号外的有效文本
- **空结果处理**：当 ASR 结果为空时，跳过 NMT 和 TTS 处理，直接返回空结果
- **配置简化**：简化了配置文件加载机制，使用固定路径 `config/asr_filters.json`
- **日志增强**：添加了详细的过滤日志，便于调试和追踪
- **精确匹配增强**：添加了更多无意义文本的精确匹配规则（如 "(空)"、"介紹哨音" 等）

### v1.0

- ✅ 移除硬编码的括号字符，改为配置文件控制
- ✅ 添加 `bracket_chars` 配置项
- ✅ 在所有 ASR 方法中添加 segment 级别过滤
- ✅ 实现三层过滤机制（segment、文本、最终结果）
- ✅ 完全可配置的过滤规则系统

