#!/usr/bin/env node
/** P2: d001 raw vs best candidate score walkthrough */
import { spawn } from 'child_process';

function normalizeLmScore(score) {
  return 1 / (1 + Math.exp(-score / 10));
}

function tokenizeForLm(text) {
  const KEEP_PUNCT = new Set('，。！？；：、""\'\'（）()《》<>【】[]—-…·,.!?;:"\'');
  const normalized = text.normalize('NFKC').trim();
  const tokens = [];
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch >= '\u4e00' && ch <= '\u9fff') { tokens.push(ch); i++; continue; }
    const latin = /^[A-Za-z][A-Za-z0-9]*/.exec(normalized.slice(i));
    if (latin) { tokens.push(latin[0]); i += latin[0].length; continue; }
    const digits = /^\d+/.exec(normalized.slice(i));
    if (digits) { tokens.push(digits[0]); i += digits[0].length; continue; }
    if (KEEP_PUNCT.has(ch)) { tokens.push(ch); i++; continue; }
    i++;
  }
  return tokens.join(' ');
}

function runKenlmQuery(tokenized) {
  return new Promise((resolve) => {
    const proc = spawn('wsl.exe', [
      '--',
      '/mnt/d/Programs/github/lingua_1/kenLM/kenlm/build/bin/query',
      '/mnt/d/Programs/github/lingua_1/kenLM/model/zh_char_3gram.trie.bin',
    ], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (c) => { out += c; });
    proc.stdout.on('end', () => {
      const line = out.split('\n').find((l) => /Total:/i.test(l)) ?? '';
      const score = parseFloat((line.match(/Total:\s*([-\d.e]+)/i) ?? [])[1] ?? '0');
      const oov = parseInt((line.match(/OOV:\s*(\d+)/i) ?? [])[1] ?? '0', 10);
      resolve({ score, oov, norm: normalizeLmScore(score) });
    });
    proc.on('error', () => resolve({ score: 0, oov: -1, norm: 0.5 }));
    proc.stdin.write(tokenized + '\n', 'utf-8', () => proc.stdin.end());
  });
}

const raw = '你好,我想點一杯熱拿鐵鐘貝少糖 深便溫 以下今天有蓝美马分吗?';
const best = '你好,我想點一杯熱拿铁中杯少糖 身边溫 以下今天有蓝莓马芬吗?';

async function main() {
  const rawTok = tokenizeForLm(raw);
  const bestTok = tokenizeForLm(best);
  const rawR = await runKenlmQuery(rawTok);
  const bestR = await runKenlmQuery(bestTok);
  const delta = bestR.norm - rawR.norm;
  console.log(JSON.stringify({
    raw: { text: raw, tokenized: rawTok, ...rawR },
    best: { text: best, tokenized: bestTok, ...bestR },
    delta,
    minDeltaToReplace: 0.03,
    passGate: delta >= 0.03,
  }, null, 2));
}

main();
