"""Small CPU tone CNN (P0): mel(80) -> hidden -> 5-class softmax."""
from __future__ import annotations

import logging
import os
from typing import Optional, Tuple

import numpy as np

from config import TONE_MODEL_PATH

logger = logging.getLogger(__name__)

N_CLASSES = 5
HIDDEN = 32
_DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "tone_cnn_p0.npz")


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.maximum(exp.sum(axis=-1, keepdims=True), 1e-12)


def _bootstrap_weights(seed: int = 42) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    w1 = rng.normal(0, 0.05, size=(80, HIDDEN)).astype(np.float32)
    b1 = np.zeros(HIDDEN, dtype=np.float32)
    w2 = rng.normal(0, 0.05, size=(HIDDEN, N_CLASSES)).astype(np.float32)
    b2 = np.zeros(N_CLASSES, dtype=np.float32)
    return w1, b1, w2, b2


class ToneClassifier:
    def __init__(self) -> None:
        self._w1: Optional[np.ndarray] = None
        self._b1: Optional[np.ndarray] = None
        self._w2: Optional[np.ndarray] = None
        self._b2: Optional[np.ndarray] = None
        self._mel_mean: Optional[np.ndarray] = None
        self._mel_std: Optional[np.ndarray] = None
        self._load_error: Optional[str] = None
        self._load()

    @property
    def ready(self) -> bool:
        return self._w1 is not None

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    def _load(self) -> None:
        path = TONE_MODEL_PATH or (_DEFAULT_MODEL_PATH if os.path.isfile(_DEFAULT_MODEL_PATH) else None)
        if path and os.path.isfile(path):
            try:
                data = np.load(path, allow_pickle=True)
                self._w1 = data["w1"].astype(np.float32)
                self._b1 = data["b1"].astype(np.float32)
                self._w2 = data["w2"].astype(np.float32)
                self._b2 = data["b2"].astype(np.float32)
                if "mel_mean" in data and "mel_std" in data:
                    self._mel_mean = data["mel_mean"].astype(np.float32)
                    self._mel_std = data["mel_std"].astype(np.float32)
                    self._mel_std[self._mel_std < 1e-6] = 1.0
                metrics = data["metrics"].item() if "metrics" in data else None
                logger.info(
                    "ToneModule loaded weights from %s%s",
                    path,
                    f" (val_acc={metrics.get('val_acc'):.3f})" if isinstance(metrics, dict) and "val_acc" in metrics else "",
                )
                return
            except Exception as exc:
                self._load_error = str(exc)
                logger.warning("ToneModule failed to load %s: %s", path, exc)
                return
        # P0 bundled bootstrap weights (deterministic); replace via TONE_MODEL_PATH in production.
        self._w1, self._b1, self._w2, self._b2 = _bootstrap_weights()
        logger.info("ToneModule using bundled P0 bootstrap weights")

    def predict_batch(self, mel_batch: np.ndarray) -> np.ndarray:
        """Return (N, 5) posterior probabilities."""
        if not self.ready or mel_batch.size == 0:
            return np.zeros((0, N_CLASSES), dtype=np.float32)
        x = mel_batch.astype(np.float32)
        if self._mel_mean is not None and self._mel_std is not None:
            x = (x - self._mel_mean) / self._mel_std
        h = np.maximum(x @ self._w1 + self._b1, 0.0)
        logits = h @ self._w2 + self._b2
        return _softmax(logits)


_classifier: Optional[ToneClassifier] = None


def get_tone_classifier() -> ToneClassifier:
    global _classifier
    if _classifier is None:
        _classifier = ToneClassifier()
    return _classifier
