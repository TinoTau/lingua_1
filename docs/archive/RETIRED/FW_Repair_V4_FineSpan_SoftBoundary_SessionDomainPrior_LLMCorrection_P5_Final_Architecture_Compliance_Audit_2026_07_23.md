<!-- Documentation Hierarchy Metadata
Status: **RETIRED**
Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0
Archive Path: docs/archive/RETIRED/FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_P5_Final_Architecture_Compliance_Audit_2026_07_23.md
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
## P5 Final Architecture Compliance Audit

| Field | Value |
|---|---|
| Date | 2026-07-23 |
| Document Type | Final Architecture Compliance + Counterfactual Validation（只读） |
| Status | **Architecture Freeze: FAIL** |
| Method | Code evidence only; no redesign; no code changes |
| Authority | Runtime SSOT / Development Plan / Constraint Addendum / Supplement / Development Report |
| Code Basis | Repository state as of 2026-07-23 |

---

# 1. Executive Summary

本轮对当前仓库做冻结前只读验证。FineSpan **LTR 生产入口、正式边界所有权、Soft Boundary≤1、Vote formal pool、Scheduler schema 透传、Node 非权威 Session Prior** 等多项子能力已在代码中落地。

但冻结目标要求的 **Session Prior 生产闭环** 与 **LLM Condition B 数据链** 在现码中**未闭合**：

1. **生产 Web 主路径走 AudioChunk finalize，`domainPriors` 被固定为 `None`**，`sendUtterance` 上的 prior 附件在生产会话中不可达。
2. **`topicShift` 解析后未写入 `LexiconSessionIntent` / 出站 `llmCalibration`**，Web Condition B 运行时恒不触发。
3. **`applyDomainPriorQuota` 未覆盖全部 Recall 路径**（仅 Assembly 选候选）；且因 (1) 生产 prior 常空，配额实际 no-op。
4. **LTR 后 dialog_200 回归未执行**，无法证明相对开发前无退化。
5. Tone 为 **commit 复用临时窗 tone**，非 Supplement 要求的 commit 后按 Formal range 再提取（PARTIAL）。

依据 Constraint Addendum ACR-01（任一项不合规即本轮不合规）与用户要求（不得用「基本通过」）：

```text
Architecture Freeze
FAIL
```

---

# 2. Runtime Architecture（代码证实）

```text
ASR / FW Raw
 → partitionCoarseSpans                    [coarse boundary owner]
 → runLtrFineSpanGeneration                [formal FineSpan owner]
      generateLocalOptionsAtCursor
      recallTopKForWindows (temporary options)
      commitBestFormalFineSpan
 → Compatibility (candidate cover/conflict only)
 → runDomainAwareAssembly(formalSpans)     [Vote + buckets]
 → buildFwSpansFromFormalFineSpans
 → buildSentenceCandidates                 [per formal slot]
 → KenLM rerank                            [sentence score only]
 → JobResult.extra.currentTurnDomains
 → (Scheduler ExtraResult) → Web merger
 → (intended) domainPriors → JobAssign
 → Node ctx.domainPriors (soft only)
```

**生产断点：** Web 会话默认 **AudioChunk → actor_finalize → domain_priors=None**，上图最后两环在生产流式路径上**不成立**。

---

# 3. Production Entry Graph

```text
runFwDetectorOrchestrator
  └─ runFwDetectorV4Path
       └─ runSpanAssemblyV4Orchestrator
            └─ runLtrFineSpanGeneration     ★ UNIQUE production FineSpan entry
```

| Symbol | Production reachable? | Evidence |
|---|---|---|
| `runLtrFineSpanGeneration` | **Yes — unique** | `span-assembly-v4-orchestrator.ts` ~159 |
| `generateGlobalWindows` | **No** | only `generate-global-windows.ts` + `*.test.ts` |
| `truncateWindows` | **No** as formal producer | orchestrator `truncatedCount = 0`; only tests call truncate |
| Dual-path flag | **None** | `globalWindowProductionPath: false` literal |

**Verdict: PASS** — 唯一生产 FineSpan 入口 = LTR Generator。

---

# 4. Formal Span Ownership

| Layer | May decide formal boundary? | Evidence |
|---|---|---|
| LTR `commitBestFormalFineSpan` | **Yes — sole owner** | `ltr-fine-span-generator.ts` commit + cursor=`syllableEnd` |
| Compatibility | No | marks cover/conflict only |
| Assembly / `allNonOverlapSubsets` | No formal boundary | per-slot repair alternatives inside already-committed spans (`build-sentence-candidates.ts`) |
| KenLM | No | scores prefilled sentences |
| Coarse partition | Coarse only | `partitionCoarseSpans` |

**Cursor path:** `cursor → options → commit → cursor=end`；无 Beam/DP/回退（`beamEnabled: false`）。

**Soft boundary:** `V4_LIMITS.maxBoundaryCrossCount=1`；blocked at generate / commit / `blockedFilter`；跨 >1 不可 commit。

**Verdict: PASS**（Formal ownership + soft boundary + cursor-only）。

---

# 5. Runtime Session Diagram

### Intended (frozen)

```text
Node Vote → currentTurnDomains → Scheduler ExtraResult → Web ConversationDomainState
  → domainPriors → Utterance/JobAssign → Scheduler validate → Node ctx.domainPriors → FineSpan soft
```

### Actual production (Web desktop session)

```text
Node Vote → currentTurnDomains → ExtraResult → Web merger  ✅
Web store.domainPriors                                        ✅ (in memory)
sendUtterance attaches domainPriors                           ⚠️ API exists
session_manager finalize → sendAudioChunk ONLY                ❌
actor_finalize domain_priors = None                           ❌ HARD FAIL
Node ctx.domainPriors = []                                    ❌
```

证据：

```214:216:central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs
            // 协议未在 AudioChunk 上携带 domainPriors，故此处固定为 None
            None,
```

```217:219:webapp/web-client/src/app/session_manager.ts
        // 发送剩余的音频块（通过 audio_chunk，而不是 utterance）
        await this.wsClient.sendAudioChunk(audioData, false);
```

**Node Session Prior as decision SSOT?** **No** — PASS for ownership（Web only）。`JobContext.domainPriors` 是 job soft 输入，非 Node Session 权威态。

**Verdict: FAIL** — Session Prior **Closed Loop** 在生产路径断开。

---

# 6. Dual Prior / Residual Call Chains

| Residual | Affects FineSpan ranking/scope/quota? | Chain |
|---|---|---|
| `weakDomainPlan` | **No** | orchestrator passes `weakDomainPlan: undefined` |
| `activeLexiconProfile` | **No** (V4 scoring) | passed into recall but `domainBoost=0` / unused for ranking |
| ALS `runWithLexiconRecallContext(sessionIntent)` | **No** on V4 | only legacy `local-span-recall` reads ALS |
| Context Prior | **No** | `contextPriorDecisionApplied: false` |
| `domainPriors` → `resolveRecallScope` | **No** | separate bind; scope uses `enabledDomains` override only |

**Verdict: PASS** for “no dual prior decision on V4 main chain”（残差 plumbing 仍在，但不改 FineSpan 决策）。

---

# 7. Scheduler Zero Inference

| Check | Result | Evidence |
|---|---|---|
| Domain merge | No | — |
| Domain vote | No | — |
| LLM call | No | — |
| Prior validate | Schema only | `domain_prior_validate.rs` |
| ExtraResult fields | Passthrough | `currentTurnDomains`, `llmCalibration` |

**Verdict: PASS**

---

# 8. Recall Call Graph

```text
LTR step:
  recallTopKForWindows(temporary windows)
    └─ recallSpanTopKV3 / lexicon SQL
    └─ NO applyDomainPriorQuota

Assembly:
  selectPerSpanCandidates
    └─ applyDomainPriorQuota(...)   ★ sole production call site
```

| Requirement (user P5 §五) | Status |
|---|---|
| 所有 Recall 统一经 `applyDomainPriorQuota` | **FAIL** — LTR/Recall SQL 路径不经 quota；仅 Assembly |
| prior 不进 scope gate | **PASS** |

生产因 Session 断链，Assembly quota 亦常对 `[]` 退化为 score 截断。

**Recall Call Graph Verdict: FAIL**（相对“全部 Recall 经 quota”的验收条）。

---

# 9. Tone Binding

```text
LTR option → recallTopKForWindows extracts tone for temporary rawStart/rawEnd
commit → copies winner.candidates (tone fields included)
NO second extractAcousticTonePatternForRecall on FormalFineSpan
```

坐标与胜出 option 一致时语义等价，但 **不满足** Supplement「commit 后必须按最终 Formal range 再确认」的硬表述。

**Verdict: PARTIAL**（功能绑定正确区间；契约“再提取”未实现）。

---

# 10. Vote Input Diagram

```text
ltr.formalSpans
  → activeCandidates (from formal commits)
  → buildFineSpanCandidatePool(..., formalSpans)   // formal primary key
  → voteUtteranceDomainFromPool(pool)
```

Legacy coarse branch exists if `formalSpans` omitted — **production always passes formalSpans**.

**Verdict: PASS**（生产 Vote 输入 = Formal FineSpan Pool）。

---

# 11. LLM

| Check | Result | Evidence |
|---|---|---|
| FineSpan → LLM sync | **PASS（无）** | Intent async after finalize; not in LTR |
| Parser `topicShift` not = `shouldSwitch` | **PASS** | `lexicon-profile-decision-parser.ts` `topicShift = obj.topicShift === true` |
| `topicShift` reaches `llmCalibration` | **FAIL** | `buildLexiconSessionIntentFromDecision` **omits** `topicShift`; `LexiconSessionIntent` type has no field; projection reads `intent.topicShift === true` → always false |
| Condition B usable | **FAIL** | depends on above |

```73:89:electron_node/electron-node/main/src/lexicon-v2/lexicon-session-intent.ts
export function buildLexiconSessionIntentFromDecision(...) {
  return {
    summary, topicKeywords, ... primaryDomain, secondaryDomains, confidence,
    // topicShift NOT copied
    ...
  };
}
```

**Verdict: FAIL**（实时链退出 PASS；校准闭环 FAIL）。

---

# 12. Dead Feature / Production Reachability

| Symbol | Classification | Evidence |
|---|---|---|
| `runLtrFineSpanGeneration` | **Production** | orchestrator |
| `generateGlobalWindows` | **Test Only** | only `*.test.ts` imports |
| `truncateWindows` as formal budget | **Test Only / Unreachable in prod formal path** | orchestrator unused |
| `buildFwSpansFromCoarseAssemblyV4` | **Deprecated / Test** | `@deprecated`; prod uses Formal builder |
| `buildFineSpanCandidatePool` coarse branch | **Dead API branch** | reachable if caller omits formalSpans; prod does not |
| Detector (legacy archive) | **Archive** | `legacy/archive/fw-detector-span/` |
| Beam | **Unreachable** | no beam state; `beamEnabled:false` |
| Compatibility boundary decision | **Unreachable as boundary owner** | candidate relations only |
| Context Prior decision | **Dead decision / Diag alive** | `applied:false` |
| Weak Domain on FineSpan | **Unreachable on V4** | `weakDomainPlan: undefined` |
| Profile Prior on FineSpan | **Unreachable on V4 ranking** | boost 0 / unused |
| Hotword `domains[0]` | **Forbidden / not used** | full `domains[]` copy |
| `allNonOverlapSubsets` | **Production (per-slot only)** | not formal boundary |
| `repairTarget` field | **Production lexicon/candidate flag** | not Detector revival |
| Session Prior via AudioChunk | **Dead in production streaming** | finalize `None` |

**Dead Feature Verdict: PARTIAL** — 旧滑窗生产不可达；Session Prior 生产路径自身“死”；legacy API 分支未删干净。

---

# 13. Shadow Logic Audit

| Area | Shadow / Dual / Hidden Gate? | Result |
|---|---|---|
| Boundary | Second formal owner? | **PASS** — LTR only |
| Prior | Web + Node Session dual SSOT? | **PASS** ownership; **FAIL** transport |
| Prior | profile/weak as second soft prior? | **PASS** on V4 |
| Vote | Coarse pool in prod? | **PASS** |
| Assembly | Overlap repairs formal boundary? | **PASS** |
| Recall | prior→enabledDomains gate? | **PASS** |
| LLM | shouldSwitch as topicShift? | **PASS** parser; **FAIL** out-bound always false |
| Compatibility Logic revival of global windows | Flag? | **PASS** — none |

**Hidden Gate / Dual Path (formal FineSpan):** PASS  
**Session closed-loop shadow gap:** FAIL（设计闭环存在，生产路径旁路为空 prior）

---

# 14. Counterfactual Result

方法：以**代码可达性 + 现有单测**裁决；标注未跑集成处。  
（本轮禁止改代码；dialog_200 / 全链路集成未在本审计中重跑。）

| ID | Scenario | Verdict | Reason |
|---|---|---|---|
| CF-01 | No Prior | **PARTIAL** | 代码：`domainPriors=[]` → LTR/quota no-op；**生产恒为此态**，无法对照“有 prior 退化” |
| CF-02 | Bad Prior | **FAIL** | 生产无法注入 prior；单测级 LTR prior tie-break 存在，但无 E2E |
| CF-03 | Unknown Domain | **PASS** | Scheduler `validate_domain_priors` + Node `sanitizeDomainPriors` drop |
| CF-04 | Top3 Overflow | **PASS** | sanitize/merge cap 3；contract tests |
| CF-05 | Empty Turn | **PASS** | merger `no_op_empty_turn`；Web tests |
| CF-06 | Retry | **PARTIAL** | Job 固化 priors 设计在；生产 priors 恒空 → 一致性平凡成立 |
| CF-07 | Reconnect | **PARTIAL** | Web Map by sessionId；无跨进程持久化证明 |
| CF-08 | No LLM | **PASS** | FineSpan 不依赖 LLM；缺失校准不阻断 |
| CF-09 | Wrong LLM | **FAIL** | Condition B 数据链断，无法验证“错误校准被拒绝后行为”的端到端 |
| CF-10 | Old Session | **PASS** | sessionId 隔离设计 |
| CF-11 | New Session | **PASS** | reset API / 新 key |
| CF-12 | TopicShift False | **PASS** | default false；不静默 = shouldSwitch |
| CF-13 | TopicShift True | **FAIL** | 出站恒 false；B 永不触发 |
| CF-14 | LLM Delay | **PASS** | async; same-turn calibration optional |
| CF-15 | LLM Missing | **PASS** | no block |
| CF-16 | Invalid Weight | **PASS** | validate/sanitize drop |
| CF-17 | Duplicate Domain | **PASS** | dedupe in validate/sanitize |

**Counterfactual Complete: FAIL**（多项关键场景无法在生产闭环上证实）。

---

# 15. Regression Result

| Item | Status | Evidence |
|---|---|---|
| Unit: LTR / contract / quota / presence-vote | PASS (prior session) | Jest suites |
| dialog_200 post-LTR | **NOT RUN** | 无本轮 LTR 后 `tmp/dialog200*` 产物；Development Report 亦标 PENDING |
| FineSpan/Vote/Recall/Sentence/KenLM vs pre-dev | **FAIL / unknown** | 无对比数据 |

**Regression Complete: FAIL**

---

# 16. Architecture Import Graph（生产）

```text
fw-detector-orchestrator
  └─ fw-detector-v4-path
       ├─ span-assembly-v4-orchestrator
       │    ├─ ltr-fine-span-generator          ✅
       │    ├─ blocked-window-filter            ✅ (option filter)
       │    ├─ recall-topk-for-windows          ✅
       │    ├─ assemble-domain-aware-span-sets  ✅ (+ apply-domain-prior-quota)
       │    ├─ build-fw-spans-from-coarse-assembly-v4::buildFwSpansFromFormalFineSpans ✅
       │    └─ build-sentence-candidates        ✅
       └─ kenlm/run-fw-sentence-rerank-from-prefilled ✅

NOT imported by production orchestrator:
  generate-global-windows
  truncateWindows (as formal producer)
  legacy detector archive
```

**Verdict: PASS** for FineSpan import singularity；**FAIL** overall freeze due to session/LLM gaps above.

---

# 17. Ownership Matrix

| Decision | Required Owner | Actual | Duplicate? |
|---|---|---|---|
| Coarse boundary | FW partition | `partitionCoarseSpans` | No |
| Formal FineSpan | LTR Generator | LTR commit | No |
| Current-turn domains | Presence Vote | `voteUtteranceDomainFromPool` | No |
| Session prior SSOT | Web merger | Web Map + merger | No（Node 无权威态） |
| Session prior **transport** | Request payload | **Broken on AudioChunk** | N/A — missing |
| Soft prior consumption | Node FineSpan/Assembly | LTR K3 + Assembly quota | No dual SSOT |
| Scheduler | Validate only | validate + passthrough | No |
| Sentence score | KenLM | KenLM | No |
| LLM | Calibration advisory | Async intent；**topicShift 未出站** | Partial failure |

**Duplicate Owner: None** for boundary/vote/session SSOT.  
**Missing transport owner fulfillment: FAIL**.

---

# 18. Architecture Compliance Matrix

| Criterion | Verdict | Evidence |
|---|---|---|
| Single Path (FineSpan) | **PASS** | LTR only in orchestrator |
| Single Ownership (formal boundary) | **PASS** | LTR commit |
| No Shadow Logic (boundary/vote) | **PASS** | — |
| No Hidden Gate (prior→scope) | **PASS** | priors ≠ enabledDomains |
| No Compatibility Logic (global window flag) | **PASS** | none |
| No Dead Feature (session prior prod path) | **FAIL** | AudioChunk `None` |
| No Dual Prior (decision) | **PASS** | weak/profile off FineSpan |
| No Dual Boundary | **PASS** | — |
| No Dual Vote | **PASS** | formal pool in prod |
| No Dual Session SSOT | **PASS** | Web only |
| No Scheduler Inference | **PASS** | — |
| No LLM Runtime Dependency (FineSpan) | **PASS** | async |
| Formal FineSpan Only | **PASS** | — |
| Session Prior Closed Loop | **FAIL** | AudioChunk disconnect |
| Contract Consistency (topicShift wire) | **FAIL** | intent/extra omit topicShift |
| Diagnostics Complete | **PARTIAL** | architectureCompliance flags present; topicShift/prior traces incomplete in prod |
| Regression Complete | **FAIL** | no post-LTR dialog_200 |
| Counterfactual Complete | **FAIL** | see §14 |
| Recall via applyDomainPriorQuota (all) | **FAIL** | Assembly only |
| Tone commit re-extract | **PARTIAL** | reuse winner tone |
| Cursor-only / Soft boundary ≤1 | **PASS** | LTR |

---

# 19. KEEP / MODIFY / RESTORE / DELETE

（本文件只读审计；下列为**合规视角建议归类**，非本轮改码。）

## KEEP
- LTR production entry
- Formal FineSpan ownership + soft boundary≤1
- Presence Vote + formal pool (when formalSpans passed)
- Scheduler schema validate + ExtraResult fields
- Web merger algorithm + sessionId store
- Context Prior diagnostics-only
- Cap 16 / KenLM duties

## MODIFY（冻结前必须，否则不得 PASS）
- Production streaming must carry `domainPriors` (AudioChunk finalize or switch to Utterance with priors)
- Persist `topicShift` into session intent / `llmCalibration` out-bound
- Either wire `applyDomainPriorQuota` to all required post-recall selection sites **or** amend frozen wording to “Assembly-only” before claiming PASS（当前用户验收条要求统一经 quota → 现码 FAIL）
- Tone: commit-time re-extract Formal range **or** freeze “reuse winner option tone” as accepted equivalent with tests

## RESTORE
- None of deleted Detector/Beam paths

## DELETE / Quarantine
- Coarse-only pool branch from production API surface（or hard-fail if formalSpans missing）
- Relying on `sendUtterance`-only prior attach while production uses AudioChunk

---

# 20. Final Verdict

```text
Architecture Freeze
FAIL
```

### Blocking FAIL reasons（任一即可否决；现同时成立）

1. **Session Prior Closed Loop FAIL** — 生产 AudioChunk finalize 固定 `domain_priors=None`（`actor_finalize.rs`），Web→Node soft prior 在真实会话路径不可达。  
2. **LLM `topicShift` Contract FAIL** — 解析存在，但 `buildLexiconSessionIntentFromDecision` / `LexiconSessionIntent` / 出站投影丢弃字段，Condition B 死。  
3. **Recall quota 验收条 FAIL** — 非全部 Recall 经 `applyDomainPriorQuota`。  
4. **Regression / Counterfactual Incomplete FAIL** — 无 LTR 后 dialog_200 对比；关键 CF 无法在闭环上证实。

### Non-blocking PASS islands

FineSpan LTR 单入口、正式边界所有权、Soft Boundary、生产 Vote formal pool、Scheduler 零推理、V4 上 profile/weak 不构成第二 prior。

---

# 21. Appendix — Evidence Index

| Topic | Primary files |
|---|---|
| LTR entry | `span-assembly-v4-orchestrator.ts`, `ltr-fine-span-generator.ts` |
| Global windows unreachable | `generate-global-windows.ts` + only `*.test.ts` imports |
| AudioChunk prior None | `actor_finalize.rs:214-216`, `session_manager.ts` AudioChunk |
| Utterance prior attach | `audio_sender.ts` `domainPriors` |
| topicShift drop | `lexicon-session-intent.ts`, `result-builder-core.ts`, `types.ts` LexiconSessionIntent |
| Quota site | `assemble-domain-aware-span-sets.ts` only |
| ExtraResult | `common.rs` CurrentTurnDomain / LlmDomainCalibration |
| Web merger | `domain-prior-merger.ts`, `conversation-domain-state.ts` |

---

**Document end.**  
唯一结论重复声明：

# Architecture Freeze — FAIL

