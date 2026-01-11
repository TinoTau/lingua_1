# Pool 索引查找 Bug 根本原因分析

## 问题描述
集成测试时出现警告：
```
WARN 未找到包含源语言 zh 和目标语言 en 的 Pool
src_lang=zh tgt_lang=en total_pools=1
```

## 一、Pool 创建和命名规则（根据文档）

### 1.1 Pool 命名规则
根据 `LANGUAGE_SET_POOL_IMPLEMENTATION.md` 和 `POOL_ARCHITECTURE.md`：

**Pool 命名规则**：
- 语言集合按**字母顺序排序**，用 `-` 连接
- 例如：节点支持 `{zh, en}` → Pool 名称：`en-zh`（排序后）
- 例如：节点支持 `{zh, en, de}` → Pool 名称：`de-en-zh`（排序后）

**关键点**：
- Pool 名称是**排序后的语言集合**，不是语言对
- `zh-en` 和 `en-zh` 是**同一个 Pool**（排序后都是 `en-zh`）

### 1.2 Pool 创建逻辑
根据 `auto_language_pool.rs`：

```rust
// 排序语言集合（用于 Pool 命名）
let mut sorted_langs = lang_set.clone();
sorted_langs.sort();
let pool_name = sorted_langs.join("-");  // 例如：{zh, en} → "en-zh"
```

### 1.3 Pool 配置结构
根据代码，Pool 配置包含：
```rust
language_requirements: Some(PoolLanguageRequirements {
    nmt_requirements: Some(PoolNmtRequirements {
        languages: sorted_langs.clone(),  // 例如：["en", "zh"]
        rule: "any_to_any".to_string(),  // 支持任意语言对
        supported_pairs: None,
    }),
    semantic_languages: Some(sorted_langs.clone()),  // 例如：["en", "zh"]
}),
```

## 二、Pool 索引机制（根据代码）

### 2.1 索引结构
`PoolLanguageIndex` 包含三个索引：

1. **`by_language_pair`**: 精确语言对索引
   - 键：`(src_lang, tgt_lang)`，如 `("zh", "en")`
   - 值：`Vec<pool_id>`
   - **用途**：查找支持特定语言对的 Pool（`specific_pairs` 规则）

2. **`by_mixed_pool`**: 混合池索引
   - 键：单个语言，如 `"zh"`, `"en"`
   - 值：`Vec<pool_id>`
   - **用途**：查找支持特定语言的混合池（`any_to_any` 规则）

3. **`by_language_set`**: 语言集合索引
   - 键：排序后的语言集合，如 `"en-zh"`, `"de-en-zh"`
   - 值：`Vec<pool_id>`
   - **用途**：查找包含特定语言集合的 Pool

### 2.2 索引构建逻辑
根据 `pool_language_index.rs` 的 `add_pool()` 方法：

```rust
// 当 rule = "any_to_any" 时
for lang in &nmt_req.languages {
    // 添加到混合池索引（按单个语言）
    self.by_mixed_pool
        .entry(normalize_lang(lang))
        .or_insert_with(Vec::new)
        .push(pool.pool_id);
}

// 处理语义修复语言集合
if let Some(ref semantic_langs) = lang_req.semantic_languages {
    let mut sorted = semantic_langs.clone();
    sorted.sort();
    let key = sorted.join("-");  // 例如：["en", "zh"] → "en-zh"
    self.by_language_set
        .entry(key)
        .or_insert_with(Vec::new)
        .push(pool.pool_id);
}
```

**关键点**：
- 使用 "any_to_any" 规则的 Pool 会被索引到：
  - `by_mixed_pool`: 按单个语言（如 "zh", "en"）
  - `by_language_set`: 按语言集合（如 "en-zh"，排序后）

## 三、查找机制（原来的实现）

### 3.1 原来的查找顺序
根据 `pool_selection.rs` 和 `pool_language_index.rs`：

```rust
// 1. 精确语言对查找
let key = (normalized_src, normalized_tgt);
if let Some(pools) = self.by_language_pair.get(&key) {
    return pools.clone();  // 找到，返回
}

// 2. 混合池查找（fallback）
let mut result = Vec::new();
if let Some(pools) = self.by_mixed_pool.get(&normalized_src) {
    result.extend_from_slice(pools);
}
if let Some(pools) = self.by_mixed_pool.get(&normalized_tgt) {
    result.extend_from_slice(pools);
}
return result;
```

### 3.2 问题所在
**关键问题**：原来的代码**跳过了语言集合查找**！

查找 "zh-en" 时：
1. ✅ 尝试精确语言对 `(zh, en)` - 不会找到（因为没有 `specific_pairs`）
2. ❌ **直接跳转到混合池查找** - 可能找到，但不准确
3. ❌ **完全跳过了语言集合查找** - 这是关键问题！

## 四、为什么会出 Bug

### 4.1 根本原因
1. **Pool 使用 "any_to_any" 规则**：
   - Pool 被索引到 `by_mixed_pool`（按单个语言）
   - Pool 也被索引到 `by_language_set`（按语言集合，如 "en-zh"）

2. **查找逻辑不完整**：
   - 原来的 `find_pools_for_lang_pair()` 在查找精确语言对后，**直接跳转到混合池查找**
   - **完全跳过了语言集合查找**，这是最准确的查找方式

3. **混合池查找不准确**：
   - 混合池索引是按单个语言索引的（如 "zh", "en"）
   - 查找 "zh-en" 时，会查找 "zh" 和 "en" 的混合池
   - 但这种方式可能返回不相关的 Pool（如只支持 "zh" 或只支持 "en" 的 Pool）

### 4.2 具体场景
假设有一个 Pool：
- **名称**：`en-zh`（排序后的语言集合）
- **规则**：`any_to_any`（支持任意语言对）
- **索引位置**：
  - `by_mixed_pool["en"]` → 包含该 Pool
  - `by_mixed_pool["zh"]` → 包含该 Pool
  - `by_language_set["en-zh"]` → 包含该 Pool

查找 "zh-en" 时：
1. ❌ 精确语言对 `(zh, en)` - 不会找到（因为没有 `specific_pairs`）
2. ⚠️ 混合池查找 - 可能找到，但可能返回其他不相关的 Pool
3. ✅ **语言集合查找 "en-zh"（排序后）** - **应该能找到，但被跳过了！**

## 五、修复方案

### 5.1 修复后的查找顺序
```rust
// 1. 精确语言对查找
let key = (normalized_src, normalized_tgt);
if let Some(pools) = self.by_language_pair.get(&key) {
    return pools.clone();
}

// 2. 语言集合查找（新增，关键修复）
let mut langs = vec![normalized_src.clone(), normalized_tgt.clone()];
langs.sort();
let set_key = langs.join("-");  // 例如：["zh", "en"] → "en-zh"
if let Some(pools) = self.by_language_set.get(&set_key) {
    return pools.clone();  // 找到，返回
}

// 3. 混合池查找（fallback）
// ...
```

### 5.2 为什么这样修复
1. **语言集合查找最准确**：
   - 直接匹配 Pool 的语言集合（如 "en-zh"）
   - 这是 Pool 创建时使用的命名规则

2. **符合设计意图**：
   - 根据文档，Pool 是基于语言集合创建的
   - 查找时也应该基于语言集合查找

3. **查找顺序合理**：
   - 精确语言对 → 语言集合 → 混合池
   - 从最精确到最宽泛

## 六、总结

### 6.1 Bug 根本原因
1. **设计不一致**：
   - Pool 创建时使用语言集合（排序后，如 "en-zh"）
   - 但查找时跳过了语言集合查找，只查找混合池

2. **查找逻辑不完整**：
   - 原来的代码在查找精确语言对后，直接跳转到混合池查找
   - 完全跳过了最准确的语言集合查找

3. **索引使用不当**：
   - Pool 被正确索引到 `by_language_set`
   - 但查找时没有使用这个索引

### 6.2 修复效果
修复后，查找 "zh-en" 时：
1. 尝试精确语言对 `(zh, en)` - 不会找到
2. **尝试语言集合 "en-zh"（排序后）** - **应该能找到** ✅
3. 如果还没找到，尝试混合池 - 作为 fallback

### 6.3 经验教训
1. **索引和查找要一致**：
   - 如果索引了某个维度，查找时也要使用该维度

2. **查找顺序很重要**：
   - 应该从最精确到最宽泛
   - 语言集合查找应该在混合池查找之前

3. **文档和代码要一致**：
   - Pool 命名规则在文档中明确说明
   - 查找逻辑应该遵循相同的规则
