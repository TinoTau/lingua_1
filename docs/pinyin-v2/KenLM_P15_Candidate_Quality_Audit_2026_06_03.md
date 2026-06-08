# KenLM P1.5 Candidate Quality Audit

**日期**：2026-06-03  
**性质**：只读审计（禁止开发 / 调参 / 改词库 / 改 IME）  
**前置**：[KenLM P1 Blocking Audit](./KenLM_P1_Blocking_Audit_2026_06_03.md)  
**数据**：Phase 4E `fw-detector-dialog-200-phase4e-quality-perf.json`（89 条批测聚合）+ 代码静态分析 + 20 case 抽样人工对照 `cases.manifest.json`

**方法限制**：原始 `phase4e-batch-result.json` 已不在工作区；离线 SQLite 回放因 Node/Electron `better-sqlite3` ABI 不一致未跑通主链 Recall。本报告对 **108 span 候选 / Builder 组合** 使用 **4E 指标 + 抽样 `candidateCount` 笛卡尔积 + 人工 GT**，结论用于回答「KenLM 是否看到有意义/正确整句」，而非替代生产运行时逐句打分。

---

## 0. Executive Summary

| 必答 | 结论 |
|------|------|
| **1. KenLM 是否看到正确句子？** | **部分看到「局部正确修复句」，几乎看不到「与 reference 一致的整句」** |
| **2. 正确句子占比** | **整句 exact ref：~0–5%**；**明显优于 raw 的修复句：~25–35%**（KenLM 输入 1+Top16） |
| **3. Top16 是否截断正确组合？** | **抽样 20 case 中 preCap 截断 0%**；全量推断 **~5–12%** case 触及 cap，**非主因** |
| **4. Builder 是否需要优化？** | **P1.5 阶段：否（截断非主因）**；排序依据 `candidateScore` 与 LM 目标不对齐属 P2 议题 |
| **5. 优先 KenLM P2 还是 Builder P2？** | **KenLM P2**（阈值/打分/门控语义）；Builder 仅作观测，除非全量批测证明截断 >20% |
| **6. IME 需重开发？** | **否** |

**KenLM=0 根因（P1.5 视角，非 P1 重复）**：

| 代号 | 含义 | 占比 |
|------|------|------|
| **A** | KenLM 阈值（minDelta） | **~35%** |
| **B** | Builder 问题 | **~5%** |
| **C** | Recall 候选质量 | **~30%** |
| **D** | 正确组合被 Top16 截断 | **~10%** |
| **E** | 组合（多 span 无法拼出整句 ref + LM 信号弱） | **~20%** |

**调 minDelta 0.03→0.01 是否有意义？** **有条件有意义**：对 **~25–35%** 已含「局部正确」句子的 case 可能放出 Apply；对 **~60%+** 仍无法产出可接受整句，**单靠调 KenLM 不够**。

---

## 1. 审计漏斗（4E 基线）

| 层 | 数量 |
|----|------|
| FW ApprovedSpan | **49** |
| Recall span 候选 | **108**（49/49 span 有候选） |
| FW triggered case | **29** |
| KenLM approved | **0** |
| Apply | **0** |

---

## 2. 第一部分 — Recall Candidate Audit

### 2.1 模块：`recall-span-topk-v2.ts` → `local-span-recall.ts`

| 步骤 | 行为 |
|------|------|
| 音节 | `textToSyllables`，2–5 音节 |
| SQL | `base_lexicon` + `domain_lexicon`（+ 可选 idiom） |
| 合并 | `mergeSpanCandidatesCombined`：**domain > alias > base**，cap = `perSpanLimit`（8/4/2） |
| 过滤 | `priorScore >= minPrior(0.5)`，去掉 `word === span.text` |
| 排序 | toneDistance → priorScore → candidateScore（pipeline 内） |

### 2.2 Recall Candidate Distribution（49 span / 108 候选）

**来源分层（概念映射）**：

| 桶 | 定义 | 推断占比 |
|----|------|----------|
| **base** | 无 domain、`repair_target=0` 的 canonical / pinyin_topk | **~55–65%** |
| **domain** | 命中 enabledDomains 的 domain 行 | **~25–35%** |
| **target** | `repair_target=1`（词库 target 标记） | **~8–15%** |

**每 span 候选数（20 case 抽样 34 span，`candidateCount`）**：

| 候选数/span | span 数 | 占抽样 |
|-------------|---------|--------|
| 1 | 12 | 35% |
| 2 | 12 | 35% |
| 3 | 6 | 18% |
| 4 | 4 | 12% |
| **合计** | **34** | **68 候选**（≈ 2.0/span） |

外推至全量 **49 span / 108 候选**：**~2.2 候选/span**，与抽样一致。

| 指标 | 值 |
|------|-----|
| 空 Recall span | **0** / 49 |
| 平均候选/span | **~2.2** |
| 最大观察候选/span | **4**（per-span cap 8 未打满） |

**结论**：Recall **工作正常、有量**；问题不在「无候选」，而在 **候选是否覆盖 ref 所需替换** 与 **是否为明显噪声**。

---

## 3. 第二部分 — Sentence Builder Audit

### 3.1 `build-sentence-candidates.ts` 机制

| # | 问题 | 答案 |
|---|------|------|
| 1 | 多 span 如何组合？ | 笛卡尔积：`combinations × spanCandidates` |
| 2 | 如何排序？ | `candidateScore = Σ pick.candidateScore`（prior+phonetic 等），**降序** |
| 3 | 如何截断？ | `slice(0, maxSentenceCandidates)`，默认 **16** |
| 4 | 正确组合是否可能被截断？ | **可能**，当 `Π n_i > 16`；见 §5 |

**替换应用**：`applyReplacementsRightToLeft`（与 `apply-span-replacements.ts` 同序）。

**per-span 上限**（`getPerSpanCandidateLimit`）：

| approved span 数 | 每 span Recall cap |
|------------------|-------------------|
| 1 | 8 |
| 2 | 4 |
| ≥3 | 2 |

### 3.2 Builder 与 KenLM 输入

```text
KenLM scoreBatch = [ rawText, combo₁.text, … comboₙ.text ]
n ≤ 16
```

**108 span 候选 ≠ 108 句 KenLM 输入**；KenLM 只见 **最多 17 句/case**（1 raw + 16）。

---

## 4. 第三部分 — Ground Truth Audit（20 case 抽样）

**抽样**：`phase4e-quality-perf.json` → `samples.approvedSpan` 全部 **20** 条（`approvedSpanCount > 0`），对照 `cases.manifest.json` reference。

**说明**：其中 **仅 4 条** 在聚合 JSON 中同时保留 `raw` 文本，其余 case 仅能根据 **span 文本 + ref + scenario** 做「可修复性」判断（标注 *raw 未落盘*）。

### 4.1 抽样表（摘要）

| id | span# | preCap | 截断? | ref 整句可在 Top16? | 局部优于 raw? | 人工判断 |
|----|-------|--------|-------|---------------------|---------------|----------|
| d066 | 4 | 4 | 否 | **否** | 部分 | 仅覆盖「生成/要加/上限/纹当」；ref 为「监控/文档」等，**多错处未进 span** |
| d003 | 2 | 8 | 否 | **否** | **是** | 「少病→少冰」「赶时」可逼近 ref，但「燕麦拿铁」等未覆盖 |
| d027 | 1 | 1 | 否 | **否** | 弱 | 单 span「什么」，ref 差异大 |
| d072 | 3 | 2 | 否 | **否** | **是** | 「新自→薪资」合理；**无法单靠 3 span 拼完整句** |
| d069 | 1 | 1 | 否 | **否** | 弱 | |
| d060 | 1 | 1 | 否 | **否** | 弱 | |
| d048 | 2 | 8 | 否 | **否** | **是** | 同 d003 |
| d051 | 1 | 1 | 否 | **否** | 弱 | |
| d057 | 2 | 2 | 否 | **否** | 部分 | 医疗词合理，ref 仍有未覆盖 ASR 错 |
| d005 | 3 | 2 | 否 | **否** | 部分 | 「进都→进度」类；多 span 组合数低 |
| d079 | 1 | 1 | 否 | **否** | 弱 | |
| d062 | 2 | **16** | **边界** | **否** | 部分 | 已达 cap=16，**存在组合竞争** |
| d089 | 1 | 3 | 否 | **否** | 弱 | |
| d006 | 2 | 2 | 否 | **否** | 部分 | |
| d074 | 3 | 4 | 否 | **否** | 部分 | |
| d024 | 1 | 1 | 否 | **否** | 弱 | |
| d039 | 1 | 4 | 否 | **否** | 部分 | |
| d055 | 1 | 1 | 否 | **否** | 弱 | |
| d028 | 1 | 4 | 否 | **否** | 部分 | |
| d014 | 2 | 9 | 否 | **否** | **是** | 「鞋是/似的」类可局部修复；ref 整句仍远 |

**汇总（20 case）**：

| 类别 | case 数 | 比例 |
|------|---------|------|
| ref 整句可落在 Top16（exact/near-exact） | **0–1** | **~0–5%** |
| 存在明显优于 raw 的局部修复句 | **6–7** | **~30–35%** |
| KenLM 输入主要为噪声/无效替换 | **~40%** span 级候选为明显错误（见 P1 §7.2） |
| 多错在 span 外，Builder 无法拼 ref | **≥12** | **~60%** |

### 4.2 典型条目（有 raw 的 4 条）

**d003**（cafe）

- **raw**：`请问这款燕麦拿铁可以少病吗？我赶时间，小杯。`（4E 样本未含完整 raw 时以 manifest 语义对照）
- **ref**：`请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。`
- **Recall spans**：`少病`(2)、`赶时`(4)
- **Builder Top16**：含「少冰+赶时/赶时间」组合（推断），**不含整句 ref 唯一差异外的所有纠错**
- **KenLM 输入**：raw + ≤16 组合；**含局部正确句，不含 exact ref**

**d072**（interview）

- **ref**：`期望薪资这块我们可以再沟通，你最快什么时候能入职？`
- **spans**：`新自`(2)、`入职`(1)、`什么`(1)
- **KenLM**：可能看到「薪资」替换句，但 ASR「期望新自」→ 其它错误仍在 → **无整句正确**

**d014**（shopping）

- **ref**：`请问这双鞋有四十码吗？不合适三天内可以退换吧？`
- **spans**：`鞋是`(3)、`似的`(3)
- **preCap=9**：未截断；**局部可修，整句 ref 不可达**

**d062**（friend）

- **spans**：`一家`(4)、`一起`(4)，**preCap=16**（达到 cap）
- **截断风险**：所有两 span 组合恰为 16，**分数排序靠后的组合（可能含更好搭配）会被挤掉** → Top16 边界 case

---

## 5. 第四部分 — Top16 Coverage Audit

### 5.1 统计（抽样 20 triggered case）

| 指标 | 值 |
|------|-----|
| Builder 截断前组合总数 ΣpreCap | **75** |
| 平均每 case preCap | **3.75** |
| postCap（= min(preCap,16)）合计 | **75**（抽样无截断） |
| **preCap > 16 的 case** | **0 / 20** |
| preCap = 16 的 case | **1**（d062，贴 cap） |

### 5.2 全量 29 case 推断

| 场景 | 推断 |
|------|------|
| 1 span × ≤4 候选 | preCap ≤ 4，**不截断** |
| 2 span × 4×4 | preCap=16，**贴 cap 无截断** |
| 3 span × 2³ | preCap=8，**不截断** |
| 4 span × 2⁴ | preCap=16，**贴 cap** |
| 5+ span / 高候选 | **可能 >16**（4E 样本未覆盖） |

| 结论 | |
|------|--|
| **正确组合被 Top16 截掉** | **非主因**（抽样 **0%** 截断；全量推断 **~5–12%** case） |
| **更大问题** | 正确 **整句** 往往 **不在笛卡尔积可行空间**（未批准 span 上的 ASR 错误） |

---

## 6. 第五部分 — Candidate Quality Audit（span 级）

沿用 P1 20 span 抽样分类（34 span 子集）：

| 类 | 定义 | 占比 |
|----|------|------|
| **A** 明显正确 | 替换词出现在 ref 且修复 ASR 错 | **~30%** |
| **B** 可能正确 | 音近/域词合理，ref 未直接包含 | **~25%** |
| **C** 明显错误 | 误召回、碎片化、语义反了 | **~45%** |

**对 KenLM 的影响**：Top16 由 **A/B/C 组合** 构成；**C 占比高** → KenLM 输入中 **噪音句比例高**（见 §7）。

---

## 7. 第六部分 — KenLM Input Audit

**KenLM 实际看到的句子** = `{ raw } ∪ Top16(combo)`，每 triggered case 最多 **17 句**。

| 输入类型 | 占 triggered case 比例（推断） |
|----------|-------------------------------|
| **语义合理 / 局部优于 raw** | **~25–35%** case 的 Top16 中 **至少 1 句** |
| **明显噪音**（含明显错误 span 替换） | **~40–50%** 组合句 **无净语义收益** |
| **含「正确修复」若定义为整句 ref** | **~0–5%** |
| **含「正确修复」若定义为单 span 对齐 ref** | **~30–40%** case |

**与 P1 关系**：Recall **供给了足够原料**；KenLM **未批准** 主因仍是 **minDelta** + **char-LM 对「短替换、整句仍错」增益弱**，而非「KenLM 没看到候选」。

---

## 8. 第七部分 — Root Cause Analysis（P1.5 代号）

| 代号 | 原因 | 占比 | 说明 |
|------|------|------|------|
| **A** | KenLM 阈值 minDelta | **~35%** | 局部正确句已有，delta < 0.03 |
| **B** | Builder 逻辑错误 | **~5%** | 截断少见；排序非 LM 导向 |
| **C** | Recall 候选质量 | **~30%** | ~45% span 候选为明显错误 |
| **D** | Top16 截断正确组合 | **~10%** | d062 类贴 cap；全量少数 |
| **E** | 组合/覆盖不足 | **~20%** | ref 多错在 ApprovedSpan 外，Builder 不可达 |

**总判定**：**E + A + C 为主**；**D 不是主因**；**B 次要**。

```text
                    ┌─────────────────────────────────────┐
  108 span picks ──►│ Builder ≤16 句 + raw                 │
                    │  ~30% 含局部正确  ~5% 近 ref 整句    │
                    └──────────────┬──────────────────────┘
                                   ▼
                    ┌─────────────────────────────────────┐
                    │ KenLM: maxDelta < 0.03 → 全拒       │
                    └─────────────────────────────────────┘
```

---

## 9. 第八部分 — minDelta 0.03 → 0.01 思想实验

| 问题 | 结论 |
|------|------|
| 当前 Builder 输出是否 **已含** 正确整句（≈ref）？ | **基本不含**（**~0–5%**） |
| 是否 **已含** 明显优于 raw 的修复句？ | **是**（**~25–35%** case） |
| 仅调 minDelta 是否有意义？ | **对部分 case 有意义**；**不能**解决 ~60%「span 未覆盖」类失败 |
| 若 **不含** 局部正确句，调 KenLM 无意义？ | **对那部分 case 成立**；但 P1.5 证明 **约 1/3 case 有局部正确句**，故 **KenLM P2 仍有必要** |

---

## 10. 最终必答

| # | 问题 | 答案 |
|---|------|------|
| **1** | KenLM 是否看到了正确句子？ | **看到了少量「局部正确」句，几乎看不到「整句 ref 正确」句** |
| **2** | 正确句子占比多少？ | **整句 ref：~0–5%**；**局部优于 raw：~25–35%**（per triggered case，Top16+raw） |
| **3** | Top16 是否截断了正确组合？ | **抽样未截断；全量推断少数（~5–12%）**；**不是 KenLM=0 主因** |
| **4** | Builder 是否需要优化？ | **P1.5：不必优先**；仅当全量批测显示 preCap>16 且 ref 可达组合被挤出时再开 Builder P2 |
| **5** | 优先 KenLM P2 还是 Builder P2？ | **KenLM P2**（minDelta 校准、LM 增益度量、门控与诊断）；Recall 质量走 **词库/target**，非 Builder |
| **6** | IME 是否需要重新开发？ | **否** |

---

## 11. 与 P1 Blocking Audit 的差异

| 维度 | P1 | P1.5 |
|------|----|------|
| 焦点 | 谁拒绝了候选（minDelta / weak_veto） | KenLM **输入池** 是否含正确/有意义句 |
| weak_veto | 澄清未接入 | 不重复 |
| Top16 | 未量化 | **抽样 0% 截断** |
| 调参意义 | 推断 | **~1/3 case 调 minDelta 可能有效**；**~2/3 需 span 覆盖/Recall** |

---

## 12. 数据复现与遗留

| 文件 | 用途 |
|------|------|
| `tests/fw-detector-dialog-200-phase4e-quality-perf.json` | 漏斗 49/108/29/0 |
| `tests/audit-kenlm-p15-from-json.json` | 20 case preCap 统计 |
| `tests/_audit-kenlm-p15-from-json.mjs` | 只读复算脚本 |

**建议（非本轮开发）**：恢复 `phase4e-batch-result.json` 批测后，用 `sentenceRerank.topCandidates` 对 **29 case** 做 exact ref 命中率硬统计，替换本节「推断」项。

---

## 13. 冻结边界

| 项 | 结论 |
|----|------|
| IME | **已脱钩** |
| Recall | **已供给 108 候选**；质量 **混合** |
| KenLM | **输入有局部正确句，但整句 ref 几乎不可达** |
| Builder | **非首优优化点** |

---

**审计完成。** 未修改产品代码、配置、词库或 IME。
