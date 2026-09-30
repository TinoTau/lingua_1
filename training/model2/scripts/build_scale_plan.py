#!/usr/bin/env python3
"""Build training_scale_v1 plan BEFORE TTS/ASR. Ambiguity-first, split pre-allocated."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.ambiguity.inventory import build_ambiguous_inventory
from training.model2.candidates.index import build_candidate_index_from_sqlite
from training.model2.constants import DEFAULT_TTS_VOICE, GENERATOR_VERSION
from training.model2.corpus.lexicon_export import (
    default_lexicon_paths,
    export_base_background,
    export_domain_terms,
    load_lexicon_snapshot_meta,
    write_jsonl,
)
from training.model2.corruption.bank import resolve_spec
from training.model2.pseudo_user.factory import build_pseudo_users
from training.model2.splits.assign import (
    SplitAssignment,
    assign_split_for_keys,
    assign_term_split,
    audit_term_combination_holdout,
    audit_user_disjoint,
)

DATASET_ID = "model2-synth-scale-v1"
CARRIER_VERSION = "carrier_templates_v2"


def _load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def plan_id_for(**fields) -> str:
    material = json.dumps(fields, ensure_ascii=False, sort_keys=True)
    h = hashlib.sha256(material.encode("utf-8")).hexdigest()[:20]
    return f"plan-{h}"


def context_target_leak(gt_text: str, term: str) -> bool:
    if not term:
        return False
    # leak if term appears more than once (carrier repeated the target)
    return gt_text.count(term) > 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260812)
    ap.add_argument("--n-groups", type=int, default=150)
    ap.add_argument("--target-plans", type=int, default=3000)
    ap.add_argument("--ambiguous-frac", type=float, default=0.65)
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training" / "model2" / "dataset" / "training_scale_v1",
    )
    args = ap.parse_args()
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    carriers = _load_jsonl(REPO_ROOT / "training/model2/corpus/carrier_templates_v2.jsonl")
    term_carriers = [c for c in carriers if "{TERM}" in c["template"]]
    bg_carriers = [c for c in carriers if "{TERM}" not in c["template"]]
    assert len(term_carriers) >= 50, len(term_carriers)

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    snap = f"sha256:{lex_meta.get('checksum') or lex_meta.get('bundleVersion')}"
    index = build_candidate_index_from_sqlite(paths["sqlite"], snap, include_idiom=False)
    domain_terms = export_domain_terms(paths["sqlite"])
    # unique by surface, keep first (highest prior from export order)
    uniq: dict[str, dict] = {}
    for t in domain_terms:
        uniq.setdefault(t["term"], t)
    domain_terms = list(uniq.values())
    write_jsonl(out_dir / "lexicon_domain_terms.jsonl", domain_terms)
    write_jsonl(out_dir / "lexicon_base_background.jsonl", export_base_background(paths["sqlite"], limit=200))

    inv_path = out_dir / "ambiguity_inventory.jsonl"
    if inv_path.exists() and inv_path.stat().st_size > 0:
        inventory = []
        for line in inv_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                inventory.append(json.loads(line))
        print(f"reusing inventory n={len(inventory)}", flush=True)
    else:
        recs = []
        for t in domain_terms:
            rec = index.resolve_surface(t["term"], t["domain_tags"][0] if t["domain_tags"] else None)
            if rec:
                recs.append(rec)
        inventory = build_ambiguous_inventory(index, records=recs)
    for row in inventory:
        row["prefer_ambiguous"] = (
            row["n_near_d1"] >= 4
            or row["n_equal_distance_d0"] >= 1
            or row["n_higher_prior_neighbors"] >= 3
        )
        row["ambiguity_rank_key"] = (
            0 if row["prefer_ambiguous"] else 1,
            -row["n_near_d1"],
            -row["n_higher_prior_neighbors"],
            -row["n_fuzzy_neighbors"],
            row["prior_score"],
        )
    inventory.sort(key=lambda x: x["ambiguity_rank_key"])
    with (out_dir / "ambiguity_inventory.jsonl").open("w", encoding="utf-8") as f:
        for row in inventory:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    amb = [x for x in inventory if x["prefer_ambiguous"]]
    non = [x for x in inventory if not x["prefer_ambiguous"]]
    inv_metrics = {
        "n_terms_scanned": len(inventory),
        "n_prefer_ambiguous": len(amb),
        "n_non_ambiguous": len(non),
        "ambiguous_frac_available": len(amb) / max(1, len(inventory)),
        "mean_neighbors_ambiguous": sum(x["n_fuzzy_neighbors"] for x in amb) / max(1, len(amb)),
        "mean_neighbors_non": sum(x["n_fuzzy_neighbors"] for x in non) / max(1, len(non)),
        "trunc_not_unique": sum(1 for x in inventory if not x["trunc_query_unique_nearest"]),
    }
    (out_dir / "ambiguity_metrics.json").write_text(
        json.dumps(inv_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    by_term = {x["term"]: x for x in inventory}
    domains = sorted({t["domain_tags"][0] for t in domain_terms if t["domain_tags"]})
    # Personal pool: include competitors so native HN can land in FuzzyPool
    personal_pool = [t["term"] for t in domain_terms]
    for x in amb[:200]:
        for c in x.get("competitors") or []:
            personal_pool.append(c["surface"])
    users = build_pseudo_users(
        n_groups=args.n_groups,
        personal_term_pool=personal_pool,
        domains=domains,
        seed=args.seed,
    )
    (out_dir / "pseudo_users.json").write_text(
        json.dumps([u.to_dict() for u in users], ensure_ascii=False, indent=2), encoding="utf-8"
    )

    corruption_mix = [
        ("NONE", "default"),
        ("NOISE", "snr_20db"),
        ("NOISE", "snr_10db"),
        ("SPEED", "fast_1p1"),
        ("SPEED", "slow_0p9"),
        ("VOLUME", "quiet_0p5"),
        ("REVERB", "light"),
        ("REVERB", "medium"),
    ]
    for s, lv in corruption_mix:
        resolve_spec(s, lv)

    user_split = {
        u.pseudo_user_group_id: assign_split_for_keys(
            pseudo_user_group_id=u.pseudo_user_group_id,
            target_term="__",
            seed=args.seed,
        )
        for u in users
    }
    term_split = {t["term"]: assign_term_split(target_term=t["term"], seed=args.seed) for t in domain_terms}

    # Bucket terms by split × ambiguity
    buckets: dict[tuple[str, str], list[dict]] = {}
    for t in domain_terms:
        inv = by_term.get(t["term"])
        kind = "amb" if inv and inv["prefer_ambiguous"] else "non"
        buckets.setdefault((term_split[t["term"]], kind), []).append(t)

    users_by_split: dict[str, list] = {"train": [], "validation": [], "test": []}
    for u in users:
        users_by_split[user_split[u.pseudo_user_group_id]].append(u)

    # Result-oriented 80/10/10 on plans, oversampling val/test terms
    split_quota = {
        "train": int(args.target_plans * 0.80),
        "validation": int(args.target_plans * 0.10),
        "test": args.target_plans - int(args.target_plans * 0.80) - int(args.target_plans * 0.10),
    }
    bg_quota = max(80, int(args.target_plans * 0.08))

    plans = []
    assignments: list[SplitAssignment] = []
    seen_ids: set[str] = set()
    leak_blocked = 0

    def add_plan(plan: dict, split: str, user, target_term: str | None) -> bool:
        nonlocal leak_blocked
        if target_term and context_target_leak(plan["gt_text"], target_term):
            leak_blocked += 1
            return False
        spid = plan["sample_plan_id"]
        if spid in seen_ids:
            return False
        seen_ids.add(spid)
        plans.append(plan)
        assignments.append(
            SplitAssignment(
                sample_plan_id=spid,
                split=split,
                pseudo_user_group_id=user.pseudo_user_group_id,
                target_term=target_term or f"__bg__{spid}",
            )
        )
        return True

    idx = 0
    # Fill each split independently so val/test get real mass
    for split, quota in split_quota.items():
        u_list = users_by_split[split] or users
        amb_terms = buckets.get((split, "amb")) or []
        non_terms = buckets.get((split, "non")) or []
        if not amb_terms and not non_terms:
            # fallback: any terms of this split
            amb_terms = [t for t in domain_terms if term_split[t["term"]] == split]
        n_bg = max(8, int(quota * bg_quota / args.target_plans))
        n_term = quota - n_bg
        n_amb = int(n_term * args.ambiguous_frac)
        n_non = n_term - n_amb
        targets = [("amb", n_amb, amb_terms or non_terms), ("non", n_non, non_terms or amb_terms)]
        for kind, n_need, pool in targets:
            if not pool:
                continue
            k = 0
            attempts = 0
            while k < n_need and attempts < n_need * 30:
                attempts += 1
                user = u_list[idx % len(u_list)]
                term = pool[idx % len(pool)]
                idx += 1
                if user_split[user.pseudo_user_group_id] != split:
                    continue
                if term_split[term["term"]] != split:
                    continue
                carrier = term_carriers[attempts % len(term_carriers)]
                gt = carrier["template"].replace("{TERM}", term["term"])
                corr_s, corr_lv = corruption_mix[attempts % len(corruption_mix)]
                fields = {
                    "seed": args.seed,
                    "pseudo_user_group_id": user.pseudo_user_group_id,
                    "carrier_id": carrier["carrier_id"],
                    "target_term": term["term"],
                    "corruption": f"{corr_s}:{corr_lv}",
                    "gt_text": gt,
                    "item_index": idx,
                    "generator_version": GENERATOR_VERSION,
                }
                spid = plan_id_for(**fields)
                inv = by_term.get(term["term"]) or {}
                plan = {
                    "sample_plan_id": spid,
                    "split": split,
                    "carrier_id": carrier["carrier_id"],
                    "carrier_version": CARRIER_VERSION,
                    "target_term": term["term"],
                    "domain": term["domain_tags"][0] if term["domain_tags"] else None,
                    "gt_text": gt,
                    "tts_voice": DEFAULT_TTS_VOICE,
                    "corruption_strategy": corr_s,
                    "corruption_level": corr_lv,
                    "seed": args.seed,
                    "item_index": idx,
                    "pseudo_user_group_id": user.pseudo_user_group_id,
                    "personal_terms": user.personal_terms,
                    "pinyin_key": term.get("pinyin_key"),
                    "prefer_ambiguous": bool(inv.get("prefer_ambiguous")),
                    "planned_kind": kind,
                }
                if add_plan(plan, split, user, term["term"]):
                    k += 1
        # background for N1/N2 mix
        for j in range(n_bg):
            user = u_list[j % len(u_list)]
            carrier = bg_carriers[j % len(bg_carriers)]
            corr_s, corr_lv = corruption_mix[j % len(corruption_mix)]
            gt = carrier["template"]
            fields = {
                "seed": args.seed,
                "pseudo_user_group_id": user.pseudo_user_group_id,
                "carrier_id": carrier["carrier_id"],
                "target_term": None,
                "corruption": f"{corr_s}:{corr_lv}",
                "gt_text": gt,
                "item_index": 10_000_000 + idx + j,
                "generator_version": GENERATOR_VERSION,
            }
            spid = plan_id_for(**fields)
            plan = {
                "sample_plan_id": spid,
                "split": split,
                "carrier_id": carrier["carrier_id"],
                "carrier_version": CARRIER_VERSION,
                "target_term": None,
                "domain": None,
                "gt_text": gt,
                "tts_voice": DEFAULT_TTS_VOICE,
                "corruption_strategy": corr_s,
                "corruption_level": corr_lv,
                "seed": args.seed,
                "item_index": 10_000_000 + idx + j,
                "pseudo_user_group_id": user.pseudo_user_group_id,
                "personal_terms": user.personal_terms,
                "pinyin_key": None,
                "prefer_ambiguous": False,
                "planned_kind": "bg",
            }
            add_plan(plan, split, user, None)

    # RULE_SYNTHETIC auxiliary: competitor-as-source for equal/near distance (isolated)
    rule_plans = []
    rule_n = 0
    rule_cap = 350
    for split in ("train", "validation", "test"):
        pool = buckets.get((split, "amb")) or []
        u_list = users_by_split[split] or users
        cap_s = {"train": 250, "validation": 50, "test": 50}[split]
        made = 0
        for ti, term in enumerate(pool):
            if made >= cap_s or rule_n >= rule_cap:
                break
            inv = by_term.get(term["term"]) or {}
            comps = [c for c in inv.get("competitors") or [] if c["distance"] <= 2 and c["surface"] != term["term"]]
            if not comps:
                continue
            c0 = comps[0]
            user = u_list[ti % len(u_list)]
            carrier = term_carriers[ti % len(term_carriers)]
            # hyp replaces target with competitor surface — not TTS_ASR
            hyp = carrier["template"].replace("{TERM}", c0["surface"])
            gt = carrier["template"].replace("{TERM}", term["term"])
            if context_target_leak(gt, term["term"]) or context_target_leak(hyp, term["term"]):
                continue
            if c0["surface"] in carrier["template"].replace("{TERM}", ""):
                continue
            rid = plan_id_for(
                seed=args.seed,
                kind="RULE",
                target=term["term"],
                source=c0["surface"],
                carrier=carrier["carrier_id"],
                split=split,
                user=user.pseudo_user_group_id,
            )
            rule_plans.append(
                {
                    "sample_plan_id": rid,
                    "split": split,
                    "source_type": "RULE_SYNTHETIC",
                    "carrier_id": carrier["carrier_id"],
                    "target_term": term["term"],
                    "source_span": c0["surface"],
                    "gt_text": gt,
                    "hyp_text": hyp,
                    "domain": term["domain_tags"][0] if term["domain_tags"] else None,
                    "pseudo_user_group_id": user.pseudo_user_group_id,
                    "competitor_distance": c0["distance"],
                    "note": "text-level phonetic competitor substitution; not acoustic proof",
                }
            )
            made += 1
            rule_n += 1

    with (out_dir / "plan.jsonl").open("w", encoding="utf-8") as f:
        for p in plans:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    with (out_dir / "rule_plan.jsonl").open("w", encoding="utf-8") as f:
        for p in rule_plans:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    leak = audit_term_combination_holdout(assignments)
    user_leaks = audit_user_disjoint(assignments)
    split_counts = Counter(p["split"] for p in plans)
    term_counts = Counter(p["split"] for p in plans if p.get("target_term"))
    amb_counts = Counter(p["split"] for p in plans if p.get("prefer_ambiguous"))
    meta = {
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "seed": args.seed,
        "n_plans": len(plans),
        "n_rule_plans": len(rule_plans),
        "n_groups": args.n_groups,
        "n_terms": len(domain_terms),
        "n_carriers_term": len(term_carriers),
        "split_counts": dict(split_counts),
        "term_plan_split_counts": dict(term_counts),
        "ambiguous_plan_split_counts": dict(amb_counts),
        "user_leaks": user_leaks,
        "split_audit": leak,
        "leak_blocked_carriers": leak_blocked,
        "lexicon_manifest": {
            "bundleVersion": lex_meta.get("bundleVersion"),
            "checksum": lex_meta.get("checksum"),
        },
        "carrier_version": CARRIER_VERSION,
        "inventory": inv_metrics,
        "note": "Splits assigned before generation; user-disjoint hard gate; RULE isolated.",
    }
    (out_dir / "plan_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "split_audit.json").write_text(
        json.dumps({"user_leaks": user_leaks, "split_audit": leak}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({k: meta[k] for k in meta if k != "split_audit"}, ensure_ascii=False, indent=2))
    if user_leaks or leak["term_overlap_train_val"] or leak["term_overlap_train_test"]:
        print("FAIL: leakage", file=sys.stderr)
        return 2
    if len(plans) < 2000 or len(plans) > 5000:
        print("WARN: plan count outside 2k-5k", len(plans), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
