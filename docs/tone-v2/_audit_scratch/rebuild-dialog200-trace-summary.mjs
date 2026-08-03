/**
 * Rebuild review summary from existing dialog200_sentence_assembly_trace/*.json (UTF-8).
 * READ-ONLY relative to production; only rewrites summary markdown.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, 'dialog200_sentence_assembly_trace');
const summaryPath = path.join(__dirname, 'dialog200_sentence_assembly_trace_summary.md');

function looksOdd(text, raw) {
  if (!text || text === raw) return false;
  const rules = [
    [/低脂/, /地址|医院|确认|酒店|会议|钥匙|柜子/],
    [/地质/, /确认|医院|拿铁|咖啡|钥匙/],
    [/议员|议室|医师/, /咖啡|拿铁|马芬|酒店|旅游|前台|钥匙|柜子|更衣室/],
    [/更医师|更议室/, /./],
    [/登机/, /风险|理财|银行/],
    [/拿铁|美式|马芬/, /医院|医师|议员|旅游|酒店前台/],
    [/酒店|前台|接机/, /拿铁|美式|少糖/],
    [/计花|计化|后选|生城/, /./],
  ];
  for (const [a, b] of rules) {
    if (a.test(text) && b.test(text)) return true;
  }
  return false;
}

const files = fs
  .readdirSync(dir)
  .filter((f) => /^\d{3}\.json$/.test(f))
  .sort();

const review = {
  A_single: [],
  B_asmGt1_kenlm1: [],
  C_crossPathDropped: [],
  D_oddLooking: [],
  E_kenlmTop1Questionable: [],
  humanNo: [],
};

for (const f of files) {
  const trace = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const file = `${trace.fileNum}.md`;
  if (trace.flags?.singleAssemblyOnly) {
    review.A_single.push({
      caseId: trace.caseId,
      file,
      raw: trace.rawText,
      reasons: trace.flags.singleReasons,
      kenlm: trace.kenlmInputTexts,
    });
  }
  if (trace.flags?.assemblyGt1_kenlmEq1) {
    review.B_asmGt1_kenlm1.push({
      caseId: trace.caseId,
      file,
      raw: trace.rawText,
      assembly: trace.assemblyTexts,
      kenlm: trace.kenlmInputTexts,
      note: 'Assembly 多句但 KenLM 仅 1：通常为 CrossPath exact-text dedup 后同文合并',
    });
  }
  if (trace.flags?.crossPathDroppedMany) {
    review.C_crossPathDropped.push({
      caseId: trace.caseId,
      file,
      raw: trace.rawText,
      dropped: trace.flags.droppedByDedupOrCap,
      kenlm: trace.kenlmInputTexts,
    });
  }
  const oddTexts = [...new Set([...(trace.assemblyTexts || []), ...(trace.kenlmInputTexts || [])])].filter(
    (t) => looksOdd(t, trace.rawText)
  );
  if (oddTexts.length) {
    review.D_oddLooking.push({
      caseId: trace.caseId,
      file,
      raw: trace.rawText,
      oddTexts,
    });
  }
  if (trace.flags?.kenlmTop1Questionable) {
    review.E_kenlmTop1Questionable.push({
      caseId: trace.caseId,
      file,
      raw: trace.rawText,
      top1: trace.kenlm?.top1,
      inputs: trace.kenlmInputTexts,
    });
  }
  if (trace.humanJudgment?.conform === 'NO') {
    review.humanNo.push({
      caseId: trace.caseId,
      file,
      raw: trace.rawText,
      reason: trace.humanJudgment.reason,
    });
  }
}

function block(title, items, render) {
  const lines = [`## ${title}`, ''];
  if (!items.length) {
    lines.push(title.startsWith('E.') ? '（无 — 本轮默认未跑 KenLM 排序；见各 Case 第 7 节 KenLM Input）' : '（无）');
    lines.push('');
    return lines;
  }
  for (const x of items) lines.push(...render(x));
  return lines;
}

const sum = [
  '# dialog_200 Sentence Assembly Full Trace — 人工审阅清单',
  '',
  '本文件只列出值得人工看的 Case。逐 Case 全文见 `dialog200_sentence_assembly_trace/NNN.md`。',
  '',
  '本轮只观察，不修复。',
  '',
  '---',
  '',
  ...block('A. 只有一条 Assembly', review.A_single, (x) => [
    `### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`,
    '',
    'Raw:',
    '',
    '```text',
    x.raw,
    '```',
    '',
    '为什么只有一句:',
    '',
    ...(x.reasons || []).map((r) => `- ${r}`),
    '',
    'KenLM Input:',
    '',
    ...(x.kenlm || []).map((t) => `- ${t}`),
    '',
  ]),
  ...block('B. Assembly>1 但 KenLM=1', review.B_asmGt1_kenlm1, (x) => [
    `### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`,
    '',
    'Raw:',
    '',
    '```text',
    x.raw,
    '```',
    '',
    'Assembly:',
    '',
    ...(x.assembly || []).map((t) => `- ${t}`),
    '',
    'KenLM Input:',
    '',
    ...(x.kenlm || []).map((t) => `- ${t}`),
    '',
    `为什么：${x.note}`,
    '',
  ]),
  ...block('C. Assembly 很多，CrossPath 去掉很多', review.C_crossPathDropped, (x) => [
    `### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`,
    '',
    'Raw:',
    '',
    '```text',
    x.raw,
    '```',
    '',
    '去掉哪些:',
    '',
    ...(x.dropped || []).map((t) => `- ${t}`),
    '',
    '为什么：exact-text first-wins dedup 和/或 global cap≤16 截断。',
    '',
    'KenLM 剩余:',
    '',
    ...(x.kenlm || []).map((t) => `- ${t}`),
    '',
  ]),
  ...block('D. Assembly 看起来离谱', review.D_oddLooking, (x) => [
    `### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`,
    '',
    'Raw:',
    '',
    '```text',
    x.raw,
    '```',
    '',
    '离谱句:',
    '',
    ...(x.oddTexts || []).map((t) => `- ${t}`),
    '',
  ]),
  ...block('E. KenLM Top1 明显可疑', review.E_kenlmTop1Questionable, (x) => [
    `### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`,
    '',
    'Raw:',
    '',
    '```text',
    x.raw,
    '```',
    '',
    `Top1: ${x.top1}`,
    '',
    'Inputs:',
    '',
    ...(x.inputs || []).map((t) => `- ${t}`),
    '',
  ]),
  ...block('人工判断 = NO', review.humanNo, (x) => [
    `### ${x.caseId} → [${x.file}](./dialog200_sentence_assembly_trace/${x.file})`,
    '',
    '```text',
    x.raw,
    '```',
    '',
    `原因：${x.reason}`,
    '',
  ]),
];

fs.writeFileSync(summaryPath, sum.join('\n'), 'utf8');
console.log(
  JSON.stringify(
    {
      files: files.length,
      A: review.A_single.length,
      B: review.B_asmGt1_kenlm1.length,
      C: review.C_crossPathDropped.length,
      D: review.D_oddLooking.length,
      E: review.E_kenlmTop1Questionable.length,
      NO: review.humanNo.length,
      summary: summaryPath,
    },
    null,
    2
  )
);
