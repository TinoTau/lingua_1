# -*- coding: utf-8 -*-
"""Serialize MODEL3_TRAINING_SAMPLE_V1 rows from formal B2 materialization."""
from __future__ import annotations

import hashlib
from typing import Any

PIPELINE_VERSION = "MODEL3_V2_ACOUSTIC_TRAINING_STATE_V1"
LABEL_CONTRACT = "MODEL3_LABEL_CONTRACT_V2_20260829"
FEATURE_CONTRACT = "packModel3SpanInferFields"


class CandidateStateError(ValueError):
    """Missing / malformed candidate count — fail closed (not cand=0)."""

    def __init__(self, code: str = "RECALL_STATE_INVALID", detail: str = ""):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}:{detail}")


def extract_first_pass_candidate_count(sp: dict[str, Any]) -> int:
    """Require an explicit candidate count; missing → RECALL_STATE_INVALID.

    True zero (field present and == 0) is valid.
    """
    re_ev = sp.get("recallEvidence")
    packed = sp.get("packedInfer") or sp.get("packedInferFields") or {}

    has_re = isinstance(re_ev, dict) and "firstPassCandidateCount" in re_ev
    has_pk = isinstance(packed, dict) and "firstPassCandidateCount" in packed

    if not has_re and not has_pk:
        raise CandidateStateError(
            "RECALL_STATE_INVALID",
            "missing_firstPassCandidateCount",
        )

    values: list[int] = []
    if has_re:
        v = re_ev.get("firstPassCandidateCount")
        if v is None:
            raise CandidateStateError("RECALL_STATE_INVALID", "null_recall_firstPassCandidateCount")
        try:
            values.append(int(v))
        except (TypeError, ValueError) as e:
            raise CandidateStateError("RECALL_STATE_INVALID", "malformed_recall_cand") from e
    if has_pk:
        v = packed.get("firstPassCandidateCount")
        if v is None:
            raise CandidateStateError("RECALL_STATE_INVALID", "null_packed_firstPassCandidateCount")
        try:
            values.append(int(v))
        except (TypeError, ValueError) as e:
            raise CandidateStateError("RECALL_STATE_INVALID", "malformed_packed_cand") from e

    if len(values) == 2 and values[0] != values[1]:
        raise CandidateStateError(
            "RECALL_STATE_INVALID",
            f"cand_mismatch_recall={values[0]}_packed={values[1]}",
        )
    return values[0]


def serialize_path_samples(utt: dict[str, Any]) -> list[dict[str, Any]]:
    """One sample row per path (multipath retained; shared semanticFamilyId/split)."""
    samples: list[dict[str, Any]] = []
    fam = utt["semanticFamilyId"]
    run_id = utt["materializationRunId"]
    split = utt["split"]
    current = utt["model3CurrentText"]
    reference = utt["referenceText"]
    raw_asr = utt.get("rawActualAsrText") or ""

    for path in utt.get("labeledPaths") or []:
        path_id = path.get("pathId") or "path0"
        spans_out = []
        for sp in path.get("spans") or []:
            packed = sp.get("packedInfer") or sp.get("packedInferFields") or {}
            if not packed:
                raise CandidateStateError(
                    "RECALL_STATE_INVALID",
                    "missing_packedInferFields_for_packer_output",
                )
            cand = extract_first_pass_candidate_count(sp)
            spans_out.append(
                {
                    "spanId": sp.get("spanId"),
                    "surface": sp.get("surface"),
                    "rawStart": sp.get("rawStart"),
                    "rawEnd": sp.get("rawEnd"),
                    "syllableStart": sp.get("syllableStart"),
                    "syllableEnd": sp.get("syllableEnd"),
                    "seqIndex": sp.get("seqIndex"),
                    "isAnchor": bool(sp.get("isAnchor")),
                    "anchorSource": sp.get("anchorSource") or "NONE",
                    "targetMask": sp.get("targetMask", 0),
                    "label": sp.get("label"),
                    "labelClass": sp.get("labelClass"),
                    "labelReason": sp.get("labelReason"),
                    "referenceSurface": sp.get("referenceSurface"),
                    "rawFirstPassCandidateCount": cand,
                    "packedInferFields": packed,
                    "toneReadiness": sp.get("toneReadiness"),
                    "malformedRegionRelation": {
                        "regionRetryApplicable": sp.get("regionRetryApplicable"),
                    },
                    "pinyinEvidence": sp.get("pinyinEvidence")
                    or {"windowPinyinKey": None, "provenance": "TEXT_DERIVED_SYLLABLE_KEY"},
                    "toneEvidence": sp.get("toneEvidence") or {"provenance": "ACOUSTIC"},
                    "acousticEvidence": sp.get("acousticEvidence") or {"provenance": "SAME_RUN"},
                    "pronunciationEvidence": sp.get("pronunciationEvidence")
                    or {"status": "UNAVAILABLE"},
                    "recallEvidence": sp.get("recallEvidence")
                    or {
                        "status": "AVAILABLE",
                        "firstPassCandidateCount": cand,
                    },
                    "repairability": sp.get("repairability")
                    or {"referenceReachable": "UNKNOWN", "probe": "DEFERRED_TO_LABELER"},
                }
            )

        sample_id = (
            "m3b2_"
            + hashlib.sha256(f"{run_id}:{path_id}".encode()).hexdigest()[:20]
        )
        samples.append(
            {
                "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
                "sampleId": sample_id,
                "semanticFamilyId": fam,
                "materializationRunId": run_id,
                "referenceId": utt["referenceId"],
                "sourceSampleId": utt["referenceId"],
                "sourceCorpus": utt.get("sourceCorpus") or utt.get("sourcePoolId"),
                "sourcePoolId": utt.get("sourcePoolId"),
                "evidenceLevel": utt.get("evidenceLevel") or "TTS_ASR",
                "evidenceSource": utt.get("evidenceSource") or "FORMAL_FRESH_MATERIALIZATION",
                "referenceText": reference,
                "rawActualAsrText": raw_asr,
                "currentText": current,
                "audioRef": utt.get("audioAssetId"),
                "pathId": path_id,
                "seqIndex": path.get("pathIndex", 0),
                "domainEvidence": utt.get("domainEvidence")
                or {
                    "retainedDomains": path.get("retainedDomains") or [],
                    "anchorMaterialization": "RUNTIME_CONFIRMED",
                },
                "model2AnchorStatus": utt.get("model2AnchorStatus") or "UNAVAILABLE",
                "spans": spans_out,
                "split": split,
                "groupKeys": {
                    "sourceSentenceId": fam,
                    "contrastGroupId": None,
                    "splitGroupKey": fam,
                    "surfacePairKey": None,
                },
                "featureAvailability": utt.get("featureAvailability")
                or {
                    "textContext": True,
                    "pinyinTextDerived": True,
                    "toneAcoustic": True,
                    "asrConfidence": False,
                    "model2Pronunciation": False,
                    "recallFirstPass": True,
                },
                "provenance": {
                    "generatorVersion": PIPELINE_VERSION,
                    "labelMaterializerVersion": LABEL_CONTRACT,
                    "datasetVersion": "FORMAL_MATERIALIZATION_ONLY_NOT_DATASET",
                    "featureContractIdentity": FEATURE_CONTRACT,
                    "evidenceSource": utt.get("evidenceSource"),
                    "asrRunIdentity": utt.get("asrRunIdentity"),
                    "fwTimestampIdentity": utt.get("fwTimestampIdentity"),
                    "toneRunIdentity": utt.get("toneRunIdentity"),
                    "recallLexiconIdentity": utt.get("recallLexiconIdentity"),
                    "ownerDiagnostics": utt.get("ownerDiagnostics"),
                    "ownerExecution": utt.get("ownerExecution"),
                },
            }
        )
    return samples
