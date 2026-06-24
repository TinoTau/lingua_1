# Lexicon 运行时（V3 Canonical）

> **FW 主链** 使用 `node_runtime/lexicon/v3` + `LexiconRuntimeV2`（schema `lexicon-v3-five-table-v2`）。  
> 下文 §1–§3 为 **Legacy Recover** 路径（`current/`），见 `node_runtime/lexicon/current/README.md`。

---

## 1. V3 架构（Legacy recover 路径）

| 项 | 状态 |
|----|------|
| Production | **Canonical-only**（无 confusion 进候选链） |
| Bundle | `node_runtime/lexicon/current`（`schemaVersion: final-v1`） |
| 当前阶梯 | **5k deploy**（约 4962 词） |

### 允许的 WindowCandidate.source

| Source | 含义 |
|--------|------|
| `lexicon_pinyin_topk` | 拼音桶 TopK |
| `canonical_exact` | 词面 exact |
| `alias_exact` | 别名 exact |
| `alias_pinyin` | 别名拼音桶 |

定义：`window-candidate-source.ts`。禁止 `confusion_evidence`、`fuzzy_observed` 等。

---

## 2. 运行时加载

- 入口：`lexicon-runtime-holder.ts` → `lexicon-runtime.ts`
- 数据：只读 SQLite（`LEXICON_BUNDLE_PATH` 或 `PROJECT_ROOT/node_runtime/lexicon/current`）
- 状态：`lexiconRuntimeStatus`：`ok` | `disabled` | `error`
- **不加载** `lexicon_confusions` 表

配置：`features.lexiconRecall`（legacy 路径）。`confusionRecallEnabled` 已移除。

---

## 3. Segment-first 窗召回（Legacy V5）

`window-recall.ts` → `recallSegmentWindowCandidates`：

1. n-best diff 窗：`nbest-diff-span.ts`、`diff-context-windows.ts`（双尺度 2–3 / 4–5，不跨 chunk）
2. 每窗：`hotword-recall.ts` → `pinyin-topk-lookup.ts` / exact / alias
3. 坐标相对 rank0 聚合段

门限：`recallMinPhoneticScore`（默认 0.5）。

---

## 4. FW 主链 Recall（非 V3 窗路径）

默认 `asr.engine = fw_detector_v1`：

- Span 级：`local-span-recall.ts` → `recallSpanTopK` → V2 SQLite
- 开关：`lexiconRuntimeV2.enabled` + `useLexiconRuntimeV2Recall`
- 文档：[`../fw-detector/README.md`](../fw-detector/README.md)、[`../../../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md`](../../../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md)

---

## 5. 词库构建

| 命令 | 作用 |
|------|------|
| `npm run lexicon:import-v3-5k-assets` | 5k 资产 → deploy seed + sqlite |
| `npm run lexicon:build` | validate + migrate + bundle |
| `npm run lexicon:rebuild-sqlite` | Electron ABI 重建 |
| `npm run lexicon:v3-gate` | 冻结检查 |
| `npm run test:lexicon` | 单测 |

Deploy seed：`data/lexicon/v3/lexicon_v3_5k_deploy.jsonl`。  
导入约束：[`electron_node/lexicon-assets/docs/IMPORT_AND_GATE.md`](../../../../electron_node/lexicon-assets/docs/IMPORT_AND_GATE.md)。

---

## 6. Legacy extra 诊断字段

| 字段 | 说明 |
|------|------|
| `window_recall_diagnostics` | 拼音 attempt/hit |
| `segment_alignment_diagnostics` | rank0 对齐 |
| `recall_coverage_diagnostics` | 无窗时 bucket |
| `expansion_funnel` | 扩展漏斗 |
| `sentence_repair` | KenLM 选取 |
| `restore_metrics` / `v5_summary` | V5 指标 |

FW 路径不输出上述 legacy 字段。

---

## 相关

| 文档 | 路径 |
|------|------|
| Lexicon V2 | [`../../../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md`](../../../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md) |
| Legacy ASR repair | [`../legacy/asr-repair/README.md`](../legacy/asr-repair/README.md) |
| Session Intent | [`../session-runtime/README.md`](../session-runtime/README.md) |
