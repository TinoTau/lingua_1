# LINGUA Stage2 Query Evidence Geometry Contract (ACP companion)

| Field | Value |
|---|---|
| ACP | `LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1` |
| Status | **APPROVED / FROZEN** (companion to ACP_V1_FROZEN) |
| Date | 2026-09-15 |
| Evidence | `LINGUA_QUERY_GEOMETRY_MAPPING_MATRIX.csv`, `LINGUA_Q1_EXACT_REVALIDATION_33.csv` |

---

## 1. Geometry authority (user-corrected)

```text
GEOMETRY_AUTHORITY = SYLLABLE_OFFSETS on shared globalSyllables
RAW_OFFSETS = SECONDARY_CONSISTENCY_GUARD
ON_RAW_VS_SYLLABLE_CONFLICT = REJECT_EVIDENCE_MAPPING_AND_FALLBACK_TO_ASR
```

**Rejected prior draft rule `SYLLABLE_WINS`.** Evidence reuse is optional recovery; geometry conflict must never force reuse.

Stage2 windows and first-pass Model2 windows both index the same utterance syllable stream (`SHARED_LEXICAL_WINDOW_OWNER` / `enumerateStage2SuccessPathQueryLocals`).

Syllable convention (production): **half-open** `[syllableStart, syllableEnd)` — see `window-construction-core.ts` (`buildWindowDescriptorForRange`).

Raw offset semantic (production): **UTF-16 code-unit indices** into `rawText` (`rawText.slice(rawStart, rawEnd)`), derived via `syllableRangeToRawCharRange` / CharSyllableRange. Comparable when both sides use the same utterance coordinate.
---

## 2. Relation definitions

Let evidence `E = [eS, eE)` and Stage2 window `W = [wS, wE)` (half-open syllable indices).

| Relation | Predicate | V1 action |
|---|---|---|
| EXACT | `eS==wS && eE==wE` | reuse `E.pinyinKey` as-is |
| CONTAINS (SUBSPAN) | `eS<=wS && eE>=wE` && not EXACT | **slice** evidence pinyin to `[wS,wE)` |
| CONTAINED (SUPERSPAN) | `wS<=eS && wE>=eE` && not EXACT | **REJECT** (V1) |
| OVERLAP (partial) | intervals intersect but neither contains | **REJECT** |
| DISJOINT | no intersection | **REJECT** (deferred; not RESEGMENT engine) |

Empirical Q1 best-mapping:

| Relation | Count |
|---|---|
| EXACT | 5 |
| CONTAINS | 27 |
| CONTAINED | **0** |
| DISJOINT (all reachable vs Stage2) | 1 (`p2_u005_011`) |

---

## 3. SUBSPAN slice (primary path)

Given:

```text
E.pinyinKey syllables P[0 .. (eE-eS))
aligned 1:1 with global syllables [eS, eE)
```

Invariant (producer must guarantee):

```text
split(E.pinyinKey, '|').length === (eE - eS)
```

If violated → evidence is **invalid**; do not map.

Mapped query:

```text
offset0 = wS - eS
offset1 = wE - eS
mapped = P[offset0 .. offset1).join('|')
```

Example:

```text
E geometry: [s0,s1,s2]  pinyin: p0|p1|p2
W geometry: [s1,s2]
→ mapped: p1|p2
```

No fuzzy substring, no GT, no target surface, no relation re-execution.

---

## 4. SUPERSPAN / composition — rejected for V1

Concept `ASR ⊕ evidence` composition is **not** authorized:

- Not required by confirmed Q1 (0 CONTAINED).
- Risks combinatorial / Model2-like reconstruction.
- Would expand search semantics.

```text
SUPERSPAN_MAPPING_SUPPORTED = NO
```

---

## 5. Partial overlap — rejected

```text
PARTIAL_OVERLAP_REUSE = NO
```

No automatic splice of `[s0,s1]` evidence into `[s1,s2]` Stage2.

---

## 6. RESEGMENT / DISJOINT case `p2_u005_011`

| Fact | Value |
|---|---|
| Target | 提示性 / `ti\|shi\|xing` |
| Reachable first-pass queries | 48 (include exact `ti\|shi\|xing` @ syl `21:24`) |
| geomVsStage2 for all 48 | **DISJOINT** |
| Meaning | RetryRegion Stage2 windows do **not** intersect evidence geometry |

This is **not** “need a general resegment pinyin engine”.

It is a **RetryRegion coverage / region formation** question — **out of scope** for V1 evidence mapping.

```text
OPTION A (selected): EXACT + SUBSPAN only; RESEGMENT/DISJOINT deferred
KNOWN_UNRECOVERED_Q1 = 1
Do NOT build a new geometry engine for 1 Pilot case
```

---

## 7. Conflict policy (one Stage2 window → one evidence)

```text
1. Collect legal mappings (EXACT or CONTAINS-slice)
2. Prefer EXACT over CONTAINS
3. Among CONTAINS: smallest (eE-eS)
4. Tie-break: eS asc, eE asc, pinyinKey lex
5. Emit at most ONE mapped pinyinKey
```

---

## 8. Pseudocode (conceptual only)

```ts
function mapEvidenceToStage2Window(
  store: readonly RecallQueryEvidence[],
  window: { syllableStart: number; syllableEnd: number; rawStart: number; rawEnd: number }
): string | null {
  const wS = window.syllableStart;
  const wE = window.syllableEnd;
  type Cand = { kind: 'EXACT' | 'SUBSPAN'; e: RecallQueryEvidence; mapped: string; span: number };
  const cands: Cand[] = [];

  for (const e of store) {
    if (e.source !== 'MODEL2_CONDITIONED_FIRST_PASS') continue;
    const parts = e.pinyinKey.split('|').filter(Boolean);
    if (parts.length !== e.syllableEnd - e.syllableStart) continue; // INVALID_EVIDENCE

    const eS = e.syllableStart;
    const eE = e.syllableEnd;

    // Fail-closed raw consistency: syllable containment must agree with raw containment.
    const sylExact = eS === wS && eE === wE;
    const sylContains = eS <= wS && eE >= wE;
    const rawExact = e.rawStart === window.rawStart && e.rawEnd === window.rawEnd;
    const rawContains = e.rawStart <= window.rawStart && e.rawEnd >= window.rawEnd;
    if (sylExact || sylContains) {
      const rawOk = sylExact ? rawExact : rawContains;
      // Also reject if raw says contains/exact but syllable relation disagrees — handled by branch structure.
      if (!rawOk) continue; // RAW_CONFLICT_REJECT → treat as no mapping for this evidence
    }

    if (sylExact) {
      cands.push({ kind: 'EXACT', e, mapped: e.pinyinKey, span: eE - eS });
      continue;
    }
    if (sylContains) {
      const mapped = parts.slice(wS - eS, wE - eS).join('|');
      cands.push({ kind: 'SUBSPAN', e, mapped, span: eE - eS });
      continue;
    }
    // CONTAINED / OVERLAP / DISJOINT → unsupported in V1
  }

  if (!cands.length) return null; // caller keeps ASR pinyin

  cands.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'EXACT' ? -1 : 1;
    if (a.span !== b.span) return a.span - b.span;
    if (a.e.syllableStart !== b.e.syllableStart) return a.e.syllableStart - b.e.syllableStart;
    if (a.e.syllableEnd !== b.e.syllableEnd) return a.e.syllableEnd - b.e.syllableEnd;
    return a.mapped < b.mapped ? -1 : a.mapped > b.mapped ? 1 : 0;
  });

  return cands[0]!.mapped;
}
```

Stage2 consumer (conceptual):

```text
mapped = mapEvidenceToStage2Window(store, stage2Window)
queryPinyin = mapped ?? asrWindowPinyinKey
recallSpanTopKV2(..., queryPinyin, recallMode=model3_retry_pinyin_domain_recovery, domainIds=retainedDomains)
```

---

## 9. Anti-patterns (explicit)

```text
✗ Copy one evidence pinyinKey into every Stage2 window in a RetryRegion
✗ Fuzzy pinyin substring search
✗ GT / target-text-aware construction
✗ ASR⊕evidence superspan composition (V1)
✗ Partial-overlap splice
✗ Emit N evidences as N parallel queries for one window
✗ Cross-utterance persistence
```
