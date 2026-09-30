/**
 * Emit ≤6 RetryRegion SSOT authority audit artifacts from frozen docs + C9 matrix rows.
 * PRODUCT_RUNTIME_CODE_CHANGED = NO
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT = path.join(REPO, 'docs', 'user_correction', 'model3');
const PHASE = 'LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT_V1';

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

const c9 = JSON.parse(fs.readFileSync(path.join(OUT, '_retry_region_c9_case_rows.json'), 'utf8'));
if (c9.length !== 23) {
  console.error('need 23 C9 rows, got', c9.length);
  process.exit(2);
}

const partial = c9.filter((r) => r.coverageClass === 'PARTIAL').length;
const none = c9.filter((r) => r.coverageClass === 'NONE').length;
const rCounts = { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0 };
for (const r of c9) {
  const k = r.classification.slice(0, 2);
  rCounts[k] = (rCounts[k] || 0) + 1;
}

// --- timeline ---
const timeline = [
  [
    'Date',
    'Document / Decision',
    'AuthorityLevel',
    'Exact/semantic statement',
    'RetryRegionImplication',
    'RelationToEarlierSSOT',
  ],
  [
    '2026-08-23',
    'MODEL3_ARCHITECTURE_CONTRACT_V1.md (+ PreDevelopment Architecture Audit)',
    'L1_FROZEN_BUSINESS',
    'Model3 decides KEEP|RETRY per non-anchor PathFineSpan; RETRY = one bounded local Lexicon Recall retry / re-recall; no region fields',
    'RETRY decision unit defined; RetryRegion geometry NOT YET SPECIFIED',
    'EARLIEST_MODEL3_RETRY',
  ],
  [
    '2026-08-26',
    'MODEL3_SYNTHETIC_V1_FROZEN.md / model3_output_contract_v1.md',
    'L1_L2_FREEZE',
    'RETRY = one-shot subset re-recall; Anchors/KEEP unchanged; still span-oriented',
    'Pre-region interpretation (boundary-locked later corrected)',
    'CONFIRMS_EARLIER_SSOT',
  ],
  [
    '2026-08-27',
    'Model3 V1 Mainline Integration (routeModel3Retry initial)',
    'L3_IMPLEMENTATION',
    'Initial RETRY → recallSpanTopKV2 on current FineSpan bounds',
    'Boundary-locked per-span recovery (later judged too narrow)',
    'IMPLEMENTATION_ONLY',
  ],
  [
    '2026-08-28',
    'Lingua_Model3_V1_Retry_Region_Postprocess_Ownership_Audit_2026_08_28.md',
    'L2_AUTHORITY_AUDIT',
    'Postprocess owns region derivation; do not move region repair into Model3; merge adjacent RETRY + local reseg feasible',
    'Authorizes postprocess RetryRegion owner separate from Model3 model',
    'CLARIFIES_EARLIER_SSOT',
  ],
  [
    '2026-08-28',
    'Lingua_Model3_V1_ASR_Postprocess_Retry_Region_Correction_Report_2026_08_28.md + model3_retry_contract_v1.md update',
    'L1_L2_CONTRACT',
    'RETRY means one bounded local re-segmentation + re-recall within derived retry region(s); adjacent RETRY merge allowed; Model3 emits no region fields',
    'EARLIEST_AUTHORITATIVE_RETRY_REGION_DEFINITION: derived region = contiguous RETRY PathFineSpan recovery scope',
    'EXPLICITLY_CHANGES_EARLIER_SSOT (postprocess interpretation vs FineSpan-lock)',
  ],
  [
    '2026-08-28',
    'Lingua_Model3_V1_Retry_Region_Controlled_Validation_Report_2026_08_28.md',
    'L4_TEST_REPORT',
    'Adjacent merge PASS; Cross-Anchor=0; Cross-KEEP=0',
    'Test expectation: KEEP/Anchor break merge; no expansion',
    'TEST_ASSUMPTION_ONLY (traces to 08-28 contract)',
  ],
  [
    '2026-08-29',
    'Lingua_Retry_One_Bounded_Resegmentation_Historical_SSOT_Audit + MultiHypothesis Minimal Correction',
    'L2_AUDIT',
    'one = one retry attempt; Anchor/KEEP break merge; multi-path localSpan union inside region',
    'Confirms RETRY-only union barriers; recovery multipath inside region',
    'CLARIFIES_EARLIER_SSOT',
  ],
  [
    '2026-09-01',
    'Lingua_Model3_V2_Retry_Query_Mapping_Owner_Audit_2026_09_01.md',
    'L4_AUDIT_RESTATEMENT',
    'Retry region is union of contiguous Model3 RETRY PathFineSpans only; KEEP/Anchor break merge; cannot expand into KEEP without additional RETRY',
    'Clearest frozen derivation formula = Interpretation A',
    'CONFIRMS_EARLIER_SSOT',
  ],
  [
    '2026-09-03',
    'Lingua_Model3_Retry_Stage2_SSOT_Restoration_Design.md (+ Acceptance)',
    'L2_DESIGN_FREEZE',
    'RetryRegion FIXED; Stage2 = every L∈[1,min(5,R)] window entirely inside RetryRegion; MUST NOT widen RetryRegion / cross Anchor / unrelated KEEP',
    'WINDOWS_CLIPPED_TO_REGION; region expansion FORBIDDEN',
    'CLARIFIES_EARLIER_SSOT',
  ],
  [
    '2026-09-04',
    'Lingua_Model3_Retry_Fallback_Boundary_Lock_Design.md',
    'L2_L3_DELTA_CLOSED',
    'RetryRegion AUTHORITATIVE hard bounds; fallback must not FineSpan-lock outside region',
    'Region remains RETRY-union; no expansion',
    'CLARIFIES_EARLIER_SSOT',
  ],
  [
    '2026-09-08',
    'Model3_V2_Frozen_Architecture_SSOT.md / model3_retry_contract V2 seal',
    'L2_FREEZE',
    'Retry subchain ACTIVE+FROZEN; reopen Delta1/2 FORBIDDEN without ACP',
    'Freezes existing RetryRegion barriers/geometry',
    'CONFIRMS_EARLIER_SSOT',
  ],
  [
    '2026-09',
    'LINGUA_ACP_MODEL3_RETRY_STAGE2_TONE_RELAXATION_V1 + Runtime Freeze',
    'L2_ACP',
    'Stage2 tone/recallMode only; do not change Model3 KEEP/RETRY',
    'Does not alter RetryRegion derivation',
    'CLARIFIES_EARLIER_SSOT',
  ],
  [
    '2026-09-14',
    'LINGUA_ACP_ANCHOR_DOMAIN_EVIDENCE_AUTHORITY_V1',
    'L2_ACP',
    'Anchor = RETRY-suppression protection; deriveRetryRegions path unchanged',
    'May change which spans become RETRY; not the union formula',
    'CLARIFIES_EARLIER_SSOT',
  ],
  [
    '2026-09-15',
    'LINGUA_STAGE2_QUERY_EVIDENCE_PRESERVATION_ACP_V1_FROZEN',
    'L2_ACP',
    'MODEL3_CHANGE=NO; DISJOINT / region coverage out of ACP scope',
    'QueryEvidence newer than RetryRegion; does not redefine region SSOT',
    'CLARIFIES_EARLIER_SSOT',
  ],
  [
    '2026-09-16',
    'LINGUA_CORRECT_PROFILE_TARGET_QUERY_LIFECYCLE_AUDIT.md',
    'L4_MEASUREMENT',
    'C9=23: target evidence exists but RetryRegion does not fully cover',
    'Pressure measurement; NOT new architecture authority',
    'TEST_ASSUMPTION_ONLY',
  ],
];

fs.writeFileSync(
  path.join(OUT, 'LINGUA_RETRY_REGION_AUTHORITY_TIMELINE.csv'),
  timeline.map((row) => row.map(csvEscape).join(',')).join('\n'),
  'utf8'
);

// --- authority matrix ---
const authMatrix = [
  ['Question', 'HistoricalAuthority', 'CurrentImplementation', 'Conformance'],
  [
    'Model3 decision unit',
    'PathFineSpan KEEP|RETRY (Architecture Contract 2026-08-23)',
    'PathFineSpan decisions in runModel3PathStep',
    'CONFORMANT',
  ],
  [
    'RETRY meaning',
    'Suspicious local interpretation → one bounded local re-segmentation + re-recall within derived region(s) (retry_contract 2026-08-28)',
    'routeModel3Retry → deriveRetryRegions → resegment → Stage2 recall',
    'CONFORMANT',
  ],
  [
    'Recovery unit',
    'Derived RetryRegion (distinct from decision unit); Stage2 windows inside region (Stage2 SSOT Restoration 2026-09-03)',
    'RetryRegion + Stage2 1..min(5,R) locals inside region',
    'CONFORMANT',
  ],
  [
    'RetryRegion owner',
    'ASR postprocess / retry router (Ownership Audit 2026-08-28); Model3 emits no region fields',
    'deriveRetryRegions in model3-retry-region.ts called from routeModel3Retry',
    'CONFORMANT',
  ],
  [
    'Adjacent RETRY merge',
    'ALLOWED when contiguous raw/syllable (Correction Report + controlled validation)',
    'spansAreAdjacent then merge in deriveRetryRegions',
    'CONFORMANT',
  ],
  [
    'Region expansion beyond RETRY spans',
    'FORBIDDEN into KEEP / Anchor without additional RETRY (Mapping Owner Audit; Stage2 MUST NOT widen)',
    'KEEP/Anchor flush pending; no padding/radius',
    'CONFORMANT',
  ],
  [
    'Anchor boundary semantics',
    'Anchor action immutable; Anchor breaks merge; no Anchor cross (Architecture + Anchor contracts)',
    'anchorIds force non-eligible; flush on Anchor',
    'CONFORMANT',
  ],
  [
    'Resegmentation boundary semantics',
    'Local lattice reseg only on region slice; may cross original PathFineSpan boundaries INSIDE region',
    'resegmentRetryRegionWithLattice on region bounds',
    'CONFORMANT',
  ],
  [
    'Re-recall boundary semantics',
    'Stage2 queries clipped to RetryRegion hard bounds (Fallback Boundary Lock)',
    'enumerateStage2SuccessPathQueryLocals inside region',
    'CONFORMANT',
  ],
  [
    'Lexical window vs region',
    'WINDOWS_CLIPPED_TO_REGION; every L∈[1,min(5,R)] entirely inside region',
    'Stage2 windows subset of region syllable interval',
    'CONFORMANT',
  ],
  [
    'Boundedness rule',
    'Retry once; Model3≤1; no ASR/DomainVote/Model3 recursion; region=RETRY-union; Stage2 L≤5',
    'Same hard limits in router + contracts',
    'CONFORMANT',
  ],
  [
    'QueryEvidence relation',
    'N/A to historical region SSOT (ACP 2026-09-15 newer); evidence coverage of region OUT OF SCOPE of that ACP',
    'Utterance-local store; Stage2 EXACT/SUBSPAN map; region derivation ignores evidence',
    'CONFORMANT_TO_REGION_SSOT (evidence coverage never required)',
  ],
];

fs.writeFileSync(
  path.join(OUT, 'LINGUA_RETRY_REGION_AUTHORITY_MATRIX.csv'),
  authMatrix.map((row) => row.map(csvEscape).join(',')).join('\n'),
  'utf8'
);

// --- C9 case matrix ---
const caseHeader = [
  'caseId',
  'evidenceSyllableStart',
  'evidenceSyllableEnd',
  'evidencePinyin',
  'retryPathFineSpans',
  'retryRegionStart',
  'retryRegionEnd',
  'coverageClass',
  'authorityRequiredCoverage',
  'implementationConforms',
  'classification',
  'anyRetryOverlapsEvidence',
  'evidenceRefs',
  'notes',
];
const caseCsv = [caseHeader.join(',')];
for (const r of c9) {
  caseCsv.push(caseHeader.map((h) => csvEscape(r[h])).join(','));
}
fs.writeFileSync(path.join(OUT, 'LINGUA_RETRY_REGION_C9_CASE_MATRIX.csv'), caseCsv.join('\n'), 'utf8');

const classification = {
  phase: PHASE,
  date: new Date().toISOString().slice(0, 10),
  INTERPRETATION: 'A_RETRY_PATH_FINE_SPAN_UNION',
  ARCHITECTURE_STATUS: 'SSOT_CLEAR',
  CURRENT_IMPLEMENTATION: 'CONFORMANT',
  RESULT: 'C_CURRENT_IMPLEMENTATION_IS_INTENTIONAL',
  C9_EXPECTED_LIMITATION: 'YES',
  IMPLEMENTATION_DEFECT_FOUND: 'NO',
  ARCHITECTURE_GAP_FOUND: 'NO',
  ARCHITECTURE_CONFLICT_FOUND: 'NO',
  ACP_REQUIRED: 'YES',
  ACP_REASON:
    'Frozen SSOT requires RetryRegion = contiguous RETRY PathFineSpan union and forbids KEEP/Anchor expansion. C9 shows first-pass target evidence often extends beyond that union. Changing recovery scope to cover such evidence would be an architecture change, not a conformance repair.',
  caseClassification: {
    R1_IMPLEMENTATION_CONFORMS_AND_COVERAGE_NOT_REQUIRED: rCounts.R1,
    R2_IMPLEMENTATION_VIOLATES_EXISTING_RECOVERY_GEOMETRY_SSOT: rCounts.R2,
    R3_EXISTING_SSOT_DOES_NOT_DEFINE_REQUIRED_COVERAGE: rCounts.R3,
    R4_EXISTING_SSOT_CONFLICTS_INTERNALLY: rCounts.R4,
    R5_CASE_NOT_DECIDABLE_FROM_AVAILABLE_EVIDENCE: rCounts.R5,
    TOTAL: c9.length,
  },
  coverage: { PARTIAL: partial, NONE: none, FULL: 0 },
  ONE_NEXT_OWNER: 'RETRY_RECOVERY_SCOPE_ARCHITECTURE_CHANGE',
  ONE_NEXT_DELTA:
    'Draft ACP only if broader recovery than RETRY PathFineSpan union is desired; do not treat C9 as deriveRetryRegions defect',
};

fs.writeFileSync(
  path.join(OUT, 'LINGUA_RETRY_REGION_SSOT_CLASSIFICATION.json'),
  JSON.stringify(classification, null, 2),
  'utf8'
);

const inventory = [
  'path,action,product_runtime',
  'electron_node/electron-node/tests/audit-retry-region-ssot-c9-matrix.mjs,created,NO',
  'electron_node/electron-node/tests/emit-retry-region-ssot-artifacts.mjs,created,NO',
  'docs/user_correction/model3/LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT.md,created,NO',
  'docs/user_correction/model3/LINGUA_RETRY_REGION_AUTHORITY_TIMELINE.csv,created,NO',
  'docs/user_correction/model3/LINGUA_RETRY_REGION_AUTHORITY_MATRIX.csv,created,NO',
  'docs/user_correction/model3/LINGUA_RETRY_REGION_C9_CASE_MATRIX.csv,created,NO',
  'docs/user_correction/model3/LINGUA_RETRY_REGION_SSOT_CLASSIFICATION.json,created,NO',
  'docs/user_correction/model3/modified_file_inventory.csv,updated,NO',
];
fs.writeFileSync(path.join(OUT, 'modified_file_inventory.csv'), inventory.join('\n'), 'utf8');

const audit = `# LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT

| Field | Value |
| --- | --- |
| Phase | \`${PHASE}\` |
| Mode | READ_ONLY / HISTORICAL_SSOT / CURRENT_CODE / CODE_FROZEN |
| Date | ${new Date().toISOString().slice(0, 10)} |
| AUDIT_VALID | YES |
| PRODUCT_RUNTIME_CODE_CHANGED | NO |
| GT_USED_BY_RUNTIME | NO |
| C9_CASES | 23 |
| C9_PARTIAL_COVERAGE | ${partial} |
| C9_NO_COVERAGE | ${none} |

## 1. Verdict in one paragraph

Current \`deriveRetryRegions\` is a **faithful implementation** of the frozen RetryRegion derivation SSOT (**Interpretation A**: contiguous non-Anchor \`RETRY\` PathFineSpan union; KEEP/Anchor break merge; **no expansion** beyond RETRY spans). The 23 C9 cases show first-pass target-reachable evidence intervals that are only partially covered or disjoint from those regions; under frozen authority, **covering those evidence intervals is not required**. Therefore C9 is an **expected limitation** of the intentional RETRY-only recovery scope, not an implementation defect. Broadening recovery would be an **architecture change (ACP)**, not a conformance repair.

## 2. Primary research question — interpretation

| ID | Meaning | Authority match |
| --- | --- | --- |
| **A** RETRY_PATH_FINE_SPAN_UNION | Region = contiguous RETRY PathFineSpan union | **SELECTED** — matches 2026-08-28+ frozen contract + Stage2/Fallback locks |
| B BOUNDED_LOCAL_RECOVERY_REGION | Region may expand beyond RETRY to “sufficient” lexical recovery | **Rejected** — Stage2/Mapping audits forbid widen into KEEP |
| C Decision fixed; recovery context may extend outside region | Recovery queries may leave RetryRegion | **Rejected** — Fallback Boundary Lock: region is hard bound |
| D NOT_SPECIFIED | No region formula | Applies only **before** 2026-08-28 |

## 3. Earliest authoritative definitions

\`\`\`text
EARLIEST_AUTHORITATIVE_MODEL3_RETRY_DEFINITION =
MODEL3_ARCHITECTURE_CONTRACT_V1.md (Effective 2026-08-23)
  RETRY = request one bounded local Lexicon Recall retry / re-recall
  Decision unit = PathFineSpan KEEP|RETRY
  No RetryRegion geometry yet

EARLIEST_AUTHORITATIVE_RETRY_REGION_DEFINITION =
model3_retry_contract_v1.md update + ASR Postprocess Retry-Region Correction Report (2026-08-28)
  RETRY means one bounded local re-segmentation + re-recall within derived retry region(s)
  Adjacent RETRY merge allowed
  Model3 emits no region fields (router owns derivation)
\`\`\`

## 4. Decision unit vs recovery unit

\`\`\`text
DECISION_UNIT_AND_RECOVERY_UNIT_AUTHORITY =
DISTINCT

MODEL3_DECISION_UNIT =
PathFineSpan KEEP|RETRY

RETRY_RECOVERY_UNIT =
Derived RetryRegion (+ Stage2 lexical windows clipped inside region)

MODEL3_MODEL_OWNS_REGION_BOUNDARY =
NO

RETRY_ROUTER_OWNS_REGION_BOUNDARY =
YES
\`\`\`

Model3 may correctly emit RETRY on suspicious spans while the recovery region remains the RETRY-span union. **C9 does not imply Model3 decision failure.**

## 5. Current \`deriveRetryRegions\` policy

\`\`\`text
CURRENT_RETRY_REGION_POLICY =
Collect non-Anchor PathFineSpans with decision=RETRY in path order; merge only when raw/syllable-adjacent; KEEP or Anchor flushes the pending group; region bounds = first..last span union; no lexical/evidence/ASR-radius expansion.
\`\`\`

Observed chain:

\`\`\`text
Model3 RETRY units
→ deriveRetryRegions (RETRY-only contiguous union)
→ optional lattice resegment on region slice
→ Stage2 windows 1..min(5,R) entirely inside region
→ Recall (tone-relaxed Stage2 mode)
\`\`\`

Inputs visible to deriver: PathFineSpan geometry, KEEP/RETRY decisions, Anchor set.  
**Not** consulted: RecallQueryEvidence, FineSpan lexical windows outside RETRY, Model2 queries, GT.

## 6. Boundedness / resegmentation / Anchor / lexical relation

| Topic | Authority |
| --- | --- |
| BOUNDED_LOCAL_AUTHORITY | One retry cycle; region = RETRY-union; Stage2 L≤5 inside region; no ASR/DomainVote/Model3 recursion |
| RESEGMENTATION_CAN_CROSS_ORIGINAL_PATHFINESPAN_BOUNDARY | **YES** inside RetryRegion; **NO** outside region |
| REGION_EXPANSION_BEYOND_RETRY_SPANS_AUTHORITY | **FORBIDDEN** |
| RETRY_REGION_LEXICAL_WINDOW_RELATION | **WINDOWS_CLIPPED_TO_REGION** |
| ANCHOR_ACTION_IMMUTABILITY | Anchor candidates not actionable RETRY; mutation FORBIDDEN |
| ANCHOR_GEOMETRY_CROSSING | **FORBIDDEN** for merge/expansion |
| ANCHOR_CONTEXT_VISIBILITY | Anchor may bound/break regions; not an expansion license |

## 7. QueryEvidence is newer — mandatory distinction

RecallQueryEvidence (2026-09-15 ACP) did **not** exist when RetryRegion SSOT was frozen (2026-08-28).  
Old SSOT never said “RetryRegion must cover RecallQueryEvidence.”  
QueryEvidence ACP explicitly marks region formation / DISJOINT coverage as **out of scope**.  
C9 therefore exposes a **product tension** between frozen RETRY-only recovery scope and newer evidence reuse — **not** a hidden violation of 08-28 region derivation.

## 8. Application to 23 C9 cases

| coverageClass | Count | Meaning under SSOT |
| --- | ---: | --- |
| PARTIAL | ${partial} | Some RETRY-union overlaps evidence but KEEP/end boundary truncates full evidence interval |
| NONE | ${none} | No region covers evidence interval |
| FULL | 0 | — |

**Classification: R1 = ${rCounts.R1} / 23** (all cases)

\`\`\`text
R1_IMPLEMENTATION_CONFORMS_AND_COVERAGE_NOT_REQUIRED = ${rCounts.R1}
R2_IMPLEMENTATION_VIOLATES_EXISTING_RECOVERY_GEOMETRY_SSOT = ${rCounts.R2}
R3_EXISTING_SSOT_DOES_NOT_DEFINE_REQUIRED_COVERAGE = ${rCounts.R3}
R4_EXISTING_SSOT_CONFLICTS_INTERNALLY = ${rCounts.R4}
R5_CASE_NOT_DECIDABLE_FROM_AVAILABLE_EVIDENCE = ${rCounts.R5}
\`\`\`

Authority-required coverage of first-pass evidence intervals: **NOT_REQUIRED_BY_SSOT**.  
Implementation conforms to RETRY-union derivation in all 23.

Canonical partial: \`p2_u001_014\` evidence \`[6,8)\` vs best region \`[2,7)\` — overlap without full cover; SSOT forbids expanding into trailing KEEP to include syllable 7–8 unless that span is also RETRY.

## 9. Architecture-level RESULT C

\`\`\`text
ARCHITECTURE_STATUS = SSOT_CLEAR
CURRENT_IMPLEMENTATION = CONFORMANT
C9_EXPECTED_LIMITATION = YES
IMPLEMENTATION_DEFECT_FOUND = NO
ARCHITECTURE_GAP_FOUND = NO
ARCHITECTURE_CONFLICT_FOUND = NO
ACP_REQUIRED = YES
\`\`\`

ACP is required **only if** the product wants broader recovery than frozen RETRY-span union.  
This round does **not** draft ACP options.

Stale docs (\`model3_freeze_governance.json\` older \`productionRetry:false\` wording) are superseded by 2026-09-08 ACTIVE+FROZEN seal — not treated as live conflict against RETRY-union formula.

## 10. Closed scopes

| Item | Status |
| --- | --- |
| Model3 input change | NO |
| Model3 KEEP/RETRY label semantics | NO |
| Stage2 Tone / EXACT-SUBSPAN mapper | NO |
| QueryEvidence V1 reopen | NO |
| C4/C5 redesign | OUT OF SCOPE |
| Fix C9 this round | NO |

## 11. Anti-drift

FineSpan / Model2 / Model3 / RetryRegion / deriveRetryRegions / Stage2 / QueryEvidence / Tone / Lexicon / Domain / budget / Assembly / KenLM / Pilot / GT-runtime / C9 fixes: **all NO**.

## 12. Artifacts

1. \`LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT.md\` (this file)
2. \`LINGUA_RETRY_REGION_AUTHORITY_TIMELINE.csv\`
3. \`LINGUA_RETRY_REGION_AUTHORITY_MATRIX.csv\`
4. \`LINGUA_RETRY_REGION_C9_CASE_MATRIX.csv\`
5. \`LINGUA_RETRY_REGION_SSOT_CLASSIFICATION.json\`
6. \`modified_file_inventory.csv\`

---

## FINAL VERDICT

\`\`\`text
PHASE =
LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT_V1

AUDIT_VALID =
YES

PRODUCT_RUNTIME_CODE_CHANGED =
NO

GT_USED_BY_RUNTIME =
NO

C9_CASES =
23

C9_PARTIAL_COVERAGE =
${partial}

C9_NO_COVERAGE =
${none}

EARLIEST_AUTHORITATIVE_MODEL3_RETRY_DEFINITION =
MODEL3_ARCHITECTURE_CONTRACT_V1.md (Effective 2026-08-23)

EARLIEST_AUTHORITATIVE_RETRY_REGION_DEFINITION =
model3_retry_contract_v1.md + ASR Postprocess Retry-Region Correction Report (2026-08-28)

MODEL3_DECISION_UNIT =
PathFineSpan KEEP|RETRY

RETRY_RECOVERY_UNIT =
Derived RetryRegion (Stage2 windows clipped inside)

DECISION_UNIT_AND_RECOVERY_UNIT_AUTHORITY =
DISTINCT

MODEL3_MODEL_OWNS_REGION_BOUNDARY =
NO

RETRY_ROUTER_OWNS_REGION_BOUNDARY =
YES

CURRENT_RETRY_REGION_POLICY =
Non-Anchor RETRY PathFineSpans merged only when raw/syllable-adjacent; KEEP/Anchor break groups; bounds = union of those spans; no evidence/lexical/radius expansion.

REGION_EXPANSION_BEYOND_RETRY_SPANS_AUTHORITY =
FORBIDDEN

RESEGMENTATION_CAN_CROSS_ORIGINAL_PATHFINESPAN_BOUNDARY =
YES

RETRY_REGION_LEXICAL_WINDOW_RELATION =
WINDOWS_CLIPPED_TO_REGION

ANCHOR_ACTION_IMMUTABILITY =
Anchor not actionable RETRY; mutation FORBIDDEN during retry

ANCHOR_GEOMETRY_CROSSING =
FORBIDDEN

BOUNDED_LOCAL_AUTHORITY =
One retry cycle; region=RETRY-union; Stage2 L∈[1,min(5,R)] inside region; no ASR/DomainVote/Model3 recursion

R1_IMPLEMENTATION_CONFORMS_AND_COVERAGE_NOT_REQUIRED =
${rCounts.R1}

R2_IMPLEMENTATION_VIOLATES_EXISTING_RECOVERY_GEOMETRY_SSOT =
${rCounts.R2}

R3_EXISTING_SSOT_DOES_NOT_DEFINE_REQUIRED_COVERAGE =
${rCounts.R3}

R4_EXISTING_SSOT_CONFLICTS_INTERNALLY =
${rCounts.R4}

R5_CASE_NOT_DECIDABLE_FROM_AVAILABLE_EVIDENCE =
${rCounts.R5}

CASE_CLASSIFICATION_TOTAL =
23

ARCHITECTURE_STATUS =
SSOT_CLEAR

CURRENT_IMPLEMENTATION =
CONFORMANT

ARCHITECTURE_CONFLICT_FOUND =
NO

ARCHITECTURE_GAP_FOUND =
NO

IMPLEMENTATION_DEFECT_FOUND =
NO

C9_EXPECTED_LIMITATION =
YES

DOES_C9_REQUIRE_MODEL3_DECISION_CHANGE =
NO

DOES_C9_REQUIRE_RETRY_ROUTER_GEOMETRY_CHANGE =
NO

MODEL3_INPUT_CHANGE_REQUIRED =
NO

QUERY_EVIDENCE_V1_REOPEN_REQUIRED =
NO

STAGE2_CHANGE_REQUIRED =
NO

ACP_REQUIRED =
YES

ACP_REASON =
Frozen SSOT requires RETRY PathFineSpan union and forbids KEEP expansion; covering first-pass evidence beyond that union needs an architecture change, not a conformance fix.

ONE_NEXT_OWNER =
RETRY_RECOVERY_SCOPE_ARCHITECTURE_CHANGE

ONE_NEXT_DELTA =
Draft ACP only if broader recovery than RETRY PathFineSpan union is desired; do not treat C9 as deriveRetryRegions defect.
\`\`\`
`;

fs.writeFileSync(path.join(OUT, 'LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT.md'), audit, 'utf8');
console.log('artifacts written; R1', rCounts.R1, 'partial', partial, 'none', none);
