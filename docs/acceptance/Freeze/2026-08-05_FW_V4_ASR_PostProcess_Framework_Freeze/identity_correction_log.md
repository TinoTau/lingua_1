# Identity Correction Log — FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05

**Nature:** `IDENTITY_DOCUMENTATION_CORRECTION`（不是 NEW_FRAMEWORK_FREEZE）

## 原问题

1. `baseline_identity.gitCommit` 仅写 `RESOLVE_FROM_TAG`，外部归档无法静态得知 peeled Commit。
2. `RECOVERY.md` 把裸 `git rev-parse <tag>` 与冻结 Commit 身份混用。
3. `verify_freeze.ps1` 未区分 `TAG_OBJECT_SHA` 与 `FREEZE_COMMIT_SHA`。
4. `workingTreeClean: true` 掩盖 untracked / ignored / excluded WIP。
5. Annotated Tag Object SHA 未固化。

## 补正内容

1. 纠正裸 `git rev-parse <tag>` 语义 → 仅 `tagObjectSha`。
2. 固化 peeled `freezeCommitSha` = `6889fe16790587df7e711d5ad35b1e50ea53037c`。
3. 固化 Annotated Tag Object SHA = `d9a401a5d1dbb465a648e156679f656b7e09289f`。
4. 拆分 tracked clean / untracked / ignored / excluded WIP。
5. 保留 dialog_200 / KENLM_BENCHMARK_V1 = **INHERITED**。
6. 确认 Runtime Freeze Tag **未移动**（before == after peel）。

## 未修改内容

```text
生产 TypeScript / Runtime / Candidate / Assembly / CrossPath / KenLM
JobResult / Web / NMT / TTS / 词库 / SQLite / 生产模型
Runtime Freeze Tag（未删除、未重建、未 force-update）
原 Freeze Commit 内容（未 amend）
runtime_behavior_seal.json 语义（保持全 false）
```

## 身份

| Field | Value |
|-------|-------|
| Runtime Freeze Tag | `FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` |
| Runtime Freeze Commit（peeled） | `6889fe16790587df7e711d5ad35b1e50ea53037c` |
| Annotated Tag Object | `d9a401a5d1dbb465a648e156679f656b7e09289f` |
| Identity Documentation Correction Commit | `0e3bcab1a2e76ea32cbd85fef228c10c3fbfc406` |
| Tag moved? | **false** |
| Runtime changed? | **false** |

## Excluded WIP（不属于冻结范围）

```text
docs/tone-v2/_audit_scratch/**
kenLM/corpus/**
kenLM/model/corpus_v1/**
kenLM/model/phase03_first_train/**
kenLM/scripts/corpus_v1/**
kenLM/scripts/phase03_first_train.sh
kenLM/_smoke_in.txt
+ ignored generated artifacts (venv, logs, targets, …)
```
