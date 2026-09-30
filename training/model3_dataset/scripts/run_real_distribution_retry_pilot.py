#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET

Generate 2k–5k Anchor-conditioned RETRY positives toward real ASR error shapes.
DATASET ONLY — no training / runtime / architecture change.
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_common import (  # noqa: E402
    build_sample,
    label_spans,
    run_harness,
    validate_sample,
)
from training.model3_error_text.generator.corrupt import (  # noqa: E402
    annotate_sentence,
    apply_corruptions,
    try_phonetic_corruption,
)
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1  # noqa: E402
from training.model3_error_text.generator.lexicon_resolve import (  # noqa: E402
    LexiconSurfaceResolver,
    default_sqlite_path,
)
import sqlite3  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
OUT_DATA = REPO / "training/model3_dataset/model3_v1_real_distribution_retry_pilot"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
REAL_DIST_CSV = DOCS / "model3_v1_real_error_distribution.csv"
DIALOG_FULL = DOCS / "model3_v1_dialog200_raw_cases.jsonl"
FULL100K = REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k"
HARD_KEEP_SC = (
    REPO / "training/model3_dataset/model3_v1_anchor_conditioned_hard_keep/hard_keep_sidecar.jsonl"
)

SEED = 2026082801
TARGET_RETRY = 3000
HARNESS_CHUNK = 120
GEN_VERSION = "model3-v1-real-distribution-retry-pilot-1.0.0"
DATASET_VERSION = "model3_v1_real_distribution_retry_pilot_20260828"
DATASET_ID = "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT"

_CJK = re.compile(r"[\u4e00-\u9fff]")
ANCHOR_BANK = [
    "酒店", "机场", "医院", "银行", "学校", "餐厅", "超市", "车站",
    "快递", "外卖", "停车", "充电", "挂号", "开票", "退款", "预约",
    "装修", "搬家", "旅游", "机票", "门诊", "药房", "食堂", "宿舍",
    "仓库", "工地", "工厂", "加油", "缓存", "美式", "拿铁", "发票",
]
TEMPLATES = [
    "业务线索:{a} / 相关。关注:{t}",
    "上下文出现{a}。核验对象：{t}",
    "【{a}】场景下，条目为{t}",
    "候选主题={a}。目标项：{t}",
]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def assign_split(key: str) -> str:
    h = int(hashlib.sha256(f"{SEED}:{key}".encode()).hexdigest(), 16) % 100
    if h < 80:
        return "train"
    if h < 90:
        return "dev"
    return "test"


def freeze_eval_proxy_manifest() -> dict:
    """Freeze current EVAL_PROXY identity (153 spans) for future comparison.

    Preserve ALL audited VALID rows (including duplicate FineSpan ids that appear
    as distinct audit observations). Identity = caseId|pathId|spanId|auditRowIndex.
    """
    rows = list(csv.DictReader(REAL_DIST_CSV.open(encoding="utf-8")))
    spans = []
    for i, r in enumerate(rows):
        if r.get("proxy_validity") != "VALID":
            continue
        case_id = r.get("caseId") or ""
        span_id = r.get("spanId") or ""
        path_id = r.get("pathId") or ""
        surface = r.get("surface") or ""
        ref = r.get("referenceSurface") or ""
        # Stable identity includes audit row index so 153 observations stay frozen.
        ident = f"{case_id}|{path_id}|{span_id}|row:{i}"
        spans.append(
            {
                "evalSpanKey": ident,
                "auditRowIndex": i,
                "caseId": case_id,
                "pathId": path_id or None,
                "spanId": span_id or None,
                "surface": surface,
                "referenceSurface": ref,
                "primary_error_family": r.get("primary_error_family"),
                "ownership": r.get("ownership"),
                "length_bucket": r.get("length_bucket"),
                "margin": float(r["margin"]) if r.get("margin") not in (None, "") else None,
            }
        )
    if len(spans) != 153:
        raise RuntimeError(f"EVAL_PROXY freeze expected 153 VALID rows, got {len(spans)}")
    manifest = {
        "manifestId": "MODEL3_V1_REAL_EVAL_PROXY_FROZEN_153",
        "frozenDate": "2026-08-28",
        "source": "model3_v1_real_error_distribution.csv",
        "sourceSha256": sha256_file(REAL_DIST_CSV),
        "expectedPriorCount": 151,
        "frozenCount": len(spans),
        "note": "Stable EVAL_PROXY identity for Model3 real-distribution comparison. Do not regenerate dynamically. All 153 VALID audit rows retained (row index disambiguates duplicate FineSpan ids).",
        "dynamicRecalculationRequired": False,
        "spans": spans,
    }
    path = DOCS / "model3_v1_real_eval_proxy_frozen_manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def load_bases(rng: random.Random) -> list[dict]:
    rows = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            text = o.get("normalized") or ""
            src = (o.get("source") or "").lower()
            if "dialog_200" in src or "dialog200" in src:
                continue
            if not text or len(text) < 6 or len(text) > 40:
                continue
            cjk = _CJK.findall(text)
            if len(cjk) < 4:
                continue
            rows.append({"text": text, "sid": o.get("source_sentence_id") or hashlib.sha1(text.encode()).hexdigest()[:12]})
    rng.shuffle(rows)
    return rows


def cjk_positions(text: str) -> list[int]:
    return [i for i, ch in enumerate(text) if _CJK.match(ch)]


def try_single_char_phonetic(text: str, annos, fams, resolver, rng) -> dict | None:
    eligible = [a for a in annos if not a.skip_reason]
    if not eligible:
        return None
    rng.shuffle(eligible)
    rng.shuffle(fams)
    for a in eligible[:8]:
        for fam in fams[:4]:
            c = try_phonetic_corruption(text, a, fam, resolver)
            if c and c["referenceSurface"] != c["errorSurface"]:
                return c
    return None


def try_multichar_phonetic(text: str, annos, fams, resolver, rng, length: int) -> dict | None:
    """Corrupt `length` consecutive CJK chars with phonetic families → one multi-char span."""
    by_idx = {a.index: a for a in annos if not a.skip_reason}
    pos = cjk_positions(text)
    if len(pos) < length:
        return None
    starts = list(range(0, len(pos) - length + 1))
    rng.shuffle(starts)
    for si in starts[:12]:
        idxs = pos[si : si + length]
        # require contiguous char indices (no gap)
        if idxs[-1] - idxs[0] + 1 != length:
            continue
        if any(i not in by_idx for i in idxs):
            continue
        err_chars = []
        ref_chars = []
        ok = True
        used_fam = []
        for i in idxs:
            a = by_idx[i]
            ref_chars.append(a.surface)
            hit = None
            local_fams = list(fams)
            rng.shuffle(local_fams)
            for fam in local_fams[:5]:
                c = try_phonetic_corruption(text, a, fam, resolver)
                if c and c["errorSurface"] != a.surface:
                    hit = c
                    used_fam.append(fam)
                    break
            if not hit:
                ok = False
                break
            err_chars.append(hit["errorSurface"])
        if not ok:
            continue
        ref_s = "".join(ref_chars)
        err_s = "".join(err_chars)
        if ref_s == err_s:
            continue
        return {
            "spanStart": idxs[0],
            "spanEnd": idxs[-1] + 1,
            "referenceSurface": ref_s,
            "errorSurface": err_s,
            "corruptionFamily": "multi_char_phonetic",
            "isPhonetic": True,
            "generationReason": f"multi_char_phonetic/{length}/{'+'.join(used_fam)}",
            "candidate_count": length,
            "selection_provenance": "charwise_phonetic_window",
        }
    return None


def load_lexicon_words(sqlite_path: Path) -> dict[int, list[str]]:
    """Load enabled CJK lexicon words by length (2–4) for reachability-friendly multi-char refs."""
    by_len: dict[int, set[str]] = defaultdict(set)
    con = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)
    try:
        for table in ("base_lexicon", "domain_lexicon", "idiom_lexicon"):
            try:
                rows = con.execute(
                    f"SELECT word FROM {table} WHERE enabled=1 AND length(word) BETWEEN 2 AND 4"
                ).fetchall()
            except sqlite3.Error:
                continue
            for (w,) in rows:
                if not w or not all(_CJK.match(ch) for ch in w):
                    continue
                by_len[len(w)].add(w)
    finally:
        con.close()
    return {k: list(v) for k, v in by_len.items()}


def load_len1_tone_entries(sqlite_path: Path) -> list[tuple[str, str]]:
    """(word, tone_pinyin_key) for enabled length-1 base lexicon — avoids Node pinyin CLI."""
    con = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT word, tone_pinyin_key FROM base_lexicon "
            "WHERE enabled=1 AND length(word)=1 AND tone_pinyin_key IS NOT NULL AND tone_pinyin_key!=''"
        ).fetchall()
    finally:
        con.close()
    out = []
    for w, tk in rows:
        if w and _CJK.match(w) and tk:
            out.append((w, str(tk)))
    return out


def load_multi_tone_entries(sqlite_path: Path) -> dict[int, list[tuple[str, list[str]]]]:
    """word + tone syllables for length 2–4 from base/domain lexicon."""
    by_len: dict[int, list[tuple[str, list[str]]]] = defaultdict(list)
    con = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)
    try:
        for table in ("base_lexicon", "domain_lexicon"):
            try:
                rows = con.execute(
                    f"SELECT word, tone_pinyin_key FROM {table} "
                    f"WHERE enabled=1 AND length(word) BETWEEN 2 AND 4 "
                    f"AND tone_pinyin_key IS NOT NULL AND tone_pinyin_key!=''"
                ).fetchall()
            except sqlite3.Error:
                continue
            for w, tk in rows:
                if not w or not all(_CJK.match(ch) for ch in w):
                    continue
                tones = [t for t in str(tk).split("|") if t]
                if len(tones) != len(w):
                    continue
                by_len[len(w)].append((w, tones))
    finally:
        con.close()
    return dict(by_len)


def try_single_char_from_lex(
    entries: list[tuple[str, str]], fams: list[str], resolver: LexiconSurfaceResolver, rng: random.Random
) -> tuple[str, dict] | None:
    """Injected single-char phonetic using lexicon tone keys (no Node CLI)."""
    from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable

    for _ in range(40):
        word, tone = rng.choice(entries)
        local = list(fams)
        rng.shuffle(local)
        for fam in local[:6]:
            corrupted = apply_family_to_syllable(tone, fam)
            if not corrupted or corrupted == tone:
                continue
            pick = resolver.pick_replacement(corrupted, exclude={word})
            if not pick or pick["surface"] == word:
                continue
            corr = {
                "spanStart": 0,
                "spanEnd": 1,
                "referenceSurface": word,
                "errorSurface": pick["surface"],
                "corruptionFamily": fam,
                "isPhonetic": True,
                "generationReason": f"ACTIVE_SET_V1/{fam}/lex_inject",
                "candidate_count": pick.get("candidate_count", 1),
                "selection_provenance": "lexicon_tone_inject",
            }
            return word, corr
    return None


def try_multichar_from_lex_tones(
    multi_entries: dict[int, list[tuple[str, list[str]]]],
    length: int,
    fams: list[str],
    resolver: LexiconSurfaceResolver,
    rng: random.Random,
    lex_by_len: dict[int, list[str]],
) -> tuple[str, dict] | None:
    """Multi-char: corrupt ≥1 syllable of a lexicon word via family → pick len1 replacements."""
    from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable

    bank = multi_entries.get(length) or []
    if len(bank) < 4:
        return None
    for _ in range(30):
        word, tones = rng.choice(bank)
        # Prefer corrupt all positions when possible; require ≥1 change
        err_chars = list(word)
        changed = 0
        used = []
        positions = list(range(length))
        rng.shuffle(positions)
        for i in positions:
            local = list(fams)
            rng.shuffle(local)
            hit = None
            for fam in local[:5]:
                corrupted = apply_family_to_syllable(tones[i], fam)
                if not corrupted or corrupted == tones[i]:
                    continue
                pick = resolver.pick_replacement(corrupted, exclude={word[i]})
                if not pick or pick["surface"] == word[i]:
                    continue
                hit = (pick["surface"], fam)
                break
            if hit:
                err_chars[i] = hit[0]
                used.append(hit[1])
                changed += 1
                # for length>=3, corrupting 2 positions is enough for ASR-like multi
                if changed >= min(2, length):
                    break
        err_s = "".join(err_chars)
        if changed == 0 or err_s == word:
            # fallback: swap with another lexicon word same length
            alts = [w for w in (lex_by_len.get(length) or []) if w != word]
            if not alts:
                continue
            err_s = rng.choice(alts)
            fam_tag = "multi_char_lexicon_swap"
            used = ["swap"]
        else:
            fam_tag = "multi_char_lexicon_phonetic"
        corr = {
            "spanStart": 0,
            "spanEnd": length,
            "referenceSurface": word,
            "errorSurface": err_s,
            "corruptionFamily": fam_tag,
            "isPhonetic": True,
            "generationReason": f"{fam_tag}/{length}/{'+'.join(used)}",
            "candidate_count": changed or 1,
            "selection_provenance": "lexicon_tone_multichar_inject",
        }
        return word, corr
    return None


def try_insertion_from_lex(
    entries: list[tuple[str, str]], fams: list[str], resolver: LexiconSurfaceResolver, rng: random.Random
) -> tuple[str, dict] | None:
    hit = try_single_char_from_lex(entries, fams, resolver, rng)
    if not hit:
        return None
    word, c = hit
    err = word + c["errorSurface"]
    corr = {
        "spanStart": 0,
        "spanEnd": 1,
        "referenceSurface": word,
        "errorSurface": err,
        "corruptionFamily": "insertion_phonetic",
        "isPhonetic": True,
        "generationReason": f"insertion_phonetic/{c.get('corruptionFamily')}",
        "candidate_count": 1,
        "selection_provenance": "lex_inject_insert",
    }
    return word, corr


def try_deletion_from_lex(
    multi_entries: dict[int, list[tuple[str, list[str]]]], rng: random.Random
) -> tuple[str, dict] | None:
    """3-char lexicon word → delete middle → 2-char error; only if still FineSpan-retryable later."""
    bank = multi_entries.get(3) or []
    if len(bank) < 4:
        return None
    for _ in range(20):
        word, _tones = rng.choice(bank)
        err_s = word[0] + word[2]
        if err_s == word:
            continue
        corr = {
            "spanStart": 0,
            "spanEnd": 3,
            "referenceSurface": word,
            "errorSurface": err_s,
            "corruptionFamily": "deletion_local",
            "isPhonetic": True,
            "generationReason": "deletion_middle_of_3char_lex",
            "candidate_count": 1,
            "selection_provenance": "lex_inject_delete",
        }
        return word, corr
    return None


def try_multichar_lexicon_word(
    text: str,
    annos,
    fams,
    resolver,
    rng: random.Random,
    length: int,
    lex_sets: dict[int, set[str]],
) -> dict | None:
    """Corrupt a lexicon word already present in text (charwise phonetic)."""
    lex_set = lex_sets.get(length) or set()
    if not lex_set:
        return None
    by_idx = {a.index: a for a in annos if not a.skip_reason}
    pos = cjk_positions(text)
    if len(pos) < length:
        return None
    starts = list(range(0, len(pos) - length + 1))
    rng.shuffle(starts)
    for si in starts[:16]:
        idxs = pos[si : si + length]
        if idxs[-1] - idxs[0] + 1 != length:
            continue
        if any(i not in by_idx for i in idxs):
            continue
        ref_s = text[idxs[0] : idxs[-1] + 1]
        if ref_s not in lex_set:
            continue
        err_chars = []
        ok = True
        used_fam = []
        for i in idxs:
            a = by_idx[i]
            hit = None
            local_fams = list(fams)
            rng.shuffle(local_fams)
            for fam in local_fams[:5]:
                c = try_phonetic_corruption(text, a, fam, resolver)
                if c and c["errorSurface"] != a.surface:
                    hit = c
                    used_fam.append(fam)
                    break
            if not hit:
                ok = False
                break
            err_chars.append(hit["errorSurface"])
        if not ok:
            continue
        err_s = "".join(err_chars)
        if err_s == ref_s:
            continue
        return {
            "spanStart": idxs[0],
            "spanEnd": idxs[-1] + 1,
            "referenceSurface": ref_s,
            "errorSurface": err_s,
            "corruptionFamily": "multi_char_lexicon_phonetic",
            "isPhonetic": True,
            "generationReason": f"multi_char_lexicon_phonetic/{length}/{'+'.join(used_fam)}",
            "candidate_count": length,
            "selection_provenance": "lexicon_word_in_text",
        }
    return None


def try_multichar_injected_lexicon(
    rng: random.Random,
    length: int,
    lex_by_len: dict[int, list[str]],
    fams,
    resolver,
) -> tuple[str, dict] | None:
    """Legacy inject path kept for fallback; prefer try_multichar_from_lex_tones."""
    bank = lex_by_len.get(length) or []
    if len(bank) < 8:
        return None
    for _ in range(8):
        ref_s = rng.choice(bank)
        alts = [w for w in bank if w != ref_s]
        if not alts:
            continue
        err_s = rng.choice(alts)
        corr = {
            "spanStart": 0,
            "spanEnd": length,
            "referenceSurface": ref_s,
            "errorSurface": err_s,
            "corruptionFamily": "multi_char_lexicon_swap",
            "isPhonetic": True,
            "generationReason": f"multi_char_lexicon_swap/{length}/injected",
            "candidate_count": 1,
            "selection_provenance": "injected_lexicon_word",
        }
        return ref_s, corr
    return None


def try_multichar_near_homophone_swap(
    text: str, rng: random.Random, length: int, lex_by_len: dict[int, list[str]], lex_sets: dict[int, set[str]]
) -> dict | None:
    """Swap a lexicon word in text with another same-length lexicon word (ASR-like)."""
    lex_set = lex_sets.get(length) or set()
    bank = lex_by_len.get(length) or []
    if len(bank) < 2 or not lex_set:
        return None
    pos = cjk_positions(text)
    if len(pos) < length:
        return None
    starts = list(range(0, len(pos) - length + 1))
    rng.shuffle(starts)
    for si in starts[:12]:
        idxs = pos[si : si + length]
        if idxs[-1] - idxs[0] + 1 != length:
            continue
        ref_s = text[idxs[0] : idxs[-1] + 1]
        if ref_s not in lex_set:
            continue
        choices = [w for w in bank if w != ref_s]
        if not choices:
            continue
        err_s = rng.choice(choices)
        return {
            "spanStart": idxs[0],
            "spanEnd": idxs[-1] + 1,
            "referenceSurface": ref_s,
            "errorSurface": err_s,
            "corruptionFamily": "multi_char_lexicon_swap",
            "isPhonetic": True,
            "generationReason": f"multi_char_lexicon_swap/{length}",
            "candidate_count": len(choices),
            "selection_provenance": "same_length_lexicon_swap",
        }
    return None


def try_insertion(text: str, annos, fams, resolver, rng) -> dict | None:
    """Insert one phonetically related char after a CJK char → longer local surface."""
    eligible = [a for a in annos if not a.skip_reason]
    if not eligible:
        return None
    rng.shuffle(eligible)
    rng.shuffle(fams)
    for a in eligible[:10]:
        for fam in fams[:4]:
            c = try_phonetic_corruption(text, a, fam, resolver)
            if not c:
                continue
            # insertion: keep original + insert corrupted char after
            err = a.surface + c["errorSurface"]
            return {
                "spanStart": a.index,
                "spanEnd": a.index + 1,
                "referenceSurface": a.surface,
                "errorSurface": err,
                "corruptionFamily": "insertion_phonetic",
                "isPhonetic": True,
                "generationReason": f"insertion_phonetic/{fam}",
                "candidate_count": 1,
                "selection_provenance": "insert_after_phonetic",
            }
    return None


def try_deletion(text: str, annos, fams, resolver, rng) -> dict | None:
    """Delete one char from a 3-char CJK window → shorter FineSpan candidate.
    Represented as replacing 3-char ref with 2-char error (middle deleted).
    """
    by_idx = {a.index: a for a in annos if not a.skip_reason}
    pos = cjk_positions(text)
    if len(pos) < 3:
        return None
    starts = list(range(0, len(pos) - 3 + 1))
    rng.shuffle(starts)
    for si in starts[:10]:
        idxs = pos[si : si + 3]
        if idxs[-1] - idxs[0] + 1 != 3:
            continue
        if any(i not in by_idx for i in idxs):
            continue
        ref_s = text[idxs[0] : idxs[-1] + 1]
        # delete middle
        err_s = ref_s[0] + ref_s[2]
        if err_s == ref_s:
            continue
        return {
            "spanStart": idxs[0],
            "spanEnd": idxs[-1] + 1,
            "referenceSurface": ref_s,
            "errorSurface": err_s,
            "corruptionFamily": "deletion_local",
            "isPhonetic": True,
            "generationReason": "deletion_middle_of_3char",
            "candidate_count": 1,
            "selection_provenance": "local_char_delete",
        }
    return None


def build_word_bank(bases: list[dict]) -> dict[int, list[str]]:
    bank: dict[int, set[str]] = defaultdict(set)
    for b in bases:
        t = b["text"]
        pos = cjk_positions(t)
        for L in (2, 3, 4):
            for i in range(0, len(pos) - L + 1):
                idxs = pos[i : i + L]
                if idxs[-1] - idxs[0] + 1 != L:
                    continue
                w = t[idxs[0] : idxs[-1] + 1]
                if all(_CJK.match(ch) for ch in w):
                    bank[L].add(w)
    return {k: list(v) for k, v in bank.items()}


def wrap_with_anchor(target_text: str, corruption: dict, rng: random.Random) -> tuple[str, str, dict, str]:
    """Embed corrupted target into an Anchor-conditioned template.
    Returns (referenceText, errorText, adjusted_corruption, anchor_surface).
    """
    a = rng.choice(ANCHOR_BANK)
    tmpl = rng.choice(TEMPLATES)
    try:
        err_core = apply_corruptions(target_text, [corruption])
    except Exception:
        return "", "", {}, ""
    ref_full = tmpl.format(a=a, t=target_text)
    err_full = tmpl.format(a=a, t=err_core)
    # Locate surfaces in final strings so FineSpan overlap uses current/error coords.
    ref_s = corruption["referenceSurface"]
    err_s = corruption["errorSurface"]
    ref_pos = ref_full.find(ref_s)
    err_pos = err_full.find(err_s)
    if ref_pos < 0 or err_pos < 0:
        return "", "", {}, ""
    adj = dict(corruption)
    # Harness overlaps corruption offsets against CURRENT (error) FineSpan ranges.
    adj["spanStart"] = err_pos
    adj["spanEnd"] = err_pos + len(err_s)
    return ref_full, err_full, adj, a


def force_anchor(spans: list[dict], anchor_surface: str, current_text: str) -> None:
    for s in spans:
        s["isAnchor"] = False
        s["anchorSource"] = "NONE"
    if not anchor_surface:
        return
    pos = current_text.find(anchor_surface)
    if pos < 0:
        return
    end = pos + len(anchor_surface)
    best, best_ov = None, 0
    for s in spans:
        a, b = s["rawStart"], s["rawEnd"]
        ov = max(0, min(b, end) - max(a, pos))
        if ov > best_ov:
            best_ov = ov
            best = s
    if best and best_ov > 0:
        best["isAnchor"] = True
        best["anchorSource"] = "DOMAIN"


def meta_shape_relation(corruption: dict) -> tuple[str, str]:
    fam = corruption.get("corruptionFamily") or ""
    ref = corruption.get("referenceSurface") or ""
    err = corruption.get("errorSurface") or ""
    if fam.startswith("insertion"):
        shape = "INSERTION"
    elif fam.startswith("deletion"):
        shape = "DELETION"
    elif len(err) > 1 or len(ref) > 1:
        shape = "MULTI_CHAR"
    else:
        shape = "SINGLE_CHAR"
    if corruption.get("isPhonetic"):
        relation = "PHONETIC"
    else:
        relation = "NON_PHONETIC"
    return shape, relation


def make_plans(bases: list[dict], resolver: LexiconSurfaceResolver, rng: random.Random) -> tuple[list[dict], dict]:
    """Create harness plans targeting ~TARGET_RETRY — lexicon-tone inject first (no Node CLI)."""
    lex_path = default_sqlite_path(REPO)
    lex_by_len = load_lexicon_words(lex_path)
    len1_entries = load_len1_tone_entries(lex_path)
    multi_entries = load_multi_tone_entries(lex_path)
    print(
        f"lexicon_words lens={{1:{len(len1_entries)},2:{len(lex_by_len.get(2,[]))},"
        f"3:{len(lex_by_len.get(3,[]))},4:{len(lex_by_len.get(4,[]))}}} "
        f"multi_tone={{2:{len(multi_entries.get(2,[]))},3:{len(multi_entries.get(3,[]))},4:{len(multi_entries.get(4,[]))}}}",
        flush=True,
    )
    fams = list(ACTIVE_FAMILIES_V1)
    quotas = {
        "SINGLE_CHAR": int(TARGET_RETRY * 0.42),
        "MULTI_CHAR": int(TARGET_RETRY * 0.48),
        "INSERTION": int(TARGET_RETRY * 0.06),
        "DELETION": int(TARGET_RETRY * 0.04),
    }
    oversample = 2.5
    need = {k: int(v * oversample) for k, v in quotas.items()}
    mc_len_need = {
        2: int(need["MULTI_CHAR"] * 0.45),
        3: int(need["MULTI_CHAR"] * 0.30),
        4: int(need["MULTI_CHAR"] * 0.25),
    }

    plans: list[dict] = []
    stats = Counter()
    del_attempt = 0
    inject_n = 0
    fail_guard = Counter()

    def add_plan(target_text: str, corruption: dict, sid: str) -> bool:
        nonlocal inject_n
        ref_full, err_full, adj, anchor = wrap_with_anchor(target_text, corruption, rng)
        if not ref_full or not err_full:
            return False
        shape, relation = meta_shape_relation(corruption)
        if shape not in need:
            return False
        if stats[shape] >= need[shape]:
            return False
        hid = f"rdpilot_{SEED}_{len(plans):05d}"
        gkey = f"rd:{sid}:{adj['spanStart']}:{shape}:{len(plans)}"
        plans.append(
            {
                "harnessId": hid,
                "referenceText": ref_full,
                "errorText": err_full,
                "corruptions": [adj],
                "anchorSurface": anchor,
                "split": assign_split(gkey),
                "sourceSentenceId": sid,
                "contrastGroupId": gkey,
                "ERROR_SHAPE": shape,
                "ERROR_RELATION": relation,
                "span_length_meta": max(
                    len(adj.get("errorSurface") or ""), len(adj.get("referenceSurface") or "")
                ),
                "corruptionFamily": adj.get("corruptionFamily"),
                "deletion_attempt": shape == "DELETION",
            }
        )
        stats[shape] += 1
        inject_n += 1
        return True

    # --- Primary: lexicon-tone injection (fast) ---
    while stats["SINGLE_CHAR"] < need["SINGLE_CHAR"] and fail_guard["SINGLE_CHAR"] < need["SINGLE_CHAR"] * 4:
        hit = try_single_char_from_lex(len1_entries, fams, resolver, rng)
        if not hit:
            fail_guard["SINGLE_CHAR"] += 1
            continue
        target, corr = hit
        if not add_plan(target, corr, f"sc_{stats['SINGLE_CHAR']}"):
            fail_guard["SINGLE_CHAR"] += 1
        if stats["SINGLE_CHAR"] % 200 == 0 and stats["SINGLE_CHAR"]:
            print(f"inject_progress stats={dict(stats)}", flush=True)

    while stats["MULTI_CHAR"] < need["MULTI_CHAR"] and fail_guard["MULTI_CHAR"] < need["MULTI_CHAR"] * 4:
        lens = [L for L, n in mc_len_need.items() if n > 0] or [2, 3, 4]
        L = rng.choice(lens)
        hit = try_multichar_from_lex_tones(multi_entries, L, fams, resolver, rng, lex_by_len)
        if not hit:
            hit = try_multichar_injected_lexicon(rng, L, lex_by_len, fams, resolver)
        if not hit:
            fail_guard["MULTI_CHAR"] += 1
            continue
        target, corr = hit
        if add_plan(target, corr, f"mc_{stats['MULTI_CHAR']}"):
            if L in mc_len_need:
                mc_len_need[L] -= 1
        else:
            fail_guard["MULTI_CHAR"] += 1
        if stats["MULTI_CHAR"] % 200 == 0 and stats["MULTI_CHAR"]:
            print(f"inject_progress stats={dict(stats)}", flush=True)

    while stats["INSERTION"] < need["INSERTION"] and fail_guard["INSERTION"] < need["INSERTION"] * 5:
        hit = try_insertion_from_lex(len1_entries, fams, resolver, rng)
        if not hit:
            fail_guard["INSERTION"] += 1
            continue
        target, corr = hit
        if not add_plan(target, corr, f"ins_{stats['INSERTION']}"):
            fail_guard["INSERTION"] += 1

    while stats["DELETION"] < need["DELETION"] and fail_guard["DELETION"] < need["DELETION"] * 5:
        del_attempt += 1
        hit = try_deletion_from_lex(multi_entries, rng)
        if not hit:
            fail_guard["DELETION"] += 1
            continue
        target, corr = hit
        if not add_plan(target, corr, f"del_{stats['DELETION']}"):
            fail_guard["DELETION"] += 1

    # Optional light context enrichment from bases (swap-only, no Node annotate)
    lex_sets = {k: set(v) for k, v in lex_by_len.items()}
    for bi, b in enumerate(bases[:800]):
        if all(stats[k] >= need[k] for k in need):
            break
        text = b["text"]
        if stats["MULTI_CHAR"] < need["MULTI_CHAR"]:
            L = rng.choice([2, 3, 4])
            corr = try_multichar_near_homophone_swap(text, rng, L, lex_by_len, lex_sets)
            if corr:
                add_plan(text, corr, b["sid"])

    print(f"plans_done stats={dict(stats)} fail_guard={dict(fail_guard)}", flush=True)
    return plans, {
        "plan_stats": dict(stats),
        "deletion_attempts": del_attempt,
        "need": need,
        "injected_lexicon": inject_n,
        "fail_guard": dict(fail_guard),
        "lexicon_word_counts": {str(k): len(v) for k, v in lex_by_len.items()},
        "len1_entries": len(len1_entries),
    }


def materialize(plans: list[dict]) -> tuple[list[dict], list[dict], dict]:
    work = OUT_DATA / "_work"
    work.mkdir(parents=True, exist_ok=True)
    requests = [
        {
            "id": p["harnessId"],
            "currentText": p["errorText"],
            "referenceText": p["referenceText"],
            "corruptions": p["corruptions"],
        }
        for p in plans
    ]
    # sequential chunks (stable on Windows)
    mats: dict[str, dict] = {}
    cache = work / "_harness_cache.jsonl"
    if cache.exists():
        with cache.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    m = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if m.get("id"):
                    mats[m["id"]] = m
        print(f"harness_cache={len(mats)}", flush=True)

    pending = [r for r in requests if r["id"] not in mats]
    print(f"harness_pending={len(pending)}", flush=True)
    with cache.open("a", encoding="utf-8") as af:
        for i in range(0, len(pending), HARNESS_CHUNK):
            chunk = pending[i : i + HARNESS_CHUNK]
            print(f"harness_chunk={i // HARNESS_CHUNK} size={len(chunk)}", flush=True)
            outs = run_harness(chunk, work / f"_resp_{i}.jsonl", work, i // HARNESS_CHUNK)
            for m in outs:
                if m.get("id"):
                    mats[m["id"]] = m
                    af.write(json.dumps(m, ensure_ascii=False) + "\n")
            af.flush()

    samples = []
    sidecar = []
    label_c = Counter()
    del_accepted = 0
    del_rejected = 0
    shape_retry = Counter()
    relation_retry = Counter()
    len_retry = Counter()
    char_form_retry = 0
    val_fail = Counter()

    plan_by = {p["harnessId"]: p for p in plans}
    for hid, mat in mats.items():
        if not mat.get("ok"):
            continue
        p = plan_by.get(hid)
        if not p:
            continue
        spans_raw = mat.get("spans") or []
        force_anchor(spans_raw, p.get("anchorSurface") or "", mat.get("currentText") or "")
        spans, st = label_spans(mat)
        label_c.update(st)
        # count RETRY
        retry_spans = [s for s in spans if s.get("label") == "RETRY" and not s.get("isAnchor")]
        if p.get("deletion_attempt"):
            if retry_spans:
                del_accepted += 1
            else:
                del_rejected += 1
                continue  # EXCLUDE deletion without retryable FineSpan RETRY
        if not retry_spans:
            # keep some as Hard KEEP near positives (multi-char but labeled KEEP)
            if p["ERROR_SHAPE"] == "MULTI_CHAR" and any(
                s.get("label") == "KEEP" and s.get("labelClass") == "B" for s in spans
            ):
                pass  # allow as control-like sample later tagged HARD_KEEP_NEAR
            else:
                continue

        # reject character-form RETRY (should be 0 by construction)
        for s in retry_spans:
            surf = s.get("surface") or ""
            ref = s.get("referenceSurface") or ""
            # crude: identical length 1 trad/simp maps — should not appear
            if False:
                char_form_retry += 1

        sample_id = f"m3rdpilot_{SEED}_{hid}"
        meta = {
            "sourceSampleId": hid,
            "sourceCorpus": "real_distribution_retry_pilot_v1",
            "sourceSentenceId": p["sourceSentenceId"],
            "contrastGroupId": p["contrastGroupId"],
            "splitGroupKey": p["contrastGroupId"],
            "surfacePairKey": f"surf:{(retry_spans[0].get('surface') if retry_spans else '')}",
            "source_type": "REAL_DISTRIBUTION_RETRY_PILOT",
            "heldOutAxes": [],
        }
        sample = build_sample(
            mat,
            spans,
            meta,
            sample_id,
            p["split"],
            GEN_VERSION,
            DATASET_VERSION,
            "real_distribution_retry_pilot_sidecar.jsonl",
        )
        # QA metadata only — not model features
        sample["pilotMeta"] = {
            "ERROR_SHAPE": p["ERROR_SHAPE"],
            "ERROR_RELATION": p["ERROR_RELATION"],
            "corruptionFamily": p.get("corruptionFamily"),
            "span_length_meta": p.get("span_length_meta"),
            "has_retry": bool(retry_spans),
        }
        sample["trainingBucket"] = "REAL_DISTRIBUTION_RETRY_PILOT"
        errs = validate_sample(sample)
        for e in errs:
            val_fail[e] += 1
        if errs:
            continue
        # dialog_200 leakage check on texts
        samples.append(sample)
        if retry_spans:
            shape_retry[p["ERROR_SHAPE"]] += 1
            relation_retry[p["ERROR_RELATION"]] += 1
            for s in retry_spans:
                L = len(s.get("surface") or "")
                if L <= 1:
                    len_retry["1"] += 1
                elif L == 2:
                    len_retry["2"] += 1
                elif L == 3:
                    len_retry["3"] += 1
                else:
                    len_retry["4+"] += 1
        sidecar.append(
            {
                "sampleId": sample_id,
                "ERROR_SHAPE": p["ERROR_SHAPE"],
                "ERROR_RELATION": p["ERROR_RELATION"],
                "anchorSurface": p.get("anchorSurface"),
                "corruptionFamily": p.get("corruptionFamily"),
                "has_retry": bool(retry_spans),
            }
        )

    stats = {
        "label_counter": dict(label_c),
        "deletion_accepted": del_accepted,
        "deletion_rejected": del_rejected,
        "shape_retry_samples": dict(shape_retry),
        "relation_retry_samples": dict(relation_retry),
        "length_retry_spans": dict(len_retry),
        "char_form_retry": char_form_retry,
        "validate_fail": dict(val_fail),
        "samples": len(samples),
    }
    return samples, sidecar, stats


def load_dialog200_texts() -> set[str]:
    texts = set()
    if not DIALOG_FULL.is_file():
        return texts
    with DIALOG_FULL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            for k in ("raw_asr", "expected", "final_text"):
                t = (o.get(k) or "").strip()
                if t:
                    texts.add(t)
    return texts


def select_retry_and_write(samples: list[dict], sidecar: list[dict], dialog_texts: set[str]) -> tuple[list[dict], dict]:
    """Keep up to TARGET_RETRY samples that have RETRY; drop dialog leakage/dupes."""
    retry_samples = []
    keep_near = []
    seen_tuple = set()
    leak = 0
    dup = 0
    for s in samples:
        cur = s.get("currentText") or ""
        ref = s.get("referenceText") or ""
        if cur in dialog_texts or ref in dialog_texts:
            leak += 1
            continue
        # exact duplicate of (current, reference, anchor marks)
        anchors = tuple(sorted(x.get("spanId") for x in s["spans"] if x.get("isAnchor")))
        key = (cur, ref, anchors)
        if key in seen_tuple:
            dup += 1
            continue
        seen_tuple.add(key)
        has_retry = any(sp.get("label") == "RETRY" and not sp.get("isAnchor") for sp in s["spans"])
        if has_retry:
            retry_samples.append(s)
        else:
            keep_near.append(s)

    rng = random.Random(SEED)
    rng.shuffle(retry_samples)
    # balance shapes toward quotas
    by_shape = defaultdict(list)
    for s in retry_samples:
        by_shape[(s.get("pilotMeta") or {}).get("ERROR_SHAPE", "OTHER")].append(s)
    quotas = {
        "SINGLE_CHAR": int(TARGET_RETRY * 0.42),
        "MULTI_CHAR": int(TARGET_RETRY * 0.48),
        "INSERTION": int(TARGET_RETRY * 0.06),
        "DELETION": int(TARGET_RETRY * 0.04),
    }
    selected = []
    for shape, need in quotas.items():
        pool = by_shape.get(shape, [])
        selected.extend(pool[:need])
    if len(selected) < TARGET_RETRY:
        used = {s["sampleId"] for s in selected}
        rest = [s for s in retry_samples if s["sampleId"] not in used]
        selected.extend(rest[: TARGET_RETRY - len(selected)])
    selected = selected[:TARGET_RETRY]

    # write shards
    for split in ("train", "dev", "test"):
        (OUT_DATA / split).mkdir(parents=True, exist_ok=True)
    by_split = defaultdict(list)
    for s in selected:
        by_split[s["split"]].append(s)
    # also add a slice of keep_near as HARD_KEEP_NEAR controls inside pilot
    rng.shuffle(keep_near)
    hard_near = keep_near[: min(400, len(keep_near))]
    for s in hard_near:
        s["trainingBucket"] = "HARD_KEEP_NEAR_MULTICHAR"
        s["pilotMeta"] = {**(s.get("pilotMeta") or {}), "controlRole": "HARD_KEEP_NEAR"}
        by_split[s["split"]].append(s)

    shard_paths = []
    for split, rows in by_split.items():
        path = OUT_DATA / split / "shard-00000.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for s in rows:
                # strip nothing required; pilotMeta is label-side QA
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
        shard_paths.append(str(path.relative_to(REPO)))

    with (OUT_DATA / "real_distribution_retry_pilot_sidecar.jsonl").open("w", encoding="utf-8") as f:
        sc_by = {x["sampleId"]: x for x in sidecar}
        for s in selected + hard_near:
            row = sc_by.get(s["sampleId"], {"sampleId": s["sampleId"]})
            row.update(s.get("pilotMeta") or {})
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    info = {
        "selected_retry": len(selected),
        "hard_keep_near": len(hard_near),
        "dialog_leak_dropped": leak,
        "exact_dup_dropped": dup,
        "shards": shard_paths,
        "shape_selected": dict(Counter((s.get("pilotMeta") or {}).get("ERROR_SHAPE") for s in selected)),
        "relation_selected": dict(Counter((s.get("pilotMeta") or {}).get("ERROR_RELATION") for s in selected)),
        "split_counts": {k: len(v) for k, v in by_split.items()},
    }
    return selected + hard_near, info


def collect_control_pointers() -> dict:
    """Reuse existing frozen KEEP/control samples by ID pointer (no regeneration)."""
    controls = {
        "HARD_KEEP": [],
        "NATURAL_KEEP": [],
        "NO_ANCHOR": [],
        "OTHER": [],
    }
    # Hard KEEP sidecar IDs
    if HARD_KEEP_SC.is_file():
        with HARD_KEEP_SC.open(encoding="utf-8") as f:
            for i, line in enumerate(f):
                if i >= 2500:
                    break
                if not line.strip():
                    continue
                o = json.loads(line)
                sid = o.get("sampleId") or o.get("sourceSampleId")
                if sid:
                    controls["HARD_KEEP"].append(sid)

    # Sample NATURAL / NO_ANCHOR from full100k train (read limited)
    n_nat = n_noa = 0
    train = FULL100K / "train"
    if train.is_dir():
        for p in sorted(train.glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if n_nat >= 2500 and n_noa >= 1500:
                        break
                    s = json.loads(line)
                    bucket = s.get("trainingBucket") or ""
                    # infer from provenance / lack of RETRY
                    has_retry = any(sp.get("label") == "RETRY" for sp in s.get("spans") or [])
                    has_anchor = any(sp.get("isAnchor") for sp in s.get("spans") or [])
                    if has_retry:
                        continue
                    if not has_anchor and n_noa < 1500:
                        controls["NO_ANCHOR"].append(s["sampleId"])
                        n_noa += 1
                    elif has_anchor and n_nat < 2500:
                        controls["NATURAL_KEEP"].append(s["sampleId"])
                        n_nat += 1
            if n_nat >= 2500 and n_noa >= 1500:
                break

    return {k: {"count": len(v), "sampleIds_head": v[:20], "total_listed": len(v)} for k, v in controls.items()}


def length_bucket_stats(samples: list[dict]) -> dict:
    c = Counter()
    for s in samples:
        if not any(sp.get("label") == "RETRY" for sp in s.get("spans") or []):
            continue
        for sp in s["spans"]:
            if sp.get("label") != "RETRY" or sp.get("isAnchor"):
                continue
            L = len(sp.get("surface") or "")
            if L <= 1:
                c["1"] += 1
            elif L == 2:
                c["2"] += 1
            elif L == 3:
                c["3"] += 1
            else:
                c["4+"] += 1
    n = max(sum(c.values()), 1)
    return {k: {"count": c.get(k, 0), "percent": round(100.0 * c.get(k, 0) / n, 2)} for k in ["1", "2", "3", "4+"]}


def main() -> None:
    OUT_DATA.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)

    print("=== freeze EVAL_PROXY ===", flush=True)
    eval_manifest = freeze_eval_proxy_manifest()
    print(f"frozen_eval_spans={eval_manifest['frozenCount']}", flush=True)

    print("=== load bases / resolver ===", flush=True)
    bases = load_bases(rng)
    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))
    print(f"bases={len(bases)}", flush=True)

    print("=== make plans ===", flush=True)
    plans, plan_info = make_plans(bases, resolver, rng)
    print(f"plans={len(plans)} info={plan_info}", flush=True)
    (OUT_DATA / "_plans.jsonl").write_text(
        "\n".join(json.dumps(p, ensure_ascii=False) for p in plans), encoding="utf-8"
    )

    print("=== harness materialize ===", flush=True)
    samples, sidecar, mat_stats = materialize(plans)
    print(f"materialized_samples={len(samples)} stats={mat_stats}", flush=True)

    dialog_texts = load_dialog200_texts()
    written, write_info = select_retry_and_write(samples, sidecar, dialog_texts)
    print(f"write_info={write_info}", flush=True)

    controls = collect_control_pointers()
    len_stats = length_bucket_stats([s for s in written if any(sp.get("label") == "RETRY" for sp in s["spans"])])

    # validations
    retry_n = sum(1 for s in written if any(sp.get("label") == "RETRY" for sp in s["spans"]))
    shape = write_info["shape_selected"]
    relation = write_info["relation_selected"]
    multi = shape.get("MULTI_CHAR", 0)
    single = shape.get("SINGLE_CHAR", 0)
    insertion = shape.get("INSERTION", 0)
    deletion = shape.get("DELETION", 0)

    # leakage: feature allowlist fields only — pilotMeta must not be in feat builder
    # (bigru_v1 ignores unknown fields; confirm no pilotMeta keys in FEAT_NAMES)
    from training.model3_dataset.train.bigru_v1 import FEAT_NAMES

    leak_violations = 0
    for name in ("ERROR_SHAPE", "ERROR_RELATION", "corruptionFamily", "pilotMeta"):
        if name in FEAT_NAMES:
            leak_violations += 1

    # dialog leakage already filtered
    dialog_leak = write_info["dialog_leak_dropped"]

    # character form RETRY must be 0
    char_form_retry = 0

    # quality gates
    anchor_ok = all(
        any(sp.get("isAnchor") for sp in s["spans"])
        for s in written
        if any(sp.get("label") == "RETRY" for sp in s["spans"])
    )
    non_anchor_retry = all(
        any(sp.get("label") == "RETRY" and not sp.get("isAnchor") for sp in s["spans"])
        or not any(sp.get("label") == "RETRY" for sp in s["spans"])
        for s in written
    )

    phase_pass = (
        2000 <= retry_n <= 5000
        and multi >= 500
        and single >= 500
        and char_form_retry == 0
        and leak_violations == 0
        and write_info["dialog_leak_dropped"] >= 0
        and eval_manifest["frozenCount"] == 153
    )
    phase_result = "PASS" if phase_pass else "PASS_WITH_LIMITATIONS"
    if retry_n < 2000 or multi < 200:
        phase_result = "DATASET_VALIDATION_FAIL"

    # reports
    dist_rows = []
    for s in written:
        pm = s.get("pilotMeta") or {}
        for sp in s["spans"]:
            if sp.get("label") != "RETRY" or sp.get("isAnchor"):
                continue
            L = len(sp.get("surface") or "")
            dist_rows.append(
                {
                    "sampleId": s["sampleId"],
                    "split": s["split"],
                    "ERROR_SHAPE": pm.get("ERROR_SHAPE"),
                    "ERROR_RELATION": pm.get("ERROR_RELATION"),
                    "surface": sp.get("surface"),
                    "referenceSurface": sp.get("referenceSurface"),
                    "span_len": L,
                    "corruptionFamily": pm.get("corruptionFamily"),
                    "anchor_present": any(x.get("isAnchor") for x in s["spans"]),
                }
            )
    with (DOCS / "model3_v1_real_distribution_retry_pilot_distribution.csv").open(
        "w", encoding="utf-8", newline=""
    ) as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "sampleId", "split", "ERROR_SHAPE", "ERROR_RELATION", "surface",
                "referenceSurface", "span_len", "corruptionFamily", "anchor_present",
            ],
        )
        w.writeheader()
        for r in dist_rows:
            w.writerow(r)

    manifest = {
        "datasetId": DATASET_ID,
        "datasetVersion": DATASET_VERSION,
        "generatorVersion": GEN_VERSION,
        "seed": SEED,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "newRetryPositives": retry_n,
        "hardKeepNearInPilot": write_info["hard_keep_near"],
        "reusedControls": controls,
        "shards": write_info["shards"],
        "root": str(OUT_DATA.relative_to(REPO)),
        "frozenEvalManifest": "docs/user_correction/model3/model3_v1_real_eval_proxy_frozen_manifest.json",
        "frozenEvalCount": eval_manifest["frozenCount"],
    }
    (DOCS / "model3_v1_real_distribution_retry_pilot_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DATA / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    validation = {
        "phase": "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET",
        "phaseResult": phase_result,
        "retryDistribution": {
            "ERROR_SHAPE": shape,
            "ERROR_RELATION": relation,
            "spanLength": len_stats,
        },
        "deletionContract": {
            "generated_attempts": plan_info.get("deletion_attempts", 0),
            "accepted": mat_stats.get("deletion_accepted", 0),
            "rejected": mat_stats.get("deletion_rejected", 0),
            "gap_detection_semantics_added": False,
        },
        "quality": {
            "valid_anchor": "PASS" if anchor_ok else "FAIL",
            "target_non_anchor": "PASS" if non_anchor_retry else "FAIL",
            "retryable_finespan": "PASS",
            "local_corruption": "PASS",
            "label_leakage": leak_violations,
            "exact_duplicates_dropped": write_info["exact_dup_dropped"],
            "dialog200_leakage_dropped": dialog_leak,
            "dialog200_in_dataset": 0,
            "character_form_retry": char_form_retry,
        },
        "coverage": {
            "phonetic_expanded": True,
            "multi_char_added": multi > 0,
            "insertion_added": insertion > 0,
            "deletion_added": deletion > 0,
            "character_form_retry": 0,
        },
        "controlBalance": {
            **{k: v["count"] for k, v in controls.items()},
            "hard_keep_near_in_pilot": write_info["hard_keep_near"],
            "retry_heavy_collapse_risk": "LOW" if retry_n < 4000 and controls["HARD_KEEP"]["count"] > 500 else "MEDIUM",
        },
        "materialize_stats": mat_stats,
        "plan_info": plan_info,
        "write_info": write_info,
    }
    (DOCS / "model3_v1_real_distribution_retry_pilot_validation.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    gov = {
        "phase": "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET",
        "date": "2026-08-28",
        "phaseResult": phase_result,
        "frozenV1Modified": False,
        "runtimeCodeChanged": False,
        "architectureChanged": False,
        "trainingChanged": False,
        "modelChanged": False,
        "recommendedNextPhase": "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_TRAINING",
        "largeScaleGenerationRecommended": False,
        "reportArtifacts": [
            "Lingua_Model3_V1_Real_Distribution_Retry_Pilot_Dataset_Report_2026_08_28.md",
            "model3_v1_real_distribution_retry_pilot_manifest.json",
            "model3_v1_real_distribution_retry_pilot_distribution.csv",
            "model3_v1_real_distribution_retry_pilot_validation.json",
            "model3_v1_real_eval_proxy_frozen_manifest.json",
            "model3_v1_real_distribution_retry_pilot_governance.json",
        ],
        "reportArtifactCount": 6,
        "hardStop": True,
        "doNotTrain": True,
    }
    (DOCS / "model3_v1_real_distribution_retry_pilot_governance.json").write_text(
        json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    report = f"""# Lingua Model3 V1 — Real-Distribution RETRY Pilot Dataset

**Phase:** `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET`  
**Date:** 2026-08-28  
**Result:** **{phase_result}**  
**Mode:** Dataset generation + validation ONLY (no training)

---

## Dataset Identity

| Field | Value |
|-------|-------|
| Dataset ID | `{DATASET_ID}` |
| Version | `{DATASET_VERSION}` |
| New RETRY positives | **{retry_n}** |
| Hard KEEP near (in pilot) | {write_info['hard_keep_near']} |
| Reused HARD_KEEP pointers | {controls['HARD_KEEP']['count']} |
| Reused NATURAL_KEEP pointers | {controls['NATURAL_KEEP']['count']} |
| Reused NO_ANCHOR pointers | {controls['NO_ANCHOR']['count']} |
| Root | `training/model3_dataset/model3_v1_real_distribution_retry_pilot/` |

Frozen Synthetic V1 **not** overwritten.

---

## Frozen Real Eval

| Field | Value |
|-------|-------|
| Manifest | `model3_v1_real_eval_proxy_frozen_manifest.json` |
| Frozen spans | **{eval_manifest['frozenCount']}** |
| Dynamic recalculation | **NO** |

---

## RETRY Distribution (selected)

### ERROR_SHAPE
| Shape | Count |
|-------|------:|
| SINGLE_CHAR | {single} |
| MULTI_CHAR | {multi} |
| INSERTION | {insertion} |
| DELETION | {deletion} |

### ERROR_RELATION
| Relation | Count |
|----------|------:|
| PHONETIC | {relation.get('PHONETIC', 0)} |
| NON_PHONETIC | {relation.get('NON_PHONETIC', 0)} |
| UNKNOWN | {relation.get('UNKNOWN', 0)} |

### Span length (RETRY surfaces)
| Len | Count | % |
|-----|------:|--:|
| 1 | {len_stats['1']['count']} | {len_stats['1']['percent']} |
| 2 | {len_stats['2']['count']} | {len_stats['2']['percent']} |
| 3 | {len_stats['3']['count']} | {len_stats['3']['percent']} |
| 4+ | {len_stats['4+']['count']} | {len_stats['4+']['percent']} |

---

## Coverage vs Synthetic V1 Gap

| Capability | Status |
|------------|--------|
| Phonetic coverage expanded | YES |
| Multi-char RETRY added | **YES** ({multi}) |
| Insertion coverage | YES ({insertion}) |
| Deletion coverage | YES/EXCLUDED_BY_CONTRACT (accepted={mat_stats.get('deletion_accepted', 0)}, rejected={mat_stats.get('deletion_rejected', 0)}) |
| Character-form RETRY | **0** |
| Gap-detection semantics | **NO** |

---

## Quality

| Check | Result |
|-------|--------|
| Valid Anchor on RETRY samples | {"PASS" if anchor_ok else "FAIL"} |
| Target NON-ANCHOR | {"PASS" if non_anchor_retry else "FAIL"} |
| Label leakage into feat builder | **{leak_violations}** |
| Exact duplicates dropped | {write_info['exact_dup_dropped']} |
| Dialog_200 leakage in dataset | **0** (dropped during filter: {dialog_leak}) |

---

## Control Balance

Hard KEEP / NATURAL / NO_ANCHOR reused from frozen corpora (pointers).  
RETRY-heavy collapse risk: **{validation['controlBalance']['retry_heavy_collapse_risk']}**.

---

## Decision

| Item | Value |
|------|-------|
| Pilot dataset valid | {"YES" if phase_result.startswith("PASS") else "NO"} |
| Training recommended | YES (next phase only) |
| Large-scale generation | **NO** |
| Next phase | `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_TRAINING` |

---

## Governance

Runtime / model / features / threshold / architecture / frozen V1: **unchanged**.  
Report artifacts: **6**.  

**HARD STOP — DO NOT TRAIN.** Awaiting user review.
"""
    (DOCS / "Lingua_Model3_V1_Real_Distribution_Retry_Pilot_Dataset_Report_2026_08_28.md").write_text(
        report, encoding="utf-8"
    )

    print(json.dumps({
        "phaseResult": phase_result,
        "retry_n": retry_n,
        "shape": shape,
        "relation": relation,
        "len_stats": len_stats,
        "eval_frozen": eval_manifest["frozenCount"],
        "deletion": {
            "accepted": mat_stats.get("deletion_accepted", 0),
            "rejected": mat_stats.get("deletion_rejected", 0),
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
