#!/usr/bin/env node
/**
 * ToneModule P1 — Benefit Audit (read-only, no production code changes).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');
const SQLITE = path.join(PROJECT_ROOT, 'node_runtime/lexicon/v3/lexicon.sqlite');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json');
const P05_JSON = path.join(__dirname, 'tone-module-p05-runtime-validation.json');
const BATCH_JSON = path.join(__dirname, '../fw-detector-dialog-200-batch-result.json');
const OUT_JSON = path.join(__dirname, 'tone-module-p1-benefit-audit.json');
const FW_PORT = parseInt(process.env.FASTER_WHISPER_VAD_PORT || '6007', 10);

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
            ? path.join(PROJECT_ROOT, 'electron_node/electron-node/tmp-experiment')
            : PROJECT_ROOT,
      },
    },
  };
} catch (_) {}

const Database = require('better-sqlite3');
const { pinyin } = require('pinyin-pro');
const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
const { syllablesKey } = require(path.join(DIST, 'lexicon/pinyin-index.js'));
const { extractToneNumbersFromKey, extractAcousticTonePattern, isCandidateToneCompatible, isToneAlignmentValid, resolveCandidateToneKey, argmaxToneFromPosterior, alignToneTokensToChars } = require(path.join(DIST, 'fw-detector/tone-match-score.js'));
const { sortRecallHitsByToneCompatibility } = require(path.join(DIST, 'lexicon/tone-recall-sort.js'));
const { recallSpanTopK } = require(path.join(DIST, 'lexicon/local-span-recall.js'));
const { ensureLexiconRuntimeV2Loaded } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2-holder.js'));
const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));

const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];
const MIN_PRIOR = 0.5;

function readWavPcm16(wavPath) {
  const buf = fs.readFileSync(wavPath);
  const sr = buf.readUInt32LE(24);
  const ch = buf.readUInt16LE(22);
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      offset += 8;
      break;
    }
    offset += 8 + size;
  }
  const bytes = buf.subarray(offset);
  const n = Math.floor(bytes.length / (2 * ch));
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = bytes.readInt16LE(i * ch * 2);
    if (ch > 1) {
      let sum = s;
      for (let c = 1; c < ch; c++) sum += bytes.readInt16LE((i * ch + c) * 2);
      s = sum / ch;
    }
    pcm[i] = s / 32768;
  }
  return { pcm, sr };
}

function pcmToB64(pcmF32) {
  const pcm16 = new Int16Array(pcmF32.length);
  for (let i = 0; i < pcmF32.length; i++) {
    pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(pcmF32[i] * 32767)));
  }
  return Buffer.from(pcm16.buffer).toString('base64');
}

async function fwUtterance(wavPath, traceId) {
  const { pcm, sr } = readWavPcm16(wavPath);
  const res = await fetch(`http://127.0.0.1:${FW_PORT}/utterance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: traceId,
      src_lang: 'zh',
      audio: pcmToB64(pcm),
      audio_format: 'pcm16',
      sample_rate: sr,
      task: 'transcribe',
      skip_text_dedup: true,
      condition_on_previous_text: false,
      beam_size: 1,
      temperature: 0,
      trace_id: traceId,
    }),
    signal: AbortSignal.timeout(180000),
  });
  return res.json();
}

function expectedTonesFromText(text) {
  return pinyin(text, { toneType: 'num', type: 'array' }).map((s) => {
    const m = s.match(/([1-5])$/);
    return m ? parseInt(m[1], 10) : 0;
  });
}

function scanLexiconHomophones(db) {
  const rows = [];
  for (const table of ['base_lexicon', 'domain_lexicon']) {
    const q =
      table === 'domain_lexicon'
        ? `SELECT word, pinyin_key, tone_pinyin_key, prior_score, repair_target, domain_id as domain FROM domain_lexicon WHERE enabled=1 AND tone_pinyin_key IS NOT NULL AND tone_pinyin_key != ''`
        : `SELECT word, pinyin_key, tone_pinyin_key, prior_score, repair_target, NULL as domain FROM base_lexicon WHERE enabled=1 AND tone_pinyin_key IS NOT NULL AND tone_pinyin_key != ''`;
    rows.push(...db.prepare(q).all());
  }

  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.pinyin_key}::${[...r.word].length}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  const distinguishable = [];
  const indistinguishable = [];

  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const pinyinKey = key.split('::')[0];
    const uniq = new Map();
    for (const g of group) {
      const tk = g.tone_pinyin_key;
      if (!uniq.has(tk)) uniq.set(tk, []);
      uniq.get(tk).push(g);
    }
    const toneKeys = [...uniq.keys()];
    const freq = group.reduce((s, g) => s + (g.prior_score || 0), 0);

    if (toneKeys.length >= 2) {
      for (let i = 0; i < toneKeys.length; i++) {
        for (let j = i + 1; j < toneKeys.length; j++) {
          const a = uniq.get(toneKeys[i])[0];
          const b = uniq.get(toneKeys[j])[0];
          distinguishable.push({
            pinyin: pinyinKey,
            wordA: a.word,
            toneA: toneKeys[i],
            wordB: b.word,
            toneB: toneKeys[j],
            freqScore: freq,
            repairA: a.repair_target === 1,
            repairB: b.repair_target === 1,
          });
        }
      }
    }
    if (toneKeys.length === 1 && group.length >= 2) {
      const words = [...new Set(group.map((g) => g.word))];
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          indistinguishable.push({
            wordA: words[i],
            wordB: words[j],
            pinyin: pinyinKey,
            tone: toneKeys[0],
            freqScore: freq,
          });
        }
      }
    }
  }

  distinguishable.sort((a, b) => b.freqScore - a.freqScore);
  indistinguishable.sort((a, b) => b.freqScore - a.freqScore);
  return { distinguishable, indistinguishable, totalLexiconRows: rows.length };
}

function findSpansInText(rawText, db) {
  const spans = [];
  const chars = [...rawText];
  for (let len = 2; len <= 5; len++) {
    for (let start = 0; start <= chars.length - len; start++) {
      const text = chars.slice(start, start + len).join('');
      if (!/^\p{Script=Han}+$/u.test(text)) continue;
      const syllables = textToSyllables(text);
      const key = syllablesKey(syllables);
      const bucket = db
        .prepare(
          `SELECT COUNT(*) as c FROM base_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1`
        )
        .get(key, len);
      const bucketD = db
        .prepare(
          `SELECT COUNT(*) as c FROM domain_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1`
        )
        .get(key, len);
      const cnt = (bucket?.c || 0) + (bucketD?.c || 0);
      if (cnt >= 2) {
        spans.push({ text, start, end: start + len, pinyinKey: key, bucketSize: cnt });
      }
    }
  }
  return spans;
}

function compareRecallOrder(spanText, pattern, profile) {
  const recall = recallSpanTopK(spanText, profile, 8, MIN_PRIOR, DOMAINS, { perSpanLimit: 8 });
  const hits = recall.hits.map((h) => ({
    hotword: {
      word: h.word,
      priorScore: h.priorScore,
      tonePinyinKey: h.tonePinyinKey || resolveCandidateToneKey(h.word),
    },
    candidateScore: h.candidateScore,
  }));
  const off = sortRecallHitsByToneCompatibility(hits, null);
  const on = sortRecallHitsByToneCompatibility(hits, pattern ?? undefined);
  const offTop = off.hits.map((h) => h.hotword.word);
  const onTop = on.hits.map((h) => h.hotword.word);
  const compat = on.hits.filter((h) =>
    pattern?.length
      ? isCandidateToneCompatible(pattern, h.hotword.tonePinyinKey, h.hotword.word)
      : false
  );
  return { offTop, onTop, recall, compatWords: compat.map((h) => h.hotword.word), recallToneCompatibleCount: on.recallToneCompatibleCount };
}

async function auditDialog200(db, profile, fwUp, nodeUp, port) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const golden = new Map(manifest.map((m) => [m.id, m]));

  const trueHits = [];
  const onOffDiffs = [];
  const cnnStats = { byTone: { 1: { ok: 0, total: 0 }, 2: { ok: 0, total: 0 }, 3: { ok: 0, total: 0 }, 4: { ok: 0, total: 0 }, 5: { ok: 0, total: 0 } }, confusion: {} };
  let toneEnabledCases = 0;

  for (const item of manifest) {
    const wavPath = path.join(path.dirname(MANIFEST_PATH), item.file);
    if (!fs.existsSync(wavPath)) continue;

    let raw = '';
    let tone = null;
    let fwExtra = null;

    if (fwUp) {
      try {
        fwExtra = await fwUtterance(wavPath, `p1-${item.id}`);
        raw = (fwExtra.text || '').trim();
        tone = fwExtra.tone || null;
      } catch (_) {
        continue;
      }
    }

    if (!raw) continue;
    if (tone?.toneEnabled) toneEnabledCases += 1;

    const ref = golden.get(item.id)?.utterance || '';
    if (tone?.toneEnabled) {
      const charMap = alignToneTokensToChars(raw, tone.toneTokens || []);
      for (let ci = 0; ci < raw.length; ci += 1) {
        const ch = raw[ci];
        if (!/[\u4e00-\u9fff]/.test(ch)) continue;
        const tok = charMap.get(ci);
        if (!tok) continue;
        const expArr = expectedTonesFromText(ch);
        const exp = expArr[0];
        if (exp < 1 || exp > 5) continue;
        const pred = argmaxToneFromPosterior(tok.tonePosterior);
        cnnStats.byTone[exp].total += 1;
        if (pred === exp) cnnStats.byTone[exp].ok += 1;
        else {
          const k = `${exp}→${pred}`;
          cnnStats.confusion[k] = (cnnStats.confusion[k] || 0) + 1;
        }
      }
    }

    if (!isToneAlignmentValid(raw, tone)) continue;
    const homophoneSpans = findSpansInText(raw, db);

    for (const span of homophoneSpans) {
      const pattern = extractAcousticTonePattern(raw, span.start, span.end, tone);
      if (!pattern?.length) continue;
      const cmp = compareRecallOrder(span.text, pattern, profile);
      const refWord = ref.includes(span.text) ? span.text : null;
      const goldenSlice = ref.slice(span.start, span.end);

      for (const h of cmp.recall.hits) {
        const cKey = h.tonePinyinKey || resolveCandidateToneKey(h.word);
        if (!isCandidateToneCompatible(pattern, cKey, h.word)) continue;
        const offRank = cmp.offTop.indexOf(h.word) + 1;
        const onRank = cmp.onTop.indexOf(h.word) + 1;
        if (onRank === 0) continue;
        trueHits.push({
          caseId: item.id,
          原词: goldenSlice || refWord || span.text,
          ASR词: span.text,
          Recall候选: h.word,
          acousticTonePattern: pattern,
          candidateTonePattern: cKey,
          toneCompatible: true,
          offRank,
          onRank,
          rankChanged: offRank !== onRank,
          priorScore: h.priorScore,
        });
      }

      if (cmp.offTop[0] !== cmp.onTop[0] || cmp.offTop.slice(0, 3).join('|') !== cmp.onTop.slice(0, 3).join('|')) {
        onOffDiffs.push({
          caseId: item.id,
          span: span.text,
          原词: goldenSlice,
          acousticTonePattern: pattern,
          offTop1: cmp.offTop[0],
          onTop1: cmp.onTop[0],
          offTop3: cmp.offTop.slice(0, 3),
          onTop3: cmp.onTop.slice(0, 3),
          recallToneCompatibleCount: cmp.recallToneCompatibleCount,
          likelyBenefit: !!(goldenSlice && cmp.onTop[0] === goldenSlice && cmp.onTop[0] !== span.text),
          misrepairRisk: cmp.onTop[0] !== span.text && (!goldenSlice || cmp.onTop[0] !== goldenSlice),
        });
      }
    }

    if (nodeUp && tone?.toneEnabled) {
      try {
        const onRes = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wavPath,
            srcLang: 'zh',
            use_lexicon: true,
            is_manual_cut: true,
            session_id: `p1-audit-${item.id}`,
          }),
          signal: AbortSignal.timeout(300000),
        });
        const onData = await onRes.json();
        if (!onRes.ok) continue;
        const rawNode = (onData.extra?.raw_asr_text || '').trim();
        const offRes = await fetch(`http://127.0.0.1:${port}/run-lexicon-mock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asrText: rawNode, srcLang: 'zh' }),
          signal: AbortSignal.timeout(120000),
        });
        const offData = await offRes.json();
        if (!offRes.ok) continue;
        const onSpans = onData.extra?.fw_detector?.spans || [];
        const offSpans = offData.extra?.fw_detector?.spans || [];
        for (let si = 0; si < Math.min(onSpans.length, offSpans.length); si++) {
          const oC = (onSpans[si].candidates || []).map((c) => c.word);
          const fC = (offSpans[si].candidates || []).map((c) => c.word);
          if (oC[0] !== fC[0] || oC.slice(0, 3).join('|') !== fC.slice(0, 3).join('|')) {
            const existing = onOffDiffs.find((d) => d.caseId === item.id && d.span === onSpans[si].text);
            if (!existing) {
              onOffDiffs.push({
                caseId: item.id,
                span: onSpans[si].text,
                source: 'node_e2e',
                offTop1: fC[0],
                onTop1: oC[0],
                offTop3: fC.slice(0, 3),
                onTop3: oC.slice(0, 3),
              });
            }
          }
        }
      } catch (_) {}
    }

    process.stdout.write(`[p1 ${item.id}] spans=${homophoneSpans.length}\n`);
  }

  trueHits.sort((a, b) => (a.rankChanged === b.rankChanged ? a.onRank - b.onRank : b.rankChanged - a.rankChanged));
  return { trueHits, onOffDiffs, cnnStats, toneEnabledCases, casesProcessed: manifest.length };
}

async function main() {
  ensureLexiconRuntimeV2Loaded();
  const profile = defaultGeneralProfile();
  const db = new Database(SQLITE, { readonly: true });

  const lex = scanLexiconHomophones(db);

  let fwUp = false;
  let nodeUp = false;
  let port = 5020;
  try {
    const h = await fetch(`http://127.0.0.1:${FW_PORT}/health`, { signal: AbortSignal.timeout(3000) });
    fwUp = h.ok;
  } catch (_) {}
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'lingua-electron-node/electron-node-config.json'), 'utf8'));
    port = cfg.testServer?.port || 5020;
    const h = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    nodeUp = h.ok;
  } catch (_) {}

  const dialog = await auditDialog200(db, profile, fwUp, false, port);

  const cnnAccuracy = {};
  for (const [t, v] of Object.entries(dialog.cnnStats.byTone)) {
    cnnAccuracy[`tone${t}`] = v.total ? { accuracy: v.ok / v.total, ok: v.ok, total: v.total } : { accuracy: null, ok: 0, total: 0 };
  }

  const report = {
    audit: 'ToneModule P1 Benefit Audit',
    timestamp: new Date().toISOString(),
    fwServiceUp: fwUp,
    nodeServiceUp: nodeUp,
    part2_toneDistinguishableTop100: lex.distinguishable.slice(0, 100),
    part2_stats: {
      totalDistinguishablePairs: lex.distinguishable.length,
      totalLexiconRowsWithTone: lex.totalLexiconRows,
    },
    part3_toneIndistinguishable: {
      count: lex.indistinguishable.length,
      top50: lex.indistinguishable.slice(0, 50),
      theoreticalMaxToneCoverage: lex.distinguishable.length,
      theoreticalNoBenefitPairs: lex.indistinguishable.length,
    },
    part1_trueHitsTop20: dialog.trueHits.slice(0, 20),
    part1_trueHitsTotal: dialog.trueHits.length,
    part1_rankChangedHits: dialog.trueHits.filter((h) => h.rankChanged).length,
    part4_onOffDiffs: dialog.onOffDiffs,
    part4_summary: {
      totalDiffCases: dialog.onOffDiffs.length,
      top1Changes: dialog.onOffDiffs.filter((d) => d.offTop1 !== d.onTop1).length,
      top3Changes: dialog.onOffDiffs.filter((d) => (d.offTop3 || []).join('|') !== (d.onTop3 || []).join('|')).length,
      likelyBenefit: dialog.onOffDiffs.filter((d) => d.likelyBenefit).length,
      misrepairRisk: dialog.onOffDiffs.filter((d) => d.misrepairRisk).length,
    },
    part5_cnnQuality: {
      toneEnabledCases: dialog.toneEnabledCases,
      perToneAccuracy: cnnAccuracy,
      confusionPairs: Object.entries(dialog.cnnStats.confusion)
        .sort((a, b) => b[1] - a[1])
        .map(([pair, count]) => ({ pair, count })),
    },
    p05CrossCheck: fs.existsSync(P05_JSON) ? JSON.parse(fs.readFileSync(P05_JSON, 'utf8')).part3_4_10_dialog200 : null,
  };

  db.close();
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log('\n=== P1 Benefit Audit ===');
  console.log('distinguishable pairs:', lex.distinguishable.length);
  console.log('indistinguishable pairs:', lex.indistinguishable.length);
  console.log('true tone hits:', dialog.trueHits.length, 'rank changed:', report.part1_rankChangedHits);
  console.log('on/off diffs:', report.part4_summary.totalDiffCases);
  console.log('Wrote', OUT_JSON);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
