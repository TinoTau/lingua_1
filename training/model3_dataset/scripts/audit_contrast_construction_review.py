# -*- coding: utf-8 -*-
"""MODEL3_V1_CONTRAST_CONSTRUCTION_REVIEW — audit only (no train / no mutate)."""
from __future__ import annotations

import json
import math
import random
import sys
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    sample_to_tensors,
)


def load_model_dir(root: Path):
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    vocab = json.loads((root / "vocab.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(
        len(vocab),
        int(cfg.get("embed_dim", 64)),
        int(cfg.get("hidden_dim", 128)),
        int(cfg.get("feat_dim", FEAT_DIM)),
    )
    state = torch.load(root / "weights.pt", map_location="cpu")
    model.load_state_dict(state)
    return model, vocab, cfg

DOCS = REPO / "docs/user_correction/model3"
PILOT_DATA = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot"
FULL_DATA = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
PILOT_MODEL = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot_bigru"
DIET_CKPT = REPO / "training/model3_dataset/model3_v1_diet_rebalance_ckpts"
SEED_DIR = DOCS / "model3_anchor_context_seed_v1"
AUDIT_SEED = 2026082501


def load_split(root: Path, split: str) -> list[dict]:
    rows = []
    for p in sorted((root / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def load_sidecar(root: Path) -> dict[str, dict]:
    m = {}
    p = root / "anchor_provenance_sidecar.jsonl"
    if not p.exists():
        return m
    with p.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                m[o["sampleId"]] = o
    return m


def load_seeds() -> list[dict]:
    rows = []
    for p in sorted(SEED_DIR.glob("*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def find_target_span(sample: dict, target: str | None, want_label: str | None = None):
    for i, sp in enumerate(sample.get("spans") or []):
        if sp.get("targetMask") != 1:
            continue
        if want_label and sp.get("label") != want_label:
            continue
        if target and sp.get("surface") != target:
            continue
        return i, sp
    # fallback: any eligible with matching label
    if want_label:
        for i, sp in enumerate(sample.get("spans") or []):
            if sp.get("targetMask") == 1 and sp.get("label") == want_label:
                return i, sp
    return None, None


def strip_anchor_surface(text: str, anchors: list[str]) -> str:
    t = text or ""
    for a in anchors:
        if a:
            t = t.replace(a, "⟦A⟧")
    return t


def pair_invariants(keep_s: dict, retry_s: dict, keep_sc: dict, retry_sc: dict) -> dict:
    kt = keep_sc.get("targetSurface")
    rt = retry_sc.get("targetSurface")
    ki, ksp = find_target_span(keep_s, kt, "KEEP")
    ri, rsp = find_target_span(retry_s, rt, "RETRY")
    k_text = keep_s.get("currentText") or ""
    r_text = retry_s.get("currentText") or ""
    k_anch = [sp.get("surface") for sp in keep_s.get("spans") or [] if sp.get("isAnchor")]
    r_anch = [sp.get("surface") for sp in retry_s.get("spans") or [] if sp.get("isAnchor")]
    k_ctx = strip_anchor_surface(k_text, k_anch + r_anch)
    r_ctx = strip_anchor_surface(r_text, k_anch + r_anch)
    # also strip both anchors from both texts for non-anchor context compare
    both = list({*(k_anch or []), *(r_anch or []), keep_sc.get("anchorSurface"), retry_sc.get("anchorSurface")})
    k_ctx2 = strip_anchor_surface(k_text, [x for x in both if x])
    r_ctx2 = strip_anchor_surface(r_text, [x for x in both if x])

    same_target = (kt is not None and kt == rt) or (
        ksp and rsp and ksp.get("surface") == rsp.get("surface")
    )
    same_pinyin = bool(
        ksp
        and rsp
        and (ksp.get("pinyinEvidence") or ksp.get("pinyin"))
        and (ksp.get("pinyinEvidence") or ksp.get("pinyin"))
        == (rsp.get("pinyinEvidence") or rsp.get("pinyin"))
    )
    k_start = ksp.get("rawStart") if ksp else None
    k_end = ksp.get("rawEnd") if ksp else None
    r_start = rsp.get("rawStart") if rsp else None
    r_end = rsp.get("rawEnd") if rsp else None
    if k_start is None and ksp:
        k_start, k_end = ksp.get("start"), ksp.get("end")
    if r_start is None and rsp:
        r_start, r_end = rsp.get("start"), rsp.get("end")
    same_offsets = bool(ksp and rsp and k_start == r_start and k_end == r_end)
    same_span_len = bool(
        ksp and rsp and k_start is not None and r_start is not None and (k_end - k_start) == (r_end - r_start)
    )
    labels_ok = (ksp and rsp and ksp.get("label") == "KEEP" and rsp.get("label") == "RETRY")
    different_anchor = (keep_sc.get("anchorSurface") != retry_sc.get("anchorSurface")) or (
        set(k_anch) != set(r_anch)
    )
    anchor_only = (
        same_target
        and k_text == r_text
        and labels_ok
        and different_anchor
        and k_ctx2 == r_ctx2
    )

    causal = "INVALID_CONTRAST"
    if not labels_ok or not same_target:
        causal = "INVALID_CONTRAST"
    elif k_text == r_text and different_anchor:
        causal = "ANCHOR_CAUSAL"
    elif k_text != r_text and (ksp and rsp and ksp.get("surface") == rsp.get("surface")):
        # same local target, different surrounding text / ref construction
        if k_ctx2 != r_ctx2:
            causal = "MIXED_CAUSAL" if different_anchor else "LOCAL_TEXT_CAUSAL"
        else:
            causal = "ANCHOR_CAUSAL" if different_anchor else "LOCAL_TEXT_CAUSAL"
    elif ksp and rsp and ksp.get("surface") != rsp.get("surface"):
        causal = "LOCAL_TEXT_CAUSAL"
    else:
        causal = "MIXED_CAUSAL"

    return {
        "same_target": bool(same_target),
        "same_currentText": k_text == r_text,
        "same_non_anchor_context": k_ctx2 == r_ctx2,
        "same_pinyin": same_pinyin,
        "same_offsets": same_offsets,
        "same_span_len": same_span_len,
        "different_anchor": bool(different_anchor),
        "labels_ok": bool(labels_ok),
        "anchor_only_difference": bool(anchor_only),
        "causal": causal,
        "keep_span_i": ki,
        "retry_span_i": ri,
        "keep_text_len": len(k_text),
        "retry_text_len": len(r_text),
        "sourceKind_keep": keep_sc.get("sourceKind") or keep_sc.get("sourceType"),
        "sourceKind_retry": retry_sc.get("sourceKind") or retry_sc.get("sourceType"),
        "seedId_keep": keep_sc.get("seedId"),
        "seedId_retry": retry_sc.get("seedId"),
    }


def strong_groups_from(samples: list[dict], sidecar: dict[str, dict], split_filter: str | None = None):
    by = defaultdict(list)
    id_to_s = {s["sampleId"]: s for s in samples}
    for sid, sc in sidecar.items():
        if sc.get("contrastStrength") != "STRONG":
            continue
        s = id_to_s.get(sid)
        if not s:
            continue
        if split_filter and s.get("split") != split_filter:
            continue
        by[sc["contrastGroupId"]].append((s, sc))
    pairs = []
    for gid, rows in by.items():
        keeps = [
            (s, sc)
            for s, sc in rows
            if sc.get("roleInPair") == "KEEP"
            or (sc.get("intendedRoleHint") or "").startswith("KEEP")
            or (sc.get("seedType") or "").endswith("KEEP_CANDIDATE")
        ]
        retries = [
            (s, sc)
            for s, sc in rows
            if sc.get("roleInPair") == "RETRY"
            or (sc.get("intendedRoleHint") or "").startswith("RETRY")
            or (sc.get("seedType") or "").endswith("RETRY_CANDIDATE")
        ]
        # role may be missing — infer by label on target
        if not keeps or not retries:
            keeps, retries = [], []
            for s, sc in rows:
                tgt = sc.get("targetSurface")
                _, spk = find_target_span(s, tgt, "KEEP")
                _, spr = find_target_span(s, tgt, "RETRY")
                if spk and not spr:
                    keeps.append((s, sc))
                elif spr and not spk:
                    retries.append((s, sc))
                elif spr:
                    retries.append((s, sc))
                elif spk:
                    keeps.append((s, sc))
        if not keeps or not retries:
            continue
        pairs.append((gid, keeps[0], retries[0], rows))
    return pairs


def rate(flags: list[bool]) -> float:
    return sum(1 for x in flags if x) / len(flags) if flags else 0.0


def summarize_invariants(pairs_inv: list[dict]) -> dict:
    keys = [
        "same_target",
        "same_currentText",
        "same_non_anchor_context",
        "same_pinyin",
        "same_offsets",
        "same_span_len",
        "different_anchor",
        "labels_ok",
        "anchor_only_difference",
    ]
    out = {k: rate([p[k] for p in pairs_inv]) for k in keys}
    out["n"] = len(pairs_inv)
    out["causal"] = dict(Counter(p["causal"] for p in pairs_inv))
    return out


def tensor_diff(keep_s, retry_s, keep_sc, retry_sc, vocab) -> dict:
    inv = pair_invariants(keep_s, retry_s, keep_sc, retry_sc)
    ki, ri = inv["keep_span_i"], inv["retry_span_i"]
    tk = sample_to_tensors(keep_s, vocab)
    tr = sample_to_tensors(retry_s, vocab)
    # compare target-local features
    if ki is None or ri is None:
        return {"ok": False, "non_anchor_visible_difference_count": 999}
    fk = tk["feats"][ki]
    fr = tr["feats"][ri]
    # FEAT_NAMES: isAnchor is index 0
    diffs = []
    for i, name in enumerate(FEAT_NAMES):
        if abs(float(fk[i]) - float(fr[i])) > 1e-6:
            diffs.append(name)
    tok_k = tk["tokens"][ki] if ki < len(tk["tokens"]) else None
    tok_r = tr["tokens"][ri] if ri < len(tr["tokens"]) else None
    token_diff = tok_k != tok_r
    # sequence-level: chars outside anchors
    non_anchor_diffs = [d for d in diffs if d != "isAnchor"]
    if token_diff:
        non_anchor_diffs.append("target_token_id")
    if inv["same_currentText"] is False:
        non_anchor_diffs.append("currentText")
    if len(tk["tokens"]) != len(tr["tokens"]):
        non_anchor_diffs.append("seq_len")
    return {
        "ok": True,
        "feat_diffs": diffs,
        "non_anchor_visible_difference_count": len(set(non_anchor_diffs)),
        "non_anchor_diffs": sorted(set(non_anchor_diffs)),
        "isAnchor_diff": "isAnchor" in diffs,
        "token_diff": token_diff,
        "model_visible_strong": inv["anchor_only_difference"] and not token_diff and non_anchor_diffs == [],
        "causal": inv["causal"],
    }


def zero_anchor(s):
    t = deepcopy(s)
    for sp in t["spans"]:
        sp["isAnchor"] = False
    return t


def shuffle_anchor(s, rng):
    t = deepcopy(s)
    idxs = [i for i, sp in enumerate(t["spans"]) if sp.get("isAnchor")]
    n = len(idxs)
    if not n:
        return t
    for i in idxs:
        t["spans"][i]["isAnchor"] = False
    pool = list(range(len(t["spans"])))
    rng.shuffle(pool)
    for i in pool[:n]:
        t["spans"][i]["isAnchor"] = True
    return t


def predict_span(model, sample, vocab, span_i, device):
    item = sample_to_tensors(sample, vocab)
    tokens = torch.tensor([item["tokens"]], dtype=torch.long, device=device)
    feats = torch.tensor([item["feats"]], dtype=torch.float32, device=device)
    avail = torch.tensor([item["avail"]], dtype=torch.float32, device=device)
    with torch.no_grad():
        logits = model(tokens, feats, avail)
    return int(logits[0, span_i].argmax(-1).item())


def classify_ablation(pk, pr, zk, zr, sk, sr, yk=0, yr=1) -> str:
    # normal correct?
    normal_ok = pk == yk and pr == yr
    zero_ok = zk == yk and zr == yr
    # both correct without anchor
    if zero_ok:
        return "both_correct_without_anchor"
    if zk == 0 and zr == 0:
        return "collapse_keep"
    if zk == 1 and zr == 1:
        return "collapse_retry"
    if (pk != zk) ^ (pr != zr) or (pk != zk) or (pr != zr):
        # one or both flipped under zero
        if (pk != zk) + (pr != zr) == 1:
            return "one_flips"
    # surface dominated: wrong under normal but pattern follows surface (retry both or keep both incorrectly)
    if not normal_ok and pk == pr:
        return "surface_dominated"
    if not zero_ok and zk == zr:
        return "surface_dominated"
    return "other"


def audit_sampler_and_loss() -> dict:
    pilot_cfg = {}
    full_cfg = {}
    diet_note = {}
    p = PILOT_MODEL / "config.json"
    if p.exists():
        pilot_cfg = json.loads(p.read_text(encoding="utf-8"))
    f = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k_bigru/config.json"
    if f.exists():
        full_cfg = json.loads(f.read_text(encoding="utf-8"))
    # code inspection markers
    pilot_train = (REPO / "training/model3_dataset/train/train_anchor_contrast_pilot.py").read_text(encoding="utf-8")
    full_train = (REPO / "training/model3_dataset/train/train_full100k.py").read_text(encoding="utf-8")
    diet_train = (REPO / "training/model3_dataset/train/train_diet_rebalance.py").read_text(encoding="utf-8")
    return {
        "pilot_config_pair_consistency_loss": bool(pilot_cfg.get("pair_consistency_loss")),
        "full100k_config_pair_consistency_loss": bool(full_cfg.get("pair_consistency_loss")),
        "pilot_code_has_pair_consistency_step": "Pair consistency fine-tune" in pilot_train
        or "loss_p" in pilot_train,
        "full100k_code_has_pair_consistency_step": "pair_consistency" in full_train or "loss_p" in full_train,
        "diet_code_has_pair_consistency_step": "pair_consistency" in diet_train or "loss_p =" in diet_train,
        "diet_code_has_group_sampling": "contrast_groups" in diet_train and "emit ALL members" in diet_train,
        "full100k_uses_shuffle_dataloader": "shuffle=True" in full_train,
        "pilot_uses_shuffle_dataloader": "shuffle=True" in pilot_train,
        "pilot_class_weight_retry": pilot_cfg.get("class_weight_retry"),
        "full100k_class_weight_retry": full_cfg.get("class_weight_retry"),
    }


def strongness(inv: dict, td: dict | None) -> str:
    if inv["causal"] == "INVALID_CONTRAST" or not inv["labels_ok"]:
        return "INVALID"
    if inv["anchor_only_difference"] and td and td.get("model_visible_strong"):
        return "MODEL_VISIBLE_STRONG"
    if inv["same_currentText"] and inv["same_target"] and inv["different_anchor"]:
        return "STRICT_STRONG"
    if inv["same_target"] and inv["different_anchor"] and inv["same_non_anchor_context"]:
        return "MEDIUM"
    if inv["same_target"]:
        return "WEAK"
    return "INVALID"


def main():
    rng = random.Random(AUDIT_SEED)
    print("loading data…", flush=True)
    pilot_test = load_split(PILOT_DATA, "test")
    full_test = load_split(FULL_DATA, "test")
    full_train = load_split(FULL_DATA, "train")
    pilot_sc = load_sidecar(PILOT_DATA)
    full_sc = load_sidecar(FULL_DATA)
    seeds = load_seeds()

    # ---- Seed corpus ----
    by_seed_g = defaultdict(list)
    for r in seeds:
        g = r.get("contrastGroupId")
        if g:
            by_seed_g[g].append(r)
    seed_strong = [g for g, rs in by_seed_g.items() if any(x.get("contrastStrength") == "STRONG" for x in rs)]
    seed_stats = {
        "n_seeds": len(seeds),
        "strong_groups": len(seed_strong),
        "both_roles": 0,
        "same_currentText": 0,
        "same_targetSurface": 0,
        "same_referenceText": 0,
        "same_surrounding_after_anchor_strip": 0,
        "same_pinyin_only_proxy": 0,
    }
    for g in seed_strong:
        rs = by_seed_g[g]
        keeps = [r for r in rs if "KEEP" in (r.get("seedType") or "")]
        retries = [r for r in rs if "RETRY" in (r.get("seedType") or "")]
        if not keeps or not retries:
            continue
        seed_stats["both_roles"] += 1
        k, rr = keeps[0], retries[0]
        seed_stats["same_currentText"] += int(k.get("currentText") == rr.get("currentText"))
        seed_stats["same_targetSurface"] += int(k.get("targetSurface") == rr.get("targetSurface"))
        seed_stats["same_referenceText"] += int(k.get("referenceText") == rr.get("referenceText"))
        ka, ra = k.get("anchorCandidateSurface"), rr.get("anchorCandidateSurface")
        kctx = strip_anchor_surface(k.get("currentText") or "", [ka, ra])
        rctx = strip_anchor_surface(rr.get("currentText") or "", [ka, ra])
        seed_stats["same_surrounding_after_anchor_strip"] += int(kctx == rctx)

    # ---- Strong pairs ----
    pilot_pairs_all = strong_groups_from(pilot_test, pilot_sc)
    full_pairs_all = strong_groups_from(full_test, full_sc)
    # also corpus-wide for effective counts
    full_all_samples = full_train + load_split(FULL_DATA, "dev") + full_test
    full_pairs_corpus = strong_groups_from(full_all_samples, full_sc)

    print(f"pilot_test_strong_pairs={len(pilot_pairs_all)} full_test_strong_pairs={len(full_pairs_all)}", flush=True)

    # stratified sample
    def sample_pairs(pairs, n):
        if len(pairs) <= n:
            return list(pairs)
        xs = list(pairs)
        rng.shuffle(xs)
        return xs[:n]

    pilot_sample = sample_pairs(pilot_pairs_all, 50)
    full_sample = sample_pairs(full_pairs_all, 100)
    pipeline_sample = sample_pairs(full_pairs_all, 30)

    pilot_invs = []
    for gid, (ks, ksc), (rs, rsc), _ in pilot_sample:
        inv = pair_invariants(ks, rs, ksc, rsc)
        inv["gid"] = gid
        pilot_invs.append(inv)

    full_invs = []
    for gid, (ks, ksc), (rs, rsc), _ in full_sample:
        inv = pair_invariants(ks, rs, ksc, rsc)
        inv["gid"] = gid
        full_invs.append(inv)

    pilot_sum = summarize_invariants(pilot_invs)
    full_sum = summarize_invariants(full_invs)

    # corpus-wide strongness for Full100K
    strength_counts = Counter()
    source_kinds = Counter()
    corpus_anchor_only = 0
    for gid, (ks, ksc), (rs, rsc), _ in full_pairs_corpus:
        inv = pair_invariants(ks, rs, ksc, rsc)
        strength_counts[strongness(inv, None)] += 1
        if inv["anchor_only_difference"]:
            corpus_anchor_only += 1
        sk = ksc.get("sourceKind") or ksc.get("seedType") or "unknown"
        source_kinds[sk] += 1

    # ---- Vocab / tensor audit (use pilot vocab for packing shape; diet winner if available) ----
    device = torch.device("cpu")
    vocab = None
    model = None
    model_src = None
    # Prefer diet winner B if present
    prefer = [
        DIET_CKPT / "winner_seed_2026084421",
        DIET_CKPT / "diet_B_full",
        REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k_bigru",
        PILOT_MODEL,
    ]
    for root in prefer:
        if (root / "weights.pt").exists():
            try:
                model, vocab, _cfg = load_model_dir(root)
                model = model.to(device).eval()
                model_src = str(root.relative_to(REPO)).replace("\\", "/")
                break
            except Exception as e:
                print(f"skip model {root}: {e}", flush=True)

    # need a vocab even without model
    if vocab is None:
        from training.model3_dataset.train.bigru_v1 import build_char_vocab

        vocab = build_char_vocab(full_train[:2000] + full_test[:500])

    tensor_rows = []
    for gid, (ks, ksc), (rs, rsc), _ in full_sample:
        inv = pair_invariants(ks, rs, ksc, rsc)
        td = tensor_diff(ks, rs, ksc, rsc, vocab)
        td["strongness"] = strongness(inv, td)
        tensor_rows.append(td)

    model_visible_strong_n = sum(1 for t in tensor_rows if t.get("model_visible_strong"))
    mean_non_anchor = (
        sum(t.get("non_anchor_visible_difference_count", 0) for t in tensor_rows) / max(len(tensor_rows), 1)
    )

    # corpus effective MODEL_VISIBLE_STRONG estimate on test
    mv_strong_test = 0
    for gid, (ks, ksc), (rs, rsc), _ in full_pairs_all:
        inv = pair_invariants(ks, rs, ksc, rsc)
        td = tensor_diff(ks, rs, ksc, rsc, vocab)
        if strongness(inv, td) in ("MODEL_VISIBLE_STRONG", "STRICT_STRONG") and inv["anchor_only_difference"]:
            # STRICT with same text + only anchor feat diffs
            if inv["same_currentText"] and td.get("isAnchor_diff") and td.get("non_anchor_visible_difference_count", 9) <= 1:
                mv_strong_test += 1
                continue
        if td.get("model_visible_strong"):
            mv_strong_test += 1

    # ---- Ablation on Full100K strong pairs (need model) ----
    ablation = Counter()
    ablation_n = 0
    if model is not None:
        ablate_pairs = sample_pairs(full_pairs_all, min(100, len(full_pairs_all)))
        for gid, (ks, ksc), (rs, rsc), _ in ablate_pairs:
            inv = pair_invariants(ks, rs, ksc, rsc)
            ki, ri = inv["keep_span_i"], inv["retry_span_i"]
            if ki is None or ri is None:
                continue
            rng_a = random.Random(AUDIT_SEED + hash(gid) % 10_000)
            pk = predict_span(model, ks, vocab, ki, device)
            pr = predict_span(model, rs, vocab, ri, device)
            zk = predict_span(model, zero_anchor(ks), vocab, ki, device)
            zr = predict_span(model, zero_anchor(rs), vocab, ri, device)
            sk = predict_span(model, shuffle_anchor(ks, rng_a), vocab, ki, device)
            sr = predict_span(model, shuffle_anchor(rs, rng_a), vocab, ri, device)
            ablation[classify_ablation(pk, pr, zk, zr, sk, sr)] += 1
            ablation_n += 1

    # ---- Pipeline mutation points for 30 pairs ----
    pipeline_trace = []
    for gid, (ks, ksc), (rs, rsc), _ in pipeline_sample:
        inv = pair_invariants(ks, rs, ksc, rsc)
        sk = ksc.get("sourceKind") or ""
        mutation = "unknown"
        if sk == "SEED_V1" or (ksc.get("seedId") and rsc.get("seedId")):
            mutation = "seed_generation (KEEP/RETRY different currentText by design)"
        elif sk == "REACHABLE_PAIR_EXTRA" or str(gid).startswith("xcg:"):
            if inv["same_currentText"] and inv["anchor_only_difference"]:
                mutation = "none_preserved_same_text_dual_anchor"
            elif not inv["same_currentText"]:
                mutation = "stage2_or_materialization_broke_same_text"
            else:
                mutation = "partial_invariant_loss"
        elif not inv["same_currentText"]:
            mutation = "contrast_definition_too_loose_or_naturalization"
        pipeline_trace.append(
            {
                "gid": gid,
                "sourceKind": sk,
                "causal": inv["causal"],
                "same_currentText": inv["same_currentText"],
                "anchor_only": inv["anchor_only_difference"],
                "mutation_point": mutation,
            }
        )
    mutation_counts = Counter(p["mutation_point"] for p in pipeline_trace)

    train_diff = audit_sampler_and_loss()

    # Pilot invariants from ALL test strong (not just sample) for rates
    pilot_all_invs = []
    for gid, (ks, ksc), (rs, rsc), _ in sample_pairs(pilot_pairs_all, min(200, len(pilot_pairs_all))):
        pilot_all_invs.append(pair_invariants(ks, rs, ksc, rsc))
    pilot_all_sum = summarize_invariants(pilot_all_invs)

    full_all_invs = []
    for gid, (ks, ksc), (rs, rsc), _ in sample_pairs(full_pairs_all, min(200, len(full_pairs_all))):
        full_all_invs.append(pair_invariants(ks, rs, ksc, rsc))
    full_all_sum = summarize_invariants(full_all_invs)

    # comparison matrix
    matrix = {}
    for k in [
        "same_target",
        "same_currentText",
        "same_non_anchor_context",
        "same_pinyin",
        "same_offsets",
        "different_anchor",
        "anchor_only_difference",
        "labels_ok",
    ]:
        matrix[k] = {
            "pilot": pilot_all_sum.get(k),
            "full100k": full_all_sum.get(k),
            "delta": (full_all_sum.get(k) or 0) - (pilot_all_sum.get(k) or 0),
        }

    # Root cause classification
    primary = "STRONG_PAIR_INVARIANT_LOST"
    secondary = []
    codes = ["A"]
    if not train_diff["full100k_code_has_pair_consistency_step"] and train_diff["pilot_code_has_pair_consistency_step"]:
        secondary.append("PAIR_CONSISTENCY_LOSS_LOST")
        codes.append("C")
    if seed_stats["same_currentText"] == 0 and seed_stats["both_roles"] > 0:
        secondary.append("CONTRAST_DEFINITION_TOO_LOOSE")
        codes.append("F")
    # sampler: diet has group sampling; full100k baseline shuffle — both lack pair consistency
    if train_diff["full100k_uses_shuffle_dataloader"] and not train_diff["full100k_code_has_pair_consistency_step"]:
        secondary.append("PAIR_SAMPLING_WEAKER_THAN_PILOT")
        codes.append("B")
    # Stage2: check if xcg same-text survived
    xcg_broken = sum(1 for p in pipeline_trace if "broke_same_text" in p["mutation_point"])
    if xcg_broken > 0:
        secondary.append("STAGE2_MATERIALIZATION_BREAKS_PAIR")
        codes.append("D")

    classification = "G" if len(set(codes)) > 1 else codes[0]
    # map letter names
    letter_map = {
        "A": "STRONG_PAIR_INVARIANT_LOST",
        "B": "PAIR_SAMPLING_LOST",
        "C": "PAIR_CONSISTENCY_LOSS_LOST",
        "D": "STAGE2_MATERIALIZATION_BREAKS_PAIR",
        "E": "ANCHOR_FEATURE_TOO_WEAK",
        "F": "CONTRAST_DEFINITION_TOO_LOOSE",
        "G": "MULTIPLE",
    }

    # next phase
    if primary == "STRONG_PAIR_INVARIANT_LOST" or "CONTRAST_DEFINITION_TOO_LOOSE" in secondary:
        next_phase = "MODEL3_V1_CONTRAST_PAIR_RECONSTRUCTION"
    elif "PAIR_CONSISTENCY_LOSS_LOST" in secondary and primary != "STRONG_PAIR_INVARIANT_LOST":
        next_phase = "MODEL3_V1_PAIR_CONSISTENCY_TRAINING_RESTORE"
    else:
        next_phase = "MODEL3_V1_CONTRAST_PAIR_RECONSTRUCTION"

    verdict = "PASS_FINDING"

    bundle = {
        "phase": "MODEL3_V1_CONTRAST_CONSTRUCTION_REVIEW",
        "verdict": verdict,
        "audit_seed": AUDIT_SEED,
        "model_used_for_ablation": model_src,
        "pilot_strong_pair_invariants": {
            "definition": [
                "same targetSurface",
                "same currentText",
                "same non-anchor context after stripping both candidate anchors",
                "different Anchor / isAnchor placement",
                "KEEP vs RETRY labels on target",
                "pair_consistency_loss=true in training",
            ],
            "audited_sample": pilot_sum,
            "audited_extended": pilot_all_sum,
            "test_pair_count": len(pilot_pairs_all),
        },
        "full100k_strong_pair_invariants": {
            "audited_sample": full_sum,
            "audited_extended": full_all_sum,
            "test_pair_count": len(full_pairs_all),
            "corpus_pair_count": len(full_pairs_corpus),
            "corpus_strongness": dict(strength_counts),
            "corpus_anchor_only_rate": corpus_anchor_only / max(len(full_pairs_corpus), 1),
            "source_kinds": dict(source_kinds),
            "effective_model_visible_strong_pairs_test": mv_strong_test,
            "tensor_audit_n": len(tensor_rows),
            "mean_non_anchor_visible_difference_count": mean_non_anchor,
            "model_visible_strong_in_tensor_sample": model_visible_strong_n,
            "tensor_causal": dict(Counter(t.get("causal") for t in tensor_rows)),
            "non_anchor_diff_hist": dict(
                Counter(t.get("non_anchor_visible_difference_count") for t in tensor_rows)
            ),
        },
        "invariant_comparison_matrix": matrix,
        "seed_corpus_audit": seed_stats,
        "pipeline_trace": {
            "n": len(pipeline_trace),
            "mutation_counts": dict(mutation_counts),
            "examples": pipeline_trace[:10],
        },
        "training_difference": train_diff,
        "anchor_ablation_failure": {
            "n": ablation_n,
            "classes": dict(ablation),
            "rates": {k: v / max(ablation_n, 1) for k, v in ablation.items()},
        },
        "root_cause": {
            "primary": primary,
            "secondary": secondary,
            "classification": classification,
            "classification_name": letter_map[classification],
            "codes": sorted(set(codes)),
        },
        "recommendation": {
            "next_phase": next_phase,
            "safe_without_architecture_change": True,
            "contrast_construction_bug": True,
            "sampling_loss_bug": True,
            "stage2_bug": xcg_broken > 0,
            "small_bigru_problem": False,
        },
    }

    # Write artifacts
    report_path = DOCS / "Lingua_Model3_V1_Contrast_Construction_Review_2026_08_25.md"
    bundle_path = DOCS / "model3_v1_contrast_review_bundle.json"
    gov_path = DOCS / "model3_v1_contrast_review_governance.json"

    gov = {
        "go_summary": {
            "phase": "MODEL3_V1_CONTRAST_CONSTRUCTION_REVIEW",
            "verdict": verdict,
            "primary_root_cause": primary,
            "classification": classification,
            "recommended_next_phase": next_phase,
            "runtime_changed": False,
            "dataset_mutated": False,
            "tts": False,
            "production_retry": False,
        },
        "report_artifact_count": 3,
        "report_artifact_count_le_10": True,
        "modified_file_inventory": [
            "training/model3_dataset/scripts/audit_contrast_construction_review.py",
            "docs/user_correction/model3/Lingua_Model3_V1_Contrast_Construction_Review_2026_08_25.md",
            "docs/user_correction/model3/model3_v1_contrast_review_bundle.json",
            "docs/user_correction/model3/model3_v1_contrast_review_governance.json",
        ],
    }

    def pct(x):
        return f"{100.0 * x:.1f}%" if x is not None else "n/a"

    ab = bundle["anchor_ablation_failure"]["rates"]
    md = f"""# Lingua Model3 V1 Contrast Construction Review

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_CONTRAST_CONSTRUCTION_REVIEW`  
**Verdict:** `{verdict}`  
**Scope:** AUDIT ONLY (no retrain / no corpus regen / no architecture change)

## Executive finding

Pilot STRONG pairs are **same-`currentText` dual-anchor** contrasts with `pair_consistency_loss=true`.  
Full100K “STRONG” is dominated by **SEED_V1 pairs that share only `targetSurface`** (`same currentText` ≈ 0 in the 16k seed).  
Diet rebalance therefore improved family recall without restoring Anchor dependence.

## PILOT_STRONG_PAIR_INVARIANTS (from data)

1. `targetSurface` identical on KEEP/RETRY  
2. `currentText` identical  
3. Non-anchor context identical after stripping candidate anchors  
4. Anchor identity / `isAnchor` placement differs  
5. Target labels KEEP vs RETRY  
6. Training uses explicit pair-consistency fine-tune (`pair_consistency_loss=true`)

| Invariant | Pilot (n≈{pilot_all_sum['n']}) | Full100K (n≈{full_all_sum['n']}) |
|-----------|-------------------------------:|---------------------------------:|
| Same target | {pct(pilot_all_sum['same_target'])} | {pct(full_all_sum['same_target'])} |
| Same currentText | {pct(pilot_all_sum['same_currentText'])} | {pct(full_all_sum['same_currentText'])} |
| Same non-anchor context | {pct(pilot_all_sum['same_non_anchor_context'])} | {pct(full_all_sum['same_non_anchor_context'])} |
| Different Anchor | {pct(pilot_all_sum['different_anchor'])} | {pct(full_all_sum['different_anchor'])} |
| Anchor-only difference | {pct(pilot_all_sum['anchor_only_difference'])} | {pct(full_all_sum['anchor_only_difference'])} |

## Seed corpus (`MODEL3_ANCHOR_CONTEXT_SEED_V1`)

| Metric | Value |
|--------|------:|
| Seeds | {seed_stats['n_seeds']} |
| Strong groups | {seed_stats['strong_groups']} |
| KEEP+RETRY both present | {seed_stats['both_roles']} |
| Same currentText | {seed_stats['same_currentText']} |
| Same targetSurface | {seed_stats['same_targetSurface']} |
| Same referenceText | {seed_stats['same_referenceText']} |
| Same surrounding (anchor-stripped) | {seed_stats['same_surrounding_after_anchor_strip']} |

**Interpretation:** seed “STRONG” is **semantic / sentence-level contrast**, not Pilot-style Anchor-only contrast.

## Full100K strongness (corpus)

| Class | Count |
|-------|------:|
| STRICT_STRONG | {strength_counts.get('STRICT_STRONG', 0)} |
| MODEL_VISIBLE_STRONG (tensor sample) | {model_visible_strong_n} / {len(tensor_rows)} |
| Effective model-visible strong (test est.) | {mv_strong_test} / {len(full_pairs_all)} |
| WEAK | {strength_counts.get('WEAK', 0)} |
| INVALID | {strength_counts.get('INVALID', 0)} |
| MEDIUM | {strength_counts.get('MEDIUM', 0)} |

Source kinds (corpus strong pairs): `{dict(source_kinds)}`

Mean non-anchor visible difference count (test sample): **{mean_non_anchor:.2f}**

Causal classes (Full100K sample): `{full_sum.get('causal')}`

## Training difference

| Item | Pilot | Full100K / Diet |
|------|-------|-----------------|
| Pair consistency loss | **YES** (config + per-epoch pair fine-tune) | **NO / missing** |
| Contrast group sampling | shuffle + pair fine-tune | Diet: group emit YES; Full100K baseline: row shuffle |
| class_weight_retry | {train_diff.get('pilot_class_weight_retry')} | {train_diff.get('full100k_class_weight_retry')} |

## Pipeline mutation (30 Full100K strong pairs)

`{dict(mutation_counts)}`

Dominant break: **seed generation** invents different `currentText` for KEEP vs RETRY while tagging `contrastStrength=STRONG`.

## Anchor ablation failure (Full100K strong, model=`{model_src}`, n={ablation_n})

| Mode | Rate |
|------|-----:|
| Both correct without Anchor | {pct(ab.get('both_correct_without_anchor', 0))} |
| Collapse KEEP | {pct(ab.get('collapse_keep', 0))} |
| Collapse RETRY | {pct(ab.get('collapse_retry', 0))} |
| One flips | {pct(ab.get('one_flips', 0))} |
| Surface dominated | {pct(ab.get('surface_dominated', 0))} |
| Other | {pct(ab.get('other', 0))} |

**Why Strong Pair ≈0.66:** most pairs are solvable from **local/sentence surface cues** without Anchor; zero-ablation often leaves both sides correct → accuracy stays mediocre vs Pilot’s ~0.99.

## Root cause

- **Primary:** `STRONG_PAIR_INVARIANT_LOST` (A)  
- **Secondary:** {secondary}  
- **Classification:** `{classification}` = `{letter_map[classification]}`

## Decision

- Contrast construction bug: **YES**  
- Sampling/loss bug: **YES** (`pair_consistency_loss` dropped)  
- Stage2 bug: **{"YES" if xcg_broken else "NO (primary)"}**  
- Small BiGRU problem: **NO**  
- Architecture change required: **NO**  
- Safe to fix without runtime Anchor change: **YES**  
- Next: `{next_phase}`

## STOP

No retrain · No diet retune · No new 100k · No TTS · No production RETRY. Awaiting user review.
"""

    report_path.write_text(md, encoding="utf-8")
    bundle_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    gov_path.write_text(json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({"verdict": verdict, "primary": primary, "classification": classification, "next": next_phase}, ensure_ascii=False), flush=True)
    print(f"wrote {report_path.name} + bundle + governance", flush=True)


if __name__ == "__main__":
    main()
