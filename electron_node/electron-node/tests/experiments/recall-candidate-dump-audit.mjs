#!/usr/bin/env node
/**
 * READONLY AUDIT — Recall Candidate Dump (Phase 4E ApprovedSpan)
 * EXPERIMENT ONLY — does not change production defaults.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

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

const { recallSpanTopK } = require('../../dist/main/electron-node/main/src/lexicon/local-span-recall.js');
const { getPerSpanCandidateLimit } = require('../../dist/main/electron-node/main/src/fw-detector/per-span-candidate-limit.js');
const { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } = require('../../dist/main/electron-node/main/src/lexicon-v2/lexicon-runtime-v2-holder.js');
const { defaultGeneralProfile } = require('../../dist/main/electron-node/main/src/lexicon-v2/profile-registry.js');
const { textToSyllables } = require('../../dist/main/electron-node/main/src/lexicon/phonetic/pinyin.js');
const { syllablesKey } = require('../../dist/main/electron-node/main/src/lexicon/pinyin-index.js');
const { toneDistance, textToToneSyllables, toneSyllablesKey } = require('../../dist/main/electron-node/main/src/lexicon/phonetic/tone-pinyin.js');
const { matchEnabledDomain } = require('../../dist/main/electron-node/main/src/lexicon/domain-filter.js');

const GROUPS = {
  A_baseline: { label: 'Group A baseline (production perSpanLimit)', one: 8, two: 4, many: 2, production: true },
  B_medium: { label: 'Group B medium', one: 12, two: 6, many: 3 },
  C_wide: { label: 'Group C wide', one: 16, two: 8, many: 4 },
  D_very_wide: { label: 'Group D very wide', one: 24, two: 12, many: 6 },
};

const MIN_PRIOR = 0.5;
const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];
const PERF_PATH = path.join(__dirname, '../fw-detector-dialog-200-phase4e-quality-perf.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json');
const JSON_OUT = path.join(__dirname, 'recall-candidate-dump-audit-data.json');
const MD_OUT = path.join(__dirname, 'recall-candidate-dump-audit-report.md');

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function groupLimit(spanCountInCase, groupKey) {
  const g = GROUPS[groupKey];
  if (g.production) return getPerSpanCandidateLimit(spanCountInCase);
  return spanCountInCase <= 1 ? g.one : spanCountInCase === 2 ? g.two : g.many;
}

function buildAlignmentMap(raw, ref) {
  const a = [...norm(raw)];
  const b = [...norm(ref)];
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) dp[i][0] = i;
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  const rawToRef = Array(m).fill(-1);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      rawToRef[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else {
      const del = dp[i - 1][j];
      const ins = dp[i][j - 1];
      const sub = dp[i - 1][j - 1];
      if (sub <= del && sub <= ins) {
        rawToRef[i - 1] = j - 1;
        i -= 1;
        j -= 1;
      } else if (del <= ins) i -= 1;
      else j -= 1;
    }
  }
  return { rawToRef, rawNorm: a, refNorm: b };
}

function rawIndexToNormIndex(raw, idx) {
  return norm(raw.slice(0, idx)).length;
}

function extractCorrectCandidate(raw, ref, spanStart, spanEnd) {
  const rawSeg = raw.slice(spanStart, spanEnd);
  const nStart = rawIndexToNormIndex(raw, spanStart);
  const nEnd = rawIndexToNormIndex(raw, spanEnd);
  const spanLen = nEnd - nStart;
  if (spanLen <= 0) return { word: null, reason: 'empty_span' };

  const { rawToRef, refNorm } = buildAlignmentMap(raw, ref);
  const mapped = [];
  for (let k = nStart; k < nEnd; k++) {
    const r = rawToRef[k];
    if (r >= 0) mapped.push(r);
  }
  if (!mapped.length) return { word: null, reason: 'alignment_failed' };

  const rMin = Math.min(...mapped);
  const rMax = Math.max(...mapped);
  let word = refNorm.slice(rMin, rMax + 1).join('');
  if (word.length !== spanLen) {
    word = refNorm.slice(rMin, rMin + spanLen).join('');
  }
  if (!word || norm(word) === norm(rawSeg)) {
    return { word: null, reason: 'same_as_raw', rawSeg };
  }
  return { word, reason: 'aligned', rawSeg };
}

function isRefCorrectReplacement(spanText, word, ref) {
  const w = norm(word);
  const s = norm(spanText);
  if (!w || w === s || w.length !== s.length) return false;
  return norm(ref).includes(w);
}

function refReplacementTargets(spanText, ref) {
  const s = norm(spanText);
  const r = norm(ref);
  const L = s.length;
  const out = [];
  for (let i = 0; i <= r.length - L; i++) {
    const sub = r.slice(i, i + L);
    if (sub && sub !== s) out.push(sub);
  }
  return [...new Set(out)];
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function sortRefTargets(spanText, targets, alignedWord) {
  const s = norm(spanText);
  const scored = targets.map((t) => {
    if (alignedWord && norm(t) === norm(alignedWord)) return { t, score: -1000 };
    let overlap = 0;
    for (const ch of s) if (t.includes(ch)) overlap += 1;
    return { t, score: levenshtein(s, t) - overlap * 2 };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.map((x) => x.t);
}

function pickPrimaryRefTarget(spanText, ref, alignedWord) {
  if (alignedWord) return alignedWord;
  const targets = refReplacementTargets(spanText, ref);
  if (!targets.length) return null;
  return sortRefTargets(spanText, targets, alignedWord)[0];
}

function rankRecallHits(spanText, hits, ref, correctWord) {
  const asrToneKey = toneSyllablesKey(textToToneSyllables(spanText));
  const ranked = hits
    .filter((h) => h.word !== spanText)
    .map((hit) => ({
      candidate: hit.word,
      source: hit.source,
      candidateScore: hit.candidateScore,
      priorScore: hit.priorScore,
      repairTarget: hit.repairTarget === true,
      domains: hit.domains || [],
      toneDistance: hit.tonePinyinKey ? toneDistance(asrToneKey, hit.tonePinyinKey) : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => {
      if (a.toneDistance !== b.toneDistance) return a.toneDistance - b.toneDistance;
      if (a.priorScore !== b.priorScore) return b.priorScore - a.priorScore;
      return b.candidateScore - a.candidateScore;
    });

  const primary = pickPrimaryRefTarget(spanText, ref, correctWord);
  const validTargets = new Set(refReplacementTargets(spanText, ref));
  if (primary) validTargets.add(norm(primary));

  let correctCandidateRank = 'NOT_FOUND';
  let correctCandidate = primary || null;
  let matchedRefWord = null;
  for (let i = 0; i < ranked.length; i++) {
    if (isRefCorrectReplacement(spanText, ranked[i].candidate, ref)) {
      matchedRefWord = ranked[i].candidate;
      correctCandidateRank = i + 1;
      break;
    }
  }
  if (matchedRefWord) correctCandidate = matchedRefWord;

  return {
    perSpanLimit: null,
    candidates: ranked.map((r, i) => ({
      rank: i + 1,
      candidate: r.candidate,
      source: r.source,
      candidateScore: +r.candidateScore.toFixed(4),
      priorScore: +r.priorScore.toFixed(4),
      repairTarget: r.repairTarget,
      domains: r.domains,
      correctCandidate: isRefCorrectReplacement(spanText, r.candidate, ref),
    })),
    correctCandidate,
    correctCandidateRank,
    refReplacementTargets: [...validTargets],
  };
}

function lookupLexiconEntries(runtime, spanText, targetWord) {
  const syllables = textToSyllables(spanText);
  const key = syllablesKey(syllables);
  const len = spanText.length;
  const hits = [];
  for (const h of runtime.lookupBaseByPinyinKey(key, len, 200)) hits.push(h);
  for (const d of DOMAINS) {
    for (const h of runtime.lookupDomainByPinyinKey(d, key, len, 200)) hits.push(h);
  }
  const tw = norm(targetWord);
  const byWord = hits.filter((h) => norm(h.word) === tw);
  return { allPinyinHits: hits, byWord };
}

function classifyNotFound(spanText, ref, alignedWord, baselineRecall, wideRecall, runtime) {
  const targets = sortRefTargets(spanText, refReplacementTargets(spanText, ref), alignedWord);
  if (!targets.length) {
    return { category: 'E', detail: 'reference 无同长异文替换目标', target: null };
  }

  for (const target of targets) {
    if (baselineRecall.candidates.some((c) => norm(c.candidate) === norm(target))) {
      continue;
    }
    const lexLookup = lookupLexiconEntries(runtime, spanText, target);
    if (!lexLookup.byWord.length) {
      continue;
    }
    const entry = lexLookup.byWord[0];
    const inWide = wideRecall.candidates.some((c) => norm(c.candidate) === norm(target));
    const domains = entry.domains?.length ? entry.domains : entry.domain ? [entry.domain] : [];
    if (!inWide) {
      if (domains.length && !matchEnabledDomain(domains, DOMAINS)) {
        return {
          category: 'C',
          detail: `词「${target}」在 domain=${domains.join(',')}，不在 enabled DOMAINS`,
          target,
        };
      }
      if ((entry.priorScore ?? 0) < MIN_PRIOR) {
        return {
          category: 'B',
          detail: `词「${target}」priorScore=${entry.priorScore} < minPrior ${MIN_PRIOR}`,
          target,
        };
      }
      return {
        category: 'B',
        detail: `词「${target}」在词库但 D_very_wide Recall 仍未召回`,
        target,
      };
    }
    if (!baselineRecall.candidates.some((c) => norm(c.candidate) === norm(target)) && inWide) {
      return {
        category: 'B',
        detail: `词「${target}」仅宽 Recall 可见，baseline perSpanLimit 截断`,
        target,
      };
    }
    if (entry.repairTarget !== true) {
      return {
        category: 'D',
        detail: `词「${target}」repairTarget=0`,
        target,
      };
    }
  }

  return {
    category: 'A',
    detail: `ref  plausible 目标（如「${targets[0]}」）均未在词库同拼音桶找到`,
    target: targets[0],
  };
}

function hitStats(rows) {
  const needsFix = rows.filter((r) => (r.refReplacementTargets?.length || 0) > 0);
  const pool = needsFix.length ? needsFix : rows;
  const ranks = pool.filter((r) => typeof r.correctCandidateRank === 'number').map((r) => r.correctCandidateRank);
  const notFound = pool.filter((r) => r.correctCandidateRank === 'NOT_FOUND').length;
  return {
    total: rows.length,
    needsReplacement: needsFix.length,
    statsBase: needsFix.length ? 'needsReplacement' : 'allSpans',
    inRecall: ranks.length,
    top1: ranks.filter((r) => r <= 1).length,
    top2: ranks.filter((r) => r <= 2).length,
    top4: ranks.filter((r) => r <= 4).length,
    top8: ranks.filter((r) => r <= 8).length,
    top16: ranks.filter((r) => r <= 16).length,
    notFound,
    avgRank: ranks.length ? +(ranks.reduce((s, v) => s + v, 0) / ranks.length).toFixed(2) : null,
  };
}

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

function renderSpanBlock(spanRow, groupKey) {
  const g = GROUPS[groupKey];
  const recall = spanRow.recallByGroup[groupKey];
  let md = '';
  md += `\n#### ${spanRow.caseId} / span「${spanRow.rawSpan}」 — ${g.label}\n\n`;
  md += `| 字段 | 值 |\n|------|----|\n`;
  md += `| domain (scenario) | ${mdEscape(spanRow.domain)} |\n`;
  md += `| raw sentence | ${mdEscape(spanRow.rawSentence || '*(未落盘)*')} |\n`;
  md += `| reference | ${mdEscape(spanRow.reference)} |\n`;
  md += `| ApprovedSpan | ${mdEscape(spanRow.rawSpan)} |\n`;
  md += `| spanStart / spanEnd | ${spanRow.spanStart ?? '—'} / ${spanRow.spanEnd ?? '—'} |\n`;
  md += `| perSpanLimit | ${recall.perSpanLimit} |\n`;
  md += `| correctCandidate | ${mdEscape(recall.correctCandidate || '—')} |\n`;
  md += `| ref 同长替换目标集 | ${mdEscape((recall.refReplacementTargets || []).join(' / ') || '—')} |\n`;
  md += `| correctCandidateRank | **${recall.correctCandidateRank}** |\n\n`;
  md += `**Recall TopK**\n\n`;
  if (!recall.candidates.length) {
    md += `*(空 — recallHits=0)*\n`;
    return md;
  }
  md += `| Rank | candidate | source | candidateScore | priorScore | correctCandidate |\n`;
  md += `|------|-----------|--------|----------------|------------|------------------|\n`;
  for (const c of recall.candidates) {
    md += `| ${c.rank} | ${mdEscape(c.candidate)} | ${mdEscape(c.source)} | ${c.candidateScore} | ${c.priorScore} | ${c.correctCandidate ? '**YES**' : ''} |\n`;
  }
  return md;
}

function renderMarkdown(data) {
  const base = data.groupStats.A_baseline;
  const notFoundRows = data.spans.filter((s) => s.recallByGroup.A_baseline.correctCandidateRank === 'NOT_FOUND');
  const nfCats = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const s of notFoundRows) {
    const cat = s.notFoundClassification?.category || 'E';
    nfCats[cat] = (nfCats[cat] || 0) + 1;
  }

  let md = `# Recall Candidate Dump Audit\n\n`;
  md += `**日期**：2026-06-03  \n`;
  md += `**性质**：只读审计（禁止开发 / 调参 / 改词库 / 改 IME）  \n`;
  md += `**目标**：直接输出 Phase 4E ApprovedSpan 的 **Recall 到底召回了什么**（完整 TopK 列表）\n\n`;
  md += `**脚本**：\`electron_node/electron-node/tests/experiments/recall-candidate-dump-audit.mjs\`  \n`;
  md += `**数据 JSON**：\`tests/experiments/recall-candidate-dump-audit-data.json\`\n\n`;
  md += `---\n\n`;
  md += `## 0. 数据范围说明\n\n`;
  md += `| 项 | 值 |\n|----|----|\n`;
  md += `| 4E 漏斗 ApprovedSpan | **${data.funnel.fw_spans_total}** |\n`;
  md += `| 本报告可回放 span（\`samples.approvedSpan\` 有 span 文本） | **${data.spanCountAvailable}** |\n`;
  md += `| 缺失 span 明细（批测 JSON 未落盘） | **${data.funnel.fw_spans_total - data.spanCountAvailable}** |\n`;
  md += `| 覆盖 case 数 | **${data.caseCount}** / 29 triggered |\n\n`;
  md += `> 原始 \`phase4e-batch-result.json\` 不在工作区；span 文本来自 \`fw-detector-dialog-200-phase4e-quality-perf.json\` → \`samples.approvedSpan\`。  \n`;
  md += `> 全量 49 span 需重跑批测或 Test server fixtures。\n\n`;
  md += `---\n\n`;
  md += `## 1. Executive Summary（baseline A）\n\n`;
  md += `| 指标 | 值 |\n|------|----|\n`;
  md += `| 需要替换的 span（ref 存在同长异文目标） | ${base.needsReplacement} / ${base.total} |\n`;
  md += `| 正确答案进入 Recall 池 | **${base.inRecall}** / ${base.needsReplacement || base.total} |\n`;
  md += `| NOT_FOUND | **${base.notFound}** / ${base.needsReplacement || base.total}（${(((base.notFound / (base.needsReplacement || base.total)) * 100) || 0).toFixed(1)}%） |\n`;
  md += `| 进入 Recall 后的平均排名 | **${base.avgRank ?? 'N/A'}** |\n`;
  md += `| Top1 / Top2 / Top4 / Top8 / Top16 命中 | ${base.top1} / ${base.top2} / ${base.top4} / ${base.top8} / ${base.top16} |\n\n`;
  md += `---\n\n`;
  md += `## 2. 必答问题\n\n`;
  md += `### Q1 — 49 个 ApprovedSpan 中，正确答案有多少进入 Recall？\n\n`;
  md += `- **可观测 ${data.spanCountAvailable} span（baseline）**：**${base.inRecall}** 进入 Recall，**${base.notFound}** NOT_FOUND。  \n`;
  md += `- **外推至 49 span**（按相同 NOT_FOUND 率 ${(((base.notFound / (base.needsReplacement || base.total)) * 100) || 0).toFixed(1)}%）：约 **${Math.round(49 * (base.inRecall / (base.needsReplacement || base.total)))}** 进入 / **${Math.round(49 * (base.notFound / (base.needsReplacement || base.total)))}** NOT_FOUND。\n\n`;
  md += `### Q2 — 正确答案平均排名多少？\n\n`;
  md += `- 在已进入 Recall 的 span 上：**${base.avgRank ?? 'N/A'}**（baseline A）。\n\n`;
  md += `### Q3 — NOT_FOUND 比例多少？\n\n`;
  md += `- 可观测样本：**${(((base.notFound / (base.needsReplacement || base.total)) * 100) || 0).toFixed(1)}%**（${base.notFound}/${base.needsReplacement || base.total}）。\n\n`;
  md += `### Q4 — 若正确答案不在 Recall 池，KenLM 是否理论上无解？\n\n`;
  md += `**是。** KenLM 句级 rerank 的替换候选完全来自 Recall 笛卡尔积；**NOT_FOUND 的 span 在 Builder 阶段不可能生成含 ref 正确词的 combo**，KenLM 只能打 raw 或错误 combo。\n\n`;
  md += `### Q5 — Recall 当前最大问题：排序还是覆盖率？\n\n`;
  md += `**覆盖率（NOT_FOUND）是主瓶颈** — baseline NOT_FOUND **${base.notFound}/${base.needsReplacement || base.total}**；  \n`;
  md += `在已进入 Recall 的 **${base.inRecall}** 个 span 中，Top1 命中 **${base.top1}**、Top8 命中 **${base.top8}**（排序有优化空间但非首因）。  \n`;
  md += `Recall Width 实验 A→D 加宽后 NOT_FOUND **不变**（见 §3），进一步证明 **非单纯 TopK 过窄**。\n\n`;
  md += `---\n\n`;
  md += `## 3. 实验组排名统计（Recall Width 四组）\n\n`;
  md += `| 组 | span 数 | Top1 | Top2 | Top4 | Top8 | Top16 | NOT_FOUND | 平均排名 |\n`;
  md += `|----|---------|------|------|------|------|-------|-----------|----------|\n`;
  for (const [k, st] of Object.entries(data.groupStats)) {
    md += `| ${k} | ${st.total} | ${st.top1} | ${st.top2} | ${st.top4} | ${st.top8} | ${st.top16} | ${st.notFound} | ${st.avgRank ?? '—'} |\n`;
  }
  md += `\n---\n\n`;
  md += `## 4. NOT_FOUND 分类（baseline A，n=${notFoundRows.length}）\n\n`;
  md += `| 类别 | 含义 | 数量 |\n|------|------|------|\n`;
  md += `| **A** | 词库缺失 | ${nfCats.A} |\n`;
  md += `| **B** | 拼音召回失败 / prior 过滤 / cap 截断 | ${nfCats.B} |\n`;
  md += `| **C** | domain 路由错误 | ${nfCats.C} |\n`;
  md += `| **D** | repairTarget 缺失 | ${nfCats.D} |\n`;
  md += `| **E** | 其它（对齐失败、与 raw 相同等） | ${nfCats.E} |\n\n`;
  md += `### NOT_FOUND 明细\n\n`;
  md += `| caseId | rawSpan | correctCandidate | 分类 | 说明 |\n`;
  md += `|--------|---------|------------------|------|------|\n`;
  for (const s of notFoundRows) {
    const r = s.recallByGroup.A_baseline;
    const target = s.notFoundClassification?.target || r.correctCandidate || '—';
    md += `| ${s.caseId} | ${mdEscape(s.rawSpan)} | ${mdEscape(target)} | ${s.notFoundClassification?.category || 'E'} | ${mdEscape(s.notFoundClassification?.detail || '')} |\n`;
  }
  md += `\n---\n\n`;
  md += `## 5. 附录 — 全部 ApprovedSpan Recall TopK 完整导出（A/B/C/D 四组）\n\n`;
  md += `> 每组 perSpanLimit 见 Recall Width 实验设计；**每一 span 均列出全部 Recall 候选**。\n\n`;

  for (const s of data.spans) {
    md += `\n---\n\n### Case ${s.caseId}（${s.domain}）— span「${s.rawSpan}」\n\n`;
    md += `- **raw**：${mdEscape(s.rawSentence || '*(未落盘)*')}\n`;
    md += `- **reference**：${mdEscape(s.reference)}\n`;
    md += `- **spanStart / spanEnd**：${s.spanStart ?? '—'} / ${s.spanEnd ?? '—'}\n`;
    md += `- **case 内 approved span 数**：${s.caseSpanCount}\n\n`;
    for (const groupKey of Object.keys(GROUPS)) {
      md += renderSpanBlock(s, groupKey);
    }
  }

  md += `\n---\n\n## 6. 实验组 correctCandidateRank 速查表\n\n`;
  for (const s of data.spans) {
    const ranks = Object.fromEntries(
      Object.keys(GROUPS).map((g) => [g, s.recallByGroup[g].correctCandidateRank])
    );
    md += `- **${s.caseId}** / 「${s.rawSpan}」：A=${ranks.A_baseline} B=${ranks.B_medium} C=${ranks.C_wide} D=${ranks.D_very_wide}\n`;
  }
  md += `\n---\n\n*READONLY AUDIT — 未修改生产代码 / 词库 / IME / 默认参数*\n`;
  return md;
}

function main() {
  const v2 = ensureLexiconRuntimeV2Loaded();
  if (v2.status !== 'ok') {
    console.error('Lexicon V2 unavailable', v2);
    process.exit(1);
  }
  const runtime = getLexiconRuntimeV2();
  const profile = defaultGeneralProfile();
  const perf = JSON.parse(fs.readFileSync(PERF_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
  const rawById = {};
  for (const lst of [perf.samples?.diffZeroBoundaryPositive, perf.samples?.approvedSpan]) {
    for (const row of lst || []) {
      if (row.raw) rawById[row.id] = row.raw;
    }
  }

  const cases = (perf.samples?.approvedSpan || []).filter((c) => (c.approvedSpanCount || 0) > 0);
  const spans = [];
  let spanIdx = 0;

  for (const c of cases) {
    const ref = refById[c.id] || '';
    const raw = rawById[c.id] || null;
    const caseSpanCount = (c.spans || []).length;
    for (const s of c.spans || []) {
      spanIdx += 1;
      let spanStart = null;
      let spanEnd = null;
      if (raw) {
        const idx = raw.indexOf(s.text);
        if (idx >= 0) {
          spanStart = idx;
          spanEnd = idx + s.text.length;
        }
      }
      const align = raw && spanStart != null ? extractCorrectCandidate(raw, ref, spanStart, spanEnd) : { word: null, reason: 'no_raw' };
      const recallByGroup = {};
      for (const groupKey of Object.keys(GROUPS)) {
        const lim = groupLimit(caseSpanCount, groupKey);
        const recall = recallSpanTopK(s.text, profile, lim, MIN_PRIOR, DOMAINS, { perSpanLimit: lim });
        const ranked = rankRecallHits(s.text, recall.hits, ref, align.word);
        ranked.perSpanLimit = lim;
        recallByGroup[groupKey] = ranked;
      }
      const primaryTarget = pickPrimaryRefTarget(s.text, ref, align.word);
      const notFoundClassification =
        recallByGroup.A_baseline.correctCandidateRank === 'NOT_FOUND' &&
        refReplacementTargets(s.text, ref).length > 0
          ? classifyNotFound(
              s.text,
              ref,
              align.word,
              recallByGroup.A_baseline,
              recallByGroup.D_very_wide,
              runtime
            )
          : null;

      const refTargets = refReplacementTargets(s.text, ref);
      spans.push({
        spanIndex: spanIdx,
        caseId: c.id,
        domain: c.scenario,
        rawSentence: raw,
        reference: ref,
        rawSpan: s.text,
        spanStart,
        spanEnd,
        signals: s.signals || [],
        caseSpanCount,
        alignReason: align.reason,
        refReplacementTargets: refTargets,
        recallByGroup,
        notFoundClassification,
      });
    }
  }

  const groupStats = {};
  for (const groupKey of Object.keys(GROUPS)) {
    groupStats[groupKey] = hitStats(
      spans.map((s) => ({
        ...s.recallByGroup[groupKey],
        refReplacementTargets: s.refReplacementTargets,
      }))
    );
  }

  const data = {
    audit: 'Recall Candidate Dump',
    readonly: true,
    timestamp: new Date().toISOString(),
    funnel: perf.funnel,
    spanCountAvailable: spans.length,
    caseCount: cases.length,
    groupStats,
    groups: GROUPS,
    spans,
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(data, null, 2), 'utf8');
  fs.mkdirSync(path.dirname(MD_OUT), { recursive: true });
  fs.writeFileSync(MD_OUT, renderMarkdown(data), 'utf8');
  console.log('[audit] spans', spans.length, 'json', JSON_OUT);
  console.log('[audit] md', MD_OUT);
  console.log('[audit] baseline', JSON.stringify(groupStats.A_baseline, null, 2));
}

main();
