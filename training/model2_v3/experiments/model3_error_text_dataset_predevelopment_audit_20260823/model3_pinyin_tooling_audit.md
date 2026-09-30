# Model3 Pinyin Tooling Audit

## Authoritative (MUST reuse)

| Tool | Path | Role |
|------|------|------|
| Plain G2P | `electron_node/.../lexicon/phonetic/pinyin.ts` | `textToSyllables` via **pinyin-pro** (`toneType: 'none'`) |
| Tone G2P | `electron_node/.../lexicon/phonetic/tone-pinyin.ts` | `textToToneSyllables` (`toneType: 'num'`); acoustic pattern → `buildTonePinyinKeyFromSyllablesAndPattern` |
| IME stream | `fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.ts` | Delegates to `textToSyllables` |
| Lexicon import | `scripts/lexicon/lib/v2-pinyin-key.mjs` | Same pinyin-pro alignment |
| Training bridge | `training/model2/phonetic/syllables.py` + `node_syllables_cli.mjs` | Calls Node SSOT; **pypinyin is fallback only** |

## Polyphonic

- Runtime G2P: **default single reading** (no heteronym expand).
- Lexicon: multi-reading via explicit `pinyin` / `tone_pinyin_key` rows.
- Error-text generator: tag `isPolyphonic=true`; require explicit source/target pronunciation provenance; **forbid silent random reading pick**.

## Forbidden for Model3 generator

- Second inconsistent G2P stack
- `pypinyin` as authoritative surface/G2P
- Deleted `pinyin-probe.ts`
