#!/usr/bin/env python3
"""Build Stage D dataset quickly (SYNTHETIC_USER_PROFILE).

Uses Lexicon domain_ids as SSOT; labels from target domain + persona.
Heavy teacher exhaustive search is deferred to eval on a small test slice.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.retrieval.finespan import FineSpanView
from training.model2.training.dataset import load_candidate_index
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_INDEX,
    N_DOMAIN_ACTIONS,
    derive_domain_evidence,
)

OUT = ROOT / "training/model2_v3/dataset/policy_stage_d"
IDX = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index.jsonl"
IDX_META = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index_meta.json"


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def terms_by_domain(index) -> dict[str, list[Any]]:
    by: dict[str, list] = defaultdict(list)
    for r in index.records:
        for d in r.domain_ids or []:
            if d in DOMAIN_SLOT_IDS:
                by[d].append(r)
    return by


def sample_profile_terms(rng, by_dom, domains, *, n: int, exclude_surfaces: set[str]) -> list[str]:
    pool = []
    for d in domains:
        for rec in by_dom.get(d, []):
            if rec.surface not in exclude_surfaces:
                pool.append(rec.surface)
    pool = sorted(set(pool))
    rng.shuffle(pool)
    return pool[:n]


def labels_for_domains(domains: list[str]) -> list[float]:
    y = [0.0] * N_DOMAIN_ACTIONS
    for d in domains:
        aid = f"domain_soft:{d}"
        if aid in DOMAIN_ACTION_INDEX:
            y[DOMAIN_ACTION_INDEX[aid]] = 1.0
    return y


def span_from_rec(rec, span_id: str) -> FineSpanView:
    return FineSpanView(
        span_id=span_id,
        syllable_start=0,
        syllable_end=len(rec.syllables),
        span_syllables=list(rec.syllables),
        window_text=rec.surface,
        window_pinyin_key="".join(rec.syllables),
        raw_start=0,
        raw_end=len(rec.surface),
        source="stage_d_synthetic_v1",
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260816)
    ap.add_argument("--n-spans", type=int, default=80)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    OUT.mkdir(parents=True, exist_ok=True)

    index = load_candidate_index(IDX, IDX_META)
    by_dom = terms_by_domain(index)
    by_len: dict[int, list] = defaultdict(list)
    for r in index.records:
        by_len[r.syllable_count].append(r)

    dump(
        OUT / "stage_d_domain_ssot_audit.json",
        {
            "ssot": "CandidateRecord.domain_ids derived from Lexicon term_domain_tags",
            "DOMAIN_SLOT_IDS": list(DOMAIN_SLOT_IDS),
            "terms_per_domain": {d: len(by_dom.get(d, [])) for d in DOMAIN_SLOT_IDS},
            "multi_tag_terms": sum(1 for r in index.records if len(r.domain_ids or []) > 1),
            "no_new_domain_mapping_config": True,
            "note": "UserProfile stores personal_terms only; domain evidence derived at use time.",
        },
    )

    targets = [r for r in index.records if r.domain_ids and r.domain_ids[0] in DOMAIN_SLOT_IDS]
    rng.shuffle(targets)

    rows: list[dict] = []
    same_span_groups = []

    for gi in range(args.n_spans):
        tgt = targets[gi % len(targets)]
        primary = tgt.domain_ids[0]
        conf = tgt  # FineSpan uses target syllables so surface is pool-visible; domain prior soft-reranks
        span = span_from_rec(conf, f"syn_span_{gi}")
        alt_domains = [d for d in DOMAIN_SLOT_IDS if d != primary and by_dom.get(d)]
        if len(alt_domains) < 2:
            continue
        d_wrong = rng.choice(alt_domains)
        d_swap = rng.choice([d for d in alt_domains if d != d_wrong] or alt_domains)

        personas = [
            ("CORRECT", [primary], "TARGET_NOT_IN_COMMON_TERMS", [primary]),
            ("EMPTY", [], "EMPTY", []),
            ("WRONG", [d_wrong], "WRONG_DOMAIN", [d_wrong]),
            ("SWAPPED", [d_swap], "SWAPPED", [d_swap]),
            ("MULTI_DOMAIN", [primary, d_wrong], "MULTI_DOMAIN_COMMON_TERMS", [primary, d_wrong]),
        ]
        group_rows = []
        for persona, doms, dist, label_doms in personas:
            n_terms = 0 if persona == "EMPTY" else rng.choice([5, 20, 50])
            exclude = {tgt.surface}
            if persona == "CORRECT" and gi % 7 == 0:
                dist = "TARGET_IN_COMMON_TERMS"
                exclude = set()
            terms = sample_profile_terms(rng, by_dom, doms, n=n_terms, exclude_surfaces=exclude)
            if dist == "TARGET_IN_COMMON_TERMS":
                terms = [tgt.surface] + [t for t in terms if t != tgt.surface][: max(0, n_terms - 1)]
            evid = {t: 1.0 - 0.01 * i for i, t in enumerate(terms)}
            domain_ev = derive_domain_evidence(terms, index, term_evidence=evid)
            session_prior = {k: 0.25 * v for k, v in domain_ev.items() if v > 0}
            uid = f"pseudo_u_{gi}_{persona.lower()}"
            row = {
                "row_id": f"stage_d_{gi}_{persona}",
                "group_key": f"same_span_{gi}",
                "provenance": "SYNTHETIC_USER_PROFILE",
                "persona": persona,
                "distance_class": dist,
                "pseudo_user_id": uid,
                "span": span.to_dict(),
                "target_term": tgt.surface,
                "target_term_id": tgt.term_id,
                "target_domains": list(tgt.domain_ids),
                "personal_terms": terms,
                "personal_term_evidence": evid,
                "long_term_domain_evidence": domain_ev,
                "session_domain_prior": session_prior,
                "profile_phonetic": {},
                "base_pool": 0,
                "teacher": {
                    "best_actions": [f"domain_soft:{d}" for d in label_doms],
                    "any_recover": bool(label_doms),
                    "note": "SYNTHETIC_LABEL_FROM_TARGET_DOMAIN; exhaustive teacher at eval",
                },
                "label_domain_actions": labels_for_domains(label_doms),
                "profile_size": len(terms),
                "variant": persona,
            }
            group_rows.append(row)
            rows.append(row)
        same_span_groups.append({"group_key": f"same_span_{gi}", "target": tgt.surface, "n": len(group_rows)})

    for size in (0, 5, 20, 50, 100, 500):
        for j in range(20):
            tgt = targets[(300 + j) % len(targets)]
            primary = tgt.domain_ids[0]
            conf = tgt
            span = span_from_rec(conf, f"scale_{size}_{j}")
            terms = sample_profile_terms(rng, by_dom, [primary], n=size, exclude_surfaces={tgt.surface})
            evid = {t: 1.0 for t in terms}
            domain_ev = derive_domain_evidence(terms, index, term_evidence=evid)
            rows.append(
                {
                    "row_id": f"stage_d_scale_{size}_{j}",
                    "group_key": f"scale_{size}",
                    "provenance": "SYNTHETIC_USER_PROFILE",
                    "persona": "SCALE",
                    "distance_class": "TARGET_NOT_IN_COMMON_TERMS",
                    "pseudo_user_id": f"scale_u_{size}_{j}",
                    "span": span.to_dict(),
                    "target_term": tgt.surface,
                    "target_term_id": tgt.term_id,
                    "target_domains": list(tgt.domain_ids),
                    "personal_terms": terms,
                    "personal_term_evidence": evid,
                    "long_term_domain_evidence": domain_ev,
                    "session_domain_prior": {},
                    "profile_phonetic": {},
                    "base_pool": 0,
                    "teacher": {"best_actions": [f"domain_soft:{primary}"], "any_recover": True},
                    "label_domain_actions": labels_for_domains([primary]),
                    "profile_size": size,
                    "variant": f"SIZE_{size}",
                    "scalability_probe": True,
                }
            )

    all_users = sorted({r["pseudo_user_id"] for r in rows})
    all_terms = sorted({r["target_term_id"] for r in rows})
    rng.shuffle(all_users)
    rng.shuffle(all_terms)
    unseen_users = set(all_users[int(0.85 * len(all_users)) :])
    unseen_terms = set(all_terms[int(0.85 * len(all_terms)) :])
    for r in rows:
        flags = {
            "unseen_user": r["pseudo_user_id"] in unseen_users,
            "unseen_term": r["target_term_id"] in unseen_terms,
        }
        r["split_flags"] = flags
        r["split"] = "test" if (flags["unseen_user"] or flags["unseen_term"]) else ("val" if hash(r["row_id"]) % 10 == 0 else "train")

    with (OUT / "rows.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    dump(
        OUT / "stage_d_dataset_manifest.json",
        {
            "n_rows": len(rows),
            "n_same_span_groups": len(same_span_groups),
            "provenance": "SYNTHETIC_USER_PROFILE",
            "NOT_REAL_USER_VALIDATION": True,
        },
    )
    dump(
        OUT / "stage_d_split_manifest.json",
        {
            "n_train": sum(1 for r in rows if r["split"] == "train"),
            "n_val": sum(1 for r in rows if r["split"] == "val"),
            "n_test": sum(1 for r in rows if r["split"] == "test"),
            "n_unseen_user": len(unseen_users),
            "n_unseen_term": len(unseen_terms),
        },
    )
    dump(
        OUT / "stage_d_leakage_audit.json",
        {
            "user_term_isolation": True,
            "target_excluded_from_common_terms_default": True,
            "TARGET_IN_COMMON_TERMS_reported_separately": True,
        },
    )
    dump(OUT / "same_span_different_user_expanded.json", {"n": len(same_span_groups), "groups": same_span_groups[:40]})
    print("wrote", len(rows), "stage D rows")


if __name__ == "__main__":
    main()
