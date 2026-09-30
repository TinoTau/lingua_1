# Lingua — Domain Vote Utterance Singleton Architecture Audit

Date: 2026-09-01  
Phase: `LINGUA_DOMAIN_VOTE_UTTERANCE_SINGLETON_ARCHITECTURE_AUDIT`  
Mode: READ-ONLY architecture / call-graph / runtime-semantics

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`DOMAIN_VOTE_AUDIT_FOUND_PATH_LOCAL_VOTE_DIVERGENCE`** |
| Actual vote semantics | **PATH_LOCAL independent business vote** (not utterance singleton) |
| Votes per utterance | **1 × retainedPathCount** (mean **2.115**, max **8**, total **423 / 200**) |
| Path-local input | **YES** — each path votes on its FineSpans + Model2-expanded candidates |
| Domain output divergence | **Proven 36 / 107** multipath utterances |
| Anchor divergence | **33 / 107** (layout + Domain Vote mixed; not vote-only) |
| Assembly divergence | **107 / 107** multipath assemble under path-local SameDomain then merge |
| Architecture vs Lattice freeze | **MATCHES** `voteScope: per_path` |
| Architecture vs this audit’s assumed utterance singleton | **CONFLICT** |
| Approved change | **YES** — Lattice V1.0.0 (2026-07-26) utterance-once → per-path |
| Acceptance causal validity | **VALID** (baseline/S3 share `prepared.vote` per path) |
| Signal-loss audit | **POTENTIALLY_CONTEXT_CONTAMINATED** |
| **Next phase** | **`DOMAIN_VOTE_UTTERANCE_SINGLETON_RESTORATION_DESIGN_AUDIT`** |

Classification: **`PATH_LOCAL_VOTES_WITH_POSSIBLE_DIVERGENCE`**.

No production code modified.

Previous local-resegmentation work remains paused. Prior counts (84 / 6 / 65 / OLD_BOUNDARY_LOCK) are not re-derived here.

================================
FROZEN ARCHITECTURE
===================

**This audit’s assumed freeze (utterance singleton):** one Domain Vote over utterance FineSpan evidence; paths reuse that retained-domain set.

**CURRENT FineSpan / Assembly freeze (still authoritative in repo):**

- `docs/fw-detector/freeze/FROZEN.md`: Vote scope = **`per_path`**
- `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`: **Forbidden: utterance-wide single Vote over mixed Paths**
- `docs/fw-detector/assembly/FROZEN_V1_2.md`: `voteUtteranceDomainFromPool` pool = **this Path only**

**Model3 docs (2026-08-26/27):** “ONE vote” / “ONCE, frozen” — in code this means **once per path step, no Retry re-vote**, not one vote per utterance.

Do **not** rewrite Lattice SSOT to match this audit’s assumed singleton. Do **not** treat Lattice per-path as unapproved drift.

================================
CANONICAL CALL GRAPH
====================

```text
utterance
  runFwDetectorOrchestrator
    runFwDetectorV4Path
      runSpanAssemblyV4Orchestrator
        runLatticeFineSpanGeneration          // utterance lattice; Recall uses recallDomainScope
        for each retained pathFineSpanView:   // PATH LOOP
          tone rebind
          compatibility
          expandActiveCandidatesWithModel2    // path-local, BEFORE vote
          runModel3PathStep  [or CausalFork]
            prepareModel3PathUpstream         // once per path
              buildFineSpanCandidatePool(pathFineSpans, path candidates)
              voteUtteranceDomainFromPool(pool)   // INDEPENDENT vote
              materializeModel3Anchors(vote)
              pack + Model3 infer
            completeModel3PathFromUpstream    // once (prod) or twice (causal: KEEP then S3)
              routeModel3Retry(vote.retainedDomains)  // no re-vote
              completeDomainAwareAssemblyFromVote(SAME vote)
          buildSentenceCandidates             // path × SameDomain buckets
        mergeCrossPathSentenceCandidates      // exact text, first-wins, ≤16
      runFwSentenceRerankFromPrefilled
  JobResult.text_asr
```

================================
LOOP BOUNDARY
=============

Authoritative loop: `span-assembly-v4-orchestrator.ts`  
`for (const view of lattice.pathFineSpanViews)`

`prepareModel3PathUpstream` is **inside** that loop.  
`voteUtteranceDomainFromPool` is **inside** prepare.  

FUNCTION_CALL_COUNT = retainedPathCount  
INDEPENDENT_BUSINESS_VOTE_COUNT = retainedPathCount  

Not `REDUNDANT_RECOMPUTE_OF_IDENTICAL_UTTERANCE_VOTE`: pools are path-filtered, not a shared utterance object returned N times.

================================
VOTE INPUT OWNERSHIP
====================

| Question | Answer |
|----------|--------|
| Collection function | `buildFineSpanCandidatePool(activeCandidates, coarseSpans, pathFineSpans)` |
| Pool grouping | **PathFineSpan[] of this path only** |
| Candidates | Path-local after Model2 expansion |
| Shared global pool | **NO** |
| Base terms vote? | **NO** (`source` must be `domain_term` or `passive_domain_weak`) |
| Multi-candidate same span | Union into FineSpanDomainSet; one presence per domain per span |
| Domain tags | Candidate `domains[]` from Lexicon/Recall (`term_domain_tags`) |
| Coarse/session prior | `domainPriors` **not** in vote kernel; copied into Assembly complete only |
| First-pass Recall domains | `recallDomainScope` (utterance CFG) — **before** Vote |

================================
VOTE OUTPUT OWNERSHIP
=====================

Authoritative object: `UtteranceDomainVoteResult` stored on **each path’s** `assemblyResult.vote` / `prepared.vote`.

Utterance summary metrics use **primary = pathAssemblyResults[0]** (`retainedDomains`, `utteranceDomain`). That is a **display/aggregate convenience**, not a shared singleton.

Retry / Model3 / Assembly on a path consume **that path’s** vote object.

================================
MULTIPATH RUNTIME METRICS
=========================

Source: `model3_v2_s3_mainline_s3_raw_cases.jsonl` (dialog_200, production helpers). Per-path `domain_vote` arrays were flattened in that artifact; divergence uses conservative concat proofs.

| Metric | Count | Denominator |
|--------|------:|-------------|
| Audited utterances | 200 | 200 |
| Multipath | 107 | 200 |
| One-path | 93 | 200 |
| Retained paths | 423 | 200 |
| Domain Vote function calls | 423 | 423 |
| Mean votes / utterance | 2.115 | — |
| Max votes / utterance | 8 | — |
| Utterances with >1 vote call | 107 | 200 |
| Distinct vote **inputs** (structural) | 107 | 107 mp |
| **Proven** distinct retained-domain **outputs** | **36** | 107 |
| Identical/empty output (incl. heuristic) | 61 | 107 |
| Even-concat grouping unreliable | 10 | 107 |
| `second_vote` ≠ 0 | 0 | 200 |

Proven output divergence = flattened `retained_domains` length **not** equal to `k × pathCount` for identical chunks, or fewer labels than paths (some paths empty retained set, others not). Example: d015 two paths, `["meeting"]`; d019 four paths, `["tech_ai","tech_ai"]`.

================================
SAME DOMAIN
===========

SameDomain buckets are **path-local**: `completeDomainAwareAssemblyFromVote` builds buckets from **that path’s** `vote.retainedDomains`.

Multipath utterances therefore produce `sameDomain(pathA)`, `sameDomain(pathB)`, … then merge sentences.

================================
ANCHOR CONSEQUENCES
===================

`materializeModel3Anchors` uses path-local vote + path-local FineSpans.

| Observation | Count |
|-------------|------:|
| Multipath any-anchor set differs across path hashes | 33 / 107 |
| DOMAIN / DOMAIN_AND_MODEL2 set differs | 33 / 107 |

Cannot attribute all 33 to Vote alone (HARD STOP D: path-local FineSpan layout also changes anchors). Vote **can** change DOMAIN anchors when retained sets differ.

Model2 anchors are separate (`PROFILE_*` provenance) and must not be counted as Vote drift.

================================
MODEL3 / RETRY CONSEQUENCES
===========================

| Stage | Domain context |
|-------|----------------|
| Model3 pack/infer | Path-local Anchors (Vote-dependent DOMAIN marks) |
| Retry | `prepared.vote.retainedDomains` — **path-local** |
| Retry re-vote | **NO** (`secondDomainVote: false` hardcoded) |
| Regional lattice Recall | `domainIds: vote.retainedDomains` — **path-local** |

Causal fork: **one** `prepareModel3PathUpstream` → baseline complete + S3 complete **reuse the same vote object**. No extra Domain Vote vs production (production also votes once per path).

================================
ASSEMBLY / CROSS-PATH MERGE
===========================

Each path: `buildSentenceCandidates` under that path’s SameDomain buckets.

Then `mergeCrossPathSentenceCandidates`: exact-text first-wins, **no domain provenance**, global cap ≤16.

**Yes:** one utterance KenLM pool can contain sentences built under **different** Domain Vote contexts. Merge **erases** which vote produced which sentence.

Final-output quality impact of that mix: **UNKNOWN** (no case-level proof that KenLM winner flipped solely due to vote divergence). Architecture issue still exists (HARD STOP F).

================================
SECOND DOMAIN VOTE TRACE SEMANTICS
==================================

`retry_regions.secondDomainVote` is **always `false`** in router.

`vote_call_count` is **hardcoded `1`** per `completeModel3PathFromUpstream`.

`second_vote` in acceptance summaries increments if `vote_call_count !== 1` **or** region `secondDomainVote`.

**Proves:** `NO_RETRY_SECOND_VOTE` only.  
**Does not prove:** `UTTERANCE_SINGLETON_VOTE`.

================================
ACCEPTANCE HARNESS
==================

| Check | Result |
|-------|--------|
| Extra Domain Vote vs production | **NO** |
| Baseline vs S3 vote | **SHARED** `prepared.vote` |
| `HARNESS_SEMANTIC_DIVERGENCE` | **NO** |
| Frozen Final Causal Acceptance | **causally valid** for baseline vs S3 |
| Business architecture validity | Path-local (unchanged by harness) |

================================
SIGNAL-LOSS AUDIT IMPACT
========================

Regional resegmentation calls lattice with **path-local** `retainedDomains`. Different path votes can change regional Recall → lattice success (`resegmentOk`).

Classification: **`POTENTIALLY_CONTEXT_CONTAMINATED`**.  
Not **MATERIALLY_CONTAMINATED** (no proof the 84 lattice failures were caused by vote divergence). Do not invalidate 84 / 6 / 65 without that proof.

================================
SSOT / HISTORY
==============

| Layer | Vote scope |
|-------|------------|
| Pre-Lattice (historical) | Utterance-once |
| Lattice V1.0.0 freeze (CURRENT) | **per_path**; forbids mixed-path utterance vote |
| Model3 insertion wording | “ONE vote” = no Retry re-vote |
| Orchestrator comment | “Path-local: Domain Vote (ONCE)” |
| This audit assumed freeze | Utterance singleton |

Git: `voteScope: 'per_path'` present in FW_V4 freeze baseline (`86034080`). `prepareModel3PathUpstream` is Model3 integration extracting the **already path-local** vote, not a new vote architecture.

================================
ARCHITECTURE DRIFT
==================

Vs **CURRENT Lattice freeze:** **NOT** implementation drift — code matches `per_path`.

Vs **this audit’s assumed utterance singleton / some Model3 “one vote per utterance” readings:** **semantic conflict**. Restoring utterance singleton against Lattice freeze requires **ACP** (Lattice forbids mixing path evidence into one vote). Keeping per-path does **not** require ACP.

Preferred classification remains **`PATH_LOCAL_VOTES_WITH_POSSIBLE_DIVERGENCE`**, not unapproved Lattice drift.

================================
GOVERNANCE
==========

| Item | Status |
|------|--------|
| Domain Vote changed | NO |
| FineSpan changed | NO |
| Model2 changed | NO |
| Model3 changed | NO |
| Retry changed | NO |
| Assembly changed | NO |
| KenLM changed | NO |
| JobResult changed | NO |
| production code modified | NO |

JobResult does not carry per-path vote arrays. Observation traces under `MODEL2_DIALOG200_TRACE` are not JobResult schema.

================================
REQUIRED DECISIONS (D1–D40)
===========================

| ID | Answer |
|----|--------|
| D1 | Production: `prepareModel3PathUpstream`. Legacy/tests: `runDomainAwareAssembly`. Kernel: `utterance-domain-vote.ts`. |
| D2 | **YES** — inside `for (view of pathFineSpanViews)` |
| D3 | **1** call (one path) |
| D4 | **N = retainedPathCount** |
| D5 | **YES** — 423 calls / 423 paths |
| D6 | **Recompute** on path-specific pools (not reuse of one object) |
| D7 | **NO** identical utterance pool |
| D8 | **YES** path-specific FineSpans + Model2 candidates |
| D9 | Structural: **N distinct inputs** on multipath (exact candidate fingerprints not in preserved jsonl) |
| D10 | Proven **>1 output** on **36 / 107**; others empty/identical heuristic or ungroupable |
| D11 | **YES** on 36 proven; others unknown/identical |
| D12 | **YES** path-local buckets by construction; merge later |
| D13 | Domain-anchor sets differ **33 / 107**; not all Vote-caused |
| D14 | **YES** path-local retained-domain / Anchor context |
| D15 | **YES** path-local `vote.retainedDomains` |
| D16 | **YES** |
| D17 | **YES** — text dedup, provenance erased |
| D18 | **YES** Model2 before Vote |
| D19 | **YES** |
| D20 | **YES** base excluded |
| D21 | **YES** Lexicon domains on candidates |
| D22 | Priors **shared** utterance copy; **not** vote scoring |
| D23 | **NO** Retry Domain Vote |
| D24 | `secondDomainVote=0` = no Retry re-vote |
| D25 | **NO** — does not prove utterance singleton |
| D26 | **NO** extra harness vote |
| D27 | **YES** baseline/S3 share prepared vote |
| D28 | **YES** causal acceptance still valid |
| D29 | **POTENTIALLY_CONTEXT_CONTAMINATED** |
| D30 | **NO** |
| D31 | **PATH_LOCAL_VOTES_WITH_POSSIBLE_DIVERGENCE** |
| D32 | Matches Lattice freeze; conflicts with assumed utterance singleton |
| D33 | **YES** — Lattice V1.0.0 |
| D34 | **NO** vs Lattice; **YES** vs this audit’s assumed singleton wording |
| D35 | Restoring utterance singleton vs Lattice **would** need ACP |
| D36 | **Not yet** — next phase is restoration **design** (may conclude ACP) |
| D37 | **NO** |
| D38 | **NO** |
| D39 | `DOMAIN_VOTE_AUDIT_FOUND_PATH_LOCAL_VOTE_DIVERGENCE` |
| D40 | `DOMAIN_VOTE_UTTERANCE_SINGLETON_RESTORATION_DESIGN_AUDIT` |

================================
NEXT PHASE
==========

**Exactly one:** `DOMAIN_VOTE_UTTERANCE_SINGLETON_RESTORATION_DESIGN_AUDIT`

Design how (if at all) an utterance-level vote can exist **without** mixing SegmentationPaths in a way Lattice freeze forbids. Do not implement. Do not resume Local Resegmentation until that design is reviewed.

Do not execute automatically.
