# Domain Recall & ReRank — 冻结合约 V1.2

> ## ⚠️ SUPERSEDED（Domain Source Unification · 2026-06-23）
>
> 本文件 **部分内容** 已被 **FW Repair V4 Domain Source Unification Freeze Package** 取代。
>
> **权威入口：** [`DOMAIN_SOURCE_UNIFICATION.md`](../DOMAIN_SOURCE_UNIFICATION.md)
>
> **已被取代的章节主题（请读 DSU 包，勿以本文为准）：**
>
> | 主题 | DSU 合约 |
> |------|----------|
> | Recall Domain Set SSOT | **RS-03A** — `expandPolicyToFineDomains` → ∩ `availableFineDomains` |
> | Registry / profile 驱动 recall | **`RuntimeDomainRegistry`** — `term_domain_tags` DISTINCT |
> | 粗域静态展开表 | **`coarseToFineMap`** from `domain_hierarchy` ∩ available |
> | `enabledDomains` 默认语义 | **CFG-01** — 默认 `[]` → 全量 available |
> | Runtime Diagnostics 域字段 | **DSU Runtime Diagnostics** — 见 `DIAGNOSTICS_CONTRACT.md` |
>
> **仍有效：** §4 Vote 公式 · §5 ReRank 系数 · §6–§11 性能 / Patch / Legacy 边界（算法常量未变）
>
> ## Context Prior 边界（Frozen · 2026-06-23）
>
> **Context Prior 不属于 Recall。**
>
> - Recall Scope 仍由 **DSU / RS-03A**（`resolveRecallEnabledFineDomains` → `availableFineDomains`）控制
> - Context Prior **不得**改变 Recall SQL · Recall Scope · Candidate Recall
> - Context Prior 仅属 **Domain ReRank Layer**，在 Vote 之后对 eligible 候选施加 soft multiplier
>
> **权威：** [CONTEXT_PRIOR.md](../CONTEXT_PRIOR.md)

**状态：** FINAL FROZEN（2026-06-20）· Domain SSOT 层 superseded by DSU（2026-06-23）  
**代码根：** `electron_node/electron-node/main/src/lexicon-v2/` · `fw-detector/span-assembly-shared/`

---

## 1. Recall Domain Set SSOT

唯一入口：`resolveRecallEnabledFineDomains()`（`lexicon-v2/resolve-recall-enabled-fine-domains.ts`）

### 输入优先级

1. Job Override  
2. `fw-config.enabledDomains`  
3. Registry Enabled Domains（`profile-registry.json` 中 `enabled && allowLLMSelect`）

### 粗域展开

| 粗域 | 自动展开为细域 |
|------|----------------|
| `restaurant` | `coffee`, `milk_tea`, `bakery`, `food_order` |
| `travel` | `tourism_pickup`, `tourism_hotel`, `tourism_route`, `tourism_transport` |
| `general` | **永不进入 Domain SQL** |

展开逻辑：若 domain 在 registry 有 enabled 子域，则展开为子域列表；否则若自身为合法 LLM domain 则保留。

### 输出

```text
Recall Domain Set = Fine Domains + Base + Idiom
```

推荐上限：`enabledFineDomains <= 12`（`RECOMMENDED_MAX_ENABLED_FINE_DOMAINS`）

---

## 2. SQLite V2 DDL（Term-Centric）

**schemaVersion：** `lexicon-v3-five-table-v2`

| 表 | 关键字段 |
|----|----------|
| `term` | `term_id` PK, `word`, `pinyin_key`, `tone_pinyin_key` |
| `term_domain_tags` | `term_id`, `domain_id`, `domain_weight` |

索引：`(domain_id, pinyin_key)`、`(term_id)`、`(word, pinyin_key)`

禁止 `domain_lexicon` fan-out 双轨作为 Runtime SSOT。`domain_lexicon` 仅为 Build 物化层。

完整 Schema 与导入流程见 [`../../../electron_node/lexicon-assets/docs/SCHEMA_V2.md`](../../../electron_node/lexicon-assets/docs/SCHEMA_V2.md)。

---

## 3. Bundle Build 流水线

```text
Seed → Migrate → SQLite → Manifest → Checksum
```

`build-bundle.mjs` 标记 Deprecated，不得继续作为 Runtime SSOT。

Build 输入采用方案 A：`p1_3_lexicon_zh_v2` 整包（含 base、idiom、common5、multidomain seed），不得单独 build multidomain。

---

## 4. Domain Vote Formula

```text
VoteMass = CandidateScore × SourceWeight × CoverageWeight × DomainWeight
```

- `MIN_EVIDENCE_SCORE = 0.3`  
- Winning Domain 必须是 **Fine Domain**；Parent Domain 不允许成为 Winning  
- `winningFineDomain === utteranceDomain`（当 `!insufficientEvidence` 且 Fine Domain Eligible）

---

## 5. Domain ReRank

执行顺序：**Vote → ReRank → SelectTopK**

实现：`span-assembly-shared/domain-rerank.ts`（`rankDomainCandidatesPerSpan`）

Main 与 Shadow 统一调用同一 ReRank 实现。

### 系数（`DOMAIN_RERANK_PENALTY`）

| 关系 | 系数 |
|------|------|
| Winning | 1.0 |
| Sibling | 0.8 |
| Parent | 0.7 |
| Other | 0.5 |

关系判定：`classifyDomainRerankRelation(winningDomain, matchedDomain, insufficientEvidence)`

---

## 6. Recall 阶段 Domain Boost

Recall 阶段 **DomainBoost = 0**（仅 Diagnostics）。废弃 `exact_domain_strong` / `exact_domain_weak` / `weakDomainRecallPlan`，不得影响 Recall。

**Recall 宽进，Apply 窄出：** Recall 允许所有候选；Apply 保持 `candidateRequireRepairTarget=true`。

ReRank 后不允许空 Span；保留 `canonical_exact` fallback，保证 KenLM 永远有组合输入。

---

## 7. Performance SSOT

| 参数 | 值 |
|------|-----|
| `exactTopK` | 2 |
| `maxGlobalWindowCount` | 120 |
| `maxSqlPerUtterance` | 150 |
| `maxSentenceCandidates` | 16 |
| per-span limit | 1 span=8, 2 span=4, 3+ span=2 |

---

## 8. Hotword / Cache

- `hotwordId = termId`；多域信息存 `domains[]`；禁止 `termId:domainId` fan-out  
- Multi lookup 缓存键：`domainmulti:hash(sorted(domainIds)):pinyinKey`，LRU=512

---

## 9. Secondary Domains

SecondaryDomains **不参与 Recall、不参与 Vote**；仅允许 ReRank Bonus（默认关闭）。

---

## 10. Patch 合约

- Add：`domain_tags[]`  
- Delete：按 `term_id` 删除（非 `domain_id`）  
- Alias：继承全部 tags，统一 Fan-Out  
- Parent Fragment：多域词 NGram 同步所有 tags；Vote 时 Parent Fragment 允许参与 Coverage 去重

---

## 11. Legacy 路径

以下文件可保留但 **不得被 SpanAssemblyV4 调用**，标记 `@deprecated` / `legacy-only`：

- `resolveDomainIdsForRecall`  
- `local-span-recall`  
- `industry-routing-domain-resolver`

---

## 12. Diagnostics 字段

| 字段 | 来源 |
|------|------|
| `recallEnabledFineDomains` | `resolveRecallEnabledFineDomains()` |
| `domainScores` | `domainAssembly.vote.domainScores` |
| `winningFineDomain` | Vote 结果 |
| `candidate.domain_tags` / `domain_weights` | WindowCandidate |
| `domainPenalty` | ReRank |

---

## 13. 禁止修改（本轮）

`resolveCompatibilityRelations` · Coverage Logic · `ORAL_SOURCE_WEIGHT` · Shadow Beam Structure

本轮仅允许 Lexicon Recall、Vote、ReRank 相关改造。

---

## 14. 验证

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="domain-rerank|resolve-recall|freeze-contract|ddl-schema-v2|bundle-schema-v2"
```
