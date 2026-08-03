<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lexicon_Cleanup_Phase2_Audit.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lexicon Cleanup Phase2 — Audit（Read-only）

**Date:** 2026-07-18  
**Type:** Read-only Audit · **不改代码 / 不改 DB / 不改 `term_domain_tags` / 不开发**  
**前提：** Phase1 已完成 · Phase1 Validation 已通过（可有条件进 Phase2）  
**权威合同：** [Lexicon_Domain_Contract_Freeze_V1.md](./Lexicon_Domain_Contract_Freeze_V1.md) · [Lexicon_Classification_Standard_Audit_V2.md](./Lexicon_Classification_Standard_Audit_V2.md) · [Lexicon_Operation_Guide_V1.md](./Lexicon_Operation_Guide_V1.md)  

**本报告目的：** 对人审清单（Phase1 禁止改动词）重新按 **领域区分能力** 分级，给出 Phase2 **建议方案**，**等待人工确认后再开发**。

---

## Executive Verdict

| 问题 | 结论 |
|------|------|
| 本批 11 词是否应整批迁回 Base？ | **否。** 多数有场景区分力；整词清空会误伤 Vote / sameDomain。 |
| 是否存在「必须 Base」词？ | **本批无强必须 Base。** 唯一接近边界的是 **预订**（弱区分 + 多域污染）。 |
| Strong Domain 是否可直接保留？ | **是：** 入住 / 退房 / 签到 / 包车 / 会议 / 上线（tags 已基本正确）。 |
| Weak Domain 怎么处理？ | **运营人审档（非 Runtime 第三态）**：机场 / 路线 / 开发 / 测试 / 预订 → 洗污染、压最少相关域，**默认不整词回 Base**。 |
| Phase2 预期对 Meeting/Tech_AI Winner？ | **本批 alone 几乎不动 Winner 宏量**（最多削掉个位数 tag 行）；Meeting 霸榜要靠更大规模噪声清洗，不靠这 11 词。 |

**本轮：** 仅审计 · **禁止开发** · **等待确认**。

---

## 1. 审计范围与当前 Tags（Phase1 后 · 未改）

来源：`Lexicon_Cleanup_Phase1_Development_Report.md` §禁止清单（Validation 确认未动）。

| Term | 当前 `term_domain_tags` | Tag 数 | Phase1 动作 |
|------|-------------------------|-------:|-------------|
| 机场 | meeting, tech_ai, tourism_transport, transport | 4 | 禁止 · 未改 |
| 预订 | food_order, medical, meeting, tourism_hotel, tourism_route, transport | 6 | 禁止 · 未改 |
| 入住 | tourism_hotel | 1 | 禁止 · 未改 |
| 退房 | tourism_hotel | 1 | 禁止 · 未改 |
| 路线 | tourism_route, tourism_transport | 2 | 禁止 · 未改 |
| 签到 | meeting | 1 | 禁止 · 未改 |
| 会议 | meeting | 1 | 禁止 · 未改 |
| 开发 | tech_ai | 1 | 禁止 · 未改 |
| 测试 | tech_ai | 1 | 禁止 · 未改 |
| 上线 | tech_ai | 1 | 禁止 · 未改 |
| 包车 | tourism_route | 1 | 禁止 · 未改 |

**基线（Phase1 后）：** Domain 词 ≈9984 · Base 词 =16 · meeting tags =4809 · tech_ai tags =2537 · tag 行 =10092。

---

## 2. 判断标准（本轮强制）

```text
唯一问题：该词是否具有「领域区分能力」？
  强 → Strong Domain（语义）→ 应有正确、最少 tags
  弱 → Weak Domain（语义 / 人审档）→ 人审后：最少正确 tags 或（少数）空 tags
  无 → Base → tags 必须空
```

| 允许依据 | 禁止依据 |
|----------|----------|
| 单独听到是否更偏向某细域 | 「是不是专业术语 / 生僻词」 |
| 是否跨不相关行业同等常用 | 「二字 / 未命中标记表 → Base」 |
| 污染 tag ≠ 整词无区分力 | 「tag 多 → 自动删」 |
| Strong/Weak **仅人审用语** | Runtime / 库内第三态字段 |

对照 Freeze V1：入库仍只有 **Base（空 tags）** / **Domain（有 tags）** 二元。

---

## 3. 逐词重判（区分能力）

### 3.1 Strong Domain（建议保留 Domain · tags 基本不动）

| Term | 分级 | 区分能力说明 | 当前 tags 评价 | Phase2 建议 |
|------|------|--------------|----------------|-------------|
| **入住** | Strong | 强指向酒店前台/住宿流程；跨行业「入住」几乎不用于会务/医疗主场景 | `tourism_hotel` 单域 · 正确 | **保留 Domain · 不改** |
| **退房** | Strong | 同上，酒店离店强锚点 | `tourism_hotel` 单域 · 正确 | **保留 Domain · 不改** |
| **签到** | Strong | 会务/活动到场强锚点（口语偶有「签到打卡」泛化，仍远强于「今天」） | `meeting` 单域 · 合理 | **保留 Domain · 不改**（若运营见酒店「入住签到」混淆，可人审是否加 `tourism_hotel`，**默认不加**） |
| **包车** | Strong | 行程/包车出行强锚点 | `tourism_route` · 合理 | **保留 Domain · 不改**（可选人审是否并入 `tourism_transport`，**非必须**） |
| **会议** | Strong（中强） | **非专业术语**，但会务场景区分力明确；「开个会」仍偏向 meeting 族 | `meeting` 单域 · 正确 | **保留 Domain · 严禁整词回 Base**（分类器曾误判 A） |
| **上线** | Strong（中强） | 发布/上线窗口强偏 tech / 研发协同；日常他域几乎不用此义 | `tech_ai` 单域 · 正确 | **保留 Domain · 不改** |

**说明：** 「入住 / 退房 / 上线 / 会议」再次证明：**Domain ≠ 专业黑话**。

---

### 3.2 Weak Domain（人审档 · 默认保留最少正确域 · 不整词回 Base）

| Term | 分级 | 区分能力说明 | 当前问题 | Phase2 建议（待确认） |
|------|------|--------------|----------|----------------------|
| **机场** | Weak→中 | 单独即偏交通/接送机/行程；口语高频 **≠** 无区分力 | **污染：** `meeting` + `tech_ai` 无依据 | **保留 Domain**；建议 tags → `tourism_transport`（± `transport`）；**删 meeting/tech_ai** |
| **路线** | Weak | 偏旅游线路 / 交通路径；也可出现在泛导航 | 两域相关，略宽但仍合理 | **保留 Domain**；建议保留 `tourism_route` + `tourism_transport`，或人审压到 1 域 |
| **开发** | Weak | 偏软件研发语境；亦有「房地产开发」等他义 | 单 `tech_ai` 对 **本产品 corpus** 合理，但证据弱于「联调/部署」 | **默认保留 Domain=`tech_ai`**；若运营认定本库「开发」多为非 tech → 才考虑 Base |
| **测试** | Weak | 偏 QA/上线前验证；教育「考试测试」、医疗「检测」可冲淡 | 单 `tech_ai` 合理但弱 | **同开发：默认保留**；勿因「不够术语」清空 |
| **预订** | Weak（边界） | 有酒店/餐饮/票务气味，但 **单独定细域弱**；跨多行业共用 | **严重污染：** medical / meeting；6 域近 All-Domain | **必须人审二选一**（见 §4.3）；**禁止**维持 medical/meeting |

---

### 3.3 Base？（本批结论）

| Term | 是否建议整词 → Base | 理由 |
|------|:-------------------:|------|
| 入住 / 退房 / 签到 / 包车 / 会议 / 上线 | **否** | 有明确细域区分力 |
| 机场 / 路线 / 开发 / 测试 | **否（默认）** | 弱～中区分力；应洗标或保留单域，非清空 |
| **预订** | **可选 · 仅人审后** | 若判定「多行业同等常用、单独无助定域」→ Base；若保留 → 最少合法域（见下） |

**本批「建议继续迁回 Base」清单：**  
→ **空集（无强制）**；唯一候选是运营确认后的 **预订**。

---

## 4. 建议动作汇总（供人工确认）

### 4.1 建议继续迁回 Base 的词

| 优先级 | Term | 条件 |
|--------|------|------|
| — | （无强制项） | — |
| 可选 | **预订** | 仅当运营确认「无稳定细域区分力」→ 清空全部 tags |

**禁止：** 把 机场 / 会议 / 开发 / 测试 / 上线 / 入住 / 退房 因「日常词」批量回 Base。

---

### 4.2 建议保留 Domain 的词

| Term | 建议最终 tags（草案） | 变更类型 |
|------|----------------------|----------|
| 入住 | `tourism_hotel` | 无变更 |
| 退房 | `tourism_hotel` | 无变更 |
| 签到 | `meeting` | 无变更 |
| 包车 | `tourism_route` | 无变更 |
| 会议 | `meeting` | 无变更 |
| 上线 | `tech_ai` | 无变更 |
| 机场 | `tourism_transport` [, `transport`] | **去污染**（删 meeting、tech_ai） |
| 路线 | `tourism_route` [, `tourism_transport`] | 可选压域 · 默认保留 |
| 开发 | `tech_ai` | 默认保留 |
| 测试 | `tech_ai` | 默认保留 |

---

### 4.3 需要运营确认的词

| Term | 选项 A | 选项 B | 推荐默认 |
|------|--------|--------|----------|
| **预订** | **Base**（空 tags） | Domain 最少集：例如 `tourism_hotel` + `food_order`（± `tourism_route`/`transport`）；**禁止** medical/meeting | **选项 B 去污染**（先不当 Base） |
| **机场** | 仅 `tourism_transport` | `tourism_transport` + `transport` | **双域可接受**；必须去 meeting/tech |
| **路线** | 保留两域 | 压到 `tourism_route` 或 `tourism_transport` 其一 | **保留两域** |
| **开发 / 测试** | 保留 `tech_ai` | 改 Base | **保留 tech_ai** |
| **签到** | 仅 meeting | meeting + tourism_hotel | **仅 meeting** |

---

## 5. 建议新增 / 强化的分类标准（标准层 · 非开发）

在 Freeze V1 + Standard Audit V2 之上，Phase2 人审建议显式采用：

| ID | 标准 | 用途 |
|----|------|------|
| **S-P2-01** | **污染 ≠ 无区分力**：多域堆叠时先删无关域，再决定是否 Base | 机场 / 预订 |
| **S-P2-02** | **弱锚点默认「最少正确 Domain」**，不是默认 Base | 开发 / 测试 / 路线 |
| **S-P2-03** | **Strong 日常词必须保留 Domain**（入住/退房/会议/上线/签到/包车） | 防术语偏见回潮 |
| **S-P2-04** | **Weak / Strong 只写在工单**，不入库、不新列 | 合同合规 |
| **S-P2-05** | 跨 3+ **不相关** 行业仍同等常用 → 倾向 Base；相关行业族（酒店+餐饮预订）→ 可多域但须相关 | 预订边界 |
| **S-P2-06** | Phase2 **禁止**用分类器 A 桶（7216）驱动本批决策 | 防假阴性 |

---

## 6. 预计清洗后的量级变化（仅本批 11 词 · 假设采纳默认草案）

**假设默认方案（待确认）：**

- 机场：4 → 2（删 meeting、tech_ai）  
- 预订：6 → 2～3（删 medical、meeting，及可选删多余交通域）→ 下表按 **→2**（hotel+food）估算  
- 其余 9 词：不变  
- **无整词新增 Base**（预订仍 Domain）

### 6.1 Domain（合同：有 tag 的 term 数）

| 指标 | Phase1 后 | Phase2 本批后（估） | Δ |
|------|----------:|-------------------:|--:|
| Domain 词数 | 9984 | **9984** | **0** |
| Base 词数 | 16 | **16** | **0** |
| `term_domain_tags` 行 | 10092 | **≈10084～10086** | **约 −6～−8** |

若运营把 **预订 → Base**：Domain **−1** · Base **+1** · tag 行额外再 −2～−3。

### 6.2 Meeting

| 指标 | Phase1 后 | Phase2 本批后（估） | Δ |
|------|----------:|-------------------:|--:|
| meeting **tag 行** | 4809 | **≈4807** | **−2**（机场、预订各去 1） |
| meeting **Winner（dialog_200）** | 104 | **≈104**（预期无显著变化） | ~0 |

说明：Meeting Inflation 主体（约 4.8k）未动；本批去污染对 Winner **几乎不可见**。

### 6.3 Tech_AI

| 指标 | Phase1 后 | Phase2 本批后（估） | Δ |
|------|----------:|-------------------:|--:|
| tech_ai **tag 行** | 2537 | **≈2536** | **−1**（机场去 tech_ai） |
| 开发/测试/上线 | 仍各 1× tech_ai | 不变 | 0 |
| tech_ai **Winner** | 73 | **≈73** | ~0 |

### 6.4 其他域（附）

| Domain | 预期 Δ（默认草案） |
|--------|-------------------|
| tourism_transport / transport | 机场保留相关行 · 基本持平或 −0～1（若压域） |
| tourism_hotel / food_order | 预订收敛后可能 **−** 多余 route/transport 行 |
| medical | 预订去 medical → **−1** |

### 6.5 对 Runtime 行为的预期（定性）

| 效应 | 预期 |
|------|------|
| Domain Vote 宏分布 | **基本不变** |
| 含「机场/预订」句的错投 meeting/tech | **局部改善**（去污染后少给错误域加分） |
| 酒店句（入住/退房） | **维持** sameDomain / hotel 证据 |
| 会务句（会议/签到） | **维持** meeting 证据（正确） |
| 研发句（上线/开发/测试） | **维持** tech 证据 |

**结论：** Phase2 若 **仅**做本 11 词，是 **合同合规 + 局部去污染**，**不是** Meeting/Tech_AI 霸榜解药。更大清洗需另开「Inflation 噪声 Base 回迁」批次（仍须区分能力人审，禁止 7216 一刀切）。

---

## 7. Phase2 开发边界（确认后才允许）

| 允许（确认后） | 禁止 |
|----------------|------|
| 按确认清单改 `term_domain_tags` | 自动生成 Domain Tag |
| rematerialize `domain_lexicon` + checksum | 新增 Base / All-Domain / Weak 字段 |
| 小范围受控 Patch | 按 tag 数量自动删标 |
| | 本批整词清空 Strong/弱锚点（除确认的预订→Base） |
| | Assembly Diversity / Vote 公式改动 |

---

## 8. 人工确认清单（请勾选后进入开发）

- [ ] **入住 / 退房 / 签到 / 包车 / 会议 / 上线**：确认保留 Domain（推荐：是）  
- [ ] **机场**：确认去 meeting/tech_ai，保留 transport 族（推荐：是）  
- [ ] **路线**：确认保留两域或压至一域（推荐：保留两域）  
- [ ] **开发 / 测试**：确认保留 `tech_ai`（推荐：是）  
- [ ] **预订**：选择 □ Base　□ Domain 最少集（推荐：Domain 最少集，去 medical/meeting）  
- [ ] 确认 Weak/Strong **不入库**  
- [ ] 确认本批 **不期望** Meeting/Tech Winner 大幅下降  
- [ ] 确认 Phase2 含或不含 **domain_lexicon rematerialize**（建议：**含**，消 Phase1 残差）

**确认人 / 日期：** ________________  

---

## 9. 本轮边界

```text
只读审计 · 仅输出本报告
未修改代码 / 数据库 / term_domain_tags / Runtime / Vote / Assembly
等待人工确认 → 再进入 Lexicon Cleanup Phase2 开发
```

---

## 10. 相关文档

- Phase1：`Lexicon_Cleanup_Phase1_Development_Report.md` · `Lexicon_Cleanup_Phase1_Validation_Report.md`  
- 标准：`Lexicon_Classification_Standard_Audit_V2.md`  
- 冻结：`Lexicon_Domain_Contract_Freeze_V1.md` · `Lexicon_Operation_Guide_V1.md` · `Lexicon_Maintenance_Checklist_V1.md`
