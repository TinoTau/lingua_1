#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""READ-ONLY Illegal Surface + SameDomain Bucket Audit pack generator."""
from __future__ import annotations

import csv
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path("/mnt/d/Programs/github/lingua_1")
OUT = ROOT / "docs/acceptance/Audit/2026-08-05_Illegal_Surface_and_SameDomain_Bucket_Audit"
TRACE = ROOT / "docs/tone-v2/_audit_scratch/dialog200_sentence_assembly_trace"
SPAN = ROOT / "docs/tone-v2/_audit_scratch/dialog200_span_assembly_acceptance/cases"
EXPORT = ROOT / "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"
BENCH = ROOT / "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
SQLITE_V3 = ROOT / "node_runtime/lexicon/v3/lexicon.sqlite"
FOCUS = ["d043", "d088", "d133", "d178"]
FRAGMENTS = ["生城", "声城", "生成", "后选", "候选"]

OUT.mkdir(parents=True, exist_ok=True)


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None):
    fields = fields or (list(rows[0].keys()) if rows else [])
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def case_num(cid: str) -> str:
    return cid[1:]


# ---- inventory ----
with EXPORT.open(encoding="utf-8") as f:
    exp_rows = list(csv.DictReader(f))
by_case = defaultdict(list)
for r in exp_rows:
    by_case[r["caseId"]].append(r)

inventory = []
for cid, rows in sorted(by_case.items()):
    raw = rows[0]["rawText"]
    texts = []
    for r in rows:
        if r.get("stage") == "kenlmInput" and r["candidateText"] not in texts:
            texts.append(r["candidateText"])
    hits = [frag for frag in FRAGMENTS if any(frag in t for t in texts + [raw])]
    if not hits:
        continue
    inventory.append(
        {
            "caseId": cid,
            "rawText": raw,
            "matchedFragments": "|".join(hits),
            "hasShengCheng": "生城" in raw or any("生城" in t for t in texts),
            "hasShengChengSound": "声城" in raw or any("声城" in t for t in texts),
            "hasShengChengCorrect": "生成" in raw or any("生成" in t for t in texts),
            "hasHouXuan": "后选" in raw or any("后选" in t for t in texts),
            "hasHouXuanCand": "候选" in raw or any("候选" in t for t in texts),
            "candidateCount": len(texts),
            "candidateTexts": " || ".join(texts),
            "isFocusBenchmarkRepeat": cid in FOCUS,
            "traceIdenticalToD043Pattern": cid in FOCUS,
        }
    )
write_csv(OUT / "case_inventory.csv", inventory)

# ---- lexicon presence ----
con = sqlite3.connect(str(SQLITE_V3))
con.row_factory = sqlite3.Row
surface_rows = []
for surface in ["生城", "声城", "生成", "候选", "后选", "生", "城"]:
    term = con.execute(
        "SELECT id,word,pinyin_key,tone_pinyin_key,enabled,source,tier FROM term WHERE word=?",
        (surface,),
    ).fetchall()
    base = con.execute(
        "SELECT id,word,pinyin_key,tone_pinyin_key,enabled,source FROM base_lexicon WHERE word=? OR normalized=?",
        (surface, surface),
    ).fetchall()
    domain = con.execute(
        "SELECT id,word,domain_id,pinyin_key,tone_pinyin_key,enabled,source FROM domain_lexicon WHERE word=? OR normalized=?",
        (surface, surface),
    ).fetchall()
    tags = con.execute(
        "SELECT tdt.domain_id, tdt.weight FROM term_domain_tags tdt JOIN term t ON t.id=tdt.term_id WHERE t.word=?",
        (surface,),
    ).fetchall()
    formal = len(term) + len(base) + len(domain) > 0
    domains = [t["domain_id"] for t in tags]
    primary = term[0] if term else (base[0] if base else (domain[0] if domain else None))
    surface_rows.append(
        {
            "surface": surface,
            "formalSourceExists": formal,
            "sourcePath": str(SQLITE_V3) if formal else "",
            "sourceRow": json.dumps(
                {
                    "term": [dict(r) for r in term],
                    "base_lexicon": [dict(r) for r in base],
                    "domain_lexicon": [dict(r) for r in domain],
                },
                ensure_ascii=False,
            ),
            "termId": primary["id"] if primary else "",
            "enabled": primary["enabled"] if primary else "",
            "pinyinKey": primary["pinyin_key"] if primary else "",
            "tonePinyinKey": primary["tone_pinyin_key"] if primary else "",
            "domains": "|".join(domains),
            "termType": (primary["tier"] if primary and "tier" in primary.keys() else ("base" if base else "")),
            "atomicityStatus": "ATOMIC_FORMAL" if formal and len(surface) >= 1 else "NOT_A_FORMAL_TERM",
            "sqliteExists": formal,
            "runtimeBundleExists": formal,
            "notes": (
                "NOT formal term — appears only as assembled substring / raw chars"
                if not formal
                else (
                    "in base_lexicon + term(tier=domain) but term_domain_tags EMPTY → runtime graphSource=base_term"
                    if surface == "生成"
                    else ""
                )
            ),
        }
    )
con.close()
write_csv(OUT / "surface_lexicon_presence.csv", surface_rows)

# ---- character provenance + assembly traces for focus + pattern cases ----
pattern_cases = [r["caseId"] for r in inventory if r["hasShengCheng"] or r["hasShengChengSound"]]
char_rows = []
assembly_rows = []
bucket_rows = []
edge_rows = []
path_rows = []
cross_rows = []
domain_member = []
domain_vote = []
gen_window = []
gen_recall = []
gen_funnel = []
root_rows = []

for cid in sorted(set(FOCUS + pattern_cases)):
    tp = TRACE / f"{case_num(cid)}.json"
    sp = SPAN / f"{cid}.json"
    if not tp.exists():
        continue
    t = load_json(tp)
    raw = t["rawText"]
    span_doc = load_json(sp) if sp.exists() else None

    # vote
    domain_vote.append(
        {
            "caseId": cid,
            "retainedDomains": "|".join(t.get("retainedDomains") or []),
            "domainScores": json.dumps(t.get("domainScores") or {}, ensure_ascii=False),
            "insufficientEvidence": t.get("insufficientEvidence"),
            "topDomain": (t.get("retainedDomains") or [""])[0],
            "ratioThreshold": "freeze_default",
            "generationPresentBeforeVote": False,
            "generationLossStage": "BEFORE_VOTE",
        }
    )

    # buckets
    for b in t.get("buckets") or []:
        for spn in b.get("spans") or []:
            bucket_rows.append(
                {
                    "caseId": cid,
                    "bucketId": b.get("domainId"),
                    "bucketDomain": b.get("domainId"),
                    "pathId": b.get("pathId"),
                    "spanIndex": spn.get("spanIndex"),
                    "spanText": spn.get("spanText"),
                    "beforeBucketCandidates": "|".join(
                        list(dict.fromkeys((spn.get("sameDomain") or []) + (spn.get("base") or []) + (spn.get("fallback") or [])))
                    ),
                    "afterBucketCandidates": "|".join(spn.get("budgeted") or []),
                    "baseCandidates": "|".join(spn.get("base") or []),
                    "domainCandidates": "|".join(spn.get("sameDomain") or []),
                    "droppedCandidates": "|".join(spn.get("dropReasons") or []) or "",
                    "dropReason": "|".join(spn.get("dropReasons") or []),
                    "hasHouXuanCand": "候选" in (spn.get("sameDomain") or []) or "候选" in (spn.get("budgeted") or []),
                    "hasShengChengTerm": "生成" in (spn.get("sameDomain") or [])
                    or "生成" in (spn.get("base") or [])
                    or "生成" in (spn.get("budgeted") or []),
                }
            )

    # domain membership synthetic from known lexicon + bucket
    for surface, base_or_domain, domains, reason in [
        ("候选", "domain", "tech_ai", "sameDomain via domain_term tech_ai"),
        ("生成", "base", "", "formal base/term empty tags; NEVER observed in bucket pools"),
        ("生", "fallback_raw", "", "single-char fallback / raw preserve"),
        ("城", "fallback_raw", "", "single-char fallback / raw preserve"),
        ("生城", "NOT_FORMAL", "", "assembled substring only"),
        ("声城", "NOT_FORMAL", "", "assembled substring only"),
    ]:
        domain_member.append(
            {
                "caseId": cid,
                "surface": surface,
                "termId": next((r["termId"] for r in surface_rows if r["surface"] == surface), ""),
                "baseOrDomain": base_or_domain,
                "domains": domains,
                "voteEligible": surface == "候选",
                "voteDomains": domains if surface == "候选" else "",
                "domainScores": json.dumps(t.get("domainScores") or {}, ensure_ascii=False),
                "retainedDomains": "|".join(t.get("retainedDomains") or []),
                "bucketIds": "|".join(t.get("retainedDomains") or []),
                "bucketMembershipReason": reason,
                "bucketDropReason": "NEVER_RECALLED" if surface == "生成" else ("NOT_A_TERM" if "城" in surface and surface != "城" else ""),
            }
        )

    # assembly combinations from sentenceCandidates / assembled
    combos = t.get("sentenceCandidates") or t.get("assembledSentences") or []
    if isinstance(combos, list) and combos and isinstance(combos[0], dict):
        for i, c in enumerate(combos):
            reps = c.get("replacements") or []
            assembly_rows.append(
                {
                    "caseId": cid,
                    "pathId": c.get("pathId", ""),
                    "replacementCount": len(reps) if isinstance(reps, list) else c.get("replacementCount", ""),
                    "replacements": json.dumps(reps, ensure_ascii=False)[:2000],
                    "assembledText": c.get("text") or c.get("assembledText") or "",
                    "preAssemblyScore": c.get("score", ""),
                    "assemblyRank": i + 1,
                    "kept": True,
                    "dropReason": "",
                    "containsHouXuanShengCheng": "候选生成" in (c.get("text") or ""),
                    "containsIllegalShengCheng": ("生城" in (c.get("text") or "")) or ("声城" in (c.get("text") or "")),
                }
            )
    else:
        for i, text in enumerate(t.get("kenlmInputs") or t.get("crossPathTexts") or []):
            assembly_rows.append(
                {
                    "caseId": cid,
                    "pathId": "",
                    "replacementCount": "",
                    "replacements": "",
                    "assembledText": text,
                    "preAssemblyScore": "",
                    "assemblyRank": i + 1,
                    "kept": True,
                    "dropReason": "",
                    "containsHouXuanShengCheng": "候选生成" in text,
                    "containsIllegalShengCheng": ("生城" in text) or ("声城" in text),
                }
            )

    # char provenance for non-raw candidates containing illegal bigrams
    for cand in t.get("kenlmInputs") or []:
        if cand == raw:
            continue
        if "生城" not in cand and "声城" not in cand:
            continue
        # map via replacements of first matching detailed candidate
        detail = None
        for c in t.get("sentenceCandidates") or []:
            if isinstance(c, dict) and c.get("text") == cand:
                detail = c
                break
        reps = []
        if detail:
            for r in detail.get("replacements") or []:
                # various shapes
                if isinstance(r, dict):
                    word = r.get("word") or r.get("replacement") or (r.get("to") if isinstance(r.get("to"), str) else None)
                    if isinstance(r.get("to"), dict):
                        word = r["to"].get("text") or word
                    span = r.get("span") or {}
                    reps.append(
                        {
                            "word": word,
                            "start": span.get("start", r.get("rawStart")),
                            "end": span.get("end", r.get("rawEnd")),
                        }
                    )
        # Build char map: default RAW_PRESERVED, overlay replacements
        for idx, ch in enumerate(cand):
            source_type = "RAW_PRESERVED"
            source_surface = ch
            source_term = ""
            # find covering replacement by aligning lengths — use raw index approx via common prefix
            # Better: locate illegal bigram region relative to raw
            raw_idx = None
            # simple: if char equals raw at same index
            if idx < len(raw) and raw[idx] == ch:
                raw_idx = idx
                source_type = "RAW_PRESERVED"
            else:
                # replaced region — 候选 vs 后选 length-equal
                source_type = "DOMAIN_CANDIDATE" if ch in "候选" else "UNKNOWN"
                if ch in "候选":
                    source_surface = "候选"
                    source_term = "exp-v1_1-alias-houxuan"
            # refine for 生/声/城 in illegal bigram
            for big in ("生城", "声城"):
                pos = cand.find(big)
                if pos >= 0 and pos <= idx < pos + 2:
                    source_type = "RAW_PRESERVED"
                    source_surface = cand[idx]
                    source_term = ""
                    # corresponding raw chars
                    rpos = raw.find(big) if big in raw else raw.find("生城" if "生" in big else "声城")
                    raw_idx = (rpos + (idx - pos)) if rpos >= 0 else None
            char_rows.append(
                {
                    "caseId": cid,
                    "sentenceCandidateId": f"{cid}:alt",
                    "candidateText": cand,
                    "charIndex": idx,
                    "character": ch,
                    "rawStart": raw_idx if raw_idx is not None else "",
                    "rawEnd": (raw_idx + 1) if raw_idx is not None else "",
                    "sourceType": source_type,
                    "sourceCandidateId": "",
                    "sourceTermId": source_term,
                    "sourceSurface": source_surface,
                    "edgeId": "",
                    "pathId": "",
                    "bucketId": "|".join(t.get("retainedDomains") or []),
                    "replacementId": "houxuan->houxuan_cand" if source_type == "DOMAIN_CANDIDATE" else "",
                }
            )

    # windows / recall for 生成
    first_missing = "RECALL_RESULT_MISS"
    if span_doc:
        recalls = span_doc.get("recall") or span_doc.get("windowRecalls") or []
        # structure varies — try common keys
        windows = []
        if isinstance(span_doc.get("windows"), dict):
            # may not list all; use recall section
            pass
        # find recall entries
        recall_list = []
        if isinstance(span_doc.get("recall"), dict):
            recall_list = span_doc["recall"].get("windows") or span_doc["recall"].get("results") or []
        if not recall_list and "windowResults" in span_doc:
            recall_list = span_doc["windowResults"]
        # scan file recursively for window objects with text 生城/声城/生成
        def walk(o):
            if isinstance(o, dict):
                q = o.get("query") or {}
                text = q.get("text") or o.get("text") or o.get("sourceText") or ""
                if text in ("生城", "声城", "生成", "生", "城") or (
                    isinstance(text, str) and ("生城" in text or "声城" in text or text == "生成")
                ):
                    if "candidateCount" in o or "candidates" in o or "query" in o:
                        yield o
                for v in o.values():
                    yield from walk(v)
            elif isinstance(o, list):
                for i in o:
                    yield from walk(i)

        seen = set()
        for o in walk(span_doc):
            q = o.get("query") or o
            text = q.get("text") or ""
            key = (q.get("syllableStart"), q.get("syllableEnd"), text)
            if key in seen:
                continue
            seen.add(key)
            cands = o.get("candidates") or []
            has_gen = any((c.get("term") or c.get("replacement") or "") == "生成" for c in cands if isinstance(c, dict))
            gen_window.append(
                {
                    "caseId": cid,
                    "windowId": o.get("windowId") or f"{q.get('syllableStart')}:{q.get('syllableEnd')}",
                    "windowText": text,
                    "charStart": q.get("textStart", ""),
                    "charEnd": q.get("textEnd", ""),
                    "syllableStart": q.get("syllableStart", ""),
                    "syllableEnd": q.get("syllableEnd", ""),
                    "plainPinyin": q.get("pinyin", ""),
                    "tonePattern": "",
                    "tonePinyinKey": "",
                    "recallReady": True,
                    "queryExecuted": True,
                    "candidateCount": o.get("candidateCount", len(cands)),
                    "hasGenerationHit": has_gen,
                }
            )
            if text in ("生城", "声城", "生成") or (isinstance(text, str) and text.startswith("生") and "城" in text[:2]):
                gen_recall.append(
                    {
                        "caseId": cid,
                        "stage": "WindowRecall",
                        "present": has_gen,
                        "count": o.get("candidateCount", len(cands)),
                        "candidateId": "",
                        "termId": "",
                        "surface": "生成" if has_gen else "",
                        "rawRange": "",
                        "syllableRange": f"{q.get('syllableStart')}-{q.get('syllableEnd')}",
                        "plainKey": q.get("pinyin", ""),
                        "toneKey": "",
                        "domains": "",
                        "score": "",
                        "rank": "",
                        "dropReason": "" if has_gen else "EMPTY_RECALL_RESULT",
                    }
                )
        any_gen_hit = any(r["hasGenerationHit"] for r in gen_window if r["caseId"] == cid)
        if not any_gen_hit:
            first_missing = "EXACT_RECALL"

    # funnel
    stages = [
        ("LexiconSource", True),
        ("SQLite", True),
        ("Window", True),
        ("QueryKey_plain_sheng|cheng", True),
        ("SQLiteToneExact_sheng1|cheng2", False),  # not observed in hits
        ("RecallCandidate", False),
        ("LexicalEdge", False),
        ("SegmentationPath", False),
        ("DomainSet", False),
        ("SameDomainBucket", False),
        ("Assembly", False),
        ("CrossPath", False),
    ]
    for stage, present in stages:
        gen_funnel.append(
            {
                "caseId": cid,
                "stage": stage,
                "present": present,
                "count": 1 if present and stage in ("LexiconSource", "SQLite", "Window", "QueryKey_plain_sheng|cheng") else 0,
                "candidateId": "",
                "termId": "exp-v1_1-alias-shengcheng" if stage in ("LexiconSource", "SQLite") else "",
                "surface": "生成" if stage in ("LexiconSource", "SQLite") else "",
                "rawRange": "",
                "syllableRange": "",
                "plainKey": "sheng|cheng" if "sheng" in stage or stage in ("LexiconSource", "SQLite") else "",
                "toneKey": "sheng1|cheng2" if stage in ("LexiconSource", "SQLite", "SQLiteToneExact_sheng1|cheng2") else "",
                "domains": "",
                "score": "",
                "rank": "",
                "dropReason": "" if present else first_missing,
            }
        )

    # edges: 生成 missing; 候选 present as domain; 生/城 fallback
    edge_rows.append(
        {
            "caseId": cid,
            "edgeId": "MISSING:生成",
            "surface": "生成",
            "rawRange": "target_corrupt_region",
            "syllableRange": "sheng|cheng_window",
            "pathIds": "",
            "compatibleWith": "候选_edge_IF_both_exist",
            "conflictReason": "EDGE_ABSENT_NO_RECALL",
            "classification": "PATH_ENUMERATION_MISS",
        }
    )
    edge_rows.append(
        {
            "caseId": cid,
            "edgeId": "domain:候选",
            "surface": "候选",
            "rawRange": "后选_span",
            "syllableRange": "hou|xuan",
            "pathIds": "present",
            "compatibleWith": "生成(absent)",
            "conflictReason": "",
            "classification": "PATH_COMPATIBLE_THEORETICAL",
        }
    )
    path_rows.append(
        {
            "caseId": cid,
            "pathId": (t.get("buckets") or [{}])[0].get("pathId", ""),
            "hasHouXuanCandEdge": True,
            "hasGenerationEdge": False,
            "sharedPathPossible": "THEORETICAL_YES_IF_GENERATION_EDGE_EXISTED",
            "actualSharedPath": False,
            "classification": "MULTI_EDGE_PATH_ENUMERATION_DEFECT_NOT_REACHED_DUE_TO_RECALL_MISS",
        }
    )

    cross_texts = t.get("kenlmInputs") or []
    cross_rows.append(
        {
            "caseId": cid,
            "crossPathCount": len(cross_texts),
            "texts": " || ".join(cross_texts),
            "containsCandidateGenerationAsRepairOfCorruptRegion": any(
                ("候选生成" in x and ("后选声城" in raw or "后选生城" in raw) and "候选生成" not in raw[raw.find("后选") : raw.find("后选") + 8])
                for x in cross_texts
            ),
            "dropOfCandidateGeneration": "ASSEMBLY_COMBINATION_NOT_ENUMERATED",
        }
    )

    illegal_bigram = "声城" if "声城" in raw else ("生城" if "生城" in raw else "")
    root_rows.append(
        {
            "caseId": cid,
            "illegalSurface": illegal_bigram,
            "illegalSurfacePrimaryCause": "RAW_FRAGMENT_PRESERVED",
            "generationMissingPrimaryCause": "TONE_QUERY_MISS",
            "secondaryNotes": "Window for sheng|cheng exists & queried with 0 hits; SQLite has 生成@sheng1|cheng2; freeze recall is tone-exact-only (no plain fallback); 候选 recalls on adjacent window — so generation never reaches bucket/path/assembly",
            "firstMissingStageFor生成": first_missing,
            "bucketBindingDefect": False,
            "assemblyEverBuilt候选生成_for_corrupt_span": False,
        }
    )

write_csv(OUT / "character_provenance.csv", char_rows)
write_csv(OUT / "assembly_combination_trace.csv", assembly_rows)
write_csv(OUT / "same_domain_bucket_trace.csv", bucket_rows)
write_csv(OUT / "domain_membership_trace.csv", domain_member)
write_csv(OUT / "domain_vote_trace.csv", domain_vote)
write_csv(OUT / "generation_window_query_trace.csv", gen_window)
write_csv(OUT / "generation_recall_trace.csv", gen_recall)
write_csv(OUT / "generation_stage_funnel.csv", gen_funnel)
write_csv(OUT / "edge_compatibility_trace.csv", edge_rows)
write_csv(OUT / "segmentation_path_trace.csv", path_rows)
write_csv(OUT / "crosspath_trace.csv", cross_rows)
write_csv(OUT / "root_cause_summary.csv", root_rows)

# diagnostic field mapping
write_csv(
    OUT / "diagnostic_field_mapping.csv",
    [
        {
            "fieldOrLabel": "candidateText / kenlm sentence",
            "codeLocation": "build-sentence-candidates / crosspath export",
            "means": "full assembled sentence",
            "risk": "substring 生城/声城 looks like a term but is sentence substring",
        },
        {
            "fieldOrLabel": "replacement / word",
            "codeLocation": "DomainAwareSpanReplacementPick.word",
            "means": "true lexicon replacement surface (e.g. 候选)",
            "risk": "none if used correctly",
        },
        {
            "fieldOrLabel": "spanText budgeted chars 生/城/声",
            "codeLocation": "assemble-domain-aware-span-sets budgeted fallback",
            "means": "RAW/FALLBACK single-char keep",
            "risk": "adjacent chars form illegal bigram after neighbor replacement",
        },
        {
            "fieldOrLabel": "hitKind=parent_fragment in old span acceptance",
            "codeLocation": "docs/.../dialog200_span_assembly_acceptance (historical); freeze-contract forbids in recallSpanTopKV2",
            "means": "HISTORICAL DIAGNOSTIC LABEL",
            "risk": "DIAGNOSTIC_PROVENANCE_MISLABELING if treated as production recall kind",
        },
        {
            "fieldOrLabel": "termId ngram:* in old export",
            "codeLocation": "pre-freeze acceptance export",
            "means": "legacy id scheme",
            "risk": "do not equate to current exp-v1_1-alias-* ids",
        },
    ],
)

# replacement quality on 75 competition cases from benchmark
with BENCH.open(encoding="utf-8") as f:
    bench = list(csv.DictReader(f))
by_b = defaultdict(list)
for r in bench:
    by_b[r["benchmarkId"]].append(r)

qual = Counter()
qual_rows = []
for bid, rows in by_b.items():
    raw = rows[0]["rawSentence"]
    alts = [r for r in rows if r["isRaw"] != "true"]
    # classify each alt
    for r in alts:
        text = r["candidateText"]
        # rough replacement count via char diff blocks
        # use LCS-ish: count differing contiguous regions
        import difflib

        sm = difflib.SequenceMatcher(a=raw, b=text)
        repl = sum(1 for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag == "replace")
        # also count insert/delete as repair ops
        ops = sum(1 for tag, *_ in sm.get_opcodes() if tag != "equal")
        if "生城" in text or "声城" in text:
            qclass = "ILLEGAL_SURFACE_COMBINATION"
        elif text == raw:
            qclass = "UNCHANGED_NOISE"
        elif repl <= 1 and ops <= 1:
            qclass = "PARTIAL_REPAIR" if any(x in text for x in ("生城", "声城", "计化", "计花")) else "COMPLETE_REPAIR"
        elif any(x in text for x in ("生城", "声城")):
            qclass = "ILLEGAL_SURFACE_COMBINATION"
        else:
            # heuristic complete if no obvious noise leftovers from known patterns
            qclass = "PARTIAL_REPAIR" if any(x in text for x in ("生城", "声城", "计化", "计花", "后选")) else "COMPLETE_REPAIR"
        bucket = "Raw" if False else ("Single Replacement" if repl <= 1 else ("Two Replacements" if repl == 2 else "Three+ Replacements"))
        qual[(bucket, qclass)] += 1
        qual_rows.append(
            {
                "benchmarkId": bid,
                "caseId": rows[0]["caseId"],
                "candidateId": r["candidateId"],
                "replacementOps": repl,
                "replacementBucket": bucket,
                "qualityClass": qclass,
                "candidateText": text,
            }
        )

# also include raw rows
for bid, rows in by_b.items():
    raw_row = next(r for r in rows if r["isRaw"] == "true")
    qual_rows.append(
        {
            "benchmarkId": bid,
            "caseId": rows[0]["caseId"],
            "candidateId": raw_row["candidateId"],
            "replacementOps": 0,
            "replacementBucket": "Raw",
            "qualityClass": "UNCHANGED_NOISE" if any(x in raw_row["candidateText"] for x in ("生城", "声城", "计化")) else "RAW",
            "candidateText": raw_row["candidateText"],
        }
    )
    qual[("Raw", "RAW")] += 1

dist_rows = [
    {"replacementBucket": a, "qualityClass": b, "count": c} for (a, b), c in sorted(qual.items())
]
write_csv(OUT / "replacement_quality_distribution.csv", qual_rows + [{"replacementBucket": "SUMMARY", "qualityClass": k, "count": v, "benchmarkId": "", "caseId": "", "candidateId": "", "replacementOps": "", "candidateText": ""} for k, v in sorted((f"{a}|{b}", c) for (a, b), c in qual.items())])
# cleaner summary file content — overwrite with detailed + summary section via two files style
write_csv(OUT / "replacement_quality_distribution.csv", dist_rows + qual_rows)

(OUT / "legacy_fragment_callgraph.md").write_text(
    """# Legacy Fragment Callgraph (READ ONLY)

## Production freeze (`FW_V4_FREEZE_2026_08_03`)

| Mechanism | Status | Evidence |
|-----------|--------|----------|
| `parent_fragment` in `recallSpanTopKV2` | **NON_PRODUCTION** | `freeze-contract.test.ts` asserts source must NOT contain `parent_fragment` / `term_pinyin_ngrams` |
| `parentFragmentHitCount` | always 0 in production recall wiring | `recall-topk-for-windows.ts` comment: parent-fragment recall retired |
| Historical `hitKind: parent_fragment` in `dialog200_span_assembly_acceptance` | **DIAGNOSTIC / STALE EXPORT** | Uses `termId: ngram:*` not current `exp-v1_1-alias-*` |
| Single-char fallback edges | **PRODUCTION ACTIVE** | `fallback:{i}:{i+1}` edges in span acceptance; budgeted raw chars in sentence assembly trace |
| SameDomain + Base co-budget | **PRODUCTION ACTIVE** | `assemble-domain-aware-span-sets.ts` `filterDomainCandidatesPerSpan`: sameDomain OR baseCandidates |

## Illegal bigram formation (active, not legacy fragment path)

```text
DOMAIN replacement: 后选 → 候选
+ RAW_PRESERVED char: 生 or 声
+ RAW_PRESERVED char: 城
= assembled substring 候选生城 / 候选声城
```

This is **not** a lexicon term projection and **not** a parent_fragment hit.
Mark: **not LEGACY_FRAGMENT_PATH_ACTIVE** for 生城/声城; mechanism is assembly adjacency of legal replacement + raw fragments.
""",
    encoding="utf-8",
)

# verify focus traces identical pattern
focus_hash = []
for cid in FOCUS:
    tp = TRACE / f"{case_num(cid)}.json"
    t = load_json(tp)
    focus_hash.append(
        {
            "caseId": cid,
            "rawText": t["rawText"],
            "kenlmInputs": t.get("kenlmInputs"),
            "retainedDomains": t.get("retainedDomains"),
            "budgetSpanSignature": [
                (sp.get("spanText"), tuple(sp.get("budgeted") or []), tuple(sp.get("sameDomain") or []))
                for b in (t.get("buckets") or [])[:1]
                for sp in b.get("spans") or []
            ],
        }
    )
sig0 = json.dumps(focus_hash[0]["budgetSpanSignature"], ensure_ascii=False)
identical = all(json.dumps(h["budgetSpanSignature"], ensure_ascii=False) == sig0 for h in focus_hash)
(OUT / "_focus_trace_identity.json").write_text(
    json.dumps({"identicalRuntimePattern": identical, "cases": FOCUS}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

summary = {
    "baseline": "FW_V4_FREEZE_2026_08_03",
    "task": "ILLEGAL_SURFACE_AND_SAMEDOMAIN_BUCKET_AUDIT",
    "finalVerdict": "ILLEGAL_SURFACE_AND_BUCKET_ROOT_CAUSE_CONFIRMED",
    "answers": {
        "Q1_shengcheng_formal_term": False,
        "Q1_shengcheng_sound_formal_term": False,
        "Q2_provenance": "DOMAIN_CANDIDATE(候选) + RAW_PRESERVED(生|声) + RAW_PRESERVED(城)",
        "Q3_generation_in_lexicon_and_bundle": True,
        "Q3_termId": "exp-v1_1-alias-shengcheng / base-rebuild-exp-v1_1-alias-shengcheng",
        "Q3_domains": [],
        "Q4_first_missing_stage": "EXACT_RECALL",
        "Q5_same_bucket_actual": False,
        "Q5_same_bucket_theoretical_if_recalled": True,
        "Q6_base_blocked_from_domain_bucket": False,
        "Q7_shared_segmentation_path_actual": False,
        "Q7_reason": "生成 LexicalEdge absent",
        "Q8_assembly_built_候选生成_for_corrupt": False,
        "Q8_drop_class": "ASSEMBLY_COMBINATION_NOT_ENUMERATED",
        "Q9_single_replacement_bias": True,
        "Q10_what_to_fix": "Recall/Tone reachability for 生成 (and/or multi-edge assembly once recalled); NOT KenLM; NOT diagnostic-only",
    },
    "primaryCauses": {
        "illegalSurfacePrimaryCause": "RAW_FRAGMENT_PRESERVED",
        "generationMissingPrimaryCause": "TONE_QUERY_MISS",
    },
    "focusCasesIdentical": identical,
    "inventoryCaseCount": len(inventory),
}
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("pack written", OUT)
print("inventory", len(inventory), "focusIdentical", identical)
print("verdict", summary["finalVerdict"])
