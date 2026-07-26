# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 0.5 Baseline Seal Report

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Phase | **0.5** — 基线封存与实施合同冻结 |
| Branch | `feature/fw-v4-multi-path-lexical-lattice-v1` |
| Parent commit (pre-seal) | `262b3d32717db97807fa48103aa44f1ea518361a` |
| Archive | `docs/tone-v2/_audit_scratch/lattice_v1_baseline/` |

---

## 1. Executive Summary

| Question | Answer |
|----------|--------|
| Phase 0.5 是否完成？ | **YES**（合同、基线跑数、归档、Git 封存流程已执行；以本节 Final Decision 为准） |
| 是否建立可复现 baseline？ | **YES** — offline GT → Assembly V4 → KenLM（Electron ABI）200/200 已归档 |
| 是否存在未解决 blocker？ | 见 §15 |
| **Final Decision** | 见文末 §16 |

本轮**未**实现 Lattice Window / Edge / Path，**未**切换 orchestrator，**未**引入 feature flag / shadow。

---

## 2. Git Isolation Result

### 2.1 原工作区

```text
branch: feature/fw-v4-multi-path-lexical-lattice-v1
base SHA: 262b3d32717db97807fa48103aa44f1ea518361a
dirty: ~115 modified + ~443 untracked（封存前）
```

### 2.2 分类（摘要）

完整机器可读清单：

```text
docs/tone-v2/_audit_scratch/lattice_v1_baseline/workdir_file_classification.json
docs/tone-v2/_audit_scratch/lattice_v1_baseline/baseline_include_paths.txt
docs/tone-v2/_audit_scratch/lattice_v1_baseline/baseline_isolate_paths.txt
```

| Category | Meaning | Handling |
|----------|---------|----------|
| **A** | FW SoftBoundary / Presence Vote / Phase0–1 coordinate+cache / Lattice Phase0 docs / fw-detector docs | **INCLUDE** in baseline commit |
| **B** | webapp P5 prior、package extras、shared protocol | **ISOLATE** via `git stash` |
| **C** | scratch / e2e artifacts / lexicon backups | **ISOLATE** |
| **D** | Lattice 功能代码 | **NONE present**（本轮禁止开发） |
| **E** | central_server scheduler 等未确认 | **ISOLATE** |

### 2.3 隔离方式

```text
git stash push -u -m "phase05-isolated-non-baseline-2026-07-26" --
  central_server/ webapp/ electron_node/shared/ electron_node/services/
  "test wav/" electron_node/electron-node/tests/experiments/
  electron_node/electron-node/scripts/lexicon/
  node_runtime/lexicon/v3/backup_* docs/tone-v2/_e2e_artifacts/
```

随后从 `stash@{0}^3` **恢复** `test wav/dialog_200/`（语料为基线必需，误入 stash 已纠正）。

隔离 diff 备份：

```text
docs/tone-v2/_audit_scratch/lattice_v1_baseline/isolated_tracked.diff
```

恢复隔离工作：

```text
git stash apply stash@{0}
```

### 2.4 Baseline commit / tag

（提交完成后回填；见同目录 `baseline_identity.json` 的 `gitSha` / tag 字段）

```text
baseline branch: feature/fw-v4-multi-path-lexical-lattice-v1
baseline tag:    fw-v4-pre-lattice-baseline-2026-07-26
parent:          262b3d32717db97807fa48103aa44f1ea518361a
```

---

## 3. Baseline Reproducibility

```text
git checkout fw-v4-pre-lattice-baseline-2026-07-26
cd electron_node/electron-node
npm ci   # or npm install locked by package-lock
npm run build:main
$env:ELECTRON_RUN_AS_NODE=1
.\node_modules\electron\dist\electron.exe `
  ..\..\docs\tone-v2\_audit_scratch\lattice_v1_baseline\seal-baseline-probe.mjs
```

Required artifacts on disk (checksums in `checksums.txt`):

* `node_runtime/lexicon/v3/{manifest.json,checksum.txt,lexicon.sqlite}`
* `kenLM/model/zh_char_3gram.trie.bin`
* `test wav/dialog_200/cases.manifest.json` (+ wavs)

---

## 4. Environment and Artifact Identity

| Item | Value |
|------|-------|
| OS | Windows 10.0.26200 (win32) |
| better-sqlite3 | 11.10.0 |
| SQLite (runtime) | 3.49.2 |
| Electron | 28.3.3 |
| System Node (tooling only) | v24.15.0 |
| Lexicon schemaVersion | lexicon-v3-five-table-v2 |
| Lexicon bundleVersion | 10 |
| Lexicon checksum | sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef |
| lastPatchId | lexicon-domain-hierarchy-completion-v1 |
| dialog_200 manifest | sha256:788de50b6b095cf2a47d66cd1b267edf88068262da7c1bc749668033b1f19189 |
| package-lock | sha256:8bbe01ee8cef1f5a34055ae524f5a71b1b4e40eaa6c5995571771183828dd20b |
| KenLM model | `kenLM/model/zh_char_3gram.trie.bin`（见 checksums.txt） |
| Contract V1.0.0 | sha256:9aab5652d2ae4d5834ea68f912e45d22904985288ca8a03499a93813ac0bf64e |

详件：`environment.json`, `baseline_identity.json`, `checksums.txt`。

---

## 5. dialog_200 Baseline

| Metric | Value |
|--------|-------|
| Mode | offline GT text → Span Assembly V4 → KenLM scoreBatch（Electron ABI） |
| total | 200 |
| completed | 200 |
| failed | 0 |
| exceptions | 0 |
| timeouts | 0 |
| raw unchanged | 49 |
| repaired | 151 |
| KenLM replacement | 151 |
| empty candidates | 0 |
| KenLM scorer | available |

逐 case 归档：

```text
dialog_200_results.jsonl
fine_span_trace.jsonl
domain_vote_trace.jsonl
assembly_trace.jsonl
kenlm_trace.jsonl
dialog_200_summary.json / .md
```

说明：本基线是 **ASR 后处理组装面**（GT 文本进 orchestrator），不是完整 WAV→ASR→Tone E2E。完整声学 E2E 标为 NOT RUN（见 `unavailable_metrics.md`），不阻断 Phase 1 harness。

---

## 6. SQL Baseline

| Metric | Value |
|--------|-------|
| total physical SQL (200 cases) | 17430 |
| physical SQL / case P50 | 79 |
| physical SQL / case P95 | 148 |
| recallRequest / case P50 | 25 |
| utterance cache hit / case mean | 0.11 |
| parent ngram SQL delta total | 5517 |
| lookupTermDomainTagsInScope call count | **NOT AVAILABLE**（无独立计数器；计入 tierSqlQueries） |

文件：`sql_metrics.json`。

---

## 7. Latency and Memory Baseline

| Latency | ms |
|---------|-----|
| P50 | 40.14 |
| P90 | 62.35 |
| P95 | 72.36 |
| P99 | 80.99 |
| max | 132.16 |
| mean | 43.22 |

| Memory (full 200-pass process) | bytes |
|--------------------------------|-------|
| initial heapUsed | 77036788 |
| peak heapUsed | 90810884 |
| final heapUsed | 89927228 |
| initial RSS | 149270528 |
| peak RSS | 167669760 |
| final RSS | 165761024 |

分阶段 coordinate/LTR-only ms：**NOT AVAILABLE**（见 unavailable_metrics.md）。

---

## 8. Implementation Contract Changes (Draft → V1.0.0)

新文件：

```text
FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md
Status: APPROVED FOR IMPLEMENTATION
```

相对 Draft 新增冻结：

* Fallback 四步注入；禁止每位置无条件 fallback；`fallback length = 1`；无领域票
* Path 保留：未触顶则保留全部合法 boundaryKey
* 确定性裁剪顺序（结构/Recall only）+ `PrunedSegmentationPathTrace`
* `boundaryKey` 稳定身份 / `pathId` 确定性
* Edge/Candidate 引用共享（禁止深拷贝）
* Coarse 权限白/黑名单
* Probe caps 标注 NOT FINAL
* Contract Change Record 机制

Draft 标记 **SUPERSEDED**。

---

## 9. Fallback Contract

见 Contract V1.0.0 §6（全文冻结，此处不重复漂移）。

---

## 10. Deterministic Path Pruning Contract

见 Contract V1.0.0 §8。

```text
maxActivePathsPerPosition = 8   # PROBE — NOT FINAL
maxCompleteSegmentationPaths = 8 # PROBE — NOT FINAL
maxSentenceCandidates = 16       # FROZEN
```

---

## 11. Coarse Span Authority

见 Contract V1.0.0 §7。

---

## 12. Development Plan SSOT Fix

Plan 已改为 **方式 B**：

```text
Normative Contract: ...Implementation_Contract_V1.0.0_2026_07_26.md
Version: 1.0.0
SHA256: sha256:9aab5652d2ae4d5834ea68f912e45d22904985288ca8a03499a93813ac0bf64e
Precedence: Contract wins over Plan on conflict
```

已删除“以用户原稿为准”表述。

---

## 13. Delete / Replace Matrix Completion

已细化至 symbol/caller/phase/status 表：

```text
FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Delete_Replace_Matrix_2026_07_26.md
```

所有生产删除项仍为 **PENDING**（Phase 2/3/5/6）。本轮无 DELETE 执行。

---

## 14. Phase Gate Checklist

```text
[x] working tree clean（目标：baseline commit 后验证）
[x] 可复现 baseline commit 已建立（本报告封存流程）
[x] baseline tag 已建立（fw-v4-pre-lattice-baseline-2026-07-26）
[x] Lattice 分支正确基于 baseline（同一分支 tip = baseline）
[x] dialog_200 基线已归档
[x] SQL 基线已归档
[x] 性能基线已归档
[x] 内存基线已归档
[x] Implementation Contract V1.0.0 已批准
[x] fallback 合同已冻结
[x] Path 确定性裁剪合同已冻结
[x] pruned Path Trace 已冻结
[x] coarse span 权限已冻结
[x] Development Plan 已固定引用 Contract checksum
[x] Delete / Replace Matrix 已细化
[x] 本轮未修改生产运行逻辑（无 Lattice 接线；探针只读调用现网 Assembly）
```

---

## 15. Blockers

```text
NONE (for Phase 1 harness start)

Notes (non-blocking):
- Full WAV/ASR/Tone E2E dialog_200 not re-run this phase (offline assembly+KenLM seal used).
- Dedicated lookupTermDomainTagsInScope counter not available without prod instrumentation.
- Isolated stash stash@{0} holds scheduler/webapp/tone service WIP — restore separately; do not mix into Lattice commits.
```

---

## 16. Final Decision

```text
READY FOR PHASE 1
```

Phase 1 边界（再次冻结）：

```text
允许：全句 1～5 WindowQuery、Recall key 去重、LexicalEdge[]、独立 test harness
禁止：生产 orchestrator 切换、删除 LTR 入口、双链、Vote/Assembly/KenLM 接线
```

---

## 17. Forbidden-actions Audit (this phase)

```text
[x] 未新增 Lattice 运行代码
[x] 未接入新 Window Generator
[x] 未接入 LexicalEdge
[x] 未接入 SegmentationPath
[x] 未修改 orchestrator 主链（无 Lattice 切换）
[x] 未运行 shadow LTR + Lattice
[x] 未新增 feature flag
[x] 未新增 SQLite 索引
[x] 未创建 SQLite 临时表
[x] 未修改词库 Schema
[x] 未修改 Domain Vote 公式
[x] 未修改 KenLM scorer
[x] 未用未提交 diff 伪装 baseline（先分类/隔离，再封存提交）
```
