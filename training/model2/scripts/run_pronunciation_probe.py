#!/usr/bin/env python3
"""Run Pronunciation-Corrupted TTS probe: TTSInput → Piper → production ASR."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import traceback
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.adapters.faster_whisper_client import AsrUnavailableError, FasterWhisperClient
from training.model2.adapters.piper_tts_client import PiperUnavailableError, PiperTtsClient
from training.model2.alignment.align import align_codepoints
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE, GENERATOR_VERSION, PHONETIC_SCHEMA_VERSION
from training.model2.corruption.bank import read_wav_pcm16, resample_audio, wav_bytes_pcm16, write_wav_pcm16
from training.model2.export.sample_builder import build_samples_from_asr
from training.model2.export.training_sample import SyntheticMetadataV1
from training.model2.pronunciation.validation import classify_realization

DATASET_ID = "model2-pronunciation-corrupted-probe-v1"


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
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
        default=REPO_ROOT / "training/model2/dataset/pronunciation_corrupted_probe_v1/plan.jsonl",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pronunciation_corrupted_probe_v1",
    )
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tts-url", default="http://127.0.0.1:5009")
    ap.add_argument("--asr-url", default="http://127.0.0.1:6007")
    ap.add_argument("--keep-qa-every", type=int, default=25)
    args = ap.parse_args()

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = out_dir / "tmp_audio"
    qa_dir = out_dir / "qa_audio"
    for d in (tmp_dir, qa_dir):
        d.mkdir(parents=True, exist_ok=True)

    tts = PiperTtsClient(base_url=args.tts_url)
    asr = FasterWhisperClient(base_url=args.asr_url)
    try:
        tts_lock = tts.lock_config()
        asr_lock = asr.lock_config()
    except (PiperUnavailableError, AsrUnavailableError) as e:
        print(json.dumps({"status": "BLOCKED", "reason": str(e)}))
        return 3

    lock = {
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "phonetic_schema_version": PHONETIC_SCHEMA_VERSION,
        "tone_stage": "NOT_RUN",
        "corruption_locus": "BEFORE_TTS",
        "tts": tts_lock,
        "asr": asr_lock,
        "markers": ["PRONUNCIATION_CORRUPTED_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
        "piper_phoneme_http": False,
        "note": "ASRHypothesis always from production ASR; never manually rewritten.",
    }
    (out_dir / "service_lock.json").write_text(json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8")

    plans = _load_jsonl(args.plan)
    if args.limit and args.limit > 0:
        plans = plans[: args.limit]

    results_path = out_dir / "results.jsonl"
    samples_path = out_dir / "training_samples.jsonl"
    done = {r["sample_plan_id"] for r in _load_jsonl(results_path) if r.get("status") == "ok"}
    results_f = results_path.open("a", encoding="utf-8")
    samples_f = samples_path.open("a", encoding="utf-8")

    stats = Counter()
    lat_tts: list[float] = []
    lat_asr: list[float] = []
    t0 = time.perf_counter()

    try:
        pending = [p for p in plans if p["sample_plan_id"] not in done]
        print(f"resume: done={len(done)} pending={len(pending)}", flush=True)
        for i, plan in enumerate(pending):
            spid = plan["sample_plan_id"]
            stats["planned"] += 1
            gt_text = plan["gt_text"]
            tts_input = plan["tts_input_text"]
            # Hard invariant: never synthesize from a hand-written ASR hypothesis
            assert tts_input, "tts_input_text required"
            assert plan.get("source_type") in (
                "TTS_PRONUNCIATION_CORRUPTED",
                "TTS_ASR_SYNTHETIC",
            )

            row: dict = {
                "sample_plan_id": spid,
                "split": plan.get("split"),
                "ground_truth_text": gt_text,
                "tts_input_text": tts_input,
                "corruption_applied": bool(plan.get("corruption_applied")),
                "corruption_family": plan.get("corruption_family"),
                "status": "ok",
                "failure_reason": None,
            }
            wav_path = tmp_dir / f"{spid}.wav"
            try:
                # CRITICAL: synthesize TTSInputText, not GroundTruth when corrupted
                synth = tts.synthesize(tts_input, voice=plan.get("tts_voice"))
                lat_tts.append(synth.latency_ms)
                stats["tts_ok"] += 1
                audio_native, sr_native = read_wav_pcm16(synth.wav_bytes)
                audio = resample_audio(audio_native, sr_native, DEFAULT_ASR_SAMPLE_RATE)
                sr = DEFAULT_ASR_SAMPLE_RATE
                write_wav_pcm16(wav_path, audio, sr)
                # No acoustic noise bank — isolate pronunciation corruption effect
                hyp = asr.transcribe_wav(wav_bytes_pcm16(audio, sr), job_id=spid)
                lat_asr.append(hyp.latency_ms)
                stats["asr_ok"] += 1
                hyp_text = hyp.text  # MUST remain unmodified
                row["asr_hypothesis"] = hyp_text
                row["tts_latency_ms"] = synth.latency_ms
                row["asr_latency_ms"] = hyp.latency_ms
                exact_gt = "".join(hyp_text.split()) == "".join(gt_text.split())
                exact_tts = "".join(hyp_text.split()) == "".join(tts_input.split())
                stats["asr_matches_gt" if exact_gt else "asr_differs_gt"] += 1
                stats["asr_matches_tts_input" if exact_tts else "asr_differs_tts_input"] += 1
                spans = align_codepoints(hyp_text, gt_text)
                row["alignment_spans"] = [s.to_dict() for s in spans]

                realization_status = "NO_ASR_EFFECT"
                phon_realized = False
                if plan.get("corruption_applied"):
                    rr = classify_realization(
                        ground_truth_term=plan["target_term"],
                        intended_corrupted_syllables=plan.get("intended_corrupted_syllables") or [],
                        asr_hypothesis=hyp_text,
                        corruption_family=plan["corruption_family"],
                    )
                    realization_status = rr.status
                    phon_realized = realization_status in (
                        "REALIZED_AS_INTENDED",
                        "REALIZED_DIFFERENTLY",
                    )
                    row["realization"] = {
                        "status": rr.status,
                        "asr_syllables": rr.asr_syllables,
                        "intended": rr.intended,
                        "notes": rr.notes,
                    }
                    stats[f"realization_{rr.status}"] += 1
                    if not exact_gt:
                        stats["asr_error_given_corruption"] += 1
                else:
                    row["realization"] = {"status": "CONTROL_NO_CORRUPTION"}
                    stats["control"] += 1

                source_type = (
                    "TTS_PRONUNCIATION_CORRUPTED"
                    if plan.get("corruption_applied")
                    else "TTS_ASR_SYNTHETIC"
                )
                synth_meta = SyntheticMetadataV1(
                    generator_version=GENERATOR_VERSION,
                    source_type=source_type,
                    source_text_corpus="carrier_templates_v2+lexicon_v3+pronunciation_corruptor_v1",
                    tts_service_id=tts_lock.get("tts_service_id"),
                    tts_model_id=tts_lock.get("tts_model_id"),
                    tts_model_version=tts_lock.get("tts_model_sha256"),
                    tts_voice_id=plan.get("tts_voice"),
                    tts_sample_rate=synth.sample_rate,
                    asr_service_id=asr_lock.get("asr_service_id"),
                    asr_model_id=asr_lock.get("asr_model_id"),
                    asr_model_version=asr_lock.get("asr_model_path"),
                    asr_compute_type=asr_lock.get("asr_compute_type"),
                    corruption_strategy=(
                        f"pronunciation_before_tts:{plan.get('corruption_family')}"
                        if plan.get("corruption_applied")
                        else "none_control"
                    ),
                    corruption_parameters={
                        "locus": "BEFORE_TTS",
                        "family": plan.get("corruption_family"),
                        "intended_corrupted_syllables": plan.get("intended_corrupted_syllables"),
                        "tts_surface": plan.get("tts_surface"),
                    },
                    random_seed=int(plan.get("seed") or 0),
                    audio_manifest_id=spid,
                    pseudo_user_group_id=plan["pseudo_user_group_id"],
                    target_term=plan.get("target_term"),
                    domain_tags=[plan["domain"]] if plan.get("domain") else None,
                    tone_stage="NOT_RUN",
                    phonetic_profile_not_acoustically_realized=not phon_realized,
                    phonetic_profile_acoustically_realized=phon_realized,
                    ground_truth_text=gt_text,
                    tts_input_text=tts_input,
                    corruption_family=plan.get("corruption_family"),
                    corruption_direction=plan.get("corruption_direction"),
                    target_original_syllables=plan.get("target_original_syllables"),
                    intended_corrupted_syllables=plan.get("intended_corrupted_syllables"),
                    tts_surface=plan.get("tts_surface"),
                    tts_surface_resolution_method=plan.get("tts_surface_resolution_method"),
                    tts_surface_resolver_version=plan.get("tts_surface_resolver_version"),
                    realization_status=realization_status,
                    pseudo_user_id=plan.get("pseudo_user_id"),
                )
                samples = build_samples_from_asr(
                    sample_plan_id=spid,
                    gt_text=gt_text,
                    hyp_text=hyp_text,
                    target_term=plan.get("target_term"),
                    domain=plan.get("domain"),
                    pseudo_user_group_id=plan["pseudo_user_group_id"],
                    synthetic_meta=synth_meta,
                    target_pinyin=plan.get("pinyin_key"),
                )
                kinds = []
                for s in samples:
                    # Provenance invariant: ASR never manually overridden
                    samples_f.write(json.dumps(s.to_dict(), ensure_ascii=False) + "\n")
                    kinds.append(s.metadata.sample_kind.value)
                    stats[f"kind_{s.metadata.sample_kind.value}"] += 1
                row["sample_kinds"] = kinds
                row["phonetic_profile_acoustically_realized"] = phon_realized

                if args.keep_qa_every > 0 and (i % args.keep_qa_every == 0):
                    shutil.copy2(wav_path, qa_dir / wav_path.name)
                wav_path.unlink(missing_ok=True)
            except Exception as e:
                stats["failed"] += 1
                row["status"] = "failed"
                row["failure_reason"] = f"{type(e).__name__}: {e}"
                row["traceback"] = traceback.format_exc(limit=4)
                wav_path.unlink(missing_ok=True)
            results_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            results_f.flush()
            samples_f.flush()
            if (i + 1) % 10 == 0:
                print(f"progress {i+1}/{len(pending)} stats={dict(stats)}", flush=True)
    finally:
        results_f.close()
        samples_f.close()

    wall = time.perf_counter() - t0
    summary = {
        "dataset_id": DATASET_ID,
        "stats": dict(stats),
        "wall_s": wall,
        "tts_avg_ms": sum(lat_tts) / max(1, len(lat_tts)),
        "asr_avg_ms": sum(lat_asr) / max(1, len(lat_asr)),
    }
    (out_dir / "run_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if stats.get("failed", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
