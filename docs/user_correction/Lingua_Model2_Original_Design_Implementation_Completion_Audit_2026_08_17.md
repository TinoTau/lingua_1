# Lingua Model2 — Original Design Implementation & Completion Acceptance Audit

**Date:** 2026-08-17  
**Type:** READ-ONLY AUDIT — NO DEVELOPMENT / NO TRAINING / NO FIX  
**Authority order:** P0 user-confirmed product intent → P1 refinements → P2 frozen contracts → P3 reports → P4 code  

**Supporting artifacts:** `training/model2_v3/experiments/v3_original_design_audit/`

---

## 0. Audit rule applied

本轮不问「指标还能不能再涨」，只问：

> 用户最初确认的 Model2，现在有没有被完整实现？

结论先给：

**ORIGINAL DESIGN = PARTIAL**

- 训练实验栈（尤其 Stage P）**局部成功**  
- **生产 runtime 主链未接通**  
- Stage P + Stage D **尚未**成为 ONE Model2 unified policy（Stage J 必要）  

测试 PASS ≠ Runtime IMPLEMENTED。不得用当前代码反向改写原始职责。

---

## 1. Original product intent (baseline)

Model2 是：

**TRAINABLE · USER-CONDITIONED · FINESPAN-LEVEL · CANDIDATE RECALL / RETRIEVAL POLICY**

目的：在不同用户长期参数下，于当前 FineSpan 上扩大 ASR/Base 未给出的候选，并控制 query/cost/scalability。

Model2 **不是**：ASR reranker-only、closed-set term classifier、词记忆模型、整句纠错模型、pronunciation-only / domain-only 独立模型、确定性规则引擎、第二套 ASR、直接生成最终句子的模型。

权威意图来源：

- `docs/user_correction/Lingua_Model2_User_Correction_Design_and_Audit_Prompts_2026_08_11.md`
- `training/model2_v3/contracts/model2_v3_trainable_retrieval_policy_contract.md`（现行架构 ID：`FINESPAN_USERPROFILE_TRAINABLE_RETRIEVAL_POLICY`）

---

## 2. Design evolution timeline (summary)

| Phase | Status |
|-------|--------|
| 08-11 产品意图 + UserProfile/Correction 所有权 | **ACTIVE** |
| 08-12 Hybrid 池内排序 / Stage A–B closed-set | **SUPERSEDED / ARCHIVED**（相对「引入缺失候选」） |
| 08-16 V2 deterministic-only / neural-not-needed | **SUPERSEDED**（`decision_record_supersede_v2_neural_not_needed.md`） |
| 08-16 V3 trainable retrieval policy | **ACTIVE** |
| Stage P FROZEN | **ACTIVE (train artifact)** |
| Stage D / D2 | **ACTIVE / HARDENING** |
| Stage J | **NOT_READY** |
| Tone / Node / 50k / speaking habit | **HOLD / DEFERRED** |

完整表：`model2_design_evolution_timeline.csv`

---

## 3. End-to-end trace (core finding)

```
[RUNTIME ACTIVE]
Correction → ProfileDelta → UserProfile SSOT → SessionBootstrap → Node sessionUserProfiles Map
        ✕ BREAK: profile never consumed by Model2

[TRAIN/TEST ONLY]
UserProfile features → RetrievalPolicyV3 → actions → FuzzyPool → new term_ids
        ✕ BREAK: not merged into Node sentence assembly

[RUNTIME ACTIVE — independent of Model2]
PathFineSpan → lexicon recall → DomainAwareAssembly → KenLM → JobResult
```

完整逐步表：`model2_end_to_end_trace.csv`

### Critical code evidence

| Hop | Evidence |
|-----|----------|
| Correction → phonetic ProfileDelta | `central_server/scheduler/.../profile_delta.rs` — `phonetic_updates` 有；`domain_updates: vec![]`；`tone_updates: vec![]` |
| UserProfile SSOT | `central_server/api-gateway/src/user_profile.rs` — `UserProfileV1` |
| Node cache only | `electron_node/.../node-agent-simple.ts` — `sessionUserProfiles` / `getSessionUserProfile`；**无下游调用** |
| Model2 in Node | `electron_node` 对 `RetrievalPolicyV3` / `model2_v3` / `FuzzyPool`：**0 hits** |
| Train Model2 | `training/model2_v3/policy/model.py` — `RetrievalPolicyV3` |

---

## 4. Requirement matrix (R1–R28) — condensed

每项分四态：CODE / TRAIN / TEST / RUNTIME。完整 CSV：`model2_original_design_requirement_matrix.csv`

| ID | Overall | One-line |
|----|---------|----------|
| R1 FineSpan | **PARTIAL** | 训练权威 FineSpan；Node PathFineSpan 存在但未接 Model2 |
| R2 UserProfile→Model2 input | **PARTIAL** | 训练编码有；runtime 未消费 |
| R3 SameSpanDifferentUser | **PARTIAL** | 训练/测试 PASS；无 runtime |
| R4 Pronunciation Stage P | **PARTIAL** | FROZEN 训练；未部署 |
| R5 Trainable policy ownership | **PARTIAL** | 合同 ACTIVE；runtime 无 |
| R6 Personal terms | **PARTIAL** | Schema RUNTIME；真实写回/训练多为合成 |
| R7 Lexical→domain via tags | **PARTIAL** | 训练 `derive_domain_evidence`；无 runtime Model2 |
| R8 Multi-domain | **PARTIAL** | SSOT+D2 enrich PASS；默认 `CandidateIndex` 仍单 tag 丢失风险 |
| R9 Soft domain prior | **IMPLEMENTED**（Model2 路径） | `hard_filter: false`；KenLM hard_gate 是另一系统 |
| R10 Long-term vs session | **PARTIAL** | `session_domain_prior` 仅训练字段 |
| R11 Trainable core | **PARTIAL** | 合同要求 ACTIVE；runtime 未部署 |
| R12 Learns search not term_id | **PARTIAL** | V3 action heads；Stage A 已归档 |
| R13 Introduce new candidates | **PARTIAL** | 训练/测试能；生产 merge **MISSING** |
| R14 Lexicon owns identity | **IMPLEMENTED**（V3 合同） | |
| R15 Bounded performance | **PARTIAL** | 训练有 budget；无 runtime |
| R16 Profile scale | **PARTIAL** | 32KiB + top-32；写时压缩未完全生产化 |
| R17 Multi-param combination | **PARTIAL** | P/D 分头；未联合 |
| R18 ONE Model2 | **PARTIAL** | 目标合同有；统一训练策略未完成 |
| R19 Speaking habit | **DEFERRED_BY_DATA** | `DEFERRED_BY_SCHEMA` |
| R20 Correction→UserProfile | **PARTIAL** | 发音有；domain/lexical 弱 |
| R21 Adaptation loop | **PARTIAL** | 写半截；Model2 读断裂 |
| R22 Profile versioning | **PARTIAL** | 有版本/bootstrap；Model2 不用 |
| R23 Runtime integration | **NOT_IMPLEMENTED** | **最高优先级缺口** |
| R24 Downstream ownership | **IMPLEMENTED** | Model2 未侵占 assembly |
| R25 Legacy paths | **PARTIAL** | 训练残留；Node 不调 Model2 旧路径 |
| R26 JobResult boundary | **IMPLEMENTED** | SessionBootstrap ≠ JobResult |
| R27 Domain SSOT | **PARTIAL** | tags SSOT；index 构建仍有漂移风险 |
| R28 Parameter ownership | **PARTIAL** | 见 ownership CSV |

---

## 5. Training stages vs product features

| | TRAINED | VALIDATED | RUNTIME | UNIFIED |
|--|---------|-----------|---------|---------|
| Pronunciation | YES (P FROZEN) | YES | NO | NO |
| Lexical/Domain | YES (D/D2 synth) | YES synth | NO | NO |
| Speaking habit | NO | NO | NO | NO |
| Budget | YES | YES | NO | NO |
| Multi-relation | YES | YES | NO | NO |
| Cross-domain | YES D2 | YES | NO | NO |

**Stage P PASS ≠ Unified Model2 PASS。**

---

## 6. Stage J / Stage H

| Question | Answer |
|----------|--------|
| STAGE_J_REQUIRED_FOR_ORIGINAL_DESIGN | **YES** — P 与 D 仍为分离 head/checkpoint；原始 ONE Model2 unified policy 未完成 |
| Stage H required for FULL original design | **YES**（speaking habit） |
| Stage H blocks CORE MVP | **NO** — 标 `DEFERRED_BY_DATA`，不阻塞 runtime MVP |

---

## 7. Gap inventory

| Class | Count | Examples |
|-------|-------|----------|
| G0 Architecture drift | 2 | 历史 closed-set 主线（已合同纠正）；CandidateIndex multi-tag 丢失（OPEN） |
| G1 Missing core | 3 | Runtime Model2；候选回流；Profile 未消费 |
| G2 Staged not unified | 1 | Stage J 未做 |
| G3 Runtime integration | 2 | Train-only capabilities；session prior |
| G4 Data | 2 | 合成 Stage D；speaking habit |
| G5 Quality | 1 | Wrong/Swapped budget selectivity（**KNOWN_SECONDARY / DEFERRED**） |
| G6 Secondary | 1 | 指标打磨 |

完整：`model2_gap_inventory.csv`

---

## 8. KEEP / MODIFY / RESTORE / DELETE / DEFER（建议，本轮不改代码）

**KEEP**

- FineSpan 作为检索权威单位（合同）
- Trainable Model2 = retrieval policy（V3）
- UserProfile Gateway SSOT ≤32KiB
- `term_domain_tags` domain SSOT
- Stage P frozen training checkpoint（训练产物）
- SessionBootstrap 与 JobResult 隔离
- Soft domain prior（非 hard gate）设计

**MODIFY（需 Architecture/工程提案后）**

- `build_candidate_index_from_sqlite` multi-tag 重聚合（对齐 SSOT）
- Node：消费 UserProfile → Model2 → merge
- Correction → personal_terms / domain evidence 写回强度

**RESTORE**

- 无需恢复 Stage A/B 作产品主能力

**DELETE（建议，勿本轮执行）**

- 误导性 V2「neural not needed」产品叙事残留（已有 SUPERSEDED 指针）

**DEFER**

- Stage H speaking habit（数据）
- Tone / 50k
- Wrong/Swapped budget selectivity（G5 secondary）
- Stage J（在 D2 FROZEN + runtime MVP 规划清晰后）

---

## 9. Next development target list (directions only)

| Pri | Gap | Why | Next action (do not implement this audit) |
|-----|-----|-----|-------------------------------------------|
| P0 | G1-1/R23 | 无 runtime Model2 | Runtime integration MVP |
| P0 | G1-3/R2 | Profile 缓存未用 | Wire `getSessionUserProfile` → Model2 features |
| P0 | G1-2/R13 | 无法引入生产新候选 | Policy → Lexicon → merge |
| P1 | G2-1/R18 | 非统一 policy | Stage J after D2 freeze |
| P1 | G0-2/R8 | SSOT 传播 | Fix CandidateIndex multi-tag |
| P2 | G3-2/R10 | session prior | Schema ownership |
| P2 | G4-1/R20 | 适应闭环 | Real correction→lexical/domain |
| P3 | G5-1 | 质量 | Wrong budget selectivity |
| P3 | G4-2/R19 | 完整设计 | Speaking habit when data |

---

## 10. Completion levels

| Dimension | Judgment |
|-----------|----------|
| A Architecture completion | **~75%** — 职责有位置与冻结合同 |
| B Training completion | **~55%** — P 冻结；D 合成 hardening；J/H 未完成 |
| C Runtime completion | **~15%** — Profile 基础设施有；Model2 推理/回流无 |
| D User-adaptation loop | **~40%** — 发音写回有；Model2 消费无 |
| E Full original design | **PARTIAL (~35–45%)** |

禁止汇总成单一「90% complete」。

---

## Final Verdict

```
Model2 Original Design Audit:
PARTIAL

Architecture Conformance:
PARTIAL

Architecture Completion:
~75% (slots + frozen contracts)

Training Completion:
~55% (Stage P FROZEN; Stage D/D2 synthetic HARDENING; J/H incomplete)

Runtime Completion:
~15% (UserProfile plumbing without Model2)

User Adaptation Loop Completion:
~40% (phonetic writeback; no Model2 consume)

Full Original Design Completion:
PARTIAL (~35–45% end-to-end product)

FineSpan Authoritative:
YES (contract/train) / PARTIAL (runtime unwired to Model2)

Trainable Core Authoritative:
YES (contract) / NO (runtime)

UserProfile Real Model Input:
PARTIAL

Pronunciation Profile:
PARTIAL

Multi-Relation:
PARTIAL

Personal/Common Terms:
PARTIAL

Lexical → Domain Prior:
PARTIAL

Multi-Domain:
PARTIAL

Long-Term Domain Prior:
PARTIAL

Session Domain Prior:
NOT_IMPLEMENTED

Speaking Habit:
DEFERRED_BY_DATA

Manual Correction → UserProfile:
PARTIAL

UserProfile → Runtime Model2:
NOT_IMPLEMENTED

Model2 → New Candidate Recall:
PARTIAL (train/test only)

One Unified Model2:
PARTIAL (target contract yes; unified trained policy no)

Stage P:
FROZEN

Stage D:
HARDENING

Stage J Required:
YES

Stage H Required For Full Original Design:
YES

Legacy Active Paths:
No Model2 legacy on Node; Stage A/B train artifacts only; KenLM hard_gate is separate

Architecture Drift Findings:
1) Historical closed-set Stage A as Model2 core (SUPERSEDED in contract)
2) V2 neural-not-needed (SUPERSEDED)
3) CandidateIndex single-tag flatten vs term_domain_tags multi-tag (OPEN)
4) Treating train PASS as runtime completion would be reinterpretation — FORBIDDEN

G0 Count:
2

G1 Count:
3

G2 Count:
1

G3 Count:
2

G4 Count:
2

G5 Count:
1

G6 Count:
1

Highest-Priority Missing Original Capability:
RUNTIME: FineSpan + UserProfile → ONE Model2 retrieval policy → Lexicon → introduce missing candidates → merge

Known Secondary Issue:
WRONG_SWAPPED_DOMAIN_CANDIDATE_BUDGET_SELECTIVITY

Known Secondary Issue Priority:
DEFERRED

Recommended Next Development Phase:
MODEL2_RUNTIME_INTEGRATION_MVP (close G1), then complete Stage D2 freeze + Stage J (G2). Do not start Stage J solely because train metrics look good while runtime loop is broken.
```

---

## Artifact index

| File |
|------|
| `training/model2_v3/experiments/v3_original_design_audit/model2_original_design_requirement_matrix.csv` |
| `.../model2_design_evolution_timeline.csv` |
| `.../model2_end_to_end_trace.csv` |
| `.../model2_userprofile_parameter_ownership.csv` |
| `.../model2_training_vs_runtime_matrix.csv` |
| `.../model2_legacy_path_inventory.csv` |
| `.../model2_gap_inventory.csv` |
| `.../model2_next_target_list.csv` |
| `.../model2_architecture_conformance.json` |
| `.../model2_completion_summary.json` |
| This report: `docs/user_correction/Lingua_Model2_Original_Design_Implementation_Completion_Audit_2026_08_17.md` |
