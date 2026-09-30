# Lingua Model2 Phase 5A — TrainRow + FuzzyPool Probe Development Report

| Field | Value |
|-------|-------|
| Date | 2026-08-12 |
| Nature | **Training-data / candidate-visibility Gate** (no Model training) |
| Source | `model2-synth-probe-v1` (immutable; no TTS/ASR re-run) |
| Output | `training/model2/dataset/probe_trainrow_v1/` |
| Verdict | **PASS (GO for Model Training Probe)** |

---

## 1. Executive Summary

Phase 5A 完成训练前最后一个数据与候选可见性 Gate：

* 冻结 `domain_prior: float32[12]` / `domain_mask: uint8[12]`
* 实现并冻结 **`fuzzy-pool-v1`**（`distance≤2`, `cap=16`）
* TrainingSample **V1.1**（Rust + Python 对齐）
* **Model2TrainRowV1** 从现有 Probe rebuild（766 rows）
* **FuzzyPool Recall@16 = 100%**（197 term-level POSITIVE）
* **ExactMiss→FuzzyHit ≈ 99.0%**；ExactMiss→FuzzyMiss = **0**
* Stage A phonetic/tone masks **100%** zero
* Leakage = 0；TrainRow build success = 100%
* **未训练 Model2**；未改 Node frozen runtime

**GO_GATE: PASS**

---

## 2. Architecture Audit Preconditions

基于 `Lingua_Model2_Final_Architecture_Input_Contract_PreTraining_Audit_2026_08_12.md`：

| 前提 | 状态 |
|------|------|
| User-Conditioned 同一架构 | 保持 |
| Hybrid Fuzzy Retrieval | FuzzyPool 独立于 Exact |
| Stage A MASK phonetic/tone | 落实 |
| Probe 可 rebuild | 落实（未重跑 TTS/ASR） |

---

## 3–4. Contract Fixes / domain_prior Type

| 项 | 冻结值 |
|----|--------|
| `domain_prior` | **float32[12]**（连续 bias，非分类 ID） |
| `domain_mask` | **uint8[12]** |
| 审计文档 §20.1 | 已修正 u8→f32 |
| Python `contract.py` | `DOMAIN_PRIOR_DTYPE="float32"` |
| TrainRow empty vectors | `domain_prior=[0.0]*12` |

---

## 5. Personal Terms Benchmark

| 配置 | wall_ms（34 cand） | 说明 |
|------|-------------------|------|
| Top-20 | ~5.4 ms | |
| Top-100 | ~25.6 ms | 仍可接受 |
| changed_rate 20→100 | **41.2%** | Top-20 会漏掉大量 sim 差异 |

**冻结决策：`personal_sim_top_n = 100`（全部 active personal_terms ≤100）**  
理由：避免 Profile 第 21–100 词永久失效；单 utterance pool≈7、personal≈3 时开销远低于 microbench。

---

## 6–7. TrainingSample V1.1 + Rust/Python Parity

**新增（additive；`schema_version` 仍为 1）：**

| 段 | 字段 |
|----|------|
| input | `span_operation`, `context_left/right`, `span_start/end` |
| condition | `user_condition_ref`, `condition_masks`, `phonetic_profile_not_acoustically_realized` |
| metadata | `synthetic`, `training`（fuzzy_pool_term_ids, target_term_id, versions） |

* Rust：`training_sample.rs` + roundtrip test `v11_optional_fields_roundtrip`（5 tests PASS）
* Python：`export/training_sample.py`
* Fixture：`tests/fixtures/training_sample_v11_parity.json`

---

## 8. Model2TrainRowV1

路径：`training/model2/export/train_row.py`

含 span/syllable/context IDs、condition 向量+masks、fuzzy_pool、candidate personal/domain features、loss helpers（`positive_pool_index`, `self_span_as_negative_anchor`, HN injection flag）。

Shape validation：超出即 reject（本轮 0 fail）。

---

## 9. Character Hash Contract (`char-hash-v1`)

* Normalize：NFC + CJK/alnum lower
* N-gram size：**3**（`^`/`$` 边界）
* Hash：**FNV-1a 64** + fixed seed（禁止 Python `hash()`）
* Buckets：**4096**；PAD=0

---

## 10. Syllable Vocab Contract (`syl-vocab-v1`)

从 CandidateIndex pinyin 宇宙构建；PAD=0，UNK=1；产物 `syl-vocab-v1.json`。

---

## 11. Candidate Identity

`term_id = {type}:{domain|_|}:{surface}:{pinyin_key}`  
Surface 相同优先 domain record。未新建 vocabulary SSOT。

---

## 12. CandidateIndexMetaV1

* Universe：base + domain（**不含 idiom 22192**）
* Count：**9914**
* Snapshot：lexicon v3 checksum from probe meta
* Derived only

---

## 13–15. FuzzyPool V1 Algorithm / Sweep / Cap

**算法：** length Δ≤1 → syllable Levenshtein ≤ threshold → sort (dist, −prior, term_id) → surface dedupe → cap  
**UserProfile 不参与 pool generation。**

| dist\\cap | 16 | 32 | 48 | 64 |
|-----------|-----|-----|-----|-----|
| 1 | (sweep) | … | … | … |
| **2** | **Recall=1.00** | 1.00 | 1.00 | 1.00 |
| 3 | 1.00 | … | … | … |

**冻结：`distance=2`, `FUZZY_POOL_MAX_V1=16`**（满足 ≥95% 的最小 cap）

---

## 16. Exact vs Fuzzy Visibility

| Category | Count | Rate |
|----------|------:|-----:|
| A Exact Hit only | 0 | 0 |
| **B Exact Miss + Fuzzy Hit** | **195** | **98.98%** |
| C Exact Hit + Fuzzy Hit | 2 | 1.02% |
| D Exact Miss + Fuzzy Miss | **0** | **0** |

→ Fuzzy path **明确补足** Exact Recall。

---

## 17. Target OOV Analysis

| 类 | N | 说明 |
|----|--:|------|
| TERM_POSITIVE | 197 | `target_span` 对齐 planned term |
| NON_TERM_POSITIVE | 130 | 字级对齐（如繁简）；非 lexicon recall 目标 |
| RULE_POSITIVE | 1 | `南宁` 不在 lexicon — RULE 隔离 |
| **TARGET_OOV (term)** | **0** | **TARGET_IN_LEXICON_RATE = 100%** |

---

## 18. Hard Negative Visibility

| 指标 | 值 |
|------|-----|
| Phonetic pool visible | **0%**（预期：偏置词与句无关） |
| In lexicon | **100%** |
| Trainable（inject for loss） | **100%** |

注入仅用于 TrainRow loss；**不改变** FuzzyPool V1 生成合同。

---

## 19. Stage A Mask Audit

* `phonetic_mask[:] = 0`, `tone_mask[:] = 0`：**100%**
* `phonetic_profile_acoustically_realized = 0`
* Stage A 训练：Qbase / candidate similarity / weak personal-domain feats  
* Stage A **不**训练：phonetic/tone user bias

---

## 20–21. Probe Rebuild / TrainRow Stats

| 项 | 值 |
|----|-----|
| Source | `probe_v1`（未重跑 TTS/ASR） |
| TrainRows | **766** |
| POS/NEG/HN | 328 / 118 / 320 |
| Build success | **100%** |
| Deterministic IDs | **true** |

产物目录：`training/model2/dataset/probe_trainrow_v1/`

---

## 22–23. FuzzyPool / Pool Performance

| Metric | Value |
|--------|------:|
| Recall@16 | **1.0** |
| Recall@32/48/64 | 1.0 |
| AVG pool size | 6.66 |
| P95 pool size | 16 |
| P50 pool latency | **0.06 ms** |
| P95 pool latency | **81 ms**（偶发；中位极低） |

P95 尖峰风险：纯 Python + 全量 length-bucket 扫描；未来 Node/索引优化后应压到 <10ms/utterance。**标为风险，但不阻塞 GO**（算法正确性达标）。

---

## 24. Personal Feature Performance

见 §5；冻结 Top-100。

---

## 25. Leakage Audit

* user_leaks = []  
* term/combo overlap = []  
* Candidate lexicon 全量 ≠ leak（runtime universe）  
* Label/profile/user_group 保持 split-disjoint  

---

## 26. Determinism Verification

同 `sample_id + fuzzy_pool_version:d2:c16 + input_contract + cand-index` → 同 `trainrow_id`。PASS。

---

## 27–29. File Inventory

### Modified
* `central_server/scheduler/.../training_sample.rs` — V1.1 fields + tests
* `training/model2/export/training_sample.py` — V1.1
* `docs/.../PreTraining_Audit_...md` — domain_prior dtype fix

### Added
* `training/model2/contract.py`
* `encoding/char_hash.py`, `encoding/syllable_vocab.py`
* `candidates/index.py`
* `fuzzy/pool.py`
* `features/personal.py`
* `export/train_row.py`
* `scripts/rebuild_probe_trainrows.py`
* `tests/test_phase5a_trainrow.py`, fixtures
* `dataset/probe_trainrow_v1/*`（本地产物）

### Deleted / Retired
* 无；未删 probe_v1

---

## 30–31. Tests

* Python Phase5A：8 OK  
* Python Phase4 probe：仍 OK（先前 18）  
* Rust `training_sample`：5 OK  

---

## 32. Runtime Non-Impact

未修改 Fine Span / Exact Recall / Domain Vote / Sentence Assembly / KenLM / JobResult / Node Model2 runtime。

---

## 33. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | Probe v1 audio results；User-Conditioned arch；Lexicon SSOT |
| MODIFY | TrainingSample V1.1；domain_prior dtype |
| ADD | FuzzyPool V1；TrainRow；CandidateIndex；hash/syl contracts |
| DELETE | — |
| DEFER | Model training；Baseline 10k；Node wiring；candidate_embed；ONNX |

---

## 34. Risks

1. FuzzyPool P95 latency 尖峰（Python 实现）— Baseline 前需索引/缓存优化  
2. NON_TERM_POSITIVE 130 条不进 FuzzyPool gate — 可作 char-correction 旁路或过滤  
3. RULE `南宁` 不在 lexicon — 勿混入 TTS term gate  
4. HN 依赖 TrainRow 注入 — scoring 阶段必须识别 `distance=99` 注入标记  

---

## 35. Model Training Probe Preconditions

| Gate | Result |
|------|--------|
| domain_prior float32 | ✅ |
| FuzzyPool Recall@16 ≥95% | ✅ 100% |
| TARGET_IN_LEXICON ≈100% | ✅ |
| Leakage=0 | ✅ |
| TrainRow success≈100% | ✅ |
| Stage A masks=100% | ✅ |
| ExactMiss→FuzzyHit 证明补足 | ✅ |
| 无 Model training | ✅ |

**允许进入下一阶段：最小 Model Training Probe（仍非 Baseline 扩容）。**

---

## 36. Acceptance Checklist

| Criterion | Result |
|-----------|--------|
| domain_prior float32[12] | ✅ |
| domain_mask uint8[12] | ✅ |
| personal Top-100 by benchmark | ✅ |
| TrainingSample V1.1 | ✅ |
| Rust/Python compatible | ✅ |
| Model2TrainRowV1 | ✅ |
| char hash frozen | ✅ |
| syllable vocab frozen | ✅ |
| stable term_id | ✅ |
| CandidateIndex from Lexicon | ✅ |
| fuzzy-pool-v1 | ✅ |
| pool ≠ Exact-only | ✅ |
| parameter sweep | ✅ |
| FuzzyPool Recall independent | ✅ |
| target OOV independent | ✅ |
| ExactMiss→FuzzyHit | ✅ |
| HN visibility measured | ✅ |
| Stage A masks zero | ✅ |
| Probe rebuilt w/o TTS/ASR | ✅ |
| deterministic trainrow IDs | ✅ |
| leakage zero | ✅ |
| no training / Node untouched | ✅ |

**Final verdict: PASS**
