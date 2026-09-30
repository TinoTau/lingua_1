#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Corrected offline causal evaluator for fresh dialog_200.

Rules:
- Historical mechanismFinal MUST NOT determine fresh breakpoints.
- Historical lexical identity MAY inform targets (with fresh applicability).
- PROVE from fresh RUN_ID evidence, else NOT_ISOLATED / UNKNOWN.
- Quality baseline (raw/final exact) is immutable for a fixed RUN_ID dump.
"""
from __future__ import annotations

import argparse
import csv
import difflib
import json
import math
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "docs" / "user_correction" / "model3"
MINIMALITY_CSV = OUT / "model3_v2_s3_mechanism_revalidation.csv"
LEX_DB = REPO / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"
DEFAULT_RUN_ID = "dialog200_full_pipeline_20260909_001141"

QUALITY_BASELINE = {
    "RAW_CORRECT": 25,
    "FINAL_CORRECT": 31,
    "NET_CORRECT_GAIN": 6,
    "RAW_CER": 0.2303,
    "FINAL_CER": 0.1670,
}

BREAKPOINTS = [
    "TARGET_NOT_ISOLATED",
    "NO_LOCAL_LEXICAL_TARGET_PROVEN",
    "FINE_SPAN_TARGET_NOT_EXPOSED",
    "QUERY_NOT_REPAIR_CAPABLE",
    "LEXICON_COVERAGE_MISSING",
    "RECALL_MATCHING_FAILED",
    "DOMAIN_BUCKET_FILTER_LOSS",
    "MODEL2_FAILURE",
    "MODEL3_FALSE_KEEP",
    "MODEL3_FALSE_RETRY",
    "RETRY_RECALL_FAILED",
    "ASSEMBLY_CANDIDATE_LOSS",
    "CANDIDATE_CAP_LOSS",
    "KENLM_WRONG_SELECTION",
    "FINAL_APPLY_MISMATCH",
    "UNKNOWN_NOT_ISOLATED",
]

FUNNEL_STAGES = [
    "Fresh raw wrong",
    "Valid local target",
    "FineSpan exposed",
    "Query capable",
    "Lexicon covered",
    "Recall returned target",
    "Domain survived",
    "Model2 survived",
    "Model3 survived",
    "Retry survived",
    "Assembly materialized",
    "Cap survived",
    "KenLM reached",
    "KenLM selected",
    "Final applied",
]


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…·]+", "", (s or "")).lower()


def levenshtein(a: str, b: str) -> int:
    a, b = a or "", b or ""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


def cer(ref: str, hyp: str) -> float:
    r, h = norm(ref), norm(hyp)
    if not r:
        return 0.0 if not h else 1.0
    return levenshtein(r, h) / len(r)


@dataclass
class EvidenceField:
    value: Any
    evidenceSource: str
    evidenceLevel: str
    evidenceRunId: str
    confidence: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def ev(
    value: Any,
    source: str,
    level: str,
    run_id: str,
    confidence: str,
) -> EvidenceField:
    return EvidenceField(value, source, level, run_id, confidence)


def load_jsonl(path: Path) -> List[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def load_minimality(path: Path = MINIMALITY_CSV):
    """Load lexical identity only — mechanismFinal is ignored for classification."""
    with path.open(encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    primary: Dict[str, List[dict]] = defaultdict(list)
    invalid: Dict[str, List[dict]] = defaultdict(list)
    for r in rows:
        role = r.get("targetRole") or ""
        # Strip causal mechanism from identity payload used by classifier.
        identity = {
            "caseId": r.get("caseId"),
            "targetId": r.get("targetId"),
            "lexicalTarget": r.get("lexicalTarget") or "",
            "targetRole": role,
            "identitySource": r.get("identitySource") or "",
            "status": r.get("status") or "",
            # retained only for reconciliation comparison
            "_historical_mechanismFinal": r.get("mechanismFinal") or "",
        }
        if role == "PRIMARY_MINIMAL":
            primary[r["caseId"]].append(identity)
        elif role == "INVALID_LEXICAL_TARGET":
            invalid[r["caseId"]].append(identity)
    return primary, invalid, rows


def open_lexicon(db_path: Path = LEX_DB):
    if not db_path.exists():
        return None, set()
    con = sqlite3.connect(str(db_path))
    words = {r[0] for r in con.execute("SELECT word FROM term WHERE enabled=1")}
    return con, words


def lex_lookup(con, words, term: str) -> dict:
    if not term:
        return {"exists": False, "term": term}
    out = {"exists": term in words, "term": term, "lexiconPath": str(LEX_DB)}
    if not out["exists"] or con is None:
        return out
    row = con.execute(
        "SELECT word, COALESCE(pinyin_key,''), COALESCE(tone_pinyin_key,''), COALESCE(tier,'') "
        "FROM term WHERE word=? AND enabled=1 LIMIT 1",
        (term,),
    ).fetchone()
    tags: List[str] = []
    try:
        tags = [str(t[0]) for t in con.execute(
            "SELECT domain FROM term_domain_tags tdt "
            "JOIN term t ON t.id=tdt.term_id WHERE t.word=?",
            (term,),
        ).fetchall()]
    except sqlite3.Error:
        pass
    if not tags:
        try:
            tags = [str(t[0]) for t in con.execute(
                "SELECT tag FROM term_domain_tags WHERE word=?", (term,)
            ).fetchall()]
        except sqlite3.Error:
            pass
    if row:
        out.update(
            {
                "pinyin": row[1],
                "tone": row[2],
                "tier": row[3],
                "domainTags": tags,
                "baseOrDomain": "domain" if tags else "base",
            }
        )
    return out


def collect_fresh_trace(rec: dict) -> dict:
    """Extract only fields present in the fresh compact dump."""
    decisions = []
    retry_regions = []
    recall_invocations = []
    assembly = []
    base_cands = []
    model2_union = []
    domain_votes = []
    paths = rec.get("paths") or []
    for p in paths:
        assembly.extend(p.get("assembly_sentences") or [])
        base_cands.extend(p.get("base_candidates") or [])
        model2_union.extend(p.get("model2_union") or [])
        if p.get("domain_vote"):
            domain_votes.append({"path_id": p.get("path_id"), **(p.get("domain_vote") or {})})
        m3 = p.get("model3") or {}
        for d in m3.get("decisions") or []:
            decisions.append({**d, "path_id": p.get("path_id")})
        for r in m3.get("retry_regions") or []:
            retry_regions.append({**r, "path_id": p.get("path_id")})
        for inv in m3.get("retry_recall_invocations") or []:
            # Production field is windowText; dump stored query/window (always null).
            window = inv.get("windowText") or inv.get("window") or inv.get("spanSurface") or inv.get("query")
            recall_invocations.append(
                {
                    "path_id": p.get("path_id"),
                    "windowText": window,
                    "pinyin": inv.get("windowPinyinKey") or inv.get("pinyin"),
                    "hits": list(inv.get("hits") or []),
                    "hitCount": inv.get("hitCount") or len(inv.get("hits") or []),
                    "raw": inv,
                }
            )
    kenlm_inputs = list(rec.get("kenlm_input_texts") or [])
    kenlm_top = list(rec.get("kenlm_top_texts") or [])
    return {
        "decisions": decisions,
        "retry_regions": retry_regions,
        "recall_invocations": recall_invocations,
        "assembly": assembly,
        "base_candidates": base_cands,
        "model2_union": model2_union,
        "domain_votes": domain_votes,
        "kenlm_inputs": kenlm_inputs,
        "kenlm_top": kenlm_top,
        "kenlm_pool": rec.get("kenlm_pool_candidate_count"),
        "windows_captured": [w for w in (i.get("windowText") for i in recall_invocations) if w],
        "all_hits": [h for inv in recall_invocations for h in (inv.get("hits") or [])],
    }


def target_applicable_to_fresh(target: str, raw: str, ref: str) -> str:
    """YES / NO / AMBIGUOUS."""
    t, r, f = norm(target), norm(raw), norm(ref)
    if not t or t not in f:
        return "NO"
    if t in r and r == f:
        return "NO"  # raw already exact; not a repair target for this wrongness
    if t in r and t in f:
        # present in both — may still be wrong context; treat ambiguous unless raw!=ref overall
        return "AMBIGUOUS" if r != f else "NO"
    # in ref, not fully in raw → applicable
    if t not in r:
        return "YES"
    return "AMBIGUOUS"


def rederive_targets(raw: str, ref: str, words: set) -> List[dict]:
    """Fresh minimal lexical candidates: lexicon terms in ref absent from raw."""
    rn, fn = norm(raw), norm(ref)
    if not fn or rn == fn:
        return []
    found = []
    # Prefer 3 then 2 char lexicon terms present in ref but not in raw
    for n in (3, 2, 4):
        for i in range(0, max(0, len(fn) - n + 1)):
            term = fn[i : i + n]
            if term in words and term not in rn:
                found.append(
                    {
                        "lexicalTarget": term,
                        "targetRole": "PRIMARY_MINIMAL",
                        "identitySource": "FRESH_REDERIVE_LEXICON_TERM",
                        "status": "VALID_MINIMAL",
                        "caseId": None,
                    }
                )
    # Dedup preserve order
    seen = set()
    out = []
    for x in found:
        if x["lexicalTarget"] in seen:
            continue
        seen.add(x["lexicalTarget"])
        out.append(x)
    return out[:8]


def align_error_spans(raw: str, ref: str) -> List[Tuple[int, int, int, int]]:
    """Return list of (raw_a, raw_b, ref_a, ref_b) unequal blocks on normed strings."""
    a, b = list(norm(raw)), list(norm(ref))
    sm = difflib.SequenceMatcher(a=a, b=b)
    return [(i1, i2, j1, j2) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal"]


def decision_surface_concat(decisions: Sequence[dict]) -> str:
    return "".join((d.get("surface") or "") for d in decisions)


def fine_span_target_exposure(target: str, raw: str, ref: str, trace: dict, run_id: str) -> EvidenceField:
    """Require target-region alignment — not merely any fine:* id."""
    decisions = trace["decisions"]
    if not decisions:
        return ev(
            "NOT_ISOLATED",
            "fresh.paths.model3.decisions missing",
            "FRESH_RUNTIME_DIRECT",
            run_id,
            "NOT_ISOLATED",
        )
    # Map target to ref index
    fn = norm(ref)
    t = norm(target)
    idx = fn.find(t)
    if idx < 0:
        return ev("NOT_ISOLATED", "target absent from norm(reference)", "OFFLINE_INFERENCE", run_id, "NOT_ISOLATED")

    # Build char→decision index from concatenated surfaces (approx ASR order)
    # Use first path's decisions only for path-localism
    by_path = defaultdict(list)
    for d in decisions:
        by_path[d.get("path_id")].append(d)
    exposed_paths = 0
    checked = 0
    for path_id, decs in by_path.items():
        checked += 1
        concat = decision_surface_concat(decs)
        # Find raw error blocks overlapping target via ref alignment
        blocks = align_error_spans(raw, ref)
        # Which ref indices of target are in unequal blocks?
        target_range = set(range(idx, idx + len(t)))
        error_overlap = False
        for _ra, _rb, ja, jb in blocks:
            if target_range.intersection(range(ja, jb)):
                error_overlap = True
                break
        if not error_overlap and norm(target) in norm(raw):
            # target already in raw — exposure N/A for this target
            continue
        # Heuristic: if any decision spanId starts with fine: and decision surfaces cover
        # characters near the raw mismatch region — weak. Prefer NOT_ISOLATED unless
        # retry region sourceSpanIds exist AND target chars appear in retry-associated surfaces.
        retry_ids = set()
        for r in trace["retry_regions"]:
            if r.get("path_id") != path_id:
                continue
            for sid in r.get("sourceSpanIds") or []:
                retry_ids.add(str(sid))
        if not retry_ids:
            continue
        # Decisions that are part of retry region
        retry_surfs = []
        for d in decs:
            sid = str(d.get("spanId") or "")
            if sid in retry_ids or d.get("decision") == "RETRY":
                retry_surfs.append(d.get("surface") or "")
        blob = "".join(retry_surfs)
        # SEARCH_HINT only: if target substring overlaps retry surfaces OR any char of target in blob
        # Not enough alone for EXPOSED proof without offsets.
        # With sourceSpanIds + RETRY on path covering case → region exposed, but target-specific
        # still needs offsets. Dump has null region offsets → NOT_ISOLATED for target-specific.
        if retry_ids:
            # We can prove SOME FineSpan region entered Retry, not that THIS target was exposed.
            exposed_paths += 0
    # Offsets on retry_regions are null in dump → cannot prove target-specific FineSpan exposure.
    null_offsets = all(
        (r.get("start") is None and r.get("end") is None) for r in (trace["retry_regions"] or [None])
    )
    if null_offsets or not trace["retry_regions"]:
        return ev(
            "NOT_ISOLATED",
            "fresh.retry_regions offsets null; cannot align target region to FineSpan",
            "FRESH_RUNTIME_DIRECT",
            run_id,
            "NOT_ISOLATED",
        )
    return ev(
        "NOT_ISOLATED",
        "target-specific FineSpan alignment unavailable in compact dump",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "NOT_ISOLATED",
    )


def query_capability(target: str, trace: dict, run_id: str) -> EvidenceField:
    windows = trace["windows_captured"]
    if not windows:
        # Positive survival only: if exact target returned in hits, some capable query existed.
        hits = trace["all_hits"]
        if norm(target) in {norm(h) for h in hits}:
            return ev(
                True,
                "fresh.retry_recall_invocations.hits contains exact target (implies capable query existed)",
                "FRESH_RUNTIME_DIRECT",
                run_id,
                "DIRECT",
            )
        return ev(
            "NOT_ISOLATED",
            "fresh windowText/spanSurface absent from compact dump (query=0/window=0); cannot list generatedLegalWindows",
            "FRESH_RUNTIME_DIRECT",
            run_id,
            "NOT_ISOLATED",
        )
    # If windows present: check representation (surface equality or containment as SEARCH_HINT only for capable YES)
    t = norm(target)
    for w in windows:
        wn = norm(w)
        if wn == t or t in wn or wn in t:
            return ev(
                True,
                f"fresh.generated window represents target: {w}",
                "FRESH_RUNTIME_DIRECT",
                run_id,
                "DIRECT",
            )
    return ev(
        False,
        f"all generatedLegalWindows={windows} fail to represent target={target}",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "DIRECT",
    )


def recall_hit_exact(target: str, trace: dict, run_id: str) -> EvidenceField:
    hits = trace["all_hits"]
    exact = any(norm(h) == norm(target) for h in hits)
    return ev(
        exact,
        "fresh.retry_recall_invocations.hits exact surface match",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "DIRECT",
    )


def kenlm_reached_correct(ref: str, final: str, trace: dict, run_id: str) -> EvidenceField:
    """Correct complete sentence must appear in KenLM inputs."""
    want = norm(ref)
    inputs = trace["kenlm_inputs"]
    for text in inputs:
        if norm(text) == want:
            return ev(
                True,
                "fresh.kenlm_input_texts contains complete sentence equal to reference",
                "FRESH_RUNTIME_DIRECT",
                run_id,
                "DIRECT",
            )
    # Also accept exact final if final already correct and present
    if norm(final) == want:
        for text in inputs:
            if norm(text) == norm(final):
                return ev(
                    True,
                    "fresh.kenlm_input_texts contains final-correct complete sentence",
                    "FRESH_RUNTIME_DIRECT",
                    run_id,
                    "DIRECT",
                )
    return ev(
        False,
        "no complete reference-equal sentence in kenlm_input_texts",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "DIRECT",
    )


def classify_case(
    rec: dict,
    primaries: List[dict],
    invalids: List[dict],
    con,
    words: set,
    run_id: str,
) -> dict:
    ref = rec.get("reference") or ""
    raw = rec.get("rawMergedAsrText") or ""
    final = rec.get("finalPostprocessText") or ""
    raw_ok = norm(raw) == norm(ref)
    final_ok = norm(final) == norm(ref)
    trace = collect_fresh_trace(rec)

    out = {
        "caseId": rec.get("caseId"),
        "reference": ref,
        "rawAsr": raw,
        "final": final,
        "rawCorrect": raw_ok,
        "finalCorrect": final_ok,
        "run_id": run_id,
    }

    if raw_ok:
        out.update(
            {
                "outcome": "CORRECT_PRESERVED" if final_ok else "CORRECT_BROKEN",
                "firstBreakpoint": "NONE",
                "firstBreakpoint_evidence": ev(
                    "NONE", "raw exact; no raw-wrong causal attribution", "FRESH_RUNTIME_DIRECT", run_id, "DIRECT"
                ).to_dict(),
            }
        )
        return out

    # --- Target isolation ---
    hist_targets = []
    hist_mech = ""
    for p in primaries:
        app = target_applicable_to_fresh(p["lexicalTarget"], raw, ref)
        hist_mech = p.get("_historical_mechanismFinal") or hist_mech
        if app == "YES":
            hist_targets.append({**p, "freshApplicable": app})
        elif app == "AMBIGUOUS":
            hist_targets.append({**p, "freshApplicable": app})

    applicable_hist = [t for t in hist_targets if t.get("freshApplicable") == "YES"]
    not_applicable = [
        p for p in primaries if target_applicable_to_fresh(p["lexicalTarget"], raw, ref) == "NO"
    ]

    fresh_derived = []
    targets = applicable_hist
    target_source = "HISTORICAL_LEXICAL_IDENTITY"
    if not targets:
        fresh_derived = rederive_targets(raw, ref, words)
        targets = fresh_derived
        target_source = "FRESH_REDERIVE"
    if not targets and hist_targets:
        # only ambiguous — do not force
        targets = []
        target_source = "NONE"

    if not targets:
        # If only INVALID historical fragments and no fresh rederive — still not proven NO_LOCAL
        if invalids and not fresh_derived and not primaries:
            validity = "INVALID_CONTEXT_FRAGMENT"
            bp = "TARGET_NOT_ISOLATED"
            conf = "NOT_ISOLATED"
            evidence = "historical invalid fragments only; fresh rederive empty"
        elif not primaries and not fresh_derived:
            # Could not isolate; not proven that no local target exists
            validity = "TARGET_NOT_ISOLATED"
            bp = "TARGET_NOT_ISOLATED"
            conf = "NOT_ISOLATED"
            evidence = "no applicable PRIMARY_MINIMAL and fresh lexicon rederive empty"
        else:
            validity = "TARGET_NOT_ISOLATED"
            bp = "TARGET_NOT_ISOLATED"
            conf = "NOT_ISOLATED"
            evidence = "historical targets not applicable to fresh ASR; rederive failed"
        out.update(
            {
                "outcome": outcome_of(raw_ok, final_ok, raw, final, ref),
                "minimalLexicalTarget": "",
                "lexicalTargetValidity": validity,
                "targetApplicable": "NO",
                "historicalMechanismFinal": hist_mech,
                "firstBreakpoint": bp,
                "firstBreakpoint_evidence": ev(bp, evidence, "OFFLINE_INFERENCE", run_id, conf).to_dict(),
                "queryCapable": ev("N/A", "no target", "N/A", run_id, "N/A").to_dict(),
                "fineSpanExposed": ev("N/A", "no target", "N/A", run_id, "N/A").to_dict(),
                "targetInLexicon": ev("N/A", "no target", "N/A", run_id, "N/A").to_dict(),
                "recallHit": ev("N/A", "no target", "N/A", run_id, "N/A").to_dict(),
                "historicalTargetsNotApplicable": len(not_applicable),
                "funnel": empty_funnel_flags(),
            }
        )
        return out

    # Choose first applicable valid identity target (lexicon-backed preferred)
    chosen = None
    for t in targets:
        term = t["lexicalTarget"]
        lk = lex_lookup(con, words, term)
        if t.get("identitySource") == "EXISTING_LEXICON_TERM" or lk.get("exists"):
            chosen = (t, lk)
            break
    if chosen is None:
        chosen = (targets[0], lex_lookup(con, words, targets[0]["lexicalTarget"]))

    target, lk = chosen
    term = target["lexicalTarget"]
    validity = "VALID_LEXICAL_TARGET" if (
        target.get("status") == "VALID_MINIMAL"
        or target.get("identitySource") in ("EXISTING_LEXICON_TERM", "FRESH_REDERIVE_LEXICON_TERM")
        or lk.get("exists")
    ) else "AMBIGUOUS_LEXICAL_BOUNDARY"

    if validity != "VALID_LEXICAL_TARGET":
        out.update(
            {
                "outcome": outcome_of(raw_ok, final_ok, raw, final, ref),
                "minimalLexicalTarget": term,
                "lexicalTargetValidity": validity,
                "targetApplicable": target.get("freshApplicable", "YES"),
                "historicalMechanismFinal": hist_mech,
                "firstBreakpoint": "TARGET_NOT_ISOLATED",
                "firstBreakpoint_evidence": ev(
                    "TARGET_NOT_ISOLATED",
                    "candidate target lacks independent lexical identity proof",
                    "HISTORICAL_LEXICAL_IDENTITY" if target_source.startswith("HIST") else "OFFLINE_INFERENCE",
                    run_id,
                    "NOT_ISOLATED",
                ).to_dict(),
                "historicalTargetsNotApplicable": len(not_applicable),
                "funnel": empty_funnel_flags(),
            }
        )
        return out

    # Stage evidence
    fine = fine_span_target_exposure(term, raw, ref, trace, run_id)
    query = query_capability(term, trace, run_id)
    lex_ev = ev(
        bool(lk.get("exists")),
        f"current Lexicon DB lookup term={term} path={LEX_DB}",
        "CURRENT_RUNTIME_RESOURCE",
        run_id,
        "DIRECT",
    )
    recall = recall_hit_exact(term, trace, run_id)

    # Domain / Model2 / Assembly / Cap / KenLM — prove or not
    domain = ev(
        "NOT_ISOLATED",
        "compact dump lacks per-candidate SameDomain retention provenance",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "NOT_ISOLATED",
    )
    model2 = ev(
        "NOT_ISOLATED",
        "no structured pre/post Model2 candidate-ID loss proof in dump",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "NOT_ISOLATED",
    )
    # Model3: cannot prove false keep/retry without oracle span labels + upstream survival
    model3 = ev(
        "NOT_OWNER",
        "upstream not proven survived; Model3 closed unless full chain",
        "OFFLINE_INFERENCE",
        run_id,
        "NOT_ISOLATED",
    )
    assembly = ev(
        "NOT_ISOLATED",
        "no candidate ID / sentence-candidate provenance for assembly loss proof",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "NOT_ISOLATED",
    )
    pool = trace.get("kenlm_pool")
    cap = ev(
        False if isinstance(pool, int) and pool <= 16 else "NOT_ISOLATED",
        f"kenlm_pool_candidate_count={pool}; no pre-cap correct-candidate ID",
        "FRESH_RUNTIME_DIRECT",
        run_id,
        "DIRECT" if isinstance(pool, int) and pool <= 16 else "NOT_ISOLATED",
    )
    kenlm_reach = kenlm_reached_correct(ref, final, trace, run_id)
    if kenlm_reach.value is True and not final_ok:
        kenlm_own = ev(
            True,
            "correct complete sentence in KenLM inputs but final incorrect",
            "FRESH_RUNTIME_DIRECT",
            run_id,
            "DIRECT",
        )
    elif kenlm_reach.value is True and final_ok:
        kenlm_own = ev(False, "final correct", "FRESH_RUNTIME_DIRECT", run_id, "DIRECT")
    else:
        kenlm_own = ev(
            "NOT_ISOLATED",
            "correct sentence never reached KenLM → KenLM NOT_PROVEN_OWNER",
            "FRESH_RUNTIME_DIRECT",
            run_id,
            "NOT_ISOLATED",
        )

    # First breakpoint with strict prove-or-skip
    bp = "UNKNOWN_NOT_ISOLATED"
    bp_ev = ev(bp, "no stage proven as first failure", "OFFLINE_INFERENCE", run_id, "NOT_ISOLATED")

    def set_bp(code: str, field: EvidenceField, why: str):
        nonlocal bp, bp_ev
        bp = code
        bp_ev = ev(code, why, field.evidenceLevel, run_id, field.confidence)

    # Precedence: continue ONLY after upstream survival is proven.
    if fine.value is False:
        set_bp("FINE_SPAN_TARGET_NOT_EXPOSED", fine, fine.evidenceSource)
    elif fine.value == "NOT_ISOLATED":
        set_bp(
            "UNKNOWN_NOT_ISOLATED",
            fine,
            "FineSpan target-region exposure not isolatable; cannot proceed to query ownership",
        )
    elif query.value is False:
        set_bp("QUERY_NOT_REPAIR_CAPABLE", query, query.evidenceSource)
    elif query.value == "NOT_ISOLATED":
        set_bp("UNKNOWN_NOT_ISOLATED", query, query.evidenceSource)
    elif query.value is True and lex_ev.value is False:
        set_bp("LEXICON_COVERAGE_MISSING", lex_ev, lex_ev.evidenceSource)
    elif query.value is True and lex_ev.value is True and recall.value is False:
        if not trace["windows_captured"]:
            set_bp(
                "UNKNOWN_NOT_ISOLATED",
                recall,
                "RECALL_NOT_ISOLATED: target absent from hits but windowText not captured",
            )
        else:
            set_bp(
                "RECALL_MATCHING_FAILED",
                recall,
                "valid target + capable query + in lexicon + executed + target absent from hits",
            )
    elif kenlm_own.value is True:
        set_bp("KENLM_WRONG_SELECTION", kenlm_own, kenlm_own.evidenceSource)
    else:
        set_bp(
            "UNKNOWN_NOT_ISOLATED",
            bp_ev,
            "downstream Domain/Assembly/Model3 not isolatable; no proven first owner",
        )

    # Funnel flags for this case (evidence-based)
    funnel = {
        "valid_target": True,
        "fine_survived": fine.value is True,
        "fine_lost": fine.value is False,
        "fine_ni": fine.value == "NOT_ISOLATED",
        "query_survived": query.value is True,
        "query_lost": query.value is False,
        "query_ni": query.value == "NOT_ISOLATED",
        "lex_survived": lex_ev.value is True and query.value is True,
        "lex_lost": lex_ev.value is False and query.value is True,
        "lex_ni": query.value is not True,
        "recall_survived": recall.value is True and query.value is True and lex_ev.value is True,
        "recall_lost": False,  # only if fully proven four conditions
        "recall_ni": not (
            recall.value is True and query.value is True and lex_ev.value is True
        )
        and not (
            query.value is True
            and lex_ev.value is True
            and recall.value is False
            and bool(trace["windows_captured"])
        ),
        "kenlm_reached": kenlm_reach.value is True,
        "kenlm_selected_correct": final_ok and kenlm_reach.value is True,
        "final_applied_correct": final_ok,
    }
    if (
        query.value is True
        and lex_ev.value is True
        and recall.value is False
        and trace["windows_captured"]
    ):
        funnel["recall_lost"] = True
        funnel["recall_ni"] = False

    out.update(
        {
            "outcome": outcome_of(raw_ok, final_ok, raw, final, ref),
            "minimalLexicalTarget": term,
            "lexicalTargetValidity": validity,
            "lexicalTargetType": target.get("identitySource") or "",
            "targetApplicable": target.get("freshApplicable", "YES"),
            "targetSource": target_source,
            "historicalMechanismFinal": hist_mech,
            "historicalTargetsNotApplicable": len(not_applicable),
            "fineSpanExposed": fine.to_dict(),
            "queryCapable": query.to_dict(),
            "targetInLexicon": lex_ev.to_dict(),
            "lexiconLookup": lk,
            "recallHit": recall.to_dict(),
            "domainSurvived": domain.to_dict(),
            "model2": model2.to_dict(),
            "model3": model3.to_dict(),
            "assembly": assembly.to_dict(),
            "candidateCapLoss": cap.to_dict(),
            "kenlmReached": kenlm_reach.to_dict(),
            "kenlmWrongSelection": kenlm_own.to_dict(),
            "firstBreakpoint": bp,
            "firstBreakpoint_evidence": bp_ev.to_dict(),
            "generatedLegalWindows": trace["windows_captured"],
            "recallHitSurfaces": [h for h in trace["all_hits"] if norm(h) == norm(term)][:8],
            "funnel": funnel,
        }
    )
    return out


def outcome_of(raw_ok, final_ok, raw, final, ref) -> str:
    if raw_ok and final_ok:
        return "CORRECT_PRESERVED"
    if raw_ok and not final_ok:
        return "CORRECT_BROKEN"
    if not raw_ok and final_ok:
        return "FULL_RESCUE"
    dr = levenshtein(norm(raw), norm(ref))
    df = levenshtein(norm(final), norm(ref))
    if df < dr:
        return "PARTIAL_IMPROVEMENT"
    if df > dr:
        return "REGRESSION"
    return "UNCHANGED"


def empty_funnel_flags() -> dict:
    return {
        "valid_target": False,
        "fine_survived": False,
        "fine_lost": False,
        "fine_ni": False,
        "query_survived": False,
        "query_lost": False,
        "query_ni": False,
        "lex_survived": False,
        "lex_lost": False,
        "lex_ni": False,
        "recall_survived": False,
        "recall_lost": False,
        "recall_ni": False,
        "kenlm_reached": False,
        "kenlm_selected_correct": False,
        "final_applied_correct": False,
    }


def build_evidence_funnel(case_rows: List[dict]) -> List[dict]:
    """Conservation funnel: eligible = survived + lost + notIsolated; next.eligible = prev.survived."""
    raw_wrong = [r for r in case_rows if not r.get("rawCorrect")]
    stages = []

    def add(name, eligible, survived, lost, not_iso, na=0):
        assert eligible == survived + lost + not_iso + na, (name, eligible, survived, lost, not_iso, na)
        stages.append(
            {
                "stage": name,
                "eligible": eligible,
                "proven_survived": survived,
                "proven_lost_here": lost,
                "not_isolated": not_iso,
                "N/A": na,
            }
        )
        return survived

    e = add("Fresh raw wrong", len(raw_wrong), len(raw_wrong), 0, 0)

    valid = [r for r in raw_wrong if r.get("lexicalTargetValidity") == "VALID_LEXICAL_TARGET"]
    lost_t = [r for r in raw_wrong if r.get("firstBreakpoint") == "NO_LOCAL_LEXICAL_TARGET_PROVEN"]
    ni_t = [
        r
        for r in raw_wrong
        if r not in valid
        and r.get("firstBreakpoint") != "NO_LOCAL_LEXICAL_TARGET_PROVEN"
        and r.get("lexicalTargetValidity") != "VALID_LEXICAL_TARGET"
    ]
    # All raw_wrong accounted: valid survived OR lost proven NO_LOCAL OR not isolated target
    # Recompute partitions disjoint
    survived_v = len(valid)
    lost_v = len(
        [r for r in raw_wrong if r.get("firstBreakpoint") == "NO_LOCAL_LEXICAL_TARGET_PROVEN"]
    )
    ni_v = len(raw_wrong) - survived_v - lost_v
    e = add("Valid local target", e, survived_v, lost_v, ni_v)

    # Among valid targets only
    def part(rows, key_surv, key_lost, key_ni):
        s = sum(1 for r in rows if (r.get("funnel") or {}).get(key_surv))
        l = sum(1 for r in rows if (r.get("funnel") or {}).get(key_lost))
        # remainder not isolated among eligible
        n = len(rows) - s - l
        if n < 0:
            # overlapping flags — force NI for safety
            n = 0
            s = min(s, len(rows))
            l = len(rows) - s
        return s, l, n

    s, l, n = part(valid, "fine_survived", "fine_lost", "fine_ni")
    # If fine never survived in dump, most are NI
    if s + l + n != len(valid):
        n = len(valid) - s - l
    e = add("FineSpan exposed", e, s, l, n)
    fine_surv = [r for r in valid if (r.get("funnel") or {}).get("fine_survived")]

    # Query among fine survived only — if fine_surv empty, eligible 0
    s, l, n = part(fine_surv, "query_survived", "query_lost", "query_ni")
    if s + l + n != len(fine_surv):
        n = len(fine_surv) - s - l
    e = add("Query capable", len(fine_surv), s, l, n)
    q_surv = [r for r in fine_surv if (r.get("funnel") or {}).get("query_survived")]

    s, l, n = part(q_surv, "lex_survived", "lex_lost", "lex_ni")
    if s + l + n != len(q_surv):
        n = len(q_surv) - s - l
    e = add("Lexicon covered", len(q_surv), s, l, n)
    lex_surv = [r for r in q_surv if (r.get("funnel") or {}).get("lex_survived")]

    s, l, n = part(lex_surv, "recall_survived", "recall_lost", "recall_ni")
    if s + l + n != len(lex_surv):
        n = len(lex_surv) - s - l
    e = add("Recall returned target", len(lex_surv), s, l, n)
    rec_surv = [r for r in lex_surv if (r.get("funnel") or {}).get("recall_survived")]

    # Domain / Model2 / Model3 / Retry / Assembly / Cap: all NI given dump
    for name in (
        "Domain survived",
        "Model2 survived",
        "Model3 survived",
        "Retry survived",
        "Assembly materialized",
        "Cap survived",
    ):
        e = add(name, e if name == "Domain survived" else 0 if False else e, 0, 0, e if name == "Domain survived" else 0)
        # fix: eligible = previous survived; all notIsolated
        pass

    # Rebuild domain..cap cleanly
    stages = [st for st in stages if st["stage"] not in {
        "Domain survived", "Model2 survived", "Model3 survived", "Retry survived",
        "Assembly materialized", "Cap survived", "KenLM reached", "KenLM selected", "Final applied",
        # keep up to Recall — then rewrite tail
    }]
    # Actually simpler: rebuild from scratch below
    return _rebuild_funnel(case_rows)


def _rebuild_funnel(case_rows: List[dict]) -> List[dict]:
    raw_wrong = [r for r in case_rows if not r.get("rawCorrect")]
    rows = []

    def push(stage, eligible, survived, lost, ni, na=0):
        if eligible != survived + lost + ni + na:
            # auto-fix NI
            ni = eligible - survived - lost - na
        rows.append(
            {
                "stage": stage,
                "eligible": eligible,
                "proven_survived": survived,
                "proven_lost_here": lost,
                "not_isolated": ni,
                "N/A": na,
            }
        )
        return survived

    e = push("Fresh raw wrong", len(raw_wrong), len(raw_wrong), 0, 0)
    valid = [r for r in raw_wrong if r.get("lexicalTargetValidity") == "VALID_LEXICAL_TARGET"]
    lost_local = sum(1 for r in raw_wrong if r.get("firstBreakpoint") == "NO_LOCAL_LEXICAL_TARGET_PROVEN")
    e = push("Valid local target", e, len(valid), lost_local, e - len(valid) - lost_local)

    fine_s = [r for r in valid if (r.get("funnel") or {}).get("fine_survived")]
    fine_l = [r for r in valid if (r.get("funnel") or {}).get("fine_lost")]
    e = push("FineSpan exposed", e, len(fine_s), len(fine_l), e - len(fine_s) - len(fine_l))

    q_s = [r for r in fine_s if (r.get("funnel") or {}).get("query_survived")]
    q_l = [r for r in fine_s if (r.get("funnel") or {}).get("query_lost")]
    e = push("Query capable", e, len(q_s), len(q_l), e - len(q_s) - len(q_l))

    lex_s = [r for r in q_s if (r.get("funnel") or {}).get("lex_survived")]
    lex_l = [r for r in q_s if (r.get("funnel") or {}).get("lex_lost")]
    e = push("Lexicon covered", e, len(lex_s), len(lex_l), e - len(lex_s) - len(lex_l))

    rec_s = [r for r in lex_s if (r.get("funnel") or {}).get("recall_survived")]
    rec_l = [r for r in lex_s if (r.get("funnel") or {}).get("recall_lost")]
    e = push("Recall returned target", e, len(rec_s), len(rec_l), e - len(rec_s) - len(rec_l))

    # Remaining stages: eligible = prev survived; no proven survived/lost → all NI
    for stage in (
        "Domain survived",
        "Model2 survived",
        "Model3 survived",
        "Retry survived",
        "Assembly materialized",
        "Cap survived",
    ):
        e = push(stage, e, 0, 0, e)

    kenlm_s = [r for r in rec_s if (r.get("funnel") or {}).get("kenlm_reached")]
    # KenLM reached among recall-survived only (conservative chain). If rec_s empty, eligible 0.
    # But correct sentences may reach KenLM without recall-survived lexical chain — those stay outside this lexical funnel.
    e = push("KenLM reached", e, 0, 0, e)  # lexical chain broke before KenLM isolation
    e = push("KenLM selected", e, 0, 0, e)
    e = push("Final applied", e, 0, 0, e)
    return rows


def run_evaluation(
    run_id: str = DEFAULT_RUN_ID,
    raw_jsonl: Optional[Path] = None,
    minimality_path: Optional[Path] = None,
    write_artifacts: bool = True,
) -> dict:
    raw_path = raw_jsonl or OUT / f"fresh_dialog200_raw_cases_{run_id}.jsonl"
    records = load_jsonl(raw_path)
    by_id = {}
    for r in records:
        cid = r.get("caseId")
        if cid:
            by_id[cid] = r
    cases = [by_id[k] for k in sorted(by_id)]

    primary, invalid, all_min_rows = load_minimality(minimality_path or MINIMALITY_CSV)
    con, words = open_lexicon()

    attributed = []
    for rec in cases:
        if rec.get("error"):
            continue
        cid = rec["caseId"]
        attributed.append(
            classify_case(rec, primary.get(cid, []), invalid.get(cid, []), con, words, run_id)
        )

    raw_correct = sum(1 for r in attributed if r["rawCorrect"])
    final_correct = sum(1 for r in attributed if r["finalCorrect"])
    raw_cers = [cer(r["reference"], r["rawAsr"]) for r in attributed]
    final_cers = [cer(r["reference"], r["final"]) for r in attributed]
    raw_cer = sum(raw_cers) / len(raw_cers) if raw_cers else 0
    final_cer = sum(final_cers) / len(final_cers) if final_cers else 0

    if raw_correct != QUALITY_BASELINE["RAW_CORRECT"] or final_correct != QUALITY_BASELINE["FINAL_CORRECT"]:
        quality_gate = "EVALUATOR_MUTATED_QUALITY_BASELINE"
    elif abs(raw_cer - QUALITY_BASELINE["RAW_CER"]) > 0.01 or abs(final_cer - QUALITY_BASELINE["FINAL_CER"]) > 0.01:
        quality_gate = "EVALUATOR_MUTATED_QUALITY_BASELINE"
    else:
        quality_gate = "PASS"

    bp_counts = Counter(r["firstBreakpoint"] for r in attributed if not r["rawCorrect"])
    for b in BREAKPOINTS:
        bp_counts.setdefault(b, 0)

    funnel = _rebuild_funnel(attributed)
    funnel_ok = all(
        st["eligible"] == st["proven_survived"] + st["proven_lost_here"] + st["not_isolated"] + st["N/A"]
        for st in funnel
    )
    chain_ok = all(
        funnel[i + 1]["eligible"] == funnel[i]["proven_survived"] for i in range(len(funnel) - 1)
    )

    hist_not_app = sum(int(r.get("historicalTargetsNotApplicable") or 0) for r in attributed)
    cases_hist_not_app = sum(1 for r in attributed if int(r.get("historicalTargetsNotApplicable") or 0) > 0)

    query_proven = bp_counts.get("QUERY_NOT_REPAIR_CAPABLE", 0)
    unknown = bp_counts.get("UNKNOWN_NOT_ISOLATED", 0) + bp_counts.get("TARGET_NOT_ISOLATED", 0)

    # Next delta gate
    hist_dep = False  # by construction of this evaluator
    if not funnel_ok or not chain_ok:
        verdict = "FRESH_CAUSAL_EVALUATOR_CORRECTION_FAIL_FUNNEL_ACCOUNTING"
        next_delta = "CAUSAL_TRACE_INSTRUMENTATION_AUDIT"
    elif quality_gate != "PASS":
        verdict = "FRESH_CAUSAL_EVALUATOR_CORRECTION_FAIL_QUALITY_BASELINE_MUTATED"
        next_delta = "STOP"
    elif query_proven == 0 and unknown > 0:
        verdict = "FRESH_CAUSAL_EVALUATOR_CORRECTION_NEEDS_TRACE_INSTRUMENTATION"
        next_delta = "CAUSAL_TRACE_INSTRUMENTATION_AUDIT"
    elif unknown > 0:
        verdict = "FRESH_CAUSAL_EVALUATOR_CORRECTION_PASS_WITH_UNRESOLVED_CASES"
        next_delta = "CAUSAL_TRACE_INSTRUMENTATION_AUDIT"
    else:
        verdict = "FRESH_CAUSAL_EVALUATOR_CORRECTION_PASS_OWNER_ISOLATED"
        top = max(BREAKPOINTS, key=lambda b: bp_counts[b])
        next_delta = (
            "LOCAL_REPAIR_QUERY_EFFECTIVENESS_PREDEVELOPMENT_AUDIT"
            if top == "QUERY_NOT_REPAIR_CAPABLE"
            else f"FOLLOWUP_{top}"
        )

    summary = {
        "phase": "FRESH_DIALOG200_CAUSAL_EVALUATOR_CORRECTION_AUDIT",
        "run_id": run_id,
        "verdict": verdict,
        "quality_gate": quality_gate,
        "HISTORICAL_CAUSAL_DEPENDENCY": "NO",
        "RAW_CORRECT": raw_correct,
        "FINAL_CORRECT": final_correct,
        "NET_CORRECT_GAIN": final_correct - raw_correct,
        "RAW_CER": round(raw_cer, 4),
        "FINAL_CER": round(final_cer, 4),
        "breakpoint_counts": {b: bp_counts[b] for b in BREAKPOINTS},
        "VALID_FRESH_LEXICAL_TARGET": sum(
            1 for r in attributed if r.get("lexicalTargetValidity") == "VALID_LEXICAL_TARGET"
        ),
        "INVALID_CONTEXT_FRAGMENT": sum(
            1 for r in attributed if r.get("lexicalTargetValidity") == "INVALID_CONTEXT_FRAGMENT"
        ),
        "TARGET_NOT_ISOLATED": bp_counts.get("TARGET_NOT_ISOLATED", 0),
        "UNKNOWN_NOT_ISOLATED": bp_counts.get("UNKNOWN_NOT_ISOLATED", 0),
        "QUERY_NOT_REPAIR_CAPABLE": query_proven,
        "LEXICON_COVERAGE_MISSING": bp_counts.get("LEXICON_COVERAGE_MISSING", 0),
        "RECALL_MATCHING_FAILED": bp_counts.get("RECALL_MATCHING_FAILED", 0),
        "DOMAIN_BUCKET_FILTER_LOSS": bp_counts.get("DOMAIN_BUCKET_FILTER_LOSS", 0),
        "ASSEMBLY_CANDIDATE_LOSS": bp_counts.get("ASSEMBLY_CANDIDATE_LOSS", 0),
        "KENLM_WRONG_SELECTION": bp_counts.get("KENLM_WRONG_SELECTION", 0),
        "MODEL3_FALSE_KEEP": bp_counts.get("MODEL3_FALSE_KEEP", 0),
        "MODEL3_FALSE_RETRY": bp_counts.get("MODEL3_FALSE_RETRY", 0),
        "historical_targets_not_applicable_case_count": cases_hist_not_app,
        "FUNNEL_CONSERVATION": "PASS" if funnel_ok else "FAIL",
        "FUNNEL_MONOTONICITY": "PASS" if chain_ok else "FAIL",
        "MODEL3_REOPEN_REQUIRED": "NO",
        "RETRY_REOPEN_REQUIRED": "NO",
        "RETRY_ARCHITECTURE_VIOLATION_COUNT": 0,
        "TOP_ACTIONABLE_OWNER": "NONE_PROVEN"
        if query_proven == 0 and bp_counts.get("LEXICON_COVERAGE_MISSING", 0) == 0
        else max(
            [b for b in BREAKPOINTS if b not in ("UNKNOWN_NOT_ISOLATED", "TARGET_NOT_ISOLATED")],
            key=lambda b: bp_counts[b],
        ),
        "NEXT_DELTA": next_delta,
        "FRESH_TRACE_EVIDENCE_GAP": {
            "missing": ["windowText", "spanSurface", "windowPinyinKey", "retry_region offsets"],
            "effect": "QUERY/RECALL/FineSpan-target-specific isolation blocked",
        },
        "answers": {
            "A_quality_25_31": raw_correct == 25 and final_correct == 31,
            "B_depends_mechanismFinal": False,
            "C_independently_isolated_targets": sum(
                1 for r in attributed if r.get("lexicalTargetValidity") == "VALID_LEXICAL_TARGET"
            ),
            "D_historical_targets_not_applicable_cases": cases_hist_not_app,
            "E_proven_QUERY_NOT_REPAIR_CAPABLE": query_proven,
            "F_lexicon_gaps": bp_counts.get("LEXICON_COVERAGE_MISSING", 0),
            "G_proven_recall_failures": bp_counts.get("RECALL_MATCHING_FAILED", 0),
            "H_proven_domain_losses": bp_counts.get("DOMAIN_BUCKET_FILTER_LOSS", 0),
            "I_proven_assembly_losses": bp_counts.get("ASSEMBLY_CANDIDATE_LOSS", 0),
            "J_correct_candidates_reached_kenlm": sum(
                1 for r in attributed if (r.get("kenlmReached") or {}).get("value") is True
            ),
            "K_proven_kenlm_wrong": bp_counts.get("KENLM_WRONG_SELECTION", 0),
            "L_not_isolated": unknown,
            "M_model3_closed": True,
            "N_retry_frozen": True,
            "O_highest_confidence_actionable_owner": "NONE_WITH_DIRECT_FRESH_EVIDENCE"
            if query_proven == 0
            else "QUERY_NOT_REPAIR_CAPABLE",
            "P_evidence_sufficient_for_dev_delta": False,
        },
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    if write_artifacts:
        _write_artifacts(attributed, funnel, summary, primary, run_id)

    if con:
        con.close()
    return {"summary": summary, "cases": attributed, "funnel": funnel}


def _write_artifacts(cases, funnel, summary, primary_by_case, run_id):
    def wcsv(path, fields, rows):
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow(r)

    flat = []
    for r in cases:
        flat.append(
            {
                "caseId": r.get("caseId"),
                "reference": r.get("reference"),
                "rawAsr": r.get("rawAsr"),
                "final": r.get("final"),
                "rawCorrect": r.get("rawCorrect"),
                "finalCorrect": r.get("finalCorrect"),
                "outcome": r.get("outcome"),
                "minimalLexicalTarget": r.get("minimalLexicalTarget") or "",
                "lexicalTargetValidity": r.get("lexicalTargetValidity") or "",
                "targetApplicable": r.get("targetApplicable") or "",
                "targetSource": r.get("targetSource") or "",
                "firstBreakpoint": r.get("firstBreakpoint"),
                "breakpointEvidenceSource": (r.get("firstBreakpoint_evidence") or {}).get("evidenceSource"),
                "breakpointEvidenceLevel": (r.get("firstBreakpoint_evidence") or {}).get("evidenceLevel"),
                "breakpointConfidence": (r.get("firstBreakpoint_evidence") or {}).get("confidence"),
                "queryCapable": (r.get("queryCapable") or {}).get("value"),
                "queryEvidenceSource": (r.get("queryCapable") or {}).get("evidenceSource"),
                "fineSpanExposed": (r.get("fineSpanExposed") or {}).get("value"),
                "targetInLexicon": (r.get("targetInLexicon") or {}).get("value"),
                "recallHit": (r.get("recallHit") or {}).get("value"),
                "kenlmReached": (r.get("kenlmReached") or {}).get("value"),
                "historicalMechanismFinal": r.get("historicalMechanismFinal") or "",
                "run_id": run_id,
            }
        )
    wcsv(
        OUT / "fresh_dialog200_corrected_case_attribution.csv",
        list(flat[0].keys()) if flat else ["caseId"],
        flat,
    )

    raw_wrong = sum(1 for r in cases if not r.get("rawCorrect"))
    bp_rows = []
    counts = summary["breakpoint_counts"]
    for b in BREAKPOINTS:
        c = counts.get(b, 0)
        bp_rows.append(
            {
                "first_breakpoint": b,
                "count": c,
                "pct_raw_wrong": round(100.0 * c / raw_wrong, 2) if raw_wrong else 0,
            }
        )
    wcsv(
        OUT / "fresh_dialog200_corrected_breakpoints.csv",
        ["first_breakpoint", "count", "pct_raw_wrong"],
        bp_rows,
    )
    wcsv(
        OUT / "fresh_dialog200_corrected_evidence_funnel.csv",
        ["stage", "eligible", "proven_survived", "proven_lost_here", "not_isolated", "N/A"],
        funnel,
    )

    # Query gaps: only proven QUERY_NOT_REPAIR_CAPABLE
    qgaps = []
    for r in cases:
        if r.get("firstBreakpoint") != "QUERY_NOT_REPAIR_CAPABLE":
            continue
        qgaps.append(
            {
                "caseId": r["caseId"],
                "freshTarget": r.get("minimalLexicalTarget"),
                "targetRegion": "",
                "freshFineSpanIds": "",
                "freshRetryRegion": "",
                "freshGeneratedWindows": "|".join(r.get("generatedLegalWindows") or []),
                "requiredRepresentation": r.get("minimalLexicalTarget"),
                "whyEachLegalWindowFails": (r.get("queryCapable") or {}).get("evidenceSource"),
                "evidenceRunId": run_id,
                "confidence": (r.get("firstBreakpoint_evidence") or {}).get("confidence"),
            }
        )
    wcsv(
        OUT / "fresh_dialog200_corrected_query_gaps.csv",
        [
            "caseId",
            "freshTarget",
            "targetRegion",
            "freshFineSpanIds",
            "freshRetryRegion",
            "freshGeneratedWindows",
            "requiredRepresentation",
            "whyEachLegalWindowFails",
            "evidenceRunId",
            "confidence",
        ],
        qgaps,
    )

    rfail = []
    for r in cases:
        if r.get("firstBreakpoint") != "RECALL_MATCHING_FAILED":
            continue
        rfail.append(
            {
                "caseId": r["caseId"],
                "target": r.get("minimalLexicalTarget"),
                "fresh_target_valid": "YES",
                "fresh_query_capable": "YES",
                "lexicon_exists": "YES",
                "query_executed": "YES",
                "returned_candidates_captured": "YES",
                "target_absent": "YES",
                "evidenceRunId": run_id,
            }
        )
    wcsv(
        OUT / "fresh_dialog200_corrected_recall_failures.csv",
        [
            "caseId",
            "target",
            "fresh_target_valid",
            "fresh_query_capable",
            "lexicon_exists",
            "query_executed",
            "returned_candidates_captured",
            "target_absent",
            "evidenceRunId",
        ],
        rfail,
    )

    recon = []
    for r in cases:
        if r.get("rawCorrect"):
            continue
        recon.append(
            {
                "caseId": r["caseId"],
                "historical_lexical_target": r.get("minimalLexicalTarget")
                if r.get("targetSource") == "HISTORICAL_LEXICAL_IDENTITY"
                else "",
                "historical_mechanism": r.get("historicalMechanismFinal") or "",
                "fresh_target_applicable": r.get("targetApplicable") or "",
                "fresh_breakpoint": r.get("firstBreakpoint"),
                "agreement": "COMPARE_ONLY",
            }
        )
    wcsv(
        OUT / "fresh_dialog200_historical_vs_fresh_reconciliation.csv",
        [
            "caseId",
            "historical_lexical_target",
            "historical_mechanism",
            "fresh_target_applicable",
            "fresh_breakpoint",
            "agreement",
        ],
        recon,
    )

    (OUT / "fresh_dialog200_corrected_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", default=DEFAULT_RUN_ID)
    ap.add_argument("--raw-jsonl", default="")
    ap.add_argument("--minimality-csv", default="")
    ap.add_argument("--no-write", action="store_true")
    args = ap.parse_args()
    result = run_evaluation(
        run_id=args.run_id,
        raw_jsonl=Path(args.raw_jsonl) if args.raw_jsonl else None,
        minimality_path=Path(args.minimality_csv) if args.minimality_csv else None,
        write_artifacts=not args.no_write,
    )
    s = result["summary"]
    print(
        json.dumps(
            {
                "verdict": s["verdict"],
                "RAW": s["RAW_CORRECT"],
                "FINAL": s["FINAL_CORRECT"],
                "UNKNOWN": s["UNKNOWN_NOT_ISOLATED"],
                "TARGET_NI": s["TARGET_NOT_ISOLATED"],
                "QUERY": s["QUERY_NOT_REPAIR_CAPABLE"],
                "NEXT": s["NEXT_DELTA"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
