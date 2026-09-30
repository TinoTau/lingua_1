# Post-rollback SSOT plan

After rollback, Cursor/agents must **not** treat Model2 single-char ACP or Candidate-Set V1 as active architecture.

## Active SSOT (restore pointer)

1. `docs/user_correction/Lingua_Model2_V3_StageJ_Model_Freeze_Report_2026_08_18.md` — weights + 47210 + architecture freeze
2. `docs/user_correction/Lingua_Model2_V3_StageJ_Restored_Joint_P_Preservation_Report_2026_08_18.md` — P/D coexistence recipe
3. `docs/user_correction/Lingua_Model2_V3_StageJ_Runtime_Checkpoint_Swap_Development_Report_2026_08_18.md` — sidecar load / ONE infer

Checkpoint identity remains expA sha256 `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda`.

## Retired docs

Banner required on each Model2 single-char report/ACP: `RETIRED / HISTORICAL / FAILED_EXPERIMENT — not authoritative Model2 architecture`. Do not delete history in this audit; next rollback round may keep files with banners rather than erase evidence.

## Must not remain active

- MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_ACP
- Candidate-Set Interface V1 freeze as SSOT
- Ambiguity V1/V2 design
- Batching performance proposal as pending work
