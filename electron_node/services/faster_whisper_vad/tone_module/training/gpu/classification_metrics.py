"""Full classification metrics for Tone training acceptance."""
from __future__ import annotations

from typing import Any

import numpy as np

TONE_CLASS_NAMES = ("t1", "t2", "t3", "t4", "t5")


def compute_classification_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    *,
    n_classes: int = 5,
) -> dict[str, Any]:
    y_true = np.asarray(y_true, dtype=np.int64).reshape(-1)
    y_pred = np.asarray(y_pred, dtype=np.int64).reshape(-1)
    cm = np.zeros((n_classes, n_classes), dtype=np.int64)
    for truth, pred in zip(y_true.tolist(), y_pred.tolist()):
        if 0 <= int(truth) < n_classes and 0 <= int(pred) < n_classes:
            cm[int(truth), int(pred)] += 1

    total = int(y_true.shape[0])
    correct = int(np.sum(y_true == y_pred))
    val_acc = float(correct / total) if total else 0.0

    per_class_accuracy: dict[str, float] = {}
    precision: dict[str, float] = {}
    recall: dict[str, float] = {}
    f1: dict[str, float] = {}

    for idx, name in enumerate(TONE_CLASS_NAMES):
        row_sum = int(cm[idx].sum())
        col_sum = int(cm[:, idx].sum())
        tp = int(cm[idx, idx])
        per_class_accuracy[name] = float(tp / row_sum) if row_sum else 0.0
        precision[name] = float(tp / col_sum) if col_sum else 0.0
        recall[name] = float(tp / row_sum) if row_sum else 0.0
        p, r = precision[name], recall[name]
        f1[name] = float(2 * p * r / (p + r)) if (p + r) > 0 else 0.0

    macro_p = float(np.mean([precision[n] for n in TONE_CLASS_NAMES]))
    macro_r = float(np.mean([recall[n] for n in TONE_CLASS_NAMES]))
    macro_f1 = float(np.mean([f1[n] for n in TONE_CLASS_NAMES]))
    weighted_p = float(
        np.average([precision[n] for n in TONE_CLASS_NAMES], weights=cm.sum(axis=1) / max(total, 1))
    )
    weighted_r = float(
        np.average([recall[n] for n in TONE_CLASS_NAMES], weights=cm.sum(axis=1) / max(total, 1))
    )
    weighted_f1 = float(
        np.average([f1[n] for n in TONE_CLASS_NAMES], weights=cm.sum(axis=1) / max(total, 1))
    )

    return {
        "valSamples": total,
        "val_acc": val_acc,
        "confusion_matrix": cm.tolist(),
        "per_class_accuracy": per_class_accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "macro_precision": macro_p,
        "macro_recall": macro_r,
        "macro_f1": macro_f1,
        "weighted_precision": weighted_p,
        "weighted_recall": weighted_r,
        "weighted_f1": weighted_f1,
    }
