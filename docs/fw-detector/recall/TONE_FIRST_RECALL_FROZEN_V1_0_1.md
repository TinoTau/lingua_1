# Tone-First Recall — 冻结合约 V1.0.1

**状态**：Mechanism FROZEN（2026-06-17）  
**原则**：`Tone is recall priority, not absolute hard gate.`  
**代码根**：`electron_node/electron-node/main/src/lexicon-v2/` · `span-assembly-v4/recall-topk-for-windows.ts`

---

## 1. 机制概述

在 Lexicon V2 SQL recall 阶段，对 base / domain / idiom 三 tier **先执行 composite tone 查询**（`tone_pinyin_key` 多列匹配），合并去重后若不足 limit 再 **统一 plain fallback**。

Tone 影响 **候选排序与 penalty**，**不** hard drop。Assembly 仅按 `score` 排序；stage 优先级须反映到 `candidateScore` 或 penalty 逻辑。

---

## 2. 调用链

```text
recallTopKForWindows
  → recallSpanTopKV3
      → recallSpanTopKV2 (tone-first tier collector + plain fallback)
      → lookupParentFragments (plain ngram, parentFragmentTopK=3)
      → mergeExactAndFragmentHits (exactTopK=2)
      → sortRecallHitsByToneCompatibility
  → recallHitToneFields / minPrior filter
  → WindowCandidate pool
```

---

## 3. Tier 查询策略（Strategy B）

| 规则 | 约束 |
|------|------|
| Tier 顺序 | base → 多 domain 循环 → idiom |
| Tone 查询 | 三 tier **全部** composite tone 查询后 merge |
| Plain fallback | **merge 后** 若 `entries.length < limit` 再统一补全 |
| 禁止 | per-tier 早停导致 domain plain 永不执行 |
| Limit | V2 入参 `perSpanLimit ?? topK`；V4 window 路径 **effectiveLimit = exactTopK = 2** |

V3 调用 V2 时写死 `perSpanLimit: exactTopK`（=2），**不是** Assembly 层 `getPerSpanCandidateLimit`（2/4/8）。

---

## 4. V3 槽位与混排

| 参数 | 值 | 说明 |
|------|-----|------|
| `exactTopK` | 2 | tone-first exact 进 V3 最多 2 条 |
| `parentFragmentTopK` | 3 | plain fragment 额外槽位 |
| 混排 | exact + fragment | 须看 `hitKind` 区分归因（如 d048） |

Assembly `getPerSpanCandidateLimit(spanCount)`：1→8，2→4，≥3→2。**与 recall exact limit(2) 不同层**。

---

## 5. ToneLookupStage SSOT

唯一类型来源：

```ts
import type { ToneLookupStage } from 'tone-first-tier-collector'
```

| Stage | 含义 |
|-------|------|
| `tone_exact` | composite SQL 命中 tone pattern |
| `plain_fallback` | merge 后 plain bucket 补全 |
| `plain_only_no_pattern` | 无 acoustic pattern，全 plain |

**禁止**在 V3 / Diagnostics 中定义第四套 union。

---

## 6. Dedupe 与 Hit 字段

| 规则 | 约束 |
|------|------|
| Dedupe 键 | **hotword.id**（非 word 字符串） |
| 保留优先级 | 同一 id 保留 `tone_exact` stage |
| V2 hit 预填 | `toneCompatible` / `tonePenalty` / `toneReason` |
| 二次计算 | 若 V2 未写 tone 字段，`recallHitToneFields` 会再调 `computeToneScoreResult` |

---

## 7. 过滤链（SQL 之后，不变）

| 阶段 | 行为 |
|------|------|
| `minCandidateScore` | `scoreHotword` 门槛，tone-first 不改变 |
| `minPrior` | window 层 `minPriorPassed` 才进池；拒绝时 trace `filterStage: min_prior_rejected` |
| `boundaryPenalty` | `score = candidateScore * 0.85`（boundary window） |
| Tone penalty | `tonePenalty` 乘 `candidateScore`，**不** hard drop |

---

## 8. 声学与配置

| 项 | 说明 |
|----|------|
| 声学 payload | Faster-Whisper `tone_module` → `UtteranceAcousticTonePayload` |
| 对齐 | `tone-time-align.ts`（`toneTimestampOnlyEnabled`） |
| 多段 ASR | `offsetAcousticSlices` + `segmentTimeOffsetsSec`；overlap 失败 → 该 window `plain_only_no_pattern` |
| 独立开关 | **无** `toneFirstRecallEnabled`；回滚仅 `toneTimestampOnlyEnabled` 或关 FW |
| Domain 测试 | 须显式传 `domainIds`；默认 `enabledDomains` 不含 scenario domain |
| `maxDomainCandidates` | 3（SSOT） |
| `maxIdiomCandidates` | 0（默认不触发 idiom tier） |

---

## 9. SQL / Cache 约束

- Composite SQL：`tone_pinyin_key` 多列匹配，**禁止**单列 `WHERE tone_pinyin_key = ?` 字符串（`freeze-contract.test.ts` 静态 grep）
- Prepared stmt：在 `hasToneColumn` 分支内 prepare，与 `stmtBase` 同生命周期
- LRU cache：tone / plain 路径须区分 segment，如 `${tier}:tone:...` vs `${tier}:plain:...`

---

## 10. SSOT 文件

| 文件 | 职责 |
|------|------|
| `lexicon/phonetic/tone-pinyin.ts` | tone key 规范化 |
| `lexicon/tone-recall-sort.ts` | stage 优先级排序 |
| `lexicon-v2/tone-first-tier-collector.ts` | composite tier 收集 |
| `lexicon-v2/lexicon-runtime-v2.ts` | composite SQL / cache |
| `lexicon-v2/recall-span-topk-v2.ts` | V2 recall + result 计数 |
| `lexicon-v2/recall-span-topkv3.ts` | exact/fragment merge + mapV2Hit |

---

## 11. V2 Result 字段（Diagnostics 用）

```ts
interface RecallSpanTopKV2Result {
  // ...existing...
  queryTonePinyinKey?: string;
  toneExactHitCount?: number;
  plainFallbackHitCount?: number;
}
```

V3 **必须**完整继承；utterance 级为 window 结果 **sum**，禁止从 trace 反推。

---

## 12. 冻结边界

**允许改动（Diagnostics 轮已完成）**：

- `recall-span-topk-v2.ts` / `recall-span-topkv3.ts` 的 result 回传字段
- `recall-topk-for-windows.ts` trace plumbing

**禁止改动（机制层）**：

- `tone-first-tier-collector` 查询策略
- composite SQL / cache 语义
- 为通过特定 case 的 `tone_exact` 期望而改 Recall 或声学对齐

---

## 13. 已知限制

| 现象 | 说明 |
|------|------|
| Exact 仅 2 槽 | tone-first 改善排序，无法增加 V4 exact 槽位 |
| Fragment plain | 仍可能引入同音词；用 `hitKind` 区分 |
| d001 中杯 | trace 可能为 `plain_fallback` + mismatch，KenLM 仍可命中；属声学/验收口径，非机制 bug |
| d048 烧饼 | `plain_fallback` + incompatible 为预期 PASS 案例 |

---

## 14. 测试锚点

- 单测：`recall-span-topk-v2.test.ts` · `recall-span-topkv3.test.ts` · `freeze-contract.test.ts`
- 批测分析：`tests/experiments/analyze-tone-first-recall-dialog200.mjs`
- EXPLAIN 对照：`tone-first-recall-explain-composite.py`（合入前后）
