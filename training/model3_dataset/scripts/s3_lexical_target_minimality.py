# -*- coding: utf-8 -*-
"""Audit-only lexical target minimality / necessity (read-only causal layer).

Does not change Lexicon/Recall/Retry. Operates on derived candidates + frozen ASR/ref.
"""
from __future__ import annotations

import difflib
from dataclasses import asdict, dataclass
from typing import Any

from training.model3_dataset.scripts.s3_lexical_target_identity import (  # noqa: E402
    MAX_TERM_LEN,
    MIN_TERM_LEN,
    fold_cjk_variant,
    lexicon_contains,
)
from training.model3_dataset.scripts.s3_target_scope_derivation import (  # noqa: E402
    is_digit_style_only,
    is_punctuation_only_diff,
    norm_text,
)


@dataclass
class ChangeSpan:
    refRelStart: int
    refRelEnd: int
    asrRelStart: int
    asrRelEnd: int
    tag: str


@dataclass
class MinimalTargetRecord:
    caseId: str
    regionId: str
    repairEventId: str
    targetId: str
    lexicalTarget: str
    targetIdentitySource: str
    targetConfidence: str
    mechanismPrev: str
    querySubPrev: str
    targetStart: int
    targetEnd: int
    diffCoreStart: int
    diffCoreEnd: int
    overlapChars: int
    changedElementsCovered: int
    targetRole: str
    mechanismFinal: str
    querySubFinal: str
    structuralFamilyKey: str
    notes: str = ""
    inAuthoritativeLexicon: bool = False

    def to_row(self) -> dict[str, Any]:
        return asdict(self)


def change_spans_on_cores(asr_core: str, ref_core: str) -> list[ChangeSpan]:
    if is_punctuation_only_diff(asr_core, ref_core) or is_digit_style_only(asr_core, ref_core):
        return []
    out: list[ChangeSpan] = []
    sm = difflib.SequenceMatcher(a=asr_core, b=ref_core, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        out.append(
            ChangeSpan(
                refRelStart=j1,
                refRelEnd=j2,
                asrRelStart=i1,
                asrRelEnd=i2,
                tag=tag,
            )
        )
    return out


def overlap_len(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def target_changed_coverage(
    target_start: int,
    target_end: int,
    core_abs_start: int,
    changes: list[ChangeSpan],
) -> tuple[int, int]:
    """Return (overlap_chars_on_ref_changes, n_change_spans_touched)."""
    touched = 0
    ov_total = 0
    for ch in changes:
        if ch.tag == "delete":
            # ASR-only deletion: no ref chars; treat as point adjacency at delete locus
            abs_pt = core_abs_start + ch.refRelStart
            if target_start <= abs_pt <= target_end:
                touched += 1
                ov_total += 1
            continue
        abs_s = core_abs_start + ch.refRelStart
        abs_e = core_abs_start + ch.refRelEnd
        if abs_e <= abs_s:
            abs_e = abs_s + 1
        ov = overlap_len(target_start, target_end, abs_s, abs_e)
        if ov > 0:
            touched += 1
            ov_total += ov
    return ov_total, touched


def structural_composition_audit_notes() -> dict[str, Any]:
    return {
        "implementationFile": "training/model3_dataset/scripts/s3_lexical_target_identity.py::_structural_units",
        "exactRule": [
            "If norm(diffCoreRef) length in [2,4], no outside-contract, no leading/trailing function char → emit exact core surface",
            "Else emit shortest substring L in [max(2,coreLen),4] that fully covers the core within punctuation-bounded run",
        ],
        "independentLexicalEvidence": "NONE beyond contiguous CJK/window substring covering the diff",
        "functionWordsAllowed": "Partial — leading/trailing function chars blocked for exact-core path; interior function chars may remain",
        "punctuationAllowed": "NO — runs clipped at punctuation; outside_lexicon_contract rejects punct-bearing units",
        "unchangedContextAllowed": "YES — shortest full cover may include unchanged neighbors",
        "arbitraryWindows": "YES — any 2–4 char cover of the core can be emitted",
        "halfWordsPossible": "YES — fragments without lexicon membership",
        "overlapAloneSufficient": "YES — covering the diff core is the primary condition",
        "distinguishesLexicalVsSyntacticFragment": "NO",
        "hardStandardVerdict": "FAILS_INDEPENDENT_LEXICAL_IDENTITY_STANDARD",
        "prevalenceImplication": "STRUCTURAL_COMPOSITION_SUPPORTED must not produce PRIMARY_MINIMAL TARGET_NOT_IN_LEXICON",
    }


def structural_family_key(mech: str, role: str, t: dict, qsub: str) -> str:
    """Mechanism-structural family — NOT mechanism:surface.

    Role is recorded for diagnostics but excluded from the family key so that
    PRIMARY vs ALTERNATIVE of the same geometry do not inflate independence.
    """
    tl = len(norm_text(str(t.get("lexicalTarget") or "")))
    len_bucket = "L1" if tl <= 1 else "L2" if tl == 2 else "L3" if tl == 3 else "L4p"
    cov = int(t.get("changedElementsCovered") or 0)
    geom = "COVERS_CHANGE" if cov > 0 else "NO_CHANGE_OV"
    src = str(t.get("targetIdentitySource") or "NA")
    known = {
        "RETRY_REGION_PARTIAL_COVERAGE",
        "NO_RAW_RECALL_REGION",
        "OLD_BOUNDARY_LOCK",
        "LOCAL_RESEGMENTATION_FAILURE",
        "KEEP_BARRIER",
        "ANCHOR_BARRIER",
        "SPAN_COMBINATION_NOT_EXPRESSED",
        "REGIONAL_PATH_COVERAGE",
        "OTHER",
    }
    if qsub in known:
        qpat = qsub
    elif qsub:
        qpat = "OTHER_QUERY"
    else:
        qpat = "NA"
    # failure-stage / parity proxy: empty qsub on recall miss implies RAW miss after repair-capable query
    stage = "RAW_MISS" if mech == "RECALL_TARGET_MISS" else ("QUERY_FAIL" if mech == "QUERY_NOT_REPAIR_CAPABLE" else "OTHER_STAGE")
    return f"{mech}|{qpat}|{len_bucket}|{geom}|{src}|{stage}"


def _cluster_changes(changes: list[ChangeSpan]) -> list[list[ChangeSpan]]:
    if not changes:
        return []
    ordered = sorted(changes, key=lambda c: (c.refRelStart, c.refRelEnd))
    clusters: list[list[ChangeSpan]] = [[ordered[0]]]
    for ch in ordered[1:]:
        prev = clusters[-1][-1]
        gap_end = prev.refRelEnd if prev.refRelEnd > prev.refRelStart else prev.refRelStart
        if ch.refRelStart <= gap_end + 1:
            clusters[-1].append(ch)
        else:
            clusters.append([ch])
    return clusters


def _mk(
    *,
    case_id: str,
    region_id: str,
    eid: str,
    t: dict,
    role: str,
    mech: str,
    notes: str,
    qsub: str = "",
) -> MinimalTargetRecord:
    fam = structural_family_key(mech, role, t, qsub)
    eligible = role in ("PRIMARY_MINIMAL", "ALTERNATIVE_MINIMAL")
    return MinimalTargetRecord(
        caseId=case_id,
        regionId=region_id,
        repairEventId=eid,
        targetId=str(t["targetId"]),
        lexicalTarget=str(t.get("lexicalTarget") or ""),
        targetIdentitySource=str(t.get("targetIdentitySource") or ""),
        targetConfidence=str(t.get("targetConfidence") or ""),
        mechanismPrev=str(t.get("mechanismPrev") or ""),
        querySubPrev=str(t.get("querySubPrev") or ""),
        targetStart=int(t.get("targetStart") or -1),
        targetEnd=int(t.get("targetEnd") or -1),
        diffCoreStart=int(t.get("diffCoreStart") or -1),
        diffCoreEnd=int(t.get("diffCoreEnd") or -1),
        overlapChars=int(t.get("overlapChars") or 0),
        changedElementsCovered=int(t.get("changedElementsCovered") or 0),
        targetRole=role,
        mechanismFinal=mech if eligible else "OUTSIDE_CURRENT_CONTRACT",
        querySubFinal=qsub if eligible else "",
        structuralFamilyKey=fam if eligible else structural_family_key("OUTSIDE_CURRENT_CONTRACT", role, t, ""),
        notes=notes,
        inAuthoritativeLexicon=bool(t.get("inAuthoritativeLexicon")),
    )


def expand_nested_lexicon_minima(
    targets: list[dict[str, Any]],
    *,
    inventory: frozenset[str] | None,
    asr_core: str,
    ref_core: str,
    core_abs_start: int,
) -> list[dict[str, Any]]:
    """Audit-only: recover shorter lexicon units suppressed by longest-first identity."""
    if inventory is None:
        return list(targets)
    changes = change_spans_on_cores(asr_core, ref_core)
    seen = {(int(t["targetStart"]), int(t["targetEnd"]), str(t["lexicalTarget"])) for t in targets}
    out = list(targets)
    n = 0
    for t in targets:
        if not t.get("inAuthoritativeLexicon"):
            continue
        ts = int(t["targetStart"])
        span_text = str(t.get("lexicalTarget") or "")
        for L in range(MIN_TERM_LEN, min(MAX_TERM_LEN, len(span_text))):
            for i in range(0, len(span_text) - L + 1):
                abs_s = ts + i
                abs_e = abs_s + L
                cand = span_text[i : i + L]
                folded = fold_cjk_variant(cand)
                if not lexicon_contains(folded, inventory):
                    continue
                key = (abs_s, abs_e, folded)
                if key in seen:
                    continue
                ov, touched = target_changed_coverage(abs_s, abs_e, core_abs_start, changes)
                if touched <= 0:
                    continue
                n += 1
                seen.add(key)
                out.append(
                    {
                        **t,
                        "targetId": f"{t['targetId']}:n{n}",
                        "lexicalTarget": folded,
                        "targetStart": abs_s,
                        "targetEnd": abs_e,
                        "targetIdentitySource": "EXISTING_LEXICON_TERM",
                        "inAuthoritativeLexicon": True,
                        "outsideLexiconContract": False,
                        "overlapChars": ov,
                        "changedElementsCovered": touched,
                    }
                )
    return out


def assign_roles_for_region(
    *,
    case_id: str,
    region_id: str,
    targets: list[dict[str, Any]],
    asr_core: str,
    ref_core: str,
    core_abs_start: int,
    inventory: frozenset[str] | None = None,
) -> list[MinimalTargetRecord]:
    """Assign minimality roles within one region; repair events = change clusters."""
    changes = change_spans_on_cores(asr_core, ref_core)
    events = _cluster_changes(changes)
    records: list[MinimalTargetRecord] = []
    if not targets:
        return records

    targets = expand_nested_lexicon_minima(
        targets,
        inventory=inventory,
        asr_core=asr_core,
        ref_core=ref_core,
        core_abs_start=core_abs_start,
    )

    enriched: list[dict] = []
    for t in targets:
        ts, te = int(t["targetStart"]), int(t["targetEnd"])
        ov, touched = target_changed_coverage(ts, te, core_abs_start, changes)
        enriched.append({**t, "overlapChars": ov, "changedElementsCovered": touched})

    if not changes:
        for t in enriched:
            role = "CONTEXT_SUPPORT" if t.get("inAuthoritativeLexicon") else "INVALID_LEXICAL_TARGET"
            records.append(
                _mk(
                    case_id=case_id,
                    region_id=region_id,
                    eid=f"{case_id}:{region_id}:e0",
                    t=t,
                    role=role,
                    mech="OUTSIDE_CURRENT_CONTRACT",
                    notes="normalization_or_no_change_span",
                )
            )
        return records

    assigned: set[str] = set()

    for ei, ev in enumerate(events):
        eid = f"{case_id}:{region_id}:e{ei}"
        covering: list[dict] = []
        for t in enriched:
            ts, te = int(t["targetStart"]), int(t["targetEnd"])
            ov, touched = target_changed_coverage(ts, te, core_abs_start, ev)
            if touched <= 0:
                continue
            covering.append({**t, "overlapChars": ov, "changedElementsCovered": touched})

        primary_pool: list[dict] = []
        for t in covering:
            src = t.get("targetIdentitySource") or ""
            if src == "STRUCTURAL_COMPOSITION_SUPPORTED":
                records.append(
                    _mk(
                        case_id=case_id,
                        region_id=region_id,
                        eid=eid,
                        t=t,
                        role="INVALID_LEXICAL_TARGET",
                        mech="OUTSIDE_CURRENT_CONTRACT",
                        notes="structural_composition_lacks_independent_lexical_identity",
                    )
                )
                assigned.add(t["targetId"])
                continue
            if src == "OUTSIDE_LEXICON_CONTRACT" or t.get("outsideLexiconContract"):
                records.append(
                    _mk(
                        case_id=case_id,
                        region_id=region_id,
                        eid=eid,
                        t=t,
                        role="INVALID_LEXICAL_TARGET",
                        mech="OUTSIDE_CURRENT_CONTRACT",
                        notes="outside_lexicon_contract",
                    )
                )
                assigned.add(t["targetId"])
                continue
            if not t.get("inAuthoritativeLexicon"):
                records.append(
                    _mk(
                        case_id=case_id,
                        region_id=region_id,
                        eid=eid,
                        t=t,
                        role="AMBIGUOUS",
                        mech="MECHANISM_AMBIGUOUS",
                        notes="non_lexicon_without_independent_identity",
                    )
                )
                assigned.add(t["targetId"])
                continue
            primary_pool.append(t)

        if not primary_pool:
            continue

        def covers_all(t: dict) -> bool:
            ts, te = int(t["targetStart"]), int(t["targetEnd"])
            ov, touched = target_changed_coverage(ts, te, core_abs_start, ev)
            return touched >= len(ev) and ov > 0

        full = [t for t in primary_pool if covers_all(t)]
        pool = full if full else primary_pool
        # No blind shortest: prefer L>=2 when a covering multi-char lexicon unit exists
        # (Recall/base contract: single-char allowed in inventory but not sole repair owner).
        multi = [t for t in pool if len(norm_text(t["lexicalTarget"])) >= 2]
        use = multi if multi else pool
        min_len = min(len(norm_text(t["lexicalTarget"])) for t in use)
        mins = [t for t in use if len(norm_text(t["lexicalTarget"])) == min_len]
        min_ids = {t["targetId"] for t in mins}

        for t in pool:
            tid = t["targetId"]
            if tid in min_ids:
                role = "PRIMARY_MINIMAL" if len(mins) == 1 else "ALTERNATIVE_MINIMAL"
            else:
                is_super = any(
                    int(t["targetStart"]) <= int(m["targetStart"])
                    and int(t["targetEnd"]) >= int(m["targetEnd"])
                    for m in mins
                )
                # shorter-than-preferred (e.g. L1 when L2+ exists) → PARTIAL_INSUFFICIENT
                role = "SUPERSET_REDUNDANT" if is_super else "PARTIAL_INSUFFICIENT"

            mech = str(t.get("mechanismPrev") or "MECHANISM_AMBIGUOUS")
            qsub = str(t.get("querySubPrev") or "")
            if role not in ("PRIMARY_MINIMAL", "ALTERNATIVE_MINIMAL"):
                mech = "OUTSIDE_CURRENT_CONTRACT"
                qsub = ""
            # Ambiguous mechanism if alternatives disagree
            if role == "ALTERNATIVE_MINIMAL":
                alt_mechs = {str(m.get("mechanismPrev") or "") for m in mins}
                if len(alt_mechs - {""}) > 1:
                    mech = "MECHANISM_AMBIGUOUS"
                    qsub = ""

            records.append(
                _mk(
                    case_id=case_id,
                    region_id=region_id,
                    eid=eid,
                    t=t,
                    role=role,
                    mech=mech,
                    notes="",
                    qsub=qsub,
                )
            )
            assigned.add(tid)

    # Remaining: context / invalid / ambiguous
    for t in enriched:
        if t["targetId"] in assigned:
            continue
        if int(t.get("changedElementsCovered") or 0) <= 0:
            role = "CONTEXT_SUPPORT" if t.get("inAuthoritativeLexicon") else "INVALID_LEXICAL_TARGET"
            notes = "zero_changed_element_overlap"
        else:
            role = "AMBIGUOUS"
            notes = "unassigned_after_event_pass"
        records.append(
            _mk(
                case_id=case_id,
                region_id=region_id,
                eid=f"{case_id}:{region_id}:eX",
                t=t,
                role=role,
                mech="OUTSIDE_CURRENT_CONTRACT" if role != "AMBIGUOUS" else "MECHANISM_AMBIGUOUS",
                notes=notes,
            )
        )
    return records


def repair_event_mechanism(records: list[MinimalTargetRecord]) -> list[dict[str, Any]]:
    """Collapse targets → one row per repairEventId for prevalence."""
    by_event: dict[str, list[MinimalTargetRecord]] = {}
    for r in records:
        if r.targetRole not in ("PRIMARY_MINIMAL", "ALTERNATIVE_MINIMAL"):
            continue
        by_event.setdefault(r.repairEventId, []).append(r)

    rows: list[dict[str, Any]] = []
    for eid, rs in sorted(by_event.items()):
        primaries = [r for r in rs if r.targetRole == "PRIMARY_MINIMAL"]
        alts = [r for r in rs if r.targetRole == "ALTERNATIVE_MINIMAL"]
        chosen = primaries[0] if primaries else alts[0]
        mechs = {r.mechanismFinal for r in rs}
        mech = chosen.mechanismFinal
        if len(mechs) > 1:
            mech = "MECHANISM_AMBIGUOUS"
        rows.append(
            {
                "caseId": chosen.caseId,
                "regionId": chosen.regionId,
                "repairEventId": eid,
                "mechanism": mech,
                "querySubmechanism": chosen.querySubFinal if mech != "MECHANISM_AMBIGUOUS" else "",
                "primaryTargetCount": len(primaries),
                "alternativeTargetCount": len(alts),
                "primaryTargets": "|".join(r.lexicalTarget for r in primaries),
                "alternativeTargets": "|".join(r.lexicalTarget for r in alts),
                "structuralFamilyKey": structural_family_key(
                    mech,
                    "PRIMARY_MINIMAL" if primaries else "ALTERNATIVE_MINIMAL",
                    {
                        "lexicalTarget": chosen.lexicalTarget,
                        "changedElementsCovered": chosen.changedElementsCovered,
                        "targetIdentitySource": chosen.targetIdentitySource,
                    },
                    chosen.querySubFinal if mech != "MECHANISM_AMBIGUOUS" else "",
                ),
                "targetConfidence": chosen.targetConfidence,
            }
        )
    return rows
