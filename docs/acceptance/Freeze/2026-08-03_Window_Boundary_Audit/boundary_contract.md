# Boundary / Pruning Contract

Freeze: `FW_V4_FREEZE_2026_08_03` · Lattice Phase 1

## Window generation bounds

| Rule | Lattice (`buildLexicalWindowQueries`) | Legacy LTR (`generateGlobalWindows`) |
|------|----------------------------------------|--------------------------------------|
| Min length | **1** syllable | `V4_LIMITS.windowMinSyllables` = **2** |
| Max length | **5** syllables | `V4_LIMITS.windowMaxSyllables` = **5** |
| Emit policy | All contiguous `[start,end)` in range | Same sliding, min 2 |
| Coarse cross | Soft metadata (`hardBlockOnBoundaryCross=false`) | Hard if `boundaryCrossCount > maxBoundaryCrossCount` |
| Empty coarse refs | Allowed | Rejected (`allowEmptyCoarseRefs=false`) |

Theoretical count: `theoreticalLexicalWindowCount(N, 5)` — every start emits `min(5, N-start)` windows.

## Hard blocks (`latticeHardBlockFilter`)

Applied **after** generation. Sole reasons:

| Reason | Meaning |
|--------|---------|
| `raw_gap_between_spans` | Coarse spans in window not contiguous in raw |
| `whitespace_gap` | Whitespace inside `[rawStart, rawEnd)` |
| `punctuation_in_window` | Punctuation inside window slice |
| `sentence_boundary` | Sentence punct inside window slice |
| `non_cjk_syllable` | Non-CJK (non-space/non-punct) inside slice |
| `asr_word_gap_ms` | Adjacent word timestamps gap > `V4_LIMITS.asrWordGapMs` (400ms) |

**Not** a Lattice-only hard block:

- Coarse `boundaryCrossCount` (soft; `softClearBoundaryCrossHardBlock`)

## What does NOT prune at Window generation

| Mechanism | At Window emit? |
|-----------|-----------------|
| TopK | No (Recall-stage) |
| Beam / `maxActivePathsPerPosition` | No (Path enumeration later) |
| `maxCompleteSegmentationPaths` | No |
| Overlap / compatibility drop | No (Candidate stage) |
| `maxGlobalWindowCount` (120) | Lattice Phase1 full emit — **not** applied in `buildLexicalWindowQueries`. Used in LTR `blocked-window-filter.ts`. |
| Tone / Query Builder | After Window |

## Syllable SSOT

- Input: **ASR Raw text only** (not expectedText).
- `textToSyllables` = pinyin-pro `toneType:'none'` per CJK run.
- Expected “我们正在” syllables are **not** used to build windows for noise cases.

## Timestamp

- Word timestamps affect **hard block** (`asr_word_gap_ms`) and later Tone extract.
- They do **not** redefine `syllableStart/End` or `windowText`.
