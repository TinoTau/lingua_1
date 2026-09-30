# ACP preparation (not an approved change)

**Title:** Separate IME common-character inventory from single-char FW Repair lexicon; do not rebuild until an authorized wordhood source is adopted.

**Scope:** eligibility of length-1 *repair* rows only; note that prior ownership and bind/minPrior for that new table remain UNDEFINED.

**Not in scope:** Model2, FineSpan, Assembly, KenLM, Domain Vote, collector uniqueness, minPrior numeric change, prior remap, sqlite rewrite this round.

**Next-phase menu (user chooses):**

- C. FIND BETTER AUTHORITATIVE SOURCE (tokenized corpus / licensed word list / explicitly re-authorized jieba 1-char policy)
- B. SEPARATE COMMON-CHAR AND REPAIR INVENTORIES (schema/ownership first; fill later)
- A. REBUILD only after C
- D. Further redesign or abandon single-char repair contract if unique-tone remains unsafe even on a true word list

**Runtime target (unchanged complexity):** lookup → exact pinyin+tone → 0 fallback / 1 candidate / >1 fallback. No wordhood classifier at runtime.
