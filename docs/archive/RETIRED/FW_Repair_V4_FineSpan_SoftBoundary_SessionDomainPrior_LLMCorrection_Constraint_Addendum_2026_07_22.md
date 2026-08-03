<!-- Documentation Hierarchy Metadata
Status: **RETIRED**
Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0
Archive Path: docs/archive/RETIRED/FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_Constraint_Addendum_2026_07_22.md
-->

> **RETIRED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0

﻿> **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** (Step 6, 2026-07-30). SoftBoundary LTR Fine Span is deleted from runtime; see Runtime SSOT V1.2 + Lattice Architecture V1.0.0.
> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4
# FineSpan Soft Boundary + Session Domain Prior + LLM Correction
## Constraint Addendum

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Document Type | Final Constraint Addendum |
| Status | Binding with Development Plan |
| Companion Plan | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_Development_Plan_2026_07_22.md` |
| Supplement Basis | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_Supplement_2026_07_22.md` |
| Authority | Architecture SSOT / Runtime SSOT / frozen FW Repair V4 principles |
| Scope | Constraint / Contract / Boundary / Diagnostics / Trace / Regression / Acceptance only |

---

# 0. Final Analysis Verdict

本 Addendum 不修改已批准方案，不增加功能，不改变 Ownership，不重开任何架构选择。

最终结论：

```text
Development Plan 的方向正确；
Supplement 已消除主要算法歧义；
仍需补齐“写权限、读权限、最终决策权、反事实失败条件、不可达性验收”五类硬约束。
```

若缺少这些约束，最可能发生的再次漂移包括：

1. `domainPriors` 被写入 `enabledDomains`，由 soft prior 漂移成 hidden gate；
2. `activeLexiconProfile` 虽未显式调用，却通过 ALS / helper / context 间接影响 Recall；
3. LTR Generator 已存在，但旧 global-window helper 被 compatibility flag 重新接回；
4. Assembly 保留 overlap-subset 逻辑后继续承担第二次边界决策；
5. Web、Scheduler、Node 各自做一次 prior 清洗/排序，结果不一致；
6. diagnostics 字段被业务代码读取，形成 dead-feature resurrection；
7. `currentTurnDomains` 投影被误当作 Node 内部 Vote SSOT；
8. LLM `topicShift` 被当作直接切换指令，而不是 merger 的条件输入；
9. 无 prior 基线、错误 prior、LLM 失败等反事实未通过，却仅凭正向案例验收。

---

# 1. Source Classification

本文件中每项补充均标注以下来源之一或多项：

- **Historical Decision**：历史对话中已经明确形成的设计裁定；
- **Frozen Principle**：Architecture SSOT / Runtime SSOT / 冻结规则；
- **Previous Audit**：此前 FineSpan、Domain Vote、Beam retirement、SSOT 审计；
- **Previous Development**：已落地代码和已通过测试形成的事实；
- **Current Code**：本轮审计确认的真实实现；
- **Current Supplement**：本轮 Supplement Review 已钉死的补充。

---

# 2. Implementation Constraint

## ICST-01 — Production call graph must be singular

**Constraint**

```text
production FineSpan entry → LTR Generator only
```

旧 `generateGlobalWindows`、旧 overlap compatibility、旧 subset enumeration 不得通过：

- feature flag；
- fallback；
- debug mode；
- retry mode；
- low-confidence mode；
- test-environment branch；
- config override

重新进入 production call graph。

**来源**：Historical Decision、Frozen Principle、Previous Audit、Current Supplement  
**必要性**：仅删除主入口不足以阻止 compatibility resurrection。  
**影响范围**：orchestrator、imports、feature flags、runtime config、test server。  
**未来风险**：形成 Shadow Logic / Compatibility Logic，导致正式边界再次双决策。

## ICST-02 — Shared helper may be reused only if semantics remain neutral

旧 window/timestamp/recall helper 允许复用，但必须满足：

```text
helper 不得自行生成第二套正式 span
helper 不得自行做 domain gate
helper 不得读 session profile
helper 不得修改 cursor
```

**来源**：Previous Development、Current Code  
**必要性**：防止“复用 helper”成为隐藏主链。  
**影响范围**：window descriptor、tone extraction、recall helper。  
**未来风险**：函数名未变但职责扩大，形成隐式 bypass。

## ICST-03 — No silent default that changes decision semantics

以下缺省必须统一为 no-op：

```text
domainPriors missing → []
llmCalibration missing → no correction
unknown domain → drop item
empty currentTurnDomains → no session reset
contextPrior missing → diagnostics only
```

禁止通过默认值自动选择：

- top domain；
- config domain；
- profile primary domain；
- general domain；
- previous Node session domain。

**来源**：Frozen Principle、Current Supplement  
**必要性**：避免 hidden default gate。  
**影响范围**：deserialization、merger、Node bind。  
**未来风险**：不同服务的默认行为不一致，回放不可重现。

## ICST-04 — Constants are contract constants, not runtime tuning surface

本轮固定值：

```text
recentTurns = 4
maxDomainPriors = 3
maxBoundaryCrossCount = 1
windowLength = 2..5
DOMAIN_BUCKET_RETENTION_RATIO = 0.75
sentenceCandidateCap = 16
```

不得拆成多处配置、环境变量或 Web/Node 各自配置。

**来源**：Frozen Principle、Previous Development、Current Supplement  
**必要性**：减少配置漂移。  
**影响范围**：shared contract / V4 limits。  
**未来风险**：测试环境与生产行为分叉。

## ICST-05 — Commit-time assertions are mandatory

LTR commit 必须执行运行时断言或受控错误：

```text
selected.end > cursor
boundaryCrossCount <= 1
selected.rawStart == cursor coordinate
selected does not overlap previous formal span
formal span source != blocked
```

**来源**：Previous Audit、Current Supplement  
**必要性**：仅靠测试无法阻止局部修改破坏不变量。  
**影响范围**：LTR generator。  
**未来风险**：死循环、跳字、重叠、blocked option 正式化。

---

# 3. Architecture Constraint

## AC-01 — Four-layer domain architecture is closed

领域链路仅允许四层：

```text
Node current-turn evidence
→ Web session memory
→ LLM semantic correction input
→ Node soft prior consumption
```

不得增加第五层：

- Scheduler domain state；
- Node persistent session prior；
- Context Prior decision；
- KenLM domain adjustment；
- Assembly domain override。

**来源**：Historical Decision、Frozen Principle、Current Supplement  
**必要性**：限制所有权数量。  
**影响范围**：全链路。  
**未来风险**：Shadow Logic 和多 SSOT。

## AC-02 — Boundary architecture is also closed

```text
Coarse boundary owner = FW partition
Formal FineSpan boundary owner = LTR Generator
```

Compatibility、Recall、Vote、Assembly、KenLM 只能消费边界，不得产生或修订正式边界。

**来源**：Historical Decision、Previous Audit、Current Supplement  
**必要性**：防止边界决策后移。  
**影响范围**：candidate pool、assembly。  
**未来风险**：旧 overlap architecture 以新名称复活。

## AC-03 — No decision based on diagnostic mirror

以下字段属于 mirror / trace，不具备决策权：

- `fw_detector` diagnostics；
- `contextPrior*`；
- `architectureCompliance`；
- Node session profile mirror；
- Web merge trace；
- `currentTurnDomainsTruncated`。

业务代码不得读取这些字段改变结果。

**来源**：Frozen Principle、Current Code  
**必要性**：防止 diagnostics 变 hidden feature。  
**影响范围**：all downstream consumers。  
**未来风险**：Dead Feature 被重新激活。

## AC-04 — No cross-layer compensation

禁止：

```text
Generator 错切 → Assembly 补偿
Prior 错误 → KenLM 补偿
LLM 缺失 → Scheduler 猜测
Vote 稀疏 → Web 伪造 domain
Protocol 丢字段 → Node profile 兜底
```

**来源**：Historical Decision、Frozen Principle  
**必要性**：防止错误被转移到后层。  
**影响范围**：全链路。  
**未来风险**：链路变复杂且无法定位 first loss。

---

# 4. Decision Constraint

## DCN-01 — Decision precedence is absolute

同一候选上的证据优先级固定为：

```text
lexicon validity / complete term
> phonetic validity
> tone contradiction check
> boundary class
> domain prior tie-break
> length tie-break
> stable deterministic tie-break
```

`domainPriors` 不得越过 lexical / phonetic / tone / boundary validity。

**来源**：Historical Decision、Frozen Principle、Current Supplement  
**必要性**：防止 prior 自增强。  
**影响范围**：option comparator。  
**未来风险**：上下文把错误候选“扶正”。

## DCN-02 — Vote is prior-blind

Presence Vote 的输入结构可包含 prior diagnostics，但 vote 公式与计数不得读取 prior。

**来源**：Frozen Principle、Previous Audit  
**必要性**：避免历史 prior 反向污染当前句证据。  
**影响范围**：voteUtteranceDomainFromPool。  
**未来风险**：错误闭环：prior → vote → stronger prior。

## DCN-03 — Web merger is the only session decision function

任何服务不得重新计算：

- recent-turn weighting；
- Condition A；
- Condition B；
- stale calibration；
- single-turn tail protection。

Scheduler、Node 只消费结果。

**来源**：Frozen Principle、Current Supplement  
**必要性**：保证同一会话只有一个 merge 结果。  
**影响范围**：Web state / protocol。  
**未来风险**：服务间 merge 结果不一致。

## DCN-04 — LLM is advisory, never authoritative

LLM calibration 只可：

- 支持 Condition B；
- 为细域 mapping 提供候选；
- 提供诊断。

不可：

- 单独提升 domainPriors[0]；
- 清除历史 leader；
- 修改 currentTurnDomains；
- 修改 retainedDomains；
- 修改 SameDomain buckets。

**来源**：Historical Decision、Frozen Principle、Current Supplement  
**必要性**：避免 LLM 变第二领域主链。  
**影响范围**：LLM projection / Web merger。  
**未来风险**：高成本、不稳定、不可回放。

## DCN-05 — Top3 projection is not a decision truncation

`currentTurnDomains` Top3 仅是跨端传输投影；Node 内部 retained domains 和 Assembly bucket 不得因投影限制而截断。

**来源**：Current Code、Current Supplement  
**必要性**：分离内部事实与外部会话状态。  
**影响范围**：JobResult assembly。  
**未来风险**：协议限制反向改变当前句算法。

---

# 5. Responsibility Boundary

| Component | May read | May write | Final decision owned | Explicitly forbidden |
|---|---|---|---|---|
| FW partition | FW raw/timestamps | coarse spans/boundaries | coarse boundary | formal FineSpan |
| LTR Generator | coarse metadata, recall result, domainPriors | FormalFineSpan[] | formal boundary | current-turn domain |
| Recall | span option, lexicon, tone | candidates + domains[] | candidate validity/ranking base | session state |
| Domain Vote | formal pools | retainedDomains/domainScores | current-turn domain | prior merge |
| Assembly | formal spans, buckets | sentence candidates | sentence composition | overlap repair |
| KenLM | sentence candidates | scores/topK | language score | domain or span repair |
| Node JobResult | vote/calibration outputs | projection fields | none | recompute vote/merge |
| Web Merger | currentTurnDomains, llmCalibration | domainPriors | session domain prior | lexical recall |
| Scheduler | wire payload | validated passthrough | none | registry mapping/merge |
| LLM service | summary context, domain registry | calibration | advisory result | FineSpan/Vote control |

**来源**：Frozen Principle、Previous Audit、Current Supplement  
**必要性**：形成可审计 read/write/final-decision 矩阵。  
**影响范围**：所有模块。  
**未来风险**：责任边界模糊导致越权。

---

# 6. Interface Contract Additions

## IFC-01 — Exact field naming is frozen

只允许：

```text
currentTurnDomains
llmCalibration
domainPriors
```

禁止新增同义字段：

- `activeDomains`
- `sessionDomains`
- `contextDomains`
- `domainHints`
- `priorDomains`
- `domainContext`

**来源**：Previous Audit、Current Code  
**必要性**：避免重复中间态。  
**影响范围**：TS/Rust contracts。  
**未来风险**：多个字段语义逐步分叉。

## IFC-02 — Versioning is explicit

新增协议字段必须挂接现有消息版本；若现有协议无字段级版本，至少增加：

```text
domainContextVersion = "v1"
```

该版本只用于解析兼容，不得选择不同业务算法。

**来源**：Previous Audit、Current Supplement  
**必要性**：防止 Web/Node 部署不同步。  
**影响范围**：wire contract。  
**未来风险**：字段存在但语义不同。

## IFC-03 — Absence and empty are equivalent

```text
missing == null == []
```

仅对 `domainPriors`、`currentTurnDomains`。不得区分成不同业务分支。

**来源**：Frozen Principle  
**必要性**：减少兼容分支。  
**影响范围**：all deserializers。  
**未来风险**：形成 hidden compatibility behavior。

## IFC-04 — Payload order is deterministic

- `currentTurnDomains`: voteCount desc, domain asc；
- `domainPriors`: weight desc, domain asc；
- `secondaryDomains`: domain asc after weighting/mapping。

**来源**：Current Supplement  
**必要性**：retry、golden test、trace 对比。  
**影响范围**：serialization。  
**未来风险**：相同输入产生不同 payload。

## IFC-05 — No free-form extension object inside domain contracts

三个新增 contract 不得包含：

```text
metadata: Record<string, unknown>
extra: any
context: any
```

**来源**：Previous Audit、Frozen Principle  
**必要性**：防止绕过冻结 contract。  
**影响范围**：schema。  
**未来风险**：未来通过 metadata 偷渡新决策字段。

---

# 7. Data Contract Additions

## DCT-01 — Coordinate system must be singular

FormalFineSpan 的正式比较、排序、overlap assertion 使用唯一 canonical coordinate：

```text
syllableStart / syllableEnd = boundary decision coordinate
rawStart / rawEnd = trace and tone mapping coordinate
```

若当前代码选择 raw coordinate 为 canonical，必须在实现报告中明确并全链统一；不得混用两种坐标判断 overlap。

**来源**：Previous Audit、Current Code  
**必要性**：防止 tone/字符/音节错位。  
**影响范围**：generator、tone、assembly。  
**未来风险**：看似不重叠但实际覆盖重复字符。

## DCT-02 — Candidate domains remain arrays

```text
candidate.domains: string[]
```

禁止新增单值 `domainId` 决策字段；若外部库返回单值，进入主链前转换为数组。

**来源**：Historical Decision、Frozen Principle、Previous Development  
**必要性**：维护多领域词。  
**影响范围**：recall candidate。  
**未来风险**：一词一领域回归。

## DCT-03 — Fallback candidate emptiness is valid

Formal fallback span 允许：

```text
candidates = []
```

下游必须区分“无候选 fallback”与“异常丢失候选”，通过 `windowSource=fallback` 判断。

**来源**：Current Supplement  
**必要性**：避免伪造 canonical candidate。  
**影响范围**：pool/assembly。  
**未来风险**：fallback 被错误当 lexicon 命中。

## DCT-04 — Calibration mapping provenance is mandatory

LLM coarse→fine 映射后，每个 calibration item 的 trace 必须保留：

```text
sourceDomain
mappedFineDomain
mappingVersion
```

这些仅进入 diagnostics，不进入 Node `domainPriors` contract。

**来源**：Current Supplement  
**必要性**：解释 LLM 与细域不一致。  
**影响范围**：Web merger trace。  
**未来风险**：错误 mapping 无法追踪。

## DCT-05 — No persisted conversational text in domain state

`ConversationDomainState` 不得持有：

- raw utterance；
- full transcript；
- long summary；
- candidate text list。

只保存领域结构和时间戳。

**来源**：Frozen Principle、Historical Decision  
**必要性**：隐私与状态最小化。  
**影响范围**：Web state。  
**未来风险**：状态膨胀、隐私越界。

---

# 8. Ownership Constraint

## OWN-01 — Single writer rule

| State | Single writer |
|---|---|
| coarse spans | FW partition |
| FormalFineSpan[] | LTR Generator |
| currentTurnDomains source | Domain Vote |
| currentTurnDomains projection | Node JobResult assembler |
| ConversationDomainState | Web merger |
| domainPriors | Web merger |
| llmCalibration | LLM projection layer |
| architectureCompliance trace | diagnostics assembler |

其他模块只能读，不能改写。

**来源**：Frozen Principle、Current Supplement  
**必要性**：消除多 writer。  
**影响范围**：全链路。  
**未来风险**：同一状态出现顺序依赖。

## OWN-02 — Node SessionObject is non-authoritative for prior

Node 可缓存 profile/summary/diagnostics，但不得写出能够改变 FineSpan 的 `sessionDomainPriors` 或等价字段。

**来源**：Historical Decision、Current Supplement  
**必要性**：防止节点粘性与多节点不一致。  
**影响范围**：session-finalize。  
**未来风险**：调度到不同节点后结果漂移。

## OWN-03 — Web state is scoped by exact sessionId

不得使用用户 ID、socket ID、page ID、device ID 替代 sessionId 作为领域状态键。

**来源**：Current Code、Current Supplement  
**必要性**：避免跨会话串话。  
**影响范围**：Web store。  
**未来风险**：多会话领域污染。

---

# 9. Diagnostics Requirement

## DIA-01 — Decision reason must be machine-enumerated

禁止自由文本作为唯一决策原因。必须使用枚举：

```text
complete_in_span
complete_cross_boundary
fallback_single_step
prior_tiebreak
shorter_exact_tiebreak
stable_tiebreak
rejected_cross_gt_1
rejected_partial
rejected_overlap
```

**来源**：Previous Audit、Current Supplement  
**必要性**：可聚合、可回归。  
**影响范围**：FineSpan trace。  
**未来风险**：日志可读但无法自动验收。

## DIA-02 — Every prior effect must be observable

必须记录：

```text
rankingBeforePrior
rankingAfterPrior
priorChangedWinner: boolean
```

若 prior 改变 winner，必须证明 K1/K2 全等。

**来源**：Frozen Principle、Current Supplement  
**必要性**：验证 prior 未越权。  
**影响范围**：option comparator diagnostics。  
**未来风险**：soft prior 实际变强 gate。

## DIA-03 — Hidden-gate audit fields

每次请求至少记录布尔项：

```text
priorWrittenToEnabledDomains = false
profileAffectedRecall = false
contextPriorDecisionApplied = false
schedulerMergedDomains = false
assemblyChangedFormalBoundary = false
kenlmReceivedDomainPrior = false
```

**来源**：Previous Audit、Current Supplement  
**必要性**：直接发现架构漂移。  
**影响范围**：architecture compliance trace。  
**未来风险**：旁路存在但常规功能测试无法发现。

## DIA-04 — Dead feature reachability report

开发报告必须附 production import/call graph，列出：

- 仍可达；
- 测试可达；
- archive-only；
- 完全不可达。

重点覆盖 global windows、weak-domain、context prior、old detector、overlap subset。

**来源**：Previous Audit  
**必要性**：代码存在不等于 production 使用。  
**影响范围**：static audit。  
**未来风险**：Dead Feature 被误判为已删除或被未来重接。

---

# 10. Trace Requirement

## TRC-01 — End-to-end correlation IDs

以下记录必须通过同一：

```text
sessionId + utteranceId + jobId + attempt
```

关联：

- Web input prior；
- Scheduler cleaned prior；
- Node consumed prior；
- currentTurnDomains；
- Web merger output。

**来源**：Previous Audit、Current Supplement  
**必要性**：支持 retry 与跨端回放。  
**影响范围**：all traces。  
**未来风险**：无法确认 prior 属于哪一轮。

## TRC-02 — Trace records before/after, never only final

以下操作必须有 before/after：

- Scheduler cleaning；
- Node normalization；
- Web aggregation；
- LLM correction application；
- option prior tie-break。

**来源**：Previous Audit  
**必要性**：定位 first divergence。  
**影响范围**：trace schemas。  
**未来风险**：只能看到结果，无法判断谁改变了状态。

## TRC-03 — Trace must not become persisted state

Trace 不得被读取并作为下一轮 input；Web 下一轮只读 `ConversationDomainState`。

**来源**：Frozen Principle  
**必要性**：防止 trace 变 shadow memory。  
**影响范围**：Web/debug tooling。  
**未来风险**：调试字段进入生产决策。

---

# 11. Regression Requirement Additions

除 Development Plan 与 Supplement 的用例外，新增以下强制回归：

| ID | Case | Expected |
|---|---|---|
| R-ADD-01 | activeLexiconProfile 存在，domainPriors=[] | FineSpan 与无 profile 基线一致 |
| R-ADD-02 | domainPriors 存在，enabledDomains 不同 | prior 不改变 recall scope membership |
| R-ADD-03 | contextPrior diagnostics 写入任意 domain | 当前结果不变 |
| R-ADD-04 | Scheduler 删除 llmCalibration | currentTurnDomains 主链正常，prior 不清空 |
| R-ADD-05 | retry attempt=2 | consumed domainPriors 与 attempt=1 完全一致 |
| R-ADD-06 | old global-window feature flag=true | production 仍不可进入旧路径，或该 flag 已删除 |
| R-ADD-07 | Assembly 收到重叠 FormalFineSpan（构造非法输入） | fail-fast，不自行修复 |
| R-ADD-08 | KenLM 收到 domainPriors（构造错误接线） | contract/static test 失败 |
| R-ADD-09 | LLM topicShift=true、currentTurnDomains=[] | 不切换 |
| R-ADD-10 | LLM 映射出未知 fine domain | 丢弃并记录 mapping rejection |
| R-ADD-11 | currentTurnDomains 字段顺序随机 | Web canonicalize 后同一 priors |
| R-ADD-12 | domainPriors 顺序随机 | Node canonicalize 后同一 option result |
| R-ADD-13 | fallback span candidates=[] | Assembly 正常，不伪造领域票 |
| R-ADD-14 | formal span coordinate raw/syllable 边界不一致 | fail-fast/diagnostic error，不静默继续 |
| R-ADD-15 | diagnostics 字段被业务模块读取 | static architecture test 失败 |

**来源**：Historical Decision、Previous Audit、Current Code、Current Supplement  
**必要性**：覆盖 Shadow Logic、Bypass、Hidden Gate、Dead Feature。  
**影响范围**：unit/integration/static architecture tests。  
**未来风险**：仅正向功能通过但架构已漂移。

---

# 12. Acceptance Requirement Additions

## AR-01 — Positive behavior is insufficient

本轮验收必须同时通过：

```text
positive acceptance
negative acceptance
counterfactual acceptance
architecture reachability acceptance
```

只证明“prior 有效果”或“酒店可以跨界”不足以验收。

## AR-02 — Static architecture acceptance

必须证明：

- production import graph 只有 LTR；
- Vote 不 import Web/LLM merger；
- Scheduler 不 import lexicon/LLM/domain merger；
- KenLM 不 import domain prior types；
- Assembly 不 import global overlap subset helper；
- diagnostics types 不被 decision modules import。

## AR-03 — Runtime invariant acceptance

在 dialog_200 与专项用例中：

```text
formalOverlapCount = 0
boundaryCrossCountViolation = 0
cursorNonAdvanceCount = 0
priorAsGateCount = 0
profileAffectedRecallCount = 0
assemblyBoundaryRepairCount = 0
```

## AR-04 — Removal acceptance

DELETE 不能仅以“没有调用日志”通过，必须满足：

- production import 不可达；
- runtime flag 不可启用；
- config 不再暴露；
- tests 不以旧路径作为 fallback；
- docs 不再描述为可用模式。

**来源**：Previous Audit、Current Supplement  
**必要性**：真正消除 compatibility logic。  
**影响范围**：final audit。  
**未来风险**：删除不彻底，后续开发者重新启用。

---

# 13. Counterfactual Requirement

以下反事实必须形成独立测试章节和结果表。

## CF-01 — No prior

```text
domainPriors=[]
```

结果必须等于 LTR 无上下文基线；不得偷偷使用 profile、context prior 或 config domain 代替。

## CF-02 — Wrong prior

餐饮 prior + 明确酒店当前句：

- 当前句 Vote 必须转向酒店；
- prior 不得过滤酒店候选；
- Web 下一轮才逐步调整。

## CF-03 — LLM unavailable

LLM timeout/parse failure：

- currentTurnDomains 正常；
- Web recent-turn aggregate 正常；
- 不清空 prior；
- 不调用 fallback domain classifier。

## CF-04 — Empty vote

无有效 domain vote：

- currentTurnDomains=[]；
- prior 保持；
- 不把 base/general 伪造成 domain。

## CF-05 — Protocol field stripped

模拟旧 Scheduler 剥字段：

- contract integration test 必须失败；
- 不允许 Node profile 兜底使测试“看似通过”。

## CF-06 — Old path available

若旧 global windows 函数仍存在：

- static test 必须证明 production 不可达；
- 任意 flag/config 无法切换。

## CF-07 — Invalid formal overlap

人工注入重叠 formal spans：

- Assembly 必须拒绝/fail-fast；
- 不得自行选择 subset 后继续。

## CF-08 — Prior changes lexical-invalid winner

构造 prior 强命中但 lexical/tone 无效候选：

- 该候选不得胜出；
- trace 证明 prior 仅进入允许层级。

**来源**：Frozen Principle、Previous Audit、Current Supplement  
**必要性**：反证系统没有 hidden fallback / bypass。  
**影响范围**：integration/architecture tests。  
**未来风险**：正常案例掩盖错误链路。

---

# 14. Architecture Compliance Requirement

## ACR-01 — Compliance is binary

以下任一发生即本轮不合规，不允许“部分通过”：

- formal overlap > 0；
- production global-window path reachable；
- domainPriors 写入 recall scope；
- active profile 改变 FineSpan；
- Context Prior applied=true；
- Scheduler 合并 domain；
- Assembly 修复正式边界；
- KenLM 读取 prior；
- LLM 单独切换 session leader；
- Node 保存 authoritative session prior。

## ACR-02 — Compliance evidence set

最终必须提交：

1. production call graph；
2. ownership matrix；
3. TS/Rust golden contracts；
4. architecture trace samples；
5. counterfactual report；
6. DELETE reachability report；
7. dialog_200 result；
8. performance comparison；
9. KEEP/MODIFY/RESTORE/DELETE completion matrix。

## ACR-03 — Documentation consistency

Architecture SSOT、Development Plan、Supplement、Constraint Addendum、Development Report 必须使用同一字段名和 owner。出现以下任一差异即失败：

- Web/Node prior owner 不一致；
- `domainPriors` 挂载点不一致；
- topicShift 语义不一致；
- FormalFineSpan coordinate 不一致；
- Top3 与 retainedDomains 语义混淆。

**来源**：Historical Decision、Frozen Principle、Previous Audit、Current Supplement  
**必要性**：防止文档层再次漂移。  
**影响范围**：final freeze。  
**未来风险**：下一轮开发依据不同文档产生分叉。

---

# 15. KEEP / MODIFY / RESTORE / DELETE

## KEEP

- 已冻结唯一主链；
- Web session prior ownership；
- Node current-turn Vote ownership；
- Scheduler zero-inference；
- LLM async low-frequency correction；
- `term_domain_tags` 多领域；
- `boundaryCrossCount<=1`；
- sentence cap 16；
- Context Prior diagnostics-only；
- existing Vote retention ratio 0.75；
- `sessionId` 作为唯一会话键。

## MODIFY

- 将所有新增字段纳入单一版本化 contract；
- 将 read/write/final-decision 权限落实到代码和测试；
- 为 LTR commit 增加运行时不变量；
- 为 diagnostics 增加 machine enum 和 hidden-gate flags；
- 为 Web merger、Scheduler cleaning、Node normalization 增加 before/after trace；
- 为 Assembly 增加非法重叠 fail-fast；
- 为 DELETE 项增加 production reachability 验收。

## RESTORE

仅恢复冻结语义：

- pause/coarse boundary 的 soft 参考；
- current evidence 优先；
- base 与 other-domain exploration；
- LLM 作为低频纠偏；
- 多领域词完整 tags。

不恢复任何旧代码主链。

## DELETE

除 Development Plan / Supplement 已列项目外，进一步删除或禁止：

- 同义 domain contract 字段；
- domain contract 内自由 `metadata/extra/context`；
- 允许切换旧 global-window path 的 flag/config；
- diagnostics→decision imports；
- Assembly 对非法 formal overlap 的自动修复；
- LLM 缺失时的备用 domain classifier；
- Node profile 对 prior 的隐式 fallback；
- 任何未版本化、不同语义的协议旁路。

---

# 16. Final Binding Statement

本文件仅补充约束，不修改 Development Plan 已批准的目标、架构、开发项和开发顺序。

唯一开发依据由以下文档共同组成：

```text
Architecture SSOT / Runtime SSOT
+
FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_Development_Plan_2026_07_22.md
+
FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_Constraint_Addendum_2026_07_22.md
```

Supplement Review 是本 Addendum 的分析输入；其中已被本文件升级为硬约束的内容，以本 Addendum 的编号和表述作为实施与验收依据。

冲突优先级：

```text
Architecture SSOT / Frozen Principle
> Development Plan 的已批准架构与 Ownership
> Constraint Addendum 的实现/契约/验收约束
> Development Report
> 测试说明与临时注释
```

任何实现若通过兼容、fallback、diagnostics、profile、scope、config 或测试分支重新引入第二决策链，均视为架构不合规。

