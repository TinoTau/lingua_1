# PRE_SINGLE_CHAR_MODEL2_BASELINE

Evidence-only reconstruction. Sources are Stage J freeze / runtime-swap reports and surviving contracts — not git history and not “current code as design”.

## Authoritative freeze chain (last stable before Candidate-Set Interface V1)

| Rank | Document | Role |
|---|---|---|
| 1 | `docs/user_correction/Lingua_Model2_V3_StageJ_Model_Freeze_Report_2026_08_18.md` | MODEL_FREEZE YES; architecture + weights |
| 2 | `docs/user_correction/Lingua_Model2_V3_StageJ_Restored_Joint_P_Preservation_Report_2026_08_18.md` | P-preserving ONE Model2 recipe |
| 3 | `docs/user_correction/Lingua_Model2_V3_StageJ_Runtime_Checkpoint_Swap_Development_Report_2026_08_18.md` | Production sidecar load contract |
| 4 | `training/model2_v3/experiments/v3_stage_j_p_preservation/modified_file_inventory.csv` | `model.py` marked KEEP at freeze |
| 5 | `training/model2_v3/experiments/v3_stage_j_runtime_swap/modified_file_inventory.csv` | Host cmds / Node P/D path as of 2026-08-18 |

Candidate-Set Interface V1 (2026-08-19) is the first production-code insertion of Model2 single-char capability. Predev ACP (same day) is documentation-only.

## Class structure

`RetrievalPolicyV3` (`training/model2_v3/policy/model.py`):

- `item_mlp`, `attn`, `trunk`
- P: `action_head`, `query_budget_head`, `cand_budget_head`
- D: `domain_action_head` iff `with_domain_head=True`

Stage J freeze: **architecture UNCHANGED**; ONE checkpoint.

## Constructor

Documented production construction (Runtime Swap report):

`RetrievalPolicyV3(with_domain_head=True)`

No `with_ambiguity_head` / `ambiguity_version` in Stage J freeze or runtime-swap inventories.

## `forward()` output keys (frozen)

From skeleton isolation tests that still assert the default model (and Stage J host packing):

- `action_logits`
- `query_budget_logits`
- `cand_budget_logits`
- `domain_action_logits` (when domain head present)

No `ambiguity_logits`.

## Host commands (pre-single-char)

Runtime swap + current host minus documented additive `disambiguate`:

- `ping` / `stats`
- `load` / `load_index`
- `infer`
- `shutdown`

Sidecar: ONE process singleton. Load: explicit path + sha256. Hash mismatch → fail-fast. Lifecycle unchanged by later single-char work except extra cmd.

## Node interfaces

`Model2InferenceHost.infer` only on the product path (`expand-active-candidates.ts`). No `disambiguate` caller on that path (verified 2026-08-20).

## P/D request/response

Unchanged Feature Hash V1 packing + existing infer JSON (Candidate-Set report: “现网 infer JSON 不变”).

## Checkpoint strict-load

- File: `training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt`
- sha256: `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda`
- Params: **47210**
- Host: `RetrievalPolicyV3(with_domain_head=True)` then `load_state_dict(..., strict=True)` and `param_count() == 47210`

## Sidecar lifecycle

Process-level singleton; `cmd=load` once; many `infer`; `shutdown`. Documented in Runtime Swap report. Single-char did not add a second process.
