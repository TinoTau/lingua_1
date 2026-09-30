#!/usr/bin/env python3
"""FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_LEXICAL_VALIDITY_AUDIT — READ ONLY.

Does not rebuild lexicon, change minPrior/prior/collector/FineSpan, or train.
Does not classify 2510 characters by LLM intuition.
Does not use dialog_200 expectedText as a vocabulary source.
"""
from __future__ import annotations

import csv
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = (
    REPO
    / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
    / "single_char_repair_lexicon_lexical_validity_audit_2026_08_19"
)
REPORT = REPO / "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Repair_Lexicon_Lexical_Validity_Audit_2026_08_19.md"
TSV = REPO / "docs/pinyin-v2/import/single_char_dictionary.tsv"
SQLITE = REPO / "node_runtime/lexicon/v3/lexicon.sqlite"
JIEBA_REJECTED = (
    REPO
    / "electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains"
    / "p1_3_lexicon_zh_v2/base_zh_v2/rejected.jsonl"
)
PREV_ACCEPTS = (
    REPO
    / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
    / "bind_minprior_length1_audit_2026_08_19"
    / "bind_single_char_2331_per_candidate.jsonl"
)
PREV_TARGETS = (
    REPO
    / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
    / "single_char_collector_live_2026_08_18"
    / "single_char_target_site_per_unit.jsonl"
)
JIEBA_DICT_MISSING = REPO / "electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v1/p1_3_lexicon_zh_v1"
# source_manifest points at lexicon_sources/jieba_dict.txt which is not in-repo.

# TEST_ONLY heuristic from post_trace_governance_audit.py — not a production lexicon.
TEST_FUNCTION_WORDS = set(
    "的了是在我有和不这们中上个来到说为以要就出也得后能对下过天么起你看听那"
    "里都把还给让从被向但而或与及等吧呢啊呀吗嘛哇哦嗯哈喽着过把被将于把"
    "她他它咱您谁啥咋何哪几多么还再又才只很最太更"
)
TEST_PARTICLES = set("吗呢吧啊呀嘛哇哦嗯哈喽着")

IME_ROLE_TO_PROVISIONAL = {
    "function_single_char": "FUNCTION_WORD",
    "measure_single_char": "NUMERAL_OR_MEASURE",
}


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(p: Path, s: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s if s.endswith("\n") else s + "\n", encoding="utf-8")


def write_csv(p: Path, rows: list[dict], fieldnames: list[str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def read_jsonl(p: Path) -> list:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def load_tsv() -> list[dict]:
    text = TSV.read_text(encoding="utf-8").replace("\ufeff", "")
    lines = [l for l in text.splitlines() if l.strip()]
    header = lines[0].split("\t")
    rows = []
    for line in lines[1:]:
        cells = line.split("\t")
        rec = {h: (cells[i] if i < len(cells) else "") for i, h in enumerate(header)}
        rec["weight"] = float(rec["weight"]) if rec.get("weight") else None
        rec["frequency_rank"] = int(rec["frequency_rank"]) if rec.get("frequency_rank") else None
        rows.append(rec)
    return rows


def load_jieba_single_chars() -> dict[str, dict]:
    """DERIVED: jieba seed rows rejected as reject_single_char. Not production-authorized."""
    out: dict[str, dict] = {}
    if not JIEBA_REJECTED.exists():
        return out
    with JIEBA_REJECTED.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            rec = json.loads(line)
            w = rec.get("word") or ""
            if len(w) != 1:
                continue
            if rec.get("reason") not in ("reject_single_char", None) and rec.get("reason") != "reject_single_char":
                # keep only explicit single-char rejects; also accept len==1 regardless
                pass
            if rec.get("reason") != "reject_single_char" and len(w) == 1:
                # still a 1-char jieba entry rejected for another reason
                pass
            if rec.get("reason") != "reject_single_char":
                continue
            prev = out.get(w)
            freq = rec.get("frequency") or 0
            if prev is None or freq > (prev.get("frequency") or 0):
                out[w] = {
                    "frequency": freq,
                    "pos": rec.get("pos") or "",
                    "reason": rec.get("reason"),
                }
    return out


def load_sqlite_crossref(chars: set[str]) -> dict:
    db = sqlite3.connect(str(SQLITE))
    db.row_factory = sqlite3.Row
    len1 = set()
    for r in db.execute(
        "SELECT word FROM base_lexicon WHERE enabled=1 AND length(word)=1 AND IFNULL(is_alias,0)=0"
    ):
        len1.add(r["word"])
    multi_count = Counter()
    domain_count = Counter()
    for r in db.execute("SELECT word FROM base_lexicon WHERE enabled=1 AND length(word)>=2"):
        w = r["word"] or ""
        seen = set()
        for ch in w:
            if ch in chars and ch not in seen:
                multi_count[ch] += 1
                seen.add(ch)
    for r in db.execute("SELECT word FROM domain_lexicon WHERE enabled=1"):
        w = r["word"] or ""
        if len(w) == 1 and w in chars:
            domain_count[w] += 1
        seen = set()
        for ch in w:
            if ch in chars and ch not in seen:
                domain_count[ch] += 0  # presence via multiword domain
                seen.add(ch)
    # domain length-1 should be 0
    domain_len1 = [
        r["word"]
        for r in db.execute(
            "SELECT word FROM domain_lexicon WHERE enabled=1 AND length(word)=1"
        )
    ]
    term_len1_before_note = db.execute(
        "SELECT COUNT(*) FROM term WHERE enabled=1 AND length(word)=1"
    ).fetchone()[0]
    db.close()
    return {
        "base_len1": len1,
        "multi_count": multi_count,
        "domain_len1": domain_len1,
        "term_len1": term_len1_before_note,
    }


def homophone_groups(rows: list[dict], surface_ok: set[str] | None = None) -> dict:
    groups: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        surf = r["surface"]
        if surface_ok is not None and surf not in surface_ok:
            continue
        key = (r.get("tone_pinyin") or "").strip() or (r.get("pinyin") or "")
        groups[key].append(surf)
    sizes = Counter(len(v) for v in groups.values())
    return {
        "n_rows": sum(len(v) for v in groups.values()),
        "n_groups": len(groups),
        "size_1": sizes.get(1, 0),
        "size_2": sizes.get(2, 0),
        "size_3": sizes.get(3, 0),
        "size_4": sizes.get(4, 0),
        "size_5plus": sum(n for s, n in sizes.items() if s >= 5),
        "ambiguous_groups": sum(n for s, n in sizes.items() if s >= 2),
        "unique_rate": (sizes.get(1, 0) / len(groups)) if groups else None,
        "ambiguity_rate": (
            sum(n for s, n in sizes.items() if s >= 2) / len(groups) if groups else None
        ),
        "size_histogram": {str(k): v for k, v in sorted(sizes.items())},
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tsv_rows = load_tsv()
    assert len(tsv_rows) == 2510, len(tsv_rows)
    chars = {r["surface"] for r in tsv_rows}
    jieba = load_jieba_single_chars()
    sql = load_sqlite_crossref(chars)
    accepts = read_jsonl(PREV_ACCEPTS)
    targets = read_jsonl(PREV_TARGETS)

    # --- evidence matrix (no LLM class → SUPPORTED) ---
    matrix = []
    class_counts = Counter()
    elig_counts = Counter()
    jieba_hit = 0
    for r in tsv_rows:
        ch = r["surface"]
        role = r.get("single_char_role") or ""
        jb = jieba.get(ch)
        if jb:
            jieba_hit += 1
        ime_function = role == "function_single_char"
        test_fw = ch in TEST_FUNCTION_WORDS or ch in TEST_PARTICLES
        in_base_len1 = ch in sql["base_len1"]
        multi_n = int(sql["multi_count"].get(ch, 0))
        domain_len1 = ch in sql["domain_len1"]

        # Eligibility: no production-authorized standalone-word source → UNCERTAIN.
        # Jieba is DERIVED + historically banned for 1-char import. IME role is not wordhood.
        eligibility = "UNCERTAIN"
        provisional = IME_ROLE_TO_PROVISIONAL.get(role, "UNCERTAIN")
        class_counts[provisional] += 1
        elig_counts[eligibility] += 1

        sources = ["single_char_dictionary.tsv"]
        if jb:
            sources.append("jieba_rejected.jsonl:reject_single_char")
        if in_base_len1:
            sources.append("sqlite.base_lexicon.length1")
        if multi_n:
            sources.append("sqlite.base_lexicon.length>=2_substring")
        if test_fw:
            sources.append("post_trace_FUNCTION_WORDS:TEST_ONLY")

        matrix.append(
            {
                "char": ch,
                "pinyin": r.get("pinyin"),
                "tone": r.get("tone_pinyin"),
                "current_weight": r.get("weight"),
                "current_prior": r.get("weight"),
                "source_rank": r.get("frequency_rank"),
                "ime_role": role,
                "dictionary_word_evidence": "NO",
                "pos_evidence": (jb or {}).get("pos") or "",
                "pos_evidence_authority": "DERIVED_JIEBA_REJECTED" if jb else "NONE",
                "standalone_token_evidence": "NO",
                "standalone_frequency": (jb or {}).get("frequency") if jb else "",
                "standalone_frequency_authority": "DERIVED_JIEBA_DICT_WEIGHT" if jb else "NONE",
                "function_word_evidence": "IME_ROLE" if ime_function else ("TEST_ONLY_LIST" if test_fw else "NO"),
                "base_lexicon_evidence": "YES_IMPORTED_2510" if in_base_len1 else "NO",
                "domain_only_evidence": "YES" if domain_len1 else "NO",
                "proper_name_only_evidence": "NO_SOURCE",
                "multiword_only_evidence": multi_n,
                "evidence_sources": "|".join(sources),
                "confidence": "LOW",
                "provisional_class": provisional,
                "provisional_class_basis": "IME_ROLE" if role in IME_ROLE_TO_PROVISIONAL else "NO_AUTHORITATIVE_WORDHOOD_SOURCE",
                "repair_eligibility_status": eligibility,
            }
        )

    matrix_fields = list(matrix[0].keys())
    write_csv(OUT / "single_char_2510_evidence_matrix.csv", matrix, matrix_fields)
    uncertain_rows = [m for m in matrix if m["repair_eligibility_status"] == "UNCERTAIN"]
    write_csv(OUT / "single_char_uncertain_inventory.csv", uncertain_rows, matrix_fields)

    supported = {m["char"] for m in matrix if m["repair_eligibility_status"] == "SUPPORTED"}
    not_supported = {m["char"] for m in matrix if m["repair_eligibility_status"] == "NOT_SUPPORTED"}

    write_json(
        OUT / "single_char_2510_eligibility_summary.json",
        {
            "n": 2510,
            "SUPPORTED": elig_counts["SUPPORTED"],
            "NOT_SUPPORTED": elig_counts["NOT_SUPPORTED"],
            "UNCERTAIN": elig_counts["UNCERTAIN"],
            "rates": {k: elig_counts[k] / 2510 for k in ("SUPPORTED", "NOT_SUPPORTED", "UNCERTAIN")},
            "provisional_class_counts": dict(class_counts),
            "rule": "SUPPORTED requires production-authorized standalone lexical evidence. None present. IME role and jieba rejected-seed are recorded but do not authorize SUPPORTED/NOT_SUPPORTED.",
            "CURRENT_INVENTORY_HAS_NO_WORDHOOD_EVIDENCE": True,
        },
    )
    write_json(
        OUT / "single_char_wordhood_evidence_summary.json",
        {
            "CURRENT_INVENTORY_HAS_NO_WORDHOOD_EVIDENCE": True,
            "tsv_has_pos": False,
            "tsv_has_standalone_frequency": False,
            "tsv_has_token_frequency": False,
            "tsv_weight_meaning": "IME decoder role policy (function=0.30 ... fallback=0.08), not character frequency and not lexical frequency",
            "frequency_rank_meaning": "Order in General Standard Chinese Characters level-1 list (1–2510), not corpus word frequency",
            "jieba_reject_single_char_overlap": jieba_hit,
            "jieba_dict_txt_in_repo": False,
            "jieba_authorized_for_length1_production": False,
            "v2_classify_one_char": "reject / banSingleChar=true",
            "kenlm_corpus": "character-separated (not tokenized words)",
            "tokenized_corpus": "TOKENIZED_CORPUS_REQUIRED",
            "sqlite_length1_is_this_import": True,
            "sqlite_length1_n": len(sql["base_len1"]),
            "domain_length1_n": len(sql["domain_len1"]),
        },
    )

    current_groups = homophone_groups(tsv_rows)
    supported_groups = homophone_groups(tsv_rows, supported)
    write_json(OUT / "single_char_current_homophone_groups.json", {"universe": "CURRENT_2510", **current_groups})
    write_json(
        OUT / "single_char_supported_homophone_groups.json",
        {"universe": "SUPPORTED", "empty_because": "no authorized wordhood source", **supported_groups},
    )
    write_json(
        OUT / "single_char_unique_tone_comparison.json",
        {
            "current": current_groups,
            "supported": supported_groups,
            "note": "Supported universe is empty; unique-tone yield under a rebuilt repair lexicon cannot be estimated from authorized evidence.",
        },
    )

    # --- 毫 / 涡 ---
    special = {}
    for ch in ("毫", "涡", "好", "我"):
        rec = next((m for m in matrix if m["char"] == ch), None)
        special[ch] = rec

    # --- counterfactual on 2331 / 512 ---
    subst = [a for a in accepts if a.get("substitution")]
    ident = [a for a in accepts if a.get("identity")]
    expected_accepts = [
        a
        for a in accepts
        if any(
            t.get("dialog_id") == a.get("dialog_id")
            and t.get("expected_text") == a.get("selectedCandidate")
            and t.get("expected_surface_accepted")
            for t in targets
        )
    ]

    def universe_outcome(selected: str, window: str, mode: str) -> str:
        # empty SUPPORTED → every query has 0 eligible repair items
        return "no_candidate"

    remain_subst = 0
    removed_subst = 0
    expected_cf = 0
    nonexp_subst = 0
    ident_cf = 0
    amb_cf = 0
    none_cf = 0
    for a in accepts:
        sel = a.get("selectedCandidate") or ""
        wt = a.get("windowText") or ""
        outc = universe_outcome(sel, wt, a.get("accept_mode"))
        if outc == "no_candidate":
            none_cf += 1
            if a.get("substitution"):
                removed_subst += 1
        elif outc == "ambiguous":
            amb_cf += 1
        elif a.get("identity"):
            ident_cf += 1
        elif a.get("substitution"):
            remain_subst += 1
            if any(
                t.get("expected_surface_accepted")
                and t.get("dialog_id") == a.get("dialog_id")
                and t.get("expected_text") == sel
                for t in targets
            ):
                expected_cf += 1
            else:
                nonexp_subst += 1

    write_json(
        OUT / "single_char_supported_subset_counterfactual.json",
        {
            "supported_n": len(supported),
            "previous_substitution_opportunities": len(subst),
            "remain_under_supported_universe": remain_subst,
            "removed": removed_subst,
            "expected_corrections": expected_cf,
            "non_expected_substitution_opportunities": nonexp_subst,
            "identity_candidates": ident_cf,
            "ambiguous_fallback": amb_cf,
            "no_candidate": none_cf,
            "note": "SUPPORTED universe is empty because no authorized wordhood source exists. This is not a tuned subset.",
        },
    )
    write_json(
        OUT / "single_char_substitution_opportunity_comparison.json",
        {
            "previous": {
                "substitution": len(subst),
                "identity": len(ident),
                "expected_among_accepts": sum(1 for t in targets if t.get("expected_surface_accepted")),
            },
            "supported_universe": {
                "substitution_remain": remain_subst,
                "substitution_removed": removed_subst,
                "identity": ident_cf,
                "no_candidate": none_cf,
            },
            "hao_hao": special.get("毫"),
            "wo_wo": special.get("涡"),
            "hao_window": special.get("好"),
            "wo_window": special.get("我"),
            "live_examples": {
                "好→毫": {
                    "window_ime_role": (special.get("好") or {}).get("ime_role"),
                    "candidate_ime_role": (special.get("毫") or {}).get("ime_role"),
                    "candidate_eligibility": (special.get("毫") or {}).get("repair_eligibility_status"),
                    "do_not_assume_delete": True,
                },
                "我→涡": {
                    "window_ime_role": (special.get("我") or {}).get("ime_role"),
                    "candidate_ime_role": (special.get("涡") or {}).get("ime_role"),
                    "candidate_eligibility": (special.get("涡") or {}).get("repair_eligibility_status"),
                    "do_not_assume_delete": True,
                },
            },
        },
    )

    in_lex = sum(1 for t in targets if t.get("in_base"))
    exp_in_supported = sum(1 for t in targets if (t.get("expected_text") or "") in supported)
    exp_in_not = sum(1 for t in targets if (t.get("expected_text") or "") in not_supported)
    exp_in_unc = sum(
        1
        for t in targets
        if (t.get("expected_text") or "") not in supported
        and (t.get("expected_text") or "") not in not_supported
    )
    # unique-tone expected under SUPPORTED: empty universe → 0
    write_json(
        OUT / "single_char_dialog200_coverage_evaluation.json",
        {
            "dialog_200_used_as_vocabulary_source": False,
            "true_recall_single_char_targets": len(targets),
            "current_2510_coverage": in_lex,
            "supported_universe_coverage": exp_in_supported,
            "not_supported_target_count": exp_in_not,
            "uncertain_target_count": exp_in_unc,
            "expected_unique_tone_candidate": 0,
            "non_expected_unique_tone_candidate": 0,
            "note": "Coverage is evaluation-only after independent classification. SUPPORTED is empty.",
        },
    )
    write_json(
        OUT / "dialog200_vocabulary_leakage_check.json",
        {
            "used_expectedText_to_decide_eligibility": False,
            "used_dialog200_as_vocabulary_source": False,
            "dialog200_role": "evaluation_only_after_classification",
            "pass": True,
        },
    )

    # --- source inventory / ACP / governance written as static+computed ---
    source_rows = [
        {
            "source": "docs/pinyin-v2/import/single_char_dictionary.tsv",
            "kind": "IME common-character inventory",
            "authority": "AUTHORITATIVE_FOR_IME",
            "production_lexicon_allowed": "YES_FOR_IME; NOT_A_WORD_DICTIONARY",
            "wordhood": "NO",
            "standalone_token_freq": "NO",
            "pos": "NO",
            "notes": "General Standard level-1 + pinyin-data; IME role/weight policy",
        },
        {
            "source": "docs/pinyin-v1/archive/import/pinyin-ime-v1_single_char_dictionary_v2_2500.*",
            "kind": "historical IME spike copy",
            "authority": "LEGACY",
            "production_lexicon_allowed": "NO (archive)",
            "wordhood": "NO",
            "standalone_token_freq": "NO",
            "pos": "NO",
            "notes": "same 2510; generated 2026-06-02 for pinyin-ime-v1",
        },
        {
            "source": "jieba dict.txt (fxsjy/jieba MIT) via rejected.jsonl",
            "kind": "segmentation dictionary seed",
            "authority": "DERIVED",
            "production_lexicon_allowed": "NO for length-1 (banSingleChar / reject one_char)",
            "wordhood": "PARTIAL (jieba token weights, not linguistic wordhood proof)",
            "standalone_token_freq": "DERIVED dict weight, not corpus token count",
            "pos": "YES (jieba POS tags on rejected 1-char rows)",
            "notes": "lexicon_sources/jieba_dict.txt missing from repo; snapshot is rejected.jsonl",
        },
        {
            "source": "p1_3 base_zh_v2 entries.jsonl",
            "kind": "generic 2–3 char lexicon seed",
            "authority": "AUTHORITATIVE for 2–3 char base seed",
            "production_lexicon_allowed": "YES (2–3 only)",
            "wordhood": "N/A length>=2",
            "standalone_token_freq": "NO length-1",
            "pos": "filtered out",
            "notes": "lengthDistribution 2/3 only",
        },
        {
            "source": "electron_node/docs/lexicon-assets/full_rebuild_v1/*.csv",
            "kind": "Lexicon V3 SSOT multi-char",
            "authority": "AUTHORITATIVE",
            "production_lexicon_allowed": "YES",
            "wordhood": "multi-char terms",
            "standalone_token_freq": "NO",
            "pos": "NO",
            "notes": "v2-classify-row rejects one_char",
        },
        {
            "source": "kenLM/corpus/v1/corpus_v1.char.txt + zh_char_3gram.arpa",
            "kind": "character language model corpus",
            "authority": "AUTHORITATIVE for KenLM char scoring",
            "production_lexicon_allowed": "NO as word list",
            "wordhood": "NO (character-separated)",
            "standalone_token_freq": "NO — character frequency only",
            "pos": "NO",
            "notes": "TOKENIZED_CORPUS_REQUIRED for length=1 word frequency",
        },
        {
            "source": "kenLM/corpus/v1/corpus_v1.raw.txt / wikipedia_sentences.txt",
            "kind": "raw Chinese text",
            "authority": "AUTHORITATIVE as KenLM source text",
            "production_lexicon_allowed": "NO without new NLP pipeline",
            "wordhood": "NO (untokenized)",
            "standalone_token_freq": "NO",
            "pos": "NO",
            "notes": "this round forbids introducing a new segmenter",
        },
        {
            "source": "post_trace_governance_audit.py FUNCTION_WORDS",
            "kind": "audit heuristic set",
            "authority": "TEST_ONLY",
            "production_lexicon_allowed": "NO",
            "wordhood": "heuristic",
            "standalone_token_freq": "NO",
            "pos": "NO",
            "notes": "unit classification only",
        },
        {
            "source": "node_runtime/lexicon/v3/lexicon.sqlite length-1 rows",
            "kind": "runtime copy of TSV import",
            "authority": "CIRCULAR",
            "production_lexicon_allowed": "YES as current FW recall inventory",
            "wordhood": "NO additional",
            "standalone_token_freq": "NO",
            "pos": "NO",
            "notes": "cannot prove wordhood; it IS the 2510 import",
        },
        {
            "source": "dialog_200 expectedText",
            "kind": "evaluation set",
            "authority": "EVALUATION_ONLY",
            "production_lexicon_allowed": "NO",
            "wordhood": "NO",
            "standalone_token_freq": "NO",
            "pos": "NO",
            "notes": "forbidden as vocabulary source this round",
        },
    ]
    write_csv(
        OUT / "single_char_lexical_source_inventory.csv",
        source_rows,
        [
            "source",
            "kind",
            "authority",
            "production_lexicon_allowed",
            "wordhood",
            "standalone_token_freq",
            "pos",
            "notes",
        ],
    )
    write_json(
        OUT / "single_char_source_authority_matrix.json",
        {
            "lexical_dictionary_available": False,
            "pos_evidence_available": "DERIVED_ONLY_JIEBA_REJECTED_SNAPSHOT",
            "standalone_token_evidence_available": False,
            "standalone_frequency_available": False,
            "sources_sufficient_for_rebuild": False,
            "tokenized_corpus_required": True,
            "jieba_reauthorization_would_be_contract_change": True,
            "rows": source_rows,
        },
    )

    consumers = [
        {
            "consumer": "pinyin-ime-v2-dict-load.ts",
            "artifact": "docs/pinyin-v2/import/single_char_dictionary.tsv",
            "use": "IME byFirst / byFirstFallback single-char beam",
            "runtime_active": "YES",
            "can_shrink_for_fw_repair": "NO",
        },
        {
            "consumer": "pinyin-ime-v2-decoder.ts",
            "artifact": "loaded IME dict from TSV",
            "use": "decoder path-breakage fallback (MAIN_BEAM vs FALLBACK roles)",
            "runtime_active": "YES",
            "can_shrink_for_fw_repair": "NO",
        },
        {
            "consumer": "full-rebuild-from-csv.mjs loadSingleCharRows",
            "artifact": "same TSV → sqlite term/base_lexicon",
            "use": "Lexicon V3 length-1 import",
            "runtime_active": "YES (build)",
            "can_shrink_for_fw_repair": "NO without splitting data duties",
        },
        {
            "consumer": "collectBaseOnlySingleCharCandidate",
            "artifact": "sqlite base_lexicon length-1",
            "use": "FW Repair single-char recall",
            "runtime_active": "YES",
            "can_shrink_for_fw_repair": "this is the repair consumer; shrinking TSV still breaks IME",
        },
        {
            "consumer": "exportPinyinImeV1Layer (base_lexicon, no length filter)",
            "artifact": "node_runtime/pinyin-ime-v2/dict/base_dictionary.txt",
            "use": "would copy sqlite length-1 on next export; current export file appears pre-2510",
            "runtime_active": "YES (export path)",
            "can_shrink_for_fw_repair": "NO",
        },
        {
            "consumer": "length-1 sqlite integration tests",
            "artifact": "production sqlite",
            "use": "contract tests",
            "runtime_active": "TEST",
            "can_shrink_for_fw_repair": "N/A",
        },
        {
            "consumer": "Model2 prior_score feature",
            "artifact": "bound WindowCandidates",
            "use": "feature if length-1 ever binds",
            "runtime_active": "POTENTIAL (currently 0 lexical 1-char edges)",
            "can_shrink_for_fw_repair": "do not remap priors this round",
        },
    ]
    write_csv(
        OUT / "single_char_consumer_inventory.csv",
        consumers,
        ["consumer", "artifact", "use", "runtime_active", "can_shrink_for_fw_repair"],
    )

    write_text(
        OUT / "single_char_dictionary_provenance.md",
        """# single_char_dictionary.tsv provenance

## What the file is

`docs/pinyin-v2/import/single_char_dictionary.tsv` is the **Pinyin-IME single-character inventory**, not a single-character **word** dictionary and not an ASR repair dictionary.

It was created **2026-06-02** as `pinyin-ime-v1_single_char_dictionary_v2_2500` to stop **IME decoder path breakage** by adding controlled single-character support. Archive: `docs/pinyin-v1/archive/import/` (README + manifest).

On **2026-08-18** the same file was imported into Lexicon V3 via `full-rebuild-from-csv.mjs` `loadSingleCharRows` to fill Lattice CR 1.0.2’s empty length-1 `base_lexicon` (0 → 2510). That import reused an **IME character list** as the **FW Repair length-1 recall inventory**.

## Sources (manifest)

- Characters: `shengdoushi/common-standard-chinese-characters-table` **level-1**
- Readings: `mozillazg/pinyin-data` `pinyin.txt`
- Tag: `common-standard-level-1+pinyin-data`
- Unique surfaces: **2510** (target 2500)

Generation script is **not in-repo**; only TSV + archived README/manifest remain.

## What it is not

| Hypothesis | Verdict |
|------------|---------|
| IME character inventory | **YES — original purpose** |
| Frequency list of standalone words | **NO** (`frequency_rank` = 通用规范汉字一级 **表序**) |
| Lexical / word dictionary | **NO** (no POS, no wordhood, no token freq) |
| Single-character word dictionary | **NO** |
| ASR repair dictionary | **NO** (repurposed 2026-08-18) |

README: *“This file is a pinyin-ime-v1 import candidate, not a second runtime database.”* Recommended IME behavior: function/time/place/measure = low-weight **bridge**; content = **fallback**; rare excluded.

## Weight (do not guess from the column name)

Manifest `weight_policy` is a **fixed IME decoder role table**:

| Role | N | Weight |
|------|--:|-------:|
| function_single_char | 79 | 0.30 |
| time_single_char | 22 | 0.26 |
| place_direction_single_char | 33 | 0.24 |
| measure_single_char | 32 | 0.22 |
| service_content_single_char | 29 | 0.14 |
| content_single_char | 698 | 0.12 |
| content_single_char_fallback | 1617 | 0.08 |

This is **manual/role IME prior**, not character frequency, not lexical frequency, not input probability from a corpus.

## Wordhood fields in the TSV

None: no POS, no standalone/token frequency, no dictionary identity beyond 通用规范汉字.

**CURRENT_INVENTORY_HAS_NO_WORDHOOD_EVIDENCE.**
""",
    )

    write_text(
        OUT / "single_char_repair_lexicon_contract_gap.md",
        """# Contract gap

## OLD (frozen in practice after 2026-08-18 import)

```
COMMON_CHARACTER_INVENTORY (~2510 IME / 通用规范一级)
    → sqlite base_lexicon length-1
    → collectBaseOnlySingleCharCandidate
    → bindLexiconHitsToWindow(minPrior=0.5)
```

Lattice CR 1.0.2 asked for a **bounded base-only exact** length-1 inventory (~2000–3000). It did **not** define *independent lexical wordhood*. The 2510 fill satisfied **count and source-file existence**, not *valid one-character repair items*.

## PROPOSED (this audit — not implemented)

```
INDEPENDENT_SINGLE_CHAR_LEXICAL_REPAIR_INVENTORY
    = length 1
    AND independent lexical identity (authoritative evidence)
    AND attested modern standalone use
    AND suitable as ASR lexical replacement
```

This is a **contract change**. It is **supported as a direction** by: (1) TSV provenance = IME characters; (2) zero wordhood fields; (3) live unique-tone substitutions such as 好→毫 / 我→涡 from fallback-role characters; (4) IME still needs the full 2510.

It is **not** yet supported as a rebuild, because no authorized wordhood source exists in-repo.

## Out of scope for ACP

Model2, FineSpan, Assembly, KenLM, Domain Vote, minPrior value, prior remap, collector uniqueness rules.
""",
    )

    write_text(
        OUT / "single_char_repair_lexicon_option_analysis.md",
        """# Option analysis

## OPTION A — Keep 2510 common-char inventory as repair lexicon

Keeps Lattice 1.0.2 fill. Continues IME-weight vs minPrior incompatibility and unique-tone competition among fallback characters (毫/涡). **Does not** match the audited product hypothesis.

## OPTION B — Rebuild from authoritative single-char word evidence **now**

**Blocked:** Sources Sufficient For Rebuild = NO. jieba 1-char was explicitly `banSingleChar`. KenLM is character-level. No tokenized word corpus. Rebuilding from jieba POS/freq this round would be an unauthorized source promotion + implicit thresholding.

## OPTION C — Two-layer data model (recommended architecture)

1. **Keep** `single_char_dictionary.tsv` / 2510 as **IME common-character inventory** (decoder fallback). Do not shrink it for FW Repair.
2. **Create** a separate **single-char repair lexicon** (static offline table) once an authorized wordhood source exists.
3. FW length-1 recall reads **only** the repair table.
4. Prior/minPrior relation for that table is a **later** contract (not this round).

## Consumers

IME V2 loads the TSV directly. Shrinking 2510 for repair would regress IME path-breakage design. **Can existing inventory be replaced directly: NO.**
""",
    )

    write_text(
        OUT / "single_char_repair_lexicon_acp_preparation.md",
        """# ACP preparation (not an approved change)

**Title:** Separate IME common-character inventory from single-char FW Repair lexicon; do not rebuild until an authorized wordhood source is adopted.

**Scope:** eligibility of length-1 *repair* rows only; note that prior ownership and bind/minPrior for that new table remain UNDEFINED.

**Not in scope:** Model2, FineSpan, Assembly, KenLM, Domain Vote, collector uniqueness, minPrior numeric change, prior remap, sqlite rewrite this round.

**Next-phase menu (user chooses):**

- C. FIND BETTER AUTHORITATIVE SOURCE (tokenized corpus / licensed word list / explicitly re-authorized jieba 1-char policy)
- B. SEPARATE COMMON-CHAR AND REPAIR INVENTORIES (schema/ownership first; fill later)
- A. REBUILD only after C
- D. Further redesign or abandon single-char repair contract if unique-tone remains unsafe even on a true word list

**Runtime target (unchanged complexity):** lookup → exact pinyin+tone → 0 fallback / 1 candidate / >1 fallback. No wordhood classifier at runtime.
""",
    )

    write_json(
        OUT / "production_business_code_modified.json",
        {"modified": False, "sqlite_modified": False, "tsv_modified": False, "minPrior_modified": False},
    )
    write_json(
        OUT / "frozen_component_change_check.json",
        {
            "minPrior": "UNCHANGED",
            "priorScore": "UNCHANGED",
            "single_char_inventory_2510": "UNCHANGED",
            "single_char_dictionary.tsv": "UNCHANGED",
            "collector": "UNCHANGED",
            "FineSpan": "UNCHANGED",
            "Model2": "UNCHANGED",
            "Assembly": "UNCHANGED",
            "KenLM": "UNCHANGED",
            "Training": "NO",
            "dialog_200_expectedText": "UNCHANGED",
            "this_round": "READ_ONLY_AUDIT",
        },
    )
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {
                "path": "docs/user_correction/scripts/single_char_repair_lexicon_lexical_validity_audit.py",
                "role": "read-only audit",
                "behavior_change": "no",
            },
            {
                "path": "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Repair_Lexicon_Lexical_Validity_Audit_2026_08_19.md",
                "role": "audit report",
                "behavior_change": "no",
            },
            {
                "path": str(OUT.relative_to(REPO)).replace("\\", "/"),
                "role": "audit artifacts",
                "behavior_change": "no",
            },
        ],
        ["path", "role", "behavior_change"],
    )

    go = {
        "Single-Char Repair Lexicon Audit": "INSUFFICIENT_SOURCE",
        "current_n": 2510,
        "wordhood_in_current_source": False,
        "suitable_as_repair_lexicon": False,
        "SUPPORTED": elig_counts["SUPPORTED"],
        "NOT_SUPPORTED": elig_counts["NOT_SUPPORTED"],
        "UNCERTAIN": elig_counts["UNCERTAIN"],
        "jieba_overlap": jieba_hit,
        "current_unique_groups": current_groups["size_1"],
        "current_ambiguous_groups": current_groups["ambiguous_groups"],
        "supported_n": len(supported),
        "substitution_remain": remain_subst,
        "substitution_removed": removed_subst,
        "no_candidate": none_cf,
        "dialog200_targets": len(targets),
        "coverage_2510": in_lex,
        "coverage_supported": exp_in_supported,
        "other_consumers": "Pinyin-IME-V2 decoder (TSV) + full-rebuild + FW collector",
        "replace_directly": False,
        "separate_repair_lexicon_recommended": True,
        "contract_change_supported": True,
        "acp_required": True,
        "rebuild_now": "HOLD",
        "change_minPrior": "NO",
        "next_phase": "FIND_AUTHORITATIVE_SINGLE_CHAR_WORDHOOD_SOURCE_THEN_SEPARATE_INVENTORY",
    }
    write_json(OUT / "go_summary.json", go)

    report = f"""# Lingua FW Repair V4 — Single-Char Repair Lexicon Lexical Validity Audit

**Date:** 2026-08-19  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_LEXICAL_VALIDITY_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY  
**Artifacts:** `{OUT.relative_to(REPO).as_posix()}/`

未改 SQLite、TSV、minPrior、prior、collector、FineSpan、Model2；未训练；未用 dialog_200 expectedText 选字；未用 LLM 逐字判决 2510。

---

## 0. 假设是否成立

**成立方向：**「常用汉字」≠「可独立用于单字纠错的词」。

当前 2510 的原始用途是 **Pinyin-IME 解码断路单字表**（通用规范汉字一级 + pinyin-data），权重是 **IME 角色政策**（fallback=0.08 … 功能词=0.30），不是成词证据。

2026-08-18 把它导入 `base_lexicon` 只满足了 Lattice「约 2000–3000 单字库存存在」，**没有**满足「独立 lexical repair item」。

**不能在本轮重建：** 仓库没有已授权的单字成词 / 独立 token 频率源。jieba 1 字曾被 `banSingleChar` / `reject one_char` 明确拒绝进生产词库。KenLM 语料是**按字切开的**，不是分词语料。

---

## 1. 当前源语义

见 `single_char_dictionary_provenance.md`。

**CURRENT_INVENTORY_HAS_NO_WORDHOOD_EVIDENCE.**

`frequency_rank` = 一级字表序号。`weight` = IME role 常量表，不是字频。

## 2. 权威源

| 能力 | 状态 |
|------|------|
| 汉语**词**典（单字词条） | 无 |
| 生产授权 POS | 无（仅有 jieba **拒绝快照** POS，DERIVED） |
| 独立 token 证据 | 无 |
| 独立词频 | 无 |
| 分词后语料 | TOKENIZED_CORPUS_REQUIRED |
| 足以 rebuild | **否** |

jieba overlap with 2510: **{jieba_hit}** / 2510 出现在 `rejected.jsonl` `reject_single_char`。这只证明 jieba 种子里有这些一字条目且被 Lingua **拒绝导入**，不能当作本轮 SUPPORTED。

## 3. 2510 资格

机械规则：没有生产授权成词证据 → 全部 **UNCERTAIN**。  
禁止把「看起来不像词」标成 NOT_SUPPORTED。  
禁止把 IME fallback 角色标成 NOT_SUPPORTED。

IME 角色仅用于 **provisional_class** 的极小子集：function→FUNCTION_WORD（79），measure→NUMERAL_OR_MEASURE（32）。其余 UNCERTAIN。

## 4. 好→毫 / 我→涡

不得假设应删除。

| 字 | IME role | weight | eligibility |
|----|----------|--------|-------------|
| 好 | content_single_char | 0.12 | UNCERTAIN |
| 毫 | content_single_char_fallback | 0.08 | UNCERTAIN |
| 我 | function_single_char | 0.30 | UNCERTAIN |
| 涡 | content_single_char_fallback | 0.08 | UNCERTAIN |

Live unique-tone 走的是**声学调**，不是汉字词典调：窗「好」在 tone2 上唯一命中「毫」。这是 collector 冻结语义 + 过大 character universe 的组合，不是本轮可修的实现 bug。

## 5. Consumers

IME V2 **正在**读这份 TSV 做 `byFirstFallback`。因此 **不能**为了 FW Repair 直接把 2510 删成几百个。优先 **数据职责分离**（Option C）。

## 6. minPrior

本轮不解决 0.08–0.30 vs 0.5。未来若存在小型 repair lexicon，operational prior 是否仍需要：**UNDEFINED**（禁止统一 prior=0.9，禁止扫阈值）。

---

Single-Char Repair Lexicon Audit:
INSUFFICIENT_SOURCE


================================================
CURRENT INVENTORY
================================================

Current Characters:
2510


Original Purpose:
Pinyin-IME decoder path-breakage single-character inventory (通用规范汉字一级 + mozillazg pinyin-data), later reused as FW Repair length-1 base_lexicon fill


Wordhood Evidence In Current Source:
NO


Current Inventory Suitable As Repair Lexicon:
NO


================================================
AUTHORITATIVE SOURCES
================================================

Lexical Dictionary Available:
NO


POS Evidence Available:
NO


Standalone Token Evidence Available:
NO


Standalone Frequency Available:
NO


Sources Sufficient For Rebuild:
NO


================================================
2510 EVIDENCE
================================================

SUPPORTED:
0


NOT_SUPPORTED:
0


UNCERTAIN:
2510


Independent Content Words:
0


Function Words:
{class_counts.get('FUNCTION_WORD', 0)} (IME role provisional only; eligibility UNCERTAIN)


Numeral / Measure:
{class_counts.get('NUMERAL_OR_MEASURE', 0)} (IME role provisional only; eligibility UNCERTAIN)


Interjection / Discourse:
0


Bound / Formation Components:
0


Proper-Name Components:
0


Rare Standalone:
0


================================================
CANDIDATE UNIVERSE
================================================

Current Universe:
2510


Evidence-Supported Repair Universe:
0


Current Unique Pinyin+Tone Groups:
{current_groups['size_1']}


Supported Unique Pinyin+Tone Groups:
{supported_groups['size_1']}


Current Ambiguous Groups:
{current_groups['ambiguous_groups']}


Supported Ambiguous Groups:
{supported_groups['ambiguous_groups']}


================================================
COUNTERFACTUAL
================================================

Previous Substitution Opportunities:
{len(subst)}


Remain Under Supported Universe:
{remain_subst}


Removed:
{removed_subst}


Expected Corrections:
{expected_cf}


Non-Expected Substitution Opportunities:
{nonexp_subst}


Identity Candidates:
{ident_cf}


Ambiguous Fallback:
{amb_cf}


No Candidate:
{none_cf}


================================================
DIALOG_200 EVALUATION
================================================

True-Recall Single-Char Targets:
{len(targets)}


Current 2510 Coverage:
{in_lex}


Supported-Universe Coverage:
{exp_in_supported}


Expected Unique-Tone Candidate:
0


Non-Expected Unique-Tone Candidate:
0


================================================
CONSUMERS
================================================

2510 Inventory Other Consumers:
Pinyin-IME-V2 (TSV → byFirstFallback); full-rebuild import; IME export path over sqlite base_lexicon; tests; Model2 feature if edges bind


Can Existing Inventory Be Replaced Directly:
NO


Separate Repair Lexicon Recommended:
YES


================================================
CONTRACT
================================================

Old Contract:
COMMON_CHARACTER_INVENTORY


Proposed Contract:
INDEPENDENT_SINGLE_CHAR_LEXICAL_REPAIR_INVENTORY


Contract Change Supported By Evidence:
YES


Architecture Change Proposal Required:
YES


================================================
DECISION
================================================

Rebuild Single-Char Repair Lexicon:
HOLD


Modify Existing 2510 Source:
NO


Create Separate Repair Inventory:
YES


Change minPrior Now:
NO


Change priorScore Now:
NO


Change Collector:
NO


Change FineSpan:
NO


Change Model2:
NO


Change Assembly:
NO


Training:
NO


Recommended Target Size:
UNKNOWN


Recommended Next Phase:
FIND_AUTHORITATIVE_SINGLE_CHAR_WORDHOOD_SOURCE (tokenized corpus or licensed word list; jieba 1-char would need explicit re-authorization). Then SEPARATE IME inventory vs repair inventory. Do not rebuild from 2510 roles or dialog_200.
"""
    write_text(REPORT, report)
    write_text(OUT / REPORT.name, report)
    print(json.dumps(go, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
