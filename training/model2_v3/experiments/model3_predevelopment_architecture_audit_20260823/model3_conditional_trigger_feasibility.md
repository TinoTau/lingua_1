# Model3 Conditional Trigger Feasibility

## Principle

Model3 should **not** run every sentence. Use **simple deterministic gates** on **existing signals only**.

## Available cheap signals (code-backed)

| Signal | Source | Deterministic |
|--------|--------|---------------|
| length1 fail-closed / no-candidate count | `length1Collector.terminalReason` | YES (trace/internal) |
| ambiguous multi-hit same tone | eligibleHitCount > 1 on length1 | YES |
| tone recall not ready | `toneRecallReadiness.state !== ready` | YES |
| insufficient domain evidence | `vote.insufficientEvidence` | YES |
| zero retained domains | `retainedDomains.length === 0` | YES |
| Model2 invoked with zero introduced terms | `Model2ExpandDiagnostics` | YES |
| active candidate instability | no direct metric today | PARTIAL |

## Prohibited

- Weighted suspicious score stacks
- New multi-threshold heuristic framework
- Phrase n-gram co-occurrence gate (local LM collapse)

## Trigger rate

**NOT_MEASURED** — no production Model3 gate exists; dialog_200 could measure candidate proxy rates offline.

## Recommended gate sketch (contract phase, not implemented)

Run Model3 iff **any** of:

- non-anchor span has recall miss + tone ready + anchors ≥ 2
- OR length1 ambiguous fail-closed adjacent to domain anchor span

Exact thresholds belong in **MODEL3_CONTRACT_AND_TRAINING_DESIGN**, not this audit.
