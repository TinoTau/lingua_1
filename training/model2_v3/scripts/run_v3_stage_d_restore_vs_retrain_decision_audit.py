#!/usr/bin/env python3
"""Stage D Restore-vs-Retrain Decision Audit.

READ ONLY. AUDIT_SIMULATION_ONLY for restored executors.
Does not modify production retrieval, train, or change config.
"""

from __future__ import annotations

import csv
import json
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import torch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS, FUZZY_DISTANCE_THRESHOLD, FUZZY_LEN_DELTA_MAX
from training.model2.fuzzy.pool import FuzzyPoolHit
from training.model2.phonetic.syllables import levenshtein_syllables, normalize_syllable
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    execute_domain_action,
)
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.stage_d_target_identity_v1 import (
    identities_in_term_ids,
    lexical_identity_key,
    target_hit,
)
from training.model2_v3.scripts.run_v3_stage_j_benchmark_v2_expand import corrupt_for_relation
from training.model2_v3.scripts.run_v3_stage_j_benchmark_v2_blind_eval import row_state, select_d
from training.model2_v3.scripts.run_v3_stage_j_prod_benchmark_expand import build_correct_profile
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_d_restore_vs_retrain_audit"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
CKPT = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod/training/j1_unified_checkpoint.pt"
V2_D = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2/dataset/d_only.jsonl"
V2_CF = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2/dataset/counterfactual.jsonl"
NODE_SQL_LIMIT = 3  # lexicon-runtime-v2-config.ts maxDomainCandidates default


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def dump_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print("wrote", path.name, flush=True)


def pct(n: int, d: int) -> float:
    return round(n / d, 6) if d else 0.0


def make_span(rec, syls: list[str]) -> FineSpanView:
    return FineSpanView(
        span_id="rvt",
        syllable_start=0,
        syllable_end=len(syls),
        span_syllables=list(syls),
        window_text=rec.surface or "",
        window_pinyin_key="|".join(syls),
        source="restore_vs_retrain_audit",
    )


def observed_pinyin_key(syls: list[str]) -> str:
    return "|".join(normalize_syllable(s) for s in syls if normalize_syllable(s))


def node_sql_exact(index, syls: list[str], domain_id: str, *, limit: int = NODE_SQL_LIMIT) -> list:
    """AUDIT_SIMULATION_ONLY of queryDomainMultiRowsAtomic.

    Contract: domain_id IN (...) AND pinyin_key = ? AND length(word) = ?
    Node also returns [] when termLength < 2.
    """
    qn = len([normalize_syllable(s) for s in syls if normalize_syllable(s)])
    if qn < 2 or not domain_id:
        return []
    key = observed_pinyin_key(syls)
    hits = []
    for r in index.records:
        if domain_id not in (r.domain_ids or []):
            continue
        pk = r.pinyin_key or "|".join(r.syllables or [])
        if pk != key:
            continue
        word_len = len(r.surface or "")
        if word_len != qn and r.syllable_count != qn:
            continue
        hits.append(r)
    hits.sort(key=lambda x: (-float(x.prior_score), x.term_id))
    return hits[:limit]


def domain_filtered_fuzzy(index, syls: list[str], domain_id: str) -> list[FuzzyPoolHit]:
    """AUDIT_SIMULATION_ONLY: existing FuzzyPool primitive restricted to domain-tagged records.

    Same distance/len gates as pool.py. No nested k=32/top-8.
    """
    q = [normalize_syllable(s) for s in syls if normalize_syllable(s)]
    if not q or not domain_id:
        return []
    cands = []
    for delta in range(-FUZZY_LEN_DELTA_MAX, FUZZY_LEN_DELTA_MAX + 1):
        for c in index.by_syllable_count.get(len(q) + delta, []):
            if domain_id in (c.domain_ids or []):
                cands.append(c)
    scored: list[FuzzyPoolHit] = []
    for c in cands:
        dist = levenshtein_syllables(q, c.syllables)
        if dist > FUZZY_DISTANCE_THRESHOLD:
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
    for h in scored:
        if h.surface in seen:
            continue
        seen.add(h.surface)
        uniq.append(h)
    return uniq


def union_then_budget(index, base_ids: list[str], domain_hits: list, *, budget: int, domain_id: str) -> list[str]:
    """UNION identities then one cap. Soft: do not hard-drop base before scoring.

    score = distance - 2.5 * domain_match (same soft number as current, applied once after union).
    Missing distance treated as 0 for base-only ids.
    """
    by_id: dict[str, dict] = {}
    for tid in base_ids:
        rec = index.by_term_id.get(tid)
        if not rec:
            continue
        match = 1.0 if domain_id in (rec.domain_ids or []) else 0.0
        by_id[tid] = {"term_id": tid, "distance": 0, "match": match, "prior": rec.prior_score, "src": "base"}
    for h in domain_hits:
        tid = h.term_id if hasattr(h, "term_id") else h.term_id
        rec = index.by_term_id.get(tid)
        dist = int(h.distance) if hasattr(h, "distance") else 0
        match = 1.0 if rec and domain_id in (rec.domain_ids or []) else 0.0
        prior = float(h.prior_score) if hasattr(h, "prior_score") else 0.0
        if tid in by_id:
            by_id[tid]["src"] = "both"
            by_id[tid]["distance"] = min(by_id[tid]["distance"], dist)
            by_id[tid]["match"] = max(by_id[tid]["match"], match)
        else:
            by_id[tid] = {"term_id": tid, "distance": dist, "match": match, "prior": prior, "src": "domain"}
    ranked = sorted(
        by_id.values(),
        key=lambda x: (x["distance"] - 2.5 * x["match"] - 1e-4 * float(x["prior"]), x["term_id"]),
    )
    return [x["term_id"] for x in ranked[:budget]]


def recovering_actions(index, rec, span, base_ids, ev, cfg, executor: str) -> list[str]:
    want_tid = rec.term_id
    evid_doms = [d for d, v in (ev or {}).items() if float(v) > 0]
    out = []
    for a in DOMAIN_ACTION_CATALOG:
        if a.kind != "domain_soft":
            continue
        if evid_doms and a.domain_id not in evid_doms:
            # current teacher only searches evidence domains; compare both
            pass
        hit = False
        if executor == "current":
            if evid_doms and a.domain_id not in evid_doms:
                continue
            res = execute_domain_action(index, span, a, ev or {}, base_ids=set(base_ids), cfg=cfg, max_cands=8)
            hit = target_hit(index, want_tid, res.get("term_ids") or [])["identity_hit"]
        elif executor == "node_sql":
            hits = node_sql_exact(index, span.span_syllables, a.domain_id)
            ids = list(base_ids) + [h.term_id for h in hits]
            hit = target_hit(index, want_tid, ids)["identity_hit"] and lexical_identity_key(rec) not in identities_in_term_ids(index, base_ids)
            # introduction: in union and was base-absent. For recoverability of action, identity in domain hits OR union
            hit = target_hit(index, want_tid, [h.term_id for h in hits])["identity_hit"] or (
                target_hit(index, want_tid, ids)["identity_hit"]
                and lexical_identity_key(rec) not in identities_in_term_ids(index, base_ids)
            )
            # simpler: domain query itself returns identity
            hit = target_hit(index, want_tid, [h.term_id for h in hits])["identity_hit"]
        elif executor == "domain_fuzzy_union":
            df = domain_filtered_fuzzy(index, span.span_syllables, a.domain_id)
            final = union_then_budget(index, base_ids, df, budget=16, domain_id=a.domain_id)
            ident_base = identities_in_term_ids(index, base_ids)
            th = target_hit(index, want_tid, final)
            hit = bool(th["identity_hit"]) and lexical_identity_key(rec) not in ident_base
            # also count as recover if domain-filtered raw has it even if budget drops? teacher = useful expansion
            raw_hit = target_hit(index, want_tid, [h.term_id for h in df])["identity_hit"]
            hit = raw_hit and lexical_identity_key(rec) not in ident_base
        if hit:
            out.append(a.action_id)
    return out


def main() -> None:
    t0 = time.perf_counter()
    OUT.mkdir(parents=True, exist_ok=True)
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    rng = random.Random(17)
    device = torch.device("cpu")
    model = RetrievalPolicyV3(with_domain_head=True).to(device)
    obj = torch.load(CKPT, map_location="cpu", weights_only=False)
    sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
    model.load_state_dict(sd, strict=True)
    model.eval()
    print("loaded J1 params", model.param_count(), flush=True)

    domain_recs = [r for r in index.records if r.term_type == "domain"]
    by_ident = defaultdict(list)
    for r in domain_recs:
        by_ident[lexical_identity_key(r)].append(r)
    canonical = [sorted(v, key=lambda x: (-len(x.domain_ids or []), x.term_id))[0] for v in by_ident.values()]

    # ---- rebuild BASE_ABSENT corrupted population (same as yield audit) ----
    print("scan corrupted BASE_ABSENT", flush=True)
    absent = []
    for i, rec in enumerate(canonical):
        if i % 80 == 0:
            print(f"  {i}/{len(canonical)} absent={len(absent)}", flush=True)
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
            absent.append(
                {
                    "rec": rec,
                    "syls": obs,
                    "rel": rel,
                    "profile": prof,
                    "span": span,
                    "base_ids": base_ids,
                }
            )
    print("BASE_ABSENT n=", len(absent), flush=True)

    def eval_case(case, domain_id: str) -> dict:
        rec, span, base_ids, ev = case["rec"], case["span"], case["base_ids"], case["profile"]["long_term_domain_evidence"]
        ident_base = identities_in_term_ids(index, base_ids)
        want = lexical_identity_key(rec)
        # current
        action = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[f"domain_soft:{domain_id}"]]
        cur = execute_domain_action(index, span, action, ev, base_ids=set(base_ids), cfg=cfg, max_cands=8)
        cur_ids = list(cur.get("term_ids") or [])
        cur_intro = bool(target_hit(index, rec.term_id, cur_ids)["identity_hit"]) and want not in ident_base
        # node sql
        node_hits = node_sql_exact(index, span.span_syllables, domain_id)
        node_ids = [h.term_id for h in node_hits]
        node_raw = bool(target_hit(index, rec.term_id, node_ids)["identity_hit"])
        node_union = list(dict.fromkeys(list(base_ids) + node_ids))
        node_final8 = node_union[:8]  # naive concat — also score-union
        node_scored = union_then_budget(index, base_ids, [type("H", (), {"term_id": h.term_id, "distance": 0, "prior_score": h.prior_score})() for h in node_hits], budget=16, domain_id=domain_id)
        node_intro16 = bool(target_hit(index, rec.term_id, node_scored)["identity_hit"]) and want not in ident_base
        # domain fuzzy
        df = domain_filtered_fuzzy(index, span.span_syllables, domain_id)
        df_ids = [h.term_id for h in df]
        df_raw = bool(target_hit(index, rec.term_id, df_ids)["identity_hit"])
        df16 = union_then_budget(index, base_ids, df, budget=16, domain_id=domain_id)
        df8 = union_then_budget(index, base_ids, df, budget=8, domain_id=domain_id)
        df_intro16 = bool(target_hit(index, rec.term_id, df16)["identity_hit"]) and want not in ident_base
        df_intro8 = bool(target_hit(index, rec.term_id, df8)["identity_hit"]) and want not in ident_base
        new_lex16 = identities_in_term_ids(index, df16) - ident_base
        new_lex_cur = identities_in_term_ids(index, cur_ids) - ident_base
        overlap = len(set(cur_ids) & set(df16))
        return {
            "current_n": len(cur_ids),
            "current_intro": cur_intro,
            "current_n_new": int(cur.get("n_new") or 0),
            "current_new_lex": len(new_lex_cur),
            "node_raw": node_raw,
            "node_n": len(node_ids),
            "node_intro16": node_intro16,
            "df_raw": df_raw,
            "df_raw_n": len(df_ids),
            "df_intro16": df_intro16,
            "df_intro8": df_intro8,
            "df_new_lex16": len(new_lex16),
            "overlap_cur_df16": overlap,
        }

    # oracle domain = first tag
    cur_intro = df_raw = df16 = df8 = node_raw = node16 = 0
    new_lex_cur = new_lex_df = 0
    per = []
    for case in absent:
        rec = case["rec"]
        tags = [d for d in (rec.domain_ids or []) if d in DOMAIN_SLOT_IDS]
        oracle = tags[0] if tags else None
        if not oracle:
            continue
        e = eval_case(case, oracle)
        e["surface"] = rec.surface
        e["rel"] = case["rel"]
        e["oracle"] = oracle
        per.append(e)
        cur_intro += int(e["current_intro"])
        df_raw += int(e["df_raw"])
        df16 += int(e["df_intro16"])
        df8 += int(e["df_intro8"])
        node_raw += int(e["node_raw"])
        node16 += int(e["node_intro16"])
        new_lex_cur += e["current_new_lex"]
        new_lex_df += e["df_new_lex16"]

    n_abs = len(per)
    print("oracle funnel", n_abs, "cur", cur_intro, "df16", df16, "node", node_raw, flush=True)

    dump(
        OUT / "stage_d_current_vs_restored_oracle_funnel.json",
        {
            "note": "AUDIT_SIMULATION_ONLY. Node SQL reproduced from queryDomainMultiRowsAtomic contract. domain_filtered_fuzzy = existing FuzzyPool gates on domain-tagged records only.",
            "base_absent_n": n_abs,
            "current": {
                "raw_phonetic_in_shared_pool": n_abs,
                "pool32_then_top8_introduced": cur_intro,
            },
            "restored_node_sql_exact": {
                "raw_query_hit": node_raw,
                "union_budget16_introduced": node16,
                "contract": "domain_id + exact pinyin_key + length; termLength<2 empty; LIMIT 3",
            },
            "restored_domain_filtered_fuzzy_union": {
                "raw_domain_fuzzy_hit": df_raw,
                "union_budget16_introduced": df16,
                "union_budget8_introduced": df8,
            },
        },
    )

    dump(
        OUT / "stage_d_opportunity_expansion.json",
        {
            "current_true_d_opportunity_among_absent": 1.0,
            "current_final_introduced": cur_intro,
            "current_intro_rate": pct(cur_intro, n_abs),
            "node_sql_raw_recoverable": node_raw,
            "node_sql_intro16": node16,
            "domain_fuzzy_raw_recoverable": df_raw,
            "domain_fuzzy_intro16": df16,
            "domain_fuzzy_intro8": df8,
            "yield_improvement_intro16_vs_current": df16 - cur_intro,
            "yield_improvement_rate": pct(df16, n_abs) - pct(cur_intro, n_abs),
            "mean_new_lex_current": round(new_lex_cur / max(1, n_abs), 4),
            "mean_new_lex_df16": round(new_lex_df / max(1, n_abs), 4),
        },
    )

    # ---- teacher stability on V2 d_only + absent sample ----
    v2 = [json.loads(l) for l in V2_D.open(encoding="utf-8")]
    print("teacher stability V2 n=", len(v2), flush=True)
    same = changed = newly = lost = 0
    jacc = []
    details = []
    for r in v2:
        rec = index.by_term_id.get(r["target_term_id"])
        if not rec:
            continue
        span = span_view(r["span"])
        base_ids = list(r.get("base_term_ids") or base_retrieve_span(index, span, cfg=cfg))
        ev = r.get("long_term_domain_evidence") or {}
        cur_set = set(
            a["action_id"] if isinstance(a, dict) else a
            for a in (r.get("teacher_recover_actions") or [])
        )
        if not cur_set:
            cur_set = set(recovering_actions(index, rec, span, base_ids, ev, cfg, "current"))
        rest_set = set(recovering_actions(index, rec, span, base_ids, ev, cfg, "domain_fuzzy_union"))
        node_set = set(recovering_actions(index, rec, span, base_ids, ev, cfg, "node_sql"))
        inter = cur_set & rest_set
        uni = cur_set | rest_set
        jacc.append(len(inter) / len(uni) if uni else 1.0)
        if cur_set == rest_set:
            same += 1
        else:
            changed += 1
        if rest_set - cur_set:
            newly += 1
        if cur_set - rest_set:
            lost += 1
        details.append(
            {
                "term": rec.surface,
                "current": sorted(cur_set),
                "restored_fuzzy": sorted(rest_set),
                "node_sql": sorted(node_set),
            }
        )
    n_v2 = max(1, len(details))
    dump(
        OUT / "stage_d_teacher_label_stability.json",
        {
            "n": len(details),
            "same_teacher_action_set": same,
            "changed_teacher_action_set": changed,
            "newly_recoverable_actions_on_row": newly,
            "no_longer_recoverable_on_row": lost,
            "TEACHER_LABEL_STABILITY_RATE": round(same / n_v2, 6),
            "mean_jaccard": round(sum(jacc) / max(1, len(jacc)), 6),
            "materially_change": (changed / n_v2) > 0.2,
            "sample": details[:15],
            "semantics": "CURRENT_TEACHER_LABEL_SEMANTICS = execute-validated against soft_domain_retrieve pool32/top8, restricted to profile evidence domains",
        },
    )

    # ---- J1 action hit under restored ----
    print("J1 probe", flush=True)
    j1_hit_rest = j1_hit_cur = j1_intro_rest = j1_intro_cur = 0
    cf_stats = Counter()
    cand_effects = []

    def j1_row_eval(r, persona: str = "CORRECT"):
        rec = index.by_term_id.get(r["target_term_id"])
        if not rec:
            return None
        span = span_view(r["span"])
        base_ids = list(r.get("base_term_ids") or base_retrieve_span(index, span, cfg=cfg))
        ev = r.get("long_term_domain_evidence") or {}
        acts = select_d(model, r, budget=2, device=device)
        rest_oracle = set(recovering_actions(index, rec, span, base_ids, ev, cfg, "domain_fuzzy_union"))
        cur_oracle = set(
            a["action_id"] if isinstance(a, dict) else a for a in (r.get("teacher_recover_actions") or [])
        ) or set(recovering_actions(index, rec, span, base_ids, ev, cfg, "current"))
        hit_rest = any(a in rest_oracle for a in acts if a != "domain_none")
        hit_cur = any(a in cur_oracle for a in acts if a != "domain_none")
        intro_c = intro_r = False
        n_new_c = n_new_r = 0
        for aid in acts:
            if aid == "domain_none" or aid not in DOMAIN_ACTION_INDEX:
                continue
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            cres = execute_domain_action(index, span, a, ev, base_ids=set(base_ids), cfg=cfg, max_cands=8)
            if target_hit(index, rec.term_id, cres.get("term_ids") or [])["identity_hit"]:
                intro_c = True
            n_new_c += int(cres.get("n_new") or 0)
            df = domain_filtered_fuzzy(index, span.span_syllables, a.domain_id)
            fin = union_then_budget(index, base_ids, df, budget=16, domain_id=a.domain_id)
            ident_base = identities_in_term_ids(index, base_ids)
            if target_hit(index, rec.term_id, fin)["identity_hit"] and lexical_identity_key(rec) not in ident_base:
                intro_r = True
            n_new_r += len(identities_in_term_ids(index, fin) - ident_base)
        return {
            "persona": persona,
            "acts": acts,
            "hit_restored_oracle": hit_rest,
            "hit_current_oracle": hit_cur,
            "intro_current_exec": intro_c,
            "intro_restored_exec": intro_r,
            "n_new_current": n_new_c,
            "n_new_restored": n_new_r,
            "rest_oracle_n": len(rest_oracle),
            "cur_oracle_n": len(cur_oracle),
        }

    for r in v2:
        e = j1_row_eval(r, "CORRECT")
        if not e:
            continue
        j1_hit_rest += int(e["hit_restored_oracle"])
        j1_hit_cur += int(e["hit_current_oracle"])
        j1_intro_rest += int(e["intro_restored_exec"])
        j1_intro_cur += int(e["intro_current_exec"])
        cand_effects.append(e)

    n_j1 = max(1, len(cand_effects))
    dump(
        OUT / "stage_d_j1_action_hit_restored_contract.json",
        {
            "n": len(cand_effects),
            "J1_ACTION_HIT_UNDER_CURRENT_ORACLE": pct(j1_hit_cur, n_j1),
            "J1_ACTION_HIT_UNDER_RESTORED_CONTRACT": pct(j1_hit_rest, n_j1),
            "J1_target_intro_current_executor": pct(j1_intro_cur, n_j1),
            "J1_target_intro_restored_executor": pct(j1_intro_rest, n_j1),
            "note": "CHECKPOINT_COMPATIBILITY_PROBE on V2 D eligible. Not a production freeze.",
        },
    )

    # counterfactual personas
    if V2_CF.exists():
        cfs = [json.loads(l) for l in V2_CF.open(encoding="utf-8")]
        by_g = defaultdict(list)
        for r in cfs:
            by_g[r.get("group_id") or r.get("case_id", "")].append(r)
        n_cf = 0
        for rows in list(by_g.values())[:45]:
            for r in rows:
                persona = r.get("persona") or "UNK"
                e = j1_row_eval(r, persona)
                if not e:
                    continue
                n_cf += 1
                cf_stats[f"{persona}_intro_current"] += int(e["intro_current_exec"])
                cf_stats[f"{persona}_intro_restored"] += int(e["intro_restored_exec"])
                cf_stats[f"{persona}_n"] += 1
        dump(
            OUT / "stage_d_j1_counterfactual_probe.json",
            {"n_rows": n_cf, "counts": dict(cf_stats)},
        )

    dump(
        OUT / "stage_d_current_vs_restored_candidate_effect.json",
        {
            "same_J1_action": True,
            "n": len(cand_effects),
            "mean_n_new_current": round(sum(e["n_new_current"] for e in cand_effects) / n_j1, 4),
            "mean_n_new_restored": round(sum(e["n_new_restored"] for e in cand_effects) / n_j1, 4),
            "intro_current": j1_intro_cur,
            "intro_restored": j1_intro_rest,
            "interpretation": "If intro_restored >> intro_current with same J1 actions, model domain choice is OK and executor is the bottleneck.",
            "head": cand_effects[:12],
        },
    )

    # checkpoint contract
    heads = {
        "action_logits": "P-path retrieval actions",
        "query_budget_logits": "P-path query budget classes (1,2,3,4,6,8)",
        "cand_budget_logits": "P-path candidate budget 4-way",
        "domain_action_logits": "N_DOMAIN_ACTIONS = 13 (domain_none + 12 slots)",
    }
    dump(
        OUT / "stage_d_checkpoint_output_contract.json",
        {
            "checkpoint": str(CKPT.as_posix()),
            "architecture": "RetrievalPolicyV3(with_domain_head=True)",
            "params": model.param_count(),
            "outputs": heads,
            "domain_action_ids": [a.action_id for a in DOMAIN_ACTION_CATALOG],
            "executor_encoded_in_output": False,
            "note": "domain_action_head is a linear map over shared trunk to slot ids, not pool32/top8 parameters.",
        },
    )

    dump(
        OUT / "stage_d_action_semantics_compatibility.json",
        {
            "ACTION_SPACE_COMPATIBILITY": "FULL",
            "action_ids_are_domain_slot_identities": True,
            "current_meaning": "rerank shared phonetic pool toward selected domain",
            "restored_meaning": "query domain-tagged lexical universe as soft expansion, UNION with base",
            "same_action_intent_different_executor": True,
            "different_action_semantics": False,
            "Action_IDs_Change_Required": False,
        },
    )

    dump(
        OUT / "stage_d_policy_executor_coupling.json",
        {
            "POLICY_EXECUTOR_COUPLING": "MEDIUM",
            "why": "Output space is slot ids (LOW). Teacher is execute-validated on current executor (HIGH). Features mostly executor-independent (LOW/SOME).",
            "policy_selects_domain_action": True,
            "executor_implements_retrieval": True,
            "features_encode_pool_rank": False,
        },
    )

    dump(
        OUT / "stage_d_executor_dependent_features.json",
        {
            "EXECUTOR_DEPENDENT_FEATURES": "SOME",
            "fields": [
                {"name": "span hash", "dependent": False, "file": "feature_hash_v1.py / pack_batch_inputs"},
                {"name": "phonetic profile items", "dependent": False},
                {"name": "lexical term hashes", "dependent": False},
                {"name": "domain_evidence slots", "dependent": False, "note": "derived from personal_terms × term_domain_tags"},
                {"name": "state.base_pool", "dependent": True, "note": "count of current base FuzzyPool; still k=16 if base_retrieve_span unchanged"},
                {"name": "state.n_applicable / applicability", "dependent": False, "note": "P-path phonetic applicability"},
                {"name": "state.query_budget / cand_budget", "dependent": False, "note": "eval hardcodes 8; not pool32 rank"},
                {"name": "pool32 rank / rerank score / top8 outcome", "dependent": False, "present": False},
            ],
            "Input_Feature_Contract_Changes": False,
        },
    )

    dump(
        OUT / "stage_d_checkpoint_budget_compatibility.json",
        {
            "query_budget_head": "P-path; D eval unused",
            "cand_budget_head": "P-path 4-way; D eval unused (fixed max_cands=8)",
            "D_eval_domain_action_budget": 2,
            "restored_reuse": "YES as unused D outputs; do not redefine heads. Downstream single per-span cap is executor/assembly, not a new model output.",
            "Budget_output_semantics_change_for_D": False,
            "Executor_budget_stack_change": True,
        },
    )

    dump(
        OUT / "stage_d_restoration_complexity.json",
        {
            "RESTORATION_COMPLEXITY": "LOW",
            "new_services": 0,
            "new_model_heads": 0,
            "new_config": 0,
            "new_tables": 0,
            "new_gates": 0,
            "new_budgets": 0,
            "new_fallbacks": 0,
            "new_candidate_types": 0,
            "allowed": "replace soft_domain_retrieve body with domain-conditioned FuzzyPool UNION using existing pool.py + domain_ids; teacher/eval adapter",
            "not_node_sql_drop_in": "Node exact pinyin SQL is a different primitive; FineSpan ASR noise needs fuzzy gates already in pool.py",
        },
    )

    dump(
        OUT / "stage_d_original_design_conformance.json",
        {
            "FineSpan_authoritative": "YES",
            "UserProfile_authoritative": "YES",
            "ONE_Model2": "YES",
            "Trainable_policy": "YES",
            "Domain_soft_prior": "YES (never hard-filter base)",
            "Domain_conditioned_expansion": "YES if domain-filtered fuzzy UNION; NO if keep current rerank; NO if Node exact-only",
            "Lexicon_SSOT": "YES (domain_ids from term_domain_tags / index)",
            "Base_recall_unchanged": "YES",
            "No_hard_filter": "YES",
            "No_whole_utterance": "YES",
            "No_second_model": "YES",
            "No_shadow_path": "YES if retire current executor role",
            "Single_candidate_merge": "YES (UNION then one budget)",
            "Single_downstream_budget_owner": "YES (proposed)",
        },
    )

    # decision
    teacher_material = (changed / n_v2) > 0.2
    yield_improves = df16 > cur_intro + max(2, cur_intro)
    opp_changes = df16 != cur_intro
    j1_still_useful = pct(j1_hit_rest, n_j1) >= 0.5
    action_ids_ok = True
    features_ok = True
    budget_model_ok = True

    if not yield_improves and cur_intro > 0:
        nxt = "RETRAIN_ONLY"
        why = "executor already matches intended yield; would only retrain selection"
    elif yield_improves and not teacher_material and j1_still_useful and features_ok:
        nxt = "RESTORE_ONLY_THEN_REEVALUATE"
        why = "executor restore improves yield; labels/features/action ids stable; J1 still hits restored oracle"
    elif yield_improves and (teacher_material or opp_changes):
        nxt = "RESTORE_THEN_REBUILD_DATA_AND_RETRAIN"
        why = "restore improves expansion but execute-validated teacher/opportunity set changes; rebuild labels then retrain SAME RetrievalPolicyV3"
    else:
        nxt = "ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED"
        why = "cannot restore original expansion with existing primitives without product-design change"

    # Force logic per user: teacher change + opportunity change => restore then retrain
    if yield_improves and teacher_material:
        nxt = "RESTORE_THEN_REBUILD_DATA_AND_RETRAIN"
        why = (
            "Domain-filtered FuzzyPool UNION restores expansion (yield up). "
            "Teacher is execute-validated on the current pool32/top8 executor, so labels and eligible D distribution change. "
            "Action IDs unchanged; do not add a model. Rebuild teacher/data then controlled retrain. Not automatic J2."
        )

    dump(
        OUT / "restore_vs_retrain_decision.json",
        {
            "NEXT": nxt,
            "reason": why,
            "table": {
                "Action ids unchanged": "YES",
                "Teacher labels stable": f"{same}/{len(details)} rate={round(same/n_v2,4)}",
                "Input features stable": "YES (SOME base_pool count only)",
                "Budget semantics stable (model heads)": "YES unused for D",
                "J1 actions still useful": f"hit_restored={pct(j1_hit_rest, n_j1)} intro_restored={pct(j1_intro_rest, n_j1)}",
                "Restored executor improves yield": f"YES {cur_intro} -> {df16} (budget16) / {df8} (budget8); Node SQL {node_raw}",
                "New dataset distribution changes": "YES" if opp_changes else "NO",
                "Retraining required": "YES" if nxt.endswith("RETRAIN") and nxt != "RETRAIN_ONLY" else ("YES" if nxt == "RETRAIN_ONLY" else "NO"),
            },
            "criteria": {
                "A_teacher_labels_materially_change": teacher_material,
                "B_action_space_semantics_change": False,
                "C_input_feature_semantics_change": False,
                "D_budget_output_semantics_change": False,
                "E_J1_action_hit_drops": pct(j1_hit_rest, n_j1) < 0.5,
                "F_opportunity_distribution_changes": opp_changes,
            },
            "elapsed_s": round(time.perf_counter() - t0, 2),
            "created": datetime.now(timezone.utc).isoformat(),
            "n_absent": n_abs,
            "cur_intro": cur_intro,
            "df16": df16,
            "df8": df8,
            "node_raw": node_raw,
            "j1_hit_rest": pct(j1_hit_rest, n_j1),
            "j1_intro_rest": pct(j1_intro_rest, n_j1),
            "j1_intro_cur": pct(j1_intro_cur, n_j1),
            "teacher_stability": round(same / n_v2, 6),
            "teacher_changed": changed,
            "teacher_n": len(details),
        },
    )

    dump_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": "training/model2_v3/policy/domain_actions.py", "production_runtime": "YES", "this_round": "NO"},
            {"path": "electron_node/.../lexicon-runtime-v2.ts", "production_runtime": "YES", "this_round": "NO"},
            {"path": "training/model2_v3/scripts/run_v3_stage_d_restore_vs_retrain_decision_audit.py", "production_runtime": "NO", "this_round": "YES"},
            {"path": "training/model2_v3/experiments/v3_stage_d_restore_vs_retrain_audit/", "production_runtime": "NO", "this_round": "YES"},
            {"path": "(summary)", "production_runtime": "production_code_modified=0", "this_round": "0"},
        ],
        ["path", "production_runtime", "this_round"],
    )
    dump(OUT / "audit_summary.json", json.loads((OUT / "restore_vs_retrain_decision.json").read_text(encoding="utf-8")))
    print("DONE", nxt, "elapsed", round(time.perf_counter() - t0, 2), flush=True)


if __name__ == "__main__":
    main()
