<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/Lingua_Metrics_Layer_SSOT_Alignment_Supplement_2026_07_14.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# Lingua Metrics Layer SSOT Alignment — Supplement（P2 缺口与契约）

**Date:** 2026-07-14  
**Process:** CODING P2 · Supplement Review（禁止改变冻结设计 / 禁止本文件内直接开发业务）  
**Upstream Audit:** [Lingua_Repair_Diagnostics_SSOT_Metrics_Audit_2026_07_14.md](./Lingua_Repair_Diagnostics_SSOT_Metrics_Audit_2026_07_14.md)（Verdict **B**）  
**Proposal / Plan Input:** Metrics Layer SSOT Alignment Development（用户提示词）  
**Frozen SSOT（不得改义）:**  
- [`docs/fw-detector/diagnostics/FROZEN.md`](../fw-detector/diagnostics/FROZEN.md)  
- [`docs/fw-detector/INTERFACE_FREEZE.md`](../fw-detector/INTERFACE_FREEZE.md)  
- [`docs/fw-detector/ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md)  
- Assembly / KenLM / Recall 主链冻结（本轮 Metrics **只消费**）

**本文件产出类型：** Design / Interface / Data / Decision Constraint · Regression · Acceptance  
**下一步（本文件之后）：** 方可进入 Metrics Layer 映射脚本与文档对齐开发；**不得**据此改 Repair Pipeline。

---

## 0. Executive Decision（对开发提示词）

| 裁决 | 项 |
|------|-----|
| **KEEP** | Runtime Diagnostics 为唯一 Truth；Metrics = Mapping → Report |
| **MODIFY** | 提示词中的 Stage / 字段映射表（多处语义错误或字段不存在） |
| **RESTORE** | Success Funnel / Recall Funnel 降为 **Consumer Report**，撤销其「第二 SSOT」地位 |
| **DELETE** | 任何「重新推导业务状态 / Projection 二次解释」路径；Stage2=Stage5 共享布尔 |

**能否直接按提示词开码？** → **否。** 必须先吸收下列契约补丁，否则会再次制造双 SSOT 或伪 Runtime 字段。

---

## 1. Design Constraints（补充）

### DC-1 · 单一 Truth 链（KEEP 提示词 §二）

```text
Runtime Diagnostics（唯一 SSOT）
        ↓
Metrics Mapping（无业务推导）
        ↓
Report（Success / Recall Lookup / E2E 摘要）
```

**来源：** Design Gap（Audit Verdict B）· Architecture Drift（Funnel 自封 SSOT）

**禁止：** Runtime → 瘦投影 → 再猜 Stage 成败。

### DC-2 · 不得发明 Runtime 字段（MODIFY 提示词 §八 Domain Term）

Runtime **没有** `Target Domain Term Recall/Candidate/Final` 原生字段。

**允许的 Metrics 形态（Fixture Overlay Contract，非 Runtime SSOT）：**

| Metrics 名 | 允许算法 | 标注 |
|------------|----------|------|
| FixtureTerm_InDump | fixture term ⊆ Dump 句文本 | `source=fixture+dump` |
| FixtureTerm_InGenerated | fixture term ⊆ `allCombinations[].sentence` | `source=fixture+generated`；**依赖 Trace** |
| FixtureTerm_InFinal | fixture term ⊆ finalText | `source=fixture+final` |

**禁止**把上述三项写成「Runtime Field」。  
**来源：** Design Gap · Code Implementation（无 term SSOT 字段）

### DC-3 · Generated 文本观测窗口（MODIFY 提示词 §五 §七）

| 字段 | 何时可得 | 上限 |
|------|----------|------|
| `sentenceRerank.combinationCount` | 始终 | ≤16（config） |
| `sentenceRerank.topCandidates` | 始终 | **5**（硬截断） |
| `sentenceRerank.allCombinationDeltas` | 始终（有 KenLM） | = generated |
| `sentenceRerank.allCombinations[].sentence` | **仅** `traceActive` | ≤32 |
| `spanAssemblyV4.trace.sentenceCandidates` | 仅 trace | ≤32 |

**现状代码：** E2E `run-asr-e2e-quality-validation.mjs` 设置  
`spanAssemblyV4DiagnosticsEnabled=true` 但 **`Level='summary'`** → **`allCombinations` 永不写出**。

**契约：** Metrics 对齐 run **必须**消费端配置：

```text
spanAssemblyV4DiagnosticsEnabled = true
spanAssemblyV4DiagnosticsLevel   = 'trace'
spanAssemblyV4DiagnosticsTargetIds = []   # 空 = 全部 case
```

这是 **配置消费**，不是改 Runtime 接口 / 业务逻辑。  
**来源：** Code Implementation · Test Finding（E2E summary 导致 Full Generated 不可见）

### DC-4 · Exact Sentence 不得充当 Assembly Success（KEEP 提示词 §七）

Assembly Metrics 仅允许：

- `combinationCount`（Generated Sentence Count）
- Generated 文本覆盖（需 `allCombinations`）
- Dump 文本覆盖（`topCandidates`）— 标注 `dump_only`
- `summary.candidateSentenceCount` 等已有计数

**禁止：** `norm(cand)==norm(expected)` 作为 Assembly Stage 成功。  
Exact Match 仅属 **Final / FW 观察**。  
**来源：** Audit · Architecture Drift

### DC-5 · KenLM Metrics 不得用 Dump Top5 代替全量（KEEP 提示词 §九）

KenLM 负责段：

```text
Generated (combinationCount / allCombinations)
    ↓
KenLM scored (allCombinationDeltas；pick 用全量)
    ↓
Gate (maxDelta vs minDeltaToReplace · pickedIsRaw)
    ↓
Apply (summary.appliedCount · replacements[].applied)
    ↓
Final (text_asr)
```

Dump Top5 **仅**报 `Dump Candidate Count / Dump Texts`。  
**来源：** Code Implementation（`rerank-fw-sentences.ts` 全量 score + Top5 dump）

---

## 2. Interface Contracts（补充）

### IC-1 · Metrics 只读 Job Diagnostics（KEEP）

Metrics Layer **只读** `extra.fw_detector` / `text_asr` / `raw_asr_text`。  
**禁止：** 改 Node HTTP、改 KenLM scorers、改 Assembly/Recall 函数、改字段语义。

### IC-2 · E2E Projection = Transparent Pass-through（MODIFY / 实现时强制）

`extractMetrics` **必须**：

| MUST pass-through | 今日状态 |
|-------------------|----------|
| `sentenceRerank.combinationCount` | 已有 |
| `sentenceRerank.topCandidates`（整对象） | 混入 `kenlm.candidates` |
| `sentenceRerank.allCombinationDeltas` | **未投影** → MODIFY 补齐 |
| `sentenceRerank.allCombinations` | **未投影** → MODIFY 补齐 |
| `sentenceRerank.pickedIsRaw` · `maxDelta` · `picked` | 部分有 |
| `summary.appliedCount` · `kenlmApprovedCount` | 部分有 |
| `fw.triggered` | 已有 |

**禁止**再算 `kenlmLayer` A/B/C/D 作为业务 Stage（可保留为 optional diagnostic tag，**不得**进 Ownership）。  
**来源：** Code Implementation · Architecture Drift

### IC-3 · 三套 TopK 命名隔离（KEEP 提示词 §十）

| 名 | Runtime / Config 真相 | Metrics 字段名（强制） |
|----|----------------------|------------------------|
| Recall TopK | `exactTopK=2` · `parentFragmentTopK=3` | `recall_window_topk_*` |
| Sentence TopK | `maxSentenceCandidates=16` | `sentence_generated_cap` / `combinationCount` |
| Dump TopK | `topCandidates.length≤5` | `dump_topk` / `dump_candidate_count` |

**禁止**报告写裸「TopK」或「@10」当存储 ≤5。  
**来源：** Audit · Design Gap

---

## 3. Data Contracts（补充）

### MAP-1 · Runtime → Metrics（校正后的唯一表）

| Runtime Field | Metrics Field | 允许语义 | 提示词原表 |
|---------------|---------------|----------|------------|
| `summary.spanCount` / `fw.spans.length` | `span_count` | **计数**，≠ Success | 误写成 Span Success → **MODIFY** |
| `fw.triggered` | `domain_or_span_triggered` | Vote/装配触发代理 | triggered → Domain Vote Triggered（可 KEEP 名，须注明代理） |
| `sentenceRerank.combinationCount` | `generated_sentence_count` | Generated 句数 | KEEP |
| `sentenceRerank.topCandidates` | `dump_candidates` + `dump_candidate_count` | Dump 窗口 | KEEP 分列 |
| `sentenceRerank.allCombinationDeltas` | `generated_deltas` | 全量打分向量 | 提示词「Ranking」易误解 → **MODIFY** 名 |
| `sentenceRerank.allCombinations` | `generated_candidates`（含 sentence） | Generated 文本集 | 提示词未列全 → **RESTORE 用法** |
| `sentenceRerank.pickedIsRaw` | `kenlm_kept_raw` | true=未应用修复句 | 提示词「KenLM Applied」→ **MODIFY**：Applied = `!pickedIsRaw` 且 gate 过 |
| `sentenceRerank.maxDelta` | `kenlm_max_raw_delta` | KenLM Gain 观测 | KEEP |
| `sentenceRerank.minDeltaToReplace` | `kenlm_gate_threshold` | 常数对照 | 提示词未列 → **RESTORE** |
| `summary.appliedCount` | `apply_count` | Writeback 次数 | 提示词未列 → **RESTORE** |
| `sentenceRerank.picked` / final `text_asr` | `kenlm_picked_text` / `final_text` | 选句与 Final | RESTORE |
| Fixture list（E2E） | `fixture_terms[]` | **非 Runtime** | Domain Term → Overlay |

### MAP-2 · Success Funnel Stage 重映（MODIFY 提示词 §十一）

提示词目标链：

```text
FW → Span → Lookup → Assembly → KenLM → Final
```

**契约化 Stage（每级独立字段，禁止共享布尔）：**

| Stage ID | Metrics 布尔/计数 | Runtime 依据 | 禁止混入 |
|----------|-------------------|--------------|----------|
| S0_FW | `fw_raw_exact` | raw vs expected（观察） | Assembly |
| S1_SPAN | `span_count > 0`（生成）+ 可选 fixture 覆盖 | `spanCount` / spans | Exact Sentence 判 Span「正确」 |
| S2_LOOKUP | **仅当 trace 可用**：recallHits 含 fixture；否则 **Metrics=NULL + reason=lookup_trace_unavailable`** | recallHits* / summary | Dump/Exact |
| S3_ASSEMBLY | `generated_sentence_count≥1`；fixture∈Generated（若有 allCombinations） | combinationCount · allCombinations | Exact Sentence · Final |
| S4_DUMP | `dump_candidate_count`；fixture∈Dump（标注 dump） | topCandidates | 不得叫 Assembly Success |
| S5_KENLM | `!pickedIsRaw` 或 gate 关系；picked 文本 | pickedIsRaw · maxDelta · picked | Dump Top5 列表成败 |
| S6_APPLY | `apply_count>0` | appliedCount | Exact |
| S7_FINAL | `final_exact` | text_asr vs expected | 不得回写 Assembly |

**S2_LOOKUP：** Runtime 在 **summary** 模式无词级 Lookup Success。  
→ **Decision Constraint：** 无 trace 时 Lookup Stage **不得伪造成功/失败**，必须显式 `unavailable`。  
**来源：** Code Implementation · Design Gap

### MAP-3 · 删除旧 Funnel 共享布尔（DELETE）

| 删除项 | 原因 |
|--------|------|
| `Stage5 = Stage2 sentence` | 违反 Stage 独立（Audit §8） |
| `Recall Hit = kw\|exact∈Dump` 作为 Recall SSOT | 混 Assembly+Dump+Exact |
| `primaryOwner` 基于投影猜测链 | 须改为基于 MAP-2 缺失的第一 Stage |

---

## 4. Decision Constraints（Ownership）

### OWN-1 · Primary Owner 仅按 Stage 顺序首次失败（MODIFY）

顺序：`S0 → S1 → S2(if available) → S3 → S5 → S6 → S7`  
（S4 Dump **不参与 Ownership**，只报告观测。）

规则：

1. 取 MAP-2 独立字段。  
2. 第一个失败 Stage = Primary Owner。  
3. `S2=unavailable` 时 **跳过**，不得默认 Owner=Recall。  
4. Exact Final 失败但 Generated 已含 fixture term → Owner ≠ Assembly（倾向 KenLM/Apply/Final）。

**来源：** Audit Ownership Drift · 提示词 §十二

---

## 5. 提示词条款 KEEP / MODIFY / RESTORE / DELETE

| 提示词章节 | 裁决 | 说明 |
|------------|------|------|
| §一 开发原则 · 只映射 Runtime | **KEEP** | |
| §二 唯一 SSOT 链 | **KEEP** | |
| §三 统一 Funnel 到 Runtime | **KEEP** 目标；**MODIFY** 实现须经 MAP-2 |
| §四 Stage Mapping 示例表 | **MODIFY** | spanCount≠Success；pickedIsRaw 极性；补 allCombinations/appliedCount |
| §五 Generated vs Dump | **KEEP** | 补 DC-3 Trace 前提 |
| §六 Stage 独立 | **KEEP** | DELETE 旧共享布尔 |
| §七 Assembly Metrics | **KEEP** 方向；**MODIFY** Generated Term 依赖 allCombinations |
| §八 Domain Term | **MODIFY** → Fixture Overlay，非 Runtime |
| §九 KenLM Metrics | **KEEP**；强调不用 Dump 判 KenLM |
| §十 三套 TopK | **KEEP** | |
| §十一 Success Funnel 链含 Lookup | **MODIFY** | Lookup 仅 trace；否则 unavailable |
| §十二 Ownership | **KEEP** 方向；接 OWN-1 |
| §十三 文档统一 | **KEEP** | Funnel 文档降级 Consumer |
| §十四 兼容 · 不改 Runtime 接口 | **KEEP** | 允许 Metrics run 改 **diagnostics level 配置** |
| §十五 重跑 Funnel | **MODIFY** | 必须用新 Mapping 脚本 + trace；禁止旧 analyze 脚本作为 SSOT |
| §十六–十七 Verdict | **延后到开发报告** | 本 Supplement 不给 A/B/C 开发 Verdict |

---

## 6. Regression

| ID | 回归点 | 期望 |
|----|--------|------|
| R1 | `freeze-contract` / diagnostics 字段语义 | 不变 |
| R2 | KenLM Gate 3.0 · pick 逻辑 | 不变 |
| R3 | Assembly / Recall / FW | 零 diff |
| R4 | 旧 `success_funnel_analysis.json` | 标记 `deprecated_non_ssot`；不得覆盖新 SSOT 报告 |
| R5 | 批测开启 `level=trace` 后体积 | 允许变大；须文档声明 |

---

## 7. Acceptance（进入开发完成线）

Metrics Layer 开发报告判 **PASS（对齐提示词 Final A）** 当且仅当：

1. **Runtime 是唯一 SSOT** — 文档明确；Funnel 不再自称 SSOT。  
2. **Mapping 表唯一** — 见 MAP-1；无重复业务定义。  
3. **Generated ≠ Dump** — 报告分列；Stage 不共享布尔。  
4. **Assembly Metrics** 不依赖 Exact Sentence Success。  
5. **KenLM Metrics** 使用 `pickedIsRaw`/`maxDelta`/`allCombinationDeltas`/`picked`，不以 Dump Top5 成败代替。  
6. **Domain Term**（若报告）标注 Fixture Overlay。  
7. **Lookup** 无 trace 时为 `unavailable`，不伪造。  
8. **Ownership** 仅 OWN-1。  
9. **不修改** Repair / Recall / Assembly / KenLM / FW 业务代码（配置 trace 除外）。  
10. 重跑的「Success Funnel」脚本 **只读映射**，文件头写死 Runtime 字段引用表。

未满足 → 开发报告只能 **B/C**，**不得**宣称可进 KenLM Corpus Audit。

---

## 8. Hidden Premises（隐藏前提 · 必须显式）

| # | 前提 | 若忽略则 |
|---|------|----------|
| H1 | Full Generated 文本需要 `diagnosticsLevel=trace` | 退回 Top5 Dump，双口径复发 |
| H2 | Fixture terms 非 Runtime | Domain Term「成功率」不可与 Runtime 字段并列冒充 |
| H3 | `fw.triggered` ≠ Domain Vote 科学 before/after | Domain 过滤审计仍可能 UNAVAILABLE |
| H4 | `spanCount` ≠ Span「正确」 | Span Ownership 仍弱 |
| H5 | 旧 E2E JSON（summary）不能完整重放 Generated 覆盖 | 须 **新跑** Metrics corpus 或接受能力降级为 B |

---

## 9. Test Blind Spots

| 盲区 | 风险 | Acceptance 要求 |
|------|------|-----------------|
| 无单测断言「Funnel 不得用 exact 作 Assembly」 | 回归回潮 | Mapping 脚本 golden fixture |
| Trace 仅 targetIds=d001/d048 | 全库 allCombinations 空 | Metrics run 要求 targetIds=[] |
| `kenlmLayer` A/B/C 仍写入 | 被误当 Stage | 文档 DELETE 出 Ownership |

---

## 10. Future Drift Risk

| 风险 | 缓解 |
|------|------|
| 再次把 Audit MD 写成 SSOT | diagnostics/FROZEN + 本 Supplement 优先 |
| 为 Domain Term 改 Runtime schema | 禁止；仅 Fixture Overlay |
| 为消除 Top5 改 `rerank-fw-sentences` dump | 属 Runtime 行为变更 → **超出本轮**；用 allCombinations |

---

## 11. Target List（开发阶段允许动的文件 · 预告）

**允许（Metrics Layer only）：**

- `tests/experiments/run-asr-e2e-quality-validation.mjs`（projection pass-through + trace level）  
- 新/改 `analyze-*-metrics-ssot*.mjs`（替换旧 Funnel 分析入口）  
- `docs/fw-detector/diagnostics/FROZEN.md` · `INTERFACE_FREEZE.md`（Metrics Consumer 附录，**不改**字段语义）  
- `docs/fw-detector/ARCHITECTURE.md`（Metrics 箭头说明）  
- `docs/tone-v2/*Funnel*` / Metrics Mapping 文档（降级 + 重映）  
- 输出：`Lingua_Metrics_Layer_SSOT_Alignment_Development_Report_2026_07_14.md`

**禁止：**

- `span-assembly-*` · `recall-*` · `kenlm/rerank-*` pick 逻辑 · FW 主链  
- 改变 `topCandidates.slice(0,5)` 业务路径（除非未来独立 RFC）

---

## 12. Check List（开发前勾选）

- [ ] 已读本 Supplement DC/IC/MAP/OWN  
- [ ] Metrics run 配置 `level=trace`、`targetIds=[]`  
- [ ] Projection 包含 `allCombinations` + `allCombinationDeltas`  
- [ ] Mapping 表无 spanCount=Success / pickedIsRaw=Applied 错误  
- [ ] Fixture Overlay 与 Runtime 字段分栏  
- [ ] 旧 Funnel 脚本标记 deprecated  
- [ ] 零业务逻辑 diff（git path 审查）

---

## 13. Supplement Verdict

| 对提示词 | 结论 |
|----------|------|
| 方向 | **可进入开发**（仅 Metrics Layer） |
| 原文直接实施 | **不可** — 须先套用本文件 KEEP/MODIFY/RESTORE/DELETE |
| 冻结设计 | **未改变**；仅补契约与消费约束 |

**本文件不替代 Development Report，也不给出 KenLM Corpus Audit 开闸令。**  
开闸条件见 §7 Acceptance；完成后由 Development Report 输出 Final Verdict A/B/C。
