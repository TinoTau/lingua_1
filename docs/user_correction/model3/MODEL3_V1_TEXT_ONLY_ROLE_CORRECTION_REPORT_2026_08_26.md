# MODEL3 V1 Text-Only Role Correction Report

**Date:** 2026-08-26  
**Phase:** `MODEL3_V1_TEXT_ONLY_ROLE_FREEZE_CORRECTION`  
**Verdict:** `PASS`

---

## 1. Decision

| Item | Ruling |
|------|--------|
| Frozen checkpoint | **VALID** — not wrong |
| Training objective / Strict / Hard KEEP | **VALID** — not wrong |
| Post-freeze interpretation that Model3 should become acoustic / TTS / Tone-input | **REJECTED** (`ROLE_DRIFT_CORRECTED`) |

**Authoritative role:** Anchor-Conditioned **Text** Repair Trigger (Span Retry Trigger).  
**Modality:** `TEXT_ONLY`.

---

## 2. What changed

Documentation / SSOT / roadmap only:

- Role name: Acoustic-Linguistic → **Text** Repair Trigger  
- Pipeline docs: audio→ASR→text→Anchor→Model3→KEEP/RETRY→bounded local re-recall  
- Next phase: TTS pilot → **`MODEL3_V1_RUNTIME_TEXT_PIPELINE_INTEGRATION_AUDIT`**  
- TTS audit marked **`SUPERSEDED_FOR_MODEL3`** (`ROLE_DRIFT_CORRECTED`)  
- Input / feature-mask contracts aligned with allowlist (ACOUSTIC=0)

## 3. What did NOT change

| Artifact | Status |
|----------|--------|
| Checkpoint weights / hash | Unchanged |
| Training config / hash | Unchanged |
| Dataset / manifest hash | Unchanged |
| Acceptance seal file (hashes + metrics) | Unchanged |
| Small BiGRU / allowlist dims | Unchanged |
| Objective / sampling / Strict / Hard KEEP | Unchanged |
| Runtime / Model2 / Recall / Tone code | Unchanged |

Note: seal `nextStageBoundary` still mentions TTS historically; recovery docs treat that wording as non-authoritative. Seal was **not** rewritten (freeze identity preservation).

---

## 4. Acoustic / TTS occurrence classification (authoritative docs)

| Occurrence class | Examples |
|------------------|----------|
| `REMOVE_FROM_CURRENT_ARCHITECTURE` | “Acoustic-Linguistic Repair Trigger”; TTS as default next Model3 phase; Tone→Model3; audio→Model3 |
| `HISTORICAL_PLANNING_ONLY` / `SUPERSEDED_FOR_MODEL3` | `MODEL3_TTS_READINESS_AUDIT_2026_08_26.md`; freeze TTS bundle/governance nextPhase |
| `VALID_UPSTREAM_REFERENCE` | Tone module for Recall; Piper TTS for Model2/ASR experiments |
| `HISTORICAL_EXPERIMENT` | Older phase reports recommending TTS |

Non-Model3 TTS / Tone infrastructure: **not deleted**.

---

## 5. Active code drift audit

| Finding | Class |
|---------|-------|
| `bigru_v1.py` allowlist (6 text/anchor feats) | **NONE** acoustic — authoritative packer |
| Model3 runtime inference module in electron_node | **NONE** (not wired) |
| Tone / `acousticTonePattern` in Recall / FW | **NOT_MODEL3_RELATED** / **VALID_UPSTREAM_REFERENCE** |
| Schema `audioRef` / `acousticEvidence` / `TTS_ASR` enum | **DOCUMENT_ONLY** / provenance — not packed |
| Piper TTS services | **NOT_MODEL3_RELATED** |

**Acoustic Model3 path:** **NONE**  
**Expectation met:** no active acoustic Model3 implementation.

---

## 6. Model-visible input classification (frozen V1)

| Input | Class |
|-------|-------|
| surface char tokens | TEXT_DERIVED |
| `isAnchor` | ANCHOR_DERIVED |
| `span_len_log1p` | TEXT_DERIVED |
| `span_rel_position` | TEXT_DERIVED |
| `first_pass_cand_log1p` | TEXT_DERIVED |
| `current_cjk_len_log1p` | TEXT_DERIVED |
| `pinyin_channel_avail` | TEXT_DERIVED |
| reference / reachability / Tone / audio / FW times | LABEL_ONLY / QA_ONLY / not model-visible |

**ACOUSTIC model-visible count = 0** → hard gate **PASS**.

---

## 7. Next phase scope (define only — not executed)

`MODEL3_V1_RUNTIME_TEXT_PIPELINE_INTEGRATION_AUDIT` must inspect:

ASR raw · FineSpan · Domain Vote / SameDomain · Model2 · Anchor materialization · Model3 invocation point · KEEP bypass · RETRY routing · **bounded local re-recall reuse of existing Recall** · Anchor preservation · candidate budget · assembly · KenLM relationship · traceability · latency.

Key question: can RETRY → bounded local re-recall be implemented **without** a second recall architecture?

---

## 8. Governance

Once role is frozen, silent changes to input modality / Anchor ownership / KEEP-RETRY semantics / Recall ownership require **Architecture Change Proposal** + user approval.

**STOP:** no runtime integrate · no retrain · no TTS · no Recall/Model2 change · no RETRY enable.
