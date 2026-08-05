# 13 — Recovery Guide

## Identity

```text
Freeze ID: FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
Previous:  FW_V4_FREEZE_2026_08_03 (historical — do not rewrite)
```

Authoritative recovery materials:

- This Snapshot pack
- `docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/`
  - `baseline_identity.json`
  - `content_manifest.csv`
  - `RECOVERY.md`
  - `verify_freeze.ps1`

## Method A — Inspect

```bash
git show FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
```

## Method B — Restore one file

```bash
git restore --source FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05 -- <path>
```

## Method C — Temporary detached workspace

```bash
git switch --detach FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
```

**Rules:** do not use detach as a long-lived branch; do not force-overwrite `main`; save the working tree first.

## Verify (read-only)

```powershell
pwsh docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/verify_freeze.ps1
```
