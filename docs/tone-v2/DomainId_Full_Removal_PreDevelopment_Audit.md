# DomainId Full Removal Pre-Development Audit

```text
STATUS: PRE-DEVELOPMENT AUDIT
Supersedes dual-field plan: keep domainId + add domains
Authority conflict note: Runtime_SSOT_Contract_Freeze.md V1 still documents domainId debt;
  full removal requires controlled Freeze amendment before coding.
Date: 2026-07-19
Nature: 只读 · 完成后立即停止 · 不得开发
```

---

## 1. Executive Verdict

```text
WindowCandidate.domainId 可以彻底删除。
正式主链领域数据只保留 domains[]。
Vote / sameDomain / resolveGraphSource / Shadow 图边 必须同步改读 domains[]（或删掉领域字段），
不得保留 domainId 兼容层。
```

上一轮「保留 domainId + 新增 domains」方案 **作废**。

**DOMAINID REMOVAL: YES**

前提（代码证据，非“兼容以后再说”）：

1. Vote **必须**改读 `domains[]`（当前硬依赖单值 `domainId`）  
2. Freeze V1 中 Candidate/`domainId` 债务条款 **必须**受控解冻并改写  
3. Shadow 链 `GraphEdge` / `ParentTermEvidence` 上的 `domainId` **一并删除**（改 `domains` 或去掉领域字段），不为 Shadow 保留旧字段  
4. 一个召回结果仍只产生 **一个** Candidate（禁止按域复制）

---

## 2. 唯一允许数据流（目标）

```text
term_domain_tags
        ↓
Hotword.domains[]
        ↓
WindowCandidate.domains[]
        ↓
Vote
        ↓
utteranceDomain
        ↓
sameDomain（domains.includes(utteranceDomain)）
        ↓
SpanReplacementPick（无 domains）
        ↓
Assembly
        ↓
KenLM（纯文本）
```

职责：

| 名称 | 含义 |
|------|------|
| `domains[]` | 一个词属于哪些领域 |
| `utteranceDomain` | 整句最终领域 |

禁止并存：`domainId`、`primaryDomain`、`selectedDomain`、新 DTO、side map、双链路。

---

## 3. 名称消歧（避免误删）

| 符号 | 是否本轮删除对象 | 说明 |
|------|------------------|------|
| `WindowCandidate.domainId` | **是** | 本审计目标 |
| `DomainAware` / `PoolVoteCandidate` / `GraphEdge` / `ParentTermEvidence` 的 `domainId` | **是** | 同一领域数据流遗留 |
| `recallDomainScope` / `domainIds`（查询范围数组） | **否** | Recall Scope，不是 Candidate 单值字段 |
| `term_domain_tags.domain_id`（SQL） | **否** | Lexicon 表列；本轮不改 SQLite |
| `pinyin-ime` 词典行 `domainId` | **否** | IME 字典列；非 WindowCandidate 流 |
| `matched-domain.ts` 循环变量名 `domainId` | 函数可删 | **死代码**（无引用） |

---

## 4. 正式写入点（Candidate / 图链领域单值）

| 文件 | 函数 | 用途 | 可删除？ |
|------|------|------|----------|
| `recall-topk-for-windows.ts` | `recallTopKForWindows` | `domainId = hotword.domains?.[0]` 写入 WindowCandidate | **是** → 改为写 `domains` |
| `window-candidate-to-pick.ts` | `windowCandidateToDomainAwarePick` | 拷贝 `domainId` 到 DomainAware | **是** → 拷贝 `domains` 或 sameDomain 直接读 Candidate |
| `emit-v4-evidence.ts` | emit | Candidate → ParentEvidence / GraphEdge `domainId` | **是** → Shadow 改 `domains` 或去掉 |
| `assemble-parent-term-span-candidates-v4.ts` | parent→edge | 传播 `domainId` | **是** |
| `coarse-candidate-graph.ts` | merge | 保留较高分边的 `domainId` | **是** |
| 测试夹具 | `assemble-domain-aware-span-sets.test.ts` 等 | 手写 `domainId:` | **是** → 改 `domains` |

```text
正式主链 domains[0]→domainId 压缩写入点 = 1（recall-topk-for-windows.ts）
```

---

## 5. 正式读取点分类

| 文件 | 用途 | 分类 | 处置 |
|------|------|------|------|
| `utterance-domain-vote.ts` | `addDomainScore(..., candidate.domainId)` / evidence / edges | **Vote** | **改为 domains[]** |
| `utterance-domain-vote.ts` | `edge.domainId === utteranceDomain` soft×0.3 | **Shadow** | **改为 domains.includes** 或删领域 demotion |
| `assemble-domain-aware-span-sets.ts` | `domainId === winningDomain` | **sameDomain** | **改为 domains.includes** |
| `recall-topk-for-windows.ts` | `resolveGraphSource(..., domainId)` | 主链 source 分类 | **改为 domains 非空 / weak 交集** |
| `span-assembly-v4-orchestrator.ts` | `Boolean(c.domainId) && !== 'general'` metrics | **Metrics** | **改为 domains 有 fine** |
| `select-greedy-longest-parent-term.ts` | `domainId === utteranceDomain` | **Shadow** | **改为 includes** 或删该 tiebreak |
| `emit` / parent / coarse-graph | 读写传播 | **Shadow** | **删除 domainId 字段** |
| `window-candidate-to-pick.ts` | 中间态 | sameDomain 路径 | 见上 |
| `assemble-domain-aware-*.test.ts` | 夹具 | **测试** | 同步删改 |
| experiments `run-domain-vote-*.cjs/mjs` | 离线审计脚本 | **日志/实验** | 同步删改或标明失效 |
| `runtime-ssot-acceptance.cjs` | 断言 Pick 无 domainId | **测试** | 保留“Pick 无领域”；构造改 domains |

Assembly 正式 `SpanReplacementPick` / KenLM：**当前不读 domainId**（已剥离）→ 保持 **MUST NOT CONTAIN domains**。

---

## 6. Vote：如何读 `domains[]`（最小修改，有代码+冻结依据）

### 6.1 当前代码（不可保留）

```text
addDomainScore(domainScores, candidate.domainId, source, score, coverage)
```

证据单元 = **单个** `domainId`。无 `domains` 循环；无 `DomainWeight` 乘子（`addDomainScore` 仅 `SOURCE_WEIGHT × coverageWeight`）。

### 6.2 冻结公式（DOMAIN_RECALL §4，仍有效）

```text
VoteMass = CandidateScore × SourceWeight × CoverageWeight × DomainWeight
```

禁止（Runtime SSOT Freeze / 历史否决）：

```text
score / domains.length   ← 均分
```

### 6.3 最小修改方案（推荐）

在 **不新增字段、不引入均分、不复制 Candidate** 的前提下：

```text
对 candidate.domains 中每个 d：
  if (!d || d === 'general') skip
  addDomainScore(domainScores, d, source, score, coverage)
  // DomainWeight：当前实现本就未乘 tag weight → 等价 DomainWeight=1
  // 直至另开 DomainWeight 票；本轮不实现新权重算法
```

含义：

* 单域词：行为与今日 `domainId` 路径 **数值一致**  
* 多域词：每个 fine domain 各得一份完整 VoteMass（**改变**今日只投 `domains[0]` 的行为）  
* **不是** `/domains.length`  
* **不是** 新 DTO  

这是删除 `domainId` 后，与现行 `addDomainScore` 形状最接近、且符合 DOMAIN_RECALL「按域累计 VoteMass」的改法。

备选（**本轮不推荐**，因需第二份数据）：把 `domainWeights` 拷进 Candidate 再乘权重 — 违反「只保留一套领域数据 domains[]」；留给独立 DomainWeight 票。

### 6.4 结论

```text
删除 domainId ⇒ Vote 必须改。
最小改法 = 对 domains[] 逐域 addDomainScore（DomainWeight=1 直至另票）。
禁止均分；禁止双字段共存。
```

---

## 7. resolveGraphSource

当前代码：

```ts
if (domainId && weakPlan?.enabled && weakPlan.weakDomainIds.includes(domainId))
  → passive_domain_weak
if (domainId && domainId !== 'general')
  → domain_term
else
  → base_term
```

`domainId` 仅表达：

1. 是否存在非 `general` 领域标签  
2. 该单值是否落在 weak 列表  

**不需要**保留名为 `domainId` 的字段。等价：

```text
fine = domains 中非空且 ≠ general 的项
若 fine 为空 → base_term
若 weakPlan 启用且 fine 与 weakDomainIds 有交集 → passive_domain_weak
否则 → domain_term
```

```text
resolveGraphSource：domains 非空（有 fine）即可完成分类；不需要 domainId。
```

（弱域：由「单值 ∈ weak」自然扩展为「任一 fine ∈ weak」；与删除单值投影一致。）

---

## 8. Shadow

Shadow 当前：`emit` / parent / graph / greedy / `applyDomainVoteToEdges` 均带 `domainId`。

用户要求：不为兼容保留旧字段；若可退役优先删字段。

本轮审计结论：

```text
Shadow 不进 KenLM/Apply（FROZEN_V1_2）→ 可安全删除 Shadow DTO 上的 domainId。
若 Shadow 仍需领域诊断：改用 domains[]（同一名称），禁止 domainId。
优先：删除 domainId；需要比较时用 domains.includes(utteranceDomain)。
```

**不要**单独为 Shadow 保留 `domainId`。

---

## 9. sameDomain / Base / general

| 规则 | 删除 domainId 后 |
|------|------------------|
| sameDomain | `domains.includes(utteranceDomain)` 且 source 为 domain_term / passive_domain_weak |
| Base | `domains` 空 → `base_term`；进 base 桶 |
| general | 仅 `utteranceDomain==='general'` / insufficientEvidence；**禁止** `includes('general')` |
| fallback | 保持现有 isGeneral 公式；不改 cap |

---

## 10. 边界

| 对象 | domains |
|------|---------|
| Hotword | **允许**（已有） |
| WindowCandidate | **允许**（唯一 Candidate 领域数据） |
| Vote 输入 | **读 domains** |
| sameDomain | **读 domains** |
| DomainAware 中间态 | 可临时持 `domains` **仅**供 filter |
| SpanReplacementPick | **禁止** |
| Sentence Candidate | **禁止** |
| KenLM | **禁止**（纯文本） |
| Shadow | **禁止 domainId**；诊断可用 `domains` 或无领域字段 |

---

## 11. Candidate 数量

```text
一个召回 hit → 一个 WindowCandidate（含完整 domains[]）
禁止按 domains 长度复制 Candidate
```

---

## 12. 测试 / 日志 / metrics / trace

应同步删除或改写所有 **Candidate/图链** `domainId` 断言与字段：

* `assemble-domain-aware-span-sets.test.ts`  
* `freeze-contract` 若断言 domainId 债务文案 → 改为 domains-only  
* `runtime-ssot-acceptance.cjs`：构造用 `domains`；Pick 仍不得含领域  
* orchestrator `voteEligibleDomainCandidateCount`  
* experiments `run-domain-vote-*`（或标 SUPERSEDED）  
* KNOWN DEBT 注释中的 `domainId = domains[0]`  

不得留下 deprecated `domainId?` 别名。

---

## 13. MUST MODIFY / DELETE / MUST NOT MODIFY

### MUST MODIFY

* `v4-types.ts` — 删 `domainId`；加 `domains?`  
* `recall-topk-for-windows.ts` — 写 `domains`；`resolveGraphSource(domains)`  
* `utterance-domain-vote.ts` — Pool/Evidence/Edge 改 `domains`；逐域计分；`applyDomainVoteToEdges`  
* `assemble-domain-aware-span-sets.ts` — sameDomain `includes`  
* `domain-assembly-types.ts` / `window-candidate-to-pick.ts` — 中间态  
* `span-assembly-shared/types.ts` — GraphEdge / Parent* 删 `domainId`  
* `emit-v4-evidence.ts` / `assemble-parent-term-…` / `coarse-candidate-graph.ts` / `select-greedy-…`  
* `span-assembly-v4-orchestrator.ts` — metrics 条件  
* `Runtime_SSOT_Contract_Freeze.md` — 受控解冻（开发票内）  
* 相关测试与 acceptance  

### DELETE

* `WindowCandidate.domainId` 及一切向 Pick 的 `domainId` 拷贝  
* `domains?.[0]` 压缩赋值  
* 死代码 `matched-domain.ts`（可选整文件删，仅被自身定义）  
* 测试/脚本中的 Candidate `domainId` 字段  
* 注释中的「保留 domainId 给 Vote」双链方案  

### MUST NOT MODIFY

* Lexicon SQLite / `term_domain_tags` 数据  
* `domain_hierarchy`  
* Context Prior 算法文件（除非误导入 domainId，当前无）  
* `build-sentence-candidates.ts` 文本装配核心（仅确认不引入 domains）  
* KenLM adapter  
* NMT / Tone  
* IME `pinyin-ime-v2-dict-*.ts` 的词典列 `domainId`（非本流）  
* Recall Scope 的 `domainIds` 命名（查询范围）  

---

## 14. 与现行 Freeze 的冲突（必须写明）

`Runtime_SSOT_Contract_Freeze.md` V1 仍写：

* Candidate 持遗留 `domainId`  
* 禁止 Candidate 持 `domains[]`  
* Vote 证据单元为单值；禁止随意改公式  

**因此：编码前必须先修订 Freeze**，否则开发违反现行合同。

修订方向（建议，本轮不改文档）：

```text
WindowCandidate 只持 domains[]。
禁止 domainId。
Vote 对 domains[] 逐域累计 VoteMass（DomainWeight 另票）。
sameDomain：domains.includes(utteranceDomain)。
Pick/KenLM 不得含 domains。
```

---

## 15. 风险（摘要）

| 风险 | 说明 | 防护 |
|------|------|------|
| Vote 分数变化 | 多域词对多域同时加分 | 单域回归对齐；多域用例显式预期 |
| 均分回潮 | 有人再加 `/domains.length` | freeze gate 禁止 |
| 字段扩散 | domains 进 Pick/KenLM | acceptance + contract test |
| Candidate 复制 | 按域 fan-out | 单测数量 |
| Shadow 残留 domainId | 双链 | 全删字段 |
| Freeze 未改先写码 | 合同违规 | 先解冻文档 |

---

## 16. 强制最终结论

```text
PRIMARY VERDICT:
domainId 可从 WindowCandidate 与正式领域数据流中彻底删除；
Vote 必须改为读取 domains[]（逐域 VoteMass，非均分）；
须同步修订 Freeze；Shadow 不得保留 domainId。
```

```text
DOMAINID REMOVAL:
YES
```

```text
ZERO LEGACY FIELD:
YES
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
DOUBLE DOMAIN CHAIN:
FORBIDDEN
```

```text
NEXT ACTION:
DOMAINID FULL REMOVAL AUDIT COMPLETE — STOP
```

```text
DOMAINID FULL REMOVAL PRE-DEVELOPMENT AUDIT COMPLETE — STOP
```
