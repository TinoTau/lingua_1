#!/usr/bin/env node
/**
 * Re-apply Formula A (Assembly owner helper) to 75 Meaningful Competition Cases
 * using frozen dialog_200 sentence-assembly traces + KENLM_BENCHMARK_V1 ranking.
 * Metadata-only — does not alter candidate texts/order/scores.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node/electron-node');
const DIST = path.join(ELECTRON, 'dist/main/electron-node/main/src/fw-detector');
const TRACE = path.join(REPO, 'docs/tone-v2/_audit_scratch/dialog200_sentence_assembly_trace');
const BENCH = path.join(
  REPO,
  'docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv'
);
const OUT = path.join(
  REPO,
  'docs/acceptance/Development/2026-08-05_Repair_Selection_Completeness_Metadata_Implementation'
);

const require = createRequire(import.meta.url);

function loadHelper() {
  const p = path.join(DIST, 'derive-repair-selection-completeness.js');
  if (!fs.existsSync(p)) {
    throw new Error(`Missing compiled helper: ${p}. Run npm run build:main first.`);
  }
  return require(p);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = splitCsv(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsv(line);
    const o = {};
    headers.forEach((h, i) => {
      o[h] = cols[i] ?? '';
    });
    return o;
  });
}

function splitCsv(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function loadTrace(caseId) {
  const n = caseId.replace(/^d/, '');
  const file = path.join(TRACE, `${n.padStart(3, '0')}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Assign sequential char ranges for fine spans by scanning rawText. */
function assignSpanRanges(rawText, spans) {
  let cursor = 0;
  return spans.map((sp) => {
    const t = sp.spanText ?? '';
    if (!t) return { ...sp, start: cursor, end: cursor };
    const idx = rawText.indexOf(t, cursor);
    if (idx < 0) {
      return { ...sp, start: cursor, end: cursor };
    }
    cursor = idx + t.length;
    return { ...sp, start: idx, end: idx + t.length };
  });
}

function pickBucket(trace) {
  const buckets = trace.buckets || [];
  if (!buckets.length) return null;
  // Prefer bucket whose assembly produced kenlm texts
  const kenlm = new Set(trace.kenlmInputTexts || []);
  for (const b of buckets) {
    const texts = b.assemblyTexts || b.generatedTexts || [];
    if (texts.some((t) => kenlm.has(t))) return b;
  }
  return buckets[0];
}

function buildSpanSetsFromBucket(rawText, bucket, { isCanonicalPick, isRepairOptionPick }) {
  const spans = assignSpanRanges(rawText, bucket.spans || []);
  const spanSets = [];
  const slotRanges = [];
  for (const sp of spans) {
    const start = sp.start;
    endGuard(sp);
    const end = sp.end;
    if (start >= end) continue;
    const spanText = rawText.slice(start, end);
    const words = unique([...(sp.budgeted || []), ...(sp.sameDomain || []), ...(sp.base || []), spanText]);
    const picks = words.map((word) => {
      const canonical = word === spanText;
      return {
        span: { text: spanText, start, end },
        word,
        source: canonical ? 'canonical_exact' : 'base_term',
        priorScore: canonical ? 0 : 1,
        repairTarget: !canonical,
        candidateScore: canonical ? 0 : 1,
      };
    });
    // Ensure at least canonical
    if (!picks.some((p) => isCanonicalPick(p))) {
      picks.push({
        span: { text: spanText, start, end },
        word: spanText,
        source: 'canonical_exact',
        priorScore: 0,
        repairTarget: false,
        candidateScore: 0,
      });
    }
    spanSets.push(picks);
    slotRanges.push({ start, end });
  }
  return { spanSets, slotRanges };
}

function endGuard(_sp) {}

function unique(arr) {
  return [...new Set(arr.filter((x) => typeof x === 'string' && x.length > 0))];
}

/**
 * Prefer live uniqueBeforeCap replacements; attach Formula A via owner helper
 * using reconstructed spanSets from the same Path bucket.
 */
function metaForCombo(combo, spanSets, slotRanges, derive) {
  return derive.deriveRepairSelectionCompleteness(
    spanSets,
    combo.replacements || [],
    slotRanges
  );
}

function main() {
  const derive = loadHelper();
  const bench = parseCsv(fs.readFileSync(BENCH, 'utf8'));
  const caseIds = [...new Set(bench.map((r) => r.caseId))].sort();
  const rows = [];
  const counts = { RAW: 0, PARTIAL_SELECTION: 0, COMPLETE_SELECTION: 0 };
  const focus = [];

  for (const caseId of caseIds) {
    const caseRows = bench.filter((r) => r.caseId === caseId);
    const trace = loadTrace(caseId);
    if (!trace) {
      for (const r of caseRows) {
        rows.push({
          caseId,
          candidateId: r.candidateId,
          candidateText: r.candidateText,
          repairSelectionCompleteness: 'MISSING_TRACE',
          repairPickCount: '',
          unrepairedRepairableSlotCount: '',
          kenlmInput: 'true',
          kenlmRank: r.rank,
          selected: String(r.rank === '1' || r.rank === 1),
          note: 'trace_missing',
        });
      }
      continue;
    }

    const bucket = pickBucket(trace);
    const { spanSets, slotRanges } = bucket
      ? buildSpanSetsFromBucket(trace.rawText, bucket, derive)
      : { spanSets: [], slotRanges: [] };

    const combos = trace.uniqueBeforeCap || [];
    const byText = new Map();
    for (const c of combos) {
      if (!byText.has(c.text)) byText.set(c.text, c);
    }

    for (const r of caseRows) {
      const combo = byText.get(r.candidateText);
      let meta;
      if (combo && spanSets.length) {
        meta = metaForCombo(combo, spanSets, slotRanges, derive);
      } else if (combo) {
        // Fallback: only repair picks from this combination (treat unknown slots as non-repairable)
        meta = derive.deriveRepairSelectionCompleteness(
          (combo.replacements || []).map((p) => [p]),
          combo.replacements || [],
          (combo.replacements || []).map((p) => ({ start: p.span.start, end: p.span.end }))
        );
      } else {
        meta = {
          repairSelectionCompleteness: 'RAW',
          repairPickCount: 0,
          unrepairedRepairableSlotCount: 0,
        };
      }

      counts[meta.repairSelectionCompleteness] =
        (counts[meta.repairSelectionCompleteness] || 0) + 1;

      const row = {
        caseId,
        candidateId: r.candidateId,
        candidateText: r.candidateText,
        repairSelectionCompleteness: meta.repairSelectionCompleteness,
        repairPickCount: meta.repairPickCount,
        unrepairedRepairableSlotCount: meta.unrepairedRepairableSlotCount,
        kenlmInput: 'true',
        kenlmRank: r.rank,
        selected: String(Number(r.rank) === 1),
        note: '',
      };
      rows.push(row);

      if (
        /候选声城|候选生城/.test(r.candidateText) &&
        !/后选/.test(r.candidateText.replace(/候选/g, ''))
      ) {
        // highlight candidates that look like 候选声城 / 候选生城 structural completes
      }
      if (r.candidateText.includes('候选声城') || r.candidateText.includes('候选生城')) {
        focus.push(row);
      }
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  writeCsv(
    path.join(OUT, 'metadata_distribution.csv'),
    [
      'caseId',
      'candidateId',
      'candidateText',
      'repairSelectionCompleteness',
      'repairPickCount',
      'unrepairedRepairableSlotCount',
      'kenlmInput',
      'kenlmRank',
      'selected',
    ],
    rows
  );

  const total = rows.length;
  const summary = {
    competitionCases: caseIds.length,
    candidateRows: total,
    distribution: counts,
    ratios: Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, total ? +(v / total).toFixed(4) : 0])
    ),
    focus候选声城_or_生城: focus.filter(
      (r) => r.candidateText.includes('候选声城') || r.candidateText.includes('候选生城')
    ),
    helperSha256: createHash('sha256')
      .update(fs.readFileSync(path.join(DIST, 'derive-repair-selection-completeness.js')))
      .digest('hex'),
  };
  fs.writeFileSync(path.join(OUT, '_metadata_distribution_stats.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
