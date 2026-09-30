#!/usr/bin/env python3
"""Build PseudoUser Accent Scale V1 plan (~3k utterances) BEFORE TTS/ASR."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.candidates.index import build_candidate_index_from_sqlite
from training.model2.constants import DEFAULT_TTS_VOICE, GENERATOR_VERSION
from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.corpus.lexicon_export import (
    default_lexicon_paths,
    export_base_background,
    export_domain_terms,
    load_lexicon_snapshot_meta,
    write_jsonl,
)
from training.model2.phonetic.syllables import syllables_from_text_tone_num
from training.model2.pronunciation.behaviour import STRENGTH_TO_PROB, should_apply_corruption
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable
from training.model2.pronunciation.scale_users import (
    FINAL_FAMILIES,
    INITIAL_FAMILIES,
    build_scale_accent_users,
    feature_combination_holdout_keys,
)
from training.model2.pronunciation.transform_engine import PronunciationTransformEngineV1, decide_positions
from training.model2.splits.assign import SplitAssignment, audit_term_combination_holdout, audit_user_disjoint

DATASET_ID = "model2-pseudo-user-accent-scale-v1"
CARRIER_VERSION = "carrier_templates_v2"
BASELINE_DATASET_ID = "model2-baseline-dataset-v1"
BASELINE_CARRIER_VERSION = "carrier_templates_v3"


def _load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def plan_id_for(**fields) -> str:
    material = json.dumps(fields, ensure_ascii=False, sort_keys=True)
    h = hashlib.sha256(material.encode()).hexdigest()[:20]
    return f"acc-{h}"


def term_syllables(term: str, pinyin_key: str | None) -> list[PronunciationSyllable]:
    toned = syllables_from_text_tone_num(term) or []
    out = [PronunciationSyllable.from_compact(x) for x in toned]
    out = [x for x in out if x]
    if out and len(out) == len(term):
        return out
    # fallback: split pinyin_key
    if pinyin_key:
        parts = [p for p in pinyin_key.replace("|", " ").split() if p]
        alt = [PronunciationSyllable.from_compact(p) for p in parts]
        alt = [x for x in alt if x]
        if alt:
            return alt
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260813)
    ap.add_argument("--n-users", type=int, default=200)
    ap.add_argument("--target-utterances", type=int, default=3000)
    ap.add_argument("--utterances-per-user", type=int, default=15)
    ap.add_argument("--paired-control-frac", type=float, default=0.15)
    ap.add_argument("--term-len-min", type=int, default=2)
    ap.add_argument("--term-len-max", type=int, default=3)
    ap.add_argument("--base-term-limit", type=int, default=400)
    ap.add_argument("--carrier-version", type=str, default=CARRIER_VERSION)
    ap.add_argument("--dataset-id", type=str, default=DATASET_ID)
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1",
    )
    args = ap.parse_args()
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset_id = args.dataset_id
    carrier_version = args.carrier_version

    carriers = _load_jsonl(REPO_ROOT / f"training/model2/corpus/{carrier_version}.jsonl")
    term_carriers = [c for c in carriers if "{TERM}" in c["template"]]
    min_carriers = 100 if "v3" in carrier_version else 50
    assert len(term_carriers) >= min_carriers, (carrier_version, len(term_carriers))

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    snap = f"sha256:{lex_meta.get('checksum') or lex_meta.get('bundleVersion')}"
    index = build_candidate_index_from_sqlite(paths["sqlite"], snap, include_idiom=False)
    domain_terms = export_domain_terms(paths["sqlite"])
    base_terms = export_base_background(paths["sqlite"], limit=args.base_term_limit)
    uniq: dict[str, dict] = {}
    for t in domain_terms + base_terms:
        term = t.get("term") or t.get("word")
        if not term:
            continue
        if not (args.term_len_min <= len(term) <= args.term_len_max):
            continue
        row = dict(t)
        row["term"] = term
        uniq.setdefault(term, row)
    terms = list(uniq.values())
    write_jsonl(out_dir / "lexicon_candidate_terms.jsonl", terms)

    engine = PronunciationTransformEngineV1()
    # Mine terms applicable per family
    fam_terms: dict[str, list[dict]] = defaultdict(list)
    for t in terms:
        syls = term_syllables(t["term"], t.get("pinyin_key") or t.get("tone_pinyin_key"))
        if not syls:
            continue
        t = {**t, "_syllables": [s.to_dict() for s in syls]}
        for fam in PHONETIC_FEATURE_KEYS:
            if any(engine.applicable(s, fam) for s in syls):
                fam_terms[fam].append(t)
    mine_stats = {f: len(v) for f, v in fam_terms.items()}
    (out_dir / "term_mining_stats.json").write_text(
        json.dumps({"by_family": mine_stats, "n_terms": len(terms)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    domains = sorted(
        {
            (t.get("domain_tags") or t.get("domain_ids") or ["general"])[0]
            for t in terms
        }
    ) or ["general"]
    users = build_scale_accent_users(seed=args.seed, n_total=args.n_users, domains=domains)
    holdout = feature_combination_holdout_keys(users)
    write_jsonl(out_dir / "pseudo_users.jsonl", [u.to_dict() for u in users])
    write_jsonl(
        out_dir / "pseudo_user_profiles.jsonl",
        [
            {
                **u.profile.to_user_profile().to_dict(),
                "split": u.split,
                "user_kind": u.user_kind,
                "combination_key": u.combination_key,
                "synthetic_independent_combination": u.synthetic_independent_combination,
            }
            for u in users
        ],
    )

    # Term primary split for term-disjoint
    term_split: dict[str, str] = {}
    for t in terms:
        b = int(hashlib.sha256(f"{args.seed}|term|{t['term']}".encode()).hexdigest()[:8], 16) % 10
        term_split[t["term"]] = "train" if b <= 6 else ("validation" if b <= 8 else "test")

    plans: list[dict] = []
    paired_plans: list[dict] = []
    skipped = Counter()
    per_user_count: Counter = Counter()

    # Prefer matching user split with term split when possible
    for user in users:
        n_u = args.utterances_per_user
        active = list(user.profile.family_prob.keys())
        for j in range(n_u):
            if len(plans) >= args.target_utterances:
                break
            if user.user_kind == "neutral" or user.profile.is_neutral or not active:
                fam = PHONETIC_FEATURE_KEYS[
                    int(hashlib.sha256(f"{args.seed}|{user.profile.pseudo_user_id}|{j}|nf".encode()).hexdigest()[:8], 16)
                    % len(PHONETIC_FEATURE_KEYS)
                ]
                apply_corruption = False
                strength = "NONE"
                prob = 0.0
            else:
                fam = active[
                    int(hashlib.sha256(f"{args.seed}|{user.profile.pseudo_user_id}|{j}|fam".encode()).hexdigest()[:8], 16)
                    % len(active)
                ]
                strength = user.profile.family_strength.get(fam, "NONE")
                prob = float(user.profile.family_prob.get(fam, 0.0))
                apply_corruption = True  # decision refined below with positions

            pool = fam_terms.get(fam) or []
            if not pool:
                skipped["no_terms"] += 1
                continue
            # Prefer terms in same split as user
            same = [t for t in pool if term_split.get(t["term"]) == user.split]
            use_pool = same if same else pool
            ti = int(hashlib.sha256(f"{args.seed}|{user.profile.pseudo_user_id}|{j}|term".encode()).hexdigest()[:8], 16) % len(use_pool)
            term_rec = use_pool[ti]
            term = term_rec["term"]
            syl_dicts = term_rec.get("_syllables") or []
            cans = [PronunciationSyllable(**{k: v for k, v in d.items() if k in ("initial", "final", "tone", "lexical_status")}) for d in syl_dicts]
            if not cans:
                cans = term_syllables(term, term_rec.get("pinyin_key"))
            if not cans:
                skipped["no_syl"] += 1
                continue

            carrier = term_carriers[
                int(hashlib.sha256(f"{args.seed}|{user.profile.pseudo_user_id}|{j}|car".encode()).hexdigest()[:8], 16)
                % len(term_carriers)
            ]
            gt = carrier["template"].replace("{TERM}", term)
            if gt.count(term) != 1:
                skipped["context_leak"] += 1
                continue
            # context leak: term also in carrier template text
            ctx = carrier["template"].replace("{TERM}", "")
            if term and term in ctx:
                skipped["context_leak"] += 1
                continue

            applicable = [i for i, s in enumerate(cans) if engine.applicable(s, fam)]
            if not applicable and apply_corruption:
                skipped["not_applicable"] += 1
                continue

            provisional = plan_id_for(
                uid=user.profile.pseudo_user_id, j=j, term=term, fam=fam, seed=args.seed
            )
            mask = [False] * len(cans)
            if apply_corruption and applicable and prob > 0:
                mask = decide_positions(
                    n=len(cans),
                    applicable_idxs=applicable,
                    probability=prob,
                    seed=args.seed,
                    user_id=user.profile.pseudo_user_id,
                    plan_id=provisional,
                    family=fam,
                )
            selected = [i for i, m in enumerate(mask) if m]
            will_corrupt = bool(selected)

            # paired control sampling
            is_paired_control = False
            u = (int(hashlib.sha256(f"{args.seed}|pair|{provisional}".encode()).hexdigest()[:8], 16) % 1000) / 1000.0
            if u < args.paired_control_frac:
                is_paired_control = True

            spid = plan_id_for(
                uid=user.profile.pseudo_user_id,
                j=j,
                term=term,
                fam=fam if will_corrupt else "NONE",
                corr=will_corrupt,
                seed=args.seed,
            )
            domain = (term_rec.get("domain_tags") or term_rec.get("domain_ids") or ["general"])[0]
            row = {
                "sample_plan_id": spid,
                "pseudo_user_id": user.profile.pseudo_user_id,
                "pseudo_user_group_id": user.profile.pseudo_user_id,
                "user_kind": user.user_kind,
                "split": user.split,
                "term_split": term_split.get(term, "train"),
                "gt_text": gt,
                "target_term": term,
                "pinyin_key": term_rec.get("pinyin_key"),
                "canonical_syllables": [s.to_dict() for s in cans],
                "domain": domain,
                "carrier_id": carrier.get("carrier_id"),
                "family": fam,
                "intended_strength": strength if apply_corruption else "NONE",
                "intended_prob": prob if apply_corruption else 0.0,
                "applicable_positions": applicable,
                "selected_positions": selected,
                "corruption_planned": will_corrupt,
                "is_paired_control": is_paired_control,
                "force_phoneme": fam in ("n_l",) and "nai" in (term_rec.get("pinyin_key") or ""),
                "tts_voice": DEFAULT_TTS_VOICE,
                "seed": args.seed,
                "generator_version": GENERATOR_VERSION,
                "combination_key": user.combination_key,
                "synthetic_independent_combination": user.synthetic_independent_combination,
                "family_group": "initial" if fam in INITIAL_FAMILIES else "final",
            }
            plans.append(row)
            per_user_count[user.profile.pseudo_user_id] += 1
            if is_paired_control:
                paired_plans.append(
                    {
                        **row,
                        "pair_id": f"pair-{spid}",
                        "note": "same GT/carrier/voice; compare canonical vs corrupted",
                    }
                )
        if len(plans) >= args.target_utterances:
            break

    # Leakage audits
    assignments = [
        SplitAssignment(
            sample_plan_id=p["sample_plan_id"],
            split=p["split"],
            pseudo_user_group_id=p["pseudo_user_id"],
            target_term=p["target_term"],
        )
        for p in plans
    ]
    user_leaks = audit_user_disjoint(assignments)
    combo_audit = audit_term_combination_holdout(assignments)
    leakage = {
        "user_leaks": user_leaks,
        "term_combo_audit": {
            "n_term_overlap_train_val": len(combo_audit["term_overlap_train_val"]),
            "n_term_overlap_train_test": len(combo_audit["term_overlap_train_test"]),
            "n_combo_overlap_train_val": len(combo_audit["combo_overlap_train_val"]),
            "n_combo_overlap_train_test": len(combo_audit["combo_overlap_train_test"]),
        },
        "feature_combination_holdout": holdout,
        "split_counts": dict(Counter(p["split"] for p in plans)),
        "user_kind_counts": dict(Counter(u.user_kind for u in users)),
    }
    if user_leaks:
        raise RuntimeError(f"user split leaks: {user_leaks}")

    write_jsonl(out_dir / "generation_plan.jsonl", plans)
    write_jsonl(out_dir / "paired_plan.jsonl", paired_plans)
    (out_dir / "leakage_audit.json").write_text(json.dumps(leakage, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "split_manifest.json").write_text(
        json.dumps(
            {
                "policy": "user-disjoint primary; term-prefer matching; combo holdout on multi-feature",
                "users": {u.profile.pseudo_user_id: u.split for u in users},
                "n_plans": len(plans),
                "n_paired_control": len(paired_plans),
                **leakage,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    manifest = {
        "dataset_id": dataset_id,
        "generator_version": GENERATOR_VERSION,
        "carrier_version": carrier_version,
        "n_carriers_term": len(term_carriers),
        "n_terms_mined": len(terms),
        "term_len_range": [args.term_len_min, args.term_len_max],
        "base_term_limit": args.base_term_limit,
        "n_users": len(users),
        "n_plans": len(plans),
        "n_corrupted_planned": sum(1 for p in plans if p["corruption_planned"]),
        "n_control_planned": sum(1 for p in plans if not p["corruption_planned"]),
        "n_paired_control": len(paired_plans),
        "by_family_planned": dict(Counter(p["family"] for p in plans if p["corruption_planned"])),
        "by_strength_planned": dict(Counter(p["intended_strength"] for p in plans)),
        "by_carrier": dict(Counter(p.get("carrier_id") for p in plans)),
        "unique_carriers_used": len({p.get("carrier_id") for p in plans}),
        "skipped": dict(skipped),
        "strength_to_prob": STRENGTH_TO_PROB,
        "markers": (
            ["MODEL2_BASELINE_V1", "NOT_FOR_RUNTIME", "NOT_FROZEN"]
            if "baseline" in dataset_id
            else ["PSEUDO_USER_ACCENT_SCALE", "NOT_FOR_RUNTIME", "NOT_FROZEN"]
        ),
        "tone_diagnostic": "OPTIONAL_DEFER",
    }
    (out_dir / "plan_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
