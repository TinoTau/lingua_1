"""Torch → NumPy artifact export for numpy_p1 backend."""
from __future__ import annotations

from typing import Tuple

import numpy as np
import torch

from tone_module import contract
from tone_module.models.cnn_p1 import forward_logits, predict_posteriors
from tone_module.models.cnn_p1_torch import CnnP1Torch


def torch_model_to_weights_v1(
    model: CnnP1Torch,
    *,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
) -> contract.ToneModelWeightsV1:
    """Export Conv1d weights in NumPy (C_out, C_in, K) layout for numpy_p1."""
    state = model.state_dict()
    return contract.ToneModelWeightsV1(
        conv1_w=state["conv1.weight"].detach().cpu().numpy().astype(np.float32),
        conv1_b=state["conv1.bias"].detach().cpu().numpy().astype(np.float32),
        conv2_w=state["conv2.weight"].detach().cpu().numpy().astype(np.float32),
        conv2_b=state["conv2.bias"].detach().cpu().numpy().astype(np.float32),
        fc_w=state["fc.weight"].detach().cpu().numpy().T.astype(np.float32),
        fc_b=state["fc.bias"].detach().cpu().numpy().astype(np.float32),
        feature_mean=np.asarray(feature_mean, dtype=np.float32),
        feature_std=np.asarray(feature_std, dtype=np.float32),
    )


def logits_parity_report(
    model: CnnP1Torch,
    features: np.ndarray,
    weights: contract.ToneModelWeightsV1,
    *,
    device: torch.device,
    max_abs_diff_threshold: float = 1e-4,
) -> dict:
    """Compare Torch vs NumPy logits on the same batch."""
    model.eval()
    with torch.no_grad():
        mean = torch.from_numpy(weights.feature_mean.reshape(1, 1, -1)).to(device)
        std = torch.from_numpy(weights.feature_std.reshape(1, 1, -1)).to(device)
        x = torch.from_numpy(features.astype(np.float32)).to(device)
        x = (x - mean) / std
        torch_logits = model(x).cpu().numpy()

    numpy_logits, _ = forward_logits(features, weights)
    max_abs = float(np.max(np.abs(torch_logits - numpy_logits)))
    torch_preds = np.argmax(torch_logits, axis=1)
    numpy_preds = np.argmax(numpy_logits, axis=1)
    agreement = float(np.mean(torch_preds == numpy_preds))
    return {
        "maxAbsLogitsDiff": max_abs,
        "argmaxAgreement": agreement,
        "parityPass": max_abs <= max_abs_diff_threshold and agreement == 1.0,
        "threshold": max_abs_diff_threshold,
    }


def posterior_parity_report(
    model: CnnP1Torch,
    features: np.ndarray,
    weights: contract.ToneModelWeightsV1,
    *,
    device: torch.device,
) -> dict:
    model.eval()
    with torch.no_grad():
        mean = torch.from_numpy(weights.feature_mean.reshape(1, 1, -1)).to(device)
        std = torch.from_numpy(weights.feature_std.reshape(1, 1, -1)).to(device)
        x = torch.from_numpy(features.astype(np.float32)).to(device)
        x = (x - mean) / std
        logits = model(x)
        torch_post = torch.softmax(logits, dim=-1).cpu().numpy()
    numpy_post = predict_posteriors(features, weights)
    max_abs = float(np.max(np.abs(torch_post - numpy_post)))
    return {
        "maxAbsPosteriorDiff": max_abs,
        "parityPass": max_abs <= 1e-4,
    }
