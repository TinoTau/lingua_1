"""Feature Tensor dataloader for GPU CNN training (no feature extraction)."""
from __future__ import annotations

from typing import Iterator, Tuple

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset, TensorDataset


class FeatureTensorDataset(Dataset):
    """Read-only (N, 64, 83) + labels — transport only."""

    def __init__(self, features: np.ndarray, labels: np.ndarray) -> None:
        if features.ndim != 3:
            raise ValueError(f"features must be (N, T, C), got {features.shape}")
        if labels.ndim != 1:
            raise ValueError(f"labels must be (N,), got {labels.shape}")
        if features.shape[0] != labels.shape[0]:
            raise ValueError("features/labels size mismatch")
        if isinstance(features, np.memmap):
            # Large cache-backed arrays: avoid copying full train split into RAM.
            feature_arr = features
        else:
            feature_arr = np.ascontiguousarray(features, dtype=np.float32)
        self.features = torch.from_numpy(feature_arr)
        self.labels = torch.from_numpy(np.ascontiguousarray(labels, dtype=np.int64))

    def __len__(self) -> int:
        return int(self.features.shape[0])

    def __getitem__(self, index: int) -> Tuple[torch.Tensor, torch.Tensor]:
        return self.features[index], self.labels[index]


def make_feature_dataloader(
    features: np.ndarray,
    labels: np.ndarray,
    *,
    batch_size: int,
    shuffle: bool,
    drop_last: bool = False,
) -> DataLoader:
    dataset = FeatureTensorDataset(features, labels)
    pin = torch.cuda.is_available() and not isinstance(features, np.memmap)
    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        drop_last=drop_last,
        pin_memory=pin,
    )


def iter_batches(
    loader: DataLoader,
    *,
    device: torch.device,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
) -> Iterator[Tuple[torch.Tensor, torch.Tensor]]:
    mean = torch.from_numpy(feature_mean.reshape(1, 1, -1)).to(device)
    std = torch.from_numpy(feature_std.reshape(1, 1, -1)).to(device)
    for xb, yb in loader:
        xb = xb.to(device, non_blocking=True)
        yb = yb.to(device, non_blocking=True)
        xb = (xb - mean) / std
        yield xb, yb
