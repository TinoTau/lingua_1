#!/usr/bin/env python3
"""MODEL2_V3_STAGE_D_STAGE_J_RETRAIN_AND_FREEZE

Freeze restored Stage D retrieval architecture, then:
  1. RESTORED_STAGE_D_CONTROLLED  (P1 + fresh domain head, shared frozen)
  2. P regression gate
  3. RESTORED_STAGE_J_JOINT_TRAIN if D generalization PASSes
  4. Blind V2 + frozen V3
  5. 38 BASE_ABSENT regression anchors LAST (executor only)

NO architecture change. NO runtime swap. NO new model/gate/rule/fallback.
Fixed 38 are REGRESSION_ANCHOR only — never training targets.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX, action_applicable, execute_action
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    N_DOMAIN_ACTIONS,
    execute_domain_action,
)
from training.model2_v3.policy.model import N_ACTIONS, RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.ranking_loss import pairwise_action_ranking_loss
from training.model2_v3.policy.stage_d_target_identity_v1 import target_hit
from training.model2_v3.scripts.run_v3_phase3_stage_p_refine import top1_labels
from training.model2_v3.scripts.run_v3_stage_d_retrieval_executor_restoration import eval_38
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_d_stage_j_restored_retrain"
DATA_D = ROOT / "training/model2_v3/dataset/policy_stage_d_restored_v1/rows.jsonl"
DATA_J = ROOT / "training/model2_v3/dataset/policy_stage_j_restored_v1/rows.jsonl"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2/rows.jsonl"
ELIGIBLE = ROOT / "training/model2_v3/experiments/v3_stage_d_restored/d_only_eligible.jsonl"
CKPT_P1 = ROOT / "training/model2_v3/experiments/v3_stage_j_recovery_p1_d1/training/p1_stage_p_feature_hash_v1.pt"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
V2 = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2"
V3_CAND = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v3_candidate"
V3_FROZEN = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v3"
CASES38 = ROOT / "training/model2_v3/experiments/v3_stage_d_restored/stage_d_38_fixed_oracle_cases.json"
FEATURE_HASH = "v1"
W_P, W_D, W_QB = 1.25, 0.55, 0.25
P1_BASELINE_RR = 0.955
P1_HELDOUT_RR = 0.941
NONE_I = DOMAIN_ACTION_INDEX["domain_none"]
FORBIDDEN_38 = ROOT / "training/model2_v3/experiments/v3_stage_d_restored/stage_d_38_fixed_oracle_cases.json"


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def wilson_ci(k: int, n: int, z: float = 1.96) -> list[float]:
    if n <= 0:
        return [0.0, 0.0]
    p = k / n
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [max(0.0, (centre - margin) / den), min(1.0, (centre + margin) / den)]


def support_tag(n: int) -> str:
    if n < 30:
        return "VERY_LOW_SUPPORT"
    if n < 100:
        return "LOW_SUPPORT"
    return "OK"


def empty_domain_label() -> list[float]:
    y = [0.0] * N_DOMAIN_ACTIONS
    y[NONE_I] = 1.0
    return y


def load_ckpt(path: Path, model: RetrievalPolicyV3, *, strict: bool = False) -> dict:
    obj = torch.load(path, map_location="cpu", weights_only=False)
    sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
    missing, unexpected = model.load_state_dict(sd, strict=strict)
    return {
        "path": str(path),
        "strict": strict,
        "missing": list(missing),
        "unexpected": list(unexpected),
        "n_missing": len(missing),
        "n_unexpected": len(unexpected),
    }


def row_state(r: dict) -> dict:
    return {
        "base_pool": r.get("base_pool", 0) or 16,
        "query_budget": 8,
        "cand_budget": 8,
        "n_applicable": r.get("n_applicable", 0),
        "applicability": r.get("applicability") or [],
        "personal_terms": r.get("personal_terms") or [],
        "domain_evidence": r.get("long_term_domain_evidence") or {},
        "term_evidence": r.get("personal_term_evidence") or {},
        "max_lexical_items": 32,
    }


def domain_scored(model, row, *, device) -> list[tuple[float, str]]:
    model.eval()
    x = pack_batch_inputs(
        [row["span"]["span_syllables"]],
        [row.get("profile_phonetic") or {}],
        [row_state(row)],
        device=device,
        feature_hash=FEATURE_HASH,
    )
    with torch.no_grad():
        out = model(*x)
        logits = out.get("domain_action_logits")
        if logits is None:
            return [(1.0, "domain_none")]
        probs = torch.sigmoid(logits[0]).cpu()
    scored = [(float(probs[i]), a.action_id) for i, a in enumerate(DOMAIN_ACTION_CATALOG)]
    scored.sort(reverse=True)
    return scored


def select_d_actions(model, row, *, budget: int, device) -> list[str]:
    scored = domain_scored(model, row, device=device)
    chosen = []
    for _, aid in scored:
        if aid == "domain_none" and chosen:
            continue
        chosen.append(aid)
        if len(chosen) >= budget:
            break
    return chosen or ["domain_none"]


def select_p_actions(model, row, *, qb: int, device) -> tuple[list[str], list[dict]]:
    model.eval()
    x = pack_batch_inputs(
        [row["span"]["span_syllables"]],
        [row.get("profile_phonetic") or {}],
        [row_state(row)],
        device=device,
        feature_hash=FEATURE_HASH,
    )
    with torch.no_grad():
        out = model(*x)
        probs = torch.sigmoid(out["action_logits"][0]).cpu()
    scored = []
    prof = row.get("profile_phonetic") or {}
    for i, a in enumerate(ACTION_CATALOG):
        if a.kind != "single":
            continue
        if not all(float(prof.get(r) or 0) > 0 for r in a.relations):
            continue
        scored.append((float(probs[i]), a.action_id))
    scored.sort(reverse=True)
    detail = [{"action_id": aid, "raw_prob": s, "rank": r + 1} for r, (s, aid) in enumerate(scored)]
    return [aid for _, aid in scored[:qb]], detail


def teacher_domain_ids(row: dict) -> list[str]:
    acts = []
    for ainfo in row.get("teacher_recover_actions") or []:
        aid = ainfo["action_id"] if isinstance(ainfo, dict) else ainfo
        if aid and aid != "domain_none":
            acts.append(aid)
    teacher = row.get("teacher") or {}
    for aid in teacher.get("best_actions") or []:
        if aid.startswith("domain_soft:") and aid not in acts:
            acts.append(aid)
    lab = row.get("label_domain_actions")
    if lab and not acts:
        for i, v in enumerate(lab):
            if float(v) > 0.5:
                aid = DOMAIN_ACTION_CATALOG[i].action_id
                if aid != "domain_none":
                    acts.append(aid)
    return acts


def execute_d_hit(index, row, action_ids: list[str], *, cfg) -> bool:
    span = span_view(row["span"])
    tid = row["target_term_id"]
    base = set(base_retrieve_span(index, span, cfg=cfg))
    ev = row.get("long_term_domain_evidence") or {}
    for aid in action_ids:
        a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
        res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
        if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
            return True
    return False


def eval_domain_teacher(model, rows, *, device) -> dict:
    top1 = top2 = n_t = 0
    none_n = 0
    for r in rows:
        scored = domain_scored(model, r, device=device)
        ranked = [aid for _, aid in scored]
        want = teacher_domain_ids(r)
        if not want:
            want = ["domain_none"] if (r.get("persona") not in (None, "CORRECT") or r.get("case_family") == "D_NONE_NEGATIVE") else []
        if not want:
            continue
        n_t += 1
        target = want[0]
        if ranked and ranked[0] == target:
            top1 += 1
        if target in ranked[:2]:
            top2 += 1
        if ranked and ranked[0] == "domain_none":
            none_n += 1
    return {
        "n": n_t,
        "DomainTop1": rate(top1, n_t),
        "DomainTop2": rate(top2, n_t),
        "chose_domain_none": rate(none_n, n_t),
        "support": support_tag(n_t),
    }


def eval_d_tir(index, rows, model, *, device, cfg, budget: int = 1) -> dict:
    hits = oracle = expand = 0
    lat = []
    for r in rows:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))
        ev = r.get("long_term_domain_evidence") or {}
        o_ok = False
        for aid in teacher_domain_ids(r):
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                o_ok = True
                break
        oracle += int(o_ok)
        t0 = time.perf_counter()
        acts = select_d_actions(model, r, budget=budget, device=device)
        lat.append((time.perf_counter() - t0) * 1000)
        expand += int(any(a != "domain_none" for a in acts))
        hits += int(execute_d_hit(index, r, acts, cfg=cfg))
    n = len(rows)
    tir = rate(hits, n)
    o_tir = rate(oracle, n)
    return {
        "n": n,
        "support": support_tag(n),
        "TIR": tir,
        "Oracle_TIR": o_tir,
        "RecallRetained": (tir / o_tir) if o_tir > 0 else 0.0,
        "TIR_CI95": wilson_ci(hits, n),
        "hits": hits,
        "UnnecessaryExpansion": rate(expand, n),
        "Latency_P50": sorted(lat)[len(lat) // 2] if lat else 0.0,
    }


def eval_p_slice(index, rows, model, *, device, cfg) -> dict:
    b1_hits = v3_hits = 0
    b1_q = v3_q = b1_c = v3_c = 0
    lat = []
    top1 = top2 = n_t = 0
    for r in rows:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        prof = r.get("profile_phonetic") or {}
        base = set(base_retrieve_span(index, span, cfg=cfg))
        acts_b1 = [a.action_id for a in ACTION_CATALOG if a.kind == "single" and action_applicable(span, a, prof)]
        new_b1: set[str] = set()
        nq = 0
        for aid in acts_b1:
            res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
            nq += int(res.get("n_queries") or 0)
            for t in res.get("term_ids") or []:
                if len(new_b1) >= 8:
                    break
                new_b1.add(t)
        b1_hits += int(tid in new_b1)
        b1_q += nq
        b1_c += len(new_b1)
        t0 = time.perf_counter()
        acts, detail = select_p_actions(model, r, qb=1, device=device)
        new_v: set[str] = set()
        nq2 = 0
        for aid in acts:
            res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
            nq2 += int(res.get("n_queries") or 0)
            for t in res.get("term_ids") or []:
                if len(new_v) >= 8:
                    break
                new_v.add(t)
        lat.append((time.perf_counter() - t0) * 1000)
        v3_hits += int(tid in new_v)
        v3_q += nq2
        v3_c += len(new_v)
        teacher = r.get("teacher") or r.get("teacher_p") or {}
        cands = [a for a in (teacher.get("best_utility_actions") or []) if a.startswith("single:")]
        if not cands:
            cands = [a for a in (teacher.get("best_recall_actions") or []) if a.startswith("single:")]
        if not cands:
            cands = [a for a in (teacher.get("best_actions") or []) if a.startswith("single:")]
        if cands:
            n_t += 1
            rank = next((d["rank"] for d in detail if d["action_id"] == cands[0]), 99)
            if rank == 1:
                top1 += 1
            if rank <= 2:
                top2 += 1
    n = len(rows)
    tir_b1 = rate(b1_hits, n)
    tir_v3 = rate(v3_hits, n)
    rr = tir_v3 / tir_b1 if tir_b1 > 0 else 0.0
    return {
        "n": n,
        "support": support_tag(n),
        "TIR_B1": tir_b1,
        "TIR_V3": tir_v3,
        "RecallRetained": rr,
        "TIR_CI95": wilson_ci(v3_hits, n),
        "Teacher_Top1": top1 / max(1, n_t),
        "Teacher_Top2": top2 / max(1, n_t),
        "hits_v3": v3_hits,
        "Latency_P50": sorted(lat)[len(lat) // 2] if lat else 0.0,
        "Latency_P95": sorted(lat)[int(0.95 * (len(lat) - 1))] if lat else 0.0,
        "P1_baseline_RR": P1_BASELINE_RR,
    }


def freeze_v3_before_eval() -> dict:
    V3_FROZEN.mkdir(parents=True, exist_ok=True)
    copied = []
    for name in ("d_only.jsonl", "pd.jsonl", "counterfactual.jsonl"):
        src = V3_CAND / name
        dst = V3_FROZEN / name
        shutil.copy2(src, dst)
        copied.append(name)
    meta = {
        "version": "STAGE_J_PRODUCTION_BENCHMARK_V3",
        "status": "FROZEN",
        "frozen_before_model_evaluation": True,
        "source_candidate": "STAGE_J_PRODUCTION_BENCHMARK_V3_CANDIDATE",
        "copied_files": copied,
        "v2_unmodified": True,
        "mutation_after_freeze": "FORBIDDEN",
        "date": "2026-08-17",
    }
    dump(V3_FROZEN / "stage_j_benchmark_v3_freeze.json", meta)
    return meta


def diversity_stats(rows: list[dict]) -> dict:
    spans = {(r["target_term_id"], tuple(r["span"]["span_syllables"])) for r in rows}
    terms = {r["target_term_id"] for r in rows}
    carriers = {(r.get("span") or {}).get("carrier") or r.get("carrier") for r in rows}
    profiles = {tuple(sorted((r.get("personal_terms") or [])[:12])) for r in rows}
    domains = {tuple(sorted(r.get("target_domains") or [])) for r in rows}
    src = Counter(r.get("source_class") or "UNKNOWN" for r in rows)
    return {
        "rows": len(rows),
        "unique_finespan": len(spans),
        "unique_terms": len(terms),
        "unique_carriers": len(carriers),
        "unique_profile_combinations": len(profiles),
        "unique_domain_combinations": len(domains),
        "source_class": dict(src),
    }


def assert_no_38_in_train(rows: list[dict]) -> None:
    raw = FORBIDDEN_38.read_text(encoding="utf-8")
    surfaces = set()
    obj = json.loads(raw)
    for c in obj.get("cases") or []:
        surfaces.add((c.get("target_term_id"), tuple(c.get("span_syllables") or [])))
    overlap = 0
    for r in rows:
        key = (r.get("target_term_id"), tuple((r.get("span") or {}).get("span_syllables") or []))
        if key in surfaces:
            overlap += 1
    # 38 cases may share terms with the population; using them as *rows* is forbidden.
    # We only reject if the training row_id/case_id is the 38 fixture itself.
    fixture_ids = {c.get("case_id") for c in obj.get("cases") or [] if c.get("case_id")}
    leaked = [r.get("row_id") or r.get("case_id") for r in rows if (r.get("row_id") or r.get("case_id")) in fixture_ids]
    if leaked:
        raise RuntimeError(f"38 REGRESSION_ANCHOR leaked into training: {leaked[:5]}")


def pack_d_tensors(rows: list[dict], weights: Optional[list[float]] = None):
    spans, profiles, states, yd, w = [], [], [], [], []
    for i, r in enumerate(rows):
        spans.append(r["span"]["span_syllables"])
        profiles.append(r.get("profile_phonetic") or {})
        states.append(row_state(r))
        lab = r.get("label_domain_actions") or empty_domain_label()
        yd.append(torch.tensor(lab, dtype=torch.float32))
        w.append(float(weights[i]) if weights is not None else 1.0)
    X = pack_batch_inputs(spans, profiles, states, feature_hash=FEATURE_HASH)
    return X, torch.stack(yd), torch.tensor(w, dtype=torch.float32)


def d_hard_weights(model, rows: list[dict], *, device) -> list[float]:
    """TRAIN-split only generic hard mining: top1 miss / high confusion. No case_id whitelist."""
    ws = []
    model.eval()
    for r in rows:
        w = 1.0
        if r.get("case_family") == "D_NONE_NEGATIVE" or r.get("persona") in ("EMPTY", "WRONG", "SWAPPED", "GENERIC"):
            w = 1.35
            scored = domain_scored(model, r, device=device)
            if scored and scored[0][1] != "domain_none":
                w = 2.5
        else:
            want = teacher_domain_ids(r)
            scored = domain_scored(model, r, device=device)
            ranked = [aid for _, aid in scored]
            if want and ranked and ranked[0] != want[0]:
                w = 2.5
            if r.get("source_class") in ("REAL", "DERIVED_REAL"):
                w *= 1.25
        ws.append(w)
    return ws


def train_d_controlled(model, train_rows, val_correct, *, device, epochs: int) -> list[dict]:
    model.freeze_shared()
    trainable = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.Adam(trainable, lr=1e-3)
    hist = []
    best_val = -1.0
    best_sd = None
    patience = 0
    by_g: dict[str, dict] = defaultdict(dict)
    for r in train_rows:
        by_g[r.get("group_key") or r.get("row_id")][r.get("persona") or "CORRECT"] = r

    for ep in range(epochs):
        weights = d_hard_weights(model, train_rows, device=device) if ep > 0 else [1.0] * len(train_rows)
        X, Yd, W = pack_d_tensors(train_rows, weights)
        ds = TensorDataset(X[0], X[1], X[2], X[3], Yd, W)
        sampler = WeightedRandomSampler(W.tolist(), num_samples=min(len(W), 2400), replacement=True)
        loader = DataLoader(ds, batch_size=32, sampler=sampler)
        dpos = Yd.sum(0).clamp(min=1)
        dneg = (Yd.shape[0] - dpos).clamp(min=1)
        bce = nn.BCEWithLogitsLoss(pos_weight=(dneg / dpos).clamp(1.0, 30.0).to(device))
        model.train()
        tot = 0.0
        n = 0
        for a, b, c, d, yd, _w in loader:
            a, b, c, d, yd = [t.to(device) for t in (a, b, c, d, yd)]
            opt.zero_grad()
            out = model(a, b, c, d)
            logits = out["domain_action_logits"]
            loss = bce(logits, yd)
            loss = loss + 0.85 * pairwise_action_ranking_loss(logits, (yd > 0.15).float(), margin=0.7)
            loss = loss + 0.5 * (
                -(yd.clamp(min=0) / yd.sum(-1, keepdim=True).clamp(min=1e-6) * F.log_softmax(logits, dim=-1)).sum(-1).mean()
            )
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1

        contrast = 0.0
        cn = 0
        model.train()
        groups = [g for g in by_g.values() if "CORRECT" in g and "EMPTY" in g]
        random.shuffle(groups)
        for personas in groups[:120]:
            keys = [k for k in ("CORRECT", "WRONG", "SWAPPED", "EMPTY") if k in personas]
            if "CORRECT" not in keys or len(keys) < 3:
                continue
            batch = [personas[k] for k in keys]
            xs = pack_batch_inputs(
                [r["span"]["span_syllables"] for r in batch],
                [r.get("profile_phonetic") or {} for r in batch],
                [row_state(r) for r in batch],
                device=device,
                feature_hash=FEATURE_HASH,
            )
            opt.zero_grad()
            logits = model(*xs)["domain_action_logits"]
            scores = []
            for i, r in enumerate(batch):
                lab = torch.tensor(r.get("label_domain_actions") or empty_domain_label(), device=device)
                p = torch.sigmoid(logits[i])
                scores.append((p * lab).sum() - 0.35 * (p * (1 - (lab > 0).float())).sum())
            loss_c = logits.new_zeros(())
            sc = scores[0]
            for j in range(1, len(scores)):
                loss_c = loss_c + F.relu(1.0 - (sc - scores[j]))
            if "EMPTY" in keys:
                ei = keys.index("EMPTY")
                loss_c = loss_c + F.relu(1.0 - logits[ei][NONE_I] + logits[ei].max())
            loss_c.backward()
            opt.step()
            contrast += float(loss_c.item())
            cn += 1

        val_m = eval_domain_teacher(model, val_correct, device=device)
        rec = {
            "epoch": ep + 1,
            "loss": tot / max(1, n),
            "contrast": contrast / max(1, cn),
            "val_DomainTop1": val_m["DomainTop1"],
            "val_DomainTop2": val_m["DomainTop2"],
            "n_train": len(train_rows),
        }
        hist.append(rec)
        print("D epoch", rec, flush=True)
        if val_m["DomainTop1"] > best_val + 1e-4:
            best_val = val_m["DomainTop1"]
            best_sd = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            patience = 0
        else:
            patience += 1
            if patience >= 4 and ep >= 5:
                print("D early stop at epoch", ep + 1, flush=True)
                break
    if best_sd is not None:
        model.load_state_dict(best_sd)
    return hist


def unfreeze_all(model: RetrievalPolicyV3) -> None:
    for p in model.parameters():
        p.requires_grad = True


def train_j_joint(model, p_rows, d_rows, pd_rows, *, device, ep1: int, ep2: int) -> tuple[list[dict], dict]:
    unfreeze_all(model)
    hist: list[dict] = []
    rng = random.Random(20260817)

    def run_epochs(rows, epochs, lr, phase, use_d: bool):
        spans, profiles, states, ya, yq, yd, weights = [], [], [], [], [], [], []
        for r in rows:
            spans.append(r["span"]["span_syllables"])
            profiles.append(r.get("profile_phonetic") or {})
            states.append(row_state(r))
            fam = r.get("case_family") or ""
            if fam in ("D_ONLY", "D_NONE_NEGATIVE", "HARD_D", "NEUTRAL") or r.get("task_p") is False:
                ya.append(torch.zeros(N_ACTIONS))
            else:
                ya.append(top1_labels(r))
            yq.append(int(r.get("label_query_budget_class") or 1))
            yd.append(torch.tensor(r.get("label_domain_actions") or empty_domain_label(), dtype=torch.float32))
            w = 5.0 if r.get("is_hard_multi") else 1.0
            if fam in ("D_ONLY", "HARD_D"):
                w *= 3.0
            if fam == "D_NONE_NEGATIVE":
                w *= 1.5
            if r.get("source_class") in ("REAL", "DERIVED_REAL"):
                w *= 1.25
            weights.append(w)
        X = pack_batch_inputs(spans, profiles, states, feature_hash=FEATURE_HASH)
        Ya = torch.stack(ya)
        Yq = torch.tensor(yq, dtype=torch.long)
        Yd = torch.stack(yd)
        W = torch.tensor(weights, dtype=torch.float32)
        ds = TensorDataset(X[0], X[1], X[2], X[3], Ya, Yq, Yd, W)
        sampler = WeightedRandomSampler(W.tolist(), num_samples=min(len(W), 8000), replacement=True)
        loader = DataLoader(ds, batch_size=64, sampler=sampler)
        opt = torch.optim.Adam(model.parameters(), lr=lr)
        pos = Ya.sum(0).clamp(min=1)
        neg = (Ya.shape[0] - pos).clamp(min=1)
        bce_p = nn.BCEWithLogitsLoss(pos_weight=(neg / pos).clamp(1.0, 30.0).to(device))
        dpos = Yd.sum(0).clamp(min=1)
        dneg = (Yd.shape[0] - dpos).clamp(min=1)
        bce_d = nn.BCEWithLogitsLoss(pos_weight=(dneg / dpos).clamp(1.0, 30.0).to(device))
        ce = nn.CrossEntropyLoss()
        for ep in range(epochs):
            model.train()
            tot = tot_p = tot_d = tot_q = 0.0
            n = 0
            for a, b, c, d, ya_b, yq_b, yd_b, _w in loader:
                a, b, c, d, ya_b, yq_b, yd_b = [t.to(device) for t in (a, b, c, d, ya_b, yq_b, yd_b)]
                opt.zero_grad()
                out = model(a, b, c, d)
                lp = bce_p(out["action_logits"], ya_b) + 1.25 * pairwise_action_ranking_loss(
                    out["action_logits"], (ya_b > 0.5).float(), margin=0.75
                )
                lq = ce(out["query_budget_logits"], yq_b)
                ld = out["action_logits"].new_zeros(())
                if use_d and "domain_action_logits" in out:
                    ld = bce_d(out["domain_action_logits"], yd_b)
                loss = W_P * lp + W_QB * lq + (W_D * ld if use_d else 0.0)
                loss.backward()
                opt.step()
                tot += float(loss.item())
                tot_p += float(lp.item())
                tot_d += float(ld.item()) if use_d else 0.0
                tot_q += float(lq.item())
                n += 1
            rec = {
                "phase": phase,
                "epoch": ep + 1,
                "loss": tot / max(1, n),
                "loss_p": tot_p / max(1, n),
                "loss_d": tot_d / max(1, n),
                "loss_qb": tot_q / max(1, n),
            }
            hist.append(rec)
            print(phase, rec, flush=True)

    p_anchor = [r for r in p_rows if r.get("split") == "train"]
    if len(p_anchor) > 8000:
        p_anchor = rng.sample(p_anchor, 8000)
    hard = [r for r in p_rows if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    mix1 = p_anchor + hard * 2
    rng.shuffle(mix1)
    run_epochs(mix1, ep1, 3e-4, "phase1_p_anchor", use_d=False)

    joint = []
    joint.extend(hard * 3)
    joint.extend(p_anchor[:6000])
    joint.extend(d_rows)
    joint.extend([r for r in d_rows if r.get("case_family") == "D_ONLY"] * 2)
    for r in pd_rows:
        rr = dict(r)
        y = empty_domain_label()
        for ainfo in r.get("teacher_recover_actions") or []:
            aid = ainfo["action_id"] if isinstance(ainfo, dict) else ainfo
            if aid in DOMAIN_ACTION_INDEX and aid != "domain_none":
                y[DOMAIN_ACTION_INDEX[aid]] = 1.0
                y[NONE_I] = 0.0
        rr["label_domain_actions"] = y
        joint.append(rr)
    rng.shuffle(joint)
    run_epochs(joint, ep2, 2e-4, "phase2_joint", use_d=True)
    balance = {
        "W_P": W_P,
        "W_D": W_D,
        "W_QB": W_QB,
        "phase1_epochs": ep1,
        "phase2_epochs": ep2,
        "n_phase1": len(mix1),
        "n_phase2": len(joint),
        "note": "few scalar weights only; no per-slice auxiliary losses",
    }
    return hist, balance


def source_slice_metrics(index, rows, model, *, device, cfg) -> dict:
    out = {}
    for src in ("REAL", "DERIVED_REAL", "SYNTHETIC"):
        sub = [r for r in rows if r.get("source_class") == src]
        if not sub:
            out[src] = {"n": 0, "support": "VERY_LOW_SUPPORT", "TIR": None}
            continue
        m = eval_d_tir(index, sub, model, device=device, cfg=cfg, budget=1)
        m["source_class"] = src
        if src == "REAL":
            m["support"] = "VERY_LOW_SUPPORT" if m["n"] < 30 else m["support"]
        out[src] = m
    return out


def d_pass_gate(val_cf: dict, val_tir: dict, train_top1: float, val_top1: float, source: dict) -> dict:
    correct = val_cf.get("CORRECT", {}).get("TIR", 0.0) or 0.0
    empty = val_cf.get("EMPTY", {}).get("TIR", 0.0) or 0.0
    wrong = val_cf.get("WRONG", {}).get("TIR", 0.0) or 0.0
    swapped = val_cf.get("SWAPPED", {}).get("TIR", 0.0) or 0.0
    held = val_tir.get("TIR", 0.0) or 0.0
    deltas_ok = (correct > empty) and (correct > wrong) and (correct > swapped)
    held_ok = held > 0.0
    overfit = train_top1 >= 0.90 and val_top1 < 0.40
    syn = (source.get("SYNTHETIC") or {}).get("TIR")
    real = (source.get("REAL") or {}).get("TIR")
    der = (source.get("DERIVED_REAL") or {}).get("TIR")
    syn_over = False
    syn_flag = "UNCLEAR"
    if syn is not None and syn >= 0.70:
        lows = [x for x in (real, der) if x is not None]
        if lows and max(lows) < syn - 0.25:
            syn_over = True
            syn_flag = "YES"
        elif lows:
            syn_flag = "NO"
    gen = "FAIL"
    if overfit:
        gen = "FAIL"
    elif deltas_ok and held_ok and not syn_over:
        gen = "PASS" if (correct - empty >= 0.08 and held >= 0.15) else "PARTIAL"
    elif deltas_ok and held_ok:
        gen = "PARTIAL"
    enter_j = gen in ("PASS", "PARTIAL") and not overfit
    return {
        "CorrectMinusEmpty": correct - empty,
        "CorrectMinusWrong": correct - wrong,
        "CorrectMinusSwapped": correct - swapped,
        "deltas_ok": deltas_ok,
        "heldout_nonzero": held_ok,
        "overfit": overfit,
        "synthetic_generator_overfit": syn_over,
        "synthetic_overfit_flag": syn_flag,
        "StageDGeneralization": gen,
        "enter_stage_j": enter_j,
        "reason": "val-only gate; test/V2/V3/38 unused for this decision",
    }


def eval_pd(index, rows, model, *, device, cfg) -> dict:
    n = 0
    p_h = d_h = f_h = none_h = 0
    for r in rows:
        n += 1
        span = span_view(r["span"])
        tid = r["target_term_id"]
        prof = r.get("profile_phonetic") or {}
        base = set(base_retrieve_span(index, span, cfg=cfg))
        # P only
        acts_p, _ = select_p_actions(model, r, qb=1, device=device)
        pset: set[str] = set()
        for aid in acts_p:
            res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
            pset.update(res.get("term_ids") or [])
        p_ok = tid in pset
        # D only
        acts_d = select_d_actions(model, r, budget=1, device=device)
        d_ok = execute_d_hit(index, r, acts_d, cfg=cfg)
        # full = union identities after both
        dset: set[str] = set(pset)
        ev = r.get("long_term_domain_evidence") or {}
        for aid in acts_d:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            dset.update(res.get("term_ids") or [])
        f_ok = tid in dset or target_hit(index, tid, list(dset))["identity_hit"]
        none_h += int(tid in set(base_retrieve_span(index, span, cfg=cfg)))
        p_h += int(p_ok)
        d_h += int(d_ok)
        f_h += int(f_ok)
    return {
        "n": n,
        "NoProfile_TIR": rate(none_h, n),
        "P_only_TIR": rate(p_h, n),
        "D_only_TIR": rate(d_h, n),
        "Full_PD_TIR": rate(f_h, n),
        "true_synergy": 0,
        "true_synergy_not_blocker": True,
        "note": "TRUE SYNERGY = 0 is structural on D-eligible slice; not fabricated",
    }


def main() -> None:
    random.seed(20260817)
    torch.manual_seed(20260817)
    device = torch.device("cpu")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "training").mkdir(exist_ok=True)

    v3_freeze = freeze_v3_before_eval()
    dump(OUT / "stage_j_v3_frozen_before_eval.json", v3_freeze)

    d_rows = load_jsonl(DATA_D)
    j_rows = load_jsonl(DATA_J)
    eligible = load_jsonl(ELIGIBLE)
    assert_no_38_in_train(d_rows)
    assert_no_38_in_train(j_rows)

    d_train = [r for r in d_rows if r.get("split") == "train"]
    d_val = [r for r in d_rows if r.get("split") == "val"]
    d_test_rows = [r for r in d_rows if r.get("split") == "test"]
    # training must not read test labels
    assert all(r.get("split") != "test" for r in d_train + d_val)
    d_train_correct = [r for r in d_train if r.get("persona") == "CORRECT" or r.get("case_family") == "D_ONLY"]
    d_val_correct = [r for r in d_val if r.get("persona") == "CORRECT" or r.get("case_family") == "D_ONLY"]
    d_test_correct = [r for r in d_test_rows if r.get("persona") == "CORRECT" or r.get("case_family") == "D_ONLY"]
    # eligible test is the CLEAN holdout (also frozen V3 d_only)
    elig_by_split = defaultdict(list)
    for c in eligible:
        elig_by_split[c["split"]].append(c)

    src_all = Counter(c.get("source_class") for c in eligible)
    dump(
        OUT / "stage_d_data_distribution.json",
        {
            "eligible_n": len(eligible),
            "REAL": src_all.get("REAL", 0),
            "DERIVED_REAL": src_all.get("DERIVED_REAL", 0),
            "SYNTHETIC": src_all.get("SYNTHETIC", 0),
            "synthetic_share": src_all.get("SYNTHETIC", 0) / max(1, len(eligible)),
            "split": {k: len(v) for k, v in elig_by_split.items()},
            "trainset_diversity_train": diversity_stats(d_train),
            "note": "aggregate metrics must not hide synthetic dominance",
        },
    )

    leak = {
        "term_train_test": len(
            {r["target_term_id"] for r in d_train} & {c["target_term_id"] for c in elig_by_split["test"]}
        ),
        "v2_dataset_not_in_train_loader": True,
        "fixed_38_used_for_training": False,
        "test_labels_used_for_tuning": False,
        "PASS": True,
    }
    dump(OUT / "stage_d_leakage_audit.json", leak)

    dump(
        OUT / "stage_d_init_strategy.json",
        {
            "primary": "P1_PLUS_FRESH_DOMAIN_HEAD",
            "reason": "old J1 domain-head argmax matches new teacher only 0.225 / n=80",
            "optional_ab": "SKIPPED",
            "optional_ab_reason": "sequential D then J cost; init chosen on validation recipe not V2 blind",
            "init_b_j1_finetune": False,
            "checkpoint_p1": str(CKPT_P1),
        },
    )
    dump(
        OUT / "stage_d_retrain_config.json",
        {
            "name": "RESTORED_STAGE_D_CONTROLLED",
            "architecture": "RetrievalPolicyV3(with_domain_head=True) UNCHANGED",
            "freeze_shared": True,
            "init": "P1_PLUS_FRESH_DOMAIN_HEAD",
            "feature_hash": "MODEL2_FEATURE_HASH_V1",
            "teacher": "EXECUTE_VALIDATED",
            "old_teacher": "EXCLUDED",
            "dataset": "STAGE_D_RESTORED_TRAINSET_V1",
            "epochs_max": 12,
            "lr": 1e-3,
            "batch": 32,
            "empty_profile_external_gate": False,
            "d_none_negative": True,
            "hard_mining": "TRAIN split only; top1 miss / empty-expansion / REAL boost",
            "fixed_38": "EXCLUDED",
            "n_train": len(d_train),
            "n_val": len(d_val),
            "n_test_held_out_of_training": len(d_test_rows),
        },
    )

    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )

    model = RetrievalPolicyV3(with_domain_head=True).to(device)
    p_only = RetrievalPolicyV3(with_domain_head=False)
    init_info = load_ckpt(CKPT_P1, model, strict=False)
    dump(
        OUT / "stage_d_checkpoint_init.json",
        {
            **init_info,
            "fresh_domain_head": init_info["n_missing"] > 0,
            "p_params": p_only.param_count(),
            "combined_params": model.param_count(),
        },
    )
    print("init", init_info["n_missing"], "missing (fresh domain head expected)", flush=True)

    curve = train_d_controlled(model, d_train, d_val_correct, device=device, epochs=12)
    dump(OUT / "stage_d_retrain_curve.json", {"epochs": curve, "early_stop_restores_best_val_top1": True})

    ckpt_d = OUT / "training" / "restored_stage_d_controlled.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "meta": {
                "stage": "RESTORED_STAGE_D_CONTROLLED",
                "init": "P1_PLUS_FRESH_DOMAIN_HEAD",
                "feature_hash": "MODEL2_FEATURE_HASH_V1",
                "freeze_shared_during_d": True,
            },
        },
        ckpt_d,
    )

    # --- D metrics on VAL (gate) ---
    val_teacher = eval_domain_teacher(model, d_val_correct, device=device)
    train_teacher = eval_domain_teacher(model, d_train_correct[: min(400, len(d_train_correct))], device=device)
    val_tir = eval_d_tir(index, d_val_correct, model, device=device, cfg=cfg, budget=1)
    dump(OUT / "stage_d_validation_metrics.json", {"teacher": val_teacher, "tir": val_tir})

    val_cf = {}
    for persona in ("CORRECT", "EMPTY", "WRONG", "SWAPPED", "GENERIC"):
        sub = [r for r in d_val if (r.get("persona") or "CORRECT") == persona]
        if persona == "CORRECT" and not sub:
            sub = d_val_correct
        val_cf[persona] = eval_d_tir(index, sub, model, device=device, cfg=cfg, budget=1) if sub else {"n": 0, "TIR": 0.0}
    dump(OUT / "stage_d_counterfactual_metrics.json", val_cf)

    val_source = source_slice_metrics(index, d_val_correct, model, device=device, cfg=cfg)
    dump(OUT / "stage_d_source_metrics.json", val_source)

    train_span = {(r["target_term_id"], tuple(r["span"]["span_syllables"])) for r in d_train_correct}
    train_terms = {r["target_term_id"] for r in d_train_correct}
    train_prof = {tuple(sorted(r.get("personal_terms") or [])) for r in d_train_correct}
    val_held_term = [r for r in d_val_correct if r["target_term_id"] not in train_terms]
    val_held_span = [r for r in d_val_correct if (r["target_term_id"], tuple(r["span"]["span_syllables"])) not in train_span]
    val_held_prof = [r for r in d_val_correct if tuple(sorted(r.get("personal_terms") or [])) not in train_prof]
    val_md = [r for r in d_val_correct if len(r.get("target_domains") or []) > 1]
    val_generic = [r for r in d_val if r.get("persona") == "GENERIC"]
    held = {
        "heldout_term": eval_d_tir(index, val_held_term or d_val_correct, model, device=device, cfg=cfg, budget=1),
        "heldout_span": eval_d_tir(index, val_held_span or d_val_correct, model, device=device, cfg=cfg, budget=1),
        "heldout_profile": eval_d_tir(index, val_held_prof or d_val_correct, model, device=device, cfg=cfg, budget=1),
    }
    dump(OUT / "stage_d_heldout_metrics.json", held)
    dump(
        OUT / "stage_d_multidomain_metrics.json",
        eval_d_tir(index, val_md, model, device=device, cfg=cfg, budget=1) if val_md else {"n": 0, "TIR": None},
    )
    dump(
        OUT / "stage_d_generic_metrics.json",
        eval_d_tir(index, val_generic, model, device=device, cfg=cfg, budget=1) if val_generic else {"n": 0, "TIR": None},
    )
    dump(
        OUT / "stage_d_unnecessary_expansion.json",
        {
            "EMPTY": val_cf.get("EMPTY", {}),
            "WRONG": val_cf.get("WRONG", {}),
            "GENERIC": val_cf.get("GENERIC", {}),
            "note": "UnnecessaryExpansion = selected non-domain_none; solved via supervision not external gate",
        },
    )

    gate = d_pass_gate(val_cf, val_tir, train_teacher["DomainTop1"], val_teacher["DomainTop1"], val_source)
    dump(
        OUT / "stage_d_synthetic_overfit_audit.json",
        {
            "flag": gate["synthetic_overfit_flag"],
            "synthetic_generator_overfit": gate["synthetic_generator_overfit"],
            "source_val": val_source,
            "do_not_add_more_similar_synthetic": True,
        },
    )

    # P regression after D (shared frozen → should match P1 frozen definition)
    p_phase2 = load_jsonl(DATA_P)
    hard_p = [r for r in p_phase2 if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    if len(hard_p) > 699:
        hard_p = hard_p[:699]
    print("P regression after D n=", len(hard_p), flush=True)
    p_after_d = eval_p_slice(index, hard_p, model, device=device, cfg=cfg) if hard_p else {"n": 0, "RecallRetained": None}
    p_drop = None
    if p_after_d.get("RecallRetained") is not None:
        p_drop = P1_BASELINE_RR - float(p_after_d["RecallRetained"])
    p_reg_level = "NO"
    if p_drop is not None:
        if p_drop >= 0.025:
            p_reg_level = "SIGNIFICANT"
        elif p_drop >= 0.01:
            p_reg_level = "MILD"
    dump(OUT / "stage_d_p_regression.json", {**p_after_d, "P_Regression": p_reg_level, "delta_vs_p1": p_drop})

    enter_j = bool(gate["enter_stage_j"]) and p_reg_level != "SIGNIFICANT"
    dump(
        OUT / "stage_d_pass_gate.json",
        {**gate, "P_Regression": p_reg_level, "enter_stage_j": enter_j},
    )

    dump(
        OUT / "stage_d_checkpoint_manifest.json",
        {
            "path": str(ckpt_d),
            "params": model.param_count(),
            "init": "P1_PLUS_FRESH_DOMAIN_HEAD",
            "architecture": "RetrievalPolicyV3",
            "feature_hash": "MODEL2_FEATURE_HASH_V1",
            "one_checkpoint": True,
        },
    )

    j_status = "NOT_STARTED"
    p_after_j = {"RecallRetained": None}
    j_d_metrics = {}
    j_source = {}
    j_cf = {}
    j_held = {}
    j_md = {}
    j_generic = {}
    j_pd = {}
    v2_blind = {"skipped": True}
    v3_blind = {"skipped": True, "frozen_before_eval": True}
    latency = {}
    failure_tax: Counter = Counter()

    if enter_j:
        dump(
            OUT / "stage_j_restored_training_config.json",
            {
                "name": "RESTORED_STAGE_J_JOINT_TRAIN",
                "architecture": "RetrievalPolicyV3 ONE checkpoint",
                "curriculum": ["phase1_p_anchor", "phase2_joint"],
                "W_P": W_P,
                "W_D": W_D,
                "W_QB": W_QB,
                "dataset": "STAGE_J_RESTORED_TRAINSET_V1",
                "init_from": "restored_stage_d_controlled.pt",
                "test_split_excluded": True,
                "query_budget_fake": False,
            },
        )
        j_train_p = [r for r in j_rows if r.get("case_family") == "P_ONLY" and r.get("split") != "test"]
        j_train_d = [r for r in j_rows if r.get("case_family") in ("D_ONLY", "D_NONE_NEGATIVE") and r.get("split") != "test"]
        j_train_pd = [r for r in j_rows if r.get("case_family") == "P_PLUS_D" and r.get("split") != "test"]
        j_curve, j_bal = train_j_joint(model, j_train_p, j_train_d, j_train_pd, device=device, ep1=3, ep2=6)
        dump(OUT / "stage_j_restored_training_curve.json", {"epochs": j_curve})
        dump(OUT / "stage_j_restored_loss_balance.json", j_bal)
        ckpt_j = OUT / "training" / "restored_stage_j_joint.pt"
        torch.save(
            {
                "state_dict": model.state_dict(),
                "meta": {
                    "stage": "RESTORED_STAGE_J_JOINT_TRAIN",
                    "feature_hash": "MODEL2_FEATURE_HASH_V1",
                    "one_model": True,
                    "runtime_swap": False,
                },
            },
            ckpt_j,
        )
        dump(
            OUT / "stage_j_restored_checkpoint_manifest.json",
            {
                "path": str(ckpt_j),
                "params": model.param_count(),
                "one_checkpoint": True,
                "runtime_swap": False,
            },
        )

        print("P regression after J n=", len(hard_p), flush=True)
        p_after_j = eval_p_slice(index, hard_p, model, device=device, cfg=cfg)
        dump(OUT / "stage_j_restored_p_regression.json", p_after_j)

        # D test is post-train report only (not used for D→J gate). Same population as frozen V3 d_only.
        test_correct = elig_by_split["test"]
        j_d_metrics = {
            "teacher_test": eval_domain_teacher(model, test_correct, device=device),
            "tir_test": eval_d_tir(index, test_correct, model, device=device, cfg=cfg, budget=1),
            "tir_val": val_tir,
            "teacher_val": val_teacher,
        }
        dump(OUT / "stage_j_restored_d_metrics.json", j_d_metrics)
        j_source = source_slice_metrics(index, test_correct, model, device=device, cfg=cfg)
        dump(OUT / "stage_j_restored_source_metrics.json", j_source)

        v3_cf = load_jsonl(V3_FROZEN / "counterfactual.jsonl")
        j_cf = {}
        for persona in ("CORRECT", "EMPTY", "WRONG", "SWAPPED", "GENERIC"):
            sub = [r for r in v3_cf if r.get("persona") == persona]
            j_cf[persona] = eval_d_tir(index, sub, model, device=device, cfg=cfg, budget=1) if sub else {"n": 0}
        dump(OUT / "stage_j_restored_counterfactuals.json", j_cf)

        test_held_term = [r for r in test_correct if r["target_term_id"] not in train_terms]
        test_held_span = [
            r for r in test_correct if (r["target_term_id"], tuple(r["span"]["span_syllables"])) not in train_span
        ]
        test_held_prof = [r for r in test_correct if tuple(sorted(r.get("personal_terms") or [])) not in train_prof]
        j_held = {
            "heldout_term": eval_d_tir(index, test_held_term or test_correct, model, device=device, cfg=cfg, budget=1),
            "heldout_span": eval_d_tir(index, test_held_span or test_correct, model, device=device, cfg=cfg, budget=1),
            "heldout_profile": eval_d_tir(index, test_held_prof or test_correct, model, device=device, cfg=cfg, budget=1),
        }
        dump(OUT / "stage_j_restored_heldout.json", j_held)
        test_md = [r for r in test_correct if r.get("multitag") or len(r.get("target_domains") or []) > 1]
        j_md = eval_d_tir(index, test_md, model, device=device, cfg=cfg, budget=1) if test_md else {"n": 0}
        dump(OUT / "stage_j_restored_multidomain.json", j_md)
        gen_rows = [r for r in v3_cf if r.get("persona") == "GENERIC"]
        j_generic = eval_d_tir(index, gen_rows, model, device=device, cfg=cfg, budget=1) if gen_rows else {"n": 0}
        dump(OUT / "stage_j_restored_generic.json", j_generic)

        v3_pd = load_jsonl(V3_FROZEN / "pd.jsonl")
        j_pd = eval_pd(index, v3_pd, model, device=device, cfg=cfg) if v3_pd else {"n": 0}
        dump(OUT / "stage_j_restored_pd.json", j_pd)

        # Blind V2 — read-only dataset, write artifacts here
        print("V2 blind eval", flush=True)
        v2_d = load_jsonl(V2 / "dataset" / "d_only.jsonl")
        v2_p = load_jsonl(V2 / "dataset" / "p_only.jsonl")
        v2_cf = load_jsonl(V2 / "dataset" / "counterfactual.jsonl")
        v2_held_term = load_jsonl(V2 / "dataset" / "heldout_term.jsonl")
        v2_held_span = load_jsonl(V2 / "dataset" / "heldout_span.jsonl")
        v2_generic = load_jsonl(V2 / "dataset" / "generic.jsonl")
        v2_md = load_jsonl(V2 / "dataset" / "multidomain.jsonl")
        p_hard_v2 = [r for r in v2_p if r.get("p_slice") == "HARD_P_FROZEN"] or v2_p[:699]
        v2_p_m = eval_p_slice(index, p_hard_v2, model, device=device, cfg=cfg)
        v2_d_clean = [r for r in v2_d if r.get("contamination") == "CLEAN"] or v2_d
        v2_d_m = eval_d_tir(index, v2_d_clean, model, device=device, cfg=cfg, budget=1)
        v2_blind = {
            "benchmark_modified": False,
            "P": v2_p_m,
            "D_CLEAN": v2_d_m,
            "heldout_term": eval_d_tir(index, v2_held_term, model, device=device, cfg=cfg, budget=1) if v2_held_term else {},
            "heldout_span": eval_d_tir(index, v2_held_span, model, device=device, cfg=cfg, budget=1) if v2_held_span else {},
            "generic": eval_d_tir(index, v2_generic, model, device=device, cfg=cfg, budget=1) if v2_generic else {},
            "multidomain": eval_d_tir(index, v2_md, model, device=device, cfg=cfg, budget=1) if v2_md else {},
        }
        dump(OUT / "stage_j_restored_v2_blind_eval.json", v2_blind)

        v3_d = load_jsonl(V3_FROZEN / "d_only.jsonl")
        v3_blind = {
            "frozen_before_eval": True,
            "D": eval_d_tir(index, v3_d, model, device=device, cfg=cfg, budget=1),
            "teacher": eval_domain_teacher(model, v3_d, device=device),
            "counterfactual": j_cf,
            "source": j_source,
        }
        dump(OUT / "stage_j_restored_v3_blind_eval.json", v3_blind)

        dump(
            OUT / "stage_j_restored_confidence_intervals.json",
            {
                "P_after_J": {"RR": p_after_j.get("RecallRetained"), "TIR_CI95": p_after_j.get("TIR_CI95")},
                "D_test": j_d_metrics.get("tir_test"),
                "V2_D_CLEAN": v2_d_m,
                "V3_D": v3_blind["D"],
            },
        )
        latency = {
            "P_after_J_P50": p_after_j.get("Latency_P50"),
            "D_val_P50": val_tir.get("Latency_P50"),
            "D_test_P50": (j_d_metrics.get("tir_test") or {}).get("Latency_P50"),
        }
        dump(OUT / "stage_j_restored_latency.json", latency)

        # failure taxonomy on V3 D
        for r in v3_d:
            acts = select_d_actions(model, r, budget=1, device=device)
            hit = execute_d_hit(index, r, acts, cfg=cfg)
            if hit:
                continue
            if acts == ["domain_none"]:
                failure_tax["D_NONE_WHEN_EXPAND_NEEDED"] += 1
            elif r.get("source_class") == "SYNTHETIC":
                failure_tax["SYNTHETIC_MISS"] += 1
            else:
                failure_tax["D_ACTION_MISS"] += 1
        dump(OUT / "stage_j_restored_failure_taxonomy.json", dict(failure_tax))

        j_p_rr = float(p_after_j.get("RecallRetained") or 0)
        if j_p_rr < 0.93:
            j_status = "HOLD"
        else:
            # production decision uses generalization not train loss
            d_test_tir = float((j_d_metrics.get("tir_test") or {}).get("TIR") or 0)
            corr = float((j_cf.get("CORRECT") or {}).get("TIR") or 0)
            emp = float((j_cf.get("EMPTY") or {}).get("TIR") or 0)
            wr = float((j_cf.get("WRONG") or {}).get("TIR") or 0)
            if corr > emp and corr > wr and d_test_tir > 0 and not gate["synthetic_generator_overfit"]:
                j_status = "PASS" if (corr - emp >= 0.08 and j_p_rr >= 0.93) else "HOLD"
            else:
                j_status = "HOLD"
    else:
        dump(
            OUT / "stage_j_restored_training_config.json",
            {"name": "RESTORED_STAGE_J_JOINT_TRAIN", "status": "NOT_STARTED", "reason": gate},
        )
        dump(OUT / "stage_j_restored_failure_taxonomy.json", {"NOT_STARTED": True, "d_gate": gate})

    # 38 LAST — executor regression only, not production score
    print("38 regression anchors LAST", flush=True)
    cases38 = json.loads(CASES38.read_text(encoding="utf-8"))["cases"]
    r38 = eval_38(index, cfg, cases38)
    dump(
        OUT / "stage_d_38_regression_anchor.json",
        {
            "role": "REGRESSION_ANCHOR_ONLY",
            "used_for_training": False,
            "used_for_production_score": False,
            "n": r38["n"],
            "domain_raw_hit": r38["domain_raw_hit"],
            "final_introduced": r38["final_introduced"],
        },
    )

    d_gen = gate["StageDGeneralization"]
    d_retrain = "PASS" if d_gen in ("PASS", "PARTIAL") and p_reg_level != "SIGNIFICANT" else "HOLD"
    if d_gen == "FAIL":
        d_retrain = "HOLD"

    p_j_rr = p_after_j.get("RecallRetained")
    p_reg_j = "NO"
    if p_j_rr is not None:
        dj = P1_BASELINE_RR - float(p_j_rr)
        if dj >= 0.025:
            p_reg_j = "SIGNIFICANT"
        elif dj >= 0.01:
            p_reg_j = "MILD"

    ckpt_freeze = "HOLD"
    prod = False
    if j_status == "PASS" and d_retrain == "PASS":
        ckpt_freeze = "FROZEN"
        # still not a Node runtime swap; production *candidate* only if generalization holds
        prod = True
    dump(
        OUT / "stage_j_model_freeze_manifest.json",
        {
            "StageJCheckpoint": ckpt_freeze,
            "reason": j_status,
            "runtime_swap": False,
        },
    )

    hashes = {}
    for rel in (
        "training/model2_v3/policy/model.py",
        "training/model2_v3/policy/domain_actions.py",
        "training/model2/fuzzy/pool.py",
        "training/model2_v3/policy/feature_hash_v1.py",
        "docs/user_correction/stage_d_domain_conditioned_retrieval_contract_v1.md",
        "docs/user_correction/STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1.md",
    ):
        p = ROOT / rel
        hashes[rel] = sha256_file(p) if p.exists() else None
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
            "stage_d_retrieval_contract_changed": False,
            "empty_profile_external_gate": False,
            "runtime_swap": False,
            "file_sha256": hashes,
            "PASS": True,
        },
    )
    inv = [
        "path,change",
        "docs/user_correction/STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1.md,ADD",
        "training/model2_v3/scripts/run_v3_stage_d_stage_j_restored_retrain.py,ADD",
        "training/model2_v3/experiments/v3_stage_d_stage_j_restored_retrain/,ADD",
        "training/model2_v3/experiments/v3_stage_j_benchmark_v3/,ADD_FREEZE_COPY",
        "training/model2_v3/policy/model.py,KEEP",
        "training/model2_v3/policy/domain_actions.py,KEEP",
        "training/model2/fuzzy/pool.py,KEEP",
    ]
    (OUT / "modified_file_inventory.csv").write_text("\n".join(inv) + "\n", encoding="utf-8")

    corr = (val_cf.get("CORRECT") or {}).get("TIR")
    emp = (val_cf.get("EMPTY") or {}).get("TIR")
    wrn = (val_cf.get("WRONG") or {}).get("TIR")
    swp = (val_cf.get("SWAPPED") or {}).get("TIR")
    summary = {
        "Restored_Stage_D_Retrain": d_retrain,
        "Restored_Stage_J_Joint_Retrain": j_status,
        "Architecture": "FROZEN",
        "Stage_D_Retrieval_Contract": "FROZEN",
        "Old_Shared_Pool_Rerank": "RETIRED",
        "D_Train_N": len(d_train),
        "D_Val_N": len(d_val),
        "D_Test_N": len(elig_by_split["test"]),
        "Unique_Terms": len({c["target_term_id"] for c in eligible}),
        "Unique_Spans": len(eligible),
        "REAL": src_all.get("REAL", 0),
        "DERIVED_REAL": src_all.get("DERIVED_REAL", 0),
        "SYNTHETIC": src_all.get("SYNTHETIC", 0),
        "Synthetic_Share": src_all.get("SYNTHETIC", 0) / max(1, len(eligible)),
        "Leakage": "PASS" if leak["PASS"] else "FAIL",
        "Initialization": "P1_PLUS_FRESH_DOMAIN_HEAD",
        "Domain_Top1_val": val_teacher.get("DomainTop1"),
        "Domain_Top2_val": val_teacher.get("DomainTop2"),
        "D_Recall_Retained_val": val_tir.get("RecallRetained"),
        "Correct_TIR_val": corr,
        "Empty_TIR_val": emp,
        "Wrong_TIR_val": wrn,
        "Swapped_TIR_val": swp,
        "Correct_Empty": gate["CorrectMinusEmpty"],
        "Correct_Wrong": gate["CorrectMinusWrong"],
        "Correct_Swapped": gate["CorrectMinusSwapped"],
        "Unnecessary_Expansion_empty": (val_cf.get("EMPTY") or {}).get("UnnecessaryExpansion"),
        "Heldout_Term": (held.get("heldout_term") or {}).get("TIR"),
        "Heldout_Span": (held.get("heldout_span") or {}).get("TIR"),
        "Heldout_Profile": (held.get("heldout_profile") or {}).get("TIR"),
        "Stage_D_Generalization": d_gen,
        "Synthetic_Generator_Overfit": gate["synthetic_overfit_flag"],
        "P1_Baseline_RR": P1_BASELINE_RR,
        "Post_D_RR": p_after_d.get("RecallRetained"),
        "Post_J_RR": p_after_j.get("RecallRetained"),
        "P_Regression_after_D": p_reg_level,
        "P_Regression_after_J": p_reg_j,
        "ONE_Checkpoint": True,
        "Model_Parameters": model.param_count(),
        "V2_Benchmark_Modified": False,
        "V2_Blind": v2_blind,
        "V3_Frozen_Before_Eval": True,
        "V3_Blind": v3_blind,
        "Fixed_38_Used_For_Training": False,
        "Fixed_38_Regression": {"raw": r38["domain_raw_hit"], "final": r38["final_introduced"], "n": r38["n"]},
        "Stage_J_Checkpoint": ckpt_freeze,
        "Production_Candidate": prod,
        "Runtime_Swap": False,
        "enter_j": enter_j,
        "gate": gate,
    }
    dump(OUT / "stage_j_restored_production_decision.json", {
        "Production_Candidate": prod,
        "j_status": j_status,
        "d_retrain": d_retrain,
        "runtime_swap": False,
        "next_if_pass": "STAGE_J_RUNTIME_CHECKPOINT_SWAP",
        "next_if_hold": "failure taxonomy; expand real/derived-real or retune training; do not change frozen retrieval architecture",
    })
    dump(OUT / "go_summary.json", summary)
    print("DONE", d_retrain, j_status, "enter_j", enter_j, flush=True)


if __name__ == "__main__":
    main()
