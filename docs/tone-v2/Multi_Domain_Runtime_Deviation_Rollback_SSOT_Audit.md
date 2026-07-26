# Multi-Domain Runtime Development Deviation, Rollback and SSOT Recovery Audit

```text
STATUS: HISTORICAL AUDIT

Accepted as the audit that invalidated the Multi-Domain Development PASS and mandated R2 rollback.
Cannot replace Runtime_SSOT_Contract_Freeze.md as current architecture authority.
```

| 字段 | 值 |
|------|-----|
| Document Status | **HISTORICAL AUDIT** |
| 任务 | Multi-Domain Runtime Development Deviation and Rollback Audit |
| 性质 | **独立、只读、逆向架构审计**（未改代码 / 测试 / Bundle / 配置） |
| 基线 HEAD | `262b3d3`（`stable version`） |
| 工作区状态 | Multi-Domain Runtime 变更 **未提交**；工作区另含更早未提交的 span-assembly 改动（须与本轮分离） |
| Lexicon Bundle | v10 · `lexicon-domain-hierarchy-completion-v1` · **本轮未改** |
| 日期 | 2026-07-19 |
| 状态 | **ROLLBACK AUDIT COMPLETE — STOP** |

---

## 1. Executive Verdict

上一轮 Multi-Domain Runtime 开发 **不可采信其 PASS**。它把「修复 `domains[0]` 信息丢失」这一合法债务，与 **未经冻结批准的 Vote 均分算法**、**跨层 DTO 扩散**、**Shadow 同步迁移**、**ABI 降级假阳性测试** 一次合并实现，并违反了本仓已冻结的分阶段要求与 Assembly 数据合同。

**主结论：`C`（多领域合同被扩散到错误层级，需大范围回滚并重新设计）**  
并联证据：**`B`**（Vote/Assembly 算法偏航）、**`D` 要素**（Shadow/Beam 被继续投资）。

```text
Rollback Required: YES
Rollback Scope: PARTIAL（推荐 R2；若人工无法分割工作区噪声 → FULL Runtime 回退到 HEAD 相关文件）
Lexicon V10 / Hierarchy: KEEP
```

禁止根据上一轮 Development Report 继续验收或继续开发。

---

## 2. 冻结架构证据来源（非 Development Report）

| # | 来源 | 用途 |
|---|------|------|
| 1 | `docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md`（Frozen 2026-06-23） | Lexicon/Hierarchy/Recall Scope/Vote 证据字段 SSOT |
| 2 | `docs/fw-detector/recall/DOMAIN_RECALL.md` §4 | **VoteMass 公式**（含 DomainWeight） |
| 3 | `docs/fw-detector/CONTEXT_PRIOR.md` | Coarse = Vote **后** soft demotion，非 domains 硬过滤 |
| 4 | `docs/fw-detector/assembly/FROZEN_V1_2.md` | Main vs Shadow；Assembly pick **字段白名单** |
| 5 | `docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md` | `term_domain_tags` 唯一 Domain 标签 SSOT |
| 6 | `docs/tone-v2/Lingua_Domain_Vote_Correctness_and_SameDomain_Bucket_Formation_Audit_2026_07_16.md` | Vote 单位、sameDomain、`domains[0]` 债务 |
| 7 | `docs/tone-v2/Lingua_Sentence_Assembly_Domain_Base_Mixing_Logic_Audit_2026_07_16.md` | Assembly 主链；Shadow 不进 KenLM |
| 8 | `docs/tone-v2/Multi_Domain_Candidate_Contract_Audit.md` | 债务定位；**明确禁止本轮采用 `/domains.length`** |
| 9 | Git `HEAD` 实现 | 开发前真实代码（`domainId` 单值 Vote） |
| 10 | `freeze-contract.test.ts` / FROZEN 合同测试 | 正式 contract 约束 |

**明确不作为目标架构依据：**  
`Multi_Domain_Candidate_Contract_Development_Report.md`。

---

## 3. 本轮开发前真实架构（HEAD + 冻结文档）

```text
term + term_domain_tags          ← Domain 标签 SSOT
domain_lexicon                   ← materialized projection（JOIN 用）
domain_hierarchy                 ← Hierarchy SSOT（runtime 只读）
profile-registry.json            ← build-time seed（非 runtime domain SSOT）
        ↓
resolveRecallScope → recallDomainScope
        ↓
HotwordEntry { domain?, domains[], domainWeights? }
        ↓  ★ 压缩
WindowCandidate.domainId = domain ?? domains[0]
        ↓
voteUtteranceDomainFromPool
  VoteMass ≈ score × SOURCE_WEIGHT × coverage
  仅单 domainId；无 DomainWeight；无 /domains.length
        ↓
UtteranceDomainVoteResult.utteranceDomain  ← 句级决策
        ↓
sameDomain: domainId === winner
+ base + conditional fallback
        ↓
SpanReplacementPick { word, span, score, recallSource, repairTarget }
  （FROZEN_V1_2：无 domains / selectedDomain）
        ↓
buildSentenceCandidates → KenLM（纯文本）
```

Shadow（`Emit → ParentSpan → Graph → Beam`）：**仅 diagnostics**（FROZEN_V1_2）；禁止进 KenLM/Apply。

已知债务（审计已记录，非批准新算法）：

* `domains[0]` 压缩 → Vote/sameDomain 漏域  
* DSU/DOMAIN_RECALL 要求的 `domainTags`/`DomainWeight` **从未落地**（相对冻结公式是 DRIFT）

---

## 4. 本轮开发后真实架构（工作区）

```text
Hotword.domains[]（删 domain 镜像；union+字典序）  ✅ 接近 Lexicon 投影
        ↓
WindowCandidate.domains[] + selectedDomain?
GraphEdge.domains[] / ParentEvidence.domains[] / ParentSpan.domains[]
SpanReplacementPick.domains[] + selectedDomain?
FwSpan diagnostics: candidateDomains / selectedDomain / votedFineDomain…
        ↓
Vote: total / domains.length 均分到每个 tag     ❌ 未经冻结
sameDomain: domains.includes(winner) + 写入 selectedDomain
filterEligibleDomainsByCoarse() 新增 API         ⚠ 未主链硬接，但是错误语义入口
Shadow DTO 同步改为 domains[]                   ❌ 错误路线扩展
T8 ABI 不匹配 → return PASS                     ❌ False-positive
```

相对冻结图：Lexicon 事实被复制进过多 Runtime 对象；句级决策副本增多；Vote 语义被替换。

---

## 5. Git Diff 文件清单与分类

说明：相对 `HEAD`，工作区 **混有** Multi-Domain 变更与更早 span-assembly 未提交改动。下表以 **Multi-Domain 开发报告声称范围** 为主；标 `*` 的为可能混入的非本轮债务文件，回滚时不得误伤或须人工 diff 剥离。

| 文件 | 类 | 判定 |
|------|----|------|
| `lexicon/hotword-types.ts` | A | **可保留倾向**（删 `domain` 镜像） |
| `lexicon-v2/lexicon-runtime-v2.ts` merge union+sort | A | **可保留倾向** |
| `lexicon/lexicon-runtime.ts` / `candidate-score.ts` / `local-span-recall.ts` / `tone-first-tier-collector.ts` / `recall-span-topk-v2/v3.ts` | A/C | 去掉 `domain`/`domains[0]` kind：**部分可留**；须回退到不依赖新 Vote |
| `span-assembly-v4/recall-topk-for-windows.ts` | A/C | 保留完整 membership **必要**；但绑定了新 Vote 合同 → **随 Vote 策略回滚或重冻结** |
| `utterance-domain-vote.ts` | **B** | **必须回滚**（`/domains.length`） |
| `candidate-domains.ts`（新增） | B/C | **删除或大幅裁剪**（尤其 `filterEligibleDomainsByCoarse`） |
| `v4-types.ts` / `domain-assembly-types.ts` | C | **回滚扩散字段**；membership 是否留待 Contract Freeze |
| `types.ts`（GraphEdge/Evidence/Parent） | C/E | **回滚** Shadow/Graph 域数组 |
| `coarse-candidate-graph.ts` / `emit-v4-evidence.ts` / `assemble-parent-…` / `select-greedy-…` | E | **回滚** Shadow 迁移 |
| `assemble-domain-aware-span-sets.ts` / `window-candidate-to-pick.ts` | B/C | **回滚** selectedDomain 写入与新 Vote 耦合；`includes` 仅在合同冻结后重做 |
| `build-sentence-candidates.ts` / `fw-detector/types.ts` / `build-fw-spans-…` | C/G | **回滚** Assembly/诊断扩散 |
| `matched-domain.ts` 删除 | H/A | 删除首域选择器可接受；若回滚需评估引用 |
| `multi-domain-*-contract.test.ts` / `multi-domain-live-bundle.test.ts` | **F** | **删除或作废**（迁就实现 / 假阳性） |
| `assemble-domain-aware-span-sets.test.ts` 改 `domains` | F | **回滚预期** |
| `*` orchestrator / v4-limits / filter-domain-candidates 删除 / apply-tone-… 等 | H | **非本轮 Multi-Domain 核心**；回滚范围须人工剥离 |

---

## 6. 逐文件保留/回滚判定（重点清单）

### 6.1 Lexicon / Recall（偏 A）

| 文件 | 内容 | 冻结依据 | 保留？ |
|------|------|----------|--------|
| `hotword-types.ts` | 去 `domain?` | Lexicon Freeze：标签在 tags；DSU 允 domains/weights | **倾向保留** |
| `lexicon-runtime-v2.ts` | merge union + localeCompare | Multi-Domain Audit：SQL 多行应合并；排序稳定合理 | **倾向保留** |
| `recall-topk-for-windows.ts` | 写满 `domains[]` | Audit 债务；FROZEN 允许 Candidate 持 membership | **条件保留**（不得绑定均分 Vote） |
| `recall-span-topk-v2.ts` | 去掉 kind 的 `domains[0]` | 合理 | **倾向保留** |

### 6.2 Vote / Filter（偏 B）

| 文件 | 内容 | 冻结依据 | 保留？ |
|------|------|----------|--------|
| `utterance-domain-vote.ts` | `/ domains.length` | DOMAIN_RECALL：`× DomainWeight`；DSU：`domainTags/domainWeights`；**Multi-Domain Audit §10.2 明文禁止本轮采用均分** | **回滚** |
| `assemble-domain-aware-span-sets.ts` | `includes` + `selectedDomain` | sameDomain 职责正确方向；但与均分/多写决策耦合 | **回滚后按新合同重做** |
| `candidate-domains.ts` | `filterEligibleDomainsByCoarse` | CONTEXT_PRIOR：粗域是 **Vote 后 soft demotion**，不是 domains[] 硬过滤 | **回滚/删除** |

### 6.3 DTO 扩散（偏 C）

| 文件 | 问题 |
|------|------|
| `GraphEdge.domains` / `ParentTermEvidence.domains` / `ParentSpanCandidate.domains` | Shadow/Graph 不应成为 Lexicon 事实第二存储 |
| `SpanReplacementPick.domains/selectedDomain` | **违反** FROZEN_V1_2 pick 白名单 |
| `WindowCandidate.selectedDomain` | 句级决策副本；owner 应是 `UtteranceDomainVoteResult` |
| `FwSpanDiagnostics` 扩展 | 诊断可扩展，但与决策 SSOT 混写 |

### 6.4 Shadow（偏 E）

| 文件 | 判定 |
|------|------|
| `emit-v4-evidence.ts` / `assemble-parent-term-span-candidates-v4.ts` / `coarse-candidate-graph.ts` / `select-greedy-…` | FROZEN_V1_2：**停止 Beam 主链开发**；同步迁移 domains = **错误路线继续投资** → **回滚** |

---

## 7. 未经批准的算法变更

| 变更 | 标记 |
|------|------|
| `perDomainWeight = total / domains.length` | **未经冻结的算法新增**；Audit 曾建议但写明「不得直接采用」；无历史 contract test；DOMAIN_RECALL 公式是 `× DomainWeight` 而非均分 |
| 多 tag 同时加票 | DSU 提到 `domainTags`，但 **从未冻结「一票拆 N」的权重合同**；上一轮用均分 **擅自闭合** 开放设计点 |
| `filterEligibleDomainsByCoarse` | 与 CONTEXT_PRIOR soft demotion **语义冲突入口**（即便主链未 hard filter） |
| 一次改 DTO+Vote+Filter+Assembly+Shadow+日志 | 违反 Multi-Domain Audit §25「必须分阶段」与 FROZEN「Silent Change 禁止」精神 |

---

## 8. DTO 扩散分析

| 层 | 开发前 | 开发后 | 应否持有 Lexicon domains |
|----|--------|--------|---------------------------|
| DB / Hotword | tags + domains[] | domains[] | **是**（只读投影） |
| WindowCandidate | `domainId` | `domains[]` + `selectedDomain?` | **membership 可**；selectedDomain **否** |
| Vote evidence | 单 domainId | 多 domains 均分 | **应用 DomainWeight 合同（未冻结均分）** |
| GraphEdge / Parent* | domainId | domains[] | **否（Shadow）** |
| SpanReplacementPick | 可选诊断 domainId | domains + selectedDomain | **否（FROZEN 白名单）** |
| KenLM | 文本 | 文本 | **否** |
| Diagnostics | 弱 | 扩展多字段 | **仅观测，不得成决策副本** |

**结论：** 上一轮把 Lexicon Fact、Runtime Decision、Diagnostic Metadata **混成一个合同**，造成职责泄漏。

---

## 9. Decision SSOT 分析

| 决策 | 正确唯一 owner（冻结意图） | 开发现状 |
|------|---------------------------|----------|
| Recall Scope | `recallDomainScope` | 仍正确（未改 Bundle/Hierarchy） |
| Utterance fine winner | `UtteranceDomainVoteResult.utteranceDomain` | 仍存在，但证据输入被改写 |
| Candidate 入桶 | Filter 读 vote + membership | 额外写 `selectedDomain` 到 pick/candidate |
| 句文本 | Assembly / KenLM | 未改 KenLM 接口 |

**判定：`decision SSOT violation`（轻度～中度）** — winner 仍集中在 vote result，但 `selectedDomain` 被复制到多个对象，形成可变决策副本风险。

---

## 10. Shadow / Beam 偏航分析

证据：

* `FROZEN_V1_2.md`：Shadow **禁止**进 KenLM/Apply；**停止** Assembly/Domain Vote/**Beam 主链开发**  
* Mixing Audit：Shadow Beam **不**进 KenLM  

上一轮仍修改：

* `emit-v4-evidence.ts`  
* `assemble-parent-term-span-candidates-v4.ts`  
* `coarse-candidate-graph.ts`  
* `types.ts` Graph/Parent  
* `select-greedy-longest-parent-term.ts`  

**判定：错误路线被继续投资。**  
应在独立 Phase「Shadow Beam Retirement」处理删除；本轮迁移属偏航，应回滚而非「顺便修好」。

---

## 11. ABI 测试 False-positive 分析

`multi-domain-live-bundle.test.ts`：

```ts
if (msg.includes('NODE_MODULE_VERSION')) {
  runtime.close();
  return; // ← 仍 PASS
}
```

正式 Electron/`LexiconRuntimeV2` Hotword 路径 **未跑通** 时，suite 仍绿色。Python/SQL 仅证明 Bundle 标签存在，**不证明** Runtime Candidate 合同。

**标记：`False-positive acceptance`。**  
上一轮 Development Report 的 T8 PASS **无效作验收**。

---

## 12. 测试是否迁就实现

| 测试 | 判定 |
|------|------|
| `multi-domain-candidate-contract.test.ts` T3 均分 | **implementation-defined**；无冻结先例 |
| T4 `filterEligibleDomainsByCoarse` | 验证未冻结 API |
| `assemble-domain-aware-span-sets.test.ts` `domainId`→`domains` | **改写预期迁就 DTO**，非证明设计 |
| 无 dialog_200 / apply rate / winner 稳定性 E2E | 验收不足 |

---

## 13. Lexicon SSOT 是否仍完整

| 组件 | 角色 | 本轮 |
|------|------|------|
| `term` + `term_domain_tags` | Domain 标签 SSOT | **完整、未改** |
| `domain_lexicon` | materialized projection | **未改** |
| `domain_hierarchy` | Hierarchy SSOT | **未改（v10 KEEP）** |
| `profile-registry.json` | build-time seed | 非本轮 |
| `industry_routing_lexicon` | routing projection | 未改 |

**Lexicon 侧 SSOT：完整。** Runtime 侧把标签复制进过多 DTO，是 **Runtime SSOT/职责** 问题，不是 Lexicon 损坏。

---

## 14. Runtime SSOT 是否被破坏

| SSOT | 状态 |
|------|------|
| `recallDomainScope` | 基本完好 |
| `UtteranceDomainVoteResult` | **输入语义被替换**（均分）→ 破坏 |
| Assembly pick 合同 | **被字段污染** → 破坏 |
| Shadow 边界 | **被扩展修改** → 弱化冻结边界 |

---

## 15. Vote 语义是否有冻结依据

| 问题 | 答案 |
|------|------|
| 投票单位（冻结/审计） | **Candidate（带 domain 证据）**；非「每个 tag 独立一票」的已冻结定义 |
| DSU 字面 | `domainTags` + `domainWeights` |
| DOMAIN_RECALL 公式 | `Score × SourceWeight × Coverage × DomainWeight` |
| `/domains.length` | **无冻结依据**；Audit 禁止本轮采用 |
| 历史实现（HEAD） | 单 `domainId` 全额加分（已知相对 DSU 的 DRIFT） |

**方案 A–F：** 冻结资料 **未选定** 均分（A）。上一轮选 A = **擅自设计**。  
正确处置：回滚至开发前 Vote 行为（或显式冻结 DomainWeight），再开 **Vote Semantics Audit**，禁止在修复 PR 内选算法。

---

## 16. sameDomain 是否偏航

冻结/审计职责：

```text
Vote winner → sameDomain bucket + base (+ fallback if general)
```

`includes(winner)` 方向上修复「首项误杀」是合理的，但：

1. 依赖完整 membership（合法）  
2. 与均分 Vote、selectedDomain 多写 **捆绑上线**（偏航）  
3. FROZEN 未授权改 pick 形状  

**判定：动机正确，落地偏航（捆绑越权）。**

---

## 17. Assembly 是否职责污染

FROZEN_V1_2：

```ts
DomainAwareSpanReplacementPick { word, span, score, recallSource, repairTarget }
```

Assembly 应接收 **已筛选** 的 span candidates，组合文本；**不应**理解完整 `domains[]` / `selectedDomain` 作为组合逻辑输入。

上一轮将域字段写入 pick / sentence metadata：**职责污染 = YES**。

---

## 18. `general` 语义

| 语义 | 冻结 |
|------|------|
| Vote `insufficientEvidence` → `utteranceDomain=general` | 保留 |
| sameDomain 在 general 下恒空 | 保留（Vote Audit） |
| Base = 空 tags，**不是** `domain=general` | Lexicon Freeze |
| 上一轮 Base `domains:[]` | **符合** Lexicon Freeze |

`general fallback` 桶在 insufficientEvidence 时仍存在；未证明被错误删除。

---

## 19. parent_fragment 重复计分

HEAD 与现实现均：parent_fragment **每次 addScore**，`parentTermVoteCount` 仅去重计数。  
上一轮未修复该点；均分后可能把同一 parent 的多 fragment **拆到多域**。  
属既有债务 + 新算法放大风险；回滚 Vote 后仍须在 Vote Semantics 阶段单独审计。

---

## 20. 回滚方案 R1 / R2 / R3

### R1 — 整体回滚 Multi-Domain Runtime

* 将开发报告所列 Runtime/测试文件恢复至 `HEAD`（或丢弃未提交 patch）  
* 删除新增：`candidate-domains.ts`、`multi-domain-*.test.ts`  
* 恢复 `matched-domain.ts`（若仍需要）  
* **恢复** `domains[0]` 压缩行为（已知债务回潮）  
* **不影响** Lexicon v10 / hierarchy  
* 无数据迁移可撤销  

适用：无法安全剥离混杂工作区改动时。

### R2 — 保留 Recall 层，回滚 Vote/Assembly/Shadow 扩散（**推荐**）

**保留：**

* `mergeDomainTierRows` union + 稳定排序  
* Hotword 仅 `domains[]`（无首域镜像）  
* Recall 产出可携带 immutable domain membership（若保留，须短合同）

**回滚：**

* Vote `/domains.length`  
* GraphEdge/Parent/Evidence `domains[]`  
* `selectedDomain` 多处写入  
* Assembly pick / sentence 域字段扩散  
* Shadow 同步迁移  
* `filterEligibleDomainsByCoarse`  
* 迁就式测试 / ABI 假阳性测试  

回滚后状态：Lexicon 事实在 Hotword 更干净；主链 Vote 回到单 `domainId`（债务回潮但可运行）；等待 Contract Freeze。

### R3 — 最小 membership，回滚算法与 Shadow

保留 Candidate 可读 membership + sameDomain `includes` 的**意图**，但：

* Vote 仍单值/旧公式（不均分）  
* 不迁移 Shadow  
* 不写 selectedDomain 到多个对象  
* 不扩 Assembly  

**风险：** 在未冻结「membership 字段放哪」前仍可能半吊子。不如 R2 干净后再 Phase 2。

---

## 21. 推荐回滚方案

```text
推荐：R2（PARTIAL）
```

若人工确认工作区无法把 Multi-Domain 与其他未提交 span-assembly 改动分离 → 升级为 **R1 FULL**（仅 Runtime 文件，仍 KEEP Lexicon v10）。

---

## 22. 回滚文件列表（R2）

**必须回滚/删除：**

* `utterance-domain-vote.ts`  
* `candidate-domains.ts`（删）  
* `span-assembly-shared/types.ts`（Graph/Parent domains）  
* `coarse-candidate-graph.ts` / `emit-v4-evidence.ts` / `assemble-parent-…` / `select-greedy-…`  
* `assemble-domain-aware-span-sets.ts` / `window-candidate-to-pick.ts` / `domain-assembly-types.ts`  
* `build-sentence-candidates.ts` / `build-fw-spans-…` / `fw-detector/types.ts`（诊断扩散部分）  
* `multi-domain-candidate-contract.test.ts` / `multi-domain-live-bundle.test.ts`（删）  
* `assemble-domain-aware-span-sets.test.ts` 中迁就改动  

**条件保留（R2）：**

* `hotword-types.ts`、`lexicon-runtime-v2.ts` merge  
* `recall-topk-for-windows.ts` membership 输出（若与回滚后 `domainId` 并存冲突，则临时恢复 `domainId` 并另开 Phase 2）

**禁止回滚：**

* Lexicon Bundle v10  
* hierarchy completion  
* DSU / CFG-01 wiring（若工作区另有修复，单独评估，不随 Multi-Domain 报告误杀）

---

## 23. 必须保留的修改

* Lexicon v10 Bundle + hierarchy（**KEEP**）  
* （R2）Hotword `domains[]` 完整 union + 稳定排序 + 去除首域镜像 — **仅当**不阻碍回滚编译；否则并入 Phase 2 最小 membership  

## 24. 必须删除的修改

* Vote 均分算法  
* Shadow/Graph/Parent domains 迁移  
* Assembly/pick `selectedDomain`/`domains` 扩散  
* `filterEligibleDomainsByCoarse`  
* 迁就测试与 ABI 假阳性 PASS  
* Development Report 作为验收依据  

---

## 25. 恢复后的 SSOT 架构（不依赖当前实现）

依据 DSU + DOMAIN_RECALL + FROZEN_V1_2 + CONTEXT_PRIOR + Lexicon Freeze：

```text
Lexicon Domain Fact SSOT
  term + term_domain_tags (+ domainWeights)
  domain_lexicon = materialized projection only
  domain_hierarchy = Hierarchy SSOT
  profile-registry = build-time seed
        ↓
Recall Scope Owner
  resolveRecallScope → recallDomainScope
        ↓
Hotword / Recall Result
  immutable domain membership + domainWeights（只读投影）
        ↓
Candidate Owner（主链）
  WindowCandidate：可持 membership；不得持句级 selectedDomain
        ↓
Domain Evidence / Vote
  证据读 tags/weights（冻结公式含 DomainWeight；均分未冻结）
  UtteranceDomainVoteResult  ← 唯一句级 fine winner SSOT
        ↓
Context Prior（optional soft demotion）
  profile.primaryDomain coarse → ReRank multiplier
  禁止作为 domains[] hard filter / Vote 控制器
        ↓
sameDomain Filter Owner
  filterDomainCandidatesPerSpan(vote, membership)
  buckets: sameDomain + base (+ fallback)
        ↓
Assembly Owner
  只接收已筛选 SpanReplacementPick（文本合同）
  不理解完整 Lexicon domains / selectedDomain 副本
        ↓
KenLM Boundary
  纯文本句子
        ↓
Diagnostic Metadata Boundary
  可记录 candidateDomains / votedFineDomain，不得反向驱动决策
```

Shadow Beam：独立诊断链；**不得**扩展；删除在单独 Phase。

---

## 26. 分阶段恢复路线（禁止合并）

### Phase 0：Rollback

执行 R2（或 R1）；恢复可编译可运行基线；**不**宣称 multi-domain 已修。

### Phase 1：SSOT Contract Freeze（只文档）

冻结：

* 谁持有 domains membership  
* 谁持有 vote result  
* Assembly 是否允许任何 domain 字段  
* DomainWeight 定义（若启用多 tag 加票）  

**不开发算法。**

### Phase 2：Minimal Candidate Membership Repair

仅消除 `domains[0]` 导致的 sameDomain 误杀；**不改变** VoteMass 公式。

### Phase 3：Vote Semantics Audit

单独选定方案 A–F；产出冻结公式；再开发。

### Phase 4：sameDomain / Assembly Repair

按冻结合同改 Filter；Assembly 保持文本边界。

### Phase 5：Shadow Beam Retirement

独立删除/隔离 Shadow；禁止与 Phase 2–4 合并。

---

## 27. Target List

1. 作废上一轮 Development PASS  
2. PARTIAL/FULL Runtime 回滚（KEEP Lexicon v10）  
3. 冻结 DomainWeight / membership / Assembly 边界  
4. 最小 membership 修复与 Vote 语义拆分  
5. Shadow 独立退役  
6. 真实 Electron ABI 下 E2E 验收，禁止 ABI skip 当 PASS  

---

## 28. Check List

- [x] 冻结文档优先于 Development Report  
- [x] HEAD 开发前架构还原  
- [x] 开发后架构对照  
- [x] Vote 均分无冻结依据  
- [x] DTO 扩散 / Decision SSOT  
- [x] Shadow 继续投资  
- [x] ABI false-positive  
- [x] Lexicon v10 KEEP  
- [x] R1/R2/R3  
- [x] 分阶段恢复路线  
- [ ] （禁止）自动回滚  
- [ ] （禁止）继续开发  

---

## 强制结论格式

```text
PRIMARY VERDICT:
C
```

（并联：`B` Vote 算法偏航；`D` 要素 Shadow 扩展。不以 `A`/`E` 为主：`E` 不适用——冻结资料足以判定偏航方向；`A` 明确否定。）

```text
ROLLBACK REQUIRED:
YES
```

```text
ROLLBACK SCOPE:
PARTIAL
```

```text
LEXICON V10 BUNDLE:
KEEP
```

```text
DOMAIN HIERARCHY COMPLETION:
KEEP
```

```text
MULTI-DOMAIN RUNTIME DEVELOPMENT:
PARTIAL REVERT
```

```text
SHADOW BEAM:
REMOVE IN SEPARATE PHASE
```

（本轮回滚应撤销对 Shadow 的 domains 迁移；删除本身另开 Phase。）

```text
NEXT ACTION:
ROLLBACK AUDIT COMPLETE — STOP
```

等待人工确认后，再单独生成：

* `Rollback Execution Prompt`，或  
* `SSOT Contract Freeze Prompt`  

**禁止自动执行回滚。禁止根据本报告继续开发。**
