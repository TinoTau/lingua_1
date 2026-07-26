# WindowCandidate Domain Dependency Pre-Development Audit

```text
STATUS: PRE-DEVELOPMENT AUDIT
Authority: Runtime_SSOT_Contract_Freeze.md (Runtime SSOT Contract V1)
Nature: 只读 · 开发前 · 完成后立即停止
Date: 2026-07-19
```

---

## 1. Executive Verdict

真实 Lexicon v10 + 正式 `filterDomainCandidatesPerSpan` 已复现：

```text
Hotword.domains 含 utteranceDomain，
但 WindowCandidate.domainId = domains[0] ≠ utteranceDomain，
→ sameDomain 排除该词（甚至不进 fallback）。
```

已确认 ≥6 个真实例子（少糖/中杯/菜单/预订/接送/机场）。

`WindowCandidate` **没有** `hotword` / 行引用 / 其它可回找 `Hotword.domains[]` 的现有字段。  
**不能零新增字段修复。**  
最小可行方案：仅给 `WindowCandidate` 增加现有名称 `domains`（只读数组），**保留 `domainId` 供 Vote**，**只改 sameDomain**；**禁止改 Vote / Assembly / KenLM / Shadow**。

**PRIMARY VERDICT: B**

```text
DEVELOPMENT: APPROVE
（须先对 Freeze 做受控解冻：允许 Candidate 持有 domains[] 只供 sameDomain；仍禁止传播到 Pick/KenLM）
```

---

## 2. 冻结基线

权威：`docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`

```text
term + term_domain_tags
        ↓
Hotword.domains[] / domainWeights
        ↓
WindowCandidate.domainId = Hotword.domains?.[0]   ← 遗留单值
        ↓
Vote → utteranceDomain
        ↓
sameDomain + base + fallback
        ↓
SpanReplacementPick → Assembly → KenLM
```

现行约束（本轮不改结论，仅审计）：

* `domains[0]` **无业务优先级**（仅 `localeCompare` 稳定排序后的首项）
* `domainId` 不是完整 `domains[]`
* Pick / Assembly / KenLM 不得含领域字段
* Shadow 不进主链
* 当前 Freeze Owner 表写明 Candidate **禁止**持 `domains[]` — 开发若增加 `domains`，必须作为 **Membership Repair 受控解冻**，不得静默违反

---

## 3. Git 状态

工作区仍有大量未提交变更（Runtime SSOT Freeze Readiness、CFG-01、Lexicon 等）。

相对本审计主题：

| 检查 | 结果 |
|------|------|
| 第二份 Freeze | **无**（索引指向唯一 `Runtime_SSOT_Contract_Freeze.md`） |
| WindowCandidate 已加 `domains[]` | **无** |
| `domains.includes` 试验代码 | **无**（仅注释提及） |
| `selectedDomain` 业务字段 | **无** |
| 错误 multi-domain 测试恢复 | **无** |
| 未冻结的 domainId 修复半成品 | **无** |

```text
PRE-EXISTING UNFROZEN CHANGE: YES（工作区脏，但非本问题的半成品修复）
```

结论不以脏工作区中的未冻结改动为设计依据；以当前源码 + FROZEN 合同为准。

---

## 4. Lexicon → Hotword

| 项 | 证据 |
|----|------|
| 多行 `term_domain_tags` | SQL + `mergeDomainTierRows` union |
| 不丢非首行 | `domains.add(domainId)` 后排序 |
| `Hotword.domains[]` 全量 | Electron：少糖=`[coffee,food_order,milk_tea]` |
| 排序 | `localeCompare` 稳定输出 |
| `domains[0]` 优先级 | **无** — 仅排序首项 |
| Base | `domains=[]`（如单标签外词；你好类） |
| `general` 细标签 | 不作为 fine tag 使用 |

```text
domains[0] 没有业务优先级含义。
```

Hotword 领域相关字段：`domains[]`、`domainWeights`。  
不存在：`domain` / `primaryDomain` / `selectedDomain`。

---

## 5. Hotword → WindowCandidate

### 5.1 正式主链写入

| 文件 | 函数 | 构造 | domainId 来源 | 主链 |
|------|------|------|---------------|------|
| `recall-topk-for-windows.ts` | `recallTopKForWindows` | `WindowCandidate` | `hit.hotword.domains?.[0]` | **是** |

```text
正式主链 domains[0] 写入点 = 1
```

同文件 `resolveGraphSource(domainId)` 用该单值决定 `domain_term` / `base_term` / weak — **读** 刚写出的 `domainId`，不是第二写入点。

### 5.2 其它写入 / 拷贝（非第二压缩源）

| 文件 | 作用 | 分类 |
|------|------|------|
| `window-candidate-to-pick.ts` | DomainAware 拷贝 `domainId` | 主链 sameDomain 中间态 |
| `emit-v4-evidence.ts` | GraphEdge / ParentEvidence | Shadow |
| `assemble-parent-term-span-candidates-v4.ts` | Parent → GraphEdge | Shadow |
| `coarse-candidate-graph.ts` | merge 保留较高分边的 `domainId` | Shadow |
| 测试夹具 | 手写 `domainId:` | 测试 |

### 5.3 WindowCandidate 现有字段（方案 1/2）

`v4-types.ts` 的 `WindowCandidate`：

* **有** `domainId?`
* **无** `hotword` / `recallHit` / `termId` / `sourceId` / `domains`
* 构造时只取 `hit.hotword.word`、score、tone 等，**丢弃** Hotword 引用

```text
方案 1（复用现有引用读 Hotword.domains）：不可行
方案 2（已有等价数组字段）：不可行
```

---

## 6. 全部 domainId 读取点

| 文件 | 函数 | 目的 | 影响正式结果 | 必须保留 | 类 |
|------|------|------|--------------|----------|-----|
| `utterance-domain-vote.ts` | `addDomainScore` / `voteUtteranceDomainFromPool` | Vote 计分 | **是** | **是** | A |
| `utterance-domain-vote.ts` | `applyDomainVoteToEdges` | Shadow 边 soft×0.3 | Shadow | 是（Shadow） | C |
| `assemble-domain-aware-span-sets.ts` | `isSameDomainCandidate` | sameDomain | **是** | 改读法后仍需领域信息 | B |
| `window-candidate-to-pick.ts` | `windowCandidateToDomainAwarePick` | 中间态拷贝 | 间接（供 B） | 是 | B |
| `span-assembly-v4-orchestrator.ts` | `voteEligibleDomainCandidateCount` | metrics | 否 | 可保留 | D |
| `recall-topk-for-windows.ts` | `resolveGraphSource` | source 分类 | 是（domain_term vs base） | 是（仍可用 domainId 或 domains 非空） | A/邻接 |
| `emit-v4-evidence.ts` | emit | Shadow | 否 | 不改 Shadow | C |
| `assemble-parent-term-…` | parent 装配 | Shadow | 否 | 不改 | C |
| `select-greedy-longest-parent-term.ts` | 与 utteranceDomain 比较 | Shadow | 否 | 不改 | C |
| `coarse-candidate-graph.ts` | merge | Shadow | 否 | 不改 | C |
| `*-test.ts` | 夹具 | 测试 | — | — | E |

精确回答：

1. Vote **读取** `WindowCandidate.domainId` — **是**  
2. sameDomain **读取**（经 DomainAware）`domainId` — **是**  
3. Assembly 正式 Pick — **否**（已剥离）  
4. KenLM — **否**  
5. Shadow — **是**（诊断）  
6. 其它正式业务 — `resolveGraphSource`、metrics  
7. 重复正式 sameDomain 判断 — **仅一处** `isSameDomainCandidate`

---

## 7. Vote 依赖

```text
当前 Vote 如何得到 domainId？
→ voteUtteranceDomainFromPool 对每个未覆盖 candidate 调用
  addDomainScore(..., candidate.domainId, ...)
→ 只给这一个 domainId 累加；不读 domains[]；无均分；无多域遍历
→ winner = utteranceDomain
```

单候选「少糖」Electron：

```text
domainId=coffee → Vote winner=coffee，domainScores={coffee:…}
```

即使真实语境是 milk_tea，Vote 也只看见 coffee。

```text
能否不改 Vote、只修正 sameDomain？
→ 能（针对本审计定义的 sameDomain 误排除）。
→ Vote 仍把票投给 domains[0]，属既有债务 / 另开 Vote Semantics；本轮 Freeze 禁止改 Vote 公式。
```

证据：`utterance-domain-vote.ts` 无 `domains` 读取；Freeze §1 禁止均分。

---

## 8. sameDomain 依赖

追踪：

```text
utteranceDomain ← domainAssembly.vote.utteranceDomain
Candidate ← activeCandidates → DomainAware pick（含 domainId）
base ← graphSource === 'base_term'
sameDomain ← domain_term|passive_domain_weak && domainId === winningDomain
fallback ← 仅当 isGeneral（insufficientEvidence || winner==='general'）
输出 ← selected → SpanReplacementPick（无 domainId）
```

正式判断 **唯一**：`isSameDomainCandidate`。

重要行为：winner 为细领域且不满足 sameDomain/base 时，**直接丢弃**（不进 fallback）。  
故 milk_tea 语境下「少糖」不是进错桶，而是 **从 Assembly 候选中消失**。

修正 sameDomain 后：

* **不**改变 Vote 输入（若不同时改 domainId 写入）  
* **不**复制 Candidate  
* 仅可能让更多词进入 sameDomain 桶 → Sentence 组合可能增多，但仍受 per-span cap 与 `maxSentenceCandidates≤16` 约束  

---

## 9–11. Assembly / KenLM / Shadow

| 边界 | 状态 |
|------|------|
| DomainAware 可持 `domainId` | 是（中间态） |
| SpanReplacementPick | **无** domainId/domains（已证） |
| KenLM | 纯文本 |
| Shadow | 读 domainId；**本轮 UNCHANGED** |

---

## 12. Base / general / fallback

| 规则 | 现状 | 最小修复后要求 |
|------|------|----------------|
| Base `domains=[]` | `resolveGraphSource` → `base_term` | 仍只进 base |
| `utteranceDomain=general` | insufficientEvidence | 仍只证据不足；**不得** `domains.includes('general')` |
| fallback | 仅 isGeneral | 保持；细领域 winner 下错排除词当前是丢弃，修复后进 sameDomain |

---

## 13. 真实错误复现

环境：Electron ABI · Lexicon v10 · `filterDomainCandidatesPerSpan` 正式实现 · fresh dist。

### 词表

| 词 | DB tags | Hotword.domains | domainId | 说明 |
|----|---------|-----------------|----------|------|
| 少糖 | coffee, food_order, milk_tea | 同左 | coffee | 多域 |
| 中杯 | coffee, food_order, milk_tea | 同左 | coffee | 多域 |
| 菜单 | bakery, coffee, food_order, milk_tea | 同左 | bakery | 多域 |
| 预订 | food_order, tourism_hotel, tourism_route, transport | 同左 | food_order | 多域 |
| 订单 | food_order | 同左 | food_order | 单域 |
| 前台 | tourism_hotel | 同左 | tourism_hotel | 单域 |
| 接送 | tourism_pickup, tourism_transport | 同左 | tourism_pickup | 多域 |
| 机场 | tourism_transport, transport | 同左 | tourism_transport | 多域 |

### 误排除（domains 含 winner，domainId≠winner，sameDomain=false）

| 词 | utteranceDomain | 当前 sameDomain | BUG |
|----|-----------------|-----------------|-----|
| 少糖 | milk_tea | false | **YES** |
| 中杯 | milk_tea | false | **YES** |
| 菜单 | milk_tea | false | **YES** |
| 预订 | tourism_hotel | false | **YES** |
| 接送 | tourism_transport | false | **YES** |
| 机场 | transport | false | **YES** |

对照（应排除 / 应命中）：

| 少糖 × tourism_hotel | domains 不含 | sameDomain=false | 正确排除 |
| 少糖 × coffee | domainId 匹配 | sameDomain=true | 正确命中 |

```text
PROBLEM REPRODUCED: YES
SAME-DOMAIN FAILURE CONFIRMED: YES
```

---

## 14. 最小方案 1–4 对比

| 方案 | 内容 | 结论 |
|------|------|------|
| 1 复用现有引用 | Candidate 无 Hotword/行引用 | **不可行** |
| 2 复用现有数组 | 无等价 `domains` | **不可行** |
| 3 增加现有名 `domains` | `WindowCandidate.domains?: readonly string[]`；sameDomain `includes`；保留 `domainId` 给 Vote | **推荐** |
| 4 删除 domainId | Vote/`resolveGraphSource` 仍依赖 | **默认不做** |

禁止方向（均不合格）：side map、新服务、改 Vote 多域计分、Pick/KenLM 带 domains、复制 Candidate、改 Shadow、DomainWeight。

---

## 15. 是否可以零新增字段

```text
ZERO NEW FIELD SOLUTION: NO
```

原因：Hotword 引用在构造 Candidate 时已丢弃；无现有数组可复用。

---

## 16. 为何只增加 `domains`

* 项目已有名称：`Hotword.domains`  
* sameDomain 需要「一个词现有的完整 domains[]」  
* Vote 继续用遗留 `domainId`，避免改公式  
* 一个召回结果仍一个 Candidate：`domains` 只是只读数组，不按域复制  
* 转 Pick 时继续剥离（`domainAwarePickToSpanReplacementPick` 已不写领域字段；DomainAware 增加 `domains` 后也必须剥离）

**受控解冻说明：** 现行 Freeze Owner 表 Candidate 行写「禁止持 domains[]」。开发前须在 Freeze 中改为：允许 `WindowCandidate.domains` **仅**供 Vote 后 sameDomain；仍禁止进入 Pick/KenLM/Shadow 扩张。

---

## 17. 性能与 Candidate 数量

| 项 | 预期 |
|----|------|
| Candidate 数量 | **不变**（不按域复制） |
| 新增 DB 查询 | **无**（从 Hotword 已有数组拷贝一次） |
| sameDomain | `includes` O(k)，k≤少量 tags |
| Sentence / KenLM 条数 | 可能因 sameDomain 更完整而略增，仍 ≤16 |

```text
CANDIDATE DUPLICATION: FORBIDDEN
```

---

## 18. 测试方案（设计，不编写）

| ID | 场景 | 预期 |
|----|------|------|
| 18.1 | domains=[coffee,food_order,milk_tea], domainId=coffee, utteranceDomain=milk_tea | 进 sameDomain |
| 18.2 | 同上，utteranceDomain=tourism_hotel | 不进 sameDomain |
| 18.3 | domains=[] | 进 base |
| 18.4 | Vote 前后 utteranceDomain/domainScores/winnerScore/voteMargin 相同 | Vote 不变 |
| 18.5 | 多域词仍 1 Candidate | 不复制 |
| 18.6 | Pick keys 无 domainId/domains/selectedDomain | 边界 |
| 18.7 | KenLM 纯文本，cap≤16 | 边界 |
| + | `domains.includes('general')` 不得为 true 路径 | general |
| + | acceptance fresh dist Electron | stale dist |

触及：`assemble-domain-aware-span-sets.test.ts`、`freeze-contract`（若断言 Candidate 字段）、`runtime-ssot-acceptance`、必要时 recall-topk 构造断言。

---

## 19. 修改文件清单

### MUST MODIFY

* `span-assembly-v4/v4-types.ts` — `WindowCandidate.domains?`
* `span-assembly-v4/recall-topk-for-windows.ts` — 写入 `domains: hit.hotword.domains`（只读拷贝）；**保留** `domainId = domains?.[0]`
* `span-assembly-v4/domain-assembly-types.ts` — DomainAware 可临时持 `domains`（或 sameDomain 直接从 WindowCandidate 读，二选一最小）
* `span-assembly-v4/window-candidate-to-pick.ts` — 中间态传递；**Pick 仍不得含 domains/domainId**
* `span-assembly-v4/assemble-domain-aware-span-sets.ts` — sameDomain：`domains?.includes(winningDomain)`（且 graphSource 条件保留）；**禁止**对 general includes
* `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md` — 受控解冻 Candidate/`sameDomain` 债务表述（开发票内，非本审计修改）

### TEST ONLY

* `assemble-domain-aware-span-sets.test.ts`
* 必要时 `freeze-contract.test.ts`、`runtime-ssot-acceptance.cjs`

### MUST NOT MODIFY

* `utterance-domain-vote.ts`
* Lexicon SQL / `term_domain_tags` / `domain_hierarchy` / sqlite
* `build-sentence-candidates.ts`（除非证实 Pick 泄漏，否则不改）
* KenLM adapter
* Shadow Beam 文件（emit/parent/greedy/coarse graph）
* Context Prior / DomainWeight

若开发中发现 DomainAware 不增加 `domains`、改为在 `filterDomainCandidatesPerSpan` 直接读 `WindowCandidate.domains`，可减少 `domain-assembly-types` / pick 改动 — 仍属 MUST MODIFY 集合内优化，不扩大到 Vote。

---

## 20. MUST NOT MODIFY（重申）

见上。无「不可替代」理由要求修改 Vote 或 Lexicon 数据。

---

## 21. 风险矩阵

| 风险 | 触发 | 影响 | 防护 |
|------|------|------|------|
| Vote 结果变化 | 改 domainId 写入或 Vote 读 domains | 句级 winner 漂移 | 禁止改 Vote；18.4 |
| 字段扩散 | Pick/KenLM 带 domains | SSOT 破坏 | 18.6/18.7；freeze gate |
| Candidate 重复 | 按域复制 | 组合爆炸 | 18.5 |
| Base 混淆 | 空 domains 当 general | 桶错误 | 18.3 |
| general 混淆 | includes(general) | 误入 sameDomain | 显式禁止 |
| Shadow 扩张 | 为类型统一改 Shadow | 范围膨胀 | MUST NOT |
| stale dist | 未 clean build | 假结果 | acceptance |
| 数组被下游改写 | 共享可变数组 | 污染 Hotword | 写入时浅拷贝 `...(domains??[])` |
| 新名词膨胀 | 新 DTO/helper 名 | 维护成本 | 只用 `domains` |
| 文档漂移 | 写成完整新架构 | 合同失控 | 只标债务修复 |

---

## 22. DTO 边界建议

| 对象 | 建议 |
|------|------|
| Hotword | **KEEP** `domains[]` / `domainWeights` |
| WindowCandidate | **KEEP** `domainId`；**ADD EXISTING NAME** `domains` |
| UtteranceDomainVoteResult | **UNCHANGED** |
| DomainAware Candidate | **USE EXISTING FIELD** 路径读 `domains` 或临时持有；**MUST NOT** 流入 Pick |
| SpanReplacementPick | **MUST NOT CONTAIN** domainId / domains |
| Sentence Candidate | **MUST NOT CONTAIN** domainId / domains |
| Shadow DTO | **UNCHANGED** |

---

## 23. Target List / Check List

- [x] 冻结基线与 Git  
- [x] Lexicon→Hotword→Candidate  
- [x] domainId 写/读全表  
- [x] Vote / sameDomain / 边界  
- [x] 方案 1–4  
- [x] Electron 复现 ≥3  
- [x] 开发范围与风险  
- [x] 停止、不开发  

---

## 24. 是否批准开发

```text
DEVELOPMENT: APPROVE
```

条件：

1. 仅方案 3（`WindowCandidate.domains` + sameDomain `includes`）  
2. Vote / Assembly 文本合同 / KenLM / Shadow **不改**  
3. 不复制 Candidate  
4. 同步受控修订 Freeze 中 Candidate「禁止 domains[]」与 sameDomain 债务行  
5. fresh dist + Electron acceptance  

---

## 强制最终结论

```text
PRIMARY VERDICT:
B
```

```text
PROBLEM REPRODUCED:
YES
```

```text
FORMAL domains[0] WRITE POINTS:
1
```

```text
FORMAL domainId READ POINTS:
10
```

（主链正式影响：Vote + sameDomain + resolveGraphSource + DomainAware 拷贝；其余为 Shadow/metrics/测试。）

```text
SAME-DOMAIN FAILURE CONFIRMED:
YES
```

```text
ZERO NEW FIELD SOLUTION:
NO
```

```text
IF NEW FIELD IS REQUIRED:
WindowCandidate.domains
```

```text
VOTE CHANGE:
FORBIDDEN
```

```text
ASSEMBLY CHANGE:
FORBIDDEN
```

```text
KENLM CHANGE:
FORBIDDEN
```

```text
SHADOW CHANGE:
FORBIDDEN
```

```text
CANDIDATE DUPLICATION:
FORBIDDEN
```

```text
NEW DTO:
NONE
```

```text
NEW CONFIG:
NONE
```

```text
DEVELOPMENT:
APPROVE
```

```text
NEXT ACTION:
WINDOWCANDIDATE DOMAIN DEPENDENCY AUDIT COMPLETE — STOP
```

```text
WINDOWCANDIDATE DOMAIN DEPENDENCY PRE-DEVELOPMENT AUDIT COMPLETE — STOP
```
