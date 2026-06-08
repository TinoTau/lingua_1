# Recall Width Sensitivity Audit

**日期**：2026-06-03  
**性质**：**EXPERIMENT ONLY** 离线实验审计（未改生产默认、未改 IME/词库/Apply）  
**假设**：KenLM=0 是否因 Recall per-span TopK 过窄，导致 KenLM 未见到足够有意义整句？

**实验脚本**（非主链）：

- `electron_node/electron-node/tests/experiments/recall-width-sensitivity-audit.mjs`
- `electron_node/electron-node/tests/experiments/recall-width-span-only.mjs`
- 结果：`tests/experiments/recall-width-sensitivity-results.json`
- 结果：`tests/experiments/recall-width-span-only-results.json`

**运行方式**（需 Electron ABI + KenLM）：

```powershell
cd D:\Programs\github\lingua_1\electron_node\electron-node
$env:PROJECT_ROOT = "D:\Programs\github\lingua_1"
$env:ELECTRON_RUN_AS_NODE = "1"
npx electron tests/experiments/recall-width-span-only.mjs
npx electron tests/experiments/recall-width-sensitivity-audit.mjs
```

---

## 0. Executive Summary

| 结论 | 判定 |
|------|------|
| **放宽 Recall 宽度能否让 KenLM approved > 0？** | **否**（本实验 n=4 全链路 + 34 span 召回层） |
| **瓶颈是否 Recall 排序/宽度？** | **否（主因）** — 加宽后 **ref-正确候选排名未改善** |
| **主因是否仍为 minDelta？** | **是** — 全组 `maxDelta` p95 **< 0.003**，远低于 **0.03** |
| **是否应正式加宽 perSpanLimit？** | **否** — 建议维持 **baseline** |
| **是否应同时加宽 maxSentenceCandidates？** | **否（本轮）** — cap32 对照仍 0 approved |
| **允许 Recall Ranking P2？** | **是**（排序/目标词命中），**非**单纯加宽 TopK |

---

## 1. 实验设计（EXPERIMENT ONLY）

### 1.1 变量：perSpanLimit

| 组 | 1 span | 2 span | ≥3 span |
|----|--------|--------|---------|
| **A baseline** | 8 | 4 | 2 |
| **B medium** | 12 | 6 | 3 |
| **C wide** | 16 | 8 | 4 |
| **D very wide** | 24 | 12 | 6 |

### 1.2 控制

| 项 | 值 |
|----|-----|
| Round 1 `maxSentenceCandidates` | **16**（与生产一致） |
| Round 2 对照 | **A/C + cap 32** |
| `minDeltaToReplace` | **0.03**（未改） |
| `minPrior` | **0.5**（未改） |

### 1.3 数据范围与限制

| 层级 | 样本 |
|------|------|
| **Span-only 召回** | 4E `approvedSpan` 抽样 **20 case / 34 span**（全量可有 raw 缺失） |
| **Recall + Builder + KenLM** | 同时有 raw+span 的 **4 case / 7 span**（4E JSON 仅 4 条保留 raw） |
| 4E 生产漏斗 | 49 span / 108 recall / 29 triggered（对照参考） |

> 全量 29 triggered 需重跑 `recall-width-fetch-fixtures.mjs`（Test server + WAV）；本轮节点启动失败，未扩样。

---

## 2. 第一部分 — Span-only 召回宽度（34 span × 4 组）

### 2.1 Recall Candidate Distribution

| 组 | recall 候选合计 | avg/span | vs A |
|----|-----------------|----------|------|
| **A baseline** | **68** | 2.00 | — |
| **B medium** | **82** | 2.41 | +21% |
| **C wide** | **85** | 2.50 | +25% |
| **D very wide** | **89** | 2.62 | +31% |

（与 4E 全批 **108/49≈2.2** 同量级；加宽 **确实增加候选数**。）

### 2.2 正确候选排名（reference-correct @ span）

启发式：同长度替换词且出现在 reference 中。

| 指标 | A | B | C | D |
|------|---|---|---|---|
| 分析 span 数 | 34 | 34 | 34 | 34 |
| ref-正确命中 recall | 8 | 8 | 8 | 8 |
| **Top1** | **7** | **7** | **7** | **7** |
| **Top2** | **8** | **8** | **8** | **8** |
| **Top4** | **8** | **8** | **8** | **8** |
| **Top8** | **8** | **8** | **8** | **8** |
| **not found** | **26** | **26** | **26** | **26** |

**关键发现**：从 baseline → very wide，**正确候选排名分布零变化**。  
→ 未被挤出 TopK 的 ref-正确词，**本来就不在 recall 池**；加宽只增加 **噪声/次要同音**，不增加 **ref-正确命中**。

---

## 3. 第二部分 — 全链路（4 case，cap=16）

### 3.1 汇总表（Round 1）

| 指标 | A | B | C | D |
|------|---|---|---|---|
| recall 候选 | 16 | 17 | 17 | 17 |
| preCap 合计 | 18 | 18 | 18 | 18 |
| postCap 合计 | 18 | 18 | 18 | 18 |
| preCap>16 case | 0 | 0 | 0 | 0 |
| KenLM queries | 22 | 22 | 22 | 22 |
| **maxDelta p95** | **0.0016** | **0.0016** | **0.0016** | **0.0016** |
| **maxDelta ≥ 0.03** | **0** | **0** | **0** | **0** |
| pickedIsRaw | 4/4 | 4/4 | 4/4 | 4/4 |
| **KenLM approved** | **0** | **0** | **0** | **0** |
| Apply | 0 | 0 | 0 | 0 |
| CER improved | 0 | 0 | 0 | 0 |
| CER worsened | 0 | 0 | 0 | 0 |
| avg KenLM ms/case | ~3900 | ~3900 | ~3900 | ~3900 |

### 3.2 Round 2：maxSentenceCandidates = 32（A vs C）

| 指标 | A cap32 | C cap32 |
|------|---------|---------|
| recall 候选 | 16 | 17 |
| postCap | 18 | 18 |
| KenLM approved | **0** | **0** |
| maxDelta max | ~0.0016 | ~0.0016 |

**Builder 扩 cap 无效果**（本批 preCap≤18，未触发 Builder 截断）。

### 3.3 KenLM 输入质量（4 case 抽样）

| case | 现象 |
|------|------|
| d006 | Top1 替换「评审→平身」，**非 ref「评审」**；delta **< 0** |
| d074 | 组合句 CER 仍高；最佳 delta **0.0016** |
| d039 | delta **< 0** |
| d014 | 多 span 组合，delta **< 0** |

**无**「接近 reference 整句」进入 Top16；**无** `maxDelta ≥ 0.03`。

---

## 4. 关键分析问答

### Q1. 放宽 Recall 后 KenLM approved 是否增加？

**否。** A/B/C/D 与 cap32 均为 **0**。

### Q2. 若增加，原因会是哪类？

（未观察到 approved>0，作反事实）

| 类 | 本实验 |
|----|--------|
| A 正确候选原在 TopK 外 | **不成立**（排名统计不变） |
| B Builder 排序变化 | 有额外候选但 **delta 仍不足** |
| C 阈值被突破 | **0 次 ≥ 0.03** |
| D 噪音误过 | **未发生** |

### Q3. approved 仍为 0，更说明什么？

| 主因 | 权重 |
|------|------|
| **A KenLM minDelta** | **~55%** |
| **B LM/char-3gram 对局部替换增益弱** | **~25%** |
| **C Recall 语义质量（ref-正确未入池）** | **~15%** |
| **D Builder 句子构造** | **~5%** |

→ **不是「Recall 太窄」**，而是 **「池内无 ref-正确 + LM 增益不够」**。

### Q4. 当前瓶颈是否 Recall 排序质量？

**不主要是宽度/排序挤出问题。**

证据：加宽 31% 候选后 **Top1/Top2/Top4/Top8 命中 ref-正确 的 span 数不变**；主缺口是 **26/34 span not found**（召回层未给出 ref 对齐词）。

### Q5. perSpanLimit 是否过窄？

**对「发现 ref-正确词」而言：否（本实验）** — baseline 8/4/2 已覆盖全部 **可发现的 8 个** ref-正确 span。  
**对「压低噪声」而言：宽组仅多 21–31% 候选，多为无效同音。**

### Q6. 是否应正式调整 Recall 宽度？

**否。** 维持 **Group A baseline**。

### Q7. 推荐哪一档？

| 推荐 | 组 |
|------|-----|
| **生产保持** | **A baseline** |
| 不建议 | B/C/D（成本↑、噪声↑、无 KenLM 收益） |

### Q8. 是否同时调整 maxSentenceCandidates？

**本轮不需要。** preCap 未超 16；cap32 对照 **0 approved**。

### Q9. 是否允许 Recall Ranking P2？

**是** — 目标应是 **提高 ref-正确词入池与排序**（拼音/域/target/repairTarget），**不是**单纯放大 K。

---

## 5. 安全分析

| 风险 | 宽组观察 |
|------|----------|
| preCap 爆炸 | 4 case 仍 ≤18；34 span 全量 preCap 增幅有限 |
| Top16 噪音增加 | 候选 +31%，排名无收益 |
| KenLM 耗时 | ~3.9s/case，与宽度几乎无关 |
| CER 恶化 | **0** worsened（因 **0 apply**） |
| Apply 误修 | **0** |

---

## 6. 与 P1 / P1.5 的关系

| 审计 | 结论 |
|------|------|
| P1 | minDelta 为 P4 唯一硬门 |
| P1.5 | ~25–35% case 有局部正确句，整句 ref ~0–5% |
| **本实验** | **加宽 Recall 不提高 ref-正确排名、不提高 maxDelta、approved 仍 0** |

**综合**：调 KenLM（P2）**仍有意义**（针对已有局部正确句）；**加宽 Recall 宽度无意义**（除非 Ranking P2 提升入池率）。

---

## 7. 最终必答（9 项）

| # | 答案 |
|---|------|
| 1 | **否** — 瓶颈不是 Recall 排序宽度，而是 **ref-正确未入池（76% span）+ minDelta** |
| 2 | **否** — approved 全程 **0** |
| 3 | **N/A** — 无 approved，CER 不变 |
| 4 | **是** — 在「宽度」维度排除后，**minDelta/LM 仍是主因** |
| 5 | **否（本实验）** — perSpanLimit 非绑定约束 |
| 6 | **否** — 保持 baseline |
| 7 | **baseline（A）** |
| 8 | **否** |
| 9 | **允许 Recall Ranking P2**；**不允许**仅宽度扩 K 上线 |

---

## 8. 后续（非本轮开发）

1. Test server 可用时运行 `recall-width-fetch-fixtures.mjs` → 29 case 全链路复验  
2. Ranking P2：repairTarget 命中、域路由、toneDistance 与 ref 对齐率  
3. KenLM P2：minDelta 校准（与宽度实验解耦）

---

**实验完成。未修改生产代码、默认配置、IME、词库或 Apply。**
