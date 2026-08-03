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
| Score | Recall / Window / Tone fix |
| Rank | Domain Vote |
| Pick (`raw_log_delta` + gate) | Sentence Assembly |
| | Generate missing words |
| | Redo pinyin recall |
| | Supplement Lexicon |
| | Invent candidates that CrossPath did not produce |

---

## Input / Responsibility

```text
KenLM Input  = CrossPath 已生成的句子候选（含 Raw）
KenLM 职责   = Score · Rank · Pick
```

Candidate generation ends **before** KenLM. Missing repair candidates are **upstream** (Recall / Tone / Lexicon), not KenLM defects.

---

## Competition requirement

```text
Only cases with candidateCount >= 2 (real competition)
have KenLM ranking evaluation value.

Raw-only cases:
MUST NOT be used to judge KenLM ranking capability.
```

Do **not** require “all Tone-error cases must recover first” before starting KenLM capability work.  
Next stage uses dialog_200 / real Runtime Trace cases that **naturally** contain Raw + non-Raw candidates.

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
Supporting Recall freeze: `docs/supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md`
