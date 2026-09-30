# STRICT quality analysis

## Definition

CLD one-character lexical entries with FrequencySUBTL>=10 AND FrequencyWeibo>=10.

## Size

- rows: 1125
- unique characters: 1125
- pinyin+tone groups: 752 (unique 515, ambiguous 237, max 7)

## Strength

- Real wordhood signal (CLD lexical entry), not IME common-character list.
- Dual-corpus frequency gate reduces rare/literary/technical tail vs FULL CLD.
- Function words at top of frequency lists are retained (见 function protection check).
- README already designated STRICT as initial production candidate.

## Main coverage risk

- Mid-frequency spoken words in BALANCED-only band may be absent.
- Grouping audit showed unique-only Recall precision issues remain even with STRICT — that is a **Recall contract** limitation, not a reason to widen the lexicon for ambiguity cosmetics.

## Production suitable (content)?

**YES** as V1 content strategy, subject to license review before freeze/import.
