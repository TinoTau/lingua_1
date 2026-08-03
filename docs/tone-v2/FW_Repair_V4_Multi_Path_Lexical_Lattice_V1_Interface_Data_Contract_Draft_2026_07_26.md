> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4 — Multi-Path Lexical Lattice V1 · Interface / Data / Ownership Contract Draft

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Phase | **0** Draft（开发 SSOT；验收后替换旧冻结文档） |
| Plan | `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Development_Plan_2026_07_26.md` |
| Baseline | `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase0_Baseline_Report_2026_07_26.md` |
| Status | **SUPERSEDED** by `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md` (**APPROVED FOR IMPLEMENTATION**) |

---

## 1. Interface Contract (Draft)

### 1.1 Target Pipeline

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

### 1.2 Ownership Boundaries

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

### 1.3 Forbidden Interfaces

```text
feature flag enabling LTR Fine Span
shadow dual execution of LTR + Lattice
fallback to commitBestFormalFineSpan after lattice failure
second lexicon / second domain config source
KenLM-driven boundary selection before scoring
```

### 1.4 Adapter Only

```ts
materializeFormalFineSpans(path: SegmentationPath): PathFineSpanView
```

- Unidirectional Path → view
- No deep-copy of candidate arrays (share Edge refs)
- Not persisted as utterance-level Fine Span SSOT
- Must carry `pathId` + `boundaryKey`

---

## 2. Data Contract (Draft)

### 2.1 LexicalWindowQuery

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

Invariant: `1 <= end - start <= 5`, `[start, end)`.

### 2.2 LexicalEdge

```ts
interface LexicalEdge {
  edgeId: string;
  syllableStart: number;
  syllableEnd: number;
  edgeKind: "lexical" | "fallback";
  candidates: WindowCandidate[];  // domains[] already attached
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

Invariant: one Edge per `(syllableStart, syllableEnd)`; candidate merge key prefers `termId`.

### 2.3 SegmentationPath (Fine Span SSOT)

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

### 2.4 Path / Global Candidates

```ts
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

Same text may merge for KenLM input once; all sources retained in Trace.

### 2.5 Probe Resource Caps (non-frozen)

```text
maxActivePathsPerPosition = 8   // probe; finalize from acceptance data
maxCompleteSegmentationPaths = 8
maxSentenceCandidates = 16      // frozen
maxWindowLength = 5             // frozen
```

---

## 3. Ownership Matrix (Draft)

| Module | Owns | Does not own |
|--------|------|--------------|
| Window Generator | All continuous 1..5 queries | Candidate content |
| Recall | Candidates + full `domains[]` | Boundary choice / vote |
| Edge Builder | Unique edges + merge | Path enumeration |
| Path Enumerator | Complete `SegmentationPath[]` | Domain / language score |
| Vote caller | Per-path pools + retention | Formula rewrite |
| Assembly | Per-path SameDomain sentences | Cross-path stitching |
| Global Allocator | ≤16 slots + multi-source merge | KenLM score |
| KenLM adapter | Score bind-back to sources | Segmentation |
| Diagnostics | Path-aware Trace fields | Production decisions |

---

## 4. CompatibilityGraph Disposition (Phase 3 gate)

| Class | Action | Rule |
|-------|--------|------|
| KEEP | Per-path only | Intra-span candidate compatibility only |
| DELETE | Remove | Overlap / unique-formal coverage already guaranteed by Path |
| FORBIDDEN | Never | Cross-path compatibility edges |

Each function must be labeled KEEP or DELETE in the Development Report.

---

## 5. Trace Contract (Minimum)

Utterance: `sentenceId`, `syllableCount`, `windowCount`, `uniqueRecallKeyCount`, `sqlStatementCount`, `edgeCount`, `lexicalEdgeCount`, `fallbackEdgeCount`, `completePathCount`, `retainedPathCount`, `prunedPathCount`, `boundaryKeys`, `perPathVote`, `perPathRetainedDomains`, `perPathCandidateCount`, `globalCandidateCount`, `kenlmInputCount`, `kenlmTopK`, `finalPathId`, `finalBoundaryKey`.

Per path: `pathId`, `boundaryKey`, edge ranges, candidate counts, fallback count, vote, retained domains, assembly count, allocation count, KenLM scores.

No full lexicon dump in logs.

---

## 6. Document Replacement Note

After acceptance, replace conflicting frozen claims in:

```text
LTR unique Fine Span main chain
one FormalFineSpan per cursor commit
no multi-path segmentation
one Domain Vote over full Formal pool
single Formal-sequence Assembly
```

Until then, **this Draft + approved Plan** are the development SSOT.
