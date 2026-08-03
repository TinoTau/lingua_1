# FW Repair V4 — Tone Evidence / Mapping Contract Final Freeze Report

| Field | Value |
|-------|-------|
| Date | 2026-07-29 |
| Nature | 文档整理 · 合同冻结 · 最小回归补齐 · 代码/文档一致性检查 |
| Production logic change | **无**（未使用 `MODIFY_BUSINESS_LOGIC`） |
| Authority | Runtime SSOT §0A · 本报告 |
| Verdict | **FREEZE_PASS** |

---

## 1. Executive Summary

Tone Evidence / Tone Mapping 开发线正式结束并冻结。

```text
dialog_200: Pattern Attempt=289 · Hit=288 · Miss=1 · Coverage=99.65%
Sole miss: d132 / window「诱惑」/ Word「诱」[3.0,3.0]
→ short_duration_skipped → no_slice_overlap_word_time → pattern=null
→ FREEZE_AS_EVIDENCE_UNAVAILABLE（合法业务状态）
```

唯一 SSOT = `ctx.acousticToneSlices`。半开区间 overlap 不变。禁止 Fill / 邻 Slice 借用。API / Mapping / Diagnostics / Acceptance 已对齐。本轮仅补齐冻结回归测试与 CURRENT 文档，未改生产 Mapping/Inference 算法。

---

## 2. Frozen Scope

```text
Module: Tone Evidence / Tone Mapping
Status: FROZEN

Frozen Contract:
Real Audio Evidence Only
Single SSOT
Strict Half-Open Overlap
Evidence Unavailable Allowed
No Tone Fill
No Neighbor Borrowing
```

涵盖：Tone inference 跳过策略、Slice 合并导出、Mapping overlap、missReason、Evidence Unavailable 语义、诊断字段白名单。

**不在本冻结内：** Lexicon 质量、KenLM 质量、Fine Span / Lattice Path、Domain Vote 公式（另有 SSOT）。

---

## 3. Final Runtime Contract

```text
有效 Word：start < end → 允许从真实音频生成 AcousticToneSlice + posterior
无效 / 过短 / 特征失败 / 推理缺失 → 可不生成 Evidence，必须保留诊断
有真实相交 Slice → Mapping 读真实 posterior → pattern
无真实相交 → pattern=null + missReason → 下游无 Tone 路径
Mapping 不补 Evidence；不得复制邻 posterior / 文本猜调 / 拼音猜调
```

---

## 4. Evidence SSOT

| Consumer | Source | Status |
|----------|--------|--------|
| Production Mapping | `ctx.acousticToneSlices` via `fw-detector-v4-path` → `recallTopKForWindows` | **KEEP** |
| API `extra.utterance_tone` | `buildUtteranceToneFromSsot(ctx)` ← `ctx.acousticToneSlices` | **KEEP** |
| Diagnostics / Trace | 全量 SSOT + `toneEvidenceProduction` | **KEEP** |
| Acceptance scripts | SSOT counts（禁止优先 `asrToneSliceCount`） | **KEEP** |

禁止恢复：`ctx.asrResult.tone` 作为业务 Slice 来源或首 batch 优先观测。

---

## 5. Production Contract

允许不生成 Evidence（须诊断）：

| Status | Meaning |
|--------|---------|
| `slice_created` | 成功 |
| `short_duration_skipped` | `start >= end` 或 `duration < MIN_SLICE_SEC` |
| `feature_extraction_failed` | 特征失败 |
| `inference_output_missing` | 推理输出缺失 |
| `invalid_word_time` | 非法 Word 时间 |

禁止：邻 Slice 借用 · posterior 填充 · 人为生成 Slice。

---

## 6. Mapping Contract

半开区间（冻结）：

```ts
slice.end > span.start && slice.start < span.end
```

禁止改为 `>=` / `<=`（零时长点会同时绑定前后 Slice，造成 Tone 串位）。

`selectRealSliceForWordSpan` / `mapToneEvidenceForRecall` 已符合；无真实相交 → `no_slice_overlap_word_time`。

---

## 7. Evidence Unavailable Contract

```text
start >= end 或没有真实相交 Tone Slice
→ Evidence Unavailable
→ pattern=null
→ 保留诊断
→ 下游走无 Tone 路径
```

合法业务状态，**不是**必须修复的异常。d132 为其固定回归代表。

---

## 8. Diagnostics Contract

**保留** Production status 与 Mapping missReason（见 §5 / 任务 §四）。

**禁止恢复 / 别名：**

- `toneOverlapSyllableMismatchCount`（已改为 `tonePatternMappingMissCount`，无兼容别名）
- `asrToneSliceCount` 作为验收优先字段

---

## 9. Regression Coverage

文件：`electron_node/.../fw-detector/tone-time-align.test.ts`

| Case | Expected | Coverage |
|------|----------|----------|
| Word [1.00,1.20] ∩ Slice [1.00,1.20] | HIT | **新增** Frozen block |
| Word [1.00,1.20] ∩ Slice [1.10,1.30] | HIT | **新增** |
| Word [1.00,1.20] ∩ Slice [1.20,1.40] | NO OVERLAP | **新增** |
| Word [1.20,1.20] + 前后 Slice | pattern=null；不绑邻 | **新增**（d132-class） |
| missReason 四类 | 已有 | **KEEP**（不重复） |
| SSOT 多 batch 导出 | `utterance-tone-ssot.test.ts` | **KEEP** |
| Attribution short_duration_skipped | `tone-miss-attribution.test.ts` | **KEEP** |

Jest：`tone-time-align.test.ts` — **13 passed**（含 Frozen block 4 条）。

未新增生产代码；未重复造 d132 全链路 live fixture（单位测试已覆盖等价合同）。

---

## 10. Code / Document Consistency

| Path | Classification |
|------|----------------|
| `tone_module/inference.py` statuses | **KEEP** |
| `asr-step.ts` merge `acousticToneSlices` + `toneEvidenceProduction` | **KEEP** |
| `utterance-tone-ssot.ts` / `result-builder-core.ts` | **KEEP** |
| `tone-time-align.ts` half-open + missReason | **KEEP** |
| `fw-detector-v4-path.ts` `acousticSlices: ctx.acousticToneSlices` | **KEEP** |
| Acceptance scripts SSOT | **KEEP** |
| Runtime SSOT §0A + Index + FROZEN.md | **DOCUMENT**（本轮已写） |
| Frozen overlap tests | **TEST_ONLY** |
| 历史「72 Miss / 首 batch / Slice 丢失」CURRENT 引用 | **DELETE_STALE_DOC**（已 SUPERSEDED 标记） |

本轮 **无** `MODIFY_BUSINESS_LOGIC`。

---

## 11. Stale Conclusions Removed

从 CURRENT 引用中清除（历史文件保留 + SUPERSEDED 横幅）：

| 过时结论 | 正确结论 |
|----------|----------|
| 多 batch Tone Slice 在生产 Mapping 前丢失 | 生产 Mapping 一直用全量 `ctx.acousticToneSlices`；历史缺口是导出/观测假象 |
| 72 Pattern Miss 来自 Slice 未合并 | 统一导出后 Coverage 99.65%；残差 1 = Evidence Unavailable |
| short Word 扩窗是当前第一优先 | 75 short_skip 中仅 1 进入 Miss；不扩窗、不 Fill |
| Feature Extraction 是当前主要失败源 | 当前 feature/infer miss = 0 |
| Span 是 Tone Participation 当前瓶颈 | Miss 在 Evidence Unavailable，非 Span 滑窗 |

---

## 12. Frozen Files and Functions

| Area | Files / Functions |
|------|-------------------|
| Mapping | `mapToneEvidenceForRecall`, `selectRealSliceForWordSpan`, `selectSlicesByTimeOverlap` |
| WTS | `buildWordTimeSpans`（透传 start/end；不伪造 duration） |
| SSOT export | `buildUtteranceToneFromSsot` |
| ASR merge | `runAsrStep` → `ctx.acousticToneSlices` |
| Inference | `run_tone_inference` skip statuses |
| Attribution | `attributeMappingMiss` |
| Wiring | `runFwDetectorV4Path` → `acousticSlices: ctx.acousticToneSlices` |

---

## 13. Allowed Future Change Conditions

仅当以下之一成立才可解冻：

1. Tone 模型输入合同变更  
2. ASR timestamp 合同变更  
3. 大规模真实测试证明 Evidence Unavailable 已成为业务瓶颈  
4. Architecture SSOT 正式批准变更  

不得因单个 Case（含 d132）或覆盖率统计重新解冻。

---

## 14. Target List

| ID | Action | Status |
|----|--------|--------|
| T1 | Runtime SSOT §0A 冻结块 | Done |
| T2 | Index / FROZEN.md 登记 | Done |
| T3 | 历史 Tone 审计 SUPERSEDED | Done |
| T4 | 半开区间 + 零时长回归测试 | Done |
| T5 | 生产逻辑保持不动 | Done |

---

## 15. Check List

- [x] SSOT = `ctx.acousticToneSlices`  
- [x] API / Mapping / Diagnostics 一致  
- [x] 无首 batch only 业务读取  
- [x] overlap 半开不变  
- [x] 零时长 → pattern=null  
- [x] 无邻借用 / Fill  
- [x] d132-class 固定回归  
- [x] 未重复堆测试 / 未冗余生产代码  
- [x] 过时结论已标记  
- [x] CURRENT 文档已更新  

---

## 16. Final Freeze Verdict

### 必须回答

1. Tone Evidence 唯一 SSOT？ → **`ctx.acousticToneSlices`**  
2. API、Mapping、Diagnostics 全部一致？ → **是**  
3. 仍有首 batch only 业务读取？ → **否**  
4. 正常 overlap 公式不变？ → **是**（半开）  
5. 零时长 Word 仍 pattern=null？ → **是**  
6. 邻 Slice 借用或 posterior 填充？ → **否**  
7. d132 已固定为合法回归？ → **是**（单位测试 d132-class + 审计记录）  
8. 补了重复测试或冗余代码？ → **否**（仅最小 Frozen block）  
9. 哪些历史结论过时？ → 见 §11  
10. 当前有效文档已更新？ → **是**  
11. Tone Evidence / Mapping 可正式冻结？ → **是**  
12. 下一主链开发可不再依赖 Tone 修改？ → **是**  

```text
FREEZE_PASS
```
