# -*- coding: utf-8 -*-
"""
Model3 Error-Text Generator Pilot — offline only.
Usage (from repo root):
  python -m training.model3_error_text.generator.run_pilot
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from training.model3_error_text import GENERATOR_VERSION
from training.model3_error_text.generator.corrupt import (
    annotate_sentence,
    apply_corruptions,
    reference_reachable,
    try_orthographic_de_di_de,
    try_phonetic_corruption,
)
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import (
    LexiconSurfaceResolver,
    default_sqlite_path,
)
from training.model3_error_text.generator.split import assign_split, leakage_report
from training.model3_error_text.generator.validate import validate_sample

REPO = Path(__file__).resolve().parents[3]
PLAN = REPO / "training/model2/dataset/baseline_v1/generation_plan.jsonl"
RESULTS = REPO / "training/model2/dataset/baseline_v1/results.jsonl"
OUT = REPO / "training/model3_error_text/pilot_v1"
SEED = 20260823
TARGET_BASES = 800
TARGET_SAMPLES = 3000


def _norm(text: str) -> str:
    # Minimal NFKC-like: strip + unify whitespace (no custom Chinese rewriter)
    t = (text or "").replace("\u3000", " ").strip()
    t = re.sub(r"\s+", "", t)  # spoken carriers are typically space-free
    return t


def load_unique_bases(path: Path) -> list[dict]:
    by_text: dict[str, dict] = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            gt = _norm(r.get("gt_text") or "")
            if not gt or "dialog_200" in str(r.get("source") or ""):
                continue
            if gt in by_text:
                continue
            sid = r.get("sample_plan_id") or r.get("combination_key") or hashlib.sha1(gt.encode()).hexdigest()[:16]
            by_text[gt] = {
                "sourceCorpus": "baseline_v1",
                "sourceSentenceId": str(sid),
                "referenceText": gt,
                "domain": r.get("domain") or "general",
                "family": r.get("family") or "",
            }
    return list(by_text.values())


def stratified_sample(bases: list[dict], n: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    by_dom: dict[str, list[dict]] = defaultdict(list)
    for b in bases:
        by_dom[b["domain"]].append(b)
    for d in by_dom:
        by_dom[d].sort(key=lambda x: x["sourceSentenceId"])
        rng.shuffle(by_dom[d])
    # proportional then fill
    total = sum(len(v) for v in by_dom.values())
    picked: list[dict] = []
    domains = sorted(by_dom.keys())
    for d in domains:
        share = max(1, round(n * len(by_dom[d]) / total)) if total else 0
        picked.extend(by_dom[d][:share])
    # trim/fill deterministic
    picked = sorted(picked, key=lambda x: x["sourceSentenceId"])
    if len(picked) > n:
        picked = picked[:n]
    if len(picked) < n:
        seen = {p["sourceSentenceId"] for p in picked}
        rest = [b for b in sorted(bases, key=lambda x: x["sourceSentenceId"]) if b["sourceSentenceId"] not in seen]
        picked.extend(rest[: n - len(picked)])
    return picked[:n]


def make_sample(
    *,
    base: dict,
    corruptions: list[dict],
    seed: int,
    sample_idx: int,
    expected_repair_class: str,
    contrast_group_id: Optional[str],
    reachable: str,
) -> dict:
    ref = base["referenceText"]
    err = apply_corruptions(ref, corruptions) if corruptions else ref
    sg = f"{base['sourceSentenceId']}|{contrast_group_id or 'solo'}"
    sid = f"m3et-{seed}-{sample_idx:05d}"
    return {
        "sampleId": sid,
        "generatorVersion": GENERATOR_VERSION,
        "generationSeed": seed,
        "sourceCorpus": base["sourceCorpus"],
        "sourceSentenceId": base["sourceSentenceId"],
        "referenceText": ref,
        "errorText": err,
        "domainMetadata": {"domainIds": [base["domain"]], "carrierTemplateId": None},
        "corruptionCount": len(corruptions),
        "corruptions": corruptions,
        "contrastGroupId": contrast_group_id,
        "splitGroupKey": sg,
        "evidenceLevel": "SYNTHETIC_TEXT",
        "anchorPrep": {
            "anchorCandidates": [],
            "model2AnchorStatus": "UNAVAILABLE",
        },
        "expectedRepairClass": expected_repair_class,
        "referenceReachable": reachable,
    }


def generate_for_base(
    base: dict,
    resolver: LexiconSurfaceResolver,
    rng: random.Random,
    counters: Counter,
) -> tuple[list[dict], list[dict]]:
    """Return (samples, skip_events)."""
    skips: list[dict] = []
    samples: list[dict] = []
    annos, impl, meta = annotate_sentence(base["referenceText"])
    if not annos:
        skips.append({"sourceSentenceId": base["sourceSentenceId"], "reason": meta.get("skip"), "meta": meta})
        # still emit CLEAN if text ok
        samples.append(
            make_sample(
                base=base,
                corruptions=[],
                seed=SEED,
                sample_idx=-1,
                expected_repair_class="CLEAN",
                contrast_group_id=f"cg-{base['sourceSentenceId']}",
                reachable="UNKNOWN",
            )
        )
        return samples, skips

    eligible = [a for a in annos if not a.skip_reason]
    for a in annos:
        if a.skip_reason:
            counters[f"skip_{a.skip_reason}"] += 1

    cg = f"cg-{base['sourceSentenceId']}"
    # CLEAN
    samples.append(
        make_sample(
            base=base,
            corruptions=[],
            seed=SEED,
            sample_idx=-1,
            expected_repair_class="CLEAN",
            contrast_group_id=cg,
            reachable="UNKNOWN",
        )
    )

    # Collect phonetic candidates (anno, family, corruption) — multiple families/pos OK
    phon_cands: list[tuple[Any, str, dict]] = []
    seen_err: set[tuple[int, str]] = set()
    for a in eligible:
        fams = list(ACTIVE_FAMILIES_V1)
        rng.shuffle(fams)
        for fam in fams:
            c = try_phonetic_corruption(base["referenceText"], a, fam, resolver)
            if c is None:
                counters["skip_no_surface_or_inapplicable"] += 1
                continue
            if c["referenceSurface"] == c["errorSurface"]:
                counters["skip_same_surface"] += 1
                continue
            key = (a.index, c["errorSurface"])
            if key in seen_err:
                continue
            seen_err.add(key)
            phon_cands.append((a, fam, c))
            if sum(1 for x in phon_cands if x[0].index == a.index) >= 2:
                break

    rng.shuffle(phon_cands)

    # SINGLE — up to 4 distinct corruptions
    used_sig: set[str] = set()
    singles: list[dict] = []
    for a, fam, c in phon_cands:
        sig = f"{c['spanStart']}|{c['errorSurface']}|{fam}"
        if sig in used_sig:
            continue
        used_sig.add(sig)
        reach = reference_reachable(resolver, c)
        cls = "PHONETIC_CANDIDATE"
        singles.append(
            make_sample(
                base=base,
                corruptions=[c],
                seed=SEED,
                sample_idx=-1,
                expected_repair_class=cls,
                contrast_group_id=cg,
                reachable=reach,
            )
        )
        if len(singles) >= 4:
            break
    samples.extend(singles)

    # DOUBLE — try up to 2 different pairs
    doubles = 0
    for i, (_, _, c1) in enumerate(phon_cands):
        if doubles >= 2:
            break
        for _, _, c2 in phon_cands[i + 1 :]:
            if c2["spanStart"] == c1["spanStart"]:
                continue
            try:
                apply_corruptions(base["referenceText"], [c1, c2])
            except Exception:
                counters["skip_double_apply"] += 1
                continue
            reaches = [reference_reachable(resolver, c) for c in (c1, c2)]
            if all(x == "YES" for x in reaches):
                reach = "YES"
            elif any(x == "NO" for x in reaches):
                reach = "NO"
            else:
                reach = "UNKNOWN"
            samples.append(
                make_sample(
                    base=base,
                    corruptions=[c1, c2],
                    seed=SEED,
                    sample_idx=-1,
                    expected_repair_class="PHONETIC_CANDIDATE",
                    contrast_group_id=cg,
                    reachable=reach,
                )
            )
            doubles += 1
            break

    # Orthographic sparse
    for a in eligible:
        if a.surface in ("的", "地", "得") and rng.random() < 0.35:
            oc = try_orthographic_de_di_de(base["referenceText"], a)
            if oc:
                samples.append(
                    make_sample(
                        base=base,
                        corruptions=[oc],
                        seed=SEED,
                        sample_idx=-1,
                        expected_repair_class="NON_PHONETIC",
                        contrast_group_id=cg,
                        reachable="UNKNOWN",
                    )
                )
            break

    return samples, skips


def assign_ids_and_splits(samples: list[dict]) -> list[dict]:
    # Stable order
    samples = sorted(
        samples,
        key=lambda s: (s["sourceSentenceId"], s["corruptionCount"], s["errorText"], json.dumps(s["corruptions"], ensure_ascii=False)),
    )
    out = []
    for i, s in enumerate(samples):
        s = dict(s)
        s["sampleId"] = f"m3et-{SEED}-{i:05d}"
        s["split"] = assign_split(s["splitGroupKey"], SEED)
        out.append(s)
    return out


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def real_asr_comparison(pilot: list[dict]) -> dict:
    if not RESULTS.is_file():
        return {"measurement": "NOT_MEASURED", "reason": "missing_results"}
    unequal = 0
    # Lightweight: sample up to 2000 unequal pairs; check if any ACTIVE family could apply to any char
    # Full explainability is expensive; mark MEASURED_PARTIAL
    from training.model2.pronunciation.syllable_substitution import parse_syllable

    fam_applicable = 0
    checked = 0
    with RESULTS.open(encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            gt = (r.get("ground_truth_text") or "").strip()
            hyp = (r.get("asr_hypothesis") or "").strip()
            if not gt or gt == hyp:
                continue
            unequal += 1
            if checked >= 1500:
                continue
            checked += 1
            # use planned family if present
            fam = r.get("family") or r.get("corruption_family")
            if fam in ACTIVE_FAMILIES_V1:
                fam_applicable += 1
                continue
            # heuristic: any char syllable applicable to ACTIVE
            try:
                from training.model2.phonetic.syllables import syllables_from_text_tone_num

                tones = syllables_from_text_tone_num(gt)
                hit = False
                for t in tones:
                    for fam in ACTIVE_FAMILIES_V1:
                        from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable

                        if apply_family_to_syllable(t, fam):
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    fam_applicable += 1
            except Exception:
                pass
    return {
        "measurement": "MEASURED_PARTIAL",
        "unequal_pairs_total_scanned_flag": unequal,
        "checked_for_active_applicability": checked,
        "active_set_applicable_or_planned_family": fam_applicable,
        "approx_rate_on_checked": round(fam_applicable / checked, 4) if checked else None,
        "note": "Applicability ≠ realized ASR error is that family; partial heuristic + planned family field",
        "pilot_family_counts": dict(Counter(c["corruptionFamily"] for s in pilot for c in s.get("corruptions") or [])),
    }


def build_human_qa(pilot: list[dict], path: Path, n: int = 200) -> None:
    rng = random.Random(SEED + 7)
    by_fam: dict[str, list[dict]] = defaultdict(list)
    cleans = [s for s in pilot if s["corruptionCount"] == 0]
    hard = [s for s in pilot if s.get("referenceReachable") == "NO" or s.get("expectedRepairClass") == "NON_PHONETIC"]
    for s in pilot:
        if not s["corruptions"]:
            continue
        by_fam[s["corruptions"][0]["corruptionFamily"]].append(s)
    picked: list[dict] = []
    # stratified families
    for fam, rows in sorted(by_fam.items()):
        rng.shuffle(rows)
        take = max(8, n // max(1, len(by_fam) + 2))
        picked.extend(rows[:take])
    rng.shuffle(cleans)
    picked.extend(cleans[:25])
    rng.shuffle(hard)
    picked.extend(hard[:25])
    # contrast members
    cg = defaultdict(list)
    for s in pilot:
        if s.get("contrastGroupId"):
            cg[s["contrastGroupId"]].append(s)
    multi = [g for g in cg.values() if len(g) >= 2]
    rng.shuffle(multi)
    for g in multi[:30]:
        picked.extend(g[:2])
    # unique by sampleId
    seen = set()
    uniq = []
    for s in picked:
        if s["sampleId"] in seen:
            continue
        seen.add(s["sampleId"])
        uniq.append(s)
    rng.shuffle(uniq)
    uniq = uniq[:n]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "sampleId",
                "referenceText",
                "errorText",
                "corruptionFamily",
                "referenceSurface",
                "errorSurface",
                "sourcePinyin",
                "targetPinyin",
                "referenceReachable",
                "review_valid_phonetic",
                "review_plausible_asr_error",
                "review_comment",
            ],
        )
        w.writeheader()
        for s in uniq:
            c = (s.get("corruptions") or [{}])[0]
            w.writerow(
                {
                    "sampleId": s["sampleId"],
                    "referenceText": s["referenceText"],
                    "errorText": s["errorText"],
                    "corruptionFamily": c.get("corruptionFamily") or "CLEAN",
                    "referenceSurface": c.get("referenceSurface") or "",
                    "errorSurface": c.get("errorSurface") or "",
                    "sourcePinyin": c.get("sourcePinyin") or "",
                    "targetPinyin": c.get("targetPinyin") or "",
                    "referenceReachable": s.get("referenceReachable") or "",
                    "review_valid_phonetic": "",
                    "review_plausible_asr_error": "",
                    "review_comment": "",
                }
            )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    bases_all = load_unique_bases(PLAN)
    bases = stratified_sample(bases_all, TARGET_BASES, SEED)
    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))
    rng = random.Random(SEED)
    counters: Counter = Counter()
    raw_samples: list[dict] = []
    all_skips: list[dict] = []

    for b in bases:
        samples, skips = generate_for_base(b, resolver, rng, counters)
        raw_samples.extend(samples)
        all_skips.extend(skips)

    # Dedup by (sourceSentenceId, errorText, corruption signature)
    dedup: dict[str, dict] = {}
    for s in raw_samples:
        sig = hashlib.sha1(
            f"{s['sourceSentenceId']}|{s['errorText']}|{json.dumps(s['corruptions'], ensure_ascii=False, sort_keys=True)}".encode()
        ).hexdigest()
        dedup[sig] = s
    samples = assign_ids_and_splits(list(dedup.values()))

    # Cap toward ~3000 without loosening validators: prefer keep all if under; if over, stratified trim by group
    if len(samples) > int(TARGET_SAMPLES * 1.1):
        # keep all cleans + trim extras per group
        by_g = defaultdict(list)
        for s in samples:
            by_g[s["splitGroupKey"]].append(s)
        trimmed = []
        for g, rows in sorted(by_g.items()):
            cleans = [r for r in rows if r["corruptionCount"] == 0]
            others = [r for r in rows if r["corruptionCount"] > 0]
            others = sorted(others, key=lambda x: x["sampleId"])[:3]
            trimmed.extend(cleans[:1] + others)
        samples = assign_ids_and_splits(trimmed)

    # Validate
    failures = []
    ok = []
    for s in samples:
        errs = validate_sample(s, resolver)
        if errs:
            failures.append({"sampleId": s["sampleId"], "errors": errs})
        else:
            ok.append(s)
    samples = ok

    leak = leakage_report(samples)

    # Writes
    write_jsonl(OUT / "error_text_pilot_v1.jsonl", samples)
    for sp in ("train", "dev", "test"):
        write_jsonl(OUT / f"error_text_pilot_v1_{sp}.jsonl", [s for s in samples if s["split"] == sp])

    type_counts = Counter()
    for s in samples:
        if s["corruptionCount"] == 0:
            type_counts["CLEAN"] += 1
        elif s["corruptionCount"] == 1 and (s["corruptions"][0].get("isPhonetic")):
            type_counts["PHONETIC_SINGLE"] += 1
        elif s["corruptionCount"] == 2:
            type_counts["PHONETIC_DOUBLE"] += 1
        elif s["expectedRepairClass"] == "NON_PHONETIC":
            type_counts["NON_PHONETIC_ORTHOGRAPHIC"] += 1
        if s.get("referenceReachable") == "NO":
            type_counts["HARD_NEGATIVE_UNREACHABLE"] += 1
        if s.get("contrastGroupId"):
            type_counts["CONTRAST_MEMBER"] += 1

    fam_counts = Counter(c["corruptionFamily"] for s in samples for c in s["corruptions"])
    corr_count_dist = Counter(s["corruptionCount"] for s in samples)
    split_counts = Counter(s["split"] for s in samples)

    manifest = {
        "generatorVersion": GENERATOR_VERSION,
        "seed": SEED,
        "source_corpus": "baseline_v1",
        "base_sentence_count": len(bases),
        "sample_count": len(samples),
        "unique_sample_count": len({s["sampleId"] for s in samples}),
        "split_counts": dict(split_counts),
        "family_counts": dict(fam_counts),
        "sample_type_counts": dict(type_counts),
        "corruption_count_distribution": dict(corr_count_dist),
        "schema_version": "ERROR_TEXT_SAMPLE_V1",
        "generation_timestamp": datetime.now(timezone.utc).isoformat(),
        "dialog_200_in_train": False,
        "active_families": list(ACTIVE_FAMILIES_V1),
        "pinyin_ssot": "training/model2/phonetic/node_syllables_cli.mjs → pinyin-pro",
        "lexicon_ssot": str(default_sqlite_path(REPO).relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "pilot_manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    val_report = {
        "schema_pass": len(samples),
        "schema_fail": len(failures),
        "schema_pass_rate": 1.0 if not failures else len(samples) / max(1, len(samples) + len(failures)),
        "phonetic_replay": "enforced_in_validator",
        "lexicon_provenance": "enforced_in_validator",
        "offset_replay": "enforced_in_validator",
        "skip_counters": dict(counters),
        "annotate_skips": len(all_skips),
    }
    (OUT / "pilot_validation_report.json").write_text(json.dumps(val_report, indent=2) + "\n", encoding="utf-8")
    write_jsonl(OUT / "pilot_validation_failures.jsonl", failures)
    (OUT / "pilot_duplicate_report.json").write_text(
        json.dumps({"dedup_input": len(raw_samples), "dedup_output": len(dedup), "final": len(samples)}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    (OUT / "pilot_split_leakage_report.json").write_text(json.dumps(leak, indent=2) + "\n", encoding="utf-8")

    asr_cmp = real_asr_comparison(samples)
    (OUT / "pilot_vs_real_asr_error_stats.json").write_text(json.dumps(asr_cmp, indent=2) + "\n", encoding="utf-8")
    (OUT / "pilot_vs_real_asr_error_comparison.md").write_text(
        "# Pilot vs Real ASR Error Comparison\n\n"
        f"Measurement: **{asr_cmp.get('measurement')}**\n\n"
        f"```json\n{json.dumps(asr_cmp, indent=2, ensure_ascii=False)}\n```\n\n"
        "Synthetic V1 covers ACTIVE_SET_V1 pronunciation families only; "
        "real ASR also contains non-phonetic errors — synthetic need not match all.\n",
        encoding="utf-8",
    )

    build_human_qa(samples, OUT / "pilot_human_review_200.csv", 200)

    # Deterministic reproduction smoke: regenerate first base only and compare clean sample
    det_ok = True
    try:
        s1, _ = generate_for_base(bases[0], resolver, random.Random(SEED), Counter())
        s2, _ = generate_for_base(bases[0], resolver, random.Random(SEED), Counter())
        det_ok = json.dumps(s1, ensure_ascii=False, sort_keys=True) == json.dumps(s2, ensure_ascii=False, sort_keys=True)
    except Exception:
        det_ok = False
    (OUT / "pilot_deterministic_check.json").write_text(json.dumps({"pass": det_ok}) + "\n", encoding="utf-8")

    resolver.close()

    # future candidates placeholder
    (OUT / "future_candidate_families.json").write_text(
        json.dumps(
            {
                "candidates": [
                    {"family": "d_t", "status": "NOT_IN_PILOT", "reason": "no ACTIVE evidence in BOUND set"},
                    {"family": "tone_*", "status": "NOT_IN_PILOT", "reason": "tone HOLD / optional only"},
                ]
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(json.dumps({"bases": len(bases), "samples": len(samples), "failures": len(failures), "det": det_ok, "leak": leak}, indent=2))
    return 0 if det_ok and leak["source_sentence_leakage_total"] == 0 and leak["contrast_group_leakage_total"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
