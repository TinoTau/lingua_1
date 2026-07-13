"""Training metrics helpers (JSON-serializable)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional


@dataclass
class EpochMetrics:
    epoch: int
    train_loss: float
    train_acc: float
    val_loss: float
    val_acc: float
    duration_sec: float
    max_vram_bytes: Optional[int] = None


@dataclass
class TrainingRunMetrics:
    training_backend: str = "torch_cuda_v1"
    device: str = "cuda"
    epochs: int = 0
    batch_size: int = 0
    learning_rate: float = 0.0
    train_samples: int = 0
    val_samples: int = 0
    best_epoch: int = 0
    best_val_acc: float = 0.0
    best_train_acc: float = 0.0
    total_duration_sec: float = 0.0
    max_vram_bytes: int = 0
    epoch_history: List[Dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
