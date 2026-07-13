"""Shard Reader · Sequential Feature Reader · Mini-batch Reader (Training Engineering)."""
from __future__ import annotations

from typing import Iterator, List, Optional, Sequence, Tuple

import numpy as np

from tone_module.training_io.feature_shard import load_shard_manifest


class ShardReader:
    """Read-only accessor for Feature Shard rows by global index."""

    def __init__(self, training_features_root: str) -> None:
        self.root = training_features_root
        self.manifest = load_shard_manifest(training_features_root)
        self._open_shards: dict = {}

    def close(self) -> None:
        for data in self._open_shards.values():
            if hasattr(data, "close"):
                data.close()
        self._open_shards.clear()

    def __enter__(self) -> "ShardReader":
        return self

    def __exit__(self, *_args) -> None:
        self.close()

    @property
    def sample_count(self) -> int:
        return int(self.manifest["sampleCount"])

    def __len__(self) -> int:
        return self.sample_count

    def _shard_arrays(self, rel_path: str):
        if rel_path not in self._open_shards:
            import os

            path = os.path.join(self.root, rel_path)
            data = np.load(path, mmap_mode="r")
            self._open_shards[rel_path] = data
        return self._open_shards[rel_path]

    def _locate(self, global_index: int) -> Tuple[str, int]:
        for entry in self.manifest["shards"]:
            offset = int(entry["offset"])
            count = int(entry["count"])
            if offset <= global_index < offset + count:
                return entry["path"], global_index - offset
        raise IndexError(f"global_index out of range: {global_index}")

    def get_row(self, global_index: int) -> Tuple[np.ndarray, int]:
        rel_path, local_index = self._locate(global_index)
        data = self._shard_arrays(rel_path)
        mel = np.array(data["mel"][local_index], dtype=np.float32)
        label = int(data["labels"][local_index])
        return mel, label

    def get_rows(self, indices: Sequence[int]) -> Tuple[np.ndarray, np.ndarray]:
        if not indices:
            n_mels = int(self.manifest["nMels"])
            return np.zeros((0, n_mels), dtype=np.float32), np.zeros(0, dtype=np.int64)

        index_arr = np.asarray(indices, dtype=np.int64)
        n_mels = int(self.manifest["nMels"])
        xs = np.empty((len(index_arr), n_mels), dtype=np.float32)
        ys = np.empty(len(index_arr), dtype=np.int64)

        by_shard: dict[str, List[Tuple[int, int]]] = {}
        for position, global_index in enumerate(index_arr):
            rel_path, local_index = self._locate(int(global_index))
            by_shard.setdefault(rel_path, []).append((position, local_index))

        for rel_path, items in by_shard.items():
            data = self._shard_arrays(rel_path)
            positions = [position for position, _ in items]
            locals_ = [local_index for _, local_index in items]
            mel_block = np.asarray(data["mel"][locals_], dtype=np.float32)
            label_block = np.asarray(data["labels"][locals_], dtype=np.int64)
            xs[positions] = mel_block
            ys[positions] = label_block

        return xs, ys


class SequentialFeatureReader:
    """Sequential traversal over a subset of global Feature Shard indices."""

    def __init__(self, reader: ShardReader, indices: Sequence[int]) -> None:
        self.reader = reader
        self.indices = np.asarray(indices, dtype=np.int64)

    def __len__(self) -> int:
        return int(self.indices.shape[0])

    def __iter__(self) -> Iterator[Tuple[np.ndarray, int]]:
        for index in self.indices:
            yield self.reader.get_row(int(index))


def fit_norm_stats(reader: ShardReader, indices: Sequence[int]) -> Tuple[np.ndarray, np.ndarray]:
    """Compute mel mean/std over train indices via batched Shard Reader reads."""
    if not indices:
        raise ValueError("Cannot fit norm stats on empty index set")
    index_list = [int(i) for i in indices]
    n_mels = int(reader.manifest["nMels"])
    sum_x = np.zeros(n_mels, dtype=np.float64)
    sum_x2 = np.zeros(n_mels, dtype=np.float64)
    count = 0
    chunk_size = 10_000
    for start in range(0, len(index_list), chunk_size):
        chunk = index_list[start : start + chunk_size]
        xb, _ = reader.get_rows(chunk)
        sum_x += xb.sum(axis=0, dtype=np.float64)
        sum_x2 += np.square(xb, dtype=np.float64).sum(axis=0)
        count += xb.shape[0]
    mean = (sum_x / count).astype(np.float32)
    var = np.maximum(sum_x2 / count - mean.astype(np.float64) ** 2, 0.0)
    std = np.sqrt(var).astype(np.float32)
    std[std < 1e-6] = 1.0
    return mean, std


class MiniBatchReader:
    """Yield mini-batches from Feature Shard indices for one training epoch."""

    def __init__(
        self,
        reader: ShardReader,
        indices: Sequence[int],
        *,
        batch_size: int,
        mean: np.ndarray,
        std: np.ndarray,
    ) -> None:
        self.reader = reader
        self.indices = np.asarray(indices, dtype=np.int64)
        self.batch_size = batch_size
        self.mean = mean
        self.std = std

    def iter_epoch_batches(self, rng: np.random.Generator) -> Iterator[Tuple[np.ndarray, np.ndarray]]:
        order = rng.permutation(len(self.indices))
        for start in range(0, len(order), self.batch_size):
            batch_positions = order[start : start + self.batch_size]
            batch_indices = self.indices[batch_positions]
            xb, yb = self.reader.get_rows(batch_indices.tolist())
            xb = (xb - self.mean) / self.std
            yield xb, yb
