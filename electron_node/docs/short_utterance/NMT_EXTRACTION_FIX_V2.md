# NMT提取逻辑修复 V2

## 问题总结

从集成测试中发现以下问题：

1. **P> 残留问题**：
   - Job 12开始出现 "P>" 前缀
   - 原因：`Found better extraction point` 逻辑在向前查找大写字母时，找到了 `<SEP>` 中的 `P`
   - 导致提取出 "P> then look at..." 这样的文本

2. **重复输出问题**：
   - Job 18, 19, 20 重复输出相同文本
   - ASR重复识别了相同文本，但去重逻辑可能没有完全阻止输出

## 修复方案

### 1. 修复 P> 残留问题

**问题根源**：
- `Found better extraction point` 逻辑在向前查找大写字母时，没有跳过分隔符相关的字符
- 找到了 `<SEP>` 中的 `P`，然后提取了 "P>" 开头的文本

**修复方法**：
1. 在向前查找大写字母时，跳过分隔符相关的字符（`<`, `>`, `P`, `S`, `E`）
2. 检查是否是分隔符的一部分（检查前后字符）
3. 检查 potential_text 是否包含分隔符，如果包含则跳过
4. 添加最终清理步骤，移除 "P>" 前缀和任何字母+">" 模式

**代码位置**：`electron_node/services/nmt_m2m100/nmt_service.py` 第751-777行

### 2. 增强清理逻辑

**新增清理步骤**：
1. 移除以 "P>" 开头的残留
2. 使用正则表达式移除任何字母+">" 模式（如 "P>", "S>", "E>" 等）
3. 移除单独的 ">" 或 "<" 字符（在开头）

**代码位置**：`electron_node/services/nmt_m2m100/nmt_service.py` 第740-750行

## 测试验证

### 测试场景

1. **P> 残留测试**：
   - 输入包含 `<SEP>` 分隔符的完整翻译
   - 验证提取结果不包含 "P>" 前缀
   - 验证清理逻辑正确工作

2. **重复输出测试**：
   - 输入重复的ASR文本
   - 验证去重逻辑正确工作
   - 验证不会输出重复内容

### 预期结果

- ✅ 译文不包含 "P>" 前缀
- ✅ 译文不包含任何分隔符残留
- ✅ 提取结果准确
- ✅ 重复文本被正确过滤

## 相关文件

- **修复文件**：`electron_node/services/nmt_m2m100/nmt_service.py`
- **修复文档**：`electron_node/docs/short_utterance/NMT_EXTRACTION_FIX.md`
- **NMT日志**：`electron_node/services/nmt_m2m100/logs/nmt-service.log`
- **节点端日志**：`electron_node/electron-node/logs/electron-main.log`

---

**修复日期**：2025-12-30  
**修复人员**：AI Assistant  
**状态**：✅ 已修复，待测试验证

