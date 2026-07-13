"""Feature Shard build and manifest (Training Engineering only)."""
from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import soundfile as sf

from tone_module import contract
from tone_module.dataset.dataset_contract import DatasetManifest, SyllableSample
from tone_module.mel import extract_mel_features

SCHEMA_VERSION = "training_feature_shard_v1"
DEFAULT_SHARD_TARGET_ROWS = 50_000
MANIFEST_NAME = "shard_manifest.json"
SPLIT_META_NAME = "holdout/split_meta.json"


def training_features_root(
    cache_dir: str,
    manifest: DatasetManifest,
    *,
    override: Optional[str] = None,
) -> str:
    if override:
        return os.path.abspath(override)
    return os.path.join(
        cache_dir,
        "datasets",
        manifest.dataset_id,
        manifest.version,
        "training_features",
    )


def shard_manifest_path(training_features_root: str) -> str:
    return os.path.join(training_features_root, MANIFEST_NAME)


def split_meta_path(training_features_root: str) -> str:
    return os.path.join(training_features_root, SPLIT_META_NAME)


def _slice_audio(audio: np.ndarray, sample_rate: int, start: float, end: float) -> np.ndarray:
    s = max(0, int(start * sample_rate))
    e = max(s + 1, int(end * sample_rate))
    e = min(e, len(audio))
    return audio[s:e]


def _group_samples_by_wav(samples: Sequence[SyllableSample]) -> List[Tuple[str, List[SyllableSample]]]:
    groups: Dict[str, List[SyllableSample]] = defaultdict(list)
    order: List[str] = []
    for sample in samples:
        if sample.wav_path not in groups:
            order.append(sample.wav_path)
        groups[sample.wav_path].append(sample)
    return [(path, groups[path]) for path in order]


def _flush_shard(
    shards_dir: str,
    shard_index: int,
    mel_buf: List[np.ndarray],
    label_buf: List[int],
    index_buf: List[int],
) -> dict:
    path = os.path.join(shards_dir, f"shard_{shard_index:03d}.npz")
    mel = np.stack(mel_buf, axis=0).astype(np.float32)
    labels = np.array(label_buf, dtype=np.int64)
    global_index = np.array(index_buf, dtype=np.int64)
    np.savez(path, mel=mel, labels=labels, global_index=global_index)
    return {
        "path": os.path.join("shards", os.path.basename(path)),
        "offset": int(global_index[0]),
        "count": int(len(global_index)),
    }


def _build_shards_from_samples(
    samples: Sequence[SyllableSample],
    *,
    shards_dir: str,
    shard_target_rows: int,
    global_index_start: int,
    start_shard_index: int = 0,
) -> Tuple[List[dict], int, int]:
    os.makedirs(shards_dir, exist_ok=True)
    shard_entries: List[dict] = []
    mel_buf: List[np.ndarray] = []
    label_buf: List[int] = []
    index_buf: List[int] = []
    shard_index = start_shard_index
    next_global = global_index_start

    for wav_path, utterance_samples in _group_samples_by_wav(samples):
        audio, sr = sf.read(wav_path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        for sample in utterance_samples:
            clip = _slice_audio(audio, sr, sample.start, sample.end)
            mel_buf.append(extract_mel_features(clip, sr))
            label_buf.append(sample.label)
            index_buf.append(next_global)
            next_global += 1
            if len(mel_buf) >= shard_target_rows:
                shard_entries.append(_flush_shard(shards_dir, shard_index, mel_buf, label_buf, index_buf))
                shard_index += 1
                mel_buf, label_buf, index_buf = [], [], []

    if mel_buf:
        shard_entries.append(_flush_shard(shards_dir, shard_index, mel_buf, label_buf, index_buf))
        shard_index += 1

    return shard_entries, next_global, shard_index


def build_feature_shards(
    train_samples: Sequence[SyllableSample],
    val_samples: Sequence[SyllableSample],
    *,
    dataset_manifest: DatasetManifest,
    training_features_root: str,
    split_meta: dict,
    shard_target_rows: int = DEFAULT_SHARD_TARGET_ROWS,
    build_command: Optional[str] = None,
    source_manifest_path: Optional[str] = None,
) -> dict:
    """Build Feature Shard files using per-utterance reads (no audio_cache)."""
    root = os.path.abspath(training_features_root)
    shards_dir = os.path.join(root, "shards")
    holdout_dir = os.path.join(root, "holdout")
    os.makedirs(holdout_dir, exist_ok=True)

    train_count = len(train_samples)
    train_entries, next_global, next_shard_index = _build_shards_from_samples(
        train_samples,
        shards_dir=shards_dir,
        shard_target_rows=shard_target_rows,
        global_index_start=0,
        start_shard_index=0,
    )
    val_entries, _, _ = _build_shards_from_samples(
        val_samples,
        shards_dir=shards_dir,
        shard_target_rows=shard_target_rows,
        global_index_start=next_global,
        start_shard_index=next_shard_index,
    )

    shard_entries = train_entries + val_entries
    sample_count = train_count + len(val_samples)
    split_meta = dict(split_meta)
    split_meta["trainGlobalIndices"] = list(range(train_count))
    split_meta["valGlobalIndices"] = list(range(train_count, sample_count))

    manifest_payload = {
        "schemaVersion": SCHEMA_VERSION,
        "datasetId": dataset_manifest.dataset_id,
        "datasetSlotVersion": dataset_manifest.version,
        "featureVersion": contract.P0_FEATURE_VERSION,
        "nMels": contract.P0_N_MELS,
        "sampleCount": sample_count,
        "shardCount": len(shard_entries),
        "shards": shard_entries,
        "sourceManifestPath": source_manifest_path,
        "buildTime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "buildCommand": build_command,
    }

    with open(shard_manifest_path(root), "w", encoding="utf-8") as handle:
        json.dump(manifest_payload, handle, indent=2)
        handle.write("\n")

    with open(split_meta_path(root), "w", encoding="utf-8") as handle:
        json.dump(split_meta, handle, indent=2)
        handle.write("\n")

    return manifest_payload


def load_shard_manifest(training_features_root: str) -> dict:
    path = shard_manifest_path(training_features_root)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Feature Shard manifest not found: {path}")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_split_meta(training_features_root: str) -> dict:
    path = split_meta_path(training_features_root)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Holdout split meta not found: {path}")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def manifest_is_valid(training_features_root: str) -> bool:
    try:
        payload = load_shard_manifest(training_features_root)
    except FileNotFoundError:
        return False
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        return False
    if payload.get("featureVersion") != contract.P0_FEATURE_VERSION:
        return False
    for entry in payload.get("shards", []):
        rel = entry.get("path", "")
        if not os.path.isfile(os.path.join(training_features_root, rel)):
            return False
    return True
