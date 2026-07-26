# Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md

**Document Type:** Constraint Addendum (Development Binding Document)  
**Status:** Frozen Constraint (Current Round)  
**Applies To:** Metrics Layer SSOT Alignment  
**Relationship:** This document **does not replace** the approved Development Plan / Supplement. It supplements them and, together with them, forms the **only implementation basis** for this development round.

**Companion:** [Lingua_Metrics_Layer_SSOT_Alignment_Supplement_2026_07_14.md](./Lingua_Metrics_Layer_SSOT_Alignment_Supplement_2026_07_14.md)

**Permanent Constraint（Runtime 演进上位法）：** [Lingua_Runtime_Evolution_Rule.md](./Lingua_Runtime_Evolution_Rule.md) — 本文 AC/DC/Mapping 条款在其下执行；新增 Runtime 字段必须先 Freeze + Catalog 登记。

---

# 1. Purpose

This document defines the implementation constraints for the Metrics Layer.

It does **not** introduce new functionality.

It does **not** modify the frozen architecture.

It only supplements:

* Implementation Constraints
* Architecture Constraints
* Decision Constraints
* Responsibility Boundaries
* Interface Contracts
* Data Contracts
* Ownership Constraints
* Diagnostics Constraints
* Trace Contracts
* Regression Requirements
* Acceptance Requirements
* Counterfactual Requirements
* Architecture Compliance Requirements

---

# 2. Architecture Constraint

## AC-1 Runtime is the only SSOT

```
Runtime Diagnostics
        │
        ▼
Metrics Mapping
        │
        ▼
Consumer Report
```

Metrics must never become another business decision layer.

### Source

* Historical Decision
* Frozen Architecture
* Previous Audit
* Current Supplement

### Necessity

Eliminate dual SSOT.

### Impact

Metrics Layer only.

### Future Risk

Otherwise another Runtime Projection layer will appear.

---

## AC-2 Metrics is Consumer Only

Metrics is a passive consumer.

It must never:

* infer new business state;
* reconstruct Repair Pipeline;
* redefine Runtime semantics;
* participate in Runtime decisions.

### Source

Frozen Principle

### Risk

Shadow Logic.

---

## AC-3 Consumer Report is not Architecture

Success Funnel

Recall Funnel

E2E Report

Business Report

are all Consumer Reports.

They are not Architecture.

They must never redefine Runtime.

---

# 3. Implementation Constraint

## IC-1 Runtime Code is Frozen

The following modules are frozen.

* FW
* Tone
* Recall
* Domain Vote
* Sentence Assembly
* KenLM
* Runtime
* Lexicon

Metrics development must not modify them.

---

## IC-2 No Projection Logic

Metrics must perform only:

```
Read
↓
Map
↓
Report
```

The following are forbidden:

```
Read
↓
Guess
↓
Infer
↓
Rewrite Stage
```

---

## IC-3 No New Runtime Fields

Metrics must consume existing Runtime fields.

No artificial Runtime fields may be introduced.

Fixture-derived values must be explicitly marked as:

```
Overlay Metric
```

instead of Runtime fields.

---

# 4. Decision Constraint

## DC-1 Runtime owns decisions

Business decisions belong exclusively to Runtime.

Metrics must never:

* decide success;
* decide ownership;
* decide replacement;
* decide stage transition.

Metrics only describes Runtime outputs.

---

## DC-2 Metrics cannot affect Runtime

There must never be any reverse dependency:

```
Metrics
    │
    ▼
Repair Pipeline
```

Forbidden.

---

# 5. Responsibility Boundary

## Runtime

Responsible for:

* Span generation
* Recall
* Candidate generation
* Sentence Assembly
* KenLM
* Final Output

Nothing else.

---

## Metrics

Responsible for:

* Reading Runtime Diagnostics
* Mapping Runtime fields
* Producing reports

Nothing else.

---

## Reports

Responsible for:

* Presentation
* Statistics
* Visualization

Reports must never become Runtime.

---

# 6. Interface Contract

## Runtime Interface

Runtime interfaces are frozen.

Metrics may only consume them.

---

## Mapping Contract

Every Metrics field must map to exactly one Runtime field.

No Metrics field may have multiple Runtime sources.

No Runtime field may silently change semantics.

---

## Naming Contract

Projection layer must preserve Runtime terminology.

For example:

```
pickedIsRaw
```

must remain:

```
pickedIsRaw
```

It must not silently become:

```
KenLM Success
```

---

# 7. Data Contract

Every Metrics field shall have:

* Runtime Source
* Mapping Rule
* Consumer
* Diagnostic Level

No implicit mapping is permitted.

Unavailable information must be reported as:

```
Unavailable
```

Never:

```
Failure
```

---

# 8. Ownership Constraint

Primary Ownership must follow the Runtime execution order.

Ownership must stop at the first failed Runtime stage.

Metrics must never guess ownership.

If a stage is unavailable, ownership must skip that stage instead of assuming failure.

---

# 9. Diagnostics Constraint

Diagnostics are observations.

They are not Runtime.

They are not business logic.

---

## Generated vs Dump

Generated candidates

and

Dump candidates

must always be distinguished.

Dump truncation must never affect Metrics conclusions.

---

## Display vs Truth

Display may truncate.

Truth may not.

Reports must clearly indicate when displayed data is only a subset.

---

# 10. Trace Contract

Trace exists only for diagnostics.

Trace is not Runtime.

Trace is not required for production.

Metrics requiring Trace must explicitly declare:

```
Trace Required
```

Otherwise the result shall be:

```
Unavailable
```

No fallback inference is allowed.

---

# 11. Regression Requirement

Metrics development must produce:

```
Runtime Business Logic Diff = 0
```

No Runtime behaviour changes.

No Repair behaviour changes.

No KenLM behaviour changes.

No Recall behaviour changes.

Only:

* Mapping
* Reporting
* Documentation
* Diagnostics configuration

may change.

---

# 12. Acceptance Requirement

Development is considered PASS only if:

1. Runtime remains the only SSOT.
2. Metrics performs mapping only.
3. No Projection business logic exists.
4. Generated and Dump are separated.
5. Stage semantics are independent.
6. Runtime interfaces remain unchanged.
7. Repair Pipeline behaviour is unchanged.
8. Reports consume Runtime directly.
9. Ownership follows Runtime.
10. Documentation reflects the Runtime architecture.

---

# 13. Counterfactual Requirement

Metrics must always distinguish:

```
Unavailable
```

from

```
Failure
```

If Runtime does not provide sufficient evidence,

Metrics must not guess.

Examples:

Lookup unavailable

Trace unavailable

Generated candidate unavailable

must remain unavailable.

They must never become failures.

---

# 14. Architecture Compliance Requirement

Every implementation must pass the following compliance checklist.

## No Shadow Logic

No duplicated business logic.

---

## No Compatibility Logic

No temporary compatibility branches.

---

## No Hidden Gate

No hidden metrics gates.

---

## No Bypass

Metrics must not bypass Runtime.

---

## No Dead Feature

Deprecated Metrics definitions must be removed.

---

## No Dual SSOT

Only one Runtime truth.

---

## No Runtime Drift

Metrics must not redefine Runtime semantics.

---

# 15. Documentation Constraint

The following documents must remain consistent.

* Architecture
* Interface Freeze
* Diagnostics Freeze
* Metrics Mapping
* Development Plan
* Constraint Addendum

No document may define an alternative Runtime behaviour.

---

# 16. Future Development Constraint

Future development of:

* Recall
* Sentence Assembly
* KenLM
* Domain Vote

must reuse this Metrics Layer.

No future module may introduce another reporting semantics.

---

# 17. Final Constraint

The Development Plan / Supplement defines:

> **What to build.**

This Constraint Addendum defines:

> **What must never be changed.**

Both documents are mandatory.

Neither document may be interpreted independently.

Together they constitute the only implementation contract for the Metrics Layer SSOT Alignment development.
