#!/usr/bin/env python3
"""Evaluate PseudoUser Accent Scale: behaviour funnel, fidelity, supervision matrix."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.pronunciation.scale_users import FINAL_FAMILIES, INITIAL_FAMILIES

DATASET_ID = "model2-pseudo-user-accent-scale-v1"


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def _rate(n: int, d: int) -> float:
    return n / max(1, d)


def classify_fidelity(m: dict[str, float]) -> str:
    """GOOD/USABLE/WEAK/UNUSABLE from rates."""
    base = m.get("base_realization_rate", 0)
    asr = m.get("asr_effect_rate", 0)
    assoc = m.get("associated_positive_rate", 0)
    score = 0.4 * base + 0.3 * asr + 0.3 * assoc
    if score >= 0.55 and base >= 0.4 and asr >= 0.35:
        return "GOOD"
    if score >= 0.35 and (base >= 0.25 or asr >= 0.3):
        return "USABLE"
    if score >= 0.2:
        return "WEAK"
    return "UNUSABLE"


def supervision_label(fid: str, mono_ok: bool, binary_ok: bool) -> str:
    if fid in ("GOOD", "USABLE") and mono_ok:
        return "TRAINABLE_CONTINUOUS"
    if fid in ("GOOD", "USABLE", "WEAK") and binary_ok:
        return "TRAINABLE_BINARY"
    if fid == "WEAK":
        return "WEAK"
    return "DEFER"


def monotonic(vals: list[float]) -> bool:
    return all(vals[i] >= vals[i + 1] - 1e-9 for i in range(len(vals) - 1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1",
    )
    ap.add_argument("--dataset-id", type=str, default="")
    ap.add_argument("--utt-min", type=int, default=0)
    ap.add_argument("--utt-max", type=int, default=0)
    args = ap.parse_args()
    out_dir = args.out_dir
    dataset_id = args.dataset_id or DATASET_ID
    utt_min, utt_max = args.utt_min, args.utt_max
    if utt_min <= 0 or utt_max <= 0:
        if "baseline" in str(out_dir).lower() or "baseline" in dataset_id:
            dataset_id = dataset_id if "baseline" in dataset_id else "model2-baseline-dataset-v1"
            utt_min, utt_max = 8000, 12000
        else:
            utt_min, utt_max = 2000, 5000

    plans = {p["sample_plan_id"]: p for p in _load_jsonl(out_dir / "generation_plan.jsonl")}
    results = _load_jsonl(out_dir / "results.jsonl")
    users = _load_jsonl(out_dir / "pseudo_users.jsonl")
    users_by_id = {u["pseudo_user_id"]: u for u in users}
    samples = _load_jsonl(out_dir / "training_samples.jsonl")

    ok = [r for r in results if r.get("status") == "ok"]
    # Funnel aggregates
    # applicable from plan; selected from plan; realized/asr from results
    by_strength_fam: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {
            "applicable": 0,
            "selected": 0,
            "realized": 0,
            "asr_effect": 0,
            "n_utt": 0,
            "associated": 0,
            "eligible_pos": 0,
        }
    )
    by_fam: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "applicable": 0,
            "selected": 0,
            "realized": 0,
            "asr_effect": 0,
            "n_utt": 0,
            "associated": 0,
            "eligible_pos": 0,
            "surface": 0,
            "phoneme": 0,
            "paired_changed": 0,
            "paired_n": 0,
        }
    )
    user_rows: dict[str, list[dict]] = defaultdict(list)

    for r in ok:
        plan = plans.get(r["sample_plan_id"]) or {}
        fam = r.get("family") or plan.get("family")
        strength = r.get("intended_strength") or plan.get("intended_strength") or "NONE"
        app = len(plan.get("applicable_positions") or [])
        sel = len(plan.get("selected_positions") or [])
        key = (fam, strength)
        by_strength_fam[key]["n_utt"] += 1
        by_strength_fam[key]["applicable"] += app
        by_strength_fam[key]["selected"] += sel
        by_fam[fam]["n_utt"] += 1
        by_fam[fam]["applicable"] += app
        by_fam[fam]["selected"] += sel

        rv = r.get("realization_v2") or {}
        al = r.get("alignment") or {}
        realized = bool(rv.get("base_realized") or rv.get("full_realized") or rv.get("differently_realized"))
        asr_effect = False
        if plan.get("corruption_planned") and sel > 0:
            # ASR differs from GT or not recovering term
            hyp = r.get("asr_hypothesis") or r.get("corrupted_asr_text") or ""
            gt = r.get("ground_truth_text") or ""
            asr_effect = "".join(hyp.split()) != "".join(gt.split())
            if realized:
                by_strength_fam[key]["realized"] += 1
                by_fam[fam]["realized"] += 1
            if asr_effect:
                by_strength_fam[key]["asr_effect"] += 1
                by_fam[fam]["asr_effect"] += 1
            if al.get("associated_with_corruption"):
                by_strength_fam[key]["associated"] += 1
                by_fam[fam]["associated"] += 1
            if al.get("associated_with_corruption") and al.get("model2_term_training_eligible"):
                by_strength_fam[key]["eligible_pos"] += 1
                by_fam[fam]["eligible_pos"] += 1
            backend = r.get("backend")
            if backend == "CHINESE_SURFACE":
                by_fam[fam]["surface"] += 1
            elif backend == "PHONEME":
                by_fam[fam]["phoneme"] += 1
        if r.get("is_paired_control") and r.get("paired_asr_changed") is not None:
            by_fam[fam]["paired_n"] += 1
            if r.get("paired_asr_changed"):
                by_fam[fam]["paired_changed"] += 1

        user_rows[r.get("pseudo_user_id") or plan.get("pseudo_user_id")].append(
            {
                "family": fam,
                "strength": strength,
                "applicable": app,
                "selected": sel,
                "realized": int(realized and sel > 0),
                "asr_effect": int(asr_effect and sel > 0),
            }
        )

    # Per-feature fidelity + monotonicity
    feature_fidelity = {}
    for fam in PHONETIC_FEATURE_KEYS:
        strength_order = ["HIGH", "MEDIUM", "LOW", "NONE"]
        e2e = []
        sel_rates = []
        detail = {}
        for st in strength_order:
            c = by_strength_fam[(fam, st)]
            sel_r = _rate(c["selected"], c["applicable"])
            real_r = _rate(c["realized"], max(1, c["selected"]))
            asr_r = _rate(c["asr_effect"], max(1, c["selected"]))
            e2e_r = _rate(c["asr_effect"], c["applicable"])
            assoc_r = _rate(c["associated"], max(1, c["n_utt"]))
            detail[st] = {
                **c,
                "selection_rate": sel_r,
                "realization_rate": real_r,
                "asr_effect_rate": asr_r,
                "end_to_end_behaviour_rate": e2e_r,
                "associated_positive_rate": assoc_r,
            }
            e2e.append(e2e_r)
            sel_rates.append(sel_r)
        # HIGH vs NONE binary
        high = detail["HIGH"]["end_to_end_behaviour_rate"]
        none = detail["NONE"]["end_to_end_behaviour_rate"]
        binary_ok = high >= none + 0.08
        mono_sel = monotonic(sel_rates[:3])  # HIGH>MED>LOW (NONE separate)
        # allow soft mono on e2e
        mono_e2e = e2e[0] + 0.02 >= e2e[1] and e2e[1] + 0.02 >= e2e[2]
        bf = by_fam[fam]
        metrics = {
            "base_realization_rate": _rate(bf["realized"], max(1, bf["selected"])),
            "asr_effect_rate": _rate(bf["asr_effect"], max(1, bf["selected"])),
            "associated_positive_rate": _rate(bf["associated"], max(1, bf["n_utt"])),
            "paired_asr_change_rate": _rate(bf["paired_changed"], max(1, bf["paired_n"])),
            "surface_n": bf["surface"],
            "phoneme_n": bf["phoneme"],
            "family_group": "initial" if fam in INITIAL_FAMILIES else "final",
        }
        fid = classify_fidelity(metrics)
        sup = supervision_label(fid, mono_sel and mono_e2e, binary_ok)
        feature_fidelity[fam] = {
            "fidelity": fid,
            "supervision": sup,
            "monotonic_selection": mono_sel,
            "monotonic_e2e_soft": mono_e2e,
            "binary_high_vs_none_ok": binary_ok,
            "per_strength": detail,
            **metrics,
        }

    (out_dir / "feature_fidelity_metrics.json").write_text(
        json.dumps(feature_fidelity, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # User behaviour metrics
    user_behaviour = []
    for uid, rows in user_rows.items():
        u = users_by_id.get(uid) or {}
        intended = u.get("family_strength") or {}
        # aggregate per intended family
        for fam, st in (intended or {"_none": "NONE"}).items():
            if fam == "_none":
                continue
            sub = [x for x in rows if x["family"] == fam]
            app = sum(x["applicable"] for x in sub)
            sel = sum(x["selected"] for x in sub)
            real = sum(x["realized"] for x in sub)
            asr_e = sum(x["asr_effect"] for x in sub)
            user_behaviour.append(
                {
                    "pseudo_user_id": uid,
                    "family": fam,
                    "intended_strength": st,
                    "intended_prob": (u.get("family_prob") or {}).get(fam, 0),
                    "applicable": app,
                    "selected": sel,
                    "realized": real,
                    "asr_effect": asr_e,
                    "selection_rate": _rate(sel, app),
                    "realization_rate": _rate(real, sel),
                    "asr_effect_rate": _rate(asr_e, sel),
                    "end_to_end_behaviour_rate": _rate(asr_e, app),
                }
            )
    (out_dir / "user_behaviour_metrics.json").write_text(
        json.dumps({"users": user_behaviour, "n": len(user_behaviour)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Alignment / eligibility (rates over corruption-planned utterances only)
    elig_counts = Counter(r.get("eligibility_class") for r in ok)
    corr_ok = [r for r in ok if r.get("corruption_planned")]
    assoc_n = sum(1 for r in corr_ok if (r.get("alignment") or {}).get("associated_with_corruption"))
    eligible_n = sum(
        1
        for r in corr_ok
        if (r.get("alignment") or {}).get("associated_with_corruption")
        and (r.get("alignment") or {}).get("model2_term_training_eligible")
    )
    alignment_metrics = {
        "CorruptionAssociatedPositiveRate": _rate(assoc_n, len(corr_ok)),
        "EligibleTermSpanRate": _rate(eligible_n, len(corr_ok)),
        "eligibility_class_counts": dict(elig_counts),
        "NonTermPositiveRate": _rate(
            elig_counts.get("INELIGIBLE_NON_TERM", 0),
            max(1, len(corr_ok)),
        ),
        "EligiblePronunciationPositiveRate": _rate(
            elig_counts.get("ELIGIBLE_PRONUNCIATION_POSITIVE", 0),
            max(1, len(corr_ok)),
        ),
    }
    (out_dir / "alignment_metrics.json").write_text(
        json.dumps(alignment_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "eligibility_metrics.json").write_text(
        json.dumps({"counts": dict(elig_counts), **alignment_metrics}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Paired metrics
    paired = [r for r in ok if r.get("is_paired_control") and r.get("corruption_planned")]
    paired_metrics = {
        "n_paired": len(paired),
        "PairedASRChangeRate": _rate(sum(1 for r in paired if r.get("paired_asr_changed")), len(paired)),
        "by_family": {
            fam: _rate(
                sum(1 for r in paired if r.get("family") == fam and r.get("paired_asr_changed")),
                sum(1 for r in paired if r.get("family") == fam),
            )
            for fam in PHONETIC_FEATURE_KEYS
        },
    }
    (out_dir / "paired_metrics.json").write_text(
        json.dumps(paired_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Condition supervision matrix
    matrix = []
    for fam in PHONETIC_FEATURE_KEYS:
        ff = feature_fidelity[fam]
        matrix.append(
            {
                "condition": fam,
                "condition_type": "phonetic",
                "reliable_supervision": ff["supervision"] in ("TRAINABLE_CONTINUOUS", "TRAINABLE_BINARY"),
                "supervision": ff["supervision"],
                "fidelity": ff["fidelity"],
                "data_source": "PSEUDO_USER_ACCENT_SCALE_V1",
                "mask_default": 0 if ff["supervision"] in ("WEAK", "DEFER") else 1,
                "family_group": ff["family_group"],
            }
        )
    # tone / personal / domain placeholders
    matrix.append(
        {
            "condition": "tone_*",
            "condition_type": "tone",
            "reliable_supervision": False,
            "supervision": "DEFER",
            "fidelity": "UNUSABLE",
            "data_source": "NOT_IN_5F",
            "mask_default": 0,
            "note": "Tone corruption + diagnostic DEFER",
        }
    )
    matrix.append(
        {
            "condition": "personal_terms",
            "condition_type": "personal",
            "reliable_supervision": False,
            "supervision": "DEFER",
            "fidelity": "WEAK",
            "data_source": "MINIMAL_IN_5F",
            "mask_default": 0,
        }
    )
    matrix.append(
        {
            "condition": "domain_bias",
            "condition_type": "domain",
            "reliable_supervision": False,
            "supervision": "DEFER",
            "fidelity": "WEAK",
            "data_source": "MINIMAL_IN_5F",
            "mask_default": 0,
        }
    )
    (out_dir / "condition_supervision_matrix.json").write_text(
        json.dumps({"matrix": matrix, "schema_version": "user-feature-schema-v1"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Aggregate scale metrics
    total_app = sum(by_fam[f]["applicable"] for f in PHONETIC_FEATURE_KEYS)
    total_sel = sum(by_fam[f]["selected"] for f in PHONETIC_FEATURE_KEYS)
    total_real = sum(by_fam[f]["realized"] for f in PHONETIC_FEATURE_KEYS)
    total_asr = sum(by_fam[f]["asr_effect"] for f in PHONETIC_FEATURE_KEYS)
    initial_fams = [f for f in PHONETIC_FEATURE_KEYS if f in INITIAL_FAMILIES]
    final_fams = [f for f in PHONETIC_FEATURE_KEYS if f in FINAL_FAMILIES]

    def group_rate(fams, key_num, key_den):
        n = sum(by_fam[f][key_num] for f in fams)
        d = sum(by_fam[f][key_den] for f in fams)
        return _rate(n, d)

    scale_metrics = {
        "TotalUtterances": len(ok),
        "TotalPseudoUsers": len(users),
        "ApplicablePositions": total_app,
        "SelectedCorruptions": total_sel,
        "RealizedCorruptions": total_real,
        "ASRObservableEffects": total_asr,
        "SelectionRate": _rate(total_sel, total_app),
        "RealizationRate": _rate(total_real, total_sel),
        "ASREffectRate": _rate(total_asr, total_sel),
        "EndToEndBehaviourRate": _rate(total_asr, total_app),
        "SurfaceBackendRate": _rate(sum(by_fam[f]["surface"] for f in PHONETIC_FEATURE_KEYS), max(1, total_sel)),
        "PhonemeBackendRate": _rate(sum(by_fam[f]["phoneme"] for f in PHONETIC_FEATURE_KEYS), max(1, total_sel)),
        "initial_family_e2e": group_rate(initial_fams, "asr_effect", "applicable"),
        "final_family_e2e": group_rate(final_fams, "asr_effect", "applicable"),
        "trainable_continuous": [m["condition"] for m in matrix if m.get("supervision") == "TRAINABLE_CONTINUOUS"],
        "trainable_binary": [m["condition"] for m in matrix if m.get("supervision") == "TRAINABLE_BINARY"],
        "weak": [m["condition"] for m in matrix if m.get("supervision") == "WEAK"],
        "defer": [m["condition"] for m in matrix if m.get("supervision") == "DEFER" and m["condition_type"] == "phonetic"],
    }
    (out_dir / "scale_metrics.json").write_text(json.dumps(scale_metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    # Lightweight train rows pointer: reuse samples with eligibility flags
    # Write enriched sample index for Stage B builder
    train_index = []
    for s in samples:
        syn = (s.get("metadata") or {}).get("synthetic") or {}
        train_index.append(
            {
                "sample_id": s.get("sample_id"),
                "source_type": (s.get("metadata") or {}).get("source_type"),
                "sample_kind": (s.get("metadata") or {}).get("sample_kind"),
                "eligibility_class": syn.get("eligibility_class"),
                "associated_with_corruption": syn.get("associated_with_corruption"),
                "corruption_family": syn.get("corruption_family"),
                "phonetic_profile_acoustically_realized": syn.get("phonetic_profile_acoustically_realized"),
                "pseudo_user_id": syn.get("pseudo_user_id"),
            }
        )
    with (out_dir / "model2_train_rows.jsonl").open("w", encoding="utf-8") as f:
        # compatibility: write index rows; full tensor rows can be built later by Stage B builder
        for row in train_index:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    run_summary = {}
    if (out_dir / "run_summary.json").exists():
        run_summary = json.loads((out_dir / "run_summary.json").read_text(encoding="utf-8"))

    leakage = {}
    if (out_dir / "leakage_audit.json").exists():
        leakage = json.loads((out_dir / "leakage_audit.json").read_text(encoding="utf-8"))

    go = {
        "utterances_in_range": utt_min <= len(ok) <= utt_max,
        "utt_min": utt_min,
        "utt_max": utt_max,
        "user_leakage_zero": not leakage.get("user_leaks"),
        "trainable_core_count": len(scale_metrics["trainable_continuous"]) + len(scale_metrics["trainable_binary"]),
        "core_initial_ok": scale_metrics["initial_family_e2e"] > scale_metrics["final_family_e2e"] * 0.5,
        "eligible_span_ok": alignment_metrics["EligibleTermSpanRate"] >= 0.45,
        "no_manual_asr": True,
    }
    # Stage B GO if at least 6 trainable phonetic conditions and scale ok
    go["stage_b_data_gate"] = bool(
        go["utterances_in_range"]
        and go["user_leakage_zero"]
        and go["trainable_core_count"] >= 6
        and go["eligible_span_ok"]
    )

    manifest = {
        "dataset_id": dataset_id,
        "n_results_ok": len(ok),
        "n_samples": len(samples),
        "scale_metrics": scale_metrics,
        "alignment_metrics": alignment_metrics,
        "paired_metrics": paired_metrics,
        "go_signals": go,
        "performance": run_summary,
        "tone_diagnostic": "DEFERRED",
        "model_training": "NOT_RUN",
        "markers": (
            ["MODEL2_BASELINE_V1", "NOT_FOR_RUNTIME", "NOT_FROZEN"]
            if "baseline" in dataset_id
            else ["PSEUDO_USER_ACCENT_SCALE", "NOT_FOR_RUNTIME", "NOT_FROZEN"]
        ),
    }
    (out_dir / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
