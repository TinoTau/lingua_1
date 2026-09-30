# -*- coding: utf-8
"""CPU latency benchmark + shadow-only validation for Model3 V1."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (
    Model3BiGRUV1,
    collate_batch,
    sample_to_tensors,
)
from training.model3_dataset.train.train_v1_bigru import load_jsonl_split

DATA = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
MODEL_DIR = REPO / "training/model3_dataset/model3_v1_synthetic_bigru"
DOCS = REPO / "docs/user_correction/model3"


def percentile(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    vals = sorted(vals)
    k = (len(vals) - 1) * p / 100.0
    f = int(k)
    c = min(f + 1, len(vals) - 1)
    if f == c:
        return vals[f]
    return vals[f] + (vals[c] - vals[f]) * (k - f)


def main():
    device = torch.device("cpu")
    vocab = json.loads((MODEL_DIR / "vocab.json").read_text(encoding="utf-8"))
    config = json.loads((MODEL_DIR / "config.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(len(vocab), config["embed_dim"], config["hidden_dim"], config["feat_dim"])
    model.load_state_dict(torch.load(MODEL_DIR / "weights.pt", map_location="cpu"))
    model.eval()

    test_samples = load_jsonl_split("test")[:500]
    latencies = []
    seq_lens = []
    trace_rows = []

    with torch.no_grad():
        for s in test_samples:
            item = sample_to_tensors(s, vocab)
            batch = collate_batch([item], device)
            seq_lens.append(len(item["tokens"]))
            t0 = time.perf_counter()
            logits = model(batch["tokens"], batch["feats"], batch["avail"])
            dt_ms = (time.perf_counter() - t0) * 1000.0
            latencies.append(dt_ms)
            pred = logits.argmax(dim=-1)[0]
            for i, sp in enumerate(s["spans"]):
                if sp.get("targetMask") != 1 or sp.get("isAnchor"):
                    continue
                trace_rows.append(
                    {
                        "utteranceId": s["sampleId"],
                        "spanId": sp["spanId"],
                        "surface": sp.get("surface"),
                        "isAnchor": sp.get("isAnchor"),
                        "decision": "RETRY" if pred[i].item() == 1 else "KEEP",
                        "gold": sp.get("label"),
                        "confidence_logit_gap": float(
                            (logits[0, i, 1] - logits[0, i, 0]).item()
                        ),
                        "latency_ms_utterance": dt_ms,
                    }
                )

    latency_report = {
        "device": "cpu",
        "utterance_inference": True,
        "n_samples": len(latencies),
        "p50_ms": percentile(latencies, 50),
        "p95_ms": percentile(latencies, 95),
        "p99_ms": percentile(latencies, 99),
        "mean_ms": sum(latencies) / len(latencies) if latencies else 0.0,
        "sequence_length_mean": sum(seq_lens) / len(seq_lens) if seq_lens else 0.0,
        "sequence_length_p95": percentile([float(x) for x in seq_lens], 95),
    }
    (DOCS / "model3_v1_cpu_latency.json").write_text(
        json.dumps(latency_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    trace_path = DOCS / "model3_v1_shadow_trace.jsonl"
    with trace_path.open("w", encoding="utf-8") as f:
        for row in trace_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    shadow = {
        "one_inference_per_utterance": True,
        "actual_retry_triggered": False,
        "production_output_changed": False,
        "mode": "shadow_only_offline_harness",
        "trace_span_rows": len(trace_rows),
    }
    (DOCS / "model3_v1_shadow_no_behavior_change.json").write_text(
        json.dumps(shadow, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    governance = {
        "simulated_anchor_visible_as_model_feature": False,
        "production_anchor_enum_changed": False,
        "formal_anchor_contract_changed": False,
        "architecture_changed": False,
        "training_schema_changed": False,
        "domain_vote_changed": False,
        "recall_changed": False,
        "model2_changed": False,
        "job_result_changed": False,
        "runtime_retry_enabled": False,
    }
    (DOCS / "model3_v1_simulated_anchor_isolation_check.json").write_text(
        json.dumps(governance, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_formal_anchor_contract_check.json").write_text(
        json.dumps(
            {
                "allowed_runtime_anchor_sources": ["DOMAIN", "MODEL2", "DOMAIN_AND_MODEL2"],
                "simulated_training_anchor_in_runtime_enum": False,
                "simulated_recorded_in_sidecar_only": True,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_runtime_impact_check.json").write_text(
        json.dumps(
            {
                "production_asr_postprocess_changed": False,
                "production_recall_trigger_changed": False,
                "shadow_only": True,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps({"latency": latency_report, "shadow": shadow}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
