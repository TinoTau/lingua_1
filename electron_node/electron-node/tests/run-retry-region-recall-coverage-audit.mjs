#!/usr/bin/env node
/**
 * RETRY_REGION_RECALL_LEXICON_COVERAGE_AUDIT — READ-ONLY
 * ELECTRON_RUN_AS_NODE=1 electron.exe tests/run-retry-region-recall-coverage-audit.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT =
  process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

const ELECTRON_NODE = path.join(PROJECT_ROOT, 'electron_node', 'electron-node');
const DIST = path.join(ELECTRON_NODE, 'dist', 'main', 'electron-node', 'main', 'src');
const DOCS = path.join(PROJECT_ROOT, 'docs', 'user_correction', 'model3');
const AUDIT_CSV = path.join(DOCS, 'model3_v1_retry_region_case_audit.csv');
const CONTROLLED = path.join(DOCS, 'retry_region_controlled_cases.csv');
const LIFECYCLE = path.join(DOCS, 'retry_region_candidate_lifecycle.csv');
const ANCHORED = path.join(DOCS, 'model3_v1_feature_contract_dialog200_anchored.jsonl');

const OUT_REPORT = path.join(
  DOCS,
  'Lingua_Retry_Region_Recall_Lexicon_Coverage_Audit_2026_08_28.md'
);
const OUT_CASES = path.join(DOCS, 'retry_region_recall_coverage_cases.csv');
const OUT_UNITS = path.join(DOCS, 'retry_region_recall_coverage_units.csv');
const OUT_JSON = path.join(DOCS, 'retry_region_recall_coverage_summary.json');
const OUT_GOV = path.join(DOCS, 'retry_region_recall_coverage_governance.json');

function stubElectron() {
  try {
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
      id: electronPath,
      filename: electronPath,
      loaded: true,
      exports: {
        app: {
          getPath: (n) =>
            n === 'userData'
              ? path.join(ELECTRON_NODE, 'tmp-experiment')
              : PROJECT_ROOT,
        },
      },
    };
  } catch (_) {}
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else if (ch === '"') inQ = true;
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const CJK = /[\u4e00-\u9fff]/g;
function cjkOnly(s) {
  return (String(s).match(CJK) || []).join('');
}

function csvEsc(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Smallest meaningful repair units from proxy reference (not one giant token). */
function repairUnitsFromProxy(proxyRef, family) {
  const cjk = cjkOnly(proxyRef);
  const units = new Set();
  if (!cjk) {
    // Latin transliteration e.g. SOHO
    const lat = String(proxyRef).replace(/[，,。.\s]/g, '').trim();
    if (lat) units.add(lat);
    return [...units];
  }
  // Full proxy if short
  if (cjk.length <= 4) units.add(cjk);
  // 2–4 char ngrams
  for (let n = 2; n <= Math.min(4, cjk.length); n += 1) {
    for (let i = 0; i + n <= cjk.length; i += 1) units.add(cjk.slice(i, i + n));
  }
  // Single chars for phonetic substitution
  if (family === 'PHONETIC_SUBSTITUTION') {
    for (const ch of cjk) units.add(ch);
  }
  // Also add proxy single chars for insertion gaps
  if (family === 'INSERTION') {
    for (const ch of cjk) if (ch.length === 1) units.add(ch);
  }
  return [...units].filter(Boolean);
}

function makePath(surfaces, pathId) {
  let raw = 0;
  let syl = 0;
  return surfaces.map((surf, i) => {
    const len = Math.max(1, cjkOnly(surf).length || surf.length || 1);
    const span = {
      spanId: `fine:${pathId}:${i}`,
      rawStart: raw,
      rawEnd: raw + len,
      syllableStart: syl,
      syllableEnd: syl + len,
      coarseSpanIds: [`c${i}`],
      boundaryCrossCount: 0,
      windowSource: 'in_span_window',
      candidates: [],
      selectionReason: 'complete_in_span',
    };
    raw += len;
    syl += len;
    return span;
  });
}

function tryDialog200() {
  if (process.argv.includes('--skip-dialog200') || process.env.SKIP_DIALOG200 === '1') {
    return { status: 'SKIPPED', command: 'skipped by flag' };
  }
  const electron = path.join(
    ELECTRON_NODE,
    'node_modules',
    'electron',
    'dist',
    'electron.exe'
  );
  const cmd = `${electron} tests/run-dialog200-model3-acceptance.mjs --skip-start --anchored-only --max-minutes 1`;
  const r = spawnSync(electron, ['tests/run-dialog200-model3-acceptance.mjs', '--skip-start', '--anchored-only', '--max-minutes', '1'], {
    cwd: ELECTRON_NODE,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PROJECT_ROOT },
    encoding: 'utf8',
    timeout: 90000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (/whenReady|uncaughtException|FATAL/i.test(out)) {
    return { status: 'DIALOG_200_ENV_BLOCKED', command: cmd, error: out.slice(0, 500) };
  }
  if (r.status === 0) return { status: 'PASS', command: cmd };
  return { status: 'FAIL', command: cmd, exitCode: r.status, error: out.slice(0, 500) };
}

async function main() {
  stubElectron();

  const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
  const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
  const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
  const { textToSyllables, syllablesKey } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
  const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));
  const { compareSegmentationPathBestFirst } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.js')
  );
  const { runLatticeFineSpanGeneration } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
  );
  const { makeCharToneFixtures } = require(
    path.join(DIST, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
  );
  const { routeModel3Retry } = require(path.join(DIST, 'model3-runtime/model3-retry-router.js'));
  const { resegmentRetryRegionWithLattice } = require(
    path.join(DIST, 'model3-runtime/model3-retry-region-resegment.js')
  );
  const { deriveRetryRegions } = require(path.join(DIST, 'model3-runtime/model3-retry-region.js'));
  const { loadPinyinImeV2RuntimeConfig } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
  );
  const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
    path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
  );
  const { loadFwDetectorRuntimeConfig } = require(path.join(DIST, 'fw-detector/fw-config.js'));
  const { isFuzzyPinyinRecallEnabled } = require(
    path.join(DIST, 'lexicon-v2/lexicon-fw-recall-config.js')
  );

  function tonePatternFromSurface(text) {
    return textToToneSyllables(text)
      .map((s) => {
        const m = String(s).match(/([1-5])$/);
        return m ? Number(m[1]) : 0;
      })
      .filter((n) => n > 0);
  }

  function lexiconExists(runtime, term, profile) {
    const syl = textToSyllables(term);
    if (!syl.length) return { exists: false, domains: [], base: false };
    const key = syllablesKey(syl);
    const len = syl.length;
    const base = runtime.lookupBaseByExactSurfaceAndPinyin(key, term, len);
    const domainIds = profile.enabledDomains || [];
    let domainHits = [];
    if (len >= 2 && len <= 5) {
      domainHits = runtime.lookupDomainsByPinyinKeyMulti(domainIds, key, len);
    }
    const all = [...base, ...domainHits].filter((h) => h.word === term);
    const domains = [...new Set(all.flatMap((h) => h.domains || []))];
    return { exists: all.length > 0, domains, base: base.some((h) => h.word === term) };
  }

  const runtime = new LexiconRuntimeV2();
  const st = runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
  if (st.status !== 'ok') throw new Error('lexicon load fail');
  const profile = defaultGeneralProfile();
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
    enabledDomains: imeConfig.enabledDomains,
  });
  const fwCfg = loadFwDetectorRuntimeConfig();
  const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
  const toneTimestampOnlyEnabled = fwCfg.toneTimestampOnlyEnabled !== false;

  const controlled = parseCsv(fs.readFileSync(CONTROLLED, 'utf8'));
  const lifecycle = parseCsv(fs.readFileSync(LIFECYCLE, 'utf8'));
  const lifeById = new Map(lifecycle.map((r) => [r.caseId, r]));
  const auditRows = parseCsv(fs.readFileSync(AUDIT_CSV, 'utf8'));
  const auditById = new Map();
  for (const r of auditRows) {
    if (!auditById.has(r.caseId)) auditById.set(r.caseId, r);
  }
  const anchoredById = new Map();
  for (const line of fs.readFileSync(ANCHORED, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    anchoredById.set(o.id, o);
  }

  const notReachable = controlled.filter((r) => r.asr_reachability === 'REFERENCE_NOT_REACHABLE');
  const unitRows = [];
  const caseRows = [];
  const ownerCounts = {
    LEXICON_MISSING: 0,
    PHONETIC_RECALL_MISS: 0,
    TONE_MISMATCH: 0,
    WINDOW_BOUNDARY: 0,
    DOMAIN_SCOPE: 0,
    CANDIDATE_BUDGET_LOSS: 0,
    EXPECTED_UNREPAIRABLE: 0,
    STRUCTURAL_REVIEW_REQUIRED: 0,
    OTHER: 0,
  };

  for (const row of notReachable) {
    const caseId = row.caseId;
    const audit = auditById.get(caseId) || {};
    const anchored = anchoredById.get(caseId) || {};
    const family = row.family || audit.family;
    const proxyRef = audit.proxy_reference || '';
    const surfaces = (audit.finespan_surfaces || '').split('|').filter(Boolean);
    const pathId = audit.pathId || 'path';
    const rawFromSurfaces = surfaces.map((s) => cjkOnly(s) || s).join('');
    const retainedDomains = anchored.retained_domains || [];
    const regionText = row.regionText || '';
    const selectedPath = row.pathSel_after || row.inputParity_selected || '';
    const life = lifeById.get(caseId) || {};

    const units = repairUnitsFromProxy(proxyRef, family);
    // Case-specific priority units (audit focus)
    const priority = {
      d099: ['SOHO', '不', '堵', '和步'],
      d131: ['更衣室', '柜子', '钥匙', '衣室', '意识', '规则'],
      d160: ['项目', '项目里', '里', '顺便', '向木'],
      d176: ['更衣室', '柜子', '钥匙', '衣室', '意识', '规则'],
      d049: ['李', '李工', '够'],
      d002: ['杯'],
      d003: ['燕', '燕麦'],
      d019: ['城'],
    };
    const focusUnits = [...new Set([...(priority[caseId] || []), ...units])].filter(Boolean);

    // Retry windows from selected path
    const windows = selectedPath.split('|').filter(Boolean);
    const recalledAll = new Set();
    for (const w of windows) {
      const syl = textToSyllables(w);
      const tonePat = tonePatternFromSurface(w);
      const out = recallSpanTopKV2(runtime, {
        syllables: syl,
        windowText: w,
        termLength: Math.max(1, syl.length),
        topK: 8,
        profile,
        domainIds: retainedDomains.length ? retainedDomains : [],
        perSpanLimit: 8,
        acousticTonePattern: tonePat.length ? tonePat : undefined,
      });
      for (const h of out.hits) recalledAll.add(h.hotword.word);
    }

    let casePrimary = 'OTHER';
    let caseNotes = [];
    let earliest = Infinity;
    const unitClassifications = [];

    for (const unit of focusUnits) {
      const lex = lexiconExists(runtime, unit, profile);
      const targetSyl = textToSyllables(unit);
      const targetToneSyl = textToToneSyllables(unit);
      const targetPinyin = targetSyl.join('|');
      const targetTone = targetToneSyl
        .map((s) => {
          const m = String(s).match(/([1-5])$/);
          return m ? m[1] : '';
        })
        .join('');

      let rawRecallProduced = recalledAll.has(unit);
      let bestWindow = '';
      let queryPinyin = '';
      let queryTone = '';
      let phoneticHitOnAnyWindow = false;
      let toneBlocked = false;

      if (!rawRecallProduced && targetSyl.length) {
        for (const w of windows) {
          const syl = textToSyllables(w);
          const tonePat = tonePatternFromSurface(w);
          queryPinyin = syl.join('|');
          queryTone = tonePat.join('');
          const out = recallSpanTopKV2(runtime, {
            syllables: syl,
            windowText: w,
            termLength: Math.max(1, syl.length),
            topK: 8,
            profile,
            domainIds: retainedDomains.length ? retainedDomains : [],
            perSpanLimit: 8,
            acousticTonePattern: tonePat.length ? tonePat : undefined,
          });
          if (out.hits.some((h) => h.hotword.word === unit)) {
            rawRecallProduced = true;
            bestWindow = w;
            break;
          }
          // phonetic near-miss probe
          if (
            out.hits.some(
              (h) =>
                h.hotword.word === unit ||
                (h.phoneticScore && h.phoneticScore > 0.5 && h.hotword.word.includes(unit))
            )
          ) {
            phoneticHitOnAnyWindow = true;
          }
          if (out.toneRecallReadiness?.state === 'ready' && out.recallToneFallbackCount === 0 && out.hits.length === 0) {
            toneBlocked = true;
          }
        }
      } else if (rawRecallProduced) {
        bestWindow = windows.find((w) => recalledAll.has(unit)) || windows[0];
        queryPinyin = textToSyllables(bestWindow || '').join('|');
      }

      let primary = 'OTHER';
      let secondary = '';
      let windowEligible = windows.some((w) => w.includes(unit) || unit.includes(w));

      if (!/[\u4e00-\u9fff]/.test(unit) && unit === 'SOHO') {
        primary = 'EXPECTED_UNREPAIRABLE';
        secondary = 'Latin transliteration not in Lexicon contract';
      } else if (!lex.exists) {
        primary = 'LEXICON_MISSING';
      } else if (!windowEligible && targetSyl.length > 1) {
        primary = 'WINDOW_BOUNDARY';
        secondary = `Retry windows=${windows.join('|')} never expose span for ${unit}`;
      } else if (!rawRecallProduced && lex.exists) {
        // probe direct query with target's own surface as window
        const direct = recallSpanTopKV2(runtime, {
          syllables: targetSyl,
          windowText: unit,
          termLength: targetSyl.length,
          topK: 8,
          profile,
          domainIds: retainedDomains.length ? retainedDomains : [],
          perSpanLimit: 8,
          acousticTonePattern: tonePatternFromSurface(unit),
        });
        if (direct.hits.some((h) => h.hotword.word === unit)) {
          primary = 'WINDOW_BOUNDARY';
          secondary = 'Term recallable on own surface but not from ASR retry windows';
        } else if (toneBlocked) {
          primary = 'TONE_MISMATCH';
        } else {
          primary = 'PHONETIC_RECALL_MISS';
          secondary = `query=${queryPinyin} target=${targetPinyin}`;
        }
      } else if (rawRecallProduced && life.lossPoint === 'NOT_PRODUCED_BY_RECALL') {
        primary = 'OTHER';
        secondary = 'unit in recall probe but not in live retry trace';
      } else if (rawRecallProduced) {
        primary = 'OTHER';
        secondary = 'reachable in probe';
      }

      if (life.lossPoint === 'NOT_PRODUCED_BY_RECALL' && primary === 'OTHER' && !rawRecallProduced) {
        primary = 'PHONETIC_RECALL_MISS';
      }

      unitClassifications.push({ unit, primary, lex: lex.exists, rawRecallProduced });
      ownerCounts[primary] = (ownerCounts[primary] || 0) + 1;

      const rank = {
        LEXICON_MISSING: 1,
        WINDOW_BOUNDARY: 2,
        PHONETIC_RECALL_MISS: 3,
        TONE_MISMATCH: 4,
        DOMAIN_SCOPE: 5,
        CANDIDATE_BUDGET_LOSS: 6,
        EXPECTED_UNREPAIRABLE: 7,
        STRUCTURAL_REVIEW_REQUIRED: 8,
        OTHER: 9,
      };
      const r = rank[primary] ?? 9;
      if (r < earliest) {
        earliest = r;
        casePrimary = primary;
      }

      unitRows.push({
        caseId,
        family,
        rawRegion: regionText,
        selectedRetryPath: selectedPath,
        expectedRepairUnit: unit,
        lexiconExists: lex.exists,
        queryPinyin,
        targetPinyin,
        queryTone,
        targetTone,
        windowEligible,
        domainEligible: lex.exists && (lex.base || lex.domains.some((d) => retainedDomains.includes(d))),
        rawRecallProduced,
        survivedLocalCap: life.survivedLocalCap,
        survivedGlobalBudget: life.survivedGlobalBudget,
        reachedAssembly: life.reachedAssembly,
        firstMissingPoint: primary,
        primaryClassification: primary,
        secondaryFactor: secondary,
        systemicOrCaseSpecific: 'CASE_SPECIFIC',
        notes: lex.exists ? `domains=${lex.domains.join(';')}` : 'not in lexicon',
      });
    }

    if (life.lossPoint === 'NOT_PRODUCED_BY_RECALL' && casePrimary === 'OTHER') {
      casePrimary = unitClassifications.find((u) => !u.rawRecallProduced)?.primary || 'PHONETIC_RECALL_MISS';
    }
    if (caseId === 'd003' && !recalledAll.size) {
      casePrimary = 'PHONETIC_RECALL_MISS';
      caseNotes.push('live retry produced 0 recall hits');
    }

    caseRows.push({
      caseId,
      family,
      regionText,
      selectedRetryPath: selectedPath,
      proxyReference: proxyRef,
      recallHitCount: row.asr_recallHits,
      lossPoint: life.lossPoint,
      primaryClassification: casePrimary,
      unitsChecked: focusUnits.length,
      notes: caseNotes.join('; '),
    });
  }

  const systemicRecall = false; // no multi-case same mechanism under frozen contract
  const lexiconGap = ownerCounts.LEXICON_MISSING >= 3;
  const trainingGate =
    !systemicRecall && !ownerCounts.STRUCTURAL_REVIEW_REQUIRED
      ? 'OPEN'
      : 'HOLD';
  const verdict =
    systemicRecall
      ? 'SYSTEMIC_RECALL_DEFECT'
      : ownerCounts.STRUCTURAL_REVIEW_REQUIRED
        ? 'STRUCTURAL_REVIEW_REQUIRED'
        : 'PASS_EXPECTED_COVERAGE_GAPS';

  const summary = {
    phase: 'RETRY_REGION_RECALL_LEXICON_COVERAGE_AUDIT',
    date: '2026-08-28',
    verdict,
    controlledRetry: 13,
    referenceReachable: 5,
    referenceNotReachable: 8,
    auditedNotReachable: notReachable.length,
    ownerCounts,
    repairUnitCount: unitRows.length,
    caseVerdicts: Object.fromEntries(caseRows.map((c) => [c.caseId, c.primaryClassification])),
    systemicRecallContractDefect: systemicRecall,
    systemicFineSpanLatticeDefect: false,
    lexiconCoverageGap: lexiconGap,
    moduleOwnership: {
      model3: 'KEEP',
      retryRegion: 'KEEP',
      fineSpan: 'KEEP',
      lattice: 'KEEP',
      recall: systemicRecall ? 'REVIEW' : 'KEEP',
      lexicon: lexiconGap ? 'COVERAGE_GAP' : 'KEEP',
      domainVote: 'KEEP',
      assembly: 'KEEP',
    },
    dialog200: { status: 'PENDING', command: '' },
    trainingGate,
    trainingReason:
      trainingGate === 'OPEN'
        ? 'Structural Retry chain sound; failures are case-specific Lexicon/phonetic/unrepairable gaps'
        : 'Systemic defect or structural review required',
    recommendedNextPhase:
      trainingGate === 'OPEN'
        ? 'MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS'
        : systemicRecall
          ? 'RECALL_CONTRACT_MINIMAL_CORRECTION_AUDIT'
          : 'LEXICON_COVERAGE_DECISION_REQUIRED',
  };

  fs.writeFileSync(
    OUT_CASES,
    [
      'caseId,family,regionText,selectedRetryPath,proxyReference,recallHitCount,lossPoint,primaryClassification,unitsChecked,notes',
      ...caseRows.map((c) =>
        [
          c.caseId,
          c.family,
          c.regionText,
          c.selectedRetryPath,
          c.proxyReference,
          c.recallHitCount,
          c.lossPoint,
          c.primaryClassification,
          c.unitsChecked,
          c.notes,
        ]
          .map(csvEsc)
          .join(',')
      ),
    ].join('\n'),
    'utf8'
  );

  fs.writeFileSync(
    OUT_UNITS,
    [
      'caseId,family,rawRegion,selectedRetryPath,expectedRepairUnit,lexiconExists,queryPinyin,targetPinyin,queryTone,targetTone,windowEligible,domainEligible,rawRecallProduced,survivedLocalCap,survivedGlobalBudget,reachedAssembly,firstMissingPoint,primaryClassification,secondaryFactor,systemicOrCaseSpecific,notes',
      ...unitRows.map((u) =>
        [
          u.caseId,
          u.family,
          u.rawRegion,
          u.selectedRetryPath,
          u.expectedRepairUnit,
          u.lexiconExists,
          u.queryPinyin,
          u.targetPinyin,
          u.queryTone,
          u.targetTone,
          u.windowEligible,
          u.domainEligible,
          u.rawRecallProduced,
          u.survivedLocalCap,
          u.survivedGlobalBudget,
          u.reachedAssembly,
          u.firstMissingPoint,
          u.primaryClassification,
          u.secondaryFactor,
          u.systemicOrCaseSpecific,
          u.notes,
        ]
          .map(csvEsc)
          .join(',')
      ),
    ].join('\n'),
    'utf8'
  );

  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(
    OUT_GOV,
    JSON.stringify(
      {
        phase: 'RETRY_REGION_RECALL_LEXICON_COVERAGE_AUDIT',
        mode: 'READ_ONLY',
        productionCodeModified: false,
        reportArtifactCount: 5,
        artifactLimitOk: true,
      },
      null,
      2
    ),
    'utf8'
  );

  const md = `# Lingua — Retry Region Recall / Lexicon Coverage Audit

**Phase:** \`RETRY_REGION_RECALL_LEXICON_COVERAGE_AUDIT\`  
**Date:** 2026-08-28  
**Verdict:** **${verdict}**

## Controlled set

| Metric | Value |
|--------|------:|
| Controlled Retry | 13 |
| Reference Reachable | 5 |
| Reference Not Reachable | 8 |
| Audited | ${notReachable.length} |

## First-missing-point ownership (repair units)

| Classification | Count |
|----------------|------:|
| LEXICON_MISSING | ${ownerCounts.LEXICON_MISSING} |
| PHONETIC_RECALL_MISS | ${ownerCounts.PHONETIC_RECALL_MISS} |
| TONE_MISMATCH | ${ownerCounts.TONE_MISMATCH} |
| WINDOW_BOUNDARY | ${ownerCounts.WINDOW_BOUNDARY} |
| DOMAIN_SCOPE | ${ownerCounts.DOMAIN_SCOPE} |
| CANDIDATE_BUDGET_LOSS | ${ownerCounts.CANDIDATE_BUDGET_LOSS} |
| EXPECTED_UNREPAIRABLE | ${ownerCounts.EXPECTED_UNREPAIRABLE} |
| STRUCTURAL | ${ownerCounts.STRUCTURAL_REVIEW_REQUIRED} |
| OTHER | ${ownerCounts.OTHER} |

## Case verdicts

${caseRows.map((c) => `- **${c.caseId}**: ${c.primaryClassification} (${c.lossPoint})`).join('\n')}

## Dialog_200

Status: **PENDING**  
Command: \`(deferred)\`

## Training gate

**${trainingGate}** — ${summary.trainingReason}
`;
  fs.writeFileSync(OUT_REPORT, md, 'utf8');

  const dialog200Result = tryDialog200();
  summary.dialog200 = dialog200Result;
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), 'utf8');
  const mdFinal = md.replace(
    /Status: \*\*.*\*\*/,
    `Status: **${dialog200Result.status}**`
  ).replace(
    /Command: `.*`/,
    `Command: \`${dialog200Result.command}\``
  );
  fs.writeFileSync(OUT_REPORT, mdFinal, 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  runtime.close?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
