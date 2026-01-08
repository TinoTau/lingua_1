# 语言集合 Pool 实现总结

## 实现完成情况

### ✅ 已完成

1. **修改 Pool 生成逻辑**：从语言对改为语言集合
   - 文件：`central_server/scheduler/src/node_registry/auto_language_pool.rs`
   - 方法：`auto_generate_language_pair_pools`（保留名称，但逻辑已改为语言集合）
   - 新增方法：
     - `collect_language_sets`: 收集所有节点的语言集合（基于 semantic_langs）
     - `count_nodes_with_language_set`: 统计支持指定语言集合的节点数

2. **修改节点分配逻辑**：根据语言集合匹配 Pool
   - 文件：`central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`
   - 方法：`determine_pools_for_node_auto_mode_with_index`
   - 逻辑：获取节点的语义修复服务支持的语言集合，排序后匹配 Pool 名称

3. **修改任务分配逻辑**：搜索所有包含源语言和目标语言的 Pool
   - 文件：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`
   - 逻辑：不再只搜索精确匹配的 Pool（如 `zh-en`），而是搜索所有包含 `zh` 和 `en` 的 Pool（如 `en-zh`, `de-en-zh`）

4. **修改注册逻辑**：直接根据节点的语言集合创建 Pool
   - 文件：`central_server/scheduler/src/node_registry/phase3_pool.rs`
   - 方法：`try_create_pool_for_node`
   - 逻辑：基于节点的语义修复服务支持的语言集合创建 Pool，不再基于语言对
   - 文件：`central_server/scheduler/src/node_registry/core.rs`
   - 修改：移除了全量重建逻辑，直接为节点创建 Pool

### ⏳ 待完成

1. **更新相关测试用例**：需要更新测试以适配新的语言集合 Pool 设计
   - 文件：`central_server/scheduler/src/node_registry/auto_language_pool_test.rs`
   - 文件：`central_server/scheduler/src/node_registry/phase3_pool_allocation_test.rs`
   - 文件：`central_server/scheduler/src/node_registry/phase3_pool_redis_test.rs`

---

## 设计变更总结

### Pool 命名规则

**之前（语言对）**：
- `zh-en`: 支持中文到英文的翻译
- `en-zh`: 支持英文到中文的翻译
- 节点支持 `{zh, en}` → 生成 2 个 Pool

**现在（语言集合）**：
- `en-zh`: 支持中文和英文的任意组合（排序后）
- 节点支持 `{zh, en}` → 生成 1 个 Pool `en-zh`
- 节点支持 `{zh, en, de}` → 生成 1 个 Pool `de-en-zh`

### 节点分配规则

**之前**：
- 一个节点可以属于多个 Pool（支持多个语言对）
- 例如：节点支持 `{zh, en}` → 属于 `zh-en` 和 `en-zh` 两个 Pool

**现在**：
- 一个节点只属于一个 Pool（基于其语言集合）
- 例如：节点支持 `{zh, en}` → 只属于 `en-zh` Pool

### 任务分配规则

**之前**：
- 任务需要 `zh→en` → 只搜索 `zh-en` Pool

**现在**：
- 任务需要 `zh→en` → 搜索所有包含 `zh` 和 `en` 的 Pool
- 例如：`en-zh`（中英池）、`de-en-zh`（中英德池）都可以匹配

---

## 代码变更详情

### 1. Pool 生成逻辑

```rust
// 之前：收集语言对
let language_pairs = self.collect_language_pairs(auto_cfg).await;

// 现在：收集语言集合
let language_sets = self.collect_language_sets(&auto_cfg).await;
```

### 2. 节点分配逻辑

```rust
// 之前：遍历所有 Pool，检查语言对匹配
if pool.name == format!("{}-{}", src, tgt) { ... }

// 现在：获取节点的语言集合，排序后匹配 Pool 名称
let mut sorted_langs: Vec<String> = semantic_langs.into_iter().collect();
sorted_langs.sort();
let pool_name = sorted_langs.join("-");
if pool.name == pool_name { ... }
```

### 3. 任务分配逻辑

```rust
// 之前：只搜索精确匹配的 Pool
let pool_name = format!("{}-{}", src_lang, tgt_lang);
let matching_pool = cfg.pools.iter().find(|p| p.name == pool_name);

// 现在：搜索所有包含源语言和目标语言的 Pool
let eligible_pools: Vec<u16> = cfg.pools.iter()
    .filter(|p| {
        let pool_langs: HashSet<&str> = p.name.split('-').collect();
        pool_langs.contains(src_lang.as_str()) && pool_langs.contains(tgt_lang.as_str())
    })
    .map(|p| p.pool_id)
    .collect();
```

### 4. 注册逻辑

```rust
// 之前：基于语言对创建 Pool
let node_pairs = ...;
let pool_name = format!("{}-{}", src, tgt);

// 现在：基于语言集合创建 Pool
let semantic_langs: HashSet<String> = ...;
let mut sorted_langs: Vec<String> = semantic_langs.into_iter().collect();
sorted_langs.sort();
let pool_name = sorted_langs.join("-");
```

---

## 优势

1. **Pool 数量大幅减少**：从 N*(N-1) 降到 1（N 种语言）
2. **更符合实际场景**：用户选择的是语言集合，不是语言对
3. **任务分配更灵活**：可以充分利用所有可用节点
4. **注册逻辑更简单**：不需要全量重建，直接创建 Pool

---

## 注意事项

1. **向后兼容**：保留了 `auto_generate_language_pair_pools` 方法名，但逻辑已改为语言集合
2. **测试用例**：需要更新测试以适配新的设计
3. **Pool 清理**：如果 Pool 的节点数为 0，应该删除该 Pool（现有逻辑已支持）

---

## 下一步

1. 更新测试用例
2. 运行集成测试验证功能
3. 更新文档说明新的 Pool 设计
