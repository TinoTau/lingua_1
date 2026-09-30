# Stage D Lexical Profile Semantics Contract (V1)

**Status:** FROZEN for Stage D real writeback development  
**Date:** 2026-08-17  
**Label:** USER-CONFIRMED LEXICAL OBSERVATION

## What counts as evidence

- Only **Manual Correction** confirmed intended lexical material (Replace/Insert target spans, or macro candidate from corrected text when span-level targets are too short).
- After **exact Lexicon resolution**, only **RESOLVED** observations update long-term lexical statistics and domain evidence.

## What does not count

- Unconfirmed ASR output (no auto-write) — prevents self-reinforcement.
- Delete-only edits.
- Phonetic-only ASCII syllable pairs (those update `phonetic_bias`, not lexical identity).
- UNRESOLVED / AMBIGUOUS surfaces (diagnostic only; no domain evidence; no fake term_id).
- Overlap-rejected nested spans under longest-match / whole-phrase policy.

## Term identity ownership

- **Lexicon** owns lexical identity (`term_id`, canonical surface).
- **UserProfile** stores user-specific statistics keyed by `term_id`, plus diagnostic unresolved/legacy free-text.
- UserProfile must **not** duplicate `term → domain` as a second SSOT.

## Repeat correction semantics

- Each confirmation applies EMA toward 1.0 with `LEXICAL_EMA_ALPHA = 0.25` (same style as phonetic).
- 1× evidence ≈ 0.25; repeated confirmations increase monotonically toward 1.0.
- Single correction must not saturate like 20×.

## Unknown term semantics

- Status: `UNRESOLVED_LEXICAL_OBSERVATION`.
- Do **not** auto-insert production Lexicon.
- Do **not** invent term_id.
- Do **not** contribute to `long_term_domain_evidence`.
- May retain bounded diagnostic record / lexicon-expansion candidate list (no auto expansion this phase).

## Overlap semantics

1. If the full candidate exact-matches a Lexicon term → select **only** that phrase (no nested double-count).
2. Else greedy longest-match L→R on exact surfaces; covered shorter overlaps are **rejected** with reason `REJECTED_OVERLAP_COVERED`.
3. Adjacent non-overlapping terms may both be selected.

## Profile weight semantics

- `resolved_lexical_terms[term_id].evidence` ∈ [0, 1] via EMA.
- Domain aggregation: Stage D `normalized_weighted_multitag` over `DOMAIN_SLOT_IDS` using Lexicon `term_domain_tags`.
- Compact result: `long_term_domain_evidence` (derived user state).

## Lifecycle / versioning

- Each successful apply increments `profile_version`.
- Schema version = 2 for lexicon-backed fields.
- Legacy free-text personal_terms migrate: exact Lexicon match → resolved; else → `legacy_free_text_personal_terms` (no silent delete).
- Session refresh: Gateway pushes updated profile to Scheduler; SessionBootstrap re-sent to paired Node.

## Explicit non-goals

- Session domain prior (separate).
- Stage D/J runtime checkpoint wiring.
- LLM / hardcoded domain labels.
- Correction → `domain_updates` as Lexicon knowledge writer.
