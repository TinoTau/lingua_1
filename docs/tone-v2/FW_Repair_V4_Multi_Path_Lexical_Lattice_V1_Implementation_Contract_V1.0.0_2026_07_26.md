# FW Repair V4 — Multi-Path Lexical Lattice V1 · Implementation Contract

| Field | Value |
|-------|-------|
| Document | Implementation Contract |
| Version | **1.0.0** |
| Date | 2026-07-26 |
| Status | **APPROVED FOR IMPLEMENTATION** · Architecture peer **FROZEN FOR IMPLEMENTATION** ([Architecture V1.0.0](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md)) |
| Scope | Lattice V1 Phase 1–6 development constraints |
| Not | Final runtime acceptance freeze (that is Phase 6) |
| Plan | `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Development_Plan_2026_07_26.md` |
| Precedence | If Plan conflicts with this Contract, **this Contract V1.0.0 wins** |
| Change rule | Any DTO/ownership change requires a **Contract Change Record** entry; silent edits forbidden |

---

## 0. Contract Change Record

| Version | Date | Change | Author |
|---------|------|--------|--------|
| 1.0.0 | 2026-07-26 | Initial APPROVED FOR IMPLEMENTATION: DTOs, fallback injection, path prune, coarse authority, Trace | Phase 0.5 |
| 1.0.1 | 2026-07-27 | Phase boundary clarification: Phase 2 is allowed to implement and acceptance-test Path modules (harness/offline only). Production ownership cutover from LTR to SegmentationPath must be atomic with the first Path-aware downstream consumer introduced in Phase 3; before that atomic switch, lattice Path modules are production-ready but MUST NOT become the invoked production fine-span implementation. No shadow execution / feature flag / dual chain in between. | Phase 2 Pre-Dev + Dev Plan |
| 1.0.2 | 2026-07-27 | **Lattice Recall length 1–5 (controlled single-char).** (1) Lattice Recall may query length=1 with **base-only** routing (`base_lexicon`); exact-first; no domain / fuzzy / alias / homophone_variant; Candidate cap=1; `source=base_term`; `repair_target=false`; does not vote. (2) Length 2–5 Recall behavior unchanged (base+domain, existing TopK, fuzzy min=2, parent fragment min=2). (3) LTR Window remains 2–5; legacy `local-span-recall` MIN_SYLLABLES=2 unchanged. (4) Lattice Hard-block: adjacency to sentence-boundary punctuation is **allowed**; block only when the window **slice contains** a sentence boundary or other existing gap/punct rules fire. Does **not** authorize formal single-char lexicon import (Batch 2+) or Production Lattice cutover. | Connectivity Batch 1 |
| 1.0.3 | 2026-07-28 | **LexiconRuntimeV2 base length-1 gate alignment (Batch 1.0C).** (1) `lookupBaseByPinyinKey` / `lookupBaseByPinyinAndToneKey` allow `termLength` **1–5** via explicit `lookupTier(..., minTermLength=1)`. (2) Idiom via `lookupTier` keeps `minTermLength=2`. (3) Domain multi/tone lookups keep Runtime gate `termLength < 2 → []` (not opened to length=1). (4) Fuzzy builder / alias expansion / parent fragment remain min=2; not broadened by this CR. (5) Does **not** change LIMIT=8 ambiguity policy, tone-unsupported fallback, Hard-block, Vote/Edge/Path algorithms, or authorize Batch 2 lexicon write / Production cutover. | Connectivity Batch 1.0C |
| 1.0.4 | 2026-07-28 | **Length-1 ambiguity truncation-aware uniqueness (Batch 1.1A).** (1) Runtime SQL `LIMIT` is a bounded fetch only; `returnedCount == requestedLimit` means the result **may be truncated**. (2) Under truncation risk, a residual eligible singleton **must not** be treated as semantic unique. (3) True unique holds only when the fetch is not full-LIMIT (complete visible page for that key under the requested bound) and eligibility yields exactly one. (4) Does **not** authorize independent surface-exact probe / rank9 reachability (Batch 1.1B). (5) Does **not** change tone-unsupported policy, Hard-block ellipsis, Candidate cap=1, or length 2–5 Recall. | Connectivity Batch 1.1A |
| 1.0.5 | 2026-07-28 | **Documentation-only clarification (Batch 1.1A Stage 5 Gate).** Does **not** change runtime behavior. (1) `returnedCount < requestedLimit` is evidence that the **bounded query under the current SQL predicate** was not truncated — not a `COUNT(*)` proof over other predicates. (2) Current base length-1 SQL predicate is `pinyin_key[=tone] AND enabled=1 AND length(word)=?`; **`is_alias` is not excluded in SQL** and therefore **consumes LIMIT slots**; alias eligibility filtering occurs afterward in Recall (`filterEligibleBaseSingleChar`). (3) If alias filtering ownership or the SQL predicate changes, the length-1 truncation-aware uniqueness contract **MUST be re-audited**. (4) Exact-limit residual-singleton reject remains an intentional conservative policy (宁可漏修，不可误修). (5) Runtime does not own uniqueness decisions. (6) Still does **not** authorize independent surface-exact probe, tone-unsupported policy change, or Hard-block ellipsis work. | Connectivity Batch 1.1A Gate |
| 1.0.6 | 2026-07-28 | **Length-1 independent surface-exact reachability (Batch 1.1B).** Does **not** change Batch 1.1A truncation / exact-limit / LIMIT=8 ambiguity fetch. (1) Ambiguity path runs first; if it already yields a legal Candidate, that Candidate is kept (no surface overwrite). (2) Only when ambiguity yields **no** Candidate may Recall call Runtime mechanical exact-surface lookup. (3) Runtime APIs `lookupBaseByExactSurfaceAndPinyin` / `lookupBaseByExactSurfacePinyinAndTone` return rows only (fixed internal `LIMIT 2`); they do **not** decide uniqueness/Candidate. (4) Exact SQL is a point lookup on existing `PRIMARY KEY (pinyin_key, word)` autoindex — **no new SQLite indexes**. (5) Recall reuses `filterEligibleBaseSingleChar` + `scoreLength1BaseHit`; Candidate kind remains `exact_base`. (6) Explicit surface identity verification may accept under truncation risk when a unique legal identity row exists — this is **not** inferred uniqueness from the ambiguity page. (7) Does **not** change tone-unsupported policy, Hard-block, Edge/Path/Vote, or length 2–5 Recall. | Connectivity Batch 1.1B |
| 1.0.7 | 2026-07-28 | **Documentation-only clarification (Batch 1.1B Stage 5 Final Gate).** Does **not** change runtime behavior. (1) Batch 1.1B Surface Exact Reachability is **CLOSED** after Stages 1–5 PASS. (2) `lookupTier` cache keys always embed the literal segment `:plain:` even for tone exact tiers — this is **naming debt / behavior-safe**; tone exact keys remain distinct via `base:exact_surface:tone:${toneKey}:${surface}:…` and must not be “fixed” by opportunistic rename in later batches without a dedicated cache-contract audit. (3) Deferred unchanged: tone-unsupported fallback → Batch 1.1C; HB ellipsis → Batch 1.1D; Unicode NFC/NFKC → future batch. (4) Still does **not** authorize Batch 2 lexicon write, Production Lattice cutover, LIMIT enlarge, or new SQLite indexes. | Connectivity Batch 1.1B Gate |
| 1.0.8 | 2026-07-28 | **Mandatory Tone Recall (Batch 1.1C) — Fail Closed.** (1) Tone is a **mandatory** precondition for this Lattice Recall chain: only complete, legal, Runtime-executable Acoustic Tone may produce Recall Candidates. (2) Single SSOT readiness resolver `resolveToneRecallReadiness` (order: `caller_disabled` → `runtime_unsupported` → `no_pattern` → `invalid_pattern` → `ready`). (3) Non-ready → Empty Candidate set; **Plain SQL call count from Tone Recall production path = 0**. (4) Tone underfill / Tone SQL empty / Tone exact miss → return existing Tone Candidates only or Empty — **no Plain fill / Plain-only / Plain exact**. (5) `ToneLookupStage` production assignment is **`tone_exact` only**; `plain_fallback` / `plain_only_no_pattern` deleted from Recall production. (6) LIMIT=8 / LIMIT=2 remain **Tone-query only**. (7) Does **not** change 1.1A truncation, 1.1B exact identity semantics, Runtime rows-only ownership, Candidate Kind, SQLite schema/indexes, Edge/Path/Vote/Assembly/KenLM business algorithms. (8) Does **not** enter Batch 1.1D / Batch 2. | Connectivity Batch 1.1C |

---

## 1. Frozen Architecture Direction (unchanged)

```text
SegmentationPath[] is the sole Fine Span SSOT (post Phase 2 cutover)
Formal windows: contiguous syllable lengths 1..5
Same boundaryKey: multiple candidates do NOT expand into multiple Paths
Different boundaryKeys MAY be retained together
Domain Vote: per Path
SameDomain Assembly: per Path
Global Sentence Candidate count <= 16
KenLM: cross-Path final scoring only
No new SQLite indexes
No SQLite temp tables
No dual LTR/Lattice production chain
No feature flag / shadow dual execution
```

---

## 2. Target Pipeline

```text
FW utterance syllables
  → buildUtteranceSyllableCoordinate
  → partitionCoarseSpans                 // soft ref / gap / Trace only
  → buildLexicalWindowQueries            // full-utterance 1..5
  → recallLexicalWindows                 // key-deduped; existing Recall semantics
  → buildLexicalEdges
  → enumerateCompleteSegmentationPaths   // SegmentationPath[] = Fine Span SSOT
  → for each path:
       materializeFormalFineSpans(path)  // ephemeral view only
       voteDomainsForPath
       assembleSameDomainCandidatesForPath
  → allocateGlobalSentenceCandidates     // ≤16; multi-source Trace
  → KenLM scoreBatch                     // cross-path scoring
```

Algorithm name for path search (frozen):

```text
Bounded Complete Segmentation Path Enumeration
```

Forbidden names for this algorithm:

```text
best path | semantic beam | KenLM beam | domain beam
```

---

## 3. Ownership Matrix

| Decision | Owner | Consumers must not |
|----------|-------|--------------------|
| Syllable coordinates | `UtteranceSyllableCoordinate` | Recompute alternate ranges |
| Window set | Lexical Lattice Window Generator | Hard-cut by coarse alone |
| Candidate legality | SQLite operational lexicon Recall | Secondary whitelist / LLM / KenLM |
| Span boundary candidates | `LexicalEdge` | Delete edges for vote score alone |
| Complete segmentations | `SegmentationPath[]` | Treat `FormalFineSpan[]` as SSOT |
| Domain judgment | Path-local Domain Vote | Cross-path vote pools |
| SameDomain buckets | Path-local Assembly | Mix edges across paths |
| Candidate count | Global Sentence Candidate Allocator | Raise KenLM input >16 |
| Language score | KenLM | Decide boundaries / prune paths |
| Trace | Path-aware Trace Contract | Drop pathId / boundaryKey |

---

## 4. Data Contract

### 4.1 LexicalWindowQuery

```ts
interface LexicalWindowQuery {
  windowId: string;
  syllableStart: number;   // inclusive
  syllableEnd: number;     // exclusive
  syllableLength: number;  // 1..5
  pinyinKey: string;
  toneKey?: string;
  coarseBoundaryRefs?: string[];
  crossesCoarseBoundary: boolean;
  sourceSyllableRefs: number[];
}
```

Invariant: `1 <= end - start <= 5`, half-open `[start, end)`.

### 4.2 LexicalEdge

```ts
interface LexicalEdge {
  edgeId: string;
  syllableStart: number;
  syllableEnd: number;
  edgeKind: "lexical" | "fallback";
  candidates: WindowCandidate[];  // domains[] already attached before lattice use
  recallEvidence: {
    hasExact: boolean;
    hasToneExact: boolean;
    hasToneRelaxed: boolean;
    hasFuzzy: boolean;
    hasParent: boolean;
  };
  sourceWindowId: string;
}
```

Invariant: one Edge per `(syllableStart, syllableEnd)`; candidate merge key prefers `termId`, else `candidateId`.

**Evidence SSOT (Phase 1 · B2 — CURRENT):**

```text
recallEvidence = OR over ALL input Candidates on the boundary
OR aggregation runs BEFORE identity first-wins keep
Evidence does not participate in Candidate identity
hasFuzzy ← recallCandidateKind (isFuzzyRecallCandidateKind); not surface string inference
```

**Recall traversal diagnostics (Phase 1 · B1 — CURRENT):**

```text
logicalWindowRecallCount = windows actually recalled (= input recallable length)
physicalSqlStatementCount = true SQLite statement delta (independent)
FORBIDDEN: maxSqlPerUtterance attempt gate; ngramQueryCount as live metric;
           skip/truncate legal recallable Windows for resource policy
```

### 4.3 SegmentationPath (Fine Span SSOT after Phase 2)

```ts
interface SegmentationPath {
  pathId: string;
  boundaryKey: string;  // e.g. "0-2|2-4|4-6"
  edgeRefs: LexicalEdge[];
  lexicalEdgeCount: number;
  fallbackEdgeCount: number;
  structuralEvidence: {
    exactEdgeCount: number;
    toneRelaxedEdgeCount: number;
    fuzzyEdgeCount: number;
    parentEdgeCount: number;
  };
}
```

Path legality: cover `[0, N)`, contiguous, no overlap/hole, each edge length ≤5.

### 4.4 Path identity stability

```text
boundaryKey = stable identity key of a Path
pathId = runtime convenience id
```

Rules:

* `pathId` MUST NOT depend on non-deterministic array order
* Recommended: `pathId = deterministicHash(boundaryKey)` (hex or base32)
* Same input + same lexicon + same config → stable `pathId` / `boundaryKey` across runs

### 4.5 Edge / Candidate reference sharing

```text
SegmentationPath.edgeRefs references shared LexicalEdge objects
Path MUST NOT deep-copy candidates[]
FormalFineSpan adapter MUST NOT deep-copy candidates[]
```

Purpose: prevent memory multiplication by Path count.

### 4.6 PathFineSpanView (ephemeral adapter only)

```ts
interface PathFineSpanView {
  pathId: string;
  boundaryKey: string;
  formalFineSpans: FormalFineSpan[];
}
```

Forbidden: persist as utterance-level Fine Span SSOT; merge across Paths; rebuild alternate Paths from the view; mutate Edge candidates.

### 4.7 PathDomainVoteResult / PathSentenceCandidate / GlobalSentenceCandidate

```ts
interface PathDomainVoteResult {
  pathId: string;
  boundaryKey: string;
  rankedDomains: DomainVoteScore[];
  retainedDomains: string[];
  voteTrace: DomainVoteTrace;
}

interface PathSentenceCandidate {
  text: string;
  pathId: string;
  boundaryKey: string;
  domainBucket?: string;
  sourceEdges: string[];
  sourceTermIds: number[];
  assemblyScore?: number;
}

interface GlobalSentenceCandidate {
  text: string;
  sources: Array<{
    pathId: string;
    boundaryKey: string;
    domainBucket?: string;
    sourceEdges: string[];
    sourceTermIds: number[];
  }>;
  preKenlmRank?: number;
  kenlmScore?: number;
  finalRank?: number;
}
```

Same text may be sent to KenLM once; all sources retained in Trace.

---

## 5. Lexical Single-Syllable Contract

A formal (lexical) length-1 Edge MUST:

```text
come from operational lexicon Recall
have a real termId
have normal Recall evidence
carry domains[] from the formal term
```

Forbidden:

```text
“any Chinese character may become a lexical Edge”
```

---

## 6. Fallback Edge Injection Contract (FROZEN)

### 6.1 Injection procedure

```text
Step 1: Attempt complete paths using lexical Edges only
Step 2: If lexical graph cannot reach from 0 to N, locate minimal unreachable gap(s)
Step 3: Inject fallback Edge(s) only for necessary gaps
Step 4: Re-enumerate complete paths
```

### 6.2 Forbidden

```text
Unconditionally create a fallback single-syllable Edge at every syllable position
```

### 6.3 Fallback Edge properties

```text
edgeKind = fallback
no domain tags
does not cast domain votes
preserves raw syllable / text coverage
used only to cover unreachable gaps
Trace records injection reason
```

### 6.4 Fallback length (this Contract version)

```text
fallback length = 1
```

Continuous multi-syllable fallback Edges are **out of scope** for V1.0.0. If later needed, require Contract Change Record ≥1.1.0.

### 6.5 Explosion control

Because unconditional per-position fallback is forbidden, all-monosyllable path explosion from fallback is structurally prevented unless the lexical graph is empty over large spans — in which case only gap-minimal length-1 fallbacks are injected, then path caps (§8) apply.

---

## 7. Coarse Span Authority (FROZEN)

Fields `coarseBoundaryRefs` / `crossesCoarseBoundary` MAY be used for:

```text
Trace
structural diagnostics
blocked gap judgment
secondary stable sort evidence when resource caps fire
```

MUST NOT be used to:

```text
block WindowQuery generation
skip Recall
delete a LexicalEdge
declare a Candidate illegal
directly decide boundaryKey
```

---

## 8. Path Retention and Deterministic Pruning (FROZEN)

### 8.1 Retention without caps

```text
If resource caps are NOT triggered, every legal complete boundaryKey MUST be retained.
Structural evidence MUST NOT default-select a single “best” Path.
```

### 8.2 Probe caps (NOT final frozen values)

```text
maxActivePathsPerPosition = 8     # PROBE VALUE — NOT FINAL FROZEN VALUE
maxCompleteSegmentationPaths = 8  # PROBE VALUE — NOT FINAL FROZEN VALUE
maxSentenceCandidates = 16        # FROZEN
maxWindowLength = 5               # FROZEN
```

Final path-cap values are set by acceptance data (Phase 2/6), not by this Contract’s probe defaults.

### 8.3 Deterministic prune order (only when a cap fires)

Sort ascending priority (worse first to drop), using **only** structure + Recall evidence:

```text
1. fallbackEdgeCount ASC
2. invalidGapCount ASC
3. fuzzyEdgeCount ASC
4. parentEdgeCount ASC
5. toneRelaxedEdgeCount ASC
6. exactEdgeCount DESC
7. lexicalEdgeCount DESC
8. boundaryKey ASC   # final deterministic tie-break
```

Forbidden prune inputs:

```text
Domain Vote | Assembly | KenLM | LLM | final fluency
```

### 8.4 Pruned Path Trace

```ts
interface PrunedSegmentationPathTrace {
  boundaryKey: string;
  pruneStage: "per_position_cap" | "complete_path_cap";
  pruneReason: string;
  structuralEvidence: {
    fallbackEdgeCount: number;
    fuzzyEdgeCount: number;
    parentEdgeCount: number;
    toneRelaxedEdgeCount: number;
    exactEdgeCount: number;
  };
}
```

Utterance Trace MUST include:

```text
completePathCountBeforePrune
retainedCompletePathCount
prunedPathCount
prunedBoundaryKeys
pruneReasons
```

Dev logs may truncate display; **test archives MUST keep full prune results**.

---

## 9. Path-local Vote / Assembly / Compatibility

* Domain Vote formula: unchanged; only **caller granularity** becomes per-Path
* Assembly: Path Edge order only; no cross-Path stitching
* CompatibilityGraph:
  * KEEP: intra-span candidate compatibility; call per Path
  * DELETE: overlap / unique-formal coverage already guaranteed by Path
  * FORBIDDEN: cross-Path compatibility edges

---

## 10. Global ≤16 and KenLM

* Allocator operates after all Path assemblies merge
* Prefer: each valid Path keeps ≥1 sentence when slots remain
* Identical text: one KenLM input; multi-source Trace retained
* KenLM scorer may remain `string[]`; metadata rebound externally

---

## 11. Forbidden Interfaces

```text
feature flag enabling LTR Fine Span
shadow dual execution of LTR + Lattice
fallback to commitBestFormalFineSpan after lattice failure
second lexicon / second domain config source
KenLM-driven boundary selection before scoring
new SQLite indexes / temp tables / persistent runtime intermediate tables
```

---

## 12. Trace Contract (minimum)

Utterance: `sentenceId`, `syllableCount`, `windowCount`, `uniqueRecallKeyCount`, `sqlStatementCount`, `edgeCount`, `lexicalEdgeCount`, `fallbackEdgeCount`, `completePathCount`, `retainedPathCount`, `prunedPathCount`, `boundaryKeys`, `perPathVote`, `perPathRetainedDomains`, `perPathCandidateCount`, `globalCandidateCount`, `kenlmInputCount`, `kenlmTopK`, `finalPathId`, `finalBoundaryKey`, plus prune fields in §8.4.

Per path: `pathId`, `boundaryKey`, edge ranges, candidate counts, fallback count, vote, retained domains, assembly count, allocation count, KenLM scores.

No full lexicon dumps in logs.

---

## 13. Phase Boundaries (reminder)

| Phase | Allowed | Forbidden |
|-------|---------|-----------|
| 1 | windows, recall dedupe, LexicalEdge via harness | production orchestrator cutover; Vote; Assembly; KenLM; dual chain |

**Phase 1 status (2026-07-27):** **CLOSED** — see Phase 1 Final Closure Report. Next gate: Phase 2 Pre-Development Audit only.
| 2 | Path enum; remove LTR production ownership | feature flag dual chain |
| 3 | Path Vote/Assembly; Compatibility KEEP/DELETE | cross-Path edges |
| 4 | global ≤16; KenLM metadata bind | raising KenLM input >16 |
| 5 | Parent tags batch; prepared reuse | new indexes/temp tables |
| 6 | delete dead LTR; docs re-freeze | leaving dual docs |

---

## 14. Draft Supersession

This file supersedes:

```text
FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Interface_Data_Contract_Draft_2026_07_26.md
```

for implementation authority. The Draft may remain as historical artifact with status **SUPERSEDED**.
