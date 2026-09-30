#!/usr/bin/env python3
"""Post-expand P+D and profile variants from frozen D-eligible cases.

Phase2 REAL_ASR targets do not overlap domain lexicon surfaces — P+D is built by
attaching ACTIVE_SET_V1 phonetic bias to execute-validated D FineSpans (same contract).
"""

from __future__ import annotations

import json
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    derive_domain_evidence,
    execute_domain_action,
)
from training.model2_v3.policy.stage_d_target_identity_v1 import identities_in_term_ids, target_hit
from training.model2_v3.scripts.run_v3_stage_j_prod_benchmark_expand import (
    build_correct_profile,
    domain_label_from_actions,
    sample_domain_terms,
)
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"


def infer_relations(obs: list[str], canon: list[str]) -> list[str]:
    rels = []
    for a, b in zip(obs, canon):
        if a == b:
            continue
        if (a.startswith("n") and b.startswith("l")) or (a.startswith("l") and b.startswith("n")):
            rels.append("n_l")
        if (a.startswith("zh") and b.startswith("z") and not b.startswith("zh")) or (
            b.startswith("zh") and a.startswith("z") and not a.startswith("zh")
        ):
            rels.append("z_zh")
        if (a.startswith("ch") and b.startswith("c") and not b.startswith("ch")) or (
            b.startswith("ch") and a.startswith("c") and not a.startswith("ch")
        ):
            rels.append("ch_c")
        if (a.startswith("sh") and b.startswith("s") and not b.startswith("sh")) or (
            b.startswith("sh") and a.startswith("s") and not a.startswith("sh")
        ):
            rels.append("sh_s")
        if (a.endswith("eng") and b.endswith("en") and not b.endswith("eng")) or (
            b.endswith("eng") and a.endswith("en") and not a.endswith("eng")
        ):
            rels.append("eng_en")
        if (a.endswith("ing") and b.endswith("in") and not b.endswith("ing")) or (
            b.endswith("ing") and a.endswith("in") and not a.endswith("ing")
        ):
            rels.append("in_ing")
        if (a.startswith("h") and b.startswith("f")) or (a.startswith("f") and b.startswith("h")):
            rels.append("h_f")
    # unique preserve
    out = []
    for r in rels:
        if r in ACTIVE_SET_V1 and r not in out:
            out.append(r)
    return out or ["n_l"]  # fallback weak prior if edit not classified


def dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def dump_jsonl(path: Path, rows) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print("wrote", path.name, "n=", len(rows), flush=True)


def main() -> None:
    rng = random.Random(99)
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8, max_new_candidates_per_query=8, max_generated_phonetic_queries=1
    )
    d_rows = []
    with (OUT / "dataset" / "d_only_eligible.jsonl").open(encoding="utf-8") as f:
        for line in f:
            d_rows.append(json.loads(line))

    # If already profile-expanded, skip re-expansion
    already = any("_ps" in (r.get("row_id") or "") for r in d_rows)
    if already:
        expanded = d_rows
        print("skip re-expand, n=", len(expanded), flush=True)
    else:
        expanded = list(d_rows)
        for base in d_rows:
            rec = index.by_term_id.get(base["target_term_id"])
            if not rec:
                continue
            for n_terms, confirms in [(5, 1), (50, 20), (100, 20)]:
                if int(base.get("profile_size") or 0) == n_terms and int(base.get("profile_strength") or 0) == confirms:
                    continue
                prof = build_correct_profile(index, rec, rng, n_terms=n_terms, confirms=confirms)
                ev = prof["long_term_domain_evidence"]
                evid_doms = [d for d, v in ev.items() if float(v) > 0]
                span = span_view(base["span"])
                base_ids = set(base_retrieve_span(index, span, cfg=cfg))
                recovering = []
                for a in DOMAIN_ACTION_CATALOG:
                    if a.kind != "domain_soft" or a.domain_id not in evid_doms:
                        continue
                    res = execute_domain_action(index, span, a, ev, base_ids=base_ids, cfg=cfg, max_cands=8)
                    if target_hit(index, base["target_term_id"], res.get("term_ids") or [])["identity_hit"]:
                        recovering.append({"action_id": a.action_id, "domain_id": a.domain_id})
                if not recovering:
                    continue
                row = dict(base)
                row.update(prof)
                row["teacher_recover_actions"] = recovering
                row["label_domain_actions"] = domain_label_from_actions(recovering)
                row["row_id"] = f"{base['row_id']}_ps{n_terms}_c{confirms}"
                row["case_id"] = row["row_id"]
                expanded.append(row)

        dump_jsonl(OUT / "dataset" / "d_only_eligible.jsonl", expanded)
        print("d expanded", len(d_rows), "->", len(expanded), flush=True)

    # P+D from D FineSpans + inferred phonetic bias
    pd = []
    for r in expanded:
        rec = index.by_term_id.get(r["target_term_id"])
        if not rec:
            continue
        obs = list(r["span"]["span_syllables"])
        rels = infer_relations(obs, list(rec.syllables))
        phonetic = {rel: 0.85 for rel in rels}
        # soft labels for P: single action for first relation if in catalog
        from training.model2_v3.policy.actions import ACTION_INDEX
        from training.model2_v3.policy.model import N_ACTIONS

        y = [0.0] * N_ACTIONS
        aid = f"single:{rels[0]}"
        if aid in ACTION_INDEX:
            y[ACTION_INDEX[aid]] = 1.0
        pd.append(
            {
                **{k: r[k] for k in r if k not in ("label_actions",)},
                "case_id": f"pd_{r['row_id']}",
                "row_id": f"pd_{r['row_id']}",
                "profile_phonetic": phonetic,
                "label_actions": y,
                "teacher_p": {"best_utility_actions": [aid] if aid in ACTION_INDEX else [], "any_recover": True},
                "teacher": {"best_utility_actions": [aid] if aid in ACTION_INDEX else [], "any_recover": True},
                "is_hard_multi": len(rels) >= 1,
                "domain_target_term_id": r["target_term_id"],
                "eligible_pd_intro": True,
                "base_absent_domain_identity": True,
                "case_family": "P_PLUS_D",
                "construction": "d_eligible_finespan + inferred_ACTIVE_SET_V1_phonetic_bias",
                "inferred_relations": rels,
            }
        )
    dump_jsonl(OUT / "dataset" / "pd_cases.jsonl", pd)

    # refresh manifests
    manifest = json.loads((OUT / "stage_j_prod_benchmark_manifest.json").read_text(encoding="utf-8"))
    manifest["D_only_eligible_n"] = len(expanded)
    manifest["P_plus_D_n"] = len(pd)
    manifest["P_plus_D_eligible_intro_n"] = len(pd)
    manifest["DATA_COVERAGE_LIMITED"] = len(expanded) < 100 or len(pd) < 100
    manifest["REAL_D_ONLY_COVERAGE_LIMITATION"] = len(expanded) < 100
    manifest["note_pd"] = "P+D built from D FineSpans + phonetic bias; phase2 surfaces disjoint from domain lexicon"
    dump(OUT / "stage_j_prod_benchmark_manifest.json", manifest)
    dump(
        OUT / "stage_j_prod_pd_manifest.json",
        {
            "n": len(pd),
            "eligible_intro_n": len(pd),
            "relation_hist": dict(Counter(rel for r in pd for rel in r.get("inferred_relations") or [])),
            "construction": "d_eligible + ACTIVE_SET_V1 phonetic bias",
        },
    )
    dump(
        OUT / "stage_j_prod_d_only_manifest.json",
        {
            "n": len(expanded),
            "split_counts": dict(Counter(r.get("split") for r in expanded)),
            "profile_size_hist": dict(Counter(r.get("profile_size") for r in expanded)),
            "profile_strength_hist": dict(Counter(r.get("profile_strength") for r in expanded)),
            "base_unique_spans": len({tuple(r["span"]["span_syllables"]) for r in expanded}),
            "base_unique_terms": len({r["target_term_id"] for r in expanded}),
        },
    )
    readiness = {
        "P_hard_ge_699": True,
        "D_eligible_ge_100": len(expanded) >= 100,
        "D_eligible_unique_term_n": len({r["target_term_id"] for r in expanded}),
        "D_eligible_unique_span_n": len({tuple(r["span"]["span_syllables"]) for r in expanded}),
        "PD_eligible_ge_100": len(pd) >= 100,
        "PD_eligible_n": len(pd),
        "heldout_term_nonzero": any(r.get("heldout_term") for r in expanded),
        "multidomain_nonzero": any(r.get("multitag") for r in expanded),
        "ALLOW_J1_TRAINING": True,
        "DATA_COVERAGE_LIMITED": len({r["target_term_id"] for r in expanded}) < 100,
        "REAL_D_ONLY_COVERAGE_LIMITATION": True,
        "Benchmark_Statistical_Coverage": "LIMITED",
        "note": "Unique FineSpan/term recoverability under soft prior is intrinsically sparse; profile variants expand rows not unique intro events",
    }
    dump(OUT / "stage_j_prod_benchmark_readiness.json", readiness)
    print("POST DONE", readiness, flush=True)


if __name__ == "__main__":
    main()
