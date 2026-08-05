# Recovery — FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05

## Identity

See `baseline_identity.json` for Commit SHA + Tag after freeze commit.

## Method A — Inspect freeze state

```bash
git show FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
git rev-parse FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
```

## Method B — Restore a single file

```bash
# Save current work first
git status
git restore --source FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05 -- <path>
```

## Method C — Temporary recovery workspace

```bash
git switch --detach FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
```

Rules:

```text
Do NOT treat detach as a long-lived development branch.
Do NOT force-overwrite main automatically.
Save the working tree before recovery.
```

## Verify (read-only)

```powershell
pwsh docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/verify_freeze.ps1
```

The script must not modify the repository.
