"""ToneModule P1 V2 model loader (fail-closed, isolated from p0 ToneModelLoader)."""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Any, Optional

import numpy as np

from tone_module.contract import (
    P0_COMPATIBLE_FEATURE_VERSIONS,
    P0_N_CLASSES,
    P0_N_MELS,
    P1_BACKEND,
    P1_CNN_CONV1_OUT,
    P1_CNN_CONV2_OUT,
    P1_CNN_KERNEL_SIZE,
    P1_FEATURE_VERSION,
    P1_FORMAT_VERSION,
    P1_MODEL_ARCHITECTURE,
    P1_N_CHANNELS,
    P1_REQUIRED_WEIGHT_KEYS,
    ToneLoadResultV1,
    ToneModelMetadata,
    ToneModelWeightsV1,
)

logger = logging.getLogger(__name__)

_P0_FORBIDDEN_KEYS = ("w1", "b1", "w2", "b2", "mel_mean", "mel_std")
_OPTIONAL_NPZ_METADATA_KEYS = (
    "formatVersion",
    "modelVersion",
    "modelArchitecture",
    "featureVersion",
    "trainingVersion",
    "datasetVersion",
    "buildTime",
    "notes",
    "backend",
    "inputShape",
    "outputShape",
)


def _file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_npz_metadata(data: np.lib.npyio.NpzFile) -> ToneModelMetadata:
    meta = ToneModelMetadata(backend=P1_BACKEND, feature_version=P1_FEATURE_VERSION)
    for key in _OPTIONAL_NPZ_METADATA_KEYS:
        if key not in data:
            continue
        raw = data[key]
        value = raw.item() if hasattr(raw, "item") else raw
        if key in ("inputShape", "outputShape"):
            continue
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
        elif key == "backend":
            meta.backend = value
    return meta


def _validate_shapes(weights: ToneModelWeightsV1) -> Optional[str]:
    k = P1_CNN_KERNEL_SIZE
    c1 = P1_CNN_CONV1_OUT
    c2 = P1_CNN_CONV2_OUT
    if weights.conv1_w.shape != (c1, P1_N_CHANNELS, k):
        return f"conv1_w expected ({c1}, {P1_N_CHANNELS}, {k}), got {weights.conv1_w.shape}"
    if weights.conv1_b.shape != (c1,):
        return f"conv1_b expected ({c1},), got {weights.conv1_b.shape}"
    if weights.conv2_w.shape != (c2, c1, k):
        return f"conv2_w expected ({c2}, {c1}, {k}), got {weights.conv2_w.shape}"
    if weights.conv2_b.shape != (c2,):
        return f"conv2_b expected ({c2},), got {weights.conv2_b.shape}"
    if weights.fc_w.shape != (c2, P0_N_CLASSES):
        return f"fc_w expected ({c2}, {P0_N_CLASSES}), got {weights.fc_w.shape}"
    if weights.fc_b.shape != (P0_N_CLASSES,):
        return f"fc_b expected ({P0_N_CLASSES},), got {weights.fc_b.shape}"
    if weights.feature_mean.shape != (P1_N_CHANNELS,):
        return f"feature_mean expected ({P1_N_CHANNELS},), got {weights.feature_mean.shape}"
    if weights.feature_std.shape != (P1_N_CHANNELS,):
        return f"feature_std expected ({P1_N_CHANNELS},), got {weights.feature_std.shape}"
    return None


def _load_weights(data: np.lib.npyio.NpzFile) -> ToneModelWeightsV1:
    for key in P1_REQUIRED_WEIGHT_KEYS:
        if key not in data:
            raise ValueError(f"missing required weight key: {key}")
    for key in _P0_FORBIDDEN_KEYS:
        if key in data:
            raise ValueError(f"p0 artifact key forbidden on P1 loader: {key}")

    weights = ToneModelWeightsV1(
        conv1_w=data["conv1_w"].astype(np.float32),
        conv1_b=data["conv1_b"].astype(np.float32),
        conv2_w=data["conv2_w"].astype(np.float32),
        conv2_b=data["conv2_b"].astype(np.float32),
        fc_w=data["fc_w"].astype(np.float32),
        fc_b=data["fc_b"].astype(np.float32),
        feature_mean=data["feature_mean"].astype(np.float32),
        feature_std=data["feature_std"].astype(np.float32),
    )
    if weights.feature_std is not None:
        weights.feature_std[weights.feature_std < 1e-6] = 1.0
    err = _validate_shapes(weights)
    if err:
        raise ValueError(err)
    return weights


def _validate_metadata(data: np.lib.npyio.NpzFile, metadata: ToneModelMetadata) -> None:
    if metadata.format_version != P1_FORMAT_VERSION:
        raise ValueError(
            f"formatVersion mismatch: expected {P1_FORMAT_VERSION}, got {metadata.format_version}"
        )
    if metadata.feature_version != P1_FEATURE_VERSION:
        raise ValueError(
            f"featureVersion mismatch: expected {P1_FEATURE_VERSION}, got {metadata.feature_version}"
        )
    if metadata.feature_version in P0_COMPATIBLE_FEATURE_VERSIONS:
        raise ValueError("refusing p0-compatible featureVersion on P1 loader")
    if metadata.backend != P1_BACKEND:
        raise ValueError(f"backend mismatch: expected {P1_BACKEND}, got {metadata.backend}")
    if "inputShape" in data:
        shape = list(data["inputShape"])
        if shape != [64, 83]:
            raise ValueError(f"inputShape mismatch: expected [64, 83], got {shape}")
    if "outputShape" in data:
        shape = list(data["outputShape"])
        if shape != [P0_N_CLASSES]:
            raise ValueError(f"outputShape mismatch: expected [{P0_N_CLASSES}], got {shape}")
    arch = data["modelArchitecture"].item() if "modelArchitecture" in data else None
    if arch and arch != P1_MODEL_ARCHITECTURE:
        raise ValueError(f"modelArchitecture mismatch: expected {P1_MODEL_ARCHITECTURE}, got {arch}")


class ToneModelLoaderV1:
    """Load P1 V2 CNN weights. Fail-closed; rejects p0 artifacts."""

    def __init__(self) -> None:
        self._ready = False
        self._load_error: Optional[str] = None
        self._metadata: Optional[ToneModelMetadata] = None
        self._weights: Optional[ToneModelWeightsV1] = None
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
    def weights(self) -> Optional[ToneModelWeightsV1]:
        return self._weights

    def unload(self) -> None:
        self._ready = False
        self._load_error = None
        self._metadata = None
        self._weights = None
        self._model_path = None

    def load(self, model_path: str) -> ToneLoadResultV1:
        self.unload()
        load_started = time.perf_counter()
        if not model_path:
            self._load_error = "model_not_found"
            return ToneLoadResultV1(ready=False, load_error=self._load_error)

        try:
            data = np.load(model_path, allow_pickle=True)
            if any(key in data for key in _P0_FORBIDDEN_KEYS):
                raise ValueError("artifact appears to be p0 format; P1 loader refuses it")
            if "featureVersion" in data:
                fv = data["featureVersion"].item()
                if fv in P0_COMPATIBLE_FEATURE_VERSIONS or fv == P0_N_MELS:
                    raise ValueError(f"p0 featureVersion refused: {fv}")

            weights = _load_weights(data)
            metadata = _read_npz_metadata(data)
            _validate_metadata(data, metadata)

            try:
                metadata.model_hash = _file_sha256(model_path)
            except OSError:
                pass
            metadata.artifact_path = model_path
            metadata.load_ms = int((time.perf_counter() - load_started) * 1000)

            self._ready = True
            self._metadata = metadata
            self._weights = weights
            self._model_path = model_path
            logger.info(
                "ToneModule P1 loaded weights from %s (backend=%s featureVersion=%s)",
                model_path,
                metadata.backend,
                metadata.feature_version,
            )
            return ToneLoadResultV1(ready=True, metadata=metadata, weights=weights)
        except Exception as exc:
            self.unload()
            self._load_error = str(exc)
            logger.warning("ToneModule P1 failed to load %s: %s", model_path, exc)
            return ToneLoadResultV1(ready=False, load_error=self._load_error)


def save_artifact_v1(
    path: str,
    weights: ToneModelWeightsV1,
    *,
    model_version: str,
    training_version: str,
    dataset_version: str,
    metrics: dict,
    notes: str = "",
) -> None:
    """Write P1 npz artifact (isolated schema from p0)."""
    import json
    import os
    from datetime import datetime, timezone

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    build_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    np.savez(
        path,
        conv1_w=weights.conv1_w.astype(np.float32),
        conv1_b=weights.conv1_b.astype(np.float32),
        conv2_w=weights.conv2_w.astype(np.float32),
        conv2_b=weights.conv2_b.astype(np.float32),
        fc_w=weights.fc_w.astype(np.float32),
        fc_b=weights.fc_b.astype(np.float32),
        feature_mean=weights.feature_mean.astype(np.float32),
        feature_std=weights.feature_std.astype(np.float32),
        formatVersion=np.array(P1_FORMAT_VERSION),
        featureVersion=np.array(P1_FEATURE_VERSION),
        inputShape=np.array(list((64, 83)), dtype=np.int64),
        outputShape=np.array(list(P1_OUTPUT_SHAPE := (P0_N_CLASSES,)), dtype=np.int64),
        modelVersion=np.array(model_version),
        modelArchitecture=np.array(P1_MODEL_ARCHITECTURE),
        backend=np.array(P1_BACKEND),
        trainingVersion=np.array(training_version),
        datasetVersion=np.array(dataset_version),
        buildTime=np.array(build_time),
        notes=np.array(notes or json.dumps(metrics, ensure_ascii=False)),
        metrics=metrics,
    )
