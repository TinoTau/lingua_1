# Lingua — Retry Merge + Per-Span Budget Ownership Audit

**Phase:** `LINGUA_RETRY_MERGE_PER_SPAN_BUDGET_OWNERSHIP_AUDIT`  
**Date:** 2026-09-14  
**Mode:** READ_ONLY · HISTORICAL_SSOT_FIRST · OWNERSHIP_FIRST · TRACE_FIRST  
**Product code change:** **NO**  
**ACP / Pilot200:** **NO**

---

## 0. Audit question — recovered answer

**Authoritative frozen semantic = A (with clarified wording of “replace”).**

When a Retry region runs bounded local resegmentation + Stage-2 re-recall:

1. Existing first-pass candidates bound to the span and Retry candidates are **merged into one unified per-span pool**.
2. Dedup by identity key; **existing wins** on key collision (Retry does not overwrite score/provenance).
3. Unified pool is **score-sorted** then truncated by the **same** `perSpanCap` (`getPerSpanCandidateLimit`).
4. That capped set **replaces the region’s uncovered candidate slot** in the path working pool (not a second SegmentationPath).

**Not B:** first-pass is **not** unconditionally preserved; survival after cap is **not** guaranteed.  
**Not C:** no historically frozen evidence-class / source-specific reserved budget for Domain / PROFILE_DOMAIN / PROFILE_PRONUNCIATION under Retry merge.  
**Not D:** contract is recoverable; wording “replace” ≠ wipe-without-merge.

| Distinction | Status |
|-------------|--------|
| RETRY ≠ rejection | YES |
| merge ≠ preservation guarantee | YES |
| exists before merge ≠ survives cap | YES |
| Domain candidate ≠ protected candidate | YES |
| per-span cap ≠ sentence ≤16 | YES |
| KenLM sentence ranking ≠ Retry candidate ranking | YES |

---

## 1. Baseline / T7 observation

Prior ACP acceptance T7 stands:

| Stage | Present |
|-------|---------|
| PRE_RETRY_EXISTING | YES |
| POST_MERGE_PRE_BUDGET | YES |
| POST_BUDGET | NO (low-score can drop) |

```text
RETRY_DOES_NOT_EXPLICITLY_DELETE_EXISTING_CANDIDATES = YES
RETRY_GUARANTEES_EXISTING_CANDIDATE_SURVIVAL = NO
```

Cause: `mergeSpanCandidates` → existing∪retry → score sort → `slice(0, perSpanCap)`.

---

## 2. Document authority classification

| SOURCE | AUTHORITY_CLASS | DATE | EXACT_RULE | CURRENT_OR_SUPERSEDED | CONFLICTS_WITH |
|--------|-----------------|------|------------|----------------------|----------------|
| `Lingua_Model3_V1_Mainline_Integration_Predevelopment_Audit_2026_08_26.md` §8–9 | **AUTHORITATIVE_SSOT** (pre-impl design) | 2026-08-26 | “Retry candidates must merge into existing pools **within** per-span cap”; merge/dedupe was GAP to specify in development | CURRENT intent | Soft-worded “replace” elsewhere — reconciled below |
| `model3_retry_contract_v1.md` | **AUTHORITATIVE_SSOT** | FROZEN; region corr. 2026-08-28; V2 seal 2026-09-08 | RETRY = one bounded reseg + re-recall; sentence pool ≤16; “Re-recall may **replace** candidates **only for RETRY spans**. Anchor candidates retained as-is.” | CURRENT | Does **not** require first-pass survival |
| `FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/02_Runtime.md` | **AUTHORITATIVE_SSOT** | 2026-08-05 | Hard limits: per-span **8/6/4**; `maxSentenceCandidates` **16** | CURRENT | — |
| `per-span-candidate-limit.ts` | **ACCEPTED_IMPLEMENTATION** | frozen P4 | “P4 frozen per-span candidate limit (**base+domain+alias combined cap**)” | CURRENT | — |
| `STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1.md` | **AUTHORITATIVE_SSOT** (retrieval) | Stage D freeze | UNION then **ONE** per-FineSpan candidate budget | CURRENT | No reserved Domain/Retry slot |
| `model3_v1_retry_ownership_summary.json` | **ACCEPTED_IMPLEMENTATION** / ownership audit | 2026-08-28 | Candidate budget owner = ASR postprocess / `getPerSpanCandidateLimit` | CURRENT | — |
| `Lingua_Model3_V1_ASR_Postprocess_Retry_Region_Correction_Report_2026_08_28.md` | **ACCEPTED_IMPLEMENTATION** | 2026-08-28 | “… → **replace** region candidates in pool (**not append second path**)” | CURRENT | “Replace” vs “merge” — **reconciled**: replace = region-slot rewrite of merge result; anti-dual-path |
| `MODEL3_V1_MAINLINE_INTEGRATION_ROLLBACK_MANIFEST.json` | **ACCEPTED_IMPLEMENTATION** | 2026-08-28 | postCorrectionBehavior ends “… replace region candidates” | CURRENT | Same reconciliation |
| `model3-retry-router.ts` JSDoc “replace region candidates” | **COMMENT_ONLY** | code | Describes router | CURRENT | Matches region-slot rewrite; **PARTIAL** match if read as wipe-all |
| `model3_v2_authoritative_implementation_map.csv` | **AUTHORITATIVE_SSOT** (V2 map) | V2 freeze | Candidate budget = `perSpanCap` + global KenLM cap; owners `routeModel3Retry` + `mergeCrossPath` | CURRENT | — |
| `LINGUA_ACP_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_*` | **ACCEPTED_IMPLEMENTATION** (Anchor ACP; budget note only) | 2026-09-14 | Merge keeps existing keys then cap may drop lowest scores | CURRENT observational | Must **not** invent Domain reserved budget |
| Anchor / Domain Vote / Model3 role docs | **AUTHORITATIVE_SSOT** (out of budget) | various | Closed this round | — | Do not reopen |

**HISTORICAL_RETRY_BUDGET_SSOT_FOUND = YES**  
**HISTORICAL_RETRY_BUDGET_SSOT_CONFLICT = NO**  
(Wording tension “replace” vs “merge” is terminological: region pool rewrite after merge-within-cap, not dual contradictory SSOT rules.)

---

## 3. Ownership model (recovered)

| Concern | Owner |
|---------|--------|
| FIRST_PASS_CANDIDATE_OWNER | First-pass Recall + Model2 materialize (pre-Retry pool) |
| RETRY_CANDIDATE_OWNER | ASR postprocess Retry router Stage-2 `recallSpanTopKV2` + `materializeLocalSpanHits` |
| MERGE_OWNER | `routeModel3Retry` / `mergeSpanCandidates` |
| DEDUP_OWNER | `mergeSpanCandidates` via `candidateKey` |
| RANKING_OWNER | `mergeSpanCandidates` score sort (Retry layer) |
| PER_SPAN_CAP_OWNER | `getPerSpanCandidateLimit` (FW P4); applied at Retry merge **and** later Assembly `budgetPerSpanCandidates` |
| FINAL_PRE_ASSEMBLY_POOL_OWNER | Path working `activeCandidates` after Retry → Domain-aware Assembly (`completeDomainAwareAssemblyFromVote`) |
| EXISTING_RETRY_BUDGET_RELATION | **SHARED** |

---

## 4. Production call chain (exact)

```text
Model3SpanDecision RETRY
→ deriveRetryRegions (model3-retry-region.ts)
→ resegmentRetryRegionWithLattice / fallback (model3-retry-region-resegment.ts)
→ enumerateStage2SuccessPathQueryLocals (model3-retry-stage2-windows.ts)
→ recall (recallSpanTopKV2 via router callback)
→ materializeLocalSpanHits / materializeRetryHits
→ per sourceSpanId:
     before = uncovered existing bound to PathFineSpan
     retryForSpan = uncovered retry bound to PathFineSpan
     after = mergeSpanCandidates(before, retryForSpan, perSpanCap)
→ next = outsideRegion ∪ keptCoveredInRegion ∪ mergedInRegion
→ working activeCandidates
→ buildFineSpanCandidatePool / completeDomainAwareAssemblyFromVote
→ budgetPerSpanCandidates (again, same getPerSpanCandidateLimit)
→ buildSentenceCandidates → mergeCrossPath ≤16 → KenLM
```

| Transition | INPUT | OUTPUT | MUTATES_OR_REBUILDS | CANDIDATE_IDENTITY_PRESERVED | PROVENANCE_PRESERVED | SCORE | CAP | WHO_OWNS |
|------------|-------|--------|---------------------|------------------------------|----------------------|-------|-----|----------|
| deriveRetryRegions | decisions, anchors, PathFineSpans | regions | rebuild region list | n/a | n/a | n/a | no | Retry region |
| resegment | region slice | localSpans | rebuild local geometry | n/a | n/a | n/a | no | Resegment |
| Stage-2 recall | window text/pinyin, retainedDomains | hits | new hits | n/a | new | score from recall | recall `perSpanLimit` | Recall |
| materialize* | hits | WindowCandidate (`m3r:…`) | create | new ids | Stage-2 (no PROFILE_* unless hit carries) | hit.candidateScore copied | no | Retry router |
| mergeSpanCandidates | existing[], retry[], cap | capped[] | rebuild per-span set | yes if key kept | yes if existing wins | existing score kept on dup | **yes** | Retry router |
| region pool rewrite | outside + covered + merged | working | rebuild path pool | outside untouched | yes | yes | already capped | Retry router |
| Assembly budget | DomainFilteredSpanSet | budgeted picks | rebuild picks | pick identity | via pick fields | assembly sort | **yes again** | Assembly |
| CrossPath / KenLM | sentence cands | ≤16 ranked | merge+rank | text dedup | n/a | KenLM | sentence ≤16 | KenLM owner |

**MODEL3_CHANGE_REQUIRED = NO** — Model3 only emits KEEP/RETRY.

---

## 5. Current `mergeSpanCandidates` contract

```199:220:electron_node/electron-node/main/src/model3-runtime/model3-retry-router.ts
function mergeSpanCandidates(
  existing: WindowCandidate[],
  retry: WindowCandidate[],
  perSpanCap: number
): WindowCandidate[] {
  const byKey = new Map<string, WindowCandidate>();
  for (const c of existing) {
    const k = candidateKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  }
  for (const c of retry) {
    const k = candidateKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  }
  return [...byKey.values()]
    .sort(
      (a, b) =>
        (b.candidateScore ?? b.score ?? 0) - (a.candidateScore ?? a.score ?? 0) ||
        String(a.candidateId).localeCompare(String(b.candidateId))
    )
    .slice(0, perSpanCap);
}
```

`candidateKey`: `tid:${termId}` else `surf:${replacement}:${rawStart}:${rawEnd}`.

| Field | Value |
|-------|-------|
| CURRENT_MERGE_POLICY | EXISTING_FIRST_INSERT ∪ RETRY_INSERT_IF_NEW_KEY → SCORE_DESC → SLICE |
| CURRENT_DEDUP_IDENTITY | termId preferred; else replacement+raw range |
| CURRENT_DUPLICATE_WINNER | **EXISTING** (Retry skipped if key present; score not overwritten) |
| CURRENT_RANKING_POLICY | `candidateScore ?? score` desc; tie-break `candidateId` localeCompare |
| CURRENT_CAP_APPLICATION_POINT | After dedup+sort inside `mergeSpanCandidates`; no source/provenance filter before cap |
| CURRENT_EXISTING_SURVIVAL_GUARANTEE | **NO** |

JSDoc on `routeModel3Retry`: “replace region candidates” = rebuild region’s uncovered contribution via merge+cap; covered-in-region kept; outside-region untouched.

| REPLACE_REGION_COMMENT_AUTHORITY | COMMENT_ONLY (+ ACCEPTED_IMPLEMENTATION reports use same phrase) |
| REPLACE_REGION_COMMENT_MATCHES_CODE | **PARTIAL** (accurate as region-slot rewrite; inaccurate if read as wipe-without-merge) |
| REPLACE_REGION_COMMENT_MATCHES_SSOT | **YES** under reconciled reading (anti-dual-path + may-replace RETRY-span candidates) |

---

## 6. perSpanCap origin

| Field | Value |
|-------|--------|
| PER_SPAN_CAP_ORIGINAL_PURPOSE | **P1 + P2 + P4**: bound cost before Assembly/KenLM; control lexicon explosion; **one combined pool regardless of source** (base+domain+alias) |
| PER_SPAN_CAP_ORIGINAL_SCOPE | Per FineSpan / path span slot; values 8 / 6 / 4 by path span count |
| PER_SPAN_CAP_APPLIED_TO_RETRY_BY_DESIGN | **YES** (predev: merge **within** per-span cap; ownership audit lists same API) |
| PER_SPAN_CAP_EQUALS_SENTENCE_BUDGET | **NO** |
| RETRY_BUDGET_AND_SENTENCE_BUDGET_RELATION | Upstream **local safety / assembly-prep bound**; sentence ≤16 is **downstream** CrossPath+KenLM layer |
| KENLM_OWNS_FINAL_SENTENCE_RANKING | **YES** |

---

## 7. Frozen Retry candidate semantic

Evidence:

- Predev: merge into existing **within** cap → implies displacement possible.  
- Retry contract: may **replace** candidates on RETRY spans; only Anchors must retain.  
- No SSOT: reserved slots; Domain survival; “augment-only with unlimited preserve”.

**FROZEN_RETRY_CANDIDATE_SEMANTIC = MERGE_SHARED_BUDGET**

---

## 8. Domain / PROFILE_* reserved budget

| Class | Reserved under Retry merge? |
|-------|----------------------------|
| domain_term / passive_domain_weak | **NO** |
| PROFILE_DOMAIN | **NO** |
| SameDomain / retained | **NO** (Vote/Assembly organization only) |
| PROFILE_PRONUNCIATION | **NO** as budget privilege (Anchor suppresses RETRY upstream — different layer) |

Do **not** recreate Domain Anchor as budget privilege (ACP closed).

---

## 9. Score ownership / shared ranking

| Source | Score origin |
|--------|--------------|
| First-pass lexicon | `computeCandidateScore` (`recall-span-topk-v2`) |
| PROFILE_PRONUNCIATION | Lexicon hit `candidateScore` via Model2 materialize |
| PROFILE_DOMAIN | Model2 `prior_score` (fallback 0.5) — **not** necessarily same formula as lexicon CE |
| Stage-2 Retry | Same `recallSpanTopKV2` → `computeCandidateScore` |

| Field | Value |
|-------|--------|
| EXISTING_AND_RETRY_SCORE_SCALE_COMPARABLE | **PARTIAL** (lexicon↔lexicon YES; PROFILE_DOMAIN prior ↔ lexicon PARTIAL/risk) |
| SHARED_SCORE_RANKING_HAS_CONTRACT_SUPPORT | **PARTIAL** (combined base+domain+alias cap is frozen; explicit Model2-prior vs lexicon equivalence **not** documented) |

Not elevated to primary class for T7: even with comparable scores, shared cap displacement is by design.

---

## 10. Path / span locality

| Field | Value |
|-------|--------|
| RETRY_CANDIDATE_MERGE_PATH_LOCAL | **YES** (`routeModel3Retry` on one path’s working pool) |
| RETRY_CANDIDATE_CAP_SPAN_LOCAL | **YES** (per `sourceSpanId` / PathFineSpan) |
| CROSS_PATH_CANDIDATE_DISPLACEMENT_POSSIBLE | **NO** at Retry merge (CrossPath is later sentence layer) |
| CROSS_SPAN_CANDIDATE_DISPLACEMENT_POSSIBLE | **NO** at merge (per-span maps); region rewrite only touches overlapping region candidates |

---

## 11. Targeted traces R1–R6

No Pilot200. Reconstructions from accepted unit semantics + code contract (not GT correctness).

| ID | Scenario | existingDropped | dropReason | Matches historical policy? |
|----|----------|-----------------|------------|----------------------------|
| R1 | 行程-like Domain, low score, Retry fills cap | YES | shared score slice | YES (MERGE_SHARED_BUDGET) |
| R2 | PROFILE_DOMAIN soft (德鸾/预订-like) | MAY | same; prior_score may rank low vs lexicon Retry | YES |
| R3 | High-score existing | NO | rank ≤ cap | YES |
| R4 | Low-score existing | YES | rank > cap | YES |
| R5 | Duplicate termId/surface key | Retry skipped | EXISTING wins | YES |
| R6 | Retry count < free slots | NO for existing | under-cap | YES |

See matrix JSON for per-candidate columns.

---

## 12. Root cause / restore vs ACP

**PRIMARY_RETRY_BUDGET_FINDING = RB1_SHARED_BUDGET_IS_FROZEN_DESIGN**

| Field | Value |
|-------|--------|
| IMPLEMENTATION_DRIFT | **NO** |
| ACP_REQUIRED | **NO** (no restore-needed drift) |
| NEW_ACP_REQUIRED | **NO** unless product later wants different budget policy after Anchor ACP exposure |
| USER_DECISION_REQUIRED | **NO** for ownership recovery |
| Patch-free future shape (if ever changing) | **F. NO_CHANGE_REQUIRED** under recovered SSOT; any change → **C. CANDIDATE_BUDGET_CONTRACT_CHANGE_REQUIRED** (+ possible **D** for score contract) |

ACP increased how often Domain-only spans enter RETRY; it did **not** rewrite the frozen shared-budget contract. Observing 行程 drop after RETRY is **expected under A**, not proof of illegal drift.

---

## 13. Pilot200 readiness

**FULL_PILOT200_RUN_THIS_ROUND = NO**  
**PILOT200_READY_AFTER_THIS_AUDIT = YES**

Candidate survival after newly exposed RETRY spans is now understood as shared-budget semantics. Remeasure can proceed without inventing Domain reserved slots.

---

## 14. Final anti-drift

This audit did **not** decide whether 行程 “should” survive.  
It recovered: **existing + Retry share one per-span score budget; displacement is allowed; Anchors are the RETRY-suppression layer (ACP: P only), not a Retry budget privilege for Domain.**

**STOP.**
