# Decision Record — Supersede V2 “Neural Not Needed”

Date: 2026-08-16  
Marker: `SUPERSEDED_BY_USER_ARCHITECTURE_DECISION`

## Previous claim (historical, do not delete)

V2 acceptance reported:

```text
MODEL2_NEURAL_COMPONENT_NOT_NEEDED
```

because tiny relation-activator TIR ≈ 0 while deterministic FineSpan expansion TIR ≈ 1.0 on verified-recoverable positives.

## Reclassification (authoritative)

```text
CURRENT_RELATION_ACTIVATOR_FAILED_TO_ADD_VALUE
```

**Not** proof that Trainable Model2 is unnecessary.

### Why the old objective was insufficient

The V2 activator predicted:

```text
FineSpan + UserProfile → relation activation
```

but UserProfile already exposes pronunciation relations. The model was asked to re-predict information already present in the profile on a dataset filtered to cases where a single deterministic reverse-map recovers the target. Deterministic ≡ oracle for that task; neural gate collapsing to 0 only shows **wrong/insufficient objective**, not **architecture failure**.

## User-confirmed architecture (highest priority)

```text
TRAINABLE MODEL2 CORE = REQUIRED
DETERMINISTIC-ONLY    = NOT APPROVED without Architecture Change Proposal
```

Deterministic retrieval remains:

```text
BASELINE + RETRIEVAL PRIMITIVE + TEACHER
```

Trainable Model2 is:

```text
AUTHORITATIVE USER-CONDITIONED RETRIEVAL POLICY
```

## Historical reports

Keep V2 training/acceptance reports unchanged as historical audit.  
This record + V3 contracts supersede their architecture recommendation only.
