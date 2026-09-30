#!/usr/bin/env python3
"""Evaluate pronunciation-corrupted probe: realization, ambiguity, source comparison."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.ambiguity.taxonomy import classify_ambiguity, fuzzy_ambiguity_score
from training.model2.candidates.index import build_candidate_index_from_sqlite
from training.model2.contract import (
    FEATURE_SCHEMA_VERSION,
    FUZZY_DISTANCE_THRESHOLD,
    FUZZY_POOL_MAX_CANDIDATES,
    INPUT_CONTRACT_VERSION,
    PERSONAL_TERMS_MAX,
    PHONETIC_FEATURE_KEYS,
    SPAN_CHAR_MAX,
)
from training.model2.corpus.lexicon_export import default_lexicon_paths, load_lexicon_snapshot_meta
from training.model2.encoding.char_hash import encode_context_chars, encode_span_chars, normalize_chars
from training.model2.encoding.char_hash import contract_meta as char_hash_meta
from training.model2.encoding.syllable_vocab import SyllableVocabV1, SYL_VOCAB_VERSION
from training.model2.evaluation.baselines import fuzzy_distance_ranks, fuzzy_prior_ranks
from training.model2.evaluation.metrics import summarize_ranking
from training.model2.export.train_row import (
    Model2TrainRowV1,
    default_contract_versions,
    empty_condition_vectors,
    make_trainrow_id,
)
from training.model2.export.training_sample import TrainingSampleV1
from training.model2.features.personal import domain_features_for_candidate, personal_features_for_candidate
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool, syllables_from_span
from training.model2.phonetic.syllables import levenshtein_syllables, text_to_syllables

DATASET_ID = "model2-pronunciation-corrupted-probe-v1"


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _split_context(local: str, span: str) -> tuple[str, str, int]:
    idx = local.find(span) if span else -1
    if idx < 0:
        return "", "", 0
    return local[:idx], local[idx + len(span) :], idx


def _summarize(ranks: list[int], pool_sizes: list[int]) -> dict[str, Any]:
    s = summarize_ranking(ranks, pool_sizes)
    # alias for report compatibility
    s["recall_at_1"] = s.get("Recall@1")
    return s


def slice_metrics(rows: list[dict], source_type: Optional[str] = None) -> dict[str, Any]:
    term = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_in_pool")
        and (source_type is None or r.get("source_type") == source_type)
    ]
    ranks_d: list[int] = []
    ranks_p: list[int] = []
    pools: list[int] = []
    for r in term:
        rd = fuzzy_distance_ranks(r)
        rp = fuzzy_prior_ranks(r)
        if rd is not None:
            ranks_d.append(rd)
            pools.append(len(r.get("fuzzy_pool_term_ids") or []))
        if rp is not None:
            ranks_p.append(rp)
    amb = Counter(r.get("ambiguity_class") for r in term)
    equal_n = amb.get("EQUAL_DISTANCE", 0)
    wrong_nearest = sum(1 for x in ranks_d if x > 0)
    tp_all = [r for r in rows if r.get("is_term_positive") and (source_type is None or r.get("source_type") == source_type)]
    pool_vis = sum(1 for r in tp_all if r.get("target_in_pool"))
    return {
        "n_term_positive": len(tp_all),
        "n_term_positive_in_pool": len(term),
        "B_pool_distance": _summarize(ranks_d, pools),
        "B_pool_prior": _summarize(ranks_p, pools),
        "ambiguity_class_counts": dict(amb),
        "equal_distance_n": equal_n,
        "equal_distance_rate": equal_n / max(1, len(term)),
        "wrong_nearest_n": wrong_nearest,
        "wrong_nearest_rate": wrong_nearest / max(1, len(term)),
        "rank_gt0_n": wrong_nearest,
        "fuzzy_pool_recall": pool_vis / max(1, len(tp_all)),
    }


def build_rows(
    samples: list[TrainingSampleV1],
    plans_by_id: dict[str, dict],
    users_by_id: dict[str, dict],
    index,
    lex_snap: str,
    vocab: SyllableVocabV1,
) -> tuple[list[dict], dict[str, Any]]:
    rows: list[dict] = []
    stats = Counter()
    for s in samples:
        synth = s.metadata.synthetic or {}
        spid = synth.get("audio_manifest_id") or ""
        plan = plans_by_id.get(spid) or {}
        if not plan:
            eid = s.metadata.correction_event_id or ""
            if eid.startswith("synth-event-"):
                plan = plans_by_id.get(eid[len("synth-event-") :]) or {}
        pseudo_id = (
            plan.get("pseudo_user_id")
            or synth.get("pseudo_user_id")
            or synth.get("pseudo_user_group_id")
            or ""
        )
        kind = s.metadata.sample_kind.value
        span_text = s.input.source_span
        local = s.input.local_context or ""
        left, right, span_start = _split_context(local, span_text)
        syls = syllables_from_span(span_text, s.input.source_pinyin)
        planned_term = s.metadata.target_term
        preferred_domain = s.metadata.domain
        span_targets_term = bool(
            planned_term
            and (
                s.target.target_span == planned_term
                or planned_term in (s.target.target_span or "")
                or (s.target.target_span or "") in planned_term
            )
        )
        is_term_positive = (
            kind == "POSITIVE"
            and span_targets_term
            and s.metadata.source_type.value != "RULE_SYNTHETIC"
        )
        non_term_positive = kind == "POSITIVE" and not is_term_positive and s.metadata.source_type.value != "RULE_SYNTHETIC"
        target_rec = index.resolve_surface(planned_term or "", preferred_domain) if planned_term else None
        target_term_id = target_rec.term_id if target_rec else None
        target_oov = bool(is_term_positive and target_rec is None)
        if is_term_positive:
            stats["term_positive"] += 1
            stats["target_in_lex" if target_rec else "target_oov"] += 1
        elif non_term_positive:
            stats["non_term_positive"] += 1

        req = FuzzyPoolRequestV1(
            span_text=span_text,
            span_syllables=syls,
            span_syllable_count=len(syls),
            max_pool_size=FUZZY_POOL_MAX_CANDIDATES,
            distance_threshold=FUZZY_DISTANCE_THRESHOLD,
            lexicon_snapshot_id=lex_snap,
        )
        pool = build_fuzzy_pool(index, req)
        if is_term_positive and planned_term and pool.contains_surface(planned_term):
            stats["pool_hit"] += 1

        profile = users_by_id.get(pseudo_id) or {}
        personal_terms = profile.get("personal_terms") or []
        pt_syl = {t: text_to_syllables(t) for t in personal_terms[:PERSONAL_TERMS_MAX]}
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

        cond = empty_condition_vectors()
        phon_bias = profile.get("phonetic_bias") or {}
        realized = bool(synth.get("phonetic_profile_acoustically_realized"))
        for i, key in enumerate(PHONETIC_FEATURE_KEYS):
            if key in phon_bias and float(phon_bias[key]) > 0:
                cond["phonetic_condition"][i] = float(phon_bias[key])
                # mask only when acoustically realized (probe contract)
                cond["phonetic_mask"][i] = 1 if realized else 0

        split = plan.get("split") or "train"
        trainrow_id = make_trainrow_id(s.sample_id)
        row = Model2TrainRowV1(
            sample_id=s.sample_id,
            trainrow_id=trainrow_id,
            sample_kind=kind,
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
            phonetic_condition=cond["phonetic_condition"],
            phonetic_mask=cond["phonetic_mask"],
            tone_condition=cond["tone_condition"],
            tone_mask=cond["tone_mask"],
            domain_prior=cond["domain_prior"],
            domain_mask=cond["domain_mask"],
            profile_available=1 if profile else 0,
            personal_term_count=min(len(personal_terms), PERSONAL_TERMS_MAX),
            phonetic_profile_acoustically_realized=1 if realized else 0,
            fuzzy_pool_term_ids=pool.term_ids(),
            target_term_id=target_term_id,
            target_in_pool=positive_idx is not None,
            target_oov=target_oov,
            candidate_personal_features=pers_feats,
            candidate_domain_features=dom_feats,
            positive_pool_index=positive_idx,
            self_span_as_negative_anchor=(kind == "NEGATIVE"),
            positive_bucket=(
                "TERM_POSITIVE"
                if is_term_positive
                else ("NON_TERM_POSITIVE" if non_term_positive else None)
            ),
            is_term_positive=is_term_positive,
            ignored_for_model2_recall=non_term_positive,
            ambiguity_class=amb_class,
            fuzzy_ambiguity_score=amb_score if is_term_positive else None,
            provenance={
                "pseudo_user_id": pseudo_id,
                "source_type": s.metadata.source_type.value,
                "realization_status": synth.get("realization_status"),
                "corruption_family": synth.get("corruption_family"),
                "ground_truth_text": synth.get("ground_truth_text"),
                "tts_input_text": synth.get("tts_input_text"),
                "intended_corrupted_syllables": synth.get("intended_corrupted_syllables"),
            },
            contract_versions={
                **default_contract_versions(),
                "char_hash_version": char_hash_meta()["version"],
                "syl_vocab_version": SYL_VOCAB_VERSION,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "input_contract_version": INPUT_CONTRACT_VERSION,
            },
        )
        drow = row.to_dict()
        drow["fuzzy_pool_distances"] = distances
        drow["fuzzy_pool_priors"] = priors
        drow["is_term_positive"] = is_term_positive
        drow["source_type"] = s.metadata.source_type.value
        drow["realization_status"] = synth.get("realization_status")
        drow["corruption_family"] = synth.get("corruption_family")
        drow["phonetic_profile_acoustically_realized"] = realized
        rows.append(drow)
    return rows, dict(stats)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pronunciation_corrupted_probe_v1",
    )
    ap.add_argument(
        "--canonical-rows",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/training_scale_v1/model2_train_rows.jsonl",
    )
    args = ap.parse_args()
    out_dir = args.out_dir

    results = _load_jsonl(out_dir / "results.jsonl")
    samples = [TrainingSampleV1.from_dict(x) for x in _load_jsonl(out_dir / "training_samples.jsonl")]
    plans = {p["sample_plan_id"]: p for p in _load_jsonl(out_dir / "plan.jsonl")}
    users: dict[str, dict] = {}
    for u in _load_jsonl(out_dir / "pseudo_user_profiles.jsonl"):
        users[u["pseudo_user_group_id"]] = u

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    snap = f"sha256:{lex_meta.get('checksum') or lex_meta.get('bundleVersion')}"
    index = build_candidate_index_from_sqlite(paths["sqlite"], snap, include_idiom=False)
    vocab = SyllableVocabV1.build_from_syllables(s for r in index.records for s in r.syllables)

    rows, build_stats = build_rows(samples, plans, users, index, snap, vocab)
    with (out_dir / "model2_train_rows.jsonl").open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    corr = [r for r in results if r.get("corruption_applied") and r.get("status") == "ok"]
    status_counts = Counter((r.get("realization") or {}).get("status") for r in corr)
    realized_n = status_counts.get("REALIZED_AS_INTENDED", 0) + status_counts.get("REALIZED_DIFFERENTLY", 0)
    asr_err = sum(
        1
        for r in corr
        if "".join((r.get("asr_hypothesis") or "").split()) != "".join((r.get("ground_truth_text") or "").split())
    )
    asr_err_realized = sum(
        1
        for r in corr
        if (r.get("realization") or {}).get("status") in ("REALIZED_AS_INTENDED", "REALIZED_DIFFERENTLY")
        and "".join((r.get("asr_hypothesis") or "").split()) != "".join((r.get("ground_truth_text") or "").split())
    )
    realization_metrics = {
        "n_corrupted_ok": len(corr),
        "status_counts": dict(status_counts),
        "PronunciationRealizationSuccessRate": realized_n / max(1, len(corr)),
        "REALIZED_AS_INTENDED_rate": status_counts.get("REALIZED_AS_INTENDED", 0) / max(1, len(corr)),
        "ASRErrorYieldGivenCorruption": asr_err / max(1, len(corr)),
        "ASRErrorYieldGivenRealizedCorruption": asr_err_realized / max(1, realized_n),
    }
    (out_dir / "realization_metrics.json").write_text(
        json.dumps(realization_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    amb_pron = slice_metrics(rows, "TTS_PRONUNCIATION_CORRUPTED")
    amb_ctrl = slice_metrics(rows, "TTS_ASR_SYNTHETIC")
    ambiguity_metrics = {
        "pronunciation_corrupted": amb_pron,
        "control_within_probe": amb_ctrl,
        "build_stats": build_stats,
    }
    (out_dir / "ambiguity_metrics.json").write_text(
        json.dumps(ambiguity_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "fuzzy_pool_metrics.json").write_text(
        json.dumps(
            {
                "pronunciation_corrupted_recall": amb_pron.get("fuzzy_pool_recall"),
                "n_term_positive": build_stats.get("term_positive"),
                "pool_hit": build_stats.get("pool_hit"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    canonical = _load_jsonl(args.canonical_rows)
    can_m = slice_metrics(canonical, "TTS_ASR_SYNTHETIC")
    rule_term = [r for r in canonical if r.get("is_rule_positive") and r.get("target_in_pool")]
    rule_ranks = [fuzzy_distance_ranks(r) for r in rule_term]
    rule_ranks = [x for x in rule_ranks if x is not None]
    rule_pools = [len(r.get("fuzzy_pool_term_ids") or []) for r in rule_term if fuzzy_distance_ranks(r) is not None]
    rule_equal = sum(1 for r in rule_term if r.get("ambiguity_class") == "EQUAL_DISTANCE")
    rule_m = {
        "n_term_positive_in_pool": len(rule_term),
        "B_pool_distance": _summarize(rule_ranks, rule_pools),
        "equal_distance_n": rule_equal,
        "equal_distance_rate": rule_equal / max(1, len(rule_term)),
        "wrong_nearest_n": sum(1 for x in rule_ranks if x > 0),
        "wrong_nearest_rate": sum(1 for x in rule_ranks if x > 0) / max(1, len(rule_term)),
        "note": "from is_rule_positive on training_scale_v1",
    }
    comparison = {
        "A_canonical_tts_scale_v1": can_m,
        "B_pronunciation_corrupted_probe": amb_pron,
        "C_rule_synthetic": rule_m,
        "delta_equal_distance_rate_B_minus_A": amb_pron["equal_distance_rate"] - can_m["equal_distance_rate"],
        "delta_wrong_nearest_rate_B_minus_A": amb_pron["wrong_nearest_rate"] - can_m["wrong_nearest_rate"],
        "delta_B_pool_distance_R1_B_minus_A": (
            (amb_pron.get("B_pool_distance") or {}).get("recall_at_1", 0)
            - (can_m.get("B_pool_distance") or {}).get("recall_at_1", 0)
        ),
    }
    (out_dir / "source_comparison.json").write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    pos_neg = {
        "kind_counts": dict(Counter(s.metadata.sample_kind.value for s in samples)),
        "term_positive": build_stats.get("term_positive"),
        "non_term_positive": build_stats.get("non_term_positive"),
        "n_results_ok": sum(1 for r in results if r.get("status") == "ok"),
        "n_corrupted": len(corr),
        "n_control": sum(1 for r in results if (not r.get("corruption_applied")) and r.get("status") == "ok"),
    }
    (out_dir / "positive_negative_stats.json").write_text(
        json.dumps(pos_neg, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    r1_b = (amb_pron.get("B_pool_distance") or {}).get("recall_at_1")
    r1_a = (can_m.get("B_pool_distance") or {}).get("recall_at_1")
    go = {
        "corruption_before_tts": True,
        "asr_from_production": True,
        "realization_success_rate": realization_metrics["PronunciationRealizationSuccessRate"],
        "fuzzy_pool_visibility": amb_pron.get("fuzzy_pool_recall"),
        "equal_distance_improved": comparison["delta_equal_distance_rate_B_minus_A"] > 0.02,
        "wrong_nearest_improved": comparison["delta_wrong_nearest_rate_B_minus_A"] > 0.02,
        "distance_saturation_eased": bool(r1_a is not None and r1_b is not None and r1_b < r1_a - 0.02),
        "B_pool_distance_R1_pron": r1_b,
        "B_pool_distance_R1_canonical": r1_a,
    }
    manifest = {
        "dataset_id": DATASET_ID,
        "n_train_rows": len(rows),
        "n_results": len(results),
        "realization_metrics": realization_metrics,
        "go_signals": go,
        "source_comparison_summary": {
            "delta_equal": comparison["delta_equal_distance_rate_B_minus_A"],
            "delta_wrong_nearest": comparison["delta_wrong_nearest_rate_B_minus_A"],
            "delta_R1": comparison["delta_B_pool_distance_R1_B_minus_A"],
        },
        "markers": ["PRONUNCIATION_CORRUPTED_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
        "model_training": "NOT_RUN",
    }
    (out_dir / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
