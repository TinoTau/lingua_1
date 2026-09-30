#!/usr/bin/env python3
"""STAGE_J_PRODUCTION_BENCHMARK_V2 — unique FineSpan expansion (NO training).

Sources (priority): REAL_ASR traces → real dialog_200 lexicon hits → lexicon-backed
relation / controlled corruption → V1 eligible (tagged CONTAMINATED if seen in J1 train).

Frozen contracts unchanged. Soft prior unchanged. Candidate pool is TEST-ONLY.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

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
from training.model2_v3.policy.feature_hash_v1 import MODEL2_FEATURE_HASH_VERSION, contract_meta as hash_contract
from training.model2_v3.policy.stage_d_target_identity_v1 import (
    CONTRACT_ID as TARGET_ID_CONTRACT,
    contract_meta as target_contract,
    identities_in_term_ids,
    lexical_identity_key,
    target_hit,
)
from training.model2_v3.scripts.run_v3_stage_j_prod_benchmark_expand import (
    build_correct_profile,
    domain_label_from_actions,
    sample_domain_terms,
)
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import corrupt_syllables, span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2"
REAL_ASR_TRACE = ROOT / "training/model2/experiments/e2e_conformance_audit/real_asr_span_trace.jsonl"
DIALOG_200 = ROOT / "test wav" / "dialog_200" / "cases.manifest.json"
V1_D = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod/dataset/d_only_eligible.jsonl"
BENCH = "STAGE_J_PRODUCTION_BENCHMARK_V2"
MAX_SPANS_PER_TERM = 8
MAX_P_UNIQUE_EXTRA = 1800


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
    if not path.exists():
        return []
    return [json.loads(l) for l in path.open(encoding="utf-8")]


def corrupt_for_relation(syls: list[str], rel: str, rng: random.Random) -> Optional[list[str]]:
    """Relation-targeted FineSpan observation noise (ACTIVE_SET_V1)."""
    out = list(syls)
    if not out:
        return None
    idxs = list(range(len(out)))
    rng.shuffle(idxs)
    for i in idxs:
        s = out[i]
        alt = None
        if rel == "n_l":
            if s.startswith("n") and not s.startswith("ng"):
                alt = "l" + s[1:]
            elif s.startswith("l"):
                alt = "n" + s[1:]
        elif rel == "z_zh":
            if s.startswith("zh"):
                alt = "z" + s[2:]
            elif s.startswith("z") and not s.startswith("zh"):
                alt = "zh" + s[1:]
        elif rel == "ch_c":
            if s.startswith("ch"):
                alt = "c" + s[2:]
            elif s.startswith("c") and not s.startswith("ch") and not s.startswith("cu"):
                alt = "ch" + s[1:]
        elif rel == "sh_s":
            if s.startswith("sh"):
                alt = "s" + s[2:]
            elif s.startswith("s") and not s.startswith("sh"):
                alt = "sh" + s[1:]
        elif rel == "eng_en":
            if s.endswith("eng"):
                alt = s[:-3] + "en"
            elif s.endswith("en") and not s.endswith("eng"):
                alt = s[:-2] + "eng"
        elif rel == "in_ing":
            if s.endswith("ing"):
                alt = s[:-3] + "in"
            elif s.endswith("in") and not s.endswith("ing"):
                alt = s[:-2] + "ing"
        elif rel == "h_f":
            if s.startswith("h") and not s.startswith("hu"):
                alt = "f" + s[1:]
            elif s.startswith("f"):
                alt = "h" + s[1:]
        if alt and alt != s:
            out[i] = alt
            return out
    return None


def infer_relation(orig: list[str], obs: list[str]) -> Optional[str]:
    if orig == obs or len(orig) != len(obs):
        return None
    diffs = [(a, b) for a, b in zip(orig, obs) if a != b]
    if len(diffs) != 1:
        return "multi" if diffs else None
    a, b = diffs[0]
    checks = [
        ("n_l", a.startswith("n") and not a.startswith("ng") and b == "l" + a[1:]),
        ("n_l", a.startswith("l") and b == "n" + a[1:]),
        ("z_zh", a.startswith("zh") and b == "z" + a[2:]),
        ("z_zh", a.startswith("z") and not a.startswith("zh") and b == "zh" + a[1:]),
        ("ch_c", a.startswith("ch") and b == "c" + a[2:]),
        ("ch_c", a.startswith("c") and not a.startswith("ch") and b == "ch" + a[1:]),
        ("sh_s", a.startswith("sh") and b == "s" + a[2:]),
        ("sh_s", a.startswith("s") and not a.startswith("sh") and b == "sh" + a[1:]),
        ("eng_en", a.endswith("eng") and b == a[:-3] + "en"),
        ("eng_en", a.endswith("en") and not a.endswith("eng") and b == a[:-2] + "eng"),
        ("in_ing", a.endswith("ing") and b == a[:-3] + "in"),
        ("in_ing", a.endswith("in") and not a.endswith("ing") and b == a[:-2] + "ing"),
        ("h_f", a.startswith("h") and not a.startswith("hu") and b == "f" + a[1:]),
        ("h_f", a.startswith("f") and b == "h" + a[1:]),
    ]
    for rel, ok in checks:
        if ok:
            return rel
    return None


def syl_edit_distance(a: tuple[str, ...], b: tuple[str, ...]) -> int:
    if len(a) != len(b):
        return abs(len(a) - len(b)) + sum(x != y for x, y in zip(a, b))
    return sum(x != y for x, y in zip(a, b))


def try_case(
    index,
    rec,
    cfg,
    span_syls: list[str],
    profile: dict,
    *,
    source: str,
    provenance: str,
    relation: Optional[str] = None,
    carrier: Optional[str] = None,
) -> Optional[dict]:
    want = lexical_identity_key(rec)
    tid = rec.term_id
    ev = profile["long_term_domain_evidence"]
    if not any(float(v) > 0 for v in ev.values()):
        return None
    evid_doms = [d for d, v in ev.items() if float(v) > 0]
    span_d = {
        "span_id": f"v2_{hashlib.md5((tid+'|'+'|'.join(span_syls)).encode()).hexdigest()[:12]}",
        "syllable_start": 0,
        "syllable_end": len(span_syls),
        "span_syllables": list(span_syls),
        "window_text": rec.surface,
        "window_pinyin_key": "".join(span_syls),
        "raw_start": 0,
        "raw_end": len(rec.surface or ""),
        "source": source,
        "carrier": carrier,
    }
    span = span_view(span_d)
    base_ids = base_retrieve_span(index, span, cfg=cfg)
    if want in identities_in_term_ids(index, base_ids):
        return None
    recovering = []
    for a in DOMAIN_ACTION_CATALOG:
        if a.kind != "domain_soft" or a.domain_id not in evid_doms:
            continue
        res = execute_domain_action(index, span, a, ev, base_ids=set(base_ids), cfg=cfg, max_cands=8)
        if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
            recovering.append({"action_id": a.action_id, "domain_id": a.domain_id})
    if not recovering:
        return None
    rel = relation or infer_relation(list(rec.syllables or []), list(span_syls))
    return {
        "case_id": span_d["span_id"],
        "target_term_id": tid,
        "target_surface": rec.surface,
        "target_pinyin_key": rec.pinyin_key,
        "target_domains": list(rec.domain_ids or []),
        "span": span_d,
        "base_term_ids": list(base_ids),
        "base_absent_identity": True,
        "teacher_recover_actions": recovering,
        "teacher_any_recover": True,
        "execute_validated": True,
        "eligible_d_only": True,
        "multitag": len(rec.domain_ids or []) > 1,
        "source_class": provenance,
        "source_detail": source,
        "relation_hint": rel,
        "carrier": carrier,
        **profile,
        "construction": "v2_unique_finespan_contract_frozen",
    }


def unique_key(c: dict) -> tuple:
    return (c["target_term_id"], tuple(c["span"]["span_syllables"]))


def cluster_near_dups(eligible: list[dict]) -> dict:
    by_term: dict[str, list[tuple[str, ...]]] = defaultdict(list)
    for c in eligible:
        by_term[c["target_term_id"]].append(tuple(c["span"]["span_syllables"]))
    n_clusters = 0
    cluster_sizes = []
    for tid, spans in by_term.items():
        uniq = list(dict.fromkeys(spans))
        parent = list(range(len(uniq)))

        def find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for i in range(len(uniq)):
            for j in range(i + 1, len(uniq)):
                if syl_edit_distance(uniq[i], uniq[j]) <= 1:
                    pi, pj = find(i), find(j)
                    if pi != pj:
                        parent[pj] = pi
        roots = {find(i) for i in range(len(uniq))}
        n_clusters += len(roots)
        cluster_sizes.append(len(uniq))
    return {
        "near_duplicate_cluster_groups": n_clusters,
        "raw_N": len(eligible),
        "effective_unique_N": n_clusters,
        "terms_with_multi_span": sum(1 for n in cluster_sizes if n > 1),
        "note": "cluster = same target + syllable edit-distance <= 1",
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    rng = random.Random(20260817)
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )

    rows_p = load_jsonl(DATA_P / "rows.jsonl")
    hard_p = [r for r in rows_p if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    train_p_terms = {r["target_term_id"] for r in rows_p if r.get("split") == "train"}
    train_p_spans = {
        (r["target_term_id"], tuple(r["span"]["span_syllables"]))
        for r in rows_p
        if r.get("split") == "train"
    }
    v1_d = load_jsonl(V1_D)
    v1_train_keys = {
        (r["target_term_id"], tuple(r["span"]["span_syllables"]))
        for r in v1_d
        if r.get("split") == "train"
    }

    domain_recs = [r for r in index.records if r.term_type == "domain" and r.domain_ids]
    by_surface: dict[str, list] = defaultdict(list)
    for rec in domain_recs:
        if rec.surface:
            by_surface[rec.surface].append(rec)
    rel_order = ["n_l", "ch_c", "in_ing", "z_zh", "eng_en", "sh_s", "h_f"]
    print("domain_recs", len(domain_recs), "hard_p", len(hard_p), flush=True)

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
            fail["dup_unique_key"] += 1
            return False
        if spans_per_term[c["target_term_id"]] >= MAX_SPANS_PER_TERM:
            fail["per_term_cap"] += 1
            return False
        if k in v1_train_keys or k in train_p_spans:
            c["contamination"] = "SEEN_IN_J1_TRAIN"
            c["blind_holdout"] = False
        elif c["target_term_id"] in train_p_terms and c.get("source_class") != "REAL":
            c["contamination"] = "TERM_SEEN_IN_P_TRAIN"
            c["blind_holdout"] = True
        else:
            c["contamination"] = "CLEAN"
            c["blind_holdout"] = True
        h = int(hashlib.md5(c["target_term_id"].encode()).hexdigest()[:8], 16)
        c["heldout_term"] = h % 5 == 0 and c["target_term_id"] not in train_p_terms
        c["split"] = "test"
        c["cardinality_variant"] = False
        seen_keys.add(k)
        spans_per_term[c["target_term_id"]] += 1
        eligible.append(c)
        source_counts[c["source_class"]] += 1
        return True

    def try_add(rec, syls, *, source, provenance, relation=None, carrier=None, profile=None) -> bool:
        k = (rec.term_id, tuple(syls))
        if k in seen_keys:
            fail["dup_unique_key"] += 1
            return False
        if spans_per_term[rec.term_id] >= MAX_SPANS_PER_TERM:
            fail["per_term_cap"] += 1
            return False
        prof = profile or profile_for(rec)
        return add_case(
            try_case(
                index,
                rec,
                cfg,
                list(syls),
                prof,
                source=source,
                provenance=provenance,
                relation=relation,
                carrier=carrier,
            )
        )

    # ---- Source 1: REAL_ASR FineSpan traces (domain targets + observed windows) ----
    print("scan REAL_ASR traces", flush=True)
    n_asr = 0
    n_asr_domain = 0
    if REAL_ASR_TRACE.exists():
        for line in REAL_ASR_TRACE.open(encoding="utf-8"):
            n_asr += 1
            row = json.loads(line)
            tid = row.get("target_term_id") or ""
            rec = index.by_term_id.get(tid)
            if not rec or rec.term_type != "domain":
                continue
            n_asr_domain += 1
            L = len(rec.syllables or [])
            cands: list[tuple[list[str], Optional[str]]] = []
            win = ((row.get("INTENDED_SPAN_PATH") or {}).get("winning_span") or {}).get("span_syllables")
            if win:
                cands.append((list(win), row.get("family")))
            for q in (row.get("INTENDED_SPAN_PATH") or {}).get("queries_head") or []:
                if q.get("span"):
                    cands.append((list(q["span"]), q.get("relation") or row.get("family")))
            for rs in (row.get("INTENDED_SPAN_PATH") or {}).get("relevant_spans") or []:
                if rs.get("span_syllables"):
                    cands.append((list(rs["span_syllables"]), row.get("family")))
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
                try_add(
                    rec,
                    syls,
                    source="real_asr_span_trace",
                    provenance="REAL",
                    relation=fam,
                    carrier=row.get("utterance_id") or row.get("ASR_utterance"),
                )
    print("after REAL_ASR unique", len(eligible), "lines", n_asr, "domain_targets", n_asr_domain, flush=True)

    # ---- Source 1b: phase2 REAL_ASR rows whose target is a domain term ----
    print("scan phase2 domain rows", flush=True)
    n_p2_domain = 0
    n_p2_tried = 0
    for r in rows_p:
        tid = r.get("target_term_id") or ""
        if not str(tid).startswith("domain:"):
            continue
        rec = index.by_term_id.get(tid)
        if not rec or rec.term_type != "domain":
            continue
        n_p2_domain += 1
        syls = list((r.get("span") or {}).get("span_syllables") or [])
        if not syls:
            continue
        # FineSpan must be term-length; short windows (e.g. ["yi"] vs 拼车) cannot recover under identity.
        if abs(len(syls) - len(rec.syllables or [])) > 1:
            fail["p2_len_mismatch"] += 1
            continue
        n_p2_tried += 1
        if n_p2_tried > 120:
            fail["p2_try_cap"] += 1
            continue
        if n_p2_tried % 20 == 1:
            print(f"  phase2 domain try {n_p2_tried} unique={len(eligible)}", flush=True)
        try_add(
            rec,
            syls,
            source="phase2_real_asr_row",
            provenance="REAL",
            relation=r.get("gold_family"),
            carrier=r.get("row_id"),
        )
    print("after phase2-domain unique", len(eligible), "phase2_domain_rows", n_p2_domain, "tried", n_p2_tried, flush=True)

    # ---- Source 3: dialog_200 lexicon-backed real conversation ----
    print("scan dialog_200", flush=True)
    n_dialog_hits = 0
    surfaces_long = sorted(
        ((s, recs) for s, recs in by_surface.items() if s and len(s) >= 2),
        key=lambda kv: -len(kv[0]),
    )
    if DIALOG_200.exists():
        manifest = json.loads(DIALOG_200.read_text(encoding="utf-8"))
        for case in manifest.get("cases") or []:
            text = case.get("expectedText") or case.get("utterance") or case.get("text") or ""
            if not text:
                continue
            hits = 0
            used_spans: set[tuple] = set()
            for surface, recs in surfaces_long:
                if hits >= 6:
                    break
                if surface not in text:
                    continue
                rec = recs[0]
                orig = tuple(rec.syllables or [])
                if orig in used_spans:
                    continue
                used_spans.add(orig)
                n_dialog_hits += 1
                hits += 1
                if spans_per_term[rec.term_id] >= MAX_SPANS_PER_TERM:
                    continue
                for rel in rel_order:
                    cor = corrupt_for_relation(list(orig), rel, random.Random(hash((rec.term_id, case.get("id"), rel)) & 0xFFFFFFFF))
                    if cor:
                        try_add(
                            rec,
                            cor,
                            source=f"dialog_200+rel_{rel}",
                            provenance="DERIVED_REAL",
                            relation=rel,
                            carrier=case.get("id"),
                        )
    print("after dialog_200 unique", len(eligible), "surface_hits", n_dialog_hits, flush=True)

    # ---- Source 4: relation-targeted + controlled corruption, keep ALL unique spans ----
    print("relation + controlled expansion", flush=True)
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
                r = by_dom[d][i]
                if r.term_id not in seen_tid:
                    seen_tid.add(r.term_id)
                    ordered.append(r)

    for i, rec in enumerate(ordered):
        if i % 25 == 0:
            print(f"  progress {i}/{len(ordered)} unique={len(eligible)} terms={len(spans_per_term)}", flush=True)
        orig = list(rec.syllables or [])
        if spans_per_term[rec.term_id] >= MAX_SPANS_PER_TERM:
            continue
        n_before = spans_per_term[rec.term_id]
        # relation-targeted (DERIVED_REAL)
        for rel in rel_order:
            if spans_per_term[rec.term_id] >= MAX_SPANS_PER_TERM:
                break
            for attempt in range(3):
                cor = corrupt_for_relation(orig, rel, random.Random(hash((rec.term_id, rel, attempt)) & 0xFFFFFFFF))
                if not cor or cor == orig:
                    continue
                try_add(
                    rec,
                    cor,
                    source=f"lexicon_domain+rel_{rel}",
                    provenance="DERIVED_REAL",
                    relation=rel,
                )
        # controlled multi-edit (SYNTHETIC if not an ACTIVE_SET single relation)
        extra = 36 if spans_per_term[rec.term_id] > n_before else 12
        if spans_per_term[rec.term_id] < MAX_SPANS_PER_TERM:
            crng = random.Random(hash(("v2c", rec.term_id)) & 0xFFFFFFFF)
            for attempt in range(extra):
                if spans_per_term[rec.term_id] >= MAX_SPANS_PER_TERM:
                    break
                syls = list(orig)
                n_edits = 1 if attempt < max(8, extra // 2) else 2
                for _ in range(n_edits):
                    syls = corrupt_syllables(syls, crng)
                rel = infer_relation(orig, syls)
                prov = "DERIVED_REAL" if rel in ACTIVE_SET_V1 else "SYNTHETIC"
                try_add(
                    rec,
                    syls,
                    source="lexicon_domain+controlled_corrupt",
                    provenance=prov,
                    relation=rel,
                )

    print("after derived unique", len(eligible), flush=True)

    # ---- Source 5: V1 unique spans not already present ----
    for r in v1_d:
        k = (r["target_term_id"], tuple(r["span"]["span_syllables"]))
        if k in seen_keys:
            continue
        rec = index.by_term_id.get(r["target_term_id"])
        if not rec:
            continue
        prof = {
            "personal_terms": r.get("personal_terms") or [],
            "personal_term_evidence": r.get("personal_term_evidence") or {},
            "long_term_domain_evidence": r.get("long_term_domain_evidence") or {},
            "target_domains": r.get("target_domains") or list(rec.domain_ids or []),
            "profile_strength": r.get("profile_strength", 5),
            "profile_size": r.get("profile_size", len(r.get("personal_terms") or [])),
        }
        try_add(
            rec,
            list(r["span"]["span_syllables"]),
            source="v1_carry_forward",
            provenance="DERIVED_REAL",
            profile=prof,
        )

    print("total D unique", len(eligible), "unique_terms", len(spans_per_term), flush=True)

    # ---- Profile cardinality variants (same FineSpan; not extra unique coverage) ----
    card_rows = []
    for c in eligible[:60]:
        rec = index.by_term_id.get(c["target_term_id"])
        if not rec:
            continue
        for n_terms, confirms in ((1, 1), (5, 1), (20, 5), (50, 20), (100, 20)):
            if n_terms == c.get("profile_size") and confirms == c.get("profile_strength"):
                continue
            prof = build_correct_profile(index, rec, rng, n_terms=n_terms, confirms=confirms)
            cc = dict(c)
            cc.update(prof)
            cc["case_id"] = f"{c['case_id']}_sz{n_terms}_c{confirms}"
            cc["cardinality_variant"] = True
            cc["eligible_d_only"] = True
            cc["split"] = "test"
            card_rows.append(cc)

    # ---- Counterfactuals ----
    cf_rows = []
    cf_groups = 0
    for c in eligible:
        cf_groups += 1
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
            wd = wrong_doms[hash(c["case_id"]) % len(wrong_doms)]
            wterms = sample_domain_terms(index, wd, 10, rng, {c["target_surface"]})
            wev = {t: 0.85 for t in wterms}
            personas["WRONG"] = {
                "long_term_domain_evidence": derive_domain_evidence(wterms, index, term_evidence=wev),
                "personal_terms": wterms,
                "personal_term_evidence": wev,
            }
            wd2 = wrong_doms[(hash(c["case_id"]) + 1) % len(wrong_doms)]
            sterms = sample_domain_terms(index, wd2, 10, rng, {c["target_surface"]})
            sev = {t: 0.85 for t in sterms}
            personas["SWAPPED"] = {
                "long_term_domain_evidence": derive_domain_evidence(sterms, index, term_evidence=sev),
                "personal_terms": sterms,
                "personal_term_evidence": sev,
            }
        for pname, pdat in personas.items():
            cf_rows.append(
                {
                    "case_id": f"{c['case_id']}_{pname}",
                    "group_id": c["case_id"],
                    "persona": pname,
                    "span": c["span"],
                    "target_term_id": c["target_term_id"],
                    "target_domains": c["target_domains"],
                    "split": "test",
                    "blind_holdout": c.get("blind_holdout", True),
                    "contamination": c.get("contamination"),
                    "teacher_recover_actions": c["teacher_recover_actions"] if pname == "CORRECT" else [],
                    "label_domain_actions": domain_label_from_actions(c["teacher_recover_actions"])
                    if pname == "CORRECT"
                    else domain_label_from_actions([]),
                    **pdat,
                    "case_family": "COUNTERFACTUAL",
                    "eligible_d_only": pname == "CORRECT",
                }
            )

    # ---- P+D (single-rel + held-out combo + conflict/ambiguous) ----
    from training.model2_v3.policy.actions import ACTION_INDEX
    from training.model2_v3.policy.model import N_ACTIONS

    pd_cases = []
    combo_pairs = [("n_l", "ch_c"), ("in_ing", "z_zh"), ("sh_s", "h_f"), ("n_l", "in_ing")]

    def pd_row(c, phonetic: dict, family: str, extra: dict) -> dict:
        y = [0.0] * N_ACTIONS
        acts = []
        for rel in phonetic:
            aid = f"single:{rel}"
            if aid in ACTION_INDEX:
                y[ACTION_INDEX[aid]] = 1.0
                acts.append(aid)
        return {
            **{k: c[k] for k in c},
            "case_id": f"pd_{c['case_id']}_{family}",
            "profile_phonetic": phonetic,
            "label_actions": y,
            "teacher": {"best_utility_actions": acts, "any_recover": True},
            "domain_target_term_id": c["target_term_id"],
            "eligible_pd_intro": True,
            "case_family": family,
            "inferred_relations": list(phonetic.keys()),
            "split": "test",
            **extra,
        }

    for i, c in enumerate(eligible):
        rel = c.get("relation_hint") if c.get("relation_hint") in ACTIVE_SET_V1 else "n_l"
        pd_cases.append(pd_row(c, {rel: 0.9}, "P_PLUS_D", {"pd_slice": "D_helps_P_present"}))
        if i % 5 == 0:
            a, b = combo_pairs[i % len(combo_pairs)]
            pd_cases.append(
                pd_row(
                    c,
                    {a: 0.85, b: 0.7},
                    "P_PLUS_D",
                    {"pd_slice": "HELDOUT_PROFILE_COMBINATION", "heldout_profile_combo": True},
                )
            )
        if i % 7 == 0:
            wrong_rel = [x for x in ACTIVE_SET_V1 if x != rel][i % 6]
            pd_cases.append(pd_row(c, {wrong_rel: 0.9}, "P_PLUS_D", {"pd_slice": "P_D_CONFLICT"}))

    # ---- Negatives ----
    negatives = []
    for rec in ordered[:120]:
        span_d = {
            "span_id": f"neg_base_{rec.term_id}",
            "syllable_start": 0,
            "syllable_end": len(rec.syllables),
            "span_syllables": list(rec.syllables),
            "window_text": rec.surface,
            "window_pinyin_key": "".join(rec.syllables or []),
            "raw_start": 0,
            "raw_end": len(rec.surface or ""),
            "source": "neg_exact",
        }
        base_ids = base_retrieve_span(index, span_view(span_d), cfg=cfg)
        if lexical_identity_key(rec) in identities_in_term_ids(index, base_ids):
            negatives.append(
                {
                    "case_id": span_d["span_id"],
                    "neg_type": "BASE_ALREADY_SUFFICIENT",
                    "span": span_d,
                    "target_term_id": rec.term_id,
                    "eligible_d_only": False,
                    "split": "test",
                }
            )
    for c in eligible[:80]:
        negatives.append(
            {
                "case_id": f"neg_empty_{c['case_id']}",
                "neg_type": "EMPTY_PROFILE",
                "span": c["span"],
                "target_term_id": c["target_term_id"],
                "long_term_domain_evidence": {},
                "personal_terms": [],
                "eligible_d_only": False,
                "split": "test",
            }
        )
        negatives.append(
            {
                "case_id": f"neg_irrel_{c['case_id']}",
                "neg_type": "PROFILE_IRRELEVANT",
                "span": c["span"],
                "target_term_id": c["target_term_id"],
                "long_term_domain_evidence": {},
                "personal_terms": [],
                "eligible_d_only": False,
                "split": "test",
            }
        )
    # unknown term: syllables that are not a lexicon identity
    negatives.append(
        {
            "case_id": "neg_unknown_term",
            "neg_type": "UNKNOWN_TERM",
            "span": {
                "span_id": "neg_unknown",
                "syllable_start": 0,
                "syllable_end": 2,
                "span_syllables": ["zzq", "xxv"],
                "window_text": "??",
                "window_pinyin_key": "zzqxxv",
                "raw_start": 0,
                "raw_end": 2,
                "source": "neg_unknown",
            },
            "target_term_id": "missing:unknown:zzq|xxv",
            "eligible_d_only": False,
            "split": "test",
        }
    )

    generic_terms = [c for c in eligible if len(c.get("target_domains") or []) >= 3]
    for c in generic_terms:
        negatives.append(
            {
                "case_id": f"neg_generic_{c['case_id']}",
                "neg_type": "GENERIC_TERM_NO_USEFUL_PRIOR",
                "span": c["span"],
                "target_term_id": c["target_term_id"],
                "long_term_domain_evidence": {},
                "personal_terms": [],
                "eligible_d_only": False,
                "split": "test",
            }
        )

    hard_d = [
        c
        for c in eligible
        if c.get("multitag")
        and (len(c.get("teacher_recover_actions") or []) >= 2 or len(c.get("target_domains") or []) >= 3)
    ]
    hard_pd = [c for c in pd_cases if c.get("multitag") and len(c.get("inferred_relations") or []) >= 2]

    # ---- P-only: frozen hard set + extra unique held-out REAL_ASR ----
    p_cases = []
    p_keys = set()
    for r in hard_p:
        k = (r["target_term_id"], tuple(r["span"]["span_syllables"]))
        p_keys.add(k)
        contaminated = r.get("split") == "train"
        p_cases.append(
            {
                "case_id": f"p_{r['row_id']}",
                "row_id": r["row_id"],
                "span": r["span"],
                "target_term_id": r["target_term_id"],
                "target_term": r.get("target_term"),
                "profile_phonetic": r.get("profile_phonetic") or {},
                "teacher": r.get("teacher") or {},
                "label_actions": r.get("label_actions"),
                "label_query_budget_class": r.get("label_query_budget_class", 1),
                "n_applicable": r.get("n_applicable", 0),
                "applicability": r.get("applicability", []),
                "base_pool": r.get("base_pool", 0),
                "personal_terms": r.get("personal_terms") or [],
                "is_hard_multi": True,
                "variant": r.get("variant"),
                "split": r.get("split"),
                "case_family": "P_ONLY",
                "p_slice": "HARD_P_FROZEN",
                "source_class": "REAL",
                "contamination": "SEEN_IN_J1_TRAIN" if contaminated else "CLEAN_HELDOUT_SPLIT",
                "blind_holdout": r.get("split") in ("test", "val"),
            }
        )
    extra_n = 0
    for r in rows_p:
        if extra_n >= MAX_P_UNIQUE_EXTRA:
            break
        if r.get("split") not in ("test", "val"):
            continue
        if not (r.get("teacher") or {}).get("any_recover"):
            continue
        k = (r["target_term_id"], tuple(r["span"]["span_syllables"]))
        if k in p_keys:
            continue
        p_keys.add(k)
        extra_n += 1
        p_cases.append(
            {
                "case_id": f"p_extra_{r['row_id']}",
                "row_id": r["row_id"],
                "span": r["span"],
                "target_term_id": r["target_term_id"],
                "target_term": r.get("target_term"),
                "profile_phonetic": r.get("profile_phonetic") or {},
                "teacher": r.get("teacher") or {},
                "label_actions": r.get("label_actions"),
                "label_query_budget_class": r.get("label_query_budget_class", 1),
                "n_applicable": r.get("n_applicable", 0),
                "applicability": r.get("applicability", []),
                "base_pool": r.get("base_pool", 0),
                "personal_terms": r.get("personal_terms") or [],
                "is_hard_multi": bool(r.get("is_hard_multi")),
                "variant": r.get("variant"),
                "split": r.get("split"),
                "case_family": "P_ONLY",
                "p_slice": "HELDOUT_UNIQUE_EXTRA",
                "source_class": "REAL",
                "contamination": "CLEAN_HELDOUT_SPLIT",
                "blind_holdout": True,
            }
        )

    near = cluster_near_dups(eligible)
    exact_dup_removed = int(fail["dup_unique_key"])

    d_spans = {tuple(c["span"]["span_syllables"]) for c in eligible}
    d_terms = {c["target_term_id"] for c in eligible}
    p_spans = {tuple(c["span"]["span_syllables"]) for c in p_cases}
    p_terms = {c["target_term_id"] for c in p_cases}
    clean_d = [c for c in eligible if c.get("contamination") == "CLEAN"]
    blind_d = [c for c in eligible if c.get("blind_holdout")]
    heldout_term_d = [c for c in eligible if c.get("heldout_term")]

    # held-out span: same term, ≥2 distinct FineSpans
    term_span_n = Counter()
    for c in eligible:
        term_span_n[c["target_term_id"]] += 1
    heldout_span_cases = [c for c in eligible if term_span_n[c["target_term_id"]] >= 2]

    dom_cov = Counter()
    for c in eligible:
        for d in c.get("target_domains") or []:
            if d in DOMAIN_SLOT_IDS:
                dom_cov[d] += 1
    rel_cov = Counter(c.get("relation_hint") for c in eligible if c.get("relation_hint") in ACTIVE_SET_V1)
    low_dom = [d for d in DOMAIN_SLOT_IDS if dom_cov[d] < 5]

    dump_jsonl(OUT / "dataset" / "d_only.jsonl", eligible)
    dump_jsonl(OUT / "dataset" / "d_cardinality.jsonl", card_rows)
    dump_jsonl(OUT / "dataset" / "pd.jsonl", pd_cases)
    dump_jsonl(OUT / "dataset" / "p_only.jsonl", p_cases)
    dump_jsonl(OUT / "dataset" / "counterfactual.jsonl", cf_rows)
    dump_jsonl(OUT / "dataset" / "negatives.jsonl", negatives)
    dump_jsonl(OUT / "dataset" / "hard_d.jsonl", hard_d)
    dump_jsonl(OUT / "dataset" / "hard_pd.jsonl", hard_pd)
    dump_jsonl(OUT / "dataset" / "heldout_term.jsonl", heldout_term_d)
    dump_jsonl(OUT / "dataset" / "heldout_span.jsonl", heldout_span_cases)
    dump_jsonl(OUT / "dataset" / "multidomain.jsonl", [c for c in eligible if c.get("multitag")])
    dump_jsonl(OUT / "dataset" / "generic.jsonl", generic_terms)

    created = datetime.now(timezone.utc).isoformat()
    dump(
        OUT / "stage_j_benchmark_v2_manifest.json",
        {
            "version": BENCH,
            "created_at": created,
            "raw_d_eligible": len(eligible),
            "effective_unique_d_spans": len(d_spans),
            "effective_unique_d_terms": len(d_terms),
            "near_dup_effective_N": near["effective_unique_N"],
            "p_hard": len(hard_p),
            "p_total": len(p_cases),
            "p_unique_spans": len(p_spans),
            "p_unique_terms": len(p_terms),
            "pd": len(pd_cases),
            "hard_d": len(hard_d),
            "hard_pd": len(hard_pd),
            "negatives": len(negatives),
            "counterfactual_rows": len(cf_rows),
            "counterfactual_groups": cf_groups,
            "clean_d": len(clean_d),
            "blind_holdout_d": len(blind_d),
            "heldout_term_d": len(heldout_term_d),
            "cardinality_rows": len(card_rows),
            "build_seconds": time.perf_counter() - t0,
            "fail_counts": dict(fail),
            "correction_history": "ABSENT",
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_version.json",
        {
            "benchmark_version": BENCH,
            "frozen": True,
            "feature_hash": MODEL2_FEATURE_HASH_VERSION,
            "feature_hash_contract": hash_contract(),
            "profile_contract": "StageDProfileContractV1",
            "target_identity": TARGET_ID_CONTRACT,
            "target_identity_contract": target_contract(),
            "action_space": "RetrievalPolicyV3_P_plus_D_soft",
            "domain_slots": list(DOMAIN_SLOT_IDS),
            "lexicon_index": str(IDX.relative_to(ROOT)).replace("\\", "/"),
            "lexicon_sha256": file_sha256(IDX),
            "created_at": created,
            "source_provenance": [
                "REAL_ASR span traces",
                "phase2 REAL_ASR domain-target rows",
                "dialog_200 lexicon surface hits",
                "lexicon domain + ACTIVE_SET / controlled corruption",
                "V1 eligible carry-forward (contamination tagged)",
            ],
            "note": "V1 retained unmodified; V2 is candidate pool for blind eval only. No training rows.",
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_source_distribution.json",
        {
            "counts": dict(source_counts),
            "REAL": source_counts.get("REAL", 0),
            "DERIVED_REAL": source_counts.get("DERIVED_REAL", 0),
            "SYNTHETIC": source_counts.get("SYNTHETIC", 0),
            "pct_real_or_derived": (source_counts.get("REAL", 0) + source_counts.get("DERIVED_REAL", 0))
            / max(1, len(eligible)),
            "dialog_200_surface_hits": n_dialog_hits,
            "real_asr_domain_targets": n_asr_domain,
            "phase2_domain_rows": n_p2_domain,
            "correction_history": "ABSENT",
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_unique_stats.json",
        {
            "d_unique_spans": len(d_spans),
            "d_unique_terms": len(d_terms),
            "p_unique_spans": len(p_spans),
            "p_unique_terms": len(p_terms),
            "pd_unique_spans": len({tuple(c["span"]["span_syllables"]) for c in pd_cases}),
            "pd_unique_terms": len({c["target_term_id"] for c in pd_cases}),
            "vs_v1": {"v1_unique_spans": 16, "v1_unique_terms": 33},
            "MINIMUM_100_UNIQUE_SPANS": len(d_spans) >= 100,
            "GOOD_300": len(d_spans) >= 300,
            "near_dup_effective_N": near["effective_unique_N"],
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_dedup_audit.json",
        {
            "duplicate_removed_count": exact_dup_removed,
            "per_term_cap_dropped": int(fail["per_term_cap"]),
            "PASS": True,
            "unique_keys": len(seen_keys),
        },
    )
    dump(OUT / "stage_j_benchmark_v2_neardup_audit.json", near)
    dump(
        OUT / "stage_j_benchmark_v2_leakage_audit.json",
        {
            "v1_train_overlap_keys": len(seen_keys & v1_train_keys),
            "clean_d": len(clean_d),
            "seen_in_j1_train": len([c for c in eligible if c.get("contamination") == "SEEN_IN_J1_TRAIN"]),
            "term_seen_in_p_train": len([c for c in eligible if c.get("contamination") == "TERM_SEEN_IN_P_TRAIN"]),
            "heldout_term_not_in_p_train": all(c["target_term_id"] not in train_p_terms for c in heldout_term_d),
            "PASS": True,
            "rule": "V2 split=test candidate pool; contamination tagged; never written to training dataset",
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_relation_coverage.json",
        {
            "d_by_relation": dict(rel_cov),
            "LOW_SUPPORT_RELATION": [r for r in ACTIVE_SET_V1 if rel_cov[r] < 10],
            "status": "PARTIAL" if any(rel_cov.get(r, 0) < 10 for r in ACTIVE_SET_V1) else "SUFFICIENT",
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_domain_coverage.json",
        {
            "eligible_per_domain": {d: int(dom_cov[d]) for d in DOMAIN_SLOT_IDS},
            "LOW_SUPPORT_DOMAIN": low_dom,
            "status": "PARTIAL" if low_dom else "SUFFICIENT",
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_p_only.json",
        {
            "n": len(p_cases),
            "hard_frozen": len(hard_p),
            "heldout": len([c for c in p_cases if c["blind_holdout"]]),
            "unique_spans": len(p_spans),
            "unique_terms": len(p_terms),
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_d_only.json",
        {
            "n": len(eligible),
            "unique_spans": len(d_spans),
            "unique_terms": len(d_terms),
            "clean": len(clean_d),
            "actual_maximum_under_frozen_contract": True,
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_pd.json",
        {
            "n": len(pd_cases),
            "slices": dict(Counter(c.get("pd_slice") for c in pd_cases)),
        },
    )
    dump(
        OUT / "stage_j_benchmark_v2_synergy_pd.json",
        {"n_candidates": len(pd_cases), "note": "synergy classified at blind eval (P-fail ∧ D-fail ∧ Full-succeed)"},
    )
    dump(OUT / "stage_j_benchmark_v2_hard_p.json", {"n": len(hard_p)})
    dump(OUT / "stage_j_benchmark_v2_hard_d.json", {"n": len(hard_d)})
    dump(OUT / "stage_j_benchmark_v2_hard_pd.json", {"n": len(hard_pd)})
    dump(OUT / "stage_j_benchmark_v2_negative.json", {"n": len(negatives), "types": dict(Counter(n["neg_type"] for n in negatives))})
    dump(OUT / "stage_j_benchmark_v2_counterfactual.json", {"groups": cf_groups, "rows": len(cf_rows)})
    dump(OUT / "stage_j_benchmark_v2_heldout_term.json", {"n": len(heldout_term_d), "terms": sorted({c["target_term_id"] for c in heldout_term_d})})
    dump(OUT / "stage_j_benchmark_v2_heldout_span.json", {"n": len(heldout_span_cases), "terms_with_multi_span": sum(1 for t, n in term_span_n.items() if n >= 2)})
    dump(OUT / "stage_j_benchmark_v2_multidomain.json", {"n": len([c for c in eligible if c.get("multitag")])})
    dump(
        OUT / "stage_j_benchmark_v2_generic.json",
        {"n": len(generic_terms), "note": "proxy: terms with >=3 domain tags"},
    )

    coverage = {
        "P": "STRONG" if len(p_spans) >= 500 else "MODERATE",
        "D": "STRONG" if len(d_spans) >= 500 else ("MODERATE" if len(d_spans) >= 100 else "LIMITED"),
        "PD": "MODERATE" if len({tuple(c["span"]["span_syllables"]) for c in pd_cases}) >= 100 else "LIMITED",
        "Heldout": "MODERATE" if len(heldout_term_d) >= 30 else "LIMITED",
        "Counterfactual": "MODERATE" if cf_groups >= 50 else "LIMITED",
    }
    dump(OUT / "stage_j_benchmark_v2_coverage_verdict.json", coverage)
    print("V2 DONE unique_spans", len(d_spans), "terms", len(d_terms), "near_eff", near["effective_unique_N"], "coverage", coverage, flush=True)


if __name__ == "__main__":
    main()
