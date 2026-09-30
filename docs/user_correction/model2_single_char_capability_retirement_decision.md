# Architecture decision: MODEL2_SINGLE_CHAR_CAPABILITY_RETIRED

**Date:** 2026-08-20  
**Status:** ACTIVE GOVERNANCE  
**Supersedes:** MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_ACP and Candidate-Set Interface V1 as active SSOT

## Why

Single-character language combination space cannot reasonably be represented by UserProfile (habits, frequent phrases, domain preference, pronunciation). AmbiguityHead V1 and MinimalContext V2 failed generalization. Continuing would expand Model2 into a general language-context model and violate original Model2 ownership (P/D retrieval assistance only).

## Decision

Model2 single-char candidate decision is **removed**.

Model2 = **P/D ONLY** on frozen `RetrievalPolicyV3(with_domain_head=True)` + `expA_frozen_trunk.pt`.

Length-1 lexical recall remains owned by **Lexicon Recall** (`collectBaseOnlySingleCharCandidate`, unique-only / fail-closed). Ambiguous length-1 is a **known product limitation**, not a Model2 task.

## Future rule

Do not re-introduce Model2 single-character lexical disambiguation, general Chinese context understanding, or candidate semantic language modeling without:

1. a new Architecture Change Proposal, and  
2. explicit user approval.
