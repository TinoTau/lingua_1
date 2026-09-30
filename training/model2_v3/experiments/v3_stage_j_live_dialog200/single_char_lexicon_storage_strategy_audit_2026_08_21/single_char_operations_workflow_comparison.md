# Operations workflow comparison

## Add/remove one Repair single-char word

### Option A

1. Edit curated Repair source (new file)
2. Run import into **new table**
3. Rebuild/promote lexicon bundle (schema may bump)
4. Update checksum / bundleVersion / manifest
5. IME: **unchanged** (TSV untouched)
6. Extra: ensure `base_lexicon` length-1 empty/disabled to avoid dual authority

Complexity: **HIGH**

### Option B

1. Edit curated Repair source (single Repair SSOT file)
2. Point `loadSingleCharRows` at that file (not IME TSV)
3. Run Full Rebuild + promote (`bundleVersion++`, checksum)
4. IME: **unchanged** if `single_char_dictionary.tsv` preserved
5. Optional hygiene: IME export `length>=2` filter

Complexity: **MEDIUM** (rebuild cost) / **LOW** relative to A (no schema fork)

## IME change a single-char role weight

Both options: edit `single_char_dictionary.tsv` only → IME reload/export. Must **not** auto-mirror into Repair under Option B.
