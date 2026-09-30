#!/usr/bin/env python3
"""Build / validate TtsPronunciationSurfaceMap V1 via Piper+ASR short carriers."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from training.model2.adapters.faster_whisper_client import AsrUnavailableError, FasterWhisperClient
from training.model2.adapters.piper_tts_client import PiperUnavailableError, PiperTtsClient
from training.model2.constants import DEFAULT_TTS_VOICE
from training.model2.pronunciation.tts_surface_resolver import (
    RESOLVER_VERSION,
    SurfaceMapEntry,
    TtsPronunciationSurfaceMapV1,
    build_reverse_pinyin_index,
    candidates_for_syllable,
    pick_deterministic,
)
from training.model2.pronunciation.validation import validate_char_with_piper_asr

# Core syllables needed for UserFeatureSchema V1 probe corruptions
BOOTSTRAP_SYLLABLES = [
    # n/l
    "nan2",
    "lan2",
    "ning2",
    "ling2",
    "nai3",
    "li3",
    "ni3",
    "lao3",
    # zh/z
    "zhi1",
    "zi1",
    "zhang1",
    "zang1",
    "zhong1",
    "zong1",
    # ch/c
    "chen2",
    "cen2",
    "chang2",
    "cang2",
    # sh/s
    "shi1",
    "si1",
    "shang4",
    "sang4",
    # an/ang
    "ban1",
    "bang1",
    # en/eng
    "gen1",
    "geng1",
    "fen1",
    # in/ing
    "jin1",
    "jing1",
    "pin1",
    "ping1",
    # f/h
    "fan1",
    "han1",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT / "training/model2/dataset/pronunciation_corrupted_probe_v1/surface_map.json",
    )
    ap.add_argument("--tts-url", default="http://127.0.0.1:5009")
    ap.add_argument("--asr-url", default="http://127.0.0.1:6007")
    ap.add_argument("--voice", default=DEFAULT_TTS_VOICE)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--skip-validate", action="store_true")
    args = ap.parse_args()

    rev = build_reverse_pinyin_index()
    smap = TtsPronunciationSurfaceMapV1()
    tts = asr = None
    if not args.skip_validate:
        tts = PiperTtsClient(base_url=args.tts_url, voice=args.voice)
        asr = FasterWhisperClient(base_url=args.asr_url)
        try:
            tts.lock_config()
            asr.lock_config()
        except (PiperUnavailableError, AsrUnavailableError) as e:
            print(json.dumps({"status": "BLOCKED", "reason": str(e)}))
            return 3

    syllables = BOOTSTRAP_SYLLABLES
    if args.limit and args.limit > 0:
        syllables = syllables[: args.limit]

    stats = {"validated": 0, "rejected": 0, "unrealizable": 0, "candidate": 0}
    for syl in syllables:
        cands = candidates_for_syllable(syl, rev)
        if not cands:
            smap.upsert(
                SurfaceMapEntry(
                    syllable=syl,
                    tone=syl[-1] if syl[-1].isdigit() else "",
                    surface_char="",
                    piper_voice=args.voice,
                    validation_status="UNREALIZABLE",
                    validation_method="no_cjk_candidate",
                    notes="UNREALIZABLE_BY_CURRENT_TTS",
                )
            )
            stats["unrealizable"] += 1
            continue
        # try preferred / top candidates until one validates
        chosen = None
        method = "candidate_pick"
        status = "CANDIDATE"
        notes = ""
        try_order = cands[:6]
        for ch in try_order:
            if args.skip_validate or tts is None or asr is None:
                chosen = pick_deterministic(syl, cands)
                status = "CANDIDATE"
                method = "dictionary_only_no_piper"
                break
            res = validate_char_with_piper_asr(
                surface_char=ch,
                intended_syllable=syl,
                tts=tts,
                asr=asr,
            )
            if res.get("ok"):
                chosen = ch
                status = "VALIDATED"
                method = "piper_carrier_asr"
                notes = f"asr={res.get('asr')}"
                break
            notes = f"last_fail_asr={res.get('asr')}"
        if chosen is None:
            smap.upsert(
                SurfaceMapEntry(
                    syllable=syl,
                    tone=syl[-1] if syl[-1].isdigit() else "",
                    surface_char=cands[0],
                    piper_voice=args.voice,
                    validation_status="REJECTED",
                    validation_method="piper_carrier_asr",
                    notes=notes or "all candidates failed realization",
                )
            )
            stats["rejected"] += 1
            continue
        smap.upsert(
            SurfaceMapEntry(
                syllable=syl,
                tone=syl[-1] if syl[-1].isdigit() else "",
                surface_char=chosen,
                piper_voice=args.voice,
                validation_status=status,
                validation_method=method,
                notes=notes,
            )
        )
        stats[status.lower()] = stats.get(status.lower(), 0) + 1
        print(f"{syl} -> {chosen} [{status}]", flush=True)

    smap.save(args.out)
    summary = {
        "resolver_version": RESOLVER_VERSION,
        "out": str(args.out),
        "n_entries": len(smap.entries),
        "stats": stats,
        "phoneme_backend": "NOT_EXPOSED_VIA_HTTP",
        "note": "HTTP /tts accepts Chinese text only; phoneme override deferred to V2.",
    }
    (args.out.parent / "surface_map_build_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
