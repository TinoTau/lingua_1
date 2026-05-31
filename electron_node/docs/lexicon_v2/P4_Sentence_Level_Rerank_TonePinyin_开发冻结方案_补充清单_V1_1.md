# P4 Sentence-Level Rerank + Tone Pinyin — 开发冻结方案补充清单 V1.1

日期：2026-05-31

依据：
- `P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_V1.md`
- `P4_Sentence_Level_Rerank_TonePinyin_方案与审计提示词_2026_05_31.md`
- `P4_Sentence_Level_Rerank_TonePinyin_开发前只读审计报告_2026_05_31.md`
- `Lexicon_Runtime_V2_P3_3_FW_Apply_Degrade_只读审计报告_2026_05_31.md`
- `P3_3_FW_Metadata_Span_Gate_补充冻结方案_V1_1.md`（文档粒度参照）

用途：V1 冻结方案仅 30 行，不足以作为开发 SSOT。本文档列出 **必须写入 V1.1 冻结正文** 的补充项，开发/验收/回滚均以本清单为准。

---

## 一、执行摘要

| 类别 | V1 现状 | 补充后要求 |
|------|---------|-----------|
| 架构链 | 仅有 bullet | 写死 Metadata Gate → Recall → 句组合 → 句级 rerank → Apply |
| 参数 | maxSpans / maxSentenceCandidates | 增加动态 per-span limit、minDelta、tie-break |
| KenLM | 「句级 rerank」 | 明确 **移除 per-span weak_veto**，单 batch ≤17 |
| 词库 | domain 优先 | P1 必须灌 `domain_lexicon`（当前 0 行） |
| 质量 | 无 | 绑定 P3.4-A RepairTarget；量化验收基线 |
| 运维 | 无 | 回滚开关 + 批测配置冻结 |

---

## 二、必须补充项（P0 — 不写则不能开干）

### 2.1 冻结架构链

V1 已有「Metadata Gate 保留」，需补充 **完整主链** 与 **禁止项**：

```text
ASR rawText + Metadata
→ FW Metadata Span Gate（不变）
→ recallSpanCandidateSets（V2，合计 limit）
→ buildSentenceCandidates（笛卡尔积，cap=16）
→ rerankFwSentenceCandidates（KenLM batch，raw 必入）
→ mapBestSentenceToApprovedReplacements
→ applyFwSpanReplacements（不变）
```

**接入点（冻结）**：

- 文件：`fw-detector-orchestrator.ts`
- 替换：`runFwTopKDecisionPipeline` → `runFwSentenceRerankPipeline`（新模块，建议 `fw-detector/` 下）

**禁止（与 V1 对齐并细化）**：

- [ ] 不修改 CTC
- [ ] 不恢复 Recover 主链
- [ ] 不直接 import `legacy/recover/`（仅只读参考）
- [ ] Lexicon **不反推 Span**
- [ ] Lexicon **只出候选**，不决定 apply
- [ ] 不重新启用 KenLM Span Gate（`kenlm_gate_filter` 找 span）
- [ ] Metadata Gate 仍是 span 唯一 SSOT（继承 P3.3）

---

### 2.2 动态 per-span candidate limit（合计上限）

V1 写了「base+domain 合计 limit」，**缺具体函数**。必须冻结：

| span 数 | 每 span 最大候选数 | 最大组合数 |
|--------|-------------------|-----------|
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

**显式禁止（对照现 P3.3 实现）**：

- [ ] 禁止 base LIMIT 2 **+** domain LIMIT 3 **叠加**（现 `recall-span-topk-v2.ts` 行为，max 5）
- [ ] `mergeSpanCandidates` 后 `slice(0, perSpanLimit)` 为 **domain + alias + base 合计**

---

### 2.3 Recall 合并优先级

V1 checklist 仅有「domain > alias > base」，需冻结 merge 语义：

```ts
dedupeByWord([
  ...domainCandidates,
  ...aliasCandidates,
  ...baseCandidates,
]).slice(0, limit);
```

| 场景 | 行为 |
|------|------|
| 有 `activeDomain` | domain 优先填充；base 作 fallback |
| 无 `activeDomain` | 仅 base 保守召回 |

**第一版 Industry Routing（冻结）**：

- [ ] 仅用 `profile.primaryDomain` + `resolveDomainIdsForRecall`
- [ ] 完整 Industry Routing **不在 P4 首版范围**

---

### 2.4 句级 KenLM rerank + raw 保护

V1 checklist 有「delta threshold」但未写规则。必须冻结：

**batch 构成**：

```text
sentences = [rawText, ...candidateTexts]   // 长度 ≤ 17
```

**打分与决策**：

```text
baselineNorm = scoreBatch[0].normalizedScore   // raw
delta_i = scoreBatch[i+1].normalizedScore - baselineNorm
picked = argmax(delta_i)
若 maxDelta < minDeltaToReplace → 不 apply（raw 胜）
若 picked 对应 raw → approved.length === 0
```

**参数（建议默认值，写入 fw-config）**：

| 参数 | 建议默认 | 说明 |
|------|---------|------|
| `maxSentenceCandidates` | 16 | 不含 raw |
| `minDeltaToReplace` | 0.03（可调 0.02–0.05） | 防短句 delta≈0 误替换 |
| tie-break | **raw 优先** | delta 相等时不 apply |

**pickedIsRaw → 不调用 apply**（或 `approved=[]`）。

---

### 2.5 移除 per-span KenLM weak_veto

V1「不恢复 KenLM Span Gate」≠ 移除现 P3.3 topk 里的 weak_veto。必须单独写清：

- [ ] P4 句级 rerank 路径 **不再调用** `scoreSpanCandidateSentences` / `kenlm-span-gate weak_veto`
- [ ] 避免「per-span batch + 句级 batch」双 KenLM
- [ ] span 内预排序：`domainPriority → priorScore → toneDistance`（**句级 winner 仅 KenLM**）

---

### 2.6 P3.4-A RepairTarget 依赖（质量前置）

P3.3 degrade 审计：**14/14 degrade 与 repair_target=1 过宽有关**；P4 rerank **不能单独解决**「候选池无正确答案」。

必须冻结：

- [ ] **`candidateRequireRepairTarget=true` 仍生效**（Pick / approved 映射层）
- [ ] P4 与 **P3.4-A（RepairTarget / 词库质量）并行或先行**；验收失败先查词库再调 rerank
- [ ] 禁止用「黑名单」硬挡 一下→以下 等模式（靠 tone + domain + 句级 KenLM）

---

### 2.7 P1 数据前置：domain_lexicon + tone_pinyin_key

审计：**domain_lexicon 当前 0 行**；**tone_pinyin_key 全链路缺失**。

P1 必须完成（否则 P2/P3 无法验收）：

- [ ] `base_lexicon` / `domain_lexicon` 增 `tone_pinyin_key TEXT` + 索引
- [ ] build 生成 tone key + **tone coverage stats**
- [ ] seed JSONL 校验 `tonePinyinKey` 字段
- [ ] **domain_lexicon 灌入**（restaurant 等样例域）
- [ ] schema 版本 bump + manifest（防 bundle 迁移破坏）

**Tone 规则（冻结）**：

- [ ] `pinyin_key`：无声调，**用于 recall 查询**
- [ ] `tone_pinyin_key`：带声调，**仅用于排序 / 降权 / 截断**
- [ ] **禁止** tone 硬过滤（ASR 错字可能声调也错）
- [ ] `toneDistance(asrToneKey, candidateToneKey)` 参与 span 内排序

---

### 2.8 回滚开关

必须新增 feature flag（审计建议）：

```json
{
  "features": {
    "fwDetector": {
      "useSentenceLevelRerank": true
    }
  }
}
```

- [ ] `true`：走 `runFwSentenceRerankPipeline`
- [ ] `false`：回退 P3.3 `runFwTopKDecisionPipeline`（per-span pick + weak_veto）
- [ ] 冻结 **默认值**（建议开发期 `true`，灰度可切 `false`）

---

### 2.9 验收指标（P5 Validation）

V1 仅有「dialog_200 回归」。必须量化（基线 = P3.3 全量 200 条）：

| 指标 | P3.3 基线 | P4 目标 |
|------|----------|---------|
| dialog_200 PASS | 200/200 | **200/200** |
| 限时 | 15 min | **15 min**（同脚本） |
| avg CER final | **36.35%** | **≤ Phase2 35.93%** 或至少 **degrade 条数下降** |
| CER raw | 36.02% | 不劣化 |
| FW apply 次数 | 24 | improve↑、degrade↓（报告分列） |
| pipeline P95 | **4096 ms** | **不劣化 >10%**（≈ ≤4500 ms） |
| KenLM 句 batch | — | **≤17 句/次** |
| metadata gate P95 | ~1 ms | 不回归 |

**报告要求**：

- [ ] apply / improve / degrade / unchanged 分列
- [ ] `sentenceRerank` diagnostics 抽样可导出
- [ ] 对比 Phase2（apply=10, CER=35.93%）与 P3.3

---

### 2.10 批测配置冻结（继承 P3.3，保证可比）

P4 回归必须与 P3.3 同配置，仅打开句级 rerank：

| 配置项 | 冻结值 |
|--------|--------|
| `spanGateMode` | `fw_metadata_gate` |
| `kenlmSpanGate.enabled` | `false` |
| `useLexiconRuntimeV2Recall` | `true` |
| V2 bundle | `node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite` |
| 音频 | `test wav/dialog_200` |
| 脚本 | `run-lexicon-v2-phase3-p33-batch.js --max-minutes 15`（或 P4 专用 fork，参数一致） |

---

## 三、建议补充项（P1 — 提升可实施性）

### 3.1 Diagnostics 契约

在 `FwDetectorResult` 增加（或冻结字段名）：

```ts
sentenceRerank?: {
  spanCount: number;
  perSpanLimit: number;
  combinationCount: number;
  kenlmQueryCount: number;      // 期望 1
  pickedIsRaw: boolean;
  maxDelta: number;
  minDeltaToReplace: number;
  topCandidates: Array<{
    text: string;
    kenlmDelta: number;
    replacementCount: number;
  }>;
};
```

- [ ] `recall-v2-diagnostics` 可增 `tone_distance_avg` 等

---

### 3.2 组合生成与截断

- [ ] 笛卡尔积前按 `candidateScore`（prior + tone 等）预排序
- [ ] 超 `maxSentenceCandidates=16` 时截断（非随机）
- [ ] 复用 `buildCandidateSentencesForSpan` 思想；**多 span 新 combinator**，勿依赖 Recover import

---

### 3.3 配置项清单（fw-config 扩展）

相对 P3.3 新增/修改：

| 键 | P3.3 | P4 冻结 |
|----|------|---------|
| `maxSpans` | 2 | **4** |
| `maxSentenceCandidates` | 无 | **16** |
| `minDeltaToReplace` | 无 | **0.03**（可调） |
| `useSentenceLevelRerank` | 无 | **true** |
| per-span topK 固定 3 | 有 | **改为动态 limit 函数** |

---

### 3.4 Freeze Contract 单测

参照 P3.3，P4 需新增/扩展：

- [ ] `useSentenceLevelRerank=false` 仍走旧 pipeline
- [ ] raw 必入 batch；`pickedIsRaw` 时不 apply
- [ ] combination cap ≤16；KenLM mock batch 长度 ≤17
- [ ] `candidateRequireRepairTarget` 仍过滤 approved
- [ ] 不 import `legacy/recover`

---

### 3.5 开发顺序 Target List（细化 V1）

| 阶段 | 交付物 | 退出条件 |
|------|--------|---------|
| **P1 Schema** | tone 字段、build stats、domain 灌库 | coverage + domain 行数 >0 |
| **P2 Recall** | merge 合计 limit、toneDistance、source 标记 | 单测 + 样例 span 候选可复现 |
| **P3 Sentence Rerank** | combinator + rerank + minDelta | 单测 golden cases |
| **P4 Integration** | orchestrator 切换 + diagnostics + flag | jest + freeze-contract |
| **P5 Validation** | dialog_200 15min 报告 | 验收表 §2.9 达标或 documented gap |

---

### 3.6 风险与验收失败排查顺序

| 优先级 | 动作 |
|--------|------|
| 1 | 查 degrade 样本候选池是否含正确词（P3.4-A / domain 灌库） |
| 2 | 查 `repair_target` 分布是否仍 100%=1 |
| 3 | 查 `minDeltaToReplace` 是否过松导致 raw 被替换 |
| 4 | 查 combination 截断是否丢掉正确组合 |
| 5 | 最后才调 toneDistance 权重 |

---

## 四、完整 Check List（合并 V1 + 本补充）

### 架构

- [ ] Metadata Gate 保留
- [ ] Lexicon 不反推 Span
- [ ] Lexicon 只出候选
- [ ] 句级 KenLM rerank（单 batch）
- [ ] 移除 per-span weak_veto
- [ ] applyFwSpanReplacements 保留
- [ ] 不修改 CTC
- [ ] 不恢复 Recover 主链
- [ ] 不启用 KenLM Span Gate 找 span

### 复杂度

- [ ] maxSpans = 4
- [ ] maxSentenceCandidates = 16
- [ ] raw sentence 必须加入 rerank
- [ ] per-span 动态 limit（8/4/2）
- [ ] base + domain **合计**上限（非叠加）
- [ ] KenLM batch ≤ 17

### 声调

- [ ] pinyin_key 无声调 recall
- [ ] tone_pinyin_key 带声调排序
- [ ] 不做声调硬过滤
- [ ] tone_distance 参与排序
- [ ] tone coverage stats（build）

### Recall 优先级

- [ ] domain > alias > base
- [ ] 有 activeDomain → domain 优先 + base fallback
- [ ] 无 activeDomain → base only
- [ ] domain_lexicon 有数据

### 质量

- [ ] candidateRequireRepairTarget 仍生效
- [ ] P3.4-A RepairTarget 并行/先行
- [ ] minDeltaToReplace + raw tie-break
- [ ] improve↑ degrade↓（相对 P3.3）
- [ ] avg CER final 目标 ≤35.93% 或 documented plan

### 性能与运维

- [ ] pipeline P95 不劣化 >10%
- [ ] combination 不爆炸（硬 cap）
- [ ] useSentenceLevelRerank 回滚开关
- [ ] dialog_200 15min 回归报告

---

## 五、V1 → V1.1 合并建议

将 **第二节 P0 全部** + **第四节 Check List** 合并进 `P4_Sentence_Level_Rerank_TonePinyin_开发冻结方案_V1.md`，重命名为 **V1.1**，结构参照 P3.3 补充冻结方案：

1. 执行摘要  
2. 冻结架构  
3. 参数与函数  
4. Recall / Tone  
5. Sentence Rerank  
6. RepairTarget 与 P3.4-A  
7. Diagnostics  
8. 批测配置  
9. 验收指标  
10. 回滚  
11. Check List  
12. Target List  

---

## 六、文档状态

| 项 | 状态 |
|----|------|
| 本文档 | **补充清单 V1.1 — 已合并入主冻结方案 V1.1** |
| `开发冻结方案_V1_1.md` | **开发 SSOT** |
| 开发实施 | P4 代码已落地；P5 dialog_200 回归待跑 |

---

**清单完成。未修改任何源代码。**
