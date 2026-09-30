# Model3 Corruption Taxonomy V1 Proposal

**Purpose:** TRAINING DATA GENERATION ONLY — never a runtime rule table.

## V1 allowed phonetic families (ACTIVE reuse)

From frozen Model2 `ACTIVE_SET_V1`:

| Family | Class |
|--------|-------|
| `n_l` | INITIAL |
| `z_zh` | INITIAL |
| `ch_c` | INITIAL |
| `sh_s` | INITIAL |
| `eng_en` | FINAL_NASAL |
| `in_ing` | FINAL_NASAL |
| `h_f` | INITIAL |

Direction must follow `phonetic_relation_direction_contract_v1` / `OPPOSITE_DIRECTION` (X_Y = intended→observed). Generator records both source and corrupted pronunciation.

## Tone (V1)

| Policy | Detail |
|--------|--------|
| Status | **OPTIONAL_PILOT_SUBSET** — not ACTIVE in Model2 runtime |
| Allowed if implemented | Controlled tone digit substitution on same base syllable **only when** replacement surface found in authoritative lexicon for new tone key |
| Forbidden | Assume all tone pair swaps equally likely; invent confidence |

If lexicon cannot realize tone-corrupted surface → skip or mark unrealizable (do not random replace).

## Explicitly out of V1 (CREATE later only with evidence)

- `d_t`
- WEAK / REVERSED features as primary
- Large invented accent rule packs

## Non-phonetic (optional separate track)

| Family | Tag |
|--------|------|
| 的/地/得 swaps | `ORTHOGRAPHIC_FUNCTION` · `isPhonetic=false` · `expectedRepairClass=NON_PHONETIC` |

Must **not** be mixed into acoustic corruption statistics without tags.

## Polyphonic

- Tag `isPolyphonic=true`
- Require `sourcePinyin/sourceTone` + `targetPinyin/targetTone` provenance
- No silent random reading

## Generation principle

```text
REFERENCE SPAN
→ reference pronunciation (authoritative G2P / lexicon)
→ allowed family corruption
→ lexicon lookup by corrupted pinyin(+tone)
→ replacement surface
→ ERROR TEXT
```

**FORBIDDEN:** random character / synonym / same-length word replacement.
