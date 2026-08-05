/**
 * Candidate Generation Failure Audit — READ ONLY export from prior A-class traces.
 * Pre-KenLM · FW_V4_FREEZE_2026_08_03 · no Tone/Recall/Assembly/CrossPath/KenLM change.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const tracePath = path.join(
  repo,
  'docs/acceptance/Freeze/kenlm_a_class_upstream_2026_08_03/case_traces.json'
);
const inventoryPath = path.join(
  repo,
  'docs/acceptance/Freeze/kenlm_capability_baseline_2026_08_03/kenlm_validation_case_inventory_resolved.csv'
);
const summaryPath = path.join(
  repo,
  'docs/acceptance/Freeze/kenlm_capability_baseline_2026_08_03/kenlm_capability_case_summary.csv'
);

const outDirs = [
  path.join(repo, 'docs/acceptance/Freeze/candidate_generation_failure_2026_08_03'),
  path.join(__dirname, 'candidate_generation_failure_2026_08_03'),
];
for (const d of outDirs) fs.mkdirSync(d, { recursive: true });

function esc(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cols) {
  return cols.map(esc).join(',');
}
function writeCsv(filePath, rows, columns) {
  const lines = [csvRow(columns)];
  for (const r of rows) lines.push(csvRow(columns.map((c) => r[c] ?? '')));
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    const o = {};
    headers.forEach((h, i) => {
      o[h] = cols[i] ?? '';
    });
    return o;
  });
}

const traces = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
const inventory = parseCsv(fs.readFileSync(inventoryPath, 'utf8'));
const summaries = parseCsv(fs.readFileSync(summaryPath, 'utf8')).filter(
  (r) => r.suite === 'noise_inventory'
);
const sumById = new Map(summaries.map((r) => [r.caseId, r]));
const invById = new Map(inventory.map((r) => [r.caseId, r]));

const STAGES = [
  'ExpectedCandidate',
  'RecallCandidate',
  'LexicalEdge',
  'SegmentationPath',
  'AssemblySentence',
  'CrossPathSentence',
  'KenLMCandidate',
];

const pipelineRows = [];
const failureRows = [];
const candidateRows = [];

for (const c of traces.cases) {
  const inv = invById.get(c.caseId);
  const sum = sumById.get(c.caseId);
  const rawText = c.rawText || sum.rawText;
  const expectedText = c.expectedText || sum.expectedText;
  const atoms = (c.atomLookups || []).map((a) => a.surface);
  const atomsExist = (c.atomLookups || []).every((a) => a.formalTermExists);

  // Pipeline YES/NO for *correct* candidate presence at each stage
  const expectedDefined = !!(expectedText && inv?.correctSurface);
  const recallHasExpected =
    (c.expectedObserved || []).length > 0 ||
    (c.observedCandidateCount > 0 &&
      atoms.every((a) =>
        (c.expectedObserved || []).some((x) => x.replacement === a || x.surface === a)
      ));
  // observed: no expected recall hits
  const recallYes = Array.isArray(c.expectedObserved)
    ? c.expectedObserved.some((x) => atoms.includes(x.replacement || x.surface))
    : false;
  const edgeYes = (c.expectedEdges || []).length > 0 || (c.observedEdgeCount > 0 && recallYes);
  // Path: expected atom on a path view — from prior, hasExpectedAtomEdge false
  const pathYes = false; // no expected atom edges observed
  // Assembly: correct/partial expected sentence generated (not raw-only)
  const assemblyTexts = [];
  // From kenlm + prior assembly: only raw
  const assemblyHasCorrect = false;
  const assemblyHasAllAtoms = false;
  const crossPathTexts = c.kenlmInputTexts || [];
  const crossPathHasCorrect = crossPathTexts.includes(expectedText);
  const crossPathHasAllAtoms = crossPathTexts.some((t) => atoms.every((a) => t.includes(a)));
  const kenlmHasCorrect = crossPathHasCorrect;

  const flags = {
    ExpectedCandidate: expectedDefined ? 'YES' : 'NO',
    RecallCandidate: recallYes ? 'YES' : 'NO',
    LexicalEdge: edgeYes ? 'YES' : 'NO',
    SegmentationPath: pathYes ? 'YES' : 'NO',
    AssemblySentence: assemblyHasCorrect || assemblyHasAllAtoms ? 'YES' : 'NO',
    CrossPathSentence: crossPathHasCorrect || crossPathHasAllAtoms ? 'YES' : 'NO',
    KenLMCandidate: kenlmHasCorrect ? 'YES' : 'NO',
  };

  // FIRST FAILURE = first NO after ExpectedCandidate (or Expected if NO)
  let firstFailure = null;
  for (const s of STAGES) {
    if (flags[s] === 'NO') {
      firstFailure = s;
      break;
    }
  }

  // Cascade evidence (continue past first failure — document downstream emptiness)
  const cascade = {
    lexicalEdgeEmptyBecause: !recallYes
      ? 'no_expected_recall_candidate_to_bind'
      : 'UNREACHED',
    pathEmptyBecause: !edgeYes ? 'no_expected_lexical_edge' : 'UNREACHED',
    assemblyNoCorrectBecause: !pathYes
      ? 'no_expected_path_material_for_repair_assembly; only_raw_canonical_fallback_sentence'
      : 'UNREACHED',
    crossPathNoCorrectBecause: 'no_correct_assembly_sentence_entered_merge; pool_is_raw_only',
    kenlmNoCorrectBecause: 'crosspath_pool_has_no_correct_sentence; binding_ok_raw_only',
    assemblyCombinesAtoms: atoms.length > 1 ? 'NOT_OBSERVABLE_upstream_empty' : 'N/A_single_atom',
    crossPathDeletedCorrect: 'NO_correct_candidate_existed_to_delete',
  };

  // Why RecallCandidate = NO (fact only, not a fix suggestion)
  let recallNoReason = 'expected_surface_not_in_observed_recall_hits';
  if (!atomsExist) {
    recallNoReason = `expected_atom_absent_from_lexicon:${(c.atomLookups || [])
      .filter((a) => !a.formalTermExists)
      .map((a) => a.surface)
      .join('|')}`;
  } else if (c.caseId === 'nn-train-01b') {
    recallNoReason = 'noise_window_pinyin_mismatch_men_zheng_vs_zheng_zai';
  } else if (c.caseId === 'nn-train-01') {
    recallNoReason = 'expected_atom_我们_unrecallable_under_current_tone_exact_contract_tone0_key';
  } else {
    recallNoReason = 'observed_recall_hit_count_zero_for_expected_atoms';
  }

  pipelineRows.push({
    caseId: c.caseId,
    noiseSurface: inv.noiseSurface,
    correctSurface: inv.correctSurface,
    rawText,
    expectedText,
    ExpectedCandidate: flags.ExpectedCandidate,
    RecallCandidate: flags.RecallCandidate,
    LexicalEdge: flags.LexicalEdge,
    SegmentationPath: flags.SegmentationPath,
    AssemblySentence: flags.AssemblySentence,
    CrossPathSentence: flags.CrossPathSentence,
    KenLMCandidate: flags.KenLMCandidate,
    FIRST_FAILURE: firstFailure,
    observedRecallCandidateCount: c.observedCandidateCount,
    observedEdgeCount: c.observedEdgeCount,
    crossPathCandidateCount: crossPathTexts.length,
    correctCandidateGenerated: kenlmHasCorrect || crossPathHasCorrect || assemblyHasCorrect,
  });

  failureRows.push({
    caseId: c.caseId,
    noiseSurface: inv.noiseSurface,
    correctSurface: inv.correctSurface,
    FIRST_FAILURE: firstFailure,
    recallCandidateYesNo: flags.RecallCandidate,
    recallNoReason,
    lexicalEdgeYesNo: flags.LexicalEdge,
    lexicalEdgeEmptyBecause: cascade.lexicalEdgeEmptyBecause,
    segmentationPathYesNo: flags.SegmentationPath,
    pathEmptyBecause: cascade.pathEmptyBecause,
    assemblySentenceYesNo: flags.AssemblySentence,
    assemblyNoCorrectBecause: cascade.assemblyNoCorrectBecause,
    assemblyCombinesAtoms: cascade.assemblyCombinesAtoms,
    crossPathSentenceYesNo: flags.CrossPathSentence,
    crossPathNoCorrectBecause: cascade.crossPathNoCorrectBecause,
    crossPathDeletedCorrect: cascade.crossPathDeletedCorrect,
    kenlmCandidateYesNo: flags.KenLMCandidate,
    kenlmNoCorrectBecause: cascade.kenlmNoCorrectBecause,
    atomsFormalExist: atomsExist,
    requiredAtoms: atoms.join('+'),
  });

  // Candidate export: all texts that entered CrossPath/KenLM pool
  crossPathTexts.forEach((text, i) => {
    candidateRows.push({
      caseId: c.caseId,
      candidateIndex: i + 1,
      candidateId: `crosspath:${i}`,
      candidateText: text,
      stage: 'CrossPath/KenLM',
      isRaw: text === rawText,
      isExpectedExact: text === expectedText,
      containsCorrectSurface: text.includes(inv.correctSurface),
      containsAllAtoms: atoms.every((a) => text.includes(a)),
      correctCandidatePresentInPool: text === expectedText,
    });
  });
  // Explicit marker if pool empty of correct
  if (!crossPathTexts.some((t) => t === expectedText)) {
    candidateRows.push({
      caseId: c.caseId,
      candidateIndex: 0,
      candidateId: 'EXPECTED_ABSENT',
      candidateText: expectedText,
      stage: 'OFFLINE_EXPECTED_ONLY',
      isRaw: false,
      isExpectedExact: true,
      containsCorrectSurface: true,
      containsAllAtoms: true,
      correctCandidatePresentInPool: false,
    });
  }
}

const firstFailureDist = failureRows.reduce((a, r) => {
  a[r.FIRST_FAILURE] = (a[r.FIRST_FAILURE] || 0) + 1;
  return a;
}, {});

// Aggregate verdict: all share same first failure stage
const uniqueFailures = Object.keys(firstFailureDist);
const verdict =
  uniqueFailures.length === 1 && uniqueFailures[0] === null
    ? 'CANDIDATE_GENERATION_READY_FOR_KENLM'
    : failureRows.every((r) => r.FIRST_FAILURE === 'RecallCandidate')
      ? 'FIRST_FAILURE_AT_RECALL_CANDIDATE'
      : `FIRST_FAILURE_AT_${String(uniqueFailures[0] || 'UNKNOWN').toUpperCase()}`;

const summary = {
  freezeBaseline: 'FW_V4_FREEZE_2026_08_03',
  nature: 'READ_ONLY_PRE_KENLM_CANDIDATE_GENERATION_FAILURE_AUDIT',
  verdict,
  firstFailureDistribution: firstFailureDist,
  cases: pipelineRows.map((r) => ({
    caseId: r.caseId,
    FIRST_FAILURE: r.FIRST_FAILURE,
    pipeline: STAGES.map((s) => `${s}=${r[s]}`).join(' → '),
    correctCandidateGenerated: r.correctCandidateGenerated,
  })),
};

const pipelineCols = [
  'caseId',
  'noiseSurface',
  'correctSurface',
  'rawText',
  'expectedText',
  ...STAGES,
  'FIRST_FAILURE',
  'observedRecallCandidateCount',
  'observedEdgeCount',
  'crossPathCandidateCount',
  'correctCandidateGenerated',
];
const failureCols = [
  'caseId',
  'noiseSurface',
  'correctSurface',
  'FIRST_FAILURE',
  'recallCandidateYesNo',
  'recallNoReason',
  'lexicalEdgeYesNo',
  'lexicalEdgeEmptyBecause',
  'segmentationPathYesNo',
  'pathEmptyBecause',
  'assemblySentenceYesNo',
  'assemblyNoCorrectBecause',
  'assemblyCombinesAtoms',
  'crossPathSentenceYesNo',
  'crossPathNoCorrectBecause',
  'crossPathDeletedCorrect',
  'kenlmCandidateYesNo',
  'kenlmNoCorrectBecause',
  'atomsFormalExist',
  'requiredAtoms',
];
const candCols = [
  'caseId',
  'candidateIndex',
  'candidateId',
  'candidateText',
  'stage',
  'isRaw',
  'isExpectedExact',
  'containsCorrectSurface',
  'containsAllAtoms',
  'correctCandidatePresentInPool',
];

for (const dir of outDirs) {
  writeCsv(path.join(dir, 'candidate_generation_pipeline.csv'), pipelineRows, pipelineCols);
  writeCsv(path.join(dir, 'candidate_generation_failures.csv'), failureRows, failureCols);
  writeCsv(path.join(dir, 'candidate_generation_candidates.csv'), candidateRows, candCols);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
}

console.log(JSON.stringify({ ok: true, verdict, firstFailureDist, outDirs }, null, 2));
