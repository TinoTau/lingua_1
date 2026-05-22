# Recover V5 Phase C — 代码补充说明与实施约束

**对应方案**：[Recover_V5_Phase_C_TopK_Pinyin_Recall_CandidateScore_2026-05-22.md](./Recover_V5_Phase_C_TopK_Pinyin_Recall_CandidateScore_2026-05-22.md)  
**冻结决策**：[Recover_V5_Frozen_Decisions_2026-05-22.md](./Recover_V5_Frozen_Decisions_2026-05-22.md)（D-01～D-05）  
**日期**：2026-05-22  
**前置**：Phase A（priorScore + 索引）、Phase B（diff 窗 + 双尺度 2–3 / 4–5）

---

## 0. 已确认决策（实施必须遵守）

| 决策 | 对本 Phase 的要求 |
|------|-------------------|
| **D-01** | **彻底替换** `hotword-recall` observed 主路径；V5 仅 `lookupTopKByPinyin` + candidateScore |
| **D-02 Near pinyin** | **允许**；音节差 ≤2、同 termLength、**禁全表**；英文窗 **禁用** near |
| **D-04 禁学习** | TopK 只用 bundle `priorScore`；禁用 `priorScoreFromFrequency`、frequency 排序、phonetic 抬底 |
| **D-05 英文** | 纯拉丁/数字窗：**exact token key only**，禁止 `pinyin-pro` |

---

## 1. 当前召回代码基线

### 1.1 `recallHotwordsForWindow` 顺序（`hotword-recall.ts` L149–229）

```text
1. appendObservedHits (recallHotwordsByObservedLoose) → 满则 return
2. appendFuzzyObservedHits (全表 observed 扫描)
3. recallHotwordsByPinyin(syllables, maxHits=16)
4. recallHotwordsByFuzzyPinyin (全表 hotwords 扫描)
```

**与 V5 冲突**：observed **优先于** pinyin TopK；fuzzy 全表扫描非「合法 TopK」。

### 1.2 Pinyin 精确查找（`lexicon-runtime.ts` L180–186）

```typescript
recallHotwordsByPinyin(syllables, maxCandidates = 16)
  → syllablesKey(syllables) → bucket.slice(0, maxCandidates)
```

- 桶内排序：**frequency DESC**（`pinyin-index.ts` L30–32），非 priorScore / candidateScore
- **无** termLength 过滤

### 1.3 Fuzzy pinyin（`fuzzy-pinyin-recall.ts`）

- 遍历 **全部** `getEnabledHotwords()`
- 音节长度差 ≤ `recallFuzzyPinyinMaxSyllableDelta`（默认 2，`quality-config.ts`）
- 排序：phoneticScore → frequency
- **风险**：高 phonetic 低 prior 词大量进池 — V5 用 candidateScore 抑制

### 1.4 WindowCandidate 排序（`window-recall.ts` L377–382）

```text
phoneticScore DESC → priorScore DESC
```

- `priorScore` = `log1p(frequency)`（非运营分）
- **无** `candidateScore`、`rankInTopK`、`termLength`、`source: lexicon_pinyin_topk`

### 1.5 `WindowCandidate` 类型（`hotword-types.ts`）

```typescript
source: 'hotword' | 'exact' | 'confusion_evidence' | 'fuzzy_observed'
```

`hitToWindowCandidate` 映射：`fuzzy_observed` / `confusion_evidence` / `exact` / 默认 `hotword`。

### 1.6 observed 抬底（违反 V5「低分不进池」）

`hotword-recall.ts` L64–66、L112–114：

```typescript
Math.max(phoneticScore, recallMinPhoneticScore)
```

Phase C **必须删除** TopK final 路径上的抬底；observed 辅助路径若保留须单独 flag 且不计入 `lexicon_pinyin_topk` 指标。

---

## 2. Phase C 目标 API 与代码落点

### 2.1 新建 `lexicon/pinyin-topk-lookup.ts`

```typescript
export function lookupTopKByPinyin(
  runtime: LexiconRuntime,
  input: {
    syllables: string[];       // 窗音节，已 normalize
    termLength: 2 | 3 | 4 | 5;
    domain?: string;
    topK: number;
  }
): LexiconTopKHit[]
```

**实现约束**：

| 规则 | 说明 |
|------|------|
| 词长 | `hotword.word.length === termLength` |
| enabled | 已 enabled |
| prior | `priorScore` 来自 `HotwordEntry`（Phase A），无则跳过 |
| 索引 exact | `syllablesKey` 精确桶（D-05：英文窗用 token 精确键，不用 syllablesKey 自造） |
| 索引 near | **D-02 允许**：音节编辑距离 ≤ `nearPinyinMaxSyllableDelta`（默认 2），仅在同 termLength 的索引邻居/预聚合 near 表内；**禁止** `fuzzy-pinyin-recall` 全表 |
| 英文 | **D-05**：`isLatinToken(window)` → 仅 `lookupExactToken(word)`，**无 near** |
| 排序 | `candidateScore` DESC（D-04：不得用 frequency） |
| 截断 | `slice(0, topK)`，`rankInTopK` 从 1 开始 |
| source | `lexicon_pinyin_topk` + `matchType: exact \| near` |

### 2.2 新建 `lexicon/candidate-score.ts`

```typescript
candidateScore =
  priorScore
  + phoneticSimilarity      // scorePinyinSimilarity [0,1]
  + exactLengthBonus        // 窗长===词长 ? 建议 +0.5
  + domainBoost             // domain 匹配 ? 建议 +0.2
  - editDistancePenalty     // 可选：窗文本与词条编辑距离
```

**约束 C-C1**：不得 import `combined-score.ts` 或调用 KenLM。  
**约束 C-C2**：`recallMinPhoneticScore` 映射为 `minCandidateScore` 门控（低于则不进 TopK）。

### 2.3 topKByTermLength（配置）

从 `getRecoverQualityConfig()` 读取：

```json
{ "2": 5, "3": 5, "4": 3, "5": 2 }
```

**禁止** `DEFAULT_MAX_HITS = 16` 作为 V5 主路径默认值。

---

## 3. 改造 `hotword-recall` / `window-recall`

### 3.1 主路径替换

```text
recallHotwordsForWindow(window, runtime):
  termLength = window.text.length
  if termLength not in allowedWindowLengths → return []
  topK = topKByTermLength[termLength]
  hits = lookupTopKByPinyin(...)
  map to WindowCandidate with source lexicon_pinyin_topk
```

### 3.2 observed/confusion 降级

| 模式 | 配置 | 行为 |
|------|------|------|
| V5 严格 | `observedRecallEnabled: false`（默认） | 不调用 appendObserved* |
| 过渡 | `true` | 仅 diagnostics，**不**进入 `windowCandidates` 主列表或单独 `auxiliary_candidates` |

**约束 C-C3**：批测 KPI `lexicon_pinyin_topk_candidate_count` 只统计主列表。

### 3.3 `hitToWindowCandidate` 扩展

增加字段（或并行类型）：

```typescript
candidateScore: number
rankInTopK: number
termLength: number
candidatePinyin: string[]  // 词条 pinyin
windowPinyin: string[]     // 窗 syllables
```

---

## 4. Out-of-bundle 约束（代码级）

| 禁止 | 当前代码 | Phase C |
|------|----------|---------|
| 动态造词 | ✅ 无 | 保持 |
| 表外 candidate | fuzzy 全表可能拉任意 enabled 词 | **删除** fuzzy 全表主路径 |
| 无 prior 进 TopK | frequency 推导 | **拒绝** |
| selector 合成候选 | `boundReplacementsToWindowCandidates` priorScore=0 | 须从 TopK hit 复制分数 |

验收：`out_of_bundle_candidate_count` = 非 `lexicon_pinyin_topk` 且非 confusion/observed 辅助（若关闭辅助则为 0）。

---

## 5. 与句级阶段边界

| 阶段 | 打分 |
|------|------|
| TopK recall | **仅** candidateScore |
| expansion | `expansionMinPhoneticScore`（现有，默认 0.5） |
| selector | `selectionMinPhoneticScore`（默认 0.85） |
| rerank | `combinedScore` + KenLM（`rerank.ts`） |

**约束 C-C4**：`window-recall` 最终排序用 candidateScore，**不得**用 combinedScore。  
**约束 C-C5**：KenLM 不参与 `lookupTopKByPinyin`。

---

## 6. 中英混合（Phase C 运行时）

| 场景 | 约束 |
|------|------|
| diff 窗为 `GPU`（Phase B 若支持 latin 窗） | syllables 来自 bundle `pinyin`，禁止 `pinyin-pro` |
| 窗无 syllables | 不 lookup，`no_topk_candidate`（Phase D） |
| 词条 `AI` + pinyin `ei ai` | termLength=2 时 lookup |

---

## 7. diagnostics / trace（Phase C 最小）

写入 `ctx.windowRecallDiagnostics` 或新建 `ctx.lexiconTopKDiagnostics`：

```typescript
topkAttemptsByTermLength: Record<string, number>
topkHitsByTermLength: Record<string, number>
topkDroppedBelowMinScore: number
outOfBundleCandidateCount: number  // 目标 0
```

每个 hit 可追加到 `window_candidates` 扩展字段（完整 trace 在 Phase E）。

---

## 8. 文件修改清单

| 文件 | 变更 |
|------|------|
| **新建** `lexicon/pinyin-topk-lookup.ts` | TopK API |
| **新建** `lexicon/candidate-score.ts` | 公式 |
| `lexicon/hotword-types.ts` | source 增 `lexicon_pinyin_topk`；WindowCandidate 扩展 |
| `lexicon/hotword-recall.ts` | 主路径切换；observed flag |
| `lexicon/window-recall.ts` | 排序改 candidateScore；去掉 observed 窗枚举依赖 |
| `lexicon/fuzzy-pinyin-recall.ts` | 标记 legacy 或仅 near-index 辅助 |
| `recover-quality/quality-config.ts` | topKByTermLength、minCandidateScore |
| `node-config-types.ts` | observedRecallEnabled 等 |
| `asr-repair/sentence-expansion/sentence-expansion.ts` | bound 候选 prior 勿置 0 |

---

## 9. 测试约束

| 测试 | 断言 |
|------|------|
| `pinyin-topk-lookup.test.ts` | 5/5/3/2 截断、prior 排序、无 prior 排除 |
| `candidate-score.test.ts` | 公式分项 |
| 更新 `lexicon-runtime.test.ts` | 桶排序 priorScore |
| 更新 `window-recall.test.ts` | source=lexicon_pinyin_topk |
| `recover-nbest-rerank.test.ts` | 端到端有 TopK 候选 |

**禁止**：单测仍断言 `hitsObserved` 为主路径（除非 `observedRecallEnabled`）。

---

## 10. 验收与批测

```text
lexicon_pinyin_topk_candidate_count > 0  （有 diff 窗的 case）
out_of_bundle_candidate_count = 0
rankInTopK、candidateScore 全量存在
topk_hit_rate_by_term_length 可聚合
```

**预期**：dialog_200 有窗率应 **高于** Phase B 后（TopK 不依赖 confusion 子串）。

---

## 11. 禁止项（Phase C）

| ID | 禁止 |
|----|------|
| C-X1 | observed 优先于 TopK（默认配置下） |
| C-X2 | `recallHotwordsByFuzzyPinyin` 全表作主召回 |
| C-X3 | KenLM / combinedScore 参与 TopK |
| C-X4 | runtime `priorScoreFromFrequency` 进入 TopK |
| C-X5 | phonetic 抬底进 TopK final |

---

## 12. 依赖

```text
Phase A → Phase C
Phase B（diff 窗）→ Phase C（否则无窗可调 TopK）
Phase C → Phase D（no_topk_candidate、low_candidate_score）
Phase C → Phase E（per-candidate trace 字段定义）
```
