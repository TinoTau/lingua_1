# Pool 索引查找问题修复

## 问题描述
集成测试时出现警告：
```
WARN 未找到包含源语言 zh 和目标语言 en 的 Pool
src_lang=zh tgt_lang=en total_pools=1
```

## 问题分析

### 根本原因
`find_pools_for_lang_pair()` 方法的查找顺序有问题：
1. 先查找精确语言对 `(zh, en)` - 不会找到（因为没有 specific_pairs）
2. 然后查找混合池 - 可能找到，但不准确
3. **缺少语言集合查找** - 这是关键问题

### Pool 索引方式
根据 Pool 配置，使用 "any_to_any" 规则的 Pool 会被索引到：
- `by_mixed_pool`: 按单个语言（如 "zh", "en"）
- `by_language_set`: 按语言集合（如 "en-zh"，排序后）

### 查找逻辑问题
原来的 `find_pools_for_lang_pair()` 在查找精确语言对后，直接跳转到混合池查找，**跳过了语言集合查找**。

## 修复方案

### 1. 修复查找顺序
在 `find_pools_for_lang_pair()` 中，在查找混合池之前，先查找语言集合：

```rust
// 精确语言对查找
let key = (normalized_src.clone(), normalized_tgt.clone());
if let Some(pools) = self.by_language_pair.get(&key) {
    return pools.clone();
}

// 新增：语言集合查找（any_to_any 规则）
let mut langs = vec![normalized_src.clone(), normalized_tgt.clone()];
langs.sort();
let set_key = langs.join("-");
if let Some(pools) = self.by_language_set.get(&set_key) {
    return pools.clone();
}

// 最后：混合池查找（fallback）
// ...
```

### 2. 添加调试日志
- 在索引重建时输出索引内容
- 在查找失败时输出可用的语言集合
- 帮助定位问题

## 修复内容

### 文件: `src/node_registry/pool_language_index.rs`

1. **修复 `find_pools_for_lang_pair()` 方法**
   - 在查找混合池之前，先查找语言集合
   - 添加调试日志，输出查找过程和结果

2. **增强 `rebuild_from_pools()` 方法**
   - 添加调试日志，输出索引内容
   - 帮助排查索引是否正确构建

## 测试建议

1. **重启调度服务器**
   - 确保新的代码生效

2. **查看日志**
   - 检查索引重建日志，确认 Pool 被正确索引
   - 检查查找日志，确认查找过程

3. **重新测试**
   - 使用 zh-en 语言对进行测试
   - 应该能找到对应的 Pool

## 预期结果

修复后，查找 "zh-en" 语言对时：
1. 先尝试精确语言对 `(zh, en)` - 不会找到
2. **然后尝试语言集合 "en-zh"（排序后）** - **应该能找到**
3. 如果还没找到，尝试混合池 - 作为 fallback

这样应该能解决 "未找到包含源语言 zh 和目标语言 en 的 Pool" 的问题。
