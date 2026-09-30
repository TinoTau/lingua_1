#!/usr/bin/env python3
"""Stage J — Lexicon Soft-Prior Candidate Expansion Yield / Architecture Drift Audit.

READ ONLY. Does not modify production code, config, lexicon, benchmark, checkpoint,
or tests. Instruments FuzzyPool internals by replicating pool.py sort/dedup locally.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.contract import (
    DOMAIN_SLOT_IDS,
    FUZZY_DISTANCE_THRESHOLD,
    FUZZY_LEN_DELTA_MAX,
    FUZZY_POOL_MAX_CANDIDATES,
)
from training.model2.fuzzy.pool import FuzzyPoolHit
from training.model2.phonetic.syllables import levenshtein_syllables, normalize_syllable
from training.model2.retrieval.finespan import (
    LATTICE_WINDOW_MAX_SYLLABLES,
    LATTICE_WINDOW_MIN_SYLLABLES,
    FineSpanView,
)
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    execute_domain_action,
)
from training.model2_v3.policy.multitag import load_ssot_word_domains
from training.model2_v3.policy.stage_d_target_identity_v1 import (
    identities_in_term_ids,
    lexical_identity_key,
    target_hit,
)
from training.model2_v3.scripts.run_v3_stage_j_benchmark_v2_expand import corrupt_for_relation
from training.model2_v3.scripts.run_v3_stage_j_prod_benchmark_expand import build_correct_profile
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_soft_prior_yield_audit"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
SSOT_CSV = ROOT / "electron_node/docs/lexicon-assets/full_rebuild_v1/term_domain_tags_corrected.csv"
PHASE2 = ROOT / "training/model2_v3/dataset/policy_phase2/rows.jsonl"
V2_D = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2/dataset/d_only.jsonl"
V2_CF = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2/dataset/counterfactual.jsonl"
ZERO_DOMAINS = ("tech_ai", "meeting", "medical")
ZERO_RELS = ("sh_s", "eng_en", "h_f")
SOFT_BOOST = 2.5
DOMAIN_MAX_CANDS = 8
DOMAIN_POOL_SIZE = 32
BASE_POOL_SIZE = 16


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("wrote", path.name, "n=", len(rows), flush=True)


def dump_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print("wrote", path.name, "n=", len(rows), flush=True)


def pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 4) if d else 0.0


def rank_bucket(rank: Optional[int]) -> str:
    if rank is None:
        return "not_returned"
    if rank == 1:
        return "rank_1"
    if rank == 2:
        return "rank_2"
    if rank <= 4:
        return "rank_3_4"
    if rank <= 8:
        return "rank_5_8"
    return "rank_gt_8"


def hit_to_dict(h: FuzzyPoolHit) -> dict:
    return {
        "term_id": h.term_id,
        "surface": h.surface,
        "pinyin_key": h.pinyin_key,
        "syllables": list(h.syllables),
        "distance": h.distance,
        "term_type": h.term_type,
        "prior_score": h.prior_score,
    }


def inspect_fuzzy(index, syls: list[str], *, dist_th: int = FUZZY_DISTANCE_THRESHOLD, len_delta: int = FUZZY_LEN_DELTA_MAX) -> dict:
    """Replicate pool.py scoring/dedup WITHOUT capping, then apply caps.

    Does not modify production pool.py.
    """
    q = [normalize_syllable(s) for s in syls if normalize_syllable(s)]
    if not q:
        return {
            "query": [],
            "n_length_bucket": 0,
            "n_distance_pass": 0,
            "pre_dedup": [],
            "post_dedup_unlimited": [],
        }
    candidates = []
    for delta in range(-len_delta, len_delta + 1):
        candidates.extend(index.by_syllable_count.get(len(q) + delta, []))
    scored: list[FuzzyPoolHit] = []
    for c in candidates:
        dist = levenshtein_syllables(q, c.syllables)
        if dist > dist_th:
            continue
        scored.append(
            FuzzyPoolHit(
                term_id=c.term_id,
                surface=c.surface,
                pinyin_key=c.pinyin_key,
                syllables=c.syllables,
                distance=dist,
                syllable_count=c.syllable_count,
                term_type=c.term_type,
                prior_score=c.prior_score,
            )
        )
    scored.sort(key=lambda h: (h.distance, -h.prior_score, h.term_id))
    seen: set[str] = set()
    uniq: list[FuzzyPoolHit] = []
    dropped_same_surface: list[FuzzyPoolHit] = []
    for h in scored:
        if h.surface in seen:
            dropped_same_surface.append(h)
            continue
        seen.add(h.surface)
        uniq.append(h)
    return {
        "query": q,
        "n_length_bucket": len(candidates),
        "n_distance_pass": len(scored),
        "pre_dedup": scored,
        "post_dedup_unlimited": uniq,
        "dedup_dropped": dropped_same_surface,
    }


def identity_rank(hits: list[FuzzyPoolHit], want: tuple[str, str], index) -> Optional[int]:
    for i, h in enumerate(hits, start=1):
        rec = index.by_term_id.get(h.term_id)
        if rec and lexical_identity_key(rec) == want:
            return i
    return None


def identity_present(term_ids: list[str], want: tuple[str, str], index) -> bool:
    return want in identities_in_term_ids(index, term_ids)


def classify_base_visibility(index, rec, base_ids: list[str], insp: dict, want: tuple[str, str]) -> str:
    tid_hit = rec.term_id in set(base_ids)
    ident = identity_present(base_ids, want, index)
    if not ident:
        return "BASE_ABSENT"
    # exact vs fuzzy vs sibling
    pre = insp["pre_dedup"]
    for h in pre:
        r = index.by_term_id.get(h.term_id)
        if not r or lexical_identity_key(r) != want:
            continue
        if h.distance == 0 and h.surface == rec.surface:
            if tid_hit:
                return "BASE_VISIBLE_EXACT"
            return "BASE_VISIBLE_SIBLING_IDENTITY"
        if h.distance == 0:
            return "BASE_VISIBLE_SIBLING_IDENTITY"
        return "BASE_VISIBLE_FUZZY"
    if ident and not tid_hit:
        return "BASE_VISIBLE_SIBLING_IDENTITY"
    return "BASE_VISIBLE_FUZZY"


def soft_rerank(index, pool_hits: list[FuzzyPoolHit], domain_weights: dict[str, float], *, max_cands: int = DOMAIN_MAX_CANDS):
    ranked: list[tuple[float, str, int]] = []
    for h in pool_hits:
        rec = index.by_term_id.get(h.term_id)
        doms = list((rec.domain_ids if rec else []) or [])
        match = sum(float(domain_weights.get(d) or 0.0) for d in doms)
        score = float(h.distance) - SOFT_BOOST * match - 1e-4 * float(h.prior_score)
        ranked.append((score, h.term_id, h.distance))
    ranked.sort()
    return ranked[:max_cands], ranked


def focused_weights(user_ev: dict[str, float], domain_id: str) -> dict[str, float]:
    sel = float(user_ev.get(domain_id) or 0.0)
    focused = {d: 0.05 * float(user_ev.get(d) or 0.0) for d in DOMAIN_SLOT_IDS}
    focused[domain_id] = max(0.35, sel)
    s = sum(focused.values()) or 1.0
    return {k: v / s for k, v in focused.items()}


def action_availability(rec) -> dict:
    tags = [d for d in (rec.domain_ids or []) if d in DOMAIN_SLOT_IDS]
    catalog_ids = {a.domain_id for a in DOMAIN_ACTION_CATALOG if a.kind == "domain_soft"}
    if not tags:
        unreg = [d for d in (rec.domain_ids or []) if d and d not in DOMAIN_SLOT_IDS]
        if unreg:
            return {"status": "DOMAIN_NOT_REGISTERED", "oracle_domain": None, "unregistered": unreg}
        return {"status": "PROFILE_TO_ACTION_MAPPING_MISSING", "oracle_domain": None}
    primary = tags[0]
    if primary in catalog_ids:
        return {"status": "ACTION_AVAILABLE", "oracle_domain": primary, "all_tags": tags}
    return {"status": "ACTION_NOT_GENERATED", "oracle_domain": primary}


def make_span(rec, syls: list[str]) -> FineSpanView:
    return FineSpanView(
        span_id=f"audit-{hashlib.md5((rec.term_id + '|' + '|'.join(syls)).encode()).hexdigest()[:12]}",
        syllable_start=0,
        syllable_end=len(syls),
        span_syllables=list(syls),
        window_text=rec.surface or "",
        window_pinyin_key="|".join(syls),
        raw_start=0,
        raw_end=len(rec.surface or ""),
        source="stage_j_yield_audit",
    )


def trace_span(index, rec, syls: list[str], cfg, profile: dict, *, relation: Optional[str], mode: str) -> dict:
    want = lexical_identity_key(rec)
    span = make_span(rec, syls)
    avail = action_availability(rec)
    oracle_dom = avail.get("oracle_domain")
    ev = dict(profile.get("long_term_domain_evidence") or {})
    insp = inspect_fuzzy(index, syls)
    pre = insp["pre_dedup"]
    uniq = insp["post_dedup_unlimited"]
    pool16 = uniq[:BASE_POOL_SIZE]
    pool32 = uniq[:DOMAIN_POOL_SIZE]
    base_ids = [h.term_id for h in pool16]
    # production base_retrieve_span cross-check
    prod_base = base_retrieve_span(index, span, cfg=cfg)
    base_vis = classify_base_visibility(index, rec, prod_base, insp, want)

    pre_rank = identity_rank(pre, want, index)
    uniq_rank = identity_rank(uniq, want, index)
    pool16_rank = identity_rank(pool16, want, index)
    pool32_rank = identity_rank(pool32, want, index)

    raw_hit = pre_rank is not None
    fuzzy_survived = uniq_rank is not None  # survived distance + surface dedup identity
    # Dedup taxonomy
    dedup_class = None
    if pre_rank is not None and uniq_rank is None:
        # identity fully dropped — unusual unless all siblings dropped? identity is surface+pinyin
        # surface dedup keeps first surface; identity shares surface so should survive unless pinyin differs
        dedup_class = "LEXICAL_TARGET_DROPPED"
    elif pre_rank is not None and uniq_rank is not None:
        kept = uniq[uniq_rank - 1]
        dropped_sibs = [h for h in insp["dedup_dropped"] if h.surface == rec.surface]
        domain_tid_in_pre = any(h.term_id == rec.term_id for h in pre)
        domain_tid_kept = kept.term_id == rec.term_id
        if domain_tid_in_pre and not domain_tid_kept and dropped_sibs:
            dedup_class = "DOMAIN_IDENTITY_DROPPED_BUT_LEXICAL_TARGET_SURVIVED"
        else:
            dedup_class = "LEXICAL_TARGET_SURVIVED"

    # Oracle execute
    action_executed = False
    final_ids: list[str] = []
    n_new = 0
    rerank_full: list[tuple[float, str, int]] = []
    rerank_top: list[tuple[float, str, int]] = []
    target_rerank_rank = None
    if oracle_dom and avail["status"] == "ACTION_AVAILABLE":
        action = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[f"domain_soft:{oracle_dom}"]]
        weights = focused_weights(ev, oracle_dom)
        rerank_top, rerank_full = soft_rerank(index, pool32, weights, max_cands=DOMAIN_MAX_CANDS)
        for i, (_sc, tid, _d) in enumerate(rerank_full, start=1):
            r = index.by_term_id.get(tid)
            if r and lexical_identity_key(r) == want:
                target_rerank_rank = i
                break
        res = execute_domain_action(index, span, action, ev, base_ids=set(prod_base), cfg=cfg, max_cands=DOMAIN_MAX_CANDS)
        action_executed = True
        final_ids = list(res.get("term_ids") or [])
        n_new = int(res.get("n_new") or 0)

    ident_base = identities_in_term_ids(index, prod_base)
    ident_final = identities_in_term_ids(index, final_ids)
    ident_pool32 = identities_in_term_ids(index, [h.term_id for h in pool32])
    new_lex = ident_final - ident_base
    rew_lex = ident_final & ident_base
    if action_executed:
        if new_lex:
            exp_class = "NEW_LEXICAL_CANDIDATES_ADDED"
        elif rew_lex:
            exp_class = "EXISTING_CANDIDATES_REWEIGHTED"
        else:
            exp_class = "NO_EFFECT"
    else:
        exp_class = "NO_EFFECT"

    th = target_hit(index, rec.term_id, final_ids) if final_ids else {"identity_hit": False, "term_id_hit": False, "matched_provenance": []}
    introduced = bool(th.get("identity_hit")) and want not in ident_base

    # loss stage
    loss_stage = None
    if not syls:
        loss_stage = "VALID_FINESPAN"
    elif base_vis != "BASE_ABSENT":
        loss_stage = "BASE_VISIBLE"
    elif avail["status"] != "ACTION_AVAILABLE":
        loss_stage = "ACTION_AVAILABLE"
    elif not raw_hit:
        loss_stage = "RAW_DOMAIN_HIT"
    elif not fuzzy_survived:
        loss_stage = "FUZZY_FILTER"
    elif uniq_rank is not None and uniq_rank > DOMAIN_POOL_SIZE:
        loss_stage = "DOMAIN_POOL_CAP"
    elif target_rerank_rank is None:
        loss_stage = "MERGE_OR_RERANK"
    elif target_rerank_rank > DOMAIN_MAX_CANDS:
        loss_stage = "DOMAIN_TOPK"
    elif not introduced:
        loss_stage = "BUDGET_OR_IDENTITY"
    else:
        loss_stage = None

    raw_miss_reason = None
    if not raw_hit:
        qn = len(insp["query"])
        tn = len(rec.syllables or [])
        if abs(qn - tn) > FUZZY_LEN_DELTA_MAX:
            raw_miss_reason = "span_length"
        elif insp["n_length_bucket"] == 0:
            raw_miss_reason = "candidate_index_omission"
        else:
            # compute actual distance to target
            q = insp["query"]
            dist = levenshtein_syllables(q, list(rec.syllables or []))
            if dist > FUZZY_DISTANCE_THRESHOLD:
                raw_miss_reason = "phonetic_fuzzy_condition"
            else:
                raw_miss_reason = "query_key_mismatch_or_other"

    return {
        "mode": mode,
        "relation": relation,
        "target_term_id": rec.term_id,
        "target_surface": rec.surface,
        "target_pinyin_key": rec.pinyin_key,
        "target_domains": list(rec.domain_ids or []),
        "span_syllables": list(syls),
        "want_identity": list(want),
        "base_visibility": base_vis,
        "action_availability": avail["status"],
        "oracle_domain": oracle_dom,
        "action_executed": action_executed,
        "raw_query_hit": raw_hit,
        "raw_miss_reason": raw_miss_reason,
        "fuzzy_survived": fuzzy_survived,
        "dedup_class": dedup_class,
        "pre_dedup_rank": pre_rank,
        "unlimited_dedup_rank": uniq_rank,
        "pool16_rank": pool16_rank,
        "pool32_rank": pool32_rank,
        "rerank_rank": target_rerank_rank,
        "rerank_rank_bucket": rank_bucket(target_rerank_rank),
        "n_length_bucket": insp["n_length_bucket"],
        "n_distance_pass": insp["n_distance_pass"],
        "n_post_dedup_unlimited": len(uniq),
        "prod_base_n": len(prod_base),
        "final_n": len(final_ids),
        "n_new_term_ids": n_new,
        "n_new_lexical": len(new_lex),
        "n_reweighted_lexical": len(rew_lex),
        "expansion_class": exp_class,
        "identity_in_base": want in ident_base,
        "identity_in_pool32": want in ident_pool32,
        "identity_in_final": want in ident_final,
        "term_id_in_final": rec.term_id in set(final_ids),
        "final_introduced": introduced,
        "matched_provenance": th.get("matched_provenance") if final_ids else [],
        "loss_stage": loss_stage,
        "query_universe_changed_by_profile": False,
        "note_query_universe": "UserProfile does not affect FuzzyPool generation (pool.py L84-85). Profile only changes domain_weights used at rerank.",
    }


def git_inventory() -> list[dict]:
    r = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    rows = []
    production_prefixes = (
        "training/model2/",
        "training/model2_v3/policy/",
        "electron_node/",
        "central_server/",
    )
    production_exclude = (
        "training/model2_v3/scripts/run_v3_stage_j_soft_prior_yield_architecture_drift_audit.py",
        "training/model2_v3/experiments/v3_stage_j_soft_prior_yield_audit/",
        "docs/user_correction/Lingua_Model2_V3_StageJ_Lexicon_Soft_Prior_Yield_Architecture_Drift_Audit_",
    )
    for line in (r.stdout or "").splitlines():
        if len(line) < 4:
            continue
        status, path = line[:2].strip(), line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[-1]
        is_prod = path.startswith(production_prefixes) and not any(path.startswith(x) or x in path for x in production_exclude)
        # scripts under model2_v3/scripts that are NEW audit scripts are not production runtime
        if path.startswith("training/model2_v3/scripts/") and "soft_prior_yield" in path:
            is_prod = False
        if path.startswith("training/model2_v3/experiments/"):
            is_prod = False
        if path.startswith("docs/user_correction/"):
            is_prod = False
        rows.append(
            {
                "path": path,
                "git_status": status,
                "production_runtime": "YES" if is_prod else "NO",
                "modified": "YES",
            }
        )
    return rows


def main() -> None:
    t0 = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    print("load index", flush=True)
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    rng = random.Random(17)
    ssot = load_ssot_word_domains(SSOT_CSV)

    domain_recs = [r for r in index.records if r.term_type == "domain"]
    base_recs = [r for r in index.records if r.term_type == "base"]
    by_ident: dict[tuple[str, str], list] = defaultdict(list)
    for r in domain_recs:
        by_ident[lexical_identity_key(r)].append(r)
    unique_idents = sorted(by_ident.keys(), key=lambda k: (k[0], k[1]))
    print(f"domain records={len(domain_recs)} unique identities={len(unique_idents)} base={len(base_recs)}", flush=True)

    # ---- tag integrity ----
    tag_tax = Counter()
    per_domain_terms = Counter()
    multi_tag_n = 0
    missing_tag = 0
    first_tag_collapse = 0
    orphan_ssot = 0
    ssot_missing_on_term = 0
    duplicate_ident = 0
    index_surfaces = {r.surface for r in domain_recs}
    for w, ds in ssot.items():
        if w not in index_surfaces and w not in index.by_surface:
            orphan_ssot += 1
    pop_rows = []
    canonical = []
    for ident, recs in by_ident.items():
        rec = sorted(recs, key=lambda x: (-len(x.domain_ids or []), x.term_id))[0]
        canonical.append(rec)
        tags = [d for d in (rec.domain_ids or []) if d in DOMAIN_SLOT_IDS]
        extra = [d for d in (rec.domain_ids or []) if d and d not in DOMAIN_SLOT_IDS]
        ssot_ds = ssot.get(rec.surface) or set()
        if len(recs) > 1:
            duplicate_ident += 1
            tag_tax["duplicate_lexical_identity"] += 1
        if not tags:
            missing_tag += 1
            tag_tax["missing_tag"] += 1
        if extra:
            tag_tax["wrong_domain_mapping"] += 1
        if len(tags) > 1:
            multi_tag_n += 1
            tag_tax["multi_tag_ok"] += 1
        elif len(tags) == 1:
            tag_tax["single_tag"] += 1
            if ssot_ds and len(ssot_ds) > 1:
                first_tag_collapse += 1
                tag_tax["first_tag_only_vs_ssot"] += 1
        if ssot_ds and not ssot_ds.issubset(set(tags)):
            ssot_missing_on_term += 1
            tag_tax["ssot_tags_not_on_record"] += 1
        for d in tags:
            per_domain_terms[d] += 1
        pop_rows.append(
            {
                "surface": rec.surface,
                "pinyin_key": rec.pinyin_key,
                "term_id": rec.term_id,
                "n_sibling_records": len(recs),
                "domain_ids": tags,
                "n_tags": len(tags),
                "ssot_tags": sorted(ssot_ds),
                "has_base_sibling": any(x.term_type == "base" for x in (index.by_surface.get(rec.surface) or [])),
                "syllable_count": rec.syllable_count,
            }
        )

    dump(
        OUT / "term_domain_tag_integrity.json",
        {
            "domain_type_records": len(domain_recs),
            "unique_lexical_identities": len(unique_idents),
            "ssot_csv_words": len(ssot),
            "taxonomy": dict(tag_tax),
            "missing_tag": missing_tag,
            "multi_tag_identities": multi_tag_n,
            "first_tag_collapse_vs_ssot": first_tag_collapse,
            "ssot_tags_not_on_record": ssot_missing_on_term,
            "orphan_ssot_words_not_in_index_surface": orphan_ssot,
            "duplicate_lexical_identity_groups": duplicate_ident,
            "per_domain_unique_identities": dict(per_domain_terms),
            "ssot_path": str(SSOT_CSV.as_posix()),
            "index_path": str(IDX.as_posix()),
            "note": "D2 index is already enrich_index_multitag applied. Unenriched sqlite flatten is first-tag-only in index.py L118.",
        },
    )
    dump(
        OUT / "domain_target_population.json",
        {
            "reported_v2_scan": 655,
            "actual_domain_type_records": len(domain_recs),
            "actual_unique_identities": len(unique_idents),
            "actual_unique_surfaces": len({r.surface for r in domain_recs}),
            "per_domain": dict(per_domain_terms),
            "zero_eligible_domains_v2": list(ZERO_DOMAINS),
            "population_unit": "unique (surface, pinyin_key) among term_type=domain",
        },
    )

    # ---- exact + corrupted traces ----
    exact_traces = []
    corrupt_traces = []
    vis_exact = Counter()
    vis_corrupt = Counter()
    rel_stats = {rel: Counter() for rel in ACTIVE_SET_V1}
    domain_stats = {d: Counter() for d in DOMAIN_SLOT_IDS}

    print("trace exact FineSpan for all unique domain identities", flush=True)
    profiles_cache: dict[str, dict] = {}
    for i, rec in enumerate(canonical):
        if i % 50 == 0:
            print(f"  exact {i}/{len(canonical)}", flush=True)
        key = rec.term_id
        if key not in profiles_cache:
            profiles_cache[key] = build_correct_profile(index, rec, rng, n_terms=8, confirms=5)
        syls = list(rec.syllables or [])
        valid_fs = LATTICE_WINDOW_MIN_SYLLABLES <= len(syls) <= LATTICE_WINDOW_MAX_SYLLABLES
        if not valid_fs:
            exact_traces.append(
                {
                    "mode": "exact",
                    "target_term_id": rec.term_id,
                    "target_surface": rec.surface,
                    "target_domains": list(rec.domain_ids or []),
                    "span_syllables": syls,
                    "base_visibility": "INVALID_FINESPAN",
                    "valid_finespan": False,
                    "loss_stage": "VALID_FINESPAN",
                    "action_availability": action_availability(rec)["status"],
                    "raw_query_hit": False,
                    "final_introduced": False,
                    "identity_in_base": False,
                    "action_executed": False,
                    "expansion_class": "NO_EFFECT",
                    "n_new_lexical": 0,
                    "oracle_domain": action_availability(rec).get("oracle_domain"),
                    "dedup_class": None,
                    "rerank_rank_bucket": "not_returned",
                    "raw_miss_reason": "span_length",
                }
            )
            vis_exact["INVALID_FINESPAN"] += 1
            continue
        tr = trace_span(index, rec, syls, cfg, profiles_cache[key], relation=None, mode="exact")
        tr["valid_finespan"] = True
        exact_traces.append(tr)
        vis_exact[tr["base_visibility"]] += 1
        for d in tr["target_domains"]:
            if d in domain_stats:
                domain_stats[d]["exact_n"] += 1
                domain_stats[d][f"exact_{tr['base_visibility']}"] += 1

    print("trace relation-corrupted FineSpans", flush=True)
    for i, rec in enumerate(canonical):
        if i % 50 == 0:
            print(f"  corrupt {i}/{len(canonical)}", flush=True)
        prof = profiles_cache[rec.term_id]
        syls0 = list(rec.syllables or [])
        if not (LATTICE_WINDOW_MIN_SYLLABLES <= len(syls0) <= LATTICE_WINDOW_MAX_SYLLABLES):
            continue
        for rel in ACTIVE_SET_V1:
            obs = corrupt_for_relation(syls0, rel, random.Random(17 + i))
            if not obs:
                rel_stats[rel]["no_applicable_edit"] += 1
                continue
            rel_stats[rel]["attempted"] += 1
            tr = trace_span(index, rec, obs, cfg, prof, relation=rel, mode="corrupted")
            tr["valid_finespan"] = True
            corrupt_traces.append(tr)
            vis_corrupt[tr["base_visibility"]] += 1
            rel_stats[rel][tr["base_visibility"]] += 1
            if tr["final_introduced"]:
                rel_stats[rel]["introduced"] += 1
            if tr["base_visibility"] == "BASE_ABSENT" and tr["raw_query_hit"]:
                rel_stats[rel]["true_d_opportunity"] += 1
            for d in tr["target_domains"]:
                if d in domain_stats:
                    domain_stats[d]["corrupt_n"] += 1
                    domain_stats[d][tr["base_visibility"]] += 1
                    if tr["final_introduced"]:
                        domain_stats[d]["introduced"] += 1
                    if tr["base_visibility"] == "BASE_ABSENT" and tr["raw_query_hit"]:
                        domain_stats[d]["true_d_opportunity"] += 1

    def funnel_from(traces: list[dict], population_n: int, label: str) -> list[dict]:
        def n_ok(pred) -> int:
            return sum(1 for t in traces if pred(t))

        valid_tag = [t for t in traces if t.get("action_availability") != "PROFILE_TO_ACTION_MAPPING_MISSING" or t.get("target_domains")]
        # stages chained
        stages = []

        def add(name, input_n, survive_n, cause):
            lost = input_n - survive_n
            stages.append(
                {
                    "funnel": label,
                    "stage": name,
                    "input_n": input_n,
                    "survive_n": survive_n,
                    "lost_n": lost,
                    "survival_pct": pct(survive_n, input_n),
                    "loss_pct": pct(lost, input_n),
                    "primary_cause": cause,
                }
            )

        add("Domain population", population_n, population_n, "unique domain lexical identities")
        n_tags = sum(1 for t in traces if t.get("target_domains"))
        add("Valid tags", population_n, n_tags, "missing/unregistered domain_ids")
        n_fs = sum(1 for t in traces if t.get("valid_finespan"))
        add("Valid FineSpan", n_tags, n_fs, "syllable length outside lattice 1..5")
        n_abs = sum(1 for t in traces if t.get("valid_finespan") and t.get("base_visibility") == "BASE_ABSENT")
        add("Base absent", n_fs, n_abs, "target identity already in base FuzzyPool@16")
        n_act = sum(1 for t in traces if t.get("base_visibility") == "BASE_ABSENT" and t.get("action_availability") == "ACTION_AVAILABLE")
        add("Action available", n_abs, n_act, "domain not in DOMAIN_SLOT_IDS / catalog")
        n_raw = sum(1 for t in traces if t.get("base_visibility") == "BASE_ABSENT" and t.get("action_availability") == "ACTION_AVAILABLE" and t.get("raw_query_hit"))
        add("Raw domain hit", n_act, n_raw, "phonetic distance>2 or length bucket miss (no domain SQL)")
        n_fuz = sum(1 for t in traces if t.get("base_visibility") == "BASE_ABSENT" and t.get("raw_query_hit") and t.get("fuzzy_survived"))
        add("Fuzzy survive", n_raw, n_fuz, "surface-dedup dropped identity or distance gate")
        n_merge = sum(1 for t in traces if t.get("base_visibility") == "BASE_ABSENT" and t.get("identity_in_pool32"))
        add("Merge survive", n_fuz, n_merge, "not in phonetic pool32 (shared top-k, not union query)")
        n_ded = n_merge  # identity-level; domain term_id may still be dropped
        add("Dedup survive (lexical identity)", n_merge, n_ded, "identity usually kept; domain: term_id often dropped")
        n_top = sum(1 for t in traces if t.get("base_visibility") == "BASE_ABSENT" and t.get("rerank_rank") is not None and t.get("rerank_rank") <= DOMAIN_MAX_CANDS)
        add("Top-k survive", n_ded, n_top, "soft rerank rank > 8")
        n_bud = n_top
        add("Budget survive", n_top, n_bud, "domain max_cands=8 already applied as top-k")
        n_out = sum(1 for t in traces if t.get("final_introduced"))
        add("Model2 output / FINAL INTRODUCED", n_bud, n_out, "oracle execute identity in final top-8 and base-absent")
        add("Downstream visible", n_out, n_out, "Python Stage D path does not run Node sameDomain; T8/T9 not in this pipeline")
        return stages

    exact_valid = [t for t in exact_traces if t.get("mode") == "exact"]
    funnel_exact = funnel_from(exact_valid, len(unique_idents), "exact_lexical_finespan")
    funnel_corrupt = funnel_from(corrupt_traces, len(corrupt_traces), "relation_corrupted_observations")

    dump(OUT / "soft_prior_attrition_funnel.json", {"funnels": {"exact": funnel_exact, "corrupted": funnel_corrupt}})
    # flatten csv
    dump_csv(
        OUT / "soft_prior_attrition_funnel.csv",
        funnel_exact + funnel_corrupt,
        ["funnel", "stage", "input_n", "survive_n", "lost_n", "survival_pct", "loss_pct", "primary_cause"],
    )

    dump(
        OUT / "base_visibility_breakdown.json",
        {
            "exact_finespan": dict(vis_exact),
            "exact_n": len(exact_traces),
            "exact_pct": {k: pct(v, max(1, sum(vis_exact.values()))) for k, v in vis_exact.items()},
            "corrupted_observations": dict(vis_corrupt),
            "corrupted_n": len(corrupt_traces),
            "corrupted_pct": {k: pct(v, max(1, sum(vis_corrupt.values()))) for k, v in vis_corrupt.items()},
            "why_base_visible": {
                "base_retrieve_uses_mixed_index": True,
                "file": "training/model2/retrieval/finespan_retrieval.py",
                "function": "base_retrieve_span",
                "lines": "89-107",
                "domain_records_in_same_fuzzypool": True,
                "surface_dedup_prefers_base_term_id_on_tie": "term_id ASC so 'base:' < 'domain:'",
            },
        },
    )

    # oracle availability among BASE_ABSENT corrupted
    abs_c = [t for t in corrupt_traces if t["base_visibility"] == "BASE_ABSENT"]
    avail_c = Counter(t["action_availability"] for t in abs_c)
    dump(
        OUT / "oracle_domain_action_availability.json",
        {
            "base_absent_corrupted_n": len(abs_c),
            "status_counts": dict(avail_c),
            "catalog": [a.action_id for a in DOMAIN_ACTION_CATALOG],
            "catalog_source": "training/model2_v3/policy/domain_actions.py build_domain_action_catalog / DOMAIN_SLOT_IDS",
            "note": "Catalog is static 12 slots + domain_none, not built from live Lexicon at Python Stage D eval start. Node registry is separate.",
        },
    )

    raw_abs = [t for t in abs_c if t["action_availability"] == "ACTION_AVAILABLE"]
    raw_hit = [t for t in raw_abs if t["raw_query_hit"]]
    raw_miss = [t for t in raw_abs if not t["raw_query_hit"]]
    dump(
        OUT / "raw_domain_query_yield.json",
        {
            "definition": "RAW = identity present in FuzzyPool scored set (distance<=2, length±1) BEFORE surface dedup. There is NO domain-tag SQL query on the Python Stage D path.",
            "base_absent_and_action_available": len(raw_abs),
            "RAW_QUERY_HIT": len(raw_hit),
            "RAW_QUERY_MISS": len(raw_miss),
            "hit_rate": pct(len(raw_hit), len(raw_abs)),
            "code": {
                "file": "training/model2_v3/policy/domain_actions.py",
                "function": "soft_domain_retrieve",
                "lines": "59-108",
                "actual_query": "build_fuzzy_pool(..., max_pool_size=32) — same phonetic universe as base",
            },
        },
    )
    miss_tax = Counter(t.get("raw_miss_reason") or "other" for t in raw_miss)
    dump(
        OUT / "raw_domain_query_miss_taxonomy.json",
        {
            "n": len(raw_miss),
            "taxonomy": dict(miss_tax),
            "no_domain_tag_predicate_on_this_path": True,
            "historical_sql_exists_on_node": {
                "file": "electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts",
                "function": "queryDomainMultiRowsAtomic",
                "lines": "111-153",
                "predicate": "domain_id IN (...) AND pinyin_key = ? AND length(word) = ?",
                "used_by_python_stage_d": False,
            },
        },
    )

    fuz_drop = [t for t in raw_hit if not t["fuzzy_survived"]]
    dump(
        OUT / "fuzzy_filter_attrition.json",
        {
            "raw_hit_n": len(raw_hit),
            "FUZZY_FILTER_SURVIVED": len(raw_hit) - len(fuz_drop),
            "FUZZY_FILTER_DROPPED": len(fuz_drop),
            "gates": {
                "distance_threshold": FUZZY_DISTANCE_THRESHOLD,
                "len_delta_max": FUZZY_LEN_DELTA_MAX,
                "file": "training/model2/fuzzy/pool.py",
                "function": "build_fuzzy_pool",
                "lines": "78-147",
            },
            "note": "Distance filter is applied before RAW_HIT in this audit; FUZZY_FILTER_DROPPED here is post-score surface-dedup identity loss, which is rare because identity key includes surface.",
        },
    )

    ded_c = Counter(t.get("dedup_class") for t in corrupt_traces if t.get("dedup_class"))
    dump(
        OUT / "surface_dedup_attrition.json",
        {
            "corrupted_n": len(corrupt_traces),
            "taxonomy": dict(ded_c),
            "sort": "distance ASC, prior DESC, term_id ASC",
            "first_wins_per_surface": True,
            "base_term_id_sorts_before_domain": True,
            "file": "training/model2/fuzzy/pool.py",
            "lines": "124-135",
            "original_purpose": "Avoid duplicate surface slots / candidate explosion — NOT documented as base>domain precedence",
            "precedence_status": "UNJUSTIFIED_IMPLEMENTATION_BEHAVIOR (tie-break term_id ASC)",
        },
    )

    rank_hist = Counter(t.get("rerank_rank_bucket") for t in abs_c)
    dump(
        OUT / "domain_topk_attrition.json",
        {
            "base_absent_n": len(abs_c),
            "rank_histogram_after_soft_rerank_on_pool32": dict(rank_hist),
            "max_cands": DOMAIN_MAX_CANDS,
            "pool_size": DOMAIN_POOL_SIZE,
            "score": "distance - 2.5 * domain_match - 1e-4 * prior",
            "file": "training/model2_v3/policy/domain_actions.py",
            "function": "soft_domain_retrieve",
            "lines": "88-99",
        },
    )

    dump(
        OUT / "candidate_budget_attrition.json",
        {
            "owners": [
                {"owner": "FuzzyPool max_pool_size base", "value": BASE_POOL_SIZE, "file": "finespan_retrieval.py:103"},
                {"owner": "FuzzyPool max_pool_size domain", "value": DOMAIN_POOL_SIZE, "file": "domain_actions.py:67,86"},
                {"owner": "domain soft top-k / max_cands", "value": DOMAIN_MAX_CANDS, "file": "domain_actions.py:66,99"},
                {"owner": "ProfileRetrievalConfig.max_total_profile_candidates", "value": 8, "file": "spike_retriever.py:23"},
                {"owner": "Node applyDomainPriorQuota prior slots", "value": 2, "file": "apply-domain-prior-quota.ts:65", "in_python_stage_d": False},
            ],
            "BUDGET_STACKING": True,
            "stack": "phonetic distance filter → surface dedup → pool cap 32 → soft rerank top-8 (Python). Node later: per-span limit + prior quota 2.",
            "no_sql_topk_on_python_path": True,
        },
    )

    # expansion vs reweighting
    def exp_stats(traces, executed_only=True):
        xs = [t for t in traces if t.get("action_executed")] if executed_only else traces
        c = Counter(t.get("expansion_class") for t in xs)
        intro = sum(1 for t in xs if t.get("final_introduced"))
        oracle_valid = [t for t in xs if t.get("action_availability") == "ACTION_AVAILABLE"]
        return {
            "executed_n": len(xs),
            "classes": dict(c),
            "Expansion_Yield": round(c.get("NEW_LEXICAL_CANDIDATES_ADDED", 0) / max(1, len(xs)), 6),
            "Target_Expansion_Yield": round(intro / max(1, len(oracle_valid)), 6),
            "new_lexical_n": c.get("NEW_LEXICAL_CANDIDATES_ADDED", 0),
            "reweighted_n": c.get("EXISTING_CANDIDATES_REWEIGHTED", 0),
            "no_effect_n": c.get("NO_EFFECT", 0),
            "target_introduced_n": intro,
        }

    dump(
        OUT / "expansion_vs_reweighting.json",
        {
            "exact_finespan": exp_stats(exact_traces),
            "corrupted_all_executed": exp_stats(corrupt_traces),
            "corrupted_base_absent_only": exp_stats(abs_c),
            "definition_new_lexical": "identities in domain top-8 that were not in base pool@16",
            "definition_reweighted": "identities in both base@16 and domain top-8",
        },
    )

    # true D opportunity + retention
    valid_exact = [t for t in exact_traces if t.get("valid_finespan") and t.get("target_domains")]
    opp_exact = [t for t in valid_exact if t["base_visibility"] == "BASE_ABSENT" and t["raw_query_hit"]]
    intro_exact = [t for t in valid_exact if t.get("final_introduced")]
    valid_c = [t for t in corrupt_traces if t.get("valid_finespan")]
    opp_c = [t for t in valid_c if t["base_visibility"] == "BASE_ABSENT" and t["raw_query_hit"]]
    intro_c = [t for t in valid_c if t.get("final_introduced")]
    # per-term any-relation opportunity
    terms_any_opp = {t["target_term_id"] for t in opp_c}
    terms_any_intro = {t["target_term_id"] for t in intro_c}
    terms_any_abs = {t["target_term_id"] for t in abs_c}

    dump(
        OUT / "true_d_opportunity_rate.json",
        {
            "formula": "BASE_ABSENT AND ORACLE_DOMAIN_RAW_QUERY_CAN_RECOVER / valid domain target cases",
            "exact_finespan": {
                "valid_n": len(valid_exact),
                "opportunity_n": len(opp_exact),
                "TRUE_D_OPPORTUNITY_RATE": round(len(opp_exact) / max(1, len(valid_exact)), 6),
                "final_introduced_n": len(intro_exact),
            },
            "corrupted_observations": {
                "valid_n": len(valid_c),
                "opportunity_n": len(opp_c),
                "TRUE_D_OPPORTUNITY_RATE": round(len(opp_c) / max(1, len(valid_c)), 6),
                "final_introduced_n": len(intro_c),
            },
            "per_term_any_relation": {
                "unique_terms": len(canonical),
                "any_base_absent": len(terms_any_abs),
                "any_true_d_opportunity": len(terms_any_opp),
                "any_final_introduced": len(terms_any_intro),
                "TRUE_D_OPPORTUNITY_RATE_PER_TERM": round(len(terms_any_opp) / max(1, len(canonical)), 6),
            },
        },
    )
    dump(
        OUT / "domain_pipeline_retention.json",
        {
            "formula": "FINAL_INTRODUCED / RAW_DOMAIN_QUERY_HIT among BASE_ABSENT+ACTION_AVAILABLE",
            "corrupted": {
                "RAW_DOMAIN_QUERY_HIT": len(raw_hit),
                "FINAL_INTRODUCED": sum(1 for t in raw_hit if t.get("final_introduced")),
                "DOMAIN_PIPELINE_RETENTION": round(
                    sum(1 for t in raw_hit if t.get("final_introduced")) / max(1, len(raw_hit)), 6
                ),
            },
            "exact": {
                "RAW_DOMAIN_QUERY_HIT": sum(1 for t in valid_exact if t.get("raw_query_hit")),
                "FINAL_INTRODUCED": len(intro_exact),
                "note": "exact FineSpan almost always BASE_VISIBLE so introduced=0 even if raw hit",
            },
        },
    )

    # root cause buckets on corrupted (production-like) + exact note
    def bucket(t) -> str:
        if t.get("base_visibility") != "BASE_ABSENT":
            return "A_NO_D_OPPORTUNITY"
        if not t.get("raw_query_hit"):
            return "B_DATA_OR_INDEX_LIMITATION"
        if t.get("raw_query_hit") and not t.get("final_introduced"):
            return "C_RETRIEVAL_PIPELINE_ATTRITION"
        if t.get("final_introduced"):
            return "D_MODEL_SELECTION_OPPORTUNITY"
        return "UNKNOWN"

    buck_c = Counter(bucket(t) for t in corrupt_traces)
    buck_e = Counter(bucket(t) for t in exact_traces)
    dump(
        OUT / "root_cause_buckets.json",
        {
            "exact_finespan": dict(buck_e),
            "corrupted_observations": dict(buck_c),
            "corrupted_pct": {k: pct(v, len(corrupt_traces)) for k, v in buck_c.items()},
            "definitions": {
                "A_NO_D_OPPORTUNITY": "Base already sufficient (identity in base FuzzyPool@16)",
                "B_DATA_OR_INDEX_LIMITATION": "Base absent but phonetic raw scan misses target",
                "C_RETRIEVAL_PIPELINE_ATTRITION": "Raw hit but not in final top-8",
                "D_MODEL_SELECTION_OPPORTUNITY": "Oracle+pipeline introduce target — Model2 must choose action",
            },
        },
    )

    # rank 17-32 window — the only expansion slice
    window_1732 = sum(1 for t in corrupt_traces if t.get("unlimited_dedup_rank") and 17 <= t["unlimited_dedup_rank"] <= 32)
    dump(
        OUT / "phonetic_rank_window.json",
        {
            "corrupted_in_ranks_17_32_unlimited_dedup": window_1732,
            "note": "Only identities outside base@16 but inside pool@32 can be introduced by current soft_domain_retrieve. This is a 16-slot expansion window, not a domain query.",
        },
    )

    # profile effect sample
    sample_abs = [t for t in abs_c if t.get("action_availability") == "ACTION_AVAILABLE"][:80]
    prof_rows = []
    for t in sample_abs:
        rec = index.by_term_id[t["target_term_id"]]
        span = make_span(rec, t["span_syllables"])
        base = set(base_retrieve_span(index, span, cfg=cfg))
        oracle = t["oracle_domain"]
        action = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[f"domain_soft:{oracle}"]]
        correct_ev = profiles_cache[rec.term_id]["long_term_domain_evidence"]
        wrong_dom = next((d for d in DOMAIN_SLOT_IDS if d != oracle), "coffee")
        variants = {
            "Correct": correct_ev,
            "Empty": {},
            "Wrong": {wrong_dom: 1.0},
            "Swapped": {wrong_dom: 1.0, oracle: 0.0},
        }
        row = {
            "term_id": rec.term_id,
            "surface": rec.surface,
            "span": t["span_syllables"],
            "query_set_identical": True,
            "raw_pool_identical": True,
        }
        for name, ev in variants.items():
            res = execute_domain_action(index, span, action, ev, base_ids=base, cfg=cfg, max_cands=8)
            ids = res.get("term_ids") or []
            row[name] = {
                "n_new": res.get("n_new"),
                "identity_hit": target_hit(index, rec.term_id, ids)["identity_hit"],
                "term_ids_head": ids[:8],
            }
        # same action, different weights → same query, possibly different order
        row["correct_vs_empty_same_ids"] = row["Correct"]["term_ids_head"] == row["Empty"]["term_ids_head"]
        row["correct_vs_wrong_same_ids"] = row["Correct"]["term_ids_head"] == row["Wrong"]["term_ids_head"]
        prof_rows.append(row)
    dump(
        OUT / "profile_retrieval_effect.json",
        {
            "n": len(prof_rows),
            "query_universe_changed_by_profile": False,
            "raw_domain_results_changed_by_profile": False,
            "final_order_may_change": True,
            "correct_vs_empty_same_final_ids_n": sum(1 for r in prof_rows if r["correct_vs_empty_same_ids"]),
            "correct_vs_wrong_same_final_ids_n": sum(1 for r in prof_rows if r["correct_vs_wrong_same_ids"]),
            "empty_still_identity_hit_n": sum(1 for r in prof_rows if r["Empty"]["identity_hit"]),
            "wrong_still_identity_hit_n": sum(1 for r in prof_rows if r["Wrong"]["identity_hit"]),
            "correct_identity_hit_n": sum(1 for r in prof_rows if r["Correct"]["identity_hit"]),
            "causal": "execute_domain_action focuses selected domain to max(0.35, sel) even when evidence is empty. FuzzyPool query is profile-independent.",
            "sample": prof_rows[:12],
        },
    )

    # wrong/swapped causal on V2 counterfactual if present
    cf_tax = Counter()
    cf_n = 0
    if V2_CF.exists():
        cfs = [json.loads(l) for l in V2_CF.open(encoding="utf-8")]
        # group by case
        groups = defaultdict(list)
        for r in cfs:
            groups[r.get("case_id") or r.get("target_term_id")].append(r)
        for _gid, rows in list(groups.items())[:45]:
            variants = {r.get("persona") or r.get("profile_variant") or r.get("cf_type"): r for r in rows}
            # fallback keys
            if not variants:
                continue
            rec_id = rows[0].get("target_term_id")
            rec = index.by_term_id.get(rec_id)
            if not rec:
                continue
            tags = set(rec.domain_ids or [])
            cf_n += 1
            reasons = []
            if len(tags) > 1:
                reasons.append("A_multidomain")
            if len(tags) >= 3:
                reasons.append("B_generic_term")
            reasons.append("D_domain_pool_overlap_shared_fuzzypool")
            reasons.append("E_soft_prior_too_wide_035_floor")
            cf_tax.update(reasons)
    dump(
        OUT / "wrong_swapped_causal_audit.json",
        {
            "v2_counterfactual_groups_sampled": cf_n,
            "reason_counts": dict(cf_tax),
            "primary_mechanism": "Shared phonetic FuzzyPool means Wrong/Swapped still query the same universe; 0.35 domain floor + residual priors rerank within pool32. Multi-tag terms can match a 'wrong' domain that is still on the term.",
            "proportions_note": "Not mutually exclusive; counts are overlapping labels.",
        },
    )

    dump(
        OUT / "generic_overbias_causal_audit.json",
        {
            "linked_to_shared_pool": True,
            "linked_to_domain_budget": True,
            "linked_to_default_035_floor": True,
            "linked_to_domain_fallback": False,
            "evidence": [
                "soft_domain_retrieve always rebuilds phonetic pool32 regardless of evidence magnitude",
                "execute_domain_action sets focused[selected]=max(0.35, sel) even if sel=0",
                "empty-profile eval still executes selected domain_soft action and fills 8 candidate slots",
                "GENERIC_OVERBIAS in V2 blind eval is empty-profile still introducing target",
            ],
            "not_a_hard_filter": True,
        },
    )

    # phase2 length
    p2 = Counter()
    p2_examples = []
    n_p2 = 0
    if PHASE2.exists():
        with PHASE2.open(encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                tid = r.get("target_term_id") or ""
                if not str(tid).startswith("domain:"):
                    continue
                n_p2 += 1
                rec = index.by_term_id.get(tid)
                syls = list((r.get("span") or {}).get("span_syllables") or [])
                term_n = len(rec.syllables) if rec else None
                span_n = len(syls)
                if rec is None:
                    p2["target_not_in_index"] += 1
                    continue
                if span_n < LATTICE_WINDOW_MIN_SYLLABLES or span_n > LATTICE_WINDOW_MAX_SYLLABLES:
                    p2["span_outside_lattice"] += 1
                if term_n is not None and abs(span_n - term_n) > 1:
                    p2["len_mismatch_gt_1"] += 1
                    if len(p2_examples) < 12:
                        p2_examples.append(
                            {
                                "row_id": r.get("row_id"),
                                "target": rec.surface,
                                "term_syllables": rec.syllables,
                                "span_syllables": syls,
                                "asr": r.get("asr_hypothesis"),
                            }
                        )
                elif term_n == span_n:
                    p2["len_equal"] += 1
                else:
                    p2["len_delta_1"] += 1
    dump(
        OUT / "finespan_length_attrition.json",
        {
            "phase2_domain_target_rows": n_p2,
            "taxonomy": dict(p2),
            "examples": p2_examples,
            "v2_generator_gate": "abs(len(span)-len(term.syllables))>1 skipped (run_v3_stage_j_benchmark_v2_expand.py L439-442)",
            "classification": "真实 ASR FineSpan 是 lattice 窗口，不必对齐 gold term 全长。benchmark generator 用 term-length 假设过滤。不是 Model2 FineSpan contract 改变。",
            "FINESPAN_CONTRACT_DRIFT": False,
            "TEST_CONTRACT_ISSUE": True,
        },
    )

    # zero coverage domains
    zero_dom = {}
    for d in ZERO_DOMAINS:
        recs_d = [r for r in canonical if d in (r.domain_ids or [])]
        exact_d = [t for t in exact_traces if d in (t.get("target_domains") or [])]
        cor_d = [t for t in corrupt_traces if d in (t.get("target_domains") or [])]
        zero_dom[d] = {
            "unique_identities": len(recs_d),
            "exact_base_visible": sum(1 for t in exact_d if t.get("base_visibility") not in ("BASE_ABSENT", "INVALID_FINESPAN")),
            "exact_base_absent": sum(1 for t in exact_d if t.get("base_visibility") == "BASE_ABSENT"),
            "corrupt_n": len(cor_d),
            "corrupt_base_absent": sum(1 for t in cor_d if t["base_visibility"] == "BASE_ABSENT"),
            "corrupt_raw_hit_absent": sum(1 for t in cor_d if t["base_visibility"] == "BASE_ABSENT" and t["raw_query_hit"]),
            "corrupt_introduced": sum(1 for t in cor_d if t.get("final_introduced")),
            "primary": "BASE_VISIBLE" if recs_d else "NO_SOURCE_DATA",
        }
        if recs_d and zero_dom[d]["corrupt_introduced"] == 0:
            if zero_dom[d]["corrupt_base_absent"] == 0:
                zero_dom[d]["primary"] = "BASE_VISIBLE"
            elif zero_dom[d]["corrupt_raw_hit_absent"] == 0:
                zero_dom[d]["primary"] = "NO_RAW_QUERY_HIT"
            else:
                zero_dom[d]["primary"] = "TOPK_PRUNE"
    dump(OUT / "domain_zero_coverage_analysis.json", zero_dom)

    zero_rel = {}
    for rel in ZERO_RELS:
        ts = [t for t in corrupt_traces if t.get("relation") == rel]
        zero_rel[rel] = {
            "attempted": rel_stats[rel].get("attempted", 0),
            "no_applicable_edit": rel_stats[rel].get("no_applicable_edit", 0),
            "base_visible": sum(rel_stats[rel].get(k, 0) for k in ("BASE_VISIBLE_EXACT", "BASE_VISIBLE_FUZZY", "BASE_VISIBLE_SIBLING_IDENTITY")),
            "base_absent": rel_stats[rel].get("BASE_ABSENT", 0),
            "true_d_opportunity": rel_stats[rel].get("true_d_opportunity", 0),
            "introduced": rel_stats[rel].get("introduced", 0),
            "primary": "BASE_VISIBLE" if rel_stats[rel].get("BASE_ABSENT", 0) == 0 else ("NO_RAW_QUERY_HIT" if rel_stats[rel].get("true_d_opportunity", 0) == 0 else "TOPK_OR_BUDGET"),
        }
    dump(OUT / "relation_zero_coverage_analysis.json", {**zero_rel, "all_relation_counters": {k: dict(v) for k, v in rel_stats.items()}})

    # traces jsonl — representative
    def pick(traces, pred, n=20):
        out = [t for t in traces if pred(t)]
        return out[:n]

    traces_out = []
    traces_out += [{"trace_class": "BASE_VISIBLE", **t} for t in pick(exact_traces, lambda t: str(t.get("base_visibility", "")).startswith("BASE_VISIBLE"))]
    traces_out += [{"trace_class": "RAW_QUERY_MISS", **t} for t in pick(corrupt_traces, lambda t: t.get("base_visibility") == "BASE_ABSENT" and not t.get("raw_query_hit"))]
    traces_out += [{"trace_class": "RAW_HIT_FINAL_MISS", **t} for t in pick(corrupt_traces, lambda t: t.get("raw_query_hit") and t.get("base_visibility") == "BASE_ABSENT" and not t.get("final_introduced"))]
    traces_out += [{"trace_class": "SUCCESSFUL_INTRODUCTION", **t} for t in pick(corrupt_traces, lambda t: t.get("final_introduced"))]
    # per domain 3
    for d in DOMAIN_SLOT_IDS:
        ds = [t for t in exact_traces if d in (t.get("target_domains") or [])]
        for t in ds[:3]:
            traces_out.append({"trace_class": f"DOMAIN_{d}", **t})
    # V2 eligible as success/production-like
    if V2_D.exists():
        for r in [json.loads(l) for l in V2_D.open(encoding="utf-8")][:20]:
            rec = index.by_term_id.get(r.get("target_term_id"))
            if not rec:
                continue
            syls = list((r.get("span") or {}).get("span_syllables") or [])
            prof = {
                "long_term_domain_evidence": r.get("long_term_domain_evidence") or {},
            }
            tr = trace_span(index, rec, syls, cfg, prof, relation=r.get("relation_hint"), mode="v2_eligible")
            traces_out.append({"trace_class": "V2_ELIGIBLE", **tr})

    dump_jsonl(OUT / "stage_boundary_trace.jsonl", traces_out)

    # compact stage boundary for first 30 successful + misses
    # already in jsonl

    dump(
        OUT / "shadow_path_audit.json",
        {
            "python_stage_d_path": {
                "entry": "training/model2_v3/policy/domain_actions.py:soft_domain_retrieve",
                "second_generator": False,
                "uses_sql_domain_lookup": False,
            },
            "node_historical_domain_sql": {
                "file": "electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts",
                "function": "queryDomainMultiRowsAtomic",
                "also": "electron_node/electron-node/main/src/lexicon/local-span-recall.ts",
            },
            "SHADOW_PATH": "YES_AT_RUNTIME_IF_BOTH_WIRED",
            "DOUBLE_RECALL_IN_J1_PYTHON_EVAL": False,
            "J1_runtime_wired": False,
            "note": "Python Stage D does not call Node SQL. If future runtime wires Model2 soft_domain_retrieve AND keeps local-span-recall domain SQL, that would be DOUBLE_RECALL.",
        },
    )

    inv = git_inventory()
    dump_csv(
        OUT / "modified_file_inventory.csv",
        inv
        + [
            {
                "path": "(summary)",
                "git_status": "",
                "production_runtime": "YES" if any(x["production_runtime"] == "YES" for x in inv) else "NO",
                "modified": f"production_runtime_modified={sum(1 for x in inv if x['production_runtime']=='YES')}",
            }
        ],
        ["path", "git_status", "production_runtime", "modified"],
    )

    # summary numbers for report
    summary = {
        "elapsed_s": round(time.perf_counter() - t0, 2),
        "unique_domain_identities": len(unique_idents),
        "domain_type_records": len(domain_recs),
        "exact_base_visible": sum(vis_exact.get(k, 0) for k in vis_exact if str(k).startswith("BASE_VISIBLE")),
        "exact_base_absent": vis_exact.get("BASE_ABSENT", 0),
        "exact_invalid_fs": vis_exact.get("INVALID_FINESPAN", 0),
        "corrupt_n": len(corrupt_traces),
        "corrupt_base_absent": vis_corrupt.get("BASE_ABSENT", 0),
        "corrupt_raw_hit_absent": len(raw_hit),
        "corrupt_raw_miss_absent": len(raw_miss),
        "corrupt_introduced": len(intro_c),
        "true_d_opp_rate_exact": round(len(opp_exact) / max(1, len(valid_exact)), 6),
        "true_d_opp_rate_corrupt": round(len(opp_c) / max(1, len(valid_c)), 6),
        "true_d_opp_rate_per_term": round(len(terms_any_opp) / max(1, len(canonical)), 6),
        "terms_any_introduced": len(terms_any_intro),
        "pipeline_retention_corrupt": round(sum(1 for t in raw_hit if t.get("final_introduced")) / max(1, len(raw_hit)), 6),
        "expansion_yield_exact": exp_stats(exact_traces)["Expansion_Yield"],
        "expansion_yield_corrupt": exp_stats(corrupt_traces)["Expansion_Yield"],
        "target_expansion_yield_corrupt": exp_stats(corrupt_traces)["Target_Expansion_Yield"],
        "target_expansion_yield_absent": exp_stats(abs_c)["Target_Expansion_Yield"],
        "buckets_corrupt": dict(buck_c),
        "window_17_32": window_1732,
        "funnel_exact": funnel_exact,
        "funnel_corrupt": funnel_corrupt,
        "zero_domains": zero_dom,
        "zero_rels": zero_rel,
        "vis_exact": dict(vis_exact),
        "vis_corrupt": dict(vis_corrupt),
        "exp_exact": exp_stats(exact_traces),
        "exp_corrupt": exp_stats(corrupt_traces),
        "exp_absent": exp_stats(abs_c),
        "rel_stats": {k: dict(v) for k, v in rel_stats.items()},
        "domain_stats": {k: dict(v) for k, v in domain_stats.items()},
        "tag_integrity": {
            "missing_tag": missing_tag,
            "multi_tag": multi_tag_n,
            "first_tag_collapse": first_tag_collapse,
        },
        "p2": {"n": n_p2, **dict(p2)},
        "profile_effect": {
            "n": len(prof_rows),
            "empty_hit": sum(1 for r in prof_rows if r["Empty"]["identity_hit"]),
            "wrong_hit": sum(1 for r in prof_rows if r["Wrong"]["identity_hit"]),
            "correct_hit": sum(1 for r in prof_rows if r["Correct"]["identity_hit"]),
        },
        "created": datetime.now(timezone.utc).isoformat(),
    }
    dump(OUT / "audit_summary.json", summary)
    print("DONE", summary["elapsed_s"], "s", flush=True)


if __name__ == "__main__":
    main()
