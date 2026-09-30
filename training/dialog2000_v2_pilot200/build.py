# -*- coding: utf-8 -*-
"""Build LINGUA_DIALOG2000_V2_PILOT200 V1 dataset (Block A only)."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from training.dialog2000_v2_pilot200.allocation_loader import load_allocation
from training.dialog2000_v2_pilot200.audio_pipeline import AudioPipeline, tts_health
from training.dialog2000_v2_pilot200.constants import (
    DATASET_ID,
    DATASET_VERSION,
    FORBIDDEN_CASE_FIELDS,
    GENERATOR_VERSION,
    MASTER_SEED,
    SPEAKER_ID,
    STRENGTH_TO_SEVERITY,
    TTS_VOICE,
    USER_ASSIGNMENTS,
)
from training.dialog2000_v2_pilot200.lexicon_readonly import ReadonlyLexicon
from training.dialog2000_v2_pilot200.profile_builder import build_user_profiles, pick_wrong_user
from training.dialog2000_v2_pilot200.term_banks import CLEAN_PHRASES, SENTENCE_TEMPLATES
from training.dialog2000_v2_pilot200.term_bank_runtime import load_term_banks
from training.dialog2000_v2_pilot200.validators import validate_all

REPO = Path(__file__).resolve().parents[2]
DEFAULT_ALLOC = (
    REPO
    / "docs"
    / "user_correction"
    / "model3"
    / "LINGUA_DIALOG2000_V2_PILOT200_Case_Allocation.csv"
)
DEFAULT_OUT = REPO / "test wav" / "LINGUA_DIALOG2000_V2_PILOT200"
DEFAULT_LEX = REPO / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"
OLD_DIALOG = REPO / "test wav" / "dialog_200"


DIFFICULTY_CYCLE = ["short", "medium", "medium", "medium", "long", "multi_clause"]


def _case_seed(master: int, case_id: str) -> int:
    h = hashlib.sha256(f"{master}|{case_id}".encode()).hexdigest()
    return int(h[:8], 16)


def _term_id(lex: ReadonlyLexicon | None, surface: str) -> str:
    if lex is not None:
        hit = lex.resolve_surface(surface)
        if hit:
            return hit[0]
    return f"surface:{surface}"


def _assign_profile_stage(slot_focus: str, case_class: str, idx: int) -> str:
    if case_class == "CLEAN_PRESERVE" or slot_focus.startswith("P0"):
        return "P0"
    # cycle P1/P2/P3 for evaluation-bearing cases
    return ["P1", "P2", "P3"][idx % 3]


def _holdout_class(split: str, case_class: str) -> str | None:
    if split != "HOLDOUT":
        return "NONE"
    if case_class == "CLEAN_PRESERVE":
        return "CLEAN_CTRL"
    if case_class == "WRONG_PROFILE_CONTROL":
        return "WRONG_PROFILE_CTRL"
    return "UNSEEN_LEXICAL"


def materialize_cases(
    *,
    slots,
    profiles_by_user: dict[str, Any],
    lex: ReadonlyLexicon | None,
    master_seed: int,
    eval_banks: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    per_user_idx: Counter = Counter()
    eval_term_cursors: dict[str, int] = defaultdict(int)
    clean_cursors: dict[str, int] = defaultdict(int)
    cases: list[dict[str, Any]] = []
    eval_map = eval_banks or {}

    for slot in slots:
        uid = slot.user_id
        per_user_idx[uid] += 1
        seq = per_user_idx[uid]
        case_id = f"p2_{uid.lower()}_{seq:03d}"
        rng = random.Random(_case_seed(master_seed, case_id))
        stage = _assign_profile_stage(slot.profile_stage_focus, slot.case_class, seq)
        user_pack = profiles_by_user[uid]
        if slot.case_class == "CLEAN_PRESERVE":
            stage = "P0"
            profile_meta = user_pack["profiles"]["P0"]
        else:
            profile_meta = user_pack["profiles"][stage]

        difficulty = DIFFICULTY_CYCLE[(seq - 1) % len(DIFFICULTY_CYCLE)]
        relation = slot.relation_family
        eval_surface = None
        eval_term_ids: list[str] = []
        reference = ""
        severity = None
        perturbation = False
        coverage_control = False

        if slot.case_class == "CLEAN_PRESERVE" or relation is None:
            phrases = CLEAN_PHRASES[slot.domain]
            reference = phrases[clean_cursors[slot.domain] % len(phrases)]
            clean_cursors[slot.domain] += 1
            relation = None
            perturbation = False
        else:
            pool = eval_map.get(relation) or []
            if not pool:
                raise RuntimeError(f"empty eval pool for relation {relation}")
            cursor = eval_term_cursors[relation]
            eval_surface = pool[cursor % len(pool)]
            eval_term_cursors[relation] = cursor + 1
            templates = SENTENCE_TEMPLATES[slot.domain][difficulty]
            tmpl = templates[rng.randrange(len(templates))]
            reference = tmpl.format(term=eval_surface)
            assert eval_surface in reference
            eval_term_ids = [_term_id(lex, eval_surface)]
            strength = USER_ASSIGNMENTS[uid].get(relation) or "moderate"
            severity = STRENGTH_TO_SEVERITY.get(strength, "MODERATE")
            if strength == "strong" and seq % 11 == 0:
                severity = "STRONG"
            perturbation = True

        build_ids = list(profile_meta.get("profileBuildTermIds") or [])
        if stage == "P0":
            build_ids = []

        wrong_uid = None
        wrong_status = None
        cand = pick_wrong_user(uid, relation)
        if cand is None:
            wrong_status = "NO_VALID_WRONG_PROFILE_AVAILABLE"
        else:
            wrong_uid = cand

        target_in_lex = None
        if eval_surface and lex is not None:
            target_in_lex = lex.resolve_surface(eval_surface) is not None
        if eval_surface and target_in_lex is False:
            coverage_control = True

        is_model2_target = slot.case_class in (
            "PROFILE_TARGET",
            "WRONG_PROFILE_CONTROL",
            "ASR_RESILIENCE_CONTROL",
        ) and bool(relation)

        case = {
            "caseId": case_id,
            "datasetId": DATASET_ID,
            "datasetVersion": DATASET_VERSION,
            "userId": uid,
            "profileStage": stage,
            "domain": slot.domain,
            "difficulty": difficulty,
            "referenceText": reference,
            "audioId": f"aud_{case_id}",
            "audioPath": f"audio/{case_id}.wav",
            "ttsEngine": "piper",
            "voiceId": TTS_VOICE,
            "speakerId": SPEAKER_ID,
            "relationFamily": relation,
            "relationDirection": relation,
            "perturbationApplied": perturbation,
            "perturbationSeverity": severity,
            "profileRef": profile_meta["profileRef"],
            "profileBuildSetId": profile_meta["profileBuildSetId"],
            "profileBuildTermIds": build_ids,
            "evaluationTargetTermIds": eval_term_ids,
            "evaluationTargetSurface": eval_surface,
            "split": slot.split,
            "holdoutClass": _holdout_class(slot.split, slot.case_class),
            "seed": _case_seed(master_seed, case_id),
            "generatorVersion": GENERATOR_VERSION,
            "expectedBehaviorClass": slot.case_class,
            "wrongProfileUserId": wrong_uid if slot.case_class == "WRONG_PROFILE_CONTROL" else None,
            "wrongProfileStatus": wrong_status if slot.case_class == "WRONG_PROFILE_CONTROL" else None,
            "targetInLexicon": target_in_lex,
            "targetNotInLexicon": bool(eval_surface) and target_in_lex is False,
            "isModel2TargetCase": is_model2_target,
            "lexiconCoverageControl": coverage_control,
            "model2LexiconEligible": bool(is_model2_target and target_in_lex),
        }
        for f in FORBIDDEN_CASE_FIELDS:
            assert f not in case
        cases.append(case)
    return cases


def fingerprint_old_dialog() -> dict[str, Any]:
    man = OLD_DIALOG / "cases.manifest.json"
    if not man.is_file():
        return {"unchanged": True, "note": "manifest missing — skipped"}
    data = man.read_bytes()
    wavs = sorted(OLD_DIALOG.glob("dialog_d*.wav"))
    sample = wavs[0].stat().st_mtime_ns if wavs else 0
    return {
        "unchanged": True,
        "manifest_sha256": hashlib.sha256(data).hexdigest(),
        "manifest_bytes": len(data),
        "wav_count": len(wavs),
        "first_wav_mtime_ns": sample,
        "path": str(man),
    }


def build_manifest(cases: list[dict[str, Any]], build_id: str, seed: int) -> dict[str, Any]:
    return {
        "dataset_id": DATASET_ID,
        "version": DATASET_VERSION,
        "build_id": build_id,
        "generator_version": GENERATOR_VERSION,
        "seed": seed,
        "case_count": len(cases),
        "relation_distribution": dict(Counter(c["relationFamily"] for c in cases if c.get("relationFamily"))),
        "domain_distribution": dict(Counter(c["domain"] for c in cases)),
        "profile_distribution": dict(Counter(c["profileStage"] for c in cases)),
        "split_distribution": dict(Counter(c["split"] for c in cases)),
        "voice_distribution": dict(Counter(c["voiceId"] for c in cases)),
        "class_distribution": dict(Counter(c["expectedBehaviorClass"] for c in cases)),
        "user_assignment": USER_ASSIGNMENTS,
        "speaker_generalization_status": "SPEAKER_GENERALIZATION_NOT_TESTED",
        "tts_engine": "piper",
        "voice_id": TTS_VOICE,
        "speaker_id": SPEAKER_ID,
        "tone": "DEFERRED",
        "elision": "DEFERRED",
        "old_dialog_200": "UNCHANGED_BASELINE",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Block A Pilot200 dataset builder")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--allocation", type=Path, default=DEFAULT_ALLOC)
    ap.add_argument("--lexicon", type=Path, default=DEFAULT_LEX)
    ap.add_argument("--seed", type=int, default=MASTER_SEED)
    ap.add_argument("--skip-audio", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="debug: only first N cases audio")
    args = ap.parse_args()

    out: Path = args.out
    if out.exists():
        # rebuild cleanly but never touch dialog_200
        for sub in ("cases", "profiles", "profile_history", "audio", "manifest", "validation"):
            p = out / sub
            if p.exists():
                shutil.rmtree(p)
    for sub in ("cases", "profiles", "profile_history", "audio", "manifest", "validation"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    build_id = datetime.now(timezone.utc).strftime("build_%Y%m%d_%H%M%S")
    old_fp_before = fingerprint_old_dialog()
    previous_build_id = "build_20260911_010554"

    banks = load_term_banks()
    lex = ReadonlyLexicon(args.lexicon) if args.lexicon.is_file() else None

    def resolver(surface: str):
        if lex is None:
            return None, surface
        hit = lex.resolve_surface(surface)
        if hit:
            return hit[0], hit[1]
        return None, surface

    profiles_by_user = build_user_profiles(
        term_id_resolver=resolver, build_banks=banks["build"]
    )

    # persist profiles + histories
    for uid, pack in profiles_by_user.items():
        for stage, meta in pack["profiles"].items():
            blob = {
                **{k: v for k, v in meta.items() if k != "userProfileV1"},
                "userProfileV1Ref": f"profiles/{meta['profileRef']}.userprofile.json",
            }
            (out / "profiles" / f"{meta['profileRef']}.meta.json").write_text(
                json.dumps(blob, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            (out / "profiles" / f"{meta['profileRef']}.userprofile.json").write_text(
                json.dumps(meta["userProfileV1"], ensure_ascii=False, indent=2), encoding="utf-8"
            )
            (out / "profile_history" / f"{meta['profileBuildSetId']}.json").write_text(
                json.dumps(
                    {
                        "profileBuildSetId": meta["profileBuildSetId"],
                        "userId": uid,
                        "profileStage": stage,
                        "profileBuildTermIds": meta.get("profileBuildTermIds") or [],
                        "events": meta.get("historyEvents") or [],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

    slots = load_allocation(args.allocation)
    cases = materialize_cases(
        slots=slots,
        profiles_by_user=profiles_by_user,
        lex=lex,
        master_seed=args.seed,
        eval_banks=banks["eval"],
    )

    # Freeze references to disk before audio
    ref_freeze = {
        c["caseId"]: {"referenceText": c["referenceText"], "frozen": True} for c in cases
    }
    (out / "cases" / "references_frozen.json").write_text(
        json.dumps(ref_freeze, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    audio_ok = True
    if not args.skip_audio:
        if not tts_health():
            print("ERROR: Piper TTS not available on :5009")
            return 2
        pipe = AudioPipeline()
        limit = args.limit or len(cases)
        for i, case in enumerate(cases):
            if i >= limit:
                # leave remaining without audio — validation will fail (intentional for debug)
                break
            out_wav = out / case["audioPath"]
            print(f"[{i+1}/{limit}] {case['caseId']} audio…", flush=True)
            if case["perturbationApplied"] and case.get("evaluationTargetSurface") and case.get("relationFamily"):
                meta = pipe.synthesize_perturbed(
                    reference_text=case["referenceText"],
                    target_term=case["evaluationTargetSurface"],
                    family=case["relationFamily"],
                    out_path=out_wav,
                )
            else:
                meta = pipe.synthesize_clean(case["referenceText"], out_wav)
            case["audioIdentity"] = {
                "audioId": case["audioId"],
                "byte_size": meta["byte_size"],
                "sha256": meta["sha256"],
                "sample_rate": meta["sample_rate"],
                "channels": meta["channels"],
                "duration": meta["duration"],
            }
            case["ttsBackend"] = meta.get("tts_backend")
            case["ttsInputText"] = meta.get("tts_input_text")
            if meta.get("perturbation_failed"):
                case["perturbationApplied"] = False
                case["perturbationFailed"] = True
                case["unrealizableReason"] = meta.get("unrealizable_reason")
            else:
                case["perturbationApplied"] = bool(meta.get("perturbationApplied"))
    else:
        audio_ok = False
        for case in cases:
            case["audioIdentity"] = {
                "audioId": case["audioId"],
                "byte_size": 0,
                "sha256": "",
                "sample_rate": 0,
                "channels": 0,
                "duration": 0,
            }

    # write cases
    (out / "cases" / "cases.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in cases) + "\n",
        encoding="utf-8",
    )
    for c in cases:
        (out / "cases" / f"{c['caseId']}.json").write_text(
            json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    manifest = build_manifest(cases, build_id, args.seed)
    manifest["build_timestamp"] = datetime.now(timezone.utc).isoformat()
    manifest["output_dir"] = str(out)
    manifest["previous_build_id"] = previous_build_id
    manifest["previous_build_status"] = "SUPERSEDED_BY_BLOCK_A_FREEZE_CORRECTION"
    manifest["term_bank_source"] = banks.get("source")
    manifest["target_selection_basis"] = banks.get("selection_basis")
    manifest["forbidden_selection_signals"] = banks.get("forbidden_selection_signals")
    m2 = [c for c in cases if c.get("isModel2TargetCase")]
    m2_ok = [c for c in m2 if c.get("model2LexiconEligible")]
    manifest["model2_eligibility"] = {
        "MODEL2_TARGET_CASE_COUNT": len(m2),
        "MODEL2_LEXICON_ELIGIBLE_TARGET_COUNT": len(m2_ok),
        "MODEL2_LEXICON_INELIGIBLE_TARGET_COUNT": len(m2) - len(m2_ok),
        "MODEL2_LEXICON_ELIGIBILITY_RATE": round(len(m2_ok) / len(m2), 4) if m2 else None,
    }
    (out / "manifest" / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    old_fp_after = fingerprint_old_dialog()
    old_unchanged = old_fp_before.get("manifest_sha256") == old_fp_after.get("manifest_sha256")
    old_fp_after["unchanged"] = bool(old_unchanged)

    validation = validate_all(
        cases=cases,
        manifest=manifest,
        profiles_by_user=profiles_by_user,
        old_dialog_fingerprint=old_fp_after,
    )
    # Lexicon mutation check
    lex_ro = True
    if lex is not None:
        lex_ro = lex.mutation_attempt_blocked()
        lex.close()
    validation["lexicon_readonly"] = lex_ro
    validation["audio_generated"] = audio_ok and not args.skip_audio
    validation["target_not_in_lexicon_count"] = sum(1 for c in cases if c.get("targetNotInLexicon"))
    validation["model2_eligibility"] = manifest["model2_eligibility"]
    # Predominantly lexicon-eligible core population
    rate = (manifest["model2_eligibility"] or {}).get("MODEL2_LEXICON_ELIGIBILITY_RATE") or 0
    validation["model2_core_predominantly_lexicon_eligible"] = rate >= 0.85
    if not validation["model2_core_predominantly_lexicon_eligible"]:
        validation["status"] = "FAIL"
        validation["hard_gate_failures"] = list(validation.get("hard_gate_failures") or []) + [
            "MODEL2_LEXICON_ELIGIBILITY"
        ]

    (out / "validation" / "validation_report.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps({"build_id": build_id, "validation_status": validation["status"], "out": str(out)}, ensure_ascii=False))
    return 0 if validation["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
