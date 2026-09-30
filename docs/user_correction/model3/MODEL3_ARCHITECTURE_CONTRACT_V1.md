# MODEL3 Architecture Contract V1

**Status:** FROZEN (contract design) · **Synthetic model:** `MODEL3_SYNTHETIC_V1_FROZEN` (2026-08-26)  
**Role correction:** 2026-08-26 — text-only (`MODEL3_V1_TEXT_ONLY_ROLE_FREEZE_CORRECTION`)  
**Effective:** 2026-08-23 · Seal: `MODEL3_SYNTHETIC_V1_ACCEPTANCE_SEAL.json`  
**Authority:** CODE_REALITY + Pre-Development Architecture Audit 2026-08-23 + Synthetic V1 freeze + text-only role correction 2026-08-26

### Model3 V2 freeze + runtime default promotion (2026-09-08)

| Field | Value |
| ----- | ----- |
| Phase | `MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA` |
| Status | `MODEL3_V2 = FROZEN` · `MODEL3_DEVELOPMENT_PHASE = CLOSED` |
| `AUTHORITATIVE_MODEL_ARTIFACT` | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| `RUNTIME_DEFAULT_MODEL` | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| `EXPLICIT_ROLLBACK_MODEL` | `MODEL3_SYNTHETIC_V1` (env only) |
| Weights SHA256 | `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1` |
| Config SHA256 | `8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221` |
| Dataset / build | `MODEL3_V2_PRODUCTION_CORE_S3` / `prod_core_s3_build_20260830_v1` |
| Seed | `2026083013` |
| `PRODUCTION_RETRY_ENABLED` | **YES** · `MODEL3_RETRY_SUBCHAIN = ACTIVE + FROZEN` |
| A1 class-weight | **REJECTED / NON-PROMOTED** |
| Load failure | **FAIL_CLOSED** (no silent Synthetic fallback) |
| Manifest | `model3_v2_freeze_manifest.json` · promotion: `model3_v2_runtime_promotion_acceptance.json` |
| SSOT index | `Model3_V2_Frozen_Architecture_SSOT.md` |

Any change to Model3 input ownership, KEEP/RETRY-only output, Anchor semantics, or Retry barriers after this seal requires `ARCHITECTURE_CHANGE_PROPOSAL` + user approval. Reopen Model3 only with `PROVEN_MODEL3_OWNED_BREAKPOINT`.

**Companion contracts:**  
`model3_anchor_contract_v1.md` · `model3_input_contract_v1.md` · `model3_output_contract_v1.md` · `model3_retry_contract_v1.md` · `model3_retry_trace_v1_contract.md` · `model3_training_label_contract_v1.md` · `MODEL3_SYNTHETIC_V1_FROZEN.md` · `Model3_V2_Frozen_Architecture_SSOT.md`

---

## 1. Role (frozen — text-only)

**Model3 = Anchor-Conditioned Text Repair Trigger**  
(also: **Anchor-Conditioned Span Retry Trigger**)

**Input modality:** `TEXT_ONLY` — ASR-derived span text + upstream Anchor mask.  
**Not** an acoustic model. No raw audio, FW timestamps, or acoustic Tone tensors as Model3 inputs.

Model3 answers only:

> Given an upstream-anchored FineSpan sequence (post-ASR text), which **non-anchor** spans should receive **one bounded local Lexicon Recall retry**?

**Output:** `KEEP` | `RETRY` per eligible non-anchor span.

`RETRY` means: request **one** bounded local re-recall — not corrected text, not candidates, not domain, not Anchor, not final sentence.

Model3 is **selective**: lightweight decision always; expensive re-recall **only** on `RETRY`.

---

## 2. Insertion point (frozen)

```text
Audio
  → ASR
  → ASR raw text
  → existing post-ASR FineSpan / Recall processing
  → Domain Vote / SameDomain + Model2 user-conditioned recall
  → Anchor spans marked
  → Model3 KEEP/RETRY for NON-ANCHOR spans
  → on RETRY: ONE bounded local re-segmentation + re-recall (Anchor preserved; reuse existing Recall)
  → Assembly → CrossPath ≤16 → KenLM (once) → Apply → JobResult
```

Runtime detail (unchanged ownership):

```text
… → Compatibility → Model2 P/D → Domain Vote → SameDomain
→ Anchor Adapter + Model3 (KEEP/RETRY) + frozen Retry subchain when RETRY
→ Assembly → CrossPath ≤16 → KenLM (once) → Apply → JobResult
```

- Path-local hook: after `runDomainAwareAssembly`, before `buildSentenceCandidates`.
- **Before first KenLM.** Trigger must not use KenLM scores.
- After retry (if any): **one** Assembly + **one** KenLM. No Model3 recursion.
- Model3 does **not** create a second post-ASR pipeline.

### Production Retry runtime SSOT (ACTIVE)

```text
PRODUCTION_RETRY_ENABLED = YES
MODEL3_RETRY_SUBCHAIN = ACTIVE + FROZEN
```

Model3 inference is active in the normal Electron runtime (default checkpoint = `MODEL3_V2_S3_RANDOM_INIT_V1`).

When Model3 emits `RETRY` for a legal non-anchor target, the frozen Retry subchain executes **one** bounded local reinterpretation / re-recall cycle.

Retry **MUST NOT**: rerun ASR · reinvoke Model3 · second Domain Vote · cross Anchor · create a second repair mainline.

~~Production RETRY remains OFF until a separate enablement gate~~ — **SUPERSEDED** (historical; removed from active SSOT 2026-09-08).

---

## 3. Hard prohibitions

Model3 **MUST NOT**:

| Forbidden | Rationale |
|-----------|-----------|
| Consume audio / FW timestamps / acoustic Tone tensors | Text-only role |
| Discover / mutate / re-score / remove Anchors | Upstream ownership |
| Promote non-anchor → Anchor | Upstream ownership |
| Select or re-vote Domain | Domain Vote SSOT |
| Generate text / replacements / candidates | Not a corrector |
| Query Lexicon / run Recall / Assembly / KenLM | Not ownership (RETRY only *requests* re-recall) |
| Change candidate budget / Model2 / Single-Char V1 | Frozen neighbors |
| Parse full `UserProfileV1` business semantics | Model2 owns profile |
| Act as final judge or local KenLM | Role collapse |
| Per-span Model3 inference loops | Max 1 inference / triggered utterance |
| Recursive retry / full utterance reprocess / second ASR | Max 1 bounded local retry cycle |
| Require TTS as a Model3 training stage | Role correction 2026-08-26 |

Violating role → **ROLE_DRIFT** / ACP required.

---

## 4. Neighbor ownership (unchanged)

| Module | Ownership |
|--------|-----------|
| Lexicon Recall | `recallSpanTopKV2` / `recallTopKForWindows` — **owns** re-recall, tone relaxation, pronunciation confusion |
| Model2 | **P/D ONLY** · Model2 Anchor source |
| Domain Vote / SameDomain | Presence vote · retained buckets · Assembly domain organization (**not** Model3 Anchor source; ACP Domain Evidence Authority V1) |
| Tone module | Upstream acoustic tone for Recall ranking — **not** Model3 input |
| Assembly | Enumeration |
| CrossPath | Merge · ≤16 |
| KenLM | Sentence language score / rank / pick |
| Single-Char Repair V1 | CLOSED · length-1 unique/fail-closed |
| JobResult | Cross-service transport — **no Model3 fields by default** |

---

## 5. Limits (frozen)

| Limit | Value |
|-------|-------|
| Model3 invocations / utterance | ≤ 1 |
| Retry cycles / utterance | ≤ 1 |
| Sentence candidate cap | ≤ 16 (single pool after retry) |
| Anchor RETRY | FORBIDDEN (runtime mask) |
| Second Recall pipeline | FORBIDDEN — reuse existing Recall |
| Second ASR | FORBIDDEN |

---

## 6. Role-collapse guard (text-only)

Model3 **must** remain Anchor-conditioned KEEP/RETRY. It must **not** become:

- a sentence language model / local KenLM substitute  
- a text generator / corrector  
- an acoustic / Tone classifier  

```text
MODEL3_ROLE_COLLAPSE_TO_LOCAL_LM = FAIL
MODEL3_ROLE_DRIFT_TO_ACOUSTIC_MODEL = FAIL
```

Anchor conditioning + Strict Pair causality are the intended anti-collapse signals for Synthetic V1 — **not** acoustic feature channels.

---

## 7. Development stages

1. Anchor + provenance + trace — **zero behavior change**  
2. Offline labels  
3. Offline baseline training  
4. Generalization acceptance  
5. Freeze — **Synthetic V1 complete** (`MODEL3_SYNTHETIC_V1_FROZEN`)  
6. Runtime text pipeline integration + V2 S3 training / Retry deltas  
7. Causal effectiveness audit — **PASS / downstream-blocked**  
8. **Model3 V2 final acceptance and freeze** — **COMPLETE** (`MODEL3_V2_FREEZE_20260907_V1`)  
9. **Runtime default promotion** — **COMPLETE** (`MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA` 2026-09-08): S3 = RUNTIME_DEFAULT; Synthetic = explicit rollback; Retry ACTIVE+FROZEN  
10. Downstream: full ASR postprocess pipeline quality acceptance (outside Model3 development)  
11. Model3 reopen — **only** with proven Model3-owned breakpoint + ACP  

~~TTS-ASR Model3 pilot as default next stage~~ — **REJECTED** (role correction 2026-08-26).  
~~Continue Model3 retrain for dialog_200 final=0~~ — **REJECTED** (causal audit 2026-09-07).  
~~Production RETRY remains OFF until enablement gate~~ — **SUPERSEDED** (Retry ACTIVE 2026-09-08 SSOT).

---

## 8. ACP triggers

Any future request for Model3 to:

- consume audio / FW timestamps / acoustic Tone tensors  
- generate text, change Anchor/Domain, own Recall, recurse, or replace KenLM  
- require TTS as a Model3 training modality  
- expand output beyond `KEEP` / `RETRY`  
- reopen Delta1/Delta2 Retry geometry without proven architecture defect  
- raise candidate cap to chase Model3 final utility  

requires a **new Architecture Change Proposal + user approval**.
