#!/usr/bin/env python3
"""Build Model2TrainRowV1 + ambiguity/negative metrics for training_scale_v1 (no TTS)."""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.ambiguity.taxonomy import classify_ambiguity, fuzzy_ambiguity_score, is_ambiguous_class
from training.model2.candidates.index import build_candidate_index_from_sqlite
from training.model2.contract import (
    CANDIDATE_INDEX_VERSION,
    CONTEXT_CHAR_MAX,
    FEATURE_SCHEMA_VERSION,
    FUZZY_DISTANCE_THRESHOLD,
    FUZZY_POOL_MAX_CANDIDATES,
    FUZZY_POOL_VERSION,
    INPUT_CONTRACT_VERSION,
    PERSONAL_TERMS_MAX,
    PHONETIC_DIM,
    SPAN_CHAR_MAX,
    SYL_VOCAB_VERSION,
)
from training.model2.encoding.char_hash import encode_context_chars, encode_span_chars, normalize_chars
from training.model2.encoding.char_hash import contract_meta as char_hash_meta
from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.export.train_row import (
    Model2TrainRowV1,
    default_contract_versions,
    empty_condition_vectors,
    make_trainrow_id,
)
from training.model2.export.training_sample import TrainingSampleV1, stage_a_masks
from training.model2.features.personal import domain_features_for_candidate, personal_features_for_candidate
from training.model2.fuzzy.pool import FuzzyPoolHit, FuzzyPoolRequestV1, build_fuzzy_pool, syllables_from_span
from training.model2.phonetic.syllables import levenshtein_syllables, text_to_syllables
from training.model2.splits.assign import SplitAssignment, audit_term_combination_holdout, audit_user_disjoint


def _load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def _split_context(local_context: str, span: str):
    if not span:
        return "", "", None, None
    idx = local_context.find(span)
    if idx < 0:
        return "", "", None, None
    left = local_context[max(0, idx - CONTEXT_CHAR_MAX) : idx]
    right = local_context[idx + len(span) : idx + len(span) + CONTEXT_CHAR_MAX]
    return left, right, idx, idx + len(span)


def context_leak(left: str, right: str, target: Optional[str], span: str) -> bool:
    if not target:
        return False
    ctx = (left or "") + (right or "")
    # span itself is the query, not leak; leak = target copied in surrounding context
    return target in ctx and target != span


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--in-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/training_scale_v1",
    )
    args = ap.parse_args()
    out_dir = args.in_dir
    samples = [TrainingSampleV1.from_dict(x) for x in _load_jsonl(out_dir / "training_samples.jsonl")]
    plans = {p["sample_plan_id"]: p for p in _load_jsonl(out_dir / "plan.jsonl")}
    for p in _load_jsonl(out_dir / "rule_plan.jsonl"):
        plans[p["sample_plan_id"]] = p
    users = {u["pseudo_user_group_id"]: u for u in json.loads((out_dir / "pseudo_users.json").read_text(encoding="utf-8"))}

    from training.model2.corpus.lexicon_export import default_lexicon_paths, load_lexicon_snapshot_meta

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    lex_snap = f"sha256:{lex_meta.get('checksum')}"
    index = build_candidate_index_from_sqlite(paths["sqlite"], lex_snap, include_idiom=False)
    index.save_jsonl(out_dir / "candidate_index.jsonl")
    index.save_meta(out_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.build_from_syllables(s for r in index.records for s in r.syllables)
    vocab.save(out_dir / "syl-vocab-v1.json")

    frozen_cap = FUZZY_POOL_MAX_CANDIDATES
    frozen_dist = FUZZY_DISTANCE_THRESHOLD
    rows: list[Model2TrainRowV1] = []
    kind_counts = Counter()
    term_positive_n = non_term_positive_n = rule_positive_n = 0
    target_oov = target_in_lex = 0
    pos_for_pool = 0
    pool_hit = Counter()
    exact_vis = Counter()
    hn_native_n = hn_injected_n = hn_total = 0
    n1 = n2 = 0
    leak_n = 0
    amb_cls = Counter()
    mask_ok = 0
    assignments: list[SplitAssignment] = []
    pool_lats = []

    for s in samples:
        kind = s.metadata.sample_kind.value
        kind_counts[kind] += 1
        synth = s.metadata.synthetic or {}
        plan_id = None
        if s.metadata.correction_event_id.startswith("synth-event-"):
            plan_id = s.metadata.correction_event_id.replace("synth-event-", "").replace("-hn", "")
        elif s.metadata.correction_event_id.startswith("rule-event-"):
            plan_id = s.metadata.correction_event_id.replace("rule-event-", "")
        plan = plans.get(plan_id or "")
        split = (plan or {}).get("split", "train")
        pseudo_id = (plan or {}).get("pseudo_user_group_id") or synth.get("pseudo_user_group_id")

        span_text = s.input.source_span
        local = s.input.local_context or ""
        left, right, span_start, _ = _split_context(local, span_text)
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
        target_rec = index.resolve_surface(planned_term or "", preferred_domain) if planned_term else None
        target_oov_flag = False
        target_term_id = None
        non_term_positive = False
        if kind == "POSITIVE":
            if is_term_positive:
                term_positive_n += 1
                if target_rec is None:
                    target_oov_flag = True
                    target_oov += 1
                else:
                    target_in_lex += 1
                    target_term_id = target_rec.term_id
            elif s.metadata.source_type.value == "RULE_SYNTHETIC":
                rule_positive_n += 1
                if planned_term:
                    tr = index.resolve_surface(planned_term)
                    target_term_id = tr.term_id if tr else None
                    target_oov_flag = tr is None
            else:
                non_term_positive_n += 1
                non_term_positive = True
                if planned_term:
                    tr = index.resolve_surface(planned_term, preferred_domain)
                    if tr:
                        target_term_id = tr.term_id

        req = FuzzyPoolRequestV1(
            span_text=span_text,
            span_syllables=syls,
            span_syllable_count=len(syls),
            max_pool_size=frozen_cap,
            distance_threshold=frozen_dist,
            lexicon_snapshot_id=lex_snap,
        )
        pool = build_fuzzy_pool(index, req)
        pool_lats.append(pool.latency_ms)

        if is_term_positive:
            pos_for_pool += 1
            if pool.contains_surface(planned_term):
                pool_hit[16] += 1
            exact_yes = span_text in index.by_surface
            fuzzy_yes = bool(planned_term and pool.contains_surface(planned_term))
            if exact_yes and fuzzy_yes:
                exact_vis["C_EXACT_HIT_FUZZY_HIT"] += 1
            elif exact_yes:
                exact_vis["A_EXACT_HIT"] += 1
            elif fuzzy_yes:
                exact_vis["B_EXACT_MISS_FUZZY_HIT"] += 1
            else:
                exact_vis["D_EXACT_MISS_FUZZY_MISS"] += 1

        hn_term = synth.get("hard_negative_biased_term")
        hn_in_pool_native = False
        hn_term_id = None
        hn_injected = False
        if kind == "HARD_NEGATIVE":
            hn_total += 1
            if hn_term:
                hn_rec = index.resolve_surface(hn_term)
                hn_term_id = hn_rec.term_id if hn_rec else None
                if hn_term in {h.surface for h in pool.hits}:
                    hn_in_pool_native = True
                    hn_native_n += 1
                elif hn_rec is not None:
                    pool.hits.append(
                        FuzzyPoolHit(
                            term_id=hn_rec.term_id,
                            surface=hn_rec.surface,
                            pinyin_key=hn_rec.pinyin_key,
                            syllables=hn_rec.syllables,
                            distance=99,
                            syllable_count=hn_rec.syllable_count,
                            term_type=hn_rec.term_type,
                            prior_score=hn_rec.prior_score,
                        )
                    )
                    pool.pool_size = len(pool.hits)
                    hn_injected = True
                    hn_injected_n += 1
        hn_in_pool = hn_in_pool_native or (
            kind == "HARD_NEGATIVE" and hn_term_id is not None and hn_term_id in set(pool.term_ids())
        )

        cond = empty_condition_vectors()
        profile = users.get(pseudo_id or "")
        personal_terms = (profile or {}).get("personal_terms") or []
        pers_feats = []
        dom_feats = []
        pt_syl = {t: text_to_syllables(t) for t in personal_terms[:PERSONAL_TERMS_MAX]}
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
                    if not target_term_id:
                        target_term_id = h.term_id
                    break

        distances: list[Optional[int]] = []
        priors: list[float] = []
        cand_pys: list[list[str]] = []
        for i, tid in enumerate(pool.term_ids()):
            rec = index.by_term_id.get(tid)
            priors.append(float(rec.prior_score) if rec else 0.0)
            cand_pys.append(list(rec.syllables) if rec else [])
            if hn_injected and tid == hn_term_id:
                distances.append(None)
            elif rec and syls:
                distances.append(levenshtein_syllables(syls, rec.syllables))
            else:
                distances.append(0)

        tgt_d = distances[positive_idx] if positive_idx is not None and positive_idx < len(distances) else None
        amb_score = fuzzy_ambiguity_score(
            target_distance=tgt_d, distances=distances, target_index=positive_idx
        )
        amb_class = None
        if is_term_positive or (kind == "POSITIVE" and s.metadata.source_type.value == "RULE_SYNTHETIC"):
            amb_class = classify_ambiguity(
                target_distance=tgt_d,
                distances=distances,
                target_index=positive_idx,
                span_syllables=syls,
                candidate_pinyins=cand_pys,
            )
            if is_term_positive:
                amb_cls[amb_class] += 1

        leak = context_leak(left, right, planned_term, span_text)
        if leak:
            leak_n += 1

        neg_type = synth.get("negative_type")
        if kind == "NEGATIVE":
            if not neg_type:
                neg_type = "N2" if pool.pool_size > 0 else "N1"
            if neg_type == "N1":
                n1 += 1
            else:
                n2 += 1

        if (
            all(x == 0 for x in cond["phonetic_mask"])
            and all(x == 0 for x in cond["tone_mask"])
        ):
            mask_ok += 1

        trainrow_id = make_trainrow_id(
            s.sample_id,
            fuzzy_pool_version=f"{FUZZY_POOL_VERSION}:d{frozen_dist}:c{frozen_cap}",
            input_contract_version=INPUT_CONTRACT_VERSION,
            candidate_index_version=CANDIDATE_INDEX_VERSION,
        )
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
            phonetic_profile_acoustically_realized=0,
            fuzzy_pool_term_ids=pool.term_ids(),
            target_term_id=target_term_id,
            target_in_pool=positive_idx is not None,
            target_oov=target_oov_flag,
            candidate_personal_features=pers_feats,
            candidate_domain_features=dom_feats,
            positive_pool_index=positive_idx,
            self_span_as_negative_anchor=(kind == "NEGATIVE"),
            hard_negative_term_id=hn_term_id,
            hard_negative_in_pool=hn_in_pool,
            is_injected_hard_negative=hn_injected,
            positive_bucket=(
                "TERM_POSITIVE"
                if is_term_positive
                else (
                    "RULE_POSITIVE"
                    if kind == "POSITIVE" and s.metadata.source_type.value == "RULE_SYNTHETIC"
                    else ("NON_TERM_POSITIVE" if non_term_positive else None)
                )
            ),
            is_term_positive=is_term_positive,
            ignored_for_model2_recall=non_term_positive,
            is_rule_positive=(kind == "POSITIVE" and s.metadata.source_type.value == "RULE_SYNTHETIC"),
            ambiguity_class=amb_class,
            fuzzy_ambiguity_score=amb_score if is_term_positive else None,
            context_target_leak=leak,
            negative_type=neg_type if kind == "NEGATIVE" else None,
            hn_native=hn_in_pool_native,
            provenance={
                "correction_event_id": s.metadata.correction_event_id,
                "user_group_key": s.metadata.user_group_key,
                "pseudo_user_group_id": pseudo_id,
                "source_type": s.metadata.source_type.value,
                "synthetic": {k: synth.get(k) for k in ("corruption_strategy", "random_seed", "negative_type") if k in synth},
            },
            contract_versions={
                **default_contract_versions(),
                "fuzzy_pool_config": f"d{frozen_dist}_c{frozen_cap}",
                "char_hash_version": char_hash_meta()["version"],
                "syl_vocab_version": SYL_VOCAB_VERSION,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
            },
        )
        # stash distances for baselines (not SSOT)
        drow = row.to_dict()
        drow["fuzzy_pool_distances"] = distances
        drow["fuzzy_pool_priors"] = priors
        drow["is_injected_hard_negative"] = hn_injected
        drow["is_term_positive"] = is_term_positive
        drow["ignored_for_model2_recall"] = non_term_positive
        rows.append(row)
        # keep extra keys on serialized form
        row._extra = {"fuzzy_pool_distances": distances, "fuzzy_pool_priors": priors}  # type: ignore
        if plan and planned_term and is_term_positive:
            assignments.append(
                SplitAssignment(
                    sample_plan_id=plan_id or s.sample_id,
                    split=split,
                    pseudo_user_group_id=pseudo_id or "",
                    target_term=planned_term,
                )
            )

    with (out_dir / "model2_train_rows.jsonl").open("w", encoding="utf-8") as f:
        for row in rows:
            d = row.to_dict()
            extra = getattr(row, "_extra", {})
            d.update(extra)
            f.write(json.dumps(d, ensure_ascii=False) + "\n")

    term_denom = max(1, term_positive_n)
    fuzzy_r16 = pool_hit[16] / max(1, pos_for_pool)
    leak_audit = {
        "context_target_leak_count": leak_n,
        "user_leaks": audit_user_disjoint(assignments) if assignments else [],
        "split_audit": audit_term_combination_holdout(assignments) if assignments else {},
    }
    (out_dir / "leakage_audit.json").write_text(json.dumps(leak_audit, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "fuzzy_pool_metrics.json").write_text(
        json.dumps(
            {
                "FUZZY_POOL_RECALL@16": fuzzy_r16,
                "TARGET_IN_LEXICON_RATE": target_in_lex / term_denom,
                "TARGET_OOV_RATE": target_oov / term_denom,
                "exact_visibility": dict(exact_vis),
                "p50_pool_ms": sorted(pool_lats)[len(pool_lats) // 2] if pool_lats else 0,
                "p95_pool_ms": sorted(pool_lats)[int(0.95 * (len(pool_lats) - 1))] if pool_lats else 0,
                "note": "Python FuzzyPool latency is Known Deferred; not a training blocker.",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (out_dir / "negative_type_metrics.json").write_text(
        json.dumps({"N1": n1, "N2": n2, "NEGATIVE_total": n1 + n2}, indent=2), encoding="utf-8"
    )
    (out_dir / "hard_negative_metrics.json").write_text(
        json.dumps(
            {"HN_NATIVE": hn_native_n, "HN_INJECTED": hn_injected_n, "HN_TOTAL": hn_total},
            indent=2,
        ),
        encoding="utf-8",
    )
    manifest = {
        "n_trainrows": len(rows),
        "sample_kinds": dict(kind_counts),
        "TERM_POSITIVE_N": term_positive_n,
        "NON_TERM_POSITIVE_N": non_term_positive_n,
        "RULE_POSITIVE_N": rule_positive_n,
        "ignored_non_term_positive_count": non_term_positive_n,
        "ambiguity_class_term_positive": dict(amb_cls),
        "splits": dict(Counter(r.split for r in rows)),
        "term_positive_splits": dict(
            Counter(r.split for r in rows if r.is_term_positive)
        ),
        "markers": ["TRAINING_SCALE_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
    }
    (out_dir / "dataset_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
