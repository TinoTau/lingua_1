#!/usr/bin/env python3
"""Run Training Scale TTS/ASR pipeline (real Piper + FW). Does not overwrite probe_v1."""

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

from training.model2.adapters.faster_whisper_client import AsrUnavailableError, FasterWhisperClient
from training.model2.adapters.piper_tts_client import PiperUnavailableError, PiperTtsClient
from training.model2.alignment.align import align_codepoints
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE, GENERATOR_VERSION, PHONETIC_SCHEMA_VERSION
from training.model2.corruption.bank import (
    CORRUPTION_BANK_VERSION,
    apply_corruption,
    read_wav_pcm16,
    resample_audio,
    resolve_spec,
    wav_bytes_pcm16,
    write_wav_pcm16,
)
from training.model2.export.sample_builder import (
    build_hard_negative,
    build_rule_synthetic_pair,
    build_samples_from_asr,
)
from training.model2.export.training_sample import SyntheticMetadataV1

DATASET_ID = "model2-synth-scale-v1"


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
        default=REPO_ROOT / "training/model2/dataset/training_scale_v1/plan.jsonl",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/training_scale_v1",
    )
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tts-url", default="http://127.0.0.1:5009")
    ap.add_argument("--asr-url", default="http://127.0.0.1:6007")
    ap.add_argument("--keep-qa-every", type=int, default=80)
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
        print(json.dumps({"status": "BLOCKED", "reason": str(e)}))
        return 3

    lock = {
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "phonetic_schema_version": PHONETIC_SCHEMA_VERSION,
        "corruption_bank_version": CORRUPTION_BANK_VERSION,
        "tone_stage": "NOT_RUN",
        "tts": tts_lock,
        "asr": asr_lock,
        "markers": ["TRAINING_SCALE_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
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
    corr_errors: dict[str, Counter] = defaultdict(Counter)
    lat_tts: list[float] = []
    lat_asr: list[float] = []
    t_wall0 = time.perf_counter()

    # RULE_SYNTHETIC isolated — write once if samples file is new/empty of RULE
    rule_plans = _load_jsonl(out_dir / "rule_plan.jsonl")
    existing_samples = _load_jsonl(samples_path) if samples_path.exists() else []
    have_rule = any(
        (s.get("metadata") or {}).get("source_type") == "RULE_SYNTHETIC" for s in existing_samples
    )
    if rule_plans and not have_rule:
        for rp in rule_plans:
            sample = build_rule_synthetic_pair(
                sample_plan_id=rp["sample_plan_id"],
                source_span=rp["source_span"],
                target_span=rp["target_term"],
                context=rp["hyp_text"],
                pseudo_user_group_id=rp["pseudo_user_group_id"],
                domain=rp.get("domain"),
            )
            samples_f.write(json.dumps(sample.to_dict(), ensure_ascii=False) + "\n")
            stats["rule_synthetic"] += 1
        samples_f.flush()

    try:
        pending = [p for p in plans if p["sample_plan_id"] not in done]
        print(f"resume: done={len(done)} pending={len(pending)}", flush=True)
        for i, plan in enumerate(pending):
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
                audio = resample_audio(audio_native, sr_native, DEFAULT_ASR_SAMPLE_RATE)
                sr = DEFAULT_ASR_SAMPLE_RATE
                write_wav_pcm16(wav_path, audio, sr)
                spec = resolve_spec(plan["corruption_strategy"], plan["corruption_level"])
                corrupted, corr_meta = apply_corruption(
                    audio, sr, spec, seed=int(plan["seed"]), sample_plan_id=spid
                )
                corr_bytes = wav_bytes_pcm16(corrupted, sr)
                write_wav_pcm16(corr_path, corrupted, sr)
                hyp = asr.transcribe_wav(corr_bytes, job_id=spid)
                lat_asr.append(hyp.latency_ms)
                stats["asr_ok"] += 1
                hyp_text = hyp.text
                row["asr_hyp"] = hyp_text
                row["tts_latency_ms"] = synth.latency_ms
                row["asr_latency_ms"] = hyp.latency_ms
                row["corruption"] = corr_meta
                exact = "".join(hyp_text.split()) == "".join(plan["gt_text"].split())
                stats["asr_exact" if exact else "asr_error"] += 1
                spans = align_codepoints(hyp_text, plan["gt_text"])
                row["alignment_spans"] = [s.to_dict() for s in spans]
                synth_meta = SyntheticMetadataV1(
                    generator_version=GENERATOR_VERSION,
                    source_type="TTS_ASR_SYNTHETIC",
                    source_text_corpus="carrier_templates_v2+lexicon_v3",
                    tts_service_id=tts_lock.get("tts_service_id"),
                    tts_model_id=tts_lock.get("tts_model_id"),
                    tts_model_version=tts_lock.get("tts_model_sha256"),
                    tts_voice_id=plan["tts_voice"],
                    tts_sample_rate=synth.sample_rate,
                    asr_service_id=asr_lock.get("asr_service_id"),
                    asr_model_id=asr_lock.get("asr_model_id"),
                    asr_model_version=asr_lock.get("asr_model_path"),
                    asr_compute_type=asr_lock.get("asr_compute_type"),
                    corruption_strategy=f"{plan['corruption_strategy']}:{plan['corruption_level']}",
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
                    nt = (s.metadata.synthetic or {}).get("negative_type")
                    if nt:
                        stats[f"neg_{nt}"] += 1
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
                        break
                row["sample_kinds"] = kinds
                keep_qa = args.keep_qa_every > 0 and (i % args.keep_qa_every == 0)
                if keep_qa:
                    shutil.copy2(corr_path, qa_dir / corr_path.name)
                wav_path.unlink(missing_ok=True)
                corr_path.unlink(missing_ok=True)
            except Exception as e:
                stats["failed"] += 1
                row["status"] = "failed"
                row["failure_reason"] = f"{type(e).__name__}: {e}"
                row["traceback"] = traceback.format_exc(limit=4)
                wav_path.unlink(missing_ok=True)
                corr_path.unlink(missing_ok=True)
            results_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            results_f.flush()
            samples_f.flush()
            if (i + 1) % 20 == 0:
                print(f"progress {i+1}/{len(pending)} stats={dict(stats)}", flush=True)
    finally:
        results_f.close()
        samples_f.close()

    wall_s = time.perf_counter() - t_wall0
    planned = max(1, stats["planned"])
    metrics = {
        "status": "PASS" if stats["failed"] == 0 and stats["tts_ok"] > 0 else "PARTIAL",
        "dataset_id": DATASET_ID,
        "planned_this_run": stats["planned"],
        "tts_ok": stats["tts_ok"],
        "asr_ok": stats["asr_ok"],
        "failed": stats["failed"],
        "asr_exact_match_rate": stats["asr_exact"] / max(1, stats["asr_ok"]),
        "positive_count": stats.get("kind_POSITIVE", 0),
        "negative_count": stats.get("kind_NEGATIVE", 0),
        "hard_negative_count": stats.get("kind_HARD_NEGATIVE", 0),
        "n1": stats.get("neg_N1", 0),
        "n2": stats.get("neg_N2", 0),
        "rule_synthetic_count": stats.get("rule_synthetic", 0),
        "tts_latency_ms_avg": sum(lat_tts) / max(1, len(lat_tts)),
        "asr_latency_ms_avg": sum(lat_asr) / max(1, len(lat_asr)),
        "wall_seconds": wall_s,
        "counts": dict(stats),
        "markers": lock["markers"],
    }
    (out_dir / "generation_metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    return 0 if stats["tts_ok"] else 4


if __name__ == "__main__":
    raise SystemExit(main())
