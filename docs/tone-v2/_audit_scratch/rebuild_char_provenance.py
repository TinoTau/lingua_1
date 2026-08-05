#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import csv
import json
from pathlib import Path

ROOT = Path("/mnt/d/Programs/github/lingua_1")
OUT = ROOT / "docs/acceptance/Audit/2026-08-05_Illegal_Surface_and_SameDomain_Bucket_Audit"
TRACE = ROOT / "docs/tone-v2/_audit_scratch/dialog200_sentence_assembly_trace"
rows = []
cases = ["d019", "d020", "d043", "d045", "d064", "d088", "d133", "d178"]
for cid in cases:
    t = json.loads((TRACE / f"{cid[1:]}.json").read_text(encoding="utf-8"))
    raw = t["rawText"]
    cands = t.get("uniqueBeforeCap") or []
    for ci, c in enumerate(cands):
        text = c.get("text") or ""
        if "生城" not in text and "声城" not in text:
            continue
        reps = c.get("replacements") or []
        covered = {}
        for r in reps:
            span = r.get("span") or {}
            s, e = span.get("start"), span.get("end")
            word = r.get("word") or ""
            src = r.get("source") or ""
            if s is None or e is None:
                continue
            for i in range(s, e):
                covered[i] = (word, src, s, e)
        for i, ch in enumerate(text):
            if i in covered:
                word, src, rs, re = covered[i]
                raw_span = raw[rs:re] if re <= len(raw) else ""
                if word != raw_span and word == "候选":
                    st = "DOMAIN_CANDIDATE"
                elif word == raw_span and src == "canonical_exact":
                    st = "RAW_PRESERVED"
                elif word == raw_span:
                    st = "LEXICON_TERM"
                else:
                    st = "LEXICON_TERM"
                surf = word
            else:
                st, surf, src, rs, re = "RAW_PRESERVED", ch, "implicit_raw", i, i + 1
            for big in ("生城", "声城"):
                p = text.find(big)
                if p <= i < p + 2:
                    st = "RAW_PRESERVED"
                    surf = ch
                    src = "single_char_fallback_or_canonical"
                    rp = raw.find(big)
                    if rp >= 0:
                        rs, re = rp + (i - p), rp + (i - p) + 1
            rows.append(
                {
                    "caseId": cid,
                    "sentenceCandidateId": f"{cid}:u{ci}",
                    "candidateText": text,
                    "charIndex": i,
                    "character": ch,
                    "rawStart": rs,
                    "rawEnd": re,
                    "sourceType": st,
                    "sourceCandidateId": "",
                    "sourceTermId": "exp-v1_1-alias-houxuan"
                    if surf == "候选" and st == "DOMAIN_CANDIDATE"
                    else "",
                    "sourceSurface": surf,
                    "edgeId": "",
                    "pathId": "",
                    "bucketId": "tech_ai",
                    "replacementId": f"{raw[rs:re]}→{surf}" if st == "DOMAIN_CANDIDATE" else "",
                }
            )

with (OUT / "character_provenance.csv").open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print("rows", len(rows))
for r in rows:
    if r["caseId"] == "d043" and r["sentenceCandidateId"].endswith(":u0") and 6 <= r["charIndex"] <= 11:
        print(r["charIndex"], r["character"], r["sourceType"], r["sourceSurface"], r["replacementId"])
