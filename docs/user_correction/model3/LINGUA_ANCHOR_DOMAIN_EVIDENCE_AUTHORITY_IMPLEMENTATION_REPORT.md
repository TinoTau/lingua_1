# Lingua Anchor Domain Evidence Authority — Implementation Report

**Phase:** `LINGUA_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_IMPLEMENTATION`  
**ACP:** `LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1` (**APPROVED** / **IMPLEMENTED**)  
**Date:** 2026-09-14  
**Mode:** SINGLE-DELTA · SSOT-LOCKED · TRACE-FIRST · NO dual chain / feature flag

---

## 1. Baseline identity

| Field | Value |
|-------|-------|
| Git HEAD (short) | `63b25376` |
| Branch | `main` |
| ACP baseline audit | `LINGUA_ACP_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_*` |
| Prior SSOT (superseded for Domain Anchor) | Domain Anchor + PROFILE_DOMAIN automatic Anchor in historical `model3_anchor_contract_v1.md` |
| **BASELINE_IDENTITY** | **PASS** |

---

## 2. Approved ACP reference

`docs/user_correction/model3/LINGUA_ACP_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_V1.md`

Authority matrix implemented:

| Class | Authority |
|-------|-----------|
| DOMAIN_TERM / PASSIVE / SameDomain / retained / PROFILE_DOMAIN / PROFILE_RETRIEVAL | **NONE** (Anchor) |
| PROFILE_PRONUNCIATION | **AUTOMATIC** (KEEP frozen) |

---

## 3. Changed files

| File | Change |
|------|--------|
| `electron_node/.../model3-runtime/model3-anchor-adapter.ts` | PROFILE_PRONUNCIATION-only Anchor materialization |
| `electron_node/.../model3-runtime/model3-types.ts` | `Model3AnchorSource = 'MODEL2'` only; drop Domain diagnostics fields |
| `electron_node/.../model3-runtime/model3-path-diagnostics.ts` | `model2_anchor_count` only |
| `electron_node/.../model3-runtime/run-model3-path-step.ts` | Call adapter without vote; no rejected_prevote Domain Anchor |
| `electron_node/.../span-assembly-v4/span-assembly-v4-orchestrator.ts` | Diagnostics emit without Domain/dual/rejected_prevote Anchor fields |
| `electron_node/.../model3-mainline.integration.test.ts` | ACP Anchor tests T2–T5 + T7 observation |
| `electron_node/.../model3-acceptance-snapshot.test.ts` / `model3-retry-region.test.ts` | Anchor source → `MODEL2` |
| `electron_node/.../tests/run-dialog200-model3-acceptance.mjs` | Drop obsolete Domain Anchor aggregations |
| `electron_node/.../tests/_probe-model3-zero-retry-audit.mjs` | Drop `domain_anchors` field |
| `docs/.../model3_anchor_contract_v1.md` | Rewritten to ACP |
| `docs/.../MODEL3_ARCHITECTURE_CONTRACT_V1.md` | Domain Vote/SameDomain no longer Anchor source |
| `docs/.../MODEL3_SYNTHETIC_V1_FROZEN.md` | Anchor ownership → MODEL2=P only |
| `docs/.../documentation_authority_matrix.csv` | ACP pointer |
| `docs/.../LINGUA_ACP_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_V1.md` | STATUS → APPROVED/IMPLEMENTED |

---

## 4. Deleted symbols

- `hasRetainedDomainEvidence`
- `countRejectedPreVoteDomainAnchors` / `rejected_prevote_domain_anchor_count`
- `domainOk` / `domainOk \|\| model2Ok` materialization branch
- `Model3AnchorSource` values: `DOMAIN`, `DOMAIN_AND_MODEL2`
- Diagnostics: `domain_anchor_count`, `dual_source_anchor_count`
- Broad `isModel2Provenance` (PROFILE_* union)

---

## 5. Simplified symbols

| Symbol | New meaning |
|--------|-------------|
| `hasEligibleProfilePronunciationEvidence` | Bound + active PROFILE_PRONUNCIATION only |
| `materializeModel3Anchors` | `{ anchors }` — P only → `source: 'MODEL2'` |
| `Model3AnchorSource` | `'MODEL2'` |
| `model2_anchor_count` | Count of PROFILE_PRONUNCIATION Anchors |

---

## 6. Final Anchor predicate

```text
for each PathFineSpan:
  if hasEligibleProfilePronunciationEvidence(span):
    Anchor(source=MODEL2)
  else:
    nonAnchor
```

Eligibility = bound to span ∧ not covered ∧ `retrievalProvenance === 'PROFILE_PRONUNCIATION'`.

---

## 7. Final Anchor source taxonomy

**MODEL2_ONLY** — `MODEL2` ≡ authorized PROFILE_PRONUNCIATION repair evidence.

---

## 8. PROFILE_RETRIEVAL restore evidence

Integration test `C` / ACP T5: `PROFILE_RETRIEVAL` alone → `anchors.length === 0`.  
Predicate no longer treats PROFILE_RETRIEVAL as Model2 Anchor provenance.

**PROFILE_RETRIEVAL_DRIFT_RESOLVED = YES**

---

## 9. PROFILE_PRONUNCIATION preservation evidence

| Case | Result |
|------|--------|
| T3 刘→牛 | Anchor YES · source MODEL2 |
| T4 升层→生成 (+ PROFILE_DOMAIN soft) | Anchor YES · source MODEL2; Domain contributes no authority |
| D / HARD | P spans Anchored; domain-only spans not |

---

## 10. Domain / PROFILE_DOMAIN candidate survival evidence

| Check | Result |
|-------|--------|
| T1-style PROFILE_DOMAIN soft (德鸾/预订) | Candidates materialize; **no** Anchor |
| T2 行程 domain retained | Vote retains domain; **no** Anchor |
| T6 Vote retainedDomains assertions | Unchanged in A/B/HARD/T2 |
| SameDomain / Assembly / KenLM | Not modified this delta |
| Path-level domain buckets | Not modified |

---

## 11. T1–T8 results

| ID | Case | Verdict |
|----|------|---------|
| T1 | 德鸾 / PROFILE_DOMAIN soft (unit E) | **PASS** — no Domain/PROFILE_DOMAIN/P Anchor; span remains Model3-visible (non-anchor) |
| T2 | 行程 domain-only | **PASS** — no Anchor |
| T3 | 刘→牛 P | **PASS** — MODEL2 Anchor |
| T4 | 升层→生成 P+Domain | **PASS** — MODEL2 Anchor |
| T5 | PROFILE_RETRIEVAL only | **PASS** — no Anchor |
| T6 | Domain Vote unchanged | **PASS** — vote still runs; retainedDomains assertions hold; Vote code untouched |
| T7 | Retry candidate survival (行程-like) | **Observed** — see §12 |
| T8 | Exposure / cost delta | **Measured** on targeted unit regression — see §13 |

Unit suites run: `model3-mainline.integration` · `model3-acceptance-snapshot` · `model3-retry-region` → **36 passed**.

**FULL_PILOT200_RUN_THIS_ROUND = NO**

---

## 12. Retry candidate-survival trace (T7)

Frozen semantics (unchanged code):

- `RETRY_DOES_NOT_EXPLICITLY_DELETE_EXISTING_CANDIDATES = YES`
- `RETRY_GUARANTEES_EXISTING_CANDIDATE_SURVIVAL = NO`

Observation on 行程-like domain existing cand (`score=0.05`) + high-score Stage-2 recall filling per-span cap:

| Stage | Present |
|-------|---------|
| PRE_RETRY_EXISTING_CANDIDATE_PRESENT | **YES** |
| POST_MERGE_PRE_BUDGET (conceptual: existing∪retry before slice) | **YES** (merge inserts existing first; no explicit delete) |
| POST_BUDGET_PRESENT | **NO** (score/rank slice dropped low-rank existing) |
| IF_DROPPED | `mergeSpanCandidates` sort-by-score + `slice(0, perSpanCap)` |

**T7_RETRY_EXPLICIT_DELETE_EXISTING_CANDIDATES = NO**  
**T7_EXISTING_CANDIDATE_SURVIVES_POST_BUDGET = NO** (preferred 行程 observation; survival is budget/rank dependent → not guaranteed)

No Retry / budget algorithm change this round.

---

## 13. Model3 exposure delta (T8)

Targeted unit regression (pre-ACP conceptual → post-ACP):

| Metric | After ACP |
|--------|-----------|
| Domain Anchor count | **0** |
| PROFILE_DOMAIN Anchor count | **0** |
| PROFILE_RETRIEVAL Anchor count | **0** |
| PROFILE_PRONUNCIATION Anchor count | preserved (T3/T4/D/HARD) |
| Newly exposed spans | Domain-only / PROFILE_DOMAIN-only / PROFILE_RETRIEVAL-only PathFineSpans now eligible for Model3 KEEP/RETRY |
| Model3 model / training / thresholds | **unchanged** |
| MODEL3_RETRAIN_REQUIRED | **NO** |
| MODEL3_REVALIDATION_REQUIRED | **YES** |

No unexpected mass-RETRY observed in unit harness (no live dialog batch this round). Live exposure remeasure deferred to Pilot200 / budget-audit owner.

---

## 14. Performance observations

| Item | Status |
|------|--------|
| Anchor materialization | Simplified (fewer predicates); no optimization pass |
| Model3 step / Retry / Stage-2 | Untouched algorithms |
| PERFORMANCE_RISK_OBSERVED | **MEDIUM** (more non-anchor spans → potentially more RETRY invocations; not measured on Pilot200) |
| Optimize this round | **NO** |

---

## 15. SSOT docs updated

- `model3_anchor_contract_v1.md` (primary)
- `MODEL3_ARCHITECTURE_CONTRACT_V1.md`
- `MODEL3_SYNTHETIC_V1_FROZEN.md`
- `documentation_authority_matrix.csv`
- ACP status stamp on `LINGUA_ACP_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_V1.md`

ACP **supersedes** prior Domain Anchor / PROFILE_DOMAIN automatic Anchor authority.

---

## 16. Unresolved issues

1. Live dialog utterance KEEP/RETRY counts for T1/T2 (德鸾 / 行程) not re-run on full ASR pipeline this round — unit Anchor authority proven; live Model3 decisions deferred.
2. T7 post-budget drop of low-rank existing domain candidates under RETRY — observed; ownership for follow-up audit only.
3. Worktree contains unrelated dirty files outside this ACP delta — do not conflate.

---

## 17. Exact next owner

Because T7 exposed post-budget candidate-loss on an unanchored Domain span:

**ONE_NEXT_OWNER = `RETRY_BUDGET_BEHAVIOR_AUDIT`**  
**ONE_NEXT_DELTA =** Audit Retry merge + per-span budget effect on existing Domain/PROFILE_DOMAIN candidates after ACP unanchors them; do not change Retry/budget in the audit round unless a separate ACP is approved. After that, controlled Pilot200 remeasure.

---

## Anti-drift check

| Check | OK |
|-------|----|
| No Domain-independent Anchor | YES |
| No SameDomain-independent Anchor | YES |
| No PROFILE_DOMAIN-independent Anchor | YES |
| No PROFILE_RETRIEVAL Anchor | YES |
| PROFILE_PRONUNCIATION still Anchors | YES |
| Domain cands for Vote/SameDomain/Assembly/KenLM | YES (pipelines untouched) |
| Model3 surface + isAnchor + allowlist only | YES |
| RETRY = bounded local reseg + re-recall | YES |
| No second Model2 on RETRY | YES (`MODEL2_ON_MODEL3_RETRY = NO`) |
| No compatibility / Domain Anchor fallback | YES |

**ACCEPTANCE_STATUS = PASS**
