# Lingua1 — Stage2 Tone-Relax + Domain Preservation Pre-Development Audit

**CAN MODEL3-TRIGGERED STAGE2 SAFELY REMOVE THE TONE HARD CONSTRAINT WHILE STILL USING THE EXISTING RETAINED DOMAIN / PATH-LEVEL DOMAIN BUCKET CONTEXT TO BOUND RECALL, WITHOUT CHANGING MODEL3, MODEL2, DOMAIN VOTE, ANCHOR, OR DOWNSTREAM ASSEMBLY? — YES.**

| Field | Value |
|---|---|
| PHASE | `LINGUA_MODEL3_RETRY_STAGE2_TONE_RELAX_DOMAIN_PRESERVATION_PREDEV_AUDIT` |
| DATE | 2026-09-14 |
| MODE | READ_ONLY / ACP_DRAFT / SSOT_LOCKED |
| ACP | `LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1` → **APPROVE** |
| PRODUCT CODE CHANGE | **NO** |

---

## 1. Baseline

| Check | Result |
|---|---|
| Dataset | `LINGUA_DIALOG2000_V2_PILOT200` |
| Accepted run | `LINGUA_PILOT200_POST_ANCHOR_ACP_CONTROLLED_REMEASURE` |
| E5 CORRECT_PROFILE | 35 |
| Prior Stage2 Tone audit | PASS (exact Tone reused; cannot recover E5) |
| **BASELINE_IDENTITY** | **PASS** |

---

## 2. Current Stage2 domain call chain

```
prepareModel3PathUpstream
  → voteUtteranceDomainFromPool  (ONCE)
  → retainedDomains = vote.retainedDomains
routeModel3Retry(..., retainedDomains)
  → enumerateStage2SuccessPathQueryLocals
  → recall({ retainedDomains, syllables, span: owner })
       ↓ run-model3-path-step closure
  → recallSpanTopKV2({ domainIds: retainedDomains || [], acousticTonePattern: owner.toneRebindTrace… })
  → collectTierCandidatesToneFirst
       → base + retained-domain tiers  (Tone exact; Fail Closed if not ready)
  → materializeLocalSpanHits (m3r:…, path/region ownership)
  → mergeSpanCandidates (MERGE_SHARED_BUDGET)
  → pre-assembly / SameDomain / Assembly / KenLM
```

| Verdict field | Value |
|---|---|
| `STAGE2_DOMAIN_CONTEXT_AVAILABLE` | **YES** |
| `STAGE2_DOMAIN_CONTEXT_SOURCE` | Path Domain Vote `vote.retainedDomains` (computed once upstream) |
| `STAGE2_CURRENT_RECALL_USES_RETAINED_DOMAINS` | **YES** |
| `STAGE2_CURRENT_RECALL_DOMAIN_FILTER_MODE` | `domainIds` → base tier always + `lookupDomainsByPinyinAndToneKeyMulti(domainIds)` when non-empty; empty `domainIds` ⇒ base_only |
| `CURRENT_STAGE2_RETAINED_DOMAINS_SOURCE` | `run-model3-path-step.ts` / `prepareModel3PathUpstream` → `voteUtteranceDomainFromPool` |
| `CURRENT_STAGE2_RETAINED_DOMAINS_PASSED_TO_RECALL` | **YES** |
| `CURRENT_STAGE2_RECOMPUTES_DOMAIN_VOTE` | **NO** (`secondDomainVote: false`) |
| `CURRENT_STAGE2_PRESERVES_PATH_DOMAIN_HYPOTHESIS` | **YES** |
| `STAGE2_CAN_QUERY_DOMAIN_TERMS_WITHOUT_TONE` | **YES** (API: `lookupDomainsByPinyinKeyMulti` / `lookupBaseByPinyinKey` exist; current Stage2 blocked only by Tone readiness gate) |

Wiring:

```468:478:electron_node/electron-node/main/src/model3-runtime/run-model3-path-step.ts
    recall: ({ span, local, retainedDomains, syllables, windowText, perSpanLimit }) => {
      const result = recallSpanTopKV2(args.runtime, {
        // ...
        domainIds: retainedDomains.length ? retainedDomains : [],
        acousticTonePattern: span.toneRebindTrace?.acousticTonePattern ?? undefined,
      });
```

---

## 3. Tone relaxation delta (preferred principle)

| Rule change | Required? |
|---|---|
| `STAGE2_BASE_SOURCE_RULE_CHANGE_REQUIRED` | **NO** |
| `STAGE2_DOMAIN_SOURCE_RULE_CHANGE_REQUIRED` | **NO** |
| `TONE_RELAXATION_DELTA` | **REMOVE TONE HARD GATE ONLY** |

Target Stage2 recovery semantics:

- pinyin required  
- Tone hard gate off  
- same retainedDomains / same base+domain eligibility  
- same caps / merge / SameDomain / Assembly / KenLM  

---

## 4. Domain-bounded counterfactual (E5 = 35)

**COUNTERFACTUAL_ONLY.** Compact TRACE lacks runtime `retainedDomains`; dialogue `case.domain`→fine-domain map is **PROXY_NOT_RUNTIME**. Domain-bounded semantics still mirror production: **base ∪ domain_id∈retainedProxy**.

| Metric | Value |
|---|---:|
| `E5_GLOBAL_PINYIN_TARGET_RECOVERY` | **35** |
| `E5_DOMAIN_BOUNDED_TARGET_RECOVERY` | **35** |
| `E5_DOMAIN_BOUNDED_RECOVERY_RATE` | **1.00** |
| `GLOBAL_CANDIDATE_COUNT_MEDIAN` | 1 |
| `DOMAIN_BOUNDED_CANDIDATE_COUNT_MEDIAN` | 1 |
| `GLOBAL_CANDIDATE_COUNT_MAX` | 4 |
| `DOMAIN_BOUNDED_CANDIDATE_COUNT_MAX` | 2 |
| `TARGET_LOST_DUE_TO_DOMAIN_BOUNDING_COUNT` | **0** |
| `E5_TARGET_SURVIVES_SHARED_BUDGET` (cap=4) | **35** |

All 35 E5 targets are **inBase=true** → domain bounding cannot strip them under current Base+Domain contract.

### Domain compatibility classes

| Class | Count |
|---|---:|
| D2 base-only / no domain dependence | 23 |
| D3 domain tags not in proxy retained, but base-legal | 9 |
| D1 target domain retained (proxy) | 3 |
| Hard D3 block (domain-only + not retained) | 0 |

| Field | Value |
|---|---|
| `E5_TARGET_DOMAIN_COMPATIBLE_COUNT` | 35 |
| `E5_TARGET_DOMAIN_INCOMPATIBLE_COUNT` | 0 |
| `DOMAIN_BOUNDING_FALSE_NEGATIVE_RISK` | **LOW** |

Wrong Domain Vote is **not** fixed here; risk remains for future **domain-only** residuals (outside this E5 set).

---

## 5. Path / bucket binding

| Field | Value |
|---|---|
| `STAGE2_RECOVERY_CANDIDATE_PATH_BINDING` | **PASS** (`materializeLocalSpanHits` → region / owner FineSpan / `m3r:` ids) |
| `STAGE2_RECOVERY_DOMAIN_BUCKET_BINDING` | **PASS** (same path `retainedDomains`; no cross-path vote merge) |
| `CROSS_PATH_DOMAIN_LEAK` | **NO** |

---

## 6. Candidate contract / downstream

| Field | Value |
|---|---|
| `EXISTING_CANDIDATE_CONTRACT_SUFFICIENT` | **YES** |
| `JOBRESULT_CHANGE_REQUIRED` | **NO** |
| `NEW_PROVENANCE_REQUIRED` | **NO** (existing retry/`m3r:` provenance) |
| `STAGE2_RELAXED_CANDIDATE_REACHES_SAMEDOMAIN` | **YES** (same merge → working pool) |
| `STAGE2_RELAXED_CANDIDATE_REACHES_ASSEMBLY` | **YES** |
| `STAGE2_RELAXED_CANDIDATE_REACHES_KENLM` | **YES** |
| `DOMAIN_BOUNDED_BUDGET_PRESSURE` | **LOW** |
| `CONTROL_EXISTING_USEFUL_DROP_COUNT` | **0** (prior correct-Tone controls) |

---

## 7. Frozen owners unchanged

| Item | Required change |
|---|---|
| Model3 | **NO** |
| Model2 on Retry | **NO** |
| Model2 redesign | **NO** |
| First-pass Tone exact | **NO** |
| Domain Vote | **NO** |
| Anchor | **NO** |
| Retry budget | **NO** |
| Lexicon data / DB schema | **NO** |

---

## 8. Observability

Harness Stage2 useful still reads `hitCount` / `returnedCandidateCount` / `hits` while production emits `candidateCount` / `candidates`.

| Field | Value |
|---|---|
| `OBSERVABILITY_FIX_REQUIRED_FOR_ACCEPTANCE` | **YES** |
| `OBSERVABILITY_FIX_BUSINESS_LOGIC_CHANGE` | **NO** |

---

## 9. Implementation feasibility

| Field | Value |
|---|---|
| `ACP_DRAFT_STATUS` | **APPROVE** |
| `IMPLEMENTATION_FEASIBLE` | **YES** |
| `ARCHITECTURE_DECISION_REQUIRED` | **NO** |
| `MINIMUM_PRODUCT_FILES_TO_CHANGE` | **2** |
| `MINIMUM_TEST_FILES_TO_CHANGE` | **3** |

See `LINGUA_STAGE2_TONE_RELAX_IMPLEMENTATION_SCOPE.json`.

---

## 10. Anti-drift

First-pass exact Tone frozen · Tone remains lexical keyword · Tone≥95% unchanged · Model2 not on Retry · Model3 unchanged · Domain not Anchor · Domain Vote not rerun · retainedDomains reused · path buckets preserved · only Stage2 Tone gate relaxed · no global pinyin-only · base/domain eligibility unchanged · shared budget / SameDomain / Assembly / KenLM unchanged · zero product code this round → all **YES**.

---

## Final verdicts

```
BASELINE_IDENTITY = PASS

ACP_DRAFT_STATUS = APPROVE

STAGE2_DOMAIN_CONTEXT_AVAILABLE = YES
STAGE2_DOMAIN_CONTEXT_SOURCE = vote.retainedDomains (path Domain Vote once upstream)
STAGE2_CURRENT_RECALL_USES_RETAINED_DOMAINS = YES
STAGE2_CURRENT_RECALL_DOMAIN_FILTER_MODE = domainIds→base + retained-domain tone-exact tiers (empty⇒base_only)

CURRENT_STAGE2_RETAINED_DOMAINS_SOURCE = prepareModel3PathUpstream / voteUtteranceDomainFromPool
CURRENT_STAGE2_RETAINED_DOMAINS_PASSED_TO_RECALL = YES
CURRENT_STAGE2_RECOMPUTES_DOMAIN_VOTE = NO
CURRENT_STAGE2_PRESERVES_PATH_DOMAIN_HYPOTHESIS = YES
STAGE2_CAN_QUERY_DOMAIN_TERMS_WITHOUT_TONE = YES

STAGE2_BASE_SOURCE_RULE_CHANGE_REQUIRED = NO
STAGE2_DOMAIN_SOURCE_RULE_CHANGE_REQUIRED = NO

E5_CASE_COUNT = 35
E5_GLOBAL_PINYIN_TARGET_RECOVERY = 35
E5_DOMAIN_BOUNDED_TARGET_RECOVERY = 35
E5_DOMAIN_BOUNDED_RECOVERY_RATE = 1.00
GLOBAL_CANDIDATE_COUNT_MEDIAN = 1
DOMAIN_BOUNDED_CANDIDATE_COUNT_MEDIAN = 1
GLOBAL_CANDIDATE_COUNT_MAX = 4
DOMAIN_BOUNDED_CANDIDATE_COUNT_MAX = 2
TARGET_LOST_DUE_TO_DOMAIN_BOUNDING_COUNT = 0

E5_TARGET_DOMAIN_COMPATIBLE_COUNT = 35
E5_TARGET_DOMAIN_INCOMPATIBLE_COUNT = 0
DOMAIN_BOUNDING_FALSE_NEGATIVE_RISK = LOW

STAGE2_RECOVERY_CANDIDATE_PATH_BINDING = PASS
STAGE2_RECOVERY_DOMAIN_BUCKET_BINDING = PASS
CROSS_PATH_DOMAIN_LEAK = NO

EXISTING_CANDIDATE_CONTRACT_SUFFICIENT = YES
JOBRESULT_CHANGE_REQUIRED = NO
NEW_PROVENANCE_REQUIRED = NO

E5_TARGET_SURVIVES_SHARED_BUDGET = 35
CONTROL_EXISTING_USEFUL_DROP_COUNT = 0
DOMAIN_BOUNDED_BUDGET_PRESSURE = LOW

STAGE2_RELAXED_CANDIDATE_REACHES_SAMEDOMAIN = YES
STAGE2_RELAXED_CANDIDATE_REACHES_ASSEMBLY = YES
STAGE2_RELAXED_CANDIDATE_REACHES_KENLM = YES

MODEL3_CHANGE_REQUIRED = NO
MODEL2_ON_RETRY = NO
MODEL2_CHANGE_REQUIRED = NO
NORMAL_FIRST_PASS_TONE_POLICY_CHANGE_REQUIRED = NO
RETRY_BUDGET_CHANGE_REQUIRED = NO
DOMAIN_VOTE_CHANGE_REQUIRED = NO
ANCHOR_CHANGE_REQUIRED = NO
LEXICON_DATA_CHANGE_REQUIRED = NO
DB_SCHEMA_CHANGE_REQUIRED = NO

OBSERVABILITY_FIX_REQUIRED_FOR_ACCEPTANCE = YES
OBSERVABILITY_FIX_BUSINESS_LOGIC_CHANGE = NO

MINIMUM_PRODUCT_FILES_TO_CHANGE = 2
MINIMUM_TEST_FILES_TO_CHANGE = 3

PRODUCT_CODE_CHANGE_THIS_ROUND = NO
ARCHITECTURE_DECISION_REQUIRED = NO
IMPLEMENTATION_FEASIBLE = YES
AUDIT_STATUS = PASS

ONE_NEXT_OWNER = STAGE2_TONE_RELAXATION_IMPLEMENTATION_OWNER
ONE_NEXT_DELTA = Implement only the ACP-approved Model3-triggered bounded local pinyin-only Stage2 recall while preserving retained domain context, existing source eligibility, path-level domain buckets, shared budget, SameDomain, Assembly, and KenLM
```

### Artifacts

1. `LINGUA_ACP_MODEL3_RETRY_STAGE2_TONE_RELAXATION_V1.md`  
2. `LINGUA_STAGE2_TONE_RELAX_DOMAIN_PREDEV_AUDIT.md` (this file)  
3. `LINGUA_STAGE2_TONE_RELAX_DOMAIN_CASE_MATRIX.csv`  
4. `LINGUA_STAGE2_TONE_RELAX_IMPLEMENTATION_SCOPE.json`  

**STOP.**
