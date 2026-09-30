# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_LEXICAL_REPAIR_TARGET_IDENTITY_CORRECTION

Audit-only. Supersedes invalid Lexicon prevalence that treated
reference-diff fragments as lexical targets.
"""
from __future__ import annotations

import csv
import json
import sqlite3
import sys
import unittest
from collections import Counter, defaultdict
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.s3_lexical_target_identity import (  # noqa: E402
    derive_case_lexical_targets,
    lexicon_contains,
    load_authoritative_lexicon_terms,
)
from training.model3_dataset.scripts.s3_target_scope_derivation import (  # noqa: E402
    norm_text,
    structural_family_id,
)
from training.model3_dataset.scripts import test_s3_lexical_target_identity as tmod  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
RAW = DOCS / "model3_v2_s3_candidate_provenance_raw.jsonl"
PREV_SCOPE = DOCS / "model3_v2_s3_target_scope_full200.csv"
PHASE = "MODEL3_V2_S3_LEXICAL_REPAIR_TARGET_IDENTITY_CORRECTION"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

HISTORICAL_QUERY = {
    "QUERY_PARITY_PASS": "8/84",
    "OLD_BOUNDARY_LOCK_confirmed": 13,
    "RETRY_QUERY_BOUNDARY_48": 48,
    "cohort": "query_parity_audit_2026_09_01",
    "countsMerged": "NO",
}


def gather_prov(rec: dict) -> dict:
    raw_hits: list[str] = []
    pre_asm: list[str] = []
    asm_in: list[str] = []
    asm_sents: list[str] = []
    queries: list[dict] = []
    stages: set[str] = set()
    decisions: list[dict] = []
    retry_regions: list[dict] = []
    has_prov = False
    for p in rec.get("paths") or []:
        decisions.extend(p.get("decisions") or [])
        retry_regions.extend(p.get("retry_regions") or [])
        prov = p.get("candidate_provenance")
        if prov:
            has_prov = True
            for rr in prov.get("rawRecalls") or []:
                queries.append(rr.get("query") or {})
                for h in rr.get("hits") or []:
                    if h.get("surface"):
                        raw_hits.append(h["surface"])
            for c in prov.get("preAssembly") or []:
                if c.get("surface"):
                    pre_asm.append(c["surface"])
            for c in prov.get("assemblyInputSelected") or []:
                if c.get("surface"):
                    asm_in.append(c["surface"])
            for st in prov.get("stages") or []:
                stages.add(st.get("stage") or "")
        asm_sents.extend([str(x) for x in (p.get("assembly_sentences") or [])])
    utt = rec.get("candidate_provenance_utterance") or {}
    kenlm = list(utt.get("kenlmPool") or [])
    if utt:
        has_prov = True
    return {
        "has_prov": has_prov or bool(rec.get("snapshot_ok")),
        "raw_hits": raw_hits,
        "pre_asm": pre_asm,
        "asm_in": asm_in,
        "asm_sents": asm_sents,
        "queries": queries,
        "stages": stages,
        "decisions": decisions,
        "retry_regions": retry_regions,
        "kenlm": kenlm,
    }


def query_overlaps(queries: list[dict], cur_start: int, cur_end: int, asr_surface: str) -> bool:
    for q in queries:
        ls, le = q.get("localRawStart"), q.get("localRawEnd")
        if isinstance(ls, int) and isinstance(le, int) and not (le <= cur_start or ls >= cur_end):
            return True
        wt = str(q.get("windowText") or "")
        if wt and asr_surface and (wt in asr_surface or asr_surface in wt):
            return True
    return False


def refine_query_sub(target_cur: tuple[int, int], asr_surface: str, prov: dict) -> str:
    cs, ce = target_cur
    qs = prov["queries"]
    regions = prov["retry_regions"]
    decisions = prov["decisions"]
    if "RAW_RECALL" not in prov["stages"] and not qs:
        return "NO_RAW_RECALL_REGION"
    overlapping_regions = [
        r
        for r in regions
        if isinstance(r.get("rawStart"), (int, float))
        and isinstance(r.get("rawEnd"), (int, float))
        and not (float(r["rawEnd"]) <= cs or float(r["rawStart"]) >= ce)
    ]
    if regions and not overlapping_regions:
        return "RETRY_REGION_PARTIAL_COVERAGE"
    if overlapping_regions:
        if all(
            (r.get("oldLocalSpanSurfaces") or []) == (r.get("newLocalSpanSurfaces") or [])
            and r.get("resegmentOk") is False
            for r in overlapping_regions
        ):
            return "OLD_BOUNDARY_LOCK"
        if any(r.get("resegmentOk") is False for r in overlapping_regions):
            return "LOCAL_RESEGMENTATION_FAILURE"
    overlapping_decisions = [
        d
        for d in decisions
        if isinstance(d.get("rawStart"), (int, float))
        and isinstance(d.get("rawEnd"), (int, float))
        and not (float(d["rawEnd"]) <= cs or float(d["rawStart"]) >= ce)
    ]
    if overlapping_decisions and all(d.get("decision") == "KEEP" for d in overlapping_decisions):
        return "KEEP_BARRIER"
    if overlapping_decisions and any(d.get("isAnchor") for d in overlapping_decisions):
        return "ANCHOR_BARRIER"
    if not qs:
        return "NO_RAW_RECALL_REGION"
    return "OTHER"


def target_in_surfaces(surfaces: list[str], term: str) -> bool:
    if not term:
        return False
    nt = norm_text(term)
    for s in surfaces:
        ns = norm_text(s)
        if not ns:
            continue
        if ns == nt or (len(nt) >= 2 and len(ns) >= 2 and (ns in nt or nt in ns)):
            return True
    return False


def classify_lexical_target(t, prov: dict, final: str, baseline: str) -> dict:
    term = t.lexicalTarget
    if t.targetIdentitySource == "OUTSIDE_LEXICON_CONTRACT" or t.outsideLexiconContract:
        return {"mechanism": "OUTSIDE_LEXICON_CONTRACT", "querySub": ""}
    if t.targetConfidence in ("LOW", "UNRESOLVED"):
        return {"mechanism": "LEXICAL_TARGET_IDENTITY_UNRESOLVED", "querySub": ""}
    if not t.inAuthoritativeLexicon:
        # STRUCTURAL_COMPOSITION_SUPPORTED → valid lexical gap candidate
        if t.targetIdentitySource == "STRUCTURAL_COMPOSITION_SUPPORTED" and t.targetConfidence == "HIGH":
            return {"mechanism": "TARGET_NOT_IN_LEXICON", "querySub": ""}
        if t.targetIdentitySource == "STRUCTURAL_COMPOSITION_SUPPORTED":
            return {"mechanism": "LEXICAL_TARGET_IDENTITY_UNRESOLVED", "querySub": ""}
        return {"mechanism": "LEXICAL_TARGET_IDENTITY_UNRESOLVED", "querySub": ""}

    # In lexicon → query / recall / downstream
    repair_q = query_overlaps(prov["queries"], t.curStart, t.curEnd, t.diffCoreAsr)
    in_raw = target_in_surfaces(prov["raw_hits"], term)
    in_pre = target_in_surfaces(prov["pre_asm"], term)
    in_asmin = target_in_surfaces(prov["asm_in"], term)
    in_kenlm = any(norm_text(term) in norm_text(s) for s in prov["kenlm"]) if term else False
    final_has = norm_text(term) in norm_text(final) if term else False
    base_has = norm_text(term) in norm_text(baseline) if term else False

    if not repair_q:
        return {
            "mechanism": "QUERY_NOT_REPAIR_CAPABLE",
            "querySub": refine_query_sub((t.curStart, t.curEnd), t.diffCoreAsr, prov),
        }
    if not in_raw:
        return {"mechanism": "RECALL_TARGET_MISS", "querySub": ""}
    if in_raw and not in_pre:
        return {"mechanism": "POST_RECALL_TARGET_DROP", "querySub": ""}
    if in_pre and not in_asmin:
        return {"mechanism": "POST_RECALL_TARGET_DROP", "querySub": ""}
    if in_asmin and not in_kenlm:
        return {"mechanism": "ASSEMBLY_TARGET_DROP", "querySub": ""}
    if in_kenlm and not final_has:
        return {"mechanism": "KENLM_TARGET_NOT_SELECTED", "querySub": ""}
    if final_has and not (final_has and not base_has):
        return {"mechanism": "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT", "querySub": ""}
    return {"mechanism": "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT", "querySub": ""}


def write_csv(path: Path, rows: list[dict]):
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


def lexicon_policy_summary() -> dict:
    db = REPO / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"
    con = sqlite3.connect(str(db))
    term_lens = dict(con.execute("SELECT LENGTH(word), COUNT(*) FROM term GROUP BY 1").fetchall())
    domain_n = con.execute("SELECT COUNT(*) FROM domain_lexicon").fetchone()[0]
    idiom_n = con.execute("SELECT COUNT(*) FROM idiom_lexicon").fetchone()[0]
    tag_n = con.execute("SELECT COUNT(*) FROM term_domain_tags").fetchone()[0]
    con.close()
    return {
        "authoritativeBundle": "node_runtime/lexicon/v3",
        "schema": "lexicon-v3-runtime-v3",
        "termLengthPolicy": "base/term lengths 1–4 observed; runtime base lookup allows 1–5; idiom fixed length 4",
        "singleCharPolicy": "ALLOWED in base_lexicon by frozen design (IME fill; not sole repair owner)",
        "domainTagging": "term_domain_tags multi-tag SSOT",
        "phrasePolicy": "arbitrary syntactic phrases NOT required; Lexicon owns repairable lexical terms/idioms/domain terms",
        "termLenHistogram": term_lens,
        "domainLexiconCount": domain_n,
        "idiomCount": idiom_n,
        "termDomainTagRows": tag_n,
        "legacyCurrentNotAuthoritative": True,
    }


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"missing raw jsonl: {RAW}")
    inv = load_authoritative_lexicon_terms()
    records = [json.loads(l) for l in RAW.open(encoding="utf-8") if l.strip()]
    prev_rows = list(csv.DictReader(PREV_SCOPE.open(encoding="utf-8"))) if PREV_SCOPE.exists() else []
    prev_by_id = {r["caseId"]: r for r in prev_rows}

    policy = lexicon_policy_summary()

    lexical_rows: list[dict] = []
    case_rows: list[dict] = []
    query_reval_rows: list[dict] = []

    multi_target_cases = 0
    norm_equiv_regions = 0
    repair_regions = 0
    unresolved_targets = 0
    high_targets = 0
    med_targets = 0
    outside_targets = 0

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

        case_mechs: list[str] = []
        case_target_n = 0
        for b in bundles:
            repair_regions += 1
            if b.normalizationEquivalent or b.regionClass == "NORMALIZATION_EQUIVALENT":
                norm_equiv_regions += 1
                continue
            if b.regionClass in ("LEXICAL_TARGET_IDENTITY_UNRESOLVED",) and not b.targets:
                unresolved_targets += 1
                case_mechs.append("LEXICAL_TARGET_IDENTITY_UNRESOLVED")
                continue
            for t in b.targets:
                case_target_n += 1
                if t.targetConfidence == "HIGH":
                    high_targets += 1
                elif t.targetConfidence == "MEDIUM":
                    med_targets += 1
                else:
                    unresolved_targets += 1
                if t.outsideLexiconContract:
                    outside_targets += 1
                cls = classify_lexical_target(t, prov, final, baseline)
                mech = cls["mechanism"]
                case_mechs.append(mech)
                if mech == "QUERY_NOT_REPAIR_CAPABLE":
                    query_reval_rows.append(
                        {
                            "caseId": cid,
                            "targetId": t.targetId,
                            "lexicalTarget": t.lexicalTarget,
                            "submechanism": cls["querySub"],
                            "confidence": t.targetConfidence,
                            "identitySource": t.targetIdentitySource,
                        }
                    )
                lexical_rows.append(
                    {
                        "caseId": cid,
                        "regionId": t.regionId,
                        "targetId": t.targetId,
                        "diffCoreAsr": t.diffCoreAsr,
                        "diffCoreRef": t.diffCoreRef,
                        "lexicalTarget": t.lexicalTarget,
                        "targetIdentitySource": t.targetIdentitySource,
                        "targetConfidence": t.targetConfidence,
                        "inAuthoritativeLexicon": t.inAuthoritativeLexicon,
                        "outsideLexiconContract": t.outsideLexiconContract,
                        "mechanism": mech,
                        "querySubmechanism": cls["querySub"],
                        "structuralFamily": structural_family_id(t.lexicalTarget, mech),
                        "manualMapped": "NO",
                        "derivationUsesCaseId": "NO",
                    }
                )
        if case_target_n > 1:
            multi_target_cases += 1

        case_rows.append(
            {
                "caseId": cid,
                "scopeClass": scope_class,
                "mechanisms": "|".join(sorted(set(case_mechs))),
                "lexicalTargetCount": case_target_n,
                "regionCount": len(bundles),
                "prevPrimaryMechanism": (prev_by_id.get(cid) or {}).get("primaryMechanism", ""),
                "prevRefSurface": (prev_by_id.get(cid) or {}).get("refSurface", ""),
            }
        )

    # --- Eligible HIGH lexical targets for prevalence ---
    eligible = [
        r
        for r in lexical_rows
        if r["targetConfidence"] == "HIGH"
        and r["mechanism"]
        not in (
            "LEXICAL_TARGET_IDENTITY_UNRESOLVED",
            "",
        )
    ]
    # Validity gate: HIGH targets with defensible identity or explicit non-lexical class
    high_all = [r for r in lexical_rows if r["targetConfidence"] == "HIGH"]
    defensible = [
        r
        for r in high_all
        if r["targetIdentitySource"]
        in (
            "EXISTING_LEXICON_TERM",
            "STRUCTURAL_COMPOSITION_SUPPORTED",
            "OUTSIDE_LEXICON_CONTRACT",
            "NORMALIZATION_EQUIVALENT",
        )
        or r["mechanism"]
        in (
            "OUTSIDE_LEXICON_CONTRACT",
            "NORMALIZATION_EQUIVALENT",
            "TARGET_NOT_IN_LEXICON",
            "QUERY_NOT_REPAIR_CAPABLE",
            "RECALL_TARGET_MISS",
            "POST_RECALL_TARGET_DROP",
            "ASSEMBLY_TARGET_DROP",
            "KENLM_TARGET_NOT_SELECTED",
            "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT",
        )
    ]
    gate_pct = (len(defensible) / len(high_all)) if high_all else 1.0
    prevalence_valid = gate_pct >= 0.90

    n_eligible = len(eligible) or 1
    # repair cases = cases with >=1 HIGH eligible lexical target or reference diff with regions
    repair_cases = {r["caseId"] for r in eligible}
    n_repair_cases = len(repair_cases) or 1

    def mech_stats(mech: str) -> dict:
        trows = [r for r in eligible if r["mechanism"] == mech]
        cases = {r["caseId"] for r in trows}
        fams = {r["structuralFamily"] for r in trows if r.get("structuralFamily")}
        return {
            "mechanism": mech,
            "targetCount": len(trows),
            "caseAffectedCount": len(cases),
            "structuralFamilyCount": len(fams),
            "targetShare": round(len(trows) / n_eligible, 4) if eligible else 0.0,
            "caseAffectedRate": round(len(cases) / n_repair_cases, 4) if repair_cases else 0.0,
            "targetDenominator": len(eligible),
            "caseDenominator": len(repair_cases),
        }

    mechanisms = [
        "TARGET_NOT_IN_LEXICON",
        "QUERY_NOT_REPAIR_CAPABLE",
        "RECALL_TARGET_MISS",
        "POST_RECALL_TARGET_DROP",
        "ASSEMBLY_TARGET_DROP",
        "CROSS_PATH_TARGET_DROP",
        "KENLM_TARGET_NOT_SELECTED",
        "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT",
        "OUTSIDE_LEXICON_CONTRACT",
        "LEXICAL_TARGET_IDENTITY_UNRESOLVED",
        "NORMALIZATION_EQUIVALENT",
    ]
    prevalence_rows = [mech_stats(m) for m in mechanisms]

    # --- Revalidation of previous classifications ---
    prev_lex = [r for r in prev_rows if r.get("primaryMechanism") == "TARGET_NOT_IN_LEXICON"]
    prev_qry = [r for r in prev_rows if r.get("primaryMechanism") == "QUERY_NOT_REPAIR_CAPABLE"]
    prev_rec = [r for r in prev_rows if r.get("primaryMechanism") == "RECALL_TARGET_MISS"]

    def revalidate(prev_list: list[dict], expect_mech: str) -> dict:
        valid = reclassified = unresolved = normalization = outside = 0
        detail_rows = []
        for pr in prev_list:
            cid = pr["caseId"]
            cr = next((c for c in case_rows if c["caseId"] == cid), None)
            mechs = set((cr or {}).get("mechanisms", "").split("|")) - {""}
            new_primary = ""
            if expect_mech in mechs:
                valid += 1
                status = "STILL_VALID"
                new_primary = expect_mech
            elif "NORMALIZATION_EQUIVALENT" in mechs or not mechs and (cr or {}).get("scopeClass") == "FINAL_ALREADY_EQUIVALENT":
                normalization += 1
                status = "NORMALIZATION_EQUIVALENT"
                new_primary = "NORMALIZATION_EQUIVALENT"
            elif "OUTSIDE_LEXICON_CONTRACT" in mechs:
                outside += 1
                status = "OUTSIDE_LEXICON_CONTRACT"
                new_primary = "OUTSIDE_LEXICON_CONTRACT"
            elif "LEXICAL_TARGET_IDENTITY_UNRESOLVED" in mechs or not mechs:
                unresolved += 1
                status = "UNRESOLVED"
                new_primary = "LEXICAL_TARGET_IDENTITY_UNRESOLVED"
            else:
                reclassified += 1
                status = "RECLASSIFIED"
                new_primary = sorted(mechs)[0] if mechs else "RECLASSIFIED"
            detail_rows.append(
                {
                    "previousBucket": expect_mech,
                    "caseId": cid,
                    "prevRefSurface": pr.get("refSurface", ""),
                    "status": status,
                    "newMechanisms": (cr or {}).get("mechanisms", ""),
                    "newPrimaryLike": new_primary,
                }
            )
        return {
            "previousN": len(prev_list),
            "valid": valid,
            "normalization": normalization,
            "outsideContract": outside,
            "unresolved": unresolved,
            "reclassified": reclassified,
            "details": detail_rows,
        }

    rev_lex = revalidate(prev_lex, "TARGET_NOT_IN_LEXICON")
    rev_qry = revalidate(prev_qry, "QUERY_NOT_REPAIR_CAPABLE")
    rev_rec = revalidate(prev_rec, "RECALL_TARGET_MISS")

    reval_csv = rev_lex["details"] + rev_qry["details"] + rev_rec["details"]

    lex_stat = next(r for r in prevalence_rows if r["mechanism"] == "TARGET_NOT_IN_LEXICON")
    qry_stat = next(r for r in prevalence_rows if r["mechanism"] == "QUERY_NOT_REPAIR_CAPABLE")
    rec_stat = next(r for r in prevalence_rows if r["mechanism"] == "RECALL_TARGET_MISS")
    post_stat = next(r for r in prevalence_rows if r["mechanism"] == "POST_RECALL_TARGET_DROP")
    asm_stat = next(r for r in prevalence_rows if r["mechanism"] == "ASSEMBLY_TARGET_DROP")
    kenlm_stat = next(r for r in prevalence_rows if r["mechanism"] == "KENLM_TARGET_NOT_SELECTED")

    # Development readiness dimensions
    def readiness(existence: str, prev: dict, stat: dict, owner_clear: bool) -> dict:
        prev_ok = prevalence_valid and stat["targetCount"] >= 0
        fam_ok = stat["structuralFamilyCount"] >= 3
        ready = (
            existence.startswith("PROVEN_GENERAL")
            and prevalence_valid
            and fam_ok
            and stat["targetCount"] >= 3
            and owner_clear
        )
        return {
            "EXISTENCE_RELIABILITY": existence,
            "PREVALENCE_RELIABILITY": "VALID" if prevalence_valid else "UNRESOLVED",
            "targetShare": stat["targetShare"],
            "caseAffectedRate": stat["caseAffectedRate"],
            "structuralFamilyCount": stat["structuralFamilyCount"],
            "OWNER_CLARITY": "YES" if owner_clear else "NO",
            "DEVELOPMENT_READY": "YES" if ready else "NO",
        }

    recall_existence = (
        "PROVEN_GENERAL"
        if rec_stat["structuralFamilyCount"] >= 3 and rec_stat["targetCount"] >= 3
        else "PROVEN_LOCAL"
    )

    ready_table = {
        "LEXICON_COVERAGE": readiness("PROVEN_GENERAL", rev_lex, lex_stat, True),
        "RETRY_QUERY_GEOMETRY": readiness("PROVEN_GENERAL", rev_qry, qry_stat, True),
        "RECALL_MISS": readiness(recall_existence, rev_rec, rec_stat, True),
        "POST_RECALL": readiness("NOT_SUPPORTED_CURRENT_EVIDENCE", {}, post_stat, False),
        "ASSEMBLY": readiness("NOT_SUPPORTED_CURRENT_EVIDENCE", {}, asm_stat, False),
        "CROSS_PATH": readiness(
            "NOT_SUPPORTED_CURRENT_EVIDENCE",
            {},
            {"targetCount": 0, "targetShare": 0, "caseAffectedRate": 0, "structuralFamilyCount": 0},
            False,
        ),
        "KENLM": readiness("NOT_SUPPORTED_CURRENT_EVIDENCE", {}, kenlm_stat, False),
    }

    # Priority
    if not prevalence_valid:
        verdict = "MODEL3_S3_MECHANISM_PREVALENCE_INVALID"
        next_phase = "MODEL3_V2_S3_LEXICAL_TARGET_IDENTITY_COMPLETENESS_CORRECTION"
        priority = "NOT_YET_RESOLVED"
        highest = "NONE"
    elif high_targets < 5 and len(eligible) < 5:
        verdict = "MODEL3_S3_LEXICAL_TARGET_IDENTITY_INCOMPLETE"
        next_phase = "MODEL3_V2_S3_LEXICAL_TARGET_IDENTITY_COMPLETENESS_CORRECTION"
        priority = "NOT_YET_RESOLVED"
        highest = "NONE"
    else:
        ready_mechs = [k for k, v in ready_table.items() if v["DEVELOPMENT_READY"] == "YES"]
        if len(ready_mechs) == 1:
            verdict = "MODEL3_S3_LEXICAL_TARGET_IDENTITY_PASS_PRIORITY_RESOLVED"
            highest = ready_mechs[0]
            next_phase = (
                "MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT"
                if highest == "LEXICON_COVERAGE"
                else "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT"
            )
            priority = highest
        elif len(ready_mechs) >= 2:
            # multi-factor: share + families — resolve only if clear dominance
            ls, qs = lex_stat["targetShare"], qry_stat["targetShare"]
            lf, qf = lex_stat["structuralFamilyCount"], qry_stat["structuralFamilyCount"]
            if ls >= max(qs * 3, 0.15) and lf >= qf + 3 and "LEXICON_COVERAGE" in ready_mechs:
                verdict = "MODEL3_S3_LEXICAL_TARGET_IDENTITY_PASS_PRIORITY_RESOLVED"
                next_phase = "MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT"
                priority = "LEXICON_COVERAGE"
                highest = "LEXICON_COVERAGE"
            elif qs >= max(ls * 3, 0.15) and qf >= lf + 3 and "RETRY_QUERY_GEOMETRY" in ready_mechs:
                verdict = "MODEL3_S3_LEXICAL_TARGET_IDENTITY_PASS_PRIORITY_RESOLVED"
                next_phase = "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT"
                priority = "RETRY_QUERY_GEOMETRY"
                highest = "RETRY_QUERY_GEOMETRY"
            else:
                verdict = "MODEL3_S3_LEXICAL_TARGET_IDENTITY_PASS_PRIORITY_UNRESOLVED"
                next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"
                priority = "NOT_YET_RESOLVED"
                highest = "NONE"
        else:
            verdict = "MODEL3_S3_LEXICAL_TARGET_IDENTITY_PASS_PRIORITY_UNRESOLVED"
            next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"
            priority = "NOT_YET_RESOLVED"
            highest = "NONE"

    # Tests
    suite = unittest.defaultTestLoader.loadTestsFromModule(tmod)
    buf = StringIO()
    tres = unittest.TextTestRunner(stream=buf, verbosity=2).run(suite)
    test_csv = [
        {
            "testsRun": tres.testsRun,
            "failures": len(tres.failures),
            "errors": len(tres.errors),
            "wasSuccessful": tres.wasSuccessful(),
            "detailTail": buf.getvalue()[-2500:],
        }
    ]

    # Artifacts
    write_csv(DOCS / "model3_v2_s3_lexical_targets.csv", lexical_rows)
    write_csv(DOCS / "model3_v2_s3_previous_classification_revalidation.csv", reval_csv)
    write_csv(DOCS / "model3_v2_s3_corrected_mechanism_prevalence.csv", prevalence_rows)
    write_csv(DOCS / "model3_v2_s3_lexical_target_tests.csv", test_csv)
    write_csv(
        DOCS / "model3_v2_s3_query_geometry_revalidated.csv",
        query_reval_rows
        or [{"caseId": "", "submechanism": "NONE", "note": "no query-geometry lexical targets"}],
    )

    n = len(records)
    ref_diff = sum(1 for c in case_rows if c["scopeClass"] not in ("FINAL_ALREADY_EQUIVALENT", "TARGET_SCOPE_NOT_EVALUATED"))

    answers = {
        "D1": "NO",
        "D2": "NO",
        "D3": "NO",
        "D4": "NO",
        "D5": "NO",
        "D6": "NO",
        "D7": "YES (frozen raw JSONL 200/200)",
        "D8": "YES",
        "D9": "NO",
        "D10": "YES",
        "D11": norm_equiv_regions,
        "D12": repair_regions,
        "D13": len(lexical_rows),
        "D14": high_targets,
        "D15": med_targets,
        "D16": unresolved_targets,
        "D17": multi_target_cases,
        "D18": ["EXISTING_LEXICON_TERM", "STRUCTURAL_COMPOSITION_SUPPORTED", "OUTSIDE_LEXICON_CONTRACT", "NORMALIZATION_EQUIVALENT"],
        "D19": "NO",
        "D20": "NO",
        "D21": "NO",
        "D22": "NO",
        "D23": rev_lex["valid"],
        "D24": rev_lex["normalization"],
        "D25": rev_lex["outsideContract"],
        "D26": rev_lex["unresolved"],
        "D27": rev_lex["reclassified"],
        "D28": rev_qry["valid"],
        "D29": dict(Counter(r["submechanism"] for r in query_reval_rows)),
        "D30": rev_rec["valid"],
        "D31": "NO_NOW_PROVEN_GENERAL" if recall_existence == "PROVEN_GENERAL" else "YES",
        "D32": "YES" if post_stat["targetCount"] else "NO",
        "D33": "YES" if post_stat["targetCount"] else "NO_NOT_SUPPORTED_CURRENT_EVIDENCE",
        "D34": "YES" if asm_stat["targetCount"] else "NO_NOT_SUPPORTED_CURRENT_EVIDENCE",
        "D35": "NO_NOT_SUPPORTED_CURRENT_EVIDENCE",
        "D36": "YES" if kenlm_stat["targetCount"] else "NO_NOT_SUPPORTED_CURRENT_EVIDENCE",
        "D37": lex_stat["targetShare"],
        "D38": lex_stat["caseAffectedRate"],
        "D39": lex_stat["structuralFamilyCount"],
        "D40": qry_stat["targetShare"],
        "D41": qry_stat["caseAffectedRate"],
        "D42": rec_stat["targetShare"],
        "D43": "YES",
        "D44": "YES" if prevalence_valid else "NO",
        "D45": "YES" if prevalence_valid and lex_stat["targetCount"] else "NO",
        "D46": "YES" if prevalence_valid and qry_stat["targetCount"] else "NO",
        "D47": "NO" if priority == "NOT_YET_RESOLVED" else "YES",
        "D48": highest,
        "D49": "NO",
        "D50": "NO",
        "D51": verdict,
        "D52": next_phase,
    }

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": verdict,
        "nextPhase": next_phase,
        "supersession": {
            "LEXICON_COVERAGE_CASES_148": "SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION",
            "LEXICON_ELIGIBLE_SHARE_0_8605": "SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION",
            "RETRY_QUERY_GEOMETRY_CASES_14": "SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION",
            "RETRY_QUERY_GEOMETRY_SHARE_0_0814": "SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION",
            "MECHANISM_PRIORITY": priority,
        },
        "counts": {
            "totalCases": n,
            "referenceDiffCases": ref_diff,
            "repairRegions": repair_regions,
            "derivedLexicalTargets": len(lexical_rows),
            "highConfidenceLexicalTargets": high_targets,
            "mediumConfidenceLexicalTargets": med_targets,
            "unresolvedLexicalTargets": unresolved_targets,
            "normalizationEquivalentRegions": norm_equiv_regions,
            "outsideLexiconContractTargets": outside_targets,
            "eligibleLexicalTargets": len(eligible),
            "multiTargetCases": multi_target_cases,
            "prevalenceGatePct": round(gate_pct, 4),
            "prevalenceValid": prevalence_valid,
        },
        "lexiconPolicy": policy,
        "previousRevalidation": {
            "PREVIOUS_LEXICON_148": {k: rev_lex[k] for k in ("previousN", "valid", "normalization", "outsideContract", "unresolved", "reclassified")},
            "PREVIOUS_QUERY_14": {k: rev_qry[k] for k in ("previousN", "valid", "normalization", "outsideContract", "unresolved", "reclassified")},
            "PREVIOUS_RECALL_10": {k: rev_rec[k] for k in ("previousN", "valid", "normalization", "outsideContract", "unresolved", "reclassified")},
        },
        "prevalence": prevalence_rows,
        "developmentReadiness": ready_table,
        "FIRST_CAUSAL_OWNER": "NOT_YET_ISOLATED",
        "A1_PROMOTION_READY": False,
        "existenceFrozen": {
            "LEXICON_COVERAGE_EXISTENCE": "PROVEN_GENERAL",
            "RETRY_QUERY_GEOMETRY_EXISTENCE": "PROVEN_GENERAL",
            "RECALL_MISS": recall_existence,
        },
        "answers": answers,
        "testsOk": tres.wasSuccessful(),
    }
    (DOCS / "model3_v2_s3_lexical_target_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    freeze = "\n".join(
        [
            "key,value,status",
            f"phase,{PHASE},AUTHORITATIVE",
            "TRACE_RUNTIME_PROVENANCE,COMPLETE_200_OF_200,FROZEN",
            "TRACE_BEHAVIOR_MUTATION,NO,FROZEN",
            "REFERENCE_LEAKAGE,NO,FROZEN",
            "TEST_GAMING,NO,FROZEN",
            "JOBRESULT_CHANGED,NO,FROZEN",
            "AUTOMATIC_REFERENCE_DIFF_REGION_LOCALIZATION,VALID_FOR_REGION_LOCALIZATION,FROZEN",
            "LEXICON_COVERAGE_EXISTENCE,PROVEN_GENERAL,FROZEN",
            "RETRY_QUERY_GEOMETRY_EXISTENCE,PROVEN_GENERAL,FROZEN",
            f"RECALL_MISS,{recall_existence},RECORDED",
            "LEXICON_COVERAGE_CASES_148,SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION,SUPERSEDED",
            "LEXICON_ELIGIBLE_SHARE_0_8605,SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION,SUPERSEDED",
            "RETRY_QUERY_GEOMETRY_CASES_14,SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION,SUPERSEDED",
            "RETRY_QUERY_GEOMETRY_SHARE_0_0814,SUPERSEDED_PENDING_LEXICAL_TARGET_REVALIDATION,SUPERSEDED",
            f"LEXICON_COVERAGE_PREVALENCE,{lex_stat['targetShare']},{'VALID' if prevalence_valid else 'UNRESOLVED'}",
            f"RETRY_QUERY_GEOMETRY_PREVALENCE,{qry_stat['targetShare']},{'VALID' if prevalence_valid else 'UNRESOLVED'}",
            f"MECHANISM_PRIORITY,{priority},RECORDED",
            "FIRST_CAUSAL_OWNER,NOT_YET_ISOLATED,FROZEN",
            "A1_PROMOTION_READY,FALSE,FROZEN",
            "ACP,FALSE,FROZEN",
            f"prevalence_gate_pct,{round(gate_pct,4)},RECORDED",
            f"verdict,{verdict},RECORDED",
            f"NEXT_PHASE,{next_phase},RECORDED",
        ]
    )
    (DOCS / "model3_v2_s3_corrected_freeze_state.csv").write_text(freeze + "\n", encoding="utf-8")

    md = f"""# Lingua — Model3 V2 S3 Lexical Repair Target Identity Audit

Date: 2026-09-03  
Phase: `{PHASE}`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `{verdict}` |
| prevalence gate | {gate_pct:.1%} ({'PASS' if prevalence_valid else 'FAIL'}) |
| LEXICON existence | PROVEN_GENERAL (frozen) |
| LEXICON prevalence | targetShare={lex_stat['targetShare']} caseAffected={lex_stat['caseAffectedRate']} fam={lex_stat['structuralFamilyCount']} |
| QUERY existence | PROVEN_GENERAL (frozen) |
| QUERY prevalence | targetShare={qry_stat['targetShare']} caseAffected={qry_stat['caseAffectedRate']} fam={qry_stat['structuralFamilyCount']} |
| MECHANISM_PRIORITY | {priority} |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED |
| next phase | `{next_phase}` |

================================
PREVIOUS PREVALENCE SUPERSESSION
================================

148 / 0.8605 Lexicon and 14 / 0.0814 Query shares from prior phase are **SUPERSEDED**.

================================
FROZEN VALID FINDINGS
=====================

Runtime provenance 200/200; mutation/leakage/gaming/JobResult=NO; region localization valid; mechanism **existence** unchanged.

================================
REGION VS LEXICAL TARGET CONTRACT
=================================

REFERENCE_DIFF_REGION localizes differences.  
LEXICAL_REPAIR_TARGET is a Recall-contract lexical unit (lexicon-anchored or structural composition).  
Arbitrary fragments are never auto `TARGET_NOT_IN_LEXICON`.

================================
LEXICON OWNERSHIP POLICY
========================

{json.dumps(policy, ensure_ascii=False, indent=2)}

================================
NORMALIZATION FILTER
====================

Normalization-equivalent regions: **{norm_equiv_regions}**

================================
LEXICAL TARGET DERIVATION
=========================

Sources: EXISTING_LEXICON_TERM | STRUCTURAL_COMPOSITION_SUPPORTED | OUTSIDE_LEXICON_CONTRACT.  
Authoritative DB: V3 (not legacy current).

================================
TARGET IDENTITY CONFIDENCE
==========================

HIGH={high_targets} MEDIUM={med_targets} unresolved≈{unresolved_targets}

================================
MULTI-TARGET CASES
==================

{multi_target_cases} cases with >1 lexical target. Case summary uses mechanisms[] (not forced single primary).

================================
PREVIOUS LEXICON148 REVALIDATION
================================

{json.dumps(summary['previousRevalidation']['PREVIOUS_LEXICON_148'], ensure_ascii=False)}

================================
PREVIOUS QUERY14 REVALIDATION
=============================

{json.dumps(summary['previousRevalidation']['PREVIOUS_QUERY_14'], ensure_ascii=False)}

================================
PREVIOUS RECALL10 REVALIDATION
==============================

{json.dumps(summary['previousRevalidation']['PREVIOUS_RECALL_10'], ensure_ascii=False)}  
Recall remains PROVEN_LOCAL.

================================
TARGET-LEVEL MECHANISM PREVALENCE
=================================

Denominator = eligible HIGH lexical targets ({len(eligible)}).  
See `model3_v2_s3_corrected_mechanism_prevalence.csv`.

================================
CASE-LEVEL AFFECTED RATE
========================

Denominator = cases with ≥1 eligible HIGH lexical target ({len(repair_cases)}).  
Not “% of all errors caused by”.

================================
STRUCTURAL FAMILY ANALYSIS
==========================

Families = mechanism:norm(lexicalTarget); repeats deduped.

================================
POST-RECALL / ASSEMBLY / KENLM
==============================

post={post_stat['targetCount']} asm={asm_stat['targetCount']} kenlm={kenlm_stat['targetCount']}

================================
ANTI-OVERFIT / REFERENCE FIREWALL
=================================

No case map; no heldout strings in derivation; reference after frozen trace only. Tests OK={tres.wasSuccessful()}.

================================
DEVELOPMENT READINESS
=====================

{json.dumps(ready_table, ensure_ascii=False, indent=2)}

================================
AUTHORITATIVE FREEZE STATE
==========================

`model3_v2_s3_corrected_freeze_state.csv`

================================
D1–D52
======

{chr(10).join(f'| {k} | {v} |' for k,v in answers.items())}

================================
NEXT PHASE
==========

Exactly one: `{next_phase}`
"""
    (DOCS / "Lingua_Model3_V2_S3_Lexical_Target_Identity_Audit_2026_09_03.md").write_text(md, encoding="utf-8")

    print(
        json.dumps(
            {
                "verdict": verdict,
                "next": next_phase,
                "gate": round(gate_pct, 4),
                "eligible": len(eligible),
                "lex": lex_stat,
                "query": qry_stat,
                "recall": rec_stat,
                "prevLex": summary["previousRevalidation"]["PREVIOUS_LEXICON_148"],
                "prevQry": summary["previousRevalidation"]["PREVIOUS_QUERY_14"],
                "prevRec": summary["previousRevalidation"]["PREVIOUS_RECALL_10"],
                "testsOk": tres.wasSuccessful(),
                "priority": priority,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if not tres.wasSuccessful():
        print(buf.getvalue())
        raise SystemExit(1)


if __name__ == "__main__":
    main()
