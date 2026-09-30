# LINGUA_MODEL3_MODEL2_HYPOTHESIS_DISCRIMINATION_AUDIT

**PHASE:** `LINGUA_MODEL3_MODEL2_HYPOTHESIS_DISCRIMINATION_AUDIT`  
**MODE:** READ-ONLY · TRACE-FIRST · COUNTERFACTUAL VISIBILITY  
**PRODUCT_CODE_CHANGE_THIS_ROUND:** `NO`

---

## 0. Single question (answered)

> If false Anchor did not block Model3, does **current** Model3 already have enough runtime evidence to distinguish useful Model2 pronunciation hypotheses (KEEP/protect) from compound residuals that must stay RETRY-capable?

```text
ANSWER = NO
MODEL3_DISTINGUISHING_EVIDENCE_AVAILABLE = NO
```

Model3’s model-visible contract does not include Model2 hypothesis content (replacement, provenance type, closed-chain fields). K1≅R1 at Model2 remains **effectively indistinguishable as hypotheses** at Model3 input; only ASR surface / path position / candidate-count differ.

---

## 1. Baseline

| Prior SSOT | Status |
|------------|--------|
| False Anchor = ANY domain/model2 evidence → whole-span Anchor | unchanged |
| Model2 closed chain provable; ASR-error completeness not | unchanged |
| P2≅N1 Model2 isomorphism | confirmed again as K1≅R1 |
| ONE_NEXT_OWNER was MODEL3_SUFFICIENCY_OWNER | refined below |

```text
BASELINE_IDENTITY = PASS
PRIMARY_CASE_COUNT = 6
```

---

## 2. Production Model3 chain (exact)

```text
PathFineSpan
 → materializeModel3Anchors (model3-anchor-adapter.ts)
 → packModel3SpanInferFields (model3-feature-pack.ts)
 → Model3InferenceHost.inferPath (model3-inference-client.ts)
 → model3_inference_host.py::_pack_spans + BiGRU
 → decisions (KEEP/RETRY logits)
 → maskAnchorDecisions / host is_anchor gate (RETRY→KEEP, eligible=false)
 → retry-region from eligible RETRY only
```

**False Anchor occurs at:** `MIXED` — `isAnchor` is a **model feature** (BEFORE/AT inference) **and** post-infer **action mask**.

---

## 3. Model3 input contract (actual, not intended)

### Model-visible tensors (frozen allowlist)

| FIELD | PRODUCER | PER | SEMANTIC | M2 hyp? |
|-------|----------|-----|----------|---------|
| `isAnchor` | Anchor adapter → pack | span | protection bit | NO |
| `span_len_log1p` | `len(surface)` | span | surface string length | NO |
| `span_rel_position` | index / (N−1) | span | path position | NO |
| `first_pass_cand_log1p` | `PathFineSpan.candidates` count | span | **count only** | NO |
| `current_cjk_len_log1p` | CJK char count | span | length | NO |
| `pinyin_channel_avail` | global syllables nonempty | utterance | channel flag | NO |
| surface char tokens | `encode_surface(surface)` | span | **ASR surface embedding** | NO |

```text
MODEL3_CURRENT_INPUT_CONTRACT =
BiGRU(surface tokens) + 6D span_feats
{isAnchor, span_len_log1p, span_rel_position, first_pass_cand_log1p, current_cjk_len_log1p, pinyin_channel_avail}
```

### Not model-visible (confirmed absent from pack/host)

Model2 provenance / actionId / relation / replacement / transformed query / hit pinyin / domains / Domain Vote / SameDomain / KenLM / FW confidence / candidate identity list.

Neighbor spans enter only as **other sequence positions’ ASR surfaces** (BiGRU context), not as candidate/Anchor evidence objects.

```text
MODEL2_HYPOTHESIS_VISIBILITY = NONE
PROFILE_EVIDENCE_TYPE_COLLAPSE = YES
  (PROFILE_PRONUNCIATION / PROFILE_DOMAIN / PROFILE_RETRIEVAL never reach Model3 tensors)
```

Candidate vs surface: runtime has both on `WindowCandidate`, but Model3 sees **only ASR `surface`**, not `replacement` (牛/常/生成).

---

## 4. Case traces (production CORRECT_PROFILE replay)

| ID | Span | Anchor | Masked | Raw argmax (logits) | Bound provenance (adapter pool, not Model3) |
|----|------|--------|--------|---------------------|-----------------------------------------------|
| K1 | 刘 | MODEL2 | KEEP | **RETRY** (k−1.28,r+1.44) | PROFILE_PRONUNCIATION:牛 |
| K2 | 升层 | D∧M2 | KEEP | **RETRY** (k−1.48,r+1.45) | PROFILE_PRONUNCIATION:生成 + PROFILE_DOMAIN soft |
| R1 | 藏 | MODEL2 | KEEP | **RETRY** (k−1.36,r+1.45) | PROFILE_PRONUNCIATION:常 + BASE_FUZZY:藏 |
| R2 | 德鸾 | D∧M2 | KEEP | **RETRY** (k−1.40,r+1.67) | PROFILE_DOMAIN soft only |
| R3 | 注册 | D∧M2 | KEEP | **RETRY** (k−1.45,r+1.35) | BASE_FUZZY:注册 + PROFILE_DOMAIN soft |
| R4 | 理事 | D∧M2 | KEEP | **RETRY** (k−1.14,r+1.29) | PROFILE_DOMAIN soft only |

Path context (ASR surfaces only):

- K1: `…了解 | 刘 | 若 | 川…` (若 already non-anchor RETRY)
- R1: `…把 | 藏 | 头 | 灯…` (头 RETRY, 灯 KEEP)
- K2: `…下 | 升层`
- R2: `…说明 | 德鸾`
- R3: `…出 | 注册 | 再决…` (出 RETRY)
- R4: `…关于 | 理事 | 员的…`

---

## 5. K1 vs R1 feature diff (decisive)

| FEATURE | K1 刘 | R1 藏 | SAME? | Supports M2-hyp discrimination? |
|---------|-------|-------|-------|----------------------------------|
| isAnchor | 1 | 1 | SAME | NO |
| span_len_log1p | 1.099 | 1.099 | SAME | NO |
| span_rel_position | 0.30 | 0.20 | DIFF | Position only — not hyp quality |
| first_pass_cand_log1p | 0.693 (1) | 1.099 (2) | DIFF | Count only — not 牛 vs 常 |
| current_cjk_len_log1p | 0.693 | 0.693 | SAME | NO |
| pinyin_channel_avail | 1 | 1 | SAME | NO |
| surface tokens | 刘 | 藏 | DIFF | ASR glyph ≠ M2 hypothesis |
| BiGRU neighbors | 了解/若 | 把/头 | DIFF | ASR context ≠ closed-chain proof |
| replacement 牛 vs 常 | — | — | **ABSENT** | would be decisive if present |
| PROFILE_PRONUNCIATION | — | — | **ABSENT** | — |
| raw margin | 2.73 | 2.82 | ≈SAME | Model treats both as RETRY-leaning |

```text
K1_R1_MODEL3_FEATURE_ISOMORPHISM = PARTIAL
```

Numeric Model3 feats nearly isomorphic; surface/context differ but **do not encode Model2 hypothesis**. Model2-level isomorphism is **not broken** for hypothesis semantics.

---

## 6. Counterfactual unmasking

### What was reconstructed (read-only)

**CF-A — mask-only (authoritative):** use production `keepLogit`/`retryLogit` already computed on the live full path with `isAnchor=1`, apply `argmax` as if `maskAnchorDecisions` / host anchor gate did not force KEEP.

```text
COUNTERFACTUAL_RECONSTRUCTION = PARTIAL
  CF-A mask-only on production logits = PASS for all 6
  CF-B re-infer with isAnchor=0 = NOT FAITHFUL offline
    (standalone host reinfer logits ≠ production pack;
     packing parity gap — do not trust absolute CF-B decisions)
```

### CF-A results

| Group | CF-A decision | Audit role |
|-------|---------------|------------|
| K1 刘 | RETRY | expected KEEP/protect useful hyp → **FALSE_RETRY risk** |
| K2 升层 | RETRY | expected KEEP/protect → **FALSE_RETRY risk** |
| R1–R4 | RETRY | RETRY-capable OK as **actionability**, not as hyp-aware discrimination |

```text
COUNTERFACTUAL_K_GROUP_KEEP = 0/2
COUNTERFACTUAL_R_GROUP_KEEP = 0/4
COUNTERFACTUAL_R_GROUP_RETRY = 4/4
FALSE_KEEP_COUNT = 0 (under CF-A; production masked KEEP is gate, not model KEEP)
FALSE_RETRY_COUNT = 2 (K1,K2 under CF-A)
```

`NON-ANCHOR ≠ RETRY` still holds: Model3 *may* KEEP; under current logits it *would* RETRY these spans.

---

## 7. Visibility vs decision quality (separated)

| Case | Class | Note |
|------|-------|------|
| K1–K2, R1–R4 | **M3-C EVIDENCE_INSUFFICIENT** | Cannot see M2 hyp / profile type |
| All | also **D1** | False Anchor blocks eligibility |

```text
H1 (evidence enough; only Anchor blocks) = NOT SUPPORTED
H2 (evidence present; decision wrong) = NOT SUPPORTED for hyp discrimination
H3 (evidence missing) = SUPPORTED
H4 mixed = Anchor gate + input gap both real; FIRST blocker = input contract
```

Prior M3-D false-KEEP=4 do **not** overlap this R set as non-anchor false KEEP; these R spans were Anchor-swallowed (D1), not actionable false KEEP.

---

## 8. Minimum Model3 sufficiency evidence (semantic, not implemented)

| Need | Class |
|------|--------|
| ASR surface, path position, cand **count**, isAnchor | ALREADY_AVAILABLE |
| Candidate **replacement** for span geometry | AVAILABLE_UPSTREAM_BUT_LOST (to Model3 pack) |
| `retrievalProvenance` PROFILE_PRONUNCIATION vs PROFILE_DOMAIN | AVAILABLE_UPSTREAM_BUT_LOST |
| Closed-chain transform/hit pinyin | AVAILABLE_UPSTREAM_BUT_LOST (deferred transport) |
| Pilot target | GROUND_TRUTH_ONLY_FORBIDDEN |

```text
transformed syllables / hit pinyin:
  REQUIRED_FOR_MODEL3_DISCRIMINATION = UNKNOWN→likely YES for strict closed-chain proof
  but FIRST missing discriminators already include replacement + provenance type
  → do not mandate full closed-chain transport until input contract includes hyp fields

MODEL2_EVIDENCE_TRANSPORT_REQUIRED = YES (to feed Model3 input pack)
MODEL3_INPUT_CHANGE_REQUIRED = YES
MODEL3_DECISION_CHANGE_REQUIRED = UNKNOWN (premature until inputs exist)
MODEL3_TRAINING_READY = NO
```

---

## 9. Root-cause taxonomy (6 cases)

| Case | Primary |
|------|---------|
| K1 | D3_MODEL3_INPUT_MISSING_MODEL2_HYPOTHESIS_DETAIL |
| K2 | D3 |
| R1 | D3 (+ D1 secondary) |
| R2 | D3 (+ D4 collapse / soft-domain; D1) |
| R3 | D3 (+ D1) |
| R4 | D3 (+ D1) |

```text
D3 = 6/6
```

---

## 10. Owner & locality

```text
ONE_NEXT_OWNER = MODEL3_INPUT_CONTRACT_OWNER

PRIMARY_FIRST_FAILURE_MECHANISM =
Current Model3 V1 six-feature + ASR-surface BiGRU contract cannot observe
Model2 pronunciation hypothesis (replacement/provenance/closed-chain);
false Anchor mask then blocks actionability — but unmasking alone yields
uniform RETRY including useful K spans (no hyp discrimination).

PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = UNKNOWN
  (future input-contract change may stay inside Model3 packer + service-internal
   candidate fields without Model2 inference / Domain Vote / FineSpan / JobResult
   changes — not proven this round)

ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
```

```text
ONE_NEXT_DELTA =
Design Model3 input-contract delta so inference can observe, at minimum,
span-bound candidate replacement surface + retrievalProvenance
(PROFILE_PRONUNCIATION vs PROFILE_DOMAIN) — without Pilot target and without
changing Model2 inference semantics; defer training until that contract exists.
Do not implement Anchor or transport this round.
```

---

## 11. Final verdict block

```text
BASELINE_IDENTITY = PASS
PRIMARY_CASE_COUNT = 6
COUNTERFACTUAL_RECONSTRUCTION = PARTIAL

MODEL3_CURRENT_INPUT_CONTRACT =
BiGRU(ASR surface) + 6D {isAnchor, span_len_log1p, span_rel_position,
first_pass_cand_log1p, current_cjk_len_log1p, pinyin_channel_avail}

MODEL2_HYPOTHESIS_VISIBILITY = NONE
PROFILE_EVIDENCE_TYPE_COLLAPSE = YES
K1_R1_MODEL3_FEATURE_ISOMORPHISM = PARTIAL

MODEL3_DISTINGUISHING_EVIDENCE_AVAILABLE = NO
MODEL3_DISTINGUISHING_EVIDENCE_USED = NOT_APPLICABLE

COUNTERFACTUAL_K_GROUP_KEEP = 0/2
COUNTERFACTUAL_R_GROUP_KEEP = 0/4
COUNTERFACTUAL_R_GROUP_RETRY = 4/4
FALSE_KEEP_COUNT = 0
FALSE_RETRY_COUNT = 2

PRIMARY_FIRST_FAILURE_MECHANISM =
MODEL3_INPUT_CONTRACT_BLIND_TO_MODEL2_HYPOTHESIS
(+ false Anchor mask secondary)

ONE_NEXT_OWNER = MODEL3_INPUT_CONTRACT_OWNER

MODEL2_EVIDENCE_TRANSPORT_REQUIRED = YES
MODEL3_INPUT_CHANGE_REQUIRED = YES
MODEL3_DECISION_CHANGE_REQUIRED = UNKNOWN
MODEL3_TRAINING_READY = NO
JOBRESULT_CHANGE_REQUIRED = NO
ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = NO
PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = UNKNOWN
PRODUCT_CODE_CHANGE_THIS_ROUND = NO

ONE_NEXT_DELTA =
Specify Model3 input-contract fields for span-bound replacement +
retrievalProvenance before any Anchor release / training / decision retune.
```

STOP.
