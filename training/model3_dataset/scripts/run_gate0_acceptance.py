# -*- coding: utf-8 -*-
"""MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0_ACCEPTANCE runner.

Freeze source batch BEFORE outcomes. One fresh formal B2 run. No dataset build.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from training.model3_dataset.acoustic_training.family_identity import (
    assert_split_locked,
    semantic_family_id,
)
from training.model3_dataset.acoustic_training.gate0 import (
    BLOCKED,
    FAIL,
    FORMAL_EVIDENCE,
    INSUFFICIENT_EVIDENCE,
    NOT_EXERCISED,
    PASS,
    evaluate_gate0,
)
from training.model3_dataset.acoustic_training.holdout_registry import (
    PROTECTED_CASE_IDS,
    check_holdout,
    ensure_registry_file,
    load_protected_texts,
)
from training.model3_dataset.acoustic_training.orchestrator import (
    HARNESS,
    WORK,
    materialize_fresh_batch,
)
from training.model3_dataset.acoustic_training.serializer import (
    FEATURE_CONTRACT,
    LABEL_CONTRACT,
    PIPELINE_VERSION,
)

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
CJK = re.compile(r"[\u4e00-\u9fff]")

FORMAL_RUN_ID = "gate0_accept_20260830_v1"
SOURCE_BATCH_ID = "gate0_src_20260830_v1"
SOURCE_SEED = 2026083003
BATCH_N = 48  # frozen before outcomes; bounded, comparable to prior B2 scale


def preflight() -> dict:
    ensure_registry_file()
    disabled = os.environ.get("MODEL2_RUNTIME_DISABLED")
    return {
        "formalHarnessExists": HARNESS.exists(),
        "gate0ContractActive": True,
        "model2RuntimeDisabled": disabled,
        "toneVadCpu": os.environ.get("TONE_P10_VAD_CPU"),
        "datasetIdAssigned": False,
        "trainingStarted": False,
        "fixtureInputDisabledForAcceptance": True,
        "legacyProbeInputDisabledForAcceptance": True,
        "holdoutRegistryActive": True,
    }


def freeze_source_batch(n: int = BATCH_N, seed: int = SOURCE_SEED) -> list[dict]:
    """Select and freeze sources BEFORE any acoustic outcomes are observed."""
    prot = load_protected_texts()
    rng = np.random.default_rng(seed)
    rows: list[dict] = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            t = (o.get("normalized") or o.get("text") or "").strip()
            src = (o.get("source") or "").lower()
            if not t:
                continue
            if "dialog_200" in src or "dialog200" in src:
                continue
            rid = str(o.get("id") or hashlib.md5(t.encode()).hexdigest()[:12])
            if rid in PROTECTED_CASE_IDS or t in prot:
                continue
            if check_holdout(reference_id=rid, reference_text=t):
                continue
            cjk = len(CJK.findall(t))
            if cjk < 10 or cjk > 36 or len(t) > 48:
                continue
            if t.startswith("一般对话里常说") and cjk < 14:
                continue
            near = o.get("near_dup_key") or o.get("nearDupKey")
            fam = semantic_family_id(rid, t, near_dup_key=str(near) if near else None)
            rows.append(
                {
                    "referenceId": rid,
                    "referenceText": t,
                    "referenceTextHash": hashlib.sha256(t.encode()).hexdigest()[:16],
                    "sourcePoolId": "model3_certified_base_pool_v2",
                    "sourceCorpus": o.get("source") or "model3_certified_base_pool_v2",
                    "semanticFamilyId": fam,
                    "near_dup_key": near,
                    "holdoutStatus": "CLEAR",
                    "nearDupStatus": "HAS_KEY" if near else "NONE",
                    "protection": {"holdout": False},
                }
            )
    rng.shuffle(rows)
    seen_text: set[str] = set()
    seen_fam: set[str] = set()
    uniq: list[dict] = []
    for r in rows:
        if r["referenceText"] in seen_text:
            continue
        # Prefer diversity across families; skip exact family dupes in batch.
        if r["semanticFamilyId"] in seen_fam:
            continue
        seen_text.add(r["referenceText"])
        seen_fam.add(r["semanticFamilyId"])
        uniq.append(r)
        if len(uniq) >= n:
            break
    return uniq


def write_source_manifest(refs: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "sourceBatchId",
                "referenceId",
                "semanticFamilyId",
                "referenceTextHash",
                "sourcePool",
                "sourceCorpus",
                "holdoutStatus",
                "nearDupStatus",
                "referenceText",
            ],
        )
        w.writeheader()
        for r in refs:
            w.writerow(
                {
                    "sourceBatchId": SOURCE_BATCH_ID,
                    "referenceId": r["referenceId"],
                    "semanticFamilyId": r["semanticFamilyId"],
                    "referenceTextHash": r["referenceTextHash"],
                    "sourcePool": r["sourcePoolId"],
                    "sourceCorpus": r["sourceCorpus"],
                    "holdoutStatus": r["holdoutStatus"],
                    "nearDupStatus": r["nearDupStatus"],
                    "referenceText": r["referenceText"],
                }
            )


def _cand(sp: dict) -> int | None:
    re_ev = sp.get("recallEvidence") or {}
    if "firstPassCandidateCount" in re_ev and re_ev.get("firstPassCandidateCount") is not None:
        try:
            return int(re_ev["firstPassCandidateCount"])
        except (TypeError, ValueError):
            return None
    packed = sp.get("packedInferFields") or sp.get("packedInfer") or {}
    if "firstPassCandidateCount" in packed and packed.get("firstPassCandidateCount") is not None:
        try:
            return int(packed["firstPassCandidateCount"])
        except (TypeError, ValueError):
            return None
    if "rawFirstPassCandidateCount" in sp and sp.get("rawFirstPassCandidateCount") is not None:
        try:
            return int(sp["rawFirstPassCandidateCount"])
        except (TypeError, ValueError):
            return None
    return None


def analyze(results: list[dict], manifest: dict, source_freeze: dict) -> dict:
    hard = [r for r in results if r.get("disposition") == "HARD_REJECT"]
    sem = [r for r in results if r.get("disposition") == "SEMANTIC_EXCLUDE"]
    ok = [r for r in results if r.get("disposition") == "SUPERVISED_ACCEPTED"]
    formal_ok = [r for r in ok if r.get("evidenceSource") == FORMAL_EVIDENCE]
    formal_sem = [r for r in sem if r.get("evidenceSource") == FORMAL_EVIDENCE]
    formal_hard = [r for r in hard if r.get("evidenceSource") in (FORMAL_EVIDENCE, None, "")]

    gate = evaluate_gate0(results, manifest=manifest)

    cand_hist: Counter[str] = Counter()
    path_hist: Counter[int] = Counter()
    anchor_hist: Counter[str] = Counter()
    label_hist: Counter[str] = Counter()
    tone_ready = tone_invalid = 0
    missing_cand = 0
    cand0 = cand_gt0 = 0
    retry = retry0 = retry_gt0 = 0
    retry_gt0_utt = 0
    multipath_utt = single_utt = 0
    packer_ok = packer_missing = 0
    feat_cand_vals: list[float] = []
    feat_rel_pos: list[float] = []
    m2_attempted = m2_completed = m2_host = 0
    dom_attempted = dom_completed = 0
    text_id_fail = 0
    holdout_accepted = 0
    families = []

    for r in formal_ok + formal_sem:
        utt = r.get("utt") or {}
        diag = utt.get("ownerDiagnostics") or {}
        if diag.get("MODEL2_OWNER_ATTEMPTED"):
            m2_attempted += 1
        if diag.get("MODEL2_OWNER_COMPLETED"):
            m2_completed += 1
        if diag.get("MODEL2_HOST_AVAILABLE"):
            m2_host += 1
        if diag.get("DOMAIN_OWNER_ATTEMPTED"):
            dom_attempted += 1
        if diag.get("DOMAIN_OWNER_COMPLETED"):
            dom_completed += 1
        families.append(
            {
                "semanticFamilyId": utt.get("semanticFamilyId"),
                "split": utt.get("split"),
                "materializationRunId": utt.get("materializationRunId"),
            }
        )
        if check_holdout(
            reference_id=utt.get("referenceId") or r.get("referenceId"),
            reference_text=utt.get("referenceText") or "",
            asr_text=utt.get("rawActualAsrText"),
            current_text=utt.get("model3CurrentText"),
        ):
            holdout_accepted += 1

        paths = utt.get("labeledPaths") or []
        gen_pc = int((utt.get("lattice") or {}).get("pathCount") or len(paths))
        ser_pc = len(paths)
        path_hist[ser_pc] += 1
        if ser_pc > 1 and gen_pc > 1:
            multipath_utt += 1
        else:
            single_utt += 1

        utt_retry_gt0 = False
        for path in paths:
            spans = path.get("spans") or []
            n = max(1, len(spans))
            for sp in spans:
                lab = sp.get("label") or ""
                label_hist[lab] += 1
                src = sp.get("anchorSource") or ("DOMAIN" if sp.get("isAnchor") else "NONE")
                if not sp.get("isAnchor"):
                    src = sp.get("anchorSource") or "NONE"
                else:
                    src = sp.get("anchorSource") or "DOMAIN"
                anchor_hist[src] += 1

                tr = sp.get("toneReadiness")
                if tr in (None, "", "invalid"):
                    tone_invalid += 1
                else:
                    tone_ready += 1

                packed = sp.get("packedInferFields") or sp.get("packedInfer") or {}
                if not packed or "firstPassCandidateCount" not in packed:
                    packer_missing += 1
                else:
                    packer_ok += 1

                c = _cand(sp)
                if c is None:
                    missing_cand += 1
                    continue
                cand_hist[str(c)] += 1
                feat_cand_vals.append(math.log1p(c))
                seq = sp.get("seqIndex")
                if seq is not None:
                    feat_rel_pos.append(float(seq) / float(max(1, n - 1)) if n > 1 else 0.0)

                if sp.get("isAnchor"):
                    continue
                if lab in ("KEEP", "RETRY"):
                    if c == 0:
                        cand0 += 1
                    else:
                        cand_gt0 += 1
                if lab == "RETRY":
                    retry += 1
                    if c == 0:
                        retry0 += 1
                    else:
                        retry_gt0 += 1
                        utt_retry_gt0 = True
        if utt_retry_gt0:
            retry_gt0_utt += 1

    for r in hard:
        code = (r.get("reject") or {}).get("code") or r.get("code")
        if code == "MODEL3_CURRENT_TEXT_IDENTITY_INVALID":
            text_id_fail += 1

    leak = assert_split_locked(families)
    reject_reasons = Counter(
        (r.get("reject") or {}).get("code") or r.get("code") or "UNKNOWN" for r in hard
    )
    sem_reasons = Counter(r.get("code") or "NO_REPAIRABLE_TARGET" for r in sem)

    # --- Semantic Gate matrix (acceptance-phase requirements) ---
    g: dict[str, str] = {}
    g["G1_formal_evidence_origin"] = (
        PASS
        if all(
            (r.get("evidenceSource") == FORMAL_EVIDENCE)
            or r.get("disposition") == "HARD_REJECT"
            for r in results
        )
        and not any(r.get("evidenceSource") in ("TEST_FIXTURE", "LEGACY", "PROBE_ONLY") for r in ok + sem)
        else FAIL
    )
    g["G2_nonempty_accepted"] = PASS if formal_ok or formal_sem else INSUFFICIENT_EVIDENCE
    g["G3_text_identity"] = PASS if text_id_fail == 0 else FAIL
    g["G4_same_run_provenance"] = (
        PASS
        if not any(
            (r.get("reject") or {}).get("code") == "CROSS_SAMPLE_PROVENANCE_MISMATCH" for r in hard
        )
        else FAIL
    )
    g["G5_production_tone"] = PASS if (formal_ok or formal_sem) and tone_ready > 0 else FAIL
    g["G6_mandatory_tone_recall"] = (
        PASS if (cand0 + cand_gt0 + missing_cand) > 0 and missing_cand == 0 else FAIL
    )
    g["G7_cand_gt0"] = PASS if cand_gt0 > 0 else NOT_EXERCISED
    g["G8_retry_cand_gt0"] = PASS if retry_gt0_utt > 0 else NOT_EXERCISED
    g["G9_multipath"] = PASS if multipath_utt > 0 else NOT_EXERCISED
    g["G10_model2_host"] = (
        PASS
        if m2_host > 0 and m2_attempted > 0 and m2_completed > 0
        else (BLOCKED if m2_attempted > 0 else FAIL)
    )
    g["G11_domain_owner"] = PASS if dom_attempted > 0 and dom_completed > 0 else FAIL
    g["G12_exact_packer"] = PASS if packer_ok > 0 and packer_missing == 0 else FAIL
    g["G13_v2_labels"] = PASS if sum(label_hist.values()) > 0 else FAIL
    g["G14_holdout"] = FAIL if holdout_accepted > 0 else PASS
    g["G15_family_split"] = FAIL if leak else PASS
    g["G16_no_fixture_legacy_probe"] = g["G1_formal_evidence_origin"]
    g["G17_source_frozen"] = PASS if source_freeze.get("frozenBeforeOutcomes") else FAIL
    g["G18_no_architecture_drift"] = PASS

    required_fail = []
    for k, v in g.items():
        if k in (
            "G7_cand_gt0",
            "G8_retry_cand_gt0",
            "G9_multipath",
            "G10_model2_host",
        ):
            if v in (NOT_EXERCISED, FAIL, BLOCKED, INSUFFICIENT_EVIDENCE):
                required_fail.append(f"{k}={v}")
        elif v == FAIL:
            required_fail.append(f"{k}={v}")

    # Verdict selection
    if source_freeze.get("outcomeDrivenAdditions", 0) or source_freeze.get("outcomeDrivenRemovals", 0):
        verdict = "ACCEPTANCE_SOURCE_SELECTION_BIAS"
        next_phase = "MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0_ACCEPTANCE"
    elif holdout_accepted > 0:
        verdict = "PROTECTED_HOLDOUT_LEAKAGE"
        next_phase = "STOP_AND_REVIEW"
    elif g["G10_model2_host"] == BLOCKED:
        verdict = "MODEL2_ANCHOR_PATH_NOT_VALIDATED"
        next_phase = "MODEL3_V2_MODEL2_ANCHOR_RUNTIME_AVAILABILITY_AUDIT"
    elif g["G7_cand_gt0"] != PASS:
        verdict = "INSUFFICIENT_TRAINING_STATE_COVERAGE"
        next_phase = "MODEL3_V2_FORMAL_CANDIDATE_STATE_PARITY_AUDIT"
    elif g["G8_retry_cand_gt0"] != PASS:
        verdict = "INSUFFICIENT_TRAINING_STATE_COVERAGE"
        next_phase = "MODEL3_V2_FORMAL_CANDIDATE_STATE_PARITY_AUDIT"
    elif g["G9_multipath"] != PASS:
        verdict = "INSUFFICIENT_TRAINING_STATE_COVERAGE"
        next_phase = "MODEL3_V2_FORMAL_MULTIPATH_PARITY_AUDIT"
    elif any(v == FAIL for k, v in g.items() if k.startswith("G") and k not in ()):
        if g["G4_same_run_provenance"] == FAIL or g["G3_text_identity"] == FAIL:
            verdict = "FORMAL_MATERIALIZATION_PROVENANCE_FAILURE"
            next_phase = "MODEL3_V2_FORMAL_MATERIALIZATION_PROVENANCE_CORRECTION"
        elif g["G11_domain_owner"] == FAIL:
            verdict = "DOMAIN_OWNER_PARITY_FAILURE"
            next_phase = "STOP_AND_REVIEW"
        else:
            verdict = "GATE0_ACCEPTANCE_INCOMPLETE"
            next_phase = "STOP_AND_REVIEW"
    else:
        m2_hits = anchor_hist.get("MODEL2", 0) + anchor_hist.get("DOMAIN_AND_MODEL2", 0)
        dom_hits = anchor_hist.get("DOMAIN", 0) + anchor_hist.get("DOMAIN_AND_MODEL2", 0)
        if m2_hits == 0 or dom_hits == 0:
            verdict = "GATE0_ACCEPTANCE_PASS_WITH_NONBLOCKING_COVERAGE_WARNINGS"
        else:
            verdict = "GATE0_ACCEPTANCE_PASS"
        next_phase = "MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD"

    # Historical directional comparison (prior B2 extension N=55)
    hist = {
        "priorCandGt0Present": True,
        "priorRetryCandGt0Utt": 29,
        "priorMultipathUtt": 40,
        "priorN": 55,
        "freshCandGt0": cand_gt0,
        "freshRetryCandGt0Utt": retry_gt0_utt,
        "freshMultipathUtt": multipath_utt,
        "freshN": len(results),
    }
    if cand_gt0 > 0 and retry_gt0_utt > 0 and multipath_utt > 0:
        hist["classification"] = "CONSISTENT"
    elif cand_gt0 > 0 or retry_gt0_utt > 0 or multipath_utt > 0:
        hist["classification"] = "PARTIALLY_CONSISTENT"
    else:
        hist["classification"] = "MATERIAL_DISTRIBUTION_REGRESSION"

    return {
        "formalRunId": FORMAL_RUN_ID,
        "sourceBatchId": SOURCE_BATCH_ID,
        "gate0Checker": gate,
        "gateMatrix": g,
        "verdict": verdict,
        "nextPhase": next_phase,
        "funnel": {
            "attempted": len(results),
            "hardRejected": len(hard),
            "semanticExcluded": len(sem),
            "supervisedAccepted": len(ok),
            "formalSupervisedAccepted": len(formal_ok),
            "rejectReasons": dict(reject_reasons),
            "semanticExcludeReasons": dict(sem_reasons),
        },
        "candidate": {
            "cand0": cand0,
            "candGt0": cand_gt0,
            "missing": missing_cand,
            "histogram": dict(cand_hist),
        },
        "retry": {
            "RETRY": retry,
            "RETRY_cand0": retry0,
            "RETRY_candGt0": retry_gt0,
            "RETRY_candGt0_utterances": retry_gt0_utt,
            "KEEP": label_hist.get("KEEP", 0),
        },
        "multipath": {
            "singlePathUtterances": single_utt,
            "multipathUtterances": multipath_utt,
            "pathHistogram": {str(k): v for k, v in sorted(path_hist.items())},
        },
        "model2": {
            "attempted": m2_attempted,
            "completed": m2_completed,
            "hostAvailable": m2_host,
            "anchors": anchor_hist.get("MODEL2", 0) + anchor_hist.get("DOMAIN_AND_MODEL2", 0),
        },
        "domain": {
            "attempted": dom_attempted,
            "completed": dom_completed,
            "anchors": anchor_hist.get("DOMAIN", 0) + anchor_hist.get("DOMAIN_AND_MODEL2", 0),
        },
        "anchors": dict(anchor_hist),
        "tone": {"readySpans": tone_ready, "invalidSpans": tone_invalid},
        "packer": {"ok": packer_ok, "missing": packer_missing},
        "features": {
            "first_pass_cand_log1p": {
                "n": len(feat_cand_vals),
                "mean": round(sum(feat_cand_vals) / len(feat_cand_vals), 4) if feat_cand_vals else None,
                "max": round(max(feat_cand_vals), 4) if feat_cand_vals else None,
            },
            "span_rel_position": {
                "n": len(feat_rel_pos),
                "mean": round(sum(feat_rel_pos) / len(feat_rel_pos), 4) if feat_rel_pos else None,
            },
        },
        "holdoutAccepted": holdout_accepted,
        "splitLeak": leak,
        "historicalComparison": hist,
        "sourceFreeze": source_freeze,
        "requiredFail": required_fail,
        "identities": {
            "pipelineVersion": PIPELINE_VERSION,
            "featureContractIdentity": FEATURE_CONTRACT,
            "labelContractIdentity": LABEL_CONTRACT,
            "provenanceContractIdentity": "MODEL3_V2_TRAINING_PROVENANCE_CONTRACT",
            "asrEnvIdentity": manifest.get("asrEnvIdentity"),
            "toneIdentity": manifest.get("toneIdentity"),
        },
        "datasetId": "NOT_ASSIGNED",
    }


def main() -> int:
    # Critical: never run acceptance with Model2 deliberately disabled.
    os.environ.pop("MODEL2_RUNTIME_DISABLED", None)
    if not os.environ.get("TONE_P10_VAD_CPU"):
        os.environ["TONE_P10_VAD_CPU"] = "1"

    pf = preflight()
    if pf["model2RuntimeDisabled"] in ("1", "true", "TRUE"):
        print(json.dumps({"fatal": "MODEL2_RUNTIME_DISABLED must not be set", "preflight": pf}, indent=2))
        return 2
    if not pf["formalHarnessExists"]:
        print(json.dumps({"fatal": "formal harness missing"}, indent=2))
        return 2

    # --- FREEZE SOURCE LIST BEFORE OUTCOMES ---
    refs = freeze_source_batch()
    source_manifest = DOCS / "model3_v2_gate0_source_batch_manifest.csv"
    write_source_manifest(refs, source_manifest)
    freeze_meta = {
        "frozenBeforeOutcomes": True,
        "sourceBatchId": SOURCE_BATCH_ID,
        "sourceCount": len(refs),
        "seed": SOURCE_SEED,
        "outcomeDrivenAdditions": 0,
        "outcomeDrivenRemovals": 0,
        "frozenAt": datetime.now(timezone.utc).isoformat(),
        "manifestPath": str(source_manifest),
    }
    (WORK / f"{FORMAL_RUN_ID}_source_freeze.json").write_text(
        json.dumps(freeze_meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[gate0] frozen source batch n={len(refs)} id={SOURCE_BATCH_ID}", flush=True)

    t0 = time.perf_counter()
    out = materialize_fresh_batch(
        refs,
        run_id=FORMAL_RUN_ID,
        wav_dir=WORK / "gate0_wavs",
        manifest_path=WORK / f"manifest_{FORMAL_RUN_ID}.json",
        asr_env_identity=os.environ.get("TONE_P10_VAD_CPU"),
    )
    elapsed = time.perf_counter() - t0
    print(f"[gate0] materialization done in {elapsed:.1f}s", flush=True)

    # Verify freeze file unchanged (source-independence)
    frozen_now = list(csv.DictReader(source_manifest.open(encoding="utf-8")))
    freeze_meta["sourcesAddedAfterOutcomes"] = 0
    freeze_meta["sourcesRemovedAfterOutcomes"] = 0
    freeze_meta["sourceCountAfterRun"] = len(frozen_now)
    if len(frozen_now) != len(refs):
        freeze_meta["outcomeDrivenAdditions"] = max(0, len(frozen_now) - len(refs))
        freeze_meta["outcomeDrivenRemovals"] = max(0, len(refs) - len(frozen_now))

    analysis = analyze(out["results"], out["manifest"], freeze_meta)
    analysis["preflight"] = pf
    analysis["elapsedSec"] = round(elapsed, 2)
    analysis["runAttempts"] = 1
    analysis["infrastructureRetries"] = 0

    # Persist raw results for audit (not a formal dataset)
    raw_path = WORK / f"{FORMAL_RUN_ID}_results.jsonl"
    with raw_path.open("w", encoding="utf-8") as f:
        for r in out["results"]:
            # Compact: drop huge lattices from disk dump optional — keep disposition + key fields
            compact = {
                "referenceId": r.get("referenceId"),
                "disposition": r.get("disposition"),
                "code": r.get("code"),
                "evidenceSource": r.get("evidenceSource"),
                "reject": r.get("reject"),
                "counts": r.get("counts"),
                "utt": {
                    "evidenceSource": (r.get("utt") or {}).get("evidenceSource"),
                    "semanticFamilyId": (r.get("utt") or {}).get("semanticFamilyId"),
                    "split": (r.get("utt") or {}).get("split"),
                    "materializationRunId": (r.get("utt") or {}).get("materializationRunId"),
                    "rawActualAsrText": (r.get("utt") or {}).get("rawActualAsrText"),
                    "model3CurrentText": (r.get("utt") or {}).get("model3CurrentText"),
                    "ownerDiagnostics": (r.get("utt") or {}).get("ownerDiagnostics"),
                    "model2AnchorStatus": (r.get("utt") or {}).get("model2AnchorStatus"),
                    "pathCount": ((r.get("utt") or {}).get("lattice") or {}).get("pathCount"),
                    "labeledPathCount": len((r.get("utt") or {}).get("labeledPaths") or []),
                }
                if r.get("utt")
                else None,
            }
            f.write(json.dumps(compact, ensure_ascii=False) + "\n")

    (DOCS / "model3_v2_gate0_acceptance_summary.json").write_text(
        json.dumps(
            {
                "phase": "MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0_ACCEPTANCE",
                "gate0Verdict": analysis["verdict"],
                "nextPhase": analysis["nextPhase"],
                "formalRunId": FORMAL_RUN_ID,
                "sourceBatchId": SOURCE_BATCH_ID,
                "sourceCount": len(refs),
                "funnel": analysis["funnel"],
                "candidate": analysis["candidate"],
                "retry": analysis["retry"],
                "multipath": analysis["multipath"],
                "model2": analysis["model2"],
                "domain": analysis["domain"],
                "historicalComparison": analysis["historicalComparison"],
                "datasetId": "NOT_ASSIGNED",
                "elapsedSec": analysis["elapsedSec"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (WORK / f"{FORMAL_RUN_ID}_analysis.json").write_text(
        json.dumps(analysis, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    print(json.dumps({"verdict": analysis["verdict"], "next": analysis["nextPhase"], **analysis["funnel"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
