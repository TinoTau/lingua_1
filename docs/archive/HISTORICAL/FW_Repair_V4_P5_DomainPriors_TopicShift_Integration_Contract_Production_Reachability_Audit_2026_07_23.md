<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_P5_DomainPriors_TopicShift_Integration_Contract_Production_Reachability_Audit_2026_07_23.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4
# FineSpan Soft Boundary + Session Domain Prior + LLM Correction
## P5 Integration Contract + Production Reachability Audit

| Field | Value |
|---|---|
| Date | 2026-07-23 |
| Document Type | Integration Contract Audit + Production Reachability Audit（**只读**） |
| Status | **Integration Contract Audit: FAIL** |
| Method | Code call graph + types + serde paths + production entry; not Development Report alone |
| Authority | Architecture SSOT / Runtime Evolution Rule / Ownership Matrix / Development Plan / Supplement / Constraint Addendum / P5 Compliance Audit / P5 Blocking Repair Report / **current code** |
| Non-goals | No code/config/protocol/test/prompt/data/arch-doc changes; not dialog_200; not Architecture Freeze |

---

# 1. Executive Summary

P5 Blocking Repair 已把 `domainPriors` / `topicShift` / Tone rebind / Formal pool harden **接到代码层**，且桌面生产主路径确认为：

```text
session_manager → AudioChunk (JSON) → SessionActor → actor_finalize → Job → JobAssign → Node
```

但本轮时序审计发现 **至少一个 P0 Block**：

```text
Web sendAudioChunk 为 fire-and-forget；
Opus JSON 路径在 attachFrozenDomainPriors 之前 await encode；
并发 chunk 可使“无 prior 的首包”先到达 Scheduler，
触发 first-write freeze([])，此后合法 prior 永久丢弃。
```

因此：

```text
Integration Contract Audit
FAIL
```

**不具备**在未修复该时序问题前宣称“可安全进入 Production E2E 并通过”的条件（E2E 可跑，但结果不能作为闭环 PASS 证据，除非强制单飞 pcm16 且证明无并发）。

---

# 2. Audit Scope

| In scope | Out of scope（除非直接读禁区数据） |
|---|---|
| domainPriors 全链 | LTR K1/K2/K3 算法 |
| AudioChunk snapshot 时序 | Presence Vote 算法 |
| Production 可达性 | Bucket / Assembly 组句策略 |
| Retry / Reconnect | KenLM / 词库 / Registry 设计 |
| topicShift / Condition B | |
| Tone rebind 引用安全 | |
| Formal pool empty 语义 | |
| Shadow transport | |

---

# 3. Frozen Contract Baseline（对照）

| 冻结要求 | 本轮对照结论 |
|---|---|
| Web = Session Prior 唯一 Owner | **HOLD**（store by sessionId） |
| Scheduler schema-only，不推理 | **HOLD**（`validate_domain_priors`） |
| Node 非 Session SSOT | **HOLD**（ctx 仅 soft） |
| utterance-start 快照；中途不覆盖 | **意图 HOLD；实现有竞态空洞（P0）** |
| empty 合法；retry 同 Job 快照 | empty **HOLD**；retry **HOLD**（Job serde） |
| topicShift 显式；≠ shouldSwitch | **HOLD** |
| Condition B 需当前句证据 | **HOLD**（merger） |
| Tone Formal range rebind | **HOLD**（有共享引用但限 winner 窗） |
| Formal pool 禁止 coarse 静默 fallback | **HOLD** |

---

# 4. Production Runtime Graph

```text
[Production]
SessionManager.processAudioFrame / sendCurrentUtterance
  → WebSocketClient.sendAudioChunk (void, 不 await)
    → AudioSender.sendAudioChunk → sendAudioChunkInternal
      → JSON AudioChunk { domainPriors? }   ★ prior 首次进入生产消息
  → Scheduler handle_session_message(AudioChunk)
    → audio::handle_audio_chunk → validate_domain_priors
    → SessionEvent::AudioChunkReceived
    → SessionActor.handle_audio_chunk → freeze_domain_priors_snapshot
    → try_finalize / do_finalize
      → create_job(..., domain_priors = snapshot.filter(!empty))
      → save_job (Redis JSON 含 domain_priors)
      → create_job_assign_message → JobAssign.domainPriors
  → Node applyFwDetectorJobOverrides → applyDomainPriorsFromJob
      → sanitizeDomainPriors → ctx.domainPriors
      → fw-detector-v4-path → LTR K3 + Assembly applyDomainPriorQuota
                                                        ★ prior 最后进入决策层

[Alternative / non-streaming]
AudioSender.sendUtterance(+domainPriors) → handle_utterance → Job
  （桌面流式会话默认不走）

[Test-only]
buildFineSpanCandidatePoolFromCoarseSpansForTests
pending_job_dispatches make_job(domain_priors: None) fixture
```

Scheduler `use_binary_frame: Some(false)`（`core.rs` SessionInitAck）→ **生产当前强制 JSON AudioChunk**，binary carrier 路径在协商层关闭（代码仍保留）。

---

# 5. domainPriors Contract Continuity Table

| # | Source type / field | Dest type / field | Serialization | Opt / Default | Sanitize | Mutation | Owner | Prod reachable | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `DomainMergerState.domainPriors` | Web store | in-memory | `[]` | merger canonicalize | sort/norm | Web | Y | `conversation-domain-state.ts` |
| 2 | store | `AudioSender.domainPriorsSnapshotAtUtteranceStart` | — | freeze once | copy | no | Web | Y | `attachFrozenDomainPriors` |
| 3 | snapshot | `AudioChunk.domainPriors` | `domainPriors` | omit if empty | no | no | Web | Y* | `audio_sender.ts`；*见时序 P0 |
| 4 | JSON | `SessionMessage::AudioChunk.domain_priors` | serde rename | Option/None | no | no | Protocol | Y | `messages/session.rs` |
| 5 | Option | `validate_domain_priors` → `Vec` | — | None→`[]` | schema | drop invalid/dedupe/trunc≤3；**不归一化** | Scheduler | Y | `domain_prior_validate.rs` |
| 6 | cleaned | `SessionEvent.domain_priors` | — | `Some(cleaned)` always from audio.rs | already | no | Scheduler | Y | `audio.rs:64` |
| 7 | event | `domain_priors_for_current_utterance` | — | first-write | no | **freeze only** | Scheduler | Y | `state.rs` freeze |
| 8 | actor | `Job.domain_priors` | serde field | None if empty | no | filter empty | Scheduler | Y | `actor_finalize.rs:216-219` |
| 9 | Job | Redis JSON | full Job | skip if None | no | no | Scheduler | Y | `job_redis_repository.rs` `serde_json` |
| 10 | Job | `JobAssign.domainPriors` | `domainPriors` | omit empty | no | clone | Scheduler | Y | `websocket/mod.rs:95-96` |
| 11 | JobAssign | `ctx.domainPriors` | — | `[]` | **Node sanitize + canonicalize（重排/归一化）** | **weights/order may change** | Node | Y | `fw-job-overrides.ts` |
| 12 | ctx | LTR K3 / quota | — | `[]` no-op | no | soft only | Node | Y | `ltr-fine-span-generator.ts` / `selectPerSpanCandidates` |

**语义缺口（P1）**：Scheduler 不归一化权重；Node `sanitizeDomainPriors`→`canonicalizeDomainPriors` **会**重排与归一化 → 同 Job 多次 Node 处理结果一致，但与 Job 字节不完全等价。

**缺失诊断**：Web omit empty vs Scheduler freeze `[]` vs Job `None` 三态；diagnostics 未区分 “未附着 / 空合法 / 清洗后空”。

---

# 6. AudioChunk Ordering Analysis

## 4.1 / 6.1 发送顺序

| 模式 | 代码意图 | 真实保证 |
|---|---|---|
| JSON pcm16 | 首包 `attachFrozenDomainPriors` 后 `sendCallback`；attach 前无 await | 单线程下首个 Internal 通常先发完；**fire-and-forget 仍允许多个 send 重叠** |
| JSON opus | **`await encodePackets` 在 attach 之前** | **不保证 prior 消息先于其他 chunk** |
| Binary | `ensureBinaryPriorSnapshotCarrier` sync 发 JSON，再 await encode 发 binary | 生产 `use_binary_frame=false` → **当前不可达**；若开启，carrier 与 binary 间有 async gap |

`session_manager_audio_frame.ts:257`：`ctx.sendAudioChunk(chunk, false)` **不 await**。  
`websocket_client.ts:211-217`：`sendAudioChunk` 返回 `void`，丢弃 Promise。

## 4.2 Actor 建立时机

SessionActor 在 session 创建时已存在；prior 在 **首个 `AudioChunkReceived` 事件** 时 `freeze`（含空 `[]`）。  
**可能在 “本应携带 prior 的消息” 到达前，已被无 prior 的首事件冻结。**

## 4.3 First-write-only

`freeze_domain_priors_snapshot`：以 `domain_priors_snapshot_frozen`（或 pending 对应 flag）为准；**第一个事件写入任意 cleaned（含 `[]`）后永不覆盖。**

| 场景 | 结果 |
|---|---|
| first 无 prior，later 有 valid prior | **永久 empty → P0**（与“empty 合法且 Web 保证首包携带”前提冲突：Web **未**在 Opus 并发下保证） |
| first 有 prior | 锁定；后续忽略 | OK |
| empty 故意 | 锁定 `[]` → Job `None` | 契约允许 |

## 4.4 Binary first

生产 binary 关闭 → **当前生产 Binary-first：不可达**。  
代码若开启：binary 不经 JSON `domainPriors`；依赖 carrier。若 binary 处理路径不存在于 Scheduler，binary 可能被忽略或另径 — 本轮 Scheduler 无 Binary 解码命中 → **E2E REQUIRED** if flag 打开。

## 4.5 Duplicate / reorder

| 事件 | 行为 |
|---|---|
| duplicate prior metadata | 第二次 freeze 忽略 | 不覆盖 |
| late prior after empty freeze | **丢弃** | P0 |
| late binary | N/A 生产 | — |
| 多次 finalize | `can_finalize` 去重 | 不因 prior 双 Job |

---

# 7. Snapshot Lifecycle Diagram

```text
create (Web):  null → getDomainPriorsForSession on first attachFrozenDomainPriors
attach (Web):  domainPriors on JSON iff length>0; attached=true
validate (Sch): validate_domain_priors
freeze (Sch):  first AudioChunkReceived → domain_priors_for_current_utterance
finalize:      Job.domain_priors = snapshot.filter(!empty)
retry:         Redis Job reload → same domain_priors → JobAssign
release:       complete_finalize clears / promotes pending_next
next utt:      Web resetUtterancePriorSnapshot on is_final/sendFinal/setSessionId
reconnect:     onClose/disconnect → resetConversationDomainState(sessionId) 清空 Web prior
               audioSender.setSessionId(null) → reset local snapshot
```

满足项：2,3,4（新句重读）,5（retry Job）,7,8,9,10。  
风险项：1（“开始时冻结”在并发下可能冻错）,6（reconnect **清空** prior，同 sessionId 重连不保留）。

---

# 8. Prior Normalization Matrix

| Input | Web | Scheduler | Node |
|---|---|---|---|
| missing | omit / `[]` store | None→`[]` freeze | `[]` |
| null | treat empty | None→`[]` | `[]` |
| `[]` | omit wire | freeze `[]`→Job None | `[]` |
| all invalid | — | drop→`[]` | `[]` |
| partial valid | keep | keep valid | keep+canonicalize |
| duplicate domain | merger dedupe | keep first | keep first |
| unknown domain | allowed | **no registry filter** | **no registry filter**（soft 无匹配） |
| weight=0 / <0 / >1 / NaN / Inf | dropped in merger path | dropped | dropped |
| string weight | N/A | serde fail / drop | Number()→drop if NaN |
| >Top3 | truncate | truncate | truncate |

**missing / null / []**：运行时多为同一 no-op；**Job 层 None vs 空 Vec 不同表示**，diagnostics 未区分来源。

危险差异：

```text
Web 有 prior 但首包竞态未带上
→ Scheduler freeze []
→ Job None
→ Node []
→ 无 “fallback old prior”（不会回落旧 prior；是静默丢失）★ P0
```

---

# 9. Retry Analysis

| 检查 | 结论 | Evidence |
|---|---|---|
| retry 复用 Job.domain_priors | **PASS** | Job 全量 serde Redis；`create_job_assign_message` clone |
| 是否回读 Web | **NO** | finalize 只用 actor/Job |
| 重 validate 改变顺序 | Job 已是 cleaned；Node sanitize 确定性 | 同 Job 同结果 |
| failover | `failover_reassign` 基于已存 Job | domain_priors 随 Job |
| 下一句 prior 污染 retry | **NO**（不回读 Web） | |

`pending_job_dispatches` 测试 `make_job` 的 `domain_priors: None` 为 **Test-only**，非生产 retry。

---

# 10. Reconnect State Transition Table

| Transition | Web prior | AudioSender snapshot | Scheduler actor | Risk |
|---|---|---|---|---|
| WS close | `resetConversationDomainState` **delete** | `setSessionId(null)` reset | session teardown | 同 sessionId 重连 **丢失** 历史 prior（P1） |
| disconnect() | same reset | same | — | same |
| new sessionId | 空 store | 新 freeze | 新 actor | OK |
| late result after reset | merge 写入 **当前** sessionId | — | — | 若旧 result 带旧 session_id 且 store 已删后重连同 id：可能写入新会话（P1，需 E2E） |
| interrupted utt | snapshot reset on final/session | — | complete_finalize clear | OK |

---

# 11. Production Reachability Graph

```text
PRODUCTION ENTRY
  session_manager_audio_frame / session_manager
       │ sendAudioChunk (no await)
       ▼
  audio_sender.sendAudioChunkInternal  ★ domainPriors 首次进入生产消息（JSON AudioChunk）
       ▼
  Scheduler session_message_handler::AudioChunk
       ▼
  SessionActor freeze → actor_finalize
       ▼
  Job.domain_priors → JobAssign.domainPriors
       ▼
  Node fw-detector-step.applyFwDetectorJobOverrides
       ▼
  ctx.domainPriors → LTR K3 / applyDomainPriorQuota  ★ 决策层终点

ALTERNATIVE: sendUtterance (+domainPriors) — 非桌面流式默认
TEST-ONLY: coarse pool helpers; pending_job make_job
DEAD (prod nego): binary frame prior carrier (flag false)
```

---

# 12. topicShift Contract Continuity Table

| Hop | Type / field | Opt/Default | Clone/Serde | Prod |
|---|---|---|---|---|
| Prompt | JSON `topicShift` | required in schema text | — | Y |
| Parser | `topicShift = obj.topicShift === true` | missing→false | — | Y |
| LexiconProfileDecision | `topicShift?: boolean` | optional | — | Y |
| buildLexiconSessionIntent | `topicShift: decision.topicShift === true` | required bool | — | Y |
| LexiconSessionIntent | `topicShift: boolean` | required | clone `=== true` | Y |
| session-result-extra | projected | false if not true | JSON extra | Y |
| result-builder llmCalibration | `topicShift: intent.topicShift === true` | — | JobResult.extra | Y |
| Scheduler ExtraResult | `topic_shift: bool` | serde `topicShift` | passthrough | Y |
| Web sanitizeLlmCalibration | **必须 boolean** else **整包 null** | — | — | Y |
| merger Condition B | `llmCalibration?.topicShift === true` | — | — | Y |

---

# 13. TopicShift Semantic Isolation Result

| 禁止来源 | 代码是否冒充 |
|---|---|
| shouldSwitch | **NO**（parser/build 显式隔离） |
| primaryDomain change | **NO** |
| secondary / confidence / summary / keywords | **NO** |
| currentTurnDomains / retainedDomains / Web prior | **NO**（仅 Condition B 门控用 domains） |
| `??` / `\|\|` fallback to shouldSwitch | **未发现** |

---

# 14. Condition B Reachability Diagram

```text
translation_result.extra.llmCalibration
  + currentTurnDomains
      → mergeDomainPriors
          → llmTopicShift && primaryDomain && confidence≥0.75
          → domain in current turn
          → domain in prev turn[0] or [1]
          → winner = LLM primaryDomain (correction only)
```

---

# 15. Condition B Gate Table

| Gate | Required | Production present? | Blocks forever? |
|---|---|---|---|
| `topicShift === true` | Y | via intent→extra | N（若 LLM 输出 true） |
| `primaryDomain` set | Y | intent | N |
| `confidence ≥ 0.75` | Y | intent | N |
| domain in **current** turn votes | Y | currentTurnDomains | N |
| domain in one of **previous two** turns | Y | recentTurns | N（首轮无历史则 B 失败→正确） |
| empty currentTurnDomains | early `no_op_empty_turn` | still updates calibration | B 本轮不触发 |
| stale `updatedAt < oldestTurn.createdAt` | reject calibration | **弱**：`updatedAt: Date.now()` 在 result-builder | 真·决策过期难检出（P1） |
| LLM-only 无当前句证据 | B false | — | 不翻转 ✓ |
| 覆盖 Presence Vote | **NO**（只改 Web session prior） | — | ✓ |

---

# 16. Stale / Delay / Ordering Analysis

| Case | Behavior | Verdict |
|---|---|---|
| Node result first（含 domains±calibration） | merge 一次 | OK |
| LLM 仅随 JobResult | 无独立 LLM websocket | 延迟 = 下一结果携带 |
| empty domains + calibration | 更新 calibration，不改 prior 决策 | OK |
| stale updatedAt | 可拒 | **updatedAt 常为发射时刻 → 防护弱（P1）** |
| duplicate LLM | 非 stale 则覆盖 stored calibration | P1 可接受 |
| utteranceId | `${session_id}:${utterance_index}` 记 turn | 非 event-time SSOT |
| arrival order | `nowMs` = merge 调用时 | Web 到达序 |

---

# 17. Tone Ownership and Mutation Diagram

```text
recallTopKForWindows(option windows)
  → WindowCandidate[] per windowId
commitBestFormalFineSpan
  → formal.candidates = winner.candidates  (same object refs)
rebindToneAfterFormalCommit(formal)
  → extractAcousticTonePatternForRecall(Formal raw range)  // slice/cache, no 2nd model
  → mutate candidate.raw*/tone* in place
```

| 问题 | 结论 |
|---|---|
| range 来自 Formal | **YES** |
| 原始 timestamp slices | **YES** |
| 仅 winner | **YES**（loser 不同 windowId 数组） |
| 共享引用污染 loser | **实质 NO**（分窗数组）；污染同窗临时引用 **YES but 不保留** |
| Hidden Gate | tone 失败→pattern null，只改坐标；**不 drop** |
| fallback span | candidates `[]`；trace 仍 rebind | OK |

---

# 18. Formal Pool Empty-State Matrix

| 输入 | 上游 | `buildFineSpanCandidatePool([], …, [])` | Class |
|---|---|---|---|
| no CJK / no syllables | `emptyResult` before LTR | 不调用 | **Upstream Prevented** |
| no coarse spans | `emptyResult` | 不调用 | **Upstream Prevented** |
| LTR 正常 | formalSpans≥1（含 fallback） | OK | Valid |
| 误传 `formalSpans=[]` | — | **throw FORMAL_POOL** | **Invalid Architecture State** |
| cancelled / silence 无 ASR 文本 | 视上游 emptyResult | — | Upstream Prevented / Unknown |

合法空句不应撞 hard fail（上游已 no-op）。误调用空数组 = invariant failure（符合 harden 意图）。

---

# 19. Session Prior Transport Ownership Matrix

| Path | Class | Notes |
|---|---|---|
| AudioChunk + utterance-start snapshot | **Production** | 桌面流式唯一主链 |
| sendUtterance + domainPriors | **Alternative production** | API 仍在；非 session_manager 默认 |
| 直接构造 Job.domain_priors | Test / ops | — |
| pending make_job None | Test-only | — |
| Binary carrier | Dead under current nego | flag false |
| Node Session store as SSOT | **不存在** | — |

**无 feature-flag 双主链并行**；存在 **可调用的替代 Utterance 链**（语义应一致，但是第二入口）。

---

# 20. Integration Import Graph

```text
session_manager → websocket_client → audio_sender → conversation-domain-state
scheduler: mod → audio → validate → actor → finalize → job_creator → Job → JobAssign
node: fw-detector-step → fw-job-overrides → domain-context-contract
     → fw-detector-v4-path → orchestrator → ltr / assemble / tone-commit-rebind
web result: message_handler → mergeConversationDomainState → domain-prior-merger
topicShift: parser → lexicon-session-intent → session-result-extra → result-builder
```

| Check | Result |
|---|---|
| test helper in production import | **NO**（`*ForTests` 仅 test 文件） |
| duplicate merger | Web only |
| duplicate sanitizer | Sch schema + Node canonicalize（**不一致**→P1） |
| bypass | Utterance 替代链 |

---

# 21. Static Counterfactual Matrix

| Case | Verdict |
|---|---|
| Prior metadata first | **PASS** if pcm16 单飞；**FAIL** under Opus concurrent（P0） |
| Binary first | **PASS**（生产 flag false / 不可达） |
| First event empty prior | **FAIL** if later valid expected（freeze sticky） |
| Later valid prior | **FAIL** after empty freeze |
| Duplicate prior metadata | **PASS**（ignore） |
| Web prior changes mid-utterance | **PASS**（Web snapshot + Sch freeze） |
| Finalize before metadata | **FAIL** if empty freeze first（P0） |
| Retry | **PASS** |
| Reconnect same session | **FAIL**/P1（Web prior wiped） |
| Reconnect new session | **PASS** |
| Missing prior | **PASS**（no-op） |
| Invalid all removed | **PASS**（→empty） |
| topicShift true/false/missing | **PASS** |
| shouldSwitch true only | **PASS**（不触发 B） |
| delayed / stale / duplicate LLM | **PARTIAL** → stale gate weak (**P1**)；B 仍需当前句证据 |
| empty Formal pool | **PASS**（上游 prevented / else hard fail） |
| Tone winner only | **PASS** |
| Tone shared reference | **PASS**（跨 option 隔离） |

无法静态证伪的活体项：**E2E REQUIRED**（真机并发 Opus、同 session 重连 late result）。

---

# 22. P0 Block List

### P0-1 — Opus JSON 并发首包可冻结 empty，导致 prior 永久丢失

| 项 | 内容 |
|---|---|
| 文件 | `webapp/web-client/src/websocket/audio_sender.ts`（`sendAudioChunkInternal` opus 分支：`await encode` **先于** `attachFrozenDomainPriors`）；`websocket_client.ts`（`sendAudioChunk` 不 await）；`session_manager_audio_frame.ts:257`（fire-and-forget） |
| 函数 | `sendAudioChunk` / `sendAudioChunkInternal` / `freeze_domain_priors_snapshot` |
| 调用链 | SessionManager → AudioSender（并发）→ Scheduler first event freeze([]) → later prior ignored → Job None → Node [] |
| 根因 | first-write-only + 无发送队列串行化 + Opus await 点 |
| 影响 | 生产 prior 在竞态下不可达 / 与错误空快照绑定 |
| 冻结约束 | utterance-start 快照必须正确；不得冻错 empty 后拒绝合法 prior |
| 最小修复边界 | **仅允许**：Web 发送串行化（单飞队列）且/或 attach **先于**任何 await；或 Scheduler 仅在“显式 prior carrier / 非空 prior”时冻结，空首包不冻（须仍满足契约）— **本轮不改码** |

---

# 23. P1 Block List

1. **Reconnect 清空 ConversationDomainState**：同 sessionId 重连丢失 prior 记忆（`connect_handlers` / `disconnect`）。  
2. **双 sanitizer 语义差**：Scheduler 不归一化；Node canonicalize 改变 weight/order。  
3. **llmCalibration.updatedAt = Date.now()**：stale 拒绝几乎无效。  
4. **sendUtterance 仍为第二 prior 入口**（非默认，但是 Alternative production）。  
5. **unknown domain** 无 Registry 过滤（soft 无匹配，非 gate；与部分文档“Node 再过滤”不完全一致）。  
6. **diagnostics** 无法区分 missing / empty / sanitized-empty。

---

# 24. KEEP

- Web Session Prior Owner；Scheduler schema-only；Node soft-only  
- AudioChunk 作为桌面流式主 transport（设计正确）  
- Job Redis 固化 → retry 同快照  
- topicShift 显式链；shouldSwitch 隔离  
- Condition B 需当前句证据  
- Formal pool hard fail；Tone Formal rebind  
- Quota 在 Vote 后一次  

---

# 25. MODIFY（建议边界 — 本轮不实施）

- Web AudioChunk 发送串行化 / attach-before-await（消 P0-1）  
- （可选）空首包不冻结 vs 显式 carrier 消息  
- reconnect 策略与 stale `updatedAt` 语义  
- 统一 Sch/Node sanitize 或文档承认 Node-only canonicalize  

---

# 26. RESTORE

无。

---

# 27. DELETE / QUARANTINE

- 不建议删 Utterance prior（Alternative）；应标非生产默认  
- binary carrier：nego 关闭下保持死码直至正式启用并补 Scheduler 二进制路径  

---

# 28. Production E2E Prerequisites

**当前：不具备“E2E PASS ⇒ 闭环成立”的前提。**

在修复 P0-1 之前：

- 可跑 E2E 做观测；  
- **不得**用 E2E PASS 证明 snapshot 时序安全（除非强制 pcm16 + 证明无并发 chunk）。

修复 P0-1 并完成静态复审后，再执行：

1. 双 Turn AudioChunk prior 非空到达 Node  
2. Opus（若启用）并发 chunk 压力  
3. retry 同 prior  
4. topicShift→Condition B  
5. 其后 dialog_200  

---

# 29. Final Verdict

```text
Integration Contract Audit
FAIL
```

**唯一充分否决条件（已成立）**：P0-1 AudioChunk/Opus 并发下 first-write 可冻结错误 empty snapshot，导致合法 `domainPriors` 在真实生产消息序中不可达。

### 是否具备执行 Production E2E 的条件？

```text
否（就“闭环证明”而言）
```

先按最小边界消除 P0-1，再开 Production E2E；本轮只读，不改码、不跑 dialog_200、不宣布 Architecture Freeze。
