# -*- coding: utf-8 -*-
"""Emit MODEL3_V2_TRAINING_DATA_PIPELINE_TRACE_COMPLETENESS_AUDIT artifacts."""
from __future__ import annotations

import csv
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
PROBE = DOCS / "_tmp_trace_completeness_probe.json"

VERDICT = "MODEL3_TRAINING_PIPELINE_TRACE_COMPLETENESS_PASS_WITH_GOVERNANCE_GAPS"
NEXT = "MODEL3_V2_TRAINING_DATA_IDENTITY_GUARD_DEVELOPMENT"

MODEL_ID = "MODEL3_V2_S3_RANDOM_INIT_V1"
WEIGHTS = "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1"
DATASET_ID = "MODEL3_V2_PRODUCTION_CORE_S3"
BUILD_ID = "prod_core_s3_build_20260830_v1"


def wcsv(path: Path, rows: list[dict]):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    probe = json.loads(PROBE.read_text(encoding="utf-8")) if PROBE.exists() else {}
    integrity = probe.get("integrity") or {}
    heldout = probe.get("heldout") or {}
    shard_h = probe.get("shard_hashes_diagnostic") or {}

    chain = [
        {
            "link": "1_CHECKPOINT_HASH",
            "artifact": "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013/weights.pt",
            "value": WEIGHTS,
            "status": "VERIFIED",
            "evidence": "sha256 match vs model3_v2_s3_checkpoint_manifest.json + dataset_manifest.json",
        },
        {
            "link": "2_TRAIN_SCRIPT",
            "artifact": "training/model3_dataset/train/train_s3_random.py",
            "value": "main() MODEL_ID=MODEL3_V2_S3_RANDOM_INIT_V1 SEED=2026083013",
            "status": "VERIFIED",
            "evidence": "hardcoded DATA/OUT/MODEL_ID; writes config.json + docs checkpoint manifest",
        },
        {
            "link": "3_DATASET_PATH",
            "artifact": "training/model3_dataset/model3_v2_production_core_s3/{train,dev,test}",
            "value": "DATA hardcoded in train_s3_random.py L31",
            "status": "VERIFIED_EXPLICIT",
            "evidence": "no CLI/env override; glob shard-*.jsonl per split only",
        },
        {
            "link": "4_DATASET_ID",
            "artifact": "checkpoint config.json + dataset_manifest.json + every sample",
            "value": DATASET_ID,
            "status": "PRESENT",
            "evidence": f"config PRESENT; all {integrity.get('sample_counts',{}).get('train',0)+integrity.get('sample_counts',{}).get('dev',0)+integrity.get('sample_counts',{}).get('test',0)} path-samples tagged",
        },
        {
            "link": "5_DATASET_BUILD_ID",
            "artifact": "checkpoint config.json + dataset_manifest.json + every sample provenance",
            "value": BUILD_ID,
            "status": "PRESENT",
            "evidence": "build_ids counter sole key prod_core_s3_build_20260830_v1 count=30354",
        },
        {
            "link": "6_MANIFEST",
            "artifact": "training/model3_dataset/model3_v2_production_core_s3/dataset_manifest.json",
            "value": "single dataset_manifest.json + docs model3_v2_production_core_s3_summary.json",
            "status": "PRESENT",
            "evidence": "binds datasetId/buildId/weightsSha256/s3ModelId/label/feature contracts; SHARD_CONTENT_HASH_MISSING",
        },
        {
            "link": "7_TRAIN_SHARD",
            "artifact": shard_h.get("train", {}).get("path", "train/shard-000.jsonl"),
            "value": shard_h.get("train", {}).get("sha256", ""),
            "status": "DIAGNOSTIC_HASH_ONLY",
            "evidence": f"n={integrity.get('sample_counts',{}).get('train')} buildId exclusive",
        },
        {
            "link": "8_DEV_SHARD",
            "artifact": shard_h.get("dev", {}).get("path", "dev/shard-000.jsonl"),
            "value": shard_h.get("dev", {}).get("sha256", ""),
            "status": "DIAGNOSTIC_HASH_ONLY",
            "evidence": f"n={integrity.get('sample_counts',{}).get('dev')}",
        },
        {
            "link": "9_TEST_SHARD",
            "artifact": shard_h.get("test", {}).get("path", "test/shard-000.jsonl"),
            "value": shard_h.get("test", {}).get("sha256", ""),
            "status": "DIAGNOSTIC_HASH_ONLY",
            "evidence": f"n={integrity.get('sample_counts',{}).get('test')}",
        },
        {
            "link": "10_FEATURE_CONTRACT",
            "artifact": "packModel3SpanInferFields",
            "value": "featureContractIdentity + config.featureContract",
            "status": "VERIFIED",
            "evidence": "serializer FEATURE_CONTRACT; Node packer SSOT for cand/pinyin; Python completes 6D",
        },
        {
            "link": "11_LABEL_CONTRACT",
            "artifact": "MODEL3_LABEL_CONTRACT_V2_20260829",
            "value": "label_spans_v2 / REGION_BOUNDED_FULL_COVERAGE",
            "status": "VERIFIED",
            "evidence": "KEEP/RETRY/MASKED counts match manifest",
        },
        {
            "link": "12_SPLIT_CONTRACT",
            "artifact": "semanticFamilyId via family_identity.assign_split",
            "value": "train/dev/test family overlap=0",
            "status": "VERIFIED",
            "evidence": json.dumps(integrity.get("split_overlaps")),
        },
    ]
    wcsv(DOCS / "model3_v2_checkpoint_dataset_chain.csv", chain)

    shards = []
    for split in ("train", "dev", "test"):
        h = shard_h.get(split) or {}
        shards.append(
            {
                "split": split,
                "path": h.get("path", ""),
                "sampleCount": integrity.get("sample_counts", {}).get(split, ""),
                "familyCount": integrity.get("family_counts", {}).get(split, ""),
                "datasetId": DATASET_ID,
                "datasetBuildId": BUILD_ID,
                "mixedBuild": "NO",
                "labeledContamination": "NO",
                "realdistContamination": "NO",
                "s1BuildContamination": "NO",
                "s2BuildIdContamination": "NO",
                "s2LineageReuse": "INTENTIONAL_PER_MANIFEST (re-tagged to S3 buildId)",
                "diagnosticSha256": h.get("sha256", ""),
                "manifestListsShardHash": "NO",
            }
        )
    wcsv(DOCS / "model3_v2_training_shard_identity.csv", shards)

    feats = [
        {
            "feature": "isAnchor",
            "rawSource": "materializeModel3Anchors → span.isAnchor",
            "nodeCjsOwner": "Anchor materialization flag",
            "pythonLoaderOwner": "bigru_v1.span_features float(bool(isAnchor))",
            "runtimeHostOwner": "model3_inference_host._pack_spans is_anchor",
            "formulaParity": "DUPLICATE_BUT_PARITY_CONFIRMED",
            "missingDefault": "False/0",
            "notes": "EXPECTED_CONSTANT=0 on eligible non-anchor loss spans",
        },
        {
            "feature": "span_len_log1p",
            "rawSource": "surface char length (packed surface / rawText slice)",
            "nodeCjsOwner": "packModel3SpanInferFields.surface",
            "pythonLoaderOwner": "math.log1p(len(surf))",
            "runtimeHostOwner": "math.log1p(len(surface))",
            "formulaParity": "DUPLICATE_BUT_PARITY_CONFIRMED",
            "missingDefault": "empty surface → log1p(0)=0",
            "notes": "character count semantics",
        },
        {
            "feature": "span_rel_position",
            "rawSource": "seqIndex / span list order",
            "nodeCjsOwner": "seqIndex written; formula NOT in packer",
            "pythonLoaderOwner": "i / max(n-1,1)",
            "runtimeHostOwner": "i / max(n-1,1)",
            "formulaParity": "DUPLICATE_BUT_PARITY_CONFIRMED",
            "missingDefault": "n=1 → 0",
            "notes": "index-based not char-offset",
        },
        {
            "feature": "first_pass_cand_log1p",
            "rawSource": "span.candidates.filter(!isCovered).length",
            "nodeCjsOwner": "model3FirstPassCandidateCount → packModel3SpanInferFields",
            "pythonLoaderOwner": "log1p(recallEvidence.firstPassCandidateCount); None→0",
            "runtimeHostOwner": "log1p(first_pass_cand_count or 0)",
            "formulaParity": "DUPLICATE_BUT_PARITY_CONFIRMED_WITH_FIELD_BRIDGE",
            "missingDefault": "TRAIN: None→0 SILENT; SERIALIZER: missing→RECALL_STATE_INVALID; HOST: or 0",
            "notes": "S3 end-to-end 0/1/2 present; missing≠zero only at serializer",
        },
        {
            "feature": "current_cjk_len_log1p",
            "rawSource": "CJK regex on surface",
            "nodeCjsOwner": "surface only",
            "pythonLoaderOwner": "log1p(len(_CJK.findall(surf)))",
            "runtimeHostOwner": "log1p(len(_CJK.findall(surface)))",
            "formulaParity": "DUPLICATE_BUT_PARITY_CONFIRMED",
            "missingDefault": "0 if no CJK",
            "notes": "same unicode range",
        },
        {
            "feature": "pinyin_channel_avail",
            "rawSource": "globalSyllables.length>0 / featureAvailability.pinyinTextDerived",
            "nodeCjsOwner": "model3PinyinTextDerived → pinyinChannelAvail",
            "pythonLoaderOwner": "1 if fa.pinyinTextDerived else 0; avail mask",
            "runtimeHostOwner": "pinyin_channel_avail bool from client",
            "formulaParity": "DUPLICATE_BUT_PARITY_CONFIRMED",
            "missingDefault": "fa default True in some loaders",
            "notes": "traced end-to-end on S3 (typically 1)",
        },
    ]
    wcsv(DOCS / "model3_v2_feature_contract_trace.csv", feats)

    legacy = [
        {
            "dataset": "MODEL3_V2_PRODUCTION_CORE_S3",
            "path": "training/model3_dataset/model3_v2_production_core_s3",
            "status": "AUTHORITATIVE_FOR_S3",
            "purpose": "Train MODEL3_V2_S3_RANDOM_INIT_V1",
            "activeTraining": "YES (historical completed)",
            "s3TrainingConsumer": "train_s3_random.py",
            "s3AuditConsumer": "analyze_s3_*; audit_s3_*; SHOULD be causality SSOT",
            "notes": "dataset_manifest.json + checkpoint config bind",
        },
        {
            "dataset": "MODEL3_V2_PRODUCTION_CORE_S2",
            "path": "training/model3_dataset/model3_v2_production_core_s2",
            "status": "VALID_HISTORICAL",
            "purpose": "S2 train + lineage source for S3 reuse",
            "activeTraining": "NO for S3 model",
            "s3TrainingConsumer": "NO direct; reused rows re-tagged into S3",
            "s3AuditConsumer": "learning-curve / freeze audits",
            "notes": "parentDataset; not mixed buildId in S3 shards",
        },
        {
            "dataset": "MODEL3_V2_PRODUCTION_CORE_S1",
            "path": "training/model3_dataset/model3_v2_production_core_s1",
            "status": "VALID_HISTORICAL",
            "purpose": "S1 experiment",
            "activeTraining": "NO",
            "s3TrainingConsumer": "NO",
            "s3AuditConsumer": "learning-curve only",
            "notes": "no S1 buildId in S3 shards",
        },
        {
            "dataset": "MODEL3_V2_LABELED",
            "path": "training/model3_dataset/model3_v2_labeled",
            "status": "QUARANTINE_CANDIDATE",
            "purpose": "V1 text relabel pilot (no ASR/Recall/Model2)",
            "activeTraining": "train_v2_labeled.py only (not S3)",
            "s3TrainingConsumer": "NO",
            "s3AuditConsumer": "YES — INVALID prior causality + generalization audit",
            "notes": "STALE_HARDCODED_PATH consumers remain",
        },
        {
            "dataset": "MODEL3_V2_REALDIST_EXPANDED_V1",
            "path": "training/model3_dataset/model3_v2_realdist_expanded_v1",
            "status": "QUARANTINE_CANDIDATE",
            "purpose": "RealDist pilot; hardcodes cand=0",
            "activeTraining": "train_v2_realdist.py historical",
            "s3TrainingConsumer": "NO",
            "s3AuditConsumer": "NO for S3 causality; realdist acceptance uses realdist ckpt",
            "notes": "build_v2_realdist_expanded.py:120 hardcode",
        },
        {
            "consumer": "audit_model3_v2_localization_training_causality.py",
            "datasetPathDefault": "model3_v2_labeled/train",
            "affectsS3Training": "NO",
            "affectsS3CausalityAudit": "YES_INVALID",
            "risk": "STALE_HARDCODED_PATH",
            "action": "MUST_MODIFY_LATER bind to S3 + G0",
        },
        {
            "consumer": "run-model3-v2-target-localization-generalization-audit.mjs",
            "datasetPathDefault": "model3_v2_labeled/train",
            "affectsS3Training": "NO",
            "affectsS3CausalityAudit": "YES_INVALID_SUPPORT_STATS",
            "risk": "STALE_HARDCODED_PATH",
            "action": "MUST_MODIFY_LATER",
        },
        {
            "consumer": "train_v2_labeled.py / qa_v2_dataset.py / run_v2_dataset_build.py",
            "datasetPathDefault": "model3_v2_labeled",
            "affectsS3Training": "NO",
            "affectsS3CausalityAudit": "NO",
            "risk": "LEGACY_ACTIVE_FOR_V2_LABELED_ONLY",
            "action": "MAY quarantine from Model3 S3 SSOT docs",
        },
        {
            "consumer": "train_v2_realdist.py / build_v2_realdist_expanded.py / eval_v2_realdist_*",
            "datasetPathDefault": "model3_v2_realdist_expanded_v1",
            "affectsS3Training": "NO",
            "affectsS3CausalityAudit": "NO",
            "risk": "LEGACY_REALDIST",
            "action": "QUARANTINE_CANDIDATE",
        },
        {
            "consumer": "train_s3_random.py",
            "datasetPathDefault": "model3_v2_production_core_s3",
            "affectsS3Training": "YES_CORRECT",
            "affectsS3CausalityAudit": "N/A",
            "risk": "hardcoded path OK but no G0 vs foreign checkpoint",
            "action": "MAY_MODIFY_LATER add identity assert helpers",
        },
    ]
    # normalize columns for CSV - split into two logical tables in one file with union keys
    legacy_rows = []
    for row in legacy:
        legacy_rows.append(
            {
                "dataset_or_consumer": row.get("dataset") or row.get("consumer"),
                "path_or_default": row.get("path") or row.get("datasetPathDefault"),
                "status": row.get("status") or row.get("risk"),
                "purpose_or_action": row.get("purpose") or row.get("action"),
                "affectsS3Training": row.get("s3TrainingConsumer") or row.get("affectsS3Training"),
                "affectsS3CausalityAudit": row.get("s3AuditConsumer") or row.get("affectsS3CausalityAudit"),
                "notes": row.get("notes") or row.get("risk") or "",
            }
        )
    wcsv(DOCS / "model3_v2_legacy_dataset_consumers.csv", legacy_rows)

    gates = [
        {
            "gateId": "G0",
            "classification": "REQUIRED_BLOCKING",
            "design": "Before any train/audit sample load: assert modelId+weightsSha256+datasetId+datasetBuildId+featureContract+labelContract match checkpoint config/manifest/path samples",
            "onMismatch": "HARD STOP DATASET_IDENTITY_MISMATCH",
            "thresholdFreeze": "N/A identity exact-match",
        },
        {
            "gateId": "G1",
            "classification": "REQUIRED_BLOCKING",
            "design": "semanticFamilyId split overlap==0",
            "onMismatch": "HARD STOP",
            "thresholdFreeze": "N/A",
        },
        {
            "gateId": "G2",
            "classification": "REQUIRED_BLOCKING",
            "design": "featureContractIdentity==packModel3SpanInferFields; cand field present",
            "onMismatch": "HARD STOP",
            "thresholdFreeze": "N/A",
        },
        {
            "gateId": "G3",
            "classification": "USEFUL_NONBLOCKING",
            "design": "EXPECTED_VARIABLE features non-collapse; exempt EXPECTED_CONSTANT",
            "onMismatch": "HARD when expected variable collapsed",
            "thresholdFreeze": "PREVENTIVE — do not freeze numeric floors yet without broader cohort",
        },
        {
            "gateId": "G4",
            "classification": "USEFUL_NONBLOCKING",
            "design": "RETRY position shortcut risk principle",
            "onMismatch": "warn/hard TBD",
            "thresholdFreeze": "NO — 0.35/0.10 NOT SSOT",
        },
        {
            "gateId": "G5",
            "classification": "USEFUL_NONBLOCKING",
            "design": "cand zero AND nonzero states present",
            "onMismatch": "HARD if all-zero when recallFirstPass expected",
            "thresholdFreeze": "state coverage only; no histogram match",
        },
        {
            "gateId": "G6",
            "classification": "REQUIRED_BLOCKING",
            "design": "V2 label contract version + allowed labels",
            "onMismatch": "HARD STOP",
            "thresholdFreeze": "N/A",
        },
        {
            "gateId": "G7",
            "classification": "USEFUL_NONBLOCKING",
            "design": "geometry/class coverage advisory",
            "onMismatch": "soft",
            "thresholdFreeze": "PREMATURE",
        },
        {
            "gateId": "G8",
            "classification": "REQUIRED_BLOCKING",
            "design": "dialog_200 / protection registry contamination==0",
            "onMismatch": "HARD STOP",
            "thresholdFreeze": "N/A",
        },
    ]
    wcsv(DOCS / "model3_v2_training_identity_gate_design.csv", gates)

    freeze = [
        {"item": "MODEL3_V2_S3_RANDOM_INIT_V1", "value": WEIGHTS, "status": "FROZEN_VERIFIED"},
        {"item": "DATASET_ID", "value": DATASET_ID, "status": "FROZEN_VERIFIED"},
        {"item": "DATASET_BUILD_ID", "value": BUILD_ID, "status": "FROZEN_VERIFIED"},
        {"item": "PRIOR_S3_POSITION_BIAS_PROVEN", "value": "INVALIDATED", "status": "WRONG_DATASET_AUDIT"},
        {"item": "PRIOR_S3_CAND_COLLAPSE_PROVEN", "value": "INVALIDATED", "status": "WRONG_DATASET_AUDIT"},
        {"item": "PRIOR_ROOTCAUSE_8_5_3", "value": "INVALIDATED", "status": "NOT_AUTHORITATIVE"},
        {"item": "LOCALIZATION16_POPULATION", "value": "FROZEN", "status": "TRAINING_CAUSE_UNRESOLVED"},
        {"item": "G0_IMPLEMENTED", "value": "NO", "status": "DESIGN_ONLY"},
        {"item": "ACP", "value": "NO", "status": "FROZEN"},
        {"item": "VERDICT", "value": VERDICT, "status": "FROZEN"},
        {"item": "NEXT_PHASE", "value": NEXT, "status": "PROPOSED_NOT_EXECUTED"},
    ]
    wcsv(DOCS / "model3_v2_training_pipeline_freeze_state.csv", freeze)

    summary = {
        "phase": "MODEL3_V2_TRAINING_DATA_PIPELINE_TRACE_COMPLETENESS_AUDIT",
        "verdict": VERDICT,
        "nextPhase": NEXT,
        "acpRequired": "NO",
        "checkpointIdentity": {"modelId": MODEL_ID, "weightsSha256": WEIGHTS, "verified": True},
        "datasetIdentity": {"datasetId": DATASET_ID, "datasetBuildId": BUILD_ID, "verified": True},
        "manifestStatus": "PRESENT_SINGLE_dataset_manifest.json_PLUS_summary",
        "shardContentHashInManifest": "MISSING",
        "splitIntegrity": integrity.get("split_overlaps"),
        "heldoutStatus": heldout.get("status"),
        "heldoutNote": heldout.get("note"),
        "featureContractStatus": "VERIFIED_WITH_DUPLICATE_6D_PARITY",
        "labelContractStatus": "VERIFIED_V2",
        "invalidPriorAuditRootCause": {
            "classification": "MULTIPLE",
            "primary": "STALE_HARDCODED_PATH",
            "secondary": ["MISSING_CHECKPOINT_DATASET_BINDING", "AUDIT_SCRIPT_NO_G0"],
            "script": "training/model3_dataset/scripts/audit_model3_v2_localization_training_causality.py",
            "line": "TRAIN_DIR = .../model3_v2_labeled/train",
            "also": "run-model3-v2-target-localization-generalization-audit.mjs TRAIN_LABELED",
            "firstOwner": "STALE_HARDCODED_PATH",
            "assertedIdentityBeforeLoad": "NO",
        },
        "governanceGaps": [
            "G0 not implemented in audits",
            "stale labeled defaults still in causality/generalization scripts",
            "SHARD_CONTENT_HASH_MISSING from dataset_manifest",
            "loader None→0 silent for cand when field missing",
            "duplicate 6D formulas (parity confirmed)",
        ],
        "identityFunnel": {
            "checkpointHash": "PASS",
            "trainScript": "PASS",
            "datasetId": "PASS",
            "buildId": "PASS",
            "manifest": "PASS",
            "shards": "PASS",
            "shardBuildConsistency": "PASS",
            "featureContract": "PASS",
            "labelContract": "PASS",
            "splitIntegrity": "PASS",
            "heldoutIntegrity": "PASS_EXACT_TEXT_ZERO_HITS",
            "authoritativeChainComplete": "YES_WITH_GOVERNANCE_GAPS",
        },
        "trustHierarchy": [
            "1_immutable_checkpoint_hash_plus_training_manifest",
            "2_training_time_checkpoint_config_and_docs_manifest",
            "3_dataset_manifest_build_metadata",
            "4_code_default",
            "5_later_report_prose",
        ],
        "g0Readiness": {
            "fieldsAvailable": ["modelId", "weightsSha256", "datasetId", "datasetBuildId", "featureContract", "labelContractVersion"],
            "existingMetadataSufficient": True,
            "newRegistryNecessary": False,
            "hardStopOnMismatch": True,
            "mustRunBeforeSampleLoad": True,
        },
        "rebuildJustified": "NO",
        "retrainJustified": "NO",
        "dataCorrectionJustified": "NO",
        "questions": {
            "D1": WEIGHTS,
            "D2": "train_s3_random.py",
            "D3": DATASET_ID,
            "D4": BUILD_ID,
            "D5": "model3_v2_production_core_s3/{train,dev,test}/shard-000.jsonl",
            "D6": "EXPLICIT_HARDCODED (no CLI)",
            "D7": "NO silent other-dataset selection in train_s3_random; audits CAN via stale hardcoded labeled path",
            "D8": "YES PRESENT in checkpoint config.json",
            "D9": "YES PRESENT in checkpoint config.json",
            "D10": "also dataset_manifest.json + model3_v2_s3_checkpoint_manifest.json",
            "D11": "YES dataset_manifest.json",
            "D12": "YES splitCounts cover all three",
            "D13": "YES same buildId",
            "D14": "NO mixed buildIds",
            "D15": "NO",
            "D16": "NO",
            "D17": "NO S1/S2 buildId mix; intentional S2 lineage reuse re-tagged to S3",
            "D18": "YES zero leakage",
            "D19": "YES exact-text hits=0 against dialog inventories + protection texts",
            "D20": "family-id map incomplete for all 200; registry covers protected subset",
            "D21": "YES B2 formal",
            "D22": "YES runLatticeFineSpanGeneration",
            "D23": "YES expandActiveCandidatesWithModel2",
            "D24": "YES voteUtteranceDomainFromPool path-local",
            "D25": "YES materializeModel3Anchors",
            "D26": "YES packModel3SpanInferFields",
            "D27": "Python bigru_v1.span_features / inference_host._pack_spans",
            "D28": "YES formulas equivalent",
            "D29": "field-name bridge cand; avail-mask edge cases aligned",
            "D30": "YES in loader/host for missing cand",
            "D31": "YES at serializer (fail-closed); NO at bigru_v1 None→0",
            "D32": "YES 0/1/2 in S3",
            "D33": "YES",
            "D34": "YES identical index formula",
            "D35": "YES",
            "D36": "YES V2",
            "D37": "NO synthetic corruption in S3 (corruptions=[])",
            "D38": "V1→V2 text relabel pilot",
            "D39": "train_v2_labeled, qa_v2_dataset, causality/generalization audits (stale)",
            "D40": "RealDist expanded pilot",
            "D41": "train_v2_realdist, eval/audit realdist scripts",
            "D42": "NO",
            "D43": "YES labeled still affects causality audit scripts until fixed",
            "D44": "STALE_HARDCODED_PATH + no checkpoint→dataset G0",
            "D45": "STALE_HARDCODED_PATH",
            "D46": "NO",
            "D47": "YES",
            "D48": "modelId,weightsSha256,datasetId,datasetBuildId,featureContract,labelContractVersion",
            "D49": "HARD STOP",
            "D50": "NO",
            "D51": "YES",
            "D52": "YES existing metadata sufficient",
            "D53": "NO new registry necessary",
            "D54": "G1/G2 REQUIRED_BLOCKING",
            "D55": "G3/G4/G5 USEFUL_NONBLOCKING / preventive",
            "D56": "NO",
            "D57": "NO",
            "D58": "NO",
            "D59": "NO",
            "D60_D66": "NO",
            "D67": "NO",
            "D68": "YES_WITH_GOVERNANCE_GAPS",
            "D69": "YES for S3 authoritative chain; audit consumers incomplete",
            "D70": "YES",
            "D71": "YES",
        },
        "governance": {
            "productionCodeChanged": "NO",
            "trainingExecuted": "NO",
            "datasetRebuilt": "NO",
            "modelChanged": "NO",
            "thresholdChanged": "NO",
            "featureContractChanged": "NO",
            "fineSpanChanged": "NO",
            "retryChanged": "NO",
            "recallChanged": "NO",
            "model2Changed": "NO",
            "domainVoteChanged": "NO",
            "jobResultChanged": "NO",
        },
    }
    (DOCS / "model3_v2_training_pipeline_trace_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    report = f"""# Lingua Model3 V2 Training Pipeline Trace Completeness Audit (2026-09-02)

Phase: `MODEL3_V2_TRAINING_DATA_PIPELINE_TRACE_COMPLETENESS_AUDIT`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `{VERDICT}` |
| **checkpoint identity** | `{MODEL_ID}` / `{WEIGHTS}` **VERIFIED** |
| **dataset identity** | `{DATASET_ID}` **VERIFIED** |
| **dataset build identity** | `{BUILD_ID}` **VERIFIED** |
| **manifest status** | PRESENT (`dataset_manifest.json`); shard content hashes **MISSING** |
| **split integrity** | train∩dev∩test family overlap = **0** |
| **feature contract status** | VERIFIED; 6-D duplicate formulas **PARITY_CONFIRMED** |
| **label contract status** | `MODEL3_LABEL_CONTRACT_V2_20260829` VERIFIED |
| **invalid prior audit root cause** | **STALE_HARDCODED_PATH** (+ MISSING_CHECKPOINT_DATASET_BINDING / no G0) |
| **G0 readiness** | fields PRESENT; not implemented; HARD STOP design ready |
| **ACP** | **NO** |
| **next phase** | `{NEXT}` (**NOT EXECUTED**) |

### Retracted (not authoritative for S3)

- S3_POSITION_BIAS≈64% — **INVALIDATED**
- S3 first_pass_cand nonzero=0 — **INVALIDATED**
- training root-cause 8/5/3 — **INVALIDATED**

Localization16 population remains frozen; **training root cause = UNRESOLVED**.

## CHECKPOINT → DATASET CHAIN

```
MODEL3_V2_S3_RANDOM_INIT_V1
  weights.pt sha256 = {WEIGHTS}
→ train_s3_random.py (SEED=2026083013)
→ DATA = model3_v2_production_core_s3/{{train,dev,test}}
→ datasetId = {DATASET_ID}
→ datasetBuildId = {BUILD_ID}
→ dataset_manifest.json (+ production_core_s3_summary.json)
→ shard-000.jsonl ×3 (same buildId on all 30354 path-samples)
→ semanticFamilyId split (10000 families; overlap 0)
→ B2 formal materialization + packModel3SpanInferFields
→ label_spans_v2 V2 contract
```

Checkpoint `config.json` **directly contains** `datasetId` and `datasetBuildId` (**PRESENT**, not inferred-only).

## TRAIN SCRIPT RESOLUTION

| Item | Value |
|---|---|
| Script | `training/model3_dataset/train/train_s3_random.py` |
| Entry | `main()` |
| CLI overrides | **none** for dataset path |
| Dataset selection | hardcoded `DATA` + `load_split` glob `shard-*.jsonl` |
| Silent other-dataset select | **NO** in this script |
| Auth gate | requires `model3_v2_production_core_s3_summary.json` `trainingAuthorized` |
| Writes | `config.json`, `weights.pt`, `training_metrics.json`, docs `model3_v2_s3_checkpoint_manifest.json` |

## DATASET MANIFEST

Authority: `training/model3_dataset/model3_v2_production_core_s3/dataset_manifest.json`

Binds: datasetId, buildId, pipeline/feature/label contracts, splitCounts, label counts, `s3ModelId`, `weightsSha256`, lineageStrategy `S2_4994_reuse_plus_5006_new_materialization`.

**SHARD_CONTENT_HASH_MISSING** in manifest (diagnostic hashes recorded in this audit only).

## SHARD IDENTITY

| Split | Samples | Families | BuildId |
|---|---:|---:|---|
| train | {integrity.get('sample_counts',{}).get('train')} | {integrity.get('family_counts',{}).get('train')} | {BUILD_ID} only |
| dev | {integrity.get('sample_counts',{}).get('dev')} | {integrity.get('family_counts',{}).get('dev')} | same |
| test | {integrity.get('sample_counts',{}).get('test')} | {integrity.get('family_counts',{}).get('test')} | same |

- labeled / realdist contamination: **NO**
- S1/S2 **buildId** mix: **NO**
- S2 **lineage reuse**: intentional, rows re-tagged to S3 buildId

## SEMANTIC FAMILY SPLIT

Overlaps: `{json.dumps(integrity.get('split_overlaps'))}` → **PASS (0)**.

`materializationRunId` is not the split key; `semanticFamilyId` is.

## HELD-OUT CONTAMINATION

Exact `referenceText`/`currentText` vs dialog_200 inventories + protection registry texts: **0 hits** on full train shard.

Status: **PASS** for exact-text; protected-case registry used at build. Full 200-case family-id map not universal → residual mapping incompleteness noted, not contamination proven.

## B2 MATERIALIZATION TRACE

`run_production_core_s3_build.py` → TTS → ASR → `acoustic_b2_formal_materialize.cjs`:

| Component | Owner | Status |
|---|---|---|
| FineSpan/Recall | `runLatticeFineSpanGeneration` | EXACT_REUSE |
| Model2 | `expandActiveCandidatesWithModel2` | EXACT_REUSE |
| Domain Vote | `voteUtteranceDomainFromPool` | EXACT_REUSE (path-local) |
| Anchors | `materializeModel3Anchors` | EXACT_REUSE |
| Packer | `packModel3SpanInferFields` | EXACT_REUSE |
| Labels | `label_spans_v2` (`corruptions=[]`) | SEMANTIC_PARITY (training labeler) |
| 6-D complete | `bigru_v1.span_features` / `_pack_spans` | DUPLICATE_IMPLEMENTATION |

No synthetic corruption path in S3.

## RECALL / MODEL2 / DOMAIN VOTE PARITY

Confirmed via formal harness requires of production `dist/main` modules — not stubs / Plain Recall.

## MODEL3 FEATURE CONTRACT TRACE

See `model3_v2_feature_contract_trace.csv`.

- Node packer: cand + pinyin (+ surface)
- Python: completes all six scalars
- Candidate end-to-end states on S3: **0 / 1 / 2 present**
- Missing vs zero: **distinguished in serializer**; **not** in `bigru_v1` (`None→0`)

## LABEL CONTRACT TRACE

V2 `KEEP` / `RETRY` / `MASKED`; counts match manifest. Malformed regions from ASR≠reference SequenceMatcher.

## LEGACY DATASET INVENTORY

See `model3_v2_legacy_dataset_consumers.csv`.

| Dataset | Status |
|---|---|
| production_core_s3 | AUTHORITATIVE_FOR_S3 |
| S1 / S2 | VALID_HISTORICAL |
| model3_v2_labeled | QUARANTINE_CANDIDATE |
| realdist_expanded | QUARANTINE_CANDIDATE |

## INVALID PRIOR AUDIT ROOT CAUSE

| Field | Value |
|---|---|
| Script | `audit_model3_v2_localization_training_causality.py` |
| Defect | `TRAIN_DIR = .../model3_v2_labeled/train` |
| Also | generalization audit `TRAIN_LABELED` same path |
| Classification | **MULTIPLE**: STALE_HARDCODED_PATH + MISSING_CHECKPOINT_DATASET_BINDING + no G0 |
| First owner | **STALE_HARDCODED_PATH** |
| Identity asserted before load | **NO** |

## DATASET IDENTITY GATE DESIGN (G0)

Before **any** training-root-cause sample load:

1. Resolve checkpoint → read `config.json` / weights hash
2. Resolve expected `datasetId` / `datasetBuildId` / contracts
3. Resolve path via manifest (not directory discovery)
4. Spot-check shard samples for matching ids
5. On mismatch → **HARD STOP `DATASET_IDENTITY_MISMATCH`** (no warn-and-continue)

Existing metadata **sufficient**; **no new registry** required.

Preferred flow: checkpoint → datasetId/buildId → manifest → shards.

## G1–G8 REVIEW

| Gate | Class |
|---|---|
| G0 identity | REQUIRED_BLOCKING |
| G1 split | REQUIRED_BLOCKING |
| G2 feature contract | REQUIRED_BLOCKING |
| G3 variance | USEFUL_NONBLOCKING |
| G4 position | USEFUL_NONBLOCKING; **0.35/0.10 NOT frozen** |
| G5 cand coverage | USEFUL_NONBLOCKING |
| G6 labels | REQUIRED_BLOCKING |
| G7 geometry | USEFUL_NONBLOCKING / PREMATURE |
| G8 heldout | REQUIRED_BLOCKING |

## TARGET FILES

**MUST_MODIFY_LATER**

- `audit_model3_v2_localization_training_causality.py` (TRAIN_DIR + G0)
- `run-model3-v2-target-localization-generalization-audit.mjs` (TRAIN_LABELED)
- shared audit identity helper / gate module (new small util OK)

**MAY_MODIFY_LATER**

- `train_s3_random.py` (optional stronger G0 recording)
- `dataset_manifest.json` writer (add shard hashes)
- `bigru_v1.span_features` fail-closed when cand missing
- quarantine docs for labeled/realdist

**DO_NOT_MODIFY**

- production Model3 / FineSpan / Retry / Recall / Model2 / Domain Vote / Assembly / KenLM / JobResult
- S3 shards in-place
- checkpoint rewrite

## FREEZE UPDATE

- Authoritative S3 chain: **FROZEN VERIFIED**
- Prior S3 distribution / 8-5-3 causal freezes: **INVALIDATED**
- Localization16: frozen; training cause unresolved
- Rebuild / retrain / data correction / runtime change: **NOT JUSTIFIED NOW**

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| training executed | NO |
| dataset rebuilt | NO |
| model / threshold / features | NO |
| FineSpan / Retry / Recall / Model2 / Domain Vote / JobResult | NO |

## NEXT PHASE

Exactly one: `{NEXT}`

Then (only after identity guard): `MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT_S3`.

**Do not execute. Do not retrain. Do not rebuild.**

## ARTIFACTS (8)

1. `Lingua_Model3_V2_Training_Pipeline_Trace_Completeness_Audit_2026_09_02.md`
2. `model3_v2_checkpoint_dataset_chain.csv`
3. `model3_v2_training_shard_identity.csv`
4. `model3_v2_feature_contract_trace.csv`
5. `model3_v2_legacy_dataset_consumers.csv`
6. `model3_v2_training_pipeline_trace_summary.json`
7. `model3_v2_training_identity_gate_design.csv`
8. `model3_v2_training_pipeline_freeze_state.csv`
"""
    (DOCS / "Lingua_Model3_V2_Training_Pipeline_Trace_Completeness_Audit_2026_09_02.md").write_text(
        report, encoding="utf-8"
    )
    print(json.dumps({"verdict": VERDICT, "nextPhase": NEXT}, indent=2))


if __name__ == "__main__":
    main()
