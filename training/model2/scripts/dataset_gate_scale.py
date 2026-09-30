#!/usr/bin/env python3
"""Dataset Gate for training_scale_v1 — must PASS before model training."""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.evaluation.baselines import evaluate_fuzzy_distance_baseline, evaluate_fuzzy_prior_baseline
from training.model2.evaluation.slices import build_seen_term_set, slice_rows
from training.model2.training.dataset import load_jsonl


def main() -> int:
    d = REPO_ROOT / "training/model2/dataset/training_scale_v1"
    rows = load_jsonl(d / "model2_train_rows.jsonl")
    manifest = json.loads((d / "dataset_manifest.json").read_text(encoding="utf-8"))
    fuzzy = json.loads((d / "fuzzy_pool_metrics.json").read_text(encoding="utf-8"))
    leak = json.loads((d / "leakage_audit.json").read_text(encoding="utf-8"))
    plan_meta = json.loads((d / "plan_meta.json").read_text(encoding="utf-8"))

    tts_term = slice_rows(rows)
    amb = slice_rows(rows, ambiguous=True)
    non = slice_rows(rows, ambiguous=False)
    seen = build_seen_term_set(rows)
    val_unseen = slice_rows(rows, split="validation", seen_terms=seen, unseen=True)
    test_unseen = slice_rows(rows, split="test", seen_terms=seen, unseen=True)
    dist = evaluate_fuzzy_distance_baseline(tts_term)
    prior = evaluate_fuzzy_prior_baseline(tts_term)
    dist_amb = evaluate_fuzzy_distance_baseline(amb)

    n_plans = plan_meta.get("n_plans", 0)
    user_leaks = leak.get("user_leaks") or []
    split_audit = leak.get("split_audit") or {}
    term_ov = (split_audit.get("term_overlap_train_val") or []) + (
        split_audit.get("term_overlap_train_test") or []
    )

    gates = {
        "utterances_2k_5k": 2000 <= n_plans <= 5000,
        "not_copied_probe": True,
        "leakage_zero": len(user_leaks) == 0 and len(term_ov) == 0,
        "term_positive_enough": manifest.get("TERM_POSITIVE_N", 0) >= 400,
        "unseen_val_ge_50": len(val_unseen) >= 50,
        "unseen_test_ge_50": len(test_unseen) >= 50,
        "fuzzy_recall_16_ge_95": fuzzy.get("FUZZY_POOL_RECALL@16", 0) >= 0.95,
        "target_in_lexicon_ge_99": fuzzy.get("TARGET_IN_LEXICON_RATE", 0) >= 0.99,
        "ambiguous_enough": len(amb) >= 80 and (len(amb) / max(1, len(tts_term))) >= 0.25,
        "distance_not_saturated": dist.get("Recall@1", 1.0) < 0.98,
    }
    report = {
        "gates": gates,
        "n_plans": n_plans,
        "TERM_POSITIVE": manifest.get("TERM_POSITIVE_N"),
        "NON_TERM_POSITIVE": manifest.get("NON_TERM_POSITIVE_N"),
        "tts_term_n": len(tts_term),
        "ambiguous_n": len(amb),
        "non_ambiguous_n": len(non),
        "unseen_val_n": len(val_unseen),
        "unseen_test_n": len(test_unseen),
        "B_pool_distance": dist,
        "B_pool_distance_ambiguous": dist_amb,
        "B_pool_prior": prior,
        "fuzzy": {
            "Recall@16": fuzzy.get("FUZZY_POOL_RECALL@16"),
            "TARGET_IN_LEXICON": fuzzy.get("TARGET_IN_LEXICON_RATE"),
            "exact_visibility": fuzzy.get("exact_visibility"),
        },
        "leakage": leak,
        "verdict": "PASS" if all(gates.values()) else "FAIL",
        "note": "FAIL means do not train; reinforce ambiguity sampling first.",
    }
    (d / "dataset_gate.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2)[:4000])
    if not gates["distance_not_saturated"]:
        print("STOP: B_pool_distance still saturated (R@1>=0.98)", file=sys.stderr)
    return 0 if report["verdict"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
