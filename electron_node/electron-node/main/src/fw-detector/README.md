# FW Detector 模块

**Status:** FROZEN  
**Scope:** `asr.engine = fw_detector_v1` 生产路径

**文档 SSOT：** [`docs/fw-detector/README.md`](../../../../../../docs/fw-detector/README.md) · [`ARCHITECTURE.md`](../../../../../../docs/fw-detector/ARCHITECTURE.md) · [`CONFIG.md`](../../../../../../docs/fw-detector/CONFIG.md) · [`kenlm/KENLM_RUNTIME.md`](../../../../../../docs/fw-detector/kenlm/KENLM_RUNTIME.md)

FW 误写检测与 Lexicon 修正主链：**V4 Boundary-Aware Global Window**（单 Pipeline）。

Pipeline 集成见 [`../pipeline/README.md`](../pipeline/README.md)。

---

## 1. 冻结主链

```text
ASR → runFwDetectorOrchestrator → runFwDetectorV4Path
→ Global Window → Recall (Tone-First) → Tone Score → Compatibility
→ Domain Assembly → SentenceCandidate → KenLM → applyFwSpanReplacements
→ segmentForJobResult → Aggregation → NMT
```

Shadow（仅 diagnostics）：`Emit → Graph → Beam`（不进入 KenLM/Apply）。

---

## 2. 唯一实现（默认路径）

| 角色 | 实现 |
|------|------|
| 入口 | `runFwDetectorOrchestrator` → `runFwDetectorV4Path` |
| 粗边界 | `extractRawCoarseBoundaries`（`pinyin-ime-v2/`） |
| 共享组装 | `span-assembly-shared/`（Graph / Path / Beam 基础模块） |
| V4 编排 | `span-assembly-v4/span-assembly-v4-orchestrator.ts` |
| Recall | `recallTopKForWindows` → `recallSpanTopKV3`（内部复用 `recallSpanTopKV2` 作 exact SQL helper） |
| KenLM | `fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts` |
| Apply | `applyFwSpanReplacements`（`apply-span-replacements.ts`） |
| NMT 输入 | `ctx.segmentForJobResult`（`resolveBusinessAsrText`） |

**冻结标识：** `pipelinePath = 'v4'`（唯一合法值）。

**已退役（不得再作为主链）：** V2 sentence-level rerank pipeline（removed during V2/V3 Retirement）、V3 `span-assembly-v3/`、legacy IME span resolver。

---

## 3. 编排流程

入口：`pipeline/steps/fw-detector-step.ts` → `runFwDetectorOrchestrator`

1. **Lexicon V2：** `ensureLexiconRuntimeV2Loaded`
2. **V4 Path：** `runFwDetectorV4Path`（Global Window → Recall → Compatibility → Domain Assembly → KenLM）
3. **Apply：** `ctx.segmentForJobResult = applyFwSpanReplacements(...)`；有 apply 时 `ctx.asrRepairApplied = true`

### 3.1 Recall（Lexicon Runtime V2 · Window SQL）

V4 窗口 Recall：`span-assembly-v4/recall-topk-for-windows.ts` → `lexicon-v2/recall-span-topkv3.ts`。

- **Exact 层：** `recallSpanTopKV3` 内部调用 `recallSpanTopKV2` + tone sort（`recallSpanTopKV2` 仅作 exact SQL helper，非主链 Recall）
- **Parent fragment 层：** `lookupParentFragments` + tone penalty
- **非主链：** `lexicon/local-span-recall.ts` 仅 legacy 回滚链（`legacy/fw-detector/`）

Bundle：`node_runtime/lexicon/v3`（加载器 `LexiconRuntimeV2`）。

### 3.2 KenLM

- `maxSentenceCandidates: 16`，`minDeltaToReplace: 3.0`（Raw Log Delta）
- `enableKenLMGate: true` **必需**（否则 rerank 不 pick 替换）
- Runtime：**batch-only subprocess**（`kenlm-scorer.ts` → `runKenlmQueryBatch`）；`kenlmSubprocessTimeoutMs` / `kenlmSubprocessMaxLines`；失败 fail-open（scoreAllZero）；无 serial fallback

### 3.3 Apply

唯一 FW 写回：`apply-span-replacements.ts`（D-greedy 右向左替换）。

---

## 4. 禁止新增

| 类别 | 禁止 |
|------|------|
| Pipeline 版本 | V2/V3 分支、`pipelineVersion` / `spanAssemblyVersion` |
| 决策链 | V2 rerank pipeline 作为主链 |
| Apply | `applyFwSpanReplacements` 以外 FW 写回 |
| NMT 输入 | `segmentForJobResult` 以外 |
| 写点 | 白名单以外 `segmentForJobResult` 赋值 |
| 目录 | 禁止保留 / 新增 `span-assembly-v3/` |

FW 主链源文件 **禁止** `import ... legacy/asr-repair`（`fw-detector-gate.mjs` 断言）。

---

## 5. segmentForJobResult 写点白名单

| 文件 | 场景 |
|------|------|
| `pipeline/steps/asr-step.ts` | init from `rawAsrText` |
| `pipeline/steps/fw-detector-step.ts` | skip/disabled sync |
| `fw-detector/fw-detector-orchestrator.ts` | empty / lexicon unavailable |
| `fw-detector/fw-detector-v4-path.ts` | no_spans / **apply** |
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
| `features.fwDetector.spanAssemblyV4Enabled` | `true` |
| `features.fwDetector.toneTimestampOnlyEnabled` | `true` |
| `features.fwDetector.enableKenLMGate` | `true` |
| `features.fwDetector.maxSentenceCandidates` | `16` |
| `features.fwDetector.minDeltaToReplace` | `3.0`（**V4 Apply pick 阈值**，Raw Log Delta 单位） |
| `features.fwDetector.candidateRequireRepairTarget` | `true` |
| `features.lexiconRecall.enabled` | `false` |
| `features.fwDetector.kenlmSubprocessTimeoutMs` | `5000` |
| `features.fwDetector.kenlmSubprocessMaxLines` | `17` |

**Deprecated：** `spanAssemblyV4Enabled=false` 仅 warn，仍运行 V4；`v3ToneTimestampOnlyEnabled` 迁移至 `toneTimestampOnlyEnabled`；`kenlmDeltaThreshold` 仅配置兼容读取，V4 rerank **不使用**（Apply 阈值见 `minDeltaToReplace`）。

---

## 7. 回滚开关（historical only）

| 目标 | 配置 |
|------|------|
| 关闭 FW | `features.fwDetector.enabled: false` |
| V1 lexicon recall | `useLexiconRuntimeV2Recall: false`（legacy） |
| P1.2b per-span topK | `useSentenceLevelRerank` — **orchestrator 不再读取**；归档链见 [`../legacy/fw-detector/`](../legacy/fw-detector/)（手动 wiring） |

---

## 8. 源码索引

| 文件 | 职责 |
|------|------|
| `fw-mode.ts` | 引擎开关、语言判定 |
| `pipeline-mode-fw.ts` | Pipeline 注入 FW 步骤 |
| `fw-config.ts` | 运行时配置加载 |
| `fw-detector-orchestrator.ts` | Lexicon V2 gate → V4 path |
| `fw-detector-v4-path.ts` | V4 主链入口 |
| `span-assembly-v4/` | V4 Global Window 编排 |
| `span-assembly-shared/` | V4 共享 Graph/Path/Beam 模块 |
| `kenlm/` | KenLM sentence rerank |
| `apply-span-replacements.ts` | 局部替换 |
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
npm run test:fw-detector
```

---

## 10. Legacy 边界

| 路径 | 说明 |
|------|------|
| `main/src/fw-detector/` | 冻结 V4 主链 |
| `main/src/legacy/fw-detector/` | P1.2b 回滚链 |
| `main/src/legacy/asr-repair/` | Legacy ASR repair（非 FW 默认 step） |
