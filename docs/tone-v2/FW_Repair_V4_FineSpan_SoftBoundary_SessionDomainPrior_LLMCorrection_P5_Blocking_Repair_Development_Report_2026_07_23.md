> **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** (Step 6, 2026-07-30). SoftBoundary LTR Fine Span is deleted from runtime; see Runtime SSOT V1.2 + Lattice Architecture V1.0.0.
> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4
# FineSpan Soft Boundary + Session Domain Prior + LLM Correction
## P5 Blocking Repair Development Report

| Field | Value |
|---|---|
| Date | 2026-07-23 |
| Document Type | P5 Blocking Repair Development Report |
| Status | **P5 Blocking Repair: FAIL**（代码阻断项已修；Production E2E / dialog_200 未完成） |
| Authority | Architecture SSOT / Runtime Evolution Rule / Ownership Matrix / Development Plan / Supplement / Constraint Addendum / P5 Final Architecture Compliance Audit |
| Scope | Interface wiring · Data propagation · Session transport · Contract continuity · Tone commit binding · Production API hardening · Diagnostics · Tests |

---

# 1. Executive Summary

本轮严格限域修复 P5 审计确认的生产闭环 Block，**未**重设计 LTR FineSpan / Presence Vote / Bucket / Assembly / KenLM。

| Block | Result |
|---|---|
| BLOCK-1 AudioChunk `domainPriors` 生产闭环 | **代码闭环已接通** |
| BLOCK-2 `topicShift` 中间层丢字段 | **已修复** |
| BLOCK-3 Formal Tone commit 重绑定 | **已修复** |
| BLOCK-4 Formal Pool 静默 coarse fallback | **已硬失败化** |
| BLOCK-5 `applyDomainPriorQuota` 调用点 | **KEEP**（Vote 后 Assembly 一次） |

单元 / 契约 / 反事实测试已通过；**真实桌面双 Turn AudioChunk E2E** 与 **dialog_200 frozen replay** 本轮未执行，按验收硬规则不得 PASS。

```text
P5 Blocking Repair
FAIL
```

---

# 2. Root Cause

1. **BLOCK-1**：生产走 `AudioChunk → actor_finalize`，旧码固定 `domain_priors = None`；`sendUtterance` prior 附件不在生产路径。
2. **BLOCK-2**：parser 已有 `topicShift`，但 `LexiconSessionIntent` / `buildLexiconSessionIntentFromDecision` / session-result-extra 未复制 → Web Condition B 死。
3. **BLOCK-3**：Formal commit 复用 winner option tone，未按 Formal range 显式重绑定。
4. **BLOCK-4**：`buildFineSpanCandidatePool` 缺 Formal 时静默 coarse。
5. **BLOCK-5**：审计条“全部 Recall 经 quota”与冻结职责冲突；真实正确点是 Assembly 选候选一次。

---

# 3. Scope Control

**禁止项遵守**：未改 Formal FineSpan 决策、Vote、bucket retention、Assembly 核心、KenLM、Session Prior Owner、Scheduler 推理、双 Audio 链、`sendUtterance` 绕行、`domainPriors→enabledDomains`、`shouldSwitch≡topicShift`、global window/Beam 回潮。

**允许项**：wiring / transport / contract / tone rebind / API harden / diagnostics / tests。

---

# 4. Files Changed

| Area | Files |
|---|---|
| Scheduler protocol | `messages/session.rs`（AudioChunk `domainPriors`） |
| Scheduler actor | `session_actor/state.rs`, `events.rs`, `actor_event_handling.rs`, `actor_finalize.rs` |
| Scheduler handler | `session_message_handler/audio.rs`, `mod.rs` |
| Web transport | `audio_sender.ts`, `types.ts`, `conversation-domain-state.ts` |
| topicShift | `types.ts` (LexiconSessionIntent), `lexicon-session-intent.ts`, `session-result-extra.ts`, `prompt_templates.py` |
| Tone | `tone-commit-rebind.ts`, `ltr-fine-span-generator.ts`, `span-assembly-v4-orchestrator.ts` |
| Formal pool | `assemble-domain-aware-span-sets.ts`, `v4-types.ts` |
| Tests | `p5-blocking-repair.test.ts`, `p5-prior-vote-isolation.test.ts`, `p5-audio-chunk-prior-snapshot.test.ts`, 相关 assembly/vote 测试更新 |

---

# 5. AudioChunk Production Runtime Graph

```text
Web ConversationDomainState.domainPriors
  → AudioSender.domainPriorsSnapshotAtUtteranceStart (freeze on first chunk)
  → JSON AudioChunk.domainPriors (+ binary: JSON carrier first)
  → Scheduler handle_audio_chunk → validate_domain_priors (schema-only)
  → SessionEvent.AudioChunkReceived.domain_priors
  → SessionActor.freeze_domain_priors_snapshot (first-write-only)
  → actor_finalize → Job.domain_priors (from snapshot; retry = Job frozen)
  → JobAssign.domainPriors
  → Node ctx.domainPriors → sanitize → LTR K3 / Assembly quota
```

| Hop | File | Function | In | Out | Mutate? | Owner |
|---|---|---|---|---|---|---|
| Snapshot create | `audio_sender.ts` | `attachFrozenDomainPriors` | session priors | message fields | freeze once | Web |
| Message contract | `session.rs` | `AudioChunk` | JSON | Rust struct | no | Protocol |
| Validate | `audio.rs` | `handle_audio_chunk` | raw priors | cleaned | schema clean | Scheduler |
| Actor freeze | `state.rs` | `freeze_domain_priors_snapshot` | cleaned | actor field | first only | Scheduler |
| Finalize | `actor_finalize.rs` | `do_finalize` | actor snapshot | Job.domain_priors | no merge | Scheduler |
| Dispatch | `mod.rs` / job creator | Job→JobAssign | Job | assign | clone | Scheduler |
| Node bind | `fw-job-overrides.ts` | bind | JobAssign | ctx | sanitize | Node |

---

# 6. domainPriors Contract Continuity Table

| Hop | Source→Dest | Serde name | Optional/default | Clean | Prod reachable | Retry |
|---|---|---|---|---|---|---|
| Web store | ConversationDomainState | domainPriors | [] legal | merger | yes | n/a |
| AudioChunk | Web→Scheduler | domainPriors | omit if empty | schema | **yes (new)** | n/a |
| Actor | event→state | — | freeze [] | already cleaned | yes | n/a |
| Job | finalize | domain_priors | None if empty | none | yes | Job byte-stable |
| JobAssign | Job→Node | domainPriors | omit empty | Node sanitize | yes | same Job |
| LTR/Assembly | ctx | — | [] no-op | Registry filter | yes | same |

---

# 7. topicShift Contract Continuity Table

| Hop | Behavior |
|---|---|
| LLM JSON | prompt 要求 `topicShift` boolean |
| Parser | `obj.topicShift === true` only |
| LexiconProfileDecision | `topicShift?: boolean` |
| LexiconSessionIntent | **新增** `topicShift: boolean` |
| buildLexiconSessionIntentFromDecision | **复制** `decision.topicShift === true` |
| clone / migration | normalize `=== true` |
| session-result-extra | 投影 `topicShift` |
| result-builder llmCalibration | `intent.topicShift === true` |
| Scheduler ExtraResult | 已有 `topic_shift` |
| Web sanitizeLlmCalibration | 要求 boolean |
| Condition B | `llmCalibration.topicShift === true` |

`shouldSwitch` 不冒充 `topicShift`（缺失→false）。

---

# 8. Tone Commit Binding

`rebindToneAfterFormalCommit`（orchestrator 在 LTR 后对每个 FormalFineSpan）：

```text
Formal.rawStart/rawEnd → extractAcousticTonePatternForRecall（切片/缓存）
→ candidate range 对齐 Formal → toneCommitTrace.recomputedAfterCommit=true
```

无 option×模型二次推理；loser option tone 不进入 Formal candidates。

---

# 9. Formal Pool API Hardening

- `buildFineSpanCandidatePool(..., formalSpans)`：**必填**；空数组 → throw `[FORMAL_POOL]`
- coarse 路径移至 `buildFineSpanCandidatePoolFromCoarseSpansForTests`（test-only）
- `architectureCompliance.votePoolSource = "formal_fine_span"`

---

# 10. Prior Quota Decision Location

**KEEP** — 调用链证据：

```text
LTR temporary recall → commit → Formal pool
→ Presence Vote (pre-prior valid candidates)
→ filterDomainCandidatesPerSpan
→ selectPerSpanCandidates → applyDomainPriorQuota exactly once
→ Sentence Assembly
```

未接入 LTR SQL Recall。`applyDomainPriorQuota` 仅出现在 `assemble-domain-aware-span-sets.ts`。

---

# 11. Diagnostics / Trace

| Field | Value |
|---|---|
| generatorMode | `ltr_soft_boundary` |
| votePoolSource | `formal_fine_span` |
| sessionPriorTransport | `audio_chunk_session_snapshot` |
| topicShiftContractComplete | `true` |
| schedulerDomainInference | `false` |
| toneRecomputedAfterCommit | from rebind traces |
| fineSpanPriorSource | `domainPriors` \| `none` |
| contextPriorDecisionApplied | `false` |

Diagnostics 不参与决策。

---

# 12. Unit Tests

| Suite | Result |
|---|---|
| `lexicon-session-intent.test.ts` | PASS |
| `p5-blocking-repair.test.ts` | PASS |
| `p5-prior-vote-isolation.test.ts` | PASS |
| `assemble-domain-aware-span-sets.test.ts` | PASS |
| `domain-presence-vote-acceptance.test.ts` | PASS |
| `apply-domain-prior-quota.test.ts` | PASS |
| Scheduler `state::tests::freezes_domain_priors_once...` | PASS |
| Web `p5-audio-chunk-prior-snapshot.test.ts` | PASS |
| Web `domain-prior-merger.test.ts`（含 Condition B） | PASS |

---

# 13. Golden Contract Tests

- topicShift true/false/missing → intent/clone
- Formal pool missing → hard fail
- Tone rebind range = Formal range
- Prior snapshot freeze vs later Web state
- Actor freeze-once + pending promote on finalize

---

# 14. Production E2E

**未完成。** 本轮未启动真实桌面 `session_manager → AudioChunk → Scheduler → Node` 双 Turn 活体链路。

代码静态证据支持闭环可达；**按用户硬规则，不得用 helper/单测替代 Production E2E 证明。**

---

# 15. Counterfactual Tests

| Case | Result |
|---|---|
| Prior 变、Vote counts / retainedDomains 不变 | PASS (`p5-prior-vote-isolation`) |
| Condition B / shouldSwitch 不冒充 | PASS（merger + intent） |
| Formal pool 无 coarse fallback | PASS |

---

# 16. dialog_200 Regression

**未执行。** 无 LTR 后 vs 修复后 Formal FineSpan / Vote / KenLM / latency 对比表。

---

# 17. Static Reachability Audit

| Check | Result |
|---|---|
| AudioChunk 为 prior 生产 transport | **YES**（`audio_sender` + finalize snapshot） |
| `actor_finalize` 硬编码 `None` | **REMOVED**（读 snapshot） |
| coarse pool 静默 fallback in production API | **REMOVED** |
| topicShift 中间层丢失 | **FIXED** |
| domainPriors → enabledDomains | **NO** |
| quota 在 Vote 前 | **NO**（Vote 后） |
| generateGlobalWindows 生产 import | **NO**（仅 test） |
| 双路径 / shadow | **NO** |

---

# 18. Architecture Compliance Matrix（本轮自检）

| Criterion | Verdict |
|---|---|
| Session Prior Closed Loop (code) | PASS（代码） / E2E pending |
| topicShift Contract | PASS |
| Tone commit rebind | PASS |
| Formal pool no coarse fallback | PASS |
| Vote prior-independent | PASS |
| Quota once after Vote | PASS |
| Scheduler inference-free | PASS |
| Production E2E | **FAIL（未跑）** |
| dialog_200 regression | **FAIL（未跑）** |

---

# 19. KEEP

LTR 唯一入口；cursor-only；boundaryCross≤1；Presence Vote；Formal pool；Web Session Prior Owner；Scheduler schema-only；Context Prior diagnostics-only；Assembly cap 16；KenLM；LLM async；quota @ Assembly。

---

# 20. MODIFY

AudioChunk prior snapshot + finalize；LexiconSessionIntent.topicShift 全链；Tone rebind；Formal pool hard fail；diagnostics；契约测试。

---

# 21. RESTORE

无新增恢复；仅恢复冻结设计要求的生产闭环可达性。

---

# 22. DELETE / QUARANTINE

- `actor_finalize domain_priors=None` 固定旁路
- production coarse pool 静默 fallback（迁 test-only helper）
- topicShift 中间丢字段

---

# 23. Remaining Blockers

1. **Production E2E（双 Turn AudioChunk）**：Turn1 Vote→Web prior→Turn2 first AudioChunk→Node `ctx.domainPriors` 非空。
2. **dialog_200 frozen replay** 全量对比（含 No Prior / Prior / topicShift 分层）。
3. （可选增强）Session Prior / llmCalibration / toneCommit 出站 trace 字段完整落盘到 JobResult.extra。

---

# 24. Final Verdict

```text
P5 Blocking Repair
FAIL
```

**原因（硬规则）**：Production E2E 与 dialog_200 回归未完成；任一缺失即 FAIL。

**代码层 BLOCK-1..5**：已按冻结职责修复并通过相关单测/契约/反事实测试。

### 是否具备重新执行 Final Architecture Compliance Audit 的条件？

**部分具备**：代码阻断项已消除，可对 BLOCK-1..4 与 quota KEEP 做代码合规复审。

**完整冻结复审条件尚未齐备**：必须先完成真实 Production E2E 与 dialog_200 回归后，再执行 Final Architecture Compliance Audit，否则 Audit 仍会因 E2E/Regression Incomplete 判 FAIL。

---

## Per-change evidence (required)

### BLOCK-1 AudioChunk prior
- **Purpose**: 生产路径携带 utterance-start prior 快照  
- **Responsibility**: Web freeze；Scheduler validate+passthrough；Node soft consume  
- **Input/Output**: ConversationDomainState → AudioChunk → Job → ctx.domainPriors  
- **Owner**: Web (SSOT)；Scheduler transport；Node non-authoritative  
- **Final Decision Location**: Web merger（生成 prior）；Node 仅 soft  
- **Frozen Architecture Relation**: Session Prior Closed Loop  
- **Production Reachability**: 代码可达；活体 E2E pending  
- **Regression Evidence**: Rust freeze test + Web snapshot test PASS  

### BLOCK-2 topicShift
- **Purpose**: Condition B 可达  
- **Responsibility**: LLM→intent→extra→Web（透传）  
- **Owner**: LLM emit；Web Condition B apply  
- **Production Reachability**: 字段链完整  
- **Regression Evidence**: intent + merger tests PASS  

### BLOCK-3 Tone rebind
- **Purpose**: Formal range = final tone range  
- **Owner**: Node FineSpan after commit  
- **Regression Evidence**: `p5-blocking-repair` tone test PASS  

### BLOCK-4 Formal pool
- **Purpose**: 禁止 coarse 静默 fallback  
- **Owner**: Assembly pool API  
- **Regression Evidence**: hard-fail test PASS  

### BLOCK-5 Quota
- **Purpose**: 确认不在 Vote 前 / 不在 SQL Recall  
- **Decision**: KEEP Assembly `selectPerSpanCandidates`  
- **Evidence**: 单点 grep + isolation counterfactual PASS  

