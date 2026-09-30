#!/usr/bin/env python3
"""Stage J Production Benchmark Expansion — STAGE_J_PRODUCTION_BENCHMARK_V1.

Phase A only: expand D-only / P+D / negatives / counterfactuals / held-outs.
Does NOT relax eligible contracts. Does NOT invent term→domain mappings.
Does NOT train.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    derive_domain_evidence,
    execute_domain_action,
    soft_domain_retrieve,
)
from training.model2_v3.policy.feature_hash_v1 import MODEL2_FEATURE_HASH_VERSION, contract_meta as hash_contract
from training.model2_v3.policy.stage_d_target_identity_v1 import (
    CONTRACT_ID as TARGET_ID_CONTRACT,
    contract_meta as target_contract,
    identities_in_term_ids,
    lexical_identity_key,
    lexical_identity_key_from_term_id,
    target_hit,
)
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import corrupt_syllables, span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2"
# Stage D2 index is multitag-enriched (base siblings carry term_domain_tags) — required for soft prior
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
BENCH_VERSION = "STAGE_J_PRODUCTION_BENCHMARK_V1"


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


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def sample_domain_terms(index, domain: str, n: int, rng: random.Random, exclude_surface: set[str]) -> list[str]:
    pool = [
        r.surface
        for r in index.records
        if r.term_type == "domain" and domain in (r.domain_ids or []) and r.surface not in exclude_surface
    ]
    rng.shuffle(pool)
    return pool[:n]


def build_correct_profile(index, target_rec, rng: random.Random, *, n_terms: int, confirms: int) -> dict:
    """Lexicon-backed personal_terms from target domains (no invented mappings)."""
    doms = [d for d in (target_rec.domain_ids or []) if d in DOMAIN_SLOT_IDS]
    if not doms:
        return {"personal_terms": [], "personal_term_evidence": {}, "long_term_domain_evidence": {}, "target_domains": []}
    terms: list[str] = []
    per = max(1, n_terms // max(1, len(doms)))
    for d in doms:
        terms.extend(sample_domain_terms(index, d, per, rng, {target_rec.surface}))
    # pad from primary
    if len(terms) < n_terms:
        terms.extend(sample_domain_terms(index, doms[0], n_terms - len(terms), rng, {target_rec.surface, *terms}))
    terms = terms[:n_terms]
    # confirmation strength → EMA-like term evidence
    alpha = 0.25
    w = 0.0
    for _ in range(max(1, confirms)):
        w = w * (1.0 - alpha) + alpha
    w = max(0.05, min(1.0, w))
    term_ev = {t: max(0.05, w - 0.008 * i) for i, t in enumerate(terms)}
    evid = derive_domain_evidence(terms, index, term_evidence=term_ev)
    return {
        "personal_terms": terms,
        "personal_term_evidence": term_ev,
        "long_term_domain_evidence": evid,
        "target_domains": list(doms),
        "profile_strength": confirms,
        "profile_size": len(terms),
    }


def try_eligible_case(
    index,
    rec,
    cfg,
    rng: random.Random,
    *,
    max_attempts: int = 40,
    profile: Optional[dict] = None,
) -> Optional[dict]:
    want = lexical_identity_key(rec)
    tid = rec.term_id
    if profile is None:
        profile = build_correct_profile(index, rec, rng, n_terms=rng.choice([5, 20, 50]), confirms=rng.choice([1, 5, 20]))
    ev = profile["long_term_domain_evidence"]
    if not any(float(v) > 0 for v in ev.values()):
        return None
    evidence_domains = [d for d, v in ev.items() if float(v) > 0]
    for attempt in range(max_attempts):
        syls = list(rec.syllables)
        for _ in range(1 if attempt < 20 else 2):
            syls = corrupt_syllables(syls, rng)
        span_d = {
            "span_id": f"prod_{rec.term_id}_{attempt}",
            "syllable_start": 0,
            "syllable_end": len(syls),
            "span_syllables": syls,
            "window_text": rec.surface,
            "window_pinyin_key": "".join(syls),
            "raw_start": 0,
            "raw_end": len(rec.surface or ""),
            "source": "prod_benchmark_corrupt_v1",
        }
        span = span_view(span_d)
        base_ids = base_retrieve_span(index, span, cfg=cfg)
        if want in identities_in_term_ids(index, base_ids):
            continue
        recovering = []
        for a in DOMAIN_ACTION_CATALOG:
            if a.kind != "domain_soft" or a.domain_id not in evidence_domains:
                continue
            res = execute_domain_action(index, span, a, ev, base_ids=set(base_ids), cfg=cfg, max_cands=8)
            hit = target_hit(index, tid, res.get("term_ids") or [])
            if hit["identity_hit"]:
                recovering.append({"action_id": a.action_id, "domain_id": a.domain_id})
            if not recovering:
                continue
            # Contract: base-absent + soft domain action introduces.
            # Empty counterfactual uses domain_none (no candidates), not zero-weight soft expand.
            # Do NOT require zero_soft miss — that over-filters when soft only reorders within top-k.
            return {
            "case_id": f"d_elig_{hashlib.md5((tid+'|'+'|'.join(syls)).encode()).hexdigest()[:12]}",
            "target_term_id": tid,
            "target_surface": rec.surface,
            "target_pinyin_key": rec.pinyin_key,
            "target_domains": list(rec.domain_ids or []),
            "span": span_d,
            "base_term_ids": list(base_ids),
            "base_absent_identity": True,
            "teacher_recover_actions": recovering,
            "teacher_any_recover": True,
            "multitag": len(rec.domain_ids or []) > 1,
            **profile,
            "construction": "lexicon_domain_term + pronunciation_corrupt_finespan_v1",
            "attempt": attempt,
        }
    return None


def domain_label_from_actions(actions: list[dict]) -> list[float]:
    from training.model2_v3.policy.domain_actions import N_DOMAIN_ACTIONS

    y = [0.0] * N_DOMAIN_ACTIONS
    y[DOMAIN_ACTION_INDEX["domain_none"]] = 1.0
    for a in actions:
        aid = a["action_id"]
        if aid in DOMAIN_ACTION_INDEX:
            y[DOMAIN_ACTION_INDEX[aid]] = 1.0
            y[DOMAIN_ACTION_INDEX["domain_none"]] = 0.0
    return y


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    rng = random.Random(42)
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    rows_p = load_jsonl(DATA_P / "rows.jsonl")
    hard_p = [r for r in rows_p if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    print("index", len(index.records), "hard_p", len(hard_p), flush=True)

    # ---- Expand D-only eligible from all lexicon domain terms ----
    domain_recs = [r for r in index.records if r.term_type == "domain" and r.domain_ids]
    rng.shuffle(domain_recs)
    print("scan domain terms", len(domain_recs), flush=True)
    eligible: list[dict] = []
    fail = Counter()
    # Prefer diversity: round-robin domains
    by_dom: dict[str, list] = defaultdict(list)
    for r in domain_recs:
        for d in r.domain_ids or []:
            if d in DOMAIN_SLOT_IDS:
                by_dom[d].append(r)
    # unique by term_id preserving order
    seen_tid = set()
    ordered = []
    max_len = max((len(v) for v in by_dom.values()), default=0)
    for i in range(max_len):
        for d in DOMAIN_SLOT_IDS:
            if i < len(by_dom[d]):
                r = by_dom[d][i]
                if r.term_id not in seen_tid:
                    seen_tid.add(r.term_id)
                    ordered.append(r)

    for i, rec in enumerate(ordered):
        if i % 50 == 0:
            print(f"  eligible progress {i}/{len(ordered)} found={len(eligible)}", flush=True)
        # try multiple profile sizes / strengths for diversity (up to 2 successes per term)
        got_for_term = 0
        # one profile variant per term for scale (diversity via term/domain coverage)
        for n_terms, confirms in [(20, 5)]:
            if got_for_term >= 1:
                break
            if len(eligible) >= 320:
                break
            prof = build_correct_profile(index, rec, rng, n_terms=n_terms, confirms=confirms)
            case = try_eligible_case(index, rec, cfg, rng, max_attempts=36, profile=prof)
            if case is None:
                fail["no_eligible_attempt"] += 1
                continue
            case["case_id"] = f"{case['case_id']}_s{n_terms}_c{confirms}"
            eligible.append(case)
            got_for_term += 1
        if len(eligible) >= 320:
            break
        # early useful target
        if len(eligible) >= 120 and i >= 400:
            break

    print("eligible_d_only", len(eligible), flush=True)

    # Held-out term split: hash term identity
    for c in eligible:
        h = int(hashlib.md5(c["target_term_id"].encode()).hexdigest()[:8], 16)
        c["heldout_term"] = (h % 5 == 0)  # ~20%
        c["split"] = "test" if c["heldout_term"] else ("val" if h % 5 == 1 else "train")

    # Counterfactuals for eligible
    cf_groups = []
    cf_rows = []
    for c in eligible:
        group = {"group_id": c["case_id"], "target_term_id": c["target_term_id"], "span": c["span"], "personas": {}}
        # Correct
        personas = {
            "CORRECT": {
                "long_term_domain_evidence": c["long_term_domain_evidence"],
                "personal_terms": c["personal_terms"],
                "personal_term_evidence": c["personal_term_evidence"],
            },
            "EMPTY": {"long_term_domain_evidence": {}, "personal_terms": [], "personal_term_evidence": {}},
        }
        # Wrong: pick unrelated domain terms
        wrong_doms = [d for d in DOMAIN_SLOT_IDS if d not in (c.get("target_domains") or [])]
        if wrong_doms:
            wd = rng.choice(wrong_doms)
            wterms = sample_domain_terms(index, wd, min(10, max(1, c.get("profile_size") or 5)), rng, {c["target_surface"]})
            wev = {t: 0.8 for t in wterms}
            personas["WRONG"] = {
                "long_term_domain_evidence": derive_domain_evidence(wterms, index, term_evidence=wev),
                "personal_terms": wterms,
                "personal_term_evidence": wev,
            }
            # Swapped: another wrong
            wd2 = rng.choice([d for d in wrong_doms if d != wd] or wrong_doms)
            sterms = sample_domain_terms(index, wd2, min(10, max(1, c.get("profile_size") or 5)), rng, {c["target_surface"]})
            sev = {t: 0.8 for t in sterms}
            personas["SWAPPED"] = {
                "long_term_domain_evidence": derive_domain_evidence(sterms, index, term_evidence=sev),
                "personal_terms": sterms,
                "personal_term_evidence": sev,
            }
        # Multi-domain correct / generic-heavy / weak-strong variants
        if len(c.get("target_domains") or []) > 1:
            personas["MULTI_DOMAIN_CORRECT"] = personas["CORRECT"]
        # Weak vs strong copies if size allows
        if c.get("profile_strength") == 1:
            personas["WEAK_CORRECT"] = personas["CORRECT"]
        if c.get("profile_strength") == 20:
            personas["STRONG_CORRECT"] = personas["CORRECT"]

        group["personas"] = {k: True for k in personas}
        cf_groups.append(group)
        for pname, pdat in personas.items():
            cf_rows.append(
                {
                    "case_id": f"{c['case_id']}_{pname}",
                    "group_id": c["case_id"],
                    "persona": pname,
                    "span": c["span"],
                    "target_term_id": c["target_term_id"],
                    "target_domains": c["target_domains"],
                    "split": c["split"],
                    "heldout_term": c["heldout_term"],
                    "teacher_recover_actions": c["teacher_recover_actions"] if pname.startswith("CORRECT") or pname.endswith("CORRECT") else [],
                    "teacher_any_recover": bool(pname.startswith("CORRECT") or pname.endswith("CORRECT")),
                    "label_domain_actions": domain_label_from_actions(c["teacher_recover_actions"])
                    if (pname.startswith("CORRECT") or pname.endswith("CORRECT"))
                    else [0.0] * len(DOMAIN_ACTION_CATALOG),
                    **pdat,
                    "case_family": "D_ONLY",
                    "eligible_d_only": pname in ("CORRECT", "MULTI_DOMAIN_CORRECT", "WEAK_CORRECT", "STRONG_CORRECT"),
                }
            )

    # Negatives
    negatives = []
    # base-already-sufficient: exact span domain terms
    for rec in ordered[:80]:
        span_d = {
            "span_id": f"neg_base_{rec.term_id}",
            "syllable_start": 0,
            "syllable_end": len(rec.syllables),
            "span_syllables": list(rec.syllables),
            "window_text": rec.surface,
            "window_pinyin_key": "".join(rec.syllables),
            "raw_start": 0,
            "raw_end": len(rec.surface or ""),
            "source": "neg_base_visible",
        }
        base_ids = base_retrieve_span(index, span_view(span_d), cfg=cfg)
        if lexical_identity_key(rec) in identities_in_term_ids(index, base_ids):
            negatives.append(
                {
                    "case_id": f"neg_base_{rec.term_id}",
                    "neg_type": "BASE_ALREADY_SUFFICIENT",
                    "span": span_d,
                    "target_term_id": rec.term_id,
                    "eligible_d_only": False,
                    "split": "test",
                }
            )
    # empty / irrelevant profiles on eligible spans
    for c in eligible[:60]:
        negatives.append(
            {
                "case_id": f"neg_empty_{c['case_id']}",
                "neg_type": "EMPTY_PROFILE",
                "span": c["span"],
                "target_term_id": c["target_term_id"],
                "long_term_domain_evidence": {},
                "personal_terms": [],
                "eligible_d_only": False,
                "split": c["split"],
            }
        )
        wrong_doms = [d for d in DOMAIN_SLOT_IDS if d not in (c.get("target_domains") or [])]
        if wrong_doms:
            wd = wrong_doms[0]
            wt = sample_domain_terms(index, wd, 8, rng, {c["target_surface"]})
            negatives.append(
                {
                    "case_id": f"neg_irr_{c['case_id']}",
                    "neg_type": "PROFILE_IRRELEVANT",
                    "span": c["span"],
                    "target_term_id": c["target_term_id"],
                    "personal_terms": wt,
                    "long_term_domain_evidence": derive_domain_evidence(wt, index, term_evidence={t: 0.7 for t in wt}),
                    "eligible_d_only": False,
                    "split": c["split"],
                }
            )

    # ---- P+D combined: hard P spans + lexicon domain evidence when target surface maps to domain ----
    print("build P+D", flush=True)
    surface_to_domain_recs: dict[str, list] = defaultdict(list)
    for r in index.records:
        if r.term_type == "domain":
            surface_to_domain_recs[r.surface].append(r)

    pd_cases = []
    # Prefer weak relations for expansion
    weak_rels = ("in_ing", "ch_c", "eng_en", "z_zh")
    hard_sorted = sorted(
        hard_p,
        key=lambda r: (
            0 if any(float((r.get("profile_phonetic") or {}).get(rel) or 0) > 0 for rel in weak_rels) else 1,
            r.get("row_id"),
        ),
    )
    for r in hard_sorted:
        if len(pd_cases) >= 800:
            break
        tsurf = (r.get("target_term") or "").strip()
        # resolve domain via lexicon surface (not invented)
        drecs = surface_to_domain_recs.get(tsurf) or []
        # also try window_text
        if not drecs:
            drecs = surface_to_domain_recs.get((r.get("span") or {}).get("window_text") or "") or []
        if not drecs:
            continue
        drec = drecs[0]
        confirms = rng.choice([1, 5, 20])
        n_terms = rng.choice([5, 20, 50])
        prof = build_correct_profile(index, drec, rng, n_terms=n_terms, confirms=confirms)
        # Use phase2 span (real ASR-style) — check D introduction under identity of domain sibling if needed
        span = span_view(r["span"])
        tid_p = r["target_term_id"]
        # Prefer domain term_id when surface matches
        tid_d = drec.term_id
        base_ids = set(base_retrieve_span(index, span, cfg=cfg))
        want = lexical_identity_key(drec)
        base_abs = want not in identities_in_term_ids(index, base_ids)
        # execute-validate domain recovery if base absent; else still keep as P+D ranking case (not D-intro)
        recovering = []
        if base_abs:
            ev = prof["long_term_domain_evidence"]
            evid_doms = [d for d, v in ev.items() if float(v) > 0]
            for a in DOMAIN_ACTION_CATALOG:
                if a.kind != "domain_soft" or a.domain_id not in evid_doms:
                    continue
                res = execute_domain_action(index, span, a, ev, base_ids=base_ids, cfg=cfg, max_cands=8)
                if target_hit(index, tid_d, res.get("term_ids") or [])["identity_hit"]:
                    recovering.append({"action_id": a.action_id, "domain_id": a.domain_id})
        pd_cases.append(
            {
                "case_id": f"pd_{r['row_id']}_{confirms}",
                "source_p_row_id": r["row_id"],
                "span": r["span"],
                "target_term_id": tid_p,
                "domain_target_term_id": tid_d,
                "target_term": tsurf,
                "target_domains": list(drec.domain_ids or []),
                "profile_phonetic": r.get("profile_phonetic") or {},
                "teacher_p": r.get("teacher") or {},
                "label_actions": r.get("label_actions"),
                "label_query_budget_class": r.get("label_query_budget_class", 1),
                "is_hard_multi": True,
                "variant": r.get("variant"),
                "base_absent_domain_identity": base_abs,
                "teacher_recover_actions": recovering,
                "teacher_any_recover_d": bool(recovering),
                "eligible_pd_intro": bool(base_abs and recovering),
                "split": r.get("split"),
                "pseudo_user_id": r.get("pseudo_user_id"),
                "case_family": "P_PLUS_D",
                **prof,
            }
        )

    pd_eligible = [c for c in pd_cases if c.get("eligible_pd_intro")]
    print("pd_cases", len(pd_cases), "pd_eligible_intro", len(pd_eligible), flush=True)

    # Hard-D: multi-domain + base absent
    hard_d = [c for c in eligible if c.get("multitag") and len(c.get("teacher_recover_actions") or []) >= 1]
    # Same profile different spans: group by profile fingerprint
    # Held-out span: duplicate eligible with alternate corruption when possible
    heldout_spans = []
    for c in eligible[:80]:
        rec = index.by_term_id.get(c["target_term_id"])
        if not rec:
            continue
        alt = try_eligible_case(
            index,
            rec,
            cfg,
            random.Random(hash(c["case_id"]) & 0xFFFFFFFF),
            max_attempts=12,
            profile={
                "personal_terms": c["personal_terms"],
                "personal_term_evidence": c["personal_term_evidence"],
                "long_term_domain_evidence": c["long_term_domain_evidence"],
                "target_domains": c["target_domains"],
                "profile_strength": c.get("profile_strength", 5),
                "profile_size": c.get("profile_size", len(c["personal_terms"])),
            },
        )
        if alt and alt["span"]["span_syllables"] != c["span"]["span_syllables"]:
            alt["case_id"] = f"span2_{c['case_id']}"
            alt["heldout_span"] = True
            alt["paired_case_id"] = c["case_id"]
            alt["split"] = "test"
            heldout_spans.append(alt)

    # Dedup audit
    def sig(c):
        return (
            c.get("target_term_id"),
            tuple((c.get("span") or {}).get("span_syllables") or []),
            tuple(sorted((c.get("personal_terms") or [])[:8])),
        )

    all_d = eligible + heldout_spans
    sigs = [sig(c) for c in all_d]
    dup = len(sigs) - len(set(sigs))
    near = 0  # same term+syllables different profile counted separately — OK

    # Domain / relation coverage
    dom_cov = Counter()
    for c in eligible:
        for d in c.get("target_domains") or []:
            dom_cov[d] += 1
    low_dom = [d for d in DOMAIN_SLOT_IDS if dom_cov[d] < 5]

    rel_cov = Counter()
    for r in hard_p:
        for rel in ACTIVE_SET_V1:
            if float((r.get("profile_phonetic") or {}).get(rel) or 0) > 0:
                rel_cov[rel] += 1

    # Leakage audit: heldout terms must not appear in train eligible as target
    train_terms = {c["target_term_id"] for c in eligible if c["split"] == "train"}
    test_terms = {c["target_term_id"] for c in eligible if c["heldout_term"]}
    leakage_term = sorted(train_terms & test_terms)

    # Write row files for training
    d_train_rows = []
    for c in eligible:
        d_train_rows.append(
            {
                "row_id": c["case_id"],
                "split": c["split"],
                "span": c["span"],
                "target_term_id": c["target_term_id"],
                "target_term": c["target_surface"],
                "target_domains": c["target_domains"],
                "personal_terms": c["personal_terms"],
                "personal_term_evidence": c["personal_term_evidence"],
                "long_term_domain_evidence": c["long_term_domain_evidence"],
                "label_domain_actions": domain_label_from_actions(c["teacher_recover_actions"]),
                "teacher_recover_actions": c["teacher_recover_actions"],
                "teacher_any_recover": True,
                "execute_validated": True,
                "eligible_d_only": True,
                "heldout_term": c["heldout_term"],
                "multitag": c.get("multitag"),
                "profile_strength": c.get("profile_strength"),
                "profile_size": c.get("profile_size"),
                "case_family": "D_ONLY",
                "base_pool": len(c.get("base_term_ids") or []),
                "construction": c.get("construction"),
            }
        )

    # Artifacts
    dump_jsonl(OUT / "dataset" / "d_only_eligible.jsonl", d_train_rows)
    dump_jsonl(OUT / "dataset" / "pd_cases.jsonl", pd_cases)
    dump_jsonl(OUT / "dataset" / "counterfactual_rows.jsonl", cf_rows)
    dump_jsonl(OUT / "dataset" / "negatives.jsonl", negatives)
    dump_jsonl(OUT / "dataset" / "heldout_spans.jsonl", heldout_spans)

    dump(
        OUT / "stage_j_prod_benchmark_manifest.json",
        {
            "version": BENCH_VERSION,
            "P_only_hard_n": len(hard_p),
            "P_heldout_approx": len([r for r in hard_p if r["split"] in ("test", "val")]),
            "D_only_eligible_n": len(eligible),
            "P_plus_D_n": len(pd_cases),
            "P_plus_D_eligible_intro_n": len(pd_eligible),
            "negative_n": len(negatives),
            "counterfactual_rows_n": len(cf_rows),
            "counterfactual_groups_n": len(cf_groups),
            "heldout_term_n": len([c for c in eligible if c["heldout_term"]]),
            "heldout_span_n": len(heldout_spans),
            "hard_d_n": len(hard_d),
            "multitag_eligible_n": len([c for c in eligible if c.get("multitag")]),
            "build_seconds": time.perf_counter() - t0,
            "DATA_COVERAGE_LIMITED": len(eligible) < 100 or len(pd_eligible) < 100,
            "REAL_D_ONLY_COVERAGE_NOTE": "Eligible requires soft-prior + FineSpan noise; exact spans excluded by contract",
        },
    )
    dump(
        OUT / "stage_j_prod_benchmark_version.json",
        {
            "benchmark_version": BENCH_VERSION,
            "feature_hash": MODEL2_FEATURE_HASH_VERSION,
            "feature_hash_contract": hash_contract(),
            "target_identity": TARGET_ID_CONTRACT,
            "target_identity_contract": target_contract(),
            "domain_slots": list(DOMAIN_SLOT_IDS),
            "lexicon_index": str(IDX.relative_to(ROOT)).replace("\\", "/"),
            "lexicon_index_sha256": file_sha256(IDX),
            "lexicon_meta_sha256": file_sha256(IDX_META),
            "frozen": True,
            "note": "Do not mutate test splits after freeze",
        },
    )
    dump(
        OUT / "stage_j_prod_dataset_dedup_audit.json",
        {
            "exact_duplicate_sigs": dup,
            "PASS": dup == 0,
            "n_eligible_plus_heldout_span": len(all_d),
            "unique_sigs": len(set(sigs)),
        },
    )
    dump(
        OUT / "stage_j_prod_dataset_leakage_audit.json",
        {
            "heldout_term_overlap_with_train": leakage_term,
            "PASS": len(leakage_term) == 0,
            "split_rule": "md5(term_id)%5==0 → heldout test; ==1 val; else train",
            "note": "Same term may appear with different FineSpans across splits only if split tied to term_id",
        },
    )
    dump(OUT / "stage_j_prod_p_only_manifest.json", {"n_hard": len(hard_p), "relation_counts": dict(rel_cov), "split_counts": dict(Counter(r["split"] for r in hard_p))})
    dump(
        OUT / "stage_j_prod_d_only_manifest.json",
        {
            "n": len(eligible),
            "split_counts": dict(Counter(c["split"] for c in eligible)),
            "profile_size_hist": dict(Counter(c.get("profile_size") for c in eligible)),
            "profile_strength_hist": dict(Counter(c.get("profile_strength") for c in eligible)),
            "multitag_n": len([c for c in eligible if c.get("multitag")]),
        },
    )
    dump(
        OUT / "stage_j_prod_pd_manifest.json",
        {"n": len(pd_cases), "eligible_intro_n": len(pd_eligible), "split_counts": dict(Counter(c.get("split") for c in pd_cases))},
    )
    dump(OUT / "stage_j_prod_negative_manifest.json", {"n": len(negatives), "types": dict(Counter(n["neg_type"] for n in negatives))})
    dump(
        OUT / "stage_j_prod_counterfactual_manifest.json",
        {"groups": len(cf_groups), "rows": len(cf_rows), "persona_counts": dict(Counter(r["persona"] for r in cf_rows))},
    )
    dump(
        OUT / "stage_j_prod_heldout_term_manifest.json",
        {"n": len([c for c in eligible if c["heldout_term"]]), "term_ids": [c["target_term_id"] for c in eligible if c["heldout_term"]][:50]},
    )
    dump(OUT / "stage_j_prod_heldout_span_manifest.json", {"n": len(heldout_spans)})
    dump(
        OUT / "stage_j_prod_multidomain_manifest.json",
        {
            "eligible_multitag_n": len([c for c in eligible if c.get("multitag")]),
            "hard_d_n": len(hard_d),
            "pd_multitag_n": len([c for c in pd_cases if len(c.get("target_domains") or []) > 1]),
        },
    )
    dump(
        OUT / "stage_j_prod_domain_coverage.json",
        {
            "eligible_per_domain": dict(dom_cov),
            "LOW_COVERAGE_DOMAIN": low_dom,
            "SUFFICIENT": len(low_dom) <= 3 and len(eligible) >= 100,
            "status": "SUFFICIENT" if len(eligible) >= 300 and not low_dom else ("PARTIAL" if len(eligible) >= 100 else "INSUFFICIENT"),
        },
    )
    dump(
        OUT / "stage_j_prod_relation_coverage.json",
        {
            "hard_p_per_relation": dict(rel_cov),
            "status": "SUFFICIENT" if all(rel_cov[r] >= 30 for r in ACTIVE_SET_V1) else "PARTIAL",
            "focus_weak": {r: rel_cov[r] for r in ("in_ing", "ch_c")},
        },
    )
    dump(
        OUT / "stage_j_prod_profile_strength_manifest.json",
        {
            "strength_hist": dict(Counter(c.get("profile_strength") for c in eligible)),
            "size_hist": dict(Counter(c.get("profile_size") for c in eligible)),
            "sizes_covered": sorted({c.get("profile_size") for c in eligible}),
        },
    )

    # Oracle sanity on eligible
    oracle_hit = 0
    for c in eligible:
        span = span_view(c["span"])
        base = set(base_retrieve_span(index, span, cfg=cfg))
        ok = False
        for ainfo in c["teacher_recover_actions"]:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[ainfo["action_id"]]]
            res = execute_domain_action(index, span, a, c["long_term_domain_evidence"], base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, c["target_term_id"], res.get("term_ids") or [])["identity_hit"]:
                ok = True
                break
        if ok:
            oracle_hit += 1
    dump(
        OUT / "stage_j_prod_oracle_sanity.json",
        {"n": len(eligible), "Oracle_TIR": oracle_hit / max(1, len(eligible)), "PASS": oracle_hit == len(eligible)},
    )

    readiness = {
        "P_hard_ge_699": len(hard_p) >= 699,
        "D_eligible_ge_100": len(eligible) >= 100,
        "D_eligible_ge_300": len(eligible) >= 300,
        "PD_eligible_ge_100": len(pd_eligible) >= 100,
        "heldout_term_nonzero": len([c for c in eligible if c["heldout_term"]]) > 0,
        "multidomain_nonzero": len([c for c in eligible if c.get("multitag")]) > 0,
        "counterfactual_meaningful": len(cf_rows) >= 4 * min(50, len(eligible)),
        "leakage_pass": len(leakage_term) == 0,
        "dedup_pass": dup == 0,
        "oracle_pass": oracle_hit == len(eligible) and len(eligible) > 0,
        "ALLOW_J1_TRAINING": True,  # exploration allowed; production acceptance gated separately
        "DATA_COVERAGE_LIMITED": len(eligible) < 100 or len(pd_eligible) < 100,
        "Benchmark_Statistical_Coverage": (
            "STRONG" if len(eligible) >= 1000 and len(pd_eligible) >= 300 else
            "MODERATE" if len(eligible) >= 100 and len(pd_eligible) >= 50 else
            "LIMITED"
        ),
    }
    dump(OUT / "stage_j_prod_benchmark_readiness.json", readiness)
    print("READINESS", json.dumps(readiness), flush=True)
    print("DONE expansion eligible=", len(eligible), "pd_elig=", len(pd_eligible), flush=True)


if __name__ == "__main__":
    main()
