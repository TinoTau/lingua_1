# -*- coding: utf-8 -*-
"""LEGACY / EXPERIMENT ONLY — NOT the authoritative Synthetic V1 trainer.
Authoritative: train_full100k_strict_integration.py + model3_v1_training_config.json

QA + train + accept Anchor-contrast pilot. Writes ≤10 merged docs artifacts."""
from __future__ import annotations

import hashlib
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
from torch.utils.data import DataLoader, Dataset

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    model_input_hash,
    sample_to_tensors,
    save_model_bundle,
)

DATA = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot"
CTRL = REPO / "training/model3_dataset/model3_v1_synthetic_bigru_noleak"
OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot_bigru"
DOCS = REPO / "docs/user_correction/model3"
SEED = 2026082415
MODEL_NAME = "MODEL3_V1_ANCHOR_CONTRAST_PILOT_BIGRU_V1"


def load_split(split: str) -> list[dict]:
    rows = []
    for p in sorted((DATA / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def load_sidecar() -> dict[str, dict]:
    m = {}
    p = DATA / "anchor_provenance_sidecar.jsonl"
    if not p.exists():
        return m
    with p.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                m[o["sampleId"]] = o
    return m


class DS(Dataset):
    def __init__(self, samples, vocab, xform=None):
        self.samples = samples
        self.vocab = vocab
        self.xform = xform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        if self.xform:
            s = self.xform(s)
        return sample_to_tensors(s, self.vocab)


def metrics(tp, fp, fn, tn):
    rp = tp / (tp + fp) if (tp + fp) else 0.0
    rr = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * rp * rr / (rp + rr) if (rp + rr) else 0.0
    kp = tn / (tn + fn) if (tn + fn) else 0.0
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "retry_precision": rp,
        "retry_recall": rr,
        "retry_f1": f1,
        "false_retry_rate": fp / (fp + tn) if (fp + tn) else 0.0,
        "macro_f1": (kp + rp) / 2 if (kp or rp) else 0.0,
        "eligible": tp + fp + fn + tn,
    }


def eval_model(model, samples, vocab, device, xform=None, bs=64):
    ds = DS(samples, vocab, xform)
    loader = DataLoader(ds, batch_size=bs, shuffle=False, collate_fn=lambda b: collate_batch(b, device))
    model.eval()
    tp = fp = fn = tn = 0
    preds = []
    with torch.no_grad():
        for bi, batch in enumerate(loader):
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            pred = logits.argmax(-1)
            for j in range(pred.shape[0]):
                si = bi * bs + j
                if si >= len(samples):
                    break
                item = sample_to_tensors(xform(samples[si]) if xform else samples[si], vocab)
                for k in range(len(item["labels"])):
                    if item["target_mask"][k] != 1 or item["labels"][k] < 0:
                        continue
                    y = item["labels"][k]
                    p = int(pred[j, k].item())
                    tn += y == 0 and p == 0
                    fp += y == 0 and p == 1
                    tp += y == 1 and p == 1
                    fn += y == 1 and p == 0
                    preds.append((si, k, y, p, item.get("sampleId")))
    return metrics(tp, fp, fn, tn), preds


def flip_rate(a, b):
    mb = {(s, k): p for s, k, y, p, *_ in b}
    tot = flip = 0
    for s, k, y, p0, *_ in a:
        if (s, k) not in mb:
            continue
        tot += 1
        flip += mb[(s, k)] != p0
    return {"compared": tot, "flip": flip, "flip_rate": flip / tot if tot else 0.0}


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


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def majority_lookup(train, test, key_fn):
    table = defaultdict(Counter)
    for s in train:
        for sp in s["spans"]:
            if sp.get("targetMask") != 1 or sp.get("label") not in ("KEEP", "RETRY"):
                continue
            table[key_fn(sp)][sp["label"]] += 1
    maj = {k: ("RETRY" if c["RETRY"] >= c["KEEP"] else "KEEP") for k, c in table.items()}
    tp = fp = fn = tn = 0
    for s in test:
        for sp in s["spans"]:
            if sp.get("targetMask") != 1 or sp.get("label") not in ("KEEP", "RETRY"):
                continue
            pred = maj.get(key_fn(sp), "KEEP")
            y = sp["label"]
            if y == "KEEP" and pred == "KEEP":
                tn += 1
            elif y == "KEEP" and pred == "RETRY":
                fp += 1
            elif y == "RETRY" and pred == "RETRY":
                tp += 1
            else:
                fn += 1
    return metrics(tp, fp, fn, tn)


def surface_entropy(samples):
    by = defaultdict(Counter)
    for s in samples:
        for sp in s["spans"]:
            if sp.get("targetMask") != 1 or sp.get("label") not in ("KEEP", "RETRY"):
                continue
            by[sp["surface"]][sp["label"]] += 1
    entropies = []
    pure = mixed = 0
    for surf, c in by.items():
        tot = c["KEEP"] + c["RETRY"]
        if tot == 0:
            continue
        if c["KEEP"] == 0 or c["RETRY"] == 0:
            pure += 1
            entropies.append(0.0)
        else:
            mixed += 1
            p = c["RETRY"] / tot
            e = 0.0
            for q in (p, 1 - p):
                if q > 0:
                    e -= q * math.log2(q)
            entropies.append(e)
    return {
        "unique_surfaces": len(by),
        "pure_label_surfaces": pure,
        "mixed_label_surfaces": mixed,
        "same_target_different_label": mixed,
        "mean_entropy": sum(entropies) / len(entropies) if entropies else 0.0,
        "retry_given_surface_mean": (
            sum(c["RETRY"] / max(c["KEEP"] + c["RETRY"], 1) for c in by.values()) / len(by) if by else 0.0
        ),
    }


def run_leakage_gate(vocab, samples):
    subset = samples[:200]
    ok = fail = 0
    for s in subset:
        h0 = model_input_hash(s, vocab)
        mut = deepcopy(s)
        for sp in mut["spans"]:
            sp["referenceSurface"] = "LEAK"
            sp["phoneticCompatible"] = True
            rep = dict(sp.get("repairability") or {})
            rep["referenceReachable"] = "NO"
            sp["repairability"] = rep
            sp["corruptionFamily"] = "X"
            if sp.get("label") == "KEEP":
                sp["label"] = "RETRY"
            elif sp.get("label") == "RETRY":
                sp["label"] = "KEEP"
            sp["targetMask"] = 1 - int(sp.get("targetMask") or 0)
        if model_input_hash(mut, vocab) == h0:
            ok += 1
        else:
            fail += 1
    return {"stable": fail == 0, "ok": ok, "fail": fail, "gate_pass": fail == 0}


def main():
    DOCS.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    torch.manual_seed(SEED)
    random.seed(SEED)

    print("load…", flush=True)
    train = load_split("train")
    dev = load_split("dev")
    test = load_split("test")
    sidecar = load_sidecar()
    print(f"train={len(train)} dev={len(dev)} test={len(test)}", flush=True)

    # ---- dataset QA / shortcut baselines ----
    label_span = Counter()
    for s in train + dev + test:
        for sp in s["spans"]:
            label_span[sp.get("label")] += 1
    ent = surface_entropy(train + test)
    surf_base = majority_lookup(train, test, lambda sp: sp.get("surface") or "")
    pin_base = majority_lookup(
        train,
        test,
        lambda sp: ((sp.get("pinyinEvidence") or {}).get("plain") or sp.get("surface") or ""),
    )

    # strong pairs from sidecar
    by_cg = defaultdict(list)
    for sid, sc in sidecar.items():
        by_cg[sc.get("contrastGroupId")].append(sc)
    strong_pairs = medium_pairs = 0
    for g, rows in by_cg.items():
        roles = {r.get("roleInPair") for r in rows}
        strengths = {r.get("contrastStrength") for r in rows}
        if "KEEP" in roles and "RETRY" in roles:
            if "STRONG" in strengths:
                strong_pairs += 1
            elif "MEDIUM" in strengths:
                medium_pairs += 1

    eligible = label_span["KEEP"] + label_span["RETRY"]
    retry_ratio = label_span["RETRY"] / eligible if eligible else 0.0
    anchor_utt = sum(1 for s in train + dev + test if any(sp.get("isAnchor") for sp in s["spans"]))
    total_utt = len(train) + len(dev) + len(test)

    vocab = build_char_vocab(train)
    gate = run_leakage_gate(vocab, train)
    print("leakage_gate", gate, flush=True)

    # surface-only vs need for anchor: if surface lookup F1 very high on mixed surfaces, fail design
    design_fail = False
    design_notes = []
    if strong_pairs < 500:
        design_notes.append(f"STRONG_PAIRS_BELOW_TARGET_2000={strong_pairs}")
    if ent["mixed_label_surfaces"] < 50:
        design_notes.append(f"MIXED_SURFACES_LOW={ent['mixed_label_surfaces']}")
        design_fail = True
    if surf_base["retry_f1"] > 0.85 and ent["mean_entropy"] < 0.25:
        design_notes.append("SURFACE_LOOKUP_TOO_STRONG")
        design_fail = True
    if not gate["gate_pass"]:
        design_fail = True
        design_notes.append("LEAKAGE_GATE_FAIL")

    dist = {
        "utterances": total_utt,
        "train": len(train),
        "dev": len(dev),
        "test": len(test),
        "span_labels": dict(label_span),
        "retry_ratio_eligible": retry_ratio,
        "anchor_conditioned": anchor_utt,
        "no_anchor": total_utt - anchor_utt,
        "strong_pairs": strong_pairs,
        "medium_pairs": medium_pairs,
        "contrast_density_estimate": (strong_pairs + medium_pairs) * 2 / max(total_utt, 1),
    }

    if design_fail:
        print("DATASET DESIGN QA FAIL", design_notes, flush=True)
        # still write partial and abort train
        (DOCS / "model3_anchor_contrast_bundle.json").write_text(
            json.dumps(
                {
                    "verdict": "DATASET_FAIL",
                    "design_notes": design_notes,
                    "distribution": dist,
                    "entropy": ent,
                    "surface_lookup": surf_base,
                    "leakage_gate": gate,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        raise SystemExit("DATASET_FAIL — QA gate")

    print("train BiGRU…", flush=True)
    n_keep = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "KEEP")
    n_retry = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "RETRY")
    # Milder weight: heavy RETRY weight caused surface→RETRY spraying and killed pair accuracy
    w_retry = min(3.0, max(1.5, math.sqrt(n_keep / max(n_retry, 1)) * 0.35))
    config = {
        "embed_dim": 64,
        "hidden_dim": 128,
        "feat_dim": FEAT_DIM,
        "feat_names": list(FEAT_NAMES),
        "batch_size": 64,
        "epochs": 8,
        "lr": 1e-3,
        "class_weight_retry": w_retry,
        "seed": SEED,
        "init": "random_from_scratch",
        "pair_consistency_loss": True,
    }
    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    cw = torch.tensor([1.0, float(w_retry)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")

    # Build train contrast pair index: (keep_sample_idx, retry_sample_idx, keep_span_k, retry_span_k)
    sid_to_i = {s["sampleId"]: i for i, s in enumerate(train)}
    pair_index = []
    by_cg = defaultdict(list)
    for sid, sc in sidecar.items():
        if sid in sid_to_i and sc.get("contrastStrength") in ("STRONG", "MEDIUM"):
            by_cg[sc["contrastGroupId"]].append(sc)
    for g, rows in by_cg.items():
        kr = [r for r in rows if r.get("roleInPair") == "KEEP"]
        rr = [r for r in rows if r.get("roleInPair") == "RETRY"]
        if not kr or not rr:
            continue
        ki, ri = sid_to_i.get(kr[0]["sampleId"]), sid_to_i.get(rr[0]["sampleId"])
        if ki is None or ri is None:
            continue
        tgt_k = kr[0].get("targetSurface")
        tgt_r = rr[0].get("targetSurface")

        def find_k(sample, tgt, want):
            for k, sp in enumerate(sample["spans"]):
                if sp.get("targetMask") != 1 or sp.get("label") != want:
                    continue
                if tgt and sp.get("surface") != tgt:
                    continue
                return k
            return None

        kk = find_k(train[ki], tgt_k, "KEEP")
        rk = find_k(train[ri], tgt_r, "RETRY")
        if kk is not None and rk is not None:
            pair_index.append((ki, ri, kk, rk))
    print(f"contrast_pair_index={len(pair_index)} w_retry={w_retry:.3f}", flush=True)

    train_loader = DataLoader(
        DS(train, vocab), batch_size=64, shuffle=True, collate_fn=lambda b: collate_batch(b, device)
    )
    history = []
    t0 = time.time()
    best_f1, best_state = -1.0, None
    for epoch in range(8):
        model.train()
        loss_sum = nb = 0
        for batch in train_loader:
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            b, n, c = logits.shape
            lv = crit(logits.view(b * n, c), batch["labels"].view(b * n))
            sel = batch["target_mask"].view(b * n) * batch["valid"].view(b * n)
            if sel.sum() <= 0:
                continue
            loss = (lv * sel).sum() / sel.sum()
            loss.backward()
            opt.step()
            loss_sum += loss.item()
            nb += 1
        # Pair consistency fine-tune step each epoch (same architecture; loss only)
        if pair_index:
            model.train()
            rng_p = random.Random(SEED + epoch)
            sample_pairs = pair_index[:]
            rng_p.shuffle(sample_pairs)
            for ki, ri, kk, rk in sample_pairs[: min(800, len(sample_pairs))]:
                opt.zero_grad()
                bk = collate_batch([sample_to_tensors(train[ki], vocab)], device)
                br = collate_batch([sample_to_tensors(train[ri], vocab)], device)
                lk = model(bk["tokens"], bk["feats"], bk["avail"])[0, kk]
                lr = model(br["tokens"], br["feats"], br["avail"])[0, rk]
                # encourage KEEP on keep-side and RETRY on retry-side
                loss_p = crit(lk.unsqueeze(0), torch.tensor([0], device=device)) + crit(
                    lr.unsqueeze(0), torch.tensor([1], device=device)
                )
                # margin: P(RETRY|keep) should be low, P(RETRY|retry) high
                pk = torch.softmax(lk, dim=-1)
                pr = torch.softmax(lr, dim=-1)
                loss_p = loss_p + 0.35 * torch.relu(pk[1] - pr[1] + 0.25)
                loss_p.backward()
                opt.step()
        dm, _ = eval_model(model, dev, vocab, device)
        history.append({"epoch": epoch + 1, "train_loss": loss_sum / max(nb, 1), "dev": dm})
        print(f"epoch {epoch+1} loss={loss_sum/max(nb,1):.4f} dev_f1={dm['retry_f1']:.4f}", flush=True)
        # prefer models that don't spray RETRY: use macro_f1 * pair-proxy
        score = dm["macro_f1"]
        if score > best_f1:
            best_f1 = score
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    if best_state:
        model.load_state_dict(best_state)
    save_model_bundle(OUT, model, vocab, config, MODEL_NAME)
    with (OUT / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256\n")
        for name in ("weights.pt", "vocab.json", "config.json", "model_manifest.json"):
            p = OUT / name
            f.write(f"{p.relative_to(REPO).as_posix()},{sha256_file(p)}\n")

    # linear baseline on allowlisted feats
    def extract_xy(samples):
        X, y = [], []
        for s in samples:
            item = sample_to_tensors(s, vocab)
            for j, lab in enumerate(item["labels"]):
                if item["target_mask"][j] != 1 or lab < 0:
                    continue
                X.append([sum(item["tokens"][j]) / 8.0] + item["feats"][j])
                y.append(lab)
        return X, y

    Xtr, ytr = extract_xy(train[::2])
    Xte, yte = extract_xy(test)
    rng = random.Random(SEED)
    d = len(Xtr[0])
    w = [rng.uniform(-0.01, 0.01) for _ in range(d)]
    b0 = 0.0
    wpos = (sum(1 for t in ytr if t == 0) / max(sum(1 for t in ytr if t == 1), 1)) ** 0.5
    for _ in range(4):
        idxs = list(range(len(Xtr)))
        rng.shuffle(idxs)
        for i in idxs:
            xi, yi = Xtr[i], ytr[i]
            z = b0 + sum(w[k] * xi[k] for k in range(d))
            p = 1 / (1 + math.exp(-max(min(z, 20), -20)))
            g = (wpos if yi == 1 else 1.0) * (p - yi)
            for k in range(d):
                w[k] -= 0.05 * g * xi[k]
            b0 -= 0.05 * g
    lin_pred = [1 if b0 + sum(w[k] * xi[k] for k in range(d)) >= 0 else 0 for xi in Xte]
    tp = fp = fn = tn = 0
    for yt, yp in zip(yte, lin_pred):
        tn += yt == 0 and yp == 0
        fp += yt == 0 and yp == 1
        tp += yt == 1 and yp == 1
        fn += yt == 1 and yp == 0
    lin_m = metrics(tp, fp, fn, tn)

    print("accept…", flush=True)
    test_m, base_preds = eval_model(model, test, vocab, device)
    az_m, az_preds = eval_model(model, test, vocab, device, xform=zero_anchor)
    as_m, as_preds = eval_model(
        model,
        test,
        vocab,
        device,
        xform=lambda s: shuffle_anchor(s, random.Random(hash(s["sampleId"]) % (2**32))),
    )
    az_flip = flip_rate(base_preds, az_preds)
    as_flip = flip_rate(base_preds, as_preds)

    # strong contrast pair accuracy
    id_to_idx = {s["sampleId"]: i for i, s in enumerate(test)}
    pred_map = {}
    for si, k, y, p, *_ in base_preds:
        sid = test[si]["sampleId"]
        surf = test[si]["spans"][k].get("surface")
        pred_map[(sid, k)] = (y, p, surf)

    # group test samples by contrastGroupId
    groups = defaultdict(list)
    for sid, sc in sidecar.items():
        if sid in id_to_idx and sc.get("contrastStrength") == "STRONG":
            groups[sc["contrastGroupId"]].append((sid, sc))

    pair_total = pair_correct = surface_dom = 0
    for g, rows in groups.items():
        keep_rows = [r for r in rows if r[1].get("roleInPair") == "KEEP"]
        retry_rows = [r for r in rows if r[1].get("roleInPair") == "RETRY"]
        if not keep_rows or not retry_rows:
            continue
        # evaluate target spans: find supervised span matching targetSurface
        def side_ok(sid, role_label):
            s = test[id_to_idx[sid]]
            tgt = sidecar[sid].get("targetSurface")
            si = id_to_idx[sid]
            for k, sp in enumerate(s["spans"]):
                if sp.get("targetMask") != 1:
                    continue
                if tgt and sp.get("surface") != tgt:
                    continue
                y, p, _ = pred_map.get((sid, k), (None, None, None))
                if y is None:
                    continue
                return p == (1 if role_label == "RETRY" else 0), p
            # fallback any RETRY/KEEP supervised
            for k, sp in enumerate(s["spans"]):
                if sp.get("label") != role_label or sp.get("targetMask") != 1:
                    continue
                y, p, _ = pred_map.get((sid, k), (None, None, None))
                if y is None:
                    continue
                return p == (1 if role_label == "RETRY" else 0), p
            return False, None

        # take first keep/retry sample in group present in test
        ok_k, pk = side_ok(keep_rows[0][0], "KEEP")
        ok_r, pr = side_ok(retry_rows[0][0], "RETRY")
        pair_total += 1
        if ok_k and ok_r:
            pair_correct += 1
        if pk is not None and pr is not None and pk == pr:
            surface_dom += 1

    strong_metrics = {
        "pairs": pair_total,
        "pair_accuracy": pair_correct / pair_total if pair_total else 0.0,
        "surface_dominated_rate": surface_dom / pair_total if pair_total else 0.0,
        "pair_correct": pair_correct,
    }

    # held-out axes
    def subset_axis(axis):
        return [s for s in test if axis in (s.get("heldOutAxes") or [])]

    unseen_surf = subset_axis("held_out_surface_pair")
    unseen_fam = subset_axis("held_out_pronunciation_family")
    unseen_ctx = subset_axis("held_out_anchor_combination")
    us_m, _ = eval_model(model, unseen_surf, vocab, device) if unseen_surf else (metrics(0, 0, 0, 0), [])
    uf_m, _ = eval_model(model, unseen_fam, vocab, device) if unseen_fam else (metrics(0, 0, 0, 0), [])
    uc_m, _ = eval_model(model, unseen_ctx, vocab, device) if unseen_ctx else (metrics(0, 0, 0, 0), [])

    # compare vs noleak control on THIS pilot test (fair) + report old deltas from acceptance
    noleak_comp = {"status": "CONTROL_NOT_EVALUATED_ON_PILOT"}
    if (CTRL / "weights.pt").exists():
        try:
            cvocab = json.loads((CTRL / "vocab.json").read_text(encoding="utf-8"))
            ccfg = json.loads((CTRL / "config.json").read_text(encoding="utf-8"))
            cmodel = Model3BiGRUV1(len(cvocab), ccfg["embed_dim"], ccfg["hidden_dim"], ccfg.get("feat_dim", FEAT_DIM))
            # feat dim may match
            cmodel.load_state_dict(torch.load(CTRL / "weights.pt", map_location="cpu"))
            # only if vocab/feat compatible — may fail; catch
            cm, cp = eval_model(cmodel, test[:2000], vocab if False else cvocab, device)
            # Use pilot vocab packing with control weights only if dims match — safer skip if mismatch
            noleak_comp = {
                "note": "noleak trained on 100k diet; evaluated on pilot test with its own vocab",
                "pilot_test_subset_n": min(2000, len(test)),
                "noleak_retry_f1_on_pilot_subset": cm["retry_f1"],
            }
            caz, _ = eval_model(cmodel, test[:2000], cvocab, device, xform=zero_anchor)
            noleak_comp["noleak_anchor_zero_f1"] = caz["retry_f1"]
            noleak_comp["noleak_anchor_zero_delta"] = cm["retry_f1"] - caz["retry_f1"]
        except Exception as e:
            noleak_comp = {"status": "SKIP", "error": str(e)}

    # CPU
    lat = []
    model.eval()
    with torch.no_grad():
        for s in test[:500]:
            batch = collate_batch([sample_to_tensors(s, vocab)], device)
            t1 = time.perf_counter()
            model(batch["tokens"], batch["feats"], batch["avail"])
            lat.append((time.perf_counter() - t1) * 1000)
    lat_s = sorted(lat)

    def pct(p):
        k = (len(lat_s) - 1) * p / 100
        f = int(k)
        c = min(f + 1, len(lat_s) - 1)
        return lat_s[f] if f == c else lat_s[f] + (lat_s[c] - lat_s[f]) * (k - f)

    cpu = {"p50_ms": pct(50), "p95_ms": pct(95), "p99_ms": pct(99), "n": len(lat)}

    zero_delta = test_m["retry_f1"] - az_m["retry_f1"]
    shuffle_delta = test_m["retry_f1"] - as_m["retry_f1"]
    if az_flip["flip_rate"] >= 0.05 or abs(zero_delta) >= 0.03:
        anchor_contrib = "STRONG" if az_flip["flip_rate"] >= 0.15 or abs(zero_delta) >= 0.1 else "MEASURABLE"
    elif az_flip["flip_rate"] >= 0.01 or abs(zero_delta) >= 0.01:
        anchor_contrib = "WEAK"
    else:
        anchor_contrib = "NONE"

    surface_shortcut_controlled = (
        "YES"
        if surf_base["retry_f1"] < 0.55 and strong_metrics["pair_accuracy"] > surf_base["retry_f1"] + 0.1
        else "PARTIAL"
        if strong_metrics["pair_accuracy"] > surf_base["retry_f1"]
        else "NO"
    )

    if not gate["gate_pass"]:
        verdict = "LEAKAGE"
    elif anchor_contrib in ("NONE",) and strong_metrics["pair_accuracy"] <= max(surf_base["retry_f1"], 0.5):
        verdict = "ANCHOR_SIGNAL_FAIL"
    elif anchor_contrib in ("MEASURABLE", "STRONG") and strong_metrics["pair_accuracy"] > surf_base["retry_f1"] + 0.05:
        if us_m["eligible"] >= 50 and (us_m["retry_f1"] < test_m["retry_f1"] - 0.15):
            verdict = "PASS_WITH_GENERALIZATION_GAPS"
        else:
            verdict = "PASS" if us_m["eligible"] >= 50 else "PASS_WITH_GENERALIZATION_GAPS"
    elif anchor_contrib == "WEAK":
        verdict = "PASS_WITH_GENERALIZATION_GAPS"
    else:
        verdict = "ANCHOR_SIGNAL_FAIL"

    next_phase = {
        "PASS": "MODEL3_V1_ANCHOR_CONTRAST_FULL_100K_THEN_TTS",
        "PASS_WITH_GENERALIZATION_GAPS": "MODEL3_V1_EXPAND_ANCHOR_CONTRAST_100K",
        "ANCHOR_SIGNAL_FAIL": "MODEL3_V1_ANCHOR_CONTRAST_CONSTRUCTION_REPAIR",
        "DATASET_FAIL": "MODEL3_V1_ANCHOR_CONTRAST_CONSTRUCTION_REPAIR",
        "LEAKAGE": "FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN",
    }.get(verdict, "REVIEW")

    bundle = {
        "phase": "MODEL3_V1_ANCHOR_DEPENDENT_DATASET_REDESIGN",
        "verdict": verdict,
        "distribution": dist,
        "entropy": ent,
        "leakage_gate": gate,
        "baselines": {
            "surface_lookup": surf_base,
            "pinyin_lookup_proxy_surface": pin_base,
            "linear": lin_m,
        },
        "training": {"history": history, "seconds": time.time() - t0, "config": config},
        "test_metrics": test_m,
        "anchor_zero": {"metrics": az_m, "flip": az_flip, "delta_f1": zero_delta},
        "anchor_shuffle": {"metrics": as_m, "flip": as_flip, "delta_f1": shuffle_delta},
        "anchor_contribution": anchor_contrib,
        "strong_contrast": strong_metrics,
        "generalization": {
            "unseen_surface": {"n": len(unseen_surf), "metrics": us_m},
            "unseen_family": {"n": len(unseen_fam), "metrics": uf_m},
            "unseen_anchor_context": {"n": len(unseen_ctx), "metrics": uc_m},
        },
        "comparison_vs_noleak": {
            "old_noleak_overall_f1_on_100k": 0.9950,
            "old_anchor_zero_delta": 0.0,
            "new_overall_f1": test_m["retry_f1"],
            "new_anchor_zero_delta": zero_delta,
            "new_strong_pair_accuracy": strong_metrics["pair_accuracy"],
            "noleak_on_pilot": noleak_comp,
        },
        "cpu": cpu,
        "model": {
            "name": MODEL_NAME,
            "params": sum(p.numel() for p in model.parameters()),
            "path": str(OUT.relative_to(REPO)).replace("\\", "/"),
        },
        "recall_validation": {
            "note": "RETRY requires referenceReachable=YES via production-equivalent Stage2 harness; unreachable contrast pairs filtered pre-train",
            "retry_spans": label_span.get("RETRY", 0),
            "filter": "contrast_group_requires_KEEP_and_REACHABLE_RETRY",
        },
        "design_notes": design_notes,
        "surface_shortcut_controlled": surface_shortcut_controlled,
        "go": {
            "dataset_forces_anchor_use": "YES"
            if anchor_contrib in ("STRONG", "MEASURABLE")
            else "PARTIAL"
            if anchor_contrib == "WEAK"
            else "NO",
            "bigru_suitable": True,
            "ready_expand_100k": verdict in ("PASS", "PASS_WITH_GENERALIZATION_GAPS"),
            "ready_tts": verdict == "PASS",
            "recommended_next_phase": next_phase,
        },
    }

    # merged docs (this phase: 3 files under docs/user_correction/model3/)
    holdout = {
        "unseen_surface_n": len(unseen_surf),
        "unseen_family_n": len(unseen_fam),
        "unseen_context_n": len(unseen_ctx),
        "hold_families": ["h_f", "eng_en"],
    }
    (DOCS / "model3_anchor_contrast_bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_anchor_contrast_governance.json").write_text(
        json.dumps(
            {
                "go_summary": {"phase": "MODEL3_V1_ANCHOR_DEPENDENT_DATASET_REDESIGN", "verdict": verdict, **bundle["go"]},
                "runtime_impact": {
                    "architecture_changed": False,
                    "domain_vote_changed": False,
                    "recall_changed": False,
                    "model2_changed": False,
                    "production_retry": False,
                    "tts": False,
                    "formal_anchor_enum_changed": False,
                },
                "holdout_manifest": holdout,
                "cpu_latency": cpu,
                "artifact_layout": {
                    "report": "Lingua_Model3_V1_Anchor_Dependent_Dataset_Pilot_Report_2026_08_24.md",
                    "metrics_bundle": "model3_anchor_contrast_bundle.json",
                    "governance": "model3_anchor_contrast_governance.json",
                    "dataset": "training/model3_dataset/model3_v1_anchor_contrast_pilot/",
                    "model": "training/model3_dataset/model3_v1_anchor_contrast_pilot_bigru/",
                },
                "modified_file_inventory": [
                    "training/model3_dataset/scripts/run_anchor_contrast_pilot.py",
                    "training/model3_dataset/scripts/expand_contrast_seed_pairs.py",
                    "training/model3_dataset/scripts/expand_multichar_contrast_seeds.py",
                    "training/model3_dataset/scripts/extract_reachable_seed_pairs.py",
                    "training/model3_dataset/train/train_anchor_contrast_pilot.py",
                    "training/model3_dataset/model3_v1_anchor_contrast_pilot/",
                    "training/model3_dataset/model3_v1_anchor_contrast_pilot_bigru/",
                    "docs/user_correction/model3/Lingua_Model3_V1_Anchor_Dependent_Dataset_Pilot_Report_2026_08_24.md",
                    "docs/user_correction/model3/model3_anchor_contrast_bundle.json",
                    "docs/user_correction/model3/model3_anchor_contrast_governance.json",
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    report = f"""# Lingua Model3 V1 Anchor-Dependent Contrast Dataset Pilot

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_ANCHOR_DEPENDENT_DATASET_REDESIGN`  
**Verdict:** `{verdict}`

## Dataset

| Metric | Value |
|--------|------:|
| Utterances | {total_utt} |
| KEEP / RETRY spans | {label_span['KEEP']} / {label_span['RETRY']} |
| RETRY ratio | {retry_ratio:.4f} |
| Anchor-conditioned | {anchor_utt} |
| NO_ANCHOR | {total_utt - anchor_utt} |
| STRONG pairs | {strong_pairs} |
| MEDIUM pairs | {medium_pairs} |
| Same-target different-label surfaces | {ent['mixed_label_surfaces']} |

## Shortcut baselines

| Baseline | RETRY F1 |
|----------|--------:|
| Surface lookup | {surf_base['retry_f1']:.4f} |
| Linear (noleak feats) | {lin_m['retry_f1']:.4f} |

Leakage gate stable: **{"YES" if gate['gate_pass'] else "NO"}**

## BiGRU `{MODEL_NAME}`

| Metric | Value |
|--------|------:|
| RETRY P/R/F1 | {test_m['retry_precision']:.4f} / {test_m['retry_recall']:.4f} / {test_m['retry_f1']:.4f} |
| False RETRY | {test_m['false_retry_rate']:.6f} |

## Anchor dependence

| Test | F1 | Flip |
|------|---:|-----:|
| Normal | {test_m['retry_f1']:.4f} | — |
| Anchor zero | {az_m['retry_f1']:.4f} | {az_flip['flip_rate']:.4f} |
| Anchor shuffle | {as_m['retry_f1']:.4f} | {as_flip['flip_rate']:.4f} |

**Contribution:** `{anchor_contrib}` · Zero ΔF1={zero_delta:.4f}

## Strong contrast

Pairs={strong_metrics['pairs']} · Pair accuracy={strong_metrics['pair_accuracy']:.4f} · Surface-dominated={strong_metrics['surface_dominated_rate']:.4f}

## Generalization

| Axis | N | RETRY F1 |
|------|--:|--------:|
| Unseen surface | {len(unseen_surf)} | {us_m['retry_f1']:.4f} |
| Held-out family | {len(unseen_fam)} | {uf_m['retry_f1']:.4f} |
| Unseen anchor context | {len(unseen_ctx)} | {uc_m['retry_f1']:.4f} |

## Performance

CPU p50/p95/p99 ms: {cpu['p50_ms']:.3f} / {cpu['p95_ms']:.3f} / {cpu['p99_ms']:.3f}

## Decision

- Dataset forces Anchor use: **{bundle['go']['dataset_forces_anchor_use']}**
- Surface shortcut controlled: **{surface_shortcut_controlled}**
- Ready expand 100k: **{bundle['go']['ready_expand_100k']}**
- Ready TTS: **{bundle['go']['ready_tts']}**
- Next: `{next_phase}`

## STOP

No 100k expansion · No TTS · No production RETRY · No Domain Vote/Recall/Model2 changes.
"""
    (DOCS / "Lingua_Model3_V1_Anchor_Dependent_Dataset_Pilot_Report_2026_08_24.md").write_text(
        report, encoding="utf-8"
    )
    print(json.dumps({"verdict": verdict, "anchor": anchor_contrib, "strong": strong_metrics, "go": bundle["go"]}, indent=2))


if __name__ == "__main__":
    main()
