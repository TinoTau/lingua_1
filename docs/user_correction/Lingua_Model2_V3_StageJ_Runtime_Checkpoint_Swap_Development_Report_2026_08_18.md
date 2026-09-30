# Lingua Model2 V3 — Stage J Runtime Checkpoint Swap
# Development Report
# Date: 2026-08-18

**Stage:** `MODEL2_V3_STAGE_J_RUNTIME_CHECKPOINT_SWAP_AND_DIALOG200_ACCEPTANCE`  
**NO TRAINING. NO TUNING. NO ARCHITECTURE CHANGE.**

**Runtime Integration: HOLD**  
**Reason:** Stage-J ONE Model2 已接入现有主链 sidecar，契约 / 检索 parity / Node P e2e 通过；**dialog_200 真实 Node ASR 主链未执行**（test server `:5020` 未启动）。不得把加载成功写成产品验收 PASS。

---

## What was swapped

| Field | Value |
|-------|--------|
| Checkpoint | `training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt` |
| sha256 | `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda` |
| Params | 47210 |
| Architecture | `RetrievalPolicyV3(with_domain_head=True)` |
| Feature pack | `MODEL2_FEATURE_HASH_V1` (`feature_hash="v1"`) |
| Previous default | Stage-P-only `v3_phase3_stage_p/training/stage_p_checkpoint.pt` |

Identity is **explicit path + expected sha256**. No latest glob. No Stage-P fallback on mismatch. Hash mismatch → fail-fast → base ASR post-process continues.

---

## Product path (unchanged skeleton)

```
Session UserProfile
  → FineSpan
  → ONE frozen Stage-J Model2   (one forward)
  → P actions + D action / domain_none
  → P: existing Node relation → LexiconRuntimeV2 recall
  → D: sidecar execute_domain_action (restored domain-conditioned FuzzyPool)
  → UNION unchanged base → termId merge
  → DomainAwareAssembly
  → KenLM
```

FineSpan / UserProfile semantics / Assembly / KenLM / Tone / candidate cap / Feature Hash contract were **not** redesigned.

---

## ONE model / ONE inference

Sidecar loads a single `RetrievalPolicyV3(with_domain_head=True)`.

Each FineSpan policy step:

1. `pack_batch_inputs(..., feature_hash="v1")` with phonetic + `personal_terms` + `long_term_domain_evidence`
2. **one** `forward`
3. P top-1 (query_budget=1) + D argmax (including `domain_none`)

Removed Stage-P external gate: `if empty phonetic: skip Model2`. Empty / missing profile still runs the model. `domain_none` is a model output, not `if empty: skip domain`.

---

## Domain executor

Runtime D uses the **same** Python `execute_domain_action` as train/eval (shared-contract adapter inside the existing sidecar). Not a second FuzzyPool. Not `queryDomainMultiRowsAtomic`.

Node only **materializes** returned surfaces / ids into `WindowCandidate` (`PROFILE_DOMAIN`). Exact SQL remains exact lookup for the rest of LexiconRuntime — it is not a Model2 D recall branch.

Parity (sidecar vs `execute_domain_action` on training index, n=48 val): **48/48**.

---

## Contracts (fail-fast)

| Contract | Result |
|----------|--------|
| MODEL2_FEATURE_HASH_V1 | PASS |
| StageDProfileContractV1 | PASS |
| StageD Retrieval Contract | PASS |
| Train / Runtime Retrieval Parity | PASS |
| StageDRetrievalTargetIdentityV1 | PASS |
| with_domain_head / 13 D slots / 47210 params | PASS |
| Silent reshape / default feature | NO |

---

## Node P runtime regression

Existing PROFILE_TARGET_ABSENT fixture (real `LexiconRuntimeV2`, 7 relations) re-run on Stage J:

- eligible 22 / introduced **22** (rate 1.0)
- Correct vs Empty vs Wrong: empty **still invokes** Model2; target not introduced on empty; actions differ on wrong profile
- Multi-relation bounded; multi-tag `domains[]`; duplicate termId merge; load/infer fail → base continues
- Sidecar singleton: 100 infers, no per-job respawn

Sidecar hard-multi teacher-top1 slice: 6/7 relations rate 1.0; `h_f` 0.4375. Runtime gate is the Node 22/22 fixture, not this teacher-slice.

---

## Domain E2E (sidecar, training index)

Val Correct n=20: target identity hit **4/20 (0.20)** — consistent with frozen modest D, not a runtime collapse.

Profile counterfactual (same span, only profile): Correct `tourism_route` vs Empty `transport` vs Swapped `meeting`. Profile value **MODERATE**. Empty did **not** always emit `domain_none` — freeze **KNOWN_LIMITATION** (no empty/wrong external gate).

---

## Failure semantics

| Case | Behavior |
|------|----------|
| Checkpoint missing | load fail, base continues |
| sha256 mismatch | fail-fast, no Stage-P load |
| Inference exception | span skipped, base continues |
| Domain index / executor fail | no D expansion, P/base continue |
| MODEL2_RUNTIME_DISABLED=1 | test baseline A only; not a production empty-profile gate |

No shadow Stage-P sidecar. No legacy deterministic Model2 path.

---

## dialog_200

See companion acceptance report. Cases **not** rewritten. Live Node ASR batch **not** executed (server down).

---

## Files touched this round

See `training/model2_v3/experiments/v3_stage_j_runtime_swap/modified_file_inventory.csv`.

Artifacts under `training/model2_v3/experiments/v3_stage_j_runtime_swap/`.

---

## Decision

- Keep Stage-J checkpoint as **runtime active candidate** (swap kept).
- Do **not** declare production quality proven.
- Next: start Node test server + Faster-Whisper, run unmodified `dialog_200` on this host. No training from failures.
