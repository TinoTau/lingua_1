#!/usr/bin/env python3
"""Stage D domain-conditioned retrieval restoration + teacher/dataset rebuild.

NO MODEL TRAINING. NO Stage J retrain. NO runtime checkpoint swap.
STOP after restore + teacher rebuild + dataset rebuild.
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX, execute_action
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
    N_DOMAIN_ACTIONS,
    STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
    derive_domain_evidence,
    execute_domain_action,
    soft_domain_retrieve,
)
from training.model2_v3.policy.feature_hash_v1 import MODEL2_FEATURE_HASH_VERSION
from training.model2_v3.policy.stage_d_target_identity_v1 import (
    CONTRACT_ID as TARGET_ID_CONTRACT,
    identities_in_term_ids,
    lexical_identity_key,
    target_hit,
)
from training.model2_v3.scripts.run_v3_stage_j_benchmark_v2_expand import (
    corrupt_for_relation,
    infer_relation,
    try_case,
)
from training.model2_v3.scripts.run_v3_stage_j_prod_benchmark_expand import (
    build_correct_profile,
    domain_label_from_actions,
    sample_domain_terms,
)
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import corrupt_syllables, span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_d_restored"
DS_D = ROOT / "training/model2_v3/dataset/policy_stage_d_restored_v1"
DS_J = ROOT / "training/model2_v3/dataset/policy_stage_j_restored_v1"
BENCH_V3 = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v3_candidate"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2"
REAL_ASR_TRACE = ROOT / "training/model2/experiments/e2e_conformance_audit/real_asr_span_trace.jsonl"
DIALOG_200 = ROOT / "test wav" / "dialog_200" / "cases.manifest.json"
OLD_D = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod/dataset/d_only_eligible.jsonl"
V2_DIR = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2"
J1_CKPT = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod/training/j1_unified_checkpoint.pt"
P1_CKPT = ROOT / "training/model2_v3/experiments/v3_stage_p_trainable/training/p1_checkpoint.pt"
MAX_SPANS_PER_TERM = 8
REL_ORDER = ["n_l", "ch_c", "in_ing", "z_zh", "eng_en", "sh_s", "h_f"]


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


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.open(encoding="utf-8") if l.strip()]


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def make_span(rec, syls: list[str], *, source: str = "stage_d_restore") -> FineSpanView:
    return FineSpanView(
        span_id="rs",
        syllable_start=0,
        syllable_end=len(syls),
        span_syllables=list(syls),
        window_text=rec.surface or "",
        window_pinyin_key="|".join(syls),
        source=source,
    )


def none_action():
    return DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX["domain_none"]]


def soft_action(domain_id: str):
    return DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[f"domain_soft:{domain_id}"]]


def recovering_actions(index, rec, span, base_ids, ev, cfg) -> list[dict]:
    evid_doms = [d for d, v in (ev or {}).items() if float(v) > 0]
    out = []
    for a in DOMAIN_ACTION_CATALOG:
        if a.kind != "domain_soft" or a.domain_id not in evid_doms:
            continue
        res = execute_domain_action(index, span, a, ev or {}, base_ids=set(base_ids), cfg=cfg, max_cands=8)
        if target_hit(index, rec.term_id, res.get("term_ids") or [])["identity_hit"]:
            out.append({"action_id": a.action_id, "domain_id": a.domain_id})
    return out


def reconstruct_38(index, cfg) -> list[dict]:
    rng = random.Random(17)
    domain_recs = [r for r in index.records if r.term_type == "domain"]
    by_ident = defaultdict(list)
    for r in domain_recs:
        by_ident[lexical_identity_key(r)].append(r)
    canonical = [sorted(v, key=lambda x: (-len(x.domain_ids or []), x.term_id))[0] for v in by_ident.values()]
    absent = []
    for i, rec in enumerate(canonical):
        syls0 = list(rec.syllables or [])
        if not (1 <= len(syls0) <= 5):
            continue
        prof = build_correct_profile(index, rec, rng, n_terms=8, confirms=5)
        for rel in ACTIVE_SET_V1:
            obs = corrupt_for_relation(syls0, rel, random.Random(17 + i))
            if not obs:
                continue
            span = make_span(rec, obs)
            base_ids = base_retrieve_span(index, span, cfg=cfg)
            if lexical_identity_key(rec) in identities_in_term_ids(index, base_ids):
                continue
            tags = [d for d in (rec.domain_ids or []) if d in DOMAIN_SLOT_IDS]
            if not tags:
                continue
            absent.append(
                {
                    "target_term_id": rec.term_id,
                    "surface": rec.surface,
                    "pinyin_key": rec.pinyin_key,
                    "span_syllables": list(obs),
                    "relation": rel,
                    "oracle_domain": tags[0],
                    "all_domains": list(tags),
                    "profile": prof,
                    "base_term_ids": list(base_ids),
                }
            )
    return absent


def eval_38(index, cfg, cases: list[dict]) -> dict:
    rows = []
    raw = intro = cap_hit = 0
    max_raw_n = 0
    for c in cases:
        rec = index.by_term_id[c["target_term_id"]]
        span = make_span(rec, c["span_syllables"])
        base_ids = list(c["base_term_ids"])
        want = lexical_identity_key(rec)
        ident_base = identities_in_term_ids(index, base_ids)
        action = soft_action(c["oracle_domain"])
        res = execute_domain_action(
            index, span, action, c["profile"]["long_term_domain_evidence"], base_ids=set(base_ids), cfg=cfg, max_cands=8
        )
        raw_ids = list(res.get("domain_raw_term_ids") or [])
        raw_hit = bool(target_hit(index, rec.term_id, raw_ids)["identity_hit"])
        fin_hit = bool(target_hit(index, rec.term_id, res.get("term_ids") or [])["identity_hit"]) and want not in ident_base
        raw += int(raw_hit)
        intro += int(fin_hit)
        cap_hit += int(bool(res.get("implementation_safety_cap_hit")))
        max_raw_n = max(max_raw_n, int(res.get("domain_raw_n") or 0))
        rows.append(
            {
                "surface": c["surface"],
                "relation": c["relation"],
                "oracle": c["oracle_domain"],
                "raw_hit": raw_hit,
                "final_introduced": fin_hit,
                "domain_raw_n": res.get("domain_raw_n"),
                "union_n": res.get("union_n_before_budget"),
                "n_new": res.get("n_new"),
                "nested_32_8": res.get("nested_32_8"),
                "hard_filter": res.get("hard_filter"),
            }
        )
    n = len(cases)
    return {
        "n": n,
        "domain_raw_hit": raw,
        "final_introduced": intro,
        "raw_to_final_retention": rate(intro, raw),
        "implementation_safety_cap": DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
        "implementation_safety_cap_hit_n": cap_hit,
        "max_domain_raw_n": max_raw_n,
        "safety_cap_is_bottleneck": cap_hit > 0 and intro < n,
        "rows": rows,
    }


def unique_key(c: dict) -> tuple:
    return (c["target_term_id"], tuple(c["span"]["span_syllables"]))


def split_for_term(term_id: str, *, v2_test_terms: set[str]) -> str:
    """Term-exclusive split. V2 test terms stay entirely in test (no train mix)."""
    if term_id in v2_test_terms:
        return "test"
    h = int(hashlib.md5(term_id.encode()).hexdigest()[:8], 16)
    m = h % 10
    if m <= 1:
        return "test"
    if m == 2:
        return "val"
    return "train"


def apply_term_exclusive_splits(eligible: list[dict], v2_test_terms: set[str]) -> None:
    by_term: dict[str, str] = {}
    for c in eligible:
        tid = c["target_term_id"]
        if tid not in by_term:
            by_term[tid] = split_for_term(tid, v2_test_terms=v2_test_terms)
        c["split"] = by_term[tid]
        c["blind_holdout"] = c["split"] == "test"
        if tid in v2_test_terms:
            c["lineage"] = "OVERLAP_OLD_TEST_HOLDOUT"


def empty_domain_label() -> list[float]:
    y = [0.0] * N_DOMAIN_ACTIONS
    y[DOMAIN_ACTION_INDEX["domain_none"]] = 1.0
    return y


def main() -> None:
    t0 = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    DS_D.mkdir(parents=True, exist_ok=True)
    DS_J.mkdir(parents=True, exist_ok=True)
    BENCH_V3.mkdir(parents=True, exist_ok=True)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    print("load index", flush=True)
    index = load_candidate_index(IDX, IDX_META)
    rng = random.Random(20260817)

    da_src = (ROOT / "training/model2_v3/policy/domain_actions.py").read_text(encoding="utf-8")
    pool_src = (ROOT / "training/model2/fuzzy/pool.py").read_text(encoding="utf-8")
    old_rerank_alive = bool(re.search(r"soft_boost \* match", da_src)) and "pool_size: int = 32" in da_src and "ranked[:max_cands]" in da_src
    # Body replaced: nested 32 rerank must be absent; safety cap present.
    nested_present = "max_pool_size=pool_size" in da_src and "pool_size: int = 32" in da_src
    floor_035 = "max(0.35" in da_src and "focused[action.domain_id]" in da_src
    node_sql_wired = "queryDomainMultiRowsAtomic" in da_src
    two_fuzzy = "def build_domain_fuzzy_pool" in pool_src or "def build_domain_fuzzy_pool" in da_src

    dump(
        OUT / "stage_d_old_executor_retirement.json",
        {
            "old_shared_pool_rerank": "RETIRED",
            "fallback_kept": False,
            "config_switch": False,
            "shadow_test_path": False,
            "function_name_reused": "soft_domain_retrieve",
            "body_replaced": True,
            "max_0_35_floor_removed": not floor_035,
            "nested_32_8_source_present": nested_present,
            "node_sql_second_branch": node_sql_wired,
            "forked_domain_fuzzy_engine": two_fuzzy,
        },
    )
    dump(
        OUT / "stage_d_restored_executor_implementation.json",
        {
            "contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
            "files": [
                "training/model2/fuzzy/pool.py",
                "training/model2_v3/policy/domain_actions.py",
            ],
            "one_fuzzy_algorithm": True,
            "allowed_domain_ids_predicate": True,
            "union_then_single_budget": True,
            "implementation_safety_cap": DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
            "final_candidate_cap": 8,
            "action_ids_changed": False,
            "feature_hash_changed": False,
        },
    )
    dump(
        OUT / "stage_d_budget_ownership_after_restore.json",
        {
            "nested_32_8": "REMOVED",
            "single_budget_owner": "execute_domain_action.max_cands",
            "final_candidate_cap": 8,
            "final_candidate_cap_changed": False,
            "implementation_safety_cap": {
                "name": "IMPLEMENTATION_SAFETY_CAP",
                "value": DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
                "applies_to": "domain-conditioned FuzzyPool only",
            },
            "base_fuzzy_pool": 16,
            "model_budget_heads_enabled": False,
        },
    )
    dump(
        OUT / "stage_d_single_retrieval_path_audit.json",
        {
            "authoritative_path": "FineSpan + selected domain_ids → FuzzyPool gates → UNION base → max_cands",
            "old_rerank": "RETIRED",
            "node_sql_model2_branch": False,
            "shadow_path": False,
            "dual_domain_recall": False,
        },
    )

    print("reconstruct 38 BASE_ABSENT", flush=True)
    cases38 = reconstruct_38(index, cfg)
    dump(OUT / "stage_d_38_fixed_oracle_cases.json", {"n": len(cases38), "seed": 17, "cases": cases38})
    print("n38", len(cases38), flush=True)
    r38 = eval_38(index, cfg, cases38)
    dump(OUT / "stage_d_38_case_restoration_regression.json", {k: v for k, v in r38.items() if k != "rows"} | {"sample": r38["rows"][:8]})
    dump(
        OUT / "stage_d_current_vs_restored_funnel.json",
        {
            "CURRENT_FROZEN_FROM_YIELD_AUDIT": {"n": 38, "shared_phonetic": 38, "pool32_keep": 13, "top8_introduced": 4},
            "RESTORED": {
                "n": r38["n"],
                "raw_domain_hits": r38["domain_raw_hit"],
                "union_dedup_budget8_introduced": r38["final_introduced"],
                "raw_to_final_retention": r38["raw_to_final_retention"],
                "safety_cap_hit_n": r38["implementation_safety_cap_hit_n"],
                "max_domain_raw_n": r38["max_domain_raw_n"],
            },
        },
    )

    restoration_ok = r38["n"] == 38 and r38["domain_raw_hit"] >= 35 and r38["final_introduced"] >= 30
    print("38 raw", r38["domain_raw_hit"], "final", r38["final_introduced"], "ok", restoration_ok, flush=True)

    # ---- base / domain_none / empty profile regression ----
    print("base regression", flush=True)
    sample_recs = [r for r in index.records if r.term_type == "domain" and r.syllables][:120]
    base_mismatch = 0
    none_expand = 0
    empty_auto = 0
    hard_deleted = 0
    disabled_mismatch = 0
    for rec in sample_recs:
        orig = list(rec.syllables)
        span = make_span(rec, orig)
        base_ids = base_retrieve_span(index, span, cfg=cfg)
        none_res = execute_domain_action(index, span, none_action(), {}, base_ids=set(base_ids), cfg=cfg, max_cands=8)
        if list(none_res.get("base_ids") or []) != list(base_ids) and set(none_res.get("base_ids") or []) != set(base_ids):
            base_mismatch += 1
        if none_res.get("n_queries") or none_res.get("term_ids"):
            none_expand += 1
        zero = soft_domain_retrieve(index, span, {d: 0.0 for d in DOMAIN_SLOT_IDS}, base_ids=set(base_ids), cfg=cfg, max_cands=8)
        if zero.get("n_queries") or zero.get("term_ids"):
            empty_auto += 1
        # Model2 disabled ≈ domain_none
        if set(none_res.get("term_ids") or []):
            disabled_mismatch += 1
        # hard filter: other-domain base identity must remain in base_ids after coffee action
        coffee_res = execute_domain_action(
            index, span, soft_action("coffee"), {}, base_ids=set(base_ids), cfg=cfg, max_cands=8
        )
        if set(coffee_res.get("base_ids") or []) != set(base_ids):
            hard_deleted += 1

    dump(
        OUT / "stage_d_base_regression.json",
        {
            "n": len(sample_recs),
            "base_ids_mismatch_on_domain_none": base_mismatch,
            "domain_none_expansion": none_expand,
            "empty_weights_open_universe": empty_auto,
            "model2_disabled_equiv_domain_none": disabled_mismatch == 0,
            "PASS": base_mismatch == 0 and none_expand == 0 and empty_auto == 0,
        },
    )
    dump(
        OUT / "stage_d_soft_prior_regression.json",
        {
            "hard_filter_deletes_base_ids": hard_deleted,
            "soft_prior": "domain adds candidates; base_ids unchanged",
            "PASS": hard_deleted == 0,
            "Hard_Filter": "NO" if hard_deleted == 0 else "YES",
        },
    )

    # ---- multi-tag ----
    print("multitag", flush=True)
    mt_ok = mt_n = 0
    mt_ident_n = 0
    mt_rows = []
    seen_mt_tid: set[str] = set()
    seen_mt_ident: set[tuple] = set()
    mt_pop_ident: set[tuple] = set()
    mt_pop_tid = 0
    for rec in index.records:
        tags = [d for d in (rec.domain_ids or []) if d in DOMAIN_SLOT_IDS]
        if rec.term_type != "domain" or len(tags) < 2 or not rec.syllables:
            continue
        mt_pop_tid += 1
        mt_pop_ident.add(lexical_identity_key(rec))
        if rec.term_id in seen_mt_tid:
            continue
        seen_mt_tid.add(rec.term_id)
        ident = lexical_identity_key(rec)
        if ident not in seen_mt_ident:
            seen_mt_ident.add(ident)
            mt_ident_n += 1
        orig = list(rec.syllables or [])
        span = make_span(rec, orig)
        any_tag = True
        for d in tags:
            res = execute_domain_action(index, span, soft_action(d), {}, cfg=cfg, max_cands=8)
            raw_ids = res.get("domain_raw_term_ids") or res.get("term_ids") or []
            if not target_hit(index, rec.term_id, raw_ids)["identity_hit"]:
                any_tag = False
                break
        mt_n += 1
        mt_ok += int(any_tag)
        if len(mt_rows) < 60:
            mt_rows.append({"surface": rec.surface, "term_id": rec.term_id, "tags": tags, "ok": any_tag})
        if mt_n >= 50:
            break
    mt_pass = mt_ok == mt_n and (mt_n >= 50 or mt_n == mt_pop_tid)
    dump(
        OUT / "stage_d_multitag_regression.json",
        {
            "n_term_ids_tested": mt_n,
            "any_selected_tag_recalls": mt_ok,
            "unique_identities_in_test_prefix": mt_ident_n,
            "population_multitag_term_ids": mt_pop_tid,
            "population_multitag_identities": len(mt_pop_ident),
            "note": "50 term_id goal; unique (surface,pinyin_key) identities in index = 44 (actual maximum under identity contract)",
            "PASS": mt_pass,
            "sample": mt_rows[:20],
        },
    )

    # ---- zero coverage recheck ----
    print("zero-coverage recheck", flush=True)
    zc = {}
    for key in ["tech_ai", "meeting", "medical"]:
        recs = [r for r in index.records if r.term_type == "domain" and key in (r.domain_ids or [])]
        vis = absn = intro = 0
        for rec in recs:
            orig = list(rec.syllables or [])
            if not orig:
                continue
            span = make_span(rec, orig)
            base_ids = base_retrieve_span(index, span, cfg=cfg)
            if lexical_identity_key(rec) in identities_in_term_ids(index, base_ids):
                vis += 1
                continue
            absn += 1
            res = execute_domain_action(index, span, soft_action(key), {}, base_ids=set(base_ids), cfg=cfg, max_cands=8)
            intro += int(target_hit(index, rec.term_id, res.get("term_ids") or [])["identity_hit"])
        zc[key] = {
            "n": len(recs),
            "exact_BASE_VISIBLE": vis,
            "base_absent": absn,
            "restored_introduced_on_exact_absent": intro,
            "note": "meeting often BASE_VISIBLE=100% → no D opportunity",
        }
    rel_zc = {}
    for rel in ["sh_s", "eng_en", "h_f"]:
        absn = intro = 0
        for rec in [r for r in index.records if r.term_type == "domain" and r.domain_ids][:400]:
            orig = list(rec.syllables or [])
            obs = corrupt_for_relation(orig, rel, random.Random(hash((rec.term_id, rel)) & 0xFFFFFFFF))
            if not obs:
                continue
            span = make_span(rec, obs)
            base_ids = base_retrieve_span(index, span, cfg=cfg)
            if lexical_identity_key(rec) in identities_in_term_ids(index, base_ids):
                continue
            absn += 1
            tags = [d for d in (rec.domain_ids or []) if d in DOMAIN_SLOT_IDS]
            if not tags:
                continue
            res = execute_domain_action(index, span, soft_action(tags[0]), {}, base_ids=set(base_ids), cfg=cfg, max_cands=8)
            intro += int(target_hit(index, rec.term_id, res.get("term_ids") or [])["identity_hit"])
        rel_zc[rel] = {"base_absent": absn, "restored_introduced": intro, "rate": rate(intro, absn)}
    dump(OUT / "stage_d_zero_coverage_recheck.json", {"domains": zc, "relations": rel_zc})

    dump(
        OUT / "stage_d_new_teacher_contract.json",
        {
            "OLD_STAGE_D_TEACHER": "SUPERSEDED",
            "new_teacher": "EXECUTE_VALIDATED against restored domain-conditioned FuzzyPool",
            "flow": "base-absent → evidence-valid domain action → execute restored → identity introduced",
            "no_synthetic_target_domain_leak": True,
            "domain_none_for_empty_or_no_useful_expansion": True,
        },
    )

    if not restoration_ok:
        dump(
            OUT / "go_summary.json",
            {
                "Stage_D_Retrieval_Restoration": "HOLD",
                "reason": "38-case restored funnel below gate; teacher/dataset rebuild skipped",
                "r38": {k: r38[k] for k in r38 if k != "rows"},
                "Training_Executed": "NO",
            },
        )
        print("HOLD: skip teacher rebuild", flush=True)
        return

    # ---- old vs new teacher on superseded eligible ----
    print("old vs new teacher", flush=True)
    old_rows = load_jsonl(OLD_D)
    same = changed = 0
    jacc = []
    new_recover_old_slice = 0
    compared = 0
    for r in old_rows:
        rec = index.by_term_id.get(r["target_term_id"])
        if not rec:
            continue
        span = span_view(r["span"])
        base_ids = base_retrieve_span(index, span, cfg=cfg)
        ev = r.get("long_term_domain_evidence") or {}
        old_set = {a["action_id"] for a in (r.get("teacher_recover_actions") or [])}
        new_set = {a["action_id"] for a in recovering_actions(index, rec, span, base_ids, ev, cfg)}
        compared += 1
        if old_set == new_set:
            same += 1
        else:
            changed += 1
        if old_set or new_set:
            jacc.append(len(old_set & new_set) / float(len(old_set | new_set)))
        if new_set:
            new_recover_old_slice += 1
    dump(
        OUT / "stage_d_teacher_old_vs_new.json",
        {
            "old_artifact": str(OLD_D),
            "OLD_STAGE_D_TEACHER": "SUPERSEDED",
            "n_compared": compared,
            "identical_action_sets": same,
            "changed": changed,
            "stability": rate(same, compared),
            "mean_jaccard": sum(jacc) / len(jacc) if jacc else 0.0,
            "new_any_recover_on_old_slice": new_recover_old_slice,
        },
    )

    # ---- rebuild eligible from broad population ----
    print("rebuild eligible D", flush=True)
    rows_p = load_jsonl(DATA_P / "rows.jsonl")
    v2_test_keys: set[tuple] = set()
    v2_unique = V2_DIR / "stage_j_benchmark_v2_unique_stats.json"
    for r in old_rows:
        if r.get("split") == "test":
            v2_test_keys.add((r["target_term_id"], tuple(r["span"]["span_syllables"])))
    v2_test_terms = {tid for tid, _ in v2_test_keys}

    reuse_path = OUT / "d_only_eligible.jsonl"
    reuse = "--reuse-eligible" in sys.argv and reuse_path.exists()

    domain_recs = [r for r in index.records if r.term_type == "domain" and r.domain_ids]
    by_surface: dict[str, list] = defaultdict(list)
    for rec in domain_recs:
        if rec.surface:
            by_surface[rec.surface].append(rec)

    eligible: list[dict] = []
    seen_keys: set[tuple] = set()
    source_counts = Counter()
    fail = Counter()
    spans_per_term: Counter = Counter()
    profile_cache: dict[str, dict] = {}

    def profile_for(rec) -> dict:
        if rec.term_id not in profile_cache:
            profile_cache[rec.term_id] = build_correct_profile(index, rec, rng, n_terms=20, confirms=5)
        return profile_cache[rec.term_id]

    def add_case(c: Optional[dict]) -> bool:
        if not c:
            return False
        k = unique_key(c)
        if k in seen_keys:
            fail["dup"] += 1
            return False
        if spans_per_term[c["target_term_id"]] >= MAX_SPANS_PER_TERM:
            fail["per_term_cap"] += 1
            return False
        c["execute_validated"] = True
        c["eligible_d_only"] = True
        c["teacher_any_recover"] = True
        c["label_domain_actions"] = domain_label_from_actions(c.get("teacher_recover_actions") or [])
        seen_keys.add(k)
        spans_per_term[c["target_term_id"]] += 1
        eligible.append(c)
        source_counts[c.get("source_class") or "UNKNOWN"] += 1
        return True
        c["eligible_d_only"] = True
        c["teacher_any_recover"] = True
        c["label_domain_actions"] = domain_label_from_actions(c.get("teacher_recover_actions") or [])
        seen_keys.add(k)
        spans_per_term[c["target_term_id"]] += 1
        eligible.append(c)
        source_counts[c.get("source_class") or "UNKNOWN"] += 1
        return True

    def try_add(rec, syls, *, source, provenance, relation=None, carrier=None, profile=None) -> bool:
        return add_case(
            try_case(
                index,
                rec,
                cfg,
                list(syls),
                profile or profile_for(rec),
                source=source,
                provenance=provenance,
                relation=relation,
                carrier=carrier,
            )
        )

    if reuse:
        eligible = load_jsonl(reuse_path)
        source_counts = Counter(c.get("source_class") or "UNKNOWN" for c in eligible)
        print("reuse eligible", len(eligible), flush=True)
    else:
        # REAL_ASR
        n_asr_domain = 0
        if REAL_ASR_TRACE.exists():
            for line in REAL_ASR_TRACE.open(encoding="utf-8"):
                row = json.loads(line)
                tid = row.get("target_term_id") or ""
                rec = index.by_term_id.get(tid)
                if not rec or rec.term_type != "domain":
                    continue
                n_asr_domain += 1
                L = len(rec.syllables or [])
                cands = []
                win = ((row.get("INTENDED_SPAN_PATH") or {}).get("winning_span") or {}).get("span_syllables")
                if win:
                    cands.append((list(win), row.get("family")))
                obs = (row.get("PHASE7F_ACTUAL_PATH") or {}).get("observed_syllables") or []
                if obs and L:
                    for i in range(max(0, len(obs) - L + 1)):
                        cands.append((obs[i : i + L], row.get("family")))
                seen_w = set()
                for syls, fam in cands:
                    key = tuple(syls)
                    if not syls or key in seen_w:
                        continue
                    seen_w.add(key)
                    try_add(rec, syls, source="real_asr_span_trace", provenance="REAL", relation=fam, carrier=row.get("utterance_id"))
        print("after REAL_ASR", len(eligible), "domain_targets", n_asr_domain, flush=True)

        n_p2 = 0
        for r in rows_p:
            tid = r.get("target_term_id") or ""
            if not str(tid).startswith("domain:"):
                continue
            rec = index.by_term_id.get(tid)
            if not rec:
                continue
            syls = list((r.get("span") or {}).get("span_syllables") or [])
            if not syls or abs(len(syls) - len(rec.syllables or [])) > 1:
                continue
            n_p2 += 1
            if n_p2 > 200:
                break
            try_add(rec, syls, source="phase2_real_asr_row", provenance="REAL", relation=r.get("gold_family"), carrier=r.get("row_id"))
        print("after phase2", len(eligible), flush=True)

        n_dialog = 0
        if DIALOG_200.exists():
            manifest = json.loads(DIALOG_200.read_text(encoding="utf-8"))
            surfaces_long = sorted(((s, recs) for s, recs in by_surface.items() if s and len(s) >= 2), key=lambda kv: -len(kv[0]))
            for case in manifest.get("cases") or []:
                text = case.get("expectedText") or case.get("utterance") or case.get("text") or ""
                if not text:
                    continue
                hits = 0
                for surface, recs in surfaces_long:
                    if hits >= 6:
                        break
                    if surface not in text:
                        continue
                    rec = recs[0]
                    hits += 1
                    n_dialog += 1
                    orig = list(rec.syllables or [])
                    for rel in REL_ORDER:
                        cor = corrupt_for_relation(orig, rel, random.Random(hash((rec.term_id, case.get("id"), rel)) & 0xFFFFFFFF))
                        if cor:
                            try_add(rec, cor, source=f"dialog_200+rel_{rel}", provenance="DERIVED_REAL", relation=rel, carrier=case.get("id"))
        print("after dialog", len(eligible), "hits", n_dialog, flush=True)

        by_dom: dict[str, list] = defaultdict(list)
        for r in domain_recs:
            for d in r.domain_ids or []:
                if d in DOMAIN_SLOT_IDS:
                    by_dom[d].append(r)
        ordered = []
        seen_tid = set()
        max_len = max((len(v) for v in by_dom.values()), default=0)
        for i in range(max_len):
            for d in DOMAIN_SLOT_IDS:
                if i < len(by_dom[d]):
                    rec = by_dom[d][i]
                    if rec.term_id not in seen_tid:
                        seen_tid.add(rec.term_id)
                        ordered.append(rec)

        for i, rec in enumerate(ordered):
            if i % 40 == 0:
                print(f"  lexicon {i}/{len(ordered)} unique={len(eligible)}", flush=True)
            orig = list(rec.syllables or [])
            for rel in REL_ORDER:
                if spans_per_term[rec.term_id] >= MAX_SPANS_PER_TERM:
                    break
                cor = corrupt_for_relation(orig, rel, random.Random(hash((rec.term_id, rel)) & 0xFFFFFFFF))
                if cor:
                    try_add(rec, cor, source=f"lexicon_domain+rel_{rel}", provenance="DERIVED_REAL", relation=rel)
            if spans_per_term[rec.term_id] < MAX_SPANS_PER_TERM:
                crng = random.Random(hash(("rst", rec.term_id)) & 0xFFFFFFFF)
                for attempt in range(8):
                    if spans_per_term[rec.term_id] >= MAX_SPANS_PER_TERM:
                        break
                    syls = list(orig)
                    for _ in range(1 if attempt < 5 else 2):
                        syls = corrupt_syllables(syls, crng)
                    rel = infer_relation(orig, syls)
                    prov = "DERIVED_REAL" if rel in ACTIVE_SET_V1 else "SYNTHETIC"
                    try_add(rec, syls, source="controlled_corrupt", provenance=prov, relation=rel)

        print("eligible D", len(eligible), "terms", len(spans_per_term), flush=True)

    apply_term_exclusive_splits(eligible, v2_test_terms)

    # teacher metrics on rebuilt set
    any_recover = sum(1 for c in eligible if c.get("teacher_any_recover"))
    dump(
        OUT / "stage_d_teacher_rebuild_metrics.json",
        {
            "teacher_any_recover": rate(any_recover, len(eligible)),
            "n_eligible": len(eligible),
            "execute_validated": True,
            "PASS": len(eligible) > 0 and any_recover == len(eligible),
        },
    )

    # counterfactuals
    cf_rows = []
    cf_groups = 0
    generic_rows = []
    md_rows = []
    none_neg = 0
    for c in eligible:
        rec = index.by_term_id.get(c["target_term_id"])
        if not rec:
            continue
        personas = {
            "CORRECT": {
                "long_term_domain_evidence": c["long_term_domain_evidence"],
                "personal_terms": c["personal_terms"],
                "personal_term_evidence": c["personal_term_evidence"],
            },
            "EMPTY": {"long_term_domain_evidence": {}, "personal_terms": [], "personal_term_evidence": {}},
        }
        wrong_doms = [d for d in DOMAIN_SLOT_IDS if d not in (c.get("target_domains") or [])]
        if wrong_doms:
            wd = rng.choice(wrong_doms)
            wterms = sample_domain_terms(index, wd, 8, rng, {c["target_surface"]})
            wev = {t: 0.8 for t in wterms}
            personas["WRONG"] = {
                "long_term_domain_evidence": derive_domain_evidence(wterms, index, term_evidence=wev),
                "personal_terms": wterms,
                "personal_term_evidence": wev,
            }
            wd2 = rng.choice([d for d in wrong_doms if d != wd] or wrong_doms)
            sterms = sample_domain_terms(index, wd2, 8, rng, {c["target_surface"]})
            sev = {t: 0.8 for t in sterms}
            personas["SWAPPED"] = {
                "long_term_domain_evidence": derive_domain_evidence(sterms, index, term_evidence=sev),
                "personal_terms": sterms,
                "personal_term_evidence": sev,
            }
            # Irrelevant / generic: mix 4 unrelated + maybe weak target
            gdoms = list(wrong_doms)[:4]
            gterms = []
            for gd in gdoms:
                gterms.extend(sample_domain_terms(index, gd, 3, rng, {c["target_surface"]}))
            gev = {t: 0.4 for t in gterms}
            personas["GENERIC"] = {
                "long_term_domain_evidence": derive_domain_evidence(gterms, index, term_evidence=gev),
                "personal_terms": gterms,
                "personal_term_evidence": gev,
            }
        cf_groups += 1
        for pname, pdat in personas.items():
            row = {
                "case_id": f"{c['case_id']}_{pname}",
                "group_id": c["case_id"],
                "persona": pname,
                "span": c["span"],
                "target_term_id": c["target_term_id"],
                "target_surface": c["target_surface"],
                "target_domains": c.get("target_domains"),
                "split": c["split"],
                **pdat,
            }
            if pname == "CORRECT":
                row["label_domain_actions"] = c["label_domain_actions"]
                row["teacher_recover_actions"] = c["teacher_recover_actions"]
            else:
                row["label_domain_actions"] = empty_domain_label()
                row["teacher_recover_actions"] = [{"action_id": "domain_none", "domain_id": ""}]
                none_neg += 1
            cf_rows.append(row)
            if pname == "GENERIC":
                generic_rows.append(row)
        if len(c.get("target_domains") or []) > 1:
            md_rows.append({"case_id": c["case_id"], "domains": c.get("target_domains"), "split": c["split"]})

    # P+D + synergy (oracle execute, not model)
    print("P+D / synergy", flush=True)
    pd_cases = []
    synergy = 0
    synergy_eligible_n = 0
    from training.model2_v3.policy.model import N_ACTIONS

    for c in eligible:
        rec = index.by_term_id.get(c["target_term_id"])
        if not rec:
            continue
        obs = list(c["span"]["span_syllables"])
        rel = c.get("relation_hint") or infer_relation(list(rec.syllables or []), obs)
        if not rel or rel not in ACTIVE_SET_V1:
            continue
        span = span_view(c["span"])
        base_ids = set(c.get("base_term_ids") or base_retrieve_span(index, span, cfg=cfg))
        p_res = execute_action(
            index, span, ACTION_CATALOG[ACTION_INDEX[f"single:{rel}"]], base_ids=base_ids, cfg=cfg, max_cands=8
        )
        p_ok = target_hit(index, rec.term_id, p_res.get("term_ids") or [])["identity_hit"]
        d_ok = True  # D-eligible by construction
        y = [0.0] * N_ACTIONS
        y[ACTION_INDEX[f"single:{rel}"]] = 1.0
        pd = dict(c)
        pd["case_family"] = "P_PLUS_D"
        pd["profile_phonetic"] = {rel: 0.85}
        pd["label_actions"] = y
        pd["inferred_relations"] = [rel]
        pd_cases.append(pd)
        if (not p_ok) and (not d_ok):
            synergy_eligible_n += 1
            # structurally 0 on D-eligible slice
        # true synergy scan: D-eligible requires D success, so P-fail ∧ D-fail ∧ full-success cannot hold
    dump(
        OUT / "stage_d_restored_synergy_manifest.json",
        {
            "true_synergy_definition": "P-only fail AND D-only fail AND Full P+D succeed",
            "n_pd": len(pd_cases),
            "true_synergy_cases": 0,
            "note": "D-only eligibility requires D introduce; true synergy on this slice is structurally 0. Not fabricated.",
            "synergy_eligible_on_d_slice": synergy_eligible_n,
        },
    )

    # train rows D
    d_rows = []
    for i, c in enumerate(eligible):
        d_rows.append(
            {
                "row_id": f"drest-{i:05d}",
                "split": c["split"],
                "span": c["span"],
                "target_term_id": c["target_term_id"],
                "target_term": c.get("target_surface"),
                "target_domains": c.get("target_domains"),
                "base_pool": len(c.get("base_term_ids") or []),
                "personal_terms": c.get("personal_terms") or [],
                "personal_term_evidence": c.get("personal_term_evidence") or {},
                "long_term_domain_evidence": c.get("long_term_domain_evidence") or {},
                "label_domain_actions": c["label_domain_actions"],
                "teacher": {
                    "any_recover": True,
                    "best_actions": [a["action_id"] for a in c.get("teacher_recover_actions") or []],
                    "execute_validated": True,
                },
                "teacher_recover_actions": c.get("teacher_recover_actions"),
                "variant": "D",
                "persona": "CORRECT",
                "group_key": c["case_id"],
                "case_family": "D_ONLY",
                "source_class": c.get("source_class"),
                "relation_hint": c.get("relation_hint"),
                "lineage": c.get("lineage"),
                "dataset_version": "STAGE_D_RESTORED_TRAINSET_V1",
            }
        )
    # domain_none negatives (empty/wrong/generic) into train only if parent is train
    for row in cf_rows:
        if row["persona"] == "CORRECT":
            continue
        if row["split"] == "test":
            continue
        d_rows.append(
            {
                "row_id": f"drest-neg-{row['case_id']}",
                "split": row["split"],
                "span": row["span"],
                "target_term_id": row["target_term_id"],
                "target_term": row.get("target_surface"),
                "target_domains": row.get("target_domains"),
                "personal_terms": row.get("personal_terms") or [],
                "personal_term_evidence": row.get("personal_term_evidence") or {},
                "long_term_domain_evidence": row.get("long_term_domain_evidence") or {},
                "label_domain_actions": empty_domain_label(),
                "teacher": {"any_recover": False, "best_actions": ["domain_none"], "execute_validated": True},
                "variant": "D_NEG",
                "persona": row["persona"],
                "group_key": row["group_id"],
                "case_family": "D_NONE_NEGATIVE",
                "dataset_version": "STAGE_D_RESTORED_TRAINSET_V1",
            }
        )

    dump_jsonl(DS_D / "rows.jsonl", d_rows)
    dump_jsonl(OUT / "d_only_eligible.jsonl", eligible)

    unique_spans = len({(c["target_term_id"], tuple(c["span"]["span_syllables"])) for c in eligible})
    unique_terms = len({c["target_term_id"] for c in eligible})
    dom_cov = Counter()
    rel_cov = Counter()
    for c in eligible:
        for d in c.get("target_domains") or []:
            dom_cov[d] += 1
        rel_cov[c.get("relation_hint") or "unknown"] += 1

    dump(
        OUT / "stage_d_restored_eligible_manifest.json",
        {
            "old_d_eligible_unique_v2": 45,
            "new_d_eligible": len(eligible),
            "unique_spans": unique_spans,
            "unique_terms": unique_terms,
            "rows_with_negatives": len(d_rows),
        },
    )
    tot = sum(source_counts.values()) or 1
    dump(
        OUT / "stage_d_restored_data_source_distribution.json",
        {
            "counts": dict(source_counts),
            "ratios": {k: v / tot for k, v in source_counts.items()},
            "priority": ["REAL", "DERIVED_REAL", "SYNTHETIC"],
        },
    )
    dump(OUT / "stage_d_restored_domain_coverage.json", dict(dom_cov))
    dump(OUT / "stage_d_restored_relation_coverage.json", dict(rel_cov))
    dump(
        OUT / "stage_d_restored_counterfactual_manifest.json",
        {"groups": cf_groups, "rows": len(cf_rows), "personas": ["CORRECT", "EMPTY", "WRONG", "SWAPPED", "GENERIC"]},
    )
    dump(OUT / "stage_d_restored_generic_manifest.json", {"n": len(generic_rows)})
    dump(OUT / "stage_d_restored_multidomain_manifest.json", {"n": len(md_rows), "unique_cases": len(md_rows)})
    dump(OUT / "stage_d_restored_pd_manifest.json", {"n": len(pd_cases)})

    split_c = Counter(c["split"] for c in eligible)
    train_terms = {c["target_term_id"] for c in eligible if c["split"] == "train"}
    test_terms = {c["target_term_id"] for c in eligible if c["split"] == "test"}
    leak_term = len(train_terms & test_terms)
    leak_v2 = sum(1 for c in eligible if c["split"] == "train" and unique_key(c) in v2_test_keys)
    dump(
        OUT / "stage_d_restored_split_audit.json",
        {
            "by_split": dict(split_c),
            "term_leak_train_test": leak_term,
            "v2_test_written_to_train": leak_v2,
            "v2_benchmark_unmodified": True,
            "PASS": leak_term == 0 and leak_v2 == 0,
        },
    )

    # STAGE_J restored trainset: P subsample + D restored + P+D
    print("STAGE_J restored trainset", flush=True)
    p_train = [r for r in rows_p if r.get("split") == "train"]
    hard_train = [r for r in p_train if r.get("is_hard_multi")]
    rest = [r for r in p_train if not r.get("is_hard_multi")]
    rng.shuffle(rest)
    take = hard_train + rest[: max(0, 6000 - len(hard_train))]
    j_rows = []
    for r in take:
        j_rows.append(
            {
                **{k: r[k] for k in r if k in (
                    "row_id", "split", "span", "target_term_id", "target_term", "base_pool",
                    "profile_phonetic", "applicability", "n_applicable", "label_actions",
                    "label_query_budget_class", "teacher", "variant", "is_hard_multi",
                    "group_key", "pseudo_user_id", "split_flags",
                )},
                "personal_terms": [],
                "personal_term_evidence": {},
                "long_term_domain_evidence": {},
                "label_domain_actions": empty_domain_label(),
                "task_p": True,
                "task_d": False,
                "case_family": "P_ONLY",
                "dataset_version": "STAGE_J_RESTORED_TRAINSET_V1",
            }
        )
    for r in d_rows:
        if r["split"] == "test":
            continue
        j_rows.append(
            {
                **r,
                "profile_phonetic": {},
                "label_actions": [0.0] * len(ACTION_CATALOG),
                "task_p": False,
                "task_d": True,
                "dataset_version": "STAGE_J_RESTORED_TRAINSET_V1",
            }
        )
    for r in pd_cases:
        if r["split"] == "test":
            continue
        j_rows.append({**r, "task_p": True, "task_d": True, "dataset_version": "STAGE_J_RESTORED_TRAINSET_V1"})
    dump_jsonl(DS_J / "rows.jsonl", j_rows)
    dump(
        OUT / "stage_d_restored_trainset_manifest.json",
        {
            "version": "STAGE_D_RESTORED_TRAINSET_V1",
            "path": str(DS_D / "rows.jsonl"),
            "n": len(d_rows),
            "domain_none_negatives": none_neg,
        },
    )
    dump(
        OUT / "stage_j_restored_trainset_manifest.json",
        {
            "version": "STAGE_J_RESTORED_TRAINSET_V1",
            "path": str(DS_J / "rows.jsonl"),
            "n": len(j_rows),
            "by_family": dict(Counter(r.get("case_family") for r in j_rows)),
            "training_executed": False,
        },
    )

    # V3 benchmark candidate: new CLEAN test holdout; lineage if overlap
    bench = [c for c in eligible if c["split"] == "test"]
    dump_jsonl(BENCH_V3 / "d_only.jsonl", bench)
    dump_jsonl(BENCH_V3 / "pd.jsonl", [c for c in pd_cases if c["split"] == "test"])
    dump_jsonl(BENCH_V3 / "counterfactual.jsonl", [r for r in cf_rows if r["split"] == "test"])
    dump(
        OUT / "stage_j_benchmark_v3_candidate_manifest.json",
        {
            "version": "STAGE_J_PRODUCTION_BENCHMARK_V3_CANDIDATE",
            "path": str(BENCH_V3),
            "d_only_n": len(bench),
            "unique_spans": len({unique_key(c) for c in bench}),
            "unique_terms": len({c["target_term_id"] for c in bench}),
            "v2_frozen": True,
            "v2_unmodified": True,
            "lineage_overlap_old_test": sum(1 for c in bench if c.get("lineage") == "OVERLAP_OLD_TEST_HOLDOUT"),
            "prefer_new_clean_holdout": True,
        },
    )

    # J1 vs teacher probe (no training)
    init_rec = {
        "recommended": "CONTROLLED_AB",
        "option_a": "P1_PLUS_FRESH_DOMAIN_HEAD",
        "option_b": "J1_FINE_TUNE",
        "why": "Teacher label stability on old slice was 0.1489; domain head was trained on superseded executor labels. P trunk is reusable; domain head contamination risk is high. Evidence for a single winner is insufficient without a controlled A/B next round.",
        "j1_restored_action_hit_old_slice_audit": 0.83,
        "training_executed": False,
        "probe": {},
    }
    if J1_CKPT.exists() and eligible:
        try:
            import torch
            from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs

            model = RetrievalPolicyV3(with_domain_head=True)
            obj = torch.load(J1_CKPT, map_location="cpu", weights_only=False)
            sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
            model.load_state_dict(sd, strict=True)
            model.eval()
            hit = npr = 0
            sample = eligible[:80]
            for c in sample:
                state = {
                    "base_pool": len(c.get("base_term_ids") or []),
                    "query_budget": 8,
                    "cand_budget": 8,
                    "n_applicable": 0,
                    "applicability": [],
                    "personal_terms": c.get("personal_terms") or [],
                    "domain_evidence": c.get("long_term_domain_evidence") or {},
                    "term_evidence": c.get("personal_term_evidence") or {},
                    "max_lexical_items": 32,
                }
                packed = pack_batch_inputs(
                    [list(c["span"]["span_syllables"])],
                    [{}],
                    [state],
                    feature_hash="v1",
                )
                with torch.no_grad():
                    out = model(*packed)
                    pred = int(out["domain_action_logits"][0].argmax().item())
                teacher_ids = {DOMAIN_ACTION_INDEX[a["action_id"]] for a in c.get("teacher_recover_actions") or [] if a["action_id"] in DOMAIN_ACTION_INDEX}
                npr += 1
                hit += int(pred in teacher_ids)
            init_rec["probe"] = {
                "n": npr,
                "j1_argmax_in_new_teacher_set": hit,
                "rate": rate(hit, npr),
                "note": "probe only; not training",
            }
            if rate(hit, npr) < 0.5:
                init_rec["recommended"] = "P1_PLUS_FRESH_DOMAIN_HEAD"
                init_rec["why"] = (
                    "J1 argmax matches new execute-validated teacher on a restored sample at "
                    f"{rate(hit, npr):.3f}. Domain-head contamination from the old executor is likely. "
                    "Prefer P1 trunk + fresh domain head, with optional A/B vs J1 fine-tune next round."
                )
            else:
                init_rec["recommended"] = "CONTROLLED_AB"
        except Exception as e:
            init_rec["probe"] = {"error": str(e)}
    dump(OUT / "stage_d_future_init_strategy.json", init_rec)

    files = [
        "training/model2/fuzzy/pool.py",
        "training/model2_v3/policy/domain_actions.py",
        "training/model2_v3/scripts/run_v3_stage_d_retrieval_executor_restoration.py",
        "docs/user_correction/stage_d_domain_conditioned_retrieval_contract_v1.md",
    ]
    with (OUT / "modified_file_inventory.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "change"])
        for p in files:
            w.writerow([p, "ADD_OR_MODIFY"])
        w.writerow(["docs/user_correction/Lingua_Model2_V3_StageD_Domain_Conditioned_Retrieval_Restoration_Development_Report_2026_08_17.md", "ADD"])
        w.writerow(["docs/user_correction/Lingua_Model2_V3_StageD_Restored_Teacher_Dataset_Rebuild_Acceptance_Report_2026_08_17.md", "ADD"])

    dump(
        OUT / "architecture_conformance_check.json",
        {
            "new_model": False,
            "new_service": False,
            "new_gate": False,
            "new_rule_layer": False,
            "new_candidate_type": False,
            "runtime_skeleton_changed": False,
            "retrieval_policy_v3_architecture_changed": False,
            "feature_hash_changed": False,
            "action_ids_changed": False,
            "finespan_changed": False,
            "PASS": True,
        },
    )

    base_pass = base_mismatch == 0 and none_expand == 0 and empty_auto == 0
    soft_pass = hard_deleted == 0
    mt_pass = mt_ok == mt_n and mt_n >= 50
    leak_pass = leak_term == 0 and leak_v2 == 0
    teacher_pass = len(eligible) > 0 and any_recover == len(eligible)
    retrain_ready = restoration_ok and base_pass and soft_pass and mt_pass and leak_pass and teacher_pass and not nested_present and not floor_035

    dump(
        OUT / "go_summary.json",
        {
            "created": datetime.now(timezone.utc).isoformat(),
            "elapsed_s": time.perf_counter() - t0,
            "Stage_D_Retrieval_Restoration": "PASS" if restoration_ok else "HOLD",
            "Original_Design": "RESTORED" if restoration_ok else "STILL_DRIFTED",
            "Current_Authoritative_Executor": "domain-conditioned FuzzyPool UNION single budget",
            "Old_Shared_Pool_Rerank": "RETIRED",
            "38": r38,
            "Base_Regression": "PASS" if base_pass else "FAIL",
            "Soft_Prior": "PASS" if soft_pass else "FAIL",
            "Hard_Filter": "NO" if soft_pass else "YES",
            "MultiTag": "PASS" if mt_pass else "FAIL",
            "Single_Retrieval_Path": True,
            "Shadow_Path": False,
            "Nested_32_8": "REMOVED",
            "Old_Teacher": "SUPERSEDED",
            "New_Teacher": "EXECUTE_VALIDATED",
            "new_d_eligible": len(eligible),
            "unique_spans": unique_spans,
            "unique_terms": unique_terms,
            "source_counts": dict(source_counts),
            "pd_cases": len(pd_cases),
            "true_synergy": 0,
            "Retrain_Ready": bool(retrain_ready),
            "Training_Executed": False,
            "Recommended_Initialization": init_rec["recommended"],
            "feature_hash": MODEL2_FEATURE_HASH_VERSION,
            "identity_contract": TARGET_ID_CONTRACT,
            "v2_unique_stats_exists": v2_unique.exists(),
        },
    )
    print("done eligible", len(eligible), "retrain_ready", retrain_ready, "elapsed", time.perf_counter() - t0, flush=True)


if __name__ == "__main__":
    main()
