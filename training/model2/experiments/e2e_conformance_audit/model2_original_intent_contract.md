# Model2 Original Intent Contract

Markers: `E2E_CONFORMANCE_AUDIT` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` / `READ_ONLY`

Authority: `docs/user_correction/Lingua_Model2_User_Correction_Design_and_Audit_Prompts_2026_08_11.md` §1–§4

## Core responsibility

```text
Model2 only expands candidate recall at Fine Span Sliding Window.
Not final correction decision. Not second ASR. Not whole-utterance repair.
```

## Authoritative dataflow

```text
ASR → Fine Span Sliding Window
         ├─ Lexicon Exact Recall
         └─ Model2 User-Conditioned Fuzzy Recall
              ↓
         Candidate Merge
              ↓
         existing Domain Vote / Sentence Assembly / KenLM
```

## Input granularity

```text
FineSpan / keyword span  (NOT whole utterance as primary retrieval unit)
```

## Success condition

```text
target absent before Model2 → target introduced after Model2
```

## Non-responsibility

```text
second ASR | general ASR repair | whole-sentence pronunciation model |
sentence-level semantic model | large closed-set reranker as Model2 core
```
