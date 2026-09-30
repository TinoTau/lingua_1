#!/usr/bin/env python3
"""Build deterministic probe_plan.jsonl BEFORE any TTS/ASR generation."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.constants import (  # noqa: E402
    CARRIER_VERSION,
    DATASET_ID,
    DEFAULT_TTS_VOICE,
    GENERATOR_VERSION,
)
from training.model2.corpus.lexicon_export import (  # noqa: E402
    default_lexicon_paths,
    export_base_background,
    export_domain_terms,
    load_lexicon_snapshot_meta,
    write_jsonl,
)
from training.model2.corruption.bank import resolve_spec  # noqa: E402
from training.model2.pseudo_user.factory import build_pseudo_users  # noqa: E402
from training.model2.splits.assign import (  # noqa: E402
    SplitAssignment,
    assign_split_for_keys,
    assign_term_split,
    audit_term_combination_holdout,
    audit_user_disjoint,
)


def _load_carriers(path: Path) -> list[dict]:
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260812)
    ap.add_argument("--n-groups", type=int, default=16)
    ap.add_argument("--n-terms", type=int, default=50)
    ap.add_argument("--target-plans", type=int, default=320)
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training" / "model2" / "dataset" / "probe_v1",
    )
    args = ap.parse_args()

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    corpus_dir = REPO_ROOT / "training" / "model2" / "corpus"
    carriers = _load_carriers(corpus_dir / "carrier_templates_v1.jsonl")
    term_carriers = [c for c in carriers if "{TERM}" in c["template"]]
    bg_carriers = [c for c in carriers if "{TERM}" not in c["template"]]

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    domain_terms = export_domain_terms(paths["sqlite"], limit=args.n_terms)
    base_bg = export_base_background(paths["sqlite"], limit=100)
    write_jsonl(out_dir / "lexicon_domain_terms.jsonl", domain_terms)
    write_jsonl(out_dir / "lexicon_base_background.jsonl", base_bg)

    domains = sorted({t["domain_tags"][0] for t in domain_terms if t["domain_tags"]})
    personal_pool = [t["term"] for t in domain_terms]
    users = build_pseudo_users(
        n_groups=args.n_groups,
        personal_term_pool=personal_pool,
        domains=domains,
        seed=args.seed,
    )
    (out_dir / "pseudo_users.json").write_text(
        json.dumps([u.to_dict() for u in users], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Corruption mix for probe: NONE + a few acoustic strategies
    corruption_mix = [
        ("NONE", "default"),
        ("NOISE", "snr_20db"),
        ("SPEED", "fast_1p1"),
        ("VOLUME", "quiet_0p5"),
        ("REVERB", "light"),
    ]
    for s, lv in corruption_mix:
        resolve_spec(s, lv)

    plans = []
    assignments: list[SplitAssignment] = []
    idx = 0
    # Pre-assign user/term splits; only pair when both agree (user+term disjoint).
    user_split = {
        u.pseudo_user_group_id: assign_split_for_keys(
            pseudo_user_group_id=u.pseudo_user_group_id,
            target_term="__",
            seed=args.seed,
        )
        for u in users
    }
    term_split = {
        t["term"]: assign_term_split(target_term=t["term"], seed=args.seed) for t in domain_terms
    }
    # Round-robin until target; skip mismatched user/term split pairs
    attempts = 0
    max_attempts = args.target_plans * 40
    while len(plans) < args.target_plans and attempts < max_attempts:
        attempts += 1
        user = users[idx % len(users)]
        term = domain_terms[idx % len(domain_terms)]
        idx += 1
        # ~15% background sentences without rare term
        use_bg = (attempts % 7) == 0 and bg_carriers
        if use_bg:
            carrier = bg_carriers[attempts % len(bg_carriers)]
            gt = carrier["template"]
            target_term = None
            domain = None
            split = user_split[user.pseudo_user_group_id]
        else:
            if user_split[user.pseudo_user_group_id] != term_split[term["term"]]:
                continue
            carrier = term_carriers[attempts % len(term_carriers)]
            target_term = term["term"]
            domain = term["domain_tags"][0] if term["domain_tags"] else None
            gt = carrier["template"].replace("{TERM}", target_term)
            split = user_split[user.pseudo_user_group_id]
        corr_s, corr_lv = corruption_mix[attempts % len(corruption_mix)]
        fields = {
            "seed": args.seed,
            "pseudo_user_group_id": user.pseudo_user_group_id,
            "carrier_id": carrier["carrier_id"],
            "target_term": target_term,
            "domain": domain,
            "tts_voice": DEFAULT_TTS_VOICE,
            "corruption": f"{corr_s}:{corr_lv}",
            "gt_text": gt,
            "generator_version": GENERATOR_VERSION,
            "item_index": attempts,
        }
        spid = plan_id_for(**fields)
        plan = {
            "sample_plan_id": spid,
            "split": split,
            "carrier_id": carrier["carrier_id"],
            "carrier_version": CARRIER_VERSION,
            "target_term": target_term,
            "domain": domain,
            "gt_text": gt,
            "tts_voice": DEFAULT_TTS_VOICE,
            "corruption_strategy": corr_s,
            "corruption_level": corr_lv,
            "seed": args.seed,
            "item_index": attempts,
            "pseudo_user_group_id": user.pseudo_user_group_id,
            "personal_terms": user.personal_terms,
            "pinyin_key": None if use_bg else term.get("pinyin_key"),
        }
        if spid in {p["sample_plan_id"] for p in plans}:
            continue
        plans.append(plan)
        assignments.append(
            SplitAssignment(
                sample_plan_id=spid,
                split=split,
                pseudo_user_group_id=user.pseudo_user_group_id,
                target_term=target_term or f"__bg__{attempts}",
            )
        )

    plan_path = out_dir / "probe_plan.jsonl"
    with plan_path.open("w", encoding="utf-8") as f:
        for p in plans:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    leak = audit_term_combination_holdout(assignments)
    user_leaks = audit_user_disjoint(assignments)
    meta = {
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "seed": args.seed,
        "n_plans": len(plans),
        "n_groups": args.n_groups,
        "n_terms": len(domain_terms),
        "n_carriers": len(carriers),
        "split_counts": {
            s: sum(1 for p in plans if p["split"] == s)
            for s in ("train", "validation", "test")
        },
        "user_leaks": user_leaks,
        "split_audit": leak,
        "lexicon_manifest": {
            "bundleVersion": lex_meta.get("bundleVersion"),
            "checksum": lex_meta.get("checksum"),
            "schemaVersion": lex_meta.get("schemaVersion"),
        },
        "carrier_version": CARRIER_VERSION,
        "note": "Splits assigned before generation; user-disjoint is hard gate.",
    }
    (out_dir / "probe_plan_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    if user_leaks:
        print("FAIL: user leakage", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
