# Lingua User Correction + Model2 — Phase 3 Normalization / ProfileDelta / TrainingSample Report

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Nature | **CORRECTION NORMALIZATION + PROFILEDELTA + TRAININGSAMPLE CONTRACT** |
| Based on | `Lingua_User_Correction_Model2_Phase2_Manual_Correction_Development_Report_2026_08_11.md` |
| Verdict | **PASS_WITH_KNOWN_DEFERRED** |

---

## 1. Executive Summary

Phase 3 建立了从不可变 `CorrectionEvent` 到确定性派生数据的处理链：

```text
CorrectionEvent (fact SSOT)
  → CorrectionNormalizer (corr-normalizer-v1)
  → NormalizedCorrection + CorrectionSpan[]
  → CorrectionFeatureExtractor (corr-feature-extractor-v1)
  → CorrectionFeatures
  → ProfileDeltaBuilder
  → ProfileDelta V1
  → Gateway apply (UserProfile SSOT, ≤32KiB, Top-K terms)
并行：
  → TrainingSampleBuilder → TrainingSample V1 (rebuildable, not SSOT)
```

未训练 Model2、未改 Node ASR、未引入 LLM/embedding、未伪造 acoustic tone / domain。

---

## 2. Phase 2 Preconditions Verification

| Phase 2 能力 | 状态 |
|--------------|------|
| Browser → Gateway → Scheduler correction | 保持 |
| CorrectionEvent 不可变事实 | 保持 |
| ProfileDelta = null | **升级为本轮派生非空（可空字段）** |
| JobResult / Node pipeline | 未改 |

---

## 3. Architecture Before / After

### Before

```text
CorrectionEvent → SQLite
profile_delta = null
```

### After

```text
CorrectionEvent → SQLite (unchanged fact)
       ↓ derived
NormalizedCorrection / Features / ProfileDelta / TrainingSample
       ↓
Gateway apply_profile_delta → UserProfile (+ profile_delta_applications idempotency)
Node session cache 仍为 session-start snapshot（本 session 不热更新）
```

---

## 4. CorrectionEvent Fact Boundary

`system_text` / `corrected_text` **永不**被 normalizer 覆盖。  
Normalization 可从原始 Event + `normalizer_version` 重放再生。

---

## 5. NormalizedCorrection V1

字段：`event_id, user_id, session_id, utterance_index, system_text, corrected_text, correction_spans[], normalizer_version, created_at, superseded_for_profile`  
归属：Scheduler correction/training domain（非跨服务万能 DTO）。

---

## 6. CorrectionSpan V1（AlignedCorrectionSpan）

`source_start/end, target_start/end, source_text, target_text, operation∈{REPLACE,INSERT,DELETE}`  
由 alignment 生成，不写入 JobResult。

---

## 7. Text Alignment Algorithm

Unicode scalar（Rust `char`）上的确定性 Levenshtein DP + 固定回退优先级 + 相邻同操作 coalesce。  
无 LLM / Model2 / embedding。

`normalizer_version = corr-normalizer-v1`

---

## 8. Unicode / Offset Contract

**Offset = Unicode scalar / codepoint index（Rust `char` 下标）**，不是 UTF-8 byte offset。  
Alignment 前仅做 `\r\n`/`\r` → `\n`（versioned；不改存储事实）。

禁止：简繁转换、拼音转换、同义词、语义纠错。

---

## 9. CorrectionFeatures V1

每 span：Text / Phonetic / Tone / Term / Domain。  
`extractor_version = corr-feature-extractor-v1`

---

## 10. Phonetic Feature Extraction

Scheduler **无** Node `pinyin-pro` runtime。V1：

* 仅当 source/target 均为 ASCII syllable-like token 时匹配固定 key（如 `n_l`）
* CJK 无 romanization → `unsupported=true`，**不**动态扩 schema

---

## 11. Tone Evidence Handling

CorrectionEvent **无** observed acoustic tone。  
`tone_features.unavailable_reason = NO_OBSERVED_ACOUSTIC_TONE_ON_CORRECTION_EVENT`  
**不**用字典声调冒充。区分：lexical tone（未填）vs observed acoustic tone（缺失）。

---

## 12. Personal Term Evidence

REPLACE/INSERT 且 target ≥2 chars；若 span 过碎，用宏观 candidate（短 corrected 扩展）。  
进入 ProfileDelta `personal_term_updates`，**不**直接永久写入无界列表。

---

## 13. Domain Evidence Handling

Phase 2 Event 无可靠 domain → `domain = null` / `NO_DOMAIN_ON_CORRECTION_EVENT`。不推测。

---

## 14. UserFeatureSchema V1

`feature_schema_version = user-feature-schema-v1`  
固定 phonetic keys：`n_l,l_n,zh_z,z_zh,ch_c,c_ch,sh_s,s_sh,an_ang,ang_an,en_eng,eng_en,in_ing,ing_in,f_h,h_f`  
Tone keys 已预留；无证据不写入。

---

## 15. Unsupported Feature Semantics

未知混淆 → 保留 CorrectionHistory / TrainingSample raw；ProfileDelta **无** structured update；**不** `user.feature[random-…]`。

---

## 16. ProfileDelta V1

`schema_version, base_profile_version, source_event_id, phonetic_updates[], tone_updates[], personal_term_updates[], domain_updates[], extractor_version, feature_schema_version, normalizer_version, superseded_for_profile`  
**派生 artifact，非 SSOT**（可从 Event 重算）。

---

## 17. Profile Aggregation Algorithm

* Phonetic：EMA `α=0.25`，clamp ±5  
* Personal terms：evidence 累加 + Top-K  
* 常量代码内；无巨型配置

---

## 18. UserProfile Update Semantics

Gateway 为唯一 Runtime SSOT。  
路径：Browser→Gateway→Scheduler 返回 ProfileDelta→**Gateway 本地 apply**（无 Scheduler→Gateway 反向 HTTP）。  
策略：reload latest + additive apply；stale `base_profile_version` 不 silent overwrite 整表，而是基于最新版本重放加性证据（最多一次 retry）。

---

## 19. 32 KiB Bound Verification

`serialize_checked` 硬门禁保留。超限则逐出最低 evidence term。测试覆盖 100/200 term 压测。

---

## 20. Personal Term Top-K / Eviction

`MAX_PERSONAL_TERMS = 100`（50/100/200 压测后取 100，仍 ≪ 32KiB）。  
`personal_term_evidence` + 有序 `personal_terms`。

---

## 21. Version Conflict Handling

`profile_delta_applications(user_id, event_id)` 保证 **同 event 不二次 apply**。  
并发 stale → reload + re-apply once。

---

## 22. Re-edit / Supersession Semantics

同一 `user_id+session_id+utterance_index`：最新 Event 为 profile-learning active；旧 Event **保留事实**，`superseded_for_profile=true` 时 ProfileDelta 空更新。  
训练默认 export：**排除** superseded positives（历史仍可 provenance 重建）。

---

## 23. TrainingSample V1

`input / condition / target / metadata`；`profile_version_ref`（不默认嵌入完整 UserProfile JSON）。  
`sample_id` 每次重建可新；**内容派生确定性**（除 uuid）。

---

## 24. TrainingSample Provenance

`source_type = REAL_USER_CORRECTION`；`correction_event_id`；versions；timestamp。

---

## 25. Future Dataset Split Support

metadata：`user_group_key`（hash，非 raw user_id）、`target_term`、`created_at`、`domain?` → 支持 user/term/time/domain-disjoint。

---

## 26. Negative / Hard Negative Contract

`TrainingSampleKind ∈ {POSITIVE, NEGATIVE, HARD_NEGATIVE}` 已可表示；本轮不生成 synthetic negatives。

---

## 27. Derived Data / SSOT Analysis

| 对象 | 角色 |
|------|------|
| CorrectionEvent | Fact SSOT（Scheduler） |
| UserProfile | Runtime SSOT（Gateway） |
| ProfileDelta / Normalized / Features / TrainingSample | Derived / rebuildable |

---

## 28. Session Profile Snapshot Semantics

**冻结 V1**：Node 使用 session-start UserProfile snapshot。  
本 session 纠错更新 Gateway profile → **下一次新 session** 经 SessionBootstrap 生效。无 mid-session hot reload。

---

## 29. API / Internal Contract Changes

* Scheduler `SubmitCorrectionResponse.profile_delta`：结构化 `ProfileDeltaV1`（可 superseded）
* 增加 `diagnostics` summary（无 token / 无完整 profile dump）
* Gateway `/v1/corrections`：apply delta；返回 `profile_version_before/after`、`profile_apply_skipped`
* duplicate → **不**再次 apply

---

## 30. Database Changes

* Scheduler：`idx_corr_utterance`（无改 Event 表语义）
* Gateway：`profile_delta_applications` 表（event apply idempotency）
* UserProfile JSON：新增可选 `personal_term_evidence`（serde default）

---

## 31. Modified File Inventory

* `central_server/scheduler/src/services/correction/mod.rs`
* `.../service.rs`, `sqlite_repository.rs`, `service_test.rs`
* `central_server/scheduler/src/services/mod.rs`
* `central_server/scheduler/src/messages/user_profile.rs`
* `central_server/api-gateway/src/lib.rs`
* `.../user_profile.rs`, `user_profile_repository.rs`, `correction_proxy.rs`

---

## 32. Added File Inventory

* `align.rs`, `normalizer.rs`, `feature_schema.rs`, `features.rs`, `profile_delta.rs`, `training_sample.rs`（Scheduler）
* `central_server/api-gateway/src/profile_delta.rs`
* 本报告

---

## 33. Deleted / Retired Inventory

无删除。Phase 2 `profile_delta=null` 行为由派生 delta 取代（仍可空 updates）。

---

## 34. Tests Added

Normalizer/align、features、profile_delta、training_sample、service supersession、Gateway apply/Top-K/idempotency/32KiB。

---

## 35. Test Results

| Suite | Result |
|-------|--------|
| Scheduler `cargo test correction` | **26 PASS** |
| Gateway `cargo test --lib` | **19 PASS**（含 apply twice） |

---

## 36. Regression Results

| 项 | 结果 |
|----|------|
| CorrectionEvent 不可变 | PASS |
| JobResult | 未改 |
| Node ASR | 未改 |
| SessionBootstrap | 未改 |
| Model2 / synthetic | 未引入 |

---

## 37. JobResult Non-Modification Verification

`NodeMessage::JobResult` 未扩字段。

---

## 38. Frozen Node Pipeline Verification

未修改 Fine Span / Lexicon / Domain Vote / KenLM / Candidate Merge。

---

## 39. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | CorrectionHistory / UserProfile SSOT 边界 |
| KEEP | session-start profile snapshot |
| MODIFY | Correction submit 返回 ProfileDelta + diagnostics |
| ADD | Normalizer / Features / ProfileDelta / TrainingSample / Gateway apply |
| DEFER | CJK pinyin utility in Scheduler、acoustic tone、domain on Event、undo/retraction、Model2、full voice E2E、IAM、mobile Gateway |

---

## 40. Known Deferred Items

1. Scheduler 侧复用 Node 级 CJK pinyin（现 unsupported）
2. CorrectionEvent 携带 observed tone / domain training context
3. CorrectionRetraction / 撤销回 system_text（UI/API 仍禁止 no-op）
4. Full Gateway voice E2E / real IAM / mobile Gateway / WS token redesign
5. Synthetic/TTS、Model2 train/runtime

---

## 41. Remaining Risks

* 中文 char-level insert 导致 span 过碎 → 已用 macro term 缓解，仍需真实数据校准
* Profile 与 Node cache 延迟一个 session（有意为之）
* TrainingSample `sample_id` 每次 UUID 不同（内容可重建）

---

## 42. Phase 4 Preconditions

1. 真实 CorrectionHistory 积累 + FeatureSchema 命中率统计  
2. 可选：Training Context contract（tone/domain）不改 ASR 主链  
3. Dataset export tooling 基于 TrainingSampleBuilder  
4. Model2 仍仅设计为 Fine Span 并行候选源  

---

## 43. Acceptance Checklist

| Criterion | Status |
|-----------|--------|
| CorrectionEvent immutable | **PASS** |
| deterministic NormalizedCorrection / Spans | **PASS** |
| Unicode offset documented | **PASS** |
| no LLM normalization | **PASS** |
| explainable features; no fabricated acoustic tone | **PASS** |
| fixed UserFeatureSchema; no dynamic growth | **PASS** |
| ProfileDelta derived; Gateway UserProfile SSOT | **PASS** |
| CorrectionHistory unbounded; profile bounded ≤32KiB | **PASS** |
| personal terms Top-K | **PASS** |
| same event no double apply | **PASS** |
| re-edit supersession | **PASS** |
| TrainingSample V1 + provenance + split metadata | **PASS** |
| user_id not model feature | **PASS** |
| negative/hard-negative representable | **PASS** |
| TrainingSample rebuildable | **PASS** |
| session snapshot semantics | **PASS** |
| JobResult / Node ASR / no Model2 / no synthetic | **PASS** |
| tests pass | **PASS** |

### Final Verdict

**PASS_WITH_KNOWN_DEFERRED**
