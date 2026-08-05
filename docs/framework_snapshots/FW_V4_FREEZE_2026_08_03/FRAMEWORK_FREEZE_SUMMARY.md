# FRAMEWORK_FREEZE_SUMMARY

| Field | Value |
|-------|-------|
| Snapshot Name | **FW_V4_FREEZE_2026_08_03** |
| Status | **HISTORICAL RECOVERY BASELINE**（已被 `FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` 接替；本文结论不改写） |
| Scope | ASR Post-Processing through KenLM Runtime Boundary |
| Next Stage | KenLM Capability Validation |
| Nature | Date-based recoverable checkpoint — **not** permanent architecture freeze |
| Created | 2026-08-03 |
| Pack | `docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/` |

---

## Frozen Contracts

| Contract | Authority |
|----------|-----------|
| FineSpan / Path | Multi-Path Lexical Lattice Architecture V1.0.0 |
| Runtime Vote / Bucket / ≤16 / KenLM boundary | Runtime SSOT Contract V1.2 |
| Tone Evidence / Mapping | ToneEvidence Mapping Final Freeze 2026-07-29 |
| **Recall Subsystem** | **FROZEN_AT_2026_08_03** · Supporting: `docs/supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md` |
| Atomicity | Surface + Domain-Semantic · Unified Validator · enforce |
| Domain tags | `term_domain_tags` SSOT |
| KenLM Runtime | Batch-only · `raw_log_delta` · Gate boundary · ownership freeze |
| Lexicon rebuild | Full Rebuild from `full_rebuild_v1` |

### Recall Subsystem Status

```text
FROZEN_AT_2026_08_03
```

Frozen (verified recovery node — **not** permanent immutability):

```text
Syllable alignment (ASR Raw SSOT)
Lattice Window generation 1–5 + hard-block contract
Tone evidence readiness + Mandatory Tone Fail Closed
Plain + Tone composite SQL (Mode C)
No Plain Fallback on Mandatory path
SQLite → Candidate enumeration
Recall Candidate ownership through LexicalEdge boundary
```

Not in this freeze quality scope: Assembly/CrossPath optimization · KenLM ranking capability · Tone model accuracy uplift · open-domain lexicon coverage.

---

## Recall Subsystem Change Policy

Do **not** implement without Framework Impact Audit + regression + **new** Snapshot (never rewrite this Snapshot):

```text
- Restore Plain Fallback
- Move Tone from SQL WHERE to post-SQL filter
- Plain OR Tone / Tone-only Query
- Relax Tone readiness Fail Closed
- Change Window length / generation range
- Change Window Hard Block rules
- Change exactTopK
- Change merge priority / Candidate scoring / minPrior
- Change Domain merge order
```

Required process if change is necessary:

```text
1. Framework Impact Audit
2. Reason + alternatives
3. Candidate volume / performance / misrepair risk
4. Update CURRENT SSOT
5. dialog_200 + real candidate regression
6. Create new Framework Snapshot
7. Do not modify old Snapshot contents as if they were “corrected”
```

---

## Production Chain

```text
ASR Raw
→ FineSpan / Multi-Path Lexical Lattice
→ Formal Term Exact Recall
→ Domain Presence Vote
→ SameDomain Bucket
→ Sentence Assembly
→ CrossPath
→ KenLM Input / Runtime Boundary
```

Candidate generation **ends at CrossPath**. KenLM only **scores / ranks / picks**.

Recall detail chain (frozen at this date node):

```text
ASR Raw → Syllable Coordinate → Lexical Window → Hard Block
→ Tone Evidence Mapping → Tone Readiness → Mode C SQL
→ SQLite Result → Merge/Score/TopK → WindowCandidate → LexicalEdge
```
---

## Runtime Entry Points

| Step | Symbol | Path |
|------|--------|------|
| Pipeline | `fw-detector-step` | `main/src/pipeline/steps/fw-detector-step.ts` |
| Orchestrator | `runFwDetectorOrchestrator` | `main/src/fw-detector/fw-detector-orchestrator.ts` |
| V4 path | `runFwDetectorV4Path` | `main/src/fw-detector/fw-detector-v4-path.ts` |
| Lattice | `runLatticeFineSpanGeneration` | `span-assembly-v4/lattice-fine-span-runtime.ts` |
| Assembly orch | `runSpanAssemblyV4Orchestrator` | `span-assembly-v4/span-assembly-v4-orchestrator.ts` |
| Recall | `recallSpanTopKV2` | `lexicon-v2/recall-span-topk-v2.ts` |
| Vote | `voteUtteranceDomainFromPool` | `span-assembly-shared/utterance-domain-vote.ts` |
| CrossPath | `mergeCrossPathSentenceCandidates` | `span-assembly-v4/merge-cross-path-sentence-candidates.ts` |
| KenLM | `rerankFwSentences` | `fw-detector/rerank-fw-sentences.ts` |

---

## Current SSOT Documents

0. `docs/INDEX.md` (unified entry) · `docs/current/DOCUMENTATION_GOVERNANCE.md` (Documentation Governance Sole Authority)
1. `docs/current/INDEX.md`
2. `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md`
3. `docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`
4. `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`
5. `docs/tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md`
6. `docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`
7. `docs/fw-detector/freeze/FROZEN.md`
8. `docs/fw-detector/kenlm/KENLM_RUNTIME.md`
9. `docs/supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md` (Supporting)
10. This pack: `docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/`

Reading order update (navigation only — **no** change to frozen business conclusions):

```text
Documentation Governance → this Snapshot → CURRENT Index → Sole Authorities → Supporting → Acceptance
```

Snapshot **binds** Sole Authorities; it does **not** replace them.

---

## Lexicon Identity

| Field | Value |
|-------|-------|
| bundleVersion (Git freeze tag tip) | 12 |
| checksum (Git freeze tag tip) | `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |
| Post-recovery Runtime (Source→Full Rebuild; same calendar day) | **bundleVersion=13** · termCount=**9259** · tags=655 · checksum `sha256:b3cc9477227900d726b769a6135a81d09dfdd5a862b37c6e1e92c04e12a81d58` |
| atomicityMode | enforce |
| Source | `electron_node/docs/lexicon-assets/full_rebuild_v1/` |
| Rebuild | `npm run lexicon:full-rebuild` |

Git tag `FW_V4_FREEZE_2026_08_03` is **not** moved by this documentation registration.

---

## Acceptance Baseline

| Metric | Value |
|--------|-------|
| dialog_200 completed | 200 |
| failed | 0 |
| latticeUncovered | 0 |
| kenlmInputCount | 200 |
| Pre-KenLM p50/p95/max | 41 / 70 / 111 ms |
| Atomicity (v12 tip) | ACCEPT=9248 / EXCEPTION=8 / REJECT=0 / UNRESOLVED=0 |
| Atomicity (v13 post-recovery) | ACCEPT=9251 / EXCEPTION=8 / REJECT=0 / UNRESOLVED=0 |
| Recall subsystem audits 2026-08-03 | Window · Query Builder · Enumerator · Recovery Development |

---

## Known Limitations (summary)

- Lexicon ~9259 terms (post-recovery) — not open-domain complete  
- Tone model not 100% — prediction errors = **ACCEPTED_MODEL_LIMITATION**  
- KenLM capability validation pending; only **candidateCount≥2** cases evaluate ranking  
- Raw-only pools = **VALID_RAW_FALLBACK**  
- dialog_200 = stage regression, not open-domain accuracy proof  
- `normalizeSyllable` ü strip = **KNOWN_DATA_NORMALIZATION_DEBT** (non-blocking)  
- Snapshot is a **date node**, not permanent immutable architecture  

Full list: `12_Known_Limitations.md`

---

## Recovery Steps

See `13_Recovery_Guide.md`. Short form:

1. Checkout Git tag `FW_V4_FREEZE_2026_08_03` (or freeze commit)  
2. Install deps · `npm run build:main`  
3. `npm run lexicon:full-rebuild -- --force` · promote to `node_runtime/lexicon/v3`  
4. Verify checksum · Atomicity enforce 0/0  
5. Exact Recall matrix · dialog_200 hard gates  

---

## Git Anchor

| Field | Value |
|-------|-------|
| Tag | `FW_V4_FREEZE_2026_08_03` |
| Freeze Commit | `8603408097d0e4ce03651ec8d2d24afb44d70389` |
| Tag tip | `f568fdbd2ec5ed451a63b0d0e874da536d3a7d61`（metadata finalization） |

No long-lived freeze branch.

---

## Must NOT Claim

```text
KenLM quality PASS
Open-domain lexicon complete
Universal ASR correction complete
Permanent immutable architecture
```

---

## Pack Index

```text
01_Architecture.md … 13_Recovery_Guide.md
FRAMEWORK_FREEZE_SUMMARY.md
snapshot.json
```
