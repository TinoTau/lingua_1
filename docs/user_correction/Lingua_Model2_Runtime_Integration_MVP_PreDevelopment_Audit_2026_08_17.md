# Lingua Model2 — Runtime Integration MVP Pre-Development Code Audit

> **SSOT STATUS (2026-09-12):** `SUPERSEDED_INSERTION_POINT`  
> Post-`activeCandidates` / post-PathFineSpan insertion described below is **historical**.  
> **CURRENT Model2 insertion SSOT** = Aug-12 pre-LexicalEdge  
> (`runLatticeFineSpanGenerationWithPreEdgeModel2` → `expandWindowsWithModel2`).  
> Host / PAction / relation / materialization engineering facts below remain valid.

**Date:** 2026-08-17  
**Type:** AUDIT ONLY — NO DEVELOPMENT / NO TRAINING / NO ARCHITECTURE CHANGE  
**Baseline:** `Lingua_Model2_Original_Design_Implementation_Completion_Audit_2026_08_17.md`  
**Artifacts:** `training/model2_v3/experiments/v3_runtime_integration_mvp_audit/`

---

## 0. Verdict (executive)

在**不改变冻结架构**的前提下，Model2 可以接线进现有 Node ASR 后处理主链；但今天**不能**宣称 production-ready runtime。

| 结论 | 值 |
|------|-----|
| Model2 Runtime Integration MVP Audit | **HOLD** |
| Frozen Architecture Conformance | **PASS** |
| Runtime Integration Skeleton before Stage J | **YES**（Stage P-only 单 checkpoint） |
| Unified ONE Model2 Runtime Checkpoint | **NO** |
| Stage J Required Before Final Runtime | **YES** |
| Shadow / Dual Model2 / Legacy fallback | **均禁止且不需要** |

**唯一合理插入点（HISTORICAL — SUPERSEDED 2026-09-12）：**  
`span-assembly-v4-orchestrator.ts` — `activeCandidates` 之后、`runDomainAwareAssembly` 之前（约 L300–323）。

**CURRENT SSOT 插入点：**  
`lattice-fine-span-runtime.ts` — `recallTopKForWindows` 之后、`buildLexicalEdges` 之前。

**下一阶段决策：**  
P0 接线 blocker（推理宿主 / Profile plumbing / relation→lexicon adapter）优先 →  
`MODEL2_RUNTIME_INTEGRATION_MVP_DEVELOPMENT`（skeleton + Stage P-only）  
或先做 `MODEL2_RUNTIME_CONTRACT_BLOCKER_FIX`（ONNX export + 稳定 hash）。  
**禁止**将 Stage P + Stage D 双 checkpoint 部署为最终 runtime。

---

## 1. Frozen architecture (unchanged)

```
FineSpan + UserProfile + retrieval state
        ↓
ONE Trainable Model2
        ↓
Retrieval Policy
        ↓
bounded deterministic retrieval primitives
        ↓
Lexicon / FuzzyPool (Node LexiconRuntimeV2)
        ↓
new candidates → merge/dedup
        ↓
existing DomainAwareAssembly
        ↓
existing KenLM / downstream
```

本轮未发现「必须改产品职责才能接线」的冲突。工程麻烦点全部落在 **adapter / inference / data completeness**，不是架构重写。

---

## 2. Current Node pipeline (code-traced)

完整逐步表见：`model2_runtime_current_pipeline.csv`

```
ASR (asr-step)
  → FW_SPAN_DETECTOR (pipeline-mode-fw / fw-detector-step / fw-detector-v4-path)
  → runSpanAssemblyV4Orchestrator
  → runLatticeFineSpanGeneration → PathFineSpan
  → recallTopKForWindows / recallSpanTopKV2 → WindowCandidate[]
  → materialize PathFineSpan.candidates
  → resolveCompatibilityRelations → activeCandidates
  → ★ MODEL2 INSERTION (MISSING TODAY)
  → runDomainAwareAssembly (SameDomain filter / vote / per-span budget)
  → sentence pool (≤ maxSentenceCandidates)
  → KenLM rerank/gate
  → apply → JobResult
```

| Step | File / Symbol | Ownership |
|------|---------------|-----------|
| FineSpan | `lattice-fine-span-runtime.ts` / `runLatticeFineSpanGeneration` | Lattice FineSpan |
| Base recall | `recall-span-topk-v2.ts` / LexiconRuntimeV2 | Lexicon |
| Compatibility | orchestrator + graph | Assembly prep |
| Assembly | `assemble-domain-aware-span-sets.ts` / `runDomainAwareAssembly` | DomainAwareAssembly |
| KenLM | `rerank-fw-sentences.ts` | KenLM |
| JobResult | result-builder | Cross-service transport only |

**Model2 不得改写：** ASR、FineSpan generator、DomainAwareAssembly、KenLM。

---

## 3. Exact insertion point (A)

**文件：**  
`electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts`

**位置：** L300 `activeCandidates = compatibility.activeCandidates` 之后；L323 `runDomainAwareAssembly(...)` 之前。

**理由：**

1. Base FineSpan recall 与 compatibility 已完成。  
2. 尚未进入 SameDomain hard filter / vote / per-span budget。  
3. Profile candidates 可按 `termId` merge 进同一 `activeCandidates`，再走**唯一** assembly 路径。  
4. 保持 ONE authoritative path；不引入 shadow pipeline。

**禁止的替代：** 重写 ASR / FineSpan / Assembly；或在 JobResult 上塞 Model2 内部字段。

---

## 4. FineSpan contract (B)

详见：`model2_runtime_finespan_contract.json`

| TRAINING_FIELD | RUNTIME_FIELD | MATCH | TRANSFORMATION_NEEDED | MISSING |
|----------------|---------------|-------|---------------------|---------|
| `span_id` | `PathFineSpan.spanId` / window ids | YES | NO | NO |
| `span_syllables` | coordinate / window syllables | SEMANTIC | YES_ADAPTER | NO |
| `window_text` | `GlobalWindowDescriptor.windowText` | PARTIAL | YES | NO |
| `window_pinyin_key` | `windowPinyinKey` | YES | NO | NO |
| span boundaries | `syllableStart/End`, `rawStart/End` | YES | NO | NO |
| `hash_span` features | runtime 重算 | N/A | **YES_STABLE_HASH** | NO |

**Verdict:** **PARTIAL** — 允许 **minimal adapter**，不得重新定义 FineSpan。

**Export risk：** `training/model2_v3/policy/model.py` 的 `hash_span` 使用 Python `hash()`，跨进程不稳定；ONNX/跨语言前必须换稳定 hash（本轮不改代码）。

---

## 5. UserProfile runtime contract (C / D)

详见：`model2_runtime_userprofile_contract.json`

### 真实路径

```
UserProfileV1 (api-gateway user_profile.rs)
  → SessionBootstrap
  → node-agent-simple.sessionUserProfiles Map
  → getSessionUserProfile(sessionId)
```

| 项 | 状态 |
|----|------|
| session key | `session_id`（Map key） |
| profile payload | `UserProfileV1`（schema_version, profile_version, phonetic_bias, …） |
| missing profile | **必须** Model2 no-op → 继续 base recall（不是 fallback path） |
| 今日消费方 | **无** — `getSessionUserProfile` 未被 FW / span-assembly 调用 |

### Model2 所需输入 vs 可用性

| 输入 | Runtime 可用性 |
|------|----------------|
| pronunciation / phonetic_bias | **PARTIAL** — ProfileDelta `phonetic_updates` 真实写回 |
| personal/common terms | **PARTIAL** — schema 有；写回不完整 |
| long-term domain evidence | **NOT_AVAILABLE_YET** 作为预计算字段（可从 personal_terms + `term_domain_tags` 派生，本轮不设计） |
| session domain prior | **NOT_IMPLEMENTED** for Model2（仅有 JobAssign `domainPriors` soft quota） |
| speaking habit | **NOT_AVAILABLE_YET** |

**构造方式（开发期）：**  
orchestrator 收到可选 `UserProfile`；缺失 → skip；存在 → FineSpan + compact profile features → Model2 → actions → Node lexicon queries。

---

## 6. Profile missing / failure semantics (H / §28–29)

| 条件 | 正确行为 |
|------|----------|
| UserProfile unavailable | Model2 **no-op**；base FineSpan recall 继续 |
| checkpoint missing / load fail | log + 禁用 Model2（process/session）+ base only |
| inference fail / bad profile | log + skip expansion + base only |

**分类：** graceful optional expansion failure。  
**禁止：** abort ASR；Stage A/B；deterministic-only Model2；shadow / dual path。

详见：`model2_runtime_failure_semantics.json`

---

## 7. Model2 V3 artifacts & Stage P/D deployability (E / §9–10 / §25)

详见：`model2_runtime_model_artifact_audit.json`、`model2_runtime_stage_p_d_deployability.json`

| Capability | Checkpoint | Input runtime? | Export ready? | Adapter? | Real user data? | Deployable today? |
|------------|------------|----------------|---------------|----------|-----------------|-------------------|
| Stage P pronunciation | `stage_p_checkpoint.pt` | PARTIAL | NO | NO | PARTIAL (phonetic) | **NO** |
| Stage D lexical/domain | `stage_d` / `stage_d2` `.pt` | WEAK | NO | NO | SYNTHETIC train | **NO** |

| 问题 | 答案 |
|------|------|
| A. Runtime MVP 可先接 Stage P-only？ | **YES**（skeleton；单 weight 文件 = ONE Model2 子集） |
| B. 可否接 shared V3 + Stage D head 作为双 runtime？ | **NO** — 禁止 P+D 两实例并行 |
| C. 必须 Stage J 才算最终 ONE Model2？ | **YES** |

**标签：**  
允许开发 → `RUNTIME_INTEGRATION_SKELETON_READY`  
**不是** → `MODEL2_RUNTIME_COMPLETE`

---

## 8. Inference deployment (E / §11–12)

| 问题 | 答案 |
|------|------|
| Node 能否直接加载 PyTorch `.pt`？ | **NO** |
| 现有模式 | Piper/LID **ONNX**；Whisper/Piper **Python microservice**；Lexicon **in-process SQLite** |
| 推荐 | **优先** ONNX in-process（export 后）；或**复用已批准**的 Python sidecar 模式 |
| 新建独立 Model2 HTTP 微服务？ | **默认 NO**；无架构批准不得新建 |
| Weights lifecycle | process-level **singleton** |
| UserProfile | session/user **input**，不得编译成每用户 checkpoint |

ONNX 可行性（审计 only）：固定 shape / `MAX_PROFILE_ITEMS` 可行；blocker = 不稳定 `hash()`、无 export 脚本；FuzzyPool/lexicon **不在** ONNX 内。

---

## 9. Policy output contract (F / §14)

真实 `RetrievalPolicyV3.forward` 输出（`training/model2_v3/policy/model.py`）：

| MODEL_OUTPUT_FIELD | SEMANTICS | CONSUMER | RUNTIME_ACTION |
|--------------------|-----------|----------|----------------|
| `action_logits` | pronunciation relation actions | `select_actions` | 选有界 relation transforms |
| `query_budget_logits` | query budget class | `select_actions` | 限制 profile 查询次数 |
| `cand_budget_logits` | candidate budget class | optional | 限制 profile 候选数 |
| `domain_action_logits` | domain soft branch / `domain_none` | `select_domain_actions` | **DEFER** 至 Stage J 或单文件含 D-head；不得双模型 |

**禁止**为方便 runtime 发明模型当前没有的输出。

---

## 10. Policy → deterministic primitives (F / §15–16)

详见：`model2_runtime_retrieval_primitive_audit.json`

| Primitive | 分类 |
|-----------|------|
| `LexiconRuntimeV2.recallSpanTopKV2` / SQLite | **RUNTIME_READY**（权威） |
| `term_domain_tags` JOIN + `mergeDomainTierRows` | **RUNTIME_READY** |
| Python `execute_action` / FuzzyPool / `soft_domain_retrieve` | **TRAIN_ONLY** |
| Node phonetic relation → alternate pinyin query | **MISSING**（需 port/adapter） |
| Model2 inference host + feature pack + merge | **MISSING** |

**ONE retrieval primitive 原则：**  
Base recall 与 Profile recall 必须共用 Node Lexicon 查询实现；**禁止**长期并存 Python FuzzyPool 与 Node 两套 fuzzy 逻辑。

---

## 11. Candidate introduction / merge / provenance (G / H / I / §17–19)

详见：`model2_runtime_candidate_contract.json`、`model2_runtime_merge_dedup_audit.json`

| 项 | 结论 |
|----|------|
| 权威内部类型 | **`WindowCandidate`**（`v4-types.ts`） |
| 所需字段 | `termId`, `replacement`, `domains[]`, `source` / `recallSource`, span 绑定, score |
| 平行 Candidate 类型 | **禁止新建** |
| Merge key | **`termId`**（优先） |
| Merge 位置 | 并入 `activeCandidates` 后进入**唯一** `runDomainAwareAssembly` |
| Provenance | **PROVENANCE_GAP** — 无 `BASE_FUZZY` / `PROFILE_RETRIEVAL`；建议对 `recallSource`/`source` 做 **contract delta**（不改业务结构） |

**Domain metadata：** 新候选应从 Node Lexicon hit 的 `HotwordEntry.domains` 完整拷贝（已是 multi-tag 聚合），不得 `domains[0]` 投影。

---

## 12. Budget ownership (§20)

详见：`model2_runtime_budget_ownership.json`

| Budget | Owner | 典型值 | Meaning |
|--------|-------|--------|---------|
| exactTopK / window recall | Lexicon V4_LIMITS | ~2 | base recall |
| per-span assembly | DomainAwareAssembly | 8/6/4 | span cap |
| maxSentenceCandidates | FW/KenLM | 16 | sentence pool |
| Model2 `query_budget` | Model2 policy | 1..8 | **仅** profile 查询 |
| Model2 `cand_budget` | Model2 policy | class | **仅** profile 扩展 |

**禁止** Model2 偷偷改 sentence-level frozen cap。

**PER_SPAN_PROFILE_SCAN_RISK：** 若每个 FineSpan 扫描完整 personal_terms（≤500），有风险；MVP 需要 **bounded compact profile representation**（本轮不重设计，仅确认需要预计算/截断字段）。

---

## 13. Multi-tag CandidateIndex — P0 (§21)

详见：`model2_runtime_multitag_ssot_audit.json`

| 路径 | 结论 |
|------|------|
| Training `build_candidate_index_from_sqlite` (`domain_ids=[row["domain_id"]]`) | **FAIL**（train index 丢 multi-tag） |
| Node `mergeDomainTierRows` + `term_domain_tags` JOIN | **PASS**（完整 `domains[]`） |

**Runtime Integration 判定：**

- `P0_RUNTIME_SSOT_DEFECT`（Node Lexicon）= **NO**  
- 若 Model2 仍走 Python CandidateIndex = **YES（P0）**  
- **MVP 必须复用 Node LexiconRuntimeV2**，不得把 train CandidateIndex 当 runtime SSOT。

抽查依据：Node 对同一 `word|pinyin_key` 聚合全部 `domain_id`（`mergeDomainTierRows` L88–94）；`queryDomainMultiRowsAtomic` 明确保证 in-scope tags 完整性。

---

## 14. Domain soft prior interaction (§22)

Model2 domain action **只能** boost / prioritize / select retrieval branch，**不能** hard exclude。

**Interaction risk（不改本轮）：**  
`filterDomainCandidatesPerSpan` / SameDomain bucket 可能丢弃跨域 PROFILE `domain_term` 候选。KenLM / 既有 domain gate 属原系统职责 — **只报告风险**，不修改。

---

## 15. Session domain prior (§23)

详见：`model2_runtime_session_prior_audit.json`

| 项 | 状态 |
|----|------|
| Model2 `session_domain_prior` 正式 runtime 字段 | **NOT_IMPLEMENTED**（`G3_RUNTIME_GAP`） |
| 现有 | `JobAssign.domainPriors` → soft quota（非 Model2 input） |
| 生产 synthetic | **禁止** |

---

## 16. Manual correction writeback (§24)

| 数据 | 状态 |
|------|------|
| `phonetic_updates` → Stage P | **PARTIAL / READY enough for skeleton** |
| `personal_term_updates` | **PARTIAL** |
| `domain_updates` | **空 vec**（CorrectionEvent 无 domain）→ Stage D runtime **PARTIAL / 不足** |

不得因 Stage D 合成训练数据假装真实 profile 已有 lexical/domain 证据。

---

## 17. JobResult / cross-service (§26–27)

- Model2 内部用专用类型：FineSpan / PolicyInput / PolicyOutput / ProfileCandidate（或复用 `WindowCandidate`）。  
- **禁止**先把 Model2 fields 塞进 JobResult。  
- 优先 Node **内部** FineSpan → Model2 → Lexicon → merge。  
- 仅当无法 in-process 时才解释 sidecar；默认 **不新建** microservice / HTTP / IPC。

---

## 18. Performance / concurrency / observability (§30–32)

详见：`model2_runtime_performance_budget.json`

| 项 | 估计 |
|----|------|
| P50 delta | ~+2–15 ms（ONNX in-process + 少量 lexicon query）；IPC 更高 |
| P95 | 主要受额外 lexicon query 主导 |
| 约束 | 不改 FineSpan 数量 / sentence budget / assembly 换性能 |
| Cache | 复用现有 utterance query cache / SQLite batch；不新建 worker pool |

**最少 diagnostics（非门控）：**  
`model2_invoked`, `profile_available`, `selected_actions`, `profile_query_count`, `profile_candidate_count`, `introduced_term_ids`, `latency`

---

## 19. Acceptance plan (§33–34)

详见：`model2_runtime_acceptance_plan.json`

必须走 **真实 Node path**（SessionBootstrap/profile loader + FineSpan + Lexicon + merge）。  
**禁止**用 training Python harness 宣称 runtime PASS。

A–H：PROFILE_TARGET_ABSENT / EMPTY_PROFILE / WRONG_PROFILE / MULTI_RELATION / PERSONAL_DOMAIN / MULTI_TAG / MODEL_LOAD_FAIL / NO_SHADOW_PATH。

---

## 20. Architecture conformance (§35)

| Check | Expected | Today / Plan |
|-------|----------|--------------|
| FineSpan authoritative | YES | YES |
| UserProfile actual runtime input | YES | **NO today → YES required** |
| Trainable Model2 authoritative | YES | YES required |
| Whole utterance Model2 | NO | NO |
| Deterministic-only replacement | NO | NO |
| Profile candidate introduction | YES | YES required |
| Existing Lexicon reused | YES | YES |
| Existing assembly reused | YES | YES |
| Stage A active | NO | NO |
| Stage B active | NO | NO |
| Shadow fallback | NO | NO |
| Second Model2 path | NO | NO |

详见：`architecture_conformance_check.json`

---

## 21. KEEP / MODIFY / ADD / DELETE / DEFER (§36)

详见：`model2_runtime_keep_modify_add_delete_defer.csv`

| Action | Items |
|--------|-------|
| **KEEP** | PathFineSpan；UserProfileV1+SessionBootstrap；LexiconRuntimeV2；DomainAwareAssembly；KenLM；Stage P train artifact |
| **MODIFY** | orchestrator 插入点；NodeAgent→FW profile plumbing；可选 provenance contract delta |
| **ADD** | Model2 adapter + inference host；Node relation→query；acceptance A–H |
| **DELETE** | MVP 无（尚无 shadow 可删） |
| **DEFER** | Stage J；Stage D prod；H/Tone/50k；Wrong/Swapped selectivity；Python CandidateIndex multi-tag（若用 Node lexicon） |

目标文件清单：`model2_runtime_target_file_inventory.csv`

---

## 22. Answers A–J (audit goals)

| # | Answer |
|---|--------|
| **A** | `span-assembly-v4-orchestrator.ts`：`activeCandidates` 后、`runDomainAwareAssembly` 前 |
| **B** | Runtime：`PathFineSpan` + `GlobalWindowDescriptor` + `WindowCandidate`；与 train `FineSpanView` 语义对齐，需 minimal adapter |
| **C** | `sessionUserProfiles` Map + `getSessionUserProfile(sessionId)`；**未**传入 FW |
| **D** | FineSpan adapter features + compact UserProfile（phonetic/personal…）；缺字段标 NOT_AVAILABLE_YET，禁止 synthetic 生产 |
| **E** | `.pt` 不可直用；ONNX in-process 或批准 sidecar；skeleton 用 **Stage P-only 单文件**；最终需 Stage J |
| **F** | Policy actions → Node relation adapter → **同一** `recallSpanTopKV2` |
| **G** | 产出 `WindowCandidate`，merge 进 `activeCandidates` |
| **H** | 单次 merge by `termId`，再进唯一 assembly；不二次独立 dedup 链 |
| **I** | 从 Lexicon hit 拷贝完整 `domains[]`；provenance contract delta |
| **J** | 仅一条主链；profile 模块 no-op ≠ shadow；禁止双 Model2 |

---

## 23. Artifact index

全部位于：`training/model2_v3/experiments/v3_runtime_integration_mvp_audit/`

- `model2_runtime_current_pipeline.csv`
- `model2_runtime_insertion_point_audit.json`
- `model2_runtime_finespan_contract.json`
- `model2_runtime_userprofile_contract.json`
- `model2_runtime_model_artifact_audit.json`
- `model2_runtime_stage_p_d_deployability.json`
- `model2_runtime_policy_output_contract.json`
- `model2_runtime_retrieval_primitive_audit.json`
- `model2_runtime_candidate_contract.json`
- `model2_runtime_merge_dedup_audit.json`
- `model2_runtime_budget_ownership.json`
- `model2_runtime_multitag_ssot_audit.json`
- `model2_runtime_session_prior_audit.json`
- `model2_runtime_failure_semantics.json`
- `model2_runtime_performance_budget.json`
- `model2_runtime_acceptance_plan.json`
- `model2_runtime_target_file_inventory.csv`
- `model2_runtime_keep_modify_add_delete_defer.csv`
- `architecture_conformance_check.json`
- `go_summary.json`

---

## 24. FINAL VERDICT

```
Model2 Runtime Integration MVP Audit:
HOLD

Frozen Architecture Conformance:
PASS

Exact Runtime Insertion Point:
electron_node/.../span-assembly-v4-orchestrator.ts
after activeCandidates (L300) before runDomainAwareAssembly (L323)

FineSpan Runtime Contract:
PARTIAL

UserProfile Runtime Contract:
PARTIAL

Stage P Runtime Deployability:
PARTIAL

Stage D Runtime Deployability:
BLOCKED

Unified ONE Model2 Runtime Checkpoint Exists:
NO

Stage J Required Before Final Runtime:
YES

Runtime Integration Skeleton Can Be Developed Before Stage J:
YES

Model Inference Deployment Mechanism:
ONNX in-process preferred after export; else architecture-approved existing Python sidecar — NOT dual Model2; .pt not Node-native

New Microservice Required:
NO

Candidate Introduction Path:
PARTIAL

Merge/Dedup:
PARTIAL

CandidateIndex MultiTag:
FAIL (training builder) / PASS (Node LexiconRuntimeV2)

MultiTag Runtime Defect:
NO (when Node Lexicon reused)

Session Domain Prior:
NOT_IMPLEMENTED

Manual Correction Pronunciation Data:
PARTIAL

Manual Correction Lexical/Domain Data:
PARTIAL

Estimated Runtime Cost:
P50 ~+2–15ms in-process policy + few lexicon queries (measure on Node); P95 lexicon-query dominated; do not change sentence cap

Shadow Path Required:
NO

Compatibility Fallback Required:
NO

Legacy Model2 Required:
NO

P0 Runtime Blockers:
1. Model2 inference host missing (PyTorch .pt not loadable by Node)
2. UserProfile not passed from NodeAgent into FW/span-assembly
3. Phonetic relation transform + profile query adapter missing on Node (Python execute_action/FuzzyPool is TRAIN_ONLY)

P1 Blockers:
1. No Stage J unified checkpoint for final ONE Model2 P+D policy
2. Stage D real lexical/domain writeback incomplete; session_domain_prior G3 gap
3. SameDomain hard filter may drop soft-prior cross-domain profile candidates (interaction risk)
4. PROVENANCE_GAP for PROFILE_RETRIEVAL vs base
5. Python hash_span unstable for ONNX/cross-runtime export

KEEP:
PathFineSpan; UserProfile SSOT + SessionBootstrap; LexiconRuntimeV2; DomainAwareAssembly; KenLM; Stage P frozen train artifact

MODIFY:
span-assembly-v4-orchestrator insertion; NodeAgent→FW profile plumbing; optional WindowCandidate provenance contract delta

ADD:
Model2 runtime adapter + singleton inference host; Node relation→lexicon query adapter; real-path acceptance tests A–H

DELETE:
none in MVP (no shadow path present to remove)

DEFER:
Stage J; Stage D production deploy; Stage H / Tone / 50k; Wrong/Swapped budget selectivity; Python CandidateIndex multi-tag fix if Node lexicon is SSOT

Recommended Next Development Phase:
MODEL2_RUNTIME_INTEGRATION_MVP_DEVELOPMENT
  — skeleton + Stage P-only single checkpoint wiring at insertion point
  — after/with P0 inference host + profile plumbing + relation adapter
OR MODEL2_RUNTIME_CONTRACT_BLOCKER_FIX first if ONNX export + stable hash are treated as explicit prep gates
Label eligible: RUNTIME_INTEGRATION_SKELETON_READY — not MODEL2_RUNTIME_COMPLETE
Never deploy Stage P + Stage D as two parallel runtime models.
```

---

**Governance note:** 未因「接线麻烦」提议 deterministic-only、Stage A/B 恢复、whole-utterance、绕开 UserProfile/FineSpan、或双 Model2。产品职责冻结；工程 blocker 已逐条列出。
