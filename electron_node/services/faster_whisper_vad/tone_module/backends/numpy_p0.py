"""NumPy P0 backend adapter: mel_batch -> ndarray[N, 5] TonePosterior probabilities."""
from __future__ import annotations

import numpy as np

from tone_module.contract import P0_N_CLASSES
from tone_module.loader import ToneModelWeights


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.maximum(exp.sum(axis=-1, keepdims=True), 1e-12)


def infer_batch(mel_batch: np.ndarray, weights: ToneModelWeights) -> np.ndarray:
    """Run NumPy inference on a mel feature batch. Returns (N, P0_N_CLASSES) posteriors."""
    if mel_batch.size == 0:
        return np.zeros((0, P0_N_CLASSES), dtype=np.float32)

    x = mel_batch.astype(np.float32)
    if weights.mel_mean is not None and weights.mel_std is not None:
        x = (x - weights.mel_mean) / weights.mel_std
    h = np.maximum(x @ weights.w1 + weights.b1, 0.0)
    logits = h @ weights.w2 + weights.b2
    return _softmax(logits)
