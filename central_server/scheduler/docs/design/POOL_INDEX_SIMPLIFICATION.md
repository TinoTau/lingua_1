# Pool 索引简化方案

## 简化目标

根据用户建议，简化 Pool 索引机制：
- **直接按语言缩写的字母排序来给 Pool 命名**
- **搜索时也直接按排序后的语言集合查找**
- **移除复杂的混合池和语言对索引逻辑**

## 简化前后对比

### 简化前

**索引结构**：
- `by_language_pair`: 精确语言对索引 `(src_lang, tgt_lang) -> Vec<pool_id>`
- `by_mixed_pool`: 混合池索引 `lang -> Vec<pool_id>`
- `by_language_set`: 语言集合索引 `sorted_langs -> Vec<pool_id>`

**查找逻辑**：
1. 精确语言对查找
2. 语言集合查找
3. 混合池查找（fallback）

**问题**：
- 索引结构复杂，需要维护三个索引
- 查找逻辑复杂，需要多级 fallback
- 容易出错（如之前的 bug：跳过了语言集合查找）

### 简化后

**索引结构**：
- `by_language_set`: 语言集合索引 `sorted_langs -> Vec<pool_id>`（唯一索引）

**查找逻辑**：
1. 如果是 "auto" 模式：查找所有包含目标语言的 Pool
2. 否则：直接按排序后的语言集合查找

**优势**：
- 索引结构简单，只需维护一个索引
- 查找逻辑直接，与 Pool 命名规则一致
- 不容易出错，代码更易维护

## 实现细节

### Pool 命名规则

```rust
// 语言集合按字母顺序排序后用 `-` 连接
let mut langs = vec!["zh".to_string(), "en".to_string()];
langs.sort();  // ["en", "zh"]
let pool_name = langs.join("-");  // "en-zh"
```

### 索引构建

```rust
fn add_pool(&mut self, pool: &Phase3PoolConfig) {
    // 获取语言集合（优先使用 semantic_languages，否则使用 nmt_requirements.languages）
    let mut langs: Vec<String> = ...;
    
    // 排序语言集合（与 Pool 命名规则一致）
    langs.sort();
    let key = langs.join("-");
    
    // 只索引到语言集合索引
    self.by_language_set
        .entry(key)
        .or_insert_with(Vec::new)
        .push(pool.pool_id);
}
```

### 查找逻辑

```rust
pub fn find_pools_for_lang_pair(&self, src_lang: &str, tgt_lang: &str) -> Vec<u16> {
    // 如果是 "auto"，查找包含目标语言的 Pool
    if normalized_src == "auto" {
        let mut result = Vec::new();
        for (set_key, pools) in &self.by_language_set {
            if set_key.contains(&normalized_tgt) {
                result.extend_from_slice(pools);
            }
        }
        return result;
    }

    // 直接按排序后的语言集合查找
    let mut langs = vec![normalized_src.clone(), normalized_tgt.clone()];
    langs.sort();
    let set_key = langs.join("-");
    
    self.by_language_set
        .get(&set_key)
        .cloned()
        .unwrap_or_default()
}
```

## 使用示例

### 创建 Pool

```rust
// 节点支持 {zh, en}
// Pool 名称：排序后 → "en-zh"
let pool = Phase3PoolConfig {
    pool_id: 1,
    name: "en-zh".to_string(),
    language_requirements: Some(PoolLanguageRequirements {
        semantic_languages: Some(vec!["zh".to_string(), "en".to_string()]),
        // ...
    }),
    // ...
};
```

### 查找 Pool

```rust
// 查找 "zh-en" → 排序后 → "en-zh" → 直接查找
let pools = index.find_pools_for_lang_pair("zh", "en");
// 结果：找到 pool_id=1

// 查找 "en-zh" → 排序后 → "en-zh" → 直接查找
let pools = index.find_pools_for_lang_pair("en", "zh");
// 结果：找到 pool_id=1（同一个 Pool）
```

## 优势总结

1. **代码简洁**：只需维护一个索引，查找逻辑直接
2. **与命名规则一致**：查找逻辑与 Pool 命名规则完全一致
3. **不容易出错**：没有复杂的多级 fallback，逻辑清晰
4. **性能更好**：O(1) 查找，无需多级尝试

## 注意事项

1. **Pool 命名必须规范**：必须按字母顺序排序
2. **语言代码规范化**：查找时会自动规范化（小写、去空格）
3. **"auto" 模式**：需要遍历所有语言集合，查找包含目标语言的 Pool

## 相关文件

- `central_server/scheduler/src/node_registry/pool_language_index.rs` - 索引实现
- `central_server/scheduler/src/node_registry/selection/pool_selection.rs` - Pool 选择逻辑
- `central_server/scheduler/src/node_registry/auto_language_pool.rs` - Pool 生成逻辑
