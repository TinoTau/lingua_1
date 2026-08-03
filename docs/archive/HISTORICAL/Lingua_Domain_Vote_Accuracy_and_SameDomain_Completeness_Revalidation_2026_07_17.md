<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lingua_Domain_Vote_Accuracy_and_SameDomain_Completeness_Revalidation_2026_07_17.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lingua Domain Vote Accuracy & SameDomain Completeness Re-validation

**Date:** 2026-07-17  
**Audit Type:** Read-only · Domain Vote Accuracy + SameDomain Completeness  
**禁止：** 改代码 / 配置 / 词库 / 阈值 / 权重 / Assembly / KenLM  
**上游：** [Domain Recall Scope Wiring Development Report](./Lingua_Domain_Recall_Scope_Wiring_and_Domain_Vote_SSOT_Restoration_Development_Report.md) · [Domain Vote & SameDomain Audit 2026-07-16](./Lingua_Domain_Vote_Correctness_and_SameDomain_Bucket_Formation_Audit_2026_07_16.md) · [DOMAIN_SOURCE_UNIFICATION.md](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md)  
**Evidence：** Runtime 重放 dialog_200（C1 `raw_asr_text`）· Lexicon v3 `term_domain_tags` · `tmp/budget_expansion_20260715/domain_vote_accuracy_revalidation.json`  
**Offline：** `tests/experiments/run-domain-vote-accuracy-revalidation.cjs`（Electron ABI）

---

## Final Verdict

# **G — Mixed Root Causes**

| 根因 | 影响量级 | 证据 |
|------|--------:|------|
| **B — Lexicon Domain Tag Quality** | **主因** | `meeting` 4828 / `tech_ai` 2543 tags；`医生→meeting`；`你好→tourism_hotel`；hospital 15 例仅 2 次 medical winner |
| **C — Domain Vote Logic / Evidence** | **放大器** | `insufficientEvidence=0/200`；无 margin gate；parent 可累加胜出；弱场景 90 句全投细域 |
| **F — Vote-to-Filter Eligibility** | **3/200** | d055/d136/d145：winner 仅由 `parent_fragment` 产生 → sameDomain=0 |
| **D — Multi-domain 单 `domainId`** | **31/200** CF winner 变 | Full-tags CF 改变 31 winner；非当前 same0 主因 |
| **E — `capFineDomains(12)`** | **0/200** winner | 丢掉 `transport`；uncapped CF **0** winner 变化 |

**最早且影响最大的唯一下一步：**

```text
Lexicon Domain Tag Quality Repair Plan
```

在此之前：

```text
禁止进入 Sentence Assembly Candidate Diversity Audit
禁止优化 KenLM / Gate / Apply
禁止调 Vote 阈值“看起来合理”
```

```text
Domain Vote 是否投对？     → 否（严格正确率 20.5%；宽松可接受 62.5%；Wrong 32%）
是否存在过度投域？         → 是（200/200 fine winner；general=0）
sameDomain 是否完整？     → 197/200 完整；3 例 Vote→Filter 资格缺口
是否可进 Assembly Diversity？ → 否（非 Verdict A）
```

---

## 0. 接线后回归复核（本轮重放一致）

| Metric | Wiring 后 | 本轮重放 |
|--------|----------:|--------:|
| Domain Lookup executed | 200/200 | 200/200 |
| Vote-eligible >0 | 200/200 | 200/200 |
| `utteranceDomain=general` | 0 | **0** |
| Fine-domain winner | 200 | **200** |
| `sameDomainCandidateCount>0` | 197 | **197** |
| `insufficientEvidence` | 0 | **0** |

**结论：主链“能运行”已确认；本轮证明“结果正确性”未达标。**

---

## 四、Domain Scope 完整性复验

```text
availableFineDomains (13)
  bakery, coffee, food_order, general, medical, meeting, milk_tea,
  tech_ai, tourism_hotel, tourism_pickup, tourism_route,
  tourism_transport, transport

configuredEnabledDomains = []
resolvedScopeSource = available
resolvedRecallDomainScope (12, after capFineDomains)
  bakery, coffee, food_order, general, medical, meeting, milk_tea,
  tech_ai, tourism_hotel, tourism_pickup, tourism_route, tourism_transport

capFineDomains: sort(localeCompare) → slice(0, 12)
Dropped by Cap: transport
general in scope: YES（占 1 个 cap 名额）
```

| Domain | Available | In Scope | Dropped by Cap | Appears in dialog_200 | Recall Impact |
| ------ | :-------: | :------: | :------------: | :-------------------: | ------------- |
| bakery | ✓ | ✓ | | cafe/restaurant | 可召回 |
| coffee | ✓ | ✓ | | cafe | 可召回 |
| food_order | ✓ | ✓ | | restaurant | 可召回 |
| general | ✓ | ✓ | | — | **占 cap 名额；Vote 跳过 general 累加** |
| medical | ✓ | ✓ | | hospital | 可召回；标签噪声压制 |
| meeting | ✓ | ✓ | | meeting/interview/… | 标签密度极高 → 偏置 |
| milk_tea | ✓ | ✓ | | cafe | 可召回 |
| tech_ai | ✓ | ✓ | | tech_deploy | 标签密度高 → 偏置 |
| tourism_hotel | ✓ | ✓ | | hotel | 可召回 |
| tourism_pickup | ✓ | ✓ | | taxi 相关弱 | 可召回 |
| tourism_route | ✓ | ✓ | | taxi | 可召回 |
| tourism_transport | ✓ | ✓ | | taxi | 可召回（taxi 主域） |
| transport | ✓ | | **✓** | taxi 可能 | **本轮 CF-E：0 winner 变化** |

**回答（只给证据，不断言 cap 对错）：**

1. fine domain 总数：**13**（含 `general`）。  
2. scope 实际含上表 12 项。  
3. **包含 `general`**。  
4. **是**，截掉 `transport`。  
5. 被截：`transport`。  
6. 排序：字符串字典序后取前 12。  
7. 稳定：是（纯 sort + slice）。  
8. dialog_200 taxi 场景主要依赖 `tourism_transport`，非 `transport`。  
9. CF-E uncapped：**0/200** winner 变化 → 当前集上未观测到“丢正确域”导致的 winner 漂移。  
10. 空配置 = available **经 cap 后**结果；与“未经 cap 的全量 available”**不一致**（差 `transport`）。

---

## 五、Domain Vote 真实输入审计

Vote 公式（代码未改）：

```text
mass = score × SOURCE_WEIGHT[source] × min(1, coverage/4)
MIN_EVIDENCE_SCORE = 0.3   // 仅总分门槛
general / 空 domainId → 不累加
parent_fragment 与 exact_term 均可累加
```

代表性输入（d001 / cafe → coffee）：

| candidate | hitKind | source | domainId | voteMass |
|-----------|---------|--------|----------|---------:|
| 你好 | exact | domain_term | tourism_hotel | 1.175 |
| 热拿铁 | exact | domain_term | coffee | 1.498 |
| 少糖 | exact | domain_term | milk_tea | 1.175 |
| 以北 | exact | domain_term | meeting | 1.175 |

**确认项：**

| 检查项 | 证据结论 |
|--------|----------|
| exact / parent 均进 Vote | ✓ |
| 同词多 Span / parent 重复 mass | ✓（d001「游览」parent×2；d055「医生」parent×3） |
| Base 无意带 domainId | 未观测系统性污染；带 domainId 的多为 domain_term |
| `general` 标签进 Vote | 否（`addDomainScore` 跳过） |
| 常用词过强领域标签 | **✓**（`你好→tourism_hotel`；`医生→meeting`） |

数量对账（全量均值）：

| Case 统计 | Vote Candidates | Unique Terms | Unique Domains | Total Vote Mass |
| ---- | --------------: | -----------: | -------------: | --------------: |
| 均值 /200 | 20.5 | — | — | — |
| 样例 d001 | 17 | — | — | coffee 胜 |

完整 per-case 表见 `domain_vote_accuracy_revalidation.json` → `rows[]`。

---

## 六–七、Winner Accuracy（200/200 Fine Winner 专项）

### dialog_200 是否本来全部是领域业务句？

**否。**

| scenario | n | 业务域预期 | 本轮 winner 实况 |
|----------|--:|------------|------------------|
| cafe / restaurant / hotel / taxi / hospital / meeting / tech_deploy / interview | 110 | 有明确细域 | 部分正确，大量串域 |
| friend / bank / gym / classroom / customer_service / shopping / lexicon_homophone | **90** | 多为一般对话或无对应 fine domain（shopping 不在 Registry） | **61 meeting + 29 tech_ai** |

### 分类表（启发式：场景主域 + raw 语义 + Vote 证据强度；**不**单靠 fixture expected）

| Classification | Count | Rate |
| ----------------------- | ----: | ---: |
| Correct Fine-domain Winner | 41 | 20.5% |
| Reasonable Multi-domain Winner | 84 | 42.0% |
| Wrong Winner | 64 | 32.0% |
| Overconfident | 5 | 2.5% |
| Insufficient Evidence but Forced Winner | 4 | 2.0% |
| Expected General | 2 | 1.0% |
| Unavailable | 0 | 0% |

> 注：`Reasonable` 含大量弱场景被 meeting/tech_ai 标签海淹没后的“形式上有证据”。若将 friend/CS/gym/classroom/shopping/lexicon 等弱场景改判为 **Should Be General / Overconfident**，过度投域更严重（弱场景 **90/90** 细域 winner）。

**宽松可接受（Correct + Reasonable）= 125/200 = 62.5%。**  
**严格正确 = 41/200 = 20.5%。**

### 过度投域专项

| 信号 | 结果 |
|------|------|
| 200/200 fine winner | **不合理** |
| `insufficientEvidence` | **0/200** |
| margin=0 | 4 |
| 0&lt;margin&lt;0.1 | 6（含 medical vs meeting **0.015**） |
| margin≥1.0 | 171（高 margin ≠ 语义正确；标签堆叠可造高分） |
| 单弱候选定域 | hospital：`常规→tech_ai`、`医生 exact→meeting` |
| parent 重复计票 | ✓ 同 fragment 多窗累加 |
| exact+parent 双计 | ✓（同词两条路径同时 mass） |

---

## 八、领域分布偏置

| Domain | Winner Count | Rate | Avg Winner Score | Avg Margin |
| ------ | -----------: | ---: | ---------------: | ---------: |
| meeting | 107 | 53.5% | 11.18 | 5.53 |
| tech_ai | 71 | 35.5% | 14.47 | 4.96 |
| coffee | 10 | 5.0% | 6.32 | 2.09 |
| tourism_transport | 4 | 2.0% | 9.38 | 2.32 |
| tourism_hotel | 4 | 2.0% | 9.05 | 4.53 |
| medical | 2 | 1.0% | 3.54 | 0.01 |
| bakery | 2 | 1.0% | 7.06 | 2.71 |
| food_order / milk_tea / shopping / general | 0 | 0% | — | — |

**回答：**

1. **是**：meeting+tech_ai = **89%**。  
2. **与 dialog_200 场景分布不一致**（cafe 15、hospital 15、taxi 15、restaurant 12… 远低于 meeting/tech 胜出率）。  
3. **词库标签噪声/密度：是**（meeting 4828、tech_ai 2543 tags）。  
4. **scope/cap：本轮非主因**（CF-E=0）。  
5. **常用词标签过宽：是**（`你好`、`医生`、`挂号` 多标）。  
6. **Vote 重复累加：是放大器**（exact+parent、多窗）。  
7. **单 `domainId=domains[0]`：有贡献**（CF-B 31 winner 变），但偏置主峰仍是标签密度。

---

## 九、词库标签质量抽查

| Term | Current Tags | Expected Tags（业务） | Vote Impact | Data Issue? |
| ---- | ------------ | --------------------- | ----------- | :---------: |
| 医生 | **meeting** | medical | hospital 误投 meeting；与 medical parent 对抗 | **是** |
| 你好 | tourism_hotel | （无 / general） | cafe/taxi 注入 hotel mass | **是** |
| 头痛 / 嗓子 | meeting | medical | 压制 medical | **是** |
| 常规 | tech_ai | （弱/medical） | hospital→tech_ai | **是** |
| 挂号 | medical, meeting | medical | multi-tag；`domains[0]` 顺序敏感 | 部分 |
| 拿铁 | coffee, food_order | coffee/food | 多域合理 | 否 |
| 咖啡 | coffee | coffee | 正确 | 否 |
| 服务器 | tourism_transport | tech_ai? | 串域 | **是** |
| 面包 | bakery | bakery | 正确 | 否 |

`医生` 根因定性：**数据标签错误**（非 analyzer 映射；exact 行即 `meeting`）。  
同窗 parent 命中 medical 复合词片段时出现 **exact=meeting vs parent=medical** 对抗（d055 margin 0.015）。

本轮 **未改词库**。

---

## 十、Vote Margin 与 Evidence Strength

| Bucket | Count |
|--------|------:|
| margin = 0 | 4 |
| 0 &lt; margin &lt; 0.1 | 6 |
| 0.1–0.3 | 4 |
| 0.3–1.0 | 15 |
| &gt;1.0 | 171 |

| 问题 | 结论 |
|------|------|
| tie-break 频繁？ | 低 margin 仅 10 例；多数被标签堆出高 margin |
| 极小 margin 定胜负？ | **有**（medical×2，margin≈0.015） |
| `MIN_EVIDENCE=0.3` | **仅总分门槛**；本集 **从未**触发 general |
| 缺 margin gate？ | **是**（代码无 winner-margin 条件） |

本轮 **不新增 gate**。

---

## 十一、sameDomain 完整性

```text
Winner → FineSpanCandidatePool → filterDomainCandidatesPerSpan → sameDomain
sameDomain ⟺ !general ∧ source∈{domain_term,passive_domain_weak} ∧ domainId===winner
∧ hitKind===exact_term（windowCandidateToDomainAwarePick）
```

| 统计 | 值 |
|------|---:|
| sameDomain&gt;0 | 197/200 |
| sameDomain=0 ∧ fine winner | **3** |
| winner 域候选进 filter 前均值 | — |
| 过滤后 lost 均值 | **5.7** /case（多为 parent/非 exact） |

---

## 十二、3 个 sameDomain=0 Case

### d055 / d145（对称）

| 字段 | d055 / d145 |
|------|-------------|
| Raw | 一生/醫生您好…嗓子疼…常规 |
| Winner | **medical** |
| Score map | medical **3.54** · meeting 3.525 · tech_ai 2.35（margin **0.015**） |
| Winner-producing | `医生` **parent_fragment** ×3 → medical |
| Exact | `医生` exact → **meeting**；`嗓子`→meeting；`常规`→tech_ai |
| sameDomain | **0** |
| Primary Root Cause | **Winner Produced Only by Parent Fragment** |
| 标记 | **Vote-to-Filter Eligibility Contract Gap** |

### d136

| 字段 | 值 |
|------|-----|
| Winner | **bakery** |
| Producing | `今天有` / `巧克力` / `油曲奇` / `中杯` 均为 **parent_fragment** |
| Exact winner-domain | **0** |
| Primary Root Cause | **Winner Produced Only by Parent Fragment** |
| 标记 | **Vote-to-Filter Eligibility Contract Gap** |

**结论：Vote 候选资格宽于 Filter（parent 可投票、不可进 sameDomain）。** 本轮不修复。

---

## 十三、多领域合同影响

```text
HotwordEntry.domains[] → WindowCandidate.domainId = domains[0]
```

| Metric | Count |
| ------------------------------------- | ----: |
| Multi-tag terms recalled（命中次数） | 176 |
| Cases affected | 44 |
| Winner changed under full tags CF | **31** |
| sameDomain changed under full tags CF | （未单独计量；same0 仍为 parent-only） |
| 影响 3 个 empty sameDomain？ | **否**（根因是 parent-only，非 tag 顺序） |

---

## 十四、Counterfactual

| CF | 设定 | Winner 变化 |
|----|------|------------:|
| A Runtime | 单 domainId + 当前 Vote + capped scope | 基线 |
| B Full multi-tags | 离线全 tags 投票 | **31** |
| C Remove suspected noisy | 离线剔除小噪声词表 | **6**（噪声远大于该小表） |
| D Parent excluded | 离线禁用 parent 投票 | **27**（**0** 变 general） |
| E No scope cap | 含 `transport` 全量重放 | **0** |

---

## 十五、代表性 Case（40，摘要）

完整列表见 JSON `representative[]`。覆盖：

- 高 margin 正确：cafe→coffee（d001）、tech_deploy→tech_ai、interview→meeting  
- 低 margin / 误投：hospital→meeting/tech_ai、taxi→meeting、restaurant→meeting  
- same0：d055/d136/d145  
- 标签噪声：`医生`/`你好`/`常规`  
- meeting 场景整组→tech_ai（会议内容偏研发时多域可争，但标签密度仍主导）

---

## 十六、Diagnostics 完整性

| 字段 | Runtime metrics | 本轮采集 | 缺口定位 |
|------|:---------------:|:--------:|----------|
| resolvedRecallDomainScope | ✓ | ✓ | — |
| domainLookupExecuted | ✓ | ✓ | — |
| candidate graphSource / domainId | pool 内有 | ✓（实验 patch 捕获） | 默认 trace 需 diagnostics=trace |
| domain score map / winner / margin | ✓ | ✓ | — |
| insufficientEvidence | ✓ | ✓ | — |
| sameDomain / base / fallback list | 计数 ✓；明细需 filteredSets | 实验捕获 | Consumer 摘要层 |
| drop reason | 无专用 ABI | 实验推导 | **Diagnostics**（本轮不扩 ABI） |

---

## 十七、Historical / Frozen 对照

| Frozen Principle | Current Result | PASS / GAP / DRIFT |
| ---------------------------------------- | -------------- | ------------------ |
| Empty config = available fine domains | 经 cap(12)；丢 transport；含 general | **DRIFT**（cap + general 占位） |
| term_domain_tags is domain SSOT | 是；但质量极不均 | PASS 机制 / **GAP 质量** |
| All valid domain candidates vote | 有 domainId 的进 Vote | PASS |
| Fine-domain winner only | 200/200；从不回落 general | **GAP**（不足证据原则失效） |
| General when evidence insufficient | 0/200 | **GAP** |
| Multi-domain terms supported | 仅 `domains[0]` | **GAP** |
| Winner produces sameDomain | 197/200；3 parent-only 失败 | **GAP**（F） |
| Vote evidence compatible with Filter | parent 可投不可入桶 | **GAP**（F） |
| Coarse domain only calibrates | 未观测 LLM 覆盖 winner | PASS |
| No LLM winner override | 本链无 | PASS |

---

## 十八、必须回答

1. **200/200 fine winner 是否合理？** → **否**。  
2. **dialog_200 是否全部应归细域？** → **否**（约 90 句弱域/一般对话）。  
3. **Domain Vote 准确率？** → 严格 **20.5%**；宽松 **62.5%**。  
4. **Wrong Winner？** → **64**。  
5. **Should Be General（启发式）？** → 分类表 2+4；弱场景实为 **90** 句被强制细域。  
6. **过度投域？** → **是**。  
7. **meeting / tech_ai 异常偏高？** → **是（89%）**。  
8. **偏置来源？** → **主：词库标签密度/错误；次：Vote 累加与无 margin/general gate；辅：单 domainId；cap 非本轮主因**。  
9. **cap 丢掉？** → **`transport`**。  
10. **cap 影响正确 Recall/Vote？** → 本集 **未观测 winner 影响（CF-E=0）**。  
11. **general 占 cap 名额？** → **是**。  
12. **3× sameDomain=0 根因？** → **Winner Produced Only by Parent Fragment**（Vote-to-Filter Gap）。  
13. **Vote 与 Filter 资格一致？** → **否**。  
14. **parent 能投票不能进 sameDomain？** → **是**。  
15. **多领域单 domainId 影响？** → CF **31/200** winner。  
16. **先修 Multi-domain Contract？** → **否（非最早最大）**；可并行评估。  
17. **先修 Lexicon Tags？** → **是（本轮唯一优先）**。  
18. **先修 Vote Logic/Threshold？** → 标签修复后若仍过度投域再开；当前不调参。  
19. **可进 Assembly Diversity？** → **否**。  
20. **下一步唯一优先？** → **Lexicon Domain Tag Quality Repair Plan**。

---

## 十九、Final Verdict（复述）

## G — Mixed Root Causes

量化后选择最早且影响最大的下一步：

```text
Lexicon Domain Tag Quality Repair Plan
```

次级（标签修复后再验）：

```text
Domain Vote Logic Repair Plan          （general / margin / parent mass）
Vote-to-Filter Eligibility Contract    （3× sameDomain=0）
Multi-domain Candidate Contract        （31 CF winner）
```

**非当前阻塞：** `capFineDomains(12)`（本集 winner 无感）。

**明确禁止（直至 Verdict A）：**

```text
Sentence Assembly Candidate Diversity Audit / 开发
KenLM / Gate / Apply 优化
```
