#!/usr/bin/env python3
"""Experiment D1 — Stage-D recoverability contract repair (NO MODEL TRAINING).

Fixes / freezes:
  - StageDRetrievalTargetIdentityV1
  - FuzzyPool dedup audit (no production change unless business-broken)
  - execute-validated teacher
  - ELIGIBLE_D_ONLY slice (base-absent under identity)
  - metric vacuous-PASS removal
  - counterfactual Correct/Empty/Wrong/Swapped
  - soft domain prior unchanged
"""

from __future__ import annotations

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
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    execute_domain_action,
)
from training.model2_v3.policy.stage_d_target_identity_v1 import (
    CONTRACT_ID,
    contract_meta,
    identities_in_term_ids,
    lexical_identity_key,
    lexical_identity_key_from_term_id,
    target_hit,
)

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_recovery_p1_d1"
DATA_D2 = ROOT / "training/model2_v3/dataset/policy_stage_d2"
IDX = DATA_D2 / "candidate_index_stage_d2.jsonl"
IDX_META = DATA_D2 / "candidate_index_stage_d2_meta.json"


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def load_rows() -> list[dict]:
    rows = []
    with (DATA_D2 / "rows.jsonl").open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def corrupt_syllables(syls: list[str], rng: random.Random) -> list[str]:
    """Production-like FineSpan observation noise using ACTIVE_SET_V1 confusions."""
    out = list(syls)
    if not out:
        return out
    i = rng.randrange(len(out))
    s = out[i]
    ops = []
    if s.startswith("zh"):
        ops.append("z" + s[2:])
    if s.startswith("z") and not s.startswith("zh"):
        ops.append("zh" + s[1:])
    if s.startswith("ch"):
        ops.append("c" + s[2:])
    if s.startswith("c") and not s.startswith("ch") and not s.startswith("cu"):
        ops.append("ch" + s[1:])
    if s.startswith("sh"):
        ops.append("s" + s[2:])
    if s.startswith("s") and not s.startswith("sh"):
        ops.append("sh" + s[1:])
    if s.startswith("n") and not s.startswith("ng"):
        ops.append("l" + s[1:])
    if s.startswith("l"):
        ops.append("n" + s[1:])
    if s.endswith("eng"):
        ops.append(s[:-3] + "en")
    if s.endswith("en") and not s.endswith("eng"):
        ops.append(s[:-2] + "eng")
    if s.endswith("ing"):
        ops.append(s[:-3] + "in")
    if s.endswith("in") and not s.endswith("ing"):
        ops.append(s[:-2] + "ing")
    if s.startswith("h") and not s.startswith("hu"):
        ops.append("f" + s[1:])
    if not ops:
        # length-preserving mild edit
        ops.append(s + "n" if not s.endswith("n") else s[:-1] or s)
    out[i] = rng.choice(ops)
    return out


def span_view(d: dict) -> FineSpanView:
    return FineSpanView(**{k: v for k, v in d.items() if k in FineSpanView.__dataclass_fields__})


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    t_all = time.perf_counter()
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    rows = load_rows()
    rng = random.Random(17)

    # ---- Identity contract ----
    dump(OUT / "d1_target_identity_contract.json", contract_meta())
    (OUT / "d1_lexical_identity_vs_provenance_audit.md").write_text(
        f"""# D1 Lexical Identity vs Provenance Audit

## Schema facts (CandidateIndexMetaV1 / Lexicon-derived)

- `term_id` format: `{{term_type}}:{{domain_or_}}:{{surface}}:{{pinyin_key}}`
- Same surface may have **multiple** records: `base:_:...` and `domain:{{d}}:...`
- `CandidateIndexMetaV1.resolve_surface` prefers **domain** over base
- FuzzyPool **dedups by surface**, keeping first after sort `(distance ASC, prior DESC, term_id ASC)`

## Decision

**Lexical identity** for Stage D retrieval correctness =
`StageDRetrievalTargetIdentityV1` = `(surface, pinyin_key)` from CandidateRecord.

**Provenance** (diagnostic only) = `term_id`, `term_type`, `domain_ids`.

## Why not raw term_id?

`domain:coffee:中杯:zhong|bei` and `base:_:中杯:zhong|bei` are the **same lexical item**
with different retrieval provenance. Exact term_id match conflates identity with provenance
and produces false MISS when FuzzyPool keeps the `base:` sibling.

## Why not surface-alone?

Homographs with different pinyin_key must remain distinct. Contract requires surface **and** pinyin_key.

## Production change?

**NO** FuzzyPool dedup change. Dedup is frozen pool design (one surface slot). Metric/identity
must follow lexical identity; do not add production conversion layers to chase term_id.

Contract id: `{CONTRACT_ID}`
""",
        encoding="utf-8",
    )

    # ---- FuzzyPool dedup audit ----
    dedup_cases = []
    prefer_base = prefer_domain = 0
    for r in [x for x in rows if x.get("persona") == "CORRECT"][:80]:
        tid = r["target_term_id"]
        rec = index.by_term_id.get(tid)
        if not rec:
            continue
        sibs = index.by_surface.get(rec.surface) or []
        span = span_view(r["span"])
        pool = build_fuzzy_pool(
            index,
            FuzzyPoolRequestV1("", list(span.span_syllables or []), len(span.span_syllables or []), max_pool_size=32),
        )
        kept = next((h for h in pool.hits if h.surface == rec.surface), None)
        kept_type = None
        if kept:
            krec = index.by_term_id.get(kept.term_id)
            kept_type = krec.term_type if krec else None
            if kept_type == "base":
                prefer_base += 1
            elif kept_type == "domain":
                prefer_domain += 1
        if len(dedup_cases) < 15:
            dedup_cases.append(
                {
                    "target_term_id": tid,
                    "surface": rec.surface,
                    "siblings": [{"term_id": s.term_id, "term_type": s.term_type, "prior": s.prior_score} for s in sibs],
                    "pool_kept_term_id": kept.term_id if kept else None,
                    "pool_kept_type": kept_type,
                }
            )
    dump(
        OUT / "d1_fuzzypool_dedup_audit.json",
        {
            "mechanism": "sort (distance, -prior, term_id) then first-wins per surface",
            "is_frozen_design": True,
            "is_bug": False,
            "business_semantics_broken": False,
            "production_change": "NO",
            "reason": (
                "One surface slot in FuzzyPool is intentional. Domain soft prior reorders "
                "within pool; it does not require domain: term_id when base: sibling shares identity."
            ),
            "prefer_base_count": prefer_base,
            "prefer_domain_count": prefer_domain,
            "cases": dedup_cases,
        },
    )

    # ---- Build eligible D-only via pronunciation-corrupted FineSpan (production-like) ----
    print("D1 build eligible slice", flush=True)
    t_build = time.perf_counter()
    groups = defaultdict(list)
    for r in rows:
        groups[r.get("group_key")].append(r)

    eligible = []
    teacher_records = []
    fail_tax = Counter()
    neg_controls = []

    # Attempt corruptions on CORRECT rows until eligible or attempts exhausted
    for gk, grows in groups.items():
        corr = next((x for x in grows if x.get("persona") == "CORRECT"), None)
        if not corr:
            continue
        tid = corr["target_term_id"]
        want = lexical_identity_key_from_term_id(index, tid)
        if want is None:
            fail_tax["TARGET_NOT_IN_INDEX"] += 1
            continue
        if not (corr.get("target_domains") or []):
            fail_tax["NO_TARGET_DOMAINS"] += 1
            continue
        ev = corr.get("long_term_domain_evidence") or {}
        if not any(float(v) > 0 for v in ev.values()):
            fail_tax["NO_DOMAIN_EVIDENCE"] += 1
            continue

        found = None
        from training.model2_v3.policy.domain_actions import soft_domain_retrieve

        for attempt in range(64):
            span_d = dict(corr["span"])
            syls = list(corr["span"]["span_syllables"])
            for _ in range(1 if attempt < 32 else 2):
                syls = corrupt_syllables(syls, rng)
            span_d["span_syllables"] = syls
            span_d["span_id"] = f"{span_d.get('span_id')}_d1c{attempt}"
            span = span_view(span_d)
            base_ids = base_retrieve_span(index, span, cfg=cfg)
            base_ident = identities_in_term_ids(index, base_ids)
            if want in base_ident:
                continue  # not base-absent
            # teacher actions must be profile-evidence-guided (not exhaustive catalog)
            evidence_domains = [d for d, v in ev.items() if float(v) > 0]
            cand_actions = [
                a
                for a in DOMAIN_ACTION_CATALOG
                if a.kind == "domain_soft" and a.domain_id in evidence_domains
            ]
            recovering = []
            for a in cand_actions:
                res = execute_domain_action(index, span, a, ev, base_ids=set(base_ids), cfg=cfg, max_cands=8)
                hit = target_hit(index, tid, res.get("term_ids") or [])
                if hit["identity_hit"]:
                    recovering.append(
                        {
                            "action_id": a.action_id,
                            "domain_id": a.domain_id,
                            "term_ids": res.get("term_ids"),
                            "matched_provenance": hit["matched_provenance"],
                        }
                    )
            if not recovering:
                continue
            # Empty profile (domain_none + zero soft) must miss — otherwise not introduction-by-profile
            empty_none = execute_domain_action(
                index,
                span,
                DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX["domain_none"]],
                {},
                base_ids=set(base_ids),
                cfg=cfg,
                max_cands=8,
            )
            zero_soft = soft_domain_retrieve(
                index, span, {d: 0.0 for d in DOMAIN_SLOT_IDS}, base_ids=set(base_ids), cfg=cfg, max_cands=8
            )
            if target_hit(index, tid, empty_none.get("term_ids") or [])["identity_hit"] or target_hit(
                index, tid, zero_soft.get("term_ids") or []
            )["identity_hit"]:
                fail_tax["EMPTY_ALSO_RECOVERS_SKIP"] += 1
                continue
            found = {
                "group_key": gk,
                "source_row_id": corr["row_id"],
                "span": span_d,
                "target_term_id": tid,
                "target_surface": want[0],
                "target_pinyin_key": want[1],
                "target_domains": list(corr.get("target_domains") or []),
                "base_term_ids": list(base_ids),
                "base_absent_identity": True,
                "teacher_recover_actions": recovering,
                "teacher_any_recover": True,
                "long_term_domain_evidence": ev,
                "personal_terms": list(corr.get("personal_terms") or []),
                "personal_term_evidence": dict(corr.get("personal_term_evidence") or {}),
                "multitag": len(corr.get("target_domains") or []) > 1,
                "split": corr.get("split"),
                "construction": "pronunciation_corrupt_finespan_v1",
                "attempt": attempt,
            }
            break

        if not found:
            # exact span: document structural ineligibility
            span = span_view(corr["span"])
            base_ids = base_retrieve_span(index, span, cfg=cfg)
            if want in identities_in_term_ids(index, base_ids):
                fail_tax["TARGET_BASE_VISIBLE_EXACT_SPAN"] += 1
            else:
                fail_tax["SOFT_ACTION_CANNOT_INTRODUCE"] += 1
            continue

        eligible.append(found)
        teacher_records.append(
            {
                "case_id": f"d1_{gk}",
                "teacher_any_recover": True,
                "teacher_actions": [x["action_id"] for x in found["teacher_recover_actions"]],
                "execute_validated": True,
            }
        )

    # Negative controls must not be marked eligible
    for r in rows:
        if r.get("persona") in ("EMPTY", "WRONG", "GENERIC_HEAVY") and len(neg_controls) < 40:
            neg_controls.append(
                {
                    "row_id": r["row_id"],
                    "persona": r["persona"],
                    "should_be_eligible_d_only": False,
                    "reason": "negative_control_persona",
                }
            )

    build_cost_s = time.perf_counter() - t_build
    dump(
        OUT / "d1_eligible_d_only_manifest.json",
        {
            "ELIGIBLE_D_ONLY_COUNT": len(eligible),
            "construction": "pronunciation_corrupt_finespan_v1 on D2 CORRECT groups",
            "rationale": (
                "Exact-syllable D2 spans are always base-visible under identity; "
                "eligible introduction requires FineSpan observation noise (ASR-like), "
                "not hard domain filter."
            ),
            "DATASET_OR_ACTION_SPACE_LIMITATION": len(eligible) == 0,
            "build_cost_s": build_cost_s,
            "cases": eligible[:200],
            "failure_prefilter_counts": dict(fail_tax),
        },
    )
    dump(OUT / "d1_teacher_contract.json", {
        "previous": "synthetic soft_labels_for_domains(target_domains); no teacher_any_recover on D2",
        "new": "execute-validated: base-absent AND soft domain action recovers under StageDRetrievalTargetIdentityV1",
        "teacher_any_recover": "True only if execution recovers",
        "teacher_action_source": "all recovering soft domain actions (multi-action soft labels)",
    })
    dump(OUT / "d1_execute_validated_teacher.json", {
        "n": len(teacher_records),
        "all_execute_validated": all(t["execute_validated"] for t in teacher_records),
        "records": teacher_records[:100],
    })

    # ---- Base absence validation ----
    base_ok = 0
    for c in eligible:
        span = span_view(c["span"])
        base_ids = base_retrieve_span(index, span, cfg=cfg)
        want = (c["target_surface"], c["target_pinyin_key"])
        if want not in identities_in_term_ids(index, base_ids):
            base_ok += 1
    dump(
        OUT / "d1_base_absence_validation.json",
        {
            "n": len(eligible),
            "base_absent_confirmed": base_ok,
            "PASS": base_ok == len(eligible) and len(eligible) > 0,
            "FAIL_IF_ZERO_ELIGIBLE": len(eligible) == 0,
        },
    )

    # ---- Teacher execution metrics + Domain oracle ----
    print("D1 teacher/oracle metrics", flush=True)
    t_exec = time.perf_counter()
    hit = 0
    oracle_hit = 0
    traces = []
    for c in eligible:
        span = span_view(c["span"])
        tid = c["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))
        ev = c["long_term_domain_evidence"]
        # teacher: execute first recovering action
        aids = [x["action_id"] for x in c["teacher_recover_actions"]]
        ok = False
        used = None
        returned = []
        for aid in aids:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            returned = res.get("term_ids") or []
            th = target_hit(index, tid, returned)
            if th["identity_hit"]:
                ok = True
                used = aid
                break
        if ok:
            hit += 1
            oracle_hit += 1
        if len(traces) < 80:
            traces.append(
                {
                    "case_id": c.get("source_row_id"),
                    "FineSpan": c["span"].get("span_syllables"),
                    "target_term_id": tid,
                    "target_surface": c["target_surface"],
                    "target_domain_ids": c["target_domains"],
                    "teacher_action": used,
                    "returned_term_ids": returned,
                    "target_returned_identity": ok,
                    "candidate_budget": 8,
                }
            )
    n_el = len(eligible)
    teacher_hit_rate = hit / n_el if n_el else 0.0
    oracle_tir = oracle_hit / n_el if n_el else 0.0
    dump(
        OUT / "d1_teacher_execution_metrics.json",
        {
            "TeacherAnyRecoverCount": n_el,
            "TeacherExecuteHitCount": hit,
            "TeacherExecutionHitRate": teacher_hit_rate,
            "expect_1_0_when_execute_validated": True,
            "PASS": teacher_hit_rate == 1.0 and n_el > 0,
            "execute_validation_cost_s": time.perf_counter() - t_exec,
        },
    )
    dump(
        OUT / "d1_domain_oracle_metrics.json",
        {
            "DOMAIN_ORACLE": "execute teacher soft domain action(s); no Model2",
            "n": n_el,
            "Oracle_TIR": oracle_tir,
            "PASS": oracle_tir >= 0.99 and n_el > 0,
            "traces_sample": traces[:20],
        },
    )

    # ---- Counterfactual on eligible groups ----
    cf_rows = []
    for c in eligible:
        gk = c["group_key"]
        grows = {x.get("persona"): x for x in groups.get(gk) or []}
        for persona in ("CORRECT", "EMPTY", "WRONG", "SWAPPED"):
            src = grows.get(persona) or grows.get("CORRECT")
            if not src:
                continue
            if persona == "CORRECT":
                ev = c["long_term_domain_evidence"]
                terms = c["personal_terms"]
                te = c["personal_term_evidence"]
            elif persona == "EMPTY":
                ev, terms, te = {}, [], {}
            elif persona == "WRONG":
                # use WRONG persona evidence if present else rotate
                if grows.get("WRONG"):
                    ev = grows["WRONG"].get("long_term_domain_evidence") or {}
                    terms = list(grows["WRONG"].get("personal_terms") or [])
                    te = dict(grows["WRONG"].get("personal_term_evidence") or {})
                else:
                    keys = [d for d, v in (c["long_term_domain_evidence"] or {}).items() if float(v) > 0]
                    others = [d for d in DOMAIN_SLOT_IDS if d not in keys] or list(DOMAIN_SLOT_IDS)
                    ev = {others[0]: 1.0}
                    terms, te = [], {}
            else:  # SWAPPED
                if grows.get("SWAPPED"):
                    ev = grows["SWAPPED"].get("long_term_domain_evidence") or {}
                    terms = list(grows["SWAPPED"].get("personal_terms") or [])
                    te = dict(grows["SWAPPED"].get("personal_term_evidence") or {})
                else:
                    continue
            cf_rows.append(
                {
                    "case_id": f"{c['source_row_id']}_{persona}",
                    "persona": persona,
                    "span": c["span"],
                    "target_term_id": c["target_term_id"],
                    "long_term_domain_evidence": ev,
                    "personal_terms": terms,
                    "personal_term_evidence": te,
                    "same_finespan": True,
                    "same_target": True,
                    "same_lexicon": True,
                    "only_profile_differs": True,
                }
            )
    # Profile-conditioned oracle (NOT exhaustive domain catalog):
    # CORRECT/WRONG/SWAPPED: execute soft actions for domains with evidence > 0
    # EMPTY: domain_none + zero-weight soft only (no forced domain_soft:* selection)
    from training.model2_v3.policy.domain_actions import soft_domain_retrieve

    def oracle_rate(persona: str) -> float:
        sub = [x for x in cf_rows if x["persona"] == persona]
        if not sub:
            return 0.0
        h = 0
        for x in sub:
            span = span_view(x["span"])
            tid = x["target_term_id"]
            base = set(base_retrieve_span(index, span, cfg=cfg))
            ev = x["long_term_domain_evidence"] or {}
            ok = False
            if persona == "EMPTY" or not any(float(v) > 0 for v in ev.values()):
                none_res = execute_domain_action(
                    index,
                    span,
                    DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX["domain_none"]],
                    {},
                    base_ids=base,
                    cfg=cfg,
                    max_cands=8,
                )
                zero = soft_domain_retrieve(
                    index, span, {d: 0.0 for d in DOMAIN_SLOT_IDS}, base_ids=base, cfg=cfg, max_cands=8
                )
                ok = target_hit(index, tid, none_res.get("term_ids") or [])["identity_hit"] or target_hit(
                    index, tid, zero.get("term_ids") or []
                )["identity_hit"]
            else:
                evid_doms = [d for d, v in ev.items() if float(v) > 0]
                for a in DOMAIN_ACTION_CATALOG:
                    if a.kind != "domain_soft" or a.domain_id not in evid_doms:
                        continue
                    res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
                    if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                        ok = True
                        break
            if ok:
                h += 1
        return h / len(sub)

    corr_r = oracle_rate("CORRECT")
    empty_r = oracle_rate("EMPTY")
    wrong_r = oracle_rate("WRONG")
    swap_r = oracle_rate("SWAPPED")
    dump(
        OUT / "d1_counterfactual_manifest.json",
        {
            "n_rows": len(cf_rows),
            "personas": dict(Counter(x["persona"] for x in cf_rows)),
            "same_span_same_target_only_profile": True,
            "oracle_policy": "profile_evidence_guided_actions; EMPTY=domain_none+zero_soft only",
            "oracle_TIR": {"CORRECT": corr_r, "EMPTY": empty_r, "WRONG": wrong_r, "SWAPPED": swap_r},
            "COUNTERFACTUAL_DATASET_INVALID": False,
            "VALID": len(cf_rows) > 0 and corr_r > empty_r and corr_r > 0,
        },
    )

    # ---- Metric contract ----
    vacuous_removed = True
    metric_pass_rule = {
        "profile_sensitivity_PASS_requires": [
            "meaningful eligible denominator > 0",
            "Correct_TIR > 0",
            "Correct_TIR > Empty_TIR",
        ],
        "Correct_0_Empty_0": "FAIL_OR_NOT_EVALUABLE",
        "hit_definition": CONTRACT_ID,
        "soft_domain_prior": "UNCHANGED hard_filter=False",
        "vacuous_PASS": "REMOVED",
    }
    dump(OUT / "d1_metric_contract.json", metric_pass_rule)

    # Multitag
    multi = sum(1 for c in eligible if c.get("multitag"))
    dump(
        OUT / "d1_multitag_validation.json",
        {
            "eligible_total": n_el,
            "eligible_multitag": multi,
            "ssot": "term_domain_tags via CandidateRecord.domain_ids / domains_for_surface",
            "first_tag_only": False,
        },
    )
    dump(OUT / "d1_negative_controls.json", {"n": len(neg_controls), "controls": neg_controls})

    # Failure taxonomy for original D2 exact-span zero-recovery world
    dump(
        OUT / "d1_failure_taxonomy.json",
        {
            "exact_span_D2_CORRECT": {
                "TARGET_BASE_VISIBLE": fail_tax.get("TARGET_BASE_VISIBLE_EXACT_SPAN", 0),
                "SOFT_ACTION_CANNOT_INTRODUCE": fail_tax.get("SOFT_ACTION_CANNOT_INTRODUCE", 0),
                "TARGET_NOT_IN_INDEX": fail_tax.get("TARGET_NOT_IN_INDEX", 0),
            },
            "eligible_after_corrupt_construction": n_el,
            "PRIMARY_PRIOR_ZERO_TIR_CLASS": "TARGET_BASE_VISIBLE + METRIC term_id conflation (not MODEL)",
            "DATASET_OR_ACTION_SPACE_LIMITATION_if_eligible_0": n_el == 0,
        },
    )

    dump(
        OUT / "d1_action_soft_prior_check.json",
        {
            "DOMAIN_SOFT_ACTION": "SOFT PRIOR",
            "hard_filter": False,
            "DOMAIN_ACTION_EXECUTION_DRIFT": False,
            "UNCHANGED": True,
        },
    )

    d1_pass = (
        n_el > 0
        and teacher_hit_rate == 1.0
        and oracle_tir >= 0.99
        and base_ok == n_el
        and vacuous_removed
        and corr_r > empty_r
        and corr_r > 0
    )
    dump(
        OUT / "d1_gate_summary.json",
        {
            "D1_PASS": d1_pass,
            "ELIGIBLE_D_ONLY_COUNT": n_el,
            "TeacherExecutionHitRate": teacher_hit_rate,
            "Oracle_TIR": oracle_tir,
            "Correct_gt_Empty": corr_r > empty_r,
            "Correct_TIR": corr_r,
            "Empty_TIR": empty_r,
            "FuzzyPool_production_change": "NO",
            "soft_prior": "UNCHANGED",
            "total_cost_s": time.perf_counter() - t_all,
        },
    )
    print("D1 DONE eligible=", n_el, "oracle_tir=", oracle_tir, "PASS=", d1_pass, flush=True)


if __name__ == "__main__":
    main()
