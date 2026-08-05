# FW Repair V4 — SentenceCombination Contract Freeze Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | `FW_V4_FREEZE_2026_08_03` |
| Nature | READ ONLY — architecture ownership freeze |
| Prior | `NO_REPAIR_COMPLETENESS_CONTRACT` (Partial Repair Admission Audit) |
| Verdict | **CONTRACT_READY_FOR_IMPLEMENTATION** |

---

## Architecture question (only)

```text
Should Repair Completeness become SentenceCombination Metadata,
or be inferred later by another module?
```

**Answer:**

```text
Become SentenceCombination Metadata.
Sole Owner = Sentence Assembly.
Do NOT infer independently in CrossPath or KenLM.
```

---

## Current fact

`SentenceCombination` today:

```ts
{ text, replacements[], candidateScore }
```

No field is equivalent to Repair Completeness → **`NO_REPAIR_COMPLETENESS_CONTRACT` confirmed**.

---

## Q1 — Who should own Repair Completeness?

**Sentence Assembly** (`buildSentenceCandidates`), exactly one owner.

| Module | Role |
|--------|------|
| Assembly | **Sole Owner / Producer** |
| CrossPath | Consumer only (optional future admission) |
| KenLM | Unaware |

Forbidden: Assembly ∧ CrossPath ∧ KenLM each calculating independently.

---

## Q2 — Can it be derived without new runtime logic?

**Yes, as Assembly-local pure metadata** from inputs already present at combination birth:

```text
rawText + replacements[] (repairTarget picks + canonical_exact gaps)
```

Must **not** require new Tone / Recall / Vote / KenLM calls.

Caveat: the exact PARTIAL vs COMPLETE vs MIXED **formula** is still design work under the same owner — that is rule freeze, not a second owner or external inference.

---

## Q3 — Should it become SentenceCombination Metadata?

**Yes.**

Completeness is a property of the generated sentence combination. The natural SSOT carrier is `SentenceCombination`, produced where `text` is first built.

Inferring later from bare `text` in CrossPath creates a second calculator and breaks One Sole Owner.

---

## Q4 — Should CrossPath consume without recomputing?

**Yes.**

`mergeCrossPathSentenceCandidates` today: exact text dedupe + global cap ≤16 — correct and must stay free of independent completeness heuristics.

Future admission (if any) reads Assembly metadata only.

---

## Q5 — Should KenLM remain unaware?

**Yes.**

Freeze boundary (`11_KenLM_Runtime_Boundary.md`): KenLM = score / rank / pick only. Must not invent candidates, own generation, or filter by repair completeness.

---

## Q6 — Does this preserve SSOT?

**Yes**, if and only if:

```text
ONE producer (Assembly)
ONE carrier (SentenceCombination.repairCompleteness)
ZERO recomputers (CrossPath / KenLM)
```

---

## Q7 — Does this preserve Single Responsibility?

**Yes.**

| Layer | Duty |
|-------|------|
| Assembly | Generate sentence + attach structural completeness metadata |
| CrossPath | Merge / dedupe / cap (+ optional consume metadata later) |
| KenLM | Language score / rank / pick |

Metadata attach alone does **not** merge Admission into Assembly. Admission remains a separate explicit contract if/when filtering is added.

---

## Q8 — Can development begin after Contract Freeze?

**Yes — for ownership + metadata placement.**

Recommended sequence:

1. Freeze this ownership decision (this audit)
2. Design Assembly Completeness Rule (deterministic formula)
3. Implement metadata-only (no behaviour change)
4. Optionally design CrossPath Admission that **consumes** metadata (explicit Gate — not hidden)

---

## Determinations 1–8 (checklist)

| # | Determination | Result |
|---|---------------|--------|
| 1 | One owner | **Assembly** |
| 2 | From existing info | **Yes** (Assembly-local pure function) |
| 3 | Behaviour change? | **Metadata-only = no**; admission later = separate |
| 4 | Violate SSOT? | **No** if single producer |
| 5 | Hidden Gate? | **No** for metadata-only |
| 6 | CrossPath consume only? | **Yes** |
| 7 | KenLM unaware? | **Yes** |
| 8 | Existing equivalent field? | **No** — `NO_REPAIR_COMPLETENESS_CONTRACT` |

---

## Final Verdict

```text
CONTRACT_READY_FOR_IMPLEMENTATION
```

Ownership and carrier are frozen for implementation planning.  
Exact PARTIAL/COMPLETE formula and any Admission policy are subsequent contracts under the same Sole Owner rules — not blockers of this ownership freeze.
