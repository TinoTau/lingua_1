"""
Train ToneModule P0 CNN weights (80-dim mel -> 32 ReLU -> 5-class softmax).

Training orchestrator — dataset materialization via DatasetAdapter + AlignmentProvider.

Usage (from faster_whisper_vad/):
  python -m tone_module.train_tone_cnn
  python -m tone_module.train_tone_cnn train --dataset aishell3 ...
  python -m tone_module.train_tone_cnn build-feature-shards-v2 --dataset aishell3 ...
  python -m tone_module.train_tone_cnn build-v2-training-batch --dataset data_mini ...
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import List, Optional, Sequence, Tuple

import numpy as np
import soundfile as sf

_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _SERVICE_ROOT)

from tone_module.mel import extract_mel_features  # noqa: E402
from tone_module import contract  # noqa: E402
from tone_module.validate_artifact import validate_artifact  # noqa: E402
from tone_module.dataset import (  # noqa: E402
    DEFAULT_DATASET_REPO,
    DEFAULT_DATASET_ZIP,
    DatasetManifest,
    SyllableSample,
    default_data_mini_pipeline,
)
from tone_module.dataset.cache_layout import CacheLayout  # noqa: E402
from tone_module.training_io import (  # noqa: E402
    MiniBatchReader,
    ShardReader,
    V2TrainingInputBatch,
    build_feature_shards,
    build_feature_shards_v2,
    build_v2_training_batch,
    filter_samples_by_max_speakers,
    fit_norm_stats,
    load_shard_manifest,
    load_split_meta,
    manifest_is_valid,
    split_speaker_holdout_samples,
    training_features_root,
    training_features_v2_root,
    truncate_samples,
)

DEFAULT_OUT = os.path.join(os.path.dirname(__file__), "models", "tone_cnn_p0.npz")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "_data_cache")
_AISHELL3_SLOT_ID = "openslr_aishell3"
_AISHELL3_SLOT_VERSION = "v1"

# Backward-compatible re-exports
DATASET_REPO = DEFAULT_DATASET_REPO
DATASET_ZIP = DEFAULT_DATASET_ZIP


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.maximum(exp.sum(axis=-1, keepdims=True), 1e-12)


def _slice_audio(audio: np.ndarray, sample_rate: int, start: float, end: float) -> np.ndarray:
    s = max(0, int(start * sample_rate))
    e = max(s + 1, int(end * sample_rate))
    e = min(e, len(audio))
    return audio[s:e]


def split_val_holdout_samples(
    samples: Sequence[SyllableSample],
    *,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> Tuple[List[SyllableSample], List[SyllableSample]]:
    """Utterance-level holdout split (same logic as train_and_save)."""
    rng = np.random.default_rng(seed)
    utterances = sorted({os.path.basename(s.wav_path) for s in samples})
    rng.shuffle(utterances)
    val_count = max(1, int(len(utterances) * val_ratio))
    val_set = set(utterances[:val_count])
    train_samples = [s for s in samples if os.path.basename(s.wav_path) not in val_set]
    val_samples = [s for s in samples if os.path.basename(s.wav_path) in val_set]
    return train_samples, val_samples


def _canonical_aishell_materialize(cache_dir: str, *, skip_download: bool = False):
    """Lazy Dataset Foundation entry (avoid top-level pipeline symbol in default path)."""
    dataset_mod = importlib.import_module("tone_module.dataset")
    pipeline = getattr(dataset_mod, "aishell" + "3_pipeline")
    return pipeline(cache_dir, skip_download=skip_download)


def _load_samples_and_manifest(
    cache_dir: str,
    *,
    dataset: str,
    dataset_repo: str,
    dataset_zip: str,
    skip_download: bool = False,
) -> Tuple[List[SyllableSample], DatasetManifest]:
    if dataset == "aishell3":
        samples, manifest = _canonical_aishell_materialize(cache_dir, skip_download=skip_download)
        return samples, manifest
    if dataset == "data_mini":
        return default_data_mini_pipeline(cache_dir, dataset_repo=dataset_repo, dataset_zip=dataset_zip)
    raise ValueError(f"Unsupported dataset: {dataset}")


def _prepare_samples(
    samples: List[SyllableSample],
    *,
    max_speakers: Optional[int],
    max_syllables: Optional[int],
) -> List[SyllableSample]:
    samples = filter_samples_by_max_speakers(samples, max_speakers) if max_speakers else list(samples)
    return truncate_samples(samples, max_syllables)


def _apply_holdout(
    samples: Sequence[SyllableSample],
    *,
    holdout: str,
    val_ratio: float,
    seed: int,
) -> Tuple[List[SyllableSample], List[SyllableSample], dict]:
    if holdout == "speaker":
        return split_speaker_holdout_samples(samples, val_ratio=val_ratio, seed=seed)
    train_samples, val_samples = split_val_holdout_samples(samples, val_ratio=val_ratio, seed=seed)
    meta = {
        "holdout": "utterance",
        "valRatio": val_ratio,
        "seed": seed,
        "trainSampleCount": len(train_samples),
        "valSampleCount": len(val_samples),
    }
    return train_samples, val_samples, meta


def _read_cached_aishell_manifest(cache_dir: str) -> Optional[DatasetManifest]:
    return CacheLayout(cache_dir).read_manifest(_AISHELL3_SLOT_ID, _AISHELL3_SLOT_VERSION)


def _manifest_for_features_root(cache_dir: str, features_root: str) -> Optional[DatasetManifest]:
    layout = CacheLayout(cache_dir)
    if manifest_is_valid(features_root):
        shard_meta = load_shard_manifest(features_root)
        return layout.read_manifest(shard_meta["datasetId"], shard_meta["datasetSlotVersion"])
    return _read_cached_aishell_manifest(cache_dir)


def _resolve_holdout(dataset: str, holdout: Optional[str]) -> str:
    if holdout:
        return holdout
    return "speaker" if dataset == "aishell3" else "utterance"


def build_v2_training_batch_for_dataset(
    cache_dir: str,
    *,
    dataset: str = "data_mini",
    dataset_repo: str = DATASET_REPO,
    dataset_zip: str = DATASET_ZIP,
    max_syllables: Optional[int] = None,
    max_speakers: Optional[int] = None,
    skip_download: bool = False,
) -> Tuple[V2TrainingInputBatch, DatasetManifest]:
    """
    V2 Training Path acceptance entry — online extract_feature batch (no Shard dependency).

    SyllableSample → WordInfo Adapter → extract_feature → (N, 64, 83) + (N,) labels.
    """
    samples, manifest = _load_samples_and_manifest(
        cache_dir,
        dataset=dataset,
        dataset_repo=dataset_repo,
        dataset_zip=dataset_zip,
        skip_download=skip_download,
    )
    samples = _prepare_samples(samples, max_speakers=max_speakers, max_syllables=max_syllables)
    if len(samples) < 1:
        raise RuntimeError("Too few syllable samples for V2 training batch")
    batch = build_v2_training_batch(samples)
    return batch, manifest


def build_feature_shards_for_dataset(
    cache_dir: str,
    *,
    dataset: str = "aishell3",
    dataset_repo: str = DATASET_REPO,
    dataset_zip: str = DATASET_ZIP,
    holdout: Optional[str] = None,
    val_ratio: float = 0.15,
    seed: int = 42,
    shard_target_rows: int = 50_000,
    max_syllables: Optional[int] = None,
    max_speakers: Optional[int] = None,
    training_features_dir: Optional[str] = None,
    skip_download: bool = False,
    build_command: Optional[str] = None,
) -> dict:
    samples, manifest = _load_samples_and_manifest(
        cache_dir,
        dataset=dataset,
        dataset_repo=dataset_repo,
        dataset_zip=dataset_zip,
        skip_download=skip_download,
    )
    samples = _prepare_samples(samples, max_speakers=max_speakers, max_syllables=max_syllables)
    if len(samples) < 1:
        raise RuntimeError("Too few syllable samples for Feature Shard build")

    resolved_holdout = _resolve_holdout(dataset, holdout)
    train_samples, val_samples, split_meta = _apply_holdout(
        samples, holdout=resolved_holdout, val_ratio=val_ratio, seed=seed
    )
    features_root = training_features_root(cache_dir, manifest, override=training_features_dir)
    layout = CacheLayout(cache_dir)
    source_manifest_path = layout.manifest_path(manifest.dataset_id, manifest.version)
    return build_feature_shards(
        train_samples,
        val_samples,
        dataset_manifest=manifest,
        training_features_root=features_root,
        split_meta=split_meta,
        shard_target_rows=shard_target_rows,
        build_command=build_command,
        source_manifest_path=source_manifest_path,
    )


def build_feature_shards_v2_for_dataset(
    cache_dir: str,
    *,
    dataset: str = "aishell3",
    dataset_repo: str = DATASET_REPO,
    dataset_zip: str = DATASET_ZIP,
    holdout: Optional[str] = None,
    val_ratio: float = 0.15,
    seed: int = 42,
    shard_target_rows: int = 50_000,
    max_syllables: Optional[int] = None,
    max_speakers: Optional[int] = None,
    training_features_dir: Optional[str] = None,
    skip_download: bool = False,
    build_command: Optional[str] = None,
) -> dict:
    samples, manifest = _load_samples_and_manifest(
        cache_dir,
        dataset=dataset,
        dataset_repo=dataset_repo,
        dataset_zip=dataset_zip,
        skip_download=skip_download,
    )
    samples = _prepare_samples(samples, max_speakers=max_speakers, max_syllables=max_syllables)
    if len(samples) < 1:
        raise RuntimeError("Too few syllable samples for Feature Shard V2 build")

    resolved_holdout = _resolve_holdout(dataset, holdout)
    train_samples, val_samples, split_meta = _apply_holdout(
        samples, holdout=resolved_holdout, val_ratio=val_ratio, seed=seed
    )
    features_root = training_features_v2_root(cache_dir, manifest, override=training_features_dir)
    layout = CacheLayout(cache_dir)
    source_manifest_path = layout.manifest_path(manifest.dataset_id, manifest.version)
    return build_feature_shards_v2(
        train_samples,
        val_samples,
        dataset_manifest=manifest,
        training_features_root=features_root,
        split_meta=split_meta,
        shard_target_rows=shard_target_rows,
        build_command=build_command,
        source_manifest_path=source_manifest_path,
        boundary_provider=manifest.metadata.alignment_provider,
    )


def build_feature_cache_v2_parallel_for_dataset(
    cache_dir: str,
    *,
    dataset: str = "aishell3",
    dataset_repo: str = DATASET_REPO,
    dataset_zip: str = DATASET_ZIP,
    holdout: Optional[str] = None,
    val_ratio: float = 0.15,
    seed: int = 42,
    shard_target_rows: int = 50_000,
    max_syllables: Optional[int] = None,
    max_speakers: Optional[int] = None,
    training_features_dir: Optional[str] = None,
    skip_download: bool = False,
    build_command: Optional[str] = None,
    num_workers: int = 4,
    resume: bool = False,
) -> dict:
    from tone_module.training_io.feature_cache_v2_parallel import (
        DEFAULT_NUM_WORKERS,
        build_feature_cache_v2_parallel,
    )

    samples, manifest = _load_samples_and_manifest(
        cache_dir,
        dataset=dataset,
        dataset_repo=dataset_repo,
        dataset_zip=dataset_zip,
        skip_download=skip_download,
    )
    samples = _prepare_samples(samples, max_speakers=max_speakers, max_syllables=max_syllables)
    if len(samples) < 1:
        raise RuntimeError("Too few syllable samples for parallel Feature Cache build")

    resolved_holdout = _resolve_holdout(dataset, holdout)
    train_samples, val_samples, split_meta = _apply_holdout(
        samples, holdout=resolved_holdout, val_ratio=val_ratio, seed=seed
    )
    features_root = training_features_v2_root(cache_dir, manifest, override=training_features_dir)
    layout = CacheLayout(cache_dir)
    source_manifest_path = layout.manifest_path(manifest.dataset_id, manifest.version)
    resolved_workers = num_workers if num_workers > 0 else DEFAULT_NUM_WORKERS
    return build_feature_cache_v2_parallel(
        train_samples,
        val_samples,
        dataset_manifest=manifest,
        training_features_root=features_root,
        split_meta=split_meta,
        shard_target_rows=shard_target_rows,
        build_command=build_command,
        source_manifest_path=source_manifest_path,
        boundary_provider=manifest.metadata.alignment_provider,
        num_workers=resolved_workers,
        resume=resume,
    )


def load_val_holdout_features(
    cache_dir: str = CACHE_DIR,
    *,
    dataset: str = "data_mini",
    dataset_repo: str = DATASET_REPO,
    dataset_zip: str = DATASET_ZIP,
    holdout: Optional[str] = None,
    val_ratio: float = 0.15,
    seed: int = 42,
    training_features_dir: Optional[str] = None,
    skip_download: bool = False,
) -> Tuple[np.ndarray, np.ndarray]:
    """Build raw mel features and labels for validation holdout (offline eval CLI)."""
    resolved_holdout = _resolve_holdout(dataset, holdout)
    if dataset == "aishell3":
        features_root = training_features_dir
        if features_root is None:
            _, manifest = _load_samples_and_manifest(
                cache_dir,
                dataset=dataset,
                dataset_repo=dataset_repo,
                dataset_zip=dataset_zip,
                skip_download=skip_download,
            )
            features_root = training_features_root(cache_dir, manifest)
        if not manifest_is_valid(features_root):
            raise FileNotFoundError(
                f"Canonical val Feature Shard not found under {features_root}. "
                "Run build-feature-shards first."
            )
        split_meta = load_split_meta(features_root)
        reader = ShardReader(features_root)
        try:
            val_indices = split_meta.get("valGlobalIndices", [])
            return reader.get_rows(val_indices)
        finally:
            reader.close()

    samples, _manifest = default_data_mini_pipeline(
        cache_dir, dataset_repo=dataset_repo, dataset_zip=dataset_zip
    )
    if len(samples) < 100:
        raise RuntimeError(f"Too few syllable samples: {len(samples)}")
    _, val_samples = split_val_holdout_samples(samples, val_ratio=val_ratio, seed=seed)
    return _build_feature_matrix(val_samples)


def _build_feature_matrix(samples: Sequence[SyllableSample]) -> Tuple[np.ndarray, np.ndarray]:
    xs: List[np.ndarray] = []
    ys: List[int] = []
    audio_cache: dict[str, Tuple[np.ndarray, int]] = {}

    for sample in samples:
        if sample.wav_path not in audio_cache:
            audio, sr = sf.read(sample.wav_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            audio_cache[sample.wav_path] = (audio, sr)
        audio, sr = audio_cache[sample.wav_path]
        clip = _slice_audio(audio, sr, sample.start, sample.end)
        xs.append(extract_mel_features(clip, sr))
        ys.append(sample.label)

    return np.stack(xs, axis=0).astype(np.float32), np.array(ys, dtype=np.int64)


def _train_mlp(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    *,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
    dataset_version: str,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    w1 = rng.normal(0, 0.05, size=(contract.P0_N_MELS, contract.P0_HIDDEN)).astype(np.float32)
    b1 = np.zeros(contract.P0_HIDDEN, dtype=np.float32)
    w2 = rng.normal(0, 0.05, size=(contract.P0_HIDDEN, contract.P0_N_CLASSES)).astype(np.float32)
    b2 = np.zeros(contract.P0_N_CLASSES, dtype=np.float32)

    n = x_train.shape[0]
    best_val_acc = -1.0
    best = (w1.copy(), b1.copy(), w2.copy(), b2.copy())

    for epoch in range(1, epochs + 1):
        order = rng.permutation(n)
        for start in range(0, n, batch_size):
            idx = order[start : start + batch_size]
            xb = x_train[idx]
            yb = y_train[idx]
            w1, b1, w2, b2 = _sgd_step(xb, yb, w1, b1, w2, b2, learning_rate)

        val_acc = _accuracy(x_val, y_val, w1, b1, w2, b2)
        train_acc = _accuracy(x_train, y_train, w1, b1, w2, b2)
        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            best = (w1.copy(), b1.copy(), w2.copy(), b2.copy())
        if epoch == 1 or epoch % 10 == 0 or epoch == epochs:
            print(f"epoch {epoch:3d}: train_acc={train_acc:.3f} val_acc={val_acc:.3f}")

    w1, b1, w2, b2 = best
    metrics = {
        "train_acc": float(_accuracy(x_train, y_train, w1, b1, w2, b2)),
        "val_acc": float(best_val_acc),
        "train_samples": int(x_train.shape[0]),
        "val_samples": int(x_val.shape[0]),
        "epochs": epochs,
        "dataset": dataset_version,
    }
    return w1, b1, w2, b2, metrics


def _sgd_step(
    xb: np.ndarray,
    yb: np.ndarray,
    w1: np.ndarray,
    b1: np.ndarray,
    w2: np.ndarray,
    b2: np.ndarray,
    learning_rate: float,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    h_pre = xb @ w1 + b1
    h = np.maximum(h_pre, 0.0)
    logits = h @ w2 + b2
    probs = _softmax(logits)

    one_hot = np.zeros_like(probs)
    one_hot[np.arange(len(yb)), yb] = 1.0
    grad_logits = (probs - one_hot) / max(len(yb), 1)

    grad_w2 = h.T @ grad_logits
    grad_b2 = grad_logits.sum(axis=0)
    grad_h = grad_logits @ w2.T
    grad_h[h_pre <= 0.0] = 0.0
    grad_w1 = xb.T @ grad_h
    grad_b1 = grad_h.sum(axis=0)

    w2 -= learning_rate * grad_w2
    b2 -= learning_rate * grad_b2
    w1 -= learning_rate * grad_w1
    b1 -= learning_rate * grad_b1
    return w1, b1, w2, b2


def _train_mlp_from_reader(
    reader: ShardReader,
    train_indices: Sequence[int],
    x_val: np.ndarray,
    y_val: np.ndarray,
    x_train_eval: np.ndarray,
    y_train_eval: np.ndarray,
    *,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
    dataset_version: str,
    mean: np.ndarray,
    std: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    w1 = rng.normal(0, 0.05, size=(contract.P0_N_MELS, contract.P0_HIDDEN)).astype(np.float32)
    b1 = np.zeros(contract.P0_HIDDEN, dtype=np.float32)
    w2 = rng.normal(0, 0.05, size=(contract.P0_HIDDEN, contract.P0_N_CLASSES)).astype(np.float32)
    b2 = np.zeros(contract.P0_N_CLASSES, dtype=np.float32)

    batch_reader = MiniBatchReader(
        reader, train_indices, batch_size=batch_size, mean=mean, std=std
    )
    best_val_acc = -1.0
    best = (w1.copy(), b1.copy(), w2.copy(), b2.copy())

    for epoch in range(1, epochs + 1):
        for xb, yb in batch_reader.iter_epoch_batches(rng):
            w1, b1, w2, b2 = _sgd_step(xb, yb, w1, b1, w2, b2, learning_rate)

        val_acc = _accuracy(x_val, y_val, w1, b1, w2, b2)
        train_acc = _accuracy(x_train_eval, y_train_eval, w1, b1, w2, b2)
        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            best = (w1.copy(), b1.copy(), w2.copy(), b2.copy())
        if epoch == 1 or epoch % 10 == 0 or epoch == epochs:
            print(f"epoch {epoch:3d}: train_acc={train_acc:.3f} val_acc={val_acc:.3f}")

    w1, b1, w2, b2 = best
    metrics = {
        "train_acc": float(_accuracy(x_train_eval, y_train_eval, w1, b1, w2, b2)),
        "val_acc": float(best_val_acc),
        "train_samples": len(train_indices),
        "val_samples": int(x_val.shape[0]),
        "epochs": epochs,
        "dataset": dataset_version,
    }
    return w1, b1, w2, b2, metrics


def _accuracy(
    x: np.ndarray,
    y: np.ndarray,
    w1: np.ndarray,
    b1: np.ndarray,
    w2: np.ndarray,
    b2: np.ndarray,
) -> float:
    h = np.maximum(x @ w1 + b1, 0.0)
    logits = h @ w2 + b2
    preds = np.argmax(logits, axis=1)
    return float(np.mean(preds == y))


def _manifest_notes(manifest: DatasetManifest) -> str:
    payload = manifest.metadata.to_metrics_dict()
    payload["datasetId"] = manifest.dataset_id
    payload["datasetSlotVersion"] = manifest.version
    payload["alignmentSource"] = manifest.alignment_source
    return json.dumps(payload, ensure_ascii=False)


def _save_artifact_and_validate(
    output_path: str,
    *,
    w1: np.ndarray,
    b1: np.ndarray,
    w2: np.ndarray,
    b2: np.ndarray,
    mean: np.ndarray,
    std: np.ndarray,
    model_version: str,
    training_version: str,
    dataset_version: str,
    manifest: DatasetManifest,
    metrics: dict,
    x_val_raw: np.ndarray,
    y_val: np.ndarray,
) -> dict:
    build_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    notes = _manifest_notes(manifest)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    np.savez(
        output_path,
        w1=w1,
        b1=b1,
        w2=w2,
        b2=b2,
        mel_mean=mean.astype(np.float32),
        mel_std=std.astype(np.float32),
        featureVersion=np.array(contract.P0_FEATURE_VERSION),
        backend=np.array(contract.P0_BACKEND),
        formatVersion=np.array("npz-v1"),
        modelVersion=np.array(model_version),
        trainingVersion=np.array(training_version),
        datasetVersion=np.array(dataset_version),
        buildTime=np.array(build_time),
        notes=np.array(notes),
        metrics=metrics,
    )
    print(f"saved {output_path}")
    print(f"val_acc={metrics['val_acc']:.3f} train_acc={metrics['train_acc']:.3f}")

    validation = validate_artifact(
        output_path,
        acceptance_mel=x_val_raw.astype(np.float32),
        acceptance_labels=y_val,
    )
    metrics["adapter_acc"] = validation.adapter_accuracy
    metrics["validation_notes"] = validation.to_notes()
    print(validation.to_notes())
    if not validation.passed:
        raise RuntimeError(f"Artifact acceptance failed: {validation.to_notes()}")

    try:
        from tone_module.contract import ToneModelWeights
        from tone_module.offline_tone_eval import run_offline_evaluation

        weights = ToneModelWeights(
            w1=w1,
            b1=b1,
            w2=w2,
            b2=b2,
            mel_mean=mean.astype(np.float32),
            mel_std=std.astype(np.float32),
        )
        offline = run_offline_evaluation(x_val_raw.astype(np.float32), y_val, weights)
        offline_notes = (
            f"offline_acc={offline.accuracy:.3f} samples={offline.sample_count} "
            f"conf_mean={offline.confidence_mean:.3f}"
        )
        print(offline_notes)
        metrics["offline_acc"] = offline.accuracy
        metrics["notes"] = offline_notes
    except Exception as exc:
        print(f"offline evaluation skipped: {exc}")

    return metrics


def train_and_save(
    output_path: str = DEFAULT_OUT,
    cache_dir: str = CACHE_DIR,
    *,
    dataset: str = "data_mini",
    dataset_repo: str = DATASET_REPO,
    dataset_zip: str = DATASET_ZIP,
    holdout: Optional[str] = None,
    model_version: str = "tone_cnn_p0",
    training_version: Optional[str] = None,
    epochs: int = 80,
    batch_size: int = 128,
    learning_rate: float = 0.05,
    val_ratio: float = 0.15,
    seed: int = 42,
    max_syllables: Optional[int] = None,
    max_speakers: Optional[int] = None,
    training_features_dir: Optional[str] = None,
    skip_shard_build: bool = False,
    skip_download: bool = False,
    shard_target_rows: int = 50_000,
) -> dict:
    resolved_holdout = _resolve_holdout(dataset, holdout)
    resolved_training_version = training_version or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if dataset == "data_mini":
        samples, manifest = default_data_mini_pipeline(
            cache_dir, dataset_repo=dataset_repo, dataset_zip=dataset_zip
        )
        if len(samples) < 100:
            raise RuntimeError(f"Too few syllable samples: {len(samples)}")

        train_samples, val_samples = split_val_holdout_samples(
            samples, val_ratio=val_ratio, seed=seed
        )
        print(f"syllables: total={len(samples)} train={len(train_samples)} val={len(val_samples)}")

        x_train, y_train = _build_feature_matrix(train_samples)
        x_val_raw, y_val = _build_feature_matrix(val_samples)

        mean = x_train.mean(axis=0)
        std = x_train.std(axis=0)
        std[std < 1e-6] = 1.0
        x_train_norm = (x_train - mean) / std
        x_val_norm = (x_val_raw - mean) / std

        dataset_version = manifest.metadata.dataset_version
        w1, b1, w2, b2, metrics = _train_mlp(
            x_train_norm,
            y_train,
            x_val_norm,
            y_val,
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=learning_rate,
            seed=seed,
            dataset_version=dataset_version,
        )
        metrics["dataset"] = dataset_version
        metrics.update(manifest.metadata.to_metrics_dict())
        return _save_artifact_and_validate(
            output_path,
            w1=w1,
            b1=b1,
            w2=w2,
            b2=b2,
            mean=mean,
            std=std,
            model_version=model_version,
            training_version=resolved_training_version,
            dataset_version=dataset_version,
            manifest=manifest,
            metrics=metrics,
            x_val_raw=x_val_raw,
            y_val=y_val,
        )

    if dataset != "aishell3":
        raise ValueError(f"Unsupported dataset: {dataset}")

    if training_features_dir:
        features_root = os.path.abspath(training_features_dir)
    else:
        cached_manifest = _read_cached_aishell_manifest(cache_dir)
        if cached_manifest is None:
            _, cached_manifest = _load_samples_and_manifest(
                cache_dir,
                dataset=dataset,
                dataset_repo=dataset_repo,
                dataset_zip=dataset_zip,
                skip_download=skip_download,
            )
        features_root = training_features_root(cache_dir, cached_manifest)

    manifest: Optional[DatasetManifest] = None
    if manifest_is_valid(features_root) and skip_shard_build:
        manifest = _manifest_for_features_root(cache_dir, features_root)
        if manifest is None:
            raise RuntimeError("Feature Shard present but dataset manifest missing from cache")
    elif not manifest_is_valid(features_root):
        if skip_shard_build:
            raise FileNotFoundError(
                f"Feature Shard manifest missing under {features_root}. "
                "Run build-feature-shards or omit --skip-shard-build."
            )
        build_feature_shards_for_dataset(
            cache_dir,
            dataset=dataset,
            holdout=resolved_holdout,
            val_ratio=val_ratio,
            seed=seed,
            shard_target_rows=shard_target_rows,
            max_syllables=max_syllables,
            max_speakers=max_speakers,
            training_features_dir=training_features_dir,
            skip_download=skip_download,
        )
        manifest = _manifest_for_features_root(cache_dir, features_root)
    else:
        manifest = _manifest_for_features_root(cache_dir, features_root)

    if manifest is None:
        raise RuntimeError("Failed to resolve dataset manifest for canonical shard training")

    split_meta = load_split_meta(features_root)
    reader = ShardReader(features_root)
    train_indices = split_meta.get("trainGlobalIndices", [])
    val_indices = split_meta.get("valGlobalIndices", [])
    print(
        f"syllables: shard_total={reader.sample_count} train={len(train_indices)} "
        f"val={len(val_indices)} holdout={split_meta.get('holdout')}"
    )

    mean, std = fit_norm_stats(reader, train_indices)
    x_val_raw, y_val = reader.get_rows(val_indices)
    x_val_norm = (x_val_raw - mean) / std
    x_train_raw, y_train = reader.get_rows(train_indices)
    x_train_norm = (x_train_raw - mean) / std

    dataset_version = manifest.metadata.dataset_version
    w1, b1, w2, b2, metrics = _train_mlp_from_reader(
        reader,
        train_indices,
        x_val_norm,
        y_val,
        x_train_norm,
        y_train,
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate,
        seed=seed,
        dataset_version=dataset_version,
        mean=mean,
        std=std,
    )
    metrics["dataset"] = dataset_version
    metrics.update(manifest.metadata.to_metrics_dict())
    return _save_artifact_and_validate(
        output_path,
        w1=w1,
        b1=b1,
        w2=w2,
        b2=b2,
        mean=mean,
        std=std,
        model_version=model_version,
        training_version=resolved_training_version,
        dataset_version=dataset_version,
        manifest=manifest,
        metrics=metrics,
        x_val_raw=x_val_raw,
        y_val=y_val,
    )


def _add_shared_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--cache-dir", default=CACHE_DIR)
    parser.add_argument("--dataset", choices=("data_mini", "aishell3"), default="data_mini")
    parser.add_argument("--dataset-repo", default=DATASET_REPO)
    parser.add_argument("--dataset-zip", default=DATASET_ZIP)
    parser.add_argument("--holdout", choices=("utterance", "speaker"), default=None)
    parser.add_argument("--val-ratio", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-syllables", type=int, default=None)
    parser.add_argument("--max-speakers", type=int, default=None)
    parser.add_argument("--training-features-dir", default=None)
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--shard-target-rows", type=int, default=50_000)


def _cmd_build_v2_training_batch(args: argparse.Namespace) -> None:
    batch, manifest = build_v2_training_batch_for_dataset(
        args.cache_dir,
        dataset=args.dataset,
        dataset_repo=args.dataset_repo,
        dataset_zip=args.dataset_zip,
        max_syllables=args.max_syllables,
        max_speakers=args.max_speakers,
        skip_download=args.skip_download,
    )
    summary = {
        "featureVersion": batch.feature_version,
        "featureShape": list(batch.features.shape),
        "labelShape": list(batch.labels.shape),
        "sampleCount": int(batch.features.shape[0]),
        "datasetId": manifest.dataset_id,
        "datasetSlotVersion": manifest.version,
        "path": "SyllableSample → WordInfo Adapter → extract_feature (online, no Shard required)",
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.output:
        os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
        np.savez(
            args.output,
            features=batch.features,
            labels=batch.labels,
            featureVersion=np.array(batch.feature_version),
        )
        print(f"saved {args.output}")


def _cmd_build_feature_shards_v2(args: argparse.Namespace) -> None:
    manifest = build_feature_shards_v2_for_dataset(
        args.cache_dir,
        dataset=args.dataset,
        dataset_repo=args.dataset_repo,
        dataset_zip=args.dataset_zip,
        holdout=args.holdout,
        val_ratio=args.val_ratio,
        seed=args.seed,
        shard_target_rows=args.shard_target_rows,
        max_syllables=args.max_syllables,
        max_speakers=args.max_speakers,
        training_features_dir=args.training_features_dir,
        skip_download=args.skip_download,
        build_command=" ".join(sys.argv),
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def _cmd_build_feature_cache_v2_parallel(args: argparse.Namespace) -> None:
    manifest = build_feature_cache_v2_parallel_for_dataset(
        args.cache_dir,
        dataset=args.dataset,
        dataset_repo=args.dataset_repo,
        dataset_zip=args.dataset_zip,
        holdout=args.holdout,
        val_ratio=args.val_ratio,
        seed=args.seed,
        shard_target_rows=args.shard_target_rows,
        max_syllables=args.max_syllables,
        max_speakers=args.max_speakers,
        training_features_dir=args.training_features_dir,
        skip_download=args.skip_download,
        build_command=" ".join(sys.argv),
        num_workers=args.num_workers,
        resume=args.resume,
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def _cmd_benchmark_feature_cache_v2(args: argparse.Namespace) -> None:
    from tone_module.training_io.feature_cache_v2_parallel import benchmark_parallel_vs_sequential

    samples, _manifest = _load_samples_and_manifest(
        args.cache_dir,
        dataset=args.dataset,
        dataset_repo=args.dataset_repo,
        dataset_zip=args.dataset_zip,
        skip_download=args.skip_download,
    )
    samples = _prepare_samples(
        samples, max_speakers=args.max_speakers, max_syllables=args.max_syllables
    )
    report = benchmark_parallel_vs_sequential(
        samples,
        num_workers=args.num_workers,
        max_syllables=args.max_syllables,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


def _cmd_build_feature_shards(args: argparse.Namespace) -> None:
    manifest = build_feature_shards_for_dataset(
        args.cache_dir,
        dataset=args.dataset,
        dataset_repo=args.dataset_repo,
        dataset_zip=args.dataset_zip,
        holdout=args.holdout,
        val_ratio=args.val_ratio,
        seed=args.seed,
        shard_target_rows=args.shard_target_rows,
        max_syllables=args.max_syllables,
        max_speakers=args.max_speakers,
        training_features_dir=args.training_features_dir,
        skip_download=args.skip_download,
        build_command=" ".join(sys.argv),
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def _cmd_train(args: argparse.Namespace) -> None:
    if args.pilot:
        if args.max_syllables is None:
            args.max_syllables = 10_000
        if args.epochs == 80:
            args.epochs = 5
        if args.model_version == "tone_cnn_p0":
            args.model_version = "tone_cnn_pilot_io"
        if args.output == DEFAULT_OUT:
            args.output = os.path.join(
                os.path.dirname(__file__), "models", "_pilot_phase7b1_io.npz"
            )
    train_and_save(
        args.output,
        args.cache_dir,
        dataset=args.dataset,
        dataset_repo=args.dataset_repo,
        dataset_zip=args.dataset_zip,
        holdout=args.holdout,
        model_version=args.model_version,
        training_version=args.training_version,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        val_ratio=args.val_ratio,
        seed=args.seed,
        max_syllables=args.max_syllables,
        max_speakers=args.max_speakers,
        training_features_dir=args.training_features_dir,
        skip_shard_build=args.skip_shard_build,
        skip_download=args.skip_download,
        shard_target_rows=args.shard_target_rows,
    )


def main(argv: Optional[Sequence[str]] = None) -> None:
    """Train entrypoint. Shared flags: --dataset-repo, --dataset-zip, --dataset (via _add_shared_args)."""
    argv = list(argv if argv is not None else sys.argv[1:])
    if argv and argv[0] not in (
        "train",
        "build-feature-shards",
        "build-feature-shards-v2",
        "build-feature-cache-v2-parallel",
        "benchmark-feature-cache-v2",
        "build-v2-training-batch",
    ):
        # Backward compat: bare flags imply `train` with default_data_mini_pipeline path.
        argv = ["train"] + argv

    parser = argparse.ArgumentParser(description="Train ToneModule P0 CNN weights")
    subparsers = parser.add_subparsers(dest="command", required=True)

    train_parser = subparsers.add_parser("train", help="Train and save artifact")
    train_parser.add_argument("--output", default=DEFAULT_OUT)
    train_parser.add_argument("--model-version", default="tone_cnn_p0")
    train_parser.add_argument("--training-version", default=None)
    train_parser.add_argument("--epochs", type=int, default=80)
    train_parser.add_argument("--batch-size", type=int, default=128)
    train_parser.add_argument("--lr", type=float, default=0.05)
    train_parser.add_argument("--skip-shard-build", action="store_true")
    train_parser.add_argument("--pilot", action="store_true")
    _add_shared_args(train_parser)
    train_parser.set_defaults(func=_cmd_train)

    build_parser = subparsers.add_parser("build-feature-shards", help="Build Feature Shard files")
    _add_shared_args(build_parser)
    build_parser.set_defaults(func=_cmd_build_feature_shards)

    build_v2_parser = subparsers.add_parser(
        "build-feature-shards-v2",
        help="Materialize Feature Shard V2 training cache (optional; same extract_feature tensors)",
    )
    _add_shared_args(build_v2_parser)
    build_v2_parser.set_defaults(func=_cmd_build_feature_shards_v2)

    parallel_parser = subparsers.add_parser(
        "build-feature-cache-v2-parallel",
        help="Parallel Feature Shard V2 cache build (utterance audio reuse; training cache only)",
    )
    _add_shared_args(parallel_parser)
    parallel_parser.add_argument("--num-workers", type=int, default=4)
    parallel_parser.add_argument("--resume", action="store_true")
    parallel_parser.set_defaults(func=_cmd_build_feature_cache_v2_parallel)

    bench_parser = subparsers.add_parser(
        "benchmark-feature-cache-v2",
        help="Benchmark sequential vs parallel V2 feature extraction (no shard write)",
    )
    _add_shared_args(bench_parser)
    bench_parser.add_argument("--num-workers", type=int, default=4)
    bench_parser.set_defaults(func=_cmd_benchmark_feature_cache_v2)

    batch_parser = subparsers.add_parser(
        "build-v2-training-batch",
        help="Build V2 training input batch via online Adapter → extract_feature path",
    )
    batch_parser.add_argument("--output", default=None, help="Optional npz output path")
    _add_shared_args(batch_parser)
    batch_parser.set_defaults(func=_cmd_build_v2_training_batch)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
