# FW Repair V4 — P5 AudioChunk DomainPrior Ordering Repair Development Report

**Date:** 2026-07-23  
**Task:** `P5 AudioChunk DomainPrior Ordering Repair`  
**Scheme:** G only (no parallel designs)

---

## 1. Executive Summary

P0-1（异步乱序首包冻结空 prior）已按冻结方案 G 修复：Web 在 `sendAudioChunkInternal` 入口、任何 await/encode 前创建不可变 utterance snapshot，同一 utterance 每个 JSON AudioChunk 显式携带同一 snapshot（含 `[]`）；Scheduler 保留 Option presence，仅对显式 `domainPriors` 做 first-write freeze。相关 Web Vitest（11）与 Scheduler 契约测试（20）通过。

**Final Verdict：PASS**

---

## 2. Root Cause

```text
AudioChunk 异步发送乱序
+ domainPriors 仅首包附着（attach-once）
+ 空 snapshot 被 omit
+ Scheduler 将 missing 合并为 empty（None → Some([])）
+ Actor 首事件 unwrap_or_default 后无条件 freeze
= 错误冻结空 prior，合法 prior 永久丢失
```

---

## 3. Frozen Ordering Contract

| Rule | Implementation |
|------|----------------|
| Snapshot create point | `sendAudioChunkInternal` / `sendFinal` entry, before await |
| Immutability | `copyDomainPriorsSnapshot` value copy |
| Per-chunk attach | `attachDomainPriorsSnapshotToMessage` always sets `domainContextVersion` + `domainPriors` |
| Invocation capture | `const snapshotForThisChunk = ensure...()` then attach after await |
| Missing vs empty | Scheduler `sanitize_domain_priors_preserving_presence` |
| Freeze | Actor `if let Some(cleaned)` only |

---

## 4. Scope Control

**In scope:** `audio_sender.ts`, Scheduler audio handler, actor event handling, actor state helpers/tests, domain_prior_validate presence helper, ordering/contract tests, this report.

**Out of scope (unchanged):** ConversationDomainState merger, Domain Vote, LTR, FineSpan, Tone, Formal Pool, Assembly, KenLM, topicShift, LLM, JobAssign contract, Node sanitize, reconnect, audio payload reorder locks/queues, binary production enablement, dialog_200, Architecture Freeze.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `webapp/web-client/src/websocket/audio_sender.ts` | Scheme G snapshot + per-chunk attach; delete attach-once |
| `central_server/scheduler/src/websocket/session_message_handler/audio.rs` | Preserve Option presence |
| `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` | Freeze only on `Some` |
| `central_server/scheduler/src/websocket/session_actor/state.rs` | Test helpers + contract tests |
| `central_server/scheduler/src/messages/domain_prior_validate.rs` | `sanitize_domain_priors_preserving_presence` |
| `webapp/web-client/tests/domain/p5-audio-chunk-prior-ordering.test.ts` | New Web ordering/async tests |
| This report | Documentation |

---

## 6. Web Snapshot Lifecycle

**Purpose:** Freeze ConversationDomainState once per utterance at AudioSender entry.  
**Responsibility:** Web AudioSender owns utterance snapshot; ConversationDomainState remains Session SSOT.  
**Input:** `getDomainPriorsForSession(sessionId)` only when snapshot is null.  
**Output:** Immutable `DomainPrior[]` stored in `domainPriorsSnapshotAtUtteranceStart`.  
**Owner:** Web.  
**Mutation:** Create once; reset on final / session change; never mutate in place.  
**Production Reachability:** Desktop JSON AudioChunk path (`useBinaryFrame=false`).  
**SSOT Relation:** Read-only projection of ConversationDomainState; not a second store.  
**Test Evidence:** PCM mid-utterance store change; value-copy mutation test; next-utterance re-read.

---

## 7. Per-Chunk Attachment Implementation

**Purpose:** Every JSON AudioChunk carries the same frozen snapshot including `[]`.  
**Responsibility:** `attachDomainPriorsSnapshotToMessage(message, snapshotForThisChunk)`.  
**Input:** Captured snapshot for this invocation.  
**Output:** Wire fields `domainContextVersion: "v1"`, `domainPriors: [...]`.  
**Owner:** Web AudioSender.  
**Mutation:** Message-local copy only.  
**Production Reachability:** JSON PCM/Opus/final/queue-flush via shared helper.  
**SSOT Relation:** Transport only.  
**Test Evidence:** explicit empty wire contains `"domainPriors":[]`; Opus/PCM/final/flush tests.

**Deleted:** `domainPriorsSnapshotAttached`, `attachFrozenDomainPriors` (attach-once + empty omit).

---

## 8. Missing vs Explicit Empty Contract

| Wire | Handler | Actor |
|------|---------|-------|
| field missing (`None`) | event `None` | no freeze (UNSET) |
| `"domainPriors": []` | `Some([])` | freeze FROZEN_EMPTY |
| `"domainPriors": [A]` | `Some([A])` | freeze FROZEN_NON_EMPTY |
| all-invalid explicit | `Some([])` after clean | freeze FROZEN_EMPTY |

---

## 9. Scheduler Freeze State

```text
frozen=false                         → UNSET
frozen=true + empty snapshot         → FROZEN_EMPTY
frozen=true + non-empty snapshot     → FROZEN_NON_EMPTY
```

Helpers: `domain_priors_snapshot_state()`, `job_domain_priors_from_snapshot()`, `apply_audio_chunk_domain_priors_event()`.

---

## 10. Pending-next Behavior

Same rules under `for_next_utterance=true`: missing does not freeze pending; first explicit `[]` / non-empty first-wins; promoted on `complete_finalize`.

---

## 11. Finalize Behavior

- UNSET until finalize → `Job.domain_priors = None` (legal no-op).
- FROZEN_EMPTY → Job `None` via empty filter; actor state still proves frozen empty ≠ UNSET.
- FROZEN_NON_EMPTY → Job `Some([...])`.
- No wait-for-carrier, no Web re-read, no session prior cache.

---

## 12. Async Ordering Tests

Web Vitest (`p5-audio-chunk-prior-ordering.test.ts`):

- Opus deferred Promise: chunk2 sends first, both carry same snapshot A.
- Store changes A→B while encodes pending → still A.
- `sendFinal` resets global utterance snapshot while encode pending → late chunk still A.

**Result:** 11/11 passed.

---

## 13. Scheduler Contract Tests

`session_actor::state::tests` + `domain_prior_validate::tests`:

missing / explicit empty / non-empty / missing→valid / empty→valid / invalid→empty→valid / pending-next / finalize without carrier / retry / production-like reorder.

**Result:** 20/20 passed (filtered lib tests).

---

## 14. Production-like Integration Test

| Layer | Coverage |
|-------|----------|
| Web AudioSender → wire JSON | Vitest production-like concurrent reorder |
| sanitize presence → Actor freeze → Job projection | Rust `production_like_concurrent_reorder_same_snapshot_to_job` |
| JobAssign → Node ctx | **Node Production E2E pending** |

Not claimed as full live desktop E2E.

---

## 15. Counterfactual Matrix

| Case | Expected | Evidence |
|------|----------|----------|
| no prior | Job None / UNSET | Rust finalize_without_carrier |
| explicit empty | frozen empty, Job None | Rust + Web wire `[]` |
| non-empty | Job Some | Rust non_empty_freezes |
| missing first, valid later | valid freezes | Rust missing_then_valid |
| empty first, valid later | empty remains | Rust empty_then_valid |
| concurrent encode reorder | same snapshot | Web Opus deferred |
| Web state mid-utterance | unchanged | Web PCM/Opus |
| next utterance | new state | Web next utterance |
| final resets during in-flight | old capture | Web final overtake |
| duplicate explicit | first-wins | existing freeze_once |
| invalid explicit | cleaned empty freeze | Rust invalid_explicit |
| retry | same Job prior | Rust retry test |

---

## 16. Static Search Evidence

| Symbol | Finding |
|--------|---------|
| `domainPriorsSnapshotAttached` | **Absent** (deleted) |
| `attachFrozenDomainPriors` | **Absent** (deleted) |
| `getDomainPriorsForSession` | Only at utterance snapshot ensure (+ `sendUtterance` alternative API KEEP) |
| `domain_priors.unwrap_or_default` | **Absent** on AudioChunk freeze path |
| `Some(cleaned)` | Only when field was Some (validate/freeze of explicit) |
| `freeze_domain_priors_snapshot` | Called only inside `if let Some` |

Checks 1–10 from task §12: pass (no attach-once, no empty omit, no missing→empty freeze, no second SSOT, shared PCM/Opus prior helper, no env branch, no feature flag, no sendUtterance fallback, no Scheduler prior cache, no Node session prior state added).

---

## 17. SSOT Compliance

```text
ConversationDomainState
→ AudioSender utterance snapshot
→ AudioChunk.domainPriors
→ Scheduler SessionActor freeze
→ Job.domain_priors
→ JobAssign.domainPriors
→ Node ctx.domainPriors (soft consumer)
```

No Scheduler/Node Session Prior Store; no local/compatibility/shadow prior.

---

## 18. Shadow / Dual-path Audit

| Forbidden | Status |
|-----------|--------|
| old+new attach | DELETED attach-once |
| PCM/Opus separate prior logic | Shared helpers |
| feature flag / env branch | None |
| metadata carrier dual state | Not introduced |
| binary as new main chain | Quarantined (`binaryJsonPriorCarrierSent`) |
| send lock / reorder queue as fix | Not introduced |

---

## 19. KEEP

ConversationDomainState SSOT; JSON AudioChunk main transport; Web snapshot ownership; Scheduler schema-only; Job frozen snapshot; Node soft consumer; retry; LTR/Vote/Assembly/KenLM/topicShift/Tone/Formal Pool; sendUtterance non-default; reconnect deferred.

---

## 20. MODIFY

| Item | Purpose | Responsibility | Input | Output | Owner | Mutation | Reachability | SSOT | Tests |
|------|---------|----------------|-------|--------|-------|----------|--------------|------|-------|
| audio_sender snapshot | Fix ordering | Freeze@entry | store priors | immutable snap | Web | once/utt | prod JSON | read SSOT | Vitest |
| per-chunk attach | Fix omit/once | Wire attach | snap | JSON fields | Web | msg copy | prod JSON | transport | Vitest |
| audio.rs presence | Fix missing≡empty | Option preserve | wire Option | event Option | Scheduler | none | prod handler | transport | Rust |
| actor freeze gate | Fix unconditional freeze | Conditional freeze | Option | state | Scheduler | first Some | prod actor | freeze | Rust |
| validate presence helper | Schema+presence | Sanitize | Option | Option | Scheduler | clean only | prod edge | schema | Rust |

---

## 21. DELETE

- `domainPriorsSnapshotAttached` / attach-once production behavior  
- empty snapshot omit on JSON AudioChunk  
- `None → Some([])` handler collapse  
- `unwrap_or_default` unconditional freeze  

---

## 22. QUARANTINE

Binary prior JSON carrier remains production-unreachable (`use_binary_frame` nego false). Uses same snapshot attach helper; not part of new production contract expansion.

---

## 23. Remaining P1

- Opus encode completion reorder of **audio payload** (independent of prior snapshot consistency)  
- reconnect product semantics  
- Ordering Contract Verification Audit → Production AudioChunk dual-turn E2E  

---

## 24. Production E2E Readiness

| Gate | Status |
|------|--------|
| Unit / async / contract tests | PASS |
| Production-like Web wire + Scheduler Job projection | PASS |
| Live desktop dual-turn AudioChunk E2E | **pending** |
| Node live JobAssign/ctx | **Node Production E2E pending** |
| dialog_200 | not in this round |

Next allowed step only: **Ordering Contract Verification Audit → Production AudioChunk 双 Turn E2E**.

---

## 25. Final Verdict

```text
P5 AudioChunk Ordering Repair
PASS
```

All PASS conditions from the task brief are met: freeze before await; immutable copy; every JSON chunk explicit snapshot including `[]`; concurrent reorder same snapshot; final reset does not alter in-flight capture; Scheduler Option presence; missing does not freeze; explicit empty/non-empty freeze; pending-next same rules; finalize without carrier → Job None; no attach-once / missing→empty / new SSOT / shadow / dual-path / feature flag / compatibility fallback / send lock; tests passed.
