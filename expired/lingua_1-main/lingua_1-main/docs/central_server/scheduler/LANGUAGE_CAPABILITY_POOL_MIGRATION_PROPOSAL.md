# 语言能力池迁移方案

## 文档信息

- **版本**: v1.0
- **日期**: 2025-01-XX
- **目的**: 分析语言能力功能与节点池的关系，设计将节点池改为语言能力池的方案

---

## 一、现状分析

### 1.1 当前节点池（Phase 3 Pool）机制

**Pool 分配逻辑**：
- **Hash 分桶模式**：基于 `node_id` 的 hash 值分配到 `0..pool_count` 的池中
- **Capability Pool 模式**：基于节点的 `required_services`（ServiceType）匹配配置的 pool

**Pool 匹配逻辑**（`selection_phase3.rs`）：
```rust
// 当前只基于 ServiceType 匹配
let required_for_pool: Vec<ServiceType> = match cfg.pool_match_scope.as_str() {
    "all_required" => required_types.to_vec(),  // ASR, NMT, TTS
    "core_only" => /* 只考虑核心服务 */,
};

// Pool 配置中的 required_services 只包含 ServiceType
// 例如：["asr", "nmt", "tts"]
```

**节点分配逻辑**（`phase3_pool.rs`）：
```rust
// 根据节点的 installed_services 匹配 pool
determine_pool_for_node(&cfg, node)
```

---

### 1.2 语言能力功能

**当前实现**：
- 节点选择时进行语言过滤（在 `selection_types.rs` 中）
- **但 Pool 选择时没有考虑语言能力**
- 导致：Pool 选择基于 ServiceType，但实际节点选择时可能因为语言不匹配而失败

**问题场景**：
```
Pool A: required_services = ["asr", "nmt", "tts"]
  - 节点1: 支持 zh→en（ASR+NMT+TTS）
  - 节点2: 支持 ja→ko（ASR+NMT+TTS）

请求：zh→en
  → Pool A 被选中（因为 required_services 匹配）
  → 但 Pool A 中只有节点1支持 zh→en
  → 如果节点1不可用，即使 Pool A 有节点2，也无法处理该请求
```

---

### 1.3 冲突分析

**是否冲突？**
- ✅ **不完全冲突**：语言能力功能是**在节点选择阶段**进行过滤，不影响 Pool 选择
- ⚠️ **效率问题**：Pool 选择时没有考虑语言，可能导致：
  1. 选中了错误的 Pool（该 Pool 中没有节点支持目标语言）
  2. 需要 fallback 到其他 Pool，增加延迟
  3. Pool 内节点选择失败率较高

**结论**：
- 当前实现**可以工作**，但**不够高效**
- 如果改为**语言能力池**，可以：
  - 提前在 Pool 选择阶段就过滤掉不支持目标语言的 Pool
  - 减少无效的节点选择尝试
  - 提高调度效率

---

## 二、语言能力池设计方案

### 2.1 设计目标

1. **Pool 配置支持语言能力要求**
2. **节点分配 Pool 时考虑语言能力**
3. **Pool 选择时考虑语言匹配**
4. **向后兼容**：支持现有的 ServiceType 模式

---

### 2.2 Pool 配置扩展

#### 当前配置结构

```rust
pub struct Phase3Config {
    pub enabled: bool,
    pub mode: String,  // "two_level"
    pub pool_count: u16,
    pub hash_seed: u32,
    pub pools: Vec<PoolConfig>,  // 如果为空，使用 hash 分桶
    pub pool_match_scope: String,  // "core_only" | "all_required"
    pub pool_match_mode: String,   // "exact" | "contains"
}

pub struct PoolConfig {
    pub pool_id: u16,
    pub required_services: Vec<String>,  // ["asr", "nmt", "tts"]
}
```

#### 扩展后的配置结构

```rust
pub struct Phase3Config {
    pub enabled: bool,
    pub mode: String,
    pub pool_count: u16,
    pub hash_seed: u32,
    pub pools: Vec<PoolConfig>,
    pub pool_match_scope: String,
    pub pool_match_mode: String,
    // 新增：语言能力匹配模式
    pub language_match_enabled: bool,  // 是否启用语言能力匹配
}

pub struct PoolConfig {
    pub pool_id: u16,
    pub required_services: Vec<String>,  // 保留：ServiceType 匹配
    
    // 新增：语言能力要求
    pub language_requirements: Option<PoolLanguageRequirements>,
}

pub struct PoolLanguageRequirements {
    /// ASR 语言要求（如果任务需要 ASR）
    pub asr_languages: Option<Vec<String>>,  // 例如：["zh", "en", "ja"]
    
    /// TTS 语言要求（如果任务需要 TTS）
    pub tts_languages: Option<Vec<String>>,  // 例如：["zh", "en"]
    
    /// NMT 语言对要求（如果任务需要 NMT）
    pub nmt_requirements: Option<PoolNmtRequirements>,
}

pub struct PoolNmtRequirements {
    /// 支持的语言列表
    pub languages: Vec<String>,
    
    /// 翻译规则
    pub rule: String,  // "any_to_any" | "any_to_en" | "en_to_any" | "specific_pairs"
    
    /// 明确支持的语言对（当 rule = "specific_pairs" 时）
    pub supported_pairs: Option<Vec<LanguagePair>>,
    
    /// 被阻止的语言对（当 rule = "any_to_any" 时）
    pub blocked_pairs: Option<Vec<LanguagePair>>,
}
```

#### 配置示例

**示例1：中英文专用池**
```json
{
  "pool_id": 1,
  "required_services": ["asr", "nmt", "tts"],
  "language_requirements": {
    "asr_languages": ["zh", "en"],
    "tts_languages": ["zh", "en"],
    "nmt_requirements": {
      "languages": ["zh", "en"],
      "rule": "any_to_any"
    }
  }
}
```

**示例2：多语言池（M2M100）**
```json
{
  "pool_id": 2,
  "required_services": ["asr", "nmt", "tts"],
  "language_requirements": {
    "asr_languages": ["zh", "en", "ja", "ko", "fr", "de"],
    "tts_languages": ["zh", "en", "ja", "ko"],
    "nmt_requirements": {
      "languages": ["zh", "en", "ja", "ko", "fr", "de", "es", "it"],
      "rule": "any_to_any"
    }
  }
}
```

**示例3：仅英文池**
```json
{
  "pool_id": 3,
  "required_services": ["asr", "nmt", "tts"],
  "language_requirements": {
    "asr_languages": ["en"],
    "tts_languages": ["en"],
    "nmt_requirements": {
      "languages": ["en"],
      "rule": "any_to_any"  // 实际上只支持 en→en（无意义），但可以用于英文单语任务
    }
  }
}
```

---

### 2.3 节点分配 Pool 逻辑改造

#### 当前逻辑（`phase3_pool.rs`）

```rust
fn determine_pool_for_node(cfg: &Phase3Config, node: &Node) -> Option<u16> {
    // 只基于 required_services 匹配
    for pool in &cfg.pools {
        if node_has_required_services(node, &pool.required_services) {
            return Some(pool.pool_id);
        }
    }
    None
}
```

#### 改造后的逻辑

```rust
fn determine_pool_for_node(
    cfg: &Phase3Config,
    node: &Node,
    language_index: &LanguageCapabilityIndex,  // 新增参数
) -> Option<u16> {
    for pool in &cfg.pools {
        // 步骤1：ServiceType 匹配（保留现有逻辑）
        if !node_has_required_services(node, &pool.required_services) {
            continue;
        }
        
        // 步骤2：语言能力匹配（新增）
        if cfg.language_match_enabled {
            if let Some(lang_req) = &pool.language_requirements {
                if !node_matches_language_requirements(node, lang_req, language_index) {
                    continue;
                }
            }
        }
        
        return Some(pool.pool_id);
    }
    None
}

fn node_matches_language_requirements(
    node: &Node,
    req: &PoolLanguageRequirements,
    language_index: &LanguageCapabilityIndex,
) -> bool {
    // 检查 ASR 语言
    if let Some(asr_langs) = &req.asr_languages {
        let node_asr_langs = language_index.get_node_asr_languages(&node.node_id);
        if !asr_langs.iter().any(|lang| node_asr_langs.contains(lang)) {
            return false;
        }
    }
    
    // 检查 TTS 语言
    if let Some(tts_langs) = &req.tts_languages {
        let node_tts_langs = language_index.get_node_tts_languages(&node.node_id);
        if !tts_langs.iter().any(|lang| node_tts_langs.contains(lang)) {
            return false;
        }
    }
    
    // 检查 NMT 能力
    if let Some(nmt_req) = &req.nmt_requirements {
        let node_nmt_caps = language_index.get_node_nmt_capabilities(&node.node_id);
        if !nmt_capabilities_match(&node_nmt_caps, nmt_req) {
            return false;
        }
    }
    
    true
}
```

**调用位置更新**：
```rust
// phase3_upsert_node_to_pool_index
pub(super) async fn phase3_upsert_node_to_pool_index(&self, node_id: &str) {
    let cfg = self.phase3.read().await.clone();
    if !cfg.enabled || cfg.mode != "two_level" {
        return;
    }
    
    let pid = if !cfg.pools.is_empty() {
        let nodes = self.nodes.read().await;
        let Some(n) = nodes.get(node_id) else { return };
        
        // 新增：传入 language_index
        let language_index = self.language_capability_index.read().await;
        determine_pool_for_node(&cfg, n, &language_index)
    } else {
        Some(crate::phase3::pool_id_for_key(cfg.pool_count, cfg.hash_seed, node_id))
    };
    
    self.phase3_set_node_pool(node_id, pid).await;
}
```

---

### 2.4 Pool 选择逻辑改造

#### 当前逻辑（`selection_phase3.rs`）

```rust
// 只基于 ServiceType 选择 Pool
let eligible: Vec<u16> = cfg.pools.iter()
    .filter(|p| {
        // 只检查 required_services
        required_for_pool.iter().all(|rid| {
            p.required_services.contains(rid)
        })
    })
    .map(|p| p.pool_id)
    .collect();
```

#### 改造后的逻辑

```rust
// 基于 ServiceType + 语言能力选择 Pool
let eligible: Vec<u16> = cfg.pools.iter()
    .filter(|p| {
        // 步骤1：ServiceType 匹配（保留）
        let service_match = required_for_pool.iter().all(|rid| {
            p.required_services.contains(rid)
        });
        if !service_match {
            return false;
        }
        
        // 步骤2：语言能力匹配（新增）
        if cfg.language_match_enabled {
            if let Some(lang_req) = &p.language_requirements {
                if !pool_matches_language_requirements(lang_req, src_lang, tgt_lang, required_types) {
                    return false;
                }
            }
        }
        
        true
    })
    .map(|p| p.pool_id)
    .collect();

fn pool_matches_language_requirements(
    req: &PoolLanguageRequirements,
    src_lang: &str,
    tgt_lang: &str,
    required_types: &[ServiceType],
) -> bool {
    // 检查 ASR 语言（如果任务需要 ASR）
    if required_types.contains(&ServiceType::Asr) && src_lang != "auto" {
        if let Some(asr_langs) = &req.asr_languages {
            if !asr_langs.contains(&normalize_language_code(src_lang)) {
                return false;
            }
        }
    }
    
    // 检查 TTS 语言（如果任务需要 TTS）
    if required_types.contains(&ServiceType::Tts) {
        if let Some(tts_langs) = &req.tts_languages {
            if !tts_langs.contains(&normalize_language_code(tgt_lang)) {
                return false;
            }
        }
    }
    
    // 检查 NMT 语言对（如果任务需要 NMT）
    if required_types.contains(&ServiceType::Nmt) {
        if let Some(nmt_req) = &req.nmt_requirements {
            if !nmt_requirement_matches(nmt_req, src_lang, tgt_lang) {
                return false;
            }
        }
    }
    
    true
}

fn nmt_requirement_matches(
    req: &PoolNmtRequirements,
    src_lang: &str,
    tgt_lang: &str,
) -> bool {
    let normalized_src = normalize_language_code(src_lang);
    let normalized_tgt = normalize_language_code(tgt_lang);
    
    match req.rule.as_str() {
        "any_to_any" => {
            req.languages.contains(&normalized_src) 
                && req.languages.contains(&normalized_tgt)
        }
        "any_to_en" => {
            req.languages.contains(&normalized_src) && normalized_tgt == "en"
        }
        "en_to_any" => {
            normalized_src == "en" && req.languages.contains(&normalized_tgt)
        }
        "specific_pairs" => {
            if let Some(pairs) = &req.supported_pairs {
                pairs.iter().any(|p| p.src == normalized_src && p.tgt == normalized_tgt)
            } else {
                false
            }
        }
        _ => false,
    }
}
```

---

### 2.5 LanguageCapabilityIndex 扩展

需要新增方法支持节点分配 Pool：

```rust
impl LanguageCapabilityIndex {
    // 新增：获取节点的 ASR 语言列表
    pub fn get_node_asr_languages(&self, node_id: &str) -> HashSet<String> {
        let mut result = HashSet::new();
        for (lang, nodes) in &self.by_asr_lang {
            if nodes.contains(node_id) {
                result.insert(lang.clone());
            }
        }
        result
    }
    
    // 新增：获取节点的 TTS 语言列表
    pub fn get_node_tts_languages(&self, node_id: &str) -> HashSet<String> {
        let mut result = HashSet::new();
        for (lang, nodes) in &self.by_tts_lang {
            if nodes.contains(node_id) {
                result.insert(lang.clone());
            }
        }
        result
    }
    
    // 新增：获取节点的 NMT 能力
    pub fn get_node_nmt_capabilities(&self, node_id: &str) -> Vec<&NmtNodeCapability> {
        self.nmt_nodes.iter()
            .filter(|n| n.node_id == node_id)
            .collect()
    }
}
```

---

## 三、实施步骤

### 步骤1：扩展配置结构
- [ ] 在 `Phase3Config` 中新增 `language_match_enabled` 字段
- [ ] 在 `PoolConfig` 中新增 `language_requirements` 字段
- [ ] 定义 `PoolLanguageRequirements` 和 `PoolNmtRequirements` 结构

### 步骤2：扩展 LanguageCapabilityIndex
- [ ] 新增 `get_node_asr_languages()` 方法
- [ ] 新增 `get_node_tts_languages()` 方法
- [ ] 新增 `get_node_nmt_capabilities()` 方法

### 步骤3：改造节点分配 Pool 逻辑
- [ ] 修改 `determine_pool_for_node()` 函数，增加语言能力匹配
- [ ] 更新 `phase3_upsert_node_to_pool_index()` 调用
- [ ] 更新 `rebuild_phase3_pool_index()` 调用

### 步骤4：改造 Pool 选择逻辑
- [ ] 修改 `select_node_with_types_two_level_excluding_with_breakdown()` 函数
- [ ] 新增 `pool_matches_language_requirements()` 辅助函数
- [ ] 新增 `nmt_requirement_matches()` 辅助函数

### 步骤5：测试与验证
- [ ] 单元测试：节点分配 Pool 逻辑
- [ ] 单元测试：Pool 选择逻辑
- [ ] 集成测试：端到端语言能力池调度
- [ ] 性能测试：对比改造前后的调度效率

---

## 四、向后兼容性

### 4.1 配置兼容

**默认行为**：
- `language_match_enabled = false`：保持现有行为（只基于 ServiceType）
- `language_requirements = None`：该 Pool 不进行语言匹配（兼容现有配置）

**迁移路径**：
1. 现有配置无需修改即可继续工作
2. 逐步为 Pool 添加 `language_requirements`
3. 启用 `language_match_enabled` 后，Pool 选择会更精确

### 4.2 代码兼容

- 所有新增字段均为 `Option`，向后兼容
- 如果 `language_match_enabled = false`，跳过语言匹配逻辑
- 如果 `language_requirements = None`，跳过该 Pool 的语言匹配

---

## 五、优势与收益

### 5.1 调度效率提升

**改造前**：
```
请求：zh→en
  → Pool A（ASR+NMT+TTS）被选中
  → Pool A 中有节点1（支持 zh→en）和节点2（支持 ja→ko）
  → 如果节点1不可用，需要 fallback 到其他 Pool
```

**改造后**：
```
请求：zh→en
  → Pool A（ASR+NMT+TTS + 支持 zh/en）被选中
  → Pool A 中所有节点都支持 zh→en
  → 节点选择成功率更高，减少 fallback
```

### 5.2 资源利用率提升

- **更精确的 Pool 划分**：节点按语言能力分配到合适的 Pool
- **减少无效尝试**：Pool 选择阶段就过滤掉不支持的 Pool
- **更好的负载均衡**：相同语言能力的节点在同一 Pool，负载更均匀

### 5.3 运维友好

- **清晰的 Pool 语义**：Pool 不仅表示服务类型，还表示语言能力
- **更容易排查问题**：Pool 选择失败时，可以明确知道是语言不匹配
- **更灵活的配置**：可以为不同语言对创建专用 Pool

---

## 六、配置示例

### 6.1 完整配置示例

```json
{
  "enabled": true,
  "mode": "two_level",
  "pool_count": 4,
  "hash_seed": 12345,
  "pool_match_scope": "core_only",
  "pool_match_mode": "contains",
  "language_match_enabled": true,
  "pools": [
    {
      "pool_id": 1,
      "required_services": ["asr", "nmt", "tts"],
      "language_requirements": {
        "asr_languages": ["zh", "en"],
        "tts_languages": ["zh", "en"],
        "nmt_requirements": {
          "languages": ["zh", "en"],
          "rule": "any_to_any"
        }
      }
    },
    {
      "pool_id": 2,
      "required_services": ["asr", "nmt", "tts"],
      "language_requirements": {
        "asr_languages": ["ja", "ko", "en"],
        "tts_languages": ["ja", "ko", "en"],
        "nmt_requirements": {
          "languages": ["ja", "ko", "en"],
          "rule": "any_to_any"
        }
      }
    },
    {
      "pool_id": 3,
      "required_services": ["asr", "nmt", "tts"],
      "language_requirements": {
        "asr_languages": ["zh", "en", "ja", "ko", "fr", "de"],
        "tts_languages": ["zh", "en", "ja", "ko"],
        "nmt_requirements": {
          "languages": ["zh", "en", "ja", "ko", "fr", "de", "es", "it"],
          "rule": "any_to_any"
        }
      }
    },
    {
      "pool_id": 4,
      "required_services": ["asr", "nmt", "tts"],
      "language_requirements": null  // 通配 Pool，支持所有语言
    }
  ]
}
```

---

## 七、总结

### 7.1 冲突分析结论

- ✅ **不完全冲突**：当前实现可以工作，但效率不高
- ⚠️ **存在优化空间**：Pool 选择时没有考虑语言，导致无效尝试

### 7.2 改造方案

- **扩展 Pool 配置**：支持语言能力要求
- **改造节点分配**：分配 Pool 时考虑语言能力
- **改造 Pool 选择**：选择 Pool 时考虑语言匹配
- **向后兼容**：所有新增字段为可选，不影响现有配置

### 7.3 实施建议

1. **分阶段实施**：
   - 第一阶段：扩展配置结构，但不启用语言匹配
   - 第二阶段：改造节点分配逻辑，测试节点分配正确性
   - 第三阶段：改造 Pool 选择逻辑，启用语言匹配

2. **灰度发布**：
   - 先为部分 Pool 添加语言要求
   - 观察调度效果和性能
   - 逐步扩展到所有 Pool

3. **监控指标**：
   - Pool 选择成功率
   - Pool 内节点选择成功率
   - Fallback 次数
   - 调度延迟

---

**该方案可以完全解决语言能力功能与节点池的冲突问题，并显著提升调度效率。**
