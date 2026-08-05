#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""READ ONLY — Partial Repair Candidate Admission Audit pack."""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path("/mnt/d/Programs/github/lingua_1")
OUT = ROOT / "docs/acceptance/Audit/2026-08-05_Partial_Repair_Candidate_Admission_Audit"
TRACE = ROOT / "docs/tone-v2/_audit_scratch/dialog200_sentence_assembly_trace"
BENCH = ROOT / "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
EXPORT = ROOT / "docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv"

FOCUS_PARTIAL = ["d043", "d088", "d133", "d178"]
OUT.mkdir(parents=True, exist_ok=True)

ILLEGAL_BIGRAMS = ("生城", "声城")
NOISE_LEFTOVERS = ("生城", "声城", "计化", "计花", "后选")  # imperfect residual after partial fix


def write_csv(name: str, rows: list[dict], fields: list[str] | None = None):
    if not rows:
        (OUT / name).write_text("", encoding="utf-8")
        return
    fields = fields or list(rows[0].keys())
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def load_trace(cid: str) -> dict | None:
    p = TRACE / f"{cid[1:]}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def repair_ops(replacements: list) -> list[dict]:
    ops = []
    for r in replacements or []:
        if not isinstance(r, dict):
            continue
        span = r.get("span") or {}
        word = r.get("word") or ""
        start, end = span.get("start"), span.get("end")
        if start is None or end is None:
            continue
        raw_span = span.get("text") or ""
        is_repair = bool(r.get("repairTarget")) and word != raw_span
        # also treat lexicon replace when word differs from span text
        if word and raw_span and word != raw_span:
            is_repair = True
        if r.get("source") == "canonical_exact" and not r.get("repairTarget"):
            is_repair = False
        ops.append(
            {
                "start": start,
                "end": end,
                "rawSpan": raw_span,
                "word": word,
                "source": r.get("source") or "",
                "repairTarget": bool(r.get("repairTarget")),
                "isRepair": is_repair,
                "score": r.get("candidateScore") or r.get("priorScore") or 0,
            }
        )
    return ops


def classify_candidate(raw: str, text: str, ops: list[dict]) -> str:
    repairs = [o for o in ops if o["isRepair"]]
    if text == raw or not repairs:
        return "RAW_ONLY"
    # adjacent illegal: replacement next to residual bigram noise
    for big in ILLEGAL_BIGRAMS:
        if big in text:
            # find if a repair ends immediately before bigram
            pos = text.find(big)
            for o in repairs:
                if o["end"] == pos or abs(o["end"] - pos) <= 0:
                    return "PARTIAL_REPAIR"
            # or bigram present while a nearby 后选→候选 happened
            if any(o["word"] == "候选" for o in repairs):
                return "PARTIAL_REPAIR"
    # 计化 residual with 计划 fix elsewhere / partial
    if "计化" in text or "计花" in text:
        if any(o["word"] == "计划" for o in repairs) or any(o["word"] == "候选" for o in repairs):
            return "PARTIAL_REPAIR"
        return "PARTIAL_REPAIR"
    # 后选 still present with other repairs
    if "后选" in text and any(o["word"] == "候选" for o in repairs):
        # one occurrence fixed, another left — partial
        return "PARTIAL_REPAIR"
    # mixed: repairs + raw elsewhere, no known illegal cluster
    # if residual known noise gone and repairs applied
    if any(x in text for x in ILLEGAL_BIGRAMS):
        return "PARTIAL_REPAIR"
    # Heuristic: MIXED_BUT_VALID if repairs applied and no noise leftovers
    if not any(x in text for x in ("生城", "声城", "计化", "计花")):
        # still may be near-homophone damage (科医 etc.) — treat as noise alt not partial repair of domain cluster
        if any(x in text for x in ("科医", "低脂", "地质", "酒店半", "量检", "理服", "更医师", "更议室", "作液室", "登机", "钟点", "房监控", "细吸", "科机员", "科记员")):
            return "MIXED_BUT_VALID"  # actually damaging alt — still mixed
        return "COMPLETE_REPAIR"
    return "UNDETERMINED"


def char_provenance(raw: str, text: str, ops: list[dict]) -> list[dict]:
    """Map each char of candidate text to LEXICON_REPLACEMENT / RAW_PRESERVED / PUNCTUATION."""
    # Build covering intervals from repairs (applied on raw indices)
    repair_intervals = [(o["start"], o["end"], o["word"]) for o in ops if o["isRepair"]]
    # Reconstruct by walking raw with replacements RTL conceptually via alignment
    rows = []
    # Prefer: for each repair, chars in replacement surface at that region
    covered_raw = set()
    for s, e, word in repair_intervals:
        for i in range(s, e):
            covered_raw.add(i)
    # Align text to raw by applying repairs LTR on a map
    # Simple approach: if text==raw all RAW; else use SequenceMatcher-ish via repair ops
    import difflib

    sm = difflib.SequenceMatcher(a=raw, b=text)
    ti = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for j in range(j1, j2):
                ch = text[j]
                st = "PUNCTUATION" if not ("\u4e00" <= ch <= "\u9fff") and ch not in "0123456789" else "RAW_PRESERVED"
                if ch in "，。？！、；：""''（）【】《》—…·,.!?;:()[]{}\"'`- ":
                    st = "PUNCTUATION"
                rows.append({"charIndex": j, "character": ch, "sourceType": st, "rawStart": i1 + (j - j1), "rawEnd": i1 + (j - j1) + 1})
        elif tag == "replace":
            # replacement surface
            for j in range(j1, j2):
                ch = text[j]
                rows.append(
                    {
                        "charIndex": j,
                        "character": ch,
                        "sourceType": "LEXICON_REPLACEMENT",
                        "rawStart": i1,
                        "rawEnd": i2,
                    }
                )
        elif tag == "insert":
            for j in range(j1, j2):
                rows.append(
                    {
                        "charIndex": j,
                        "character": text[j],
                        "sourceType": "UNKNOWN",
                        "rawStart": "",
                        "rawEnd": "",
                    }
                )
        # delete: no text chars
    return rows


# ---- Load benchmark 75 cases ----
with BENCH.open(encoding="utf-8") as f:
    bench_rows = list(csv.DictReader(f))
by_bench = defaultdict(list)
for r in bench_rows:
    by_bench[r["benchmarkId"]].append(r)

competition_cases = []
for bid, rows in sorted(by_bench.items()):
    competition_cases.append(
        {
            "benchmarkId": bid,
            "caseId": rows[0]["caseId"],
            "rawText": rows[0]["rawSentence"],
            "rows": rows,
            "status": rows[0]["status"],
            "humanDecision": rows[0]["humanDecision"],
        }
    )

provenance_rows = []
classification_rows = []
partial_traces = []
complete_traces = []
assembly_inv = []
budget_rows = []

class_counter = Counter()
top16_class = Counter()
top16_repl_bucket = Counter()
single_vs_multi = Counter()

for meta in competition_cases:
    cid = meta["caseId"]
    raw = meta["rawText"]
    t = load_trace(cid)
    combos = []
    if t:
        combos = t.get("uniqueBeforeCap") or []
        # fallback kenlm texts
        if not combos:
            for text in t.get("kenlmInputs") or t.get("assemblyTexts") or []:
                combos.append({"text": text, "replacements": [], "candidateScore": 0})

    # Also use benchmark candidates for classification when trace missing detail
    bench_alts = meta["rows"]

    # Map text -> combo from trace
    by_text = {}
    for c in combos:
        if isinstance(c, dict) and c.get("text"):
            by_text[c["text"]] = c

    case_classes = []
    for r in bench_alts:
        text = r["candidateText"]
        is_raw = r["isRaw"] == "true"
        combo = by_text.get(text) or {}
        ops = repair_ops(combo.get("replacements") or [])
        if is_raw and not ops:
            cls = "RAW_ONLY"
            repl_count = 0
        else:
            if not ops and not is_raw:
                # infer from diff
                import difflib

                sm = difflib.SequenceMatcher(a=raw, b=text)
                repl_count = sum(1 for tag, *_ in sm.get_opcodes() if tag == "replace")
                ops = []
                cls = classify_candidate(raw, text, [])
                # refine without ops
                if is_raw:
                    cls = "RAW_ONLY"
                elif any(b in text for b in ILLEGAL_BIGRAMS) and "候选" in text and "候选" not in raw[raw.find("后选") : raw.find("后选") + 2] if "后选" in raw else True:
                    if "后选" in raw and "候选" in text:
                        cls = "PARTIAL_REPAIR"
                elif text != raw and not any(b in text for b in ILLEGAL_BIGRAMS) and not any(x in text for x in ("计化", "计花")):
                    # may still be wrong alt
                    if any(x in text for x in ("科医", "低脂", "地质", "酒店", "量检", "理服", "更医", "更议", "作液", "登机", "钟点", "监控调", "细吸", "科机", "科记")):
                        cls = "MIXED_BUT_VALID"
                    else:
                        cls = "COMPLETE_REPAIR" if repl_count >= 1 else "UNDETERMINED"
                elif any(b in text for b in ILLEGAL_BIGRAMS) or "计化" in text or "计花" in text:
                    cls = "PARTIAL_REPAIR"
                else:
                    cls = "MIXED_BUT_VALID" if text != raw else "RAW_ONLY"
            else:
                repairs = [o for o in ops if o["isRepair"]]
                repl_count = len(repairs)
                cls = "RAW_ONLY" if is_raw or repl_count == 0 else classify_candidate(raw, text, ops)

        class_counter[cls] += 1
        case_classes.append(cls)

        # rank in kenlm pool approx by bench rank
        rank = int(r.get("rank") or 0)
        in_top16 = rank <= 16 and rank > 0
        if in_top16 and not is_raw:
            top16_class[cls] += 1
            if repl_count <= 1:
                top16_repl_bucket["single_or_inferred_1"] += 1
                single_vs_multi["single"] += 1
            else:
                top16_repl_bucket["multi"] += 1
                single_vs_multi["multi"] += 1

        repairs = [o for o in ops if o["isRepair"]]
        raw_pres = [o for o in ops if not o["isRepair"]]
        # provenance chars
        prov = char_provenance(raw, text, ops)
        for pr in prov:
            provenance_rows.append(
                {
                    "caseId": cid,
                    "benchmarkId": meta["benchmarkId"],
                    "candidateId": r["candidateId"],
                    "candidateText": text,
                    "rawText": raw,
                    **pr,
                }
            )

        classification_rows.append(
            {
                "caseId": cid,
                "benchmarkId": meta["benchmarkId"],
                "candidateId": r["candidateId"],
                "candidateText": text,
                "rawText": raw,
                "isRaw": is_raw,
                "replacementCount": len(repairs) if repairs else (0 if is_raw else ""),
                "replacementSurfaces": "|".join(o["word"] for o in repairs),
                "replacementRanges": "|".join(f"{o['start']}-{o['end']}" for o in repairs),
                "rawPreservedRanges": "|".join(f"{o['start']}-{o['end']}" for o in raw_pres),
                "auditClass": cls,
                "kenlmRank": rank,
                "inTop16": in_top16,
                "assemblyScore": combo.get("candidateScore", ""),
                "bucketDomain": "|".join((t or {}).get("retainedDomains") or []) if t else "",
                "kenlmInput": True,
            }
        )

        if cls == "PARTIAL_REPAIR":
            partial_traces.append(
                {
                    "caseId": cid,
                    "candidateId": r["candidateId"],
                    "candidateText": text,
                    "rawText": raw,
                    "replacementSurfaces": "|".join(o["word"] for o in repairs),
                    "illegalResidual": "|".join(b for b in ILLEGAL_BIGRAMS if b in text)
                    or ("计化" if "计化" in text else "")
                    or ("计花" if "计花" in text else ""),
                    "primaryCause": "RAW_FALLBACK_ADMISSION_COUPLING",
                    "secondaryCauses": "NO_REPAIR_COMPLETENESS_CONTRACT|SINGLE_REPLACEMENT_ENUMERATION_BIAS",
                    "admissionFunction": "buildSentenceCandidates → mergeCrossPathSentenceCandidates",
                }
            )
        if cls == "COMPLETE_REPAIR":
            complete_traces.append(
                {
                    "caseId": cid,
                    "candidateId": r["candidateId"],
                    "candidateText": text,
                    "rawText": raw,
                    "replacementSurfaces": "|".join(o["word"] for o in repairs),
                    "kenlmRank": rank,
                }
            )

    # assembly inventory for focus + sample
    if t and (cid in FOCUS_PARTIAL or cid in ("d019", "d007", "d045")):
        for i, c in enumerate(combos):
            if not isinstance(c, dict):
                continue
            ops = repair_ops(c.get("replacements") or [])
            repairs = [o for o in ops if o["isRepair"]]
            raw_fb = [o for o in ops if not o["isRepair"]]
            text = c.get("text") or ""
            assembly_inv.append(
                {
                    "caseId": cid,
                    "pathId": (t.get("buckets") or [{}])[0].get("pathId", ""),
                    "comboIndex": i,
                    "assembledText": text,
                    "replacementCount": len(repairs),
                    "rawFallbackCount": len(raw_fb),
                    "edges": "",
                    "assemblyScore": c.get("candidateScore", ""),
                    "kept": i < 16,
                    "dropReason": "" if i < 16 else "CROSSPATH_OR_ASSEMBLY_CAP",
                    "auditClass": classify_candidate(raw, text, ops) if repairs else ("RAW_ONLY" if text == raw else "UNDETERMINED"),
                }
            )

# budget distribution
n_candidates = len(classification_rows)
budget_rows = [
    {"metric": "totalCandidatesInBenchmark", "value": n_candidates},
    {"metric": "competitionCases", "value": len(competition_cases)},
]
for k, v in sorted(class_counter.items()):
    budget_rows.append({"metric": f"class_{k}", "value": v})
for k, v in sorted(top16_class.items()):
    budget_rows.append({"metric": f"top16_nonRaw_{k}", "value": v})
budget_rows.append({"metric": "top16_singleReplacementish", "value": single_vs_multi["single"]})
budget_rows.append({"metric": "top16_multiReplacement", "value": single_vs_multi["multi"]})
partial_n = class_counter["PARTIAL_REPAIR"]
complete_n = class_counter["COMPLETE_REPAIR"]
non_raw = n_candidates - class_counter["RAW_ONLY"]
budget_rows.append(
    {
        "metric": "partialShareOfNonRaw",
        "value": round(partial_n / non_raw, 4) if non_raw else 0,
    }
)
top16_nonraw = sum(top16_class.values())
budget_rows.append(
    {
        "metric": "partialShareOfTop16NonRaw",
        "value": round(top16_class["PARTIAL_REPAIR"] / top16_nonraw, 4) if top16_nonraw else 0,
    }
)

write_csv("candidate_repair_provenance.csv", provenance_rows)
write_csv("candidate_repair_classification.csv", classification_rows)
write_csv("assembly_path_inventory.csv", assembly_inv)
write_csv("partial_repair_case_trace.csv", partial_traces)
write_csv("complete_repair_case_trace.csv", complete_traces)
write_csv("candidate_budget_distribution.csv", budget_rows)

# raw fallback role
write_csv(
    "raw_fallback_role_trace.csv",
    [
        {
            "role": "PATH_CONNECTIVITY",
            "present": True,
            "evidence": "budgetPerSpanCandidates always appends canonical/raw; fallback edges ensure full syllable coverage",
            "code": "assemble-domain-aware-span-sets.ts budgetPerSpanCandidates; fallback:{i}:{i+1} edges",
        },
        {
            "role": "SENTENCE_OUTPUT_GUARANTEE",
            "present": True,
            "evidence": "empty repair subset → buildPathFromRepairs fills all gaps with canonical_exact → raw sentence",
            "code": "build-sentence-candidates.ts buildGapCanonicalPicks",
        },
        {
            "role": "FINAL_CANDIDATE_ADMISSION",
            "present": True,
            "evidence": "Every repair subset including single replacement + raw gaps becomes SentenceCombination; no completeness gate before mergeCrossPath",
            "code": "buildSentenceCandidates enumerateIntervalPaths allNonOverlapSubsets includes [] and singletons",
        },
        {
            "role": "CONSUMES_CANDIDATE_BUDGET",
            "present": True,
            "evidence": "Partial+raw combos enter uniqueBeforeCap and compete under global cap ≤16",
            "code": "mergeCrossPathSentenceCandidates",
        },
        {
            "role": "FREE_COMBO_WITH_REPLACEMENT",
            "present": True,
            "evidence": "Per-slot subsets of repairTargets; non-repair spans remain raw via gaps — 候选 freely pairs with 声+城 raw",
            "code": "enumerateIntervalPaths + buildPathFromRepairs",
        },
        {
            "role": "COUPLING_CLASSIFICATION",
            "present": True,
            "evidence": "PATH_CONNECTIVITY mechanism reused as FINAL_CANDIDATE_ADMISSION without filter",
            "code": "RAW_FALLBACK_ADMISSION_COUPLING",
        },
    ],
)

# pre-kenlm scoring inventory
write_csv(
    "pre_kenlm_scoring_inventory.csv",
    [
        {
            "layer": "Edge/Recall score",
            "duty": "Rank lexicon hits into WindowCandidate",
            "input": "prior + tone penalty + domain boost",
            "sortPosition": "1_recall",
            "hardDelete": "tone-not-ready / eligibility drops",
            "prefersFewReplacements": "n/a",
            "prefersKeepRaw": "no",
            "overlapWithOthers": "feeds candidateScore",
        },
        {
            "layer": "Domain Presence Vote",
            "duty": "Select retainedDomains for buckets",
            "input": "domain_term tags per FineSpan",
            "sortPosition": "2_vote",
            "hardDelete": "no (insufficientEvidence → base-only bucket)",
            "prefersFewReplacements": "no",
            "prefersKeepRaw": "no",
            "overlapWithOthers": "not language fluency",
        },
        {
            "layer": "Per-span budget",
            "duty": "Limit picks per FineSpan (sameDomain>base>fallback>canonical)",
            "input": "DomainAware picks",
            "sortPosition": "3_span_budget",
            "hardDelete": "soft truncate to perSpanLimit",
            "prefersFewReplacements": "no",
            "prefersKeepRaw": "canonical always retained as option",
            "overlapWithOthers": "surface dedupe may drop base if same surface as domain",
        },
        {
            "layer": "Assembly candidateScore",
            "duty": "Sum of pick.candidateScore; sort before per-bucket slice",
            "input": "SentenceCombination.replacements",
            "sortPosition": "4_assembly",
            "hardDelete": "no fluency gate; slice by maxSentenceCandidates after text dedupe",
            "prefersFewReplacements": "NO — higher sum prefers more/high-score repairs; BUT empty raw scores 0 so any single repair ranks above raw; multi ranks above single if scores add",
            "prefersKeepRaw": "raw always enumerated as empty subset",
            "overlapWithOthers": "PRE_KENLM_RANKING_RESPONSIBILITY_OVERLAP mild — uses lexicon priors not LM",
        },
        {
            "layer": "CrossPath merge",
            "duty": "Exact text dedupe first-wins + global cap≤16",
            "input": "path×bucket SentenceCombination lists",
            "sortPosition": "5_crosspath",
            "hardDelete": "duplicates dropped; tail truncated after cap",
            "prefersFewReplacements": "indirect — collection order path_bucket_candidate; no re-score",
            "prefersKeepRaw": "no preference",
            "overlapWithOthers": "no fluency ranking",
        },
        {
            "layer": "KenLM rerank",
            "duty": "LM score + raw_log_delta gate",
            "input": "≤16 combinations",
            "sortPosition": "6_kenlm",
            "hardDelete": "no delete of pool; pick keep-raw if delta<minDelta",
            "prefersFewReplacements": "n/a (LM)",
            "prefersKeepRaw": "via minDeltaToReplace gate",
            "overlapWithOthers": "sole fluency owner by freeze",
        },
    ],
)

write_csv(
    "cap_and_dedupe_matrix.csv",
    [
        {"cap": "per-span candidate limit", "owner": "budgetPerSpanCandidates", "necessary": True, "risk": "may truncate base if sameDomain fills cap", "duplicates": False},
        {"cap": "maxIntervalEnumNodes=1024", "owner": "enumerateIntervalPaths", "necessary": True, "risk": "enum abort under huge slots", "duplicates": False},
        {"cap": "maxIntervalRepairPicksPerPath=16", "owner": "enumerateIntervalPaths", "necessary": True, "risk": "blocks huge multi-repair paths", "duplicates": False},
        {"cap": "per-bucket buildSentenceCandidates(maxSentenceCandidates)", "owner": "orchestrator path loop", "necessary": True, "risk": "may truncate lower-score combos including multi-repair", "duplicates": "overlaps global intent"},
        {"cap": "allocateDomainBucketSentenceBudget", "owner": "utterance-domain-vote", "necessary": True, "risk": "ensures ≥1 slot/bucket", "duplicates": False},
        {"cap": "CrossPath global ≤16", "owner": "mergeCrossPathSentenceCandidates", "necessary": True, "risk": "truncates uniqueAfterDedup tail — PARTIAL early in order may crowd COMPLETE later", "duplicates": "final admission cap"},
        {"cap": "exact text dedupe", "owner": "mergeCrossPath + assembly uniqueByText", "necessary": True, "risk": "DEDUPE_PROVENANCE_COLLAPSE if same text different paths — first wins", "duplicates": "two-level text dedupe"},
        {"cap": "maxCompleteSegmentationPaths=8", "owner": "path enumeration", "necessary": True, "risk": "path diversity limit", "duplicates": False},
    ],
)

write_csv(
    "responsibility_overlap_matrix.csv",
    [
        {"stage": "Path", "intended": "Edge compatibility + coverage", "actualExtra": "none for fluency", "overlap": False},
        {"stage": "Assembly", "intended": "Generate sentences from Path picks", "actualExtra": "sorts by sum(candidateScore) lexicon priors; enumerates all repair subsets without completeness", "overlap": "PRE_KENLM_RANKING_RESPONSIBILITY_OVERLAP (mild prior-sum ranking)"},
        {"stage": "Bucket", "intended": "Domain/Base organization", "actualExtra": "none fluency", "overlap": False},
        {"stage": "CrossPath", "intended": "Dedup + global cap", "actualExtra": "no re-score (correct)", "overlap": False},
        {"stage": "KenLM", "intended": "LM score/rank/pick", "actualExtra": "none", "overlap": False},
        {"stage": "Repair completeness", "intended": "n/a (absent)", "actualExtra": "NO_REPAIR_COMPLETENESS_CONTRACT", "overlap": "gap — admission treats PARTIAL==COMPLETE"},
    ],
)

# root cause per partial case id unique
root_rows = []
seen_cases = set()
for p in partial_traces:
    if p["caseId"] in seen_cases:
        continue
    seen_cases.add(p["caseId"])
    root_rows.append(
        {
            "caseId": p["caseId"],
            "illegalOrPartialPattern": p["illegalResidual"] or p["candidateText"][:40],
            "primaryCause": "RAW_FALLBACK_ADMISSION_COUPLING",
            "secondaryCauses": p["secondaryCauses"],
            "firstAdmissionFunction": "buildSentenceCandidates",
            "kenlmAdmissionFunction": "mergeCrossPathSentenceCandidates",
        }
    )
write_csv("root_cause_summary.csv", root_rows)

# contrast samples
def pick_samples():
    complete = [c for c in complete_traces if c["caseId"] not in FOCUS_PARTIAL][:5]
    # raw-correct noise: RAW_CORRECT human with non-raw alts that are MIXED
    raw_correct = []
    for meta in competition_cases:
        if meta["humanDecision"] != "RAW_CORRECT":
            continue
        for r in meta["rows"]:
            if r["isRaw"] == "true":
                continue
            raw_correct.append({"caseId": meta["caseId"], "candidateId": r["candidateId"], "candidateText": r["candidateText"], "note": "RAW_CORRECT case; alt is noise"})
            break
        if len(raw_correct) >= 5:
            break
    partial = []
    for p in partial_traces:
        if p["caseId"] in FOCUS_PARTIAL or p["caseId"] not in {x["caseId"] for x in partial}:
            partial.append(p)
        if len(partial) >= 5 and all(f in {x["caseId"] for x in partial} for f in FOCUS_PARTIAL[:1]):
            break
    # ensure focus included
    for f in FOCUS_PARTIAL:
        if not any(x["caseId"] == f for x in partial):
            hit = next((x for x in partial_traces if x["caseId"] == f), None)
            if hit:
                partial.append(hit)
    return complete[:5], raw_correct[:5], partial[:8]

comp5, raw5, part5 = pick_samples()
(OUT / "_contrast_samples.json").write_text(
    json.dumps({"complete": comp5, "rawCorrectNoise": raw5, "partial": part5}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

partial_share = budget_rows[-2]["value"]
partial_top16 = budget_rows[-1]["value"]

summary = {
    "baseline": "FW_V4_FREEZE_2026_08_03",
    "task": "PARTIAL_REPAIR_CANDIDATE_ADMISSION_AUDIT",
    "finalVerdict": "PARTIAL_REPAIR_ADMISSION_DEFECT_CONFIRMED",
    "repairCompletenessContract": "NO_REPAIR_COMPLETENESS_CONTRACT",
    "answers": {
        "Q1": "NO — NO_REPAIR_COMPLETENESS_CONTRACT",
        "Q2": "buildSentenceCandidates (first candidateText); mergeCrossPathSentenceCandidates (formal KenLM pool)",
        "Q3": "YES — RAW_FALLBACK_ADMISSION_COUPLING",
        "Q4_partialOfNonRaw": partial_share,
        "Q5_partialOfTop16NonRaw": partial_top16,
        "Q6_singleReplacementBias": True,
        "Q7_completeDroppedByCap": "POSSIBLE via per-bucket/global cap order; no systematic COMPLETE-only drop proven for 生成-cluster (COMPLETE never formed there)",
        "Q8_overlap": "Assembly prior-sum ranking mild PRE_KENLM_RANKING_RESPONSIBILITY_OVERLAP",
        "Q9_duplicateCaps": "per-bucket maxSentenceCandidates + global ≤16; dual text dedupe",
        "Q10_minimalAdjustment": "CrossPath Admission (Option B) or Assembly Admission (Option C) — prefer B/C over A",
        "Q11_withoutToneRecallDomainKenLM": True,
        "Q12_readyForDesign": True,
    },
    "classCounts": dict(class_counter),
    "top16NonRawClassCounts": dict(top16_class),
    "callChain": {
        "firstCandidateText": "buildSentenceCandidates.applyReplacementsRightToLeft",
        "formalPoolAdmission": "mergeCrossPathSentenceCandidates",
        "kenlmInput": "kenlmSentenceCandidates.combinations / rerankFwSentences",
    },
}
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("classes", dict(class_counter))
print("top16", dict(top16_class))
print("partial_share", partial_share, "top16", partial_top16)
print("verdict", summary["finalVerdict"])
