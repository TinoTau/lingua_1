#!/usr/bin/env node
/**
 * Read-only ASR Surface Drift audit on Dialog200 Expansion V1.1 batch.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.resolve(__dirname, '../lexicon-expansion-v1_1-dialog200-batch-result.json');
const MANIFEST = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');
const OUT = path.join(__dirname, 'asr-surface-drift-audit-results.json');

// Known alias map from Expansion V1.1 audit (frozen)
const KNOWN_ALIASES = [
  { canonical: '香菜', aliases: ['像蔡'], pinyin: 'xiang|cai' },
  { canonical: '高速', aliases: ['告诉', '高诉', '高路'], pinyin: 'gao|su' },
  { canonical: '后选', aliases: ['后选', '候選', '候选'], pinyin: 'hou|xuan' },
  { canonical: '生成', aliases: ['生城', '声城'], pinyin: 'sheng|cheng' },
  { canonical: '上线计划', aliases: ['上线计化', '上线计花', '上限计划', '上限计化'], pinyin: null },
  { canonical: '候选生成', aliases: ['候選生成', '后选生成'], pinyin: null },
];

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  const m = r.length;
  const n = h.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        r[i - 1] === h[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n] / r.length;
}

function editDistance(a, b) {
  const r = norm(a);
  const h = norm(b);
  const m = r.length;
  const n = h.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        r[i - 1] === h[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function severityFromCER(c) {
  if (c <= 0.1) return 'Low';
  if (c <= 0.25) return 'Medium';
  if (c <= 0.5) return 'High';
  return 'Extreme';
}

function severityFromEdit(ed, refLen) {
  const r = Math.max(1, refLen);
  const ratio = ed / r;
  if (ratio <= 0.1) return 'Low';
  if (ratio <= 0.25) return 'Medium';
  if (ratio <= 0.5) return 'High';
  return 'Extreme';
}

function containsAsrSurface(raw, alias) {
  if (raw.includes(alias)) return true;
  const pairs = [
    ['诉', '訴'],
    ['计', '計'],
    ['划', '劃'],
    ['选', '選'],
    ['后', '後'],
    ['发', '發'],
    ['广', '廣'],
    ['线', '線'],
    ['国', '國'],
    ['学', '學'],
  ];
  let variants = [alias];
  for (const [s, t] of pairs) {
    const next = [];
    for (const v of variants) {
      next.push(v.replaceAll(s, t), v.replaceAll(t, s));
    }
    variants = [...new Set([...variants, ...next])];
  }
  return variants.some((v) => raw.includes(v));
}

function findAliasTargets(ref, raw) {
  const hits = [];
  for (const entry of KNOWN_ALIASES) {
    const canonInRef = ref.includes(entry.canonical) || norm(ref).includes(norm(entry.canonical));
    if (!canonInRef) continue;
    let asrSurface = null;
    for (const al of entry.aliases) {
      if (containsAsrSurface(raw, al)) {
        asrSurface = al;
        break;
      }
    }
    // also check if canonical appears in raw (no drift)
    const canonInRaw = raw.includes(entry.canonical);
    hits.push({
      canonical: entry.canonical,
      asrSurface: asrSurface || (canonInRaw ? entry.canonical : null),
      aliasReachable: !!asrSurface && entry.aliases.includes(asrSurface),
      canonInRaw,
    });
  }
  return hits;
}

function classifyDrift(ref, raw, aliasHits) {
  const r = norm(ref);
  const h = norm(raw);
  if (r === h) return { type: 'None', source: 'exact_asr', severity: 'Low' };

    // Word drift: ref term missing and ASR has unrelated surface (not alias-listed)
  for (const hit of aliasHits) {
    if (!hit.asrSurface && !hit.canonInRaw) {
      // check if any alias-listed surface appears with different canonical target
      return { type: 'D3', source: `word_drift:${hit.canonical}`, severity: 'High' };
    }
  }

  // Homophone reachable but other drift dominates
  for (const hit of aliasHits) {
    if (hit.aliasReachable) {
      return { type: 'D1', source: `homophone:${hit.canonical}→${hit.asrSurface}`, severity: 'Medium' };
    }
  }

  // Near-phone: single char substitution in short spans
  const ed = editDistance(ref, raw);
  const refLen = norm(ref).length;
  if (ed <= 3 && refLen > 0 && ed / refLen < 0.15) {
    return { type: 'D2', source: 'near_phone', severity: severityFromEdit(ed, refLen) };
  }

  // Phrase recomposition: ref contains multi-char terms absent in raw but partial morphemes present
  const refTerms = ['候选生成', '后选生城', '上线计划', '上线计化', '机场高速', '中关村'];
  for (const term of refTerms) {
    if (ref.includes(term) && !raw.includes(term)) {
      const parts = term.match(/.{1,2}/g) || [];
      const partial = parts.filter((p) => raw.includes(p)).length;
      if (partial >= 1 && partial < parts.length) {
        return { type: 'D4', source: `phrase_partial:${term}`, severity: 'High' };
      }
    }
  }

  // Word drift block moved above D1 fallback

  // (removed duplicate D3 block)

  // Structural: large edit distance
  if (ed / Math.max(1, refLen) > 0.35) {
    return { type: 'D5', source: 'structural', severity: severityFromEdit(ed, refLen) };
  }

  return { type: 'D2', source: 'general_substitution', severity: severityFromEdit(ed, refLen) };
}

function spanRecoverable(c, aliasHits) {
  const fw = c.extra?.fw_detector;
  const spans = fw?.spans || [];
  const sr = fw?.sentenceRerank;
  const reasons = [];

  for (const hit of aliasHits) {
    if (!hit.aliasReachable) {
      reasons.push(`alias_surface_missing:${hit.canonical}`);
      continue;
    }
    const surface = hit.asrSurface;
    let recalled = false;
    for (const span of spans) {
      const inSpan = span.text?.includes(surface) || surface?.includes(span.text?.slice(0, 2));
      const candWords = (span.candidates || []).map((x) => x.word);
      if (inSpan && candWords.some((w) => w.includes(hit.canonical) || hit.canonical.includes(w))) {
        recalled = true;
      }
    }
    if (recalled) reasons.push(`recall_hit:${hit.canonical}`);
    else reasons.push(`recall_miss:${hit.canonical}`);
  }

  const anyReachable = aliasHits.some((h) => h.aliasReachable);
  const anyRecall = reasons.some((r) => r.startsWith('recall_hit'));
  const applied = (c.fw_applied_count || 0) > 0;
  const kenlmBlock = sr?.pickedIsRaw && (sr?.maxDelta ?? 0) > 0 && !applied;

  if (!anyReachable) return { recoverable: false, reason: 'asr_surface_unreachable' };
  if (anyRecall && kenlmBlock) return { recoverable: 'partial', reason: 'recall_ok_kenlm_blocked' };
  if (anyRecall && applied) return { recoverable: true, reason: 'recall_applied' };
  if (anyRecall) return { recoverable: 'partial', reason: reasons.join(';') };
  return { recoverable: false, reason: reasons.join(';') || 'no_span_match' };
}

function recallRecoverable(c, aliasHits) {
  const fw = c.extra?.fw_detector;
  const spans = fw?.spans || [];
  let byAlias = false;
  let byLexicon = false;

  for (const span of spans) {
    for (const cand of span.candidates || []) {
      if (cand.source?.includes('lexicon') || cand.source === 'lexicon_pinyin_topk') {
        byLexicon = true;
      }
      for (const hit of aliasHits) {
        if (hit.aliasReachable && cand.word?.includes(hit.canonical)) {
          byAlias = true;
        }
      }
    }
  }

  const reachable = aliasHits.some((h) => h.aliasReachable);
  const surfaceOk = reachable;
  const comboCount = fw?.sentenceRerank?.combinationCount ?? 0;

  return {
    recoverable_by_alias: byAlias && surfaceOk,
    recoverable_by_lexicon: byLexicon && surfaceOk,
    recoverable_by_recall: byAlias || byLexicon,
    asr_blocks: !surfaceOk,
    combinationCount: comboCount,
  };
}

function rootCause(c, aliasHits, drift, spanRec, recallRec) {
  const applied = (c.fw_applied_count || 0) > 0;
  const finalCer = c._finalCer;
  const improved = c._improved;

  if (improved || (applied && finalCer < 0.05)) return 'Resolved';

  if (!aliasHits.some((h) => h.aliasReachable) && drift.type !== 'None') {
    return 'D'; // ASR Surface Drift
  }

  if (aliasHits.some((h) => h.aliasReachable) && recallRec.recoverable_by_alias && spanRec.reason?.includes('kenlm')) {
    return 'E'; // Mixed - recall ok but downstream
  }

  if (aliasHits.some((h) => h.aliasReachable) && !recallRec.recoverable_by_recall) {
    return 'D'; // ASR surface - span window can't see alias
  }

  if (aliasHits.some((h) => h.aliasReachable) && recallRec.recoverable_by_recall && !applied) {
    return 'E'; // Mixed recall+gate or candidate quality
  }

  if (drift.type === 'D5' || drift.severity === 'Extreme') return 'D';

  return 'E';
}

function main() {
  const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

  const all = [];
  for (const c of batch.cases.filter((x) => !x.skip)) {
    const ref = refById[c.id] || '';
    const raw = (c.raw_asr_preview || '').trim();
    const final = (c.text_asr_preview || '').trim();
    const rawCer = cer(ref, raw);
    const finalCer = cer(ref, final);
    const improved = finalCer < rawCer - 0.0001;
    const exact = norm(ref) === norm(final);
    c._finalCer = finalCer;
    c._improved = improved;
    c._rawCer = rawCer;

    const aliasHits = findAliasTargets(ref, raw);
    const drift = classifyDrift(ref, raw, aliasHits);
    const ed = editDistance(ref, raw);
    const spanRec = spanRecoverable(c, aliasHits);
    const recallRec = recallRecoverable(c, aliasHits);
    const rc = rootCause(c, aliasHits, drift, spanRec, recallRec);

    all.push({
      id: c.id,
      scenario: c.scenario,
      ref,
      raw,
      final,
      rawCer: Number(rawCer.toFixed(4)),
      finalCer: Number(finalCer.toFixed(4)),
      improved,
      exact,
      applied: c.fw_applied_count || 0,
      aliasHits,
      drift,
      editDistance: ed,
      driftSeverity: severityFromEdit(ed, norm(ref).length),
      aliasReachable: aliasHits.some((h) => h.aliasReachable),
      aliasUnreachable: aliasHits.length > 0 && !aliasHits.some((h) => h.aliasReachable),
      spanRec,
      recallRec,
      rootCause: rc,
      maxDelta: c.extra?.fw_detector?.sentenceRerank?.maxDelta,
      pickedIsRaw: c.extra?.fw_detector?.sentenceRerank?.pickedIsRaw,
    });
  }

  // Failure corpus: improved=false AND finalCer>0
  const failures = all.filter((x) => !x.improved && x.finalCer > 0.001);

  const rootCounts = {};
  for (const f of failures) {
    rootCounts[f.rootCause] = (rootCounts[f.rootCause] || 0) + 1;
  }

  const driftCounts = {};
  for (const f of failures) {
    driftCounts[f.drift.type] = (driftCounts[f.drift.type] || 0) + 1;
  }

  const aliasReachableCount = failures.filter((f) => f.aliasReachable).length;
  const aliasUnreachableCount = failures.filter((f) => f.aliasUnreachable).length;
  const noAliasTarget = failures.filter((f) => f.aliasHits.length === 0).length;

  const asrBlocked = failures.filter(
    (f) => f.rootCause === 'D' || f.recallRec.asr_blocks || f.aliasUnreachable
  ).length;

  const spanRecTrue = failures.filter((f) => f.spanRec.recoverable === true).length;
  const spanRecPartial = failures.filter((f) => f.spanRec.recoverable === 'partial').length;
  const spanRecFalse = failures.filter((f) => f.spanRec.recoverable === false).length;

  const recallByAlias = failures.filter((f) => f.recallRec.recoverable_by_alias).length;
  const lexiconOnly = failures.filter(
    (f) => f.recallRec.recoverable_by_lexicon && !f.recallRec.recoverable_by_alias
  ).length;

  const focusIds = ['d045', 'd180', 'd082', 'd007', 'd187', 'd021', 'd065', 'd133'];
  const focus = Object.fromEntries(focusIds.map((id) => [id, all.find((x) => x.id === id)]));

  const out = {
    meta: { timestamp: new Date().toISOString(), batch: BATCH, failureDefinition: 'improved=false AND finalCer>0' },
    summary: {
      total: all.length,
      exact: all.filter((x) => x.exact).length,
      improved: all.filter((x) => x.improved).length,
      failures: failures.length,
      aliasReachableInFailures: aliasReachableCount,
      aliasUnreachableInFailures: aliasUnreachableCount,
      noKnownAliasTarget: noAliasTarget,
      rootCauseCounts: rootCounts,
      driftTypeCounts: driftCounts,
      asrSurfaceDominated: asrBlocked,
      asrSurfacePct: Number(((asrBlocked / failures.length) * 100).toFixed(1)),
      expansionRoi: {
        total_failures: failures.length,
        alias_recoverable_surface: aliasReachableCount,
        recall_already_has_canonical: recallByAlias,
        lexicon_recoverable: recallByAlias + lexiconOnly,
        asr_blocked: asrBlocked,
        theoretical_lexicon_ceiling: aliasReachableCount - recallByAlias,
      },
      spanRecoverability: { true: spanRecTrue, partial: spanRecPartial, false: spanRecFalse },
    },
    failures: failures.map((f) => ({
      id: f.id,
      scenario: f.scenario,
      ref: f.ref.slice(0, 80),
      raw: f.raw.slice(0, 80),
      final: f.final.slice(0, 80),
      finalCer: f.finalCer,
      drift: f.drift,
      aliasReachable: f.aliasReachable,
      rootCause: f.rootCause,
    })),
    focus,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out.summary, null, 2));
}

main();
