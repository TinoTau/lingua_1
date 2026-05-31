# P1~P4 冻结精简方案 — 补充清单与约束

**基于：** [P1_P4_Freeze_Simplification_Plan_2026_05_31.md](./P1_P4_Freeze_Simplification_Plan_2026_05_31.md)  
**对照：** [FREEZE_SIMPLIFICATION_AUDIT_2026_05_27.md](./FREEZE_SIMPLIFICATION_AUDIT_2026_05_27.md) · 当前代码  
**性质：** 实施前补充说明；**非开发任务**

---

## 1. 原方案需补充的信息

原方案 Target List 正确，但缺少**文件落点、不可删边界、隐式行为**与**验收命令**。下表为对照代码后应并入方案的补充项。

### 1.1 P0 补充

| # | 原方案项 | 补充信息 | 代码落点 |
|---|----------|----------|----------|
| P0-1 | 删除死配置 | **明确清单：** `fwMetadataSpanGate.compressionRatioThreshold`、`fwMetadataSpanGate.noSpeechProbThreshold`（metadata gate **从未读取**）；`enableRepairTargetFilter`（deprecated 别名） | `fw-config.ts`、`node-config-types.ts`、`node-config-defaults.ts`、`fw-metadata-span-gate.test.ts` |
| P0-2 | 修正 node-config-types | 除注释外，同步 **`lexiconRuntimeV2` 默认 true** 到 types 注释；`fwDetector.maxSpans` 注释应指向 gate SSOT | `node-config-types.ts` L122–135、L143 |
| P0-3 | maxSpans 单一来源 | 根级 `fwDetector.maxSpans` 在 P4 仅进 `configSnapshot`，**span 上限实际由 `fwMetadataSpanGate.maxSpans` 控制**；apply 无根级 maxSpans 截断 | `fw-detector-orchestrator.ts`、`fw-metadata-span-gate.ts` |
| P0-3b | （缺失）同步冻结文档 | `FW_MAINLINE_FREEZE.md` L59 仍写根级 `maxSpans: 4`，与收敛目标冲突，P0 需一并改 | `FW_MAINLINE_FREEZE.md`、`PIPELINE.md` |
| P0-4 | Freeze Contract 扩展 | 建议新增断言：`compressionRatioThreshold` 不出现在 gate 运行时；`spanGateMode` 默认 `fw_metadata_gate`；`enableKenLMGate` 默认 true；**可选** assert 根 `maxSpans` 不再被 gate 以外逻辑读取 | `freeze-contract.test.ts` |
| P0-5 | KenLM P4 文档化 | **`enableKenLMGate: false` 会导致 P4 无 scorer → 永不 apply**（`rerankFwSentences` 在 scorer=null 时 `pickedIsRaw=true`） | `rerank-fw-sentences.ts` L33–40、`fw-detector-orchestrator.ts` L305 |
| P0-6 | （缺失）spanDetectBudget 一致性 | `spanDetectBudget` fallback 用 `(cfg.maxSpans ?? 2)*4`，与根 maxSpans 默认 4 不一致；仅 legacy/fallback 使用，P0 应文档化或改为读 gate/fallback 专用字段 | `fw-config.ts` L171 |
| P0-7 | （缺失）双开关联动 | V2 Recall 需 **`lexiconRuntimeV2.enabled === true` 且 `useLexiconRuntimeV2Recall === true`**；仅关后者会回退 V1 `recallSpanTopKV1` | `lexicon-fw-recall-config.ts`、`local-span-recall.ts` L99–101 |
| P0-8 | （缺失）Job 级 override | `job.fw_detector.enableKenLMGate` / test server options 可覆盖节点 config；批测/集成需禁止误关 | `fw-job-overrides.ts`、`inference-service.ts` |

### 1.2 P1 补充

| # | 原方案项 | 补充信息 | 代码落点 |
|---|----------|----------|----------|
| P1-1 | rollback 配置隔离 | 建议独立 **`rollback` 子对象或 `config/rollback/` JSON**，包含：`useSentenceLevelRerank:false` + topK/finalScoreWeights/kenlmGate*；`spanGateMode:kenlm_gate_filter`；`legacy_detector` | `node-config-types.ts`、`fw-config.ts` |
| P1-2 | legacy/fw-detector 归档 | **可移目录：** `suspicious-span-detector-v1.ts`、`fw-topk-decision-pipeline.ts`、`candidate-scorer.ts`、`pick-approved-replacements.ts`（P1.2b 链）；**不可移：** metadata fallback 回调（仍属 P3.3 冻结文档路径） | `fw-detector-orchestrator.ts` L149–157 |
| P1-3 | freeze-config-ssot | 尚无 `freeze-config-ssot.json`；当前 **`patch-p4-config.mjs` 为事实 SSOT**，但未覆盖 `enableKenLMGate`、`minPrior`、`candidateRequireRepairTarget`（依赖代码 default） | `tests/patch-p4-config.mjs` |
| P1-4 | 初始化写回收敛 | 收敛点：`asr-step.ts` L354、`fw-detector-step.ts` L12 `syncBaselineFromRaw`；改前需证明 FW skip 路径 `rawAsrText` 恒存在 | `asr-step.ts`、`fw-detector-step.ts` |
| P1-5 | （缺失）P4 硬编码 recall 上限 | **`getPerSpanCandidateLimit(spanCount)` 为代码常量**（1→8, 2→4, ≥3→2），**非 config**；精简 config 时不要误删/误加 `topK` 以为影响 P4 | `per-span-candidate-limit.ts` |
| P1-6 | （缺失）批测脚本去重 | `run-lexicon-v2-p4-batch.js`、`run-p4-freeze-batch.js` 重复硬编码 config；`run-lexicon-v2-phase3-p32-batch.js` 为 **非冻结** kenlm_gate 路径，应标 deprecated | `tests/` |
| P1-7 | （缺失）文案修正 | `phonetic-correction-step.ts` skip reason `RECOVER_WRITE_LOCKED` 应改为 segment write lock 语义 | `phonetic-correction-step.ts` L37 |

### 1.3 P2 补充

| # | 原方案项 | 补充信息 | 代码落点 |
|---|----------|----------|----------|
| P2-1 | Recover Context 归档 | `JobContext` 含 20+ Recover 字段（`asrNbest`、`windowCandidates`、`sentenceRepairExtra` 等）；FW 主链不写入但类型仍暴露 | `pipeline/context/job-context.ts` |
| P2-2 | 5015~5017 enhancement 化 | 步骤仍在 `STEP_REGISTRY`；默认 OFF + `isSegmentWriteLocked`；**FW 冻结禁止本阶段删步骤** | `pipeline-step-registry.ts`、`post-asr-routing.ts` |
| P2-3 | Legacy Result Extra | `buildLegacyRecoverResultExtra` 仅非 `fw_detector_v1` engine 路径 | `result-builder.ts` L57–59 |
| P2-4 | Pipeline Template 解耦 | `PIPELINE_MODES.*` 基模板仍含 `LEXICON_RECALL`/`SENTENCE_REPAIR`；FW 靠 `applyFwDetectorPipelineMode` 过滤 | `pipeline-mode-config.ts`、`pipeline-mode-fw.ts` |
| P2-5 | （缺失）gate 脚本版本 | `scripts/fw-detector-gate.mjs` 标题仍为 P1.2c-fix V1.1，P1 应更新 gate 文案与检查项 | `scripts/fw-detector-gate.mjs` |

---

## 2. 实施约束（必须遵守）

### 2.1 冻结禁止项（来自 FW_MAINLINE_FREEZE）

精简阶段 **不得** 在未解冻审批下：

| 禁止 | 说明 |
|------|------|
| 改 Recall merge / SQL / domain routing | `lexicon-v2/recall/`、`runtime-v2-recall-adapter.ts` |
| 改 P4 rerank 组合或 KenLM sentence batch | `build-sentence-candidates.ts`、`rerank-fw-sentences.ts` |
| 改 Metadata Gate 主信号或阈值 | `fw-metadata-span-gate.ts` 主路径（alias、word probability） |
| 新增 alternate FW writeback | 仅 `applyFwSpanReplacements` |
| 改 NMT 输入字段 | 仍 `segmentForJobResult` |
| **删除** metadata legacy fallback 代码 | `allowSegmentFallbackScan` + `suspicious-span-detector-v1` 回调（P3.3 文档路径） |
| **删除** Recover / CTC / 5015–5017 代码 | P2 才可物理迁移 |

### 2.2 行为不变约束

| 约束 | 验收方式 |
|------|----------|
| dialog_200 批测结果不变 | `patch-p4-config.mjs` → `run-lexicon-v2-p4-batch.js` |
| CER / apply 率不变 | 对比 `fw_detector.summary.appliedCount`、replacement diags |
| pipeline P95 不变 | `extra.fw_detector_step_ms` 或节点 metrics（若有） |
| Metadata Gate 为默认唯一 span 主路径 | `configSnapshot.spanGateMode === fw_metadata_gate` |
| V2 为默认唯一 recall | `recallV2Diagnostics` / tier stats |
| P4 为默认唯一决策链 | `useSentenceLevelRerank === true` 且 `sentenceRerank` extra 存在 |
| apply 唯一 | 静态：`applyFwSpanReplacements` 唯一 import 写回 |
| NMT SSOT 唯一 | `resolveBusinessAsrText` 仅读 `segmentForJobResult` |

### 2.3 配置精简边界

| 可做 | 不可做（未解冻） |
|------|------------------|
| 删除 **D 类死配置**字段与 default | 删除 rollback 代码路径 |
| 根 `maxSpans`  deprecate / 从 default 移除 | 改 `fwMetadataSpanGate.maxSpans` 默认 4 |
| 合并重复注释与 types | 改 `minDeltaToReplace` / `maxSentenceCandidates` 默认 |
| 文档化 `enableKenLMGate` 必需 | 将 P4 默认改为 `useSentenceLevelRerank: false` |
| SSOT 化测试 config | 批测改用非冻结 spanGateMode 作为主回归 |

### 2.4 Metadata Fallback 边界（易误判）

以下条件 **同时满足** 时仍走 `suspicious-span-detector-v1`（max `fallbackLegacyMaxSpans=1`）：

1. 无 alias / low_word_probability 候选  
2. `allowSegmentFallbackScan === true`  
3. segment avg_logprob 低 **且**（无 word alignment **或** alignment failures）  

**精简时：** 属冻结文档路径，**不能当 legacy 删除**；最多 P1 移入 `legacy/fw-detector/fallback/` 目录，行为须不变。

---

## 3. 冻结主链最小配置 SSOT（实施对照）

实施 P0/P1 后，节点默认（无 user config 覆盖）应等价于：

```json
{
  "asr": { "engine": "fw_detector_v1" },
  "features": {
    "lexiconRecall": { "enabled": false },
    "lexiconRuntimeV2": {
      "enabled": true,
      "bundlePath": "node_runtime/lexicon/v2_shadow",
      "maxBaseCandidates": 2,
      "maxDomainCandidates": 3,
      "maxIdiomCandidates": 0
    },
    "semanticRepair": { "enabled": false },
    "phoneticCorrection": { "enabled": false },
    "punctuationRestore": { "enabled": false },
    "fwDetector": {
      "enabled": true,
      "spanGateMode": "fw_metadata_gate",
      "useLexiconRuntimeV2Recall": true,
      "useSentenceLevelRerank": true,
      "useIndustryRouting": false,
      "enableKenLMGate": true,
      "maxSentenceCandidates": 16,
      "minDeltaToReplace": 0.03,
      "minPrior": 0.5,
      "recallMinPhoneticScore": 0.5,
      "candidateRequireRepairTarget": true,
      "kenlmSpanGate": { "enabled": false },
      "fwMetadataSpanGate": {
        "enabled": true,
        "maxSpans": 4,
        "minSpanChars": 2,
        "maxSpanChars": 4,
        "wordProbabilityThreshold": 0.65,
        "segmentAvgLogprobThreshold": -1.0,
        "allowAliasExactHit": true,
        "allowSegmentFallbackScan": true,
        "fallbackLegacyMaxSpans": 1
      }
    }
  }
}
```

**注意：** 上表 **不含** 根级 `maxSpans`（收敛后应移除或只读 mirror gate）。  
**P4 recall 每 span 上限** 由 `per-span-candidate-limit.ts` 决定，**不在 JSON 中**。

---

## 4. 完整实施 Checklist

### 4.1 阶段门禁

- [ ] 已阅读 [FW_MAINLINE_FREEZE.md](./FW_MAINLINE_FREEZE.md) 禁止项  
- [ ] 变更范围仅限 config/types/docs/目录移动；**不改** Recall/Rerank/Gate/Apply 算法  
- [ ] 每 PR 可独立回滚；不混合 P0 行为变更与 P2 删除  

### 4.2 P0 Checklist

| 项 | 动作 | 验证 |
|----|------|------|
| 死配置 | 删 `compressionRatioThreshold`、`fwMetadataSpanGate.noSpeechProbThreshold`、`enableRepairTargetFilter` | `npx jest freeze-contract`；gate 无引用 |
| types 注释 | 修正 `lexiconRuntimeV2`、maxSpans SSOT 注释 | 人工 review |
| maxSpans | 根级 deprecate 或移除 default；gate.maxSpans=4 为 SSOT | 更新 `FW_MAINLINE_FREEZE.md` |
| freeze-contract | 新增 dead-field / enableKenLMGate / 双 V2 开关断言 | `npx jest --testPathPattern=freeze-contract` |
| KenLM 文档 | PIPELINE + FREEZE 写明 enableKenLMGate 对 P4 必需 | 文档 review |
| spanDetectBudget | 文档或改为 fallback 专用 default | 不影响 dialog_200 |

**P0 回归：**

```powershell
cd electron_node\electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|fw-metadata-span-gate|fw-sentence-rerank"
node scripts/fw-detector-gate.mjs
```

### 4.3 P1 Checklist

| 项 | 动作 | 验证 |
|----|------|------|
| rollback 隔离 | 回滚项移入 `rollback` 或独立 JSON | 回滚手册可一键粘贴 |
| legacy 归档 | P1.2b 链移 `legacy/fw-detector/`；orchestrator import 更新 | gate + freeze-contract PASS |
| freeze-config-ssot | 新增 `tests/freeze-config-ssot.json`；patch + batch 引用 | 单文件改动能同步批测 |
| 写回收敛 | 评估去掉 `?? asrText`；补测试 FW skip 路径 | `asr-aggregation-contract` PASS |
| 批测脚本 | phase3 p32 标 deprecated；p4/freeze batch 共用 SSOT | 无重复 config 块 |
| 文案 | phonetic skip reason 改名 | 单测 PASS |

**P1 回归：**

```powershell
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
node tests/patch-p4-config.mjs
node tests/run-lexicon-v2-p4-batch.js "<dialog_200路径>" --limit 50
```

Restaurant domain：`run-p4-freeze-batch.js --profile restaurant`（需 session-migration，非 pipeline 参数）。

### 4.4 P2 Checklist（延后）

| 项 | 前置 |
|----|------|
| JobContext 分区 | P0/P1 稳定 + 无 FW 引用 Recover 字段新增 |
| 5015–5017 模块迁移 | enhancement 命名空间设计评审 |
| Pipeline 模板解耦 | 非 fw engine 回归套件就绪 |
| 删 Recover 代码 | 产品确认无 Recover 部署 |

### 4.5 原方案 Check List 细化

| 原 Check List | 细化验收 |
|---------------|----------|
| dialog_200 结果不变 | general 200/200 PASS；restaurant 199/200（已知 ASR flake 除外） |
| CER 不变 | 批测 summary 对比清理前后 JSON |
| apply 不变 | `summary.appliedCount` 分布 ±0 |
| pipeline P95 不变 | `fw_detector_step_ms` p95 ±5% |
| Metadata Gate 唯一 Span 来源 | 默认 job 的 `fwMetadataSpanGate` diagnostics 有值；非 fallback 为主 |
| Lexicon V2 唯一 Recall | `recallV2Diagnostics.v2_sql_query_count > 0`（有 span 时） |
| Sentence Rerank 唯一决策链 | `sentenceRerank` in extra；无 topK pipeline diags |
| applyFwSpanReplacements 唯一 Apply | grep 主链无其它 segment 写回 |
| segmentForJobResult 唯一 NMT 输入 | `resolveBusinessAsrText` 静态断言仍 PASS |

---

## 5. 建议合并回原方案的一行摘要

| 优先级 | 原方案缺少 | 建议并入 |
|--------|------------|----------|
| P0 | 文档 SSOT、双 V2 开关、Job override、spanDetectBudget | 见 §1.1 P0-3b~P0-8 |
| P0 | 死配置字段名清单 | 见 §1.1 P0-1 |
| P1 | P4 per-span limit 硬编码 | 见 §1.2 P1-5 |
| P1 | metadata fallback 不可删 | 见 §2.4 |
| P1 | freeze-config-ssot 文件化 | 见 §1.2 P1-3 |
| 全局 | FW_MAINLINE_FREEZE 禁止删 fallback | 见 §2.1 |
| 验收 | 命令与 restaurant 批测方式 | 见 §4.2–4.3 |

---

## 6. 相关文档

| 文档 | 关系 |
|------|------|
| [P1_P4_Freeze_Simplification_Plan_2026_05_31.md](./P1_P4_Freeze_Simplification_Plan_2026_05_31.md) | 原方案 |
| [FREEZE_SIMPLIFICATION_AUDIT_2026_05_27.md](./FREEZE_SIMPLIFICATION_AUDIT_2026_05_27.md) | 审计依据 |
| [FW_MAINLINE_FREEZE.md](./FW_MAINLINE_FREEZE.md) | 冻结边界 |
| [PIPELINE.md](./PIPELINE.md) | 运行时说明 |
