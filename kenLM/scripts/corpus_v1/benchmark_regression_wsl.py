#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Corpus V1 Wikipedia-only: score KENLM_BENCHMARK_V1 with new trie via kenlm query (WSL)."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/mnt/d/Programs/github/lingua_1")
sys.path.insert(0, str(ROOT / "scripts" / "kenlm"))
from lib.tokenize_char import tokenize_line  # noqa: E402

BENCH = ROOT / "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
OUT = ROOT / "docs/acceptance/Development/2026-08-04_KenLM_Corpus_Rebuild_V1"
OLD_MODEL = ROOT / "electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin"
NEW_MODEL = ROOT / "kenLM/model/corpus_v1/zh_char_3gram.trie.bin"
QUERY = ROOT / "kenLM/kenlm/build/bin/query"
TRAIN_META = ROOT / "kenLM/model/corpus_v1/training_meta.json"
CORPUS_STATS = ROOT / "kenLM/corpus/v1/corpus_v1.stats.json"

OUT.mkdir(parents=True, exist_ok=True)


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def score_batch(model: Path, sentences: list[str]) -> list[float]:
    """KenLM query -v summary: last line Total: <score> ..."""
    toks = [tokenize_line(s) for s in sentences]
    payload = "\n".join(toks) + "\n"
    proc = subprocess.run(
        [str(QUERY), str(model)],
        input=payload.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=180,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", "replace")[:500])
    out = proc.stdout.decode("utf-8", "replace")
    scores: list[float] = []
    for line in out.splitlines():
        m = re.search(r"Total:\s*([-+eE0-9.]+)", line)
        if m:
            scores.append(float(m.group(1)))
    if len(scores) != len(sentences):
        raise RuntimeError(f"expected {len(sentences)} scores, got {len(scores)}\n{out[-800:]}")
    return scores


def preferred_id(cands, human):
    alts = sorted([c for c in cands if c["isRaw"] != "true"], key=lambda x: x["candidateId"])
    if human == "RAW_CORRECT":
        for c in cands:
            if c["isRaw"] == "true":
                return c["candidateId"]
    if human == "CANDIDATE_1":
        return alts[0]["candidateId"] if alts else None
    if human == "CANDIDATE_2":
        return alts[1]["candidateId"] if len(alts) > 1 else None
    return None


def matches(top1, cands, human):
    if human in ("ALL_WRONG", "UNDECIDABLE"):
        return None
    if human == "MULTIPLE_OK":
        alts = sorted([c for c in cands if c["isRaw"] != "true"], key=lambda x: x["candidateId"])
        ok = {c["candidateId"] for c in cands if c["isRaw"] == "true"}
        ok.update(a["candidateId"] for a in alts[:2])
        return top1["candidateId"] in ok
    pref = preferred_id(cands, human)
    return top1["candidateId"] == pref if pref else None


def rank(cands, scores):
    ranked = [{**c, "score": scores[i]} for i, c in enumerate(cands)]
    ranked.sort(key=lambda x: x["score"], reverse=True)
    for i, r in enumerate(ranked):
        r["rank"] = i + 1
    return ranked


def main() -> int:
    rows = list(csv.DictReader(BENCH.open(encoding="utf-8")))
    by = {}
    for r in rows:
        by.setdefault(r["benchmarkId"], []).append(r)
    ids = sorted(by)

    old_sha = sha256(OLD_MODEL)
    new_sha = sha256(NEW_MODEL)
    print("old", old_sha)
    print("new", new_sha)

    # warmup
    score_batch(NEW_MODEL, ["你好世界"])

    regression = []
    ranking_diff = []
    improved = regressed = unchanged = 0
    correct_before = correct_after = 0

    for i, bid in enumerate(ids):
        cands = by[bid]
        human = cands[0]["humanDecision"]
        texts = [c["candidateText"] for c in cands]
        old_scores = [float(c["lmScore"]) for c in cands]
        new_scores = score_batch(NEW_MODEL, texts)
        old_r = rank(cands, old_scores)
        new_r = rank(cands, new_scores)
        m_old = matches(old_r[0], cands, human)
        m_new = matches(new_r[0], cands, human)
        if m_old is not None:
            if m_old:
                correct_before += 1
            if m_new:
                correct_after += 1
            if m_old == m_new:
                unchanged += 1
                delta = "UNCHANGED"
            elif (not m_old) and m_new:
                improved += 1
                delta = "IMPROVED"
            else:
                regressed += 1
                delta = "REGRESSED"
        else:
            unchanged += 1
            delta = "UNCHANGED_NA"

        for c in cands:
            o = next(x for x in old_r if x["candidateId"] == c["candidateId"])
            n = next(x for x in new_r if x["candidateId"] == c["candidateId"])
            ranking_diff.append(
                {
                    "benchmarkId": bid,
                    "caseId": c["caseId"],
                    "candidateId": c["candidateId"],
                    "isRaw": c["isRaw"],
                    "oldRank": o["rank"],
                    "newRank": n["rank"],
                    "oldScore": o["score"],
                    "newScore": n["score"],
                    "rankDelta": o["rank"] - n["rank"],
                    "humanDecision": human,
                }
            )
        pref = preferred_id(cands, human)
        op = next((d for d in ranking_diff if d["benchmarkId"] == bid and d["candidateId"] == pref), None)
        regression.append(
            {
                "benchmarkId": bid,
                "oldRank": op["oldRank"] if op else "",
                "newRank": op["newRank"] if op else "",
                "oldScore": op["oldScore"] if op else "",
                "newScore": op["newScore"] if op else "",
                "winnerChanged": old_r[0]["candidateId"] != new_r[0]["candidateId"],
                "humanDecision": human,
                "correctBefore": m_old is True,
                "correctAfter": m_new is True,
                "caseId": cands[0]["caseId"],
                "deltaClass": delta,
            }
        )
        if i % 10 == 0:
            print(f"scored {i+1}/{len(ids)}")

    train = json.loads(TRAIN_META.read_text(encoding="utf-8"))
    corpus = json.loads(CORPUS_STATS.read_text(encoding="utf-8")) if CORPUS_STATS.exists() else {}
    better = correct_after > correct_before and improved > regressed
    verdict = "KENLM_CORPUS_V1_READY" if better else "KENLM_CORPUS_V1_NOT_BETTER"

    def write_csv(path: Path, fieldnames, rows_):
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(rows_)

    write_csv(
        OUT / "benchmark_regression.csv",
        [
            "benchmarkId",
            "oldRank",
            "newRank",
            "oldScore",
            "newScore",
            "winnerChanged",
            "humanDecision",
            "correctBefore",
            "correctAfter",
            "caseId",
            "deltaClass",
        ],
        regression,
    )
    write_csv(
        OUT / "ranking_diff.csv",
        [
            "benchmarkId",
            "caseId",
            "candidateId",
            "isRaw",
            "oldRank",
            "newRank",
            "oldScore",
            "newScore",
            "rankDelta",
            "humanDecision",
        ],
        ranking_diff,
    )
    write_csv(
        OUT / "corpus_statistics.csv",
        ["metric", "value"],
        [
            {"metric": "wikipediaSentences", "value": corpus.get("perSource", {}).get("wikipedia_sentences", train.get("corpusLines"))},
            {"metric": "oscarSentences", "value": 0},
            {"metric": "oscarNote", "value": "abandoned_gated_pending_wikipedia_only"},
            {"metric": "corpusSentenceCount", "value": corpus.get("sentenceCount", train.get("corpusLines"))},
            {"metric": "corpusTokenCount", "value": corpus.get("tokenCount", train.get("tokenCount"))},
            {"metric": "corpusVocabularySize", "value": corpus.get("vocabularySize", "")},
            {"metric": "arpaVocabularySize", "value": train.get("vocabularySize")},
            {"metric": "minChars", "value": 4},
            {"metric": "maxChars", "value": 256},
        ],
    )
    write_csv(
        OUT / "training_statistics.csv",
        ["metric", "value"],
        [
            {"metric": "corpusLines", "value": train["corpusLines"]},
            {"metric": "tokenCount", "value": train["tokenCount"]},
            {"metric": "vocabularySize", "value": train["vocabularySize"]},
            {"metric": "ngramCountSum", "value": train["ngramCountSum"]},
            {"metric": "ngramCountsByOrder", "value": json.dumps(train["ngramCountsByOrder"])},
            {"metric": "arpaSizeBytes", "value": train["arpaSizeBytes"]},
            {"metric": "binarySizeBytes", "value": train["binarySizeBytes"]},
            {"metric": "binarySha256", "value": new_sha},
            {"metric": "oldBinarySha256", "value": old_sha},
            {"metric": "discountFallback", "value": True},
            {"metric": "correctBefore", "value": correct_before},
            {"metric": "correctAfter", "value": correct_after},
            {"metric": "improved", "value": improved},
            {"metric": "regressed", "value": regressed},
            {"metric": "unchanged", "value": unchanged},
        ],
    )

    summary = {
        "baseline": "FW_V4_FREEZE_2026_08_03",
        "benchmark": "KENLM_BENCHMARK_V1",
        "task": "KENLM_CORPUS_REBUILD_V1",
        "sourcesPolicy": "wikipedia_only_oscar_abandoned",
        "finalVerdict": verdict,
        "answers": {
            "Q1_wikipediaSentences": corpus.get("perSource", {}).get("wikipedia_sentences", train["corpusLines"]),
            "Q2_oscarSentences": 0,
            "Q2_oscarNote": "OSCAR abandoned (gated); Wikipedia only",
            "Q3_vocabulary": train["vocabularySize"],
            "Q4_trieBinaryBytes": train["binarySizeBytes"],
            "Q5_improved": improved,
            "Q5_regressed": regressed,
            "Q6_recommendReplace": better,
        },
        "metrics": {
            "correctBefore": correct_before,
            "correctAfter": correct_after,
            "improved": improved,
            "regressed": regressed,
            "unchanged": unchanged,
        },
        "models": {"oldSha": old_sha, "newSha": new_sha, "newPath": str(NEW_MODEL), "productionReplaced": False},
        "trainMeta": train,
        "corpusStats": corpus,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    report = f"""# FW Repair V4 — KenLM Corpus Rebuild V1

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | FW_V4_FREEZE_2026_08_03 |
| Benchmark | KENLM_BENCHMARK_V1（未改标注） |
| Sources | **Wikipedia only**（OSCAR 放弃） |
| Verdict | **{verdict}** |

## Answers

### Q1 Wikipedia 最终保留多少句？
**{summary['answers']['Q1_wikipediaSentences']}**

### Q2 OSCAR 最终保留多少句？
**0**（本轮放弃 OSCAR）

### Q3 最终 Vocabulary？
**{train['vocabularySize']}**

### Q4 Trie Binary 大小？
**{train['binarySizeBytes']}** bytes

### Q5 Benchmark 提升 / 下降？
提升 **{improved}** · 下降 **{regressed}**（Correct {correct_before}→{correct_after}）

### Q6 是否建议替换生产模型？
**{'YES' if better else 'NO'}**

## Training

| Metric | Value |
|--------|------:|
| Sentences | {train['corpusLines']} |
| Tokens | {train['tokenCount']} |
| Vocab | {train['vocabularySize']} |
| N-Gram Σ | {train['ngramCountSum']} |
| ARPA | {train['arpaSizeBytes']} |
| Trie | {train['binarySizeBytes']} |
| Order | 3 |
| Discount | MKN + discount_fallback |

Production **not** replaced.

## Final Verdict

```text
{verdict}
```
"""
    (OUT / "report.md").write_text(report, encoding="utf-8")
    (OUT / "README.md").write_text(
        f"# KenLM Corpus Rebuild V1\n\nVerdict: **{verdict}**\n\nWikipedia-only (OSCAR abandoned).\n\nSee report.md / summary.json.\n",
        encoding="utf-8",
    )
    print(json.dumps(summary["answers"], ensure_ascii=False, indent=2))
    print("finalVerdict", verdict)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
