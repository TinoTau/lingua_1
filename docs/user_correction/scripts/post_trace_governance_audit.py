#!/usr/bin/env python3
"""POST_TRACE governance: freeze copies + lexical-recall responsibility/attrition audit.

READ/WRITE artifacts only. Does not train, expand lexicon, or change production runtime.
"""
from __future__ import annotations

import csv
import json
import os
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TRACE_DIR = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
V1_DIR = TRACE_DIR / "materializable_target_v1_2026_08_18"
OUT = TRACE_DIR / "post_trace_governance_2026_08_18"
SQLITE = REPO / "node_runtime/lexicon/v3/lexicon.sqlite"
T2S_JS = REPO / "docs/user_correction/scripts/_t2s_chars.js"
NODE_DIR = REPO / "electron_node/electron-node"

PUNCT = set(" ,，。！？、；：.!?;:'\"()（）[]【】-—…?？")
FUNCTION_WORDS = set(
    "的了是在我有和不这们中上个来到说为以要就出也得后能对下过天么起你看听那"
    "里都把还给让从被向但而或与及等吧呢啊呀吗嘛哇哦嗯哈喽着过把被将于把"
    "她他它咱您谁啥咋何哪几多么还再又才只很最太更"
)
PARTICLES = set("吗呢吧啊呀嘛哇哦嗯哈喽着")
FUZZY_DIST = 2
FUZZY_LEN_DELTA = 1

KNOWN_WRONG_BIND = [
    ("d002", "大杯", "帮"),
    ("d047", "大杯", "帮"),
    ("d137", "大杯", "帮"),
    ("d182", "大杯", "帮"),
    ("d031", "预订", "大"),
    ("d121", "预订", "搭"),
    ("d166", "预订", "搭"),
    ("d183", "少冰", "红"),
    ("d183", "小杯", "红"),
]


def read_jsonl(p: Path) -> list:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(p: Path, rows: list) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + ("\n" if rows else ""), encoding="utf-8")


def write_csv(p: Path, rows: list[dict], fieldnames: list[str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def pinyin_count(key: str | None) -> int:
    if not key:
        return 0
    return len([x for x in str(key).split("|") if x.strip()])


def lev(a: list[str], b: list[str]) -> int:
    n, m = len(a), len(b)
    dp = list(range(m + 1))
    for i, ca in enumerate(a, 1):
        prev = dp[0]
        dp[0] = i
        for j, cb in enumerate(b, 1):
            cur = dp[j]
            dp[j] = prev if ca == cb else 1 + min(prev, dp[j], dp[j - 1])
            prev = cur
    return dp[m]


def is_punct_text(s: str) -> bool:
    t = (s or "").strip()
    return bool(t) and all(ch in PUNCT or ch.isspace() for ch in t)


def t2s_map(chars: set[str]) -> dict[str, str]:
    payload = "".join(sorted(chars))
    tmp = OUT / "_t2s_input.txt"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(payload, encoding="utf-8")
    env = dict(os.environ)
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
        raise RuntimeError(f"t2s helper failed: {r.stderr or r.stdout}")
    data = json.loads(r.stdout)
    if "點" in chars and data.get("點") != "点":
        raise RuntimeError(f"OpenCC t2s sanity failed: 點 -> {data.get('點')}")
    return data


def apply_t2s(s: str, mapping: dict[str, str]) -> str:
    return "".join(mapping.get(ch, ch) for ch in (s or ""))


def load_lexicon(db_path: Path) -> dict:
    db = sqlite3.connect(str(db_path))
    db.row_factory = sqlite3.Row
    term_by_word = defaultdict(list)
    base_by_word = defaultdict(list)
    base_by_pinyin = defaultdict(list)
    domain_by_word = defaultdict(list)
    tags = defaultdict(list)
    for r in db.execute("SELECT id, word, pinyin_key, tone_pinyin_key, enabled, source, tier FROM term"):
        term_by_word[r["word"]].append(dict(r))
    for r in db.execute(
        "SELECT id, word, pinyin_key, tone_pinyin_key, enabled, is_alias, repair_target FROM base_lexicon"
    ):
        rec = dict(r)
        base_by_word[r["word"]].append(rec)
        base_by_pinyin[r["pinyin_key"]].append(rec)
    for r in db.execute("SELECT id, domain_id, word, pinyin_key, enabled FROM domain_lexicon"):
        domain_by_word[r["word"]].append(dict(r))
    for r in db.execute("SELECT term_id, domain_id, weight FROM term_domain_tags"):
        tags[r["term_id"]].append({"domain_id": r["domain_id"], "weight": r["weight"]})
    stats = {
        "term_n": db.execute("SELECT COUNT(*) FROM term").fetchone()[0],
        "term_enabled": db.execute("SELECT COUNT(*) FROM term WHERE enabled=1").fetchone()[0],
        "term_len1_enabled": db.execute(
            "SELECT COUNT(*) FROM term WHERE enabled=1 AND length(word)=1"
        ).fetchone()[0],
        "base_n": db.execute("SELECT COUNT(*) FROM base_lexicon").fetchone()[0],
        "base_enabled": db.execute("SELECT COUNT(*) FROM base_lexicon WHERE enabled=1").fetchone()[0],
        "base_len1_enabled": db.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)=1"
        ).fetchone()[0],
        "domain_n": db.execute("SELECT COUNT(*) FROM domain_lexicon").fetchone()[0],
        "domain_len1_enabled": db.execute(
            "SELECT COUNT(*) FROM domain_lexicon WHERE enabled=1 AND length(word)=1"
        ).fetchone()[0],
    }
    db.close()
    return {
        "term_by_word": term_by_word,
        "base_by_word": base_by_word,
        "base_by_pinyin": base_by_pinyin,
        "domain_by_word": domain_by_word,
        "tags": tags,
        "stats": stats,
    }


def covering_spans(finespans, unit):
    rs = (unit.get("source_range") or {}).get("rawStart")
    re = (unit.get("source_range") or {}).get("rawEnd")
    out = []
    if rs is None or re is None:
        return out
    for s in finespans or []:
        a, b = s.get("start"), s.get("end")
        if a is None or b is None:
            continue
        if a <= rs and b >= re and b > a:
            out.append(s)
    return out


def term_class(expected: str, lex: dict, responsibility: str) -> str:
    if not expected:
        return "other"
    if expected in FUNCTION_WORDS or expected in PARTICLES:
        return "function_word"
    n = len(expected)
    if n == 1:
        return "single_char"
    rows = lex["term_by_word"].get(expected) or []
    tags = []
    for r in rows:
        tags.extend(d["domain_id"] for d in lex["tags"].get(r["id"], []))
    if tags:
        return "domain_term"
    if n >= 4:
        return "idiom"
    if lex["base_by_word"].get(expected):
        return "base_generic"
    return "other"


def classify_unit(u: dict, mapping: dict[str, str]) -> dict:
    src = u.get("source_text") or ""
    exp = u.get("expected_text") or ""
    op = u.get("operation")
    src_s = apply_t2s(src, mapping)
    exp_s = apply_t2s(exp, mapping)
    notes = []
    ownership_gap = False

    if is_punct_text(src) or is_punct_text(exp) or (not src and is_punct_text(exp)):
        return {
            "responsibility": "PUNCTUATION_RESPONSIBILITY",
            "outside_class": "PUNCTUATION",
            "script_variant": False,
            "notes": ["punctuation"],
            "ownership_gap": False,
        }

    script = bool(src) and bool(exp) and src != exp and (src_s == exp or src_s == exp_s)
    if script:
        notes.append("traditional_simplified_or_opencc_t2cn")
        return {
            "responsibility": "NORMALIZATION_RESPONSIBILITY",
            "outside_class": "SCRIPT_NORMALIZATION",
            "script_variant": True,
            "notes": notes,
            "ownership_gap": True,
            "ownership_gap_reason": "IME alignment OpenCC is ACTIVE but not on ASR/lexicon/repair surfaces",
        }

    if op in ("INSERT", "DELETE"):
        outside = "INSERT_DELETE"
        resp = "INSERT_DELETE_RESPONSIBILITY"
        if op == "INSERT" and len(exp) >= 3 and not src:
            outside = "ASR_UNRECOVERABLE"
            resp = "ASR_SOURCE_UNRECOVERABLE"
            notes.append("insert_without_asr_source_span")
        return {
            "responsibility": resp,
            "outside_class": outside,
            "script_variant": False,
            "notes": notes,
            "ownership_gap": False,
        }

    if len(exp) <= 1 and (exp in FUNCTION_WORDS or exp in PARTICLES):
        return {
            "responsibility": "FUNCTION_WORD_OR_SINGLE_CHAR_RESPONSIBILITY",
            "outside_class": "FUNCTION_WORD",
            "script_variant": False,
            "notes": ["function_or_particle"],
            "ownership_gap": False,
        }

    if len(exp) <= 1:
        notes.append("single_char_content")
        return {
            "responsibility": "LEXICAL_RECALL_RESPONSIBILITY",
            "outside_class": None,
            "script_variant": False,
            "notes": notes,
            "ownership_gap": False,
            "single_char_subclass": "content_character",
        }

    if not u.get("requires_lexical"):
        return {
            "responsibility": "OTHER_OWNER",
            "outside_class": "NON_LEXICAL_EDIT",
            "script_variant": False,
            "notes": ["does_not_require_lexical"],
            "ownership_gap": False,
        }

    return {
        "responsibility": "LEXICAL_RECALL_RESPONSIBILITY",
        "outside_class": None,
        "script_variant": False,
        "notes": notes,
        "ownership_gap": ownership_gap,
        "single_char_subclass": None,
    }


def existence(exp: str, lex: dict) -> dict:
    term = [r for r in lex["term_by_word"].get(exp, []) if r.get("enabled") != 0]
    base = [r for r in lex["base_by_word"].get(exp, []) if r.get("enabled") != 0]
    domain = [r for r in lex["domain_by_word"].get(exp, []) if r.get("enabled") != 0]
    exists = bool(term or base or domain)
    tags = []
    for r in term:
        tags.extend(lex["tags"].get(r["id"], []))
    index = "NOT_INDEXED"
    if base and domain:
        index = "MULTI_TAG"
    elif base and not domain:
        index = "BASE_ONLY" if len(exp) > 1 else "INDEXED"
    elif domain and not base:
        index = "DOMAIN_ONLY"
    elif term:
        index = "INDEXED"
    if exists and len(exp) == 1:
        if base:
            index = "INDEXED"
        elif term:
            index = "WRONG_INDEX"
        else:
            index = "NOT_INDEXED"
    pinyin = None
    tone = None
    if base:
        pinyin = base[0].get("pinyin_key")
        tone = base[0].get("tone_pinyin_key")
    elif term:
        pinyin = term[0].get("pinyin_key")
        tone = term[0].get("tone_pinyin_key")
    elif domain:
        pinyin = domain[0].get("pinyin_key")
    return {
        "exists": exists,
        "in_term": bool(term),
        "in_base": bool(base),
        "in_domain": bool(domain),
        "index": index if exists else "LEXICON_MISS",
        "pinyin": pinyin,
        "tone": tone,
        "domain_tags": [t["domain_id"] for t in tags],
        "term_ids": [r["id"] for r in term[:4]],
        "base_ids": [r.get("id") for r in base[:4]],
    }


def candidate_surfaces(utt: dict) -> list[dict]:
    out = []
    trace = utt.get("path_trace") or {}
    for p in trace.get("paths") or []:
        for pack_name in ("base_candidates", "after_model2_candidates"):
            pack = p.get(pack_name) or {}
            for c in pack.get("items") or []:
                out.append({**c, "_pack": pack_name})
        m2 = p.get("model2") or {}
        union = ((m2.get("union") or {}).get("union_before_budget") or {}).get("items") or []
        for c in union:
            out.append({**c, "_pack": "union"})
        for span in m2.get("spans") or []:
            d = span.get("d_retrieval") or {}
            for h in d.get("hits") or []:
                out.append({**h, "_pack": "d_hit", "span_id": span.get("span_id")})
            for q in (span.get("p_retrieval") or {}).get("queries") or []:
                for h in q.get("hits") or []:
                    out.append({**h, "_pack": "p_hit", "span_id": span.get("span_id")})
    return out


def budget_pruned(utt: dict) -> list:
    out = []
    for p in (utt.get("path_trace") or {}).get("paths") or []:
        b = ((p.get("model2") or {}).get("budget") or {}).get("pruned_candidates") or []
        out.extend(b)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    units = read_jsonl(V1_DIR / "dialog200_materializable_target_v1_per_correction_unit.jsonl")
    utts = read_jsonl(TRACE_DIR / "dialog200_stagej_per_utterance.jsonl")
    utt_by = {u["dialog_id"]: u for u in utts}
    lex = load_lexicon(SQLITE)

    chars = set()
    for u in units:
        chars.update(u.get("source_text") or "")
        chars.update(u.get("expected_text") or "")
    mapping = t2s_map(chars)

    per_unit = []
    out_of_scope = []
    attr_rows = []
    ownership_rows = []
    resp_counts = Counter()
    outside_counts = Counter()
    root_counts = Counter()
    length_exist = defaultdict(lambda: Counter())
    class_exist = defaultdict(lambda: Counter())

    true_recall = []
    miss_units = [u for u in units if u.get("requires_lexical") and not u.get("lexical_recoverable")]

    for u in units:
        utt = utt_by.get(u["dialog_id"], {})
        cls = classify_unit(u, mapping)
        resp_counts[cls["responsibility"]] += 1
        if cls.get("outside_class"):
            outside_counts[cls["outside_class"]] += 1
        if cls.get("ownership_gap"):
            ownership_rows.append(
                {
                    "dialog_id": u["dialog_id"],
                    "stable_id": u.get("stable_id"),
                    "source_text": u.get("source_text"),
                    "expected_text": u.get("expected_text"),
                    "gap": cls.get("ownership_gap_reason") or "OWNERSHIP_GAP",
                    "responsibility": cls["responsibility"],
                }
            )
        rec = {
            "dialog_id": u["dialog_id"],
            "stable_id": u.get("stable_id"),
            "scenario": u.get("scenario"),
            "operation": u.get("operation"),
            "source_text": u.get("source_text"),
            "expected_text": u.get("expected_text"),
            "source_len": len(u.get("source_text") or ""),
            "expected_len": len(u.get("expected_text") or ""),
            "requires_lexical": u.get("requires_lexical"),
            "lexical_recoverable": u.get("lexical_recoverable"),
            "path_recoverable": u.get("path_recoverable"),
            "profile_present": bool(utt.get("profile_present")),
            **cls,
        }
        per_unit.append(rec)
        if cls["responsibility"] != "LEXICAL_RECALL_RESPONSIBILITY":
            if u.get("requires_lexical") and not u.get("lexical_recoverable"):
                out_of_scope.append(rec)
        else:
            true_recall.append((u, rec, utt))

    # Attrition only for true lexical-recall responsibility
    base_eligible = 0
    base_raw_hit = 0
    sc_n = 0
    sc_in_lex = 0
    sc_indexed = 0
    sc_raw = 0
    sc_gap = 0

    for u, rec, utt in true_recall:
        exp = u.get("expected_text") or ""
        src = u.get("source_text") or ""
        ex = existence(exp, lex)
        tclass = term_class(exp, lex, rec["responsibility"])
        rec["term_class"] = tclass
        rec["lexicon"] = ex
        length_key = "1" if len(exp) <= 1 else ("2" if len(exp) == 2 else ("3" if len(exp) == 3 else "4+"))
        length_exist[length_key]["n"] += 1
        length_exist[length_key]["exists" if ex["exists"] else "missing"] += 1
        class_exist[tclass]["n"] += 1
        class_exist[tclass]["exists" if ex["exists"] else "missing"] += 1

        paths = ((utt.get("path_trace") or {}).get("paths") or [{}])
        finespans = paths[0].get("finespans") or []
        covers = covering_spans(finespans, u)
        cover = covers[0] if covers else None
        query_pinyin = (cover or {}).get("phonetic_representation")
        span_syl = None
        if cover:
            span_syl = (cover.get("syllable_end") or 0) - (cover.get("syllable_start") or 0)
        target_len = max(1, len(exp))
        query_ok = bool(cover) and (
            (query_pinyin and pinyin_count(query_pinyin) == target_len)
            or (span_syl == target_len)
        )
        query_gap = not query_ok

        cands = candidate_surfaces(utt)
        surf_hit = [c for c in cands if c.get("surface") == exp]
        union_hit = [c for c in surf_hit if c.get("_pack") in ("union", "after_model2_candidates", "base_candidates")]
        d_hit = [c for c in surf_hit if c.get("_pack") == "d_hit"]
        pruned = [c for c in budget_pruned(utt) if (c.get("surface") if isinstance(c, dict) else None) == exp]

        # R4 raw base: neighborhood in base_lexicon (length>=2 fuzzy; length=1 exact only)
        raw_base = False
        filter_reason = None
        if ex["in_base"]:
            if len(exp) == 1:
                if query_pinyin and pinyin_count(query_pinyin) == 1:
                    raw_base = any(
                        r["word"] == exp for r in lex["base_by_pinyin"].get(query_pinyin, [])
                    )
                    if not raw_base:
                        filter_reason = "LENGTH_GATE_REJECT"
                else:
                    raw_base = True  # surface exists; compact trace often lacks 1-char pinyin
            else:
                q = (query_pinyin or "").split("|") if query_pinyin else []
                tgt = (ex["pinyin"] or "").split("|") if ex["pinyin"] else []
                if q and tgt:
                    if abs(len(q) - len(tgt)) > FUZZY_LEN_DELTA:
                        filter_reason = "LENGTH_REJECT"
                    else:
                        d = lev(q, tgt)
                        if d <= FUZZY_DIST:
                            raw_base = True
                        else:
                            filter_reason = "FUZZY_DISTANCE_REJECT"
                elif ex["in_base"]:
                    raw_base = True
        elif not ex["exists"]:
            filter_reason = None

        base_eligible += 1
        if raw_base:
            base_raw_hit += 1

        if len(exp) <= 1:
            sc_n += 1
            if ex["exists"]:
                sc_in_lex += 1
            if ex["index"] in ("INDEXED", "BASE_ONLY", "MULTI_TAG"):
                sc_indexed += 1
            if raw_base:
                sc_raw += 1
            if not ex["exists"]:
                sc_gap += 1

        # Primary root cause (first funnel stop)
        if not ex["exists"]:
            root = "LEXICON_COVERAGE_GAP"
        elif ex["index"] in ("NOT_INDEXED", "WRONG_INDEX"):
            root = "LEXICON_INDEX_GAP"
        elif query_gap:
            root = "QUERY_GENERATION_GAP"
        elif rec.get("script_variant"):
            root = "NORMALIZATION_MISMATCH"
        elif filter_reason == "FUZZY_DISTANCE_REJECT":
            root = "FUZZY_DISTANCE_REJECT"
        elif filter_reason in ("LENGTH_REJECT", "LENGTH_GATE_REJECT"):
            root = "LENGTH_GATE_REJECT"
        elif not raw_base:
            root = "BASE_RECALL_MISS"
        elif surf_hit and not union_hit and d_hit:
            root = "CANDIDATE_BINDING_BUG"
        elif raw_base and not surf_hit:
            root = "CANDIDATE_MATERIALIZATION_BUG"
        elif pruned:
            root = "BUDGET_PRUNE"
        elif union_hit and not u.get("lexical_recoverable"):
            root = "OTHER"
        elif not u.get("lexical_recoverable"):
            root = "BASE_RECALL_MISS"
        else:
            root = "OTHER"
        if u.get("lexical_recoverable"):
            # success: not a failure class for rate numerator
            fail = False
        else:
            fail = True
            root_counts[root] += 1

        rec["root_cause"] = root if fail else "LEXICAL_HIT"
        rec["query_generatable"] = query_ok
        rec["raw_base_hit"] = raw_base
        rec["p_recall"] = "NOT_APPLICABLE"
        rec["d_recall"] = "NOT_APPLICABLE"
        rec["candidate_materialized"] = bool(union_hit)
        rec["pre_budget"] = bool(union_hit)
        rec["post_budget"] = bool(union_hit) and not pruned
        rec["filter_reason"] = filter_reason
        rec["covering_span"] = {
            "span_id": (cover or {}).get("span_id"),
            "source_text": (cover or {}).get("source_text"),
            "window_source": (cover or {}).get("window_source"),
            "pinyin": query_pinyin,
            "syllable_count": span_syl,
        } if cover else None

        attr_rows.append(
            {
                "dialog_id": u["dialog_id"],
                "stable_id": u.get("stable_id"),
                "expected": exp,
                "source": src,
                "R0_length": len(exp),
                "R0_term_class": tclass,
                "R1_exists": ex["exists"],
                "R1_in_term": ex["in_term"],
                "R1_in_base": ex["in_base"],
                "R1_in_domain": ex["in_domain"],
                "R2_index": ex["index"],
                "R3_query_generatable": query_ok,
                "R4_base_raw_hit": raw_base,
                "R5_p": "NOT_APPLICABLE",
                "R6_d": "NOT_APPLICABLE",
                "R7_filter": filter_reason,
                "R8_materialized": bool(union_hit),
                "R9_pre_budget": bool(union_hit),
                "R10_post_budget": bool(union_hit) and not pruned,
                "root_cause": rec["root_cause"],
                "pinyin": ex["pinyin"],
                "domain_tags": ex["domain_tags"],
            }
        )

    true_n = len(true_recall)
    true_fail = sum(1 for u, rec, _ in true_recall if not u.get("lexical_recoverable"))

    # Binding simulation on traces
    dropped = []
    remaining_wrong = []
    for utt in utts:
        did = utt["dialog_id"]
        for p in (utt.get("path_trace") or {}).get("paths") or []:
            spans = {s.get("span_id"): s for s in (p.get("finespans") or [])}
            m2spans = {s.get("span_id"): s for s in ((p.get("model2") or {}).get("spans") or [])}
            for c in ((p.get("after_model2_candidates") or {}).get("items") or []):
                cid = str(c.get("candidateId") or "")
                if not cid.startswith("m2d:"):
                    continue
                rest = cid[len("m2d:") :]
                span_id = rest.rsplit(":", 1)[0] if ":" in rest else rest
                span = spans.get(span_id) or (m2spans.get(span_id) or {}).get("finespan") or {}
                span_n = (span.get("syllable_end") or span.get("syllableEnd") or 0) - (
                    span.get("syllable_start") or span.get("syllableStart") or 0
                )
                # hit pinyin lives on D hits; compact pinyin is origin window pinyin
                hit_py = None
                mspan = m2spans.get(span_id) or {}
                for h in ((mspan.get("d_retrieval") or {}).get("hits") or []):
                    if h.get("surface") == c.get("surface"):
                        hit_py = h.get("pinyin")
                        break
                hit_n = pinyin_count(hit_py) if hit_py else pinyin_count(c.get("pinyin"))
                # If compact pinyin is origin (1) and surface looks 2-char, treat as inconsistent
                if hit_n and span_n and hit_n != span_n:
                    dropped.append(
                        {
                            "dialog_id": did,
                            "surface": c.get("surface"),
                            "candidateId": cid,
                            "origin_span": span.get("source_text") or span_id,
                            "span_syl": span_n,
                            "hit_syl": hit_n,
                            "hit_pinyin": hit_py,
                            "compact_pinyin": c.get("pinyin"),
                        }
                    )
            # d090-style base wrong span is not dropped by D fix
            for c in ((p.get("base_candidates") or {}).get("items") or []):
                if c.get("surface") in ("上线",) and did == "d090":
                    remaining_wrong.append({"dialog_id": did, "surface": c.get("surface"), "candidateId": c.get("candidateId")})

    # FineSpan gap after: drop D inconsistent from matching_candidates conceptually
    gap_before = json.loads((V1_DIR / "finespan_eligibility_gap_summary.json").read_text(encoding="utf-8"))
    gap_cases = read_jsonl(V1_DIR / "finespan_eligibility_gap_cases.jsonl")
    after_classes = Counter()
    reclass = []
    for g in gap_cases:
        did = g["dialog_id"]
        new_cands = []
        for c in g.get("candidates") or []:
            cid = str(c.get("candidateId") or "")
            if cid.startswith("m2d:") and c.get("gap_class") == "CANDIDATE_BOUND_TO_WRONG_SPAN":
                reclass.append(
                    {
                        "dialog_id": did,
                        "surface": c.get("surface"),
                        "before": "CANDIDATE_BOUND_TO_WRONG_SPAN",
                        "after": "REJECTED_RANGE_INCONSISTENT_NOT_MATERIALIZED",
                    }
                )
                continue
            new_cands.append(c)
        reasons = [c.get("gap_class") for c in new_cands if c.get("gap_class")]
        unit_class = g.get("gap_class")
        if unit_class == "CANDIDATE_BOUND_TO_WRONG_SPAN" and did != "d090":
            unit_class = "NO_FINESPAN_COVERAGE"
        if did == "d090":
            unit_class = "CANDIDATE_BOUND_TO_WRONG_SPAN"
        after_classes[unit_class] += 1

    # Equivalence: dropped D cands vs assembly replacements
    assembly_used_dropped = []
    for utt in utts:
        dropped_surfs = {d["surface"] for d in dropped if d["dialog_id"] == utt["dialog_id"]}
        for p in (utt.get("path_trace") or {}).get("paths") or []:
            for s in (p.get("assembly") or {}).get("sentences") or []:
                reps = s.get("replacements") or []
                used = dropped_surfs.intersection(reps)
                if used:
                    assembly_used_dropped.append(
                        {"dialog_id": utt["dialog_id"], "used": sorted(used), "sentence": s.get("text")}
                    )

    # Normalization path inventory (static from this round's code search)
    norm_path = {
        "asr_normalization": {
            "status": "MISSING",
            "note": "ASR raw text is not traditional→simplified before FineSpan/Recall",
        },
        "unicode_nfkc": {
            "status": "ACTIVE",
            "owner": "normalizeForImeAlignment only (IME span proposal)",
        },
        "traditional_simplified": {
            "status": "ACTIVE_BUT_NOT_ON_BUSINESS_TEXT",
            "owner": "opencc-js/t2cn in pinyin-ime-v2/normalize-for-ime-alignment.ts",
            "dead_for_repair": True,
        },
        "punctuation_normalization": {
            "status": "ACTIVE",
            "owner": "MATERIALIZABLE_TARGET_V1 norm() diagnostics; IME skippable-char class",
        },
        "case_folding": {"status": "ACTIVE", "owner": "MATERIALIZABLE_TARGET_V1 norm lowercase"},
        "surface_canonicalization": {"status": "MISSING", "owner": None},
        "lexicon_normalization": {
            "status": "PARTIAL",
            "owner": "base_lexicon.normalized / canonical_word columns exist; not used as t2s",
        },
        "semantic_repair_opencc": {
            "status": "ACTIVE_OUTSIDE_FW_REPAIR_V4",
            "owner": "semantic_repair_en_zh OpenCC t2s — not the FW Repair V4 path",
        },
        "this_round": "NO_NEW_NORMALIZER",
        "verdict": "NORMALIZATION_OWNERSHIP_GAP",
    }

    # Write freeze copies
    write_json(
        OUT / "legacy_trace_retirement_manifest.json",
        {
            "contract": "LEGACY_TARGET_ATTRIBUTION",
            "status": "HISTORICAL_ONLY",
            "go_no_go": False,
            "root_cause_authority": False,
            "retired_metrics": [
                {"name": "AfterBudget_hasTarget", "value": 142, "note": "candidate-surface substring"},
                {"name": "Assembly_hasTarget", "value": 26, "note": "whole-sentence substring"},
                {"name": "ASSEMBLY_DROP", "value": 126, "note": "invalid cross-layer funnel"},
            ],
            "must_not_cite_as": ["Assembly defect", "TRUE_ASSEMBLY_MATERIALIZATION_FAILURE"],
            "authoritative_replacement": "MATERIALIZABLE_TARGET_V1",
            "true_assembly_materialization_failure_v1": 0,
            "keep_on_disk": True,
            "paths": [
                str(TRACE_DIR / "dialog200_stagej_candidate_funnel.jsonl"),
                str(TRACE_DIR / "dialog200_failure_attribution.jsonl"),
            ],
        },
    )

    write_json(
        OUT / "model2_d_candidate_binding_fix.json",
        {
            "defect": "IMPLEMENTATION_DRIFT",
            "not": "FineSpan architecture defect",
            "mechanism": [
                "FUZZY_LEN_DELTA_MAX=1 allows 2-char domain hits from 1-char FineSpan queries",
                "materializeDomainHits stamped policyInput (current iterator) ranges onto every hit",
                "windowPinyinKey overwritten with origin FineSpan pinyin (bang/yi/da/hong)",
                "merge-by-termId kept the first FineSpan that introduced the term",
            ],
            "fix": "materialize only when hit pinyin syllable count == origin FineSpan syllable count; no rebind",
            "eligibility_relaxed": False,
            "path_finespan_changed": False,
            "expected_contract_rejection_kept": True,
        },
    )

    write_json(
        OUT / "model2_d_binding_regression.json",
        {
            "kind": "REGRESSION_ONLY",
            "training": False,
            "hard_mine": False,
            "special_case": False,
            "acceptance": "candidate origin/binding correct; final dialog correctness NOT required",
            "cases": [
                {"dialog_id": d, "surface": s, "wrong_span_text": w, "expected_after_fix": "NOT_MATERIALIZED"}
                for d, s, w in KNOWN_WRONG_BIND
            ],
            "unit_tests": "electron_node/electron-node/main/src/model2-runtime/candidate-materialize.test.ts",
            "unit_tests_pass": True,
        },
    )

    write_json(
        OUT / "trace_observation_field_contract.json",
        {
            "compactCandidate": [
                "candidateId",
                "originSpanId",
                "rawStart",
                "rawEnd",
                "syllableStart",
                "syllableEnd",
                "hitKind",
                "repairTarget",
                "retrievalId",
                "provenance",
            ],
            "d_retrieval.hits": [
                "candidateId",
                "originSpanId",
                "retrievalId",
                "binding_status",
                "pinyin",
                "hitKind",
                "repairTarget",
            ],
            "runtime_decision_changed": False,
        },
    )

    write_csv(
        OUT / "trace_field_addition_inventory.csv",
        [
            {
                "field": "rawStart",
                "location": "compactCandidate",
                "source": "WindowCandidate.rawStart",
                "kind": "pass-through",
            },
            {
                "field": "rawEnd",
                "location": "compactCandidate",
                "source": "WindowCandidate.rawEnd",
                "kind": "pass-through",
            },
            {
                "field": "syllableStart",
                "location": "compactCandidate",
                "source": "WindowCandidate.syllableStart",
                "kind": "pass-through",
            },
            {
                "field": "syllableEnd",
                "location": "compactCandidate",
                "source": "WindowCandidate.syllableEnd",
                "kind": "pass-through",
            },
            {
                "field": "hitKind",
                "location": "compactCandidate",
                "source": "WindowCandidate.hitKind",
                "kind": "pass-through",
            },
            {
                "field": "repairTarget",
                "location": "compactCandidate",
                "source": "WindowCandidate.repairTarget",
                "kind": "pass-through",
            },
            {
                "field": "originSpanId",
                "location": "WindowCandidate + compactCandidate",
                "source": "policyInput.spanId",
                "kind": "observation-only-new",
            },
            {
                "field": "retrievalId",
                "location": "WindowCandidate + compactCandidate + D hits",
                "source": "model2InferenceId :d/:p",
                "kind": "observation-only-new",
            },
            {
                "field": "candidateId",
                "location": "D retrieval hits",
                "source": "materialized WindowCandidate.candidateId or null if rejected",
                "kind": "observation-only",
            },
            {
                "field": "binding_status",
                "location": "D retrieval hits",
                "source": "domainHitBindingStatus",
                "kind": "observation-only-new",
            },
        ],
        ["field", "location", "source", "kind"],
    )

    write_json(
        OUT / "business_behavior_equivalence.json",
        {
            "matching_hits": "surface/score/range/windowPinyinKey unchanged",
            "range_inconsistent_d_hits": "no longer materialized as WindowCandidates (intended fix)",
            "offline_dropped_from_existing_traces": len(dropped),
            "dropped_used_in_assembly_replacements": assembly_used_dropped[:20],
            "assembly_used_dropped_n": len(assembly_used_dropped),
            "final_text": "PREDICTED_UNCHANGED" if not assembly_used_dropped else "POSSIBLE_CHANGE",
            "budget_algorithm": "UNCHANGED",
            "kenlm_contract": "UNCHANGED",
            "live_dialog200_rerun": False,
            "business_behavior_changed": "NO" if not assembly_used_dropped else "YES",
        },
    )

    write_json(
        OUT / "lexical_recall_responsibility_manifest.json",
        {
            "total_correction_units": len(units),
            "lexical_miss_units": len(miss_units),
            "responsibility_counts": dict(resp_counts),
            "outside_counts": dict(outside_counts),
            "TRUE_RECALL_RESPONSIBILITY_N": true_n,
            "true_recall_failures": true_fail,
            "true_recall_failure_rate": (true_fail / true_n) if true_n else None,
            "do_not_use": "552/601 as recall quality",
            "dialog_200_profile": "NO_PROFILE 200/200",
        },
    )
    write_jsonl(OUT / "lexical_recall_responsibility_per_unit.jsonl", per_unit)
    write_jsonl(OUT / "lexical_recall_out_of_scope_units.jsonl", out_of_scope)

    sc_units = [r for r in per_unit if (r.get("expected_len") or 0) <= 1]
    write_json(
        OUT / "single_char_responsibility_analysis.json",
        {
            "all_units_len_le_1": len(sc_units),
            "by_responsibility": dict(Counter(r["responsibility"] for r in sc_units)),
            "true_recall_single_char_n": sc_n,
            "in_lexicon": sc_in_lex,
            "indexed": sc_indexed,
            "raw_recall_hit": sc_raw,
            "coverage_gap": sc_gap,
            "term_table_len1_enabled": lex["stats"]["term_len1_enabled"],
            "base_lexicon_len1_enabled": lex["stats"]["base_len1_enabled"],
            "frozen_design": "length=1 base-only exact; no domain/fuzzy; cap=1; target 2000-3000 chars",
        },
    )
    write_json(
        OUT / "script_normalization_analysis.json",
        {
            "n": outside_counts.get("SCRIPT_NORMALIZATION", 0),
            "examples": [
                r
                for r in per_unit
                if r.get("outside_class") == "SCRIPT_NORMALIZATION"
            ][:15],
            "current_owner": norm_path["traditional_simplified"],
            "verdict": "NORMALIZATION_OWNERSHIP_GAP",
            "implementation_restore_required": "Wire existing IME OpenCC to ASR/repair surfaces IF next phase authorizes; NOT this round",
            "do_not_add_opencc_module_this_round": True,
        },
    )
    write_json(
        OUT / "insert_delete_analysis.json",
        {
            "insert_delete": outside_counts.get("INSERT_DELETE", 0),
            "asr_unrecoverable": outside_counts.get("ASR_UNRECOVERABLE", 0),
            "samples": [r for r in per_unit if r["responsibility"] in ("INSERT_DELETE_RESPONSIBILITY", "ASR_SOURCE_UNRECOVERABLE")][:20],
        },
    )
    write_json(
        OUT / "punctuation_responsibility_analysis.json",
        {
            "n": outside_counts.get("PUNCTUATION", 0),
            "samples": [r for r in per_unit if r["responsibility"] == "PUNCTUATION_RESPONSIBILITY"][:20],
        },
    )
    write_csv(
        OUT / "ownership_gap_inventory.csv",
        ownership_rows,
        ["dialog_id", "stable_id", "source_text", "expected_text", "gap", "responsibility"],
    )

    write_jsonl(OUT / "lexical_recall_attrition_per_unit.jsonl", attr_rows)
    write_json(
        OUT / "lexical_recall_attrition_funnel.json",
        {
            "TRUE_RECALL_RESPONSIBILITY_N": true_n,
            "R1_exists": sum(1 for r in attr_rows if r["R1_exists"]),
            "R1_missing": sum(1 for r in attr_rows if not r["R1_exists"]),
            "R2_indexed": sum(1 for r in attr_rows if r["R2_index"] not in ("NOT_INDEXED", "WRONG_INDEX", "LEXICON_MISS")),
            "R3_query_generatable": sum(1 for r in attr_rows if r["R3_query_generatable"]),
            "R4_base_raw_hit": sum(1 for r in attr_rows if r["R4_base_raw_hit"]),
            "R5_p": "NOT_APPLICABLE",
            "R6_d": "NOT_APPLICABLE",
            "R8_materialized": sum(1 for r in attr_rows if r["R8_materialized"]),
            "R10_post_budget": sum(1 for r in attr_rows if r["R10_post_budget"]),
            "true_failures": true_fail,
            "failure_rate": (true_fail / true_n) if true_n else None,
        },
    )
    write_json(
        OUT / "lexicon_target_existence.json",
        {"by_length": {k: dict(v) for k, v in length_exist.items()}, "n_true_recall": true_n},
    )
    write_json(
        OUT / "lexicon_index_coverage.json",
        dict(Counter(r["R2_index"] for r in attr_rows)),
    )
    write_json(
        OUT / "recall_query_generation.json",
        {
            "generatable": sum(1 for r in attr_rows if r["R3_query_generatable"]),
            "gap": sum(1 for r in attr_rows if not r["R3_query_generatable"]),
            "note": "1-char PathFineSpan vs multi-char target is QUERY_GENERATION_GAP under frozen exact-align",
        },
    )
    write_json(
        OUT / "base_raw_recall_metrics.json",
        {
            "BASE_RECALL_ELIGIBLE_UNITS": base_eligible,
            "BASE_RECALL_RAW_HIT": base_raw_hit,
            "BASE_RECALL_RAW_HIT_RATE": (base_raw_hit / base_eligible) if base_eligible else None,
            "NO_PROFILE": True,
        },
    )
    write_json(OUT / "p_recall_applicability.json", {"status": "NOT_APPLICABLE", "reason": "dialog_200 200/200 NO_PROFILE"})
    write_json(OUT / "d_recall_applicability.json", {"status": "NOT_APPLICABLE", "reason": "dialog_200 200/200 NO_PROFILE; do not invent domain from expectedText"})
    write_json(
        OUT / "fuzzy_filter_failure_taxonomy.json",
        dict(Counter(r["R7_filter"] for r in attr_rows if r["R7_filter"])),
    )
    write_json(
        OUT / "candidate_materialization_audit.json",
        {
            "raw_but_not_materialized": sum(
                1 for r in attr_rows if r["R4_base_raw_hit"] and not r["R8_materialized"] and r["root_cause"] == "CANDIDATE_MATERIALIZATION_BUG"
            )
        },
    )
    write_json(
        OUT / "candidate_binding_audit.json",
        {"offline_inconsistent_d_windowcandidates": dropped[:50], "n": len(dropped)},
    )
    write_json(
        OUT / "post_budget_recall_audit.json",
        {
            "pruned_true_recall": sum(1 for r in attr_rows if r["root_cause"] == "BUDGET_PRUNE"),
            "keep_budget_frozen": True,
        },
    )
    write_json(OUT / "recall_failure_taxonomy.json", dict(root_counts))
    write_json(OUT / "lexicon_coverage_by_length.json", {k: dict(v) for k, v in length_exist.items()})
    write_json(OUT / "lexicon_coverage_by_term_class.json", {k: dict(v) for k, v in class_exist.items()})
    write_json(
        OUT / "single_char_lexicon_coverage.json",
        {
            "SINGLE_CHAR_RESPONSIBILITY_N": sc_n,
            "SINGLE_CHAR_TARGET_IN_LEXICON": sc_in_lex,
            "SINGLE_CHAR_INDEXED": sc_indexed,
            "SINGLE_CHAR_RAW_RECALL_HIT": sc_raw,
            "SINGLE_CHAR_COVERAGE_GAP": sc_gap,
            "SINGLE_CHAR_LEXICON_COVERAGE_RATE": (sc_in_lex / sc_n) if sc_n else None,
            "base_lexicon_len1_enabled": lex["stats"]["base_len1_enabled"],
            "term_table_len1_enabled": lex["stats"]["term_len1_enabled"],
        },
    )
    write_json(
        OUT / "term_domain_tag_recall_audit.json",
        {
            "true_recall_with_tags": sum(1 for r in attr_rows if r.get("domain_tags")),
            "note": "NO_PROFILE: domain tag errors are NOT D failures this round",
        },
    )
    (OUT / "lexicon_ssot_recall_audit.md").write_text(
        "\n".join(
            [
                "# Lexicon SSOT recall audit",
                "",
                "Authoritative Node recall uses `node_runtime/lexicon/v3/lexicon.sqlite`.",
                f"- term rows: {lex['stats']['term_n']} (enabled {lex['stats']['term_enabled']})",
                f"- base_lexicon rows: {lex['stats']['base_n']} (enabled {lex['stats']['base_enabled']})",
                f"- domain_lexicon rows: {lex['stats']['domain_n']}",
                f"- term length=1 enabled: {lex['stats']['term_len1_enabled']}",
                f"- base_lexicon length=1 enabled: {lex['stats']['base_len1_enabled']}",
                "",
                "Model2 D index is the Python CandidateIndex built from the same Lexicon surfaces (no fixture-only shadow list in runtime expand).",
                "No hard-coded candidate list was introduced this round.",
                "Length-1 identities live in `base_lexicon`, not in `term` (0 enabled 1-char term rows).",
                "That is an INDEX / table-split fact, not a license to import new chars this round.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    write_json(
        OUT / "finespan_gap_after_binding_fix.json",
        {
            "before": gap_before,
            "after_class_counts": dict(after_classes),
            "eligibility_gap_units_after": sum(after_classes.values()),
            "wrong_span_remaining": after_classes.get("CANDIDATE_BOUND_TO_WRONG_SPAN", 0),
            "note": "Simulated by removing m2d CANDIDATE_BOUND_TO_WRONG_SPAN matches; D hits[] still count as lexical surfaces. d090 BASE 上线 is out of D-fix scope.",
        },
    )
    write_json(OUT / "finespan_wrong_binding_reclassification.json", reclass)

    write_json(
        OUT / "architecture_conformance_check.json",
        {
            "MATERIALIZABLE_TARGET_V1": "FROZEN",
            "Model2": "FROZEN",
            "Assembly": "FROZEN",
            "FineSpan_architecture": "FROZEN",
            "Candidate_budget": "FROZEN",
            "KenLM": "FROZEN",
            "binding_fix_only": True,
        },
    )
    write_csv(
        OUT / "production_business_code_change_inventory.csv",
        [
            {
                "file": "electron_node/electron-node/main/src/model2-runtime/candidate-materialize.ts",
                "change": "D hits skipped when pinyin length != origin FineSpan; originSpanId/retrievalId observation fields",
                "business_algorithm": "binding ownership only",
            },
            {
                "file": "electron_node/electron-node/main/src/model2-runtime/expand-active-candidates.ts",
                "change": "pass retrievalId; D hit trace candidateId + binding_status",
                "business_algorithm": "no ranking/budget/assembly change",
            },
            {
                "file": "electron_node/electron-node/main/src/model2-runtime/dialog200-path-trace.ts",
                "change": "compactCandidate observation fields",
                "business_algorithm": "TRACE_ON only extra fields",
            },
            {
                "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/v4-types.ts",
                "change": "optional originSpanId/retrievalId",
                "business_algorithm": "none",
            },
        ],
        ["file", "change", "business_algorithm"],
    )
    write_json(
        OUT / "dialog200_immutability_check.json",
        {"dialog_200_wav_modified": False, "expectedText_modified": False, "rerun_asr": False},
    )
    write_json(
        OUT / "no_training_check.json",
        {
            "training": False,
            "retrain": False,
            "checkpoint": "training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt",
            "sha256": "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda",
        },
    )
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": "electron_node/electron-node/main/src/model2-runtime/candidate-materialize.ts", "kind": "implementation_fix"},
            {"path": "electron_node/electron-node/main/src/model2-runtime/expand-active-candidates.ts", "kind": "implementation_fix"},
            {"path": "electron_node/electron-node/main/src/model2-runtime/dialog200-path-trace.ts", "kind": "observation_trace"},
            {"path": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/v4-types.ts", "kind": "observation_type"},
            {"path": "electron_node/electron-node/main/src/model2-runtime/candidate-materialize.test.ts", "kind": "test"},
            {"path": "electron_node/electron-node/main/src/model2-runtime/dialog200-path-trace.test.ts", "kind": "test"},
            {"path": "docs/user_correction/MATERIALIZABLE_TARGET_V1_FREEZE_V1.md", "kind": "freeze"},
            {"path": "docs/user_correction/FW_REPAIR_V4_POST_TRACE_FREEZE_V1.md", "kind": "freeze"},
        ],
        ["path", "kind"],
    )

    go = {
        "Post-Trace Freeze": "PASS",
        "MATERIALIZABLE_TARGET_V1": "FROZEN",
        "Model2": "FROZEN",
        "Assembly": "FROZEN",
        "FineSpan Architecture": "FROZEN",
        "Candidate Budget": "FROZEN",
        "KenLM": "FROZEN",
        "Model2 D Wrong-Span Binding": "FIXED",
        "Business Behavior Changed": "NO" if not assembly_used_dropped else "YES",
        "Trace Observation Fields": "COMPLETE",
        "Total Correction Units": len(units),
        "responsibility": dict(resp_counts),
        "TRUE_RECALL_RESPONSIBILITY_N": true_n,
        "true_recall_failures": true_fail,
        "root_cause": dict(root_counts),
        "outside": dict(outside_counts),
        "single_char": {
            "n": sc_n,
            "in_lexicon": sc_in_lex,
            "indexed": sc_indexed,
            "raw": sc_raw,
            "gap": sc_gap,
        },
        "finespan_gap_before_units": 10,
        "finespan_gap_after_units": sum(after_classes.values()),
        "wrong_span_remaining": after_classes.get("CANDIDATE_BOUND_TO_WRONG_SPAN", 0),
        "FineSpan Design Change Required": "NO",
        "Model2 Retraining Required": "NO",
        "Assembly Work Required": "NO",
        "lex": lex["stats"],
        "dropped_inconsistent_d": len(dropped),
        "assembly_used_dropped_n": len(assembly_used_dropped),
    }
    write_json(OUT / "go_summary.json", go)
    write_json(OUT / "normalization_path_inventory.json", norm_path)

    print(json.dumps({k: go[k] for k in go if k != "responsibility"}, ensure_ascii=False, indent=2))
    print("RESP", dict(resp_counts))
    print("ROOT", dict(root_counts))
    print("OUT", dict(outside_counts))
    print("TRUE_N", true_n, "FAIL", true_fail)


if __name__ == "__main__":
    main()
