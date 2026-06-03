# Pinyin IME V1 Report (auto)

Generated: 2026-06-02T21:45:46.155Z

## Single Char Dictionary

| Metric | Value |
|--------|-------|
| Loaded | YES |
| Total rows | 2510 |
| function_single_char | 79 |
| content_single_char | 698 |
| fallback rows | 2344 |
| Non-zero candidate cases | 84/117 |
| Fallback triggered (cases) | 57 |
| Beam break recovered (cases) | 57 |

## Freeze Gate

| Check | Threshold | Result |
|-------|-----------|--------|
| Detector Miss top5 | > 15% | FAIL (0.0%, n=78) |
| Recall Empty top3 | > 25% | FAIL (N/A%, n=0) |
| IME P95 latency | < 200ms | PASS (12ms) |

**Recommend mainline:** NO

## By Subset

```json
{
  "all": {
    "count": 117,
    "top1": 0,
    "top3": 0,
    "top5": 0,
    "top10": 0.0085,
    "refInDiff": 0.094,
    "kenlmWouldApply": 0,
    "nonZeroCandidates": 84,
    "imeMs": {
      "avg": 5,
      "p50": 4,
      "p95": 12
    }
  },
  "detector_miss": {
    "count": 78,
    "top1": 0,
    "top3": 0,
    "top5": 0,
    "top10": 0,
    "refInDiff": 0.0513,
    "kenlmWouldApply": 0,
    "nonZeroCandidates": 46,
    "imeMs": {
      "avg": 4,
      "p50": 3,
      "p95": 13
    }
  },
  "recall_empty": {
    "count": 0
  },
  "lexicon_missing": {
    "count": 87,
    "top1": 0,
    "top3": 0,
    "top5": 0,
    "top10": 0.0115,
    "refInDiff": 0.1264,
    "kenlmWouldApply": 0,
    "nonZeroCandidates": 84,
    "imeMs": {
      "avg": 6,
      "p50": 5,
      "p95": 12
    }
  }
}
```

## Failure classes

```json
{
  "diff_fail": 66,
  "ok": 21,
  "english_mixed": 30
}
```
