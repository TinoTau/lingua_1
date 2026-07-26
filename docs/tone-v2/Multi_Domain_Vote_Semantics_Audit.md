# Multi-Domain Vote Semantics Audit

```text
STATUS: PHASE A AUDIT — DEVELOPMENT GATE FAIL
Task: DomainId Full Removal and Multi-Domain Vote Repair
Date: 2026-07-19
HEAD: 262b3d3 (stable version)
Nature: 只读专项审计 · 门禁未通过 · 禁止进入 Phase B
```

---

## 1. Executive Verdict

在 **不恢复 `domainId`、不采用 `/domains.length`、不新增 DTO/`domainWeights` 字段、不按域复制 Candidate** 的硬约束下：

```text
无法同时证明一种 Vote 规则满足全部开发门禁。
```

| 方案 | 结论 |
|------|------|
| A 逐域完整 VoteMass | **REJECT** — Candidate 总贡献随 `domains.length` 成倍放大（实测 amplify=2~4） |
| B 均分 | **REJECTED BY FROZEN CONTRACT** |
| C span-top + 均分份额 | 数学上仍是 B；且未解冻均分 |
| D 单域锚点 + 多域仅增强已有分 | 无锚点场景 → `general`；**接送+机场 / 预订+接送+机场** 无法靠共同细域胜出（违反“多 span 共同支持应能胜出”） |

```text
DEVELOPMENT GATE: FAIL
MULTI-DOMAIN VOTE AUDIT BLOCKED — STOP
```

`domainId` 全量删除的方向仍有效，但 **Vote 计分规则尚未可验收**；不得编码。

---

## 2. Git 状态

| 项 | 值 |
|----|-----|
| HEAD | `262b3d32717db97807fa48103aa44f1ea518361a` · `stable version` |
| Vote 半成品 | **无**多域 Vote / 无 `WindowCandidate.domains` |
| 相关脏文件 | `utterance-domain-vote.ts`（R2 诊断字段）、`recall-topk`（仍 `domains?.[0]`）、`assemble-domain-aware`（KNOWN DEBT 注释）、`v4-types`（仍 `domainId`） |

```text
PRE-EXISTING DOMAIN CHANGE: YES（工作区有 SSOT/R2 残留修改，但无本任务 Vote 半成品）
```

---

## 3. CURRENT IMPLEMENTED VOTE FORMULA

源码：`utterance-domain-vote.ts` · 主链入口 `voteUtteranceDomainFromPool`。

```text
对每个 coarse span 池中每个 candidate：
  if isCovered: skip
  if parent_fragment:
      mass = score × SOURCE_WEIGHT[source] × min(1, coverageSyllables/4)
      domainScores[domainId] += mass   // 单值 domainId
      parentTermId 去重仅影响 parentTermVoteCount，仍计分
  if exact_term:
      同上，coverage = syllableEnd - syllableStart

DomainWeight: 未乘（代码无 tag weight）
evidence unit: Candidate（非 span 去重）
同 span 多 Candidate: 全部未覆盖者各自加分（无 per-span Vote cap）

finalize:
  totalEvidence = sum(domainScores)
  if totalEvidence < 0.3 → utteranceDomain=general, insufficientEvidence=true
  else winner = max score；平票 → localeCompare(domainId) 较小者
  voteMargin = winnerScore - runnerUpScore
```

`SOURCE_WEIGHT`：`domain_term=1.0`，`passive_domain_weak=0.2`，`base_term=0.5`，…

主链 Vote **在** `filterDomainCandidatesPerSpan` / per-span Assembly cap **之前**；`exactTopK` 只限制召回写入数量，不限制同 span 已入池者是否都投票。

---

## 4. CURRENT FROZEN INTENDED VOTE FORMULA

`DOMAIN_RECALL.md` §4（仍有效）：

```text
VoteMass = CandidateScore × SourceWeight × CoverageWeight × DomainWeight
MIN_EVIDENCE_SCORE = 0.3
Winning Domain 必须是 Fine Domain
```

`Runtime_SSOT_Contract_Freeze.md`：

```text
禁止 weight / domains.length 或其它未冻结 Vote 公式
```

---

## 5. 差异

| 点 | 冻结意图 | 现行代码 |
|----|----------|----------|
| DomainWeight | 公式含此项 | **未落地**（恒等价 1） |
| 多 tag 证据 | 未冻结如何拆/乘 | 仅 `domainId`（≈`domains[0]`） |
| `/domains.length` | **禁止** | 无 |
| Fine eligibility | Parent 不得为 winner | 代码未校验 hierarchy parent；只跳过 `general` |
| Context Prior | Vote **后** soft | 不在 `voteUtteranceDomainFromPool` 内 |

---

## 6. domainId 调用复核（本链）

| 文件 | 符号 | 类型 | 本轮若开发应 | 替代 |
|------|------|------|--------------|------|
| `v4-types.ts` | `WindowCandidate.domainId` | Candidate | 删除 | `domains[]` |
| `recall-topk-for-windows.ts` | `domains?.[0]` 写入 | 主链压缩 | 删除压缩 | 写完整 `domains` |
| `utterance-domain-vote.ts` | `PoolVoteCandidate.domainId` / `addDomainScore` | Vote | 改读 `domains` | **公式未定** |
| `assemble-domain-aware-span-sets.ts` | `=== winningDomain` | sameDomain | `includes` | 依赖 winner |
| `window-candidate-to-pick.ts` | 拷贝 domainId | 中间态 | 改 `domains` | Pick 仍剥离 |
| `domain-assembly-types.ts` | DomainAware.domainId | 中间态 | 改/删 | |
| `types.ts` GraphEdge/Parent* | domainId | Shadow | 删或改 domains | |
| `emit` / parent / greedy / coarse-graph | domainId | Shadow | 同步 | |
| orchestrator metrics | `c.domainId` | metrics | 改 domains 非空 | |
| 测试 / experiments | domainId | 测试 | 同步 | |
| SQL `domain_id` / Scope `domainIds` / IME | 非本链 | **保留** | — |

---

## 7. 同 span 重复计票

```text
现行：Vote 最小证据单位 = Candidate（exact_term / parent_fragment）
同 span 多个 Candidate 可同时加分（仅跳过 isCovered）
Assembly 的 per-span cap 发生在 Vote 之后，不抑制刷票
```

同 span「少糖+中杯」：方案 A/B 对三域各加两份 mass；方案 C（仅 top）只计「中杯」，总贡献受控，但份额仍依赖均分。

```text
SAME-SPAN DUPLICATE VOTE CONTROLLED（现行代码）: NO
```

---

## 8. 粗细领域关系

`domain_hierarchy`（v10）：

```text
travel → tourism_pickup|hotel|route|transport
restaurant → coffee|milk_tea|bakery|food_order
transportation → transport
```

**注意：** `transport` 与 `tourism_transport` **不是**父子，分属不同 coarse。

「预订 + 接送 + 机场」：

* 共同细域信号：`tourism_transport`（接送∩机场）  
* `transport` 仅机场；`food_order`/`tourism_hotel` 等来自预订多标签  
* **不应**靠 `localeCompare` 在平票中选 `food_order`（当前 `domains[0]` 路径在「预订+前台」会错成 food_order）  
* 方案 A 在该场景选出 `transport`（margin 很小），亦非理想  
* 方案 B/C 选出 `tourism_transport`（更合理）但依赖均分  
* 方案 D → `general`（无单域锚点）— 丢掉共同支持细域  

本轮 **不修改** hierarchy 数据。

---

## 9. 方案 A–D

### A 逐域完整计分

```text
for d in domains: domainScores[d] += mass
```

* 总贡献 = `mass × |domains|`（少糖 amplify=3，菜单=4）  
* 大量平票 + `localeCompare`  
* **拒绝**（门禁项 8）

### B 均分

```text
for d in domains: domainScores[d] += mass / |domains|
```

* 出处：`Multi_Domain_Candidate_Contract_Audit` §21「仅建议，本轮不采用」；Deviation Audit / Runtime SSOT Freeze **禁止**  
* **REJECTED BY FROZEN CONTRACT**

### C「多领域支持、共同领域累计」（不新增 DTO）

尝试：`per-span 只取最高分 Candidate` + 对其 domains 均分份额。

* 控制同 span 刷票：**有帮助**  
* Candidate 总贡献有界：**是**（= mass）  
* 但有界方式 = **均分** → 仍撞冻结禁止  
* 无均分的「span 上对每个 domain 取 max mass」会让单 Candidate 对多域各加 max → 重回 A 类放大  

**无合格无均分实现。**

### D 多领域只增强锚点

```text
pass1: |domains|==1 → 全额 mass
pass2: 多域词仅向已有 score>0 的域分配（总额=mass）
无锚点 → general
```

* 有锚点时表现好（菜单+奶茶→milk_tea；预订+前台→tourism_hotel）  
* **少糖+中杯、接送+机场、预订+接送+机场** → general 或失真 → 违反「多 span 共同支持应能胜出」  
* 两遍扫描，无新 DTO，但语义缺口不可接受  

---

## 10. 真实场景对比（Lexicon v10 · Electron）

| 场景 | 当前 domains[0] | A | B | C | D |
|------|-----------------|---|---|---|---|
| 少糖+中杯 | coffee | coffee(平) | coffee(平) | coffee(平) | **general** |
| 少糖+中杯+奶茶 | coffee | milk_tea | milk_tea | milk_tea | milk_tea |
| 少糖+中杯+拿铁 | coffee | coffee(平) | coffee(平) | coffee(平) | **general** |
| 菜单+奶茶 | **bakery** | milk_tea | milk_tea | milk_tea | milk_tea |
| 菜单+订单 | food_order | food_order | food_order | food_order | food_order |
| 预订+前台 | **food_order** | tourism_hotel | tourism_hotel | tourism_hotel | tourism_hotel |
| 预订+酒店 | **food_order** | tourism_hotel | tourism_hotel | tourism_hotel | tourism_hotel |
| 预订+接送 | food_order | food_order(平) | tourism_pickup(平) | tourism_pickup(平) | **general** |
| 接送+机场 | tourism_transport | tourism_transport | tourism_transport | tourism_transport | **general** |
| 预订+接送+机场 | tourism_transport | **transport** | tourism_transport | tourism_transport | **general** |
| 少糖+中杯+菜单 | coffee | coffee(平) | coffee(平) | coffee(平) | **general** |
| 菜单 alone | bakery | bakery(平) | bakery(平) | bakery(平) | **general** |
| 订单+前台 | food_order | food_order | food_order | food_order | food_order |
| 拿铁+机场 | tourism_transport | tourism_transport(平) | tourism_transport(平) | tourism_transport(平) | **general** |
| 奶茶+酒店 | milk_tea | milk_tea(平) | milk_tea(平) | milk_tea(平) | milk_tea(平) |

A 最大 amplify：菜单类 = **4**。

---

## 11. 多领域总贡献

```text
方案 A: totalContribution = mass × |domains|  → 无界放大（随标签数）
方案 B/C: totalContribution = mass           → 有界，但是均分
方案 D: 锚点 mass；多域增强总额 ≤ mass；无锚点 0
```

---

## 12. 平票与排序依赖

无锚点多标签场景下 A/B/C 常 **margin=0**，winner 由 `localeCompare` 决定（coffee < food_order < milk_tea 等）。  
这不是领域语义，是字符串次序 — **不能**作为可冻结生产行为。

---

## 13. 推荐公式

```text
RECOMMENDED VOTE RULE:
NONE — 无方案通过全部硬约束
```

后续方向（**仅建议另开票，本轮不开发**）：

1. 冻结并验收 **DomainWeight**（含是否归一化）后再定多域计分；或  
2. 显式解冻「有界份额」合同（若接受均分的数学形式，须书面取代现行禁止）；或  
3. 引入 **不新增 DTO** 的 span 级共现规则并证明不依赖 `localeCompare` 平票 — 需新一轮可证伪实验。

---

## 14. 开发门禁

```text
RECOMMENDED VOTE RULE:
NONE
```

```text
WHY NOT FULL MASS PER DOMAIN:
Candidate 总贡献随 domains.length 成倍放大（实测 2~4）；大量平票依赖 localeCompare；不符合门禁「总贡献有界」与「单域锚点区分力」。
```

```text
WHY NOT DIVIDE BY DOMAIN COUNT:
Runtime_SSOT_Contract_Freeze 明确禁止；Multi_Domain Audit / Deviation Audit 否决均分；标记 REJECTED BY FROZEN CONTRACT。
```

```text
TOTAL CANDIDATE CONTRIBUTION BOUNDED:
NO（无合格推荐式）
```

```text
SAME-SPAN DUPLICATE VOTE CONTROLLED:
NO（现行未控；推荐式亦未确立）
```

```text
SINGLE-DOMAIN ANCHOR PRESERVED:
NO（无合格推荐式）
```

```text
GENERAL FALLBACK PRESERVED:
YES（现行 MIN_EVIDENCE 路径仍在；但不足以单独开闸）
```

```text
DEVELOPMENT GATE:
FAIL
```

---

## 15. 修改范围（门禁 FAIL → 不执行）

Phase B **全部禁止**。若未来门禁 PASS，再列 MUST MODIFY。

---

## 16. 风险矩阵

| 风险 | 若强行开发 |
|------|------------|
| 选 A | 多标签词统治平票 / 放大 |
| 选 B | 违反 Freeze |
| 选 D | 旅游共现句变 general |
| 保留 domainId | 违反本任务架构结论 |
| 未证伪就改 Freeze | 合同空转 |

---

## 强制输出（Phase A）

```text
CURRENT VOTE FORMULA:
mass = score × SOURCE_WEIGHT[source] × min(1, coverage/4);
domainScores[domainId] += mass;  // single domainId only; DomainWeight unused
winner = argmax(domainScores) with localeCompare tie-break;
if sum < 0.3 → general / insufficientEvidence
```

```text
RECOMMENDED VOTE FORMULA:
NONE
```

```text
FULL MASS PER DOMAIN:
REJECT
```

```text
DIVIDE BY DOMAIN COUNT:
REJECT
```

```text
TOTAL CANDIDATE CONTRIBUTION BOUNDED:
NO
```

```text
SAME-SPAN DUPLICATE VOTE CONTROLLED:
NO
```

```text
DEVELOPMENT GATE:
FAIL
```

```text
MULTI-DOMAIN VOTE AUDIT BLOCKED — STOP
```

```text
MULTI-DOMAIN VOTE REPAIR BLOCKED — STOP
```
