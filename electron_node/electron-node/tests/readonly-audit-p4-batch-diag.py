#!/usr/bin/env python3
import json
from pathlib import Path
from collections import Counter

p = Path(r"D:\Programs\github\lingua_1\electron_node\electron-node\tests\lexicon-v2-p4-batch-result.json")
report = json.loads(p.read_text(encoding="utf-8"))

domain_hits = []
active_domains = []
merge_before = []
span_jobs = 0
for c in report["cases"]:
    d = c.get("recall_v2_diagnostics")
    if not d:
        continue
    for s in d.get("spans") or []:
        span_jobs += 1
        domain_hits.append(s.get("domain_hits", 0))
        active_domains.append(s.get("active_domain", ""))
        merge_before.append(s.get("candidate_count_before_merge", 0))

print("=== P4 BATCH RECALL DIAGNOSTICS AGGREGATE ===")
print("span recall invocations:", span_jobs)
print("domain_hits max:", max(domain_hits) if domain_hits else None)
print("domain_hits sum:", sum(domain_hits))
print("domain_hits>0 count:", sum(1 for x in domain_hits if x > 0))
print("active_domain distribution:", dict(Counter(active_domains)))
print("candidate_count_before_merge avg:", sum(merge_before)/len(merge_before) if merge_before else 0)

sr_jobs = [c for c in report["cases"] if c.get("sentence_rerank")]
print("\n=== SENTENCE RERANK ===")
print("jobs with sentence_rerank:", len(sr_jobs))
print("picked_raw:", sum(1 for c in sr_jobs if c["sentence_rerank"].get("pickedIsRaw")))
print("picked_candidate:", sum(1 for c in sr_jobs if not c["sentence_rerank"].get("pickedIsRaw")))
