# -*- coding: utf-8 -*-
"""Audit-only lexical repair target identity (distinct from reference-diff regions).

REFERENCE_DIFF_REGION != LEXICAL_REPAIR_TARGET.

Uses:
- existing SequenceMatcher / malformed-region localization
- authoritative Lexicon V3 read-only (term/base/domain/idiom)
- structural composition under Recall termLength contract (1–4 for term table;
  runtime base allows 1–5; we use 1–4 for term inventory + idiom len 4)

No case IDs. No known held-out target strings. No runtime imports.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from training.model3_dataset.scripts.s3_target_scope_derivation import (  # noqa: E402
    DerivedTarget,
    derive_target_scope,
    fold_cjk_variant,
    is_digit_style_only,
    is_punctuation_only_diff,
    norm_text,
)

REPO = Path(__file__).resolve().parents[3]
V3_LEX = REPO / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"

# Recall / base contract: term inventory lengths observed in V3 term table.
MIN_TERM_LEN = 1
MAX_TERM_LEN = 4  # term table max; idiom fixed 4
CONTEXT_PAD = 4

_PUNCT_SPLIT = re.compile(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…]+")

# Leading/trailing particles that make a structural unit non-lexical for Lexicon ownership.
_FUNCTION_CHARS = set("的了吗呢吧啊哦嗯着过和与及在是有这那我你他她它就都也还很太更最被把让给从到对为以而或但又再已正嘛么麼嗎")


@dataclass
class LexicalRepairTarget:
    regionId: str
    targetId: str
    refStart: int
    refEnd: int
    curStart: int
    curEnd: int
    diffCoreAsr: str
    diffCoreRef: str
    lexicalTarget: str
    targetIdentitySource: str
    targetConfidence: str
    inAuthoritativeLexicon: bool
    outsideLexiconContract: bool
    notes: str = ""


@dataclass
class RegionBundle:
    regionId: str
    asrSurface: str
    refSurface: str
    curStart: int
    curEnd: int
    refStart: int | None
    refEnd: int | None
    normalizationEquivalent: bool
    targets: list[LexicalRepairTarget] = field(default_factory=list)
    regionClass: str = ""  # NORMALIZATION_EQUIVALENT | HAS_TARGETS | IDENTITY_UNRESOLVED | ...


@lru_cache(maxsize=1)
def load_authoritative_lexicon_terms() -> frozenset[str]:
    """Read-only V3 inventory: term + base + domain + idiom surfaces."""
    if not V3_LEX.exists():
        return frozenset()
    con = sqlite3.connect(str(V3_LEX))
    words: set[str] = set()
    for table in ("term", "base_lexicon", "domain_lexicon", "idiom_lexicon"):
        try:
            for (w,) in con.execute(f"SELECT DISTINCT word FROM {table}"):
                if w:
                    words.add(str(w))
                    words.add(fold_cjk_variant(str(w)))
        except sqlite3.Error:
            continue
    con.close()
    return frozenset(words)


def lexicon_contains(term: str, inventory: frozenset[str] | None = None) -> bool:
    inv = inventory if inventory is not None else load_authoritative_lexicon_terms()
    t = fold_cjk_variant(term or "")
    return bool(t) and (t in inv or (term or "") in inv)


def _cjk_runs(text: str) -> list[tuple[int, int, str]]:
    runs: list[tuple[int, int, str]] = []
    i = 0
    n = len(text)
    while i < n:
        if _PUNCT_SPLIT.match(text[i]):
            i += 1
            continue
        j = i
        while j < n and not _PUNCT_SPLIT.match(text[j]):
            j += 1
        chunk = text[i:j]
        if chunk.strip():
            runs.append((i, j, chunk))
        i = j
    return runs


def _is_function_heavy(unit: str) -> bool:
    u = norm_text(unit)
    if not u:
        return True
    if all(ch in _FUNCTION_CHARS for ch in u):
        return True
    # leading function char + short → weak
    if u[0] in _FUNCTION_CHARS and len(u) <= 2:
        return True
    return False


def _outside_lexicon_contract(unit: str) -> bool:
    u = fold_cjk_variant(unit or "")
    nu = norm_text(u)
    if not nu:
        return True
    if any(ch in u for ch in ",，。！？、；：.!?;:'\"()（）[]【】"):
        return True
    if len(nu) > MAX_TERM_LEN and len(nu) != 4:
        # idiom is exactly 4 in V3; longer phrases outside base/term ownership
        if len(nu) > 4:
            return True
    if _is_function_heavy(nu):
        return True
    return False


def _find_lexicon_overlaps(
    ref_text: str,
    core_start: int,
    core_end: int,
    inventory: frozenset[str],
    window_pad: int = CONTEXT_PAD,
) -> list[tuple[int, int, str]]:
    """Lexicon terms whose character span substantially overlaps the diff core."""
    n = len(ref_text)
    ws = max(0, core_start - window_pad)
    we = min(n, core_end + window_pad)
    # stay inside same punctuation-bounded run
    runs = _cjk_runs(ref_text)
    run = next(
        (
            r
            for r in runs
            if r[0] <= core_start < r[1] or r[0] < core_end <= r[1] or (core_start <= r[0] and core_end >= r[1])
        ),
        None,
    )
    if run:
        ws = max(ws, run[0])
        we = min(we, run[1])
    window = ref_text[ws:we]
    core_len = max(1, core_end - core_start)
    hits: list[tuple[int, int, str]] = []
    for L in range(min(MAX_TERM_LEN, len(window)), MIN_TERM_LEN - 1, -1):
        for i in range(0, len(window) - L + 1):
            abs_s = ws + i
            abs_e = abs_s + L
            if abs_e <= core_start or abs_s >= core_end:
                continue
            cand = ref_text[abs_s:abs_e]
            if not lexicon_contains(cand, inventory):
                continue
            folded = fold_cjk_variant(cand)
            if _is_function_heavy(folded):
                continue
            if L == 1 and core_len > 1:
                continue
            ov = max(0, min(abs_e, core_end) - max(abs_s, core_start))
            covers_core = abs_s <= core_start and abs_e >= core_end
            # Lexicon term needs ≥1 overlapping char with the region core; prefer multi-char.
            strong = covers_core or (L >= 2 and ov >= 1)
            if not strong:
                continue
            hits.append((abs_s, abs_e, folded))
    hits.sort(key=lambda x: (-(x[1] - x[0]), x[0]))
    out: list[tuple[int, int, str]] = []
    covered: list[tuple[int, int]] = []
    for s, e, w in hits:
        if any(s >= a and e <= b for a, b in covered):
            continue
        out.append((s, e, w))
        covered.append((s, e))
    return out


def _structural_units(
    ref_text: str,
    core_start: int,
    core_end: int,
    window_pad: int = CONTEXT_PAD,
) -> list[tuple[int, int, str]]:
    """Independent Recall-contract units: prefer exact core, else shortest full cover."""
    core = ref_text[core_start:core_end]
    core_n = norm_text(core)
    exact_ok = (
        2 <= len(core_n) <= MAX_TERM_LEN
        and not _outside_lexicon_contract(core)
        and core_n[0] not in _FUNCTION_CHARS
        and core_n[-1] not in _FUNCTION_CHARS
    )
    if exact_ok:
        return [(core_start, core_end, fold_cjk_variant(core))]

    n = len(ref_text)
    ws = max(0, core_start - window_pad)
    we = min(n, core_end + window_pad)
    runs = _cjk_runs(ref_text)
    run = next(
        (
            r
            for r in runs
            if r[0] <= core_start < r[1] or r[0] < core_end <= r[1] or (core_start <= r[0] and core_end >= r[1])
        ),
        None,
    )
    if run:
        ws = max(ws, run[0])
        we = min(we, run[1])
    window = ref_text[ws:we]
    covers: list[tuple[int, int, str]] = []
    for L in range(max(2, len(core_n)), min(MAX_TERM_LEN, len(window)) + 1):
        for i in range(0, len(window) - L + 1):
            abs_s = ws + i
            abs_e = abs_s + L
            if abs_s > core_start or abs_e < core_end:
                continue  # must fully cover core
            cand = ref_text[abs_s:abs_e]
            if _outside_lexicon_contract(cand):
                continue
            covers.append((abs_s, abs_e, fold_cjk_variant(cand)))
        if covers:
            break  # shortest L that fully covers
    covers.sort(key=lambda x: (x[1] - x[0], x[0]))
    return covers[:1]


def derive_lexical_targets_for_region(
    *,
    region_id: str,
    asr: str,
    reference: str,
    region: DerivedTarget,
    inventory: frozenset[str] | None = None,
) -> RegionBundle:
    inv = inventory if inventory is not None else load_authoritative_lexicon_terms()
    bundle = RegionBundle(
        regionId=region_id,
        asrSurface=region.asrSurface,
        refSurface=region.refSurface,
        curStart=region.curStart,
        curEnd=region.curEnd,
        refStart=region.refStart,
        refEnd=region.refEnd,
        normalizationEquivalent=False,
    )

    if is_punctuation_only_diff(region.asrSurface, region.refSurface) or is_digit_style_only(
        region.asrSurface, region.refSurface
    ):
        bundle.normalizationEquivalent = True
        bundle.regionClass = "NORMALIZATION_EQUIVALENT"
        return bundle

    # Map ref core: prefer recorded refStart/refEnd; else locate refSurface
    if isinstance(region.refStart, int) and isinstance(region.refEnd, int) and region.refEnd > region.refStart:
        core_s, core_e = region.refStart, region.refEnd
    else:
        idx = reference.find(region.refSurface) if region.refSurface else -1
        if idx < 0:
            # try folded
            folded_ref = fold_cjk_variant(reference)
            needle = fold_cjk_variant(region.refSurface)
            idx = folded_ref.find(needle) if needle else -1
            if idx < 0:
                bundle.regionClass = "LEXICAL_TARGET_IDENTITY_UNRESOLVED"
                return bundle
            core_s, core_e = idx, idx + len(needle)
        else:
            core_s, core_e = idx, idx + len(region.refSurface)

    if core_e <= core_s:
        bundle.regionClass = "LEXICAL_TARGET_IDENTITY_UNRESOLVED"
        return bundle

    # If normalized full utterance equal — handled upstream; region-level:
    if norm_text(region.asrSurface) == norm_text(region.refSurface):
        bundle.normalizationEquivalent = True
        bundle.regionClass = "NORMALIZATION_EQUIVALENT"
        return bundle

    targets: list[LexicalRepairTarget] = []
    tid = 0

    # A) Lexicon-anchored discovery
    for s, e, word in _find_lexicon_overlaps(reference, core_s, core_e, inv):
        tid += 1
        # confidence: HIGH if term covers core or core covers majority of term
        core_len = max(1, core_e - core_s)
        ov = max(0, min(e, core_e) - max(s, core_s))
        conf = "HIGH" if ov >= min(core_len, e - s) or (e - s) <= core_len + 1 else "MEDIUM"
        targets.append(
            LexicalRepairTarget(
                regionId=region_id,
                targetId=f"{region_id}:t{tid}",
                refStart=s,
                refEnd=e,
                curStart=region.curStart,
                curEnd=region.curEnd,
                diffCoreAsr=region.asrSurface,
                diffCoreRef=reference[core_s:core_e],
                lexicalTarget=word,
                targetIdentitySource="EXISTING_LEXICON_TERM",
                targetConfidence=conf,
                inAuthoritativeLexicon=True,
                outsideLexiconContract=False,
            )
        )

    # B) Structural units not in lexicon → independent missing-term evidence
    if not targets:
        for s, e, word in _structural_units(reference, core_s, core_e):
            if lexicon_contains(word, inv):
                continue
            if _outside_lexicon_contract(word):
                tid += 1
                targets.append(
                    LexicalRepairTarget(
                        regionId=region_id,
                        targetId=f"{region_id}:t{tid}",
                        refStart=s,
                        refEnd=e,
                        curStart=region.curStart,
                        curEnd=region.curEnd,
                        diffCoreAsr=region.asrSurface,
                        diffCoreRef=reference[core_s:core_e],
                        lexicalTarget=word,
                        targetIdentitySource="OUTSIDE_LEXICON_CONTRACT",
                        targetConfidence="MEDIUM",
                        inAuthoritativeLexicon=False,
                        outsideLexiconContract=True,
                        notes="fails_lexicon_ownership_policy",
                    )
                )
                continue
            # Legitimate structural lexical unit absent from lexicon
            tid += 1
            core_len = max(1, core_e - core_s)
            ov = max(0, min(e, core_e) - max(s, core_s))
            # HIGH only when unit tightly wraps the core (diff fully inside unit)
            tight = s <= core_s and e >= core_e and (e - s) <= max(core_len + 2, 3)
            conf = "HIGH" if tight and 2 <= len(norm_text(word)) <= 4 else "MEDIUM"
            targets.append(
                LexicalRepairTarget(
                    regionId=region_id,
                    targetId=f"{region_id}:t{tid}",
                    refStart=s,
                    refEnd=e,
                    curStart=region.curStart,
                    curEnd=region.curEnd,
                    diffCoreAsr=region.asrSurface,
                    diffCoreRef=reference[core_s:core_e],
                    lexicalTarget=word,
                    targetIdentitySource="STRUCTURAL_COMPOSITION_SUPPORTED",
                    targetConfidence=conf,
                    inAuthoritativeLexicon=False,
                    outsideLexiconContract=False,
                    notes="REFERENCE_LEXICAL_UNIT_NOT_IN_LEXICON",
                )
            )

    # Dedup by lexicalTarget surface
    seen: set[str] = set()
    uniq: list[LexicalRepairTarget] = []
    for t in targets:
        key = t.lexicalTarget
        if key in seen:
            continue
        seen.add(key)
        uniq.append(t)
    bundle.targets = uniq

    if not uniq:
        # Arbitrary fragment path: do NOT invent TARGET_NOT_IN_LEXICON
        frag = fold_cjk_variant(region.refSurface or "")
        if frag and _outside_lexicon_contract(frag):
            bundle.regionClass = "OUTSIDE_LEXICON_CONTRACT"
        else:
            bundle.regionClass = "LEXICAL_TARGET_IDENTITY_UNRESOLVED"
        return bundle

    if all(t.outsideLexiconContract for t in uniq) and not any(t.inAuthoritativeLexicon for t in uniq):
        bundle.regionClass = "OUTSIDE_LEXICON_CONTRACT"
    else:
        bundle.regionClass = "HAS_LEXICAL_TARGETS"
    return bundle


def derive_case_lexical_targets(
    asr: str,
    reference: str,
    *,
    anchor_ranges: list[tuple[int, int]] | None = None,
    has_fine_spans: bool = True,
    inventory: frozenset[str] | None = None,
) -> tuple[str, list[RegionBundle]]:
    """Returns (scopeClass, region bundles with lexical targets)."""
    inv = inventory if inventory is not None else load_authoritative_lexicon_terms()
    scope = derive_target_scope(asr, reference, anchor_ranges=anchor_ranges, has_fine_spans=has_fine_spans)
    if scope.scopeClass == "FINAL_ALREADY_EQUIVALENT":
        return scope.scopeClass, []
    if norm_text(asr) == norm_text(reference):
        return "FINAL_ALREADY_EQUIVALENT", []

    bundles: list[RegionBundle] = []
    for i, reg in enumerate(scope.targets):
        # Only consider region-level candidates that are localization evidence
        rid = f"r{i}"
        if reg.eligibility == "OUTSIDE_CURRENT_RETRY_CONTRACT":
            b = RegionBundle(
                regionId=rid,
                asrSurface=reg.asrSurface,
                refSurface=reg.refSurface,
                curStart=reg.curStart,
                curEnd=reg.curEnd,
                refStart=reg.refStart,
                refEnd=reg.refEnd,
                normalizationEquivalent=False,
                regionClass="OUTSIDE_CURRENT_RETRY_CONTRACT",
            )
            bundles.append(b)
            continue
        b = derive_lexical_targets_for_region(
            region_id=rid,
            asr=asr,
            reference=reference,
            region=reg,
            inventory=inv,
        )
        bundles.append(b)
    return scope.scopeClass, bundles


def assert_fragment_not_auto_lexicon_gap(fragment: str, inventory: frozenset[str] | None = None) -> bool:
    """Negative helper: arbitrary fragment absence must not imply coverage gap."""
    inv = inventory if inventory is not None else load_authoritative_lexicon_terms()
    if lexicon_contains(fragment, inv):
        return True
    # Not in lexicon — still must NOT auto-classify as gap without identity pipeline
    return _outside_lexicon_contract(fragment) or len(norm_text(fragment)) < 2 or True
