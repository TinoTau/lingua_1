# Lingua1 — Dialog200 Real-Audio Replay Feasibility & Evidence-Chain Audit V1

**Mode:** READ_ONLY / TRACE_FIRST / CONTRACT_FIRST / FEASIBILITY_AUDIT  
**Production change:** NONE  
**Harness development:** NONE  
**ASR re-run this round:** NONE  
**Authority:** EVALUATION_SSOT_V1 (`REFERENCE_DIFF_REGION != LEXICAL_TARGET`; missing evidence → UNKNOWN / NOT_EVALUABLE, not FAIL)

---

## 1. Executive Verdict

**Primary question (Frozen ASR + WAV → Tone → Base → Model2 → downstream without re-ASR):** **NO**

**Capability class:** `PARTIAL` for text/path/final observables already in the frozen dump; **MISSING_EVIDENCE** for production-equivalent acoustic Tone / Base `tone_exact` / Model2-P-via-tone chain.

| Field | Value |
|-------|--------|
| RESULT | **E — ASR RERUN REQUIRED** (evidence-capture sense) |
| Q15 recommendation | **C. ASR_RERUN_REQUIRED** → then Pilot200-style freeze → **A. BUILD_MINIMAL_REAL_AUDIO_REPLAY** |
| Avoid re-ASR with current artifacts? | **NO** |
| Production files must change for replay? | **NO** (Q14 = NO; STOP not triggered) |
| Current system-level first blocker claim | Must remain **UNKNOWN** — do not re-assert Recall/Model2/Assembly/KenLM as first blocker from LEXICON_MOCK |

**Why:** Dialog200 WAV (200/200) and Frozen ASR text dump (200/200) exist, but the authoritative Frozen dump persists **neither** FW word timestamps (`asrSegments` / `words[].start/end`) **nor** `acousticToneSlices` / `utterance_tone`. Production Tone requires `processed_audio + FW WordInfo timestamps`. Without frozen timestamps or frozen slices, Tone cannot be restored in a production-equivalent way without re-entering the ASR+Tone path.

---

## 2. Source Data Inventory

### A. WAV (`test wav/dialog_200/`)

| Check | Evidence |
|-------|----------|
| Count | **200/200** present (`dialog_d001.wav` … `dialog_d200.wav`) |
| Mapping | `cases.manifest.json` → `id` ↔ `file` (e.g. `d001` ↔ `dialog_d001.wav`) |
| Format | RIFF PCM; **16 kHz**; **mono**; **16-bit**; all 200 consistent |
| Source | Piper TTS `generated_piper_restored_full_v1` (README `restored_full_v1`) — synthetic, not live human speech |
| Trim/resample/norm in corpus | Manifest/README: TTS-generated 16 kHz mono; **no** word timestamps / tone labels in manifest |
| ASR input identity | Fresh causal run provenance: `corpus_path` = this directory — same files used as ASR input for Frozen dump generation |

**State:** AVAILABLE (audio files). Note: “Real-Audio” here means corpus WAV on disk, not live microphone speech.

### B. Frozen ASR dump

**Authoritative file:**  
`docs/user_correction/model3/fresh_dialog200_raw_cases_dialog200_full_pipeline_20260909_001141.jsonl`

| Field | State |
|-------|--------|
| caseId | AVAILABLE (200 unique `d001`–`d200`) |
| rawMergedAsrText | AVAILABLE (200) |
| reference | AVAILABLE (200) |
| finalPostprocessText | AVAILABLE |
| paths / path_count / Model3 / KenLM summaries | AVAILABLE (compact) |
| segments / asrSegments | **ABSENT** (0/200) |
| word / token / syllable timestamps | **ABSENT** |
| utterance_tone / acousticToneSlices | **ABSENT** |
| audioPath / wav sha in dump rows | **ABSENT** |
| confidence / n-best / hotword state | **ABSENT** |
| model identity (per-row) | Partial via `asr_service_id` = `faster-whisper-vad`; full ASR model path only in provenance JSON |
| preprocessing identity | **ABSENT** in dump; runtime used `TONE_P10_VAD_CPU=1`, `is_manual_cut: true` |

**Provenance companion:**  
`fresh_dialog200_runtime_provenance_dialog200_full_pipeline_20260909_001141.json`  
— ASR model `faster-whisper-medium`, lexicon sqlite path, KenLM trie, Model3 identity hashes, git `63b25376`.

### C. Reference sentence

| Field | State |
|-------|--------|
| expectedText / utterance / text | AVAILABLE in manifest (authoritative final reference for FINAL correctness) |
| dump `reference` | AVAILABLE; aligned to manifest intent |
| Acoustic evidence? | **No** — expectedText is not Tone/timestamp evidence |

---

## 3. Frozen ASR Evidence

```text
FROZEN_ASR_TEXT          = AVAILABLE (rawMergedAsrText × 200)
FROZEN_ASR_TIMESTAMPS    = ABSENT
FROZEN_TONE_SLICES       = ABSENT
FROZEN_PATH_COMPACT      = AVAILABLE (historical live run; not injectable acoustic)
AUDIO_WAV                = AVAILABLE (200)
```

**Failure class (observability):** OBSERVABILITY GAP — production full-audio path **did** produce Tone at runtime (see `api_routes.py` `run_tone_inference` before dedup), but `run-fresh-dialog200-causal-reconciliation.mjs` compact extractor **did not persist** segments/slices (same class as Pilot200 Block B gap documented in `LINGUA_MODEL2_TONE_CAPABILITY_REPLAY_EVIDENCE_AUDIT.md`).

---

## 4. Timestamp Authority

### Production requirement

ToneSlice production authority:

| Item | Evidence |
|------|----------|
| File | `electron_node/services/faster_whisper_vad/tone_module/inference.py` |
| Function | `run_tone_inference(processed_audio, sample_rate, segments, …)` |
| Input type | `Sequence[SegmentInfo]` → `WordInfo` with `start` / `end` |
| Contract | “processed_audio + FW WordInfo”; skips with `no_timestamps` if empty |

Downstream mapping authority:

| Item | Evidence |
|------|----------|
| File | `electron_node/electron-node/main/src/fw-detector/tone-time-align.ts` |
| Function | `buildWordTimeSpans(rawText, asrSegments, …)` |
| Fields | `segment.words[].word`, `.start`, `.end` → `WordTimeSpan.start/end` |

**TIMESTAMP_REQUIREMENT:** FW **word** timestamps on ASR segments (option A: FW word timestamp). Not character-reconstructed, not segment-only.

**TIMESTAMP_AVAILABLE (Dialog200 Frozen dump):** **ABSENT**

**TIMESTAMP_EQUIVALENCE:** **ABSENT**  
(Forbidden: inventing / re-estimating timestamps and calling them production-equivalent.)

---

## 5. Audio Coordinate Identity

Production timestamps are aligned to **`processed_audio`**, not raw file bytes:

- `api_routes.py`: `prepare_audio_with_context` → VAD may **concatenate speech spans** (silence removal) → ASR → Tone on that buffer.
- Comment at call site: word timestamps align with `processed_audio`.

Fresh Dialog200 runner: `POST /run-pipeline-with-audio` with `wavPath` + `is_manual_cut: true` (isolated utterance). Context buffer typically empty for first/manual-cut utterances, but **VAD trim/concat still may remap the time axis**.

| Classification | Value |
|----------------|--------|
| WAV vs dump case mapping | Same corpus directory (provenance) — file identity **AVAILABLE** |
| Frozen timestamp ↔ WAV | **UNKNOWN / INAPPLICABLE** — timestamps not frozen |
| Future: raw WAV + frozen word times without processed_audio | Risk **AUDIO_COORDINATE_MISMATCH** if VAD trimmed |
| Future: freeze `acousticToneSlices` (post-Tone) | **AUDIO_COORDINATE_EXACT** for inject replay (Pilot200 pattern) |
| Future: freeze segments + processed_audio (or VAD map) | **AUDIO_COORDINATE_TRANSFORMABLE** / EXACT |

**Current audit label:** **UNKNOWN** for historical bit-identity; **ABSENT timestamps** dominate.

---

## 6. Tone Replay

| # | Question | Answer |
|---|----------|--------|
| 1 | Tone inputs | `processed_audio` + FW `segments.words` timestamps + zh language |
| 2 | Offline deterministic? | Classifier NPZ load + feature_v2; largely deterministic with fixed model; GPU path may be bounded-nondeterministic |
| 3 | Runtime-only state? | Optional context buffer / prior text — manual-cut batch usually empty |
| 4 | ASR process memory? | Needs ASR segment words OR frozen slices; not ASR weights alone |
| 5 | External service? | Tone runs inside ASR service process (`faster_whisper_vad`) |
| 6 | Checkpoint exists? | YES — default under `tone_module/models/production/` (+ candidates); identity must be pinned at capture |
| 7 | Preprocessing exists? | YES — `feature_v2.extract_feature` |
| 8 | ToneSlice from WAV + Frozen timestamps? | **No Frozen timestamps** → cannot |
| 9 | Output usable for Base Recall? | Production yes (`acousticToneSlices` → `mapToneEvidenceForRecall`) |
| 10 | Random? | Model forward; treat as CONTROLLED / NONDETERMINISTIC_BUT_BOUNDED if GPU |

**TONE_REPLAY = MISSING_EVIDENCE**

(After Pilot200-style capture of slices: would become READY / MINOR_HARNESS_REQUIRED via inject — not current state.)

---

## 7. Base Recall Replay

Production Base Recall for tone_exact consumes mapped acoustic tone pattern + window text/pinyin via lattice Phase1 (`tone-recall.ts` → `mapToneEvidenceForRecall`; fail-closed when no pattern).

```text
Frozen ASR text          AVAILABLE
Tone Replay              MISSING_EVIDENCE
Lexicon DB               AVAILABLE (provenance path)
        ↓
Base tone_exact Query    NOT_EVALUABLE today
```

Production functions exist and should be **called**, not reimplemented (`TEST HARNESS CALLS PRODUCTION LOGIC`). Blocker is upstream Tone evidence, not missing recall code.

**BASE_RECALL_REPLAY = MISSING_EVIDENCE** (tone_exact path)  
Plain/non-tone tiers: not the contract under audit for “acoustic evidence restore.”

---

## 8. Model2 P/D Replay

### P_FEATURE_DEPENDENCY_GRAPH

```text
UserProfile.phonetic_bias  ──► Model2PolicyInput.phoneticBias ──► p_feature_presence / Stage P retrieval
WindowEvidence (syllables, windowText, pinyin, baseCandidates) ──► Model2PolicyInput
Acoustic Tone / tone_exact readiness ──► Base pool shape / tone-first gate (indirect to P evaluation quality)
```

| Dependency | Mark |
|------------|------|
| `phonetic_bias` (P presence) | RUNTIME_ONLY / harness-injectable profile — **not** from Tone CNN; **AVAILABLE_FROM_EXISTING_ARTIFACT** only if profile frozen per case (Dialog200 dump does **not** store profile bias) → currently **MISSING** for case-faithful P |
| Window syllables / text | RECOMPUTABLE_FROM_FROZEN_ASR (text) |
| Base candidates (tone_exact) | depends on Tone → **MISSING** |
| Acoustic feature as direct P producer | **NOT** production P presence source (`finespan-adapter.ts`: P from profile `phonetic_bias`) |

**Do not equate:** `P unavailable` ≡ `Model2 overall unavailable`.

| Path | Classification |
|------|----------------|
| MODEL2_P_REPLAY | **MISSING_EVIDENCE** (no frozen profile bias + no Tone-shaped base pool for production-equivalent P eval) |
| MODEL2_D_REPLAY | **MINOR_HARNESS_REQUIRED** / PARTIAL — D uses `long_term_domain_evidence` / `personal_term*` from profile; same profile-freeze gap; less dependent on Tone slices than Base tone_exact |

---

## 9. Downstream Replay

Live full-audio run **already produced** multi-path compact traces in the Frozen dump:

- `path_count` distribution: 1→88, 2→75, 3→3, 4→21, 6→4, **8→9** (cap hit observable historically)
- Compact fields: domain_vote, model2_union, assembly_sentences, model3 decisions/retry

That is **historical observability**, not a replay inject contract.

### DOWNSTREAM_REPLAY_CAPABILITY_MATRIX

| Stage | Call production? | Inputs from prior replay? | Live-only? | Missing evidence? | Existing harness entry? | Reimplement? |
|-------|------------------|---------------------------|------------|-------------------|-------------------------|--------------|
| LexicalEdge | YES | Needs Tone/Base/Model2 | No | Tone/Base | Phase1 harness / full audio | HIGH_DRIFT_RISK if copy |
| SegmentationPath | YES | Edges | No | upstream | lattice runtime | HIGH_DRIFT_RISK if copy |
| Path Cap (8/8) | YES | Paths | No | upstream candidates | e2e funnel (live audio) | Do not change cap |
| Domain Vote | YES | Path | No | upstream | dump compact only | Prefer production |
| SameDomain | YES | Vote | No | upstream | production | Prefer production |
| Assembly | YES | Paths | No | upstream | production | Prefer production |
| Global Candidate Budget | YES | Assembly pool | No | upstream | production | Prefer production |
| KenLM | YES | Candidate texts | Checkpoint present | upstream texts | dump has kenlm_top | Prefer production |
| Model3 | YES | Anchors + spans | Checkpoint pinned in provenance | acoustic/retry geometry partial in dump | fresh runner | Prefer production |
| Final | YES | Full chain | No | — | dump final text AVAILABLE | — |

Without acoustic restore: downstream **re-execution** as production-equivalent Real-Audio Replay is blocked at Tone.

---

## 10. Path Cap Observability

| Question | Answer |
|----------|--------|
| LEXICON_MOCK `path_count=1`? | Yes — mock without tone under-generates |
| Real Tone/Base/Model2 restore theoretically multi-path? | **YES** — Frozen live dump already shows up to 8 paths on 9 cases |
| Real-Audio Replay can re-evaluate Track A Path Cap? | **YES after** acoustic evidence restore (capture or live full-audio); **NO** from current freeze inject alone |

Do **not** modify 8/8 cap.

---

## 11. Model3 Observability

Model3 needs Anchor-conditioned inputs: Domain Vote / SameDomain / spans / Model2-related provenance.

| Artifact | State |
|----------|--------|
| Compact model3 decisions in dump | AVAILABLE (historical) |
| Full acoustic + retry geometry for re-infer | PARTIAL / MISSING vs live |
| Re-run Model3 only on frozen text | NOT full Model3 evaluation |

**MODEL3_REPLAY = PARTIAL** (historical compact OK; full acoustic-conditioned re-eval NOT_EVALUABLE without upstream restore)

---

## 12. Model / Checkpoint Identity

| Component | Identity evidence | Class |
|-----------|-------------------|--------|
| ASR | provenance: `faster-whisper-medium`; dump `asr_service_id` | IDENTITY_RECONSTRUCTABLE (path known; bit-hash of weights not in dump rows) |
| Tone | Frozen default `tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz` (`loader_v1.py`); env override possible | IDENTITY_UNKNOWN vs exact Fresh run unless capture records sha |
| Model2 | `MODEL2_STAGE_J_CHECKPOINT` env; Fresh run set `MODEL2_DIALOG200_TRACE=1` | IDENTITY_UNKNOWN without frozen checkpoint sha in dump |
| KenLM | provenance trie path | IDENTITY_RECONSTRUCTABLE |
| Lexicon DB | provenance sqlite path | IDENTITY_RECONSTRUCTABLE (version drift if DB mutated since) |
| Model3 | provenance weights/config sha **exact match** in Fresh provenance | IDENTITY_EXACT for that run |

---

## 13. Determinism

| Factor | Class (replay-relevant) |
|--------|-------------------------|
| Checkpoint selection (env) | CONTROLLED if pinned |
| SQLite candidate order | CONTROLLED / DETERMINISTIC if same DB |
| Candidate tie order | CONTROLLED if production comparator fixed |
| GPU Tone / ASR | NONDETERMINISTIC_BUT_BOUNDED |
| Multiprocessing ASR worker | NONDETERMINISTIC_BUT_BOUNDED |
| Floating KenLM / Model3 scores | NONDETERMINISTIC_BUT_BOUNDED |
| Unpinned lexicon/DB drift | UNCONTROLLED across calendar time |

---

## 14. Existing Harness Reuse

| Candidate | Verdict |
|-----------|---------|
| `run-fresh-dialog200-causal-reconciliation.mjs` | **REUSE_WITH_SMALL_ADAPTER** — add persist of `asrSegments` + `utterance_tone`/`acousticToneSlices` (+ audio sha); currently drops them |
| `run-pilot200-frozen-tone-evidence-full-capture.mjs` | **REUSE_WITH_SMALL_ADAPTER** — pattern for Dialog200 capture contract |
| Pilot200 `/run-lexicon-mock` + `pilot200_replay` inject | **REUSE_WITH_SMALL_ADAPTER** — after Dialog200 freeze of slices/segments |
| `run-dialog200-stagej-full-path-trace.mjs` / acceptance / e2e funnel | **REUSE_DIRECTLY** for live full-audio baselines; **NOT_SUITABLE** as no-ASR Real-Audio Replay |
| LEXICON_MOCK without tone | **NOT_SUITABLE** for acoustic Base/Model2 claims |
| StageJ / tone unit harnesses | **REUSE_DIRECTLY** for subunit contracts only |

**Avoid creating a second production chain.**

---

## 15. Minimum Harness Delta

**Only after** ASR+Tone **capture** (re-run allowed as evidence repair — not this round):

```text
Dialog200 frozen case loader
+ WAV identity (sha256)
+ persist/bind asrSegments + acousticToneSlices
+ existing production inject (Pilot200 pattern) OR /run-pipeline-with-audio for live
+ Evaluation SSOT adapter (NOT_EVALUABLE gates)
```

| Item | Estimate |
|------|----------|
| Files likely touched | Fresh/Pilot capture runners; optional test-server already supports inject |
| New files | Dialog200 frozen evidence jsonl schema + loader |
| Production files touched? | **NONE** expected |
| LOC range | ~150–400 harness-only |
| Risk | Medium (capture completeness); LOW for production behavior |
| Production behavior change | **NONE** |

---

## 16. Lexical Annotation Requirement

| Question | Answer |
|----------|--------|
| ANNOTATION_REQUIRED_FOR_BASELINE | **NO** — FINAL_SENTENCE_CORRECTNESS uses `expectedText` / dump `reference` |
| ANNOTATION_REQUIRED_FOR_FIRST_LOSS | **YES** for LEXICAL_TARGET / Lexicon–Recall first-loss diagnosis; **PARTIAL** if only REFERENCE_DIFF diagnostics (SSOT: not FAIL authority) |

Do not block entire Real-Audio Replay baseline on 200 lexical annotations.

---

## 17. Risks

| Risk | Class |
|------|--------|
| Claiming Base/Model2 first-loss from LEXICON_MOCK | TEST / EVALUATOR DEFECT if FAIL without evidence |
| Re-estimating timestamps for Tone | ARCHITECTURE GAP / CONFLICT vs production-equivalent claim |
| Raw WAV + FW times without processed_audio | DATA mismatch (VAD coordinate) |
| ASR re-capture drift (model/decoder/hotword/VAD) | EXPECTED when repairing missing freeze |
| DB/KenLM/Model2 identity drift since Fresh run | IDENTITY_UNKNOWN / UNCONTROLLED |
| EVALUATION_SSOT_CONFLICT | None newly forced; keep SSOT as-is |

---

## 18. Q1–Q15 Answers

| Q | Answer |
|---|--------|
| Q1 WAV complete? | **YES** — 200/200, 16 kHz mono PCM |
| Q2 Frozen ASR map all cases? | **YES** — text/path/final; **not** timestamps |
| Q3 Tone-required timestamps in Frozen ASR? | **NO** — ABSENT |
| Q4 Timestamp ↔ WAV same coordinate? | **UNKNOWN / N/A** — no frozen timestamps; production uses processed_audio axis |
| Q5 Frozen ASR + WAV → ToneSlice without ASR? | **NO** |
| Q6 Base tone_exact via production? | **NOT until Tone evidence**; then YES call production |
| Q7 Model2 P restore? | **NO** production-equivalent today (profile + Tone-shaped pool missing) |
| Q8 Model2 D restore? | **PARTIAL** (profile-dependent; less Tone-hard) |
| Q9 Multi-path / Path Cap re-eval? | **YES theoretically** after upstream restore; dump already shows multi-path historically |
| Q10 Downstream capabilities? | See matrix §9 — blocked at Tone for re-exec; compact historical AVAILABLE |
| Q11 Must re-run ASR? | **YES** (to capture timestamps/slices) for Real-Audio acoustic baseline |
| Q12 Must finish 200 lexical annotations first? | **NO** for final baseline; **YES** for lexical first-loss |
| Q13 Min harness delta? | Capture persist + Pilot200-style inject adapter; production untouched |
| Q14 Must modify production to replay? | **NO** → do not STOP for architecture rewrite |
| Q15 Recommendation | **C. ASR_RERUN_REQUIRED** (capture), then **A. BUILD_MINIMAL_REAL_AUDIO_REPLAY** |

---

## 19. Final Result

```text
RESULT E — ASR RERUN REQUIRED
```

**Companion reading:** After a Pilot200-equivalent Dialog200 freeze of `asrSegments` + `acousticToneSlices`, the same audit would likely move toward **RESULT A** (minimal inject harness) without changing production stage responsibility.

**Primary feasibility answer:** **NO** (cannot avoid ASR while restoring production-equivalent acoustic evidence from current repository artifacts).

**Secondary:** **PARTIAL** historical text/path/Model3/KenLM/final evidence exists and remains usable under EVALUATION_SSOT_V1 as evidence — not as Tone/Base proxy FAIL.
