# Domain Recall — 行为合同

**状态：** CURRENT（2026-07-20 · Recall-only role）  
**Runtime Domain Presence Vote:** **ACCEPTED AND FROZEN** — cite [`Runtime_SSOT_Contract_Freeze.md`](../../tone-v2/Runtime_SSOT_Contract_Freeze.md) / [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](../../tone-v2/Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md)  
**代码根：** `electron_node/electron-node/main/src/lexicon-v2/` · `fw-detector/span-assembly-v4/recall-topk-for-windows.ts`

```text
Runtime Vote and Assembly are not owned by this document.
```

**Sole Runtime Authority:** [`Runtime_SSOT_Contract_Freeze.md`](../../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**Domain source / Registry / Recall scope:** [`DOMAIN_SOURCE_UNIFICATION.md`](../DOMAIN_SOURCE_UNIFICATION.md)  
**Index:** [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md)

本文件只定义 Recall 输入、窗口召回、Hotword → WindowCandidate 转换、domains[] 完整传播、Base/domain source 分类、TopK 与 diagnostics。

---

## Context Prior

```text
Context Prior:
diagnostics-only
applied:false
```

Context Prior **不属于** Recall，不改变 Recall SQL / Scope / Candidate Recall，也不参与 Vote / Assembly / KenLM。权威见 [CONTEXT_PRIOR.md](../CONTEXT_PRIOR.md)。

---

## 1. Recall 输入

唯一 Runtime Recall Domain 输入：`recallDomainScope`（由 DSU / RS-03A 解析）。

```text
enabledDomains (config / job)
  → resolveRecallEnabledFineDomains / resolveRecallScope
  → recallDomainScope
  → recallTopKForWindows({ domainIds: recallDomainScope })
```

| 规则 | 说明 |
|------|------|
| CFG-01 | `enabledDomains` 默认 `[]` → 全量 `availableFineDomains`（打开 Domain Recall） |
| 空 scope | fail-fast；禁止静默 Base-only |
| 禁止 | orchestrator 再解释原始 `enabledDomains` |

细节权威：DSU。

---

## 2. Window / Span 召回行为

```text
Fine Span / Windows
  → recallSpanTopKV3 (domainBoost = 0)
  → Tone First (tone tier SQL · tone score penalty)
  → Candidate Ranking (candidate-score · ED tie-break)
  → WindowCandidate[]
```

Recall 宽进：允许全部候选进入后续过滤；Apply 侧保持窄出（`candidateRequireRepairTarget`）。

---

## 3. Hotword → WindowCandidate 转换

- Hotword 携带 `domains[]`（来自 `term_domain_tags`）。
- `recall-topk-for-windows` / window converter 将 **全部** domains 写入 WindowCandidate.domains[]。
- 禁止 `domains[0]` / `domainId` 决策投影。

---

## 4. domains[] 完整传播

| 阶段 | 合同 |
|------|------|
| Lexicon Hotword | `Hotword.domains[]` 完整列表 |
| WindowCandidate | 复制完整 `domains[]` |
| CandidateScore | **不得**改写 `domains[]` |
| SpanReplacementPick / KenLM 输入对象 | **不得**携带 domains 元数据 |

---

## 5. Base 与 domain source 分类

| source | 角色 |
|--------|------|
| `domain_term` / `passive_domain_weak` | 可进入 FineSpanDomainSet（Vote 资格由 Runtime SSOT 定义） |
| `base_term`（无细域） | Base；不参与 Vote；Assembly 时进入每个 retained bucket |

本文件不定义 Presence Vote 公式或 retainedDomains。

---

## 6. Recall TopK

| 参数 | 值 |
|------|-----|
| `exactTopK` | 2 |
| `maxGlobalWindowCount` | 120 |
| `maxSqlPerUtterance` | 150 |
| per-span limit | 1 span=8, 2 span=4, 3+ span=2 |

`maxSentenceCandidates = 16` 属于 Assembly / KenLM 全局帽；权威见 Runtime SSOT。

---

## 7. Candidate recall diagnostics

| 字段 | 来源 |
|------|------|
| `recallEnabledFineDomains` / `recallDomainScope` | DSU 解析 |
| `candidate.domains` | WindowCandidate |
| DomainBoost | **0**（仅 Diagnostics；不得影响 Recall 决策） |

废弃：`exact_domain_strong` / `exact_domain_weak` / `weakDomainRecallPlan` 作为 Recall 控制面。

---

## 8. Recall Noise 风险

- 拼音近音噪声仍可能进入候选池（例如时间表达近音路径）。
- **不得**通过修改 Presence Vote 修补 Recall Noise。
- 噪声治理归属 Lexicon / Recall 质量，不归属 Runtime Vote 合同。

---

## 9. Hotword / Cache

- `hotwordId = termId`；多域信息存 `domains[]`；禁止 `termId:domainId` fan-out  
- Multi lookup 缓存键：`domainmulti:hash(sorted(domainIds)):pinyinKey`，LRU=512

---

## 10. 不在本文件定义（引用 Runtime SSOT）

| 主题 | Owner |
|------|-------|
| Presence Vote / FineSpanDomainSet / domainScores | Runtime SSOT |
| retainedDomains / DOMAIN_BUCKET_RETENTION_RATIO | Runtime SSOT |
| Domain Rerank | REMOVED |
| Context Prior multiplier | REMOVED（`applied:false`） |
| SecondaryDomains ReRank Bonus | 非正式决策 |
| Shadow Beam | REMOVED |
| Multi-Bucket Assembly / Cross-Bucket Dedup | Runtime SSOT + FROZEN_V1_2 |
| KenLM pick | KENLM_RUNTIME + Runtime SSOT |

---

## 11. Legacy 路径

以下文件可保留但 **不得被 SpanAssemblyV4 调用**，标记 `@deprecated` / `legacy-only`：

- `resolveDomainIdsForRecall`  
- `local-span-recall`  
- `industry-routing-domain-resolver`

---

## 12. 验证

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="resolve-recall|freeze-contract|recall-topk"
```

---

*Recall-only role 2026-07-20*
