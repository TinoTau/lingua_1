#!/usr/bin/env python3
"""Read-only lexicon sqlite recall + builder replay for KenLM P1.5 audit."""
import json
import re
import sqlite3
from pathlib import Path
from itertools import product

ROOT = Path(__file__).resolve().parents[3]
TESTS = Path(__file__).resolve().parent
DB = ROOT / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"
PERF = TESTS / "fw-detector-dialog-200-phase4e-quality-perf.json"
MANIFEST = ROOT / "test wav" / "dialog_200" / "cases.manifest.json"
MAX_SENT = 16
MIN_PRIOR = 0.5
DOMAINS = ("tech_ai", "travel", "transport", "restaurant")


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…]", "", (s or "")).lower()


def cer(ref: str, hyp: str) -> float:
    r, h = norm(ref), norm(hyp)
    if not r:
        return 1.0 if h else 0.0
    m, n = len(r), len(h)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            dp[i][j] = (
                dp[i - 1][j - 1]
                if r[i - 1] == h[j - 1]
                else 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
            )
    return dp[m][n] / len(r)


def pinyin_key(text: str) -> str:
    try:
        from pypinyin import lazy_pinyin, Style

        syl = lazy_pinyin(text, style=Style.NORMAL)
        return "|".join(x.lower().strip() for x in syl if x.strip())
    except ImportError:
        return ""


def query_tier(conn, table: str, key: str, length: int, limit: int = 12):
    if not key:
        return []
    q = f"""
      SELECT word, prior_score, repair_target, source, is_alias
      FROM {table}
      WHERE pinyin_key = ? AND length(word) = ? AND enabled = 1 AND prior_score >= ?
      ORDER BY prior_score DESC
      LIMIT ?
    """
    try:
        rows = conn.execute(q, (key, length, MIN_PRIOR, limit)).fetchall()
    except sqlite3.Error:
        return []
    return rows


def recall_span(conn, span_text: str, per_limit: int):
    key = pinyin_key(span_text)
    length = len(span_text)
    if length < 2 or length > 5 or not key:
        return []
    hits = []
    seen = set()
    for table, bucket in (
        ("domain_lexicon", "domain"),
        ("base_lexicon", "base"),
    ):
        for row in query_tier(conn, table, key, length, per_limit + 4):
            word = row[0]
            if word == span_text or word in seen:
                continue
            seen.add(word)
            rt = row[2] == 1
            bucket_use = "target" if rt else bucket
            hits.append(
                {
                    "word": word,
                    "prior": row[1],
                    "repair_target": rt,
                    "bucket": bucket_use,
                    "source": row[3] or table,
                }
            )
    hits.sort(key=lambda x: (-x["prior"], x["word"]))
    return hits[:per_limit]


def per_span_limit(n: int) -> int:
    if n <= 1:
        return 8
    if n == 2:
        return 4
    return 2


def apply_replacements(raw: str, picks):
    text = raw
    for start, end, word in sorted(picks, key=lambda x: -x[0]):
        text = text[:start] + word + text[end:]
    return text


def build_combos(raw, span_sets, cap):
    if not span_sets or any(not s for s in span_sets):
        return []
    combos = [[]]
    for span_picks in span_sets:
        combos = [c + [p] for c in combos for p in span_picks]
    scored = []
    for picks in combos:
        repl = [(p["start"], p["end"], p["word"]) for p in picks]
        text = apply_replacements(raw, repl)
        score = sum(p.get("score", 0) for p in picks)
        scored.append({"text": text, "score": score, "picks": picks})
    scored.sort(key=lambda x: -x["score"])
    return scored[:cap]


def main():
    perf = json.loads(PERF.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    ref_by_id = {c["id"]: c["utterance"] for c in manifest}
    raw_by_id = {}
    for lst in (perf.get("samples", {}).get("diffZeroBoundaryPositive"), perf.get("samples", {}).get("approvedSpan")):
        for row in lst or []:
            if row.get("raw"):
                raw_by_id[row["id"]] = row["raw"]

    cases = [c for c in perf.get("samples", {}).get("approvedSpan", []) if (c.get("approvedSpanCount") or 0) > 0]

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

    recall_stats = {"spans": 0, "candidates": 0, "by_bucket": {"base": 0, "domain": 0, "target": 0}, "by_count": {}}
    builder_stats = {"cases": 0, "pre_cap_total": 0, "post_cap_total": 0, "truncated_cases": 0}
    coverage = {"triggered": 0, "ref_in_top16": 0, "ref_in_pre_cap": 0, "ref_better_in_top16": 0}
    quality = {"A": 0, "B": 0, "C": 0, "span_total": 0}
    kenlm_input = {"total": 0, "semantic_ok": 0, "noise": 0, "has_fix": 0}
    samples_out = []

    for c in cases[:20]:
        raw = raw_by_id.get(c["id"])
        ref = ref_by_id.get(c["id"], "")
        if not raw:
            continue
        spans = []
        for s in c.get("spans", []):
            idx = raw.find(s["text"])
            if idx < 0:
                continue
            spans.append({"text": s["text"], "start": idx, "end": idx + len(s["text"])})

        if not spans:
            continue

        coverage["triggered"] += 1
        builder_stats["cases"] += 1
        limit = per_span_limit(len(spans))
        span_sets = []

        for sp in spans:
            recall_stats["spans"] += 1
            hits = recall_span(conn, sp["text"], limit)
            picks = []
            for h in hits:
                recall_stats["candidates"] += 1
                recall_stats["by_bucket"][h["bucket"]] = recall_stats["by_bucket"].get(h["bucket"], 0) + 1
                r_norm, w_norm, s_norm = norm(ref), norm(h["word"]), norm(sp["text"])
                if w_norm != s_norm:
                    if w_norm in r_norm and s_norm not in r_norm:
                        quality["A"] += 1
                    elif w_norm in r_norm:
                        quality["B"] += 1
                    else:
                        quality["C"] += 1
                    quality["span_total"] += 1
                picks.append(
                    {
                        "word": h["word"],
                        "start": sp["start"],
                        "end": sp["end"],
                        "score": h["prior"],
                        "bucket": h["bucket"],
                        "repair_target": h["repair_target"],
                    }
                )
            recall_stats["by_count"][len(picks)] = recall_stats["by_count"].get(len(picks), 0) + 1
            span_sets.append(picks)

        pre_cap = 1
        for ss in span_sets:
            pre_cap *= max(1, len(ss))
        builder_stats["pre_cap_total"] += pre_cap
        if pre_cap > MAX_SENT:
            builder_stats["truncated_cases"] += 1

        top16 = build_combos(raw, span_sets, MAX_SENT)
        all_combos = build_combos(raw, span_sets, pre_cap + 200)
        builder_stats["post_cap_total"] += len(top16)

        ref_n = norm(ref)
        in_pre = any(norm(x["text"]) == ref_n for x in all_combos)
        in_top = any(norm(x["text"]) == ref_n for x in top16)
        if in_pre:
            coverage["ref_in_pre_cap"] += 1
        if in_top:
            coverage["ref_in_top16"] += 1

        raw_cer = cer(ref, raw)
        best = min([(cer(ref, x["text"]), x["text"]) for x in top16], default=(raw_cer, raw))
        if best[0] < raw_cer - 0.001:
            coverage["ref_better_in_top16"] += 1

        for sent in [raw] + [x["text"] for x in top16]:
            kenlm_input["total"] += 1
            c_val = cer(ref, sent)
            if c_val <= 0.05 or norm(sent) == ref_n:
                kenlm_input["has_fix"] += 1
                kenlm_input["semantic_ok"] += 1
            elif c_val < raw_cer - 0.02:
                kenlm_input["semantic_ok"] += 1
                kenlm_input["has_fix"] += 1
            elif c_val > raw_cer + 0.05:
                kenlm_input["noise"] += 1

        samples_out.append(
            {
                "id": c["id"],
                "scenario": c.get("scenario"),
                "raw": raw,
                "ref": ref,
                "span_count": len(spans),
                "pre_cap": pre_cap,
                "truncated": pre_cap > MAX_SENT,
                "ref_in_top16": in_top,
                "ref_in_pre_cap": in_pre,
                "raw_cer": round(raw_cer, 4),
                "best_top16_cer": round(best[0], 4),
                "top16": [{"text": x["text"], "cer": round(cer(ref, x["text"]), 4)} for x in top16[:5]],
            }
        )

    conn.close()
    out = {
        "recall_stats": recall_stats,
        "builder_stats": builder_stats,
        "coverage": coverage,
        "quality": quality,
        "kenlm_input": kenlm_input,
        "samples": samples_out,
    }
    out_path = TESTS / "audit-kenlm-p15-readonly-data.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "samples"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
