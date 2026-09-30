# Normalization Frozen Design Reconstruction

## Authoritative design (from SSOT / freeze docs, not code reverse-engineering)

1. **ASR business surface** (`rawAsrText`, `segmentForJobResult`) remains the user-visible ASR output.
   Freeze contract: `segmentForJobResult` write whitelist; IME alignment must not mutate it.

2. **FW Repair lexical input** should operate on a **canonical simplified Chinese repair surface** when
   ASR emits traditional/mixed script, so lexicon lookup and FineSpan windows align with lexicon canonical surfaces.

3. **Lexicon canonical surface** is simplified Chinese in `word` / `normalized` / `canonical_word` columns.

4. **IME alignment OpenCC** (`normalize-for-ime-alignment.ts`) exists because pinyin-IME beam alignment
   must map traditional ASR chars to simplified dictionary surfaces **without** changing business text.

5. **Semantic repair OpenCC** is a separate path outside FW Repair V4 and must not become a second FW owner.

6. **MATERIALIZABLE_TARGET_V1 norm()** is diagnostic-only (punct/whitespace/lowercase); it does **not**
   authorize t2s folding in recoverability accounting.

## Current gap

145 SCRIPT_NORMALIZATION units prove traditional→simplified mismatch between ASR surface and lexicon/repair.
OpenCC capability exists but is **not** applied to FW Repair business input.

## Single owner rule (target)

Exactly one FW Repair script-normalization owner before lexical recall; preserve raw ASR for trace.
