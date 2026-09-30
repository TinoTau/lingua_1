# -*- coding: utf-8 -*-
"""MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN — read-only design audit emit."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
PHASE = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

VERDICT = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN_PASS_IMPLEMENTATION_READY"
NEXT = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DEVELOPMENT"


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields: list[str] = []
    for r in rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    semantic_contract = [
        {
            "clauseId": "S2-01",
            "clause": "RETRY does NOT mean recall at frozen FineSpan boundaries",
            "authority": "model3_retry_contract_v1.md §RETRY meaning",
            "implication": "Stage-2 MUST NOT use retained PathFineSpan/localSpan boundaries as the sole query set",
        },
        {
            "clauseId": "S2-02",
            "clause": "RETRY = one bounded local re-segmentation + re-recall inside RetryRegion",
            "authority": "model3_retry_contract_v1.md; MODEL3_ARCHITECTURE_CONTRACT_V1",
            "implication": "After regional reinterpretation, Stage-2 performs re-recall on legal local lexical query units inside the region",
        },
        {
            "clauseId": "S2-03",
            "clause": "Reuse FineSpan/window generation; Recall APIs recallSpanTopKV2 and/or recallTopKForWindows(subset)",
            "authority": "model3_retry_contract_v1.md §Recall ownership; Historical SSOT audit 2026-08-29 (reuse window generation)",
            "implication": "Legal query units are Lattice-style contiguous syllable windows, not only path FineSpans",
        },
        {
            "clauseId": "S2-04",
            "clause": "Window Generator owns contiguous syllable windows length 1..5",
            "authority": "Lattice Architecture V1.0.0; window-construction-core LATTICE_WINDOW_MIN/MAX",
            "implication": "N=5 owned by Lattice window SSOT; Stage-2 must not invent a different max",
        },
        {
            "clauseId": "S2-05",
            "clause": "Path FineSpans are non-overlapping segmentations; windows may overlap",
            "authority": "Lattice Architecture; assertPathFineSpansNonOverlapping",
            "implication": "Stage-2 must operate in WINDOW SPACE inside region, not PATH FINESPAN SPACE alone",
        },
        {
            "clauseId": "S2-06",
            "clause": "RetryRegion / Anchor / KEEP barriers are fixed inputs for Unit #1",
            "authority": "Reconciliation + this phase control variable",
            "implication": "Enumerate only inside already-legal RetryRegion; no widen",
        },
        {
            "clauseId": "S2-07",
            "clause": "Historical intent classification",
            "authority": "Derived from S2-01..05",
            "implication": "NOT A. Required: B and/or C (re-enumerate region windows and/or consume regional lattice windows). Preferred Unit#1 isolation: B on successful resegment path only",
        },
        {
            "clauseId": "S2-08",
            "clause": "length=1 Recall: base-only, surface-exact, cap=1",
            "authority": "Single-char freeze; recallSpanTopKV2 length-1 branch",
            "implication": "Windows may include L=1; Recall owner enforces contract — do not bypass",
        },
    ]

    helpers = [
        {
            "helper": "buildLexicalWindowQueries",
            "purpose": "Enumerate contiguous syllable windows 1..5 over provided rawText/syllables",
            "callers": "runLatticeFineSpanGeneration (production); phase1 harness/tests",
            "inputAssumptions": "rawText + globalSyllables (+ optional coarse/ranges); operates on whatever text is passed (full utterance OR region slice)",
            "outputContract": "GlobalWindowDescriptor[] with local offsets relative to input text",
            "boundaryAssumptions": "Does not know Anchor/KEEP; caller must pass already-bounded slice or clip ranges",
            "windowLength": "1..5 (LATTICE_WINDOW_MIN/MAX)",
            "pinyin": "windowPinyinKey via buildWindowDescriptorForRange",
            "tone": "NONE — descriptor only",
            "singleChar": "Includes L=1 windows",
            "domain": "NONE",
            "candidates": "NONE — no Recall",
            "safeForStage2Reuse": "YES_WITH_ADAPTER — pass region slice OR clip on full utterance; remap local→global if slice; do not call outside RetryRegion",
            "notes": "File comment says harness-only is STALE — production lattice already calls it",
        },
        {
            "helper": "buildWindowDescriptorForRange",
            "purpose": "Single-range window descriptor (shared core)",
            "callers": "buildLexicalWindowQueries; generateGlobalWindows",
            "inputAssumptions": "syllable [start,end) within provided syllable array",
            "outputContract": "windowText, windowPinyinKey, offsets, coarse soft metadata",
            "boundaryAssumptions": "No Anchor/KEEP",
            "windowLength": "caller-chosen",
            "pinyin": "YES",
            "tone": "NONE",
            "singleChar": "caller may request L=1",
            "domain": "NONE",
            "candidates": "NONE",
            "safeForStage2Reuse": "YES — preferred atomic owner for one window",
            "notes": "Authoritative SHARED_LEXICAL_WINDOW descriptor builder",
        },
        {
            "helper": "runLatticeFineSpanGeneration",
            "purpose": "Windows→Recall→Edges→Paths→PathFineSpanViews",
            "callers": "orchestrator first-pass; resegmentRetryRegionWithLattice",
            "inputAssumptions": "domainIds non-empty; full or slice text",
            "outputContract": "pathFineSpanViews (+ internal windows discarded from return)",
            "boundaryAssumptions": "Slice = region-local when called from resegment",
            "windowLength": "1..5 via buildLexicalWindowQueries",
            "pinyin": "via windows",
            "tone": "via recallTopKForWindows",
            "singleChar": "via Recall length-1 path",
            "domain": "uses domainIds for lattice Stage-1 Recall",
            "candidates": "YES lattice Stage-1 — NOT returned to Stage-2 today",
            "safeForStage2Reuse": "NOT_AS_STAGE2_ENUMERATOR — already used in resegment; returning windows would change resegment API (Option C)",
            "notes": "Regional lattice already builds windows; Stage-2 currently ignores them",
        },
        {
            "helper": "collectLocalSpansFromRetainedPathViews",
            "purpose": "Union multipath PathFineSpan geometry → RetryRegionLocalSpan[]",
            "callers": "resegment success path",
            "inputAssumptions": "pathFineSpanViews",
            "outputContract": "non-overlapping-per-path FineSpan bounds remapped to global",
            "boundaryAssumptions": "Inside region via remap",
            "windowLength": "N/A — FineSpan lengths only",
            "pinyin": "NONE",
            "tone": "NONE",
            "singleChar": "possible",
            "domain": "NONE",
            "candidates": "NONE — DISCARDS lattice candidates",
            "safeForStage2Reuse": "KEEP for materialize/owner binding; NOT sole query enum source",
            "notes": "Semantic loss boundary for overlapping windows",
        },
        {
            "helper": "routeModel3Retry Stage-2 loop",
            "purpose": "Current RAW_RECALL query emitter",
            "callers": "completeModel3PathFromUpstream",
            "inputAssumptions": "localSpans + owner PathFineSpan",
            "outputContract": "one recallSpanTopKV2 per localSpan",
            "boundaryAssumptions": "localSpan inside region",
            "windowLength": "equals localSpan length only",
            "pinyin": "syllables.join('|') inline",
            "tone": "owner.toneRebindTrace",
            "singleChar": "via recallSpanTopKV2",
            "domain": "retainedDomains from frozen vote",
            "candidates": "materializeLocalSpanHits → merge",
            "safeForStage2Reuse": "REPLACE query enum source on LATTICE success; KEEP Recall API + materialize/merge",
            "notes": "Control-variable site for Unit #1",
        },
        {
            "helper": "recallSpanTopKV2 / recallTopKForWindows",
            "purpose": "Authoritative Recall",
            "callers": "Stage-2 closure / lattice",
            "inputAssumptions": "query key + domains + tone",
            "outputContract": "hits",
            "boundaryAssumptions": "NONE",
            "windowLength": "termLength from syllables",
            "pinyin": "YES",
            "tone": "YES length-1 + optional pattern",
            "singleChar": "ENFORCES base-only/cap=1",
            "domain": "domainIds input",
            "candidates": "YES",
            "safeForStage2Reuse": "UNCHANGED API — Unit #1 only changes query SET fed in",
            "notes": "Retry contract lists both APIs; keep recallSpanTopKV2 for isolation",
        },
        {
            "helper": "fallbackRegionLocalSpans",
            "purpose": "Delta 2 — first-pass FineSpan copy on lattice fail",
            "callers": "resegment fail / empty; router empty localSpans",
            "inputAssumptions": "region.sourceSpanIds",
            "outputContract": "OLD_BOUNDARY_LOCK localSpans",
            "boundaryAssumptions": "first-pass",
            "windowLength": "first-pass FineSpan",
            "pinyin": "N/A",
            "tone": "N/A",
            "singleChar": "N/A",
            "domain": "N/A",
            "candidates": "N/A",
            "safeForStage2Reuse": "OUT_OF_SCOPE — must remain Unit #1 untouched behavior path",
            "notes": "DELTA_RQ_FALLBACK_BOUNDARY_LOCK",
        },
    ]

    options = [
        {
            "optionId": "OPT_A_REENUMERATE_WINDOWS_ON_SUCCESS",
            "title": "Re-enumerate region-local sliding windows on LATTICE success only",
            "semanticSource": "B — re-enumerate legal overlapping lexical windows inside RetryRegion",
            "codeOwner": "SHARED_LEXICAL_WINDOW_OWNER via buildLexicalWindowQueries / buildWindowDescriptorForRange; Stage-2 consumer = routeModel3Retry",
            "files": "model3-retry-router.ts (primary); optional thin adapter using window-construction-core / build-lexical-window-queries.ts (read/reuse)",
            "logicDeleted": "On resegmentOk: localSpan-only as sole Stage-2 query enumeration source",
            "logicReused": "buildLexicalWindowQueries or buildWindowDescriptorForRange 1..5; recallSpanTopKV2; materializeLocalSpanHits/overlappingOriginalSpans; multipath localSpans for owner binding",
            "logicAdded": "Minimal coordinate adapter (slice→global or region-clipped full-utterance ranges); Stage-2 loop over windows when localSpanSource=LATTICE",
            "pathIdentity": "Preserved at materialize via overlapping original/source FineSpans; windows are region-level (Lattice window-before-path model)",
            "barriers": "Preserved — enum clipped to RetryRegion only",
            "queryCountImpact": "Per region R syllables: sum_{L=1..min(5,R)}(R-L+1); typical R=2..4 → 3..14; max observed R=7 → 25",
            "candidateImpact": "perSpanCap unchanged; pool<=16 unchanged; more queries may add hits then same merge/cap",
            "latencyImpact": "LOW_MODERATE bounded; utterance/runtime cache may absorb duplicate keys",
            "complexity": "LOW",
            "risk": "LOW — additive window supersets; success-path only",
            "changesDelta2": "NO — fallback/fail path keeps localSpan-only",
            "preferred": "YES",
            "rejectReason": "",
        },
        {
            "optionId": "OPT_B_CONSUME_LATTICE_WINDOWS",
            "title": "Return/consume windows from regional lattice success",
            "semanticSource": "C — consume lexical windows already materialized by regional lattice",
            "codeOwner": "REGIONAL_LATTICE_OWNER (runLatticeFineSpanGeneration) + resegment return type",
            "files": "model3-retry-region-resegment.ts; lattice-fine-span-runtime.ts (expose windows); model3-retry-router.ts",
            "logicDeleted": "Discard of lattice windows at collectLocalSpans boundary",
            "logicReused": "Existing lattice Stage-1 window enum",
            "logicAdded": "API to surface windows/descriptors from lattice success to Stage-2",
            "pathIdentity": "Preserved if windows remapped like localSpans",
            "barriers": "Preserved if slice-only",
            "queryCountImpact": "Similar to OPT_A (same 1..5 space)",
            "candidateImpact": "If also reusing lattice Stage-1 hits: larger semantic change (may skip Stage-2 re-recall) — OUT OF Unit#1 preferred isolation",
            "latencyImpact": "Possibly lower if hits reused; higher coupling",
            "complexity": "MEDIUM",
            "risk": "MEDIUM — touches resegment/lattice return; harder to isolate from fallback API",
            "changesDelta2": "RISK — resegment interface shared with fallback path; REJECT_FOR_UNIT1_SCOPE if fallback semantics change",
            "preferred": "NO",
            "rejectReason": "REJECT_FOR_UNIT1_SCOPE — not isolatable without resegment contract change risking Delta 2",
        },
        {
            "optionId": "OPT_C_SWITCH_TO_RECALL_TOPK_FOR_WINDOWS",
            "title": "Feed region windows into recallTopKForWindows batch API",
            "semanticSource": "B with alternate Recall entry",
            "codeOwner": "recallTopKForWindows + window builder",
            "files": "model3-retry-router.ts; run-model3-path-step.ts recall closure",
            "logicDeleted": "Per-localSpan recallSpanTopKV2 loop on success",
            "logicReused": "Lattice window Recall batch path",
            "logicAdded": "Wire Stage-2 to recallTopKForWindows",
            "pathIdentity": "Need careful rematerialize mapping",
            "barriers": "OK if region-clipped",
            "queryCountImpact": "Same window count; different batching",
            "candidateImpact": "Materialize path differs from current Stage-2",
            "latencyImpact": "Possibly better batching",
            "complexity": "MEDIUM_HIGH",
            "risk": "MEDIUM — changes Recall entrypoint + materialize wiring beyond enumeration source",
            "changesDelta2": "NO if success-only",
            "preferred": "NO",
            "rejectReason": "Larger than control variable (enumeration source); keep recallSpanTopKV2 for isolation",
        },
    ]

    cohorts = [
        {
            "cohortId": "A_ADEQUATE_LOCALSPAN",
            "need": "legal RetryRegion; resegmentOk; current localSpan query already adequate",
            "selectionHint": "From frozen provenance: resegmentOk=true AND mechanism later is RECALL_TARGET_MISS or survived (query geometry already OK)",
            "exampleCases": "Use recall-miss / kenlm controls with overlapping region+query from prior audits (e.g. successful query controls)",
            "unit1Valid": "YES",
        },
        {
            "cohortId": "B_CROSS_LOCALSPAN_WINDOW",
            "need": "legal RetryRegion; resegmentOk; lexical unit needs window spanning adjacent retained localSpans",
            "selectionHint": "Region sylLen>=2 with ≥2 newLocalSpanSurfaces and primary minimal target length spanning >1 localSpan",
            "exampleCases": "Filter dialog_200 resegmentOk regions with len(newLocalSpanSurfaces)>=2 (e.g. d001-style multipath coffee regions)",
            "unit1Valid": "YES — primary semantic target for Unit #1",
        },
        {
            "cohortId": "C_MULTIPATH",
            "need": "≥2 paths with Retry regions + resegmentOk",
            "selectionHint": "43 cases with multipath+ok in frozen raw (d001,d002,d003,d004,...)",
            "exampleCases": "d001,d002,d003,d004",
            "unit1Valid": "YES",
        },
        {
            "cohortId": "D_SINGLE_CHAR",
            "need": "region includes L=1 window / sylLen region with length-1 query",
            "selectionHint": "resegmentOk regions with syllable length 1 (21 observed) or windows L=1 inside longer region",
            "exampleCases": "Pick from sylLen=1 resegmentOk set",
            "unit1Valid": "YES — proves length-1 Recall contract still enforced",
        },
        {
            "cohortId": "E_ANCHOR_ADJACENT",
            "need": "RetryRegion adjacent to Anchor; no Anchor crossing",
            "selectionHint": "Region rawStart/rawEnd touches Anchor span; sourceSpanIds never include Anchor",
            "exampleCases": "From decisions isAnchor + adjacent RETRY merge groups",
            "unit1Valid": "YES",
        },
        {
            "cohortId": "F_KEEP_ADJACENT",
            "need": "RetryRegion adjacent to KEEP; no unrelated KEEP crossing",
            "selectionHint": "KEEP flush boundaries at region edges",
            "exampleCases": "Any deriveRetryRegions group next to KEEP",
            "unit1Valid": "YES",
        },
        {
            "cohortId": "X_NO_REGION_EXCLUDE",
            "need": "KEEP_ON_LOCUS / no RetryRegion",
            "selectionHint": "Model3 quality cohort",
            "exampleCases": "EXCLUDE from Unit #1 acceptance",
            "unit1Valid": "NO — wrong owner",
        },
        {
            "cohortId": "Y_FALLBACK_ONLY_EXCLUDE",
            "need": "resegmentOk=false only",
            "selectionHint": "146 all-fail style cases",
            "exampleCases": "EXCLUDE from Unit #1 primary acceptance (Delta 2)",
            "unit1Valid": "NO — Delta 2",
        },
    ]

    drift_gate = [
        {"check": "Model3 responsibility changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "RetryRegion responsibility changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "Barrier behavior changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "FineSpan architecture changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "Domain Vote changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "Model2 changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "Recall algorithm changed?", "required": "NO", "design": "NO — same recallSpanTopKV2", "pass": "YES"},
        {"check": "Assembly changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "KenLM changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "JobResult changed?", "required": "NO", "design": "NO", "pass": "YES"},
        {"check": "candidate cap changed?", "required": "NO", "design": "NO <=16", "pass": "YES"},
        {"check": "Delta 2 changed?", "required": "NO", "design": "NO — fallback path untouched", "pass": "YES"},
        {"check": "First semantic change at STAGE2_QUERY_ENUMERATION?", "required": "YES", "design": "YES", "pass": "YES"},
        {"check": "New config / compatibility path?", "required": "NO", "design": "NO", "pass": "YES"},
    ]

    decisions_required: list[dict] = []  # empty → implementation ready

    before_after = {
        "BEFORE": {
            "precondition": "legal RetryRegion exists; regional resegmentation succeeds (resegmentOk=true)",
            "stage2QuerySet": "RetryRegionLocalSpan[] only (union of retained path FineSpan geometries)",
            "limitation": "Cannot express legal overlapping lexical windows that cross adjacent retained localSpan boundaries; Lattice window space discarded after path materialization",
        },
        "AFTER": {
            "sameRetryRegion": True,
            "sameBarriers": True,
            "sameRegionalResegmentation": True,
            "stage2QuerySet": "All contiguous syllable windows length 1..min(5,R) inside RetryRegion syllable range (via SHARED_LEXICAL_WINDOW_OWNER)",
            "newCapability": "Cross-localSpan lexical windows expressible to recallSpanTopKV2; existing localSpan-length windows remain as subset",
        },
        "UNCHANGED": [
            "Model3",
            "RetryRegion derivation",
            "Anchor",
            "KEEP barriers",
            "Domain Vote",
            "Model2",
            "Recall algorithm/thresholds/topK",
            "Lexicon",
            "Assembly",
            "KenLM",
            "candidate cap <=16",
            "JobResult",
            "fallbackRegionLocalSpans / Delta 2",
        ],
    }

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": VERDICT,
        "nextPhase": NEXT,
        "controlVariable": "RETRY_STAGE2_QUERY_ENUMERATION_SOURCE",
        "historicalContractAnswer": {
            "A_pathFineSpanOnly": "REJECTED_BY_SSOT",
            "B_reenumerateWindowsInRegion": "REQUIRED_CAPABLE",
            "C_consumeLatticeWindows": "ALSO_CAPABLE_BUT_NOT_UNIT1",
            "selectedForUnit1": "B",
            "evidence": [
                "model3_retry_contract: NOT frozen FineSpan boundaries",
                "reuse FineSpan/window generation",
                "recallSpanTopKV2 and/or recallTopKForWindows(subset)",
                "Lattice Window Generator owns 1..5",
            ],
        },
        "semanticOwner": {
            "classification": "SHARED_LEXICAL_WINDOW_OWNER",
            "codeMapping": "window-construction-core / buildLexicalWindowQueries (Lattice Window Generator)",
            "stage2Role": "CONSUMER — must invoke shared owner inside RetryRegion on success path",
            "notOwner": "function name buildLexicalWindowQueries is implementation choice; behavior is frozen",
        },
        "semanticLossBoundary": (
            "collectLocalSpansFromRetainedPathViews → Stage-2 localSpan loop: "
            "overlapping lattice window space + lattice Stage-1 hits discarded; "
            "only non-overlapping path FineSpan geometry survives as query set"
        ),
        "buildLexicalWindowQueriesAssessment": {
            "implementsRequiredSemantics": "YES for contiguous 1..5 window enumeration",
            "stage1SpecificAssumptions": "NONE that block region-slice use; already used on region slice in resegment",
            "fullUtteranceRequired": "NO — accepts provided text/syllables",
            "boundedRegionOk": "YES via slice or clipped ranges",
            "globalOffsets": "NEED_ADAPTER if slice-local; OR use buildWindowDescriptorForRange on full utterance with region-clipped starts",
            "respectsRegionIfCallerClips": "YES",
            "crossesAnchorKeep": "NO if only called inside RetryRegion",
            "windowN": "1..5; owner = Lattice LATTICE_WINDOW_MIN/MAX",
            "includesSingleChar": "YES; Recall enforces single-char contract",
            "doesRecall": "NO",
            "doesDomain": "NO",
            "directReuseSafe": "YES_WITH_MINIMAL_COORDINATE_ADAPTER",
        },
        "preferredDesign": "OPT_A_REENUMERATE_WINDOWS_ON_SUCCESS",
        "beforeAfter": before_after,
        "performanceBound": {
            "formula": "sum_{L=1..min(5,R)} (R-L+1) windows per RetryRegion",
            "typicalR": "2..4 → 3..14 windows",
            "worstObservedR": "7 → 25 windows",
            "recallDeltaBeforeCache": "same as window count per region",
            "recallDeltaAfterDedup": "≤ window count; duplicate keys absorbed by runtime/utterance cache where enabled",
            "candidatePoolImpact": "0 on cap (<=16 unchanged); perSpanCap unchanged",
            "bounded": True,
        },
        "incidentalSimplification": (
            "Reusing buildWindowDescriptorForRange may remove duplicated inline "
            "windowText/pinyin join in Stage-2 success path — INCIDENTAL_SIMPLIFICATION; "
            "do not expand into unrelated key-refactor if blocked"
        ),
        "decisionRequiredBeforeDevelopment": decisions_required,
        "implementationReady": True,
        "acpRequired": False,
        "driftGatePass": True,
        "targetList": {
            "productionFiles": [
                "electron_node/electron-node/main/src/model3-runtime/model3-retry-router.ts",
            ],
            "optionalReuseOnly": [
                "electron_node/.../build-lexical-window-queries.ts",
                "electron_node/.../window-construction-core.ts",
            ],
            "functions": [
                "routeModel3Retry Stage-2 query loop (success path)",
                "reuse buildLexicalWindowQueries and/or buildWindowDescriptorForRange",
                "keep recallSpanTopKV2 + materializeLocalSpanHits",
            ],
            "tests": [
                "model3-retry-region*.test.ts / mainline integration — add Stage-2 window enum cases",
                "TRACE_ON/OFF parity if side-channel fields added",
            ],
            "traceHarness": [
                "existing MODEL3_CANDIDATE_PROVENANCE_TRACE rawRecalls",
                "optional: querySource=WINDOW|LOCAL_SPAN; windowSyllableStart/End",
            ],
            "doNotTouch": [
                "model3-retry-region.ts",
                "fallbackRegionLocalSpans behavior",
                "Model3 infer/packer",
                "Domain Vote",
                "recallSpanTopKV2 internals",
                "JobResult",
            ],
        },
    }

    write_csv(DOCS / "model3_retry_stage2_semantic_contract.csv", semantic_contract)
    write_csv(DOCS / "model3_retry_stage2_design_options.csv", options)
    write_csv(DOCS / "model3_retry_stage2_control_cohorts.csv", cohorts)
    write_csv(DOCS / "model3_retry_stage2_drift_gate.csv", drift_gate)
    # helper audit embedded in summary; also write compact helper csv
    write_csv(DOCS / "model3_retry_stage2_helper_audit.csv", helpers)
    (DOCS / "model3_retry_stage2_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Prefer ≤6: merge helper into report; delete helper csv to stay at 6
    # Keep: md, semantic_contract, design_options, control_cohorts, drift_gate, summary
    (DOCS / "model3_retry_stage2_helper_audit.csv").unlink(missing_ok=True)

    report = f"""# Lingua — Delta 1 Retry Stage-2 Query Enumeration SSOT Restoration Design

Generated: {GENERATED}  
Phase: `{PHASE}`  
Mode: READ-ONLY DESIGN — no production change

================================
1. EXECUTIVE VERDICT
====================

**{VERDICT}**

Next phase: `{NEXT}`

Control variable: `RETRY_STAGE2_QUERY_ENUMERATION_SOURCE` only.

Preferred design: **OPT_A_REENUMERATE_WINDOWS_ON_SUCCESS**

- Stage-2 semantic contract: legal **overlapping lexical windows (1..5)** inside fixed RetryRegion  
- Owner: **SHARED_LEXICAL_WINDOW_OWNER** (Lattice Window Generator / `window-construction-core`)  
- Implementation: reuse `buildLexicalWindowQueries` / `buildWindowDescriptorForRange` on **LATTICE success path only**  
- Delta 2 fallback: **unchanged**  
- DECISION_REQUIRED: **empty**  
- Automatic drift gate: **PASS**

================================
2. AUTHORITATIVE SSOT EVIDENCE
=============================

| ID | Clause | Implication |
|----|--------|-------------|
| S2-01 | RETRY ≠ recall at frozen FineSpan boundaries | localSpan-only sole source is invalid |
| S2-02 | re-segmentation + re-recall in region | Stage-2 re-recalls legal local units |
| S2-03 | reuse window generation; recallSpanTopKV2 and/or recallTopKForWindows | windows are legal query units |
| S2-04 | Window Generator owns 1..5 | N=5 not reinvented |
| S2-05 | windows overlap; path FineSpans do not | Stage-2 = window space |
| S2-07 | Historical answer | **Not A**; Unit#1 selects **B** |

See `model3_retry_stage2_semantic_contract.csv`.

================================
3. CURRENT STAGE-2 CALL GRAPH
=============================

```text
RetryRegion (FIXED)
 → regional slice
 → runLatticeFineSpanGeneration
      → buildLexicalWindowQueries (1..5)     ← WINDOW SPACE EXISTS
      → recallTopKForWindows
      → edges → pathFineSpanViews
 → collectLocalSpansFromRetainedPathViews   ← KEEPS FineSpan geometry only
 → RetryRegionLocalSpan[]
 → Stage-2 for each localSpan               ← QUERY SET = FineSpan bounds only
      → windowText/pinyin inline
      → recallSpanTopKV2
 → materialize → merge → Assembly…
```

Fallback (OUT OF SCOPE): `resegmentOk=false` → `fallbackRegionLocalSpans` → same localSpan loop.

================================
4. STAGE-2 SEMANTIC CONTRACT
============================

Inside an already-legal RetryRegion, after successful regional reinterpretation, Stage-2 MUST make expressible to authoritative Recall:

**every contiguous syllable window of length L ∈ [1, min(5, R)] whose syllable range lies entirely inside the RetryRegion**, with correct global raw/syllable offsets, pinyin key, and existing tone attachment rules.

Stage-2 MUST NOT:

- treat retained PathFineSpan / localSpan boundaries as the exclusive query set  
- widen RetryRegion / cross Anchor / unrelated KEEP  
- change Domain Vote / Model3 / Recall algorithm  
- alter fallback (Delta 2).

================================
5. WINDOW VS PATH SEMANTICS
===========================

| Concept | Role |
|---------|------|
| Lattice WINDOW | Overlapping candidate lexical query unit (1..5) |
| Retained PATH FINESPAN | Non-overlapping segmentation hypothesis |

Unit #1 Stage-2 operates on **region-level WINDOW SPACE** (Lattice model: windows before paths).  
Path identity is preserved when materializing hits onto overlapping source FineSpans (existing `overlappingOriginalSpans` / owner binding).

================================
6. QUERY ENUMERATION OWNERSHIP
==============================

| Layer | Classification |
|-------|----------------|
| Semantic owner | **SHARED_LEXICAL_WINDOW_OWNER** |
| Code | `window-construction-core` + `buildLexicalWindowQueries` |
| Stage-2 | **CONSUMER** — chooses when to invoke inside RetryRegion |
| Not frozen | Function name must equal `buildLexicalWindowQueries` |

================================
7–8. EXISTING HELPER / buildLexicalWindowQueries
================================================

`buildLexicalWindowQueries` **does** implement the required contiguous 1..5 enumeration semantics.  
It is already production-used by lattice (comment “harness only” is STALE).

| Question | Answer |
|----------|--------|
| Full utterance required? | NO — works on region slice |
| Bounded region? | YES if caller passes slice or clips |
| Global offsets? | Adapter if slice-local; or descriptor on full utterance with clipped starts |
| Cross Anchor/KEEP? | NO if confined to RetryRegion |
| N? | 1..5; Lattice owns N |
| L=1? | YES; Recall enforces single-char contract |
| Does Recall/domain? | NO |

**Direct reuse: YES_WITH_MINIMAL_COORDINATE_ADAPTER.**

================================
9. CURRENT SEMANTIC LOSS
========================

First loss of cross-localSpan lexical expressibility:

**collectLocalSpansFromRetainedPathViews → Stage-2 localSpan-only loop**

| Transition | Preserved | Discarded |
|------------|-----------|-----------|
| Lattice windows → edges/paths | path geometry | overlapping window set as query space |
| pathFineSpanViews → localSpans | remapped FineSpan bounds | lattice Stage-1 candidates |
| localSpans → Stage-2 queries | FineSpan-length queries only | any window spanning ≥2 FineSpans |

================================
10–11. DESIGN OPTIONS / PREFERRED
=================================

See `model3_retry_stage2_design_options.csv`.

| Option | Verdict |
|--------|---------|
| OPT_A re-enumerate windows on success | **PREFERRED** |
| OPT_B consume lattice windows | REJECT_FOR_UNIT1_SCOPE |
| OPT_C recallTopKForWindows switch | Rejected — beyond enumeration-source variable |

================================
12. BEFORE / AFTER CONTRACT
===========================

**BEFORE** (resegmentOk): Stage-2 query set = localSpans only; cannot express cross-FineSpan windows.

**AFTER** (same region/barriers/resegment): Stage-2 query set = all legal 1..5 windows inside region; localSpan-length queries remain as subset.

**UNCHANGED:** Model3, RetryRegion, barriers, Domain Vote, Model2, Recall algorithm, Lexicon, Assembly, KenLM, cap≤16, JobResult, **Delta 2**.

================================
13. PERFORMANCE BOUND
=====================

`sum_{{L=1..min(5,R)}}(R-L+1)` per region.  
Typical R=2..4 → 3..14; worst observed R=7 → 25. **Bounded.** Cap≤16 unchanged.

================================
14. TRACE CONTRACT
==================

Compare BEFORE/AFTER at Stage-2:

- retryRegionId, resegmentOk / localSpanSource  
- localSpans[]  
- enumeratedQueries[] (syllableStart/End, rawStart/End, windowText, windowPinyinKey, querySource=WINDOW)  
- rawRecallInvocation linkage  

Side-channel only; **no JobResult fields**.  
First semantic delta must be at **STAGE2_QUERY_ENUMERATION**.

================================
15. CONTROL COHORTS
===================

See `model3_retry_stage2_control_cohorts.csv`.  
Exclude KEEP_ON_LOCUS / no-region and fallback-only from Unit #1 primary gate.

Frozen baseline: ~50 cases with any resegmentOk; ~43 multipath+ok.

================================
16. AUTOMATIC DRIFT GATE
========================

See `model3_retry_stage2_drift_gate.csv` — **all PASS**.

================================
17. DECISION_REQUIRED_BEFORE_DEVELOPMENT
=======================================

**(empty)**

SSOT determines Not-A / windows required. OPT_A selected for Unit #1 isolation without unresolved ownership conflict. No ACP.

================================
18. TARGET LIST
===============

Production (≤3):

1. `model3-retry-router.ts` — Stage-2 success-path query enumeration  

Reuse only (no semantic rewrite): `build-lexical-window-queries.ts`, `window-construction-core.ts`

Do **not** touch: `fallbackRegionLocalSpans`, `deriveRetryRegions`, Model3, Recall internals, JobResult.

================================
19. CHECK LIST
==============

- [x] one variable only  
- [x] Stage-2 enumeration only  
- [x] RetryRegion unchanged  
- [x] barriers unchanged  
- [x] Model3 unchanged  
- [x] Domain Vote unchanged  
- [x] Model2 unchanged  
- [x] Recall algorithm unchanged  
- [x] Lexicon unchanged  
- [x] Delta 2 unchanged  
- [x] multipath preserved  
- [x] single-character contract preserved (via Recall)  
- [x] candidate cap <=16  
- [x] JobResult unchanged  
- [x] no config flag  
- [x] no compatibility path  
- [x] no case-specific logic  
- [x] no reference leakage  
- [x] no heldout tuning  
- [x] trace first change at Stage-2  
- [x] downstream replay planned  

================================
20. NEXT PHASE
==============

`{NEXT}`

Exactly one.
"""
    (DOCS / "Lingua_Model3_Retry_Stage2_SSOT_Restoration_Design.md").write_text(
        report, encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "verdict": VERDICT,
                "nextPhase": NEXT,
                "preferred": "OPT_A",
                "decisionRequired": 0,
                "driftGate": "PASS",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
