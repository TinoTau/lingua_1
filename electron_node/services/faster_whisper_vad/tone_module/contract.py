"""ToneModule Phase 1 — metadata contract and P0 feature baseline."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

P0_FEATURE_VERSION = "p0-v1"
# Shipped P0 npz artifact uses mel_mean_80_v1; semantically equivalent baseline.
P0_COMPATIBLE_FEATURE_VERSIONS = frozenset({P0_FEATURE_VERSION, "mel_mean_80_v1"})
P0_BACKEND = "numpy_p0"
P0_SAMPLE_RATE = 16000
P0_N_MELS = 80
P0_N_FFT = 512
P0_HOP_LENGTH = 160
P0_FMIN = 50.0
P0_FMAX = 7600.0
P0_MIN_SLICE_SEC = 0.02
P0_N_CLASSES = 5
P0_HIDDEN = 32

METADATA_WARNING_FEATURE_VERSION_MISSING = "featureVersion_missing"


@dataclass(frozen=True)
class ToneFeatureBaseline:
    feature_version: str = P0_FEATURE_VERSION
    sample_rate: int = P0_SAMPLE_RATE
    n_mels: int = P0_N_MELS
    n_fft: int = P0_N_FFT
    hop_length: int = P0_HOP_LENGTH
    f_min: float = P0_FMIN
    f_max: float = P0_FMAX
    min_slice_sec: float = P0_MIN_SLICE_SEC


P0_FEATURE_BASELINE = ToneFeatureBaseline()


@dataclass
class ToneModelMetadata:
    backend: str = P0_BACKEND
    feature_version: str = P0_FEATURE_VERSION
    format_version: Optional[str] = None
    model_version: Optional[str] = None
    training_version: Optional[str] = None
    dataset_version: Optional[str] = None
    build_time: Optional[str] = None
    notes: Optional[str] = None
    model_hash: Optional[str] = None
    artifact_path: Optional[str] = None
    load_ms: Optional[int] = None
    metadata_warning: Optional[str] = None
    runtime_version: Optional[str] = None
    loader_version: Optional[str] = None

    def as_diagnostics_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "backend": self.backend,
            "backendAdapter": self.backend,
            "featureVersion": self.feature_version,
        }
        if self.format_version is not None:
            out["formatVersion"] = self.format_version
        if self.model_version is not None:
            out["modelVersion"] = self.model_version
        if self.training_version is not None:
            out["trainingVersion"] = self.training_version
        if self.dataset_version is not None:
            out["datasetVersion"] = self.dataset_version
        if self.build_time is not None:
            out["buildTime"] = self.build_time
        if self.notes is not None:
            out["notes"] = self.notes
        if self.model_hash is not None:
            out["modelHash"] = self.model_hash
            out["artifactHash"] = self.model_hash
        if self.artifact_path is not None:
            out["artifactPath"] = self.artifact_path
        if self.load_ms is not None:
            out["loadMs"] = self.load_ms
        if self.runtime_version is not None:
            out["runtimeVersion"] = self.runtime_version
        if self.loader_version is not None:
            out["loaderVersion"] = self.loader_version
        if self.metadata_warning is not None:
            out["metadataWarning"] = self.metadata_warning
        return out


@dataclass
class ToneModelWeights:
    w1: Any
    b1: Any
    w2: Any
    b2: Any
    mel_mean: Optional[Any] = None
    mel_std: Optional[Any] = None


@dataclass
class ToneLoadResult:
    ready: bool
    load_error: Optional[str] = None
    metadata: Optional[ToneModelMetadata] = None
    weights: Optional[ToneModelWeights] = None


# --- Feature V2 (p1-frame-mel-f0-v1) — Feature Contract Specification SSOT ---

P1_FEATURE_VERSION = "p1-frame-mel-f0-v1"
P1_SAMPLE_RATE = 16000
P1_FRAME_LENGTH_MS = 25
P1_HOP_LENGTH_MS = 10
P1_N_FFT = 400
P1_HOP_LENGTH = 160
P1_N_MELS = 80
P1_FMIN = 50.0
P1_FMAX = 7600.0
P1_FIXED_FRAMES = 64
P1_N_CHANNELS = 83
P1_MIN_SLICE_SEC = P0_MIN_SLICE_SEC

P1_CH_LOG_F0 = 80
P1_CH_DELTA_LOG_F0 = 81
P1_CH_VOICED = 82

P1_RESAMPLE_POLICY = "duration_normalized_linear_interp"
P1_OVERFLOW_POLICY = "center_crop_if_raw_frames_gt_fixed"
P1_LOG_SCALE = "log10"

P1_F0_ALGORITHM = "frame_lag_autocorrelation_v1"
P1_F0_MIN_HZ = P1_FMIN
P1_F0_MAX_HZ = 500.0
P1_F0_VOICED_CORR_THRESHOLD = 0.3
P1_F0_UNVOICED_LOG_VALUE = 0.0
P1_F0_DELTA_DIRECTION = "forward"
P1_F0_DELTA_BOUNDARY = "zero"
P1_F0_DELTA_UNVOICED = "zero"

P1_FEATURE_EQUALITY_MAX_ABS_DIFF = 1e-5

P1_FEATURE_SHAPE = (P1_FIXED_FRAMES, P1_N_CHANNELS)

P1_SHARD_SCHEMA_VERSION = "training_feature_shard_v2"


@dataclass(frozen=True)
class ToneFeatureBaselineV1:
    """Frozen p1-frame-mel-f0-v1 DSP + tensor contract."""

    feature_version: str = P1_FEATURE_VERSION
    sample_rate: int = P1_SAMPLE_RATE
    frame_length_ms: int = P1_FRAME_LENGTH_MS
    hop_length_ms: int = P1_HOP_LENGTH_MS
    n_fft: int = P1_N_FFT
    hop_length: int = P1_HOP_LENGTH
    n_mels: int = P1_N_MELS
    f_min: float = P1_FMIN
    f_max: float = P1_FMAX
    fixed_frames: int = P1_FIXED_FRAMES
    n_channels: int = P1_N_CHANNELS
    min_slice_sec: float = P1_MIN_SLICE_SEC
    resample_policy: str = P1_RESAMPLE_POLICY
    overflow_policy: str = P1_OVERFLOW_POLICY


P1_FEATURE_BASELINE = ToneFeatureBaselineV1()

# --- P1 V2 Tone Model Artifact (P9-A) — isolated from p0 npz-v1 ---

P1_BACKEND = "numpy_p1"
P1_FORMAT_VERSION = "npz-p1-v1"
P1_DEFAULT_MODEL_VERSION = "tone_cnn_p1_v1"
P1_RUNTIME_ARTIFACT_NAME = "tone_cnn_p1_v1_full.npz"
P1_RUNTIME_VERSION = "p10-p1-direct-replacement-v1"
P1_LOADER_VERSION = "ToneModelLoaderV1"
P1_MODEL_ARCHITECTURE = "conv1d_global_pool_v1"
P1_OUTPUT_SHAPE = (P0_N_CLASSES,)

P1_CNN_CONV1_OUT = 32
P1_CNN_CONV2_OUT = 64
P1_CNN_KERNEL_SIZE = 3
P1_CNN_CONV_PAD = 1

P1_REQUIRED_WEIGHT_KEYS = (
    "conv1_w",
    "conv1_b",
    "conv2_w",
    "conv2_b",
    "fc_w",
    "fc_b",
    "feature_mean",
    "feature_std",
)


@dataclass
class ToneModelWeightsV1:
    conv1_w: Any
    conv1_b: Any
    conv2_w: Any
    conv2_b: Any
    fc_w: Any
    fc_b: Any
    feature_mean: Any
    feature_std: Any


@dataclass
class ToneLoadResultV1:
    ready: bool
    load_error: Optional[str] = None
    metadata: Optional[ToneModelMetadata] = None
    weights: Optional[Any] = None


# --- Tone Model V2 Production CNN (Phase A) — same npz-p1-v1 / numpy_p1 backend ---

P2_MODEL_ARCHITECTURE = "conv1d_production_v2"
P2_DEFAULT_MODEL_VERSION = "tone_cnn_production_v2"
P2_CNN_CONV1_OUT = 96
P2_CNN_CONV2_OUT = 192
P2_CNN_RES_OUT = 192
P2_CNN_KERNEL5 = 5
P2_CNN_KERNEL3 = 3
P2_CNN_CONV5_PAD = 2
P2_CNN_CONV3_PAD = 1
P2_FC1_OUT = 192
P2_FC2_OUT = 96
P2_BN_EPS = 1e-5

P2_REQUIRED_WEIGHT_KEYS = (
    "conv1_w",
    "conv1_b",
    "bn1_gamma",
    "bn1_beta",
    "bn1_running_mean",
    "bn1_running_var",
    "conv2_w",
    "conv2_b",
    "bn2_gamma",
    "bn2_beta",
    "bn2_running_mean",
    "bn2_running_var",
    "conv3_w",
    "conv3_b",
    "bn3_gamma",
    "bn3_beta",
    "bn3_running_mean",
    "bn3_running_var",
    "fc1_w",
    "fc1_b",
    "fc2_w",
    "fc2_b",
    "fc_w",
    "fc_b",
    "feature_mean",
    "feature_std",
)


@dataclass
class ToneModelWeightsV2:
    """Production CNN V2 weights for numpy_p1 inference."""

    conv1_w: Any
    conv1_b: Any
    bn1_gamma: Any
    bn1_beta: Any
    bn1_running_mean: Any
    bn1_running_var: Any
    conv2_w: Any
    conv2_b: Any
    bn2_gamma: Any
    bn2_beta: Any
    bn2_running_mean: Any
    bn2_running_var: Any
    conv3_w: Any
    conv3_b: Any
    bn3_gamma: Any
    bn3_beta: Any
    bn3_running_mean: Any
    bn3_running_var: Any
    fc1_w: Any
    fc1_b: Any
    fc2_w: Any
    fc2_b: Any
    fc_w: Any
    fc_b: Any
    feature_mean: Any
    feature_std: Any

    @property
    def architecture(self) -> str:
        return P2_MODEL_ARCHITECTURE
