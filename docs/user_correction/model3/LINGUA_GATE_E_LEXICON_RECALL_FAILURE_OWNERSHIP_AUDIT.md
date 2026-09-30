# LINGUA Gate E — Lexicon Recall Failure Ownership Audit

| Field | Value |
|---|---|
| PHASE | `LINGUA_MODEL2_GATE_E_LEXICON_RECALL_FAILURE_OWNERSHIP_AUDIT` |
| DATE | 2026-09-14 |
| MODE | READ_ONLY / TRACE_FIRST / SSOT_LOCKED |
| DATASET | `LINGUA_DIALOG2000_V2_PILOT200` |
| ACCEPTED RUN | `LINGUA_PILOT200_POST_ANCHOR_ACP_CONTROLLED_REMEASURE` |
| TRACE | `LINGUA_PILOT200_POST_ANCHOR_ACP_REMEASURE_TRACE.jsonl` |
| PRODUCT CODE CHANGE | **NO** |

---

## 0. Central answer

Of the current **158** evaluator labels `LEXICON_RECALL` (Gate D PASS / Gate E FAIL):

| Distinction | Count |
|---|---:|
| **TRUE Lexicon recall engine miss (E6)** | **0** |
| Upstream query that could never legally retrieve target (E2+E3+E4) | **119** |
| Tone-key mismatch after ready (E5) | **35** |
| Target returned but evaluator misclassified (E7) | **4** |
| Target not in Lexicon (E1) | **0** |

`LEXICON_RECALL = 158` is an **evaluator bucket**, not a Lexicon-engine defect count.

Research population **CORRECT_PROFILE** dominant class: **E5_TONE_KEY_MISMATCH_AFTER_READY (35 / 71 = 49.3%)**.

---

## 1. Baseline identity

| Check | Result |
|---|---|
| Dataset | `LINGUA_DIALOG2000_V2_PILOT200` |
| Runs | 200 × 3 = **600** |
| Gate D PASS | **161** / 314 |
| Gate E PASS | **3** / 314 |
| Gate D PASS / E FAIL | **158** |
| `firstFailureOwner=LEXICON_RECALL` | **158** |
| Prior failure-matrix runId alignment | **EXACT 158/158** (no stale pre-ACP mix) |
| **BASELINE_IDENTITY** | **PASS** |

Gate E PASS controls (all CORRECT): `p2_u002_013`, `p2_u002_037`, `p2_u004_001`（生成）.

---

## 2. Gate D / Gate E evaluator semantics

**Location:** `electron_node/electron-node/tests/run-pilot200-post-anchor-acp-remeasure.mjs` (`evaluateRun`)

### Gate D

After A/B/C PASS:

- window-local / FineSpan-local tone pattern present
- `length == targetLen`
- source `WINDOW_LOCAL` | `FINESPAN_LOCAL` (null source treated valid)

### Gate E

After A–D PASS, on the **harness-chosen** window only:

- among `p_retrieval.queries` with `query.length == targetLen`
- any hit with `surface == targetSurface` **or** `termId ∈ evaluationTargetTermIds`

| Verdict field | Value |
|---|---|
| `GATE_E_ACTUALLY_MEASURES_LEXICON_RETURN` | **PARTIAL** |
| `EVALUATOR_SEMANTIC_DRIFT` | **YES** |

Drift sources:

1. Owner label `LEXICON_RECALL` does **not** mean Lexicon engine miss.
2. Gate E ignores target hits on non-chosen windows → **E7 false negatives**.

---

## 3. CORRECT_PROFILE (primary research population)

| Metric | Count |
|---|---:|
| Gate D PASS | 74 |
| Gate E PASS | 3 |
| Gate D PASS / E FAIL | **71** |

| Class | Count | % of 71 |
|---|---:|---:|
| E1 target not in Lexicon | 0 | 0.0% |
| E2 target region not representable | 3 | 4.2% |
| E3 compound residual outside Model2 relation | 14 | 19.7% |
| E4 Model2 relation output not target-reachable | 15 | 21.1% |
| **E5 tone-key mismatch after ready** | **35** | **49.3%** |
| E6 final query should match but engine miss | 0 | 0.0% |
| E7 target returned but evaluator misclassified | 4 | 5.6% |
| E8 other | 0 | 0.0% |

---

## 4. WRONG_PROFILE control

| Metric | Count |
|---|---:|
| Gate D PASS / E FAIL | 87 |
| E2 | 3 |
| E4 | 84 |
| E1/E3/E5/E6/E7/E8 | 0 |

Same Lexicon engine: wrong-profile global relation produces **expected-but-irrelevant** queries; engine consistently returns empty for those keys. Not an engine defect.

---

## 5. Class evidence (earliest causal boundary)

### E1 — target not in Lexicon
**0.** RO query of authoritative `node_runtime/lexicon/v3/lexicon.sqlite`: **109/109** unique targets present.

### E2 — region not representable (deferred)
Cases: `p2_u002_005` 资料库, `p2_u004_015` 奶黄酥, `p2_u005_038` 候客室  
Status: `DEFERRED_FINESPAN_BOUNDARY_SSOT_CHECK` — ASR-internal spaces as hard FineSpan boundaries. **Not Lexicon.**

### E3 — compound residual outside Model2 relation
Authoritative B1 set (14 CORRECT runs), e.g.:

| Case | Target | Transformed | Canonical | Note |
|---|---|---|---|---|
| `p2_u001_039` | 牛肉串 | `niu\|ruo\|chuan` | `niu\|rou\|chuan` | n_l applied; ruo≠rou residual |
| `p2_u003_016` | 换乘 | `han\|cheng` | `huan\|cheng` | h_f applied; han≠huan residual |
| `p2_u004_019` | 地暖 | (profile path) | `di\|nuan` | residual outside relation |

Frozen ownership: **MODEL3** for compound non-profile ASR error. Lexicon correctly refuses non-matching keys.

### E4 — relation output not target-reachable
CORRECT 15 + WRONG 84. Includes frozen **global relation application** (R1/R6), e.g. 内处理 → `nei|chu|ni` (n_l also mutates 理). **Not classified as implementation defect.**

### E5 — tone-key mismatch after ready
Pinyin already equals target; window-local acoustic tone excludes Lexicon `tone_pinyin_key`.

Example `p2_u001_007` 内科:

- transform pinyin: `nei|ke` ✓
- acoustic tone key: `nei4|ke5`
- DB: `nei4|ke1`
- direct RO recall: wrong tone → empty; canonical tone → hit (**COUNTERFACTUAL_ONLY** without tone)

### E6 — true Lexicon engine miss
**0.** No case where final query legally matches target under frozen recall rules and engine still drops it.

### E7 — evaluator false negative
4 CORRECT cases where target **was returned** on another window; chosen-window Gate E = FAIL  
(`过拟合`, `城门`, `水道`, `提示符`).

---

## 6. Representative matrix (compact)

| caseId | target | ASR/window | rel | query | tone | DB key | in DB? | legal match? | returned? | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| p2_u001_007 | 内科 | 谈雷 | n_l | (pinyin nei\|ke) | [4,5] | nei4\|ke1 | YES | PINYIN_YES_TONE_NO | NO | E5 |
| p2_u001_014 | 纪念 | 积链 | n_l | ji\|nian | [1,3] | ji4\|nian4 | YES | PINYIN_YES_TONE_NO | NO | E5 |
| p2_u001_039 | 牛肉串 | …/niu\|ruo\|chuan | n_l | niu\|ruo\|chuan | — | niu\|rou\|chuan | YES | NO | NO | E3 |
| p2_u003_016 | 换乘 | 翻成→han\|cheng | h_f | han\|cheng | — | huan\|cheng | YES | NO | NO | E3 |
| p2_u001_004 | 内处理 | →nei\|chu\|ni | n_l | nei\|chu\|ni | — | nei\|chu\|li | YES | NO | NO | E4 |
| p2_u002_005 | 资料库 | 知识 要酷 | z_zh | (no cover) | — | zi\|liao\|ku | YES | NO | NO | E2 |
| p2_u001_003 | 过拟合 | chosen于过历 / hit过历和 | n_l | guo\|ni\|he | — | guo\|ni\|he | YES | YES_OTHER_WINDOW | YES* | E7 |
| p2_u004_001 | 生成 | (Gate E PASS control) | — | sheng\|cheng | — | sheng\|cheng | YES | YES | YES | PASS |

\*Returned on non-chosen window only.

Full 158-row matrix: `LINGUA_GATE_E_CASE_MATRIX.csv`.

---

## 7. CORRECT_PROFILE conversion funnel

Population: CORRECT Gate-D PASS = **74**  
(see `LINGUA_GATE_E_CONVERSION_FUNNEL.json`)

| Stage | Pass | Fail | Rate |
|---|---:|---:|---:|
| Gate D eligible | 74 | 0 | 1.000 |
| Model2 action / relation / tone ready | 74 | 0 | 1.000 |
| Reachable from transformed pinyin | 42 | 32 | 0.568 |
| Reachable from final tone query | 7 | 67 | 0.095 |
| Exists in Lexicon | 74 | 0 | 1.000 |
| Returned any window | 7 | 67 | 0.095 |
| **Returned chosen window (Gate E)** | **3** | **71** | **0.041** |

Drop anatomy on the 71 fails: E5=35, E2+E3+E4=32, E7=4.

---

## 8. Direct recall reproduction

`DIRECT_RECALL_REPRODUCIBLE = YES` (RO SQLite, production keys):

- E5: tone-conditioned miss / canonical-tone hit
- E3: `han|cheng` / `niu|ruo|chuan` miss; canonical hit
- E7: `guo|ni|he` hit confirms returnability

No production config changed.

---

## 9. Anti-drift checks

| Check | OK? |
|---|---|
| Global relation application treated intentional | YES |
| No GT-aware Model2 redesign proposed | YES |
| Compound residual ≠ Lexicon defect | YES |
| Window-local Tone evidence used | YES |
| Real Lexicon queried RO | YES |
| Absent vs query mismatch distinguished | YES |
| Query mismatch vs true engine miss distinguished | YES |
| Gate E evaluator semantics verified | YES |
| Anchor / Retry / Model3 input not reopened | YES |
| No performance work | YES |
| Zero product changes | YES |

---

## 10. Next owner (exactly one)

CORRECT_PROFILE dominant class is **E5**. Fixing it would require changing mandatory exact Tone-key recall semantics while FineSpan-local Tone binding remains CLOSED → **ARCHITECTURE_DECISION_REQUIRED = YES**. Do **not** implement this round.

Do **not** choose `LEXICON_ENGINE_OWNER` from the old `LEXICON_RECALL` label.

---

## Final verdicts

```
BASELINE_IDENTITY = PASS

GATE_D_IMPLEMENTATION_LOCATION = electron_node/electron-node/tests/run-pilot200-post-anchor-acp-remeasure.mjs (evaluateRun)
GATE_D_EXACT_SEMANTICS = After A/B/C PASS: window-local/FineSpan-local tone pattern present, length==targetLen, source WINDOW_LOCAL|FINESPAN_LOCAL (null source valid)
GATE_E_IMPLEMENTATION_LOCATION = electron_node/electron-node/tests/run-pilot200-post-anchor-acp-remeasure.mjs (evaluateRun)
GATE_E_EXACT_SEMANTICS = After A-D PASS: chosen-window p_retrieval.queries (len==targetLen) any hit.surface==target OR termId in evaluationTargetTermIds
GATE_E_ACTUALLY_MEASURES_LEXICON_RETURN = PARTIAL
EVALUATOR_SEMANTIC_DRIFT = YES

GATE_D_PASS_COUNT = 161
GATE_E_PASS_COUNT = 3
GATE_D_PASS_E_FAIL_COUNT = 158

CORRECT_PROFILE_GATE_D_PASS = 74
CORRECT_PROFILE_GATE_E_PASS = 3
CORRECT_PROFILE_GATE_D_PASS_E_FAIL = 71

OLD_LEXICON_RECALL_LABEL_COUNT = 158
E1_TARGET_NOT_IN_LEXICON = 0
E2_TARGET_REGION_NOT_REPRESENTABLE = 6
E3_COMPOUND_RESIDUAL_OUTSIDE_MODEL2_RELATION = 14
E4_MODEL2_RELATION_OUTPUT_NOT_TARGET_REACHABLE = 99
E5_TONE_KEY_MISMATCH_AFTER_READY = 35
E6_FINAL_QUERY_SHOULD_MATCH_BUT_LEXICON_ENGINE_MISS = 0
E7_TARGET_RETURNED_BUT_EVALUATOR_MISCLASSIFIED = 4
E8_OTHER_PROVEN = 0

TRUE_LEXICON_ENGINE_MISS_COUNT = 0
UPSTREAM_QUERY_UNREACHABLE_COUNT = 119
TONE_KEY_MISMATCH_COUNT = 35
TARGET_NOT_IN_LEXICON_COUNT = 0
TARGET_NOT_REPRESENTABLE_COUNT = 6
EVALUATOR_FALSE_NEGATIVE_COUNT = 4

TARGET_LEXICON_COVERAGE = PASS
DIRECT_RECALL_REPRODUCIBLE = YES
GLOBAL_RELATION_APPLICATION_DEFECT = NO
COMPOUND_RESIDUAL_OWNERSHIP_CONFLICT = NO
FINESPAN_BOUNDARY_DEFERRED_CASES = p2_u002_005,p2_u004_015,p2_u005_038
PRODUCT_CODE_CHANGE_THIS_ROUND = NO
ARCHITECTURE_DECISION_REQUIRED = YES

DOMINANT_TRUE_FAILURE_CLASS = E5
ONE_NEXT_OWNER = TONE_QUERY_OWNER
ONE_NEXT_DELTA = ARCHITECTURE_DECISION_ON_MANDATORY_EXACT_TONE_KEY_VS_ACOUSTIC_MISMATCH
AUDIT_STATUS = PASS
```

### Artifacts

1. `LINGUA_GATE_E_LEXICON_RECALL_FAILURE_OWNERSHIP_AUDIT.md` (this file)
2. `LINGUA_GATE_E_FAILURE_CLASSIFICATION.json`
3. `LINGUA_GATE_E_CASE_MATRIX.csv`
4. `LINGUA_GATE_E_CONVERSION_FUNNEL.json`

**STOP.** No product / config / lexicon / model changes.
