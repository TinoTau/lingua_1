# Minimal Metadata Contract (Freeze — not implemented)

## Field name (frozen)

```text
repairSelectionCompleteness
```

**Not** `repairCompleteness` (overclaims semantic correctness).

## Enum (frozen)

```text
RAW
PARTIAL_SELECTION
COMPLETE_SELECTION
```

| Value | Meaning |
|-------|---------|
| `RAW` | `repairPickCount = 0` |
| `PARTIAL_SELECTION` | `repairPickCount > 0` AND `unrepairedRepairableSlotCount > 0` |
| `COMPLETE_SELECTION` | `repairPickCount > 0` AND `unrepairedRepairableSlotCount = 0` |

Raw-only slots (no non-canonical option in Assembly `spanSets`) **never** force `PARTIAL_SELECTION`.

`MIXED_BUT_VALID` is **not** a separate enum value — it collapses into `COMPLETE_SELECTION` when only raw-only slots remain beside fully selected repairable slots.

## Diagnostic counts (max two)

```text
repairPickCount: number
unrepairedRepairableSlotCount: number
```

Do **not** put cluster lists, slot arrays, or ratios on `SentenceCombination`.

## Definitions

**Repairable Slot:** FineSpan / assembly slot whose `spanSets[i]` contains ≥1 non-canonical (non-`canonical_exact` / word≠spanText) repair option at combination build time.

**Repaired Slot:** Repairable Slot whose chosen repair subset includes a non-canonical replacement for that span.

**Unrepaired Repairable Slot:** Repairable Slot not included in the chosen repair subset (covered by canonical/raw gap fill).

**Raw-only Slot:** Slot with no non-canonical option in `spanSets` (e.g. `声`/`城` after Tone-miss empty Recall).

## Owner / consumers

| | |
|--|--|
| Producer | `buildSentenceCandidates` |
| Carrier | `SentenceCombination` |
| CrossPath | consume only; **no filter this round** |
| KenLM | **unaware** |
