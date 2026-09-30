# Model3 Error-Text → Future TTS Bridge

## This round

**NO AUDIO / NO TTS.**

## Preserve for later

Each `ERROR_TEXT_SAMPLE_V1` keeps:

- `referenceText` (clean TTS input option)
- per-corruption `targetPinyin` / `targetTone` / `errorSurface` (corrupted pronunciation representation)
- `evidenceLevel=SYNTHETIC_TEXT`

## Future paths

| Path | Provenance |
|------|------------|
| Reference TTS → ASR | `TTS_ASR` |
| Corrupted-surface TTS → ASR | `TTS_ASR` + corruption family |
| Human ASR | `HUMAN_ASR` |
| Text-only synthetic | `SYNTHETIC_TEXT` (never claim acoustic truth) |

## Compatibility

Reuse existing Piper/corruptor **pipeline shape** where useful, but surface authority remains lexicon/G2P SSOT — do not claim text corruption equals acoustic truth.
