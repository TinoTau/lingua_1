# FW Repair V4 — P5 AudioChunk Ordering Contract Verification Audit

**Date:** 2026-07-23  
**Nature:** Read-only acceptance audit（只读验收）  
**Authority:** Real production code only  
**Compared document (non-authority):** `FW_Repair_V4_P5_AudioChunk_DomainPrior_Ordering_Repair_Development_Report_2026_07_23.md`

---

## 1. Executive Summary

从真实代码重新推导 Ordering Contract 后，与开发报告关键 Claim 比对：**行为层一致**。Scheme G 已落地于生产 JSON AudioChunk 主链；attach-once / empty-omit / missing→empty→freeze 生产逻辑已不存在；snapshot 在 await 前 capture；Scheduler Option presence + Actor conditional freeze 成立。

**记录的非阻断偏差（文档/注释/测试辅助，非第二主链）：**

1. `session.rs` AudioChunk 字段注释仍写「仅首包可携带」——与当前 Web 每包显式携带行为不一致（注释陈旧）。
2. `job_domain_priors_from_snapshot` 未被 `actor_finalize` 调用；finalize 使用等价 inline `.filter(|p| !p.is_empty())`。
3. `apply_audio_chunk_domain_priors_event` 仅测试/镜像调用；生产 Actor 直接 `if let Some` → `freeze_domain_priors_snapshot`。

以上不构成第二 SSOT / Shadow / Dual Path / Dual Freeze 生产链。

```text
Ordering Verification
PASS
```

---

## 2. Verification Scope

| In | Out |
|----|-----|
| Web `audio_sender.ts` JSON AudioChunk / sendFinal / queue flush path | Code/config/test/prompt edits |
| Scheduler audio handler → SessionEvent → Actor → Job → JobAssign | Production live E2E |
| ConversationDomainState ownership | dialog_200 |
| Binary reachability / sanitizer / freeze graph | Architecture Freeze |
| Claim vs code consistency | Trusting Development Report text alone |

---

## 3. Verified Production Call Graph

### PCM（生产 JSON，`useBinaryFrame=false`）

```text
session_manager / AudioSender.sendAudioChunk
  → (optional) BackpressureManager.enqueueAudio
  → getSendCallback / sendAudioChunkInternal
      → ensureUtteranceDomainPriorsSnapshot()   // BEFORE await
      → const snapshotForThisChunk = ...
      → PCM Int16 encode (sync)
      → attachDomainPriorsSnapshotToMessage(message, snapshotForThisChunk)
      → sendCallback(JSON.stringify(message))
  → Scheduler SessionMessage::AudioChunk (serde Option domain_priors)
  → audio::handle_audio_chunk
      → sanitize_domain_priors_preserving_presence
      → SessionEvent::AudioChunkReceived { domain_priors: Option }
  → SessionActor.handle_audio_chunk
      → if let Some(cleaned) { freeze_domain_priors_snapshot(..., for_next) }
  → try_finalize / actor_finalize
      → Job.domain_priors = snapshot.clone().filter(|p| !p.is_empty())
  → JobAssign.domainPriors (clone Job)
  → Node fw-job-overrides → ctx.domainPriors (sanitizeDomainPriors soft consumer)
```

### Opus（生产 JSON）

```text
sendAudioChunkInternal
  → ensure + capture snapshotForThisChunk   // BEFORE await
  → await encodePackets(...)
  → Plan A pack + base64
  → attachDomainPriorsSnapshotToMessage(message, snapshotForThisChunk)  // NOT re-read store / this.*
  → JSON.stringify → Scheduler → Actor → Job → JobAssign → Node
```

### Final

```text
sendFinal
  → ensureUtteranceDomainPriorsSnapshot()   // same helper
  → const snapshotForThisChunk = ...
  → JSON: attach + JSON.stringify(is_final=true) → same Scheduler chain
  → resetUtterancePriorSnapshot()
Binary FINAL (quarantine only): no domainPriors on binary frame; prior only if prior JSON carrier already sent
```

### Queue Flush

```text
BackpressureManager.flushSendQueue
  → sendCallback = AudioSender.getSendCallback
  → sendAudioChunkInternal   // same entry capture + attach contract
```

### Retry

```text
Job reload / re-dispatch
  → Job.domain_priors frozen at create time
  → JobAssign clones Job.domain_priors
  → does NOT re-read ConversationDomainState / Web
```

### Pending Next

```text
Actor finalize_inflight.is_some()
  → for_next_utterance = true
  → same if let Some → freeze_domain_priors_snapshot(cleaned, true)
  → pending_next_* first-write
  → complete_finalize promotes pending → current
```

---

## 4. SSOT Ownership Matrix

| Component | Role | Session Prior SSOT? |
|-----------|------|---------------------|
| ConversationDomainState | Unique Session Prior SSOT | **YES** |
| AudioSender utterance snapshot | Per-utterance transport freeze (value copy) | No（projection） |
| AudioChunk.domainPriors | Wire carrier | No |
| Scheduler validate / sanitize | Schema + presence preserve | No |
| SessionActor frozen snapshot | Utterance freeze for Job | No（transport freeze） |
| Job.domain_priors | Durable job copy | No |
| JobAssign.domainPriors | Assign wire | No |
| Node ctx.domainPriors | Soft consumer | No |

**Absent in production prior path:** Scheduler Session Store / Node Session Store / Compatibility / Legacy / Shadow / Cached Prior / Previous Prior Fallback / Alternative Snapshot Owner.

---

## 5. Snapshot Immutability Audit

| Check | Finding |
|-------|---------|
| `copyDomainPriorsSnapshot` | `priors.map(p => ({ domain, weight }))` — **new array + new item objects** |
| Shared with store? | No — `getDomainPriorsForSession` live array is copied |
| Shared with message? | Attach copies again into `message.domainPriors` |
| `domain` / `weight` | Primitives / string values — not shared mutable refs |
| After `mergeConversationDomainState` | Mutates store state only; cannot mutate already-copied snapshot items |
| `ensure` return value | Returns reference to `domainPriorsSnapshotAtUtteranceStart` array object |
| Production mutation of frozen array? | None found after ensure |
| After await attach source | Local `snapshotForThisChunk` only — not store, not re-ensure |

**Verdict:** Value-level immutable vs ConversationDomainState. Not structural freeze (`Object.freeze`); production path does not mutate the captured array.

---

## 6. Wire Attachment Matrix

| Path | `domainContextVersion` | `domainPriors` incl. `[]` | Serializer |
|------|------------------------|---------------------------|------------|
| JSON PCM chunk | set by attach | always set | `JSON.stringify(message)` |
| JSON Opus chunk | set by attach | always set | `JSON.stringify(message)` |
| JSON Final | set by attach | always set | `JSON.stringify(message)` |
| Queue flush | same Internal | always set | same |
| Binary audio frame | N/A on binary | N/A | ArrayBuffer |
| Binary quarantine JSON carrier | set by attach | always set (once/utt flag) | `JSON.stringify` |

Empty store: attach still sets `message.domainPriors = []` → wire contains `"domainPriors":[]`.

---

## 7. Presence Contract Trace

```text
Wire missing field
  → serde Option::None
  → sanitize_domain_priors_preserving_presence(None) → None
  → SessionEvent.domain_priors = None
  → Actor: skip freeze  → UNSET

Wire "domainPriors": []
  → Some([])
  → sanitize → Some([])
  → Actor: freeze_domain_priors_snapshot([]) → FROZEN_EMPTY

Wire "domainPriors": [A]
  → Some([A])
  → sanitize → Some(cleaned)
  → Actor: freeze → FROZEN_NON_EMPTY

Wire Some(all invalid)
  → sanitize → Some([])
  → freeze FROZEN_EMPTY
```

| Pattern | Location | Prior freeze impact |
|---------|----------|---------------------|
| `unwrap_or_default` on audio payload decode | `audio.rs` payload base64 | Unrelated to priors |
| `domain_priors.unwrap_or_default` | **Absent** on freeze path | — |
| Audio `None → Some([])` | **Absent** | — |
| Utterance empty→None for Job | `utterance.rs` | Alternative API only |

---

## 8. Freeze Reachability Graph

```text
Production:
  SessionActor.handle_audio_chunk
    → if let Some(cleaned) = domain_priors
         → freeze_domain_priors_snapshot(cleaned, for_next_utterance)

Test/mirror only:
  apply_audio_chunk_domain_priors_event
    → if let Some → freeze_domain_priors_snapshot
  (cfg(test) direct freeze_domain_priors_snapshot calls)
```

No production legacy / fallback / alternate freeze entry for AudioChunk.

---

## 9. Pending Contract Audit

| Rule | Current | Pending (`for_next_utterance=true`) |
|------|---------|--------------------------------------|
| Missing | no freeze | no freeze |
| Explicit empty | first-write freeze | first-write freeze |
| Non-empty | first-write freeze | first-write freeze |
| Second write | ignored | ignored |
| Promotion | N/A | `complete_finalize` copies pending→current |

Same function `freeze_domain_priors_snapshot`; no separate pending implementation.

---

## 10. Final Snapshot Ownership

```text
sendFinal
  → ensureUtteranceDomainPriorsSnapshot()   // SAME private helper as Internal
  → snapshotForThisChunk
  → attachDomainPriorsSnapshotToMessage(..., snapshotForThisChunk)
  → resetUtterancePriorSnapshot()
```

No second snapshot creation function for Final.

---

## 11. Snapshot Helper Matrix

| Helper | Role | PCM | Opus | Final | Binary quarantine |
|--------|------|-----|------|-------|-------------------|
| `ensureUtteranceDomainPriorsSnapshot` | Create/return utterance snapshot | Y | Y | Y | via Internal/Final entry |
| `copyDomainPriorsSnapshot` | Value copy | shared | shared | shared | shared |
| `attachDomainPriorsSnapshotToMessage` | Wire attach | Y | Y | Y | Y (carrier) |
| `ensureBinaryPriorSnapshotCarrier` | Quarantine carrier once | N | N | N | Y only |

No PCM/Opus/Final/compat duplicate prior helpers on production JSON path.  
`sendUtterance` still uses raw `getDomainPriorsForSession` + omit-empty — **alternative API**, not AudioChunk streaming.

---

## 12. Sanitizer Ownership Audit

```text
sanitize_domain_priors_preserving_presence
  = Option wrapper
  → validate_domain_priors(Some(raw))   // single rule implementation

validate_domain_priors
  = sole schema clean rules (max 3, weight, dedupe, trim)
```

Not a duplicated second rule set. Utterance path reuses `validate_domain_priors` then maps empty→None for Job — different transport, same schema rules.

---

## 13. Binary Reachability Audit

| Gate | Evidence |
|------|----------|
| Default `useBinaryFrame` | `false` in AudioSender |
| Production nego | `core.rs` SessionInitAck `use_binary_frame: Some(false)` hard-coded |
| Feature flag to enable priors binary | None for this contract |
| Auto-enable other path | Not found for production session init |

Binary prior carrier = **quarantine / production-unreachable** under current nego.

---

## 14. Shadow Compliance Matrix

| Forbidden | Status |
|-----------|--------|
| Dual attach (old once + new per-chunk) | Absent — `domainPriorsSnapshotAttached` / `attachFrozenDomainPriors` **gone** |
| Dual environment prior logic | Absent |
| Dual snapshot source on AudioChunk | Absent |
| Dual freeze production path | Absent |
| Dual sanitizer rules | Absent（wrapper only） |
| Feature flag gated prior path | Absent |
| send lock / reorder queue as prior fix | Absent |
| Fallback prior / previous prior | Absent on AudioChunk chain |

---

## 15. Claim Verification Matrix

| Development Report Claim | Verdict | Code evidence |
|--------------------------|---------|---------------|
| 删除 attach-once | **TRUE** | symbols absent repo-wide |
| 删除 empty omit（JSON AudioChunk） | **TRUE** | attach always sets `domainPriors` |
| 删除 unwrap_or_default 无条件 freeze | **TRUE** | Actor uses `if let Some` |
| 每包显式发送 | **TRUE** | Internal/Final attach before stringify |
| immutable snapshot | **TRUE** | value copy; store merge cannot alter capture |
| Option preserve | **TRUE** | `sanitize_domain_priors_preserving_presence` |
| Scheduler conditional freeze | **TRUE** | `actor_event_handling.rs` |
| pending same contract | **TRUE** | same freeze fn + flag |
| binary quarantine | **TRUE** | nego `false` + carrier flag |
| no send lock | **TRUE** | none added |
| no queue owner as prior fix | **TRUE** | flush uses same Internal |
| no feature flag for this fix | **TRUE** | none |
| freeze before await | **TRUE** | line order in Internal/Final |
| late attach uses capture not reset field | **TRUE** | `snapshotForThisChunk` |
| Job UNSET/empty → None | **TRUE** | finalize `.filter(!is_empty)` |
| job_domain_priors_from_snapshot is production finalize | **PARTIAL** | helper exists; finalize uses equivalent inline |
| protocol comments updated to per-chunk | **FALSE** | `session.rs` still says「仅首包可携带」 |

**Critical behavioral claims:** all **TRUE**. PARTIAL/FALSE items are helper-wiring / stale comment only.

---

## 16. Static Counterfactual Matrix

| Scenario | Code guarantee |
|----------|----------------|
| chunk2 encode completes before chunk1 | Both entered Internal with same utterance ensure; both attach `snapshotForThisChunk` from same frozen array |
| store A→B while encodes pending | No post-await `getDomainPriorsForSession` on AudioChunk path |
| sendFinal resets then late Opus callback | Late attach uses local capture; does not read `this.domainPriorsSnapshotAtUtteranceStart` after reset |
| missing then valid | Actor remains UNSET until Some; then freezes valid |
| empty then valid | First Some([]) freezes; later Some ignored |
| next utterance | reset nulls snapshot; next ensure re-reads store |

---

## 17. KEEP（from real code）

- ConversationDomainState as Session Prior SSOT  
- JSON AudioChunk desktop streaming main transport  
- Web utterance snapshot ownership via `ensureUtteranceDomainPriorsSnapshot`  
- Scheduler schema-only + Option presence preserve  
- Actor first-write freeze + pending promote  
- Job filter empty→None; retry from Job  
- Node soft consumer (`sanitizeDomainPriors` on assign)  
- `sendUtterance` as non-default alternative API  
- Binary frame code present but nego-forced off  

---

## 18. MODIFY（observed vs pre-repair； not authorizing new edits）

Already present in tree (this audit does not change them):

- `audio_sender.ts` Scheme G capture + per-chunk attach  
- `audio.rs` preserving presence  
- `actor_event_handling.rs` conditional freeze  
- `sanitize_domain_priors_preserving_presence`  
- state helpers / tests  

---

## 19. DELETE（verified absent）

- `domainPriorsSnapshotAttached`  
- `attachFrozenDomainPriors`  
- Production empty omit on JSON AudioChunk  
- Production `None → Some([])` collapse on AudioChunk edge  
- Production unconditional prior `unwrap_or_default` freeze  

**Still present but stale (comment only):** `session.rs`「仅首包可携带」— not production logic; recommend cleanup in a future doc/comment pass（本轮禁止修改）.

---

## 20. Final Verdict

```text
Ordering Verification
PASS
```

**PASS grounds (all required):**

- Development Report critical behavioral claims verified against real code  
- No new Session Prior SSOT  
- No Shadow / Dual Path / Dual Environment / Fallback / Compatibility prior  
- No second snapshot source on AudioChunk production path  
- No second sanitizer rule set  
- No second production freeze path  
- Single production snapshot ensure + attach helpers  
- No feature flag for this contract  
- No attach-once / empty-omit / missing→empty legacy reachability on JSON AudioChunk  

**Next allowed step only:**

```text
Production AudioChunk 双 Turn E2E
```

Not allowed next: dialog_200 / Architecture Freeze.
