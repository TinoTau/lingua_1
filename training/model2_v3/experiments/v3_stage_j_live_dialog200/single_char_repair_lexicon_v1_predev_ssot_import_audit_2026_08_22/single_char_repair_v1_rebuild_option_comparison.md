# Rebuild option comparison

| | OPTION 1 Full Rebuild + swap singleCharSource | OPTION 2 Length-1-only patch tool |
|--|-----------------------------------------------|-----------------------------------|
| Existing | YES | NO (would invent) |
| Atomicity / checksum / manifest | Proven | Must reimplement |
| Risk to length>=2 / domains | Low if multi-char sources unchanged (verify) | Lower blast radius in theory; higher process risk |
| Simplicity | BETTER | WORSE |
| Recommendation | **OPTION 1** | Reject for V1 |

Expected delta: length-1 −2510 +1125 ⇒ net **−1385** rows (verify by surface set, not count alone).
