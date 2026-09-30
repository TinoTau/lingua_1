# Lingua Model2 — Final User-Conditioned Architecture & Input Contract Pre-Training Audit

> **SSOT STATUS (2026-09-12):** `CURRENT_SSOT` for Model2 **insertion point**  
> Production restore: `MODEL2_PRE_EDGE_INSERTION_SSOT_RESTORE` —  
> after Exact/Base Recall, before `buildLexicalEdges` (`expandWindowsWithModel2`).

| Field | Value |
|-------|-------|
| Date | 2026-08-12 |
| Nature | **READ-ONLY PRE-TRAINING ARCHITECTURE AUDIT** |
| Scope | UserProfile V1, TrainingSample V1, Node FW V4, Probe dataset, packaging |
| Based on | User Correction Phase 1–4, frozen Node ASR post-processing |
| Verdict | **PASS** |

本轮未修改 runtime、未训练 Model2、未扩容 Baseline Dataset。

---

## 1. Executive Summary

**结论：可以冻结 User-Conditioned Model2 V1 架构并进入 Baseline Dataset 规划；不得先训 Generic Model。**

推荐 V1 主方案：

**Small Dual-Encoder Fuzzy Retrieval Scorer（CPU / NumPy NPZ）**

* 同一模型从 Stage A 起即含 User Condition 输入；Stage A 用 **MASK/NEUTRAL**，Stage B 再启用真实 bias 监督。
* 运行时：**确定性 phonetic fuzzy pre-pool（~32）→ Model2 batch score → Top-K 并入 Fine Span 候选**；不是仅在 Exact Recall 结果上 rerank。
* UserProfile 转为 **固定长度向量 + 显式 mask**；personal term 采用 **candidate-level 特征**，避免复杂 User Encoder。
* 词库 ~9k term：离线预计算 candidate embedding；utterance 内 **Fine Span batch** 推理；**Node 内 NumPy**（复用 Tone 打包模式），不新增长期微服务。

**Verdict rationale：** Input/Output/UserCondition 张量形状可冻结；Stage A 可用现有 TTS probe 数据且 phonetic/tone bias 必须 MASK；Retrieval 路径保证 Exact Recall miss 时仍可见正确词；规模与延迟符合家庭 PC + ASR 并存约束。

---

## 2. Frozen Model Mission

Model2 **唯一职责**：User-Conditioned Fuzzy Candidate Recall。

```text
ASR → Tone/Timestamp → Fine Span Sliding Window
  每个 Fine Span:
    ├─ Lexicon Exact Recall (frozen, unchanged)
    └─ Model2 Fuzzy Recall (NEW)
         ↓
    Candidate Merge (per-span budget 4–8)
         ↓
    Domain Vote → SameDomain Bucket → Sentence Assembly → KenLM
```

Model2 **不是**：ASR、最终纠错、整句生成、Domain Vote、KenLM、第二条 ASR 链。

**核心指标**：correct candidate **visibility**（Recall@K / MRR），不是 final sentence accuracy。

---

## 3. Current Runtime Position

| 组件 | 状态 | 证据 |
|------|------|------|
| FW V4 Fine Span | 生产冻结 | `lattice-fine-span-runtime.ts`, 窗口 1–5 音节 |
| Lexicon Exact Recall | 生产冻结 | `recall-span-topk-v2.ts`, `exactTopK=2` |
| Per-span budget | 4–8 | `per-span-candidate-limit.ts` |
| Sentence cap | ≤16 | `fw-config.ts` `maxSentenceCandidates=16` |
| Domain Vote | 生产冻结 | `utterance-domain-vote.ts` |
| Session UserProfile cache | **已缓存未消费** | `node-agent-simple.ts` |
| Model2 runtime | **不存在** | 全 electron_node 无 model2 forward |

**Model2 接入点（未来，本轮不改代码）：** `recall-topk-for-windows.ts` 之后、`build-lexical-edges.ts` 之前 — 将 Model2 Top-K 与 Exact Recall 合并，仍受 `getPerSpanCandidateLimit` 约束。

---

## 4. Current UserProfile V1 Audit

**SSOT：** `central_server/api-gateway/src/user_profile.rs`  
**硬限制：** 序列化 ≤ **32 KiB**；`personal_terms` Top-**100**（`profile_delta.rs`）；`phonetic_bias` clamp **±5.0**；EMA α=0.25。

| 字段 | 类型 | Max / 范围 | Fixed schema | Sparse | Runtime SSOT | 训练可用 | 真实监督（今日） |
|------|------|------------|--------------|--------|--------------|----------|------------------|
| `schema_version` | u32 | =1 | ✓ | — | Gateway | 元数据 | 无 |
| `profile_version` | u64 | 单调 | ✓ | — | Gateway | version ref | 无 |
| `phonetic_bias` | map str→f64 | key≤**16** 固定 | ✓ keys | ✓ | Gateway | Stage B | **部分**（ASCII 音节对 only） |
| `tone_bias` | map str→f64 | key≤**12** 固定 | ✓ keys | ✓ | Gateway | Stage B | **无**（delta 恒空） |
| `personal_terms` | vec str | **100** | 有序 Top-K | 变长→有界 | Gateway | Stage A/B | **有**（纠错 span） |
| `personal_term_evidence` | map str→f64 | ≤100 | 非对外 SSOT | ✓ | Gateway | 可选 rank | 有（eviction 用） |
| `confusion_bias` | map str→f64 | 32KiB | **无 key 白名单** | ✓ | Gateway | DEFER | **无** |
| `domain_bias` | map str→f64 | 32KiB | 无白名单 | ✓ | Gateway | Stage B | **无**（delta 恒空） |

**Feature schema SSOT：** `feature_schema.rs` — `PHONETIC_FEATURE_KEYS`（16）、`TONE_FEATURE_KEYS`（12）。

**协议缺口：** TS `messages.ts` 缺 `personal_term_evidence`；Node 缓存 profile 但 FW 未读。

---

## 5. Current TrainingSample V1 Audit

**Rust：** `training_sample.rs` | **Python mirror：** `training/model2/export/training_sample.py`

| 段 | 已有 | 缺口（相对 Model2Input V1） |
|----|------|----------------------------|
| input | source_span, local_context, source_pinyin, tone=null | span offset/operation；left/right 分侧 context；tone/phonetic mask |
| condition | profile_version_ref | **无 profile 快照**；无 condition masks |
| target | target_span | 无 candidate_id / rank 标签 |
| metadata | kind, source_type, user_group_key, domain, synthetic(Python) | Rust 无 synthetic；无 candidate pool 记录 |

**Probe v1 实测：** 766 samples（328 POS / 118 NEG / 320 HN）；`profile_version_ref` 全空；tone 全 null；provenance 完整。

---

## 6. Model2Input V1

逻辑结构（每个 **FineSpanBatch** 内一条 query 行）：

```text
Model2InputV1
├── span: SpanInput
├── context: ContextInput
├── user: Model2UserConditionV1
├── masks: AvailabilityMasksV1
└── meta: InputMetaV1
```

### 6.A SpanInput

| 字段 | 类型 | 说明 |
|------|------|------|
| `span_text` | string, len≤16 chars | ASR 表面文本 |
| `span_len` | u8 | Unicode 字符数 |
| `span_syllables` | string[≤8] | 规范化音节（Node pinyin-pro） |
| `span_syllable_count` | u8 | |
| `observed_tone_ids` | i8[≤8] | 1–5 或 -1；无则全 -1 |
| `span_start_char` | u16 | 句内字符偏移 |
| `span_end_char` | u16 | |

### 6.B ContextInput

**判定：bounded local context 足够；不需要整句 Transformer。**

| 字段 | 类型 | 说明 |
|------|------|------|
| `left_context` | string, ≤24 chars | span 左侧 |
| `right_context` | string, ≤24 chars | span 右侧 |
| `utterance_len` | u16 | 整句长度（位置特征用） |
| `relative_position` | f32 | span 中心 / utterance_len |

最大有效 context：**24+24+span≤16 ≈ 64 chars** — 小 char n-gram 足够。

### 6.C User Condition

见 §7 `Model2UserConditionV1`。

### 6.D Candidate Representation（推理时）

见 §12 `CandidateRepresentationV1`。

### 6.E AvailabilityMasksV1

见 §21。

---

## 7. Model2UserCondition V1

将 variable UserProfile 映射为 **固定有界 neural input**：

```text
Model2UserConditionV1
├── phonetic_condition[16]      float32
├── phonetic_mask[16]           uint8   (1=known active, 0=unknown/masked)
├── tone_condition[12]          float32
├── tone_mask[12]               uint8
├── domain_prior[12]            float32   (fixed domain id slots)
├── domain_mask[12]             uint8
├── personal_term_count         uint8     (≤100, active in profile)
├── profile_version             uint64
├── profile_available           uint8     (1=session snapshot present)
└── phonetic_profile_acoustically_realized  uint8  (Stage A always 0)
```

**映射规则（UserProfile → tensors）：**

| Profile 字段 | 映射 |
|--------------|------|
| `phonetic_bias[k]` | `phonetic_condition[idx(k)] = clamp(v/5.0, -1, 1)`；mask=1 |
| 缺失 key | condition=0；**mask=0**（不是“用户无此偏差”） |
| `tone_bias[k]` | 同上；Stage A **全部 mask=0** |
| `domain_bias[d]` | 若 `d` ∈ 12 个 registry domain → slot；else 忽略 |
| `personal_terms` | **不**展开为 100 维 one-hot；见 §10 |

**confusion_bias：** V1 **DEFER**（无 schema、无监督、无 apply 路径）。

---

## 8. Phonetic Condition Encoding

**Inventory（真实代码，16 keys）：**

`n_l`, `l_n`, `zh_z`, `z_zh`, `ch_c`, `c_ch`, `sh_s`, `s_sh`, `an_ang`, `ang_an`, `en_eng`, `eng_en`, `in_ing`, `ing_in`, `f_h`, `h_f`

**FeatureSchemaVersion：** `user-feature-schema-v1`（`feature_schema.rs`）

**Tensor：**

```text
phonetic_condition: float32[16]
phonetic_mask:      uint8[16]
```

稳定 index 表写入 `Model2Input contract`（训练/推理共用 lookup table）。

---

## 9. Tone Condition Encoding

**Inventory（12 keys）：** `tone_1_2`, `tone_2_1`, …, `tone_4_3`

**必须区分：**

| 类型 | Model2Input 字段 | Stage A |
|------|------------------|---------|
| Lexical tone（字典） | 不进入 user condition | — |
| Observed acoustic tone | `span.observed_tone_ids` | 来自 Tone 模块；probe 无 |
| User historical tone bias | `tone_condition[12]` | **MASK（mask=0）** |

TTS probe 无 acoustic tone → **不得**用 tone_bias 监督。

---

## 10. Personal Term Encoding

**比较结论：选 A（candidate-level features）为主，Top-K 仅作 rank 输入。**

| 方案 | 评估 | 决定 |
|------|------|------|
| A. candidate↔personal 特征 | 低维、贴合 Recall 任务 | **V1 主路径** |
| B. term embedding pooling | 100 terms×dim 内存/复杂 | 否 |
| C. Top-K encoder | 需 RNN/Transformer | 否 |
| D. 全历史向量 | 超 bounded | 否 |

**Candidate-level personal features（每 candidate 3 维）：**

```text
personal_exact_match:     1.0 if candidate.text ∈ personal_terms else 0
personal_syllable_sim_max: max over top-20 personal terms of syllable similarity ∈ [0,1]
personal_evidence_rank:   1 - rank/100 if in list else 0  (rank from evidence)
```

User Encoder 仅输出 **personal_term_count**（uint8）作为全局 scalars；不做 100-term 序列编码。

---

## 11. Domain Condition Encoding

**原则：Model2 domain 只做 recall prior，不做 Domain Decision。**

Domain Vote 已冻结（presence vote + bucket）。Model2 **不得**输出 domain 决策。

**V1 方案：fixed 12-slot domain prior + candidate-domain compatibility**

```text
domain_prior[12]:  from UserProfile.domain_bias (masked slots)
candidate_domain_match: 1.0 if candidate.domain_id == active bucket domain else 0
candidate_domain_tag_weight: float from term_domain_tags (0 if none)
```

不复制 Domain Vote 逻辑；仅帮助 **同 domain bucket 内** 召回排序。

---

## 12. Candidate Representation

**Lexicon SSOT：** `node_runtime/lexicon/v3` — base **9256** + domain **655** + idiom 22192（idiom **不**进 Model2 主候选池默认）。

**CandidateRepresentationV1（离线 derived artifact）：**

| 字段 | 类型 |
|------|------|
| `term_id` | string (stable lexicon id) |
| `surface` | string |
| `syllables` | string (pinyin_key) |
| `syllable_count` | u8 |
| `domain_ids` | uint8[≤3] |
| `term_type` | enum: base/domain |
| `prior_score` | f32 |

**离线 embedding 表（derived，非 SSOT）：**

```text
candidate_embed: float16[NCAND][D]   NCAND≈9500, D=64
candidate_meta:  parallel arrays keyed by term_id
lexicon_snapshot_id: sha256 from manifest v12
model2_candidate_index_version: "cand-index-v1"
```

**规模 10k+：** brute-force matmul 9500×64 @ batch≤32 spans → **<2ms CPU**；无需 FAISS/Vector DB。

---

## 13. Retrieval vs Reranking Decision

**正式决定：Hybrid Fuzzy Retrieval（非纯 Reranker）**

```text
Exact Recall (frozen, top 1–2)
        +
Phonetic Fuzzy Pre-Pool (deterministic, top ~32 from lexicon pinyin index)
        ↓
Model2 Learned Score (user-conditioned)
        ↓
Merge dedupe → Top-K per span (K_model=4)
        ↓
Union into per-span budget (4–8 total with Exact)
```

**为何不是纯 Reranker：** Exact Recall `exactTopK=2` 常漏正确词；若 Model2 只见 Exact 输出则 **架构错误**。

**Fuzzy Pre-Pool 来源（deterministic，非 ML）：** lexicon `pinyin_key` + `normalizeSyllable` + Levenshtein ≤2 + 同长度窗口；与 Node `fuzzy-pinyin-key-builder` 语义对齐。

Model2 学的是：**在 expanded pool 内** 按 user condition 排序/加权，而非替代 Exact SQL。

---

## 14. Architecture Options Compared

| 选项 | Recall | 9k scale | CPU | User cond | Export | 维护 | 结论 |
|------|--------|----------|-----|-----------|--------|------|------|
| MLP feature scorer | 中 | ✓ | ✓✓ | Late fusion 易 | ✓ | ✓✓ | **V1 主方案** |
| Siamese Dual Encoder | 中高 | ✓ | ✓ | ✓ | ✓ | ✓ | **V1 主方案** |
| Small Transformer | 中高 | ✓ | △ | 中 | △ | △ | fallback |
| Hybrid phonetic+MLP | 中 | ✓ | ✓✓ | ✓ | ✓ | ✓ | 与主方案合并 |
| Pure rerank on Exact | **FAIL** | — | — | — | — | — | **拒绝** |

---

## 15. Recommended V1 Architecture

```text
Utterance FineSpan[]  (batch B, B≤32)
      ↓
┌─────────────────────────────────────┐
│ Span Encoder (char 3-gram hash +    │
│   syllable embed + context embed)   │
│   → q_base[B, 64]                   │
└─────────────────────────────────────┘
      │
      ├── UserProfile snapshot
      │        ↓
      │   Model2UserConditionV1 (fixed tensors)
      │        ↓
      │   Condition MLP → u_vec[32]
      │        ↓
      └── Late Fusion: q = q_base + W_u · u_vec  →  q[B, 64]

For each span b:
  pool = ExactHits ∪ FuzzyPrePool(span)   (≤34 unique)
  scores[c] = dot(q[b], candidate_embed[c]) + personal_feats[b,c] + domain_feats[b,c]
  Top-4 → Model2Output

Stage A: phonetic_mask=0, tone_mask=0, u_vec≈0 (learned neutral)
Stage B: unmask supervised keys only
```

**Fallback（若 dual-encoder 训练不足）：** MLP-only on hand-crafted phonetic features + personal/domain feats（无 candidate_embed）；Recall 上限较低但可 ship。

---

## 16. Query Encoder

```text
Qbase = F(span_text, span_syllables, left/right_context, relative_position)
```

| 组件 | V1 选择 |
|------|---------|
| span text | char 3-gram hashed embed → mean pool → 32d |
| pinyin | syllable embed table (≤400 syllables) → mean → 16d |
| context | 同 char 3-gram → 16d |
| 融合 | concat → Linear(64→64) + ReLU |

**不用 Transformer**（Fine Span 短、latency 敏感）。

---

## 17. User Conditioning / Fusion

**选择：Late Fusion / Score Bias**

理由：UserProfile 小、结构化；Early Fusion 需大 User Encoder；Score Bias 对 personal/domain **candidate-level** 特征更自然。

```text
U = G(UserCondition) → u_vec[32]
Qconditioned = Qbase + W_u · u_vec     (broadcast per span)

score = dot(Qconditioned, C_embed) + β_personal·f_personal + β_domain·f_domain
```

`W_u` 与 β 可学习；Stage A 时 mask 使 u_vec→0。

---

## 18. Candidate Scoring

```text
score(span, candidate, user) =
    dot(Qconditioned, C_embed)
  + w_p · personal_exact_match
  + w_s · personal_syllable_sim_max
  + w_r · personal_evidence_rank
  + w_d · candidate_domain_tag_weight
  + w_m · candidate_domain_match
```

| 项 | 学习 / 确定 / mask |
|----|-------------------|
| dot product | **学习** |
| personal_* | 特征确定，权重 **学习** |
| domain_* | 特征确定，权重 **学习** |
| phonetic/tone user bias | 通过 u_vec **学习**（Stage B） |
| 不可用 condition | **mask=0**，不参与 |

---

## 19. Model2Output V1

```text
Model2OutputV1
├── span_id: string
├── model_version: string
├── feature_schema_version: string
├── candidates: CandidateScore[]   (len ≤ K_OUT=4)
│     ├── term_id
│     ├── surface
│     ├── score: float32
│     └── rank: uint8
└── diagnostics?: { pool_size, exact_hit, fuzzy_pool_size, latency_ms }
```

**不得输出：** 整句、domain decision、KenLM score。

**Top-K 建议：** Model2 输出 **K=4** / span；与 Exact 合并后仍 ≤ `getPerSpanCandidateLimit`（4–8）。Sentence 级仍 ≤16（KenLM 不变）。

---

## 20. Exact Tensor Shapes

### 20.1 Model2UserConditionV1 (per utterance, broadcast to batch)

| Tensor | Shape | Dtype |
|--------|-------|-------|
| phonetic_condition | [16] | f32 |
| phonetic_mask | [16] | u8 |
| tone_condition | [12] | f32 |
| tone_mask | [12] | u8 |
| domain_prior | [12] | f32 |
| domain_mask | [12] | u8 |
| personal_term_count | scalar | u8 |
| profile_version | scalar | u64 |
| profile_available | scalar | u8 |
| phonetic_profile_acoustically_realized | scalar | u8 |

### 20.2 Model2SpanInput (per span, batched)

| Tensor | Shape | Dtype |
|--------|-------|-------|
| span_char_ids | [B, 16] | u16 (padded) |
| span_len | [B] | u8 |
| syllable_ids | [B, 8] | u16 (padded) |
| syllable_count | [B] | u8 |
| observed_tone_ids | [B, 8] | i8 |
| left_char_ids | [B, 24] | u16 |
| right_char_ids | [B, 24] | u16 |
| relative_position | [B] | f32 |

### 20.3 Candidate scoring (per span)

| Tensor | Shape | Dtype |
|--------|-------|-------|
| candidate_embed | [P, 64] | f16 | P≤34 |
| personal_feats | [P, 3] | f32 |
| domain_feats | [P, 2] | f32 |
| scores | [P] | f32 |
| topk_indices | [4] | u32 |

### 20.4 Model parameters (budget)

| 组件 | 参数量估算 |
|------|------------|
| char/syllable embed + span MLP | ~180K |
| condition MLP (58→32) | ~2K |
| W_u (32→64) | ~2K |
| score head weights | ~1K |
| candidate embed table (9500×64) | ~608K (artifact, 非 backprop 全量) |
| **Total trainable** | **~200K target, 500K warning, 2M hard max** |

---

## 21. Missing / Unknown Masks

| Mask | 1 = | 0 = |
|------|-----|-----|
| phonetic_mask[i] | profile 有合法 key 且 Stage B 可信 | unknown / Stage A / 无监督 |
| tone_mask[i] | 未来 acoustic-backed bias | 无 observed tone / Stage A |
| domain_mask[i] | domain_bias 有值 | 未知或无 |
| profile_available | session 有 snapshot | empty profile |
| observed_tone valid | Tone 模块产出 | -1 padding |
| phonetic_profile_acoustically_realized | Stage B 发音控制数据 | Stage A TTS（=0） |

**禁止：** mask=0 与 “用户确实无该偏差” 混用 — 无监督时一律 mask=0。

---

## 22. Stage A Training Objective

**Loss： sampled softmax / pairwise ranking on fuzzy pool**

```text
L = L_rank + λ_neg · L_neg + λ_hn · L_hn

L_rank:  -log softmax(score)[positive]  over pool (POSITIVE samples)
L_neg:   margin loss pushing non-target above threshold (NEGATIVE / NO_CHANGE)
L_hn:    hinge: score(biased_personal_term) < score(NO_MATCH anchor)  (HARD_NEGATIVE)
```

**Stage A 约束：**

* `phonetic_mask = 0`, `tone_mask = 0`, `u_vec ≈ 0`（或 learned neutral embedding）
* 仅训练 **base fuzzy retrieval**：phonetic similarity + context + candidate embed

**数据：** `TTS_ASR_SYNTHETIC` probe/baseline；**不得**用随机 phonetic_bias 冒充监督。

---

## 23. Stage A Supervision Matrix

| Input | TTS probe 可监督？ | Stage A 用法 |
|-------|-------------------|--------------|
| span | ✓（ASR hyp span） | 训练 |
| span phonetic | ✓（Node pinyin / lexicon key） | 训练 |
| local context | ✓ | 训练 |
| candidate pool | △（需 rebuild 加 fuzzy pool 标签） | 训练 |
| positive target | ✓ | 训练 |
| negative NO_CHANGE | ✓ | 训练 |
| hard negative NO_MATCH | ✓ | 训练 |
| phonetic_bias | ✗（无 acoustic realization） | **MASK** |
| tone_bias | ✗ | **MASK** |
| personal_terms | △（pseudo list；非声学） | candidate-level only |
| domain_bias | △（pseudo；非 Domain Vote） | weak prior only |
| confusion_bias | ✗ | DEFER |

---

## 24. Stage B Training Strategy

| 数据源 | 可监督 UserCondition | Provenance |
|--------|------------------------|------------|
| REAL_USER_CORRECTION | personal_terms, phonetic_bias (ASCII) | REAL_USER_CORRECTION |
| RULE_SYNTHETIC | 指定 phonetic pair effect | RULE_SYNTHETIC（隔离统计） |
| future pronunciation-controlled speech | phonetic + tone | 独立 phase |
| human-recorded samples | 同上 | HUMAN_ANNOTATED |

Stage B：**解冻**对应 mask；联合微调 `W_u` + condition MLP；contract 不变。

---

## 25. TrainingSample V1 Compatibility

**足够支持 Stage A 主体；不足处需 V1.1 衍生层（非重做 Correction）。**

已有：span, context, source_pinyin, target, kind, source_type, user_group_key, synthetic provenance。

缺失：span offsets, operation, candidate pool snapshot, condition masks, embedded profile snapshot ref。

---

## 26. TrainingSample V1.1 Changes (Minimal)

| 变更 | 位置 | 说明 |
|------|------|------|
| ADD `input.span_operation` | optional enum | REPLACE/INSERT/DELETE |
| ADD `input.context_left/right` | optional | 替代整句 local_context 拆分 |
| ADD `condition.user_condition_ref` | optional | pseudo_user_id 或 profile snapshot hash |
| ADD `condition.masks` | optional | phonetic/tone/domain mask 快照 |
| ADD `training.fuzzy_pool_term_ids[]` | export-only | rebuild 时写入 |
| ADD `metadata.synthetic` to Rust | parity | 与 Python 对齐 |

**不修改** CorrectionEvent SSOT / Gateway apply 语义。

---

## 27. Existing Probe Dataset Compatibility

**`model2-synth-probe-v1` 可复用 — 无需重跑 TTS/ASR。**

转换路径：

```text
probe_results.jsonl + training_samples.jsonl + pseudo_users.json + lexicon export
  → rebuild script (ADD)
  → Model2TrainRowV1 (span tensors + pool labels + masks)
```

需 **ADD** offline rebuild（`training/model2/export/model2_train_row.py`），非重新生成音频。

---

## 28. Dataset Regeneration Decision

| 问题 | 答案 |
|------|------|
| Probe 能否转 Model2Input？ | **YES**，rebuild derived |
| Baseline 需重跑 TTS/ASR？ | **NO**（若保留 probe_results + service_lock） |
| 需重跑的情况 | 换 TTS/ASR 版本、改 fuzzy pool 算法、改 contract version |
| 优先策略 | GT/ASR result → rebuild TrainingSample/TrainRow |

---

## 29. Candidate Index Ownership

| 项 | 规则 |
|----|------|
| SSOT | Lexicon v3 sqlite + manifest |
| Derived | `candidate_embed.npz` + meta json |
| build time | lexicon bundle 变更或 `cand-index-v1` 算法变更 |
| load time | Node 启动 / lexicon hot reload 时（随 bundle version） |
| memory | ~9500×64×2B ≈ **1.2 MB** FP16 |
| 禁止 | Candidate Index 作为新 vocabulary SSOT |

---

## 30. Model Size Budget

| 级别 | 参数量 | FP16 文件 | INT8 文件 |
|------|--------|-----------|-----------|
| **target** | 200K | ~0.4 MB | ~0.2 MB |
| **warning** | 500K | ~1.0 MB | ~0.5 MB |
| **hard max** | 2M | ~4 MB | ~2 MB |

+candidate_embed artifact ~1.2 MB（不计入 trainable cap）。

---

## 31. Runtime Performance Budget

| 指标 | Target P50 | Target P95 |
|------|------------|------------|
| Model2 batch/utterance (≤10 spans) | **3 ms** | **12 ms** |
| per-span amortized | 0.3 ms | 1.2 ms |

| 资源 | 预算 |
|------|------|
| CPU RAM (model+index) | **< 30 MB** |
| GPU VRAM | **0**（Model2 CPU；不抢 ASR GPU） |

**Inference device：CPU**（与 ASR GPU 并存原则一致）。

---

## 32. Batch Strategy

```text
FineSpan[] (utterance)
  → pack Model2SpanInput[B]
  → single forward (Qbase batch)
  → per-span candidate pools (variable P)
  → vectorized score where P similar; else small loop
  → CandidateScore[][]
```

避免 per-span 进程/HTTP 调用；Node 内函数调用 batch。

---

## 33. Packaging / Runtime Recommendation

**推荐：A — Node 内 NumPy Runtime（Tone 模式）**

| 阶段 | 路径 |
|------|------|
| Train | `training/model2/training/` (PyTorch) |
| Export | NPZ + metadata（`contract.py`） |
| Load | `electron_node/.../model2-recall/loader_v1.py` |
| Infer | NumPy batch（`inference_v1.py`） |

**不推荐：** 新增长期 localhost model service（latency + 运维）。

**复用 Tone 模式：** contract / loader fail-closed / parity test / 训练域隔离；**不**复制 Tone 业务特征。

---

## 34. UserProfile Runtime Flow Verification

```text
Gateway SQLite SSOT
  → SessionBootstrap → Scheduler → Node sessionUserProfiles Map
  → Model2 reads snapshot ONLY (no Gateway query, no write)
```

* Session 内 profile **不 hot reload** — 与 Phase 1–3 一致。
* Model2 **禁止**修改 UserProfile。

---

## 35. Recall Metrics (Frozen)

| 指标 | 用途 |
|------|------|
| Recall@1 / @3 / @K | 主指标 |
| MRR | 排序质量 |
| NO_MATCH FP rate | negative 质量 |
| Hard-negative FP rate | bias 抑制 |
| candidates/span | 预算合规 |
| latency/span batch | 性能 |
| ExactRecall-only vs +Model2 delta | 集成对比 |

**非主指标：** final sentence accuracy（KenLM/Assembly 阶段测）。

---

## 36. Correct / Empty / Wrong Profile Ablation

| 切片 | Profile | 期望 |
|------|---------|------|
| **B0** | EMPTY / all masks=0 | baseline fuzzy recall |
| **B1** | CORRECT pseudo/real | **Recall@K > B0** on personal/domain terms |
| **B2** | WRONG profile | FP 不得相对 B0 爆炸 |
| **Exact baseline** | — | 始终并行报告 |

Stage A 仅 B0 有意义；B1/B2 为 Stage B gate。

---

## 37. Anti-Demo Dataset Slices

冻结 evaluation slices：

1. seen term / seen profile  
2. unseen term / seen profile  
3. seen term / unseen profile  
4. unseen term / unseen profile  
5. wrong profile  
6. empty profile  
7. hard negative  
8. unseen confusion combination  
9. real correction holdout（REAL_USER_CORRECTION）  
10. RULE_SYNTHETIC isolated bucket  

---

## 38. Risks

1. **CJK phonetic_bias 无真实监督** — Stage B 前仅 personal/domain candidate feats 可靠。  
2. **Exact+Model2 合并策略** — 需 frozen quota 规则，避免 candidate 爆炸。  
3. **Probe personal_terms 非声学** — Stage A 仅用于 hard-negative / grouping。  
4. **TS 缺 personal_term_evidence** — Node 接入时需补协议或忽略。  
5. **VAD cuDNN 环境** — 不影响 Model2 CPU 路径。  
6. **TrainingSample/Rust-Python 漂移** — V1.1 对齐前 export 需约定。

---

## 39. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | UserProfile V1 SSOT；FeatureSchema 16+12 keys；FW Exact Recall；Domain Vote；KenLM≤16；Probe dataset |
| MODIFY | TrainingSample V1.1（minimal ADD） |
| ADD | Model2Input/Output/UserCondition contract；cand-index derived；rebuild train row；NumPy runtime module |
| DELETE | 纯 Reranker-only 方案；confusion_bias V1；per-user model |
| DEFER | Tone condition Stage B；confusion_bias；ANN/FAISS service；ONNX（除非 NumPy 不够）；Node runtime 接线 |

---

## 40. Baseline Dataset Generation Preconditions

1. Phase 5 contract frozen（本轮）  
2. `Model2TrainRowV1` rebuild script ADD  
3. Fuzzy pool 算法 frozen（`fuzzy-pool-v1`）  
4. Probe PASS 可复用或扩 plan 至 2k–5k（不必重跑已有 rows）  
5. service_lock 版本钉死  

---

## 41. Model Training Preconditions

1. Baseline TrainRow 就绪  
2. Stage A masks 单测  
3. candidate_embed 构建自 lexicon v12  
4. B0 Recall 基线 + ExactRecall 对比  
5. **仍禁止** per-user / LoRA / runtime 接入直到 Stage A 离线 metric PASS  

---

## 42. Acceptance Checklist

| # | Criterion | Result |
|---|-----------|--------|
| 1 | User-Conditioned from architecture V1 | ✅ |
| 2 | No separate Generic Model | ✅ |
| 3 | Model2Input V1 frozen | ✅ |
| 4 | UserCondition V1 frozen | ✅ |
| 5 | Masks explicit | ✅ |
| 6 | Variable profile → bounded input | ✅ |
| 7 | Personal term strategy bounded | ✅ |
| 8 | Domain bias ≠ Domain Vote | ✅ |
| 9 | Candidate representation frozen | ✅ |
| 10 | Retrieval vs reranking decided | ✅ Hybrid |
| 11 | Correct candidate visible when Exact misses | ✅ via fuzzy pool |
| 12 | Small-model fit | ✅ ~200K target |
| 13 | Exact tensor shapes documented | ✅ §20 |
| 14 | Stage A without fake user supervision | ✅ MASK |
| 15 | Stage B sources defined | ✅ §24 |
| 16 | TrainingSample compatibility known | ✅ + V1.1 |
| 17 | Probe reuse decision | ✅ rebuild |
| 18 | Candidate index derived from Lexicon | ✅ |
| 19 | Model size budget explicit | ✅ §30 |
| 20 | Latency budget explicit | ✅ §31 |
| 21 | Span batching designed | ✅ §32 |
| 22 | B0/B1/B2 ablation frozen | ✅ §36 |
| 23 | Anti-demo slices frozen | ✅ §37 |
| 24 | Node pipeline untouched | ✅ |
| 25 | No training started | ✅ |
| 26 | No Baseline expansion started | ✅ |

**Final verdict: PASS**

---

## Appendix A — V1 Architecture Diagram

```text
Session UserProfile snapshot
        ↓
Model2UserConditionV1 [16+12+12 + masks]
        ↓
FineSpan Batch [B]
        ↓
Span/Phonetic Encoder → Qbase [B,64]
        ↓
Late Fusion (+ u_vec) → Q [B,64]
        ↓
For each span:
  Pool = ExactRecall ∪ FuzzyPrePool(32)
  Score = dot(Q, CandEmbed) + personal/domain feats
        ↓
Top-4 Model2Output
        ↓
Merge into per-span budget (4–8) → existing FW pipeline
```

---

## Appendix B — Phonetic Key Index (stable)

| idx | key | idx | key |
|-----|-----|-----|-----|
| 0 | n_l | 8 | an_ang |
| 1 | l_n | 9 | ang_an |
| 2 | zh_z | 10 | en_eng |
| 3 | z_zh | 11 | eng_en |
| 4 | ch_c | 12 | in_ing |
| 5 | c_ch | 13 | ing_in |
| 6 | sh_s | 14 | f_h |
| 7 | s_sh | 15 | h_f |

Tone keys: idx 0–11 = `TONE_FEATURE_KEYS` order in `feature_schema.rs`.

Domain slots: idx 0–11 = `profile-registry.json` hierarchy 12 domains（固定映射表 ADD at implementation）。
