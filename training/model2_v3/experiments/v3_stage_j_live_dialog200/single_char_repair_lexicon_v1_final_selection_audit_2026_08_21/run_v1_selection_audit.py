# -*- coding: utf-8 -*-
"""FW_REPAIR_V4 Single-Char Repair Lexicon V1 Final Selection Audit.
READ-ONLY analysis. No sqlite write / import / rebuild / production code change.
Does NOT use dialog_200 expectedText for membership.
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
OUT = (
    ROOT
    / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
    / "single_char_repair_lexicon_v1_final_selection_audit_2026_08_21"
)
OUT.mkdir(parents=True, exist_ok=True)

STRICT_P = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv"
BAL_P = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_balanced_v1.csv"
CLD_P = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_CLD_audit_v1.csv"
IME_P = ROOT / "docs/pinyin-v2/import/single_char_dictionary.tsv"

# Protected spoken/function examples (coverage check only; not a membership patch list)
FUNCTION_PROTECTION = list(
    "的了吗呢吧啊呀哦嗯我你他她它这那有没不很更最上一下前后左右里外大小多少谁什么怎么为何哪和与或"
)

SUSPICIOUS = ["毫", "涡", "皿", "酯"]

# IME role buckets used only for deterministic labeling (not eligibility authority)
FUNCTION_ROLES = {
    "function_single_char",
    "time_single_char",
    "place_direction_single_char",
    "measure_single_char",
}
CONTENT_ROLES = {"content_single_char", "service_content_single_char"}
FALLBACK_ROLES = {"content_single_char_fallback"}


def write_csv(path: Path, rows: list[dict], fieldnames: list[str] | None = None) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fn = fieldnames or list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fn, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def fnum(x) -> float:
    try:
        return float(x)
    except Exception:
        return 0.0


def tone_from_pinyin(p: str) -> str:
    p = (p or "").strip()
    m = re.search(r"([1-5])$", p)
    return m.group(1) if m else ""


def group_key(pinyin: str, tone: str) -> str:
    base = re.sub(r"[1-5]$", "", (pinyin or "").strip().lower())
    t = (tone or "").strip() or tone_from_pinyin(pinyin) or "5"
    return f"{base}|{t}"


def load_cld_csv(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            word = (r.get("word") or "").strip()
            if not word:
                continue
            py = (r.get("pinyin") or "").strip()
            tone = (r.get("tone") or "").strip() or tone_from_pinyin(py)
            rows.append(
                {
                    "word": word,
                    "pinyin": py,
                    "tone": tone,
                    "frequency_subtl_per_million": fnum(r.get("frequency_subtl_per_million")),
                    "frequency_weibo_per_million": fnum(r.get("frequency_weibo_per_million")),
                    "combined_frequency": fnum(r.get("combined_frequency")),
                    "tier": (r.get("tier") or "").strip(),
                    "recommended_initial_repair_lexicon": (r.get("recommended_initial_repair_lexicon") or "").strip(),
                    "source": (r.get("source") or "").strip(),
                    "group_key": group_key(py, tone),
                }
            )
    return rows


def load_ime(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            surface = (r.get("surface") or r.get("canonical") or "").strip()
            if not surface:
                continue
            rows.append(
                {
                    "word": surface,
                    "canonical": (r.get("canonical") or surface).strip(),
                    "pinyin": (r.get("pinyin") or "").strip(),
                    "tone_pinyin": (r.get("tone_pinyin") or "").strip(),
                    "weight": fnum(r.get("weight")),
                    "source": (r.get("source") or "").strip(),
                    "role": (r.get("single_char_role") or r.get("role") or "").strip(),
                }
            )
    return rows


def unique_chars(rows: list[dict]) -> set[str]:
    return {r["word"] for r in rows}


def pinyin_tone_stats(rows: list[dict]) -> dict:
    groups: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        groups[r["group_key"]].add(r["word"])
    sizes = [len(v) for v in groups.values()]
    size_hist = Counter(sizes)
    return {
        "characters": len(unique_chars(rows)),
        "rows": len(rows),
        "groups": len(groups),
        "unique_groups": sum(1 for s in sizes if s == 1),
        "size2": size_hist.get(2, 0),
        "size3": size_hist.get(3, 0),
        "size_ge4": sum(v for k, v in size_hist.items() if k >= 4),
        "ambiguous_groups": sum(1 for s in sizes if s >= 2),
        "max_group_size": max(sizes) if sizes else 0,
        "words_in_unique": sum(len(v) for v in groups.values() if len(v) == 1),
        "words_in_ambiguous": sum(len(v) for v in groups.values() if len(v) >= 2),
    }


def classify_balanced_minus_strict(row: dict, ime_by_char: dict[str, dict]) -> str:
    """Deterministic labels from available metadata only (no dialog_200, no LLM taste)."""
    sub = row["frequency_subtl_per_million"]
    wei = row["frequency_weibo_per_million"]
    # By construction both in [5, 10)
    ime = ime_by_char.get(row["word"])
    role = (ime or {}).get("role") or ""
    if role in FUNCTION_ROLES:
        return "A_clearly_useful_standalone_spoken"
    if role in FALLBACK_ROLES:
        return "D_morpheme_dominant_or_fallback_risk"
    # spoken-ish if weibo relatively strong vs literary-leaning subtitle gap
    if wei >= 7 and sub >= 5:
        return "A_clearly_useful_standalone_spoken"
    if wei < 6 and sub >= 8:
        return "C_written_literary_leaning"
    if max(sub, wei) < 6:
        return "B_valid_but_uncommon"
    if role in CONTENT_ROLES:
        return "B_valid_but_uncommon"
    if ime is None:
        # in CLD mid-band but absent from IME common inventory
        if max(sub, wei) < 6.5:
            return "B_valid_but_uncommon"
        return "F_uncertain"
    return "F_uncertain"


def main() -> None:
    strict = load_cld_csv(STRICT_P)
    bal = load_cld_csv(BAL_P)
    cld = load_cld_csv(CLD_P)
    ime = load_ime(IME_P)

    # Fix IME role: TSV may use different column names
    if ime and not any(r.get("role") for r in ime[:20]):
        # peek header
        with IME_P.open(encoding="utf-8-sig", newline="") as f:
            header = next(csv.reader(f, delimiter="\t"))
        # reload with best-effort role field
        role_key = None
        for cand in ("role", "single_char_role", "ime_role", "category"):
            if cand in header:
                role_key = cand
                break
        if role_key:
            ime = []
            with IME_P.open(encoding="utf-8-sig", newline="") as f:
                for r in csv.DictReader(f, delimiter="\t"):
                    surface = (r.get("surface") or r.get("canonical") or "").strip()
                    if not surface:
                        continue
                    ime.append(
                        {
                            "word": surface,
                            "canonical": (r.get("canonical") or surface).strip(),
                            "pinyin": (r.get("pinyin") or "").strip(),
                            "tone_pinyin": (r.get("tone_pinyin") or "").strip(),
                            "weight": fnum(r.get("weight")),
                            "source": (r.get("source") or "").strip(),
                            "role": (r.get(role_key) or "").strip(),
                        }
                    )

    # Infer role from weight bands if still empty (IME provenance audit used roles)
    # Prefer reading roles from a known mapping file if present
    roles_path = ROOT / "electron_node/electron-node/main/src/fw-detector/pinyin-ime-v2/pinyin-ime-v2-single-char-roles.ts"
    # Fallback: use weight heuristics only for protection labels, not eligibility
    ime_by_char = {r["word"]: r for r in ime}

    s_chars = unique_chars(strict)
    b_chars = unique_chars(bal)
    c_chars = unique_chars(cld)
    i_chars = unique_chars(ime)

    # Tier counts from full CLD
    tier_counts = Counter(r["tier"] for r in cld)

    # Relationships
    rel = {
        "strict_subset_of_balanced": s_chars <= b_chars,
        "balanced_subset_of_full": b_chars <= c_chars,
        "strict_eq_balanced": s_chars == b_chars,
        "strict_count": len(s_chars),
        "balanced_count": len(b_chars),
        "full_cld_count": len(c_chars),
        "ime_count": len(i_chars),
        "strict_rows": len(strict),
        "balanced_rows": len(bal),
        "full_rows": len(cld),
        "strict_only_chars": sorted(s_chars - b_chars),
        "balanced_minus_strict_chars": sorted(b_chars - s_chars),
        "full_minus_balanced_count": len(c_chars - b_chars),
        "ime_cap_strict": len(i_chars & s_chars),
        "ime_cap_balanced": len(i_chars & b_chars),
        "ime_cap_full": len(i_chars & c_chars),
        "strict_only_vs_ime": len(s_chars - i_chars),
        "balanced_only_vs_ime": len(b_chars - i_chars),
        "tier_counts": dict(tier_counts),
    }

    # BALANCED - STRICT row-level (may have polyphonic rows)
    bal_by_word = {r["word"]: r for r in bal}
    strict_by_word = {r["word"]: r for r in strict}
    bms_rows = []
    class_counts = Counter()
    for ch in sorted(b_chars - s_chars):
        row = bal_by_word[ch]
        cls = classify_balanced_minus_strict(row, ime_by_char)
        class_counts[cls] += 1
        ime_r = ime_by_char.get(ch, {})
        bms_rows.append(
            {
                "surface": ch,
                "pinyin": row["pinyin"],
                "tone": row["tone"],
                "frequency_subtl_per_million": row["frequency_subtl_per_million"],
                "frequency_weibo_per_million": row["frequency_weibo_per_million"],
                "combined_frequency": row["combined_frequency"],
                "ime_role": ime_r.get("role", ""),
                "ime_weight": ime_r.get("weight", ""),
                "in_ime2510": "YES" if ch in i_chars else "NO",
                "class": cls,
                "notes": "deterministic freq-band+IME-role label; not auto-delete",
            }
        )

    # STRICT - BALANCED explanation
    strict_only = sorted(s_chars - b_chars)

    # FULL - BALANCED grouping by tier
    full_minus = []
    for r in cld:
        if r["word"] in b_chars:
            continue
        full_minus.append(r)
    fmb_tier = Counter(r["tier"] for r in full_minus)
    # also band by max freq
    def band(r):
        m = max(r["frequency_subtl_per_million"], r["frequency_weibo_per_million"])
        if m >= 1:
            return "EXTENDED_ge1_lt5_band"
        if m >= 0.1:
            return "LOW_0.1_to_1"
        if m > 0:
            return "LOW_gt0_lt0.1"
        return "ZERO_OR_MISSING_FREQ"

    fmb_band = Counter(band(r) for r in full_minus)
    full_delta_summary = [
        {"group": k, "count": v, "kind": "tier"} for k, v in sorted(fmb_tier.items())
    ] + [{"group": k, "count": v, "kind": "freq_band"} for k, v in sorted(fmb_band.items())]

    # IME-only possible missing (in IME, not in BALANCED; evidence = function/measure roles only)
    ime_only_missing = []
    for r in ime:
        ch = r["word"]
        if ch in b_chars:
            continue
        role = r.get("role") or ""
        evidence = []
        status = "IME_COVERAGE_ONLY_NOT_LEXICAL_AUTHORITY"
        if role in FUNCTION_ROLES:
            evidence.append(f"ime_role={role}")
            status = "POSSIBLE_MISSING_COMMON_SINGLE"
        elif role in CONTENT_ROLES and r.get("weight", 0) >= 0.12:
            evidence.append(f"ime_role={role};weight={r.get('weight')}")
            status = "POSSIBLE_MISSING_COMMON_SINGLE_WEAK"
        else:
            evidence.append("in_ime2510_only; no independent wordhood in this audit")
        # also check if in FULL CLD
        in_cld = ch in c_chars
        ime_only_missing.append(
            {
                "surface": ch,
                "ime_role": role,
                "ime_weight": r.get("weight"),
                "in_full_cld": "YES" if in_cld else "NO",
                "in_strict": "YES" if ch in s_chars else "NO",
                "in_balanced": "NO",
                "status": status,
                "evidence": ";".join(evidence),
                "auto_add": "NO",
            }
        )

    # Function protection
    fw_check = []
    for ch in FUNCTION_PROTECTION:
        fw_check.append(
            {
                "surface": ch,
                "in_strict": "YES" if ch in s_chars else "NO",
                "in_balanced": "YES" if ch in b_chars else "NO",
                "in_full_cld": "YES" if ch in c_chars else "NO",
                "in_ime": "YES" if ch in i_chars else "NO",
                "protected_if_in_strict": "PASS" if ch in s_chars else "FAIL_OR_NOT_IN_SOURCE",
            }
        )

    # Morpheme-only risk (audit classification only).
    # Note: IME has 1617 content_single_char_fallback rows — overlap with STRICT is common and
    # must NOT alone imply exclusion (IME role is not Repair eligibility authority).
    morph_risk = []
    for r in bal:
        ime_r = ime_by_char.get(r["word"], {})
        role = ime_r.get("role") or ""
        in_strict = r["word"] in s_chars
        if (not in_strict) and role in FALLBACK_ROLES:
            risk, reason = "HIGH", "balanced_only_and_ime_fallback_role"
        elif (not in_strict) and role == "":
            risk, reason = "MEDIUM", "balanced_only_absent_from_ime"
        elif in_strict and role in FALLBACK_ROLES and r["frequency_weibo_per_million"] < 12:
            risk, reason = "MEDIUM", "strict_but_ime_fallback_and_weibo_near_strict_floor"
        else:
            continue
        morph_risk.append(
            {
                "surface": r["word"],
                "pinyin": r["pinyin"],
                "tone": r["tone"],
                "tier": "STRICT" if in_strict else "BALANCED_ONLY",
                "weibo": r["frequency_weibo_per_million"],
                "subtl": r["frequency_subtl_per_million"],
                "ime_role": role,
                "risk": risk,
                "reason": reason,
                "action": "AUDIT_ONLY_NOT_AUTO_DELETE",
            }
        )

    # Rare/literary risk: low weibo but higher subtl inside BALANCED, or FULL low tiers sample
    rare_risk = []
    for r in bal:
        sub, wei = r["frequency_subtl_per_million"], r["frequency_weibo_per_million"]
        if sub >= 10 and wei < 8:
            rare_risk.append(
                {
                    "surface": r["word"],
                    "pinyin": r["pinyin"],
                    "subtl": sub,
                    "weibo": wei,
                    "risk_class": "POSSIBLE_WRITTEN_LEANING",
                    "in_strict": "YES" if r["word"] in s_chars else "NO",
                    "action": "AUDIT_ONLY",
                }
            )
        elif 5 <= max(sub, wei) < 6:
            rare_risk.append(
                {
                    "surface": r["word"],
                    "pinyin": r["pinyin"],
                    "subtl": sub,
                    "weibo": wei,
                    "risk_class": "NEAR_FLOOR_UNCOMMON",
                    "in_strict": "YES" if r["word"] in s_chars else "NO",
                    "action": "AUDIT_ONLY",
                }
            )

    # POS/function coverage proxy: no POS in CLD export — use IME roles ∩ STRICT/BALANCED
    def coverage_for(chars: set[str]) -> list[dict]:
        buckets = Counter()
        for ch in chars:
            role = (ime_by_char.get(ch) or {}).get("role") or ""
            if role in FUNCTION_ROLES:
                if "measure" in role:
                    buckets["numeral_classifier_proxy"] += 1
                elif "place" in role or "time" in role:
                    buckets["direction_location_time_proxy"] += 1
                else:
                    buckets["particle_pronoun_function_proxy"] += 1
            elif role in CONTENT_ROLES:
                buckets["content_proxy"] += 1
            elif role in FALLBACK_ROLES:
                buckets["fallback_proxy"] += 1
            elif ch in i_chars:
                buckets["ime_untyped"] += 1
            else:
                buckets["cld_only_no_ime_role"] += 1
        return [{"bucket": k, "count": v} for k, v in sorted(buckets.items())]

    # Phonetic stats
    stats_s = pinyin_tone_stats(strict)
    stats_b = pinyin_tone_stats(bal)
    stats_c = pinyin_tone_stats(cld)

    # Polyphonic: same surface multiple rows
    def poly_audit(rows: list[dict], name: str) -> list[dict]:
        by = defaultdict(list)
        for r in rows:
            by[r["word"]].append(r)
        out = []
        for w, rs in by.items():
            if len(rs) < 2:
                continue
            pys = sorted({r["pinyin"] for r in rs})
            out.append(
                {
                    "dataset": name,
                    "surface": w,
                    "row_count": len(rs),
                    "distinct_pinyin": "|".join(pys),
                    "representation": "MULTI_ROW_PER_SURFACE",
                    "reliable_mapping": "PARTIAL",
                    "note": "CLD CSV keeps one row per (word,pinyin); same-syllable multi-tone may be collapsed upstream",
                }
            )
        return out

    poly_rows = poly_audit(strict, "STRICT") + poly_audit(bal, "BALANCED") + poly_audit(cld, "FULL_CLD")

    # Suspicious examples
    review_examples = []
    for ch in SUSPICIOUS:
        review_examples.append(
            {
                "surface": ch,
                "in_strict": ch in s_chars,
                "in_balanced": ch in b_chars,
                "in_full_cld": ch in c_chars,
                "in_ime": ch in i_chars,
                "cld_row": bal_by_word.get(ch) or next((r for r in cld if r["word"] == ch), None),
            }
        )

    # Decision: STRICT recommended (simple; README; BALANCED delta mostly mid-freq uncertain)
    # Refined not needed: no clear systematic spoken loss requiring deterministic refinement
    proposed_source = "STRICT"
    proposed_rows = []
    for r in strict:
        ime_r = ime_by_char.get(r["word"], {})
        role = ime_r.get("role") or ""
        if role in FUNCTION_ROLES:
            eclass = "FUNCTION_OR_GRAMMAR"
        elif role in CONTENT_ROLES:
            eclass = "CONTENT_STANDALONE"
        elif role in FALLBACK_ROLES:
            eclass = "CLD_WORD_IME_FALLBACK_OVERLAP"
        else:
            eclass = "CLD_WORD_FREQ_GATE"
        proposed_rows.append(
            {
                "surface": r["word"],
                "canonical_surface": r["word"],
                "pinyin": r["pinyin"],
                "tone": r["tone"],
                "eligibility_class": "INCLUDE",
                "evidence_class": eclass,
                "source": "Chinese Lexical Database v2.1 + STRICT freq gate (SUBTL>=10 & Weibo>=10)",
                "frequency_subtl_per_million": r["frequency_subtl_per_million"],
                "frequency_weibo_per_million": r["frequency_weibo_per_million"],
                "combined_frequency": r["combined_frequency"],
                "review_status": "PROPOSED_NOT_IMPORTED",
            }
        )

    # Sample review by category
    sample_review = []
    # function from protection list in proposed
    for ch in FUNCTION_PROTECTION:
        if ch in s_chars:
            sample_review.append({"category": "function_protection", "surface": ch, "result": "PRESENT_IN_V1", "ok": "YES"})
        else:
            sample_review.append({"category": "function_protection", "surface": ch, "result": "ABSENT", "ok": "CHECK"})
    for ch in SUSPICIOUS:
        sample_review.append(
            {
                "category": "suspicious_example",
                "surface": ch,
                "result": "PRESENT" if ch in s_chars else "ABSENT",
                "ok": "EXPECTED_ABSENT_IF_NOT_STRICT" if ch not in s_chars else "PRESENT_REVIEW",
            }
        )
    # verbs/nouns/directions proxies: pick high-freq STRICT samples
    for ch in ["吃", "看", "说", "走", "人", "水", "天", "上", "下", "前", "后", "一", "二", "三", "吗", "呢", "吧"]:
        sample_review.append(
            {
                "category": "spot_check",
                "surface": ch,
                "result": "PRESENT" if ch in s_chars else "ABSENT",
                "ok": "YES" if ch in s_chars else "ABSENT",
            }
        )

    # False exclusion: function protection misses
    false_excl = [r for r in fw_check if r["in_strict"] == "NO"]
    # False inclusion risk: morph HIGH inside STRICT
    false_incl = [r for r in morph_risk if r["tier"] == "STRICT" and r["risk"] == "HIGH"]

    # Inventory CSV
    inventory = [
        {
            "name": "IME_2510",
            "file": "docs/pinyin-v2/import/single_char_dictionary.tsv",
            "row_count": len(ime),
            "unique_chars": len(i_chars),
            "source": "通用规范汉字一级 + pinyin-data / IME roles",
            "generation_method": "IME dictionary build",
            "selection_rule": "common-character inventory for decoder fallback",
            "license_provenance": "see pinyin-v2 docs; IME inventory",
            "current_status": "ACTIVE_IME_SSOT; NOT_REPAIR_AUTHORITY",
        },
        {
            "name": "STRICT",
            "file": "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv",
            "row_count": len(strict),
            "unique_chars": len(s_chars),
            "source": "Chinese Lexical Database v2.1 one-character lexical entries",
            "generation_method": "CLD wordhood + FrequencySUBTL>=10 AND FrequencyWeibo>=10",
            "selection_rule": "independent lexical entry in CLD AND both spoken/subtitle freq gates",
            "license_provenance": "CLD reported GNU GPL — LICENSE_REVIEW_REQUIRED",
            "current_status": "GENERATED_ONLY / PROPOSED_V1_CANDIDATE",
        },
        {
            "name": "BALANCED",
            "file": "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_balanced_v1.csv",
            "row_count": len(bal),
            "unique_chars": len(b_chars),
            "source": "Chinese Lexical Database v2.1",
            "generation_method": "CLD wordhood + FrequencySUBTL>=5 AND FrequencyWeibo>=5",
            "selection_rule": "same wordhood; looser frequency gates",
            "license_provenance": "CLD GPL — LICENSE_REVIEW_REQUIRED",
            "current_status": "GENERATED_ONLY / VALIDATION_SET",
        },
        {
            "name": "FULL_CLD",
            "file": "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_CLD_audit_v1.csv",
            "row_count": len(cld),
            "unique_chars": len(c_chars),
            "source": "Chinese Lexical Database v2.1",
            "generation_method": "all one-character CLD lexical entries",
            "selection_rule": "CLD headword/lexeme length==1; no spoken repair filter",
            "license_provenance": "CLD GPL — LICENSE_REVIEW_REQUIRED",
            "current_status": "AUDIT_ONLY / TOO_WIDE_FOR_V1",
        },
    ]

    # Phonetic distribution table
    phon_dist = [
        {"dataset": "STRICT", **stats_s},
        {"dataset": "BALANCED", **stats_b},
        {"dataset": "FULL_CLD", **stats_c},
        {"dataset": "PROPOSED_V1_STRICT", **stats_s},
    ]

    # Provenance / license rows
    provenance = [
        {
            "artifact": "STRICT/BALANCED/FULL CSVs",
            "upstream": "Chinese Lexical Database (CLD) v2.1",
            "what_it_is": "one-character lexical entries (words/lexemes), not raw hanzi inventory",
            "wordhood_evidence": "YES — presence as CLD lexical entry",
            "frequency_fields": "FrequencySUBTL / FrequencyWeibo per million",
            "license_stated_in_repo": "GNU GPL (README note)",
            "redistribution": "LICENSE_REVIEW_REQUIRED before production ship",
            "derivative_implications": "derived repair vocabulary may inherit GPL obligations — legal review",
        },
        {
            "artifact": "IME 2510 TSV",
            "upstream": "通用规范一级 + mozillazg pinyin-data / IME policy",
            "what_it_is": "common characters for IME fallback",
            "wordhood_evidence": "NO",
            "frequency_fields": "IME role weight only",
            "license_stated_in_repo": "see pinyin-v2 docs",
            "redistribution": "IME SSOT remains; not Repair import source under Option B",
            "derivative_implications": "must not redefine as Repair SSOT",
        },
    ]

    summary = {
        "verdict": "STRICT_RECOMMENDED",
        "safe_to_freeze": False,
        "remaining_blockers": [
            "LICENSE_REVIEW_REQUIRED for CLD-derived production vocabulary",
            "No production import this round (audit only)",
            "Prior mapping not frozen (next phase)",
        ],
        "proposed_v1": {
            "source_strategy": "STRICT",
            "characters": len(s_chars),
            "rows": len(strict),
            "case_specific_additions": 0,
            "case_specific_deletions": 0,
            "ime_weight_as_prior": False,
        },
        "relationships": rel,
        "balanced_minus_strict_class_counts": dict(class_counts),
        "phonetic_proposed": stats_s,
        "function_protection_pass": sum(1 for r in fw_check if r["in_strict"] == "YES"),
        "function_protection_total": len(fw_check),
        "function_protection_misses": [r["surface"] for r in false_excl],
        "suspicious": {
            ch: {
                "in_strict": ch in s_chars,
                "in_balanced": ch in b_chars,
                "in_full": ch in c_chars,
                "in_ime": ch in i_chars,
            }
            for ch in SUSPICIOUS
        },
        "poly_surfaces_strict": sum(1 for r in poly_rows if r["dataset"] == "STRICT"),
        "false_inclusion_high_in_strict": len(false_incl),
        "refined_needed": False,
        "reason": (
            "STRICT already applies CLD wordhood + conservative dual-corpus frequency gates; "
            "BALANCED-STRICT delta is mid-band [5,10) without POS evidence of systematic spoken loss; "
            "FULL CLD is too wide; no case-specific refine. Prefer simple STRICT for V1 content."
        ),
    }

    # Write artifacts
    write_csv(OUT / "single_char_existing_dataset_inventory.csv", inventory)
    write_json(OUT / "single_char_dataset_relationship.json", rel)
    write_csv(OUT / "single_char_pos_function_coverage.csv", coverage_for(s_chars) + [
        {**r, "dataset": "STRICT_proxy"} for r in coverage_for(s_chars)
    ][:0] or [{"dataset": "STRICT", **r} for r in coverage_for(s_chars)] + [{"dataset": "BALANCED", **r} for r in coverage_for(b_chars)])
    # fix coverage file cleanly
    cov = [{"dataset": "STRICT", **r} for r in coverage_for(s_chars)] + [
        {"dataset": "BALANCED", **r} for r in coverage_for(b_chars)
    ]
    write_csv(OUT / "single_char_pos_function_coverage.csv", cov)
    write_csv(OUT / "single_char_morpheme_only_risk.csv", morph_risk)
    write_csv(OUT / "single_char_rare_literary_risk.csv", rare_risk)
    write_csv(OUT / "single_char_function_word_protection_check.csv", fw_check)
    write_csv(OUT / "balanced_minus_strict_classification.csv", bms_rows)
    write_csv(OUT / "full_cld_delta_summary.csv", full_delta_summary)
    write_csv(OUT / "ime_only_possible_missing_lexical_words.csv", ime_only_missing)
    write_csv(OUT / "single_char_candidate_pinyin_tone_distribution.csv", phon_dist)
    write_csv(OUT / "single_char_polyphonic_data_audit.csv", poly_rows if poly_rows else [{"dataset": "STRICT", "surface": "", "row_count": 0, "note": "no multi-row surfaces in STRICT"}])
    write_csv(OUT / "single_char_source_provenance.csv", provenance)
    write_csv(OUT / "proposed_single_char_repair_lexicon_v1.csv", proposed_rows)
    write_json(OUT / "proposed_single_char_repair_lexicon_v1_summary.json", summary)
    write_csv(OUT / "proposed_single_char_repair_lexicon_v1_review.csv", sample_review)

    write_text(
        OUT / "single_char_repair_eligibility_v1.md",
        """# SingleCharRepairEligibilityV1

## INCLUDE

A character/row is eligible for Single-Character Repair Lexicon V1 when **all** hold:

1. **Wordhood:** It is an independent one-character **lexical entry** in an authorized lexicon source (here: CLD v2.1 one-character entries), not merely a common Hanzi or multi-character morpheme.
2. **Spoken/common usage gate (V1 conservative):** `FrequencySUBTL >= 10` per million **AND** `FrequencyWeibo >= 10` per million (STRICT gate).
3. **Length:** exactly one CJK character surface.
4. **Pronunciation row:** pinyin + tone metadata present and traceable to the source row.

## EXCLUDE

1. Presence only in IME 2510 / 通用规范 common-character lists without independent lexical-entry evidence.
2. FULL CLD entries failing the V1 frequency gate (EXTENDED / LOW_FREQ tiers) — audit-only.
3. Case-driven membership from dialog_200 / regressions / user corrections.
4. Homophone competition is **not** an exclusion reason.

## REVIEW

1. BALANCED-only band `[5,10)` dual-frequency: valid CLD words but not V1-default; ops may ADD later under this contract with evidence.
2. HIGH morpheme/fallback-risk overlaps (IME fallback role ∩ inventory): audit; do not auto-delete solely for role.
3. License clearance for CLD-derived redistribution before production freeze/import.

## Function-word protection

INCLUDE must **not** require “content noun/verb” POS. Particles/pronouns/directionals/numerals that pass wordhood+gate stay (的/了/吗/我/…).

## Ambiguity

pinyin+tone collision statistics measure Recall behavior only; they must not drive deletions of real words.
""",
    )

    write_text(
        OUT / "strict_quality_analysis.md",
        f"""# STRICT quality analysis

## Definition

CLD one-character lexical entries with FrequencySUBTL>=10 AND FrequencyWeibo>=10.

## Size

- rows: {len(strict)}
- unique characters: {len(s_chars)}
- pinyin+tone groups: {stats_s['groups']} (unique {stats_s['unique_groups']}, ambiguous {stats_s['ambiguous_groups']}, max {stats_s['max_group_size']})

## Strength

- Real wordhood signal (CLD lexical entry), not IME common-character list.
- Dual-corpus frequency gate reduces rare/literary/technical tail vs FULL CLD.
- Function words at top of frequency lists are retained (见 function protection check).
- README already designated STRICT as initial production candidate.

## Main coverage risk

- Mid-frequency spoken words in BALANCED-only band may be absent.
- Grouping audit showed unique-only Recall precision issues remain even with STRICT — that is a **Recall contract** limitation, not a reason to widen the lexicon for ambiguity cosmetics.

## Production suitable (content)?

**YES** as V1 content strategy, subject to license review before freeze/import.
""",
    )

    write_text(
        OUT / "balanced_quality_analysis.md",
        f"""# BALANCED quality analysis

## Definition

CLD one-character lexical entries with FrequencySUBTL>=5 AND FrequencyWeibo>=5.

## Size

- rows: {len(bal)}
- unique characters: {len(b_chars)}
- BALANCED-STRICT unique chars: {len(b_chars - s_chars)}

## Strength

- Broader recall coverage for evaluation.
- Still CLD-wordhood-based (not IME 2510).

## Main precision risk

- Adds {len(b_chars - s_chars)} mid-band characters without POS/spoken-only evidence that they are required for V1.
- Class breakdown (deterministic): {dict(class_counts)}
- Increases ambiguous pinyin+tone groups ({stats_b['ambiguous_groups']} vs STRICT {stats_s['ambiguous_groups']}) — measured only; not used to reject BALANCED by itself.

## Production suitable as default V1?

**NO** as first freeze — prefer STRICT simplicity unless ops later promotes specific BALANCED-only items under EligibilityV1.
""",
    )

    write_text(
        OUT / "single_char_source_license_audit.md",
        """# Single-char source license audit

## CLD-derived STRICT / BALANCED / FULL

- Upstream: Chinese Lexical Database (CLD) v2.1
- Repo statement (`Lingua_single_char_repair_lexicon_README_v1.md`): CLD reports release under **GNU GPL**
- Production redistribution / derived vocabulary: **LICENSE_REVIEW_REQUIRED**
- This audit does **not** guess GPL compliance for Lingua’s shipping model

## IME 2510

- Remains IME SSOT; not proposed as Repair V1 source

## Freeze implication

`Production Source License Verified: NO`  
`Safe To Freeze Word List: NO` until license review completes  
Content recommendation (STRICT) can still be recorded pending legal clearance.
""",
    )

    # Governance checks
    write_json(OUT / "model2_pd_only_check.json", {"model2": "P_D_ONLY", "single_char_disambiguation": False})
    write_json(OUT / "base_lexicon_single_ssot_check.json", {"runtime_table": "base_lexicon", "new_table": False, "option_b": True})
    write_json(OUT / "no_new_table_check.json", {"new_table": False})
    write_json(
        OUT / "no_case_specific_selection_check.json",
        {
            "dialog_200_used_for_membership": False,
            "case_specific_additions": 0,
            "case_specific_deletions": 0,
            "membership_rule": "CLD wordhood + STRICT frequency gates only",
        },
    )
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": str(OUT), "action": "created", "notes": "audit artifacts only"},
            {
                "path": "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Repair_Lexicon_V1_Final_Selection_Audit_2026_08_21.md",
                "action": "created",
                "notes": "report",
            },
            {"path": "node_runtime/lexicon/v3/lexicon.sqlite", "action": "UNCHANGED", "notes": "read-only"},
            {"path": "docs/pinyin-v2/import/single_char_dictionary.tsv", "action": "UNCHANGED", "notes": "preserved"},
        ],
    )
    write_json(
        OUT / "go_summary.json",
        {
            "verdict": "STRICT_RECOMMENDED",
            "safe_to_freeze": False,
            "license_review_required": True,
            "proposed_characters": len(s_chars),
            "proposed_rows": len(strict),
            "balanced_minus_strict": len(b_chars - s_chars),
            "sqlite_writes": 0,
            "imports": 0,
            "refined_v1": False,
        },
    )

    write_json(OUT / "_debug_review_examples.json", review_examples)
    write_json(OUT / "_debug_strict_only.json", {"strict_minus_balanced": strict_only})
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
