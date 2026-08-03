<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_ToneEvidence_SSOT_FailureAttribution_Development_Report_2026_07_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Tone Evidence SSOT Export Repair + Failure Attribution Development Report

**Date:** 2026-07-29  
**Nature:** 开发 + 真链验收（dialog_200）  
**Evidence:** `docs/tone-v2/_audit_scratch/tone_evidence_ssot_attribution_2026_07_29/`

---

## 1. Executive Summary

本轮完成三件事：

1. **统一 Tone Evidence SSOT 导出**：`extra.utterance_tone` 改为从 `ctx.acousticToneSlices` 构造，不再使用首 batch `ctx.asrResult.tone`。
2. **Inference 静默跳过可观测化**：`short_duration_skipped` / `feature_extraction_failed` / `inference_output_missing` / `invalid_word_time` / `slice_created`。
3. **Mapping Miss 最小归因**：`missReason` + 与 production diagnostic 时间关联。

**dialog_200 真链结果（200/200 成功）：**

| 指标 | 值 |
| ---- | -- |
| API vs SSOT Slice mismatch cases | **0** |
| Pattern Attempt / Hit / Miss | **289 / 288 / 1** |
| Coverage | **99.65%**（此前验收约 75%） |
| short_duration_skipped | **75** |
| feature_extraction_failed | **0** |
| inference_output_missing | **0** |
| Mapping Miss 归因 | **1 × slice_exists_but_no_overlap**（case d132） |

**结论：** 此前大量「首 batch Slice 远小于 diag」是 **导出/观测假象**；生产 Mapping 本就使用全量 SSOT。统一导出后观测与生产一致。剩余 **1** 个 Miss 归入重叠/零时长边界类，而非 Feature Extraction。短 Word 跳过真实存在（75），但绝大多数 **未进入** 造成 Pattern Miss。

**NEXT（唯一优先方向）：**

```text
NEXT: WordTimeSpan / Slice Overlap Contract Repair
```

（含零时长 Word、`end>start && start<end` 边界；短 Word 真实扩窗为次优先卫生项）

---

## 2. Scope and Non-Goals

**做了：** Batch A 导出 SSOT；Batch B 验收脚本；Batch C inference 诊断；Batch D Mapping missReason；Batch E 关联归因 + dialog_200。

**未做：** 短 Word 扩窗、Mapping pattern 算法改写、Span/LTR/KenLM/Domain/Assembly/CNN/Feature Contract。

---

## 3. Modified Files

### Node / Electron

| File | Change |
| ---- | ------ |
| `pipeline/utterance-tone-ssot.ts` | **新增** SSOT 导出构造 |
| `pipeline/utterance-tone-ssot.test.ts` | 多 batch 导出单测 |
| `pipeline/result-builder-core.ts` | `utterance_tone` ← SSOT |
| `pipeline/steps/asr-step.ts` | 初始化并合并 `toneEvidenceProduction` |
| `pipeline/context/job-context.ts` | `toneEvidenceProduction` 字段 |
| `task-router/types.ts` | Evidence diagnostic 类型 |
| `fw-detector/tone-time-align.ts` | `missReason` / posterior 校验（空/非法 → null） |
| `fw-detector/tone-time-align.test.ts` | missReason 单测 |
| `span-assembly-shared/types.ts` | 诊断计数字段 |
| `span-assembly-shared/tone-diagnostics.ts` | 初始化 |
| `span-assembly-shared/tone-miss-attribution.ts` | 关联归因 |
| `span-assembly-shared/tone-miss-attribution.test.ts` | 归因单测 |
| `span-assembly-v4/recall-topk-for-windows.ts` | 计数 + example 归因 |
| `span-assembly-v4/span-assembly-v4-orchestrator.ts` | 透传 production |
| `fw-detector/fw-detector-v4-path.ts` | 透传 `ctx.toneEvidenceProduction` |

### Python FW Tone Module

| File | Change |
| ---- | ------ |
| `tone_module/inference.py` | 记录生产状态；posterior 长度显式校验 |
| `tone_module/tone_types.py` | `ToneEvidenceProductionDiagnostic` |
| `api_models.py` / `api_routes.py` | 序列化 evidenceProduction |
| `tone_module/test_tone_evidence_production_diagnostics.py` | 单测 |

### 工具

| File | Change |
| ---- | ------ |
| `_audit_scratch/mainchain-acceptance-dialog200.cjs` | SSOT 字段；归因汇总；输出目录更新 |
| `_audit_scratch/tone-miss-rootcause-probe.cjs` | 删除 `asrToneSliceCount` 优先逻辑 |

---

## 4. Tone Evidence SSOT Before / After

### Before

```text
Mapping:  ctx.acousticToneSlices          (全量 + offset)
Export:   utterance_tone = ctx.asrResult.tone  (仅首 batch)
验收:     asrTone?.sliceCount ?? toneDiag...   (优先首 batch)
```

### After

```text
Mapping:  ctx.acousticToneSlices
Export:   utterance_tone = buildUtteranceToneFromSsot(ctx)
验收:     toneEvidenceSliceCount = toneDiag.toneSliceCount
          apiToneSliceCount = utterance_tone.sliceCount
          要求二者相等
```

---

## 5. Multi-Batch Export Repair

- Job 开始：`ctx.acousticToneSlices = []`，`ctx.toneEvidenceProduction = []`
- 每 batch：`offsetAcousticSlices` + `push`；production 诊断同样 +offset 一次并写 `batchIndex`
- 导出：按 `start` 排序；不重推理；posterior 原样
- 元数据 `model`/`version`：可从 diagnostics.toneModule 复用；**Slice 数组只来自 SSOT**

**验收：** dialog_200 `ssotApiMismatchCases = 0`；指定多 batch case（d015/d051/…）API == SSOT。

---

## 6. Production Failure Diagnostics

每个 Word 记录：

`slice_created | short_duration_skipped | feature_extraction_failed | inference_output_missing | invalid_word_time`

`MIN_SLICE_SEC` / `ValueError` 仍 `continue`，仅加诊断。  
`len(posteriors) != len(valid_words)`：禁止静默 zip 截断；多余 valid Word → `inference_output_missing`。

dialog_200 生产统计：

| Status | Count |
| ------ | ----: |
| slice_created | 4080 |
| short_duration_skipped | 75 |
| feature_extraction_failed | 0 |
| inference_output_missing | 0 |
| invalid_word_time | 0 |

样例短跳过多为 **`durationSec = 0`（start==end）**，不是单纯「略小于 20ms 的正常音节」。

---

## 7. Mapping Miss Reason Diagnostics

`mapToneEvidenceForRecall` 在 **pattern 计算路径不变的前提下** 增加：

- `no_word_timespan_for_slot`
- `no_slice_overlap_word_time`
- `empty_posterior` / `invalid_posterior`（仅当 posterior 空/NaN；真实 softmax 不触发）

dialog_200：`no_slice_overlap_word_time = 1`（其余 0）。

---

## 8. Data Contract

```text
AcousticToneSlice = 真实模型输出（utterance-local seconds）
ToneEvidenceProductionDiagnostic = 为何有/无 Slice（独立数组）
ctx.acousticToneSlices = 唯一 Tone Evidence SSOT
```

禁止第二套并行 SSOT。

---

## 9. Unit Test Results

| Suite | Result |
| ----- | ------ |
| `utterance-tone-ssot.test.ts` | PASS（含 3+5+4=12 slices 导出） |
| `tone-time-align.test.ts` | PASS（含 missReason 四类） |
| `tone-miss-attribution.test.ts` | PASS |
| `test_tone_evidence_production_diagnostics.py` | PASS（short / feature / posterior mismatch） |
| `npm run build:main` | PASS |

---

## 10. Selected Case Results

| Case | Batch | WTS | SSOT Slices | API Slices | Short Skip | Feat Fail | Infer Miss | Attempt | Hit | Miss |
| ---- | ----: | --: | ----------: | ---------: | ---------: | --------: | ---------: | ------: | --: | ---: |
| d015 | 2 | 21 | 21 | 21 | 0 | 0 | 0 | 1 | 1 | 0 |
| d051 | 2 | 26 | 25 | 25 | 1 | 0 | 0 | 2 | 2 | 0 |
| d060 | 2 | 26 | 23 | 23 | 3 | 0 | 0 | 1 | 1 | 0 |
| d067 | 2 | 24 | 24 | 24 | 0 | 0 | 0 | 1 | 1 | 0 |
| d096 | 2 | 26 | 25 | 25 | 1 | 0 | 0 | 1 | 1 | 0 |

全部满足 `API == SSOT`。例窗「一点 / 审一下 / 一下」本轮均有 pattern。

---

## 11. dialog_200 Results

### 12.1 基础总量

| 项 | 值 |
| -- | -- |
| Utterance Count | 200 |
| Batch Count (sum) | 274 |
| WordTimeSpan Count | 4155 |
| Tone Evidence Slice Count | 4080 |
| WTS − Slice | 75（= short_duration_skipped） |

### 12.2 Tone Evidence Production

见 §6。

### 12.3 Mapping

| 项 | 值 |
| -- | -- |
| Pattern Attempt | 289 |
| Pattern Hit | 288 |
| Pattern Mapping Miss | 1 |
| Coverage | 99.65% |

### 12.4 Mapping Miss Reason

| Reason | Count |
| ------ | ----: |
| no_slice_overlap_word_time | 1 |
| no_word_timespan_for_slot | 0 |
| empty_posterior | 0 |
| invalid_posterior | 0 |

### 12.5 关联归因表（本轮最重要）

| Evidence / Mapping Root Cause | Count | % of Mapping Miss |
| ----------------------------- | ----: | ----------------: |
| Short duration skipped | 0* | 0% |
| Feature extraction failed | 0 | 0% |
| Inference output missing | 0 | 0% |
| Invalid word time | 0 | 0% |
| Slice exists but no overlap | **1** | **100%** |
| WTS mapping failure | 0 | 0% |
| Unknown | 0 | 0% |

\*生产侧有 75 次 short skip，但 **关联到 Mapping Miss 的为 0**（d132 记为 overlap 类；该 case 同时存在 1 次 short skip，零时长边界可能导致归因偏向 overlap——见 §13）。

---

## 12. Root Cause Attribution Table

见上表。相对旧验收「72 Miss」：

- 旧观测把首 batch Slice 当成 Mapping 输入，**系统性误判**多 segment 缺口。
- 本轮统一 SSOT 后，真链 Mapping Miss **仅剩 1**。
- 不能把 `4155−4080=75` 直接当成「75 个 Pattern Miss」——本轮明确禁止该伪推断，且数据否定了它。

---

## 13. Unknown Cases

- Mapping 归因 **unknown = 0**。
- **代表残差：** `d132`  
  - ASR：`游泳自卡本月月底到汽蓄飞游,有诱惑吗?`  
  - WTS=17 / Slice=16 / short_skip=1  
  - Miss reason：`no_slice_overlap_word_time`  
  - Attribution：`slice_exists_but_no_overlap`  
  - 风险：零时长 Word 的 `end>start && start<end` 使诊断行与 WTS **无法时间相交**，下一轮合同修复需处理该边界。

---

## 14. Regression Results

- Span / KenLM / Domain / Assembly：**未改业务代码**
- Mapping pattern 成功路径：**保持 argmax(real posterior)**；仅对空/非法 posterior 显式失败（dialog_200 未触发）
- 多 batch 导出回归：200 case `ssotEqualsApi=true`

---

## 15. Architecture Compliance

| 规则 | 状态 |
| ---- | ---- |
| 不伪造 Slice / posterior | PASS |
| 不改 Mapping 填补 | PASS |
| 不改 Span/KenLM/Domain/Assembly | PASS |
| 单一 SSOT | PASS |
| 无 alias / dual-write 旧字段 | PASS |
| `toneOverlapSyllableMismatchCount` 当前代码/工具 = 0 | PASS |

---

## 16. Target List

- [x] API Tone == Mapping SSOT  
- [x] 多 batch 导出完整  
- [x] 验收脚本不再读首 batch 假数据  
- [x] 静默 continue → 可观测原因  
- [x] posterior 长度不一致不可静默 zip  
- [x] Mapping Miss 最小原因  
- [x] dialog_200 归因表  
- [x] 不改 Pattern 成功算法 / Span / KenLM  

---

## 17. Check List

- [x] Batch A–E 代码落地  
- [x] 单测通过  
- [x] `build:main` 通过  
- [x] dialog_200 真链 200/200  
- [x] 指定 case 表  
- [x] 归因表与 NEXT 方向  

---

## 18. Final Verdict

**PASS**

满足验收标准 1–10。未能把「历史 72 Miss」逐条在本轮重放为同一 72（ASR 非决定性 + 观测修复后残差仅 1），但已给出 **可信当前归因表** 与明确 NEXT。

---

## 19. Recommended Next Development Batch

```text
NEXT: WordTimeSpan / Slice Overlap Contract Repair
```

理由（按数量）：

1. **当前唯一 Mapping Miss（1）** 归类为 overlap / 零时长边界。  
2. **short_duration_skipped=75** 真实存在，但 **0** 次被关联为 Mapping Miss 主因 → **不**把「短 Word 扩窗」作为第一优先。  
3. **feature_extraction_failed=0** → 不优先修 Feature Extraction。

次优先（卫生项，可与合同修复并行设计）：

```text
FOLLOW-UP: Short/Zero-Duration Real-Audio Inference Window
```

---

## 二十、最终问答

1. `utterance_tone` 是否与 `ctx.acousticToneSlices` 同一 SSOT？ → **是**  
2. 多 batch API Slice == Mapping Slice？ → **是（200/200）**  
3. 是否仍存在首 batch only 导出？ → **否**  
4. dialog_200 中 dur < MIN_SLICE_SEC 的 Word？ → **75**（多为 duration=0）  
5. 其中进入 Tone-aware Recall Window 并造成 Miss？ → **关联到 Mapping Miss = 0**（生产跳过存在，但未成为 Miss 主因）  
6. 直接造成 Pattern Mapping Miss？ → **0（按归因表）**  
7. extract_feature 失败次数？ → **0**  
8. 其中造成 Mapping Miss？ → **0**  
9. posterior 与 valid_words 不一致？ → **0（本轮真链）**  
10. 原 72 Miss 现归因？ → 观测假象已消除；本轮残差 **1 = slice_exists_but_no_overlap (d132)**；历史 72 不可在本轮逐条复原为同一集合  
11. unknown？ → **0**  
12. 最大数量根因？ → **生产侧 short_duration_skipped(75) 最大但未驱动 Miss；Miss 侧唯一根因 overlap**  
13. 下一轮？ → **Overlap Contract Repair**（不是短 Word 扩窗优先）  
14. Mapping 业务结果算法？ → **成功路径未改；空/非法 posterior 显式失败**  
15. Span/KenLM/Domain/Assembly？ → **未改**  
16. 可否进入下一轮业务修复？ → **可以**
