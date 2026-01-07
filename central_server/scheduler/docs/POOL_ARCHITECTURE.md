# Pool 架构设计文档

## 文档信息

- **版本**: v2.0
- **日期**: 2026-01-06
- **目的**: 记录 Pool 架构的完整设计（精确池 + 混合池）
- **状态**: 已实现

---

## 一、架构概述

### 1.1 设计目标

Pool 机制用于优化节点选择，支持两种类型的 Pool：

1. **精确池（一对一语言对 Pool）**：用于已知源语言和目标语言的场景
   - 命名格式：`{src_lang}-{tgt_lang}`（如 `zh-en`）
   - 使用场景：面对面模式，用户选定了源语言和目标语言

2. **混合池（多对一 Pool）**：用于 `src_lang = "auto"` 场景
   - 命名格式：`*-{tgt_lang}`（如 `*-en`）
   - 使用场景：支持 ASR 多语言自动识别，充分利用 ASR 模型能力

### 1.2 核心优势

- ✅ **充分利用 ASR 能力**：混合池支持多语言自动识别，不浪费 ASR 模型的多语言能力
- ✅ **精确匹配**：精确池提供精确的语言对匹配，适合已知语言的场景
- ✅ **灵活选择**：根据任务需求自动选择使用精确池或混合池
- ✅ **向后兼容**：保留原有的一对一 Pool 机制，不影响现有功能

---

## 二、Pool 生成逻辑

### 2.1 精确池生成

**生成步骤**：

1. **收集语言对**：遍历所有节点，收集每个节点支持的语言对
2. **统计节点数**：统计每个语言对的节点数
3. **过滤**：只保留节点数 >= `min_nodes_per_pool` 的语言对
4. **排序**：按节点数降序排序，优先创建节点数多的 Pool
5. **限制数量**：最多创建 `max_pools` 个精确池（默认 50 个）
6. **生成配置**：为每个语言对创建 Pool 配置

**数量限制的目的**：
- **防止 Pool 数量过多**：14 种语言可能生成 14×13 = 182 个语言对
- **只保留最常用的语言对**：通过限制数量，确保只创建最有价值的 Pool
- **优先保留节点数多的语言对**：节点数多的 Pool 更稳定、更常用

### 2.2 混合池生成

**生成步骤**：

1. **收集目标语言**：遍历所有节点，收集每个目标语言的节点
2. **统计节点数**：统计每个目标语言的节点数
3. **过滤**：只保留节点数 >= `min_nodes_per_pool` 的目标语言
4. **排序**：按节点数降序排序
5. **生成配置**：为每个目标语言创建混合池配置（**无数量限制**）

**注意**：混合池目前没有 `max_pools` 限制，为所有满足条件的目标语言创建混合池。

---

## 三、Pool 选择逻辑

### 3.1 任务分配时的 Pool 选择

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

### 3.2 节点分配逻辑

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

## 四、配置结构

### 4.1 AutoLanguagePoolConfig

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

### 4.2 语言能力要求

**重要说明**：节点端的语言可用性以语义修复服务的能力为准。只有源语言和目标语言都在语义修复服务支持的语言列表中的语言对才会被纳入 Pool。

**原因**：根据实际测试，没有语义修复服务时，语音识别结果非常糟糕。因此，系统要求节点必须同时具备语义修复服务，且语义修复服务必须支持源语言和目标语言，才能提供该语言对的服务。

#### 精确池的语言能力要求

```rust
PoolLanguageRequirements {
    asr_languages: Some(vec![src_lang]),      // 限制为特定源语言
    tts_languages: Some(vec![tgt_lang]),     // 限制为特定目标语言
    nmt_requirements: Some(PoolNmtRequirements {
        rule: "specific_pairs",               // 特定语言对
        supported_pairs: Some(vec![(src, tgt)]),
    }),
    semantic_languages: None,                  // 语义修复语言由节点端决定
}
```

**节点匹配规则**：
- 源语言必须在节点的语义修复服务支持的语言列表中
- 目标语言必须在节点的语义修复服务支持的语言列表中
- 同时满足 ASR、TTS、NMT 的语言要求

#### 混合池的语言能力要求

```rust
PoolLanguageRequirements {
    asr_languages: None,                      // 不限制（支持多语言自动识别）
    tts_languages: Some(vec![tgt_lang]),     // 限制为特定目标语言
    nmt_requirements: Some(PoolNmtRequirements {
        rule: "any_to_any",                   // 任意到任意（由节点端验证）
        supported_pairs: None,                // 不限制具体语言对
    }),
    semantic_languages: None,                  // 语义修复语言由节点端决定
}
```

**节点匹配规则**：
- 目标语言必须在节点的语义修复服务支持的语言列表中
- 源语言必须在节点的语义修复服务支持的语言列表中（由 NMT 规则决定）
- 同时满足 TTS、NMT 的语言要求

---

## 五、使用场景

### 5.1 精确池使用场景

**场景**：面对面模式，用户选定了源语言和目标语言

```
用户选择：
  - 源语言：中文（zh）
  - 目标语言：英文（en）

调度服务器：
  - 选择精确池：zh-en
  - 分配节点：只选择支持 zh→en 的节点
```

### 5.2 混合池使用场景

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

## 六、创建与销毁规则

### 6.1 创建规则

#### 精确池创建规则

1. **节点数过滤**：只保留节点数 >= `min_nodes_per_pool` 的语言对
2. **排序规则**：按节点数降序排序，优先创建节点数多的 Pool
3. **数量限制**：最多创建 `max_pools` 个精确池（默认 50 个）

#### 混合池创建规则

1. **节点数过滤**：只保留节点数 >= `min_nodes_per_pool` 的目标语言
2. **数量限制**：**无限制**（为所有满足条件的目标语言创建混合池）
3. **排序规则**：按节点数降序排序

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

### 6.4 动态 Pool 创建机制

**重要**：当节点通过心跳更新语言能力时，如果节点支持的语言对不在现有 Pool 中，系统会动态创建新的 Pool。

**流程**：

1. **节点心跳更新**：
   - 节点通过心跳上报新的语言能力（包括语义修复服务的语言能力）
   - 调度服务器更新节点的语言能力索引

2. **Pool 匹配检查**：
   - 尝试将节点匹配到现有 Pool
   - 如果匹配成功，将节点移动到对应的 Pool（从旧 Pool 移除，添加到新 Pool）

3. **动态创建 Pool**（如果节点未匹配到任何现有 Pool）：
   - 检查节点支持的语言对（基于语义修复服务的语言能力）
   - 如果语言对不在现有 Pool 中，创建新的精确池（`{src_lang}-{tgt_lang}`）
   - 检查是否超过 `max_pools` 限制（仅精确池）
   - 将新 Pool 添加到本地配置（Redis 同步由定期清理任务或全量重建时处理）
   - 将节点添加到新创建的 Pool

4. **旧 Pool 清理**：
   - 节点从旧 Pool 中移除（如果不再匹配）
   - 如果旧 Pool 变空，由定期清理任务（每60秒）检测并销毁

**优势**：
- ✅ **实时响应**：节点语言能力变化时立即创建新 Pool，无需等待定期清理
- ✅ **自动管理**：无需手动配置，系统自动根据节点能力创建 Pool
- ✅ **资源优化**：空 Pool 由定期清理任务统一处理，避免频繁重建
- ✅ **语义修复服务驱动**：只有语义修复服务支持的语言对才会创建 Pool

**日志记录**：
- 节点未匹配到现有 Pool 时，记录 `info` 级别日志
- 成功创建新 Pool 时，记录 `info` 级别日志，包含 `node_id`、`pool_id`、`pool_name` 等信息
- 达到 `max_pools` 限制时，记录 `warn` 级别日志

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

## 八、Pool 命名规则

| Pool 类型 | 命名格式 | 示例 | 说明 |
|---------|---------|------|------|
| 精确池 | `{src_lang}-{tgt_lang}` | `zh-en` | 一对一语言对 |
| 混合池 | `*-{tgt_lang}` | `*-en` | 多对一，支持任意源语言 |

---

## 九、配置示例

```toml
[phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true

[phase3.auto_pool_config]
min_nodes_per_pool = 1
max_pools = 50
require_semantic = true
enable_mixed_pools = true
pool_naming = "pair"
```

---

## 十、代码位置

- **Pool 生成逻辑**：`central_server/scheduler/src/node_registry/auto_language_pool.rs`
- **Pool 选择逻辑**：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`
- **节点分配逻辑**：`central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`
- **配置结构**：`central_server/scheduler/src/core/config/config_types.rs`

---

**最后更新**: 2026-01-06
