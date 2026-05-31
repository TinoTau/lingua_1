# P1~P4 冻结后精简收尾 — 补充清单

日期：2026-06-01  
性质：实施前补充清单 / 非开发任务  
适用范围：`P1_P4_Freeze_PostCleanup_Plan_2026_06_01.md` 落地前  
前置：`P0` + 部分 `P1` 精简已完成（见 [开发报告_2026_05_31](./P1_P4_Freeze_Simplification_开发报告_2026_05_31.md)）

---

## 1. 执行摘要

原《PostCleanup 收尾方案》方向正确，但对照当前代码仍缺少：

```text
1. 已完成项与待办项的明确分界（避免重复开发）
2. Legacy 归档的精确文件边界与 import 约束
3. JobContext 分区字段映射与兼容策略
4. Result Builder / segmentForJobResult 写点清单
5. 双 SSOT（runtime default vs 测试 SSOT）同步规则
6. Freeze Guard 文档与 gate 脚本的对应关系
7. 验收基线数值与运行环境约束
8. P1 / P2 边界调整说明（JobContext 从 P2 提前到 P1）
```

核心原则（与冻结一致，**不变**）：

```text
不改 Metadata Gate 主路径
不改 V2 Recall / merge / SQL
不改 P4 Sentence Rerank 组合与 KenLM batch
不改 applyFwSpanReplacements
不改 NMT 输入 SSOT
不删除 metadata legacy fallback
不删除 Recover / CTC / 5015~5017 注册
```

---

## 2. 当前代码基线（PostCleanup 起点）

### 2.1 已完成（勿重复）

| 项 | 状态 | 证据 |
|----|------|------|
| P0 死配置删除 | ✅ | `fw-config.ts`、`node-config-defaults.ts` |
| maxSpans SSOT | ✅ | `fwMetadataSpanGate.maxSpans`；根级已移除 |
| freeze-contract 扩展 | ✅ | `freeze-contract.test.ts` |
| freeze-config-ssot.json | ✅ | `tests/freeze-config-ssot.json` |
| patch-p4 / p4 batch SSOT | ✅ | `patch-p4-config.mjs`、`run-lexicon-v2-p4-batch.js` |
| freeze-rollback-config.json | ✅ | 仅参考，runtime **不加载** |
| buildFwResultExtra 分支 | ✅ | `result-builder.ts` L57–59 |
| legacy Recover 已物理隔离 | ✅ | `main/src/legacy/recover/` |
| 5015~5017 write-lock | ✅ | `post-asr-routing.ts` `isSegmentWriteLocked` |
| phonetic skip 文案 | ✅ | `SEGMENT_WRITE_LOCKED` |
| fw-detector-gate.mjs | ✅ | 29 项静态隔离检查 |

### 2.2 未完成（PostCleanup 目标）

| 项 | 状态 |
|----|------|
| `legacy/fw-detector/` 目录归档 | ❌ 不存在 |
| JobContext `legacyContext` 分区 | ❌ 字段仍平铺在 interface |
| 独立 Freeze Guard 文档 | ❌ 仅分散于 FW_MAINLINE_FREEZE / PostCleanup 计划 |
| 测试配置 100% 引用 SSOT | ❌ phase3 批测仍硬编码 |
| Result Builder 进一步收敛 | ⚠️ 部分完成 |
| Pipeline Template 解耦 | ❌ P2 |

---

## 3. P1 必须补充项

### P1-1 Legacy FW Detector 归档边界

**目标目录（建议）：**

```text
main/src/legacy/fw-detector/
```

**可迁入（回滚链，非默认主路径）：**

| 文件 | 触发条件 | 备注 |
|------|----------|------|
| `fw-topk-decision-pipeline.ts` | `useSentenceLevelRerank: false` | orchestrator 仍须 import |
| `candidate-scorer.ts` | 同上 | |
| `pick-approved-replacements.ts` | 同上 | |
| `span-replacement-eval.ts` | 无 runtime 引用 | 仅诊断/单测；gate 禁止 orchestrator 引用 |

**不可迁入 / 不可删（仍属冻结主路径或 fallback）：**

| 文件 | 原因 |
|------|------|
| `fw-metadata-span-gate.ts` | Metadata Gate 主路径 |
| `suspicious-span-detector-v1.ts` | `legacy_detector` 模式 + **metadata fallback**（`fallbackLegacyMaxSpans=1`） |
| `span-detector-hint.ts` | 配合 v1 detector / topK rollback |
| `map-fw-metadata-span.ts` | 主链 mapping |
| P4 rerank / apply 全系列 | 主链 |

**不在 fw-detector/ 内但属于回滚链：**

```text
main/src/asr-repair/kenlm-span-selector.ts   # spanGateMode=kenlm_gate_filter
```

归档时必须：

```text
1. 更新 orchestrator / gate / test import 路径
2. fw-detector-gate.mjs 同步路径断言
3. freeze-contract 仍断言 rollback 符号存在（orchestrator 含 runFwTopKDecisionPipeline）
4. 不得删除 metadata gate 内 legacyFallback 回调
```

**验收：**

```text
默认配置下 dialog_200 apply/CER 与基线一致
useSentenceLevelRerank=false 手动回滚仍可跑通
metadata fallback 单测仍 PASS
```

---

### P1-2 JobContext Legacy 分区

PostCleanup 将此项从原 P2 **提前到 P1**，需补充：

**建议结构：**

```typescript
interface JobContext {
  rawAsrText: string;
  segmentForJobResult: string;
  // ... 主链 / 聚合 / FW / 5015~5017 门控字段保留顶层 ...
  legacy?: LegacyContext;
}

interface LegacyContext {
  recover?: { /* recoverLifecycle, windowCandidates, sentenceRepair* ... */ };
  ctc?: { /* asrNbest, asrHypotheses, nbestSynthetic, segmentSynthetic, ctcNbestPreserved */ };
  nbest?: unknown;  // 若与 ctc 合并可省略
  windowRecall?: { /* windowRecallDiagnostics, expansionDiagnostics */ };
}
```

**当前需迁移字段（`job-context.ts`）：**

```text
Recover: recoverLifecycle, recoverLifecycleSkipReason, recoverSkipped, repairSkipReason,
         restoreMetrics, windowCandidates, windowRecallDiagnostics, v5Metrics,
         segmentAlignmentDiagnostics, crossBoundaryRiskReport, recallCoverageDiagnostics,
         expansionDiagnostics, sentenceCandidates, sentenceCandidateTrace,
         sentenceRepairDecision, sentenceRepairExtra

CTC/nbest: asrNbest, asrHypotheses, nbestSynthetic, segmentSynthetic,
           ctcNbestPreserved, aggregationResyncReason, asrKenlmMeta
```

**约束：**

```text
1. FW 主链步骤不得读写 legacy.*（gate 已有部分断言，需扩展）
2. 迁移采用「字段搬家 + 顶层 deprecated alias」或 getter，禁止一次性删顶层字段
3. buildLegacyRecoverResultExtra 读 legacy 分区，buildFwResultExtra 不读
4. session-finalize / aggregation 若读 Recover 字段，须同步改路径
5. 不得改变 JobResult.extra 对外 JSON 形状（仅内部 ctx 重构）
```

**代码落点：**

```text
pipeline/context/job-context.ts
legacy/recover/legacy-recover-result-extra.ts
pipeline/result-builder.ts
scripts/fw-detector-gate.mjs（新增：FW step 禁止读 legacyContext）
```

---

### P1-3 Freeze Guard 文档

PostCleanup L67–82 仅有提纲，需落成 **独立 SSOT 文档**（建议 `docs/FREEZE_GUARD.md`），并包含：

| 章节 | 必须内容 |
|------|----------|
| 禁止新增 | segmentForJobResult 新写回点；新 Span 来源；新 Recall；新 Rerank 链 |
| 唯一允许 | Metadata Gate / V2 Recall / Sentence Rerank / applyFwSpanReplacements |
| 写点白名单 | 见 §4（11 处生产写点分类） |
| 实现门禁 | `freeze-contract.test.ts` + `fw-detector-gate.mjs` 条目索引 |
| 解冻流程 | 改 `freeze-rollback-config.json` + 人工审批，非日常 config |

**与现有文档关系：**

```text
FREEZE_GUARD.md     → 开发/Review 门禁（新增）
FW_MAINLINE_FREEZE.md → 运维/配置/主链说明（保留，引用 FREEZE_GUARD）
PIPELINE.md         → 命令与批测（保留）
PostCleanup Plan      → 实施计划（保留）
```

---

### P1-4 Result Builder 收敛

**已完成：** `isFwDetectorEngineEnabled()` 分支 → `buildFwResultExtra` vs `buildLegacyRecoverResultExtra`。

**待补充：**

```text
1. buildCoreResultExtra 中 Recover 观测字段不得泄漏到 FW 路径
   （当前 core 已较精简，需 freeze-contract 断言 fw 路径无 asr_nbest / sentence_repair）
2. recover-result-bridge.ts 仅 legacy 路径 import
3. 禁止 FW 路径新增 extra 字段写 segment 副本（text_asr 必须经 resolveBusinessAsrText）
```

**代码落点：**

```text
pipeline/result-builder.ts
pipeline/post-asr-routing.ts（resolveBusinessAsrText）
legacy/recover/legacy-recover-result-extra.ts
freeze-contract.test.ts（FW extra 形状断言）
```

---

### P1-5 测试配置统一 SSOT

**已引用 SSOT：**

```text
tests/patch-p4-config.mjs
tests/run-lexicon-v2-p4-batch.js
tests/run-p4-freeze-batch.js
tests/lib/freeze-config-ssot.{mjs,cjs}
```

**仍硬编码 / 需处理：**

| 文件 | 问题 |
|------|------|
| `tests/run-lexicon-v2-phase3-p32-batch.js` | `@deprecated`，内联 kenlm_gate 配置 |
| `tests/run-lexicon-v2-phase3-p33-batch.js` | 内联 fw_metadata 配置 |
| `tests/run-lexicon-v2-phase3-only-audit-batch.js` | 内联配置 |
| `tests/asr-fw-nmt-audit-smoke.json` | 内联 spanGateMode |
| `main/src/node-config-defaults.ts` | **运行时 SSOT**，字段多于 freeze-config-ssot |

**双 SSOT 同步规则（必须写入文档）：**

```text
freeze-config-ssot.json
  ⊂ 批测 / patch 镜像子集
  必须覆盖：P4 冻结路径全部开关 + fwMetadataSpanGate 全字段

node-config-defaults.ts
  = 运行时完整 default（含 topK、finalScoreWeights、rollback 专用字段）
  冻结主路径字段必须与 freeze-config-ssot 一致
  rollback 专用字段不得进入 patch-p4-config.mjs
```

**建议新增断言：**

```text
脚本或单测：loadFreezeConfigSsot() 与 node-config-defaults 冻结字段 deepEqual
```

---

### P1-6 segmentForJobResult 写点白名单（Freeze Guard 依赖）

PostCleanup 未列出，实施 Freeze Guard 前必须冻结此表：

| 文件 | 场景 | 分类 |
|------|------|------|
| `asr-step.ts` | init from rawAsrText | 主链 init |
| `fw-detector-step.ts` | skip/disabled sync | 主链 init |
| `fw-detector-orchestrator.ts` | no_spans / apply | **主链唯一 FW apply** |
| `aggregation-step.ts` | turn 合并 | 主链 |
| `post-asr-routing.ts` | 5015 helper | enhancement（write-lock） |
| `semantic-repair-step.ts` | 5015 写回 | enhancement（write-lock） |
| `phonetic-correction-step.ts` | 5016 | enhancement（write-lock） |
| `punctuation-restore-step.ts` | 5017 | enhancement（write-lock） |
| `legacy/.../legacy-apply-sentence-repair.ts` | Recover pick | legacy only |

**禁止新增写点；P1 归档不得引入新写点。**

`agent/postprocess/aggregation-stage.ts` 存在 `segmentForJobResult` 局部变量（非 ctx 写回）——文档中注明，避免误判。

---

### P1-7 orchestrator 双路径约束

PostCleanup 未强调：归档 legacy 文件后 orchestrator **仍须同时保留**：

```text
runFwSentenceRerankPipeline   # P4 默认
runFwTopKDecisionPipeline     # useSentenceLevelRerank=false 回滚
createSpanDetectorHint        # legacy_detector / topK 回滚
metadata gate legacyFallback  # 冻结 fallback，非 Recover
```

`fw-detector-gate.mjs` L89–102 已强制检查——归档后不得破坏。

---

## 4. P2 延后补充项

### P2-1 Recover Context 迁移

与 P1-2 重叠但更深：不仅 JobContext 分区，还包括：

```text
legacy/recover/ 下步骤与 asr-repair 的 ctx 写入点
pipeline-mode-config 中 LEXICON_RECALL / SENTENCE_REPAIR 模板
```

**P2 前禁止：** 从 registry 删除 Recover 步骤类型。

---

### P2-2 5015~5017 enhancement 化

**当前事实：**

```text
pipeline-step-registry.ts L71–81 已注册
默认 features.*.enabled = false
FW apply 后 isSegmentWriteLocked → 5015/5016/5017 skip
```

**P2 目标：** 物理目录 `enhancement/`，registry 注释/分组调整。

**P2 前禁止：** 默认开启、删除 write-lock、绕过 segmentForJobResult。

---

### P2-3 Legacy Result Extra 迁移

**部分已完成：** `buildLegacyRecoverResultExtra` 已在 `legacy/recover/legacy-recover-result-extra.ts`。

**P2 待做：** 删除 `recover-result-bridge.ts` 薄封装或标记 deprecated；FW 路径零 Recover import。

---

### P2-4 Pipeline Template 解耦

**当前事实：**

```text
PIPELINE_MODES.* 基模板仍含 LEXICON_RECALL + SENTENCE_REPAIR
FW 靠 pipeline-mode-fw.ts applyFwDetectorPipelineMode 过滤
5015~5017 仍在 FW 模板 steps 内（靠 enabled=false 跳过）
```

**P2 约束：** 解耦不得改变 FW 默认 step 顺序（ASR → FW → AGGREGATION → …）。

---

## 5. 验收与环境约束

### 5.1 行为基线（2026-05-31 批测，108/200 条 / 15 min）

| 指标 | 基线 |
|------|------|
| 契约 PASS | 108/108 |
| avg CER final | 37.26% |
| FW apply | 1（d043） |
| FW degraded | 0 |
| pipeline P50 / P95 | 7468 / 14791 ms |
| fw_detector P95 | 1192 ms |

PostCleanup **不得** 使 apply 数、degraded、CER 在同等条件下恶化；P95 波动需注明 ASR 冷启动因素。

### 5.2 静态门禁

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|detector-layering|asr-aggregation-contract"
node scripts/fw-detector-gate.mjs
```

### 5.3 集成批测

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/patch-p4-config.mjs
# 启用 servicePreferences: faster-whisper-vad, nmt-m2m100, piper-tts
node tests/run-lexicon-v2-p4-batch.js --max-minutes 15
node tests/analyze-p4-audit.mjs
```

**运行约束（代码外，易踩坑）：**

```text
ELECTRON_RUN_AS_NODE=1 会导致 Electron 无法启动 test server :5020
批测前必须清除该环境变量
ASR :6007 需 asr_model_loaded=true 后再跑批测
```

---

## 6. PostCleanup 方案需修正的表述

| 原方案表述 | 建议修正 |
|------------|----------|
| 「JobContext Legacy 分区」在 P1 | 补充：仅 struct 分区 + 兼容 alias；Recover 步骤迁移仍在 P2 |
| 「Result Builder 收敛」 | 补充：FW/Legacy 分支已有；剩余为 extra 泄漏断言 + bridge 清理 |
| 「测试配置统一 SSOT」 | 补充：runtime default 与 test SSOT 双轨及同步规则 |
| 「Legacy 不进入默认路径」 | 补充：**metadata fallback** 是冻结默认路径的一部分，不是可删 legacy |
| Check List「pipeline P95 不变」 | 补充：允许 ASR 环境波动；对比时需预热或同样本量 |
| 架构目标 `fw-detector/legacy/` | 补充：实际建议 `main/src/legacy/fw-detector/`，与 Recover 并列 |

---

## 7. Target List（补充后）

### P1

- [ ] 创建 `legacy/fw-detector/`，迁入回滚链（§P1-1 边界）
- [ ] JobContext `legacyContext` 分区 + 兼容层（§P1-2）
- [ ] 新增 `FREEZE_GUARD.md`（§P1-3）
- [ ] Result Builder FW extra 泄漏断言（§P1-4）
- [ ] phase3 批测改 SSOT 或标记只读归档（§P1-5）
- [ ] freeze-config-ssot ↔ node-config-defaults 一致性检查（§P1-5）
- [ ] 文档化 segmentForJobResult 写点白名单（§P1-6）
- [ ] 归档后 gate / freeze-contract 路径更新（§P1-7）

### P2

- [ ] Recover 步骤与模板物理解耦（§P2-1、§P2-4）
- [ ] 5015~5017 → `enhancement/`（§P2-2）
- [ ] recover-result-bridge 清理（§P2-3）
- [ ] Legacy Result Extra 零 FW import（§P2-3）

---

## 8. Check List（补充后）

### 架构

- [ ] Metadata Gate 仍为默认唯一 Span 主路径
- [ ] metadata legacy fallback 仍可触发（max 1 span）
- [ ] V2 Recall 仍为默认唯一 Recall（双开关联动）
- [ ] P4 Sentence Rerank 仍为默认决策链
- [ ] applyFwSpanReplacements 仍为唯一 FW Apply
- [ ] segmentForJobResult 仍为 NMT 唯一输入
- [ ] 5015~5017 默认 OFF + write-lock 仍有效
- [ ] FW 主链无 `legacy/recover` runtime import

### 行为

- [ ] dialog_200 apply 数不变（基线：1 / d043）
- [ ] degraded 不增加（基线：0）
- [ ] CER 不明显恶化（±1% 内可接受，需同条件批测）
- [ ] `useSentenceLevelRerank=false` 回滚仍可运行

### Legacy

- [ ] Recover 不进入 FW 主链默认 step 列表
- [ ] CTC n-best 不写入 FW ctx 顶层（分区后仅在 legacyContext）
- [ ] 回滚配置仅存在于 freeze-rollback-config.json，不进 patch-p4

---

## 9. 相关文档

| 文档 | 关系 |
|------|------|
| [PostCleanup Plan](./P1_P4_Freeze_PostCleanup_Plan_2026_06_01.md) | 本清单所补充的原方案 |
| [Simplification 补充约束](./P1_P4_Freeze_Simplification_补充约束清单_2026_05_31.md) | P0/P1 已实施约束 |
| [FW_MAINLINE_FREEZE](./FW_MAINLINE_FREEZE.md) | 冻结主链运维 SSOT |
| [测试报告 dialog200](./P1_P4_Freeze_Simplification_测试报告_dialog200_2026_05_31.md) | 行为/性能基线 |

---

## 10. 最终建议

1. **先合并本补充清单到 PostCleanup Plan**，再启动 P1 开发。  
2. P1 优先级：**Freeze Guard 文档 + legacy/fw-detector 归档 + SSOT 一致性**；JobContext 分区可拆两 PR（struct 先行，call site 跟进）。  
3. 每项 P1 变更必须跑 §5 静态门禁 + 至少 `--max-minutes 15` dialog_200 抽样。  
4. P2 保持延后，不得在 P1 中删除 registry 步骤或 metadata fallback。
