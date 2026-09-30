# Lingua1 — Evaluation Contract Repair V1 Development Report

```text
MODE = CONTRACT_REPAIR / EVALUATION_LAYER_ONLY / NO_PRODUCTION_CHANGE
```

## 1. Changed files

| Path | Change |
|------|--------|
| `docs/user_correction/model3/LINGUA_EVALUATION_SSOT_V1.md` | **NEW** EVALUATION_SSOT_V1 concept freeze |
| `electron_node/electron-node/tests/lib/evaluation-ssot-v1.mjs` | **NEW** SSOT + replay capability + metric contracts |
| `electron_node/electron-node/tests/lib/evaluation-contract-repair-v1.test.mjs` | **NEW** T1–T8 |
| `electron_node/electron-node/tests/lib/materializable-target-v1.mjs` | Rename `requires_lexical` → `is_reference_diff_hunk`; replace `LEXICON_TARGET_ABSENT` with `REFERENCE_DIFF_SURFACE_NOT_RECALLED` |
| `electron_node/electron-node/tests/audit-dialog200-e2e-correct-candidate-funnel.mjs` | E1/first_loss honor NOT_EVALUABLE; retire `required_lexical_units` as lexicon authority |
| `electron_node/electron-node/tests/audit-dialog200-recall-model2-first-loss-decomp.mjs` | Diff→LEXICON_COVERAGE FAIL removed; tone-missing → NOT_EVALUABLE |
| Multiple Model3 audit harnesses | Mechanical field rename only |
| `tests/run-dialog200-stagej-full-path-trace.mjs` | Recognize new divergence class |

**Production files touched = NONE**

## 2. Removed invalid evaluator logic

| Invalid behavior | Replacement |
|------------------|-------------|
| Diff hunk `expected_text` ⇒ `required_lexical_units` ⇒ lexicon MUST contain | `reference_diff_regions` (diagnostic); `LEXICAL_TARGET` only via authoritative annotation |
| `requires_lexical` name implying lexicon membership | `is_reference_diff_hunk` |
| `LEXICON_TARGET_ABSENT` from missing diff surfaces | `REFERENCE_DIFF_SURFACE_NOT_RECALLED` + `measurement_status: NOT_EVALUABLE` |
| same-char-length ⇒ production phonetic COMPATIBLE / Base FAIL | `DIAGNOSTIC_STRING_COMPATIBILITY` only; tone-missing ⇒ NOT_EVALUABLE |
| QUERY_ISSUED conflating call vs tone_exact SQL | `RECALL_FUNCTION_CALLED` vs `VALID_TONE_EXACT_QUERY_EXECUTED` |
| Model2 P miss under mock ⇒ capability FAIL | `MODEL2_P_CAPABILITY = NOT_EVALUABLE` |

No deprecated dual-path / legacy evaluator branch retained.

## 3. EVALUATION_SSOT_V1 location

- Doc: `docs/user_correction/model3/LINGUA_EVALUATION_SSOT_V1.md`
- Code: `electron_node/electron-node/tests/lib/evaluation-ssot-v1.mjs`

Hard rule encoded: **Evaluator output is evidence, not production specification.**

## 4. Replay capability matrix

`REPLAY_CAPABILITY_MATRIX` in `evaluation-ssot-v1.mjs`.

For `LEXICON_MOCK_REPLAY` (no acoustic tone):

| Stage | Capability |
|-------|------------|
| REFERENCE_DIFF | EVALUABLE |
| LEXICAL_TARGET | ONLY_IF_AUTHORITATIVE_ANNOTATION |
| BASE_TONE_EXACT_QUERY | NOT_EVALUABLE |
| MODEL2_P_ACTION | NOT_EVALUABLE |
| FINAL_OUTPUT | EVALUABLE |

## 5. Metric contract definitions

`METRIC_CONTRACTS`: `BASE_TONE_EXACT_RECALL`, `MODEL2_P_CAPABILITY`, `LEXICON_COVERAGE`, `FINAL_SENTENCE_CORRECTNESS` — each with concept / measurement / evidence / environment / fail_condition.

`assertFailGate()` refuses FAIL when environment unsatisfied → forces NOT_EVALUABLE.

## 6. Consumer migration

| Consumer | Class | Action |
|----------|-------|--------|
| e2e correct-candidate funnel | INVALID_LEXICAL_AUTHORITY_USE | Fixed |
| recall/model2 first-loss decomp | INVALID_LEXICAL_AUTHORITY_USE | Fixed |
| materializable-target-v1 producer | ambiguous field name | Renamed |
| Model3 retry/localization audits | VALID_DIAGNOSTIC_USE (localization) | Field rename only |
| evaluator-validity audit (historical) | evidence dump | Field rename; not re-run as FAIL gate |

`invalid_diff_to_lexical_consumers_removed` = **2** primary FAIL-gate consumers (funnel + decomp).

## 7. Test results T1–T8

```text
PASS T1 Diff fragment protection
PASS T2 Missing lexical annotation → NOT_EVALUABLE
PASS T3 Lexicon mock without Tone → NOT_EVALUABLE
PASS T4 Recall called vs query executed separation
PASS T5 Model2 P unavailable → NOT_EVALUABLE
PASS T6 Diagnostic proxy isolation
PASS T7 Authoritative lexical target allows coverage FAIL/PASS
PASS T8 No production behavior delta (eval-layer invariants)
ALL T1–T8 PASS
```

Also: `materializable-target-v1.test.mjs` → 12/12 pass after rename.

## 8. Production files touched

**NONE**

## 9. Before / After measurement comparison

| Old (invalid) | New |
|---------------|-----|
| 57 fake LEXICON_COVERAGE from diff hunks | Without annotation → NOT_EVALUABLE (no FAIL) |
| Base miss under mock → BASE_RECALL FAIL | tone missing → NOT_EVALUABLE |
| Model2 0 generate under mock → Model2 FAIL | P evidence absent → NOT_EVALUABLE |
| R3 same-char-length COMPATIBLE | diagnostic proxy only |
| QUERY_ISSUED=YES + miss → FAIL | CALL=YES / VALID_QUERY=NO / STATUS=NOT_EVALUABLE |

Expected: fake FAIL counts drop; NOT_EVALUABLE / UNKNOWN rise. This is correct.

## 10. Remaining NOT_EVALUABLE areas

- Base tone_exact under LEXICON_MOCK_REPLAY without acoustic slices
- Model2 P-path without `p_feature_presence` / acoustic
- Any lexicon-coverage metric without authoritative lexical annotation
- Live dialog_200 full re-funnel not required this round (measurement repair only)

## 11. Remaining true data issues

Prior audit **20 TRUE_LEXICON_COVERAGE leads** remain **LEXICON_EXPANSION_LEADS** only — not admitted this round (`会划` / `声城` / `边骑` still need independent lexical admission).

## 12. Deferred items

- Authoritative lexical annotation schema for dialog_200 cases
- Live/audio replay harness for Base tone_exact + Model2 P evaluation
- Optional re-run of dialog_200 LEXICON_MOCK_REPLAY to publish new measurement histogram (not accuracy chase)

## Acceptance gates

| Gate | Status |
|------|--------|
| G1 Diff ↛ Lexical | PASS |
| G2 requires_lexical semantic | PASS (renamed) |
| G3 tone-missing ≠ Base FAIL | PASS |
| G4 P-missing ≠ Model2 FAIL | PASS |
| G5 CALL vs QUERY separated | PASS |
| G6 FAIL requires full chain | PASS (`assertFailGate`) |
| G7 No production change | PASS |
| G8 No lexicon expansion | PASS |
| G9 No Model2 retrain | PASS |
| G10 No dual evaluator path | PASS |
