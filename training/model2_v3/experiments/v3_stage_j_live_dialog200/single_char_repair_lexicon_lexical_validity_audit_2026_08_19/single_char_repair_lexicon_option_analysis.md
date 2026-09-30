# Option analysis

## OPTION A — Keep 2510 common-char inventory as repair lexicon

Keeps Lattice 1.0.2 fill. Continues IME-weight vs minPrior incompatibility and unique-tone competition among fallback characters (毫/涡). **Does not** match the audited product hypothesis.

## OPTION B — Rebuild from authoritative single-char word evidence **now**

**Blocked:** Sources Sufficient For Rebuild = NO. jieba 1-char was explicitly `banSingleChar`. KenLM is character-level. No tokenized word corpus. Rebuilding from jieba POS/freq this round would be an unauthorized source promotion + implicit thresholding.

## OPTION C — Two-layer data model (recommended architecture)

1. **Keep** `single_char_dictionary.tsv` / 2510 as **IME common-character inventory** (decoder fallback). Do not shrink it for FW Repair.
2. **Create** a separate **single-char repair lexicon** (static offline table) once an authorized wordhood source exists.
3. FW length-1 recall reads **only** the repair table.
4. Prior/minPrior relation for that table is a **later** contract (not this round).

## Consumers

IME V2 loads the TSV directly. Shrinking 2510 for repair would regress IME path-breakage design. **Can existing inventory be replaced directly: NO.**
