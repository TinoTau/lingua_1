# Lingua Model3 V1 Mainline Insertion-Point Correction Audit

**Date:** 2026-08-26  
**Phase:** `MODEL3_V1_MAINLINE_INSERTION_POINT_CORRECTION_AUDIT`  
**Mode:** READ-ONLY — no runtime change · no Model3 wire · no retrain  
**Verdict:** `READY_WITH_GAPS`

---

## 1. Why this correction exists

Previous predevelopment audit recommended Model3 **before** `runDomainAwareAssembly`, which would treat **raw domain candidates** (`source == domain_term`) as Domain Anchors.

That violates frozen SSOT:

```text
Domain candidate ≠ Domain Anchor
DOMAIN Anchor = FineSpan supported by FINAL retained Domain Vote / SameDomain
```

Implementation convenience must not redefine business semantics. This is **SSOT conformance**, not a new Architecture Change Proposal.

**Previous insertion point:** `SUPERSEDED` — reason `DOMAIN_ANCHOR_PRE_VOTE_SEMANTICS_INCORRECT`.  
Other previous findings (loader pattern, KEEP/RETRY policy, budgets, no shadow, dialog_200) remain authoritative.

---

## 2. Authoritative order (corrected)

```text
FineSpan / first Recall
  → Compatibility
  → Model2 expand
  → Domain Vote (voteUtteranceDomainFromPool) — ONE vote
  → retainedDomains / SameDomain context
  → materializeModel3Anchors
  → Model3 KEEP / RETRY
  → bounded local re-recall (RETRY only; domainIds from vote)
  → Domain-aware Assembly (filter / budget / assemble) using SAME vote
  → buildSentenceCandidates → CrossPath ≤16 → KenLM → Apply
```

---

## 3. Internal stages of `runDomainAwareAssembly`

File: `assemble-domain-aware-span-sets.ts` · `runDomainAwareAssembly` (L328–395)

| Stage | Function | Role | Mutation |
|-------|----------|------|----------|
| A. Pool | `buildFineSpanCandidatePool` | PathFineSpan → FineSpanCandidatePool[] | none (build) |
| B. **Domain Vote** | `voteUtteranceDomainFromPool` | → `UtteranceDomainVoteResult` | **VOTE COMPLETE** |
| C. Bucket list | `retainedDomains` or `[null]` | SameDomain bucket keys | none |
| D. Filter | `filterDomainCandidatesPerSpan` | sameDomain / base / fallback per bucket | none |
| E. Budget | `budgetPerSpanCandidates` | per-span cap 8/6/4 + canonical | none |
| F. Assembly prep | `assembleDomainAwareSpanSets` | → SpanReplacementPick[][] | none |

**Vote completion point:** immediately after L343 `const vote = voteUtteranceDomainFromPool(pool)`.  
At this point: `retainedDomains`, `domainScores`, `utteranceDomain`, `insufficientEvidence` exist.  
**Assembly not committed:** filter/budget/assemble and `buildSentenceCandidates` have not run.

**Existing result type:** `UtteranceDomainVoteResult` — **reuse; no new DomainVoteResult SSOT**.  
Optional thin internal carrier `{ pool, vote }` only if needed for orchestrator plumbing — not a second domain authority.

**One vote rule:** Assembly finalize must accept the frozen `vote` object. Re-calling `runDomainAwareAssembly` after retry would re-vote → **FORBIDDEN**. Report as `DOMAIN_REEVALUATION_GAP` if anyone proposes re-vote; default = **NO second vote**.

---

## 4. Preferred boundary: OPTION A (+ thin finalize)

| Option | Verdict |
|--------|---------|
| **A. Extract vote + pass vote into assembly** | **PREFERRED** |
| B. Callback/hook inside monolith | More indirection; harder rollback |
| C. prepare/finalize rename | Same as A under different names — acceptable alias |

**Preferred shape:**

```text
buildFineSpanCandidatePool(...)           // exists
voteUtteranceDomainFromPool(pool)         // exists — VOTE SSOT
materializeModel3Anchors(pathFineSpans, vote, activeCandidates)
Model3 inference
retry router (domainIds = vote.retainedDomains)
completeDomainAwareAssemblyFromVote(pool, vote, ...)  // NEW thin extract of L345–394
```

**Why simplest:**

- Reuses `voteUtteranceDomainFromPool` / `UtteranceDomainVoteResult` (already unit-tested)
- One new helper: post-vote loop only (filter→budget→assemble)
- No DomainVoteServiceV2 / middleware / second orchestrator
- Rollback deletes extract + Model3 block; restore monolith `runDomainAwareAssembly` body
- Clear ownership: all still `span-assembly-v4`

`runDomainAwareAssembly` can remain as a thin wrapper calling vote + complete for non-Model3 callers / tests.

---

## 5. Correct Domain Anchor materialization

**ONE adapter:** `materializeModel3Anchors(...)` (read-only)

| Source | Rule |
|--------|------|
| DOMAIN | Span has non-covered candidate with `domain_term`/`passive_domain_weak` whose domain ∈ `vote.retainedDomains` (and not insufficientEvidence / empty retained) |
| MODEL2 | Accepted Model2 materialization bound to FineSpan (`retrievalProvenance` PROFILE_*) |
| DOMAIN_AND_MODEL2 | Both on same `PathFineSpan.spanId` |
| Reject | `source==domain_term` alone when domain **lost** vote → **NOT** Anchor |

Multiple retained domains: do **not** force a single winner for Model3; evidence in **any** retained SameDomain bucket qualifies.

Adapter must **not** vote, run Model2, run Recall, or mutate candidates.

---

## 6. Corrected insertion point

| Field | Value |
|-------|-------|
| **File** | `assemble-domain-aware-span-sets.ts` (+ call site in `span-assembly-v4-orchestrator.ts`) |
| **Function / phase** | After `voteUtteranceDomainFromPool`; before `filterDomainCandidatesPerSpan` / `completeDomainAwareAssemblyFromVote` |
| **Before** | Domain-aware filter / budget / assemble / `buildSentenceCandidates` |
| **After** | `buildFineSpanCandidatePool` + `voteUtteranceDomainFromPool` (Domain Vote complete) |
| Domain Vote Complete | **YES** |
| Assembly Committed | **NO** |

Orchestrator call site (conceptual):

```text
activeCandidates = Model2 expand
pool = buildFineSpanCandidatePool(...)
vote = voteUtteranceDomainFromPool(pool)   // ONE vote
anchors = materializeModel3Anchors(...)
decisions = Model3(pathFineSpans, anchors)
activeCandidates = maybeRetryMerge(...)     // same vote.retainedDomains
assemblyResult = completeDomainAwareAssemblyFromVote(pool, vote, ...)
```

---

## 7. Retry domain context

| Item | Finding |
|------|---------|
| retainedDomains available post-vote | YES |
| `recallSpanTopKV2` accepts `domainIds` | YES |
| Model3 chooses domain | NO — router uses `vote.retainedDomains` |
| Second Domain Vote | **NO** (preferred) |
| Re-vote if assembly API requires | Report `DOMAIN_REEVALUATION_GAP`; do not silently add |

---

## 8. Retry merge / budget / protection

- Per-span retry max **1**; deterministic spanId order; no recursive Model3  
- Merge: existing + retry → dedupe → existing rules → trim to **8/6/4**  
- Global pool **≤16**; no Model3 multiplier; no retry priority engine  
- Layer-1: Model3 targets exclude Anchors  
- Layer-2: retry router rejects Anchor spanIds  
- No overlap into Anchor bounds; Anchor-establishing candidates immutable  

---

## 9. Tests (future — define only)

| Case | Expected |
|------|----------|
| Pre-vote domain candidate loses vote | NOT Domain Anchor |
| Candidate in retained domain | DOMAIN Anchor eligible |
| Model2-only accepted hit | MODEL2 Anchor |
| Same span Domain+Model2 | DOMAIN_AND_MODEL2 |
| Anchor span | never RETRY |
| RETRY | one recall max |
| Retry merge | per-span + global caps |
| KEEP-only | candidate set unchanged |
| **Hard regression:** multi domain pre-vote → one retained | only surviving-domain evidence anchors |

---

## 10. Acceptance additions

Primary remains `FINAL_TEXT_IMPROVEMENT`.  
Add: `domain_anchor_count`, `model2_anchor_count`, `dual_source_anchor_count`, `rejected_prevote_domain_anchor_count`, `anchor_mutation_violations`.

---

## 11. Rollback surface (updated)

Integration ID: `MODEL3_V1_MAINLINE_INTEGRATION`

Expected modifies:

- `assemble-domain-aware-span-sets.ts` — extract `completeDomainAwareAssemblyFromVote` (or equivalent)
- `span-assembly-v4-orchestrator.ts` — vote → Model3 → retry → completeFromVote

Expected adds: model3-runtime/*, model3_inference_host.py, model3-path-diagnostics.ts

Boundary refactor **included** in rollback — no half-integrated vote/assembly split left behind.

---

## STOP

No runtime modification. Awaiting user review before `MODEL3_V1_MAINLINE_INTEGRATION_DEVELOPMENT`.
