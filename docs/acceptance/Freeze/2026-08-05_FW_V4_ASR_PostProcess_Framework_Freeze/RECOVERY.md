# Recovery — FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05

## Identity（静态）

权威身份见：

| File | Role |
|------|------|
| `baseline_identity.json` | Runtime Freeze Commit（peeled）已静态写入 `gitCommit` |
| `resolved_identity.json` | Annotated Tag Object SHA + Peeled Commit SHA + tagStability + Working Tree 拆分 |

| Term | Value / Command |
|------|-----------------|
| Freeze Tag Name | `FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` |
| `tagObjectSha` | `git rev-parse FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` → Annotated Tag Object |
| `freezeCommitSha` | `git rev-list -n 1 FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` → Peeled Commit |

**禁止**把裸 `git rev-parse <tag>` 的结果称为冻结 Commit。

---

## Inspect Tag Object vs Freeze Commit

### Annotated Tag Object SHA

```bash
git rev-parse FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
```

返回：`tagObjectSha`（Annotated Tag Object）。

### Peeled Freeze Commit SHA

```bash
git rev-list -n 1 FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
```

或等价：

```bash
git rev-parse "FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05^{}"
```

返回：`freezeCommitSha`（被冻结代码实际 Commit）。

---

## Method A — Inspect freeze contents

```bash
git show FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
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
Do NOT treat detached HEAD as a long-lived development branch.
Do NOT force-overwrite main automatically.
Save the working tree before recovery.
```

---

## Verify (read-only)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/verify_freeze.ps1
```

期望输出含：

```text
TAG_OBJECT_SHA=...
FREEZE_COMMIT_SHA=...
VERIFY_FREEZE_IDENTITY_PASS
```

脚本不得修改仓库（无 `git add` / `commit` / `tag` / `checkout` / `restore` / 文件写回）。

---

## Correction vs Runtime Freeze

```text
Runtime Freeze Tag:    FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
Runtime Freeze Commit: 6889fe16790587df7e711d5ad35b1e50ea53037c
Identity Documentation Correction Commit: 0e3bcab1a2e76ea32cbd85fef228c10c3fbfc406
  (does not move the Runtime Freeze Tag; does not change frozen runtime)
```
