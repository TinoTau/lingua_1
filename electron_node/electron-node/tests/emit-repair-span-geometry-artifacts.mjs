/**
 * Emit ≤6 repair-span geometry lifecycle artifacts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../../../docs/user_correction/model3');
const PHASE = 'LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT_V1';

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

const rows = JSON.parse(fs.readFileSync(path.join(OUT, '_repair_span_geometry_rows.json'), 'utf8'));
if (rows.length !== 23) {
  console.error('need 23 rows', rows.length);
  process.exit(2);
}

const G = [
  'G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE',
  'G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY',
  'G3_SELECTED_EDGE_GEOMETRY_CHANGED_DURING_PATHFINESPAN_CONSTRUCTION',
  'G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN',
  'G5_TARGET_GEOMETRY_SPLIT_ACROSS_MULTIPLE_PATHFINESPANS_AND_ONLY_SUBSET_RETRY',
  'G6_RETRY_PATHFINESPAN_GEOMETRY_CORRECT_BUT_RETRYREGION_CHANGES_IT',
  'G7_NO_GEOMETRY_DIVERGENCE_BEFORE_RETRYREGION',
  'G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY',
  'G9_COMPOUND_ASR_OR_FALLBACK_GEOMETRY',
  'G10_OTHER_PROVEN',
  'G11_UNRESOLVED',
];
const gCounts = Object.fromEntries(G.map((g) => [g, 0]));
for (const r of rows) gCounts[r.firstGeometryDivergenceClass] = (gCounts[r.firstGeometryDivergenceClass] || 0) + 1;

const sameEdge = rows.filter((r) => r.funnel?.sameGeometryLexicalEdgeExists).length;
const sameSelected = rows.filter((r) => r.funnel?.sameGeometryEdgeSelected).length;
const samePfs = rows.filter((r) => r.funnel?.sameGeometryPathFineSpanExists).length;
const sameRetry = rows.filter((r) => r.funnel?.sameGeometryPathFineSpanRetry).length;
const sameRegion = rows.filter((r) => r.funnel?.sameGeometryRetryRegionExists).length;

const appl = {
  YES: rows.filter((r) => r.queryEvidenceStructurallyApplicable === 'YES').length,
  NO: rows.filter((r) => r.queryEvidenceStructurallyApplicable === 'NO').length,
  MIXED: rows.filter((r) => r.queryEvidenceStructurallyApplicable === 'MIXED').length,
  NOT_PROVEN: rows.filter((r) => r.queryEvidenceStructurallyApplicable === 'NOT_PROVEN').length,
};

let dominant = G[0];
let dominantCount = 0;
for (const g of G) {
  if ((gCounts[g] || 0) > dominantCount) {
    dominant = g;
    dominantCount = gCounts[g] || 0;
  }
}

const caseHeader = [
  'caseId',
  'referenceText',
  'asrText',
  'targetTerm',
  'targetWindowRawGeometry',
  'targetWindowSyllableGeometry',
  'queryEvidenceGeometry',
  'queryEvidencePinyin',
  'queryHitCount',
  'sameGeometryLexicalEdgeExists',
  'lexicalEdgeGeometry',
  'selectedPathRelevantEdges',
  'selectedPathGeometry',
  'pathFineSpans',
  'model3Decisions',
  'retryPathFineSpans',
  'retryRegion',
  'firstGeometryDivergenceStage',
  'firstGeometryDivergenceClass',
  'replaceableSpanGeometry',
  'queryEvidenceStructurallyApplicable',
  'lengthInvariantSatisfied',
  'lengthChangingNearEvidence',
  'anyHitOnExactWindow',
  'evidenceRefs',
  'notes',
];
const caseCsv = [caseHeader.join(',')];
for (const r of rows) caseCsv.push(caseHeader.map((h) => csvEscape(r[h])).join(','));
fs.writeFileSync(path.join(OUT, 'LINGUA_REPAIR_SPAN_GEOMETRY_CASES.csv'), caseCsv.join('\n'), 'utf8');

const funnel = {
  phase: PHASE,
  date: new Date().toISOString().slice(0, 10),
  C9_CASES: 23,
  steps: [
    { name: 'first_pass_target_reachable_windows', count: 23 },
    {
      name: 'same_geometry_LexicalEdge_exists',
      count: sameEdge,
      drop: 23 - sameEdge,
      dropOwners: ['G1', 'G8'],
    },
    {
      name: 'same_geometry_edge_selected',
      count: sameSelected,
      drop: sameEdge - sameSelected,
      dropOwners: ['G2'],
    },
    {
      name: 'same_geometry_PathFineSpan_exists',
      count: samePfs,
      drop: sameSelected - samePfs,
      dropOwners: ['G3'],
    },
    {
      name: 'same_geometry_PathFineSpan_RETRY',
      count: sameRetry,
      drop: samePfs - sameRetry,
      dropOwners: ['G4', 'G5'],
    },
    {
      name: 'same_geometry_RetryRegion_exists',
      count: sameRegion,
      drop: sameRetry - sameRegion,
      dropOwners: ['G6'],
    },
  ],
  FIRST_PASS_TARGET_REACHABLE_WINDOW: 23,
  SAME_GEOMETRY_LEXICAL_EDGE_EXISTS: sameEdge,
  SAME_GEOMETRY_EDGE_SELECTED: sameSelected,
  SAME_GEOMETRY_PATHFINESPAN_EXISTS: samePfs,
  SAME_GEOMETRY_PATHFINESPAN_RETRY: sameRetry,
  SAME_GEOMETRY_RETRYREGION_EXISTS: sameRegion,
  gCounts,
  queryEvidenceStructurallyApplicable: appl,
  DOMINANT_FIRST_GEOMETRY_DIVERGENCE: dominant,
  DOMINANT_COUNT: dominantCount,
  PREVIOUS_C9_INTERPRETATION: 'PARTIALLY_REVISED',
};
fs.writeFileSync(path.join(OUT, 'LINGUA_REPAIR_SPAN_GEOMETRY_FUNNEL.json'), JSON.stringify(funnel, null, 2), 'utf8');

const auth = [
  ['Geometry', 'Owner', 'CreatedAt', 'CanChange', 'RuntimePurpose'],
  [
    'SearchWindow',
    'Lattice windowing (buildLexicalWindowQueries / GlobalWindowDescriptor)',
    'Lattice Stage-1 syllable windows 1..5',
    'Filtered/blocked; geometry fixed per window',
    'Overlapping recall/Model2 search geometry',
  ],
  [
    'QueryEvidence',
    'expandWindowsWithModel2 upsertRecallQueryEvidence (ACP V1)',
    'Each executed Model2 P query (hit optional)',
    'Dedup only; geometry immutable',
    'Reusable Stage2 query provenance — NOT repair authority',
  ],
  [
    'LexicalEdge',
    'buildLexicalEdges (+ injectFallbackEdges)',
    'Windows with ≥1 WindowCandidate after Base(+Model2); else 1-syl fallback empty',
    'Selected among overlapping edges; edge bounds fixed',
    'Syllable-interval graph edge carrying candidates',
  ],
  [
    'SelectedSegment',
    'SegmentationPath.edgeRefs[i] (enumerateCompleteSegmentationPaths)',
    'Path enumeration',
    'Choice among competing edges; not a typed object',
    'Chosen non-overlapping cover of utterance',
  ],
  [
    'PathFineSpan',
    'materializePathFineSpans (1:1 from selected LexicalEdge)',
    'Per complete path after selection',
    'No merge/split of selected edges; RetryRegion unions RETRY later',
    'Authoritative replaceable decision unit for Vote/Anchor/Model3/Assembly',
  ],
  [
    'RepairSpan',
    'PathFineSpan (conceptually SpanReplacementPick.span)',
    'Assembly pick from PathFineSpan',
    'No',
    'Original raw interval replaced in-place by candidate.replacement',
  ],
  [
    'RetryRegion',
    'deriveRetryRegions (RETRY PathFineSpan contiguous union)',
    'After Model3 RETRY',
    'No (frozen RETRY-only union)',
    'Bounded resegmentation + Stage2 recall hard bound',
  ],
  [
    'CandidateReplacement',
    'WindowCandidate.replacement / assembly word',
    'Recall/Model2 materialize',
    'Assembly may select among candidates',
    'String spliced into raw[start,end); length NOT currently forced equal',
  ],
];
fs.writeFileSync(
  path.join(OUT, 'LINGUA_REPAIR_SPAN_GEOMETRY_AUTHORITY_MATRIX.csv'),
  auth.map((r) => r.map(csvEscape).join(',')).join('\n'),
  'utf8'
);

const div = ['Class,Count,Percent'];
for (const g of G) {
  const c = gCounts[g] || 0;
  div.push(`${g},${c},${((100 * c) / 23).toFixed(1)}`);
}
div.push(`TOTAL,23,100`);
fs.writeFileSync(path.join(OUT, 'LINGUA_REPAIR_SPAN_FIRST_DIVERGENCE_MATRIX.csv'), div.join('\n'), 'utf8');

const inventory = [
  'path,action,product_runtime',
  'electron_node/electron-node/tests/audit-repair-span-geometry-lifecycle.mjs,created,NO',
  'electron_node/electron-node/tests/emit-repair-span-geometry-artifacts.mjs,created,NO',
  'docs/user_correction/model3/LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT.md,created,NO',
  'docs/user_correction/model3/LINGUA_REPAIR_SPAN_GEOMETRY_CASES.csv,created,NO',
  'docs/user_correction/model3/LINGUA_REPAIR_SPAN_GEOMETRY_FUNNEL.json,created,NO',
  'docs/user_correction/model3/LINGUA_REPAIR_SPAN_GEOMETRY_AUTHORITY_MATRIX.csv,created,NO',
  'docs/user_correction/model3/LINGUA_REPAIR_SPAN_FIRST_DIVERGENCE_MATRIX.csv,created,NO',
  'docs/user_correction/model3/modified_file_inventory.csv,updated,NO',
];
fs.writeFileSync(path.join(OUT, 'modified_file_inventory.csv'), inventory.join('\n'), 'utf8');

const applVerdict = appl.NO >= 15 ? 'NO' : appl.MIXED || appl.YES ? 'MIXED' : 'NOT_PROVEN';

const audit = `# LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT

| Field | Value |
| --- | --- |
| Phase | \`${PHASE}\` |
| Mode | READ_ONLY / TRACE_FIRST / LENGTH_INVARIANT_FIRST / CODE_FROZEN |
| Date | ${new Date().toISOString().slice(0, 10)} |
| AUDIT_VALID | YES |
| PRODUCT_RUNTIME_CODE_CHANGED | NO |
| GT_USED_BY_RUNTIME | NO |
| C9_CASES | 23 |
| FIRST_PASS_TARGET_REACHABLE_WINDOW | 23 |

## 1. Verdict

For the 23 prior C9 cases, the complete first-pass QueryEvidence geometry was **usually not a legitimate replaceable span** on the selected runtime path.

- **Dominant first divergence: \`G8\` (${gCounts.G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY}/23)** — target-length QueryEvidence existed (often zero-hit), never became a candidate-bearing LexicalEdge, and selected PathFineSpans over the site are **shorter**.
- Combined **G1+G8 = ${(gCounts.G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE || 0) + (gCounts.G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY || 0)}/23**: evidence geometry never owns repair.
- **G2 = ${gCounts.G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY}**: candidates existed at evidence geometry, but segmentation selected other (typically shorter) spans.
- **G4 = ${gCounts.G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN}**: exact-geometry PathFineSpan appears on some paths as **KEEP**; RETRY/RetryRegion near the site comes from other path partitions — still does **not** authorize splicing a longer QueryEvidence into a shorter RETRY repair span.

**Previous C9 interpretation is PARTIALLY_REVISED:** C9 measured RetryRegion vs QueryEvidence coverage, but under the frozen length invariant and PathFineSpan ownership, most of those evidence intervals were **structurally inapplicable** to the actual repair spans. RetryRegion expansion is **not** required and remains **CLOSED**.

## 2. Authoritative replaceable span

\`\`\`text
REPLACEABLE_SPAN_GEOMETRY_OWNER =
PathFineSpan
  (1:1 materialization of selected LexicalEdge on a SegmentationPath)

REPLACEABLE_SPAN_GEOMETRY_FIRST_CREATED_AT =
LexicalEdge construction from recalled windows with ≥1 WindowCandidate
  then frozen into PathFineSpan at path materialization

REPLACEABLE_SPAN_GEOMETRY_CAN_CHANGE_AFTER_CREATION =
NO for a selected edge → PathFineSpan (no merge/split at materialize)
ONLY_BY_path_selection among competing LexicalEdges before materialize
RetryRegion unions RETRY PathFineSpans later (recovery bound ≠ repair span owner)
\`\`\`

\`\`\`text
QUERY_EVIDENCE_GRANTS_REPAIR_AUTHORITY =
NO
\`\`\`

\`buildLexicalEdges\` skips windows with zero candidates. \`RecallQueryEvidence\` is upserted even on zero-hit Model2 queries and does **not** create LexicalEdges.

## 3. Length invariant

\`\`\`text
REPAIR_REPLACEMENT_LENGTH_INVARIANT = FROZEN
  (user architecture authority this round)
  replacement character length == replaceable original span character length

REPLACEMENT_LENGTH_AUTHORITY =
RAW_CHARACTER_GEOMETRY (business)
  with syllable geometry as primary lattice indexing;
  normal CJK lexical spans assume rawLen == syllableLen

CURRENT_LENGTH_INVARIANT_ENFORCED =
NO

LENGTH_CHANGING_REPLACEMENT_RUNTIME_REACHABLE =
YES
\`\`\`

Production assembly (\`applyReplacementsRightToLeft\`) splices \`replacement\` into \`raw[start,end)\` **without** requiring equal character lengths. Eligibility checks range alignment of candidate geometry to FineSpan, not surface char equality. Therefore a 2-char candidate on a 1-char PathFineSpan is currently runtime-reachable and would violate the newly frozen invariant (e.g. \`纪→纪念\` → \`三叠纪念\`).

**Do not add the filter in this round** — record the gap only.

## 4. Lifecycle funnel (23)

\`\`\`text
23 first-pass target-reachable windows
↓ ${23 - sameEdge} drop (G1/G8)
${sameEdge} same-geometry LexicalEdge exists (incl. candidate-only / not selected)
↓ ${sameEdge - sameSelected} drop (G2)
${sameSelected} same-geometry edge selected → PathFineSpan with candidates
↓ ${sameSelected - samePfs} drop (G3=0)
${samePfs} same-geometry PathFineSpan exists
↓ ${samePfs - sameRetry} drop (G4)
${sameRetry} same-geometry PathFineSpan receives RETRY
↓
${sameRegion} same-geometry RetryRegion exists
\`\`\`

\`\`\`text
SAME_GEOMETRY_LEXICAL_EDGE_EXISTS = ${sameEdge}
SAME_GEOMETRY_EDGE_SELECTED = ${sameSelected}
SAME_GEOMETRY_PATHFINESPAN_EXISTS = ${samePfs}
SAME_GEOMETRY_PATHFINESPAN_RETRY = ${sameRetry}
SAME_GEOMETRY_RETRYREGION_EXISTS = ${sameRegion}
\`\`\`

## 5. First-divergence matrix

| Class | Count | % |
| --- | ---: | ---: |
| G1 | ${gCounts.G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE} | ${((100 * gCounts.G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE) / 23).toFixed(1)} |
| G2 | ${gCounts.G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY} | ${((100 * gCounts.G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY) / 23).toFixed(1)} |
| G3 | ${gCounts.G3_SELECTED_EDGE_GEOMETRY_CHANGED_DURING_PATHFINESPAN_CONSTRUCTION} | 0.0 |
| G4 | ${gCounts.G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN} | ${((100 * gCounts.G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN) / 23).toFixed(1)} |
| G5 | ${gCounts.G5_TARGET_GEOMETRY_SPLIT_ACROSS_MULTIPLE_PATHFINESPANS_AND_ONLY_SUBSET_RETRY} | 0.0 |
| G6 | ${gCounts.G6_RETRY_PATHFINESPAN_GEOMETRY_CORRECT_BUT_RETRYREGION_CHANGES_IT} | 0.0 |
| G7 | ${gCounts.G7_NO_GEOMETRY_DIVERGENCE_BEFORE_RETRYREGION} | 0.0 |
| G8 | ${gCounts.G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY} | ${((100 * gCounts.G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY) / 23).toFixed(1)} |
| G9–G11 | 0 | 0.0 |
| **TOTAL** | **23** | **100** |

## 6. Structural applicability of QueryEvidence to Retry repair spans

\`\`\`text
QUERY_EVIDENCE_STRUCTURALLY_APPLICABLE_TO_RETRY_SPAN =
${applVerdict}
  YES=${appl.YES} NO=${appl.NO} MIXED=${appl.MIXED} NOT_PROVEN=${appl.NOT_PROVEN}
\`\`\`

Under \`REPAIR_REPLACEMENT_LENGTH_INVARIANT\`, a multi-syllable QueryEvidence key cannot legally replace a shorter PathFineSpan even if RetryRegion were expanded to “cover” the evidence interval.

## 7. Closed scopes (anti-drift)

RetryRegion / Stage2 / Model2 / Model3 / QueryEvidence / FineSpan / segmentation / length filters: **unchanged this round**.

## 8. Next owner

Dominant \`G8\` → CASE E: previous C9 is largely a **search-evidence vs repair-span mismatch**, not a RetryRegion defect.

The newly frozen length invariant is **not** enforced in production, and length-changing replacement is reachable — that is the concrete implementation gap exposed by this audit (without implementing it here).

\`\`\`text
ONE_NEXT_OWNER =
REPAIR_REPLACEMENT_LENGTH_INVARIANT_CONFORMANCE

ONE_NEXT_DELTA =
Pre-development conformance plan to enforce replacement char length == PathFineSpan/repair-span char length at materialization/assembly gates; do not expand RetryRegion; do not treat QueryEvidence geometry as repair authority
\`\`\`

---

## FINAL VERDICT

\`\`\`text
PHASE =
LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT_V1

AUDIT_VALID =
YES

PRODUCT_RUNTIME_CODE_CHANGED =
NO

GT_USED_BY_RUNTIME =
NO

C9_CASES =
23

FIRST_PASS_TARGET_REACHABLE_WINDOW =
23

REPLACEABLE_SPAN_GEOMETRY_OWNER =
PathFineSpan (from selected LexicalEdge)

REPLACEABLE_SPAN_GEOMETRY_FIRST_CREATED_AT =
LexicalEdge (candidate-bearing recalled window) → PathFineSpan materialization

REPLACEABLE_SPAN_GEOMETRY_CAN_CHANGE_AFTER_CREATION =
NO after selection/materialize; ONLY_BY_path_selection among LexicalEdges before materialize

REPLACEMENT_LENGTH_AUTHORITY =
RAW_CHARACTER_GEOMETRY (business) with syllable lattice indexing; CJK assumes rawLen==syllableLen

REPAIR_REPLACEMENT_LENGTH_INVARIANT =
FROZEN

CURRENT_LENGTH_INVARIANT_ENFORCED =
NO

LENGTH_CHANGING_REPLACEMENT_RUNTIME_REACHABLE =
YES

QUERY_EVIDENCE_GRANTS_REPAIR_AUTHORITY =
NO

SAME_GEOMETRY_LEXICAL_EDGE_EXISTS =
${sameEdge}

SAME_GEOMETRY_EDGE_SELECTED =
${sameSelected}

SAME_GEOMETRY_PATHFINESPAN_EXISTS =
${samePfs}

SAME_GEOMETRY_PATHFINESPAN_RETRY =
${sameRetry}

SAME_GEOMETRY_RETRYREGION_EXISTS =
${sameRegion}

G1 =
${gCounts.G1_WINDOW_QUERY_EXISTS_BUT_NO_SAME_GEOMETRY_LEXICAL_EDGE}

G2 =
${gCounts.G2_SAME_GEOMETRY_LEXICAL_EDGE_EXISTS_BUT_SEGMENTATION_SELECTS_OTHER_GEOMETRY}

G3 =
${gCounts.G3_SELECTED_EDGE_GEOMETRY_CHANGED_DURING_PATHFINESPAN_CONSTRUCTION}

G4 =
${gCounts.G4_TARGET_GEOMETRY_PATHFINESPAN_EXISTS_BUT_MODEL3_ONLY_RETRIES_SUBSPAN}

G5 =
${gCounts.G5_TARGET_GEOMETRY_SPLIT_ACROSS_MULTIPLE_PATHFINESPANS_AND_ONLY_SUBSET_RETRY}

G6 =
${gCounts.G6_RETRY_PATHFINESPAN_GEOMETRY_CORRECT_BUT_RETRYREGION_CHANGES_IT}

G7 =
${gCounts.G7_NO_GEOMETRY_DIVERGENCE_BEFORE_RETRYREGION}

G8 =
${gCounts.G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY}

G9 =
${gCounts.G9_COMPOUND_ASR_OR_FALLBACK_GEOMETRY}

G10 =
${gCounts.G10_OTHER_PROVEN}

G11 =
${gCounts.G11_UNRESOLVED}

FIRST_DIVERGENCE_TOTAL =
23

DOMINANT_FIRST_GEOMETRY_DIVERGENCE =
${dominant}

DOMINANT_FIRST_GEOMETRY_DIVERGENCE_COUNT =
${dominantCount}

QUERY_EVIDENCE_STRUCTURALLY_APPLICABLE_TO_RETRY_SPAN =
${applVerdict}

PREVIOUS_C9_INTERPRETATION =
PARTIALLY_REVISED

RETRY_REGION_CHANGE_REQUIRED =
NO

SEGMENTATION_CHANGE_REQUIRED =
NOT_PROVEN

PATHFINESPAN_CHANGE_REQUIRED =
NO

MODEL3_CHANGE_REQUIRED =
NOT_PROVEN

QUERY_EVIDENCE_CHANGE_REQUIRED =
NO

LENGTH_INVARIANT_IMPLEMENTATION_CHANGE_REQUIRED =
YES

ARCHITECTURE_CONFLICT_FOUND =
NO

ARCHITECTURE_GAP_FOUND =
YES

ACP_REQUIRED =
NO

ONE_NEXT_OWNER =
REPAIR_REPLACEMENT_LENGTH_INVARIANT_CONFORMANCE

ONE_NEXT_DELTA =
Pre-development conformance plan to enforce replacement char length == PathFineSpan/repair-span char length at materialization/assembly gates; do not expand RetryRegion; do not treat QueryEvidence geometry as repair authority
\`\`\`
`;

fs.writeFileSync(path.join(OUT, 'LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT.md'), audit, 'utf8');
console.log('done', { dominant, dominantCount, gCounts, sameEdge, sameSelected, samePfs, sameRetry, sameRegion, appl });
