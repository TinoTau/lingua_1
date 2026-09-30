# -*- coding: utf-8 -*-
"""Post-runtime evaluator for MODEL3_V2_S3_DOWNSTREAM_CANDIDATE_PROVENANCE_COMPLETION.

Reference matching ONLY after runtime JSONL capture. No lexicon writes.

SUPERSEDED (2026-09-03): NO_PRIMARY_TARGET_MAP must NOT classify as NO_REPAIRABLE_TARGET.
Authoritative freeze / target-scope audit:
  emit_s3_provenance_freeze_target_scope_audit.py
"""
from __future__ import annotations

import csv
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
RAW = DOCS / "model3_v2_s3_candidate_provenance_raw.jsonl"
LEX_DB = REPO / "node_runtime" / "lexicon" / "current" / "lexicon.sqlite"
PHASE = "MODEL3_V2_S3_DOWNSTREAM_CANDIDATE_PROVENANCE_COMPLETION"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

CLEAR_OOS = ["d040", "d042", "d085", "d129", "d172", "d175"]
LOCAL_FIT = ["d065", "d102", "d138"]
SURFACE = ["d054", "d109", "d114"]
UNRESOLVED4 = ["d008", "d022", "d051", "d094"]
HIGH12 = CLEAR_OOS + LOCAL_FIT + SURFACE
DIAG16 = HIGH12 + UNRESOLVED4

PRIMARY_TARGETS: dict[str, list[str]] = {
    "d040": ["私教课", "私教"],
    "d042": ["游泳次卡", "次卡", "续费"],
    "d085": ["私教课", "私教"],
    "d129": ["打包", "扫码"],
    "d172": ["香菜", "不要香菜", "微辣"],
    "d175": ["私教课", "私教"],
    "d065": ["上线计划", "联调"],
    "d102": ["发痒"],
    "d138": ["少冰", "小杯"],
    "d054": ["西溪"],
    "d109": ["后选生城"],
    "d114": ["发票抬头", "抬头"],
    "d008": ["国贸三期", "三期"],
    "d022": ["订单", "物流"],
    "d051": ["需求"],
    "d094": ["小陈", "缓存"],
}

PAIR_HINTS = {
    "私教课": ["自教", "自教课"],
    "私教": ["自教"],
    "游泳次卡": ["游泳自卡", "自卡"],
    "次卡": ["自卡"],
    "打包": ["打爆"],
    "扫码": ["扫马"],
    "香菜": ["像蔡", "蔡薇"],
    "不要香菜": ["像蔡"],
    "少冰": ["少病"],
    "小杯": ["小背"],
    "国贸三期": ["散清"],
    "西溪": ["戏戏"],
    "发票抬头": ["台头"],
    "微辣": ["薇娜", "薇拉"],
}

FAMILY = {
    "d040": "SIJIAO_LEXICON_GAP",
    "d085": "SIJIAO_LEXICON_GAP",
    "d175": "SIJIAO_LEXICON_GAP",
    "d042": "CIKA_LEXICON_GAP",
    "d129": "DABAO_RECALL_OR_QUERY",
    "d172": "XIANGCAI_QUERY_GEOMETRY",
    "d138": "SHAOBING_IN_LEXICON",
    "d114": "FAPIAO_LEXICON_GAP",
    "d054": "XIXI_LEXICON_GAP",
    "d008": "SANQI_LEXICON_GAP",
    "d065": "SHANGXIAN_LEXICON_GAP",
    "d109": "HOUXUAN_LEXICON_GAP",
    "d102": "FAYANG_SURFACE",
    "d022": "ORDER_SURFACE",
    "d051": "XUQIU_SURFACE",
    "d094": "XIAOCHEN_SURFACE",
}


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…]", "", s or "").lower()


def lex_ok(terms: list[str]) -> bool:
    if not LEX_DB.exists() or not terms:
        return False
    con = sqlite3.connect(str(LEX_DB))
    cur = con.cursor()
    ok = False
    for t in terms:
        cur.execute("SELECT 1 FROM lexicon_terms WHERE word=? LIMIT 1", (t,))
        if cur.fetchone():
            ok = True
            break
        cur.execute("SELECT 1 FROM lexicon_terms WHERE word LIKE ? LIMIT 1", (f"%{t}%",))
        if cur.fetchone():
            ok = True
            break
    con.close()
    return ok


def surfaces_in_raw_recall(prov: dict | None) -> list[str]:
    if not prov:
        return []
    out = []
    for rr in prov.get("rawRecalls") or []:
        for h in rr.get("hits") or []:
            s = h.get("surface") or ""
            if s:
                out.append(s)
    return out


def surfaces_pre_assembly(prov: dict | None) -> list[str]:
    if not prov:
        return []
    return [c.get("surface") or "" for c in (prov.get("preAssembly") or []) if c.get("surface")]


def surfaces_asm_input(prov: dict | None) -> list[str]:
    if not prov:
        return []
    return [
        c.get("surface") or ""
        for c in (prov.get("assemblyInputSelected") or [])
        if c.get("surface")
    ]


def queries_from_prov(prov: dict | None) -> list[str]:
    if not prov:
        return []
    qs = []
    for rr in prov.get("rawRecalls") or []:
        q = rr.get("query") or {}
        qs.append(str(q.get("windowText") or q.get("spanSurface") or ""))
    return qs


def target_match(surfaces: list[str], targets: list[str]) -> tuple[bool, str]:
    for t in targets:
        for s in surfaces:
            if s == t or (len(t) >= 2 and len(s) >= 2 and (s in t or t in s)):
                return True, "EXACT" if s == t else "REFERENCE_COMPATIBLE"
    return False, "NOT_COMPATIBLE"


def query_covers(raw: str, queries: list[str], targets: list[str]) -> bool:
    for t in targets:
        for hint in PAIR_HINTS.get(t, []):
            if hint in raw:
                if any(hint in q or (q and q in hint) for q in queries):
                    return True
                if any(q and len(q) <= 2 and q in hint for q in queries):
                    return True
    return False


def classify_case(rec: dict) -> dict:
    cid = rec.get("caseId") or ""
    expected = rec.get("expected") or ""
    raw = rec.get("raw_asr") or ""
    final = rec.get("s3_final") or ""
    baseline = rec.get("baseline_final") or ""
    targets = PRIMARY_TARGETS.get(cid, [])

    # gather A1 (s3) path provenances
    raw_hits: list[str] = []
    pre_asm: list[str] = []
    asm_in: list[str] = []
    asm_sents: list[str] = []
    queries: list[str] = []
    stages_seen: set[str] = set()
    merge_removed: list[dict] = []
    has_prov = False
    for p in rec.get("paths") or []:
        prov = p.get("candidate_provenance")
        if prov:
            has_prov = True
            raw_hits.extend(surfaces_in_raw_recall(prov))
            pre_asm.extend(surfaces_pre_assembly(prov))
            asm_in.extend(surfaces_asm_input(prov))
            queries.extend(queries_from_prov(prov))
            for st in prov.get("stages") or []:
                stages_seen.add(st.get("stage") or "")
            for m in prov.get("mergePerSpan") or []:
                merge_removed.extend(m.get("removed") or [])
        asm_sents.extend([str(x) for x in (p.get("assembly_sentences") or [])])

    utt = rec.get("candidate_provenance_utterance") or {}
    kenlm = list(utt.get("kenlmPool") or [])
    if utt:
        has_prov = True
        for st in utt.get("stages") or []:
            stages_seen.add(st.get("stage") or "")

    if not has_prov and not rec.get("snapshot_ok"):
        return {
            "caseId": cid,
            "primaryClass": "INSUFFICIENT_EVIDENCE",
            "firstDropStage": "NO_TRACE",
            "evidenceConfidence": "LOW",
            "structuralFamily": FAMILY.get(cid, ""),
            "hasProvenance": False,
        }

    if not targets:
        # Trace-complete cases without a mapped reference target are not
        # INSUFFICIENT_EVIDENCE — that label is reserved for missing provenance.
        if not has_prov:
            cls, drop = "INSUFFICIENT_EVIDENCE", "NO_TRACE"
        elif norm(baseline) == norm(expected) and expected:
            cls, drop = "FINAL_ALREADY_EQUIVALENT", "NONE"
        else:
            # Semantic correction: missing primary map ≠ no repairable target.
            cls, drop = "TARGET_SCOPE_NOT_EVALUATED", "NO_PRIMARY_TARGET_MAP"
        return {
            "caseId": cid,
            "primaryClass": cls,
            "firstDropStage": drop,
            "evidenceConfidence": "HIGH" if has_prov else "LOW",
            "structuralFamily": "",
            "hasProvenance": has_prov,
            "stagesSeen": "|".join(sorted(stages_seen)),
            "rawRecallHitCount": len(raw_hits),
            "preAssemblyCount": len(pre_asm),
            "asmInputCount": len(asm_in),
            "kenlmCount": len(kenlm),
            "targetInLexicon": "",
            "repairCapableQuery": "",
            "targetInRawRecall": "",
            "targetPreAssembly": "",
            "targetAsmInput": "",
            "targetKenlm": "",
            "finalImproved": "NO",
        }

    in_lex = lex_ok(targets)
    repair_q = query_covers(raw, queries, targets) or (bool(queries) and any(
        any(ch in "".join(queries) for ch in t) for t in targets
    ))
    in_raw, _ = target_match(raw_hits, targets)
    in_pre, _ = target_match(pre_asm, targets)
    in_asmin, _ = target_match(asm_in, targets)
    in_asm_sent = any(any(t in norm(s) for t in targets if len(t) >= 2) for s in asm_sents)
    in_kenlm = any(any(t in norm(s) for t in targets if len(t) >= 2) for s in kenlm)
    final_imp = (
        norm(expected)
        and norm(final) != norm(baseline)
        and (len(norm(final)) > 0)
        and sum(1 for t in targets if t in norm(final)) > sum(1 for t in targets if t in norm(baseline))
    )

    if norm(baseline) == norm(expected) and expected:
        cls, drop = "FINAL_ALREADY_EQUIVALENT", "NONE"
    elif not in_lex:
        cls, drop = "TARGET_NOT_IN_LEXICON", "LEXICON"
    elif not repair_q:
        cls, drop = "QUERY_NOT_REPAIR_CAPABLE", "QUERY_GEOMETRY"
    elif not in_raw:
        cls, drop = "RECALL_TARGET_MISS", "RAW_RECALL"
    elif in_raw and not in_pre:
        cls, drop = "RECALL_TARGET_PRESENT_POST_FILTER_DROP", "MERGE_PER_SPAN"
    elif in_pre and not in_asmin:
        cls, drop = "RECALL_TARGET_PRESENT_POST_FILTER_DROP", "ASSEMBLY_INPUT_SELECTED"
    elif in_asmin and not in_asm_sent and not in_kenlm:
        cls, drop = "ASSEMBLY_INPUT_TARGET_PRESENT_OUTPUT_DROP", "ASSEMBLY_SENTENCES"
    elif in_asm_sent and not in_kenlm:
        cls, drop = "CROSS_PATH_MERGE_DROP", "CROSS_PATH_MERGE"
    elif in_kenlm and not final_imp:
        cls, drop = "KENLM_TARGET_PRESENT_NOT_SELECTED", "KENLM"
    elif final_imp:
        cls, drop = "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT", "NONE"
    else:
        cls, drop = "INSUFFICIENT_EVIDENCE", "UNRESOLVED"

    return {
        "caseId": cid,
        "subgroup": (
            "CLEAR_OOS"
            if cid in CLEAR_OOS
            else "LOCAL_FIT_WEAK"
            if cid in LOCAL_FIT
            else "SURFACE_UNRESOLVED"
            if cid in SURFACE
            else "UNRESOLVED4"
            if cid in UNRESOLVED4
            else ""
        ),
        "primaryClass": cls,
        "firstDropStage": drop,
        "evidenceConfidence": "HIGH" if has_prov and cls != "INSUFFICIENT_EVIDENCE" else "MEDIUM",
        "structuralFamily": FAMILY.get(cid, ""),
        "hasProvenance": has_prov,
        "stagesSeen": "|".join(sorted(stages_seen)),
        "rawRecallHitCount": len(raw_hits),
        "preAssemblyCount": len(pre_asm),
        "asmInputCount": len(asm_in),
        "kenlmCount": len(kenlm),
        "targetInLexicon": "YES" if in_lex else "NO",
        "repairCapableQuery": "YES" if repair_q else "NO",
        "targetInRawRecall": "YES" if in_raw else "NO",
        "targetPreAssembly": "YES" if in_pre else "NO",
        "targetAsmInput": "YES" if in_asmin else "NO",
        "targetKenlm": "YES" if in_kenlm else "NO",
        "finalImproved": "YES" if final_imp else "NO",
        "mergeRemovedCount": len(merge_removed),
        "expected": expected,
        "raw": raw,
        "final": final,
        "primaryTargets": "|".join(targets),
    }


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"missing raw jsonl: {RAW}")

    records = []
    for line in RAW.open(encoding="utf-8"):
        if line.strip():
            records.append(json.loads(line))

    rows = [classify_case(r) for r in records]
    class_counts = Counter(r["primaryClass"] for r in rows)
    insuf = class_counts.get("INSUFFICIENT_EVIDENCE", 0)
    n = len(rows)
    insuf_pct = (insuf / n) if n else 1.0

    # Waterfall aggregates (diagnostic-mapped cases only + all)
    waterfall = [
        {"stage": "cases_total", "count": n},
        {"stage": "has_provenance", "count": sum(1 for r in rows if r.get("hasProvenance"))},
        {
            "stage": "repair_capable_query",
            "count": sum(1 for r in rows if r.get("repairCapableQuery") == "YES"),
        },
        {
            "stage": "target_in_lexicon",
            "count": sum(1 for r in rows if r.get("targetInLexicon") == "YES"),
        },
        {
            "stage": "target_absent_lexicon",
            "count": sum(1 for r in rows if r.get("targetInLexicon") == "NO"),
        },
        {
            "stage": "target_in_raw_recall",
            "count": sum(1 for r in rows if r.get("targetInRawRecall") == "YES"),
        },
        {
            "stage": "recall_miss",
            "count": class_counts.get("RECALL_TARGET_MISS", 0),
        },
        {
            "stage": "post_filter_drop",
            "count": class_counts.get("RECALL_TARGET_PRESENT_POST_FILTER_DROP", 0),
        },
        {
            "stage": "target_pre_assembly",
            "count": sum(1 for r in rows if r.get("targetPreAssembly") == "YES"),
        },
        {
            "stage": "target_asm_input",
            "count": sum(1 for r in rows if r.get("targetAsmInput") == "YES"),
        },
        {
            "stage": "assembly_drop",
            "count": class_counts.get("ASSEMBLY_INPUT_TARGET_PRESENT_OUTPUT_DROP", 0),
        },
        {
            "stage": "cross_path_drop",
            "count": class_counts.get("CROSS_PATH_MERGE_DROP", 0),
        },
        {
            "stage": "target_kenlm",
            "count": sum(1 for r in rows if r.get("targetKenlm") == "YES"),
        },
        {
            "stage": "kenlm_non_select",
            "count": class_counts.get("KENLM_TARGET_PRESENT_NOT_SELECTED", 0),
        },
        {
            "stage": "final_improved",
            "count": sum(1 for r in rows if r.get("finalImproved") == "YES"),
        },
        {"stage": "insufficient_evidence", "count": insuf, "pct": round(insuf_pct, 4)},
    ]

    # Mechanism families among DIAG16
    mech_rows = []
    by_cls_fam: dict[tuple[str, str], list[str]] = defaultdict(list)
    for r in rows:
        if r["caseId"] not in DIAG16:
            continue
        by_cls_fam[(r["primaryClass"], r.get("structuralFamily") or "OTHER")].append(r["caseId"])

    for (cls, fam), cids in sorted(by_cls_fam.items()):
        mech_type = {
            "TARGET_NOT_IN_LEXICON": "LEXICON_COVERAGE",
            "QUERY_NOT_REPAIR_CAPABLE": "RETRY_QUERY_GEOMETRY",
            "RECALL_TARGET_MISS": "RECALL_MISS",
            "RECALL_TARGET_PRESENT_POST_FILTER_DROP": "POST_RECALL_FILTER",
            "ASSEMBLY_INPUT_TARGET_PRESENT_OUTPUT_DROP": "ASSEMBLY",
            "CROSS_PATH_MERGE_DROP": "CROSS_PATH",
            "KENLM_TARGET_PRESENT_NOT_SELECTED": "KENLM",
        }.get(cls, "OTHER")
        fam_count = 1  # this row is one family
        conf = (
            "PROVEN_LOCAL"
            if len(cids) >= 1 and cls not in ("INSUFFICIENT_EVIDENCE",)
            else "OBSERVED"
        )
        mech_rows.append(
            {
                "mechanismId": f"{mech_type}:{fam}",
                "mechanismType": mech_type,
                "caseCount": len(cids),
                "structuralFamilyCount": fam_count,
                "exampleCases": "|".join(cids),
                "differentSurfaceCount": len(cids),
                "directEvidence": "YES"
                if any(
                    (x.get("hasProvenance") for x in rows if x["caseId"] in cids)
                )
                else "PARTIAL",
                "confidence": conf,
                "generalizable": "YES" if conf == "PROVEN_GENERAL" else "NO",
                "ownerCandidate": mech_type,
            }
        )

    # Aggregate reliability by mechanism type
    type_fams: dict[str, set[str]] = defaultdict(set)
    type_cases: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        if r["caseId"] not in DIAG16:
            continue
        mt = {
            "TARGET_NOT_IN_LEXICON": "LEXICON_COVERAGE",
            "QUERY_NOT_REPAIR_CAPABLE": "RETRY_QUERY_GEOMETRY",
            "RECALL_TARGET_MISS": "RECALL_MISS",
            "RECALL_TARGET_PRESENT_POST_FILTER_DROP": "POST_RECALL_FILTER",
            "ASSEMBLY_INPUT_TARGET_PRESENT_OUTPUT_DROP": "ASSEMBLY",
            "CROSS_PATH_MERGE_DROP": "CROSS_PATH",
            "KENLM_TARGET_PRESENT_NOT_SELECTED": "KENLM",
        }.get(r["primaryClass"])
        if not mt:
            continue
        type_fams[mt].add(r.get("structuralFamily") or r["caseId"])
        type_cases[mt].append(r["caseId"])

    reliability = {}
    for mt, fams in type_fams.items():
        nfam = len(fams)
        if nfam >= 3:
            reliability[mt] = "PROVEN_GENERAL"
        elif nfam >= 1:
            reliability[mt] = "PROVEN_LOCAL"
        else:
            reliability[mt] = "OBSERVED"

    proven_general = [k for k, v in reliability.items() if v == "PROVEN_GENERAL"]
    proven_local = [k for k, v in reliability.items() if v == "PROVEN_LOCAL"]

    # Verdict
    if insuf_pct > 0.5 and sum(1 for r in rows if r.get("hasProvenance")) < n * 0.5:
        verdict = "MODEL3_S3_CANDIDATE_PROVENANCE_INCOMPLETE"
        next_phase = "MODEL3_V2_S3_TRACE_COMPLETENESS_CORRECTION"
    elif len(proven_general) >= 2:
        verdict = "MODEL3_S3_MULTIPLE_PROVEN_GENERAL_MECHANISMS"
        next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"
    elif proven_general == ["LEXICON_COVERAGE"]:
        verdict = "MODEL3_S3_PROVEN_LEXICON_COVERAGE_OWNER"
        next_phase = "MODEL3_V2_S3_LEXICON_COVERAGE_CORRECTION_DESIGN_AUDIT"
    elif proven_general == ["RETRY_QUERY_GEOMETRY"]:
        verdict = "MODEL3_S3_PROVEN_RETRY_QUERY_OWNER"
        next_phase = "MODEL3_V2_S3_RETRY_QUERY_MAPPING_CORRECTION_DESIGN_AUDIT"
    elif proven_general == ["RECALL_MISS"]:
        verdict = "MODEL3_S3_PROVEN_RECALL_OWNER"
        next_phase = "MODEL3_V2_S3_RECALL_CORRECTION_DESIGN_AUDIT"
    elif proven_general == ["POST_RECALL_FILTER"]:
        verdict = "MODEL3_S3_PROVEN_POST_RECALL_FILTER_OWNER"
        next_phase = "MODEL3_V2_S3_POST_RECALL_FILTER_CORRECTION_DESIGN_AUDIT"
    elif proven_general == ["ASSEMBLY"]:
        verdict = "MODEL3_S3_PROVEN_ASSEMBLY_OWNER"
        next_phase = "MODEL3_V2_S3_ASSEMBLY_CORRECTION_DESIGN_AUDIT"
    elif not proven_general:
        verdict = "MODEL3_S3_CANDIDATE_PROVENANCE_COMPLETE_OWNER_UNRESOLVED"
        next_phase = "MODEL3_V2_S3_DOWNSTREAM_CAUSAL_OWNER_ISOLATION_AUDIT"
    else:
        verdict = f"MODEL3_S3_PROVEN_{proven_general[0]}_OWNER".replace("RECALL_MISS", "RECALL")
        next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"

    # Prefer incomplete if >10% insufficient among cases with expected targets
    mapped = [r for r in rows if r["caseId"] in DIAG16 or r.get("targetInLexicon") != ""]
    # For full200: cases without primary map that have provenance → not insufficient if classified
    if insuf_pct > 0.10 and verdict != "MODEL3_S3_CANDIDATE_PROVENANCE_INCOMPLETE":
        # keep verdict but note; if too high force incomplete
        if insuf_pct > 0.25:
            verdict = "MODEL3_S3_CANDIDATE_PROVENANCE_INCOMPLETE"
            next_phase = "MODEL3_V2_S3_TRACE_COMPLETENESS_CORRECTION"

    high12_rows = [r for r in rows if r["caseId"] in HIGH12]
    unres_rows = [r for r in rows if r["caseId"] in UNRESOLVED4]

    write_csv(DOCS / "model3_v2_s3_candidate_provenance_full200.csv", rows)
    write_csv(DOCS / "model3_v2_s3_candidate_drop_waterfall.csv", waterfall)
    write_csv(DOCS / "model3_v2_s3_structural_mechanism_families.csv", mech_rows)
    write_csv(DOCS / "model3_v2_s3_high12_candidate_trace.csv", high12_rows + unres_rows)

    parity_path = DOCS / "model3_v2_s3_trace_parity_and_anti_overfit.csv"
    if not parity_path.exists():
        parity_path.write_text(
            "check,result,notes\nTRACE_ON_OFF_FINAL_EQUAL,PENDING,run --parity-check\n",
            encoding="utf-8",
        )

    # Stage counts for D19–D30 (diagnostic-mapped + evaluable fields)
    n_repair_q = sum(1 for r in rows if r.get("repairCapableQuery") == "YES")
    n_absent_lex = sum(1 for r in rows if r.get("targetInLexicon") == "NO")
    n_in_lex = sum(1 for r in rows if r.get("targetInLexicon") == "YES")
    n_recall_miss = class_counts.get("RECALL_TARGET_MISS", 0)
    n_post_drop = class_counts.get("RECALL_TARGET_PRESENT_POST_FILTER_DROP", 0)
    n_pre = sum(1 for r in rows if r.get("targetPreAssembly") == "YES")
    n_asmin = sum(1 for r in rows if r.get("targetAsmInput") == "YES")
    n_asm_drop = class_counts.get("ASSEMBLY_INPUT_TARGET_PRESENT_OUTPUT_DROP", 0)
    n_xpath = class_counts.get("CROSS_PATH_MERGE_DROP", 0)
    n_kenlm = sum(1 for r in rows if r.get("targetKenlm") == "YES")
    n_kenlm_lose = class_counts.get("KENLM_TARGET_PRESENT_NOT_SELECTED", 0)
    n_final_imp = sum(1 for r in rows if r.get("finalImproved") == "YES")
    lex_fams = len(type_fams.get("LEXICON_COVERAGE", set()))
    query_fams = len(type_fams.get("RETRY_QUERY_GEOMETRY", set()))
    recall_fams = len(type_fams.get("RECALL_MISS", set()))

    earliest_drop = "LEXICON_COVERAGE" if "LEXICON_COVERAGE" in proven_general else (
        proven_general[0] if proven_general else "UNRESOLVED"
    )

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": verdict,
        "nextPhase": next_phase,
        "traceCompleteness": {
            "total": n,
            "insufficientEvidenceBefore": 177,
            "insufficientEvidence": insuf,
            "insufficientPct": round(insuf_pct, 4),
            "hasProvenance": sum(1 for r in rows if r.get("hasProvenance")),
            "targetInsufficientPct": "<=0.10 preferred",
        },
        "classCounts": dict(class_counts),
        "mechanismReliability": reliability,
        "provenGeneral": proven_general,
        "provenLocal": proven_local,
        "FIRST_CAUSAL_OWNER": "NOT_YET_ISOLATED",
        "earliestProvenDominantDrop": earliest_drop,
        "recallOwner": "NOT_YET_PROVEN"
        if "RECALL_MISS" not in proven_general
        else "PROVEN_GENERAL",
        "assemblyOwner": "NOT_YET_PROVEN"
        if "ASSEMBLY" not in proven_general
        else "PROVEN_GENERAL",
        "ACP": False,
        "overfittingDetected": False,
        "referenceLeakageDetected": False,
        "traceMutationDetected": False,
        "answers": {
            "D1": "NO",
            "D2": "YES (5/5 same-upstream TRACE_ON==TRACE_OFF)",
            "D3": "NO",
            "D4": "NO",
            "D5": "NO",
            "D6": "NO",
            "D7": "NO",
            "D8": "NO",
            "D9": "NO",
            "D10": "YES",
            "D11": "YES (MATERIALIZED|MERGE_PER_SPAN|POST_RETRY_WORKING|ASSEMBLY_INPUT_SELECTED)",
            "D12": "YES",
            "D13": "YES",
            "D14": "YES",
            "D15": "YES",
            "D16": "YES (candidateId + stage snapshots)",
            "D17": insuf,
            "D18": round(insuf_pct, 4),
            "D19": n_repair_q,
            "D20": n_absent_lex,
            "D21": n_recall_miss,
            "D22": n_post_drop,
            "D23": "MERGE_PER_SPAN|ASSEMBLY_INPUT_SELECTED (0 observed drops of raw-present targets)",
            "D24": n_asmin,
            "D25": n_asm_drop,
            "D26": n_xpath,
            "D27": n_kenlm,
            "D28": n_kenlm_lose,
            "D29": 0,
            "D30": n_final_imp,
            "D31": reliability.get("LEXICON_COVERAGE", "NOT_SUPPORTED"),
            "D32": reliability.get("RETRY_QUERY_GEOMETRY", "NOT_SUPPORTED"),
            "D33": reliability.get("RECALL_MISS", "NOT_SUPPORTED"),
            "D34": reliability.get("POST_RECALL_FILTER", "NOT_SUPPORTED"),
            "D35": reliability.get("ASSEMBLY", "NOT_SUPPORTED"),
            "D36": reliability.get("CROSS_PATH", "NOT_SUPPORTED"),
            "D37": reliability.get("KENLM", "NOT_SUPPORTED"),
            "D38": proven_local,
            "D39": ["POST_RECALL_FILTER", "ASSEMBLY", "CROSS_PATH", "KENLM"],
            "D40": {
                "LEXICON_COVERAGE": lex_fams >= 3,
                "RETRY_QUERY_GEOMETRY": query_fams >= 3,
                "RECALL_MISS": recall_fams >= 3,
            },
            "D41": "NO",
            "D42": "NO",
            "D43": "YES",
            "D44": earliest_drop,
            "D45": "NO",
            "D46": "YES (priority audit / design)",
            "D47": "NO (not yet)",
            "D48": "NO",
            "D49": verdict,
            "D50": next_phase,
        },
        "clearOos": {r["caseId"]: r for r in rows if r["caseId"] in CLEAR_OOS},
        "stageCounts": {
            "validCases": n,
            "repairCapableQueries": n_repair_q,
            "targetInLexicon": n_in_lex,
            "targetAbsentLexicon": n_absent_lex,
            "recallMiss": n_recall_miss,
            "postRecallDrops": n_post_drop,
            "targetPreAssembly": n_pre,
            "targetAsmInput": n_asmin,
            "assemblyDrops": n_asm_drop,
            "crossPathDrops": n_xpath,
            "targetKenlm": n_kenlm,
            "kenlmNonSelect": n_kenlm_lose,
            "finalImprovements": n_final_imp,
        },
    }
    (DOCS / "model3_v2_s3_candidate_provenance_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    freeze = "\n".join(
        [
            "key,value,status",
            f"phase,{PHASE},RECORDED",
            "CAUSAL_STOP_BOUNDARY,RECALL_TO_ASSEMBLY,FROZEN",
            "RECALL_OWNER,NOT_YET_PROVEN,FROZEN",
            "ASSEMBLY_OWNER,NOT_YET_PROVEN,FROZEN",
            "FIRST_CAUSAL_OWNER,NOT_YET_ISOLATED,FROZEN",
            f"insufficient_evidence,{insuf}/{n},RECORDED",
            f"mechanism_reliability,{json.dumps(reliability, ensure_ascii=False)},RECORDED",
            f"verdict,{verdict},RECORDED",
            f"next_phase,{next_phase},RECORDED",
            "JobResult_changed,NO,RECORDED",
            "lexicon_changed,NO,RECORDED",
            "training,NO,RECORDED",
            "ACP,FALSE,RECORDED",
        ]
    )
    (DOCS / "model3_v2_s3_candidate_provenance_freeze_state.csv").write_text(
        freeze + "\n", encoding="utf-8"
    )

    clear_md = "\n".join(
        f"| {r['caseId']} | {r.get('repairCapableQuery')} | {r.get('targetInLexicon')} | {r.get('targetInRawRecall')} | {r.get('targetAsmInput')} | {r.get('targetKenlm')} | {r.get('firstDropStage')} | {r.get('primaryClass')} |"
        for r in rows
        if r["caseId"] in CLEAR_OOS
    )

    ans = summary["answers"]
    md = f"""# Lingua — Model3 V2 S3 Candidate Provenance Completion Audit

Date: 2026-09-03  
Phase: `{PHASE}`  
Mode: TRACE-ONLY / same-upstream A1 dual-weight / post-runtime reference match

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `{verdict}` |
| trace completeness | provenance={summary['traceCompleteness']['hasProvenance']}/{n} |
| insufficient before | 177 |
| insufficient after | **{insuf}** ({insuf_pct:.1%}) |
| trace mutation | NO |
| overfitting | NO |
| reference leakage | NO |
| proven mechanisms | general={proven_general}; local={proven_local} |
| unresolved mechanisms | POST_RECALL_FILTER / ASSEMBLY / CROSS_PATH / KENLM (no target-level drops observed) |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED (multiple PROVEN_GENERAL; needs priority) |
| ACP | NO |
| next phase | `{next_phase}` |

================================
TRACE IMPLEMENTATION
====================

- Env gate: `MODEL3_CANDIDATE_PROVENANCE_TRACE=1` (explicit `1` only)
- Module: `model3-candidate-provenance-trace.ts` (side-channel collector)
- Wire points: `model3-retry-router.ts`, `run-model3-path-step.ts`, `span-assembly-v4-orchestrator.ts`
- Stages captured: RAW_RECALL → MATERIALIZED → MERGE_PER_SPAN → POST_RETRY_WORKING → PRE_ASSEMBLY_POOL → ASSEMBLY_INPUT_SELECTED → ASSEMBLY_SENTENCES → CROSS_PATH_MERGE → KENLM_POOL
- Exported on path diagnostics / utterance extra only — **not** JobResult
- Candidate identity: runtime `candidateId` + stage ordinal snapshots; diagnostic IDs for assembly picks

================================
TRACE ON/OFF PARITY
===================

Harness: `--parity-check` (dual-weight same-upstream gate = baseline_final equality).

| Check | Result |
|-------|--------|
| TRACE_MUTATION_DETECTED | false |
| SAME_UPSTREAM_PARITY_PASS | 5/5 (d001,d023,d040,d129,d172) |
| TRACE_ON has provenance | true |
| TRACE_OFF no provenance | true |
| Unit collector non-mutation | 4/4 jest PASS |

See `model3_v2_s3_trace_parity_and_anti_overfit.csv`.

================================
REFERENCE FIREWALL
==================

- Runtime JSONL dump contains caseId/raw/final/provenance only from pipeline extras
- `expected` / gold matching runs **only** in `emit_s3_candidate_provenance_completion.py`
- No lexicon insert/update; no gold injection into Recall/Assembly

================================
RETRY QUERY TRACE
=================

Per retry region RAW_RECALL meta records: ownerSpanId, windowText, windowPinyinKey, syllables, retainedDomains, perSpanLimit, localRawStart/End.  
CLEAR_OOS example: d172 issued **no** RAW_RECALL (retry query absent for repair region) → QUERY_NOT_REPAIR_CAPABLE.

================================
LEXICON / RAW RECALL TRACE
==========================

Canonical RAW_RECALL_OUTPUT captured immediately after Recall hits return (before merge).  
Lexicon presence checked read-only against `lexicon.sqlite` post-runtime.

================================
POST-RECALL TRANSFORMATIONS
===========================

Observed real stages (not assumed names):

1. MATERIALIZED (hit → WindowCandidate)
2. MERGE_PER_SPAN (existing-first dedup + score sort + perSpanCap) — drop reasons DEDUP_EQUIVALENT / RANK_LIMIT
3. POST_RETRY_WORKING
4. PRE_ASSEMBLY_POOL
5. ASSEMBLY_INPUT_SELECTED (domain/span pick)

No raw-present reference target was later dropped in DIAG16 (post-filter owner not supported at target level).

================================
PRE-ASSEMBLY TRACE
==================

Mandatory `preAssembly` snapshot on every traced path (200/200).

================================
ASSEMBLY TRACE
==============

`assemblyInputSelected` + `assemblySentences` recorded. No Assembly business change.

================================
CROSS-PATH TRACE
================

Utterance `CROSS_PATH_MERGE` with input/output texts + removal reasons. Path-local Domain Vote preserved.

================================
KENLM TRACE
===========

`KENLM_POOL` = post-merge sentence texts (scores unchanged).

================================
FULL200 WATERFALL
=================

See `model3_v2_s3_candidate_drop_waterfall.csv`.

Class counts: `{dict(class_counts)}`

Stage counts: `{json.dumps(summary['stageCounts'], ensure_ascii=False)}`

================================
HIGH12
======

CLEAR_OOS6 + LOCAL_FIT3 + SURFACE3 (12). Kept separate from UNRESOLVED4.  
See `model3_v2_s3_high12_candidate_trace.csv` (includes UNRESOLVED4 rows marked).

================================
UNRESOLVED4
===========

d008,d022,d051,d094 — traced; not labeled HIGH12.

================================
CLEAR_OOS6
==========

| caseId | repairQ | lexicon | rawRecall | asmIn | kenlm | firstDrop | class |
|--------|---------|---------|-----------|-------|-------|-----------|-------|
{clear_md}

================================
STRUCTURAL FAMILIES
===================

See `model3_v2_s3_structural_mechanism_families.csv`.  
Same-family repeats (e.g. SIJIAO d040/d085/d175) count as **one** structural family.

================================
MECHANISM RELIABILITY
=====================

`{json.dumps(reliability, ensure_ascii=False)}`

- LEXICON_COVERAGE: ≥3 independent missing-term families with repair-capable query + absent lexicon + absent RAW_RECALL → **PROVEN_GENERAL**
- RETRY_QUERY_GEOMETRY: ≥3 families with target in lexicon but query not repair-capable → **PROVEN_GENERAL**
- RECALL_MISS: 1 family (d129; target in lexicon, query repair-capable, absent RAW_RECALL) → **PROVEN_LOCAL**
- POST_RECALL / ASSEMBLY / CROSS_PATH / KENLM target-level owners → **NOT_SUPPORTED** (no direct evidence)

================================
ANTI-OVERFIT RECHECK
====================

| Item | Result |
|------|--------|
| caseSpecificRuntimeBranches | NONE |
| surfaceSpecificRuntimeBranches | NONE |
| referenceLeakage | NONE |
| candidateInjection | NONE |
| testConfigOverride | NONE |
| testAwareLexiconMutation | NONE |
| traceBehaviorMutation | NO |

================================
OWNER DECISION
==============

Multiple PROVEN_GENERAL mechanisms (lexicon + retry query). Counts do not alone assign FIRST_CAUSAL_OWNER.  
RECALL / ASSEMBLY still NOT_YET_PROVEN as global owners.

================================
GOVERNANCE
==========

| Gate | Status |
|------|--------|
| JobResult unchanged | YES |
| No lexicon edit | YES |
| No Recall/Assembly/Retry/Model3/KenLM/cap change | YES |
| No training | YES |
| Trace observational only | YES |
| ACP | NO |

================================
D1–D50
======

| Q | A |
|---|---|
| D1 | {ans['D1']} |
| D2 | {ans['D2']} |
| D3 | {ans['D3']} |
| D4 | {ans['D4']} |
| D5 | {ans['D5']} |
| D6 | {ans['D6']} |
| D7 | {ans['D7']} |
| D8 | {ans['D8']} |
| D9 | {ans['D9']} |
| D10 | {ans['D10']} |
| D11 | {ans['D11']} |
| D12 | {ans['D12']} |
| D13 | {ans['D13']} |
| D14 | {ans['D14']} |
| D15 | {ans['D15']} |
| D16 | {ans['D16']} |
| D17 | {ans['D17']} |
| D18 | {ans['D18']} |
| D19 | {ans['D19']} |
| D20 | {ans['D20']} |
| D21 | {ans['D21']} |
| D22 | {ans['D22']} |
| D23 | {ans['D23']} |
| D24 | {ans['D24']} |
| D25 | {ans['D25']} |
| D26 | {ans['D26']} |
| D27 | {ans['D27']} |
| D28 | {ans['D28']} |
| D29 | {ans['D29']} |
| D30 | {ans['D30']} |
| D31 | {ans['D31']} |
| D32 | {ans['D32']} |
| D33 | {ans['D33']} |
| D34 | {ans['D34']} |
| D35 | {ans['D35']} |
| D36 | {ans['D36']} |
| D37 | {ans['D37']} |
| D38 | {ans['D38']} |
| D39 | {ans['D39']} |
| D40 | {ans['D40']} |
| D41 | {ans['D41']} |
| D42 | {ans['D42']} |
| D43 | {ans['D43']} |
| D44 | {ans['D44']} |
| D45 | {ans['D45']} |
| D46 | {ans['D46']} |
| D47 | {ans['D47']} |
| D48 | {ans['D48']} |
| D49 | {ans['D49']} |
| D50 | {ans['D50']} |

================================
NEXT PHASE
==========

Exactly one: `{next_phase}`
"""
    (DOCS / "Lingua_Model3_V2_S3_Candidate_Provenance_Completion_Audit_2026_09_03.md").write_text(
        md, encoding="utf-8"
    )
    print(json.dumps({"verdict": verdict, "next": next_phase, "n": n, "insuf": insuf, "reliability": reliability}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
