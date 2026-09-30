# Model3 Input Contract V1

**Status:** FROZEN · **Role correction:** 2026-08-26 (TEXT_ONLY)  
**Parent:** `MODEL3_ARCHITECTURE_CONTRACT_V1.md`  
**Frozen model-visible SSOT:** `model3_v1_model_visible_feature_allowlist.json` + `bigru_v1.py` packer

---

## Modality (authoritative)

| Channel | Model3 V1 |
|---------|-----------|
| ASR / FineSpan text | YES — model-visible |
| Upstream Anchor mask | YES — model-visible |
| Raw audio | **NO** |
| FW audio timestamps | **NO** |
| Acoustic Tone tensors | **NO** |
| TTS metadata | **NO** |

**Hard gate:** ACOUSTIC model-visible input count = **0**. Otherwise `ROLE_DRIFT`.

Tone / acoustic evidence may exist **upstream** (Recall ranking, Tone module) per those contracts. They are **not** packed into Model3 V1 tensors unless a future ACP explicitly changes this.

---

## Granularity

**One inference** per **eligible path-local resolved span sequence** (tied to current `PathFineSpanView` / post-`runDomainAwareAssembly` state), not per span.

Utterance may have multiple paths; Stage-1 wiring decides whether Model3 runs once per path or once per utterance with a single selected path view. Hard limit remains: **≤1 Model3 call that can enable retry** per utterance (see retry contract).

---

## Frozen model-visible features (Synthetic V1)

| Feature | Class |
|---------|-------|
| char tokens from current surface | TEXT_DERIVED |
| `isAnchor` | ANCHOR_DERIVED |
| `span_len_log1p` | TEXT_DERIVED |
| `span_rel_position` | TEXT_DERIVED |
| `first_pass_cand_log1p` | TEXT_DERIVED (runtime recall lattice count) |
| `current_cjk_len_log1p` | TEXT_DERIVED |
| `pinyin_channel_avail` | TEXT_DERIVED (availability bit only) |

---

## Type: `Model3SpanInput` (runtime design — fields vs visibility)

Derived from existing CODE_REALITY types — **not** a copy of JobResult.

Schema / design may *mention* tone or acoustic objects for **trace / future ACP**. For **Model3 V1 inference**, only text + Anchor allowlist fields are model-visible. Acoustic / Tone fields below are **NOT_MODEL_VISIBLE** for V1.

```ts
/** Conceptual SSOT — implement in Stage1 as internal-only. */
type Model3AnchorSource = 'NONE' | 'DOMAIN' | 'MODEL2' | 'DOMAIN_AND_MODEL2';

type Model3PinyinProvenance = 'TEXT_DERIVED_SYLLABLE_KEY' | 'ABSENT';

type Model3SpanInput = {
  spanId: string;
  originSpanId?: string;
  surface: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;

  isAnchor: boolean;
  anchorSource: Model3AnchorSource;
  targetMask: 0 | 1;

  retainedDomainEvidence: {
    retainedDomains: readonly string[];
    memberBucketDomains: readonly string[];
  };

  pinyinEvidence: {
    windowPinyinKey?: string;
    provenance: Model3PinyinProvenance;
  };

  recallEvidence: {
    firstPassCandidateCount: number;
    length1TerminalReason?: string | null;
  };

  /**
   * NOT Model3 V1 model-visible (upstream / QA / future ACP only).
   * Do not pack into Synthetic V1 tensors.
   */
  toneEvidence?: {
    readiness?: string;
    acousticTonePattern?: number[];
    toneCompatible?: boolean;
    tonePenalty?: number;
    provenance?: string;
  };
  acousticEvidence?: {
    asrSegmentConfidence?: number | null;
    wordTimeAligned: boolean;
    status: 'AVAILABLE' | 'PARTIAL' | 'ABSENT';
  };
  pronunciationEvidence?: {
    selectedActions?: readonly string[];
    retrievalProvenance?: 'PROFILE_PRONUNCIATION' | 'PROFILE_DOMAIN' | null;
    model2ActionId?: string | null;
  };
};

type Model3UtteranceInput = {
  utteranceId: string;
  pathId: string;
  spans: Model3SpanInput[];
  retainedDomains: readonly string[];
};
```

---

## Prohibitions

| Forbidden | Rule |
|-----------|------|
| Audio / FW timestamps / Tone tensors as Model3 inputs | TEXT_ONLY V1 |
| Full `UserProfileV1` | Model2 owns profile parsing |
| Invented `spanConfidence` | Use ABSENT / PARTIAL |
| Text pinyin labeled as acoustic | Provenance tags required |
| Surface / indexOf identity | Use `spanId` only |
| Force non-overlap segmentation | Preserve overlapping FineSpan architecture |
| Model3 discovering Anchors | Upstream only |

---

## Target mask

- `isAnchor == true` → `targetMask = 0` (loss masked; runtime KEEP)
- Non-anchor eligible → `targetMask = 1`
- Non-anchor but ineligible under trigger/eligibility gate → `targetMask = 0` (no prediction required)

**No** `targetScore`.
