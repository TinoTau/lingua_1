# Context Prior / Soft Demotion

**Status:** Frozen · **2026-06-23** · **PASS**  
**Owner:** Domain ReRank Layer  
**Depends On:** [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md)

在 Utterance Domain Vote 之后、Domain ReRank 层，按 CPU LLM coarse prior（`profile.primaryDomain`）对 eligible 候选施加 **bounded soft multiplier**。

**不是：** Recall 控制器 · Vote 控制器 · KenLM 替代。

---

## Architecture

```text
Recall → Vote → Domain ReRank → Context Prior → KenLM
```

**代码：**

| 模块 | 路径 |
|------|------|
| Multiplier / eligibility | `fw-detector/span-assembly-shared/domain-rerank.ts` |
| 接线 | `fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts` |
| Profile 传入 | `span-assembly-v4-orchestrator.ts` ← `input.profile.primaryDomain` |
| Profile 来源 | `getProfileSnapshotFromContext()`（`fw-detector-orchestrator.ts`） |

**禁止旁路：** `Recall → Context Prior` · CP 作为 Vote 控制面 · CP 修改 KenLM 输入。

---

## Inputs

| 允许 | 禁止 |
|------|------|
| `profile.primaryDomain`（coarse） | `secondaryDomains` · `pendingProfile` · `sessionIntent` |
| Registry 只读（`fineToCoarseMap`） | `profile-registry.json` hierarchy runtime import |

**Eligibility skip 原因：** `general_or_null_prior` · `invalid_coarse` · `coarse_unavailable` · `insufficient_evidence` · `registry_unavailable`

---

## Multiplier（Scheme A · Frozen）

| 场景 | 值 |
|------|-----|
| Match（fine→coarse = prior） | **1.02** |
| Mismatch | **0.96** |
| Neutral | **1.00** |
| Clamp | **0.95 ~ 1.05** |

```text
score = pick.score × rerankPenalty × contextPriorMultiplier
```

**适用：** `domain_term` · `passive_domain_weak`（排除 `base_term` · shadow 路径）

**禁止：** hard drop · candidate removal · vote modification · Recall layer `domainBoost`（V4 主链 `domainBoost=0`）

**常量：** `CONTEXT_PRIOR_MULTIPLIER_*` · `CONTEXT_PRIOR_CLAMP_*` in `domain-rerank.ts`

---

## Forbidden Owners

| 能力 | Gate |
|------|------|
| Recall | GATE-CP-03 — `resolve-recall-enabled-fine-domains` 无 `primaryDomain` |
| Vote | GATE-CP-02 — `utterance-domain-vote` 无 CP import |
| Registry mutation | GATE-CP-04 — 无 `setRuntimeDomainRegistry` |
| profile-registry | GATE-CP-01 — `domain-rerank` 不 import |

---

## Diagnostics

### Runtime（`FwDetectorRuntimeDiag`）

`contextPriorDomain` · `contextPriorApplied` · `contextPriorSkippedReason`

### SpanAssemblyV4

`contextPriorMultiplierMin` · `contextPriorMultiplierMax`

标准 Dialog200 未注入 coarse prior 时 `contextPriorApplied=0` 为正常 skip。专项验收：`tests/run-context-prior-activation-test.mjs`（`session-migration/import` 注入 profile）。

---

## Validation

```powershell
cd electron_node/electron-node
npx jest --testPathPattern="freeze-contract|domain-rerank|assemble-domain-aware-span-sets"
```

---

## Known Technical Debt

| ID | 摘要 |
|----|------|
| TD-CP-01 | `domain-boost-calculator.ts` legacy only |
| TD-CP-02 | Trace 无独立 `finalMultiplier` 字段 |
| TD-CP-03 | `missing_fine_domain` / `unknown_fine_domain` 在 per-candidate 层处理 |
| TD-CP-04 | 标准 Dialog200 无 profile 注入 → 0% CP 激活 |
| TD-CP-05 | Activation test 用 `session-migration/import`（测试设施） |

---

*Context Prior Frozen 2026-06-23*
