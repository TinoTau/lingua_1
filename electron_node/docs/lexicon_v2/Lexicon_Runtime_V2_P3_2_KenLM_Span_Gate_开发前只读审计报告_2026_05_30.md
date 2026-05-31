# Lexicon Runtime V2 — P3.2 KenLM Span Gate 开发前只读审计报告

版本：V1.0  
日期：2026-05-30  
类型：只读代码审计（无代码修改）

---

## 1. 执行摘要

**核心审计结论（一句话）：**

> 当前 KenLM **能**对整句/候选句打分并返回 delta，**不能**直接返回局部窗口分数；但可通过 **滑动窗口 pseudo-candidate + `scoreBatch`** 低成本近似实现 Span Gate。最小接入点在 **`fw-detector-orchestrator.ts`**，在 `detectSuspiciousSpansV1` 与 `runFwTopKDecisionPipeline` 之间插入 KenLM Span Gate，**不修改** `kenlm-span-gate.ts` weak_veto 逻辑。

### 背景确认

| 事实 | 审计确认 |
|------|----------|
| Phase 2/3 span/job ≈ 11.5 | ✅ 相同（`spanDetectBudget=12`） |
| 问题不在 SQLite / 候选数量 | ✅ Hotfix 已证 |
| V2 放大 Recall 命中 → mass apply | ✅ 46.8% vs 2.1% 有候选 |
| 根因是 span 入口不可靠 | ✅ `detector_pinyin_hint` 单独触发 82% span |

### P3.2 目标流程（设计意图）

```text
ASR raw text
  ↓
KenLM Span Gate          ← 新增：找 1~2 个局部低概率 span
  ↓
Lexicon Runtime V2 Recall ← 不变：仅对 gate span 查候选（LIMIT 2/3/0）
  ↓
KenLM weak_veto          ← 不变：scoreSpanCandidateSentences
  ↓
Apply                    ← 不变：applyFwSpanReplacements
```

### 推荐 MVP 路径

1. **Phase 3.2a**：`kenlm_gate_shadow`（只写 diagnostics，不改 recall 输入）
2. **Phase 3.2b**：`kenlm_gate_filter`（12→2 span，保留 legacy detector 作粗筛）
3. **Phase 3.2c**：`kenlm_gate_only`（完全替代 detector span 来源）

**推荐局部评分方案：方案 D**（pseudo-candidate / mask-replace delta，复用 `applySingleSpanReplacement` + `scoreBatch`）。

---

## 2. 当前 KenLM 能力

### 2.1 模块结构

| 模块 | 路径 | 职责 |
|------|------|------|
| 底层打分 | `phonetic-correction/lm-scorer.ts` | 字符级 KenLM query 子进程 |
| Batch 封装 | `asr-repair/sentence-rerank/kenlm-scorer.ts` | `createKenlmBatchScorer()` |
| FW Veto | `asr-repair/kenlm-span-gate.ts` | `scoreSpanCandidateSentences` / `evaluateKenlmDecision` |
| 类型 | `asr-repair/kenlm-batch-types.ts` | `KenLMScorer`, `KenLMScore`, `KenlmTimingStats` |
| 字符 tokenize | `phonetic-correction/char-tokenize.ts` | CJK 逐字 token，与训练一致 |

### 2.2 十项能力问答

| # | 问题 | 结论 |
|---|------|------|
| 1 | 整句打分 | ✅ `CharLmScorer.score(text)` → `{ score, oovCount }` |
| 2 | 候选替换句打分 | ✅ `scoreSpanCandidateSentences(scorer, rawText, candidateSentences, opts)` |
| 3 | 返回每个候选 delta | ✅ `delta = candidateNorm - baselineNorm` |
| 4 | 返回局部窗口分数 | ❌ **不支持**；API 仅句子级 Total |
| 5 | token/n-gram 级分数 | ❌ **未暴露**；query 只解析 `Total:` 行 |
| 6 | 滑动窗口近似 | ✅ 可行：枚举 window → 构造变体句 → `scoreBatch` |
| 7 | 调用成本 | ⚠️ **每句一次 KenLM query 子进程 spawn**（`lm-scorer.ts:runKenlmQuery`），非 GPU batch |
| 8 | batch 接口 | ✅ `KenLMScorer.scoreBatch(sentences[])`，但内部 **顺序** 循环 `score()` |
| 9 | 模型实例复用 | ✅ `getLmScorer()` 懒加载单例；query 子进程每次新建 |
| 10 | 结果结构 | 见下 |

### 2.3 KenLM 结果结构

```typescript
// kenlm-batch-types.ts
type KenLMScore = {
  sentence: string;
  score: number;           // KenLM log-prob Total（原始）
  normalizedScore: number; // sigmoid(score/10)，用于 delta 比较
};

type KenlmBatchScoreResult = {
  scores: KenLMScore[];
  timing: KenlmTimingStats; // batchMs, queryCount, avgMs, p50/p95/maxMs
};

// kenlm-span-gate.ts — Veto 输出
type KenlmCandidateScore = {
  candidateIndex: number;
  delta: number;
  baselineNorm: number;
  candidateNorm: number;
  approved: boolean;
  vetoed: boolean;
  reason: FwKenlmGateReason;
};
```

### 2.4 与 ASR KenLM 的关系

- Sentence KenLM（FW 使用）与 CTC `asrKenlmMeta` **无关**（`lm-scorer.ts` 注释、`sentence-kenlm-startup.ts`）
- 模型：`zh_char_3gram.trie.bin`，字符级 3-gram

### 2.5 先例：`rescoreWithLm`

`phonetic-correction/rescore.ts` 已实现 **位置级 LM  rescoring**（混淆集候选 + delta 阈值），但 **未接入 FW 主链**，可作为 Span Gate 算法参考，不可直接复用（依赖 confusion-set，非 span 枚举）。

---

## 3. 当前 Detector 与 KenLM 边界

### 3.1 调用时序（现状）

```text
fw-detector-step.ts
  → runFwDetectorOrchestrator()
      1. detectSuspiciousSpansV1()     // 无 KenLM
      2. createKenlmBatchScorer()      // 仅用于后续 veto
      3. runFwTopKDecisionPipeline()
           for each span:
             recallSpanTopK()          // Lexicon
             scoreSpanCandidateSentences()  // KenLM weak_veto（Recall 后）
      4. applyFwSpanReplacements()
```

**KenLM 仅在 Recall 之后调用**（`fw-topk-decision-pipeline.ts:95`），Detector 阶段 **零 KenLM**。

### 3.2 边界问答

| # | 问题 | 结论 |
|---|------|------|
| 1 | KenLM 在 Recall 前还是后 | **仅 Recall 后**（veto） |
| 2 | `detectSuspiciousSpansV1` 可替换/旁路 | ✅ orchestrator 层可旁路，detector 文件本身可不改 |
| 3 | `runFwTopKDecisionPipeline` 是否要求 span 已生成 | ✅ 输入 `spans: FwSpanDiagnostics[]`，需 `text/start/end` |
| 4 | 最小接入点 | **`fw-detector-orchestrator.ts`**，detect 与 pipeline 之间 |
| 5 | 最不破坏冻结主链的方式 | 新增 `asr-repair/kenlm-span-selector.ts` + orchestrator 分支；**不改** `kenlm-span-gate.ts` weak_veto |

### 3.3 冻结约束（`fw-detector-gate.mjs` / `freeze-contract.test.ts`）

| 允许 | 禁止 |
|------|------|
| orchestrator 新增 KenLM span 选择分支 | detector 层 import lexicon recall |
| 新增 `kenlm-span-selector.ts` | 修改 `scoreSpanCandidateSentences` veto 语义 |
| 新增 config flag | FW 主链 import `legacy/recover` |
| shadow mode 只写 diagnostics | 恢复 Recover 步骤 |
| | `suspicious-span-detector-v1.ts` 读 repairTarget/recall |

**注意**：`spanDetectBudget: 12` 是冻结合约默认值（`fw-detector-gate.mjs:109`）。P3.2 应通过 **`kenlmSpanGate.maxSpans=2`** 新配置截断，而非直接改 frozen default（或需同步更新 gate 合约）。

---

## 4. KenLM Span Gate 可行性

### 4.1 输入/输出数据结构

**建议输入：**

```typescript
{
  text: string;
  sourceLang: 'zh';
  maxSpans: number;        // 默认 2
  minSpanChars: number;      // 默认 2
  maxSpanChars: number;      // 默认 4
  minLocalDelta?: number;    // 窗口相对 baseline 的最大负向 delta 阈值
}
```

**建议输出：**

```typescript
{
  spans: Array<{
    text: string;
    start: number;           // 字符 offset（half-open [start, end)）
    end: number;
    score: number;           // baselineNorm - variantNorm 或 |delta|
    reason: 'kenlm_local_low_prob';
  }>;
  diagnostics: {
    enumeratedCount: number;
    scoredCount: number;
    selectedCount: number;
    baselineScore: number;
    baselineNorm: number;
    kenlm_span_gate_ms: number;
  };
}
```

### 4.2 坐标系与类型兼容

| 项 | 建议 |
|----|------|
| start/end | **字符 offset**（与 `FwTextSpan`、`applySingleSpanReplacement` 一致） |
| 复用 SuspiciousSpan | 映射为 `FwSpanDiagnostics`：`signals: ['kenlm_local_low_prob']`（需扩展 `FwDetectorSignal`） |
| 新增 source | diagnostics 用 `spanSelection` 或 `recallV2Diagnostics` 风格字段；span 本身用 `signals` |
| 与原 detector 兼容 | filter mode：保留原 span 的 `domain`/`detectorHint`；only mode：新建最小 `FwSpanDiagnostics` |

### 4.3 局部窗口评分方案对比

| 方案 | 描述 | 实现难度 | KenLM 次数 | 中文适配 | MVP 适合度 |
|------|------|----------|------------|----------|------------|
| **A** | 枚举 window，mask/drop/replace 后比 delta | 低 | ~N+1/句 | 好 | 高 |
| **B** | 直接算窗口局部 LM 分数 | **不可行**（无 API） | — | — | 低 |
| **C** | 滑窗 n-gram token 贡献 | **需扩展 lm-scorer** | 1（若改 query 输出） | 好 | 中（工作量大） |
| **D** | pseudo-candidate：删/替 span 后 scoreBatch | **最低** | ~N+1/句 | 好 | **最高** |

**推荐 MVP：方案 D**

实现 sketch（只读设计）：

```text
1. baseline = scoreBatch([rawText])[0]
2. windows = enumerateCjkSpans(rawText, 2, 4)   // 复用 detector 逻辑或抽 shared util
3. variants = windows.map(w => deleteSpan(rawText, w) 或 replaceWithPlaceholder)
4. scores = scoreBatch([rawText, ...variants])
5. 对每个 window: localDelta = scores[i].norm - baseline.norm（越负越可疑）
6. 过滤 stopword / 重叠；取 top maxSpans(2)
7. 若无 window 低于 minLocalDelta → 返回 [] → orchestrator skip FW
```

**性能优化（MVP 可选）：**

- 预筛：仅对 ASR `no_speech_prob` 高区段内 window 做 KenLM（减 N）
- 粗筛 top-8 window 再 KenLM（两阶段）
- 缓存 `baselineNorm` 供 veto 复用（避免每 span 重算 rawText）

---

## 5. Span 选择规则建议

| 规则 | 建议值 | 说明 |
|------|--------|------|
| `maxSpans` | **2** | 与文档设计一致；必须 **真正生效** |
| `minSpanChars` / `maxSpanChars` | **2 / 3**（MVP）或 2/4 | 2 字 homophone 误触多，可先收紧到 3 |
| 重叠 span | **不允许** apply；gate 选 top-N 时去重叠 | 复用 `spansOverlap` |
| 去重 | 同 text+start+end 去重 | |
| stopword blacklist | **建议启用** | 「一下、可以、我们、这个、什么、怎么」等 |
| priorScore / lexicon hit 辅助 | **Recall 后自然过滤**；gate 阶段 **禁止** lexicon 反推 span |
| 双条件 recall | KenLM 低概率 span **且** recall 有候选 **才** 进 KenLM veto | pipeline 已隐含（`recallHits.length===0` 跳过 veto） |
| 无低概率 span | **skip 整个 FW**（`reason: no_spans`） | orchestrator 早返回 |

---

## 6. 两次 KenLM 的关系

```text
第一次 KenLM Span Gate     → 找 suspicious span（新增）
第二次 KenLM weak_veto    → 对 lexicon 候选 veto（现有，不改）
```

| 问题 | 结论 |
|------|------|
| 是否重复消耗过大 | ⚠️ Gate 阶段 N+1 次 query 可能 **高于** 当前 veto ~13 次/job；但 span 减少后 veto 阶段 **大幅下降** |
| 缓存原句 score | ✅ **强烈建议**；gate baseline 传给 veto batch |
| 缓存局部 window score | ✅ gate diagnostics 保留；filter mode 可对照 |
| 第二次复用第一次结果 | 部分：baselineNorm 可复用；候选句仍需新 score |
| 新增 diagnostics | ✅ `kenlm_span_gate_ms` + 保留 `kenlmTiming.batchMs`（veto） |

**Phase 3 Hotfix 参考**：kenlm ~9.8s/job，query ~13/job。  
**Gate MVP 估算**（40 window + 2 span × 3 veto）：~46 query/job → 需 **预筛** 控制在 ≤15 gate query + ≤6 veto query 才优于现状。

---

## 7. 与 Lexicon Runtime V2 的关系

| 原则 | 确认 |
|------|------|
| V2 不负责找 span | ✅ 仅 `lookupBase/Domain/IdiomByPinyinKey` |
| V2 只对 gate span 查候选 | ✅ `recallSpanTopK` 输入为 orchestrator 传入的 span 列表 |
| 保留 SQL LIMIT 2/3/0 | ✅ 继续有效 |
| Gate 通过后再查 lexicon | ✅ 符合目标流程 |
| 禁止 lexicon hit 反推 span | ✅ detector 已禁止；gate 也不应查 lexicon |

**Recall 链不变**：`local-span-recall.ts` → `recallSpanTopKViaRuntimeV2` → `recallSpanTopKV2`（LIMIT 已在 SQL）。

---

## 8. 与原 Detector 的三种模式

| 模式 | 描述 | MVP | 风险 | 易验证 | 符合冻结 |
|------|------|-----|------|--------|----------|
| **A only** | 完全替代 detector | 3.2c | 中 | 中 | ✅（orchestrator 分支） |
| **B filter** | detector 12 → KenLM 2 | **3.2b 推荐** | **低** | **高** | ✅ |
| **C shadow** | 只 diagnostics | **3.2a 首选** | **最低** | **最高** | ✅ |

**推荐路径：C → B → A**

- Shadow：对比 gate span vs detector span，零行为风险
- Filter：保留 domain_anchor / no_speech 粗信号，KenLM 精筛
- Only：验证通过后切换

**禁止**：让 `detector_pinyin_hint` 单独决定 recall（filter/only 模式下 legacy span 不应直接进入 pipeline）。

---

## 9. 配置设计

```json
{
  "features": {
    "fwDetector": {
      "spanGateMode": "legacy_detector",
      "kenlmSpanGate": {
        "enabled": false,
        "maxSpans": 2,
        "minSpanChars": 2,
        "maxSpanChars": 4,
        "minLocalDelta": 0.05,
        "stopwordFilterEnabled": true,
        "preFilterMaxWindows": 20
      }
    }
  }
}
```

### 模式语义

| `spanGateMode` | 行为 | 输出 |
|----------------|------|------|
| `legacy_detector` | 现状 | 不变 |
| `kenlm_gate_shadow` | detect + gate 并行，**recall 仍用 detector spans** | +gate diagnostics |
| `kenlm_gate_filter` | detect → gate 过滤到 ≤2 | recall 用过滤后 spans |
| `kenlm_gate_only` | 跳过 detect，**仅 gate spans** | recall 用 gate spans |

### 回滚

- 设 `spanGateMode: "legacy_detector"` 或 `kenlmSpanGate.enabled: false`
- 无需改代码；默认 **必须** legacy

---

## 10. 测试设计建议

### 单元测试（新增 `kenlm-span-selector.test.ts`）

| 测试 | 断言 |
|------|------|
| 2~4 字窗口枚举 | `enumeratedCount` 与 CJK 长度一致 |
| maxSpans=2 | `selectedCount ≤ 2` |
| stopword | 「一下、可以」不进入输出 |
| 低概率 span 选中 | mock scorer 使某 window delta 最低 → 被选中 |
| 无低概率 span | 返回 `[]` → orchestrator `reason: no_spans` |
| shadow mode | gate diagnostics 非空，span 列表与 legacy 相同 |
| filter mode | span/job ≤ 2 |

### 批测回归（dialog_200）

| 指标 | 目标 |
|------|------|
| pipeline PASS | 200/200 |
| span/job | **≤ 2** |
| recall invocations | **降 ≥80%** |
| FW apply | **≤ Phase 2 的 2 倍（≤20）** |
| fw_degraded | **0** |
| final CER | **≤ Phase 2（35.93%）** |
| fw_detector P95 | **低于 Phase 3 Hotfix（20672ms pipeline 或 kenlm 部分）** |
| KenLM 总耗时 | **低于 Phase 3 Hotfix（~9.8s avg）** |
| cafe 中杯类 case | V2 Recall 仍可命中 |
| shadow diagnostics | 完整输出 |

### 性能 diagnostics

```json
{
  "kenlm_span_gate_ms": 0,
  "kenlm_veto_ms": 0,
  "fw_detector_step_ms": 0,
  "kenlm_span_gate_query_count": 0,
  "kenlm_veto_query_count": 0
}
```

---

## 11. 验收指标汇总

| # | 指标 | 阈值 |
|---|------|------|
| 1 | dialog_200 PASS | 200/200 |
| 2 | span/job | ≤ 2 |
| 3 | recall invocations | 降 ≥80%（相对 ~2300） |
| 4 | FW apply | ≤ 20 |
| 5 | fw_degraded | 0 |
| 6 | final CER | ≤ 35.93% |
| 7 | fw_detector P95 | 明显低于 Phase 3 Hotfix |
| 8 | KenLM 总耗时 | 低于 Phase 3 Hotfix |
| 9 | cafe homophone case | 仍可 repair |
| 10 | shadow diagnostics | 完整 |

---

## 12. Target List

| 优先级 | 文件/模块 | 动作 |
|--------|-----------|------|
| P0 | **新增** `asr-repair/kenlm-span-selector.ts` | Span Gate 核心逻辑 |
| P0 | `fw-detector/fw-detector-orchestrator.ts` | 插入 gate 分支 + diagnostics |
| P0 | `fw-detector/types.ts` | 扩展 `FwDetectorSignal`、gate diagnostics 类型 |
| P0 | `node-config-types.ts` / `node-config-defaults.ts` | `spanGateMode` + `kenlmSpanGate` |
| P1 | **新增** `fw-detector/kenlm-span-selector.test.ts` | 单元测试 |
| P1 | `tests/run-lexicon-v2-phase3-only-audit-batch.js` | 采集 gate metrics |
| P1 | `tests/analyze-phase3-only-audit.mjs` | gate/veto 分层统计 |
| P2 | 抽 shared `enumerateCjkSpans` | detector + gate 共用（可选） |
| **不改** | `asr-repair/kenlm-span-gate.ts` | weak_veto 冻结 |
| **不改** | `fw-topk-decision-pipeline.ts` | 决策链冻结（仅接受更少 spans） |
| **不改** | `lexicon-v2/recall-span-topk-v2.ts` | SQL LIMIT 保持 |
| **不改** | `pipeline/steps/*` 顺序 | ASR→FW→Agg→Dedup→Trans |

---

## 13. Check List

- [x] KenLM 整句/候选/delta 能力已确认
- [x] 局部/token 分数不支持已确认
- [x] 滑动窗口近似路径已设计
- [x] KenLM 成本（子进程/query）已定位
- [x] batch 接口与单例复用已确认
- [x] Detector↔KenLM 边界已梳理
- [x] 最小接入点 = orchestrator
- [x] 方案 A/B/C/D 已对比，推荐 D
- [x] 三次模式 C→B→A 已建议
- [x] 配置与回滚已设计
- [x] 测试与验收指标已列出
- [x] V2 不负责 span 已确认
- [x] 冻结约束已对照 fw-gate

---

## 14. 风险与回滚

| 风险 | 缓解 |
|------|------|
| Gate KenLM query 过多导致更慢 | `preFilterMaxWindows`、no_speech 区段预筛、shadow 先测耗时 |
| Gate 漏检真实 ASR 错误 | shadow 对比 legacy；保留 cafe 等 golden case |
| stopword 误杀领域词 | stopword 可配置；domain anchor 句豁免 |
| 改冻结合约 spanDetectBudget | 不动 default；用新 `kenlmSpanGate.maxSpans` |
| baseline 重复计算 | 缓存 baselineNorm 贯穿 gate+veto |
| KenLM 不可用 | fail-open：gate 返回 [] → skip FW（与 veto unavailable 一致） |

**回滚**：`spanGateMode=legacy_detector`，一行配置，零代码回滚。

---

## 15. Phase 3.2 MVP 开发建议

### 15.1 迭代计划

```text
Sprint 3.2a — Shadow（1~2 天）
  新增 kenlm-span-selector.ts + orchestrator shadow 分支
  dialog_200 采集 gate vs detector span 对比
  不改 recall / apply

Sprint 3.2b — Filter（2~3 天）
  spanGateMode=kenlm_gate_filter
  span/job → ≤2；验证 recall ↓80%、apply ↓

Sprint 3.2c — Only + 调参（2 天）
  spanGateMode=kenlm_gate_only
  stopword + minLocalDelta 调参
  验收 CER / fw_degraded

Sprint 3.2d — 性能（1 天）
  baseline 缓存 + preFilter
  kenlm_span_gate_ms / kenlm_veto_ms 分离上报
```

### 15.2 代码边界（必须遵守）

```text
┌─────────────────────────────────────────────────────────┐
│  FW Detector Step（冻结顺序）                            │
├─────────────────────────────────────────────────────────┤
│  [新增] KenLM Span Gate    ← asr-repair/kenlm-span-selector │
│  [现有] detectSuspiciousV1 ← 可旁路/shadow               │
│  [现有] recallSpanTopK     ← V2 LIMIT 2/3/0             │
│  [冻结] scoreSpanCandidateSentences ← weak_veto 不改     │
│  [现有] pick + apply                                     │
└─────────────────────────────────────────────────────────┘
```

### 15.3 与 P3 Hotfix / Detector 审计的衔接

| 前序结论 | P3.2 对策 |
|----------|-----------|
| spanDetectBudget=12 导致 11.5 span/job | gate maxSpans=2 **真正生效** |
| detector_pinyin_hint 单独触发 | only/filter 模式 **禁止 hint-only 进 recall** |
| V2 homophone 放大 apply | span 入口收窄后，LIMIT 2 才有意义 |
| repair_target 过宽 | P3.2 不动；后续 P3.3 词库质量 |
| KenLM veto 几乎不 veto | span 质量提升后 veto 压力下降 |

---

## 16. 相关文档

| 文档 | 路径 |
|------|------|
| Detector Explosion 审计 | `Lexicon_Runtime_V2_Phase3_Detector_Explosion_只读审计报告_2026_05_30.md` |
| P3 Hotfix 验证 | `Lexicon_Runtime_V2_P3_Hotfix_验证报告_2026_05_30.md` |
| FW 主链冻结 | `docs/ASR_FW_MAIN_CHAIN_FROZEN_FINAL.md` |
| fw-gate 脚本 | `scripts/fw-detector-gate.mjs` |

---

**审计约束：** 本次仅只读分析，未修改任何代码。

**核心结论：** KenLM **可以**通过方案 D（pseudo-candidate + `scoreBatch`）实现低成本局部 Span Gate；**最小接入点**为 `fw-detector-orchestrator.ts`；**推荐 MVP 路径**为 shadow → filter → only；**不得**修改 weak_veto、**不得**让 Lexicon 反推 span。
