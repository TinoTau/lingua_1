# LINGUA_MODEL2_P_RETRIEVAL_EMPTY_HIT_CONTRAST_AUDIT

**Phase:** `LINGUA_MODEL2_P_RETRIEVAL_EMPTY_HIT_CONTRAST_AUDIT`  
**Mode:** READ-ONLY / TRACE FIRST / NO FIX  
**Evidence:** frozen tone Replay `tonereplay_2026-09-12T0001` + fresh CORRECT TRACE (`MODEL2_DIALOG200_TRACE=1`)  
**Lexicon:** read-only `node_runtime/lexicon/v3/lexicon.sqlite`

---

## 0. Question

Why does **one** Tone-ready P-action case hit (`p2_u001_016`) while **six** Tone-ready P-action cases return `P_RETRIEVAL_RUN_EMPTY`?

Excluded from 6-vs-1 contrast: `p2_u002_001` (`NO_P_ACTION`).

---

## 1. Method

1. Accept prior verdicts (Tone evidence Replay PASS; `P_RETRIEVAL_TONE_NOT_READY` RESOLVED).
2. Re-run CORRECT_PROFILE only for 7 cases with frozen RAW/segments/slices + `MODEL2_DIALOG200_TRACE=1` → exact FineSpan + `pinyin_key` + hits.
3. Read-only SQLite checks on generated keys vs expected evaluation targets.
4. Compare to positive control.

No Model2 / Tone / Lexicon / dataset writes.

---

## 2. Positive control — `p2_u001_016`

| Field | Value |
|-------|-------|
| referenceText | 麻烦你帮我核对这份关于礼宾部的说明。 |
| frozenRawText | 麻烦你帮我核对这份关于李守步的说明 |
| evaluationTarget | **礼宾部** (`li\|bin\|bu` / `li3\|bin1\|bu4`) — **present in lexicon** |
| selected P | `single:n_l`, `single:in_ing` |
| phonetic_bias | U001 P2 (includes n_l, in_ing) |

### KNOWN-GOOD retrieval trace (actual)

| Field | Value |
|-------|-------|
| POSITIVE_RELATION | `n_l` (also selected `in_ing`, empty) |
| POSITIVE_DIRECTION | profile `n_l` = intended N → observed L; retrieval uses **OPPOSITE** `l_n` |
| POSITIVE_SPAN | FineSpan **"李"** `[11,12]`, phon=`li`, tone_repr=`[3]` |
| POSITIVE_TRANSFORMED_PRONUNCIATION | `li` → **`ni`** |
| POSITIVE_RECALL_KEYS | `pinyin_key=ni` (len=1) |
| POSITIVE_QUERY_TIER | Tone-first `recallSpanTopKV2` (`ready`) |
| POSITIVE_RAW_LEXICON_ROWS | hit **尼** (`base-single-char-term-e5b0bc7c6e69`, `ni2`) |
| POSITIVE_MATERIALIZED_TERMS / P_ADDED | **尼** (not 礼宾部) |

```text
POSITIVE_CONTROL_TRACE_VALID = YES
```

**Critical:** success is a **single-character** lexicon hit after relation flip on FineSpan "李".  
Evaluation target **礼宾部 was never queried** (`li|bin|bu` unused).

Secondary query on FineSpan "明" (`ming` → `in_ing` → `min`) → 0 rows (no `min` len=1).

Harness prior run `p_hits=2` = two paths each adding the same 尼 hit; TRACE path-best shows `p_hits=1`. Same mechanism.

---

## 3. Empty cases — exact queries

Relation direction in all cases: **OPPOSITE_DIRECTION applied correctly** (observed → intended).

| caseId | target (in DB?) | FineSpan(s) | action | transformed key | toneReady | runtime hits | pinyin-only len match | firstZeroStage |
|--------|-----------------|-------------|--------|-----------------|-----------|--------------|----------------------|----------------|
| p2_u001_002 | 奶精 `nai\|jing` YES | 来 / 精 | n_l / in_ing | **nai** / **jin** | ready | [] / [] | nai:**0** / jin:**8** | LEXICON_NO_PINYIN_LEN_MATCH / TONE_EXACT_NO_HIT |
| p2_u002_016 | 咖啡师 YES | 丝搭 / 丝 | sh_s | **shi\|da** / **shi** | mixed no_pattern+ready | [] | 1 / 16 | TONE_NOT_READY or TONE_EXACT_NO_HIT |
| p2_u003_001 | 营运证 YES | 真 | eng_en | **zheng** | ready | [] | 4 | TONE_EXACT_NO_HIT |
| p2_u004_001 | 生成 YES | 层 | ch_c | **cheng** | ready | [] | 4 | TONE_EXACT_NO_HIT |
| p2_u003_016 | 换乘 YES | 翻 | h_f | **han** | ready | [] | 5 | TONE_EXACT_NO_HIT |
| p2_u001_004 | 内处理 YES | 类 / 理 | n_l | **nei** / **ni** | ready | [] | 1 / 2 | TONE_EXACT_NO_HIT |

### Per-case notes

**p2_u001_002**  
- Expected useful query would be ~`nai|jing`+tones for 奶精.  
- Actual: mono keys `nai` (no len=1 lexicon rows at all) and `jin` (jin1 rows exist: 今/金) but tone-exact returned 0.  
- Target present; **never queried as multi-syl**.

**p2_u002_016**  
- Expected `ka|fei|shi`. Actual `si`→`shi` / `si|da`→`shi|da`.  
- `shi4` would have rows; tone-exact miss. Path summary can surface `TONE_NOT_READY` when a span reports `no_pattern` (path-level first pattern length mismatch on 2-syl span).

**p2_u003_001**  
- 真 `zhen`→`zheng` (eng_en). Target 营运证 never queried. `zheng1`/`zheng4` exist; exact tone miss.

**p2_u004_001**  
- 层 `ceng`→`cheng` (ch_c). 生成 never queried. `cheng2` exists; exact tone miss.

**p2_u003_016**  
- 翻 `fan`→`han` (h_f). 换乘 never queried. `han1` absent; `han2` present — exact tone miss.

**p2_u001_004**  
- 类→`nei`, 理→`ni`. 内处理 never queried.  
- **Especially decisive:** FineSpan "理" phon=`li` tone_repr=`[3]` → key `ni`; `ni3`(**你**) exists in DB, yet runtime hits=0 → query tone ≠ this FineSpan’s rebind tone.

---

## 4. FIRST_DIVERGENCE_FROM_POSITIVE_CONTROL

Shared pipeline for HIT and EMPTY:

```text
FineSpan (usually 1 syllable)
→ Model2 P action
→ OPPOSITE relation on FineSpan syllables only
→ Tone-first SQL (pinyin_key + tone_pinyin_key + length)
```

Divergence:

```text
Positive: short key "ni" + path tone digits → ≥1 base_lexicon row → p_added
Empty:    short keys either
          (a) no len-matched pinyin rows, or
          (b) pinyin rows exist but tone-exact miss → 0 hits
```

Evaluation multi-char targets are **in lexicon** for all 6 EMPTY + positive, but **not on the query path**.

---

## 5. Architecture drift (Tone key)

```text
ARCHITECTURE_DRIFT_FOUND = YES
```

| | |
|--|--|
| FROZEN_EXPECTATION | `relation-lexicon-adapter`: acousticTonePattern **for the FineSpan**; tones align to that span’s hypothesized syllables |
| CURRENT_IMPLEMENTATION | `span-assembly-v4-orchestrator.ts` takes **first** FineSpan with non-empty `toneRebindTrace.acousticTonePattern` and passes that **one path-level array** into `expandActiveCandidatesWithModel2` for **all** spans |
| FIRST_DIVERGENCE | orchestrator ~L405–420 → `expand-active-candidates.ts` uses `args.acousticTonePattern` for every span’s `executeProfileLexiconQueries` |
| IMPACT | Wrong `tone_pinyin_key` for non-first spans → false `P_RETRIEVAL_RUN_EMPTY` even when intended mono-char rows exist (e.g. 理→你) |

This is **not** a Tone-gate failure (`ready` still observed). It is tone-**key construction / binding** under path-shared pattern.

---

## 6. Relation direction audit

```text
RELATION_DIRECTION_MISMATCH = NO
RELATION_DIRECTION_CORRECT = YES
```

Profile / ACTIVE_SET `X_Y` = intended→observed; runtime retrieval uses `OPPOSITE_DIRECTION` consistently (e.g. `n_l`→`l_n`, `sh_s`→`s_sh`, `h_f`→`f_h`).

---

## 7. Lexicon coverage vs not-retrieved

| Metric | Count |
|--------|-------|
| TERM_ABSENT_FROM_LEXICON (evaluation targets) | **0** / 7 |
| TERM_PRESENT_BUT_NOT_RETRIEVED (evaluation targets) | **7** / 7 (including positive’s 礼宾部) |
| Mono-key `nai` len=1 absent | 1 (p2_u001_002 partial) |

Do **not** jump to “expand lexicon for 奶精/礼宾部” — those terms already exist; queries never ask for their multi-syl keys.

---

## 8. Owner classification (6 EMPTY)

| caseId | Primary owner | Secondary |
|--------|---------------|-----------|
| p2_u001_002 | **F. TONE_KEY_OWNER** + **H. LEXICON_COVERAGE_OWNER** (nai len=1) | A. SPAN_OWNER (target multi-syl never queried) |
| p2_u002_016 | **F. TONE_KEY_OWNER** | A. SPAN_OWNER |
| p2_u003_001 | **F. TONE_KEY_OWNER** | A. SPAN_OWNER |
| p2_u004_001 | **F. TONE_KEY_OWNER** | A. SPAN_OWNER |
| p2_u003_016 | **F. TONE_KEY_OWNER** | A. SPAN_OWNER |
| p2_u001_004 | **F. TONE_KEY_OWNER** (理→ni3 exists but missed) | A. SPAN_OWNER |

```text
P_EMPTY_CASE_COUNT = 6
P_POSITIVE_CONTROL_COUNT = 1

P_EMPTY_OWNER_DISTRIBUTION = {
  "TONE_KEY_OWNER": 6,
  "SPAN_OWNER": 6,
  "LEXICON_COVERAGE_OWNER": 1
}
```

(SPAN is structural co-owner on all six for *evaluation-target* miss; **first zero on the executed short query** is dominated by Tone-key / path binding.)

```text
FIRST_COMMON_EMPTY_OWNER = TONE_KEY_OWNER
```

(path-level first-FineSpan `acousticTonePattern` reused for all FineSpans)

```text
EXPECTED_NO_VALID_CANDIDATE_COUNT = 0
```

(Not used as primary: several empty queries would have mono-char candidates under correct per-span tones; evaluation-target absence is SPAN geometry, not “no useful candidate possible”.)

---

## 9. Decisive fields

```text
POSITIVE_CONTROL_TRACE_VALID = YES
P_RETRIEVAL_EXECUTION_CORRECT = YES
RELATION_DIRECTION_CORRECT = YES
PINYIN_TRANSFORM_CORRECT = YES
TONE_KEY_CONSTRUCTION_CORRECT = NO
LEXICON_QUERY_CORRECT = PARTIAL
  (SQL shape correct; bound tone digits often wrong vs FineSpan rebind)

TERM_ABSENT_CASE_COUNT = 0
TERM_PRESENT_BUT_NOT_RETRIEVED_COUNT = 7
EXPECTED_NO_VALID_CANDIDATE_COUNT = 0

FIRST_COMMON_EMPTY_OWNER = TONE_KEY_OWNER
```

D path: observe only; no shared-owner claim required for this P verdict.

---

## 10. Answer in one paragraph

`p2_u001_016` “wins” because a **1-char** FineSpan ("李") flips `li→ni` and Tone-first retrieval finds **尼** — not because 礼宾部 was recalled. The six EMPTY cases run the **same** short-span + OPPOSITE + Tone-first machinery, but their generated short keys get **tone-exact misses** (and sometimes no len-matched pinyin rows), largely because the orchestrator feeds **one path-level tone pattern (first FineSpan)** into every span’s P query. All six evaluation targets remain present in SQLite under multi-syllable keys that are never issued.

---

## 11. Next delta (one only)

```text
ONE_NEXT_OWNER = TONE_KEY_OWNER
ONE_RECOMMENDED_NEXT_DELTA =
  Align Model2 P recall to per-FineSpan toneRebindTrace.acousticTonePattern
  (stop path-level first-pattern reuse); re-measure 6-vs-1 under frozen Tone evidence.
  Do not expand lexicon for these targets; do not bypass Tone gate; do not touch tone_bias.
```

STOP.
