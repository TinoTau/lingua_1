#!/usr/bin/env python3
"""Rebuild model2-synth-probe-v1 → Model2TrainRowV1 + FuzzyPool metrics (no TTS/ASR)."""

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

from training.model2.candidates.index import (  # noqa: E402
    build_candidate_index_from_sqlite,
)
from training.model2.contract import (  # noqa: E402
    CANDIDATE_INDEX_VERSION,
    CONTEXT_CHAR_MAX,
    DOMAIN_DIM,
    DOMAIN_SLOT_IDS,
    FEATURE_SCHEMA_VERSION,
    FUZZY_POOL_VERSION,
    INPUT_CONTRACT_VERSION,
    PERSONAL_SIM_TOP_N,
    PERSONAL_TERMS_MAX,
    PHONETIC_DIM,
    SPAN_CHAR_MAX,
    SYL_VOCAB_VERSION,
    TONE_DIM,
)
from training.model2.encoding.char_hash import (  # noqa: E402
    encode_context_chars,
    encode_span_chars,
    normalize_chars,
    contract_meta as char_hash_meta,
)
from training.model2.encoding.syllable_vocab import SyllableVocabV1  # noqa: E402
from training.model2.export.train_row import (  # noqa: E402
    Model2TrainRowV1,
    default_contract_versions,
    empty_condition_vectors,
    make_trainrow_id,
)
from training.model2.export.training_sample import (  # noqa: E402
    TrainingSampleKind,
    TrainingSampleV1,
    stage_a_masks,
)
from training.model2.features.personal import (  # noqa: E402
    benchmark_personal_sim,
    domain_features_for_candidate,
    personal_features_for_candidate,
)
from training.model2.fuzzy.pool import (  # noqa: E402
    FuzzyPoolHit,
    FuzzyPoolRequestV1,
    build_fuzzy_pool,
    exact_hit_for_span,
    syllables_from_span,
)
from training.model2.phonetic.syllables import text_to_syllables  # noqa: E402
from training.model2.splits.assign import (  # noqa: E402
    SplitAssignment,
    audit_term_combination_holdout,
    audit_user_disjoint,
)


def _load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def _split_context(local_context: str, span: str) -> tuple[str, str, Optional[int], Optional[int]]:
    """Best-effort left/right context; no fabrication if span not found."""
    if not span:
        return "", "", None, None
    idx = local_context.find(span)
    if idx < 0:
        return "", "", None, None
    left = local_context[max(0, idx - CONTEXT_CHAR_MAX) : idx]
    right = local_context[idx + len(span) : idx + len(span) + CONTEXT_CHAR_MAX]
    return left, right, idx, idx + len(span)


def _relative_position(span_start: Optional[int], utterance_len: int) -> float:
    if utterance_len <= 0 or span_start is None:
        return 0.0
    return float(span_start) / float(utterance_len)


def run_pool_sweep(
    index,
    positive_queries: list[tuple[str, list[str], Optional[str]]],
    distance_thresholds: list[int],
    pool_caps: list[int],
) -> dict[str, Any]:
    """positive_queries: (span_text, syllables, target_surface)"""
    sweep: dict[str, Any] = {}
    for dist in distance_thresholds:
        for cap in pool_caps:
            key = f"d{dist}_cap{cap}"
            hits = 0
            sizes = []
            lats = []
            for span_text, syls, target in positive_queries:
                req = FuzzyPoolRequestV1(
                    span_text=span_text,
                    span_syllables=syls,
                    span_syllable_count=len(syls),
                    max_pool_size=cap,
                    distance_threshold=dist,
                    lexicon_snapshot_id=index.lexicon_snapshot_id,
                )
                res = build_fuzzy_pool(index, req)
                sizes.append(res.pool_size)
                lats.append(res.latency_ms)
                if target and res.contains_surface(target):
                    hits += 1
            n = max(1, len(positive_queries))
            sweep[key] = {
                "distance_threshold": dist,
                "pool_cap": cap,
                "recall": hits / n,
                "hits": hits,
                "n": len(positive_queries),
                "avg_pool_size": sum(sizes) / n,
                "p95_pool_size": sorted(sizes)[int(0.95 * (len(sizes) - 1))] if sizes else 0,
                "p50_latency_ms": sorted(lats)[len(lats) // 2] if lats else 0,
                "p95_latency_ms": sorted(lats)[int(0.95 * (len(lats) - 1))] if lats else 0,
            }
    return sweep


def select_pool_config(sweep: dict[str, Any]) -> dict[str, Any]:
    """Pick smallest cap with Recall>=0.95; prefer distance=2 then 3 then 1."""
    gate = 0.95
    candidates = []
    for cfg in sweep.values():
        if cfg["recall"] >= gate:
            candidates.append(cfg)
    if candidates:
        candidates.sort(key=lambda c: (c["pool_cap"], abs(c["distance_threshold"] - 2)))
        best = candidates[0]
        best["selection_reason"] = "smallest_cap_meeting_95pct_recall"
        return best
    # Fallback: best recall then smallest cap
    ranked = sorted(sweep.values(), key=lambda c: (-c["recall"], c["pool_cap"]))
    best = ranked[0]
    best["selection_reason"] = "best_recall_below_gate"
    best["gate_met"] = False
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--probe-dir",
        type=Path,
        default=REPO_ROOT / "training" / "model2" / "dataset" / "probe_v1",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training" / "model2" / "dataset" / "probe_trainrow_v1",
    )
    ap.add_argument(
        "--lexicon-sqlite",
        type=Path,
        default=REPO_ROOT / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite",
    )
    args = ap.parse_args()
    probe_dir = args.probe_dir
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    plan_meta = json.loads((probe_dir / "probe_plan_meta.json").read_text(encoding="utf-8"))
    lex_snap = plan_meta.get("lexicon_manifest", {}).get("checksum", "unknown")
    pseudo_users = {
        u["pseudo_user_group_id"]: u
        for u in json.loads((probe_dir / "pseudo_users.json").read_text(encoding="utf-8"))
    }
    plans = {p["sample_plan_id"]: p for p in _load_jsonl(probe_dir / "probe_plan.jsonl")}
    samples_raw = _load_jsonl(probe_dir / "training_samples.jsonl")
    samples = [TrainingSampleV1.from_dict(s) for s in samples_raw]

    print("Building candidate index...")
    t_idx0 = time.perf_counter()
    index = build_candidate_index_from_sqlite(
        args.lexicon_sqlite, lexicon_snapshot_id=lex_snap, include_idiom=False
    )
    index.save_jsonl(out_dir / "candidate_index.jsonl")
    index.save_meta(out_dir / "candidate_index_meta.json")
    print(f"  candidates={index.candidate_count} in {(time.perf_counter()-t_idx0)*1000:.0f}ms")

    # Syllable vocab from candidate universe
    all_syls = []
    for r in index.records:
        all_syls.extend(r.syllables)
    vocab = SyllableVocabV1.build_from_syllables(all_syls)
    vocab.save(out_dir / "syl-vocab-v1.json")

    # Collect positive queries for sweep: term-recall POSITIVE only
    positive_queries = []
    for s in samples:
        if s.metadata.sample_kind != TrainingSampleKind.POSITIVE:
            continue
        if s.metadata.source_type.value == "RULE_SYNTHETIC":
            continue
        planned = s.metadata.target_term
        if not planned:
            continue
        if not (
            s.target.target_span == planned
            or planned in s.target.target_span
            or s.target.target_span in planned
        ):
            continue
        span = s.input.source_span
        syls = syllables_from_span(span, s.input.source_pinyin)
        positive_queries.append((span, syls, planned))

    print(f"Fuzzy pool sweep on {len(positive_queries)} POSITIVE (TTS) queries...")
    sweep = run_pool_sweep(
        index,
        positive_queries,
        distance_thresholds=[1, 2, 3],
        pool_caps=[16, 32, 48, 64],
    )
    selected = select_pool_config(sweep)
    selected["gate_met"] = selected.get("gate_met", selected["recall"] >= 0.95)
    print(
        f"  selected d={selected['distance_threshold']} cap={selected['pool_cap']} "
        f"recall={selected['recall']:.4f} reason={selected['selection_reason']}"
    )

    frozen_dist = int(selected["distance_threshold"])
    frozen_cap = int(selected["pool_cap"])

    # Personal term benchmark
    print("Personal term Top-N benchmark...")
    sample_cands = index.records[:34]
    # Build fake 100 personal terms from domain surfaces
    personal_pool = [r.surface for r in index.records if r.term_type == "domain"][:100]
    personal_bench = {}
    for n_spans in (1, 5, 10, 20):
        cands = (sample_cands * ((n_spans * 34) // max(1, len(sample_cands)) + 1))[: n_spans * 34]
        for n_terms in (20, 50, 100):
            terms = personal_pool[:n_terms]
            b = benchmark_personal_sim(cands, terms, top_ns=(n_terms,))
            personal_bench[f"spans{n_spans}_terms{n_terms}"] = b[n_terms]
    # Explicit 20 vs 100 change rate on 34 candidates
    change = benchmark_personal_sim(sample_cands, personal_pool[:100], top_ns=(20, 50, 100))
    personal_bench["change_analysis"] = {
        "changed_sim_20_to_100": change.get("changed_sim_20_to_100"),
        "changed_rate": change.get("changed_rate"),
        "top20_ms": change[20]["wall_ms"],
        "top100_ms": change[100]["wall_ms"],
        "decision": "use_all_active_personal_terms_le_100",
        "reason": (
            "Top-100 wall cost remains sub-millisecond for pool<=34; "
            "avoid permanent blind spot for terms ranked 21–100."
        ),
    }
    personal_sim_top_n = PERSONAL_TERMS_MAX  # freeze all <=100

    # Rebuild train rows
    rows: list[Model2TrainRowV1] = []
    visibility_audit = []
    kind_counts = Counter()
    target_oov = 0
    target_in_lex = 0
    term_positive_n = 0
    non_term_positive_n = 0
    rule_positive_n = 0
    pos_for_pool = 0
    pool_hit = Counter()  # @16/32/48/64 with frozen distance
    exact_vis = Counter()
    hn_visible = 0
    hn_total = 0
    hn_lexicon = 0
    hn_trainable = 0
    mask_ok = 0
    build_fail = 0
    build_lats = []
    pool_lats = []
    pool_sizes = []

    masks_a = stage_a_masks()
    assignments: list[SplitAssignment] = []

    for s in samples:
        t_row0 = time.perf_counter()
        kind = s.metadata.sample_kind.value
        kind_counts[kind] += 1
        synth = s.metadata.synthetic or {}
        pseudo_id = synth.get("pseudo_user_group_id") or s.condition.user_condition_ref
        # Resolve split from plan if possible
        plan_id = None
        if s.metadata.correction_event_id.startswith("synth-event-"):
            plan_id = s.metadata.correction_event_id.replace("synth-event-", "").replace("-hn", "")
        plan = plans.get(plan_id or "")
        split = (plan or {}).get("split", "train")
        if plan and plan.get("pseudo_user_group_id"):
            pseudo_id = plan["pseudo_user_group_id"]

        span_text = s.input.source_span
        local = s.input.local_context or ""
        left, right, span_start, span_end = _split_context(local, span_text)
        if s.input.context_left is not None:
            left = s.input.context_left
        if s.input.context_right is not None:
            right = s.input.context_right

        syls = syllables_from_span(span_text, s.input.source_pinyin)
        target_surface = s.metadata.target_term
        if not target_surface and s.target.target_span not in ("NO_CHANGE", "NO_MATCH", ""):
            target_surface = s.target.target_span

        # Term-level vs character-level positive:
        # Model2 recall target = metadata.target_term when it is a lexicon term.
        # Char-level align spans (e.g. 請問→请问) are POSITIVE for correction but not
        # lexicon recall targets — classify separately (not TARGET_OOV).
        preferred_domain = s.metadata.domain
        planned_term = s.metadata.target_term
        # Term-recall positive: planned lexicon term is the align target (not incidental char fixes)
        span_targets_term = bool(
            planned_term
            and (
                s.target.target_span == planned_term
                or planned_term in s.target.target_span
                or s.target.target_span in planned_term
            )
        )
        is_term_positive = (
            kind == "POSITIVE"
            and span_targets_term
            and s.metadata.source_type.value != "RULE_SYNTHETIC"
        )
        target_rec = (
            index.resolve_surface(planned_term or "", preferred_domain)
            if planned_term
            else None
        )
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
                    if tr:
                        target_term_id = tr.term_id
                    else:
                        target_oov_flag = True
            else:
                non_term_positive_n += 1
                non_term_positive = True
                if planned_term:
                    tr = index.resolve_surface(planned_term, preferred_domain)
                    if tr:
                        target_term_id = tr.term_id  # keep plan term id for provenance

        # Fuzzy pool
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
        pool_sizes.append(pool.pool_size)

        # Multi-cap recall with frozen distance (term-level POSITIVE TTS only)
        if is_term_positive and s.metadata.source_type.value == "TTS_ASR_SYNTHETIC":
            pos_for_pool += 1
            pool_target = planned_term
            for cap in (16, 32, 48, 64):
                req_c = FuzzyPoolRequestV1(
                    span_text=span_text,
                    span_syllables=syls,
                    span_syllable_count=len(syls),
                    max_pool_size=cap,
                    distance_threshold=frozen_dist,
                    lexicon_snapshot_id=lex_snap,
                )
                res_c = build_fuzzy_pool(index, req_c)
                if pool_target and res_c.contains_surface(pool_target):
                    pool_hit[cap] += 1

            # Exact vs fuzzy visibility (relative to planned lexicon term)
            exact_yes = span_text in index.by_surface
            fuzzy_yes = bool(pool_target and pool.contains_surface(pool_target))
            if exact_yes and fuzzy_yes:
                cat = "C_EXACT_HIT_FUZZY_HIT"
            elif exact_yes and not fuzzy_yes:
                cat = "A_EXACT_HIT"
            elif (not exact_yes) and fuzzy_yes:
                cat = "B_EXACT_MISS_FUZZY_HIT"
            else:
                cat = "D_EXACT_MISS_FUZZY_MISS"
            exact_vis[cat] += 1
            entry = {
                "sample_id": s.sample_id,
                "category": cat,
                "source_span": span_text,
                "target": pool_target,
                "source_pinyin": s.input.source_pinyin,
                "target_pinyin": target_rec.pinyin_key if target_rec else None,
                "distance_to_target": None,
                "pool_top": [
                    {"term_id": h.term_id, "surface": h.surface, "distance": h.distance}
                    for h in pool.hits[:10]
                ],
            }
            if target_rec:
                from training.model2.phonetic.syllables import levenshtein_syllables

                entry["distance_to_target"] = levenshtein_syllables(syls, target_rec.syllables)
            visibility_audit.append(entry)

        # Hard negative: native phonetic visibility + optional training injection
        hn_term = synth.get("hard_negative_biased_term")
        hn_in_pool_native = False
        hn_term_id = None
        if kind == "HARD_NEGATIVE":
            hn_total += 1
            if hn_term:
                hn_rec = index.resolve_surface(hn_term)
                hn_term_id = hn_rec.term_id if hn_rec else None
                if hn_rec is not None:
                    hn_lexicon += 1
                if hn_term in {h.surface for h in pool.hits}:
                    hn_in_pool_native = True
                    hn_visible += 1
                elif hn_rec is not None:
                    # Append biased term for Stage A bias-suppression loss only.
                    # FuzzyPool V1 generation remains UserProfile-free.
                    # NOTE: distance=99 is pool-list padding only — trainers MUST use
                    # is_injected_hard_negative, never treat 99 as a phonetic feature.
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
                    hn_trainable += 1

        hn_injected = (
            kind == "HARD_NEGATIVE"
            and hn_term_id is not None
            and (not hn_in_pool_native)
            and hn_term_id in set(pool.term_ids())
        )
        hn_in_pool = hn_in_pool_native or (
            kind == "HARD_NEGATIVE" and hn_term_id is not None and hn_term_id in set(pool.term_ids())
        )

        # Stage A condition vectors (phonetic/tone fully masked)
        cond = empty_condition_vectors()
        profile = pseudo_users.get(pseudo_id or "")
        personal_terms = (profile or {}).get("personal_terms") or []
        profile_available = 1 if profile else 0

        pers_feats = []
        dom_feats = []
        pt_syl = {t: text_to_syllables(t) for t in personal_terms[:PERSONAL_TERMS_MAX]}
        for tid in pool.term_ids():
            rec = index.by_term_id[tid]
            pers_feats.append(
                personal_features_for_candidate(
                    rec, personal_terms, pt_syl, top_n=personal_sim_top_n
                )
            )
            dom_feats.append(domain_features_for_candidate(rec, preferred_domain))

        positive_idx = None
        if target_term_id and target_term_id in pool.term_ids():
            positive_idx = pool.term_ids().index(target_term_id)
        elif target_surface:
            for i, h in enumerate(pool.hits):
                if h.surface == target_surface:
                    positive_idx = i
                    if not target_term_id:
                        target_term_id = h.term_id
                    break

        trainrow_id = make_trainrow_id(
            s.sample_id,
            fuzzy_pool_version=f"{FUZZY_POOL_VERSION}:d{frozen_dist}:c{frozen_cap}",
            input_contract_version=INPUT_CONTRACT_VERSION,
            candidate_index_version=CANDIDATE_INDEX_VERSION,
        )

        # Mask validation (Stage A)
        if (
            all(x == 0 for x in cond["phonetic_mask"])
            and all(x == 0 for x in cond["tone_mask"])
            and cond["phonetic_condition"] == [0.0] * PHONETIC_DIM
        ):
            mask_ok += 1

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
            relative_position=_relative_position(span_start, len(local)),
            phonetic_condition=cond["phonetic_condition"],
            phonetic_mask=cond["phonetic_mask"],
            tone_condition=cond["tone_condition"],
            tone_mask=cond["tone_mask"],
            domain_prior=cond["domain_prior"],
            domain_mask=cond["domain_mask"],
            profile_available=profile_available,
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
            is_rule_positive=(
                kind == "POSITIVE" and s.metadata.source_type.value == "RULE_SYNTHETIC"
            ),
            provenance={
                "correction_event_id": s.metadata.correction_event_id,
                "user_group_key": s.metadata.user_group_key,
                "pseudo_user_group_id": pseudo_id,
                "source_type": s.metadata.source_type.value,
                "synthetic": {
                    k: synth.get(k)
                    for k in (
                        "generator_version",
                        "tts_voice_id",
                        "asr_model_id",
                        "corruption_strategy",
                        "random_seed",
                    )
                    if k in synth
                },
            },
            contract_versions={
                **default_contract_versions(),
                "fuzzy_pool_config": f"d{frozen_dist}_c{frozen_cap}",
                "char_hash_version": char_hash_meta()["version"],
                "syl_vocab_version": SYL_VOCAB_VERSION,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "personal_sim_top_n": str(personal_sim_top_n),
            },
        )
        errs = row.validate_shapes()
        if errs:
            build_fail += 1
            print("SHAPE_ERR", s.sample_id, errs)
        else:
            rows.append(row)
            build_lats.append((time.perf_counter() - t_row0) * 1000.0)
            if plan:
                assignments.append(
                    SplitAssignment(
                        sample_plan_id=plan_id or s.sample_id,
                        split=split,  # type: ignore
                        pseudo_user_group_id=pseudo_id or "unknown",
                        target_term=target_surface or "__none__",
                    )
                )

    # Write outputs
    rows_path = out_dir / "model2_train_rows.jsonl"
    with rows_path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r.to_dict(), ensure_ascii=False) + "\n")

    with (out_dir / "visibility_audit.jsonl").open("w", encoding="utf-8") as f:
        for e in visibility_audit:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")

    n_pos_tts = max(1, pos_for_pool)
    fuzzy_metrics = {
        "fuzzy_pool_version": FUZZY_POOL_VERSION,
        "frozen_distance_threshold": frozen_dist,
        "frozen_pool_cap": frozen_cap,
        "selection": selected,
        "sweep": sweep,
        "FUZZY_POOL_RECALL@16": pool_hit[16] / n_pos_tts,
        "FUZZY_POOL_RECALL@32": pool_hit[32] / n_pos_tts,
        "FUZZY_POOL_RECALL@48": pool_hit[48] / n_pos_tts,
        "FUZZY_POOL_RECALL@64": pool_hit[64] / n_pos_tts,
        "positive_tts_n": pos_for_pool,
        "AVG_POOL_SIZE": sum(pool_sizes) / max(1, len(pool_sizes)),
        "P95_POOL_SIZE": sorted(pool_sizes)[int(0.95 * (len(pool_sizes) - 1))] if pool_sizes else 0,
        "P50_POOL_LATENCY_MS": sorted(pool_lats)[len(pool_lats) // 2] if pool_lats else 0,
        "P95_POOL_LATENCY_MS": sorted(pool_lats)[int(0.95 * (len(pool_lats) - 1))] if pool_lats else 0,
        "exact_vs_fuzzy": dict(exact_vis),
        "EXACT_MISS_FUZZY_HIT_RATE": exact_vis["B_EXACT_MISS_FUZZY_HIT"] / n_pos_tts,
        "EXACT_MISS_FUZZY_MISS_RATE": exact_vis["D_EXACT_MISS_FUZZY_MISS"] / n_pos_tts,
        "EXACT_RECALL_VISIBILITY": (
            exact_vis["A_EXACT_HIT"] + exact_vis["C_EXACT_HIT_FUZZY_HIT"]
        )
        / n_pos_tts,
    }
    (out_dir / "fuzzy_pool_metrics.json").write_text(
        json.dumps(fuzzy_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    stage_a_audit = {
        "phonetic_mask_all_zero_required": True,
        "tone_mask_all_zero_required": True,
        "phonetic_profile_acoustically_realized": 0,
        "MASK_VALIDATION_RATE": mask_ok / max(1, len(samples)),
        "mask_ok": mask_ok,
        "n_samples": len(samples),
        "stage_a_trains": [
            "Qbase span/phonetic/context encoder",
            "candidate_embed similarity (future)",
            "personal/domain candidate-level feature weights (weak)",
        ],
        "stage_a_does_not_train": [
            "phonetic_bias user condition (masked)",
            "tone_bias user condition (masked)",
            "domain_prior user vector (masked in Stage A TTS)",
        ],
        "domain_prior_dtype": "float32[12]",
        "domain_mask_dtype": "uint8[12]",
        "personal_sim_top_n": personal_sim_top_n,
    }
    (out_dir / "stage_a_supervision_audit.json").write_text(
        json.dumps(stage_a_audit, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    (out_dir / "personal_feature_benchmark.json").write_text(
        json.dumps(personal_bench, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    leak = audit_term_combination_holdout(assignments) if assignments else {}
    user_leaks = audit_user_disjoint(assignments) if assignments else []
    leakage = {
        "user_leaks": user_leaks,
        "split_audit": leak,
        "note": (
            "Candidate lexicon contains full vocabulary (runtime universe) — not a leak. "
            "Label/profile/user_group must remain split-disjoint."
        ),
        "candidate_pool_leakage": "N/A — pool is deterministic from span phonetics + full lexicon, not from train labels",
    }
    (out_dir / "leakage_audit.json").write_text(
        json.dumps(leakage, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Determinism check: rebuild first 20 IDs
    det_ok = True
    for r in rows[:20]:
        again = make_trainrow_id(
            r.sample_id,
            fuzzy_pool_version=f"{FUZZY_POOL_VERSION}:d{frozen_dist}:c{frozen_cap}",
        )
        if again != r.trainrow_id:
            det_ok = False
            break

    pos_n = kind_counts["POSITIVE"]
    term_denom = max(1, term_positive_n)
    metrics = {
        "TOTAL_POSITIVE": kind_counts["POSITIVE"],
        "TOTAL_NEGATIVE": kind_counts["NEGATIVE"],
        "TOTAL_HARD_NEGATIVE": kind_counts["HARD_NEGATIVE"],
        "TERM_POSITIVE_N": term_positive_n,
        "NON_TERM_POSITIVE_N": non_term_positive_n,
        "RULE_POSITIVE_N": rule_positive_n,
        "TARGET_IN_LEXICON_RATE": target_in_lex / term_denom,
        "TARGET_OOV_RATE": target_oov / term_denom,
        "target_in_lexicon": target_in_lex,
        "target_oov": target_oov,
        "HARD_NEGATIVE_PHONETIC_POOL_VISIBLE_RATE": hn_visible / max(1, hn_total),
        "HARD_NEGATIVE_LEXICON_RATE": hn_lexicon / max(1, hn_total),
        "HARD_NEGATIVE_TRAINABLE_RATE": (hn_visible + hn_trainable) / max(1, hn_total),
        "hn_phonetic_visible": hn_visible,
        "hn_lexicon": hn_lexicon,
        "hn_trainable_injected": hn_trainable,
        "hn_total": hn_total,
        "TRAINROW_BUILD_SUCCESS_RATE": len(rows) / max(1, len(samples)),
        "build_fail": build_fail,
        "MASK_VALIDATION_RATE": mask_ok / max(1, len(samples)),
        "P50_TRAINROW_BUILD_LATENCY_MS": sorted(build_lats)[len(build_lats) // 2] if build_lats else 0,
        "P95_TRAINROW_BUILD_LATENCY_MS": sorted(build_lats)[int(0.95 * (len(build_lats) - 1))]
        if build_lats
        else 0,
        "n_trainrows": len(rows),
        "candidate_count": index.candidate_count,
        "determinism_ok": det_ok,
        "fuzzy": {
            "recall_at_chosen_cap": fuzzy_metrics.get(f"FUZZY_POOL_RECALL@{frozen_cap}"),
            "chosen_cap": frozen_cap,
            "chosen_distance": frozen_dist,
            "gate_met": selected.get("gate_met", False),
        },
        "go_gate": {
            "TARGET_IN_LEXICON_RATE_ok": (target_in_lex / term_denom) >= 0.99,
            "FuzzyPool_Recall_ok": (fuzzy_metrics.get(f"FUZZY_POOL_RECALL@{frozen_cap}") or 0)
            >= 0.95,
            "Leakage_ok": len(user_leaks) == 0,
            "TrainRow_build_ok": build_fail == 0,
            "StageA_masks_ok": mask_ok == len(samples),
            "HardNegative_trainable_ok": (hn_visible + hn_trainable) / max(1, hn_total) >= 0.95,
        },
        "oov_note": (
            "TARGET_OOV measured on term-level POSITIVE (metadata.target_term) only. "
            "Char-level align spans counted as NON_TERM_POSITIVE. "
            "RULE_SYNTHETIC OOV (e.g. 南宁 not in lexicon) isolated."
        ),
    }
    (out_dir / "trainrow_manifest.json").write_text(
        json.dumps(
            {
                "source_probe": str(probe_dir),
                "dataset_id": "model2-synth-probe-trainrow-v1",
                "metrics": metrics,
                "fuzzy_pool_metrics_ref": "fuzzy_pool_metrics.json",
                "personal_sim_top_n": personal_sim_top_n,
                "domain_slots": list(DOMAIN_SLOT_IDS),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    contract_versions = {
        **default_contract_versions(),
        "char_hash": char_hash_meta(),
        "syl_vocab_version": SYL_VOCAB_VERSION,
        "syl_vocab_size": vocab.to_dict()["size"],
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "domain_prior_dtype": "float32",
        "domain_mask_dtype": "uint8",
        "domain_dim": DOMAIN_DIM,
        "phonetic_dim": PHONETIC_DIM,
        "tone_dim": TONE_DIM,
        "personal_sim_top_n": personal_sim_top_n,
        "fuzzy_pool_frozen": {"distance": frozen_dist, "cap": frozen_cap},
    }
    (out_dir / "contract_versions.json").write_text(
        json.dumps(contract_versions, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    go = metrics["go_gate"]
    if all(go.values()):
        print("GO_GATE: PASS")
        return 0
    print("GO_GATE: FAIL", {k: v for k, v in go.items() if not v})
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
