# Domain Source Unification（DSU）

**Status:** Frozen · **2026-06-23**  
**代码：** `lexicon-v2/runtime-domain-registry.ts` · `resolve-recall-enabled-fine-domains.ts` · `fw-detector/span-assembly-shared/domain-rerank.ts`

统一 Runtime 域可用性、层级映射、Recall scope、LLM 选域准入与 ReRank 关系判定之单一来源；消除 runtime 对 `profile-registry.json` 作为 domain 决策第二 SSOT 的依赖。

**冲突优先级：** 本文 **>** `DOMAIN_RECALL.md` · `LEXICON_RUNTIME_V2.md` · `CONFIG.md` · `ARCHITECTURE.md` 中 Domain SSOT 相关章节。

---

## Runtime SSOT

| 层 | SSOT | 说明 |
|----|------|------|
| Domain 可用集 | `term_domain_tags` | `availableFineDomains` = DISTINCT `domain_id` |
| Hierarchy | `domain_hierarchy`（sqlite，runtime 只读） | build 自 `profile-registry.json` parent 字段 |
| Owner | `RuntimeDomainRegistry` | `getRuntimeDomainRegistry()`；unloaded / empty → throw |

```text
profile-registry.json  →  build-time only
domain_hierarchy       →  runtime 只读（缺失/空 → fail-fast）
```

---

## RuntimeDomainRegistry API

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

## Recall（RS-03A）

**Owner：** `resolve-recall-enabled-fine-domains.ts`

```text
policy (fw-config.enabledDomains / job override)
  → expandPolicyToFineDomains
  → ∩ availableFineDomains
  → Recall Domain Scope
```

| 规则 | 说明 |
|------|------|
| CFG-01 | `enabledDomains` 默认 `[]` → 全量 available（`recallScopeSource=available`） |
| 非空 policy | `recallScopeSource=policy` |
| 禁止 | `profile-registry.json` 作为 recall scope owner |

---

## LLM（PAR-01）

**coarse only** — `primaryDomain` / `secondaryDomains` 须为 `llmAllowedDomains` 中的粗域。

- 细域（`coffee` · `milk_tea` · `tourism_hotel` 等）**不得**作为 `primaryDomain` 输出 → `schema_invalid`
- Prompt：`services/lexicon_intent_cpu/prompt_templates.py` · `PROMPT_PACK_VERSION=v2`

---

## Vote

证据来源 **不变**：`candidate.domainTags` · `candidate.domainWeights`（来自 Lexicon）。

Recall 仅约束 SQL 可见候选池；**不**改变 Vote 公式。`isFineDomainEligibleForWinning` 数据源为 Registry。

---

## ReRank

`classifyDomainRerankRelation` / parent-sibling 判定读 Registry `fineToCoarseMap`。

**禁止** `domain-rerank.ts` import `profile-registry` 作关系 SSOT。

Context Prior 见 [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md)（Depends On DSU）。

---

## Runtime Diagnostics

Job extra / `FwDetectorRuntimeDiag` 域字段（仅观测）：

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

## Superseded（运维文档章节）

| 源文档 | 被取代主题 |
|--------|------------|
| `DOMAIN_RECALL.md` §1 | 静态粗→细表 · registry enabled recall |
| `LEXICON_RUNTIME_V2.md` §2–3 | profile 过滤 recall · domain_lexicon 主轨 |
| `CONFIG.md` §2 | `enabledDomains`「profile 驱动」语义 |
| `ARCHITECTURE.md` §3 | profile/session 为 domain mapping 主源 |

**仍有效：** `DOMAIN_RECALL.md` §4 Vote · §5 ReRank 系数 · §6–§11 性能/Patch。

---

## Validation

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="runtime-domain-registry|resolve-recall-enabled|lexicon-profile-decision-parser|domain-rerank|freeze-contract"
npm run lexicon:gate:v3-runtime
```

| Gate | 内容 |
|------|------|
| GATE-DSU-1 ~ 5 | `freeze-contract.test.ts` |

---

## Known Technical Debt

| ID | 摘要 |
|----|------|
| TD-01 | `domain-boost-calculator.ts` legacy，V4 recall 已断开 |
| TD-02 | legacy routing `isValidLLMDomain` 非 V4 主链 |
| TD-03 | `assertRegistryDomain` on profile apply |
| TD-04 | `loadLexiconProfileRegistry` unused import |
| TD-05 | `domain_aliases` 未统一 |

---

*DSU Frozen 2026-06-23*
