# Pinyin IME Spike Report (auto)

Generated: 2026-06-02T19:20:50.541Z

## Freeze Gate

| Check | Threshold | Result |
|-------|-----------|--------|
| Detector Miss top5 | > 15% | FAIL (0.0%, n=102) |
| Recall Empty top3 | > 25% | FAIL (NaN%, n=0) |
| IME P95 latency | < 200ms | PASS (1ms) |

**Recommend mainline:** NO

## By Subset

```json
{
  "all": {
    "count": 184,
    "top1": 0,
    "top3": 0,
    "top5": 0,
    "top10": 0,
    "refInDiff": 0,
    "kenlmWouldApply": 0,
    "imeMs": {
      "avg": 0,
      "p50": 0,
      "p95": 1
    }
  },
  "detector_miss": {
    "count": 102,
    "top1": 0,
    "top3": 0,
    "top5": 0,
    "top10": 0,
    "refInDiff": 0,
    "kenlmWouldApply": 0,
    "imeMs": {
      "avg": 0,
      "p50": 0,
      "p95": 1
    }
  },
  "recall_empty": {
    "count": 0
  },
  "lexicon_missing": {
    "count": 183,
    "top1": 0,
    "top3": 0,
    "top5": 0,
    "top10": 0,
    "refInDiff": 0,
    "kenlmWouldApply": 0,
    "imeMs": {
      "avg": 0,
      "p50": 0,
      "p95": 1
    }
  }
}
```

## Failure classes

```json
{
  "ok": 183,
  "english_mixed": 1
}
```
