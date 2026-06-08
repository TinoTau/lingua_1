# Recall Candidate Dump Audit

**日期**：2026-06-03  
**性质**：只读审计（禁止开发 / 调参 / 改词库 / 改 IME）  
**目标**：直接输出 Phase 4E ApprovedSpan 的 **Recall 到底召回了什么**（完整 TopK 列表）

**脚本**：`electron_node/electron-node/tests/experiments/recall-candidate-dump-audit.mjs`  
**数据 JSON**：`tests/experiments/recall-candidate-dump-audit-data.json`

---

## 0. 数据范围说明

| 项 | 值 |
|----|----|
| 4E 漏斗 ApprovedSpan | **49** |
| 本报告可回放 span（`samples.approvedSpan` 有 span 文本） | **34** |
| 缺失 span 明细（批测 JSON 未落盘） | **15** |
| 覆盖 case 数 | **20** / 29 triggered |

> 原始 `phase4e-batch-result.json` 不在工作区；span 文本来自 `fw-detector-dialog-200-phase4e-quality-perf.json` → `samples.approvedSpan`。  
> 全量 49 span 需重跑批测或 Test server fixtures。

---

## 1. Executive Summary（baseline A）

| 指标 | 值 |
|------|----|
| 需要替换的 span（ref 存在同长异文目标） | 34 / 34 |
| 正确答案进入 Recall 池 | **8** / 34 |
| NOT_FOUND | **26** / 34（76.5%） |
| 进入 Recall 后的平均排名 | **1** |
| Top1 / Top2 / Top4 / Top8 / Top16 命中 | 8 / 8 / 8 / 8 / 8 |

---

## 2. 必答问题

### Q1 — 49 个 ApprovedSpan 中，正确答案有多少进入 Recall？

- **可观测 34 span（baseline）**：**8** 进入 Recall，**26** NOT_FOUND。  
- **外推至 49 span**（按相同 NOT_FOUND 率 76.5%）：约 **12** 进入 / **37** NOT_FOUND。

### Q2 — 正确答案平均排名多少？

- 在已进入 Recall 的 span 上：**1**（baseline A）。

### Q3 — NOT_FOUND 比例多少？

- 可观测样本：**76.5%**（26/34）。

### Q4 — 若正确答案不在 Recall 池，KenLM 是否理论上无解？

**是。** KenLM 句级 rerank 的替换候选完全来自 Recall 笛卡尔积；**NOT_FOUND 的 span 在 Builder 阶段不可能生成含 ref 正确词的 combo**，KenLM 只能打 raw 或错误 combo。

### Q5 — Recall 当前最大问题：排序还是覆盖率？

**覆盖率（NOT_FOUND）是主瓶颈** — baseline NOT_FOUND **26/34**；  
在已进入 Recall 的 **8** 个 span 中，Top1 命中 **8**、Top8 命中 **8**（排序有优化空间但非首因）。  
Recall Width 实验 A→D 加宽后 NOT_FOUND **不变**（见 §3），进一步证明 **非单纯 TopK 过窄**。

---

## 3. 实验组排名统计（Recall Width 四组）

| 组 | span 数 | Top1 | Top2 | Top4 | Top8 | Top16 | NOT_FOUND | 平均排名 |
|----|---------|------|------|------|------|-------|-----------|----------|
| A_baseline | 34 | 8 | 8 | 8 | 8 | 8 | 26 | 1 |
| B_medium | 34 | 8 | 8 | 8 | 8 | 8 | 26 | 1 |
| C_wide | 34 | 8 | 8 | 8 | 8 | 8 | 26 | 1 |
| D_very_wide | 34 | 8 | 8 | 8 | 8 | 8 | 26 | 1 |

---

## 4. NOT_FOUND 分类（baseline A，n=26）

| 类别 | 含义 | 数量 |
|------|------|------|
| **A** | 词库缺失 | 26 |
| **B** | 拼音召回失败 / prior 过滤 / cap 截断 | 0 |
| **C** | domain 路由错误 | 0 |
| **D** | repairTarget 缺失 | 0 |
| **E** | 其它（对齐失败、与 raw 相同等） | 0 |

### NOT_FOUND 明细

| caseId | rawSpan | correctCandidate | 分类 | 说明 |
|--------|---------|------------------|------|------|
| d066 | 生成 | 选生 | A | ref  plausible 目标（如「选生」）均未在词库同拼音桶找到 |
| d066 | 要加 | 路要 | A | ref  plausible 目标（如「路要」）均未在词库同拼音桶找到 |
| d003 | 少病 | 少冰 | A | ref  plausible 目标（如「少冰」）均未在词库同拼音桶找到 |
| d003 | 赶时 | 我赶 | A | ref  plausible 目标（如「我赶」）均未在词库同拼音桶找到 |
| d027 | 什么 | 快什 | A | ref  plausible 目标（如「快什」）均未在词库同拼音桶找到 |
| d072 | 入职 | 能入 | A | ref  plausible 目标（如「能入」）均未在词库同拼音桶找到 |
| d072 | 什么 | 快什 | A | ref  plausible 目标（如「快什」）均未在词库同拼音桶找到 |
| d060 | 订单 | 款订 | A | ref  plausible 目标（如「款订」）均未在词库同拼音桶找到 |
| d048 | 少病 | 少冰 | A | ref  plausible 目标（如「少冰」）均未在词库同拼音桶找到 |
| d048 | 赶时 | 我赶 | A | ref  plausible 目标（如「我赶」）均未在词库同拼音桶找到 |
| d051 | 评审 | 忙评 | A | ref  plausible 目标（如「忙评」）均未在词库同拼音桶找到 |
| d057 | 检查 | 个检 | A | ref  plausible 目标（如「个检」）均未在词库同拼音桶找到 |
| d057 | 请假 | 要请 | A | ref  plausible 目标（如「要请」）均未在词库同拼音桶找到 |
| d005 | 订单 | 下订 | A | ref  plausible 目标（如「下订」）均未在词库同拼音桶找到 |
| d005 | 进都 | 进度 | A | ref  plausible 目标（如「进度」）均未在词库同拼音桶找到 |
| d005 | 风险 | 下风 | A | ref  plausible 目标（如「下风」）均未在词库同拼音桶找到 |
| d062 | 一家 | 一起 | A | ref  plausible 目标（如「一起」）均未在词库同拼音桶找到 |
| d062 | 一起 | 一家 | A | ref  plausible 目标（如「一家」）均未在词库同拼音桶找到 |
| d089 | 上午 | 上线 | A | ref  plausible 目标（如「上线」）均未在词库同拼音桶找到 |
| d006 | 评审 | 忙评 | A | ref  plausible 目标（如「忙评」）均未在词库同拼音桶找到 |
| d074 | 作业 | 业是 | A | ref  plausible 目标（如「业是」）均未在词库同拼音桶找到 |
| d074 | 叫吗 | 交吗 | A | ref  plausible 目标（如「交吗」）均未在词库同拼音桶找到 |
| d039 | 解一 | 结一 | A | ref  plausible 目标（如「结一」）均未在词库同拼音桶找到 |
| d028 | 解题 | 道题 | A | ref  plausible 目标（如「道题」）均未在词库同拼音桶找到 |
| d014 | 鞋是 | 鞋有 | A | ref  plausible 目标（如「鞋有」）均未在词库同拼音桶找到 |
| d014 | 似的 | 码吗 | A | ref  plausible 目标（如「码吗」）均未在词库同拼音桶找到 |

---

## 5. 附录 — 全部 ApprovedSpan Recall TopK 完整导出（A/B/C/D 四组）

> 每组 perSpanLimit 见 Recall Width 实验设计；**每一 span 均列出全部 Recall 候选**。


---

### Case d066（tech_deploy）— span「生成」

- **raw**：*(未落盘)*
- **reference**：会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：4


#### d066 / span「生成」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 生成 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 选生 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 声称 | lexicon_pinyin_topk | 1.2159 | 0.7159 |  |

#### d066 / span「生成」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 生成 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 选生 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 声称 | lexicon_pinyin_topk | 1.2159 | 0.7159 |  |
| 2 | 省城 | lexicon_pinyin_topk | 1.2039 | 0.7039 |  |

#### d066 / span「生成」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 生成 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 选生 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 声称 | lexicon_pinyin_topk | 1.2159 | 0.7159 |  |
| 2 | 省城 | lexicon_pinyin_topk | 1.2039 | 0.7039 |  |

#### d066 / span「生成」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 生成 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 选生 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 声称 | lexicon_pinyin_topk | 1.2159 | 0.7159 |  |
| 2 | 省城 | lexicon_pinyin_topk | 1.2039 | 0.7039 |  |

---

### Case d066（tech_deploy）— span「要加」

- **raw**：*(未落盘)*
- **reference**：会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：4


#### d066 / span「要加」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 要加 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 路要 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 药价 | lexicon_pinyin_topk | 1.1307 | 0.6307 |  |
| 2 | 要价 | lexicon_pinyin_topk | 1.5672 | 0.5672 |  |

#### d066 / span「要加」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 要加 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 路要 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 药价 | lexicon_pinyin_topk | 1.1307 | 0.6307 |  |
| 2 | 要价 | lexicon_pinyin_topk | 1.5672 | 0.5672 |  |
| 3 | 瑶家 | lexicon_pinyin_topk | 1.0528 | 0.5528 |  |

#### d066 / span「要加」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 要加 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 路要 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 药价 | lexicon_pinyin_topk | 1.1307 | 0.6307 |  |
| 2 | 要价 | lexicon_pinyin_topk | 1.5672 | 0.5672 |  |
| 3 | 瑶家 | lexicon_pinyin_topk | 1.0528 | 0.5528 |  |

#### d066 / span「要加」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 要加 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 路要 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 药价 | lexicon_pinyin_topk | 1.1307 | 0.6307 |  |
| 2 | 要价 | lexicon_pinyin_topk | 1.5672 | 0.5672 |  |
| 3 | 瑶家 | lexicon_pinyin_topk | 1.0528 | 0.5528 |  |

---

### Case d066（tech_deploy）— span「上限」

- **raw**：*(未落盘)*
- **reference**：会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：4


#### d066 / span「上限」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 上限 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 上线 | lexicon_pinyin_topk | 1.7087 | 0.7087 | **YES** |

#### d066 / span「上限」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 上限 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 上线 | lexicon_pinyin_topk | 1.7087 | 0.7087 | **YES** |
| 2 | 上弦 | lexicon_pinyin_topk | 1.5204 | 0.5204 |  |

#### d066 / span「上限」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 上限 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 上线 | lexicon_pinyin_topk | 1.7087 | 0.7087 | **YES** |
| 2 | 上弦 | lexicon_pinyin_topk | 1.5204 | 0.5204 |  |

#### d066 / span「上限」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 上限 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 上线 | lexicon_pinyin_topk | 1.7087 | 0.7087 | **YES** |
| 2 | 上弦 | lexicon_pinyin_topk | 1.5204 | 0.5204 |  |

---

### Case d066（tech_deploy）— span「纹当」

- **raw**：*(未落盘)*
- **reference**：会上提到候选生成链路要加监控，上线计划文档我下午更新一版。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：4


#### d066 / span「纹当」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 纹当 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 文档 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 文档 | lexicon_pinyin_topk | 1.1365 | 0.6365 | **YES** |
| 2 | 稳当 | lexicon_pinyin_topk | 1.5703 | 0.5703 |  |

#### d066 / span「纹当」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 纹当 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 文档 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 文档 | lexicon_pinyin_topk | 1.1365 | 0.6365 | **YES** |
| 2 | 稳当 | lexicon_pinyin_topk | 1.5703 | 0.5703 |  |

#### d066 / span「纹当」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 纹当 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 文档 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 文档 | lexicon_pinyin_topk | 1.1365 | 0.6365 | **YES** |
| 2 | 稳当 | lexicon_pinyin_topk | 1.5703 | 0.5703 |  |

#### d066 / span「纹当」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | tech_deploy |
| raw sentence | *(未落盘)* |
| reference | 会上提到候选生成链路要加监控，上线计划文档我下午更新一版。 |
| ApprovedSpan | 纹当 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 文档 |
| ref 同长替换目标集 | 会上 / 上提 / 提到 / 到候 / 候选 / 选生 / 生成 / 成链 / 链路 / 路要 / 要加 / 加监 / 监控 / 控上 / 上线 / 线计 / 计划 / 划文 / 文档 / 档我 / 我下 / 下午 / 午更 / 更新 / 新一 / 一版 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 文档 | lexicon_pinyin_topk | 1.1365 | 0.6365 | **YES** |
| 2 | 稳当 | lexicon_pinyin_topk | 1.5703 | 0.5703 |  |

---

### Case d003（cafe）— span「少病」

- **raw**：*(未落盘)*
- **reference**：请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d003 / span「少病」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

#### d003 / span「少病」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

#### d003 / span「少病」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

#### d003 / span「少病」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

---

### Case d003（cafe）— span「赶时」

- **raw**：*(未落盘)*
- **reference**：请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d003 / span「赶时」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |

#### d003 / span「赶时」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |
| 5 | 杆式 | lexicon_pinyin_topk | 1.0314 | 0.5314 |  |
| 6 | 干式 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

#### d003 / span「赶时」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |
| 5 | 杆式 | lexicon_pinyin_topk | 1.0314 | 0.5314 |  |
| 6 | 干式 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

#### d003 / span「赶时」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款燕麦拿铁可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款燕 / 燕麦 / 麦拿 / 拿铁 / 铁可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |
| 5 | 杆式 | lexicon_pinyin_topk | 1.0314 | 0.5314 |  |
| 6 | 干式 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

---

### Case d027（interview）— span「什么」

- **raw**：*(未落盘)*
- **reference**：期望薪资这块我们可以再沟通，你最快什么时候能入职？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d027 / span「什么」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

#### d027 / span「什么」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

#### d027 / span「什么」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

#### d027 / span「什么」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

---

### Case d072（interview）— span「新自」

- **raw**：*(未落盘)*
- **reference**：期望薪资这块我们可以再沟通，你最快什么时候能入职？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：3


#### d072 / span「新自」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 新自 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 薪资 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 薪资 | lexicon_pinyin_topk | 1.1593 | 0.6593 | **YES** |
| 2 | 心子 | lexicon_pinyin_topk | 1.0251 | 0.5251 |  |

#### d072 / span「新自」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 新自 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 薪资 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 薪资 | lexicon_pinyin_topk | 1.1593 | 0.6593 | **YES** |
| 2 | 心子 | lexicon_pinyin_topk | 1.0251 | 0.5251 |  |
| 3 | 芯子 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

#### d072 / span「新自」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 新自 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 薪资 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 薪资 | lexicon_pinyin_topk | 1.1593 | 0.6593 | **YES** |
| 2 | 心子 | lexicon_pinyin_topk | 1.0251 | 0.5251 |  |
| 3 | 芯子 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

#### d072 / span「新自」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 新自 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 薪资 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 薪资 | lexicon_pinyin_topk | 1.1593 | 0.6593 | **YES** |
| 2 | 心子 | lexicon_pinyin_topk | 1.0251 | 0.5251 |  |
| 3 | 芯子 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

---

### Case d072（interview）— span「入职」

- **raw**：*(未落盘)*
- **reference**：期望薪资这块我们可以再沟通，你最快什么时候能入职？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：3


#### d072 / span「入职」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 入职 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 能入 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 乳汁 | lexicon_pinyin_topk | 1.144 | 0.644 |  |

#### d072 / span「入职」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 入职 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 能入 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 乳汁 | lexicon_pinyin_topk | 1.144 | 0.644 |  |

#### d072 / span「入职」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 入职 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 能入 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 乳汁 | lexicon_pinyin_topk | 1.144 | 0.644 |  |

#### d072 / span「入职」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 入职 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 能入 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 什么 / 么时 / 时候 / 候能 / 能入 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 乳汁 | lexicon_pinyin_topk | 1.144 | 0.644 |  |

---

### Case d072（interview）— span「什么」

- **raw**：*(未落盘)*
- **reference**：期望薪资这块我们可以再沟通，你最快什么时候能入职？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：3


#### d072 / span「什么」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

#### d072 / span「什么」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

#### d072 / span「什么」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

#### d072 / span「什么」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | interview |
| raw sentence | *(未落盘)* |
| reference | 期望薪资这块我们可以再沟通，你最快什么时候能入职？ |
| ApprovedSpan | 什么 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 快什 |
| ref 同长替换目标集 | 期望 / 望薪 / 薪资 / 资这 / 这块 / 块我 / 我们 / 们可 / 可以 / 以再 / 再沟 / 沟通 / 通你 / 你最 / 最快 / 快什 / 么时 / 时候 / 候能 / 能入 / 入职 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 甚么 | lexicon_pinyin_topk | 1.8703 | 0.8703 |  |

---

### Case d069（customer_service）— span「开局」

- **raw**：*(未落盘)*
- **reference**：发票抬头开错了，能重新开具电子发票吗？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d069 / span「开局」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

#### d069 / span「开局」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

#### d069 / span「开局」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

#### d069 / span「开局」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

---

### Case d060（shopping）— span「订单」

- **raw**：*(未落盘)*
- **reference**：我想对比一下这两款订单中台的价格，会员日能再减一点吗？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d060 / span「订单」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | *(未落盘)* |
| reference | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 款订 |
| ref 同长替换目标集 | 我想 / 想对 / 对比 / 比一 / 一下 / 下这 / 这两 / 两款 / 款订 / 单中 / 中台 / 台的 / 的价 / 价格 / 格会 / 会员 / 员日 / 日能 / 能再 / 再减 / 减一 / 一点 / 点吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

#### d060 / span「订单」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | *(未落盘)* |
| reference | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 款订 |
| ref 同长替换目标集 | 我想 / 想对 / 对比 / 比一 / 一下 / 下这 / 这两 / 两款 / 款订 / 单中 / 中台 / 台的 / 的价 / 价格 / 格会 / 会员 / 员日 / 日能 / 能再 / 再减 / 减一 / 一点 / 点吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

#### d060 / span「订单」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | *(未落盘)* |
| reference | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 款订 |
| ref 同长替换目标集 | 我想 / 想对 / 对比 / 比一 / 一下 / 下这 / 这两 / 两款 / 款订 / 单中 / 中台 / 台的 / 的价 / 价格 / 格会 / 会员 / 员日 / 日能 / 能再 / 再减 / 减一 / 一点 / 点吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

#### d060 / span「订单」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | *(未落盘)* |
| reference | 我想对比一下这两款订单中台的价格，会员日能再减一点吗？ |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 款订 |
| ref 同长替换目标集 | 我想 / 想对 / 对比 / 比一 / 一下 / 下这 / 这两 / 两款 / 款订 / 单中 / 中台 / 台的 / 的价 / 价格 / 格会 / 会员 / 员日 / 日能 / 能再 / 再减 / 减一 / 一点 / 点吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

---

### Case d048（cafe）— span「少病」

- **raw**：*(未落盘)*
- **reference**：请问这款热巧克力可以少冰吗？我赶时间，小杯。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d048 / span「少病」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

#### d048 / span「少病」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

#### d048 / span「少病」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

#### d048 / span「少病」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 少病 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 少冰 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 赶时 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 烧饼 | lexicon_pinyin_topk | 1.2024 | 0.7024 |  |
| 2 | 哨兵 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |

---

### Case d048（cafe）— span「赶时」

- **raw**：*(未落盘)*
- **reference**：请问这款热巧克力可以少冰吗？我赶时间，小杯。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d048 / span「赶时」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |

#### d048 / span「赶时」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |
| 5 | 杆式 | lexicon_pinyin_topk | 1.0314 | 0.5314 |  |
| 6 | 干式 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

#### d048 / span「赶时」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |
| 5 | 杆式 | lexicon_pinyin_topk | 1.0314 | 0.5314 |  |
| 6 | 干式 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

#### d048 / span「赶时」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | cafe |
| raw sentence | *(未落盘)* |
| reference | 请问这款热巧克力可以少冰吗？我赶时间，小杯。 |
| ApprovedSpan | 赶时 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 我赶 |
| ref 同长替换目标集 | 请问 / 问这 / 这款 / 款热 / 热巧 / 巧克 / 克力 / 力可 / 可以 / 以少 / 少冰 / 冰吗 / 吗我 / 我赶 / 时间 / 间小 / 小杯 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 干事 | lexicon_pinyin_topk | 1.1806 | 0.6806 |  |
| 2 | 干尸 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 干湿 | lexicon_pinyin_topk | 1.1193 | 0.6193 |  |
| 4 | 矸石 | lexicon_pinyin_topk | 1.0455 | 0.5455 |  |
| 5 | 杆式 | lexicon_pinyin_topk | 1.0314 | 0.5314 |  |
| 6 | 干式 | lexicon_pinyin_topk | 1.0204 | 0.5204 |  |

---

### Case d051（meeting）— span「评审」

- **raw**：*(未落盘)*
- **reference**：跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d051 / span「评审」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

#### d051 / span「评审」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

#### d051 / span「评审」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

#### d051 / span「评审」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

---

### Case d057（hospital）— span「检查」

- **raw**：*(未落盘)*
- **reference**：这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d057 / span「检查」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 检查 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 个检 |
| ref 同长替换目标集 | 这个 / 个检 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 请假 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 检察 | lexicon_pinyin_topk | 1.7846 | 0.7846 |  |
| 2 | 监察 | lexicon_pinyin_topk | 1.2486 | 0.7486 |  |

#### d057 / span「检查」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 检查 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 个检 |
| ref 同长替换目标集 | 这个 / 个检 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 请假 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 检察 | lexicon_pinyin_topk | 1.7846 | 0.7846 |  |
| 2 | 监察 | lexicon_pinyin_topk | 1.2486 | 0.7486 |  |

#### d057 / span「检查」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 检查 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 个检 |
| ref 同长替换目标集 | 这个 / 个检 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 请假 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 检察 | lexicon_pinyin_topk | 1.7846 | 0.7846 |  |
| 2 | 监察 | lexicon_pinyin_topk | 1.2486 | 0.7486 |  |

#### d057 / span「检查」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 检查 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 个检 |
| ref 同长替换目标集 | 这个 / 个检 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 请假 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 检察 | lexicon_pinyin_topk | 1.7846 | 0.7846 |  |
| 2 | 监察 | lexicon_pinyin_topk | 1.2486 | 0.7486 |  |

---

### Case d057（hospital）— span「请假」

- **raw**：*(未落盘)*
- **reference**：这个检查报告什么时候能出？我咳嗽，需要请假休息吗？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d057 / span「请假」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 请假 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 要请 |
| ref 同长替换目标集 | 这个 / 个检 / 检查 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 亲家 | lexicon_pinyin_topk | 1.1484 | 0.6484 |  |

#### d057 / span「请假」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 请假 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 要请 |
| ref 同长替换目标集 | 这个 / 个检 / 检查 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 亲家 | lexicon_pinyin_topk | 1.1484 | 0.6484 |  |

#### d057 / span「请假」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 请假 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 要请 |
| ref 同长替换目标集 | 这个 / 个检 / 检查 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 亲家 | lexicon_pinyin_topk | 1.1484 | 0.6484 |  |

#### d057 / span「请假」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 这个检查报告什么时候能出？我咳嗽，需要请假休息吗？ |
| ApprovedSpan | 请假 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 要请 |
| ref 同长替换目标集 | 这个 / 个检 / 检查 / 查报 / 报告 / 告什 / 什么 / 么时 / 时候 / 候能 / 能出 / 出我 / 我咳 / 咳嗽 / 嗽需 / 需要 / 要请 / 假休 / 休息 / 息吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 亲家 | lexicon_pinyin_topk | 1.1484 | 0.6484 |  |

---

### Case d005（meeting）— span「订单」

- **raw**：*(未落盘)*
- **reference**：今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：3


#### d005 / span「订单」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 下订 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

#### d005 / span「订单」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 下订 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

#### d005 / span「订单」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 下订 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

#### d005 / span「订单」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 订单 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 下订 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 定单 | lexicon_pinyin_topk | 1.5867 | 0.5867 |  |

---

### Case d005（meeting）— span「进都」

- **raw**：*(未落盘)*
- **reference**：今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：3


#### d005 / span「进都」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 进都 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 进度 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 筋斗 | lexicon_pinyin_topk | 1.187 | 0.687 |  |
| 2 | 斤斗 | lexicon_pinyin_topk | 1.0514 | 0.5514 |  |

#### d005 / span「进都」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 进都 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 进度 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 筋斗 | lexicon_pinyin_topk | 1.187 | 0.687 |  |
| 2 | 斤斗 | lexicon_pinyin_topk | 1.0514 | 0.5514 |  |

#### d005 / span「进都」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 进都 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 进度 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 筋斗 | lexicon_pinyin_topk | 1.187 | 0.687 |  |
| 2 | 斤斗 | lexicon_pinyin_topk | 1.0514 | 0.5514 |  |

#### d005 / span「进都」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 进都 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 进度 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 / 风险 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 筋斗 | lexicon_pinyin_topk | 1.187 | 0.687 |  |
| 2 | 斤斗 | lexicon_pinyin_topk | 1.0514 | 0.5514 |  |

---

### Case d005（meeting）— span「风险」

- **raw**：*(未落盘)*
- **reference**：今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：3


#### d005 / span「风险」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 风险 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 2 |
| correctCandidate | 下风 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 奉献 | lexicon_pinyin_topk | 1.215 | 0.715 |  |

#### d005 / span「风险」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 风险 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 3 |
| correctCandidate | 下风 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 奉献 | lexicon_pinyin_topk | 1.215 | 0.715 |  |
| 2 | 锋线 | lexicon_pinyin_topk | 1.1051 | 0.6051 |  |

#### d005 / span「风险」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 风险 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 下风 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 奉献 | lexicon_pinyin_topk | 1.215 | 0.715 |  |
| 2 | 锋线 | lexicon_pinyin_topk | 1.1051 | 0.6051 |  |
| 3 | 缝线 | lexicon_pinyin_topk | 1.0125 | 0.5125 |  |

#### d005 / span「风险」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | *(未落盘)* |
| reference | 今天的站会先过一下订单中台进度，内存占用高这块需要限流保护，大家看一下风险。 |
| ApprovedSpan | 风险 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 下风 |
| ref 同长替换目标集 | 今天 / 天的 / 的站 / 站会 / 会先 / 先过 / 过一 / 一下 / 下订 / 订单 / 单中 / 中台 / 台进 / 进度 / 度内 / 内存 / 存占 / 占用 / 用高 / 高这 / 这块 / 块需 / 需要 / 要限 / 限流 / 流保 / 保护 / 护大 / 大家 / 家看 / 看一 / 下风 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 奉献 | lexicon_pinyin_topk | 1.215 | 0.715 |  |
| 2 | 锋线 | lexicon_pinyin_topk | 1.1051 | 0.6051 |  |
| 3 | 缝线 | lexicon_pinyin_topk | 1.0125 | 0.5125 |  |

---

### Case d079（bank）— span「想開」

- **raw**：*(未落盘)*
- **reference**：我想开通短信提醒，需要带什么证件？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d079 / span「想開」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | bank |
| raw sentence | *(未落盘)* |
| reference | 我想开通短信提醒，需要带什么证件？ |
| ApprovedSpan | 想開 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 想开 |
| ref 同长替换目标集 | 我想 / 想开 / 开通 / 通短 / 短信 / 信提 / 提醒 / 醒需 / 需要 / 要带 / 带什 / 什么 / 么证 / 证件 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 想开 | lexicon_pinyin_topk | 1.5353 | 0.5353 | **YES** |

#### d079 / span「想開」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | bank |
| raw sentence | *(未落盘)* |
| reference | 我想开通短信提醒，需要带什么证件？ |
| ApprovedSpan | 想開 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 想开 |
| ref 同长替换目标集 | 我想 / 想开 / 开通 / 通短 / 短信 / 信提 / 提醒 / 醒需 / 需要 / 要带 / 带什 / 什么 / 么证 / 证件 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 想开 | lexicon_pinyin_topk | 1.5353 | 0.5353 | **YES** |

#### d079 / span「想開」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | bank |
| raw sentence | *(未落盘)* |
| reference | 我想开通短信提醒，需要带什么证件？ |
| ApprovedSpan | 想開 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 想开 |
| ref 同长替换目标集 | 我想 / 想开 / 开通 / 通短 / 短信 / 信提 / 提醒 / 醒需 / 需要 / 要带 / 带什 / 什么 / 么证 / 证件 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 想开 | lexicon_pinyin_topk | 1.5353 | 0.5353 | **YES** |

#### d079 / span「想開」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | bank |
| raw sentence | *(未落盘)* |
| reference | 我想开通短信提醒，需要带什么证件？ |
| ApprovedSpan | 想開 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 想开 |
| ref 同长替换目标集 | 我想 / 想开 / 开通 / 通短 / 短信 / 信提 / 提醒 / 醒需 / 需要 / 要带 / 带什 / 什么 / 么证 / 证件 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 想开 | lexicon_pinyin_topk | 1.5353 | 0.5353 | **YES** |

---

### Case d062（friend）— span「一家」

- **raw**：*(未落盘)*
- **reference**：晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d062 / span「一家」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一家 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 一起 |
| ref 同长替换目标集 | 晚上 / 上一 / 一起 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 意甲 | lexicon_pinyin_topk | 1.1279 | 0.6279 |  |
| 2 | 溢价 | lexicon_pinyin_topk | 1.0924 | 0.5924 |  |
| 3 | 医家 | lexicon_pinyin_topk | 1.5733 | 0.5733 |  |
| 4 | 衣架 | lexicon_pinyin_topk | 1.0628 | 0.5628 |  |

#### d062 / span「一家」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一家 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 一起 |
| ref 同长替换目标集 | 晚上 / 上一 / 一起 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 意甲 | lexicon_pinyin_topk | 1.1279 | 0.6279 |  |
| 2 | 溢价 | lexicon_pinyin_topk | 1.0924 | 0.5924 |  |
| 3 | 医家 | lexicon_pinyin_topk | 1.5733 | 0.5733 |  |
| 4 | 衣架 | lexicon_pinyin_topk | 1.0628 | 0.5628 |  |
| 5 | 衣甲 | lexicon_pinyin_topk | 1.0125 | 0.5125 |  |
| 6 | 议价 | lexicon_pinyin_topk | 1.0096 | 0.5096 |  |

#### d062 / span「一家」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一家 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 一起 |
| ref 同长替换目标集 | 晚上 / 上一 / 一起 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 意甲 | lexicon_pinyin_topk | 1.1279 | 0.6279 |  |
| 2 | 溢价 | lexicon_pinyin_topk | 1.0924 | 0.5924 |  |
| 3 | 医家 | lexicon_pinyin_topk | 1.5733 | 0.5733 |  |
| 4 | 衣架 | lexicon_pinyin_topk | 1.0628 | 0.5628 |  |
| 5 | 衣甲 | lexicon_pinyin_topk | 1.0125 | 0.5125 |  |
| 6 | 议价 | lexicon_pinyin_topk | 1.0096 | 0.5096 |  |

#### d062 / span「一家」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一家 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 一起 |
| ref 同长替换目标集 | 晚上 / 上一 / 一起 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 意甲 | lexicon_pinyin_topk | 1.1279 | 0.6279 |  |
| 2 | 溢价 | lexicon_pinyin_topk | 1.0924 | 0.5924 |  |
| 3 | 医家 | lexicon_pinyin_topk | 1.5733 | 0.5733 |  |
| 4 | 衣架 | lexicon_pinyin_topk | 1.0628 | 0.5628 |  |
| 5 | 衣甲 | lexicon_pinyin_topk | 1.0125 | 0.5125 |  |
| 6 | 议价 | lexicon_pinyin_topk | 1.0096 | 0.5096 |  |

---

### Case d062（friend）— span「一起」

- **raw**：*(未落盘)*
- **reference**：晚上一起吃饭吗？我知道一家川菜不错，大概七点到。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：2


#### d062 / span「一起」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一起 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 4 |
| correctCandidate | 一家 |
| ref 同长替换目标集 | 晚上 / 上一 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 一家 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 一齐 | lexicon_pinyin_topk | 1.7894 | 0.7894 |  |
| 2 | 仪器 | lexicon_pinyin_topk | 1.2522 | 0.7522 |  |
| 3 | 一期 | lexicon_pinyin_topk | 1.7073 | 0.7073 |  |
| 4 | 义气 | lexicon_pinyin_topk | 1.1772 | 0.6772 |  |

#### d062 / span「一起」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一起 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 6 |
| correctCandidate | 一家 |
| ref 同长替换目标集 | 晚上 / 上一 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 一家 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 一齐 | lexicon_pinyin_topk | 1.7894 | 0.7894 |  |
| 2 | 仪器 | lexicon_pinyin_topk | 1.2522 | 0.7522 |  |
| 3 | 一期 | lexicon_pinyin_topk | 1.7073 | 0.7073 |  |
| 4 | 义气 | lexicon_pinyin_topk | 1.1772 | 0.6772 |  |
| 5 | 遗弃 | lexicon_pinyin_topk | 1.1477 | 0.6477 |  |
| 6 | 以期 | lexicon_pinyin_topk | 1.1404 | 0.6404 |  |

#### d062 / span「一起」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一起 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 一家 |
| ref 同长替换目标集 | 晚上 / 上一 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 一家 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 一齐 | lexicon_pinyin_topk | 1.7894 | 0.7894 |  |
| 2 | 仪器 | lexicon_pinyin_topk | 1.2522 | 0.7522 |  |
| 3 | 一期 | lexicon_pinyin_topk | 1.7073 | 0.7073 |  |
| 4 | 义气 | lexicon_pinyin_topk | 1.1772 | 0.6772 |  |
| 5 | 遗弃 | lexicon_pinyin_topk | 1.1477 | 0.6477 |  |
| 6 | 以期 | lexicon_pinyin_topk | 1.1404 | 0.6404 |  |
| 7 | 一气 | lexicon_pinyin_topk | 1.6167 | 0.6167 |  |
| 8 | 意气 | lexicon_pinyin_topk | 1.104 | 0.604 |  |

#### d062 / span「一起」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | friend |
| raw sentence | *(未落盘)* |
| reference | 晚上一起吃饭吗？我知道一家川菜不错，大概七点到。 |
| ApprovedSpan | 一起 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 一家 |
| ref 同长替换目标集 | 晚上 / 上一 / 起吃 / 吃饭 / 饭吗 / 吗我 / 我知 / 知道 / 道一 / 一家 / 家川 / 川菜 / 菜不 / 不错 / 错大 / 大概 / 概七 / 七点 / 点到 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 一齐 | lexicon_pinyin_topk | 1.7894 | 0.7894 |  |
| 2 | 仪器 | lexicon_pinyin_topk | 1.2522 | 0.7522 |  |
| 3 | 一期 | lexicon_pinyin_topk | 1.7073 | 0.7073 |  |
| 4 | 义气 | lexicon_pinyin_topk | 1.1772 | 0.6772 |  |
| 5 | 遗弃 | lexicon_pinyin_topk | 1.1477 | 0.6477 |  |
| 6 | 以期 | lexicon_pinyin_topk | 1.1404 | 0.6404 |  |
| 7 | 一气 | lexicon_pinyin_topk | 1.6167 | 0.6167 |  |
| 8 | 意气 | lexicon_pinyin_topk | 1.104 | 0.604 |  |
| 9 | 益气 | lexicon_pinyin_topk | 1.0852 | 0.5852 |  |
| 10 | 一汽 | lexicon_pinyin_topk | 1.5844 | 0.5844 |  |
| 11 | 义旗 | lexicon_pinyin_topk | 1.0703 | 0.5703 |  |
| 12 | 弈棋 | lexicon_pinyin_topk | 1.0353 | 0.5353 |  |

---

### Case d089（lexicon_homophone）— span「上午」

- **raw**：*(未落盘)*
- **reference**：这周的上线计花已经确认，上线计划评审安排在周四上午。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d089 / span「上午」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | lexicon_homophone |
| raw sentence | *(未落盘)* |
| reference | 这周的上线计花已经确认，上线计划评审安排在周四上午。 |
| ApprovedSpan | 上午 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 这周 / 周的 / 的上 / 上线 / 线计 / 计花 / 花已 / 已经 / 经确 / 确认 / 认上 / 计划 / 划评 / 评审 / 审安 / 安排 / 排在 / 在周 / 周四 / 四上 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 尚无 | lexicon_pinyin_topk | 1.2526 | 0.7526 |  |
| 2 | 商务 | lexicon_pinyin_topk | 1.2408 | 0.7408 |  |
| 3 | 晌午 | lexicon_pinyin_topk | 1.6356 | 0.6356 |  |

#### d089 / span「上午」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | lexicon_homophone |
| raw sentence | *(未落盘)* |
| reference | 这周的上线计花已经确认，上线计划评审安排在周四上午。 |
| ApprovedSpan | 上午 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 这周 / 周的 / 的上 / 上线 / 线计 / 计花 / 花已 / 已经 / 经确 / 确认 / 认上 / 计划 / 划评 / 评审 / 审安 / 安排 / 排在 / 在周 / 周四 / 四上 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 尚无 | lexicon_pinyin_topk | 1.2526 | 0.7526 |  |
| 2 | 商务 | lexicon_pinyin_topk | 1.2408 | 0.7408 |  |
| 3 | 晌午 | lexicon_pinyin_topk | 1.6356 | 0.6356 |  |

#### d089 / span「上午」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | lexicon_homophone |
| raw sentence | *(未落盘)* |
| reference | 这周的上线计花已经确认，上线计划评审安排在周四上午。 |
| ApprovedSpan | 上午 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 这周 / 周的 / 的上 / 上线 / 线计 / 计花 / 花已 / 已经 / 经确 / 确认 / 认上 / 计划 / 划评 / 评审 / 审安 / 安排 / 排在 / 在周 / 周四 / 四上 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 尚无 | lexicon_pinyin_topk | 1.2526 | 0.7526 |  |
| 2 | 商务 | lexicon_pinyin_topk | 1.2408 | 0.7408 |  |
| 3 | 晌午 | lexicon_pinyin_topk | 1.6356 | 0.6356 |  |

#### d089 / span「上午」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | lexicon_homophone |
| raw sentence | *(未落盘)* |
| reference | 这周的上线计花已经确认，上线计划评审安排在周四上午。 |
| ApprovedSpan | 上午 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 上线 |
| ref 同长替换目标集 | 这周 / 周的 / 的上 / 上线 / 线计 / 计花 / 花已 / 已经 / 经确 / 确认 / 认上 / 计划 / 划评 / 评审 / 审安 / 安排 / 排在 / 在周 / 周四 / 四上 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 尚无 | lexicon_pinyin_topk | 1.2526 | 0.7526 |  |
| 2 | 商务 | lexicon_pinyin_topk | 1.2408 | 0.7408 |  |
| 3 | 晌午 | lexicon_pinyin_topk | 1.6356 | 0.6356 |  |

---

### Case d006（meeting）— span「评审」

- **raw**：跟會員系統相關的訊息 我整理了一版八点前请大家帮忙评审一下
- **reference**：跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。
- **spanStart / spanEnd**：25 / 27
- **case 内 approved span 数**：1


#### d006 / span「评审」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | 跟會員系統相關的訊息 我整理了一版八点前请大家帮忙评审一下 |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | 25 / 27 |
| perSpanLimit | 8 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

#### d006 / span「评审」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | 跟會員系統相關的訊息 我整理了一版八点前请大家帮忙评审一下 |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | 25 / 27 |
| perSpanLimit | 12 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

#### d006 / span「评审」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | 跟會員系統相關的訊息 我整理了一版八点前请大家帮忙评审一下 |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | 25 / 27 |
| perSpanLimit | 16 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

#### d006 / span「评审」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | meeting |
| raw sentence | 跟會員系統相關的訊息 我整理了一版八点前请大家帮忙评审一下 |
| reference | 跟会员系统相关的需求我整理了一版，八点前请大家帮忙评审一下。 |
| ApprovedSpan | 评审 |
| spanStart / spanEnd | 25 / 27 |
| perSpanLimit | 24 |
| correctCandidate | 忙评 |
| ref 同长替换目标集 | 跟会 / 会员 / 员系 / 系统 / 统相 / 相关 / 关的 / 的需 / 需求 / 求我 / 我整 / 整理 / 理了 / 了一 / 一版 / 版八 / 八点 / 点前 / 前请 / 请大 / 大家 / 家帮 / 帮忙 / 忙评 / 审一 / 一下 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 平身 | lexicon_pinyin_topk | 1.0605 | 0.5605 |  |

---

### Case d074（classroom）— span「作业」

- **raw**：作业是下周以下午叫吗?可以电子板提叫吗?
- **reference**：作业是下周一下午交吗？可以电子版提交吗？
- **spanStart / spanEnd**：0 / 2
- **case 内 approved span 数**：3


#### d074 / span「作业」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 作业 |
| spanStart / spanEnd | 0 / 2 |
| perSpanLimit | 2 |
| correctCandidate | 业是 |
| ref 同长替换目标集 | 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 昨夜 | lexicon_pinyin_topk | 1.1986 | 0.6986 |  |

#### d074 / span「作业」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 作业 |
| spanStart / spanEnd | 0 / 2 |
| perSpanLimit | 3 |
| correctCandidate | 业是 |
| ref 同长替换目标集 | 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 昨夜 | lexicon_pinyin_topk | 1.1986 | 0.6986 |  |

#### d074 / span「作业」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 作业 |
| spanStart / spanEnd | 0 / 2 |
| perSpanLimit | 4 |
| correctCandidate | 业是 |
| ref 同长替换目标集 | 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 昨夜 | lexicon_pinyin_topk | 1.1986 | 0.6986 |  |

#### d074 / span「作业」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 作业 |
| spanStart / spanEnd | 0 / 2 |
| perSpanLimit | 6 |
| correctCandidate | 业是 |
| ref 同长替换目标集 | 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 昨夜 | lexicon_pinyin_topk | 1.1986 | 0.6986 |  |

---

### Case d074（classroom）— span「周以」

- **raw**：作业是下周以下午叫吗?可以电子板提叫吗?
- **reference**：作业是下周一下午交吗？可以电子版提交吗？
- **spanStart / spanEnd**：4 / 6
- **case 内 approved span 数**：3


#### d074 / span「周以」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 周以 |
| spanStart / spanEnd | 4 / 6 |
| perSpanLimit | 2 |
| correctCandidate | 周一 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 周一 | lexicon_pinyin_topk | 1.6696 | 0.6696 | **YES** |
| 2 | 周易 | lexicon_pinyin_topk | 1.6395 | 0.6395 |  |

#### d074 / span「周以」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 周以 |
| spanStart / spanEnd | 4 / 6 |
| perSpanLimit | 3 |
| correctCandidate | 周一 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 周一 | lexicon_pinyin_topk | 1.6696 | 0.6696 | **YES** |
| 2 | 周易 | lexicon_pinyin_topk | 1.6395 | 0.6395 |  |

#### d074 / span「周以」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 周以 |
| spanStart / spanEnd | 4 / 6 |
| perSpanLimit | 4 |
| correctCandidate | 周一 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 周一 | lexicon_pinyin_topk | 1.6696 | 0.6696 | **YES** |
| 2 | 周易 | lexicon_pinyin_topk | 1.6395 | 0.6395 |  |

#### d074 / span「周以」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 周以 |
| spanStart / spanEnd | 4 / 6 |
| perSpanLimit | 6 |
| correctCandidate | 周一 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 周一 | lexicon_pinyin_topk | 1.6696 | 0.6696 | **YES** |
| 2 | 周易 | lexicon_pinyin_topk | 1.6395 | 0.6395 |  |

---

### Case d074（classroom）— span「叫吗」

- **raw**：作业是下周以下午叫吗?可以电子板提叫吗?
- **reference**：作业是下周一下午交吗？可以电子版提交吗？
- **spanStart / spanEnd**：8 / 10
- **case 内 approved span 数**：3


#### d074 / span「叫吗」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 叫吗 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 2 |
| correctCandidate | 交吗 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 叫骂 | lexicon_pinyin_topk | 1.618 | 0.618 |  |
| 2 | 角马 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |

#### d074 / span「叫吗」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 叫吗 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 3 |
| correctCandidate | 交吗 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 叫骂 | lexicon_pinyin_topk | 1.618 | 0.618 |  |
| 2 | 角马 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |
| 3 | 蕉麻 | lexicon_pinyin_topk | 1.0066 | 0.5066 |  |

#### d074 / span「叫吗」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 叫吗 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 4 |
| correctCandidate | 交吗 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 叫骂 | lexicon_pinyin_topk | 1.618 | 0.618 |  |
| 2 | 角马 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |
| 3 | 蕉麻 | lexicon_pinyin_topk | 1.0066 | 0.5066 |  |

#### d074 / span「叫吗」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | 作业是下周以下午叫吗?可以电子板提叫吗? |
| reference | 作业是下周一下午交吗？可以电子版提交吗？ |
| ApprovedSpan | 叫吗 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 6 |
| correctCandidate | 交吗 |
| ref 同长替换目标集 | 作业 / 业是 / 是下 / 下周 / 周一 / 一下 / 下午 / 午交 / 交吗 / 吗可 / 可以 / 以电 / 电子 / 子版 / 版提 / 提交 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 叫骂 | lexicon_pinyin_topk | 1.618 | 0.618 |  |
| 2 | 角马 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |
| 3 | 蕉麻 | lexicon_pinyin_topk | 1.0066 | 0.5066 |  |

---

### Case d024（customer_service）— span「开局」

- **raw**：*(未落盘)*
- **reference**：发票抬头开错了，能重新开具电子发票吗？
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d024 / span「开局」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

#### d024 / span「开局」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

#### d024 / span「开局」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

#### d024 / span「开局」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | customer_service |
| raw sentence | *(未落盘)* |
| reference | 发票抬头开错了，能重新开具电子发票吗？ |
| ApprovedSpan | 开局 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 开具 |
| ref 同长替换目标集 | 发票 / 票抬 / 抬头 / 头开 / 开错 / 错了 / 了能 / 能重 / 重新 / 新开 / 开具 / 具电 / 电子 / 子发 / 票吗 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 开具 | lexicon_pinyin_topk | 1.5911 | 0.5911 | **YES** |

---

### Case d039（restaurant）— span「解一」

- **raw**：可以打爆麻 顺便解一下张能扫马支付吗?
- **reference**：可以打包吗？顺便结一下账，能扫码支付吗？
- **spanStart / spanEnd**：8 / 10
- **case 内 approved span 数**：1


#### d039 / span「解一」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | restaurant |
| raw sentence | 可以打爆麻 顺便解一下张能扫马支付吗? |
| reference | 可以打包吗？顺便结一下账，能扫码支付吗？ |
| ApprovedSpan | 解一 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 8 |
| correctCandidate | 结一 |
| ref 同长替换目标集 | 可以 / 以打 / 打包 / 包吗 / 吗顺 / 顺便 / 便结 / 结一 / 一下 / 下账 / 账能 / 能扫 / 扫码 / 码支 / 支付 / 付吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 借以 | lexicon_pinyin_topk | 1.1995 | 0.6995 |  |
| 2 | 介意 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 结义 | lexicon_pinyin_topk | 1.1245 | 0.6245 |  |
| 4 | 孑遗 | lexicon_pinyin_topk | 1.0787 | 0.5787 |  |

#### d039 / span「解一」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | restaurant |
| raw sentence | 可以打爆麻 顺便解一下张能扫马支付吗? |
| reference | 可以打包吗？顺便结一下账，能扫码支付吗？ |
| ApprovedSpan | 解一 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 12 |
| correctCandidate | 结一 |
| ref 同长替换目标集 | 可以 / 以打 / 打包 / 包吗 / 吗顺 / 顺便 / 便结 / 结一 / 一下 / 下账 / 账能 / 能扫 / 扫码 / 码支 / 支付 / 付吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 借以 | lexicon_pinyin_topk | 1.1995 | 0.6995 |  |
| 2 | 介意 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 结义 | lexicon_pinyin_topk | 1.1245 | 0.6245 |  |
| 4 | 孑遗 | lexicon_pinyin_topk | 1.0787 | 0.5787 |  |

#### d039 / span「解一」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | restaurant |
| raw sentence | 可以打爆麻 顺便解一下张能扫马支付吗? |
| reference | 可以打包吗？顺便结一下账，能扫码支付吗？ |
| ApprovedSpan | 解一 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 16 |
| correctCandidate | 结一 |
| ref 同长替换目标集 | 可以 / 以打 / 打包 / 包吗 / 吗顺 / 顺便 / 便结 / 结一 / 一下 / 下账 / 账能 / 能扫 / 扫码 / 码支 / 支付 / 付吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 借以 | lexicon_pinyin_topk | 1.1995 | 0.6995 |  |
| 2 | 介意 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 结义 | lexicon_pinyin_topk | 1.1245 | 0.6245 |  |
| 4 | 孑遗 | lexicon_pinyin_topk | 1.0787 | 0.5787 |  |

#### d039 / span「解一」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | restaurant |
| raw sentence | 可以打爆麻 顺便解一下张能扫马支付吗? |
| reference | 可以打包吗？顺便结一下账，能扫码支付吗？ |
| ApprovedSpan | 解一 |
| spanStart / spanEnd | 8 / 10 |
| perSpanLimit | 24 |
| correctCandidate | 结一 |
| ref 同长替换目标集 | 可以 / 以打 / 打包 / 包吗 / 吗顺 / 顺便 / 便结 / 结一 / 一下 / 下账 / 账能 / 能扫 / 扫码 / 码支 / 支付 / 付吗 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 借以 | lexicon_pinyin_topk | 1.1995 | 0.6995 |  |
| 2 | 介意 | lexicon_pinyin_topk | 1.1429 | 0.6429 |  |
| 3 | 结义 | lexicon_pinyin_topk | 1.1245 | 0.6245 |  |
| 4 | 孑遗 | lexicon_pinyin_topk | 1.0787 | 0.5787 |  |

---

### Case d055（hospital）— span「醫生」

- **raw**：*(未落盘)*
- **reference**：医生您好，我这两天嗓子疼，想开点药并做个血常规。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d055 / span「醫生」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 医生您好，我这两天嗓子疼，想开点药并做个血常规。 |
| ApprovedSpan | 醫生 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 医生 |
| ref 同长替换目标集 | 医生 / 生您 / 您好 / 好我 / 我这 / 这两 / 两天 / 天嗓 / 嗓子 / 子疼 / 疼想 / 想开 / 开点 / 点药 / 药并 / 并做 / 做个 / 个血 / 血常 / 常规 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 医生 | lexicon_pinyin_topk | 1.8136 | 0.8136 | **YES** |
| 2 | 医圣 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |

#### d055 / span「醫生」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 医生您好，我这两天嗓子疼，想开点药并做个血常规。 |
| ApprovedSpan | 醫生 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 医生 |
| ref 同长替换目标集 | 医生 / 生您 / 您好 / 好我 / 我这 / 这两 / 两天 / 天嗓 / 嗓子 / 子疼 / 疼想 / 想开 / 开点 / 点药 / 药并 / 并做 / 做个 / 个血 / 血常 / 常规 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 医生 | lexicon_pinyin_topk | 1.8136 | 0.8136 | **YES** |
| 2 | 医圣 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |

#### d055 / span「醫生」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 医生您好，我这两天嗓子疼，想开点药并做个血常规。 |
| ApprovedSpan | 醫生 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 医生 |
| ref 同长替换目标集 | 医生 / 生您 / 您好 / 好我 / 我这 / 这两 / 两天 / 天嗓 / 嗓子 / 子疼 / 疼想 / 想开 / 开点 / 点药 / 药并 / 并做 / 做个 / 个血 / 血常 / 常规 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 医生 | lexicon_pinyin_topk | 1.8136 | 0.8136 | **YES** |
| 2 | 医圣 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |

#### d055 / span「醫生」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | hospital |
| raw sentence | *(未落盘)* |
| reference | 医生您好，我这两天嗓子疼，想开点药并做个血常规。 |
| ApprovedSpan | 醫生 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 医生 |
| ref 同长替换目标集 | 医生 / 生您 / 您好 / 好我 / 我这 / 这两 / 两天 / 天嗓 / 嗓子 / 子疼 / 疼想 / 想开 / 开点 / 点药 / 药并 / 并做 / 做个 / 个血 / 血常 / 常规 |
| correctCandidateRank | **1** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 医生 | lexicon_pinyin_topk | 1.8136 | 0.8136 | **YES** |
| 2 | 医圣 | lexicon_pinyin_topk | 1.0153 | 0.5153 |  |

---

### Case d028（classroom）— span「解题」

- **raw**：*(未落盘)*
- **reference**：老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。
- **spanStart / spanEnd**：— / —
- **case 内 approved span 数**：1


#### d028 / span「解题」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | *(未落盘)* |
| reference | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 |
| ApprovedSpan | 解题 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 8 |
| correctCandidate | 道题 |
| ref 同长替换目标集 | 老师 / 师这 / 这道 / 道题 / 题的 / 的解 / 题步 / 步骤 / 骤能 / 能不 / 不能 / 能再 / 再讲 / 讲一 / 一遍 / 遍我 / 我没 / 没听 / 听懂 / 懂第 / 第二 / 二点 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 阶梯 | lexicon_pinyin_topk | 1.2121 | 0.7121 |  |
| 2 | 解体 | lexicon_pinyin_topk | 1.7068 | 0.7068 |  |
| 3 | 接替 | lexicon_pinyin_topk | 1.1905 | 0.6905 |  |
| 4 | 结体 | lexicon_pinyin_topk | 1.0439 | 0.5439 |  |

#### d028 / span「解题」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | *(未落盘)* |
| reference | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 |
| ApprovedSpan | 解题 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 12 |
| correctCandidate | 道题 |
| ref 同长替换目标集 | 老师 / 师这 / 这道 / 道题 / 题的 / 的解 / 题步 / 步骤 / 骤能 / 能不 / 不能 / 能再 / 再讲 / 讲一 / 一遍 / 遍我 / 我没 / 没听 / 听懂 / 懂第 / 第二 / 二点 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 阶梯 | lexicon_pinyin_topk | 1.2121 | 0.7121 |  |
| 2 | 解体 | lexicon_pinyin_topk | 1.7068 | 0.7068 |  |
| 3 | 接替 | lexicon_pinyin_topk | 1.1905 | 0.6905 |  |
| 4 | 结体 | lexicon_pinyin_topk | 1.0439 | 0.5439 |  |

#### d028 / span「解题」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | *(未落盘)* |
| reference | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 |
| ApprovedSpan | 解题 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 16 |
| correctCandidate | 道题 |
| ref 同长替换目标集 | 老师 / 师这 / 这道 / 道题 / 题的 / 的解 / 题步 / 步骤 / 骤能 / 能不 / 不能 / 能再 / 再讲 / 讲一 / 一遍 / 遍我 / 我没 / 没听 / 听懂 / 懂第 / 第二 / 二点 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 阶梯 | lexicon_pinyin_topk | 1.2121 | 0.7121 |  |
| 2 | 解体 | lexicon_pinyin_topk | 1.7068 | 0.7068 |  |
| 3 | 接替 | lexicon_pinyin_topk | 1.1905 | 0.6905 |  |
| 4 | 结体 | lexicon_pinyin_topk | 1.0439 | 0.5439 |  |

#### d028 / span「解题」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | classroom |
| raw sentence | *(未落盘)* |
| reference | 老师，这道题的解题步骤能不能再讲一遍？我没听懂第二点。 |
| ApprovedSpan | 解题 |
| spanStart / spanEnd | — / — |
| perSpanLimit | 24 |
| correctCandidate | 道题 |
| ref 同长替换目标集 | 老师 / 师这 / 这道 / 道题 / 题的 / 的解 / 题步 / 步骤 / 骤能 / 能不 / 不能 / 能再 / 再讲 / 讲一 / 一遍 / 遍我 / 我没 / 没听 / 听懂 / 懂第 / 第二 / 二点 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 阶梯 | lexicon_pinyin_topk | 1.2121 | 0.7121 |  |
| 2 | 解体 | lexicon_pinyin_topk | 1.7068 | 0.7068 |  |
| 3 | 接替 | lexicon_pinyin_topk | 1.1905 | 0.6905 |  |
| 4 | 结体 | lexicon_pinyin_topk | 1.0439 | 0.5439 |  |

---

### Case d014（shopping）— span「鞋是」

- **raw**：请问,这双鞋是否有相似的? 不合是三天内可以推换吧
- **reference**：请问这双鞋有四十码吗？不合适三天内可以退换吧？
- **spanStart / spanEnd**：5 / 7
- **case 内 approved span 数**：2


#### d014 / span「鞋是」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 鞋是 |
| spanStart / spanEnd | 5 / 7 |
| perSpanLimit | 4 |
| correctCandidate | 鞋有 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 写实 | lexicon_pinyin_topk | 1.1365 | 0.6365 |  |
| 2 | 写诗 | lexicon_pinyin_topk | 1.1237 | 0.6237 |  |
| 3 | 斜视 | lexicon_pinyin_topk | 1.0693 | 0.5693 |  |

#### d014 / span「鞋是」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 鞋是 |
| spanStart / spanEnd | 5 / 7 |
| perSpanLimit | 6 |
| correctCandidate | 鞋有 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 写实 | lexicon_pinyin_topk | 1.1365 | 0.6365 |  |
| 2 | 写诗 | lexicon_pinyin_topk | 1.1237 | 0.6237 |  |
| 3 | 斜视 | lexicon_pinyin_topk | 1.0693 | 0.5693 |  |

#### d014 / span「鞋是」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 鞋是 |
| spanStart / spanEnd | 5 / 7 |
| perSpanLimit | 8 |
| correctCandidate | 鞋有 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 写实 | lexicon_pinyin_topk | 1.1365 | 0.6365 |  |
| 2 | 写诗 | lexicon_pinyin_topk | 1.1237 | 0.6237 |  |
| 3 | 斜视 | lexicon_pinyin_topk | 1.0693 | 0.5693 |  |

#### d014 / span「鞋是」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 鞋是 |
| spanStart / spanEnd | 5 / 7 |
| perSpanLimit | 12 |
| correctCandidate | 鞋有 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 写实 | lexicon_pinyin_topk | 1.1365 | 0.6365 |  |
| 2 | 写诗 | lexicon_pinyin_topk | 1.1237 | 0.6237 |  |
| 3 | 斜视 | lexicon_pinyin_topk | 1.0693 | 0.5693 |  |

---

### Case d014（shopping）— span「似的」

- **raw**：请问,这双鞋是否有相似的? 不合是三天内可以推换吧
- **reference**：请问这双鞋有四十码吗？不合适三天内可以退换吧？
- **spanStart / spanEnd**：10 / 12
- **case 内 approved span 数**：2


#### d014 / span「似的」 — Group A baseline (production perSpanLimit)

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 似的 |
| spanStart / spanEnd | 10 / 12 |
| perSpanLimit | 4 |
| correctCandidate | 码吗 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 使得 | lexicon_pinyin_topk | 1.3022 | 0.8022 |  |
| 2 | 实德 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |
| 3 | 始得 | lexicon_pinyin_topk | 1.0662 | 0.5662 |  |

#### d014 / span「似的」 — Group B medium

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 似的 |
| spanStart / spanEnd | 10 / 12 |
| perSpanLimit | 6 |
| correctCandidate | 码吗 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 使得 | lexicon_pinyin_topk | 1.3022 | 0.8022 |  |
| 2 | 实德 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |
| 3 | 始得 | lexicon_pinyin_topk | 1.0662 | 0.5662 |  |

#### d014 / span「似的」 — Group C wide

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 似的 |
| spanStart / spanEnd | 10 / 12 |
| perSpanLimit | 8 |
| correctCandidate | 码吗 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 使得 | lexicon_pinyin_topk | 1.3022 | 0.8022 |  |
| 2 | 实德 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |
| 3 | 始得 | lexicon_pinyin_topk | 1.0662 | 0.5662 |  |

#### d014 / span「似的」 — Group D very wide

| 字段 | 值 |
|------|----|
| domain (scenario) | shopping |
| raw sentence | 请问,这双鞋是否有相似的? 不合是三天内可以推换吧 |
| reference | 请问这双鞋有四十码吗？不合适三天内可以退换吧？ |
| ApprovedSpan | 似的 |
| spanStart / spanEnd | 10 / 12 |
| perSpanLimit | 12 |
| correctCandidate | 码吗 |
| ref 同长替换目标集 | 请问 / 问这 / 这双 / 双鞋 / 鞋有 / 有四 / 四十 / 十码 / 码吗 / 吗不 / 不合 / 合适 / 适三 / 三天 / 天内 / 内可 / 可以 / 以退 / 退换 / 换吧 |
| correctCandidateRank | **NOT_FOUND** |

**Recall TopK**

| Rank | candidate | source | candidateScore | priorScore | correctCandidate |
|------|-----------|--------|----------------|------------|------------------|
| 1 | 使得 | lexicon_pinyin_topk | 1.3022 | 0.8022 |  |
| 2 | 实德 | lexicon_pinyin_topk | 1.1617 | 0.6617 |  |
| 3 | 始得 | lexicon_pinyin_topk | 1.0662 | 0.5662 |  |

---

## 6. 实验组 correctCandidateRank 速查表

- **d066** / 「生成」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d066** / 「要加」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d066** / 「上限」：A=1 B=1 C=1 D=1
- **d066** / 「纹当」：A=1 B=1 C=1 D=1
- **d003** / 「少病」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d003** / 「赶时」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d027** / 「什么」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d072** / 「新自」：A=1 B=1 C=1 D=1
- **d072** / 「入职」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d072** / 「什么」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d069** / 「开局」：A=1 B=1 C=1 D=1
- **d060** / 「订单」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d048** / 「少病」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d048** / 「赶时」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d051** / 「评审」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d057** / 「检查」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d057** / 「请假」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d005** / 「订单」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d005** / 「进都」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d005** / 「风险」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d079** / 「想開」：A=1 B=1 C=1 D=1
- **d062** / 「一家」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d062** / 「一起」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d089** / 「上午」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d006** / 「评审」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d074** / 「作业」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d074** / 「周以」：A=1 B=1 C=1 D=1
- **d074** / 「叫吗」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d024** / 「开局」：A=1 B=1 C=1 D=1
- **d039** / 「解一」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d055** / 「醫生」：A=1 B=1 C=1 D=1
- **d028** / 「解题」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d014** / 「鞋是」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND
- **d014** / 「似的」：A=NOT_FOUND B=NOT_FOUND C=NOT_FOUND D=NOT_FOUND

---

*READONLY AUDIT — 未修改生产代码 / 词库 / IME / 默认参数*
