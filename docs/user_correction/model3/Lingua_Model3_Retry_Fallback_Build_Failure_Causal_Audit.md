# Lingua — Model3 Retry Fallback Build Failure Causal Audit

Generated: 2026-09-04T10:55:00Z  
Phase: `MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_FAILURE_CAUSAL_AUDIT`  
Mode: READ-ONLY — NO PRODUCTION / TEST / REDESIGN CHANGE

Freeze preserved:

| Item | State |
|------|--------|
| Delta 1 | `RESOLVED_ACCEPTED_CLOSED` |
| Delta 2 Design | `PASS_IMPLEMENTATION_READY` |
| Delta 2 Development semantic intent | `IMPLEMENTED_BUT_NOT_PRODUCTION_BUILD_COMPLETE` |
| Delta 2 Acceptance | `FAIL_BUILD_BLOCKED` |
| `DELTA_RQ_FALLBACK_BOUNDARY_LOCK` | `NOT_ACCEPTED` |

================================
1. EXECUTIVE VERDICT
====================

**MODEL3_RETRY_FALLBACK_BUILD_FAILURE_CAUSAL_AUDIT_PASS_REPAIR_READY**

| Field | Value |
|-------|--------|
| Root-cause class | **A. `DEFAULT_RESEGMENT_RETURN_TYPE_INCOMPLETE`** |
| Classification | **TYPE_ONLY** |
| Architecture conflict | **NO** (not a Delta 2 design failure) |
| `DECISION_REQUIRED_BEFORE_REPAIR` | **EMPTY** |
| Preferred repair | **OPTION A** — align `defaultResegment` declared return with authoritative `ResegmentRetryRegionResult` |
| Production scope | **1 file preferred** (`model3-retry-router.ts`); max 2 |
| Next phase | `MODEL3_RETRY_FALLBACK_BUILD_COMPLETENESS_REPAIR` |

The intended diagnostic contract allows `resegmentResult.code` because the authoritative regional resegment result type declares optional `code?: string`. Production `tsc` rejects the read because `defaultResegment` is explicitly annotated with a **narrower** return `{ ok; localSpans }` (no `code`), and `args.resegment ?? defaultResegment` therefore infers a union on which `.code` is illegal.

================================
2. FIRST CAUSAL FAILURE
=======================

Reproduced (this audit):

```text
Command: npm run build:main
         → clean:main && tsc --project tsconfig.main.json && ...
Error:   TS2339
File:    main/src/model3-runtime/model3-retry-router.ts:358
Message: Property 'code' does not exist on type
         'ResegmentRetryRegionResult | { ok: boolean; localSpans: RetryRegionLocalSpan[]; }'.
         Property 'code' does not exist on type
         '{ ok: boolean; localSpans: RetryRegionLocalSpan[]; }'.
```

dialog_200 production-equivalent replay: **NOT_RUN** (correctly blocked before runtime).  
This remains the **only** active failure for this audit.

================================
3. TYPE OWNER CALL GRAPH
========================

```text
producer (production wire)
  run-model3-path-step.ts
    injects resegment = (args) => resegmentRetryRegionWithLattice(...)
      declared/inferred return: Promise<ResegmentRetryRegionResult>
      fail arms set code: 'EMPTY_SLICE' | lattice.code | 'NO_PATH' | exception message

producer (DI default / tests without lattice)
  model3-retry-router.ts :: defaultResegment
      declared return: { ok: boolean; localSpans: RetryRegionLocalSpan[] }   ← NARROW
      runtime shape:   { ok: true, localSpans }   (always success stub; no code)

selection
  const resegment = args.resegment ?? defaultResegment
  // effective call return inference:
  //   ResegmentRetryRegionResult | { ok; localSpans }

consumer
  const resegmentResult = await Promise.resolve(resegment(...))
  fallbackReason = resegmentResult.ok
    ? undefined
    : resegmentResult.code ?? 'LATTICE_FAIL_OR_NO_PATH'   ← TS2339 on .code

trace field
  Model3RetryRegionTrace.fallbackReason?: string
  Model3RetryRecallInvocationTrace.fallbackGeometrySource?: ...
  written only into region/recall traces (spread), not JobResult
```

Authoritative fn type already declared:

```ts
Model3RetryRegionResegmentFn = (...) =>
  ResegmentRetryRegionResult | Promise<ResegmentRetryRegionResult>
```

`defaultResegment` is **not** declared as that fn type; its explicit narrower return is what forces the union.

================================
4. AUTHORITATIVE RESULT CONTRACT
================================

**YES** — `ResegmentRetryRegionResult` (in `model3-retry-region-resegment.ts`) is the existing authoritative regional resegment result contract.

| Field | Type | Optionality | Downstream use |
|-------|------|-------------|----------------|
| `ok` | `boolean` | required | `resegmentOk` / `localSpanSource` LATTICE vs FALLBACK |
| `localSpans` | `RetryRegionLocalSpan[]` | required | Stage-2 supporting surfaces; empty → `fallbackRegionLocalSpans` |
| `code` | `string` | optional | fail diagnostic → `fallbackReason` (Delta 2 side-channel) |

`pathFineSpanViews` is **not** on this result type; lattice views are consumed inside `resegmentRetryRegionWithLattice` and collapsed to `localSpans`.

`defaultResegment` semantic implementation of this contract: **PARTIAL**

- Implements success shape (`ok: true` + `localSpans`).
- Never produces `ok: false` / `code`.
- Exists as pre-Delta-2 stub when lattice DI is absent (`run-model3-path-step` passes `undefined` when imeConfig/dict missing → default stub).

================================
5. defaultResegment CONTRACT
============================

| Aspect | Finding |
|--------|---------|
| Declared return | `{ ok: boolean; localSpans: RetryRegionLocalSpan[] }` |
| Inferred return (same) | identical; annotation is authoritative for this symbol |
| Actual returned object | `{ ok: true, localSpans: fallbackRegionLocalSpans(...) }` |
| `code` present at runtime? | **NO** |
| `code` meaningful on this path? | **NO** — stub always succeeds; `.code` is never read because `ok === true` short-circuits |
| Success/fail representation | Success-only stub (not a real lattice fail path) |
| Predates Delta 2? | **YES** (DI default); Delta 2 only added the `.code` diagnostic read |

Why TypeScript produces the union:

1. `args.resegment?: Model3RetryRegionResegmentFn` → return `ResegmentRetryRegionResult` (has optional `code`).
2. `defaultResegment` → return `{ ok; localSpans }` (**no** `code` in the type).
3. `??` selection → call result type = **union of both declared returns**.
4. Accessing `.code` on a union requires `code` on **every** arm → TS2339.

This is **not** an intentional heterogeneous business contract; it is incidental incomplete typing of the default stub relative to the already-exported authoritative type.

================================
6. UNION TYPE ORIGIN
====================

Proven origin site:

```ts
const resegment = args.resegment ?? defaultResegment;
const resegmentResult = await Promise.resolve(resegment(...));
// resegmentResult: ResegmentRetryRegionResult | { ok; localSpans }
```

Not caused by redesign of RetryRegion / lattice / window enum.  
Not caused by a second authoritative result type.  
Caused solely by narrower `defaultResegment` return annotation vs `ResegmentRetryRegionResult`.

DI conceptual contract (intended):

```ts
type ResegmentFn = Model3RetryRegionResegmentFn
  // => ResegmentRetryRegionResult | Promise<...>
```

Production currently allows **heterogeneous declared return shapes** only because the default stub’s annotation drifted; runtime production path injects lattice and returns the authoritative type.

================================
7. `code` OWNERSHIP
===================

| Question | Answer |
|----------|--------|
| Who owns resegment failure reason / code? | **`ResegmentRetryRegionResult.code`** (optional), produced by `resegmentRetryRegionWithLattice` on fail |
| Is `resegmentResult.code` the correct semantic source for `fallbackReason`? | **YES** |
| Proof | Lattice fail returns set `code` (`EMPTY_SLICE`, lattice code / `NO_PATH`, exception message). Router maps `!ok → fallbackReason = code ?? 'LATTICE_FAIL_OR_NO_PATH'`. Unit fixture asserts `fallbackReason === 'NO_PATH'`. No other existing owner carries this diagnostic without inventing a new system. |

Router / trace layer **consume** the code; they do not own the failure taxonomy.

================================
8. TRACE-ONLY BOUNDARY
======================

Static verification:

| Check | Result |
|-------|--------|
| `fallbackReason` selects geometry / behavior? | **NO** — geometry uses unconditional `enumerateStage2SuccessPathQueryLocals`; reason only assigned after `ok` check for trace |
| `fallbackGeometrySource` selects behavior? | **NO** — constant side-channel when `!ok` |
| Enters JobResult? | **NO** |
| Cross-service DTO? | **NO** (no matches under `shared/` / pipeline JobResult) |
| Changes Recall / Assembly / Domain Vote? | **NO** |

Verdict: **`TRACE_ONLY_INTERNAL_TYPE`** — no architecture drift.

Separate questions:

| Q | Answer |
|---|--------|
| A. Is `fallbackReason` required for Delta 2 **runtime** semantics? | **NO** — Stage-2 query geometry does not branch on it |
| B. Is it required for Acceptance / Development **diagnostics**? | **YES (intended)** — fixtures assert reason; Development report documents side-channel |

Do not delete diagnostics to silence the build. Align the type contract first.

================================
9. TYPE VS RUNTIME CLASSIFICATION
=================================

**TYPE_ONLY**

Proof:

1. Production wire uses lattice resegment → full `ResegmentRetryRegionResult`; fail objects already include `code` when `.code` would be read.
2. `defaultResegment` always returns `ok: true` → the `resegmentResult.code` expression is **unreachable** at runtime on that arm.
3. No evidence of a live runtime object that is `ok: false` **without** a place for `code` under the authoritative producer.
4. Compiler failure is exclusively about the **declared** narrower stub type in the `??` union.

Not `TYPE_AND_RUNTIME_CONTRACT`. Not `RUNTIME_CONTRACT`.

================================
10. MINIMAL REPAIR OPTIONS
==========================

**OPTION A — Align `defaultResegment` return type with `ResegmentRetryRegionResult`**

- Annotate return as `ResegmentRetryRegionResult` (or type the default as `Model3RetryRegionResegmentFn`).
- Keep runtime object `{ ok: true, localSpans }` (optional `code` omitted on success — valid).
- Eliminates the illegal union arm; `.code` becomes legal optional access.
- No cast / ignore / blind `'code' in` guard.
- Drift gates: all **NO**.

**OPTION B — Read failure code through another correctly typed owner**

- Rejected as primary: no alternate authoritative owner exists for resegment fail codes outside `ResegmentRetryRegionResult`.
- Narrowing only at the consumer without fixing the producer type would either invent a guard (forbidden as silence) or duplicate derivation.

**OPTION C — Remove / alter nonessential diagnostic read**

- Runtime Delta 2 geometry does not need `code`.
- But `code` **has** an authoritative owner; Acceptance/Development diagnostics intentionally read it.
- Removing `fallbackReason` would drop diagnostic contract without fixing the incomplete default return type (stub would remain inconsistent with `Model3RetryRegionResegmentFn`).
- Not preferred.

Forbidden approaches (rejected): `as any`, `@ts-ignore`, blind optional chaining as sole fix, arbitrary `'code' in` guards, hardcoded `fallbackReason`, new enums/unions/flags.

================================
11. PREFERRED REPAIR
====================

**OPTION A** — single minimal type-contract alignment on `defaultResegment` in `model3-retry-router.ts`.

Optional micro-clarity (same file, still ≤1 file): annotate  
`const resegment: Model3RetryRegionResegmentFn = args.resegment ?? defaultResegment`  
after default return type is correct.

================================
12. DELTA 2 ISOLATION
====================

Minimal repair can complete without changing:

| Surface | Unchanged? |
|---------|------------|
| `RETRY_FALLBACK_GEOMETRY_SOURCE` | YES |
| legal window enumeration | YES |
| RetryRegion | YES |
| resegmentOk | YES |
| regional lattice behavior | YES |
| candidate ownership | YES |
| Recall / Assembly / Domain Vote / Model3 | YES |
| Delta 1 success path | YES |

**Direct repair: YES to all.**

================================
13. DEVELOPMENT GATE GAP
========================

| Gate | What ran / runs | Result vs production |
|------|-----------------|----------------------|
| Development evidence | Jest retry-related: **37/37 PASS** (`model3_retry_fallback_development_evidence.json`) | PASS |
| This audit | `npx jest ... model3-retry-stage2-windows.test.ts` | **PASS** (reconfirmed) |
| Authoritative production | `npm run build:main` → `tsc --project tsconfig.main.json` (`strict: true`) | **FAIL TS2339** |

Why Development could report PASS:

1. Development did **not** require `npm run build:main` as a hard gate.
2. Jest uses `jest.config.js` + `ts-jest` `createDefaultPreset()` with empty options `{}`.
3. Default TS config resolution hits repo root `electron-node/tsconfig.json`, which **includes only `renderer/src`** and sets `isolatedModules: true` / `noEmit: true` — **not** `tsconfig.main.json`.
4. Production mainline typecheck is a separate program: `tsc --project tsconfig.main.json` including `main/src/**/*` (tests excluded).
5. Therefore unit transpile/execution under Jest is **not** equivalent to the authoritative production typecheck. Invalid mainline types can ship past `DEVELOPMENT_PASS`.

Classification of the **gate** gap: **D. `DEVELOPMENT_ONLY_TYPECHECK_GAP`** (orthogonal to root-cause class **A** of the TS2339 itself).

================================
14. GOVERNANCE CORRECTION
=========================

Minimal permanent rule (record only — **not implemented in this audit**):

> No TypeScript production-mainline development may report `DEVELOPMENT_PASS` unless the authoritative production typecheck/build command passes.

Proven authoritative command for this package:

```text
npm run build:main
```

(cwd: `electron_node/electron-node`; implements `tsc --project tsconfig.main.json`).

Do not invent a new CI system in this phase; enforce in future Development / Acceptance prompts.

================================
15. FUTURE REPAIR GATES
=======================

Pre-registered sequence (do not replace original Acceptance):

1. Production build/typecheck **PASS** (`npm run build:main`)
2. Existing Retry unit tests **PASS**
3. Delta 1 success fixture parity **PASS**
4. Delta 2 fallback fixture **PASS**
5. No architecture drift
6. Then rerun the **ORIGINAL** independent  
   `MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE` unchanged

No dialog_200 in the repair phase until build completeness is restored; Acceptance owns the full replay.

================================
16. DECISION_REQUIRED_BEFORE_REPAIR
===================================

**EMPTY**

One clearly authoritative minimal repair (OPTION A). No architecture ownership tradeoff.

================================
17. TARGET LIST
===============

**MODIFY (repair phase):**

| File | Symbols |
|------|---------|
| `electron_node/electron-node/main/src/model3-runtime/model3-retry-router.ts` | `defaultResegment` return type (optionally local `resegment` annotation) |

**READ_ONLY (do not change for this repair):**

| Symbol / file |
|---------------|
| `ResegmentRetryRegionResult`, `Model3RetryRegionResegmentFn`, `resegmentRetryRegionWithLattice` |
| `enumerateStage2SuccessPathQueryLocals`, RetryRegion, `resegmentOk` semantics |
| `fallbackGeometrySource` / `fallbackReason` field declarations in `model3-types.ts` (keep) |
| `run-model3-path-step.ts` lattice injection |
| Delta 1 success path |

**Tests to run after repair:**

- Retry-related Jest suite (at least `model3-retry-stage2-windows.test.ts` + prior 37-count cohort)
- `npm run build:main`

**Acceptance to rerun after gates 1–5:**

- `MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE` (original, unchanged)

================================
18. CHECK LIST
==============

- [x] first causal failure reproduced
- [x] authoritative result type located
- [x] defaultResegment shape inspected
- [x] union origin proven
- [x] `code` semantic owner proven
- [x] trace-only boundary verified
- [x] TYPE_ONLY vs runtime mismatch classified
- [x] minimal repair identified
- [x] Delta 2 semantics unchanged (for preferred repair)
- [x] Delta 1 unchanged
- [x] production scope ≤2 files preferred
- [x] no cast/ignore workaround
- [x] production build gate identified
- [x] previous Development gate gap explained
- [x] future repair gates pre-registered
- [x] DECISION_REQUIRED empty before repair

================================
19. NEXT PHASE
==============

**MODEL3_RETRY_FALLBACK_BUILD_COMPLETENESS_REPAIR**

Minimal type-contract repair only (OPTION A).  
Then: build + targeted tests → rerun original Delta 2 Acceptance.  
Do not redesign Delta 2. Do not reopen Delta 1. Do not start Post-Delta Reconciliation / performance / Model3 quality work.
