# LINGUA_MODEL2_PRE_EDGE_SSOT_RESTORE_PREDEVELOPMENT_AUDIT

| Field | Value |
|-------|-------|
| Date | 2026-09-12 |
| Nature | **READ-ONLY PRE-DEVELOPMENT ARCHITECTURE AUDIT** |
| Mode | NO CODE / CONFIG / MODEL / DATASET / LEXICON / THRESHOLD / RETRAIN / COMPATIBILITY PATCH |
| Authoritative SSOT | **AUG12_PRE_LEXICAL_EDGE** (user-frozen) |

---

## 0. Executive answer

```text
AUTHORITATIVE_MODEL2_SSOT = AUG12_PRE_LEXICAL_EDGE
MODEL2_INSERTION_POINT = PRE_LEXICAL_EDGE / PRE_SEGMENTATION
Aug-17 post-PathFineSpan expand = IMPLEMENTATION_INSERTION_DRIFT

TARGET_SINGLE_MAINLINE_FEASIBLE = YES
IMPLEMENTATION_DRIFT_REPAIR_READY = YES
ONE_NEXT_DELTA = MODEL2_PRE_EDGE_INSERTION_SSOT_RESTORE
ONE_BLOCKER = (none)
```

本轮结论可直接进入唯一开发 delta：把 Model2 语义核挂回 **Base Recall 之后、`buildLexicalEdges` 之前**，删除 post-PathFineSpan 生产钩子，不打兼容补丁。

---

## 1. Frozen constraints (not re-litigated)

| Freeze | Status |
|--------|--------|
| Model2 insertion = pre-LexicalEdge | **FROZEN** |
| LexicalEdge requires candidate evidence | **FROZEN** (Base miss + Model2 miss → fallback → Model3) |
| Model3 residual KEEP/RETRY / retry subchain | **FROZEN** — no Model3 code change |
| Domain Vote stays post-path | **FROZEN** |
| FineSpan-local / window-local Tone (no path-shared Tone) | **FROZEN** |
| PAction = pronunciation relation action | **FROZEN** |
| Single Model2 production invocation stage | **REQUIRED** |
| No compatibility dual-path / feature-flag legacy | **REQUIRED** |

---

## 2. Current production call chain (as-is)

| Step | Function | File | Input | Output | Owner |
|------|----------|------|-------|--------|-------|
| ASR → FW | `runSpanAssemblyV4Orchestrator` | `span-assembly-v4-orchestrator.ts` | segments, slices, lexicon… | assembly | FW V4 |
| Coordinate | `buildUtteranceSyllableCoordinate` | `pinyin-ime-v2-pinyin-stream.ts` | rawText | syllables + ranges | lattice |
| Windows | `buildLexicalWindowQueries` | `build-lexical-window-queries.ts` | coord + coarse | `GlobalWindowDescriptor[]` | lattice |
| Hard-block | `latticeHardBlockFilter` | lattice hard-block module | windows | filtered windows | lattice |
| Base recall | `recallTopKForWindows` | `recall-topk-for-windows.ts` | windows + tone slices | `WindowCandidate[]` | Lexicon |
| Edges | `buildLexicalEdges` | `build-lexical-edges.ts` | `RecalledWindowBundle[]` | `LexicalEdge[]` | lattice |
| Fallback | `injectFallbackEdges` | `inject-fallback-edges.ts` | edges | edges+fallback | lattice |
| Paths | `enumerateCompleteSegmentationPaths` | enum module | edges | paths | lattice |
| PathFineSpan | `materializePathFineSpans` | `materialize-path-fine-spans.ts` | path edges | `PathFineSpan[]` | lattice |
| Tone rebind | `rebindToneForFineSpan` | `tone-fine-span-rebind.ts` | PathFineSpan | `toneRebindTrace` | path-local |
| Compat | `resolveCompatibilityRelations` | `candidate-compatibility-graph.ts` | path candidates | activeCandidates | path-local |
| **Model2 (drift)** | **`expandActiveCandidatesWithModel2`** | **`expand-active-candidates.ts`** | **PathFineSpan[] + activeCandidates** | **merged WindowCandidate[]** | **Model2 Stage J** |
| Vote | `voteUtteranceDomainFromPool` | via `run-model3-path-step.ts` | pool | vote | Domain |
| Anchor | `materializeModel3Anchors` | `model3-anchor-adapter.ts` | spans + cands | anchors | Model3 adapter |
| Model3 | KEEP/RETRY + `routeModel3Retry` | model3-runtime | non-anchor | reseg/recall | Model3 |
| Assembly | `completeDomainAwareAssemblyFromVote` | domain assembly | vote+pool | sentences | Assembly |
| KenLM | cross-path merge | orchestrator | candidates | ≤16 | KenLM |

```text
CURRENT_MODEL2_CALL_SITE =
  span-assembly-v4-orchestrator.ts
  → expandActiveCandidatesWithModel2
  (after PathFineSpan + compatibility; before Domain Vote)

CURRENT_MODEL2_INPUT_TYPE =
  PathFineSpan[] + WindowCandidate[] (activeCandidates) + UserProfile + LexiconRuntime

CURRENT_MODEL2_OUTPUT_TYPE =
  WindowCandidate[] (PROFILE_* merged) + Model2ExpandDiagnostics
```

---

## 3. Target single mainline (SSOT)

```text
ASR
 → Window enumeration (GlobalWindowDescriptor, len 1..5)
 → Window-local acousticTonePattern (extractAcousticTonePatternForRecall)
 → Base / Exact Recall  +  Model2 P(+D) expansion   ← ONE Model2 stage
 → Unified WindowCandidate[] per window
 → buildLexicalEdges (candidate-backed only)
 → injectFallbackEdges (still unexplained)
 → Segmentation → PathFineSpan
 → Compatibility (no Model2)
 → Domain Vote → Anchor → Model3 → Retry → Assembly → KenLM
```

```text
TARGET_SINGLE_MAINLINE_FEASIBLE = YES
```

实现依赖现有组件；需要 **REFACTOR** 去掉 PathFineSpan 编排耦合，**禁止** 伪造 PathFineSpan 再调用旧 hook。

---

## 4. AUTHORITATIVE_PRE_EDGE_WINDOW_TYPE

```text
AUTHORITATIVE_PRE_EDGE_WINDOW_TYPE = GlobalWindowDescriptor
  (alias LexicalWindowQuery)
```

| Capability | Present? |
|------------|----------|
| rawStart / rawEnd | YES |
| syllableStart / syllableEnd | YES |
| surface (`windowText`) | YES |
| pinyin (`windowPinyinKey`) | YES |
| tone pattern field on type | **NO** (computed on demand) |
| domain hints | via recall domainIds / candidate domains |
| candidate list | not on descriptor; parallel `WindowCandidate[]` by `windowId` |
| window length | syllableEnd − syllableStart |
| stable identity | `windowId` = `${syllableStart}:${syllableEnd}` |

**不要新建第二套 FineSpan 类型。** Model2 入参应是：

```text
WindowEvidence = GlobalWindowDescriptor geometry
              + spanSyllables (from globalSyllables slice)
              + acousticTonePattern (extractAcousticTonePatternForRecall)
              + baseCandidates (WindowCandidate[] for this windowId)
              + UserProfile / lexicon runtime context
```

```text
PRE_EDGE_WINDOW_ROLE =
  overlapping lexical recall unit; candidate formation (Base + Model2)

PATH_FINESPAN_ROLE =
  post-segmentation path edge materialization; Domain Vote / Model3 / assembly unit
  (NOT Model2 pronunciation expansion owner)
```

职责混用现状：`expandActiveCandidatesWithModel2` + `buildModel2PolicyInput(PathFineSpan)` 把 pronunciation expansion 绑在 PathFineSpan → **MOVE / REFACTOR**。

---

## 5. Tone binding (pre-edge)

Base recall 已在 pre-edge 调用同一提取函数：

```text
extractAcousticTonePatternForRecall(rawStart, rawEnd, syllableStart, syllableEnd, slices, wordTimes)
  ← used by recallTopKForWindows
  ← also used by rebindToneForFineSpan (post-path diagnostics)
```

```text
PRE_EDGE_TONE_BINDING_READY = YES
```

可复用链：

```text
GlobalWindowDescriptor.{raw*, syllable*}
 + acousticSlices + wordTimeSpans
 → extractAcousticTonePatternForRecall
 → acousticTonePattern[]
 → executeProfileLexiconQueries({ acousticTonePattern })
```

```text
TONE_SEMANTIC_CHANGE_REQUIRED = NO
```

语义保持：

```text
window own geometry → own acoustic evidence → own Tone pattern → own pronunciation recall
```

禁止 shared / first-non-empty / path-level Tone。

`rebindToneForFineSpan` **保留**为 PathFineSpan 候选 tone 诊断；Model2 **不再**依赖 `toneRebindTrace`。

---

## 6. Model2 input field audit

| Field | Required by Model2 semantics | Available pre-edge | Post-seg accidental coupling | Action |
| ----- | ---------------------------- | ------------------ | ---------------------------- | ------ |
| spanSyllables | YES | YES (globalSyllables slice) | PathFineSpan helper | KEEP via WindowEvidence |
| rawStart/rawEnd | YES (geometry + text slice) | YES on GlobalWindowDescriptor | — | KEEP |
| syllableStart/End | YES | YES | — | KEEP |
| windowText / windowPinyinKey | YES | YES | — | KEEP |
| acousticTonePattern | YES (Tone-first P recall) | YES via extract* | currently via toneRebindTrace | **MOVE** source to pre-edge extract |
| UserProfile phonetic_bias | YES | YES (JobContext) | — | KEEP |
| personal_terms / domain evidence | YES (policy features) | YES | — | KEEP |
| LexiconRuntime + profile + domainIds | YES (P recall) | YES (already in lattice input) | — | KEEP / plumb into lattice |
| basePool / baseCandidates | YES (features + merge) | YES (per-window recall) | activeCandidates path pool | KEEP per-window |
| PathFineSpan object | NO | N/A | YES — adapter typed on it | **DELETE coupling** |
| activeCandidates (path-wide) | NO | N/A | YES — post-compat pool | **DELETE as Model2 input** |
| originSpanId = PathFineSpan.spanId | accidental | use windowId | YES | **REFACTOR** → windowId / spanId alias |
| compatibility graph | NO | N/A | YES | KEEP post-seg only |

**禁止** 伪造 PathFineSpan 调用旧 expand。

---

## 7. Semantic core mix in `expandActiveCandidatesWithModel2`

当前混合：

| Concern | Present? | Target |
|---------|----------|--------|
| A. Model2 inference | YES | KEEP in core |
| B. PAction interpretation | YES (host selected_actions) | KEEP |
| C. Relation transform | YES → `executeProfileLexiconQueries` | KEEP |
| D. Lexicon recall | YES | KEEP |
| E. Candidate materialization | YES PROFILE_* | KEEP |
| F. PathFineSpan-specific orchestration | YES | **REFACTOR out** |
| G. Post-segmentation assembly concerns | mild (activeCandidates merge) | **REFACTOR** → per-window merge pre-edge |

目标形态（名称示意）：

```text
expandWindowsWithModel2Pronunciation(
  windows: GlobalWindowDescriptor[],
  baseByWindow: Map<windowId, WindowCandidate[]>,
  evidence: { rawText, globalSyllables, acousticSlices, wordTimeSpans, userProfile, runtime, ... }
) → { candidatesByWindow, diagnostics }
```

```text
MODEL2_SEMANTIC_CORE_REUSABLE = PARTIAL
  (P/D/relation/recall/materialize/host KEEP; PathFineSpan orchestration REFACTOR)
```

---

## 8. PAction / Relation / Pronunciation recall

```text
PACTION_REUSABLE_PRE_EDGE = YES
  (action ids operate on syllable sequences; length = window length)

RELATION_ADAPTER = KEEP
  (relation-direction.ts / hypothesizeIntendedSyllables — syllables only)

RELATION_ADAPTER_REUSABLE = YES

PRONUNCIATION_RECALL_CORE = KEEP
  (executeProfileLexiconQueries + recallSpanTopKV2)

PRONUNCIATION_RECALL_CORE_REUSABLE = YES
  query geometry MUST remain full window length (e.g. 李守步 → 3-syl transformed query)
```

---

## 9. Candidate merge & LexicalEdge

```text
MODEL2_PRE_EDGE_CANDIDATE_TARGET_TYPE = WindowCandidate
```

Model2 hit 经现有 `materializeProfileHits` / `materializeDomainHits` **已是** `WindowCandidate`；可自然并入 Base 池。

```text
CANDIDATE_MERGE_OWNER_FUNCTION =
  mergeProfileIntoActiveCandidates
  (rename optional → mergeProfileIntoWindowCandidates; same algorithm)
```

自然接入点（`lattice-fine-span-runtime.ts`）：

```text
recallTopKForWindows
→ groupCandidatesByWindow
→ ★ Model2 expand + mergeProfileInto* per window / batch
→ build edgeBundles WHERE candidates.length > 0
→ buildLexicalEdges
```

关键 SSOT 效果：

```text
Base miss + Model2 hit → candidates.length > 0 → LexicalEdge (multi-char possible)
Base miss + Model2 miss → no edge → fallback residual → Model3
```

```text
LEXICAL_EDGE_BUILDER_CHANGE = NONE
```

`buildLexicalEdges` 不识别 Base vs Model2；只消费 candidate-backed bundles。`retrievalProvenance` 已在 `WindowCandidate` 上，identity first-wins 不剥离未知字段。

```text
ARCHITECTURE_SMELL = NO
  (as long as no Model2-specific branch inside buildLexicalEdges)
```

---

## 10. Provenance & Anchor survival

```text
MODEL2_PROVENANCE_PRESERVED_PRE_EDGE = YES
  (PROFILE_PRONUNCIATION / PROFILE_DOMAIN written at materialize; PROFILE_RETRIEVAL still accepted by Anchor, rarely written)
```

恢复后路径：

```text
WindowCandidate.retrievalProvenance
→ LexicalEdge.candidates (same object refs)
→ PathFineSpan.candidates (same refs)
→ resolveCompatibilityRelations shallow clone ({...c})  // copies provenance fields
→ activeCandidates → materializeModel3Anchors.hasModel2Evidence
```

```text
MODEL2_EVIDENCE_SURVIVES_SEGMENTATION = YES
  (after restore; currently NO because provenance is applied post-seg only)
```

不要 side-channel。`tagBaseProvenance` 移到 pre-edge merge 前即可。

`originSpanId` / `anchorCoarseSpanId`：今日常写 PathFineSpan.spanId；pre-edge 应写 **`windowId`**（或等价稳定 id）。Anchor 绑定用 syllable/raw 几何 + provenance，不依赖 PathFineSpan 专有 id。**TYPE_ONLY / small REFACTOR** in materialize。

---

## 11. Post-PathFineSpan hook

生产调用者：

| Caller | Role |
|--------|------|
| `span-assembly-v4-orchestrator.ts` | **only production** |
| offline harness CJS | training — update or stop using old API |
| e2e tests | update to SSOT |

```text
POST_PATHFINESPAN_MODEL2_HOOK = DELETE
```

迁移后无独立冻结职责保留 post-seg Model2。禁止 fallback / flag / dual call。

```text
MODEL2_P_EXPANSION_INVOCATION_COUNT = ONE LOGICAL STAGE
DUPLICATE_MODEL2_EXPANSION_RISK =
  (1) forgetting to delete orchestrator call
  (2) adding Model2 on Model3 Retry
  (3) offline harness accidentally reintroduced in prod path
→ mitigation: delete orchestrator site; Retry stays Stage-2 recall only; freeze test asserts single call site
```

---

## 12. D Action

```text
D_ACTION_OWNER_STAGE = PRE_EDGE_SAME_MODEL2_INVOCATION
D_ACTION_MIGRATION_REQUIRED = YES
D_ACTION_DECISION_REQUIRED = NO
```

理由：P 与 D 同一次 host `infer`；若只迁 P 而把 D 留在 post-seg → **第二次 Model2 inference** → 违反 SINGLE MAINLINE。D 作为 candidate formation 的一部分随 P 前移，仍在 Domain Vote **之前**，与 Aug-12 “Candidate Merge → Domain Vote” 一致。

不单独改 D 算法 / FuzzyPool / 长度绑定合同（仍：hit 音节长 = origin window 长）。

---

## 13. Domain Vote / Model3 / Retry / JobResult

```text
DOMAIN_VOTE_STAGE_CHANGE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
```

自然 fall-through：

```text
Base + Model2 both miss → no LexicalEdge → fallback → non-anchor → Model3
```

```text
MODEL2_ON_MODEL3_RETRY = NO
```

当前冻结：Retry = local reseg + Stage-2 `recallSpanTopKV2`，**不** reinvoke Model2。本轮不增加第二次 Model2。

---

## 14. Budget

| Control | Reuse? |
|---------|--------|
| Model2 `queryBudget` / `candBudget` (≤8 / ≤16) | YES per window |
| `getPerSpanCandidateLimit` / edge identity merge | YES downstream |
| sentence / KenLM ≤16 | YES unchanged |
| Window count 1..5 overlapping | **increases Model2 invocations vs post-seg path count** |

```text
CANDIDATE_BUDGET_REUSABLE = PARTIAL
```

不调参、不做 worker/cache 优化。结构上 invocation 变多是 SSOT 正确代价；现有 per-window budget 仍约束爆炸。

可精简：删除“仅服务于 post-seg activeCandidates 合并”的重复注释/二次 merge 层（迁移后只保留 pre-edge 一次 merge）。

---

## 15. KEEP / MOVE / DELETE / REFACTOR

### KEEP

| Component | File | Reason | SSOT responsibility |
|-----------|------|--------|---------------------|
| Inference host + Stage J checkpoint | `inference-host.ts`, `model2_inference_host.py` | Verified sidecar | Model2 forward |
| UserProfile plumbing | orchestrator / JobContext | Already available | user-conditioned input |
| PAction selection (host) | Python host | Frozen semantic | pronunciation actions |
| `phonetic_bias` consumption | `finespan-adapter` / host | Stage P signal | profile condition |
| Relation transform | `relation-direction.ts` | Geometry-preserving PASS | P query hypothesis |
| Pronunciation recall | `relation-lexicon-adapter.ts` + `recallSpanTopKV2` | Tone-first verified | Lexicon P retrieval |
| Materialize PROFILE_* | `candidate-materialize.ts` | Unified WindowCandidate | provenance |
| Merge by termId | `merge-profile-candidates.ts` | ONE merge algorithm | Base+Model2 unify |
| Types `RetrievalProvenance` | `types.ts` | Anchor/trace | evidence |
| Failure soft-continue | expand catch / load_failed | Pipeline safety | optional Model2 |
| Observability fields | Stage J observability | Debugging | non-gating |
| `GlobalWindowDescriptor` | `v4-types.ts` | Pre-edge window SSOT | window unit |
| `buildLexicalEdges` | `build-lexical-edges.ts` | Provenance-agnostic | LexicalEdge gate |
| `injectFallbackEdges` | unchanged | Residual coverage | Model3 feed |
| `rebindToneForFineSpan` | path-local diagnostics | Not Model2 owner anymore | path tone fields |
| Domain Vote / Model3 / Retry | model3-runtime | Frozen residual | residual ownership |
| `extractAcousticTonePatternForRecall` | `tone-recall.ts` | Window-local Tone SSOT | Tone for P recall |
| FineSpan-local Tone freeze intent | tests/docs | No shared Tone | Tone contract |

### MOVE

| Component | Current stage | Target stage | Reason |
|-----------|---------------|--------------|--------|
| Model2 production invocation | post-PathFineSpan / post-compat | post-`recallTopKForWindows` / pre-`buildLexicalEdges` | Aug-12 SSOT |
| Tone pattern source for Model2 | `toneRebindTrace` on PathFineSpan | pre-edge `extractAcousticTonePatternForRecall(window)` | same semantics, earlier stage |
| `tagBaseProvenance` | expand entry post-seg | pre-edge before merge | BASE_FUZZY timing |
| P+D materialize+merge | path activeCandidates | per-window candidate map | candidate formation |
| Lattice needs profile/runtime for Model2 | only in orchestrator today | plumb into lattice generation input (already has runtime/profile for Base) | enable pre-edge call |
| Diagnostics aggregation | path-level model2_summary | utterance/window-level + optional path rollup | insertion moved |

### DELETE

| Component | Reason | Callers | Impact |
|-----------|--------|---------|--------|
| Orchestrator `expandActiveCandidatesWithModel2(...)` call block | Conflicting insertion | `span-assembly-v4-orchestrator.ts` | Removes dual/wrong stage |
| PathFineSpan-typed production API as **the** Model2 entry (old signature used in prod) | Forces fake PathFineSpan smell | orchestrator + harness | Replace with WindowEvidence API |
| Any plan for `legacyModel2Path` / flags / post-seg fallback | Forbidden compatibility | none yet — do not add | N/A |
| Tests asserting post-seg insertion as correct SSOT | Obsolete | freeze/e2e that lock old site | Rewrite to pre-edge |
| Docs treating Aug-17 insertion as **current** authority without SUPERSEDED | Ambiguity | see §17 | Relabel |

不 DELETE：host、权重、relation 算法、Tone extract、Model3。

### REFACTOR

| Component | Current coupling | Target responsibility | Why not patch |
|-----------|------------------|----------------------|---------------|
| `buildModel2PolicyInput` | Requires `PathFineSpan` | Accept WindowEvidence / geometry DTO | Avoid fake PathFineSpan |
| `expandActiveCandidatesWithModel2` | PathFineSpan[] loop + activeCandidates | `expandWindowsWithModel2*` on windows | Single semantic core, one stage |
| `runLatticeFineSpanGeneration` | Sync; no Model2 | Async (or split recall→expand→edges) to await Model2 | Structural insertion point |
| `materializeProfileHits` ids | `spanId` from PathFineSpan | `windowId` as stable origin | Provenance without path ids |
| `mergeProfileIntoActiveCandidates` name/docs | “before DomainAwareAssembly” | “before LexicalEdge / ONE merge” | Match SSOT language |
| `finespan-local-tone-binding.freeze.test.ts` | Asserts expand reads `toneRebindTrace` | Assert Model2 uses window-local extract; still bans path-shared Tone | Keep Tone contract, update site |
| Offline harness CJS path-level tone | Diverged from prod | Align to WindowEvidence or exclude from prod claims | Prevent false prod semantics |

```text
PATCH_FREE_REFACTOR_PLAN = PASS
NO_DUAL_MODEL2_PATH_PLAN = PASS
```

---

## 16. Config cleanup

```text
OBSOLETE_CONFIG_AFTER_RESTORE = []
```

`MODEL2_RUNTIME_DISABLED` / `MODEL2_STAGE_J_CHECKPOINT` / `MODEL2_PYTHON` / dialog200 trace：**KEEP**（仍服务唯一 Model2 stage）。

无发现必须 DELETE 的“仅 post-seg”业务 flag。删除的是 **调用点**，不是 env 总开关。

若开发中引入任何 `enablePreEdgeModel2` 双路径开关 → **禁止**（违反 NO PATCHING）。

---

## 17. Tests & docs

### Tests

| Class | Action |
|-------|--------|
| Relation / materialize / merge / host semantic | **KEEP** |
| Unicode sanitize | **KEEP** |
| Tone binding freeze (no path-shared Tone) | **UPDATE** site assertions |
| Model2 e2e tied to orchestrator post-seg | **UPDATE** to pre-edge lattice |
| “post-seg path still works” compatibility | **DELETE** (do not write) |
| Pilot runners | **KEEP** runners; re-eval after restore (not this delta’s code) |
| D origin-span length binding | **KEEP** (reinterpret origin = window) |

### Documentation

| Doc | Class |
|-----|-------|
| `Lingua_Model2_Final_Architecture_Input_Contract_PreTraining_Audit_2026_08_12.md` | **CURRENT_SSOT** (insertion) |
| `Lingua_Model2_Runtime_Integration_MVP_*_2026_08_17.md` | **HISTORICAL_RESULT** / **SUPERSEDED_INSERTION_POINT** |
| Stage-J P/D owner audits describing post-activeCandidates | **SUPERSEDED** insertion; KEEP P/D semantic facts |
| Prior insertion/ownership audits (UNPROVEN era) | **HISTORICAL_RESULT** — superseded by user freeze |
| `LINGUA_DIALOG2000_V2_PILOT200_SSOT.md` | **CURRENT_SSOT** for Pilot scope; Model3 redesign still deferred |

```text
DOCUMENTATION_CLEANUP_REQUIRED = [
  "Mark Aug-17 MVP insertion as SUPERSEDED_INSERTION_POINT",
  "Add CURRENT_SSOT pointer to Aug-12 pre-LexicalEdge in Model2 runtime index/SSOT",
  "Update orchestrator file header comment (Model2 after FineSpan → after Base recall)",
  "Relabel Stage-J 'after activeCandidates' as historical drift in P/D owner doc"
]
```

---

## 18. Target List (development — not this round)

```text
T1  REFACTOR Model2 policy input off PathFineSpan → WindowEvidence / GlobalWindowDescriptor geometry
T2  REFACTOR expand semantic core to window-batch API (P+D+materialize+merge); KEEP host/relation/recall
T3  Wire core into lattice AFTER recallTopKForWindows / BEFORE buildLexicalEdges
    (async lattice OR orchestrator-split stages — pick one structure, not both)
T4  Ensure WindowCandidate PROFILE_* + windowId origin survive edge → PathFineSpan → compat clone → Anchor
T5  DELETE orchestrator post-PathFineSpan expandActiveCandidatesWithModel2 production call
T6  UPDATE Tone freeze + Model2 e2e to unique pre-edge SSOT; DELETE post-seg-as-correct tests
T7  DOCUMENTATION: Aug-17 SUPERSEDED_INSERTION_POINT; Aug-12 CURRENT_SSOT
```

**Out of scope for this delta:** weights, relation set, Tone thresholds, window 1..5 geometry, Lexicon content, Domain Vote, Model3, KenLM, Pilot200 dataset, tone_bias, performance redesign.

---

## 19. Dependency order

```text
1. T1 WindowEvidence + policy adapter refactor
2. T2 Semantic core window API (unit-testable without PathFineSpan)
3. T3 Lattice/orchestrator wire pre-edge (single call site)
4. T4 Provenance survival verification (Anchor still sees PROFILE_*)
5. T5 Delete post-PathFineSpan production hook (same PR as T3 preferred — no dual window)
6. T6 Tests
7. T7 Docs SSOT labels
```

Business variable: **only** `MODEL2_INSERTION_POINT_RESTORE`.

---

## 20. Acceptance contract (future delta)

```text
ONE_MODEL2_PRODUCTION_INSERTION = PASS
MODEL2_PRE_EDGE_WINDOW_INPUT = PASS
BASE_AND_MODEL2_CANDIDATE_MERGE = PASS
MODEL2_MULTI_CHAR_GEOMETRY_PRESERVED = PASS
FINESPAN_LOCAL_TONE_SEMANTICS = PASS   # window-local; no shared Tone
PACTION_CONTRACT_UNCHANGED = PASS
RELATION_TRANSFORM_UNCHANGED = PASS
LEXICON_RECALL_CORE_UNCHANGED = PASS
MODEL2_PROVENANCE_SURVIVES_SEGMENTATION = PASS
LEXICALEDGE_REQUIRES_CANDIDATE_EVIDENCE = PASS
BASE_PLUS_MODEL2_MISS_FALLS_TO_RESIDUAL = PASS
MODEL3_CONTRACT_UNCHANGED = PASS
DOMAIN_VOTE_CONTRACT_UNCHANGED = PASS
NO_POST_PATHFINESPAN_MODEL2_MAIN_HOOK = PASS
NO_DUAL_MODEL2_PATH = PASS
NO_COMPATIBILITY_FALLBACK = PASS
NO_OBSOLETE_MODEL2_CONFIG = PASS
JOBRESULT_BOUNDARY_UNCHANGED = PASS
```

### Pilot acceptance preview (theory — do not run full Pilot this round)

Restore 后关键证明 trace：

```text
multi-char pre-edge window (e.g. 李守步)
→ Model2 PAction (n_l / in_ing …)
→ full-length relation transform
→ full-length Tone-first pronunciation query
→ Lexicon candidate (礼宾部)
→ merged WindowCandidate PROFILE_PRONUNCIATION
→ LexicalEdge
→ PathFineSpan (len=3)
→ Domain Vote / possible MODEL2 Anchor
```

Examples theoretically re-testable: 李守步→礼宾部, 来精→奶精, 营运真→营运证, 升层→生成, …

---

## 21. Architecture smell check

| Smell | Risk if done wrong | Mitigation in this plan |
|-------|--------------------|-------------------------|
| Fake PathFineSpan | HIGH | T1 REFACTOR — **forbidden** |
| Dual Model2 call sites | HIGH | T5 DELETE old hook in same change as T3 |
| Model2-specific LexicalEdge branch | MED | LEXICAL_EDGE_BUILDER_CHANGE=NONE |
| Side-channel provenance | MED | Keep fields on WindowCandidate |
| Shared/path-level Tone | HIGH | pre-edge extract per window |
| Compatibility flag | HIGH | Do not add |
| JobResult internal dump | LOW | JOBRESULT_CHANGE_REQUIRED=NO |
| Model2 lexical hardcode | — | Unchanged PAction contract |
| Pilot-specific prod logic | — | Out of scope |

```text
ARCHITECTURE_SMELL = NO
  (plan avoids listed smells; fake PathFineSpan explicitly rejected)
```

---

## 22. Final verdicts

```text
AUTHORITATIVE_MODEL2_SSOT = AUG12_PRE_LEXICAL_EDGE

TARGET_SINGLE_MAINLINE_FEASIBLE = YES

AUTHORITATIVE_PRE_EDGE_WINDOW_TYPE = GlobalWindowDescriptor

PRE_EDGE_TONE_BINDING_READY = YES

MODEL2_SEMANTIC_CORE_REUSABLE = PARTIAL

PACTION_REUSABLE_PRE_EDGE = YES

RELATION_ADAPTER_REUSABLE = YES

PRONUNCIATION_RECALL_CORE_REUSABLE = YES

MODEL2_PRE_EDGE_CANDIDATE_TARGET_TYPE = WindowCandidate

MODEL2_PROVENANCE_SURVIVES_SEGMENTATION = YES
  (after restore; ensure windowId origin + shallow-clone fields)

LEXICAL_EDGE_BUILDER_CHANGE = NONE

POST_PATHFINESPAN_MODEL2_HOOK = DELETE

D_ACTION_MIGRATION_REQUIRED = YES
  (same infer as P; owner stage PRE_EDGE)

MODEL2_ON_MODEL3_RETRY = NO

DOMAIN_VOTE_STAGE_CHANGE_REQUIRED = NO

MODEL3_CHANGE_REQUIRED = NO

JOBRESULT_CHANGE_REQUIRED = NO

CANDIDATE_BUDGET_REUSABLE = PARTIAL

NO_DUAL_MODEL2_PATH_PLAN = PASS

PATCH_FREE_REFACTOR_PLAN = PASS

IMPLEMENTATION_DRIFT_REPAIR_READY = YES

ONE_NEXT_DELTA = MODEL2_PRE_EDGE_INSERTION_SSOT_RESTORE
ONE_BLOCKER = (none)
```

### WHAT_TO_KEEP / MOVE / DELETE / REFACTOR (summary)

```text
WHAT_TO_KEEP =
  host, checkpoint, UserProfile, PAction, relation adapter, Tone-first recall,
  WindowCandidate+PROFILE_*, merge algorithm, LexicalEdge builder, fallback,
  Domain Vote, Model3, extractAcousticTonePatternForRecall, Tone no-share rule

WHAT_TO_MOVE =
  production Model2 invocation + Model2 Tone source + P/D materialize/merge
  from post-PathFineSpan → post-Base-recall / pre-buildLexicalEdges

WHAT_TO_DELETE =
  orchestrator post-PathFineSpan expand call;
  PathFineSpan-as-required Model2 entry coupling;
  post-seg-as-correct tests; Aug-17-as-current-insertion doc authority

WHAT_TO_REFACTOR =
  policy/expand API onto WindowEvidence;
  lattice async or split stages for single pre-edge wire;
  materialize origin ids to windowId;
  Tone freeze test assertions to new call site
```

**STOP.** Do not develop in this round.
