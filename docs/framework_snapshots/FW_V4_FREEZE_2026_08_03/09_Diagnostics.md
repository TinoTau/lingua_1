# 09 — Diagnostics Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |

---

## Decision Inputs vs Diagnostics Outputs

| Class | Examples | May change decisions? |
|-------|----------|------------------------|
| Decision Inputs | Recall hits · Vote scores · Assembly combinations · KenLM scores | YES (by design) |
| Diagnostics Outputs | v4-diagnostics traces · caseId allowlist logging · recall diag env | **NO** |

Diagnostics must **not** change:

```text
Recall · Vote · Assembly · KenLM decision
```

## caseId allowlist

`v4-diagnostics-config.ts` caseId matching is **diagnostics-only**, not production decision logic, not gold/expected-sentence injection.
