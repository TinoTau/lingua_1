# Pool 机制说明

## 文档信息

- **版本**: v1.0
- **日期**: 2025-01-XX
- **目的**: 澄清当前 Pool 机制的工作方式

---

## 一、当前实现（实际情况）

### 1.1 Pool 是手动配置的，不是自动生成的

**配置位置**：`Phase3Config.pools`

**配置方式**：
```json
{
  "phase3": {
    "enabled": true,
    "mode": "two_level",
    "pool_count": 4,
    "pools": [
      {
        "pool_id": 1,
        "name": "Pool A",
        "required_services": ["asr", "nmt", "tts"]
      },
      {
        "pool_id": 2,
        "name": "Pool B",
        "required_services": ["asr", "nmt"]
      }
    ]
  }
}
```

**关键点**：
- ❌ **不是**根据语言自动生成
- ❌ **不是**根据节点能力自动创建
- ✅ **是**运维人员手动配置的
- ✅ **是**基于 ServiceType（ASR、NMT、TTS）匹配的

---

### 1.2 节点分配 Pool 的逻辑

**当前逻辑**（`phase3_pool.rs::determine_pool_for_node()`）：

```rust
fn determine_pool_for_node(cfg: &Phase3Config, node: &Node) -> Option<u16> {
    // 遍历所有配置的 pools
    for pool in cfg.pools.iter() {
        // 检查节点的 installed_services 是否包含 pool 的 required_services
        let ok = pool.required_services.iter()
            .all(|service_type| {
                node.installed_services.iter()
                    .any(|s| s.type == service_type)
            });
        
        if ok {
            return Some(pool.pool_id);  // 匹配成功，分配到该 pool
        }
    }
    None  // 没有匹配的 pool
}
```

**分配依据**：
- ✅ 基于节点的 `installed_services`（ServiceType）
- ❌ **不基于**语言能力
- ❌ **不自动生成**新的 pool

**示例**：
```
配置的 Pool：
  - Pool 1: required_services = ["asr", "nmt", "tts"]
  - Pool 2: required_services = ["asr", "nmt"]

节点：
  - 节点A: installed_services = [ASR, NMT, TTS]
    → 匹配 Pool 1 ✅
  
  - 节点B: installed_services = [ASR, NMT]
    → 匹配 Pool 2 ✅
  
  - 节点C: installed_services = [ASR]
    → 不匹配任何 Pool ❌
```

---

### 1.3 任务分配流程

**当前流程**：

```
1. 任务请求（src_lang="zh", tgt_lang="en", required_types=[ASR, NMT, TTS]）
   ↓
2. Pool 选择（基于 required_types）
   - 查找 required_services 包含 [ASR, NMT, TTS] 的 Pool
   - 例如：Pool 1 被选中
   ↓
3. 在选中的 Pool 内选择节点
   - 遍历 Pool 1 中的所有节点
   - 进行语言过滤（新增的语言能力功能）
   - 选择支持 zh→en 的节点
   ↓
4. 分配任务
```

**关键点**：
- Pool 选择：**只考虑** ServiceType，**不考虑**语言
- 节点选择：**考虑** ServiceType + 语言能力（新增功能）

---

## 二、我提出的方案（扩展配置）

### 2.1 仍然是手动配置，但支持语言能力

**扩展后的配置**：
```json
{
  "pool_id": 1,
  "name": "中英文专用池",
  "required_services": ["asr", "nmt", "tts"],
  "language_requirements": {  // 新增：语言能力要求
    "asr_languages": ["zh", "en"],
    "tts_languages": ["zh", "en"],
    "nmt_requirements": {
      "languages": ["zh", "en"],
      "rule": "any_to_any"
    }
  }
}
```

**关键点**：
- ✅ 仍然是**手动配置**
- ✅ 但配置中可以**指定语言能力要求**
- ✅ 节点分配 Pool 时会**检查语言能力匹配**
- ✅ Pool 选择时会**考虑语言匹配**

---

## 三、如果要自动生成 Pool

### 3.1 自动生成 Pool 的设计

如果希望**根据节点的语言能力自动生成 Pool**，需要额外的设计：

#### 方案A：基于语言对自动生成

```rust
// 自动发现所有语言对，为每个语言对创建 Pool
fn auto_generate_language_pools(
    nodes: &HashMap<String, Node>,
    language_index: &LanguageCapabilityIndex,
) -> Vec<PoolConfig> {
    let mut pools = Vec::new();
    
    // 1. 收集所有支持的语言对
    let mut language_pairs = HashSet::new();
    for node in nodes.values() {
        if let Some(caps) = &node.language_capabilities {
            if let Some(nmt_caps) = &caps.nmt_capabilities {
                for nmt_cap in nmt_caps {
                    // 根据 rule 生成语言对
                    match nmt_cap.rule.as_str() {
                        "any_to_any" => {
                            // 生成所有语言对组合
                            for src in &nmt_cap.languages {
                                for tgt in &nmt_cap.languages {
                                    if src != tgt {
                                        language_pairs.insert((src.clone(), tgt.clone()));
                                    }
                                }
                            }
                        }
                        "specific_pairs" => {
                            // 使用明确的语言对
                            if let Some(pairs) = &nmt_cap.supported_pairs {
                                for pair in pairs {
                                    language_pairs.insert((pair.src.clone(), pair.tgt.clone()));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    
    // 2. 为每个语言对创建 Pool
    let mut pool_id = 1;
    for (src, tgt) in language_pairs {
        pools.push(PoolConfig {
            pool_id,
            name: format!("{}-{}", src, tgt),
            required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()],
            language_requirements: Some(PoolLanguageRequirements {
                asr_languages: Some(vec![src.clone()]),
                tts_languages: Some(vec![tgt.clone()]),
                nmt_requirements: Some(PoolNmtRequirements {
                    languages: vec![src.clone(), tgt.clone()],
                    rule: "specific_pairs".to_string(),
                    supported_pairs: Some(vec![LanguagePair { src, tgt }]),
                    blocked_pairs: None,
                }),
            }),
        });
        pool_id += 1;
    }
    
    pools
}
```

**问题**：
- ⚠️ 语言对数量可能很大（N×N），导致 Pool 爆炸
- ⚠️ 需要定期重新生成（节点上线/下线时）
- ⚠️ 配置管理复杂

---

#### 方案B：基于语言组合自动生成

```rust
// 为常见的语言组合创建 Pool
fn auto_generate_language_group_pools(
    nodes: &HashMap<String, Node>,
) -> Vec<PoolConfig> {
    // 定义常见的语言组合
    let language_groups = vec![
        (vec!["zh", "en"], "中英文"),
        (vec!["ja", "ko"], "日韩文"),
        (vec!["fr", "de", "es"], "欧洲语言"),
        // ...
    ];
    
    let mut pools = Vec::new();
    let mut pool_id = 1;
    
    for (languages, name) in language_groups {
        // 检查是否有节点支持该语言组合
        let has_support = nodes.values().any(|node| {
            if let Some(caps) = &node.language_capabilities {
                if let Some(nmt_caps) = &caps.nmt_capabilities {
                    nmt_caps.iter().any(|nmt| {
                        languages.iter().all(|lang| nmt.languages.contains(lang))
                    })
                } else {
                    false
                }
            } else {
                false
            }
        });
        
        if has_support {
            pools.push(PoolConfig {
                pool_id,
                name: format!("{}专用池", name),
                required_services: vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()],
                language_requirements: Some(PoolLanguageRequirements {
                    asr_languages: Some(languages.clone()),
                    tts_languages: Some(languages.clone()),
                    nmt_requirements: Some(PoolNmtRequirements {
                        languages: languages.clone(),
                        rule: "any_to_any".to_string(),
                        supported_pairs: None,
                        blocked_pairs: None,
                    }),
                }),
            });
            pool_id += 1;
        }
    }
    
    pools
}
```

**优势**：
- ✅ 控制 Pool 数量（基于预定义的语言组合）
- ✅ 更符合实际业务场景

**问题**：
- ⚠️ 仍然需要预定义语言组合
- ⚠️ 需要定期检查节点支持情况

---

#### 方案C：混合模式（推荐）

```rust
// 手动配置 + 自动发现
pub struct Phase3Config {
    // ... 现有字段
    
    /// 自动生成 Pool 模式
    pub auto_generate_pools: Option<AutoGeneratePoolsConfig>,
}

pub struct AutoGeneratePoolsConfig {
    /// 自动生成模式
    /// - "language_pairs": 为每个语言对生成 Pool（可能很多）
    /// - "language_groups": 为预定义的语言组合生成 Pool
    /// - "hybrid": 手动配置 + 自动发现补充
    pub mode: String,
    
    /// 预定义的语言组合（mode = "language_groups" 时使用）
    pub language_groups: Option<Vec<Vec<String>>>,
    
    /// 自动生成的 Pool 的命名规则
    pub naming_pattern: String,  // 例如："{src}-{tgt}" 或 "Pool-{group_name}"
}
```

**工作流程**：
1. 读取手动配置的 pools
2. 如果启用自动生成，根据节点能力自动创建额外的 pools
3. 合并手动和自动生成的 pools
4. 节点分配时匹配所有 pools

---

## 四、当前状态总结

### 4.1 实际情况

| 方面 | 当前实现 | 我提出的方案 |
|------|---------|-------------|
| **Pool 生成** | ❌ 手动配置 | ❌ 手动配置（但支持语言能力） |
| **节点分配** | ✅ 基于 ServiceType | ✅ 基于 ServiceType + 语言能力 |
| **Pool 选择** | ✅ 基于 ServiceType | ✅ 基于 ServiceType + 语言能力 |
| **自动生成** | ❌ 不支持 | ❌ 不支持（需要额外设计） |

### 4.2 如果要自动生成

需要：
1. 设计自动生成算法（避免 Pool 爆炸）
2. 实现 Pool 生命周期管理（节点变化时更新）
3. 提供配置选项控制自动生成行为
4. 考虑性能影响（Pool 数量增加）

---

## 五、建议

### 5.1 短期方案（推荐）

**保持手动配置，但扩展支持语言能力**：
- ✅ 简单可控
- ✅ 运维友好
- ✅ 性能稳定
- ✅ 符合当前架构

### 5.2 长期方案（可选）

**如果确实需要自动生成**：
- 实现混合模式（手动 + 自动）
- 基于语言组合而非语言对（避免爆炸）
- 提供自动生成的开关和配置
- 定期重新生成（节点变化时）

---

## 六、回答您的问题

**Q: 所以现在 pool 是根据可用语言种类自动生成自动把节点分配进去，然后进行任务分配的吗？**

**A: 不是的。当前实现是：**

1. **Pool 是手动配置的**，不是自动生成的
2. **节点分配 Pool** 是基于 ServiceType 匹配的，不是基于语言
3. **任务分配** 时，Pool 选择基于 ServiceType，节点选择才考虑语言能力

**如果要实现自动生成**，需要额外的设计和实现，我提出的方案仍然是基于手动配置的。
