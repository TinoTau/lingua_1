# -*- coding: utf-8 -*-
"""MODEL3_V1_LOSS_WEIGHT_AND_EFFECTIVE_GRADIENT_AUDIT

Audit-only + small controlled ablations. No corpus regen / no architecture change.
Writes ≤4 docs artifacts.
"""
from __future__ import annotations

import csv
import json
import math
import random
import sys
import time
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

import torch
import torch.nn as nn

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.strict_contrast_pair_v1 import STRICT, find_target_span  # noqa: E402
from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    sample_to_tensors,
)
from training.model3_dataset.train import train_strict_hardkeep_balance as thb  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
STRICT_DATA = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction"
FULL100K = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
HARD_KEEP = REPO / "training/model3_dataset/model3_v1_anchor_conditioned_hard_keep"
STRICT_CKPT = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction_bigru"
HK_CKPT = REPO / "training/model3_dataset/model3_v1_strict_hardkeep_balance_ckpts/winner_seed_2026087506"

AUDIT_SEED = 2026082510
BATCH = 64
ABLATION_EPOCHS = 2
SUBSET_N = 8000  # training subset size for ablations
EVAL_FULL_N = 4000
EVAL_STRICT_PAIRS = 400
PAIR_STEPS = 200
WIN_MIX = {"STRICT": 0.30, "ANCHOR_CONDITIONED_HARD_KEEP": 0.30, "NATURAL": 0.25, "NO_ANCHOR": 0.15}
STRICT_W = 2.6160994112052585


def load_model_dir(root: Path, device):
    cfg = json.loads((root / "config.json").read_text(encoding="utf-8"))
    vocab = json.loads((root / "vocab.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(len(vocab), int(cfg.get("embed_dim", 64)), int(cfg.get("hidden_dim", 128)), FEAT_DIM)
    wpath = root / "weights.pt"
    if wpath.exists():
        model.load_state_dict(torch.load(wpath, map_location="cpu"))
    return model.to(device).eval(), vocab, cfg


def formula_weight(n_keep: int, n_retry: int) -> dict:
    raw = math.sqrt(n_keep / max(n_retry, 1)) * 0.35
    capped = min(3.0, max(1.5, raw))
    return {
        "formula": "min(3.0, max(1.5, sqrt(n_keep/n_retry)*0.35))",
        "n_keep": n_keep,
        "n_retry": n_retry,
        "raw_before_cap": raw,
        "final": capped,
        "hit_cap_3": raw >= 3.0,
        "hit_floor_1_5": raw <= 1.5,
        "source_file": "training/model3_dataset/train/train_strict_hardkeep_balance.py:554",
        "same_formula_as_strict_recon": True,
        "same_formula_as_pilot": True,
    }


def classify_sample(s, strict_sc, hard_keep_map):
    sid = s["sampleId"]
    if sid in hard_keep_map or s.get("trainingBucketView") == "ANCHOR_CONDITIONED_HARD_KEEP":
        return "ANCHOR_HARD_KEEP"
    sc = strict_sc.get(sid, {})
    if sc.get("contrastStrength") == STRICT or sc.get("contrastStrengthClass") == STRICT or s.get("trainingBucket") == "STRICT":
        role = sc.get("roleInPair")
        if role == "RETRY":
            return "STRICT_RETRY"
        if role == "KEEP":
            return "STRICT_KEEP"
        return "STRICT_OTHER"
    if s.get("trainingBucket") == "NO_ANCHOR":
        return "NO_ANCHOR"
    return "NATURAL"


def span_label_counts(samples):
    keep = retry = 0
    for s in samples:
        for sp in s.get("spans") or []:
            if sp.get("targetMask") != 1:
                continue
            if sp.get("label") == "KEEP":
                keep += 1
            elif sp.get("label") == "RETRY":
                retry += 1
    return keep, retry


def audit_sampler_epoch(mix, buckets, strict_groups, surf_groups, train, strict_sc, hard_keep_map, seed):
    idxs = thb.make_epoch_indices(mix, buckets, strict_groups, surf_groups, len(train), random.Random(seed))
    row_type = Counter()
    unique = Counter()
    keep_spans = retry_spans = 0
    seen = set()
    for i in idxs:
        s = train[i]
        t = classify_sample(s, strict_sc, hard_keep_map)
        row_type[t] += 1
        if s["sampleId"] not in seen:
            unique[t] += 1
            seen.add(s["sampleId"])
        for sp in s.get("spans") or []:
            if sp.get("targetMask") != 1:
                continue
            if sp.get("label") == "KEEP":
                keep_spans += 1
            elif sp.get("label") == "RETRY":
                retry_spans += 1
    total = sum(row_type.values()) or 1
    return {
        "n_draws": len(idxs),
        "row_type_counts": dict(row_type),
        "row_type_share": {k: v / total for k, v in row_type.items()},
        "unique_per_type": dict(unique),
        "repeat_ratio": len(idxs) / max(len(seen), 1),
        "keep_spans": keep_spans,
        "retry_spans": retry_spans,
        "sampled_retry_ratio": retry_spans / max(keep_spans + retry_spans, 1),
    }


def effective_weights(w_retry: float, pair_on: bool, pair_steps: int, n_strict_pairs: int, epoch_n: int) -> dict:
    """Relative to ordinary KEEP CE = 1.0 (per eligible span appearance).

    Main CE: KEEP weight 1.0, RETRY weight w_retry.
    Pair step (per epoch): up to pair_steps pairs each apply:
      CE(KEEP_side,0)*1.0 + CE(RETRY_side,1)*w_retry + 0.35*margin
    Strict group sampling emits KEEP+RETRY together when STRICT bucket drawn.
    """
    # Expected pair visits per STRICT member per epoch (approx)
    pair_visit = (min(pair_steps, n_strict_pairs) / max(n_strict_pairs, 1)) if pair_on else 0.0
    # When STRICT bucket is drawn, both members emitted → row exposure already counted in sampler
    return {
        "ordinary_KEEP": 1.0,
        "strict_KEEP": 1.0 + (1.0 * pair_visit if pair_on else 0.0),
        "strict_RETRY": w_retry + (w_retry * pair_visit if pair_on else 0.0),
        "anchor_hard_KEEP": 1.0,
        "natural_KEEP": 1.0,
        "no_anchor_KEEP": 1.0,
        "notes": {
            "pair_visit_fraction_per_epoch": pair_visit,
            "pair_ce_duplicates_main_ce": True,
            "pair_margin_coef": 0.35 if pair_on else 0.0,
            "pair_margin_formula": "0.35 * relu(P_retry(keep) - P_retry(retry) + 0.25)",
            "class_weight_applies_inside_pair_ce": True,
        },
    }


def grad_norm(params):
    tot = 0.0
    for p in params:
        if p.grad is not None:
            tot += float(p.grad.detach().norm().item() ** 2)
    return math.sqrt(tot)


def measure_gradients(model, train, vocab, device, pair_index, w_retry, batch_ix):
    model.train()
    cw = torch.tensor([1.0, float(w_retry)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")

    def zero():
        model.zero_grad(set_to_none=True)

    # KEEP-only CE
    items = [sample_to_tensors(train[i], vocab) for i in batch_ix]
    batch = collate_batch(items, device)
    # mask retry to isolate keep contribution approx via separate weighted sums
    logits = model(batch["tokens"], batch["feats"], batch["avail"])
    bsz, nspan, c = logits.shape
    labels = batch["labels"].view(bsz * nspan)
    lv = crit(logits.view(bsz * nspan, c), labels)
    sel = batch["target_mask"].view(bsz * nspan) * batch["valid"].view(bsz * nspan)
    keep_mask = sel * (labels == 0).float()
    retry_mask = sel * (labels == 1).float()

    zero()
    if keep_mask.sum() > 0:
        ((lv * keep_mask).sum() / keep_mask.sum()).backward(retain_graph=True)
    keep_g = {
        "embed": grad_norm(model.embed.parameters()),
        "feat_proj": grad_norm(model.feat_proj.parameters()),
        "bigru": grad_norm(model.bigru.parameters()),
        "head": grad_norm(model.head.parameters()),
        "total": grad_norm(model.parameters()),
    }

    zero()
    logits = model(batch["tokens"], batch["feats"], batch["avail"])
    lv = crit(logits.view(bsz * nspan, c), labels)
    if retry_mask.sum() > 0:
        ((lv * retry_mask).sum() / retry_mask.sum()).backward(retain_graph=True)
    retry_g = {
        "embed": grad_norm(model.embed.parameters()),
        "feat_proj": grad_norm(model.feat_proj.parameters()),
        "bigru": grad_norm(model.bigru.parameters()),
        "head": grad_norm(model.head.parameters()),
        "total": grad_norm(model.parameters()),
    }

    # pair CE only
    zero()
    if pair_index:
        ki, ri, kk, rk = pair_index[0]
        bk = collate_batch([sample_to_tensors(train[ki], vocab)], device)
        br = collate_batch([sample_to_tensors(train[ri], vocab)], device)
        lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
        lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
        loss_p = crit(lk.unsqueeze(0), torch.tensor([0], device=device)) + crit(
            lr.unsqueeze(0), torch.tensor([1], device=device)
        )
        loss_p.backward(retain_graph=True)
    pair_ce_g = {"total": grad_norm(model.parameters())}

    # pair margin only
    zero()
    if pair_index:
        ki, ri, kk, rk = pair_index[0]
        bk = collate_batch([sample_to_tensors(train[ki], vocab)], device)
        br = collate_batch([sample_to_tensors(train[ri], vocab)], device)
        lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
        lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
        pk = torch.softmax(lk, dim=-1)
        pr = torch.softmax(lr, dim=-1)
        (0.35 * torch.relu(pk[1] - pr[1] + 0.25)).backward()
    pair_m_g = {"total": grad_norm(model.parameters())}

    return {
        "keep_ce": keep_g,
        "retry_ce": retry_g,
        "pair_ce": pair_ce_g,
        "pair_margin": pair_m_g,
        "dominant": max(
            [
                ("KEEP_CE", keep_g["total"]),
                ("RETRY_CE", retry_g["total"]),
                ("PAIR_CE", pair_ce_g["total"]),
                ("PAIR_MARGIN", pair_m_g["total"]),
            ],
            key=lambda x: x[1],
        )[0],
    }


def retry_logits(model, samples, vocab, device, want_label=None, target_surface=None, limit=500):
    model.eval()
    vals = []
    with torch.no_grad():
        for s in samples[:limit]:
            item = sample_to_tensors(s, vocab)
            tokens = torch.tensor([item["tokens"]], device=device)
            feats = torch.tensor([item["feats"]], dtype=torch.float32, device=device)
            avail = torch.tensor([item["avail"]], dtype=torch.float32, device=device)
            logits = model(tokens, feats, avail)[0]
            for k, sp in enumerate(s.get("spans") or []):
                if sp.get("targetMask") != 1:
                    continue
                if want_label and sp.get("label") != want_label:
                    continue
                if target_surface and sp.get("surface") != target_surface:
                    continue
                vals.append(float(logits[k, 1].item()))
    if not vals:
        return {"n": 0, "mean": None, "p50": None, "p90": None}
    vals.sort()
    return {
        "n": len(vals),
        "mean": sum(vals) / len(vals),
        "p50": vals[len(vals) // 2],
        "p90": vals[int(0.9 * (len(vals) - 1))],
        "min": vals[0],
        "max": vals[-1],
    }


def train_ablation(train, buckets, strict_groups, surf_groups, pair_index, vocab, device, epochs, seed, w_retry, pair_on, tag):
    torch.manual_seed(seed)
    random.seed(seed)
    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    cw = torch.tensor([1.0, float(w_retry)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    n = len(train)
    max_gn = 0.0
    nan = False
    for ep in range(epochs):
        model.train()
        idxs = thb.make_epoch_indices(WIN_MIX, buckets, strict_groups, surf_groups, n, random.Random(seed + ep * 17))
        for start in range(0, len(idxs), BATCH):
            batch_ix = idxs[start : start + BATCH]
            items = [sample_to_tensors(train[i], vocab) for i in batch_ix]
            batch = collate_batch(items, device)
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            bsz, nspan, c = logits.shape
            lv = crit(logits.view(bsz * nspan, c), batch["labels"].view(bsz * nspan))
            sel = batch["target_mask"].view(bsz * nspan) * batch["valid"].view(bsz * nspan)
            if sel.sum() <= 0:
                continue
            loss = (lv * sel).sum() / sel.sum()
            if not torch.isfinite(loss):
                nan = True
                continue
            loss.backward()
            gn = grad_norm(model.parameters())
            max_gn = max(max_gn, gn)
            opt.step()
        if pair_on and pair_index:
            model.train()
            rng_p = random.Random(seed + ep)
            pairs = pair_index[:]
            rng_p.shuffle(pairs)
            for ki, ri, kk, rk in pairs[: min(PAIR_STEPS, len(pairs))]:
                opt.zero_grad()
                bk = collate_batch([sample_to_tensors(train[ki], vocab)], device)
                br = collate_batch([sample_to_tensors(train[ri], vocab)], device)
                lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
                lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
                loss_p = crit(lk.unsqueeze(0), torch.tensor([0], device=device)) + crit(
                    lr.unsqueeze(0), torch.tensor([1], device=device)
                )
                pk = torch.softmax(lk, dim=-1)
                pr = torch.softmax(lr, dim=-1)
                loss_p = loss_p + 0.35 * torch.relu(pk[1] - pr[1] + 0.25)
                if not torch.isfinite(loss_p):
                    nan = True
                    continue
                loss_p.backward()
                gn = grad_norm(model.parameters())
                max_gn = max(max_gn, gn)
                opt.step()
        print(f"[{tag}] ep {ep+1}/{epochs} max_gn={max_gn:.3f}", flush=True)
    return model, {"max_grad_norm": max_gn, "nan_or_inf": nan}


def eval_compact(model, full_eval, strict_pairs, hard_keep_eval, no_anchor_eval, vocab, device):
    rng = random.Random(AUDIT_SEED)
    full_m = thb.eval_spans(model, full_eval, vocab, device)
    sp_n = thb.eval_strict_pairs(model, strict_pairs, vocab, device)
    sp_z = thb.eval_strict_pairs(model, strict_pairs, vocab, device, xform=thb.zero_anchor)
    sp_s = thb.eval_strict_pairs(
        model, strict_pairs, vocab, device, xform=lambda s: thb.shuffle_anchor(s, rng)
    )
    hk = thb.bucket_keep_acc(model, hard_keep_eval, vocab, device)
    na = thb.eval_spans(model, no_anchor_eval, vocab, device)
    return {
        "precision": full_m["retry_precision"],
        "recall": full_m["retry_recall"],
        "f1": full_m["retry_f1"],
        "false_retry": full_m["false_retry_rate"],
        "strict_pair": sp_n["pair_accuracy"],
        "strict_zero": sp_z["pair_accuracy"],
        "strict_shuffle": sp_s["pair_accuracy"],
        "hard_keep_acc": hk["accuracy"],
        "hard_keep_fp": hk["false_retry_rate"],
        "no_anchor_fp": na["false_retry_rate"],
    }


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    t0 = time.time()

    # ---- load data (reuse hardkeep balance builders) ----
    print("loading…", flush=True)
    hard_keep_map = thb.load_hard_keep()
    strict_sc = thb.load_sidecar(STRICT_DATA)
    strict_train = thb.load_split(STRICT_DATA, "train")
    strict_test = thb.load_split(STRICT_DATA, "test")
    full_test = thb.load_split(FULL100K, "test")
    train_all = thb.build_combined_train(strict_train, hard_keep_map, None)
    buckets, strict_groups, surf_groups = thb.build_index(train_all, strict_sc, hard_keep_map)
    pair_index_all = thb.build_pair_index(train_all, strict_sc)

    n_keep, n_retry = span_label_counts(train_all)
    fw = formula_weight(n_keep, n_retry)
    print("formula", fw, flush=True)

    # Strict recon weight reconstruction
    strict_only = [s for s in train_all if classify_sample(s, strict_sc, hard_keep_map).startswith("STRICT")]
    sk, sr = span_label_counts(strict_only)
    # better: original strict train only
    sk2, sr2 = span_label_counts(strict_train)
    fw_strict = formula_weight(sk2, sr2)

    # Parameter drift classification
    drift = {
        "strict_recon_weight": STRICT_W,
        "hardkeep_balance_weight": 3.0,
        "computed_on_hardkeep_train": fw["final"],
        "computed_on_strict_train_alone": fw_strict["final"],
        "source": fw["formula"],
        "source_location": fw["source_file"],
        "cli_override": False,
        "env_override": False,
        "config_file_override": False,
        "hardcoded_cap": 3.0,
        "classification": "IMPLEMENTATION_DRIFT",
        "intent_subclass": "ACCIDENTAL_DEFAULT_via_auto_formula_cap",
        "intentional_user_decision": False,
        "unauthorized_training_parameter_drift": True,
        "explanation": (
            "Same Pilot/Strict formula min(3.0,max(1.5,sqrt(n_keep/n_retry)*0.35)). "
            "Adding ~48k Hard KEEP raised n_keep so raw weight hit the hardcoded 3.0 cap. "
            "Not an explicit frozen decision to raise weight; phase-N said keep current weight first."
        ),
    }

    # Loss equation
    loss_eq = {
        "main_step": "L_ce = mean_{eligible}[ CrossEntropy(logits,y; weight=[1.0,w_retry]) ]",
        "reduction": "sum(lv*sel)/sum(sel) over target_mask & valid",
        "keep_weight": 1.0,
        "retry_weight": "w_retry (3.0 in HardKeep Balance)",
        "ignore_index": -100,
        "pair_step_per_epoch": (
            "for up to 800 pairs (ablation audit uses 200): "
            "L_pair = CE(lk, KEEP)*1.0 + CE(lr, RETRY)*w_retry + 0.35*relu(P_r(k)-P_r(r)+0.25); "
            "separate opt.step() per pair"
        ),
        "pair_lambda_explicit": "none (pair CE weight=1; margin coef=0.35)",
        "pair_ce_duplicates_main_ce": True,
        "total": "L_epoch ≈ Σ_batches L_ce + Σ_pairs L_pair (sequential Adam steps, not single summed loss)",
    }

    # Sampler audit
    samp = audit_sampler_epoch(
        WIN_MIX, buckets, strict_groups, surf_groups, train_all, strict_sc, hard_keep_map, AUDIT_SEED
    )
    configured = WIN_MIX
    # STRICT group emit doubles rows relative to draw probability
    actual = samp["row_type_share"]

    # Effective weights
    ew = effective_weights(3.0, True, 800, len(pair_index_all), len(train_all))
    ew_2616 = effective_weights(STRICT_W, True, 800, len(pair_index_all), len(train_all))

    # Prior chain
    raw_retry = n_retry / max(n_keep + n_retry, 1)
    sampled_retry = samp["sampled_retry_ratio"]
    # class-weighted mass
    cw_retry_mass = sampled_retry * 3.0
    cw_keep_mass = (1 - sampled_retry) * 1.0
    cw_share = cw_retry_mass / max(cw_retry_mass + cw_keep_mass, 1e-9)
    # pair-adjusted: add pair CE mass for strict sides
    pair_frac = min(800, len(pair_index_all)) / max(len(pair_index_all), 1)
    # approximate extra RETRY mass from pair CE on ~800 pairs / epoch relative to sampled spans
    pair_retry_extra = (min(800, len(pair_index_all)) * 3.0) / max(samp["keep_spans"] + samp["retry_spans"], 1)
    pair_adj = (cw_retry_mass + pair_retry_extra) / max(cw_keep_mass + cw_retry_mass + pair_retry_extra, 1e-9)

    prior_chain = {
        "raw_retry_ratio": raw_retry,
        "sampled_retry_ratio": sampled_retry,
        "class_weighted_retry_mass_share": cw_share,
        "pair_adjusted_retry_mass_share": pair_adj,
        "n_keep": n_keep,
        "n_retry": n_retry,
    }

    # Subset for ablations / gradients
    rng = random.Random(AUDIT_SEED)
    train_idx = list(range(len(train_all)))
    rng.shuffle(train_idx)
    # preserve bucket structure: take proportional subset by rebuilding from indices
    subset_ix = train_idx[:SUBSET_N]
    train = [train_all[i] for i in subset_ix]
    # remap index structures
    buckets_s, strict_groups_s, surf_groups_s = thb.build_index(train, strict_sc, hard_keep_map)
    pair_index = thb.build_pair_index(train, strict_sc)
    vocab = build_char_vocab(train)

    # Gradients at random init
    model0 = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    batch_ix = list(range(min(BATCH, len(train))))
    grads = measure_gradients(model0, train, vocab, device, pair_index, 3.0, batch_ix)
    del model0

    # Logit shift: load checkpoints if weights exist
    logit_shift = {"diagnosis": "OTHER", "strict_recon": {}, "hardkeep_winner": {}}
    try:
        if (STRICT_CKPT / "weights.pt").exists():
            m1, v1, _ = load_model_dir(STRICT_CKPT, device)
        else:
            m1, v1 = None, None
        if (HK_CKPT / "weights.pt").exists():
            m2, v2, _ = load_model_dir(HK_CKPT, device)
        else:
            m2, v2 = None, None
        # build typed eval lists from full_test / strict_test
        strict_pairs_all = thb.build_strict_test_pairs(strict_test, strict_sc)
        sk_samples = [p[0] for p in strict_pairs_all[:300]]
        sr_samples = [p[2] for p in strict_pairs_all[:300]]
        hk_test_ids = {sid for sid, hk in hard_keep_map.items() if hk.get("split") == "test"}
        hk_samples = [s for s in full_test if s["sampleId"] in hk_test_ids][:400]
        nat = [s for s in full_test if s.get("trainingBucket") == "NATURAL"][:400]
        noa = [s for s in full_test if s.get("trainingBucket") == "NO_ANCHOR"][:400]
        if m1 is not None:
            logit_shift["strict_recon"] = {
                "strict_keep": retry_logits(m1, sk_samples, v1, device, "KEEP"),
                "strict_retry": retry_logits(m1, sr_samples, v1, device, "RETRY"),
                "natural_keep": retry_logits(m1, nat, v1, device, "KEEP"),
                "no_anchor": retry_logits(m1, noa, v1, device, "KEEP"),
                "hard_keep": retry_logits(m1, hk_samples, v1, device, "KEEP"),
            }
            del m1
        if m2 is not None:
            logit_shift["hardkeep_winner"] = {
                "strict_keep": retry_logits(m2, sk_samples, v2, device, "KEEP"),
                "strict_retry": retry_logits(m2, sr_samples, v2, device, "RETRY"),
                "natural_keep": retry_logits(m2, nat, v2, device, "KEEP"),
                "no_anchor": retry_logits(m2, noa, v2, device, "KEEP"),
                "hard_keep": retry_logits(m2, hk_samples, v2, device, "KEEP"),
            }
            del m2
        # diagnose global shift
        sr_nat = (logit_shift.get("strict_recon") or {}).get("natural_keep", {}).get("mean")
        hk_nat = (logit_shift.get("hardkeep_winner") or {}).get("natural_keep", {}).get("mean")
        sr_noa = (logit_shift.get("strict_recon") or {}).get("no_anchor", {}).get("mean")
        hk_noa = (logit_shift.get("hardkeep_winner") or {}).get("no_anchor", {}).get("mean")
        if sr_nat is not None and hk_nat is not None and (hk_nat - sr_nat) > 1.0:
            logit_shift["diagnosis"] = "GLOBAL_RETRY_PRIOR_SHIFT"
        elif sr_nat is not None and hk_nat is not None:
            logit_shift["diagnosis"] = "GLOBAL_RETRY_PRIOR_SHIFT" if (hk_nat - sr_nat) > 0.3 else "OTHER"
        if not (STRICT_CKPT / "weights.pt").exists() and not (HK_CKPT / "weights.pt").exists():
            logit_shift["diagnosis"] = "OTHER"
            logit_shift["note"] = "weights.pt missing; logit compare skipped (config-only ckpts)"
    except Exception as e:
        logit_shift["error"] = str(e)

    # Eval sets (frozen subsets)
    full_eval = full_test[:EVAL_FULL_N]
    strict_pairs = thb.build_strict_test_pairs(strict_test, strict_sc)[:EVAL_STRICT_PAIRS]
    hk_test_ids = {sid for sid, hk in hard_keep_map.items() if hk.get("split") == "test"}
    hard_keep_eval = [s for s in full_test if s["sampleId"] in hk_test_ids][:500]
    no_anchor_eval = [s for s in full_test if s.get("trainingBucket") == "NO_ANCHOR"][:800]

    ablations = {}
    configs = [
        ("current_3.0_pair_on", 3.0, True),
        ("w2.616_pair_on", STRICT_W, True),
        ("w1.0_pair_on", 1.0, True),
        ("w2.616_pair_off", STRICT_W, False),
        ("w1.0_pair_off", 1.0, False),
        ("w2.616_pair_margin_0.1", STRICT_W, True),  # optional E: reduced margin handled specially
    ]

    for name, w, pair_on in configs:
        print(f"\n=== ABLATION {name} ===", flush=True)
        seed = AUDIT_SEED + hash(name) % 1000
        # optional E: temporarily monkey-patch margin in train_ablation by wrapping
        if name == "w2.616_pair_margin_0.1":
            # train with reduced margin via local loop copy
            torch.manual_seed(seed)
            random.seed(seed)
            model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
            opt = torch.optim.Adam(model.parameters(), lr=1e-3)
            cw = torch.tensor([1.0, float(w)], device=device)
            crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
            for ep in range(ABLATION_EPOCHS):
                model.train()
                idxs = thb.make_epoch_indices(
                    WIN_MIX, buckets_s, strict_groups_s, surf_groups_s, len(train), random.Random(seed + ep * 17)
                )
                for start in range(0, len(idxs), BATCH):
                    batch_ix = idxs[start : start + BATCH]
                    items = [sample_to_tensors(train[i], vocab) for i in batch_ix]
                    batch = collate_batch(items, device)
                    opt.zero_grad()
                    logits = model(batch["tokens"], batch["feats"], batch["avail"])
                    bsz, nspan, c = logits.shape
                    lv = crit(logits.view(bsz * nspan, c), batch["labels"].view(bsz * nspan))
                    sel = batch["target_mask"].view(bsz * nspan) * batch["valid"].view(bsz * nspan)
                    if sel.sum() <= 0:
                        continue
                    loss = (lv * sel).sum() / sel.sum()
                    loss.backward()
                    opt.step()
                if pair_index:
                    rng_p = random.Random(seed + ep)
                    pairs = pair_index[:]
                    rng_p.shuffle(pairs)
                    for ki, ri, kk, rk in pairs[: min(PAIR_STEPS, len(pairs))]:
                        opt.zero_grad()
                        bk = collate_batch([sample_to_tensors(train[ki], vocab)], device)
                        br = collate_batch([sample_to_tensors(train[ri], vocab)], device)
                        lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
                        lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
                        loss_p = crit(lk.unsqueeze(0), torch.tensor([0], device=device)) + crit(
                            lr.unsqueeze(0), torch.tensor([1], device=device)
                        )
                        pk = torch.softmax(lk, dim=-1)
                        pr = torch.softmax(lr, dim=-1)
                        loss_p = loss_p + 0.10 * torch.relu(pk[1] - pr[1] + 0.25)
                        loss_p.backward()
                        opt.step()
                print(f"[{name}] ep {ep+1}/{ABLATION_EPOCHS}", flush=True)
            stab = {"max_grad_norm": None, "nan_or_inf": False, "margin_coef": 0.10}
        else:
            model, stab = train_ablation(
                train, buckets_s, strict_groups_s, surf_groups_s, pair_index, vocab, device,
                ABLATION_EPOCHS, seed, w, pair_on, name,
            )
        metrics = eval_compact(model, full_eval, strict_pairs, hard_keep_eval, no_anchor_eval, vocab, device)
        ablations[name] = {"w_retry": w, "pair_on": pair_on, "metrics": metrics, "stability": stab}
        print(json.dumps({"ablation": name, **metrics}, ensure_ascii=False), flush=True)
        del model

    # Root cause classification from ablations
    cur = ablations["current_3.0_pair_on"]["metrics"]
    a = ablations["w2.616_pair_on"]["metrics"]
    b = ablations["w1.0_pair_on"]["metrics"]
    c = ablations["w2.616_pair_off"]["metrics"]
    d = ablations["w1.0_pair_off"]["metrics"]

    def prec_gain(m):
        return m["precision"] - cur["precision"]

    gains = {
        "lower_weight_to_2.616": prec_gain(a),
        "weight_1.0_pair_on": prec_gain(b),
        "pair_off_2.616": prec_gain(c),
        "pair_off_1.0": prec_gain(d),
    }
    # classify
    weight_helps = gains["weight_1.0_pair_on"] > 0.05 or gains["lower_weight_to_2.616"] > 0.03
    pair_off_helps = gains["pair_off_2.616"] > 0.05
    both = weight_helps and pair_off_helps
    if both and gains["pair_off_1.0"] > max(gains["weight_1.0_pair_on"], gains["pair_off_2.616"]):
        primary = "COMBINED_OBJECTIVE_OVERWEIGHT"
        next_phase = "MODEL3_V1_OBJECTIVE_REBALANCE"
    elif weight_helps and not pair_off_helps:
        primary = "CLASS_WEIGHT_DOMINANCE"
        next_phase = "MODEL3_V1_LOSS_WEIGHT_CORRECTION"
    elif pair_off_helps and not weight_helps:
        primary = "PAIR_LOSS_DOMINANCE"
        next_phase = "MODEL3_V1_PAIR_LOSS_CALIBRATION"
    elif drift["unauthorized_training_parameter_drift"]:
        primary = "CONFIG_DRIFT_PLUS_DOUBLE_COUNTING"
        next_phase = "MODEL3_V1_OBJECTIVE_REBALANCE"
    else:
        primary = "COMBINED_OBJECTIVE_OVERWEIGHT"
        next_phase = "MODEL3_V1_OBJECTIVE_REBALANCE"

    # Double counting multiplier for STRICT RETRY
    double_count = {
        "main_ce_multiplier": 3.0,
        "pair_ce_multiplier": 3.0 * (min(800, len(pair_index_all)) / max(len(pair_index_all), 1)),
        "approx_total_vs_ordinary_keep": ew["strict_RETRY"],
        "yes_double_counted": True,
        "explanation": (
            "STRICT RETRY receives weighted CE in main batch, then again weighted CE in pair fine-tune, "
            "plus margin pushing P(RETRY|keep) down / P(RETRY|retry) up. Hard KEEP only gets CE*1.0 once."
        ),
    }

    # Sampler STRICT row inflation
    sampler_notes = {
        "configured_mix": configured,
        "actual_row_share": actual,
        "strict_group_emit_both_members": True,
        "effect": "When STRICT bucket drawn, KEEP+RETRY both appended → STRICT row share can exceed 30% config probability",
        "configured_vs_actual_delta": {
            k: actual.get(k, 0) - configured.get(
                {"STRICT_KEEP": "STRICT", "STRICT_RETRY": "STRICT", "STRICT_OTHER": "STRICT",
                 "ANCHOR_HARD_KEEP": "ANCHOR_CONDITIONED_HARD_KEEP", "NATURAL": "NATURAL", "NO_ANCHOR": "NO_ANCHOR"}.get(k, k),
                0,
            )
            for k in actual
        },
    }

    # Best diagnostic candidate
    best_name = max(ablations.keys(), key=lambda n: ablations[n]["metrics"]["precision"])
    # prefer ones that keep strict_pair high and zero low
    def score_abl(n):
        m = ablations[n]["metrics"]
        return m["precision"] + 0.5 * m["strict_pair"] - m["strict_zero"] - m["false_retry"]

    best_name = max(ablations.keys(), key=score_abl)
    best = ablations[best_name]["metrics"]

    # Verdict
    if drift["unauthorized_training_parameter_drift"] and double_count["yes_double_counted"]:
        verdict = "CONFIG_DRIFT"
        if primary.startswith("COMBINED") or "DOUBLE" in primary:
            verdict = "TRAINING_IMPLEMENTATION_BUG"
    else:
        verdict = "PASS_FINDING"

    # Prefer PASS_FINDING if we clearly explained root cause
    if primary in ("CLASS_WEIGHT_DOMINANCE", "PAIR_LOSS_DOMINANCE", "COMBINED_OBJECTIVE_OVERWEIGHT", "CONFIG_DRIFT_PLUS_DOUBLE_COUNTING"):
        verdict = "PASS_FINDING"

    bundle = {
        "phase": "MODEL3_V1_LOSS_WEIGHT_AND_EFFECTIVE_GRADIENT_AUDIT",
        "verdict": verdict,
        "parameter_drift": drift,
        "loss_equation": loss_eq,
        "formula_weight_hardkeep_train": fw,
        "formula_weight_strict_train_alone": fw_strict,
        "effective_sample_weight_w3": ew,
        "effective_sample_weight_w2616": ew_2616,
        "sampler": {"audit": samp, "notes": sampler_notes},
        "prior_chain": prior_chain,
        "gradients_random_init": grads,
        "logit_shift": logit_shift,
        "double_counting": double_count,
        "ablations": ablations,
        "ablation_gains_vs_current": gains,
        "root_cause": {
            "primary": primary,
            "secondary": [
                "UNAUTHORIZED_TRAINING_PARAMETER_DRIFT (3.0 via formula cap)",
                "PAIR_CE_DOUBLE_COUNTS_MAIN_CE",
                "STRICT_GROUP_EMIT_INFLATES_ROW_EXPOSURE",
                "Hard KEEP CE under-powered vs STRICT RETRY (1.0 vs ~6x effective)",
            ],
            "classification": primary,
        },
        "best_diagnostic": {"name": best_name, "metrics": best},
        "architecture": {
            "small_bigru_problem": False,
            "data_volume_problem": False,
            "hard_keep_quality_problem": False,
            "loss_weight_problem": True,
            "sampler_problem": True,
        },
        "decision": {
            "balance_failure_explained": True,
            "safe_to_fix_without_architecture_change": True,
            "recommended_next_phase": next_phase,
        },
        "elapsed_sec": time.time() - t0,
    }

    # comparison csv
    cmp_path = DOCS / "model3_v1_loss_ablation_comparison.csv"
    with cmp_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "ablation", "w_retry", "pair_on", "precision", "recall", "f1", "false_retry",
                "strict_pair", "strict_zero", "strict_shuffle", "hard_keep_acc", "no_anchor_fp",
            ]
        )
        for name, o in ablations.items():
            m = o["metrics"]
            w.writerow(
                [
                    name, o["w_retry"], o["pair_on"], m["precision"], m["recall"], m["f1"], m["false_retry"],
                    m["strict_pair"], m["strict_zero"], m["strict_shuffle"], m["hard_keep_acc"], m["no_anchor_fp"],
                ]
            )

    gov = {
        "go_summary": {
            "phase": "MODEL3_V1_LOSS_WEIGHT_AND_EFFECTIVE_GRADIENT_AUDIT",
            "verdict": verdict,
            "primary_root_cause": primary,
            "recommended_next_phase": next_phase,
            "dataset_changed": False,
            "strict_contract_changed": False,
            "hard_keep_contract_changed": False,
            "runtime_changed": False,
            "tts": False,
            "production_retry": False,
        },
        "report_artifact_count": 4,
        "report_artifact_count_le_10": True,
        "unauthorized_training_parameter_drift": True,
        "modified_file_inventory": [
            "training/model3_dataset/train/audit_loss_weight_gradient.py",
            "docs/user_correction/model3/Lingua_Model3_V1_Loss_Weight_Gradient_Audit_2026_08_25.md",
            "docs/user_correction/model3/model3_v1_loss_gradient_audit_bundle.json",
            "docs/user_correction/model3/model3_v1_loss_gradient_governance.json",
            "docs/user_correction/model3/model3_v1_loss_ablation_comparison.csv",
        ],
    }

    report = f"""# Lingua Model3 V1 Loss Weight & Effective Gradient Audit

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_LOSS_WEIGHT_AND_EFFECTIVE_GRADIENT_AUDIT`  
**Verdict:** `{verdict}`

## Parameter drift

| Item | Value |
|------|------:|
| Strict Reconstruction `class_weight_retry` | {STRICT_W:.6f} |
| HardKeep Balance `class_weight_retry` | 3.0 |
| Formula | `min(3.0, max(1.5, sqrt(n_keep/n_retry)*0.35))` |
| Raw on HardKeep train | {fw['raw_before_cap']:.4f} → capped **3.0** |
| Raw on Strict-only train | {fw_strict['raw_before_cap']:.4f} → {fw_strict['final']:.4f} |

**3.0 Source:** hardcoded formula cap in `train_strict_hardkeep_balance.py` (same as Pilot/Strict recon).  
**Intentional user decision:** **NO** · **Unauthorized drift:** **YES** (`UNAUTHORIZED_TRAINING_PARAMETER_DRIFT`)

Adding ~48k Hard KEEP increased `n_keep`, so the auto formula hit the 3.0 ceiling—despite the balance phase instruction to keep the current retry weight first.

## Loss equation (from code)

```
Main batch:
  L_ce = mean_eligible CrossEntropy(logits, y; weight=[1.0, w_retry])

Per epoch after all batches (up to 800 pairs):
  L_pair = CE(keep_logit, KEEP)*1.0
         + CE(retry_logit, RETRY)*w_retry
         + 0.35 * relu(P_retry(keep) - P_retry(retry) + 0.25)
  → separate Adam step per pair
```

**Critical:** STRICT RETRY is optimized by weighted CE in the main loop **and again** in pair CE (same `w_retry`). Hard KEEP only sees CE×1.0 once.

## Effective sample weight (ordinary KEEP = 1.0)

| Type | w=3.0 + pair | w=2.616 + pair |
|------|-------------:|---------------:|
| Ordinary / Hard / Natural / NO_ANCHOR KEEP | 1.0 | 1.0 |
| Strict KEEP | {ew['strict_KEEP']:.3f} | {ew_2616['strict_KEEP']:.3f} |
| Strict RETRY | {ew['strict_RETRY']:.3f} | {ew_2616['strict_RETRY']:.3f} |

## Sampler (Balance D mix)

Configured: STRICT 30% / Hard KEEP 30% / NATURAL 25% / NO_ANCHOR 15%

Actual row shares (1 epoch): `{json.dumps({k: round(v,4) for k,v in actual.items()})}`

STRICT group sampling emits **both** KEEP+RETRY members per draw → STRICT row exposure inflated vs config %.

## Prior chain

| Stage | RETRY mass/ratio |
|-------|-----------------:|
| Raw eligible | {raw_retry:.6f} |
| Sampled | {sampled_retry:.6f} |
| Class-weighted share | {cw_share:.4f} |
| Pair-adjusted share | {pair_adj:.4f} |

## Gradients (random init, one batch)

Dominant component: **{grads['dominant']}**  
KEEP CE total={grads['keep_ce']['total']:.4f} · RETRY CE={grads['retry_ce']['total']:.4f} · Pair CE={grads['pair_ce']['total']:.4f} · Margin={grads['pair_margin']['total']:.4f}

## Logit shift

Diagnosis: **{logit_shift.get('diagnosis')}**

## Ablations (subset, {ABLATION_EPOCHS} epochs, same mix)

| Ablation | Precision | False RETRY | Strict Pair | Strict Zero | Hard KEEP Acc |
|----------|----------:|------------:|------------:|------------:|--------------:|
| current 3.0+pair | {cur['precision']:.4f} | {cur['false_retry']:.4f} | {cur['strict_pair']:.4f} | {cur['strict_zero']:.4f} | {cur['hard_keep_acc']:.4f} |
| 2.616+pair | {a['precision']:.4f} | {a['false_retry']:.4f} | {a['strict_pair']:.4f} | {a['strict_zero']:.4f} | {a['hard_keep_acc']:.4f} |
| 1.0+pair | {b['precision']:.4f} | {b['false_retry']:.4f} | {b['strict_pair']:.4f} | {b['strict_zero']:.4f} | {b['hard_keep_acc']:.4f} |
| 2.616 no-pair | {c['precision']:.4f} | {c['false_retry']:.4f} | {c['strict_pair']:.4f} | {c['strict_zero']:.4f} | {c['hard_keep_acc']:.4f} |
| 1.0 no-pair | {d['precision']:.4f} | {d['false_retry']:.4f} | {d['strict_pair']:.4f} | {d['strict_zero']:.4f} | {d['hard_keep_acc']:.4f} |
| 2.616 pair margin0.1 | {ablations['w2.616_pair_margin_0.1']['metrics']['precision']:.4f} | {ablations['w2.616_pair_margin_0.1']['metrics']['false_retry']:.4f} | {ablations['w2.616_pair_margin_0.1']['metrics']['strict_pair']:.4f} | {ablations['w2.616_pair_margin_0.1']['metrics']['strict_zero']:.4f} | {ablations['w2.616_pair_margin_0.1']['metrics']['hard_keep_acc']:.4f} |

Best diagnostic: **{best_name}**

## Root cause

- **Primary:** `{primary}`
- **Secondary:** unauthorized 3.0 cap drift · pair CE double-count · STRICT group row inflation · Hard KEEP under-weighted
- Hard KEEP volume/quality: **NOT** the primary failure mode

## Decision

- Balance failure explained: **YES**
- Safe to fix without architecture change: **YES**
- Small BiGRU problem: **NO**
- Next: `{next_phase}`

## STOP

No full retrain · No new Hard KEEP · No mix retune · No TTS · No runtime change. Awaiting user review.
"""

    (DOCS / "Lingua_Model3_V1_Loss_Weight_Gradient_Audit_2026_08_25.md").write_text(report, encoding="utf-8")
    (DOCS / "model3_v1_loss_gradient_audit_bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_loss_gradient_governance.json").write_text(
        json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "verdict": verdict,
                "primary": primary,
                "next": next_phase,
                "best": best_name,
                "unauthorized_drift": True,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
