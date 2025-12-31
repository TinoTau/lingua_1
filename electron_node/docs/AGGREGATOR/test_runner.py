#!/usr/bin/env python3
"""
Run aggregator decision tests using aggregator_decision.py.

Usage:
  python test_runner.py test_vectors.json
"""
import json
import sys
from aggregator_decision import (
    UtteranceInfo, LangProbs,
    decide_stream_action,
)

def load_u(d):
    return UtteranceInfo(
        text=d["text"],
        start_ms=int(d["start_ms"]),
        end_ms=int(d["end_ms"]),
        lang=LangProbs(**d["lang"]),
        quality_score=d.get("quality_score"),
        is_final=bool(d.get("is_final", False)),
        is_manual_cut=bool(d.get("is_manual_cut", False)),
    )

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "test_vectors.json"
    data = json.load(open(path, "r", encoding="utf-8"))
    ok = 0
    for case in data:
        prev = load_u(case["prev"]) if case.get("prev") else None
        curr = load_u(case["curr"])
        mode = case["mode"]
        got = decide_stream_action(prev, curr, mode)
        exp = case.get("expected_action")
        passed = (exp is None) or (got == exp)
        print(f'{case["id"]}: got={got} expected={exp} -> {"PASS" if passed else "FAIL"}')
        if passed:
            ok += 1
    total = len(data)
    print(f"\\nSummary: {ok}/{total} passed")
    if ok != total:
        sys.exit(1)

if __name__ == "__main__":
    main()
