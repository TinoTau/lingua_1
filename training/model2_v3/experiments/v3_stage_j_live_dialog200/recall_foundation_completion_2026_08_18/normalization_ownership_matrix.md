# Normalization Ownership Matrix

| Surface | Owner | Status |
|---------|-------|--------|
| rawAsrText / segmentForJobResult | ASR pipeline (immutable by IME) | FROZEN |
| IME alignment view | normalizeForImeAlignment (OpenCC t→cn + NFKC) | ACTIVE_IME_ONLY |
| FW Repair recall input | **MISSING — required restore point** | MISSING |
| Lexicon canonical | SQLite word/normalized | PARTIAL (data exists; no runtime t2s) |
| MATERIALIZABLE_TARGET_V1 norm | diagnostic strip/lower | ACTIVE_DIAGNOSTIC |
| semantic_repair | outside FW V4 | OUTSIDE_FW |

**Duplication risk if restored incorrectly:** IME + FW + semantic each applying different t2s.
**Required:** reuse existing OpenCC t→cn helper; one FW canonicalization; retain raw for trace.
