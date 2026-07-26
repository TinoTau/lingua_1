# FW Repair V4
# Session Domain Prior AudioChunk Ordering Contract Audit
## P5 P0-1 Pre-Development Read-Only Audit

| Field | Value |
|---|---|
| Date | 2026-07-23 |
| Document Type | AudioChunk Ordering Contract Audit（**只读**） |
| Status | **Ordering Contract Audit: PASS** |
| Meaning of PASS | 唯一 Ordering Contract 已明确；最小开发边界已确定；可进入限域开发（**非**代码已修复） |
| Non-goals | 不改码；不做 E2E；不做 dialog_200；不宣布 Architecture Freeze |

---

# 1. Executive Summary

P0-1 根因在代码中可精确钉死：

```text
WebSocketClient.sendAudioChunk: void（丢弃 Promise）
+
AudioSender.sendAudioChunkInternal: Opus/Binary 在 attach 前 await encode
+
attachFrozenDomainPriors: 仅首包附着，且 empty 时 omit 字段
+
audio.rs: 始终 Some(cleaned)（missing≡[]）
+
Actor: 首事件 first-write freeze（含 []）永不覆盖
=
无 prior 的首达事件可永久冻空
```

三问裁决：

| 问题 | 唯一答案 |
|---|---|
| **A. snapshot 创建时点** | `sendAudioChunkInternal` **入口**、任一 await/encode **之前**（per-utterance 首次调用） |
| **B. Scheduler freeze authority** | **显式** `domainPriors` 字段存在（含 `[]`）；**missing 不冻结** |
| **C. 最小保序** | **同一 utterance 每个 AudioChunk 都携带同一冻结 snapshot**（含显式 `[]`）；**不新增**队列 Owner / 新消息类型 / 双链 |

---

# 2. Audit Scope

仅 P0-1 排序与 freeze 契约。不重审 LTR/Vote/Assembly/KenLM。Reconnect / sanitizer 仅作边界分类。

---

# 3. Frozen Baseline

| 原则 | 本轮 |
|---|---|
| Web = Prior Owner | KEEP |
| Scheduler = validate + transport | KEEP（可保留 presence，不做领域推理） |
| Node = soft consumer | KEEP |
| AudioChunk = 桌面流式主 transport | KEEP |
| 一句一不可变 snapshot | **RESTORE 契约**（现实现偏离） |
| retry = Job snapshot | KEEP |
| 中途 Web 更新不覆盖当前句 | KEEP（Web freeze） |

---

# 4. AudioChunk Async Call Graph

## 4.1 公共入口（Production）

```text
session_manager_audio_frame.ts:257
  ctx.sendAudioChunk(chunk, false)          // sync call, NO await of Promise
    → websocket_client.ts:211 sendAudioChunk(...): void
         this.audioSender.sendAudioChunk(...)  // Promise DISCARDED
           → audio_sender.ts:129 async sendAudioChunk: Promise<void>
                [backpressure?] enqueue OR await sendAudioChunkInternal
```

`session_manager.ts:219` 写 `await this.wsClient.sendAudioChunk(...)`，但 wrapper 返回 `void` → **await 无效**。

`connection_manager.ts:135-137`：`ws.send(data)` **同步入浏览器发送队列**（单次调用序）；**不**保证异步 encode 完成序。

---

## 4.2 PCM16 JSON path（生产当前主路径倾向）

```text
sendAudioChunkInternal
  useBinaryFrame=false
  codec ≠ opus
  ── SYNC ── int16 convert + base64          (no await)
  ── SYNC ── message = {type, seq++, is_final, payload}
  ── SYNC ── attachFrozenDomainPriors(message)   ★ attach / freeze Web snapshot（仅首次真正写入字段）
  ── SYNC ── sendCallback(JSON.stringify) → ws.send
  if isFinal: resetUtterancePriorSnapshot
```

| 点 | 位置 |
|---|---|
| await | **无**（直至函数返回） |
| send | `audio_sender.ts:309` |
| freeze (Web) | `attachFrozenDomainPriors` 内首次 `getDomainPriorsForSession` |
| freeze (Sch) | 首个 `AudioChunkReceived` |

**仍非契约有序**：多个 `sendAudioChunk` fire-and-forget 时，JS 可在 `await` 边界交错；PCM 路径虽无内部 await，但与 Opus/队列混用及 `flushSendQueue` 并发仍可能让 **final / 其他路径** 抢先。PCM「通常有序」≠ contract。

---

## 4.3 Opus JSON path（P0 主路径）

```text
sendAudioChunkInternal
  ── AWAIT ── encoder.encodePackets(audioData)   ★ 让出执行权
  ── SYNC ── pack Plan A + base64
  ── SYNC ── message = {..., seq++}             ★ seq 在 encode 之后分配 → 完成序≠输入序
  ── SYNC ── attachFrozenDomainPriors            ★ 可能已不是“时间上的第一调用”
  ── SYNC ── ws.send
```

**编码完成顺序可反转** → **先完成者先 attach/send** → 后完成者 `domainPriorsSnapshotAttached=true` → **omit prior** → Scheduler 若先收到 omit 包则 freeze `[]`。

---

## 4.4 Binary path（生产 nego 关闭；代码仍在）

```text
ensureBinaryPriorSnapshotCarrier()  // SYNC: 空 payload JSON + attach once → ws.send
── AWAIT ── encode (opus or encode())
── SYNC ── binary frame seq++ → ws.send
```

Scheduler：`use_binary_frame: Some(false)`；**无 binary 解码生产路径**。  
**本轮修复：QUARANTINE，不触碰 binary 为主修复面。**

---

## 4.5 Final chunk path

```text
wsClient.sendFinal(): void → audioSender.sendFinal() Promise discarded
JSON: attachFrozenDomainPriors → ws.send(is_final=true, payload='') → reset snapshot
```

可与在途 Opus encode **并发**：final 无 await encode → **可能先于前序 chunk 发出**（`sendFinal` vs 未完成的 `sendAudioChunkInternal`）。

---

## 4.6 Retry / resend

- Job 层 retry：复用 Redis `Job.domain_priors`（与 Web 发送序无关）— **KEEP**。  
- Web 无自动 resend 同 chunk；背压队列会再次 `sendAudioChunkInternal`。

---

## 4.7 Reconnect

`onClose` / `disconnect`：`resetConversationDomainState` + `setSessionId(null)` → Web snapshot reset。  
**Separate P1**（不阻塞 P0 ordering contract 定义）。

---

# 5. Promise Ownership Table

| 位置 | 返回类型 | Promise 命运 | 并发 |
|---|---|---|---|
| `WebSocketClient.sendAudioChunk` | **`void`** | 丢弃 AudioSender Promise | 允许多调用重叠 |
| `AudioSender.sendAudioChunk` | `Promise<void>` | 仅当被 await 才串行；生产未 await | 是 |
| `session_manager_audio_frame` | — | 不 await | 是 |
| `session_manager` silence path | `await wsClient.sendAudioChunk` | **无效 await** | 是 |
| `getSendCallback` / 背压 | `Promise` | `flushSendQueue` **while 循环无 await** → **并行点火** | **是** |
| per-utterance Promise chain | **不存在** | — | — |
| `ws.send` | sync enqueue | 单次调用序 | 不保证跨 async 任务 |

**已有串行？** 背压「每次 process 一个」≠ 全局串行；`flushSendQueue` 反而并发。**无可复用的 per-utterance send chain。**

---

# 6. Snapshot Creation Point Decision Matrix

| 候选时点 | 对应 start? | async reorder? | 可重复创建? | 句内不可变? | 新 Owner? | reconnect | retry | 协议变更? | 最小改动? |
|---|---|---|---|---|---|---|---|---|---|
| session_manager 新 utterance | 部分 | 否 | 需新状态 | 需接线 | 否 | 影响 | 无 | 否 | 否（跨模块） |
| 首个 PCM frame | 偏早 | 否 | 可能 | 是 | 否 | 影响 | 无 | 否 | 否 |
| **sendAudioChunkInternal 入口（encode 前）** | **是** | **创建不受 encode 乱序** | first-wins | **是** | **否** | setSessionId reset | 无 | **否** | **是** |
| encode 之后 | 否 | **是** | 竞态 | 弱 | 否 | — | — | 否 | 否（现状） |
| 首个 ws JSON send 前 | 近 | 仍取决于谁先到 send | 竞态 | 弱 | 否 | — | — | 否 | 否 |
| Scheduler 首包 | 否（太晚） | 是 | — | 依赖 wire | 否 | — | — | 否 | 否 |

### Authoritative Snapshot Creation Point

```text
webapp/web-client/src/websocket/audio_sender.ts
  sendAudioChunkInternal 入口（进入后、任何 await/encode 之前）
  首次：domainPriorsSnapshotAtUtteranceStart = getDomainPriorsForSession(sessionId)
  之后：只读该字段，禁止再读 ConversationDomainState
```

---

# 7. Freeze Authority Decision Matrix

| Authority | 问题 | 裁决 |
|---|---|---|
| 第一个 AudioChunkReceived（现状） | missing→`[]`→冻空；later valid 忽略 | **REJECT** |
| 第一个非空 prior | 合法 `[]` 无法显式冻结 | **REJECT** |
| **第一个显式 domainPriors 字段（含 []）** | 需保留 presence；旧客户端全程 missing→Job None | **ACCEPT** |
| sequence=0 | seq 在 encode 后分配；reconnect 重置；不可作 SSOT | **REJECT** |
| 独立 metadata 消息 | 新协议/双状态/非最小 | **REJECT** |

### Authoritative Scheduler Freeze Trigger

```text
仅当 SessionMessage::AudioChunk.domain_priors == Some(_)（字段显式存在，经 validate 后）
  → freeze_domain_priors_snapshot(cleaned)  // cleaned 可为 []
missing (None) → 不冻结，不清空已冻，不写入
已冻结 → 忽略后续（含重复显式）
```

配套：`audio.rs` **禁止**再把 `None` 强行变成 `Some([])` 送给 Actor。

---

# 8. Prior Presence Semantics Table

| Wire / 内部 | 含义 | Freeze? |
|---|---|---|
| 字段缺失 (`None`) | **本消息不是 snapshot carrier** | **否** |
| `domainPriors: []` / `Some([])` | **本 utterance 合法空 snapshot** | **是（显式空）** |
| `domainPriors: [valid…]` | 非空 snapshot | **是** |
| 全非法 → sanitize `[]` 但字段曾存在 | 显式空（清洗结果） | **是** |
| `null`（若经 serde） | 视实现；应等价 missing 或拒绝 | 推荐按 missing |

| 问题 | 结论 |
|---|---|
| sanitizer 是否丢失 presence？ | **现状是**：`validate(None)`→`[]` 且 `Some(cleaned)` 上送 → **丢失** |
| `Option→Vec` 是否过早合并？ | **是**（`audio.rs:64` + `unwrap_or_default`） |
| Actor 是否需要 presence？ | **是**（`Option<Vec>`：None=unset，Some=explicit） |
| Job 空是否仍可为 `None`？ | **是**（empty snapshot → Job `None` / omit；与 IFC-03 兼容） |
| 仅改内部 event？ | **是**：外部 Job 合同可不变；AudioChunk 已有 `domainPriors` 字段 |

```text
Missing ≠ Explicit Empty
```

**必须在 freeze 前成立。** 现状不成立 → 本轮 RESTORE。

---

# 9. Encoding Ordering Risk Matrix

| Path | attach 前 await? | 完成序可反转? | final 可抢先? | Contract 保证? |
|---|---|---|---|---|
| PCM16 JSON | 否 | 低（但仍有 fire-and-forget / flush 并发） | **是**（sendFinal 无 encode） | **否（仅通常有序）** |
| Opus JSON | **是** | **是** | **是** | **FAIL** |
| Binary | carrier sync；audio await | audio 相对 carrier 后；多 chunk 可反转 | FINAL 可抢先 | 生产关闭；**QUARANTINE** |

**Encoder**：无证据证明跨调用全局互斥；`encodePackets` 为 per-call await → **并行调用 ⇒ 完成序≠输入序**。

---

# 10. Scheduler Snapshot State Machine

**现状实现**：`bool frozen` + `Option<Vec>` → **无法区分 UNSET vs EXPLICIT_EMPTY**（因 missing 已变 `[]` 并 frozen）。

### 目标状态机（契约）

```text
UNSET ──(explicit Some, cleaned)──► EXPLICIT_EMPTY | NON_EMPTY
         (missing) ──► stay UNSET
EXPLICIT_* ──(any later)──► ignore
FINALIZING: current 只读已冻；新 chunk → PENDING_NEXT 同源规则
complete_finalize: promote PENDING → current 或 CLEARED→UNSET
```

| 检查 | 现状 |
|---|---|
| UNSET vs EMPTY | **混淆** |
| pending-next | 同缺陷复制 |
| finalize before carrier | freeze 已可能错误；Job 带错空 |
| 等待 snapshot？ | **不需要也不应**永久等；missing 直至 finalize → Job None（旧客户端/无 prior） |
| timeout 无 carrier | Job `domain_priors=None` | 合法 no-op |

---

# 11. Minimal Repair Option Matrix

评分：Correctness / Ordering / Arch / Complexity / Latency / Wire / Compat / Test / Shadow（高=好；Complexity 高=差）

| 方案 | C | O | A | Cx↓ | L | W | Compat | Test | Shadow | 裁决 |
|---|---|---|---|---|---|---|---|---|---|---|
| A attach-before-await only | 中 | **低**（仍可能无字段首达） | 高 | 高 | 高 | 高 | 高 | 中 | 高 | 不足单独 |
| B per-utt Promise chain | 高 | 高 | 中（新 queue Owner） | **低** | 中 | 高 | 高 | 中 | 中 | 非最小；禁止作主方案 |
| C 独立 sync carrier | 高 | 高 | **低**（双消息） | 低 | 高 | 中 | 中 | 中 | **低** | 禁止 |
| D explicit-field freeze only | 中 | 中 | 高 | 高 | 高 | 高 | 高 | 高 | 高 | **必要但不足**（无每包附着则靠运气） |
| E first non-empty only | **低** | — | 低 | — | — | — | — | — | — | **禁止**（违法空） |
| F every chunk same snapshot | **高** | **高** | 高 | 高 | 高 | 中（重复 Top3） | 高 | **高** | 高 | **核心** |
| **G = A(freeze@entry) + F + D** | **高** | **高** | **高** | **高** | 高 | 中 | 高 | **高** | 高 | **唯一推荐** |

**G 不需要**发送队列即可保证 prior 正确（首达无论哪包都带同一 snapshot）。  
音频 payload 乱序是既有问题，**不在本 P0 扩修**；G 不依赖 B。

---

# 12. Reconnect Contract Classification

| 场景 | 现码 | 分类 |
|---|---|---|
| WS close / disconnect | 清空 ConversationDomainState + AudioSender snapshot | **Separate P1**（产品：同会话是否保留 prior） |
| new sessionId | 空 store | Correct by design |
| Coupled to P0? | **否** | 不扩入 P0 开发 |

---

# 13. Transport Boundary Result

| 项 | 结论 |
|---|---|
| 桌面流式主链 | **仅 AudioChunk** |
| sendUtterance 自动 fallback | **无** |
| feature flag 切换主链 | **无** |
| 共享 snapshot helper | Utterance **另读** `getDomainPriorsForSession`（非 AudioSender snapshot） |
| 本轮是否改 Utterance | **否**（边界外；勿误改） |
| Shadow Path? | **Alternative API，非 Shadow** |

---

# 14. Static Counterfactual Matrix

| Case | Verdict |
|---|---|
| PCM chunk1 starts before chunk2 | 通常 PASS；**非契约** |
| PCM chunk2 sends before chunk1 | **FAIL possible**（flush/final 并发） |
| Opus chunk1 encode slow | **FAIL**（完成序可反） |
| Opus chunk2 encode fast | **FAIL**（可先 send） |
| first sent lacks field | **FAIL**→冻空（现状） |
| first sent explicit [] | 现状 omit 字段 → **等同 missing**；契约下应 PASS freeze empty |
| first sent valid prior | PASS if wins race |
| later valid prior | **FAIL**（sticky freeze） |
| all chunks same snapshot | **Current: NO**（仅首包） |
| final overtakes non-final | **FAIL possible** |
| encode throws first | snapshot 可能已创建；attached 可能未设；**State: partial** |
| ws.send throws | 同上 |
| reconnect during encode | **E2E REQUIRED** / P1 |
| finalize before prior carrier | **FAIL**（错误空 Job）现状 |
| pending-next early | pending 同 first-write；**同缺陷** |
| duplicate first / explicit | 第二次 ignore | PASS（已冻） |

---

# 15. Recommended Ordering Contract

```text
Authoritative Web Snapshot Creation Point:
  audio_sender.ts :: sendAudioChunkInternal
  — on first entry for current utterance, BEFORE any await/encode
  — domainPriorsSnapshotAtUtteranceStart := copy(getDomainPriorsForSession(sessionId))

Snapshot Immutability Rule:
  — until resetUtterancePriorSnapshot (is_final / sendFinal / setSessionId)
  — NEVER re-read ConversationDomainState for this utterance

Per-chunk Attachment Rule:
  — EVERY JSON AudioChunk of the utterance MUST set:
      domainContextVersion: "v1"
      domainPriors: <frozen snapshot>   // including []
  — Do NOT omit the field when empty
  — Do NOT attach only once

Authoritative Scheduler Freeze Trigger:
  — Freeze iff AudioChunk.domain_priors is Some(_) after serde
  — validate_domain_priors on the Vec; freeze cleaned (maybe [])
  — None/missing → do not freeze, do not clear
  — If already frozen → ignore

Missing Field Rule:
  — Missing = non-carrier; no freeze authority

Explicit Empty Rule:
  — domainPriors: [] = legal utterance-start empty snapshot; freezes EXPLICIT_EMPTY

Finalize Without Carrier Rule:
  — If still UNSET at finalize → Job.domain_priors = None (no-op IFC-03)
  — Do NOT invent []; do NOT query Web

Pending-next Rule:
  — Same Missing≠Empty and explicit-first-freeze rules on pending_next_*
  — Promote on complete_finalize unchanged

Retry Rule:
  — Unchanged: Job Redis snapshot byte/semantic identity

Reconnect Boundary:
  — Out of P0 scope (P1): current wipe-on-close remains until product decision
```

---

# 16. Exact Minimal Development Boundary

## KEEP

- Web ConversationDomainState Owner；AudioChunk 主 transport  
- Scheduler schema-only（无 registry）；Node soft；Job retry  
- LTR / Vote / Assembly / quota / topicShift / Tone / Formal pool  
- Production E2E 计划（修复后执行）  
- sendUtterance 非默认身份（本轮不改）  
- Binary 路径 quarantine（nego false）

## MODIFY（仅此）

| 文件 | 改动 |
|---|---|
| `webapp/.../audio_sender.ts` | freeze@Internal 入口；**每包**附着冻结 snapshot（含 `[]`）；调整/废弃 “attach once omit empty” |
| `scheduler/.../audio.rs` | 保留 `Option`：仅 `Some` 上送 Actor；**禁止** `Some(cleaned)` 掩盖 missing |
| `scheduler/.../actor_event_handling.rs` | `None` → 不调用 freeze；`Some` → freeze cleaned |
| `scheduler/.../state.rs` | 可选：注释/测试区分 UNSET vs frozen empty（逻辑可用现有 bool+Option 若 None 不冻） |
| 测试 | 见 §18 |

## RESTORE

- Missing ≠ Explicit Empty（被 `audio.rs` + omit-empty 破坏）  
- 一句一不可变 snapshot 在 **乱序首达** 下仍正确（被 attach-once 破坏）

## DELETE / QUARANTINE

- Web「empty → omit domainPriors」行为（ordering 下删除）  
- Binary prior carrier：**不作为本轮主修**；保持 quarantine  
- **禁止**引入 per-utterance 全局发送锁作为主方案  

---

# 17. Required Tests

### Unit

- snapshot 仅创建一次；中途 Web state 变更不改 snapshot  
- missing 不上 freeze；`[]` 可 freeze；non-empty 可 freeze  
- duplicate explicit ignore；pending-next 隔离  

### Async ordering（可控 deferred Promise）

```text
chunk1 encode deferred
chunk2 encode resolves first
→ 两包均带同一 snapshot
→ Scheduler 首达无论谁 → 正确非空或显式空
```

### Production-like

```text
Turn1 → prior
Turn2 concurrent chunks, first encode delayed
→ Node ctx.domainPriors 非空（或显式空语义正确）
```

### Counterfactual

no prior / explicit empty / mid-utt Web change / final overtakes / encode failure / retry / reconnect-in-flight（reconnect 可标 P1）

---

# 18. P0 Block List

1. **Attach-once + omit-empty + fire-and-forget Opus/final** → 错误空 freeze  
2. **`audio.rs` Always-Some** → Missing≡Empty，破坏 freeze authority  
3. **Actor unwrap_or_default + first-write** → 对 missing 误冻  

（修复边界即上表 MODIFY；不扩 reconnect/队列。）

---

# 19. P1 Deferred List

- Reconnect 是否保留 ConversationDomainState  
- Sch vs Node sanitizer 归一化差  
- stale llmCalibration.updatedAt  
- Binary 正式启用时的 Scheduler 解码  
- 音频 payload 乱序（非 prior）  

---

# 20–23. KEEP / MODIFY / RESTORE / DELETE

见 §16。

---

# 24. Final Verdict

```text
Ordering Contract Audit
PASS
```

**PASS 条件已满足：** snapshot 创建点唯一；freeze authority 唯一；Missing≠Empty 明确；PCM/Opus 风险明确；最小方案 **唯一（G）**；无新 Owner；无新主 transport；不改冻结业务架构；测试可证伪。

### 是否具备生成 P0 Ordering Repair 开发提示词的条件？

```text
是
```

可进入限域开发：仅按 §15–§17 实施 **G = freeze@entry + per-chunk attach + explicit-field freeze**，禁止方案 B/C/E 与全局发送锁主路径。
