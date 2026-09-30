# LINGUA_PILOT200_PRE_EDGE_TARGETED_REMEASURE_REPORT

| Field | Value |
|-------|-------|
| Date | 2026-09-12 |
| Nature | TRACE-FIRST TARGETED REMEASURE |
| AUTHORITATIVE_MODEL2_SSOT | AUG12_PRE_LEXICAL_EDGE |

## A. Evidence identity

```text
CAPTURE_BATCH = tonecap_2026-09-12T0001
REPLAY = /run-lexicon-mock + frozen segments + utterance_tone
PROFILE = CORRECT_PROFILE (case profileRef)
DATASET = LINGUA_DIALOG2000_V2_PILOT200 / build_20260911_091806
MODEL2 = production pre-edge expandWindowsWithModel2
```

## B. 7-case result table

| caseId | target | rawSurface | A | B | C | Tone | D | E | F | G | seg | final | FIRST | OWNER |
|--------|--------|------------|---|---|---|------|---|---|---|---|-----|-------|-------|-------|
| p2_u001_016 | 礼宾部 | 李守步 | PASS | PASS | PASS | YES | PASS | FAIL | FAIL | FAIL | NO | NO | E | LEXICON_RECALL |
| p2_u001_002 | 奶精 | 来精 | PASS | PASS | PASS | NO | FAIL | FAIL | FAIL | FAIL | NO | NO | D | TONE_QUERY |
| p2_u002_016 | 咖啡师 | 咖啡丝 | PASS | PASS | PASS | YES | PASS | FAIL | FAIL | FAIL | NO | NO | E | LEXICON_RECALL |
| p2_u003_001 | 营运证 | 营运真 | PASS | PASS | PASS | NO | FAIL | FAIL | FAIL | FAIL | NO | NO | D | TONE_QUERY |
| p2_u004_001 | 生成 | 升层 | PASS | PASS | PASS | YES | PASS | PASS | PASS | PASS | YES | NO | DOWNSTREAM | DOWNSTREAM |
| p2_u003_016 | 换乘 | 翻成 | PASS | PASS | PASS | YES | PASS | FAIL | FAIL | FAIL | NO | NO | E | LEXICON_RECALL |
| p2_u001_004 | 内处理 | 类处理 | PASS | PASS | PASS | YES | PASS | FAIL | FAIL | FAIL | NO | NO | E | LEXICON_RECALL |

## C. First-failure ownership

- **p2_u001_016** (礼宾部): FIRST=E OWNER=LEXICON_RECALL
- **p2_u001_002** (奶精): FIRST=D OWNER=TONE_QUERY
- **p2_u002_016** (咖啡师): FIRST=E OWNER=LEXICON_RECALL
- **p2_u003_001** (营运证): FIRST=D OWNER=TONE_QUERY
- **p2_u004_001** (生成): FIRST=DOWNSTREAM OWNER=DOWNSTREAM
- **p2_u003_016** (换乘): FIRST=E OWNER=LEXICON_RECALL
- **p2_u001_004** (内处理): FIRST=E OWNER=LEXICON_RECALL

## D. Real path verdict

```text
REAL_PRE_EDGE_MULTI_CHAR_MODEL2_PATH = PROVEN
GATE_A_PASS = 7/7
GATE_B_PASS = 7/7
GATE_C_PASS = 7/7
GATE_D_PASS = 5/7
GATE_E_PASS = 1/7
GATE_F_PASS = 1/7
GATE_G_PASS = 1/7
TARGET_EDGE_SURVIVAL_COUNT = 1
FINAL_REPAIR_CORRECT_COUNT = 0
```

## E. Full Pilot readiness

```text
FULL_PILOT200_REMEASURE_READY = YES
```

## F. One next owner

```text
ONE_NEXT_OWNER = FULL_PILOT200_REMEASURE
```

**STOP.** No code changes.
