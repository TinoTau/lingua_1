# Model3 Anchor Contract V1

**Status:** FROZEN · **ACP:** `LINGUA-ACP-ANCHOR-DOMAIN-EVIDENCE-AUTHORITY-V1` (**APPROVED** 2026-09-14)  
**Parent:** `MODEL3_ARCHITECTURE_CONTRACT_V1.md`  
**Supersedes:** prior Domain Anchor / PROFILE_DOMAIN automatic Anchor authority in this file.

---

## Semantics

Anchor means: **upstream Model3 RETRY-suppression protection** for a PathFineSpan  
(*trusted enough to condition one bounded repair attempt*).

Anchor is **not** guaranteed ground truth. Model3 has **no** authority to correct Anchors.

**No** `anchorScore` / `anchorConfidence` / `anchorWeight`.

---

## Allowed sources only

| `anchorSource` | Meaning |
|----------------|---------|
| `MODEL2` | Authorized **PROFILE_PRONUNCIATION** repair evidence |

Domain-only / dual Domain+Model2 Anchor reasons are **removed**.

---

## What does NOT create Anchor

The following remain candidate / domain-hypothesis evidence for Vote / SameDomain / Assembly / KenLM, but **MUST NOT** independently suppress Model3 RETRY:

1. `domain_term`
2. `passive_domain_weak`
3. SameDomain membership / `sameDomainCandidates`
4. `retainedDomains` (support for Vote/Assembly only)
5. `PROFILE_DOMAIN` (Model2 D expansion provenance only)
6. `PROFILE_RETRIEVAL` alone
7. Base / `BASE_FUZZY` alone
8. ASR raw, KenLM winner, confidence, frequency alone

---

## Model2 Anchor (PROFILE_PRONUNCIATION only)

**All** of the following must hold:

1. Result was **materialized** into `WindowCandidate` and **retained** on the current active path (not covered-out).
2. `retrievalProvenance === 'PROFILE_PRONUNCIATION'`.
3. Candidate is geometrically / origin-bound to the PathFineSpan (`originSpanId` match or containment binding as implemented by the Anchor adapter).

**Forbidden as Model2 Anchor:**

- `PROFILE_DOMAIN`
- `PROFILE_RETRIEVAL`
- Inference actions not materialized
- Hits rejected by range / materialize gates
- Mere Model2 invoke diagnostics without a retained PROFILE_PRONUNCIATION candidate

---

## Model3 boundary

| Rule | Enforcement |
|------|-------------|
| Model3 does not discover Anchors | Adapter is upstream of Model3 |
| Model3 does not mutate Anchors | Runtime forces Anchor → KEEP / MASKED |
| Anchor RETRY in model output | `CONTRACT_FAIL` — discard / mask |
| Model3 does not consume Domain / Model2 internals | TEXT_ONLY surface + `isAnchor` + frozen allowlist |

---

## Neighbor responsibilities (unchanged)

| Module | Remains |
|--------|---------|
| Model2 D / PROFILE_DOMAIN | Candidate expansion into pool |
| Domain Vote / SameDomain / DomainFilteredSpanSet | Domain hypotheses + candidate grouping |
| Assembly / KenLM | Sentence combination / ranking |
| RETRY | One bounded local resegmentation + re-recall; **not** candidate rejection |
| `MODEL2_ON_MODEL3_RETRY` | **NO** |

Domain / PROFILE_DOMAIN candidates remain fully available to Vote / SameDomain / Assembly / KenLM after this ACP.

---

## Provenance survival

Until Anchor adapter completes, pre-assembly structures must retain:

- `fineSpanId` / `spanId` / `originSpanId`
- Model2 `retrievalProvenance` (for PROFILE_PRONUNCIATION detection)

Do **not** require Model3 metadata on final `SpanReplacementPick` / JobResult.
