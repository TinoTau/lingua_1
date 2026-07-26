# Runtime SSOT Contract Freeze

| Field | Value |
|------|-----|
| Status | **FROZEN** |
| Freeze Version | **Runtime SSOT Contract V1.1** (Fine-Span Domain Presence Vote + Multi-Bucket + Cross-Bucket Dedup) |
| Freeze Date | **2026-07-20** |
| Acceptance | **ACCEPTED AND FROZEN** — [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md) |
| Owner | Runtime Domain |
| Index | [RUNTIME_DOMAIN_DOCUMENT_INDEX.md](./RUNTIME_DOMAIN_DOCUMENT_INDEX.md) |

---

## 0. Accepted Result Freeze Scope

```text
Runtime Domain Presence Vote:
ACCEPTED AND FROZEN
```

Authority citation: [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md).

### FROZEN

```text
Domain Fact propagation
FineSpanDomainSet
One Span One Vote
0.75 retainedDomains
Multi-Bucket Assembly
Base enters every bucket
Cross-bucket dedup
Candidate cap 16
KenLM merged-pool boundary
Context Prior diagnostics-only
prefilledCombinations: required
```

### NOT FROZEN

```text
Lexicon content quality
KenLM ranking quality
Recall noise quality
dialog_200 full E2E quality
```

Functional freeze ≠ quality freeze.

---

## 1. Status / Version / Freeze Date

This file is the sole authoritative Runtime Domain freeze contract for the formal main chain.

Do not create parallel copies named V2, Final, Latest, (2), or (3).

---

## 2. Sole Authority Statement

```text
SOLE RUNTIME AUTHORITY = this file
```

Supporting contracts (Lexicon fact, Registry/Recall scope, Recall behavior, Assembly detail, KenLM runtime, Context Prior) must cite this file for Vote, retainedDomains, Multi-Bucket Assembly, cross-bucket dedup, candidate cap, and KenLM integration boundaries.

Development and acceptance reports are execution records only. They must not override this contract.

---

## 3. Document Ownership and Conflict Priority

| Layer | Document | Role |
|------|----------|------|
| Runtime main chain | **This file** | Sole Runtime Authority |
| Lexicon domain facts | Lexicon_Domain_Contract_Freeze_V1.md | Supporting |
| Domain source / Registry / Recall scope | DOMAIN_SOURCE_UNIFICATION.md | Supporting |
| Recall behavior | DOMAIN_RECALL.md | Supporting |
| Assembly internal detail | FROZEN_V1_2.md | Supporting |
| KenLM runtime interface | KENLM_RUNTIME.md | Supporting |
| Context Prior | CONTEXT_PRIOR.md | diagnostics-only boundary |

Conflict priority:

```text
Current source code
> This Runtime SSOT Contract
> Supporting contracts
> Accepted audits
> Execution / acceptance reports
> Historical documents
```

---

## 4. Unique Runtime Main Chain

```text
term_domain_tags
        ?
Hotword.domains[]
        ?
WindowCandidate.domains[]
        ?
FineSpanDomainSet
        ?
domainScores
        ?
retainedDomains
        ?
Domain Buckets + Base
        ?
per-bucket bounded sentence generation
        ?
mergeCrossBucketSentenceCandidates
        ?
global Sentence Candidates <=16
        ?
prefilledCombinations
        ?
runFwSentenceRerankFromPrefilled
        ?
rerankFwSentences
```

Formal path modules:

```text
span-assembly-v4-orchestrator
-> mergeCrossBucketSentenceCandidates
-> kenlmSentenceCandidates
-> fw-detector-v4-path
-> prefilledCombinations
-> runFwSentenceRerankFromPrefilled
-> rerankFwSentences
```

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

## 17. Cross-Bucket Text Dedup

Order:

```text
per bucket buildSentenceCandidates(cap = MAX_SENTENCE_CANDIDATES)
-> mergeCrossBucketSentenceCandidates
-> keep higher candidateScore for identical text
-> global slice(0, MAX_SENTENCE_CANDIDATES)
```

---

## 18. Global Sentence Candidate Cap <=16

```text
maxSentenceCandidates = 16
Sentence Candidates <=16
```

This is the hard cap for the KenLM input pool.

---

## 19. KenLM Cross-Bucket Integration

KenLM ranks the already-merged cross-bucket candidate pool once.

Formal wiring uses prefilledCombinations from the orchestrator pool into runFwSentenceRerankFromPrefilled.

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
RUNTIME SSOT CONTRACT V1.1 — FROZEN
Runtime Domain Presence Vote — ACCEPTED AND FROZEN
Fine-Span Presence Vote — FROZEN
Multi-Bucket Assembly — FROZEN
Cross-Bucket Dedup — FROZEN
Sentence Candidates <=16 — FROZEN
prefilledCombinations — REQUIRED
Shadow Beam — REMOVED
Domain Rerank — REMOVED
Legacy prefilled rebuild — REMOVED
KENLM INTEGRATION ACCEPTANCE — PASS
KENLM QUALITY STATUS — NOT FROZEN / OUT OF SCOPE
```
