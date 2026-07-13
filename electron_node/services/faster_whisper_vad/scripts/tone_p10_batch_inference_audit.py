#!/usr/bin/env python3
"""P10 batch inference audit — verify feature stack + single predict_batch call."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from unittest.mock import patch

import numpy as np

_FW = Path(__file__).resolve().parents[1]
if str(_FW) not in sys.path:
    sys.path.insert(0, str(_FW))

from shared_types import WordInfo
from tone_module.inference import run_tone_inference
from tone_module.classifier import get_tone_classifier, reset_tone_classifier_singleton


def main() -> None:
    sr = 16000
    duration = 2.5
    t = np.linspace(0, duration, int(sr * duration), dtype=np.float32)
    audio = (0.1 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)

    words = [
        WordInfo(word="你", start=0.0, end=0.2, probability=0.9),
        WordInfo(word="好", start=0.2, end=0.4, probability=0.9),
        WordInfo(word="中", start=0.5, end=0.7, probability=0.9),
        WordInfo(word="杯", start=0.7, end=0.9, probability=0.9),
        WordInfo(word="少", start=1.0, end=1.2, probability=0.9),
        WordInfo(word="糖", start=1.2, end=1.4, probability=0.9),
    ]

    stack_shapes: list[list[int]] = []
    batch_sizes: list[int] = []
    predict_calls = 0
    original_predict = get_tone_classifier().__class__.predict_batch

    def spy_predict(self, feature_batch):  # type: ignore[no-untyped-def]
        nonlocal predict_calls
        predict_calls += 1
        batch_sizes.append(int(feature_batch.shape[0]))
        return original_predict(self, feature_batch)

    extract_shapes: list[list[int]] = []

    from tone_module import feature_v2

    original_extract = feature_v2.extract_feature

    def spy_extract(audio_arr, sample_rate, word):  # type: ignore[no-untyped-def]
        feat = original_extract(audio_arr, sample_rate, word)
        extract_shapes.append(list(feat.shape))
        return feat

    reset_tone_classifier_singleton()
    clf = get_tone_classifier()

    class _Seg:
        def __init__(self, w):
            self.words = w

    with patch.object(feature_v2, "extract_feature", side_effect=spy_extract), patch.object(
        clf.__class__, "predict_batch", spy_predict
    ):
        payload, ms = run_tone_inference(
            audio,
            sr,
            [_Seg(words)],
            language="zh",
            src_lang="zh",
            trace_id="p10-batch-audit",
        )

    loader = get_tone_classifier().metadata
    out = {
        "featureExtractCalls": len(extract_shapes),
        "featureShapes": extract_shapes,
        "predictBatchCalls": predict_calls,
        "predictBatchSizes": batch_sizes,
        "isTrueBatch": predict_calls == 1 and len(batch_sizes) == 1 and batch_sizes[0] == len(words),
        "outputSliceCount": payload.slice_count,
        "toneInferenceMs": ms,
        "backend": loader.backend if loader else None,
        "featureVersion": loader.feature_version if loader else None,
        "trainingVersion": loader.training_version if loader else None,
        "artifactPath": loader.artifact_path if loader else None,
        "modelVersion": loader.model_version if loader else None,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
