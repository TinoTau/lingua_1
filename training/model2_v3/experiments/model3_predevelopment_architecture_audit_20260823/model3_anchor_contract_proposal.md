# Model3 Anchor Contract Proposal (audit-only)

## Principle

Anchors are **upstream labels**, not Model3 discoveries. Model3 **MUST NOT** discover anchors.

## Domain Anchor

**Derivation (no new score):**

```text
anchor = true
anchorSource = DOMAIN
IFF WindowCandidate c satisfies:
  c ∈ DomainFilteredSpanSet.sameDomainCandidates
  AND DomainFilteredSpanSet.bucketDomain ∈ vote.retainedDomains
  AND c.graphSource ∈ {domain_term, passive_domain_weak}
```

**Multi retained domain:** each retained domain produces its own bucket; anchor is **per bucket membership**, not a single global domain winner. Model3 receives retained set; does not pick domain.

**Base terms:** `source=base_term` never forms Domain Anchor.

## Model2 Anchor

```text
anchor = true
anchorSource = MODEL2
IFF WindowCandidate c has:
  c.retrievalProvenance ∈ {PROFILE_PRONUNCIATION, PROFILE_DOMAIN}
  AND c.originSpanId is set
  AND c passes existing materialize gates (range binding for D)
```

Model2 remains **P/D ONLY** — no KEEP/RETRY output from Model2.

## Span binding

Anchor mask keyed by **`fineSpanId`** (`PathFineSpan.spanId`) and **`originSpanId`** on Model2 candidates. Character offsets (`rawStart/rawEnd`) are secondary.

## Model3 read-only on anchors

Runtime must mask anchor spans from RETRY output even if model emits values.
