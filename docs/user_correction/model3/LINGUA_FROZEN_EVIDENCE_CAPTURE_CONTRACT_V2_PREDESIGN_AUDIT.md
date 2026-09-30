# Lingua1 — Frozen Evidence Capture Contract V2 Pre-Development Audit

`RESULT_ENUM = B — MINOR_OBSERVABILITY_HOOKS_REQUIRED`  
`NEXT_OWNER = CAPTURE_V2_CONTRACT_FREEZE`  
`RECAPTURE_REQUIRED = YES`  
`PRODUCTION_ALGORITHM_CHANGE_REQUIRED = NO`  
`OBSERVABILITY_ONLY_CHANGE_REQUIRED = YES`  
`REPLAY_BOUNDARY_CHANGE_REQUIRED = NO`  
`CURRENT_BASELINE_REPLACED = NO`  
`REPLAY_EQUIVALENCE_CERTIFIED = NO`  
`TRUSTED_DIALOG200_FUNNEL_V2 = BLOCKED`

**一句话：** Capture V2 可以在不改变 Production 算法行为的前提下，通过 env-gated snapshot hooks 使 Capture↔Replay 的 **第一个真正分歧** 可直接观测；但这要求 **重新 Capture** Dialog200，且若干比较细节需用户拍板（见 Decision Required）。

---

## 0. Frozen Authority Confirmation

- Single Dialog200 SSOT；本轮不替换 baseline；禁止 dual/fallback baseline。
- Multi-Batch Alignment Repair V1 已验证；E18=200/200 ≠ stage equivalence。
- d149：`RESULT F`；`FIRST_OBSERVABLE=B9/E3`；`TRUE_FIRST=NOT_PROVABLE_WITH_CURRENT_FROZEN_EVIDENCE` — 接受。
- d149 Replay-side WTS/Tone anomalies **仅作 V2 设计依据**，不在本轮定性 Production/Replay bug。
- Cases are evidence；SSOT defines behavior。Frozen input ≠ consumer-visible state。

---

## 1. Executive Verdict

现有架构已具备 **side-channel**（`MODEL2_DIALOG200_TRACE` → `dialog200_path_trace`），足以承载 V2 证据而不污染 JobResult 业务主接口。缺口是：Capture V1 **未持久化** B3–B8 consumer-visible 状态，且 harness 误读 `fine_spans`（Production 字段为 **`finespans`**）、候选 **`.slice(0,48)`**。

V2 最小路径 = **扩展 generic observability hooks（snapshot-only）+ 新 Capture schema + Recapture**。不改算法、不改 Replay 注入语义（仍注入 ASR/Tone/alignment；下游一律重算比对）。

Result **B**：需少量 observability hooks；用户确认 Decision Required 后进入 **CAPTURE_V2_CONTRACT_FREEZE**。

---

## 2. PRODUCTION_BOUNDARY_MAP（摘要）

完整 inventory：`LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_BOUNDARY_INVENTORY.json`。

```
ASR (rawAsrText, segments.words Traditional-capable)
  → normalizeForFwRepairInput          [OpenCC t→cn + NFKC]
  → repairText (= V4 rawText)          ★ script transform
  → buildWordTimeSpans(repairText, segments, offsets…)
  → mapToneEvidenceForRecall → toneNorm
  → buildLexicalWindowQueries → latticeHardBlockFilter
  → CanonicalRecallQuery (serializeCanonicalRecallQueryKey)
  → SQLite exact/fuzzy → Base materialization
  → Model2 pre-edge expand
  → buildLexicalEdges
  → enumerateCompleteSegmentationPaths (pre/post cap)
  → finespans + domain vote + assembly
  → KenLM pool/rerank/gate
  → Model3 anchors/input/decisions
  → Final text
```

### 2.1 Traditional → Simplified（B1 关键发现）

| Item | Location |
|------|----------|
| Function | `normalizeForFwRepairInput` |
| File | `fw-detector/normalize-for-fw-repair.ts` |
| Caller | `fw-detector-orchestrator.ts` → `runFwDetectorV4Path({ rawText: repairText })` |
| Mutates raw ASR? | **No** — `ctx.rawAsrText` 保留；写入 `fwRepairNormalizedText` |
| WTS impact | `buildWordTimeSpans` 在 **simplified repairText** 上 `indexOf(Traditional word tokens)` → 丢 span（与 d149 live 11 vs Traditional offline 15 一致） |
| Char/FineSpan | 下游坐标建立在 **repairText** 上 |

Capture V1 只存 Traditional `rawMergedAsrText`，**不存 repairText / consumer WTS** → 证据链断裂。

### 2.2 CanonicalRecallQueryIdentity（从 Production 推导）

`serializeCanonicalRecallQueryKey`:

`v2 | kind | pinyinKey | toneNorm | domainsSorted | exactTopK | lexiconVersion | surfaceText`

`toneNorm = normalizeToneNorm(acousticTonePattern)`（逗号拼接 digit；空串=plain）。

---

## 3. Capture V1 Coverage Gaps（相对 V2）

| Boundary | V1 | 缺陷 |
|----------|----|------|
| B1 repairText | NOT_APPLICABLE / 未写入 artifact | 无法证明 script 变换 |
| B2 alignment | 未持久化 | Replay 已可重建，但 Capture 缺 consumer snapshot |
| B3 WTS | 缺 | **TRUE_FIRST 阻断主因之一** |
| B4 mapped Tone | 仅有 slices | E2≠mapped |
| B5 finespans | harness 读 `fine_spans` | **永远空** |
| B6–B8 | 缺 | 无法定位 Base 前分歧 |
| B9 Base | `.slice(0,48)` surfaces | 不可作 set proof |
| B17 Model3 | decisions 部分；anchors/input 丢 | E16 NOT_EVALUABLE×200 |

V1 **不能**无损升级为 V2（见 Q2）。

---

## 4. Proposed Schema — `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2`

设计-only（不实现）：

```
case_identity / artifact_identity / runtime_identity
asr_boundary: { rawAsrText, repairText, scriptNormalized, segments, hashes }
alignment_boundary: { segmentTimeOffsetsSec, asrSegmentNodeBatchIndices, segmentCharOffsets, hash }
word_time_span_boundary: { spans: WordTimeSpan[], count, hash }   // consumer-visible
tone_mapping_boundary: { slices_ref_or_payload, per_window: [...] }
finespan_boundary: { paths: [{ path_id, finespans: [...] }] }    // real field name
window_query_boundary: { generated[], logical_recall[], counts }
canonical_recall_query_boundary: { queries: [{ canonical, key, cache }] }
base_sql_boundary: { executions: [{ key, params, stage, rows_summary|full }] }
base_materialization_boundary: { unique_set, multiset, provenance[] }
model2_boundary / lexical_edge_boundary / segmentation_path_boundary
  (pre_cap + post_cap + pathCapEvents)
domain_assembly_boundary / kenlm_boundary / model3_boundary / final_boundary
```

字段名必须对齐 Production；禁止发明业务结构；禁止 d149 特化字段。

---

## 5. Serialization / Hash Strategy

| Mode | Use |
|------|-----|
| FULL_PAYLOAD | WTS, mapped tone windows, CanonicalRecallQuery, finespans, Base sets, path post-cap, Model3 anchors/decisions, final |
| HASH_PLUS_SUMMARY | SQL rows (pending D3), Model2 input, path pre-cap |
| HASH_ONLY | large identical blobs already FULL elsewhere |
| RECONSTRUCTABLE | **不得**单独用于 WTS / mapped Tone / CanonicalQuery；alignment 仅可作 validation cross-check |

Canonicalization：去掉 jobId/sessionId/绝对路径/runtime handles；保留 score/geometry/tone 等业务字段。Float → **D1**。

Observer effect：仅 deep-copy snapshot；禁止为序列化 mutate Map/Set；env 默认 OFF。

---

## 6. Instrumentation Placement

**优先：** 扩展现有 side-channel（`MODEL2_DIALOG200_TRACE` 或新 `FROZEN_EVIDENCE_CAPTURE_V2=1`），经 `result-builder-core` 已有 pattern 导出 `dialog200_path_trace` — **不改 JobResult 业务主链类型**。

**禁止：** 把完整 V2 证据塞进正式业务 JobResult schema。

详见 Decision **D5**（用户授权 OBSERVABILITY_ONLY_CHANGE 文件列表）。

---

## 7. Replay Injection vs Comparison

见 `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_REPLAY_ROLE_MATRIX.json`。

**INJECTION_STATE：** raw ASR + segments + acousticToneSlices + alignment + profile + identity pins。  
**COMPARISON_ONLY：** repairText, WTS, mapped Tone, windows, queries, SQL, Base, Model2, edges, paths, KenLM, Model3, final。  
**禁止：** 注入 Capture WTS / Base / Path / KenLM pick / Model3 decisions 作为 Replay 捷径。

Replay 注入边界 **无需 redesign**（Result 非 D）。

---

## 8. Q1–Q5 Recapture Decision

| Q | Answer |
|---|--------|
| **Q1** 必须重新 Capture Dialog200？ | **YES** |
| **Q2** V1 无损升级 V2？ | **NO — RECAPTURE_REQUIRED**（缺 WTS/mapped Tone/windows/queries/SQL；finespans 未采集；截断） |
| **Q3** 需重跑 ASR/Tone？ | **YES** — Capture entry 为 full-audio `/run-pipeline-with-audio`；V2 仍应在同入口采集（声学证据重新生成后 REPLACE baseline，非 dual） |
| **Q4** V2 改变 Production behavior？ | **目标 NO**（hook snapshot-only） |
| **Q5** 需改 Production algorithm files？ | **算法 NO**；**observability hooks YES**（D5） |

---

## 9. Baseline Replacement Contract（设计，不执行）

```
Capture V2 → completeness validation → artifact identity
→ Replay V2 → evaluator contract → equivalence acceptance
→ REPLACE DIALOG200_BASELINE_SSOT
→ retire V1 authority (V1 retained as historical audit only)
```

禁止 V1+V2 双 authority。本轮 **CURRENT_BASELINE_REPLACED = NO**。

---

## 10. d149 Role

仅作为 V2 可观测性需求的 **evidence case**（WTS/script/mapped tone/CanonicalQuery）。  
禁止：d149 hardcode、合适/何时、11/15、特化 Trad/Simp 分支、改 Tone/Recall/Path。

---

## 11. Result Enum Rationale

| Enum | Why not / why |
|------|----------------|
| A | 现有 hooks **不足**直接 FULL capture B3–B8 |
| **B** | **选中** — 少量 generic env-gated hooks 即可；算法不变；Replay 边界够用 |
| C | hooks 不强制改正式 JobResult 业务 interface；沿用 side-channel |
| D | Replay injection 已可验证各 stage（注入 upstream，比对 downstream） |
| E | 与 EVALUATION_SSOT_V1 无硬冲突；E16 因证据缺失 NOT_EVALUABLE，V2 补证据后可评估 |
| F | 代码足够完成设计 |

**NEXT_OWNER = CAPTURE_V2_CONTRACT_FREEZE**（待 D1–D5 用户确认后冻结合同再实现）。

---

## 12. Acceptance Gates

G1–G10：本轮未改任何 algo/replay/evaluator/SSOT/baseline — **PASS**  
G11–G23：B1–B18 已在 inventory/matrix 定位 — **PASS**  
G24–G25：INPUT vs EXPECTED_OUTPUT 已分离；无 downstream shortcut — **PASS**  
G26–G27：serialization + observer effect — **PASS**  
G28：RECAPTURE_REQUIRED=YES — **PASS**  
G29：ONE SSOT replacement path — **PASS**  
G30：Funnel BLOCKED — **PASS**

---

## 13. Artifacts

1. `LINGUA_FROZEN_EVIDENCE_CAPTURE_CONTRACT_V2_PREDESIGN_AUDIT.md`（本文件）
2. `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_BOUNDARY_INVENTORY.json`
3. `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_COMPLETENESS_MATRIX.json`
4. `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_REPLAY_ROLE_MATRIX.json`
5. `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_DECISION_REQUIRED.md`（D1–D5）

---

## 14. Production / Replay / Evaluator / SSOT Delta Check

| Surface | Delta |
|---------|-------|
| Production algorithm | none |
| Replay algorithm | none |
| Evaluator | none |
| Frozen Evidence V1 | unchanged |
| Baseline SSOT | unchanged |
| EVALUATION_SSOT_V1 | unchanged |
| Dual baseline / fallback | none |

---

## 15. Follow-up from parallel code traces

并行只读追踪已核对并回写产物：

- [Map ASR to WTS/Tone/Recall](21568c72-6bde-4cd0-bbca-4b9a43732af2)：确认 Production Window 生产者为 **`buildLexicalWindowQueries`**（非 harness `generateGlobalWindows`）——已修正 B6 inventory / matrix / 本报告链路。
- [Map Model2 to Final Capture V1](d85ac3c4-7f19-44e3-9d2b-2bf0beab7af3)：确认 E5/E8/E14/E15/E16/E17 因 Capture compact 缺口为 NOT_EVALUABLE；与 V2 B12/B16/B17 FULL 要求一致，无需改 Result Enum。

**RESULT_ENUM 仍为 B；无新增实现。**
