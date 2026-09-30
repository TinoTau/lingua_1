# Lingua Model2 V3 — Stage J Lexicon Soft-Prior Yield / Architecture Drift Audit
# Date: 2026-08-17

**Stage:** `MODEL2_V3_STAGE_J_LEXICON_SOFT_PRIOR_YIELD_ARCHITECTURE_DRIFT_AUDIT`  
**Mode:** AUDIT ONLY / READ ONLY  
**Production code modified:** 0  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_soft_prior_yield_audit/`

Did not train, fine-tune, change config, change lexicon, change benchmark, change checkpoint, or change tests.

Authoritative inputs: Stage J Production Benchmark V2 Expansion Report; J1 Blind Production Benchmark Acceptance Report.

---

## Verdict (short)

Current Stage D is **domain-conditioned reweighting of a shared phonetic FuzzyPool**, not domain-conditioned candidate expansion.

On the true domain-term population:

- 655 `domain:` records / **588 unique (surface, pinyin_key) identities**
- Exact FineSpan = term syllables: **588/588 BASE_VISIBLE_SIBLING_IDENTITY** (100%)
- True D opportunity on exact FineSpan: **0%**
- Relation-corrupted observations (N=698): 94.6% still BASE_VISIBLE; **38** BASE_ABSENT; raw phonetic hit **38/38**; pool32 keeps **13**; top-8 keeps **4**; FINAL INTRODUCED **4**

Largest attrition is **legitimate BASE_VISIBLE**. The suspicious remainder is **shared phonetic top-k (32 then 8)**, not a missing SQL hit and not Model2 action selection.

**ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED** — freeze remains; no fix this round.

---

## 1. Highest-priority question

Is Stage D true **DOMAIN-CONDITIONED CANDIDATE EXPANSION**, or **DOMAIN-CONDITIONED REWEIGHTING of already-visible candidates**?

**Answer: MOSTLY_REWEIGHTING. Label: ARCHITECTURE_DRIFT.**

Not rationalized as “soft prior semantics.” Soft prior (never hard-filter) is frozen and still holds. The drift is: there is **no domain-tag retrieval branch**. `soft_domain_retrieve` rebuilds the **same** phonetic pool with k=32, reranks by domain match, and cuts to 8.

```59:108:training/model2_v3/policy/domain_actions.py
def soft_domain_retrieve(...):
    """Expand FuzzyPool then soft-rerank by domain prior (never hard-filter)."""
    ...
    pool = build_fuzzy_pool(
        index,
        FuzzyPoolRequestV1("", syls, len(syls), max_pool_size=pool_size),  # 32
    )
    # score = distance - 2.5 * domain_match - 1e-4 * prior
    term_ids = [t for _, t in ranked[:max_cands]]  # 8
```

Contrast — Node still has a real domain query (not on this Python path):

```111:133:electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts
export function queryDomainMultiRowsAtomic(...)
  // WHERE d.domain_id IN (...) AND d.pinyin_key = ? AND length(d.word) = ?
```

---

## 2. Population (not the 45 eligible rows)

| Unit | N |
|------|--:|
| V2 reported scan | 655 |
| Actual `term_type=domain` records | **655** |
| Unique lexical identities (surface, pinyin_key) | **588** |
| Unique surfaces | 588 |
| Duplicate identity groups (multi-row flatten) | 44 |
| Base-type records in same index | 9259 |

655 → 33 unique D terms is **not** a tag/index disappearance. It is: exact identity is already in mixed base FuzzyPool@16; only a sparse observation-noise subset falls out of top-16 and then survives pool32+top-8.

---

## 3. Term / tag integrity

SSOT CSV: `electron_node/docs/lexicon-assets/full_rebuild_v1/term_domain_tags_corrected.csv`  
Index: D2 `enrich_index_multitag` already applied.

| Check | N |
|-------|--:|
| Missing tag | 0 |
| Multi-tag identities | 44 |
| First-tag-only vs SSOT | 0 |
| SSOT tags missing on record | 0 |
| Orphan SSOT words not in index surface | 8 |
| Unregistered domain ids | 0 |

Unenriched sqlite path is still first-tag flatten (`index.py` L118 `domain_ids=[row["domain_id"]]`). This D2 snapshot is enriched. Classification: historical first-tag is **not** the cause of 655→33.

---

## 4. Base visibility (core result)

### Exact FineSpan = term syllables (N=588)

| Class | N | % |
|-------|--:|--:|
| BASE_VISIBLE_EXACT | 0 | 0 |
| BASE_VISIBLE_FUZZY | 0 | 0 |
| BASE_VISIBLE_SIBLING_IDENTITY | **588** | **100** |
| BASE_ABSENT | **0** | **0** |

Why visible: `base_retrieve_span` (`finespan_retrieval.py` L89–107) runs FuzzyPool over the **mixed** index. Domain-type rows are searchable as “base.” Surface dedup (`pool.py` L124–135) sorts `(distance, -prior, term_id)` so `"base:" < "domain:"` and keeps the base sibling. Identity contract (`stage_d_target_identity_v1.py`) treats (surface, pinyin_key) as the target, so the base sibling **is** a hit.

This is **not** a bug in base recall. It is **system success**. Stage D must not steal that credit.

### Relation-corrupted observations (N=698; ACTIVE_SET_V1 one-edit)

| Class | N | % |
|-------|--:|--:|
| BASE_VISIBLE_FUZZY | 660 | 94.56 |
| BASE_ABSENT | 38 | 5.44 |

Distance-1 observations usually remain inside mixed pool@16.

---

## 5. Attrition funnel

Two funnels are required. Exact FineSpan answers “why 655 become ~33 terms.” Corrupted observations answer Hypothesis B (base-absent but cannot introduce).

### Table A — exact lexical FineSpan (population unit = unique identity)

| Stage | Input N | Survive N | Lost N | Loss % | Primary Cause |
|---|---:|---:|---:|---:|---|
| Domain population | 588 | 588 | 0 | 0 | 655 records / 588 identities |
| Valid tags | 588 | 588 | 0 | 0 | all tagged in DOMAIN_SLOT_IDS |
| Valid FineSpan | 588 | 588 | 0 | 0 | all lengths in lattice 1..5 |
| Base absent | 588 | 0 | 588 | 100 | mixed FuzzyPool@16 already has identity |
| Action available | 0 | 0 | 0 | — | — |
| Raw domain hit | 0 | 0 | 0 | — | — |
| Fuzzy survive | 0 | 0 | 0 | — | — |
| Merge survive | 0 | 0 | 0 | — | — |
| Dedup survive | 0 | 0 | 0 | — | identity kept as base sibling |
| Top-k survive | 0 | 0 | 0 | — | — |
| Budget survive | 0 | 0 | 0 | — | — |
| Model2 output | 0 | 0 | 0 | — | nothing to introduce |
| Downstream visible | 0 | 0 | 0 | — | Node sameDomain not in this path |

### Table B — relation-corrupted observations (production-like D path)

| Stage | Input N | Survive N | Lost N | Loss % | Primary Cause |
|---|---:|---:|---:|---:|---|
| Domain population (obs) | 698 | 698 | 0 | 0 | applicable ACTIVE_SET edits only |
| Valid tags | 698 | 698 | 0 | 0 | — |
| Valid FineSpan | 698 | 698 | 0 | 0 | — |
| Base absent | 698 | 38 | 660 | 94.56 | still in mixed pool@16 |
| Action available | 38 | 38 | 0 | 0 | catalog has all 12 slots |
| Raw domain hit | 38 | 38 | 0 | 0 | phonetic distance≤2; **no domain SQL** |
| Fuzzy survive | 38 | 38 | 0 | 0 | identity survives surface dedup |
| Merge / pool32 survive | 38 | 13 | 25 | 65.79 | shared phonetic cap k=32 (rank>32) |
| Dedup survive (identity) | 13 | 13 | 0 | 0 | domain: term_id dropped; lexical identity kept |
| Top-k survive | 13 | 4 | 9 | 69.23 | soft rerank rank>8 |
| Budget survive | 4 | 4 | 0 | 0 | top-k **is** the budget |
| Model2 output / FINAL INTRODUCED | 4 | 4 | 0 | 0 | oracle execute |
| Downstream visible | 4 | 4 | 0 | — | not measured in Node assembly |

---

## 6. Code locations per stage

| Stage | File | Function / class | Lines | Input | Output | Decision |
|-------|------|-------------------|-------|-------|--------|----------|
| T0 FineSpan | `training/model2/retrieval/finespan.py` | `FineSpanView` | 27–41 | syllables 1..5 | span view | lattice window contract |
| T1 Base raw | `finespan_retrieval.py` | `base_retrieve_span` | 89–107 | FineSpan | term_ids k=16 | mixed FuzzyPool |
| T1 internals | `training/model2/fuzzy/pool.py` | `build_fuzzy_pool` | 78–147 | syllables | hits | dist≤2, len±1, surface dedup, cap |
| T2 Action space | `domain_actions.py` | `build_domain_action_catalog` | 28–31 | `DOMAIN_SLOT_IDS` | 13 actions | static catalog |
| T2 Execute | `domain_actions.py` | `execute_domain_action` | 111–154 | action + evidence | focused weights | `max(0.35, sel)` |
| T3 Domain raw | `domain_actions.py` | `soft_domain_retrieve` | 84–87 | same syllables | pool k=32 | **not** domain-tag query |
| T4 Rerank | `domain_actions.py` | `soft_domain_retrieve` | 88–99 | pool hits | top-8 | score promote |
| T5 Dedup | `pool.py` | `build_fuzzy_pool` | 126–135 | scored hits | first surface | term_id ASC |
| T6 Budget | same as T4 | max_cands=8 | 66, 99 | ranked | 8 ids | stacked with k=32 |
| T7 Model2 out | eval harness | `execute_domain_action` | — | oracle action | term_ids | this audit uses oracle, not J1 |
| T8 sameDomain | `assemble-domain-aware-span-sets.ts` | `isSameDomainCandidate` | 27–35 | WindowCandidate | buckets | **not** Model2 yield |
| T9 Assembly quota | `apply-domain-prior-quota.ts` | `applyDomainPriorQuota` | 33–80 | picks | limit, prior≤2 | downstream only |

Identity: `training/model2_v3/policy/stage_d_target_identity_v1.py` `target_hit` L44–73.

---

## 7. Oracle action / raw query

Among BASE_ABSENT corrupted (N=38): **ACTION_AVAILABLE = 38**. No MODEL2 selection involved yet.

RAW_QUERY_HIT definition used: identity in the phonetic **scored** set (distance≤2, length±1) **before** surface-dedup cap. There is no domain-tag SQL on this path.

- RAW_QUERY_HIT: **38**
- RAW_QUERY_MISS: **0**

Hypothesis “SQL/tag/pinyin miss” is **false** for this population. Distance-1 always passes `FUZZY_DISTANCE_THRESHOLD=2`.

---

## 8. Pipeline after raw hit (the suspicious slice)

Rank after soft rerank on pool32 (BASE_ABSENT N=38):

| Bucket | N |
|--------|--:|
| not in pool32 (not_returned) | 25 |
| rank 1 | 3 |
| rank 2 | 1 |
| rank 3–8 | 0 |
| rank >8 | 9 |

`DOMAIN_PIPELINE_RETENTION` = 4/38 = **0.1053**.

The 16-slot window (unlimited-dedup ranks 17–32) is the **only** expansion capacity of Stage D. Count of corrupted traces in that window: **13**. All 4 introductions sit there (examples: 加冰 rank 21→rerank 1; 加料 25→2; 带走 18→1; 菜单 26→1).

Phonetic neighborhood is huge: typical 2-syllable query has ~7900 distance-pass hits, ~7600 after surface dedup. Caps 16/32/8 are doing almost all of the selection.

---

## 9. Surface dedup

Corrupted N=698: **698 DOMAIN_IDENTITY_DROPPED_BUT_LEXICAL_TARGET_SURVIVED**.  
**0 LEXICAL_TARGET_DROPPED.**

Original purpose: one surface slot, control explosion.  
Current precedence `base > domain` is **term_id ASC tie-break**, not a frozen design document. Label: **UNJUSTIFIED_IMPLEMENTATION_BEHAVIOR**. Under StageDRetrievalTargetIdentityV1 this does **not** by itself create BASE_ABSENT.

---

## 10. Soft prior semantics (code)

| | |
|--|--|
| A extra retrieval branch | PARTIAL — second FuzzyPool, same query key |
| B wider query scope | NO |
| C score promote | YES (−2.5 × domain_match) |
| D rerank already-returned | YES (pool32) |
| E top-k | YES (8) |
| F budget | YES |
| G other | 0.35 floor; residual ×0.05; never hard-filter |

UserProfile does **not** change the query universe (`pool.py` L84–85). On 38 BASE_ABSENT oracle cases: Correct/Empty/Wrong identity hits are **all 4**. Correct vs Empty final id lists identical in 37/38.

---

## 11. Expansion vs reweighting

| Slice | Executed | New lexical set | Reweighted | Expansion Yield | Target Expansion Yield |
|-------|--------:|----------------:|-----------:|----------------:|-----------------------:|
| Exact FineSpan | 588 | 49 | 539 | 0.0833 | **0.0000** |
| All corrupted | 698 | 60 | 638 | 0.0860 | **0.0057** |
| BASE_ABSENT only | 38 | 5 | 33 | 0.1316 | **0.1053** |

“New lexical” is almost always **some other** phonetic neighbor from ranks 17–32, not the intended domain target (exact Target Expansion Yield = 0).

---

## 12. TRUE_D_OPPORTUNITY_RATE / retention

`TRUE_D_OPPORTUNITY_RATE` = BASE_ABSENT ∧ raw phonetic can recover.

| Population | Rate |
|------------|------|
| Exact FineSpan (588) | **0.000** |
| Corrupted observations (698) | **0.0544** (38/698) |
| Per-term any relation (588) | **0.0544** (32/588 terms ever BASE_ABSENT) |
| Terms with FINAL INTRODUCED | **4 / 588** |

Stage D is a **long tail** under the current retrieval architecture. Opportunity is sparse **before** Model2 selection.

---

## 13. Root-cause buckets

### Corrupted observations (N=698)

| Bucket | N | % |
|--------|--:|--:|
| A NO_D_OPPORTUNITY (base sufficient) | 660 | 94.56 |
| B DATA_OR_INDEX_LIMITATION | 0 | 0 |
| C RETRIEVAL_PIPELINE_ATTRITION (raw hit, final miss) | 34 | 4.87 |
| D MODEL_SELECTION_OPPORTUNITY (oracle+pipeline introduce) | 4 | 0.57 |

### Exact FineSpan (N=588)

A = 588 (100%).

### Required root-cause table

| Root Cause | N (corrupt obs) | % | Architecture Drift? | Fix Layer |
|---|---:|---:|---|---|
| Base already sufficient | 660 | 94.56 | NO | NONE |
| FineSpan contract | 0 (exact); Phase2 off-by-1 is test | — | TEST_CONTRACT_ISSUE | benchmark generator only |
| Domain tag/index | 0 missing tags | 0 | mild SSOT catalog | none for yield |
| Raw query miss | 0 | 0 | drift is **no domain query**, but phonetic still hits | architecture (not SQL bug) |
| Fuzzy filter (distance) | 0 among BASE_ABSENT | 0 | NO | NONE |
| Dedup (lexical drop) | 0 | 0 | unjustified base>domain term_id | none for identity yield |
| Top-k (rank>8) | 9 | of 13 in pool32 | YES budget stacking | architecture / budget ownership |
| Budget (rank>32) | 25 | of 38 raw hits | YES BUDGET_OWNERSHIP_DRIFT | architecture |
| Model selection | 4 oracle successes | 0.57 | NO | do **not** train J2 now |
| Downstream sameDomain | not in Python path | — | separate | Node T8; do not count as Model2 |

---

## 14. Zero coverage

### tech_ai / meeting / medical

| Domain | Unique identities | Exact BASE_VISIBLE | Corrupt BASE_ABSENT | Raw hit | Introduced | Primary |
|--------|------------------:|-------------------:|--------------------:|--------:|-----------:|---------|
| tech_ai | 53 | 53 | 1 | 1 | 0 | TOPK_PRUNE (the 1 miss is pipeline, not missing data) |
| meeting | 41 | 41 | 0 | 0 | 0 | BASE_VISIBLE |
| medical | 130 | 130 | 9 | 9 | 0 | TOPK_PRUNE |

Not “low support” as a slogan: **meeting has data (41 identities) but zero BASE_ABSENT** under ACTIVE_SET edits. medical/tech_ai have sparse BASE_ABSENT that die in pool32/top-8.

### sh_s / eng_en / h_f

| Relation | Attempted | No applicable edit | BASE_ABSENT | Introduced | Primary |
|----------|----------:|-------------------:|------------:|-----------:|---------|
| sh_s | 106 | 482 | 11 | 0 | TOPK_OR_BUDGET |
| eng_en | 80 | 508 | 6 | 0 | TOPK_OR_BUDGET |
| h_f | 121 | 467 | 1 | 0 | TOPK_OR_BUDGET |

Not missing lexicon for those relations. Edits exist; they remain visible or lose the phonetic top-k. Introductions that did occur: n_l, z_zh, ch_c, in_ing (1 each).

---

## 15. FineSpan length (Phase2 6510)

All **6510** domain-target Phase2 rows have `|span_len − term_len| = 1`. They are lattice windows, not gold-term-aligned. V2 generator only skips `>1`, then caps tries at 120 → 0 extra unique D.

Classification: **TEST_CONTRACT_ISSUE**. Production FineSpan remains 1..5 lattice. **FINESPAN_CONTRACT_DRIFT = NO** for Model2 input. Do not treat this as a Model2 architecture change.

---

## 16. GENERIC_OVERBIAS / Wrong / Swapped (causal only)

Causal chain (no fix):

1. FuzzyPool generation ignores profile.  
2. `execute_domain_action` still sets selected domain to **max(0.35, sel)** when evidence is empty.  
3. Domain action always fills **8** phonetic slots.  
4. Therefore empty-profile unnecessary expansion and Wrong/Swapped TIR can stay high **without** a correct domain universe.

On 38 oracle BASE_ABSENT cases, Empty and Wrong still identity-hit the same **4** successes as Correct. Wrong TIR on V2 eligible is therefore largely **shared pool + 0.35 floor + multi-tag overlap**, not proof that wrong profiles are semantically correct.

Overlapping labels (not mutually exclusive): D domain-pool overlap; E soft prior wide (0.35); A multi-domain (44 identities); B generic ≥3 tags; F budget filled by phonetic neighbors.

---

## 17. Shadow / double recall / historical

| Path | On Python Stage D? |
|------|-------------------|
| `soft_domain_retrieve` FuzzyPool | YES — only D expansion path in J1 eval |
| Node `queryDomainMultiRowsAtomic` | NO |
| `local-span-recall` enabledDomains | NO |
| P-path `merge_pools` | NO for D actions |

**DOUBLE_RECALL in J1 Python eval: NO.**  
**SHADOW_PATH if future runtime wires Model2 D AND keeps Node domain SQL: YES_AT_RUNTIME_IF_BOTH_WIRED.** J1 is not runtime-wired.

---

## 18. Representative traces

Full set: `stage_boundary_trace.jsonl` (100 lines: 20 BASE_VISIBLE, RAW_QUERY_MISS=0 so none, 20 RAW_HIT_FINAL_MISS, 4 SUCCESSFUL_INTRODUCTION, per-domain samples, V2 eligible).

Successful introductions (all ranks 17–32 → rerank 1–2):

- 加冰 / `jia|bing` ← `jia|bin` (in_ing), coffee, pool32 rank 21 → rerank 1  
- 加料 / `jia|liao` ← `jia|niao` (n_l), food_order, rank 25 → 2  
- 带走 / `dai|zou` ← `dai|zhou` (z_zh), bakery, rank 18 → 1  
- 菜单 / `cai|dan` ← `chai|dan` (ch_c), bakery, rank 26 → 1  

RAW_HIT_FINAL_MISS example: 香菜 `xiang|cai` ← `xiang|chai` — Correct/Empty/Wrong final lists are identical 8 **base:** phonetic neighbors; target never enters top-8.

---

## 19. Architecture drift inventory (summary)

See `architecture_drift_inventory.csv`.

| ID | Class |
|----|--------|
| D1 no domain query, rerank pool32 | **ARCHITECTURE_DRIFT** |
| D2 mixed index in base recall | EXPECTED_IMPLEMENTATION |
| D3 base>domain via term_id sort | UNJUSTIFIED_IMPLEMENTATION_BEHAVIOR |
| D5 0.35 floor | EXPECTED_IMPLEMENTATION of soft prior |
| D6 16→32→8 stacking | **BUDGET_OWNERSHIP_DRIFT** |
| D7 static DOMAIN_SLOT_IDS | DOMAIN_SSOT_DRIFT (mild) |
| D8 Node SQL unused by Python D | HISTORICAL_DEAD_LOGIC on this path |
| D9 Phase2 vs D generator | TEST_CONTRACT_ISSUE |
| D10 never hard-filter | FROZEN_DESIGN |

---

## 20. ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED

Do not implement this round.

| | |
|--|--|
| Current frozen behavior | Soft rerank of mixed phonetic FuzzyPool; never hard-filter; k=32 then 8 |
| Original intended behavior | FineSpan + UserProfile → learned retrieval policy → **Lexicon fuzzy recall expansion** of the FineSpan candidate set, using pronunciation **and** lexical/domain evidence |
| Conflict | Domain evidence does not open a domain-conditioned recall universe; exact domain targets are already base-visible; remaining yield is ranks 17–32 of a huge phonetic list |
| Evidence | this report; `domain_actions.py` L59–108; exact BASE_ABSENT=0; retention 4/38 |
| Minimum possible change (proposal only) | Keep soft prior (do not hard-filter). Add a **domain-conditioned retrieval branch** whose results **union** into the candidate set, then apply downstream KenLM/Assembly budgets. Do not weaken base recall. |
| Affected modules | `domain_actions.py` `soft_domain_retrieve`; possibly FuzzyPool request shape; **not** J1 weights; Node SQL already exists and must not be silently double-wired |

Wait for the user to choose: accept sparse D, expand data (will not fix exact BASE_VISIBLE=100%), or commission the proposal.

---

## 21. Is Model2 still necessary?

In the real BASE_ABSENT ∧ DOMAIN_RECOVERABLE ∧ pipeline-retained space, oracle introductions = **4 observations / 4 terms**.

Model2 action selection is **not** the current bottleneck. Opportunity is **SPARSE**. Do not manufacture demand. Do not train J2. Do not retrain J1.

---

Lexicon Soft-Prior Yield Audit:
DRIFT_FOUND


Original Model2 Expansion Intent:
PARTIALLY_PRESERVED


Current Stage-D Behavior:
MOSTLY_REWEIGHTING


Total Domain Target Population:
655 domain-type records / 588 unique identities


Valid FineSpan Cases:
588 (exact) ; 698 (relation-corrupted observations)


Base Visible:
588 / 588 = 100% (exact) ; 660 / 698 = 94.56% (corrupted)


Base Absent:
0 / 588 = 0% (exact) ; 38 / 698 = 5.44% (corrupted)


Oracle Action Available:
38 / 38 BASE_ABSENT corrupted


Raw Domain Query Hit:
38 (phonetic scored-set; no domain SQL)


Raw Domain Query Miss:
0


Raw→Final Retention:
4 / 38 = 0.1053


Final Introduced:
4 (corrupted oracle) ; 0 (exact)


True D Opportunity Rate:
0.000 exact ; 0.0544 corrupted observations ; 0.0544 per-term any relation (32/588)


Expansion Yield:
0.0833 exact ; 0.0860 corrupted (mostly non-target neighbors)


Target Expansion Yield:
0.000 exact ; 0.0057 corrupted all ; 0.1053 among BASE_ABSENT


====================
ROOT CAUSE
====================

Largest Attrition Stage:
BASE_VISIBLE (mixed FuzzyPool@16 already contains the lexical identity)


Largest Legitimate Attrition:
BASE_VISIBLE — base recall succeeding; do not weaken it


Largest Suspicious Attrition:
Shared phonetic pool cap 32 (25/38) then soft top-8 (9/13) — BUDGET_STACKING on a non-domain query


Primary Root Cause:
Stage D Python path is domain-conditioned REWEIGHTING of the same phonetic candidate universe, not domain-conditioned expansion


Secondary Root Cause:
Candidate budget applied during expansion (16/32/8) on a very large distance≤2 neighborhood


====================
DRIFT
====================

Architecture Drift Found:
YES


Drift Location:
training/model2_v3/policy/domain_actions.py  soft_domain_retrieve  L59-108
(supporting: finespan_retrieval.py base_retrieve_span L89-107 mixed index; pool.py L124-135)


Original Intended Behavior:
UserProfile (pronunciation + lexical/domain) selects retrieval expansion; Lexicon fuzzy recall enlarges the FineSpan candidate set


Current Actual Behavior:
Same FineSpan syllables → larger phonetic FuzzyPool (32) → domain-match rerank → top-8; query universe does not depend on domain tags or UserProfile


When/Why Introduced:
Stage D Python soft-prior implementation (never-hard-filter) used FuzzyPool rerank instead of a domain-tag retrieval branch. Node SQL domain lookup remains on a different path.


Historical Logic Affecting Path:
YES (Node domain SQL exists but is unused by Python D; sqlite first-tag flatten is historical and already enriched on D2 index)


Shadow / Double Recall:
NO in J1 Python eval ; YES_AT_RUNTIME_IF_BOTH_WIRED


Budget Ownership Drift:
YES


Domain SSOT Drift:
YES (mild — static DOMAIN_SLOT_IDS catalog)


FineSpan Contract Drift:
NO (production FineSpan unchanged; Phase2 vs D generator is TEST_CONTRACT_ISSUE)


====================
ZERO COVERAGE
====================

tech_ai:
53 identities; exact all BASE_VISIBLE; 1 BASE_ABSENT corrupt dies in top-k/budget; eligible=0


meeting:
41 identities; exact all BASE_VISIBLE; 0 BASE_ABSENT under ACTIVE_SET edits; eligible=0


medical:
130 identities; exact all BASE_VISIBLE; 9 BASE_ABSENT corrupt, 0 introduced (pool32/top-8); eligible=0


sh_s:
106 attempted; 11 BASE_ABSENT; 0 introduced (TOPK_OR_BUDGET)


eng_en:
80 attempted; 6 BASE_ABSENT; 0 introduced (TOPK_OR_BUDGET)


h_f:
121 attempted; 1 BASE_ABSENT; 0 introduced (TOPK_OR_BUDGET)


====================
MODEL2
====================

Oracle Retrieval Opportunity:
SPARSE


Model Selection Is Current Bottleneck:
NO


Model Retraining Recommended Now:
NO


J2 Recommended Now:
NO


====================
NEXT STEP
====================

Fix Existing Implementation:
NO (this round)


Architecture Change Required:
PROPOSAL_REQUIRED


Data Expansion Required:
NO as the primary lever (exact FineSpan opportunity is structurally 0)


Recommended Next Phase:
User chooses: (1) accept Stage D as naturally sparse under frozen mixed FuzzyPool + soft rerank; (2) commission Architecture Change Proposal for a domain-conditioned UNION branch that stays soft (no hard filter, no weaker base); (3) only then revisit J2. Do not train. Do not swap runtime. Do not modify retrieval until that choice.
