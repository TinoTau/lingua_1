# Lingua Model2 V3 — Stage J dialog_200 Node E2E Acceptance
# Date: 2026-08-18

**Dialog200 Executed: NO**  
**Cases modified: NO**  
**Training from failures: NO**

dialog_200 remains an **acceptance set**, not a train set. This round did not delete cases, change references, rewrite utterances, or hand-craft UserProfile from expected answers.

---

## Audit of authoritative input

Source: `test wav/dialog_200/cases.manifest.json` (200 cases, `restored_full_v1`).

| Item | Result |
|------|--------|
| session UserProfile in case payload | **NO** |
| pronunciation bias | **NO** |
| lexical/domain profile | **NO** |
| expectedText present | YES (unchanged) |

Therefore baseline A is the **real** product state: **NO_PROFILE**.

Controlled UserProfile E2E (B) would require the real profile generation chain on cases that already have a legal correction/profile contract. dialog_200 cases do not carry that contract. **Forbidden:** mapping `scenario=cafe` → coffee profile from expected drinks.

Slice (basis = UserProfile + FineSpan + Lexicon recoverability, **not** expected answer):

| Slice | N |
|-------|---|
| P_RELEVANT | 0 |
| D_RELEVANT | 0 |
| P+D_RELEVANT | 0 |
| PROFILE_IRRELEVANT | 0 |
| NO_PROFILE | 200 |

---

## Why live Node batch was not run

Existing runner: `electron_node/electron-node/tests/run-dialog200-timed-batch.mjs` → `POST /run-pipeline-with-audio` on test server `:5020` + Faster-Whisper.

Health check this session: **server down**. Starting Electron + ASR for 200 wavs was not available. A Python training harness or mock candidate injection would violate the stage rules, so it was **not** used as a substitute PASS.

Per-utterance jsonl records 200 rows with `executed=false`, `result_classification=NOT_RUN_TEST_SERVER_DOWN`.

---

## Comparison groups

| Arm | Status |
|-----|--------|
| A. BASE / Model2 disabled | NOT_RUN (needs live Node) |
| B. Previous Stage-P-only runtime | Frozen artifact reference: PROFILE_TARGET_ABSENT 22/22 (`RUNTIME_INTEGRATION_SKELETON_CLOSED`). Full dialog_200 Stage-P replay not re-run (unsafe / server down). Historical dialog_200 200/200 freeze is **chain/raw preservation**, not Model2 correction quality. |
| C. ONE Stage-J Model2 | Sidecar + Node P e2e **did** run. dialog_200 live **did not**. |

---

## What *was* proven on the real Node path (not dialog_200)

Insert point remains: `activeCandidates` → Model2 expand → DomainAwareAssembly → KenLM.

- ONE Stage-J checkpoint, sha256 match freeze
- ONE inference returns P + D
- Empty profile still invokes Model2
- P fixture: **22/22** target absent→introduced on real LexiconRuntimeV2
- Failure → base continues
- Singleton: 100 infers, no respawn

These do **not** replace dialog_200 neutral-retention / over-correction metrics.

---

## Metrics (dialog_200)

All live dialog metrics: **not measured**.

Do not invent a more favorable score. Do not treat NO_PROFILE gold Piper TTS as Model2 success.

---

## Failure taxonomy (this round)

**Highest priority:** `OTHER` — live dialog_200 Node ASR post-processing not executed.

Not used as training targets. Next round should run the existing batch runner against the Stage-J host **without** patching the 200 cases.

Known limitation carried from model freeze (not re-measured here): Wrong/Generic / empty-profile domain over-expansion. No gate added.

---

## Production wording

| Term | Status |
|------|--------|
| MODEL_FREEZE | YES (prior round) |
| RUNTIME_INTEGRATION | HOLD (wiring done; product 200 not run) |
| RUNTIME_READY | YES (code path + P e2e) |
| D_PRODUCTION_QUALITY | INSUFFICIENT_EVIDENCE |
| PRODUCTION_QUALITY_PROVEN | NO |

---

Artifacts: `training/model2_v3/experiments/v3_stage_j_runtime_swap/dialog200_stage_j_*.json*`
