# NMT上下文提取修复

## 问题描述

从集成测试中发现以下问题：

1. **NMT提取错误**：
   - 译文开头被截断（如 `P>`, `onds`, `'m` 等）
   - 译文包含 `<SEP>` 分隔符符号
   - 提取结果不准确

2. **重复输出**：
   - 同一ASR文本被多次识别和输出

## 根本原因

### 1. 代码逻辑错误（缩进问题）

**问题**：即使找到了分隔符 `<SEP>`，fallback方法（单独翻译context_text）仍然会执行。

**原因**：第651行开始的代码没有正确缩进在 `else` 块内，导致无论是否找到分隔符，都会执行fallback方法。

**影响**：
- 浪费计算资源（额外的NMT调用）
- 提取结果可能被fallback方法覆盖
- 日志混乱，难以调试

### 2. 分隔符清理不完整

**问题**：提取时没有完全清理分隔符残留。

**原因**：
- 分隔符 `<SEP>` 可能被部分翻译（如 `<SEP>` 变成 `P>`）
- 提取位置计算可能包含分隔符的一部分
- 没有最终清理步骤

**影响**：
- 最终输出包含分隔符字符（如 `<SEP>`, `P>`, `>` 等）
- 译文开头被截断

## 修复方案

### 1. 修复代码逻辑（缩进）

**文件**：`electron_node/services/nmt_m2m100/nmt_service.py`

**修改**：
- 确保fallback方法（单独翻译context_text）只在找不到分隔符时执行
- 正确缩进第651-722行的代码到 `else` 块内

### 2. 增强分隔符清理

**修改**：
- 在找到分隔符并提取后，立即清理所有可能的分隔符残留
- 移除所有分隔符变体（`<SEP>`, `<sep>`, ` <SEP> ` 等）
- 移除以 `<` 或 `>` 开头的残留字符
- 在最终输出前再次清理，确保不包含任何分隔符

**代码位置**：第641-660行

```python
if separator_pos != -1:
    # 找到分隔符，提取之后的部分（当前句翻译）
    final_output = out[separator_pos:].strip()
    
    # 清理：移除任何残留的分隔符字符
    for sep_variant in SEPARATOR_TRANSLATIONS:
        if final_output.startswith(sep_variant):
            final_output = final_output[len(sep_variant):].strip()
        final_output = final_output.replace(sep_variant, " ").strip()
    
    # 清理：移除任何以 `<` 或 `>` 开头的残留
    while final_output.startswith("<") or final_output.startswith(">"):
        space_pos = final_output.find(" ")
        if space_pos > 0:
            final_output = final_output[space_pos:].strip()
        else:
            final_output = final_output[1:].strip()
```

### 3. 最终清理步骤

**修改**：
- 在所有提取方法之后，添加最终清理步骤
- 确保无论使用哪种方法提取，最终输出都不包含分隔符

**代码位置**：第724-740行

```python
# 最终清理：移除所有可能的分隔符残留（无论使用哪种方法提取）
for sep_variant in SEPARATOR_TRANSLATIONS:
    if sep_variant in final_output:
        final_output = final_output.replace(sep_variant, " ").strip()
```

## 测试验证

### 测试场景

1. **分隔符提取测试**：
   - 输入包含 `<SEP>` 分隔符的完整翻译
   - 验证提取结果不包含分隔符
   - 验证提取结果开头完整（不以 `<`, `>`, `P>` 等开头）

2. **Fallback方法测试**：
   - 输入不包含分隔符的完整翻译
   - 验证fallback方法正确执行
   - 验证提取结果准确

3. **边界情况测试**：
   - 分隔符被部分翻译的情况
   - 分隔符在输出中间的情况
   - 提取结果为空或太短的情况

### 预期结果

- ✅ 译文不包含 `<SEP>` 分隔符
- ✅ 译文开头完整（不以 `<`, `>`, `P>` 等开头）
- ✅ 提取结果准确
- ✅ 日志清晰，不会同时显示两种方法的结果

## 相关文件

- **修复文件**：`electron_node/services/nmt_m2m100/nmt_service.py`
- **测试日志**：`electron_node/services/nmt_m2m100/logs/nmt-service.log`
- **节点端日志**：`electron_node/electron-node/logs/electron-main.log`

## 后续优化建议

1. **使用更可靠的分隔符**：
   - 考虑使用更不容易被翻译的特殊字符组合
   - 或者使用token级别的分隔符

2. **改进提取算法**：
   - 使用更智能的文本匹配算法
   - 考虑使用语义相似度来验证提取结果

3. **添加单元测试**：
   - 为提取逻辑添加单元测试
   - 覆盖各种边界情况

---

**修复日期**：2025-12-30  
**修复人员**：AI Assistant  
**状态**：✅ 已修复，待测试验证

