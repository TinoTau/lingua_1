<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lingua_Repair_Diagnostics_SSOT_Metrics_Audit_2026_07_14.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lingua Repair Diagnostics SSOT Metrics Audit

**Date:** 2026-07-14  
**Audit Type:** Read-only · Metrics Layer Only · 禁止改业务逻辑 / 禁止新 Repair 架构  
**上游：**  
- [Sentence Assembly Conformance A](./Lingua_Sentence_Assembly_Implementation_Conformance_Audit_2026_07_14.md)  
- [Success Funnel](./Lingua_ASR_Repair_Success_Funnel_Audit_2026_07_14.md)  
- [Recall Lookup Funnel](./Lingua_Recall_Lookup_Funnel_Audit_2026_07_14.md)  
**Runtime Diagnostics 冻结：** [`docs/fw-detector/diagnostics/FROZEN.md`](../fw-detector/diagnostics/FROZEN.md) · [`INTERFACE_FREEZE.md`](../fw-detector/INTERFACE_FREEZE.md)  
**Evidence：** `tmp/asr_e2e_quality_validation/asr_e2e_20260714_crnn_v3/`  
**Scripts：** `run-asr-e2e-quality-validation.mjs` · `analyze-asr-repair-success-funnel.mjs`

---

## Final Verdict

# **B**

Metrics **存在 SSOT 问题**。必须先统一 Metrics Layer，再开始 KenLM 开发。

Runtime Diagnostics 本身大体符合 `diagnostics/FROZEN.md`；失败点在 **E2E 投影 + Success Funnel 派生指标** 与 Runtime 字段语义不对齐，不足以定位 KenLM 真实收益。

---

## 1. Metrics Pipeline（完整路径）

```text
Runtime Job Response
  extra.fw_detector.*
  extra.raw_asr_text / text_asr
  extra.utterance_tone（可选）
        ↓
  spanAssemblyV4（summary | trace）
  sentenceRerank
  summary / spans
        ↓
E2E extractMetrics()
  → case.{A|B|C}.*   （asr_e2e_quality_validation.json）
        ↓
Success Funnel analyze()
  → success_funnel_analysis.json + Audit MD
        ↓
Recall Lookup Funnel（派生）
  → recall_lookup_funnel_analysis.json + Audit MD
```

| 级 | 输出什么 | 谁消费 |
|----|----------|--------|
| Runtime | `sentenceRerank.combinationCount` · `topCandidates` · `pickedIsRaw` · `maxDelta` · `allCombinationDeltas` · `spanAssemblyV4.metrics.*` · optional `trace.*` | Job / Electron |
| Trace（可选） | `sentenceCandidates` ≤32 · `recallHits*` · shadow beam | 批测 / d001·d048 |
| E2E JSON | 投影后的 `kenlm.candidates`（优先 trace，否则 topCandidates）· `kenlm.combinationCount` · `exactMatch` · `domainKeywords` · span/tone 摘要 | Success Funnel · 人工 |
| Success Funnel | stage0–7 · primaryOwner · Recall Hit 等 **派生布尔** | Recall Lookup · 决策报告 |
| Audit MD | 人读 SSOT 声明 | 后续实验 |

**关键：** Success Funnel **不是** Runtime 原生指标；是离线脚本对 E2E 投影字段的二次定义。

---

## 2. Success Funnel 指标 → 精确字段

| Funnel 名 | 真实判定 | 源字段（E2E → Runtime） |
|-----------|----------|-------------------------|
| Stage0 FW Correct | `A.exactMatch \|\| norm(A.fwRawText)==expected` | E2E `exactMatch` / `fwRawText` ← `text_asr` / `extra.raw_asr_text` |
| Stage1 Span Generated | `C.spanRecall.spanCount>0 \|\| C.domainVote.triggered` | `fw.summary.spanCount` / `fw.spans.length` / `fw.triggered` |
| Stage1 Span Correct | keyword 启发式：kw 在 raw 或 cand/final；无 kw 时弱代理 | `domainKeywords` + `kenlm.candidates[].text` + raw/final |
| **Stage2 Recall Hit** | `keyword∈candsC \|\| exact sentence∈candsC` | `C.kenlm.candidates[].text` + `domainKeywords`；或 `kenlm.expectedInCandidates` |
| Stage2 Keyword | `kws.some(kw => cand.includes(kw))` | 同上 |
| Stage2 Sentence | `norm(cand)==norm(expected)` | 同上 / `expectedInCandidates` |
| Stage3 Tone Changed | set(candsB) Δ set(candsC) | B/C `kenlm.candidates` |
| Stage3 Tone Exact Hits | count | `C.tone.toneExactHitCount` ← assembly tone summary |
| Stage4 Domain Triggered | bool | `C.domainVote.triggered` ← `fw.triggered` |
| Stage4 After Vote Present | `combinationCount>1 \|\| cands.length>0` | `C.kenlm.combinationCount` + candidates |
| Stage5 Sentence Candidate | **= Stage2 sentence**（同一布尔） | **复用** `stage2_sentence_in_cand_C` |
| Stage6 KenLM given sentence | `sentenceInCand && final exact` 等 | `exactMatch` + Stage5 |
| Stage6 Top1/3/5 | sentence rank ≤K **且**（部分）final | rank over **stored** cands + `exactMatch` |
| Stage7 Final | `C.exactMatch` | final `text_asr` vs expected |
| primaryOwner | if-else 链（见脚本 L150–175） | 上述派生布尔组合 |

**不得说「根据日志」——以上即为字段级来源。**

---

## 3. Exact Sentence 使用位置

凡把 **Expected Sentence Exact Match** 当 Success（或部分 Success）的位置：

| # | 位置 | 字段 / 表达式 | 代表什么 |
|---|------|---------------|----------|
| 1 | E2E `exactMatch` | `norm(final)==norm(expected)` | **整句正确率 / Final** |
| 2 | E2E `kenlm.expectedInCandidates` | exact ∈ 投影 candidates | 句是否进入观测候选集 |
| 3 | Funnel Stage2（无 keyword 时的主路径） | `stage2_sentence_in_cand_*` | **整句是否在 Dump 候选中** —— **不是**纯 Assembly 成功 |
| 4 | Funnel Stage5 | **恒等于** Stage2 sentence | 与 Assembly 阶段名不符 |
| 5 | Funnel Stage6 KenLM conditional | 需 Stage5 sentence | KenLM **条件**归因依赖 exact dump |
| 6 | Funnel Stage7 | `exactMatch` | Final |
| 7 | Recall Lookup「Recall Hit」 | keyword **或** exact sentence | 混整句正确观察 |

**结论：** Exact Sentence 指标代表 **整句正确率 / 整句是否进观测窗**，**不能**单独代表 Assembly 模块成功。

---

## 4. Domain Term 指标

| 问 | 答 |
|----|-----|
| Runtime 是否有独立 `Target Domain Term Success` 字段？ | **不存在** |
| E2E 是否有标准化 term-hit 数组？ | **不存在**（仅启发式 `domainKeywords` 字符串列表） |
| Success Funnel 是否有独立 Term Recall stage？ | **不存在**（keyword 仅作 Stage2 OR 分支） |

**缺失位置：** Runtime Diagnostics · E2E schema · Success Funnel stages —— 三层皆无独立 Domain Term Success SSOT。

（本轮不提出实现。）

---

## 5. Candidate Metrics（Generated vs Stored vs Top5）

| 层 | 字段 | 典型上限 | 语义 |
|----|------|---------:|------|
| Generated | `sentenceRerank.combinationCount` | **16** | Assembly 送入 KenLM 的句数 |
| Scored（全量） | `allCombinationDeltas[]` 长度 = combinations | ≤16 | KenLM 对全部组合打分（pick 用全量） |
| Dump Top5 | `sentenceRerank.topCandidates` | **5** | `rerank-fw-sentences.ts`：`candidates.slice(0,5)` 后再按 delta 排序展示 |
| Trace Dump | `spanAssemblyV4.trace.sentenceCandidates` | ≤32 | 批测开启 trace 时 |
| E2E Stored | `kenlm.candidates` | 优先 trace，否则 Top5 → 实测众数 **5** | Success Funnel **唯一**读的句列表 |

`spanRecall.domainCandidateCount` / `baseCandidateCount` / `mainDomainAwareSpanSetsTotal`：装配侧计数；Success Funnel **几乎不用于 Stage2**。

---

## 6. Dump 截断一览

| 位置 | Generated → Dump | 影响 Success Funnel？ |
|------|------------------|:--------------------:|
| `rerank-fw-sentences.ts` `topCandidates` | ≤16 → **5** | **是**（无 trace 时 E2E 只见 5） |
| E2E `extractMetrics` candidates | 继承上列 | **是** |
| Trace `maxTraceSentenceCandidates` | cap 32 | 开 trace 时可减轻，生产默认常关 |
| Trace recallHits / edges / paths | 多项 cap（500/200/…） | 间接（本 Funnel 少用） |
| Recall window exactTopK | 2+3=5/窗 | Funnel 无直接窗级字段 |
| KenLM pick | **不截断打分集** | Final 用全量；Dump 仍 5 |

E2E 实测：`combinationCount` 众数 16，`candidates.length` 众数 **5** → **Dump 截断显著影响 Stage2/5「是否在候选中」判定。**

---

## 7. Stage Ownership 混入检查

| Stage 名 | 标称职责 | 实际依据 | 混入？ |
|----------|----------|----------|:------:|
| Recall | 词库召回命中 | exact sentence ∈ Dump **或** keyword ∈ Dump | **是 → 混 Assembly+Dump+口径** |
| Assembly（ownership 分支） | 组句失败 | `keyword∈cand && !exactSentence` **或** 其它兜底 | **是 → 混 Exact Sentence** |
| KenLM | 重排选句 | `sentenceInCand && !exactMatch`；TopK 在 Dump 上算 | **部分 → Top@K 混 Dump；pick 本身用全量** |
| Span | 边界正确 | keyword 启发式 / 弱 combinationCount | **弱代理，非 span 真值字段** |
| Domain | Vote 过滤 | `triggered` + combinationCount 代理 | **无法 before/after**（已知） |

---

## 8. Metric Independence

| 指标名 | 是否独立字段 | 实际 |
|--------|:------------:|------|
| Term Recall | 否 | keyword 分支 ⊆ Stage2，与 sentence OR |
| Sentence Candidate（Stage5） | 否 | **= Stage2 sentence 同一布尔** |
| Final Sentence | 是 | `exactMatch` / final text |
| Generated 规模 | 是 | `combinationCount` |
| Dump 列表 | 是（但截断） | `kenlm.candidates` |

**复用位置：** `analyze-asr-repair-success-funnel.mjs` L226–227：`sentenceCand = recallSentence`；Stage5 `@10` 在仅有 ≤5 dump 时与 `@5` 同界。

---

## 9. Primary Metric

当前隐含 Primary（Final + Funnel 主叙事）：

```text
Exact Sentence Match（final 与/或 dump 内 exact）
```

影响：

1. Assembly 无独立「repair-grade term 入句」成功率 → 失败被灌进 Recall / Ranking。  
2. 无 keyword 的 150/200 cases，Stage2 ≈ Exact Sentence Dump Hit。  
3. KenLM 条件归因要求 sentence 已在 Dump → Dump Top5 会收缩「给定句再评 KenLM」分母。

---

## 10. Metrics SSOT Mapping

| Stage | Metric | Source Field | Consumer |
|-------|--------|--------------|----------|
| FW | Raw/Final exact | `exactMatch` · `fwRawText` · `finalText` | Funnel 0/7 · CER |
| Span | spanCount / applied | `spanRecall.spanCount` · `appliedCount` | Funnel 1（弱） |
| Span | domain/base cand counts | `spanRecall.domainCandidateCount` 等 | 几乎未进 Funnel Stage2 |
| Vote | triggered / domain ids | `domainVote.*` | Funnel 4 |
| Assembly gen | combinationCount | `kenlm.combinationCount` ← `sentenceRerank.combinationCount` | Funnel 4 proxy · 规模 |
| Assembly+KenLM dump | Top5 texts | `kenlm.candidates` ← `topCandidates` \| trace | **Funnel 2/5 主输入** |
| KenLM gate | pickedIsRaw · maxDelta | `kenlm.pickedIsRaw` · `maxDelta` | 条件归因；Final |
| KenLM pick | final text | `finalText` / Apply | Funnel 6/7 |
| Tone | exact/plain/compat counts | `tone.*` | Funnel 3 |
| Fixture | domainKeywords | E2E 启发式列表 | Funnel 1/2 |
| Ownership | primaryOwner | 脚本派生 | 决策 · Recall Audit |

Runtime `diagnostics/FROZEN.md` 的 selected≠applied≠approved **未被 Success Funnel 建成独立 stage。**

---

## 11. 重复统计 / 多套定义

| 指标名 | 定义 A | 定义 B | 冲突？ |
|--------|--------|--------|:------:|
| Recall Success / Hit | Success Funnel：kw\|exact ∈ Dump | Recall Lookup：同 Stage2，再拆 Lookup/Ranking | **同一上游，不同叙事粒度** |
| Recall（Ownership 69.3%） | primaryOwner==='Recall' | 含「无 exact 且无 kw」——可含 Assembly dump 失败 | **与 Lookup Funnel「Ranking」交叉** |
| Sentence Candidate | Stage5 = exact∈Dump | Runtime combinationCount / 全量 combinations | **是** |
| KenLM Success | Final exact \| stage6 conditional | Runtime `pickedIsRaw` / Gate 3.0 | **部分脱节**（Funnel 不直接读 Gate） |
| TopK | Funnel @10/@20 | 存储仅 ≤5 | **伪 TopK** |

Success Funnel 自封 SSOT（Audit §11），但 Runtime Diagnostics 另有冻结 SSOT —— **双 SSOT**。

---

## 12. 文档一致性

| 文档 | Metrics 叙事 | 与 Funnel 一致？ |
|------|--------------|:----------------:|
| `diagnostics/FROZEN.md` | combinationCount · topCandidates · selected≠applied | Funnel **未落实** selected/applied 分层 |
| `INTERFACE_FREEZE.md` | topCandidates = Top-N；allCombinationDeltas 全量 | Funnel **只用** Top-N 文本，忽略全量列表定位 |
| `ARCHITECTURE.md` | 主链阶段清晰 | Funnel 阶段名 **错位**（Recall 吃 Assembly） |
| Success Funnel Audit | 自封后续唯一 SSOT | 与 Runtime 字段语义 **不完全同一** |
| Recall Lookup Audit | 承认 Dump/口径问题 | 与 Funnel 上游耦合 |
| Assembly Conformance | Verdict A；指出 Top5 dump | 与本轮一致 |

---

## 13. KenLM 开发风险（只列缺失）

若 **直接**开 KenLM 开发，当前 Metrics **不足以**干净定位收益。缺失：

1. **全量句候选文本集**（不经 Top5）上的 `expectedInCandidates` / term-in-cand  
2. **KenLM pick 专属**：`picked` 文本 · `pickedIsRaw` · `maxDelta` vs Gate —— 与 Dump Top5 分离  
3. **Assembly-only**：repair-grade term 是否进入 **Generated** combinations（非 Dump）  
4. **独立 Domain Term Success**（非 exact sentence）  
5. **统一 Stage 定义表**（禁止 Recall/Assembly/KenLM 共用水印字段而不标注）

（不提实现方案。）

---

## 14. 最终回答（十问）

| # | 问题 | 回答 |
|---|------|------|
| 1 | Success Funnel 是否真正反映业务？ | **部分反映 Final；阶段归因不可靠** |
| 2 | Recall 是否混入 Assembly？ | **YES** |
| 3 | Assembly 是否混入 Exact Sentence？ | **YES** |
| 4 | KenLM 是否混入 Dump？ | **观测层 YES（Top@K）；pick 打分 NO（全量）** |
| 5 | Top5 Dump 是否影响 Success Funnel？ | **YES** |
| 6 | 是否存在重复 Metrics？ | **YES**（Stage2↔5；多报告复用） |
| 7 | 是否存在多个 Metric 定义？ | **YES**（Runtime vs Funnel vs Lookup） |
| 8 | Metrics 是否真正符合 SSOT？ | **NO（双 SSOT / 投影失真）** |
| 9 | 是否需要调整 Metrics Layer？ | **YES** |
| 10 | 调整以后才能开始 KenLM？ | **YES**（否则无法区分 Dump/Assembly/Gate 收益） |

---

## 15. Final Verdict（唯一）

## B

**Metrics 存在 SSOT 问题。必须先统一 Metrics，再开始 KenLM。**

- 不修改业务逻辑。  
- 不提出新 Repair 架构。  
- Runtime Diagnostics 冻结仍有效；优先对齐 **E2E 投影 + Success Funnel 派生定义** 与 `diagnostics/FROZEN.md` / `INTERFACE_FREEZE.md` 字段语义。
