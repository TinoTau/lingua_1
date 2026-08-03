<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/Lingua_Fine_Domain_Recall_and_Generated_Sentence_Quality_Acceptance_2026_07_15.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Lingua Fine-Domain Recall & Generated Sentence Quality Acceptance

**Date:** 2026-07-15  
**Type:** Acceptance · Read-only · Consumer Analysis  
**Status:** Complete  
**Corpus:** `dialog_200` · **200 / 200** · Variant **C**（Full Repair + Tone CRNN V3）  
**Evidence Run:** `tmp/asr_e2e_quality_validation/asr_e2e_freeze_trace_full_20260715/`  
**Analysis JSON:** `.../fine_domain_recall_assembly_acceptance.json`  
**Analyzer:** `electron_node/electron-node/tests/experiments/analyze-fine-domain-recall-assembly-acceptance.py`  
**Local deep-trace samples:** `electron_node/electron-node/tests/trace-d001.json` · `trace-d048.json`

**Binding（不得绕过）：**

| 文档 | 角色 |
|------|------|
| [ARCHITECTURE.md](../fw-detector/ARCHITECTURE.md) | 冻结主链 SSOT |
| [Lingua_Repair_Framework_Final_Freeze_Verification.md](./Lingua_Repair_Framework_Final_Freeze_Verification.md) | Repair Framework Freeze |
| [Lingua_Metrics_Layer_SSOT_Mapping.md](./Lingua_Metrics_Layer_SSOT_Mapping.md) | Mapping Catalog |
| [Lingua_Runtime_Evolution_Rule.md](./Lingua_Runtime_Evolution_Rule.md) | Runtime 演进永久约束 |
| [Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md](./Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md) | Metrics Consumer 边界 |

---

## Final Verdict

# **C — Assembly Quality Gap**

```text
Recall and Assembly Quality: NOT PASS for KenLM Corpus Audit
Primary Gap: Multi-term / Usable Generated Sentence quality
（Sentence Generation · Multi-term Assembly）
```

**不得进入 KenLM Corpus Audit。**

理由（摘要）：

1. **Generated 覆盖约一半可用，但“严格可用”极低**：词级 `In Generated` **53.9%**，严格 `usable` 仅 **11.1%**；case 级严格 usable 仅 **12 / 84 = 14.3%**。  
2. **多目标词联合组句失败是显性瓶颈**：21 个多词 case 中仅 **3** 个能让全部目标词进入**同一句** Generated（**14.3%**）。典型 cafe 句（中杯 / 少糖 / 蓝莓马芬）经常各自零散出现。  
3. **Local full trace 证明：关键目标词可被 Recall 命中，但仍组装失败**（见 d001：`拿铁` / `蓝莓马芬` 均出现在 `recallHits[]`，Generated 仍破碎）→ 可见失败落在 **Sentence Generation / Multi-term Assembly**，而非“词库空白唯一解释”。  
4. **KenLM 尚不能称为主瓶颈**：严格 usable 机会仅 **12** case；其中 KenLM 选对 usable **4 / 12 = 33.3%**，且 **8 / 12** 仍 `pickedIsRaw`。在 usable 池过薄时，进入 KenLM Corpus Audit 会错误归因。  
5. Stages 1–4 语料级明细因 Consumer extract 丢弃而 **Unavailable** → **不得推断为 Failure**；亦不得据此宣称 Recall PASS。

---

## 0. Scope & Freeze Compliance

### 0.1 本轮做了什么

| 项 | 结果 |
|----|------|
| 修改 FW / Tone / Span / Recall / Domain Vote / Assembly / KenLM / Lexicon | **否** |
| 修改 Metrics 语义 / Mapping Catalog 业务定义 | **否** |
| Runtime Business Logic Diff | **= 0** |
| 运行完整 trace 验收 | **是**（复用已冻结 full trace 跑批 `asr_e2e_freeze_trace_full_20260715`，200/200）|
| Consumer 分析脚本 | **新增**（只读） |
| Overlay `fixture_target_terms[]` | **是**（明确 Overlay，非 Runtime） |

### 0.2 唯一冻结链路（依据）

```text
FW Raw + WordInfo
        ↓
Span
        ↓
Recall Hits
        ↓
Unified Candidate Pool
        ↓
Utterance Global Domain Vote
        ↓
Winner Domain + Base Candidate
        ↓
Per-span Select
        ↓
Cross-span Sentence Assembly
        ↓
Generated Sentences          ← sentenceRerank.allCombinations（非 Dump）
        ↓
KenLM Score / Gate / Pick
        ↓
Final Output
```

### 0.3 数据来源决策

用户选择 **reuse_existing**。

该跑批配置满足：

```text
spanAssemblyV4DiagnosticsEnabled = true
spanAssemblyV4DiagnosticsLevel = trace
spanAssemblyV4DiagnosticsTargetIds = []
```

但 E2E Consumer extract **仅保留计数**（`recallHitsCount`），**丢弃** Runtime 已发出的：

- `coarseSpans[]` / span 边界  
- `recallHits[]`（含 `hitKind` · `toneLookupStage` · `repairTarget`）  
- `poolBeforeDrop` / `poolAfterDrop`  
- `utteranceDomain`（extractor 误用 `coarseDomain`/`fineDomain` → 恒为 null）

按 Runtime Evolution Rule：

> **Unavailable ≠ Failure** · Metrics/Report 不得反推 Stage 失败。

因此本验收：

- **Stages 5–9**：语料级可度量（Generated / Usability / KenLM Opportunity / Final / Preservation）  
- **Stages 1–4**：语料级标 **Unavailable**；仅对本地 full-trace 样例（d001/d048）做探针证据  

**Capture Gap 本身属于 Diagnostics Persistence / Catalog 登记问题，不是本轮改 Repair 的理由。**

---

## 1. Overlay：`fixture_target_terms[]`

### 1.1 原则

- **仅 Overlay Metric**，不得冒充 Runtime 字段。  
- 优先：curated 细分 domain 词（≥2 字）∩ `expectedText` ∩（lexicon 可验证优先）。  
- 合并 E2E `domainKeywords`，但禁止把短词重新嵌进已选长词（例：已选 `蓝莓马芬` 则不再另计 `蓝莓`/`马芬`）。  
- 排除：功能词、任意单字、整句 expected、与 domain 无关普通短语。

### 1.2 规模

| 项 | 值 |
|----|---:|
| Cases with target terms | **84** / 200 |
| Target terms total | **117** |
| Lexicon exists | **56**（47.9%） |
| Not in lexicon | **61**（52.1%） |

Lexicon 当前 4 域（`restaurant` / `travel` / `transport` / `tech_ai` · 2002 terms）无法覆盖 hospital / bank / gym / shopping 等 fixture 场景 → Overlay 目标词大量 `lexicon_exists=false`（记录为覆盖缺口，本轮不扩库）。

每条目标词记录字段：

```text
term · expected_domain · term_length · lexicon_exists
term_domain_tags · pinyin_key · source · source_bucket
```

---

## 2. 字段可用性审计（Mapping Catalog）

| Runtime / Mapping 字段 | 本跑批可用性 | Stage 影响 |
|------------------------|:------------:|-----------|
| `sentenceRerank.allCombinations` | ✅ | Stage 5–6 Generated |
| `sentenceRerank.topCandidates` | ✅ Dump only | **禁止**替代 Generated |
| `pickedIsRaw` · `maxDelta` · `minDeltaToReplace` | ✅ | Stage 9 |
| `appliedCount` | ✅ | Apply |
| `spanAssemblyV4.recallHitsCount` | ✅ count | 不能做逐词 Stage 2 |
| `spanAssemblyV4.recallHits[]` | ❌ Discarded | Stage 2 **Unavailable** |
| `coarseSpans[]` / 边界 | ❌ Discarded | Stage 1 **Unavailable** |
| `poolBeforeDrop` / `poolAfterDrop` | ❌ Discarded | Stage 4 **Unavailable** |
| `utteranceDomain` | ❌ 未透传 | Stage 3 **Unavailable** |

---

## 3. 验收漏斗结果

### 3.1 词级（§6.1）

| Metric | Count | Rate | Note |
|--------|------:|-----:|------|
| Target terms total | 117 | — | Overlay |
| Span OK | 5 | 4.3% | **几乎全部 Unavailable**；5 = local_trace 探针 |
| Recall Hit | 4 | 3.4% | **几乎全部 Unavailable**；4 = local_trace 探针 |
| Domain Retained | — | Unavailable | `utteranceDomain` 未捕获 |
| Selected for Assembly | — | Unavailable | pool 未捕获 |
| In Generated Sentence | **63** | **53.9%** | Runtime `allCombinations` |
| In Usable Generated Sentence | **13** | **11.1%** | automatic usability v2（需 repair evidence） |
| （其中 partially_usable） | 50 | 42.7% | 多属“目标已在 Raw / 无改进 / 句面破碎” |
| In Final Output | 54 | 46.2% | Overlay observation |

### 3.2 Case 级（§6.2）

| Metric | Count | Rate |
|--------|------:|-----:|
| Cases with target terms | 84 | — |
| At least one target in Generated | 52 | **61.9%** |
| All target terms in Generated（分散可） | 37 | 44.1% |
| **All target terms in ONE Generated Sentence** | **3** | **14.3%**（multi=21） |
| Usable Generated present（strict） | **12** | **14.3%** |
| KenLM selected usable | 4 | 4.8% |
| Final all target terms correct | 29 | 34.5% |

### 3.3 KenLM Opportunity（§ Stage 9）

| Metric | Count | Rate |
|--------|------:|-----:|
| Cases with **strict usable** Generated | 12 | — |
| KenLM selected usable among opportunity | 4 | **33.3%** |
| `pickedIsRaw` among opportunity | 8 | **66.7%** |

**规则执行：** 无 usable Generated → `kenlm_opportunity=false`，**不得归因 KenLM**。

### 3.4 Domain 质量（§6.3）

| 项 | 结果 |
|----|------|
| coarse domain correct | **Unavailable** |
| fine domain winner correct | **Unavailable** |
| target retained / wrongly removed after vote | **Unavailable** |
| Overlay expected_domain 分布 | cafe/restaurant/tech/hotel/hospital/bank 等均有目标词 |

不得假设一词一领域；本轮无法验证 multi-domain retention（缺 `utteranceDomain`）。

### 3.5 来源桶（§6.4）

| Bucket | Total | Recall(corpus) | Select | Generated | Usable | Final |
|--------|------:|----------------|:------:|----------:|-------:|------:|
| domain_lexicon | 56 | Unavailable | Unavailable | **53.6%** | **7.1%** | 46.4% |
| not_in_lexicon | 61 | Unavailable | Unavailable | 54.1% | 14.8% | 45.9% |

说明：`not_in_lexicon` 的 Generated/Final 并非“召回成功”，多源自 Raw 已含词 / 简繁归一后的 Overlay 命中；**不能**据此宣称扩库无必要——只说明本轮看不到差异化 Recall 桶证据。

### 3.6 Non-target Preservation（§ Stage 7）

| Metric | Value |
|--------|------:|
| Mean non-target preservation（matching gens） | **0.947** |
| Samples | 63 |

非目标区域保护在**字符级 Overlay**上看起来偏高；但与“严格 usable 低”并存的含义是：多数 Generated **几乎等于 Raw 的错句**，再叠上部分乱替换（d003→掩埋/烧饼），**不是高质量修复句**。

---

## 4. Candidate Sentence Usability 规则（自动 + 代表抽检）

**automatic_usability_v2（Overlay）：** 须同时偏严：

1. ≥1 目标细分 domain 词出现在 Generated  
2. **Repair evidence**：目标词原 Raw 缺失而 Gen 补上，**或** 目标区域相对 Expected 编辑距离改进  
3. 无严重重复片段 / 乱码 / 长度异常  
4. 非目标区 preservation ≥ 0.55  
5. 与 Expected 有基本结构重叠  

输出：`usable` | `partially_usable` | `unusable`

人工代表抽检与规则一致：cafe 多词句（d001/d002）Generated 面“可读破碎句”，不算严格 usable；bank 单词（转账/理财）偶发 usable。

---

## 5. Primary Ownership

### 5.1 归因规则

按 Runtime 决策链**第一个真实可见失败**；字段不可见 → **Unavailable**（不推断 Failure）。  
禁用混合标签：`Multiple` / `Ranking` / `Recall Failure` / `Assembly Failure`。

允许 Owner：

```text
Span · Recall · Domain Retention · Per-span Selection
Sentence Generation · Multi-term Assembly · Non-target Preservation
KenLM · Apply · No Failure · Unavailable
```

### 5.2 分布（有目标词的 case）

| Primary Owner | Cases |
|---------------|------:|
| **Sentence Generation** | **40** |
| Unavailable（Stages1–4 不可见且未进 Generated） | 33 |
| KenLM | 7 |
| No Failure | 4 |

词级：Unavailable 54 · Sentence Generation 50 · KenLM 8 · No Failure 5。

---

## 6. 代表性 Case（≥30）

完整 35 条见 analysis JSON `representatives[]`。下列覆盖要求场景：

### 6.1 目标词 Recall 命中但仍组句失败（local full trace）— d001 cafe

| 字段 | 值 |
|------|----|
| Expected | 你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？ |
| FW Raw | 你好,我想點一杯熱拿鐵鐘貝少糖 今天有蓝没马分吗? |
| Targets | 蓝莓马芬 · 拿铁 · 中杯 · 少糖 |
| Local `recallHits` | **拿铁** exact_term；**蓝莓马芬** exact_term（plain_fallback） |
| Winning Domain | Unavailable |
| Selected per-span | Unavailable（corpus）；span 探针见 `中杯` 曾出现在 candidates |
| Generated（含目标） | 破碎句，如「点衣被熱拿鐵鐘焙烧糖…」；多词同句覆盖 max=2 |
| KenLM | `pickedIsRaw=true` · applied=0 |
| Final | = Raw（未修复） |
| **Primary** | **Sentence Generation**（Recall 探针成功 ≠ 可用组句） |

### 6.2 多词分别出现但无法共同组句 — d002 cafe

| 字段 | 值 |
|------|----|
| Targets | 美式 · 大杯 |
| Generated | 常出现「以北美式…大背」类破损；同句双目标失败 |
| Primary | Sentence Generation |

### 6.3 无目标进 Generated — d003 cafe

| 字段 | 值 |
|------|----|
| Targets | 燕麦拿铁 · 小杯 · 少冰 |
| Raw | …烟麦拿铁…烧病…小背 |
| Final | …**掩埋**拿铁…**烧饼**…小背（错误 Apply） |
| Generated 含目标 | **0** |
| Primary | **Unavailable**（缺 Stage1–4）；同时警示 Apply 破坏 |

### 6.4 单词 usable 且 KenLM/Apply 生效 — d035/d036 bank

| Case | Target | 现象 | Owner |
|------|--------|------|-------|
| d035 | 转账 | Gen/Final 出现「转账」 | No Failure |
| d036 | 理财 | Gen/Final 出现「理财」 | No Failure |

### 6.5 有 usable 但 KenLM 仍选 Raw — d047 cafe

| 字段 | 值 |
|------|----|
| Target | 大杯 |
| Generated 含「大杯」 | 是（并伴随「以北/酒行歇歇」副作用） |
| pickedIsRaw | **true** |
| Primary | **KenLM** |

### 6.6 多词 joint success 样例 — d137 cafe

| Targets | 拿铁 · 大杯 |
| Generated | 同句可共现（如「…热拿铁…大杯…」），仍夹杂噪声 |
| Primary | KenLM（pickedIsRaw）|

### 6.7 场景覆盖

抽检覆盖：cafe · restaurant · hotel · taxi · shopping · meeting · tech_deploy · hospital · bank · local_full_trace。

---

## 7. 必须回答的 12 问

| # | 问题 | 答案 |
|---|------|------|
| 1 | Span Coverage？ | **Unavailable**（corpus）；local_trace 仅探针 5 词可见 |
| 2 | Recall Hit Rate？ | **Unavailable**（corpus）；d001 证明关键词**可以** Recall Hit |
| 3 | Domain Vote 保留比例？ | **Unavailable**（`utteranceDomain` 未透传） |
| 4 | Per-span Select 是否大量丢失？ | **Unavailable**（pool 未捕获） |
| 5 | 进入 Generated 比例？ | **53.9%**（词）/ **61.9%**（case 至少一个） |
| 6 | 多目标能否同句？ | **仅 14.3%**（3/21）→ **否，明显不足** |
| 7 | Generated 通顺且保护非目标？ | 非目标保护均值 0.95；但严格 usable **仅 11.1%** → **通顺/可修复性不足** |
| 8 | 主要失败在哪？ | 可见层：**Sentence Generation / Multi-term Assembly**；大量早期阶段 **Unavailable** |
| 9 | 有 usable 时 KenLM 选对率？ | **33.3%**（4/12）；机会集过小 |
| 10 | 具备 KenLM Corpus Audit 条件？ | **否** |
| 11 | 是否仍需改冻结 Repair 业务逻辑？ | **本轮禁止**；下一步若开开发，须先过 P0–P3，且**主缺口在 Assembly 可用句质量**而非先扩 KenLM 语料 |
| 12 | “细分 domain 词召回并组装”是否可接受？ | **否 — Assembly 侧未达可接受水平**（联合组句 + usable） |

---

## 8. Architecture Compliance

| 项 | 结果 |
|----|:----:|
| Runtime Business Logic Diff = 0 | ✅ |
| No Shadow Logic | ✅ |
| No Compatibility Logic | ✅ |
| No Hidden Gate | ✅ |
| No Bypass | ✅ |
| No new Projection Stage | ✅ |
| Runtime Diagnostics remains SSOT | ✅ |
| Metrics 只消费 Catalog 已登记字段 | ✅ |
| Overlay Metric 明确标识 | ✅ |
| Generated ≠ Dump | ✅（强制 `allCombinations`） |
| Trace 不参与生产决策 | ✅ |
| Unavailable ≠ Failure | ✅ |

---

## 9. KEEP / MODIFY / RESTORE / DELETE

| 对象 | 裁决 | 说明 |
|------|:----:|------|
| 冻结 Repair 主链 | **KEEP** | 本轮零业务改动 |
| Metrics Mapping Catalog 语义 | **KEEP** | 不改字段定义 |
| Runtime Evolution Rule | **KEEP** | Capture 扩展须走 Freeze→Catalog |
| Success Funnel 派生 Stage SSOT | **DELETE（禁用）** | 本轮未使用 |
| 用 Dump Top5 代替 Generated | **DELETE（禁用）** | |
| 用 Generated 反推 Recall Hit | **DELETE（禁用）** | |
| E2E extract 持久化 `recallHits[]` / `utteranceDomain` / pool / spans | **MODIFY（未来 Consumer）** | 属 Diagnostics Persistence；**非本轮**；须 Catalog 登记后 Metrics 才可消费 |
| 扩词库 / 重训 KenLM / 改 Assembly | **KEEP 冻结** | 验收未授权开发 |
| 回滚 Metrics SSOT 对齐 | **RESTORE 不需要** | |

---

## 10. 验收门槛对照

| PASS 条件 | 本轮 |
|-----------|------|
| 目标词 Recall Hit 明显可用 | **不可判定**（Unavailable）+ local 样例暗示部分可用 |
| Domain Vote 无系统性误杀 | **不可判定** |
| Per-span Select 无系统性截断 | **不可判定** |
| 目标词进入 Generated 比例较高 | **部分**（~54% / 62%） |
| 多目标词正常共同组句 | **失败**（14.3%） |
| Usable Generated 足以支撑 KenLM | **失败**（12/84） |
| 非目标区域保护可接受 | **部分**（字符保护高，但句质量差） |
| 剩余失败主要在 KenLM | **否**（主因 Sentence Generation） |

→ **非 PASS** · **非 D（KenLM 主瓶颈）** · **非 B（无法断言主要在 Span/Recall）**  
→ **Verdict C — Assembly Quality Gap**

---

## 11. Next Phase（文档建议 · 非授权开发）

1. **不得**直接开 KenLM Corpus Audit。  
2. 若进入下一开发轮，Primary Gap 应聚焦：  
   - **Usable Generated Sentence 质量**  
   - **Multi-term 同句组装**  
   （在冻结架构内：Cross-span Sentence Assembly / candidate combination 质量，而非另起 Projection。）  
3. **并行 Diagnostics 义务（Evolution Rule）：** Consumer extract 持久化并 Catalog 登记：  
   `recallHits[]` · `utteranceDomain` · `poolBeforeDrop/AfterDrop` · `coarseSpans[]`  
   以便下一次验收能关闭 Stages 1–4 Unavailable。  
4. Lexicon 场景覆盖缺口（hospital/bank/…）记录为语料/词库审计输入，**本轮不扩库**。

---

## 12. Verdict（唯一）

## C — Assembly Quality Gap

细分 domain 目标词在局部证据下**可以被 Recall**，但：

- 严格可用 Generated 句比例不足；  
- 多目标词难以进入同一句 Generated；  
- 可见失败 Owner 集中在 **Sentence Generation**。

**不得进入 KenLM Corpus Audit。**

```text
Recall and Assembly Quality: CONDITIONAL / Assembly Gap
Next authorized phase: Assembly Usable-Candidate Quality Audit
（禁止绕过 Mapping · 禁止自动新 Metrics · 禁止改冻结主链直至正式开发授权）
```

---

*Lingua Fine-Domain Recall & Generated Sentence Quality Acceptance · 2026-07-15 · Runtime Business Logic Diff = 0*
