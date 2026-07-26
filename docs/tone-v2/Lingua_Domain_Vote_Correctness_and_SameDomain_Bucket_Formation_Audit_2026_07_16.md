# Lingua Domain Vote Correctness & SameDomain Bucket Formation Audit

**Date:** 2026-07-16  
**Audit Type:** Read-only · Domain Vote → sameDomain Formation · 禁止改代码 / 禁止改配置 / 禁止进 Assembly Diversity  
**冻结 SSOT：** [`DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md) · [`recall/DOMAIN_RECALL.md`](../fw-detector/recall/DOMAIN_RECALL.md) · [`assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) · [`ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md)  
**代码根：** `electron_node/electron-node/main/src/fw-detector/` · `lexicon-v2/`  
**DB：** `node_runtime/lexicon/v3/lexicon.sqlite`  
**Evidence：** `tmp/budget_expansion_20260715/C1`（dialog_200）  
**Offline：** `tests/experiments/analyze-domain-vote-samedomain-audit.py` → `tmp/budget_expansion_20260715/domain_vote_samedomain_audit.json`  
**上游：** [`Lingua_Sentence_Assembly_Domain_Base_Mixing_Logic_Audit_2026_07_16.md`](./Lingua_Sentence_Assembly_Domain_Base_Mixing_Logic_Audit_2026_07_16.md)

---

## Final Verdict

# **G — Mixed Root Causes**

| 根因（按流水线最早 → 晚） | 比例 (dialog_200) | 说明 |
|---------------------------|------------------:|------|
| **① Domain Recall Scope 未接线（domainIds=[]）→ 无 `domain_term` 候选进入 Vote** | **200/200** | DSU CFG-01 算出 `recallDomainScope`，但 orchestrator 仍把空 `enabledDomains` 传给 Recall |
| **② sameDomain=0 = general 分支必然结果** | **200/200** | Filter 逻辑按设计；非独立 Filter Bug |
| **③ Vote 公式 / DomainWeight / domainTags 合同漂移** | 次要 | 冻结写 `DomainWeight`·`domainTags`；代码只用 `domainId`×`SOURCE_WEIGHT` |
| **④ Multi-domain 仅单 `domainId`** | 次要 | DB 多行 tags；Runtime 只取 `domains[0]` |
| **⑤ Diagnostics：`spans[].domains` 硬编码 `[]`** | 观测层 | **不**伪造 `utteranceDomain`（该字段为真 general） |

**最早且影响最大的下一步（唯一）：**

```text
Fine-span Domain Recall Coverage Audit
```

（本轮已定位核心机制为 **Recall Scope Wiring / Domain Candidate Entry**；Coverage Audit 须把 CFG-01→`recallTopKForWindows.domainIds` 接线缺口作为第一检查项。）

在此之前：

```text
禁止 Sentence Assembly Candidate Diversity 开发
禁止 KenLM Corpus / Gate 优化
```

---

## 0. 现象复核（四层一致）

| 层 | `utteranceDomain` | `sameDomainCandidateCount` |
|----|-------------------|----------------------------|
| Runtime metrics（orchestrator → trace） | **general 200/200** | **0 200/200** |
| Consumer `spans[].domain` | general（来自 vote） | — |
| Analyzer（上轮 Mixing + 本轮） | general 200/200 | 0 200/200 |
| Report | 同上 | 同上 |

**结论：不是 Consumer / Analyzer / Report 投影错误。**  
`utteranceDomain===general` 是真实 Runtime Vote 结果。

旁注：`buildFwSpansFromCoarseAssemblyV4` 将每个 candidate 的 `domains: []` / `domainMatched: false` **硬编码**——这是 Diagnostics 缺口，会误导“候选无域”的观感，但 **不会**把非 general winner 改写成 general。

---

## 一、冻结主链（本轮未改）

```text
Fine Span → Pinyin+Tone Recall → Base/Domain Candidates
  → Unified Fine-span Pool → Utterance Global Domain Vote
  → Winner → sameDomain + base + conditional fallback
  → post-vote 8/6/4 → Controlled Sentence Assembly
```

---

## 二、第一阶段：Vote 输入池

### 2.1 调用链

```text
compatibility.activeCandidates: WindowCandidate[]
  → buildFineSpanCandidatePool(active, coarseSpans)
  → voteUtteranceDomainFromPool(pool)
```

### 2.2 `WindowCandidate` / Vote 实际字段（代码真实类型）

Vote 只消费 `PoolVoteCandidate`：

| 字段 | Vote 使用？ | 说明 |
|------|:----------:|------|
| `hitKind` | ✅ | `exact_term` / `parent_fragment` |
| `source`（= graphSource） | ✅ | → `SOURCE_WEIGHT` |
| `score` | ✅ | 局部分 |
| `domainId` | ✅ | **唯一域字段**；缺则不计票 |
| `syllableStart/End` | ✅ | coverage |
| `parentTermId` / matchedTerm* | ✅ | parent 路径 |
| `isCovered` | ✅ | covered 跳过 |
| `domainIds` / `domainTags` / `domainWeights` | ❌ | **候选上不存在 / Vote 不读** |
| `candidateId` / `replacement` / tone | ❌ | Vote 不读 |

`recall-topk-for-windows.ts` 写入：

```text
domainId = hit.hotword.domain ?? hit.hotword.domains?.[0]
source   = resolveGraphSource(...)  // 无 domainId → base_term
```

### 2.3 数量对账（C1 汇总量级）

| Stage | 角色 | 观察 |
|-------|------|------|
| Recall Hits | SQL+merge 输出 | 有命中 |
| Active Candidates | Compatibility 后 | ≈ poolAfterDrop |
| FineSpan Pool | 按 span 分组 | 不丢 domain 字段（因上游已无） |
| Domain-tagged Vote Candidates（有 `domainId`） | **≈ 0** | 因 graphSource 全为 `base_term` |
| Base Candidates | 主导 | `baseCandidateCount` 全案 >0 |
| Ignored by Vote | `!domainId` 或 `domainId==general` 或 covered | **几乎全部 exact 候选** |

| Stage | Drop Reason |
|-------|-------------|
| Recall `domainIds=[]` | **跳过** `lookupDomainsByPinyinKeyMulti` |
| merge `hasActiveDomain=false` | 只保留 base 序 |
| Vote `addDomainScore` | `!domainId` → return |

**存在 Vote 前“隐式裁剪”：** 不是 Compatibility 删域，而是 **Domain Recall 路径根本未执行**。

### 2.4 谁有投票权

| 来源 | 参与 Vote？ | 条件 |
|------|:----------:|------|
| `domain_term` / `passive_domain_weak` | ✅ | 且 `domainId` 非空非 general |
| `base_term` | ❌ | `addDomainScore` 因无 domainId 直接 return（即便 SOURCE_WEIGHT 有 0.5） |
| parent_fragment | ✅ | 需 `domainId`；score 可累加；`parentTermId` 只影响计数 |
| covered | ❌ | skip |
| canonical / raw | ❌ | 不在 pool vote |
| CPU LLM hint | ❌ | 不进 Main Vote |
| ngram  alone | 仅当变成 candidate 且带 domainId | |

**进入 pool ≠ 拥有投票权。** 当前几乎所有 pool 候选无 `domainId` → **无投票权**。

---

## 三、Candidate Domain Metadata 链

```text
SQLite term + term_domain_tags + domain_lexicon
  → LexiconRuntimeV2.lookupDomains* (需 domainIds 非空)
  → HotwordEntry.domain / domains[] / domainWeights
  → WindowCandidate.domainId (仅 [0])
  → Vote / Filter
```

| # | 检查项 | 结论 |
|---|--------|------|
| 1 | `term_domain_tags` 查询 | ✅ domain 多查路径有 JOIN；**但 domainIds=[] 时不查** |
| 2 | 多 tags 是否全保留 | mergeDomainTierRows → `domains[]` + `domainWeights` ✅ |
| 3 | DTO 是否只留一条 | ✅ Vote/Filter 只用 `domainId = domains[0]` |
| 4 | fine/coarse 错写 | hierarchy 存在；Vote 未强制 `isFineDomainEligibleForWinning` |
| 5 | ID/slug 不一致 | 本批未证为主因 |
| 6 | null/general 覆盖 | `addDomainScore` 忽略 general |
| 7 | Candidate 转换丢 domainId | **主路径：从未设置**（base-only recall） |
| 8 | 仅 domain_term 有 domain | resolveGraphSource：有 domainId → domain_term |
| 9 | 配置覆盖 DB | `enabledDomains=[]` 默认；weak=false |
| 10 | 测试库 vs 生产 | C1 使用 v3 bundle；tags=10121，域表非空 |
| 11 | registry 未加载 | 若未加载会 fail-fast；本批有投票 metrics → 已加载 |
| 12 | alias 失败 | 非本批主因 |

**DB 实况（v3）：**

| 表 | 行数 |
|----|-----:|
| `term` | 10000 |
| `term_domain_tags` | **10121** |
| `domain_lexicon` | 10100 |
| `base_lexicon` | 50000 |
| multi-tag terms | 72 |

可用 fine：`bakery, coffee, food_order, medical, meeting, milk_tea, tech_ai, tourism_*, transport, general…`

**关键样例：** `中杯`/`少糖`/`拿铁` **仅在 domain_lexicon**（`base_lexicon` 无行）。  
`domainIds=[]` 时这些词 **物理上无法被 Recall**。

---

## 四、Domain Vote 算法（真实实现）

文件：`span-assembly-shared/utterance-domain-vote.ts` · `voteUtteranceDomainFromPool`

```text
SOURCE_WEIGHT = {
  domain_term: 1.0, passive_domain_weak: 0.2, base_term: 0.5, ...
}
MIN_EVIDENCE_SCORE = 0.3

for each non-covered candidate:
  if parent_fragment: addDomainScore(domainId, source, score, coverage); count parentTerm once
  if exact_term:      addDomainScore(...)

addDomainScore:
  if !domainId or domainId=='general': return
  mass = score * SOURCE_WEIGHT[source] * min(1, coverageSyllables/4)
  domainScores[domainId] += mass

if sum(domainScores) < 0.3:
  → utteranceDomain='general', insufficientEvidence=true, winnerScore=0
else:
  → argmax domainScores (tie: lexicographic domain id)
```

| 冻结 (`DOMAIN_RECALL` §4) | 代码 | |
|---------------------------|------|--|
| `VoteMass = Score × SourceWeight × Coverage × DomainWeight` | **无 DomainWeight** | **DRIFT** |
| DSU：证据来自 `domainTags`/`domainWeights` | 只用 `domainId` | **DRIFT** |
| Winning 必须是 Fine Domain | **未调用** `isFineDomainEligibleForWinning` | **GAP** |
| `MIN_EVIDENCE_SCORE=0.3` | ✅ | PASS |

Main Vote：**不用** Shadow `voteUtteranceDomain`；LLM 不覆盖 winner。

---

## 五、Vote 正确性（dialog_200）

不得把“无领域证据”判为 Vote 错。

| Metric | Count | Rate |
|--------|------:|-----:|
| Cases with DB-domain-tagged **words** in pool | 200 | 100% |
| Cases with Vote-eligible candidates (`domainId` set) | **≈0** | **0%** |
| Runtime correct fine-domain winner | **0** | 0% |
| Runtime wrong fine-domain winner | **0** | 0% |
| General with no Vote evidence（真实） | **200** | **100%** |
| General despite sufficient Vote evidence | **0** | 0% |
| CF: attach tags → vote non-general | 200 | 100% |
| CF: expected winner → sameDomain>0 | 87 | 43.5% |

**解释：**

- Runtime Vote 在 **空证据** 下输出 general：**算法行为正确**。
- Pool 里虽有“在 DB 带 tag 的词面”（如「你好」→`tourism_hotel`），但候选是 **base 路径召回**，**没有 `domainId`**，故 **不构成 Vote 证据**。
- 目标领域词（如 d001 的 `中杯/少糖/拿铁/热拿铁`）常为 **domain-only**，在 `domainIds=[]` 下 **未进 pool**。

---

## 六、为什么 200/200 都是 general

### 6.1 因果链（主因）

```text
config.enabledDomains = []          (CFG-01 默认)
weakDomainRecallEnabled = false
        ↓
resolveRecallScope() → availableFineDomains   ✅ 仅写入 runtimeDiag.recallDomainScope
        ↓
runSpanAssemblyV4Orchestrator({ enabledDomains: [] })
        ↓
recallTopKForWindows.domainIds = input.enabledDomains = []
        ↓
lookupDomains* 跳过；merge hasActiveDomain=false → 仅 base
        ↓
WindowCandidate.domainId = undefined；source = base_term
        ↓
vote: domainScores={}；sum=0 < 0.3
        ↓
utteranceDomain=general；insufficientEvidence=true
```

**代码锚点：**

```163:163:electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts
    domainIds: weakEnabled ? weakDomainPlan.queryDomainIds : input.enabledDomains,
```

对比 DSU CFG-01：`enabledDomains=[]` → Recall scope = **全量 availableFineDomains**。  
**Scope 算了但没传进 Recall → 合同漂移（DRIFT）。**

### 6.2 insufficientEvidence

C1 trace **未持久化** `insufficientEvidence` 字段；由算法与 `domainScores` 空可推断：

| 项 | 值 |
|----|-----|
| 触发条件 | `sum(domainScores) < 0.3` |
| 本批推断触发率 | **200/200** |
| 原因 | 无带 `domainId` 的候选贡献 mass |

### 6.3 配置与 DB

| 项 | 状态 |
|----|------|
| Lexicon v3 sqlite | 存在且有 tags |
| Domain registry | 可加载 |
| `enabledDomains` | `[]`（C1 configSnapshot） |
| weak domain recall | 默认 false |
| mock DB | 否（正式 v3 bundle） |
| 强制 general 开关 | 无；结果来自证据不足 |

---

## 七、第二阶段：Vote → Filter 传递

```text
voteUtteranceDomainFromPool → UtteranceDomainVoteResult
  → filterDomainCandidatesPerSpan(pool, vote, rawText)
```

| 字段 | 传递？ |
|------|:------:|
| `utteranceDomain` | ✅ |
| `insufficientEvidence` | ✅（内存；C1 trace 常缺） |
| `domainScores` / winnerScore / runnerUp / margin | ✅ 在更新后 metrics；C1 旧 trace 可能不全 |

中间 **无** winner 改写、无 coarse 替换、无 compatibility 二次推导。  
`winningDomain = vote.utteranceDomain`；`isGeneral = insufficientEvidence \|\| winningDomain==='general'`。

---

## 八、sameDomain 桶形成

### 8.1 条件（代码）

```text
sameDomain  ⟺  !isGeneral
            && graphSource ∈ {domain_term, passive_domain_weak}
            && domainId === winningDomain     // 单值全等，非 includes

base        ⟺  graphSource === base_term

fallback    ⟺  isGeneral && 其余可转 pick 的 domain 类候选
```

仅 `exact_term` 且 `windowCandidateToDomainAwarePick` 成功（source∈domain/base/passive）。

### 8.2 预期定义

| 问题 | 答案 |
|------|------|
| `domainId === winner` 还是 `domainIds includes`？ | **仅 `===` 单字段** |
| 多 tags 合同 | DB 多行；Runtime 单 `domainId` → **Incomplete Multi-domain Contract** / **Data Contract Mismatch** |
| general 时 sameDomain | **恒空**；domain 类进 fallback |

### 8.3 General 路径因果（必须写清）

```text
Vote → general (+ insufficientEvidence)
        ↓
Filter enters general branch
        ↓
sameDomain stays empty          ← 必然，非独立 Bug
        ↓
domain_term（若有）→ fallback
        ↓
select: sameDomain ‖ base ‖ fallback → base 优先
        ↓
8/6/4 可能挤掉 fallback 领域词
```

**上轮 sameDomain=0：在 general 下是 Expected Behaviour。**

---

## 九、是否已有 winner→sameDomain 逻辑？是否要新增？

| 问题 | 结论 |
|------|------|
| 是否已有 Vote Winner → domain match → sameDomain？ | **已有且条件清晰** |
| 是否需要新增挑选逻辑？ | **不需要** |
| 问题在哪？ | **Vote 输入无 domain 证据（上游 Recall Scope）**；general 后 sameDomain 为空属设计 |
| 多领域 | **Incomplete Multi-domain Contract**（只比单 `domainId`）——非本批 200/200 主因 |
| 若在未修 general 前加“再挑一次 sameDomain” | **禁止**（重复逻辑 / 掩盖根因） |

---

## 十、Counterfactual（离线 · 不进 Runtime）

| 实验 | 结果 | 解释 |
|------|------|------|
| **A.** Runtime winner=general | sameDomain=0 | 与线上一致 |
| **B.** 覆盖 expected fine + 假设 tagged 词为 `domain_term` | **87/200** sameDomain>0 | Filter **基本正常** |
| **B 失败例 d001** | expected=`coffee` 仍 sameDomain=0 | pool **无 coffee 标记词**；`中杯/少糖/拿铁` 缺席 |
| **C.** 多领域词 | 仅 `[0]` 进 Vote/Filter | Multi-domain Gap |
| 若保持 `graphSource=base_term` 只改 winner | sameDomain 仍 0 | 需要 **source=domain_term**，非仅 winner |

**情况归类：**

- 多数：Filter 逻辑 OK；Primary Gap 在 **Vote 输入 / Domain Recall 元数据**（情况1）。
- 目标词未召回：即便正确 winner 也无法形成 sameDomain（情况2 的子集 = **No Domain Candidate Recalled**）。

---

## 十一、代表性 Case（节选；完整 30+ 见 JSON `representatives`）

### d001（cafe · 充分业务域意图 · winner=general）

```text
Raw: 你好,我想點一杯熱拿鐵中貝少糖 今天有蓝没马分吗?
Expected Domain (scenario→fine): coffee
Target Terms: 热拿铁/中杯/少糖/蓝莓马芬
Term Domain Tags: 中杯→coffee+…；少糖→coffee+…（均 domain-only）
Recall Domain Candidates: 无 domain_term；pool 为 以北/焙烧/烫金/游览…
Vote Input domainId: 无
Domain Score Map: {}
Winner: general · Insufficient: true（推断）
Filter Branch: general → sameDomain=[] · base 满 · fallback 空（无 domain_term）
Primary Owner: Domain Metadata Lost in Recall DTO / No Domain Candidate Recalled（目标词）
```

### d002（cafe · CF 可形成 sameDomain）

```text
Expected: coffee
Absent domain-only: ['大杯']（美式仍在）
CF vote（若贴 tags）: food_order / coffee 有分
CF expected winner → sameDomain: ['带走','大悲','美式']（count=3）
→ 说明 Filter 在元数据正确时可工作
```

### d005（meeting · CF winner=meeting 且 sameDomain 形成）

```text
CF scores: meeting 领先
sameDomain CF: 今天/大家/风险/内存/保护
```

### d010（hospital · DB 标签噪音）

```text
医生 tags=['meeting']（非 medical）— lexicon 标签质量问题（次要）
Runtime 仍 general（无 domainId）
```

覆盖：hotel/taxi/shopping/tech/friend 等见 artifact；friend/tech_deploy 等 CF sameDomain 常为 0（pool 无 expected 域词）。

---

## 十二、逐案首个失败阶段分布

| Primary Owner | Count |
|---------------|------:|
| Domain Metadata Lost in Recall DTO（domain 路径未查 / base DTO 无 tags） | **200** |

（目标词缺席与 Scope 空洞同源；未再拆成第二桶以免重复计数。）

---

## 十三、Diagnostics 充分性

| 需要 | 现状 | Owner |
|------|------|-------|
| candidate graphSource / domainId | poolAfterDrop **缺失** | Diagnostics |
| domainScores / insufficientEvidence / margin | metrics 有；C1 trace 不全 | Diagnostics |
| sameDomain/base/fallback 列表 | **无** | Diagnostics |
| `spans[].domains` | **硬编码 []** | Diagnostics（误导） |
| utteranceDomain | ✅ 真 | Runtime |

本轮用 DB+离线脚本；**未改生产 ABI**。

---

## 十四、Shadow / Compatibility / Dead Logic

| 项 | 判定 | 建议 |
|----|------|------|
| Main `voteUtteranceDomainFromPool` | 唯一生产 Vote | **KEEP** |
| Shadow `voteUtteranceDomain` | 仅 diagnostics | **KEEP** |
| `resolveRecallScope` 算了不用 | **DRIFT** | **MODIFY**（接线；须单独计划） |
| DSU 文档 domainTags vs 代码 domainId | **DRIFT** | **MODIFY**（合同或代码对齐） |
| Vote 缺 DomainWeight / fine eligibility | **GAP** | **MODIFY**（合同修复轮） |
| `spans.domains=[]` | 死字段式硬编码 | **MODIFY**（diagnostics） |
| LLM 覆盖 winner | 无 | — |
| 双 Filter / 测试注入 winner | 未发现 | — |
| single-domain legacy | 单 `domainId` | 标 **Incomplete Multi-domain Contract** |

---

## 十五、历史 vs 代码

| Historical / Frozen Principle | Current Code | PASS / GAP / DRIFT |
|-------------------------------|--------------|--------------------|
| All valid fine-span domain candidates vote | 仅带 `domainId` 者；当前几乎无 | **DRIFT**（scope 未进 Recall） |
| Utterance-wide single vote | `voteUtteranceDomainFromPool` | PASS |
| Fine domain winner | 未 enforce fine eligibility | GAP |
| Coarse only assists | LLM coarse；Vote 未用 coarse 校准 | PASS（旁路） |
| Multi-domain term supported | DB 多 tags；Runtime 单 id | **GAP** / Incomplete Contract |
| Winner Domain + Base | Filter 三桶 | PASS（逻辑） |
| General only when evidence insufficient | ✅ 本批证据真不足 | PASS |
| sameDomain from winner | ✅ | PASS |
| non-winner filtered | ✅ 非 general 时 | PASS |
| term_domain_tags is domain SSOT | Registry/lookup ✅；Vote 路径未吃到 | **DRIFT** |

---

## 十六、必须回答（20）

1. Vote 用哪些候选？→ 非 covered 的 exact/parent，且 **`domainId` 有效**。  
2. 是否用尽有效细 Span 领域候选？→ **否**（domain 路径未开）。  
3. Vote 前隐藏裁剪？→ **有：domainIds=[] 跳过 domain SQL**。  
4. Candidate 是否带完整 domain tags？→ **否**（无 domainIds/tags；仅可选单 domainId）。  
5. 多领域词能否为多域提供证据？→ **DB 能；Runtime Vote 不能**（只 [0]）。  
6. Vote 与冻结一致？→ 主结构一致；**DomainWeight/tags/fine 资格有漂移**。  
7. 为何 200/200 general？→ **无 Vote 证据（Recall scope 未接线）**。  
8. Runtime 还是 Consumer 错？→ **Runtime 真 general**。  
9. 有有效领域证据仍 general？→ **Vote 层无**；DB 词面有 tag 但未进候选元数据。  
10. insufficientEvidence 触发率？→ **推断 200/200**；阈值 0.3；因 scores 空。  
11. sameDomain 条件？→ `!general && (domain_term|passive) && domainId===winner`。  
12. sameDomain=0 是否仅 general 必然？→ **是**。  
13. 正确 winner 反事实后 sameDomain？→ **87/200 能**；目标词缺失时不能（d001）。  
14. ID/slug mismatch？→ **非主因**。  
15. 多领域合同缺口？→ **是（次要）**。  
16. 是否已有 winner→sameDomain？→ **已有**。  
17. 是否需新增挑选逻辑？→ **否**。  
18. 若将来要补，缺的是？→ 先 **数据/接线（domain 候选进入）**；多域再补 **接口（domainIds）**；非重复 Filter。  
19. 进组装 RFC 前必须先修？→ **Domain Recall Scope / Domain Candidate Entry**。  
20. 下一步唯一优先？→ **Fine-span Domain Recall Coverage Audit**（含 CFG-01 接线审计）。

---

## 十七、Final Verdict（唯一）

## G — Mixed Root Causes

量化见文首表。  
**唯一下一步：**

```text
Fine-span Domain Recall Coverage Audit
```

**闭合结论：**

```text
Domain Vote 算法在空证据下输出 general → 正确
        ↓
sameDomain 为空 → general 分支必然结果（Filter 无需新逻辑）
        ↓
winner→sameDomain 选择逻辑 → 已存在且基本正确
        ↓
不需要新增 sameDomain 挑选逻辑
        ↓
必须先修复：Domain 候选进入 Vote 的上游（Recall Scope / domainId 元数据）
```

在上述闭合前：**禁止** Assembly Diversity 开发与 KenLM 优化。

---

## 附录

- Artifact：`tmp/budget_expansion_20260715/domain_vote_samedomain_audit.json`  
- Analyzer：`electron_node/electron-node/tests/experiments/analyze-domain-vote-samedomain-audit.py`  
- 上轮 Mixing 审计中的 general/sameDomain=0 与本轮根因一致，且已排除“仅组句多样性问题”的前置假设。
