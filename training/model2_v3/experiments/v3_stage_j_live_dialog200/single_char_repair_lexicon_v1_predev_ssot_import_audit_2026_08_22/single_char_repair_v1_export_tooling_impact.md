# IME export tooling impact

## Product IME runtime

Loads `single_char_dictionary.tsv` — **unaffected** if TSV preserved.

## Export tool (`dict-export-core.mjs`)

Dumps **all** enabled `base_lexicon` (no length filter) into IME base layer.

After V1: exported base layer length-1 set becomes 1125 STRICT (or fewer if filter added), not 2510.

## Required adjustment

**RECOMMENDED:** export `WHERE length(word) >= 2` for base layer (or document that Repair length-1 may appear in export).

**Do not** keep IME 2510 mirrored in Repair sqlite for export compatibility.
