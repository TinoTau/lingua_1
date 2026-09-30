# Lingua1 — G2 Target-Geometry LexicalEdge Segmentation / Path-Selection Attribution Audit

PHASE = `LINGUA_G2_SEGMENTATION_PATH_SELECTION_ATTRIBUTION_AUDIT_V1`  
MODE = READ_ONLY_AUDIT · TRACE_FIRST · CODE_FROZEN · NO_PRODUCT_DEVELOPMENT

## 0. Question answered

When a target-geometry LexicalEdge already exists, at what exact first stage and under what exact rule does it fail to become a selected PathFineSpan, and is that rule faithful to frozen Lingua architecture?

**Answer:** In all **4/4** validated G2 cases the target-geometry LexicalEdge is created and enters enumeration, but every target-containing hypothesis is removed by **bounded path caps** (`maxActivePathsPerPosition=8` and/or `maxCompleteSegmentationPaths=8`) under `compareSegmentationPathRankingBestFirst` **before** Domain Vote / Assembly / KenLM. Dominant first-loss class = **S3**. Behavior matches frozen prune SSOT when caps fire → **EXPECTED_ALGORITHM_OUTCOME** (not an implementation defect). G2 was **not** fixed this round.

---

## 1. Cohort validation

| Field | Value |
|-------|-------|
| G2_EXPECTED_CASES | 4 |
| G2_VALIDATED_CASES | 4 |
| G2_RECLASSIFIED_CASES | 0 |

Cases: `p2_u001_003` 过拟合 · `p2_u004_033` 城门 · `p2_u005_004` 水道 · `p2_u005_015` 提示符

Per-case validation (A–E):

| Check | Result |
|-------|--------|
| A. target-geometry LexicalEdge exists | YES (4/4) — Model2 P-hit materialized + merged pre-edge (`p_materialized_count` / window hits / reconstructed edge) |
| B. ≥1 candidate | YES |
| C. raw/syllable geometry known | YES (evidence geometry) |
| D. enters same lattice enumeration | YES |
| E. selected PathFineSpan ≠ target geometry | YES (retained exact-geom PFS = 0) |

**Observability note:** `dialog200_path_trace.after_model2_candidates` is **path-local post-compatibility**, not the pre-LexicalEdge union. Prior G2 used Model2 hits as edge proxy — that proxy is **correct for these 4** because hits were materialized (`materializeProfileHits`) and introduced into `candidatesByWindow` before `buildLexicalEdges`. `union_before_budget` is truncated to 24 (`DIALOG200_CANDIDATE_CAP`) and can hide the target term — do not use truncated union alone to deny edge existence.

`fw_detector.spanAssemblyV4.latticeTrace` is **not** exposed on the JobResult metrics surface used here → **OBSERVABILITY_GAP** for production prune counters; offline enum mirrors production code for attribution.

---

## 2. Funnel

| Stage | Count |
|-------|------:|
| G2_EXPECTED_CASES | 4 |
| G2_VALIDATED_CASES | 4 |
| TARGET_EDGE_EXISTS | 4 |
| TARGET_EDGE_ENTERED_ENUMERATION | 4 |
| TARGET_PATH_GENERATED (complete) | 2 |
| TARGET_PATH_SURVIVED_STRUCTURAL_PRUNING | 0 |
| TARGET_PATH_REACHED_FINAL_RANKING | 2 |
| TARGET_PATH_SELECTED | 0 |
| TARGET_GEOMETRY_PATHFINESPAN_CREATED | 0 |

Attribution:

| Class | Count |
|-------|------:|
| S1 | 0 |
| S2 | 0 |
| **S3** | **4** |
| S4 | 0 |
| S5 | 0 |
| S6 | 0 |
| S7 | 0 |
| S8 | 0 |

Reconcile: S1…S8 = 4 = G2_VALIDATED + G2_RECLASSIFIED.

---

## 3. First-loss by case

### 3.1 `p2_u001_003` 过拟合 `11:14`

- Target edge: surface `过拟合`, PROFILE_PRONUNCIATION hit, enters DAG.
- Competing edges include `11:12:过`, `11:13`, `12:13`, `12:14:拟合`, `13:14:和`, …
- **FIRST_LOSS_STAGE** = `per_position_cap`
- **FIRST_LOSS_CLASS** = S3
- Partial paths that already contain `11:14` are pruned by `maxActivePathsPerPosition=8` (`prunedPartialWithTarget=8`) **before** a complete path is formed → complete target path count = 0.
- CompleteBefore=16 retained=8 (other geometries only).

### 3.2 `p2_u004_033` 城门 `9:11`

- Target complete paths generated = 1; best rank = **11**.
- **FIRST_LOSS_STAGE** = `complete_path_cap`
- Structural scores vs 8th kept path: fallback/fuzzy/tone/exact/lexical **all equal (exact=11)** → loss on **boundaryKey ASC** tie-break.
- Cap drops ranks 9…16 including the sole target path.

### 3.3 `p2_u005_004` 水道 `9:11`

- Target complete paths = 4; best rank = **14**.
- **FIRST_LOSS_STAGE** = `complete_path_cap`
- Score delta vs cutoff: exact **10 vs 11**, lexical **10 vs 11** → loses on **exactEdgeCount DESC** (finer partition preferred), then would lose further on lexical count.
- CompleteBefore=24 retained=8.

### 3.4 `p2_u005_015` 提示符 `6:9`

- Target edge proven in pre-edge union (`提示符` @ `6:9`) and window P-hit.
- **FIRST_LOSS_STAGE** = `per_position_cap`
- Partial paths containing `6:9` pruned (`prunedPartialWithTarget=7`) before completion.
- CompleteBefore=8 (=cap) with **no** target-containing complete path.

---

## 4. Score / ranking decomposition (where complete paths exist)

Authoritative order (`compareSegmentationPathRankingBestFirst` / Implementation Contract §8.3):

1. fallbackEdgeCount ASC  
2. fuzzyEdgeCount ASC  
3. toneRelaxedEdgeCount ASC  
4. **exactEdgeCount DESC**  
5. lexicalEdgeCount DESC  
6. boundaryKey ASC  

| caseId | target exact/lex | cutoff exact/lex | deciding key |
|--------|------------------|------------------|--------------|
| 城门 | 11 / 11 | 11 / 11 | boundaryKey ASC |
| 水道 | 10 / 10 | 11 / 11 | exactEdgeCount DESC |

No Domain / KenLM / Assembly scores enter path prune.

---

## 5. Segmentation authority (summary)

| Mechanism | Owner | Authority |
|-----------|-------|-----------|
| Path enumeration | `enumerateCompleteSegmentationPaths.ts` | FROZEN_SSOT |
| LexicalEdge eligibility | `build-lexical-edges.ts` (skip empty) | FROZEN_SSOT |
| Path ranking / prune order | `compareSegmentationPathRankingBestFirst` | FROZEN_SSOT |
| Path caps | `V4_LIMITS` maxActive=8 / maxComplete=8 | FROZEN_SSOT (**PROBE values**) |
| Semantic / KenLM / domain beam | **NONE** (forbidden) | FROZEN_SSOT |
| PathFineSpan materialization | `materialize-path-fine-spans.ts` | FROZEN_SSOT (geometry **IDENTITY** from selected edge) |

Full matrix: `LINGUA_G2_SEGMENTATION_AUTHORITY_MATRIX.csv`.

### Beam-like check

| Question | Answer |
|----------|--------|
| CURRENT_SEGMENTATION_HAS_BEAM_LIKE_PRUNING | **YES** — position/complete path caps with structural top-K (architecture labels this **resource protection**, not language beam) |
| CURRENT_SEGMENTATION_CAN_DROP_VALID_TARGET_EDGE_BEFORE_DOWNSTREAM_SCORING | **YES** |
| CURRENT_SEGMENTATION_IS_ACTING_AS_BUSINESS_RANKER | **PARTIAL** — not KenLM/domain fluency ranker; but `exactEdgeCount DESC` has systematic business effect favoring **finer** partitions over longer target edges when caps fire |

---

## 6. Business / architecture questions

| Question | Answer |
|----------|--------|
| DOES_CURRENT_SEGMENTATION_PREMATURELY_COLLAPSE_OVERLAPPING_HYPOTHESES | **YES** — at `per_position_cap` and/or `complete_path_cap` using structural ranking |
| ARE_MULTIPLE_SEGMENTATION_PATHS_EXPECTED_TO_SURVIVE_TO_DOMAIN_VOTE | **YES** — architecture requires multi-path retention (bounded) |
| ARE_PATH_LEVEL_INDEPENDENT_DOMAIN_BUCKETS_RECEIVING_ALL_INTENDED_SEGMENTATION_HYPOTHESES | **NO** — only retained ≤8 paths; target-geometry hypotheses not among them in these 4 cases |
| SELECTED_EDGE_TO_PATHFINESPAN_GEOMETRY | **IDENTITY** |
| PATHFINESPAN_MATERIALIZATION_GEOMETRY_DRIFT | **NO** (S5=0) |
| CANDIDATE_CAP_AND_PATH_CAP_ARE_SAME_CONTRACT | **NO** |
| LEXICAL_CANDIDATE_BUDGET_OWNER | Model2 P/D candBudget + exactTopK; global sentence merge ≤16 |
| SEGMENTATION_PATH_BUDGET_OWNER | `V4_LIMITS.maxActivePathsPerPosition` / `maxCompleteSegmentationPaths` (PROBE) |
| ASSEMBLED_SENTENCE_BUDGET_OWNER | `maxSentenceCandidates=16` (FROZEN) |

Architecture SSOT (`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md` §8):

- If caps **not** triggered → retain every legal complete `boundaryKey`.
- If caps **fire** → prune with structural order only (authorized).
- Cap **values** 8/8 remain **PROBE — NOT FINAL**.

Therefore dropping these target paths under firing caps is **algorithmically authorized**, not a contract violation of the prune rule. It does mean Domain Vote never sees those hypotheses under current probe budgets.

---

## 7. Architecture status

| Field | Value |
|-------|-------|
| ARCHITECTURE_STATUS | **EXPECTED_ALGORITHM_OUTCOME** |
| ARCHITECTURE_CONFLICT_FOUND | NO |
| ARCHITECTURE_GAP_FOUND | YES (PROBE path budgets never finalized; no hard guarantee that every valid overlapping hypothesis survives when caps fire) |
| IMPLEMENTATION_DEFECT_FOUND | NO |
| ACP_REQUIRED | **NO** (prune rule itself is already frozen; this audit does not open scoring/ACP drafting) |
| MODEL2_CHANGE_REQUIRED | NO |
| MODEL3_CHANGE_REQUIRED | NO |
| QUERY_EVIDENCE_CHANGE_REQUIRED | NO |
| RETRY_REGION_CHANGE_REQUIRED | NO |
| PATHFINESPAN_CHANGE_REQUIRED | NO |
| SEGMENTATION_CHANGE_REQUIRED | **NO** for defect repair; policy question on PROBE budgets remains open outside this audit |

**ONE_NEXT_OWNER** = Segmentation path-budget / multi-path survival policy (PROBE finalization), not Model2/Model3/QueryEvidence/RetryRegion.  
**ONE_NEXT_DELTA** = Single-delta pre-development decision: whether PROBE caps=8 systematically discard target-geometry hypotheses that architecture intends Domain Vote to see — **do not** retune `exactEdgeCount` weights in-product without that decision.

---

## 8. Anti-drift

Model2 / insertion / FineSpan / Lexical Recall / Tone / QueryEvidence / Segmentation code / path budgets / Domain Vote / SameDomain / Anchor / Model3 / RetryRegion / Stage2 / Assembly / KenLM / JobResult / Pilot evaluator — **unchanged**.  
Did this round fix G2? **NO**.

PRODUCT_RUNTIME_CODE_CHANGED = **NO**.

---

## 9. Final verdict

```text
PHASE =
LINGUA_G2_SEGMENTATION_PATH_SELECTION_ATTRIBUTION_AUDIT_V1

AUDIT_VALID = YES

PRODUCT_RUNTIME_CODE_CHANGED = NO

GT_USED_BY_RUNTIME = NO

GT_USED_BY_AUDIT = YES

G2_EXPECTED_CASES = 4

G2_VALIDATED_CASES = 4

G2_RECLASSIFIED_CASES = 0

TARGET_EDGE_EXISTS = 4

TARGET_EDGE_ENTERED_ENUMERATION = 4

TARGET_PATH_GENERATED = 2

TARGET_PATH_SURVIVED_STRUCTURAL_PRUNING = 0

TARGET_PATH_REACHED_FINAL_RANKING = 2

TARGET_PATH_SELECTED = 0

TARGET_GEOMETRY_PATHFINESPAN_CREATED = 0

S1 = 0
S2 = 0
S3 = 4
S4 = 0
S5 = 0
S6 = 0
S7 = 0
S8 = 0

DOMINANT_FIRST_LOSS_CLASS = S3_TARGET_PATH_GENERATED_BUT_PRUNED

DOMINANT_FIRST_LOSS_COUNT = 4

SEGMENTATION_PATH_ENUMERATION_OWNER = enumerateCompleteSegmentationPaths.ts

SEGMENTATION_PATH_PRUNING_OWNER = enumerateCompleteSegmentationPaths.ts + V4_LIMITS (maxActivePathsPerPosition / maxCompleteSegmentationPaths)

SEGMENTATION_PATH_RANKING_OWNER = compareSegmentationPathRankingBestFirst

CURRENT_SEGMENTATION_HAS_BEAM_LIKE_PRUNING = YES

CURRENT_SEGMENTATION_CAN_DROP_VALID_TARGET_EDGE_BEFORE_DOWNSTREAM_SCORING = YES

CURRENT_SEGMENTATION_IS_ACTING_AS_BUSINESS_RANKER = PARTIAL

SELECTED_EDGE_TO_PATHFINESPAN_GEOMETRY = IDENTITY

PATHFINESPAN_MATERIALIZATION_GEOMETRY_DRIFT = NO

DOES_CURRENT_SEGMENTATION_PREMATURELY_COLLAPSE_OVERLAPPING_HYPOTHESES = YES

ARE_MULTIPLE_SEGMENTATION_PATHS_EXPECTED_TO_SURVIVE_TO_DOMAIN_VOTE = YES

ARE_PATH_LEVEL_INDEPENDENT_DOMAIN_BUCKETS_RECEIVING_ALL_INTENDED_SEGMENTATION_HYPOTHESES = NO

LEXICAL_CANDIDATE_BUDGET_OWNER = Model2 candBudget/exactTopK + global sentence merge≤16

SEGMENTATION_PATH_BUDGET_OWNER = V4_LIMITS.maxActivePathsPerPosition / maxCompleteSegmentationPaths (PROBE)

ASSEMBLED_SENTENCE_BUDGET_OWNER = maxSentenceCandidates=16 (FROZEN)

CANDIDATE_CAP_AND_PATH_CAP_ARE_SAME_CONTRACT = NO

ARCHITECTURE_STATUS = EXPECTED_ALGORITHM_OUTCOME

ARCHITECTURE_CONFLICT_FOUND = NO

ARCHITECTURE_GAP_FOUND = YES

IMPLEMENTATION_DEFECT_FOUND = NO

ACP_REQUIRED = NO

ACP_REASON = Prune order and cap-fire behavior are already frozen SSOT; G2 losses occur under authorized probe caps — no ACP opened this round

MODEL2_CHANGE_REQUIRED = NO

MODEL3_CHANGE_REQUIRED = NO

QUERY_EVIDENCE_CHANGE_REQUIRED = NO

RETRY_REGION_CHANGE_REQUIRED = NO

PATHFINESPAN_CHANGE_REQUIRED = NO

SEGMENTATION_CHANGE_REQUIRED = NO

ONE_NEXT_OWNER = Segmentation path-budget / multi-path survival policy (PROBE finalization)

ONE_NEXT_DELTA = Pre-development policy decision on whether PROBE path caps=8 may discard target-geometry hypotheses before Domain Vote — no in-round scoring or cap change
```

---

## Artifacts

1. `LINGUA_G2_SEGMENTATION_PATH_SELECTION_ATTRIBUTION_AUDIT.md` (this file)  
2. `LINGUA_G2_SEGMENTATION_CASE_MATRIX.csv`  
3. `LINGUA_G2_PATH_COMPETITION_MATRIX.csv`  
4. `LINGUA_G2_SEGMENTATION_AUTHORITY_MATRIX.csv`  
5. `LINGUA_G2_SEGMENTATION_FUNNEL.json`  
6. `modified_file_inventory.csv`
