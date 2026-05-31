# P1~P4 Freeze Simplification 补充约束清单

日期：2026-05-31  
性质：实施前补充清单 / 非开发任务  
适用范围：P1~P4 已冻结主链后的精简清理阶段  

---

## 1. 执行摘要

原《P1~P4 冻结后精简方案》方向正确，但需要补充以下内容后才能作为开发 SSOT：

```text
1. 明确每个清理项的代码落点
2. 明确哪些 legacy / fallback 不能删除
3. 明确 P0 不得改变主链行为
4. 明确 P1/P2 的延后边界
5. 明确验收命令与回归指标
```

本补充清单的核心原则：

```text
不改 Recall
不改 Rerank
不改 Metadata Gate 主路径
不改 Apply
不改 NMT 输入
不删除 Recover / CTC / 5015~5017
不删除 metadata fallback
```

---

## 2. P0 必须补充项

### P0-1 死配置清单必须精确

需要处理的死配置：

```text
fwMetadataSpanGate.compressionRatioThreshold
fwMetadataSpanGate.noSpeechProbThreshold
enableRepairTargetFilter
```

代码落点：

```text
fw-config.ts
node-config-types.ts
node-config-defaults.ts
fw-metadata-span-gate.test.ts
```

处理方式：

```text
删除字段
或停止导出
或明确标记 deprecated 且不进入 runtime config
```

验收：

```text
gate runtime config 不再包含这些死字段
freeze-contract 有断言
```

---

### P0-2 node-config-types 注释修正

必须修正：

```text
lexiconRuntimeV2 默认值注释
fwDetector.maxSpans 注释
```

原因：

```text
代码默认 lexiconRuntimeV2.enabled=true
但 types 注释仍指向 false

P4 span 上限 SSOT 是：
fwMetadataSpanGate.maxSpans
不是根级 fwDetector.maxSpans
```

代码落点：

```text
node-config-types.ts
```

---

### P0-3 maxSpans 单一来源

冻结后唯一来源：

```text
fwMetadataSpanGate.maxSpans
```

根级：

```text
fwDetector.maxSpans
```

只能：

```text
删除
或 deprecated
或仅作为 legacy/rollback mirror
```

禁止：

```text
P4 主链继续读取根级 maxSpans
```

相关文件：

```text
fw-detector-orchestrator.ts
fw-metadata-span-gate.ts
FW_MAINLINE_FREEZE.md
PIPELINE.md
```

特别注意：

```text
FW_MAINLINE_FREEZE.md 中仍写根级 maxSpans:4
必须同步修改
```

---

### P0-4 Freeze Contract 扩展

新增断言：

```text
spanGateMode = fw_metadata_gate
useLexiconRuntimeV2Recall = true
useSentenceLevelRerank = true
kenlmSpanGate.enabled = false
enableKenLMGate = true
fwMetadataSpanGate.maxSpans = 4
```

新增死字段断言：

```text
compressionRatioThreshold 不进入 gate runtime config
fwMetadataSpanGate.noSpeechProbThreshold 不进入 gate runtime config
enableRepairTargetFilter 不作为独立开关
```

文件：

```text
freeze-contract.test.ts
```

---

### P0-5 enableKenLMGate 语义必须文档化

必须写明：

```text
enableKenLMGate=true
```

对 P4 不是可选项，而是：

```text
Sentence-Level Rerank scorer 必需条件
```

如果关闭：

```text
rerankFwSentences scorer=null
→ pickedIsRaw=true
→ 永不 apply
```

相关文件：

```text
rerank-fw-sentences.ts
fw-detector-orchestrator.ts
FW_MAINLINE_FREEZE.md
PIPELINE.md
```

---

### P0-6 spanDetectBudget 一致性

当前问题：

```text
spanDetectBudget fallback 使用：
(cfg.maxSpans ?? 2) * 4
```

但冻结主链：

```text
fwMetadataSpanGate.maxSpans = 4
```

处理方式：

```text
文档化为 legacy/fallback 专用
或改为读取 fallback 专用字段
```

不得影响 Metadata Gate 主路径。

相关文件：

```text
fw-config.ts
```

---

### P0-7 V2 双开关联动

V2 Recall 实际需要两个条件同时满足：

```text
lexiconRuntimeV2.enabled === true
useLexiconRuntimeV2Recall === true
```

如果只关闭：

```text
useLexiconRuntimeV2Recall
```

会回退到：

```text
V1 recallSpanTopKV1
```

必须在文档和 freeze-contract 中明确。

相关文件：

```text
lexicon-fw-recall-config.ts
local-span-recall.ts
```

---

### P0-8 Job 级 override 约束

存在 job/test 级 override：

```text
job.fw_detector.enableKenLMGate
test server options
```

必须约束：

```text
冻结验收 / 批测 / 集成测试不得误关 enableKenLMGate
```

相关文件：

```text
fw-job-overrides.ts
inference-service.ts
```

---

## 3. P1 建议补充项

### P1-1 rollback 配置隔离

将以下配置迁移到：

```text
fwDetector.rollback
```

或独立：

```text
config/rollback/*.json
```

包括：

```text
useSentenceLevelRerank=false
topK
finalScoreWeights
kenlmGateMode
kenlmVetoThreshold
kenlmDeltaThreshold
repairTargetScoreBoost
spanGateMode=kenlm_gate_filter
spanGateMode=legacy_detector
```

目的：

```text
主配置只暴露冻结路径
回滚路径不干扰日常维护
```

---

### P1-2 legacy/fw-detector 归档边界

可迁移：

```text
suspicious-span-detector-v1.ts
fw-topk-decision-pipeline.ts
candidate-scorer.ts
pick-approved-replacements.ts
```

不可删除：

```text
metadata fallback 回调
```

因为 P3.3 冻结路径仍允许：

```text
metadata 缺失
+
avg_logprob 低
+
alignment failure
```

时触发 legacy fallback，且：

```text
fallbackLegacyMaxSpans=1
```

---

### P1-3 freeze-config-ssot

新增：

```text
tests/freeze-config-ssot.json
```

当前事实 SSOT：

```text
tests/patch-p4-config.mjs
```

问题：

```text
patch-p4-config.mjs 未覆盖 enableKenLMGate / minPrior / candidateRequireRepairTarget
依赖代码默认值
```

建议：

```text
freeze-config-ssot.json
→ patch-p4-config.mjs 引用
→ batch scripts 引用
```

---

### P1-4 初始化写回收敛

当前存在：

```text
rawAsrText ?? asrText
```

需要评估能否收敛为：

```text
rawAsrText
```

代码落点：

```text
asr-step.ts
fw-detector-step.ts
```

实施前必须证明：

```text
FW skip 路径 rawAsrText 恒存在
```

---

### P1-5 P4 per-span limit 是代码常量

P4 动态候选预算由：

```text
per-span-candidate-limit.ts
```

控制：

```text
1 span → 8
2 span → 4
>=3 span → 2
```

不是配置项。

精简配置时不要误认为：

```text
topK
maxBaseCandidates
maxDomainCandidates
```

能直接控制 P4 final per-span candidate limit。

---

### P1-6 批测脚本去重

需要清理重复配置：

```text
run-lexicon-v2-p4-batch.js
run-p4-freeze-batch.js
patch-p4-config.mjs
```

标记 deprecated：

```text
run-lexicon-v2-phase3-p32-batch.js
```

原因：

```text
P3.2 KenLM Gate 路径已否决
```

---

### P1-7 文案修正

修正：

```text
phonetic-correction-step.ts
```

中的：

```text
RECOVER_WRITE_LOCKED
```

改成更准确的：

```text
SEGMENT_WRITE_LOCKED
```

或等价语义。

---

## 4. P2 延后补充项

### P2-1 JobContext Legacy 分区

`JobContext` 中 Recover / CTC / nbest / window recall 相关字段仍然暴露。

建议：

```text
@legacy 标记
或迁移到 legacyContext
```

代码落点：

```text
pipeline/context/job-context.ts
```

---

### P2-2 5015~5017 enhancement 化

当前：

```text
SEMANTIC_REPAIR
PHONETIC_CORRECTION
PUNCTUATION_RESTORE
```

仍在 registry 中。

允许保留：

```text
默认 OFF
isSegmentWriteLocked 保护
```

P2 再迁移到：

```text
enhancement/
```

不得在 P0/P1 删除。

---

### P2-3 Legacy Result Extra 迁移

迁移：

```text
buildLegacyRecoverResultExtra
```

到：

```text
legacy/recover/
```

FW 主链保留：

```text
buildFwResultExtra
```

代码落点：

```text
result-builder.ts
```

---

### P2-4 Pipeline Template 解耦

当前：

```text
PIPELINE_MODES.*
```

基模板仍含：

```text
LEXICON_RECALL
SENTENCE_REPAIR
```

FW 靠：

```text
applyFwDetectorPipelineMode
```

过滤。

P2 可改为：

```text
Recover engine 独立注入 Recover steps
FW engine 默认不含 Recover template
```

---

### P2-5 Gate 脚本文案更新

更新：

```text
scripts/fw-detector-gate.mjs
```

避免仍显示：

```text
P1.2c-fix / V1.1
```

---

## 5. 冻结禁止项

精简阶段不得修改：

```text
Recall merge / SQL / domain routing
P4 rerank combination
KenLM sentence batch
Metadata Gate 主信号和阈值
applyFwSpanReplacements
NMT 输入字段
```

不得删除：

```text
metadata legacy fallback
Recover
CTC
5015/5016/5017
```

不得引入：

```text
新的 FW writeback
新的 NMT input
新的 Span 来源
新的 Runtime JSONL 读取路径
```

---

## 6. Metadata Fallback 约束

以下条件同时满足时，fallback 仍可触发：

```text
1. 无 alias / low_word_probability 候选
2. allowSegmentFallbackScan = true
3. segment avg_logprob 低
4. 无 word alignment 或 alignmentFailures
```

上限：

```text
fallbackLegacyMaxSpans = 1
```

说明：

```text
这是冻结路径的一部分
不是可直接删除的 legacy
```

---

## 7. 冻结主链最小配置 SSOT

实施 P0/P1 后，节点无 user config 覆盖时，应等价于：

```json
{
  "asr": {
    "engine": "fw_detector_v1"
  },
  "features": {
    "lexiconRecall": {
      "enabled": false
    },
    "lexiconRuntimeV2": {
      "enabled": true,
      "bundlePath": "node_runtime/lexicon/v2_shadow",
      "maxBaseCandidates": 2,
      "maxDomainCandidates": 3,
      "maxIdiomCandidates": 0
    },
    "semanticRepair": {
      "enabled": false
    },
    "phoneticCorrection": {
      "enabled": false
    },
    "punctuationRestore": {
      "enabled": false
    },
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
      "kenlmSpanGate": {
        "enabled": false
      },
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

注意：

```text
不含根级 fwDetector.maxSpans
```

P4 recall 每 span 上限由：

```text
per-span-candidate-limit.ts
```

控制，不在 JSON 中。

---

## 8. Target List

### P0

- [ ] 删除 / 停止导出死配置
- [ ] 修正 node-config-types 注释
- [ ] maxSpans 收敛为 fwMetadataSpanGate.maxSpans
- [ ] 同步 FW_MAINLINE_FREEZE.md / PIPELINE.md
- [ ] 扩展 freeze-contract
- [ ] 文档化 enableKenLMGate 对 P4 必需
- [ ] 文档化 V2 双开关联动
- [ ] 约束 job 级 override

### P1

- [ ] rollback 配置隔离
- [ ] legacy/fw-detector 归档
- [ ] freeze-config-ssot.json
- [ ] 初始化写回收敛验证
- [ ] P4 per-span limit 文档化
- [ ] 批测脚本配置去重
- [ ] phonetic skip reason 文案修正

### P2

- [ ] JobContext legacy 分区
- [ ] 5015~5017 enhancement 化
- [ ] Legacy Result Extra 迁移
- [ ] Pipeline Template 解耦
- [ ] fw-detector-gate 脚本文案更新

---

## 9. Check List

### P0 回归

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|fw-metadata-span-gate|fw-sentence-rerank"
node scripts/fw-detector-gate.mjs
```

### P1 回归

```powershell
node tests/patch-p4-config.mjs
node tests/run-lexicon-v2-p4-batch.js "<dialog_200路径>" --limit 50
```

Restaurant domain：

```powershell
node tests/run-p4-freeze-batch.js --profile restaurant
```

### 行为验收

- [ ] dialog_200 结果不变
- [ ] CER 不变
- [ ] apply 数量不变
- [ ] degrade 不增加
- [ ] pipeline P95 不明显变化
- [ ] Metadata Gate 仍是默认唯一 Span 主路径
- [ ] V2 Recall 仍是默认唯一 Recall
- [ ] P4 Sentence Rerank 仍是默认决策链
- [ ] applyFwSpanReplacements 仍是唯一 Apply
- [ ] segmentForJobResult 仍是 NMT 唯一输入

---

## 10. 最终建议

立即合并到原方案：

```text
P0-1 ~ P0-8
```

然后才允许开始 P0 精简开发。

P1 可以作为冻结后第一轮维护任务。

P2 延后到下一版本。

