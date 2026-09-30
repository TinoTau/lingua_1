"""Stage A probe training configuration."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class StageATrainConfig:
    seed: int = 20260812
    device: str = "cpu"  # training may use cuda; runtime target remains CPU
    runtime_device_target: str = "cpu"

    batch_size: int = 16
    epochs: int = 40
    lr: float = 1e-3
    weight_decay: float = 1e-4
    max_pool: int = 16

    lambda_neg: float = 0.5
    lambda_hn: float = 0.5
    hn_margin: float = 0.2

    tiny_n: int = 48
    tiny_epochs: int = 80
    tiny_lr: float = 2e-3

    embed_dim: int = 64
    char_dim: int = 24
    syl_dim: int = 24
    hidden: int = 96

    char_hash_version: str = "char-hash-v1"
    candidate_index_version: str = "cand-index-v1"
    feature_schema_version: str = "user-feature-schema-v1"
    trainrow_schema_version: int = 1

    markers: tuple[str, ...] = ("PROBE_ONLY", "NOT_FOR_RUNTIME", "NOT_FROZEN")
    note: str = "Stage A learnability probe — not formal generalization acceptance."

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["markers"] = list(self.markers)
        return d
