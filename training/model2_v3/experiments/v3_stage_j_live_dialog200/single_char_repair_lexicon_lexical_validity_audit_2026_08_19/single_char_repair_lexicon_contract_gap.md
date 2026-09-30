# Contract gap

## OLD (frozen in practice after 2026-08-18 import)

```
COMMON_CHARACTER_INVENTORY (~2510 IME / 通用规范一级)
    → sqlite base_lexicon length-1
    → collectBaseOnlySingleCharCandidate
    → bindLexiconHitsToWindow(minPrior=0.5)
```

Lattice CR 1.0.2 asked for a **bounded base-only exact** length-1 inventory (~2000–3000). It did **not** define *independent lexical wordhood*. The 2510 fill satisfied **count and source-file existence**, not *valid one-character repair items*.

## PROPOSED (this audit — not implemented)

```
INDEPENDENT_SINGLE_CHAR_LEXICAL_REPAIR_INVENTORY
    = length 1
    AND independent lexical identity (authoritative evidence)
    AND attested modern standalone use
    AND suitable as ASR lexical replacement
```

This is a **contract change**. It is **supported as a direction** by: (1) TSV provenance = IME characters; (2) zero wordhood fields; (3) live unique-tone substitutions such as 好→毫 / 我→涡 from fallback-role characters; (4) IME still needs the full 2510.

It is **not** yet supported as a rebuild, because no authorized wordhood source exists in-repo.

## Out of scope for ACP

Model2, FineSpan, Assembly, KenLM, Domain Vote, minPrior value, prior remap, collector uniqueness rules.
