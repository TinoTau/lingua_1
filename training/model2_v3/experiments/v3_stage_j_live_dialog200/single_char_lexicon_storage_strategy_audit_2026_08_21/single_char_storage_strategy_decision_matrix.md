# Storage strategy decision matrix

| Dimension | OPTION A Separate table | OPTION B Rebuild length-1 base |
|-----------|-------------------------|--------------------------------|
| Tables | WORSE (more) | BETTER (same) |
| Runtime changes | WORSE (collector+repo) | BETTER (none) |
| Schema changes | WORSE | BETTER (none) |
| Import pipeline | WORSE (new) | SAME/BETTER (swap source) |
| Operations | WORSE (HIGH) | BETTER (MEDIUM) |
| Consumer regression risk | MEDIUM (missed path dual auth) | MEDIUM (export/tests); production IME LOW |
| SSOT clarity | MEDIUM (two lexical stores) | BETTER (one Repair lexical store) |
| IME isolation | BETTER (table-level) | SAME (already TSV-isolated) |
| Repair semantics | BETTER if exotic metadata needed | BETTER for “base lexical term” |
| Polyphonic same-syllable multi-tone | BETTER if new PK | PARTIAL (existing PK) |
| Prior semantics | SAME | SAME |
| Testing scope | WORSE | BETTER |
| Rollback simplicity | WORSE | BETTER (revert source+rebuild) |
| Architecture simplicity | WORSE | BETTER |

## Recommendation rule application

- base_lexicon is FW lexical SSOT including length-1 → prefer B
- IME does not depend on sqlite length-1 → prefer B
- schema can store curated singles → prefer B
- no incompatible production length-1 consumer → prefer B

→ **OPTION_B_RECOMMENDED**
