# Recover V5 Phase E — 代码补充说明与实施约束

**对应方案**：[Recover_V5_Phase_E_Observability_Tests_Batch_Contract_2026-05-22.md](./Recover_V5_Phase_E_Observability_Tests_Batch_Contract_2026-05-22.md)  
**冻结决策**：[Recover_V5_Frozen_Decisions_2026-05-22.md](./Recover_V5_Frozen_Decisions_2026-05-22.md)（全文）  
**日期**：2026-05-22  
**前置**：Phase A–D 功能就绪

---

## 0. 已确认决策（批测须覆盖）

- D-01：`sliding_window_count=0`，`observedRecallEnabled=false`
- D-07：`cross_chunk_window_count=0`；`full_chunk_dual_scale_count=0`；`window_scale_fine_count` / `window_scale_coarse_count` 仅在 diff context 内统计
- D-06：`qualityConfig.kenlmBaselineTolerance === 0.15`
- D-03：`maxActiveWindows === 2`，无 `window_multi` picked

---

## 1. 当前可观测性与契约基线

### 1.1 契约版本

```typescript
// recover-contract.ts
RECOVER_CONTRACT_VERSION = 'historical-restore-v1'
```

Phase E 目标：`v5-scored-lexicon-topk` — **须** 与 historical 批测分叉（feature flag 或新 assess 模块）。

### 1.2 `result.extra` 已有字段（`result-builder.ts` L45–118）

| 字段 | 说明 |
|------|------|
| `recover_contract_version` | 契约版本 |
| `recover_lifecycle` | executed/gated/skipped/skipReason |
| `window_candidates` | `WindowCandidate[]`，无 per-hit trace |
| `window_recall_diagnostics` | 聚合计数 |
| `recall_coverage_diagnostics` | 无窗时 |
| `segment_alignment_diagnostics` | augment 对齐 |
| `nbest_augment_diagnostics` | augment 汇总 |
| `expansion_funnel` / `expansion_selector_reject` | 扩展漏斗 |
| `sentence_repair` | 句级修复 extra |
| `restore_metrics` | picked_from_raw、source 分布 |
| `qualityConfig` | **完整** `RecoverQualityConfig` 快照 |
| `sentence_candidates` | 句候选列表（有则输出） |

**缺失**：`v5_metrics`、`lexicon_recall_trace[]`、V5 六项 `skip_reason_v5_distribution`。

### 1.3 `WindowCandidate` 当前字段

`hotword-types.ts`：`windowId, hypothesisIndex, from, to, start, end, hotwordId, phoneticScore, priorScore, source`

**无**：`windowPinyin`, `candidatePinyin`, `candidateScore`, `rankInTopK`, `termLength`, `kenlmScore`, `picked`。

### 1.4 批测（`tests/run-dialog-200-batch.js`）

- 依赖 `./lib/recover-contract-assess.js`（`assessContractPass`）
- 输出 `dialog-200-batch-result.json`
- 已有行字段：`window_candidate_count`, `repair_skip_reason`, `restore_metrics`, `contract_failures` 等
- **无** V5：`sliding_window_count`, `windows_from_nbest_diff_ratio`, `skip_reason_v5_distribution`

### 1.5 Homophone 验收（`run-homophone-expectation.js`）

- 读取批测 JSON
- 规则含 `forbidRawCtcPick`、`picked_from_raw_ctc_nbest_count`
- **未** 覆盖 V5 TopK / diff 窗 — Phase E 须扩展 expectation schema 或新增 `homophone_expectations_v5.json`

### 1.6 文档

- `electron_node/docs/RECOVER.md`：historical-restore-v1 主链
- Phase E 须更新为 V5 主链 + 链接 v5/ 目录

---

## 2. Phase E 必须新增的 result 结构

### 2.1 契约版本升级

```typescript
export const RECOVER_CONTRACT_VERSION_V5 = 'v5-scored-lexicon-topk';
```

**约束 E-C1**：V5 模式下 `buildRecoverContractExtra` 输出 v5 版本；historical 模式保留 v1 供回归对比（配置 `features.lexiconRecall.contractVersion`）。

### 2.2 `v5_metrics`（job 级）

```typescript
type V5Metrics = {
  windows_from_nbest_diff_count: number;
  windows_enumerated: number;
  sliding_window_count: number;              // 目标 0
  lexicon_pinyin_topk_candidate_count: number;
  out_of_bundle_candidate_count: number;     // 目标 0
  picked_from_raw_ctc_nbest_count: number;   // 目标 0
  modified_without_replacement_count: number;// 目标 0
  no_diff_span_count: number;                // 0|1 per job 或累计
  skip_reason_v5: Partial<Record<V5SkipReason, number>>;
  topk_hit_rate_by_term_length: Record<'2'|'3'|'4'|'5', number>;
  window_length_distribution: Record<number, number>;
};
```

写入：`result.extra.v5_metrics`（仅 V5 contract 开启时）。

### 2.3 `lexicon_recall_trace`（per-candidate）

```typescript
type LexiconRecallTraceItem = {
  windowText: string;
  windowPinyin: string;       // syllables join 或空格分
  windowTrigger?: string;     // nbest_diff
  diffSpanId?: string;
  candidate: string;
  candidatePinyin: string;
  candidateScore: number;
  priorScore: number;
  phoneticScore: number;
  termLength: number;
  rankInTopK: number;
  source: 'lexicon_pinyin_topk';
  kenlmScore?: number;        // 句级 rerank 后回填 picked
  picked?: boolean;
};
```

**约束 E-C2**：禁止仅 `console.log`；数组长度上限建议 **128**（与 nbest drop events 一致），超出记 `trace_truncated: true`。

### 2.4 `qualityConfig` 完整 V5 快照

Phase A stub 字段在 Phase E **必须**有实际值（非 undefined）：

```json
{
  "allowedWindowLengths": [2, 3, 4, 5],
  "diffContextLeft": 2,
  "diffContextRight": 2,
  "topKByTermLength": { "2": 5, "3": 5, "4": 3, "5": 2 },
  "maxActiveWindows": 2,
  "maxSentenceCandidates": 32,
  "minCandidateScore": 0,
  "kenlmBaselineTolerance": 0.15,
  "forbidCrossChunkWindows": true,
  "windowScalesInContext": { "fine": [2, 3], "coarse": [4, 5] },
  "nearPinyinEnabled": true,
  "englishLookupMode": "exact_token_only",
  "observedRecallEnabled": false
}
```

---

## 3. 批测与契约 assess 改造

### 3.1 `recover-contract-assess.js`

当前检查（historical）：

- `recover_contract_version === 'historical-restore-v1'`
- `picked_from_raw_ctc_nbest`
- `modified_without_replacement`
- `ctc_nbest_lost`
- lexicon ok、lifecycle executed 等

**新增** `assessV5ContractPass(extra, data)`：

| 条件 | 失败码 |
|------|--------|
| version !== v5 | `recover_contract_version` |
| sliding_window_count > 0 | `sliding_window_active` |
| out_of_bundle > 0 | `out_of_bundle` |
| window length 含 1 或 ≥6 | `invalid_window_length` |
| skip 无 JSON | `skip_not_in_extra` |

**约束 E-C3**：`no_diff_span` 为 **合法** skip（pass 若 skipped 且 reason 正确），与 historical `no_window_expansion_candidate` 区分。

### 3.2 `run-dialog-200-batch.js`

summary 段新增：

```javascript
v5_summary: {
  windows_from_nbest_diff_ratio,
  sliding_window_count_total,
  skip_reason_v5_distribution,
  lexicon_pinyin_topk_picked_ratio,
  ...
}
```

从每 case `extra.v5_metrics` 聚合。

### 3.3 批测运行前提（不变）

```text
PROJECT_ROOT=<repo>
npm run build:main
npm run start   # test server 5020
node tests/run-dialog-200-batch.js
```

环境：`LEXICON_BUNDLE_PATH` 或 `node_runtime/lexicon/current`；`features.lexiconRecall.enabled=true`。

---

## 4. 测试矩阵（Phase E 补齐）

### 4.1 单测归属（避免重复）

| 主题 | 主责 Phase | Phase E 动作 |
|------|------------|--------------|
| diff span | B | E：集成 smoke + batch 指标 |
| TopK / score | C | E：契约字段存在性 |
| gates | D | E：六项 distribution 聚合测试 |
| manifest / prior | A | E：build 后 bundle smoke |

### 4.2 建议新增/更新文件

| 文件 | 用途 |
|------|------|
| `tests/recover-contract-v5-assess.test.js` | V5 pass/fail |
| `tests/v5-metrics-aggregator.test.js` | 批测 summary 逻辑 |
| `main/src/pipeline/result-builder.test.ts` | v5_metrics、trace 输出 |
| `main/src/pipeline/recover-contract.test.ts` | v5 版本分支 |

### 4.3 删除/废弃

| 项 | 说明 |
|----|------|
| `gen-dialog-200-report.js` | 已删；Phase E 可新建 `gen-dialog-200-v5-report.mjs`（可选 P2） |
| 期望 `recover/v3`、`recover/v4` 报告路径 | 勿引用；输出到 `docs/v5/` 或 CI artifact |

---

## 5. V5 最终 Pass 条件（与代码对齐）

方案 Phase E §8：

```text
recover_contract_version === 'v5-scored-lexicon-topk'
ctc_nbest_preserved === true
picked_from_raw_ctc_nbest_count === 0
modified_without_replacement_count === 0
out_of_bundle_candidate_count === 0
sliding_window_count === 0
window_length_distribution ⊆ {2,3,4,5}
```

**补充约束 E-C4**：

- `lexicon_runtime_status === 'ok'` 仍为必要（与 historical 一致）
- `recover_skipped === true` 且 `skipReason in V5_SET` 时 **仍可为 contract pass**（未强修）
- `recover_skipped === false` 时须有 `lexicon_pinyin_topk` picked 或 `modified===false` 显式未改

---

## 6. 文件修改清单

| 文件 | 变更 |
|------|------|
| `pipeline/recover-contract.ts` | V5 版本常量、extra 类型 |
| `pipeline/result-builder.ts` | v5_metrics、lexicon_recall_trace |
| `pipeline/context/job-context.ts` | 可选 ctx 缓存 trace |
| `tests/lib/recover-contract-assess.js` | 或新建 v5-assess |
| `tests/run-dialog-200-batch.js` | V5 summary |
| `tests/run-homophone-expectation.js` | V5 规则（可选） |
| `docs/RECOVER.md` | V5 主链文档 |
| `docs/README.md` | 索引（已含 v5） |

---

## 7. 报告输出（Phase E 交付物）

批测完成后一份 JSON summary 应能回答（方案 §9）：

1. 窗是否来自 n-best diff？ → `windows_from_nbest_diff_ratio`
2. 是否还有滑窗？ → `sliding_window_count === 0`
3. TopK 是否按词长？ → `topk_hit_rate_by_term_length`
4. 候选是否合法词库？ → `out_of_bundle_candidate_count === 0`
5. KenLM 是否只过滤句候选？ → `restore_metrics` 无 raw pick
6. skip 是否可解释？ → `skip_reason_v5_distribution`
7. raw CTC 是否隔离？ → `picked_from_raw_ctc_nbest_count === 0`

可选 Markdown：`*_V5_Batch_Test_Report_YYYY-MM-DD.md` 由 summary JSON 生成。

---

## 8. 禁止项（Phase E）

| ID | 禁止 |
|----|------|
| E-X1 | Phase E 改 TopK/diff 算法（仅观测+契约+测） |
| E-X2 | 破坏 historical 批测默认路径（须显式 `--v5` 或 config） |
| E-X3 | trace 无上限导致 extra 爆 JSON（dialog_200 上传失败） |
| E-X4 | 仅更新文档不接线 `result-builder` |

---

## 9. 阶段开关建议

```json
// electron-node-config.json features.lexiconRecall
{
  "enabled": true,
  "contractVersion": "v5-scored-lexicon-topk",
  "useDiffWindows": true,
  "observedRecallEnabled": false
}
```

批测脚本读取同一 config 或 `--contract v5` CLI 参数。

---

## 10. 全阶段文档索引

| 文档 | 类型 |
|------|------|
| Recover V5 冻结方案.md | 架构冻结 |
| Recover_V5_Readonly_Code_Audit_2026-05-22.md | 只读审计 |
| Recover_V5_Phase_A~E_*.md | 阶段技术方案 |
| Recover_V5_Phase_A~E_Supplement_Constraints_2026-05-22.md | 本文档系列（代码约束） |

推荐实施顺序：**A → B → C → D → E**（E 的契约与批测可与 D 部分并行）。
