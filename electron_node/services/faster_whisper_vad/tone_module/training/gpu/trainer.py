"""GPU CNN trainer for Tone V2 (training domain only)."""
from __future__ import annotations

import copy
import time
from typing import Optional, Tuple

import numpy as np
import torch
import torch.nn as nn

from tone_module import contract
from tone_module.models.cnn_p1 import fit_feature_norm
from tone_module.models.cnn_p1_torch import CnnP1Torch, init_cnn_p1_torch
from tone_module.training.gpu.dataloader import iter_batches, make_feature_dataloader
from tone_module.training.gpu.env_probe import require_cuda_for_training
from tone_module.training.gpu.export import torch_model_to_weights_v1
from tone_module.training.gpu.metrics import EpochMetrics, TrainingRunMetrics


def _epoch_metrics(
    model: CnnP1Torch,
    loader,
    *,
    device: torch.device,
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    criterion: nn.Module,
) -> Tuple[float, float]:
    model.eval()
    total_loss = 0.0
    correct = 0
    total = 0
    with torch.no_grad():
        for xb, yb in iter_batches(
            loader, device=device, feature_mean=feature_mean, feature_std=feature_std
        ):
            logits = model(xb)
            loss = criterion(logits, yb)
            total_loss += float(loss.item()) * xb.shape[0]
            preds = torch.argmax(logits, dim=1)
            correct += int((preds == yb).sum().item())
            total += int(xb.shape[0])
    avg_loss = total_loss / max(total, 1)
    acc = correct / max(total, 1)
    return avg_loss, acc


def _max_vram_bytes() -> int:
    if not torch.cuda.is_available():
        return 0
    return int(torch.cuda.max_memory_allocated())


def train_cnn_p1_torch(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    *,
    epochs: int = 20,
    batch_size: int = 128,
    learning_rate: float = 0.01,
    seed: int = 42,
    feature_mean: Optional[np.ndarray] = None,
    feature_std: Optional[np.ndarray] = None,
    device: Optional[str] = None,
) -> Tuple[contract.ToneModelWeightsV1, TrainingRunMetrics]:
    require_cuda_for_training()
    resolved_device = torch.device(device or "cuda")
    torch.manual_seed(seed)
    np.random.seed(seed)

    if feature_mean is None or feature_std is None:
        feature_mean, feature_std = fit_feature_norm(x_train)

    rng = np.random.default_rng(seed)
    model = init_cnn_p1_torch(rng, device=resolved_device)
    optimizer = torch.optim.SGD(model.parameters(), lr=learning_rate)
    criterion = nn.CrossEntropyLoss()

    train_loader = make_feature_dataloader(
        x_train, y_train, batch_size=batch_size, shuffle=True
    )
    val_loader = make_feature_dataloader(
        x_val, y_val, batch_size=batch_size, shuffle=False
    )

    best_val_acc = -1.0
    best_state = copy.deepcopy(model.state_dict())
    best_epoch = 0
    run_metrics = TrainingRunMetrics(
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate,
        train_samples=int(x_train.shape[0]),
        val_samples=int(x_val.shape[0]),
        device=str(resolved_device),
    )
    run_started = time.perf_counter()

    for epoch in range(1, epochs + 1):
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        epoch_started = time.perf_counter()
        model.train()
        train_loss_sum = 0.0
        train_correct = 0
        train_total = 0

        for xb, yb in iter_batches(
            train_loader,
            device=resolved_device,
            feature_mean=feature_mean,
            feature_std=feature_std,
        ):
            optimizer.zero_grad(set_to_none=True)
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            train_loss_sum += float(loss.item()) * xb.shape[0]
            preds = torch.argmax(logits, dim=1)
            train_correct += int((preds == yb).sum().item())
            train_total += int(xb.shape[0])

        train_loss = train_loss_sum / max(train_total, 1)
        train_acc = train_correct / max(train_total, 1)
        val_loss, val_acc = _epoch_metrics(
            model,
            val_loader,
            device=resolved_device,
            feature_mean=feature_mean,
            feature_std=feature_std,
            criterion=criterion,
        )
        epoch_vram = _max_vram_bytes()
        epoch_duration = time.perf_counter() - epoch_started

        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            best_epoch = epoch
            best_state = copy.deepcopy(model.state_dict())
            run_metrics.best_train_acc = float(train_acc)

        epoch_record = EpochMetrics(
            epoch=epoch,
            train_loss=float(train_loss),
            train_acc=float(train_acc),
            val_loss=float(val_loss),
            val_acc=float(val_acc),
            duration_sec=round(epoch_duration, 3),
            max_vram_bytes=epoch_vram,
        )
        run_metrics.epoch_history.append(epoch_record.__dict__)
        run_metrics.max_vram_bytes = max(run_metrics.max_vram_bytes, epoch_vram or 0)

        print(
            f"epoch {epoch:3d}: train_loss={train_loss:.4f} train_acc={train_acc:.3f} "
            f"val_loss={val_loss:.4f} val_acc={val_acc:.3f} "
            f"dur={epoch_duration:.1f}s vram_mb={((epoch_vram or 0) / 1e6):.0f}"
        )

    model.load_state_dict(best_state)
    run_metrics.best_epoch = best_epoch
    run_metrics.best_val_acc = float(best_val_acc)
    run_metrics.total_duration_sec = round(time.perf_counter() - run_started, 3)

    weights = torch_model_to_weights_v1(
        model, feature_mean=feature_mean, feature_std=feature_std
    )
    return weights, run_metrics
