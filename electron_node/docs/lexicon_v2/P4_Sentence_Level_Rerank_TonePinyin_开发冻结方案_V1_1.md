# P4 Sentence-Level Rerank + Tone Pinyin 开发冻结方案 V1.1

日期：2026-05-31

依据：
- `P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_V1.md`
- `P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_补充清单_V1_1.md`
- `P4_Sentence_Level_Rerank_TonePinyin_方案与审计提示词_2026_05_31.md`
- `P4_Sentence_Level_Rerank_TonePinyin_开发前只读审计报告_2026_05_31.md`
- `Lexicon_Runtime_V2_P3_3_FW_Apply_Degrade_只读审计报告_2026_05_31.md`

---

## 一、执行摘要

P4 将 P3.3 **per-span greedy pick + weak_veto** 替换为 **句级 KenLM rerank**，并引入 **Tone Pinyin 排序**（不过滤）。Metadata Span Gate 与 `applyFwSpanReplacements` 不变。

| 类别 | P3.3 | P4 冻结 |
|------|------|---------|
| Span 决策 | 每 span 独立 finalScore | 整句组合 + 单 batch KenLM |
| Recall limit | base 2 + domain 3 叠加 | domain+alias+base **合计** perSpanLimit |
| KenLM | per-span weak_veto | **1 次** batch（raw + ≤16 候选） |
| maxSpans | 2 | **4** |
| 回滚 | — | `useSentenceLevelRerank=false` → P3.3 路径 |

---

## 二、冻结架构

```text
ASR rawText + Metadata
→ FW Metadata Span Gate（不变）
→ recallSpanCandidateSets（V2，合计 limit + tone 排序）
→ buildSentenceCandidates（笛卡尔积，cap=16）
→ rerankFwSentenceCandidates（KenLM batch，raw 必入）
→ mapBestSentenceToApprovedReplacements
→ applyFwSpanReplacements（不变）
```

**接入点**：`fw-detector-orchestrator.ts` — `useSentenceLevelRerank ? runFwSentenceRerankPipeline : runFwTopKDecisionPipeline`

**禁止**：
- 不修改 CTC
- 不恢复 Recover 主链
- 不直接 import `legacy/recover/`
- Lexicon 不反推 Span；只出候选
- 不重新启用 KenLM Span Gate 找 span
- Metadata Gate 仍是 span SSOT（继承 P3.3）
- P4 句级路径 **不调用** per-span `kenlm-span-gate weak_veto`

---

## 三、参数与函数

### 3.1 全局上限

| 参数 | 默认 |
|------|------|
| `maxSpans` | **4** |
| `maxSentenceCandidates` | **16**（不含 raw） |
| `minDeltaToReplace` | **0.03**（可调 0.02–0.05） |
| `useSentenceLevelRerank` | **true**（开发期；灰度可 false 回滚） |

### 3.2 动态 per-span limit（合计上限）

| span 数 | 每 span 最大候选 | 最大组合 |
|--------|-----------------|---------|
| 1 | 8 | 8 |
| 2 | 4 | 16 |
| 3 | 2 | 8 |
| 4 | 2 | 16 |

```ts
function getPerSpanCandidateLimit(spanCount: number): number {
  if (spanCount <= 1) return 8;
  if (spanCount === 2) return 4;
  return 2;
}
```

**禁止** base LIMIT 2 + domain LIMIT 3 **叠加**（P3.3 行为）。

### 3.3 KenLM 句级 rerank

```text
sentences = [rawText, ...candidateTexts]   // ≤ 17
baselineNorm = scores[0].normalizedScore
delta_i = scores[i+1].normalizedScore - baselineNorm
picked = argmax(delta_i)
若 maxDelta < minDeltaToReplace → 不 apply（raw 胜）
tie-break：delta 相等时 raw 优先
pickedIsRaw → approved = []
```

---

## 四、Recall / Tone

### 4.1 合并优先级

```ts
dedupeByWord([
  ...domainCandidates,
  ...aliasCandidates,
  ...baseCandidates,
]).slice(0, perSpanLimit);
```

| 场景 | 行为 |
|------|------|
| 有 activeDomain | domain 优先 + base fallback |
| 无 activeDomain | 仅 base 保守召回 |

第一版 Industry Routing：仅用 `profile.primaryDomain` + `resolveDomainIdsForRecall`。

### 4.2 Tone 规则

- `pinyin_key`：无声调，用于 recall 查询
- `tone_pinyin_key`：带声调，**仅排序**，禁止硬过滤
- `toneDistance` 参与 span 内预排序
- build 输出 tone coverage stats

### 4.3 P1 Schema

- `base_lexicon` / `domain_lexicon` 增 `tone_pinyin_key` + 索引
- schema：`lexicon-v2-shadow-v2`
- **domain_lexicon 灌入**（restaurant 等域）

---

## 五、Sentence Rerank

- 每 span 选 1 个 replacement，笛卡尔积
- 超 `maxSentenceCandidates=16` 按 `candidateScore` 预排序截断
- raw **必须**入 batch
- 句级 winner 仅 KenLM；span 内预排序：`domainPriority → priorScore → toneDistance`

---

## 六、RepairTarget 与 P3.4-A

- **`candidateRequireRepairTarget=true` 仍生效**（approved 映射层）
- P4 **不能单独**解决 repair_target=100% 问题
- 与 **P3.4-A（RepairTarget / 词库质量）并行或先行**
- 禁止黑名单硬挡同音陷阱

验收失败排查顺序：候选池 → repair_target → minDelta → combination 截断 → tone 权重

---

## 七、Diagnostics

`FwDetectorResult.sentenceRerank`：

```ts
{
  spanCount, perSpanLimit, combinationCount,
  kenlmQueryCount, pickedIsRaw, maxDelta, minDeltaToReplace,
  topCandidates: [{ text, kenlmDelta, replacementCount }]
}
```

---

## 八、批测配置冻结

| 配置项 | 值 |
|--------|-----|
| `spanGateMode` | `fw_metadata_gate` |
| `kenlmSpanGate.enabled` | `false` |
| `useLexiconRuntimeV2Recall` | `true` |
| V2 bundle | `node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite` |
| 音频 | `test wav/dialog_200` |
| 限时 | 15 min |

---

## 九、验收指标（P5）

| 指标 | P3.3 基线 | P4 目标 |
|------|----------|---------|
| dialog_200 | 200/200 | 200/200 |
| avg CER final | 36.35% | ≤ Phase2 35.93% 或 degrade↓ |
| FW apply | 24 | improve↑ degrade↓ |
| pipeline P95 | 4096 ms | 不劣化 >10% |
| KenLM batch | — | ≤17 句/次 |

报告：apply/improve/degrade/unchanged 分列；对比 Phase2 与 P3.3。

---

## 十、回滚

```json
{
  "features": {
    "fwDetector": {
      "useSentenceLevelRerank": false
    }
  }
}
```

`false` → 保留 `runFwTopKDecisionPipeline`（P3.3 per-span + weak_veto）。

---

## 十一、Check List

### 架构
- [x] Metadata Gate 保留
- [x] Lexicon 不反推 Span / 只出候选
- [x] 句级 KenLM rerank（单 batch）
- [x] 移除 per-span weak_veto（句级路径）
- [x] applyFwSpanReplacements 保留
- [x] 不修改 CTC / 不恢复 Recover / 不启用 KenLM Span Gate 找 span

### 复杂度
- [x] maxSpans = 4
- [x] maxSentenceCandidates = 16
- [x] raw 必入 rerank
- [x] per-span 动态 limit（8/4/2）
- [x] base+domain 合计上限
- [x] KenLM batch ≤ 17

### 声调
- [x] pinyin_key 无声调 recall
- [x] tone_pinyin_key 排序不过滤
- [x] tone_distance 参与排序
- [x] tone coverage stats（build）

### 质量 / 运维
- [x] candidateRequireRepairTarget 仍生效
- [x] minDeltaToReplace + raw tie-break
- [x] useSentenceLevelRerank 回滚开关
- [ ] dialog_200 回归达标（P5）

---

## 十二、Target List

| 阶段 | 交付物 | 退出条件 |
|------|--------|---------|
| P1 Schema | tone 字段、build stats、domain 灌库 | coverage + domain 行数 >0 |
| P2 Recall | merge 合计 limit、toneDistance | 单测 |
| P3 Sentence Rerank | combinator + rerank + minDelta | golden 单测 |
| P4 Integration | orchestrator + diagnostics + flag | jest + freeze-contract |
| P5 Validation | dialog_200 15min 报告 | §九达标或 documented gap |

---

**冻结完成。开发以本文 + vibe coding 代码规范为准。**
