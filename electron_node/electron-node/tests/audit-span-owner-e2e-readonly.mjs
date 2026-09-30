#!/usr/bin/env node
/** Build SPAN_OWNER audit TRACE from existing FineSpan-local TRACE (read-only). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = (() => {
  try {
    return require('better-sqlite3');
  } catch {
    return null;
  }
})();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(
  REPO,
  'docs/user_correction/model3/LINGUA_MODEL2_FINESPAN_LOCAL_TONE_BINDING_SINGLE_DELTA_TRACE.jsonl'
);
const OUT = path.join(
  REPO,
  'docs/user_correction/model3/LINGUA_MODEL2_STAGE_J_SPAN_OWNER_END_TO_END_TRACE.jsonl'
);

function spanLen(fs_) {
  if (fs_?.syllable_start != null && fs_?.syllable_end != null) {
    return fs_.syllable_end - fs_.syllable_start;
  }
  return [...(fs_?.source_text || '')].length;
}

function bucket(n) {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n === 3) return '3';
  return '4-6';
}

const rows = fs.readFileSync(SRC, 'utf8').trim().split(/\n/).map(JSON.parse);
const out = [];

for (const r of rows) {
  const spans = [];
  const seen = new Set();
  for (const t of r.p_span_traces || []) {
    const fs_ = t.finespan || {};
    const key = `${fs_.source_text}|${fs_.start}|${fs_.end}|${fs_.syllable_start}|${fs_.syllable_end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pr = t.p_retrieval || {};
    const L = spanLen(fs_);
    const queries = (pr.queries || []).map((q) => ({
      action: q.action_id,
      pinyin_key: q.pinyin_key,
      query: q.query,
      query_len: (q.query || []).length,
      hits: (q.hits || []).map((h) => h.surface),
    }));
    spans.push({
      text: fs_.source_text,
      start: fs_.start,
      end: fs_.end,
      syllable_start: fs_.syllable_start,
      syllable_end: fs_.syllable_end,
      span_len: L,
      phon: fs_.phonetic_representation,
      tone: fs_.tone_representation,
      p_status: pr.status,
      query_lens: queries.map((q) => q.query_len),
      queries,
      tone_pattern_source: pr.tone_pattern_source || null,
    });
  }

  const target = r.evaluationTargetSurface;
  const targetLen = [...target].length;
  const targetRegionSpans = spans.filter((s) => {
    // heuristic: span text overlaps ASR confusion for target (chars in raw near target)
    return s.text && (target.includes(s.text) || s.text.length >= 1);
  });

  const stage = {
    generated_PathFineSpan: { 1: 0, 2: 0, 3: 0, '4-6': 0 },
    Model2_input: { 1: 0, 2: 0, 3: 0, '4-6': 0 },
    PAction_produced: { 1: 0, 2: 0, 3: 0, '4-6': 0 },
    Recall_query: { 1: 0, 2: 0, 3: 0, '4-6': 0 },
    Lexicon_hit: { 1: 0, 2: 0, 3: 0, '4-6': 0 },
  };
  for (const s of spans) {
    const b = bucket(s.span_len);
    if (stage.generated_PathFineSpan[b] != null) stage.generated_PathFineSpan[b] += 1;
    // all path FineSpans are Model2-looped
    if (stage.Model2_input[b] != null) stage.Model2_input[b] += 1;
    if (s.p_status === 'EXECUTED') {
      if (stage.PAction_produced[b] != null) stage.PAction_produced[b] += 1;
      for (const ql of s.query_lens) {
        const qb = bucket(ql);
        if (stage.Recall_query[qb] != null) stage.Recall_query[qb] += 1;
      }
      for (const q of s.queries) {
        if (q.hits.length) {
          const qb = bucket(q.query_len);
          if (stage.Lexicon_hit[qb] != null) stage.Lexicon_hit[qb] += 1;
        }
      }
    }
  }

  const pExecuted = spans.filter((s) => s.p_status === 'EXECUTED');
  const multiCharPath = spans.filter((s) => s.span_len >= 2);
  const multiCharP = pExecuted.filter((s) => s.span_len >= 2);
  const targetExactQuery = pExecuted.some((s) =>
    s.queries.some((q) => q.pinyin_key && q.pinyin_key.split('|').length === targetLen)
  );

  out.push({
    kind: 'CASE_SPAN_GEOMETRY',
    caseId: r.caseId,
    frozenRawText: r.frozenRawText,
    evaluationTargetSurface: target,
    targetLen,
    targetInLexicon: r.targetInLexicon,
    relationFamily: r.relationFamily,
    pathFineSpan_count: spans.length,
    pathFineSpan_len_dist: stage.generated_PathFineSpan,
    multiChar_PathFineSpans: multiCharPath.map((s) => s.text),
    P_executed_spans: pExecuted.map((s) => ({
      text: s.text,
      span_len: s.span_len,
      queries: s.queries,
    })),
    multiChar_P_executed: multiCharP.map((s) => ({
      text: s.text,
      span_len: s.span_len,
      queries: s.queries,
    })),
    FINESPAN_TO_QUERY_LENGTH_TRANSITION: pExecuted.map((s) =>
      s.queries.map((q) => `${s.span_len}→${q.query_len}`).join(',')
    ),
    TARGET_QUERY_CLASS: targetExactQuery ? 'TARGET_QUERY_PARTIAL_OR_EXACT' : 'TARGET_NEVER_QUERIED',
    stage_counts: stage,
    all_path_finespans: spans,
  });
}

fs.writeFileSync(OUT, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log('WROTE', OUT, 'cases', out.length);
for (const c of out) {
  console.log(
    c.caseId,
    'target',
    c.evaluationTargetSurface,
    'pathSpans',
    c.pathFineSpan_count,
    'multi',
    c.multiChar_PathFineSpans,
    'Pmulti',
    c.multiChar_P_executed.map((x) => x.text),
    c.TARGET_QUERY_CLASS
  );
}
