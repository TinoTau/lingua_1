#!/usr/bin/env python3
"""Build pronunciation-corrupted probe plan (users first, then utterances)."""

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

from training.model2.candidates.index import build_candidate_index_from_sqlite
from training.model2.constants import DEFAULT_TTS_VOICE, GENERATOR_VERSION
from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.corpus.lexicon_export import (
    default_lexicon_paths,
    export_domain_terms,
    load_lexicon_snapshot_meta,
    write_jsonl,
)
from training.model2.pronunciation.behaviour import (
    STRENGTH_TO_PROB,
    build_pronunciation_users,
    should_apply_corruption,
)
from training.model2.pronunciation.corruptor import PronunciationCorruptorV1
from training.model2.pronunciation.tts_surface_resolver import TtsPronunciationSurfaceMapV1
from training.model2.splits.assign import SplitAssignment, assign_split_for_keys, audit_user_disjoint

DATASET_ID = "model2-pronunciation-corrupted-probe-v1"
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
    return f"p5d-{h}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260813)
    ap.add_argument("--n-users", type=int, default=30)
    ap.add_argument("--n-neutral", type=int, default=5)
    ap.add_argument("--utterances-per-user", type=int, default=10)
    ap.add_argument("--target-plans", type=int, default=350)
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pronunciation_corrupted_probe_v1",
    )
    ap.add_argument(
        "--surface-map",
        type=Path,
        default=None,
    )
    args = ap.parse_args()
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    surface_path = args.surface_map or (out_dir / "surface_map.json")
    surface_map = (
        TtsPronunciationSurfaceMapV1.load(surface_path)
        if surface_path.exists()
        else TtsPronunciationSurfaceMapV1()
    )
    corruptor = PronunciationCorruptorV1(surface_map)

    carriers = _load_jsonl(REPO_ROOT / "training/model2/corpus/carrier_templates_v2.jsonl")
    term_carriers = [c for c in carriers if "{TERM}" in c["template"]]
    assert term_carriers, "need term carriers"

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    snap = f"sha256:{lex_meta.get('checksum') or lex_meta.get('bundleVersion')}"
    index = build_candidate_index_from_sqlite(paths["sqlite"], snap, include_idiom=False)
    domain_terms = export_domain_terms(paths["sqlite"])
    uniq: dict[str, dict] = {}
    for t in domain_terms:
        uniq.setdefault(t["term"], t)
    domain_terms = list(uniq.values())

    # Precompute realizable (term, family) pairs
    realizable: list[tuple[dict, str]] = []
    unrealizable_examples: list[dict] = []
    for t in domain_terms:
        term = t["term"]
        if not (2 <= len(term) <= 5):
            continue
        raw_py = t.get("pinyin") or t.get("raw_pinyin")
        fams = corruptor.applicable_families(term, raw_py)
        for fam in fams:
            # dry-run corrupt with dummy carrier to check surface
            gt = f"请确认{term}"
            plan = corruptor.corrupt(
                ground_truth_text=gt,
                ground_truth_term=term,
                family=fam,
                raw_pinyin=raw_py,
                max_positions=2,
            )
            if plan.realizable and plan.tts_input_text != plan.ground_truth_text:
                realizable.append((t, fam))
            elif not plan.realizable and len(unrealizable_examples) < 40:
                unrealizable_examples.append(
                    {
                        "term": term,
                        "family": fam,
                        "reason": plan.unrealizable_reason,
                        "intended": plan.intended_corrupted_syllables,
                    }
                )

    by_family = Counter(f for _, f in realizable)
    print(json.dumps({"realizable_pairs": len(realizable), "by_family": dict(by_family)}, ensure_ascii=False))

    domains = sorted({(t.get("domain_ids") or ["general"])[0] for t, _ in realizable}) or ["general"]
    users = build_pronunciation_users(
        n_users=args.n_users,
        n_neutral=args.n_neutral,
        seed=args.seed,
        families=tuple(PHONETIC_FEATURE_KEYS),
        domains=domains,
    )
    write_jsonl(out_dir / "pseudo_users.jsonl", [u.to_dict() for u in users])
    write_jsonl(
        out_dir / "pseudo_user_profiles.jsonl",
        [u.to_user_profile().to_dict() for u in users],
    )

    # Index realizable by family for sampling
    fam_to_terms: dict[str, list[dict]] = {}
    for t, fam in realizable:
        fam_to_terms.setdefault(fam, []).append(t)

    plans: list[dict] = []
    pronunciation_plans: list[dict] = []
    skipped = Counter()

    for user in users:
        active_fams = list(user.family_prob.keys()) if not user.is_neutral else []
        # Neutral users: still generate utterances but WITHOUT corruption (control)
        for j in range(args.utterances_per_user):
            if len(plans) >= args.target_plans:
                break
            # Choose family: for biased users prefer their families; else any realizable
            if active_fams:
                fam = active_fams[
                    int(hashlib.sha256(f"{args.seed}|{user.pseudo_user_id}|{j}|fam".encode()).hexdigest()[:8], 16)
                    % len(active_fams)
                ]
            else:
                # control: pick any family term but do NOT corrupt
                fam = list(fam_to_terms.keys())[
                    int(hashlib.sha256(f"{args.seed}|{user.pseudo_user_id}|{j}|nf".encode()).hexdigest()[:8], 16)
                    % max(1, len(fam_to_terms))
                ] if fam_to_terms else None
            if not fam or fam not in fam_to_terms or not fam_to_terms[fam]:
                skipped["no_terms_for_family"] += 1
                continue
            pool = fam_to_terms[fam]
            ti = int(hashlib.sha256(f"{args.seed}|{user.pseudo_user_id}|{j}|term".encode()).hexdigest()[:8], 16) % len(pool)
            term_rec = pool[ti]
            term = term_rec["term"]
            raw_py = term_rec.get("pinyin") or term_rec.get("raw_pinyin")
            carrier = term_carriers[
                int(hashlib.sha256(f"{args.seed}|{user.pseudo_user_id}|{j}|car".encode()).hexdigest()[:8], 16)
                % len(term_carriers)
            ]
            gt_text = carrier["template"].replace("{TERM}", term)
            if gt_text.count(term) != 1:
                skipped["context_leak"] += 1
                continue

            apply = False
            if not user.is_neutral and fam in user.family_prob:
                # provisional plan id for bernoulli
                provisional = plan_id_for(
                    uid=user.pseudo_user_id, j=j, term=term, fam=fam, seed=args.seed
                )
                apply = should_apply_corruption(
                    user=user, family=fam, sample_plan_id=provisional, seed=args.seed
                )

            if apply:
                cplan = corruptor.corrupt(
                    ground_truth_text=gt_text,
                    ground_truth_term=term,
                    family=fam,
                    raw_pinyin=raw_py,
                    max_positions=2,
                )
                if not cplan.realizable:
                    skipped["unrealizable_at_plan"] += 1
                    continue
                tts_input = cplan.tts_input_text
                corrupted = True
            else:
                # No corruption this utterance (still under this user profile)
                cplan = None
                tts_input = gt_text
                corrupted = False
                skipped["no_apply_bern"] += int(not user.is_neutral)

            spid = plan_id_for(
                uid=user.pseudo_user_id,
                j=j,
                term=term,
                fam=fam if corrupted else "NONE",
                tts=tts_input,
                seed=args.seed,
            )
            domain = (term_rec.get("domain_ids") or ["general"])[0]
            row = {
                "sample_plan_id": spid,
                "pseudo_user_id": user.pseudo_user_id,
                "pseudo_user_group_id": user.pseudo_user_id,
                "is_neutral_user": user.is_neutral,
                "gt_text": gt_text,
                "tts_input_text": tts_input,
                "target_term": term,
                "pinyin_key": term_rec.get("pinyin_key") or raw_py,
                "domain": domain,
                "corruption_applied": corrupted,
                "corruption_family": fam if corrupted else None,
                "corruption_direction": fam if corrupted else None,
                "target_original_syllables": (cplan.target_original_syllables if cplan else []),
                "intended_corrupted_syllables": (cplan.intended_corrupted_syllables if cplan else []),
                "tts_surface": (cplan.tts_surface if cplan else term),
                "tts_surface_resolution_method": (
                    cplan.tts_surface_resolution_method if cplan else "identity"
                ),
                "tts_surface_resolver_version": surface_map.version,
                "family_strength": user.family_strength.get(fam) if corrupted else None,
                "family_prob": user.family_prob.get(fam, 0.0),
                "pseudo_profile": user.to_user_profile().to_dict(),
                "tts_voice": DEFAULT_TTS_VOICE,
                "seed": args.seed,
                "generator_version": GENERATOR_VERSION,
                "source_type": "TTS_PRONUNCIATION_CORRUPTED" if corrupted else "TTS_ASR_SYNTHETIC",
                "note": "control_no_corruption" if not corrupted else "pronunciation_corrupted",
            }
            plans.append(row)
            if corrupted and cplan:
                pronunciation_plans.append({**cplan.to_dict(), "sample_plan_id": spid, **row})

        if len(plans) >= args.target_plans:
            break

    # Assign splits by user (user-disjoint)
    assignments: list[SplitAssignment] = []
    for p in plans:
        split = assign_split_for_keys(
            pseudo_user_group_id=p["pseudo_user_id"],
            target_term=p["target_term"],
            seed=args.seed,
        )
        p["split"] = split
        assignments.append(
            SplitAssignment(
                sample_plan_id=p["sample_plan_id"],
                split=split,
                pseudo_user_group_id=p["pseudo_user_id"],
                target_term=p["target_term"],
            )
        )
    user_leaks = audit_user_disjoint(assignments)
    if user_leaks:
        raise RuntimeError(f"user split leaks: {user_leaks}")

    write_jsonl(out_dir / "plan.jsonl", plans)
    write_jsonl(out_dir / "pronunciation_plan.jsonl", pronunciation_plans)
    (out_dir / "unrealizable_examples.json").write_text(
        json.dumps(unrealizable_examples, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    manifest = {
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "carrier_version": CARRIER_VERSION,
        "n_plans": len(plans),
        "n_corrupted": sum(1 for p in plans if p["corruption_applied"]),
        "n_control": sum(1 for p in plans if not p["corruption_applied"]),
        "n_users": len(users),
        "n_neutral": args.n_neutral,
        "realizable_pairs": len(realizable),
        "by_family_realizable": dict(by_family),
        "skipped": dict(skipped),
        "strength_to_prob": STRENGTH_TO_PROB,
        "markers": ["PRONUNCIATION_CORRUPTED_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
        "tone_corruption": "DEFERRED",
    }
    (out_dir / "plan_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
