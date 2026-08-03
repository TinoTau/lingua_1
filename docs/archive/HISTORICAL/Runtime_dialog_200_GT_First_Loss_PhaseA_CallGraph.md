<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Runtime_dialog_200_GT_First_Loss_PhaseA_CallGraph.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Phase A — Production Call Graph & Candidate Drop-Point Inventory

| Field | Value |
|------|-------|
| Status | **READ-ONLY COMPLETE** |
| Date | 2026-07-21 |
| Authority | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |
| Next | Phase B diagnostics-only probes |

---

## 1. Production Call Graph（真实主链）

```text
WAV
→ test-server /run-pipeline-with-audio
→ InferenceService.runPipelineWithAudio
→ ASR (faster-whisper-vad :6007)
→ ctx.rawAsrText + word timestamps
→ pipeline STEP_REGISTRY.FW_SPAN_DETECTOR
→ fw-detector-orchestrator
→ fw-detector-v4-path
→ span-assembly-v4-orchestrator
    → coarse boundary import / IME
    → generate-global-windows (fine windows)
    → recall-topk-for-windows → lexicon-v2 recallSpanTopKV3
    → candidate-compatibility-graph (coverage / conflict / isCovered)
    → assemble-domain-aware-span-sets
        → buildFineSpanCandidatePool
        → voteUtteranceDomainFromPool (FineSpanDomainSet / Presence Vote / 0.75)
        → filterDomainCandidatesPerSpan (per retained domain + Base)
        → per-span select / budget
    → buildSentenceCandidates (per bucket)
    → mergeCrossBucketSentenceCandidates (dedup → global cap 16)
→ runFwSentenceRerankFromPrefilled (prefilledCombinations required)
→ rerankFwSentences (KenLM + minDeltaToReplace)
→ apply replacements → text_asr
→ AGGREGATION → JobResult
```

**Frozen replay 入口（无 ASR）：** `POST /run-lexicon-mock` → `runPipelineWithMockAsr(asrText)`  
注意：mock 路径无真实 acoustic Tone slices；Tone 相关 first-loss 必须以 WAV E2E 证据为准。

---

## 2. Stage Inventory

| Stage | Entry | Core functions | Key I/O | Existing diagnostics |
|-------|-------|----------------|---------|----------------------|
| ASR | faster_whisper_vad | utterance ASR | wav → text + words | extra.raw_asr_text, asr_* |
| FW entry | fw-detector-orchestrator / v4-path | runFwDetectorV4Path | JobContext → FwDetectorResult | fw_detector.* |
| Coarse spans | coarse-boundary-import | partition / IME | raw → CoarseSpan[] | boundaryImport |
| Fine windows | generate-global-windows | generateGlobalWindows | CoarseSpan → GlobalWindowDescriptor | globalWindowCount, truncated |
| Tone | tone-time-align / tone-recall | resolveTimestampToneState | WordTimeSpan → AcousticToneSlice | spanAssemblyV4.tone |
| Recall | recall-topk-for-windows + recall-span-topkv3 | recallSpanTopKV3 | windows → WindowCandidate[] | recallHits (trace), domainRecallHitCount |
| Compatibility | candidate-compatibility-graph | resolveCompatibilityRelations | pool → active + isCovered | candidateLifecycle, coverage |
| Vote | utterance-domain-vote | voteUtteranceDomainFromPool, buildFineSpanDomainSet | pool → domainScores, retainedDomains | metrics.domainScores, retainedDomains |
| Bucket | assemble-domain-aware-span-sets | filterDomainCandidatesPerSpan | retained domain → DomainFilteredSpanSet | sameDomain/base counts |
| Assembly | build-sentence-candidates | buildSentenceCandidates | spanSets → SentenceCombination[] | intervalAssemblyCandidateCount |
| Merge/Cap | build-sentence-candidates | mergeCrossBucketSentenceCandidates | lists → mergedBeforeCap → combinations≤16 | **mergedBeforeCap internal only today** |
| KenLM | run-fw-sentence-rerank-from-prefilled | rerankFwSentences | prefilled → pick | sentenceRerank.* |
| Delta gate | rerank-fw-sentences | minDeltaToReplace | scores → apply/raw | pickedIsRaw, maxDelta |

---

## 3. Candidate Drop-Point Inventory

| ID | Location | Mechanism | Affects GT full sentence? |
|----|----------|-----------|---------------------------|
| D1 | generate-global-windows | blocked / truncated windows | span miss |
| D2 | recall-span-topkv3 / V2 | SQL miss, TopK slice, minCandidateScore, tone score | local term miss |
| D3 | recall-topk-for-windows | per-window rank / pool build | local term miss |
| D4 | candidate-compatibility-graph | isCovered=true (coverage) | vote + bucket exclude |
| D5 | buildFineSpanCandidatePool | owning coarse span miss (spanIdx&lt;0) | attach wrong/missing span |
| D6 | buildFineSpanDomainSet | covered / non-domain source skip | vote eligibility |
| D7 | selectRetainedDomains | 0.75 threshold | domain not retained |
| D8 | filterDomainCandidatesPerSpan | domains.includes(bucket) fail; covered skip | bucket membership |
| D9 | dedupePicks / stableSortPicks | Map overwrite by candidateId | local drop |
| D10 | per-span candidate limit | getPerSpanCandidateLimit truncate | local drop |
| D11 | buildSentenceCandidates | overlap reject; enum cap; text dedup; **slice(maxSentenceCandidates)** | per-bucket assembly |
| D12 | mergeCrossBucketSentenceCandidates | text dedup keep higher score; **slice(16)** | **STRICT CAP only if GT in mergedBeforeCap** |
| D13 | rerankFwSentences | KenLM rank | KENLM_MISRANK |
| D14 | minDeltaToReplace | delta gate / fail-open raw | DELTA_GATE_REJECT |

---

## 4. Attribution Gaps（上一轮禁止再当作事实）

| Heuristic | Why invalid as fact |
|-----------|---------------------|
| DOMAIN_VOTE_DROP=132 | 仅用 domainRecallHitCount>0 ∧ GT∉pool；未证明 GT 局部候选已召回且 vote-eligible 且 domains 全未 retained |
| CANDIDATE_CAP_DROP heuristic=138 | 未证明完整 GT 在 mergedBeforeCap 存在 |

**Strict DOMAIN_VOTE_DROP** 与 **Strict CANDIDATE_CAP_DROP** 定义见主任务书 §Probe 6 / §Probe 9。

---

## 5. Existing Diagnostics Reuse Plan

复用（禁止新建平行配置体系）：

```text
spanAssemblyV4DiagnosticsEnabled
spanAssemblyV4DiagnosticsLevel = trace
spanAssemblyV4DiagnosticsTargetIds
V4TraceCollector + CandidateLifecycleTracker (candidateId)
```

**缺口（Phase B 仅 diagnostics 补齐）：**

1. `mergedBeforeCap` / `perBucketGenerated` 未进入 `FwDetectorResult` → 无法严格证 CAP  
2. Vote eligibility 逐候选证据不足 → 无法严格证 DOMAIN_VOTE_DROP  
3. Recall pre-rank / post-TopK 对 GT term 的布尔快照不足  
4. Lexicon 是否存在必须 **直查 SQLite**，不能用 Recall 反推  

---

## 6. Phase B Minimal Probe Surface

```text
When diagnosticsEnabled:
  spanAssemblyV4.candidateCapProbe = {
    perBucketTextsBeforeLocalCap? (optional),
    perBucketTextsAfterLocalCap,
    mergedBeforeDedup? ,
    mergedAfterDedupBeforeCap: mergedBeforeCap.map(text),
    finalAfterCap16: combinations.map(text),
    dedupReplacedCount
  }
  spanAssemblyV4.voteProbe = {
    domainScores, retainedDomains, maxCount, retentionRatio: 0.75,
    // per-span FineSpanDomainSet sizes if cheap
  }
```

Offline-only（不改生产返回语义）：

```text
Lexicon SQLite probe
Recoverability / pinyin distance
Counterfactual CF-1..CF-8 on copies
First-loss adjudication
```

---

## 7. Frozen ASR Strategy

| Round | Method |
|-------|--------|
| Capture | Real WAV → `/run-pipeline-with-audio` → store raw_asr_text + segments + config |
| Replay | `/run-lexicon-mock` with frozen `asrText`（不调 ASR） |
| Caveat | Mock 无 acoustic Tone；Tone first-loss 以 capture 次 WAV E2E 的 tone 字段为准 |

---

## 8. Phase A Verdict

```text
PHASE A READ-ONLY AUDIT: PASS
DROP POINTS MAPPED: YES
STRICT ATTR DEFINITIONS ADOPTED: YES
HEURISTIC ATTR FROM PRIOR ROUND: SUPERSEDED
```
