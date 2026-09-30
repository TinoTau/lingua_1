# LINGUA_DIALOG2000_V2_PILOT200 — Block C Profile-Aware Evaluation Report

**Phase:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_C_PROFILE_AWARE_EVALUATOR_DEVELOPMENT`  
**Evaluator:** `pilot200-block-c-evaluator-v1`  
**Dataset:** `build_20260911_091806`  
**Replay (primary):** `replay_2026-09-11T1347`  
**Block B (corroboration only):** `blockb_2026-09-11T1021`

---

## 1. Executive result

| Layer | Result |
|-------|--------|
| Overall Model2 verdict | **`MODEL2_PROFILE_EFFECT_NOT_OBSERVED`** |
| Expansion verdict | **`MODEL2_EXPANSION_NOT_OBSERVED`** |
| Final conversion verdict | **`FINAL_REPAIR_CONVERSION_NOT_APPLICABLE_NO_USEFUL_EXPANSION`** |
| PROFILE_GAIN_CER (Replay) | **0** (NO / CORRECT / WRONG finals identical) |
| USEFUL_EXPANSION (CORRECT) | **0 / 148** eligible |
| P actions (NO / CORRECT / WRONG) | **0 / 0 / 0** |
| ONE_NEXT_OWNER | **`MODEL2_PROFILE_PERMISSION / P ACTION`** |

Replay 下三种 profile condition 的 final 文本与 CER **完全一致**（200/200 `ALL_EQUAL`）。在 Model2 effect 合格分母上，冻结 trace 记录的 P/D 增量为 0 → 无 SSOT 意义上的 useful expansion。

---

## 2. Evidence identity

| Evidence | Role |
|----------|------|
| Dataset `build_20260911_091806` | READ ONLY |
| Replay `replay_2026-09-11T1347` | **PRIMARY** controlled profile attribution |
| Block B `blockb_2026-09-11T1021` | FULL_AUDIO corroboration only |

Evaluator **未**重跑 ASR / Replay / pipeline。归一化 / CER / outcome 复用 `LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1`。

---

## 3. Case accounting

| Bucket | Count |
|--------|------:|
| TOTAL | 200 |
| NO_ASR_CONTENT | 1 (`p2_u001_001`) |
| RAW_NORMALIZED_CORRECT | 20 |
| RAW_REPAIR_NEEDED | 179 |
| TARGET_NOT_IN_LEXICON | (见 case 字段；eligible 已排除) |
| INVALID_PROFILE_CONTROL | 0 |
| ASR_RESILIENT_CASE | (perturbation ∧ RAW already correct) |
| MODEL2_EFFECT_ELIGIBLE | **148** |
| BASE_ALREADY_HAS_TARGET | **EVIDENCE_GAP**（base candidate items 未冻结） |

Eligible 定义（显式）：

```text
RAW_REPAIR_NEEDED
∧ Lexicon eligible
∧ PROFILE_TARGET / Model2 target case
∧ correct profile has target relation (or P0 N/A)
∧ wrong-profile control valid
∧ Model2 invoked on CORRECT
```

`Base lacks target` 步骤因证据缺口跳过（不静默丢 case）。

---

## 4. RAW ASR baseline (Level 1)

| Metric | Value |
|--------|------:|
| RAW_NORMALIZED_CORRECT | 20 |
| RAW_REPAIR_NEEDED | 179 |
| NO_ASR_CONTENT | 1 |
| RAW_NORMALIZED_CER | ≈ 0.1885 |

---

## 5. Model2 eligibility funnel (primary)

```text
200 Pilot cases
 ↓
179 RAW repair-needed
 ↓
148 Lexicon-eligible target path (effect-eligible)
 ↓
  0 Model2 useful expansion   (0 / 148 = 0%)
 ↓
  0 final improvement attributable to useful expansion
```

Among eligible: **148 / 148** classified `NO_EXPANSION` (`p_added + d_added = 0`).

---

## 6. Model2 candidate expansion (Level 2)

### Candidate field ownership

```text
CANDIDATE_CAP_MAX_OWNER =
path_assembly_candidate_max
← dialog200_path_trace[].assembly.sentence_count
= path-assembly / KenLM path sentence candidates
≠ Model2 union candidate count
```

Replay summary 的 `CANDIDATE_CAP_MAX=1` **不得**解释为 Model2 union。  
另：runner 对 `base_candidates` 使用 `Array.isArray`，而 runtime `compactCandidates` 为 `{count,items}` → 冻结的 base/union **计数恒为 0（schema mismatch）**。  
**可用：** `model2_summary.p_added` / `d_added`（写入 compact 的 `p_action_count` / `d_action_count`）。

### Expansion classes (CORRECT, primary label)

| Class | Rule used |
|-------|-----------|
| MODEL2_NOT_INVOKED | empty RAW / not invoked |
| NOT_ELIGIBLE | target ∉ Lexicon |
| NO_EXPANSION | invoked ∧ p_added+d_added=0 |
| EXPANSION_UNATTRIBUTED_EVIDENCE_GAP | additions>0 但无 candidate items（本批未出现） |

SSOT useful expansion 在 `p_added=d_added=0` 时为 **0**（无法引入正确候选）。  
False expansion 同理 attributed = 0。  
Candidate-membership 级 useful/false 在 additions>0 时仍需完整 path trace（本批不适用）。

### P / D actions

| Condition | P | D |
|-----------|--:|--:|
| NO_PROFILE | 0 | 0 |
| CORRECT_PROFILE | 0 | 0 |
| WRONG_PROFILE | 0 | 0 |

`MODEL2_PERMISSION_CONTRACT_VIOLATION_COUNT = 0`（无 P action 可违例）。

---

## 7. Correct vs No vs Wrong (Level 3, Replay)

| Metric | NO | CORRECT | WRONG |
|--------|---:|--------:|------:|
| FINAL_CER | 0.1926 | 0.1926 | 0.1926 |

| Case-level | Count |
|------------|------:|
| CORRECT_BETTER_THAN_NO | 0 |
| CORRECT_SAME_AS_NO | **200** |
| CORRECT_WORSE_THAN_NO | 0 |
| WRONG_BETTER_THAN_NO | 0 |
| WRONG_SAME_AS_NO | 200 |
| WRONG_WORSE_THAN_NO | 0 |
| ALL_EQUAL (3-way) | **200** |

`PROFILE_GAIN_CER = 0`  
`WRONG_PROFILE_DELTA_CER = 0`

---

## 8. P0–P3

| Stage | Cases | Eligible | Useful | P actions (CORRECT) | Final CER (CORRECT) | Correct better than NO |
|-------|------:|---------:|-------:|--------------------:|--------------------:|-----------------------:|
| P0 | 42 | 0 | 0 | 0 | ≈0.116 | 0 |
| P1 | 52 | 50 | 0 | 0 | ≈0.213 | 0 |
| P2 | 53 | 47 | 0 | 0 | ≈0.232 | 0 |
| P3 | 53 | 51 | 0 | 0 | ≈0.194 | 0 |

无学习曲线上升；非单调问题不适用（全无 expansion）。

---

## 9. Candidate → final conversion

无 useful expansion → conversion 不适用。  
未见 “扩出来但下游未选” 的证据链。

---

## 10. Clean controls

Clean (`CLEAN_PRESERVE`) 在 Replay 三条件下 final 与 NO 相同；无 profile 驱动的 clean regression / false expansion（attributed）。

---

## 11. Relation / domain / user breakdown

各 relation / domain / user 的 useful expansion 均为 **0 / eligible**。  
无单一用户主导 “虚假正向结果”（因无正向 Model2 效果）。明细见 `Block_C_Summary.json` 的 `RELATION_METRICS` / `DOMAIN_METRICS` / `USER_METRICS`。

---

## 12. Holdout aggregate (no case peeking)

| Metric | Value |
|--------|------:|
| Cases | 20 |
| RAW repair-needed | 19 |
| Eligible | 15 |
| Useful expansion | **0 / 15** |
| PROFILE_GAIN_CER | 0 |
| WRONG_PROFILE_DELTA_CER | 0 |

---

## 13. Block B full-audio corroboration

| Metric | Value |
|--------|------:|
| FULL_AUDIO_NO_PROFILE_FINAL_CER | ≈0.1926 |
| FULL_AUDIO_CORRECT_PROFILE_FINAL_CER | ≈0.2705 |
| FULL_AUDIO_WRONG_PROFILE_FINAL_CER | ≈0.1915 |
| RAW stable cases | 118 |
| RAW variance cases | 82 |

**禁止**对 variance cases 声称 profile causality。  
CORRECT 全音频 CER 更差，更可能反映 **RAW ASR variance / 随机性**，不能解释为 Replay 已否定的 Model2 profile effect。

Stable subset (118)：CORRECT vs NO 方向与 Replay 一致为 **SAME**（118 both-same）。

---

## 14. Failure ownership (eligible, Replay)

主损失点：

```text
L3_MODEL2_ELIGIBLE_BUT_NO_EXPANSION
```

（148 eligible 全部无 P/D 增量。）

部分 repair-needed 的 final 仍错，但因无 Model2 expansion，不归因为 L5/L6 Model2 路径。

---

## 15. Known limitations

1. **Tone Replay = NOT_INVOKED**（缺 `asrSegments` / `acousticToneSlices`）→ 控变量 attribution 有效，非 bit-identical full-audio。
2. **Base candidate items 未冻结** → `BASE_ALREADY_HAS_TARGET` 不可证；不影响 “P/D=0 ⇒ useful=0” 的结论。
3. **base/union counts schema mismatch** → 不得使用冻结的 base/union 计数字段。
4. Block B CORRECT CER 升高 **不可**当作 profile harm 的因果结论。

---

## 16. Final Model2 verdict

```text
MODEL2_PROFILE_EFFECT_NOT_OBSERVED
MODEL2_EXPANSION_VERDICT = MODEL2_EXPANSION_NOT_OBSERVED
FINAL_REPAIR_CONVERSION_VERDICT = FINAL_REPAIR_CONVERSION_NOT_APPLICABLE_NO_USEFUL_EXPANSION
```

回答主问题：

> 在 RAW 需修、Lexicon eligible、正确 profile relation 适用、Model2 被调用的 148 个 case 中，Model2 **没有**引入任何 P/D 候选扩展，因此也没有引入 useful target。

次问题（conversion）因 useful=0 不适用。

---

## 17. One next optimization owner

```text
ONE_NEXT_OWNER = MODEL2_PROFILE_PERMISSION / P ACTION
```

Funnel 最大损失：eligible 后 **零 P action / 零 useful expansion**。  
**不要**同时改 Recall / KenLM / Lexicon / Tone。其余观察（完整 candidate 落盘、Tone 复现）→ **DEFERRED**。

Block C 结束后 **STOP** — 不自动开发下一 delta。

---

## Evaluator acceptance

```text
INPUT_IDENTITIES_VERIFIED = PASS
NO_RUNTIME_MUTATION = PASS
NO_PIPELINE_REEXECUTION = PASS
CASE_ACCOUNTING_COMPLETE = PASS
DENOMINATORS_EXPLICIT = PASS
USEFUL_EXPANSION_DEFINITION_MATCHES_SSOT = PASS
FALSE_EXPANSION_DEFINITION_MATCHES_SSOT = PASS
NORMALIZED_QUALITY_LOGIC_REUSED = PASS
REPLAY_AND_BLOCK_B_EVIDENCE_SEPARATED = PASS
HOLDOUT_GOVERNANCE = PASS
DETERMINISTIC = PASS
```

Model2 score **不是** evaluator acceptance gate。

---

## Artifacts

| File | Role |
|------|------|
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Block_C_Profile_Aware_Evaluation_Report.md` | This report |
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Block_C_Summary.json` | Machine summary |
| `test wav/.../block_c_eval/blockc_replay_2026-09-11T1347/evaluation_cases.jsonl` | Per-case derivation |
| `.../evaluation_aggregate.csv` | Compact aggregates |
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_SSOT.md` | Phase/evidence update |
| `docs/user_correction/model3/run_pilot200_block_c_evaluator.mjs` | Deterministic evaluator |
