# P1~P4 PostCleanup 补充实施方案（最终版）

日期：2026-06-01
状态：P1 开发前最终补充方案
依据：PostCleanup Plan + 补充清单

## 核心结论

原 PostCleanup 方案需要补充 8 个关键部分：

1. Legacy FW Detector 精确归档边界
2. JobContext Legacy 分区方案
3. Freeze Guard 独立文档
4. Result Builder 收敛边界
5. Runtime SSOT 与 Test SSOT 同步机制
6. segmentForJobResult 写点白名单
7. orchestrator 双路径保留约束
8. P1 / P2 调整后的实施顺序

---

# 一、最终架构目标

ASR
→ FW Metadata Gate
→ Lexicon Runtime V2
→ Sentence Rerank
→ applyFwSpanReplacements
→ segmentForJobResult
→ NMT

冻结后禁止新增：

- 新 Span 来源
- 新 Recall 实现
- 新 Rerank 链
- 新 segmentForJobResult 写回点

---

# 二、Legacy FW Detector 归档

目标目录：

main/src/legacy/fw-detector/

允许迁移：

- fw-topk-decision-pipeline.ts
- candidate-scorer.ts
- pick-approved-replacements.ts
- span-replacement-eval.ts

禁止迁移：

- fw-metadata-span-gate.ts
- suspicious-span-detector-v1.ts
- map-fw-metadata-span.ts
- P4 rerank 系列
- apply 系列

原因：

metadata fallback 仍属于冻结路径的一部分。

---

# 三、JobContext Legacy 分区

目标结构：

```ts
interface JobContext {
  rawAsrText: string;
  segmentForJobResult: string;
  legacy?: LegacyContext;
}
```

```ts
interface LegacyContext {
  recover?: unknown;
  ctc?: unknown;
  nbest?: unknown;
  windowRecall?: unknown;
}
```

迁移原则：

- FW 主链禁止读写 legacy
- 保留兼容 alias
- 不改变 JobResult.extra 输出

---

# 四、Freeze Guard

新增文档：

docs/FREEZE_GUARD.md

必须包含：

## 写点白名单

允许：

- asr-step 初始化
- fw-detector-step 初始化
- fw-detector-orchestrator apply
- aggregation-step
- 5015/5016/5017（write-lock）
- legacy recover

禁止新增任何其它写点。

## 唯一链路

Span:
Metadata Gate

Recall:
Lexicon Runtime V2

Decision:
Sentence Rerank

Apply:
applyFwSpanReplacements

NMT Input:
segmentForJobResult

---

# 五、Result Builder 收敛

保留：

buildFwResultExtra

buildLegacyRecoverResultExtra

要求：

- FW 路径不得泄漏 Recover 字段
- FW extra 不得包含 sentence_repair
- FW extra 不得包含 asr_nbest

新增 freeze-contract 断言。

---

# 六、SSOT 同步规则

运行时 SSOT：

node-config-defaults.ts

测试 SSOT：

tests/freeze-config-ssot.json

要求：

冻结字段必须一致：

- spanGateMode
- useLexiconRuntimeV2Recall
- useSentenceLevelRerank
- enableKenLMGate
- maxSpans
- maxSentenceCandidates
- minDeltaToReplace

新增一致性检查。

---

# 七、segmentForJobResult 白名单

允许写入：

- asr-step
- fw-detector-step
- fw-detector-orchestrator
- aggregation-step
- semantic-repair-step
- phonetic-correction-step
- punctuation-restore-step
- legacy recover

禁止新增。

agent/postprocess 局部变量不算写点。

---

# 八、Orchestrator 保留约束

必须保留：

- runFwSentenceRerankPipeline
- runFwTopKDecisionPipeline
- createSpanDetectorHint
- metadata fallback

即使 legacy 文件归档也不得删除。

原因：

用于 rollback 与 fallback。

---

# 九、P1 实施顺序

1. Freeze Guard 文档
2. legacy/fw-detector 归档
3. SSOT 一致性检查
4. Result Builder 断言
5. JobContext Legacy 分区

---

# 十、P2 实施顺序

1. Recover Template 解耦
2. 5015~5017 enhancement 化
3. recover-result-bridge 清理
4. Legacy Result Extra 零 FW import

---

# Target List

## P1

- [ ] Freeze Guard 文档
- [ ] legacy/fw-detector 归档
- [ ] JobContext Legacy 分区
- [ ] Result Builder 收敛断言
- [ ] SSOT 一致性检查
- [ ] 写点白名单文档化

## P2

- [ ] Recover Template 解耦
- [ ] 5015~5017 enhancement 化
- [ ] recover-result-bridge 清理
- [ ] Legacy Result Extra 清理

# Check List

## 架构

- [ ] Metadata Gate 唯一 Span 来源
- [ ] Metadata fallback 保留
- [ ] V2 唯一 Recall
- [ ] P4 唯一决策链
- [ ] applyFwSpanReplacements 唯一 Apply
- [ ] segmentForJobResult 唯一 NMT 输入

## 行为

- [ ] dialog_200 apply 数不变
- [ ] degraded 不增加
- [ ] CER 不明显恶化
- [ ] rollback 路径仍可运行

## Legacy

- [ ] Recover 不进入 FW 默认路径
- [ ] CTC 不进入 FW 主链
- [ ] 5015~5017 默认 OFF
- [ ] FW 主链无 Recover runtime import
