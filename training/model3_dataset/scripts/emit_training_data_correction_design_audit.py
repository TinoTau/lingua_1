# -*- coding: utf-8 -*-
"""MODEL3_V2_LOCALIZATION_TRAINING_DATA_CORRECTION_DESIGN_AUDIT — emit artifacts only."""
from __future__ import annotations

import csv
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"

# Authoritative measurements (this phase)
S3_RETRY_TAIL_SHARE = 0.0585
S3_CAND_NZ_RATE = 0.6491
LABELED_RETRY_TAIL_SHARE_SAMPLE = 0.1118  # [0.9,1.0) in 2k sample; mid bins dominate
LABELED_CAND_NZ_RATE = 0.0
PRIOR_CLAIMED_TAIL = 0.6438
PRIOR_CLAIMED_CAND_NZ = 0.0

VERDICT = "MODEL3_TRAINING_DATA_CORRECTION_DESIGN_EVIDENCE_INSUFFICIENT"
NEXT = "MODEL3_V2_TRAINING_DATA_PIPELINE_TRACE_COMPLETENESS_AUDIT"


def wcsv(path: Path, rows: list[dict]):
    if not rows:
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    pipeline = [
        {
            "stageId": "S0_ENTRY",
            "owner": "run_production_core_s3_build.py",
            "function": "main / freeze_phase / materialize_phase / finalize_phase",
            "produces": "MODEL3_V2_PRODUCTION_CORE_S3 shards",
            "matchesB2": "YES",
            "notes": "Authoritative S3 entry; train_s3_random.py consumes this dir",
        },
        {
            "stageId": "S1_SOURCE_SELECT",
            "owner": "run_production_core_s3_build.py + select_pool_candidates",
            "function": "select_new_references / select_pool_candidates",
            "produces": "referenceText + semanticFamilyId + split",
            "matchesB2": "YES",
            "notes": "semanticFamilyId split lock via family_identity.assign_split",
        },
        {
            "stageId": "S2_TTS",
            "owner": "acoustic_training/audio_materializer.py",
            "function": "materialize_audio",
            "produces": "fixed Piper TTS PCM",
            "matchesB2": "YES",
            "notes": "TTS materialization only; no multi-speaker/prosody aug",
        },
        {
            "stageId": "S3_ASR_FW",
            "owner": "orchestrator.py FasterWhisperClient",
            "function": "transcribe_pcm16",
            "produces": "rawActualAsrText + tone slices",
            "matchesB2": "YES",
            "notes": "ASR errors create natural malformed regions",
        },
        {
            "stageId": "S4_LATTICE",
            "owner": "offline_harness/acoustic_b2_formal_materialize.cjs",
            "function": "materialize / runLatticeFineSpanGeneration",
            "produces": "FineSpan paths + Recall candidates",
            "matchesB2": "YES",
            "notes": "fuzzyRecallEnabled=true; production Recall owner",
        },
        {
            "stageId": "S5_MODEL2",
            "owner": "acoustic_b2_formal_materialize.cjs",
            "function": "expandActiveCandidatesWithModel2",
            "produces": "expanded candidates per path",
            "matchesB2": "YES",
            "notes": "await real Model2; MODEL2_RUNTIME_DISABLED popped",
        },
        {
            "stageId": "S6_DOMAIN_ANCHOR",
            "owner": "acoustic_b2_formal_materialize.cjs",
            "function": "voteUtteranceDomainFromPool + materializeModel3Anchors",
            "produces": "path-local Domain Vote + Anchors",
            "matchesB2": "YES",
            "notes": "path-local; no second vote",
        },
        {
            "stageId": "S7_PACKER",
            "owner": "model3-feature-pack.ts",
            "function": "packModel3SpanInferFields / model3FirstPassCandidateCount",
            "produces": "firstPassCandidateCount + pinyinChannelAvail",
            "matchesB2": "YES",
            "notes": "SSOT half-pack; span_rel_position computed later in loader",
        },
        {
            "stageId": "S8_LABEL",
            "owner": "scripts/stage2_v2_label.py",
            "function": "label_spans_v2 / derive_malformed_regions",
            "produces": "KEEP/RETRY via ASR≠ref SequenceMatcher regions",
            "matchesB2": "YES",
            "notes": "corruptions=[] on S3 path; no synthetic placement",
        },
        {
            "stageId": "S9_SERIALIZE",
            "owner": "acoustic_training/serializer.py",
            "function": "serialize_path_samples / extract_first_pass_candidate_count",
            "produces": "MODEL3_TRAINING_SAMPLE_V1 JSONL",
            "matchesB2": "YES",
            "notes": "fail-closed if cand field missing; true zero allowed",
        },
        {
            "stageId": "S10_TRAIN_LOADER",
            "owner": "train/bigru_v1.py",
            "function": "span_features / sample_to_tensors",
            "produces": "6-D feature tensors",
            "matchesB2": "PARTIAL",
            "notes": "duplicates production host packing; None→0 default exists but S3 fields present",
        },
        {
            "stageId": "ALT_LABELED",
            "owner": "scripts/run_v2_dataset_build.py",
            "function": "relabel_sample_v2",
            "produces": "model3_v2_labeled shards",
            "matchesB2": "NO",
            "notes": "TEXT RELABEL ONLY — no ASR/Recall/Model2; cand collapsed; NOT S3 SSOT",
        },
        {
            "stageId": "ALT_REALDIST",
            "owner": "scripts/build_v2_realdist_expanded.py",
            "function": "make_1char_spans",
            "produces": "realdist expanded samples",
            "matchesB2": "NO",
            "notes": "HARDCODES firstPassCandidateCount=0",
        },
    ]
    wcsv(DOCS / "model3_v2_training_pipeline_trace.csv", pipeline)

    position = [
        {
            "funnelStage": "prior_audit_histogram",
            "retryTailShare": PRIOR_CLAIMED_TAIL,
            "datasetMeasured": "model3_v2_labeled (WRONG)",
            "biasPresent": "YES",
            "ownerCandidate": "PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH",
            "isFirstFailingOwner": "YES",
            "notes": "Causality audit TRAIN_DIR pointed at labeled; not MODEL3_V2_PRODUCTION_CORE_S3",
        },
        {
            "funnelStage": "authoritative_S3_final_shard",
            "retryTailShare": S3_RETRY_TAIL_SHARE,
            "datasetMeasured": "model3_v2_production_core_s3/train",
            "biasPresent": "NO",
            "ownerCandidate": "NONE",
            "isFirstFailingOwner": "NO",
            "notes": "[0.9,1.0)=5.85%; early bins 14.1/12.2/11.9% — no catastrophic tail concentration",
        },
        {
            "funnelStage": "S3_malformed_region_placement",
            "retryTailShare": "",
            "datasetMeasured": "stage2_v2_label.derive_malformed_regions",
            "biasPresent": "NO_SYNTHETIC_TAIL_INJECTION",
            "ownerCandidate": "ASR_NATURAL_ERROR_PLACEMENT",
            "isFirstFailingOwner": "NO",
            "notes": "corruptions=[]; regions from SequenceMatcher(current ASR, reference)",
        },
        {
            "funnelStage": "S3_label_projection",
            "retryTailShare": "",
            "datasetMeasured": "label_spans_v2",
            "biasPresent": "NOT_PROVEN",
            "ownerCandidate": "NONE",
            "isFirstFailingOwner": "NO",
            "notes": "REGION_BOUNDED_FULL_COVERAGE; projects RETRY onto overlapping FineSpans",
        },
        {
            "funnelStage": "S3_filtering_merge",
            "retryTailShare": S3_RETRY_TAIL_SHARE,
            "datasetMeasured": "finalize_phase write_split_shards",
            "biasPresent": "NO",
            "ownerCandidate": "NONE",
            "isFirstFailingOwner": "NO",
            "notes": "Final train shard already non-tail-biased",
        },
        {
            "funnelStage": "labeled_alt_pipeline",
            "retryTailShare": LABELED_RETRY_TAIL_SHARE_SAMPLE,
            "datasetMeasured": "model3_v2_labeled sample",
            "biasPresent": "YES_MID_DOMINATED",
            "ownerCandidate": "CORRUPTION_PLACEMENT_BIAS / SOURCE_TEMPLATE_POSITION_BIAS",
            "isFirstFailingOwner": "YES_FOR_LABELED_ONLY",
            "notes": "Synthetic phonetic + template wrap; NOT used by train_s3_random",
        },
    ]
    wcsv(DOCS / "model3_v2_position_bias_sources.csv", position)

    cand = [
        {
            "funnelStage": "production_runtime",
            "valueState": "NONZERO_OBSERVED",
            "owner": "model3FirstPassCandidateCount(span.candidates.filter !isCovered)",
            "file": "electron_node/.../model3-feature-pack.ts",
            "firstLoss": "NO",
            "notes": "14/30 localization spans nonzero in prior capture",
        },
        {
            "funnelStage": "S3_formal_harness",
            "valueState": "NONZERO_WRITTEN",
            "owner": "acoustic_b2_formal_materialize.cjs → packModel3SpanInferFields",
            "file": "training/.../acoustic_b2_formal_materialize.cjs",
            "firstLoss": "NO",
            "notes": "Writes recallEvidence.firstPassCandidateCount from real lattice",
        },
        {
            "funnelStage": "S3_serializer",
            "valueState": "PRESERVED_FAIL_CLOSED",
            "owner": "extract_first_pass_candidate_count",
            "file": "acoustic_training/serializer.py",
            "firstLoss": "NO",
            "notes": "Missing field → RECALL_STATE_INVALID; true 0 allowed",
        },
        {
            "funnelStage": "S3_final_shard",
            "valueState": f"NZ_RATE={S3_CAND_NZ_RATE:.4f}",
            "owner": "MODEL3_V2_PRODUCTION_CORE_S3",
            "file": "model3_v2_production_core_s3/train/shard-000.jsonl",
            "firstLoss": "NO",
            "notes": "cand hist ~ {0:131194,1:240086,2:2609}; gap NOT present",
        },
        {
            "funnelStage": "S3_train_loader",
            "valueState": "READS_RECALL_EVIDENCE",
            "owner": "span_features",
            "file": "train/bigru_v1.py",
            "firstLoss": "NO_ON_S3",
            "notes": "None→0 default exists but S3 always has field; would collapse unlabeled/missing",
        },
        {
            "funnelStage": "prior_audit_measurement",
            "valueState": "ALL_ZERO",
            "owner": "audit_model3_v2_localization_training_causality.py TRAIN_DIR",
            "file": "scripts/audit_model3_v2_localization_training_causality.py",
            "firstLoss": "YES_MEASUREMENT",
            "notes": "Indexed model3_v2_labeled → claimed training cand NZ=0",
        },
        {
            "funnelStage": "labeled_builder",
            "valueState": "ALL_ZERO",
            "owner": "run_v2_dataset_build / relabel_sample_v2",
            "file": "scripts/run_v2_dataset_build.py",
            "firstLoss": "YES_FOR_LABELED",
            "notes": "No Recall/Model2 materialization; inherits/zeros cand",
        },
        {
            "funnelStage": "realdist_expanded",
            "valueState": "HARDCODED_0",
            "owner": "make_1char_spans",
            "file": "scripts/build_v2_realdist_expanded.py:120",
            "firstLoss": "YES_EXPLICIT_DEFAULT",
            "notes": "Explicit trainingBug: firstPassCandidateCount=0",
        },
    ]
    wcsv(DOCS / "model3_v2_candidate_feature_trace.csv", cand)

    gates = [
        {
            "gateId": "G0",
            "name": "dataset_identity_source_integrity",
            "hardSoft": "HARD",
            "metric": "datasetId==expected AND train path binds production_core_s3 AND checksum/manifest present",
            "threshold": "exact match MODEL3_V2_PRODUCTION_CORE_S3 lineage",
            "rationale": "Prior causality measured wrong dataset; bind SSOT path",
            "wouldCatchPriorDefect": "YES",
        },
        {
            "gateId": "G1",
            "name": "semantic_family_split_integrity",
            "hardSoft": "HARD",
            "metric": "no semanticFamilyId appears in >1 split",
            "threshold": "0 cross-split families",
            "rationale": "Preserve frozen split lock; materializationRunId not split key",
            "wouldCatchPriorDefect": "NO",
        },
        {
            "gateId": "G2",
            "name": "feature_contract_parity",
            "hardSoft": "HARD",
            "metric": "featureContractIdentity==packModel3SpanInferFields; rawFirstPassCandidateCount present",
            "threshold": "100% spans with explicit cand field",
            "rationale": "serializer fail-closed already; keep as train gate",
            "wouldCatchPriorDefect": "PARTIAL",
        },
        {
            "gateId": "G3",
            "name": "feature_variance_non_collapse",
            "hardSoft": "HARD",
            "metric": "for EXPECTED_VARIABLE features: uniqueCount>=2 AND (if applicable) nonzeroRate>min",
            "threshold": "first_pass_cand_log1p nonzeroRate>=0.05 among eligible spans; span_rel_position unique>=10",
            "rationale": "Reject labeled-style cand collapse without rejecting legitimate isAnchor=0 on eligible set",
            "wouldCatchPriorDefect": "YES",
        },
        {
            "gateId": "G4",
            "name": "retry_position_distribution_sanity",
            "hardSoft": "HARD",
            "metric": "max_bin_share(RETRY span_rel_position 10 bins); early/mid/late coverage",
            "threshold": "max_single_bin_share<=0.35; each of early[0,.3)/mid[.3,.7)/late[.7,1] has RETRY share>=0.10",
            "rationale": "Detect shortcut risk without forcing uniform 10%; 64% tail would fail; S3 5.85% passes",
            "wouldCatchPriorDefect": "YES_ON_LABELED_TAIL_OR_PRIOR_CLAIM",
        },
        {
            "gateId": "G5",
            "name": "candidate_feature_coverage",
            "hardSoft": "HARD",
            "metric": "count(cand==0)>0 AND count(cand>0)>0 AND max(cand)>=1",
            "threshold": "both zero and nonzero states present; no exact production histogram match required",
            "rationale": "Populate existing feature via real Recall; forbid synthetic cand",
            "wouldCatchPriorDefect": "YES",
        },
        {
            "gateId": "G6",
            "name": "label_semantic_integrity",
            "hardSoft": "HARD",
            "metric": "labels in {KEEP,RETRY,EXCLUDE/MASKED}; REGION_BOUNDED_FULL_COVERAGE",
            "threshold": "contract version MODEL3_LABEL_CONTRACT_V2_20260829",
            "rationale": "Do not redefine RETRY to fix distribution",
            "wouldCatchPriorDefect": "NO",
        },
        {
            "gateId": "G7",
            "name": "class_geometry_coverage",
            "hardSoft": "SOFT",
            "metric": "RETRY present; multi-span utterances; region length diversity",
            "threshold": "advisory; do not inflate RETRY ratio indiscriminately",
            "rationale": "Issue not proven as global class imbalance",
            "wouldCatchPriorDefect": "NO",
        },
        {
            "gateId": "G8",
            "name": "heldout_contamination",
            "hardSoft": "HARD",
            "metric": "dialog_200 case texts / family ids absent from train",
            "threshold": "0 contamination hits",
            "rationale": "Keep dialog_200 acceptance held out",
            "wouldCatchPriorDefect": "NO",
        },
    ]
    wcsv(DOCS / "model3_v2_training_data_gate_design.csv", gates)

    targets = [
        {
            "path": "training/model3_dataset/scripts/audit_model3_v2_localization_training_causality.py",
            "classification": "MUST_MODIFY",
            "currentDefect": "TRAIN_DIR bound to model3_v2_labeled",
            "minimalChange": "Bind to model3_v2_production_core_s3; assert datasetId",
            "whyInsideFrozenArch": "audit-only; restores measurement SSOT",
        },
        {
            "path": "training/model3_dataset/train/train_s3_random.py",
            "classification": "MAY_MODIFY",
            "currentDefect": "none for path; add hard datasetId gate recommended",
            "minimalChange": "G0–G5 pretrain gates",
            "whyInsideFrozenArch": "training entry only",
        },
        {
            "path": "training/model3_dataset/acoustic_training/gate0.py (or new dataset_gates.py)",
            "classification": "MUST_MODIFY",
            "currentDefect": "no G3/G4/G5 position/cand collapse gates at S3 finalize",
            "minimalChange": "implement designed HARD gates before train",
            "whyInsideFrozenArch": "training QA only",
        },
        {
            "path": "training/model3_dataset/scripts/build_v2_realdist_expanded.py",
            "classification": "MUST_MODIFY",
            "currentDefect": "hardcodes firstPassCandidateCount=0",
            "minimalChange": "delete/quarantine from Model3 SSOT; fail if used for S3 lineage",
            "whyInsideFrozenArch": "training-only dead path",
        },
        {
            "path": "training/model3_dataset/scripts/run_v2_dataset_build.py",
            "classification": "MAY_MODIFY",
            "currentDefect": "produces labeled set without Recall/Model2",
            "minimalChange": "mark SUPERSEDED_NOT_MODEL3_SSOT; do not feed audits",
            "whyInsideFrozenArch": "training-only",
        },
        {
            "path": "training/model3_dataset/train/bigru_v1.py span_features",
            "classification": "MAY_MODIFY",
            "currentDefect": "None→0 silent default",
            "minimalChange": "fail-closed when recallFirstPass avail but field missing",
            "whyInsideFrozenArch": "loader parity with serializer; not production",
        },
        {
            "path": "training/model3_dataset/offline_harness/acoustic_b2_formal_materialize.cjs",
            "classification": "DO_NOT_MODIFY",
            "currentDefect": "none for claimed P0 on S3",
            "minimalChange": "none",
            "whyInsideFrozenArch": "already production-equivalent B2",
        },
        {
            "path": "electron_node/.../model3-feature-pack.ts",
            "classification": "DO_NOT_MODIFY",
            "currentDefect": "none",
            "minimalChange": "none — production packer SSOT",
            "whyInsideFrozenArch": "runtime frozen",
        },
        {
            "path": "electron_node/.../run-model3-path-step.ts",
            "classification": "DO_NOT_MODIFY",
            "currentDefect": "none",
            "minimalChange": "none",
            "whyInsideFrozenArch": "production runtime",
        },
        {
            "path": "deriveRetryRegions / FineSpan / Domain Vote / JobResult",
            "classification": "DO_NOT_MODIFY",
            "currentDefect": "none in this phase",
            "minimalChange": "none",
            "whyInsideFrozenArch": "frozen business chain",
        },
        {
            "path": "model3_v2_production_core_s3 shards (in-place feature rewrite)",
            "classification": "DO_NOT_MODIFY",
            "currentDefect": "claimed P0s absent",
            "minimalChange": "DO NOT patch; no rebuild required for false P0",
            "whyInsideFrozenArch": "HARD STOP C",
        },
    ]
    wcsv(DOCS / "model3_v2_training_data_target_files.csv", targets)

    freeze = [
        {"item": "RUNTIME_ARCHITECTURE", "value": "FROZEN", "status": "UNCHANGED"},
        {"item": "MODEL3_V2_S3_RANDOM_INIT_V1", "value": "FROZEN", "status": "UNCHANGED"},
        {"item": "SIX_FEATURES", "value": "FROZEN", "status": "UNCHANGED"},
        {"item": "AUTHORITATIVE_TRAIN_DATASET", "value": "MODEL3_V2_PRODUCTION_CORE_S3", "status": "CONFIRMED"},
        {"item": "PRIOR_P0A_POSITION_BIAS_ON_S3", "value": "NOT_REPRODUCED", "status": "INVALIDATED_MEASUREMENT"},
        {"item": "PRIOR_P0B_CAND_GAP_ON_S3", "value": "NOT_REPRODUCED", "status": "INVALIDATED_MEASUREMENT"},
        {"item": "LABELED_DATASET_STATUS", "value": "SUPERSEDED_NOT_S3_SSOT", "status": "QUARANTINE_RECOMMENDED"},
        {"item": "S3_REBUILD_FOR_CLAIMED_P0", "value": "NOT_JUSTIFIED", "status": "NO_REBUILD"},
        {"item": "ACP", "value": "NO", "status": "FROZEN"},
        {"item": "VERDICT", "value": VERDICT, "status": "FROZEN"},
        {"item": "NEXT_PHASE", "value": NEXT, "status": "PROPOSED_NOT_EXECUTED"},
    ]
    wcsv(DOCS / "model3_v2_training_data_freeze_state.csv", freeze)

    summary = {
        "phase": "MODEL3_V2_LOCALIZATION_TRAINING_DATA_CORRECTION_DESIGN_AUDIT",
        "verdict": VERDICT,
        "nextPhase": NEXT,
        "acpRequired": "NO",
        "positionBiasFirstOwner": "PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH",
        "candidateFeatureFirstOwner": "PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH",
        "labeledPipelineCandOwner": "NO_RECALL_MODEL2_MATERIALIZATION + build_v2_realdist_expanded HARDCODE_0",
        "minimalCorrectionBoundary": "audit/train dataset SSOT binding + HARD gates; NOT S3 shard rebuild; NOT production",
        "fullVsPartialRebuild": "NO_REBUILD_FOR_CLAIMED_P0 — authoritative S3 already production-equivalent for position/cand",
        "authoritativeS3Measurements": {
            "datasetId": "MODEL3_V2_PRODUCTION_CORE_S3",
            "datasetBuildId": "prod_core_s3_build_20260830_v1",
            "retryTailShare_0.9_1.0": S3_RETRY_TAIL_SHARE,
            "candNonzeroRate": S3_CAND_NZ_RATE,
            "candHist": {"0": 131194, "1": 240086, "2": 2609},
        },
        "priorAuditContamination": {
            "measuredPath": "training/model3_dataset/model3_v2_labeled/train",
            "claimedTailShare": PRIOR_CLAIMED_TAIL,
            "claimedCandNz": PRIOR_CLAIMED_CAND_NZ,
            "actualS3TailShare": S3_RETRY_TAIL_SHARE,
            "actualS3CandNz": S3_CAND_NZ_RATE,
        },
        "b2Parity": {
            "Recall": "YES_ON_S3_FORMAL",
            "Model2": "YES_ON_S3_FORMAL",
            "packer": "packModel3SpanInferFields SSOT",
            "duplicateFeatureCalc": "YES — bigru_v1.span_features + inference_host._pack_spans mirror; formal CJS does not duplicate full 6D",
        },
        "gates": [g["gateId"] + ":" + g["name"] for g in gates],
        "governance": {
            "productionCodeChanged": "NO",
            "trainingExecuted": "NO",
            "datasetRebuilt": "NO",
            "modelChanged": "NO",
            "thresholdChanged": "NO",
            "featureContractChanged": "NO",
            "fineSpanChanged": "NO",
            "retryChanged": "NO",
            "recallProductionChanged": "NO",
            "model2ProductionChanged": "NO",
            "domainVoteChanged": "NO",
            "jobResultChanged": "NO",
        },
        "questions": {
            "D1": "run_production_core_s3_build.py → orchestrator → acoustic_b2_formal_materialize.cjs → label_spans_v2 → serializer",
            "D2": "YES for S3 formal path",
            "D3": "Claimed bias appears only when measuring model3_v2_labeled; NOT in S3 final shards",
            "D4_D10_S3": "NO bias at source/corruption/malformed/FineSpan/label/filter/merge for claimed 64% tail",
            "D11": "Prior claimed bias NOT global on S3; labeled bias mid-dominated",
            "D13": "PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH (measurement owner)",
            "D15": "NO new corruption families for S3",
            "D16": "model3FirstPassCandidateCount in model3-feature-pack.ts",
            "D17_S3": "same packer via formal harness → serializer",
            "D17_labeled": "absent/zero without lattice",
            "D18": "Lost at labeled/realdist builders OR prior audit measuring them — NOT at S3 serialize",
            "D19": "YES on S3 formal",
            "D20": "YES on S3 formal",
            "D21": "YES before packer on S3",
            "D22": "Half-pack production packer reused; 6D completed in bigru_v1/loader",
            "D23": "YES duplicate 6D in bigru_v1 vs inference_host",
            "D24_D27": "Zero on labeled: missing materialization; realdist hardcoded; NOT absent Model2 on S3",
            "D28": "Do not synthesize cand; bind audits to S3; quarantine labeled/realdist; optional fail-closed loader",
            "D29": "S3 regenerate possible but NOT required for claimed P0",
            "D30": "NO_REBUILD for claimed P0",
            "D31": "NO mix labeled defective rows",
            "D32": "Keep MODEL3_V2_PRODUCTION_CORE_S3 until true defect proven; any future build gets new datasetBuildId",
            "D33": "packModel3SpanInferFields / FEATURE_CONTRACT unchanged",
            "D34": "G0–G8 as designed",
            "D35": "G3 nonzeroRate floor on first_pass_cand_log1p",
            "D36": "G4 max_single_bin_share<=0.35",
            "D39": "NO exact production matching",
            "D40": "NO uniform bins",
            "D42_D52": "NO changes to labels/features/model/threshold/classWeight/FineSpan/Retry/Recall/Model2/DomainVote/JobResult",
            "D53": "YES — treating model3_v2_labeled as S3 SSOT was implementation/audit drift",
            "D54": "causality audit TRAIN_DIR; dataset gates; quarantine realdist hardcode",
            "D55": "production runtime + formal harness + S3 shard in-place patch forbidden",
            "D56": "YES stay ~10k families",
            "D60": "ACP=NO",
            "D61": "YES one verdict",
            "D62": "YES one next phase",
        },
    }
    (DOCS / "model3_v2_training_data_correction_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    report = f"""# Lingua Model3 V2 Training Data Correction Design Audit (2026-09-02)

Phase: `MODEL3_V2_LOCALIZATION_TRAINING_DATA_CORRECTION_DESIGN_AUDIT`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `{VERDICT}` |
| **position bias first owner** | `PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH` (measured `model3_v2_labeled`, not S3) |
| **candidate-feature first owner** | `PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH` (+ labeled/realdist builders for that alt path) |
| **minimal correction boundary** | Bind audits/training SSOT to `MODEL3_V2_PRODUCTION_CORE_S3`; add HARD gates; quarantine labeled/realdist — **do not rebuild S3 for claimed P0** |
| **full vs partial rebuild** | **NO_REBUILD** for claimed P0-A/P0-B |
| **training gates** | G0–G8 designed (not implemented) |
| **ACP** | **NO** |
| **next phase** | `{NEXT}` (**NOT EXECUTED**) |

### Why evidence is insufficient for an S3 data-correction development phase

Authoritative S3 train (`model3_v2_production_core_s3`, datasetBuildId `prod_core_s3_build_20260830_v1`) does **not** reproduce the frozen claimed defects:

| Claimed P0 | Prior (labeled) | Authoritative S3 |
|---|---:|---:|
| RETRY share in `[0.9,1.0)` | ≈64.38% | **5.85%** |
| `first_pass_cand_log1p` nonzero | 0% | **64.91%** (0/1/2 present) |

`MODEL3_V2_S3_RANDOM_INIT_V1` was trained by `train_s3_random.py` on **production_core_s3**, not `model3_v2_labeled`. The causality audit indexed the wrong directory. Designing an S3 regeneration to “fix” nonexistent S3 collapses would violate HARD STOP C/D and waste the clean B2 pipeline.

## FROZEN ARCHITECTURE

Production chain, path-local Domain Vote, Model3 KEEP/RETRY role, six features, S3 checkpoint, deriveRetryRegions, JobResult: **unchanged**. This phase made **no** code/data/model mutations.

## CURRENT S3 DATA PIPELINE

```
run_production_core_s3_build.py
 → select references (semanticFamilyId split)
 → Piper TTS (fixed)
 → FasterWhisper ASR
 → acoustic_b2_formal_materialize.cjs
      FineSpan+Recall → Model2 expand → Domain Vote → Anchors
      packModel3SpanInferFields
 → label_spans_v2 (corruptions=[], ASR≠ref regions)
 → serializer (fail-closed cand)
 → model3_v2_production_core_s3/{{train,dev,test}}
 → train_s3_random.py
```

See `model3_v2_training_pipeline_trace.csv`.

## EXPECTED B2 DATA PIPELINE

Matches the frozen B2 production-equivalent materialization. TTS is materialization only. No multi-speaker / accent / prosody augmentation.

## ARCHITECTURE DRIFT CHECK

| Item | Status |
|---|---|
| S3 formal harness vs B2 | **ALIGNED** |
| Treating `model3_v2_labeled` as S3 SSOT | **AUDIT DRIFT** (not architecture) |
| Legacy `acoustic_b2_materialize.cjs` / realdist hardcode-0 | **TRAINING-ONLY DEAD/ALT PATHS** — must not define Model3 SSOT |

## POSITION BIAS CAUSAL TRACE

```
claimed 64% tail
 → NOT in S3 final shard (5.85%)
 → NOT from S3 label/filter/merge
 → NOT from S3 malformed placement (ASR alignment, no synthetic tail inject)
 → FIRST FAILING OWNER = prior audit measured model3_v2_labeled
```

On labeled-only: mid-bin domination + synthetic corruption/templates → `CORRUPTION_PLACEMENT_BIAS` / `SOURCE_TEMPLATE_POSITION_BIAS` — **out of S3 SSOT scope**.

## POSITION BIAS BY FAMILY

S3 train shard samples all carry `evidenceSource=FORMAL_FRESH_MATERIALIZATION` and build id `prod_core_s3_build_20260830_v1`. RETRY positions are **early/mid/late populated**; not generator-tail dominated. Claimed global S3 position bias: **NOT PROVEN**.

## CANDIDATE FEATURE CAUSAL TRACE

```
claimed training cand=0
 → NOT S3 shard (64.9% nonzero; hist 0/1/2)
 → S3 serializer fail-closed preserves packer output
 → S3 formal harness runs Recall+Model2+packer
 → FIRST FAILING OWNER (of the claim) = audit TRAIN_DIR=model3_v2_labeled
 → labeled: no lattice → cand collapsed
 → realdist: explicit hardcode 0 at build_v2_realdist_expanded.py:120
```

Production path: `model3FirstPassCandidateCount` = uncovered candidates — **unchanged**.

## RECALL / MODEL2 PARITY

| Component | S3 formal | labeled |
|---|---|---|
| Recall | YES | NO |
| Model2 | YES | NO |
| Domain Vote / Anchors | YES | NO |

## MODEL3 PACKER SSOT

- Production: `packModel3SpanInferFields` / `model3FirstPassCandidateCount`
- S3 formal reuses production packer for cand/pinyin
- Full 6-D: `bigru_v1.span_features` and `model3_inference_host._pack_spans` (duplicated formulas; future single SSOT preferred, not this phase)

## MINIMAL CORRECTION DESIGN

1. **Do not rebuild S3** for claimed P0-A/P0-B.
2. **Hard-bind** all Model3 V2 causality/training audits to `model3_v2_production_core_s3` + `datasetId` assert (G0).
3. **Quarantine** `model3_v2_labeled` and `build_v2_realdist_expanded` from Model3 SSOT.
4. **Implement gates G0–G5 HARD** before any future train (design only now).
5. **Re-run localization causality** on authoritative S3 before any data-correction development.
6. Optional later: fail-closed `span_features` when cand field missing despite `recallFirstPass`.
7. Forbidden: shard patching, synthetic cand, uniform bin quotas, dialog_200 injection, class-weight/threshold/model changes.

## DATASET REBUILD STRATEGY

| Decision | Value |
|---|---|
| Rebuild for claimed P0 | **NO** |
| Mix old labeled rows | **NO** |
| Old S3 status | **RETAIN as authoritative until new defect proven** |
| Future new build id | only if a *real* S3 defect is proven post re-causality |
| Scale | stay ~10k families |

## DATASET QUALITY GATES

See `model3_v2_training_data_gate_design.csv`.

- **G3**: EXPECTED_VARIABLE only; exempt legitimate constants (e.g. isAnchor=0 on eligible loss spans).
- **G4**: `max_bin_share ≤ 0.35` + early/mid/late ≥ 0.10 each — catches 64% tail; passes current S3.
- **G5**: require both zero and nonzero cand — no exact production histogram match.

## FUTURE TRAINING ACCEPTANCE

**Before train:** G0–G8 HARD pass; datasetId SSOT; no dialog_200 leak.

**After train (not this phase):** synthetic held-out + localization16 geometry (FULL/PARTIAL/FN/SHIFTED) + full dialog_200 causal acceptance + false-RETRY controls + latency. Do not accept on synthetic F1 alone. Do not reward “more RETRY”.

## TARGET FILES

See `model3_v2_training_data_target_files.csv`.

**MUST_MODIFY (future):** causality audit TRAIN_DIR; dataset gates; quarantine realdist hardcode.

**DO_NOT_MODIFY:** production Model3/FineSpan/Retry/Recall/Model2/DomainVote/JobResult; formal harness (for these P0s); in-place S3 feature rewrite.

## TARGET LIST

T1–T41: architecture frozen; claimed P0s traced to measurement mismatch; B2 parity confirmed on S3; gates designed; no rebuild; no production change; one verdict; one next phase; ≤8 artifacts.

## CHECKLIST

[x] frozen architecture preserved  
[x] S3 model unchanged  
[x] 6-feature contract unchanged  
[x] position bias traced — first owner = prior audit wrong dataset  
[x] candidate collapse traced — first owner = prior audit wrong dataset  
[x] Recall/Model2/packer parity checked on S3  
[x] no uniform-bin / shard-patch / dialog_200 / acoustic aug  
[x] gates designed  
[x] rebuild = NO for claimed P0  
[x] ACP = NO  
[x] no production/training/dataset/model changes this phase  
[x] exactly one verdict / next phase  
[x] ≤8 artifacts  

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| training executed | NO |
| dataset rebuilt | NO |
| model changed | NO |
| threshold changed | NO |
| feature contract changed | NO |
| FineSpan / Retry / Recall / Model2 / Domain Vote / JobResult | NO |

## NEXT PHASE

Exactly one: `{NEXT}`

Purpose: complete training-pipeline SSOT / measurement identity before any correction development. Expected follow-on after that (user-authorized): re-run `MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT` against `MODEL3_V2_PRODUCTION_CORE_S3`.

**Do not execute.**

## ARTIFACTS (8)

1. `Lingua_Model3_V2_Training_Data_Correction_Design_Audit_2026_09_02.md`
2. `model3_v2_training_pipeline_trace.csv`
3. `model3_v2_position_bias_sources.csv`
4. `model3_v2_candidate_feature_trace.csv`
5. `model3_v2_training_data_gate_design.csv`
6. `model3_v2_training_data_correction_summary.json`
7. `model3_v2_training_data_target_files.csv`
8. `model3_v2_training_data_freeze_state.csv`
"""
    (DOCS / "Lingua_Model3_V2_Training_Data_Correction_Design_Audit_2026_09_02.md").write_text(
        report, encoding="utf-8"
    )
    print(json.dumps({"verdict": VERDICT, "nextPhase": NEXT}, indent=2))


if __name__ == "__main__":
    main()
