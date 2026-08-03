# FW Repair V4 — Recall Candidate Recovery Development Report

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Nature | **DEVELOPMENT** · Lexicon Source + Full Rebuild · Runtime Candidate Generation |
| Freeze Baseline | **FW_V4_FREEZE_2026_08_03**（Framework / Tone / Recall / Assembly / CrossPath / KenLM **未改**） |
| Bundle | **v3 bundleVersion=13** |
| Verdict | **DEVELOPMENT_PARTIAL** |

---

## 1. 开发内容

| Task | 结果 |
|------|------|
| T1 补齐正式词：小食 / 触发 / 阈值 | DONE（Source → Rebuild → SQLite） |
| T2 修复「我们」tone_pinyin_key | DONE：`wo3\|men0` → `wo3\|men5` |
| T3 Full Rebuild | DONE |
| T4 Runtime Exact Recall（自检 8 词） | **8/8 HIT** |
| T5–T6 Candidate Generation → CrossPath | **1/7** 正确句进入 CrossPath（center-01） |
| T7 KenLM | **仅 center-01** 具备 Raw+Correct 池；其余停止，不宣称 KenLM 可全面优化 |

未改：Framework、Tone Contract、Recall Contract、Assembly、CrossPath、KenLM、TopK、Budget、Atomicity、Plain Fallback、白名单、Case 特判。

---

## 2. 修改文件

| File | Change |
|------|--------|
| `electron_node/docs/lexicon-assets/full_rebuild_v1/lexicon_full_corrected_review.csv` | 修「我们」tone；新增 小食/触发/阈值 |
| `electron_node/docs/lexicon-assets/full_rebuild_v1/sources.manifest.json` | 更新 sha256 / recordCount；`contentBundleVersion=13` |
| `node_runtime/lexicon/_rebuild_candidate/**` | Full Rebuild 产出 |
| `node_runtime/lexicon/v3/**` | 正式晋升 runtime bundle |

---

## 3. 修改词条（lexicon_repairs.csv）

| surface | termId | old | new | reason |
|---------|--------|-----|-----|--------|
| 我们 | term-e68891e4bbac7c77 | wo3\|men0 | **wo3\|men5** | tone0 无法进入 Mandatory Tone Exact 声学 pattern（仅 1–5） |
| 小食 | term-e5b08fe9a39f7c78 | — | xiao\|shi / xiao3\|shi2 | 缺失正式原子 |
| 触发 | term-e8a7a6e58f917c63 | — | chu\|fa / chu4\|fa1 | 缺失正式原子 |
| 阈值 | term-e99888e580bc7c79 | — | yu\|zhi / yu4\|zhi2 | 缺失正式原子 |

---

## 4. Tone Key

「我们」：轻声 `men0` → 合同可表达的中性调 `men5`（正式 Source，非 Runtime/SQLite patch）。

---

## 5. Full Rebuild

```text
schemaVersion   = lexicon-v3-runtime-v3
bundleVersion   = 13
checksum        = sha256:b3cc9477227900d726b769a6135a81d09dfdd5a862b37c6e1e92c04e12a81d58
termCount       = 9259
domainTagCount  = 655
baseCount       = 9259
atomicity       = enforce · ACCEPT=9251 · ACCEPT_EXCEPTION=8 · REJECT=0 · UNRESOLVED=0
```

命令：`lexicon:full-rebuild --force --bundleVersion=13` → promote → `node_runtime/lexicon/v3`。

---

## 6. Runtime Recall（自检）

对目标 surface 使用**其自身** tone_pinyin_key 调用生产 `recallSpanTopKV2`（非裸 SQL）：

| surface | Runtime Recall |
|---------|----------------|
| 我们 | HIT rank=1 |
| 正在 | HIT rank=1 |
| 中心 | HIT rank=1 |
| 小食 | HIT rank=1 |
| 已经 | HIT rank=1 |
| 同步 | HIT rank=1 |
| 触发 | HIT rank=1 |
| 阈值 | HIT rank=1 |

---

## 7. Candidate Generation（7 Case Runtime）

生产路径：Phase1 → Lattice → Orchestrator（含 Mandatory Tone 所需 acoustic `tonePosterior` + ASR word timestamps；**不改合同**）。

| caseId | Recall 正确原子 | CrossPath | 正确句 | FIRST FAILURE |
|--------|-----------------|-----------|--------|---------------|
| **center-01** | 忠心+**中心** | Raw + **注册中心…** | **YES exact** | — |
| nn-train-01 | 无「我们/正在」于噪声窗 | Raw only | NO | RecallCandidate |
| nn-train-01b | 噪声窗召回闷蒸≠正在 | Raw only | NO | RecallCandidate |
| snack-01 | 窗召回消失；小食调不同 | Raw only | NO | RecallCandidate |
| sync-01 | 窗召回精通；未得已经+同步 | Raw only | NO | RecallCandidate |
| trigger-01 | 出发≠触发（调不同） | Raw only | NO | RecallCandidate |
| threshold-01 | 阈值未在噪声窗命中 | Raw only | NO | RecallCandidate |

---

## 8. CrossPath

**center-01（成功）：**

1. `微服务会定时向注册忠心上报健康状态。`（Raw）
2. `微服务会定时向注册中心上报健康状态。`（Correct）

其余 6 案：CrossPath 仍仅 Raw → 按任务要求 **停止**，不宣称可全面进入 KenLM 优化。

---

## 9. Regression / Diff

| caseId | before | after | added |
|--------|-------:|------:|-------|
| center-01 | 1 | **2** | 正确「注册中心」句 |
| 其余 6 | 1 | 1 | （无） |

---

## 10. Q1 / Q2 / Q3

### Q1 哪些 Candidate 恢复成功？

- **词级 Runtime Recall**：我们、正在、中心、小食、已经、同步、触发、阈值 — **全部可召回**
- **句子级 CrossPath**：**center-01**（忠心→中心）完整正确句已进入 CrossPath / KenLM input 池

### Q2 哪些仍然无法生成？

| Case | 阻塞（下一开发点，非本轮允许改合同） |
|------|--------------------------------------|
| snack-01 | 噪声窗声学调 `xiao1\|shi1` ≠ 小食 `xiao3\|shi2` |
| trigger-01 | 噪声窗 `chu1\|fa1` ≠ 触发 `chu4\|fa1` |
| nn-train-01 | 窗 `wo\|men` 对齐「我闷」调 ≠ 我们 `wo3\|men5`；且需多原子 Assembly |
| nn-train-01b | 拼音窗 `men\|zheng` ≠ `zheng\|zai` |
| sync-01 | 噪声窗未同时召回已经+同步（窗/调对齐） |
| threshold-01 | 2 字「阈值」vs 3 字「阈之一」窗边界 |

### Q3 现在是否可以开始 KenLM 优化？

**尚不可全面开始。**  
仅 **1/7** 案形成 Raw+Correct 真实竞争池。需先继续恢复其余 Case 的 CrossPath 异文（在冻结合同内），直到足量 B 类样本。

---

## 11. Artifacts

目录：`docs/acceptance/Freeze/recall_candidate_recovery_2026_08_03/`

- `lexicon_repairs.csv`
- `runtime_recall_candidates.csv`
- `runtime_assembly_candidates.csv`
- `runtime_crosspath_candidates.csv`
- `runtime_kenlm_input.csv`
- `runtime_candidate_diff.csv`
- `bundle_and_results.json`

本报告：`docs/acceptance/Freeze/` + `docs/tone-v2/`。

---

## 12. Final Verdict

```text
DEVELOPMENT_PARTIAL

部分 Candidate 已恢复（词级 8/8；句级 center-01）。

仍有 FIRST FAILURE = RecallCandidate（6/7 Case）。

下一步开发点：在不改 Tone/Recall/Assembly/CrossPath 合同前提下，
解决噪声窗拼音/调型/边界与正确原子不对齐导致的句级未生成。
```
