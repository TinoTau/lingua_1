# P3.3 FW Metadata Span Gate — 开发说明

版本：V1.0  
日期：2026-05-30  
依据：`P3_3_FW_Metadata_Span_Gate_补充冻结方案_V1_1.md`

## 实现摘要

用 **Faster-Whisper ASR metadata**（word probability / avg_logprob）+ **alias exact hit** 替代 legacy detector / KenLM span gate：

```text
rawAsrText + ASR segments metadata
  → FW Metadata Span Gate (≤2 spans, 0 KenLM query)
  → Lexicon V2 Recall (LIMIT 2/3/0)
  → KenLM weak_veto（不变）
  → Apply
```

## 修改文件

| 层级 | 文件 | 变更 |
|------|------|------|
| Python | `asr_worker_process.py` | `word_timestamps=True`；输出 words/avg_logprob/compression_ratio |
| Python | `shared_types.py` | `WordInfo` + 扩展 `SegmentInfo` |
| Python | `result_listener.py` / `utterance_asr.py` / `api_routes.py` | IPC/HTTP 字段同步 |
| Python | `text_processing.py` | dedup 后保留 segment metadata，丢弃 words |
| Node | `task-router/types.ts` | `AsrWordInfo` + 扩展 `SegmentInfo` |
| Node | `inference-service.ts` | segments 类型同步 |
| Node | `fw-detector/types.ts` | 新 signal + `FwMetadataSpanGateDiagnostics` |
| Node | `fw-config.ts` | `fw_metadata_gate` 三分支 + 默认切换 |
| Node | `node-config-types.ts` / `node-config-defaults.ts` | `fwMetadataSpanGate` |
| Node | `lexicon/alias-span-scan.ts` | alias 键子串扫描 |
| Node | `lexicon/lexicon-runtime.ts` | `listAliasExactKeys()` |
| Node | `fw-detector/fw-metadata-span-gate.ts` | 核心 gate |
| Node | `fw-detector/map-fw-metadata-span.ts` | → `FwSpanDiagnostics` |
| Node | `fw-detector/fw-detector-orchestrator.ts` | 三分支 + KenLM scorer 仅 veto |
| Tests | `fw-metadata-span-gate.test.ts` / `alias-span-scan.test.ts` | 单测 |
| Tests | `run-lexicon-v2-phase3-p33-batch.js` / `analyze-phase3-p33-audit.mjs` | 批测 |

**未修改：** `kenlm-span-gate.ts`（weak_veto）、`fw-topk-decision-pipeline.ts`、CTC/Recover、主链 step 顺序

## 默认配置

```json
"spanGateMode": "fw_metadata_gate",
"kenlmSpanGate": { "enabled": false },
"fwMetadataSpanGate": {
  "enabled": true,
  "maxSpans": 2,
  "wordProbabilityThreshold": 0.65,
  "segmentAvgLogprobThreshold": -1.0,
  "allowAliasExactHit": true,
  "allowSegmentFallbackScan": true,
  "fallbackLegacyMaxSpans": 1
}
```

回滚：`spanGateMode: "legacy_detector"` 或 `"kenlm_gate_filter"` + `kenlmSpanGate.enabled: true`

## 验证

```bash
npm run build
npx jest "fw-metadata-span-gate|alias-span-scan|freeze-contract"
node scripts/fw-detector-gate.mjs
```

批测（需重启节点 + APPDATA 配置 V2 recall ON）：

```bash
node tests/run-lexicon-v2-phase3-p33-batch.js --max-minutes 15
node tests/analyze-phase3-p33-audit.mjs
```

## Diagnostics

`fw_detector.fwMetadataSpanGate`：`wordCount`、`selectedCount`、`fwMetadataGateMs`、`skippedReason` 等
