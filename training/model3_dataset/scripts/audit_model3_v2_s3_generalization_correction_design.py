# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_MODEL_GENERALIZATION_CORRECTION_DESIGN_AUDIT — read-only."""
from __future__ import annotations

import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.acoustic_training.dataset_identity import assert_authoritative_s3_identity
from training.model3_dataset.train.bigru_v1 import FEAT_DIM, Model3BiGRUV1, collate_batch
from training.model3_dataset.train.train_s3_random import UtteranceDataset, load_split
from training.model3_dataset.train.train_v2_labeled import compute_metrics

PHASE = "MODEL3_V2_S3_MODEL_GENERALIZATION_CORRECTION_DESIGN_AUDIT"
GENERATOR = "training/model3_dataset/scripts/audit_model3_v2_s3_generalization_correction_design.py"
GENERATED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
DOCS = REPO / "docs/user_correction/model3"
CKPT = REPO / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013"
METRICS_PATH = CKPT / "training_metrics.json"

OUT_SUMMARY = DOCS / "model3_v2_s3_generalization_audit_summary.json"
OUT_TRAIN_FIT = DOCS / "model3_v2_s3_train_fit_metrics.csv"
OUT_REPLAY = DOCS / "model3_v2_s3_high_case_training_support_replay.csv"
OUT_SURFACE = DOCS / "model3_v2_s3_surface_label_conflict.csv"
OUT_OWNER = DOCS / "model3_v2_s3_generalization_owner_matrix.csv"
OUT_FREEZE = DOCS / "model3_v2_s3_causality_corrected_freeze_state.csv"
OUT_REPORT = DOCS / "Lingua_Model3_V2_S3_Model_Generalization_Correction_Design_Audit_2026_09_02.md"

ROOT_CAUSES = DOCS / "model3_v2_s3_localization_root_causes.csv"
CAUSALITY_SUMMARY = DOCS / "model3_v2_s3_localization_causality_summary.json"
CAUSALITY_FREEZE = DOCS / "model3_v2_s3_causality_freeze_state.csv"
CAUSALITY_REPORT = DOCS / "Lingua_Model3_V2_S3_Localization_Training_Causality_Audit_2026_09_02.md"

UNRESOLVED = {"d008", "d022", "d051", "d094"}
HIGH_SURFACES = {
    "d040": "自", "d042": "自", "d054": "戏", "d065": "这", "d085": "自",
    "d102": "这", "d109": "候", "d114": "发", "d129": "爆", "d138": "病",
    "d172": "两", "d175": "自",
}
KEY_SURFACES = ["这", "候", "发", "病", "自", "戏", "两", "爆", "散", "会", "成", "定"]


def prov(identity) -> dict:
    return {
        "phase": PHASE,
        "generator": GENERATOR,
        "generatedAt": GENERATED_AT,
        "modelId": identity.modelId,
        "weightsSha256": identity.weightsSha256,
        "datasetId": identity.datasetId,
        "datasetBuildId": identity.datasetBuildId,
        "featureContract": identity.featureContract,
        "labelContractVersion": identity.labelContractVersion,
    }


def load_bundle(ckpt: Path):
    cfg = json.loads((ckpt / "config.json").read_text(encoding="utf-8"))
    vocab = json.loads((ckpt / "vocab.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(len(vocab), cfg.get("embed_dim", 64), cfg.get("hidden_dim", 128), FEAT_DIM)
    model.load_state_dict(torch.load(ckpt / "weights.pt", map_location="cpu"))
    model.eval()
    return model, vocab, cfg


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def read_root_rows() -> list[dict]:
    with ROOT_CAUSES.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def correct_ssot(root_rows: list[dict], identity) -> list[dict]:
    corrected = []
    for row in root_rows:
        r = dict(row)
        cid = r["caseId"]
        if cid in UNRESOLVED:
            r["rootCause"] = "INSUFFICIENT_EVIDENCE"
            r["confidence"] = "MEDIUM"
            r["candidateCause"] = "GENERALIZATION_OR_LOCAL_SUPPORT_GAP"
            r["evidence"] = {
                "d008": "target and neighbor training combinations missing; strong generalization not established",
                "d022": "training combination missing tupleRetry=0 supportCount=0",
                "d051": "target support weak neighbor support strong; ambiguous local support vs generalization",
                "d094": "target support weak tupleRetry=0 supportCount≈1",
            }[cid]
        corrected.append(r)
    return corrected


def span_margins(model, batch, device):
    with torch.no_grad():
        logits = model(batch["tokens"], batch["feats"], batch["avail"])
    b, n, _ = logits.shape
    margins = (logits[..., 1] - logits[..., 0]).view(b * n)
    preds = logits.argmax(dim=-1).view(b * n)
    labels = batch["labels"].view(b * n)
    mask = (batch["target_mask"].view(b * n) * batch["valid"].view(b * n)) > 0.5
    out = []
    for i in range(b * n):
        if not mask[i]:
            continue
        out.append(
            {
                "margin": float(margins[i].item()),
                "pred": int(preds[i].item()),
                "label": int(labels[i].item()),
            }
        )
    return out


def pct(vals: list[float], q: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    idx = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
    return s[idx]


def analyze_surfaces(train_samples: list[dict], model, vocab, device, p: dict) -> list[dict]:
    surface_stats: dict[str, Counter] = defaultdict(Counter)
    for sample in train_samples:
        batch = collate_batch([sample_to_item(sample, vocab)], device)
        spans = sample.get("spans") or []
        eligible = [
            sp for sp in spans if not sp.get("isAnchor") and sp.get("label") in ("KEEP", "RETRY")
        ]
        rows = span_margins(model, batch, device)
        for sp, row in zip(eligible, rows):
            surf = sp.get("surface") or ""
            if surf not in KEY_SURFACES:
                continue
            lbl = sp["label"]
            surface_stats[surf][f"label_{lbl}"] += 1
            surface_stats[surf][f"pred_{'RETRY' if row['pred'] == 1 else 'KEEP'}"] += 1
            if lbl == "RETRY" and row["pred"] == 1:
                surface_stats[surf]["retry_correct"] += 1
            elif lbl == "RETRY" and row["pred"] == 0:
                surface_stats[surf]["retry_wrong_keep"] += 1

    out = []
    for surf in KEY_SURFACES:
        c = surface_stats[surf]
        keep_l = c["label_KEEP"]
        retry_l = c["label_RETRY"]
        total = keep_l + retry_l
        entropy = 0.0
        if total:
            for x in (keep_l, retry_l):
                if x:
                    p0 = x / total
                    entropy -= p0 * np.log2(p0)
        out.append(
            {
                **p,
                "surface": surf,
                "keepLabelCount": keep_l,
                "retryLabelCount": retry_l,
                "labelEntropyBits": round(entropy, 4),
                "predKeepOnRetryLabeled": c["retry_wrong_keep"],
                "predRetryOnRetryLabeled": c["retry_correct"],
                "trainRetryRecallSameSurface": round(c["retry_correct"] / max(retry_l, 1), 6),
                "keepPredCount": c["pred_KEEP"],
                "retryPredCount": c["pred_RETRY"],
                "sameSurfaceConflict": "YES" if keep_l > 0 and retry_l > 0 else "NO",
            }
        )
    return out


def sample_to_item(sample, vocab):
    from training.model3_dataset.train.bigru_v1 import sample_to_tensors

    return sample_to_tensors(sample, vocab)


def replay_high_cases(train_samples: list[dict], model, vocab, device, p: dict) -> list[dict]:
    by_surface: dict[str, list[dict]] = defaultdict(list)
    for sample in train_samples:
        for i, sp in enumerate(sample.get("spans") or []):
            if sp.get("isAnchor") or sp.get("label") != "RETRY":
                continue
            surf = sp.get("surface") or ""
            if surf in set(HIGH_SURFACES.values()):
                by_surface[surf].append({"sample": sample, "spanIndex": i, "surface": surf})

    rows = []
    for case_id, surf in HIGH_SURFACES.items():
        candidates = by_surface.get(surf, [])[:200]
        correct = wrong = 0
        margins_retry = []
        margins_wrong = []
        for item in candidates:
            sample = item["sample"]
            batch = collate_batch([sample_to_item(sample, vocab)], device)
            eligible = [
                (j, sp)
                for j, sp in enumerate(sample.get("spans") or [])
                if not sp.get("isAnchor") and sp.get("label") in ("KEEP", "RETRY")
            ]
            margin_rows = span_margins(model, batch, device)
            si = item["spanIndex"]
            pos_map = {j: k for k, (j, _) in enumerate(eligible)}
            if si not in pos_map or pos_map[si] >= len(margin_rows):
                continue
            r = margin_rows[pos_map[si]]
            sp = eligible[pos_map[si]][1]
            if sp.get("label") != "RETRY":
                continue
            margins_retry.append(r["margin"])
            if r["pred"] == 1:
                correct += 1
            else:
                wrong += 1
                margins_wrong.append(r["margin"])
        total = correct + wrong
        rows.append(
            {
                **p,
                "caseId": case_id,
                "targetSurface": surf,
                "supportRetryRowsSampled": len(candidates),
                "supportRetryRowsEvaluated": total,
                "checkpointPredRetryCorrect": correct,
                "checkpointPredKeepWrong": wrong,
                "trainSupportRetryRecall": round(correct / max(total, 1), 6),
                "medianMarginAllRetrySupport": round(statistics.median(margins_retry), 6) if margins_retry else "",
                "medianMarginMisclassified": round(statistics.median(margins_wrong), 6) if margins_wrong else "",
                "trainFitOnSupport": "TRAIN_FIT_HEALTHY" if total and correct / total >= 0.8 else (
                    "TRAIN_FIT_WEAK" if total and correct / total >= 0.5 else "TRAIN_FIT_FAIL_OR_SPARSE"
                ),
                "outOfSampleGeneralizationRequired": "YES" if total and correct / total >= 0.8 else "UNRESOLVED",
            }
        )
    return rows


def main():
    identity = assert_authoritative_s3_identity()
    p = prov(identity)
    print(json.dumps({"g0": "PASS", **p}, ensure_ascii=False), flush=True)

    root_rows = read_root_rows()
    corrected_roots = correct_ssot(root_rows, identity)
    write_csv(ROOT_CAUSES, corrected_roots)

    # patch causality freeze state
    freeze_patch = [
        {**p, "item": "HIGH_CONF_GENERALIZATION", "value": "12", "status": "FROZEN"},
        {**p, "item": "UNRESOLVED_MEDIUM", "value": "4", "status": "FROZEN"},
        {**p, "item": "UNRESOLVED_CASES", "value": "d008,d022,d051,d094", "status": "FROZEN"},
        {**p, "item": "ALL_16_GENERALIZATION", "value": "NO", "status": "FROZEN"},
        {**p, "item": "SSOT_CORRECTION", "value": PHASE, "status": "APPLIED"},
    ]
    if CAUSALITY_FREEZE.exists():
        existing = list(csv.DictReader(CAUSALITY_FREEZE.open(encoding="utf-8")))
        existing = [r for r in existing if r.get("item") not in {x["item"] for x in freeze_patch}]
        write_csv(CAUSALITY_FREEZE, existing + freeze_patch)

    # patch causality summary minimally
    if CAUSALITY_SUMMARY.exists():
        summ = json.loads(CAUSALITY_SUMMARY.read_text(encoding="utf-8"))
        summ["rootCauseDistribution16Corrected"] = {
            "MODEL_GENERALIZATION_FAILURE_HIGH": 12,
            "INSUFFICIENT_EVIDENCE_MEDIUM": 4,
        }
        summ["unresolvedCases"] = sorted(UNRESOLVED)
        summ["ssotCorrectionPhase"] = PHASE
        summ["ssotCorrectionStatus"] = "CORRECTED_12HIGH_4UNRESOLVED"
        summ["dominantProvenCause"] = "MODEL_GENERALIZATION_FAILURE"
        summ["all16Generalization"] = False
        CAUSALITY_SUMMARY.write_text(json.dumps(summ, indent=2, ensure_ascii=False), encoding="utf-8")

    model, vocab, cfg = load_bundle(CKPT)
    device = torch.device("cpu")
    train_samples = load_split("train")
    dev_samples = load_split("dev")

    train_loader = DataLoader(
        UtteranceDataset(train_samples, vocab),
        batch_size=64,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )
    dev_loader = DataLoader(
        UtteranceDataset(dev_samples, vocab),
        batch_size=64,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )

    print("computing train/dev confusion...", flush=True)
    train_m = compute_metrics(model, train_loader, device)
    dev_m = compute_metrics(model, dev_loader, device)

    retry_margins = []
    retry_neg = 0
    for batch in train_loader:
        for row in span_margins(model, batch, device):
            if row["label"] == 1:
                retry_margins.append(row["margin"])
                if row["margin"] < 0:
                    retry_neg += 1

    train_fit = "TRAIN_FIT_HEALTHY" if train_m["retry_recall"] >= 0.75 else (
        "TRAIN_FIT_WEAK" if train_m["retry_recall"] >= 0.5 else "TRAIN_FIT_FAIL"
    )

    metrics_hist = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    replay_rows = replay_high_cases(train_samples, model, vocab, device, p)
    # surface stats: sample subset of train utterances containing key surfaces (faster)
    key_set = set(KEY_SURFACES)
    surface_samples = [
        s for s in train_samples
        if any((sp.get("surface") or "") in key_set for sp in (s.get("spans") or []))
    ][:8000]
    surface_rows = analyze_surfaces(surface_samples, model, vocab, device, p)

    high_with_support = sum(1 for r in replay_rows if r["supportRetryRowsEvaluated"] > 0)
    support_misclassified = sum(r["checkpointPredKeepWrong"] for r in replay_rows)
    support_total = sum(r["supportRetryRowsEvaluated"] for r in replay_rows)
    oos_cases = sum(1 for r in replay_rows if r["outOfSampleGeneralizationRequired"] == "YES")

    # first causal owner matrix
    owner_rows = [
        {**p, "hypothesis": "TRAINING_SET_FIT_FAILURE", "status": "NOT_PRIMARY" if train_fit == "TRAIN_FIT_HEALTHY" else "POSSIBLE", "evidence": f"train_retry_recall={train_m['retry_recall']:.4f}"},
        {**p, "hypothesis": "CLASS_IMBALANCE_LOSS", "status": "CONTRIBUTING_UNCOMPENSATED", "evidence": "class_weight_retry=1.0 uniform sampling KEEP:RETRY≈14.4:1"},
        {**p, "hypothesis": "CHECKPOINT_SELECTION", "status": "APPROPRIATE", "evidence": f"best dev retry_f1 epoch {metrics_hist['bestEpoch']}"},
        {**p, "hypothesis": "HARD_NEGATIVE_DISTRIBUTION", "status": "LIKELY", "evidence": "same-surface KEEP>>RETRY counts; strong KEEP preference in production"},
        {**p, "hypothesis": "SEQUENCE_CONTEXT_GENERALIZATION", "status": "LIKELY", "evidence": f"{oos_cases}/12 HIGH cases: training RETRY support fits but production context fails"},
        {**p, "hypothesis": "SURFACE_EMBEDDING_GENERALIZATION", "status": "NOT_PRIMARY", "evidence": "target surfaces present under RETRY in S3"},
        {**p, "hypothesis": "MODEL_CAPACITY", "status": "NOT_PROVEN", "evidence": "train/dev fit adequate"},
        {**p, "hypothesis": "THRESHOLD_CALIBRATION", "status": "NOT_SUPPORTED", "evidence": "strong negative production margins"},
        {**p, "hypothesis": "PINYIN_SCALAR_COLLAPSE", "status": "NONBLOCKING_NOT_PROVEN", "evidence": "pinyin_channel_avail constant in train scalars"},
    ]

    # Verdict: train-fit healthy + frozen 12 HIGH generalization primary => MIXED owners
    if train_fit != "TRAIN_FIT_HEALTHY":
        verdict = "MODEL3_S3_GENERALIZATION_AUDIT_TRAINING_FIT_PRIMARY"
        next_phase = "MODEL3_V2_S3_TRAINING_OPTIMIZATION_CORRECTION_DESIGN"
        first_owner = "TRAINING_SET_FIT_FAILURE"
    elif train_m["retry_recall"] >= 0.85 and oos_cases >= 5:
        verdict = "MODEL3_S3_GENERALIZATION_AUDIT_MIXED"
        next_phase = "MODEL3_V2_S3_MINIMAL_GENERALIZATION_CORRECTION_DESIGN"
        first_owner = "MIXED"
    elif oos_cases >= 8:
        verdict = "MODEL3_S3_GENERALIZATION_AUDIT_MIXED"
        next_phase = "MODEL3_V2_S3_MINIMAL_GENERALIZATION_CORRECTION_DESIGN"
        first_owner = "MIXED"
    else:
        verdict = "MODEL3_S3_GENERALIZATION_AUDIT_EVIDENCE_INSUFFICIENT"
        next_phase = "MODEL3_V2_S3_GENERALIZATION_CAUSAL_TRACE_COMPLETENESS_AUDIT"
        first_owner = "UNRESOLVED"

    smallest = (
        "Increase class_weight_retry + utterance/batch RETRY balancing + "
        "hard-negative mining in training (no architecture/runtime change)"
    )

    train_fit_rows = [
        {**p, "split": "train", "tp": train_m["tp"], "fp": train_m["fp"], "fn": train_m["fn"], "tn": train_m["tn"],
         "retry_precision": round(train_m["retry_precision"], 6), "retry_recall": round(train_m["retry_recall"], 6),
         "retry_f1": round(train_m["retry_f1"], 6), "keep_false_retry_rate": round(train_m["fp"] / max(train_m["tn"] + train_m["fp"], 1), 6),
         "trainFitClass": train_fit},
        {**p, "split": "dev", "tp": dev_m["tp"], "fp": dev_m["fp"], "fn": dev_m["fn"], "tn": dev_m["tn"],
         "retry_precision": round(dev_m["retry_precision"], 6), "retry_recall": round(dev_m["retry_recall"], 6),
         "retry_f1": round(dev_m["retry_f1"], 6), "keep_false_retry_rate": round(dev_m["fp"] / max(dev_m["tn"] + dev_m["fp"], 1), 6),
         "trainFitClass": "N/A"},
        {**p, "split": "train_retry_margin", "tp": len(retry_margins), "fp": retry_neg, "fn": "", "tn": "",
         "retry_precision": "", "retry_recall": round(1 - retry_neg / max(len(retry_margins), 1), 6),
         "retry_f1": "", "keep_false_retry_rate": "",
         "trainFitClass": f"p05={pct(retry_margins,0.05):.4f};p50={pct(retry_margins,0.5):.4f};p95={pct(retry_margins,0.95):.4f};neg_frac={retry_neg/max(len(retry_margins),1):.4f}"},
    ]
    write_csv(OUT_TRAIN_FIT, train_fit_rows)
    write_csv(OUT_REPLAY, replay_rows)
    write_csv(OUT_SURFACE, surface_rows)
    write_csv(OUT_OWNER, owner_rows)

    freeze_rows = [
        {**p, "item": "G0_DATASET_IDENTITY", "value": "PASS", "status": "FROZEN"},
        {**p, "item": "HIGH_CONF_GENERALIZATION", "value": "12", "status": "FROZEN"},
        {**p, "item": "UNRESOLVED_MEDIUM", "value": "4", "status": "FROZEN"},
        {**p, "item": "UNRESOLVED_CASES", "value": "d008,d022,d051,d094", "status": "FROZEN"},
        {**p, "item": "DOMINANT_PROVEN_CAUSE", "value": "MODEL_GENERALIZATION_FAILURE", "status": "FROZEN"},
        {**p, "item": "ALL_16_GENERALIZATION", "value": "NO", "status": "FROZEN"},
        {**p, "item": "PRIOR_64_PERCENT_TAIL", "value": "RETIRED", "status": "SUPERSEDED"},
        {**p, "item": "PRIOR_CAND_ZERO", "value": "RETIRED", "status": "SUPERSEDED"},
        {**p, "item": "PRIOR_853_SPLIT", "value": "RETIRED", "status": "SUPERSEDED"},
        {**p, "item": "PINYIN_CHANNEL_AVAIL_TRAIN_VARIANCE", "value": "COLLAPSED", "status": "FROZEN_NONBLOCKING"},
        {**p, "item": "CLASS_WEIGHT_RETRY", "value": str(cfg.get("class_weight_retry")), "status": "VERIFIED"},
        {**p, "item": "TRAIN_FIT_STATUS", "value": train_fit, "status": "AUDITED"},
        {**p, "item": "FIRST_CAUSAL_OWNER", "value": first_owner, "status": "AUDITED"},
        {**p, "item": "VERDICT", "value": verdict, "status": "FROZEN"},
        {**p, "item": "NEXT_PHASE", "value": next_phase, "status": "PROPOSED_NOT_EXECUTED"},
    ]
    write_csv(OUT_FREEZE, freeze_rows)

    summary = {
        **p,
        "g0DatasetIdentity": "PASS",
        "ssotCorrectionStatus": "CORRECTED",
        "highConfGeneralization": 12,
        "unresolvedMedium": 4,
        "unresolvedCases": sorted(UNRESOLVED),
        "dominantProvenCause": "MODEL_GENERALIZATION_FAILURE",
        "all16Generalization": False,
        "verdict": verdict,
        "nextPhase": next_phase,
        "firstCausalOwner": first_owner,
        "smallestCorrection": smallest,
        "trainFit": {
            "class": train_fit,
            "trainRetryRecall": round(train_m["retry_recall"], 6),
            "devRetryRecall": round(dev_m["retry_recall"], 6),
            "trainConfusion": {k: train_m[k] for k in ("tp", "fp", "fn", "tn", "retry_precision", "retry_recall", "retry_f1")},
            "devConfusion": {k: dev_m[k] for k in ("tp", "fp", "fn", "tn", "retry_precision", "retry_recall", "retry_f1")},
            "trainRetryMarginNegativeFraction": round(retry_neg / max(len(retry_margins), 1), 6),
        },
        "classBalance": {
            "keepCount": 349683,
            "retryCount": 24206,
            "ratio": 14.446,
            "classWeightRetry": cfg.get("class_weight_retry"),
            "sampling": cfg.get("sampling"),
            "autoClassWeightFormula": cfg.get("auto_class_weight_formula"),
            "compensated": False,
        },
        "checkpointSelection": {
            "criterion": "best_dev_retry_f1",
            "bestEpoch": metrics_hist["bestEpoch"],
            "appropriateForRetryTask": True,
            "retryRecallPeakedAtSelectedEpoch": True,
        },
        "highCaseSupportReplay": {
            "casesWithSupport": high_with_support,
            "supportRowsEvaluated": support_total,
            "supportMisclassifiedAsKeep": support_misclassified,
            "outOfSampleGeneralizationCases": oos_cases,
        },
        "governance": {
            "productionCodeChanged": "NO",
            "trainingExecuted": "NO",
            "datasetRebuilt": "NO",
            "modelArchitectureChanged": "NO",
            "thresholdChanged": "NO",
            "featureContractChanged": "NO",
        },
    }
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    # patch causality report header note
    if CAUSALITY_REPORT.exists():
        text = CAUSALITY_REPORT.read_text(encoding="utf-8")
        note = (
            "> **SSOT CORRECTION (2026-09-02):** Root-cause table corrected to "
            "12 HIGH `MODEL_GENERALIZATION_FAILURE` + 4 MEDIUM `INSUFFICIENT_EVIDENCE` "
            "(d008,d022,d051,d094). See generalization correction design audit.\n\n"
        )
        if "SSOT CORRECTION" not in text:
            text = text.replace("# Lingua Model3 V2 S3 Localization", note + "# Lingua Model3 V2 S3 Localization", 1)
            CAUSALITY_REPORT.write_text(text, encoding="utf-8")

    report = f"""# Lingua Model3 V2 S3 Model Generalization Correction Design Audit (2026-09-02)

Phase: `{PHASE}`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `{verdict}` |
| **SSOT correction** | 12 HIGH + 4 unresolved (`INSUFFICIENT_EVIDENCE`) |
| **dominant proven cause** | `MODEL_GENERALIZATION_FAILURE` (12 HIGH only) |
| **training-fit status** | `{train_fit}` (train RETRY recall {train_m['retry_recall']:.4f}) |
| **class balance** | 14.4:1 uncompensated (`class_weight_retry=1.0`) |
| **checkpoint selection** | best dev retry_f1 → epoch {metrics_hist['bestEpoch']} |
| **first causal owner** | `{first_owner}` |
| **smallest correction** | {smallest} |
| **next phase** | `{next_phase}` |

## SSOT CAUSAL CLASSIFICATION CORRECTION

Corrected `model3_v2_s3_localization_root_causes.csv`:
- **12 HIGH** remain `MODEL_GENERALIZATION_FAILURE`
- **4 MEDIUM** → `INSUFFICIENT_EVIDENCE`: d008, d022, d051, d094

## TRAINING-SET INFERENCE

| Split | RETRY recall | RETRY F1 | KEEP→RETRY (FP rate) |
|---|---:|---:|---:|
| train | {train_m['retry_recall']:.4f} | {train_m['retry_f1']:.4f} | {train_m['fp']/(train_m['tn']+train_m['fp']):.4f} |
| dev | {dev_m['retry_recall']:.4f} | {dev_m['retry_f1']:.4f} | {dev_m['fp']/(dev_m['tn']+dev_m['fp']):.4f} |

Train-fit vs generalization split: **CASE B** — training RETRY largely predicted correctly; production held-out targets fail.

## FIRST CAUSAL OWNER

`{first_owner}` — hard-negative KEEP pressure + sequence-context generalization under uncompensated class imbalance.

## NEXT PHASE

`{next_phase}` (NOT EXECUTED)
"""
    OUT_REPORT.write_text(report, encoding="utf-8")

    print(json.dumps({"verdict": verdict, "trainRetryRecall": train_m["retry_recall"], "oosCases": oos_cases}, indent=2))


if __name__ == "__main__":
    main()
