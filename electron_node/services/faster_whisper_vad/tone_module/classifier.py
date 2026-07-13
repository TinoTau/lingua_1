"""P1 Full Runtime tone CNN: feature_v2 (64, 83) -> numpy_p1 -> 5-class softmax."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import numpy as np

from tone_module.backends.numpy_p1 import infer_batch
from tone_module.contract import P0_N_CLASSES, P1_FEATURE_SHAPE
from tone_module.loader_v1 import ToneModelLoaderV1, get_tone_loader_v1, reset_tone_loader_v1_singleton

logger = logging.getLogger(__name__)

N_CLASSES = P0_N_CLASSES
FEATURE_SHAPE = P1_FEATURE_SHAPE


class ToneClassifier:
    def __init__(self, model_path: Optional[str] = None, loader: Optional[ToneModelLoaderV1] = None) -> None:
        self._loader = loader or ToneModelLoaderV1()
        self._load(model_path)

    @property
    def ready(self) -> bool:
        return self._loader.ready

    @property
    def load_error(self) -> Optional[str]:
        return self._loader.load_error

    @property
    def metadata(self):
        return self._loader.metadata

    def metadata_as_diagnostics(self) -> Dict[str, Any]:
        meta = self._loader.metadata
        return meta.as_diagnostics_dict() if meta else {}

    def _load(self, model_path: Optional[str] = None) -> None:
        if model_path is None and self._loader.ready:
            return
        self._loader.load(model_path)

    def predict_batch(self, feature_batch: np.ndarray) -> np.ndarray:
        """Return (N, 5) posterior probabilities from (N, 64, 83) feature batch."""
        if not self.ready or feature_batch.size == 0:
            return np.zeros((0, N_CLASSES), dtype=np.float32)
        weights = self._loader.weights
        if weights is None:
            return np.zeros((0, N_CLASSES), dtype=np.float32)
        return infer_batch(feature_batch, weights)


_classifier: Optional[ToneClassifier] = None


def get_tone_classifier() -> ToneClassifier:
    global _classifier
    if _classifier is None:
        loader = get_tone_loader_v1()
        _classifier = ToneClassifier(loader=loader)
    return _classifier


def reset_tone_classifier_singleton() -> None:
    """Test-only: clear process singleton. Must not be called from production runtime."""
    global _classifier
    _classifier = None
    reset_tone_loader_v1_singleton()
