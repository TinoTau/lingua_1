# 混合 Pool 架构设计文档

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-06
- **目的**: 记录混合 Pool 架构的设计和实现（精确池 + 混合池）
- **状态**: 已实现

---

## 一、设计概述

### 1.1 核心思想

混合 Pool 架构同时支持两种类型的 Pool：

1. **精确池（一对一语言对 Pool）**：用于已知源语言和目标语言的场景
   - 命名格式：`{src_lang}-{tgt_lang}`（如 `zh-en`）
   - 使用场景：面对面模式，用户选定了源语言和目标语言

2. **混合池（多对一 Pool）**：用于 `src_lang = "auto"` 场景
   - 命名格式：`*-{tgt_lang}`（如 `*-en`）
   - 使用场景：支持 ASR 多语言自动识别，充分利用 ASR 模型能力

### 1.2 设计目标

- ✅ **充分利用 ASR 能力**：混合池支持多语言自动识别，不浪费 ASR 模型的多语言能力
- ✅ **精确匹配**：精确池提供精确的语言对匹配，适合已知语言的场景
- ✅ **灵活选择**：根据任务需求自动选择使用精确池或混合池
- ✅ **向后兼容**：保留原有的一对一 Pool 机制，不影响现有功能

---

## 二、架构设计

### 2.1 Pool 生成逻辑

#### 2.1.1 精确池生成

```rust
// 生成精确池（一对一语言对 Pool）
async fn generate_precise_pools(...) -> Vec<Phase3PoolConfig> {
    // 1. 收集所有节点的语言对
    // 2. 统计每个语言对的节点数
    // 3. 过滤：只保留节点数 >= min_nodes_per_pool 的语言对
    // 4. 按节点数降序排序
    // 5. 限制：最多 max_pools 个精确池
    // 6. 生成精确池配置
    //    - 命名：{src_lang}-{tgt_lang}
    //    - ASR 语言：限制为 src_lang
    //    - TTS 语言：限制为 tgt_lang
    //    - NMT 规则：specific_pairs
}
```

#### 2.1.2 混合池生成

```rust
// 生成混合池（多对一 Pool）
async fn generate_mixed_pools(...) -> Vec<Phase3PoolConfig> {
    // 1. 收集所有支持的目标语言
    // 2. 统计每个目标语言的节点数
    // 3. 过滤：只保留节点数 >= min_nodes_per_pool 的目标语言
    // 4. 按节点数降序排序
    // 5. 生成混合池配置
    //    - 命名：*-{tgt_lang}
    //    - ASR 语言：不限制（支持多语言自动识别）
    //    - TTS 语言：限制为 tgt_lang
    //    - NMT 规则：any_to_any（由节点端验证具体语言对）
}
```

### 2.2 Pool 选择逻辑

#### 2.2.1 任务分配时的 Pool 选择

```rust
// 在 selection_phase3.rs 中
if src_lang == "auto" {
    // 使用混合池（多对一）
    // 选择所有以 *-tgt_lang 格式命名的混合池
    let eligible_pools = pools.filter(|p| p.name == format!("*-{}", tgt_lang));
} else {
    // 使用精确池（一对一）
    // 选择精确匹配的语言对 Pool
    let eligible_pools = pools.filter(|p| p.name == format!("{}-{}", src_lang, tgt_lang));
}
```

### 2.3 节点分配逻辑

#### 2.3.1 精确池的节点分配

```rust
// 精确池：检查节点是否支持特定的语言对
if asr_langs.contains(&src_lang) && tts_langs.contains(&tgt_lang) {
    // 检查 NMT 是否支持该语言对
    if nmt_supports(src_lang, tgt_lang) {
        return Some(pool_id);
    }
}
```

#### 2.3.2 混合池的节点分配

```rust
// 混合池：检查节点是否支持目标语言（不限制源语言）
if tts_langs.contains(&tgt_lang) {
    // 检查 NMT 是否支持任意源语言到该目标语言
    // 混合池不限制 ASR 语言（支持多语言自动识别）
    if nmt_supports_any_to_tgt(tgt_lang) {
        return Some(pool_id);
    }
}
```

---

## 三、配置结构

### 3.1 AutoLanguagePoolConfig

```rust
pub struct AutoLanguagePoolConfig {
    /// 最小节点数：如果某个语言对的节点数少于这个值，不创建 Pool
    pub min_nodes_per_pool: usize,  // 默认：1
    
    /// 最大 Pool 数量：如果超过这个值，只创建节点数最多的前 N 个 Pool（仅用于精确池）
    pub max_pools: usize,  // 默认：50
    
    /// Pool 命名规则
    pub pool_naming: String,  // 默认："pair"
    
    /// 是否包含语义修复服务（SEMANTIC）
    pub require_semantic: bool,  // 默认：true
    
    /// 是否启用混合池（多对一 Pool）：用于支持 src_lang = "auto" 场景
    pub enable_mixed_pools: bool,  // 默认：true
}
```

---

## 四、使用场景

### 4.1 精确池使用场景

**场景**：面对面模式，用户选定了源语言和目标语言

```
用户选择：
  - 源语言：中文（zh）
  - 目标语言：英文（en）

调度服务器：
  - 选择精确池：zh-en
  - 分配节点：只选择支持 zh→en 的节点
```

### 4.2 混合池使用场景

**场景**：`src_lang = "auto"`，需要 ASR 自动识别源语言

```
任务请求：
  - 源语言：auto（自动识别）
  - 目标语言：英文（en）

调度服务器：
  - 选择混合池：*-en
  - 分配节点：选择支持任意源语言→en 的节点
  - ASR 自动识别源语言，充分利用 ASR 模型的多语言能力
```

---

## 五、实现细节

### 5.1 Pool 命名规则

| Pool 类型 | 命名格式 | 示例 | 说明 |
|---------|---------|------|------|
| 精确池 | `{src_lang}-{tgt_lang}` | `zh-en` | 一对一语言对 |
| 混合池 | `*-{tgt_lang}` | `*-en` | 多对一，支持任意源语言 |

### 5.2 语言能力要求

#### 精确池的语言能力要求

```rust
PoolLanguageRequirements {
    asr_languages: Some(vec![src_lang]),      // 限制为特定源语言
    tts_languages: Some(vec![tgt_lang]),     // 限制为特定目标语言
    nmt_requirements: Some(PoolNmtRequirements {
        rule: "specific_pairs",               // 特定语言对
        supported_pairs: Some(vec![(src, tgt)]),
    }),
}
```

#### 混合池的语言能力要求

```rust
PoolLanguageRequirements {
    asr_languages: None,                      // 不限制（支持多语言自动识别）
    tts_languages: Some(vec![tgt_lang]),     // 限制为特定目标语言
    nmt_requirements: Some(PoolNmtRequirements {
        rule: "any_to_any",                   // 任意到任意（由节点端验证）
        supported_pairs: None,                // 不限制具体语言对
    }),
}
```

### 5.3 节点匹配逻辑

#### 精确池节点匹配

```rust
// 检查节点是否支持特定的语言对
fn matches_precise_pool(node: &Node, pool: &Pool) -> bool {
    let (src, tgt) = parse_pool_name(pool.name);  // "zh-en" -> ("zh", "en")
    
    node.asr_languages.contains(&src) &&
    node.tts_languages.contains(&tgt) &&
    node.nmt_supports(src, tgt)
}
```

#### 混合池节点匹配

```rust
// 检查节点是否支持目标语言（不限制源语言）
fn matches_mixed_pool(node: &Node, pool: &Pool) -> bool {
    let tgt = parse_mixed_pool_name(pool.name);  // "*-en" -> "en"
    
    node.tts_languages.contains(&tgt) &&
    node.nmt_supports_any_to(tgt)  // 支持任意源语言到目标语言
}
```

---

## 六、创建与销毁规则

### 6.1 创建规则

#### 精确池创建规则

1. **节点数过滤**：只保留节点数 >= `min_nodes_per_pool` 的语言对
2. **排序规则**：按节点数降序排序，优先创建节点数多的 Pool
3. **数量限制**：最多创建 `max_pools` 个精确池（默认 50 个）

**数量限制的目的**：
- **防止 Pool 数量过多**：14 种语言可能生成 14×13 = 182 个语言对，如果全部创建会导致 Pool 数量庞大，增加管理复杂度
- **只保留最常用的语言对**：通过限制数量，确保只创建最有价值的 Pool

**按节点数降序排序的目的**：
- **优先保留节点数多的语言对**：节点数多的 Pool 更稳定、更常用，有更好的可用性和负载均衡能力
- **避免创建不稳定的 Pool**：节点数少的 Pool 可能因为节点离线而变空，优先保留节点数多的 Pool 可以确保稳定性
- **资源优化**：确保有限的 Pool 数量分配给最有价值的语言对

#### 混合池创建规则

1. **节点数过滤**：只保留节点数 >= `min_nodes_per_pool` 的目标语言
2. **数量限制**：**无限制**（为所有满足条件的目标语言创建混合池）
3. **排序规则**：按节点数降序排序

**注意**：混合池目前没有 `max_pools` 限制，这是与精确池的一个差异。如果需要限制混合池数量，可以添加配置项。

### 6.2 销毁规则

混合池和精确池使用**完全相同的销毁规则**：

1. **全量重建**：通过 `rebuild_auto_language_pools` 全量重建所有 Pool（包括精确池和混合池）
2. **定期清理**：通过 `start_pool_cleanup_task` 定期检查空 Pool（每60秒扫描一次）
3. **节点离线**：节点离线时从 Pool 索引中移除，但不立即重建 Pool（由定期清理任务处理）

### 6.3 触发重建的场景

1. **节点注册**：如果启用自动生成且 pools 为空，节点注册时会触发重建
2. **节点离线**：节点离线后，如果检测到空 Pool，会在下次定期清理时触发重建
3. **定期清理**：每60秒扫描一次，如果发现空 Pool，立即触发重建
4. **配置更新**：如果启用自动生成且 pools 为空，配置更新时会触发重建

---

## 七、优势与限制

### 7.1 优势

1. **充分利用 ASR 能力**：混合池支持多语言自动识别，不浪费 ASR 模型的多语言能力
2. **精确匹配**：精确池提供精确的语言对匹配，适合已知语言的场景
3. **灵活选择**：根据任务需求自动选择使用精确池或混合池
4. **向后兼容**：保留原有的一对一 Pool 机制，不影响现有功能
5. **统一的销毁规则**：混合池和精确池使用相同的销毁规则，简化管理

### 7.2 限制

1. **Pool 数量增加**：同时生成精确池和混合池，Pool 数量会增加
2. **节点分配复杂度**：需要区分精确池和混合池的节点匹配逻辑
3. **配置复杂度**：需要配置 `enable_mixed_pools` 来控制是否启用混合池
4. **混合池数量无限制**：混合池没有 `max_pools` 限制，可能生成较多 Pool（但通常目标语言数量有限）

---

## 七、测试建议

### 7.1 精确池测试

1. **测试场景**：用户选定了源语言和目标语言
2. **验证点**：
   - 精确池是否正确生成
   - 节点是否正确分配到精确池
   - 任务是否正确分配到精确池的节点

### 7.2 混合池测试

1. **测试场景**：`src_lang = "auto"`，需要 ASR 自动识别源语言
2. **验证点**：
   - 混合池是否正确生成
   - 节点是否正确分配到混合池
   - 任务是否正确分配到混合池的节点
   - ASR 是否能够自动识别源语言

### 7.3 混合场景测试

1. **测试场景**：同时存在精确池和混合池
2. **验证点**：
   - 精确池和混合池是否都能正常工作
   - 任务分配是否正确选择 Pool 类型
   - 节点分配是否正确匹配 Pool 类型

---

## 八、未来改进方向

1. **动态 Pool 选择**：根据任务历史动态选择使用精确池或混合池
2. **Pool 合并**：合并相似的精确池和混合池，减少 Pool 数量
3. **性能优化**：优化节点匹配逻辑，提高分配效率

---

## 九、总结

混合 Pool 架构通过同时支持精确池和混合池，既保留了精确匹配的优势，又充分利用了 ASR 模型的多语言自动识别能力。这种设计在保持向后兼容的同时，提供了更灵活的任务分配机制。
