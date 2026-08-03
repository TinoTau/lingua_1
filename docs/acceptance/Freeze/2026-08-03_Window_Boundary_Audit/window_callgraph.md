# Window / Syllable Call Graph

Freeze: `FW_V4_FREEZE_2026_08_03` · READ ONLY

```text
ASR Raw Text (string)
        │
        ▼
buildUtteranceSyllableCoordinate(rawText)
  pinyin-ime-v2-pinyin-stream.ts
        │
        ├─ CJK_RUN_RE → each CJK run
        │     └─ textToSyllables(runText)   // lexicon/phonetic/pinyin.ts → pinyin-pro
        │           → syllables[]
        ├─ CharSyllableRange { charStart, charEnd, syllableStart, syllableEnd }
        └─ globalSyllables: string[]
        │
        ▼
partitionCoarseSpans(rawText, imeConfig, dict)
  → coarseSpans[]   (soft metadata for Lattice; not sole hard-block)
        │
        ▼
buildLexicalWindowQueries({ rawText, globalSyllables, coarseSpans, ranges })
  build-lexical-window-queries.ts
        │
        └─ for start in [0..N)
             for end in (start+1 .. min(start+5, N)]
               buildWindowDescriptorForRange({ syllableStart, syllableEnd, ... })
                 window-construction-core.ts
                   │
                   ├─ syllableStart / syllableEnd  ← loop indices (owner)
                   ├─ syllableRangeToRawCharRange  → rawStart / rawEnd
                   ├─ windowText = rawText.slice(rawStart, rawEnd)
                   ├─ windowPinyinKey = syllables.join("|")   ← plainPinyin
                   └─ windowId = `${syllableStart}:${syllableEnd}`
        │
        ▼
latticeHardBlockFilter(windows, rawText, coarseSpans, wordTimeSpans)
  → mark blocked OR keep
        │
        ▼
recallableWindows (!blocked)
        │
        ▼
recallTopKForWindows → Recall Query
```

## Field ownership

| Field | Decided by |
|-------|------------|
| `syllableStart` / `syllableEnd` | `buildLexicalWindowQueries` nested loops |
| `windowText` / `rawStart` / `rawEnd` | `buildWindowDescriptorForRange` via `syllableRangeToRawCharRange` |
| `windowPinyinKey` (plain) | `globalSyllables.slice(start,end).join('\|')` |
| `globalSyllables` | `buildUtteranceSyllableCoordinate` ← `textToSyllables` on **ASR Raw** |
| block / keep | `latticeHardBlockFilter` |

## Production vs harness

- Lattice production: `lattice-fine-span-runtime.ts` uses the same chain (`buildLexicalWindowQueries` + `latticeHardBlockFilter`).
- Phase1 harness: identical window path.
- Legacy LTR: `generateGlobalWindows` uses length **2..5** + hard boundary cross (`V4_LIMITS`), not Lattice 1..5 soft-cross.
