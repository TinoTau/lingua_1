#!/usr/bin/env python3
"""Phase 5E accent generator probe — paired canonical/corrupted, no model training."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.adapters.faster_whisper_client import AsrUnavailableError, FasterWhisperClient
from training.model2.adapters.piper_tts_client import PiperUnavailableError, PiperTtsClient
from training.model2.candidates.index import build_candidate_index_from_sqlite
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE, DEFAULT_TTS_VOICE, GENERATOR_VERSION
from training.model2.contract import FUZZY_DISTANCE_THRESHOLD, FUZZY_POOL_MAX_CANDIDATES, PHONETIC_FEATURE_KEYS
from training.model2.corpus.lexicon_export import default_lexicon_paths, load_lexicon_snapshot_meta
from training.model2.corruption.bank import read_wav_pcm16, resample_audio, wav_bytes_pcm16
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool, syllables_from_span
from training.model2.phonetic.syllables import levenshtein_syllables, text_to_syllables
from training.model2.pronunciation.behaviour import STRENGTH_TO_PROB
from training.model2.pronunciation.phoneme_realizer import PhonemeRealizer
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable
from training.model2.pronunciation.realizer import PronunciationRealizer
from training.model2.pronunciation.seed_cases import write_seed_cases
from training.model2.pronunciation.span_alignment import align_corruption_spans
from training.model2.pronunciation.surface_realizer import ChineseSurfaceRealizer, build_surface_map_v2
from training.model2.pronunciation.transform_engine import (
    PronunciationTransformEngineV1,
    decide_positions,
)
from training.model2.pronunciation.tts_surface_resolver import TtsPronunciationSurfaceMapV1
from training.model2.pronunciation.validation_v2 import classify_realization_v2

DATASET_ID = "model2-accent-generator-probe-v1"


def _load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def _pool_metrics(index, span_text: str, target_term: str, lex_snap: str) -> dict:
    syls = text_to_syllables(span_text)
    pool = build_fuzzy_pool(
        index,
        FuzzyPoolRequestV1(
            span_text=span_text,
            span_syllables=syls,
            span_syllable_count=len(syls),
            max_pool_size=FUZZY_POOL_MAX_CANDIDATES,
            distance_threshold=FUZZY_DISTANCE_THRESHOLD,
            lexicon_snapshot_id=lex_snap,
        ),
    )
    distances = []
    for tid in pool.term_ids():
        rec = index.by_term_id.get(tid)
        if rec and syls:
            distances.append(levenshtein_syllables(syls, rec.syllables))
        else:
            distances.append(0)
    rank = None
    tgt_d = None
    if target_term:
        for i, h in enumerate(pool.hits):
            if h.surface == target_term:
                rank = i
                tgt_d = distances[i] if i < len(distances) else None
                break
    # margin: best_other - target
    margin = None
    if tgt_d is not None:
        others = [d for i, d in enumerate(distances) if i != rank]
        best_other = min(others) if others else None
        margin = None if best_other is None else (best_other - tgt_d)
    return {
        "pool_size": pool.pool_size,
        "target_rank": rank,
        "target_distance": tgt_d,
        "distance_margin": margin,
        "span_text": span_text,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/accent_generator_probe_v1",
    )
    ap.add_argument("--seed", type=int, default=20260813)
    ap.add_argument("--tts-url", default="http://127.0.0.1:5009")
    ap.add_argument("--asr-url", default="http://127.0.0.1:6007")
    ap.add_argument("--limit-seeds", type=int, default=0)
    ap.add_argument("--strength", default="HIGH", choices=list(STRENGTH_TO_PROB))
    args = ap.parse_args()
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    # Seeds + surface map v2
    seed_path = REPO_ROOT / "training/model2/pronunciation/seed_cases_v1.jsonl"
    n_seeds = write_seed_cases(seed_path)
    v1_map = REPO_ROOT / "training/model2/dataset/pronunciation_corrupted_probe_v1/surface_map.json"
    smap_v2 = build_surface_map_v2(v1_map, out_dir / "surface_map_v2.json")
    surface_map = (
        TtsPronunciationSurfaceMapV1.load(v1_map) if v1_map.exists() else TtsPronunciationSurfaceMapV1()
    )

    tts = PiperTtsClient(base_url=args.tts_url)
    asr = FasterWhisperClient(base_url=args.asr_url)
    try:
        tts_lock = tts.lock_config()
        asr_lock = asr.lock_config()
    except (PiperUnavailableError, AsrUnavailableError) as e:
        print(json.dumps({"status": "BLOCKED", "reason": str(e)}))
        return 3

    (out_dir / "service_lock.json").write_text(
        json.dumps(
            {
                "dataset_id": DATASET_ID,
                "tts": tts_lock,
                "asr": asr_lock,
                "phoneme_endpoints_added": True,
                "production_tts_unchanged": True,
                "markers": ["ACCENT_GENERATOR_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    realizer = PronunciationRealizer(
        surface=ChineseSurfaceRealizer(surface_map),
        phoneme=PhonemeRealizer(base_url=args.tts_url, voice=DEFAULT_TTS_VOICE, prefer_http=True),
    )
    engine = PronunciationTransformEngineV1()

    paths = default_lexicon_paths(REPO_ROOT)
    lex_meta = load_lexicon_snapshot_meta(paths["manifest"])
    snap = f"sha256:{lex_meta.get('checksum') or lex_meta.get('bundleVersion')}"
    index = build_candidate_index_from_sqlite(paths["sqlite"], snap, include_idiom=False)

    seeds = _load_jsonl(seed_path)
    if args.limit_seeds:
        seeds = seeds[: args.limit_seeds]

    # Extra difficult non-lexical forced-phoneme cases
    difficult = [
        s
        for s in seeds
        if s["seed_id"] in ("seed-nl-001", "seed-nl-002", "seed-nl-004")
        or "nai3" in s.get("corrupted_pinyin", "")
        or s["confusion_family"] in ("n_l", "h_f", "f_h")
    ][:20]

    paired_plans = []
    for s in seeds:
        carrier = s["carrier_templates"][
            int(hashlib.sha256(f"{args.seed}|{s['seed_id']}|car".encode()).hexdigest()[:8], 16)
            % len(s["carrier_templates"])
        ]
        gt = carrier.replace("{TERM}", s["target_text"])
        if gt.count(s["target_text"]) != 1:
            continue
        pair_id = f"pair-{s['seed_id']}"
        paired_plans.append(
            {
                "pair_id": pair_id,
                "seed_id": s["seed_id"],
                "family": s["confusion_family"],
                "ground_truth_text": gt,
                "ground_truth_term": s["target_text"],
                "target_pinyin": s["target_pinyin"],
                "corrupted_pinyin": s["corrupted_pinyin"],
                "tone_policy": "PRESERVE",
                "force_phoneme": s["seed_id"] in {d["seed_id"] for d in difficult[:8]},
                "strength": args.strength,
                "prob": STRENGTH_TO_PROB[args.strength],
            }
        )

    _write_jsonl(out_dir / "paired_plan.jsonl", paired_plans)

    paired_results = []
    realization_results = []
    alignment_results = []
    t0 = time.perf_counter()

    for i, plan in enumerate(paired_plans):
        term = plan["ground_truth_term"]
        gt = plan["ground_truth_text"]
        fam = plan["family"]
        cans = []
        for p in plan["target_pinyin"].split():
            ps = PronunciationSyllable.from_compact(p)
            if ps:
                cans.append(ps)
        # If pinyin count != chars, fall back to per-char tone syllables
        if len(cans) != len(term):
            from training.model2.phonetic.syllables import syllables_from_text_tone_num

            cans = [
                PronunciationSyllable.from_compact(x)
                for x in syllables_from_text_tone_num(term)
                if PronunciationSyllable.from_compact(x)
            ]

        applicable = [j for j, s in enumerate(cans) if engine.applicable(s, fam)]
        mask = decide_positions(
            n=len(cans),
            applicable_idxs=applicable,
            probability=plan["prob"],
            seed=args.seed,
            user_id="accent-probe-u0",
            plan_id=plan["pair_id"],
            family=fam,
        )
        # Ensure at least one corruption for paired causal test when applicable
        if applicable and not any(mask):
            mask[applicable[0]] = True

        # --- CANONICAL ---
        try:
            synth_c = tts.synthesize(gt, voice=DEFAULT_TTS_VOICE)
            audio_c, sr_c = read_wav_pcm16(synth_c.wav_bytes)
            hyp_c = asr.transcribe_wav(
                wav_bytes_pcm16(resample_audio(audio_c, sr_c, DEFAULT_ASR_SAMPLE_RATE), DEFAULT_ASR_SAMPLE_RATE),
                job_id=f"{plan['pair_id']}-can",
            ).text
        except Exception as e:
            hyp_c = ""
            synth_c = None
            can_err = str(e)
        else:
            can_err = None

        # --- CORRUPTED ---
        rplan = realizer.realize_term_corruption(
            ground_truth_text=gt,
            ground_truth_term=term,
            family=fam,
            canonical_syllables=cans,
            apply_mask=mask,
            force_phoneme=bool(plan.get("force_phoneme")),
        )
        hyp_k = ""
        corr_err = None
        wav_k = None
        try:
            if rplan.backend == "CHINESE_SURFACE":
                synth_k = tts.synthesize(rplan.tts_input_text, voice=DEFAULT_TTS_VOICE)
                wav_k = synth_k.wav_bytes
            elif rplan.backend == "PHONEME" and rplan.phoneme_result and rplan.phoneme_result.wav_bytes:
                wav_k = rplan.phoneme_result.wav_bytes
            else:
                raise RuntimeError(rplan.notes or "unrealizable")
            audio_k, sr_k = read_wav_pcm16(wav_k)
            hyp_k = asr.transcribe_wav(
                wav_bytes_pcm16(resample_audio(audio_k, sr_k, DEFAULT_ASR_SAMPLE_RATE), DEFAULT_ASR_SAMPLE_RATE),
                job_id=f"{plan['pair_id']}-corr",
            ).text
        except Exception as e:
            corr_err = str(e)

        intended = [
            rplan.corrupted_syllables[j] for j in rplan.corrupted_positions if j < len(rplan.corrupted_syllables)
        ]
        rv2 = classify_realization_v2(
            ground_truth_term=term,
            intended=intended or rplan.corrupted_syllables,
            asr_hypothesis=hyp_k,
            family=fam,
        )
        tts_surface = ""
        if rplan.surface and rplan.backend == "CHINESE_SURFACE":
            # reconstruct surface from tts_input
            if term in gt and rplan.tts_input_text != gt:
                # extract replaced span roughly
                tts_surface = rplan.tts_input_text.replace(gt.replace(term, ""), "") if False else ""
                # better: from positions
                chars = list(term)
                sc = []
                for j, ch in enumerate(chars):
                    if j in rplan.corrupted_positions and rplan.surface:
                        # use full term surface from tts_input
                        sc.append("?")
                    else:
                        sc.append(ch)
                idx = rplan.tts_input_text.find(term)
                # extract by replacing known
                tts_surface = rplan.tts_input_text[
                    gt.find(term) : gt.find(term) + len(term)
                ] if term in rplan.tts_input_text else rplan.tts_input_text
                # Actually for surface backend tts_input has replaced term
                start = gt.find(term)
                # length may change
                prefix = gt[:start]
                suffix = gt[start + len(term) :]
                if rplan.tts_input_text.startswith(prefix) and rplan.tts_input_text.endswith(suffix):
                    tts_surface = rplan.tts_input_text[len(prefix) : len(rplan.tts_input_text) - len(suffix) or None]

        align = align_corruption_spans(
            ground_truth_text=gt,
            ground_truth_term=term,
            tts_input_text=rplan.tts_input_text,
            tts_surface=tts_surface or term,
            asr_hypothesis=hyp_k,
            backend=rplan.backend,
        )

        # Pool metrics on ASR spans (use asr text as query when eligible else hyp)
        span_c = term if term in (hyp_c or "") else (hyp_c or gt)
        span_k = align.asr_span if align.asr_span else (hyp_k or gt)
        # Prefer short span
        if len(span_c) > 8:
            span_c = term
        if len(span_k) > 12:
            span_k = align.asr_span[:8] if align.asr_span else term

        pm_c = _pool_metrics(index, span_c, term, snap)
        pm_k = _pool_metrics(index, span_k, term, snap)

        row = {
            "pair_id": plan["pair_id"],
            "seed_id": plan["seed_id"],
            "family": fam,
            "ground_truth_text": gt,
            "ground_truth_term": term,
            "canonical_asr_text": hyp_c,
            "corrupted_asr_text": hyp_k,
            "canonical_error": can_err,
            "corrupted_error": corr_err,
            "backend": rplan.backend,
            "tts_input_text": rplan.tts_input_text,
            "lexical_corrupted": rplan.lexical_corrupted,
            "corrupted_positions": rplan.corrupted_positions,
            "intended_corrupted": [s.compact for s in rplan.corrupted_syllables],
            "asr_changed": "".join((hyp_c or "").split()) != "".join((hyp_k or "").split()),
            "canonical_pool": pm_c,
            "corrupted_pool": pm_k,
            "target_rank_delta": (
                None
                if pm_c["target_rank"] is None or pm_k["target_rank"] is None
                else pm_k["target_rank"] - pm_c["target_rank"]
            ),
            "distance_margin_delta": (
                None
                if pm_c["distance_margin"] is None or pm_k["distance_margin"] is None
                else pm_k["distance_margin"] - pm_c["distance_margin"]
            ),
            "realization_v2": rv2.to_dict(),
            "alignment": align.to_dict(),
            "realization_plan": rplan.to_dict(),
        }
        paired_results.append(row)
        realization_results.append(
            {
                "pair_id": plan["pair_id"],
                "family": fam,
                "backend": rplan.backend,
                "lexical_corrupted": rplan.lexical_corrupted,
                **rv2.to_dict(),
            }
        )
        alignment_results.append({"pair_id": plan["pair_id"], "family": fam, **align.to_dict()})

        if (i + 1) % 8 == 0:
            print(f"progress {i+1}/{len(paired_plans)} backend_counts={Counter(r['backend'] for r in paired_results)}", flush=True)

    _write_jsonl(out_dir / "paired_results.jsonl", paired_results)
    _write_jsonl(out_dir / "realization_results.jsonl", realization_results)
    _write_jsonl(out_dir / "alignment_results.jsonl", alignment_results)

    # Metrics
    by_fam = defaultdict(list)
    for r in paired_results:
        by_fam[r["family"]].append(r)

    def _rate(xs, pred):
        return sum(1 for x in xs if pred(x)) / max(1, len(xs))

    ok_pairs = [r for r in paired_results if not r.get("corrupted_error")]
    surface_n = sum(1 for r in ok_pairs if r["backend"] == "CHINESE_SURFACE")
    phoneme_n = sum(1 for r in ok_pairs if r["backend"] == "PHONEME")
    unreal_n = sum(1 for r in paired_results if r["backend"] == "UNREALIZABLE" or r.get("corrupted_error"))

    cov = {
        "n_seeds": n_seeds,
        "n_pairs": len(paired_results),
        "TransformationCoverageRate": len({r["family"] for r in ok_pairs if r["backend"] != "UNREALIZABLE"})
        / max(1, len(PHONETIC_FEATURE_KEYS)),
        "by_family_pair_count": {f: len(v) for f, v in by_fam.items()},
        "by_family_backend": {
            f: dict(Counter(r["backend"] for r in v)) for f, v in by_fam.items()
        },
    }
    realization_metrics = {
        "SurfaceRealizationRate": surface_n / max(1, len(ok_pairs)),
        "PhonemeRealizationRate": phoneme_n / max(1, len(ok_pairs)),
        "TotalRealizationRate": (surface_n + phoneme_n) / max(1, len(paired_results)),
        "BasePhoneticRealizationRate": _rate(ok_pairs, lambda r: r["realization_v2"]["base_realized"]),
        "ToneRealizationRate": _rate(ok_pairs, lambda r: r["realization_v2"]["tone_realized"]),
        "FullRealizationRate": _rate(ok_pairs, lambda r: r["realization_v2"]["full_realized"]),
        "status_counts": dict(Counter(r["realization_v2"]["status"] for r in ok_pairs)),
        "backend_counts": {"CHINESE_SURFACE": surface_n, "PHONEME": phoneme_n, "UNREALIZABLE_or_fail": unreal_n},
        "lexical_vs_nonlexical": {
            "LEXICAL_CORRUPTED_SYLLABLE": {
                "n": sum(1 for r in ok_pairs if r["lexical_corrupted"]),
                "base_rate": _rate(
                    [r for r in ok_pairs if r["lexical_corrupted"]],
                    lambda r: r["realization_v2"]["base_realized"],
                ),
            },
            "NON_LEXICAL_CORRUPTED_SYLLABLE": {
                "n": sum(1 for r in ok_pairs if not r["lexical_corrupted"]),
                "base_rate": _rate(
                    [r for r in ok_pairs if not r["lexical_corrupted"]],
                    lambda r: r["realization_v2"]["base_realized"],
                ),
            },
        },
        "nai3_lai3_poc": next(
            (
                {
                    "pair_id": r["pair_id"],
                    "backend": r["backend"],
                    "canonical_asr": r["canonical_asr_text"],
                    "corrupted_asr": r["corrupted_asr_text"],
                    "realization": r["realization_v2"],
                }
                for r in paired_results
                if r["seed_id"] == "seed-nl-001"
            ),
            None,
        ),
    }
    paired_metrics = {
        "PairedASRChangeRate": _rate(ok_pairs, lambda r: r["asr_changed"]),
        "mean_target_rank_delta": (
            sum(r["target_rank_delta"] for r in ok_pairs if r["target_rank_delta"] is not None)
            / max(1, sum(1 for r in ok_pairs if r["target_rank_delta"] is not None))
        ),
        "mean_distance_margin_delta": (
            sum(r["distance_margin_delta"] for r in ok_pairs if r["distance_margin_delta"] is not None)
            / max(1, sum(1 for r in ok_pairs if r["distance_margin_delta"] is not None))
        ),
        "by_family_asr_change": {
            f: _rate(v, lambda r: r.get("asr_changed") and not r.get("corrupted_error"))
            for f, v in by_fam.items()
        },
    }
    alignment_metrics = {
        "CorruptionAssociatedPositiveRate": _rate(
            alignment_results, lambda a: a["associated_with_corruption"]
        ),
        "NonTermPositiveProxyRate": _rate(
            alignment_results, lambda a: not a["model2_term_training_eligible"]
        ),
        "eligible_rate": _rate(alignment_results, lambda a: a["model2_term_training_eligible"]),
        "reason_counts": dict(Counter(a["reason"] for a in alignment_results)),
    }

    (out_dir / "transformation_coverage.json").write_text(
        json.dumps(cov, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "realization_metrics.json").write_text(
        json.dumps(realization_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "paired_metrics.json").write_text(
        json.dumps(paired_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "alignment_metrics.json").write_text(
        json.dumps(alignment_metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    wall = time.perf_counter() - t0
    manifest = {
        "dataset_id": DATASET_ID,
        "generator_version": GENERATOR_VERSION,
        "n_seeds": n_seeds,
        "n_pairs": len(paired_results),
        "wall_s": wall,
        "surface_map_v2_stats": smap_v2.get("stats"),
        "transformation_coverage": cov,
        "realization_metrics": realization_metrics,
        "paired_metrics": paired_metrics,
        "alignment_metrics": alignment_metrics,
        "model_training": "NOT_RUN",
        "scale_2k5k": "NOT_RUN",
        "markers": ["ACCENT_GENERATOR_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"],
    }
    (out_dir / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
