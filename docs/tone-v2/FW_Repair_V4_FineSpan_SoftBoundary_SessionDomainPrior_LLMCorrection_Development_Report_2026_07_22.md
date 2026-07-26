# FW Repair V4
# FineSpan Soft Boundary + Session Domain Prior + LLM Correction
## Development Report

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Document Type | Development Report (P4) |
| Status | Implementation landed — full dialog_200 / Scheduler E2E pending P5 |
| Authority | Development Plan + Constraint Addendum + Supplement |
| Related | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_*_2026_07_22.md` |

---

# 0. Consistency check (pre-dev)

| Expected (frozen) | Actual (pre-dev) | Impact |
|---|---|---|
| LTR FineSpan production entry | `generateGlobalWindows` full sliding window | MODIFY orchestrator entry |
| Web owns `sessionDomainPriors` | No ConversationDomainState | CREATE Web merger |
| `ExtraResult` carries `currentTurnDomains` | Closed whitelist stripped fields | MODIFY Rust ExtraResult |
| Soft prior = `domainPriors` only | profile / weak-domain residual | CUT weak plan from FineSpan recall |
| Pool by Formal FineSpan | Pool by coarse span | MODIFY pool builder |
| `topicShift` explicit | only `shouldSwitch` | MODIFY parser + projection |

---

# 1. What was implemented

## 1.1 Protocol

- TS contracts (3 copies): `domainPriors`, `currentTurnDomains`, `llmCalibration`, `domainContextVersion=v1`
- Rust: `ExtraResult` + `Utterance` + `JobAssign` + `Job.domain_priors` + `validate_domain_priors` (schema-only)
- JobAssign creation passes cleaned `domain_priors` (retry-stable)

## 1.2 Node FineSpan main chain

- **NEW** `ltr-fine-span-generator.ts` — cursor LTR, soft boundary ≤1, formal non-overlap, fallback advance, prior tie-break only after K1/K2
- **MODIFY** `span-assembly-v4-orchestrator.ts` — production entry = LTR; `weakDomainPlan: undefined`; `domainPriors` soft input; architectureCompliance flags
- **MODIFY** `buildFineSpanCandidatePool` — Formal FineSpan primary key; coarse legacy path kept for tests via `findOwningCoarseSpanIndexV4`
- **NEW** `apply-domain-prior-quota.ts` — memory-only quota (prior/base/other)
- **NEW** `domain-context-contract.ts` — sanitize / project Top3
- **MODIFY** `fw-job-overrides.ts` — bind `job.domainPriors` → `ctx.domainPriors` (**never** into `enabledDomains`)
- **MODIFY** `result-builder-core.ts` — emit `currentTurnDomains` + `llmCalibration`
- **MODIFY** LLM parser — `topicShift` explicit; default false; not equated to `shouldSwitch`

## 1.3 Web

- **NEW** `webapp/web-client/src/domain/conversation-domain-state.ts` — sessionId-keyed merger (Condition A/B, empty-turn no-op, Top3)
- **MODIFY** `message_handler.ts` — ingest `extra.currentTurnDomains` / `llmCalibration`
- **MODIFY** `audio_sender.ts` — attach `domainPriors` on next utterance

---

# 2. KEEP / MODIFY / RESTORE / DELETE (completion)

## KEEP

- Presence Vote + `DOMAIN_BUCKET_RETENTION_RATIO=0.75`
- Multi-bucket Assembly + sentence cap 16 + KenLM
- Context Prior diagnostics-only (`applied:false`)
- `term_domain_tags` multi-domain
- Web session prior ownership
- Scheduler zero domain inference
- `generateGlobalWindows.ts` file (test/helper only — **not** production entry)

## MODIFY

- FineSpan production entry → LTR
- Pool identity → Formal FineSpan
- Protocol ExtraResult / JobAssign / Utterance
- JobResult projection fields
- LLM `topicShift`
- Web state + utterance attach

## RESTORE

- Soft coarse boundary semantics (pause metadata)
- Current-turn evidence priority over prior
- Base + other-domain exploration quota

## DELETE (from production call graph)

- Orchestrator call to `generateGlobalWindows` + `truncateWindows` budget as formal-window producer
- Weak-domain plan injection into FineSpan recall (`weakDomainPlan: undefined`)
- Dual prior (profile as FineSpan soft prior)

**Still present but non-decision / non-production-entry:**

| Symbol | Reachability |
|---|---|
| `generateGlobalWindows` | tests / archive helper |
| `allNonOverlapSubsets` | still used for per-slot alternative enumeration; formal spans themselves asserted non-overlapping |
| `activeLexiconProfile` | session/summary only |
| `context-prior.ts` | diagnostics only |

---

# 3. Tests run (this round)

```text
PASS domain-context-contract.test.ts
PASS apply-domain-prior-quota.test.ts
PASS ltr-fine-span-generator.test.ts
PASS domain-presence-vote-acceptance.test.ts
PASS assemble-domain-aware-span-sets.test.ts
```

Broader `test:fw-detector` previously: 43+ suites green after LTR entry change (aside from transient import fixes).

**Not yet run (P5):** dialog_200 frozen replay, Scheduler golden round-trip, full counterfactual matrix (R-ADD / CF-*).

---

# 4. Architecture compliance (interim)

| Gate | Status |
|---|---|
| Production FineSpan = LTR only | PASS (orchestrator) |
| `domainPriors` ↛ `resolveRecallScope` | PASS (bind path separate) |
| profile weak plan on FineSpan | PASS (forced undefined) |
| Web merger sole session decision | PASS (module created + wired) |
| ExtraResult explicit fields | PASS (Rust) |
| formalOverlapCount == 0 assert | PASS (LTR + pool) |
| dialog_200 / CF suite | PENDING P5 |
| DELETE reachability static audit | PENDING P5 |

**Interim verdict:** CONDITIONAL PASS — core path landed; P5 must complete counterfactual + dialog_200 + import-graph audit before freeze.

---

# 5. Known gaps / follow-ups for P5

1. ~~Wire `applyDomainPriorQuota` into recall/assembly selection~~ **DONE** — hooked in `selectPerSpanCandidates` / `runDomainAwareAssembly`; orchestrator passes `domainPriors`.
2. ~~`fwSpans` aligned to Formal FineSpan~~ **DONE** — `buildFwSpansFromFormalFineSpans` replaces coarse-index alignment on production path.
3. Tone recompute-after-commit: add explicit assertion tests that formal span tone range equals commit range.
4. Web merger coarse→fine mapping via registry allowlist (currently assumes fine ids from Vote).
5. Intent JSON prompt: document `topicShift` in CPU prompt templates.
6. Remove / quarantine production imports of `truncateWindows` formal budget if any remain.
7. Full Scheduler↔Node↔Web golden fixtures.
8. dialog_200 frozen ASR replay + performance compare.

---

# 6. Files touched (primary)

```text
electron_node/.../domain-context-contract.ts(+test)
electron_node/.../ltr-fine-span-generator.ts(+test)
electron_node/.../apply-domain-prior-quota.ts(+test)
electron_node/.../span-assembly-v4-orchestrator.ts
electron_node/.../assemble-domain-aware-span-sets.ts
electron_node/.../domain-assembly-types.ts
electron_node/.../v4-types.ts
electron_node/.../fw-job-overrides.ts
electron_node/.../fw-detector-v4-path.ts
electron_node/.../result-builder-core.ts
electron_node/.../lexicon-profile-decision-parser.ts
electron_node/.../session-runtime/types.ts
central_server/scheduler/.../common.rs, session.rs, node.rs, job.rs, domain_prior_validate.rs, websocket/mod.rs, job_creator.rs
*/shared/protocols/messages.ts (×3)
webapp/web-client/src/domain/conversation-domain-state.ts(+test)
webapp/web-client/src/app/message_handler.ts
webapp/web-client/src/websocket/audio_sender.ts
```

---

# 7. Final statement

本轮 P4 已按冻结方案落地：**LTR FineSpan 生产入口、Web 会话 prior 闭环、Scheduler 显式透传、Node soft prior 绑定、Vote/Assembly/KenLM 职责保持**。  
完整验收与反事实矩阵交由 P5；在 P5 完成前不得宣称最终 Architecture Compliance = PASS。
