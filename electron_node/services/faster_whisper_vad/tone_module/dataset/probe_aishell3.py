"""Probe CLI for OpenSLR AISHELL-3 dataset adapter — materialize / stats / join-audit."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple

_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _SERVICE_ROOT)

from tone_module import contract  # noqa: E402
from tone_module.dataset.adapter_openslr_aishell3 import OpenSlrAishell3DatasetAdapter  # noqa: E402
from tone_module.dataset.alignment_textgrid import (  # noqa: E402
    index_wavs,
    parse_textgrid_intervals,
    tone_label_from_pinyin,
)
from tone_module.dataset.alignment_textgrid import TextGridPinyinAlignmentProvider  # noqa: E402
from tone_module.dataset.dataset_contract import (  # noqa: E402
    AlignmentProvider,
    DatasetAdapter,
    SyllableSample,
    enrich_manifest_counts,
)
from tone_module.dataset.cache_layout import CacheLayout  # noqa: E402
from tone_module.dataset.pipeline import load_syllable_samples  # noqa: E402

DEFAULT_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "_data_cache")

SPEAKER_RE = re.compile(r"(SSB\d+)", re.IGNORECASE)
_LABEL_TO_TONE = {0: "t1", 1: "t2", 2: "t3", 3: "t4", 4: "t5"}

# Phase 7-A full-dataset acceptance gates (Level 2 Dataset Probe only).
MIN_WAV_JOIN_RATE = 0.99
EXPECTED_SPEAKER_COUNT = 218
EXPECTED_UTTERANCE_COUNT = 88035
MIN_SYLLABLE_COUNT = 950_000  # P7-A empirical: ~998k pinyin syllables after MFA phone filtering
SPEAKER_COUNT_TOLERANCE = 2
UTTERANCE_COUNT_TOLERANCE = 200


@dataclass(frozen=True)
class ProbeFilters:
    max_utterances: Optional[int] = None
    max_speakers: Optional[int] = None
    speaker_ids: Optional[Set[str]] = None


def _speaker_id_from_path(path: str) -> Optional[str]:
    match = SPEAKER_RE.search(path.replace("\\", "/"))
    return match.group(1).upper() if match else None


def _index_textgrids(dataset_root: str) -> Dict[str, str]:
    tg_map: Dict[str, str] = {}
    for dirpath, _, filenames in os.walk(dataset_root):
        for name in filenames:
            if not name.endswith(".TextGrid"):
                continue
            base = os.path.splitext(name)[0]
            tg_map[base] = os.path.join(dirpath, name)
    return tg_map


def _apply_filters(
    wav_map: Dict[str, str],
    *,
    filters: ProbeFilters,
) -> Dict[str, str]:
    items = sorted(wav_map.items(), key=lambda item: item[0])
    if filters.speaker_ids:
        allowed = {speaker.upper() for speaker in filters.speaker_ids}
        items = [
            (base, path)
            for base, path in items
            if _speaker_id_from_path(path) in allowed
        ]
    if filters.max_speakers is not None:
        speakers: List[str] = []
        kept: List[Tuple[str, str]] = []
        for base, path in items:
            speaker = _speaker_id_from_path(path)
            if speaker and speaker not in speakers:
                if len(speakers) >= filters.max_speakers:
                    continue
                speakers.append(speaker)
            if speaker is None or speaker in speakers:
                kept.append((base, path))
        items = kept
    if filters.max_utterances is not None:
        items = items[: filters.max_utterances]
    return dict(items)


def audit_join(
    materialized_root: str,
    *,
    filters: ProbeFilters,
) -> dict:
    wav_map = index_wavs(materialized_root)
    tg_map = _index_textgrids(materialized_root)
    filtered_wav = _apply_filters(wav_map, filters=filters)

    filtered_tg: Dict[str, str] = {}
    for base, path in tg_map.items():
        speaker = _speaker_id_from_path(path)
        if filters.speaker_ids and speaker not in {s.upper() for s in filters.speaker_ids}:
            continue
        if filters.max_speakers is not None:
            allowed_speakers = {
                _speaker_id_from_path(p)
                for p in filtered_wav.values()
                if _speaker_id_from_path(p)
            }
            if speaker and speaker not in allowed_speakers:
                continue
        filtered_tg[base] = path

    if filters.max_utterances is not None:
        allowed_bases = set(filtered_wav.keys())
        filtered_tg = {base: path for base, path in filtered_tg.items() if base in allowed_bases}

    wav_bases = set(filtered_wav.keys())
    tg_bases = set(filtered_tg.keys())
    matched = wav_bases & tg_bases
    missing_textgrid = sorted(wav_bases - tg_bases)
    missing_wav = sorted(tg_bases - wav_bases)

    wav_join_rate = float(len(matched) / len(wav_bases)) if wav_bases else 0.0
    textgrid_join_rate = float(len(matched) / len(tg_bases)) if tg_bases else 0.0

    return {
        "wav_count": len(wav_bases),
        "textgrid_count": len(tg_bases),
        "matched_utterance_count": len(matched),
        "wav_join_rate": wav_join_rate,
        "textgrid_join_rate": textgrid_join_rate,
        "missing_textgrid_samples": missing_textgrid[:20],
        "missing_wav_samples": missing_wav[:20],
        "filtered_wav_map": filtered_wav,
        "filtered_tg_map": filtered_tg,
        "matched_bases": matched,
    }


def collect_samples_from_pairs(
    pairs: Sequence[Tuple[str, str]],
) -> Tuple[List[SyllableSample], int]:
    samples: List[SyllableSample] = []
    invalid_token_count = 0

    for wav_path, tg_path in pairs:
        with open(tg_path, encoding="utf-8", errors="ignore") as handle:
            text = handle.read()
        for start, end, token in parse_textgrid_intervals(text):
            stripped = token.strip()
            if not stripped:
                continue
            label = tone_label_from_pinyin(stripped)
            if label is None:
                invalid_token_count += 1
                continue
            if end - start < contract.P0_MIN_SLICE_SEC:
                continue
            samples.append(SyllableSample(wav_path, start, end, label))

    return samples, invalid_token_count


def build_probe_report(
    manifest,
    *,
    filters: ProbeFilters,
    samples: List[SyllableSample],
    join_info: dict,
    invalid_token_count: int,
) -> dict:
    class_counts = Counter(sample.label for sample in samples)
    label_dist = {_LABEL_TO_TONE[i]: class_counts.get(i, 0) for i in range(contract.P0_N_CLASSES)}
    utterances = {os.path.basename(sample.wav_path) for sample in samples}
    speakers: Set[str] = set()
    for sample in samples:
        speaker = _speaker_id_from_path(sample.wav_path)
        if speaker:
            speakers.add(speaker)

    enriched = enrich_manifest_counts(manifest, samples)
    return {
        "dataset_id": enriched.dataset_id,
        "version": enriched.version,
        "materialized_root": enriched.materialized_root,
        "alignment_source": enriched.alignment_source,
        "speaker_count": len(speakers) if speakers else enriched.metadata.speaker_count,
        "utterance_count": len(utterances),
        "syllable_count": len(samples),
        "class_distribution": label_dist,
        "wav_join_rate": join_info["wav_join_rate"],
        "textgrid_join_rate": join_info["textgrid_join_rate"],
        "matched_utterance_count": join_info["matched_utterance_count"],
        "wav_count": join_info["wav_count"],
        "textgrid_count": join_info["textgrid_count"],
        "missing_textgrid_samples": join_info["missing_textgrid_samples"],
        "missing_wav_samples": join_info["missing_wav_samples"],
        "invalid_token_count": invalid_token_count,
        "metadata": {
            "dataset_version": enriched.metadata.dataset_version,
            "source": enriched.metadata.source,
            "license": enriched.metadata.license,
            "alignment_provider": enriched.metadata.alignment_provider,
        },
        "filters": {
            "max_utterances": filters.max_utterances,
            "max_speakers": filters.max_speakers,
            "speaker_ids": sorted(filters.speaker_ids) if filters.speaker_ids else None,
        },
    }


def make_adapter_from_args(args: argparse.Namespace) -> OpenSlrAishell3DatasetAdapter:
    speaker_ids = None
    if getattr(args, "speaker_ids", None):
        speaker_ids = {part.strip().upper() for part in args.speaker_ids.split(",") if part.strip()}
    return OpenSlrAishell3DatasetAdapter(
        openslr_tgz=getattr(args, "openslr_tgz", None),
        textgrid_zip=getattr(args, "textgrid_zip", None),
        local_audio_root=getattr(args, "local_audio_root", None),
        local_textgrid_root=getattr(args, "local_textgrid_root", None),
        skip_download=getattr(args, "skip_download", False),
    )


def make_filters_from_args(args: argparse.Namespace) -> ProbeFilters:
    speaker_ids = None
    if getattr(args, "speaker_ids", None):
        speaker_ids = {part.strip().upper() for part in args.speaker_ids.split(",") if part.strip()}
    return ProbeFilters(
        max_utterances=getattr(args, "max_utterances", None),
        max_speakers=getattr(args, "max_speakers", None),
        speaker_ids=speaker_ids,
    )


def cmd_materialize(args: argparse.Namespace) -> dict:
    adapter = make_adapter_from_args(args)
    manifest = adapter.materialize(args.cache_dir)
    report = {
        "dataset_id": manifest.dataset_id,
        "version": manifest.version,
        "materialized_root": manifest.materialized_root,
        "alignment_source": manifest.alignment_source,
        "metadata": {
            "dataset_version": manifest.metadata.dataset_version,
            "source": manifest.metadata.source,
            "license": manifest.metadata.license,
            "alignment_provider": manifest.metadata.alignment_provider,
        },
    }
    return report


def cmd_join_audit(args: argparse.Namespace) -> dict:
    adapter = make_adapter_from_args(args)
    manifest = adapter.materialize(args.cache_dir)
    filters = make_filters_from_args(args)
    join_info = audit_join(manifest.materialized_root, filters=filters)
    return {
        "dataset_id": manifest.dataset_id,
        "version": manifest.version,
        "materialized_root": manifest.materialized_root,
        "alignment_source": manifest.alignment_source,
        "wav_join_rate": join_info["wav_join_rate"],
        "textgrid_join_rate": join_info["textgrid_join_rate"],
        "matched_utterance_count": join_info["matched_utterance_count"],
        "wav_count": join_info["wav_count"],
        "textgrid_count": join_info["textgrid_count"],
        "missing_textgrid_samples": join_info["missing_textgrid_samples"],
        "missing_wav_samples": join_info["missing_wav_samples"],
        "metadata": {
            "dataset_version": manifest.metadata.dataset_version,
            "source": manifest.metadata.source,
            "license": manifest.metadata.license,
            "alignment_provider": manifest.metadata.alignment_provider,
        },
        "filters": {
            "max_utterances": filters.max_utterances,
            "max_speakers": filters.max_speakers,
            "speaker_ids": sorted(filters.speaker_ids) if filters.speaker_ids else None,
        },
    }


def validate_manifest(manifest, cache_dir: str) -> dict:
    checks: List[dict] = []
    layout = CacheLayout(cache_dir)

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "pass": ok, "detail": detail})

    add("dataset_id", manifest.dataset_id == "openslr_aishell3", manifest.dataset_id)
    add("version", manifest.version == "v1", manifest.version)
    add("materialized_root_exists", os.path.isdir(manifest.materialized_root), manifest.materialized_root)
    add(
        "materialized_root_valid",
        layout.is_materialized_root_valid(manifest.materialized_root) if os.path.isdir(manifest.materialized_root) else False,
        manifest.materialized_root,
    )
    manifest_path = layout.manifest_path(manifest.dataset_id, manifest.version)
    add("manifest_json_on_disk", os.path.isfile(manifest_path), manifest_path)
    add("alignment_source", bool(manifest.alignment_source), manifest.alignment_source)
    add(
        "metadata_dataset_version",
        manifest.metadata.dataset_version == "openslr_slr93_full",
        manifest.metadata.dataset_version,
    )
    add("metadata_source", bool(manifest.metadata.source), manifest.metadata.source[:80] if manifest.metadata.source else "")
    add(
        "metadata_alignment_provider",
        manifest.metadata.alignment_provider == "textgrid_pinyin_v1",
        manifest.metadata.alignment_provider,
    )
    return {"checks": checks, "pass": all(item["pass"] for item in checks)}


def validate_license(manifest) -> dict:
    license_text = manifest.metadata.license or ""
    checks = [
        {
            "name": "aishell_apache_2_0",
            "pass": "Apache-2.0" in license_text or "apache" in license_text.lower(),
            "detail": license_text,
        },
        {
            "name": "textgrid_license_note",
            "pass": "lars76" in license_text.lower() or "textgrid" in license_text.lower(),
            "detail": license_text,
        },
    ]
    return {"checks": checks, "pass": all(item["pass"] for item in checks)}


def validate_syllable_samples(samples: Sequence[SyllableSample]) -> dict:
    violations: List[str] = []
    for index, sample in enumerate(samples):
        if sample.label < 0 or sample.label >= contract.P0_N_CLASSES:
            violations.append(f"sample[{index}] invalid label {sample.label}")
        if sample.start >= sample.end:
            violations.append(f"sample[{index}] start>=end")
        if not os.path.isfile(sample.wav_path):
            violations.append(f"sample[{index}] missing wav {sample.wav_path}")
        if len(violations) >= 10:
            break
    return {"pass": not violations, "violation_samples": violations[:10], "checked_count": len(samples)}


def validate_dataset_contract(
    adapter: DatasetAdapter,
    alignment: AlignmentProvider,
    *,
    provider_samples: List[SyllableSample],
    enriched_manifest,
    probe_syllable_count: int,
) -> dict:
    checks: List[dict] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "pass": ok, "detail": detail})

    add("adapter_protocol", isinstance(adapter, DatasetAdapter), type(adapter).__name__)
    add("alignment_protocol", isinstance(alignment, AlignmentProvider), type(alignment).__name__)
    add("alignment_provider_id", alignment.provider_id == "textgrid_pinyin_v1", alignment.provider_id)

    sample_check = validate_syllable_samples(provider_samples[: min(5000, len(provider_samples))])
    add("syllable_sample_fields", sample_check["pass"], str(sample_check.get("violation_samples", [])))

    add("provider_collect_samples_nonempty", len(provider_samples) > 0, str(len(provider_samples)))
    add(
        "provider_probe_syllable_parity",
        len(provider_samples) == probe_syllable_count,
        f"provider={len(provider_samples)} probe={probe_syllable_count}",
    )
    add(
        "manifest_counts_enriched",
        enriched_manifest.metadata.syllable_count == len(provider_samples),
        f"manifest_syllable={enriched_manifest.metadata.syllable_count}",
    )

    return {"checks": checks, "pass": all(item["pass"] for item in checks), "provider_syllable_count": len(provider_samples)}


def evaluate_acceptance_gates(stats_report: dict, join_report: dict) -> dict:
    gates: List[dict] = []

    def gate(name: str, ok: bool, actual, expected: str) -> None:
        gates.append({"name": name, "pass": ok, "actual": actual, "expected": expected})

    wav_join = float(join_report.get("wav_join_rate", 0))
    gate("wav_join_rate", wav_join >= MIN_WAV_JOIN_RATE, wav_join, f">= {MIN_WAV_JOIN_RATE}")

    speaker_count = int(stats_report.get("speaker_count", 0))
    gate(
        "speaker_count",
        abs(speaker_count - EXPECTED_SPEAKER_COUNT) <= SPEAKER_COUNT_TOLERANCE,
        speaker_count,
        f"{EXPECTED_SPEAKER_COUNT} ± {SPEAKER_COUNT_TOLERANCE}",
    )

    utterance_count = int(stats_report.get("utterance_count", 0))
    gate(
        "utterance_count",
        abs(utterance_count - EXPECTED_UTTERANCE_COUNT) <= UTTERANCE_COUNT_TOLERANCE,
        utterance_count,
        f"{EXPECTED_UTTERANCE_COUNT} ± {UTTERANCE_COUNT_TOLERANCE}",
    )

    syllable_count = int(stats_report.get("syllable_count", 0))
    gate("syllable_count", syllable_count >= MIN_SYLLABLE_COUNT, syllable_count, f">= {MIN_SYLLABLE_COUNT}")

    invalid_token = int(stats_report.get("invalid_token_count", 0))
    gate("invalid_token_count", True, invalid_token, "reported only")

    filters = stats_report.get("filters") or {}
    gate(
        "full_dataset_no_filters",
        not filters.get("max_utterances") and not filters.get("max_speakers") and not filters.get("speaker_ids"),
        filters,
        "no max_utterances / max_speakers / speaker_ids",
    )

    return {"gates": gates, "pass": all(item["pass"] for item in gates if item["name"] != "invalid_token_count")}


def cmd_accept(args: argparse.Namespace) -> dict:
    adapter = make_adapter_from_args(args)
    alignment = TextGridPinyinAlignmentProvider()

    materialize_report = cmd_materialize(args)
    manifest = adapter.materialize(args.cache_dir)

    manifest_validation = validate_manifest(manifest, args.cache_dir)
    license_validation = validate_license(manifest)

    filters = make_filters_from_args(args)
    join_info = audit_join(manifest.materialized_root, filters=filters)
    join_report = {
        "wav_join_rate": join_info["wav_join_rate"],
        "textgrid_join_rate": join_info["textgrid_join_rate"],
        "matched_utterance_count": join_info["matched_utterance_count"],
        "wav_count": join_info["wav_count"],
        "textgrid_count": join_info["textgrid_count"],
        "missing_textgrid_count": join_info["wav_count"] - join_info["matched_utterance_count"],
        "missing_wav_count": join_info["textgrid_count"] - join_info["matched_utterance_count"],
        "missing_textgrid_samples": join_info["missing_textgrid_samples"],
        "missing_wav_samples": join_info["missing_wav_samples"],
    }

    provider_samples, enriched_manifest = load_syllable_samples(adapter, alignment, args.cache_dir)

    CacheLayout(args.cache_dir).write_manifest(enriched_manifest)

    pairs = [
        (join_info["filtered_wav_map"][base], join_info["filtered_tg_map"][base])
        for base in sorted(join_info["matched_bases"])
    ]
    probe_samples, invalid_token_count = collect_samples_from_pairs(pairs)
    stats_report = build_probe_report(
        enriched_manifest,
        filters=filters,
        samples=provider_samples,
        join_info=join_info,
        invalid_token_count=invalid_token_count,
    )

    contract_validation = validate_dataset_contract(
        adapter,
        alignment,
        provider_samples=provider_samples,
        enriched_manifest=enriched_manifest,
        probe_syllable_count=len(probe_samples),
    )
    gates = evaluate_acceptance_gates(stats_report, join_report)

    sections_pass = (
        manifest_validation["pass"]
        and license_validation["pass"]
        and contract_validation["pass"]
        and gates["pass"]
    )
    if sections_pass:
        verdict = "PASS"
    elif join_report["wav_join_rate"] >= 0.95 and manifest_validation["pass"]:
        verdict = "CONDITIONAL PASS"
    else:
        verdict = "FAIL"

    return {
        "acceptance_level": "level_2_dataset_probe",
        "final_verdict": verdict,
        "materialize": materialize_report,
        "manifest_validation": manifest_validation,
        "license_validation": license_validation,
        "join_audit": join_report,
        "dataset_statistics": stats_report,
        "dataset_contract_validation": contract_validation,
        "acceptance_gates": gates,
        "speaker_count": stats_report["speaker_count"],
        "utterance_count": stats_report["utterance_count"],
        "syllable_count": stats_report["syllable_count"],
        "class_distribution": stats_report["class_distribution"],
        "wav_join_rate": stats_report["wav_join_rate"],
        "missing_wav_samples": stats_report["missing_wav_samples"],
        "missing_textgrid_samples": stats_report["missing_textgrid_samples"],
        "invalid_token_count": stats_report["invalid_token_count"],
        "license": stats_report["metadata"]["license"],
        "source": stats_report["metadata"]["source"],
    }


def cmd_stats(args: argparse.Namespace) -> dict:
    adapter = make_adapter_from_args(args)
    manifest = adapter.materialize(args.cache_dir)
    filters = make_filters_from_args(args)
    join_info = audit_join(manifest.materialized_root, filters=filters)
    pairs = [
        (join_info["filtered_wav_map"][base], join_info["filtered_tg_map"][base])
        for base in sorted(join_info["matched_bases"])
    ]
    samples, invalid_token_count = collect_samples_from_pairs(pairs)
    return build_probe_report(
        manifest,
        filters=filters,
        samples=samples,
        join_info=join_info,
        invalid_token_count=invalid_token_count,
    )


def _emit_report(report: dict, json_out: Optional[str]) -> None:
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if json_out:
        os.makedirs(os.path.dirname(os.path.abspath(json_out)) or ".", exist_ok=True)
        with open(json_out, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.write("\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Probe OpenSLR AISHELL-3 dataset adapter")
    parser.add_argument(
        "command",
        choices=("materialize", "stats", "join-audit", "accept"),
        help="materialize | stats | join-audit | accept",
    )
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    parser.add_argument("--openslr-tgz", default=None)
    parser.add_argument("--local-audio-root", default=None)
    parser.add_argument("--textgrid-zip", default=None)
    parser.add_argument("--local-textgrid-root", default=None)
    parser.add_argument("--max-utterances", type=int, default=None)
    parser.add_argument("--max-speakers", type=int, default=None)
    parser.add_argument("--speaker-ids", default=None, help="Comma-separated SSB speaker ids")
    parser.add_argument("--json-out", default=None)
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Do not download archives when local paths/archives are missing",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "materialize":
        report = cmd_materialize(args)
        exit_code = 0
    elif args.command == "join-audit":
        report = cmd_join_audit(args)
        exit_code = 0
    elif args.command == "accept":
        report = cmd_accept(args)
        exit_code = 0 if report.get("final_verdict") in ("PASS", "CONDITIONAL PASS") else 1
    else:
        report = cmd_stats(args)
        exit_code = 0
    _emit_report(report, args.json_out)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
