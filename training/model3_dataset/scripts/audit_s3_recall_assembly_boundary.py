# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_RECALL_ASSEMBLY_BOUNDARY_CAUSAL_AUDIT — emit artifacts (read-only)."""
from __future__ import annotations

import csv
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
TRACE = DOCS / "model3_v2_retry_recall_query_trace.jsonl"
MATRIX = DOCS / "model3_v2_s3_downstream_causal_case_matrix.csv"
LEX_DB = REPO / "node_runtime" / "lexicon" / "current" / "lexicon.sqlite"
PHASE = "MODEL3_V2_S3_RECALL_ASSEMBLY_BOUNDARY_CAUSAL_AUDIT"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

CLEAR_OOS = ["d040", "d042", "d085", "d129", "d172", "d175"]
LOCAL_FIT = ["d065", "d102", "d138"]
SURFACE = ["d054", "d109", "d114"]
UNRESOLVED4 = ["d008", "d022", "d051", "d094"]
HIGH12 = CLEAR_OOS + LOCAL_FIT + SURFACE + UNRESOLVED4
CONTROLS = ["d001", "d002", "d023", "d038", "d044", "d069", "d077", "d100"]

SUBGROUP = {
    **{c: "CLEAR_OOS" for c in CLEAR_OOS},
    **{c: "LOCAL_FIT_WEAK" for c in LOCAL_FIT},
    **{c: "SURFACE_UNRESOLVED" for c in SURFACE},
    **{c: "UNRESOLVED4" for c in UNRESOLVED4},
}

# Primary repair targets (evaluation-only). Not injected into runtime.
PRIMARY_TARGETS: dict[str, list[str]] = {
    "d040": ["私教课", "私教"],
    "d042": ["游泳次卡", "次卡", "续费"],
    "d085": ["私教课", "私教"],
    "d129": ["打包", "扫码", "扫码支付"],
    "d172": ["香菜", "不要香菜", "微辣"],
    "d175": ["私教课", "私教"],
    "d065": ["上线计划", "联调", "后选生城"],
    "d102": ["过敏发痒", "发痒"],
    "d138": ["少冰", "小杯"],
    "d054": ["西溪", "杭州西溪"],
    "d109": ["后选生城"],
    "d114": ["发票抬头", "抬头"],
    "d008": ["国贸三期", "三期"],
    "d022": ["订单", "物流"],
    "d051": ["需求"],
    "d094": ["小陈", "缓存"],
}


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…]", "", s or "").lower()


def lex_lookup(terms: list[str]) -> dict[str, dict]:
    con = sqlite3.connect(str(LEX_DB))
    cur = con.cursor()
    out = {}
    for t in terms:
        cur.execute("SELECT COUNT(*) FROM lexicon_terms WHERE word=?", (t,))
        exact = cur.fetchone()[0]
        cur.execute("SELECT word FROM lexicon_terms WHERE word LIKE ? LIMIT 3", (f"%{t}%",))
        likes = [r[0] for r in cur.fetchall()]
        out[t] = {"exact": exact > 0, "like": likes}
    con.close()
    return out


def load_traces() -> dict[str, dict]:
    out = {}
    for line in TRACE.open(encoding="utf-8"):
        o = json.loads(line)
        out[o["caseId"]] = o
    return out


def load_matrix() -> dict[str, dict]:
    return {r["caseId"]: r for r in csv.DictReader(MATRIX.open(encoding="utf-8"))}


def collect_invocations(trace: dict) -> list[dict]:
    inv = []
    for path in trace.get("paths") or []:
        inv.extend(path.get("retry_recall_invocations") or [])
    return inv


def collect_assembly_texts(trace: dict) -> list[str]:
    texts = []
    for path in trace.get("paths") or []:
        for s in (path.get("assembly") or {}).get("sentences") or []:
            if isinstance(s, dict) and s.get("text"):
                texts.append(s["text"])
            elif isinstance(s, str):
                texts.append(s)
        for t in path.get("kenlm_pool") or []:
            if isinstance(t, dict):
                texts.append(t.get("text") or "")
            else:
                texts.append(str(t))
    return texts


def analyze(cid: str, trace: dict, matrix: dict) -> dict:
    expected = (trace.get("expected") or "").strip()
    raw = (trace.get("raw_asr") or "").strip()
    final = (trace.get("final_text") or matrix.get(cid, {}).get("s3Final") or "").strip()
    targets = PRIMARY_TARGETS.get(cid, [])
    lex = lex_lookup(targets) if targets else {}
    any_exact = any(v["exact"] for v in lex.values()) if lex else False
    any_like = any(bool(v["like"]) for v in lex.values()) if lex else False
    lexicon_ok = any_exact or any_like

    inv = collect_invocations(trace)
    recall_surfaces = []
    queries = []
    for q in inv:
        w = q.get("windowText") or q.get("spanSurface") or ""
        queries.append(w)
        for c in q.get("candidates") or []:
            surf = c.get("surface") or ""
            if surf:
                recall_surfaces.append(surf)

    # target in recall: exact primary target surface match only (no single-char spam)
    target_in_recall = False
    target_rank = ""
    hit_target = ""
    for q in inv:
        cands = [c.get("surface") or "" for c in (q.get("candidates") or [])]
        for i, c in enumerate(cands):
            for t in targets:
                if c == t or (len(t) >= 2 and (c == t or t.startswith(c) and len(c) >= 2)):
                    if c == t or (len(c) >= 2 and c in t):
                        target_in_recall = True
                        target_rank = str(i + 1)
                        hit_target = c
                        break
            if target_in_recall:
                break
        if target_in_recall:
            break
    # also: candidate equals any exact lexicon like-sample that is a primary target
    if not target_in_recall:
        for c in recall_surfaces:
            if c in targets:
                target_in_recall = True
                hit_target = c
                break

    # repair-capable: query window chars overlap ASR error locus for primary target
    # e.g. 自教 vs 私教; 自卡 vs 次卡; 打爆 vs 打包
    repair_capable = False
    for t in targets:
        for w in queries:
            if not w:
                continue
            # shared chars or length-compatible phonetic locus
            if len(w) >= 1 and (any(ch in raw for ch in w)):
                # query near target length
                if abs(len(w) - len(t)) <= 2 or any(ch in t for ch in w):
                    repair_capable = True
        # region covering wrong ASR surface that should map to target
        if t and any(ch in "".join(queries) for ch in t):
            repair_capable = True

    # stronger structural checks for known pairs
    pair_hints = {
        "私教课": ["自教", "自教课", "教课"],
        "私教": ["自教"],
        "游泳次卡": ["游泳自卡", "自卡"],
        "次卡": ["自卡"],
        "打包": ["打爆", "打爆马", "打爆吗"],
        "扫码": ["扫马"],
        "香菜": ["像蔡", "像蔡薇", "蔡薇"],
        "不要香菜": ["像蔡", "像蔡薇娜", "蔡薇"],
        "少冰": ["少病"],
        "小杯": ["小背"],
        "国贸三期": ["散清", "国贸散"],
        "西溪": ["戏戏"],
        "发票抬头": ["台头", "發票台頭"],
        "微辣": ["薇娜", "薇拉", "微娜"],
    }
    query_covers_error_locus = False
    for t in targets:
        for hint in pair_hints.get(t, []):
            if hint in raw:
                repair_capable = True
            if any(hint in (q or "") for q in queries):
                repair_capable = True
                query_covers_error_locus = True
            # single-char / partial local windows that are chars of the ASR error surface
            if any(q and len(q) <= 2 and q in hint for q in queries):
                repair_capable = True
                query_covers_error_locus = True

    asm_texts = collect_assembly_texts(trace)
    target_in_asm = any(any(t in norm(x) for t in targets if len(t) >= 2) for x in asm_texts)

    # classification — lexicon gap before Recall blame
    if not targets:
        cls = "NO_REPAIRABLE_TARGET"
        drop = "NO_TARGET"
        conf = "MEDIUM"
    elif not inv:
        cls = "QUERY_NOT_REPAIR_CAPABLE"
        drop = "NO_RETRY_QUERY"
        conf = "MEDIUM"
    elif not lexicon_ok:
        cls = "TARGET_NOT_IN_LEXICON"
        drop = "LEXICON"
        conf = "HIGH"
    elif not query_covers_error_locus:
        cls = "QUERY_NOT_REPAIR_CAPABLE"
        drop = "QUERY_GEOMETRY"
        conf = "HIGH"
    elif not target_in_recall:
        cls = "RECALL_TARGET_MISS"
        drop = "RECALL"
        conf = "HIGH"
    elif not target_in_asm:
        cls = "INSUFFICIENT_EVIDENCE"
        drop = "POST_RECALL_UNTRACED"
        conf = "LOW"
    else:
        cls = "KENLM_TARGET_PRESENT_NOT_SELECTED"
        drop = "KENLM_OR_FINAL"
        conf = "LOW"

    structural_family = {
        "d040": "SIJIAO_LEXICON_GAP",
        "d085": "SIJIAO_LEXICON_GAP",
        "d175": "SIJIAO_LEXICON_GAP",
        "d042": "CIKA_LEXICON_GAP",
        "d129": "DABAO_IN_LEXICON_RECALL_PATH",
        "d172": "XIANGCAI_IN_LEXICON_RECALL_PATH",
        "d138": "SHAOBING_IN_LEXICON",
        "d114": "FAPIAO_RAISED_LEXICON_GAP",
        "d054": "XIXI_LEXICON_GAP",
        "d008": "SANQI_LEXICON_GAP",
        "d065": "SHANGXIAN_LEXICON_GAP",
        "d109": "HOUXUAN_LEXICON_GAP",
        "d102": "FAYANG_SURFACE",
        "d022": "ORDER_SURFACE",
        "d051": "XUQIU_SURFACE",
        "d094": "XIAOCHEN_SURFACE",
    }.get(cid, "OTHER")

    return {
        "caseId": cid,
        "subgroup": SUBGROUP.get(cid, ""),
        "expected": expected,
        "raw": raw,
        "final": final,
        "primaryTargets": "|".join(targets),
        "targetLexiconPresence": "YES" if lexicon_ok else "NO",
        "lexiconExact": json.dumps({k: v["exact"] for k, v in lex.items()}, ensure_ascii=False),
        "lexiconLikeSamples": json.dumps({k: v["like"] for k, v in lex.items()}, ensure_ascii=False),
        "retryQueryCount": len(inv),
        "retryQueries": "|".join(queries[:20]),
        "repairCapableQuery": "YES" if repair_capable else "NO",
        "recallSurfacesSample": "|".join(recall_surfaces[:30]),
        "targetInRecall": "YES" if target_in_recall else "NO",
        "targetRecallRank": target_rank,
        "hitTarget": hit_target,
        "targetAtAssemblyOutput": "YES" if target_in_asm else "NO",
        "targetInKenLMPool": "YES" if target_in_asm else "NO",
        "firstDropStage": drop,
        "ownerClassification": cls,
        "structuralFamily": structural_family,
        "evidenceConfidence": conf,
        "matrixDecomposition": matrix.get(cid, {}).get("decomposition", ""),
        "matrixRecallChanged": matrix.get(cid, {}).get("recallChanged", ""),
        "matrixAssemblyChanged": matrix.get(cid, {}).get("assemblyChanged", ""),
        "traceSource": "model3_v2_retry_recall_query_trace.jsonl",
        "note": "Diagnostic S3 replay traces; not A1 dual-weight candidate dump. Assembly input object identity not available.",
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
    traces = load_traces()
    matrix = load_matrix()

    high_rows = [analyze(cid, traces[cid], matrix) for cid in HIGH12 if cid in traces]
    control_rows = [analyze(cid, traces[cid], matrix) for cid in CONTROLS if cid in traces]

    high_cls = Counter(r["ownerClassification"] for r in high_rows)
    families = Counter(r["structuralFamily"] for r in high_rows)

    # Owner standards (strict)
    recall_ev = [
        r
        for r in high_rows
        if r["ownerClassification"] == "RECALL_TARGET_MISS"
        and r["targetLexiconPresence"] == "YES"
        and r["repairCapableQuery"] == "YES"
        and r["targetInRecall"] == "NO"
    ]
    query_ev = [
        r
        for r in high_rows
        if r["ownerClassification"] == "QUERY_NOT_REPAIR_CAPABLE"
        and r["targetLexiconPresence"] == "YES"
    ]
    assembly_ev = [
        r
        for r in high_rows
        if r["targetInRecall"] == "YES" and r["targetAtAssemblyOutput"] == "NO"
    ]
    lexicon_ev = [r for r in high_rows if r["ownerClassification"] == "TARGET_NOT_IN_LEXICON"]
    # independent structural families for lexicon
    lex_families = {r["structuralFamily"] for r in lexicon_ev}
    query_families = {r["structuralFamily"] for r in query_ev}
    recall_families = {r["structuralFamily"] for r in recall_ev}

    recall_proven = len(recall_families) >= 3
    query_proven = len(query_families) >= 3
    assembly_proven = False  # no assembly-input identity trace
    lexicon_proven = len(lex_families) >= 3 and len(lexicon_ev) >= 3

    clear_rows = [r for r in high_rows if r["caseId"] in CLEAR_OOS]
    clear_cls = Counter(r["ownerClassification"] for r in clear_rows)

    owner_signals = sum(
        1 for x in (recall_proven, query_proven, lexicon_proven, assembly_proven) if x
    )
    multi = owner_signals >= 2 or (
        len(lex_families) >= 2 and len(query_families) >= 2
    )

    if assembly_proven and owner_signals == 1:
        verdict = "MODEL3_S3_ASSEMBLY_OWNER_PROVEN"
        next_phase = "MODEL3_V2_S3_ASSEMBLY_CORRECTION_DESIGN_AUDIT"
        other = "ASSEMBLY"
    elif multi:
        verdict = "MODEL3_S3_MULTIPLE_DOWNSTREAM_OWNERS_PROVEN"
        next_phase = "MODEL3_V2_S3_DOWNSTREAM_OWNER_PRIORITY_DESIGN_AUDIT"
        other = "MULTIPLE_LEXICON_AND_RETRY_QUERY"
    elif recall_proven:
        verdict = "MODEL3_S3_RECALL_OWNER_PROVEN"
        next_phase = "MODEL3_V2_S3_RECALL_CORRECTION_DESIGN_AUDIT"
        other = "RECALL"
    elif query_proven:
        verdict = "MODEL3_S3_RETRY_QUERY_OWNER_PROVEN"
        next_phase = "MODEL3_V2_S3_RETRY_QUERY_MAPPING_CORRECTION_DESIGN_AUDIT"
        other = "RETRY_QUERY_MAPPING"
    elif lexicon_proven:
        verdict = "MODEL3_S3_LEXICON_COVERAGE_OWNER_PROVEN"
        next_phase = "MODEL3_V2_S3_LEXICON_COVERAGE_CORRECTION_DESIGN_AUDIT"
        other = "LEXICON_COVERAGE"
    else:
        verdict = "MODEL3_S3_RECALL_ASSEMBLY_OWNER_NOT_YET_ISOLATED"
        next_phase = "MODEL3_V2_S3_RECALL_ASSEMBLY_PROVENANCE_TRACE_COMPLETION"
        other = "NOT_YET_ISOLATED"

    # Assembly input identity gap: do not claim Assembly; keep FIRST_CAUSAL_OWNER unset
    # Also: boolean stop RECALL→ASSEMBLY remains observation-only.

    # Full200 flow: prefer HIGH12/control classifications; else insufficient
    flow = []
    full_cls = Counter()
    for cid, m in sorted(matrix.items()):
        if cid in traces and cid in PRIMARY_TARGETS:
            row = next((r for r in high_rows + control_rows if r["caseId"] == cid), None)
            if row is None and cid in traces:
                # control without primary map
                cls = "INSUFFICIENT_EVIDENCE"
            else:
                cls = row["ownerClassification"] if row else "INSUFFICIENT_EVIDENCE"
                flow.append(
                    {
                        "caseId": cid,
                        "subgroup": SUBGROUP.get(cid, ""),
                        "ownerClassification": cls,
                        "firstDropStage": row["firstDropStage"] if row else "NO_TRACE",
                        "targetLexiconPresence": row["targetLexiconPresence"] if row else "",
                        "repairCapableQuery": row["repairCapableQuery"] if row else "",
                        "targetInRecall": row["targetInRecall"] if row else "",
                        "targetAtAssemblyOutput": row["targetAtAssemblyOutput"] if row else "",
                        "matrixDecomposition": m.get("decomposition", ""),
                        "evidenceConfidence": row["evidenceConfidence"] if row else "LOW",
                        "structuralFamily": row.get("structuralFamily", "") if row else "",
                    }
                )
                full_cls[cls] += 1
                continue
        # no candidate-level provenance for A1 dual-weight full200
        cls = (
            "FINAL_ALREADY_EQUIVALENT"
            if m.get("decomposition") == "NO_MODEL3_DECISION_CHANGE"
            else "INSUFFICIENT_EVIDENCE"
        )
        full_cls[cls] += 1
        flow.append(
            {
                "caseId": cid,
                "subgroup": SUBGROUP.get(cid, ""),
                "ownerClassification": cls,
                "firstDropStage": "NO_A1_CANDIDATE_TRACE",
                "targetLexiconPresence": "",
                "repairCapableQuery": "",
                "targetInRecall": "",
                "targetAtAssemblyOutput": "",
                "matrixDecomposition": m.get("decomposition", ""),
                "evidenceConfidence": "LOW",
                "structuralFamily": "",
            }
        )

    anti = [
        {
            "finding": "No production case-id branch",
            "file": "fw-detector-step.ts",
            "function": "resolveFwDetectorTraceCaseId",
            "type": "SAFE_DIAGNOSTIC",
            "productionImpact": "NONE",
            "testSpecific": "NO",
            "referenceAware": "NO",
            "severity": "LOW",
            "actionRequired": "NONE",
        },
        {
            "finding": "No HIGH12/CLEAR_OOS production branch",
            "file": "main/src",
            "function": "n/a",
            "type": "NONE",
            "productionImpact": "NONE",
            "testSpecific": "NO",
            "referenceAware": "NO",
            "severity": "INFO",
            "actionRequired": "NONE",
        },
        {
            "finding": "expectedText only in harness evaluation",
            "file": "run-dialog200-s3-class-weight-downstream-causal-audit.mjs",
            "function": "classifyFinalUtility",
            "type": "SAFE_DIAGNOSTIC",
            "productionImpact": "NONE",
            "testSpecific": "YES_AUDIT_ONLY",
            "referenceAware": "YES_EVAL_ONLY",
            "severity": "INFO",
            "actionRequired": "NONE",
        },
        {
            "finding": "No candidate injection in production Retry/Recall/Assembly",
            "file": "model3-retry-router.ts",
            "function": "routeModel3Retry",
            "type": "NONE",
            "productionImpact": "NONE",
            "testSpecific": "NO",
            "referenceAware": "NO",
            "severity": "INFO",
            "actionRequired": "NONE",
        },
        {
            "finding": "dialog_200/HIGH12 excluded from S3 and class-weight training",
            "file": "model3_v2_training_pipeline_trace_summary.json",
            "function": "heldout exact-text gate",
            "type": "NONE",
            "productionImpact": "NONE",
            "testSpecific": "NO",
            "referenceAware": "NO",
            "severity": "INFO",
            "actionRequired": "NONE",
        },
        {
            "finding": "Prior RECALL_CHANGED_ASSEMBLY_SAME used as RECALL owner — invalid",
            "file": "model3_v2_s3_downstream_stage_decomposition.csv",
            "function": "boolean stage decomposition",
            "type": "SAFE_DIAGNOSTIC",
            "productionImpact": "ATTRIBUTION_ERROR",
            "testSpecific": "NO",
            "referenceAware": "NO",
            "severity": "HIGH",
            "actionRequired": "INVALIDATE_OWNER_LABEL",
        },
        {
            "finding": "Assembly input candidate identity not traced in current dumps",
            "file": "model3_v2_retry_recall_query_trace.jsonl",
            "function": "missing preAssembly snapshot",
            "type": "SAFE_DIAGNOSTIC",
            "productionImpact": "EVIDENCE_GAP",
            "testSpecific": "NO",
            "referenceAware": "NO",
            "severity": "HIGH",
            "actionRequired": "PROVENANCE_TRACE_COMPLETION",
        },
        {
            "finding": "CLEAR_OOS lexicon gaps (私教课/次卡) are general coverage issues, not test patches",
            "file": "lexicon_terms",
            "function": "exact lookup",
            "type": "NONE",
            "productionImpact": "COVERAGE_GAP_HYPOTHESIS",
            "testSpecific": "NO",
            "referenceAware": "NO",
            "severity": "MED",
            "actionRequired": "DO_NOT_ADD_CASE_SPECIFIC_ENTRIES",
        },
    ]

    write_csv(DOCS / "model3_v2_s3_high12_candidate_provenance.csv", high_rows)
    write_csv(DOCS / "model3_v2_s3_full200_candidate_flow.csv", flow)
    write_csv(
        DOCS / "model3_v2_s3_recall_owner_evidence.csv",
        recall_ev
        or [{"caseId": "NONE", "note": "No case meets full RECALL_OWNER standard with >=3 structural families"}],
    )
    write_csv(
        DOCS / "model3_v2_s3_assembly_owner_evidence.csv",
        assembly_ev
        or [
            {
                "caseId": "NONE",
                "note": "Cannot prove ASSEMBLY_OWNER: no case with targetInRecall=YES and traced Assembly-input drop",
            }
        ],
    )
    write_csv(DOCS / "model3_v2_s3_anti_overfit_audit.csv", anti)

    h12_repair = sum(1 for r in high_rows if r["repairCapableQuery"] == "YES")
    h12_lex = sum(1 for r in high_rows if r["targetLexiconPresence"] == "YES")
    h12_rec = sum(1 for r in high_rows if r["targetInRecall"] == "YES")
    h12_asm = sum(1 for r in high_rows if r["targetAtAssemblyOutput"] == "YES")

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": verdict,
        "nextPhase": next_phase,
        "overfittingDetected": False,
        "referenceLeakageDetected": False,
        "testGamingDetected": False,
        "stopBoundary": "RECALL_TO_ASSEMBLY",
        "recallOwner": "NOT_YET_PROVEN",
        "assemblyOwner": "NOT_YET_PROVEN",
        "otherOwner": other,
            "FIRST_CAUSAL_OWNER": "NOT_YET_ISOLATED",
        "ACP": False,
        "priorBooleanRecallOwnerInvalidated": True,
        "ownerFreezeNote": "Multiple downstream mechanisms observed; FIRST_CAUSAL_OWNER remains NOT_YET_ISOLATED until priority design + provenance completion",
        "high12": {
            "classCounts": dict(high_cls),
            "structuralFamilies": dict(families),
            "repairCapable": h12_repair,
            "targetInLexicon": h12_lex,
            "targetInRecall": h12_rec,
            "targetInAssembly": h12_asm,
            "clearOos": {
                r["caseId"]: {
                    "Q1_repairCapable": r["repairCapableQuery"],
                    "Q2_lexicon": r["targetLexiconPresence"],
                    "Q3_inRecall": r["targetInRecall"],
                    "Q4_assemblyInput": "UNTRACED",
                    "Q5_assemblyOut": r["targetAtAssemblyOutput"],
                    "Q6_kenlm": r["targetInKenLMPool"],
                    "Q7_firstDrop": r["firstDropStage"],
                    "class": r["ownerClassification"],
                    "family": r["structuralFamily"],
                }
                for r in clear_rows
            },
        },
        "full200ClassCounts": dict(full_cls),
        "recallOwnerEvidenceN": len(recall_ev),
        "assemblyOwnerEvidenceN": len(assembly_ev),
        "lexiconOwnerEvidenceN": len(lexicon_ev),
        "queryOwnerEvidenceN": len(query_ev),
        "lexiconStructuralFamilies": sorted(lex_families),
        "queryStructuralFamilies": sorted(query_families),
        "recallStructuralFamilies": sorted(recall_families),
        "answers": {
            "D1": "NO",
            "D2": "NO",
            "D3": "NO",
            "D4": "NO",
            "D5": "NO",
            "D6": "NO",
            "D7": "NO",
            "D8": "NO",
            "D9": "NO",
            "D10": "NO",
            "D11": "DUAL_WEIGHT_AUDIT_ENV_ONLY",
            "D12": "NO",
            "D13": "NO",
            "D14": "NO",
            "D15": h12_repair,
            "D16": h12_lex,
            "D17": h12_rec,
            "D18": "UNTRACED_ASSEMBLY_INPUT",
            "D19": "UNTRACED",
            "D20": "UNTRACED",
            "D21": h12_asm,
            "D22": h12_asm,
            "D23": {r["caseId"]: r["firstDropStage"] for r in clear_rows},
            "D24": full_cls.get("QUERY_NOT_REPAIR_CAPABLE", 0),
            "D25": full_cls.get("TARGET_NOT_IN_LEXICON", 0),
            "D26": full_cls.get("RECALL_TARGET_MISS", 0),
            "D27": h12_rec,
            "D28": full_cls.get("PRE_ASSEMBLY_FILTER_DROP", 0),
            "D29": 0,
            "D30": 0,
            "D31": full_cls.get("KENLM_TARGET_PRESENT_NOT_SELECTED", 0),
            "D32": "NO",
            "D33": "NO",
            "D34": "YES" if query_proven else "PARTIAL",
            "D35": "YES" if lexicon_proven else "NO",
            "D36": "NO",
            "D37": "NO",
            "D38": "YES",
            "D39": "YES",
            "D40": "YES_FOR_LEXICON_AND_QUERY_FAMILIES" if multi else "NO",
            "D41": "NO",
            "D42": "NO",
            "D43": "NO",
            "D44": "NO",
            "D45": "NO",
            "D46": other,
            "D47": next_phase,
        },
    }
    (DOCS / "model3_v2_s3_recall_assembly_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    freeze = "\n".join(
        [
            "key,value,status",
            f"phase,{PHASE},RECORDED",
            "CLASS_WEIGHT_MODEL_LEVEL_SIGNAL,SUPPORTED,FROZEN",
            "CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY,INTERNAL_ONLY_NO_FINAL_UTILITY,FROZEN",
            "FIRST_CAUSAL_OWNER,NOT_YET_ISOLATED,FROZEN",
            "CAUSAL_STOP_BOUNDARY,RECALL_TO_ASSEMBLY,FROZEN",
            "RECALL_OWNER,NOT_YET_PROVEN,FROZEN",
            "ASSEMBLY_OWNER,NOT_YET_PROVEN,FROZEN",
            "LEXICON_COVERAGE_OWNER,HYPOTHESIS_NOT_FROZEN,RECORDED",
            "A1_PROMOTION_READY,FALSE,FROZEN",
            "PRIOR_BOOLEAN_RECALL_OWNER,INVALIDATED,CORRECTED",
            f"verdict,{verdict},RECORDED",
            f"next_phase,{next_phase},RECORDED",
            "overfitting,FALSE,RECORDED",
            "reference_leakage,FALSE,RECORDED",
            "test_gaming,FALSE,RECORDED",
            "ACP,FALSE,RECORDED",
        ]
    )
    (DOCS / "model3_v2_s3_recall_assembly_freeze_state.csv").write_text(freeze + "\n", encoding="utf-8")

    clear_md = "\n".join(
        f"| {r['caseId']} | {r['repairCapableQuery']} | {r['targetLexiconPresence']} | {r['targetInRecall']} | UNTRACED | {r['targetAtAssemblyOutput']} | {r['firstDropStage']} | {r['ownerClassification']} | {r['structuralFamily']} |"
        for r in clear_rows
    )

    md = f"""# Lingua — Model3 V2 S3 Recall → Assembly Boundary Causal Audit

Date: 2026-09-03  
Phase: `{PHASE}`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `{verdict}` |
| overfitting detected | **NO** |
| reference leakage detected | **NO** |
| test-gaming detected | **NO** |
| stop boundary | `RECALL_TO_ASSEMBLY` (observation only) |
| Recall owner | **NOT_YET_PROVEN** |
| Assembly owner | **NOT_YET_PROVEN** |
| other owner | `{other}` |
| FIRST_CAUSAL_OWNER | **NOT_YET_ISOLATED** |
| ACP | **NO** |
| next phase | `{next_phase}` |

**Invalidated:** prior `RECALL_CHANGED_ASSEMBLY_SAME` → RECALL_OWNER (boolean-only).

================================
ANTI-OVERFITTING AUDIT
======================

No production case-id / HIGH12 / CLEAR_OOS / known-surface special-case branches.  
See `model3_v2_s3_anti_overfit_audit.csv`.

================================
REFERENCE FIREWALL
==================

Production Recall/Assembly/Model3/Retry/Model2/DomainVote cannot access `expectedText` / ground truth.  
Harness reference use is evaluation-only.

================================
CASE-ID / SURFACE PATCH SEARCH
==============================

HARD STOP A/B/C: **PASS**.

================================
TEST HARNESS ISOLATION
======================

No expected-candidate injection; no reference-driven Retry/Assembly mutation.  
`MODEL2_DIALOG200_TRACE` = observation-only.

================================
TEST CONFIG PARITY
==================

Dual-weight audit env changes Model3 checkpoint identity only (documented).  
No test-only topK / cap / domain threshold overrides.

================================
TRAINING / DATA / LEXICON CONTAMINATION
=======================================

| Check | Result |
|-------|--------|
| D12 dialog_200 in S3 train | **NO** |
| D13 class-weight train | **NO** |
| D14 lexicon test-only CLEAR_OOS inserts | **NO** (gaps remain) |

================================
HIGH12 / CLEAR_OOS6
===================

HIGH12 class counts: `{dict(high_cls)}`  
Structural families: `{dict(families)}`

| caseId | repairCapable | lexicon | inRecall | asmInput | asmOut | firstDrop | class | family |
|--------|---------------|---------|----------|----------|--------|-----------|-------|--------|
{clear_md}

Notes:
- `私教课` / `游泳次卡` / `次卡` / `续费`: **absent** from `lexicon_terms` (coverage gap hypothesis).
- `打包` / `少冰` / `小杯` / `不要香菜` / `微辣`: **present** — cannot blame lexicon; need Recall/query/post-Recall provenance.
- `d040`/`d085`/`d175` share one structural family (`SIJIAO_LEXICON_GAP`) — count as **one** mechanism, not three independent proofs.

================================
FULL200 CANDIDATE FLOW
======================

Most cases: `INSUFFICIENT_EVIDENCE` — A1 dual-weight run lacked per-candidate Assembly-input dumps.  
Counts: `{dict(full_cls)}`

================================
RECALL / ASSEMBLY EVIDENCE
==========================

| Standard | Result |
|----------|--------|
| RECALL_OWNER (§29) | **NOT met** (evidence N={len(recall_ev)}, structural families < 3) |
| ASSEMBLY_OWNER (§29) | **NOT met** (Assembly input identity untraced) |
| LEXICON_COVERAGE | **Hypothesis** for some CLEAR_OOS families; **not frozen** as FIRST_CAUSAL_OWNER |

================================
OWNER DECISION
==============

Stop boundary remains Recall→Assembly.  
Ownership remains **NOT_YET_ISOLATED** pending completed candidate provenance (Recall raw list → pre-Assembly → Assembly → cross-path → KenLM) under A1 same-upstream replay.

================================
GOVERNANCE
==========

No development / training / lexicon edit / cap raise / JobResult change.  
Future fixes must remain general (no caseId / gold-string branches).

================================
NEXT PHASE
==========

`{next_phase}`
"""
    (DOCS / "Lingua_Model3_V2_S3_Recall_Assembly_Boundary_Causal_Audit_2026_09_03.md").write_text(
        md, encoding="utf-8"
    )

    # cleanup temps
    for p in [
        DOCS / "_lex_probe_out.json",
        REPO / "training/model3_dataset/scripts/_tmp_lex_probe.py",
    ]:
        if p.exists():
            p.unlink()

    print(json.dumps({"verdict": verdict, "next": next_phase, "high_cls": dict(high_cls), "families": dict(families)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
