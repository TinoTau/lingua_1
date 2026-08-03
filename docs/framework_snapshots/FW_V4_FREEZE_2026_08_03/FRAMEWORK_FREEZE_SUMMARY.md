# FRAMEWORK_FREEZE_SUMMARY

| Field | Value |
|-------|-------|
| Snapshot Name | **FW_V4_FREEZE_2026_08_03** |
| Status | **CURRENT RECOVERY BASELINE** |
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
| Atomicity | Surface + Domain-Semantic · Unified Validator · enforce |
| Domain tags | `term_domain_tags` SSOT |
| KenLM Runtime | Batch-only · `raw_log_delta` · Gate boundary · ownership freeze |
| Lexicon rebuild | Full Rebuild from `full_rebuild_v1` |

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

1. `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md`
2. `docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`
3. `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`
4. `docs/tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md`
5. `docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`
6. `docs/fw-detector/freeze/FROZEN.md`
7. `docs/fw-detector/kenlm/KENLM_RUNTIME.md`
8. This pack: `docs/framework_snapshots/FW_V4_FREEZE_2026_08_03/`

Snapshot **binds** Sole Authorities; it does **not** replace them.

---

## Lexicon Identity

| Field | Value |
|-------|-------|
| bundleVersion | 12 |
| term count | 9256 |
| domain tag count | 655 |
| atomicityMode | enforce |
| checksum | `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |
| Source | `electron_node/docs/lexicon-assets/full_rebuild_v1/` |
| Rebuild | `npm run lexicon:full-rebuild` |

---

## Acceptance Baseline

| Metric | Value |
|--------|-------|
| dialog_200 completed | 200 |
| failed | 0 |
| latticeUncovered | 0 |
| kenlmInputCount | 200 |
| Pre-KenLM p50/p95/max | 41 / 70 / 111 ms |
| Atomicity ACCEPT / EXCEPTION / REJECT / UNRESOLVED | 9248 / 8 / 0 / 0 |

---

## Known Limitations (summary)

- Lexicon ~9256 terms — not open-domain complete  
- KenLM **capability validation pending** (readiness ≠ quality PASS)  
- dialog_200 = stage regression, not open-domain accuracy proof  
- KenLM export provenance (`candidate:i`) incomplete  
- Near-homophone noise may enter candidate pool  
- Future Lexicon Expansion must pass Unified Atomicity Validator  
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
