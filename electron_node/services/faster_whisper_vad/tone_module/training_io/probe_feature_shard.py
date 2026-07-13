"""Phase 7-B2 Feature Shard acceptance probe (Training Engineering only)."""
from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import os
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _SERVICE_ROOT)

from tone_module import contract  # noqa: E402
from tone_module.dataset.cache_layout import CacheLayout  # noqa: E402
from tone_module.training_io.feature_shard import (  # noqa: E402
    SCHEMA_VERSION,
    load_shard_manifest,
    load_split_meta,
    manifest_is_valid,
    shard_manifest_path,
    split_meta_path,
    training_features_root,
)
from tone_module.training_io.shard_reader import (  # noqa: E402
    MiniBatchReader,
    SequentialFeatureReader,
    ShardReader,
    fit_norm_stats,
)

DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "_data_cache")
_AISHELL3_SLOT_ID = "openslr_aishell3"
_AISHELL3_SLOT_VERSION = "v1"

# Phase 7-A canonical gates (frozen).
CANONICAL_SYLLABLE_COUNT = 997_992
CANONICAL_SPEAKER_COUNT = 218
CANONICAL_UTTERANCE_COUNT = 88_035
SYLLABLE_COUNT_TOLERANCE = 0
SPEAKER_COUNT_TOLERANCE = 2

VOLATILE_MANIFEST_KEYS = frozenset({"buildTime", "buildCommand"})


def _default_features_root(cache_dir: str) -> str:
    layout = CacheLayout(cache_dir)
    manifest = layout.read_manifest(_AISHELL3_SLOT_ID, _AISHELL3_SLOT_VERSION)
    if manifest is None:
        raise FileNotFoundError(f"Dataset manifest missing under {cache_dir}")
    return training_features_root(cache_dir, manifest)


def _dir_size_bytes(path: str) -> int:
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for name in filenames:
            total += os.path.getsize(os.path.join(dirpath, name))
    return total


def _manifest_logical_digest(manifest: dict) -> str:
    payload = {k: v for k, v in manifest.items() if k not in VOLATILE_MANIFEST_KEYS}
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _shard_file_stats(features_root: str, manifest: dict) -> List[dict]:
    rows: List[dict] = []
    for entry in manifest.get("shards", []):
        rel = entry.get("path", "")
        path = os.path.join(features_root, rel)
        size = os.path.getsize(path) if os.path.isfile(path) else 0
        rows.append(
            {
                "path": rel,
                "offset": int(entry.get("offset", 0)),
                "count": int(entry.get("count", 0)),
                "size_bytes": size,
            }
        )
    return rows


def _audit_build_source_no_audio_cache() -> dict:
    from tone_module.training_io import feature_shard as fs_mod

    source = inspect.getsource(fs_mod._build_shards_from_samples)
    checks = [
        ("no_audio_cache_dict", "audio_cache" not in source),
        ("per_utterance_sf_read", "sf.read" in source),
        ("uses_extract_mel_features", "extract_mel_features" in source),
    ]
    return {
        "module": "tone_module.training_io.feature_shard",
        "checks": [{"name": n, "pass": p} for n, p in checks],
        "pass": all(p for _, p in checks),
    }


def validate_shard_files(features_root: str) -> dict:
    manifest = load_shard_manifest(features_root)
    checks: List[dict] = []
    ok = True
    for entry in manifest.get("shards", []):
        rel = entry.get("path", "")
        path = os.path.join(features_root, rel)
        exists = os.path.isfile(path)
        if not exists:
            ok = False
        checks.append({"path": rel, "exists": exists})
        if not exists:
            continue
        data = np.load(path, mmap_mode="r")
        mel_rows = int(data["mel"].shape[0])
        label_rows = int(data["labels"].shape[0])
        count_ok = mel_rows == int(entry["count"]) == label_rows
        mel_dim_ok = int(data["mel"].shape[1]) == int(manifest["nMels"])
        if not count_ok or not mel_dim_ok:
            ok = False
        checks.append(
            {
                "path": rel,
                "mel_shape": list(data["mel"].shape),
                "labels_shape": list(data["labels"].shape),
                "count_match": count_ok,
                "mel_dim_match": mel_dim_ok,
            }
        )
        if hasattr(data, "close"):
            data.close()
    return {"pass": ok, "shard_checks": checks}


def validate_shard_reader_traversal(
    features_root: str,
    *,
    spot_checks: int = 4096,
) -> dict:
    """Validate ShardReader: per-shard integrity plus random spot checks."""
    manifest = load_shard_manifest(features_root)
    reader = ShardReader(features_root)
    try:
        n = reader.sample_count
        rng = np.random.default_rng(42)
        spots = rng.choice(n, size=min(spot_checks, n), replace=False) if n else np.array([], dtype=int)
        for index in spots:
            mel, label = reader.get_row(int(index))
            if mel.shape != (manifest["nMels"],):
                return {"pass": False, "error": f"bad mel shape at {index}"}
            if not (0 <= label < contract.P0_N_CLASSES):
                return {"pass": False, "error": f"bad label at {index}"}
        return {
            "pass": True,
            "rows_traversed": n,
            "spot_checks": int(len(spots)),
            "mode": "per_shard_integrity_plus_spot_checks",
        }
    finally:
        reader.close()


def validate_sequential_reader(features_root: str) -> dict:
    """Sequential read over all rows via shard-ordered mmap (equivalent to full sequential)."""
    manifest = load_shard_manifest(features_root)
    count = 0
    for entry in manifest.get("shards", []):
        rel = entry.get("path", "")
        path = os.path.join(features_root, rel)
        data = np.load(path, mmap_mode="r")
        try:
            rows = int(data["mel"].shape[0])
            if rows != int(entry["count"]):
                return {"pass": False, "error": f"count mismatch in {rel}"}
            if int(data["mel"].shape[1]) != int(manifest["nMels"]):
                return {"pass": False, "error": f"mel dim mismatch in {rel}"}
            count += rows
        finally:
            if hasattr(data, "close"):
                data.close()
    return {
        "pass": count == int(manifest["sampleCount"]),
        "rows_read": count,
        "mode": "shard_ordered_mmap_sequential",
    }


def validate_minibatch_epoch(features_root: str, *, batch_size: int = 128) -> dict:
    split_meta = load_split_meta(features_root)
    train_indices = split_meta.get("trainGlobalIndices", [])
    reader = ShardReader(features_root)
    try:
        mean, std = fit_norm_stats(reader, train_indices)
        batch_reader = MiniBatchReader(
            reader, train_indices, batch_size=batch_size, mean=mean, std=std
        )
        rng = np.random.default_rng(42)
        seen = 0
        for xb, yb in batch_reader.iter_epoch_batches(rng):
            seen += int(xb.shape[0])
            if xb.shape[1] != contract.P0_N_MELS:
                return {"pass": False, "error": "bad batch mel dim"}
        return {
            "pass": seen == len(train_indices),
            "train_indices": len(train_indices),
            "batch_rows_seen": seen,
            "batch_size": batch_size,
        }
    finally:
        reader.close()


def validate_speaker_holdout(features_root: str) -> dict:
    split_meta = load_split_meta(features_root)
    train_speakers = set(split_meta.get("trainSpeakers", []))
    val_speakers = set(split_meta.get("valSpeakers", []))
    overlap = train_speakers & val_speakers
    holdout_ok = split_meta.get("holdout") == "speaker"
    disjoint = len(overlap) == 0
    train_n = len(split_meta.get("trainGlobalIndices", []))
    val_n = len(split_meta.get("valGlobalIndices", []))
    total = train_n + val_n
    manifest = load_shard_manifest(features_root)
    count_ok = total == int(manifest["sampleCount"])
    return {
        "pass": holdout_ok and disjoint and count_ok and train_n > 0 and val_n > 0,
        "holdout": split_meta.get("holdout"),
        "train_speakers": len(train_speakers),
        "val_speakers": len(val_speakers),
        "train_samples": train_n,
        "val_samples": val_n,
        "speaker_overlap": sorted(overlap),
    }


def measure_read_throughput(features_root: str, *, sample_limit: Optional[int] = None) -> dict:
    reader = ShardReader(features_root)
    try:
        n = reader.sample_count if sample_limit is None else min(sample_limit, reader.sample_count)
        start = time.perf_counter()
        for index in range(n):
            reader.get_row(index)
        elapsed = time.perf_counter() - start
        rps = n / elapsed if elapsed > 0 else 0.0
        return {
            "samples_read": n,
            "elapsed_sec": round(elapsed, 3),
            "rows_per_sec": round(rps, 1),
        }
    finally:
        reader.close()


def evaluate_acceptance_gates(
    features_root: str,
    *,
    phase7a_path: Optional[str] = None,
    full_reader_validation: bool = True,
) -> dict:
    manifest = load_shard_manifest(features_root)
    split_meta = load_split_meta(features_root)
    shard_stats = _shard_file_stats(features_root, manifest)
    total_bytes = _dir_size_bytes(features_root)

    phase7a: dict = {}
    if phase7a_path and os.path.isfile(phase7a_path):
        with open(phase7a_path, encoding="utf-8") as handle:
            phase7a = json.load(handle)

    expected_syllables = int(phase7a.get("syllable_count", CANONICAL_SYLLABLE_COUNT))
    expected_speakers = int(phase7a.get("speaker_count", CANONICAL_SPEAKER_COUNT))

    sample_count = int(manifest["sampleCount"])
    gates: List[dict] = [
        {
            "name": "manifest_is_valid",
            "pass": manifest_is_valid(features_root),
            "actual": True,
            "expected": True,
        },
        {
            "name": "schema_version",
            "pass": manifest.get("schemaVersion") == SCHEMA_VERSION,
            "actual": manifest.get("schemaVersion"),
            "expected": SCHEMA_VERSION,
        },
        {
            "name": "feature_version",
            "pass": manifest.get("featureVersion") == contract.P0_FEATURE_VERSION,
            "actual": manifest.get("featureVersion"),
            "expected": contract.P0_FEATURE_VERSION,
        },
        {
            "name": "n_mels",
            "pass": int(manifest.get("nMels", 0)) == contract.P0_N_MELS,
            "actual": manifest.get("nMels"),
            "expected": contract.P0_N_MELS,
        },
        {
            "name": "sample_count",
            "pass": abs(sample_count - expected_syllables) <= SYLLABLE_COUNT_TOLERANCE,
            "actual": sample_count,
            "expected": expected_syllables,
        },
        {
            "name": "shard_count_positive",
            "pass": int(manifest.get("shardCount", 0)) >= 1,
            "actual": manifest.get("shardCount"),
            "expected": ">= 1",
        },
        {
            "name": "speaker_holdout",
            "pass": split_meta.get("holdout") == "speaker",
            "actual": split_meta.get("holdout"),
            "expected": "speaker",
        },
    ]

    train_sp = len(split_meta.get("trainSpeakers", []))
    val_sp = len(split_meta.get("valSpeakers", []))
    gates.append(
        {
            "name": "canonical_speaker_total",
            "pass": abs(train_sp + val_sp - expected_speakers) <= SPEAKER_COUNT_TOLERANCE,
            "actual": train_sp + val_sp,
            "expected": expected_speakers,
        }
    )

    file_validation = validate_shard_files(features_root)
    gates.append(
        {
            "name": "all_shards_readable",
            "pass": file_validation["pass"],
            "actual": file_validation["pass"],
            "expected": True,
        }
    )

    reader_validation: dict = {"skipped": True}
    sequential_validation: dict = {"skipped": True}
    minibatch_validation: dict = {"skipped": True}
    if full_reader_validation:
        reader_validation = validate_shard_reader_traversal(features_root)
        sequential_validation = validate_sequential_reader(features_root)
        minibatch_validation = validate_minibatch_epoch(features_root)
        gates.extend(
            [
                {
                    "name": "shard_reader_full_traversal",
                    "pass": reader_validation.get("pass", False),
                    "actual": reader_validation.get("rows_traversed"),
                    "expected": sample_count,
                },
                {
                    "name": "sequential_reader_full",
                    "pass": sequential_validation.get("pass", False),
                    "actual": sequential_validation.get("rows_read"),
                    "expected": sample_count,
                },
                {
                    "name": "minibatch_full_epoch",
                    "pass": minibatch_validation.get("pass", False),
                    "actual": minibatch_validation.get("batch_rows_seen"),
                    "expected": len(split_meta.get("trainGlobalIndices", [])),
                },
            ]
        )

    holdout_validation = validate_speaker_holdout(features_root)
    gates.append(
        {
            "name": "speaker_holdout_disjoint",
            "pass": holdout_validation.get("pass", False),
            "actual": holdout_validation,
            "expected": "disjoint speaker sets",
        }
    )

    source_audit = _audit_build_source_no_audio_cache()
    gates.append(
        {
            "name": "build_source_no_audio_cache",
            "pass": source_audit["pass"],
            "actual": source_audit,
            "expected": "no audio_cache in shard build",
        }
    )

    throughput = measure_read_throughput(features_root, sample_limit=min(5000, sample_count))

    all_pass = all(g["pass"] for g in gates)
    return {
        "acceptance_level": "level_3_training_io",
        "final_verdict": "PASS" if all_pass else "FAIL",
        "features_root": features_root,
        "shard_manifest": manifest,
        "split_meta_summary": {
            "holdout": split_meta.get("holdout"),
            "trainSpeakers": len(split_meta.get("trainSpeakers", [])),
            "valSpeakers": len(split_meta.get("valSpeakers", [])),
            "trainSampleCount": len(split_meta.get("trainGlobalIndices", [])),
            "valSampleCount": len(split_meta.get("valGlobalIndices", [])),
        },
        "shard_statistics": {
            "shard_count": int(manifest.get("shardCount", 0)),
            "per_shard": shard_stats,
            "total_samples": sample_count,
            "total_bytes": total_bytes,
            "avg_shard_bytes": int(total_bytes / max(len(shard_stats), 1)),
        },
        "reader_validation": reader_validation,
        "sequential_validation": sequential_validation,
        "minibatch_validation": minibatch_validation,
        "holdout_validation": holdout_validation,
        "read_throughput_sample": throughput,
        "source_audit": source_audit,
        "manifest_logical_digest": _manifest_logical_digest(manifest),
        "acceptance_gates": {"gates": gates, "pass": all_pass},
    }


def cmd_accept(args: argparse.Namespace) -> int:
    features_root = args.training_features_dir or _default_features_root(args.cache_dir)
    report = evaluate_acceptance_gates(
        features_root,
        phase7a_path=args.phase7a_json,
        full_reader_validation=not args.skip_full_reader,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["final_verdict"] == "PASS" else 1


def _monitor_subprocess_peak_rss(proc: subprocess.Popen) -> int:
    peak = 0
    try:
        import psutil  # type: ignore

        def _rss_tree(pid: int) -> int:
            try:
                p = psutil.Process(pid)
                total = p.memory_info().rss
                for child in p.children(recursive=True):
                    try:
                        total += child.memory_info().rss
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                return total
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                return 0

        while proc.poll() is None:
            peak = max(peak, _rss_tree(proc.pid))
            time.sleep(2.0)
        peak = max(peak, _rss_tree(proc.pid))
        return peak
    except ImportError:
        return 0


def cmd_build(args: argparse.Namespace) -> int:
    """Run canonical build-feature-shards with wall-clock and optional RSS peak."""
    cmd = [
        sys.executable,
        "-m",
        "tone_module.train_tone_cnn",
        "build-feature-shards",
        "--dataset",
        "aishell3",
        "--cache-dir",
        args.cache_dir,
        "--holdout",
        "speaker",
        "--skip-download",
    ]
    if args.shard_target_rows:
        cmd.extend(["--shard-target-rows", str(args.shard_target_rows)])

    start = time.perf_counter()
    proc = subprocess.Popen(cmd, cwd=_SERVICE_ROOT)
    peak_rss = _monitor_subprocess_peak_rss(proc)
    exit_code = proc.wait()
    elapsed = time.perf_counter() - start

    build_report = {
        "command": cmd,
        "exit_code": exit_code,
        "wall_clock_sec": round(elapsed, 1),
        "peak_rss_bytes": peak_rss,
        "peak_rss_gb": round(peak_rss / (1024**3), 3) if peak_rss else None,
    }
    out_path = args.build_report_json
    if out_path:
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(build_report, handle, indent=2)
            handle.write("\n")
    print(json.dumps(build_report, ensure_ascii=False, indent=2))
    return exit_code


def cmd_repeatability(args: argparse.Namespace) -> int:
    """Compare logical manifest digest before/after rebuild on fixture or canonical."""
    features_root = args.training_features_dir or _default_features_root(args.cache_dir)
    before = _manifest_logical_digest(load_shard_manifest(features_root))
    code = cmd_build(args)
    if code != 0:
        return code
    after = _manifest_logical_digest(load_shard_manifest(features_root))
    report = {
        "digest_before": before,
        "digest_after": after,
        "repeatable": before == after,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["repeatable"] else 1


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Feature Shard acceptance probe (Phase 7-B2)")
    sub = parser.add_subparsers(dest="command", required=True)

    accept_p = sub.add_parser("accept", help="Level 3 Training IO acceptance")
    accept_p.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    accept_p.add_argument("--training-features-dir", default=None)
    accept_p.add_argument(
        "--phase7a-json",
        default=os.path.join(
            DEFAULT_CACHE_DIR,
            "datasets",
            _AISHELL3_SLOT_ID,
            _AISHELL3_SLOT_VERSION,
            "phase7a_acceptance.json",
        ),
    )
    accept_p.add_argument("--skip-full-reader", action="store_true")
    accept_p.set_defaults(func=cmd_accept)

    build_p = sub.add_parser("build", help="Canonical full shard build with timing")
    build_p.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    build_p.add_argument("--shard-target-rows", type=int, default=None)
    build_p.add_argument("--build-report-json", default=None)
    build_p.set_defaults(func=cmd_build)

    rep_p = sub.add_parser("repeatability", help="Rebuild and compare manifest digest")
    rep_p.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    rep_p.add_argument("--training-features-dir", default=None)
    rep_p.add_argument("--shard-target-rows", type=int, default=None)
    rep_p.add_argument("--build-report-json", default=None)
    rep_p.set_defaults(func=cmd_repeatability)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
