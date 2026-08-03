<!-- Documentation Hierarchy Metadata
Status: **RETIRED**
Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0
Archive Path: docs/archive/RETIRED/FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_PreDevelopment_Audit_2026_07_22.md
-->

> **RETIRED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0

﻿> **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** (Step 6, 2026-07-30). SoftBoundary LTR Fine Span is deleted from runtime; see Runtime SSOT V1.2 + Lattice Architecture V1.0.0.
> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4 FineSpan Soft Boundary + Session Domain Prior + LLM Correction Pre-Development Audit

| Field | Value |
|------|-------|
| Date | **2026-07-22** |
| Nature | **Read-only** · no code / config / lexicon / doc mutations |
| Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |
| Related | [`FW_Raw_Left_To_Right_FineSpan_Compatibility_Audit.md`](./FW_Raw_Left_To_Right_FineSpan_Compatibility_Audit.md) · GT First-Loss audits |
| Filename | `FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection_PreDevelopment_Audit_2026_07_22.md` |

---

## 1. Executive Summary

```text
判断: 需要先清理旧逻辑
```

在不引入第二条主链、不恢复 Beam / 全量重叠窗的前提下，目标架构**可落地**，但当前仓库存在三类必须在正式编码前收口的冲突：

| # | Conflict | Evidence |
|---|----------|----------|
| 1 | FineSpan 仍是**整句音节 2～5 全量重叠滑窗**，正式窗彼此重叠；Assembly 事后消解 | `generate-global-windows.ts`；`build-sentence-candidates.ts` |
| 2 | **两套会话领域状态**：Presence Vote（`retainedDomains`）与 CPU LLM Intent Profile（`activeLexiconProfile` / `lexiconSessionIntent`）并存；Context Prior 已冻结为 diagnostics-only | `utterance-domain-vote.ts`；`session-finalize.ts`；`context-prior.ts`；Freeze § Context Prior |
| 3 | **Web 无法收到 / 无法回传**领域状态：Scheduler `ExtraResult` 为**白名单结构体**，反序列化时丢弃 `fw_detector` / `lexiconSessionIntent`；`JobAssign` / `Utterance` **无** prior 字段 | `central_server/scheduler/src/messages/common.rs::ExtraResult`；`JobAssign` / `UtteranceMessage` |

```text
可直接开发 — 否（协议白名单 + 双领域状态 + 全滑窗未替换）
需要先清理旧逻辑 — 是（本结论）
存在架构冲突 — 部分（协议/双状态；非不可调和）
当前证据不足 — 否（代码证据充分）
```

**唯一推荐方案（摘要）**：用 cursor 单向 LTR + soft coarse boundary（复用已有 `maxBoundaryCrossCount=1`）替换全滑窗；句级 Domain Vote 继续为当前句权威；在 **Web 存 3～5 轮 `currentTurnDomains` → 回传 `sessionDomainPriors`**；Scheduler **仅扩展透传字段、不做推理**；Node 将 priors **合并为单一 `domainPriors`** 供 FineSpan/Recall 排序与配额（非 gate）；LLM Intent **降级为低频纠偏输入**同一合并器，禁止直接改 Vote / 禁止热路径调用。

---

## 2. Current-State Architecture

### 2.1 Formal main chain（已确认）

```text
WAV / ASR
  → rawAsrText + word timestamps + AcousticToneSlice
  → FW_SPAN_DETECTOR
       → partitionCoarseSpans          [FW/IME 粗边界]
       → generateGlobalWindows         [全量重叠窗 ★]
       → blockedFilter / truncateWindows
       → recallTopKForWindows          [每窗 SQL]
       → resolveCompatibilityRelations [isCovered / CONFLICT]
       → buildFineSpanCandidatePool    [按 CoarseSpan 分组]
       → voteUtteranceDomainFromPool   [Presence Vote]
       → Multi-Bucket filter/select
       → buildSentenceCandidates       [重叠子集枚举]
       → merge ≤16 → KenLM → text_asr
  → assembleJobResult(extra)
  → Scheduler TranslationResult(extra=ExtraResult whitelist)
  → Web
```

入口：`fw-detector-orchestrator.ts::runFwDetectorOrchestrator` → `fw-detector-v4-path.ts` → `span-assembly-v4-orchestrator.ts`。

### 2.2 Parallel session / LLM chain（仍运行，非 FineSpan 热路径）

```text
session-finalize begin/end
  → shouldScheduleIntentJob (bootstrap / interval / time / no_topk_surge)
  → enqueueIntentJob → lexicon_intent_cpu HTTP
  → LexiconProfileDecision → pendingProfile / activeLexiconProfile
  → JobResult.extra.lexiconSessionIntent / activeLexiconProfile
```

证据：`session-finalize.ts`；`intent-job-scheduler.ts`；`cpu-intent-llm-worker.ts`；`session-result-extra.ts`。

### 2.3 Context Prior

```text
context-prior.ts = diagnostics-only stub
Freeze: Context Prior diagnostics-only
mergeContextPriorIntoRuntimeDiag — 写入 runtime 诊断，不改 Vote/Assembly/KenLM
```

---

## 3. FineSpan Current Implementation

### 3.1 Classification

```text
CURRENT = B. 整句全量重叠窗口
（兼有 boundary_window：跨 1 个粗边界的窗；>1 粗边界 blocked）
≠ cursor 顺序扫描；≠ 每粗 Span 完全隔离（窗在全局音节流上生成）
```

| Item | Fact |
|------|------|
| Owner | `generate-global-windows.ts::generateGlobalWindows` |
| Length | `V4_LIMITS.windowMinSyllables=2` … `windowMaxSyllables=5` |
| Soft boundary already? | **Partial**: `maxBoundaryCrossCount=1` → `boundary_window` + `boundaryPenalty=0.85`；`>1` → blocked |
| Hard stop at coarse end? | **No** for window gen；跨界靠 `collectDistinctCoarseSpanIds` |
| Cursor? | **No** FineSpan cursor；仅 Assembly gap 有 cursor |
| Formal FineSpan overlap? | **Yes** — 全部存活窗保留并进 Recall |
| Overlap resolved by | Compatibility (`isCovered`) + Assembly non-overlap subsets；**非** Generator 收口 |
| Beam? | FineSpan **无**；IME beam 仅粗边界；coarse sentence beam 已删 |
| Vote pool unit | **CoarseSpan**（`FineSpanCandidatePool` 名实不符） |

### 3.2 Soft boundary vs target

| Target rule | Current |
|-------------|---------|
| FW 粗边界保留 | Yes |
| Soft：默认可不跨 | Prefer `in_span_window`；跨界用 penalty |
| 最多跨 1 相邻粗边界 | Yes (`maxBoundaryCrossCount=1`) |
| 禁止跨 ≥2 | Yes (blocked) |
| 临时 options 可重叠 | Yes（现状=全部 options 正式化） |
| 正式 FineSpan 不重叠 | **No — 冲突** |
| Cursor 只前进、每位置提交一个 | **No — 冲突** |
| 正式 Span 内多 candidate | Yes（Recall TopK per window） |

### 3.3 Overlap scenarios（如「一杯 / 一杯少 / 一杯少冰」）

1. 全部作为 `GlobalWindowDescriptor` 生成（长度允许时）。
2. 全部可进 Recall（预算内）。
3. Vote：**不按窗加票**（并入同一 coarse 池）。
4. Assembly：`allNonOverlapSubsets` 拒绝冲突组合 → **组合膨胀主因**（First-Loss：`CROSS_SPAN_COMBINATION_MISS`）。
5. Cap 16 在句候选层，不直接限制窗数。
6. **收口层建议**：FineSpan Generator（正式提交前），禁止再 defer 到 Assembly/KenLM。

### 3.4 Target examples feasibility

| Example | Feasible with reuse? |
|---------|----------------------|
| `[酒]\|[店前台]` → `[酒店][前台]` | Yes：已有 cross=1；需 LTR 选跨界正式 Span |
| 正常停顿不优先「退房然后」 | Need：跨界仅完整词命中+penalty；当前全窗枚举易产生长跨界候选 |
| `一杯少冰奶茶` → `[一杯][少冰][奶茶]` | Need：正式不重叠提交；当前依赖 Assembly |
| Session prior 餐饮 | Need：协议 + prior 消费钩子；Recall 现为 scope 过滤非加权排序 |
| 单轮错误 vote 不覆盖会话 | Need：session prior 衰减合并（尚无） |
| 连续切换 + LLM topicShift | Need：统一合并器；现 LLM 改 profile，与 Vote 脱节 |

---

## 4. Domain Data Flow

### 4.1 Ownership table

| Symbol | Producer | Consumer | Lifecycle | In JobResult.extra? | Cross-turn? | Notes |
|--------|----------|----------|-----------|---------------------|-------------|-------|
| `retainedDomains` / `domainScores` | Presence Vote | Multi-Bucket Assembly | Per utterance | Nested under `fw_detector.spanAssemblyV4` | No（除非 Web 另存） | Current-turn authority for buckets |
| `utteranceDomain` | Vote diagnostic | Diagnostics | Per utterance | Same | No | Not sole Assembly driver |
| `recallDomainScope` / `enabledDomains` | `resolveRecallScope` (config / job override) | Recall SQL scope | Per job | configSnapshot / runtime | Config sticky | **Not** session prior weights |
| `availableFineDomains` | Runtime domain registry | Expand policy | Process | No | Registry | Lexicon/registry SSOT |
| `profile.primaryDomain` / `secondaryDomains` / `boosts` | LLM Intent → session | Weak plan / industry routing / diagnostics；legacy domain-boost | Session on **Node** | `activeLexiconProfile` | Yes on Node | Parallel session domain |
| `lexiconSessionIntent` | LLM decision | Result extra / next turns on Node | Session | Yes in Node extra | Yes on Node | Summary + coarse primary |
| `contextPrior*` | Stub / diag merge | Runtime diag only | Per job | fw runtime | No | Frozen diagnostics-only |
| `domainBoostApplied` | Legacy lexicon path | Rolling stats | Per turn | Yes | Rolling | FW V4 main path **不**主用 |
| `fwEnabledDomains` override | Test server / job ctx | Recall scope override | Per job | No | No | Exists for tests |
| `sessionDomainPriors` | **未找到** | — | — | — | — | Target field |
| `currentTurnDomains` | **未找到**（可用 retainedDomains 投影） | — | — | — | — | Target field |
| `domainPriors` (unified) | **未找到** | — | — | — | — | Target FineSpan input |

### 4.2 JobResult shape

- Node `JobResult`：`inference-service` + `assembleJobResult`；`extra` 为开放 `Record`，含 `fw_detector`、`raw_asr_text`、session fields。
- Wire `JobResultMessage.extra`：TS 为 `[key: string]: unknown`（开放）。
- Scheduler → Web `TranslationResult.extra`：Rust **`ExtraResult` 白名单**（emotion / speech_rate / voice_style / service_timings / language_probability* / reason）→ **剥离** `fw_detector`、`lexiconSessionIntent`、`retainedDomains`。

**已确认事实**：Web 端当前路径**收不到** Presence Vote 结果。

### 4.3 Web state

- `sessionId`：有（`useWebSocket` / connection manager）。
- Domain / prior / previousJobResult domain：`webapp` 下 **未找到** 对 `retainedDomains` / `fw_detector` / `lexiconSessionIntent` 的消费。
- 适合存 3～5 轮 domain：**可以**（客户端内存），但必须先让 Scheduler 把字段送到 Web。
- 刷新/新会话：现有 session 重建即清；**需**在接入 prior 时显式清空规则。
- 串话风险：按 `session_id` 隔离即可；多设备同 session 需约定「最后写入 wins」或禁止共享写 prior。

### 4.4 Scheduler

- **不做**领域推理（已确认）。
- JobAssign：**无** domain prior 字段。
- Utterance：**无** domain prior 字段。
- 结果透传：`ExtraResult` **会丢弃未知字段**（serde 默认忽略未知输入字段，且输出只序列化已知字段）→ **不是**透明 passthrough。

### 4.5 Node prior hooks（现有）

| Hook | Suitable for sessionDomainPriors? |
|------|-----------------------------------|
| `resolveRecallScope` | Scope membership only — **gate-like if misused as sole domains**；可用 expand，不可用作唯一允许域 |
| `weakDomainRecallResolver` + profile | Soft preference pattern exists |
| `domain-boost-calculator` | Legacy score boost；**不得**复活为 VoteMass；可参考权重思想做 **option ranking only** |
| Presence Vote | Must remain current-turn evidence；prior 不得覆盖 |
| KenLM | Must not take prior |

Recall：按 `domainIds` **查询/过滤**（fragment `domainIds.includes`）；Hotword 带 `domains[]` from `term_domain_tags`。**未找到**「按 prior 权重重排 SQL」的正式 API——需在候选排序层加 soft score，或 query 顺序，**禁止** drop base / 禁止 drop 其他域。

### 4.6 LLM summary

| Item | Fact |
|------|------|
| Service | `lexicon-intent-cpu` + Node worker |
| Frequency | Bootstrap ≤3 turns；每 20 turn；≥3min；no_topk surge |
| Hot path FineSpan? | **No**（异步 enqueue） |
| Dominates current-turn Vote? | **No** |
| Dominates session profile? | **Yes**（`activeLexiconProfile`） |
| topicShift field? | **未找到**显式 `topicShift`；有 profile switch events |
| Align fine domains? | LLM domains via `isValidLLMDomain` / registry；coarse→fine expand in recall scope |
| Shadow? | Context prior / domain-rerank **已删或 diag-only** |

收敛为低频纠偏：LLM 输出 → **Session Prior Merger** 输入之一，**禁止**直接写 `retainedDomains` / **禁止**无合并写 `domainPriors`。

---

## 5. Gap Analysis（目标 vs 现状）

| Target | Gap |
|--------|-----|
| LTR cursor + soft boundary + 正式不重叠 | Generator 全滑窗；正式重叠 |
| Soft boundary 跨最多 1 | **已基本具备** |
| currentTurnDomains in JobResult → Web | ExtraResult **剥离**；需协议扩展 |
| Web 存 3～5 轮 → sessionDomainPriors | Web **无**存储；协议 **无**回传字段 |
| Scheduler validate+passthrough | 需改白名单；业务逻辑保持零 |
| Node FineSpan 消费统一 domainPriors | **无**该接口；有 profile / scope 碎片 |
| Prior = soft（排序/配额）非 gate | 现 scope 易变成硬过滤；需显式 soft API |
| LLM 低频纠偏 | 现为 session profile 主更新源之一 → 需降权并入 merger |
| 单轮 Vote 不覆盖会话 | **未实现** session prior 衰减 |
| Dual path / Beam / 全滑窗 | 全滑窗仍在主链；Beam FineSpan 已删 |

---

## 6. Conflicts and Redundancy

| Item | Class |
|------|-------|
| `generateGlobalWindows` full slide | **仍在主链运行** — 实施 LTR 时删除 |
| `boundary_window` + penalty | **运行中** — **复用**为 soft boundary，勿另造 `softBoundary` 类型 |
| Presence Vote vs LLM profile | **双状态** — 必须合并 ownership |
| `contextPrior*` diagnostics | **诊断残留** — 保持 diag；勿复活为 gate |
| `domain-boost-calculator` | Legacy / tests；非 FW V4 Vote |
| `suspicious-span-detector` | Lexicon diagnostics / archive — **非** FW V4 主链 |
| `domainId` on WindowCandidate | **已删除**（Freeze）；实验脚本仍有启发式 |
| Scheduler ExtraResult whitelist | **运行冲突** vs Web domain round-trip |
| `FineSpanCandidatePool` by coarse | 名实不符 — 实施真 FineSpan 投票池时 ADJUST |

---

## 7. Ownership Decision（唯一）

| Concern | Owner |
|---------|-------|
| Coarse boundary | FW / `partitionCoarseSpans`（不变） |
| FineSpan boundary selection | **New LTR FineSpan Generator**（替换 `generateGlobalWindows`） |
| Recall | `recallTopKForWindows` / `recallSpanTopKV3`（复用） |
| Current-turn Domain Vote | `voteUtteranceDomainFromPool`（唯一当前句权威） |
| sessionDomainPriors **storage** | **首选实现（证据成本最低）**：Node `SessionObject` finalize 写入本轮 `retainedDomains` → 聚合 priors，下一 turn bind；**目标架构若坚持 Web 持有**：Web 环形缓冲（须先扩 ExtraResult） |
| sessionDomainPriors **transport** | Node 本地路径：**无跨端传输**；Web 路径：Scheduler **字段透传 only**（现状会剥字段） |
| domainPriors **merge**（Vote 历史 + LLM calibration） | **唯一决策点**：确定性 Merger；落地位置二选一（不可双写）：**(A) Node Session finalize**（侵入低，与现有 Intent/rolling 同处）或 **(B) Web**（需协议）；FineSpan **只消费**最终 `domainPriors` |
| LLM correction | `lexicon-intent-cpu` → 结构化校准 → **同一 Merger 输入**（非热路径、非第二 Vote） |
| Request validation | Scheduler schema validate（仅 Web 回传路径需要） |
| Long-term Node session profile | **收敛**：停止用 LLM `pendingProfile` 秘密影响 FW Recall；Merger 显式产出 `domainPriors` |

**所有权裁定（补充证据）**：[域/JobResult/Web/LLM 专项审计](8b572b15-037f-4165-b6a8-00737fa710a0) 确认 Web 现状无域存储、Scheduler `ExtraResult` 闭包剥除 `fw_detector`/`lexiconSessionIntent`，故 **Node Session 存 prior 是最小闭环**。若产品硬性要求「Web 持有并回传」，则协议扩展为 P0，不可跳过。**禁止** Node Session prior 与 Web prior **同时**改 Recall 排序。

---

## 8. Minimal Development Scope

### Protocol（先决）

1. 扩展 `ExtraResult`：`currentTurnDomains: {domain, count?}[]`（从 `retainedDomains`/`domainScores` 投影，**小载荷**）。
2. 可选：`llmCalibration: {domains, confidence, topicShift?, summaryVersion}`（禁止长摘要进 FineSpan）。
3. 扩展 `Utterance` / `JobAssign`：`domainPriors: {domain, weight}[]`（Top≤3）。
4. TS `messages.ts`（electron + central_server shared）与 Rust 同步。

### Node FW

5. 替换 `generateGlobalWindows` → LTR soft-boundary generator（正式不重叠；临时 options 可重叠；跨界≤1）。
6. 接线：请求 `domainPriors` → option ranking / domain candidate quota soft weights。
7. Vote / Multi-Bucket / Cap16 / KenLM：**不改公式**。
8. 停止 Context Prior / profile boost 对 FW 的隐式影响（保持 diagnostics）。

### Web

9. 环形缓冲最近 3～5 轮 `currentTurnDomains` + LLM calibration。
10. 确定性 merge → `domainPriors` 随下一 utterance 发送。
11. 新会话清空。

### Scheduler

12. 仅 schema 透传；零推理。

---

## 9. Removal Scope（实施时删除，本轮不改）

```text
MUST DELETE when LTR lands:
- generateGlobalWindows 全量双层枚举主链用法
- 依赖「海量重叠正式窗」的 truncate 策略（若不再需要）

MUST CONVERGE / STOP as FineSpan prior:
- LLM activeLexiconProfile 对 FW Recall 的隐式 soft 路径（若有）
- 任何复活 Domain Rerank / VoteMass

DO NOT keep dual production paths:
- 旧全滑窗 + 新 LTR 并行
- Web priors + Node profile 双 prior 同时改排序
```

Archive-only：`legacy/archive/fw-detector-span/*`；suspicious-span（非 V4 主链）。

---

## 10. Interface Proposal（基于现有命名）

### JobResult → Web（Scheduler ExtraResult 扩展）

```json
{
  "currentTurnDomains": [
    { "domain": "coffee", "count": 2 },
    { "domain": "food_order", "count": 2 }
  ],
  "llmCalibration": {
    "primaryDomain": "travel",
    "secondaryDomains": [],
    "confidence": 0.82,
    "topicShift": false,
    "summaryVersion": "intent-v1",
    "updatedAt": 0
  }
}
```

- `currentTurnDomains` ← `fw_detector.spanAssemblyV4.retainedDomains` + `domainScores`（投影，勿塞整棵 fw_detector）。
- 禁止把完整 `fw_detector` / 长 `lexiconIntentSummary` 字符串作为 FineSpan 输入。

### Next request → Node

```json
{
  "domainPriors": [
    { "domain": "coffee", "weight": 0.55 },
    { "domain": "food_order", "weight": 0.30 },
    { "domain": "bakery", "weight": 0.15 }
  ]
}
```

- FineSpan **只读** `domainPriors`；不知来源。
- 非法/缺失 → 空 priors，行为 = 当前基线。

### 避免新建的中间态名

不要新增：`repairTarget`（已有别义）、`beamState`、`spanPath`、`crossSpanCandidate` 类型洪泛。跨界用现有 `boundaryCrossCount` / `windowSource`。

---

## 11. Data Structure Examples

### Soft coarse boundary

```text
coarseSpans: [{id:c0, raw:[0,1]}, {id:c1, raw:[1,4]}]  // 「酒|店前台」
boundaryPositions: [1]
option「酒店」: boundaryCrossCount=1, windowSource=boundary_window
```

### Non-overlapping FineSpans

```text
[{start:0,end:2,text:"酒店"},{start:2,end:4,text:"前台"}]
```

### FineSpan candidates（同边界多候选）

```text
FineSpan[一杯]: candidates=[拿铁?, 美式?, …]  // domains[] from term_domain_tags
```

### Merge sketch（Web，确定性）

```text
sessionDomainPriors =
  decay(prevPriors) + 0.5*ema(currentTurnDomains) + 0.3*llmCalibration
  clip Top3, renormalize
  single-turn hotel after restaurant-history → tail only
  two-turn hotel + llm topicShift → promote hotel
```

（具体系数开发方案冻结；审计只要求 deterministic + replayable。）

---

## 12. Target List

### 必须完成

```text
1. ExtraResult + JobAssign/Utterance 协议扩展（否则 Web prior 闭环不成立）
2. LTR FineSpan Generator（正式不重叠；soft 跨界≤1）
3. 删除全滑窗主链
4. Web 3～5 轮缓冲 + domainPriors 回传
5. Node 消费 domainPriors（排序/配额 soft）
6. LLM → calibration 字段；停止双 prior
7. 诊断：cursor/options/cross/selected + priors in/out
```

### 建议完成

```text
Vote 池改为有序 FineSpan（对齐 SSOT 文案）
one-step lookahead 可行性实验（默认不做）
```

### 明确不做

```text
Beam / 全局回溯 / DP
Scheduler 领域推理
LLM 进 FineSpan 热路径
Prior 作 gate / 删 base / 独占 SameDomain
双链路兼容旧滑窗
用配置重建 domain SSOT
```

---

## 13. Check List（开发后验收）

1. 粗边界正确 → 不跨界胜出  
2. 误切 → 跨 1 界合成完整词  
3. 禁止跨 2 界  
4. 临时 options 可重叠  
5. 正式 FineSpan 不重叠  
6. 同 Span 多 candidate  
7. base/domain/other 配额  
8. prior 命中加速确认（不发明词）  
9. prior 错误可被当前证据推翻  
10. 单轮错误 vote 不翻盘 session prior  
11. 连续切换 + LLM 一致可切换  
12. LLM 同意 / 冲突 / topicShift 三态  
13. 无 prior = 基线  
14. 非法 prior 降级  
15. Job retry prior 一致  
16. 新会话 prior 清空  
17. `term_domain_tags` 多领域  
18. 句候选 ≤16  
19. ExtraResult 含 currentTurnDomains 到达 Web  
20. Scheduler 无领域业务逻辑  

---

## 14. Risk Register

| Risk | Level | Mitigation |
|------|-------|------------|
| Span 错切 / 跨界误合并 | High | 跨界仅完整词+penalty；默认域内 |
| 当前 prior 自增强 | High | Soft only；当前 Vote 可推翻；衰减 |
| 话题切换迟钝 | Med | 连续 turn + LLM topicShift 规则 |
| LLM 错误纠偏 | Med | 权重上限；不覆盖 currentTurnDomains |
| 多领域标签错 | Med | 坚持 term_domain_tags；禁 domains[0] |
| 候选膨胀 | High | 正式不重叠收口在 Generator |
| KenLM 压力 | Med | 不把消歧推后；保持 cap16 |
| Web 串话 | Med | session_id 绑定；新会话清空 |
| Retry 不一致 | Med | prior 进 job payload；与 attempt 绑定 |
| ExtraResult 丢字段 | **Critical** | 协议扩展为先决 |
| 日志不可回放 | Med | 结构化 priors/options；禁全文隐私 |

性能：LTR ≈ O(n × L) L≤5；跨界 +1 选项；prior 不应用「每 option × 每域 SQL」——一次召回 + tags；禁 Beam。LLM 保持非热路径。风险：**Medium**（协议+Generator）；硬上限沿用 `maxSqlPerUtterance=150`、cap16、L∈[2,5]、cross≤1。

---

## 15. Final Recommendation

```text
唯一方案:
1) 领域闭环优先落在 Node Session（finalize 写 currentTurnDomains → sessionDomainPriors → 下轮 domainPriors）；
   若产品要求 Web 持有，则先扩 ExtraResult/JobAssign，禁止双写；
2) 替换 FineSpan 为 LTR + soft boundary（复用 maxBoundaryCrossCount=1），正式 Span 不重叠，删全滑窗；
3) FineSpan 只消费统一 domainPriors（soft 排序/配额）；LLM 降为低频 calibration 输入同一 Merger；
4) Vote/Bucket/Cap/KenLM 冻结不动；禁止双链路 / 禁止挂 Context Prior stub 当决策旁路。
```

### 推荐开发顺序

```text
P0 选定 prior 存储：Node Session（默认）或 Web+协议（硬性要求时）
P1 Merger + domainPriors 消费钩子（无 LTR 时即可测 soft 排序开关）
P2 LTR FineSpan Generator + 删全滑窗
P3 LLM calibration 接入 merge；切断 profile→FW 隐式 prior
P4 诊断与回归（含 dialog_200 冻结重放）
```

### 推荐验收顺序

```text
透传往返 → 无 prior 基线回归 → soft boundary 用例 → 正式不重叠 → prior soft 效果
→ 错误 prior / 切换 / LLM 冲突 → cap16 / 性能 → 无双链路静态检查
```

---

## 16. Core Questions（强制回答）

1. **粗边界是否硬限制 FineSpan？** 生成层**不是**硬隔离（可 cross=1）；Vote/Assembly **按粗 Span 池**分组。目标 LTR soft 与现有 cross≤1 **兼容**。  
2. **正式 FineSpan 是否重叠？** **是**（全滑窗）。  
3. **谁解决重叠？** Compatibility + **Assembly**（被动补偿）。  
4. **可否最小改为 cursor 单向、正式不重叠？** **可以**（Compatibility Class B）。  
5. **Soft boundary 破坏 tone？** **PARTIAL**：跨界窗已用同一 `rawStart/rawEnd`→Tone extract；错位条件仍在，需在确认 Span 时重算。  
6. **JobResult 适合返回 currentTurnDomains？** Node extra **可以**；**Scheduler ExtraResult 当前不适合**（白名单）——必须扩展。  
7. **Web 有 prior 容器？** **无**现成 domain store；有 `sessionId`，可新建轻量环形缓冲。  
8. **Scheduler 无业务透传？** 目标可以；**现状会剥字段**，需改 schema 后保持零推理。  
9. **Recall 消费领域优先级？** 现有 **scope 过滤 / weak plan**；**无**正式 prior 权重排序 API → 需 soft 扩展。  
10. **重复 domain hint 字段？** 有：`retainedDomains`、`activeLexiconProfile`、`lexiconSessionIntent`、`enabledDomains`、`recallDomainScope`、`contextPrior*`（diag）。**无** `sessionDomainPriors`/`domainPriors`。  
11. **LLM 是否主导当前领域判断？** **不主导 Presence Vote**；**主导 Node session profile**。  
12. **LLM 如何收敛？** 输出 calibration → Web Merger → `domainPriors`；禁热路径、禁覆盖 currentTurnDomains。  
13. **Vote+LLM 合并 owner？** **唯一 Merger**（默认 **Node Session finalize**；Web 仅在协议打通且产品要求时）。禁止双写。  
14. **直接删除？** 全滑窗主链；FW 双 prior；禁止保留旧滑窗兜底。  
15. **开发前还需补充？** 选定 prior 存储（Node vs Web）；冻结 merge 系数；`topicShift` 是否由 Intent JSON 新增。  
16. **开发顺序？** 见 §15。  
17. **验收顺序？** 透传/Session 往返 → 无 prior 基线 → soft boundary → 正式不重叠 → prior soft → 切换/LLM → cap16 / 无双链路。

---

## 17. Fact / Inference / Open

| Kind | Items |
|------|-------|
| **已确认事实** | 全滑窗；cross≤1；Vote 按 coarse 池；ExtraResult 白名单剥 fw_detector；LLM Intent 异步；Context Prior diag-only；cap16；term_domain_tags→domains[] |
| **基于代码的推断** | Web 扩展环形缓冲可行；soft prior 放在 option 排序/配额最安全 |
| **开发前确认** | Intent JSON 是否增加 `topicShift`；merge 权重表；生产是否 100% 经 Scheduler（测试服 `/run-*` 可绕过 ExtraResult） |

---

```text
PRE-DEVELOPMENT AUDIT COMPLETE — NO CODE CHANGES
FW_Repair_V4_FineSpan_SoftBoundary_SessionDomainPrior_LLMCorrection
```

