# Lexicon vs Model2 ownership matrix

| Asset | Owner | Model2 | Operations |
|-------|-------|--------|------------|
| IME 2510 common-character TSV | IME | no | KEEP; do not replace for Repair |
| Single-char repair lexicon (future SSOT) | Lexicon / Operations | no membership | add/remove/disable/pinyin/tone |
| Acoustic pinyin+tone query | Recall | no | n/a |
| Unique candidate (N=1) | Recall → materialize | **must not run** | n/a |
| Ambiguous set (N>1 same pinyin+tone) | Recall produces set | **select / abstain only** | n/a |
| 0 candidates | Recall fallback | **must not invent** | n/a |
| UserProfile | Session | rank among set only | must not generate characters from profile |
| Domain tags | Lexicon SSOT | context evidence | must not become repair vocab |
| Assembly / KenLM | existing | candidate evidence only | n/a |
| “Correct character” as concept | **Lexicon legality ∩ Model2 index choice** | decision among supplied | membership |

**Frozen boundary (new):** LEXICON OWNS CANDIDATE UNIVERSE. MODEL2 OWNS CONTEXT DISAMBIGUATION. Do not mix.
