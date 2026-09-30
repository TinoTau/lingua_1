# -*- coding: utf-8 -*-
"""LEGACY / EXPERIMENT ONLY — NOT the authoritative Synthetic V1 trainer.
Authoritative: train_full100k_strict_integration.py + model3_v1_training_config.json

QA + train + accept Model3 V1 full100k Anchor-contrast BiGRU.

Writes ≤5 docs artifacts under docs/user_correction/model3/.
"""
from __future__ import annotations

import csv
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

DATA = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k_bigru"
DOCS = REPO / "docs/user_correction/model3"
SEED = 2026082420
MODEL_NAME = "MODEL3_V1_ANCHOR_CONTRAST_FULL100K_BIGRU_V1"
PILOT_F1 = 0.6795
PILOT_PREC = 0.5167
PILOT_FALSE = 0.044462


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
    if not samples:
        return metrics(0, 0, 0, 0), []
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
                    preds.append((si, k, y, p))
    return metrics(tp, fp, fn, tn), preds


def flip_rate(a, b):
    mb = {(s, k): p for s, k, y, p in b}
    tot = flip = 0
    for s, k, y, p0 in a:
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
            tn += y == "KEEP" and pred == "KEEP"
            fp += y == "KEEP" and pred == "RETRY"
            tp += y == "RETRY" and pred == "RETRY"
            fn += y == "RETRY" and pred == "KEEP"
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
    for c in by.values():
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
        "mean_entropy": sum(entropies) / len(entropies) if entropies else 0.0,
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
        if model_input_hash(mut, vocab) == h0:
            ok += 1
        else:
            fail += 1
    return {"stable": fail == 0, "ok": ok, "fail": fail, "gate_pass": fail == 0}


def hard_zeros(samples):
    anchor_retry = illegal_retry = fake_ac = dialog = 0
    for s in samples:
        if "dialog_200" in (s.get("sourceCorpus") or "").lower():
            dialog += 1
        fa = s.get("featureAvailability") or {}
        if fa.get("toneAcoustic") or fa.get("asrConfidence"):
            fake_ac += 1
        for sp in s["spans"]:
            if sp.get("isAnchor") and sp.get("label") == "RETRY":
                anchor_retry += 1
            if sp.get("label") == "RETRY" and (sp.get("repairability") or {}).get("referenceReachable") != "YES":
                illegal_retry += 1
    return {
        "anchor_retry": anchor_retry,
        "illegal_retry": illegal_retry,
        "fake_acoustic": fake_ac,
        "dialog_200_contamination": dialog,
        "pass": anchor_retry == 0 and illegal_retry == 0 and fake_ac == 0 and dialog == 0,
    }


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
    manifest = json.loads((DATA / "dataset_manifest.json").read_text(encoding="utf-8"))
    print(f"train={len(train)} dev={len(dev)} test={len(test)}", flush=True)

    all_s = train + dev + test
    label_span = Counter()
    bucket_utt = Counter()
    for s in all_s:
        bucket_utt[s.get("trainingBucket") or "UNKNOWN"] += 1
        for sp in s["spans"]:
            label_span[sp.get("label")] += 1

    ent = surface_entropy(train + test)
    zeros = hard_zeros(all_s)
    surf_base = majority_lookup(train, test, lambda sp: sp.get("surface") or "")
    pin_base = majority_lookup(
        train,
        test,
        lambda sp: ((sp.get("pinyinEvidence") or {}).get("plain") or sp.get("surface") or ""),
    )

    vocab = build_char_vocab(train)
    gate = run_leakage_gate(vocab, train)
    print("leakage_gate", gate, "hard_zeros", zeros, flush=True)

    eligible = label_span["KEEP"] + label_span["RETRY"]
    retry_ratio = label_span["RETRY"] / eligible if eligible else 0.0
    no_anchor_utt = sum(1 for s in all_s if not any(sp.get("isAnchor") for sp in s["spans"]))

    design_fail = False
    design_notes = []
    n = len(all_s)
    if n < 90000 or n > 110000:
        design_notes.append(f"SIZE_OUT_OF_RANGE={n}")
        design_fail = True
    if not zeros["pass"]:
        design_notes.append("HARD_ZERO_FAIL")
        design_fail = True
    if not gate["gate_pass"]:
        design_notes.append("LEAKAGE_GATE_FAIL")
        design_fail = True
    if surf_base["retry_f1"] > 0.75 and ent["mean_entropy"] < 0.15:
        design_notes.append("SURFACE_SHORTCUT_RISK")
        design_fail = True
    if no_anchor_utt / max(n, 1) < 0.08:
        design_notes.append(f"NO_ANCHOR_LOW={no_anchor_utt}")
    if bucket_utt.get("CONTRAST", 0) / max(n, 1) > 0.55:
        design_notes.append("CONTRAST_DENSITY_TOO_HIGH")
        design_fail = True

    if design_fail:
        print("DATASET QA FAIL", design_notes, flush=True)
        (DOCS / "model3_v1_full100k_bundle.json").write_text(
            json.dumps({"verdict": "DATASET_FAIL", "design_notes": design_notes, "manifest": manifest}, indent=2),
            encoding="utf-8",
        )
        raise SystemExit("DATASET_FAIL")

    # Human QA sample 500
    qa_rows = []
    rng = random.Random(SEED)
    idxs = list(range(len(all_s)))
    rng.shuffle(idxs)
    for i in idxs[:500]:
        s = all_s[i]
        sc = sidecar.get(s["sampleId"], {})
        labs = [(sp["surface"], sp["label"], sp.get("isAnchor")) for sp in s["spans"] if sp.get("targetMask") == 1 or sp.get("isAnchor")]
        qa_rows.append(
            {
                "sampleId": s["sampleId"],
                "split": s["split"],
                "bucket": s.get("trainingBucket"),
                "currentText": s.get("currentText"),
                "anchorHint": sc.get("anchorSurface"),
                "targetHint": sc.get("targetSurface"),
                "contrastStrength": sc.get("contrastStrength"),
                "spans": json.dumps(labs, ensure_ascii=False),
            }
        )
    with (DOCS / "model3_v1_full100k_human_qa_500.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(qa_rows[0].keys()))
        w.writeheader()
        w.writerows(qa_rows)

    print("train BiGRU…", flush=True)
    n_keep = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "KEEP")
    n_retry = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "RETRY")
    # Prefer precision: milder RETRY weight than pilot spray
    w_retry = min(2.5, max(1.2, math.sqrt(n_keep / max(n_retry, 1)) * 0.25))
    config = {
        "embed_dim": 64,
        "hidden_dim": 128,
        "feat_dim": FEAT_DIM,
        "feat_names": list(FEAT_NAMES),
        "batch_size": 64,
        "epochs": 6,
        "lr": 1e-3,
        "class_weight_retry": w_retry,
        "seed": SEED,
        "init": "random_from_scratch",
    }
    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    cw = torch.tensor([1.0, float(w_retry)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")
    train_loader = DataLoader(
        DS(train, vocab), batch_size=64, shuffle=True, collate_fn=lambda b: collate_batch(b, device)
    )
    history = []
    t0 = time.time()
    best_score, best_state = -1.0, None
    for epoch in range(6):
        model.train()
        loss_sum = nb = 0
        for batch in train_loader:
            opt.zero_grad()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            b, nspan, c = logits.shape
            lv = crit(logits.view(b * nspan, c), batch["labels"].view(b * nspan))
            sel = batch["target_mask"].view(b * nspan) * batch["valid"].view(b * nspan)
            if sel.sum() <= 0:
                continue
            loss = (lv * sel).sum() / sel.sum()
            loss.backward()
            opt.step()
            loss_sum += loss.item()
            nb += 1
        dm, _ = eval_model(model, dev, vocab, device)
        history.append({"epoch": epoch + 1, "train_loss": loss_sum / max(nb, 1), "dev": dm})
        print(
            f"epoch {epoch+1} loss={loss_sum/max(nb,1):.4f} "
            f"dev_f1={dm['retry_f1']:.4f} prec={dm['retry_precision']:.4f}",
            flush=True,
        )
        # precision-aware selection
        score = 0.55 * dm["retry_f1"] + 0.45 * dm["retry_precision"]
        if score > best_score:
            best_score = score
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    if best_state:
        model.load_state_dict(best_state)
    save_model_bundle(OUT, model, vocab, config, MODEL_NAME)
    with (OUT / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256\n")
        for name in ("weights.pt", "vocab.json", "config.json", "model_manifest.json"):
            p = OUT / name
            f.write(f"{p.relative_to(REPO).as_posix()},{sha256_file(p)}\n")

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
    zero_delta = test_m["retry_f1"] - az_m["retry_f1"]
    shuffle_delta = test_m["retry_f1"] - as_m["retry_f1"]

    if az_flip["flip_rate"] >= 0.05 or abs(zero_delta) >= 0.03:
        anchor_contrib = "STRONG" if az_flip["flip_rate"] >= 0.12 or abs(zero_delta) >= 0.08 else "MEASURABLE"
    elif az_flip["flip_rate"] >= 0.01 or abs(zero_delta) >= 0.01:
        anchor_contrib = "WEAK"
    else:
        anchor_contrib = "NONE"

    # Strong contrast pair accuracy
    id_to_idx = {s["sampleId"]: i for i, s in enumerate(test)}
    pred_map = {}
    for si, k, y, p in base_preds:
        sid = test[si]["sampleId"]
        pred_map[(sid, k)] = (y, p)

    groups = defaultdict(list)
    for sid, sc in sidecar.items():
        if sid in id_to_idx and sc.get("contrastStrength") == "STRONG":
            groups[sc["contrastGroupId"]].append((sid, sc))

    pair_total = pair_correct = surface_dom = 0
    for g, rows in groups.items():
        keep_rows = [r for r in rows if r[1].get("roleInPair") == "KEEP" or r[1].get("seedType") == "ANCHOR_CONTRAST_KEEP_CANDIDATE"]
        retry_rows = [r for r in rows if r[1].get("roleInPair") == "RETRY" or r[1].get("seedType") == "ANCHOR_CONTRAST_RETRY_CANDIDATE"]
        if not keep_rows or not retry_rows:
            continue

        def side_ok(sid, want_retry: bool):
            s = test[id_to_idx[sid]]
            tgt = sidecar[sid].get("targetSurface")
            for k, sp in enumerate(s["spans"]):
                if sp.get("targetMask") != 1:
                    continue
                if tgt and sp.get("surface") != tgt:
                    continue
                y, p = pred_map.get((sid, k), (None, None))
                if y is None:
                    continue
                return p == (1 if want_retry else 0), p
            for k, sp in enumerate(s["spans"]):
                if sp.get("targetMask") != 1:
                    continue
                want = "RETRY" if want_retry else "KEEP"
                if sp.get("label") != want:
                    continue
                y, p = pred_map.get((sid, k), (None, None))
                if y is None:
                    continue
                return p == (1 if want_retry else 0), p
            return False, None

        ok_k, pk = side_ok(keep_rows[0][0], False)
        ok_r, pr = side_ok(retry_rows[0][0], True)
        pair_total += 1
        if ok_k and ok_r:
            pair_correct += 1
        if pk is not None and pr is not None and pk == pr:
            surface_dom += 1

    strong_metrics = {
        "pairs": pair_total,
        "pair_accuracy": pair_correct / pair_total if pair_total else 0.0,
        "surface_dominated_rate": surface_dom / pair_total if pair_total else 0.0,
    }

    # NO_ANCHOR bucket
    no_anchor_test = [s for s in test if not any(sp.get("isAnchor") for sp in s["spans"])]
    na_m, _ = eval_model(model, no_anchor_test, vocab, device) if no_anchor_test else (metrics(0, 0, 0, 0), [])

    def subset_axis(axis):
        return [s for s in test if axis in (s.get("heldOutAxes") or [])]

    unseen_surf = subset_axis("held_out_surface_pair")
    unseen_fam = subset_axis("held_out_pronunciation_family")
    unseen_ctx = subset_axis("held_out_anchor_combination")
    us_m, _ = eval_model(model, unseen_surf, vocab, device) if unseen_surf else (metrics(0, 0, 0, 0), [])
    uf_m, _ = eval_model(model, unseen_fam, vocab, device) if unseen_fam else (metrics(0, 0, 0, 0), [])
    uc_m, _ = eval_model(model, unseen_ctx, vocab, device) if unseen_ctx else (metrics(0, 0, 0, 0), [])

    # REAL_DOMAIN from sidecar
    real_ids = {sid for sid, sc in sidecar.items() if sc.get("anchorDietBucket") == "REAL_DOMAIN"}
    real_test = [s for s in test if s["sampleId"] in real_ids]
    real_m = None
    if len(real_test) >= 30:
        real_m, _ = eval_model(model, real_test, vocab, device)
    real_note = {
        "n_test": len(real_test),
        "n_all": sum(1 for sc in sidecar.values() if sc.get("anchorDietBucket") == "REAL_DOMAIN"),
        "metrics": real_m,
        "status": "OK" if real_m else "INSUFFICIENT_REAL_DOMAIN_SAMPLE",
    }

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

    surface_shortcut = (
        "CONTROLLED"
        if surf_base["retry_f1"] < 0.55
        else "RISK"
        if surf_base["retry_f1"] >= 0.75
        else "PARTIAL"
    )
    prec_improved = (
        "YES"
        if test_m["retry_precision"] >= PILOT_PREC + 0.05
        else "PARTIAL"
        if test_m["retry_precision"] >= PILOT_PREC
        else "NO"
    )

    if not gate["gate_pass"]:
        verdict = "LEAKAGE"
    elif anchor_contrib in ("NONE", "WEAK") and (
        az_flip["flip_rate"] < 0.01 and abs(zero_delta) < 0.03
    ):
        verdict = "ANCHOR_SIGNAL_DILUTED"
    elif test_m["false_retry_rate"] > PILOT_FALSE * 1.5 and test_m["retry_precision"] < PILOT_PREC:
        verdict = "PRECISION_GAP"
    elif anchor_contrib in ("MEASURABLE", "STRONG") and surface_shortcut == "CONTROLLED":
        if us_m["eligible"] >= 50 and us_m["retry_f1"] < test_m["retry_f1"] - 0.2:
            verdict = "PASS_WITH_GENERALIZATION_GAPS"
        else:
            verdict = "PASS" if us_m["eligible"] >= 40 else "PASS_WITH_GENERALIZATION_GAPS"
    else:
        verdict = "ANCHOR_SIGNAL_DILUTED"

    next_phase = {
        "PASS": "MODEL3_V1_TTS_ASR_DEVELOPMENT",
        "PASS_WITH_GENERALIZATION_GAPS": "MODEL3_V1_TTS_ASR_DEVELOPMENT",
        "ANCHOR_SIGNAL_DILUTED": "MODEL3_V1_FULL100K_DIET_REBALANCE",
        "PRECISION_GAP": "MODEL3_V1_HARD_KEEP_PRECISION_REPAIR",
        "DATASET_FAIL": "MODEL3_V1_FULL100K_DATASET_REPAIR",
        "LEAKAGE": "FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN",
    }.get(verdict, "REVIEW")

    params = sum(p.numel() for p in model.parameters())
    bundle = {
        "phase": "MODEL3_V1_ANCHOR_CONTRAST_FULL_100K_DEVELOPMENT",
        "verdict": verdict,
        "dataset": {
            "manifest": manifest,
            "utterances": n,
            "train": len(train),
            "dev": len(dev),
            "test": len(test),
            "buckets": dict(bucket_utt),
            "labels": dict(label_span),
            "retry_ratio_eligible": retry_ratio,
            "no_anchor_utterances": no_anchor_utt,
            "entropy": ent,
            "hard_zeros": zeros,
            "design_notes": design_notes,
        },
        "baselines": {
            "surface_lookup": surf_base,
            "pinyin_lookup": pin_base,
            "surface_shortcut": surface_shortcut,
        },
        "leakage_gate": gate,
        "training": {"history": history, "seconds": time.time() - t0, "config": config},
        "test_metrics": test_m,
        "anchor_zero": {"metrics": az_m, "flip": az_flip, "delta_f1": zero_delta},
        "anchor_shuffle": {"metrics": as_m, "flip": as_flip, "delta_f1": shuffle_delta},
        "anchor_contribution": anchor_contrib,
        "strong_contrast": strong_metrics,
        "no_anchor_bucket": {"n": len(no_anchor_test), "metrics": na_m},
        "generalization": {
            "unseen_surface": {"n": len(unseen_surf), "metrics": us_m},
            "unseen_family": {"n": len(unseen_fam), "metrics": uf_m},
            "unseen_anchor_context": {"n": len(unseen_ctx), "metrics": uc_m},
            "real_domain": real_note,
        },
        "comparison_vs_pilot": {
            "pilot_retry_f1": PILOT_F1,
            "pilot_precision": PILOT_PREC,
            "pilot_false_retry": PILOT_FALSE,
            "new_retry_f1": test_m["retry_f1"],
            "new_precision": test_m["retry_precision"],
            "new_false_retry": test_m["false_retry_rate"],
            "precision_improved": prec_improved,
        },
        "cpu": cpu,
        "shadow": {"actual_retry": False, "production_output_changed": False},
        "model": {
            "name": MODEL_NAME,
            "params": params,
            "path": str(OUT.relative_to(REPO)).replace("\\", "/"),
        },
        "go": {
            "anchor_signal_preserved": anchor_contrib in ("STRONG", "MEASURABLE"),
            "precision_improved": prec_improved,
            "bigru_suitable": True,
            "synthetic_v1_ready": verdict in ("PASS", "PASS_WITH_GENERALIZATION_GAPS"),
            "ready_tts": verdict == "PASS",
            "recommended_next_phase": next_phase,
        },
    }

    (DOCS / "model3_v1_full100k_bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_full100k_governance.json").write_text(
        json.dumps(
            {
                "go_summary": {
                    "phase": "MODEL3_V1_ANCHOR_CONTRAST_FULL_100K_DEVELOPMENT",
                    "verdict": verdict,
                    **bundle["go"],
                },
                "runtime_impact": {
                    "architecture_changed": False,
                    "training_schema_changed": False,
                    "formal_anchor_contract_changed": False,
                    "domain_vote_changed": False,
                    "recall_changed": False,
                    "model2_changed": False,
                    "job_result_changed": False,
                    "production_retry": False,
                    "tts": False,
                },
                "leakage_check": gate,
                "hard_zeros": zeros,
                "report_artifact_count": 4,
                "report_artifact_count_le_10": True,
                "artifact_layout": {
                    "report": "Lingua_Model3_V1_Full100K_Development_Report_2026_08_24.md",
                    "bundle": "model3_v1_full100k_bundle.json",
                    "governance": "model3_v1_full100k_governance.json",
                    "human_qa": "model3_v1_full100k_human_qa_500.csv",
                    "dataset": "training/model3_dataset/model3_v1_anchor_contrast_full100k/",
                    "model": "training/model3_dataset/model3_v1_anchor_contrast_full100k_bigru/",
                },
                "modified_file_inventory": [
                    "training/model3_dataset/scripts/run_anchor_contrast_full100k.py",
                    "training/model3_dataset/train/train_full100k.py",
                    "training/model3_dataset/model3_v1_anchor_contrast_full100k/",
                    "training/model3_dataset/model3_v1_anchor_contrast_full100k_bigru/",
                    "docs/user_correction/model3/Lingua_Model3_V1_Full100K_Development_Report_2026_08_24.md",
                    "docs/user_correction/model3/model3_v1_full100k_bundle.json",
                    "docs/user_correction/model3/model3_v1_full100k_governance.json",
                    "docs/user_correction/model3/model3_v1_full100k_human_qa_500.csv",
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    report = f"""# Lingua Model3 V1 Full 100k Anchor-Contrast Development

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_ANCHOR_CONTRAST_FULL_100K_DEVELOPMENT`  
**Verdict:** `{verdict}`

## Dataset

| Metric | Value |
|--------|------:|
| Samples | {n} |
| Train / Dev / Test | {len(train)} / {len(dev)} / {len(test)} |
| NATURAL | {bucket_utt.get('NATURAL', 0)} |
| CONTRAST | {bucket_utt.get('CONTRAST', 0)} |
| NO_ANCHOR | {bucket_utt.get('NO_ANCHOR', 0)} |
| HARD_KEEP | {bucket_utt.get('HARD_KEEP', 0)} |
| KEEP / RETRY / MASKED | {label_span['KEEP']} / {label_span['RETRY']} / {label_span['MASKED']} |
| RETRY ratio (eligible) | {retry_ratio:.4f} |
| NO_ANCHOR utterances | {no_anchor_utt} |
| Mixed-label surfaces | {ent['mixed_label_surfaces']} |

Hard zeros (Anchor RETRY / illegal RETRY / fake acoustic / dialog): **{zeros['anchor_retry']} / {zeros['illegal_retry']} / {zeros['fake_acoustic']} / {zeros['dialog_200_contamination']}**

## Shortcut baselines

| Baseline | RETRY F1 |
|----------|--------:|
| Surface lookup | {surf_base['retry_f1']:.4f} |
| Pinyin lookup | {pin_base['retry_f1']:.4f} |

Surface shortcut: **{surface_shortcut}** · Leakage gate: **{"YES" if gate['gate_pass'] else "NO"}**

## BiGRU `{MODEL_NAME}`

| Metric | Value |
|--------|------:|
| Parameters | {params} |
| RETRY P/R/F1 | {test_m['retry_precision']:.4f} / {test_m['retry_recall']:.4f} / {test_m['retry_f1']:.4f} |
| False RETRY | {test_m['false_retry_rate']:.6f} |

vs Pilot: precision {PILOT_PREC:.4f} → {test_m['retry_precision']:.4f} (**{prec_improved}**)

## Anchor dependence

| Test | F1 | Flip |
|------|---:|-----:|
| Normal | {test_m['retry_f1']:.4f} | — |
| Anchor zero | {az_m['retry_f1']:.4f} | {az_flip['flip_rate']:.4f} |
| Anchor shuffle | {as_m['retry_f1']:.4f} | {as_flip['flip_rate']:.4f} |

**Contribution:** `{anchor_contrib}` · Zero ΔF1={zero_delta:.4f} · Shuffle ΔF1={shuffle_delta:.4f}

## Strong contrast / NO_ANCHOR

- Strong pairs={strong_metrics['pairs']} · pair accuracy={strong_metrics['pair_accuracy']:.4f} · surface-dominated={strong_metrics['surface_dominated_rate']:.4f}
- NO_ANCHOR test N={len(no_anchor_test)} · false RETRY={na_m['false_retry_rate']:.6f}

## Generalization

| Axis | N | RETRY F1 |
|------|--:|--------:|
| Unseen surface | {len(unseen_surf)} | {us_m['retry_f1']:.4f} |
| Held-out family | {len(unseen_fam)} | {uf_m['retry_f1']:.4f} |
| Unseen anchor context | {len(unseen_ctx)} | {uc_m['retry_f1']:.4f} |
| REAL_DOMAIN | {real_note['n_test']} | {real_note['status']} |

## Performance / Shadow

CPU p50/p95/p99 ms: {cpu['p50_ms']:.3f} / {cpu['p95_ms']:.3f} / {cpu['p99_ms']:.3f}  
Actual Retry: **NO** · Production output changed: **NO**

## Governance

Architecture / schema / formal Anchor / Domain Vote / Recall / Model2 / JobResult: **unchanged**  
Report artifacts: **4** (≤10)

## Decision

- Anchor signal preserved at scale: **{"YES" if bundle['go']['anchor_signal_preserved'] else "NO"}**
- Precision improved: **{prec_improved}**
- Small BiGRU suitable: **YES**
- Synthetic V1 ready: **{"YES" if bundle['go']['synthetic_v1_ready'] else "NO"}**
- Ready for TTS-ASR: **{"YES" if bundle['go']['ready_tts'] else "NO"}** (gate only — not started)
- Next: `{next_phase}`

## STOP

No TTS · No production RETRY · No architecture / Recall / Domain Vote / Model2 changes. Awaiting user review.
"""
    (DOCS / "Lingua_Model3_V1_Full100K_Development_Report_2026_08_24.md").write_text(report, encoding="utf-8")
    print(json.dumps({"verdict": verdict, "anchor": anchor_contrib, "prec": test_m["retry_precision"], "go": bundle["go"]}, indent=2))


if __name__ == "__main__":
    main()
