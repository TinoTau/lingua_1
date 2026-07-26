# Domain Source Unification（DSU）

**Status:** Frozen · **2026-07-20** (role converged)  
**Runtime Domain Presence Vote:** **ACCEPTED AND FROZEN** (authority: [`Runtime_SSOT_Contract_Freeze.md`](../tone-v2/Runtime_SSOT_Contract_Freeze.md); acceptance: [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](../tone-v2/Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md))  
**代码：** `lexicon-v2/runtime-domain-registry.ts` · `resolve-recall-enabled-fine-domains.ts`

```text
This document does not define Runtime Domain Vote,
retainedDomains, Assembly or KenLM decisions.
Those contracts are owned by Runtime_SSOT_Contract_Freeze.md.
```

**Sole Runtime Authority:** [`Runtime_SSOT_Contract_Freeze.md`](../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**Lexicon fact SSOT:** [`Lexicon_Domain_Contract_Freeze_V1.md`](../tone-v2/Lexicon_Domain_Contract_Freeze_V1.md)  
**Index:** [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md)

本文件只定义：domain 数据来源、Registry、Recall scope，以及 Hotword / WindowCandidate 的 domains[] 来源边界。

---

## 1. Domain 数据来源

| 层 | SSOT | 说明 |
|----|------|------|
| Domain 可用集 | `term_domain_tags` | `availableFineDomains` = DISTINCT `domain_id` |
| Hierarchy | `domain_hierarchy`（sqlite，runtime 只读） | build 自 `profile-registry.json` parent 字段 |
| Owner | `RuntimeDomainRegistry` | `getRuntimeDomainRegistry()`；unloaded / empty → throw |

```text
profile-registry.json  →  build-time only
domain_hierarchy       →  runtime 只读（缺失/空 → fail-fast）
term_domain_tags       →  runtime domain fact 唯一来源
```

---

## 2. term_domain_tags 职责

- 词条细域标签事实表。
- Registry `availableFineDomains` 由此派生。
- Lexicon 合同细节见 Lexicon Domain Contract Freeze V1。
- Runtime Vote / Assembly **不**在本文件定义。

---

## 3. availableDomains Registry

| API / 字段 | 语义 |
|------------|------|
| `availableFineDomains` | REG-01 · from `term_domain_tags` |
| `availableCoarseDomains` | REG-02 · derived ∩ available |
| `fineToCoarseMap` / `coarseToFineMap` | REG-02 · from `domain_hierarchy` ∩ available |
| `llmAllowedDomains` | REG-03 · coarse + standalone fine leaves |
| `domainHierarchyVersion` | REG-04 · manifest 优先 |
| `getRuntimeDomainRegistry()` | REG-05 |

装载：`LexiconRuntimeV2.load()` → `installRuntimeDomainRegistry`

---

## 4. Hotword.domains[] 来源

- Hotword 携带来自 `term_domain_tags` 的完整细域列表。
- 禁止用 `domainId` / `domains[0]` 作决策投影（决策归属 Runtime SSOT）。

---

## 5. WindowCandidate.domains[] 传播

- Recall 将 Hotword.domains[] **完整**复制到 WindowCandidate.domains[]。
- CandidateScore 不得改写 domains[]。
- 传播细节见 [DOMAIN_RECALL.md](./recall/DOMAIN_RECALL.md)。

---

## 6. 粗域与细域事实边界

| 名称 | 角色 |
|------|------|
| fine domains | Runtime Vote / Assembly membership 使用的领域标签 |
| coarse domains | LLM / hierarchy 辅助；不替代 fine presence vote |
| `enabledDomains` | 原始配置输入（可为空） |
| `recallDomainScope` | CFG-01 + Registry 解析后的唯一 Recall SQL scope |

```text
configuredEnabledDomains (fw-config / job override)
  → resolveRecallScope
  → recallDomainScope
  → recallTopKForWindows({ domainIds: recallDomainScope })
```

| 规则 | 说明 |
|------|------|
| CFG-01 | `enabledDomains` 默认 `[]` → **打开**全量 `availableFineDomains` |
| 非空 policy | `recallScopeSource=policy`；经 Registry expand ∩ available |
| 空 `recallDomainScope` | **fail-fast**；禁止静默 Base-only |
| 禁止 | orchestrator 再解释原始 `enabledDomains`；`profile-registry.json` 作 recall scope owner |

---

## 7. LLM（PAR-01）准入

**coarse only** — `primaryDomain` / `secondaryDomains` 须为 `llmAllowedDomains` 中的粗域。

细域不得作为 `primaryDomain` 输出 → `schema_invalid`。

---

## 8. Runtime Vote / Assembly / KenLM

引用 Sole Runtime Authority：

[`Runtime_SSOT_Contract_Freeze.md`](../tone-v2/Runtime_SSOT_Contract_Freeze.md)

本文件 **不**定义：Fine-Span Presence Vote、domainScores、retainedDomains、Multi-Bucket Assembly、cross-bucket dedup、KenLM pick。

---

## 9. Runtime Diagnostics（观测）

| 字段 | 语义 |
|------|------|
| `enabledDomains` | CFG-01 policy 输入 |
| `availableFineDomains` | REG-01 |
| `availableCoarseDomains` | REG-02 |
| `llmAllowedDomains` | REG-03 |
| `recallDomainScope` | RS-03A 解析结果 |
| `recallScopeSource` | `available` \| `policy` \| `job_override` |
| `domainHierarchyVersion` | REG-04 |

详见 [diagnostics/FROZEN.md](./diagnostics/FROZEN.md)。

---

## 10. Superseded（本文件内旧职责）

以下主题 **不再**由本文件定义（已删除或迁出）：

| 主题 | 状态 |
|------|------|
| `domain-rerank.ts` / `classifyDomainRerankRelation` | REMOVED / SUPERSEDED |
| Domain Rerank 公式 | REMOVED |
| `candidate.domainTags` 旧字段合同 | SUPERSEDED → `domains[]` |
| `domainWeights` Vote 决策 | SUPERSEDED |
| `isFineDomainEligibleForWinning` 生产决策 | SUPERSEDED |
| 旧 VoteMass / winner 逻辑 | SUPERSEDED → Runtime SSOT |
| Assembly / KenLM 规则 | Owned by Runtime SSOT + KENLM_RUNTIME |

Context Prior 边界见 [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md)（`applied:false`，diagnostics-only）。

---

## 11. Validation

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="runtime-domain-registry|resolve-recall-enabled|freeze-contract"
npm run lexicon:gate:v3-runtime
```

---

*DSU role converged 2026-07-20 · Registry / source only*
