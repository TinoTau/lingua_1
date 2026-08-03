# 11 — KenLM Runtime Boundary

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |
| Validation interface | **READY** |
| Quality | **NOT YET PASSED** · CAPABILITY_VALIDATION_PENDING |

---

## Ownership

| KenLM MAY | KenLM MUST NOT |
|-----------|----------------|
| Score | Recall |
| Rank | Domain Vote |
| Pick (`raw_log_delta` + gate) | Sentence Assembly |
| | Generate candidates |

---

## Frozen I/O

| Item | Contract |
|------|----------|
| Input | CrossPath sentence candidates ≤16 + rawText always in score batch |
| scoreMode | `raw_log_delta` |
| Output | score · deltaVsRaw · rank · TopK · pick |
| Gate | `minDeltaToReplace` boundary frozen (value not changed this snapshot) |

---

## Diagnostic Limitations (not quality blockers)

```text
candidate:i 与上游 candidateId 未完整一一映射
sourcePath / bucketDomain 在 KenLM export 中可能缺失
candidate-level validation export 仍需下一阶段完善
```

**Do not read readiness as quality acceptance.**

Authority: `docs/fw-detector/kenlm/KENLM_RUNTIME.md` ·  
`docs/tone-v2/FW_Repair_V4_KenLM_Validation_Readiness_Audit_2026_08_02.md`
