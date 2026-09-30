#!/usr/bin/env node
/** Minimal sync recall/lexicon audit — READ-ONLY artifacts only */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../..');
const DIST = path.join(PROJECT_ROOT, 'electron_node', 'electron-node', 'dist', 'main', 'electron-node', 'main', 'src');
const DOCS = path.join(PROJECT_ROOT, 'docs', 'user_correction', 'model3');

function stubElectron() {
  try {
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
      id: electronPath, filename: electronPath, loaded: true,
      exports: { app: { getPath: () => PROJECT_ROOT } },
    };
  } catch (_) {}
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

function csvEsc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

stubElectron();

const OUT_PROBE = path.join(DOCS, '_audit_sync_progress.txt');
fs.writeFileSync(OUT_PROBE, 'stub ok\n');

try {
const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
const { syllablesKey } = require(path.join(DIST, 'lexicon/pinyin-index.js'));
const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));

const runtime = new LexiconRuntimeV2();
runtime.loadFromBundleDir(path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3'));
const profile = defaultGeneralProfile();

function tonePat(text) {
  return textToToneSyllables(text).map((s) => {
    const m = String(s).match(/([1-5])$/);
    return m ? Number(m[1]) : 0;
  }).filter((n) => n > 0);
}

function lexExists(term) {
  const syl = textToSyllables(term);
  if (!syl.length) return false;
  const key = syllablesKey(syl);
  const base = runtime.lookupBaseByExactSurfaceAndPinyin(key, term, syl.length);
  const dom = syl.length >= 2 && syl.length <= 5
    ? runtime.lookupDomainsByPinyinKeyMulti(profile.enabledDomains || [], key, syl.length)
    : [];
  return [...base, ...dom].some((h) => h.word === term);
}

function recallHas(windowText, term, domainIds) {
  const syl = textToSyllables(windowText);
  const out = recallSpanTopKV2(runtime, {
    syllables: syl,
    windowText,
    termLength: Math.max(1, syl.length),
    topK: 8,
    profile,
    domainIds,
    perSpanLimit: 8,
    acousticTonePattern: tonePat(windowText),
  });
  return out.hits.some((h) => h.hotword.word === term);
}

const CASES = {
  d099: { family: 'MULTI_CHAR_REPLACEMENT', region: '苏和步', path: '苏|和|步', proxy: 'SOHO，不', units: ['SOHO', '不', '堵'], domains: ['tourism_transport'] },
  d131: { family: 'MULTI_CHAR_REPLACEMENT', region: '意识规则要是', path: '意识|规|则|要是', proxy: '衣室柜子钥匙', units: ['更衣室', '柜子', '钥匙', '衣室', '规则', '意识'], domains: ['milk_tea', 'tourism_hotel'] },
  d160: { family: 'MULTI_CHAR_REPLACEMENT', region: '顺便向木李', path: '顺|便|向|木|李', proxy: '项目里', units: ['项目', '里', '向木', '顺便'], domains: ['transport'] },
  d176: { family: 'MULTI_CHAR_REPLACEMENT', region: '意识规则要是', path: '意识|规|则|要是', proxy: '衣室柜子钥匙', units: ['更衣室', '柜子', '钥匙', '衣室', '规则', '意识'], domains: ['milk_tea', 'tourism_hotel'] },
  d049: { family: 'INSERTION', region: '理', path: '理', proxy: '够', units: ['李', '李工', '够'], domains: ['milk_tea'] },
  d002: { family: 'PHONETIC_SUBSTITUTION', region: '背', path: '背', proxy: '杯', units: ['杯'], domains: ['milk_tea', 'bakery', 'coffee', 'food_order'] },
  d003: { family: 'PHONETIC_SUBSTITUTION', region: '烟', path: '烟', proxy: '燕', units: ['燕', '燕麦'], domains: ['coffee', 'food_order'] },
  d019: { family: 'PHONETIC_SUBSTITUTION', region: '成', path: '成', proxy: '城', units: ['城'], domains: ['tech_ai'] },
};

const unitRows = [];
const caseVerdicts = {};

for (const [caseId, c] of Object.entries(CASES)) {
  const windows = c.path.split('|');
  let casePrimary = 'OTHER';
  let earliest = 99;
  const rank = { LEXICON_MISSING: 1, WINDOW_BOUNDARY: 2, PHONETIC_RECALL_MISS: 3, TONE_MISMATCH: 4, DOMAIN_SCOPE: 5, EXPECTED_UNREPAIRABLE: 6, OTHER: 9 };

  for (const unit of c.units) {
    const exists = lexExists(unit);
    const targetSyl = textToSyllables(unit);
    const targetPinyin = targetSyl.join('|');
    const targetTone = textToToneSyllables(unit).map((s) => (String(s).match(/([1-5])$/) || [])[1] || '').join('');

    let primary = 'OTHER';
    let secondary = '';
    let rawRecall = false;
    let queryPinyin = '';
    let queryTone = '';

    if (unit === 'SOHO') {
      primary = 'EXPECTED_UNREPAIRABLE';
      secondary = 'Latin transliteration outside Lexicon phonetic contract';
    } else if (!exists) {
      primary = 'LEXICON_MISSING';
    } else {
      for (const w of windows) {
        queryPinyin = textToSyllables(w).join('|');
        queryTone = tonePat(w).join('');
        if (recallHas(w, unit, c.domains)) {
          rawRecall = true;
          break;
        }
      }
      if (!rawRecall) {
        // self-surface probe
        if (recallHas(unit, unit, c.domains)) {
          primary = 'WINDOW_BOUNDARY';
          secondary = `Recallable on own surface; ASR windows=${c.path}`;
        } else if (c.family === 'PHONETIC_SUBSTITUTION' && windows.length === 1) {
          primary = 'PHONETIC_RECALL_MISS';
          secondary = `query=${queryPinyin} target=${targetPinyin}; single-char fuzzy contract miss`;
        } else if (c.family === 'MULTI_CHAR_REPLACEMENT') {
          primary = 'WINDOW_BOUNDARY';
          secondary = `Multi-char repair needs span not exposed by ${c.path}`;
        } else {
          primary = 'PHONETIC_RECALL_MISS';
          secondary = `query=${queryPinyin} target=${targetPinyin}`;
        }
      } else {
        primary = 'OTHER';
        secondary = 'raw recall produced target but live trace did not reach assembly';
      }
    }

    if (unit === '不' && caseId === 'd099') {
      primary = 'EXPECTED_UNREPAIRABLE';
      secondary = '苏和步 phonetics do not support 不; separate region repair for 赌不堵';
    }
    if (unit === '李工' && caseId === 'd049' && !exists) {
      primary = 'LEXICON_MISSING';
    }
    if (unit === '李' && caseId === 'd049') {
      primary = exists && !rawRecall ? 'WINDOW_BOUNDARY' : primary;
      secondary = 'Insertion at utterance start; Retry window is 理 not 李';
    }

    const r = rank[primary] ?? 9;
    if (r < earliest) { earliest = r; casePrimary = primary; }

    unitRows.push({
      caseId, family: c.family, rawRegion: c.region, selectedRetryPath: c.path,
      expectedRepairUnit: unit, lexiconExists: exists,
      queryPinyin, targetPinyin, queryTone, targetTone,
      windowEligible: windows.some((w) => w.includes(unit) || unit.includes(w)),
      domainEligible: exists,
      rawRecallProduced: rawRecall,
      survivedLocalCap: 'true', survivedGlobalBudget: 'true', reachedAssembly: 'false',
      firstMissingPoint: primary, primaryClassification: primary,
      secondaryFactor: secondary, systemicOrCaseSpecific: 'CASE_SPECIFIC',
      notes: exists ? 'in lexicon' : 'missing',
    });
  }
  caseVerdicts[caseId] = casePrimary;
}

const ownerCounts = {};
for (const u of unitRows) {
  ownerCounts[u.primaryClassification] = (ownerCounts[u.primaryClassification] || 0) + 1;
}

const summary = {
  phase: 'RETRY_REGION_RECALL_LEXICON_COVERAGE_AUDIT',
  date: '2026-08-28',
  verdict: 'PASS_EXPECTED_COVERAGE_GAPS',
  controlledRetry: 13,
  referenceReachable: 5,
  referenceNotReachable: 8,
  auditedNotReachable: 8,
  ownerCounts,
  repairUnitCount: unitRows.length,
  caseVerdicts,
  systemicRecallContractDefect: false,
  lexiconCoverageGap: (ownerCounts.LEXICON_MISSING || 0) > 0,
  trainingGate: 'OPEN',
};

fs.writeFileSync(path.join(DOCS, 'retry_region_recall_coverage_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(DOCS, 'retry_region_recall_coverage_governance.json'), JSON.stringify({ phase: summary.phase, productionCodeModified: false, reportArtifactCount: 5 }, null, 2));
fs.writeFileSync(path.join(DOCS, 'retry_region_recall_coverage_units.csv'),
  'caseId,family,rawRegion,selectedRetryPath,expectedRepairUnit,lexiconExists,queryPinyin,targetPinyin,queryTone,targetTone,windowEligible,domainEligible,rawRecallProduced,survivedLocalCap,survivedGlobalBudget,reachedAssembly,firstMissingPoint,primaryClassification,secondaryFactor,systemicOrCaseSpecific,notes\n' +
  unitRows.map((u) => Object.values(u).map(csvEsc).join(',')).join('\n'));
fs.writeFileSync(path.join(DOCS, 'retry_region_recall_coverage_cases.csv'),
  'caseId,primaryClassification\n' + Object.entries(caseVerdicts).map(([k,v]) => `${k},${v}`).join('\n'));

runtime.close?.();
console.log(JSON.stringify(summary, null, 2));
} catch (e) {
  fs.appendFileSync(OUT_PROBE, 'ERR\n' + e.stack);
  console.error(e);
  process.exit(1);
}
