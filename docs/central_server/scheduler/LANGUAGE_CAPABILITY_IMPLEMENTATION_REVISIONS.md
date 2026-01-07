# 语言能力调度实现修订说明

## 文档信息

- **版本**: v1.1
- **日期**: 2025-01-XX
- **状态**: 修订完成
- **目的**: 说明根据审阅反馈进行的修订内容

---

## 修订依据

本文档基于《LANGUAGE_CAPABILITY_IMPLEMENTATION_REVIEW_TASKS_v1.1.md》的审阅结论进行修订。

---

## P0 级修订（必须修复）

### P0-1: `any_to_any` 规则不展开为 N×N pairs

**问题**：
- 原设计将 `any_to_any` 规则展开为所有 `(src, tgt)` 组合
- 索引构建复杂度 O(N²)，节点或语言规模扩大后不可控

**修订方案**：
- **不展开** `any_to_any` 规则
- 改为**规则匹配模式**，仅在匹配阶段判断
- 存储结构：`nmt_nodes: Vec<NmtNodeCapability>`（存储规则而非展开的语言对）

**修订前**：
```rust
// 展开所有语言对
for src in &languages {
    for tgt in &languages {
        if src != tgt {
            by_nmt_pair.insert((src, tgt), node_id);
        }
    }
}
// 复杂度：O(N²)
```

**修订后**：
```rust
// 存储规则
nmt_nodes.push(NmtNodeCapability {
    node_id,
    rule: NmtRule::AnyToAny,
    languages: HashSet::new(),
});

// 匹配时判断
match rule {
    NmtRule::AnyToAny => {
        languages.contains(&src) && languages.contains(&tgt)
    }
    // ...
}
// 复杂度：O(N) 匹配，O(1) 索引构建
```

**影响**：
- ✅ 索引构建复杂度从 O(N²) 降至 O(N)
- ✅ 内存占用大幅降低（100语言从 10,000 pairs 降至 1 条规则）
- ✅ 匹配性能：O(N) 遍历规则列表（N 通常很小，< 10）

---

### P0-2: `blocked_pairs` 使用 HashSet 而非 Vec

**问题**：
- `blocked_pairs` 使用线性 `iter().any()` 扫描
- 在高频匹配下性能明显下降

**修订方案**：
- 预处理为 `HashSet<(String, String)>`
- 匹配阶段 O(1) 判断

**修订前**：
```rust
let is_blocked = blocked_pairs
    .iter()
    .any(|p| p.src == src && p.tgt == tgt);
// 复杂度：O(N)
```

**修订后**：
```rust
let blocked_pairs: HashSet<(String, String)> = // 预处理
let is_blocked = blocked_pairs.contains(&(src, tgt));
// 复杂度：O(1)
```

**影响**：
- ✅ 匹配性能从 O(N) 提升至 O(1)
- ✅ 高频场景下性能提升显著

---

### P0-3: 仅统计 READY 状态的服务

**问题**：
- `running` 状态即计入能力
- 节点被误认为支持某语言，但实际不可服务

**修订方案**：
- 仅统计 `status === 'running'` 且 `capability_by_type.ready === true` 的服务
- capabilities 失败时使用 last-known-good + TTL

**修订前**：
```typescript
const asrServices = installedServices.filter(s => 
    s.type === ServiceType.ASR && s.status === 'running'
);
```

**修订后**：
```typescript
// 只处理 READY 状态的服务
const readyServices = installedServices.filter(s => 
    s.status === 'running' && 
    capability_by_type.find(c => c.type === s.type)?.ready === true
);

const asrServices = readyServices.filter(s => s.type === ServiceType.ASR);
```

**影响**：
- ✅ 避免将任务分配给不可服务的节点
- ✅ 提高任务分配准确性

---

## P1 级修订（强烈建议优化）

### P1-1: 语言规范化规则增强

**修订内容**：
1. **统一大小写**：所有语言代码转为小写
2. **排除 auto**：`auto` 不进入索引
3. **补充历史别名映射**：
   - `in` → `id`（印尼语旧代码）
   - `iw` → `he`（希伯来语旧代码）

**修订后**：
```typescript
function normalizeLanguageCode(lang: string): string {
  const lower = lang.toLowerCase();
  const normalizationMap: Record<string, string> = {
    'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh',
    'pt-br': 'pt', 'pt-pt': 'pt',
    'en-us': 'en', 'en-gb': 'en',
    'in': 'id',  // 印尼语旧代码
    'iw': 'he',  // 希伯来语旧代码
  };
  return normalizationMap[lower] || lower;
}
```

---

### P1-2: 业务模式显式建模（待实施）

**建议引入业务模式枚举**：
```typescript
enum BusinessMode {
  TEXT_TRANSLATE,              // 文本翻译（无需 ASR/TTS）
  SPEECH_TRANSLATE,            // 语音翻译（ASR + NMT）
  SPEECH_TRANSLATE_WITH_TTS,   // 语音翻译+TTS（ASR + NMT + TTS）
  TTS_ONLY,                    // 仅TTS
}
```

**影响**：
- 更清晰的业务语义
- 便于未来扩展新的业务模式

---

### P1-3: `src_lang = auto` 场景补充约束

**修订内容**：
1. **必须支持 `tgt_lang`**（NMT + TTS）
2. **节点必须有 READY ASR**
3. **按 ASR 语言覆盖度排序**

**修订后**：
```rust
if src_lang == "auto" {
    // 必须支持 tgt_lang（NMT + TTS）
    // 节点必须有 READY ASR
    let nodes_with_asr = language_index.find_nodes_with_ready_asr();
    candidate_nodes.retain(|node_id| nodes_with_asr.contains(node_id));
    
    // 排序时按 ASR 语言覆盖度
    available_nodes.sort_by(|a, b| {
        let coverage_a = language_index.get_asr_language_coverage(&a.node_id);
        let coverage_b = language_index.get_asr_language_coverage(&b.node_id);
        coverage_b.cmp(&coverage_a)  // 覆盖度高的优先
    });
}
```

---

## 修订后的索引结构

### 修订前（展开语言对）

```rust
pub struct LanguageCapabilityIndex {
    by_nmt_pair: HashMap<(String, String), HashSet<String>>,  // O(N²) 构建
    by_asr_lang: HashMap<String, HashSet<String>>,
    by_tts_lang: HashMap<String, HashSet<String>>,
}
```

### 修订后（规则匹配）

```rust
pub struct LanguageCapabilityIndex {
    by_asr_lang: HashMap<String, HashSet<String>>,
    by_tts_lang: HashMap<String, HashSet<String>>,
    nmt_nodes: Vec<NmtNodeCapability>,  // 存储规则，不展开
}

struct NmtNodeCapability {
    node_id: String,
    model_id: String,
    languages: HashSet<String>,
    rule: NmtRule,
    blocked_pairs: HashSet<(String, String)>,  // O(1) 查找
}
```

---

## 性能对比

| 指标 | 修订前 | 修订后 | 改进 |
|------|--------|--------|------|
| **索引构建复杂度** | O(N²) | O(N) | ✅ 大幅降低 |
| **内存占用**（100语言） | ~10,000 pairs | ~1 规则 | ✅ 降低 99% |
| **匹配性能** | O(1) 索引查找 | O(N) 规则匹配 | ⚠️ 轻微下降（N 通常 < 10） |
| **blocked_pairs 查找** | O(N) | O(1) | ✅ 显著提升 |

**结论**：修订后的方案在可扩展性和性能之间取得了更好的平衡。

---

## 实施检查清单

### P0 级（必须完成）

- [x] P0-1: 移除 N×N 展开，改为规则匹配
- [x] P0-2: blocked_pairs HashSet 化
- [x] P0-3: READY 状态能力统计

### P1 级（强烈建议）

- [x] P1-1: 语言规范化增强
- [ ] P1-2: 业务模式枚举（待实施）
- [x] P1-3: auto 场景增强

---

## 总结

经过修订，语言能力调度实现：

1. ✅ **可扩展性大幅提升**：避免 O(N²) 索引构建
2. ✅ **性能优化**：blocked_pairs O(1) 查找
3. ✅ **准确性提升**：只统计 READY 状态服务
4. ✅ **规范化增强**：语言代码处理更完善
5. ✅ **auto 场景优化**：按 ASR 覆盖度排序

**建议立即实施 P0 级修订，P1 级修订可在后续迭代中完成。**
