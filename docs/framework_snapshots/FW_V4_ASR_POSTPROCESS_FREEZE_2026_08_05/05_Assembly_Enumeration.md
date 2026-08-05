# 05 — Assembly Enumeration Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |
| Algorithm | Interval Non-Overlap Repair-Subset DFS |
| Code | `build-sentence-candidates.ts` |

## Frozen

- Overlap contract (`rawOverlap`)
- Gap fill contract
- Exact-text dedup (Assembly-local)
- Formula A metadata
- Hard caps (1024 / 16 / 16 / 8·6·4)

## Not frozen as contract

- Sentence semantic diversity
- Near-duplicate policy
- Active per-domain sentence quota

Evidence: `docs/acceptance/Audit/2026-08-05_Sentence_Assembly_Enumeration_Audit/`  
Verdict there: `ASSEMBLY_CONTRACT_INCOMPLETE` for diversity — algorithm still archived here as **implemented behavior**.
