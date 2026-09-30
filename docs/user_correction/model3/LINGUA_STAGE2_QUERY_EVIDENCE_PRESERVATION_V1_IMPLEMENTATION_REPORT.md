# Lingua Stage2 Query Evidence Preservation V1 — Implementation Report

```text
PHASE = LINGUA_STAGE2_QUERY_EVIDENCE_PRESERVATION_V1_IMPLEMENTATION
ACP_ID = LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1
DATE = 2026-09-15
```

## Files modified

| File | Role |
|---|---|
| `main/src/lexicon-v2/recall-query-evidence.ts` | **NEW** — type, dedup upsert, EXACT/SUBSPAN mapper |
| `main/src/model2-runtime/expand-windows-with-model2.ts` | Producer emit after executed profile Recall |
| `main/src/fw-detector/span-assembly-v4/lattice-fine-span-runtime.ts` | Carrier on `LatticeFineSpanSuccess` |
| `main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` | Thread utterance store → Model3 path step |
| `main/src/model3-runtime/run-model3-path-step.ts` | Runtime arg pass-through (not Model3 input) |
| `main/src/model3-runtime/model3-retry-router.ts` | Stage2 REPLACE seam (`syllables` + `windowPinyinKey`) |
| `main/src/model3-runtime/model3-types.ts` | Trace-only `querySource` / `mappingReason` |
| `main/src/model3-runtime/recall-query-evidence.acp-v1.test.ts` | **NEW** — T1–T14 |
| `main/src/model3-runtime/recall-query-evidence.q1-acceptance.test.ts` | **NEW** — offline Q1 32/33 |

## Types added

```ts
RecallQueryEvidenceSource = 'MODEL2_CONDITIONED_FIRST_PASS'
RecallQueryEvidence { pinyinKey, syllableStart, syllableEnd, rawStart, rawEnd, source }
RecallQueryEvidenceMappingReason
MapEvidenceToStage2WindowResult
```

No forbidden fields (relation / nChanged / termId / domainIds / GT / Model2 logits).

## Producer

- Boundary: `executeProfileLexiconQueries` → each returned `ProfileQueryResult` already invoked `recallSpanTopKV2`.
- Emit in `expand-windows-with-model2.ts` via `upsertRecallQueryEvidence` for every executed query.
- Geometry from originating `Model2PolicyInput` (`syllable*` / `raw*`).
- Pinyin = `q.pinyinKey` submitted to Recall.
- **Hit not required** — zero-hit executed queries still emit.

## Evidence creation boundary

```text
valid Model2-conditioned query → recallSpanTopKV2 invoked → emit
hits.length === 0 → still emit
identity / nChanged<=0 / skipped → no emit
```

## Carrier

```text
ExpandWindowsWithModel2Result.recallQueryEvidence
→ LatticeFineSpanSuccess.recallQueryEvidence
→ orchestrator utterance-local freeze
→ runModel3PathStep / routeModel3Retry runtime args
```

Not on WindowCandidate / LexicalEdge / PathFineSpan / UserProfile / JobResult / session global.

## Dedup

Identity `(syllableStart, syllableEnd, pinyinKey, source)` via `upsertRecallQueryEvidence`. Utterance-local only. Invalid pinyin↔geometry alignment rejected at store time.

## Mapper

`mapEvidenceToStage2Window` (Recall-owned, no Model3 imports):

1. Collect legal EXACT / SUBSPAN
2. Raw conflict → `RAW_CONFLICT_REJECT` → ASR
3. SUPERSPAN / partial / disjoint → `UNSUPPORTED_GEOMETRY` → ASR
4. Prefer EXACT → smallest SUBSPAN → deterministic tie break
5. One mapped pinyin (or null)

## Stage2 replace seam

In `routeModel3Retry` Stage2 loop:

```text
mapped ? mapped.split('|') : ASR slice
windowPinyinKey = syllables.join('|')
args.recall({ syllables, windowPinyinKey, retainedDomains: path-local, ... })
```

Invariant: one Recall per Stage2 window; no dual ASR+evidence query.

## Trace

`Model3RetryRecallInvocationTrace` extended (observation only):

- `querySource`: `ASR` | `RECALL_QUERY_EVIDENCE`
- `mappingReason`: NONE / EXACT / SUBSPAN / RAW_CONFLICT_REJECT / UNSUPPORTED_GEOMETRY / INVALID_EVIDENCE
- records selected `syllables` + `windowPinyinKey`

Not added to JobResult business contract.

## Tests

| Suite | Result |
|---|---|
| `recall-query-evidence.acp-v1.test.ts` (T1–T14 + dedup) | **15 PASS** |
| `recall-query-evidence.q1-acceptance.test.ts` | **PASS** (32 mapped + 1 deferred) |
| `model3-retry-region.test.ts` + stage2 windows + model3-runtime suite | **82 PASS** targeted regression |

## Targeted Q1 result

```text
Q1_CONFIRMED = 33
Q1_MAPPABLE_EXPECTED = 32
Q1_MAPPED_ACTUAL = 32
Q1_DEFERRED_EXPECTED = 1
Q1_DEFERRED_ACTUAL = 1
DEFERRED_CASE = p2_u005_011
FULL_PILOT200_RUN = NO
```

## Known deferred case

`p2_u005_011` — DISJOINT / RetryRegion coverage. V1 returns `UNSUPPORTED_GEOMETRY` → ASR. No RetryRegion / resegment change.

## Architecture drift check

```text
Model2 pre-LexicalEdge / no Model2-on-Retry / Model3 KEEP-RETRY input unchanged
Tone modes unchanged / retainedDomains path-local / MERGE_SHARED_BUDGET unchanged
SameDomain / Assembly / KenLM / JobResult unchanged
```
