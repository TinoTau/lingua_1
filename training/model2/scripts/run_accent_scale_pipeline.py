#!/usr/bin/env python3
"""Run PseudoUser Accent Scale TTS/ASR (real Piper HTTP + production ASR)."""

from __future__ import annotations

import argparse
import json
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
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE, DEFAULT_TTS_VOICE, GENERATOR_VERSION, PHONETIC_SCHEMA_VERSION
from training.model2.corruption.bank import read_wav_pcm16, resample_audio, wav_bytes_pcm16
from training.model2.export.sample_builder import build_samples_from_asr
from training.model2.export.training_sample import SyntheticMetadataV1
from training.model2.pronunciation.phoneme_realizer import PhonemeRealizer
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable
from training.model2.pronunciation.realizer import PronunciationRealizer
from training.model2.pronunciation.span_alignment import align_corruption_spans
from training.model2.pronunciation.surface_realizer import ChineseSurfaceRealizer
from training.model2.pronunciation.tts_surface_resolver import TtsPronunciationSurfaceMapV1
from training.model2.pronunciation.validation_v2 import classify_realization_v2

DATASET_ID = "model2-pseudo-user-accent-scale-v1"


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def _eligibility(align, rv2, corruption_planned: bool) -> str:
    if not corruption_planned:
        if align.reason == "asr_recovered_gt_term" or (align.asr_span and align.gt_span in (align.asr_span or "")):
            return "ELIGIBLE_NO_CHANGE"
        return "ELIGIBLE_NO_CHANGE"
    if rv2.status in ("TTS_REALIZATION_FAILED",) or not (rv2.base_realized or rv2.differently_realized or rv2.full_realized):
        if align.reason == "asr_recovered_gt_term":
            return "INELIGIBLE_REALIZATION"
    if align.associated_with_corruption and align.model2_term_training_eligible:
        return "ELIGIBLE_PRONUNCIATION_POSITIVE"
    if not align.model2_term_training_eligible and align.associated_with_corruption:
        return "INELIGIBLE_NON_TERM"
    if not align.associated_with_corruption:
        return "INELIGIBLE_ALIGNMENT"
    return "INELIGIBLE_ALIGNMENT"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--plan",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1/generation_plan.jsonl",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1",
    )
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tts-url", default="http://127.0.0.1:5009")
    ap.add_argument("--asr-url", default="http://127.0.0.1:6007")
    ap.add_argument("--require-http-phoneme", action="store_true", default=True)
    ap.add_argument("--dataset-id", type=str, default="")
    args = ap.parse_args()
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    dataset_id = args.dataset_id or (
        "model2-baseline-dataset-v1" if "baseline" in str(out_dir).lower() else DATASET_ID
    )

    tts = PiperTtsClient(base_url=args.tts_url)
    asr = FasterWhisperClient(base_url=args.asr_url)
    try:
        tts_lock = tts.lock_config()
        asr_lock = asr.lock_config()
    except (PiperUnavailableError, AsrUnavailableError) as e:
        print(json.dumps({"status": "BLOCKED", "reason": str(e)}))
        return 3

    # Require training-only phoneme HTTP
    phoneme = PhonemeRealizer(base_url=args.tts_url, voice=DEFAULT_TTS_VOICE, prefer_http=True)
    if args.require_http_phoneme and not phoneme._http_available():
        print(json.dumps({"status": "BLOCKED", "reason": "tts-phonemize HTTP unavailable; restart Piper"}))
        return 3

    v1_map = REPO_ROOT / "training/model2/dataset/pronunciation_corrupted_probe_v1/surface_map.json"
    surface_map = TtsPronunciationSurfaceMapV1.load(v1_map) if v1_map.exists() else TtsPronunciationSurfaceMapV1()
    realizer = PronunciationRealizer(
        surface=ChineseSurfaceRealizer(surface_map),
        phoneme=phoneme,
    )

    lock = {
        "dataset_id": dataset_id,
        "generator_version": GENERATOR_VERSION,
        "phonetic_schema_version": PHONETIC_SCHEMA_VERSION,
        "transform_engine": "pronunciation-transform-engine-v1",
        "realizer": "pronunciation-realizer-v1",
        "surface_map": "tts-surface-resolver-v1 / surface-map-v2",
        "phoneme_realizer": "phoneme-realizer-v1",
        "phoneme_http_required": True,
        "production_tts_unchanged": True,
        "tone_diagnostic": "DEFERRED",
        "tts": tts_lock,
        "asr": asr_lock,
        "markers": ["PSEUDO_USER_ACCENT_SCALE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
    }
    (out_dir / "service_lock.json").write_text(json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8")

    plans = _load_jsonl(args.plan)
    if args.limit:
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
            gt = plan["gt_text"]
            term = plan["target_term"]
            fam = plan["family"]
            cans = [PronunciationSyllable(**d) for d in (plan.get("canonical_syllables") or [])]
            mask = [False] * len(cans)
            for idx in plan.get("selected_positions") or []:
                if 0 <= idx < len(mask):
                    mask[idx] = True

            row: dict = {
                "sample_plan_id": spid,
                "pseudo_user_id": plan["pseudo_user_id"],
                "split": plan["split"],
                "family": fam,
                "intended_strength": plan.get("intended_strength"),
                "corruption_planned": bool(plan.get("corruption_planned")),
                "is_paired_control": bool(plan.get("is_paired_control")),
                "ground_truth_text": gt,
                "target_term": term,
                "status": "ok",
            }

            try:
                # Always synthesize canonical for paired controls; otherwise only when no corruption
                hyp_can = None
                if plan.get("is_paired_control") or not plan.get("corruption_planned"):
                    t_a = time.perf_counter()
                    synth_c = tts.synthesize(gt, voice=plan.get("tts_voice") or DEFAULT_TTS_VOICE)
                    lat_tts.append((time.perf_counter() - t_a) * 1000)
                    audio_c, sr_c = read_wav_pcm16(synth_c.wav_bytes)
                    t_b = time.perf_counter()
                    hyp_can = asr.transcribe_wav(
                        wav_bytes_pcm16(
                            resample_audio(audio_c, sr_c, DEFAULT_ASR_SAMPLE_RATE), DEFAULT_ASR_SAMPLE_RATE
                        ),
                        job_id=f"{spid}-can",
                    ).text
                    lat_asr.append((time.perf_counter() - t_b) * 1000)
                    stats["canonical_ok"] += 1
                    row["canonical_asr_text"] = hyp_can

                hyp = hyp_can
                backend = "CANONICAL"
                tts_input = gt
                rplan = None
                rv2 = None
                align = None
                phon_realized = False

                if plan.get("corruption_planned") and any(mask):
                    rplan = realizer.realize_term_corruption(
                        ground_truth_text=gt,
                        ground_truth_term=term,
                        family=fam,
                        canonical_syllables=cans,
                        apply_mask=mask,
                        force_phoneme=bool(plan.get("force_phoneme")),
                    )
                    backend = rplan.backend
                    tts_input = rplan.tts_input_text
                    t_a = time.perf_counter()
                    if rplan.backend == "CHINESE_SURFACE":
                        synth = tts.synthesize(rplan.tts_input_text, voice=plan.get("tts_voice") or DEFAULT_TTS_VOICE)
                        wav = synth.wav_bytes
                    elif rplan.backend == "PHONEME" and rplan.phoneme_result and rplan.phoneme_result.wav_bytes:
                        wav = rplan.phoneme_result.wav_bytes
                    else:
                        raise RuntimeError(rplan.notes or "unrealizable")
                    lat_tts.append((time.perf_counter() - t_a) * 1000)
                    audio, sr = read_wav_pcm16(wav)
                    t_b = time.perf_counter()
                    hyp = asr.transcribe_wav(
                        wav_bytes_pcm16(
                            resample_audio(audio, sr, DEFAULT_ASR_SAMPLE_RATE), DEFAULT_ASR_SAMPLE_RATE
                        ),
                        job_id=spid,
                    ).text
                    lat_asr.append((time.perf_counter() - t_b) * 1000)
                    stats["corrupted_ok"] += 1
                    stats[f"backend_{backend}"] += 1

                    intended = [
                        rplan.corrupted_syllables[j]
                        for j in rplan.corrupted_positions
                        if j < len(rplan.corrupted_syllables)
                    ]
                    rv2 = classify_realization_v2(
                        ground_truth_term=term,
                        intended=intended or rplan.corrupted_syllables,
                        asr_hypothesis=hyp,
                        family=fam,
                    )
                    phon_realized = bool(rv2.base_realized or rv2.full_realized or rv2.differently_realized)
                    # surface string
                    tts_surface = term
                    if rplan.backend == "CHINESE_SURFACE" and term in gt:
                        start = gt.find(term)
                        prefix, suffix = gt[:start], gt[start + len(term) :]
                        if rplan.tts_input_text.startswith(prefix) and rplan.tts_input_text.endswith(suffix):
                            end = len(rplan.tts_input_text) - len(suffix) if suffix else len(rplan.tts_input_text)
                            tts_surface = rplan.tts_input_text[len(prefix) : end]
                    align = align_corruption_spans(
                        ground_truth_text=gt,
                        ground_truth_term=term,
                        tts_input_text=rplan.tts_input_text,
                        tts_surface=tts_surface,
                        asr_hypothesis=hyp,
                        backend=rplan.backend,
                    )
                    row["corrupted_asr_text"] = hyp
                    row["realization_v2"] = rv2.to_dict()
                    row["alignment"] = align.to_dict()
                    row["realization_plan"] = {
                        "backend": rplan.backend,
                        "lexical_corrupted": rplan.lexical_corrupted,
                        "corrupted_positions": rplan.corrupted_positions,
                        "intended": [s.compact for s in rplan.corrupted_syllables],
                        "phoneme_path": (rplan.phoneme_result.backend_path if rplan.phoneme_result else None),
                    }
                    stats[f"realization_{rv2.status}"] += 1
                else:
                    # non-corruption path already has hyp from canonical
                    if hyp is None:
                        t_a = time.perf_counter()
                        synth = tts.synthesize(gt, voice=plan.get("tts_voice") or DEFAULT_TTS_VOICE)
                        lat_tts.append((time.perf_counter() - t_a) * 1000)
                        audio, sr = read_wav_pcm16(synth.wav_bytes)
                        t_b = time.perf_counter()
                        hyp = asr.transcribe_wav(
                            wav_bytes_pcm16(
                                resample_audio(audio, sr, DEFAULT_ASR_SAMPLE_RATE), DEFAULT_ASR_SAMPLE_RATE
                            ),
                            job_id=spid,
                        ).text
                        lat_asr.append((time.perf_counter() - t_b) * 1000)
                    align = align_corruption_spans(
                        ground_truth_text=gt,
                        ground_truth_term=term,
                        tts_input_text=gt,
                        tts_surface=term,
                        asr_hypothesis=hyp or "",
                        backend="CANONICAL",
                    )
                    row["asr_hypothesis"] = hyp
                    row["alignment"] = align.to_dict()
                    stats["control_ok"] += 1

                row["asr_hypothesis"] = hyp
                row["tts_input_text"] = tts_input
                row["backend"] = backend
                elig = _eligibility(
                    align,
                    rv2
                    or type("R", (), {"status": "N/A", "base_realized": False, "differently_realized": False, "full_realized": False})(),
                    bool(plan.get("corruption_planned") and any(mask)),
                )
                row["eligibility_class"] = elig
                stats[f"elig_{elig}"] += 1

                if plan.get("is_paired_control") and row.get("canonical_asr_text") is not None:
                    row["paired_asr_changed"] = "".join((row.get("canonical_asr_text") or "").split()) != "".join(
                        (hyp or "").split()
                    )

                source_type = (
                    "TTS_PRONUNCIATION_CORRUPTED"
                    if plan.get("corruption_planned") and any(mask) and backend in ("CHINESE_SURFACE", "PHONEME")
                    else "TTS_ASR_SYNTHETIC"
                )
                synth_meta = SyntheticMetadataV1(
                    generator_version=GENERATOR_VERSION,
                    source_type=source_type,
                    source_text_corpus="carrier_templates_v2+lexicon_v3+accent_scale_v1",
                    tts_service_id=tts_lock.get("tts_service_id"),
                    tts_model_id=tts_lock.get("tts_model_id"),
                    tts_model_version=tts_lock.get("tts_model_sha256"),
                    tts_voice_id=plan.get("tts_voice") or DEFAULT_TTS_VOICE,
                    asr_service_id=asr_lock.get("asr_service_id"),
                    asr_model_id=asr_lock.get("asr_model_id"),
                    asr_model_version=asr_lock.get("asr_model_path"),
                    asr_compute_type=asr_lock.get("asr_compute_type"),
                    corruption_strategy=f"accent:{fam}:{plan.get('intended_strength')}:{backend}",
                    corruption_parameters={
                        "family": fam,
                        "selected_positions": plan.get("selected_positions"),
                        "backend": backend,
                        "eligibility_class": elig,
                    },
                    random_seed=int(plan.get("seed") or 0),
                    audio_manifest_id=spid,
                    pseudo_user_group_id=plan["pseudo_user_id"],
                    target_term=term,
                    domain_tags=[plan["domain"]] if plan.get("domain") else None,
                    tone_stage="NOT_RUN",
                    phonetic_profile_not_acoustically_realized=not phon_realized,
                    phonetic_profile_acoustically_realized=phon_realized,
                    ground_truth_text=gt,
                    tts_input_text=tts_input,
                    corruption_family=fam if plan.get("corruption_planned") else None,
                    corruption_direction=fam if plan.get("corruption_planned") else None,
                    intended_corrupted_syllables=(
                        [s.compact for s in (rplan.corrupted_syllables if rplan else [])] if rplan else None
                    ),
                    realization_status=(rv2.status if rv2 else None),
                    pseudo_user_id=plan["pseudo_user_id"],
                )
                samples = build_samples_from_asr(
                    sample_plan_id=spid,
                    gt_text=gt,
                    hyp_text=hyp or "",
                    target_term=term,
                    domain=plan.get("domain"),
                    pseudo_user_group_id=plan["pseudo_user_id"],
                    synthetic_meta=synth_meta,
                    target_pinyin=plan.get("pinyin_key"),
                )
                for s in samples:
                    # stamp eligibility into synthetic
                    d = s.to_dict()
                    syn = d.get("metadata", {}).get("synthetic") or {}
                    syn["eligibility_class"] = elig
                    syn["associated_with_corruption"] = bool(align.associated_with_corruption) if align else False
                    if "metadata" in d:
                        d["metadata"]["synthetic"] = syn
                    samples_f.write(json.dumps(d, ensure_ascii=False) + "\n")
                    stats[f"kind_{s.metadata.sample_kind.value}"] += 1

            except Exception as e:
                stats["failed"] += 1
                row["status"] = "failed"
                row["failure_reason"] = f"{type(e).__name__}: {e}"
                row["traceback"] = traceback.format_exc(limit=4)

            results_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            results_f.flush()
            samples_f.flush()
            if (i + 1) % 25 == 0:
                print(f"progress {i+1}/{len(pending)} stats={dict(stats)}", flush=True)
    finally:
        results_f.close()
        samples_f.close()

    wall = time.perf_counter() - t0
    summary = {
        "dataset_id": dataset_id,
        "stats": dict(stats),
        "wall_s": wall,
        "tts_avg_ms": sum(lat_tts) / max(1, len(lat_tts)),
        "asr_avg_ms": sum(lat_asr) / max(1, len(lat_asr)),
        "n_tts_calls": len(lat_tts),
        "n_asr_calls": len(lat_asr),
    }
    (out_dir / "run_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if stats.get("failed", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
