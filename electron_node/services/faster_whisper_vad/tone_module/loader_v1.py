"""ToneModule P1 V2 model loader (fail-closed, isolated from p0 ToneModelLoader)."""
from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Any, Optional

import numpy as np

from config import TONE_MODEL_PATH
from tone_module.contract import (
    P0_COMPATIBLE_FEATURE_VERSIONS,
    P0_N_CLASSES,
    P1_BACKEND,
    P1_CNN_CONV1_OUT,
    P1_CNN_CONV2_OUT,
    P1_CNN_KERNEL_SIZE,
    P1_FEATURE_VERSION,
    P1_FORMAT_VERSION,
    P1_MODEL_ARCHITECTURE,
    P1_N_CHANNELS,
    P1_OUTPUT_SHAPE,
    P1_REQUIRED_WEIGHT_KEYS,
    P1_LOADER_VERSION,
    P1_RUNTIME_VERSION,
    P2_CNN_CONV1_OUT,
    P2_CNN_CONV2_OUT,
    P2_CNN_KERNEL3,
    P2_CNN_KERNEL5,
    P2_CNN_RES_OUT,
    P2_FC1_OUT,
    P2_FC2_OUT,
    P2_MODEL_ARCHITECTURE,
    P2_REQUIRED_WEIGHT_KEYS,
    ToneLoadResultV1,
    ToneModelMetadata,
    ToneModelWeightsV1,
    ToneModelWeightsV2,
)

logger = logging.getLogger(__name__)

# Frozen Production V2 — unique production default (no Tiny / P1 full fallback).
_FROZEN_PRODUCTION_V2_ARTIFACT = "tone_cnn_production_v2_candidate_20260712.npz"
_DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "models", "candidate", _FROZEN_PRODUCTION_V2_ARTIFACT
)


def _resolve_model_path(model_path: Optional[str]) -> Optional[str]:
    """Resolve model path: explicit > env (test override) > Frozen V2 default. Fail Closed."""
    if model_path:
        return model_path
    if TONE_MODEL_PATH and os.path.isfile(TONE_MODEL_PATH):
        return TONE_MODEL_PATH
    if os.path.isfile(_DEFAULT_MODEL_PATH):
        return _DEFAULT_MODEL_PATH
    return None

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
        if key in ("inputShape", "outputShape"):
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


def _validate_shapes_v2(weights: ToneModelWeightsV2) -> Optional[str]:
    c1 = P2_CNN_CONV1_OUT
    c2 = P2_CNN_CONV2_OUT
    c3 = P2_CNN_RES_OUT
    fc1 = P2_FC1_OUT
    fc2 = P2_FC2_OUT
    k5 = P2_CNN_KERNEL5
    k3 = P2_CNN_KERNEL3
    checks = [
        (weights.conv1_w.shape, (c1, P1_N_CHANNELS, k5), "conv1_w"),
        (weights.conv1_b.shape, (c1,), "conv1_b"),
        (weights.conv2_w.shape, (c2, c1, k5), "conv2_w"),
        (weights.conv2_b.shape, (c2,), "conv2_b"),
        (weights.conv3_w.shape, (c3, c2, k3), "conv3_w"),
        (weights.conv3_b.shape, (c3,), "conv3_b"),
        (weights.fc1_w.shape, (c2, fc1), "fc1_w"),
        (weights.fc1_b.shape, (fc1,), "fc1_b"),
        (weights.fc2_w.shape, (fc1, fc2), "fc2_w"),
        (weights.fc2_b.shape, (fc2,), "fc2_b"),
        (weights.fc_w.shape, (fc2, P0_N_CLASSES), "fc_w"),
        (weights.fc_b.shape, (P0_N_CLASSES,), "fc_b"),
        (weights.feature_mean.shape, (P1_N_CHANNELS,), "feature_mean"),
        (weights.feature_std.shape, (P1_N_CHANNELS,), "feature_std"),
    ]
    for actual, expected, name in checks:
        if actual != expected:
            return f"{name} expected {expected}, got {actual}"
    for prefix in ("bn1", "bn2", "bn3"):
        ch = c1 if prefix == "bn1" else c2 if prefix == "bn2" else c3
        for suffix in ("gamma", "beta", "running_mean", "running_var"):
            arr = getattr(weights, f"{prefix}_{suffix}")
            if arr.shape != (ch,):
                return f"{prefix}_{suffix} expected ({ch},), got {arr.shape}"
    return None


def _load_weights_v2(data: np.lib.npyio.NpzFile) -> ToneModelWeightsV2:
    for key in P2_REQUIRED_WEIGHT_KEYS:
        if key not in data:
            raise ValueError(f"missing required weight key: {key}")
    for key in _P0_FORBIDDEN_KEYS:
        if key in data:
            raise ValueError(f"p0 artifact key forbidden on P1 loader: {key}")
    weights = ToneModelWeightsV2(
        conv1_w=data["conv1_w"].astype(np.float32),
        conv1_b=data["conv1_b"].astype(np.float32),
        bn1_gamma=data["bn1_gamma"].astype(np.float32),
        bn1_beta=data["bn1_beta"].astype(np.float32),
        bn1_running_mean=data["bn1_running_mean"].astype(np.float32),
        bn1_running_var=data["bn1_running_var"].astype(np.float32),
        conv2_w=data["conv2_w"].astype(np.float32),
        conv2_b=data["conv2_b"].astype(np.float32),
        bn2_gamma=data["bn2_gamma"].astype(np.float32),
        bn2_beta=data["bn2_beta"].astype(np.float32),
        bn2_running_mean=data["bn2_running_mean"].astype(np.float32),
        bn2_running_var=data["bn2_running_var"].astype(np.float32),
        conv3_w=data["conv3_w"].astype(np.float32),
        conv3_b=data["conv3_b"].astype(np.float32),
        bn3_gamma=data["bn3_gamma"].astype(np.float32),
        bn3_beta=data["bn3_beta"].astype(np.float32),
        bn3_running_mean=data["bn3_running_mean"].astype(np.float32),
        bn3_running_var=data["bn3_running_var"].astype(np.float32),
        fc1_w=data["fc1_w"].astype(np.float32),
        fc1_b=data["fc1_b"].astype(np.float32),
        fc2_w=data["fc2_w"].astype(np.float32),
        fc2_b=data["fc2_b"].astype(np.float32),
        fc_w=data["fc_w"].astype(np.float32),
        fc_b=data["fc_b"].astype(np.float32),
        feature_mean=data["feature_mean"].astype(np.float32),
        feature_std=data["feature_std"].astype(np.float32),
    )
    if weights.feature_std is not None:
        weights.feature_std[weights.feature_std < 1e-6] = 1.0
    err = _validate_shapes_v2(weights)
    if err:
        raise ValueError(err)
    return weights


def _resolve_architecture(data: np.lib.npyio.NpzFile) -> str:
    if "modelArchitecture" not in data:
        return P1_MODEL_ARCHITECTURE
    return str(data["modelArchitecture"].item())


def _load_weights(data: np.lib.npyio.NpzFile):
    arch = _resolve_architecture(data)
    if arch == P2_MODEL_ARCHITECTURE:
        return _load_weights_v2(data)
    return _load_weights_v1(data)


def _load_weights_v1(data: np.lib.npyio.NpzFile) -> ToneModelWeightsV1:
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
        shape = [int(x) for x in data["inputShape"]]
        if shape != [64, 83]:
            raise ValueError(f"inputShape mismatch: expected [64, 83], got {shape}")
    if "outputShape" in data:
        shape = [int(x) for x in data["outputShape"]]
        if shape != [P0_N_CLASSES]:
            raise ValueError(f"outputShape mismatch: expected [{P0_N_CLASSES}], got {shape}")
    arch = data["modelArchitecture"].item() if "modelArchitecture" in data else None
    allowed = {P1_MODEL_ARCHITECTURE, P2_MODEL_ARCHITECTURE}
    if arch and arch not in allowed:
        raise ValueError(f"modelArchitecture unsupported: {arch}")


class ToneModelLoaderV1:
    """Load P1 V2 CNN weights. Fail-closed; rejects p0 artifacts."""

    def __init__(self) -> None:
        self._ready = False
        self._load_error: Optional[str] = None
        self._metadata: Optional[ToneModelMetadata] = None
        self._weights: Optional[Any] = None
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
    def weights(self) -> Optional[Any]:
        return self._weights

    def unload(self) -> None:
        self._ready = False
        self._load_error = None
        self._metadata = None
        self._weights = None
        self._model_path = None

    def load(self, model_path: Optional[str] = None) -> ToneLoadResultV1:
        self.unload()
        load_started = time.perf_counter()
        path = _resolve_model_path(model_path)
        if not path:
            self._load_error = "model_not_found"
            return ToneLoadResultV1(ready=False, load_error=self._load_error)

        try:
            data = np.load(path, allow_pickle=True)
            if any(key in data for key in _P0_FORBIDDEN_KEYS):
                raise ValueError("artifact appears to be p0 format; P1 loader refuses it")
            if "featureVersion" in data:
                fv = data["featureVersion"].item()
                if fv in P0_COMPATIBLE_FEATURE_VERSIONS:
                    raise ValueError(f"p0 featureVersion refused: {fv}")

            weights = _load_weights(data)
            metadata = _read_npz_metadata(data)
            _validate_metadata(data, metadata)

            try:
                metadata.model_hash = _file_sha256(path)
            except OSError:
                pass
            metadata.artifact_path = path
            metadata.load_ms = int((time.perf_counter() - load_started) * 1000)
            metadata.runtime_version = P1_RUNTIME_VERSION
            metadata.loader_version = P1_LOADER_VERSION

            self._ready = True
            self._metadata = metadata
            self._weights = weights
            self._model_path = path
            architecture = _resolve_architecture(data)
            input_shape = (
                [int(x) for x in data["inputShape"]] if "inputShape" in data else [64, 83]
            )
            output_shape = (
                [int(x) for x in data["outputShape"]]
                if "outputShape" in data
                else list(P1_OUTPUT_SHAPE)
            )
            logger.info(
                "ToneModule loaded path=%s sha256=%s architecture=%s featureVersion=%s "
                "backend=%s inputShape=%s outputShape=%s trainingVersion=%s",
                path,
                metadata.model_hash or "",
                architecture,
                metadata.feature_version,
                metadata.backend,
                input_shape,
                output_shape,
                metadata.training_version or "",
            )
            return ToneLoadResultV1(ready=True, metadata=metadata, weights=weights)
        except Exception as exc:
            self.unload()
            self._load_error = str(exc)
            logger.warning("ToneModule P1 failed to load %s: %s", path, exc)
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
        inputShape=np.array([64, 83], dtype=np.int64),
        outputShape=np.array(list(P1_OUTPUT_SHAPE), dtype=np.int64),
        modelVersion=np.array(model_version),
        modelArchitecture=np.array(P1_MODEL_ARCHITECTURE),
        backend=np.array(P1_BACKEND),
        trainingVersion=np.array(training_version),
        datasetVersion=np.array(dataset_version),
        buildTime=np.array(build_time),
        notes=np.array(notes or json.dumps(metrics, ensure_ascii=False)),
        metrics=metrics,
    )


def save_artifact_v2(
    path: str,
    weights: ToneModelWeightsV2,
    *,
    model_version: str,
    training_version: str,
    dataset_version: str,
    metrics: dict,
    notes: str = "",
) -> None:
    """Write Production CNN V2 npz (npz-p1-v1 schema extension)."""
    import json
    import os
    from datetime import datetime, timezone

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    build_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    np.savez(
        path,
        conv1_w=weights.conv1_w.astype(np.float32),
        conv1_b=weights.conv1_b.astype(np.float32),
        bn1_gamma=weights.bn1_gamma.astype(np.float32),
        bn1_beta=weights.bn1_beta.astype(np.float32),
        bn1_running_mean=weights.bn1_running_mean.astype(np.float32),
        bn1_running_var=weights.bn1_running_var.astype(np.float32),
        conv2_w=weights.conv2_w.astype(np.float32),
        conv2_b=weights.conv2_b.astype(np.float32),
        bn2_gamma=weights.bn2_gamma.astype(np.float32),
        bn2_beta=weights.bn2_beta.astype(np.float32),
        bn2_running_mean=weights.bn2_running_mean.astype(np.float32),
        bn2_running_var=weights.bn2_running_var.astype(np.float32),
        conv3_w=weights.conv3_w.astype(np.float32),
        conv3_b=weights.conv3_b.astype(np.float32),
        bn3_gamma=weights.bn3_gamma.astype(np.float32),
        bn3_beta=weights.bn3_beta.astype(np.float32),
        bn3_running_mean=weights.bn3_running_mean.astype(np.float32),
        bn3_running_var=weights.bn3_running_var.astype(np.float32),
        fc1_w=weights.fc1_w.astype(np.float32),
        fc1_b=weights.fc1_b.astype(np.float32),
        fc2_w=weights.fc2_w.astype(np.float32),
        fc2_b=weights.fc2_b.astype(np.float32),
        fc_w=weights.fc_w.astype(np.float32),
        fc_b=weights.fc_b.astype(np.float32),
        feature_mean=weights.feature_mean.astype(np.float32),
        feature_std=weights.feature_std.astype(np.float32),
        formatVersion=np.array(P1_FORMAT_VERSION),
        featureVersion=np.array(P1_FEATURE_VERSION),
        inputShape=np.array([64, 83], dtype=np.int64),
        outputShape=np.array(list(P1_OUTPUT_SHAPE), dtype=np.int64),
        modelVersion=np.array(model_version),
        modelArchitecture=np.array(P2_MODEL_ARCHITECTURE),
        backend=np.array(P1_BACKEND),
        trainingVersion=np.array(training_version),
        datasetVersion=np.array(dataset_version),
        buildTime=np.array(build_time),
        notes=np.array(notes or json.dumps(metrics, ensure_ascii=False)),
        metrics=metrics,
    )


_loader_v1: Optional[ToneModelLoaderV1] = None


def get_tone_loader_v1() -> ToneModelLoaderV1:
    global _loader_v1
    if _loader_v1 is None:
        _loader_v1 = ToneModelLoaderV1()
        _loader_v1.load(None)
    return _loader_v1


def reset_tone_loader_v1_singleton() -> None:
    """Test-only: clear process singleton. Must not be called from production runtime."""
    global _loader_v1
    _loader_v1 = None
