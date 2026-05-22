# Recover V5 开发报告（Phase A–E）

**日期**：2026-05-22  
**范围**：`electron_node/electron-node/main` Recover V5 主链替换（无 V4 双轨 flag）  
**依据**：[Recover V5 冻结方案](./Recover%20V5%20冻结方案.md)、[Frozen Decisions](./Recover_V5_Frozen_Decisions_2026-05-22.md)

---

## 1. 目标与结论

| 项 | 结论 |
|----|------|
| 架构 | 已按 **A→E** 落地：`scored lexicon` → `n-best diff 窗` → `TopK` → `KenLM 门控` → `v5 契约/批测` |
| 契约版本 | 默认 **`v5-scored-lexicon-topk`**（`node-config-defaults`） |
| 批测契约 | **200/200 PASS**（`dialog_200`，见测试报告） |
| 遗留 | 147/200 仅有 diff 窗、无 TopK 命中（合成语音 ASR 与词库未对齐，属数据/场景问题，非滑窗回退） |

---

## 2. Phase A — Scored Lexicon 数据基础

### 2.1 交付

| 模块 | 说明 |
|------|------|
| `lexicon/scored-lexicon.ts` | `priorScore` 仅来自 bundle；`isIndexableHotwordEntry`；manifest V5 统计 |
| `scripts/build-lexicon-bundle.mjs` | sqlite 列 `prior_score`/`tags`；`terms_without_prior_count=0` |
| `lexicon/lexicon-runtime.ts` | 无 `prior_score` 列即 error；索引按 **priorScore DESC** |
| `recover-quality/quality-config.ts` | V5 配置字段 stub 并接线 |

### 2.2 构建产物

- Bundle：`node_runtime/lexicon/current/lexicon.sqlite`
- Manifest：`recover-v5-scored-lexicon`，67 hotwords / 194 confusions

---

## 3. Phase B — N-best Diff 窗管线

### 3.1 交付

| 模块 | 说明 |
|------|------|
| `lexicon/nbest-diff-span.ts` | 不等长 n-best 字符 diff → segment 坐标 |
| `lexicon/diff-context-windows.ts` | diff context ±2 ∩ chunk；fine 2–3 + coarse 4–5 |
| `lexicon/window-recall.ts` | **默认** diff 主路径；无 diff → `no_diff_span`；禁滑窗 fallback |

### 3.2 调试开关

- `LEXICON_LEGACY_SLIDING_WINDOW=1`：仅本地调试旧滑窗，**不进入 V5 批测 pass 语义**

---

## 4. Phase C — TopK + candidateScore

### 4.1 交付

| 模块 | 说明 |
|------|------|
| `lexicon/pinyin-topk-lookup.ts` | `lookupTopKByPinyin`：exact + near（索引桶，禁全表 fuzzy） |
| `lexicon/candidate-score.ts` | `prior + phonetic + length bonus + domain`（无 KenLM） |
| `lexicon/hotword-recall.ts` | 主路径仅 TopK；`observedRecallEnabled` 默认 **false** |
| `WindowCandidate` | `source=lexicon_pinyin_topk`，`candidateScore`，`rankInTopK` |

### 4.2 TopK 限额（冻结）

`2→5, 3→5, 4→3, 5→2`

---

## 5. Phase D — 安全门控

| skipReason | 接入点 |
|------------|--------|
| `no_diff_span` | `lexicon-recall-step` |
| `no_topk_candidate` / `low_candidate_score` / `candidate_budget_exceeded` | `lexicon-recall-step` |
| `replacement_count_exceeded` | `sentence-repair-step`（`maxActiveWindows=2`） |
| `kenlm_worse_than_baseline` | `sentence-repair-step`（`tolerance=0.15`） |

模块：`asr-repair/recover-safety-gates.ts`

---

## 6. Phase E — 观测与批测

| 项 | 说明 |
|----|------|
| `pipeline/v5-metrics.ts` | `extra.v5_metrics`、`lexicon_recall_trace`（≤128 条） |
| `recover-contract.ts` | `RECOVER_CONTRACT_VERSION_V5`，`resolveRecoverContractVersion()` |
| `tests/lib/recover-contract-assess.js` | `assessV5ContractPass` |
| `tests/run-dialog-200-batch.js` | `summary.v5_summary` 聚合 |

---

## 7. 关键文件清单

```
main/src/lexicon/
  scored-lexicon.ts, pinyin-topk-lookup.ts, candidate-score.ts
  nbest-diff-span.ts, diff-context-windows.ts
  hotword-recall.ts, window-recall.ts, lexicon-runtime.ts
main/src/asr-repair/recover-safety-gates.ts
main/src/pipeline/v5-metrics.ts, recover-contract.ts, result-builder.ts
main/src/recover-quality/quality-config.ts
scripts/build-lexicon-bundle.mjs
```

---

## 8. 环境与构建注意

1. **Electron 与 Jest 的 better-sqlite3 ABI 不同**  
   - 节点运行：`npx @electron/rebuild -f -w better-sqlite3`  
   - 单元测试（系统 Node）：`npm rebuild better-sqlite3`（需在 **未占用** sqlite 时执行，勿与 Electron 同时 rebuild）

2. 启动节点：

```powershell
$env:PROJECT_ROOT="D:\Programs\github\lingua_1"
cd electron_node\electron-node
npm run build:main
npm start
```

3. 词库构建：

```powershell
npm run build:lexicon-bundle
```

---

## 9. 已知限制（非回归）

- **合成 dialog_200** 大量 ASR 错误与词库 hotword 不对齐 → diff 窗有、TopK 常空（147/200）。
- **lexicon_homophone** 场景 12/12 有窗且写回，验证 V5 主链有效。
- 用户配置 `maxReplacements=4` 仍高于 V5 冻结 `maxActiveWindows=2`；selector 以节点配置为准，门控在 expansion 层限制为 2。

---

## 10. 后续建议

1. 用真实录音或对齐词库的 homophone 集扩大 **TopK 命中率** 评估。
2. 将用户 `electron-node-config.json` 中 `maxReplacements` 同步为 **2**，与 V5 冻结一致。
3. CI 分 job：`electron-rebuild` 集成测 + `npm rebuild` 单测，避免 ABI 互相覆盖。
