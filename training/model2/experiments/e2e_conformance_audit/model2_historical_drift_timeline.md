# Model2 Historical Drift Timeline

| Phase | Intended responsibility | Actual implementation | Drift? |
|-------|-------------------------|----------------------|--------|
| Initial 2026-08-11 Design | Fine Span parallel User-Conditioned Fuzzy Recall; 扩大候选召回 | Spec only | MIXED wording also “改变 ranking” |
| Arch SSOT 2026-08-12 | Hybrid: Fuzzy Pre-Pool expands; Model2 ranks in pool | Formal Hybrid decision §13 | YES — Model2 learning = pool ranker |
| Phase 5 | FuzzyPool + Stage A dual-encoder | Closed-set CE on pool; “Recall@K” = rerank | YES — METRIC_NAMING_DRIFT |
| Phase 6/6C | User×Relation binding | ConditionGain / RankΔ gates | YES — binding ≠ introduction |
| Phase 7A–7C | Baseline binding + Stage A attribution | Same closed-set | YES |
| Phase 7D | Audit product vs code | CURRENT=CLOSED-SET RANKER; PARTIAL_REBUILD | ALIGNED audit |
| Phase 7E | Deterministic profile retrieval spike | Span syllables / trainrow spans; TIR high on applicable | PARTIAL restore of recall |
| Phase 7F | Realistic boundary | REAL_ASR = **whole utterance G2P** as query → TIR≈0 → OBSERVABILITY_LIMIT | **CRITICAL TEST_PATH_INVALID** |

Evidence files: Design §1 L12; Arch audit §13; `run_phase7f_realistic_boundary.py` `build_real_asr_samples`; E2E `span_reference_vs_phase7f.json`.
