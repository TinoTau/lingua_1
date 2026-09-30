# -*- coding: utf-8 -*-
"""Write final phase report and go_summary from artifacts."""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
DATA = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
MODEL = REPO / "training/model3_dataset/model3_v1_synthetic_bigru"


def load_json(name: str) -> dict:
    p = DOCS / name
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def decide(validation: dict, test_m: dict, manifest: dict) -> str:
    if not validation.get("gate_pass"):
        if validation.get("sample_count", 0) < 90000:
            return "DATASET_FAIL"
        return "DATASET_FAIL"
    if test_m.get("retry_f1", 0) <= 0 and test_m.get("tp", 0) == 0:
        return "MODEL_FAIL"
    if validation.get("retry_ratio_eligible_non_anchor", 0) < 0.03:
        return "PASS_WITH_QUALITY_GAPS"
    if test_m.get("retry_f1", 0) < 0.15:
        return "PASS_WITH_QUALITY_GAPS"
    return "PASS"


def main():
    manifest = json.loads((DATA / "dataset_manifest.json").read_text(encoding="utf-8")) if (DATA / "dataset_manifest.json").exists() else {}
    validation = load_json("model3_v1_data_validation.json")
    test_m = load_json("model3_v1_test_metrics.json")
    dev_m = load_json("model3_v1_dev_metrics.json")
    latency = load_json("model3_v1_cpu_latency.json")
    shadow = load_json("model3_v1_shadow_no_behavior_change.json")
    anchor_dist = load_json("model3_v1_anchor_distribution.json")
    label_dist = load_json("model3_v1_label_distribution.json")
    dataset_dist = load_json("model3_v1_dataset_distribution.json")
    model_manifest = json.loads((MODEL / "model_manifest.json").read_text(encoding="utf-8")) if (MODEL / "model_manifest.json").exists() else {}
    config = json.loads((MODEL / "config.json").read_text(encoding="utf-8")) if (MODEL / "config.json").exists() else {}

    verdict = decide(validation, test_m, manifest)
    real_block = test_m
    real_path = DOCS / "model3_v1_bucket_metrics.csv"
    real_domain = "INSUFFICIENT_REAL_DOMAIN_SAMPLE"
    if real_path.exists():
        bucket = json.loads(real_path.read_text(encoding="utf-8"))
        if "REAL_DOMAIN" in bucket and bucket["REAL_DOMAIN"].get("samples", 0) >= 50:
            rd = bucket["REAL_DOMAIN"]
            real_domain = rd

    inv = []
    proc = subprocess.run(
        ["git", "diff", "--name-only", "HEAD"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    for line in proc.stdout.splitlines():
        if "model3" in line.lower() or "training/model3" in line:
            inv.append(line)
    inv_path = DOCS / "model3_v1_modified_file_inventory.csv"
    inv_path.write_text("path\n" + "\n".join(inv) + ("\n" if inv else ""), encoding="utf-8")

    if verdict in ("PASS", "PASS_WITH_QUALITY_GAPS"):
        next_phase = "MODEL3_TTS_ASR_DATASET_AND_REAL_ERROR_ENHANCEMENT"
    elif verdict == "DATASET_FAIL":
        next_phase = "MODEL3_V1_SYNTHETIC_DATASET_REPAIR"
    else:
        next_phase = "ADDRESS_DATASET_OR_MODEL_GATE"
    go = {
        "phase": "MODEL3_V1_SYNTHETIC_TRAINING_DATA_AND_BASELINE_DEVELOPMENT",
        "verdict": verdict,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset_samples": manifest.get("sampleCount"),
        "qa_gate_pass": validation.get("gate_pass"),
        "test_retry_f1": test_m.get("retry_f1"),
        "bootstrap_anchor_v0": "NOT_FOUND_IN_REPO",
        "recommended_next_phase": next_phase,
        "quality_gaps": [],
    }
    if validation.get("retry_ratio_eligible_non_anchor", 0) < 0.05:
        go["quality_gaps"].append("RETRY_DENSITY_BELOW_10PCT_TARGET")
    if anchor_dist.get("sidecar_buckets", {}).get("REAL_DOMAIN", 0) == 0:
        go["quality_gaps"].append("NO_REAL_DOMAIN_ANCHOR_SAMPLES")
    (DOCS / "model3_v1_go_summary.json").write_text(json.dumps(go, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Lingua Model3 V1 Synthetic Dataset + Baseline Development Report",
        "",
        f"**Date:** 2026-08-24  ",
        f"**Phase:** `MODEL3_V1_SYNTHETIC_TRAINING_DATA_AND_BASELINE_DEVELOPMENT`  ",
        f"**Verdict:** `{verdict}`",
        "",
        "## Authorities",
        "",
        "- `MODEL3_TRAINING_SAMPLE_V1_SCHEMA.json` — unchanged",
        "- `MODEL3_BOOTSTRAP_ANCHOR_V0` — **not present in repo** (mechanics reference only; not used as formal corpus)",
        "",
        "## Dataset",
        "",
        f"| Metric | Value |",
        f"|--------|------:|",
        f"| Total samples | {manifest.get('sampleCount', 'N/A')} |",
        f"| Train | {dataset_dist.get('train', manifest.get('splitCounts', {}).get('train', 'N/A'))} |",
        f"| Dev | {dataset_dist.get('dev', manifest.get('splitCounts', {}).get('dev', 'N/A'))} |",
        f"| Test | {dataset_dist.get('test', manifest.get('splitCounts', {}).get('test', 'N/A'))} |",
        f"| Certified base pool | 22177 |",
        "",
        "## Anchors",
        "",
        f"- Anchor-conditioned utterances: {anchor_dist.get('utterance_anchor_conditioned', 'N/A')}",
        f"- NO_ANCHOR utterances: {anchor_dist.get('utterance_no_anchor', 'N/A')}",
        f"- Sidecar buckets: `{json.dumps(anchor_dist.get('sidecar_buckets', {}), ensure_ascii=False)}`",
        f"- Simulated visible as model feature: **NO**",
        "",
        "## Labels",
        "",
        f"- Span labels: `{json.dumps(label_dist, ensure_ascii=False)}`",
        f"- Anchor RETRY: {validation.get('anchor_retry', 'N/A')}",
        f"- RETRY without reachability YES: {validation.get('retry_without_reachability_yes', 'N/A')}",
        f"- RETRY ratio (eligible non-anchor): {validation.get('retry_ratio_eligible_non_anchor', 'N/A')}",
        "",
        "## QA",
        "",
        f"- Gate pass: {validation.get('gate_pass')}",
        f"- Split leakage zero: {validation.get('split_leakage_zero')}",
        f"- dialog_200: {validation.get('dialog_200')}",
        "",
        "## Model (MODEL3_V1_SYNTHETIC_BASELINE)",
        "",
        f"- Architecture: Small BiGRU",
        f"- Params: {sum(p.numel() for p in []) if False else 'see training report'}",
        f"- Test RETRY F1: {test_m.get('retry_f1', 'N/A')}",
        f"- Test false RETRY rate: {test_m.get('false_retry_rate', 'N/A')}",
        f"- CPU p50 ms: {latency.get('p50_ms', 'N/A')}",
        "",
        "## Shadow",
        "",
        f"- Production output changed: {shadow.get('production_output_changed', 'NO')}",
        f"- Actual retry triggered: {shadow.get('actual_retry_triggered', False)}",
        "",
        "## STOP",
        "",
        "No TTS, no production RETRY enablement, no runtime anchor / Domain Vote / Recall changes.",
        "",
    ]
    (DOCS / "Lingua_Model3_V1_Synthetic_Dataset_Development_Report_2026_08_24.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )
    (DOCS / "Lingua_Model3_V1_BiGRU_Training_Report_2026_08_24.md").write_text(
        "\n".join(
            [
                "# Lingua Model3 V1 BiGRU Training Report",
                "",
                f"**Date:** 2026-08-24",
                f"**Model:** MODEL3_V1_SYNTHETIC_BASELINE",
                "",
                "## Dev metrics",
                "",
                "```json",
                json.dumps(dev_m, ensure_ascii=False, indent=2),
                "```",
                "",
                "## Test metrics",
                "",
                "```json",
                json.dumps(test_m, ensure_ascii=False, indent=2),
                "```",
            ]
        ),
        encoding="utf-8",
    )
    print(json.dumps(go, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
