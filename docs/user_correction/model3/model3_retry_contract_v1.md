# Model3 Retry Contract V1

**Status:** FROZEN — mainline integrated; retry-region postprocess correction 2026-08-28  
**Parent:** `MODEL3_ARCHITECTURE_CONTRACT_V1.md`

### Model3 V2 Retry freeze seal (2026-09-08)

| Item | Status |
| ---- | ------ |
| `MODEL3_RETRY_SUBCHAIN` | **ACTIVE + FROZEN** |
| `PRODUCTION_RETRY_ENABLED` | **YES** |
| `DELTA_RQ_STAGE2_NO_SLIDING` | `RESOLVED_ACCEPTED_CLOSED` |
| `DELTA_RQ_FALLBACK_BOUNDARY_LOCK` | `RESOLVED_ACCEPTED_CLOSED` |
| Responsibility acceptance | PASS |
| Reopen Delta1/Delta2 | **FORBIDDEN** without independent architecture evidence + ACP |
| Effectiveness gaps (e.g. QUERY_NOT_REPAIR_CAPABLE) | DEFERRED — not Delta reopen |

When Model3 emits RETRY for a legal non-anchor target, the existing frozen Retry subchain executes one bounded local reinterpretation / re-recall. No ASR rerun, no second Model3, no second Domain Vote, no Anchor cross, no second repair mainline.

See: `model3_v2_freeze_manifest.json` · `Model3_V2_Frozen_Architecture_SSOT.md` · `model3_v2_runtime_promotion_acceptance.json`


---

## RETRY meaning (SSOT)

**RETRY does NOT mean:** recall the current lexical word again at frozen FineSpan boundaries.

**RETRY means:** the current local interpretation is suspicious; ASR postprocess may perform **one bounded local re-segmentation + re-recall** within derived retry region(s).

Model3 itself only emits `KEEP | RETRY` per spanId — no region fields.

---

## Hard limits

| Limit | Value |
|-------|-------|
| Model3 invocations / utterance | ≤ 1 |
| Retry cycles / utterance | ≤ 1 |
| Sentence candidate pool | ≤ 16 after merge (single pool; **not** 16+16) |
| Domain re-vote | FORBIDDEN |
| Anchor mutation during retry | FORBIDDEN |
| Model3 after retry | FORBIDDEN (no recursion) |
| Second Recall pipeline | FORBIDDEN |

---

## Flow (Engine Stable V1 — current)

```text
FIRST PASS (Recall → … → SameDomain / anchors)
→ Model3 path-step when orchestration reaches it (KEEP | RETRY)
→ optional RETRY: one bounded region re-segmentation + re-recall
→ Assembly (existing, same frozen path vote)
→ CrossPath merge ≤16
→ KenLM (ONE final pass)
→ Apply
```

Trigger Gate is **not** a current Production requirement. See historical note below.

---

## Trigger Gate (V1) — SUPERSEDED

**Status:** `HISTORICAL / SUPERSEDED` (Engine Stable V1, classification A — SSOT_STALE).

This section is Stage1 design history. It is **not** an active requirement to skip Model3 inference.

Current Production (Model3 V2 runtime, `PRODUCTION_RETRY_ENABLED = YES`):

- Model3 path-step runs when orchestration reaches it.
- Anchor mask + `KEEP` | `RETRY` remain authoritative.
- RETRY repair stays one bounded non-recursive cycle.
- Do **not** add a new Trigger Gate to match this historical text.

Historical Stage1 text (not active):

**Purpose:** “Is this utterance worth one Model3 inference?” — **not** suspicious-span finding.

**Deterministic boolean** — no weighted / learned score.

**Minimum (historical, not required):**

```text
hasAnchor == true
AND hasEligibleNonAnchorTarget == true
```

**Optional acoustic/repair signal (historical Stage1):**

Any of:

- Tone readiness not ready / acoustic tone mismatch on a non-anchor target
- Length-1 fail-closed / ambiguity diagnostic adjacent to anchors
- Model2 pronunciation actions present on utterance with unrepaired non-anchor span

**Forbidden as trigger (still forbidden if any future gate is proposed):**

- KenLM score / margin
- Weighted suspicion stacks
- Old `detectSuspiciousSpansV1` / shadow beam

Historical behavior if gate false: Model3 not invoked; proceed to Assembly/KenLM. **Not current Production.**

---

## Retry target

```text
isAnchor == false
AND Model3.action == RETRY
AND targetMask == 1
```

---

## Recall ownership (reuse)

Call existing APIs only:

- `recallSpanTopKV2`
- and/or `recallTopKForWindows(subset)`
- utterance recall cache for unchanged keys

**No** `Model3Recall` / `RetryRecallService` / second pipeline.

---

## Search scope (business intent)

| Capability | Status |
|------------|--------|
| Bound to `vote.retainedDomains` + SameDomain preference | ALREADY_SUPPORTED (reuse retained set) |
| Base lexicon | ALREADY_SUPPORTED |
| Tone gates / tone evidence on recall | **SUPERSEDED_BY** `LINGUA-ACP-MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1` / freeze `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1` — first-pass = `tone_exact` Fail Closed; Model3 RETRY Stage2 only = `model3_retry_pinyin_domain_recovery`. Historical note: PARTIALLY_SUPPORTED / Stage6 language is obsolete for Stage2. |
| Model2 pronunciation relation re-query | PARTIALLY_SUPPORTED (via existing P materialize; not Model3-owned) |
| Bounded per-span / global caps | ALREADY_SUPPORTED |

If `retainedDomains.length > 1`: **keep the set**; Model3 does not pick one.

---

## Anchor immutability

Re-recall may replace candidates **only** for RETRY spans. Anchor candidates retained as-is.

---

## Assembly / KenLM

- Reuse existing Assembly (`runDomainAwareAssembly` / `buildSentenceCandidates` as needed).
- **One** final KenLM via `runFwSentenceRerankFromPrefilled`.
- Model3 is **not** the final judge.

---

## Role vs KenLM

| Module | Question |
|--------|----------|
| Model3 | Is this non-anchor span a **repairable acoustic/pronunciation** site under Anchors? |
| KenLM | Which **sentence** is more natural under language statistics? |
