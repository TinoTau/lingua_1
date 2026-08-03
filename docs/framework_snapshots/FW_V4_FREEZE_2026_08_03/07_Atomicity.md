# 07 — Atomicity Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |

---

## Dual Contract

```text
Surface Atomicity
+
Domain-Semantic Atomicity
```

## domain_atomic

Legal exceptions via Source metadata only:

```text
term_type = domain_atomic
exception_reason = <required>
```

Runtime must not Keep/Delete.

## Enforce Default

| Item | Value |
|------|-------|
| Full Rebuild default | `atomicityMode = enforce` |
| Gate | REJECT_COMPOSITE=0 · UNRESOLVED=0 |
| Fail-closed | blocked terms stop build |
| Runtime filtering | **FORBIDDEN** |

## Write Paths (all must call Unified Validator)

```text
Full Rebuild · Patch V3 · Patch V4 · Industry Import · Supplemental · future Expansion
```

## Source Cleanup Status

**COMPLETED** (Atomicity Closure 2026-08-02): DELETE composites / UNRESOLVED without exception; KEEP proven domain_atomic set in Source.

Bundle Gate: ACCEPT=9248 · ACCEPT_EXCEPTION=8 · REJECT=0 · UNRESOLVED=0.
