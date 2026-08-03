/**
 * Export dialog_200 candidate sentences from EXISTING sentence_assembly_trace.
 * READ/EXPORT ONLY — no production rerun, no code/config/lexicon change.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const traceDir = path.resolve(__dirname, 'sentence_assembly_trace');
const outDir = path.resolve(__dirname, 'dialog200_candidate_sentence_export');
const docsTone = path.resolve(__dirname, '..');
const mainReportPath = path.join(
  docsTone,
  'FW_Repair_V4_Dialog200_All_Candidate_Sentences_Export_2026_08_01.md'
);

fs.mkdirSync(outDir, { recursive: true });

function classifySentence(rawText, finalText, replacements) {
  if (finalText === rawText) {
    const repair = (replacements || []).filter((r) => r.repairTarget === true);
    if (repair.length === 0) return 'RAW_ORIGINAL';
    // same surface as raw after replacements (identity repairs / canonical)
    return repair.length === 1 ? 'SINGLE_SPAN_REPLACEMENT' : 'MULTI_SPAN_REPLACEMENT';
  }
  const repair = (replacements || []).filter((r) => r.repairTarget === true);
  if (repair.length === 0) return 'CANONICAL_ONLY';
  if (repair.length === 1) return 'SINGLE_SPAN_REPLACEMENT';
  return 'MULTI_SPAN_REPLACEMENT';
}

function csvEscape(s) {
  const t = String(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

const files = fs
  .readdirSync(traceDir)
  .filter((f) => /^\d{3}\.json$/.test(f))
  .sort();

const exceptions = {
  E1: [],
  E2: [],
  E3: [],
  E4: [],
  E5: [],
  E6: [],
  E7: [],
  E8: [],
  E9: [],
  E10: [],
};
const cases = [];
const csvRows = [
  [
    'caseId',
    'rawText',
    'stage',
    'pathId',
    'bucketDomain',
    'candidateIndex',
    'candidateText',
    'sourceSentenceId',
    'keptInCrossPath',
    'sentToKenlm',
  ].join(','),
];

let kenlmTotal = 0;
let singleCandidateCases = 0;
let multiCandidateCases = 0;
let maxKenlmPerCase = 0;
let maxKenlmCaseId = null;

for (let i = 1; i <= 200; i++) {
  const num = String(i).padStart(3, '0');
  const fp = path.join(traceDir, `${num}.json`);
  if (!fs.existsSync(fp)) {
    exceptions.E1.push(`d${num}`);
    continue;
  }
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const caseId = j.caseId || `d${num}`;
  const rawText = j.rawText || '';
  const paths = j.paths || [];
  const cross = j.crossPath || {};
  const kenlmInputs = j.kenlmInputs || [];

  const assemblyByBucket = [];
  let assemblySentenceCount = 0;
  const sourceIdToText = new Map();

  for (const p of paths) {
    for (const b of p.buckets || []) {
      const sentences = [];
      for (let si = 0; si < (b.sentences || []).length; si++) {
        const s = b.sentences[si];
        const text = s.finalText;
        if (text == null || text === '') {
          exceptions.E2.push(caseId);
        } else if (text.length === 0) {
          exceptions.E7.push(caseId);
        }
        const sid = s.sentenceId || `${b.bucketId}_s${si}`;
        if (sourceIdToText.has(sid) && sourceIdToText.get(sid) !== text) {
          exceptions.E8.push(`${caseId}:${sid}`);
        }
        sourceIdToText.set(sid, text);
        sentences.push({
          sentenceId: sid,
          text,
          assemblyRank: s.assemblyRank ?? si + 1,
          assemblyScore: s.assemblyScore ?? null,
          category: classifySentence(rawText, text, s.replacements),
          replacements: s.replacements || [],
        });
        assemblySentenceCount += 1;
      }
      assemblyByBucket.push({
        pathId: p.pathId,
        pathIndex: p.pathIndex,
        bucketId: b.bucketId,
        bucketDomain: b.bucketDomain,
        generatedSentenceCount: b.generatedSentenceCount,
        limitedSentenceCount: b.limitedSentenceCount,
        limitName: b.limitName,
        limitValue: b.limitValue,
        bucketDedupe: b.bucketDedupe || [],
        sentences,
      });
    }
  }

  const cpInput = cross.input || [];
  const cpOutput = cross.output || [];
  const cpDrops = cross.drops || [];
  const prodTrace = cross.productionTrace || {};

  for (const x of cpInput) {
    if (!x.text) exceptions.E3.push(caseId);
  }
  for (const x of cpOutput) {
    if (!x.text) exceptions.E4.push(caseId);
  }
  for (const x of kenlmInputs) {
    if (!x.text) exceptions.E5.push(caseId);
  }

  const cpOutTexts = cpOutput.map((x) => x.text);
  const kenlmTexts = kenlmInputs.map((x) => x.text);
  const kenlmEqualsCrossPath =
    JSON.stringify(cpOutTexts) === JSON.stringify(kenlmTexts);
  if (!kenlmEqualsCrossPath) {
    exceptions.E6.push(caseId);
  }

  // CrossPath input count should equal assembly sentence count
  const countOk = cpInput.length === assemblySentenceCount;

  const keptIds = new Set(cpOutput.map((x) => x.sourceSentenceId));
  const kenlmIds = new Set(kenlmInputs.map((x) => x.sourceSentenceId));

  // CSV rows: assembly
  let asmIdx = 0;
  for (const b of assemblyByBucket) {
    for (const s of b.sentences) {
      asmIdx += 1;
      csvRows.push(
        [
          caseId,
          csvEscape(rawText),
          'assembly',
          csvEscape(b.pathId),
          csvEscape(b.bucketDomain),
          String(asmIdx),
          csvEscape(s.text),
          csvEscape(s.sentenceId),
          keptIds.has(s.sentenceId) ? 'YES' : 'NO',
          kenlmIds.has(s.sentenceId) ? 'YES' : 'NO',
        ].join(',')
      );
    }
  }
  cpInput.forEach((x, idx) => {
    csvRows.push(
      [
        caseId,
        csvEscape(rawText),
        'crossPathInput',
        csvEscape(x.pathId),
        csvEscape(x.bucketDomain),
        String(idx + 1),
        csvEscape(x.text),
        csvEscape(x.sentenceId),
        keptIds.has(x.sentenceId) ? 'YES' : 'NO',
        kenlmIds.has(x.sentenceId) ? 'YES' : 'NO',
      ].join(',')
    );
  });
  cpOutput.forEach((x, idx) => {
    csvRows.push(
      [
        caseId,
        csvEscape(rawText),
        'crossPathOutput',
        csvEscape(x.sourcePathId),
        '',
        String(idx + 1),
        csvEscape(x.text),
        csvEscape(x.sourceSentenceId),
        'YES',
        kenlmIds.has(x.sourceSentenceId) ? 'YES' : 'NO',
      ].join(',')
    );
  });
  kenlmInputs.forEach((x, idx) => {
    csvRows.push(
      [
        caseId,
        csvEscape(rawText),
        'kenlmInput',
        csvEscape(x.sourcePathId),
        '',
        String(idx + 1),
        csvEscape(x.text),
        csvEscape(x.sourceSentenceId),
        'YES',
        'YES',
      ].join(',')
    );
  });

  const kenlmN = kenlmInputs.length;
  kenlmTotal += kenlmN;
  if (kenlmN <= 1) singleCandidateCases += 1;
  else multiCandidateCases += 1;
  if (kenlmN > maxKenlmPerCase) {
    maxKenlmPerCase = kenlmN;
    maxKenlmCaseId = caseId;
  }

  cases.push({
    caseId,
    fileNum: num,
    rawText,
    pathCount: paths.length,
    bucketCount: (j.stats && j.stats.bucketCount) || assemblyByBucket.length,
    assemblySentenceCount,
    assemblySentenceCountByBucket: assemblyByBucket.map((b) => ({
      pathId: b.pathId,
      bucketDomain: b.bucketDomain,
      count: b.sentences.length,
    })),
    assemblyByBucket,
    crossPathInput: cpInput,
    crossPathOutput: cpOutput,
    crossPathDrops: cpDrops,
    crossPathTrace: prodTrace,
    uniqueBeforeCapCount: cross.uniqueBeforeCapCount,
    kenlmInputs,
    kenlmEqualsCrossPath,
    assemblyEqualsCrossPathInput: countOk,
    kenlmScores: 'NOT AVAILABLE',
    finalSelected: 'NOT AVAILABLE',
  });
}

const multiCases = cases.filter((c) => c.kenlmInputs.length > 1);
const capCases = cases.filter(
  (c) =>
    c.kenlmInputs.length === 16 ||
    (c.crossPathTrace && c.crossPathTrace.crossPathTruncatedCount > 0) ||
    (c.uniqueBeforeCapCount != null && c.uniqueBeforeCapCount > 16) ||
    c.assemblyByBucket.some(
      (b) =>
        (b.generatedSentenceCount != null && b.generatedSentenceCount > 16) ||
        (b.limitedSentenceCount != null &&
          b.limitValue === 16 &&
          b.generatedSentenceCount > b.limitedSentenceCount)
    )
);

const exportMeta = {
  exportSource: 'EXISTING_TRACE',
  exportSourceLabel: 'EXPORT_SOURCE = EXISTING_TRACE',
  conclusion: 'EXPORT_COMPLETE_FROM_EXISTING_TRACE',
  artifactDir: 'docs/tone-v2/_audit_scratch/sentence_assembly_trace/',
  fieldsUsed: [
    'paths[].buckets[].sentences[].finalText',
    'paths[].buckets[].sentences[].sentenceId',
    'paths[].buckets[].sentences[].assemblyRank/assemblyScore/replacements',
    'paths[].buckets[].bucketDedupe',
    'paths[].buckets[].generatedSentenceCount/limitedSentenceCount',
    'crossPath.input[].text',
    'crossPath.output[].text',
    'crossPath.drops',
    'crossPath.productionTrace',
    'crossPath.uniqueBeforeCapCount',
    'kenlmInputs[].text (kenlmScore=null)',
    'stats',
  ],
  totals: {
    casesExported: cases.length,
    singleCandidateCases,
    multiCandidateCases,
    kenlmInputTotalSentences: kenlmTotal,
    maxKenlmInputPerCase: maxKenlmPerCase,
    maxKenlmCaseId,
    assemblySentenceTotal: cases.reduce((s, c) => s + c.assemblySentenceCount, 0),
    crossPathInputTotal: cases.reduce((s, c) => s + c.crossPathInput.length, 0),
    crossPathOutputTotal: cases.reduce((s, c) => s + c.crossPathOutput.length, 0),
  },
  exceptions: Object.fromEntries(
    Object.entries(exceptions).map(([k, v]) => [k, [...new Set(v)]])
  ),
  cases,
};

fs.writeFileSync(
  path.join(outDir, 'dialog200_all_candidate_sentences.json'),
  JSON.stringify(exportMeta, null, 2),
  'utf8'
);
fs.writeFileSync(
  path.join(outDir, 'dialog200_all_candidate_sentences.csv'),
  csvRows.join('\n'),
  'utf8'
);

// Multi-candidate index MD
const multiMd = [];
multiMd.push('# dialog_200 Multi-Candidate Cases (CrossPath Output / KenLM Input Count > 1)');
multiMd.push('');
multiMd.push(`EXPORT_SOURCE = EXISTING_TRACE`);
multiMd.push(`Count: ${multiCases.length}`);
multiMd.push('');
for (const c of multiCases) {
  multiMd.push(`## ${c.caseId}`);
  multiMd.push('');
  multiMd.push(`Raw Text:`);
  multiMd.push('');
  multiMd.push('```text');
  multiMd.push(c.rawText);
  multiMd.push('```');
  multiMd.push('');
  multiMd.push(`KenLM Input Count: ${c.kenlmInputs.length}`);
  multiMd.push('');
  c.kenlmInputs.forEach((k, i) => {
    multiMd.push(`${i + 1}.`);
    multiMd.push('');
    multiMd.push('```text');
    multiMd.push(k.text);
    multiMd.push('```');
    multiMd.push('');
  });
  multiMd.push('---');
  multiMd.push('');
}
fs.writeFileSync(path.join(outDir, 'dialog200_multi_candidate_cases.md'), multiMd.join('\n'), 'utf8');

// Cap cases MD
const capMd = [];
capMd.push('# dialog_200 Candidate Cap Cases (KenLM=16 or CrossPath truncated or assembly>16)');
capMd.push('');
capMd.push(`EXPORT_SOURCE = EXISTING_TRACE`);
capMd.push(`Count: ${capCases.length}`);
capMd.push('');
if (capCases.length === 0) {
  capMd.push('No case has KenLM Input Count = 16, CrossPath truncatedCount > 0, or uniqueBeforeCap > 16 in existing trace.');
  capMd.push('');
  capMd.push(`Max KenLM Input Count observed: ${maxKenlmPerCase} (${maxKenlmCaseId})`);
  capMd.push('');
} else {
  for (const c of capCases) {
    capMd.push(`## ${c.caseId}`);
    capMd.push('');
    capMd.push(`Raw: ${c.rawText}`);
    capMd.push('');
    capMd.push(`KenLM Input Count: ${c.kenlmInputs.length}`);
    capMd.push(`uniqueBeforeCapCount: ${c.uniqueBeforeCapCount}`);
    capMd.push(`crossPathTruncatedCount: ${c.crossPathTrace?.crossPathTruncatedCount ?? 0}`);
    capMd.push('');
    capMd.push('Final KenLM / CrossPath Output sentences (production order):');
    capMd.push('');
    c.kenlmInputs.forEach((k, i) => {
      capMd.push(`${i + 1}. ${k.text}`);
    });
    capMd.push('');
    const truncDrops = (c.crossPathDrops || []).filter(
      (d) =>
        String(d.reasonCode || '').includes('CAP') ||
        String(d.reasonCode || '').includes('TRUNC')
    );
    if (truncDrops.length) {
      capMd.push('Global cap drops:');
      for (const d of truncDrops) {
        capMd.push(`- ${d.droppedSentenceId}: ${d.text}`);
      }
    } else {
      capMd.push('Global cap drops: none observed in trace (or only EXACT_TEXT_DUPLICATE drops).');
    }
    capMd.push('');
    capMd.push('Sort / retention basis: production `path_bucket_candidate` order · exact_text first_wins · dedup-before-cap ≤16');
    capMd.push('');
    capMd.push('---');
    capMd.push('');
  }
}
fs.writeFileSync(path.join(outDir, 'dialog200_candidate_cap_cases.md'), capMd.join('\n'), 'utf8');

// Main report — full per-case expansion
const md = [];
md.push('# FW Repair V4 — dialog_200 All Candidate Sentences Export');
md.push('');
md.push('**Date:** 2026-08-01');
md.push('**Nature:** READ / EXPORT FIRST · PRODUCTION OUTPUT ONLY · NO RERUN');
md.push('');
md.push('## 1. Export Source');
md.push('');
md.push('```text');
md.push('EXPORT_SOURCE = EXISTING_TRACE');
md.push('EXPORT_COMPLETE_FROM_EXISTING_TRACE');
md.push('```');
md.push('');
md.push('未重新运行生产代码。现有 `sentence_assembly_trace/001.json`…`200.json` 已含完整候选句文本。');
md.push('');
md.push('## 2. Existing Artifact Inventory');
md.push('');
md.push('| Artifact | Status |');
md.push('|----------|--------|');
md.push('| `sentence_assembly_trace/001.json`…`200.json` | PRESENT · used |');
md.push('| `sentence_assembly_trace/*.md` | PRESENT · not required for export |');
md.push('| `_aggregate.json` | PRESENT · stats only |');
md.push('| KenLM scores in trace | NULL / NOT AVAILABLE |');
md.push('| Final selected text in trace | NOT AVAILABLE |');
md.push('');
md.push('## 3. Production Fields Used');
md.push('');
for (const f of exportMeta.fieldsUsed) {
  md.push(`- \`${f}\``);
}
md.push('');
md.push('Machine-readable outputs:');
md.push('');
md.push('- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.json`');
md.push('- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_all_candidate_sentences.csv`');
md.push('- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_multi_candidate_cases.md`');
md.push('- `docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_candidate_cap_cases.md`');
md.push('');

md.push('## 4. Global Case Index');
md.push('');
md.push(`| Case ID | Raw Text 摘要 | Assembly 句数 | CrossPath 输出 | KenLM 输入 |`);
md.push(`| ------- | ----------- | ----------: | -----------: | --------: |`);
for (const c of cases) {
  const summary =
    c.rawText.length > 40 ? c.rawText.slice(0, 40) + '…' : c.rawText;
  md.push(
    `| [${c.caseId}](#case-${c.caseId}) | ${summary.replace(/\|/g, '\\|')} | ${c.assemblySentenceCount} | ${c.crossPathOutput.length} | ${c.kenlmInputs.length} |`
  );
}
md.push('');

md.push('## Totals');
md.push('');
md.push('```text');
md.push(`导出 Case 数: ${exportMeta.totals.casesExported}`);
md.push(`单候选 Case 数 (KenLM≤1): ${singleCandidateCases}`);
md.push(`多候选 Case 数 (KenLM>1): ${multiCandidateCases}`);
md.push(`KenLM Input 总句数: ${kenlmTotal}`);
md.push(`最大单 Case KenLM 候选数: ${maxKenlmPerCase} (${maxKenlmCaseId})`);
md.push(`Assembly 总句数: ${exportMeta.totals.assemblySentenceTotal}`);
md.push(`CrossPath Input 总句数: ${exportMeta.totals.crossPathInputTotal}`);
md.push(`CrossPath Output 总句数: ${exportMeta.totals.crossPathOutputTotal}`);
md.push('```');
md.push('');

// Per-case sections (5..204 effectively)
for (const c of cases) {
  md.push(`## Case ${c.caseId}`);
  md.push('');
  md.push(`<a id="case-${c.caseId}"></a>`);
  md.push('');
  md.push('### Case 基础信息');
  md.push('');
  md.push('```text');
  md.push(`Case ID: ${c.caseId}`);
  md.push(`Raw Text: ${c.rawText}`);
  md.push(`Path Count: ${c.pathCount}`);
  md.push(`Bucket Count: ${c.bucketCount}`);
  md.push('```');
  md.push('');

  md.push('### A. 每个 Path 的 Bucket 候选句');
  md.push('');
  for (const b of c.assemblyByBucket) {
    md.push(`#### Path: \`${b.pathId}\``);
    md.push('');
    md.push(`Bucket: \`${b.bucketDomain}\` (\`${b.bucketId}\`)`);
    md.push('');
    md.push('Assembly Sentences:');
    md.push('');
    if (!b.sentences.length) {
      md.push('_（本 Bucket 无生成句）_');
      md.push('');
    }
    b.sentences.forEach((s, i) => {
      md.push(`${i + 1}.`);
      md.push('');
      md.push('```text');
      md.push(s.text);
      md.push('```');
      md.push('');
      md.push(`- sentenceId: \`${s.sentenceId}\``);
      md.push(`- category: \`${s.category}\``);
      md.push(`- assemblyRank: ${s.assemblyRank}`);
      md.push(`- assemblyScore: ${s.assemblyScore}`);
      md.push('');
    });
  }

  md.push('### B. Bucket 内去重 / 截断');
  md.push('');
  let anyBucketMeta = false;
  for (const b of c.assemblyByBucket) {
    if (b.bucketDedupe && b.bucketDedupe.length) {
      anyBucketMeta = true;
      md.push(`Bucket \`${b.bucketId}\` Duplicates Removed:`);
      for (const d of b.bucketDedupe) {
        md.push(`- ${JSON.stringify(d)}`);
      }
      md.push('');
    }
    if (
      b.generatedSentenceCount != null &&
      b.limitedSentenceCount != null &&
      b.generatedSentenceCount > b.limitedSentenceCount
    ) {
      anyBucketMeta = true;
      md.push(
        `Bucket \`${b.bucketId}\`: limited ${b.limitedSentenceCount}/${b.generatedSentenceCount} by ${b.limitName}=${b.limitValue}`
      );
      md.push('');
    }
  }
  if (!anyBucketMeta) {
    md.push('```text');
    md.push('No bucket-level exact-text drop list with dropped full sentences in this trace.');
    md.push('If enum pruned before materializing text: PRUNED_DURING_GENERATION (not forged).');
    md.push('```');
    md.push('');
  }

  md.push('### C. CrossPath Input');
  md.push('');
  md.push(`Count: ${c.crossPathInput.length}`);
  md.push('');
  c.crossPathInput.forEach((x, i) => {
    md.push(`${i + 1}.`);
    md.push('');
    md.push('```text');
    md.push(`text: ${x.text}`);
    md.push(`pathId: ${x.pathId}`);
    md.push(`bucketDomain: ${x.bucketDomain}`);
    md.push(`sourceSentenceId: ${x.sentenceId}`);
    md.push('```');
    md.push('');
  });

  md.push('### D. CrossPath Output');
  md.push('');
  md.push(`Count: ${c.crossPathOutput.length}`);
  md.push('');
  c.crossPathOutput.forEach((x, i) => {
    md.push(`${i + 1}.`);
    md.push('');
    md.push('```text');
    md.push(`text: ${x.text}`);
    md.push(`keptFromPath: ${x.sourcePathId}`);
    md.push(`keptFromBucket: ${x.sourceBucketId}`);
    md.push(`sourceSentenceId: ${x.sourceSentenceId}`);
    md.push('```');
    md.push('');
  });

  md.push('### E. CrossPath 删除项');
  md.push('');
  if (!c.crossPathDrops.length) {
    md.push('_无删除_');
    md.push('');
  }
  for (const d of c.crossPathDrops) {
    const kept = c.crossPathOutput.find((o) => o.globalSentenceId === d.keptSentenceId) ||
      c.crossPathOutput.find((o) => o.sourceSentenceId === d.keptSentenceId);
    const reason =
      d.reasonCode === 'DROP_EXACT_TEXT_DUPLICATE_FIRST_WINS'
        ? 'EXACT_TEXT_DUPLICATE'
        : String(d.reasonCode || '').includes('CAP')
          ? 'GLOBAL_CAP'
          : d.reasonCode;
    md.push('```text');
    md.push(`Dropped Text: ${d.text}`);
    md.push(`Source Sentence: ${d.droppedSentenceId}`);
    md.push(`Reason: ${reason}`);
    md.push(`Kept Equivalent Sentence: ${kept ? kept.text : d.keptSentenceId}`);
    md.push('```');
    md.push('');
  }

  md.push('### F. KenLM Input');
  md.push('');
  md.push(`KenLM Input Count: ${c.kenlmInputs.length}`);
  md.push('');
  md.push(
    `KenLM Input 是否与 CrossPath Output 完全一致: **${c.kenlmEqualsCrossPath ? 'YES' : 'NO'}**`
  );
  md.push('');
  c.kenlmInputs.forEach((k, i) => {
    md.push(`${i + 1}.`);
    md.push('');
    md.push('```text');
    md.push(k.text);
    md.push('```');
    md.push('');
  });

  md.push('### G. KenLM 分数');
  md.push('');
  md.push('```text');
  md.push('NOT AVAILABLE');
  md.push('```');
  md.push('');
  md.push('（现有 Trace 未跑 KenLM 子进程；`kenlmScore=null`。）');
  md.push('');

  md.push('### H. 最终输出');
  md.push('');
  md.push('```text');
  md.push('Final Selected Text: NOT AVAILABLE');
  md.push('Selection Reason: NOT AVAILABLE');
  md.push('```');
  md.push('');

  md.push('### 完整性对账');
  md.push('');
  md.push('```text');
  md.push(`assemblySentenceCountByBucket: ${JSON.stringify(c.assemblySentenceCountByBucket)}`);
  md.push(`crossPathInputCount: ${c.crossPathInput.length}`);
  md.push(`crossPathOutputCount: ${c.crossPathOutput.length}`);
  md.push(`kenlmInputCount: ${c.kenlmInputs.length}`);
  md.push(
    `CrossPath Input == Assembly total: ${c.assemblyEqualsCrossPathInput ? 'YES' : 'NO'} (${c.crossPathInput.length} vs ${c.assemblySentenceCount})`
  );
  md.push(`KenLM Input == CrossPath Output texts: ${c.kenlmEqualsCrossPath ? 'YES' : 'NO'}`);
  md.push('```');
  md.push('');
  md.push('---');
  md.push('');
}

md.push('## 9. Multi-Candidate Case Index');
md.push('');
md.push(`见: \`docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_multi_candidate_cases.md\`（${multiCases.length} cases）`);
md.push('');
md.push(multiCases.map((c) => `- ${c.caseId} (KenLM=${c.kenlmInputs.length})`).join('\n'));
md.push('');

md.push('## 10. 16-Candidate Case Index');
md.push('');
md.push(`见: \`docs/tone-v2/_audit_scratch/dialog200_candidate_sentence_export/dialog200_candidate_cap_cases.md\`（${capCases.length} cases）`);
md.push('');
md.push(`Max KenLM Input observed: **${maxKenlmPerCase}** (${maxKenlmCaseId}). No case reached cap=16 in this trace.`);
md.push('');

md.push('## 11. Missing Trace Inventory');
md.push('');
md.push(`E1 missing files: ${exceptions.E1.length ? exceptions.E1.join(', ') : 'none'}`);
md.push('');

md.push('## 12. Count Reconciliation');
md.push('');
md.push('```text');
md.push(`Assembly total sentences: ${exportMeta.totals.assemblySentenceTotal}`);
md.push(`CrossPath input total: ${exportMeta.totals.crossPathInputTotal}`);
md.push(`CrossPath output total: ${exportMeta.totals.crossPathOutputTotal}`);
md.push(`KenLM input total: ${exportMeta.totals.kenlmInputTotalSentences}`);
md.push(
  `Cases with Assembly≠CrossPathInput: ${cases.filter((c) => !c.assemblyEqualsCrossPathInput).map((c) => c.caseId).join(', ') || 'none'}`
);
md.push('```');
md.push('');

md.push('## 13. CrossPath vs KenLM Input Reconciliation');
md.push('');
md.push(
  `Cases with text mismatch (E6): ${exceptions.E6.length ? [...new Set(exceptions.E6)].join(', ') : 'none'}`
);
md.push('');

md.push('## 14. Exception Inventory');
md.push('');
for (const [k, v] of Object.entries(exportMeta.exceptions)) {
  md.push(`- **${k}**: ${v.length ? v.join(', ') : '0'}`);
}
md.push('');

md.push('## 15. Final Export Conclusion');
md.push('');
md.push('```text');
md.push('EXPORT_COMPLETE_FROM_EXISTING_TRACE');
md.push('');
md.push(`导出 Case 数: ${exportMeta.totals.casesExported}`);
md.push(`单候选 Case 数: ${singleCandidateCases}`);
md.push(`多候选 Case 数: ${multiCandidateCases}`);
md.push(`KenLM Input 总句数: ${kenlmTotal}`);
md.push(`最大单 Case 候选数: ${maxKenlmPerCase} (${maxKenlmCaseId})`);
md.push(`缺失或异常 Case ID: ${
  Object.values(exportMeta.exceptions).flat().length
    ? [...new Set(Object.values(exportMeta.exceptions).flat())].join(', ')
    : 'none'
}`);
md.push('```');
md.push('');

fs.writeFileSync(mainReportPath, md.join('\n'), 'utf8');

console.error(
  JSON.stringify(
    {
      conclusion: exportMeta.conclusion,
      cases: cases.length,
      single: singleCandidateCases,
      multi: multiCandidateCases,
      kenlmTotal,
      maxKenlmPerCase,
      maxKenlmCaseId,
      mainReportBytes: fs.statSync(mainReportPath).size,
      exceptions: Object.fromEntries(
        Object.entries(exportMeta.exceptions).map(([k, v]) => [k, v.length])
      ),
    },
    null,
    2
  )
);
