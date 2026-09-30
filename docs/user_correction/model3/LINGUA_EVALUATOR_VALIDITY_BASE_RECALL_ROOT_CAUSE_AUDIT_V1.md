# Lingua1 — Evaluator Validity + Base Recall First-Loss Root-Cause Audit V1

```text
MODE = READ_ONLY / TRACE_FIRST / CONTRACT_FIRST / NO_IMPLEMENTATION
RESULT F — MULTIPLE INDEPENDENT ROOT CAUSES
```

## Executive verdict

连续审计里大量“低级 upstream failure”主要不是 production Base/Model2 突然坏了，而是：**（1）测评把 ASR↔expected 对齐差分 hunk 当成词库必收 term**；**（2）lexicon-mock 无声学 tone 时 Base/Model2 P 按 Frozen Fail Closed 本就不可评测**。二者都必须与真正的词库缺口分开。

## Table A — Previous 57 Lexicon-Absence Reclassification

| Class | Count | % |
|-------|------:|--:|
| EVALUATOR_NON_LEXICAL_TARGET | 37 | 64.91 |
| TRUE_LEXICON_COVERAGE | 20 | 35.09 |

TRUE examples: d008:三期, d014:四十, d015:一下, d027:薪资, d030:会划, d032:几点, d042:续费, d043:声城, d052:延安, d072:薪资, d075:会划, d088:声城, d092:谢谢, d133:声城, d162:薪资, d177:续费, d178:声城, d194:四十, d196:边骑, d197:七点

EVALUATOR examples: d004:结论发, d009:京soho, d011:挂号处请问内科还, d011:号吗, d019:们团队, d029:下周一, d029:午交吗, d029:交吗, d037:位置吗, d037:香菜微辣, d041:衣室柜子, d059:四十, d082:香菜微辣, d084:包吗, d086:衣室柜子, d087:续费有优惠吗, d094:陈客户, d094:三点, d094:结论发, d099:soho不, d104:四十, d106:周末要, d111:成链路, d111:线计划, d112:订单显

## Table B — Lexical Validity

| Target type | Count | Valid lexicon target? |
|-------------|------:|:---------------------:|
| VALID_LEXICAL_TERM | 20 | YES |
| AMBIGUOUS | 19 | NO |
| ALIGNMENT_ARTIFACT | 19 | NO |
| MULTI_WORD_PHRASE | 10 | NO |
| SENTENCE_FRAGMENT | 7 | NO |
| NON_LEXICAL_DIFF_FRAGMENT | 7 | NO |
| NORMALIZATION_ARTIFACT | 4 | NO |

## Table C — Evaluator Contract

| Check | Frozen | Actual | Match? |
|-------|--------|--------|--------|
| MATERIALIZABLE mode | Lexicon terms only; diff region ≠ lexical target | expected/ASR string diff + alignment-derived substring (Needleman–Wunsch hunks) | false |
| requires_lexical ⇒ lexicon must contain whole unit | NO | Prior audits treated unit.expected_text as required lexicon surface | false |
| Module self-description vs consumer | diagnostics-only OK | Consumers over-promoted units to production MUST-HAVE | PARTIAL |

MATERIALIZABLE mode = **B+C**: expected/ASR string diff + alignment-derived substring (Needleman–Wunsch hunks)

Contract defect (misuse as lexicon MUST-HAVE): **YES**

- deriveCorrectionUnits: alignChars(norm(ASR), norm(expected))
- requires_lexical = (SUBSTITUTE || INSERT) with no lexicon membership gate
- File header: diagnostics-only recoverability; does not affect candidate selection

Frozen conflict: S3 FROZEN: REFERENCE_DIFF_REGION ≠ LEXICAL_TARGET. Lexicon recalls lexical candidates; must not store expected-diff fragments.

## Table D — Base Recall Trace Funnel

| Stage | Count / note |
|-------|--------------|
| B0_TARGET_DB_ROW_EXISTS PRESENT | 52 |
| B1_QUERY_KEY_COMPATIBLE | 0 (prior R3 invalid for production) |
| B2_SQL executed | 0 |
| B2 NOT_EXECUTED_TONE_FAIL_CLOSED | 52 |
| B3–B8 | UNKNOWN (SQL never ran) |
| B9_TARGET_IN_BASE_RETURN | 0 |

```json
{
  "production_mode": "tone_exact Mandatory Tone Fail Closed",
  "fuzzy_default": false,
  "pinyin_only_fallback_first_pass": false,
  "query_key_source": "ASR window syllables (not expected)",
  "prior_R3_vs_production": "PRIOR_LOOSER (same-char-length ≠ pinyin+tone exact)",
  "prior_R4_vs_correct_query": "QUERY_CALLED ≠ CORRECT_QUERY (toneSqlCount=0 under mock)",
  "implementation_defect_count": 0,
  "architecture_defect": "NO"
}
```

## Table E — Base Recall First-Loss Distribution

| Root | Count | Failure Class |
|------|------:|---------------|
| TONE_CONTRACT_MISMATCH | 19 | REPLAY / OBSERVABILITY LIMITATION |
| EVALUATOR_TARGET_OR_NONLEXICAL | 33 | TEST / EVALUATOR DEFECT |

## Table F — Problem Origin Matrix

| Origin | Count | % |
|--------|------:|--:|
| REPLAY_OBSERVABILITY_LIMITATION | 78 | 46.43 |
| TEST_EVALUATOR_DEFECT | 70 | 41.67 |
| LEXICON_DATA_COVERAGE | 20 | 11.9 |

## Table G — Representative Evidence

| Bucket | Evidence |
|--------|----------|
| EVALUATOR fragment | d011 `挂号处请问内科还` len=8 |
| EVALUATOR alignment | d019 `们团队` |
| EVALUATOR multi-word | d037/d082 `香菜微辣` = 香菜+微辣 |
| TRUE coverage lead | `薪资`/`三期`/`续费` 等 2 字且无邻接词库跨界 |
| Base tone fail-closed | 52 cohort: toneSqlCount=0 under lexicon-mock |
| Model2 replay | 59: NOT_EVALUABLE_UNDER_CURRENT_REPLAY |

## Model2 Replay Confirm

```json
{
  "count": 59,
  "MODEL2_CAPABILITY_STATUS": "NOT_EVALUABLE_UNDER_CURRENT_REPLAY",
  "reason": "NO_P_ACTION / p_feature_presence=false / no acoustic slices under lexicon-mock",
  "harness_limitation": true
}
```

## Answers Q1–Q10

- **Q1**: 20 / 57 = 35.09% case-level TRUE_LEXICON_COVERAGE
- **Q2**: 37 / 57 = 64.91% EVALUATOR_NON_LEXICAL_TARGET (AMBIGUOUS 0)
- **Q3**: YES
- **Q3_detail**: Defect is consumer misuse: funnel/decomp treated correction units as production lexicon MUST-HAVE terms
- **Q4**: 52
- **Q5**: {"TONE_CONTRACT_MISMATCH":19,"EVALUATOR_TARGET_OR_NONLEXICAL":33}
- **Q6**: NO (Violation_demonstrated=NO; Fail Closed matches Frozen tone_exact)
- **Q7**: NO
- **Q8**: NO — NOT_EVALUABLE_UNDER_CURRENT_REPLAY
- **Q9**: MULTIPLE (EVALUATOR + REPLAY; residual DATA)
- **Q10**: EVALUATOR

## Final Result

```text
RESULT F — MULTIPLE INDEPENDENT ROOT CAUSES
NO PRODUCTION CHANGE / NO EVALUATOR PATCH THIS ROUND / NO LEXICON CHANGE
```

## Artifacts

- `LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_TRACE_V1.jsonl`
- `LINGUA_EVALUATOR_VALIDITY_BASE_RECALL_SUMMARY_V1.json`
