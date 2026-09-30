# Lingua1 — Model3 RETRY / Main-Chain Closure Audit

```text
RESULT_ENUM =
A — COMPLETE_AND_FROZEN_COMPLIANT

PRIMARY_CLASSIFICATION =
A — COMPLETE_AND_FROZEN_COMPLIANT

MODEL3_INVOCATION_FOUND = YES
MODEL3_KEEP_IMPLEMENTED = YES
MODEL3_RETRY_IMPLEMENTED = YES
RETRY_CONSUMER_FOUND = YES
RETRY_HAS_BUSINESS_EFFECT = YES
LOCAL_REPAIR_EXECUTED = YES
MAIN_CHAIN_REENTRY_FOUND = YES
KENLM_RESCORING_AFTER_REPAIR = YES
MODEL3_REENTRY_POSSIBLE = NO
TERMINATION_GUARD_FOUND = YES
B18_CAN_CHANGE_DUE_TO_RETRY = YES

B17_DECISION_OBSERVABLE = YES
RETRY_CONSUMPTION_OBSERVABLE = PARTIAL
REPAIR_EXECUTION_OBSERVABLE = PARTIAL
B18_CAUSAL_LINK_OBSERVABLE = NO

FROZEN_DESIGN_COMPLETE = YES
CURRENT_IMPLEMENTATION_COMPLETE = YES
FROZEN_IMPLEMENTATION_MATCH = YES_WITH_MINOR_GAPS

PRODUCTION_CODE_CHANGED = NO
TEST_CODE_CHANGED = NO
MODEL_CHANGED = NO
LEXICON_CHANGED = NO

STABLE_ENGINEERING_FREEZE_BLOCKED = NO

NEXT_OWNER =
LINGUA_ASR_POSTPROCESSING_STABLE_ENGINEERING_FREEZE
```

**Mode:** READ_ONLY_AUDIT · NO_IMPLEMENTATION · NO_PRODUCTION_CHANGE  
**Date context:** Post Dialog200 Replay V2 official equivalence (200/200).  
**Scope:** Model3 KEEP/RETRY business closure with ASR post-processing main chain only (not linguistic accuracy / WER).

---

## 1. Executive Summary

Production Model3 is **not** a trigger-only stub.

When Model3 emits `RETRY` on a legal non-anchor FineSpan:

1. `routeModel3Retry` consumes the decision.
2. Bounded **retry region(s)** are derived; adjacent RETRY spans may merge.
3. Local lattice re-segmentation (or legal-window fallback) runs.
4. Existing `recallSpanTopKV2` Stage2 recall runs with `model3_retry_pinyin_domain_recovery`.
5. Region candidates are **merged/replaced** into the path candidate pool (`mutated` / `poolRefreshed`).
6. **Same frozen Domain Vote** feeds `completeDomainAwareAssemblyFromVote`.
7. Orchestrator builds sentence candidates → CrossPath merge → **one KenLM** rerank → Apply → Final.

Therefore RETRY **can** causally change B18 Final when repair candidates win Assembly/KenLM.

Replay V2 200/200 proves reproducibility of current behavior; this audit separately proves **RETRY has a real Production consumer and rejoins the existing main chain**.

Minor gaps (do **not** overturn classification A):

- Capture B17 proves decision + retry-region traces, **not** a linked B17→repair→B18 causal edge.
- Frozen Trigger Gate (optional skip of Model3 inference) is **not** found as a named Production gate; Model3 path-step always runs when the orchestrator reaches it.
- `documentation_authority_matrix.csv` still labels retry contract “not enabled” — **SUPERSEDED** by Model3 V2 freeze SSOT (`PRODUCTION_RETRY_ENABLED = YES`).

---

## 2. Authority / SSOT Inventory

| Path | Class | Role |
|------|-------|------|
| `docs/user_correction/model3/Model3_V2_Frozen_Architecture_SSOT.md` | AUTHORITATIVE_FROZEN_SSOT | V2 freeze index; Retry ACTIVE+FROZEN |
| `docs/user_correction/model3/model3_v2_ssot_consistency_check.csv` | AUTHORITATIVE_FROZEN_SSOT | ACTIVE_SSOT vs SUPERSEDED (Retry ENABLED aligned) |
| `docs/user_correction/model3/model3_v2_freeze_manifest.json` | AUTHORITATIVE_FROZEN_SSOT | Machine seal: `PRODUCTION_RETRY_ENABLED=true` |
| `docs/user_correction/model3/MODEL3_ARCHITECTURE_CONTRACT_V1.md` | AUTHORITATIVE_FROZEN_SSOT | Role, insertion point, prohibitions, limits |
| `docs/user_correction/model3/model3_retry_contract_v1.md` | AUTHORITATIVE_FROZEN_SSOT | RETRY meaning; one-cycle repair; KenLM once after |
| `docs/user_correction/model3/model3_output_contract_v1.md` | AUTHORITATIVE_FROZEN_SSOT | KEEP\|RETRY only; consumer = retry coordinator |
| `docs/user_correction/model3/model3_input_contract_v1.md` | AUTHORITATIVE_FROZEN_SSOT | TEXT_ONLY + Anchor; no KenLM/audio |
| `docs/user_correction/model3/model3_anchor_contract_v1.md` | AUTHORITATIVE_FROZEN_SSOT | Anchor ownership |
| `docs/user_correction/model3/LINGUA_ACP_MODEL3_RETRY_STAGE2_TONE_RELAXATION_V1.md` | AUTHORITATIVE_FROZEN_SSOT (ACP APPROVED/IMPLEMENTED/FROZEN) | Stage2 tone-relax recall mode only |
| `docs/user_correction/model3/model3_v2_runtime_promotion_acceptance.json` / freeze manifests | ACCEPTED IMPLEMENTATION | Runtime default = S3; Retry enabled |
| `docs/user_correction/model3/Lingua_Model3_V1_ASR_Postprocess_Retry_Region_Correction_Report_2026_08_28.md` | DEVELOPMENT_REPORT / ACCEPTED | Retry-region semantics correction |
| `docs/user_correction/model3/Lingua_Model3_V1_Training_Coverage_Audit_2026_08_29.md` | AUDIT_REPORT / EVIDENCE | RETRY=0 on dialog_200 = training bias, not missing consumer |
| `docs/user_correction/model3/documentation_authority_matrix.csv` | PARTIAL / STALE on retry row | Says retry “not enabled” — **SUPERSEDED** by V2 SSOT |
| `docs/user_correction/model3/model3_freeze_governance.json` | SUPERSEDED_FOR_MODEL3 (matrix) | Synthetic freeze era; TTS next-phase superseded |

**Not treated as authority for closure:** Replay V2 reports alone, Capture completeness alone, newest file by mtime.

### Named Frozen terms — FROZEN_DECISION_NOT_FOUND

Cross-check with SSOT inventory ([SSOT Model3 RETRY docs](06caa796-9443-4d5b-bd76-606b5a53b7d7)): the following **names** are not Level-1 contract titles, even though equivalent behavior is defined:

| Named topic | Status | Equivalent Frozen coverage |
|-------------|--------|----------------------------|
| KEEP/RETRY closure (product term) | FROZEN_DECISION_NOT_FOUND | Retry subchain + Assembly → KenLM once |
| re-entry checkpoint | FROZEN_DECISION_NOT_FOUND | “No Model3 recursion”; implement as Assembly rejoin |
| termination (named chapter) | FROZEN_DECISION_NOT_FOUND | ≤1 Model3 / ≤1 retry cycle; `model3Reinvoked: false` |
| local repair begin/end fields | FROZEN_DECISION_NOT_FOUND | Flow boundaries in Architecture + Retry contracts |
| paths rebuilt | FROZEN_DECISION_NOT_FOUND | Regional lattice resegment only |

Note: ACP / code “Stage2 recall **closure**” means the Stage2 recall wiring function, **not** a product “KEEP/RETRY closure” contract.

These naming gaps do **not** change PRIMARY_CLASSIFICATION A: RETRY meaning, consumer, and main-chain rejoin are Frozen and Implemented.

---

## 3. Frozen Model3 Responsibility

From `MODEL3_ARCHITECTURE_CONTRACT_V1.md` (authoritative):

- **Role:** Anchor-Conditioned Text Repair Trigger / Span Retry Trigger.
- **Output:** `KEEP` \| `RETRY` per eligible non-anchor span only.
- **RETRY means:** request **one** bounded local re-segmentation + re-recall — **not** corrected text, not candidates, not domain, not Anchor, not final sentence.
- **Must not:** second ASR; second full repair pipeline; sentence generator; Domain Vote; replace KenLM; mutate Anchors; recurse Model3.
- **Insertion:** after Domain Vote / Anchors, **before** first KenLM; after retry: one Assembly + one KenLM.

`PRODUCTION_RETRY_ENABLED = YES` · `MODEL3_RETRY_SUBCHAIN = ACTIVE + FROZEN` (V2 SSOT).

---

## 4. Current Production Invocation Chain

Exact call chain (Production):

```text
InferenceService.runJobPipeline / runPipelineWithMockAsr
  → job-pipeline.runJobPipeline
    → pipeline-step-registry → runFwDetectorStep
      → fw-detector-orchestrator.runFwDetectorOrchestrator
        → fw-detector-v4-path.runFwDetectorV4Path
          → span-assembly-v4-orchestrator.runSpanAssemblyV4Orchestrator
            → (per path) Domain Vote prep inside runModel3PathStep
            → runModel3PathStep
                 → prepareModel3PathUpstream (vote once, anchors, pack/infer)
                 → completeModel3PathFromUpstream
                      → routeModel3Retry (…)
                      → completeDomainAwareAssemblyFromVote (same vote)
            → buildSentenceCandidates (per domain bucket)
          → mergeCrossPathSentenceCandidates
          → runFwSentenceRerankFromPrefilled (KenLM)
          → applyFwSpanReplacements → finalPostprocessText
```

| Item | Value |
|------|-------|
| FILE | `electron_node/electron-node/main/src/model3-runtime/run-model3-path-step.ts` |
| FUNCTION | `runModel3PathStep` / `completeModel3PathFromUpstream` |
| CALLER | `runSpanAssemblyV4Orchestrator` (`span-assembly-v4-orchestrator.ts`) |
| INPUT TYPE | `Model3PathStepArgs` |
| OUTPUT TYPE | `RunModel3PathStepResult` `{ assemblyResult, activeCandidates, diagnostics, voteCallCount }` |

Orchestrator comment (source):  
`Domain Vote (ONCE) → Model3 Anchors → KEEP/RETRY → optional local re-recall → refresh pool → completeFromVote (SAME vote)`.

---

## 5. Model3 Input Contract

### Actual Production inference input

Packed via `packModel3SpanInferFields` → host infer (`model3-inference-client.ts`).

| FIELD | SOURCE / PRODUCER | SEMANTIC ROLE | USED_BY_MODEL3 | TRACE_ONLY |
|-------|-------------------|---------------|----------------|------------|
| surface / char tokens | PathFineSpan + rawText | text repair trigger | YES | NO |
| isAnchor | `materializeModel3Anchors` | mask / feature | YES | NO |
| span_len_log1p, span_rel_position, first_pass_cand_log1p, current_cjk_len_log1p, pinyin_channel_avail | feature pack | frozen feature allowlist | YES | NO |
| featVector / availMask / tokenIds | host pack | model tensors | YES | NO (business decision); also TRACE |
| keepLogit / retryLogit / margin | host forward | argmax KEEP/RETRY | YES (inside model) | YES for downstream business (only label consumed) |
| Anchor source MODEL2 | anchor adapter | eligibility mask | YES (mask) | partial TRACE |
| retainedDomains | Domain Vote | **not** Model3 tensors; used by Stage2 recall after RETRY | NO (infer) | NO (repair path) |
| acousticToneSlices / Tone posteriors | upstream | Stage2 recall / lattice only | NO | may TRACE elsewhere |
| KenLM scores | — | forbidden as Model3 trigger | NO | N/A |
| selected sentence / KenLM pick | — | Model3 runs **before** KenLM | NO | N/A |
| recallQueryEvidence | ACP V1 | Stage2 query mapping only | NO (infer) | routing |
| retry checkpoint | — | none as Model3 input | NO | N/A |

**Distinction:** Capture/diagnostics may record logits and inference_input_trace; business consumer of Model3 output uses **decision labels** only.

---

## 6. Model3 Output Contract

| FIELD | MEANING | PRODUCED_BY | CONSUMED_BY | BUSINESS_EFFECT | TRACE_ONLY |
|-------|---------|-------------|-------------|-----------------|------------|
| `decision: KEEP\|RETRY` | repair trigger label | inference / override | `routeModel3Retry` / `deriveRetryRegions` | YES if RETRY | NO |
| `eligible` | non-anchor eligibility | maskAnchorDecisions | router | YES | NO |
| `spanId` | FineSpan identity | pack/infer | router | YES | NO |
| keepLogit / retryLogit / margin / features / tensors | diagnostics | host | Capture B17 strip floats | NO (after label) | YES |
| replacement text / candidate list | **forbidden** | none in Model3 output | — | N/A | N/A |

Runtime type: `Model3SpanDecision` in `model3-types.ts` (`decision: 'KEEP' | 'RETRY'`).

---

## 7. KEEP Consumer Trace

```text
Model3 KEEP (all spans KEEP, or no RETRY regions)
  → routeModel3Retry: deriveRetryRegions empty / no region mutation
  → mutated = false → poolRefreshed = false
  → assemblyPool = preRetryPool
  → completeDomainAwareAssemblyFromVote(preRetryPool, frozen vote, …)
  → buildSentenceCandidates → CrossPath → KenLM → Final
```

**KEEP meaning (implemented):** preserve first-pass / post-Model2 candidate pool for that path; Domain Vote unchanged; Anchors unchanged. Authoritative B18 source remains the normal Assembly+KenLM pick over the **pre-retry** pool (plus other paths).

Evidence: `model3-mainline.integration.test.ts` case J — KEEP-only → `poolRefreshed === false`.

---

## 8. RETRY Consumer Trace (PRIMARY)

| Step | FILE | FUNCTION | CONDITION | ACTION | NEXT |
|------|------|----------|-----------|--------|------|
| 1 | `run-model3-path-step.ts` | `completeModel3PathFromUpstream` | after infer + anchor mask | call `routeModel3Retry` | router |
| 2 | `model3-retry-router.ts` | `routeModel3Retry` | `decision === 'RETRY'` & non-anchor | `deriveRetryRegions` | resegment |
| 3 | `model3-retry-region-resegment.ts` | `resegmentRetryRegionWithLattice` (or fallback) | region present | local spans / legal windows | Stage2 recall |
| 4 | `run-model3-path-step.ts` recall closure | `recallSpanTopKV2` | Stage2 window | `recallMode = model3_retry_pinyin_domain_recovery` | materialize `m3r:*` candidates |
| 5 | `model3-retry-router.ts` | merge per span | hits / geometry | replace region candidates in working pool; `mutated=true` | return |
| 6 | `run-model3-path-step.ts` | if `retryResult.mutated` | mutated | `buildFineSpanCandidatePool` refreshed | Assembly |
| 7 | `assemble-domain-aware-span-sets` | `completeDomainAwareAssemblyFromVote` | same `vote` identity | Assembly span sets | orchestrator |
| 8 | `span-assembly-v4-orchestrator.ts` | `buildSentenceCandidates` | post-Model3 assembly | sentence pool | CrossPath |
| 9 | `fw-detector-v4-path.ts` | `runFwSentenceRerankFromPrefilled` | KenLM on | score/pick | Apply → Final |

**Proven classification:** **A — RETRY reaches an actual repair consumer and rejoins Production.**

Not B (trace-only): `mutated` changes `activeCandidates` and Assembly inputs.  
Not E (second mainline): Recall/Assembly/KenLM are **existing** modules; Model3 does not own them.

---

## 9. First Business Effect

```text
FIRST_BUSINESS_EFFECT_FUNCTION = routeModel3Retry (region merge → working activeCandidates)
FIRST_BUSINESS_EFFECT_OBJECT   = WindowCandidate[] (path activeCandidates / FineSpanCandidatePool)
BEFORE = pre-retry candidates in retry region
AFTER  = region candidates merged/replaced (m3r:* + prior; per-span cap)
EVIDENCE =
  model3-retry-router.ts mutated=true path;
  run-model3-path-step.ts poolRefreshed;
  integration test K+L+STALE
```

Logs/Capture alone are **not** the first business effect.

---

## 10. Retry Target Semantics

| Question | Answer | Evidence |
|----------|--------|----------|
| RETRY_TARGET_TYPE | **SPAN → derived RETRY_REGION** (adjacent RETRY merge) | `model3-retry-region.ts` `deriveRetryRegions` |
| RETRY_TARGET_IDENTITY | `spanId` → `retryRegionId = m3rr:{first}:{last}` | region trace |
| RETRY_TARGET_COORDINATE | rawStart/rawEnd + syllableStart/syllableEnd of region | region object |
| ANCHOR_CONTEXT_PRESERVED | YES — Anchor RETRY forced KEEP; anchors break merge | `maskAnchorDecisions`; deriveRetryRegions |
| ORIGINAL_PATH_ID_PRESERVED | YES — path-local; vote identity asserted | `model3_vote_identity_broken` throw |

Model3 itself does **not** emit region fields (SSOT); regions are **postprocess-derived**.

---

## 11. Repair Re-entry Checkpoint

**Actual re-entry:** path-local **candidate pool refresh + Assembly completion**, **not** FineSpan/Model2 restart.

Exact functions:

- Re-entry repair: `routeModel3Retry` → `resegmentRetryRegionWithLattice` / Stage2 windows → `recallSpanTopKV2`
- Rejoin: `buildFineSpanCandidatePool` + `completeDomainAwareAssemblyFromVote` (frozen vote)
- Then existing: `buildSentenceCandidates` → CrossPath → KenLM

**Does not re-enter:** ASR, Model2, Domain Vote, Model3 (after retry).

---

## 12. B5–B18 Recompute / Reuse Matrix

| Stage | Recomputed on RETRY? | Reused? | Modified? | Evidence |
|-------|----------------------|---------|-----------|----------|
| B5 FineSpan (first-pass) | NO (as Model3 input) | YES | NO (region may resegment **locally** for Stage2 queries only) | router/resegment |
| B6 WindowQuery | PARTIAL — Stage2 legal windows only inside region | first-pass windows reused outside region | YES in region | `enumerateStage2SuccessPathQueryLocals` |
| B7 CanonicalRecallQuery | Stage2 recall queries yes | first-pass no | YES in region | `recallSpanTopKV2` Stage2 |
| B8 Base SQL | via existing recall API | lexicon unchanged | NO schema | reuse Recall |
| B9 Base materialization | Stage2 hits materialize `m3r:*` | outside region YES | YES in region | router materialize |
| B10 Model2 input | NO | YES | NO | orchestrator: Model2 once pre-edge |
| B11 Model2 output | NO | YES | NO | no second Model2 |
| B12 LexicalEdge | NO rebuild of full lattice edge set | YES | region candidates only | no lattice re-run for whole path |
| B13 Path PreCap | NO | YES | NO | path identity preserved |
| B14 Path PostCap | NO path rebuild | YES | candidate contents may change | mutated pool |
| B15 Domain Vote / SameDomain / Assembly | Vote NO; Assembly YES | vote frozen | Assembly from refreshed pool | `completeDomainAwareAssemblyFromVote` |
| B16 Global Sentence Pool / KenLM | YES (post-retry pool) | — | YES | orchestrator + `runFwSentenceRerankFromPrefilled` |
| B17 Model3 | once per path **before** retry complete; **not** again | — | decisions fixed | `model3Reinvoked: false` |
| B18 Final | YES if KenLM/Apply sees changed pool | — | **can** | v4-path Apply |

---

## 13. Anchor Preservation

| Check | Result | Evidence |
|-------|--------|----------|
| Anchor representation | `Model3AnchorMark` source=`MODEL2` only (ACP Domain Authority) | `model3-anchor-adapter.ts` |
| RETRY can modify Anchor | NO — masked to KEEP; eligible=false | `maskAnchorDecisions` |
| Repair restricted to non-Anchor | YES | deriveRetryRegions skips anchors; merge broken by KEEP/Anchor |
| Path rebuild loses Anchor | NO path rebuild; vote/anchors snapshotted; mutation counter | `anchor_mutation_violations` |
| Domain/SameDomain as Anchor | Forbidden by ACP; Domain Vote ≠ Anchor | anchor contract / ACP |

No Production path found that replaces Anchor identity because of RETRY without Frozen authorization.

---

## 14. Path / Domain Independence

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Path-local Model3 + vote | PRESERVED | per-path loop in orchestrator |
| No second Domain Vote on retry | PRESERVED | `secondDomainVote: false`; same vote object |
| No Domain → Segmentation feedback | PRESERVED | no FineSpan rebuild from domain |
| Cross-path bucket merge only at sentence pool | PRESERVED | `mergeCrossPathSentenceCandidates` after per-path Assembly |
| Stage2 uses path `retainedDomains` | PRESERVED | ACP Stage2 tone-relax + `domainIds: retainedDomains` |

No evidence RETRY collapses independent path domain hypotheses into one global domain before Assembly.

---

## 15. KenLM Relationship

| Question | Answer |
|----------|--------|
| Model3 receives KenLM-selected candidate? | **NO** — Model3 runs before KenLM |
| RETRY causes KenLM rescoring? | **YES** — post-retry sentence pool is KenLM-scored once |
| Model3 language-scores itself? | **NO** |
| Model3 bypasses KenLM for Final? | **NO** — Final still via KenLM/Apply path |
| Separate local KenLM as trigger? | **NO** |

**TRIGGER SCORING:** Model3 logits only.  
**FINAL CANDIDATE SELECTION:** KenLM (existing) over Assembly pool that may include retry candidates.

---

## 16. Loop / Termination Analysis

```text
MODEL3_REENTRY_ALLOWED = NO
MAX_RETRY = 1 cycle per path retry subchain (SSOT: ≤1 retry cycle / utterance intent)
TERMINATION_GUARD =
  - model3Reinvoked hard-coded false in region trace
  - attemptedSpanIds / recursiveRetryViolations counter
  - no call back into runModel3PathStep from router
  - Architecture: “After retry: one Assembly + one KenLM. No Model3 recursion.”
INFINITE_LOOP_RISK = NO (static graph: Model3 → Retry → Assembly → KenLM → end)
```

**Note:** Model3 may run **once per SegmentationPath** (path-local), which is accepted wiring; that is **not** post-RETRY re-entry.

**Trigger Gate** (SSOT optional skip of Model3 inference): `FROZEN_DECISION` exists in `model3_retry_contract_v1.md`, but **no named Production `triggerGate` implementation found** — Model3 path-step always invoked when orchestrator reaches it. Classified as minor MATCH gap, not missing RETRY consumer.

---

## 17. Final Output Ownership

| Path | B18 producer | B18 source candidate |
|------|--------------|----------------------|
| KEEP | `runFwDetectorV4Path` Apply after KenLM | Assembly/KenLM pick from **pre-retry** pool (plus cross-path merge) |
| RETRY | **same** Apply after KenLM | Assembly/KenLM pick from pool that **may include** Stage2 `m3r:*` candidates |

```text
MODEL3_CURRENTLY_HAS_NO_FINAL_OUTPUT_EFFECT = NO
```

Model3 does not write Final text; it can **change inputs** to Assembly/KenLM, which can change B18.

Causal chain when effect occurs:

```text
RETRY → mutated candidates → refreshed Assembly → new sentence pool → KenLM pick changes → Apply → B18
```

---

## 18. Capture V2 B17 Observability

B17 payload (from `run-model3-path-step.ts` Capture hook), per path:

| State | Status |
|-------|--------|
| MODEL3_TRIGGER_INPUT | CAPTURED (inference_input_trace; floats stripped in Replay comparator) |
| MODEL3_TRIGGER_OUTPUT | CAPTURED (`decisions`) |
| ANCHORS | CAPTURED |
| KEEP_RETRY_DECISION | CAPTURED |
| RETRY_TARGET | PARTIAL (`retry_regions` with coords / sourceSpanIds) |
| REPAIR_EXECUTION | PARTIAL (`retry_regions`: recallCandidatesReturned, resegmentOk, surfaces; full hit lists only under extra env traces) |
| REPAIR_RESULT | PARTIAL (region budget/counts; not full post-merge candidate set in B17) |
| POST_REPAIR_SELECTION | NOT_CAPTURED in B17 (lives in B16/B18 separately) |

**Critical:** B17 proves **“Model3 decided RETRY”** and **region-level repair attempt metadata**.  
B17 alone does **not** prove **“RETRY changed B18”**.

---

## 19. B17 → B18 Causal Evidence

| Flag | Value |
|------|-------|
| B17_DECISION_OBSERVABLE | YES |
| RETRY_CONSUMPTION_OBSERVABLE | PARTIAL (retry_regions + diagnostics; not a first-class Capture “consumed=true” edge) |
| REPAIR_EXECUTION_OBSERVABLE | PARTIAL |
| POST_REPAIR_CANDIDATE_OBSERVABLE | NO in B17; may appear indirectly in B16 pool if Capture includes post-retry pool |
| B18_CAUSAL_LINK_OBSERVABLE | **NO** |

**Classification:** **OBSERVABILITY GAP** (Production closure exists; Capture does not link RETRY→Final causally).  
Not FUNCTIONAL GAP for consumer existence.

---

## 20. Test Coverage

| Category | Status | Evidence |
|----------|--------|----------|
| TRIGGER_ONLY_TEST | PRESENT | feature-contract KEEP/RETRY labels; inference client |
| OUTPUT_SCHEMA_TEST | PRESENT | `model3-types` / feature-contract tests |
| RETRY_CONSUMER_TEST | PRESENT | `model3-mainline.integration.test.ts` E–H, router tests |
| LOCAL_REPAIR_TEST | PRESENT | retry-region / resegment / Stage2 window tests; controlled-validation |
| END_TO_END_RETRY_TO_FINAL_TEST | PARTIAL | controlled-validation traces pool→assembly; full KenLM→B18 causal A/B mainly via acceptance harnesses / causal fork — not a single Capture-linked B17→B18 unit |
| LOOP_TERMINATION_TEST | PARTIAL | recursive/anchor rejection tests; no infinite-loop soak |
| ANCHOR_PRESERVATION_TEST | PRESENT | Anchor RETRY rejected; ACP anchor tests |
| PATH_INDEPENDENCE_TEST | PARTIAL | vote-once / path-local wiring; dedicated cross-path RETRY isolation less explicit |

**Critical distinction honored:** tests that only assert Model3 returns RETRY ≠ tests that assert pool mutation / Assembly refresh (latter exist).

---

## 21. Frozen Designed Closure Graph

```text
Audio → ASR → FineSpan / first-pass Recall → Model2 → LexicalEdge → Paths
  → Domain Vote / SameDomain (ONCE per path)
  → Anchor Adapter
  → Model3 KEEP|RETRY (non-anchor only)
       ├─ KEEP → Assembly (existing pool) → CrossPath ≤16 → KenLM (once) → Apply → B18
       └─ RETRY → [one] bounded region reseg + existing Recall Stage2
                → refresh pool (Anchor preserved; vote frozen)
                → Assembly → CrossPath ≤16 → KenLM (once) → Apply → B18
  → NO Model3 recursion
  → NO second Domain Vote / second ASR / second mainline

[UNRESOLVED BY FROZEN SSOT — minor]
  Exact Production wiring of optional Trigger Gate skip (contract mentions; code always invokes path-step)
```

---

## 22. Current Implemented Closure Graph

```text
runJobPipeline
  → runFwDetectorStep → runFwDetectorOrchestrator → runFwDetectorV4Path
    → runSpanAssemblyV4Orchestrator
         → lattice FineSpan + Model2 (once, pre-LexicalEdge)
         → per path:
              prepareModel3PathUpstream (vote + anchors + infer)
              completeModel3PathFromUpstream
                   decisions → routeModel3Retry
                        KEEP: mutated=false
                        RETRY: region → reseg → recallSpanTopKV2 (tone-relax mode)
                               → merge candidates → mutated=true
                   → completeDomainAwareAssemblyFromVote(same vote)
                   → buildSentenceCandidates
         → mergeCrossPathSentenceCandidates
    → runFwSentenceRerankFromPrefilled (KenLM)
    → applyFwSpanReplacements → finalPostprocessText (B18)
```

---

## 23. Designed vs Implemented Delta

| Node | Status |
|------|--------|
| Model3 role KEEP/RETRY only | MATCH |
| RETRY consumer = bounded local repair | MATCH |
| Reuse Recall / Assembly / KenLM | MATCH |
| Vote once / Anchor protect | MATCH |
| No Model3 after retry | MATCH |
| KenLM after repair once | MATCH |
| Stage2 tone-relax ACP | MATCH |
| Production Retry enabled | MATCH (V2 SSOT; matrix CSV stale) |
| Optional Trigger Gate | MISSING / DRIFTED (always run path-step) |
| B17→B18 causal Capture edge | MISSING (observability) |
| ≤1 Model3 / utterance vs per-path | ACCEPTED path-local wiring (documented ambiguity in input contract) |

---

## 24. Failure Classification

| Finding | Taxonomy |
|---------|----------|
| RETRY consumer complete | — (not a failure) |
| B17 lacks B18 causal link | **OBSERVABILITY GAP** |
| Trigger Gate not implemented as named gate | **ARCHITECTURE GAP / CONFLICT** (minor; does not remove consumer) |
| dialog_200 historical RETRY≈0 / KEEP bias | **DATA / TRAINING FAILURE** (not missing consumer; prior audits) |
| Replay V2 200/200 | Expected engineering equivalence — **not** Model3 effectiveness proof |

---

## 25. Stable Engineering Freeze Impact

```text
CAN_CURRENT_ASR_POSTPROCESSING_BE_FROZEN_WITH_MODEL3_DECLARED_COMPLETE = YES
CAN_CURRENT_ASR_POSTPROCESSING_BE_FROZEN_IF_MODEL3_IS_DECLARED_TRIGGER_ONLY = N/A
  (factually incorrect declaration — Model3 is not trigger-only)
MODEL3_CLOSURE_BLOCKS_STABLE_ENGINEERING_FREEZE = NO
```

**Facts:** Frozen design requires repair closure; Production implements it. Declaring Model3 “complete” for **engineering closure** is consistent with code+SSOT.

**Do not confuse:** low real-world RETRY rate / correction quality = training/data effectiveness, **not** closure blocker.

---

## 26. Missing Contracts / Components / Tests

| Kind | Item |
|------|------|
| MISSING_CONTRACTS | None for core RETRY closure; Trigger Gate Production contract vs code alignment under-specified |
| MISSING_COMPONENTS | None for RETRY consumer |
| MISSING_CONSUMERS | None |
| MISSING_OBSERVABILITY | Explicit B17→repair-result→B18 causal Capture link; always-on post-retry candidate provenance in Capture |
| MISSING_TESTS | Strong Capture-linked END_TO_END_RETRY_TO_FINAL proving B18 text change under injected RETRY (partial only) |

**No fix / no new architecture in this audit.**

---

## 27. Final Classification

```text
PRIMARY_CLASSIFICATION =
A — COMPLETE_AND_FROZEN_COMPLIANT

RESULT_ENUM =
A — COMPLETE_AND_FROZEN_COMPLIANT

STABLE_ENGINEERING_FREEZE_BLOCKED = NO
NEXT_OWNER =
LINGUA_ASR_POSTPROCESSING_STABLE_ENGINEERING_FREEZE
```

**One-sentence verdict:** Model3 RETRY has a real Production consumer that performs bounded local repair, rejoins the existing Assembly→KenLM main chain, and can change B18; Capture does not yet prove that causal edge by itself.

---

## Appendix — Key source anchors

- `MODEL3_ARCHITECTURE_CONTRACT_V1.md` §1–5, Retry ACTIVE
- `model3_retry_contract_v1.md` RETRY meaning + flow
- `LINGUA_ACP_MODEL3_RETRY_STAGE2_TONE_RELAXATION_V1.md` Stage2 mode
- `run-model3-path-step.ts` prepare/complete + B17 capture
- `model3-retry-router.ts` mutation / termination
- `span-assembly-v4-orchestrator.ts` Model3 → Assembly → sentence candidates
- `fw-detector-v4-path.ts` KenLM + Final Apply

**PRODUCTION_CODE_CHANGED = NO · TEST_CODE_CHANGED = NO · MODEL_CHANGED = NO · LEXICON_CHANGED = NO**

STOP.
