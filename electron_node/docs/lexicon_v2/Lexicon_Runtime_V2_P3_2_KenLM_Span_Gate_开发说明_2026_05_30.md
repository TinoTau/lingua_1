# P3.2 KenLM Span Gate — 开发说明

版本：V1.0  
日期：2026-05-30  
依据：`P3_2_KenLM_Span_Gate_补充冻结方案_V1_1.md`

## 实现摘要

在 FW orchestrator 内用 **KenLM Span Gate** 替代 legacy detector 作为 span 来源（`kenlm_gate_filter`），流程：

```text
rawAsrText → KenLM Span Gate (≤2 spans) → V2 Recall → KenLM weak_veto → Apply
```

## 修改文件

| 文件 | 变更 |
|------|------|
| `asr-repair/kenlm-span-selector.ts` | 新增：CJK 枚举、stopword、delete-span delta、top-N 选择 |
| `asr-repair/kenlm-span-selector.test.ts` | 单元测试 |
| `fw-detector/fw-detector-orchestrator.ts` | gate 接入、0 span 早退、diagnostics |
| `fw-detector/fw-config.ts` | `spanGateMode` / `kenlmSpanGate` / `isKenlmSpanGateActive` |
| `fw-detector/types.ts` | `kenlm_local_low_prob`、`KenlmSpanGateDiagnostics` |
| `node-config-types.ts` / `node-config-defaults.ts` | 默认 `kenlm_gate_filter` |
| `tests/run-lexicon-v2-phase3-only-audit-batch.js` | gate/veto 字段 |
| `tests/analyze-phase3-only-audit.mjs` | span/job、gate ms 统计 |

**未修改：** `kenlm-span-gate.ts`、`fw-topk-decision-pipeline.ts`、`suspicious-span-detector-v1.ts`

## 配置（defaults）

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
}
```

回滚：`spanGateMode: "legacy_detector"`，`kenlmSpanGate.enabled: false`

## 批测

```bash
# APPDATA 需：useLexiconRuntimeV2Recall=true, useIndustryRouting=false
npm run build
# 重启 Electron 节点
node tests/run-lexicon-v2-phase3-only-audit-batch.js
node tests/analyze-phase3-only-audit.mjs
```

## 验证

- `jest kenlm-span-selector|freeze-contract` PASS
- `node scripts/fw-detector-gate.mjs` PASS
- `npm run build` PASS

## Diagnostics 字段

`fw_detector.kenlmSpanGate`：`kenlmSpanGateMs`、`kenlmSpanGateQueryCount`、`selectedCount` 等  
`fw_detector.kenlmVetoMs` / `kenlmVetoQueryCount`：weak_veto 阶段
