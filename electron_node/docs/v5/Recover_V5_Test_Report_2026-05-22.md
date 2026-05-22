# Recover V5 测试报告

**日期**：2026-05-22  
**环境**：Windows 10，Node 22，Electron 28，`PROJECT_ROOT=D:\Programs\github\lingua_1`  
**批测数据**：`test wav/dialog_200`（200 条合成对话 WAV）  
**原始结果**：`electron_node/electron-node/tests/dialog-200-batch-result.json`

---

## 1. 测试执行摘要

| 类别 | 命令 / 方式 | 结果 |
|------|-------------|------|
| 单元测试（V5 相关） | `npx jest --testPathPattern=...`（14 suites） | **35/44 PASS**（9 失败为 better-sqlite3 与 Electron ABI 冲突，见 §4） |
| 主进程编译 | `npm run build:main` | PASS |
| 词库构建 | `npm run build:lexicon-bundle` | PASS（67 hw / 194 cf） |
| 节点启动 | `npm start` + test server **5020** | PASS，`lexicon_runtime_status: ok` |
| 集成批测 | `node tests/run-dialog-200-batch.js` | **200/200 契约 PASS** |

批测耗时：约 **7.8 分钟**（200 case，平均 pipeline **~2.3s/case**，min 1.1s / max 9.0s）。

---

## 2. dialog_200 批测结果

### 2.1 总览

| 指标 | 值 |
|------|-----|
| total | 200 |
| **pass** | **200** |
| fail | 0 |
| skip | 0 |
| `recover_contract_version` | `v5-scored-lexicon-topk`（200/200） |
| `lexicon_runtime_ok` | 200/200 |
| `picked_from_raw_ctc_nbest_count` | **0** |
| `modified_without_replacement` | **0** |
| `ctc_nbest_lost` | **0** |

### 2.2 V5 专项（`summary.v5_summary`）

| 指标 | 值 | 预期 |
|------|-----|------|
| `sliding_window_count_total` | **0** | 0 |
| `windows_from_nbest_diff_ratio` | **1.0** | 有 n-best 差异时应接近 1 |
| `out_of_bundle_total` | **0** | 0 |
| `lexicon_pinyin_topk_candidate_total` | **252** | >0 |
| `skip_reason_v5.no_topk_candidate` | **147** | 合法 skip（无 TopK 命中） |

### 2.3 Recover 业务指标

| 指标 | 值 |
|------|-----|
| `window_candidates_nonempty_count` | 53 |
| `sentence_repair_modified_count` | 53 |
| `replacements_applied_count` | 53 |
| `skip_reason_distribution` | `no_window_expansion_candidate`: 147，`none`: 53 |
| `picked_from_phonetic_expansion_count` | 53 |
| `picked_candidate_source` | window_single: 37，window_pair: 16 |

### 2.4 分场景（`lexicon_homophone`）

| 指标 | 值 |
|------|-----|
| pass | 12/12 |
| 有 `window_candidates` | 12/12 |
| `sentence_repair_modified` | 12/12 |
| skip | none |

说明：**词库同音纠错场景** 下 V5 主链（diff 窗 + TopK + KenLM）端到端有效。

### 2.5 其它观测

| 项 | 值 |
|----|-----|
| `segment_alignment_mismatched` | 73/200（合成 segment 与 CTC rank0 不一致，已保留 n-best） |
| `cross_boundary_risk_count` | 0 |
| `recall_fuzzy_observed_attempt_total` | **0**（observed 主路径已关） |
| `recall_pinyin_attempt_total` | 6263 |
| `recall_pinyin_hit_total` | 252 |
| KenLM batch（有修复的 53 case）avg | **~860ms** |

---

## 3. V5 契约校验（`assessV5ContractPass`）

批测内嵌 `assessContractPass` 在 `recover_contract_version === v5-scored-lexicon-topk` 时走 V5 规则：

- `sliding_window_count === 0`
- `out_of_bundle_candidate_count === 0`
- `qualityConfig.kenlmBaselineTolerance === 0.15`
- `observedRecallEnabled === false`
- `no_diff_span` 作为合法 skip（若出现）

**200/200 通过上述契约。**

---

## 4. 单元测试

### 4.1 通过（11 suites / 35 tests）

- `scored-lexicon`, `pinyin-index`, `nbest-diff-span`, `diff-context-windows`
- `candidate-score`, `recover-safety-gates`, `quality-config`
- `window-recall`, `lexicon-recall-step`, `recover-contract`
- `recover-contract-batch-assess`

### 4.2 失败（3 suites / 9 tests）— 环境原因

在 **Electron 已 `electron-rebuild` better-sqlite3** 后，系统 Node 的 Jest 无法加载同一 `.node`（MODULE_VERSION 119 vs 127）。

受影响：

- `lexicon-runtime.test.ts`
- `pinyin-topk-lookup.test.ts`
- `lexicon-recall.test.ts`

**节点运行时** sqlite 正常（批测 `lexicon_runtime_status: ok`）。  
**建议**：CI 分两阶段 rebuild，或停 Electron 后再 `npm rebuild better-sqlite3` 跑 Jest。

---

## 5. 结论

| 维度 | 判定 |
|------|------|
| V5 架构落地 | **完成**（A–E 代码 + 默认契约） |
| 契约/安全（批测） | **通过**（200/200，无 raw CTC pick、无 out-of-bundle） |
| 同音纠错场景 | **通过**（12/12 修复） |
| 全量合成 dialog | **契约通过**；业务修复率 26.5%（53/200），受合成 ASR 与词库对齐限制 |
| 单测 | **逻辑用例通过**；sqlite 集成用例需 ABI 分离后全绿 |

---

## 6. 复现命令

```powershell
# 1. 环境
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
npx @electron/rebuild -f -w better-sqlite3
npm run build:main
npm run build:lexicon-bundle

# 2. 启动节点（另开终端）
npm start
# 等待：Test server 5020 + lexicon_runtime_status: ok

# 3. 批测
node tests/run-dialog-200-batch.js "D:\Programs\github\lingua_1\test wav\dialog_200"

# 4. 单测（需先停 Electron 再 npm rebuild better-sqlite3）
npx jest --testPathPattern="scored-lexicon|nbest-diff|pinyin-topk|window-recall|recover-safety|recover-contract"
```

---

## 7. 产物路径

| 文件 | 说明 |
|------|------|
| `electron_node/electron-node/tests/dialog-200-batch-result.json` | 全量 200 case 明细 |
| `electron_node/electron-node/logs/electron-main.log` | 节点运行日志 |
| `electron_node/docs/v5/Recover_V5_Development_Report_2026-05-22.md` | 本轮回开发报告 |
