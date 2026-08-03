<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Domain_Single_Value_Residual_Audit_2026_07_31.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Domain Single-Value Residual & Legacy Naming Audit

**Date:** 2026-07-31  
**Nature:** READ ONLY · PRODUCTION CONSUMER TRACE  
**禁止已遵守:** 未改代码 / 类型 / DB / 词库 / 配置 / 测试预期；未 rename；未加兼容层  

**上游冻结结论（不重审 Vote 算法）:**  
`docs/tone-v2/FW_Repair_V4_Domain_Vote_Evidence_Chain_Audit_2026_07_31.md` — Vote 主链可对账；本轮只审单值字段与命名是否再制造「一句一领域」旁路。

**只读探针产物:**  
`docs/tone-v2/_audit_scratch/_ngram_multidomain_probe.cjs`  
`docs/tone-v2/_audit_scratch/_ngram_multidomain_probe_out.json`

---

## 1. Executive Conclusion

**Verdict: PARTIAL**

当前 **Vote / Bucket / Assembly 决策不读取** `winnerScore` / `winningFineDomain` / `utteranceDomain` / `fwSpan.domain` 作为领域 Owner；正式句级领域 SSOT 仍是 `retainedDomains[]`。JobResult 正式先验投影走 `currentTurnDomains`（由 `retainedDomains[]` 投影，最多 3 个）。

但仍存在必须清理的残留：

1. **命名误导：** `winnerScore`（=maxCount）、`winningFineDomain` / `utteranceDomain` / 局部变量 `primaryDomain`（= `retainedDomains[0]`）。
2. **诊断压缩：** `fwSpan.domain` 把多领域句压成单值写入 spans 诊断。
3. **ngram 旁路残留：** `ParentTermNgramRow.domainId` + `ngramRowToHotword` 初值 `[domainId]`；正式路径靠 `lookupTermDomainTagsInScope` 覆盖回 `domains[]`，但 **fallback 仍是单值**。
4. **过时文档：** 仍描述 `domainId` 硬依赖 Vote / 单一 utteranceDomain winner。

未发现 Node 内 `utteranceDomain → 下一轮 domainPriors` 的自动压缩回流；但 JobResult 仍 **同时下发** 单值别名与数组，外部 Web 若误用单值则构成 P1 回流风险。

---

## 2. Audit Scope

| In | Out |
|----|-----|
| 单值领域字段 write/read/serialize | Vote 公式重设计 |
| ngram `domainId` → Candidate `domains[]` | 代码 rename/delete 实施 |
| JobResult / IPC / domainPriors 回流 | dialog_200 语义正确性 |

---

## 3. Frozen SSOT Baseline（代码真实状态）

| 数据 | 唯一 SSOT | 合法派生 | 禁止成为 SSOT |
|------|-----------|----------|---------------|
| Term 多领域标签 | `term_domain_tags` | `Hotword.domains[]` / `WindowCandidate.domains[]` | 单值 `domainId` 作为最终标签 |
| 当前句保留领域 | `retainedDomains[]` | `currentTurnDomains`（≤3） | `winningFineDomain` / `utteranceDomain` / `fwSpan.domain` |
| 会话软先验 | Job `domainPriors: {domain,weight}[]` | sanitize/canonicalize | `profile.primaryDomain` 单值当 prior |
| CPU LLM 意图 | `lexiconSessionIntent.primaryDomain` + `secondaryDomains[]` | `llmCalibration` 诊断 | 不得改 Vote |

代码符合上表的决策路径；不符合上表的是 **残留命名与诊断序列化**。

---

## 4. Production Data Flow（摘要）

```text
term_domain_tags
  → exact: mergeDomainTierRows → Hotword.domains[]（多行合并）
  → fragment: term_pinyin_ngrams.domain_id（行级单值）
       → ngramRowToHotword domains=[domainId]   // 临时压缩
       → lookupTermDomainTagsInScope 覆盖 domains[]  // 正式恢复
  → WindowCandidate.domains[]
  → voteUtteranceDomainFromPool → retainedDomains[]
  → bucketDomains = retainedDomains | [null]
  → JobResult.extra.currentTurnDomains ← projectCurrentTurnDomains(retainedDomains)
  → JobResult.extra.fw_detector.spanAssemblyV4.{winningFineDomain,utteranceDomain,winnerScore,retainedDomains}
  → 下一轮 JobAssign.domainPriors[]（Web/Scheduler 回传数组；Node sanitize）
```

---

## 5. Field Inventory

| Field | 出现位置类 | 初判 |
|-------|------------|------|
| `winnerScore` | Vote result + metrics + JobResult | RENAME |
| `winningFineDomain` | metrics + JobResult | DELETE / REPLACE_WITH_ARRAY |
| `utteranceDomain` | Vote result + metrics + fwSpan.domain | DELETE / REPLACE_WITH_ARRAY |
| `primaryDomain`（orch 局部） | retainedDomains[0] alias | DELETE（局部变量） |
| `primaryDomain`（profile/intent） | Session / LLM | KEEP（另一语义） |
| `ParentTermNgramRow.domainId` | DB row + filter + fallback | REPLACE / 收缩职责 |
| `selectedDomain` / `topDomain` / `bestDomain` / `winnerDomain` | 生产主链 | **未发现** |
| `candidate.domainId` | WindowCandidate | **未发现**（freeze 禁止） |
| `fwSpan.domain` | diagnostics | REPLACE_WITH_ARRAY |

---

## 6. Writer / Reader Matrix

### 6.1 `winnerScore`

```text
Field: winnerScore

Definition:
  utterance-domain-vote.ts :: UtteranceDomainVoteResult.winnerScore
  v4-types / fw-detector types metrics

Writer:
  utterance-domain-vote.ts :: finalizePresenceVote
  expression: winnerScore: selected.maxCount
  actual source: maxCount（最高 presence 票数）

  span-assembly-v4-orchestrator.ts
  expression: winnerScore: primaryAssembly.vote.maxCount

Propagation:
  VoteResult → metrics → spanAssemblyV4 → JobResult.extra.fw_detector
  → result-builder-core projectCurrentTurnDomains({ maxCount: spanV4.winnerScore })

Readers:
  1. result-builder-core.ts :: buildCoreResultExtra
     usage: 仅作 maxCount 分母算 normalizedScore；列表仍来自 retainedDomains[]
  2. tests（fixture）

Decision impact: INDIRECT（只影响 JobResult 归一化展示，不改 Vote/Bucket）
Final classification: RENAME → maxDomainCount（或 DELETE，改用 Math.max(...Object.values(domainScores))）
Risk: P2
```

确认：

- 等于 `maxCount`：**是**
- 参与 retainedDomains 选择：**否**（选择在 `selectRetainedDomains` 用 counts）
- 下游读取：**是**（JobResult 归一化）
- 非 winner 机制，仅为最高票计数别名

---

### 6.2 `winningFineDomain`

```text
Field: winningFineDomain

Definition:
  v4-types.ts / types.ts metrics.winningFineDomain?: string

Writer:
  span-assembly-v4-orchestrator.ts
  expression: winningFineDomain: primaryDomain
  where primaryDomain = retainedDomains[0] ?? utteranceDomain
  actual source: retainedDomains[0]（或 general）

Propagation:
  metrics → spanAssemblyV4 spread → JobResult.extra.fw_detector

Readers:
  1. 生产业务分支：未发现读取该字段做 Recall/Vote/Bucket/Assembly/KenLM
  2. 序列化随 fw_detector 整包下发（外部可能读取——本仓无 Web 消费代码）

Decision impact: NONE（Node 内）/ INDIRECT（若外部误用）
Final classification: DELETE（首选）或 REPLACE_WITH_ARRAY → retainedDomains[]
Risk: P2（命名诱导）+ 潜在 P1（外部回流，本仓未证实）
```

确认：

- 恒等于 `retainedDomains[0]`（有票时）：**是**
- 多领域静默丢失其他域：**是（字段本身）**；正式 Bucket 仍用全数组
- 用于 `fwSpan.domain`：**间接**（同一 `primaryDomain` 变量写入）
- 下游当唯一领域：**Node 否**；JobResult 暴露风险

---

### 6.3 `primaryDomain`（多种语义，必须拆分）

#### A. Orchestrator 局部变量 `primaryDomain`

```text
Writer: span-assembly-v4-orchestrator.ts
  retainedDomains[0] ?? utteranceDomain
Readers: buildFwSpansFromPathFineSpans(..., primaryDomain);
         metrics.utteranceDomain / winningFineDomain
Impact: 仅诊断 spans[].domain 打标
Class: DELETE 局部别名；改传 retainedDomains[] 或删 span.domain
Risk: P2
```

#### B. `ActiveLexiconProfileSnapshot.primaryDomain` / Session Intent

```text
Writer: lexicon-profile-decision-parser / lexicon-session-intent（CPU LLM）
Readers:
  - fw-detector-orchestrator → buildFwRuntimeDiag profilePrimary
  - fw-detector-v4-path mergeContextPriorIntoRuntimeDiag(..., profile.primaryDomain, {applied:false})
  - session-result-extra → activeLexiconProfile / llmCalibration.primaryDomain
Impact: 诊断 + JobResult llmCalibration；当前 contextPrior applied=false
  不进入 Vote；不改 retainedDomains
Class: KEEP（另一产品语义）— 不得与 Vote 字段混名使用
Risk: P2（与 Vote primary 同名混淆）
```

#### C. `LlmDomainCalibration.primaryDomain`

```text
Writer: result-builder-core projectLlmCalibrationFromSessionExtra
Reader: JobResult.extra.llmCalibration
Impact: 展示/校准载荷；非 Vote SSOT
Class: KEEP（LLM 合同字段）
Risk: P2 if Web 用它当句级领域 SSOT
```

---

### 6.4 `utteranceDomain`

```text
Field: utteranceDomain

Definition:
  UtteranceDomainVoteResult.utteranceDomain
  CoarseAssemblyInternalResult / metrics

Writer:
  selectRetainedDomains: retained[0] ?? 'general'
  orchestrator: 再赋值为 primaryDomain（同上）

Readers:
  1. orchestrator 写 metrics / internal
  2. buildFwSpansFromPathFineSpans → span.domain
  3. tests / probes
  4. JobResult via metrics spread

Decision impact: NONE on Vote/Bucket（Bucket 读 retainedDomains）
  INDIRECT: 诊断压缩展示
Final classification: DELETE 或 REPLACE_WITH_ARRAY → retainedDomains[]
  （不得 KEEP_DIAGNOSTIC：名字会误导为业务 SSOT）
Risk: P2
```

SSOT 关系：

```text
retainedDomains[] = SSOT
utteranceDomain   = 派生（retained[0] || general）
```

---

### 6.5 `domainId` / `ParentTermNgramRow.domainId`

见 §11–12。

---

## 7. `winnerScore` Audit

| 问题 | 答案 |
|------|------|
| = maxCount？ | 是 |
| 参与 retained 选择？ | 否 |
| 下游读取？ | JobResult `normalizedScore` 分母 |
| 真实语义 | 最高 domain presence count |
| 建议名 | `maxDomainCount` |
| 删除风险 | 低：改用 `Math.max(0,...Object.values(domainScores))` |

---

## 8. `winningFineDomain` Audit

| 问题 | 答案 |
|------|------|
| = retainedDomains[0]？ | 是 |
| 多领域丢信息？ | 字段层是 |
| fwSpan.domain？ | 同源变量写入 |
| 当唯一领域？ | Node 决策否；序列化暴露 |

---

## 9. `primaryDomain` Audit

| 语义实例 | 角色 | 进 Vote？ | 进 Prior 数组？ |
|----------|------|-----------|-----------------|
| orch `primaryDomain` | retained[0] 别名 | 否 | 否 |
| profile.primaryDomain | LLM/会话画像 | 否 | 否（另有 domainPriors[]） |
| llmCalibration.primaryDomain | JobResult 校准 | 否 | 否 |

共 **3 种不同语义**，同名高混淆。

---

## 10. `utteranceDomain` Audit

| 问题 | 答案 |
|------|------|
| = retained[0]\|\|general？ | 是 |
| Web/JobResult 消费？ | 随 fw_detector metrics 下发 |
| 回流 prior？ | **Node 内无**自动回流路径 |
| 数组退化？ | 字段本身退化；正式 prior 合同仍是数组 |

---

## 11. `domainId` Audit

| 形态 | 状态 |
|------|------|
| `WindowCandidate.domainId` | 生产类型 **无此字段**；freeze 测试禁止写入 KenLM pick |
| `domain_lexicon.domain_id` | 表列；`mergeDomainTierRows` 合并为 `domains[]` |
| `term_domain_tags.domain_id` | 标签 SSOT 列（多行） |
| `ParentTermNgramRow.domainId` | **残留单值**（见下） |
| `IndustryRouteHit.domainId` | 路由表；非 Candidate domains SSOT |
| legacy `lexicon-runtime.ts` row.domain → `[domain]` | LEGACY 路径（非 V4 主链） |

---

## 12. ParentTermNgram Multi-Domain Trace

### 12.1 Schema / Mapping

表：`term_pinyin_ngrams`  
列含：`domain_id`（可空）  
映射：`lexicon-runtime-v2.ts` → `ParentTermNgramRow.domainId`

**为何一行只有一个 domainId：**  
物理模型是 **parent×ngram×domain 扇出行**（多领域父词产生多行，各带一个 `domain_id`）。  
SQLite 实证：`预订` tags=4，`distinct ngram domain_ids`=4；`中杯` tags=3，ngram domains=3；`multi_tag_parents_with_fewer_ngram_domains=[]`。

### 12.2 Recall → Candidate 代码路径

```text
lookupParentFragmentsByNgramKey
  → fragmentRowAllowed(row.domainId ∈ domainIds)   // 行级门控
  → perParentTermPerWindow=1 → 同 parent 只取先出现的一行（first-row wins for WHICH row）
  → lookupTermDomainTagsInScope(parentTermId, domainIds)
  → scoreFragmentHit(..., parentScopeDomains)
       ngramRowToHotword: domains = [row.domainId]     // 临时单值
       if scopeDomains.length>0: hotword.domains = scopeDomains  // 覆盖为多标签
       else: 保留 [row.domainId]                         // FALLBACK 单值
```

### 12.3 真实词只读运行（全 scope）

| 词 | term_domain_tags | Candidate domains[]（生产 recall） |
|----|------------------|-------------------------------------|
| 预订 | food_order, tourism_hotel, tourism_route, transport | **同上 4 个**（parent_fragment） |
| 中杯 | coffee, food_order, milk_tea | **同上 3 个** |
| 发票 | food_order, tourism_hotel | **同上 2 个** |
| 打包 | （父词「打包」）bakery,coffee,food_order,milk_tea | **4 个**；另命中父「打包盒」仅 food_order |

结论：**正式 scope 下 enrichment 恢复完整 tags，未观察到 domains[] 被压成单值。**

### 12.4 专项问答

| # | 答案 |
|---|------|
| 1 为何单 domainId | 行级索引/过滤列；多域靠多行 + tags enrichment |
| 2 多 tags 时 | 多行 ngram；非只取一个 tag 入库；join 回 tags via `lookupTermDomainTagsInScope`；**选行** first-row/parent cap，**domains** 不靠 first-row |
| 3 是否只索引？ | 不只：用于 `fragmentRowAllowed` + fallback domains |
| 4 是否构造 candidate.domainId？ | **否**；构造 `hotword.domains` |
| 5 隐藏压缩路径？ | **有 latent fallback**：`parentScopeDomains.length===0` → `[row.domainId]` |
| 6 dialog_200 未暴露？ | 因主窗 domainIds 非空 + enrichment 成功；**不证明 fallback 死代码** |

`domainIds=[]` 时 domain-tier fragment 被 `fragmentRowAllowed` 全部拒绝（emptyScopeFragmentDomains=[]），故 length-1 空 scope 不会靠 fallback 投单值票；fallback 仍在源码中。

---

## 13. IPC / JobResult / Web Feedback Trace

```text
retainedDomains[]
  → spanAssemblyV4.retainedDomains（完整）
  → projectCurrentTurnDomains → extra.currentTurnDomains[]（≤3，数组）
  → extra.fw_detector 整包（含 winningFineDomain / utteranceDomain / winnerScore）

下一轮：
  JobAssign.domainPriors[] ← Web/Scheduler（Node：fw-job-overrides sanitizeDomainPriors）
  → ctx.domainPriors → budget prior quota only（不进 Vote）
```

| 检查项 | 结果 |
|--------|------|
| retainedDomains 是否发给 Web | 是（在 fw_detector / 可经 currentTurnDomains） |
| Web 是否原样回传数组 | **本仓无 Web 实现**；Node 合同接受数组 |
| Scheduler 保持数组 | 协议字段为数组（inference-service / test-server） |
| Node 保持数组 | sanitizeDomainPriors 保数组 |
| retainedDomains[0]→utteranceDomain→prior | **Node 无此自动链路** |
| 高风险旁路 | 若 Web 读 `winningFineDomain`/`utteranceDomain` 造单值 prior → **P1**（外部） |

`winnerScore` 仅用于 `normalizedScore`，不单独选域。

---

## 14. Multi-Domain Compression Risks

| 路径 | 压缩？ | 影响 |
|------|--------|------|
| Vote / Bucket | 否 | — |
| fwSpan.domain / winningFineDomain | 是（诊断） | 展示误导 |
| currentTurnDomains max 3 | 数组截断 | prior 上限，非单值 |
| ngram fallback `[domainId]` | 是（latent） | 若触发则 Candidate domains 变单 |
| exact mergeDomainTierRows | 否（合并） | — |
| domains[0] projection in Vote/Recall bind | 否（注释禁止） | — |

---

## 15. Dead / Legacy / Test-Only List

| Item | Class |
|------|-------|
| `selectedDomain` / `bestDomain` / `topDomain` / `winnerDomain` | DEAD（未出现） |
| `WindowCandidate.domainId` | DEAD / 已移除 |
| `buildFineSpanCandidatePoolFromCoarseSpansForTests` | TEST_ONLY |
| legacy `lexicon-runtime.ts` row.domain | LEGACY（非 V4） |
| `DomainId_Full_Removal_*.md` 中「Vote 硬依赖 domainId」 | DOCUMENTATION_STALE |
| Lexicon cleanup「fine winner 200」表述 | DOCUMENTATION_STALE（指标名） |

---

## 16. Stale Documentation List

| Doc | 问题 |
|-----|------|
| `DomainId_Full_Removal_PreDevelopment_Audit.md` | 称 Vote 硬依赖 domainId；现状 Vote 已读 `domains[]` |
| `Fine_Span_Domain_Presence_Vote_and_Multi_Bucket_Assembly_Development_Report.md` | 历史「单一 utteranceDomain 强制 winner」叙述（已修复，文仍在） |
| `Lingua_Domain_Vote_*` / Lexicon cleanup 中 fine winner 指标 | 诱导「一句一 winner」阅读 |

---

## 17. Risk Classification

| Item | Risk |
|------|------|
| ngram fallback → 单值 domains 若 enrichment 空 | **P1**（latent；当前全 scope 主路径未触发） |
| Web 误用 winningFineDomain 作下一轮 prior | **P1**（外部未证实；载荷已暴露） |
| fwSpan.domain / utteranceDomain / winningFineDomain 命名 | **P2** |
| winnerScore 命名 | **P2** |
| profile.primaryDomain 与 Vote primary 同名 | **P2** |
| 过时文档 | **P3** |
| Vote/Bucket 被单值字段改写 | **未发现 → 非 P0** |

---

## 18. Ownership Matrix

| 产物 | Owner | 非 Owner |
|------|-------|----------|
| domains[] | term_domain_tags (+ enrichment) | ngram.domainId（仅门控/fallback） |
| retainedDomains[] | voteUtteranceDomainFromPool | winningFineDomain |
| domainPriors[] | JobAssign / Web | utteranceDomain |
| currentTurnDomains | projectCurrentTurnDomains(retainedDomains) | winnerScore（仅分母） |

---

## 19. DELETE List

| 字段 | 理由 |
|------|------|
| `winningFineDomain` | 重复 retainedDomains[0]；误导 Owner；无 Node 决策消费者 |
| metrics/`internal` 中业务语义的 `utteranceDomain` | 同上（若删需同步删 fwSpan.domain 单值打标） |
| orch 局部名 `primaryDomain`（Vote 派生） | 与 LLM primary 撞名 |

（未上线 → 不保留兼容双写。）

---

## 20. RENAME List

| 当前 | 建议 | 条件 |
|------|------|------|
| `winnerScore` | `maxDomainCount` | 仍需对外暴露最高票数时 |
| （可选）metrics 注释澄清 | — | 避免 winner 语感 |

本轮 **不执行** rename。

---

## 21. REPLACE_WITH_ARRAY List

| 当前消费者 | 替换合同 |
|------------|----------|
| fwSpan.domain 单值 | `domains: retainedDomains[]` 或删除该字段 |
| JobResult 若有客户端读 winningFineDomain | 强制 `retainedDomains[]` / `currentTurnDomains[]` |
| ngram `domains=[domainId]` 初值/fallback | 始终 `lookupTermDomainTagsInScope`；禁止单值 fallback；或 ngram 表去掉 domain 语义只留索引 |

---

## 22. KEEP List

| 字段 | 条件 |
|------|------|
| `retainedDomains[]` | SSOT |
| `domainScores` | SSOT |
| `domainPriors[]` | 会话先验合同 |
| `profile.primaryDomain` / intent.primaryDomain | LLM 画像语义（改名隔离更佳，但属另一系统） |
| `term_domain_tags.domain_id` 列 | 多行标签存储，非单值 Candidate |
| `term_pinyin_ngrams.domain_id` 作为 **行过滤索引** | 仅当不再写入 Candidate domains 且 enrichment 强制 |

**不得 KEEP_DIAGNOSTIC：** `winningFineDomain` / `utteranceDomain`（名字误导）。

---

## 23. Target List

| ID | 答案 |
|----|------|
| T1 | `winnerScore` **不**参与 Vote/Bucket；仅 JobResult 归一化分母 |
| T2 | `winningFineDomain` **是** `retainedDomains[0]` 别名 |
| T3 | `primaryDomain` **3 种**：orch 别名 / profile / llmCalibration |
| T4 | `utteranceDomain` **Node 内不**回流 prior |
| T5 | Node **无** retained→单值→prior 自动链；JobResult **暴露**单值别名（外部风险） |
| T6 | 句级领域结果唯一 SSOT = **`retainedDomains[]`** |
| T7 | `ParentTermNgramRow.domainId` **间接**：门控 + fallback；正式路径被 tags enrichment 覆盖 |
| T8 | 多领域 term 经 ngram recall **在全 scope 下保留全部 in-scope 标签**（探针证实） |
| T9 | **有** first-row wins（选哪条 ngram 行 / perParent cap）；**无** domains[0] 作为 Vote 输入；fallback 才是单 domainId |
| T10 | **无** domainId 覆盖已合并的 exact `domains[]`；fragment **有** latent 单值 fallback |
| T11 | 可删且无需兼容：`winningFineDomain`；Vote 派生 `utteranceDomain`（及 fwSpan.domain 单值） |
| T12 | 必须数组化：fwSpan 领域打标、任何外部「当前句领域」消费 |
| T13 | 仅需改名：`winnerScore` → `maxDomainCount` |
| T14 | 未来隐藏 Owner 候选：`utteranceDomain` / `winningFineDomain` / ngram fallback / 同名 `primaryDomain` |
| T15 | **是**：`DomainId_Full_Removal_*`、部分 Vote/Lexicon 报告仍含 winner / domainId 硬依赖叙述 |

---

## 24. Check List

```text
[x] 未修改任何生产代码
[x] 未修改类型或数据库
[x] 未新增兼容逻辑
[x] 未重新审计或修改 Vote 算法
[x] 全仓搜索所有单值领域字段
[x] 每个字段均找到 Writer
[x] 每个字段均找到全部 Reader（Node 仓内）
[x] 区分生产 / 测试 / Probe / 文档
[x] 追踪 IPC / JobResult / Web 回流（Web 实现不在本仓）
[x] 追踪 retainedDomains[0] 使用
[x] 追踪 domains[0] 使用（生产 Vote/Recall 绑定：无）
[x] 追踪 ParentTermNgramRow.domainId
[x] 使用真实多领域词验证 ngram 数据路径
[x] 明确领域标签 SSOT
[x] 明确当前句领域结果 SSOT
[x] 输出 DELETE / RENAME / REPLACE_WITH_ARRAY 清单
[x] 所有建议均不保留历史兼容
[x] 未新增 Human Judgment 或语义启发式
```

---

## 25. Final Audit Conclusion

```text
PARTIAL

当前 Vote 结果未受影响，
但仍存在单值字段、命名或数据旁路，
需要删除、改名或替换为 retainedDomains[]。
```

**判定依据：**

- **非 FAIL：** 未发现单值字段正在改写 Recall/Vote/Bucket/Assembly；ngram 正式路径 enrichment 保留多标签；prior 合同为数组。
- **非 PASS：** `winningFineDomain`/`utteranceDomain`/`winnerScore`/`fwSpan.domain` 仍序列化；ngram `domainId` fallback 仍可单值化 `domains[]`；过时文档仍描述 winner/domainId 硬依赖。

**建议下一轮清理范围（仍不在本轮执行）：**

1. DELETE `winningFineDomain` + 诊断 `utteranceDomain` + `fwSpan.domain` 单值  
2. RENAME `winnerScore` → `maxDomainCount`（或内联 max）  
3. ngram：强制 tags enrichment，删除 `[domainId]` fallback；评估 `domain_id` 列是否降为纯过滤  
4. 文档：标记/废止 stale winner & domainId Vote 叙述  
5. 与 Web 对齐：只认 `retainedDomains[]` / `currentTurnDomains[]` / `domainPriors[]`
