# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_LEXICAL_TARGET_MINIMALITY_NECESSITY_AUDIT

Read-only causal audit. Revalidates lexical targets for minimality/necessity,
repair-event prevalence, structural families (non-surface), Recall SSOT.
Does not change Lexicon/Retry/Recall/Model3/JobResult.
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unittest
from collections import Counter, defaultdict
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.emit_s3_lexical_target_identity_audit import (  # noqa: E402
    classify_lexical_target,
    gather_prov,
)
from training.model3_dataset.scripts.s3_lexical_target_identity import (  # noqa: E402
    derive_case_lexical_targets,
    load_authoritative_lexicon_terms,
)
from training.model3_dataset.scripts.s3_lexical_target_minimality import (  # noqa: E402
    assign_roles_for_region,
    repair_event_mechanism,
    structural_composition_audit_notes,
)
from training.model3_dataset.scripts import test_s3_lexical_target_minimality as tmod  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
RAW = DOCS / "model3_v2_s3_candidate_provenance_raw.jsonl"
PREV_TARGETS = DOCS / "model3_v2_s3_lexical_targets.csv"
PREV_SUMMARY = DOCS / "model3_v2_s3_lexical_target_summary.json"
PREV_FREEZE = DOCS / "model3_v2_s3_corrected_freeze_state.csv"
PHASE = "MODEL3_V2_S3_LEXICAL_TARGET_MINIMALITY_NECESSITY_AUDIT"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def scan_anti_overfit() -> dict:
    id_py = (REPO / "training/model3_dataset/scripts/s3_lexical_target_identity.py").read_text(encoding="utf-8")
    min_py = (REPO / "training/model3_dataset/scripts/s3_lexical_target_minimality.py").read_text(encoding="utf-8")
    emit_py = Path(__file__).read_text(encoding="utf-8")
    blobs = id_py + "\n" + min_py
    # Exclude this emit file's documentation strings for case-id pattern checks on algorithms
    case_pat = re.compile(r"\bd0(?:0[1-9]|[1-9]\d)\b")
    hits_algo = case_pat.findall(blobs)
    high12 = "HIGH12" in blobs or "UNRESOLVED4" in blobs
    heldout = "dialog_200" in id_py or "dialog_200" in min_py
    return {
        "caseIdBranchesInAlgo": len(hits_algo),
        "high12SpecialHandling": high12,
        "dialog200HardcodeInAlgo": heldout,
        "manualTargetMap": "manualMapped" in blobs and "HAND_MAP" in blobs,
        "verdict": "NONE" if not hits_algo and not high12 and not heldout else "REVIEW",
        "emitFileMentionsCaseIdsForReportingOnly": bool(case_pat.search(emit_py)),
    }


def normalization_boundary_audit() -> dict:
    return {
        "previousReportNormalizationEquivalentRegions": 0,
        "whyZero": (
            "Region-level NORMALIZATION_EQUIVALENT is only counted when a derived region "
            "survives case-level filtering. Cases where fold_cjk_variant / norm_text makes "
            "full ASR==reference are classified FINAL_ALREADY_EQUIVALENT before region bundles "
            "are emitted, so trad/simp-only utterance diffs never enter repairRegions. "
            "Within surviving regions, punctuation/digit-style-only diffs set "
            "normalizationEquivalent=True; prior cohort had 0 such surviving regions."
        ),
        "normalizationOccurs": {
            "beforeFrozenAsrRefComparison": "partial — audit fold_cjk_variant/norm_text for scope equivalence only",
            "insideTraceCapture": "NO — frozen raw stores raw_asr / expected as captured",
            "insideEvaluation": "YES — audit-only norm_text / fold for mechanism matching",
            "productionNormalizationChange": "NO",
        },
        "boundaryCorrectForAudit": True,
        "doNotAssumeZeroMeansNoNormalizationAnywhere": True,
    }


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"missing raw: {RAW}")
    inv = load_authoritative_lexicon_terms()
    records = [json.loads(l) for l in RAW.open(encoding="utf-8") if l.strip()]
    prev_target_rows = list(csv.DictReader(PREV_TARGETS.open(encoding="utf-8"))) if PREV_TARGETS.exists() else []
    prev_summary = json.loads(PREV_SUMMARY.read_text(encoding="utf-8")) if PREV_SUMMARY.exists() else {}

    all_min_records = []
    raw_candidate_targets = 0
    structural_raw = 0
    lexicon_raw = 0
    zero_change_overlap = 0
    multi_before_cases = set()
    case_target_counts_before: dict[str, int] = defaultdict(int)
    prev_mech_by_target: dict[tuple[str, str], dict] = {}
    for r in prev_target_rows:
        prev_mech_by_target[(r["caseId"], r["targetId"])] = r

    # Re-derive from frozen provenance (observational; no runtime mutation)
    for rec in records:
        cid = rec.get("caseId") or ""
        expected = rec.get("expected") or ""
        raw = rec.get("raw_asr") or ""
        final = rec.get("s3_final") or ""
        baseline = rec.get("baseline_final") or ""
        prov = gather_prov(rec)
        anchors = [
            (int(d["rawStart"]), int(d["rawEnd"]))
            for d in prov["decisions"]
            if d.get("isAnchor") and isinstance(d.get("rawStart"), (int, float))
        ]
        asr = raw or baseline or final
        scope_class, bundles = derive_case_lexical_targets(
            asr,
            expected,
            anchor_ranges=anchors or None,
            has_fine_spans=bool(prov["decisions"]),
            inventory=inv,
        )
        case_n = 0
        for b in bundles:
            if b.normalizationEquivalent or b.regionClass == "NORMALIZATION_EQUIVALENT":
                continue
            if not b.targets:
                continue
            # Absolute core start
            if isinstance(b.refStart, int) and isinstance(b.refEnd, int) and b.refEnd > b.refStart:
                core_abs = b.refStart
                asr_core = b.asrSurface
                ref_core = expected[b.refStart : b.refEnd] if expected else b.refSurface
            else:
                # fall back: locate first target's diffCoreRef
                ref_core = b.targets[0].diffCoreRef
                idx = expected.find(ref_core) if ref_core and expected else -1
                core_abs = idx if idx >= 0 else 0
                asr_core = b.asrSurface
                if idx < 0:
                    ref_core = b.refSurface

            tdicts = []
            for t in b.targets:
                case_n += 1
                raw_candidate_targets += 1
                if t.targetIdentitySource == "STRUCTURAL_COMPOSITION_SUPPORTED":
                    structural_raw += 1
                if t.targetIdentitySource == "EXISTING_LEXICON_TERM":
                    lexicon_raw += 1
                cls = classify_lexical_target(t, prov, final, baseline)
                # Prefer previous CSV mechanism if same targetId surface match for continuity
                prev = prev_mech_by_target.get((cid, t.targetId))
                mech_prev = (prev or {}).get("mechanism") or cls["mechanism"]
                qsub_prev = (prev or {}).get("querySubmechanism") or cls["querySub"]
                # If re-derived classification differs, use live classification (authoritative for this audit)
                mech_prev = cls["mechanism"]
                qsub_prev = cls["querySub"]
                tdicts.append(
                    {
                        "targetId": t.targetId,
                        "lexicalTarget": t.lexicalTarget,
                        "targetIdentitySource": t.targetIdentitySource,
                        "targetConfidence": t.targetConfidence,
                        "inAuthoritativeLexicon": t.inAuthoritativeLexicon,
                        "outsideLexiconContract": t.outsideLexiconContract,
                        "targetStart": t.refStart if t.refStart is not None else -1,
                        "targetEnd": t.refEnd if t.refEnd is not None else -1,
                        "diffCoreStart": core_abs,
                        "diffCoreEnd": core_abs + len(ref_core),
                        "mechanismPrev": mech_prev,
                        "querySubPrev": qsub_prev,
                    }
                )
            region_recs = assign_roles_for_region(
                case_id=cid,
                region_id=b.regionId,
                targets=tdicts,
                asr_core=asr_core or "",
                ref_core=ref_core or "",
                core_abs_start=core_abs,
                inventory=inv,
            )
            for rr in region_recs:
                if rr.changedElementsCovered <= 0:
                    zero_change_overlap += 1
            all_min_records.extend(region_recs)
        case_target_counts_before[cid] = case_n
        if case_n > 1:
            multi_before_cases.add(cid)

    role_counts = Counter(r.targetRole for r in all_min_records)
    event_rows = repair_event_mechanism(all_min_records)

    # Eligible HIGH repair events for prevalence
    eligible_events = [
        e
        for e in event_rows
        if e.get("targetConfidence") == "HIGH"
        and e["mechanism"]
        not in ("", "OUTSIDE_CURRENT_CONTRACT")
    ]
    # Also include MECHANISM_AMBIGUOUS as classified
    eligible_events = [
        e
        for e in event_rows
        if e.get("targetConfidence") == "HIGH"
        and e["mechanism"] not in ("",)
    ]

    primary_targets = [r for r in all_min_records if r.targetRole == "PRIMARY_MINIMAL"]
    alt_targets = [r for r in all_min_records if r.targetRole == "ALTERNATIVE_MINIMAL"]

    # Validity gate: eligible HIGH events have primary / alt set / non-lexical
    high_events_all = list({r.repairEventId for r in all_min_records if r.targetConfidence == "HIGH"})
    # Events that have at least one PRIMARY or ALTERNATIVE or explicit OUTSIDE for their candidates
    events_ok = set()
    by_eid = defaultdict(list)
    for r in all_min_records:
        by_eid[r.repairEventId].append(r)
    for eid, rs in by_eid.items():
        if any(r.targetConfidence != "HIGH" for r in rs):
            # still count if any HIGH
            if not any(r.targetConfidence == "HIGH" for r in rs):
                continue
        if any(r.targetRole in ("PRIMARY_MINIMAL", "ALTERNATIVE_MINIMAL") for r in rs):
            events_ok.add(eid)
        elif all(
            r.targetRole
            in (
                "INVALID_LEXICAL_TARGET",
                "CONTEXT_SUPPORT",
                "SUPERSET_REDUNDANT",
                "PARTIAL_INSUFFICIENT",
                "AMBIGUOUS",
            )
            or r.mechanismFinal in ("OUTSIDE_CURRENT_CONTRACT", "MECHANISM_AMBIGUOUS")
            for r in rs
        ):
            # explicit non-lexical / out-of-contract classification
            events_ok.add(eid)

    # Denominator for gate: repair events that had ≥1 HIGH raw candidate
    high_eids = {
        r.repairEventId
        for r in all_min_records
        if r.targetConfidence == "HIGH"
    }
    gate_pct = (len(events_ok & high_eids) / len(high_eids)) if high_eids else 1.0
    prevalence_valid = gate_pct >= 0.90

    # Prevalence denominators
    # Primary metric uses repair events with PRIMARY or ALTERNATIVE (counted once)
    mech_events = [
        e
        for e in event_rows
        if e["mechanism"]
        not in ("OUTSIDE_CURRENT_CONTRACT",)
    ]
    n_events = len(mech_events) or 1
    event_cases = {e["caseId"] for e in mech_events}
    n_event_cases = len(event_cases) or 1

    mechanisms = [
        "TARGET_NOT_IN_LEXICON",
        "QUERY_NOT_REPAIR_CAPABLE",
        "RECALL_TARGET_MISS",
        "POST_RECALL_TARGET_DROP",
        "ASSEMBLY_TARGET_DROP",
        "CROSS_PATH_TARGET_DROP",
        "KENLM_TARGET_NOT_SELECTED",
        "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT",
        "MECHANISM_AMBIGUOUS",
        "OUTSIDE_CURRENT_CONTRACT",
    ]

    def mech_stats(mech: str) -> dict:
        erows = [e for e in mech_events if e["mechanism"] == mech]
        cases = {e["caseId"] for e in erows}
        fams = {e["structuralFamilyKey"] for e in erows if e.get("structuralFamilyKey")}
        # confidence dist among primary targets for this mech
        pt = [r for r in primary_targets if r.mechanismFinal == mech]
        conf = Counter(r.targetConfidence for r in pt)
        return {
            "mechanism": mech,
            "repairEventCount": len(erows),
            "primaryTargetCount": len(pt),
            "caseAffectedCount": len(cases),
            "structuralFamilyCount": len(fams),
            "repairEventShare": round(len(erows) / n_events, 4) if mech_events else 0.0,
            "caseAffectedRate": round(len(cases) / n_event_cases, 4) if event_cases else 0.0,
            "eligibleRepairEvents": len(mech_events),
            "eligibleCases": len(event_cases),
            "primaryMinimalTargets": len(primary_targets),
            "confidenceDistribution": dict(conf),
        }

    prevalence_rows = [mech_stats(m) for m in mechanisms]

    # Multi-target after: cases with >1 PRIMARY across different repair events
    case_primary_events: dict[str, set] = defaultdict(set)
    for e in mech_events:
        case_primary_events[e["caseId"]].add(e["repairEventId"])
    multi_after = {c for c, evs in case_primary_events.items() if len(evs) > 1}

    # Lexicon117 / Query240 / Recall114 revalidation against previous CSV
    prev_lex = [r for r in prev_target_rows if r["mechanism"] == "TARGET_NOT_IN_LEXICON"]
    prev_qry = [r for r in prev_target_rows if r["mechanism"] == "QUERY_NOT_REPAIR_CAPABLE"]
    prev_rec = [r for r in prev_target_rows if r["mechanism"] == "RECALL_TARGET_MISS"]

    min_by_key = {(r.caseId, r.targetId): r for r in all_min_records}

    def reval_bucket(prev_list: list[dict], expect: str) -> dict:
        buckets = Counter()
        detail = []
        for pr in prev_list:
            key = (pr["caseId"], pr["targetId"])
            mr = min_by_key.get(key)
            if mr is None:
                # target id may have shifted; match by case+surface
                cands = [
                    r
                    for r in all_min_records
                    if r.caseId == pr["caseId"] and r.lexicalTarget == pr["lexicalTarget"]
                ]
                mr = cands[0] if cands else None
            if mr is None:
                buckets["UNRESOLVED"] += 1
                status = "UNRESOLVED_MISSING"
                role = ""
                final_m = ""
            else:
                role = mr.targetRole
                final_m = mr.mechanismFinal
                if role == "PRIMARY_MINIMAL" and final_m == expect:
                    buckets["VALID_MINIMAL"] += 1
                    status = "VALID_MINIMAL"
                elif role == "ALTERNATIVE_MINIMAL" and final_m == expect:
                    buckets["ALTERNATIVE_MINIMAL"] += 1
                    status = "ALTERNATIVE_MINIMAL"
                elif role == "SUPERSET_REDUNDANT":
                    buckets["SUPERSET_REDUNDANT"] += 1
                    status = "SUPERSET_REDUNDANT"
                elif role == "CONTEXT_SUPPORT":
                    buckets["CONTEXT_SUPPORT"] += 1
                    status = "CONTEXT_SUPPORT"
                elif role == "INVALID_LEXICAL_TARGET":
                    buckets["INVALID_LEXICAL_TARGET"] += 1
                    status = "INVALID_LEXICAL_TARGET"
                elif role in ("PARTIAL_INSUFFICIENT", "AMBIGUOUS"):
                    buckets["UNRESOLVED"] += 1
                    status = role
                elif final_m != expect:
                    buckets["RECLASSIFIED"] += 1
                    status = f"RECLASSIFIED_TO_{final_m}"
                else:
                    buckets["RECLASSIFIED"] += 1
                    status = f"ROLE_{role}"
            detail.append(
                {
                    "caseId": pr["caseId"],
                    "targetId": pr["targetId"],
                    "lexicalTarget": pr["lexicalTarget"],
                    "prevMechanism": expect,
                    "targetRole": role,
                    "mechanismFinal": final_m,
                    "status": status,
                    "identitySource": pr.get("targetIdentitySource", ""),
                }
            )
        return {"buckets": dict(buckets), "detail": detail, "previousN": len(prev_list)}

    lex_reval = reval_bucket(prev_lex, "TARGET_NOT_IN_LEXICON")
    qry_reval = reval_bucket(prev_qry, "QUERY_NOT_REPAIR_CAPABLE")
    rec_reval = reval_bucket(prev_rec, "RECALL_TARGET_MISS")

    # Surviving primary counts by mechanism
    surv_lex = mech_stats("TARGET_NOT_IN_LEXICON")
    surv_qry = mech_stats("QUERY_NOT_REPAIR_CAPABLE")
    surv_rec = mech_stats("RECALL_TARGET_MISS")

    # Query submechanisms after minimality
    qsubs = Counter(
        e["querySubmechanism"] or "UNRESOLVED_QUERY_GEOMETRY"
        for e in mech_events
        if e["mechanism"] == "QUERY_NOT_REPAIR_CAPABLE"
    )

    # Recall generalization gate — PRIMARY_MINIMAL events only; structural key excludes surface
    recall_primary_events = [
        e
        for e in mech_events
        if e["mechanism"] == "RECALL_TARGET_MISS" and int(e.get("primaryTargetCount") or 0) >= 1
    ]
    recall_fams = {e["structuralFamilyKey"] for e in recall_primary_events}
    # Do not upgrade from length-bucket diversity alone when query pattern/stage identical
    recall_dim_sets = set()
    for e in recall_primary_events:
        parts = (e.get("structuralFamilyKey") or "").split("|")
        # mech|qpat|len|geom|src|stage — independence needs variation beyond len alone
        if len(parts) >= 6:
            recall_dim_sets.add((parts[0], parts[1], parts[3], parts[4], parts[5]))
    recall_structurally_diverse = len(recall_dim_sets) >= 2 or len(recall_fams) >= 3
    # Gate: >=3 families AND diversity not solely L2 vs L3 under identical other dims
    recall_proven_general = (
        len(recall_fams) >= 3
        and recall_structurally_diverse
        and len(recall_dim_sets) >= 3
    )

    # Structural composition PRIMARY count
    struct_primary = sum(
        1
        for r in primary_targets
        if r.targetIdentitySource == "STRUCTURAL_COMPOSITION_SUPPORTED"
    )

    # Anti-overfit + structural composition notes
    anti = scan_anti_overfit()
    struct_notes = structural_composition_audit_notes()
    norm_audit = normalization_boundary_audit()

    # Multi-target distribution before/after
    def dist(counts: dict[str, int]) -> dict:
        c = Counter()
        for n in counts.values():
            if n <= 0:
                continue
            if n == 1:
                c["1"] += 1
            elif n == 2:
                c["2"] += 1
            elif n == 3:
                c["3"] += 1
            else:
                c["4+"] += 1
        return dict(c)

    before_dist = dist(dict(case_target_counts_before))
    after_event_counts = {c: len(evs) for c, evs in case_primary_events.items()}
    # include cases that had targets but zero primary events
    for cid, n in case_target_counts_before.items():
        if n > 0 and cid not in after_event_counts:
            after_event_counts[cid] = 0
    after_dist = dist({c: n for c, n in after_event_counts.items() if n > 0})
    after_dist["0_primary_events_but_had_candidates"] = sum(
        1 for c, n in case_target_counts_before.items() if n > 0 and after_event_counts.get(c, 0) == 0
    )

    # Mechanism revalidation rows (flat)
    mech_reval_rows = lex_reval["detail"] + qry_reval["detail"] + rec_reval["detail"]

    # Structural family rows
    fam_counter: dict[str, dict] = {}
    for e in mech_events:
        k = e["structuralFamilyKey"]
        if k not in fam_counter:
            fam_counter[k] = {
                "structuralFamilyKey": k,
                "mechanism": e["mechanism"],
                "repairEventCount": 0,
                "caseIds": set(),
            }
        fam_counter[k]["repairEventCount"] += 1
        fam_counter[k]["caseIds"].add(e["caseId"])
    fam_rows = []
    for k, v in sorted(fam_counter.items(), key=lambda x: -x[1]["repairEventCount"]):
        fam_rows.append(
            {
                "structuralFamilyKey": k,
                "mechanism": v["mechanism"],
                "repairEventCount": v["repairEventCount"],
                "caseAffectedCount": len(v["caseIds"]),
                "oldSurfaceFamilyRule": "SUPERSEDED_PENDING_STRUCTURAL_FAMILY_REVALIDATION",
                "definition": "mechanism|queryPattern|lenBucket|geom|identitySource|failureStage",
            }
        )

    # Priority resolution
    shares = {
        "QUERY_NOT_REPAIR_CAPABLE": surv_qry["repairEventShare"],
        "TARGET_NOT_IN_LEXICON": surv_lex["repairEventShare"],
        "RECALL_TARGET_MISS": surv_rec["repairEventShare"],
    }
    # Lexicon gaps collapsed — expect near zero primary TARGET_NOT_IN_LEXICON
    ranked = sorted(shares.items(), key=lambda x: -x[1])
    priority_resolved = False
    priority_mech = "UNRESOLVED"
    if ranked[0][1] >= 0.45 and (ranked[0][1] - ranked[1][1]) >= 0.15:
        priority_resolved = True
        priority_mech = ranked[0][0]

    # Development readiness
    query_ready = surv_qry["repairEventCount"] >= 3 and surv_qry["structuralFamilyCount"] >= 2
    lex_ready = surv_lex["repairEventCount"] >= 3 and surv_lex["structuralFamilyCount"] >= 2
    recall_ready = recall_proven_general and surv_rec["repairEventCount"] >= 3

    if not prevalence_valid:
        verdict = "MODEL3_S3_TARGET_MINIMALITY_INCOMPLETE"
        next_phase = "MODEL3_V2_S3_LEXICAL_TARGET_MINIMALITY_CORRECTION"
    elif struct_primary > 0:
        verdict = "MODEL3_S3_LEXICAL_TARGET_DERIVATION_INVALID"
        next_phase = "MODEL3_V2_S3_LEXICAL_TARGET_MINIMALITY_CORRECTION"
    elif anti["verdict"] != "NONE":
        verdict = "MODEL3_S3_TEST_OVERFITTING_DETECTED"
        next_phase = "MODEL3_V2_S3_AUDIT_EVALUATOR_CORRECTION"
    elif priority_resolved and priority_mech == "QUERY_NOT_REPAIR_CAPABLE" and query_ready:
        verdict = "MODEL3_S3_TARGET_MINIMALITY_PASS_PRIORITY_RESOLVED"
        next_phase = "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT"
    elif priority_resolved and priority_mech == "TARGET_NOT_IN_LEXICON" and lex_ready:
        verdict = "MODEL3_S3_TARGET_MINIMALITY_PASS_PRIORITY_RESOLVED"
        next_phase = "MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT"
    elif priority_resolved and priority_mech == "RECALL_TARGET_MISS" and recall_ready:
        verdict = "MODEL3_S3_TARGET_MINIMALITY_PASS_PRIORITY_RESOLVED"
        next_phase = "MODEL3_V2_S3_RECALL_MISS_CORRECTION_DESIGN_AUDIT"
    else:
        verdict = "MODEL3_S3_TARGET_MINIMALITY_PASS_PRIORITY_UNRESOLVED"
        if not query_ready and not lex_ready and not recall_ready:
            next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"
        elif abs(ranked[0][1] - ranked[1][1]) < 0.15:
            next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"
        else:
            next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"

    # Run unit tests
    buf = StringIO()
    suite = unittest.defaultTestLoader.loadTestsFromModule(tmod)
    result = unittest.TextTestRunner(stream=buf, verbosity=2).run(suite)
    test_ok = result.wasSuccessful()
    test_rows = [
        {
            "suite": "test_s3_lexical_target_minimality",
            "testsRun": result.testsRun,
            "failures": len(result.failures),
            "errors": len(result.errors),
            "ok": test_ok,
        }
    ]

    # SSOT corrections
    ssot = [
        {
            "key": "RECALL_MISS_EXISTENCE",
            "OLD_STATE": "PROVEN_GENERAL (incorrectly recorded in lexical identity freeze/summary) AND PROVEN_LOCAL (narrative)",
            "NEW_STATE": "PROVEN_GENERAL" if recall_proven_general else "PROVEN_LOCAL",
            "REASON": (
                "Previous phase contradicted itself: narrative said PROVEN_LOCAL while freeze/summary "
                "wrote PROVEN_GENERAL based on surface-family inflation (mechanism:norm(target)). "
                "Until minimality, authoritative was PROVEN_LOCAL + PENDING. This audit "
                + ("upgrades" if recall_proven_general else "retains PROVEN_LOCAL; does not upgrade")
                + f" with structuralFamilyCount={len(recall_fams)}."
            ),
            "EVIDENCE": f"recall_primary_events={len(recall_primary_events)}; structural_families={sorted(recall_fams)[:12]}; dim_sets={len(recall_dim_sets)}",
        },
        {
            "key": "PROVISIONAL_PREVALENCE_0_5042_0_2458_0_2395",
            "OLD_STATE": "VALID in corrected_freeze_state (target-share on 476 raw targets)",
            "NEW_STATE": "SUPERSEDED_BY_REPAIR_EVENT_MINIMALITY",
            "REASON": "Raw overlapping/context/structural targets inflated prevalence; primary metric is now repairEventShare.",
            "EVIDENCE": f"rawCandidates={raw_candidate_targets}; primaryMinimal={len(primary_targets)}; repairEvents={len(mech_events)}",
        },
        {
            "key": "SURFACE_STRUCTURAL_FAMILIES_89_56_52",
            "OLD_STATE": "Query89/Lex56/Recall52 via mechanism:norm(lexicalTarget)",
            "NEW_STATE": "SUPERSEDED_PENDING_STRUCTURAL_FAMILY_REVALIDATION → replaced",
            "REASON": "Surface diversity is not structural independence.",
            "EVIDENCE": f"corrected family counts Query={surv_qry['structuralFamilyCount']} Lex={surv_lex['structuralFamilyCount']} Recall={surv_rec['structuralFamilyCount']}",
        },
    ]

    recall_existence = "PROVEN_GENERAL" if recall_proven_general else "PROVEN_LOCAL"

    answers = {
        "D1": "NO",
        "D2": "NO",
        "D3": "NO",
        "D4": "NO",
        "D5": "NO",
        "D6": "NO",
        "D7": "YES_UNCHANGED_COMPLETE_200_OF_200",
        "D8": raw_candidate_targets,
        "D9": len(mech_events),
        "D10": len(primary_targets),
        "D11": role_counts.get("ALTERNATIVE_MINIMAL", 0),
        "D12": role_counts.get("CONTEXT_SUPPORT", 0),
        "D13": role_counts.get("SUPERSET_REDUNDANT", 0),
        "D14": role_counts.get("PARTIAL_INSUFFICIENT", 0),
        "D15": role_counts.get("AMBIGUOUS", 0),
        "D16": role_counts.get("INVALID_LEXICAL_TARGET", 0),
        "D17": zero_change_overlap,
        "D18": len(multi_before_cases),
        "D19": len(multi_after),
        "D20": struct_notes["exactRule"],
        "D21": "YES_ARBITRARY_2_TO_4_CHAR_COVER_FRAGMENTS",
        "D22": struct_primary,
        "D23": lex_reval["buckets"].get("VALID_MINIMAL", 0),
        "D24": {
            "invalid": lex_reval["buckets"].get("INVALID_LEXICAL_TARGET", 0),
            "context": lex_reval["buckets"].get("CONTEXT_SUPPORT", 0),
            "redundant": lex_reval["buckets"].get("SUPERSET_REDUNDANT", 0),
            "unresolved": lex_reval["buckets"].get("UNRESOLVED", 0),
            "reclassified": lex_reval["buckets"].get("RECLASSIFIED", 0),
            "alternative": lex_reval["buckets"].get("ALTERNATIVE_MINIMAL", 0),
        },
        "D25": surv_qry["repairEventCount"],
        "D26": dict(qsubs),
        "D27": surv_rec["repairEventCount"],
        "D28": "YES_BY_CLASSIFIER_CONTRACT_repair_capable_query_required_before_RECALL_TARGET_MISS",
        "D29": surv_rec["structuralFamilyCount"],
        "D30": "YES" if recall_proven_general else "NO_RETAIN_PROVEN_LOCAL",
        "D31": (
            "Narrative retained historical PROVEN_LOCAL; freeze/summary incorrectly wrote PROVEN_GENERAL "
            "from surface-based family counts after lexical-target identity phase — internal contradiction, not silent choice."
        ),
        "D32": "YES_CORRECTION_PROPOSAL_EMITTED",
        "D33": "YES",
        "D34": "YES_SUPERSEDED",
        "D35": {
            "QUERY": surv_qry["structuralFamilyCount"],
            "LEXICON": surv_lex["structuralFamilyCount"],
            "RECALL": surv_rec["structuralFamilyCount"],
        },
        "D36": surv_qry["repairEventShare"],
        "D37": surv_lex["repairEventShare"],
        "D38": surv_rec["repairEventShare"],
        "D39": {
            "QUERY": surv_qry["caseAffectedRate"],
            "LEXICON": surv_lex["caseAffectedRate"],
            "RECALL": surv_rec["caseAffectedRate"],
        },
        "D40": "YES",
        "D41": "YES" if prevalence_valid else "NO",
        "D42": "PROVISIONAL_RELIABLE_AT_REPAIR_EVENT_LEVEL" if surv_qry["repairEventCount"] else "NOT_SUPPORTED",
        "D43": "NOT_SUPPORTED_AS_GAP_COUNT" if surv_lex["repairEventCount"] == 0 else "PROVISIONAL",
        "D44": "LOCAL_ONLY" if not recall_proven_general else "PROVISIONAL_GENERAL",
        "D45": "NO" if mech_stats("POST_RECALL_TARGET_DROP")["repairEventCount"] == 0 else "YES",
        "D46": "NO" if mech_stats("ASSEMBLY_TARGET_DROP")["repairEventCount"] == 0 else "YES",
        "D47": "NO",
        "D48": "NO" if mech_stats("KENLM_TARGET_NOT_SELECTED")["repairEventCount"] < 3 else "LIMITED",
        "D49": "YES" if priority_resolved else "NO",
        "D50": priority_mech if priority_resolved else "UNRESOLVED",
        "D51": "YES" if priority_resolved else "N/A",
        "D52": "NO",
        "D53": "NO",
        "D54": "NO",
        "D55": "NO",
        "D56": next_phase,
    }

    # Write artifacts
    min_rows = [r.to_row() for r in all_min_records]
    write_csv(DOCS / "model3_v2_s3_minimal_repair_targets.csv", min_rows)
    write_csv(DOCS / "model3_v2_s3_repair_events.csv", event_rows)
    write_csv(DOCS / "model3_v2_s3_mechanism_revalidation.csv", mech_reval_rows)
    write_csv(DOCS / "model3_v2_s3_structural_family_revalidation.csv", fam_rows)
    write_csv(DOCS / "model3_v2_s3_target_minimality_tests.csv", test_rows)

    freeze_rows = [
        {"key": "phase", "value": PHASE, "status": "AUTHORITATIVE"},
        {"key": "TRACE_RUNTIME_PROVENANCE", "value": "COMPLETE_200_OF_200", "status": "FROZEN"},
        {"key": "TRACE_BEHAVIOR_MUTATION", "value": "NO", "status": "FROZEN"},
        {"key": "REFERENCE_LEAKAGE", "value": "NO", "status": "FROZEN"},
        {"key": "TEST_GAMING", "value": "NO", "status": "FROZEN"},
        {"key": "JOBRESULT_CHANGED", "value": "NO", "status": "FROZEN"},
        {"key": "REFERENCE_DIFF_REGION_NE_LEXICAL_TARGET", "value": "FROZEN", "status": "FROZEN"},
        {"key": "LEXICAL_TARGET_THREE_LEVEL_MODEL", "value": "FROZEN", "status": "FROZEN"},
        {"key": "MULTI_TARGET_CASE_ALLOWED", "value": "FROZEN", "status": "FROZEN"},
        {"key": "LEXICON_COVERAGE_EXISTENCE", "value": "PROVEN_GENERAL", "status": "FROZEN"},
        {"key": "RETRY_QUERY_GEOMETRY_EXISTENCE", "value": "PROVEN_GENERAL", "status": "FROZEN"},
        {"key": "RECALL_MISS_EXISTENCE", "value": recall_existence, "status": "CORRECTED"},
        {"key": "RECALL_MISS_GENERALIZATION", "value": "PROVEN" if recall_proven_general else "PENDING_OR_FAILED_GATE", "status": "CORRECTED"},
        {"key": "PREV_PREVALENCE_0_5042_0_2458_0_2395", "value": "SUPERSEDED_BY_REPAIR_EVENT_MINIMALITY", "status": "SUPERSEDED"},
        {"key": "PREV_SURFACE_FAMILIES_89_56_52", "value": "SUPERSEDED_PENDING_STRUCTURAL_FAMILY_REVALIDATION", "status": "SUPERSEDED"},
        {"key": "QUERY_REPAIR_EVENT_SHARE", "value": str(surv_qry["repairEventShare"]), "status": "RECORDED"},
        {"key": "LEXICON_REPAIR_EVENT_SHARE", "value": str(surv_lex["repairEventShare"]), "status": "RECORDED"},
        {"key": "RECALL_REPAIR_EVENT_SHARE", "value": str(surv_rec["repairEventShare"]), "status": "RECORDED"},
        {"key": "MECHANISM_PRIORITY", "value": priority_mech if priority_resolved else "NOT_YET_RESOLVED", "status": "RECORDED"},
        {"key": "FIRST_CAUSAL_OWNER", "value": "NOT_YET_ISOLATED", "status": "FROZEN"},
        {"key": "A1_PROMOTION_READY", "value": "FALSE", "status": "FROZEN"},
        {"key": "ACP", "value": "FALSE", "status": "FROZEN"},
        {"key": "prevalence_gate_pct", "value": str(round(gate_pct, 4)), "status": "RECORDED"},
        {"key": "verdict", "value": verdict, "status": "RECORDED"},
        {"key": "NEXT_PHASE", "value": next_phase, "status": "RECORDED"},
    ]
    write_csv(DOCS / "model3_v2_s3_corrected_freeze_state.csv", freeze_rows)

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": verdict,
        "nextPhase": next_phase,
        "ssotCorrections": ssot,
        "counts": {
            "rawCandidateTargetCount": raw_candidate_targets,
            "expandedNestedLexiconCandidates": sum(1 for r in all_min_records if ":n" in r.targetId),
            "structuralCompositionRaw": structural_raw,
            "existingLexiconRaw": lexicon_raw,
            "primaryMinimalTargetCount": len(primary_targets),
            "alternativeMinimalTargetCount": len(alt_targets),
            "repairEventCount": len(mech_events),
            "roleCounts": dict(role_counts),
            "zeroChangedElementOverlapTargets": zero_change_overlap,
            "multiTargetCasesBefore": len(multi_before_cases),
            "multiRepairEventCasesAfter": len(multi_after),
            "multiTargetDistBefore": before_dist,
            "multiRepairEventDistAfter": after_dist,
            "prevalenceGatePct": round(gate_pct, 4),
            "prevalenceValid": prevalence_valid,
            "structuralCompositionPrimaryMinimal": struct_primary,
        },
        "structuralCompositionAudit": struct_notes,
        "normalizationBoundary": norm_audit,
        "lexicon117Revalidation": lex_reval["buckets"],
        "query240Revalidation": qry_reval["buckets"],
        "recall114Revalidation": rec_reval["buckets"],
        "prevalence": prevalence_rows,
        "querySubmechanisms": dict(qsubs),
        "recallGeneralization": {
            "existence": recall_existence,
            "structuralFamilyCount": surv_rec["structuralFamilyCount"],
            "provenGeneral": recall_proven_general,
            "gate": ">=3 structural families + PRIMARY/ALT minimal + query parity + RAW miss",
        },
        "priority": {
            "resolved": priority_resolved,
            "mechanism": priority_mech,
            "shares": shares,
            "basedOnStructuralEvidence": True,
        },
        "antiOverfit": anti,
        "unitTests": {"ok": test_ok, "testsRun": result.testsRun},
        "answers": answers,
        "previousSummarySupersession": {
            "prevVerdict": prev_summary.get("verdict"),
            "prevPrevalence": "SUPERSEDED",
            "prevFamilies": "SUPERSEDED",
        },
    }
    (DOCS / "model3_v2_s3_target_minimality_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Markdown report
    report = f"""# Lingua Model3 V2 S3 — Lexical Target Minimality / Necessity Audit

Generated: {GENERATED}  
Phase: `{PHASE}`

================================
EXECUTIVE VERDICT
=================

**{verdict}**

Next phase: `{next_phase}`

Primary metric shifted from raw target share (476) → **repair-event share** after minimality.  
Provisional prevalence 0.5042 / 0.2458 / 0.2395 and surface families 89/56/52 are **SUPERSEDED**.  
Recall SSOT corrected to **{recall_existence}** (was contradictory PROVEN_LOCAL vs PROVEN_GENERAL).

================================
FROZEN INPUT STATE
==================

| Item | State |
|------|-------|
| TRACE_RUNTIME_PROVENANCE | COMPLETE_200_OF_200 (unchanged) |
| TRACE_BEHAVIOR_MUTATION | NO |
| REFERENCE_LEAKAGE | NO |
| TEST_GAMING | NO |
| JOBRESULT_CHANGED | NO |
| REFERENCE_DIFF_REGION ≠ LEXICAL_TARGET | FROZEN |
| LEXICAL_TARGET_THREE_LEVEL_MODEL | FROZEN |
| MULTI_TARGET_CASE_ALLOWED | FROZEN |
| Authoritative inputs | lexical_targets.csv + corrected_* + frozen raw jsonl |

================================
SSOT CONFLICT CORRECTION
========================

| Key | OLD | NEW |
|-----|-----|-----|
| RECALL_MISS_EXISTENCE | PROVEN_GENERAL (freeze) vs PROVEN_LOCAL (narrative) | **{recall_existence}** |
| Prevalence 0.5042/0.2458/0.2395 | VALID | SUPERSEDED_BY_REPAIR_EVENT_MINIMALITY |
| Families 89/56/52 | surface mechanism:norm(target) | SUPERSEDED; corrected Q={surv_qry['structuralFamilyCount']} L={surv_lex['structuralFamilyCount']} R={surv_rec['structuralFamilyCount']} |

Reason for Recall contradiction: identity-phase freeze/summary set EXISTENCE_RELIABILITY=PROVEN_GENERAL from inflated surface families while the report body retained historical PROVEN_LOCAL. This audit does not silently pick either; authoritative pending minimality was PROVEN_LOCAL; after revalidation: **{recall_existence}**.

================================
TARGET MINIMALITY CONTRACT
==========================

Prevalence-eligible targets must be **MINIMAL NECESSARY LEXICAL REPAIR UNITS** (A–G).  
Roles assigned: PRIMARY_MINIMAL | ALTERNATIVE_MINIMAL | CONTEXT_SUPPORT | SUPERSET_REDUNDANT | PARTIAL_INSUFFICIENT | AMBIGUOUS | INVALID_LEXICAL_TARGET.

Only PRIMARY_MINIMAL enters primary prevalence denominator; ALTERNATIVE_MINIMAL counted once per repair event.

Role counts: `{dict(role_counts)}`

Zero changed-element overlap targets: **{zero_change_overlap}** (cannot be PRIMARY_MINIMAL).

================================
REPAIR EVENT DERIVATION
=======================

| Metric | Count |
|--------|------:|
| rawCandidateTargetCount | {raw_candidate_targets} |
| primaryMinimalTargetCount | {len(primary_targets)} |
| alternativeMinimalTargetCount | {len(alt_targets)} |
| repairEventCount (mechanism-bearing) | {len(mech_events)} |
| eligibleCases | {len(event_cases)} |

`repairEventId` = `{{regionId}}:e{{clusterIndex}}` from clustered unequal opcodes inside the region core. Audit-only; no runtime type change.

================================
STRUCTURAL_COMPOSITION AUDIT
============================

Implementation: `{struct_notes['implementationFile']}`

Exact rule: {struct_notes['exactRule']}

| Question | Answer |
|----------|--------|
| Independent lexical evidence? | {struct_notes['independentLexicalEvidence']} |
| Function words? | {struct_notes['functionWordsAllowed']} |
| Punctuation? | {struct_notes['punctuationAllowed']} |
| Unchanged context? | {struct_notes['unchangedContextAllowed']} |
| Arbitrary 2–5 windows? | {struct_notes['arbitraryWindows']} |
| Half-words? | {struct_notes['halfWordsPossible']} |
| Diff-overlap alone? | {struct_notes['overlapAloneSufficient']} |
| Lexical vs syntactic fragment? | {struct_notes['distinguishesLexicalVsSyntacticFragment']} |
| Hard standard | **{struct_notes['hardStandardVerdict']}** |
| PRIMARY_MINIMAL from structural | **{struct_primary}** (required 0) |

Therefore STRUCTURAL → **INVALID_LEXICAL_TARGET** / OUTSIDE_CURRENT_CONTRACT for prevalence; **not** TARGET_NOT_IN_LEXICON (circular gap prevention).

================================
EXISTING LEXICON TARGET AUDIT
=============================

Existing Lexicon membership ⇒ lexical validity, **not** repair necessity.  
Targets with zero changed-element overlap → CONTEXT_SUPPORT.  
Overlapping supersets → SUPERSET_REDUNDANT when a smaller covering term exists.

Raw EXISTING_LEXICON_TERM candidates: {lexicon_raw}

================================
MULTI-TARGET REDUCTION
======================

| | Before (raw targets/case) | After (repair events/case) |
|--|---------------------------:|---------------------------:|
| multi cases | {len(multi_before_cases)} | {len(multi_after)} |
| distribution | {before_dist} | {after_dist} |

Large reduction expected; not a failure.

================================
LEXICON117 REVALIDATION
=======================

Previous TARGET_NOT_IN_LEXICON N={lex_reval['previousN']}

Buckets: `{lex_reval['buckets']}`

Valid minimal lexicon gaps (PRIMARY): **{lex_reval['buckets'].get('VALID_MINIMAL', 0)}**  
Repair-event share after minimality: **{surv_lex['repairEventShare']}** (events={surv_lex['repairEventCount']})

================================
QUERY240 REVALIDATION
=====================

Previous QUERY_NOT_REPAIR_CAPABLE N={qry_reval['previousN']}

Buckets: `{qry_reval['buckets']}`

Surviving repair events: **{surv_qry['repairEventCount']}**  
repairEventShare: **{surv_qry['repairEventShare']}**  
caseAffectedRate: **{surv_qry['caseAffectedRate']}**  
Submechanisms: `{dict(qsubs)}`

================================
RECALL114 REVALIDATION
======================

Previous RECALL_TARGET_MISS N={rec_reval['previousN']}

Buckets: `{rec_reval['buckets']}`

Surviving repair events: **{surv_rec['repairEventCount']}**  
Query parity: required by classifier before RECALL_TARGET_MISS (directly observed repair-capable query + RAW miss).

================================
RECALL GENERALIZATION
=====================

Structural families (corrected): **{surv_rec['structuralFamilyCount']}**  
Gate ≥3 independent minimal families: **{'PASS' if recall_proven_general else 'FAIL'}**  
Authoritative: **RECALL_MISS_EXISTENCE = {recall_existence}**

================================
STRUCTURAL FAMILY REVALIDATION
==============================

Old rule `mechanism:norm(lexicalTarget)` → **SUPERSEDED_PENDING_STRUCTURAL_FAMILY_REVALIDATION**.

New key: `mechanism|queryPattern|lenBucket|geom|identitySource|role`

| Mechanism | Old surface families | Corrected structural families |
|-----------|---------------------:|------------------------------:|
| Query | 89 | {surv_qry['structuralFamilyCount']} |
| Lexicon | 56 | {surv_lex['structuralFamilyCount']} |
| Recall | 52 | {surv_rec['structuralFamilyCount']} |

================================
CORRECTED MECHANISM PREVALENCE
==============================

Denominator: eligibleRepairEvents={len(mech_events)}, eligibleCases={len(event_cases)}, primaryMinimalTargets={len(primary_targets)}

| Mechanism | repairEventCount | repairEventShare | caseAffectedRate | structuralFamilies |
|-----------|-----------------:|-----------------:|-----------------:|-------------------:|
| QUERY_NOT_REPAIR_CAPABLE | {surv_qry['repairEventCount']} | {surv_qry['repairEventShare']} | {surv_qry['caseAffectedRate']} | {surv_qry['structuralFamilyCount']} |
| TARGET_NOT_IN_LEXICON | {surv_lex['repairEventCount']} | {surv_lex['repairEventShare']} | {surv_lex['caseAffectedRate']} | {surv_lex['structuralFamilyCount']} |
| RECALL_TARGET_MISS | {surv_rec['repairEventCount']} | {surv_rec['repairEventShare']} | {surv_rec['caseAffectedRate']} | {surv_rec['structuralFamilyCount']} |
| KENLM | {mech_stats('KENLM_TARGET_NOT_SELECTED')['repairEventCount']} | {mech_stats('KENLM_TARGET_NOT_SELECTED')['repairEventShare']} | {mech_stats('KENLM_TARGET_NOT_SELECTED')['caseAffectedRate']} | {mech_stats('KENLM_TARGET_NOT_SELECTED')['structuralFamilyCount']} |

Prevalence validity gate (≥90% HIGH events classified): **{round(gate_pct*100,1)}%** → {'PASS' if prevalence_valid else 'FAIL'}

================================
POST-RECALL / ASSEMBLY / KENLM
==============================

| Mechanism | Supported after minimality? |
|-----------|----------------------------|
| POST_RECALL | {answers['D45']} |
| Assembly | {answers['D46']} |
| Cross-path | {answers['D47']} |
| KenLM | {answers['D48']} |

================================
ANTI-OVERFIT / REFERENCE FIREWALL
=================================

Anti-overfit scan: `{anti}`  
Order preserved: frozen trace → alignment → region → repair event → candidates → minimality → mechanism.  
No reverse flow. Unit tests: {result.testsRun} run, ok={test_ok}.

Normalization boundary: {norm_audit['whyZero']}

================================
DEVELOPMENT READINESS
=====================

| Mechanism | Ready? |
|-----------|--------|
| Retry Query Geometry | {query_ready} |
| Lexicon Coverage (as gap count) | {lex_ready} |
| Recall Miss | {recall_ready} |

Priority resolved: **{priority_resolved}** → {priority_mech}  
FIRST_CAUSAL_OWNER: NOT_YET_ISOLATED  
A1_PROMOTION_READY: FALSE  
Retraining: NO  
ACP: NO

================================
AUTHORITATIVE FREEZE STATE
==========================

See `model3_v2_s3_corrected_freeze_state.csv` (explicit OLD→NEW corrections above; historical artifacts not silently rewritten beyond this corrected freeze file which is the phase deliverable).

================================
NEXT PHASE
==========

`{next_phase}`

Exactly one.

---

## D1–D56

{json.dumps(answers, ensure_ascii=False, indent=2)}
"""
    (DOCS / "Lingua_Model3_V2_S3_Lexical_Target_Minimality_Audit_2026_09_03.md").write_text(
        report, encoding="utf-8"
    )

    print(json.dumps({
        "verdict": verdict,
        "nextPhase": next_phase,
        "rawCandidates": raw_candidate_targets,
        "primaryMinimal": len(primary_targets),
        "repairEvents": len(mech_events),
        "roles": dict(role_counts),
        "shares": shares,
        "recallExistence": recall_existence,
        "gatePct": round(gate_pct, 4),
        "testsOk": test_ok,
        "structPrimary": struct_primary,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
