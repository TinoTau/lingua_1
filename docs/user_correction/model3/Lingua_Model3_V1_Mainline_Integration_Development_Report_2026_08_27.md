# Lingua Model3 V1 — Mainline Integration Development Report

**Phase:** `MODEL3_V1_MAINLINE_INTEGRATION_DEVELOPMENT`  
**Date:** 2026-08-27  
**Verdict:** `PASS_WITH_QUALITY_GAPS`

---

## 1. What landed

Direct mainline insertion (no shadow / dual pipeline / permanent `enableModel3` flag):

```
Model2 expand
→ buildFineSpanCandidatePool (pre-retry)
→ voteUtteranceDomainFromPool  (ONCE, frozen)
→ materializeModel3Anchors
→ Model3 KEEP/RETRY (ONE infer / path)
→ routeModel3Retry (max 1 / span; Anchor rejected; recallSpanTopKV2)
→ refresh pool iff candidates mutated
→ completeDomainAwareAssemblyFromVote(postRetryPool, SAME vote)
→ buildSentenceCandidates → CrossPath ≤16 → KenLM → Apply
```

### Code

| Area | Path |
|------|------|
| Vote/assembly boundary | `assemble-domain-aware-span-sets.ts` → `completeDomainAwareAssemblyFromVote` + thin `runDomainAwareAssembly` |
| Orchestrator | `span-assembly-v4-orchestrator.ts` → `runModel3PathStep` |
| Runtime | `main/src/model3-runtime/*` |
| Sidecar | `electron_node/services/model3_runtime/model3_inference_host.py` |
| Tests | `model3-mainline.integration.test.ts` (12/12 PASS) |

### Frozen model

- **ID:** `MODEL3_SYNTHETIC_V1`
- **Checkpoint:** `training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520`
- **Weights SHA256:** `9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815` — **VERIFIED**
- **Config hash:** `f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830` — **VERIFIED**
- Fail-fast on mismatch; **no** silent KEEP-all / alternate checkpoint

---

## 2. Invariants proven (unit)

| ID | Check | Result |
|----|-------|--------|
| A | Losing-vote domain evidence ≠ DOMAIN Anchor | PASS |
| B | Retained-domain → DOMAIN Anchor | PASS |
| C | Model2 PROFILE_* → MODEL2 Anchor | PASS |
| D | Same span → DOMAIN_AND_MODEL2 (single entry) | PASS |
| E | Anchor RETRY rejected (0 recall) | PASS |
| F | Non-anchor RETRY recall ≤1 | PASS |
| G | Multi-RETRY deterministic PathFineSpan order | PASS |
| H | Per-span cap 8/6/4 preserved | PASS |
| I | Global ≤16 unchanged (existing KenLM path) | PASS (contract) |
| J | KEEP-only candidates unchanged; pool not refreshed | PASS |
| K | RETRY mutation → postRetryPool refresh | PASS |
| L | Domain Vote call count = 1 | PASS |
| Hard | Only retained-domain evidence → DOMAIN Anchor | PASS |
| Stale | Rescue candidate visible in postRetryPool; vote identity same | PASS |

---

## 3. dialog_200 acceptance

| Item | Status |
|------|--------|
| Full ASR batch (`run-dialog200-timed-batch.mjs`) | **NOT RUN** — test server `:5020` and ASR not available |
| Model3 host smoke (40 cases / naive char spans) | Ran: load_count=1 singleton; p50≈3.6ms; p95≈5.0ms; hash OK |
| FINAL_TEXT_IMPROVEMENT | **UNAVAILABLE** (needs full pipeline) |
| Trigger / rescue / regression rates | **UNAVAILABLE** |

Primary success metric cannot be scored without live pipeline → quality gap only; architecture integration remains valid.

---

## 4. Performance (Model3 host smoke)

| Metric | Value |
|--------|-------|
| Process singleton load_count | 1 |
| Model3 p50 | ~3.6 ms |
| Model3 p95 | ~5.0 ms |
| Post-ASR delta / retry-path p50–p95 | N/A (no full pipeline) |

---

## 5. Rollback

- Manifest: `MODEL3_V1_MAINLINE_INTEGRATION_ROLLBACK_MANIFEST.json`
- **Auto-rollback:** NO (await user decision)
- **Recommended now:** NO — integrate architecture PASS; run dialog_200 when `:5020`+ASR ready

---

## 6. Governance

- JobResult schema: **unchanged**
- Model retrain: **NO**
- Domain Vote / Model2 / Recall algorithms: **unchanged**
- Report artifacts this phase: **5** (≤10)

---

## 7. Recommended next phase

`MODEL3_V1_DIALOG_200_FULL_PIPELINE_ACCEPTANCE` — run timed dialog_200 on live node; score FINAL_TEXT_IMPROVEMENT / trigger / rescue / regression; then decide keep vs rollback via manifest.
