# FW Detector 模块

**Status:** FROZEN  
**Scope:** `asr.engine = fw_detector_v1` 生产路径

FW 误写检测与 Lexicon 修正主链：Metadata Span Gate → V2 Recall → P4 Sentence Rerank → Apply。

Pipeline 集成见 [`../pipeline/README.md`](../pipeline/README.md)。

---

## 1. 冻结主链

```text
ASR → Metadata Span Gate → Lexicon V2 Recall → P4 Sentence Rerank
→ applyFwSpanReplacements → segmentForJobResult → Aggregation → NMT
```

---

## 2. 唯一实现（默认路径）

| 角色 | 实现 |
|------|------|
| Span | `selectFwMetadataSpans`（`fw-metadata-span-gate.ts`） |
| Recall | `recallSpanTopK` → V2（`useLexiconRuntimeV2Recall` + `lexiconRuntimeV2.enabled`） |
| 决策 | `runFwSentenceRerankPipeline`（`useSentenceLevelRerank: true`） |
| Apply | `applyFwSpanReplacements`（`fw-detector-orchestrator.ts`） |
| NMT 输入 | `ctx.segmentForJobResult`（`resolveBusinessAsrText`） |

**文档化例外（仍为冻结路径）：**

- Metadata Gate **legacy fallback**（`fallbackLegacyMaxSpans=1`）→ `suspicious-span-detector-v1.ts`
- 配置回滚：`useSentenceLevelRerank=false` → [`../legacy/fw-detector/`](../legacy/fw-detector/)

---

## 3. 编排流程

入口：`pipeline/steps/fw-detector-step.ts` → `runFwDetectorOrchestrator`

1. **Span：** `resolveFwSpans` — 默认 `fw_metadata_gate`；回滚 `kenlm_span_gate` / `legacy_detector`
2. **Recall：** `runWithLexiconRecallContext` + `recallSpanTopK`（V2 或 V1）
3. **Rerank：** `useSentenceLevelRerank` ? `runFwSentenceRerankPipeline` : `runFwTopKDecisionPipeline`
4. **Apply：** `ctx.segmentForJobResult = applyFwSpanReplacements(...)`；有 apply 时 `ctx.asrRepairApplied = true`

### 3.1 Metadata Span Gate

- 主信号：alias exact hit、低词概率（word probability）
- 输入：`rawAsrText`、ASR segments、V2 alias 索引
- 上限：`fwMetadataSpanGate.maxSpans`（默认 **4**，SSOT）

**Legacy fallback**（非主路径）：`allowSegmentFallbackScan` + 低 segment avg_logprob → 最多 `fallbackLegacyMaxSpans`（默认 1）个 suspicious span。

### 3.2 Recall（Lexicon Runtime V2）

`lexicon/local-span-recall.ts` → `recallSpanTopKViaRuntimeV2` when双开关 true。  
Bundle：`node_runtime/lexicon/v3`（P1 阶段 A，加载器仍为 `LexiconRuntimeV2`）。详见 [`../../../../docs/lexicon-v3/README.md`](../../../../docs/lexicon-v3/README.md)。

### 3.3 P4 Sentence Rerank（默认）

- `maxSentenceCandidates: 16`，`minDeltaToReplace: 0.03`
- `enableKenLMGate: true` **必需**（否则 rerank 不 pick 替换）

### 3.4 Apply

唯一 FW 写回：`apply-span-replacements.ts`（D-greedy 右向左替换）。

---

## 4. 禁止新增

| 类别 | 禁止 |
|------|------|
| Span 来源 | Metadata Gate 以外进入默认路径 |
| Recall | V2 以外进入默认路径 |
| 决策链 | Sentence Rerank 以外进入默认路径 |
| Apply | `applyFwSpanReplacements` 以外 FW 写回 |
| NMT 输入 | `segmentForJobResult` 以外 |
| 写点 | 白名单以外 `segmentForJobResult` 赋值 |

FW 主链源文件 **禁止** `import ... legacy/asr-repair`（`fw-detector-gate.mjs` 断言）。

---

## 5. segmentForJobResult 写点白名单

| 文件 | 场景 |
|------|------|
| `pipeline/steps/asr-step.ts` | init from `rawAsrText` |
| `pipeline/steps/fw-detector-step.ts` | skip/disabled sync |
| `fw-detector/fw-detector-orchestrator.ts` | no_spans / **apply** |
| `pipeline/steps/aggregation-step.ts` | turn 合并 |
| `pipeline/enhancement/*` | 5015/5016/5017（write-lock） |
| `pipeline/post-asr-routing.ts` | 5015 helper |
| `legacy/asr-repair/.../legacy-apply-sentence-repair.ts` | legacy only |

FW apply 后 `isSegmentWriteLocked` 阻止 5015/5016/5017。

---

## 6. 默认配置

来源：`node-config-defaults.ts` + `tests/freeze-config-ssot.json`（parity 测试）。

| 键 | 冻结默认 |
|----|----------|
| `asr.engine` | `fw_detector_v1` |
| `features.lexiconRuntimeV2.enabled` | `true` |
| `features.fwDetector.useLexiconRuntimeV2Recall` | `true` |
| `features.fwDetector.spanGateMode` | `fw_metadata_gate` |
| `features.fwDetector.kenlmSpanGate.enabled` | `false` |
| `features.fwDetector.useSentenceLevelRerank` | `true` |
| `features.fwDetector.enableKenLMGate` | `true` |
| `features.fwDetector.fwMetadataSpanGate.maxSpans` | `4` |
| `features.fwDetector.maxSentenceCandidates` | `16` |
| `features.fwDetector.minDeltaToReplace` | `0.03` |
| `features.fwDetector.candidateRequireRepairTarget` | `true` |
| `features.lexiconRecall.enabled` | `false` |

---

## 7. 回滚开关（仅 config，不改源码）

| 目标 | 配置 |
|------|------|
| P1.2b per-span topK | `useSentenceLevelRerank: false` |
| KenLM span gate | `spanGateMode: kenlm_gate_filter`, `kenlmSpanGate.enabled: true` |
| Legacy detector | `spanGateMode: legacy_detector` |
| V1 lexicon recall | `useLexiconRuntimeV2Recall: false` |
| 关闭 FW | `features.fwDetector.enabled: false` |

解冻流程：改 `tests/freeze-rollback-config.json` → merge 到 userData config → 回归验证。

---

## 8. 源码索引

| 文件 | 职责 |
|------|------|
| `fw-mode.ts` | 引擎开关、语言判定 |
| `pipeline-mode-fw.ts` | Pipeline 注入 FW 步骤 |
| `fw-config.ts` | 运行时配置加载 |
| `fw-metadata-span-gate.ts` | Metadata span 选择 |
| `fw-detector-orchestrator.ts` | gate → recall → rerank → apply |
| `fw-sentence-rerank-pipeline.ts` | P4 句级 KenLM |
| `apply-span-replacements.ts` | 局部替换 |
| `suspicious-span-detector-v1.ts` | metadata fallback |
| `freeze-contract.test.ts` | 冻结合约 |
| `freeze-config-ssot.test.ts` | SSOT parity |

回滚链：[`../legacy/fw-detector/README.md`](../legacy/fw-detector/README.md)

---

## 9. 门禁

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
node scripts/fw-detector-gate.mjs
```

---

## 10. Legacy 边界

| 路径 | 说明 |
|------|------|
| `main/src/fw-detector/` | 冻结主链 + metadata fallback |
| `main/src/legacy/fw-detector/` | P1.2b 回滚链 |
| `main/src/legacy/asr-repair/` | Legacy ASR repair（非 FW 默认 step） |
