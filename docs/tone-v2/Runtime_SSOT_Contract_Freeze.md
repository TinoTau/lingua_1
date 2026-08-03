# Runtime SSOT Contract Freeze

| Field | Value |
|------|-----|
| Status | **FROZEN** |
| Freeze Version | **Runtime SSOT Contract V1.2** (Fine-Span Domain Presence Vote + Multi-Bucket + Cross-Bucket Dedup + **Path-scoped Vote/Assembly caller**) + **Tone Evidence / Mapping Contract V1.0 (2026-07-29)** |
| Freeze Date | **2026-07-26** (V1.2 Lattice caller alignment) · **2026-07-29** (Tone Evidence / Mapping Final Freeze) · **2026-07-30** (Step 5 Trace / Diagnostics / Acceptance consolidation) |
| Prior | V1.1 ACCEPTED 2026-07-20 — Vote **formula** unchanged |
| Acceptance | Vote formula **ACCEPTED AND FROZEN** — [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md) |
| Tone Evidence / Mapping | **FROZEN** — [`FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) |
| Fine Span / Path SSOT | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Owner | Runtime Domain (formula) · Lattice Architecture (Path Fine Span + caller granularity) · Tone Evidence SSOT (Mapping) |
| Index | [RUNTIME_DOMAIN_DOCUMENT_INDEX.md](./RUNTIME_DOMAIN_DOCUMENT_INDEX.md) |

---

## 0. Accepted Result Freeze Scope

```text
Runtime Domain Presence Vote FORMULA:
ACCEPTED AND FROZEN

Vote / Assembly CALLER GRANULARITY (V1.2):
one independent vote + SameDomain assembly per SegmentationPath
```

Authority citation (formula): [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md).  
Authority citation (Fine Span / Path): [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md).

### FROZEN

```text
Domain Fact propagation
FineSpanDomainSet (within one Path Fine Span / Edge projection)
One Span One Vote (within Path)
0.75 retainedDomains
Multi-Bucket Assembly (within Path)
Base enters every bucket
Cross-bucket dedup (within Path allocation, then global)
Candidate cap 16 (global after all Paths)
KenLM merged-pool boundary (cross-Path)
Context Prior diagnostics-only
prefilledCombinations: required
Path-scoped Vote / Assembly callers
PathFineSpan[] / SegmentationPath[] = Fine Span SSOT (FormalFineSpan naming retired)
Architecture Compliance: generatorMode=multi_path_lattice; voteScope/assemblyScope=per_path; candidateCapScope=global; LTR runtime field retired (static module absence)
```

### NOT FROZEN

```text
Lexicon content quality
KenLM ranking quality
Recall noise quality
dialog_200 full E2E quality
Path probe caps (8/8) — PROVISIONAL
```

Functional freeze ≠ quality freeze.

---

## 1. Status / Version / Freeze Date

This file remains the sole authoritative contract for **Domain Vote formula**, retainedDomains selection rules, Multi-Bucket SameDomain rules, cross-bucket text dedup semantics, candidate cap **16**, and KenLM integration boundary.

Fine Span **segmentation** SSOT is **not** owned here — see Lattice Architecture V1.0.0 (`SegmentationPath[]`).

**Tone Evidence / Tone Mapping** SSOT is owned by the freeze block in §0A below and the Final Freeze Report (2026-07-29). Vote / Assembly / KenLM boundaries here must **not** reopen Tone fill, neighbor borrow, or half-open overlap.

Do not create parallel copies named V2, Final, Latest, (2), or (3).

---

## 0A. Tone Evidence / Tone Mapping — FROZEN (2026-07-29)

```text
Module:
Tone Evidence / Tone Mapping

Status:
FROZEN

Frozen Contract:
Real Audio Evidence Only
Single SSOT
Strict Half-Open Overlap
Evidence Unavailable Allowed
No Tone Fill
No Neighbor Borrowing
```

| Rule | Contract |
|------|----------|
| Evidence SSOT | `ctx.acousticToneSlices` only — Mapping / API JobResult / Diagnostics / Trace / Acceptance |
| Forbidden source | `ctx.asrResult.tone` as business Slice source or first-batch-priority observation |
| Production | Slice / posterior only from real audio with `start < end`; allow skip: `start >= end`, `duration < MIN_SLICE_SEC`, feature fail, inference miss, invalid word time — with diagnostics |
| Forbidden fill | Copy neighbor posterior · invent from text/pinyin · borrow neighbor Slice · synthesize Slice |
| Overlap | `slice.end > span.start && slice.start < span.end` (half-open). Do **not** change to `>=` / `<=` |
| Mapping | Real overlapping Slice → real posterior → pattern; else `pattern=null` + `missReason`. Mapping does **not** invent Evidence |
| Evidence Unavailable | `start >= end` or no real overlap → legal business state → no-Tone downstream path |
| Diagnostics keep | Production: `slice_created` / `short_duration_skipped` / `feature_extraction_failed` / `inference_output_missing` / `invalid_word_time`. Mapping miss: `no_word_timespan_for_slot` / `no_slice_overlap_word_time` / `empty_posterior` / `invalid_posterior` |
| Diagnostics ban | Restore `toneOverlapSyllableMismatchCount` / `asrToneSliceCount` or semantic-duplicate aliases |
| dialog_200 residual | Coverage **99.65%** (288/289). Sole miss **d132** / window「诱惑」/ Word「诱」`[3.0,3.0]` → `FREEZE_AS_EVIDENCE_UNAVAILABLE` |

**Authority:** [`FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md)

**Unfreeze only if:**

1. Tone model input contract changes  
2. ASR timestamp contract changes  
3. Large-scale real tests prove Evidence Unavailable is a business bottleneck  
4. Architecture SSOT formally approves the change  

Do **not** unfreeze for a single case or coverage statistic.

---

## 2. Sole Authority Statement

```text
SOLE RUNTIME AUTHORITY (Vote formula / Multi-Bucket / ≤16 / KenLM boundary) = this file
SOLE FINE SPAN / PATH AUTHORITY = Lattice Architecture V1.0.0
SOLE TONE EVIDENCE / MAPPING AUTHORITY = §0A + ToneEvidence Mapping Final Freeze Report (2026-07-29)
```

Supporting contracts (Lexicon fact, Registry/Recall scope, Recall behavior, Assembly detail, KenLM runtime, Context Prior) must cite this file for Vote **formula**, retainedDomains, Multi-Bucket Assembly, cross-bucket dedup, candidate cap, and KenLM integration boundaries; cite Lattice Architecture for windows, edges, paths, and Path-scoped callers; cite §0A for Tone Evidence SSOT and Mapping overlap.

Development and acceptance reports are execution records only. They must not override these contracts.

---

## 3. Document Ownership and Conflict Priority

| Layer | Document | Role |
|------|----------|------|
| Fine Span / Path | Lattice Architecture V1.0.0 | Sole Fine Span SSOT |
| Tone Evidence / Mapping | **This file §0A** + Final Freeze Report | Sole Tone Evidence / Mapping SSOT |
| Runtime Vote formula | **This file** | Sole formula / Multi-Bucket / ≤16 / KenLM boundary |
| Lexicon domain facts | Lexicon_Domain_Contract_Freeze_V1.md | Supporting |
| Domain source / Registry / Recall scope | DOMAIN_SOURCE_UNIFICATION.md | Supporting |
| Recall behavior | DOMAIN_RECALL.md | Supporting |
| Assembly internal detail | FROZEN_V1_2.md | Supporting (Path-scoped) |
| KenLM runtime interface | KENLM_RUNTIME.md | Supporting |
| Context Prior | CONTEXT_PRIOR.md | diagnostics-only boundary |

Conflict priority:

```text
Lattice Architecture V1.0.0 (Fine Span / Path topics)
> This Runtime SSOT Contract §0A (Tone Evidence / Mapping)
> This Runtime SSOT Contract (Vote formula / Multi-Bucket / ≤16)
> Supporting contracts
> Accepted audits
> Execution / acceptance reports
> Historical documents (incl. SoftBoundary LTR-only claims; superseded Tone audits)
```

---

## 4. Unique Runtime Main Chain

```text
UtteranceSyllableCoordinate
        ↓
LexicalWindowQuery (1..5) → Recall → LexicalEdge[] → SegmentationPath[]
        ↓
(for each Path)
term_domain_tags
        ↓
Hotword.domains[] / WindowCandidate.domains[]
        ↓
FineSpanDomainSet (Path Fine Span / Edge projection)
        ↓
domainScores
        ↓
retainedDomains
        ↓
Domain Buckets + Base
        ↓
per-bucket bounded sentence generation
        ↓
(merge across Paths + text dedup, retain multi-source Trace)
        ↓
global Sentence Candidates <=16
        ↓
prefilledCombinations
        ↓
runFwSentenceRerankFromPrefilled
        ↓
rerankFwSentences
```

Formal path modules (target):

```text
span-assembly-v4-orchestrator
-> enumerateCompleteSegmentationPaths / runLatticeFineSpanGeneration
-> per-Path voteUtteranceDomainFromPool + SameDomain Assembly
-> mergeCrossPathSentenceCandidates (dedup-before-cap, global ≤16)
-> kenlmSentenceCandidates
-> fw-detector-v4-path
-> prefilledCombinations
-> runFwSentenceRerankFromPrefilled
-> rerankFwSentences
```

**Path-local note:** Cross-bucket generation remains inside each Path's Assembly; production KenLM input Owner is only `mergeCrossPathSentenceCandidates` (exact-text first-wins → global ≤16). The legacy higher-score `mergeCrossBucket*` helper has been removed.

**Forbidden as architecture:** utterance-wide single Vote over mixed Paths; FormalFineSpan[] as Fine Span SSOT (use PathFineSpan / SegmentationPath); legacy left-to-right unique commit.

---

## 5. Lexicon Domain Fact SSOT

- `term_domain_tags` is the sole lexicon domain-tag fact source.
- Lexicon contract owner: Lexicon_Domain_Contract_Freeze_V1.md.
- This Runtime contract consumes Hotword.domains[] after Lexicon/Recall propagation.

---

## 6. Hotword.domains[] Contract

- Hotword carries the full fine-domain list from term_domain_tags.
- Forbid projecting decisions through domainId or domains[0].

---

## 7. WindowCandidate.domains[] Contract

- Recall copies all fine domains from Hotword into WindowCandidate.domains[].
- CandidateScore must not mutate domains[].
- SpanReplacementPick / KenLM input objects must not carry domains metadata.

---

## 8. FineSpanDomainSet Definition

Within one fine span, FineSpanDomainSet is the union of domains[] from all vote-eligible candidates:

```text
source in {domain_term, passive_domain_weak}
not covered
domain label not empty / general / base_term
```

---

## 9. One Span One Vote Per Domain

One fine span contributes at most one vote per domain (Set presence).

Different spans may accumulate the same domain.

CandidateScore does not decide vote mass.

Do not use domains.length splitting or per-span Top1 vote.

---

## 10. Base Vote Exclusion

- source === base_term (no fine domains) does not vote.
- Base enters every retained domain bucket for Assembly, but does not increase domainScores.

---

## 11. domainScores Integer Semantics

```text
domainScores[domain] = number of distinct fine spans that present the domain
```

Forbid VoteMass, SOURCE_WEIGHT Vote, CoverageWeight Vote, and domains.length fan-out.

---

## 12. retainedDomains Rule

1. No domain votes -> base-only / insufficientEvidence.
2. Tied max counts -> retain all tied max domains.
3. Unique max with clear lead -> retain only the max domain.
4. Insufficient lead -> retain domains with count >= maxCount * DOMAIN_BUCKET_RETENTION_RATIO.

---

## 13. DOMAIN_BUCKET_RETENTION_RATIO = 0.75

Formal retention ratio is frozen at 0.75.

Do not change this value in documentation or code without a new contract.

---

## 14. Multi-Bucket Assembly

Multi-Bucket Assembly is the only formal Assembly path.

Each retained domain forms one bucket with Base.

Forbid single-domain Assembly fallback as the formal path.

---

## 15. Base Enters Every Bucket

Per bucket membership:

```text
same-domain candidates: domains.includes(bucketDomain)
plus Base candidates
```

---

## 16. Per-Bucket Bounded Generation

Each bucket may generate with internal cap = MAX_SENTENCE_CANDIDATES (16).

Do not use floor(16 / bucketCount) as the final per-bucket quota before cross-bucket dedup.

If retainedDomains.length > 16, allocateDomainBucketSentenceBudget must fail explicitly. Silent domain truncation is forbidden.

---

## 17. Cross-Path Merge / Dedup / Global Cap

Order (production KenLM input):

```text
PathAssemblyResult[] (all Paths / all SameDomain buckets)
-> mergeCrossPathSentenceCandidates
-> dedup by candidate.text (first-wins, stable Path→bucket→candidate order)
-> global slice(0, MAX_SENTENCE_CANDIDATES)
-> KenLM prefilledCombinations
```

`mergeCrossPathSentenceCandidates` is the sole production Cross-Path KenLM Owner (exact-text first-wins). Legacy higher-score cross-bucket merge helpers are removed.

---

## 18. Global Sentence Candidate Cap <=16

```text
maxSentenceCandidates = 16
Sentence Candidates <=16
```

This is the hard cap for the KenLM input pool.

---

## 19. KenLM Cross-Bucket Integration

KenLM ranks the already-merged cross-Path candidate pool once (`kenlmInputOwner = cross_path_merge`).

Formal wiring uses prefilledCombinations from `mergeCrossPathSentenceCandidates` into runFwSentenceRerankFromPrefilled.

KenLM input DTO may carry only raw / candidate sentence text — no domainScores / retainedDomains / bucketDomain / path score / vote score.

Forbidden: rebuild from primary bucket / spanSets when `prefilledCombinations` is undefined.

---

## 20. prefilledCombinations Contract

```text
prefilledCombinations: required
```

```text
fw-detector-v4-path passes
assemblyResult.kenlmSentenceCandidates.combinations ?? []
as prefilledCombinations
into runFwSentenceRerankFromPrefilled
```

Semantics:

```text
[] = explicit empty pool → KenLM fail-open raw
undefined is not allowed (no legacy primary spanSets rebuild)
```

KenLM must not rebuild a primary-bucket-only pool.

---

## 21. KenLM Input Boundary

KenLM receives only:

```text
raw sentence text
candidate sentence text
```

KenLM must not receive:

```text
domainScores
retainedDomains
bucketDomain
domains[]
```

KenLM does not decide domains.

---

## 22. raw_log_delta Contract

```text
scoreMode = raw_log_delta
pick = argmax(score(candidate) - score(raw))
if delta >= minDeltaToReplace else keep raw
```

Do not change the score mode or minDeltaToReplace in this documentation freeze.

---

## 23. Context Prior Boundary

```text
applied:false
diagnostics-only
does not participate in Domain Vote
does not participate in Assembly membership
does not modify CandidateScore
does not modify KenLM inputs or scores
```

Owner detail: CONTEXT_PRIOR.md.

---

## 24. Removed Chains

| Item | Status |
|------|--------|
| Shadow Beam | REMOVED |
| Graph Domain Vote | REMOVED |
| Domain Rerank | REMOVED |
| Candidate VoteMass / SOURCE_WEIGHT Vote | REMOVED |
| CoverageWeight Vote | REMOVED |
| domainId / domains[0] decisions | REMOVED |
| Parent Domain Vote production path | REMOVED |
| Context Prior decision multipliers | REMOVED |

---

## 25. Forbidden Restorations

Do not restore Shadow Beam, Graph Domain Vote, Domain Rerank, VoteMass, SOURCE_WEIGHT Vote, CoverageWeight Vote, Parent Domain Vote, domainId/domains[0] decisions, Context Prior multipliers, single-domain Assembly fallback, or domain-score-weighted bucket budgets.

Do not raise the final candidate cap above 16 in this contract.

---

## 26. Integration Acceptance Status

```text
KENLM INTEGRATION ACCEPTANCE: PASS
```

Meaning:

```text
real production scorer is invoked
cross-bucket candidate pool enters KenLM
model and query are runnable after warm-up
KenLM input contains no domain metadata
```

---

## 27. Quality Status

```text
KENLM QUALITY STATUS: PARTIAL / KNOWN RISKS
```

Targeted acceptance facts (20 cases; not a full quality freeze):

```text
Targeted test set: 20 cases
Correct sentence entered KenLM pool: 100%
KenLM Top1 accuracy: 65%
KENLM_MISRANK: 7
Final targeted repair accuracy: 95%
Final targeted misrepair: 0
DOMAIN_VOTE_DROP: 1
Full dialog_200 wav E2E: NOT EXECUTED
```

Integration PASS is not overall quality PASS.

---

## 28. Known Risks

1. WSL KenLM cold start previously hit timeout.
2. After warm-up, the scorer can run normally.
3. Cold-start reliability is not frozen.
4. Pinyin Recall Noise remains (example near-homophone path for time expressions).
5. Recall Noise must not be patched by changing Presence Vote.
6. Multi-tagged terms may create many tied buckets.
7. DOMAIN_BUCKET_RETENTION_RATIO = 0.75 stays frozen; optimality is not proven.
8. KenLM Top1 quality is not frozen.
9. dialog_200 full wav E2E was not executed in the documentation/integration freeze.

---

## 29. Acceptance Commands

```text
npm run accept:runtime-ssot
npm run accept:domain-multibucket-kenlm
```

---

## 30. Freeze Statement

```text
RUNTIME SSOT CONTRACT V1.2 — FROZEN
Runtime Domain Presence Vote — ACCEPTED AND FROZEN
Fine-Span Presence Vote — FROZEN
Multi-Bucket Assembly — FROZEN
Cross-Path Merge (mergeCrossPathSentenceCandidates, first-wins) — FROZEN
Sentence Candidates <=16 (global) — FROZEN
prefilledCombinations — REQUIRED
generatorMode — multi_path_lattice
voteScope / assemblyScope — per_path
LTR runtime field — DELETED (static module absence is the contract)
Shadow Beam — REMOVED
Domain Rerank — REMOVED
Legacy prefilled rebuild — REMOVED
KENLM INTEGRATION ACCEPTANCE — PASS
KENLM QUALITY STATUS — NOT FROZEN / OUT OF SCOPE
```
