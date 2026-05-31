# FW Mainline Freeze — ASR → NMT

**Status:** FROZEN (2026-05-27)  
**Scope:** `asr.engine = fw_detector_v1` production path only.  
**Operational detail:** [PIPELINE.md](./PIPELINE.md) · [FREEZE_GUARD.md](./FREEZE_GUARD.md)

---

## Pipeline

```
ASR (faster-whisper-vad)
  ↓
FW Metadata Span Gate
  ↓
Lexicon Runtime V2 Recall
  ↓
P4 Sentence-Level KenLM Rerank
  ↓
applyFwSpanReplacements → segmentForJobResult
  ↓
Aggregation
  ↓
[5016 / 5017 / 5015 — default OFF, write-lock if FW applied]
  ↓
Dedup (shouldSend only, no text mutation)
  ↓
NMT (segmentForJobResult)
```

---

## Single Sources of Truth

| Role | Field / Function |
|------|------------------|
| ASR immutable baseline | `ctx.rawAsrText` — written once in `asr-step.ts` |
| NMT + result text SSOT | `ctx.segmentForJobResult` — via `resolveBusinessAsrText` / `getTextForTranslation` |
| Client mirror | `JobResult.text_asr` — copy of SSOT, not a second writer |
| FW apply | **`applyFwSpanReplacements` only** — `fw-detector-orchestrator.ts` |
| Span selection | **`selectFwMetadataSpans`** — primary: alias + word probability metadata |
| Recall | **`recallSpanTopK`** → V2 SQLite when `useLexiconRuntimeV2Recall` |
| Sentence pick | **`runFwSentenceRerankPipeline`** when `useSentenceLevelRerank` |

Removed from FW path: `repairedText`, `LEXICON_RECALL`, `SENTENCE_REPAIR`, CTC n-best into ctx.

---

## Default Configuration (code: `node-config-defaults.ts`)

| Key | Frozen default |
|-----|----------------|
| `asr.engine` | `fw_detector_v1` |
| `features.lexiconRuntimeV2.enabled` | `true` |
| `features.fwDetector.useLexiconRuntimeV2Recall` | `true`（**两者同时 true** 才走 V2 SQL recall） |
| `features.fwDetector.spanGateMode` | `fw_metadata_gate` |
| `features.fwDetector.kenlmSpanGate.enabled` | `false` |
| `features.fwDetector.useSentenceLevelRerank` | `true` |
| `features.fwDetector.fwMetadataSpanGate.maxSpans` | `4` |
| `features.fwDetector.maxSentenceCandidates` | `16` |
| `features.fwDetector.minDeltaToReplace` | `0.03` |
| `features.fwDetector.enableKenLMGate` | `true` (**P4 sentence rerank 必需**；false 则永不 apply) |
| `features.fwDetector.useIndustryRouting` | `false` |
| `features.semanticRepair.enabled` | `false` (5015) |
| `features.phoneticCorrection.enabled` | `false` (5016) |
| `features.punctuationRestore.enabled` | `false` (5017) |
| `features.lexiconRecall.enabled` | `false` (legacy V1 recover) |

Runtime overrides: `%APPDATA%/lingua-electron-node/electron-node-config.json`.

---

## Rollback Switches (config only — do not change code for rollback)

| Goal | Config change |
|------|----------------|
| P1.2b per-span topK + weak_veto | `useSentenceLevelRerank: false` |
| KenLM span gate | `spanGateMode: kenlm_gate_filter`, `kenlmSpanGate.enabled: true` |
| Legacy detector gate | `spanGateMode: legacy_detector` |
| V1 lexicon recall | `useLexiconRuntimeV2Recall: false` |
| Disable FW entirely | `features.fwDetector.enabled: false` |

---

## Metadata Gate — Legacy Fallback (documented, not main path)

See `fw-metadata-span-gate.ts`. Fallback runs **only when**:

1. No alias / low_word_probability candidates
2. `allowSegmentFallbackScan === true`
3. Low segment avg_logprob **and** (missing word alignment **or** alignment failures)

Max spans: `fallbackLegacyMaxSpans` (default **1**). `detector_pinyin_hint` stripped. **Not** Recover pipeline.

---

## Enhancement Steps 5015 / 5016 / 5017

Registered in FW pipeline **after** aggregation. **Default OFF.**

When `ctx.asrRepairApplied === true` (FW apply succeeded), `isSegmentWriteLocked` prevents 5015/5016/5017 from overwriting `segmentForJobResult`.

---

## Prohibited Without Unfreeze

- Change Recall merge / SQL / domain routing logic
- Change P4 rerank combinator or KenLM sentence batch
- Change Metadata Gate primary signals or thresholds in code
- Change `applyFwSpanReplacements` or add alternate FW writeback
- Change NMT input field
- Delete Recover / CTC / 5015–5017 / legacy fallback code in this cleanup phase

---

## Verification

- Static: `main/src/fw-detector/freeze-contract.test.ts`
- Batch config SSOT: `tests/freeze-config-ssot.json` → `tests/patch-p4-config.mjs`
- Batch run: `tests/run-lexicon-v2-p4-batch.js`
- Rollback reference: `tests/freeze-rollback-config.json`
