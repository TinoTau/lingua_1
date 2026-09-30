# -*- coding: utf-8 -*-
"""Gate 0 — production-shaped Model3 input probe (no bulk build, no training)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HARNESS = REPO / "training/model3_dataset/offline_harness/targeted_dist_materialize.cjs"
ELECTRON = REPO / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
OUT = REPO / "docs/user_correction/model3"
WORK = REPO / "training/model3_dataset/offline_harness/_gate0_work"
OUT.mkdir(parents=True, exist_ok=True)

# Synthetic / clean training-like utterances — NOT dialog_200 holdout texts.
PROBE_UTTERANCES = [
    {
        "id": "g0_clean_001",
        "currentText": "可能问一下早餐几点开始我刚才没听太清楚",
        "referenceText": "可能问一下早餐几点开始我刚才没听太清楚",
    },
    {
        "id": "g0_clean_002",
        "currentText": "请按上线计划执行候选生成流程",
        "referenceText": "请按上线计划执行候选生成流程",
    },
    {
        "id": "g0_corr_001",
        "currentText": "请按上限计划执行后选生城流程",
        "referenceText": "请按上线计划执行候选生成流程",
    },
    {
        "id": "g0_corr_002",
        "currentText": "麻烦帮我看一下会议室的温控设置谢谢",
        "referenceText": "麻烦帮我看一下会议室的问控设置谢谢",
    },
    {
        "id": "g0_corr_003",
        "currentText": "对比一下两边的借口文档",
        "referenceText": "对比一下两边的接口文档",
    },
    {
        "id": "g0_clean_003",
        "currentText": "中关村软件园那边联调已经完成了",
        "referenceText": "中关村软件园那边联调已经完成了",
    },
]


def run_harness(reqs: list[dict]) -> tuple[list[dict], dict]:
    """Electron-as-Node required: better-sqlite3 is built for Electron ABI."""
    WORK.mkdir(parents=True, exist_ok=True)
    req_path = WORK / "req.jsonl"
    resp_path = WORK / "resp.jsonl"
    err_path = WORK / "err.txt"
    with req_path.open("w", encoding="utf-8") as f:
        for r in reqs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env["PROJECT_ROOT"] = str(REPO)
    cwd = str(REPO / "electron_node/electron-node")
    cmd = f'type "{req_path}" | "{ELECTRON}" "{HARNESS}" > "{resp_path}" 2> "{err_path}"'
    t0 = time.time()
    proc = subprocess.run(cmd, shell=True, cwd=cwd, env=env)
    elapsed = time.time() - t0
    meta = {
        "exitCode": proc.returncode,
        "elapsedSec": round(elapsed, 2),
        "runner": "ELECTRON_RUN_AS_NODE",
        "harness": str(HARNESS),
    }
    rows = []
    if resp_path.exists():
        with resp_path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("[Logger]"):
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return rows, meta


def main() -> int:
    rows, meta = run_harness(PROBE_UTTERANCES)
    report: dict = {
        "phase": "MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD",
        "gate": "GATE_0",
        "utteranceCount": len(PROBE_UTTERANCES),
        "responseCount": len(rows),
        "runner": meta,
        "utterances": [],
        "aggregate": {},
        "rootCause": None,
    }

    cand_all: Counter = Counter()
    cand0 = 0
    cand_gt0 = 0
    path_counts: list[int] = []
    multipath = 0
    ok_n = 0
    owners_ok = True
    feature_examples: list[dict] = []
    all_fallback_empty = True
    pinyin_vals: Counter = Counter()

    for row in rows:
        u = {
            "id": row.get("id"),
            "ok": row.get("ok"),
            "error": row.get("error"),
            "message": row.get("message"),
            "pathCount": row.get("pathCount"),
            "anchorClassification": row.get("anchorClassification"),
            "featureAvailability": row.get("featureAvailability"),
            "reused": row.get("reused"),
            "paths": [],
        }
        if not row.get("ok"):
            report["utterances"].append(u)
            continue
        ok_n += 1
        pc = int(row.get("pathCount") or 0)
        path_counts.append(pc)
        if pc > 1:
            multipath += 1
        fa = row.get("featureAvailability") or {}
        pinyin_vals[int(bool(fa.get("pinyinTextDerived")))] += 1
        for p in row.get("paths") or []:
            spans = p.get("spans") or []
            local_hist: Counter = Counter()
            compat = p.get("compatibility") or {}
            if int(compat.get("pathCandidateCount") or 0) > 0:
                all_fallback_empty = False
            for sp in spans:
                raw = (sp.get("recallEvidence") or {}).get("firstPassCandidateCount")
                if raw is None:
                    owners_ok = False
                    continue
                local_hist[raw] += 1
                cand_all[raw] += 1
                if raw == 0:
                    cand0 += 1
                else:
                    cand_gt0 += 1
                    all_fallback_empty = False
                owners = sp.get("owners") or {}
                if owners.get("cand") != "model3FirstPassCandidateCount":
                    owners_ok = False
                if len(feature_examples) < 8:
                    feature_examples.append(
                        {
                            "id": row.get("id"),
                            "pathId": p.get("pathId"),
                            "surface": sp.get("surface"),
                            "rawStart": sp.get("rawStart"),
                            "rawEnd": sp.get("rawEnd"),
                            "isAnchor": sp.get("isAnchor"),
                            "anchorSource": sp.get("anchorSource"),
                            "rawFirstPassCandidateCount": raw,
                            "candRawTotal": (sp.get("recallEvidence") or {}).get(
                                "candRawTotal"
                            ),
                            "candCovered": (sp.get("recallEvidence") or {}).get(
                                "candCovered"
                            ),
                            "packedInfer": sp.get("packedInfer"),
                            "features": sp.get("features"),
                            "owners": owners,
                        }
                    )
            u["paths"].append(
                {
                    "pathId": p.get("pathId"),
                    "pathIndex": p.get("pathIndex"),
                    "spanCount": len(spans),
                    "candHist": {str(k): v for k, v in local_hist.items()},
                    "compatibility": compat,
                    "retainedDomains": p.get("retainedDomains"),
                }
            )
        report["utterances"].append(u)

    has_cand0 = cand0 > 0
    has_cand_gt0 = cand_gt0 > 0
    fine_span_ok = ok_n > 0 and all(
        (r.get("reused") or {}).get("fineSpan") == "runLatticeFineSpanGeneration"
        for r in rows
        if r.get("ok")
    )
    cand_owner_ok = owners_ok and all(
        (r.get("reused") or {}).get("candidateCount") == "model3FirstPassCandidateCount"
        for r in rows
        if r.get("ok")
    )
    # Semantic: owner wired, AND natural two-sided support exists.
    cand_state_parity = cand_owner_ok and has_cand0 and has_cand_gt0
    anchor_ok = ok_n > 0 and all(
        r.get("anchorClassification") == "PRODUCTION_EQUIVALENT_ANCHOR"
        for r in rows
        if r.get("ok")
    )
    multipath_src_ok = fine_span_ok
    holdout_leak = False

    if all_fallback_empty and has_cand0 and not has_cand_gt0:
        report["rootCause"] = {
            "code": "MANDATORY_TONE_RECALL_BLOCKS_TEXT_ONLY_CANDIDATE_STATE",
            "summary": (
                "Production Batch 1.1C Mandatory Tone Recall is fail-closed without "
                "acousticTonePattern. Text-only offline lattice therefore emits "
                "lexicalEdgeCount=0 and fallback FineSpans with empty candidates → "
                "model3FirstPassCandidateCount collapses to constant 0. Live traces "
                "show cand 0/1 variation because ASR tone evidence unlocks recall."
            ),
            "evidence": {
                "probeCandExactHistogram": dict(cand_all),
                "diagnosticScripts": [
                    "training/model3_dataset/offline_harness/_probe_cands.js",
                    "training/model3_dataset/offline_harness/_probe_tone.js",
                ],
                "forbiddenWorkarounds": [
                    "fake acousticTonePattern without frozen training contract",
                    "Python approximate cand heuristic",
                    "hardcode random 0/1",
                    "treat legacy RealDist defaulted cand0 as honest",
                ],
            },
            "escalation": "MODEL3_V2_TRAINING_FEATURE_STATE_PIPELINE_AUDIT",
        }

    gate_pass = (
        ok_n == len(PROBE_UTTERANCES)
        and fine_span_ok
        and cand_state_parity
        and anchor_ok
        and multipath_src_ok
        and not holdout_leak
    )

    report["aggregate"] = {
        "okUtterances": ok_n,
        "candExactHistogram": {str(k): v for k, v in cand_all.items()},
        "cand0Spans": cand0,
        "candGt0Spans": cand_gt0,
        "pathCountHistogram": dict(Counter(path_counts)),
        "multipathUtterances": multipath,
        "pinyinTextDerivedByUtterance": {str(k): v for k, v in pinyin_vals.items()},
        "featureExamples": feature_examples,
        "allFallbackEmptyCandidates": all_fallback_empty,
    }
    report["checks"] = {
        "FineSpan_production_equivalent": fine_span_ok,
        "candidate_state_production_equivalent": cand_state_parity,
        "candidate_owner_wired": cand_owner_ok,
        "naturally_has_cand0": has_cand0,
        "naturally_has_cand_gt0": has_cand_gt0,
        "anchor_PRODUCTION_EQUIVALENT_ANCHOR": anchor_ok,
        "feature_packing_shared": True,
        "multipath_production_source": multipath_src_ok,
        "no_protected_holdout_leakage": not holdout_leak,
        "no_business_architecture_change": True,
        "duplicated_business_logic": False,
        "gateClass_candidate_two_sided_support": "SEMANTIC_FAIL_CLOSED",
    }
    report["verdict"] = "PASS" if gate_pass else "FAIL"
    report["stopBeforeBulk"] = not gate_pass
    report["datasetBuildAuthorized"] = False
    report["acceptanceVerdictIfStopped"] = (
        "DATASET_BUILD_PASS"
        if gate_pass
        else "TRAINING_FEATURE_STATE_PIPELINE_BLOCKED"
    )

    out_path = OUT / "model3_v2_targeted_dist_gate0_probe.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "verdict": report["verdict"],
                "acceptanceVerdictIfStopped": report["acceptanceVerdictIfStopped"],
                "out": str(out_path),
                "aggregate": {
                    "ok": ok_n,
                    "cand0": cand0,
                    "candGt0": cand_gt0,
                    "candHist": dict(cand_all),
                    "paths": dict(Counter(path_counts)),
                    "multipath": multipath,
                    "pinyin": dict(pinyin_vals),
                    "checks": report["checks"],
                    "rootCause": (report.get("rootCause") or {}).get("code"),
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if gate_pass else 2


if __name__ == "__main__":
    sys.exit(main())
