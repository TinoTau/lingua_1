# LINGUA_MODEL2_STAGE_J_SPAN_OWNER_END_TO_END_AUDIT

**Phase:** `LINGUA_MODEL2_STAGE_J_SPAN_OWNER_END_TO_END_AUDIT`  
**Mode:** READ-ONLY / TRACE FIRST / NO FIX  
**Evidence base:** `LINGUA_MODEL2_FINESPAN_LOCAL_TONE_BINDING_SINGLE_DELTA_TRACE.jsonl` (CORRECT_PROFILE, FineSpan-local Tone already PASS)  

---

## 0. Question

Why do evaluation targets already in Lexicon:

```text
礼宾部 / 奶精 / 咖啡师 / 营运证 / 生成 / 换乘 / 内处理
```

never receive multi-syllable P recall queries, while Model2 P mainly emits short queries such as `李→ni`, `真→zheng`, `理→ni`?

---

## 1. Closed owners (do not reopen)

```text
Model2 inference / phonetic_bias / P action / relation direction / pinyin transform = PASS
Tone capture / replay / readiness / FineSpan-local Tone binding = PASS
Tone-key path-shared drift = RESOLVED
P mechanical mono hit path = CONFIRMED
```

---

## 2. Production geometry pipeline (code SSOT)

```text
rawText
  → buildLexicalWindowQueries          # overlapping contiguous windows length 1..5
  → latticeHardBlockFilter
  → recallTopKForWindows               # base/domain Tone-first recall per window
  → LexicalEdge ONLY if candidates.length > 0
  → injectFallbackEdges                # missing coverage → length=1 fallback edges
  → SegmentationPath (non-overlapping edges)
  → PathFineSpan[]                     # Model2 units
  → expandActiveCandidatesWithModel2   # every PathFineSpan
  → PAction (relation id) on that FineSpan's full syllable slice
  → hypothesizeIntendedSyllables       # PRESERVE full sequence length
  → recallSpanTopKV2(querySyllables)   # query length === FineSpan syllable length
  → materializeProfileHits             # pinned to FineSpan raw/syllable range
  → assembly eligibility               # exact FineSpan range match only
```

Authoritative lengths:

| Contract | Value | Location |
|----------|-------|----------|
| Lattice window min/max | **1 .. 5** | `window-construction-core.ts` `LATTICE_WINDOW_*` |
| Legacy LTR windows | 2 .. 5 | `V4_LIMITS` — **not** Model2 Stage-J path |
| Fallback edge length | **always 1** | `inject-fallback-edges.ts` |
| User prompt “2–6 字” | **not implemented** | — |

```text
FINESPAN_GENERATION_CONTRACT (vs verbal 2–6) = DRIFT
FINESPAN_GENERATION_CONTRACT (vs production lattice 1–5 window enum) = MATCH
```

---

## 3. PACTION / adapter geometry (confirmed)

```text
PACTION_GEOMETRY_SEMANTICS =
  A. Apply pronunciation relation to the entire FineSpan syllable sequence
     (PAction = relation id such as single:n_l; not a syllable picker)
```

Evidence: `finespan-adapter.ts` slices full `syllableStart..syllableEnd`;  
`relation-lexicon-adapter.ts` + `hypothesizeIntendedSyllables` output length === input length.

```text
RELATION_TRANSFORM_GEOMETRY = PRESERVE_FULL_SPAN
```

**Not** “extract relation-bearing syllable only.”  
If the query is 1 syllable, the FineSpan was already length 1.

---

## 4. FIRST_SPAN_GEOMETRY_DIVERGENCE

```text
FIRST_SPAN_GEOMETRY_DIVERGENCE =
  LexicalEdge formation + path segmentation
  (NOT Model2, NOT relation adapter, NOT Tone)
```

Mechanism:

1. Overlapping **1..5** windows are enumerated (including multi-char windows over ASR-confused regions).
2. A window becomes a **LexicalEdge** only when base recall returns **≥1 candidate** (`lattice-fine-span-runtime.ts` ~426–436).
3. ASR-confused multi-char surfaces (e.g. `李守步`, `来精`, `升层`, `类处理`) typically have **no** matching-length base Lexicon hit under observed pinyin → **no multi-char LexicalEdge**.
4. Coverage is completed by **fallback edges of length 1**.
5. Model2 therefore receives **PathFineSpans that are already 1-char** (or rare 2-char edges elsewhere), and P queries preserve that length.

```text
SPAN_OWNER_EXACT_LAYER =
  PATH_FINESPAN_EDGE_GEOMETRY
  (LexicalEdge requires base-recall hit; else fallback len=1)
```

User taxonomy mapping:

| Option | Verdict |
|--------|---------|
| A. 2–6 FineSpan never generated | **PARTIAL** — windows 1–5 generated; **PathFineSpan multi-char for target region usually absent** |
| B. Generated but not Model2 | **NO** — all path FineSpans enter expand loop |
| C. Model2 binds only subspan | **NO** — binds whole PathFineSpan (already short) |
| D. Adapter shrinks multi→mono | **NO** — preserves length |
| E. Query builder shrinks | **NO** — `termLength = querySyllables.length` |
| F. Multi-char hit lost in materialize | **NOT_REACHED** for targets |
| G. Mono + assembly recovers target | **NO** — assembly requires exact FineSpan range; cannot compose `礼宾部` from `你` |

---

## 5. Case matrix (PathFineSpan → P query)

| case | target | tgt len | target-region PathFineSpans | Model2/PAction span | adapter/query | query len | target queried? | first geometry divergence |
|------|--------|--------:|-----------------------------|---------------------|---------------|----------:|-----------------|---------------------------|
| p2_u001_016 | 礼宾部 | 3 | 李 / 守 / 步 (1 each); **no 李守步** | 李 | li→**ni** | 1 | **NEVER** | no multi-char edge on 李守步 |
| p2_u001_002 | 奶精 | 2 | 来 / 精; **no 来精** | 来, 精 | nai / jin | 1 | **NEVER** | no 2-char edge on 来精 |
| p2_u002_016 | 咖啡师 | 3 | 咖/啡/丝…; **丝搭(2)** exists | 丝搭 + 丝 | **shi\|da**, shi | 2 / 1 | **NEVER** | no 咖啡丝 / 咖啡师 edge |
| p2_u003_001 | 营运证 | 3 | 营/运/真… all 1 | 真 | zhen→**zheng** | 1 | **NEVER** | no 营运真 edge |
| p2_u004_001 | 生成 | 2 | 升 / 层; **no 升层** | 层 | ceng→cheng | 1 | **NEVER** | no 升层 edge |
| p2_u003_016 | 换乘 | 2 | 翻 / 成; **no 翻成** | 翻 | fan→han | 1 | **NEVER** | no 翻成 edge |
| p2_u001_004 | 内处理 | 3 | 类/处/理; **no 类处理** | 类, 理 | nei / ni | 1 | **NEVER** | no 类处理 edge |

Multi-char PathFineSpans that **do** appear (今天/是否/合适/试试/步的/丝搭) are mostly **outside** the evaluation target region; only **丝搭** produced a multi-char P query (`shi|da`) — still not the target key `ka|fei|shi`.

```text
USEFUL_TARGET_QUERY_EXECUTED = NO  (0/7)
MULTI_CHAR_P_RECALL_QUERY_EXECUTED = PARTIAL  (only incidental 丝搭)
```

---

## 6. Stage-count matrix (7 cases, PathFineSpan units)

Aggregated unique path FineSpans from TRACE (per case, then summed):

| Stage | single-char | 2-char | 3-char | 4–6-char |
|-------|------------:|-------:|-------:|---------:|
| PathFineSpan (Model2 units) | ~89 | ~10 | 0 | 0 |
| Model2 input (= all path spans) | ~89 | ~10 | 0 | 0 |
| PAction executed | majority 1 | 1 (丝搭) | 0 | 0 |
| Recall query | majority 1 | 1 (`shi\|da`) | 0 | 0 |
| Lexicon hit (P) | mono only (你/争) | 0 | 0 | 0 |
| Materialized P | mono only | 0 | 0 | 0 |

```text
WHERE_MULTI_CHAR_SPANS_DISAPPEAR =
  Between overlapping recall WINDOW generation (1..5)
  and PathFineSpan materialization
  (no LexicalEdge without base hit → fallback len=1)
```

---

## 7. Assembly recovery

```text
ASSEMBLY_MULTI_CHAR_RECOVERY = ABSENT
ASSEMBLY_CAN_RECOVER_TARGET_FROM_SHORT_HITS = NO
```

Evidence:

- `materializeProfileHits` pins candidate to originating FineSpan range.
- `candidate-span-assembly-eligibility.ts` rejects nested/mismatched ranges (`DROP_INCOMPLETE_SPAN_COVERAGE`).
- Path FineSpans are non-overlapping; adjacent mono replacements do not synthesize a multi-char Lexicon term candidate.

Historical corroboration (**HISTORICAL**, attrition audit 2026-08-18): matching-length FineSpan missing is a known QUERY_GENERATION_GAP class for multi-char terms.

---

## 8. Design purpose of multi-syllable windows

```text
2–6 字 design (as stated in this audit prompt) = NOT the production contract
Production contract = overlapping 1..5 syllable windows for BASE LexicalEdge recall

Purpose of multi-syllable windows in current code:
  A. Direct Lexicon Recall query units for BASE/domain edges when hits exist
  → then become PathFineSpans for Model2 / Assembly

NOT:
  B. Mere “suspicious region detectors” that intentionally collapse to mono P queries
```

Model2 P on a PathFineSpan is **relation-conditioned re-query of that same geometry**.  
If geometry is already 1, P cannot invent a 3-syllable target key.

---

## 9. Architecture drift / change gate

```text
ARCHITECTURE_DRIFT_FOUND = YES
```

| Expectation (audit prompt) | Implementation |
|----------------------------|----------------|
| 2–6 字 FineSpan sliding window | Windows are **1–5**; PathFineSpans often **1** via fallback |
| 2–6 span → Model2 P lexical recall of multi-char terms | P only sees PathFineSpan geometry; target multi-char keys never queried |

Relative to **production lattice SSOT (1–5 + edge-requires-hit)**:

```text
CURRENT_BEHAVIOR_MATCHES_FROZEN_LATTICE_IMPLEMENTATION = YES
```

But that implementation **cannot** satisfy Pilot useful multi-char P expansion for ASR-confused regions without base hits:

```text
ARCHITECTURE_CHANGE_REQUIRED = YES

CURRENT_FROZEN_DESIGN:
  LexicalEdge ← window with base recall hit; else fallback len=1 PathFineSpan;
  Model2 P re-queries that PathFineSpan geometry only.

OBSERVED_LIMITATION:
  Evaluation targets exist in Lexicon under multi-syl keys, but ASR surface
  does not produce matching-length base hits → no multi-char PathFineSpan
  → P never emits target keys.

WHY_USEFUL_MULTI_CHAR_RECALL_CANNOT_BE_ACHIEVED (under current geometry):
  PAction cannot expand beyond PathFineSpan syllable range;
  assembly cannot rebuild multi-char terms from mono P hits.

MINIMUM_ARCHITECTURE_DECISION_REQUIRED:
  Whether to allow relation-conditioned multi-syllable P queries on
  overlapping windows / confused regions WITHOUT requiring a prior
  base LexicalEdge hit — without stuffing lexical targets into Model2.
```

Do **not** implement that decision in this audit.

---

## 10. Observability gap

```text
OBSERVABILITY_GAP = YES
```

| Missing | Stage | Why needed | Minimal delta |
|---------|-------|------------|---------------|
| All overlapping recall windows + empty/hit for target region | Window → LexicalEdge | Prove which multi-char windows were enumerated but discarded for lack of candidates | TRACE-only: dump `recallableWindows` × candidateCount for target syllable range |

PathFineSpan TRACE (existing) is sufficient to locate FIRST divergence at edge/path layer.

---

## 11. Per-case owner labels

| case | Owner class |
|------|-------------|
| all 7 | `FINESPAN_NOT_GENERATED` as **multi-char PathFineSpan covering evaluation target** |
| all 7 | `TARGET_NEVER_QUERIED` |
| p2_u002_016 | also shows multi-char P on **wrong** 2-char edge `丝搭` (`RECALL_QUERY` exists but not target) |
| mechanical HIT cases | `CURRENT_BEHAVIOR_MATCHES_FROZEN_DESIGN` for **mono PathFineSpan P** only |

---

## 12. Final verdicts

```text
SPAN_OWNER_CONFIRMED = YES
SPAN_OWNER_EXACT_LAYER =
  PATH_FINESPAN_EDGE_GEOMETRY
  (LexicalEdge requires base-recall candidates; else fallback length-1)

FIRST_SPAN_GEOMETRY_DIVERGENCE =
  Window(1..5) → LexicalEdge(only if base hit) → PathFineSpan
  Target-region multi-char windows lack hits → len-1 fallback PathFineSpans
  before Model2 / adapter / query

MULTI_CHAR_FINESPAN_GENERATED = PARTIAL
  (windows yes; PathFineSpan multi-char on target region: essentially NO)

MULTI_CHAR_FINESPAN_REACHES_MODEL2 = PARTIAL
  (incidental 2-char edges only; not evaluation targets)

MULTI_CHAR_FINESPAN_REACHES_RELATION_ADAPTER = PARTIAL
  (same; 丝搭 only among P-executed)

MULTI_CHAR_P_RECALL_QUERY_EXECUTED = PARTIAL
  (shi|da only; never target keys)

USEFUL_TARGET_QUERY_EXECUTED = NO
USEFUL_MULTI_SYLLABLE_RECALL = NOT_CONFIRMED
ASSEMBLY_CAN_RECOVER_TARGET_FROM_SHORT_HITS = NO
ARCHITECTURE_DRIFT_FOUND = YES
ARCHITECTURE_CHANGE_REQUIRED = YES
```

```text
ONE_NEXT_OWNER =
  PATH_FINESPAN_EDGE_GEOMETRY
  (base-hit-gated LexicalEdge / fallback-len1)

ONE_RECOMMENDED_NEXT_DELTA =
  Architecture Change Proposal only (user approval required):
  enable relation-conditioned multi-syl P queries on confused regions
  without requiring prior base LexicalEdge hits —
  keep Model2 = PAction relation contract; do not put lexical targets in Model2;
  do not reopen Tone; do not expand Lexicon for these terms.
```

STOP.
