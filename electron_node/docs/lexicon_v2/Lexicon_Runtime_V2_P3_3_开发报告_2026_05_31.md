# Lexicon Runtime V2 — P3.3 FW Metadata Span Gate 开发报告

版本：V1.0  
日期：2026-05-31  
依据：`P3_3_FW_Metadata_Span_Gate_补充冻结方案_V1_1.md`、`Lexicon_Runtime_V2_P3_3_FW_Metadata_Span_Gate_开发说明_2026_05_30.md`

---

## 1. 开发目标

在 P3.2 KenLM Span Gate **已否决**（~12 s/job 固定 gate 开销、63 条内 0 apply）之后，用 **Faster-Whisper ASR metadata**（word probability / avg_logprob / compression_ratio）+ **alias exact hit** 替代 KenLM span gate，在 **0 KenLM gate query** 前提下将 span 入口压到 **≤2/job**，再进入 V2 Recall → KenLM weak_veto → Apply。

目标流程：

```text
rawAsrText + ASR segments metadata (word_timestamps)
  → FW Metadata Span Gate (≤2 spans, 0 KenLM gate query)
  → Lexicon V2 Recall (LIMIT 2/3/0)
  → KenLM weak_veto（不变）
  → Apply
```

---

## 2. 修改文件列表

| 层级 | 文件 | 变更摘要 |
|------|------|----------|
| Python | `asr_worker_process.py` | `word_timestamps=True`；segment 输出 words/avg_logprob/compression_ratio |
| Python | `shared_types.py` | `WordInfo` / `WordInfoModel`；扩展 `SegmentInfo` / `SegmentInfoModel` |
| Python | `result_listener.py` | IPC dict → `SegmentInfo` dataclass |
| Python | `utterance_asr.py` | 消费 segments；**批测前 hotfix**：兼容已是 dataclass 的 segment |
| Python | `api_routes.py` / `text_processing.py` | HTTP 响应字段同步；dedup 后保留 segment metadata、丢弃 words |
| Node | `task-router/types.ts` | `AsrWordInfo` + 扩展 `SegmentInfo` |
| Node | `fw-detector/fw-metadata-span-gate.ts` | **新增** 核心 gate |
| Node | `fw-detector/map-fw-metadata-span.ts` | **新增** → `FwSpanDiagnostics` |
| Node | `fw-detector/alias-span-scan.ts` | **新增** alias 键子串扫描 |
| Node | `fw-detector/fw-detector-orchestrator.ts` | 三分支 gate + KenLM scorer 仅 weak_veto |
| Node | `fw-config.ts` / `node-config-*` | `spanGateMode=fw_metadata_gate`、`fwMetadataSpanGate` |
| Node | `lexicon/lexicon-runtime.ts` | `listAliasExactKeys()` |
| Tests | `fw-metadata-span-gate.test.ts` / `alias-span-scan.test.ts` | 单测 |
| Tests | `run-lexicon-v2-phase3-p33-batch.js` / `analyze-phase3-p33-audit.mjs` | 批测与分析 |

**未修改（冻结）：** `kenlm-span-gate.ts`（weak_veto）、`fw-topk-decision-pipeline.ts`、CTC/Recover、主链 step 顺序

---

## 3. 批测前 Hotfix

| 问题 | 根因 | 修复 |
|------|------|------|
| dialog_200 **200/200 HTTP 500** | `result_listener` 已将 IPC dict 转为 `SegmentInfo` dataclass，`utterance_asr.perform_asr` 仍对全部 segment 调用 `_segment_from_dict(seg)`，触发 `'SegmentInfo' object has no attribute 'get'` | `utterance_asr.py`：`isinstance(seg, dict)` 时才 dict 转换，否则直接使用 |

---

## 4. 冻结约束落实情况

| 约束 | 状态 |
|------|------|
| Span Gate 输入为 rawAsrText + ASR segments metadata | ✅ |
| Gate 阶段 **0 KenLM query** | ✅（`kenlm_span_gate_query_count` 全量为 0） |
| KenLM scorer 仅在 weak_veto 阶段创建 | ✅ |
| span ≤ 2 / job | ✅（max=2，P95=1） |
| 0 span 时跳过 Recall/Pipeline | ✅ |
| Industry Routing 关闭 | ✅（`industry_routing_used_count=0`） |
| merge cap 无违规 | ✅ |

---

## 5. 默认配置

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
},
"useLexiconRuntimeV2Recall": true,
"useIndustryRouting": false
```

回滚：`spanGateMode: "legacy_detector"` 或 `"kenlm_gate_filter"` + `kenlmSpanGate.enabled: true`

---

## 6. 单元 / 门禁验证

| 项 | 结果 |
|----|------|
| `npm run build` | PASS |
| `jest fw-metadata-span-gate\|alias-span-scan\|freeze-contract` | 28/28 PASS |
| `node scripts/fw-detector-gate.mjs` | PASS |
| 单条 smoke（d001，`/run-pipeline-with-audio`） | HTTP 200，`spanGateMode=fw_metadata_gate` |

---

## 7. dialog_200 批测摘要（限时 15 min）

| 项 | 值 |
|----|-----|
| 命令 | `node tests/run-lexicon-v2-phase3-p33-batch.js --max-minutes 15` |
| 完成 case | **200 / 200**（墙钟 **516 s**，约 **8.6 min**） |
| 契约 | **200 / 200 PASS**，0 FAIL |
| span/job P95 / max | **1 / 2** |
| 含 span job | **~38**（其中 3 条 span=2） |
| span recall 调用 | **41** 次（Hotfix 全量 **2298** 次，↓ **98.2%**） |
| FW apply 总计 | **24** |
| 平均 CER | raw **36.02%**，final **36.35%** |
| FW 改善 / 劣化 case | **5 / 14** |
| pipeline P95 | **4096 ms** |
| metadata gate P95 | **1 ms**（对比 P3.2 gate avg **11906 ms**） |

详细数据见：`Lexicon_Runtime_V2_P3_3_测试报告_dialog200_2026_05_31.md`

---

## 8. 结论与后续

### 8.1 已达成

- **P3.2 性能瓶颈消除**：metadata gate P95 **1 ms**，pipeline P95 从 P3.2 的 **16060 ms** 降至 **4096 ms**（亦优于 Phase 2 的 **7458 ms**）。
- **Span Explosion 持续受控**：span/job max **2**，recall 调用 **41** 次 / 200 job。
- **主链契约全绿**：200/200 PASS，`merge_cap_violations=0`，Industry Routing 未触发。
- **有限有益修复恢复**：FW apply **24** 次（P3.2 为 0），5 条 CER 改善。

### 8.2 待观察

| 验收项 | 目标 | P3.3（200 条） | 说明 |
|--------|------|----------------|------|
| CER ≤ Phase 2 | ≤ 35.93% | **36.35%** | 高 **0.42 pp**；14 条劣化需个案复盘 |
| FW 劣化 | 0 | **14** | 远低于 Hotfix 162，但仍高于 Phase 2 |
| word alignment | 稳定 | 多条 `alignmentFailures>0` | 繁简/标点与 FW word 切分不一致，gate 多走 alias/fallback |
| 长尾 pipeline | — | max **12201 ms**（d067） | 单条 ASR 异常慢，与 gate 无关 |

### 8.3 建议

1. **劣化 case 审计**：对 14 条 fw_degraded 做 span/candidate/kenlm_veto 轨迹对照，必要时收紧 alias fallback 或 veto 阈值。
2. **alignment 质量**：评估 dedup 后丢弃 words 对 gate 的影响；或在 Node 侧重对齐 rawText 与 word 列表。
3. **保留 P3.3 为默认 gate**：相对 P3.2 在性能与 apply 上均更优，可作为 Phase 3 默认 span 入口。

---

## 9. 产物路径

| 产物 | 路径 |
|------|------|
| 开发说明 | `electron_node/docs/lexicon_v2/Lexicon_Runtime_V2_P3_3_FW_Metadata_Span_Gate_开发说明_2026_05_30.md` |
| 批测原始结果 | `electron_node/electron-node/tests/lexicon-v2-phase3-p33-batch-result.json` |
| 质量/性能聚合 | `electron_node/electron-node/tests/lexicon-v2-phase3-p33-quality-perf.json` |
| 批测日志 | `electron_node/electron-node/tests/lexicon-v2-phase3-p33-batch-run.log` |
| 测试报告 | `electron_node/docs/lexicon_v2/Lexicon_Runtime_V2_P3_3_测试报告_dialog200_2026_05_31.md` |
