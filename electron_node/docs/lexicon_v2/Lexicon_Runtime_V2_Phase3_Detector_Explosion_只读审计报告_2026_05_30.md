# Lexicon Runtime V2 — Phase 3 Detector Explosion 只读审计报告

版本：V1.0  
日期：2026-05-30  
类型：只读代码审计（无代码修改）

---

## 1. 执行摘要

**核心结论：2298 次 recall 并非 Phase 3 新引入；Detector 在 Phase 2 就已输出 ~12 span/job。**

| 维度 | Phase 2 | Phase 3 Hotfix | 变化 |
|------|---------|----------------|------|
| span/job | **11.52** (max 12) | **11.55** (max 12) | 无实质变化 |
| recall 调用 | 2303 | 2298 | 无实质变化 |
| 有候选 span | **48 (2.1%)** | **1075 (46.8%)** | **×22** |
| FW apply | **10** | **680** | **×68** |
| CER (final) | 35.93% | 51.62% | +15.7pp |

**Phase 2→3 的质量雪崩主因是 B（单 span apply 率 + V2 召回命中率），不是 A（Detector span 数量暴增）。**

### 已排除（Hotfix 验证）

1. LexiconRuntimeV2 正常（v2_recall P95 = 3ms）
2. SQL LIMIT 正常（base=2, domain=3, idiom=0）
3. `candidate_count_after_merge` max = 2
4. Industry Routing = 0
5. Session Intent 未参与评分

### Detector 侧设计漂移

- 配置/文档写 `maxSpans=2`（每句 0~2 高风险 span）
- 实际截断用的是 **`spanDetectBudget=12`**，且 `maxSpans` **从未参与选择逻辑**
- `minRiskScore=2` + `detector_pinyin_hint` 权重 2 → **82% kept span 仅因「2~5 音节」即达标**，无需 domain anchor

### Phase 3 额外伤害

V2 `base_lexicon` 对大量 2 字 homophone 返回候选，且 **100% 带 `repair_target=1`**，使 `candidateRequireRepairTarget` 在 Pick 层形同虚设。

---

## 2. Recall 调用链

```text
pipeline/steps/fw-detector-step.ts
  → runFwDetectorOrchestrator()
      │
      ├─ createSpanDetectorHint()          // 纯音节形状，不查词库
      ├─ detectSuspiciousSpansV1()         // 枚举 + 打分 + spanDetectBudget 截断
      │
      └─ runFwTopKDecisionPipeline()       // 对每个 kept span 无条件：
            │
            ├─ recallSpanTopK()            // local-span-recall.ts
            │     ├─ V1: lookupTopKByPinyin (Phase 2)
            │     └─ V2: recallSpanTopKViaRuntimeV2 → recallSpanTopKV2 (Phase 3)
            │
            ├─ scoreRecallHits()           // 有 hits 才进 KenLM
            ├─ pickBestCandidatePerSpan()  // candidateRequireRepairTarget 在此
            └─ pickApprovedReplacementsGreedy()
      │
      └─ applyFwSpanReplacements()
```

**关键代码位置：**

| 步骤 | 文件 |
|------|------|
| Detector | `fw-detector/suspicious-span-detector-v1.ts` |
| Orchestrator | `fw-detector/fw-detector-orchestrator.ts` |
| Recall + KenLM + Pick | `fw-detector/fw-topk-decision-pipeline.ts` |
| V1/V2 Recall 分支 | `lexicon/local-span-recall.ts` |
| V2 SQL Recall | `lexicon-v2/recall-span-topk-v2.ts` |

**Detector 与 Recall 完全解耦**：Detector 不读词库、不读 `repairTarget`、不做 `hasReplacementCandidate`（`freeze-contract.test.ts` 静态断言）。

---

## 3. Detector 门控链

### 3.1 枚举（无门控）

`enumerateCjkSpans()` 在每个 CJK 连续段内枚举所有 `len ∈ [minSpanChars=2, maxSpanChars=4]` 子串。

批测 `enumeratedCount` 均值 **~40/句**。

### 3.2 打分信号

| 信号 | 默认权重 | 触发条件 |
|------|----------|----------|
| `detector_pinyin_hint` | **2** | 音节数 2~5（`span-detector-hint.ts`） |
| `domain_anchor_nearby` | 2 | span 前后 8 字内命中 domain anchor |
| `low_no_speech_prob` | 1 | 对应 ASR segment `no_speech_prob > 0.5` |
| `mixed_language_anomaly` | 1 | span 含拉丁字母 |

`riskScore = Σ signalWeights`，默认 **`minRiskScore=2`**。

**批测信号分布（2298 spans，Phase 3 Hotfix）：**

| 信号组合 | 数量 | 占比 |
|----------|------|------|
| 仅 `detector_pinyin_hint` | 1886 | 82.1% |
| `hint + low_no_speech_prob` | 256 | 11.1% |
| `hint + domain_anchor_nearby` | 156 | 6.8% |
| `below_min_risk` 丢弃 | 0 | 0% |

### 3.3 截断（hard limit）

```typescript
// suspicious-span-detector-v1.ts:257-261
const { kept, dropped } = selectSpansForPipeline(
  scored,
  config.spanDetectBudget,   // ← 实际用的是这个，不是 maxSpans
  config.minRiskScore
);
```

| 参数 | 配置值 | 是否生效 |
|------|--------|----------|
| `maxSpans` | 2 | **否**（仅写入 configSnapshot） |
| `spanDetectBudget` | **12** | **是**（hard limit） |
| `minRiskScore` | 2 | 是，但几乎不滤（pinyin hint alone 即过） |
| `minSpanChars` / `maxSpanChars` | 2 / 4 | 是（枚举上界） |

批测：`keptCount` 恒为 **12**，`dropBudget`（reason=`maxSpans`）~**4900/200 句**。

### 3.4 理论每句最多 span 数

| 类型 | 限制 | 值 |
|------|------|-----|
| Hard limit | `spanDetectBudget` | **12** |
| Soft limit | `minRiskScore` | 2（实际几乎不过滤） |
| 枚举上界 | `minSpanChars`~`maxSpanChars` | 2~4 字 window |
| 排序 | riskScore ↓, spanLength ↓, start ↓ | top-N by budget |
| **`maxSpans`** | 文档/design | **2（未接入）** |

---

## 4. Span Funnel（批测实测）

数据来源：

- Phase 2：`tests/lexicon-v2-phase2-dialog200-batch-result.json`
- Phase 3 Hotfix：`tests/lexicon-v2-phase3-hotfix-audit-batch-result.json`

### Phase 2（V1 Recall）

```text
200 jobs
  → 2303 spans detected     (11.52/job, max 12)
  → 2303 recall 调用        (100%，无二次过滤)
  → 48 spans 有候选         (2.1%)
  → 48 KenLM approved
  → 10 picked
  → 10 applied
```

### Phase 3 Hotfix（V2 Recall，SQL LIMIT 2/3/0）

```text
199 jobs
  → 2298 spans detected     (11.55/job, max 12)
  → 2298 recall 调用
  → 1075 spans 有候选        (46.8%)
  → 1440 KenLM approved      (topK=3，多候选/span)
  → 1075 picked
  → 680 applied              (D-greedy 去重叠后)
```

### Apply 漏斗对比

| 阶段 | Phase 2 | Phase 3 | 说明 |
|------|---------|---------|------|
| jobs | 200 | 199 | |
| spans detected | 2303 | 2298 | **相同量级** |
| recall 调用 | 2303 | 2298 | 100% kept → recall |
| 有候选 span | 48 (2.1%) | 1075 (46.8%) | **V2 主因** |
| repairTarget 候选 | 10/48 (20.8%) | 1440/1440 (100%) | Pick 门控失效 |
| KenLM approved | 48 | 1440 | |
| picked | 10 | 1075 | |
| applied | 10 | 680 | D-greedy 去重叠 |
| 有候选时 apply 率 | 20.8% | 63.3% | |

### 问题十：A vs B

| 因素 | Phase 2→3 贡献 |
|------|----------------|
| **A. Detector span 数量暴增** | **否**（12→12，Phase 2 已是 12） |
| **B. 每 span apply 率 + 召回命中率暴增** | **是** |

---

## 5. Phase 2 vs Phase 3 差异

| 层 | Phase 2 | Phase 3 | 是否变化 |
|----|---------|---------|----------|
| Detector 输出 | 12 span/job | 12 span/job | **无** |
| Recall 路径 | V1 `lookupTopKByPinyin` | V2 `base_lexicon LIMIT 2` | **有** |
| 候选命中率 | 2.1% | 46.8% | **有** |
| repairTarget 候选占比 | 20.8% | **100%** | **有** |
| Pick 门控 | 有效（10/48 通过） | **失效** | **有** |
| KenLM avg | ~11.3s | ~9.8s | 略降（LIMIT 生效） |
| CER | 35.93% | 51.62% | **劣化** |

**Phase 3 未改变 Detector**；改变的是 **V2 词库覆盖面 + repair_target 标注策略**。

---

## 6. Top 20 高频触发 Span

Detector kept span，Phase 3 Hotfix 批测统计：

| span | 出现次数 | 有候选率 | apply 率 | 是否应进 FW |
|------|----------|----------|----------|-------------|
| 一下 | 27 | 100% | 100% | **否**（功能词，homophone 误替） |
| 可以 | 21 | 100% | 67% | **否** |
| 多久 | 13 | 0% | 0% | 否（无 homophone 命中） |
| 大概 | 13 | 100% | 46% | **否** |
| 下午 | 13 | 0% | 0% | 否 |
| 需要 | 11 | 100% | 45% | **否** |
| 我们 | 10 | 0% | 0% | 否 |
| 处理 | 10 | 100% | 100% | 边界（领域词才可能） |
| 就行 | 9 | 100% | 44% | **否** |
| 能到 | 9 | 0% | 0% | 否（切分 artifact） |
| 久能 | 9 | 0% | 0% | 否（切分 artifact） |
| 候能 | 9 | 0% | 0% | 否（切分 artifact） |
| 概多 | 8 | 0% | 0% | 否（切分 artifact） |
| 怎么 | 8 | 0% | 0% | 否 |
| 生成 | 8 | 100% | 75% | 可能（tech 场景） |
| 电子 | 8 | 100% | 50% | 可能 |
| 安排 | 8 | 0% | 0% | 否 |
| 点吗 | 8 | 100% | 100% | **否**（ASR 切分 artifact） |
| 下吗 | 8 | 100% | 0% | **否** |
| 能帮 | 8 | 0% | 0% | 否 |

**模式**：Detector 对 **所有 2 字、2 音节 window** 打 `detector_pinyin_hint`；V2 base 对高频拼音键返回 homophone；**功能词/切分碎片** 被误替是 CER 主因。

---

## 7. 审计问题逐项答复

### 一、Detector 真实触发条件与调用链

见 **§2 Recall 调用链**、**§3 Detector 门控链**。

### 二、进入 Recall 的门控条件

**Detector 层（进入 kept spans）：**

1. CJK 连续段内 2~4 字 window
2. `riskScore >= minRiskScore (2)`
3. 按 riskScore 排序后取前 `spanDetectBudget (12)` 个

**Recall 层（`fw-topk-decision-pipeline.ts`）：**

- **无额外门控**：所有 kept span 均调用 `recallSpanTopK`
- Recall 内部：`syllables 2~5`、`topK>0`、`minPrior>=0.5`、domain filter

**不存在** risk score / repairTarget / candidate count 在 Recall 前的过滤。

### 三、有候选 → 直接进入 Recall？

**否，顺序相反**：先 Recall，再判断是否有 hits。

```typescript
// fw-topk-decision-pipeline.ts:231-239
for (const span of input.spans) {
  const recall = recallSpanTopK(...);  // 无条件调用
  const scored = await scoreRecallHits(..., recall.hits, ...);
}
```

不存在「有候选才触发 Recall」逻辑。

### 四、maxSpans 是否生效？

| 项 | 值 |
|----|-----|
| 配置 `maxSpans` | 2 |
| 实际截断参数 | `spanDetectBudget` = **12** |
| 批测 kept max | **12** |
| 结论 | **`maxSpans` 被绕过/ dead config** |

### 五、SuspiciousSpan 输出后是否全部进入 Recall？

**是，100%**。`runFwTopKDecisionPipeline` 对 `input.spans` 全量 for-loop，无二次过滤。

### 六、一句正常句子最多几个 Span？

| 限制 | 值 |
|------|-----|
| 理论枚举 | ~40（随 CJK 长度） |
| 实际 kept | **≤12**（`spanDetectBudget` hard limit） |
| 设计文档预期 | 0~2（`maxSpans`，未实现） |

### 七、Phase 3 V2 是否影响 Detector？

**否。**

- 代码：Detector 不 import lexicon / recall（`freeze-contract.test.ts`）
- 批测：Phase 2 / Phase 3 span/job 均为 ~12，Top20 span 文本一致

### 八、candidateRequireRepairTarget 是否仍生效？

| 层 | 状态 |
|----|------|
| 代码位置 | `fw-topk-decision-pipeline.ts:255-257`（**Pick 层**） |
| Phase 2 数据 | 有效：48 候选 → 10 repairTarget → 10 apply |
| Phase 3 数据 | **失效**：1440 候选 100% repairTarget |
| 失效原因 | V2 `base_lexicon.repair_target=1` 过宽，非代码删除 |

### 九、repairTarget 参与 Recall Gate 还是 Pick Gate？

**仅 Pick Gate**（`candidateRequireRepairTarget`）。Recall / KenLM 阶段不过滤 repairTarget。

### 十、680 apply 来自 A 还是 B？

**主要来自 B**（见 §4 Apply 漏斗）。Detector span 数 Phase 2/3 相同。

### 十一、Top 20 高频 Span

见 **§6**。

### 十二、Phase 2→3 哪个门控失效？

| 优先级 | 失效门控 | 代码/数据位置 |
|--------|----------|---------------|
| 1 | V2 homophone 召回面 | `recall-span-topk-v2.ts` + V2 seed |
| 2 | V2 repair_target 过宽 | `lexicon-runtime-v2.ts` SQL + seed |
| 3 | `maxSpans=2` 未接入 | `suspicious-span-detector-v1.ts:259` |
| 4 | `minRiskScore` 名存实亡 | `span-detector-hint.ts` + `fw-config.ts` |
| 5 | Detector→Recall 零门控 | `fw-topk-decision-pipeline.ts:231` |

---

## 8. 疑似失效门控汇总

| # | 门控 | 设计意图 | 实际状态 | 代码位置 |
|---|------|----------|----------|----------|
| 1 | **`maxSpans=2`** | 每句 0~2 span | **完全失效** | `suspicious-span-detector-v1.ts:259` |
| 2 | **`minRiskScore=2`** | 过滤低风险 span | **名存实亡** | `fw-config.ts`, `span-detector-hint.ts` |
| 3 | **Recall 前置门控** | 仅高风险 span recall | **不存在** | `fw-topk-decision-pipeline.ts:231` |
| 4 | **`candidateRequireRepairTarget`** | 仅 pick repair_target | Phase 2 有效；Phase 3 **数据层失效** | `fw-topk-decision-pipeline.ts:255` |
| 5 | **`recallMinPhoneticScore`** | FW 层音韵阈值 | **未接入 pipeline** | 仅在 `fw-config.ts` 加载 |

---

## 9. 根因排序

1. **`spanDetectBudget=12` 替代 `maxSpans=2`** → 每句固定 12 span 进 Recall（P1.2c 冻结合约显式允许 `spanDetectBudget≥12`）
2. **`detector_pinyin_hint` 权重=门槛=2** → 82% span 无 anchor 仍保留
3. **Detector→Recall 零门控** → 12 span × 199 job ≈ 2298 recall（Phase 2 相同）
4. **Phase 3 V2 base_lexicon homophone 覆盖** → 候选命中率 2.1%→46.8%（**CER 雪崩主因**）
5. **V2 `repair_target=1` 过宽** → Pick 层 repairTarget 过滤失效
6. **KenLM weak_veto** → Phase 3 1440/1440 approved（几乎不 veto）

---

## 10. 建议修复方案（审计建议，不含实现）

### Detector 层（缩 Recall 触发面）

- 将 `selectSpansForPipeline` 的 budget 改为 `maxSpans`（或 `spanDetectBudget=2`）
- 提高 `minRiskScore` 至 3~4，或要求 **`domain_anchor_nearby` 才 eligible**
- 增加 Recall 前 gate：`riskScore ≥ X` 或 signals 含 anchor

### Recall/Pick 层（P3.2，不改 Detector）

- V2 base 候选质量评分 + 收紧 `repair_target` 标注
- Recall 层增加 `repairTarget` / prior 门槛（当前仅在 Pick）
- 功能词 / 低 prior homophone 黑名单

---

## 11. Target List

| 优先级 | 文件 | 关注点 |
|--------|------|--------|
| P0 | `fw-detector/suspicious-span-detector-v1.ts:257-261` | `spanDetectBudget` vs `maxSpans` 错接 |
| P0 | `node-config-defaults.ts:88-89` | `maxSpans:2` + `spanDetectBudget:12` 矛盾 |
| P0 | `fw-detector/fw-topk-decision-pipeline.ts:231-266` | 全 span 无条件 recall；Pick 门控 |
| P1 | `fw-detector/span-detector-hint.ts:18-22` | pinyin hint 触发过宽 |
| P1 | `fw-detector/fw-config.ts:43-48,55-56` | signalWeights / budget 默认 |
| P1 | `lexicon-v2/lexicon-runtime-v2.ts` + V2 seed | `repair_target` 标注过宽 |
| P2 | `lexicon-v2/recall-span-topk-v2.ts` | 候选评分（P3.2） |
| P2 | `fw-detector/freeze-contract.test.ts:29,42` | 合约显式允许 budget≥12 |

---

## 12. Check List

- [x] Detector 触发条件已梳理（枚举 → 信号 → budget）
- [x] Recall 全链路已追踪（orchestrator → topk pipeline → local-span-recall）
- [x] `maxSpans` 失效已确认（代码 + 批测 p50=12）
- [x] Phase 2 vs Phase 3 span 数对比（相同）
- [x] apply funnel 已量化（10 vs 680）
- [x] V2 未影响 Detector（span 数不变 + 静态合约）
- [x] `candidateRequireRepairTarget` 层位已确认（Pick only；Phase 3 数据层失效）
- [x] Top 20 span 已统计
- [x] 根因 A/B 已分离

---

## 13. 直接回答

**为什么是 199 jobs → 2298 recall → 680 apply → CER 51.62%，而不是 199 → 几十 → 10 → 35.93%？**

```text
199 jobs
  ↓
~40 枚举/句 → spanDetectBudget=12 保留（非 maxSpans=2）
  ↓
2298 recall（Phase 2 已是 2303，Detector 非 Phase 3 回归点）
  ↓
Phase 3 V2 对 46.8% span 返回 homophone（Phase 2 仅 2.1%）
  ↓
100% repair_target → Pick 门控失效 → KenLM weak_veto 全过
  ↓
680 apply（D-greedy 后仍极高）
  ↓
CER 51.62%
```

**「Detector Explosion」（11.5 span/job）是 P1.2c 配置/实现漂移（budget=12 + pinyin hint 门槛），Phase 2 已存在但未造成 CER 劣化，因为 V1 词库几乎不返候选。Phase 3 打开 V2 后，同一 Detector 输出被放大为 mass apply。**

---

## 14. 相关文档与数据

| 资源 | 路径 |
|------|------|
| P3 Hotfix 验证报告 | `Lexicon_Runtime_V2_P3_Hotfix_验证报告_2026_05_30.md` |
| Phase 2 批测 | `tests/lexicon-v2-phase2-dialog200-batch-result.json` |
| Phase 3 Hotfix 批测 | `tests/lexicon-v2-phase3-hotfix-audit-batch-result.json` |
| FW 主链冻结 | `docs/ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md` |

---

**审计约束：** 本次仅只读分析，未修改任何代码。
