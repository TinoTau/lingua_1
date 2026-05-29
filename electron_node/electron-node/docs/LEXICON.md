# Lexicon 运行时（V3 Canonical）

以代码为准：`main/src/lexicon/`、`scripts/lexicon/`。仓库级冻结说明另见 `docs/lexicon-v3/`。

## 1. 架构状态（2026-05）

| 项 | 状态 |
|----|------|
| Production | **Canonical-only**（无 confusion 进候选链） |
| Bundle | `node_runtime/lexicon/current`（`schemaVersion: final-v1`） |
| 当前阶梯 | **5k deploy**（`v3-canonical-asset-5k-4962`，约 4962 词） |
| `WindowCandidate.source` | 仅四类（见下表） |

### 允许的 source

| Source | 含义 |
|--------|------|
| `lexicon_pinyin_topk` | 拼音桶 TopK |
| `canonical_exact` | 词面 exact |
| `alias_exact` | 别名 exact |
| `alias_pinyin` | 别名拼音桶 |

定义：`main/src/lexicon/window-candidate-source.ts`。

**禁止**：`confusion_evidence`、`fuzzy_observed` 等（不得进入 production rerank）。

## 2. 运行时加载

- 入口：`lexicon-runtime-holder.ts` → `lexicon-runtime.ts`
- 数据：只读 SQLite（`LEXICON_BUNDLE_PATH` 或 `PROJECT_ROOT/node_runtime/lexicon/current`）
- 状态：`lexiconRuntimeStatus`：`ok` | `disabled` | `error`
- **不加载** `lexicon_confusions` 表

配置：`features.lexiconRecall`（`electron-node-config.json`）。`confusionRecallEnabled` 已移除。

## 3. Segment-first 窗召回（V5）

`window-recall.ts` → `recallSegmentWindowCandidates`：

1. **n-best diff 窗**：`nbest-diff-span.ts`、`diff-context-windows.ts`（双尺度 2–3 / 4–5，不跨 chunk）
2. 每窗：`hotword-recall.ts` → `pinyin-topk-lookup.ts` / exact / alias 索引
3. 坐标相对 **rank0 聚合段**（`SEGMENT_HYPOTHESIS_INDEX = 0`）

门限：`recallMinPhoneticScore`（默认 0.5）。

## 4. 句修复衔接（Recover）

有 `WindowCandidate` 后：

- `sentence-expansion/` — 扩展为 `SentenceCandidate`（`expansionMinPhoneticScore`）
- `sentence-rerank/` — KenLM、`kenlmBaselineTolerance`（默认 0.15）
- `applySentenceRepair` — **单次**写回段文本

契约版本：`v5-scored-lexicon-topk`（`recover-contract.ts` → `resolveRecoverContractVersion()`）。

## 4b. FW Detector span recall（非 Recover 窗）

当 `asr.engine = fw_detector_v1` 时，**不走** §3 的 n-best diff 窗；Candidate 层直接调用：

- `lexicon/local-span-recall.ts` → `recallSpanTopK(spanText, topK, minPrior, enabledDomains)`
- 门限：`features.fwDetector.recallMinPhoneticScore`（默认 0.5）
- pick 过滤：`candidateRequireRepairTarget`（仅 `repair_target` 候选）

详见 [FW_DETECTOR.md](./FW_DETECTOR.md)。

## 5. 词库构建与导入

| 命令 | 作用 |
|------|------|
| `npm run lexicon:import-v3-5k-assets` | 5k 资产包 → deploy seed + sqlite |
| `npm run lexicon:import-v3-assets` | 默认 1809 包 |
| `npm run lexicon:build` | validate + migrate + bundle |
| `npm run lexicon:rebuild-sqlite` | Electron ABI（`npm start` 前） |
| `npm run lexicon:v3-gate` | 源码 + manifest 冻结检查 |
| `npm run test:lexicon` | 单测 |

导入约束：`docs/lexicon-v3/IMPORT_CONSTRAINTS.md`。

Deploy seed：`data/lexicon/v3/lexicon_v3_5k_deploy.jsonl`。

资产包（jsonl/benchmark）：`../../docs/lexicon-assets/` — 说明见 [lexicon-assets/docs/README.md](../../lexicon-assets/docs/README.md)。

### Seed 约束（strict）

- `priorScore` ∈ (0, 1]
- `domains` 须在 `data/lexicon/profile-registry.json`
- `reviewStatus`：`approved` | `pending` | `rejected`
- 词长：CJK recall ≤ 5 字；build ≤ 8
- 无 confusion 行

## 6. 诊断字段（result.extra）

| 字段 | 说明 |
|------|------|
| `window_recall_diagnostics` | 拼音 attempt/hit、窗计数 |
| `segment_alignment_diagnostics` | rank0 对齐 |
| `recall_coverage_diagnostics` | 无窗时 bucket / whyRejected |
| `expansion_funnel` | 扩展漏斗 |
| `sentence_repair` | KenLM 选取、replacements |
| `restore_metrics` | V5 指标 |
| `v5_summary` | topk_hit、no_op_repair 等 |

无窗 bucket（V3）：`bundle_missing_observed` 为命名遗留（无 confusion 表）；`no_diff_span`、`window_budget_exceeded` 等仍有效。

## 7. Lexicon V2 Intent / Session Affinity

与词库 bundle **独立**：`main/src/lexicon-v2/`（CPU LLM Intent、session 路由）。

- Intent **不**生成 `WindowCandidate`
- Session Affinity：见 [SESSION_AFFINITY.md](./SESSION_AFFINITY.md)

## 8. 批测入口

FW 主链批测见 [FW_DETECTOR.md](./FW_DETECTOR.md)。需节点 test server `:5020` 与 `faster-whisper-vad :6007`：

```powershell
cd electron_node/electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
npm run build:main
npm start
# 另开终端：
node tests/run-fw-detector-dialog-200-batch.js "D:\Programs\github\lingua_1\test wav\dialog_200" --limit 50
```

## 相关

- [RECOVER.md](./RECOVER.md)
- [CONFIGURATION.md](./CONFIGURATION.md)
- [../scripts/README.md](../scripts/README.md)
