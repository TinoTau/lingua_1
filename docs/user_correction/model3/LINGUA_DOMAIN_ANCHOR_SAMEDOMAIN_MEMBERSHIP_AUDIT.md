# LINGUA_DOMAIN_ANCHOR_SAMEDOMAIN_MEMBERSHIP_AUDIT

**Phase:** `LINGUA_DOMAIN_ANCHOR_SAMEDOMAIN_MEMBERSHIP_OWNERSHIP_AUDIT`  
**Date:** 2026-09-14  
**Mode:** READ-ONLY · HISTORICAL-SSOT-FIRST · MEMBERSHIP-FIRST · NO PRODUCT CHANGE · NO ACP

---

## 0. Short verdict

Frozen Domain Anchor **does require** membership in a **retained SameDomain result set** (`DomainFilteredSpanSet.sameDomainCandidates` for a `bucketDomain ∈ retainedDomains`).

User clarification (**bucket membership, not mere domain tags**) **matches** that SSOT:

```
HISTORICAL_SSOT_CONFLICT_WITH_CLARIFICATION = NO
HISTORICAL_DOMAIN_ANCHOR_REQUIRES_SAMEDOMAIN_MEMBERSHIP = YES
```

Current `hasRetainedDomainEvidence` **does not** read `sameDomainCandidates`. It approximates:

```
bound ∧ !covered ∧ source∈{domain_term,passive_domain_weak} ∧ domains ∩ retainedDomains ≠ ∅
```

```
CURRENT_DOMAIN_ANCHOR_CHECKS_LITERAL_SAMEDOMAIN_MEMBERSHIP = NO
CURRENT_DOMAIN_ANCHOR_IS_APPROXIMATION = YES
SAMEDOMAIN_MEMBERSHIP_RECONSTRUCTED_APPROXIMATELY = YES
```

**德鸾:** ASR surface「德鸾」不是 domain term；`domainOk` 由 soft `PROFILE_DOMAIN`/`domain_term`（预订/入园/…，`tourism_route`）几何绑定触发。在冻结 `isSameDomainCandidate` 语义下，这些候选**会**进入该 PathFineSpan 的 retained `tourism_route` SameDomain 桶 → **重建判定 Domain Anchor 资格 = YES**。另 **`model2Ok` 由 PROFILE_DOMAIN 独立满足**。

```
DOMAIN_ANCHOR_DRIFT_FIX_ALONE_WOULD_UNANCHOR_DELUAN = NO
PRIMARY_DOMAIN_ANCHOR_FINDING = D2 (+ D6 transport timing)
ONE_NEXT_OWNER = PROFILE_DOMAIN_ANCHOR_AUTHORITY_OWNER
```

---

## 1. Transitions A→E (frozen vs current)

| Step | Meaning | Frozen Domain Anchor? | Current domainOk? |
|------|---------|----------------------|-------------------|
| A | candidate has domain tag | necessary but not sufficient | necessary |
| B | domains ∩ retainedDomains | necessary (via bucketDomain ∈ retained) | **treated as sufficient with A+source+bound** |
| C | candidate ∈ `sameDomainCandidates` for bucket | **REQUIRED (§1)** | **NOT checked** |
| D | PathFineSpan participates via its filtered set | implied by C on that `fineSpanId` | implied only via geometry bind |
| E | Domain Anchor / domainOk | C+B+active+eligible source | B+source+bound+!covered |

---

## 2. Historical Domain Anchor predicates

Source: `model3_anchor_contract_v1.md` § Domain Anchor (all must hold):

| # | PREDICATE | SOURCE | SEMANTIC | CURRENT SITE | ENFORCED |
|---|-----------|--------|----------|--------------|----------|
| 1 | Member of retained SameDomain result set | Anchor contract | `DomainFilteredSpanSet.sameDomainCandidates` for a `bucketDomain` | **none** at adapter | **NO** |
| 2 | `bucketDomain ∈ vote.retainedDomains` | Anchor contract | retained vote gate | `hasRetainedDomainEvidence` via ∩ retained | **PARTIAL** (no bucket object) |
| 3 | Active / eligible on path | Anchor contract | not Vote-eliminated / not covered-out | `!c.isCovered` on `activeCandidates` | **PARTIAL** |
| 4 | `domain_term` \| `passive_domain_weak` | Anchor contract | SameDomain-eligible graph source | `isDomainEvidenceSource` | **YES** |

Forbidden (contract): domain tag **not** in a retained SameDomain bucket; Base-only alone.

```
HISTORICAL_DOMAIN_ANCHOR_REQUIRED_PREDICATES = [1,2,3,4]
```

Provenance survival also requires retaining “Domain membership vs retained buckets” until Anchor completes — but adapter never receives `DomainFilteredSpanSet`.

---

## 3. SameDomain membership definition (frozen)

From `filterDomainCandidatesPerSpan` / `isSameDomainCandidate`:

```
isSameDomainCandidate(pick, bucketDomain) =
  graphSource ∈ {domain_term, passive_domain_weak}
  ∧ domains includes bucketDomain
```

Membership unit = **candidate pick** placed into `DomainFilteredSpanSet.sameDomainCandidates` for a given `fineSpanId` + `bucketDomain`.

```
SAMEDOMAIN_MEMBERSHIP_UNIT = CANDIDATE
SAMEDOMAIN_MEMBERSHIP_IDENTITY =
  DomainAwareSpanReplacementPick.candidateId (or fallback span+word)
  ∈ DomainFilteredSpanSet.sameDomainCandidates
  for fineSpanId = PathFineSpan.spanId
  and bucketDomain ∈ retainedDomains
SAMEDOMAIN_MEMBERSHIP_REQUIRES_RETAINED_DOMAIN = YES
SAMEDOMAIN_MEMBERSHIP_REQUIRES_ACTIVE_CANDIDATE = YES
  (pool from activeCandidates; covered/ineligible dropped at pick conversion)
```

**Not** required by SameDomain SSOT: ASR surface == domain lexicon term.  
(Do not revive Contract A / surface equality.)

---

## 4. Data flow into Anchor adapter

`prepareModel3PathUpstreamWithoutInfer` / `materializeModel3Anchors` receives:

| Input | Status |
|-------|--------|
| `retainedDomains` (via `vote`) | AVAILABLE |
| `activeCandidates` | AVAILABLE |
| `pathFineSpans` / spanId / raw geom | AVAILABLE |
| candidate `source` / `domains` / provenance | AVAILABLE |
| `sameDomainCandidates` / `DomainFilteredSpanSet` / bucket IDs | **NOT_AVAILABLE** |
| SameDomain membership | **DERIVABLE** later via `filterDomainCandidatesPerSpan`; **not present at Anchor** |

Actual order in code:

```
Vote (voteUtteranceDomainFromPool)
  → materializeModel3Anchors   ← domainOk here
  → Model3 / Retry
  → completeDomainAwareAssemblyFromVote  ← SameDomain filter here
```

Freeze narrative (`MODEL3_SYNTHETIC_V1_FROZEN.md`) lists Vote → SameDomain → Anchors; **runtime builds SameDomain after Anchors**.

```
DOMAIN_ANCHOR_REQUIRED_STATE_DROPPED = YES
FIRST_STATE_DROP_BOUNDARY =
  run-model3-path-step.ts::prepareModel3PathUpstream*
  (Anchors before DomainFilteredSpanSet; adapter args omit filtered sets)
```

```
SAMEDOMAIN_MEMBERSHIP_RECONSTRUCTED_APPROXIMATELY = YES
APPROXIMATION_EQUIVALENCE = PARTIAL
```

Partial because: (i) no pick-eligibility gate; (ii) binding via `candidateBoundToSpan` vs pool `windowId`/syl containment; (iii) no literal bucket list. For typical soft `domain_term` ∩ retained on span-pooled cands, often **outcome-equivalent** to `isSameDomainCandidate`.

---

## 5. Current predicate (exact)

```ts
hasRetainedDomainEvidence(candidates, span, vote):
  !vote.insufficientEvidence ∧ retainedDomains.length > 0
  ∧ ∃ c in candidates:
       candidateBoundToSpan(c, span)
       ∧ !c.isCovered
       ∧ c.source ∈ {domain_term, passive_domain_weak}
       ∧ ∃ d ∈ c.domains: retainedDomains.has(d)
```

**Does NOT test:** literal `sameDomainCandidates` membership; `DomainFilteredSpanSet` identity; bucket ID; Assembly pick eligibility; path bucket object; candidateId ∈ filtered set.

---

## 6. 德鸾 — Q1–Q7

| Q | Answer |
|---|--------|
| Q1 Surface「德鸾」is domain lexicon term? | **NO** (traced Domain cands are 预订/入园/… ≠ 德鸾) |
| Q2 Domain-tagged active cands on span? | **YES** |
| Q3 Domains ∩ retainedDomains? | **YES** (`tourism_route`) |
| Q4 Exact domainOk cand in retained SameDomain bucket (frozen identity)? | **YES** (reconstructed: soft `domain_term`+`tourism_route` ⇒ `isSameDomainCandidate`) / literal set at Anchor = N/A |
| Q5 PathFineSpan satisfies frozen Domain Anchor membership? | **YES** (via those SameDomain member cands) |
| Q6 Would domainOk be true even if Q4/Q5 false? | **YES** (predicate never consults Q4) |
| Q7 Exact domainOk triggers | Soft PROFILE_DOMAIN hits, e.g. `预订` / `term-e9a284e8aea27c79`, `source=domain_term`, `retrievalProvenance=PROFILE_DOMAIN`, `domains=[tourism_route]`, raw `[3,5)`, bound to PFS `fine:…:2` |

```
DELUAN_CURRENT_DOMAINOK = YES
DELUAN_MODEL2_ANCHOR_RULE_SATISFIED = YES   (PROFILE_DOMAIN materialized+retained)
DELUAN_DOMAIN_ANCHOR_FROZEN_RULE_SATISFIED = YES  (reconstructed SameDomain members)
DELUAN_TRUE_SAMEDOMAIN_MEMBER = YES  (candidate-level; not surface-level)
```

**Separate paths:** Domain Anchor (soft SameDomain members) **and** Model2 Anchor (PROFILE_DOMAIN) both satisfied — not Domain-only approximation while Model2 alone fires (both fire).

---

## 7. Path-local ownership

Model3 path step votes and anchors **per path** from that path’s `activeCandidates` / `pathFineSpans`.

```
CROSS_PATH_DOMAIN_ANCHOR_LEAK_POSSIBLE = NO   (path-local vote+pool)
CROSS_PATH_DOMAIN_ANCHOR_LEAK_OBSERVED = NO
```

(Within-path binding quirks out of scope.)

---

## 8. Controls (compact)

| Case | role | domain-tagged | retained ∩ | SameDomain member (recon) | domainOk | model2Ok | Anchor |
|------|------|---------------|------------|---------------------------|----------|----------|--------|
| p2_u004_019 德鸾 | PRIMARY | YES soft | YES tourism_route | YES soft cands | YES | YES | DUAL |
| p2_u001_020 **行程** | C1 legitimate Domain exemplar | YES exact surface domain_term | YES | YES | YES (expected) | varies | Domain(+?) |
| p2_u004_001 升层 | C2 | often soft+domain | YES typical | YES if soft domain_term | YES typical | YES P | DUAL |
| mainline test milk_tea vs coffee | C3 non-retained | coffee tags | coffee ∉ retained | NO for coffee | Domain Anchor must not use losing domain | — | DOMAIN only via retained |

Distinction taxonomy preserved: DOMAIN_TAG_ONLY ≠ DOMAIN_RETAINED_ONLY ≠ TRUE_SAMEDOMAIN_MEMBER ≠ DOMAIN_ANCHOR ≠ MODEL2_ANCHOR ≠ DUAL.

---

## 9. Root cause (Domain path only)

```
PRIMARY_DOMAIN_ANCHOR_FINDING = D2_RETAINED_DOMAIN_INTERSECTION_SUBSTITUTES_FOR_SAMEDOMAIN_MEMBERSHIP
```

Secondary: **D6** `DomainFilteredSpanSet` not built / not passed before Anchor.

Not D1 (literal membership not checked). Not removing Domain Anchor. Not surface-equality.

```
IMPLEMENTATION_DRIFT = YES
ACP_REQUIRED = NO
```

Restore class: membership **derivable** from `activeCandidates`+`vote` via existing `isSameDomainCandidate` / filter — **LOCAL_RESTORE_FEASIBLE** without changing Domain Vote / SameDomain / Model2 D semantics; optional transport of filtered sets = **CONTRACT_TRANSPORT_RESTORE_REQUIRED** if literal object required.

---

## 10. Why next owner is PROFILE_DOMAIN

Domain membership question for 德鸾 is **closed**: frozen SameDomain **candidate** membership **holds** (soft bucket members). Adapter drift is real but **fixing Domain predicate alone would not unanchor 德鸾** (`domainOk` would still pass under true SameDomain; **`model2Ok` remains**).

Residual Anchor authority issue for this case is therefore **PROFILE_DOMAIN automatic Model2 Anchor** (prior protection-authority audit) — not an open SameDomain-membership unknown.

```
USER_DECISION_REQUIRED = NO   // for this Domain-membership question
ONE_NEXT_OWNER = PROFILE_DOMAIN_ANCHOR_AUTHORITY_OWNER
ONE_NEXT_DELTA =
  Close Domain-SameDomain membership for 德鸾 as YES (reconstructed soft sameDomainCandidates).
  Escalate to PROFILE_DOMAIN automatic Model2 Anchor authority decision;
  Domain-adapter literal SameDomain restore is secondary and would not alone unanchor 德鸾.
```

---

## 11. Required verdict fields

```
BASELINE_IDENTITY = PASS
HISTORICAL_DOMAIN_ANCHOR_SSOT_FOUND = YES
HISTORICAL_SSOT_CONFLICT_WITH_CLARIFICATION = NO
HISTORICAL_DOMAIN_ANCHOR_REQUIRES_SAMEDOMAIN_MEMBERSHIP = YES
SAMEDOMAIN_MEMBERSHIP_UNIT = CANDIDATE
SAMEDOMAIN_MEMBERSHIP_IDENTITY = candidateId ∈ DomainFilteredSpanSet.sameDomainCandidates for fineSpanId + bucketDomain∈retainedDomains
CURRENT_DOMAIN_ANCHOR_PREDICATE = bound ∧ !covered ∧ domain_term|passive ∧ domains∩retainedDomains
CURRENT_DOMAIN_ANCHOR_CHECKS_LITERAL_SAMEDOMAIN_MEMBERSHIP = NO
CURRENT_DOMAIN_ANCHOR_IS_APPROXIMATION = YES
SAMEDOMAIN_MEMBERSHIP_RECONSTRUCTED_APPROXIMATELY = YES
APPROXIMATION_EQUIVALENCE = PARTIAL
DOMAIN_ANCHOR_REQUIRED_STATE_DROPPED = YES
FIRST_STATE_DROP_BOUNDARY = run-model3-path-step.ts::prepare* (Anchors before DomainFilteredSpanSet)
DELUAN_SURFACE_IS_DOMAIN_TERM = NO
DELUAN_DOMAIN_TAGGED_CANDIDATE_EXISTS = YES
DELUAN_DOMAIN_INTERSECTS_RETAINED = YES
DELUAN_TRUE_SAMEDOMAIN_MEMBER = YES
DELUAN_CURRENT_DOMAINOK = YES
DELUAN_FROZEN_DOMAIN_ANCHOR_ELIGIBLE = YES
DELUAN_MODEL2_ANCHOR_RULE_SATISFIED = YES
DELUAN_DOMAIN_ANCHOR_FROZEN_RULE_SATISFIED = YES
DOMAIN_ANCHOR_DRIFT_FIX_ALONE_WOULD_UNANCHOR_DELUAN = NO
CROSS_PATH_DOMAIN_ANCHOR_LEAK_POSSIBLE = NO
CROSS_PATH_DOMAIN_ANCHOR_LEAK_OBSERVED = NO
PRIMARY_DOMAIN_ANCHOR_FINDING = D2_RETAINED_DOMAIN_INTERSECTION_SUBSTITUTES_FOR_SAMEDOMAIN_MEMBERSHIP
IMPLEMENTATION_DRIFT = YES
ACP_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
MODEL2_CHANGE_REQUIRED = NO
DOMAIN_VOTE_SEMANTIC_CHANGE_REQUIRED = NO
SAMEDOMAIN_SEMANTIC_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
PRODUCT_CODE_CHANGE_THIS_ROUND = NO
USER_DECISION_REQUIRED = NO
ONE_NEXT_OWNER = PROFILE_DOMAIN_ANCHOR_AUTHORITY_OWNER
ONE_NEXT_DELTA = Close Domain-SameDomain membership for 德鸾 as YES (reconstructed soft sameDomainCandidates). Escalate to PROFILE_DOMAIN automatic Model2 Anchor authority decision; Domain-adapter literal SameDomain restore is secondary and would not alone unanchor 德鸾.
```

---

## 12. Acceptance / STOP

Membership SSOT recovered; 德鸾 domainOk candidate identified; Domain vs Model2 paths separated; no surface-equality / Contract A / Domain Anchor removal / PROFILE_DOMAIN demotion / product change.

STOP.
