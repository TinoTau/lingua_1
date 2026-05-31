# Lexicon Runtime V2 — P3.2 KenLM Span Gate 开发报告

版本：V1.0  
日期：2026-05-30  
依据：`P3_2_KenLM_Span_Gate_补充冻结方案_V1_1.md`、`P3_2_KenLM_Span_Gate_FW_only_开发方案_2026_05_30.md`

---

## 1. 开发目标

在 Phase 3 V2 Recall 已接入、Hotfix 已证明 **候选 SQL 限额 alone 无法抑制 Explosion** 的前提下，用 **KenLM Span Gate** 替代 legacy suspicious-span detector，将 span 入口压到 **≤2/job**，再进入 V2 Recall → KenLM weak_veto → Apply。

目标流程：

```text
rawAsrText → KenLM Span Gate (≤2 spans) → V2 Recall (LIMIT 2/3/0) → KenLM weak_veto → Apply
```

---

## 2. 修改文件列表

| 文件 | 变更摘要 |
|------|----------|
| `main/src/asr-repair/kenlm-span-selector.ts` | **新增**：CJK 窗口枚举、stopword 过滤、delete-span pseudo delta、preFilter、top-N 选择 |
| `main/src/asr-repair/kenlm-span-selector.test.ts` | 单元测试 |
| `main/src/fw-detector/fw-detector-orchestrator.ts` | gate 接入、0 span 早退、gate/veto diagnostics |
| `main/src/fw-detector/fw-config.ts` | `spanGateMode` / `kenlmSpanGate` / `isKenlmSpanGateActive()` |
| `main/src/fw-detector/types.ts` | `kenlm_local_low_prob`、`KenlmSpanGateDiagnostics` |
| `main/src/node-config-types.ts` | `spanGateMode`、`kenlmSpanGate` 类型 |
| `main/src/node-config-defaults.ts` | 默认 `kenlm_gate_filter` |
| `tests/run-lexicon-v2-phase3-p32-batch.js` | **新增** P3.2 批测脚本（支持 `--max-minutes`） |
| `tests/analyze-phase3-p32-audit.mjs` | **新增** gate/veto/质量/性能分析 |

**未修改（冻结）：** `kenlm-span-gate.ts`、`fw-topk-decision-pipeline.ts`、`suspicious-span-detector-v1.ts`、`apply-span-replacements.ts`

---

## 3. 冻结约束落实情况

| 约束 | 状态 |
|------|------|
| Span Gate 输入仅 `ctx.rawAsrText` | ✅ |
| KenLM 不可用 → 0 span，**不回退 legacy detector** | ✅ |
| Scorer 在 `enableKenLMGate \|\| spanGateActive` 时启用 | ✅ |
| 0 span 时跳过 Recall/Pipeline，输出 rawText | ✅ |
| 不修改 weak_veto / pick / apply 决策链 | ✅ |

---

## 4. 默认配置

```json
"spanGateMode": "kenlm_gate_filter",
"kenlmSpanGate": {
  "enabled": true,
  "maxSpans": 2,
  "minSpanChars": 2,
  "maxSpanChars": 4,
  "minLocalDelta": 0.05,
  "stopwordFilterEnabled": true,
  "preFilterMaxWindows": 20
},
"lexiconRuntimeV2": {
  "maxBaseCandidates": 2,
  "maxDomainCandidates": 3,
  "maxIdiomCandidates": 0
}
```

回滚：`spanGateMode: "legacy_detector"`，`kenlmSpanGate.enabled: false`

---

## 5. 单元 / 门禁验证

| 项 | 结果 |
|----|------|
| `jest kenlm-span-selector` | PASS |
| `jest freeze-contract` | PASS |
| `node scripts/fw-detector-gate.mjs` | PASS |
| `npm run build` | PASS |

---

## 6. dialog_200 批测摘要（限时 15 min）

| 项 | 值 |
|----|-----|
| 命令 | `node tests/run-lexicon-v2-phase3-p32-batch.js --max-minutes 15` |
| 完成 case | **63 / 200**（墙钟 900 s，到限即停） |
| 契约 | **63 / 63 PASS**，0 FAIL |
| span/job P95 | **1**（max **2**） |
| span recall 调用 | **13** 次（Hotfix 全量 **2298** 次，↓ **99.4%**） |
| FW apply 总计 | **0** |
| 平均 CER（63 条） | raw **37.73%**，final **37.73%**（无改写） |
| pipeline P95 | **16060 ms** |

详细数据见：`Lexicon_Runtime_V2_P3_2_测试报告_dialog200_2026_05_30.md`

---

## 7. 结论与后续

### 7.1 已达成

- **Span Explosion 被切断**：span/job 从 Hotfix 的 ~11.5 降至 **≤2**，recall 调用从 2298 降至 13（63 条子集）。
- **FW 劣化归零**：63 条内 fw_degraded = 0，CER 未因错误 apply 抬高（对比 Hotfix 51.62%）。
- **merge cap 无违规**：`merge_cap_violations = 0`。

### 7.2 未达成 / 待观察

| 验收项 | 目标 | P3.2（63 条） | 说明 |
|--------|------|---------------|------|
| 全量 200/200 | 200 PASS | 63 PASS | 受 15 min 墙钟限制，非功能失败 |
| CER ≤ Phase 2 | ≤ 35.93% | 37.73% | 无 FW 改善 case；与 raw 相同 |
| FW apply 有益修复 | 接近 Phase 2（~10） | **0** | Gate 过严，未召回 cafe 等同音修复 |
| pipeline P95 | < Hotfix 20672 ms | 16060 ms | ✅ 有改善，但仍 >> Phase 2 7458 ms |
| KenLM 总耗时 | < Hotfix | gate avg 11906 ms | 每条 job 均跑 gate（~21 query），0 span 也 ~12 s |

### 7.3 建议（P3.3 方向）

1. **Gate 阈值调优**：`minLocalDelta` / stopword / preFilter，在 span≤2 前提下恢复少量高置信 repair（如 cafe 钟贝→中杯）。
2. **0-span 快路径**：KenLM gate 对明显 fluent 文本跳过全窗口枚举，降低无 span job 的 ~12 s 固定开销。
3. **全量复测**：在可接受墙钟下补跑 d064–d200，验证 CER / apply 分布是否稳定。

---

## 8. 产物路径

- 批测结果：`electron_node/electron-node/tests/lexicon-v2-phase3-p32-batch-result.json`
- 质量/性能：`electron_node/electron-node/tests/lexicon-v2-phase3-p32-quality-perf.json`
- 运行日志：`electron_node/electron-node/tests/lexicon-v2-phase3-p32-batch-run.log`
- 开发说明：`electron_node/docs/lexicon_v2/Lexicon_Runtime_V2_P3_2_KenLM_Span_Gate_开发说明_2026_05_30.md`
