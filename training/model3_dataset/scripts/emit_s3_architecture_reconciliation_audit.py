# -*- coding: utf-8 -*-
"""MODEL3_ARCHITECTURE_RECONCILIATION_AND_DRIFT_CLOSURE — read-only emit."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
PHASE = "MODEL3_ARCHITECTURE_RECONCILIATION_AND_DRIFT_CLOSURE"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

VERDICT = "MODEL3_ARCHITECTURE_RECONCILIATION_PASS_WITH_ACTIVE_DELTAS"
NEXT = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN"


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
    authority = [
        {
            "doc": "docs/fw-detector/freeze/FROZEN.md + Lattice Architecture V1.0.0",
            "class": "AUTHORITATIVE",
            "scope": "FineSpan multipath lattice; path-local Domain Vote; CrossPath<=16; KenLM",
        },
        {
            "doc": "docs/user_correction/model3/MODEL3_ARCHITECTURE_CONTRACT_V1.md",
            "class": "AUTHORITATIVE",
            "scope": "Model3 role KEEP/RETRY; prohibitions; neighbor ownership",
        },
        {
            "doc": "docs/user_correction/model3/MODEL3_SYNTHETIC_V1_FROZEN.md",
            "class": "AUTHORITATIVE",
            "scope": "Text-only role; mainline pipeline order; Anchor sources",
        },
        {
            "doc": "docs/user_correction/model3/model3_retry_contract_v1.md",
            "class": "AUTHORITATIVE",
            "scope": "RETRY=bounded re-segmentation+re-recall; hard limits; not same-boundary recall",
        },
        {
            "doc": "docs/user_correction/model3/model3_anchor_contract_v1.md / input / output contracts",
            "class": "AUTHORITATIVE",
            "scope": "Anchor/input/output companion contracts",
        },
        {
            "doc": "docs/user_correction/model3/documentation_authority_matrix.csv",
            "class": "AUTHORITATIVE",
            "scope": "Document authority matrix (2026-08-26); needs refresh for post-mainline audits",
        },
        {
            "doc": "Lingua_Domain_Vote_Utterance_Singleton_Architecture_Audit_2026_09_01.md",
            "class": "SUPPLEMENTARY",
            "scope": "Clarifies path-local vote MATCHES Lattice; corrects false utterance-singleton assumption",
        },
        {
            "doc": "Lingua_Retry_MultiHypothesis_Minimal_Correction_Audit_2026_08_29.md",
            "class": "SUPPLEMENTARY",
            "scope": "preferred-path removal; multipath Retry restoration evidence",
        },
        {
            "doc": "All MODEL3_V2_S3_* audit reports 2026-09-02/03",
            "class": "AUDIT_ONLY",
            "scope": "Evidence/metrics; MUST NOT redefine architecture SSOT",
        },
        {
            "doc": "model3_v2_s3_*_freeze_state.csv / corrected_freeze_state.csv",
            "class": "EVIDENCE_ONLY",
            "scope": "Evidence status freezes; demote architecture-sounding prevalence to evidence-only",
        },
        {
            "doc": "documentation_authority_matrix note: retry_contract 'not enabled'",
            "class": "STALE",
            "scope": "Retry is mainline-active since MODEL3_V1_MAINLINE_INTEGRATION",
        },
        {
            "doc": "MODEL3_ARCHITECTURE_CONTRACT_V1 'Model3 invocations/utterance ≤1' literal",
            "class": "STALE_WORDING",
            "scope": "Superseded by STAGE language: one decision STAGE may evaluate multiple retained paths; no Retry re-infer",
        },
        {
            "doc": "TTS readiness / freeze_tts_audit / early dual-path shadow plans",
            "class": "SUPERSEDED",
            "scope": "Role correction / mainline integration superseded",
        },
    ]

    current_vs_ssot = [
        {
            "area": "FineSpan",
            "frozenSsot": "Multipath lattice; windows 1..5; soft coarse; PathFineSpanView[]",
            "currentCode": "runLatticeFineSpanGeneration + buildLexicalWindowQueries; assertPathFineSpansNonOverlapping per path",
            "status": "MATCH_UPSTREAM",
            "actualIssue": "Sliding windows exist at lattice Stage-1; path FineSpans are non-overlapping segmentations (by design)",
            "nextAction": "KEEP; consumer Retry Stage-2 must re-use windows",
        },
        {
            "area": "Model2",
            "frozenSsot": "P/D expansion only; not Retry geometry / Model3 / Domain / length-1 lexical owner",
            "currentCode": "expandActiveCandidatesWithModel2 before path Domain Vote",
            "status": "MATCH",
            "actualIssue": "NONE",
            "nextAction": "NONE",
        },
        {
            "area": "Domain Vote",
            "frozenSsot": "ONE vote per retained path (Lattice); Retry NO second vote",
            "currentCode": "voteUtteranceDomainFromPool once in prepareModel3PathUpstream; completeFromVote SAME vote",
            "status": "MATCH",
            "actualIssue": "NONE — utterance-singleton assumption was DOCUMENT false conflict",
            "nextAction": "NONE",
        },
        {
            "area": "Anchor",
            "frozenSsot": "Upstream DOMAIN|MODEL2|DOMAIN_AND_MODEL2; Model3 never creates/mutates",
            "currentCode": "materializeModel3Anchors; maskAnchorDecisions RETRY→KEEP",
            "status": "MATCH",
            "actualIssue": "NONE",
            "nextAction": "NONE",
        },
        {
            "area": "Model3 packer",
            "frozenSsot": "Text + Anchor mask features; no Lexicon/Recall ownership",
            "currentCode": "packModel3SpanInferFields per PathFineSpan",
            "status": "MATCH",
            "actualIssue": "NONE for architecture; quality separate",
            "nextAction": "NONE production; optional MODEL3_TRIGGER_QUALITY_AUDIT later",
        },
        {
            "area": "Model3 inference",
            "frozenSsot": "KEEP|RETRY only; one STAGE/utterance may evaluate multiple paths",
            "currentCode": "host.inferPath once per pathFineSpanView inside orchestrator path loop; no post-Retry infer",
            "status": "MATCH_STAGE",
            "actualIssue": "Older '≤1 inference/utterance' wording STALE vs multipath STAGE",
            "nextAction": "DOCUMENT cleanup only",
        },
        {
            "area": "decision mapping",
            "frozenSsot": "Map KEEP/RETRY back to correct FineSpan/path; Anchor never RETRY",
            "currentCode": "decisions by spanId; maskAnchorDecisions",
            "status": "MATCH",
            "actualIssue": "NONE architecture",
            "nextAction": "NONE",
        },
        {
            "area": "Retry region",
            "frozenSsot": "Union legal adjacent RETRY spans; KEEP/Anchor break; bounded",
            "currentCode": "deriveRetryRegions / buildRegionFromSpans",
            "status": "MATCH",
            "actualIssue": "KEEP barrier correctly excludes KEEP_ON_LOCUS — not a bug",
            "nextAction": "NONE for barrier; do not widen into KEEP by default",
        },
        {
            "area": "Retry barrier",
            "frozenSsot": "No Anchor cross; no unrelated KEEP by default",
            "currentCode": "isRetryEligible + KEEP flush + maskAnchorDecisions",
            "status": "MATCH",
            "actualIssue": "Ownership split across path-step + region (mild DUPLICATED)",
            "nextAction": "Optional consolidation later; not blocking",
        },
        {
            "area": "Retry resegmentation",
            "frozenSsot": "Bounded local re-segmentation reusing FineSpan/lattice",
            "currentCode": "resegmentRetryRegionWithLattice → runLatticeFineSpanGeneration on slice",
            "status": "MATCH_WHEN_OK",
            "actualIssue": "On failure, fallback drifts (see Fallback row)",
            "nextAction": "Unit #2 fallback",
        },
        {
            "area": "regional paths",
            "frozenSsot": "All retained regional pathFineSpanViews; no preferred-path",
            "currentCode": "collectLocalSpansFromRetainedPathViews + dedupRetryRegionLocalSpans",
            "status": "MATCH",
            "actualIssue": "preferred-path ALREADY_FIXED",
            "nextAction": "NONE",
        },
        {
            "area": "Retry query enumeration",
            "frozenSsot": "Reuse FineSpan/window sliding enumeration inside region for re-recall",
            "currentCode": "routeModel3Retry: one query per localSpan only; NO buildLexicalWindowQueries at Stage-2",
            "status": "RUNTIME_ARCHITECTURE_DRIFT",
            "actualIssue": "DELTA_RQ_STAGE2_NO_SLIDING — semantic windows lost at Stage-2 consumer",
            "nextAction": "Unit #1 SSOT restoration design",
        },
        {
            "area": "Recall query key",
            "frozenSsot": "windowText + syllables.join('|') + tone from existing evidence",
            "currentCode": "Same formula in router; duplicated vs window-construction-core",
            "status": "MATCH_SEMANTIC_DUPLICATED_CODE",
            "actualIssue": "DUPLICATED_PRODUCTION_LOGIC (formula copy)",
            "nextAction": "Reuse helper when Stage-2 restored",
        },
        {
            "area": "Recall",
            "frozenSsot": "recallSpanTopKV2 owns hits; no Retry alternate engine; no threshold hide",
            "currentCode": "recallSpanTopKV2 via path-step closure",
            "status": "MATCH",
            "actualIssue": "NONE for geometry ownership",
            "nextAction": "NONE",
        },
        {
            "area": "candidate merge",
            "frozenSsot": "Per-span merge + existing caps; pool refreshable; vote frozen",
            "currentCode": "mergeSpanCandidates + buildFineSpanCandidatePool if mutated",
            "status": "MATCH",
            "actualIssue": "NONE",
            "nextAction": "NONE",
        },
        {
            "area": "Assembly",
            "frozenSsot": "Domain-aware assembly under SAME vote",
            "currentCode": "completeDomainAwareAssemblyFromVote",
            "status": "MATCH",
            "actualIssue": "Not active causal owner for Query Geometry cohort",
            "nextAction": "NONE",
        },
        {
            "area": "cross-path merge",
            "frozenSsot": "<=16 single pool",
            "currentCode": "mergeCrossPathSentenceCandidates",
            "status": "MATCH",
            "actualIssue": "NONE",
            "nextAction": "NONE",
        },
        {
            "area": "KenLM",
            "frozenSsot": "One final pass; not Model3 trigger",
            "currentCode": "runFwSentenceRerankFromPrefilled after merge",
            "status": "MATCH",
            "actualIssue": "LIMITED evidence only; not active primary owner",
            "nextAction": "NONE",
        },
        {
            "area": "JobResult",
            "frozenSsot": "Transport only; no Model3 audit fields",
            "currentCode": "diagnostics/provenance side-channel; comments forbid JobResult fields",
            "status": "MATCH",
            "actualIssue": "NONE",
            "nextAction": "NONE",
        },
        {
            "area": "trace infrastructure",
            "frozenSsot": "Side-channel RetryEventTrace preferred",
            "currentCode": "retry_regions + candidate provenance env gate; missing barrier edges/queryId/dropReason",
            "status": "PARTIAL",
            "actualIssue": "Trace completeness gap (AUDIT tooling) — not production delta",
            "nextAction": "With unit #1 design: add side-channel fields only",
        },
        {
            "area": "Retry fallback",
            "frozenSsot": "Must reinterpret local boundary; not lock to original FineSpan",
            "currentCode": "fallbackRegionLocalSpans copies first-pass sourceSpanIds bounds",
            "status": "RUNTIME_ARCHITECTURE_DRIFT",
            "actualIssue": "DELTA_RQ_FALLBACK_BOUNDARY_LOCK",
            "nextAction": "Unit #2 independent design",
        },
    ]

    ownership = [
        {"responsibility": "span geometry", "expectedOwner": "Lattice FineSpan", "actualOwner": "runLatticeFineSpanGeneration", "class": "MATCH"},
        {"responsibility": "Anchor ownership", "expectedOwner": "Domain/Model2 adapter", "actualOwner": "materializeModel3Anchors", "class": "MATCH"},
        {"responsibility": "Model3 decision", "expectedOwner": "Model3 inferPath", "actualOwner": "model3-inference-client.inferPath", "class": "MATCH"},
        {"responsibility": "Retry eligibility", "expectedOwner": "RetryRegion", "actualOwner": "isRetryEligible + maskAnchorDecisions", "class": "DUPLICATED_OWNERSHIP"},
        {"responsibility": "Retry region", "expectedOwner": "deriveRetryRegions", "actualOwner": "deriveRetryRegions", "class": "MATCH"},
        {"responsibility": "barrier enforcement", "expectedOwner": "RetryRegion", "actualOwner": "deriveRetryRegions KEEP flush + maskAnchor", "class": "DUPLICATED_OWNERSHIP"},
        {"responsibility": "regional re-segmentation", "expectedOwner": "resegmentRetryRegionWithLattice", "actualOwner": "resegmentRetryRegionWithLattice", "class": "MATCH"},
        {"responsibility": "path retention", "expectedOwner": "collectLocalSpansFromRetainedPathViews", "actualOwner": "same", "class": "MATCH"},
        {"responsibility": "query enumeration", "expectedOwner": "Reuse buildLexicalWindowQueries in Retry Stage-2", "actualOwner": "routeModel3Retry localSpan loop ONLY", "class": "WRONG_OWNER"},
        {"responsibility": "query-key construction", "expectedOwner": "window-construction-core", "actualOwner": "router inline formula (copy)", "class": "DUPLICATED_OWNERSHIP"},
        {"responsibility": "Recall", "expectedOwner": "recallSpanTopKV2", "actualOwner": "recallSpanTopKV2", "class": "MATCH"},
        {"responsibility": "domain vote", "expectedOwner": "voteUtteranceDomainFromPool path-local", "actualOwner": "same once per path step", "class": "MATCH"},
        {"responsibility": "candidate budget", "expectedOwner": "per-span limit + CrossPath<=16", "actualOwner": "getPerSpanCandidateLimit + merge<=16", "class": "MATCH"},
        {"responsibility": "Assembly", "expectedOwner": "completeDomainAwareAssemblyFromVote", "actualOwner": "same", "class": "MATCH"},
        {"responsibility": "KenLM", "expectedOwner": "sentence rerank", "actualOwner": "same", "class": "MATCH"},
    ]

    active_deltas = [
        {
            "deltaId": "DELTA_RQ_STAGE2_NO_SLIDING",
            "module": "Retry Stage-2 query enumeration",
            "frozenExpected": "Inside bounded Retry region, reuse FineSpan/lattice sliding window enumeration (1..max) for legal RAW_RECALL queries",
            "actualBehavior": "routeModel3Retry emits one query per RetryRegionLocalSpan only; never calls buildLexicalWindowQueries at Stage-2",
            "exactCodeLocation": "electron_node/.../model3-retry-router.ts for(local of localSpans){ windowText=slice(local); recall(...) }",
            "classification": "RUNTIME_ARCHITECTURE_DRIFT",
            "severity": "HIGH",
            "consumerImpact": "Multi-syllable lexical units spanning adjacent first-pass FineSpans cannot be expressed when Stage-2 only sees non-overlapping localSpans; regional lattice Stage-1 windows are discarded at Stage-2 boundary",
            "minimalCorrectionDirection": "DELETE localSpan-only assumption; REUSE buildLexicalWindowQueries / buildWindowDescriptorForRange on region syllable slice; dedup via utterance cache; still ONE Retry operation; no KEEP widen",
            "acpRequired": "NO",
            "developmentUnit": 1,
        },
        {
            "deltaId": "DELTA_RQ_FALLBACK_BOUNDARY_LOCK",
            "module": "Retry fallback local spans",
            "frozenExpected": "On lattice failure, still reinterpret bounded region (not lock to original FineSpan boundaries)",
            "actualBehavior": "fallbackRegionLocalSpans copies first-pass PathFineSpan raw/syllable bounds for region.sourceSpanIds",
            "exactCodeLocation": "electron_node/.../model3-retry-region-resegment.ts fallbackRegionLocalSpans; used when resegment ok=false or empty",
            "classification": "RUNTIME_ARCHITECTURE_DRIFT",
            "severity": "HIGH",
            "consumerImpact": "OLD_BOUNDARY_LOCK: same-boundary Recall when lattice fails — contradicts Retry purpose",
            "minimalCorrectionDirection": "DELETE fallback as Stage-2 query authority; REUSE region-slice window enumeration (same helper as Unit #1) without requiring successful lattice paths",
            "acpRequired": "NO",
            "developmentUnit": 2,
        },
    ]

    retracted = [
        {
            "issueId": "CLAIM_KEEP_ON_LOCUS_IS_ARCHITECTURE_DRIFT",
            "priorLabel": "often bundled with Query Geometry",
            "correctClass": "MODEL_QUALITY_FAILURE",
            "productionIssue": "NO",
            "status": "RETRACTED_AS_ARCHITECTURE_DRIFT",
            "note": "Packer/mapping/Anchor mask OK; locus spans correctly KEEP → deriveRetryRegions correctly excludes. Not Retry SSOT violation.",
        },
        {
            "issueId": "CLAIM_KEEP_BARRIER_IS_BUG",
            "priorLabel": "REGION_TOO_NARROW framed as deriveRetryRegions defect",
            "correctClass": "EXPECTED_MODEL_ERROR_OR_QUALITY",
            "productionIssue": "NO",
            "status": "RETRACTED",
            "note": "KEEP flush is frozen SSOT. Do not expand into unrelated KEEP by default.",
        },
        {
            "issueId": "CLAIM_UTTERANCE_SINGLETON_DOMAIN_VOTE_REQUIRED",
            "priorLabel": "assumed utterance singleton",
            "correctClass": "DOCUMENT_SSOT_DRIFT",
            "productionIssue": "NO",
            "status": "RETRACTED",
            "note": "Lattice FROZEN voteScope=per_path. Path-local is MATCH.",
        },
        {
            "issueId": "CLAIM_PREFERRED_PATH_ACTIVE",
            "priorLabel": "single preferred regional path",
            "correctClass": "ALREADY_FIXED",
            "productionIssue": "NO",
            "status": "RETRACTED_ACTIVE",
            "note": "collectLocalSpansFromRetainedPathViews unions all views.",
        },
        {
            "issueId": "CLAIM_SECOND_DOMAIN_VOTE_RETRY",
            "priorLabel": "second Domain Vote",
            "correctClass": "ABSENT",
            "productionIssue": "NO",
            "status": "RETRACTED",
            "note": "trace secondDomainVote=false; completeFromVote same vote",
        },
        {
            "issueId": "CLAIM_SECOND_MODEL3_STAGE",
            "priorLabel": "recursive Model3",
            "correctClass": "ABSENT",
            "productionIssue": "NO",
            "status": "RETRACTED",
            "note": "routeModel3Retry does not re-infer",
        },
        {
            "issueId": "CLAIM_RECURSIVE_RETRY_OR_ASR_RERUN",
            "priorLabel": "recursive Retry / ASR",
            "correctClass": "ABSENT",
            "productionIssue": "NO",
            "status": "RETRACTED",
            "note": "attemptedSpanIds guard; no ASR rerun",
        },
        {
            "issueId": "CLAIM_LEXICON_PREVALENCE_ZERO",
            "priorLabel": "post-minimality share 0.0",
            "correctClass": "AUDIT_SEMANTIC_DRIFT",
            "productionIssue": "NO",
            "status": "RETRACTED_AS_PRODUCTION_CONCLUSION",
            "note": "Out-of-lexicon identity unresolved; existence may remain PROVEN_GENERAL from prior evidence; prevalence UNRESOLVED",
        },
        {
            "issueId": "CLAIM_SURFACE_STRUCTURAL_FAMILIES_89_56_52",
            "priorLabel": "mechanism:norm(target) families",
            "correctClass": "AUDIT_SEMANTIC_DRIFT",
            "productionIssue": "NO",
            "status": "SUPERSEDED",
            "note": "Surface diversity ≠ structural independence",
        },
        {
            "issueId": "CLAIM_RECALL_PROVEN_GENERAL_FROM_SURFACES",
            "priorLabel": "freeze wrote PROVEN_GENERAL",
            "correctClass": "DOCUMENT_SSOT_DRIFT",
            "productionIssue": "NO",
            "status": "CORRECTED_TO_PROVEN_LOCAL",
            "note": "Authoritative RECALL_MISS_EXISTENCE=PROVEN_LOCAL after minimality",
        },
        {
            "issueId": "CLAIM_NO_PRIMARY_TARGET_MAP_AS_RUNTIME",
            "priorLabel": "NO_REPAIRABLE_TARGET from map miss",
            "correctClass": "AUDIT_SEMANTIC_DRIFT",
            "productionIssue": "NO",
            "status": "FIXED_IN_AUDIT",
            "note": "TARGET_SCOPE_NOT_EVALUATED correction",
        },
        {
            "issueId": "CLAIM_REFERENCE_DIFF_EQUALS_LEXICAL_TARGET",
            "priorLabel": "Lexicon148 invalid prevalence",
            "correctClass": "AUDIT_SEMANTIC_DRIFT",
            "productionIssue": "NO",
            "status": "FIXED_IN_AUDIT",
            "note": "REFERENCE_DIFF_REGION ≠ LEXICAL_TARGET frozen",
        },
        {
            "issueId": "CLAIM_70PCT_SYSTEM_ERROR_PREVALENCE",
            "priorLabel": "166/237 as overall error share",
            "correctClass": "TEST_METRIC_DRIFT",
            "productionIssue": "NO",
            "status": "RETRACTED_AS_SYSTEM_PREVALENCE",
            "note": "Share is among lexically-evaluable repair events only",
        },
        {
            "issueId": "CLAIM_ASSEMBLY_KENLM_PRIMARY_OWNERS",
            "priorLabel": "downstream primary",
            "correctClass": "AUDIT_ONLY",
            "productionIssue": "NO",
            "status": "NOT_SUPPORTED_AS_PRIMARY",
            "note": "POST_RECALL/ASSEMBLY not supported; KenLM LIMITED",
        },
        {
            "issueId": "CLAIM_CONTINUE_CAUSAL_LOCALIZATION_AS_NEXT_BASELINE",
            "priorLabel": "next=CAUSAL_LOCALIZATION_COMPLETION",
            "correctClass": "AUDIT_PROCESS_DRIFT",
            "productionIssue": "NO",
            "status": "SUPERSEDED_BY_THIS_RECONCILIATION",
            "note": "Stop incremental drift-chasing; restore SSOT baseline first via Stage-2 unit",
        },
    ]

    plan = [
        {
            "unitId": 1,
            "name": "MODEL3_RETRY_STAGE2_SSOT_RESTORATION",
            "singleVariable": "Stage-2 query enumeration source: localSpan-only → region-slice sliding windows (reuse existing builder)",
            "primaryOwner": "routeModel3Retry / buildLexicalWindowQueries",
            "files": "model3-retry-router.ts; build-lexical-window-queries.ts; window-construction-core.ts; provenance side-channel",
            "mustNotTouch": "Model3 weights; deriveRetryRegions KEEP barrier; Domain Vote; Recall thresholds; Lexicon; Assembly; KenLM; JobResult",
            "beforeTrace": "regional lattice windows exist OR region syllable slice available; Stage-2 query set == localSpans only",
            "afterTrace": "same region bounds; Stage-2 query set includes sliding windows within region; Anchor/KEEP barriers unchanged",
            "acceptance": "architectural zeros (anchorCross=0, secondVote=0, secondModel3=0, recursiveRetry=0, asrRerun=0, pool<=16) + semantic window consumption proof; dialog_200 not sole gate",
            "acp": "NO",
            "dependsOn": "NONE",
        },
        {
            "unitId": 2,
            "name": "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_REMOVAL",
            "singleVariable": "fallback Stage-2 query authority: first-pass FineSpan copy → region-slice windows",
            "primaryOwner": "model3-retry-region-resegment fallback",
            "files": "model3-retry-region-resegment.ts (+ shared window helper from unit1)",
            "mustNotTouch": "Model3; KEEP barrier; successful-lattice path (already multipath)",
            "beforeTrace": "resegmentOk=false → localSpanSource=FALLBACK → queries==first-pass FineSpan bounds",
            "afterTrace": "resegmentOk=false → queries from region-slice windows; not original FineSpan lock",
            "acceptance": "OLD_BOUNDARY_LOCK count → 0 on lattice-fail controls; no KEEP/Anchor cross",
            "acp": "NO",
            "dependsOn": "Prefer after or sharing helper with unit1; do not merge Model3 quality",
        },
        {
            "unitId": 3,
            "name": "MODEL3_TRIGGER_QUALITY_AUDIT",
            "singleVariable": "Model3 KEEP/RETRY quality on non-anchor FineSpans (no architecture change)",
            "primaryOwner": "Model3 training/eval — NOT Retry geometry",
            "files": "training/eval only unless mapping bug found",
            "mustNotTouch": "Retry region barrier; Stage-2 windows; Lexicon from heldout",
            "beforeTrace": "KEEP_ON_LOCUS rates with packer/mapping verified correct",
            "afterTrace": "quality metrics only if model change later (separate phase)",
            "acceptance": "Separate from Units 1–2; YES separate Model3 quality from Retry code",
            "acp": "NO for audit; ACP if role/input modality changes",
            "dependsOn": "After Units 1–2 restore geometry baseline",
        },
    ]

    counts = {
        "runtimeArchitectureDrift": 2,
        "runtimeImplementationBug": 0,
        "staleCode": 0,
        "duplicatedProductionLogic": 2,
        "auditSemanticDrift": 5,
        "testMetricDrift": 1,
        "documentSsotDrift": 3,
        "modelQualityFailure": 1,
        "unresolved": 1,
    }
    # unresolved = trace completeness gap

    answers = {
        "D1": "YES — KEEP|RETRY only",
        "D2": "NO — does not query Lexicon/generate text/vote domain/create spans",
        "D3": "NO — does not override KEEP; KEEP breaks merge",
        "D4": "NO — Anchor masked + skipped",
        "D5": "NO by default — KEEP flush",
        "D6": "YES — one bounded Retry operation / path step",
        "D7": "NO",
        "D8": "NO",
        "D9": "NO post-Retry Model3; one STAGE evaluates multipath via path loop",
        "D10": "NO",
        "D11": "YES — once per retained path",
        "D12": "YES — multipath regional views unioned",
        "D13": "YES upstream lattice windows; path FineSpans non-overlapping by design",
        "D14": "First lost at Retry Stage-2 consumer: regional Stage-1 windows not re-enumerated for RAW_RECALL",
        "D15": "NO",
        "D16": "YES — fallbackRegionLocalSpans",
        "D17": "YES — both RUNTIME_ARCHITECTURE_DRIFT",
        "D18": "NO",
        "D19": "MODEL_QUALITY_FAILURE (or EXPECTED_MODEL_ERROR)",
        "D20": "NO evidence of packer/mapping SSOT violation",
        "D21": "YES — Recall intact; do not retune to hide geometry",
        "D22": "NO — not active causal owner for current Query Geometry cohort",
        "D23": "NO — LIMITED only",
        "D24": 2,
        "D25": ["DELTA_RQ_STAGE2_NO_SLIDING", "DELTA_RQ_FALLBACK_BOUNDARY_LOCK"],
        "D26": 12,
        "D27": [
            "KEEP_ON_LOCUS as architecture drift",
            "KEEP barrier as bug",
            "utterance singleton Domain Vote required",
            "preferred-path active",
            "second Domain Vote / Model3 / recursive / ASR",
            "Lexicon prevalence=0",
            "surface families as structural proof",
            "Recall PROVEN_GENERAL from surfaces",
            "70% as system prevalence",
            "continue causal-localization as baseline next",
        ],
        "D28": "Lattice FROZEN + MODEL3_ARCHITECTURE_CONTRACT_V1 + SYNTHETIC_V1_FROZEN + retry/anchor/input/output contracts",
        "D29": "retry 'not enabled' matrix note; ≤1 inference/utterance literal; TTS next-phase docs; many S3 audits as architecture SSOT",
        "D30": "model3_v2_s3_*_freeze_state.csv / corrected_freeze_state / retry_query_freeze_state — evidence status only",
        "D31": "YES — barrier split; query-key formula copy; Stage-1 vs Stage-2 enum divergence",
        "D32": "YES — delete localSpan-only + fallback lock; reuse buildLexicalWindowQueries",
        "D33": "NO for active deltas (SSOT restoration)",
        "D34": "MODEL3_RETRY_STAGE2_SSOT_RESTORATION (design then develop)",
        "D35": "Stage-2 query enumeration source only",
        "D36": "before: Stage-2 queries==localSpans; after: Stage-2 consumes region-slice sliding windows; barriers unchanged",
        "D37": "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_REMOVAL (unit2)",
        "D38": "YES",
        "D39": "NO",
        "D40": NEXT,
    }

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": VERDICT,
        "nextPhase": NEXT,
        "authoritativeSsot": [
            "docs/fw-detector/freeze/FROZEN.md (Lattice V1.0.0)",
            "MODEL3_ARCHITECTURE_CONTRACT_V1.md",
            "MODEL3_SYNTHETIC_V1_FROZEN.md",
            "model3_retry_contract_v1.md",
            "companion anchor/input/output contracts",
        ],
        "activeProductionDeltas": active_deltas,
        "activeProductionDeltaCount": 2,
        "driftCounts": counts,
        "ownership": ownership,
        "answers": answers,
        "callGraph": (
            "ASR→FineSpan lattice(windows1..5)→pathFineSpanViews→"
            "Model2→path Domain Vote→Anchors→Model3 KEEP/RETRY→"
            "deriveRetryRegions→resegment(lattice|fallback)→"
            "Stage-2 localSpan queries→recallSpanTopKV2→merge→"
            "Assembly(same vote)→CrossPath≤16→KenLM→Apply→JobResult"
        ),
        "semanticContinuityFirstLoss": "Retry Stage-2 (RAW_RECALL) discards sliding-window semantics present in regional lattice Stage-1",
        "implementationAllowedThisPhase": False,
        "acpRequired": False,
        "a1PromotionReady": False,
        "firstCausalOwner": "NOT_YET_ISOLATED — geometry deltas ≠ Model3 quality",
    }

    write_csv(DOCS / "model3_architecture_authority_map.csv", authority)
    write_csv(DOCS / "model3_current_vs_ssot.csv", current_vs_ssot)
    write_csv(DOCS / "model3_active_production_deltas.csv", active_deltas)
    write_csv(DOCS / "model3_retracted_and_audit_only_issues.csv", retracted)
    write_csv(DOCS / "model3_control_variable_plan.csv", plan)
    (DOCS / "model3_reconciliation_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    report = f"""# Lingua — Model3 Architecture Reconciliation / Drift Closure Audit

Generated: {GENERATED}  
Phase: `{PHASE}`  
Mode: READ-ONLY — no production / training / architecture change

================================
EXECUTIVE VERDICT
=================

**{VERDICT}**

Next phase (exactly one): `{NEXT}`

**Authoritative baseline restored as documents + ownership map + 2 production deltas.**  
Stop incremental causal-debug chasing. Do not treat S3 audit freezes as competing architecture SSOT.

Active production deltas: **2**  
Retracted / audit-only / model-quality claims: **15** (see CSV)

================================
SSOT AUTHORITY MAP
==================

Authority order enforced:

1. User-approved / explicitly frozen business architecture (Lattice + Model3 contracts)
2. Explicit ACP approved by user
3. Later implementation consistent with 1/2 (mainline integration; multipath Retry fix)
4. Current production code
5. Tests
6. Comments / local docs
7. Audit-only tooling / metrics

See `model3_architecture_authority_map.csv`.

**ONE architecture SSOT stack:** Lattice FROZEN + `MODEL3_ARCHITECTURE_CONTRACT_V1` + `MODEL3_SYNTHETIC_V1_FROZEN` + `model3_retry_contract_v1` (+ anchor/input/output).

Recent `model3_v2_s3_*_freeze_state.csv` files: **EVIDENCE_ONLY** — may record measurements; must not redefine KEEP barrier, Domain Vote scope, or Model3 role.

================================
FROZEN ARCHITECTURE CHECK
=========================

| Gate | Result |
|------|--------|
| Model3 KEEP/RETRY only | PASS |
| No Model3 Lexicon/Recall/text repair | PASS |
| One Model3 STAGE (multipath ok); no Retry re-infer | PASS |
| One Domain Vote / path; no Retry re-vote | PASS |
| One bounded Retry; no recursive; no ASR rerun | PASS |
| No Anchor / unrelated KEEP cross by default | PASS |
| Multipath regional views | PASS (preferred-path removed) |
| Candidate pool ≤16 | PASS |
| JobResult transport-only | PASS |
| Stage-2 sliding windows | **FAIL — ACTIVE DELTA** |
| Fallback non-locking reinterpretation | **FAIL — ACTIVE DELTA** |

================================
CURRENT RETRY / MODEL3 CALL GRAPH
=================================

```text
{summary['callGraph']}
```

Semantic continuity first loss: **{summary['semanticContinuityFirstLoss']}**

Producer→consumer example:

| Boundary | Producer guarantee | Consumer transformation | Preserved? |
|----------|--------------------|-------------------------|------------|
| Lattice Stage-1 → PathFineSpan | Sliding windows 1..5 → edges → paths | Path FineSpans **non-overlapping** segmentation | Windows consumed into edges; path is segmentation SSOT |
| Regional resegment → Stage-2 | Lattice again builds windows on slice | Stage-2 queries **localSpans only** | **DISCARDED** at Stage-2 |
| Fallback | Region bounds known | Copy first-pass FineSpan bounds | **REINTERPRETED as lock** |

================================
RESPONSIBILITY / OWNERSHIP MAP
==============================

See ownership rows in summary JSON / implied by `model3_current_vs_ssot.csv`.

Notable: query enumeration **WRONG_OWNER** (should reuse window builder); barrier / query-key **DUPLICATED_OWNERSHIP** (mild).

================================
CURRENT VS SSOT TABLE
=====================

See `model3_current_vs_ssot.csv` (required area table).

================================
DRIFT CLASSIFICATION COUNTS
===========================

| Category | Count |
|----------|------:|
| runtimeArchitectureDrift | {counts['runtimeArchitectureDrift']} |
| runtimeImplementationBug | {counts['runtimeImplementationBug']} |
| staleCode | {counts['staleCode']} |
| duplicatedProductionLogic | {counts['duplicatedProductionLogic']} |
| auditSemanticDrift | {counts['auditSemanticDrift']} |
| testMetricDrift | {counts['testMetricDrift']} |
| documentSsotDrift | {counts['documentSsotDrift']} |
| modelQualityFailure | {counts['modelQualityFailure']} |
| unresolved | {counts['unresolved']} |

Only the first four justify production correction. Active backlog uses **runtimeArchitectureDrift=2**.

================================
HISTORICAL DRIFT RECONCILIATION
===============================

| Claim | Production? | Class | Status |
|-------|-------------|-------|--------|
| Stage-2 no sliding | YES | RUNTIME_ARCHITECTURE_DRIFT | ACTIVE |
| Fallback FineSpan lock | YES | RUNTIME_ARCHITECTURE_DRIFT | ACTIVE |
| KEEP_ON_LOCUS | NO | MODEL_QUALITY_FAILURE | SEPARATE track |
| preferred-path | NO | ALREADY_FIXED | CLOSED |
| second Domain Vote / Model3 / recursive / ASR | NO | ABSENT | CLOSED |
| Lexicon circular / Lex148 | NO | AUDIT_SEMANTIC_DRIFT | FIXED in audit |
| surface families | NO | AUDIT_SEMANTIC_DRIFT | SUPERSEDED |
| Recall LOCAL/GENERAL conflict | NO | DOCUMENT_SSOT_DRIFT | CORRECTED LOCAL |
| NO_PRIMARY_TARGET_MAP | NO | AUDIT_SEMANTIC_DRIFT | FIXED |
| ref region = lexical target | NO | AUDIT_SEMANTIC_DRIFT | FIXED |
| 70% system prevalence | NO | TEST_METRIC_DRIFT | RETRACTED |
| utterance singleton Vote | NO | DOCUMENT_SSOT_DRIFT | RETRACTED |

================================
MODEL3 KEEP AUDIT
=================

Trace: FineSpan exists → correct path → non-Anchor → packer → infer → map by spanId → KEEP.

**Architecture contracts: OK.**  
Classification: **MODEL_QUALITY_FAILURE** (not RUNTIME_ARCHITECTURE_DRIFT).  
Do **not** modify KEEP barrier or Model3 role this phase. Separate Unit #3 later.

================================
RETRY STAGE-2 / FALLBACK
========================

D15 NO sliding at Stage-2 → **RUNTIME_ARCHITECTURE_DRIFT**.  
D16 fallback restores old FineSpan bounds → **RUNTIME_ARCHITECTURE_DRIFT**.

================================
ACTIVE PRODUCTION DELTAS
========================

Exactly **2** — see `model3_active_production_deltas.csv`.

1. `DELTA_RQ_STAGE2_NO_SLIDING`  
2. `DELTA_RQ_FALLBACK_BOUNDARY_LOCK`

No ACP required (SSOT restoration / deletion+reuse).

================================
RETRACTED / AUDIT-ONLY
=====================

See `model3_retracted_and_audit_only_issues.csv`.

================================
CONTROL-VARIABLE PLAN
=====================

See `model3_control_variable_plan.csv`.

| Unit | Variable | ACP |
|------|----------|-----|
| #1 Stage-2 SSOT restoration | query enum source only | NO |
| #2 Fallback lock removal | fallback query authority only | NO |
| #3 Model3 quality audit | model quality only | NO for audit |

**Do not combine** Model3 trigger correction with Retry query correction.

================================
DOCUMENT / FREEZE CLEANUP
=========================

| Item | Action |
|------|--------|
| Lattice + Model3 contracts | RETAIN AUTHORITATIVE |
| S3 freeze_state CSVs | DEMOTED_TO_EVIDENCE_ONLY |
| matrix "retry not enabled" | SUPERSEDED / STALE |
| "≤1 inference/utterance" literal | STALE_WORDING → STAGE language |
| S3 audit MDs as architecture | DEMOTED AUDIT_ONLY |

================================
CODE SIMPLICITY
===============

| Item | Action |
|------|--------|
| Stage-2 localSpan-only loop | DELETE assumption / REUSE window builder |
| fallbackRegionLocalSpans as query source | DELETE |
| query-key formula copy | REUSE window-construction-core |
| barrier dual sites | KEEP for now (optional later collapse) |
| preferred-path | already DELETED |
| config flags for frozen arch | ABSENT — do not add |

No new RepairManager / GeometryCoordinator / second query service.

================================
NEXT PHASE
==========

`{NEXT}`

Exactly one. Design-only next; this phase implements nothing.

---

## D1–D40

{json.dumps(answers, ensure_ascii=False, indent=2)}
"""
    (DOCS / "Lingua_Model3_Architecture_Reconciliation_Audit.md").write_text(
        report, encoding="utf-8"
    )
    print(json.dumps({"verdict": VERDICT, "nextPhase": NEXT, "activeDeltas": 2}, indent=2))


if __name__ == "__main__":
    main()
