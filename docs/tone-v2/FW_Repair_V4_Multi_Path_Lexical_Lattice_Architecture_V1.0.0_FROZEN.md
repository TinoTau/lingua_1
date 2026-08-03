# FW Repair V4 — Multi-Path Lexical Lattice Architecture V1.0.0

| Field | Value |
|-------|-------|
| Document | **Architecture SSOT** (Architecture · Interface · Data · Ownership · Diagnostics · Trace · Regression · Acceptance · Freeze Declaration) |
| Version | **1.0.0** |
| Date | 2026-07-26 |
| Status | **FROZEN FOR IMPLEMENTATION** |
| Normative peer | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md) |
| Precedence | On Lattice Fine Span / Window / Edge / Path / Path-scoped Vote·Assembly caller / Global ≤16 Trace: **this file + Implementation Contract win**. On Domain Vote **formula** / Multi-Bucket SameDomain rules: [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) remains formula owner, with **caller granularity = per Path**. |
| Code cutover | Production LTR Fine Span remains until Phase 2 code replace; **architecture SSOT is already Lattice** — LTR is transitional code debt, not a second valid architecture. |

---

## 0. Freeze Declaration

```text
FW Repair V4 Multi-Path Lexical Lattice Architecture V1.0.0
Status: FROZEN FOR IMPLEMENTATION
```

### FROZEN (architecture)

```text
SegmentationPath[] = sole Fine Span SSOT
Full-utterance contiguous windows length 1..5, syllable [start,end)
SQLite lexicon = sole Candidate legality source
term_domain_tags → Candidate.domains[] before LexicalEdge
Bounded Complete Segmentation Path Enumeration
Per-Path Domain Vote caller (formula unchanged)
Per-Path SameDomain Assembly
Global Sentence Candidates <= 16
KenLM cross-Path scoring only
No dual LTR/Lattice chain, no feature flag, no shadow
No new SQLite indexes / temp tables
```

### PROVISIONAL / PROBE (not architecture-frozen values)

```text
maxActivePathsPerPosition = 8          # PROBE VALUE — NOT FINAL FROZEN VALUE
maxCompleteSegmentationPaths = 8       # PROBE VALUE — NOT FINAL FROZEN VALUE
CompatibilityGraph per-function KEEP/DELETE  # PENDING PHASE 3 CODE AUDIT
Post-acceptance latency/memory thresholds
```

---

## 1. Unique Frozen Main Chain

```text
FW 整句结果
→ UtteranceSyllableCoordinate
→ 连续 1～5 音节 WindowQuery
→ SQLite Lexicon Recall
→ LexicalEdge[]
→ SegmentationPath[]
→ Path-specific Domain Vote
→ Path-specific SameDomain Assembly
→ Global Candidate Allocation <=16
→ KenLM Cross-Path Scoring
→ Top-K / Final Result
```

### Explicit non-equivalences

```text
系统不采用语义 Beam / KenLM Beam / domain Beam
但允许有限完整 SegmentationPath 并行保留
路径限宽 = 资源保护，≠ 语言决策
Multi-Path Lattice ≠ 恢复旧 Beam 主链
```

### Replaced (no longer valid architecture)

```text
LTR unique Fine Span main chain
commitBestFormalFineSpan as Fine Span SSOT
cursor = formalSpan.syllableEnd search ownership
formal windows 2..5 only; length-1 only as old fallback
single FormalFineSpan[] as Fine Span SSOT
one utterance-wide Domain Vote over all Formal spans
Assembly on a single Formal sequence only
must pick unique boundary before Domain Vote
“no Beam” ⇒ “no multi-path”
```

---

## 2. SSOT Layers

| Layer | Sole owner document | Owns |
|-------|---------------------|------|
| Fine Span / Window / Edge / Path | **This Architecture V1.0.0** + Implementation Contract V1.0.0 | Boundaries, windows, edges, paths, path prune mechanism, adapter FormalFineSpan |
| Domain Vote **formula** | Runtime_SSOT_Contract_Freeze | Presence rules, 0.75 retention, base not voting |
| Vote **caller granularity** | **This Architecture** | One vote pool per `SegmentationPath` |
| Lexicon domain tags | Lexicon_Domain_Contract_Freeze_V1 + DSU | `term_domain_tags` |
| KenLM pick / Gate | kenlm SCORE + KENLM_RUNTIME | raw_log_delta, Gate 3.0 |
| Evolution process | Lingua_Runtime_Evolution_Rule | Field freeze → Catalog → Metrics |

Conflict priority for Lattice Fine Span topics:

```text
This Architecture V1.0.0 + Implementation Contract V1.0.0
> Runtime_SSOT (formula only)
> Supporting fw-detector contracts
> Accepted audits
> Historical SoftBoundary / LTR reports
```

---

## 3. Fine Span SSOT

```text
SegmentationPath[] is the sole Fine Span segmentation SSOT
```

```text
SegmentationPath
  └─ LexicalEdge[]   (shared refs)
       └─ WindowCandidate[]
```

`FormalFineSpan[]` MAY exist only as:

```text
SegmentationPath → materializeFormalFineSpans(path) → Vote/Assembly adapter view
```

**Forbidden:** FormalFineSpan as independent SSOT; view mutating Path; dual persisted segmentations; downstream recomputing boundaries.

---

## 4. Window SSOT

```text
Window Generator owns all contiguous syllable windows length 1..5 for the utterance
```

- Index space: syllable half-open `[start, end)`
- Max length: **5**
- Coarse must **not** hard-cut windows

**Forbidden:** mixing char/syllable indices; cursor-only windows; length >5; coarse deleting legal windows before Recall.

---

## 5. Lexicon / Domain SSOT

```text
SQLite operational lexicon = sole Candidate legality source
term_domain_tags = sole domain-tag source
Candidate.domains[] fully assembled before LexicalEdge
```

Formal lexical Edge ⇒ ≥1 formal lexicon Candidate with real `termId`.

**Forbidden:** second wordlists; config whitelist; LLM legality; KenLM pre-legality; hard-coded industry terms; collapsing multi-domain to single `domainId`; Vote/Assembly/KenLM querying SQLite; downstream Parent tag lookup.

---

## 6. Coarse Span Authority

**Allowed:** soft reference; gap / blocked region; FW raw-boundary Trace; timestamp assist; secondary structure evidence when path caps fire.

**Forbidden:** hard-cut 1..5 windows; skip Recall; delete legal LexicalEdge; decide `boundaryKey`; act as Fine Span SSOT; replace SegmentationPath.

---

## 7. Fallback Edge Contract

```text
1) Enumerate complete paths using lexical Edges only
2) If [0,N) unreachable, locate minimal gap(s)
3) Inject fallback Edges only for necessary gaps
4) Re-enumerate complete paths
```

```text
fallback length = 1
no domain tags; does not vote
preserves raw text/syllables
Trace records injection reason
```

**Forbidden:** unconditional per-position fallback; treating any character as lexical Edge; fallback domain inheritance.

---

## 8. Path Enumeration Contract

**Name (frozen):** `Bounded Complete Segmentation Path Enumeration` / 有限完整分界路径枚举

Legal path: `start=0`, `end=syllableCount`, contiguous, no hole/overlap, each edge length ≤5.

```text
If resource caps are NOT triggered, retain every legal complete boundaryKey
```

Must not prune using Domain Vote, SameDomain, Assembly, KenLM, LLM, or final fluency.

### Probe caps (PROVISIONAL)

```text
maxActivePathsPerPosition = 8      # PROBE — NOT FINAL
maxCompleteSegmentationPaths = 8   # PROBE — NOT FINAL
```

When a cap fires, prune using only: fallback count, Recall evidence (exact/fuzzy/parent/tone-relaxed), stable `boundaryKey` tie-break. See Implementation Contract §8 for full sort order.

`boundaryKey` = stable identity; `pathId` = deterministic convenience id (e.g. hash of boundaryKey).

Paths share `LexicalEdge` refs; no deep-copy of `candidates[]`.

---

## 9. Domain Vote (caller + formula)

**Formula (unchanged, Runtime SSOT):** base does not vote; multi domain candidates contribute full tags; unique max retained; ties all retained; insufficient margin uses existing ratio threshold.

**Caller (this Architecture):**

```text
for each SegmentationPath: independent Domain Vote
```

**Forbidden:** shared vote pool across Paths; Path A candidates voting into Path B; Vote mutating boundaries; Vote SQLite; LLM-dominant Path domain.

---

## 10. SameDomain Assembly

```text
Per Path: retainedDomains → SameDomain buckets → sentence assembly
Preserve Edge order
```

**Forbidden:** Path A prefix + Path B suffix; cross-Path ReplacementPick sharing; reordering Spans; full candidate permutation; cross-Path CompatibilityGraph.

---

## 11. CompatibilityGraph Architecture Authority

| Class | Rule | Status |
|-------|------|--------|
| KEEP | Intra-span / intra-path candidate compatibility only | Authority **FROZEN**; per-function list **PENDING PHASE 3 CODE AUDIT** |
| DELETE | Formal overlap adjudication; unique Formal coverage; Path-guaranteed non-overlap; cross-path conflict | Authority **FROZEN**; symbols **PENDING PHASE 3** |
| FORBIDDEN | Cross-Path compatibility edges | **FROZEN now** |

---

## 12. Global Candidate Governance

```text
maxSentenceCandidates = 16   # FROZEN global after all Paths merge
```

1. Each valid Path keeps ≥1 sentence when slots remain  
2. Remaining quota via Global Candidate Allocator  
3. Identical text → one KenLM input  
4. Identical text retains **all** Path sources in Trace  
5. Global count ≤16  
6. One Path must not starve all others  

---

## 13. KenLM Duties

```text
KenLM scores at most 16 complete sentences (cross-Path)
```

**Does not own:** Window, Recall, Edge, Path enum, Vote, SameDomain, Candidate legality, Path prune.

If scorer is `string[]`, outer map `text → GlobalSentenceCandidate.sources[]` must rebind `kenlmScore`, `finalRank`, `pathId`, `boundaryKey`, `domainBucket`, `sourceEdges`, `sourceTermIds`.

Fail-open behavior remains existing KenLM freeze.

---

## 14. Interface Contract (DTO catalog)

Each DTO: Responsibility · Input · Output · Invariants · Owner · Consumer restrictions · Trace · Error/fallback.

### 14.1 LexicalWindowQuery

| | |
|--|--|
| Responsibility | Describe one contiguous syllable window query |
| Input | UtteranceSyllableCoordinate + start/end |
| Output | windowId, keys, coarse refs, length |
| Invariants | `1<=end-start<=5`; `[start,end)` syllable |
| Owner | Window Generator |
| Consumers must not | Treat as Edge/Path; skip Recall via coarse |
| Trace | windowCount, crossesCoarseBoundary |
| Error/fallback | Invalid range rejected; no silent length>5 |

### 14.2 LexicalEdge

| | |
|--|--|
| Responsibility | Unique boundary + merged Candidates |
| Input | Windows + Recall hits |
| Output | edgeKind lexical\|fallback, candidates[], evidence |
| Invariants | One edge per (start,end); domains[] complete for lexical; **Evidence OR before identity first-wins** (Phase 1 Closure) |
| Owner | Edge Builder |
| Consumers must not | Delete edge for temporary vote score |
| Trace | edgeCount, lexical/fallback counts; evidence flags |
| Error/fallback | No lexicon hit ⇒ no lexical edge; gap may get fallback later |

### 14.3 SegmentationPath

| | |
|--|--|
| Responsibility | Complete legal segmentation SSOT unit |
| Input | LexicalEdge graph |
| Output | pathId, boundaryKey, edgeRefs, structuralEvidence |
| Invariants | Cover [0,N); contiguous; boundaryKey unique |
| Owner | Path Enumerator |
| Consumers must not | Mix edges across paths; deep-copy candidates |
| Trace | boundaryKeys, prune fields |
| Error/fallback | Unreachable ⇒ fallback injection then re-enum |

### 14.4 PathFineSpanView

| | |
|--|--|
| Responsibility | Ephemeral FormalFineSpan adapter |
| Input | One SegmentationPath |
| Output | pathId, boundaryKey, formalFineSpans |
| Invariants | Not persisted as utterance SSOT |
| Owner | Adapter (Vote/Assembly bridge) |
| Consumers must not | Rebuild Path; mutate Edge candidates |
| Trace | pathId, boundaryKey |
| Error/fallback | Missing path ⇒ no view |

### 14.5 PathDomainVoteResult

| | |
|--|--|
| Responsibility | Path-local vote outcome |
| Input | PathFineSpanView / Edge pools |
| Output | rankedDomains, retainedDomains, voteTrace |
| Invariants | Isolated per pathId |
| Owner | Vote caller |
| Consumers must not | Merge pools across Paths |
| Trace | perPathVote, perPathRetainedDomains |
| Error/fallback | Empty pool ⇒ general / empty retained per existing formula |

### 14.6 PathSentenceCandidate / GlobalSentenceCandidate

| | |
|--|--|
| Responsibility | Path sentence vs globally allocated KenLM unit |
| Input | Path assembly / merge |
| Output | text + sources[] + ranks/scores |
| Invariants | Global ≤16; multi-source preserved |
| Owner | Assembly / Global Allocator |
| Consumers must not | Drop sources on text dedup |
| Trace | perPathCandidateCount, globalCandidateCount |
| Error/fallback | Empty assembly ⇒ Path may contribute 0; allocator records |

### 14.7 PrunedSegmentationPathTrace

| | |
|--|--|
| Responsibility | Record resource prune (not language decision) |
| Input | Cap fire + structuralEvidence |
| Output | boundaryKey, pruneStage, pruneReason, evidence |
| Invariants | Only when cap triggered |
| Owner | Path Enumerator |
| Consumers must not | Use as semantic quality score |
| Trace | prunedPathCount, prunedBoundaryKeys, pruneReasons |
| Error/fallback | N/A when no prune |

### 14.8 Path-aware KenLM metadata mapping

| | |
|--|--|
| Responsibility | Bind KenLM scores back to GlobalSentenceCandidate.sources |
| Input | scoreBatch results + text→sources map |
| Output | kenlmScore, finalRank on candidates |
| Invariants | ≤16 inputs; sources never dropped |
| Owner | KenLM Adapter |
| Consumers must not | Let KenLM choose Path before scoring |
| Trace | kenlmInputCount, kenlmTopK, finalPathId, finalBoundaryKey |
| Error/fallback | fail-open per KenLM freeze |

---

## 15. Ownership / Decision Matrix

| Module | Owns | Does Not Own |
|--------|------|--------------|
| Syllable Coordinate | Syllable coordinates | Span segmentation |
| Window Generator | Contiguous 1..5 windows | Candidates |
| Recall | Candidates + full domains[] | Boundaries / domain decision |
| Edge Builder | Unique edges + candidate merge | Paths |
| Path Enumerator | Complete SegmentationPath[] | Domain / language score |
| Vote Caller | Path-local vote pools | Changing vote formula |
| Assembly | Path-local SameDomain sentences | Cross-Path stitch |
| Global Allocator | Global ≤16 + multi-source merge | KenLM language score |
| KenLM Adapter | Score bind + source map | Span/Path decisions |
| Diagnostics | Trace | Production decisions |

No two modules may co-own the same decision row above.

---

## 16. Diagnostics Contract

- Diagnostics observe only; never change Recall / Path / Vote / Assembly / KenLM decisions.
- Path-aware fields are **required** in archives; console may truncate.
- selected ≠ applied ≠ approved remains (existing diagnostics freeze).
- New path fields must follow Lingua_Runtime_Evolution_Rule before Metrics consumption.

---

## 17. Trace Contract

### Utterance

```text
sentenceId, syllableCount, windowCount, uniqueRecallKeyCount,
edgeCount, lexicalEdgeCount, fallbackEdgeCount,
completePathCountBeforePrune, retainedCompletePathCount, prunedPathCount,
prunedBoundaryKeys, pruneReasons, boundaryKeys,
perPathVote, perPathRetainedDomains, perPathCandidateCount,
globalCandidateCount, kenlmInputCount, kenlmTopK,
finalPathId, finalBoundaryKey
```

### Per Path

```text
pathId, boundaryKey, edge ranges, candidate counts, fallback count,
structural evidence, vote result, retained domains,
assembly count, allocation count, KenLM score, final rank
```

No full lexicon dumps in logs.

---

## 18. Regression Contract

### Must not break

```text
Phase 0 syllable coordinate SSOT
FW Word Timestamp / Tone alignment
Latin/CJK gap block
SQLite lexicon SSOT
term_domain_tags multi-domain
base does not cast domain votes
Domain Vote existing ratio rules
Parent structural key no double-count
global Sentence Candidate <=16
KenLM fail-open
NMT pre-output contract
repairTarget / Apply narrow exit
```

### New must-hold (Lattice)

```text
multiple boundaryKeys may be retained together
same boundaryKey does not expand to multiple Paths for multi-Candidate
per-Path Vote isolation
per-Path Assembly isolation
identical text retains multi-source Trace
Path resource prune is deterministic
```

---

## 19. Acceptance Contract

1. Full-utterance contiguous windows 1..5  
2. Syllable `[start,end)`  
3. Coarse does not hard-cut legal windows  
4. At most one LexicalEdge per boundary  
5. Edge may hold many Candidates  
6. domains[] complete before Edge  
7. Multiple legal boundaryKeys retained  
8. Each Path covers `[0,N)`  
9. No legal Path deleted without cap fire  
10. Per-Path Vote  
11. Per-Path SameDomain Assembly  
12. No cross-Path sentence stitch  
13. Global candidates ≤16  
14. Identical text keeps all Path sources  
15. KenLM cross-Path unified scoring  
16. Vote/Assembly/KenLM zero SQLite  
17. No new indexes  
18. No temp tables  
19. No dual chain  
20. No LTR production fallback after cutover  
21. No second Fine Span SSOT  
22. No conflicting active architecture docs  

---

## 20. Implementation Phases (reminder)

| Phase | Code allowed | Still forbidden |
|-------|--------------|-----------------|
| 1 | Windows, Recall dedupe, LexicalEdge + harness | Orchestrator cutover, delete LTR, Vote/Assembly/KenLM wire, dual chain |
| 2 | Path enum; remove LTR production ownership | Feature-flag dual chain |
| 3 | Path Vote/Assembly; Compatibility KEEP/DELETE | Cross-Path edges |
| 4 | Global ≤16 metadata | Raising KenLM input >16 |
| 5 | Parent tags batch | New indexes/temp tables |
| 6 | Dead code delete; freeze tests; doc re-lock | Leaving dual docs |

---

## 21. Document Map

| Concern | Location |
|---------|----------|
| This Architecture SSOT | **this file** |
| Implementation DTO/pruning detail | Implementation Contract V1.0.0 |
| Delete/Replace symbols | Delete_Replace_Matrix |
| Domain Vote formula | Runtime_SSOT_Contract_Freeze |
| Supersession list | Document_Supersession_Index |
| Freeze report | Architecture_Document_Freeze_Report |
| **Phase 1 Closure** | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Final_Closure_Report_2026_07_27.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Final_Closure_Report_2026_07_27.md) |
| Phase 1 Acceptance Contract (CURRENT) | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Acceptance_Contract_CURRENT_2026_07_27.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Acceptance_Contract_CURRENT_2026_07_27.md) |
| Phase 1 Developer Guide | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Developer_Guide_CURRENT_2026_07_27.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Developer_Guide_CURRENT_2026_07_27.md) |

---

## 22. Phase 1 Closure Addendum (2026-07-27)

```text
Phase 1 (Windows · Recall dedupe · LexicalEdge · harness): CLOSED
Production cutover remains Phase 2 — LTR transitional code debt unchanged.
```

### LexicalEdge Evidence (normative for Path consumers)

```text
Edge Evidence OR aggregates ALL Candidates on a boundary BEFORE identity first-wins.
Candidate identity = termId preferred, else candidateId.
hasFuzzy from recallCandidateKind (existing classifier), not surface text.
```

### Recall traversal (normative)

```text
Every legal recallable Window in the Recall input MUST be recalled.
Diagnostics: logicalWindowRecallCount, physicalSqlStatementCount (facts only).
Resource policy MUST NOT skip/truncate legal Windows.
```
