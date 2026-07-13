"""ToneModule Phase 1 — model loader (fail-closed, no bootstrap)."""
from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Optional

import numpy as np

from config import TONE_MODEL_PATH
from tone_module.contract import (
    METADATA_WARNING_FEATURE_VERSION_MISSING,
    P0_BACKEND,
    P0_COMPATIBLE_FEATURE_VERSIONS,
    P0_FEATURE_VERSION,
    P0_HIDDEN,
    P0_N_CLASSES,
    P0_N_MELS,
    ToneLoadResult,
    ToneModelMetadata,
    ToneModelWeights,
)

logger = logging.getLogger(__name__)

_REQUIRED_WEIGHT_KEYS = ("w1", "b1", "w2", "b2")
_DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "tone_cnn_p0.npz")
_OPTIONAL_NPZ_METADATA_KEYS = (
    "formatVersion",
    "modelVersion",
    "featureVersion",
    "trainingVersion",
    "datasetVersion",
    "buildTime",
    "notes",
)


def _resolve_default_path() -> Optional[str]:
    if TONE_MODEL_PATH and os.path.isfile(TONE_MODEL_PATH):
        return TONE_MODEL_PATH
    if os.path.isfile(_DEFAULT_MODEL_PATH):
        return _DEFAULT_MODEL_PATH
    return None


def _file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_npz_metadata(data: np.lib.npyio.NpzFile) -> ToneModelMetadata:
    meta = ToneModelMetadata(backend=P0_BACKEND)
    for key in _OPTIONAL_NPZ_METADATA_KEYS:
        if key not in data:
            continue
        raw = data[key]
        value = raw.item() if hasattr(raw, "item") else raw
        if not isinstance(value, str):
            continue
        if key == "formatVersion":
            meta.format_version = value
        elif key == "modelVersion":
            meta.model_version = value
        elif key == "featureVersion":
            meta.feature_version = value
        elif key == "trainingVersion":
            meta.training_version = value
        elif key == "datasetVersion":
            meta.dataset_version = value
        elif key == "buildTime":
            meta.build_time = value
        elif key == "notes":
            meta.notes = value

    if "featureVersion" not in data:
        meta.feature_version = P0_FEATURE_VERSION
        meta.metadata_warning = METADATA_WARNING_FEATURE_VERSION_MISSING
    return meta


def _validate_shapes(weights: ToneModelWeights) -> Optional[str]:
    w1 = weights.w1
    w2 = weights.w2
    b1 = weights.b1
    b2 = weights.b2
    if w1.shape != (P0_N_MELS, P0_HIDDEN):
        return f"shape mismatch: w1 expected ({P0_N_MELS}, {P0_HIDDEN}), got {w1.shape}"
    if b1.shape != (P0_HIDDEN,):
        return f"shape mismatch: b1 expected ({P0_HIDDEN},), got {b1.shape}"
    if w2.shape != (P0_HIDDEN, P0_N_CLASSES):
        return f"shape mismatch: w2 expected ({P0_HIDDEN}, {P0_N_CLASSES}), got {w2.shape}"
    if b2.shape != (P0_N_CLASSES,):
        return f"shape mismatch: b2 expected ({P0_N_CLASSES},), got {b2.shape}"
    if weights.mel_mean is not None and weights.mel_mean.shape != (P0_N_MELS,):
        return f"shape mismatch: mel_mean expected ({P0_N_MELS},), got {weights.mel_mean.shape}"
    if weights.mel_std is not None and weights.mel_std.shape != (P0_N_MELS,):
        return f"shape mismatch: mel_std expected ({P0_N_MELS},), got {weights.mel_std.shape}"
    return None


class ToneModelLoader:
    """Load / unload tone CNN weights. Load failure clears ready state (fail-closed)."""

    def __init__(self) -> None:
        self._ready = False
        self._load_error: Optional[str] = None
        self._metadata: Optional[ToneModelMetadata] = None
        self._weights: Optional[ToneModelWeights] = None
        self._model_path: Optional[str] = None

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    @property
    def metadata(self) -> Optional[ToneModelMetadata]:
        return self._metadata

    @property
    def backend(self) -> str:
        return self._metadata.backend if self._metadata else P0_BACKEND

    @property
    def weights(self) -> Optional[ToneModelWeights]:
        return self._weights

    def unload(self) -> None:
        self._ready = False
        self._load_error = None
        self._metadata = None
        self._weights = None
        self._model_path = None

    def load(self, model_path: Optional[str] = None) -> ToneLoadResult:
        self.unload()
        load_started = time.perf_counter()
        path = model_path if model_path is not None else _resolve_default_path()
        if not path or not os.path.isfile(path):
            self._load_error = "model_not_found"
            logger.warning(
                "ToneModule model not found (path=%s); inference disabled (fail-closed)",
                path or "(unset)",
            )
            return ToneLoadResult(ready=False, load_error=self._load_error)

        try:
            data = np.load(path, allow_pickle=True)
            for key in _REQUIRED_WEIGHT_KEYS:
                if key not in data:
                    raise ValueError(f"missing required weight key: {key}")

            weights = ToneModelWeights(
                w1=data["w1"].astype(np.float32),
                b1=data["b1"].astype(np.float32),
                w2=data["w2"].astype(np.float32),
                b2=data["b2"].astype(np.float32),
                mel_mean=data["mel_mean"].astype(np.float32) if "mel_mean" in data else None,
                mel_std=data["mel_std"].astype(np.float32) if "mel_std" in data else None,
            )
            if weights.mel_std is not None:
                weights.mel_std[weights.mel_std < 1e-6] = 1.0

            shape_err = _validate_shapes(weights)
            if shape_err:
                raise ValueError(shape_err)

            metadata = _read_npz_metadata(data)
            if metadata.feature_version not in P0_COMPATIBLE_FEATURE_VERSIONS:
                raise ValueError(
                    f"feature mismatch: expected one of {sorted(P0_COMPATIBLE_FEATURE_VERSIONS)}, "
                    f"got {metadata.feature_version}"
                )
            if metadata.feature_version != P0_FEATURE_VERSION:
                metadata.metadata_warning = (
                    f"featureVersion_legacy_{metadata.feature_version}"
                    if metadata.metadata_warning is None
                    else metadata.metadata_warning
                )

            try:
                metadata.model_hash = _file_sha256(path)
            except OSError:
                pass

            metadata.artifact_path = path
            metadata.load_ms = int((time.perf_counter() - load_started) * 1000)

            metrics = data["metrics"].item() if "metrics" in data else None
            logger.info(
                "ToneModule loaded weights from %s (backend=%s featureVersion=%s)%s",
                path,
                metadata.backend,
                metadata.feature_version,
                f" val_acc={metrics.get('val_acc'):.3f}"
                if isinstance(metrics, dict) and "val_acc" in metrics
                else "",
            )

            self._ready = True
            self._load_error = None
            self._metadata = metadata
            self._weights = weights
            self._model_path = path
            return ToneLoadResult(
                ready=True,
                metadata=metadata,
                weights=weights,
            )
        except Exception as exc:
            self.unload()
            self._load_error = str(exc)
            logger.warning("ToneModule failed to load %s: %s", path, exc)
            return ToneLoadResult(ready=False, load_error=self._load_error)


_loader: Optional[ToneModelLoader] = None


def get_tone_loader() -> ToneModelLoader:
    global _loader
    if _loader is None:
        _loader = ToneModelLoader()
        _loader.load(None)
    return _loader


def reset_tone_loader_singleton() -> None:
    """Test-only: clear process singleton. Must not be called from production runtime."""
    global _loader
    _loader = None
