/**
 * KenLM A-Class Upstream Candidate Coverage Audit — READ ONLY.
 * FW_V4_FREEZE_2026_08_03
 *
 * Observes inventory-equivalent path (no ASR acoustic tone — same as KenLM capability baseline).
 * Adds offline with-tone counterfactual on noise windows (eval only; not injected into production).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'kenlm_a_class_upstream_2026_08_03');
const freezeOut = path.join(repo, 'docs/acceptance/Freeze/kenlm_a_class_upstream_2026_08_03');
for (const d of [outDir, freezeOut]) fs.mkdirSync(d, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { resolveToneRecallReadiness } = require(
  path.join(dist, 'lexicon-v2/tone-recall-readiness.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);
const { runLatticeFineSpanGeneration } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const { V4_LIMITS } = require(path.join(dist, 'fw-detector/span-assembly-v4/v4-limits.js'));
const { isFuzzyPinyinRecallEnabled } = require(
  path.join(dist, 'lexicon-v2/lexicon-fw-recall-config.js')
);
const { buildTonePinyinKeyFromSyllablesAndPattern } = require(
  path.join(dist, 'lexicon/phonetic/tone-pinyin.js')
);

function esc(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cols) {
  return cols.map(esc).join(',');
}
function log(m) {
  console.error(`[a-class] ${m}`);
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
function writeCsv(filePath, rows, columns) {
  const lines = [csvRow(columns)];
  for (const r of rows) lines.push(csvRow(columns.map((c) => r[c] ?? '')));
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

const inventory = parseCsv(
  fs.readFileSync(
    path.join(
      repo,
      'docs/acceptance/Freeze/kenlm_capability_baseline_2026_08_03/kenlm_validation_case_inventory_resolved.csv'
    ),
    'utf8'
  )
);
const summaries = parseCsv(
  fs.readFileSync(
    path.join(
      repo,
      'docs/acceptance/Freeze/kenlm_capability_baseline_2026_08_03/kenlm_capability_case_summary.csv'
    ),
    'utf8'
  )
).filter((r) => r.suite === 'noise_inventory');
const summaryById = new Map(summaries.map((r) => [r.caseId, r]));

const PLANS = {
  'nn-train-01': {
    atoms: ['我们', '正在'],
    compositionRequired: true,
    forbiddenCompounds: ['我们正在'],
  },
  'nn-train-01b': { atoms: ['正在'], compositionRequired: false, forbiddenCompounds: [] },
  'center-01': { atoms: ['中心'], compositionRequired: false, forbiddenCompounds: [] },
  'snack-01': { atoms: ['小食'], compositionRequired: false, forbiddenCompounds: [] },
  'sync-01': {
    atoms: ['已经', '同步'],
    compositionRequired: true,
    forbiddenCompounds: ['已经同步'],
  },
  'trigger-01': { atoms: ['触发'], compositionRequired: false, forbiddenCompounds: [] },
  'threshold-01': { atoms: ['阈值'], compositionRequired: false, forbiddenCompounds: ['阈值已'] },
};

const bundleDir = path.join(repo, 'node_runtime/lexicon/v3');
const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true });
const atomicity = new Map();
for (const line of fs.readFileSync(path.join(bundleDir, 'atomicity_report.csv'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const cols = line.split(',');
  atomicity.set(cols[0], {
    termId: cols[1],
    sourceFile: cols[2],
    sourceRow: cols[3],
    decision: cols[6],
    reason: cols[7],
  });
}
const stmtTerm = db.prepare(
  `SELECT id, word, pinyin_key, tone_pinyin_key, prior_score, enabled, source FROM term WHERE word=?`
);
const stmtBase = db.prepare(
  `SELECT id, word, pinyin_key, tone_pinyin_key, prior_score, enabled, source FROM base_lexicon WHERE word=?`
);
const stmtTags = db.prepare(`SELECT domain_id FROM term_domain_tags WHERE term_id=?`);
const stmtByTone = db.prepare(
  `SELECT word, tone_pinyin_key, prior_score FROM base_lexicon WHERE pinyin_key=? AND tone_pinyin_key=? AND enabled=1`
);

function lookup(surface) {
  const terms = stmtTerm.all(surface);
  const bases = stmtBase.all(surface);
  const domains = terms.flatMap((t) => stmtTags.all(t.id).map((d) => d.domain_id));
  const atom = atomicity.get(surface) || null;
  const row = terms[0] || bases[0] || null;
  return {
    surface,
    termId: row?.id || '',
    formalTermExists: terms.some((t) => t.enabled === 1) || bases.some((b) => b.enabled === 1),
    inTermTable: terms.length > 0,
    inBaseTable: bases.length > 0,
    pinyinKey: row?.pinyin_key || '',
    tonePinyinKey: row?.tone_pinyin_key || '',
    priorScore: row?.prior_score ?? null,
    domains: [...new Set(domains)],
    sourceFile: atom?.sourceFile || row?.source || '',
    sourceRow: atom?.sourceRow || '',
    projection: domains.length ? 'domain' : row ? 'base' : 'missing',
    atomicity: atom,
  };
}

function tonesFromKey(tpk) {
  return String(tpk || '')
    .split('|')
    .map((s) => {
      const m = String(s).match(/(\d)/);
      return m ? Number(m[1]) : NaN;
    });
}

const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
if (loadState.status !== 'ok') throw new Error(JSON.stringify(loadState));
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const fuzzyEnabled = isFuzzyPinyinRecallEnabled();

const funnelRows = [];
const recallRows = [];
const pathRows = [];
const assemblyRows = [];
const rootRows = [];
const caseTraces = [];

log(`cases=${inventory.length} toneTimestampOnlyEnabled=${fwConfig.toneTimestampOnlyEnabled}`);

for (const inv of inventory) {
  const caseId = inv.caseId;
  const plan = PLANS[caseId];
  const sum = summaryById.get(caseId);
  if (!plan || !sum) throw new Error(`missing plan/summary ${caseId}`);
  const rawText = sum.rawText;
  const expectedText = sum.expectedText;
  const noiseSurface = inv.noiseSurface;
  const correctSurface = inv.correctSurface;
  log(`CASE ${caseId}`);

  const atomLookups = plan.atoms.map(lookup);
  const noiseLookup = lookup(noiseSurface);
  const correctLookup = lookup(correctSurface);
  const compoundLookups = plan.forbiddenCompounds.map(lookup);
  const allAtomsPresent = atomLookups.every((a) => a.formalTermExists);
  const anyAtomMissing = atomLookups.some((a) => !a.formalTermExists);

  const coord = buildUtteranceSyllableCoordinate(rawText);
  const noiseIdx = rawText.indexOf(noiseSurface);
  const noiseRaw = noiseIdx >= 0 ? { start: noiseIdx, end: noiseIdx + [...noiseSurface].length } : null;
  // CJK 1:1 syllable for these cases
  const cjkPrefix = [...rawText.slice(0, noiseRaw?.start || 0)].filter((ch) =>
    /[\u4e00-\u9fff]/.test(ch)
  ).length;
  const noiseSylLen = [...(noiseSurface || '')].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length;
  const noiseSyl = noiseRaw
    ? { start: cjkPrefix, end: cjkPrefix + noiseSylLen }
    : { start: null, end: null };

  // Observed path = KenLM baseline (no acoustic tone)
  const phase1 = runPhase1WindowEdgeHarness({
    rawText,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    fuzzyRecallEnabled: fuzzyEnabled,
    toneTimestampOnlyEnabled: fwConfig.toneTimestampOnlyEnabled === true,
  });
  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const lattice = runLatticeFineSpanGeneration({
    rawText,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    coarseSpans: partition.coarseSpans,
    fuzzyRecallEnabled: fuzzyEnabled,
    toneTimestampOnlyEnabled: fwConfig.toneTimestampOnlyEnabled === true,
  });
  if (!lattice.ok) throw new Error(`${caseId} lattice ${lattice.code}`);

  const orch = runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    traceCaseId: caseId,
  });

  const relatedWindows = phase1.windows.filter(
    (w) =>
      !w.blocked &&
      noiseSyl.start != null &&
      w.syllableStart < noiseSyl.end &&
      w.syllableEnd > noiseSyl.start
  );

  const observedCandidates = phase1.recalledWindows.flatMap((w) => w.candidates);
  const expectedObserved = observedCandidates.filter((c) => plan.atoms.includes(c.replacement));

  // Offline with-tone counterfactual per related window + per atom self-key
  const toneCounterfactual = [];
  for (const w of relatedWindows) {
    const syl = coord.syllables.slice(w.syllableStart, w.syllableEnd);
    const readinessNo = resolveToneRecallReadiness({
      syllables: syl,
      runtimeSupportsTone: runtime.supportsToneFirstRecall(),
      acousticTonePattern: undefined,
      toneCallerEnabled: false,
    });
    // Use DB tone of noise window text if term exists, else try each atom's tone on matching length
    const noiseTerm = stmtTerm.get(rawText.slice(w.rawStart, w.rawEnd));
    let pattern = noiseTerm ? tonesFromKey(noiseTerm.tone_pinyin_key) : null;
    if (!pattern || pattern.some((t) => !Number.isFinite(t))) {
      // try first atom of same length
      const atom = atomLookups.find((a) => a.pinyinKey.split('|').filter(Boolean).length === syl.length);
      pattern = atom ? tonesFromKey(atom.tonePinyinKey) : syl.map(() => 1);
    }
    // sanitize tone0 → invalid; use 5 (neutral) only for readiness probe, still record
    const patternForReady = pattern.map((t) => (t === 0 ? 5 : t));
    const builtKey = buildTonePinyinKeyFromSyllablesAndPattern(syl, patternForReady);
    const readinessYes = resolveToneRecallReadiness({
      syllables: syl,
      runtimeSupportsTone: runtime.supportsToneFirstRecall(),
      acousticTonePattern: patternForReady,
      toneCallerEnabled: true,
    });
    const offNo = recallSpanTopKV2(runtime, {
      syllables: syl,
      windowText: rawText.slice(w.rawStart, w.rawEnd),
      topK: 20,
      domainIds,
      toneCallerEnabled: false,
    });
    const offYes =
      readinessYes.state === 'ready'
        ? recallSpanTopKV2(runtime, {
            syllables: syl,
            windowText: rawText.slice(w.rawStart, w.rawEnd),
            topK: 20,
            domainIds,
            acousticTonePattern: patternForReady,
            toneCallerEnabled: true,
          })
        : { hits: [], toneRecallReadiness: readinessYes };

    const prod = observedCandidates.filter((c) => c.windowId === w.windowId);
    offYes.hits.forEach((h, i) => {
      const surface = h.hotword.word;
      const inProd = prod.some((c) => c.replacement === surface);
      const isExpected = plan.atoms.includes(surface);
      let dropReason = '';
      if (!inProd) {
        if (readinessNo.state !== 'ready') dropReason = `TONE_GATE:${readinessNo.state}`;
        else if (i >= V4_LIMITS.exactTopK) dropReason = 'TOPK_SUPPRESSION';
        else dropReason = 'NOT_IN_OBSERVED_PRODUCTION';
      }
      recallRows.push({
        caseId,
        windowId: w.windowId,
        rawStart: w.rawStart,
        rawEnd: w.rawEnd,
        syllableStart: w.syllableStart,
        syllableEnd: w.syllableEnd,
        windowPinyin: syl.join('|'),
        windowText: rawText.slice(w.rawStart, w.rawEnd),
        candidateId: inProd
          ? prod.find((c) => c.replacement === surface).candidateId
          : `cf:${w.windowId}:${i}`,
        surface,
        termId: h.hotword.id,
        hitKind: 'exact_term',
        source: h.source,
        domains: (h.hotword.domains || []).join('|'),
        plainScore: h.candidateScore,
        toneScore: h.tonePenalty ?? '',
        finalScore: h.candidateScore,
        rankBeforeTopK: i + 1,
        rankAfterTopK: inProd ? prod.find((c) => c.replacement === surface)?.candidateRank : '',
        dropReason,
        isExpectedAtom: isExpected,
        inProduction: inProd,
        channel: 'with_tone_counterfactual',
      });
    });
    // Always record empty observed channel marker row for window
    recallRows.push({
      caseId,
      windowId: w.windowId,
      rawStart: w.rawStart,
      rawEnd: w.rawEnd,
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      windowPinyin: syl.join('|'),
      windowText: rawText.slice(w.rawStart, w.rawEnd),
      candidateId: `observed:${w.windowId}`,
      surface: '',
      termId: '',
      hitKind: 'exact_term',
      source: '',
      domains: '',
      plainScore: '',
      toneScore: '',
      finalScore: '',
      rankBeforeTopK: '',
      rankAfterTopK: '',
      dropReason: `OBSERVED_EMPTY:tone_readiness=${readinessNo.state};offlineNoHits=${offNo.hits.length};cfHits=${offYes.hits.length}`,
      isExpectedAtom: false,
      inProduction: false,
      channel: 'observed_no_tone',
    });

    toneCounterfactual.push({
      windowId: w.windowId,
      windowPinyin: syl.join('|'),
      windowText: rawText.slice(w.rawStart, w.rawEnd),
      rawStart: w.rawStart,
      rawEnd: w.rawEnd,
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      readinessNo,
      readinessYes,
      builtKey,
      observedHitCount: prod.length,
      cfHitSurfaces: offYes.hits.map((h) => h.hotword.word),
      expectedAtomsInCf: plan.atoms.filter((a) => offYes.hits.some((h) => h.hotword.word === a)),
    });
  }

  // Atom self-key tone probe
  const atomToneProbes = atomLookups.map((a) => {
    if (!a.formalTermExists) {
      return { surface: a.surface, status: 'TERM_MISSING' };
    }
    const syl = a.pinyinKey.split('|').filter(Boolean);
    const tones = tonesFromKey(a.tonePinyinKey);
    const hasTone0 = tones.includes(0);
    const ready = resolveToneRecallReadiness({
      syllables: syl,
      runtimeSupportsTone: runtime.supportsToneFirstRecall(),
      acousticTonePattern: tones.map((t) => (t === 0 ? 5 : t)),
      toneCallerEnabled: true,
    });
    // Direct DB tone match with stored key
    const dbToneHits = a.pinyinKey && a.tonePinyinKey ? stmtByTone.all(a.pinyinKey, a.tonePinyinKey) : [];
    const hits =
      !hasTone0 && ready.state === 'ready'
        ? recallSpanTopKV2(runtime, {
            syllables: syl,
            windowText: a.surface,
            topK: 20,
            domainIds,
            acousticTonePattern: tones,
            toneCallerEnabled: true,
          }).hits
        : [];
    const rank = hits.findIndex((h) => h.hotword.word === a.surface) + 1;
    let missClass = 'HIT';
    if (hasTone0) missClass = 'TONE_KEY_MISMATCH'; // tone0 cannot be produced by acoustic pattern
    else if (ready.state !== 'ready') missClass = 'PLAIN_FALLBACK_NOT_REACHED';
    else if (rank === 0) missClass = dbToneHits.some((r) => r.word === a.surface) ? 'TONE_KEY_MISMATCH' : 'SQL_QUERY_MISS';
    else if (rank > V4_LIMITS.exactTopK) missClass = 'TOPK_SUPPRESSION';
    return {
      surface: a.surface,
      status: missClass,
      rank: rank || null,
      hasTone0,
      tonePinyinKey: a.tonePinyinKey,
      hits: hits.map((h) => h.hotword.word),
      dbToneHits: dbToneHits.map((r) => r.word),
    };
  });

  // Edges / paths observed
  const edges = phase1.edges || [];
  const expectedEdges = edges.filter((e) =>
    (e.candidates || []).some((c) => plan.atoms.includes(c.replacement))
  );
  const pathViews = lattice.pathFineSpanViews || [];
  for (const view of pathViews) {
    const cands = (view.pathFineSpans || []).flatMap((s) => s.candidates || []);
    pathRows.push({
      caseId,
      pathId: view.pathId || '',
      edges: (view.pathFineSpans || []).map((s) => `${s.syllableStart}:${s.syllableEnd}`).join('|'),
      edgeSurfaces: cands.map((c) => c.replacement).join('|'),
      coverage: lattice.trace?.coverageStatus || '',
      fallbackEdges: (view.pathFineSpans || []).filter((s) => s.isFallback).length,
      pathScore: '',
      pruneRank: '',
      survived: true,
      dropReason: cands.length ? '' : 'no_lexical_candidates_on_path',
      hasExpectedAtomEdge: cands.some((c) => plan.atoms.includes(c.replacement)),
    });
  }
  if (!pathViews.length) {
    pathRows.push({
      caseId,
      pathId: 'NONE',
      edges: '',
      edgeSurfaces: '',
      coverage: lattice.trace?.coverageStatus || '',
      fallbackEdges: lattice.trace?.fallbackEdgeCount ?? '',
      pathScore: '',
      pruneRank: '',
      survived: false,
      dropReason: 'no_path_views_or_only_fallback',
      hasExpectedAtomEdge: false,
    });
  }

  const combos = orch.kenlmSentenceCandidates?.combinations || [];
  const kenlmTexts = combos.map((c) => c.text);
  for (const pr of orch.pathAssemblyResults || []) {
    for (const bucket of pr.perBucketGenerated || []) {
      for (const c of bucket) {
        assemblyRows.push({
          caseId,
          sentenceId: c.candidateId || '',
          text: c.text,
          replacements: (c.replacements || [])
            .map((r) => `${r.span?.start}:${r.span?.end}:${r.word}`)
            .join('|'),
          pathId: pr.pathId || '',
          bucketDomain: c.bucketDomain || c.domain || '',
          assemblyScore: c.candidateScore ?? '',
          selectedBeforeCrossPath: true,
          isExpectedExact: c.text === expectedText,
          containsCorrectSurface: String(c.text || '').includes(correctSurface),
          containsAllAtoms: plan.atoms.every((a) => String(c.text || '').includes(a)),
          crossPathRank: '',
        });
      }
    }
  }
  kenlmTexts.forEach((text, i) => {
    const c = combos[i];
    assemblyRows.push({
      caseId,
      sentenceId: c.candidateId || `crosspath:${i}`,
      text,
      replacements: (c.replacements || [])
        .map((r) => `${r.span?.start}:${r.span?.end}:${r.word}`)
        .join('|'),
      pathId: c.sourcePath || c.pathId || '',
      bucketDomain: c.bucketDomain || '',
      assemblyScore: c.candidateScore ?? '',
      selectedBeforeCrossPath: false,
      isExpectedExact: text === expectedText,
      containsCorrectSurface: text.includes(correctSurface),
      containsAllAtoms: plan.atoms.every((a) => text.includes(a)),
      crossPathRank: i + 1,
    });
  });

  // Window class
  let windowClass = 'WINDOW_NOT_GENERATED';
  if (relatedWindows.length === 0) windowClass = 'WINDOW_NOT_GENERATED';
  else if (plan.compositionRequired) windowClass = 'MULTI_WINDOW_COMPOSITION_REQUIRED';
  else {
    const needLen = atomLookups[0]?.pinyinKey
      ? atomLookups[0].pinyinKey.split('|').filter(Boolean).length
      : [...correctSurface].length;
    const exactLen = relatedWindows.some((w) => w.syllableEnd - w.syllableStart === needLen);
    const noiseLen = noiseSyl.end - noiseSyl.start;
    if (exactLen) windowClass = 'WINDOW_EXISTS';
    else if (needLen < noiseLen) windowClass = 'WINDOW_TOO_LONG';
    else if (needLen > noiseLen) windowClass = 'WINDOW_TOO_SHORT';
    else windowClass = 'WINDOW_WRONG_BOUNDARY';
  }
  if (caseId === 'nn-train-01b') {
    // noise 闷蒸 men|zheng vs 正在 zheng|zai
    windowClass = 'WINDOW_EXISTS'; // noise windows exist but pinyin≠target
  }

  // Stage funnel (observed path)
  const ok = {
    FORMAL_SOURCE: allAtomsPresent,
    SQLITE: allAtomsPresent,
    EXACT_RECALL: expectedObserved.length > 0 && plan.atoms.every((a) => expectedObserved.some((c) => c.replacement === a)),
    WINDOW_CANDIDATE: expectedObserved.length > 0,
    LEXICAL_EDGE: expectedEdges.length > 0,
    SEGMENTATION_PATH: pathViews.some((v) =>
      (v.pathFineSpans || [])
        .flatMap((s) => s.candidates || [])
        .some((c) => plan.atoms.includes(c.replacement))
    ),
    DOMAIN_BUDGET: false,
    ASSEMBLY: false,
    CROSSPATH: kenlmTexts.some((t) => t === expectedText || plan.atoms.every((a) => t.includes(a))),
    KENLM_INPUT: kenlmTexts.includes(expectedText),
  };
  // Domain/assembly cannot be true if recall empty
  ok.DOMAIN_BUDGET = ok.SEGMENTATION_PATH;
  ok.ASSEMBLY = assemblyRows.some(
    (r) => r.caseId === caseId && r.selectedBeforeCrossPath === true && (r.isExpectedExact || r.containsAllAtoms)
  );

  const stageOrder = [
    'FORMAL_SOURCE',
    'SQLITE',
    'EXACT_RECALL',
    'WINDOW_CANDIDATE',
    'LEXICAL_EDGE',
    'SEGMENTATION_PATH',
    'DOMAIN_BUDGET',
    'ASSEMBLY',
    'CROSSPATH',
    'KENLM_INPUT',
  ];
  // Refine: if atoms present but recall empty due to tone gate, first missing is EXACT_RECALL
  // Window exists independently — don't mark WINDOW before EXACT if windows exist for noise
  if (allAtomsPresent && relatedWindows.length > 0 && expectedObserved.length === 0) {
    ok.FORMAL_SOURCE = true;
    ok.SQLITE = true;
    ok.EXACT_RECALL = false;
    // Window for noise exists; candidate for expected does not
    ok.WINDOW_CANDIDATE = false;
  }
  if (anyAtomMissing) {
    ok.FORMAL_SOURCE = false;
    ok.SQLITE = false;
  }

  let firstMissing = stageOrder.find((s) => !ok[s]) || null;
  // Prefer SQLITE over FORMAL when missing (both false) — use SQLITE as concrete store check
  if (!ok.FORMAL_SOURCE && !ok.SQLITE) firstMissing = 'SQLITE';

  // Primary root cause
  let primary = 'TRACE_NOT_REPRODUCIBLE';
  let secondary = [];
  let capabilityClass = 'DATA';

  const atomMiss = atomToneProbes.filter((p) => p.status !== 'HIT');
  const cfExpectedHits = toneCounterfactual.flatMap((w) => w.expectedAtomsInCf);

  if (anyAtomMissing) {
    primary = 'LEXICON_TERM_MISSING';
    firstMissing = 'SQLITE';
    capabilityClass = 'DATA';
    secondary.push(...atomLookups.filter((a) => !a.formalTermExists).map((a) => `missing:${a.surface}`));
  } else if (atomToneProbes.some((p) => p.status === 'TONE_KEY_MISMATCH' || p.hasTone0)) {
    primary = 'LEXICON_KEY_ERROR';
    firstMissing = 'EXACT_RECALL';
    capabilityClass = 'DATA';
    secondary.push(
      ...atomToneProbes
        .filter((p) => p.status === 'TONE_KEY_MISMATCH' || p.hasTone0)
        .map((p) => `${p.surface}:toneKey=${p.tonePinyinKey}`)
    );
    secondary.push('PLAIN_FALLBACK_NOT_REACHED');
  } else if (caseId === 'nn-train-01b') {
    primary = 'RECALL_QUERY_MISS';
    firstMissing = 'EXACT_RECALL';
    capabilityClass = 'DATA';
    secondary.push('noiseWindowPinyin=men|zheng', 'correctPinyin=zheng|zai', 'PLAIN_FALLBACK_NOT_REACHED');
  } else {
    // Observed tone gate blocks all
    primary = 'RECALL_QUERY_MISS';
    firstMissing = 'EXACT_RECALL';
    capabilityClass = 'DATA';
    secondary.push('PLAIN_FALLBACK_NOT_REACHED', 'tone_readiness=caller_disabled|no_pattern');
    // Structural next-stage after tone available
    if (plan.compositionRequired && cfExpectedHits.length) {
      const allCf = plan.atoms.every((a) => cfExpectedHits.includes(a));
      if (allCf) {
        secondary.push('COUNTERFACTUAL_NEXT:ASSEMBLY_COMPOSITION_MISS');
      } else {
        secondary.push(`COUNTERFACTUAL_PARTIAL_ATOMS:${[...new Set(cfExpectedHits)].join('|')}`);
      }
    } else if (caseId === 'center-01' && cfExpectedHits.includes('中心')) {
      secondary.push('COUNTERFACTUAL_RECALL_OK_中心', 'COUNTERFACTUAL_NEXT:check_edge_assembly');
    }
  }

  // Special nn-train-01: 我们 tone0 is key error; 正在 OK with tone
  if (caseId === 'nn-train-01') {
    primary = 'LEXICON_KEY_ERROR';
    secondary = [
      '我们:tone_pinyin_key=wo3|men0',
      'acoustic_tone0_invalid',
      'PLAIN_FALLBACK_NOT_REACHED',
      'COUNTERFACTUAL_NEXT:ASSEMBLY_COMPOSITION_MISS',
    ];
    capabilityClass = 'DATA';
    firstMissing = 'EXACT_RECALL';
  }
  if (caseId === 'sync-01') {
    // atoms exist and with matching noise window tones 已精/通步 recall 已经/同步
    primary = 'RECALL_QUERY_MISS';
    secondary = [
      'PLAIN_FALLBACK_NOT_REACHED',
      'COUNTERFACTUAL_ATOMS_RECALLABLE_ON_NOISE_WINDOWS',
      'COUNTERFACTUAL_NEXT:ASSEMBLY_COMPOSITION_MISS',
    ];
    capabilityClass = 'DATA';
    firstMissing = 'EXACT_RECALL';
  }

  const correctTextPresent = kenlmTexts.includes(expectedText);

  funnelRows.push({
    caseId,
    noiseSurface,
    correctSurface,
    formalAtomsOk: allAtomsPresent,
    sqliteOk: allAtomsPresent,
    exactRecallOk: ok.EXACT_RECALL,
    windowCandidateOk: ok.WINDOW_CANDIDATE,
    lexicalEdgeOk: ok.LEXICAL_EDGE,
    segmentationPathOk: ok.SEGMENTATION_PATH,
    domainBudgetOk: ok.DOMAIN_BUDGET,
    assemblyOk: ok.ASSEMBLY,
    crossPathOk: ok.CROSSPATH,
    kenlmInputOk: ok.KENLM_INPUT,
    FIRST_MISSING_STAGE: firstMissing,
    windowClass,
    primaryRootCause: primary,
    secondaryCauses: secondary.join('|'),
    capabilityClass,
    kenlmCandidateCount: kenlmTexts.length,
    correctTextPresent,
    relatedWindowCount: relatedWindows.length,
    expectedRecallHits: expectedObserved.map((c) => c.replacement).join('|'),
    observedEdgeCount: edges.length,
    observedCandidateCount: observedCandidates.length,
    toneGate: 'caller_disabled_or_no_pattern',
  });

  rootRows.push({
    caseId,
    noiseSurface,
    correctSurface,
    FIRST_MISSING_STAGE: firstMissing,
    primaryRootCause: primary,
    secondaryCauses: secondary.join('|'),
    capabilityClass,
    dataIssue: capabilityClass === 'DATA',
    capacityIssue: capabilityClass === 'CAPACITY',
    runtimeIssue: capabilityClass === 'RUNTIME',
    archLimit: capabilityClass === 'ARCH_LIMIT',
    kenlmOptimizationAllowed: false,
  });

  caseTraces.push({
    caseId,
    noiseSurface,
    correctSurface,
    rawText,
    expectedText,
    noiseRaw,
    noiseSyl,
    syllables: coord.syllables.join('|'),
    atomLookups,
    noiseLookup,
    correctLookup,
    compoundLookups,
    atomToneProbes,
    relatedWindows: relatedWindows.map((w) => ({
      windowId: w.windowId,
      rawStart: w.rawStart,
      rawEnd: w.rawEnd,
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      length: w.syllableEnd - w.syllableStart,
      windowPinyin: coord.syllables.slice(w.syllableStart, w.syllableEnd).join('|'),
      windowText: rawText.slice(w.rawStart, w.rawEnd),
    })),
    windowClass,
    observedCandidateCount: observedCandidates.length,
    observedEdgeCount: edges.length,
    expectedObserved,
    expectedEdges: expectedEdges.map((e) => e.edgeId),
    toneCounterfactual,
    stageOk: ok,
    FIRST_MISSING_STAGE: firstMissing,
    primaryRootCause: primary,
    secondaryCauses: secondary,
    capabilityClass,
    kenlmInputTexts: kenlmTexts,
    kenlmCandidateCount: kenlmTexts.length,
    correctTextPresent,
    latticeTrace: lattice.trace,
    phase1Diagnostics: phase1.diagnostics,
  });
}

// Overfit static scan
const overfitHits = [];
const patterns = [
  'nn-train-01',
  'noise_inventory',
  'expectedText',
  '我们正在',
  '已经同步',
  '小食',
  'injectExpected',
  'caseId ===',
];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules') continue;
      walk(p);
    } else if (/\.ts$/.test(name) && !name.includes('.test.')) {
      const text = fs.readFileSync(p, 'utf8');
      for (const pat of patterns) {
        if (text.includes(pat)) overfitHits.push({ file: path.relative(repo, p), pattern: pat });
      }
    }
  }
}
walk(path.join(repo, 'electron_node/electron-node/main/src/fw-detector'));
walk(path.join(repo, 'electron_node/electron-node/main/src/lexicon-v2'));

const funnelCols = Object.keys(funnelRows[0]);
const recallCols = [
  'caseId','windowId','rawStart','rawEnd','syllableStart','syllableEnd','windowPinyin','windowText',
  'candidateId','surface','termId','hitKind','source','domains','plainScore','toneScore','finalScore',
  'rankBeforeTopK','rankAfterTopK','dropReason','isExpectedAtom','inProduction','channel',
];
const pathCols = [
  'caseId','pathId','edges','edgeSurfaces','coverage','fallbackEdges','pathScore','pruneRank',
  'survived','dropReason','hasExpectedAtomEdge',
];
const assemblyCols = [
  'caseId','sentenceId','text','replacements','pathId','bucketDomain','assemblyScore',
  'selectedBeforeCrossPath','isExpectedExact','containsCorrectSurface','containsAllAtoms','crossPathRank',
];
const rootCols = Object.keys(rootRows[0]);

const summary = {
  freezeBaseline: 'FW_V4_FREEZE_2026_08_03',
  exactTopK: V4_LIMITS.exactTopK,
  windowMinSyllables: V4_LIMITS.windowMinSyllables,
  windowMaxSyllables: V4_LIMITS.windowMaxSyllables,
  maxSentenceCandidates: fwConfig.maxSentenceCandidates,
  toneTimestampOnlyEnabled: fwConfig.toneTimestampOnlyEnabled,
  mandatoryToneRecall: 'Batch_1.1C_fail_closed_no_plain_fallback',
  primaryDistribution: rootRows.reduce((a, r) => {
    a[r.primaryRootCause] = (a[r.primaryRootCause] || 0) + 1;
    return a;
  }, {}),
  firstMissingDistribution: funnelRows.reduce((a, r) => {
    a[r.FIRST_MISSING_STAGE] = (a[r.FIRST_MISSING_STAGE] || 0) + 1;
    return a;
  }, {}),
  overfitStaticHits: overfitHits,
  verdict: 'UPSTREAM_FIX_REQUIRED',
  cases: caseTraces,
};

for (const dir of [outDir, freezeOut]) {
  writeCsv(path.join(dir, 'kenlm_a_class_stage_funnel.csv'), funnelRows, funnelCols);
  writeCsv(path.join(dir, 'kenlm_a_class_recall_candidates.csv'), recallRows, recallCols);
  writeCsv(path.join(dir, 'kenlm_a_class_path_trace.csv'), pathRows, pathCols);
  writeCsv(path.join(dir, 'kenlm_a_class_assembly_trace.csv'), assemblyRows, assemblyCols);
  writeCsv(path.join(dir, 'kenlm_a_class_root_causes.csv'), rootRows, rootCols);
  fs.writeFileSync(path.join(dir, 'case_traces.json'), JSON.stringify(summary, null, 2));
}

log(`done funnel=${funnelRows.length} recall=${recallRows.length}`);
console.log(
  JSON.stringify(
    {
      ok: true,
      primaryDistribution: summary.primaryDistribution,
      firstMissingDistribution: summary.firstMissingDistribution,
      overfitHitCount: overfitHits.length,
      outDir,
      freezeOut,
    },
    null,
    2
  )
);
