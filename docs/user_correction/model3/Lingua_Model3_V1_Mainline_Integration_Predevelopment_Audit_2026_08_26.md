# Lingua Model3 V1 Mainline Integration Predevelopment Audit

**Date:** 2026-08-26  
**Phase:** `MODEL3_V1_MAINLINE_INTEGRATION_PREDEVELOPMENT_AUDIT`  
**Mode:** READ-ONLY — no runtime change · no Model3 wire · no retrain  
**Verdict:** `READY_WITH_GAPS`

---

## 1. Executive summary

Frozen `MODEL3_SYNTHETIC_V1` (text-only, Anchor-conditioned KEEP/RETRY) can integrate into the **existing unique V4 post-ASR mainline** at a single, natural checkpoint **after Model2 expansion and before Domain Vote / Assembly**. Production code today has **zero Model3 runtime**, **zero shadow/dual pipeline**, and **zero bounded local re-recall loop** — Model3 RETRY will be net-new behavior reusing `recallSpanTopKV2`.

Integration model: **direct mainline modification** with **`MODEL3_V1_MAINLINE_INTEGRATION` rollback manifest** — no permanent feature flags, no shadow branch.

Blocking gaps are engineering (anchor adapter, Model3 loader sidecar, retry-once guard, multi-RETRY policy), not architecture conflict.

---

## 2. Current mainline (code truth)

Entry: `JobProcessor.processJob` → `InferenceService.processJob` → `runJobPipeline`.

| Stage | File | Function | Owner |
|-------|------|----------|-------|
| ASR | `pipeline/steps/asr-step.ts` | `runAsrStep` | pipeline |
| FW inject | `fw-detector/pipeline-mode-fw.ts` | `applyFwDetectorPipelineMode` | fw-detector |
| FW step | `pipeline/steps/fw-detector-step.ts` | `runFwDetectorStep` | fw-detector |
| Orchestrator | `fw-detector/fw-detector-orchestrator.ts` | `runFwDetectorOrchestrator` | fw-detector |
| V4 path | `fw-detector/fw-detector-v4-path.ts` | `runFwDetectorV4Path` | fw-detector |
| **Span assembly** | `fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` | `runSpanAssemblyV4Orchestrator` | span-assembly-v4 |
| Lattice + 1st recall | `lattice-fine-span-runtime.ts` + `recall-topk-for-windows.ts` | `runLatticeFineSpanGeneration`, `recallTopKForWindows` | span-assembly-v4 + lexicon-v2 |
| Compatibility | `candidate-compatibility-graph.ts` | `resolveCompatibilityRelations` | span-assembly-v4 |
| Model2 | `model2-runtime/expand-active-candidates.ts` | `expandActiveCandidatesWithModel2` | model2-runtime |
| Domain Vote + Assembly | `assemble-domain-aware-span-sets.ts` | `runDomainAwareAssembly` | span-assembly-v4 |
| Sentence enum | `build-sentence-candidates.ts` | `buildSentenceCandidates` | fw-detector |
| Cross-path ≤16 | `merge-cross-path-sentence-candidates.ts` | `mergeCrossPathSentenceCandidates` | span-assembly-v4 |
| KenLM | `kenlm/run-fw-sentence-rerank-from-prefilled.ts` | `runFwSentenceRerankFromPrefilled` | fw-detector |
| Apply | `apply-span-replacements.ts` | `applyFwSpanReplacements` | fw-detector |
| JobResult | `pipeline/result-builder-fw.ts` | `buildFwJobResult` | pipeline |

Per-path loop inside orchestrator (L279–497): Tone context → Compatibility → **Model2** → **Domain Vote/Assembly** → per-bucket sentences → global cross-path merge.

---

## 3. Recommended insertion point

| Field | Value |
|-------|-------|
| **File** | `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` |
| **Function** | `runSpanAssemblyV4Orchestrator` |
| **Before** | `runDomainAwareAssembly(activeCandidates, …)` (L394) |
| **After** | `expandActiveCandidatesWithModel2` returns `activeCandidates` (L356–380) |
| **Why** | PathFineSpans materialized (`spanId=fine:${pathId}:${idx}`); Model2 + domain recall candidates present; Domain Vote not yet run; sentence assembly not committed; matches existing Model2 checkpoint comment and Model3 contract design sync (L334, L8). |

Secondary (not preferred): inside `runDomainAwareAssembly` post-vote — splits assembly ownership.

---

## 4. Anchor materialization

### Domain anchor (runtime)

- **Signal:** `WindowCandidate` with `source` ∈ `{domain_term, passive_domain_weak}`, vote-eligible, `!isCovered`, domains exclude `general`/`base_term`.
- **Span identity:** `PathFineSpan.spanId` via `buildFineSpanCandidatePool` (`fineSpanId`).
- **Vote output:** `voteUtteranceDomainFromPool` → `retainedDomains`, `domainScores`, `utteranceDomain`.

### Model2 anchor (runtime)

- **Signal:** `retrievalProvenance` ∈ `{PROFILE_RETRIEVAL, PROFILE_PRONUNCIATION, PROFILE_DOMAIN}` on candidate bound to span; `originSpanId` = observation FineSpan.
- **Acceptance:** `materializeProfileHits` / `domainHitBindingStatus === BOUND_TO_ORIGIN_SPAN`.

### Multi-source

Same `spanId` with both domain vote-eligible candidate and Model2 profile candidate → **`DOMAIN_AND_MODEL2`**. Single adapter pass; dedupe by `spanId`.

### Eligibility rule (frozen)

Runtime sources only: `DOMAIN` | `MODEL2` | `DOMAIN_AND_MODEL2`. No parallel identity system — reuse `PathFineSpan.spanId`, `rawStart/rawEnd`, `syllableStart/syllableEnd`.

**Timing:** After Model2 (L380), before Model3 inference. Model3 must not recompute domain/Model2.

**JobResult change for anchors:** **NO** (internal adapter types only).

---

## 5. Model3 input adapter vs allowlist

| Feature | Runtime source | Available | Transform | Leakage |
|---------|----------------|-----------|-----------|---------|
| surface → char tokens | `rawText.slice(span.rawStart, rawEnd)` | YES | char vocab encode | LOW |
| `isAnchor` | anchor adapter from Domain/Model2 signals | PARTIAL | new adapter | LOW |
| `span_len_log1p` | `log1p(len(surface))` | YES | trivial | LOW |
| `span_rel_position` | index / (N−1) in `pathFineSpans` | YES | trivial | LOW |
| `first_pass_cand_log1p` | count non-covered candidates in span pool | YES | from pool | LOW |
| `current_cjk_len_log1p` | CJK count in surface | YES | trivial | LOW |
| `pinyin_channel_avail` | `windowPinyinKey` non-empty on span/candidate | YES | bit only | LOW |

**Training-only fields:** must NOT enter adapter — `referenceText`, `referenceSurface`, `repairability`, labels, provenance.

**Contract satisfaction:** **PARTIAL** until anchor adapter exists; all six features mappable without leakage.

**Invocation:** one Model3 call per path-local `pathFineSpans[]` sequence (not per candidate, not recursive).

---

## 6. Model load

| Item | Finding |
|------|---------|
| Existing BiGRU/Model3 loader | **NONE** in node main src |
| Reusable pattern | **Model2** `inference-host.ts` — singleton Python sidecar, JSONL stdin/stdout, SHA256 checkpoint lock |
| Frozen identity | pointer `training/model3_dataset/model3_v1_synthetic_v1_frozen/POINTER.json`; weights SHA `9d25234a…` |
| Single instance | Model2 uses process-level singleton — **reuse pattern YES** |
| Service placement | New `model3-runtime/` module mirroring `model2-runtime/` + `electron_node/services/model3_runtime/` sidecar |

---

## 7. KEEP path

When Model3 = **KEEP** for all eligible spans:

- `activeCandidates` unchanged → existing `runDomainAwareAssembly` → existing KenLM → existing apply.
- **Extra Recall:** NO.
- **Risk:** inserting Model3 must not mutate `activeCandidates`, reorder compatibility graph, or alter domain priors. Adapter + inference must be read-only on candidate set for KEEP.

---

## 8. RETRY path

**Meaning:** ONE bounded local re-recall for each RETRY non-anchor span (max 1 per span per utterance pass).

**Existing entry point:** `recallSpanTopKV2` (`lexicon-v2/recall-span-topk-v2.ts`), wrapped by `recallTopKForWindows` for window binding.

**Parameters available today:**

- `domainIds` — domain constraint (from `retainedDomains` if post-vote context passed to retry, or pre-vote recall scope)
- `acousticTonePattern` + `toneCallerEnabled` — upstream Tone (Recall-owned, not Model3 input)
- `topK` / `perSpanLimit` — budget caps
- `profile` — Model2 user profile influence on Recall

**Model3 outputs:** `spanId + RETRY` only. Query construction stays Recall-owned.

**Forbidden:** second ASR, full utterance rerun, recursive Model3, unlimited candidate explosion.

**Gap:** multi-RETRY spans (0/1/N) policy and merge of retry candidates into `activeCandidates` without exceeding per-span budget — must be specified in development.

**Anchor protection:** exclude anchor `spanId` from RETRY targets; retry candidates bind via existing `originSpanId` / window binding; assembly picks must not replace anchor spans (`targetMask=0` equivalent).

---

## 9. Budget

| Limit | Value | Source |
|-------|-------|--------|
| Per-span assembly | 8 / 6 / 4 (by span count) | `per-span-candidate-limit.ts` |
| Global KenLM pool | default **16** | `fw-config.ts` `maxSentenceCandidates` |
| Cross-path | dedup-before-cap ≤16 | `merge-cross-path-sentence-candidates.ts` |
| Lattice recall topK | 2 (2–5 char), 1 (len-1) | `v4-limits.ts` |

Retry candidates must merge into existing pools **within** per-span cap — **fits with GAP** (need explicit merge/dedupe policy).

---

## 10. Assembly & KenLM

Retry hits materialized as `WindowCandidate` (reuse `candidate-materialize.ts` patterns) enter **existing** `runDomainAwareAssembly` → `buildSentenceCandidates` → cross-path merge → KenLM.

**New assembly path required:** NO.  
**Model3-specific assembly/scorer:** FORBIDDEN.

KenLM remains downstream; Model3 does not replace it.

---

## 11. Types / JobResult

- **Internal types needed:** `Model3AnchorMark`, `Model3SpanDecision`, `Model3RetryTrace`, `Model3PathDiagnostics`.
- **JobResult default:** **NO new fields** — prefer `FwDetectorResult.spanAssemblyV4` diagnostic extension or internal trace only.
- **Consumer audit:** YES if any cross-service field added later.

No rollback flags in JobResult / business payloads.

---

## 12. Duplicate / conflicting repair logic

| Component | Class |
|-----------|-------|
| V4 `recallTopKForWindows` (1st pass) | ACTIVE_CURRENT |
| `expandActiveCandidatesWithModel2` | ACTIVE_CURRENT |
| KenLM rerank (no second recall) | ACTIVE_CURRENT |
| `detectSuspiciousSpans` (legacy) | LEGACY_DEAD |
| `local-span-recall.ts` / legacy repair steps | LEGACY_DEAD |
| Model3 orchestrator comment | EXPERIMENT_ONLY (design sync) |
| `intent-recovery` global scheduling | NOT_MODEL3_RELATED |

**Conflicting repair paths:** none active; Model3 RETRY is net-new.

---

## 13. Mainline integration policy

| Rule | Status |
|------|--------|
| Shadow mode | **NO** |
| Dual pipeline | **NO** |
| Permanent feature flag branch | **NO** |
| Direct mainline integration | **YES — feasible** |
| Rollback via manifest | **YES — feasible** |

Integration ID: **`MODEL3_V1_MAINLINE_INTEGRATION`**

Rollback removes: Model3 invocation, anchor adapter, retry router, retry-once state, Model3 config, integration-only types — **does NOT delete** frozen checkpoint / training assets.

---

## 14. Traceability

Existing: `SpanAssemblyV4TraceDiagnostics`, `CombinationTrace`, Model2 expand diagnostics, dialog200 path trace (env-gated).

**Gaps for Model3 acceptance:**

- Anchor list (spanId, surface, source)
- Model3 KEEP/RETRY per span
- Retry recall input/output
- Failure category tags (MODEL3_TRIGGER_ERROR, ANCHOR_ERROR, RECALL_NO_RESCUE, etc.)

Trace must be diagnostic-only (no business output change).

---

## 15. Acceptance design (future)

**Primary metric:** `FINAL_TEXT_IMPROVEMENT` (not Model3 classification F1 alone).

**Required metrics:** Model3 RETRY rate · trigger precision/recall · RETRY spans/utterance · re-recall yield · reference reachability · rescue rate · final text improvement/regression/unchanged · budget violations · latency (Model3, retry path, post-ASR delta).

**dialog_200:** usable as **integration acceptance** (EVAL_ONLY) — 200 cases at `test wav/dialog_200/`; **not** in Model3 training (`dialog200Contamination: 0` in Full100K manifest). Batch via `run-dialog200-timed-batch.mjs`.

**Real ASR traces:** `ctx.rawAsrText`, `extra.raw_asr_text`, FW step outputs; dialog200 WAV + manifest.

**Hard failure → rollback candidate:** final-text regression · retry explosion · budget violation · recursive retry · anchor mutation · latency regression · role drift · no improvement on target repair cases.

Do not preset numeric thresholds without baseline evidence — measure first.

---

## 16. Performance

| Item | Estimate |
|------|----------|
| Frozen Model3 p95 | ~4.55 ms (CPU, synthetic eval) |
| Model2 sidecar | serial per FineSpan — dominant today |
| Local re-recall | one `recallSpanTopKV2` call ≈ fraction of utterance recall (SQLite) |
| Risk | Model3 cheap; **retry path cost dominated by extra Recall SQL** |

Prefer singleton Model3 sidecar (mirror Model2).

---

## 17. Development plan summary

See `model3_v1_mainline_integration_plan.csv` for TARGET / CHECK / FILE / ROLLBACK / ACCEPTANCE rows.

**Safe to develop:** YES (with gaps listed in governance JSON).

**Recommended next phase:** `MODEL3_V1_MAINLINE_INTEGRATION_DEVELOPMENT`

---

## STOP

No runtime modification · no Model3 wire · no Retry implementation · no JobResult change · no Recall/Model2 change · no retrain. Awaiting user review.
