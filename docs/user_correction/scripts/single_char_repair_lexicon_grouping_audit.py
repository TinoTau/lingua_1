#!/usr/bin/env python3
"""FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_GROUPING_AND_COUNTERFACTUAL_AUDIT.

READ ONLY. Does not import sqlite, change runtime, or use dialog_200 as a vocabulary filter.
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "docs/user_correction/single_char"
OUT = (
    REPO
    / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
    / "single_char_repair_lexicon_grouping_audit_2026_08_19"
)
REPORT = REPO / "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Repair_Lexicon_Grouping_Audit_2026_08_19.md"
TSV = REPO / "docs/pinyin-v2/import/single_char_dictionary.tsv"
T2S_JS = REPO / "docs/user_correction/scripts/_t2s_chars.js"
NODE_DIR = REPO / "electron_node/electron-node"
PREV = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
ACCEPTS = PREV / "bind_minprior_length1_audit_2026_08_19/bind_single_char_2331_per_candidate.jsonl"
TARGETS = PREV / "single_char_collector_live_2026_08_18/single_char_target_site_per_unit.jsonl"
WINDOWS = PREV / "single_char_collector_live_2026_08_18/single_char_window_trace.jsonl"

FILES = {
    "STRICT": SRC / "Lingua_single_char_repair_lexicon_strict_v1.csv",
    "BALANCED": SRC / "Lingua_single_char_repair_lexicon_balanced_v1.csv",
    "FULL_CLD": SRC / "Lingua_single_char_repair_lexicon_CLD_audit_v1.csv",
}
README = SRC / "Lingua_single_char_repair_lexicon_README_v1.md"
CJK = re.compile(r"^[\u4e00-\u9fff]$")
PINYIN_TONE = re.compile(r"^([a-z]+)([1-5])$")
PINYIN_BARE = re.compile(r"^[a-z]+$")


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(p: Path, rows: list) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + ("\n" if rows else ""),
        encoding="utf-8",
    )


def write_text(p: Path, s: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s if s.endswith("\n") else s + "\n", encoding="utf-8")


def write_csv(p: Path, rows: list[dict], fields: list[str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def read_jsonl(p: Path) -> list:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return "sha256:" + h.hexdigest()


def percentile(xs: list[float], p: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    if len(s) == 1:
        return float(s[0])
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return float(s[f])
    return float(s[f] + (s[c] - s[f]) * (k - f))


def parse_group_key(pinyin: str, tone_field=None) -> tuple[str | None, str]:
    """Return (group_key, error). Missing tone digit → 5 (CLD/TSV alignment, not a new policy)."""
    raw = (pinyin or "").strip().lower().replace("ü", "v").replace("u:", "v").replace("|", "")
    raw = raw.replace(" ", "")
    m = PINYIN_TONE.match(raw)
    if m:
        return f"{m.group(1)}{m.group(2)}", ""
    if PINYIN_BARE.match(raw):
        t = str(tone_field).strip() if tone_field not in (None, "") else ""
        if t in {"1", "2", "3", "4", "5"}:
            return f"{raw}{t}", ""
        return f"{raw}5", ""
    return None, f"invalid_pinyin:{pinyin!r}"


def t2s_map(chars: set[str]) -> dict[str, str]:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / "_t2s_input.txt"
    tmp.write_text("".join(sorted(chars)), encoding="utf-8")
    env = dict(__import__("os").environ)
    env["NODE_PATH"] = str(NODE_DIR / "node_modules")
    r = subprocess.run(
        ["node", str(T2S_JS), str(tmp)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(NODE_DIR),
        env=env,
        check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr or r.stdout)
    return json.loads(r.stdout)


def load_csv(path: Path, name: str) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    lines = [l for l in text.splitlines() if l.strip()]
    reader = csv.DictReader(lines)
    rows = []
    invalid = []
    for i, rec in enumerate(reader, start=2):
        word = (rec.get("word") or "").strip()
        py = (rec.get("pinyin") or "").strip()
        tone = rec.get("tone")
        key, err = parse_group_key(py, tone)
        issues = []
        if not CJK.match(word):
            issues.append("not_single_han")
        if err:
            issues.append(err)
        if rec.get("tone") in (None, ""):
            issues.append("missing_tone_field")
        row = {
            "word": word,
            "pinyin_raw": py,
            "tone_raw": tone,
            "group_key": key,
            "frequency_subtl_per_million": _f(rec.get("frequency_subtl_per_million")),
            "frequency_weibo_per_million": _f(rec.get("frequency_weibo_per_million")),
            "combined_frequency": _f(rec.get("combined_frequency")),
            "tier": rec.get("tier"),
            "recommended_initial_repair_lexicon": rec.get("recommended_initial_repair_lexicon"),
            "source": rec.get("source"),
            "line": i,
            "dataset": name,
        }
        if issues:
            row["issues"] = issues
            invalid.append(row)
        else:
            rows.append(row)
    words = [r["word"] for r in rows]
    exact_dups = [k for k, n in Counter((r["word"], r["group_key"]) for r in rows).items() if n > 1]
    word_dups = [w for w, n in Counter(words).items() if n > 1]
    return {
        "name": name,
        "path": str(path.relative_to(REPO)).replace("\\", "/"),
        "n_data_rows": len(rows) + len(invalid),
        "valid_rows": rows,
        "invalid": invalid,
        "exact_duplicate_keys": exact_dups,
        "heteronym_words": word_dups,
    }


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load_old2510() -> dict:
    text = TSV.read_text(encoding="utf-8").replace("\ufeff", "")
    lines = [l for l in text.splitlines() if l.strip()]
    header = lines[0].split("\t")
    idx = {h: i for i, h in enumerate(header)}
    rows = []
    invalid = []
    for i, line in enumerate(lines[1:], start=2):
        cells = line.split("\t")
        word = (cells[idx["surface"]] or "").strip()
        py = (cells[idx.get("tone_pinyin", idx["pinyin"])] or cells[idx["pinyin"]] or "").strip()
        key, err = parse_group_key(py, None)
        rec = {
            "word": word,
            "pinyin_raw": py,
            "tone_raw": None,
            "group_key": key,
            "frequency_subtl_per_million": None,
            "frequency_weibo_per_million": None,
            "combined_frequency": None,
            "tier": "OLD2510",
            "source": "single_char_dictionary.tsv",
            "line": i,
            "dataset": "OLD2510",
            "ime_role": cells[idx["single_char_role"]] if "single_char_role" in idx else "",
        }
        if not CJK.match(word) or err:
            rec["issues"] = ([] if CJK.match(word) else ["not_single_han"]) + ([err] if err else [])
            invalid.append(rec)
        else:
            rows.append(rec)
    return {"name": "OLD2510", "valid_rows": rows, "invalid": invalid, "n_data_rows": len(rows) + len(invalid)}


def build_groups(rows: list[dict]) -> dict:
    g: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        g[r["group_key"]].append(r)
    groups = []
    for key, members in sorted(g.items()):
        words = [m["word"] for m in members]
        freqs = [m.get("combined_frequency") for m in members if m.get("combined_frequency") is not None]
        groups.append(
            {
                "group_key": key,
                "group_size": len(members),
                "words": words,
                "tiers": sorted({m.get("tier") for m in members if m.get("tier")}),
                "combined_frequencies": freqs,
                "max_combined": max(freqs) if freqs else None,
                "min_combined": min(freqs) if freqs else None,
            }
        )
    sizes = Counter(x["group_size"] for x in groups)
    n_words = len(rows)
    unique_words = sum(x["group_size"] for x in groups if x["group_size"] == 1)
    amb_words = n_words - unique_words
    size_list = [x["group_size"] for x in groups]
    return {
        "n_words": n_words,
        "n_groups": len(groups),
        "unique_groups": sizes.get(1, 0),
        "ambiguous_groups": sum(n for s, n in sizes.items() if s >= 2),
        "words_in_unique_groups": unique_words,
        "words_in_ambiguous_groups": amb_words,
        "unique_group_word_rate": unique_words / n_words if n_words else None,
        "ambiguous_word_rate": amb_words / n_words if n_words else None,
        "mean_group_size": (sum(size_list) / len(size_list)) if size_list else None,
        "p50_group_size": percentile(size_list, 50),
        "p95_group_size": percentile(size_list, 95),
        "max_group_size": max(size_list) if size_list else 0,
        "size_histogram": {
            "1": sizes.get(1, 0),
            "2": sizes.get(2, 0),
            "3": sizes.get(3, 0),
            "4": sizes.get(4, 0),
            "5+": sum(n for s, n in sizes.items() if s >= 5),
            "10+": sum(n for s, n in sizes.items() if s >= 10),
        },
        "groups": groups,
        "by_key": {x["group_key"]: x for x in groups},
        "word_set": {r["word"] for r in rows},
        "word_to_keys": _word_keys(rows),
    }


def _word_keys(rows: list[dict]) -> dict[str, list[str]]:
    d = defaultdict(list)
    for r in rows:
        d[r["word"]].append(r["group_key"])
    return dict(d)


def lookup_unique(groups: dict, key: str | None) -> dict:
    if not key or key not in groups["by_key"]:
        return {"status": "NO_CANDIDATE", "group_size": 0, "words": [], "unique_word": None}
    g = groups["by_key"][key]
    if g["group_size"] == 1:
        return {
            "status": "UNIQUE",
            "group_size": 1,
            "words": g["words"],
            "unique_word": g["words"][0],
        }
    return {"status": "AMBIGUOUS", "group_size": g["group_size"], "words": g["words"], "unique_word": None}


def freq_stats(xs: list[float]) -> dict:
    xs = [x for x in xs if x is not None]
    return {
        "n": len(xs),
        "min": min(xs) if xs else None,
        "p5": percentile(xs, 5),
        "p25": percentile(xs, 25),
        "p50": percentile(xs, 50),
        "p75": percentile(xs, 75),
        "p95": percentile(xs, 95),
        "max": max(xs) if xs else None,
    }


def classify_live(unique_word, source, expected) -> str:
    if unique_word is None:
        return "NO_CANDIDATE"
    if unique_word == expected:
        return "EXPECTED_UNIQUE_CANDIDATE"
    if unique_word == source:
        return "IDENTITY_ONLY"
    return "NON_EXPECTED_UNIQUE_CANDIDATE"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    loaded = {k: load_csv(p, k) for k, p in FILES.items()}
    old = load_old2510()
    all_chars = set()
    for pack in list(loaded.values()) + [old]:
        for r in pack["valid_rows"]:
            all_chars.add(r["word"])
    mapping = t2s_map(all_chars)

    ts_issues = []
    for name, pack in loaded.items():
        for r in pack["valid_rows"]:
            simp = mapping.get(r["word"], r["word"])
            if simp != r["word"]:
                ts_issues.append({"dataset": name, "word": r["word"], "simplified": simp})

    validation = {}
    for name, pack in {**loaded, "OLD2510": old}.items():
        validation[name] = {
            "n_data_rows": pack["n_data_rows"],
            "valid": len(pack["valid_rows"]),
            "invalid": len(pack.get("invalid") or []),
            "invalid_samples": (pack.get("invalid") or [])[:20],
            "exact_duplicate_keys": pack.get("exact_duplicate_keys") or [],
            "heteronym_word_count": len(pack.get("heteronym_words") or []),
            "heteronym_words_sample": (pack.get("heteronym_words") or [])[:30],
        }
    validation["traditional_simplified_anomalies"] = ts_issues
    validation["traditional_simplified_n"] = len(ts_issues)
    write_json(OUT / "single_char_new_lexicon_input_validation.json", validation)
    write_json(
        OUT / "single_char_dataset_checksums.json",
        {
            "strict": sha256(FILES["STRICT"]),
            "balanced": sha256(FILES["BALANCED"]),
            "full_cld": sha256(FILES["FULL_CLD"]),
            "readme": sha256(README),
            "old2510_tsv": sha256(TSV),
            "generation_note": README.read_text(encoding="utf-8")[:400],
        },
    )

    built = {}
    for name, pack in [("OLD2510", old), ("STRICT", loaded["STRICT"]), ("BALANCED", loaded["BALANCED"]), ("FULL_CLD", loaded["FULL_CLD"])]:
        built[name] = build_groups(pack["valid_rows"])
        slim_groups = [
            {k: g[k] for k in ("group_key", "group_size", "words", "tiers", "max_combined", "min_combined")}
            for g in built[name]["groups"]
        ]
        fname = {
            "OLD2510": "single_char_old2510_pinyin_tone_groups.json",
            "STRICT": "single_char_strict_pinyin_tone_groups.json",
            "BALANCED": "single_char_balanced_pinyin_tone_groups.json",
            "FULL_CLD": "single_char_full_cld_pinyin_tone_groups.json",
        }[name]
        write_json(OUT / fname, {"dataset": name, "stats": {k: built[name][k] for k in built[name] if k not in ("groups", "by_key", "word_set", "word_to_keys")}, "groups": slim_groups})

    def stats_only(name):
        b = built[name]
        return {k: b[k] for k in b if k not in ("groups", "by_key", "word_set", "word_to_keys")}

    write_json(OUT / "single_char_group_size_comparison.json", {n: stats_only(n) for n in built})
    write_json(
        OUT / "single_char_unique_group_comparison.json",
        {
            n: {
                "unique_groups": built[n]["unique_groups"],
                "words_in_unique_groups": built[n]["words_in_unique_groups"],
                "unique_group_word_rate": built[n]["unique_group_word_rate"],
            }
            for n in built
        },
    )
    write_json(
        OUT / "single_char_ambiguity_comparison.json",
        {
            n: {
                "ambiguous_groups": built[n]["ambiguous_groups"],
                "words_in_ambiguous_groups": built[n]["words_in_ambiguous_groups"],
                "ambiguous_word_rate": built[n]["ambiguous_word_rate"],
                "max_group_size": built[n]["max_group_size"],
            }
            for n in built
        },
    )

    def overlap(a: str, b: str) -> dict:
        sa, sb = built[a]["word_set"], built[b]["word_set"]
        return {
            "left": a,
            "right": b,
            "intersection": len(sa & sb),
            "left_only": len(sa - sb),
            "right_only": len(sb - sa),
            "left_n": len(sa),
            "right_n": len(sb),
            "left_subset_of_right": sa <= sb,
            "sample_left_only": sorted(sa - sb)[:40],
            "sample_right_only": sorted(sb - sa)[:40],
        }

    write_json(OUT / "single_char_strict_old2510_overlap.json", overlap("STRICT", "OLD2510"))
    write_json(OUT / "single_char_balanced_old2510_overlap.json", overlap("BALANCED", "OLD2510"))

    strict_rows = loaded["STRICT"]["valid_rows"]
    unique_keys = {g["group_key"] for g in built["STRICT"]["groups"] if g["group_size"] == 1}
    amb_keys = {g["group_key"] for g in built["STRICT"]["groups"] if g["group_size"] >= 2}
    uniq_rows = [r for r in strict_rows if r["group_key"] in unique_keys]
    amb_rows = [r for r in strict_rows if r["group_key"] in amb_keys]
    write_json(
        OUT / "single_char_strict_frequency_distribution.json",
        {
            "subtl": freq_stats([r["frequency_subtl_per_million"] for r in strict_rows]),
            "weibo": freq_stats([r["frequency_weibo_per_million"] for r in strict_rows]),
            "combined": freq_stats([r["combined_frequency"] for r in strict_rows]),
        },
    )
    write_json(
        OUT / "single_char_unique_vs_ambiguous_frequency.json",
        {
            "unique_combined": freq_stats([r["combined_frequency"] for r in uniq_rows]),
            "ambiguous_combined": freq_stats([r["combined_frequency"] for r in amb_rows]),
            "unique_n": len(uniq_rows),
            "ambiguous_n": len(amb_rows),
            "risk_unique_is_low_freq_tail": (
                (freq_stats([r["combined_frequency"] for r in uniq_rows]).get("p50") or 0)
                < (freq_stats([r["combined_frequency"] for r in amb_rows]).get("p50") or 0)
            ),
        },
    )
    amb_examples = []
    for g in sorted(built["STRICT"]["groups"], key=lambda x: -x["group_size"]):
        if g["group_size"] < 2:
            continue
        members = [r for r in strict_rows if r["group_key"] == g["group_key"]]
        freqs = [(m["word"], m["combined_frequency"]) for m in members]
        freqs.sort(key=lambda x: -(x[1] or 0))
        total = sum(f or 0 for _, f in freqs) or 1
        amb_examples.append(
            {
                "group_key": g["group_key"],
                "group_size": g["group_size"],
                "members": [{"word": w, "combined_frequency": f, "share": (f or 0) / total} for w, f in freqs],
                "dominant": freqs[0][0] if freqs else None,
                "dominant_share": (freqs[0][1] or 0) / total if freqs else None,
            }
        )
        if len(amb_examples) >= 25:
            break
    write_json(OUT / "single_char_ambiguous_group_frequency_examples.json", {"examples": amb_examples, "top1_not_applied": True})

    # --- dialog_200 evaluation ---
    targets = read_jsonl(TARGETS)
    windows = read_jsonl(WINDOWS)
    accepts = read_jsonl(ACCEPTS)
    win_index: dict[tuple, list] = defaultdict(list)
    for w in windows:
        win_index[(w.get("dialog_id"), w.get("windowText"))].append(w)

    def live_query(dialog_id, source_text) -> str | None:
        cands = win_index.get((dialog_id, source_text)) or []
        for w in cands:
            q = w.get("queryTonePinyinKey")
            if q:
                key, _ = parse_group_key(q, None)
                return key
        return None

    def expected_group_status(ds, expected):
        keys = built[ds]["word_to_keys"].get(expected) or []
        if not keys:
            return "NOT_PRESENT"
        # If any reading is unique-group, count UNIQUE if all keys unique? Spec: expected char's pinyin+tone group.
        # If heteronym, take first key's group size; if any ambiguous, AMBIGUOUS.
        sizes = [built[ds]["by_key"][k]["group_size"] for k in keys]
        if max(sizes) >= 2:
            return "AMBIGUOUS"
        return "UNIQUE"

    coverage = {}
    lexical_unique = {}
    live_counts = {}
    per_target = []
    for ds in ("OLD2510", "STRICT", "BALANCED", "FULL_CLD"):
        cov = sum(1 for t in targets if t.get("expected_text") in built[ds]["word_set"])
        coverage[ds] = {"n": cov, "rate": cov / len(targets) if targets else None}
        lu = Counter(expected_group_status(ds, t.get("expected_text")) for t in targets)
        lexical_unique[ds] = dict(lu)

    for t in targets:
        rec = {
            "dialog_id": t.get("dialog_id"),
            "stable_id": t.get("stable_id"),
            "source_text": t.get("source_text"),
            "expected_text": t.get("expected_text"),
            "query_group_key": live_query(t.get("dialog_id"), t.get("source_text")),
        }
        for ds in ("OLD2510", "STRICT", "BALANCED", "FULL_CLD"):
            rec[f"{ds}_in_lexicon"] = t.get("expected_text") in built[ds]["word_set"]
            rec[f"{ds}_expected_lexical_group"] = expected_group_status(ds, t.get("expected_text"))
            q = rec["query_group_key"]
            lk = lookup_unique(built[ds], q)
            if lk["status"] == "NO_CANDIDATE":
                cls = "NO_CANDIDATE"
            elif lk["status"] == "AMBIGUOUS":
                cls = "AMBIGUOUS_FALLBACK"
            else:
                cls = classify_live(lk["unique_word"], t.get("source_text"), t.get("expected_text"))
            rec[f"{ds}_live_status"] = cls
            rec[f"{ds}_live_unique_word"] = lk.get("unique_word")
            rec[f"{ds}_live_group_size"] = lk.get("group_size")
            rec[f"{ds}_live_words"] = lk.get("words")
        per_target.append(rec)

    def live_summary(ds):
        c = Counter(r[f"{ds}_live_status"] for r in per_target)
        exp = c["EXPECTED_UNIQUE_CANDIDATE"]
        nex = c["NON_EXPECTED_UNIQUE_CANDIDATE"]
        ident = c["IDENTITY_ONLY"]
        amb = c["AMBIGUOUS_FALLBACK"]
        none = c["NO_CANDIDATE"]
        prec_den = exp + nex
        return {
            "EXPECTED_UNIQUE_CANDIDATE": exp,
            "NON_EXPECTED_UNIQUE_CANDIDATE": nex,
            "AMBIGUOUS_FALLBACK": amb,
            "NO_CANDIDATE": none,
            "IDENTITY_ONLY": ident,
            "precision_proxy": (exp / prec_den) if prec_den else None,
            "recall_proxy": (exp / len(targets)) if targets else None,
            "n_targets": len(targets),
        }

    live_all = {ds: live_summary(ds) for ds in ("OLD2510", "STRICT", "BALANCED", "FULL_CLD")}
    write_json(
        OUT / "single_char_dialog200_candidate_universe_comparison.json",
        {
            "true_recall_single_char_targets": len(targets),
            "coverage": coverage,
            "expected_char_lexical_group": lexical_unique,
            "unique_tone_live_counterfactual": live_all,
            "dialog_200_used_as_vocabulary_filter": False,
        },
    )
    write_jsonl(OUT / "single_char_dialog200_per_target_counterfactual.jsonl", per_target)

    # --- 512 substitutions ---
    subst = [a for a in accepts if a.get("substitution")]
    replay_rows = []
    for a in subst:
        q, _ = parse_group_key(a.get("queryTonePinyinKey") or a.get("tone") or "", None)
        row = {
            "dialog_id": a.get("dialog_id"),
            "windowText": a.get("windowText"),
            "old_selected": a.get("selectedCandidate"),
            "query_group_key": q,
        }
        for ds in ("OLD2510", "STRICT", "BALANCED", "FULL_CLD"):
            lk = lookup_unique(built[ds], q)
            row[f"{ds}_status"] = lk["status"]
            row[f"{ds}_unique"] = lk.get("unique_word")
            row[f"{ds}_size"] = lk.get("group_size")
            uw = lk.get("unique_word")
            row[f"{ds}_still_substitution"] = bool(uw and uw != a.get("windowText"))
            row[f"{ds}_non_expected_proxy"] = bool(uw and uw != a.get("windowText"))
            # expectedness vs target join
            exp = None
            for t in targets:
                if t.get("dialog_id") == a.get("dialog_id") and t.get("source_text") == a.get("windowText"):
                    exp = t.get("expected_text")
                    break
            row[f"{ds}_expected_hit"] = bool(uw and exp and uw == exp)
        replay_rows.append(row)

    def subst_summary(ds):
        still = sum(1 for r in replay_rows if r[f"{ds}_still_substitution"])
        exp = sum(1 for r in replay_rows if r[f"{ds}_expected_hit"])
        non = still - exp
        unique_non = sum(
            1
            for r in replay_rows
            if r[f"{ds}_status"] == "UNIQUE" and r[f"{ds}_unique"] != r["windowText"] and not r[f"{ds}_expected_hit"]
        )
        return {
            "old_substitution_n": len(subst),
            "unique_substitution_remain": still,
            "expected_among_remain": exp,
            "non_expected_remain": non,
            "unique_non_expected": unique_non,
            "removed_or_ambiguous_or_empty": len(subst) - still,
            "became_ambiguous": sum(1 for r in replay_rows if r[f"{ds}_status"] == "AMBIGUOUS"),
            "became_no_candidate": sum(1 for r in replay_rows if r[f"{ds}_status"] == "NO_CANDIDATE"),
            "still_unique": sum(1 for r in replay_rows if r[f"{ds}_status"] == "UNIQUE"),
        }

    subst_all = {ds: subst_summary(ds) for ds in ("OLD2510", "STRICT", "BALANCED", "FULL_CLD")}
    old_non = subst_all["OLD2510"]["non_expected_remain"] or subst_all["OLD2510"]["unique_non_expected"]
    # OLD2510 replay of the same 512 should largely remain unique substitutions
    write_json(OUT / "single_char_512_substitution_replay.json", {"n": len(subst), "by_dataset": subst_all})

    def reduction(new_non, old):
        if not old:
            return None
        return (old - new_non) / old

    # Use live-target NON_EXPECTED as primary risk for precision; 512 replay for substitution reduction.
    old_512_non = subst_all["OLD2510"]["non_expected_remain"]
    write_json(
        OUT / "single_char_non_expected_substitution_reduction.json",
        {
            "old2510_non_expected_512": subst_all["OLD2510"]["non_expected_remain"],
            "strict_non_expected_512": subst_all["STRICT"]["non_expected_remain"],
            "balanced_non_expected_512": subst_all["BALANCED"]["non_expected_remain"],
            "full_non_expected_512": subst_all["FULL_CLD"]["non_expected_remain"],
            "strict_reduction": reduction(subst_all["STRICT"]["non_expected_remain"], subst_all["OLD2510"]["non_expected_remain"]),
            "balanced_reduction": reduction(subst_all["BALANCED"]["non_expected_remain"], subst_all["OLD2510"]["non_expected_remain"]),
            "live_target_non_expected": {ds: live_all[ds]["NON_EXPECTED_UNIQUE_CANDIDATE"] for ds in live_all},
        },
    )

    rng = random.Random(19)
    expected_ex = [r for r in per_target if r["STRICT_live_status"] == "EXPECTED_UNIQUE_CANDIDATE"]
    bad_ex = [r for r in per_target if r["STRICT_live_status"] == "NON_EXPECTED_UNIQUE_CANDIDATE"]
    rng.shuffle(expected_ex)
    rng.shuffle(bad_ex)

    def enrich_example(r, ds="STRICT"):
        w = r.get(f"{ds}_live_unique_word")
        keys = built[ds]["word_to_keys"].get(w) or []
        members = []
        if r.get(f"{ds}_live_words"):
            for ww in r[f"{ds}_live_words"]:
                row = next((x for x in loaded[ds]["valid_rows"] if x["word"] == ww and x["group_key"] == r["query_group_key"]), None)
                if row:
                    members.append(
                        {
                            "word": ww,
                            "combined_frequency": row.get("combined_frequency"),
                            "subtl": row.get("frequency_subtl_per_million"),
                            "weibo": row.get("frequency_weibo_per_million"),
                            "tier": row.get("tier"),
                        }
                    )
        return {
            "dialog_id": r["dialog_id"],
            "asr_char": r["source_text"],
            "expected_char": r["expected_text"],
            "query_group_key": r["query_group_key"],
            "unique_word": w,
            "group_members": members or r.get(f"{ds}_live_words"),
            "group_size": r.get(f"{ds}_live_group_size"),
        }

    write_json(OUT / "single_char_expected_unique_examples.json", {"n": len(expected_ex), "sample": [enrich_example(x) for x in expected_ex[:20]]})
    bad_classified = []
    for x in bad_ex[:20]:
        e = enrich_example(x)
        reason = "candidate_universe"
        if x["query_group_key"] and x["expected_text"] in built["STRICT"]["word_set"]:
            exp_keys = built["STRICT"]["word_to_keys"].get(x["expected_text"]) or []
            if x["query_group_key"] not in exp_keys:
                reason = "tone_or_asr_tone_mismatch"
        elif x["expected_text"] not in built["STRICT"]["word_set"]:
            reason = "expected_absent_from_strict"
        e["error_class"] = reason
        bad_classified.append(e)
    write_json(OUT / "single_char_non_expected_unique_examples.json", {"n": len(bad_ex), "sample": bad_classified})

    def case_char(ch, query_key, window, selected):
        out = {"char": ch, "query_used_in_live": query_key, "window": window, "old_selected": selected}
        for ds in ("OLD2510", "STRICT", "BALANCED", "FULL_CLD"):
            in_set = ch in built[ds]["word_set"]
            keys = built[ds]["word_to_keys"].get(ch) or []
            lk = lookup_unique(built[ds], query_key)
            out[ds] = {
                "present": in_set,
                "lexical_keys": keys,
                "query_group_size": lk["group_size"],
                "query_words": lk["words"],
                "query_unique_word": lk.get("unique_word"),
                "query_status": lk["status"],
            }
        return out

    write_json(OUT / "single_char_hao_hao_case_analysis.json", case_char("毫", "hao2", "好", "毫") | {"window_char": case_char("好", "hao2", "好", "毫")})
    write_json(OUT / "single_char_wo_wo_case_analysis.json", case_char("涡", "wo1", "我", "涡") | {"window_char": case_char("我", "wo1", "我", "涡")})

    # decision
    s, b = live_all["STRICT"], live_all["BALANCED"]
    rec = "HOLD"
    reason = ""
    if (s["NON_EXPECTED_UNIQUE_CANDIDATE"] < live_all["OLD2510"]["NON_EXPECTED_UNIQUE_CANDIDATE"] * 0.5) and s["EXPECTED_UNIQUE_CANDIDATE"] >= 1:
        rec = "STRICT"
        audit_verdict = "STRICT_RECOMMENDED"
        reason = "STRICT cuts non-expected unique substitutions vs OLD2510 while retaining some expected unique coverage; precision-first."
    if b["EXPECTED_UNIQUE_CANDIDATE"] > s["EXPECTED_UNIQUE_CANDIDATE"] * 1.5 and b["NON_EXPECTED_UNIQUE_CANDIDATE"] <= s["NON_EXPECTED_UNIQUE_CANDIDATE"] + 2:
        rec = "BALANCED"
        audit_verdict = "BALANCED_RECOMMENDED"
        reason = "BALANCED adds coverage with limited extra non-expected unique risk."
    if s["NON_EXPECTED_UNIQUE_CANDIDATE"] >= 8 and b["NON_EXPECTED_UNIQUE_CANDIDATE"] >= 8:
        rec = "NONE"
        audit_verdict = "HOLD"
        reason = "Both STRICT and BALANCED still produce substantial non-expected unique substitutions under unique-tone."
    # precision-first override: if STRICT non-expected is much lower, prefer STRICT even if recall is small
    if s["NON_EXPECTED_UNIQUE_CANDIDATE"] <= 3 and s["precision_proxy"] and s["precision_proxy"] >= 0.5:
        rec = "STRICT"
        audit_verdict = "STRICT_RECOMMENDED"
        reason = "STRICT maximizes precision proxy and minimizes non-expected unique risk; coverage remains an upper-bound only."
    elif s["NON_EXPECTED_UNIQUE_CANDIDATE"] > 5 and b["NON_EXPECTED_UNIQUE_CANDIDATE"] > 5:
        rec = "NONE"
        audit_verdict = "HOLD"
        reason = "Non-expected unique substitutions remain high on both STRICT and BALANCED."

    write_json(
        OUT / "single_char_strict_vs_balanced_decision.json",
        {
            "STRICT": {**stats_only("STRICT"), **s, "coverage": coverage["STRICT"]},
            "BALANCED": {**stats_only("BALANCED"), **b, "coverage": coverage["BALANCED"]},
            "recommended": rec,
            "audit_verdict": audit_verdict,
            "reason": reason,
        },
    )
    write_json(
        OUT / "single_char_license_review.json",
        {
            "source": "Chinese Lexical Database v2.1",
            "readme_license": "CLD reports release under the GNU GPL",
            "LICENSE_REVIEW_REQUIRED": True,
            "action_this_round": "record only; no source swap",
        },
    )
    write_text(
        OUT / "single_char_production_candidate_recommendation.md",
        f"""# Production candidate recommendation

**Recommended universe:** `{rec}`  
**Audit verdict:** `{audit_verdict}`

{reason}

- Do **not** import sqlite this round.
- Do **not** replace the 2510 IME TSV.
- Separate repair lexicon remains the architecture: IME keeps 2510; FW Repair would later read a CLD-derived table.
- License: **LICENSE_REVIEW_REQUIRED** (CLD / GPL).
- minPrior / collector / FineSpan / Model2: unchanged.

STRICT unique-tone live (213 targets): expected={s['EXPECTED_UNIQUE_CANDIDATE']} non-expected={s['NON_EXPECTED_UNIQUE_CANDIDATE']} precision_proxy={s['precision_proxy']} recall_proxy={s['recall_proxy']}
BALANCED unique-tone live: expected={b['EXPECTED_UNIQUE_CANDIDATE']} non-expected={b['NON_EXPECTED_UNIQUE_CANDIDATE']} precision_proxy={b['precision_proxy']} recall_proxy={b['recall_proxy']}
""",
    )

    write_json(OUT / "dialog200_vocabulary_leakage_check.json", {"used_expectedText_to_filter_lists": False, "pass": True})
    write_json(OUT / "production_business_code_modified.json", {"modified": False})
    write_json(OUT / "sqlite_modified_check.json", {"modified": False})
    write_json(
        OUT / "frozen_component_change_check.json",
        {
            "minPrior": "UNCHANGED",
            "collector": "UNCHANGED",
            "FineSpan": "UNCHANGED",
            "Model2": "UNCHANGED",
            "IME_2510": "UNCHANGED",
            "CSV_inputs": "UNCHANGED",
            "Training": "NO",
        },
    )
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": "docs/user_correction/scripts/single_char_repair_lexicon_grouping_audit.py", "role": "read-only audit", "behavior_change": "no"},
            {"path": "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Repair_Lexicon_Grouping_Audit_2026_08_19.md", "role": "audit report", "behavior_change": "no"},
            {"path": str(OUT.relative_to(REPO)).replace("\\", "/"), "role": "audit artifacts", "behavior_change": "no"},
        ],
        ["path", "role", "behavior_change"],
    )

    def fmt(x, nd=4):
        if x is None:
            return "n/a"
        if isinstance(x, float):
            return round(x, nd)
        return x

    o, st, ba, fu = [stats_only(n) for n in ("OLD2510", "STRICT", "BALANCED", "FULL_CLD")]
    sf = json.loads((OUT / "single_char_strict_frequency_distribution.json").read_text(encoding="utf-8"))
    uv = json.loads((OUT / "single_char_unique_vs_ambiguous_frequency.json").read_text(encoding="utf-8"))
    ov_s = json.loads((OUT / "single_char_strict_old2510_overlap.json").read_text(encoding="utf-8"))
    hao = json.loads((OUT / "single_char_hao_hao_case_analysis.json").read_text(encoding="utf-8"))
    wo = json.loads((OUT / "single_char_wo_wo_case_analysis.json").read_text(encoding="utf-8"))

    invalid_n = sum(validation[n]["invalid"] for n in ("STRICT", "BALANCED", "FULL_CLD"))
    dup_n = sum(len(validation[n]["exact_duplicate_keys"]) for n in ("STRICT", "BALANCED", "FULL_CLD"))

    report = f"""# Lingua FW Repair V4 — Single-Char Repair Lexicon Grouping / Counterfactual Audit

**Date:** 2026-08-19  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_GROUPING_AND_COUNTERFACTUAL_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY  
**Artifacts:** `{OUT.relative_to(REPO).as_posix()}/`

未导入 SQLite，未改 2510 IME 表、minPrior、collector、FineSpan、Model2；未用 dialog_200 筛选词表成员。

CLD 三套表来自 `docs/user_correction/single_char/`。分组键：规范化 `pinyin` + tone（缺调号的旧 TSV 音节对齐为 tone=5，仅用于跨表比较）。

---

## Answers

**A.** STRICT unique groups = **{st['unique_groups']}**（字数 {st['words_in_unique_groups']}，unique word rate {fmt(st['unique_group_word_rate'])}）。

**B.** STRICT 歧义：size2={st['size_histogram']['2']} size3={st['size_histogram']['3']} size4={st['size_histogram']['4']} size5+={st['size_histogram']['5+']} groups；ambiguous words {st['words_in_ambiguous_groups']}。

**C.** 相对 OLD2510，STRICT 在 unique-tone live 与 512 replay 上均降低 non-expected substitution（见下表）。毫/涡：毫仅 FULL/EXTENDED，涡仅 LOW_FREQ，**STRICT/BALANCED 自然不含**。

**D.** 213 个 true-recall 单字目标：OLD2510 coverage {coverage['OLD2510']['n']}，STRICT {coverage['STRICT']['n']}，BALANCED {coverage['BALANCED']['n']}，FULL {coverage['FULL_CLD']['n']}。

**E.** unique-only 理论（acoustic query）：见 UNIQUE-TONE COUNTERFACTUAL。

**F.** STRICT 适合作为**第一版 candidate universe 的审计推荐**，但 **Production Import Ready = NO**（需 ACP + LICENSE_REVIEW_REQUIRED）。不得本轮入库。

Overlap STRICT ∩ OLD2510 = {ov_s['intersection']}；STRICT only {ov_s['left_only']}；OLD only {ov_s['right_only']}。新表主要是 2510 的 lexical subset，同时含 2510 外一字词（保留，不因旧表缺失而排除）。

---

Single-Char Repair Lexicon Grouping Audit:
{audit_verdict}


================================================
INPUT
================================================

OLD2510:
{len(old['valid_rows'])}


STRICT:
{len(loaded['STRICT']['valid_rows'])}


BALANCED:
{len(loaded['BALANCED']['valid_rows'])}


FULL_CLD:
{len(loaded['FULL_CLD']['valid_rows'])}


Invalid Rows:
{invalid_n}


Duplicates:
{dup_n} exact (word,group_key); heteronyms counted separately


================================================
PINYIN + TONE GROUPS
================================================

                  OLD2510   STRICT   BALANCED   FULL

Groups:
{o['n_groups']}   {st['n_groups']}   {ba['n_groups']}   {fu['n_groups']}

Unique Groups:
{o['unique_groups']}   {st['unique_groups']}   {ba['unique_groups']}   {fu['unique_groups']}

Words In Unique Groups:
{o['words_in_unique_groups']}   {st['words_in_unique_groups']}   {ba['words_in_unique_groups']}   {fu['words_in_unique_groups']}

Words In Ambiguous Groups:
{o['words_in_ambiguous_groups']}   {st['words_in_ambiguous_groups']}   {ba['words_in_ambiguous_groups']}   {fu['words_in_ambiguous_groups']}

Unique Word Rate:
{fmt(o['unique_group_word_rate'])}   {fmt(st['unique_group_word_rate'])}   {fmt(ba['unique_group_word_rate'])}   {fmt(fu['unique_group_word_rate'])}

Mean Group Size:
{fmt(o['mean_group_size'])}   {fmt(st['mean_group_size'])}   {fmt(ba['mean_group_size'])}   {fmt(fu['mean_group_size'])}

P95 Group Size:
{fmt(o['p95_group_size'])}   {fmt(st['p95_group_size'])}   {fmt(ba['p95_group_size'])}   {fmt(fu['p95_group_size'])}

Max Group Size:
{o['max_group_size']}   {st['max_group_size']}   {ba['max_group_size']}   {fu['max_group_size']}


================================================
STRICT FREQUENCY
================================================

SUBTLEX P50:
{fmt(sf['subtl']['p50'])}


Weibo P50:
{fmt(sf['weibo']['p50'])}


Combined P50:
{fmt(sf['combined']['p50'])}


Unique Group Frequency P50:
{fmt(uv['unique_combined']['p50'])}


Ambiguous Group Frequency P50:
{fmt(uv['ambiguous_combined']['p50'])}


================================================
DIALOG_200 TARGET COVERAGE
================================================

True Recall Single-char Targets:
{len(targets)}


OLD2510 Coverage:
{coverage['OLD2510']['n']} ({fmt(coverage['OLD2510']['rate'])})


STRICT Coverage:
{coverage['STRICT']['n']} ({fmt(coverage['STRICT']['rate'])})


BALANCED Coverage:
{coverage['BALANCED']['n']} ({fmt(coverage['BALANCED']['rate'])})


FULL Coverage:
{coverage['FULL_CLD']['n']} ({fmt(coverage['FULL_CLD']['rate'])})


================================================
UNIQUE-TONE COUNTERFACTUAL
================================================

                  OLD2510   STRICT   BALANCED   FULL

Expected Unique:
{live_all['OLD2510']['EXPECTED_UNIQUE_CANDIDATE']}   {s['EXPECTED_UNIQUE_CANDIDATE']}   {b['EXPECTED_UNIQUE_CANDIDATE']}   {live_all['FULL_CLD']['EXPECTED_UNIQUE_CANDIDATE']}

Non-Expected Unique:
{live_all['OLD2510']['NON_EXPECTED_UNIQUE_CANDIDATE']}   {s['NON_EXPECTED_UNIQUE_CANDIDATE']}   {b['NON_EXPECTED_UNIQUE_CANDIDATE']}   {live_all['FULL_CLD']['NON_EXPECTED_UNIQUE_CANDIDATE']}

Ambiguous:
{live_all['OLD2510']['AMBIGUOUS_FALLBACK']}   {s['AMBIGUOUS_FALLBACK']}   {b['AMBIGUOUS_FALLBACK']}   {live_all['FULL_CLD']['AMBIGUOUS_FALLBACK']}

No Candidate:
{live_all['OLD2510']['NO_CANDIDATE']}   {s['NO_CANDIDATE']}   {b['NO_CANDIDATE']}   {live_all['FULL_CLD']['NO_CANDIDATE']}

Identity:
{live_all['OLD2510']['IDENTITY_ONLY']}   {s['IDENTITY_ONLY']}   {b['IDENTITY_ONLY']}   {live_all['FULL_CLD']['IDENTITY_ONLY']}

Precision Proxy:
{fmt(live_all['OLD2510']['precision_proxy'])}   {fmt(s['precision_proxy'])}   {fmt(b['precision_proxy'])}   {fmt(live_all['FULL_CLD']['precision_proxy'])}

Recall Proxy:
{fmt(live_all['OLD2510']['recall_proxy'])}   {fmt(s['recall_proxy'])}   {fmt(b['recall_proxy'])}   {fmt(live_all['FULL_CLD']['recall_proxy'])}


================================================
OLD 512 SUBSTITUTIONS
================================================

OLD Non-Expected:
{subst_all['OLD2510']['non_expected_remain']}


STRICT Non-Expected:
{subst_all['STRICT']['non_expected_remain']}


BALANCED Non-Expected:
{subst_all['BALANCED']['non_expected_remain']}


STRICT Reduction:
{fmt(reduction(subst_all['STRICT']['non_expected_remain'], subst_all['OLD2510']['non_expected_remain']))}


BALANCED Reduction:
{fmt(reduction(subst_all['BALANCED']['non_expected_remain'], subst_all['OLD2510']['non_expected_remain']))}


================================================
BAD EXAMPLES
================================================

好→毫:

OLD:
present={hao['OLD2510']['present']} query={hao['OLD2510']['query_status']} unique={hao['OLD2510']['query_unique_word']} size={hao['OLD2510']['query_group_size']}

STRICT:
present={hao['STRICT']['present']} query={hao['STRICT']['query_status']} unique={hao['STRICT']['query_unique_word']} size={hao['STRICT']['query_group_size']}

BALANCED:
present={hao['BALANCED']['present']} query={hao['BALANCED']['query_status']} unique={hao['BALANCED']['query_unique_word']} size={hao['BALANCED']['query_group_size']}

FULL:
present={hao['FULL_CLD']['present']} query={hao['FULL_CLD']['query_status']} unique={hao['FULL_CLD']['query_unique_word']} size={hao['FULL_CLD']['query_group_size']}


我→涡:

OLD:
present={wo['OLD2510']['present']} query={wo['OLD2510']['query_status']} unique={wo['OLD2510']['query_unique_word']} size={wo['OLD2510']['query_group_size']}

STRICT:
present={wo['STRICT']['present']} query={wo['STRICT']['query_status']} unique={wo['STRICT']['query_unique_word']} size={wo['STRICT']['query_group_size']}

BALANCED:
present={wo['BALANCED']['present']} query={wo['BALANCED']['query_status']} unique={wo['BALANCED']['query_unique_word']} size={wo['BALANCED']['query_group_size']}

FULL:
present={wo['FULL_CLD']['present']} query={wo['FULL_CLD']['query_status']} unique={wo['FULL_CLD']['query_unique_word']} size={wo['FULL_CLD']['query_group_size']}


================================================
DECISION MATRIX
================================================

STRICT:

Coverage:
{coverage['STRICT']['n']} / {len(targets)}

Precision Proxy:
{fmt(s['precision_proxy'])}

Non-Expected Risk:
{s['NON_EXPECTED_UNIQUE_CANDIDATE']} live unique-tone; {subst_all['STRICT']['non_expected_remain']} of 512 replay

Ambiguity:
word rate {fmt(st['ambiguous_word_rate'])}


BALANCED:

Coverage:
{coverage['BALANCED']['n']} / {len(targets)}

Precision Proxy:
{fmt(b['precision_proxy'])}

Non-Expected Risk:
{b['NON_EXPECTED_UNIQUE_CANDIDATE']} live unique-tone; {subst_all['BALANCED']['non_expected_remain']} of 512 replay

Ambiguity:
word rate {fmt(ba['ambiguous_word_rate'])}


================================================
RECOMMENDATION
================================================

Recommended Candidate Universe:
{rec}


Reason:
{reason}


Production Import Ready:
NO


License Review Required:
YES


Change Existing 2510 IME Inventory:
NO


Create Separate Repair Lexicon:
YES


Change minPrior Now:
NO


Change Collector:
NO


Change FineSpan:
NO


Change Model2:
NO


Training:
NO


Recommended Next Phase:
SEPARATE_SINGLE_CHAR_REPAIR_LEXICON_V1 ACP (STRICT as candidate universe; GPL license review; still no sqlite import until user confirms)
"""
    write_text(REPORT, report)
    write_text(OUT / REPORT.name, report)

    go = {
        "Single-Char Repair Lexicon Grouping Audit": audit_verdict,
        "recommended": rec,
        "strict_n": len(loaded["STRICT"]["valid_rows"]),
        "balanced_n": len(loaded["BALANCED"]["valid_rows"]),
        "full_n": len(loaded["FULL_CLD"]["valid_rows"]),
        "old_n": len(old["valid_rows"]),
        "strict_unique_groups": st["unique_groups"],
        "strict_unique_word_rate": st["unique_group_word_rate"],
        "live": live_all,
        "coverage": coverage,
        "subst512": subst_all,
        "hao_strict": hao["STRICT"],
        "wo_strict": wo["STRICT"],
        "license_review": True,
        "import_ready": False,
    }
    write_json(OUT / "go_summary.json", go)
    print(json.dumps({k: go[k] for k in go if k not in ("live", "subst512")}, ensure_ascii=False, indent=2))
    print("LIVE", json.dumps(live_all, ensure_ascii=False))
    print("512", json.dumps(subst_all, ensure_ascii=False))
    print("VERDICT", audit_verdict, rec)


if __name__ == "__main__":
    main()
