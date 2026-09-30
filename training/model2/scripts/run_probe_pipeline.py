#!/usr/bin/env python3
"""Run Synthetic / TTS Dataset Probe Pipeline V1 (real Piper + FW ASR)."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import traceback
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.adapters.faster_whisper_client import (  # noqa: E402
    AsrUnavailableError,
    FasterWhisperClient,
)
from training.model2.adapters.piper_tts_client import (  # noqa: E402
    PiperUnavailableError,
    PiperTtsClient,
)
from training.model2.alignment.align import align_codepoints  # noqa: E402
from training.model2.constants import (  # noqa: E402
    DATASET_ID,
    DEFAULT_ASR_SAMPLE_RATE,
    GENERATOR_VERSION,
    PHONETIC_SCHEMA_VERSION,
)
from training.model2.corruption.bank import (  # noqa: E402
    CORRUPTION_BANK_VERSION,
    apply_corruption,
    read_wav_pcm16,
    resample_audio,
    resolve_spec,
    wav_bytes_pcm16,
    write_wav_pcm16,
)
from training.model2.export.sample_builder import (  # noqa: E402
    build_hard_negative,
    build_rule_synthetic_pair,
    build_samples_from_asr,
)
from training.model2.export.training_sample import SyntheticMetadataV1  # noqa: E402


def _load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--plan",
        type=Path,
        default=REPO_ROOT / "training" / "model2" / "dataset" / "probe_v1" / "probe_plan.jsonl",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training" / "model2" / "dataset" / "probe_v1",
    )
    ap.add_argument("--limit", type=int, default=0, help="0 = all plans")
    ap.add_argument("--keep-failed-wav", action="store_true", default=True)
    ap.add_argument("--keep-qa-every", type=int, default=40)
    ap.add_argument("--tts-url", default="http://127.0.0.1:5009")
    ap.add_argument("--asr-url", default="http://127.0.0.1:6007")
    ap.add_argument("--dry-lock-only", action="store_true")
    args = ap.parse_args()

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = out_dir / "tmp_audio"
    qa_dir = out_dir / "qa_audio"
    fail_dir = out_dir / "failed_audio"
    for d in (tmp_dir, qa_dir, fail_dir):
        d.mkdir(parents=True, exist_ok=True)

    tts = PiperTtsClient(base_url=args.tts_url)
    asr = FasterWhisperClient(base_url=args.asr_url)

    try:
        tts_lock = tts.lock_config()
        asr_lock = asr.lock_config()
    except (PiperUnavailableError, AsrUnavailableError) as e:
        report = {
            "status": "BLOCKED",
            "reason": str(e),
            "note": "Real TTS/ASR required for Probe PASS; unit tests alone are insufficient.",
        }
        (out_dir / "probe_e2e_status.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 3

    lock = {
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "phonetic_schema_version": PHONETIC_SCHEMA_VERSION,
        "corruption_bank_version": CORRUPTION_BANK_VERSION,
        "tone_stage": "NOT_RUN",
        "tts": tts_lock,
        "asr": asr_lock,
    }
    (out_dir / "service_lock.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("TTS lock:", json.dumps({k: tts_lock[k] for k in tts_lock if k != "tts_health"}, ensure_ascii=False))
    print("ASR lock:", json.dumps({k: asr_lock[k] for k in asr_lock if k != "asr_health"}, ensure_ascii=False))
    if args.dry_lock_only:
        return 0

    plans = _load_jsonl(args.plan)
    if args.limit and args.limit > 0:
        plans = plans[: args.limit]

    results_path = out_dir / "probe_results.jsonl"
    samples_path = out_dir / "training_samples.jsonl"
    # Truncate for fresh run
    results_f = results_path.open("w", encoding="utf-8")
    samples_f = samples_path.open("w", encoding="utf-8")

    stats = Counter()
    corr_errors: dict[str, Counter] = defaultdict(Counter)
    term_errors: Counter = Counter()
    lat_tts: list[float] = []
    lat_asr: list[float] = []
    peak_tmp_bytes = 0
    t_wall0 = time.perf_counter()

    # Optional tiny RULE_SYNTHETIC smoke (isolated)
    rule = build_rule_synthetic_pair(
        sample_plan_id="rule-smoke-001",
        source_span="兰宁",
        target_span="南宁",
        context="我想去兰宁",
        pseudo_user_group_id="pseudo-g00",
        domain="tourism_route",
    )
    samples_f.write(json.dumps(rule.to_dict(), ensure_ascii=False) + "\n")
    stats["rule_synthetic"] += 1

    try:
        for i, plan in enumerate(plans):
            spid = plan["sample_plan_id"]
            stats["planned"] += 1
            row: dict = {
                "sample_plan_id": spid,
                "split": plan["split"],
                "gt_text": plan["gt_text"],
                "status": "ok",
                "failure_reason": None,
            }
            wav_path = tmp_dir / f"{spid}.wav"
            corr_path = tmp_dir / f"{spid}.corr.wav"
            try:
                synth = tts.synthesize(plan["gt_text"], voice=plan["tts_voice"])
                lat_tts.append(synth.latency_ms)
                stats["tts_ok"] += 1
                audio_native, sr_native = read_wav_pcm16(synth.wav_bytes)
                # Production ASR contract is 16 kHz mono (dialog_200 precedent).
                audio = resample_audio(audio_native, sr_native, DEFAULT_ASR_SAMPLE_RATE)
                sr = DEFAULT_ASR_SAMPLE_RATE
                write_wav_pcm16(wav_path, audio, sr)
                spec = resolve_spec(plan["corruption_strategy"], plan["corruption_level"])
                corrupted, corr_meta = apply_corruption(
                    audio, sr, spec, seed=int(plan["seed"]), sample_plan_id=spid
                )
                corr_meta["tts_native_sample_rate"] = sr_native
                corr_meta["asr_sample_rate"] = sr
                corr_bytes = wav_bytes_pcm16(corrupted, sr)
                write_wav_pcm16(corr_path, corrupted, sr)
                peak_tmp_bytes = max(peak_tmp_bytes, wav_path.stat().st_size + corr_path.stat().st_size)

                hyp = asr.transcribe_wav(corr_bytes, job_id=spid)
                lat_asr.append(hyp.latency_ms)
                stats["asr_ok"] += 1
                hyp_text = hyp.text
                row["asr_hyp"] = hyp_text
                row["asr_duration"] = hyp.duration
                row["asr_word_count"] = len(hyp.words)
                row["tts_latency_ms"] = synth.latency_ms
                row["asr_latency_ms"] = hyp.latency_ms
                row["corruption"] = corr_meta

                exact = "".join(hyp_text.split()) == "".join(plan["gt_text"].split())
                stats["asr_exact" if exact else "asr_error"] += 1
                ck = f"{plan['corruption_strategy']}:{plan['corruption_level']}"
                corr_errors[ck]["n"] += 1
                if not exact:
                    corr_errors[ck]["err"] += 1
                    if plan.get("target_term"):
                        term_errors[plan["target_term"]] += 1

                spans = align_codepoints(hyp_text, plan["gt_text"])
                row["alignment_spans"] = [s.to_dict() for s in spans]
                stats["align_ok"] += 1

                synth_meta = SyntheticMetadataV1(
                    generator_version=GENERATOR_VERSION,
                    source_type="TTS_ASR_SYNTHETIC",
                    source_text_corpus="carrier_templates_v1+lexicon_v3",
                    tts_service_id=tts_lock.get("tts_service_id"),
                    tts_model_id=tts_lock.get("tts_model_id"),
                    tts_model_version=tts_lock.get("tts_model_sha256"),
                    tts_voice_id=plan["tts_voice"],
                    tts_sample_rate=synth.sample_rate,
                    asr_service_id=asr_lock.get("asr_service_id"),
                    asr_model_id=asr_lock.get("asr_model_id"),
                    asr_model_version=asr_lock.get("asr_model_path"),
                    asr_compute_type=asr_lock.get("asr_compute_type"),
                    corruption_strategy=ck,
                    corruption_parameters=corr_meta,
                    random_seed=int(plan["seed"]),
                    audio_manifest_id=spid,
                    pseudo_user_group_id=plan["pseudo_user_group_id"],
                    target_term=plan.get("target_term"),
                    domain_tags=[plan["domain"]] if plan.get("domain") else None,
                    tone_stage="NOT_RUN",
                    phonetic_profile_not_acoustically_realized=True,
                )
                samples = build_samples_from_asr(
                    sample_plan_id=spid,
                    gt_text=plan["gt_text"],
                    hyp_text=hyp_text,
                    target_term=plan.get("target_term"),
                    domain=plan.get("domain"),
                    pseudo_user_group_id=plan["pseudo_user_group_id"],
                    synthetic_meta=synth_meta,
                    target_pinyin=plan.get("pinyin_key"),
                )
                kinds = []
                for s in samples:
                    samples_f.write(json.dumps(s.to_dict(), ensure_ascii=False) + "\n")
                    kinds.append(s.metadata.sample_kind.value)
                    stats[f"kind_{s.metadata.sample_kind.value}"] += 1

                # Hard-negative: personal term not in utterance
                for pt in plan.get("personal_terms") or []:
                    hn = build_hard_negative(
                        sample_plan_id=spid,
                        hyp_text=hyp_text,
                        biased_term=pt,
                        domain=plan.get("domain"),
                        pseudo_user_group_id=plan["pseudo_user_group_id"],
                        synthetic_meta=synth_meta,
                    )
                    if hn is not None:
                        samples_f.write(json.dumps(hn.to_dict(), ensure_ascii=False) + "\n")
                        kinds.append("HARD_NEGATIVE")
                        stats["kind_HARD_NEGATIVE"] += 1
                        break  # one HN per utterance for probe

                row["sample_kinds"] = kinds
                row["training_sample_count"] = len(kinds)

                # Audio lifecycle
                keep_qa = args.keep_qa_every > 0 and (i % args.keep_qa_every == 0)
                if keep_qa:
                    shutil.copy2(corr_path, qa_dir / corr_path.name)
                    stats["qa_kept"] += 1
                wav_path.unlink(missing_ok=True)
                corr_path.unlink(missing_ok=True)
                stats["tmp_cleaned"] += 1
            except Exception as e:
                stats["failed"] += 1
                row["status"] = "failed"
                row["failure_reason"] = f"{type(e).__name__}: {e}"
                row["traceback"] = traceback.format_exc(limit=5)
                if args.keep_failed_wav:
                    for p in (wav_path, corr_path):
                        if p.exists():
                            shutil.copy2(p, fail_dir / p.name)
                wav_path.unlink(missing_ok=True)
                corr_path.unlink(missing_ok=True)
            results_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            results_f.flush()
            if (i + 1) % 10 == 0:
                print(f"progress {i+1}/{len(plans)} stats={dict(stats)}")
    finally:
        results_f.close()
        samples_f.close()

    wall_s = time.perf_counter() - t_wall0
    planned = max(1, stats["planned"])
    metrics = {
        "status": "PASS" if stats["failed"] == 0 and stats["tts_ok"] > 0 else "PARTIAL",
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "planned_samples": stats["planned"],
        "tts_success_rate": stats["tts_ok"] / planned,
        "asr_success_rate": stats["asr_ok"] / planned,
        "alignment_success_rate": stats["align_ok"] / planned,
        "positive_count": stats.get("kind_POSITIVE", 0),
        "negative_count": stats.get("kind_NEGATIVE", 0),
        "hard_negative_count": stats.get("kind_HARD_NEGATIVE", 0),
        "rule_synthetic_count": stats.get("rule_synthetic", 0),
        "asr_exact_match_rate": stats["asr_exact"] / max(1, stats["asr_ok"]),
        "asr_error_rate": stats["asr_error"] / max(1, stats["asr_ok"]),
        "positive_yield": stats.get("kind_POSITIVE", 0) / max(1, stats["asr_ok"]),
        "corruption_error_stats": {
            k: {
                "n": v["n"],
                "err": v["err"],
                "error_rate": v["err"] / max(1, v["n"]),
            }
            for k, v in corr_errors.items()
        },
        "term_error_top": term_errors.most_common(20),
        "tts_latency_ms_avg": sum(lat_tts) / max(1, len(lat_tts)),
        "asr_latency_ms_avg": sum(lat_asr) / max(1, len(lat_asr)),
        "wall_seconds": wall_s,
        "tmp_disk_peak_bytes": peak_tmp_bytes,
        "failed": stats["failed"],
        "service_lock": lock,
        "counts": dict(stats),
    }
    # Positive yield gate annotation
    if metrics["positive_count"] < max(5, int(0.05 * stats["asr_ok"])):
        metrics["positive_yield_gate"] = "DATA_GAP"
        if metrics["status"] == "PASS":
            metrics["status"] = "PASS_WITH_DATA_GAP"
    else:
        metrics["positive_yield_gate"] = "OK"

    (out_dir / "probe_metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: metrics[k] for k in metrics if k != "service_lock"}, ensure_ascii=False, indent=2))
    return 0 if metrics["status"] in ("PASS", "PASS_WITH_DATA_GAP", "PARTIAL") and stats["tts_ok"] else 4


def _pcm_from_wav(wav_bytes: bytes):
    audio, sr = read_wav_pcm16(wav_bytes)
    return audio, sr


if __name__ == "__main__":
    raise SystemExit(main())
