"""
Train ToneModule P0 CNN weights (80-dim mel -> 32 ReLU -> 5-class softmax).

Data source (auto-download):
  HuggingFace CS5647Team3/data_mini  (AISHELL-3 wav + TextGrid pinyin+tone)

Output:
  tone_module/models/tone_cnn_p0.npz

Usage (from faster_whisper_vad/):
  python -m tone_module.train_tone_cnn
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import zipfile
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple

import numpy as np
import soundfile as sf

# Ensure service root is importable when run as module/script.
_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _SERVICE_ROOT)

from tone_module.mel import extract_mel_features, SAMPLE_RATE  # noqa: E402

HIDDEN = 32
N_CLASSES = 5
N_MELS = 80
DATASET_REPO = "CS5647Team3/data_mini"
DATASET_ZIP = "data_mini.zip"
DEFAULT_OUT = os.path.join(os.path.dirname(__file__), "models", "tone_cnn_p0.npz")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "_data_cache")

PINYIN_TONE_RE = re.compile(r"^([a-z]+)([1-5])$", re.IGNORECASE)


@dataclass
class SyllableSample:
    wav_path: str
    start: float
    end: float
    label: int  # 0..4 => t1..t5


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - np.max(logits, axis=-1, keepdims=True)
    exp = np.exp(shifted)
    return exp / np.maximum(exp.sum(axis=-1, keepdims=True), 1e-12)


def _parse_textgrid_intervals(text: str) -> Iterable[Tuple[float, float, str]]:
    block_re = re.compile(
        r"intervals\s*\[\d+\]:\s*\n\s*xmin\s*=\s*([0-9.]+)\s*\n\s*xmax\s*=\s*([0-9.]+)\s*\n\s*text\s*=\s*\"([^\"]*)\"",
        re.MULTILINE,
    )
    for match in block_re.finditer(text):
        start = float(match.group(1))
        end = float(match.group(2))
        label = match.group(3).strip()
        if label:
            yield start, end, label


def _tone_label_from_pinyin(token: str) -> Optional[int]:
    m = PINYIN_TONE_RE.match(token.strip().lower())
    if not m:
        return None
    tone_num = int(m.group(2))
    if tone_num < 1 or tone_num > 5:
        return None
    return tone_num - 1


def _ensure_dataset(cache_dir: str) -> str:
    extract_root = os.path.join(cache_dir, "extracted", "dataset")
    marker = os.path.join(extract_root, "AISHELL-3")
    if os.path.isdir(marker):
        return extract_root

    os.makedirs(cache_dir, exist_ok=True)
    zip_path = os.path.join(cache_dir, DATASET_ZIP)
    if not os.path.isfile(zip_path):
        from huggingface_hub import hf_hub_download

        print(f"Downloading {DATASET_REPO}/{DATASET_ZIP} ...")
        hf_hub_download(
            DATASET_REPO,
            DATASET_ZIP,
            repo_type="dataset",
            local_dir=cache_dir,
        )

    print(f"Extracting {zip_path} ...")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(os.path.join(cache_dir, "extracted"))
    return extract_root


def _index_wavs(dataset_root: str) -> dict[str, str]:
    wav_map: dict[str, str] = {}
    for dirpath, _, filenames in os.walk(dataset_root):
        for name in filenames:
            if not name.lower().endswith(".wav"):
                continue
            base = os.path.splitext(name)[0]
            wav_map[base] = os.path.join(dirpath, name)
    return wav_map


def _collect_samples(dataset_root: str) -> List[SyllableSample]:
    wav_map = _index_wavs(dataset_root)
    samples: List[SyllableSample] = []

    for dirpath, _, filenames in os.walk(dataset_root):
        for name in filenames:
            if not name.endswith(".TextGrid"):
                continue
            base = os.path.splitext(name)[0]
            wav_path = wav_map.get(base)
            if not wav_path:
                continue
            tg_path = os.path.join(dirpath, name)
            with open(tg_path, encoding="utf-8", errors="ignore") as f:
                text = f.read()
            for start, end, token in _parse_textgrid_intervals(text):
                if end - start < 0.02:
                    continue
                label = _tone_label_from_pinyin(token)
                if label is None:
                    continue
                samples.append(SyllableSample(wav_path, start, end, label))
    return samples


def _slice_audio(audio: np.ndarray, sample_rate: int, start: float, end: float) -> np.ndarray:
    s = max(0, int(start * sample_rate))
    e = max(s + 1, int(end * sample_rate))
    e = min(e, len(audio))
    return audio[s:e]


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
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    w1 = rng.normal(0, 0.05, size=(N_MELS, HIDDEN)).astype(np.float32)
    b1 = np.zeros(HIDDEN, dtype=np.float32)
    w2 = rng.normal(0, 0.05, size=(HIDDEN, N_CLASSES)).astype(np.float32)
    b2 = np.zeros(N_CLASSES, dtype=np.float32)

    n = x_train.shape[0]
    best_val_acc = -1.0
    best = (w1.copy(), b1.copy(), w2.copy(), b2.copy())

    for epoch in range(1, epochs + 1):
        order = rng.permutation(n)
        for start in range(0, n, batch_size):
            idx = order[start : start + batch_size]
            xb = x_train[idx]
            yb = y_train[idx]

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
        "dataset": DATASET_REPO,
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


def train_and_save(
    output_path: str = DEFAULT_OUT,
    cache_dir: str = CACHE_DIR,
    *,
    epochs: int = 80,
    batch_size: int = 128,
    learning_rate: float = 0.05,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> dict:
    dataset_root = _ensure_dataset(cache_dir)
    samples = _collect_samples(dataset_root)
    if len(samples) < 100:
        raise RuntimeError(f"Too few syllable samples: {len(samples)}")

    rng = np.random.default_rng(seed)
    utterances = sorted({os.path.basename(s.wav_path) for s in samples})
    rng.shuffle(utterances)
    val_count = max(1, int(len(utterances) * val_ratio))
    val_set = set(utterances[:val_count])

    train_samples = [s for s in samples if os.path.basename(s.wav_path) not in val_set]
    val_samples = [s for s in samples if os.path.basename(s.wav_path) in val_set]
    print(f"syllables: total={len(samples)} train={len(train_samples)} val={len(val_samples)}")

    x_train, y_train = _build_feature_matrix(train_samples)
    x_val, y_val = _build_feature_matrix(val_samples)

    mean = x_train.mean(axis=0)
    std = x_train.std(axis=0)
    std[std < 1e-6] = 1.0
    x_train = (x_train - mean) / std
    x_val = (x_val - mean) / std

    w1, b1, w2, b2, metrics = _train_mlp(
        x_train,
        y_train,
        x_val,
        y_val,
        epochs=epochs,
        batch_size=batch_size,
        learning_rate=learning_rate,
        seed=seed,
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    np.savez(
        output_path,
        w1=w1,
        b1=b1,
        w2=w2,
        b2=b2,
        mel_mean=mean.astype(np.float32),
        mel_std=std.astype(np.float32),
        metrics=metrics,
    )
    print(f"saved {output_path}")
    print(f"val_acc={metrics['val_acc']:.3f} train_acc={metrics['train_acc']:.3f}")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ToneModule P0 CNN weights")
    parser.add_argument("--output", default=DEFAULT_OUT)
    parser.add_argument("--cache-dir", default=CACHE_DIR)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=0.05)
    parser.add_argument("--val-ratio", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    train_and_save(
        args.output,
        args.cache_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        val_ratio=args.val_ratio,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
