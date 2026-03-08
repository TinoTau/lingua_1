#!/usr/bin/env python3
"""
一锤定音：用静音/极短音频跑一次 ONNX，取每帧 argmax，出现最多的 index 即为 blank。
用法：在 asr_sherpa_en 目录下或 PYTHONPATH 含该目录时运行：
  python scripts/confirm_blank_index.py
  或指定静音时长（秒）：python scripts/confirm_blank_index.py 1.5
依赖：与主服务相同（config、features、onnx_runner），需先安装模型到 models/nemo_ctc_en_conformer_small。
"""
import argparse
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_SERVICE_DIR = os.path.dirname(_SCRIPT_DIR)
if _SERVICE_DIR not in sys.path:
    sys.path.insert(0, _SERVICE_DIR)

import numpy as np

from config import MODEL_DIR, NUM_THREADS, PROVIDER, SAMPLE_RATE, get_model_config
from features import waveform_to_fbank
from onnx_runner import get_output_vocab_size, load_session, run as onnx_run


def main():
    parser = argparse.ArgumentParser(description="Confirm CTC blank index by silence argmax histogram")
    parser.add_argument("duration_sec", nargs="?", type=float, default=1.0, help="Silence duration in seconds (default 1.0)")
    args = parser.parse_args()

    cfg = get_model_config()
    if not cfg:
        print("ERROR: No model config (tokens + model not found). Check MODEL_DIR:", MODEL_DIR)
        sys.exit(1)
    tokens_path, model_path = cfg[0], cfg[1]
    if not load_session(model_path, provider=PROVIDER or "cuda", num_threads=NUM_THREADS):
        print("ERROR: Failed to load ONNX session")
        sys.exit(1)
    vocab_size = get_output_vocab_size()
    num_samples = int(args.duration_sec * SAMPLE_RATE)
    silence = np.zeros(num_samples, dtype=np.float32)
    x, num_frames = waveform_to_fbank(silence, SAMPLE_RATE)
    log_probs, log_probs_length = onnx_run(x, num_frames)
    if log_probs is None:
        print("ERROR: ONNX run returned None")
        sys.exit(1)
    if log_probs.ndim == 3:
        log_probs = log_probs[0]
    T, V = log_probs.shape
    argmax_per_frame = np.argmax(log_probs, axis=1)
    counts: dict = {}
    for idx in argmax_per_frame.flatten().tolist():
        counts[idx] = counts.get(idx, 0) + 1
    total = sum(counts.values())
    sorted_counts = sorted(counts.items(), key=lambda x: -x[1])
    print("Silence argmax histogram (top 10). Most frequent index = likely BLANK:")
    print("  frames total:", T, " vocab_size:", V)
    for idx, c in sorted_counts[:10]:
        pct = 100.0 * c / total
        print("  index %4d  count %5d  %.1f%%" % (idx, c, pct))
    if sorted_counts:
        likely_blank = sorted_counts[0][0]
        print("\n>>> Likely blank index = %d (set ASR_SHERPA_EN_BLANK_INDEX=%d to verify)" % (likely_blank, likely_blank))
    # tokens 前几项便于对照
    if os.path.isfile(tokens_path):
        with open(tokens_path, "r", encoding="utf-8", errors="replace") as f:
            lines = [ln.strip() for ln in f if ln.strip()][:15]
        print("\nFirst 15 lines of tokens.txt (for format check):")
        for i, ln in enumerate(lines):
            print("  ", i, ln[:80])


if __name__ == "__main__":
    main()
