#!/usr/bin/env python3
"""Build full Model2TrainRowV1 for Stage B from pseudo_user_accent_scale_v1."""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.ambiguity.taxonomy import classify_ambiguity, fuzzy_ambiguity_score
from training.model2.model.condition_relation import (
    relation_features_for_pair,
    synthesize_observed_syllables,
)
from training.model2.candidates.index import build_candidate_index_from_sqlite
from training.model2.contract import (
    CONTEXT_CHAR_MAX,
    FEATURE_SCHEMA_VERSION,
    FUZZY_DISTANCE_THRESHOLD,
    FUZZY_POOL_MAX_CANDIDATES,
    INPUT_CONTRACT_VERSION,
    PERSONAL_TERMS_MAX,
    PHONETIC_FEATURE_INDEX_V1,
    PHONETIC_FEATURE_KEYS,
    SPAN_CHAR_MAX,
    SYL_VOCAB_VERSION,
)
from training.model2.corpus.lexicon_export import default_lexicon_paths, load_lexicon_snapshot_meta
from training.model2.encoding.char_hash import (
    encode_context_chars,
    encode_span_chars,
    normalize_chars,
)
from training.model2.encoding.char_hash import contract_meta as char_hash_meta
from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.export.train_row import (
    Model2TrainRowV1,
    default_contract_versions,
    make_trainrow_id,
)
from training.model2.export.training_sample import TrainingSampleV1
from training.model2.features.personal import domain_features_for_candidate, personal_features_for_candidate
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool, syllables_from_span
from training.model2.phonetic.syllables import levenshtein_syllables, text_to_syllables
from training.model2.stage_b.condition import (
    load_fidelity_weights,
    load_trainable_mask,
    profile_vectors_from_bias,
)


def _load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _split_context(local_context: str, span: str):
    if not span:
        return "", "", 0
    idx = local_context.find(span)
    if idx < 0:
        return "", "", 0
    left = local_context[max(0, idx - CONTEXT_CHAR_MAX) : idx]
    right = local_context[idx + len(span) : idx + len(span) + CONTEXT_CHAR_MAX]
    return left, right, idx


def _eligibility(sample: TrainingSampleV1) -> str:
    synth = sample.metadata.synthetic or {}
    if isinstance(synth, dict):
        elig = synth.get("eligibility_class")
        if elig:
            return str(elig)
        cp = synth.get("corruption_parameters") or {}
        if isinstance(cp, dict) and cp.get("eligibility_class"):
            return str(cp["eligibility_class"])
    return "UNKNOWN"


def _associated(sample: TrainingSampleV1) -> bool:
    synth = sample.metadata.synthetic or {}
    if isinstance(synth, dict):
        return bool(synth.get("associated_with_corruption"))
    return False


def _family(sample: TrainingSampleV1, plan: dict) -> Optional[str]:
    synth = sample.metadata.synthetic or {}
    fam = None
    if isinstance(synth, dict):
        fam = synth.get("corruption_family") or (synth.get("corruption_parameters") or {}).get("family")
    return fam or plan.get("family")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--in-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Default: <in-dir>/stage_b_trainrows",
    )
    ap.add_argument("--seed", type=int, default=20260814)
    args = ap.parse_args()
    in_dir = args.in_dir
    out_dir = args.out_dir or (in_dir / "stage_b_trainrows")
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)

    samples_raw = _load_jsonl(in_dir / "training_samples.jsonl")
    samples = [TrainingSampleV1.from_dict(x) for x in samples_raw]
    plans = {p["sample_plan_id"]: p for p in _load_jsonl(in_dir / "generation_plan.jsonl")}
    profiles = {p["pseudo_user_group_id"]: p for p in _load_jsonl(in_dir / "pseudo_user_profiles.jsonl")}
    users = {u["pseudo_user_id"]: u for u in _load_jsonl(in_dir / "pseudo_users.jsonl")}
    leakage = json.loads((in_dir / "leakage_audit.json").read_text(encoding="utf-8"))
    holdout_combos = set(leakage.get("feature_combination_holdout", {}).get("holdout_family_sets") or [])

    trainable_mask = load_trainable_mask(in_dir / "condition_supervision_matrix.json")
    fidelity_w = load_fidelity_weights(in_dir / "feature_fidelity_metrics.json")

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    lex_snap = f"sha256:{lex_meta.get('checksum')}"
    index = build_candidate_index_from_sqlite(paths["sqlite"], lex_snap, include_idiom=False)
    index.save_jsonl(out_dir / "candidate_index.jsonl")
    index.save_meta(out_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.build_from_syllables(s for r in index.records for s in r.syllables)
    vocab.save(out_dir / "syl-vocab-v1.json")

    # other-user bias pool for WP3 construction metadata
    other_biases = [
        dict(p.get("phonetic_bias") or {})
        for p in profiles.values()
        if p.get("phonetic_bias")
    ]

    rows: list[dict[str, Any]] = []
    stats = Counter()
    skipped = Counter()

    for s in samples:
        elig = _eligibility(s)
        kind = s.metadata.sample_kind.value
        synth = s.metadata.synthetic or {}
        if not isinstance(synth, dict):
            synth = {}

        # Eligibility gate for Stage B pronunciation supervision
        if elig in ("INELIGIBLE_ALIGNMENT", "INELIGIBLE_NON_TERM", "INELIGIBLE_REALIZATION"):
            # Keep provenance-only skip for model training
            skipped[elig] += 1
            continue
        if kind == "POSITIVE" and elig == "ELIGIBLE_PRONUNCIATION_POSITIVE":
            if not (_associated(s) and bool(synth.get("phonetic_profile_acoustically_realized") or True)):
                # Must be corruption-associated; acoustic realized preferred
                if not _associated(s):
                    skipped["pos_not_associated"] += 1
                    continue
        if kind == "POSITIVE" and elig not in (
            "ELIGIBLE_PRONUNCIATION_POSITIVE",
            "ELIGIBLE_NO_CHANGE",
            "ELIGIBLE_HARD_NEGATIVE",
            "UNKNOWN",
        ):
            skipped[f"pos_{elig}"] += 1
            continue

        spid = synth.get("audio_manifest_id") or ""
        plan = plans.get(spid) or {}
        if not plan:
            eid = s.metadata.correction_event_id or ""
            if eid.startswith("synth-event-"):
                plan = plans.get(eid[len("synth-event-") :]) or {}

        pseudo_id = (
            plan.get("pseudo_user_id")
            or synth.get("pseudo_user_id")
            or synth.get("pseudo_user_group_id")
            or ""
        )
        profile = profiles.get(pseudo_id) or {}
        user = users.get(pseudo_id) or {}
        phon_bias = dict(profile.get("phonetic_bias") or {})
        # Prefer snapshot from profile; fall back to user family_prob
        if not phon_bias and user.get("family_prob"):
            phon_bias = {k: float(v) for k, v in (user.get("family_prob") or {}).items() if float(v) > 0}

        span_text = s.input.source_span
        local = s.input.local_context or ""
        left, right, span_start = _split_context(local, span_text)
        if s.target.target_span and s.target.target_span in ((left or "") + (right or "")) and s.target.target_span != span_text:
            skipped["context_target_leak"] += 1
            continue

        syls = syllables_from_span(span_text, s.input.source_pinyin)
        planned_term = s.metadata.target_term
        preferred_domain = s.metadata.domain
        fam = _family(s, plan)
        strength = plan.get("intended_strength") or user.get("primary_strength")

        span_targets_term = bool(
            planned_term
            and (
                s.target.target_span == planned_term
                or planned_term in (s.target.target_span or "")
                or (s.target.target_span or "") in planned_term
            )
        )
        is_pron_pos = (
            kind == "POSITIVE"
            and elig == "ELIGIBLE_PRONUNCIATION_POSITIVE"
            and _associated(s)
        )
        is_no_change = kind == "POSITIVE" and elig == "ELIGIBLE_NO_CHANGE"
        is_term_positive = (
            kind == "POSITIVE"
            and span_targets_term
            and s.metadata.source_type.value != "RULE_SYNTHETIC"
        )
        # Pronunciation positives: target is GT term even if ASR span ≠ term surface
        if is_pron_pos and planned_term:
            is_term_positive = True

        target_rec = index.resolve_surface(planned_term or "", preferred_domain) if planned_term else None
        target_term_id = target_rec.term_id if target_rec else None
        target_oov = bool(is_term_positive and target_rec is None)

        req = FuzzyPoolRequestV1(
            span_text=span_text,
            span_syllables=syls,
            span_syllable_count=len(syls),
            max_pool_size=FUZZY_POOL_MAX_CANDIDATES,
            distance_threshold=FUZZY_DISTANCE_THRESHOLD,
            lexicon_snapshot_id=lex_snap,
        )
        pool = build_fuzzy_pool(index, req)

        # Ensure target in pool for pronunciation positives when possible
        if is_term_positive and planned_term and not pool.contains_surface(planned_term) and target_rec:
            # Soft: still record OOV/miss; pool frozen — do not mutate FuzzyPool rules
            stats["target_not_in_pool"] += 1

        personal_terms = list(profile.get("personal_terms") or [])[:PERSONAL_TERMS_MAX]
        pt_syl = {t: text_to_syllables(t) for t in personal_terms}
        pers_feats = []
        dom_feats = []
        for tid in pool.term_ids():
            rec = index.by_term_id[tid]
            pers_feats.append(personal_features_for_candidate(rec, personal_terms, pt_syl, top_n=PERSONAL_TERMS_MAX))
            dom_feats.append(domain_features_for_candidate(rec, preferred_domain))

        positive_idx = None
        if target_term_id and target_term_id in pool.term_ids():
            positive_idx = pool.term_ids().index(target_term_id)
        elif planned_term:
            for i, h in enumerate(pool.hits):
                if h.surface == planned_term:
                    positive_idx = i
                    target_term_id = h.term_id
                    break

        distances: list[Optional[int]] = []
        priors: list[float] = []
        cand_pys: list[list[str]] = []
        for tid in pool.term_ids():
            rec = index.by_term_id.get(tid)
            priors.append(float(rec.prior_score) if rec else 0.0)
            cand_pys.append(list(rec.syllables) if rec else [])
            if rec and syls:
                distances.append(levenshtein_syllables(syls, rec.syllables))
            else:
                distances.append(0)

        tgt_d = distances[positive_idx] if positive_idx is not None else None
        amb_score = fuzzy_ambiguity_score(
            target_distance=tgt_d, distances=distances, target_index=positive_idx
        )
        amb_class = None
        if is_term_positive:
            amb_class = classify_ambiguity(
                target_distance=tgt_d,
                distances=distances,
                target_index=positive_idx,
                span_syllables=syls,
                candidate_pinyins=cand_pys,
            )

        # CORRECT profile = real PseudoUserProfile snapshot (hard rule)
        correct = profile_vectors_from_bias(
            phon_bias, trainable_mask=trainable_mask, mode="correct"
        )
        # Known neutral users: values already empty; still mark available
        if user.get("is_neutral") or user.get("user_kind") == "neutral":
            correct = profile_vectors_from_bias({}, trainable_mask=trainable_mask, mode="neutral")

        # Inject profile-conditioned hard negative for pronunciation positives
        hn_tid = None
        hn_in_pool = False
        is_injected_hn = False
        sample_kind_out = kind
        if is_pron_pos and positive_idx is not None and len(pool.term_ids()) >= 2:
            # Prefer a distractor at small distance ≠ target
            cands = [
                (i, tid)
                for i, tid in enumerate(pool.term_ids())
                if i != positive_idx and distances[i] is not None and distances[i] <= 2
            ]
            if cands:
                i_hn, hn_tid = rng.choice(cands)
                hn_in_pool = True
                is_injected_hn = True
                stats["profile_hn_tagged"] += 1

        # Also emit a HARD_NEGATIVE sibling row occasionally
        emit_hn_row = False
        if is_pron_pos and hn_tid and rng.random() < 0.35:
            emit_hn_row = True

        split = plan.get("split") or user.get("split") or "train"
        combo_key = user.get("combination_key") or profile.get("combination_key") or "NONE"
        unseen_combo = combo_key in holdout_combos

        sup_w = 1.0
        if fam and fam in fidelity_w:
            sup_w = float(fidelity_w[fam])

        trainrow_id = make_trainrow_id(s.sample_id)
        row = Model2TrainRowV1(
            sample_id=s.sample_id,
            trainrow_id=trainrow_id,
            sample_kind=sample_kind_out,
            source_type=s.metadata.source_type.value,
            split=split,
            span_text=span_text,
            span_char_ids=encode_span_chars(span_text),
            span_len=min(len(normalize_chars(span_text)), SPAN_CHAR_MAX),
            syllable_ids=vocab.encode(syls),
            syllable_count=len(syls),
            span_syllables=syls,
            left_context=left,
            right_context=right,
            left_char_ids=encode_context_chars(left),
            right_char_ids=encode_context_chars(right),
            relative_position=float(span_start or 0) / float(max(1, len(local))),
            phonetic_condition=correct["phonetic_condition"],
            phonetic_mask=correct["phonetic_mask"],
            tone_condition=correct["tone_condition"],
            tone_mask=correct["tone_mask"],
            domain_prior=correct["domain_prior"],
            domain_mask=correct["domain_mask"],
            profile_available=int(correct["profile_available"]),
            personal_term_count=min(len(personal_terms), PERSONAL_TERMS_MAX),
            phonetic_profile_acoustically_realized=int(
                correct["phonetic_profile_acoustically_realized"]
            ),
            fuzzy_pool_term_ids=pool.term_ids(),
            target_term_id=target_term_id,
            target_in_pool=positive_idx is not None,
            target_oov=target_oov,
            candidate_personal_features=pers_feats,
            candidate_domain_features=dom_feats,
            positive_pool_index=positive_idx,
            self_span_as_negative_anchor=(kind == "NEGATIVE" or is_no_change),
            hard_negative_term_id=hn_tid,
            hard_negative_in_pool=hn_in_pool,
            is_injected_hard_negative=is_injected_hn,
            positive_bucket=("TERM_POSITIVE" if is_term_positive else None),
            is_term_positive=is_term_positive,
            ignored_for_model2_recall=False,
            ambiguity_class=amb_class,
            fuzzy_ambiguity_score=amb_score if is_term_positive else None,
            provenance={
                "pseudo_user_id": pseudo_id,
                "eligibility_class": elig,
                "corruption_family": fam,
                "intended_strength": strength,
                "backend": plan.get("backend") or (synth.get("corruption_parameters") or {}).get("backend"),
                "user_kind": user.get("user_kind"),
                "combination_key": combo_key,
                "unseen_feature_combo": unseen_combo,
                "synthetic_independent_combination": bool(
                    user.get("synthetic_independent_combination")
                    or profile.get("synthetic_independent_combination")
                ),
                "associated_with_corruption": _associated(s),
                "ground_truth_text": synth.get("ground_truth_text"),
                "tts_input_text": synth.get("tts_input_text"),
                "condition_supervision_weight": sup_w,
                "phonetic_bias_snapshot": phon_bias,
                "profile_mode": "correct",
            },
            contract_versions={
                **default_contract_versions(),
                "char_hash_version": char_hash_meta()["version"],
                "syl_vocab_version": SYL_VOCAB_VERSION,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "input_contract_version": INPUT_CONTRACT_VERSION,
                "phonetic_feature_index": "PHONETIC_FEATURE_INDEX_V1",
            },
        )
        drow = row.to_dict()
        drow["fuzzy_pool_distances"] = distances
        drow["fuzzy_pool_priors"] = priors
        drow["eligibility_class"] = elig
        drow["corruption_family"] = fam
        drow["intended_strength"] = strength
        drow["pseudo_user_id"] = pseudo_id
        drow["user_kind"] = user.get("user_kind")
        drow["combination_key"] = combo_key
        drow["unseen_feature_combo"] = unseen_combo
        drow["condition_supervision_weight"] = sup_w
        drow["is_pronunciation_positive"] = is_pron_pos
        drow["is_no_change"] = is_no_change
        drow["backend"] = drow["provenance"].get("backend")
        drow["phonetic_bias_snapshot"] = phon_bias
        # Phase 7A: keep canonical / observed / candidate syllable semantics separate
        can_raw = plan.get("canonical_syllables") or []
        canonical_compact: list[str] = []
        for item in can_raw:
            if isinstance(item, dict):
                ini = item.get("initial") or ""
                fin = item.get("final") or ""
                tone = item.get("tone")
                tone_s = "" if tone in (None, 0, "0") else str(tone)
                canonical_compact.append(f"{ini}{fin}{tone_s}")
            else:
                canonical_compact.append(str(item))
        if not canonical_compact and target_rec is not None:
            canonical_compact = list(target_rec.syllables or [])
        observed_rel = (
            synthesize_observed_syllables(canonical_compact, fam)
            if is_pron_pos and fam
            else list(canonical_compact or syls)
        )
        drow["canonical_syllables"] = canonical_compact
        drow["observed_syllables_for_relation"] = observed_rel
        drow["observed_syllables"] = observed_rel  # alias used by relation helper
        if is_pron_pos and fam and positive_idx is not None and target_rec is not None:
            rel_vec = relation_features_for_pair(observed_rel, list(target_rec.syllables or []))
            fi = PHONETIC_FEATURE_INDEX_V1.get(fam)
            hit = fi is not None and rel_vec[fi] > 1e-6
            drow["target_relation_valid"] = bool(hit)
            stats["relation_checked"] += 1
            if hit:
                stats["relation_consistent"] += 1
            else:
                stats["relation_inconsistent"] += 1
        rows.append(drow)
        stats[elig] += 1
        stats[f"kind_{kind}"] += 1
        if is_pron_pos:
            stats["pronunciation_positive"] += 1
        if is_no_change:
            stats["no_change"] += 1
        if is_term_positive and positive_idx is not None:
            stats["term_pos_in_pool"] += 1

        if emit_hn_row and hn_tid:
            hn_row = dict(drow)
            hn_row["sample_kind"] = "HARD_NEGATIVE"
            hn_row["trainrow_id"] = make_trainrow_id(s.sample_id + "-hn")
            hn_row["is_injected_hard_negative"] = True
            hn_row["hard_negative_term_id"] = hn_tid
            hn_row["hard_negative_in_pool"] = True
            hn_row["positive_pool_index"] = None
            hn_row["is_term_positive"] = False
            hn_row["is_pronunciation_positive"] = False
            hn_row["eligibility_class"] = "ELIGIBLE_HARD_NEGATIVE"
            rows.append(hn_row)
            stats["hard_negative_emitted"] += 1

    # Write
    with (out_dir / "model2_train_rows.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Copy samples path reference
    manifest = {
        "dataset_id": "model2-stage-b-accent-trainrows-v1",
        "source_dataset": str(in_dir),
        "n_rows": len(rows),
        "stats": dict(stats),
        "skipped": dict(skipped),
        "phonetic_feature_index_v1": dict(PHONETIC_FEATURE_INDEX_V1),
        "phonetic_feature_keys": list(PHONETIC_FEATURE_KEYS),
        "trainable_phonetic_mask": trainable_mask,
        "fidelity_supervision_weights": fidelity_w,
        "fuzzy_pool": {
            "max_candidates": FUZZY_POOL_MAX_CANDIDATES,
            "distance_threshold": FUZZY_DISTANCE_THRESHOLD,
        },
        "markers": (
            ["MODEL2_BASELINE_V1", "NOT_FOR_RUNTIME", "NOT_FROZEN"]
            if "baseline" in str(in_dir).lower()
            else ["STAGE_B_PROBE_ONLY", "NOT_FOR_RUNTIME", "NOT_FROZEN"]
        ),
        "profile_contracts": {
            "PROFILE_UNAVAILABLE": "phonetic_mask=0 (no personalization)",
            "PROFILE_NEUTRAL": "phonetic_mask=1 + values=0 (known NONE)",
            "CORRECT_PROFILE": "real PseudoUserProfile.phonetic_bias snapshot",
        },
    }
    (out_dir / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    checked = int(stats.get("relation_checked") or 0)
    consistent = int(stats.get("relation_consistent") or 0)
    rel_cons = {
        "TargetRelationConsistencyRate": (consistent / checked) if checked else None,
        "n_checked": checked,
        "n_consistent": consistent,
        "n_inconsistent": int(stats.get("relation_inconsistent") or 0),
        "note": "active pronunciation positives: observed_syllables_for_relation recovers family on target",
    }
    (out_dir.parent / "relation_consistency.json").write_text(
        json.dumps(rel_cons, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "relation_consistency.json").write_text(
        json.dumps(rel_cons, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    manifest["relation_consistency"] = rel_cons
    (out_dir / "phonetic_feature_index_v1.json").write_text(
        json.dumps(
            {"keys": list(PHONETIC_FEATURE_KEYS), "index": dict(PHONETIC_FEATURE_INDEX_V1)},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
