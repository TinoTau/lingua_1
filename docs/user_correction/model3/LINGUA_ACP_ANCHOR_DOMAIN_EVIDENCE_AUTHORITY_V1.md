# LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1

**Phase:** `LINGUA_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_ACP_IMPACT_AUDIT`  
**Date:** 2026-09-14  
**Mode:** READ-ONLY · ACP · IMPACT-FIRST · **NO PRODUCT CODE CHANGE**

---

## ACP header

| Field | Value |
|-------|--------|
| **ACP ID** | `LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1` |
| **TITLE** | Separate Domain Evidence from Model3 Retry-Suppression Authority |
| **STATUS** | `APPROVED` · `IMPLEMENTED` (2026-09-14) |
| **PRODUCT_CODE_CHANGE_THIS_ROUND** | Implementation delta (Anchor adapter only) |

---

## 0. Proposed principle

```
DOMAIN EVIDENCE  =  candidate / domain-hypothesis evidence
DOMAIN EVIDENCE ≠  Model3 RETRY-suppression evidence (by itself)
```

| Authority | Proposed |
|-----------|----------|
| DOMAIN_TERM automatic Anchor | **REMOVE** |
| PASSIVE_DOMAIN_WEAK automatic Anchor | **REMOVE** |
| SAMEDOMAIN automatic Anchor | **REMOVE** |
| RETAINED_DOMAIN automatic Anchor | **NONE** (remain support/gate for Vote/Assembly only) |
| PROFILE_DOMAIN automatic Model2 Anchor | **REMOVE** |
| PROFILE_RETRIEVAL automatic Model2 Anchor | **NONE** (restore frozen SSOT) |
| PROFILE_PRONUNCIATION automatic Model2 Anchor | **KEEP FROZEN** |

---

## 1. Problem / evidence (responsibility mismatch)

Not derived from a single Pilot case. Verified pattern (example `p2_u004_019` 德鸾):

- ASR PathFineSpan surface **is not** a domain term.
- Model2 D soft hits (e.g. 预订) are legitimate `domain_term` + `PROFILE_DOMAIN` + `tourism_route`.
- They satisfy frozen SameDomain membership and Domain Vote retention.
- Old SSOT therefore fires **Domain Anchor** and independently **PROFILE_DOMAIN Model2 Anchor** → `DOMAIN_AND_MODEL2` → Model3 RETRY suppressed.

Mismatch:

```
candidate-domain plausibility  ≠  ASR-span retry-suppression authority
```

「预订 belongs to tourism_route」is valid Domain/Assembly evidence. It must **not** alone protect「德鸾」from Model3.

---

## 2. New responsibility boundary (proposed)

| Module | Owns |
|--------|------|
| Domain Vote | Which domain hypotheses are supported |
| SameDomain | Which candidates belong to each retained bucket |
| Model2 D / PROFILE_DOMAIN | User/domain-conditioned **candidate expansion** |
| Assembly / KenLM | Domain-aware combination / sentence ranking |
| Model3 | KEEP/RETRY on **non-protected** ASR PathFineSpan surface |
| Anchor | Only **explicitly authorized** repair-suppression evidence |

**Unchanged:** Model2 D generation, PROFILE_DOMAIN provenance/materialize, domain_term / passive semantics, Vote, retainedDomains, SameDomain, DomainFilteredSpanSet, FineSpan/Edge/segmentation, Model3 input/model/training/KEEP-RETRY meaning, Retry mechanics (no Model2-on-Retry), Assembly, KenLM, Tone, Lexicon, JobResult (expected).

**Out of scope:** PROFILE_PRONUNCIATION redesign; 刘/藏/升层 P sufficiency; Contract A / surface==domain; Anchor scores; Model3 candidate awareness.

---

## 3. Proposed short Anchor SSOT (~30 lines)

```text
1. Anchor = upstream retry-suppression protection for PathFineSpans
   (trusted enough to condition one bounded repair attempt —
    not final correctness).

2. Domain evidence (domain_term, passive_domain_weak, retainedDomains,
   SameDomain membership) does NOT independently create Anchor.

3. SameDomain remains Domain/Assembly organization only —
   not Model3 RETRY suppression.

4. PROFILE_DOMAIN does NOT independently create Anchor.
   It remains Model2 D candidate-expansion provenance.

5. PROFILE_RETRIEVAL alone does NOT create Anchor.

6. PROFILE_PRONUNCIATION remains AUTOMATIC Model2 Anchor when
   materialized + retained on the active path + origin binding present.

7. Domain / PROFILE_DOMAIN candidates remain fully available to
   Domain Vote, SameDomain, Assembly, and KenLM.

8. Model3 consumes ASR PathFineSpan surface + isAnchor + frozen
   allowlist only — not Domain/Model2 internals.

9. RETRY = one bounded local resegmentation + re-recall request;
   not candidate rejection; not Domain Vote redo.

10. MODEL2_ON_MODEL3_RETRY = NO.

11. Anchor source taxonomy simplifies to MODEL2 (pronunciation)
    when Anchor fires; DOMAIN / DOMAIN_AND_MODEL2 reasons obsolete.
```

---

## 4. Authority matrix consistency

| Class | Current | Proposed | Contradiction? |
|-------|---------|----------|----------------|
| BASE_EXACT | NONE | NONE | no |
| BASE_FUZZY | NONE | NONE | no |
| DOMAIN_TERM | CONDITIONAL Domain Anchor | **NONE** | no (intentional ACP) |
| PASSIVE_DOMAIN_WEAK | CONDITIONAL Domain Anchor | **NONE** | no |
| RETAINED_DOMAIN | SUPPORT/GATE | SUPPORT only | no |
| SAMEDOMAIN | Domain Anchor evidence | Domain/Assembly only | no |
| PROFILE_DOMAIN | AUTOMATIC Model2 Anchor | **NONE** | no |
| PROFILE_RETRIEVAL | frozen NONE; code YES | **NONE** | restores SSOT |
| PROFILE_PRONUNCIATION | AUTOMATIC | **KEEP AUTOMATIC** | no |
| DUAL DOMAIN_AND_MODEL2 | Domain∧Model2 labels | obsolete → **MODEL2 only if P** | no |

**Matrix internally consistent.** Soft PROFILE_DOMAIN+domain_term no longer Anchors. P + domain evidence → Anchor **only** via P; source = MODEL2.

---

## 5. Survival proofs

### PROFILE_DOMAIN candidate pipeline without Anchor

`expand-windows-with-model2` → `materializeDomainHits` stamps `PROFILE_DOMAIN` / `domain_term` **before** LexicalEdge; Compatibility / Vote / Assembly consume candidates **independently** of `materializeModel3Anchors`.

```
PROFILE_DOMAIN_CANDIDATE_PIPELINE_SURVIVES_WITHOUT_ANCHOR = YES
```

### Domain buckets without Domain Anchor

Vote + `filterDomainCandidatesPerSpan` run for Assembly after Model3; they do not read Anchor marks.

```
DOMAIN_VOTE_SURVIVES_WITHOUT_DOMAIN_ANCHOR = YES
SAMEDOMAIN_SURVIVES_WITHOUT_DOMAIN_ANCHOR = YES
PATH_LEVEL_DOMAIN_BUCKETS_SURVIVE = YES
```

### Model3

ACP only flips `isAnchor` / Anchor marks for previously Domain/PROFILE_DOMAIN-only spans. No new features, no candidate/Domain/Model2 tensors.

```
MODEL3_INPUT_CHANGE_REQUIRED = NO
MODEL3_MODEL_CHANGE_REQUIRED = NO
MODEL3_TRAINING_CHANGE_REQUIRED = NO
MODEL3_KEEP_RETRY_CHANGE_REQUIRED = NO
```

### Retry

Existing path: RETRY → `deriveRetryRegions` → reseg + Stage-2 recall → merge → Assembly. `MODEL2_ON_MODEL3_RETRY = NO` unchanged.

`mergeSpanCandidates`: **existing keys kept**, retry hits added, then per-span cap. Comment “replace region candidates” is merge+budget, not wipe.

```
EXISTING_RETRY_PATH_CAN_HANDLE_NEWLY_UNANCHORED_DOMAIN_SPANS = YES
RETRY_DESTROYS_EXISTING_DOMAIN_CANDIDATES = NO
  (caveat: over-cap may drop lowest-score after merge — existing budget semantics)
```

### Pipeline order

After ACP, Anchor needs only PROFILE_PRONUNCIATION on `activeCandidates` — **not** SameDomain.

```
PIPELINE_REORDER_REQUIRED_AFTER_ACP = NO
```

Vote → Anchor(P-only) → Model3 → SameDomain/Assembly remains valid; ACP **removes** the reason Anchor needed SameDomain-before-Model3.

### SameDomain≈Anchor drift

```
SAMEDOMAIN_ANCHOR_APPROXIMATION_DRIFT_AFTER_ACP = OBSOLETE
```

(Still relevant only as historical note; Domain/Assembly SameDomain logic unchanged.)

### PROFILE_RETRIEVAL

```
PROFILE_RETRIEVAL_FIX = SAME_LOCAL_DELTA
```

Exclude from `isModel2Provenance` in the same adapter delta (restore-to-SSOT, not new architecture).

---

## 6. Contract impact inventory

| DOCUMENT | CURRENT FROZEN RULE | PROPOSED | CHANGE_REQUIRED | IMPACT | SUPERSEDE_OR_EDIT |
|----------|---------------------|----------|-----------------|--------|-------------------|
| `model3_anchor_contract_v1.md` | Domain Anchor 4-rules; Model2 = P∨PROFILE_DOMAIN | Domain section **remove/none**; Model2 = **P only** | **YES** | Core ACP | EDIT after approval |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` | Points to Anchor companion | Note Domain≠Anchor authority | YES | Doc | EDIT |
| `MODEL3_SYNTHETIC_V1_FROZEN.md` | DOMAIN\|MODEL2\|BOTH; Vote/SameDomain→Anchors narrative | Anchors = MODEL2(P); Domain not Anchor source | YES | Doc | EDIT |
| model3 input/output/retry | isAnchor mask; Anchor RETRY forbidden | Unchanged semantics | NO | — | NO |
| Domain Vote / SameDomain docs | Vote/bucket for Assembly | Unchanged | NO | — | NO |
| Model2 D / PROFILE_DOMAIN contracts | Expansion/materialize | Unchanged; Anchor consume only | NO | — | NO |
| documentation_authority_matrix | Index | Point to ACP after freeze | YES | Index | EDIT after accept |
| Sufficiency predev audits | AUDIT_ONLY recommendations | Superseded as authority by ACP if approved | NO edit | Evidence | SUPERSEDE_AS_AUTHORITY |
| Protection authority audit | PROFILE_DOMAIN AUTOMATIC | Superseded if ACP approved | — | Evidence | SUPERSEDE_AS_AUTHORITY |

```
JOBRESULT_CHANGE_REQUIRED = NO
BROAD_DATA_CONTRACT_CHANGE_REQUIRED = NO
```

`Model3AnchorSource`: prefer simplify to `MODEL2` only (or keep enum with DOMAIN unused — prefer deletion/simplification). Diagnostics `rejected_prevote_domain_anchor_count` becomes **obsolete** for Domain-Anchor semantics (DELETE or zero/deprecate in same delta if inseparable).

---

## 7. Anchor source inventory (current → proposed)

| source class | producer | predicate (current) | current auth | proposed | code | contract |
|--------------|----------|---------------------|--------------|----------|------|----------|
| BASE_EXACT | base recall | — | NONE | NONE | — | forbidden alone |
| BASE_FUZZY | tagBase | — | NONE | NONE | — | not Model2 Anchor |
| DOMAIN_TERM | recall / soft D | hasRetainedDomainEvidence | CONDITIONAL | **NONE** | adapter | Domain Anchor § |
| PASSIVE_DOMAIN_WEAK | presence | same | CONDITIONAL | **NONE** | adapter | Domain Anchor § |
| RETAINED_DOMAIN | Vote | gate in domainOk | SUPPORT | SUPPORT | vote | Domain Anchor § |
| SAMEDOMAIN | filterDomain… | not literal at adapter | Domain evidence | **Assembly only** | assemble-… | Domain Anchor §1 |
| PROFILE_DOMAIN | materializeDomainHits | hasModel2Evidence | AUTOMATIC | **NONE** | adapter | Model2 Anchor § |
| PROFILE_RETRIEVAL | merge/tag | hasModel2Evidence (drift) | code YES | **NONE** | adapter | Model2 Anchor exclude |
| PROFILE_PRONUNCIATION | materializeProfileHits | hasModel2Evidence | AUTOMATIC | **KEEP** | adapter | Model2 Anchor § |
| DOMAIN_AND_MODEL2 | dual | domainOk∧model2Ok | DUAL | obsolete → MODEL2 iff P | adapter | Dual source § |

---

## 8. Adapter impact (no implement)

| Symbol | After ACP |
|--------|-----------|
| `hasRetainedDomainEvidence` | **DELETE** / obsolete |
| `countRejectedPreVoteDomainAnchors` | **DELETE** or deprecate diagnostics |
| `isDomainEvidenceSource` (Anchor use) | **DELETE** from Anchor path |
| `hasModel2Evidence` / `isModel2Provenance` | **SIMPLIFY** → PROFILE_PRONUNCIATION only |
| `materializeModel3Anchors` | **SIMPLIFY** → P-only → source MODEL2 |
| `candidateBoundToSpan` | **KEEP** |
| `Model3AnchorSource` DOMAIN / DUAL | **DELETE** or unused |

Can Anchor Adapter become simpler? **YES.**

---

## 9. Blast radius (code)

### MUST CHANGE

| FILE | SYMBOL | TYPE |
|------|--------|------|
| `model3-anchor-adapter.ts` | domainOk path; isModel2Provenance | DELETE/SIMPLIFY/RESTORE |
| `model3-types.ts` | Model3AnchorSource (optional simplify) | SIMPLIFY |
| `model3-mainline.integration.test.ts` | Domain Anchor / PROFILE_RETRIEVAL→MODEL2 tests | TEST_ONLY |
| `model3-path-diagnostics.ts` | domain_anchor counts | SIMPLIFY/DELETE |
| `model3_anchor_contract_v1.md` (+ arch/freeze pointers) | Domain/Model2 Anchor §§ | DOC_ONLY (after approval) |

### MUST NOT CHANGE

Model2 expand/materialize D, Vote, SameDomain filter, Feature pack / BiGRU, Retry router merge semantics, Assembly, KenLM, JobResult builders, PROFILE_PRONUNCIATION materialize.

### POSSIBLY OBSOLETE

`rejected_prevote_domain_anchor_count` plumbing in orchestrator / acceptance scripts (diagnostics only).

---

## 10. Counterfactuals (sanity only)

| Case | Candidates survive Vote/SD/Asm/KenLM | Domain Anchor | PROFILE_DOMAIN Anchor | P Anchor | isAnchor | Model3 visible |
|------|--------------------------------------|---------------|----------------------|----------|----------|----------------|
| T1 德鸾 | YES | NO | NO | NO | **NO** | YES |
| T2 行程 | YES | NO | NO | only if P | usually **NO** | YES unless P |
| T3 刘→牛 | YES | n/a | n/a | **YES** | YES | Anchor mask |
| T4 升层→生成 | YES | NO contrib | NO contrib | **YES** | YES | Anchor mask |
| T5 PROFILE_RETRIEVAL-only | YES | NO | NO | NO | **NO** | YES |
| T6 non-retained domain | Vote unchanged | NO | NO | NO | NO | YES |

```
PROFILE_PRONUNCIATION_ANCHOR_SURVIVES_ACP = YES
```

行程 Domain-only → non-Anchor is **expected** under ACP (RETRY may fire; existing domain candidates still in merge pool).

---

## 11. Performance risk

More PathFineSpans non-Anchor → more Model3 actionable spans / possible RETRY / Stage-2 recall. Vote/Model2/Assembly unchanged.

```
PERFORMANCE_RISK = MEDIUM
```

Measure after correctness restore; no tuning this round.

---

## 12. Safety / failure mode

Legitimate domain-surface spans (行程) may receive Model3 RETRY. RETRY ≠ reject: merge retains prior candidates (budget permitting). No Domain Vote redo. Acceptable under proposed separation; do not reintroduce exact-surface Domain Anchor.

---

## 13. Single-delta feasibility

```
SINGLE_LOCAL_DELTA_FEASIBLE = YES
```

One narrow delta after approval:

> Remove Domain-derived and PROFILE_DOMAIN-derived automatic Anchor authority; keep PROFILE_PRONUNCIATION; restore PROFILE_RETRIEVAL exclusion; simplify Anchor source classification; update Anchor contract + adapter tests.

Do **not** touch upstream candidate/domain logic.

---

## 14. Test impact plan (targeted; no full Pilot this round)

- **T1–T6** as §10  
- Small regression: mainline Anchor adapter tests rewritten for P-only  
- After architecture acceptance: Pilot200 if needed  

---

## 15. Formal ACP body (acceptance)

**ROLLBACK:** unreleased → git revert only. No flag / dual chain / compat path.

**ACCEPTANCE (post-implementation, future round):**

1. Soft PROFILE_DOMAIN / Domain-only spans: `isAnchor=false`.  
2. PROFILE_PRONUNCIATION spans: still Anchor.  
3. PROFILE_RETRIEVAL-only: not Anchor.  
4. Domain Vote / SameDomain / PROFILE_DOMAIN candidates unchanged in pool.  
5. Model3 input allowlist unchanged.  
6. Retry merge retains pre-retry candidates (subject to existing cap).  
7. No Model2 on Retry.  

---

## 16. Required final verdict

```
BASELINE_IDENTITY = PASS
ACP_ID = LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1
ACP_STATUS = PROPOSED_USER_APPROVAL_REQUIRED
RESPONSIBILITY_MISMATCH_PROVEN = YES
DOMAIN_TERM_ANCHOR_AUTHORITY_PROPOSED = NONE
PASSIVE_DOMAIN_WEAK_ANCHOR_AUTHORITY_PROPOSED = NONE
SAMEDOMAIN_ANCHOR_AUTHORITY_PROPOSED = NONE
RETAINED_DOMAIN_ANCHOR_AUTHORITY_PROPOSED = NONE
PROFILE_DOMAIN_ANCHOR_AUTHORITY_PROPOSED = NONE
PROFILE_RETRIEVAL_ANCHOR_AUTHORITY_PROPOSED = NONE
PROFILE_PRONUNCIATION_ANCHOR_AUTHORITY_PROPOSED = AUTOMATIC_KEEP_FROZEN
PROFILE_DOMAIN_CANDIDATE_PIPELINE_SURVIVES_WITHOUT_ANCHOR = YES
DOMAIN_VOTE_SURVIVES_WITHOUT_DOMAIN_ANCHOR = YES
SAMEDOMAIN_SURVIVES_WITHOUT_DOMAIN_ANCHOR = YES
PATH_LEVEL_DOMAIN_BUCKETS_SURVIVE = YES
MODEL3_INPUT_CHANGE_REQUIRED = NO
MODEL3_MODEL_CHANGE_REQUIRED = NO
MODEL3_TRAINING_CHANGE_REQUIRED = NO
MODEL3_KEEP_RETRY_CHANGE_REQUIRED = NO
EXISTING_RETRY_PATH_CAN_HANDLE_NEWLY_UNANCHORED_DOMAIN_SPANS = YES
RETRY_DESTROYS_EXISTING_DOMAIN_CANDIDATES = NO
SAMEDOMAIN_ANCHOR_APPROXIMATION_DRIFT_AFTER_ACP = OBSOLETE
PROFILE_RETRIEVAL_FIX = SAME_LOCAL_DELTA
PIPELINE_REORDER_REQUIRED_AFTER_ACP = NO
JOBRESULT_CHANGE_REQUIRED = NO
BROAD_DATA_CONTRACT_CHANGE_REQUIRED = NO
SINGLE_LOCAL_DELTA_FEASIBLE = YES
PERFORMANCE_RISK = MEDIUM
PRODUCT_CODE_CHANGE_THIS_ROUND = NO
USER_APPROVAL_REQUIRED = YES
ONE_NEXT_OWNER = USER_ARCHITECTURE_APPROVAL
ONE_NEXT_DELTA = Approve/reject/further-limit LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1 before any product-code change.
```

---

## 17. STOP

No blockers requiring STOP under §30 (pipelines survive; Retry merge-safe; Model3 unchanged; matrix consistent).  

**DO NOT DEVELOP.** Await user approval.
