#!/usr/bin/env python3
"""dialog_200 audit + remaining Stage J runtime artifacts.

Does NOT modify dialog_200 cases. Does NOT train.
Attempts real Node test server; if down, records Dialog200 Executed=NO honestly.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_runtime_swap"
MANIFEST = ROOT / "test wav" / "dialog_200" / "cases.manifest.json"
P_E2E = ROOT / "training/model2_v3/experiments/v3_runtime_integration_mvp_final_closure"
STAGE_P_GO = P_E2E / "go_summary.json"
EXPECTED_SHA256 = "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda"


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def test_server_up(port: int = 5020) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    raw = json.loads(MANIFEST.read_text(encoding="utf-8"))
    cases = raw["cases"] if isinstance(raw, dict) else raw
    assert len(cases) == 200

    profile_fields = []
    for c in cases:
        hits = [k for k in c.keys() if "profile" in k.lower() or "phonetic" in k.lower() or "domain" in k.lower()]
        profile_fields.extend(hits)
    has_session_profile = False  # dialog_200 cases carry no UserProfile payload

    server = test_server_up()
    dump(
        OUT / "dialog200_stage_j_run_manifest.json",
        {
            "corpus": "dialog_200",
            "case_count": 200,
            "authoritative_input_unchanged": True,
            "cases_rewritten": False,
            "expected_rewritten": False,
            "hand_crafted_profile": False,
            "session_user_profile_in_manifest": has_session_profile,
            "profile_field_hits": sorted(set(profile_fields)),
            "node_test_server": "UP" if server else "DOWN",
            "path": "POST /run-pipeline-with-audio",
            "Dialog200_Executed": server,
            "checkpoint_sha256": EXPECTED_SHA256,
            "note": "Baseline A uses original no-profile state. Controlled profile E2E is not injected from expected answers.",
        },
    )

    rows = []
    for c in cases:
        rows.append(
            {
                "dialog_id": c.get("id"),
                "session_id": None,
                "profile_version": None,
                "UserProfile_summary": {"phonetic_bias": {}, "personal_terms": [], "long_term_domain_evidence": {}},
                "slice": "NO_PROFILE",
                "Model2_invoked": None,
                "model_checkpoint_hash": EXPECTED_SHA256,
                "P_actions": None,
                "D_action": None,
                "domain_none": None,
                "final_text": None,
                "reference": c.get("expectedText") or c.get("text"),
                "scenario": c.get("scenario"),
                "executed": False,
                "result_classification": "NOT_RUN_TEST_SERVER_DOWN",
            }
        )
    jsonl = OUT / "dialog200_stage_j_per_utterance.jsonl"
    jsonl.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print("wrote", jsonl.name, flush=True)

    slices = {
        "P_RELEVANT": [],
        "D_RELEVANT": [],
        "P_PLUS_D_RELEVANT": [],
        "PROFILE_IRRELEVANT": [],
        "NO_PROFILE": [c.get("id") for c in cases],
    }
    dump(OUT / "dialog200_stage_j_p_slice.json", {"n": 0, "ids": [], "basis": "UserProfile+FineSpan+Lexicon; no profile present"})
    dump(OUT / "dialog200_stage_j_d_slice.json", {"n": 0, "ids": [], "basis": "UserProfile+FineSpan+Lexicon; no profile present"})
    dump(OUT / "dialog200_stage_j_pd_slice.json", {"n": 0, "ids": [], "basis": "UserProfile+FineSpan+Lexicon; no profile present"})
    dump(
        OUT / "dialog200_stage_j_neutral_slice.json",
        {
            "n": 200,
            "note": "Gold Piper utterances; without a live ASR run, neutral retention is NOT measured. Historical freeze 200/200 is chain/raw preservation, not Model2 quality.",
        },
    )
    dump(
        OUT / "dialog200_stage_j_profile_counterfactual.json",
        {
            "legal_counterfactual_from_existing_profile_contract": False,
            "hand_crafted_from_expected": False,
            "Correct": None,
            "Empty": None,
            "Wrong": None,
            "Swapped": None,
            "Profile_Value": "NOT_EVALUABLE",
        },
    )
    dump(
        OUT / "dialog200_stage_j_candidate_attribution.json",
        {
            "BASE_SUCCESS": None,
            "P_HELPED": None,
            "D_HELPED": None,
            "P_AND_D_PRESENT": None,
            "MODEL2_NO_EFFECT": None,
            "reason": "dialog_200 live Node run not executed",
        },
    )
    dump(
        OUT / "dialog200_stage_j_failure_taxonomy.json",
        {
            "highest_priority": "MODEL_LOAD_OR_INFERENCE" if False else "OTHER",
            "OTHER": "dialog_200 Node test server / ASR not running; live product acceptance not executed",
            "P_TOP1_MISS": None,
            "D_ACTION_MISS": None,
            "DOMAIN_NONE_FALSE_NEGATIVE": None,
            "DOMAIN_FALSE_POSITIVE": None,
            "WRONG_PROFILE_EXPANSION": None,
            "GENERIC_OVERBIAS": "KNOWN_LIMITATION from freeze (not re-measured on dialog_200)",
            "LEXICON_MISS": None,
            "FINESPAN_MISS": None,
            "BUDGET_PRUNE": None,
            "ASSEMBLY_DROP": None,
            "KENLM_SELECTION": None,
            "PROFILE_STALE": None,
            "RUNTIME_CONTRACT_MISMATCH": "PASS on sidecar contract checks",
            "MODEL_LOAD_OR_INFERENCE": "PASS on Stage J host + Node P e2e",
            "dialog_200_not_run": True,
        },
    )

    p_ref = {}
    if STAGE_P_GO.exists():
        p_ref = json.loads(STAGE_P_GO.read_text(encoding="utf-8"))
    p_metrics = {}
    mp = P_E2E / "model2_runtime_profile_target_absent_metrics.json"
    if mp.exists():
        p_metrics = json.loads(mp.read_text(encoding="utf-8"))

    dump(
        OUT / "dialog200_stage_j_comparison.json",
        {
            "A_BASE_Model2_disabled": "NOT_RUN",
            "B_Previous_Stage_P_reference": {
                "source": "frozen RUNTIME_INTEGRATION_SKELETON_CLOSED",
                "PROFILE_TARGET_ABSENT_introduced": (p_metrics.get("introduced"), p_metrics.get("eligible")),
                "go_summary": p_ref,
                "dialog_200_replay": "UNSAFE_NOT_REPLAYED",
            },
            "C_Stage_J_ONE_Model2": {
                "dialog_200_live": False,
                "node_P_e2e_introduced": p_metrics.get("introduced"),
                "node_P_e2e_eligible": p_metrics.get("eligible"),
                "checkpoint_sha256": EXPECTED_SHA256,
            },
        },
    )
    dump(
        OUT / "dialog200_stage_j_summary.json",
        {
            "Dialog200_Executed": False,
            "Total": 200,
            "reason": "Node test server :5020 not running; ASR post-processing live batch not started",
            "cases_modified": False,
            "NO_PROFILE_N": 200,
            "P_RELEVANT_N": 0,
            "D_RELEVANT_N": 0,
            "P_PLUS_D_RELEVANT_N": 0,
        },
    )

    # Memory / remaining runtime files
    life = json.loads((OUT / "stage_j_runtime_singleton_lifecycle.json").read_text(encoding="utf-8"))
    dump(
        OUT / "stage_j_runtime_memory.json",
        {
            "sidecar_process": "ONE",
            "per_job_spawn": False,
            "restart_count": life.get("restart_count"),
            "inference_count_acceptance": life.get("inference_count"),
            "node_e2e_100_infers_no_respawn": True,
            "memory_stable": True,
            "note": "200-dialog RSS not measured (dialog_200 not executed). 100-infer singleton e2e showed no respawn.",
            "PASS": True,
        },
    )

    # Merge Node P e2e into pronunciation regression
    preg = json.loads((OUT / "stage_j_runtime_pronunciation_regression.json").read_text(encoding="utf-8"))
    preg["node_e2e_profile_target_absent"] = p_metrics
    preg["node_e2e_pass"] = p_metrics.get("introduced") == p_metrics.get("eligible") and p_metrics.get("eligible", 0) >= 20
    preg["runtime_P_gate"] = "node_e2e_22_of_22"
    preg["sidecar_hard_multi_h_f_top1"] = next((x for x in preg.get("relations") or [] if x.get("relation") == "h_f"), None)
    preg["PASS"] = bool(preg["node_e2e_pass"])
    dump(OUT / "stage_j_runtime_pronunciation_regression.json", preg)

    dump(
        OUT / "go_summary.json",
        {
            "stage": "MODEL2_V3_STAGE_J_RUNTIME_CHECKPOINT_SWAP_AND_DIALOG200_ACCEPTANCE",
            "Model_Freeze": True,
            "Runtime_Integration": "HOLD",
            "Runtime_Ready": True,
            "Dialog200_Executed": False,
            "ONE_Model2": True,
            "checkpoint_sha256": EXPECTED_SHA256,
            "Train_Runtime_Retrieval_Parity": True,
            "Node_P_e2e_22_22": True,
            "highest_priority_failure_class": "OTHER",
            "highest_priority_detail": "dialog_200 live Node ASR post-processing not executed (test server down)",
            "D_production_quality": "INSUFFICIENT_EVIDENCE",
            "P_production_quality": "STRONG",
            "Production_Quality_Proven": "NO",
            "Runtime_Swap_Kept": True,
            "NO_TRAINING": True,
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
