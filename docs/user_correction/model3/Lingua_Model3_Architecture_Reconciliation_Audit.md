# Lingua — Model3 Architecture Reconciliation / Drift Closure Audit

Generated: 2026-09-03T19:59:06Z  
Phase: `MODEL3_ARCHITECTURE_RECONCILIATION_AND_DRIFT_CLOSURE`  
Mode: READ-ONLY — no production / training / architecture change

================================
EXECUTIVE VERDICT
=================

**MODEL3_ARCHITECTURE_RECONCILIATION_PASS_WITH_ACTIVE_DELTAS**

Next phase (exactly one): `MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN`

**Authoritative baseline restored as documents + ownership map + 2 production deltas.**  
Stop incremental causal-debug chasing. Do not treat S3 audit freezes as competing architecture SSOT.

Active production deltas: **2**  
Retracted / audit-only / model-quality claims: **15** (see CSV)

================================
SSOT AUTHORITY MAP
==================

Authority order enforced:

1. User-approved / explicitly frozen business architecture (Lattice + Model3 contracts)
2. Explicit ACP approved by user
3. Later implementation consistent with 1/2 (mainline integration; multipath Retry fix)
4. Current production code
5. Tests
6. Comments / local docs
7. Audit-only tooling / metrics

See `model3_architecture_authority_map.csv`.

**ONE architecture SSOT stack:** Lattice FROZEN + `MODEL3_ARCHITECTURE_CONTRACT_V1` + `MODEL3_SYNTHETIC_V1_FROZEN` + `model3_retry_contract_v1` (+ anchor/input/output).

Recent `model3_v2_s3_*_freeze_state.csv` files: **EVIDENCE_ONLY** — may record measurements; must not redefine KEEP barrier, Domain Vote scope, or Model3 role.

================================
FROZEN ARCHITECTURE CHECK
=========================

| Gate | Result |
|------|--------|
| Model3 KEEP/RETRY only | PASS |
| No Model3 Lexicon/Recall/text repair | PASS |
| One Model3 STAGE (multipath ok); no Retry re-infer | PASS |
| One Domain Vote / path; no Retry re-vote | PASS |
| One bounded Retry; no recursive; no ASR rerun | PASS |
| No Anchor / unrelated KEEP cross by default | PASS |
| Multipath regional views | PASS (preferred-path removed) |
| Candidate pool ≤16 | PASS |
| JobResult transport-only | PASS |
| Stage-2 sliding windows | **FAIL — ACTIVE DELTA** |
| Fallback non-locking reinterpretation | **FAIL — ACTIVE DELTA** |

================================
CURRENT RETRY / MODEL3 CALL GRAPH
=================================

```text
ASR→FineSpan lattice(windows1..5)→pathFineSpanViews→Model2→path Domain Vote→Anchors→Model3 KEEP/RETRY→deriveRetryRegions→resegment(lattice|fallback)→Stage-2 localSpan queries→recallSpanTopKV2→merge→Assembly(same vote)→CrossPath≤16→KenLM→Apply→JobResult
```

Semantic continuity first loss: **Retry Stage-2 (RAW_RECALL) discards sliding-window semantics present in regional lattice Stage-1**

Producer→consumer example:

| Boundary | Producer guarantee | Consumer transformation | Preserved? |
|----------|--------------------|-------------------------|------------|
| Lattice Stage-1 → PathFineSpan | Sliding windows 1..5 → edges → paths | Path FineSpans **non-overlapping** segmentation | Windows consumed into edges; path is segmentation SSOT |
| Regional resegment → Stage-2 | Lattice again builds windows on slice | Stage-2 queries **localSpans only** | **DISCARDED** at Stage-2 |
| Fallback | Region bounds known | Copy first-pass FineSpan bounds | **REINTERPRETED as lock** |

================================
RESPONSIBILITY / OWNERSHIP MAP
==============================

See ownership rows in summary JSON / implied by `model3_current_vs_ssot.csv`.

Notable: query enumeration **WRONG_OWNER** (should reuse window builder); barrier / query-key **DUPLICATED_OWNERSHIP** (mild).

================================
CURRENT VS SSOT TABLE
=====================

See `model3_current_vs_ssot.csv` (required area table).

================================
DRIFT CLASSIFICATION COUNTS
===========================

| Category | Count |
|----------|------:|
| runtimeArchitectureDrift | 2 |
| runtimeImplementationBug | 0 |
| staleCode | 0 |
| duplicatedProductionLogic | 2 |
| auditSemanticDrift | 5 |
| testMetricDrift | 1 |
| documentSsotDrift | 3 |
| modelQualityFailure | 1 |
| unresolved | 1 |

Only the first four justify production correction. Active backlog uses **runtimeArchitectureDrift=2**.

================================
HISTORICAL DRIFT RECONCILIATION
===============================

| Claim | Production? | Class | Status |
|-------|-------------|-------|--------|
| Stage-2 no sliding | YES | RUNTIME_ARCHITECTURE_DRIFT | ACTIVE |
| Fallback FineSpan lock | YES | RUNTIME_ARCHITECTURE_DRIFT | ACTIVE |
| KEEP_ON_LOCUS | NO | MODEL_QUALITY_FAILURE | SEPARATE track |
| preferred-path | NO | ALREADY_FIXED | CLOSED |
| second Domain Vote / Model3 / recursive / ASR | NO | ABSENT | CLOSED |
| Lexicon circular / Lex148 | NO | AUDIT_SEMANTIC_DRIFT | FIXED in audit |
| surface families | NO | AUDIT_SEMANTIC_DRIFT | SUPERSEDED |
| Recall LOCAL/GENERAL conflict | NO | DOCUMENT_SSOT_DRIFT | CORRECTED LOCAL |
| NO_PRIMARY_TARGET_MAP | NO | AUDIT_SEMANTIC_DRIFT | FIXED |
| ref region = lexical target | NO | AUDIT_SEMANTIC_DRIFT | FIXED |
| 70% system prevalence | NO | TEST_METRIC_DRIFT | RETRACTED |
| utterance singleton Vote | NO | DOCUMENT_SSOT_DRIFT | RETRACTED |

================================
MODEL3 KEEP AUDIT
=================

Trace: FineSpan exists → correct path → non-Anchor → packer → infer → map by spanId → KEEP.

**Architecture contracts: OK.**  
Classification: **MODEL_QUALITY_FAILURE** (not RUNTIME_ARCHITECTURE_DRIFT).  
Do **not** modify KEEP barrier or Model3 role this phase. Separate Unit #3 later.

================================
RETRY STAGE-2 / FALLBACK
========================

D15 NO sliding at Stage-2 → **RUNTIME_ARCHITECTURE_DRIFT**.  
D16 fallback restores old FineSpan bounds → **RUNTIME_ARCHITECTURE_DRIFT**.

================================
ACTIVE PRODUCTION DELTAS
========================

Exactly **2** — see `model3_active_production_deltas.csv`.

1. `DELTA_RQ_STAGE2_NO_SLIDING`  
2. `DELTA_RQ_FALLBACK_BOUNDARY_LOCK`

No ACP required (SSOT restoration / deletion+reuse).

================================
RETRACTED / AUDIT-ONLY
=====================

See `model3_retracted_and_audit_only_issues.csv`.

================================
CONTROL-VARIABLE PLAN
=====================

See `model3_control_variable_plan.csv`.

| Unit | Variable | ACP |
|------|----------|-----|
| #1 Stage-2 SSOT restoration | query enum source only | NO |
| #2 Fallback lock removal | fallback query authority only | NO |
| #3 Model3 quality audit | model quality only | NO for audit |

**Do not combine** Model3 trigger correction with Retry query correction.

================================
DOCUMENT / FREEZE CLEANUP
=========================

| Item | Action |
|------|--------|
| Lattice + Model3 contracts | RETAIN AUTHORITATIVE |
| S3 freeze_state CSVs | DEMOTED_TO_EVIDENCE_ONLY |
| matrix "retry not enabled" | SUPERSEDED / STALE |
| "≤1 inference/utterance" literal | STALE_WORDING → STAGE language |
| S3 audit MDs as architecture | DEMOTED AUDIT_ONLY |

================================
CODE SIMPLICITY
===============

| Item | Action |
|------|--------|
| Stage-2 localSpan-only loop | DELETE assumption / REUSE window builder |
| fallbackRegionLocalSpans as query source | DELETE |
| query-key formula copy | REUSE window-construction-core |
| barrier dual sites | KEEP for now (optional later collapse) |
| preferred-path | already DELETED |
| config flags for frozen arch | ABSENT — do not add |

No new RepairManager / GeometryCoordinator / second query service.

================================
NEXT PHASE
==========

`MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN`

Exactly one. Design-only next; this phase implements nothing.

---

## D1–D40

{
  "D1": "YES — KEEP|RETRY only",
  "D2": "NO — does not query Lexicon/generate text/vote domain/create spans",
  "D3": "NO — does not override KEEP; KEEP breaks merge",
  "D4": "NO — Anchor masked + skipped",
  "D5": "NO by default — KEEP flush",
  "D6": "YES — one bounded Retry operation / path step",
  "D7": "NO",
  "D8": "NO",
  "D9": "NO post-Retry Model3; one STAGE evaluates multipath via path loop",
  "D10": "NO",
  "D11": "YES — once per retained path",
  "D12": "YES — multipath regional views unioned",
  "D13": "YES upstream lattice windows; path FineSpans non-overlapping by design",
  "D14": "First lost at Retry Stage-2 consumer: regional Stage-1 windows not re-enumerated for RAW_RECALL",
  "D15": "NO",
  "D16": "YES — fallbackRegionLocalSpans",
  "D17": "YES — both RUNTIME_ARCHITECTURE_DRIFT",
  "D18": "NO",
  "D19": "MODEL_QUALITY_FAILURE (or EXPECTED_MODEL_ERROR)",
  "D20": "NO evidence of packer/mapping SSOT violation",
  "D21": "YES — Recall intact; do not retune to hide geometry",
  "D22": "NO — not active causal owner for current Query Geometry cohort",
  "D23": "NO — LIMITED only",
  "D24": 2,
  "D25": [
    "DELTA_RQ_STAGE2_NO_SLIDING",
    "DELTA_RQ_FALLBACK_BOUNDARY_LOCK"
  ],
  "D26": 12,
  "D27": [
    "KEEP_ON_LOCUS as architecture drift",
    "KEEP barrier as bug",
    "utterance singleton Domain Vote required",
    "preferred-path active",
    "second Domain Vote / Model3 / recursive / ASR",
    "Lexicon prevalence=0",
    "surface families as structural proof",
    "Recall PROVEN_GENERAL from surfaces",
    "70% as system prevalence",
    "continue causal-localization as baseline next"
  ],
  "D28": "Lattice FROZEN + MODEL3_ARCHITECTURE_CONTRACT_V1 + SYNTHETIC_V1_FROZEN + retry/anchor/input/output contracts",
  "D29": "retry 'not enabled' matrix note; ≤1 inference/utterance literal; TTS next-phase docs; many S3 audits as architecture SSOT",
  "D30": "model3_v2_s3_*_freeze_state.csv / corrected_freeze_state / retry_query_freeze_state — evidence status only",
  "D31": "YES — barrier split; query-key formula copy; Stage-1 vs Stage-2 enum divergence",
  "D32": "YES — delete localSpan-only + fallback lock; reuse buildLexicalWindowQueries",
  "D33": "NO for active deltas (SSOT restoration)",
  "D34": "MODEL3_RETRY_STAGE2_SSOT_RESTORATION (design then develop)",
  "D35": "Stage-2 query enumeration source only",
  "D36": "before: Stage-2 queries==localSpans; after: Stage-2 consumes region-slice sliding windows; barriers unchanged",
  "D37": "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_REMOVAL (unit2)",
  "D38": "YES",
  "D39": "NO",
  "D40": "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN"
}
