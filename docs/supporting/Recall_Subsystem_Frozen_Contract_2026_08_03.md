# Recall Subsystem Frozen Contract — 2026-08-03

| Field | Value |
|-------|-------|
| Status | **SUPPORTING_CONTRACT** |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Nature | Summarizes Sole Authorities + Acceptance evidence; **not** a second Sole Authority |
| Code changed this registration | **No** |

Authority order remains:

```text
Lattice Architecture V1.0.0
> Runtime SSOT Contract V1.2
> Supporting (this file)
> Acceptance Records
```

---

## 1. Frozen Scope（日期节点）

```text
ASR Raw
→ Syllable Coordinate
→ Lexical Window Generation (Lattice 1–5)
→ Window Hard Block
→ Acoustic Tone Evidence Mapping
→ Tone Recall Readiness
→ Plain + Tone Composite Query (Mode C)
→ SQLite Result Set
→ Candidate Merge / Score / TopK
→ WindowCandidate Binding
→ LexicalEdge Boundary
```

**Not frozen as quality-complete:** Sentence Assembly optimization · CrossPath quality · KenLM ranking capability · KenLM training · open-domain lexicon coverage · Tone model accuracy uplift.

**Status tag:** `Recall Subsystem Status: FROZEN_AT_2026_08_03`

Meaning: verified recovery checkpoint. **Not** permanent immutability. Changes require Framework Impact Audit + new Snapshot (do not rewrite old Snapshot).

---

## 2. Window / Syllable（links Sole Authority）

- SSOT: ASR **Raw** via `buildUtteranceSyllableCoordinate` → `textToSyllables` on CJK runs.
- Must **not** build Windows from `expectedText` / ground truth.
- Lattice: lengths **1–5**, contiguous sliding; coarse boundary soft under Lattice hard-block filter.
- Missing correct glyphs in Raw ⇒ Window Builder does **not** invent them; it only emits Raw ranges + plain + syllable span.

Evidence: `docs/acceptance/Freeze/2026-08-03_Window_Boundary_Audit/` · Verdict `WINDOW_ALIGNMENT_CORRECT`.

---

## 3. Mandatory Tone Gate — purpose

Gate exists for **protocol integrity**, not to guarantee Tone prediction accuracy:

1. Prevent missing Tone parameter / silent degrade  
2. Fail Closed on protocol errors  
3. Ensure Tone participates in Recall (SQL WHERE)  
4. No Plain Fallback on Mandatory path  

### Protocol error → Fail Closed (no SQLite)

```text
missing Tone payload · no pattern · invalid length · illegal tone digit
· caller disabled · runtime unsupported
```

### Model capability error → Accepted limitation

```text
Valid Tone Evidence present, but one+ digits wrong vs true speech.
→ Legal query may hit wrong term or empty set.
→ ACCEPTED_MODEL_LIMITATION (not Query Builder / Enumerator bug)
```

~80%+ Tone accuracy with residual failures is **allowed**. Do **not** restore Plain Fallback solely to cover residual Tone errors.

---

## 4. Recall Query — Mode C

```sql
WHERE pinyin_key = ?
  AND tone_pinyin_key = ?
  AND enabled = 1
  AND length(word) = ?
ORDER BY prior_score DESC
LIMIT ?
```

Tone is an **equality WHERE bind**, not a post-SQL optional filter.  
Forbidden: Tone-only · Plain-first then Tone filter · Tone-miss Plain Fallback · Plain OR Tone.

Evidence: `docs/acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/` (also `recall_query_builder_audit_2026_08_03/`) · `QUERY_BUILDER_CORRECT`.

---

## 5. No Plain Fallback

Mandatory Tone production path does **not** call `lookupBaseByPinyinKey`.  
`plainFallbackHitCount = 0`. Non-ready readiness ⇒ **no SQLite**.

---

## 6. Candidate Enumerator

```text
SQLite Result
→ mergeSpanCandidatesCombined
→ scoreHotword
→ sortRecallHitsByToneCompatibility   # rank/penalty only — no hard drop
→ final TopK slice
→ bindLexiconHitsToWindow (minPrior)
```

Domain order: Base∥Domain SQL → merge (domain preferred when active) → score → TopK.  
Not: TopK then Domain hard filter.

Evidence: `docs/acceptance/Freeze/2026-08-03_Recall_Candidate_Enumeration_Audit/` · `ENUMERATOR_CORRECT`.

---

## 7. Allowed Runtime Failure Modes

| Mode | Judgment |
|------|----------|
| Tone prediction error (valid payload) | `ACCEPTED_MODEL_LIMITATION` |
| Pronunciation deformation / ASR syllable drift | `ACCEPTED_INPUT_AMBIGUITY` |
| Raw-only candidate pool | `VALID_RAW_FALLBACK` |
| Conversation repair / clarify later | Allowed — system does not maximize fuzzy pool |

---

## 8. KenLM boundary (summary)

KenLM: Score / Rank / Pick existing CrossPath sentences.  
KenLM must **not** generate missing words, fix Tone, redo Window/Recall, or invent candidates.  
Only cases with **candidateCount ≥ 2** evaluate ranking. Raw-only cases do **not**.

Next stage: real competition baseline from dialog_200 / runtime traces — **not** “all Tone errors must recover first”.

---

## 9. Change Policy

Do **not** implement without Framework Impact Audit + new Snapshot:

- Restore Plain Fallback  
- Move Tone from SQL WHERE to post filter / Plain OR Tone  
- Relax Tone readiness Fail Closed  
- Change Window length/range or Hard Block  
- Change exactTopK / merge priority / scoring / minPrior / Domain merge order  

Procedure: Impact Audit → alternatives → risk → update CURRENT → dialog_200 + candidate regression → **new** Snapshot (never rewrite old).

---

## 10. Acceptance evidence index

| Record | Proves |
|--------|--------|
| Window Boundary Audit | Syllable/Window vs Raw; critical plain windows exist; blocked=0 |
| Recall Query Builder Audit | Mode C composite SQL; no Plain Fallback |
| Recall Candidate Enumeration Audit | SQLite→Candidate chain; no hidden drop of in-SQL correct terms |
| Recall Candidate Recovery Development | Formal Source repairs + rebuild; sample center-01 Raw+Correct |

Formal pack: `docs/acceptance/Freeze/2026-08-03_Recall_Subsystem_Documentation_Freeze/`

---

## 11. Sole Authority links

- [`docs/current/INDEX.md`](../current/INDEX.md)  
- [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md)  
- [`FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md)  
- [`KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md)  
- [`FROZEN.md`](../fw-detector/freeze/FROZEN.md)  
