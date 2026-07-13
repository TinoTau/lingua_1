"""NumPy P1 backend: (N, 64, 83) feature batch -> (N, 5) TonePosterior probabilities."""
from __future__ import annotations

import numpy as np

from tone_module import contract
from tone_module.models.cnn_p1 import predict_posteriors as predict_posteriors_v1
from tone_module.models.cnn_production_v2 import predict_posteriors as predict_posteriors_v2


def infer_batch(feature_batch: np.ndarray, weights) -> np.ndarray:
    """
    Run NumPy inference on a P1 feature batch.

    feature_batch: (N, 64, 83) float32
    returns: (N, 5) posteriors
    """
    if feature_batch.size == 0:
        return np.zeros((0, contract.P0_N_CLASSES), dtype=np.float32)
    if feature_batch.ndim != 3:
        raise ValueError(f"expected (N, T, C), got {feature_batch.shape}")
    if feature_batch.shape[1:] != contract.P1_FEATURE_SHAPE:
        raise ValueError(
            f"expected (*, {contract.P1_FEATURE_SHAPE}), got {feature_batch.shape}"
        )
    if feature_batch.shape[-1] == contract.P0_N_MELS:
        raise ValueError("refusing (N, *, 80) mean-mel input on P1 backend")
    if isinstance(weights, contract.ToneModelWeightsV2):
        return predict_posteriors_v2(feature_batch, weights)
    if isinstance(weights, contract.ToneModelWeightsV1):
        return predict_posteriors_v1(feature_batch, weights)
    arch = getattr(weights, "architecture", None)
    if arch == contract.P2_MODEL_ARCHITECTURE:
        return predict_posteriors_v2(feature_batch, weights)
    return predict_posteriors_v1(feature_batch, weights)
