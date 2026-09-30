# -*- coding: utf-8 -*-
"""MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0 — independent evidence checker.

Acceptance is derived from formal fresh materialization artifacts only.
Status flags may be diagnostic; they are never authoritative alone.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from training.model3_dataset.acoustic_training.family_identity import assert_split_locked
from training.model3_dataset.acoustic_training.orchestrator import HARNESS

GATE0_ID = "MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0"

FORMAL_EVIDENCE = "FORMAL_FRESH_MATERIALIZATION"
REJECTED_EVIDENCE_ORIGINS = frozenset(
    {
        "TEST_FIXTURE",
        "LEGACY",
        "PROBE_ONLY",
        "HISTORICAL_NON_PARITY_INPUT",
    }
)

# Check outcome vocabulary (avoid pure booleans for unexercised checks).
PASS = "PASS"
FAIL = "FAIL"
NOT_EXERCISED = "NOT_EXERCISED"
INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
BLOCKED = "BLOCKED"


def _harness_source() -> str:
    return HARNESS.read_text(encoding="utf-8") if HARNESS.exists() else ""


def _harness_wires_model2() -> bool:
    """WIRED = formal harness imports + invokes production Model2 owner.

    Must NOT use the diagnostic flag string as evidence (tautology).
    """
    text = _harness_source()
    if "runLatticeFineSpanGenerationWithPreEdgeModel2" not in text:
        return False
    # Call-site on formal path (await or direct call with object args).
    return bool(
        re.search(r"await\s+runLatticeFineSpanGenerationWithPreEdgeModel2\s*\(", text)
        or re.search(r"runLatticeFineSpanGenerationWithPreEdgeModel2\s*\(\s*\{", text)
    )


def _harness_wires_domain() -> bool:
    """WIRED = formal harness invokes production Domain vote + Anchor materializer."""
    text = _harness_source()
    return (
        "voteUtteranceDomainFromPool" in text
        and "materializeModel3Anchors" in text
        and bool(re.search(r"voteUtteranceDomainFromPool\s*\(", text))
        and bool(re.search(r"materializeModel3Anchors\s*\(", text))
    )


def _evidence_source(row: dict[str, Any]) -> str:
    utt = row.get("utt") or {}
    lat = utt.get("lattice") or {}
    return (
        row.get("evidenceSource")
        or utt.get("evidenceSource")
        or lat.get("evidenceSource")
        or ""
    )


def _owner_diagnostics(utt: dict[str, Any]) -> dict[str, Any]:
    """Prefer ownerDiagnostics; fall back to aliases only as raw observation input.

    Gate0 still re-derives acceptance from observed fields + serialized spans —
    injectable aliases alone cannot unlock acceptance without formal evidenceSource.
    """
    diag = dict(utt.get("ownerDiagnostics") or {})
    own = utt.get("ownerExecution") or {}
    # Fill missing diagnostic keys from aliases for observation counts only.
    if "MODEL2_OWNER_ATTEMPTED" not in diag and "MODEL2_ANCHOR_OWNER_EXECUTED" in own:
        diag["MODEL2_OWNER_ATTEMPTED"] = bool(own.get("MODEL2_ANCHOR_OWNER_EXECUTED"))
    if "MODEL2_OWNER_COMPLETED" not in diag and "MODEL2_OWNER_ATTEMPTED" in diag:
        # Legacy alias conflated attempted/executed — do not invent COMPLETED.
        pass
    if "MODEL2_HOST_AVAILABLE" not in diag and "MODEL2_ANCHOR_HOST_AVAILABLE" in own:
        diag["MODEL2_HOST_AVAILABLE"] = bool(own.get("MODEL2_ANCHOR_HOST_AVAILABLE"))
    if "MODEL2_HIT_OBSERVED" not in diag and "MODEL2_ANCHOR_HIT_OBSERVED" in own:
        diag["MODEL2_HIT_OBSERVED"] = bool(own.get("MODEL2_ANCHOR_HIT_OBSERVED"))
    if "DOMAIN_OWNER_ATTEMPTED" not in diag and "DOMAIN_ANCHOR_OWNER_EXECUTED" in own:
        diag["DOMAIN_OWNER_ATTEMPTED"] = bool(own.get("DOMAIN_ANCHOR_OWNER_EXECUTED"))
    if "DOMAIN_OWNER_COMPLETED" not in diag and "DOMAIN_ANCHOR_OWNER_EXECUTED" in own:
        # Without explicit COMPLETED, treat EXECUTED alias as attempted only.
        pass
    if "DOMAIN_HIT_OBSERVED" not in diag and "DOMAIN_ANCHOR_HIT_OBSERVED" in own:
        diag["DOMAIN_HIT_OBSERVED"] = bool(own.get("DOMAIN_ANCHOR_HIT_OBSERVED"))
    return diag


def _span_candidate_count(sp: dict[str, Any]) -> int | None:
    """Return candidate count if present; None if missing/malformed (not cand=0)."""
    re_ev = sp.get("recallEvidence")
    if isinstance(re_ev, dict) and "firstPassCandidateCount" in re_ev:
        v = re_ev.get("firstPassCandidateCount")
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    packed = sp.get("packedInferFields") or sp.get("packedInfer") or {}
    if isinstance(packed, dict) and "firstPassCandidateCount" in packed:
        v = packed.get("firstPassCandidateCount")
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    # Serialized sample field
    if "rawFirstPassCandidateCount" in sp:
        v = sp.get("rawFirstPassCandidateCount")
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    return None


def _anchor_source_of(sp: dict[str, Any]) -> str:
    if sp.get("isAnchor"):
        return str(sp.get("anchorSource") or "DOMAIN")
    return str(sp.get("anchorSource") or "NONE")


def evaluate_gate0(
    batch_results: list[dict[str, Any]],
    *,
    manifest: dict[str, Any] | None = None,
) -> dict:
    """Evaluate Gate0 from formal evidence. Never self-assert PASS from flags alone."""
    checks: dict[str, Any] = {}
    statuses: dict[str, str] = {}

    hard = [r for r in batch_results if r.get("disposition") == "HARD_REJECT"]
    sem = [r for r in batch_results if r.get("disposition") == "SEMANTIC_EXCLUDE"]
    ok = [r for r in batch_results if r.get("disposition") == "SUPERVISED_ACCEPTED"]

    # --- Structural readiness (≠ acceptance) ---
    checks["formal_harness_exists"] = HARNESS.exists()
    checks["MODEL2_OWNER_WIRED"] = _harness_wires_model2()
    checks["DOMAIN_OWNER_WIRED"] = _harness_wires_domain()
    # Backward-compatible aliases for report readers
    checks["MODEL2_ANCHOR_OWNER_WIRED"] = checks["MODEL2_OWNER_WIRED"]
    checks["DOMAIN_ANCHOR_OWNER_WIRED"] = checks["DOMAIN_OWNER_WIRED"]

    readiness_ok = bool(checks["formal_harness_exists"] and checks["MODEL2_OWNER_WIRED"] and checks["DOMAIN_OWNER_WIRED"])
    checks["readyForGate0AcceptanceRun"] = readiness_ok  # structural only

    # --- Evidence trust boundary ---
    evidence_origins = Counter()
    non_formal_rows = []
    for r in batch_results:
        src = _evidence_source(r) or "MISSING_EVIDENCE_SOURCE"
        evidence_origins[src] += 1
        if src in REJECTED_EVIDENCE_ORIGINS or src == "MISSING_EVIDENCE_SOURCE":
            if r.get("disposition") in ("SUPERVISED_ACCEPTED", "SEMANTIC_EXCLUDE", "HARD_REJECT"):
                non_formal_rows.append(r)

    formal_ok = [r for r in ok if _evidence_source(r) == FORMAL_EVIDENCE]
    formal_sem = [r for r in sem if _evidence_source(r) == FORMAL_EVIDENCE]
    formal_hard = [r for r in hard if _evidence_source(r) == FORMAL_EVIDENCE]
    formal_materialized = formal_ok + formal_sem

    checks["evidence_origin_histogram"] = dict(evidence_origins)
    if any(_evidence_source(r) in REJECTED_EVIDENCE_ORIGINS for r in ok + sem):
        statuses["evidence_trust"] = FAIL
        checks["evidence_trust_failure"] = "NON_FORMAL_GATE0_EVIDENCE"
    elif not batch_results:
        statuses["evidence_trust"] = INSUFFICIENT_EVIDENCE
        checks["evidence_trust_failure"] = "INSUFFICIENT_FORMAL_EVIDENCE"
    elif not formal_materialized and not formal_hard and batch_results:
        # Batch present but no formal evidence
        statuses["evidence_trust"] = FAIL
        checks["evidence_trust_failure"] = "NON_FORMAL_GATE0_EVIDENCE"
    else:
        statuses["evidence_trust"] = PASS
        checks["evidence_trust_failure"] = None

    # Empty formal accepted utterances → cannot overall PASS
    formal_accepted_n = len(formal_ok)
    if formal_accepted_n == 0 and len(formal_materialized) == 0:
        statuses["batch_sufficiency"] = INSUFFICIENT_EVIDENCE
        checks["empty_formal_batch"] = True
    else:
        statuses["batch_sufficiency"] = PASS
        checks["empty_formal_batch"] = False

    # --- Accounting from ledger / dispositions (not hardcoded True) ---
    man = manifest or {}
    hard_n = int(man.get("hardRejected") or len(hard))
    sem_n = int(man.get("semanticExcluded") or len(sem))
    # Prefer formal-row accounting when evaluating acceptance
    formal_hard_n = len(formal_hard) if formal_hard or formal_materialized else hard_n
    formal_sem_n = len(formal_sem) if formal_hard or formal_materialized else sem_n

    sem_reasons = man.get("semanticExcludeReasons") or {}
    hard_reasons = man.get("hardRejectReasons") or {}
    no_repairable_in_sem = (
        int(sem_reasons.get("NO_REPAIRABLE_TARGET") or 0) > 0
        or any((r.get("code") == "NO_REPAIRABLE_TARGET") for r in formal_sem)
    )
    # SEMANTIC_EXCLUDE must not be counted as HARD_REJECT
    sem_misclassified = any(r.get("disposition") == "HARD_REJECT" and r.get("code") == "NO_REPAIRABLE_TARGET" for r in batch_results)

    if formal_sem_n == 0 and sem_n == 0:
        statuses["semantic_exclude_distinguished"] = NOT_EXERCISED
        checks["semantic_exclude_distinguished"] = False
        checks["semantic_exclude_contract"] = "CONTRACT_IMPLEMENTED"
    elif sem_misclassified:
        statuses["semantic_exclude_distinguished"] = FAIL
        checks["semantic_exclude_distinguished"] = False
        checks["semantic_exclude_contract"] = "CONTRACT_EXERCISED_IN_THIS_BATCH"
    elif no_repairable_in_sem or formal_sem_n > 0:
        statuses["semantic_exclude_distinguished"] = PASS
        checks["semantic_exclude_distinguished"] = True
        checks["semantic_exclude_contract"] = "CONTRACT_EXERCISED_IN_THIS_BATCH"
    else:
        statuses["semantic_exclude_distinguished"] = NOT_EXERCISED
        checks["semantic_exclude_distinguished"] = False
        checks["semantic_exclude_contract"] = "CONTRACT_IMPLEMENTED"

    if formal_hard_n == 0 and hard_n == 0:
        statuses["hard_reject_distinguished"] = NOT_EXERCISED
        checks["hard_reject_distinguished"] = False
        checks["hard_reject_contract"] = "CONTRACT_IMPLEMENTED"
    else:
        # Internally consistent: at least one HARD_REJECT has a code / reject ledger entry
        consistent = any(
            (r.get("reject") or {}).get("code") or r.get("code") for r in (formal_hard or hard)
        ) or bool(hard_reasons)
        if consistent and not sem_misclassified:
            statuses["hard_reject_distinguished"] = PASS
            checks["hard_reject_distinguished"] = True
            checks["hard_reject_contract"] = "CONTRACT_EXERCISED_IN_THIS_BATCH"
        else:
            statuses["hard_reject_distinguished"] = FAIL
            checks["hard_reject_distinguished"] = False
            checks["hard_reject_contract"] = "CONTRACT_EXERCISED_IN_THIS_BATCH"

    # --- Derive Model2 / Domain from formal run diagnostics + serialized anchors ---
    m2_attempted = m2_completed = m2_host = m2_hit_diag = 0
    dom_attempted = dom_completed = 0
    families = []
    multipath_utt = 0
    cand0 = cand_gt0 = retry_gt0 = 0
    cand_missing = 0
    retry_cand_gt0_utt = 0
    anchor_hist: Counter[str] = Counter()

    for r in formal_materialized:
        utt = r.get("utt") or {}
        diag = _owner_diagnostics(utt)
        if diag.get("MODEL2_OWNER_ATTEMPTED"):
            m2_attempted += 1
        if diag.get("MODEL2_OWNER_COMPLETED"):
            m2_completed += 1
        if diag.get("MODEL2_HOST_AVAILABLE"):
            m2_host += 1
        if diag.get("MODEL2_HIT_OBSERVED"):
            m2_hit_diag += 1
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

        paths = utt.get("labeledPaths") or (utt.get("lattice") or {}).get("paths") or []
        path_n = len(paths)
        lat_pc = (utt.get("lattice") or {}).get("pathCount")
        if lat_pc is not None:
            try:
                path_n = max(path_n, int(lat_pc))
            except (TypeError, ValueError):
                pass
        if path_n > 1:
            multipath_utt += 1

        utt_retry_gt0 = False
        for path in paths:
            for sp in path.get("spans") or []:
                src = _anchor_source_of(sp)
                anchor_hist[src] += 1
                if sp.get("isAnchor"):
                    continue
                lab = sp.get("label")
                cand = _span_candidate_count(sp)
                if cand is None:
                    cand_missing += 1
                    continue
                if lab in ("KEEP", "RETRY"):
                    if cand == 0:
                        cand0 += 1
                    else:
                        cand_gt0 += 1
                    if lab == "RETRY" and cand > 0:
                        retry_gt0 += 1
                        utt_retry_gt0 = True
        if utt_retry_gt0:
            retry_cand_gt0_utt += 1

    # Anchor hits from serialized sources (not standalone HIT flags)
    m2_hit_serialized = anchor_hist.get("MODEL2", 0) + anchor_hist.get("DOMAIN_AND_MODEL2", 0)
    dom_hit_serialized = anchor_hist.get("DOMAIN", 0) + anchor_hist.get("DOMAIN_AND_MODEL2", 0)

    checks["cand0SpanCount"] = cand0
    checks["candGt0SpanCount"] = cand_gt0
    checks["retryCandGt0SpanCount"] = retry_gt0
    checks["retryCandGt0UtteranceCount"] = retry_cand_gt0_utt
    checks["candMissingSpanCount"] = cand_missing
    checks["anchorSourceHistogram"] = dict(anchor_hist)
    checks["multipathUtteranceCount"] = multipath_utt

    # Candidate gate signals derived from counts
    if not formal_materialized:
        statuses["cand_0_natural"] = INSUFFICIENT_EVIDENCE
        statuses["cand_gt0_natural"] = INSUFFICIENT_EVIDENCE
        statuses["retry_cand_gt0_present"] = INSUFFICIENT_EVIDENCE
        checks["cand_0_natural"] = False
        checks["cand_gt0_natural"] = False
        checks["retry_cand_gt0_present"] = False
    else:
        if cand_missing > 0:
            statuses["cand_state_integrity"] = FAIL
            checks["cand_state_integrity"] = False
        else:
            statuses["cand_state_integrity"] = PASS
            checks["cand_state_integrity"] = True
        statuses["cand_0_natural"] = PASS if cand0 > 0 else NOT_EXERCISED
        statuses["cand_gt0_natural"] = PASS if cand_gt0 > 0 else NOT_EXERCISED
        statuses["retry_cand_gt0_present"] = PASS if retry_gt0 > 0 else NOT_EXERCISED
        checks["cand_0_natural"] = cand0 > 0
        checks["cand_gt0_natural"] = cand_gt0 > 0
        checks["retry_cand_gt0_present"] = retry_gt0 > 0

    # Multipath: codepath present vs exercised
    checks["MULTIPATH_CODEPATH_PRESENT"] = (
        "pathFineSpanViews" in _harness_source() or "pathCount" in _harness_source()
    )
    if not formal_materialized:
        statuses["multipath_retention"] = INSUFFICIENT_EVIDENCE
        checks["multipath_retention"] = False
        checks["MULTIPATH_EXERCISED_IN_BATCH"] = False
    elif multipath_utt > 0:
        statuses["multipath_retention"] = PASS
        checks["multipath_retention"] = True
        checks["MULTIPATH_EXERCISED_IN_BATCH"] = True
    else:
        statuses["multipath_retention"] = NOT_EXERCISED
        checks["multipath_retention"] = False
        checks["MULTIPATH_EXERCISED_IN_BATCH"] = False

    # Model2 path status
    checks["MODEL2_OWNER_ATTEMPTED"] = m2_attempted > 0
    checks["MODEL2_OWNER_COMPLETED"] = m2_completed > 0
    checks["MODEL2_HOST_AVAILABLE_ANY"] = m2_host > 0
    checks["MODEL2_HIT_OBSERVED"] = m2_hit_serialized > 0
    checks["MODEL2_HIT_DIAG_OBSERVED"] = m2_hit_diag > 0
    # Legacy names
    checks["MODEL2_ANCHOR_OWNER_EXECUTED"] = m2_attempted > 0
    checks["MODEL2_ANCHOR_HIT_OBSERVED"] = m2_hit_serialized > 0

    if not checks["MODEL2_OWNER_WIRED"]:
        model2_path = "FAIL_NOT_WIRED"
        statuses["model2_path"] = FAIL
    elif not formal_materialized:
        model2_path = "INSUFFICIENT_EVIDENCE"
        statuses["model2_path"] = INSUFFICIENT_EVIDENCE
    elif m2_attempted == 0:
        model2_path = "FAIL_NOT_ATTEMPTED"
        statuses["model2_path"] = FAIL
    elif m2_completed == 0:
        model2_path = "FAIL_NOT_COMPLETED"
        statuses["model2_path"] = FAIL
    elif m2_host == 0:
        model2_path = "MODEL2_ANCHOR_PATH_NOT_VALIDATED"
        statuses["model2_path"] = BLOCKED
    else:
        model2_path = "PASS_OWNER_PARITY"
        statuses["model2_path"] = PASS
        if m2_hit_serialized == 0:
            model2_path = "PASS_OWNER_PARITY_COVERAGE_WARNING_NO_HIT"

    # Domain path
    checks["DOMAIN_OWNER_ATTEMPTED"] = dom_attempted > 0
    checks["DOMAIN_OWNER_COMPLETED"] = dom_completed > 0
    checks["DOMAIN_ANCHOR_HIT_OBSERVED"] = dom_hit_serialized > 0
    checks["DOMAIN_ANCHOR_OWNER_EXECUTED"] = dom_attempted > 0

    if not checks["DOMAIN_OWNER_WIRED"]:
        domain_path = "FAIL_NOT_WIRED"
        statuses["domain_path"] = FAIL
    elif not formal_materialized:
        domain_path = "INSUFFICIENT_EVIDENCE"
        statuses["domain_path"] = INSUFFICIENT_EVIDENCE
    elif dom_attempted == 0 or dom_completed == 0:
        # Injected EXECUTED without COMPLETED cannot prove Domain completion
        if dom_attempted > 0 and dom_completed == 0:
            domain_path = "FAIL_NOT_COMPLETED"
            statuses["domain_path"] = FAIL
        elif dom_attempted == 0:
            domain_path = "FAIL_NOT_ATTEMPTED"
            statuses["domain_path"] = FAIL
        else:
            domain_path = "FAIL_NOT_EXECUTED"
            statuses["domain_path"] = FAIL
    else:
        domain_path = "PASS_OWNER_PARITY"
        statuses["domain_path"] = PASS
        if dom_hit_serialized == 0:
            domain_path = "PASS_OWNER_PARITY_COVERAGE_WARNING_NO_HIT"

    # Anchor histogram agreement
    if not formal_materialized:
        statuses["anchor_histogram"] = INSUFFICIENT_EVIDENCE
    else:
        statuses["anchor_histogram"] = PASS
    checks["ANCHOR_HIT_OBSERVED"] = (m2_hit_serialized + dom_hit_serialized) > 0

    leak = assert_split_locked(families)
    checks["semanticFamily_split_lock"] = len(leak) == 0
    checks["split_leak_errors"] = leak
    statuses["semanticFamily_split_lock"] = FAIL if leak else (PASS if families else NOT_EXERCISED)

    # --- Acceptance aggregation ---
    semantic_fail: list[str] = []
    if not checks["formal_harness_exists"]:
        semantic_fail.append("formal_harness_missing")
    if checks.get("evidence_trust_failure"):
        semantic_fail.append(checks["evidence_trust_failure"])
    elif statuses.get("batch_sufficiency") == INSUFFICIENT_EVIDENCE:
        semantic_fail.append("INSUFFICIENT_FORMAL_EVIDENCE")
    if model2_path.startswith("FAIL"):
        semantic_fail.append(model2_path)
    if model2_path == "MODEL2_ANCHOR_PATH_NOT_VALIDATED":
        semantic_fail.append(model2_path)
    if domain_path.startswith("FAIL"):
        semantic_fail.append(domain_path)
    if leak:
        semantic_fail.append("SPLIT_IDENTITY_FAILURE")
    if statuses.get("cand_state_integrity") == FAIL:
        semantic_fail.append("RECALL_STATE_INVALID")
    if statuses.get("semantic_exclude_distinguished") == FAIL:
        semantic_fail.append("SEMANTIC_EXCLUDE_ACCOUNTING_FAIL")
    if statuses.get("hard_reject_distinguished") == FAIL:
        semantic_fail.append("HARD_REJECT_ACCOUNTING_FAIL")

    # Overall acceptance cannot PASS on empty / non-formal / blocked Model2
    if semantic_fail:
        only_insufficient = all(
            x in ("INSUFFICIENT_FORMAL_EVIDENCE",)
            for x in semantic_fail
        )
        if only_insufficient:
            acceptance = INSUFFICIENT_EVIDENCE
        elif "NON_FORMAL_GATE0_EVIDENCE" in semantic_fail:
            acceptance = FAIL
        elif "MODEL2_ANCHOR_PATH_NOT_VALIDATED" in semantic_fail and not any(
            x.startswith("FAIL")
            or x in ("NON_FORMAL_GATE0_EVIDENCE", "SPLIT_IDENTITY_FAILURE", "RECALL_STATE_INVALID")
            for x in semantic_fail
            if x != "MODEL2_ANCHOR_PATH_NOT_VALIDATED"
        ):
            acceptance = BLOCKED
        else:
            acceptance = FAIL
    else:
        # Exercised-required signals may be NOT_EXERCISED (nonblocking until acceptance run).
        acceptance = PASS

    # Deduplicate failure codes for readability
    semantic_fail = list(dict.fromkeys(semantic_fail))

    nonblocking = []
    for w in (model2_path, domain_path):
        if "COVERAGE_WARNING" in w:
            nonblocking.append(w)
    if statuses.get("multipath_retention") == NOT_EXERCISED:
        nonblocking.append("MULTIPATH_NOT_EXERCISED")
    if statuses.get("cand_gt0_natural") == NOT_EXERCISED:
        nonblocking.append("CAND_GT0_NOT_EXERCISED")
    if statuses.get("retry_cand_gt0_present") == NOT_EXERCISED:
        nonblocking.append("RETRY_CAND_GT0_NOT_EXERCISED")
    if statuses.get("semantic_exclude_distinguished") == NOT_EXERCISED:
        nonblocking.append("SEMANTIC_EXCLUDE_NOT_EXERCISED")
    if statuses.get("hard_reject_distinguished") == NOT_EXERCISED:
        nonblocking.append("HARD_REJECT_NOT_EXERCISED")

    return {
        "gate0Id": GATE0_ID,
        "readyForGate0AcceptanceRun": readiness_ok,
        "acceptanceVerdict": acceptance,
        "acceptancePassed": acceptance == PASS,
        "model2PathStatus": model2_path,
        "domainPathStatus": domain_path,
        "checkStatuses": statuses,
        "checks": checks,
        "semanticFailures": semantic_fail,
        "nonblockingWarnings": nonblocking,
        "batchSummary": {
            "hardRejected": len(hard),
            "semanticExcluded": len(sem),
            "supervisedAccepted": len(ok),
            "formalSupervisedAccepted": formal_accepted_n,
            "formalSemanticExcluded": len(formal_sem),
            "formalHardRejected": len(formal_hard),
            "cand0SpanCount": cand0,
            "candGt0SpanCount": cand_gt0,
            "retryCandGt0SpanCount": retry_gt0,
            "retryCandGt0UtteranceCount": retry_cand_gt0_utt,
            "multipathUtterances": multipath_utt,
            "anchorSourceHistogram": dict(anchor_hist),
        },
        "formalRunIdentity": {
            "pipelineVersion": man.get("pipelineVersion"),
            "sourcePoolId": man.get("sourcePoolId"),
            "featureContractIdentity": man.get("featureContractIdentity"),
            "labelContractIdentity": man.get("labelContractIdentity"),
            "provenanceContractIdentity": man.get("provenanceContractIdentity"),
            "asrEnvIdentity": man.get("asrEnvIdentity"),
            "toneIdentity": man.get("toneIdentity"),
            "runId": man.get("runId"),
        },
        "note": (
            "Independent evidence checker — readyForGate0AcceptanceRun is structural only; "
            "do not treat it as Gate0 PASS. Do not assign MODEL3_V2_TARGETED_DIST_CORRECTED_V1 here."
        ),
    }


def write_gate0_readiness(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
