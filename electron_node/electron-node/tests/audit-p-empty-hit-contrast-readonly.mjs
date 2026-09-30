#!/usr/bin/env node
/**
 * READ-ONLY offline reconstruction for P empty-hit contrast audit.
 * No DB writes. No product code changes.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');

// Use compiled dist helpers where possible
const distRoot = path.join(
  REPO,
  'electron_node/electron-node/dist/main/electron-node/main/src'
);

const {
  hypothesizeIntendedSyllables,
  OPPOSITE_DIRECTION,
  stripTone,
} = require(path.join(distRoot, 'model2-runtime/relation-direction.js'));
const {
  textToPinyinStream,
} = require(path.join(distRoot, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js'));
const {
  buildTonePinyinKeyFromSyllablesAndPattern,
} = require(path.join(distRoot, 'lexicon/phonetic/tone-pinyin.js'));

const DS = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const CAP = path.join(DS, 'tone_evidence_captures', 'tonecap_2026-09-12T0001');
const SQLITE = path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
const EXEC = path.join(
  REPO,
  'docs/user_correction/model3/LINGUA_PILOT200_REPLAY_FROZEN_TONE_EVIDENCE_diagnostic_executions.jsonl'
);

const CASE_IDS = [
  'p2_u001_016', // positive
  'p2_u001_002',
  'p2_u002_016',
  'p2_u003_001',
  'p2_u004_001',
  'p2_u003_016',
  'p2_u001_004',
];

function loadCases() {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(DS, 'cases', 'cases.jsonl'), 'utf8')
      .trim()
      .split(/\n/)
      .map((l) => JSON.parse(l))
      .map((c) => [c.caseId, c])
  );
}

function loadExec() {
  return fs
    .readFileSync(EXEC, 'utf8')
    .trim()
    .split(/\n/)
    .map((l) => JSON.parse(l));
}

/** Heuristic: locate evaluation target surface (or ASR-confused surface) in RAW. */
function findTargetInRaw(raw, refSurface, confusableSurfaces) {
  for (const s of [refSurface, ...(confusableSurfaces || [])]) {
    if (!s) continue;
    const idx = raw.indexOf(s);
    if (idx >= 0) return { surface: s, start: idx, end: idx + s.length };
  }
  return null;
}

/** Map char range → syllables via production textToPinyinStream + char ranges. */
function syllablesForSurface(fullText, surfaceStart, surfaceEnd) {
  const stream = textToPinyinStream(fullText);
  // Prefer building from surface substring alone (FineSpan local text)
  const local = fullText.slice(surfaceStart, surfaceEnd);
  const localStream = textToPinyinStream(local);
  return {
    localText: local,
    syllables: localStream.syllables.map((s) => stripTone(String(s))),
    rawSyllables: localStream.syllables,
    fullSyllableCount: stream.syllables.length,
  };
}

function toneDigitsFromSlices(slices, count) {
  // Production FineSpan uses rebindToneForFineSpan; for offline we take sequential
  // argmax tones from acousticToneSlices when present.
  const tones = [];
  for (const s of slices || []) {
    const post = s.tonePosterior || s.posterior || null;
    let tone = s.tone ?? s.predictedTone ?? s.label ?? null;
    if (tone == null && post) {
      const keys = ['t1', 't2', 't3', 't4', 't5'];
      let best = -1;
      let bi = 1;
      for (let i = 0; i < keys.length; i++) {
        const v = Number(post[keys[i]] ?? -1);
        if (v > best) {
          best = v;
          bi = i + 1;
        }
      }
      tone = bi;
    }
    if (tone != null) tones.push(Number(tone));
    if (tones.length >= count) break;
  }
  return tones.slice(0, count);
}

function queryDb(db, pinyinKey, toneKey, termLen) {
  const stmt = db.prepare(
    `SELECT term_id, word, pinyin_key, tone_pinyin_key, enabled, prior_score
     FROM base_lexicon
     WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
     ORDER BY prior_score DESC LIMIT 20`
  );
  return stmt.all(pinyinKey, toneKey, termLen);
}

function byWord(db, word) {
  return db
    .prepare(
      `SELECT term_id, word, pinyin_key, tone_pinyin_key, enabled, prior_score
       FROM base_lexicon WHERE word = ? LIMIT 20`
    )
    .all(word);
}

function byPinyinOnly(db, pinyinKey, termLen) {
  return db
    .prepare(
      `SELECT term_id, word, pinyin_key, tone_pinyin_key, enabled, prior_score
       FROM base_lexicon
       WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
       ORDER BY prior_score DESC LIMIT 20`
    )
    .all(pinyinKey, termLen);
}

// ASR surface guesses for evaluation targets (from capture RAW)
const ASR_SURFACE_HINTS = {
  p2_u001_016: ['李守步', '礼宾部'],
  p2_u001_002: ['来精', '奶精', '來精'],
  p2_u002_016: ['咖啡丝', '咖啡师'],
  p2_u003_001: ['营运真', '营运证', '營運真', '營運證'],
  p2_u004_001: ['升层', '生成'],
  p2_u003_016: ['翻成', '换乘'],
  p2_u001_004: ['类处理', '内处理', '類處理'],
};

const cases = loadCases();
const execs = loadExec();
const db = new Database(SQLITE, { readonly: true, fileMustExist: true });

const rows = [];
for (const caseId of CASE_IDS) {
  const c = cases[caseId];
  const evidence = JSON.parse(fs.readFileSync(path.join(CAP, `${caseId}.evidence.json`), 'utf8'));
  const corr = execs.find(
    (r) => r.kind === 'REPLAY' && r.caseId === caseId && r.profileCondition === 'CORRECT_PROFILE'
  );
  const raw = evidence.rawMergedAsrText || '';
  // Prefer segment text used in pipeline if available
  const segText = evidence.segments?.[0]?.text || raw;
  const targetSurface = c.evaluationTargetSurface;
  const loc = findTargetInRaw(segText, targetSurface, ASR_SURFACE_HINTS[caseId]);
  // also try raw (may differ in punctuation / traditional)
  const loc2 = loc || findTargetInRaw(raw, targetSurface, ASR_SURFACE_HINTS[caseId]);

  const location = loc2;
  let sylInfo = null;
  if (location) {
    sylInfo = syllablesForSurface(location.surface === loc2?.surface ? (segText.includes(location.surface) ? segText : raw) : raw, location.start, location.end);
    // Fix: recompute on the text that contains the surface
    const textUsed = segText.includes(location.surface)
      ? segText
      : raw.includes(location.surface)
        ? raw
        : location.surface;
    const start = textUsed.indexOf(location.surface);
    sylInfo = syllablesForSurface(textUsed, start, start + location.surface.length);
  }

  const actions = corr?.selected_action_ids || [];
  const observed = sylInfo?.syllables || [];
  const actionTraces = [];
  for (const actionId of actions) {
    const rel = actionId.startsWith('single:') ? actionId.slice(7) : actionId;
    const rev = OPPOSITE_DIRECTION[rel] || null;
    const hyp = hypothesizeIntendedSyllables(observed, rel);
    const pinyinKey = hyp.syllables.join('|');
    // Tone: we cannot perfectly reconstruct FineSpan rebind offline; query both
    // with sequential slice tones and with expected-term tones from lexicon.
    const expectedRows = byWord(db, targetSurface);
    const expectedToneKey = expectedRows[0]?.tone_pinyin_key || null;
    const expectedPinyin = expectedRows[0]?.pinyin_key || null;

    const seqTones = toneDigitsFromSlices(evidence.acousticToneSlices, hyp.syllables.length);
    let toneKeyFromSeq = null;
    try {
      if (seqTones.length === hyp.syllables.length) {
        toneKeyFromSeq = buildTonePinyinKeyFromSyllablesAndPattern(hyp.syllables, seqTones);
      }
    } catch (_) {}

    const generatedKeyRows =
      toneKeyFromSeq != null
        ? queryDb(db, pinyinKey, toneKeyFromSeq, hyp.syllables.length)
        : [];
    const expectedKeyRows =
      expectedToneKey && expectedPinyin
        ? queryDb(db, expectedPinyin, expectedToneKey, hyp.syllables.length)
        : [];
    const pinyinOnlyRows = byPinyinOnly(db, pinyinKey, hyp.syllables.length || targetSurface.length);

    actionTraces.push({
      actionId,
      relationType: rel,
      oppositeDirection: rev,
      nChanged: hyp.nChanged,
      observedSyllables: observed,
      transformedPronunciation: hyp.syllables,
      recallPinyinKey: pinyinKey,
      seqToneDigits_OFFLINE_HEURISTIC: seqTones,
      tonePinyinKey_OFFLINE_HEURISTIC: toneKeyFromSeq,
      GENERATED_KEY_ROW_COUNT_heuristic: generatedKeyRows.length,
      generatedKeyRows_heuristic: generatedKeyRows.map((r) => r.word),
      expectedTermRows: expectedRows.map((r) => ({
        word: r.word,
        pinyin_key: r.pinyin_key,
        tone_pinyin_key: r.tone_pinyin_key,
        term_id: r.term_id,
      })),
      EXPECTED_KEY_ROW_COUNT: expectedKeyRows.length,
      PINYIN_ONLY_ROW_COUNT: pinyinOnlyRows.length,
      pinyinOnlyWords: pinyinOnlyRows.map((r) => ({
        word: r.word,
        tone_pinyin_key: r.tone_pinyin_key,
      })),
      queryWouldSkip: hyp.nChanged <= 0,
    });
  }

  rows.push({
    caseId,
    role: caseId === 'p2_u001_016' ? 'POSITIVE' : 'EMPTY',
    referenceText: c.referenceText,
    frozenRawText: raw,
    segmentText: segText,
    evaluationTargetSurface: targetSurface,
    targetInLexicon: c.targetInLexicon,
    relationFamily: c.relationFamily,
    relationDirection: c.relationDirection,
    locatedSurface: location,
    sylInfo,
    selectedActions: actions,
    observedP_status: corr?.p_retrieval_status,
    observed_p_hits: corr?.p_retrieval_hit_count,
    observed_p_added: corr?.p_added,
    toneRecallReadiness: corr?.toneRecallReadiness,
    actionTraces,
  });
}

db.close();
console.log(JSON.stringify(rows, null, 2));
