#!/usr/bin/env python3
"""Post-rollback Model2 identity + P/D eval + sidecar command check. NO TRAINING."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT))

from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.scripts.run_v3_stage_d_stage_j_restored_retrain import (
    eval_d_tir,
    eval_p_slice,
    load_ckpt,
    load_jsonl,
    row_state,
)
from training.model2_v3.scripts.run_v3_stage_j_restored_joint_p_preservation import d_suite

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_live_dialog200/model2_single_char_clean_rollback_2026_08_20"
CKPT = ROOT / "training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt"
EXPECTED = "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda"
HOST = ROOT / "electron_node/services/model2_runtime/model2_inference_host.py"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2/rows.jsonl"
DATA_D = ROOT / "training/model2_v3/dataset/policy_stage_d_restored_v1/rows.jsonl"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
FROZEN_P = ROOT / "training/model2_v3/experiments/v3_stage_j_p_preservation/stage_j_p_hard.json"
FROZEN_D = ROOT / "training/model2_v3/experiments/v3_stage_j_p_preservation/stage_j_d_validation.json"


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    digest = sha256_file(CKPT)
    model = RetrievalPolicyV3(with_domain_head=True)
    n = model.param_count()
    ckpt = torch.load(CKPT, map_location="cpu", weights_only=False)
    missing, unexpected = model.load_state_dict(ckpt["state_dict"], strict=True)
    x = pack_batch_inputs([["shi"]], [{}], [{"base_pool": 0, "query_budget": 8, "cand_budget": 8}], feature_hash="v1")
    with torch.no_grad():
        out = model(*x)
    keys = sorted(out.keys())
    identity = {
        "sha256": digest,
        "sha256_match": digest == EXPECTED,
        "params": n,
        "params_ok": n == 47210,
        "strict_missing": list(missing) if missing else [],
        "strict_unexpected": list(unexpected) if unexpected else [],
        "strict_ok": not missing and not unexpected,
        "forward_keys": keys,
        "forward_ok": keys == ["action_logits", "cand_budget_logits", "domain_action_logits", "query_budget_logits"]
        or keys == ["action_logits", "query_budget_logits", "cand_budget_logits", "domain_action_logits"],
        "has_ambiguity": any("ambigu" in k for k in keys),
        "constructor_flags": [k for k in RetrievalPolicyV3.__init__.__code__.co_varnames if "ambigu" in k],
    }
    identity["forward_ok"] = set(keys) == {
        "action_logits",
        "query_budget_logits",
        "cand_budget_logits",
        "domain_action_logits",
    } and not identity["has_ambiguity"]
    dump(OUT / "post_rollback_model2_identity.json", identity)
    dump(
        OUT / "post_rollback_checkpoint_identity.json",
        {"path": str(CKPT).replace("\\", "/"), "sha256": digest, "match": digest == EXPECTED, "params": n},
    )
    dump(
        OUT / "post_rollback_forward_contract.json",
        {"keys": keys, "pass": identity["forward_ok"]},
    )
    if not (identity["sha256_match"] and identity["params_ok"] and identity["strict_ok"] and identity["forward_ok"]):
        print("IDENTITY_FAIL", identity, flush=True)
        return 2

    # sidecar cmds
    proc = subprocess.Popen(
        [sys.executable, str(HOST)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(ROOT),
    )
    cmds = [
        {"cmd": "ping"},
        {"cmd": "load", "checkpoint": str(CKPT)},
        {"cmd": "stats"},
        {"cmd": "disambiguate", "candidates": [{"term_id": "x"}]},
        {"cmd": "shutdown"},
    ]
    assert proc.stdin and proc.stdout
    replies = []
    for c in cmds:
        proc.stdin.write(json.dumps(c) + "\n")
        proc.stdin.flush()
        line = proc.stdout.readline()
        replies.append(json.loads(line) if line.strip() else {"ok": False, "error": "empty"})
    proc.wait(timeout=30)
    ping, load, stats, dis, shut = replies
    host_check = {
        "ping_ok": ping.get("ok") is True or ping.get("loaded") is not None,
        "load_ok": bool(load.get("ok")),
        "load_params": load.get("params"),
        "stats_ok": stats.get("ok") is True,
        "disambiguate": dis,
        "disambiguate_is_unknown": (dis.get("ok") is False and "unknown_cmd" in str(dis.get("error") or "")),
        "disambiguate_not_abstain": dis.get("decision") != "ABSTAIN",
        "shutdown_ok": bool(shut.get("ok")),
        "ambiguity_keys_in_load": [k for k in (load.get("contract") or {}) if "ambigu" in k.lower()],
    }
    dump(OUT / "post_rollback_host_command_check.json", host_check)
    if not host_check["disambiguate_is_unknown"]:
        print("DISAMBIGUATE_STILL_PRESENT", dis, flush=True)
        return 3

    print("eval P/D slices", flush=True)
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    device = torch.device("cpu")
    p_phase2 = load_jsonl(DATA_P)
    hard_p = [r for r in p_phase2 if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")][:699]
    p_m = eval_p_slice(index, hard_p, model, device=device, cfg=cfg)
    frozen_p = json.loads(FROZEN_P.read_text(encoding="utf-8")) if FROZEN_P.is_file() else {}
    p_rr = float(p_m.get("RecallRetained") or 0)
    p_ok = p_rr >= 0.945
    dump(
        OUT / "post_rollback_p_regression.json",
        {
            "n": p_m.get("n"),
            "RecallRetained": p_rr,
            "frozen_RecallRetained": frozen_p.get("RecallRetained"),
            "gate": 0.945,
            "pass": p_ok,
            "metrics": p_m,
        },
    )
    d_rows = load_jsonl(DATA_D)
    d_val = [r for r in d_rows if r.get("split") == "val"]
    d_val_by = defaultdict(list)
    for r in d_val:
        d_val_by[r.get("persona") or "CORRECT"].append(r)
    d_val_correct = d_val_by.get("CORRECT") or []
    a_d = d_suite(index, d_val_by, model, device=device, cfg=cfg)
    corr = float((a_d["counterfactual"].get("CORRECT") or {}).get("TIR") or 0)
    emp = float((a_d["counterfactual"].get("EMPTY") or {}).get("TIR") or 0)
    d_ok = corr > emp
    dump(
        OUT / "post_rollback_d_regression.json",
        {"correct_tir": corr, "empty_tir": emp, "correct_gt_empty": d_ok, "pass": d_ok, "suite": {k: a_d.get(k) for k in ("teacher", "counterfactual") if k in a_d}},
    )
    # identity vs frozen recorded RR (semantic; execute_action latency not bitwise)
    pd_id = {
        "p_rr_now": p_rr,
        "p_rr_frozen_file": frozen_p.get("RecallRetained"),
        "abs_delta": abs(p_rr - float(frozen_p.get("RecallRetained") or 0)) if frozen_p else None,
        "bitwise_logits_not_compared_to_stored_tensor": True,
        "reason": "Stage J stored metrics JSON not raw logits; identity is same checkpoint + same eval_p_slice/d_suite",
        "pass": p_ok and d_ok and (frozen_p.get("RecallRetained") is None or abs(p_rr - float(frozen_p["RecallRetained"])) < 0.02),
    }
    dump(OUT / "post_rollback_pd_identity_check.json", pd_id)
    print("P_RR", p_rr, "D_corr", corr, "D_empty", emp, flush=True)
    return 0 if p_ok and d_ok else 4


if __name__ == "__main__":
    raise SystemExit(main())
