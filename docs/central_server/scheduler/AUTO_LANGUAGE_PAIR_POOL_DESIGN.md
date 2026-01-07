# 按语言对自动生成 Pool 设计方案

## 文档信息

- **版本**: v1.0
- **日期**: 2025-01-XX
- **目的**: 设计按语言对自动生成 Pool 的功能，Pool 命名使用语言对，只包含服务齐全的节点

---

## 一、设计目标

### 1.1 核心需求

1. **自动生成**：根据节点的语言能力自动生成 Pool
2. **语言对命名**：Pool 名称直接使用语言对（如 `zh-en`、`en-zh`）
3. **服务齐全**：Pool 中只包含 ASR + SEMANTIC + NMT + TTS 都齐全的节点
4. **动态更新**：节点上线/下线时自动更新 Pool
5. **一对一语言对**：每个 Pool 对应一个特定的语言对（如 `zh-en`），不支持多对一

### 1.2 设计约束

- **避免 Pool 爆炸**：虽然理论上可能有 N×N 个语言对，但实际节点支持的语言对是有限的
- **性能考虑**：Pool 数量增加时，选择逻辑的性能影响
- **向后兼容**：不影响现有的手动配置模式
- **一对一原则**：每个 Pool 只对应一个语言对，不支持多对一场景

---

## 二、架构设计

### 2.1 工作模式

**混合模式**：
- **手动配置模式**：`pools` 非空 → 使用手动配置的 Pool（现有逻辑）
- **自动生成模式**：`pools` 为空 + `auto_generate_language_pools = true` → 自动生成 Pool

**配置结构**：
```rust
pub struct Phase3Config {
    pub enabled: bool,
    pub mode: String,
    pub pool_count: u16,
    pub hash_seed: u32,
    
    // 手动配置的 pools（如果非空，使用手动模式）
    pub pools: Vec<Phase3PoolConfig>,
    
    // 新增：自动生成语言对 Pool 的配置
    #[serde(default)]
    pub auto_generate_language_pools: bool,
    
    // 新增：自动生成 Pool 的配置选项
    #[serde(default)]
    pub auto_pool_config: Option<AutoLanguagePoolConfig>,
    
    // ... 其他字段
}

pub struct AutoLanguagePoolConfig {
    /// 最小节点数：如果某个语言对的节点数少于这个值，不创建 Pool
    #[serde(default = "default_min_nodes_per_pool")]
    pub min_nodes_per_pool: usize,
    
    /// 最大 Pool 数量：如果超过这个值，只创建节点数最多的前 N 个 Pool
    #[serde(default = "default_max_pools")]
    pub max_pools: usize,
    
    /// Pool 命名规则
    /// - "pair": 使用语言对命名（如 "zh-en"）
    /// - "bidirectional": 双向语言对合并为一个 Pool（如 "zh-en" 包含 zh→en 和 en→zh）
    #[serde(default = "default_pool_naming")]
    pub pool_naming: String,  // "pair" | "bidirectional"
    
    /// 是否包含语义修复服务（SEMANTIC）
    #[serde(default = "default_true")]
    pub require_semantic: bool,
}
```

---

### 2.2 Pool 命名规则

**命名格式**：`{src_lang}-{tgt_lang}`

**示例**：
- `zh-en`：中文到英文的 Pool
- `en-zh`：英文到中文的 Pool
- `ja-ko`：日文到韩文的 Pool

**特点**：
- ✅ 语义清晰：每个 Pool 对应一个翻译方向
- ✅ 节点分配精确：节点只分配到支持该方向的 Pool
- ✅ 一对一映射：每个语言对对应一个 Pool
- ⚠️ Pool 数量：最多 N×N 个（但实际会少很多，因为节点支持的语言对有限）

---

### 2.3 节点分配逻辑

#### 服务齐全检查

**要求**：节点必须同时具备以下服务类型：
- ✅ ASR（语音识别）
- ✅ SEMANTIC（语义修复）
- ✅ NMT（机器翻译）
- ✅ TTS（语音合成）

**检查逻辑**：
```rust
fn node_has_all_required_services(node: &Node) -> bool {
    let required_types = vec![
        ServiceType::Asr,
        ServiceType::Semantic,
        ServiceType::Nmt,
        ServiceType::Tts,
    ];
    
    required_types.iter().all(|t| {
        node.capability_by_type_map
            .get(t)
            .copied()
            .unwrap_or(false)
    })
}
```

#### 语言对匹配

**匹配规则**：
1. 节点必须支持 `src_lang` 的 ASR
2. 节点必须支持 `tgt_lang` 的 TTS
3. 节点必须支持 `src_lang → tgt_lang` 的 NMT
4. 节点必须支持 `src_lang` 或 `tgt_lang` 的 SEMANTIC（至少一个）

**匹配逻辑**：
```rust
fn node_supports_language_pair(
    node: &Node,
    src_lang: &str,
    tgt_lang: &str,
    language_index: &LanguageCapabilityIndex,
) -> bool {
    // 1. 检查服务齐全
    if !node_has_all_required_services(node) {
        return false;
    }
    
    // 2. 检查 ASR 语言
    let asr_nodes = language_index.find_nodes_for_asr_lang(src_lang);
    if !asr_nodes.contains(&node.node_id) {
        return false;
    }
    
    // 3. 检查 TTS 语言
    let tts_nodes = language_index.find_nodes_for_tts_lang(tgt_lang);
    if !tts_nodes.contains(&node.node_id) {
        return false;
    }
    
    // 4. 检查 NMT 语言对
    let nmt_nodes = language_index.find_nodes_for_nmt_pair(src_lang, tgt_lang);
    if !nmt_nodes.contains(&node.node_id) {
        return false;
    }
    
    // 5. 检查 SEMANTIC（至少支持 src_lang 或 tgt_lang 之一）
    // 注意：SEMANTIC 不在 language_capabilities 中，需要从其他来源检查
    // 这里假设可以从节点的 installed_services 中检查
    let has_semantic = node.installed_services.iter()
        .any(|s| s.r#type == ServiceType::Semantic && s.status == ServiceStatus::Running);
    
    if !has_semantic {
        return false;
    }
    
    true
}
```

---

## 三、自动生成算法

### 3.1 核心算法

```rust
impl NodeRegistry {
    /// 自动生成语言对 Pool
    pub async fn auto_generate_language_pair_pools(&self) -> Vec<Phase3PoolConfig> {
        let nodes = self.nodes.read().await;
        let language_index = self.language_capability_index.read().await;
        let cfg = self.auto_pool_config.as_ref()
            .unwrap_or(&AutoLanguagePoolConfig::default());
        
        // 1. 收集所有支持的语言对
        let mut language_pairs: HashMap<(String, String), Vec<String>> = HashMap::new();
        // key: (src_lang, tgt_lang), value: 支持该语言对的节点 ID 列表
        
        for node in nodes.values() {
            // 只考虑服务齐全的节点
            if !node_has_all_required_services(node) {
                continue;
            }
            
            // 获取节点的语言能力
            if let Some(caps) = &node.language_capabilities {
                // 获取 ASR 语言
                let asr_langs: HashSet<String> = caps.asr_languages.as_ref()
                    .map(|v| v.iter().cloned().collect())
                    .unwrap_or_default();
                
                // 获取 TTS 语言
                let tts_langs: HashSet<String> = caps.tts_languages.as_ref()
                    .map(|v| v.iter().cloned().collect())
                    .unwrap_or_default();
                
                // 获取 NMT 能力
                if let Some(nmt_caps) = &caps.nmt_capabilities {
                    for nmt_cap in nmt_caps {
                        // 根据 NMT 规则生成语言对
                        let pairs = generate_language_pairs_from_nmt_capability(
                            nmt_cap,
                            &asr_langs,
                            &tts_langs,
                        );
                        
                        for (src, tgt) in pairs {
                            // 检查节点是否真的支持该语言对
                            if node_supports_language_pair(
                                node,
                                &src,
                                &tgt,
                                &language_index,
                            ) {
                                language_pairs
                                    .entry((src, tgt))
                                    .or_insert_with(Vec::new)
                                    .push(node.node_id.clone());
                            }
                        }
                    }
                }
            }
        }
        
        // 2. 过滤：只保留节点数 >= min_nodes_per_pool 的语言对
        let mut valid_pairs: Vec<((String, String), Vec<String>)> = language_pairs
            .into_iter()
            .filter(|(_, nodes)| nodes.len() >= cfg.min_nodes_per_pool)
            .collect();
        
        // 3. 排序：按节点数降序
        valid_pairs.sort_by(|a, b| b.1.len().cmp(&a.1.len()));
        
        // 4. 限制：最多 max_pools 个
        if valid_pairs.len() > cfg.max_pools {
            valid_pairs.truncate(cfg.max_pools);
        }
        
        // 5. 生成 Pool 配置
        let mut pools = Vec::new();
        let mut pool_id = 1;
        
        for ((src, tgt), node_ids) in valid_pairs {
            let pool_name = if cfg.pool_naming == "bidirectional" {
                // 双向命名：按字典序
                if src < tgt {
                    format!("{}-{}", src, tgt)
                } else {
                    format!("{}-{}", tgt, src)
                }
            } else {
                // 单向命名
                format!("{}-{}", src, tgt)
            };
            
            pools.push(Phase3PoolConfig {
                pool_id,
                name: pool_name,
                required_services: vec![
                    "asr".to_string(),
                    "semantic".to_string(),
                    "nmt".to_string(),
                    "tts".to_string(),
                ],
                language_requirements: Some(PoolLanguageRequirements {
                    asr_languages: Some(vec![src.clone()]),
                    tts_languages: Some(vec![tgt.clone()]),
                    nmt_requirements: Some(PoolNmtRequirements {
                        languages: vec![src.clone(), tgt.clone()],
                        rule: "specific_pairs".to_string(),
                        supported_pairs: Some(vec![LanguagePair {
                            src: src.clone(),
                            tgt: tgt.clone(),
                        }]),
                        blocked_pairs: None,
                    }),
                }),
            });
            
            pool_id += 1;
        }
        
        pools
    }
    
    /// 从 NMT 能力生成语言对
    fn generate_language_pairs_from_nmt_capability(
        nmt_cap: &NmtCapability,
        asr_langs: &HashSet<String>,
        tts_langs: &HashSet<String>,
    ) -> Vec<(String, String)> {
        let mut pairs = Vec::new();
        
        match nmt_cap.rule.as_str() {
            "any_to_any" => {
                // 生成所有可能的语言对（排除 blocked_pairs）
                for src in &nmt_cap.languages {
                    if !asr_langs.contains(src) {
                        continue;  // 节点不支持该语言的 ASR
                    }
                    for tgt in &nmt_cap.languages {
                        if src == tgt {
                            continue;  // 跳过相同语言
                        }
                        if !tts_langs.contains(tgt) {
                            continue;  // 节点不支持该语言的 TTS
                        }
                        
                        // 检查是否被阻止
                        let is_blocked = nmt_cap.blocked_pairs.as_ref()
                            .map(|bp| bp.iter().any(|p| p.src == *src && p.tgt == *tgt))
                            .unwrap_or(false);
                        
                        if !is_blocked {
                            pairs.push((src.clone(), tgt.clone()));
                        }
                    }
                }
            }
            "any_to_en" => {
                // 任意语言到英文
                for src in &nmt_cap.languages {
                    if src == "en" {
                        continue;
                    }
                    if asr_langs.contains(src) && tts_langs.contains("en") {
                        pairs.push((src.clone(), "en".to_string()));
                    }
                }
            }
            "en_to_any" => {
                // 英文到任意语言
                for tgt in &nmt_cap.languages {
                    if tgt == "en" {
                        continue;
                    }
                    if asr_langs.contains("en") && tts_langs.contains(tgt) {
                        pairs.push(("en".to_string(), tgt.clone()));
                    }
                }
            }
            "specific_pairs" => {
                // 明确支持的语言对
                if let Some(sp) = &nmt_cap.supported_pairs {
                    for pair in sp {
                        if asr_langs.contains(&pair.src) && tts_langs.contains(&pair.tgt) {
                            pairs.push((pair.src.clone(), pair.tgt.clone()));
                        }
                    }
                }
            }
            _ => {}
        }
        
        pairs
    }
}
```

---

### 3.2 Pool 更新机制

#### 触发时机

1. **节点注册时**：新节点上线，可能支持新的语言对
2. **节点心跳更新语言能力时**：节点的语言能力可能变化
3. **节点下线时**：节点下线，需要从 Pool 中移除
4. **手动触发**：运维人员手动触发重新生成

#### 更新逻辑

```rust
impl NodeRegistry {
    /// 重新生成语言对 Pool（全量重建）
    pub async fn rebuild_auto_language_pools(&self) {
        let cfg = self.phase3.read().await.clone();
        
        // 只在自动生成模式且 pools 为空时执行
        if !cfg.auto_generate_language_pools || !cfg.pools.is_empty() {
            return;
        }
        
        // 生成新的 pools
        let new_pools = self.auto_generate_language_pair_pools().await;
        
        // 更新配置
        {
            let mut phase3 = self.phase3.write().await;
            phase3.pools = new_pools;
        }
        
        // 重建 Pool 索引
        self.rebuild_phase3_pool_index().await;
    }
    
    /// 增量更新：节点上线/下线时
    pub async fn update_auto_language_pools_on_node_change(&self, node_id: &str) {
        let cfg = self.phase3.read().await.clone();
        
        // 只在自动生成模式时执行
        if !cfg.auto_generate_language_pools || !cfg.pools.is_empty() {
            return;
        }
        
        // 增量更新策略：
        // 1. 如果节点下线：从所有 Pool 中移除该节点
        // 2. 如果节点上线：检查该节点支持的语言对，更新对应的 Pool
        
        let nodes = self.nodes.read().await;
        let node = match nodes.get(node_id) {
            Some(n) => n,
            None => {
                // 节点已下线，从所有 Pool 中移除
                self.phase3_remove_node_from_pool_index(node_id).await;
                return;
            }
        };
        
        // 节点上线，重新分配 Pool
        self.phase3_upsert_node_to_pool_index(node_id).await;
        
        // 检查是否需要重新生成 Pool（如果节点支持新的语言对）
        // 这里简化处理：如果节点支持的语言对不在现有 Pool 中，触发全量重建
        // 更精细的实现可以只添加新的 Pool，不删除旧的
        let should_rebuild = self.should_rebuild_pools_for_new_language_pairs(node).await;
        if should_rebuild {
            self.rebuild_auto_language_pools().await;
        }
    }
}
```

---

## 四、节点分配逻辑改造

### 4.1 改造 `determine_pool_for_node`

```rust
fn determine_pool_for_node(
    cfg: &Phase3Config,
    node: &Node,
    language_index: &LanguageCapabilityIndex,
) -> Option<u16> {
    // 如果是自动生成模式
    if cfg.auto_generate_language_pools && !cfg.pools.is_empty() {
        // 遍历所有自动生成的 Pool
        for pool in cfg.pools.iter() {
            // 1. 检查服务类型匹配
            let service_match = pool.required_services.iter()
                .filter_map(|s| ServiceType::from_str(s).ok())
                .all(|t| {
                    node.capability_by_type_map
                        .get(&t)
                        .copied()
                        .unwrap_or(false)
                });
            
            if !service_match {
                continue;
            }
            
            // 2. 检查语言能力匹配（一对一语言对）
            if let Some(lang_req) = &pool.language_requirements {
                // 从 Pool 名称提取语言对（如 "zh-en" -> ("zh", "en")）
                let (src_lang, tgt_lang) = extract_language_pair_from_pool_name(&pool.name);
                
                if node_supports_language_pair(node, &src_lang, &tgt_lang, language_index) {
                    return Some(pool.pool_id);
                }
            }
        }
        return None;
    }
    
    // 手动配置模式（现有逻辑）
    // ... 保留现有代码
}

fn extract_language_pair_from_pool_name(pool_name: &str) -> (String, String) {
    // 从 Pool 名称提取（如 "zh-en" -> ("zh", "en")）
    if let Some((src, tgt)) = pool_name.split_once('-') {
        (src.to_string(), tgt.to_string())
    } else {
        // 默认值（不应该到达这里）
        ("unknown".to_string(), "unknown".to_string())
    }
}
```

---

## 五、Pool 选择逻辑改造

### 5.1 改造 `select_node_with_types_two_level_excluding_with_breakdown`

```rust
// 在 Pool 选择阶段，如果是自动生成模式，直接根据语言对选择 Pool
let (all_pools, preferred_pool, pools) = if cfg.enabled && cfg.mode == "two_level" {
    if cfg.auto_generate_language_pools && !cfg.pools.is_empty() {
        // 自动生成模式：直接根据语言对选择 Pool
        let pool_name = format!("{}-{}", src_lang, tgt_lang);
        let matching_pool = cfg.pools.iter()
            .find(|p| p.name == pool_name);
        
        if let Some(pool) = matching_pool {
            // 找到匹配的 Pool
            let all_pool_ids: Vec<u16> = cfg.pools.iter().map(|p| p.pool_id).collect();
            let preferred = pool.pool_id;
            let eligible = vec![pool.pool_id];
            
            (all_pool_ids, preferred, eligible)
        } else {
            // 没有找到匹配的 Pool，返回空
            (vec![], 0, vec![])
        }
    } else {
        // 手动配置模式（现有逻辑）
        // ... 保留现有代码
    }
} else {
    // ... 其他模式
};
```

---

## 六、配置示例

### 6.1 启用自动生成

```json
{
  "phase3": {
    "enabled": true,
    "mode": "two_level",
    "pool_count": 0,
    "hash_seed": 0,
    "pools": [],
    "auto_generate_language_pools": true,
    "auto_pool_config": {
      "min_nodes_per_pool": 2,
      "max_pools": 50,
      "pool_naming": "pair",
      "require_semantic": true
    }
  }
}
```

### 6.2 自动生成的 Pool 示例

假设系统中有以下节点：
- 节点1：支持 zh→en（ASR+SEMANTIC+NMT+TTS）
- 节点2：支持 zh→en（ASR+SEMANTIC+NMT+TTS）
- 节点3：支持 en→zh（ASR+SEMANTIC+NMT+TTS）
- 节点4：支持 ja→en（ASR+SEMANTIC+NMT+TTS）
- 节点5：支持 ko→en（ASR+SEMANTIC+NMT+TTS）

**自动生成的 Pool 示例**：
```json
[
  {
    "pool_id": 1,
    "name": "zh-en",
    "required_services": ["asr", "semantic", "nmt", "tts"],
    "language_requirements": {
      "asr_languages": ["zh"],
      "tts_languages": ["en"],
      "nmt_requirements": {
        "languages": ["zh", "en"],
        "rule": "specific_pairs",
        "supported_pairs": [{"src": "zh", "tgt": "en"}]
      }
    }
  },
  {
    "pool_id": 2,
    "name": "en-zh",
    "required_services": ["asr", "semantic", "nmt", "tts"],
    "language_requirements": {
      "asr_languages": ["en"],
      "tts_languages": ["zh"],
      "nmt_requirements": {
        "languages": ["en", "zh"],
        "rule": "specific_pairs",
        "supported_pairs": [{"src": "en", "tgt": "zh"}]
      }
    }
  },
  {
    "pool_id": 3,
    "name": "ja-en",
    "required_services": ["asr", "semantic", "nmt", "tts"],
    "language_requirements": {
      "asr_languages": ["ja"],
      "tts_languages": ["en"],
      "nmt_requirements": {
        "languages": ["ja", "en"],
        "rule": "specific_pairs",
        "supported_pairs": [{"src": "ja", "tgt": "en"}]
      }
    }
  },
  {
    "pool_id": 4,
    "name": "ko-en",
    "required_services": ["asr", "semantic", "nmt", "tts"],
    "language_requirements": {
      "asr_languages": ["ko"],
      "tts_languages": ["en"],
      "nmt_requirements": {
        "languages": ["ko", "en"],
        "rule": "specific_pairs",
        "supported_pairs": [{"src": "ko", "tgt": "en"}]
      }
    }
  }
]
```

---

## 七、实施步骤

### 步骤1：扩展配置结构
- [ ] 在 `Phase3Config` 中新增 `auto_generate_language_pools` 字段
- [ ] 新增 `AutoLanguagePoolConfig` 结构
- [ ] 更新配置加载逻辑

### 步骤2：实现自动生成算法
- [ ] 实现 `auto_generate_language_pair_pools()` 方法
- [ ] 实现 `generate_language_pairs_from_nmt_capability()` 辅助方法
- [ ] 实现 `node_supports_language_pair()` 检查方法
- [ ] 实现 `node_has_all_required_services()` 检查方法

### 步骤3：实现 Pool 更新机制
- [ ] 实现 `rebuild_auto_language_pools()` 全量重建
- [ ] 实现 `update_auto_language_pools_on_node_change()` 增量更新
- [ ] 在节点注册/心跳/下线时触发更新

### 步骤4：改造节点分配逻辑
- [ ] 修改 `determine_pool_for_node()` 支持自动生成模式
- [ ] 实现 `extract_language_pair_from_pool()` 辅助方法

### 步骤5：改造 Pool 选择逻辑
- [ ] 修改 `select_node_with_types_two_level_excluding_with_breakdown()` 支持自动生成模式
- [ ] 根据语言对直接选择 Pool

### 步骤6：测试与验证
- [ ] 单元测试：自动生成算法
- [ ] 单元测试：节点分配逻辑
- [ ] 单元测试：Pool 选择逻辑
- [ ] 集成测试：端到端自动生成 Pool 调度
- [ ] 性能测试：大量节点和语言对时的性能

---

## 八、性能优化

### 8.1 避免 Pool 爆炸

**策略**：
1. **最小节点数限制**：`min_nodes_per_pool`（默认 2）
2. **最大 Pool 数量限制**：`max_pools`（默认 50）
3. **只生成实际存在的语言对**：不生成理论上的所有组合

### 8.2 更新频率控制

**策略**：
1. **防抖**：节点变化时，延迟 N 秒后再更新（避免频繁重建）
2. **增量更新优先**：尽量只更新变化的 Pool，不全量重建
3. **定时全量重建**：每天凌晨全量重建一次，确保一致性

### 8.3 缓存优化

**策略**：
1. **Pool 配置缓存**：生成后缓存，减少重复计算
2. **语言对索引**：维护语言对 → Pool ID 的快速索引

---

## 九、监控与运维

### 9.1 监控指标

- **Pool 数量**：当前自动生成的 Pool 数量
- **Pool 节点数分布**：每个 Pool 的节点数
- **Pool 选择成功率**：选择到匹配 Pool 的比例
- **Pool 更新频率**：自动更新的次数和耗时

### 9.2 运维接口

- **手动触发重建**：`POST /api/admin/pools/rebuild`
- **查看 Pool 列表**：`GET /api/admin/pools`
- **查看 Pool 详情**：`GET /api/admin/pools/{pool_id}`
- **禁用自动生成**：设置 `auto_generate_language_pools = false`

---

## 十、总结

### 10.1 核心特性

- ✅ **自动生成**：根据节点语言能力自动生成 Pool
- ✅ **语言对命名**：Pool 名称直接使用语言对（如 `zh-en`）
- ✅ **服务齐全**：只包含 ASR + SEMANTIC + NMT + TTS 都齐全的节点
- ✅ **动态更新**：节点变化时自动更新 Pool

### 10.2 优势

- **运维友好**：无需手动配置，自动适应节点能力
- **精确匹配**：Pool 选择直接基于语言对，效率高
- **资源隔离**：不同语言对的节点分开管理，负载更均匀

### 10.3 注意事项

- ⚠️ **Pool 数量控制**：通过 `min_nodes_per_pool` 和 `max_pools` 限制
- ⚠️ **更新性能**：大量节点时，全量重建可能耗时，需要优化
- ⚠️ **向后兼容**：手动配置模式仍然可用

---

**该方案完全满足需求：按语言对自动生成 Pool，Pool 命名使用语言对，只包含服务齐全的节点。**
