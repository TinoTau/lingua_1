# extract_translation 功能说明

## 所属服务

**NMT服务** (`electron_node/services/nmt_m2m100/`)

## 功能概述

`extract_translation` 是 NMT 服务中的一个**翻译提取器**，用于从完整翻译结果中提取**只属于当前句的翻译部分**。

## 为什么需要这个功能？

### 问题背景

当 NMT 服务接收到 `context_text`（上下文文本）时，为了提高翻译质量，会将上下文和当前文本拼接后一起翻译：

```python
# 在 nmt_service.py 中
if req.context_text and req.context_text.strip():
    # 使用哨兵序列拼接：上下文 + 哨兵序列 + 当前文本
    input_text = f"{req.context_text}{SEPARATOR}{req.text}"
    # 例如："提高了一点,那我希望接下来可以做到更好更快 [SEPARATOR] 再提高了一点速度"
```

### 问题

NMT 模型会将整个拼接后的文本一起翻译，返回的翻译结果包含两部分：
1. **context_text 的翻译**（上一句的翻译）
2. **当前句的翻译**（我们需要的部分）

例如：
- 输入：`"提高了一点,那我希望接下来可以做到更好更快 [SEPARATOR] 再提高了一点速度"`
- NMT 输出：`"improved a little, then i hope that the next can do better faster [SEPARATOR] again a bit greater speed"`
- 我们需要：`"again a bit greater speed"`（只提取当前句的翻译）

### 解决方案

`extract_translation` 函数的作用就是**从完整翻译中提取只属于当前句的翻译部分**，丢弃 context_text 的翻译部分。

## 工作原理

### 方法1：哨兵序列（Sentinel Sequence）提取（主要方法）

1. **查找哨兵序列位置**：
   - 在完整翻译中查找 `SEPARATOR` 的翻译（哨兵序列）
   - 例如：`"improved a little... [SEPARATOR] again a bit greater speed"`
   - 找到哨兵序列后，提取其后的文本

2. **提取当前句翻译**：
   - 从哨兵序列位置开始，提取后续的所有文本
   - 清理可能残留的哨兵序列标记

### 方法2：上下文对齐切割（Fallback）

如果找不到哨兵序列（可能被模型翻译掉了），使用对齐方法：
1. 单独翻译 `context_text`，得到 context 的翻译
2. 在完整翻译中找到 context 翻译的结束位置
3. 提取该位置之后的文本作为当前句的翻译

### 方法3：单独翻译（兜底策略）

如果前两种方法都失败：
1. 单独翻译当前文本（不使用 context）
2. 返回单独翻译的结果

## 使用场景

### 场景1：有 context_text

```python
# 请求
{
    "text": "再提高了一点速度",
    "context_text": "提高了一点,那我希望接下来可以做到更好更快"
}

# NMT 输入（拼接后）
"提高了一点,那我希望接下来可以做到更好更快 [SEPARATOR] 再提高了一点速度"

# NMT 输出（完整翻译）
"improved a little, then i hope that the next can do better faster [SEPARATOR] again a bit greater speed"

# extract_translation 提取后
"again a bit greater speed"  # 只返回当前句的翻译
```

### 场景2：没有 context_text

```python
# 请求
{
    "text": "再提高了一点速度",
    "context_text": null
}

# NMT 输入
"再提高了一点速度"

# NMT 输出
"again a bit greater speed"

# extract_translation 提取后
"again a bit greater speed"  # 直接返回完整翻译（因为没有context）
```

## 为什么会出现问题？

### Job 12 文本丢失问题

如果 `extract_translation` 提取逻辑有问题，可能导致：
1. **提取位置错误**：提取了错误的文本段
2. **提取不完整**：只提取了部分文本，丢失了后半句
3. **提取失败**：提取结果为空或太短

### 修复措施

我们改进了 `extract_translation` 的检查逻辑：
1. **更严格的长度检查**：如果提取的翻译少于原文30%或50%，记录警告
2. **添加比例日志**：记录提取长度和原文长度的比例，便于调试
3. **改进错误处理**：如果提取失败，使用兜底策略

## 相关文件

- `translation_extractor.py` - 提取器实现
- `nmt_service.py` - NMT 服务主文件，调用 extract_translation
- `config.py` - 配置 SEPARATOR 和 SEPARATOR_TRANSLATIONS
- `pattern_generator.py` - 生成截断模式（用于查找被翻译掉的哨兵序列）

## 总结

`extract_translation` 是 NMT 服务中的一个关键功能，用于处理带 `context_text` 的翻译请求。它确保只返回当前句的翻译，而不是包含上下文的完整翻译。这对于保持翻译结果的准确性和避免重复翻译至关重要。
