# Lingua1 — Minimal Geometry Preservation ACP Audit V1

```text
PHASE = LINGUA_MINIMAL_GEOMETRY_PRESERVATION_ACP_AUDIT_V1
MODE  = READ_ONLY / ACP AUDIT / NO IMPLEMENTATION
DATE  = 2026-09-20
INPUT = LINGUA_CONTEXT_DOMAIN_PATH_SPACE_ARCHITECTURE_DECISION_PREAUDIT_2026_09_19
```

---

## 1. Executive conclusion

```text
RESULT A — KEEP STRUCTURAL_TOPN_ONLY
```

**Target-independent evidence does not show that the 8 retained complete paths are typically a homogeneous geometry family.**

On the frozen evaluable cohort (n=17) under production dual-cap pipeline (active=8 then complete=8):

| Metric (complete retained set) | Result |
|--------------------------------|--------|
| `unique_boundary_keys` | **8/8** in **17/17** cases |
| `unique_span_length_patterns` | **8/8** in **17/17** cases |
| `top_pattern_share` | **0.125** mean (each pattern once) |
| mean pairwise edge-set Jaccard | **0.48** (evaluable) / **0.60** (known-7) |

A GT-blind counterfactual “one slot per span-length pattern, then structural fill” **does not** improve:

- unique pattern count (already 8)
- contested multi-char edge coverage ratio (0.683 → 0.683)
- target survival (10/17 → 10/17)

Therefore Minimal Geometry Reservation / Round-Robin **is not justified** as a resource-representation contract under Complexity Gate + Minimality Test.

Known Pre-DomainVote losses remain classified as:

```text
EXPECTED FAILURE under STRUCTURAL_TOPN_ONLY resource safety
+ residual ARCHITECTURE GAP only on PROBE numeric finalization (Decision 2, DEFERRED)
```

Not IMPLEMENTATION DEFECT. Not case-driven preservation ACP.

```text
DOMAIN_GUIDED_PATH_CONTROL = NOT_AUTHORIZED
NUMERIC_CAP_FINALIZATION   = DEFERRED
IMPLEMENTATION             = NOT_AUTHORIZED
TRACK_B_DEFERRED_FINDING   = FINAL_CORRECT still separate from path visibility
```

---

## 2. Frozen authority (not reopened)

From Decision Pre-Audit 2026-09-19:

| Decision | Binding this round |
|----------|-------------------|
| D1 Late Domain Vote chain | Keep; no domain/context in preservation |
| D2 Caps 8/8 PROBE | Do not change / finalize numbers |
| D3 Geometry ACP audit only | No AmbiguityClass / diversity subsystem / ML |

Lattice Architecture V1.0.0:

```text
路径限宽 = 资源保护，≠ 语言决策
Must not prune using Domain Vote, SameDomain, Assembly, KenLM, LLM, fluency
Uncapped: every legal complete boundaryKey MUST be retained
Capped: structural comparator only
```

---

## 3. Current implementation

### 3.1 Enumeration contract

```text
LexicalEdge[]
→ PartialPath expansion (contiguous)
→ per_position_cap @ active[pos] when |list| > maxActivePathsPerPosition
→ complete paths @ active[N]
→ complete_path_cap when |complete| > maxCompleteSegmentationPaths
```

Code: `enumerate-complete-segmentation-paths.ts`.

### 3.2 Path identity (`boundaryKey`)

Code: `build-boundary-key.ts`.

```text
boundaryKey = join(edge.syllableStart + '-' + edge.syllableEnd, '|')
pathId      = sha256(boundaryKey)
```

| Question | Answer |
|----------|--------|
| Same boundaryKey deduplicated as one Path? | **YES** (one walk → one key; enum does not emit duplicates) |
| Candidate text / multi-candidate on same edge create new Path? | **NO** (Contract: same boundaryKey does not expand for multi-Candidate) |
| Edge source / provenance create new Path? | **NO** (identity = syllable ranges only) |

Lattice-native fields available without new types:

```text
boundaryKey
edge.syllableStart / syllableEnd
edge lengths, edge count
structuralEvidence: fallback/fuzzy/toneRelaxed/exact counts
lexicalEdgeCount
```

No domain / surface semantics in prune.

### 3.3 Structural comparator (code-confirmed)

`compareSegmentationPathRankingBestFirst`:

| Order | Field | Direction | Role |
|------:|-------|-----------|------|
| 1 | fallbackEdgeCount | ASC | resource-quality (prefer fewer gaps) |
| 2 | invalidGapCount | ASC | aliased to fallback in V1 |
| 3 | fuzzyEdgeCount | ASC | recall evidence preference |
| 4 | toneRelaxedEdgeCount | ASC | recall evidence preference |
| 5 | exactEdgeCount | DESC | recall evidence preference |
| 6 | lexicalEdgeCount | DESC | prefer more lexical edges |
| 7 | boundaryKey | ASC | deterministic tie-break |

**Resource-quality metadata:** fallback / fuzzy / tone / exact / lexical counts.  
**Not language judgement:** no KenLM, no domain, no surface fluency.  
**Why coarser multi-char targets lose:** exact↓+lexical↓ favor **finer partitions** with more exact edges — authorized structural preference, not “same geometry cloning.”

---

## 4. Geometry concentration evidence (target-independent)

Diagnostic: offline mirror of production comparator + dual 8/8 on `_path_budget_edge_cache.json` evaluable n=17.

### 4.1 Complete retained set (after both caps)

| Finding | Value |
|---------|-------|
| Cases with `uniqueBK == retainedCount` | **17/17** |
| Cases with `uniqueSpanLenPattern == retainedCount` | **17/17** |
| Cases with `topPatternShare ≥ 0.5` | **0/17** |
| Cases with `uniqueSpanLenPattern ≤ 3` | **0/17** |
| Cases with mean pairwise Jaccard ≥ 0.75 | **0/17** |

**Interpretation:** After complete cap, slots are **not** filled by repeated identical span-length geometries. Each retained path already has a distinct full `boundaryKey` and distinct ordered length tuple.

### 4.2 Active prune (per position)

At a fixed `pos`, all surviving partials **must** end at `pos`, so last-edge cardinality is bounded by outgoing alternatives into that position (often 1–3).

| Metric | Evaluable active prune events |
|--------|-------------------------------|
| Events | 165 |
| `topLastShare ≥ 0.5` or `uniqueLast ≤ 2` | 160 (**97%**) |
| Full prefix spanLen pattern concentration (`topPatShare≥0.5`) | **0%** |

**Interpretation:** High last-edge share is largely **positional necessity**, not proof that “almost the same segmentation” wastes all slots. Prefix span-length patterns among the 8 kept partials remain **8 distinct** whenever 8 are kept.

### 4.3 Contested multi-char edge coverage (observability, not a class system)

| Cohort | Cover ratio before complete Top-N | After Top-N |
|--------|-----------------------------------|-------------|
| Evaluable mean | 0.802 | **0.683** |
| Known-7 mean | 0.637 | **0.532** |

Coverage **drops** under structural Top-N (expected: ranking prefers high exact counts). This is **resource ranking loss**, not duplicate-geometry concentration.

---

## 5. Known-loss traces (evidence only)

FIRST LOSS = PATH_CAP (prior audits). Caps unchanged this round.

| case | Target geom | Complete before→after | uniqueBK after | unique spanLenPat | Target survived @8/8 | Geometry concentration? |
|------|-------------|----------------------:|---------------:|------------------:|----------------------|-------------------------|
| 过拟合 | 11:14 | 16→8 | 8 | 8 | NO (often no complete w/ target under active) | **NO** (8 distinct keys/patterns) |
| 城门 | 9:11 | 16→8 | 8 | 8 | NO (rank 11) | **NO** |
| 水道 | 9:11 | 24→8 | 8 | 8 | NO (rank 14) | **NO** |
| 提示符 | 6:9 | 8→8 | 8 | 8 | NO (active-stage loss; complete set already ≤8) | **NO** |
| 护士长 | 10:13 | 16→8 | 8 | 8 | NO | **NO** |
| 行程图 | 5:8 | 16→8 | 8 | 8 | NO | **NO** |
| 黄包车 | 3:6 | 16→8 | 8 | 8 | NO | **NO** |

**Core question answer:** When targets die, the 8 slots are **not** typically occupied by one repeated geometry pattern. They are occupied by **8 distinct** fine structural winners under the frozen comparator.

Example (城门): target pattern `2,1,2,1,2,1,2,2,2,2,1` rank 11; retained top patterns are 8 different length tuples with similar exact/lexical scores.

---

## 6. Counterfactual (target identity UNKNOWN)

Rule tested (diagnostic only, not proposed for ship):

```text
Group complete candidates by span-length pattern string.
Keep structural-best path per pattern (up to N).
Fill remaining slots by structural order.
```

Uses only lattice geometry + existing comparator. No GT / domain / language score.

| Metric | Structural Top-N | Pattern reservation |
|--------|------------------|---------------------|
| Target survival | **10/17** | **10/17** |
| Mean unique spanLen patterns | 8 | 8 |
| Mean contested multi-char cover ratio | 0.683 | 0.683 |

```text
TARGET-INDEPENDENT REPRESENTATION IMPROVEMENT = NONE
TARGET-AWARE SURVIVAL IMPROVEMENT = NONE
```

Any rule that needs expected segmentation / domain / sentence → **CASE-DRIVEN PATCH** (not pursued).

---

## 7. Minimality analysis

| Q | Answer |
|---|--------|
| Q1 Existing fields only? | YES for Option A. For B/C, “distinct” beyond BK/spanLenPat has **no residual diversity left** at N=8 on this cohort |
| Q2 One deterministic constraint? | Constraint that only reorders already-unique patterns is a **no-op** |
| Q3 New subsystem / taxonomy / thresholds? | Needed only if inventing coarser “geometry family” (Hamming ball, cut-set clusters) → **COMPLEXITY_REJECT default** |

---

## 8. Options A / B / C

### Option A — STRUCTURAL_TOPN_ONLY

Current SSOT. Accept that high exact/lexical paths win; some legal geometries never reach Vote when caps fire.

### Option B — Minimal Geometry Reservation

Semantic: reserve slots for “structurally distinct” geometries.

| Gate | Verdict |
|------|---------|
| Can “distinct” be defined lattice-natively without new taxonomy? | **BK and full spanLenPat already distinct in Top-N** |
| Target-independent benefit? | **Not observed** |
| Risk of evolving into diversity system? | **YES** if coarsening “family” is invented to force a difference |

### Option C — Round-robin by existing geometry key

Natural key candidates: `boundaryKey`, span-length pattern.

Both are **already unique** among retained completes → round-robin ≡ Top-N fill.

```text
OPTION_C_NOT_VIABLE
```

(as a change that alters representation under current data)

---

## 9. Capacity cost

| Option | Enumeration | Cap selection | CPU/mem | New config |
|--------|-------------|----------------|---------|------------|
| A | unchanged | O(n log n) sort | baseline | 0 |
| B | unchanged (does not reduce enum) | + grouping | small | ≥1 if “how many reserved” |
| C | unchanged | + bucket RR | small | ≥1 |

Preservation would **only** change retained set, **not** reduce enumeration work.

---

## 10. Patch-risk audit

| Item | Class |
|------|-------|
| Structural comparator prune | LEGITIMATE CONTRACT IMPLEMENTATION |
| boundaryKey identity | LEGITIMATE CONTRACT IMPLEMENTATION |
| Path diversity / AmbiguityClass in enum | **NOT FOUND** |
| Hidden reservation in path prune | **NOT FOUND** |
| Assembly “canonical/raw preservation” | LEGITIMATE (candidate layer, **not** path geometry) |
| SoftBoundary / SessionDomainPrior | LEGACY / RETIRED |
| Experiment env path-cap override | UNKNOWN AUTHORITY as prod freeze; unset=8/8 |

---

## 11. Complexity gate

To get non-noop “preservation,” one would add a **new** coarser geometry-family concept (not present as a field today).

```text
> 1 new core concept  → default DO_NOT_PROCEED
COMPLEXITY_GATE = FAIL for proceeding to ACP freeze of Option B/C
```

---

## 12. Root-cause classification

| Finding | Class |
|---------|-------|
| Cap deletes some legal target geometries @8/8 | **1 EXPECTED FAILURE** (relative to written structural Top-N when caps fire) |
| PROBE 8/8 unfinished | **6 ARCHITECTURE GAP** (numeric finalization only — Decision 2 deferred) |
| Homogeneous geometry filling all 8 complete slots | **Not evidenced** → no new gap for geometry reservation |
| Implementation violates Lattice prune SSOT | **5 NOT FOUND** |
| Domain must enter path prune | **NOT_AUTHORIZED** (Decision 1) |

```text
TRACK_B_DEFERRED_FINDING =
Known-7 may reach Vote under higher caps yet FINAL_CORRECT=0/7;
out of scope for this ACP.
```

---

## 13. Architecture decision matrix

| Option | New concept | Language judgement | Domain dependency | Deterministic | Complexity | Target-independent benefit | Target survival evidence | SSOT change |
|--------|-------------|--------------------|-------------------|---------------|------------|----------------------------|--------------------------|-------------|
| A Structural Top-N | No | No | No | Yes | Low | Baseline | 10/17 @8/8 | None |
| B Minimal Reservation | Yes if non-noop family | No (if pure geometry) | No | Yes | Med→High | **None measured** | **No gain** in counterfactual | Would need ACP |
| C Geometry Round-Robin | Bucket key | No | No | Yes | Med | **None** (keys already unique) | No gain | Would need ACP |

No scores assigned.

---

## 14. Final result

```text
RESULT A — KEEP STRUCTURAL_TOPN_ONLY
```

Evidence is **insufficient** that geometry concentration (homogeneous segmentation occupying all resource slots) warrants a new preservation contract.

Secondary (target-aware) metrics do not rescue Option B/C: reservation counterfactual is a **no-op** on this cohort.

```text
IMPLEMENTATION_AUTHORIZED = NO
ACP_FREEZE_AUTHORIZED     = NO
```

---

## 15. USER DECISION REQUIRED

```text
USER DECISION REQUIRED: NONE for Minimal Geometry Preservation ACP
```

(No ACP to approve.)

### Only allowed next action (pick one ownership track)

```text
ONE_NEXT_OWNER =
USER_PATH_BUDGET_PROBE_FINALIZATION_DECISION
  (Decision 2 — numeric PROBE only; still not language correctness)

OR

ACCEPT_EXPECTED_RESOURCE_LOSS_UNDER_STRUCTURAL_TOPN
  and stop path-geometry ACP work
```

Do **not** authorize:

- geometry preservation implementation
- domain-guided path control
- diversity subsystem
- Track B (Domain Vote / KenLM / Model3) in this track

---

## Artifacts

```text
docs/user_correction/model3/LINGUA_MINIMAL_GEOMETRY_PRESERVATION_ACP_AUDIT_V1.md
```

Diagnostics used existing `_path_budget_edge_cache.json` only (read-only mirror of frozen comparator). No production changes.
