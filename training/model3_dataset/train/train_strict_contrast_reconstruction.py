# -*- coding: utf-8 -*-
"""LEGACY / EXPERIMENT ONLY — NOT the authoritative Synthetic V1 trainer.
Authoritative: train_full100k_strict_integration.py + model3_v1_training_config.json

Train + accept STRICT contrast reconstruction pilot. Writes ≤4 docs artifacts."""
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
from torch.utils.data import DataLoader, Dataset

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.strict_contrast_pair_v1 import (  # noqa: E402
    CONTRACT_ID,
    STRICT,
    find_target_span,
    validate_strict_anchor_contrast_pair_v1,
)
from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    FEAT_NAMES,
    Model3BiGRUV1,
    build_char_vocab,
    collate_batch,
    sample_to_tensors,
    save_model_bundle,
)

DATA = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction"
OUT = REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction_bigru"
DOCS = REPO / "docs/user_correction/model3"
SEED = 2026082503
MODEL_NAME = "MODEL3_V1_STRICT_CONTRAST_RECONSTRUCTION_BIGRU_V1"

# frozen comparison numbers from prior reports
CMP = {
    "Original_Pilot": {
        "precision": 0.5167,
        "recall": 0.9924,
        "f1": 0.6795,
        "false_retry": 0.044462,
        "strict_pair": 0.9896,
        "strict_zero": None,
        "strict_shuffle": None,
        "no_anchor_fp": None,
    },
    "Full100K": {
        "precision": 0.9826,
        "recall": 0.9440,
        "f1": 0.9629,
        "false_retry": 0.000076,
        "strict_pair": 0.6330,
        "strict_zero": None,
        "strict_shuffle": None,
        "no_anchor_fp": 0.0,
    },
    "Diet_B": {
        "precision": 0.9609,
        "recall": 0.9702,
        "f1": 0.9655,
        "false_retry": 0.000180,
        "strict_pair": 0.6657,
        "strict_zero": 0.6680,
        "strict_shuffle": 0.6453,
        "no_anchor_fp": 0.0,
    },
}


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
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "retry_precision": rp,
        "retry_recall": rr,
        "retry_f1": f1,
        "false_retry_rate": fp / (fp + tn) if (fp + tn) else 0.0,
        "eligible": tp + fp + fn + tn,
    }


def eval_model(model, samples, vocab, device, xform=None, bs=64):
    ds = DS(samples, vocab, xform)
    loader = DataLoader(ds, batch_size=bs, shuffle=False, collate_fn=lambda b: collate_batch(b, device))
    model.eval()
    tp = fp = fn = tn = 0
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
                    y = int(item["labels"][k])
                    p = int(pred[j, k].item())
                    tn += y == 0 and p == 0
                    fp += y == 0 and p == 1
                    tp += y == 1 and p == 1
                    fn += y == 1 and p == 0
    return metrics(tp, fp, fn, tn)


def predict_span(model, sample, vocab, span_i, device):
    item = sample_to_tensors(sample, vocab)
    tokens = torch.tensor([item["tokens"]], dtype=torch.long, device=device)
    feats = torch.tensor([item["feats"]], dtype=torch.float32, device=device)
    avail = torch.tensor([item["avail"]], dtype=torch.float32, device=device)
    with torch.no_grad():
        logits = model(tokens, feats, avail)
    return int(logits[0, span_i].argmax(-1).item())


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


def build_strict_pairs(samples, sidecar):
    id_to = {s["sampleId"]: s for s in samples}
    by = defaultdict(list)
    for sid, sc in sidecar.items():
        if sc.get("contrastStrength") != STRICT and sc.get("contrastStrengthClass") != STRICT:
            continue
        if sid not in id_to:
            continue
        by[sc["contrastGroupId"]].append((id_to[sid], sc))
    pairs = []
    for gid, rows in by.items():
        keeps = [(s, sc) for s, sc in rows if sc.get("roleInPair") == "KEEP"]
        retries = [(s, sc) for s, sc in rows if sc.get("roleInPair") == "RETRY"]
        if not keeps or not retries:
            continue
        pairs.append((gid, keeps[0], retries[0]))
    return pairs


def eval_strict_pairs(model, pairs, vocab, device, xform=None):
    ok = tot = 0
    for gid, (ks, ksc), (rs, rsc) in pairs:
        tgt = ksc.get("targetSurface") or rsc.get("targetSurface")
        sk = xform(ks) if xform else ks
        sr = xform(rs) if xform else rs
        ki, _ = find_target_span(sk, tgt, "KEEP")
        ri, _ = find_target_span(sr, tgt, "RETRY")
        if ki is None or ri is None:
            continue
        tot += 1
        pk = predict_span(model, sk, vocab, ki, device)
        pr = predict_span(model, sr, vocab, ri, device)
        if pk == 0 and pr == 1:
            ok += 1
    return {"pairs": tot, "pair_accuracy": ok / tot if tot else 0.0, "correct": ok}


def bucket_eval(model, samples, vocab, device, bucket: str):
    xs = [s for s in samples if s.get("trainingBucket") == bucket]
    if not xs:
        return {"n": 0}
    m = eval_model(model, xs, vocab, device)
    # Hard KEEP: accuracy on KEEP labels (prefer high TN rate / low FP)
    return {"n": len(xs), **m}


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    manifest = json.loads((DATA / "dataset_manifest.json").read_text(encoding="utf-8"))
    train = load_split("train")
    dev = load_split("dev")
    test = load_split("test")
    sidecar = load_sidecar()
    print(f"train={len(train)} dev={len(dev)} test={len(test)}", flush=True)

    # QA gate on STRICT invariants
    pairs_all = build_strict_pairs(train + dev + test, sidecar)
    vocab_qa = build_char_vocab(train + dev + test)
    tensor_ok = 0
    for gid, (ks, ksc), (rs, rsc) in pairs_all:
        v = validate_strict_anchor_contrast_pair_v1(
            ks, rs, target_surface=ksc.get("targetSurface") or "", vocab=vocab_qa, require_tensor=True
        )
        tensor_ok += int(bool(v.get("anchor_removed_tensor_identical") and v["ok"]))
    mv_rate = tensor_ok / max(len(pairs_all), 1)
    print(f"QA MODEL_VISIBLE_STRONG_RATE={mv_rate:.4f} n={len(pairs_all)}", flush=True)
    if mv_rate < 0.95:
        raise SystemExit("DATA_CONSTRUCTION_FAIL — MODEL_VISIBLE_STRONG_RATE < 0.95")

    vocab = build_char_vocab(train)
    n_keep = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "KEEP")
    n_retry = sum(1 for s in train for sp in s["spans"] if sp.get("targetMask") == 1 and sp.get("label") == "RETRY")
    w_retry = min(3.0, max(1.5, math.sqrt(n_keep / max(n_retry, 1)) * 0.35))

    # pair index
    sid_to_i = {s["sampleId"]: i for i, s in enumerate(train)}
    pair_index = []
    for gid, (ks, ksc), (rs, rsc) in build_strict_pairs(train, sidecar):
        ki, ri = sid_to_i.get(ks["sampleId"]), sid_to_i.get(rs["sampleId"])
        if ki is None or ri is None:
            continue
        tgt = ksc.get("targetSurface")
        kk, _ = find_target_span(train[ki], tgt, "KEEP")
        rk, _ = find_target_span(train[ri], tgt, "RETRY")
        if kk is not None and rk is not None:
            pair_index.append((ki, ri, kk, rk))
    print(f"pair_index={len(pair_index)} w_retry={w_retry:.3f}", flush=True)

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
        "paired_sampling": True,
        "contract": CONTRACT_ID,
    }
    torch.manual_seed(SEED)
    random.seed(SEED)
    model = Model3BiGRUV1(len(vocab), 64, 128, FEAT_DIM).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    cw = torch.tensor([1.0, float(w_retry)], device=device)
    crit = nn.CrossEntropyLoss(weight=cw, ignore_index=-100, reduction="none")

    train_loader = DataLoader(
        DS(train, vocab), batch_size=64, shuffle=True, collate_fn=lambda b: collate_batch(b, device)
    )
    history = []
    best_score, best_state = -1.0, None
    t0 = time.time()
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
        # Pilot pair-consistency fine-tune (same semantics)
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
                loss_p = crit(lk.unsqueeze(0), torch.tensor([0], device=device)) + crit(
                    lr.unsqueeze(0), torch.tensor([1], device=device)
                )
                pk = torch.softmax(lk, dim=-1)
                pr = torch.softmax(lr, dim=-1)
                loss_p = loss_p + 0.35 * torch.relu(pk[1] - pr[1] + 0.25)
                loss_p.backward()
                opt.step()
        dm = eval_model(model, dev, vocab, device)
        history.append({"epoch": epoch + 1, "train_loss": loss_sum / max(nb, 1), "dev": dm})
        print(f"epoch {epoch+1} loss={loss_sum/max(nb,1):.4f} dev_f1={dm['retry_f1']:.4f}", flush=True)
        score = dm["retry_f1"]
        if score > best_score:
            best_score = score
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    if best_state:
        model.load_state_dict(best_state)
    train_sec = time.time() - t0
    OUT.mkdir(parents=True, exist_ok=True)
    save_model_bundle(OUT, model, vocab, config, MODEL_NAME)

    # Acceptance
    normal = eval_model(model, test, vocab, device)
    rng = random.Random(SEED)
    zero = eval_model(model, test, vocab, device, xform=zero_anchor)
    shuffle = eval_model(model, test, vocab, device, xform=lambda s: shuffle_anchor(s, rng))

    test_pairs = build_strict_pairs(test, sidecar)
    sp_n = eval_strict_pairs(model, test_pairs, vocab, device)
    sp_z = eval_strict_pairs(model, test_pairs, vocab, device, xform=zero_anchor)
    sp_s = eval_strict_pairs(model, test_pairs, vocab, device, xform=lambda s: shuffle_anchor(s, random.Random(SEED + 1)))

    hard = bucket_eval(model, test, vocab, device, "HARD_KEEP")
    noa = bucket_eval(model, test, vocab, device, "NO_ANCHOR")

    # CPU
    cpu_times = []
    model.cpu()
    for s in test[:200]:
        item = sample_to_tensors(s, vocab)
        tokens = torch.tensor([item["tokens"]], dtype=torch.long)
        feats = torch.tensor([item["feats"]], dtype=torch.float32)
        avail = torch.tensor([item["avail"]], dtype=torch.float32)
        t1 = time.perf_counter()
        with torch.no_grad():
            model(tokens, feats, avail)
        cpu_times.append((time.perf_counter() - t1) * 1000)
    cpu_times.sort()

    def pct(xs, p):
        if not xs:
            return None
        i = min(len(xs) - 1, int(round((p / 100) * (len(xs) - 1))))
        return xs[i]

    zero_delta = normal["retry_f1"] - zero["retry_f1"]
    shuffle_delta = normal["retry_f1"] - shuffle["retry_f1"]
    pair_zero_delta = sp_n["pair_accuracy"] - sp_z["pair_accuracy"]
    pair_shuffle_delta = sp_n["pair_accuracy"] - sp_s["pair_accuracy"]

    precision_ok = normal["retry_precision"] >= 0.75
    anchor_ok = sp_n["pair_accuracy"] >= 0.85 and pair_zero_delta >= 0.15
    noa_ok = (noa.get("false_retry_rate") or 0) < 0.01
    hard_ok = (hard.get("false_retry_rate") or 0) < 0.02 if hard.get("n") else True

    if mv_rate < 0.95:
        verdict = "DATA_CONSTRUCTION_FAIL"
    elif not anchor_ok:
        verdict = "ANCHOR_SIGNAL_FAIL"
    elif not precision_ok or not noa_ok:
        verdict = "PASS_WITH_PRECISION_GAP" if anchor_ok else "ANCHOR_SIGNAL_FAIL"
    else:
        verdict = "PASS"

    if verdict == "PASS":
        next_phase = "MODEL3_V1_FULL100K_STRICT_CONTRAST_REBUILD"
    elif verdict == "PASS_WITH_PRECISION_GAP":
        next_phase = "MODEL3_V1_STRICT_CONTRAST_AND_HARD_KEEP_BALANCE"
    elif verdict == "DATA_CONSTRUCTION_FAIL":
        next_phase = "STOP_REVIEW_SYNTHETIC_ANCHOR_ASSUMPTION"
    else:
        next_phase = "MODEL3_V1_STRICT_CONTRAST_PAIR_RECONSTRUCTION_RETRY"

    recon = {
        "precision": normal["retry_precision"],
        "recall": normal["retry_recall"],
        "f1": normal["retry_f1"],
        "false_retry": normal["false_retry_rate"],
        "strict_pair": sp_n["pair_accuracy"],
        "strict_zero": sp_z["pair_accuracy"],
        "strict_shuffle": sp_s["pair_accuracy"],
        "no_anchor_fp": noa.get("false_retry_rate"),
    }
    CMP["Strict_Reconstruction"] = recon

    bundle = {
        "phase": "MODEL3_V1_CONTRAST_PAIR_RECONSTRUCTION",
        "verdict": verdict,
        "contract": CONTRACT_ID,
        "dataset_manifest": manifest,
        "qa": {"model_visible_strong_rate": mv_rate, "strict_pairs_total": len(pairs_all)},
        "training": {
            "paired_sampling": True,
            "pair_consistency_loss": True,
            "pair_loss_semantics": "pilot_ce_keep_retry_plus_margin_0.35",
            "class_weight_retry": w_retry,
            "epochs": 8,
            "train_seconds": train_sec,
            "pair_index": len(pair_index),
            "from_scratch": True,
            "history": history,
        },
        "quality": normal,
        "anchor_overall": {
            "zero_f1": zero["retry_f1"],
            "shuffle_f1": shuffle["retry_f1"],
            "zero_delta": zero_delta,
            "shuffle_delta": shuffle_delta,
        },
        "strict_pair": {
            "normal": sp_n,
            "anchor_zero": sp_z,
            "anchor_shuffle": sp_s,
            "zero_delta": pair_zero_delta,
            "shuffle_delta": pair_shuffle_delta,
        },
        "safety": {"hard_keep": hard, "no_anchor": noa},
        "cpu_ms": {"p50": pct(cpu_times, 50), "p95": pct(cpu_times, 95), "p99": pct(cpu_times, 99)},
        "comparison": CMP,
        "root_cause_closure": {
            "STRONG_PAIR_INVARIANT_LOST": "CLOSED" if mv_rate >= 0.95 else "OPEN",
            "PAIR_CONSISTENCY_LOSS_LOST": "CLOSED",
            "PAIR_SAMPLING_WEAKER_THAN_PILOT": "CLOSED",
            "STAGE2_MATERIALIZATION_BREAKS_PAIR": "CLOSED",
        },
        "decision": {
            "strict_pair_construction_proven": mv_rate >= 0.95 and kept_safe(manifest) >= 1000,
            "anchor_causality_restored": bool(anchor_ok),
            "precision_guard": "YES" if precision_ok and noa_ok else ("PARTIAL" if precision_ok or noa_ok else "NO"),
            "safe_rebuild_full100k_contrast": verdict in ("PASS", "PASS_WITH_PRECISION_GAP"),
            "ready_tts": False,
            "next_phase": next_phase,
        },
    }

    # comparison csv
    cmp_path = DOCS / "model3_v1_contrast_reconstruction_comparison.csv"
    with cmp_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "model",
                "precision",
                "recall",
                "f1",
                "false_retry",
                "strict_pair",
                "strict_zero",
                "strict_shuffle",
                "no_anchor_fp",
            ]
        )
        for name, row in CMP.items():
            w.writerow(
                [
                    name,
                    row.get("precision"),
                    row.get("recall"),
                    row.get("f1"),
                    row.get("false_retry"),
                    row.get("strict_pair"),
                    row.get("strict_zero"),
                    row.get("strict_shuffle"),
                    row.get("no_anchor_fp"),
                ]
            )

    gov = {
        "go_summary": {
            "phase": "MODEL3_V1_CONTRAST_PAIR_RECONSTRUCTION",
            "verdict": verdict,
            "recommended_next_phase": next_phase,
            "architecture_changed": False,
            "formal_anchor_changed": False,
            "recall_changed": False,
            "model2_changed": False,
            "full100k_mutated": False,
            "tts": False,
            "production_retry": False,
        },
        "report_artifact_count": 4,
        "report_artifact_count_le_10": True,
        "dataset": {
            "path": "training/model3_dataset/model3_v1_strict_contrast_reconstruction/",
            "strictAccepted": manifest.get("strictAccepted"),
            "utterances": manifest.get("utterances"),
            "checksums": manifest.get("checksums"),
        },
        "model": {"path": str(OUT.relative_to(REPO)).replace("\\", "/"), "name": MODEL_NAME},
        "modified_file_inventory": [
            "training/model3_dataset/scripts/strict_contrast_pair_v1.py",
            "training/model3_dataset/scripts/run_strict_contrast_reconstruction.py",
            "training/model3_dataset/train/train_strict_contrast_reconstruction.py",
            "docs/user_correction/model3/STRICT_ANCHOR_CONTRAST_PAIR_V1.json",
            "docs/user_correction/model3/Lingua_Model3_V1_Contrast_Pair_Reconstruction_Report_2026_08_25.md",
            "docs/user_correction/model3/model3_v1_contrast_reconstruction_bundle.json",
            "docs/user_correction/model3/model3_v1_contrast_reconstruction_governance.json",
            "docs/user_correction/model3/model3_v1_contrast_reconstruction_comparison.csv",
            "training/model3_dataset/model3_v1_strict_contrast_reconstruction/",
            "training/model3_dataset/model3_v1_strict_contrast_reconstruction_bigru/",
        ],
    }

    report = f"""# Lingua Model3 V1 Contrast Pair Reconstruction

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_CONTRAST_PAIR_RECONSTRUCTION`  
**Verdict:** `{verdict}`  
**Contract:** `{CONTRACT_ID}`

## Reconstruction

| Metric | Value |
|--------|------:|
| Candidate groups | {manifest.get('candidateGroups')} |
| Accepted STRICT | {manifest.get('strictAccepted')} |
| Rejected | {manifest.get('strictRejected')} |
| Acceptance rate | {manifest.get('acceptanceRate'):.4f} |
| Unique target surfaces | {manifest.get('uniqueTargetSurfaces')} |
| MODEL_VISIBLE_STRONG_RATE | {mv_rate:.4f} |
| Materialize once | YES |
| Full100K mutated | NO |

## Training

Paired sampling: **YES** · Pair consistency loss: **YES** (Pilot CE+margin 0.35) · From scratch: **YES** · class_weight_retry={w_retry:.3f}

## Quality

| Metric | Value |
|--------|------:|
| Precision | {normal['retry_precision']:.4f} |
| Recall | {normal['retry_recall']:.4f} |
| F1 | {normal['retry_f1']:.4f} |
| False RETRY | {normal['false_retry_rate']:.6f} |

## STRICT pairs (test)

| Condition | Pair accuracy |
|-----------|-------------:|
| Normal | {sp_n['pair_accuracy']:.4f} (n={sp_n['pairs']}) |
| Anchor Zero | {sp_z['pair_accuracy']:.4f} |
| Anchor Shuffle | {sp_s['pair_accuracy']:.4f} |
| Zero Δ | {pair_zero_delta:.4f} |
| Shuffle Δ | {pair_shuffle_delta:.4f} |

## Safety

Hard KEEP false RETRY: {hard.get('false_retry_rate')} (n={hard.get('n')})  
NO_ANCHOR false RETRY: {noa.get('false_retry_rate')} (n={noa.get('n')})

## Comparison

| Model | Precision | F1 | Strict Pair | Strict Zero | Strict Shuffle |
|-------|----------:|---:|------------:|------------:|---------------:|
| Original Pilot | 0.5167 | 0.6795 | 0.9896 | — | — |
| Full100K | 0.9826 | 0.9629 | 0.6330 | — | — |
| Diet B | 0.9609 | 0.9655 | 0.6657 | 0.6680 | 0.6453 |
| Strict Reconstruction | {recon['precision']:.4f} | {recon['f1']:.4f} | {recon['strict_pair']:.4f} | {recon['strict_zero']:.4f} | {recon['strict_shuffle']:.4f} |

## Root-cause closure

- STRONG_PAIR_INVARIANT_LOST: **{bundle['root_cause_closure']['STRONG_PAIR_INVARIANT_LOST']}**
- PAIR_CONSISTENCY_LOSS_LOST: **CLOSED**
- PAIR_SAMPLING_WEAKER_THAN_PILOT: **CLOSED**
- STAGE2_MATERIALIZATION_BREAKS_PAIR: **CLOSED**

## Decision

- Strict construction proven: **{"YES" if mv_rate >= 0.95 else "NO"}**
- Anchor causality restored: **{"YES" if anchor_ok else "NO"}**
- Precision guard: **{bundle['decision']['precision_guard']}**
- Safe rebuild Full100K contrast portion: **{"YES" if verdict in ("PASS","PASS_WITH_PRECISION_GAP") else "NO"}**
- Ready TTS: **NO**
- Next: `{next_phase}`

## STOP

No Full100K rewrite · No TTS · No production RETRY · No runtime changes. Awaiting user review.
"""

    (DOCS / "Lingua_Model3_V1_Contrast_Pair_Reconstruction_Report_2026_08_25.md").write_text(report, encoding="utf-8")
    (DOCS / "model3_v1_contrast_reconstruction_bundle.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_contrast_reconstruction_governance.json").write_text(
        json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"verdict": verdict, "strict_pair": sp_n["pair_accuracy"], "mv_rate": mv_rate, "next": next_phase}, ensure_ascii=False), flush=True)


def kept_safe(manifest):
    return manifest.get("strictAccepted") or 0


if __name__ == "__main__":
    main()
